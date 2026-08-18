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
  7. (DES-MERGE-001 slice 4) the project shell: /p/:projectId/:mode renders the
     four-mode switcher, an unavailable mode is disabled with its enabling action in
     the tooltip, clicking Build is a real (back-button-correct) navigation, and the
     pre-merge /runs/:id and /projects/:id bookmarks redirect into the new shape
  8. (DES-MERGE-001 slice 5) the orchestrator board at /: the gate-waiting project
     sorts first, an empty project's card IS its four quick actions (each pre-bound
     to that project), doc tiles are placeholders rather than iframes (§7.5), and
     20+ projects stay windowed inside a viewport-bounded board

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
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
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

    # ── 8. Slice 4 (DES-MERGE-001 §6.2): project shell, mode switcher, redirects ─
    # File the run under a real project first: run→project resolution is membership-based,
    # and `default` is the SYNTHESIZED unfiled project, which deliberately never redirects.
    _, _, created = http_json("POST", f"{API}/projects", {"name": f"slice4-{run_id[:12]}"})
    project_id = created["project"]["id"]
    http_json(
        "POST", f"{API}/projects/{project_id}/members",
        {"kind": "crew.run", "ref": run_id, "attachedBy": "studio"},
    )

    def wait_for_path(page, path: str, timeout: float = 30.0) -> bool:
        """Poll the SPA's path — pushState/replaceState, not document navigations."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            if urllib.parse.urlparse(page.url).path == path:
                return True
            page.wait_for_timeout(200)
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Land on a mode whose surface makes no API calls, so this section asserts the
        # SHELL rather than whatever a live surface happens to be doing.
        page.goto(f"{STUDIO_ORIGIN}/p/{project_id}/document", wait_until="networkidle")
        switcher = page.locator('[data-testid="mode-switcher"]')
        switcher.wait_for(timeout=30000)
        tabs = switcher.locator('[role="tab"]')
        tab_labels = [tabs.nth(i).inner_text() for i in range(tabs.count())]

        # AC: an unavailable mode is DISABLED (never hidden) and its tooltip names the
        # one action that enables it (§1.3 rule 3).
        video = page.locator('[data-testid="mode-tab-video"]')
        video_title = video.get_attribute("title") or ""
        disabled_ok = (
            video.is_disabled()
            and re.search(r"install|connect|create", video_title, re.I) is not None
        )
        # The deep-linked unavailable mode still states what it is and how to enable it
        # (§3.3: no bare spinner, every state names a subject).
        placeholder_ok = page.locator('[data-testid="mode-enabling-action-document"]').is_visible()
        page.screenshot(path=str(SHOTS / "slice4-mode-switcher.png"), full_page=True)

        # AC: clicking Build changes the URL, and the back button returns.
        page.locator('[data-testid="mode-tab-build"]').click()
        build_url_ok = wait_for_path(page, f"/p/{project_id}/build")
        page.go_back()
        back_ok = wait_for_path(page, f"/p/{project_id}/document")

        # AC: a legacy bookmark lands on the new shape with the run open.
        page.goto(f"{STUDIO_ORIGIN}/runs/{run_id}", wait_until="networkidle")
        redirect_ok = wait_for_path(page, f"/p/{project_id}/build/{run_id}")
        surface = page.locator('[data-testid="mode-surface"]')
        surface.wait_for(timeout=30000)
        run_open = problem[:30] in surface.inner_text()
        page.screenshot(path=str(SHOTS / "slice4-legacy-redirect.png"), full_page=True)

        # AC: /projects/:id keeps working as a bookmark too.
        page.goto(f"{STUDIO_ORIGIN}/projects/{project_id}", wait_until="networkidle")
        project_redirect_ok = wait_for_path(page, f"/p/{project_id}/build")

        browser.close()

    report["steps"]["project_shell"] = {
        "ok": all([
            tab_labels == ["Chat", "Build", "Document", "Video"],
            disabled_ok, placeholder_ok, build_url_ok, back_ok, redirect_ok, run_open,
            project_redirect_ok,
        ]),
        "project_id": project_id,
        "mode_tabs": tab_labels,
        "disabled_mode_titles_enabling_action": disabled_ok,
        "disabled_mode_title": video_title,
        "unavailable_mode_states_enabling_action": placeholder_ok,
        "build_click_changed_url": build_url_ok,
        "back_button_returned": back_ok,
        "legacy_run_redirected": redirect_ok,
        "run_open_after_redirect": run_open,
        "legacy_project_redirected": project_redirect_ok,
        "screenshots": [str(SHOTS / n) for n in
                        ("slice4-mode-switcher.png", "slice4-legacy-redirect.png")],
    }
    if not report["steps"]["project_shell"]["ok"]:
        fail("project_shell_verdict", "slice-4 shell assertions did not all hold — see project_shell")

    # ── 9. Slice 5 (DES-MERGE-001 §6.2): the orchestrator board at / ──────────
    def new_project(name: str) -> str:
        _, _, created = http_json("POST", f"{API}/projects", {"name": name})
        return created["project"]["id"]

    def attach_run(project: str, run: str) -> None:
        http_json(
            "POST", f"{API}/projects/{project}/members",
            {"kind": "crew.run", "ref": run, "attachedBy": "studio"},
        )

    def launch(problem: str, human_confirm: str) -> str:
        _, _, body = http_json("POST", f"{API}/runs", {"problem": problem, "humanConfirm": human_confirm})
        return body["runId"]

    def await_gate(rid: str) -> str:
        deadline = time.time() + 60
        while time.time() < deadline:
            _, _, body = http_json("GET", f"{API}/runs/{rid}")
            if body["run"]["session"]["status"] == "awaiting_human":
                return rid
            time.sleep(0.5)
        fail("board_seed", f"run {rid} never parked on a human gate")
        return rid  # unreachable — fail() exits

    tag = run_id[:8]
    gate_project = new_project(f"board-gate-{tag}")
    attach_run(gate_project, await_gate(launch("board seed: parks on a gate", "all")))
    busy_project = new_project(f"board-busy-{tag}")
    busy_run = launch("board seed: runs unattended", "none")
    attach_run(busy_project, busy_run)
    empty_project = new_project(f"board-empty-{tag}")

    def settled(page, expr: str, arg=None) -> bool:
        """The board sorts once memberships land — poll for the settled state, not the first paint."""
        try:
            page.wait_for_function(expr, arg=arg, timeout=30000)
            return True
        except Exception:
            return False

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        viewport = page.viewport_size

        # AC: with a gate-waiting, a running and an empty project seeded, the FIRST card
        # is the gate-waiting one (§1.4 — sorted by attention, not recency).
        page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
        page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
        gate_first_ok = settled(
            page,
            """id => { const c = document.querySelector('[data-testid="project-card"]');
                       return !!c && c.dataset.projectId === id && c.dataset.attention === 'gate'; }""",
            gate_project,
        )
        first_card = page.locator('[data-testid="project-card"]').first
        gate_chip_ok = "gate" in first_card.inner_text().lower()

        # AC: the empty project's card shows the four quick actions, each pre-bound to it.
        empty_card = page.locator(f'[data-testid="project-card"][data-project-id="{empty_project}"]')
        empty_card.wait_for(timeout=30000)
        actions = empty_card.locator('[data-testid="quick-action"]')
        modes = [actions.nth(i).get_attribute("data-mode") for i in range(actions.count())]
        empty_actions_ok = modes == ["chat", "build", "document", "video"]
        prebound_ok = all(
            actions.nth(i).get_attribute("href") == f"/p/{empty_project}/{m}"
            for i, m in enumerate(modes)
        )
        # §7.5: doc tiles are PLACEHOLDERS — no card mounts a live document.
        no_iframes = page.locator('[data-testid="project-card"] iframe').count() == 0
        page.screenshot(path=str(SHOTS / "slice5-board-attention.png"), full_page=True)

        # AC: 20 more projects stay windowed — the board is bounded by the viewport, and
        # what is MOUNTED is bounded with it (§1.4: legible at ~20 cards).
        for i in range(20):
            new_project(f"board-bulk-{tag}-{i:02d}")
        page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
        board = page.locator('[data-testid="project-board"]')
        board.wait_for(timeout=30000)
        bulk_loaded = settled(
            page,
            """() => Number(document.querySelector('[data-testid="project-board"]')?.dataset.total || 0) >= 20""",
        )
        total = int(board.get_attribute("data-total") or 0)
        rendered = page.locator('[data-testid="project-card"]').count()
        board_box = board.bounding_box() or {"height": 1e9}
        doc_height = page.evaluate("() => document.documentElement.scrollHeight")
        board_bounded = board_box["height"] <= viewport["height"] + 1
        page_bounded = doc_height <= viewport["height"] + 1
        windowed = rendered < total
        page.screenshot(path=str(SHOTS / "slice5-board-windowed.png"), full_page=True)

        browser.close()

    report["steps"]["orchestrator_board"] = {
        "ok": all([
            gate_first_ok, gate_chip_ok, empty_actions_ok, prebound_ok, no_iframes,
            bulk_loaded, board_bounded, page_bounded, windowed,
        ]),
        "gate_project": gate_project,
        "busy_project": busy_project,
        "busy_run": busy_run,
        "empty_project": empty_project,
        "gate_waiting_sorted_first": gate_first_ok,
        "gate_state_on_card": gate_chip_ok,
        "empty_card_quick_actions": modes,
        "quick_actions_prebound_to_project": prebound_ok,
        "doc_tiles_are_placeholders_no_iframe": no_iframes,
        "projects_total": total,
        "cards_mounted": rendered,
        "board_height_px": board_box["height"],
        "viewport_height_px": viewport["height"],
        "document_scroll_height_px": doc_height,
        "board_height_bounded_by_viewport": board_bounded,
        "page_does_not_grow_with_projects": page_bounded,
        "virtualized_fewer_cards_than_projects": windowed,
        "screenshots": [str(SHOTS / n) for n in
                        ("slice5-board-attention.png", "slice5-board-windowed.png")],
    }
    if not report["steps"]["orchestrator_board"]["ok"]:
        fail("orchestrator_board_verdict", "slice-5 board assertions did not all hold — see orchestrator_board")

    report["ok"] = True
    print(json.dumps(report, indent=2))
finally:
    daemon.terminate()
    httpd.shutdown()
