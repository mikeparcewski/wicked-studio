#!/usr/bin/env python3
"""
uxfix_slice1_test.py — the DES-UXFIX-001 slice-1 gate: attention decay + board
bands, proven in a real browser against the W2 messy-reality fixture (§4.2).

The daemon cannot produce an 8-day-old failure — its durable log is stamped at
emit and `POST /runs` starts now — so the fixture is served by a DETERMINISTIC
FIXTURE SERVER, the same pattern the doc rig in studio_standalone_test.py §12
uses: a ThreadingHTTPServer that serves the `dist-sameorigin/` build (the
no-VITE_API_HOST build — `apiBase()` derives from window.location, so the page,
the API and the `/ws` handshake share ONE origin, no rebuild) plus every
endpoint the home route reads, with all timestamps computed from a single NOW0
captured at start.  No crew daemon is involved anywhere.

What it asserts (design §5.5, the slice-1 DOM AC):
  1. `legacy-spike` (failed 8 DAYS ago, but its project touched an hour ago —
     the R3 trap) is NOT inside band-needs-you; its card carries
     data-band="quiet". This exercises the `runEvents` backfill for real.
  2. `upload-endpoint` (live, streaming narration over the rig's /ws) IS inside
     band-needs-you and precedes legacy-spike in document order.
  3. The full expected NEEDS YOU order: q3-review-deck (gate 30s) →
     api-migration (gate 2m) → auth-refactor (failed 12m) → upload-endpoint.
  4. A gate whose receivedAt is 8 days old STILL leads (∞ half-life, in the
     browser) — driven by flipping the fixture's gate age and reloading.
  5. `band-not-in-project` is last in document order, collapsed, its count
     matches the orphan run; with the orphan removed it is absent entirely.
  6. No card inside band-needs-you has data-score < 20; no mounted card outside
     it has one >= 20.
  7. The bounded-page invariants hold with the 20 quiet clones: board height <=
     viewport, document height <= viewport, cards mounted < data-total.

Captures (§4.0 contract: 1440x900, device_scale_factor=1, waits on data-testid,
never a sleep) into e2e/shots/uxfix/ — gitignored evidence, referenced by path
from the JSON report this script prints:
  uxfix-1-messy-board.png     the full W2 board, QUIET collapsed
  uxfix-1-quiet-expanded.png  the same board, QUIET expanded via its toggle

Prereqs: Python Playwright (`pip install playwright && playwright install
chromium`). Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env knobs: W2_PORT (default 4330), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import base64
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "e2e" / "shots" / "uxfix"
W2_PORT = int(os.environ.get("W2_PORT", "4330"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"
NPM = "npm.cmd" if os.name == "nt" else "npm"

# Same rule as the main harness: gate toasts are not this surface (and the home
# route does not render them), but the suppression is cheap and display-only.
HIDE_GATE_TOASTS = '[data-testid="gate-notification"] { display: none !important; }'

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the doc rig — no third studio build) ─
dist = REPO / "dist-sameorigin"
if os.environ.get("SKIP_STUDIO_BUILD") == "1":
    if not (dist / "index.html").is_file():
        fail("build", f"SKIP_STUDIO_BUILD=1 but {dist}/index.html is missing — "
             "build it with `npx vite build --outDir dist-sameorigin` (no VITE_API_HOST)")
elif not (dist / "index.html").is_file():
    env = dict(os.environ, VITE_API_HOST="")
    r = subprocess.run(
        [NPM, "exec", "--", "vite", "build", "--outDir", "dist-sameorigin", "--emptyOutDir"],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        fail("build", f"same-origin vite build failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The W2 fixture (§4.2), every age from ONE frozen NOW0 ───────────────────
NOW0 = int(time.time() * 1000)
SEC, MIN, HOUR, DAY = 1_000, 60_000, 3_600_000, 86_400_000


def iso(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + f".{ms % 1000:03d}Z"


# Mutable fixture switches, flipped over POST /__fixture between page loads.
state = {"orphan": True, "q3_gate_age_ms": 30 * SEC}
state_lock = threading.Lock()


def project(pid: str, name: str, updated_at: int, **extra) -> dict:
    return {"id": pid, "name": name, "description": None, "status": "active",
            "scope": f"project:{pid}" if pid != "default" else "",
            "created_at": updated_at, "updated_at": updated_at, **extra}


# §4.2's rows. `legacy-spike`'s project was touched an HOUR ago while its run
# failed 8 DAYS ago — the exact R3 trap the runEvents backfill exists to defuse.
QUIET_CLONES = [project(f"quiet-{i:02d}", f"quiet-clone-{i:02d}", NOW0 - 3 * DAY - i * 7 * HOUR)
                for i in range(20)]
PROJECTS = [
    project("default", "Unfiled", NOW0),  # synthesized — must never render (F5)
    project("legacy-spike", "legacy-spike", NOW0 - HOUR),
    project("upload-endpoint", "upload-endpoint", NOW0),
    project("q3-review-deck", "q3-review-deck", NOW0 - 30 * SEC),
    project("api-migration", "api-migration", NOW0 - 2 * MIN),
    project("auth-refactor", "auth-refactor", NOW0 - 12 * MIN),
    project("smoke-tests", "smoke-tests", NOW0 - 6 * DAY),
    project("notes", "notes", NOW0 - 2 * DAY, interactiveRoot="/tmp/wi-notes"),
    project("scratch", "scratch", NOW0),
] + QUIET_CLONES

MEMBERS = {
    "legacy-spike": ["r-legacy"],
    "upload-endpoint": ["r-upload"],
    "q3-review-deck": ["r-q3"],
    "api-migration": ["r-api"],
    "auth-refactor": ["r-auth"],
    "smoke-tests": ["r-smoke1", "r-smoke2"],
}


def session(rid: str, status: str, problem: str, unit_desc: str) -> dict:
    return {"session": {
        "id": rid, "workflow_id": "wf-w2", "problem": problem, "entity_mode": "shared",
        "collection_scope": None, "clis": ["claude"], "status": status,
        "human_confirm": "all" if status == "awaiting_human" else "none",
        "unit_ix": 0, "attempt": 0, "workdir": None, "repo_ref": None,
        "extra_write_roots": [], "archived_at": None, "archive_note": None,
    }, "units": [{
        "id": f"{rid}:u0", "session_id": rid, "ord": 0, "description": unit_desc,
        "stage": "build", "assigned_cli": None, "assigned_invocation": None,
        "council_task_ref": None, "routing": None, "denial_reason": None,
        "phase_ref": None, "conformance_ref": None, "phase_status": None,
        "collection_scope": None, "status": "pending",
    }]}


RUNS = [
    session("r-q3", "awaiting_human", "make the Q3 review deck", "author the deck outline"),
    session("r-api", "awaiting_human", "migrate the auth tables", "plan the migration"),
    session("r-upload", "executing", "add rate-limiting to the upload endpoint",
            "add rate-limiting to the upload endpoint"),
    session("r-auth", "failed", "refactor the auth middleware", "refactor the auth middleware"),
    session("r-legacy", "failed", "spike the legacy importer", "spike the legacy importer"),
    session("r-smoke1", "completed", "smoke: login flow", "smoke the login flow"),
    session("r-smoke2", "completed", "smoke: checkout flow", "smoke the checkout flow"),
]
ORPHAN = session("r-orphan", "executing", "stranded work from another client",
                 "stranded work from another client")

# The durable-log tails (D3 step 2): the ONE honest clock for a failure's age.
RUN_EVENTS = {
    "r-legacy": [{"type": "sessionStarted", "session": "r-legacy", "ts": NOW0 - 8 * DAY - MIN},
                 {"type": "sessionFailed", "session": "r-legacy", "ts": NOW0 - 8 * DAY}],
    "r-auth": [{"type": "sessionStarted", "session": "r-auth", "ts": NOW0 - 13 * MIN},
               {"type": "sessionFailed", "session": "r-auth", "ts": NOW0 - 12 * MIN}],
}

NOTES_DOCS = [
    {"name": "ideas", "kind": "doc", "head": 1, "versions": 1, "updated_at": iso(NOW0 - 2 * DAY)},
    {"name": "todo", "kind": "doc", "head": 1, "versions": 1, "updated_at": iso(NOW0 - 3 * DAY)},
]

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
NARRATION = "Writing the token-bucket middleware for /upload"


def ws_frame(payload: dict) -> bytes:
    data = json.dumps(payload).encode()
    if len(data) < 126:
        head = bytes([0x81, len(data)])
    else:
        head = bytes([0x81, 126]) + len(data).to_bytes(2, "big")
    return head + data


class W2Handler(SimpleHTTPRequestHandler):
    """SPA + the whole /api/v1 surface the home route reads + /ws, one origin."""

    def log_message(self, *_args):  # keep stdout JSON-clean
        pass

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ws(self) -> None:
        """Accept the upgrade, then stream `unitOutputDelta` frames for the live
        run — `useRuns` gates its first fetch on a connected socket, so the
        handshake is mandatory, and the narration keeps the headline honest."""
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.wfile.write(
            ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
             f"Connection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        self.wfile.flush()
        try:
            while True:
                self.wfile.write(ws_frame({
                    "type": "unitOutputDelta", "session": "r-upload", "ord": 0,
                    "text": NARRATION + "\n",
                }))
                self.wfile.flush()
                time.sleep(1.0)
        except OSError:
            pass
        self.close_connection = True

    def _api(self, path: str) -> bool:
        if path == "/api/v1/health":
            self._json(200, {"status": "ok", "version": "w2-fixture", "ping": "pong"})
            return True
        if path == "/api/v1/runs":
            with state_lock:
                runs = RUNS + ([ORPHAN] if state["orphan"] else [])
            self._json(200, {"runs": runs})
            return True
        if path == "/api/v1/projects":
            self._json(200, {"projects": PROJECTS})
            return True
        if path == "/api/v1/repos":
            self._json(200, {"repos": []})
            return True
        parts = path.split("/")
        # /api/v1/projects/<id>/members
        if len(parts) == 6 and parts[3] == "projects" and parts[5] == "members":
            pid = urllib.parse.unquote(parts[4])
            self._json(200, {"members": [
                {"id": f"{pid}:crew.run:{ref}", "project_id": pid, "member_kind": "crew.run",
                 "member_ref": ref, "meta": None, "attached_at": 1, "attached_by": "studio"}
                for ref in MEMBERS.get(pid, [])
            ]})
            return True
        # /api/v1/projects/<id>/interactive/api/docs — the notes project's registry
        if path.startswith("/api/v1/projects/") and path.endswith("/interactive/api/docs"):
            pid = urllib.parse.unquote(path.split("/")[4])
            self._json(200, NOTES_DOCS if pid == "notes" else [])
            return True
        # /api/v1/runs/<id>/gate
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "gate":
            rid = urllib.parse.unquote(parts[4])
            if rid == "r-q3":
                with state_lock:
                    age = state["q3_gate_age_ms"]
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "Approve the deck outline?",
                                 "receivedAt": iso(NOW0 - age)})
            elif rid == "r-api":
                # `options: null` = free text ⇒ the COMPLEX gate shape (§7.11).
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "How should the tables move?",
                                 "receivedAt": iso(NOW0 - 2 * MIN), "options": None})
            else:
                self._json(404, {"error": f"no gate cached for {rid}"})
            return True
        # /api/v1/runs/<id>/events
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "events":
            rid = urllib.parse.unquote(parts[4])
            self._json(200, {"events": RUN_EVENTS.get(rid, [])})
            return True
        if path.startswith("/api/v1/"):
            self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            return True
        return False

    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self.headers.get("Upgrade", "").lower() == "websocket":
            return self._ws()
        path = urllib.parse.urlparse(self.path).path
        if self._api(path):
            return None
        if not Path(self.translate_path(self.path)).is_file():
            self.path = "/index.html"  # client-side routes resolve to the shell
        return super().do_GET()

    def do_POST(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        if path == "/__fixture":
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            with state_lock:
                state.update({k: v for k, v in body.items() if k in state})
                snapshot = dict(state)
            return self._json(200, {"ok": True, "state": snapshot})
        return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})


httpd = ThreadingHTTPServer(("127.0.0.1", W2_PORT), partial(W2Handler, directory=str(dist)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}


def set_fixture(**kwargs) -> None:
    req = urllib.request.Request(f"{ORIGIN}/__fixture", method="POST",
                                 data=json.dumps(kwargs).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        res.read()


# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

NEEDS_YOU_IDS = """() => Array.from(document.querySelectorAll(
    '[data-testid="band-needs-you"] [data-testid="project-card"]'))
    .map(c => c.dataset.projectId)"""

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]

console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # Settle on the DECAYED verdict, not the first paint: legacy-spike enters the
    # live band on its fresh `updated_at` and leaves it when the 8-day durable-log
    # tail lands (D3 step 2) — the wait is on that final state.
    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    # The live headline is streaming from the rig's own /ws before the shot.
    narration_ok = settled(
        """text => (document.querySelector(
             '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]')
             ?.textContent ?? '').includes(text)""",
        NARRATION,
    )

    needs_you = page.evaluate(NEEDS_YOU_IDS)
    legacy_not_leading = "legacy-spike" not in needs_you
    upload_leading = "upload-endpoint" in needs_you

    # Band order in the document: needs-you < quiet < not-in-project, shelf LAST.
    band_order_ok = page.evaluate(
        """() => { const b = document.querySelector('[data-testid="project-board"]');
                   const kids = Array.from(b.children).map(el => el.dataset.testid || '');
                   const iN = kids.indexOf('band-needs-you'), iQ = kids.indexOf('band-quiet'),
                         iU = kids.indexOf('band-not-in-project');
                   return iN >= 0 && iQ > iN && iU > iQ
                       && b.lastElementChild.dataset.testid === 'band-not-in-project'; }""")
    shelf_collapsed = page.evaluate(
        """() => { const s = document.querySelector('[data-testid="band-not-in-project"]');
                   return !!s && s.dataset.expanded === 'false' && s.dataset.count === '1'
                       && document.querySelectorAll('[data-testid="unfiled-run"]').length === 0; }""")
    # F5/V18: the junk bucket neither renders as a card nor by its old name.
    no_default_card = page.evaluate(
        """() => !document.querySelector('[data-project-id="default"]')
              && !document.body.innerText.includes('Unfiled')""")

    # ── Capture 1: the default first impression — QUIET collapsed (§4.0) ──────
    page.locator('[data-testid="band-quiet"][data-expanded="false"]').wait_for(timeout=10000)
    page.screenshot(path=str(SHOTS / "uxfix-1-messy-board.png"))

    # ── Expand QUIET; capture 2; then read the decay verdict off legacy's card ─
    page.locator('[data-testid="band-quiet-toggle"]').click()
    page.locator('[data-testid="band-quiet"][data-expanded="true"]').wait_for(timeout=10000)
    page.locator('[data-testid="band-quiet"] [data-testid="project-card"]').first.wait_for(timeout=10000)
    page.screenshot(path=str(SHOTS / "uxfix-1-quiet-expanded.png"))

    # Assertion 6, over every card the two windows currently mount.
    scores_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
             .every(c => (c.closest('[data-testid="band-needs-you"]') !== null)
                       === (Number(c.dataset.score) >= 20))""")

    # Assertion 7: the bounded-page invariants, with the 20 clones expanded.
    board_h = page.evaluate(
        """() => document.querySelector('[data-testid="project-board"]').clientHeight""")
    doc_h = page.evaluate("() => document.documentElement.scrollHeight")
    total = int(page.locator('[data-testid="project-board"]').get_attribute("data-total") or 0)
    mounted = page.locator('[data-testid="project-card"]').count()
    invariants_ok = board_h <= 900 and doc_h <= 900 + 1 and 0 < mounted < total

    # Assertion 1's second half: legacy-spike's card carries the verdict. Its
    # epsilon score (≈3e-13, still > the clones' 0) puts it in the quiet band's
    # FIRST row, so at scrollTop 0 it is co-mounted with the whole NEEDS YOU band
    # — no scrolling. (Scrolling to the bottom here would race: once the scroll
    # event's re-render lands, the quiet window moves past row 0 and unmounts the
    # very card under assertion.)
    legacy_card_ok = settled(
        """() => { const c = document.querySelector(
                     '[data-testid="project-card"][data-project-id="legacy-spike"]');
                   return !!c && c.dataset.band === 'quiet' && c.dataset.signal === 'failing'
                       && Number(c.dataset.score) < 1; }""")
    # …and upload-endpoint precedes it in document order (EC4, read from the DOM).
    precedes_ok = page.evaluate(
        """() => { const up = document.querySelector('[data-project-id="upload-endpoint"]');
                   const legacy = document.querySelector('[data-project-id="legacy-spike"]');
                   return !!up && !!legacy &&
                     !!(up.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING); }""")

    # ── Assertion 4: an 8-day-old GATE still leads — flip the age, reload ──────
    set_fixture(q3_gate_age_ms=8 * DAY)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    ancient_gate_ok = settled(
        """() => { const ids = Array.from(document.querySelectorAll(
                     '[data-testid="band-needs-you"] [data-testid="project-card"]'))
                     .map(c => c.dataset.projectId);
                   // still present, still ahead of every non-gate signal
                   return ids.includes('q3-review-deck')
                       && ids.indexOf('q3-review-deck') < ids.indexOf('auth-refactor'); }""")
    ancient_gate_score = page.evaluate(
        """() => document.querySelector('[data-project-id="q3-review-deck"]')?.dataset.score ?? null""")

    # ── Assertion 5's second half: no orphan ⇒ no shelf in the DOM at all ──────
    set_fixture(orphan=False)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    settled("""() => document.querySelectorAll(
                 '[data-testid="band-needs-you"] [data-testid="project-card"]').length === 4""")
    shelf_absent = page.evaluate(
        """() => document.querySelector('[data-testid="band-not-in-project"]') === null""")

    ctx.close()
    browser.close()

