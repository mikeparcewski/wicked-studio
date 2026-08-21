#!/usr/bin/env python3
"""
feedback_sliceD_test.py — the DES-FEEDBACK-001 slice-D gate: project dashboard
landing + persistent project-context header (§4.1, §4.2, §8.3 slice D), against
the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with the `demo` switch on
(so q3-review-deck's registry carries the recorded demo doc — the docs tile has
something true to list).

The slice DOM ACs, verbatim from §8.3:

  1. `[data-testid="project-dashboard"]` is present when navigating to
     `/p/:projectId` with no mode segment;
  2. it contains `[data-testid="dashboard-runs"]`, `[data-testid="dashboard-docs"]`,
     `[data-testid="dashboard-gates"]`, `[data-testid="dashboard-activity"]`;
  3. inside Build mode at `/p/:projectId/build`,
     `[data-testid="project-context-header"]` shows the project name and "Build";
  4. clicking the project name navigates to `/p/:projectId`.

Plus what the slice means beyond its testids:

  - the LAST-USED-MODE REDIRECT IS GONE: entering Chat first, then navigating to
    the bare project route, still lands on the dashboard (never a remembered mode);
  - the dashboard is NOT a fifth mode — no mode switcher, no Dashboard tab;
  - the runs tile is project-scoped (r-q3 only, never the other fixture runs)
    and each row is a real link into the run's own mode view;
  - the gate tile reuses the board's answerable chip: inline Approve for the
    simple r-q3 gate fires the SAME `POST /runs/:id/gate` the board chip fires;
  - the §4.2 header anatomy: 32px band, project name in --ink-muted linking to
    the dashboard, mode name in --ink-high, both --text-sm(13px)/--weight-medium(500)
    sans — and it is present in ALL FOUR mode surfaces (EC17);
  - §8.3 preservation: the Build purpose statement still renders below the header.

Captures (§8.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback-D-project-dashboard.png   the q3 dashboard, all four tiles populated
  feedback-D-build-with-header.png   Build mode with the project-context header

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4354),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4354"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
PROJECT = "q3-review-deck"
DASH_URL = f"{ORIGIN}/p/{PROJECT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server, demo switch ON (q3's registry carries the
#      recorded checkout-demo, so the docs tile lists a real wire shape) ────────
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, demo=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0, "demo": True}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

# What the §4.2 anatomy probe resolves the ink tokens through: two zero-size
# probes whose color IS the token, compared against the crumb's computed color.
TOKEN_PROBE = """() => {
  const resolve = (token) => {
    const el = document.createElement('span');
    el.style.color = `var(${token})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  };
  return { muted: resolve('--ink-muted'), high: resolve('--ink-high') };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    # The tap: every gate answer the page sends — the reuse proof (§4.1 tile 3:
    # the dashboard's chip must fire the SAME POST /runs/:id/gate the board's does).
    gate_posts: list[tuple[str, dict | None]] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "POST" and path.startswith("/api/v1/runs/") and path.endswith("/gate"):
            body = None
            if req.post_data:
                try:
                    body = json.loads(req.post_data)
                except ValueError:
                    body = None
            gate_posts.append((path, body))

    page.on("request", on_request)

    # ── Scene 0 (redirect-gone setup): enter CHAT first, so any surviving
    #    "last-used mode" memory would have something to remember. ──────────────
    page.goto(f"{ORIGIN}/p/{PROJECT}/chat", wait_until="domcontentloaded")
    page.locator('[data-testid="project-context-header"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # ── AC 1 + redirect gone: the bare project route lands on the DASHBOARD ────
    page.goto(DASH_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # The gate tile settles once useRuns' reconcile pulls r-q3's cached gate.
    page.locator('[data-testid="gate-approve-r-q3"]').wait_for(timeout=30000)

    try:
        page.wait_for_function(
            """() => document.fonts.status === 'loaded'
                  && document.fonts.check('12px "Inter"')""",
            timeout=20000,
        )
        fonts_ok = True
    except Exception:
        fonts_ok = False

    landing = page.evaluate(
        """() => {
             const dash = document.querySelector('[data-testid="project-dashboard"]');
             const q = (sel) => dash ? dash.querySelector(sel) : null;
             const runs = Array.from(document.querySelectorAll('[data-testid="dashboard-run"]'));
             const docs = Array.from(document.querySelectorAll('[data-testid="dashboard-doc"]'));
             return {
               pathname: window.location.pathname,
               dashPresent: !!dash,
               // AC 2: all four tiles INSIDE the dashboard.
               runsTile: !!q('[data-testid="dashboard-runs"]'),
               docsTile: !!q('[data-testid="dashboard-docs"]'),
               gatesTile: !!q('[data-testid="dashboard-gates"]'),
               activityTile: !!q('[data-testid="dashboard-activity"]'),
               // NOT a fifth mode: no switcher, no Dashboard tab, no mode surface.
               noSwitcher: !document.querySelector('[data-testid="mode-switcher"]'),
               noModeSurface: !document.querySelector('[data-testid="mode-surface"]'),
               noDashboardTab: !document.querySelector('[data-testid="mode-tab-dashboard"]'),
               // Tile 1: project-scoped (r-q3 ONLY), a real link into the run's mode view.
               runsCount: q('[data-testid="dashboard-runs"]')?.dataset.count ?? null,
               runIds: runs.map(r => r.dataset.runId),
               runStatuses: runs.map(r => r.dataset.status),
               runHref: runs[0]?.getAttribute('href') ?? null,
               // Tile 2: the demo doc from listDocs(q3), linking into ITS mode (Video).
               docIds: docs.map(d => d.dataset.docId),
               docHref: docs[0]?.getAttribute('href') ?? null,
               // Tile 3: the board's answerable chip, inline for the simple r-q3 gate.
               gatesCount: q('[data-testid="dashboard-gates"]')?.dataset.count ?? null,
               approvePresent: !!document.querySelector('[data-testid="gate-approve-r-q3"]'),
               rejectPresent: !!document.querySelector('[data-testid="gate-reject-r-q3"]'),
               // Tile 4: the 7-day sparkline is a real inline SVG with content.
               sparkTotal: q('[data-testid="dashboard-activity"]')?.dataset.total ?? null,
               sparkSvg: !!document.querySelector('svg[data-testid="activity-sparkline"]'),
               // §2.3 bar sparkline: one <rect> per counted bucket, token-filled.
               sparkRects: Array.from(document.querySelectorAll(
                 '[data-testid="activity-sparkline"] rect')).map(r => r.getAttribute('fill')),
               // Header: name + the four mode doors + the meta line (no invented cost).
               metaText: document.querySelector('[data-testid="dashboard-meta"]')?.textContent ?? '',
               modeDoors: ['chat','build','document','video'].map(m =>
                 document.querySelector(`[data-testid="dashboard-mode-${m}"]`)?.getAttribute('href')),
             };
           }"""
    )

    # ── Capture 1: the dashboard, all four tiles populated ─────────────────────
    page.screenshot(path=str(VSHOTS / "feedback-D-project-dashboard.png"))

    # ── Tile 1 navigation: a run row opens the run's mode view ─────────────────
    page.locator('[data-testid="dashboard-run"][data-run-id="r-q3"]').click()
    page.locator('[data-testid="mode-surface"][data-mode="build"]').wait_for(timeout=30000)
    run_nav = page.evaluate("() => window.location.pathname")

    # ── AC 3 + EC17 anatomy: the Build surface wears the context header ────────
    page.goto(f"{ORIGIN}/p/{PROJECT}/build", wait_until="domcontentloaded")
    page.locator('[data-testid="project-context-header"]').wait_for(timeout=30000)
    page.locator('[data-testid="build-purpose"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    tokens = page.evaluate(TOKEN_PROBE)
    header = page.evaluate(
        """() => {
             const h = document.querySelector('[data-testid="project-context-header"]');
             const name = document.querySelector('[data-testid="project-name"]');
             const mode = document.querySelector('[data-testid="context-mode"]');
             const purpose = document.querySelector('[data-testid="build-purpose"]');
             const ncs = name ? getComputedStyle(name) : null;
             const mcs = mode ? getComputedStyle(mode) : null;
             return {
               height: h ? h.getBoundingClientRect().height : null,
               nameText: name?.textContent ?? null,
               nameHref: name?.getAttribute('href') ?? null,
               nameColor: ncs?.color ?? null,
               modeText: mode?.textContent ?? null,
               modeColor: mcs?.color ?? null,
               fontSize: mcs?.fontSize ?? null,
               fontWeight: mcs?.fontWeight ?? null,
               fontFamily: mcs?.fontFamily ?? null,
               // §8.3 preservation: the purpose statement sits BELOW the header.
               purposeBelowHeader: !!h && !!purpose
                 && purpose.getBoundingClientRect().top > h.getBoundingClientRect().bottom - 1,
             };
           }"""
    )

    # ── Capture 2: Build mode with the context header ───────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback-D-build-with-header.png"))

    # ── AC 4: clicking the project name lands back on the dashboard ────────────
    page.locator('[data-testid="project-name"]').click()
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=30000)
    back_path = page.evaluate("() => window.location.pathname")

    # ── EC17 sweep: the header is in ALL FOUR mode surfaces, correctly worded ──
    ec17: dict = {}
    for mode, label in [("chat", "Chat"), ("build", "Build"),
                        ("document", "Document"), ("video", "Video")]:
        page.goto(f"{ORIGIN}/p/{PROJECT}/{mode}", wait_until="domcontentloaded")
        page.locator('[data-testid="project-context-header"]').wait_for(timeout=30000)
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        got = page.evaluate(
            """() => ({
                 name: document.querySelector('[data-testid="project-name"]')?.textContent ?? null,
                 mode: document.querySelector('[data-testid="context-mode"]')?.textContent ?? null,
                 visible: (() => {
                   const h = document.querySelector('[data-testid="project-context-header"]');
                   if (!h) return false;
                   const r = h.getBoundingClientRect();
                   return r.height > 0 && r.width > 0;
                 })(),
               })"""
        )
        ec17[mode] = {"ok": got["name"] == PROJECT and got["mode"] == label and got["visible"], **got}

    # ── Tile 3 reuse proof: inline Approve fires the board chip's POST ──────────
    page.goto(DASH_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="gate-approve-r-q3"]').wait_for(timeout=30000)
    posts_before = len(gate_posts)
    page.locator('[data-testid="gate-approve-r-q3"]').click()
    # The POST is fired synchronously on click; give the tap one settle tick.
    page.wait_for_timeout(500)
    approve_posts = gate_posts[posts_before:]

    page.close()
    ctx.close()
    browser.close()

report["steps"]["dashboard_landing"] = {
    "ok": all([
        fonts_ok,
        landing["pathname"] == f"/p/{PROJECT}",
        landing["dashPresent"],
        landing["runsTile"], landing["docsTile"],
        landing["gatesTile"], landing["activityTile"],
        landing["noSwitcher"], landing["noModeSurface"], landing["noDashboardTab"],
    ]),
    **{k: landing[k] for k in ("pathname", "dashPresent", "runsTile", "docsTile",
                               "gatesTile", "activityTile", "noSwitcher",
                               "noModeSurface", "noDashboardTab")},
    "web_fonts_loaded": fonts_ok,
    "screenshot": str(VSHOTS / "feedback-D-project-dashboard.png"),
}
report["steps"]["tiles_populated"] = {
    "ok": all([
        # Runs: r-q3 ONLY (project-scoped — none of the fixture's 6 other runs).
        landing["runsCount"] == "1",
        landing["runIds"] == ["r-q3"],
        landing["runStatuses"] == ["awaiting_human"],
        landing["runHref"] == f"/p/{PROJECT}/build/r-q3",
        # Docs: the demo registry entry, linking into Video (its own mode view).
        landing["docIds"] == ["checkout-demo"],
        landing["docHref"] == f"/p/{PROJECT}/video/checkout-demo",
        # Gates: the one open q3 gate, answerable INLINE (simple shape).
        landing["gatesCount"] == "1",
        landing["approvePresent"], landing["rejectPresent"],
        # Activity: 1 run attached inside the 7-day window, drawn as real SVG.
        landing["sparkTotal"] == "1",
        landing["sparkSvg"],
        len(landing["sparkRects"]) == 1,
        all(f.startswith("var(--") for f in landing["sparkRects"]),
        # Meta: honest fields only — open-run count present, no invented cost.
        "1 open run" in landing["metaText"],
        "cost" not in landing["metaText"].lower(),
        landing["modeDoors"] == [f"/p/{PROJECT}/chat", f"/p/{PROJECT}/build",
                                 f"/p/{PROJECT}/document", f"/p/{PROJECT}/video"],
    ]),
    **{k: landing[k] for k in ("runsCount", "runIds", "runStatuses", "runHref",
                               "docIds", "docHref", "gatesCount", "approvePresent",
                               "rejectPresent", "sparkTotal", "sparkSvg",
                               "sparkRects", "metaText", "modeDoors")},
}
report["steps"]["run_row_navigates"] = {
    "ok": run_nav == f"/p/{PROJECT}/build/r-q3",
    "landed": run_nav,
}
report["steps"]["context_header_build"] = {
    "ok": all([
        header["height"] == 32,
        header["nameText"] == PROJECT,
        header["nameHref"] == f"/p/{PROJECT}",
        header["modeText"] == "Build",
        # §4.2 anatomy: muted project name, high-ink mode, 13px/500 sans.
        header["nameColor"] == tokens["muted"],
        header["modeColor"] == tokens["high"],
        header["fontSize"] == "13px",
        header["fontWeight"] == "500",
        "Inter" in (header["fontFamily"] or ""),
        header["purposeBelowHeader"],
    ]),
    **header,
    "resolved_tokens": tokens,
    "screenshot": str(VSHOTS / "feedback-D-build-with-header.png"),
}
report["steps"]["name_click_lands_on_dashboard"] = {
    "ok": back_path == f"/p/{PROJECT}",
    "landed": back_path,
}
report["steps"]["ec17_all_modes"] = {
    "ok": all(v["ok"] for v in ec17.values()),
    **ec17,
}
report["steps"]["gate_chip_reuse"] = {
    # The dashboard chip speaks the board chip's wire: POST /runs/r-q3/gate {approve:true}.
    "ok": approve_posts == [("/api/v1/runs/r-q3/gate", {"approve": True})],
    "gate_posts": approve_posts,
}
report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback-D-project-dashboard.png"),
    str(VSHOTS / "feedback-D-build-with-header.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceD_verdict", f"slice-D assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
