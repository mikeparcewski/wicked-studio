#!/usr/bin/env python3
"""
interactive_wire_contract_test.py — the DES-FEEDBACK-001 §7.5 contract-check leg.

Runs the studio client's URL SHAPES against a REAL wicked-interactive bridge —
never a mock, never a fixture. The invariant this enforces: a fixture that
implements an invented route (as the slice-13 fixture did for
`GET /d/:id/api/demo/spec`, masking a production break) can no longer
self-confirm, because this rig fails the moment the studio client speaks a path
the real bridge does not serve — or the moment an "absent" route quietly
appears without the client being updated.

Lifecycle (§7.5):
  1. Start a local bridge on an ephemeral port from the sibling wicked-interactive
     checkout (`bin/wicked-interactive.js serve --root <tmp> --port <port>`), with
     WICKED_BUS_DATA_DIR pointed at a temp dir — the bus is embedded SQLite, zero
     infra. Wait for GET /api/health → {"ok": true}.
  2. POST /api/docs {name:"contract-check-demo", kind:"demo", url, brief} → 200.
  3. Assert every URL shape src/api/interactive.ts builds answers NON-404.
  4. Assert the INVENTED slice-13 routes are ABSENT (404) — if one starts
     answering, the failure message says to update the client first.
  5. Assert the recording routes exist as routes: POST /api/demo/gif is a 400
     (no recording yet), never a 404; a missing recording FILE 404s with the
     bridge's own "not found" body, not Express's route-missing "Cannot GET".

The demo's url points at localhost:3000 which need not be running: the check
tests ROUTE EXISTENCE, not recording success (§9 names this out of scope).

The theme wires are FATAL steps since issue #65 (they were slice F's advisory
finding): the corrected client speaks `wicked.interactive.theme.requested` over
POST /api/events, and the invented `GET /api/themes` / `POST /api/theme/learn`
must stay 404. The learned-theme READBACK (interactive#181) is FATAL too:
`GET /d/:docId/api/theme/learned` must answer its own JSON 404 on a fresh doc,
the tokens VERBATIM after a written learn, and the JSON 404 again on a corrupt
file — the wire studio's restored brand-learn flow polls. The remaining
known-invented wire OUTSIDE scope (sources attach: slice 19) is still probed as
ADVISORY — reported, not fatal.

studio#119 adds section 8, the same pin turned on a wire that has never existed
in EITHER shape: the doc registry serves create + read only — no delete route
(every spelling is Express's route-missing 404) and no delete bus command (the
`docs` subdomain owns only `doc.created`). It is FATAL in the "absent" direction
for the same reason section 4 is: studio must not grow a delete affordance for a
wire nobody serves, and the day the bridge does serve one, this is what says so.

BRIDGE-UX-1 (DES-UX-001 §8.4): section 7 grows the FATAL probes for the four
bridge-contract questions DES-UX-001 is gated on — mid-run sends (queue or
drop, B1), the thread-history read (B3), unfiled-doc hosting (B2), and per-seat
mid-stream lifecycle (C6). Each probe PINS observed bridge behavior as the
contract; a pin that starts failing means the bridge grew (or changed) the
surface — adopt it in the client/design first, then move the pin. Outcomes are
recorded prose-side in DES-UX-001 §8.4.1; crew lookups are pinned to a dead
port so the probes can never touch a real crew daemon on this machine.

Env knobs:
  WICKED_INTERACTIVE_DIR  the bridge checkout (default: ../wicked-interactive
                          next to this repo — the monorepo layout).
  WI_CONTRACT_PORT        fixed port (default: scan from 4460).

Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WI_DIR = Path(os.environ.get("WICKED_INTERACTIVE_DIR", str(REPO.parent / "wicked-interactive")))
DEMO = "contract-check-demo"

report: dict = {"ok": False, "bridge": None, "steps": {}, "advisory": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 40):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    fail("port", "no free port in the scan range")
    raise AssertionError  # unreachable


def http(method: str, url: str, body: dict | None = None) -> tuple[int, str, str]:
    """(status, body-text, content-type) — an HTTPError is a RESPONSE here, not a failure."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read().decode("utf-8", "replace"), res.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), e.headers.get("Content-Type", "") or ""


# ── 0. The client side of the contract: no invented wire is even SPELLED ───────
# §8.3's grep AC: `getDemoSpec` is not imported anywhere in src/ — nor is
# `getLatestRecording`, nor any /api/demo/{spec,recordings,record} path literal.
# A client that cannot build the URL cannot regress onto it.
import re  # noqa: E402 (grouped with its one use, harness style)

