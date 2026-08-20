#!/usr/bin/env python3
"""
uxfix_slice2_test.py — the DES-UXFIX-001 slice-2 gate: card variants, the
empty-state budget, and the mode-spine quick actions, proven in a real browser
against the W2 messy-reality fixture (§4.2).

Same rig pattern as uxfix_slice1_test.py (which stays the slice-1 gate): a
deterministic ThreadingHTTPServer serves the `dist-sameorigin/` build plus every
endpoint the home route reads, all timestamps computed from one frozen NOW0, the
live run narrating over the rig's own /ws. No crew daemon is involved anywhere.

What it asserts (design §4.3, the slice-2 DOM AC):
  1. Every mounted card in band-needs-you carries data-variant="active"; an
     active card with no documents renders NO doc tile — the region is OMITTED
     (auth-refactor and q3-review-deck are the fixture's proof).
  2. Every mounted card in band-quiet (expanded) carries data-variant="quiet",
     exactly ONE data-testid="quiet-summary" line, and none of the region
     furniture (doc-tile / live-line / run-chip).
  3. The banned absence strings appear NOWHERE in the page text: "No documents
     yet", "Nothing running", "No runs yet", "Start here" (F1, §3.7).
  4. The four data-testid="quick-action" per card have distinct data-mode
     (chat/build/document/video) and labels matching MODE_SPECS (Chat / Build /
     Document / Video) — the old near-synonyms ("New chat", "Do work") are gone.
  5. `scratch` (brand-new, empty) shows the first-run invitation as its ONE
     line and the 2×2 sublabelled action grid, sublabels matching MODE_SPECS.
  6. No mounted card is clipped (scrollHeight <= clientHeight + 1): the fixed
     variant heights actually fit their fullest content.

Captures (§4.0 contract: 1440x900 viewport, device_scale_factor=1, waits on
data-testid, never a sleep) into e2e/shots/uxfix/ — gitignored evidence:
  uxfix-2-active-card.png   q3-review-deck: pill, live gate chip, no dead regions
  uxfix-2-quiet-card.png    smoke-tests: the one-line QUIET variant
  uxfix-2-actions.png       scratch: invitation + the four differentiated verbs

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4331), SKIP_STUDIO_BUILD.
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
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "e2e" / "shots" / "uxfix"
W2_PORT = int(os.environ.get("W2_PORT", "4331"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"
NPM = "npm.cmd" if os.name == "nt" else "npm"

HIDE_GATE_TOASTS = '[data-testid="gate-notification"] { display: none !important; }'

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the slice-1 rig — same dist dir) ─────
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


def project(pid: str, name: str, updated_at: int, **extra) -> dict:
    return {"id": pid, "name": name, "description": None, "status": "active",
            "scope": f"project:{pid}" if pid != "default" else "",
            "created_at": updated_at, "updated_at": updated_at, **extra}


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
    session("r-orphan", "executing", "stranded work from another client",
            "stranded work from another client"),
]

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
            self._json(200, {"runs": RUNS})
            return True
        if path == "/api/v1/projects":
            self._json(200, {"projects": PROJECTS})
            return True
        if path == "/api/v1/repos":
            self._json(200, {"repos": []})
            return True
        parts = path.split("/")
        if len(parts) == 6 and parts[3] == "projects" and parts[5] == "members":
            pid = urllib.parse.unquote(parts[4])
            self._json(200, {"members": [
                {"id": f"{pid}:crew.run:{ref}", "project_id": pid, "member_kind": "crew.run",
                 "member_ref": ref, "meta": None, "attached_at": 1, "attached_by": "studio"}
                for ref in MEMBERS.get(pid, [])
            ]})
            return True
        if path.startswith("/api/v1/projects/") and path.endswith("/interactive/api/docs"):
            pid = urllib.parse.unquote(path.split("/")[4])
            self._json(200, NOTES_DOCS if pid == "notes" else [])
            return True
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "gate":
            rid = urllib.parse.unquote(parts[4])
            if rid == "r-q3":
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "Approve the deck outline?",
                                 "receivedAt": iso(NOW0 - 30 * SEC)})
            elif rid == "r-api":
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "How should the tables move?",
                                 "receivedAt": iso(NOW0 - 2 * MIN), "options": None})
            else:
                self._json(404, {"error": f"no gate cached for {rid}"})
            return True
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


httpd = ThreadingHTTPServer(("127.0.0.1", W2_PORT), partial(W2Handler, directory=str(dist)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]
# The §1 spine, verbatim from MODE_SPECS — labels and first-run sublabels.
MODE_LABELS = ["Chat", "Build", "Document", "Video"]
MODE_KEYS = ["chat", "build", "document", "video"]
SUBLABELS = [
    "think out loud with an agent",
    "ship code, with checks",
    "a deck, page, or report",
    "record a demo",
]
BANNED = ["No documents yet", "Nothing running", "No runs yet", "Start here", "Unfiled"]

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

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # Settle on the DECAYED verdict (the slice-1 order), so every later read and
    # shot is against the final board, not the first paint.
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

    # ── AC 3: the banned absence strings appear nowhere on the surface ─────────
    body_text = page.evaluate("() => document.body.innerText")
    banned_hits = [s for s in BANNED if s in body_text]

    # ── AC 1: every NEEDS YOU card is the ACTIVE variant; empty regions omitted ─
    active_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="band-needs-you"] [data-testid="project-card"]'))
              .every(c => c.dataset.variant === 'active'
                       && c.querySelectorAll('[data-testid="quiet-summary"]').length === 0)""")
    # auth-refactor (failed, docless) and q3-review-deck (gated, docless): the
    # Documents region is OMITTED — no tile, no invitation, nothing.
    docless_ok = page.evaluate(
        """() => ['auth-refactor', 'q3-review-deck'].every(id => {
               const c = document.querySelector(`[data-testid="project-card"][data-project-id="${id}"]`);
               return !!c && c.querySelectorAll('[data-testid="doc-tile"]').length === 0; })""")
    # The gate chip is live on the q3 card (§2.1.5 weight — it is why the card leads).
    gate_chip_ok = page.evaluate(
        """() => { const c = document.querySelector('[data-project-id="q3-review-deck"]');
                   return !!c && !!c.querySelector('[data-testid="gate-approve-r-q3"]')
                       && !!c.querySelector('[data-testid="gate-reject-r-q3"]'); }""")
    # The header pill names the signal in user words (V3: 'working', not 'distributing').
    pill_ok = page.evaluate(
        """() => { const kind = id => document.querySelector(
                     `[data-project-id="${id}"] [data-testid="attention-pill"]`)?.textContent ?? '';
                   return kind('q3-review-deck') === 'gate'
                       && kind('auth-refactor') === 'failed'
                       && kind('upload-endpoint') === 'working'; }""")

    # ── AC 4: the mode-spine actions, on every mounted card ────────────────────
    actions_ok = page.evaluate(
        """spine => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
              .every(c => {
                const acts = Array.from(c.querySelectorAll('[data-testid="quick-action"]'));
                const modes = acts.map(a => a.dataset.mode);
                const labels = acts.map(a => a.textContent);
                return acts.length === 4
                    && JSON.stringify(modes) === JSON.stringify(spine.keys)
                    && new Set(modes).size === 4
                    && spine.labels.every((l, i) => labels[i].includes(l));
              })""",
        {"keys": MODE_KEYS, "labels": MODE_LABELS},
    )

    # ── Capture 1: the ACTIVE card (q3-review-deck — pill, gate chip, no dead regions)
    q3 = page.locator('[data-testid="project-card"][data-project-id="q3-review-deck"]')
    q3.locator('[data-testid="gate-approve-r-q3"]').wait_for(timeout=10000)
    q3.screenshot(path=str(SHOTS / "uxfix-2-active-card.png"))

    # ── AC 2 + 5: expand QUIET; the one-line variant and the first-run card ────
    page.locator('[data-testid="band-quiet-toggle"]').click()
    page.locator('[data-testid="band-quiet"][data-expanded="true"]').wait_for(timeout=10000)
    page.locator('[data-testid="band-quiet"] [data-testid="project-card"]').first.wait_for(timeout=10000)

    quiet_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="band-quiet"] [data-testid="project-card"]'))
              .every(c => c.dataset.variant === 'quiet'
                       && c.querySelectorAll('[data-testid="quiet-summary"]').length === 1
                       && c.querySelectorAll('[data-testid="doc-tile"]').length === 0
                       && c.querySelectorAll('[data-testid="live-line"]').length === 0
                       && c.querySelectorAll('[data-testid="run-chip"]').length === 0
                       && c.clientHeight <= 110)""")

    # `scratch` (brand-new, empty): the invitation IS its one line, and the
    # sublabelled grid teaches what each verb produces (§2.2, EC6).
    scratch = page.locator('[data-testid="project-card"][data-project-id="scratch"]')
    scratch.wait_for(timeout=10000)
    firstrun_ok = page.evaluate(
        """subs => { const c = document.querySelector('[data-project-id="scratch"]');
               if (!c) return false;
               const line = c.querySelector('[data-testid="quiet-summary"]');
               const got = Array.from(c.querySelectorAll('[data-testid="quick-action-sublabel"]'))
                   .map(s => s.textContent);
               return !!line && line.dataset.invitation === 'true'
                   && (line.textContent ?? '').includes('Start by describing what you want')
                   && c.querySelector('[data-testid="quick-actions"]')?.dataset.detail === 'true'
                   && JSON.stringify(got) === JSON.stringify(subs); }""",
        SUBLABELS,
    )
    # …and it is the ONLY invitation: every other quiet card says "Quiet — last active".
    others_calm_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="band-quiet"] [data-testid="project-card"]'))
              .filter(c => c.dataset.projectId !== 'scratch')
              .every(c => /Quiet — last active \\d+[smhd] ago/.test(
                  c.querySelector('[data-testid="quiet-summary"]')?.textContent ?? ''))""")

    # ── Capture 3: the first-run card — invitation + four differentiated verbs ─
    scratch.screenshot(path=str(SHOTS / "uxfix-2-actions.png"))

    # ── Capture 2: a stale-debris QUIET card. smoke-tests (6d) may sit past the
    # mounted window, so scroll the quiet band up and let the window re-mount. ──
    page.evaluate(
        """() => { const b = document.querySelector('[data-testid="project-board"]');
                   b.scrollTop = document.querySelector('[data-testid="band-quiet"]').offsetTop; }""")
    smoke = page.locator('[data-testid="project-card"][data-project-id="smoke-tests"]')
    smoke.wait_for(timeout=10000)
    smoke_summary = smoke.locator('[data-testid="quiet-summary"]').text_content() or ""
    smoke.screenshot(path=str(SHOTS / "uxfix-2-quiet-card.png"))
    smoke_ok = "Quiet — last active 6d ago" in smoke_summary

    # ── AC 6: nothing is clipped — each variant's fixed height fits its content ─
    clipped = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
             .filter(c => c.scrollHeight > c.clientHeight + 1)
             .map(c => `${c.dataset.projectId}:${c.scrollHeight}>${c.clientHeight}`)""")

    ctx.close()
    browser.close()

report["steps"]["slice2_board"] = {
    "ok": all([
        order_ok, narration_ok, not banned_hits, active_ok, docless_ok, gate_chip_ok,
        pill_ok, actions_ok, quiet_ok, firstrun_ok, others_calm_ok, smoke_ok, not clipped,
    ]),
    "needs_you_order_ok": order_ok,
    "live_narration_streamed": narration_ok,
    "banned_strings_found": banned_hits,
    "needs_you_cards_all_active_variant": active_ok,
    "docless_active_cards_omit_documents_region": docless_ok,
    "gate_chip_answerable_on_card": gate_chip_ok,
    "attention_pill_user_words": pill_ok,
    "quick_actions_mode_spine_on_every_card": actions_ok,
    "quiet_cards_one_line_no_furniture": quiet_ok,
    "first_run_invitation_and_sublabels": firstrun_ok,
    "other_quiet_cards_say_last_active": others_calm_ok,
    "smoke_tests_summary": smoke_summary,
    "smoke_tests_summary_ok": smoke_ok,
    "clipped_cards": clipped,
    "console_errors": console_errors[:10],
    "screenshots": [str(SHOTS / n) for n in
                    ("uxfix-2-active-card.png", "uxfix-2-quiet-card.png", "uxfix-2-actions.png")],
}
if not report["steps"]["slice2_board"]["ok"]:
    fail("slice2_verdict", "slice-2 assertions did not all hold — see slice2_board")

report["ok"] = True
print(json.dumps(report, indent=2))