report["steps"]["w2_board"] = {
    "ok": all([
        order_ok, narration_ok, legacy_not_leading, upload_leading, band_order_ok,
        shelf_collapsed, no_default_card, scores_ok, invariants_ok, legacy_card_ok,
        precedes_ok, ancient_gate_ok, shelf_absent,
    ]),
    "needs_you_order": needs_you,
    "expected_order": EXPECTED_ORDER,
    "needs_you_order_ok": order_ok,
    "live_narration_streamed": narration_ok,
    "legacy_spike_not_in_needs_you": legacy_not_leading,
    "upload_endpoint_in_needs_you": upload_leading,
    "upload_precedes_legacy_in_document": precedes_ok,
    "legacy_card_quiet_failing_decayed": legacy_card_ok,
    "band_order_needs_quiet_shelf": band_order_ok,
    "shelf_last_collapsed_counted": shelf_collapsed,
    "shelf_absent_without_orphan": shelf_absent,
    "no_default_card_no_unfiled_word": no_default_card,
    "score_threshold_matches_band": scores_ok,
    "ancient_gate_still_leads": ancient_gate_ok,
    "ancient_gate_score": ancient_gate_score,
    "board_height_px": board_h,
    "document_scroll_height_px": doc_h,
    "projects_total": total,
    "cards_mounted_expanded": mounted,
    "bounded_page_invariants": invariants_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(SHOTS / n) for n in
                    ("uxfix-1-messy-board.png", "uxfix-1-quiet-expanded.png")],
}
if not report["steps"]["w2_board"]["ok"]:
    fail("w2_board_verdict", "slice-1 W2 assertions did not all hold — see w2_board")

report["ok"] = True
print(json.dumps(report, indent=2))