# Issue #65 adds the invented theme spellings: the path literal /api/themes and the
# wrappers that built them. (`learnTheme\b` does not match `learnThemeFromThread` —
# that helper now speaks the corrected event wire; `api/theme/learn\b` does not match
# `api/theme/learned` — the REAL interactive#181 readback route getLearnedTheme
# builds, whose existence is asserted as a FATAL positive step below.)
# studio#119 adds the delete spellings PRE-EMPTIVELY — the one entry here that bans a
# wire nobody has invented yet, because the ask is live and the wire is absent in both
# shapes (section 8). The vitest guard covers the client module's exports; this covers
# the rest of src/, where a component could build the URL inline and skip it.
BANNED_SPELLINGS = re.compile(
    r"getDemoSpec|getLatestRecording|api/demo/(spec|recordings|record)\b"
    r"|api/themes|api/theme/learn\b|listThemes|getTheme\b|learnTheme\b"
    r"|(delete|remove|purge|destroy)(Doc|Docs|Demo|Demos|Document)"
    r"|wicked\.interactive\.doc\.(deleted|removed|retired|archived)")
spelled: list[str] = []
for f in sorted((REPO / "src").rglob("*")):
    if f.suffix not in (".ts", ".tsx"):
        continue
    for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        if BANNED_SPELLINGS.search(line) and "invented" not in line and "neither of which" not in line:
            spelled.append(f"{f.relative_to(REPO)}:{n}: {line.strip()[:120]}")
report["steps"]["client_never_spells_invented_wire"] = {"ok": spelled == [], "hits": spelled}
if spelled:
    fail("client_grep_verdict",
         "src/ spells a wire the bridge does not serve — land it upstream (and move the "
         "matching pin below) before contract-checking: " + "; ".join(spelled[:5]))

# ── 1. The real bridge, on a temp root ─────────────────────────────────────────
cli = WI_DIR / "bin" / "wicked-interactive.js"
if not cli.is_file():
    fail("bridge_checkout",
         f"wicked-interactive not found at {WI_DIR} — set WICKED_INTERACTIVE_DIR "
         "to the checkout (the monorepo default is the sibling directory)")

tmp = Path(tempfile.mkdtemp(prefix="wi-contract-"))
port = free_port(int(os.environ.get("WI_CONTRACT_PORT", "4460")))
base = f"http://127.0.0.1:{port}"
# BRIDGE-UX-1 hermeticity: pin the bridge's crew lookups (project.js resolveCrewApi,
# server.js crewApiBase) to a port nothing listens on, so the refused-bind probe can
# never reach — let alone write into — a REAL crew daemon running on this machine.
dead_crew_port = free_port(port + 7)
env = dict(os.environ, WICKED_BUS_DATA_DIR=str(tmp / "bus"),
           WICKED_CREW_API=f"http://127.0.0.1:{dead_crew_port}")
log = (tmp / "serve.log").open("w")


def spawn_bridge() -> subprocess.Popen:
    return subprocess.Popen(
        ["node", str(cli), "serve", "--root", str(tmp / "docs"), "--port", str(port)],
        cwd=str(WI_DIR), env=env, stdout=log, stderr=log,
    )


def wait_healthy(p: subprocess.Popen, step: str = "bridge_start") -> None:
    """Wait for the bridge's own health signal — never a sleep-and-hope."""
    deadline = time.time() + 30
    while time.time() < deadline:
        if p.poll() is not None:
            fail(step,
                 f"bridge exited early (rc={p.returncode}) — see {tmp}/serve.log:\n"
                 + (tmp / "serve.log").read_text()[-2000:])
        try:
            status, text, _ = http("GET", f"{base}/api/health")
            if status == 200 and json.loads(text).get("ok") is True:
                return
        except OSError:
            pass
        time.sleep(0.2)
    fail(step, f"GET /api/health never answered ok:true on {base}")


proc = spawn_bridge()

