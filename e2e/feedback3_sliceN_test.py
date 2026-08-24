#!/usr/bin/env python3
"""
feedback3_sliceN_test.py — the DES-FEEDBACK-003 slice-N gate: the runs bottom
panel (§5), against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with
metrics_ws ON so the observed-spend segment has real cliUsage dollars to fold.

The slice DOM ACs, verbatim from §5.7:

  1. `[data-testid="runs-bottom-bar"]` is present on `/`, `/projects`, `/make`,
     `/repos`, inside `/p/:id/build` AND inside `/p/:id/document` (fixed =
     everywhere); computed `position: fixed`, bottom 0, height 28.
  2. W2 fixture: the bar's `data-working`/`data-gates`/`data-failed` match the
     runs array (2/2/2 with the orphan riding); the spend segment folds the
     metrics_ws drip to `$0.42 observed`; an empty listing reads the quiet
     phrase.
  3. Clicking the bar renders `[data-testid="runs-bottom-sheet"]`; row count
     ≤ 20; active rows precede terminal rows; each row is an `<a>` whose href
     resolves per `runPath`; a gated row's href ends with `#gate`.
  4. Clicking a working run's row navigates to the run page and the sheet
     unmounts; middle-click leaves the page (href asserted).
  5. Escape closes the sheet; with the palette open, Escape closes the PALETTE
     only (registry precedence, §5.7/C9).
  6. Entering Document mode with the sheet open collapses it (EC27); the
     version strip's bounding box bottom ≤ the bar's top (no overlap at
     1440×900) — and the strip's bottom-proximity wake STILL WORKS (the
     slice-F regression this design must not cause): after the 3s auto-hide
     the mouse driven to the bottom edge over the canvas flips the strip's
     opacity 0 → 1.
  7. The panel fires zero network requests — ever (interception across a
     settled idle window spanning expand / hover / collapse / re-expand).
  8. `[data-testid="rail-runs"]` no longer exists anywhere (supersession).
  9. EC18 (amended): the canvas still owns >80% of the viewport width on a
     direct doc route (drawer closed default), the 28px row notwithstanding.

Captures (§10.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback3-N-bar-collapsed.png   bar with live counts under the board
  feedback3-N-sheet-open.png      sheet, active-before-terminal rows
  feedback3-N-bar-immersive.png   Document mode: canvas, version strip, bar

Finally: `npm run lint` must exit 0 with zero raw-color findings (EC15 is
ERROR repo-wide).

Slice-BD re-scope audit (DES-UX-002 §8.3): the design doc directed a "steer
textarea assertions" re-scope AT THIS RIG — a doc drift: this rig is the runs
bottom panel and asserts no steer textarea anywhere. The steer textarea's
contract lives in tests/SteeringGate*.test.tsx, re-scoped there to the
pre-populated state contract (the testid switches to `amend-prepopulated`
only when a session draft existed at mount; blank mounts keep
`steering-amend`, so every assertion in this rig and those tests holds
unchanged). Verified green post-BD as this slice's regression suite.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK3N_PORT (default 4362),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK3N_PORT = int(os.environ.get("FEEDBACK3N_PORT", "4362"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK3N_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server; metrics_ws ON (the burn drip = $0.42) ─────
start_server(FEEDBACK3N_PORT, dist)
set_fixture(ORIGIN, metrics_ws=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []
api_requests: list[str] = []

BAR_GEOM = """() => {
  const b = document.querySelector('[data-testid="runs-bottom-bar"]');
  if (!b) return null;
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  return { position: cs.position, bottomGap: window.innerHeight - r.bottom,
           height: Math.round(r.height), left: r.left,
           right: Math.round(window.innerWidth - r.right) };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: api_requests.append(r.url) if "/api/v1/" in r.url else None)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── AC 1+2: the board — bar geometry, fixture counts, the spend fold ───────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="runs-bottom-bar"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)

    geom = page.evaluate(BAR_GEOM)
    geometry_ok = (geom is not None and geom["position"] == "fixed"
                   and geom["bottomGap"] == 0 and geom["height"] == 28
                   and geom["left"] == 0 and geom["right"] == 0)

    counts_ok = settled(
        """() => { const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                   return !!b && b.dataset.working === '2'
                       && b.dataset.gates === '2' && b.dataset.failed === '2'; }""",
        timeout=15000,
    )
    # The metrics_ws drip folds to $0.42 (0.04+0.11+0.09+0.18; the null-cost
    # frame never counts) — the TokenBurnSparkline fold, reused (§5.3).
    spend_ok = settled(
        """() => (document.querySelector('[data-testid="runs-bottom-bar"]')?.textContent ?? '')
              .includes('$0.42 observed')""",
        timeout=20000,
    )
    # Nothing under the bar: the app root reserves the 28px row (§5.2) — the
    # board's scroll container ends at or above the bar's top edge.
    reserved_ok = page.evaluate(
        """() => { const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                   const board = document.querySelector('[data-testid="project-board"]');
                   return !!b && !!board
                       && board.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1; }""")
    # §8.1 supersession: the rail's runs section is gone everywhere.
    rail_runs_gone = page.evaluate("""() => !document.querySelector('[data-testid="rail-runs"]')""")

    # ── Capture 1: bar with live counts under the board ────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback3-N-bar-collapsed.png"))

    # ── AC 7: the zero-request window — expand/hover/collapse fire nothing ─────
    page.wait_for_timeout(2000)  # let the board's own mount reads settle
    api_requests.clear()
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-bottom-sheet"]').wait_for(timeout=5000)

    # ── AC 3: sheet anatomy — count, ordering, real hrefs, the #gate deep link ─
    rows = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="runs-sheet-row"]'))
              .map(r => ({ id: r.dataset.runId, status: r.dataset.status,
                           href: r.getAttribute('href'), tag: r.tagName }))""")
    ACTIVE = {"planning", "distributing", "executing", "awaiting_human"}
    statuses = [r["status"] for r in rows]
    first_terminal = next((i for i, s in enumerate(statuses) if s not in ACTIVE), len(statuses))
    rows_ok = (
        0 < len(rows) <= 20
        and all(r["tag"] == "A" for r in rows)
        and all(s not in ACTIVE for s in statuses[first_terminal:])  # active precede terminal
        and {r["id"]: r["href"] for r in rows}.get("r-q3") == "/runs/r-q3#gate"
        and {r["id"]: r["href"] for r in rows}.get("r-upload") == "/runs/r-upload"
        and {r["id"]: r["href"] for r in rows}.get("r-auth") == "/runs/r-auth"
    )

    # ── Capture 2: the sheet, active-before-terminal rows ──────────────────────
    page.screenshot(path=str(VSHOTS / "feedback3-N-sheet-open.png"))

    # Hover a row, collapse via ▾, re-expand — still inside the request window.
    page.locator('[data-testid="runs-sheet-row"]').first.hover()
    page.locator('[data-testid="runs-sheet-collapse"]').click()
    sheet_collapses = settled("""() => !document.querySelector('[data-testid="runs-bottom-sheet"]')""", timeout=5000)
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-bottom-sheet"]').wait_for(timeout=5000)
    page.wait_for_timeout(1500)
    zero_requests_ok = len(api_requests) == 0

    # ── AC 5: Escape precedence — palette first, sheet second (§5.7, C9) ───────
    page.keyboard.press("Control+k")
    palette_opens = settled("""() => !!document.querySelector('[data-testid="command-palette"]')""", timeout=5000)
    page.keyboard.press("Escape")
    palette_only = settled(
        """() => !document.querySelector('[data-testid="command-palette"]')
              && !!document.querySelector('[data-testid="runs-bottom-sheet"]')""",
        timeout=5000,
    )
    page.keyboard.press("Escape")
    escape_closes_sheet = settled(
        """() => !document.querySelector('[data-testid="runs-bottom-sheet"]')""", timeout=5000)

    # ── AC 4: row click → the run page; the sheet unmounts ─────────────────────
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-sheet-row"][data-run-id="r-upload"]').click()
    row_click_ok = settled(
        """() => window.location.pathname === '/runs/r-upload'
              && !document.querySelector('[data-testid="runs-bottom-sheet"]')""",
        timeout=10000,
    )
    bar_on_run_page = page.evaluate("""() => !!document.querySelector('[data-testid="runs-bottom-bar"]')""")

    # ── AC 1: fixed = everywhere — presence + geometry across the routes ───────
    presence: dict = {}
    for route, ready in [
        ("/projects", '[data-testid="runs-bottom-bar"]'),
        ("/make", '[data-testid="make-dashboard"]'),  # slice O: the real dashboard
        ("/repos", '[data-testid="runs-bottom-bar"]'),
        ("/p/q3-review-deck/build", '[data-testid="mode-switcher"]'),
    ]:
        page.goto(f"{ORIGIN}{route}", wait_until="domcontentloaded")
        page.locator(ready).wait_for(timeout=30000)
        g = page.evaluate(BAR_GEOM)
        presence[route] = (g is not None and g["position"] == "fixed"
                           and g["bottomGap"] == 0 and g["height"] == 28)
    presence_ok = all(presence.values())

    # ── AC 2: the quiet phrase on an empty (all-terminal) listing ──────────────
    set_fixture(ORIGIN, no_runs=True)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="runs-bottom-bar"]').wait_for(timeout=30000)
    quiet_ok = settled(
        """() => { const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                   return !!b && b.dataset.working === '0'
                       && (b.textContent ?? '').includes('nothing running')
                       && !(b.textContent ?? '').includes('working'); }""",
        timeout=15000,
    )
    set_fixture(ORIGIN, no_runs=False)

    # ── AC 6: EC27 — entering Document collapses the open sheet ────────────────
    page.goto(f"{ORIGIN}/p/scratch/build", wait_until="domcontentloaded")
    page.locator('[data-testid="mode-switcher"]').wait_for(timeout=30000)
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-bottom-sheet"]').wait_for(timeout=5000)
    page.locator('[data-testid="mode-tab-document"]').click()
    ec27_ok = settled(
        """() => window.location.pathname === '/p/scratch/document'
              && !document.querySelector('[data-testid="runs-bottom-sheet"]')
              && document.querySelector('[data-testid="runs-bottom-bar"]')?.dataset.expanded === 'false'""",
        timeout=15000,
    )

    # ── AC 6 (the named hazard): the version strip and the bar never fight ─────
    # Create a doc through the real composer (the slice-6 journey) so the strip
    # has versions to render, then prove the §7.3 machinery under the new row.
    page.locator('[data-testid="doc-composer"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-composer"]').fill("Make me a deck for the Q3 review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-strip"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)

    overlap = page.evaluate(
        """() => { const s = document.querySelector('[data-testid="version-strip"]');
                   const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                   if (!s || !b) return null;
                   const sr = s.getBoundingClientRect(), br = b.getBoundingClientRect();
                   return { stripBottom: sr.bottom, barTop: br.top,
                            noOverlap: sr.bottom <= br.top + 0.5 }; }""")
    no_overlap_ok = overlap is not None and overlap["noOverlap"]

    # The auto-hide: 3s idle, hands off the mouse — the strip earns its exit.
    strip_hides = settled(
        """() => { const s = document.querySelector('[data-testid="version-strip"]');
                   return !!s && s.getAttribute('data-hidden') === 'true'
                       && getComputedStyle(s).opacity === '0'; }""",
        timeout=15000,
    )
    # The wake (the slice-F regression this design must not cause): drive the
    # mouse to the bottom edge OVER THE CANVAS — the sensor band's last 80px end
    # at the canvas edge, which now sits 28px above the viewport bottom (§5.5).
    page.mouse.move(600, 840)
    page.mouse.move(600, 860)
    strip_wakes = settled(
        """() => { const s = document.querySelector('[data-testid="version-strip"]');
                   return !!s && s.getAttribute('data-hidden') === 'false'
                       && parseFloat(getComputedStyle(s).opacity) > 0.9; }""",
        timeout=10000,
    )

    # ── Capture 3: Document mode — canvas, version strip, bar, no overlap ──────
    page.screenshot(path=str(VSHOTS / "feedback3-N-bar-immersive.png"))

    # ── AC 9: EC18 (amended) — the canvas fraction on a direct doc route ───────
    doc_url = page.evaluate("() => window.location.pathname")
    page.goto(f"{ORIGIN}{doc_url}", wait_until="domcontentloaded")
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)
    # Park the mouse mid-canvas (no rail hover-peek under measurement) and let
    # the rail's immersive collapse land first — the standalone rig's exact
    # protocol: EC18 is a steady-state, first-visit claim.
    page.mouse.move(720, 320)
    settled(
        """() => document.querySelector('[data-testid="left-rail"]')
              ?.getBoundingClientRect().width < 80""",
        timeout=10000,
    )
    settled(
        """() => { const c = document.querySelector('[data-testid="doc-canvas"]');
                   return !!c && c.getBoundingClientRect().width / window.innerWidth > 0.8; }""",
        timeout=10000,
    )
    ec18 = page.evaluate(
        """() => { const c = document.querySelector('[data-testid="doc-canvas"]');
                   return { ratio: c ? c.getBoundingClientRect().width / window.innerWidth : 0,
                            drawerClosed: !document.querySelector('[data-testid="thread-drawer"]'),
                            barPresent: !!document.querySelector('[data-testid="runs-bottom-bar"]') }; }""")
    ec18_ok = ec18["ratio"] > 0.8 and ec18["barPresent"]

    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([
        geometry_ok, counts_ok, spend_ok, reserved_ok, rail_runs_gone,
        rows_ok, sheet_collapses, zero_requests_ok, palette_opens,
        palette_only, escape_closes_sheet, row_click_ok, bar_on_run_page,
        presence_ok, quiet_ok, ec27_ok, no_overlap_ok, strip_hides,
        strip_wakes, ec18_ok,
    ]),
    "ac1_bar_geometry": geom,
    "ac1_geometry_ok": geometry_ok,
    "ac1_presence_per_route": presence,
    "ac2_counts_match_fixture": counts_ok,
    "ac2_spend_folds_drip": spend_ok,
    "ac2_quiet_phrase": quiet_ok,
    "geometry_row_reserved": reserved_ok,
    "ac8_rail_runs_absent": rail_runs_gone,
    "ac3_rows": rows,
    "ac3_rows_ok": rows_ok,
    "sheet_collapse_via_chevron": sheet_collapses,
    "ac7_zero_requests_in_window": zero_requests_ok,
    "ac7_requests_seen": api_requests[:10],
    "ac5_palette_opens_over_sheet": palette_opens,
    "ac5_escape_closes_palette_only": palette_only,
    "ac5_escape_then_closes_sheet": escape_closes_sheet,
    "ac4_row_click_lands_run_page": row_click_ok,
    "bar_present_on_run_page": bar_on_run_page,
    "ac6_ec27_document_collapses_sheet": ec27_ok,
    "ac6_strip_bar_no_overlap": overlap,
    "ac6_strip_auto_hides": strip_hides,
    "ac6_strip_wakes_on_bottom_proximity": strip_wakes,
    "ac9_ec18": ec18,
    "ac9_ec18_ok": ec18_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("feedback3-N-bar-collapsed.png", "feedback3-N-sheet-open.png",
                     "feedback3-N-bar-immersive.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-N DOM assertions did not all hold — see dom_acs")

# ── 4. Lint posture: exit 0, zero raw-color findings (EC15 error repo-wide) ───
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
raw_color_findings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and raw_color_findings == 0,
    "exit_code": r.returncode,
    "raw_color_findings_repo_wide": raw_color_findings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with zero raw-color findings — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
