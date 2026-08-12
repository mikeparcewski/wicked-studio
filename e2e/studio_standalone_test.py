#!/usr/bin/env python3
"""
studio_standalone_test.py — the carve gate: prove wicked-studio is a FORMALLY
INDEPENDENT client of the wicked-crew daemon, from its own repo.

(Adapted from the task-#84 gate that lived in the wicked-crew monorepo as
e2e/studio_standalone_test.py; the #98 carve moved it here because the thing it
proves — the SPA needs nothing from the crew source tree — is now this repo's
contract with the world.)

What "independent" means here, and what this script proves end-to-end:

  1. the studio builds ALONE (`npm run build` in THIS repo) — no crew checkout is
     touched anywhere in this flow; the SPA compiles against the published wire
     contract (`wicked-crew-api-types`), not against the daemon's source
  2. its `dist/` is served from a PLAIN static file server on a different port
     (default :4310) — not by the daemon
  3. it is pointed at a running crew daemon via VITE_API_HOST (baked at build time,
     exactly the documented dev/standalone config seam in `src/api/client.ts`)
  4. the daemon's loopback CORS admits the second port (the LOOPBACK_ORIGIN regex in
     crew's server.ts allows ANY localhost port — verified live, not assumed)
  5. a real browser (Playwright chromium) drives a real flow against the daemon:
     list runs → open a run → approve its human gate through the UI → watch live
     CoreEvent frames arrive over ws://<daemon>/ws until the run completes
  6. (post-#243) the project surface answers: GET /api/v1/projects returns 200 with
     a list, cross-origin

The daemon is the ONE thing this repo cannot supply. Point CREW_CLI at a built
crew CLI entry (`.../packages/crew/dist/cli/index.js`); it defaults to the sibling
checkout layout (`../wicked-crew/packages/crew/dist/cli/index.js`). The daemon runs
with `--stub` (deterministic offline engine) and a throwaway db.

Prereqs:  a built crew daemon (see CREW_CLI), Python Playwright
(`pip install playwright && playwright install chromium`). The script builds the
studio itself unless SKIP_STUDIO_BUILD=1 (in which case dist/ must already be
baked for CREW_PORT).

Env knobs: CREW_CLI, CREW_PORT (default 7901), STUDIO_PORT (default 4310),
SKIP_STUDIO_BUILD.

Prints a JSON report to stdout (exit 0/1); screenshots land in e2e/shots/.
Operator-run smoke — though it spends no tokens (stub engine, no real CLI seats).
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import mkdtemp

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "e2e" / "shots"
CREW_PORT = int(os.environ.get("CREW_PORT", "7901"))
STUDIO_PORT = int(os.environ.get("STUDIO_PORT", "4310"))
CREW_CLI = Path(
    os.environ.get(
        "CREW_CLI",
        REPO.parent / "wicked-crew" / "packages" / "crew" / "dist" / "cli" / "index.js",
    )
)
CREW_ORIGIN = f"http://127.0.0.1:{CREW_PORT}"
STUDIO_ORIGIN = f"http://127.0.0.1:{STUDIO_PORT}"
API = f"{CREW_ORIGIN}/api/v1"
NPM = "npm.cmd" if os.name == "nt" else "npm"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def http_json(method: str, url: str, body: dict | None = None, origin: str | None = None):
    req = urllib.request.Request(url, method=method)
    if origin:
        req.add_header("Origin", origin)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data, timeout=30) as res:
        # lower-case the header names: Node/Fastify emits them lower-cased on the wire
        headers = {k.lower(): v for k, v in res.headers.items()}
        return res.status, headers, json.loads(res.read() or b"null")


# ── 1. Build the studio STANDALONE (this repo only — no crew checkout touched) ─
if os.environ.get("SKIP_STUDIO_BUILD") != "1":
    env = dict(os.environ, VITE_API_HOST=f"127.0.0.1:{CREW_PORT}")
    r = subprocess.run(
        [NPM, "run", "build"],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0:
        fail("studio_build", f"vite build failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    report["steps"]["studio_build"] = {
        "ok": True,
        "cmd": "npm run build",
        "vite_api_host": f"127.0.0.1:{CREW_PORT}",
        "crew_checkout_touched": False,
    }

dist = REPO / "dist"
if not (dist / "index.html").is_file():
    fail("studio_dist", f"{dist}/index.html missing — studio build did not produce a dist")

# ── 2. Plain static server on a different port (SPA fallback for deep links) ──
class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib naming)
        if not Path(self.translate_path(self.path)).is_file():
            self.path = "/index.html"  # client-side routes (/work, /runs/<id>) resolve to the shell
        return super().do_GET()

    def log_message(self, *_args):  # keep stdout JSON-clean
        pass


httpd = ThreadingHTTPServer(("127.0.0.1", STUDIO_PORT), partial(SpaHandler, directory=str(dist)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
report["steps"]["static_server"] = {"ok": True, "origin": STUDIO_ORIGIN, "root": str(dist)}

# ── 3. Daemon from a built crew package (bin target), stub engine, throwaway db ─
if not CREW_CLI.is_file():
    fail("daemon", f"{CREW_CLI} missing — build wicked-crew first, or set CREW_CLI")
headless = not (CREW_CLI.parent.parent / "studio" / "index.html").is_file()
tmp = mkdtemp(prefix="studio-standalone-")
daemon = subprocess.Popen(
    ["node", str(CREW_CLI), "serve", "--port", str(CREW_PORT), "--db", os.path.join(tmp, "core.db"), "--stub"],
    cwd=tmp, env=dict(os.environ, WICKED_MEMORY_EMBEDDER="hash"),
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
ready = False
deadline = time.time() + 60
assert daemon.stdout is not None
while time.time() < deadline:
    line = daemon.stdout.readline()
    if not line:
        break
    if "WICKED_CREW_READY" in line:
        ready = True
        break
if not ready:
    daemon.kill()
    fail("daemon", "daemon never printed WICKED_CREW_READY within 60s")
def _drain(stream):  # keep the daemon from blocking on a full stdout pipe, retain nothing
    for _ in stream:
        pass


threading.Thread(target=_drain, args=(daemon.stdout,), daemon=True).start()
report["steps"]["daemon"] = {
    "ok": True, "origin": CREW_ORIGIN, "stub": True,
    "bin": str(CREW_CLI),
    "headless_no_bundled_studio": headless,
}

try:
    # ── 4. CORS: the daemon must admit the second loopback port ───────────────
    status, headers, _ = http_json("GET", f"{API}/health", origin=STUDIO_ORIGIN)
    echoed = headers.get("access-control-allow-origin")
    if status != 200 or echoed != STUDIO_ORIGIN:
        fail("cors", f"health={status}, Access-Control-Allow-Origin={echoed!r} (wanted {STUDIO_ORIGIN!r})")
    pre = urllib.request.Request(f"{API}/runs", method="OPTIONS")
    pre.add_header("Origin", STUDIO_ORIGIN)
    pre.add_header("Access-Control-Request-Method", "POST")
    with urllib.request.urlopen(pre, timeout=10) as res:
        pre_status = res.status
    report["steps"]["cors"] = {"ok": True, "allow_origin_echoed": echoed, "preflight_status": pre_status}

    # ── 5. The project surface (#243) answers cross-origin ────────────────────
    status, _, projects = http_json("GET", f"{API}/projects", origin=STUDIO_ORIGIN)
    if status != 200 or not isinstance(projects.get("projects"), list):
        fail("projects", f"GET /projects → {status}, body keys {sorted(projects) if isinstance(projects, dict) else type(projects)}")
    report["steps"]["projects"] = {"ok": True, "status": status, "count": len(projects["projects"])}

    # ── 6. Launch a run over REST (human gate ⇒ parks deterministically) ──────
    problem = "task-98 carve gate: prove the extracted SPA drives the daemon cross-origin"
    _, _, launched = http_json("POST", f"{API}/runs", {"problem": problem, "humanConfirm": "all"})
    run_id = launched["runId"]
    deadline = time.time() + 60
    run_status = None
    while time.time() < deadline:
        _, _, body = http_json("GET", f"{API}/runs/{run_id}")
        run_status = body["run"]["session"]["status"]
        if run_status == "awaiting_human":
            break
        time.sleep(0.5)
    if run_status != "awaiting_human":
        fail("launch", f"run {run_id} never reached awaiting_human (status={run_status})")
    report["steps"]["launch"] = {"ok": True, "run_id": run_id, "status": run_status}

    # ── 7. Real browser: list runs → open run → approve gate → watch WS ───────
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        fail("playwright", "pip install playwright && playwright install chromium")

    SHOTS.mkdir(exist_ok=True)
    ws_frames: list[dict] = []
    ws_urls: list[str] = []
    console_errors: list[str] = []

    def on_ws(ws):
        ws_urls.append(ws.url)
        ws.on("framereceived", lambda payload: ws_frames.append(
            json.loads(payload) if isinstance(payload, str) else {"type": "<binary>"}))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("websocket", on_ws)
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        page.goto(f"{STUDIO_ORIGIN}/work", wait_until="networkidle")
        # `.first` — the work page lists the run in both its Active and All groupings.
        card = page.locator(f'[data-testid="run-link"][data-run-id="{run_id}"]').first
        card.wait_for(timeout=30000)
        list_rendered = card.inner_text()  # NB: the link JS-truncates long problems (TITLE_MAX)
        page.screenshot(path=str(SHOTS / "standalone-run-list.png"), full_page=True)

        card.click()
        gate = page.locator('[data-testid="steering-gate"]').first
        gate.wait_for(timeout=30000)
        page.screenshot(path=str(SHOTS / "standalone-run-gate.png"), full_page=True)

        page.locator('[data-testid="steering-approve"]').first.click()
        deadline = time.time() + 90
        while time.time() < deadline:
            if any(f.get("type") == "sessionCompleted" and f.get("session") == run_id for f in ws_frames):
                break
            page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / "standalone-run-done.png"), full_page=True)
        browser.close()

    completed = any(f.get("type") == "sessionCompleted" and f.get("session") == run_id for f in ws_frames)
    _, _, final = http_json("GET", f"{API}/runs/{run_id}")
    listed = problem[:30] in list_rendered  # prefix — the run link truncates long titles
    report["steps"]["browser_flow"] = {
        "ok": completed and listed,
        "run_list_rendered": listed,
        "run_opened_gate_visible": True,
        "gate_approved_via_ui": True,
        "ws_urls": ws_urls,
        "ws_frames_received": len(ws_frames),
        "ws_event_types": sorted({f.get("type", "?") for f in ws_frames}),
        "session_completed_over_ws": completed,
        "final_status_via_rest": final["run"]["session"]["status"],
        "console_errors": console_errors[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("standalone-run-list.png", "standalone-run-gate.png", "standalone-run-done.png")],
    }
    if not report["steps"]["browser_flow"]["ok"]:
        fail("browser_flow_verdict", "run list / WS completion assertions did not all hold — see browser_flow")

    report["ok"] = True
    print(json.dumps(report, indent=2))
finally:
    daemon.terminate()
    httpd.shutdown()