try:
    wait_healthy(proc)
    report["bridge"] = {"dir": str(WI_DIR), "root": str(tmp / "docs"), "port": port,
                        "pid": proc.pid}
    report["steps"]["bridge_start"] = {"ok": True}

    # ── 2. Create the demo doc (kind:"demo" seeds a v0 storyboard placeholder) ──
    status, text, _ = http("POST", f"{base}/api/docs", {
        "name": DEMO, "kind": "demo",
        "url": "http://localhost:3000", "brief": "check the login flow",
    })
    created = json.loads(text) if status == 200 else {}
    report["steps"]["create_demo"] = {
        "ok": status == 200 and created.get("name") == DEMO and created.get("kind") == "demo",
        "status": status, "body": created or text[:300],
    }
    if not report["steps"]["create_demo"]["ok"]:
        fail("create_demo_verdict", f"POST /api/docs did not create the demo: {status} {text[:300]}")
    head = int(created.get("head", 0))

    # ── 3. Every URL shape the studio client builds must answer NON-404 ─────────
    # One row per wrapper in src/api/interactive.ts (slice-F surface). The demo
    # has no recording and no crew behind it, so 4xx bodies are fine — only a 404
    # says "this route does not exist", which is the contract being checked.
    POSITIVE: list[tuple[str, str, str, dict | None]] = [
        ("listDocs",          "GET",  "/api/docs",                                    None),
        ("createDoc",         "POST", "/api/docs",                                    {"name": DEMO}),  # 409 exists = route exists
        ("getVersions",       "GET",  f"/d/{DEMO}/api/versions",                      None),
        ("storyboard_head",   "GET",  f"/d/{DEMO}/doc",                               None),
        ("interactiveDocUrl", "GET",  f"/d/{DEMO}/doc/{head}",                        None),
        ("conversation",      "GET",  f"/d/{DEMO}/api/conversation",                  None),
        ("getSources",        "GET",  f"/d/{DEMO}/api/sources",                       None),
        ("postFork",          "POST", f"/d/{DEMO}/api/fork",                          {"from": head}),
        ("postExport",        "POST", f"/d/{DEMO}/api/export",                        {"version": head, "format": "html"}),
        ("getPreflight",      "GET",  "/api/preflight",                               None),
        ("postEvent_chat",    "POST", "/api/events",
         {"event_type": "wicked.interactive.chat.posted",
          "payload": {"role": "user", "text": "hi", "document_id": DEMO, "source_message_id": "m1"}}),
        # The CORRECTED record wire (§7.4): requestRecord speaks demo.requested.
        ("requestRecord",     "POST", "/api/events",
         {"event_type": "wicked.interactive.demo.requested", "payload": {"document_id": DEMO}}),
        # The batch contract step feedback rides (§7.4 "what is kept"). docfb2:
        # items are ADR-0002 schema items — the shape writeFeedback serializes and
        # applyFeedbackItems consumes ({selector, type, …}), which the client now sends.
        ("feedback_batch",    "POST", "/api/events",
         {"event_type": "wicked.interactive.feedback.submitted",
          "payload": {"document_id": DEMO, "version": head, "target": "demo_step",
                      "source_message_id": "m2",
                      "items": [{"selector": "step-0", "type": "structural-change",
                                 "instruction": "x"}]}}),
        # The CORRECTED theme wire (issue #65): requestThemeLearn speaks
        # theme.requested — doc-scoped, url OR path, exactly what
        # materializeThemeRequested reads. Both source kinds must be routable.
        ("requestThemeLearn_url",  "POST", "/api/events",
         {"event_type": "wicked.interactive.theme.requested",
          "payload": {"document_id": DEMO, "url": "https://example.com"}}),
        ("requestThemeLearn_path", "POST", "/api/events",
         {"event_type": "wicked.interactive.theme.requested",
          "payload": {"document_id": DEMO, "path": "/tmp/brand-guide.pdf"}}),
    ]
    positive_rows = []
    positive_ok = True
    for name, method, path, body in POSITIVE:
        status, text, ctype = http(method, f"{base}{path}", body)
        ok = status != 404
        if name in ("storyboard_head", "interactiveDocUrl"):
            ok = ok and status == 200 and ctype.startswith("text/html")
        positive_ok = positive_ok and ok
        positive_rows.append({"wrapper": name, "method": method, "path": path,
                              "status": status, "content_type": ctype, "ok": ok,
                              **({} if ok else {"body": text[:200]})})
    report["steps"]["client_url_shapes"] = {"ok": positive_ok, "routes": positive_rows}

    # ── 4. The INVENTED slice-13 routes must be ABSENT ──────────────────────────
    INVENTED = [
        ("GET",  f"/d/{DEMO}/api/demo/spec"),
        ("GET",  f"/d/{DEMO}/api/demo/recordings"),
        ("POST", f"/d/{DEMO}/api/demo/record"),
        # Issue #65: the slice-16 theme wires, promoted from advisory to FATAL —
        # the bridge has no theme registry and no learn endpoint; the real wire
        # is theme.requested over POST /api/events (asserted above).
        ("GET",  "/api/themes"),
        ("GET",  "/api/themes/some-theme"),
        ("POST", "/api/theme/learn"),
    ]
    invented_rows = []
    invented_ok = True
    for method, path in INVENTED:
        status, _, _ = http(method, f"{base}{path}", {} if method == "POST" else None)
        ok = status == 404
        invented_ok = invented_ok and ok
        invented_rows.append({
            "method": method, "path": path, "status": status, "ok": ok,
            **({} if ok else {"error": "The invented route now exists on the bridge — "
                                       "update the studio client to use it, then remove "
                                       "this assertion."}),
        })
    report["steps"]["invented_routes_absent"] = {"ok": invented_ok, "routes": invented_rows}

    # ── 5. The REAL recording routes exist — as routes, not files ───────────────
    gif_status, gif_text, _ = http("POST", f"{base}/d/{DEMO}/api/demo/gif", {"version": head})
    # No recording exists, so the ROUTE answers a clean 400 with the reason —
    # a 404 here would mean the route itself is missing.
    gif_ok = gif_status != 404 and gif_status in (200, 400)
    rec_status, rec_text, _ = http("GET", f"{base}/d/{DEMO}/api/demo/recording/absent.mp4")
    # File-missing 404 (the handler's own "not found"), never Express's
    # route-missing "Cannot GET".
    rec_ok = rec_status == 404 and "Cannot GET" not in rec_text
    report["steps"]["recording_routes_exist"] = {
        "ok": gif_ok and rec_ok,
        "gif_export": {"status": gif_status, "body": gif_text[:200]},
        "recording_file_missing": {"status": rec_status, "body": rec_text[:200]},
    }

    # ── 6. The learned-theme READBACK exists (interactive#181) — FATAL ──────────
    # `getLearnedTheme` builds GET /d/:docId/api/theme/learned. Four probes:
    #   a. FRESH doc → the route's OWN 404 {"error":"no learned theme"} — the JSON
    #      body IS the route-exists proof (an express-default 404 is HTML
    #      "Cannot GET …", which is what an absent route would answer).
    #   b. a WRITTEN learn: drop learned.theme.json into the doc workspace (the
    #      exact file the assist agent writes) → 200 {document_id, learned_at,
    #      tokens} with the tokens VERBATIM.
    #   c. CORRUPT file → back to the route's own 404 (the apply seam degrades
    #      past it identically — resolveLearnedTheme returns null).
    #   d. UNKNOWN doc → status 404 asserted, and STATUS ONLY (the body there is
    #      express's, not the route's — never pin it).
    def learned_get(doc: str) -> tuple[int, str, str]:
        return http("GET", f"{base}/d/{doc}/api/theme/learned")

    fresh_status, fresh_text, _ = learned_get(DEMO)
    try:
        fresh_body = json.loads(fresh_text)
    except ValueError:
        fresh_body = None
    fresh_ok = (fresh_status == 404 and isinstance(fresh_body, dict)
                and fresh_body.get("error") == "no learned theme")

    theme_dir = tmp / "docs" / DEMO / "theme"
    theme_dir.mkdir(parents=True, exist_ok=True)
    LEARNED_TOKENS = {
        "name": "contract-check-brand",
        "colors": {"background": "#f8fafc", "surface": "#ffffff", "primary": "#0a2a5e",
                   "secondary": "#0e7490", "accent": "#0a2a5e", "text_primary": "#1e293b"},
        "fonts": {"heading": "Georgia", "body": "Georgia", "mono": "Menlo"},
    }
    (theme_dir / "learned.theme.json").write_text(json.dumps(LEARNED_TOKENS), encoding="utf-8")
    learned_status, learned_text, learned_ctype = learned_get(DEMO)
    try:
        learned_body = json.loads(learned_text)
    except ValueError:
        learned_body = {}
    learned_ok = (learned_status == 200
                  and learned_body.get("document_id") == DEMO
                  and learned_body.get("tokens") == LEARNED_TOKENS  # the file VERBATIM
                  and ("learned_at" in learned_body))

    (theme_dir / "learned.theme.json").write_text("{not json", encoding="utf-8")
    corrupt_status, corrupt_text, _ = learned_get(DEMO)
    try:
        corrupt_body = json.loads(corrupt_text)
    except ValueError:
        corrupt_body = None
    corrupt_ok = (corrupt_status == 404 and isinstance(corrupt_body, dict)
                  and corrupt_body.get("error") == "no learned theme")

    unknown_status, _, _ = learned_get("absent-doc-that-never-existed")
    unknown_ok = unknown_status == 404  # status ONLY — the body is express's, not ours

    report["steps"]["learned_theme_readback"] = {
        "ok": fresh_ok and learned_ok and corrupt_ok and unknown_ok,
        "fresh_doc_404_with_route_body": {"ok": fresh_ok, "status": fresh_status,
                                          "body": fresh_text[:200]},
        "written_learn_200_verbatim": {"ok": learned_ok, "status": learned_status,
                                       "content_type": learned_ctype,
                                       **({} if learned_ok else {"body": learned_text[:400]})},
        "corrupt_file_404": {"ok": corrupt_ok, "status": corrupt_status,
                             "body": corrupt_text[:200]},
        "unknown_doc_404_status_only": {"ok": unknown_ok, "status": unknown_status},
    }

    # ═══ 7. BRIDGE-UX-1 (DES-UX-001 §8.4) — the four gating probes ══════════════
    # Every probe pins OBSERVED bridge behavior as the contract for its dependent
    # studio slice (T / U / AB). Pins are FATAL both ways: a surface a pin says is
    # absent that starts answering means the bridge grew it — adopt it in the
    # client/design, then move the pin (the invented-routes protocol, §4 above).
    import threading  # noqa: E402 (grouped with its one consumer, harness style)

    class SSEReader:
        """Collect GET /api/events frames on a thread — the studio's live wire."""

        def __init__(self, url: str):
            self.frames: list[dict] = []
            self.lock = threading.Lock()
            self.thread = threading.Thread(target=self._run, args=(url,), daemon=True)
            self.thread.start()

        def _run(self, url: str) -> None:
            try:
                with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as res:
                    etype, data = None, []
                    for raw in res:
                        line = raw.decode("utf-8", "replace").rstrip("\n")
                        if line.startswith("event: "):
                            etype = line[7:]
                        elif line.startswith("data: "):
                            data.append(line[6:])
                        elif line == "":
                            if etype and data:
                                try:
                                    envelope = json.loads("".join(data))
                                except ValueError:
                                    envelope = {}
                                with self.lock:
                                    self.frames.append({"event_type": etype, "envelope": envelope})
                            etype, data = None, []
            except OSError:
                pass  # bridge stopped (probe 2 restarts it); collected frames stay readable

        def wait_for(self, pred, timeout: float = 25.0):
            deadline = time.time() + timeout
            while time.time() < deadline:
                with self.lock:
                    for f in self.frames:
                        if pred(f):
                            return f
                time.sleep(0.1)
            return None

    def sse_payload(frame) -> dict:
        p = (frame or {}).get("envelope", {}).get("payload")
        return p if isinstance(p, dict) else {}

    sse = SSEReader(f"{base}/api/events")
    PROBE_DOC = "bridge-ux-1-probe"

    def conversation() -> list[dict]:
        s, t, _ = http("GET", f"{base}/d/{PROBE_DOC}/api/conversation")
        return json.loads(t) if s == 200 else []

    def wait_conversation(pred, timeout: float = 25.0) -> list[dict]:
        deadline = time.time() + timeout
        while time.time() < deadline:
            entries = conversation()
            if pred(entries):
                return entries
            time.sleep(0.25)
        return conversation()

    # ── Probe 3 (§6.2, slice U): can the bridge host an UNFILED doc? ────────────
    # (a) POST /api/docs with NO `project` field is exactly what Make→Unfiled would
    # send through the default project's mount (crew synthesizes that mount by
    # design — proxy-routes.ts rootFor() skips the existence check for `default`).
    status, text, _ = http("POST", f"{base}/api/docs", {
        "name": PROBE_DOC,
        "html": "<!DOCTYPE html><html><body><h1>probe</h1><p>unfiled</p></body></html>",
    })
    unfiled_created = status == 200 and json.loads(text).get("name") == PROBE_DOC
    s_doc, _, ct_doc = http("GET", f"{base}/d/{PROBE_DOC}/doc")
    s_list, t_list, _ = http("GET", f"{base}/api/docs")
    listed = s_list == 200 and any(d.get("name") == PROBE_DOC for d in json.loads(t_list))
    hosts_unfiled = unfiled_created and s_doc == 200 and ct_doc.startswith("text/html") and listed
    # (b) a REFUSED bind (crew pinned unreachable above) is loud and creates NOTHING.
    s_bind, t_bind, _ = http("POST", f"{base}/api/docs", {
        "name": "bridge-ux-1-filed", "html": "<html><body>x</body></html>", "project": "default",
    })
    s_ghost, _, _ = http("GET", f"{base}/d/bridge-ux-1-filed/doc")
    bind_refused_loudly = s_bind == 502 and "unreachable" in t_bind and s_ghost == 404
    report["steps"]["bridge_ux1_probe3_unfiled_docs"] = {
        "ok": hosts_unfiled and bind_refused_loudly,
        "verdict": "B2 = make-Unfiled-work is viable: the bridge hosts a project-unbound doc "
                   "natively (created, mounted, served, listed); binding needs a reachable crew "
                   "and a refused bind creates nothing",
        "unfiled_create": {"ok": hosts_unfiled, "status": status,
                           "doc_served": s_doc, "listed": listed},
        "refused_bind": {"ok": bind_refused_loudly, "status": s_bind,
                         "ghost_doc_status": s_ghost, "body": t_bind[:200]},
    }

    # ── Probe 1 (§6.1, slice T): mid-run sends — QUEUE or DROP? ─────────────────
    # A real command (feedback.submitted, materialized on the doc FIFO) and a burst
    # of thread sends fired in the same instant. The accept gate must be run-state-
    # independent: every send answers 200 + event_id (no busy-reject surface) and
    # lands durably in the transcript IN SEND ORDER — queue semantics, never drop.
    s_fb, _, _ = http("POST", f"{base}/api/events", {
        "event_type": "wicked.interactive.feedback.submitted",
        "payload": {"document_id": PROBE_DOC, "version_target": 0,
                    "source_message_id": "probe-msg-0",
                    "items": [{"selector": "probe", "type": "structural-change",
                               "instruction": "probe — retitle the heading"}]},
    })
    send_rows = []
    for i in (1, 2, 3):
        s, t, _ = http("POST", f"{base}/api/events", {
            "event_type": "wicked.interactive.chat.posted",
            "payload": {"role": "user", "text": f"probe-send-{i}", "document_id": PROBE_DOC,
                        "source_message_id": f"probe-msg-{i}"},
        })
        body = json.loads(t) if s == 200 else {}
        send_rows.append({"status": s, "ack_keys": sorted(body.keys())})
    sends_accepted = all(r["status"] == 200 for r in send_rows)
    # Pin: the ack is {ok, event_id, correlation_id} — no queue position, no run id.
    ack_shape_pinned = all(r["ack_keys"] == ["correlation_id", "event_id", "ok"] for r in send_rows)
    entries = wait_conversation(
        lambda es: sum(1 for e in es if str(e.get("text", "")).startswith("probe-send-")) >= 3)
    landed = [e["text"] for e in entries if str(e.get("text", "")).startswith("probe-send-")]
    landed_in_order = landed == ["probe-send-1", "probe-send-2", "probe-send-3"]
    # The command executed AROUND the sends (the in-flight run was real):
    fb_done = sse.wait_for(lambda f: f["event_type"] == "wicked.interactive.feedback.processed"
                           and sse_payload(f).get("document_id") == PROBE_DOC)
    vc = sse.wait_for(lambda f: f["event_type"] == "wicked.interactive.version.created"
                      and sse_payload(f).get("document_id") == PROBE_DOC)
    # Pin the B1 anchor gap: version.created carries NO causing-message correlation
    # (the client supplies source_message_id; the bridge drops it — anchor is client-side).
    vc_payload = sse_payload(vc)
    anchor_gap_pinned = vc is not None and "source_message_id" not in vc_payload
    report["steps"]["bridge_ux1_probe1_mid_run_sends"] = {
        "ok": s_fb == 200 and sends_accepted and ack_shape_pinned and landed_in_order
              and fb_done is not None and anchor_gap_pinned,
        "verdict": "B1 = QUEUE: a send arriving while a command materializes is accepted "
                   "(200 + event_id — no busy-reject exists on this wire) and lands durably "
                   "in send order; version.created carries no source_message_id, so the "
                   "version anchor stays client-side",
        "command_accepted": s_fb == 200, "sends": send_rows,
        "transcript_order": landed, "feedback_processed": fb_done is not None,
        "version_created_payload_keys": sorted(vc_payload.keys()),
    }

    # ── Probe 4 (§7.9, slice AB): per-seat MID-STREAM lifecycle ─────────────────
    # (a) the lifecycle types that exist are agent/service-owned — never UI-forgeable:
    s_status, t_status, _ = http("POST", f"{base}/api/events", {
        "event_type": "wicked.interactive.status.posted",
        "payload": {"document_id": PROBE_DOC, "state": "error", "message": "forged"}})
    s_err, t_err, _ = http("POST", f"{base}/api/events", {
        "event_type": "wicked.interactive.error.raised",
        "payload": {"document_id": PROBE_DOC, "source": "probe", "error": "forged"}})
    lifecycle_locked = (s_status == 403 and "not a UI-emittable" in t_status
                        and s_err == 403 and "not a UI-emittable" in t_err)
    # (b) NO per-seat vocabulary exists on this wire:
    s_seat, t_seat, _ = http("POST", f"{base}/api/events", {
        "event_type": "wicked.interactive.seat.failed",
        "payload": {"document_id": PROBE_DOC, "seat": "claude"}})
    seat_absent = s_seat == 400 and "unknown event type" in t_seat
    # (c) a REAL mid-stream death, observed on the wire: theme.requested against an
    # absent file makes the materializer die mid-work; the bridge's whole failure
    # surface is one DOC-scoped status.posted {state:"error"} — no seat, no turn.
    http("POST", f"{base}/api/events", {
        "event_type": "wicked.interactive.theme.requested",
        "payload": {"document_id": PROBE_DOC, "path": str(tmp / "absent-brand.pdf")}})
    err_frame = sse.wait_for(lambda f: f["event_type"] == "wicked.interactive.status.posted"
                             and sse_payload(f).get("document_id") == PROBE_DOC
                             and sse_payload(f).get("state") == "error")
    err_payload = sse_payload(err_frame)
    doc_scoped_error = (err_frame is not None
                        and "file not found" in str(err_payload.get("message", ""))
                        and not any(k in err_payload for k in ("seat", "seat_id", "turn", "reply_id")))
    # …and the death reaches the durable transcript as agent narration:
    entries = wait_conversation(
        lambda es: any(e.get("role") == "agent" and e.get("state") == "error" for e in es))
    error_narrated = any(e.get("role") == "agent" and e.get("state") == "error" for e in entries)
    report["steps"]["bridge_ux1_probe4_seat_lifecycle"] = {
        "ok": lifecycle_locked and seat_absent and doc_scoped_error and error_narrated,
        "verdict": "C6 = NO per-seat lifecycle on this wire: a mid-stream death emits one "
                   "doc-scoped status.posted {state:error, message} (SSE-relayed + narrated "
                   "into the transcript); seat identity does not exist in the vocabulary and "
                   "lifecycle types are not UI-forgeable",
        "lifecycle_types_locked_to_agent": {"ok": lifecycle_locked,
                                            "status_posted": s_status, "error_raised": s_err},
        "seat_vocabulary_absent": {"ok": seat_absent, "status": s_seat},
        "mid_stream_death_frame": {"ok": doc_scoped_error,
                                   "payload_keys": sorted(err_payload.keys()),
                                   "message": str(err_payload.get("message", ""))[:160]},
        "death_narrated_in_transcript": error_narrated,
    }

    # ── Probe 2 (§6.3, slice T): thread-history read after RECONNECT ────────────
    # Fidelity pins first: GET /api/conversation is a REAL history read but carries
    # role/text/ts(/state) only — the send's source_message_id is dropped at append
    # and version.created never enters the transcript, so version anchors cannot be
    # rehydrated from this surface today (T's session-storage stopgap stands).
    entries = conversation()
    sent = [e for e in entries if str(e.get("text", "")).startswith("probe-send-")]
    fidelity_pinned = (len(sent) == 3
                       and all(set(e.keys()) <= {"role", "text", "ts", "state"} for e in entries)
                       and not any("source_message_id" in e for e in entries))
    # The reconnect that matters is a full bridge restart: disk (conversation.jsonl)
    # must be the store, not process memory. Same root, same port, fresh process.
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=8)
    proc = spawn_bridge()
    wait_healthy(proc, step="bridge_ux1_probe2_restart")
    entries_after = conversation()
    landed_after = [e["text"] for e in entries_after if str(e.get("text", "")).startswith("probe-send-")]
    survives_restart = landed_after == ["probe-send-1", "probe-send-2", "probe-send-3"]
    s_list2, t_list2, _ = http("GET", f"{base}/api/docs")
    remounted = s_list2 == 200 and any(d.get("name") == PROBE_DOC for d in json.loads(t_list2))
    report["steps"]["bridge_ux1_probe2_thread_history"] = {
        "ok": fidelity_pinned and survives_restart and remounted,
        "verdict": "B3 = a REAL history read EXISTS: GET /d/:doc/api/conversation returns the "
                   "announce history (chat + agent narration) from disk and survives a full "
                   "bridge restart; fidelity is role/text/ts(/state) only — no message ids, no "
                   "version markers — so text rehydrates now, anchors stay client-side",
        "fidelity": {"ok": fidelity_pinned,
                     "entry_keys": sorted({k for e in entries for k in e})},
        "survives_restart": {"ok": survives_restart, "texts": landed_after},
        "doc_remounted_after_restart": remounted,
    }

    # ── 8. The doc registry is CREATE + READ only (studio#119) — FATAL ─────────
    # studio#119 asks for a delete affordance for docs/demos. This section is the
    # answer, PINNED against the real bridge rather than asserted in prose: there is
    # no wire to hang one on, so studio (a pure client) cannot grow the button.
    #
    # Both escape hatches are checked, because the record (§7.4) and theme (issue #65)
    # wires each answered "no HTTP route" by turning out to be a UI-emittable bus
    # COMMAND — the shape an invented `deleteDoc` would most plausibly be waved
    # through as:
    #   a. every plausible HTTP spelling is Express's route-missing 404, and the
    #      "Cannot <METHOD> …" body is the proof it is route-missing rather than a
    #      service refusal (which would be JSON, as GET /d/:doc/api/theme/learned is);
    #   b. the bus has no unmake verb in the `docs` subdomain at all — the ownership
    #      table (src/service/events.js) holds only doc.created — so both candidate
    #      spellings are rejected `400 unknown event type`, one step BEFORE the
    #      403 uiEmittable check an existing-but-service-owned type would hit;
    #   c. the doc is still listed afterwards — no probe accidentally deleted it,
    #      which is what makes (a) and (b) a real absence rather than a lucky 404.
    #
    # When this section FAILS, the bridge grew the wire: adopt it in
    # src/api/interactive.ts, drop the CI guard in tests/interactive.client.test.ts,
    # and move this pin — all in the same change. Cleanup is not done at the bridge
    # alone: crew keeps a per-document replay-dedup row in
    # ~/.wicked-crew/interactive-draft-ledger.json (keyed by document id for the draft
    # leg), so a delete that leaves the row behind means a doc re-created under the
    # same name never gets its first draft again.
    DELETE_SPELLINGS = [
        ("DELETE", f"/api/docs/{DEMO}"),
        ("DELETE", f"/d/{DEMO}"),
        ("DELETE", f"/d/{DEMO}/api/doc"),
        ("DELETE", f"/d/{DEMO}/api/versions"),
        ("POST",   f"/api/docs/{DEMO}/delete"),
    ]
    delete_rows = []
    delete_absent = True
    for method, path in DELETE_SPELLINGS:
        status, text, _ = http(method, f"{base}{path}", {} if method == "POST" else None)
        ok = status == 404 and f"Cannot {method} " in text
        delete_absent = delete_absent and ok
        delete_rows.append({
            "method": method, "path": path, "status": status, "ok": ok,
            **({} if ok else {"body": text[:200],
                              "error": "the bridge now answers here — adopt the wire in "
                                       "src/api/interactive.ts, drop the CI guard in "
                                       "tests/interactive.client.test.ts, and move this pin"}),
        })
    bus_rows = []
    bus_absent = True
    for verb in ("deleted", "removed", "retired", "archived"):
        status, text, _ = http("POST", f"{base}/api/events", {
            "event_type": f"wicked.interactive.doc.{verb}",
            "payload": {"document_id": DEMO}})
        ok = status == 400 and "unknown event type" in text
        bus_absent = bus_absent and ok
        bus_rows.append({"event_type": f"wicked.interactive.doc.{verb}",
                         "status": status, "ok": ok,
                         **({} if ok else {"body": text[:200]})})
    s_list3, t_list3, _ = http("GET", f"{base}/api/docs")
    survives = s_list3 == 200 and any(d.get("name") == DEMO for d in json.loads(t_list3))
    report["steps"]["doc_delete_wire_absent"] = {
        "ok": delete_absent and bus_absent and survives,
        "verdict": "studio#119 = NO delete wire EXISTS: not an HTTP route (every spelling is "
                   "Express's route-missing 404) and not a bus command (the docs subdomain "
                   "owns only doc.created, so every unmake verb is `unknown event type`). "
                   "Crew's proxy is not the blocker — registerInteractiveProxy mounts "
                   "scope.all(…) and forwards any method verbatim. The UI has no delete "
                   "affordance BECAUSE the wire has none; it must land in wicked-interactive "
                   "(route + doc.* unmake event) and wicked-crew (drop the doc's "
                   "interactive-draft-ledger.json row) before studio grows the button.",
        "http_spellings": delete_rows,
        "bus_spellings": bus_rows,
        "doc_survives_every_probe": survives,
    }

    # ── Advisory: invented wires OUTSIDE this scope (on the record, not fatal) ──
    for name, method, path, body in [
        ("attachSource (slice 19)", "POST", f"/d/{DEMO}/api/sources",   {"path": "/tmp/x.md"}),
    ]:
        status, _, _ = http(method, f"{base}{path}", body)
        report["advisory"][name] = {
            "method": method, "path": path, "status": status,
            "note": "route missing on the real bridge" if status == 404 else "answers",
        }

finally:
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()
    shutil.rmtree(tmp, ignore_errors=True)

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("contract_verdict", f"contract-check assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
