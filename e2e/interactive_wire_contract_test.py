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

Known-invented wires OUTSIDE slice F's scope (themes: slice 16; sources attach:
slice 19) are probed as ADVISORY — reported, not fatal — so the finding is on
the record without blocking this slice.

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


# ── 1. The real bridge, on a temp root ─────────────────────────────────────────
cli = WI_DIR / "bin" / "wicked-interactive.js"
if not cli.is_file():
    fail("bridge_checkout",
         f"wicked-interactive not found at {WI_DIR} — set WICKED_INTERACTIVE_DIR "
         "to the checkout (the monorepo default is the sibling directory)")

tmp = Path(tempfile.mkdtemp(prefix="wi-contract-"))
port = free_port(int(os.environ.get("WI_CONTRACT_PORT", "4460")))
base = f"http://127.0.0.1:{port}"
env = dict(os.environ, WICKED_BUS_DATA_DIR=str(tmp / "bus"))
log = (tmp / "serve.log").open("w")
proc = subprocess.Popen(
    ["node", str(cli), "serve", "--root", str(tmp / "docs"), "--port", str(port)],
    cwd=str(WI_DIR), env=env, stdout=log, stderr=log,
)

try:
    # Wait for the bridge's own health signal — never a sleep-and-hope.
    deadline = time.time() + 30
    healthy = False
    while time.time() < deadline:
        if proc.poll() is not None:
            fail("bridge_start",
                 f"bridge exited early (rc={proc.returncode}) — see {tmp}/serve.log:\n"
                 + (tmp / "serve.log").read_text()[-2000:])
        try:
            status, text, _ = http("GET", f"{base}/api/health")
            if status == 200 and json.loads(text).get("ok") is True:
                healthy = True
                break
        except OSError:
            pass
        time.sleep(0.2)
    if not healthy:
        fail("bridge_start", f"GET /api/health never answered ok:true on {base}")
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
        # The batch contract step feedback rides (§7.4 "what is kept").
        ("feedback_batch",    "POST", "/api/events",
         {"event_type": "wicked.interactive.feedback.submitted",
          "payload": {"document_id": DEMO, "version": head, "target": "demo_step",
                      "source_message_id": "m2", "items": [{"wid": "step-0", "comment": "x"}]}}),
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

    # ── Advisory: invented wires OUTSIDE slice F (on the record, not fatal) ─────
    for name, method, path, body in [
        ("listThemes (slice 16)",   "GET",  "/api/themes",              None),
        ("learnTheme (slice 16)",   "POST", "/api/theme/learn",         {"kind": "url", "url": "https://example.com"}),
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
