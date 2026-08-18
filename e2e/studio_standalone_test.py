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
  7. (DES-MERGE-001 slice 4, as slice 13 left it) the project shell:
     /p/:projectId/:mode renders the four-mode switcher, every mode is a live tab
     whose tooltip names what it is, a deep-linked mode states a subject rather than
     spinning, clicking Build is a real (back-button-correct) navigation, and the
     pre-merge /runs/:id and /projects/:id bookmarks redirect into the new shape
  8. (DES-MERGE-001 slice 5) the orchestrator board at /: the gate-waiting project
     sorts first, an empty project's card IS its four quick actions (each pre-bound
     to that project), doc tiles are placeholders rather than iframes (§7.5), and
     20+ projects stay windowed inside a viewport-bounded board
  9. (DES-MERGE-001 slice 6) that board is LIVE: while the page sits on `/` and
     never reloads, a real gate arrival re-sorts a card ahead of another, a
     `unitOutputDelta` updates that card's headline within 2 s while its neighbour
     is untouched, and a relayed `wicked.interactive.status.posted` adds a doc
     activity line — all over the page's ONE existing socket
 10. (DES-MERGE-001 slice 7) gate chips on that board are ANSWERABLE: a SIMPLE gate
     (§7.11) is approved inline and the run advances on the same page with no
     navigation, while a COMPLEX one deep-links to the thread with the gate message
     scrolled into view and focused
 11. (DES-MERGE-001 slice 8, as tightened by slice 12) Document mode renders the
     canvas: a seeded doc frames and its scripts run — re-derived from the browser's
     FRAME TREE, because slice 12 made `contentDocument` null on purpose and the
     parent asserting that null IS the security claim — the frame carries the §5.5
     sandbox with `allow-same-origin` gone, its request shares the PAGE's origin, the
     picker orders most-recent-first and navigates, and a bridge_unavailable 503 shows
     its hint verbatim. This one section runs against a SECOND, same-origin build
     (see §12 in the body).
 12. (DES-MERGE-001 slice 9) the version strip on that same rig: a 3-version doc
     shows 3 entries oldest→newest with the routed one highlighted, selecting v1
     swaps the frame to the v1 URL (and Back rewinds it), §7.6's scroll affordance
     is disabled-with-a-reason where the anchor is null, and Fork from v1 creates a
     4th version whose parent is 1 — asserted through the API, labelled in the UI.
 13. (DES-MERGE-001 slice 10) the ONE conversation in Document mode, on that same rig:
     the thread mounts beside the canvas with a single composer; typing while idle
     creates the doc-generation run (the message and an informative run opening land
     in the transcript, the anchor id riding with the request); typing while generating
     injects steering with the chip visible; the whole whimsy list pushed over a
     generation window renders NOTHING while real narration lands, and no
     `status.requested` heartbeat is ever emitted; and a landed version tags the
     message that triggered it (§7.6).
 14. (DES-MERGE-001 slices 11+12, merged per §7.3) point-and-comment, on a frame the
     overlay could never have shipped without: `sandbox="allow-scripts"` and nothing
     else, with a fixture document that speaks the postMessage instrument bridge. A
     script inside that document reaching for `parent.localStorage` THROWS (isolation
     proven from the inside, not asserted from outside); clicking a `[data-wid]`
     heading opens the comment box within 4 px of the rect the browser's own frame
     tree reports; two comments submit as ONE thread message carrying both, ONE
     `feedback.submitted` event and ONE inject; each submitted item deep-links back to
     its element over the protocol; and an inject the bridge refuses leaves the batch
     standing with a retryable "not recorded" chip (§7.7).
 15. (DES-MERGE-001 slice 13) Video mode on that same rig: the picker lists the
     registry's DEMOS most-recent-first (and none of its documents), a seeded demo
     shows N chapter cards matching its spec's N steps in order, clicking chapter 3
     moves the player to that step's timestamp, the player renders the service's own
     recording bytes fetched through the proxy, and the ffmpeg-absent demo shows the
     service's install command VERBATIM while still rendering its full storyboard —
     degradation, not a crash (§4.5).
 16. (operator UX directive) the LIVE EDGE is the active-work signal, and it is
     ranked: in one DOM snapshot an executing card carries the breathing 2px
     `live-edge` element while a gate-waiting card carries a treatment that is
     present at the same time and different in computed pixels (wider, solid,
     accent-coloured, unanimated), the run chip inside the executing card carries
     the same edge, and under prefers-reduced-motion the animation is replaced by
     a wider solid edge rather than dropped.

The daemon is the ONE thing this repo cannot supply. Point CREW_CLI at a built
crew CLI entry (`.../packages/crew/dist/cli/index.js`); it defaults to the sibling
checkout layout (`../wicked-crew/packages/crew/dist/cli/index.js`). The daemon runs
with `--stub` (deterministic offline engine) and a throwaway db.

Prereqs:  a built crew daemon (see CREW_CLI), Python Playwright
(`pip install playwright && playwright install chromium`). The script builds the
studio itself unless SKIP_STUDIO_BUILD=1 (in which case dist/ must already be
baked for CREW_PORT).

Env knobs: CREW_CLI, CREW_PORT (default 7901), STUDIO_PORT (default 4310),
DOC_PORT (default 4320, the same-origin rig for §12-§16), SKIP_STUDIO_BUILD,
SLICE10_WINDOW_S (default 10, the generation window §13 pushes filler across).

