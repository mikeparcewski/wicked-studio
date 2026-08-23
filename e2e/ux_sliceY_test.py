#!/usr/bin/env python3
"""
ux_sliceY_test.py — the DES-UX-001 slice-Y gate: ONE canonical runs surface
(§7.4, C1 — "every 'All runs ›' affordance lands on /runs: done-only, no
timestamps, no filters — 13 failed runs invisible").

Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with the
`river` corpus on (real attach clocks, so the landing lede has finished runs
to link). The §7.4 DOM ACs, verbatim mapping:

  1. every anchor whose text matches /All runs/ resolves to `/work` (DOM-wide
     assert, sheet expanded so runs-bar-all AND runs-sheet-all are both in the
     DOM; the landing's all-runs-link rides the same sweep) — and every
     lede-segment number lands on /work or the in-page #needs-you anchor,
     never the retired /runs listing;
  2. navigating `/runs` lands on `/work` (a REPLACE redirect; the search
     string rides along — /runs?filter=failed keeps its failure context);
  3. following a failed run's "All runs" entry point (the FailureBanner's
     failure-context link) renders the Failed filter active
     (`data-filter="failed"` on the tablist, Failed tab aria-selected);
  + the protections (§9/§11.1): `/runs/:id` (run detail) and `/runs/new`
    (the composer) stay routable — only the bare listing retires.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-Y-work-canonical.png   /work reached via the retired /runs route — the one
                            canonical runs surface: tabs, search, metrics

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4386),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4386"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# r-auth is the fixture's fresh failed run; its thread renders FailureBanner.
AUTH_THREAD = "/p/auth-refactor/build/r-auth"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


# ── 1. The same-origin build + the shared W2 fixture, river clocks on ──────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, river=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── Scene 1 (AC "every affordance"): the DOM-wide all-runs sweep ───────────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # Expand the sheet so BOTH its all-runs anchors (bar + sheet header) are in
    # the DOM for the sweep — the sheet itself is otherwise untouched (§9).
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-bottom-sheet"]').wait_for(timeout=5000)
    sweep = page.evaluate(
        """() => {
          const anchors = Array.from(document.querySelectorAll('a'))
            .filter(a => /All runs/.test(a.textContent ?? ''));
          const ledes = Array.from(
            document.querySelectorAll('[data-testid="lede-segment"]'));
          return {
            allRunsCount: anchors.length,
            allRunsTargets: anchors.map(a => new URL(a.href).pathname),
            allRunsToWork: anchors.length > 0
              && anchors.every(a => new URL(a.href).pathname === '/work'),
            ledeHrefs: ledes.map(a => a.getAttribute('href')),
            ledeClean: ledes.every(a => {
              const h = a.getAttribute('href') ?? '';
              return h === '#needs-you' || h === '/work' || h.startsWith('/work?');
            }),
            bareRunsHrefs: Array.from(document.querySelectorAll('a[href="/runs"]')).length,
          };
        }""")
    check("all_runs_sweep",
          sweep["allRunsToWork"] and sweep["allRunsCount"] >= 3
          and sweep["ledeClean"] and sweep["bareRunsHrefs"] == 0,
          **sweep)
    page.keyboard.press("Escape")

    # The landing's header affordance actually NAVIGATES to /work (real link).
    page.locator('[data-testid="all-runs-link"]').click()
    landed = settled("""() => window.location.pathname === '/work'
        && !!document.querySelector('[role="tablist"][data-filter]')""")
    check("landing_affordance_lands_on_work", landed,
          path=page.evaluate("() => location.pathname"))

    # ── Scene 2 (AC "navigating /runs lands on /work"): the replace redirect ───
    page.goto(f"{ORIGIN}/runs", wait_until="domcontentloaded")
    redirected = settled(
        """() => window.location.pathname === '/work'
              && document.querySelector('[role="tablist"]')?.getAttribute('data-filter') === 'all'
              && !document.querySelector('[data-testid="project-board"]')""")
    check("runs_redirects_to_work", redirected,
          path=page.evaluate("() => location.pathname + location.search"))
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # ── Capture: the one canonical runs surface, reached via the retired route ─
    page.screenshot(path=str(VSHOTS / "ux-Y-work-canonical.png"))

    # The search string rides the redirect (context-sensitive entry, §7.4).
    page.goto(f"{ORIGIN}/runs?filter=failed", wait_until="domcontentloaded")
    carried = settled(
        """() => window.location.pathname === '/work'
              && window.location.search === '?filter=failed'
              && document.querySelector('[role="tablist"]')?.getAttribute('data-filter') === 'failed'""")
    check("redirect_carries_filter", carried,
          path=page.evaluate("() => location.pathname + location.search"))

    # ── Scene 3 (AC "failure context"): the FailureBanner's All-runs entry ─────
    page.goto(f"{ORIGIN}{AUTH_THREAD}", wait_until="domcontentloaded")
    page.locator('[data-testid="failure-banner"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    banner_href = page.locator('[data-testid="failure-all-runs"]').get_attribute("href")
    page.locator('[data-testid="failure-all-runs"]').click()
    failed_lens = settled(
        """() => window.location.pathname === '/work'
              && window.location.search === '?filter=failed'
              && document.querySelector('[role="tablist"]')?.getAttribute('data-filter') === 'failed'""")
    failed_tab = page.evaluate(
        """() => ({
          selected: document.getElementById('work-tab-failed')?.getAttribute('aria-selected'),
          rows: Array.from(document.querySelectorAll('[data-testid="run-link"], [role="tabpanel"] a'))
            .length,
          panelText: document.querySelector('[role="tabpanel"]')?.textContent ?? '',
        })""")
    check("failure_context_lands_failed",
          failed_lens and banner_href == "/work?filter=failed"
          and failed_tab["selected"] == "true"
          and "refactor the auth middleware" in failed_tab["panelText"],
          banner_href=banner_href, **failed_tab)

    # ── Scene 4 (the protections): /runs/:id and /runs/new stay routable ───────
    # A filed run's flat bookmark keeps its §1.5 legacy redirect INTO THE SHELL
    # (never to /work); the run view renders.
    page.goto(f"{ORIGIN}/runs/r-auth", wait_until="domcontentloaded")
    detail_ok = settled(
        """() => window.location.pathname.endsWith('/r-auth')
              && window.location.pathname !== '/work'
              && !!document.querySelector('[data-testid="failure-banner"]')""")
    check("run_detail_stays_routable", detail_ok,
          path=page.evaluate("() => location.pathname"))

    # The composer keeps its route: /runs/new never redirects.
    page.goto(f"{ORIGIN}/runs/new", wait_until="domcontentloaded")
    composer_ok = settled(
        """() => window.location.pathname === '/runs/new'
              && !!document.querySelector('[data-testid="launch-problem"]')""")
    check("composer_stays_routable", composer_ok,
          path=page.evaluate("() => location.pathname"))

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