Prints a JSON report to stdout (exit 0/1); screenshots land in e2e/shots/.
Operator-run smoke — though it spends no tokens (stub engine, no real CLI seats).
"""

import base64
import hashlib
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
DOC_PORT = int(os.environ.get("DOC_PORT", "4320"))
CREW_CLI = Path(
    os.environ.get(
        "CREW_CLI",
        REPO.parent / "wicked-crew" / "packages" / "crew" / "dist" / "cli" / "index.js",
    )
)
CREW_ORIGIN = f"http://127.0.0.1:{CREW_PORT}"
STUDIO_ORIGIN = f"http://127.0.0.1:{STUDIO_PORT}"
DOC_ORIGIN = f"http://127.0.0.1:{DOC_PORT}"
API = f"{CREW_ORIGIN}/api/v1"
NPM = "npm.cmd" if os.name == "nt" else "npm"

report: dict = {"ok": False, "steps": {}}


# Gate toasts from the runs earlier sections seeded are pinned bottom-right and overlap
# the Document-mode composer. They are not this section's surface — same spirit as the
# `fonts.g` console filter — so the doc sections suppress them rather than fight them.
# Hiding is display-only: nothing about the asserted behaviour changes.
HIDE_GATE_TOASTS = '[data-testid="gate-notification"] { display: none !important; }'

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

        # This section asserts the SHELL, not whatever surface sits under it. Every mode
        # became a live surface by slice 13, so there is no longer an inert one to land
        # on: the shell claims are made on Video (whose own surface §16 owns) and the
        # surface's own calls are simply not this section's subject.
        page.goto(f"{STUDIO_ORIGIN}/p/{project_id}/video", wait_until="networkidle")
        switcher = page.locator('[data-testid="mode-switcher"]')
        switcher.wait_for(timeout=30000)
        tabs = switcher.locator('[role="tab"]')
        tab_labels = [tabs.nth(i).inner_text() for i in range(tabs.count())]

        # AC (§1.3 rule 3, as slice 13 left it): a mode is never HIDDEN, and its tooltip
        # names what it is, with its subject. The disabled branch retired with the
        # placeholder — every verb now has a surface, and a missing dependency is stated
        # where it bites (§16) instead of greying out the whole mode. A mode that
        # genuinely cannot open is slice 17's preflight gate.
        video = page.locator('[data-testid="mode-tab-video"]')
        video_title = video.get_attribute("title") or ""
        tabs_live_ok = (
            all(tabs.nth(i).is_enabled() for i in range(tabs.count()))
            and re.search(r"storyboard", video_title, re.I) is not None
        )
        # The deep-linked mode states a subject either way (§3.3: no bare spinner). This
        # rig has no bridge behind it, so the named failure IS that state.
        surface_named_ok = page.locator(
            '[data-testid="video-canvas-error"], [data-testid="video-canvas-loading"], '
            '[data-testid="demo-picker"], [data-testid="demo-picker-empty"]'
        ).first.is_visible()
        page.screenshot(path=str(SHOTS / "slice4-mode-switcher.png"), full_page=True)

        # AC: clicking Build changes the URL, and the back button returns.
        page.locator('[data-testid="mode-tab-build"]').click()
        build_url_ok = wait_for_path(page, f"/p/{project_id}/build")
        page.go_back()
        back_ok = wait_for_path(page, f"/p/{project_id}/video")

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
            tabs_live_ok, surface_named_ok, build_url_ok, back_ok, redirect_ok, run_open,
            project_redirect_ok,
        ]),
        "project_id": project_id,
        "mode_tabs": tab_labels,
        "every_mode_tab_live_and_named": tabs_live_ok,
        "video_tab_title": video_title,
        "deep_linked_mode_states_a_subject": surface_named_ok,
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

    # ── 10. Slice 6 (DES-MERGE-001 §6.2): the board goes LIVE ─────────────────
    # Every assertion below happens on ONE page load: the browser lands on `/` once
    # and is never navigated or reloaded again, which is the property slice 6 exists
    # to prove ("a card updates in place while the user is looking at a different
    # card", §1.4).
    #
    # Two frame sources, deliberately:
    #   - the GATE re-sort is driven by the real daemon (a run genuinely parks on a
    #     human gate while the page watches), because attention order is derived from
    #     run state and a faked frame would prove nothing about it;
    #   - the DELTA and the relayed interactive frame are delivered into the page's
    #     own socket handler through a WebSocket tap installed as an init script. The
    #     page still opens exactly one real socket to the daemon (asserted), and the
    #     frame travels the full app path — onmessage → runtime store → card. The tap
    #     is how a *specific* frame gets delivered on demand: the stub engine's own
    #     deltas are not addressable, and crew's `interactiveEvent` relay (slice 3)
    #     is not merged yet, so this is the only way to exercise its envelope.
    WS_TAP = """
      (() => {
        const Real = window.WebSocket;
        class TapWS extends Real {
          constructor(...args) {
            super(...args);
            window.__pushFrame = (frame) =>
              this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
          }
        }
        window.WebSocket = TapWS;
      })();
    """

    CARD_INDEX = """id => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
                             .findIndex(c => c.dataset.projectId === id)"""
    LIVE_LINE = """id => { const c = document.querySelector(
                             `[data-testid="project-card"][data-project-id="${id}"]`);
                           return c?.querySelector('[data-testid="live-line"]')?.textContent ?? null; }"""

    def within(page, expr, arg=None, budget_ms: int = 2000):
        """Assert a DOM condition holds within `budget_ms`, and report what it took."""
        started = time.time()
        try:
            page.wait_for_function(expr, arg=arg, timeout=budget_ms)
            return True, round((time.time() - started) * 1000)
        except Exception:
            return False, round((time.time() - started) * 1000)

    # A is created FIRST and parks on a gate; B is created SECOND (so it wins the
    # updated_at tiebreak once it too has a gate) and starts with no runs at all.
    live_a = new_project(f"live-a-{tag}")
    attach_run(live_a, await_gate(launch("slice6: parks on a gate and stays there", "all")))
    live_b = new_project(f"live-b-{tag}")

    live_ws_urls: list[str] = []
    live_console: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.add_init_script(WS_TAP)
        page.on("websocket", lambda ws: live_ws_urls.append(ws.url))
        page.on("console", lambda m: live_console.append(m.text) if m.type == "error" else None)

        page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
        page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
        page.wait_for_function("() => typeof window.__pushFrame === 'function'", timeout=30000)
        # A sentinel on the window: any navigation or reload from here on wipes it, so
        # every assertion below is provably about THIS page load.
        page.evaluate("() => { window.__slice6 = 'same page'; }")

        both_visible = settled(
            page,
            """ids => ids.every(id => document.querySelector(
                 `[data-testid="project-card"][data-project-id="${id}"]`))""",
            [live_a, live_b],
        )
        a_before = page.evaluate(CARD_INDEX, live_a)
        b_before = page.evaluate(CARD_INDEX, live_b)
        board_scroll_before = page.evaluate(
            """() => document.querySelector('[data-testid="project-board"]').scrollTop""")

        # ── AC: a gate arrival re-sorts the board, no navigation, no reload ────
        # The run is launched and filed while the page watches; the board has to pick
        # up both the new membership and, moments later, the gate it parks on.
        rb = launch("slice6: gates while the board is watching", "all")
        attach_run(live_b, rb)
        chip_ok = settled(
            page,
            """id => !!document.querySelector(
                 `[data-testid="project-card"][data-project-id="${id}"] [data-testid="run-chip"]`)""",
            live_b,
        )
        await_gate(rb)
        resorted, resort_ms = within(
            page,
            """ids => { const cards = Array.from(document.querySelectorAll('[data-testid="project-card"]'))
                          .map(c => c.dataset.projectId);
                        const [a, b] = ids;
                        return cards.indexOf(b) >= 0 && cards.indexOf(b) < cards.indexOf(a); }""",
            [live_a, live_b],
            budget_ms=5000,  # includes the run-list reconcile the gate frame triggers
        )
        a_after_gate = page.evaluate(CARD_INDEX, live_a)
        b_after_gate = page.evaluate(CARD_INDEX, live_b)
        page.screenshot(path=str(SHOTS / "slice6-board-gate-resort.png"), full_page=True)

        # ── AC: a delta for B updates B's headline within 2 s; A is unchanged ──
        _, _, rb_view = http_json("GET", f"{API}/runs/{rb}")
        units = rb_view["run"]["units"]
        ix = rb_view["run"]["session"]["unit_ix"]
        ord_ = units[ix]["ord"] if ix < len(units) else 0
        headline = "Writing the acceptance criteria for AC-3"
        a_line_before = page.evaluate(LIVE_LINE, live_a)
        b_line_before = page.evaluate(LIVE_LINE, live_b)
        page.evaluate(
            """args => window.__pushFrame(
                 { type: 'unitOutputDelta', session: args.run, ord: args.ord, text: args.text + '\\n' })""",
            {"run": rb, "ord": ord_, "text": headline},
        )
        headline_ok, headline_ms = within(
            page,
            """args => { const c = document.querySelector(
                           `[data-testid="project-card"][data-project-id="${args.id}"]`);
                         return (c?.querySelector('[data-testid="live-line"]')?.textContent ?? '')
                           .includes(args.text); }""",
            {"id": live_b, "text": headline},
        )
        a_line_after = page.evaluate(LIVE_LINE, live_a)
        a_card_text = page.evaluate(
            """id => document.querySelector(
                 `[data-testid="project-card"][data-project-id="${id}"]`)?.innerText ?? ''""",
            live_a,
        )
        a_untouched = a_line_after == a_line_before and headline not in a_card_text
        page.screenshot(path=str(SHOTS / "slice6-board-live-headline.png"), full_page=True)

        # ── AC: a relayed wicked.interactive.status.posted lands on its project ─
        doc_status = "Rewriting slide 3 — tightening the headline"
        page.evaluate(
            """args => window.__pushFrame({ type: 'interactiveEvent', event: {
                 event_type: 'wicked.interactive.status.posted',
                 payload: { project_id: args.id, document_id: 'launch-deck', message: args.text } } })""",
            {"id": live_b, "text": doc_status},
        )
        doc_ok, doc_ms = within(
            page,
            """args => { const c = document.querySelector(
                           `[data-testid="project-card"][data-project-id="${args.id}"]`);
                         return (c?.querySelector('[data-testid="doc-activity"]')?.textContent ?? '')
                           .includes(args.text); }""",
            {"id": live_b, "text": doc_status},
        )

        # The live region is new furniture inside a FIXED-height card, and the quick
        # actions are bottom-anchored inside `overflow: hidden` — so a height that
        # merely fit would silently clip the primary affordance. Measured, not eyeballed.
        clipped = page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
                 .filter(c => c.scrollHeight > c.clientHeight + 1)
                 .map(c => `${c.dataset.projectId}:${c.scrollHeight}>${c.clientHeight}`)""")
        same_page = page.evaluate("() => window.__slice6 === 'same page'")
        board_scroll_after = page.evaluate(
            """() => document.querySelector('[data-testid="project-board"]').scrollTop""")
        page.screenshot(path=str(SHOTS / "slice6-board-doc-activity.png"), full_page=True)
        browser.close()

    # One socket for the whole surface (§3.5) — the board did not open its own.
    one_socket = len([u for u in live_ws_urls if "/ws" in u]) == 1

    report["steps"]["board_live"] = {
        "ok": all([
            both_visible, chip_ok, resorted, b_after_gate < a_after_gate, b_before > a_before,
            headline_ok, a_untouched, doc_ok, same_page, one_socket,
            board_scroll_before == board_scroll_after, not clipped,
        ]),
        "project_a": live_a,
        "project_b": live_b,
        "run_b": rb,
        "both_cards_mounted": both_visible,
        "card_order_before_gate": {"a": a_before, "b": b_before},
        "launched_run_reached_card_without_reload": chip_ok,
        "gate_moved_b_ahead_of_a": resorted,
        "card_order_after_gate": {"a": a_after_gate, "b": b_after_gate},
        "gate_resort_ms": resort_ms,
        "b_headline_before": b_line_before,
        "b_headline_updated_within_2s": headline_ok,
        "headline_update_ms": headline_ms,
        "card_a_unchanged": a_untouched,
        "card_a_headline": a_line_after,
        "doc_activity_within_2s": doc_ok,
        "doc_activity_ms": doc_ms,
        "no_navigation_or_reload": same_page,
        "cards_clipped_by_fixed_height": clipped,
        "board_scroll_unchanged": board_scroll_before == board_scroll_after,
        "one_ws_subscription": one_socket,
        "ws_urls": live_ws_urls,
        "console_errors": live_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice6-board-gate-resort.png", "slice6-board-live-headline.png",
                         "slice6-board-doc-activity.png")],
    }
    if not report["steps"]["board_live"]["ok"]:
        fail("board_live_verdict", "slice-6 live-board assertions did not all hold — see board_live")

    # ── 11. Slice 7 (DES-MERGE-001 §6.2): answerable gate chips on the board ──
    # Two gates, two shapes (§7.11 — "the AC asserts both shapes via fixtures"):
    #   - SIMPLE is the gate crew actually raises: a prompt-only payload, whose two
    #     answers are the two `POST /runs/:id/gate` accepts. Answered inline, on `/`.
    #   - COMPLEX is a payload that names more than two choices. Crew does not send
    #     one yet, so it is delivered through the same WebSocket tap slice 6 uses —
    #     a real `awaitingHuman` frame for a run that IS genuinely parked on a gate,
    #     travelling the full app path (onmessage → gate store → card).
    simple_project = new_project(f"slice7-simple-{tag}")
    simple_run = await_gate(launch("slice7: a simple gate, answered from the board", "all"))
    attach_run(simple_project, simple_run)
    complex_project = new_project(f"slice7-complex-{tag}")
    complex_run = await_gate(launch("slice7: a gate that needs the thread", "all"))
    attach_run(complex_project, complex_run)

    slice7_console: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.add_init_script(WS_TAP)
        page.on("console", lambda m: slice7_console.append(m.text) if m.type == "error" else None)

        page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
        page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
        page.wait_for_function("() => typeof window.__pushFrame === 'function'", timeout=30000)
        # Same sentinel discipline as slice 6: any navigation or reload wipes it.
        page.evaluate("() => { window.__slice7 = 'same page'; }")

        # ── AC: a simple gate is answered ON the board, and the run advances there ─
        approve = page.locator(f'[data-testid="gate-approve-{simple_run}"]')
        approve.wait_for(timeout=30000)
        # §1.4: the chip is a CONTROL, not a badge — and a simple gate never sends the
        # user to the thread to answer it.
        inline_ok = (
            page.locator(f'[data-testid="gate-reject-{simple_run}"]').count() == 1
            and page.locator(f'[data-testid="gate-open-{simple_run}"]').count() == 0
        )
        approve.click()
        # Disabled while the POST is open — the double-submit guard, visible (§3.3).
        disabled_ok, _ = within(
            page,
            """id => { const b = document.querySelector(`[data-testid="gate-approve-${id}"]`);
                       return b === null || b.disabled; }""",
            simple_run,
            budget_ms=3000,
        )
        advanced_ok, advance_ms = within(
            page,
            """id => { const chip = document.querySelector(`[data-testid="run-chip"][data-run-id="${id}"]`);
                       return !!chip && chip.dataset.status !== 'awaiting_human'; }""",
            simple_run,
            budget_ms=20000,  # gate decision → resume → run-list reconcile (400 ms debounce)
        )
        chip_status = page.evaluate(
            """id => document.querySelector(
                 `[data-testid="run-chip"][data-run-id="${id}"]`)?.dataset.status ?? null""",
            simple_run,
        )
        no_nav_ok = (
            page.evaluate("() => window.__slice7 === 'same page'")
            and urllib.parse.urlparse(page.url).path == "/"
        )
        _, _, simple_final = http_json("GET", f"{API}/runs/{simple_run}")
        simple_rest_status = simple_final["run"]["session"]["status"]
        page.screenshot(path=str(SHOTS / "slice7-board-gate-answered.png"), full_page=True)

        # ── AC: a complex gate's chip navigates to the thread, message focused ────
        page.evaluate(
            """args => window.__pushFrame({ type: 'awaitingHuman', session: args.run, ord: args.ord,
                 prompt: args.prompt, choices: ['ship it', 'rework the plan', 'split the slice'] })""",
            {"run": complex_run, "ord": 0, "prompt": "Which way should this go?"},
        )
        open_chip = page.locator(f'[data-testid="gate-open-{complex_run}"]')
        open_chip.wait_for(timeout=30000)
        deep_link = open_chip.get_attribute("href")
        # A card cannot answer a question that needs prose — so it does not offer to.
        complex_shape_ok = (
            page.locator(f'[data-testid="gate-approve-{complex_run}"]').count() == 0
            and deep_link == f"/p/{complex_project}/build/{complex_run}#gate"
        )
        open_chip.click()
        deep_link_ok = wait_for_path(page, f"/p/{complex_project}/build/{complex_run}")
        focus_ok, focus_ms = within(
            page,
            """() => document.activeElement?.dataset?.testid === 'steering-prompt'""",
            budget_ms=30000,
        )
        # Focused AND in view (§6.2: "scrolled into view and focused"), and the one-shot
        # intent is consumed so the live thread cannot keep yanking focus back.
        in_view = page.evaluate(
            """() => { const el = document.querySelector('[data-testid="steering-prompt"]');
                       if (!el) return false;
                       const r = el.getBoundingClientRect();
                       return r.top >= 0 && r.bottom <= window.innerHeight; }""")
        hash_consumed = page.evaluate("() => window.location.hash === ''")
        page.screenshot(path=str(SHOTS / "slice7-gate-deep-link.png"), full_page=True)
        browser.close()

    report["steps"]["gate_chips"] = {
        "ok": all([
            inline_ok, disabled_ok, advanced_ok, no_nav_ok,
            simple_rest_status != "awaiting_human",
            complex_shape_ok, deep_link_ok, focus_ok, in_view, hash_consumed,
        ]),
        "simple_project": simple_project,
        "simple_run": simple_run,
        "complex_project": complex_project,
        "complex_run": complex_run,
        "simple_gate_answerable_inline": inline_ok,
        "chip_disabled_in_flight": disabled_ok,
        "run_advanced_on_the_board": advanced_ok,
        "advance_ms": advance_ms,
        "chip_status_after_approve": chip_status,
        "status_via_rest_after_approve": simple_rest_status,
        "no_navigation_or_reload": no_nav_ok,
        "complex_gate_deep_links_only": complex_shape_ok,
        "complex_gate_href": deep_link,
        "navigated_to_thread": deep_link_ok,
        "gate_message_focused": focus_ok,
        "focus_ms": focus_ms,
        "gate_message_in_view": in_view,
        "focus_intent_consumed": hash_consumed,
        "console_errors": slice7_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice7-board-gate-answered.png", "slice7-gate-deep-link.png")],
    }
    if not report["steps"]["gate_chips"]["ok"]:
        fail("gate_chips_verdict", "slice-7 gate-chip assertions did not all hold — see gate_chips")

    # ── 12. Slice 8 (DES-MERGE-001 §6.3): the Document-mode canvas ────────────
    # This slice's AC is an ORIGIN claim — "the frame's request URL shares the page's
    # origin" — and the cross-origin rig above cannot express it: that dist has
    # VITE_API_HOST baked, so `apiBase()` points at the daemon (:7901) while the page is
    # served from :4310. So this section stands up the PRODUCTION posture §5.3 describes:
    # a second build with NO VITE_API_HOST (so `apiBase()` derives from window.location)
    # served from ONE origin that also answers the project-scoped interactive paths with a
    # FAKE BRIDGE — fixture docs, fixture manifests, a fixture rendered document, and a
    # `bridge_unavailable` project — and forwards every other /api/v1 call to the REAL
    # daemon. Nothing about the merged crew proxy is stubbed away except the bridge itself.
    same_origin_dist = REPO / "dist-sameorigin"
    if os.environ.get("SKIP_STUDIO_BUILD") == "1":
        if not (same_origin_dist / "index.html").is_file():
            fail("doc_canvas_build",
                 f"SKIP_STUDIO_BUILD=1 but {same_origin_dist}/index.html is missing — "
                 "build it with `npx vite build --outDir dist-sameorigin` (no VITE_API_HOST)")
    else:
        env = dict(os.environ, VITE_API_HOST="")  # empty ⇒ the resolver falls back to window.location
        r = subprocess.run(
            [NPM, "exec", "--", "vite", "build", "--outDir", "dist-sameorigin", "--emptyOutDir"],
            cwd=REPO, env=env, capture_output=True, text=True, timeout=600,
        )
        if r.returncode != 0:
            fail("doc_canvas_build", f"same-origin vite build failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")

    doc_project = new_project(f"doc-canvas-{tag}")
    down_project = new_project(f"doc-bridge-down-{tag}")
    demo_project = new_project(f"demo-video-{tag}")  # §16's subject (slice 13)

    # Deliberately NOT in recency order — the picker must sort, not echo (§6.3).
    FIXTURE_DOCS = [
        {"name": "stale-brief", "kind": "doc", "head": 1, "versions": 1, "updated_at": "2026-08-10T08:00:00Z"},
        {"name": "launch-deck", "kind": "doc", "head": 2, "versions": 2, "updated_at": "2026-08-18T11:30:00Z"},
        {"name": "q3-report", "kind": "doc", "head": 1, "versions": 1, "updated_at": "2026-08-17T16:00:00Z"},
        # Slice 9's subject: three versions, one of them ANCHORED to a thread message
        # (§7.6) and two with a null anchor, which is what every pre-merge doc looks like.
        {"name": "roadmap", "kind": "doc", "head": 3, "versions": 3, "updated_at": "2026-08-05T08:00:00Z"},
    ]
    STRIP_DOC = "roadmap"
    ANCHORED_MESSAGE = "msg-v3"

    # ── Slice 13's seed (§4.5): demos live in the SAME registry as documents, keyed by
    # `kind: "demo"`. They are scoped to their own project so §12's picker order (a
    # merged AC) keeps asserting exactly the four documents it was written against — and
    # so the video picker's filter is provable: DEMO_PROJECT's registry carries a
    # document too, and Video mode must not list it.
    RECORDED_DEMO = "checkout-walkthrough"
    FFMPEG_DEMO = "flaky-render"
    FIXTURE_DEMOS = [
        {"name": "onboarding-tour", "kind": "demo", "head": 1, "versions": 1, "updated_at": "2026-08-12T09:00:00Z"},
        {"name": RECORDED_DEMO, "kind": "demo", "head": 2, "versions": 2, "updated_at": "2026-08-18T13:00:00Z"},
        {"name": FFMPEG_DEMO, "kind": "demo", "head": 1, "versions": 1, "updated_at": "2026-08-16T10:00:00Z"},
    ]
    # The agent authors the spec; the service executes it (ADR-0018). Chapter offsets are
    # STEP BOUNDARIES — the storyboard's only authority on where chapter N begins.
    DEMO_STEPS = [
        {"index": 0, "title": "Open the storefront", "timestamp": 0},
        {"index": 1, "title": "Add a hoodie to the cart", "timestamp": 6.5},
        {"index": 2, "title": "Enter the card details", "timestamp": 12},
        {"index": 3, "title": "Confirm the order", "timestamp": 21.25},
        {"index": 4, "title": "Land on the receipt", "timestamp": 27},
    ]
    DEMO_GIF_PATH = f"/d/{RECORDED_DEMO}/demo/v2.gif"
    # A real 1×1 GIF: the player must render the SERVICE's bytes, fetched through the
    # proxy on the page's own origin — not a data: URL the SPA could have invented.
    TINY_GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
    # §4.5: ffmpeg post-processing is best-effort, so the VERSION still landed and the
    # service names the command that fixes it. Studio shows this string verbatim.
    FFMPEG_HINT = ("ffmpeg is not on PATH — install it (macOS: `brew install ffmpeg`, "
                   "Debian/Ubuntu: `sudo apt install ffmpeg`) and record again")
    record_requests: list[str] = []
    DEMO_SPEC_RE = re.compile(r"^/d/([^/]+)/api/demo/spec$")
    DEMO_REC_RE = re.compile(r"^/d/([^/]+)/api/demo/recordings$")
    DEMO_RECORD_RE = re.compile(r"^/d/([^/]+)/api/demo/record$")

    def seed_versions(name: str) -> list[dict]:
        head = next(d["head"] for d in FIXTURE_DOCS if d["name"] == name)
        rows = [{"version": v, "parent": v - 1 or None, "feedback_file": None,
                 "html_file": f"v{v}.html", "created_at": f"2026-08-1{v}T11:30:00Z"}
                for v in range(1, head + 1)]
        if name == STRIP_DOC:  # only the newest version carries an anchor
            rows[-1]["meta"] = {"sourceMessageId": ANCHORED_MESSAGE}
        return rows

    # The manifest is the SERVICE's, and fork mutates it — so the fixture holds real
    # state (append-only, per INV-4) rather than deriving a fresh list per request.
    doc_versions = {d["name"]: seed_versions(d["name"]) for d in FIXTURE_DOCS}
    versions_lock = threading.Lock()
    # Slice 10's two composer wires, recorded verbatim so the run can assert WHICH wire
    # each composer state chose — and that no `status.requested` heartbeat is ever among
    # them (§3.2's second deletion is a claim about what the client does NOT send).
    created_docs: list[dict] = []
    emitted_events: list[dict] = []
    BRIDGE_DOWN_HINT = ("run `npx wicked-interactive serve` in this project's root — "
                        "the bridge could not be started")
    # A phrase the fake bridge refuses to inject, so §15 can drive §7.7's failure path.
    INJECT_FAIL_MARK = "unrecordable"
    # The bus event interactive's feedbackStore.js has always emitted — contract unchanged
    # by the merge (§7.7); what changed is that the CLIENT authors it alongside the inject.
    FEEDBACK_EVENT = "wicked.interactive.feedback.submitted"
    # The FIXTURE BRIDGE (slices 11+12): `data-wid` anchors plus the postMessage bridge
    # that core/instrument.js injects in production (§5.5), kept in a real .html file so
    # the browser fixture is one artifact rather than a Python string literal. It also
    # carries the isolation probe: a script reaching for `parent.localStorage`, whose
    # verdict it writes into its own DOM — the parent can no longer evaluate in here to ask.
    DOC_HTML = (REPO / "e2e" / "fixtures" / "doc-fixture.html").read_text(encoding="utf-8")
    INTERACTIVE_RE = re.compile(r"^/api/v1/projects/([^/]+)/interactive(/.*)$")
    VERSIONS_RE = re.compile(r"^/d/([^/]+)/api/versions$")
    RENDER_RE = re.compile(r"^/d/([^/]+)/doc/(\d+)$")
    FORK_RE = re.compile(r"^/d/([^/]+)/api/fork$")
    WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    class DocFixtureHandler(SimpleHTTPRequestHandler):
        """SPA + fake bridge + daemon passthrough, all on ONE origin."""

        def log_message(self, *_args):  # keep stdout JSON-clean
            pass

        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload) -> None:
            self._send(status, json.dumps(payload).encode(), "application/json")

        def _ws_idle(self) -> None:
            """Accept the SPA's /ws upgrade and hold it open. This section asserts that
            the canvas produces NO console errors, and a refused handshake is one."""
            key = self.headers.get("Sec-WebSocket-Key", "")
            accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            self.wfile.write(
                ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                 f"Connection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").encode())
            self.wfile.flush()
            try:
                while self.rfile.read(1):
                    pass
            except OSError:
                pass
            self.close_connection = True

        def _proxy(self) -> None:
            """Everything the fake bridge does not own is the REAL daemon's."""
            length = int(self.headers.get("Content-Length") or 0)
            req = urllib.request.Request(
                CREW_ORIGIN + self.path, data=self.rfile.read(length) if length else None,
                method=self.command)
            if self.headers.get("Content-Type"):
                req.add_header("Content-Type", self.headers["Content-Type"])
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    self._send(res.status, res.read(),
                               res.headers.get("Content-Type", "application/json"))
            except urllib.error.HTTPError as e:
                self._send(e.code, e.read(), e.headers.get("Content-Type", "application/json"))
            except Exception as e:  # noqa: BLE001 — surface it as a body, not a traceback
                self._json(502, {"error": str(e)})

        def _bridge(self, project: str, rest: str) -> bool:
            # §7.12: a project whose bridge cannot start answers 503 with a NAMED command.
            if project == down_project:
                self._json(503, {"code": "bridge_unavailable", "hint": BRIDGE_DOWN_HINT})
                return True
            if rest == "/api/docs":
                # ONE registry (§4.5): the demo project's rows carry documents too, and
                # Video mode is what narrows them to `kind: "demo"`.
                self._json(200, FIXTURE_DOCS + FIXTURE_DEMOS
                           if project == demo_project else FIXTURE_DOCS)
                return True
            m = DEMO_SPEC_RE.match(rest)
            if m:
                self._json(200, {"steps": DEMO_STEPS, "target_url": "https://shop.example/"})
                return True
            m = DEMO_REC_RE.match(rest)
            if m:
                # Two demos, two states: one recorded (gif only — ffmpeg produced no mp4
                # on this box either, which is the common case), one whose post-process
                # found no ffmpeg at all. Both are 200s: the VERSION landed regardless.
                self._json(200,
                           {"version": 1, "ffmpeg_absent": True, "ffmpeg_hint": FFMPEG_HINT}
                           if urllib.parse.unquote(m.group(1)) == FFMPEG_DEMO
                           else {"version": 2, "gif_url": DEMO_GIF_PATH})
                return True
            if rest == DEMO_GIF_PATH:
                self._send(200, TINY_GIF, "image/gif")
                return True
            m = VERSIONS_RE.match(rest)
            if m:
                name = urllib.parse.unquote(m.group(1))
                with versions_lock:
                    rows = list(doc_versions.get(name, []))
                if not rows:
                    self._json(404, {"error": f"no such doc: {name}"})
                else:
                    self._json(200, {"head": max(r["version"] for r in rows),
                                     "kind": "doc", "versions": rows})
                return True
            m = RENDER_RE.match(rest)
            if m:
                html = (DOC_HTML.replace("__DOC__", urllib.parse.unquote(m.group(1)))
                                .replace("__V__", m.group(2)))
                self._send(200, html.encode(), "text/html; charset=utf-8")
                return True
            return False

        def do_GET(self):  # noqa: N802 (stdlib naming)
            if self.headers.get("Upgrade", "").lower() == "websocket":
                return self._ws_idle()
            path = urllib.parse.urlparse(self.path).path
            m = INTERACTIVE_RE.match(path)
            if m and self._bridge(urllib.parse.unquote(m.group(1)), m.group(2)):
                return None
            if path.startswith("/api/v1/"):
                return self._proxy()
            if not Path(self.translate_path(self.path)).is_file():
                self.path = "/index.html"  # client-side routes resolve to the shell
            return super().do_GET()

        def _fork(self, name: str) -> None:
            """`POST /d/:docId/api/fork` — branch, append (never mutate: INV-4), report
            the new version and its PARENT. The UI asserts lineage through this reply,
            not by predicting what the branch produced."""
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            parent = body.get("from")
            with versions_lock:
                rows = doc_versions.get(name)
                if not rows or not any(r["version"] == parent for r in rows):
                    return self._json(400, {"error": f"cannot fork {name} from {parent!r}"})
                created = max(r["version"] for r in rows) + 1
                rows.append({"version": created, "parent": parent, "feedback_file": None,
                             "html_file": f"v{created}.html",
                             "created_at": "2026-08-18T12:00:00Z"})
            return self._json(200, {"version": created, "parent": parent})

        def _body(self) -> dict:
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")

        def _create_doc(self, project: str) -> None:
            """`POST /api/docs` — the IDLE composer's wire (§2.2 case 1). The message is
            the brief; the bridge slugifies the derived name and opens generation."""
            body = self._body()
            body["_project_path"] = project
            created_docs.append(body)
            slug = re.sub(r"[^a-z0-9]+", "-", (body.get("name") or "untitled").lower()).strip("-")
            with versions_lock:
                doc_versions.setdefault(slug, [{
                    "version": 1, "parent": None, "feedback_file": None, "html_file": "v1.html",
                    "created_at": "2026-08-18T12:05:00Z",
                    "meta": {"sourceMessageId": body.get("source_message_id")},
                }])
            return self._json(200, {"name": slug, "head": 1, "kind": "doc",
                                    "generating": True, "project_id": body.get("project")})

        def _emit(self) -> None:
            """`POST /api/events` — the GENERATING/GATED composer's wire (§2.2 cases 2-3)
            and both of the feedback batch's writes (§7.7)."""
            body = self._body()
            emitted_events.append(body)
            # §7.7: a failing INJECT must not block the batch. One marker phrase fails the
            # `chat.posted` wire while the `feedback.submitted` event that actually drives
            # the document still succeeds — which is exactly the split the chip describes.
            payload = body.get("payload") or {}
            if (body.get("event_type") == "wicked.interactive.chat.posted"
                    and INJECT_FAIL_MARK in str(payload.get("text") or "")):
                return self._json(500, {"error": "run not found"})
            return self._json(200, {"ok": True, "event_id": f"ev-{len(emitted_events)}",
                                    "correlation_id": "c-doc"})

        def do_POST(self):  # noqa: N802
            path = urllib.parse.urlparse(self.path).path
            m = INTERACTIVE_RE.match(path)
            if m:
                project, rest = urllib.parse.unquote(m.group(1)), m.group(2)
                fork = FORK_RE.match(rest)
                if project == down_project:
                    return self._json(503, {"code": "bridge_unavailable", "hint": BRIDGE_DOWN_HINT})
                record = DEMO_RECORD_RE.match(rest)
                if record:
                    # Slice 13 only has to make the action REAL and say so; the thread
                    # wiring (and the version it lands) is slice 14's.
                    record_requests.append(urllib.parse.unquote(record.group(1)))
                    return self._json(200, {"queued": True})
                if fork:
                    return self._fork(urllib.parse.unquote(fork.group(1)))
                if rest == "/api/docs":
                    return self._create_doc(project)
                if rest == "/api/events":
                    return self._emit()
            return self._proxy()

    docd = ThreadingHTTPServer(
        ("127.0.0.1", DOC_PORT), partial(DocFixtureHandler, directory=str(same_origin_dist)))
    threading.Thread(target=docd.serve_forever, daemon=True).start()

    doc_console: list[str] = []
    doc_requests: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        # The fonts in index.html are a third-party CDN; a sandboxed/offline runner's
        # failure to reach them is not this slice's surface. Everything else counts.
        page.on("console", lambda m: doc_console.append(m.text)
                if m.type == "error" and "fonts.g" not in m.text else None)
        page.on("request", lambda r: doc_requests.append(r.url))

        # ── AC: the picker (no :docId) lists docs MOST-RECENT FIRST and navigates ──
        page.goto(f"{DOC_ORIGIN}/p/{doc_project}/document", wait_until="networkidle")
        rows = page.locator('[data-testid="doc-picker-row"]')
        rows.first.wait_for(timeout=30000)
        picker_order = [rows.nth(i).get_attribute("data-doc-id") for i in range(rows.count())]
        page.screenshot(path=str(SHOTS / "slice8-doc-picker.png"), full_page=True)
        rows.first.click()
        picker_nav_ok = wait_for_path(page, f"/p/{doc_project}/document/launch-deck")

        # ── AC: the seeded doc renders, and IS a document ─────────────────────────
        # Slice 12 supersedes slice 8's original wording here. `contentDocument` was the
        # evidence when the frame was same-origin; it is null now, BY DESIGN, and that is
        # the point of the slice. The claim is unchanged — the document rendered and its
        # scripts ran — so it is re-derived from the browser's FRAME TREE (Playwright
        # reaches into a cross-origin frame; the page's own JS cannot).
        frame = page.locator('[data-testid="doc-canvas"]')
        frame.wait_for(timeout=30000)
        page.frame_locator('[data-testid="doc-canvas"]').locator("[data-wid='h1']").wait_for(timeout=30000)
        sandbox = frame.get_attribute("sandbox")
        frame_src = frame.get_attribute("src")
        content_document_readable = frame.evaluate("el => el.contentDocument !== null")
        rendered_frame = next(f for f in page.frames if f.url and "/doc/" in f.url)
        content_text = rendered_frame.evaluate("() => (document.body.innerText || '').trim()")
        scripts_ran = rendered_frame.evaluate("() => document.body.dataset.scriptsRan === '1'")
        page.screenshot(path=str(SHOTS / "slice8-doc-canvas.png"), full_page=True)

        # ── AC: the frame's REQUEST url shares the page's origin ───────────────────
        page_origin = "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(page.url))
        rendered = [u for u in doc_requests if "/interactive/d/" in u and "/doc/" in u]
        frame_request_origins = sorted({
            "{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(u)) for u in rendered})

        # AC: "no console errors" is a claim about the WORKING canvas — snapshot it before
        # the deliberate 503 below, whose failed request chromium logs as a console error.
        canvas_console = list(doc_console)

        # ── AC (§7.12): a bridge that cannot start shows its hint VERBATIM ─────────
        page.goto(f"{DOC_ORIGIN}/p/{down_project}/document/launch-deck", wait_until="networkidle")
        hint_el = page.locator('[data-testid="doc-bridge-hint"]')
        hint_el.wait_for(timeout=30000)
        hint_text = hint_el.inner_text()
        retry_visible = page.locator('[data-testid="doc-canvas-retry"]').is_visible()
        no_frame_on_failure = page.locator('[data-testid="doc-canvas"]').count() == 0
        page.screenshot(path=str(SHOTS / "slice8-bridge-unavailable.png"), full_page=True)
        browser.close()

    report["steps"]["doc_canvas"] = {
        "ok": all([
            picker_order == ["launch-deck", "q3-report", "stale-brief", "roadmap"],
            picker_nav_ok,
            # §5.5/§7.3, closed: the sandbox is allow-scripts and NOTHING else, and the
            # parent can no longer read the frame back. Both halves asserted.
            sandbox == "allow-scripts",
            "allow-same-origin" not in (sandbox or ""),
            content_document_readable is False,
            len(content_text) > 0,
            scripts_ran,
            frame_src is not None and frame_src.endswith("/doc/2"),
            frame_request_origins == [page_origin],
            BRIDGE_DOWN_HINT in hint_text,
            retry_visible, no_frame_on_failure,
            not canvas_console,
        ]),
        "same_origin_rig": {"origin": DOC_ORIGIN, "dist": str(same_origin_dist),
                            "vite_api_host": "", "fake_bridge": True},
        "project_id": doc_project,
        "picker_order_most_recent_first": picker_order,
        "picker_navigated_to_doc": picker_nav_ok,
        "frame_src": frame_src,
        "frame_sandbox": sandbox,
        "frame_content_document_readable_by_parent": content_document_readable,
        "frame_rendered_text": content_text[:120],
        "frame_scripts_executed": scripts_ran,
        "page_origin": page_origin,
        "frame_request_origins": frame_request_origins,
        "frame_requests": rendered[:5],
        "bridge_unavailable_hint_verbatim": BRIDGE_DOWN_HINT in hint_text,
        "bridge_unavailable_hint_rendered": hint_text,
        "bridge_unavailable_offers_retry": retry_visible,
        "bridge_unavailable_shows_no_frame": no_frame_on_failure,
        "console_errors_rendering_canvas": canvas_console[:10],
        "console_errors_including_seeded_503": doc_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice8-doc-picker.png", "slice8-doc-canvas.png",
                         "slice8-bridge-unavailable.png")],
    }
    if not report["steps"]["doc_canvas"]["ok"]:
        fail("doc_canvas_verdict", "slice-8 document-canvas assertions did not all hold — see doc_canvas")

    # ── 13. Slice 9 (DES-MERGE-001 §6.3): the version strip, fork, and §7.6 ───
    # Same same-origin rig as §12 — the fake bridge now holds REAL manifest state, so
    # fork is a service write the UI reads back rather than a canned reply. Asserted:
    # a 3-version doc shows 3 entries oldest→newest with the routed one highlighted;
    # selecting v1 swaps the frame to the v1 URL and is back-button-correct; §7.6's
    # scroll affordance is disabled-with-a-reason where the anchor is null and live
    # where it is not; and Fork from v1 produces a 4th version whose parent is 1 —
    # asserted THROUGH THE API, then shown in the strip as "continues from v1".
    strip_url = f"{DOC_ORIGIN}/p/{doc_project}/document/{STRIP_DOC}"
    doc_api = (f"{DOC_ORIGIN}/api/v1/projects/{urllib.parse.quote(doc_project)}"
               f"/interactive/d/{STRIP_DOC}/api/versions")
    frame_at = ("() => document.querySelector('[data-testid=\"doc-canvas\"]')"
                "?.getAttribute('data-version') === '%s'")
    strip_console: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda m: strip_console.append(m.text)
                if m.type == "error" and "fonts.g" not in m.text else None)
        page.goto(strip_url, wait_until="networkidle")
        page.locator('[data-testid="version-strip"]').wait_for(timeout=30000)
        entries = page.locator('[data-testid="version-entry"]')

        # ── AC: a 3-version doc shows 3 entries, oldest → newest, head highlighted ──
        entry_versions = [entries.nth(i).get_attribute("data-version") for i in range(entries.count())]
        selected_at_head = [entries.nth(i).get_attribute("data-selected") for i in range(entries.count())]
        head_src = page.locator('[data-testid="doc-canvas"]').get_attribute("src")

        # ── AC (§7.6): a NULL anchor disables the scroll affordance, with the reason ──
        v1_scroll = entries.nth(0).locator('[data-testid="version-scroll"]')
        v1_scroll_disabled = v1_scroll.is_disabled()
        v1_scroll_title = v1_scroll.get_attribute("title") or ""
        v3_scroll_enabled = entries.nth(2).locator('[data-testid="version-scroll"]').is_enabled()
        page.screenshot(path=str(SHOTS / "slice9-version-strip.png"), full_page=True)

        # ── AC: selecting v1 changes the frame src to the v1 URL ───────────────────
        entries.nth(0).locator('[data-testid="version-select"]').click()
        page.wait_for_function(frame_at % "1", timeout=30000)
        v1_src = page.locator('[data-testid="doc-canvas"]').get_attribute("src")
        v1_query = urllib.parse.urlparse(page.url).query
        v1_highlighted = entries.nth(0).get_attribute("data-selected")
        v1_frame_text = page.frame_locator('[data-testid="doc-canvas"]').locator(
            "[data-wid='h1']").inner_text()
        page.screenshot(path=str(SHOTS / "slice9-version-selected.png"), full_page=True)

        # The version lives in the URL, so Back rewinds the rewind (not app state) — in
        # ONE press. That holds only because a version swap REPLACES the frame element
        # rather than navigating it: mutating `src` navigates the frame, a frame
        # navigation lands in the JOINT session history, and Back then undoes the frame's
        # move instead of the route's. (Independent of the sandbox — verified both ways.)
        page.go_back()
        back_ok = page.wait_for_function(frame_at % "3", timeout=30000) is not None
        back_query = urllib.parse.urlparse(page.url).query

        # ── AC: Fork from v1 creates a 4th version whose parent is 1 ───────────────
        entries.nth(0).locator('[data-testid="version-fork"]').click()
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid=\"version-entry\"]').length === 4",
            timeout=30000)
        page.wait_for_function(frame_at % "4", timeout=30000)
        fork_query = urllib.parse.urlparse(page.url).query
        forked = page.locator('[data-testid="version-entry"][data-version="4"]')
        fork_parent_attr = forked.get_attribute("data-parent")
        fork_label = forked.locator('[data-testid="version-lineage"]').inner_text()
        page.screenshot(path=str(SHOTS / "slice9-fork.png"), full_page=True)
        browser.close()

    # The lineage claim is the SERVICE's, so it is asserted through the API too.
    _, _, forked_manifest = http_json("GET", doc_api)
    api_v4 = next((v for v in forked_manifest["versions"] if v["version"] == 4), None)

    expected_v1_src = (f"{DOC_ORIGIN}/api/v1/projects/{urllib.parse.quote(doc_project)}"
                       f"/interactive/d/{STRIP_DOC}/doc/1")
    report["steps"]["version_strip"] = {
        "ok": all([
            entry_versions == ["1", "2", "3"],
            selected_at_head == ["false", "false", "true"],
            head_src is not None and head_src.endswith("/doc/3"),
            v1_scroll_disabled,
            "scroll to" in v1_scroll_title and "merge" in v1_scroll_title,
            v3_scroll_enabled,
            v1_src == expected_v1_src,
            v1_query == "v=1",
            v1_highlighted == "true",
            "version 1" in v1_frame_text,
            back_ok, back_query == "",
            fork_query == "v=4",
            fork_parent_attr == "1",
            fork_label.strip() == "continues from v1",
            api_v4 is not None and api_v4["parent"] == 1,
            len(forked_manifest["versions"]) == 4,
            forked_manifest["head"] == 4,
            not strip_console,
        ]),
        "doc": STRIP_DOC,
        "entries_oldest_to_newest": entry_versions,
        "highlighted_at_head": selected_at_head,
        "head_frame_src": head_src,
        "null_anchor_scroll_disabled": v1_scroll_disabled,
        "null_anchor_title": v1_scroll_title,
        "anchored_scroll_enabled": v3_scroll_enabled,
        "v1_frame_src": v1_src,
        "v1_frame_heading": v1_frame_text,
        "v1_query": v1_query,
        "back_returns_to_head": back_ok and back_query == "",
        "fork_query": fork_query,
        "fork_lineage_label": fork_label,
        "fork_manifest_from_api": forked_manifest,
        "console_errors": strip_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice9-version-strip.png", "slice9-version-selected.png",
                         "slice9-fork.png")],
    }
    if not report["steps"]["version_strip"]["ok"]:
        fail("version_strip_verdict", "slice-9 version-strip assertions did not all hold — see version_strip")

    # ── 14. Slice 10 (DES-MERGE-001 §6.3): the ONE conversation in Document mode ──
    # Same same-origin rig; the fake bridge now also answers the composer's two wires
    # and RECORDS what it was sent, so each assertion is about the wire the composer
    # chose, not about button text. What this proves:
    #   · the thread mounts BESIDE the canvas with ONE composer (§2.1) — no second input;
    #   · typing while IDLE creates the doc-generation run, and the thread shows the
    #     user's message plus the run opening as an informative line with a subject
    #     (§2.2 case 1, §3.3) — the anchor id travelling with the request (§7.6);
    #   · typing while GENERATING injects steering with `steering-chip` visible (case 2);
    #   · over a generation window in which the upstream bridge speaks the WHOLE whimsy
    #     list, the transcript renders NONE of it while real narration lands (§3.2), and
    #     the client emits no `status.requested` heartbeat at any point;
    #   · a landed version tags the message that triggered it (§7.6, client half), which
    #     is what makes slice 9's scroll targets resolvable going forward.
    WHIMSY = ["Wiring the harness…", "Pondering the loop…", "Tightening the bolts…",
              "Consulting the spine…", "Aligning the lanes…", "Reticulating splines…",
              "Checking the gates…"]
    FILLER_RE = re.compile(r"reticulating|splines|bolts", re.I)
    # §6.3 words this as a 60 s window. The filler rotated every 4 s, so the property is
    # "many rotations, none rendered"; the clock is a knob and the pushes are what count.
    GEN_WINDOW_S = float(os.environ.get("SLICE10_WINDOW_S", "10"))
    BRIEF = "a deck for the Q3 review"
    CREATED_DOC = "a-deck-for-the-q3-review"
    REAL_STATUS = "Rewriting slide 3 — tightening the headline"
    STEER = "keep it to five slides"
    THREAD_TEXT = """() => document.querySelector('[data-testid="thread"]')?.innerText ?? ''"""
    PUSH_STATUS = """args => window.__pushFrame({ type: 'interactiveEvent', event: {
         event_type: 'wicked.interactive.status.posted',
         payload: { project_id: args.project, document_id: args.doc,
                    state: 'working', message: args.text } } })"""
    thread_console: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.add_init_script(WS_TAP)
        page.on("console", lambda m: thread_console.append(m.text)
                if m.type == "error" and "fonts.g" not in m.text else None)

        # ── AC: one thread, one composer, beside the canvas — never over it (§2.5) ──
        page.goto(f"{DOC_ORIGIN}/p/{doc_project}/document", wait_until="networkidle")
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        thread = page.locator('[data-testid="thread"]')
        thread.wait_for(timeout=30000)
        page.wait_for_function("() => typeof window.__pushFrame === 'function'", timeout=30000)
        idle_state = thread.get_attribute("data-composer-state")
        composers = page.locator('[data-testid="doc-composer"]').count()
        canvas_beside_thread = page.locator('[data-testid="doc-picker-row"]').first.is_visible()
        page.screenshot(path=str(SHOTS / "slice10-thread-idle.png"), full_page=True)

        # ── AC: typing while IDLE creates the doc-generation run ───────────────────
        page.fill('[data-testid="doc-composer"]', BRIEF)
        page.click('[data-testid="doc-composer-submit"]')
        created_nav = wait_for_path(page, f"/p/{doc_project}/document/{CREATED_DOC}")
        page.locator('[data-testid="doc-message"]').first.wait_for(timeout=30000)
        first_message = page.locator('[data-testid="doc-message"]').first.inner_text()
        anchor_id = page.locator('[data-testid="doc-message"]').first.get_attribute("data-message-id")
        opening = page.locator('[data-testid="doc-narration"]').first.inner_text()
        generating_state = thread.get_attribute("data-composer-state")
        chip_while_generating = page.locator('[data-testid="steering-chip"]').is_visible()
        create_body = created_docs[0] if created_docs else {}
        page.screenshot(path=str(SHOTS / "slice10-thread-created.png"), full_page=True)

        # ── AC: the whimsy never reaches the transcript, and real narration does ───
        pushed = 0
        started = time.time()
        while time.time() - started < GEN_WINDOW_S:
            page.evaluate(PUSH_STATUS, {"project": doc_project, "doc": CREATED_DOC,
                                        "text": WHIMSY[pushed % len(WHIMSY)]})
            pushed += 1
            page.wait_for_timeout(400)
        page.evaluate(PUSH_STATUS, {"project": doc_project, "doc": CREATED_DOC,
                                    "text": REAL_STATUS})
        real_narration_ok, real_narration_ms = within(
            page,
            """text => (document.querySelector('[data-testid="thread"]')?.innerText ?? '')
                 .includes(text)""",
            REAL_STATUS,
        )
        transcript = page.evaluate(THREAD_TEXT)
        filler_hit = FILLER_RE.search(transcript)
        # Filler carried the state it rode in on: dropping the LINE is not dropping the fact.
        state_after_window = thread.get_attribute("data-composer-state")
        page.screenshot(path=str(SHOTS / "slice10-thread-narration.png"), full_page=True)

        # ── AC: typing while GENERATING injects steering rather than creating ──────
        page.fill('[data-testid="doc-composer"]', STEER)
        page.click('[data-testid="doc-composer-submit"]')
        steer_rendered, steer_ms = within(
            page,
            """text => Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
                 .some(m => m.innerText.includes(text))""",
            STEER,
        )
        chip_after_steer = page.locator('[data-testid="steering-chip"]').is_visible()
        docs_created_by_steer = len(created_docs)
        page.screenshot(path=str(SHOTS / "slice10-thread-steering.png"), full_page=True)

        # ── AC (§7.6, client half): the landed version tags the message that caused it ──
        page.evaluate(
            """args => window.__pushFrame({ type: 'interactiveEvent', event: {
                 event_type: 'wicked.interactive.version.created',
                 payload: { project_id: args.project, document_id: args.doc,
                            version: 2, parent: 1, kind: 'generated' } } })""",
            {"project": doc_project, "doc": CREATED_DOC},
        )
        tagged_ok, tag_ms = within(
            page,
            """() => { const m = document.querySelectorAll('[data-testid="doc-message"]');
                       return m.length > 0 && m[m.length - 1].getAttribute('data-version') === '2'; }""",
        )
        terminal_state = thread.get_attribute("data-composer-state")
        chip_when_terminal = page.locator('[data-testid="steering-chip"]').count()
        page.screenshot(path=str(SHOTS / "slice10-thread-version-anchor.png"), full_page=True)
        browser.close()

    # Slice 10's assertions are made below, but the fixture server stays up: §15 runs on
    # the same rig, and its wire assertions are made against the same recorded lists.
    steers = [e for e in emitted_events if e.get("event_type") == "wicked.interactive.chat.posted"]
    heartbeats = [e for e in emitted_events
                  if e.get("event_type") == "wicked.interactive.status.requested"]
    report["steps"]["doc_thread"] = {
        "ok": all([
            idle_state == "idle", composers == 1, canvas_beside_thread,
            created_nav, len(created_docs) == 1,
            create_body.get("brief") == BRIEF, create_body.get("project") == doc_project,
            anchor_id is not None and create_body.get("source_message_id") == anchor_id,
            BRIEF in first_message, CREATED_DOC in opening,
            generating_state == "generating", chip_while_generating,
            pushed >= len(WHIMSY), filler_hit is None,
            real_narration_ok, state_after_window == "generating",
            steer_rendered, chip_after_steer, docs_created_by_steer == 1,
            len(steers) == 1,
            [(s.get("payload") or {}).get("text") for s in steers] == [STEER],
            [(s.get("payload") or {}).get("document_id") for s in steers] == [CREATED_DOC],
            not heartbeats,
            tagged_ok, terminal_state == "terminal", chip_when_terminal == 0,
        ]),
        "project_id": doc_project,
        "created_doc": CREATED_DOC,
        "composer_state_idle": idle_state,
        "composer_count": composers,
        "canvas_and_thread_both_visible": canvas_beside_thread,
        "create_navigated_to_doc": created_nav,
        "create_request_body": create_body,
        "first_thread_message": first_message,
        "run_opening_narration": opening,
        "version_anchor_id": anchor_id,
        "composer_state_generating": generating_state,
        "steering_chip_visible_while_generating": chip_while_generating,
        "whimsy_lines_pushed": pushed,
        "whimsy_window_seconds": GEN_WINDOW_S,
        "filler_rendered": filler_hit.group(0) if filler_hit else None,
        "real_narration_rendered": real_narration_ok,
        "real_narration_ms": real_narration_ms,
        "state_survived_filtered_frames": state_after_window,
        "steer_message_rendered": steer_rendered,
        "steer_render_ms": steer_ms,
        "steer_emitted_events": steers,
        "steer_created_no_new_doc": docs_created_by_steer == 1,
        "status_requested_heartbeats": heartbeats,
        "version_tagged_triggering_message": tagged_ok,
        "version_tag_ms": tag_ms,
        "composer_state_terminal": terminal_state,
        "transcript": transcript[:600],
        "console_errors": thread_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice10-thread-idle.png", "slice10-thread-created.png",
                         "slice10-thread-narration.png", "slice10-thread-steering.png",
                         "slice10-thread-version-anchor.png")],
    }
    if not report["steps"]["doc_thread"]["ok"]:
        fail("doc_thread_verdict", "slice-10 document-thread assertions did not all hold — see doc_thread")

    # ── 15. Slices 11+12 (§6.3, merged per §7.3): point-and-comment, SANDBOXED ──
    # §7.3 merged these two slices so that the overlay could never exist against a
    # same-origin frame. This section is where that merge is cashed: every assertion
    # below is made about a frame carrying `sandbox="allow-scripts"` and nothing else,
    # against a fixture document that implements the postMessage instrument bridge the
    # way core/instrument.js will (`e2e/fixtures/doc-fixture.html`).
    #
    #   · ISOLATION, proven not asserted: a script inside the document reaches for
    #     `parent.localStorage` and records what happened. It must have THROWN — that is
    #     §5.5's whole risk (agent-authored HTML with the app's ambient authority) shut.
    #   · ANCHORING: clicking a `[data-wid]` heading opens the comment box within 4 px of
    #     that element's real on-screen rect — measured through the browser's frame tree,
    #     which is the only remaining way to learn where anything in there is.
    #   · BATCHING: two comments submit as ONE thread message carrying both, ONE
    #     `feedback.submitted` event, and ONE inject (§4.3: N submits would be N runs and
    #     N versions for one round of edits).
    #   · DEEP-LINK: clicking a submitted item scrolls the frame back to its element —
    #     over the protocol, since the parent cannot touch the document to do it itself.
    #   · §7.7's failure split: an inject the bridge refuses leaves the batch standing
    #     with a retryable "not recorded" chip, and the feedback event still went.
    FB_DOC = "launch-deck"
    FB_ONE = "make this title punchier"
    FB_TWO = "cut this paragraph in half"
    FB_FAIL = f"this one is {INJECT_FAIL_MARK}"
    overlay_console: list[str] = []

    def centre(box: dict) -> tuple[float, float]:
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda m: overlay_console.append(m.text)
                if m.type == "error" and "fonts.g" not in m.text else None)

        page.goto(f"{DOC_ORIGIN}/p/{doc_project}/document/{FB_DOC}", wait_until="networkidle")
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
        doc_frame = page.frame_locator('[data-testid="doc-canvas"]')
        doc_frame.locator("[data-wid='h1']").wait_for(timeout=30000)
        overlay_sandbox = page.locator('[data-testid="doc-canvas"]').get_attribute("sandbox")

        # ── AC: a script in the doc reaching for parent.localStorage THREW ─────────
        isolation_verdict = doc_frame.locator('[data-testid="isolation-probe"]').inner_text()

        # ── AC: the frame answered the instrument bridge, so the overlay is live ───
        page.locator('[data-testid="feedback-overlay"][data-ready="true"]').wait_for(timeout=30000)
        toggle = page.locator('[data-testid="feedback-toggle"]')
        overlay_enabled = toggle.is_enabled()
        toggle.click()
        page.locator('[data-testid="feedback-hitlayer"]').wait_for(timeout=10000)
        page.screenshot(path=str(SHOTS / "slice12-overlay-ready.png"), full_page=True)

        # ── AC: clicking a [data-wid] heading anchors the box within 4 px ──────────
        # The heading's rect comes from the BROWSER's frame tree, in page coordinates —
        # an independent measurement of the same element the bridge reported to the app.
        h1_box = doc_frame.locator("[data-wid='h1']").bounding_box()
        page.mouse.click(*centre(h1_box))
        card = page.locator('[data-testid="feedback-comment"]')
        card.wait_for(timeout=10000)
        card_wid = card.get_attribute("data-wid")
        card_box = card.bounding_box()
        anchor_dx = abs(card_box["x"] - h1_box["x"])
        anchor_dy = card_box["y"] - (h1_box["y"] + h1_box["height"])
        page.screenshot(path=str(SHOTS / "slice12-comment-anchored.png"), full_page=True)

        # ── AC: two comments batch, then submit as ONE message ────────────────────
        page.locator('[data-testid="feedback-comment-input"]').fill(FB_ONE)
        page.locator('[data-testid="feedback-comment-add"]').click()

        p1_box = doc_frame.locator("[data-wid='p1']").bounding_box()
        page.mouse.click(*centre(p1_box))
        page.locator('[data-testid="feedback-comment-input"]').fill(FB_TWO)
        page.locator('[data-testid="feedback-comment-add"]').click()
        pins_before_submit = page.locator('[data-testid="feedback-pin"]').count()
        # Nothing may have gone anywhere yet: batching is the point (§4.3).
        emitted_before_submit = len([e for e in emitted_events
                                     if e.get("event_type") == FEEDBACK_EVENT])
        page.screenshot(path=str(SHOTS / "slice12-batch-of-two.png"), full_page=True)

        messages_before = page.locator('[data-testid="doc-message"]').count()
        page.locator('[data-testid="feedback-submit"]').click()
        page.locator('[data-testid="doc-message"][data-items="2"]').wait_for(timeout=15000)
        messages_added = page.locator('[data-testid="doc-message"]').count() - messages_before
        batch_msg = page.locator('[data-testid="doc-message"][data-items="2"]')
        batch_text = batch_msg.inner_text()
        page.screenshot(path=str(SHOTS / "slice12-batch-submitted.png"), full_page=True)

        # ── AC: each item DEEP-LINKS back to its element, over the protocol ────────
        # Scroll the document away first, so "came back" is observable rather than vacuous.
        frame_obj = next(f for f in page.frames if f.url and "/doc/" in f.url)
        frame_obj.evaluate("() => window.scrollTo(0, 900)")
        scrolled_away = frame_obj.evaluate("() => window.scrollY")
        batch_msg.locator('[data-testid="feedback-item-link"][data-wid="h1"]').click()
        page.wait_for_timeout(600)
        scrolled_back = frame_obj.evaluate("() => window.scrollY")
        page.screenshot(path=str(SHOTS / "slice12-deep-link.png"), full_page=True)

        # "No console errors" is a claim about the WORKING overlay — snapshot it before
        # the deliberate 500 below, whose failed request chromium logs as a console error.
        # Same discipline slice 8 uses for its seeded 503.
        overlay_console_clean = list(overlay_console)

        # ── AC (§7.7): a refused inject does NOT block the batch ───────────────────
        frame_obj.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(300)
        toggle.click()  # back into commenting
        page.locator('[data-testid="feedback-hitlayer"]').wait_for(timeout=10000)
        page.mouse.click(*centre(doc_frame.locator("[data-wid='h1']").bounding_box()))
        page.locator('[data-testid="feedback-comment-input"]').fill(FB_FAIL)
        page.locator('[data-testid="feedback-comment-add"]').click()
        page.locator('[data-testid="feedback-submit"]').click()
        chip = page.locator('[data-testid="feedback-not-recorded"]')
        chip.wait_for(timeout=15000)
        chip_retryable = chip.is_enabled()
        # The batch itself STANDS: the message is in the transcript and the bus event went.
        unrecordable_rendered = page.locator(
            f'[data-testid="doc-message"]:has-text("{INJECT_FAIL_MARK}")').count()
        page.screenshot(path=str(SHOTS / "slice12-not-recorded-chip.png"), full_page=True)
        browser.close()

    docd.shutdown()

    feedback_events = [e for e in emitted_events if e.get("event_type") == FEEDBACK_EVENT]
    batch_event = (feedback_events[0].get("payload") or {}) if feedback_events else {}
    batch_injects = [e for e in emitted_events
                     if e.get("event_type") == "wicked.interactive.chat.posted"
                     and FB_ONE in str((e.get("payload") or {}).get("text") or "")]
    report["steps"]["feedback_overlay"] = {
        "ok": all([
            # §5.5/§7.3: the frame the overlay ran against was FULLY sandboxed…
            overlay_sandbox == "allow-scripts",
            # …and the document proved it, from the inside.
            isolation_verdict.startswith("THREW"),
            overlay_enabled,
            # §4.3's anchoring budget, both axes.
            card_wid == "h1", anchor_dx <= 4, 0 <= anchor_dy <= 4,
            # Batched, not streamed: two pins, nothing emitted until Submit.
            pins_before_submit == 2, emitted_before_submit == 0,
            # ONE message with BOTH items, ONE bus event, ONE inject.
            messages_added == 1,
            FB_ONE in batch_text, FB_TWO in batch_text,
            len(feedback_events) == 2,  # the batch of two, then the unrecordable one
            [i.get("wid") for i in (batch_event.get("items") or [])] == ["h1", "p1"],
            [i.get("comment") for i in (batch_event.get("items") or [])] == [FB_ONE, FB_TWO],
            batch_event.get("version") == 2,
            len(batch_injects) == 1,
            # The deep-link brought the element back over the protocol.
            scrolled_away > 400, scrolled_back < 100,
            # §7.7: the refused inject is a retryable chip, not a lost batch.
            chip_retryable, unrecordable_rendered == 1,
            not overlay_console_clean,
        ]),
        "project_id": doc_project,
        "doc": FB_DOC,
        "frame_sandbox": overlay_sandbox,
        "parent_localstorage_from_inside_frame": isolation_verdict,
        "overlay_enabled_after_handshake": overlay_enabled,
        "heading_rect_from_frame_tree": h1_box,
        "comment_box_rect": card_box,
        "comment_box_wid": card_wid,
        "anchor_error_px": {"x": anchor_dx, "y": anchor_dy},
        "pins_before_submit": pins_before_submit,
        "feedback_events_before_submit": emitted_before_submit,
        "thread_messages_added_by_submit": messages_added,
        "batch_message_text": batch_text[:400],
        "feedback_events": feedback_events,
        "injects_carrying_the_batch": batch_injects,
        "frame_scroll_before_deep_link": scrolled_away,
        "frame_scroll_after_deep_link": scrolled_back,
        "not_recorded_chip_retryable": chip_retryable,
        "unrecordable_batch_still_in_transcript": unrecordable_rendered == 1,
        "console_errors_driving_the_overlay": overlay_console_clean[:10],
        "console_errors_including_seeded_500": overlay_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice12-overlay-ready.png", "slice12-comment-anchored.png",
                         "slice12-batch-of-two.png", "slice12-batch-submitted.png",
                         "slice12-deep-link.png", "slice12-not-recorded-chip.png")],
    }
    if not report["steps"]["feedback_overlay"]["ok"]:
        fail("feedback_overlay_verdict",
             "slice-11+12 point-and-comment assertions did not all hold — see feedback_overlay")

    # ── 16. Slice 13 (DES-MERGE-001 §4.5, §6.4): Video mode — storyboard + player ──
    # Same same-origin rig: the fake bridge now also serves a seeded demo spec, a real
    # (1×1) GIF, and a demo whose post-process found no ffmpeg. What this proves:
    #   · the picker lists DEMOS most-recent-first out of the one registry, and does not
    #     list the documents that sit in the same registry;
    #   · a seeded demo shows N chapter cards matching its spec's N steps, in spec order;
    #   · clicking chapter 3 seeks the player to that step's timestamp. The recording here
    #     is a GIF — the artifact the service produces when ffmpeg made no mp4 — which has
    #     no timeline to scrub, so the seek is asserted where the surface actually carries
    #     it (`data-chapter` / `data-position`, the same values a <video> gets written to
    #     its `currentTime`; that write is pinned in tests/VideoStoryboard.test.tsx);
    #   · the ffmpeg-absent demo shows the service's install command VERBATIM, still
    #     renders its full storyboard, and logs no console error — degradation, not a crash.
    demo_console: list[str] = []
    demo_requests: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda m: demo_console.append(m.text)
                if m.type == "error" and "fonts.g" not in m.text else None)
        page.on("request", lambda r: demo_requests.append(r.url))

        # ── AC: the picker lists demos, most-recent first, and navigates ───────────
        # `domcontentloaded`, not `networkidle`: the shell holds a live /ws and the mode
        # surface's own loads are what the locator waits below are for — idling the
        # network is neither necessary here nor something a live socket guarantees.
        page.goto(f"{DOC_ORIGIN}/p/{demo_project}/video", wait_until="domcontentloaded")
        page.locator('[data-testid="mode-switcher"]').wait_for(timeout=30000)
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        demo_rows = page.locator('[data-testid="demo-picker-row"]')
        demo_rows.first.wait_for(timeout=30000)
        demo_order = [demo_rows.nth(i).get_attribute("data-demo-id") for i in range(demo_rows.count())]
        page.screenshot(path=str(SHOTS / "slice13-demo-picker.png"), full_page=True)
        demo_rows.first.click()
        demo_nav_ok = wait_for_path(page, f"/p/{demo_project}/video/{RECORDED_DEMO}")

        # ── AC: N chapter cards, matching the spec's N steps, in spec order ────────
        cards = page.locator('[data-testid="chapter-card"]')
        cards.first.wait_for(timeout=30000)
        card_count = cards.count()
        card_indexes = [cards.nth(i).get_attribute("data-index") for i in range(card_count)]
        card_titles = [cards.nth(i).inner_text() for i in range(card_count)]
        player = page.locator('[data-testid="demo-player"]')
        player_kind = player.get_attribute("data-player-kind")
        # The player renders the SERVICE's bytes, through the proxy, on the page's origin.
        gif_src = page.locator('[data-testid="demo-gif"]').get_attribute("src")
        gif_loaded = page.locator('[data-testid="demo-gif"]').evaluate("el => el.naturalWidth > 0")
        page.screenshot(path=str(SHOTS / "slice13-storyboard.png"), full_page=True)

        # ── AC: clicking chapter 3 seeks the player to that chapter's timestamp ────
        cards.nth(2).click()
        page.wait_for_function(
            """() => document.querySelector('[data-testid="demo-player"]')
                 ?.getAttribute('data-chapter') === '2'""", timeout=30000)
        seek_chapter = player.get_attribute("data-chapter")
        seek_position = player.get_attribute("data-position")
        seek_selected = cards.nth(2).get_attribute("data-selected")
        others_unselected = [cards.nth(i).get_attribute("data-selected")
                             for i in (0, 1, 3, 4)]
        page.screenshot(path=str(SHOTS / "slice13-chapter-seek.png"), full_page=True)

        # ── AC (§4.5): a missing ffmpeg is ACTIONABLE, and the storyboard still renders ──
        page.goto(f"{DOC_ORIGIN}/p/{demo_project}/video/{FFMPEG_DEMO}", wait_until="domcontentloaded")
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        hint_el = page.locator('[data-testid="demo-ffmpeg-hint"]')
        hint_el.wait_for(timeout=30000)
        ffmpeg_hint_text = hint_el.inner_text()
        ffmpeg_flagged = page.locator('[data-testid="demo-no-recording"]').get_attribute("data-ffmpeg-absent")
        ffmpeg_cards = page.locator('[data-testid="chapter-card"]').count()
        # …and the whole app is still standing: mode switcher, thread, no error surface.
        ffmpeg_shell_ok = (page.locator('[data-testid="mode-switcher"]').is_visible()
                           and page.locator('[data-testid="thread"]').is_visible()
                           and page.locator('[data-testid="video-canvas-error"]').count() == 0)
        # §3.3 wants a control adjacent to the statement, so the record action is real.
        page.locator('[data-testid="demo-record"]').click()
        queued_el = page.locator('[data-testid="demo-record-queued"]')
        queued_el.wait_for(timeout=30000)
        record_queued_ok = queued_el.is_visible()
        page.screenshot(path=str(SHOTS / "slice13-ffmpeg-absent.png"), full_page=True)
        browser.close()

    expected_gif = (f"{DOC_ORIGIN}/api/v1/projects/{urllib.parse.quote(demo_project)}"
                    f"/interactive{DEMO_GIF_PATH}")
    # §5.3: every byte the surface pulls — spec, recording, GIF — is on the PAGE's own
    # origin through crew's proxy. No second origin, and never the bridge's own port.
    demo_origins = sorted({"{u.scheme}://{u.netloc}".format(u=urllib.parse.urlparse(u))
                           for u in demo_requests if "/interactive/" in u})
    report["steps"]["video_storyboard"] = {
        "ok": all([
            # Most-recent first, demos only — the documents in the same registry are absent.
            demo_order == [RECORDED_DEMO, "flaky-render", "onboarding-tour"],
            all(d["name"] not in (demo_order or []) for d in FIXTURE_DOCS),
            demo_nav_ok,
            card_count == len(DEMO_STEPS),
            card_indexes == [str(i) for i in range(len(DEMO_STEPS))],
            all(step["title"] in title for step, title in zip(DEMO_STEPS, card_titles)),
            player_kind == "gif",
            gif_src == expected_gif, gif_loaded,
            demo_origins == [DOC_ORIGIN],
            seek_chapter == "2",
            seek_position == str(DEMO_STEPS[2]["timestamp"]),
            seek_selected == "true",
            others_unselected == ["false"] * 4,
            FFMPEG_HINT in ffmpeg_hint_text,
            ffmpeg_flagged == "true",
            ffmpeg_cards == len(DEMO_STEPS),
            ffmpeg_shell_ok,
            record_queued_ok, record_requests == [FFMPEG_DEMO],
            not demo_console,
        ]),
        "project_id": demo_project,
        "picker_order_most_recent_first": demo_order,
        "picker_navigated_to_demo": demo_nav_ok,
        "chapter_cards": card_count,
        "spec_steps": len(DEMO_STEPS),
        "chapter_order": card_indexes,
        "chapter_titles": card_titles,
        "player_kind": player_kind,
        "player_src": gif_src,
        "player_bytes_decoded": gif_loaded,
        "interactive_request_origins": demo_origins,
        "seek_chapter": seek_chapter,
        "seek_position_seconds": seek_position,
        "seek_expected_seconds": DEMO_STEPS[2]["timestamp"],
        "seek_selection": {"clicked": seek_selected, "others": others_unselected},
        "ffmpeg_hint_verbatim": FFMPEG_HINT in ffmpeg_hint_text,
        "ffmpeg_hint_rendered": ffmpeg_hint_text,
        "ffmpeg_storyboard_still_rendered": ffmpeg_cards,
        "ffmpeg_shell_intact": ffmpeg_shell_ok,
        "record_action_queued": record_queued_ok,
        "record_requests_seen_by_bridge": record_requests,
        "console_errors": demo_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("slice13-demo-picker.png", "slice13-storyboard.png",
                         "slice13-chapter-seek.png", "slice13-ffmpeg-absent.png")],
    }
    if not report["steps"]["video_storyboard"]["ok"]:
        fail("video_storyboard_verdict",
             "slice-13 Video-mode assertions did not all hold — see video_storyboard")

    # ── 17. Operator UX directive: the live edge on the board ──────────────────
    # The ACTIVE-WORK signal is a breathing 2px strip along the leading edge of the
    # element doing work, and the thing that has to hold is the RANKING: a busy card
    # must be visible without out-shouting a card that needs a human. So both states
    # are asserted in ONE DOM snapshot, and asserted to be DIFFERENT — same testid,
    # different state, different computed pixels.
    #
    # The gate side is the real daemon (a run genuinely parked on a human gate). The
    # executing side pins `GET /runs` for ONE run's status word, the same discipline
    # slice 7 used for its complex gate: the run is real and filed, the payload
    # travels the full app path (fetch → useRuns → board → card), and the assertion
    # is about the treatment rather than about whether the stub engine happens to
    # still be mid-unit when the browser looks.
    edge_gate = new_project(f"edge-gate-{tag}")
    attach_run(edge_gate, await_gate(launch("live edge: parks on a gate", "all")))
    edge_busy = new_project(f"edge-busy-{tag}")
    edge_busy_run = launch("live edge: executing while the board is watched", "none")
    attach_run(edge_busy, edge_busy_run)

    def pin_executing(route):
        """Hold ONE run at `executing` in the run list; pass every other run through."""
        response = route.fetch()
        body = response.json()
        for view in body.get("runs", []):
            if view["session"]["id"] == edge_busy_run:
                view["session"]["status"] = "executing"
        route.fulfill(response=response, json=body)

    # Everything the browser needs to know about one card's edge, in one snapshot.
    EDGE = """id => {
      const card = document.querySelector(`[data-testid="project-card"][data-project-id="${id}"]`);
      if (!card) return null;
      const own = card.querySelector(':scope > [data-testid="live-edge"]');
      const chip = card.querySelector('[data-testid="run-chip"] [data-testid="live-edge"]');
      const read = (el) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { state: el.dataset.edgeState, className: el.className,
                 animation: cs.animationName, duration: cs.animationDuration,
                 width: cs.width, background: cs.backgroundColor, opacity: cs.opacity };
      };
      return { attention: card.dataset.attention, own: read(own), chip: read(chip) };
    }"""

    edge_console: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda m: edge_console.append(m.text) if m.type == "error" else None)
        page.route(f"{API}/runs", pin_executing)

        page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
        page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
        # AC: an executing card exposes the live-edge element.
        busy_edge_ok, busy_edge_ms = within(
            page,
            """id => { const c = document.querySelector(
                         `[data-testid="project-card"][data-project-id="${id}"]`);
                       return c?.querySelector(
                         ':scope > [data-testid="live-edge"]')?.dataset.edgeState === 'executing'; }""",
            edge_busy,
            budget_ms=30000,
        )
        # AC: the gate-waiting card's treatment is present AT THE SAME TIME — one
        # snapshot, both cards, so this cannot pass by the two states taking turns.
        page.evaluate(f"() => {{ window.__readEdge = {EDGE}; }}")
        busy = page.evaluate("id => window.__readEdge(id)", edge_busy)
        gate = page.evaluate("id => window.__readEdge(id)", edge_gate)
        simultaneous = page.evaluate(
            """ids => ids.every(id => !!document.querySelector(
                 `[data-testid="project-card"][data-project-id="${id}"] [data-testid="live-edge"]`))""",
            [edge_busy, edge_gate],
        )
        page.screenshot(path=str(SHOTS / "liveedge-board-executing-vs-gate.png"), full_page=True)
        # A second shot with the executing card actually on screen. Attention order puts
        # every gate-waiting card above it — which is the point — so the first shot alone
        # shows a reviewer only the treatment that was already there.
        page.evaluate(
            """id => document.querySelector(
                 `[data-testid="project-card"][data-project-id="${id}"]`
               )?.scrollIntoView({ block: 'center' })""",
            edge_busy,
        )
        page.screenshot(path=str(SHOTS / "liveedge-board-executing.png"), full_page=True)
        browser.close()

        # AC (rule 4): prefers-reduced-motion substitutes a STATIC, higher-contrast
        # edge. Asserted in a real CSS engine, which is the only place the media
        # query exists — the unit tests pin the class the component maps to.
        reduced_browser = p.chromium.launch()
        reduced_page = reduced_browser.new_page()
        reduced_page.emulate_media(reduced_motion="reduce")
        reduced_page.route(f"{API}/runs", pin_executing)
        reduced_page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
        reduced_page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
        reduced_ok, reduced_ms = within(
            reduced_page,
            """id => { const c = document.querySelector(
                         `[data-testid="project-card"][data-project-id="${id}"]`);
                       return c?.querySelector(
                         ':scope > [data-testid="live-edge"]')?.dataset.edgeState === 'executing'; }""",
            edge_busy,
            budget_ms=30000,
        )
        reduced_page.evaluate(f"() => {{ window.__readEdge = {EDGE}; }}")
        reduced = reduced_page.evaluate("id => window.__readEdge(id)", edge_busy)
        reduced_page.screenshot(path=str(SHOTS / "liveedge-reduced-motion.png"), full_page=True)
        reduced_browser.close()

    busy_own = (busy or {}).get("own") or {}
    gate_own = (gate or {}).get("own") or {}
    busy_chip = (busy or {}).get("chip") or {}
    reduced_own = (reduced or {}).get("own") or {}
    report["steps"]["live_edge"] = {
        "ok": all([
            busy_edge_ok, simultaneous,
            busy_own.get("state") == "executing",
            gate_own.get("state") == "gate",
            # Distinct, and distinct in PIXELS rather than only in a class name.
            busy_own.get("className") != gate_own.get("className"),
            busy_own.get("background") != gate_own.get("background"),
            busy_own.get("width") != gate_own.get("width"),
            # Motion is what catches the eye — and only executing gets it. A gate is
            # louder by contrast, so a wall of busy cards cannot drown it out.
            busy_own.get("animation") == "wk-live-pulse",
            busy_own.get("duration") == "2s",
            gate_own.get("animation") == "none",
            gate_own.get("opacity") == "1",
            # Rule 5: the same treatment on the run chip inside the card.
            busy_chip.get("state") == "executing",
            # Rule 4: no animation, and MORE contrast than the breath it replaced.
            reduced_ok,
            reduced_own.get("animation") == "none",
            reduced_own.get("opacity") == "1",
            reduced_own.get("width") != busy_own.get("width"),
        ]),
        "gate_project": edge_gate,
        "busy_project": edge_busy,
        "busy_run": edge_busy_run,
        "executing_card_exposes_live_edge": busy_edge_ok,
        "executing_edge_ms": busy_edge_ms,
        "both_treatments_present_at_once": simultaneous,
        "executing_edge": busy_own,
        "gate_edge": gate_own,
        "executing_run_chip_edge": busy_chip,
        "reduced_motion_edge": reduced_own,
        "reduced_motion_ms": reduced_ms,
        "console_errors": edge_console[:10],
        "screenshots": [str(SHOTS / n) for n in
                        ("liveedge-board-executing-vs-gate.png", "liveedge-board-executing.png",
                         "liveedge-reduced-motion.png")],
    }
    if not report["steps"]["live_edge"]["ok"]:
        fail("live_edge_verdict", "live-edge assertions did not all hold — see live_edge")

    report["ok"] = True
    print(json.dumps(report, indent=2))
finally:
    daemon.terminate()
    httpd.shutdown()
