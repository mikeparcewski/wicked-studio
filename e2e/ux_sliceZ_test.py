#!/usr/bin/env python3
"""
ux_sliceZ_test.py — the DES-UX-001 slice-Z gate: live execution +
bookmarkability (§7.6, C3 — "between 'Run started' and the verdict nothing
streams; the Term tab is an empty shell during runs; after Send the URL stays
/build/new so a refresh mid-run drops to a blank composer") + EC41 ("Running
means visible: between start and verdict, something true streams on the run's
own page").

Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with the
`project_dto` corpus on (POST /runs is a REAL launch — the daemon's {runId}
answer, the run riding the next GET /runs). The live frames are the fixture's
REAL relay shape: `unitOutputDelta` over the rig's own /ws — the standing
r-upload narration loop plus one-shot `extra_narration` dicts targeted at the
run this rig launches ({session, ord, text} — the slice-Z fixture extension).

The §7.6 DOM ACs, verbatim mapping:

  1. submitting the composer changes `location.pathname` to the run's URL
     before first paint of the run view — the composer is GONE the moment the
     path flips (what renders under the run URL is the honest pending state or
     the run view, never `launch-problem`), and history BACK returns to the
     composer;
  2. with the fixture dripping `unitOutputDelta` frames,
     `[data-testid="live-output"]` renders text within one frame cycle and
     grows monotonically (two one-shot drips, length strictly increases, both
     lines present) — asserted on the run view AND inside the Term tab's
     `term-transcript` (the same region, one component, never an empty shell);
     the region carries the honest label verbatim ("Live output — the full
     transcript lands when the unit completes.");
  3. a reload mid-drip re-renders the run view (not the composer) with the
     live region resuming — the bookmarked run URL is the reload target;
  + the honest unresolved state (§7.6 banked contract): a run URL the index
    does not serve renders `run-pending` — never the composer.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-Z-live-output.png   the executing run's own page, live region streaming

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4397),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import time

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4397"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# The fixture's standing live run (executing, cursor unit ord 0 still `pending`
# on the DTO — exactly the status-flip-trails-the-deltas case EC41 exists for);
# its /ws loop drips one narration line per second. Filed in upload-endpoint,
# so the bookmarked flat URL redirects INTO the shell (§1.5) — the shell path
# is the stable reload target.
UPLOAD_THREAD = "/p/upload-endpoint/build/r-upload"

LAUNCH_INTENT = "wire the webhook retry backoff"
HONEST_LABEL = "Live output — the full transcript lands when the unit completes."

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


# ── 1. The same-origin build + the shared W2 fixture, real launches on ─────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, project_dto=True, orphan=False)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

# What renders under a run URL: 'composer' must NEVER appear once the path
# names a run (the C3 defect); 'pending' and 'thread' are both honest.
SURFACE_EXPR = """() => ({
  path: window.location.pathname,
  composer: !!document.querySelector('[data-testid="launch-problem"]'),
  pending: !!document.querySelector('[data-testid="run-pending"]'),
  thread: !!document.querySelector('[data-testid="thread"]'),
})"""

LIVE_TEXT_EXPR = """() => {
  const region = document.querySelector('[data-testid="live-output"]');
  if (!region) return null;
  const label = region.querySelector('[data-testid="live-output-label"]');
  const pre = region.querySelector('pre');
  return { label: label?.textContent ?? null,
           text: pre?.textContent ?? '',
           len: (pre?.textContent ?? '').length };
}"""

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

    def surface() -> dict:
        return page.evaluate(SURFACE_EXPR)

    # ── Scene 1 (AC 1): launch → the run's URL, composer gone, back returns ────
    page.goto(f"{ORIGIN}/runs/new", wait_until="domcontentloaded")
    page.locator('[data-testid="launch-problem"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="launch-problem"]').fill(LAUNCH_INTENT)
    page.locator('[data-testid="launch-submit"]').click()

    # The path flips to the run's URL — and the FIRST surface painted under it
    # is honest: pending state or run view, never the composer.
    navigated = settled(
        """() => window.location.pathname === '/runs/r-launched-1'
              && !document.querySelector('[data-testid="launch-problem"]')
              && (!!document.querySelector('[data-testid="run-pending"]')
                  || !!document.querySelector('[data-testid="thread"]'))""",
        timeout=15000)
    check("launch_navigates_to_run_url", navigated, **surface())

    # The run view itself resolves (one live-update cycle: the debounced
    # GET /runs the launch triggered lists r-launched-1).
    resolved = settled(
        """() => window.location.pathname === '/runs/r-launched-1'
              && !!document.querySelector('[data-testid="thread"]')""",
        timeout=15000)
    check("run_view_resolves", resolved, **surface())

    # History honesty: BACK returns to the composer (pushState, never replace).
    page.go_back()
    back_ok = settled(
        """() => window.location.pathname === '/runs/new'
              && !!document.querySelector('[data-testid="launch-problem"]')""",
        timeout=15000)
    check("back_returns_to_composer", back_ok, **surface())

    # ── Scene 2 (AC 2, run view): real unitOutputDelta frames render within one
    #    frame cycle and grow monotonically ─────────────────────────────────────
    # The bookmarked run URL, cold (a full load — the runtime store starts
    # empty; every byte the region shows arrives over /ws from here on).
    page.goto(f"{ORIGIN}/runs/r-launched-1", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # No frames yet: the live region is absent, not a fake placeholder.
    pre_drip = page.evaluate(LIVE_TEXT_EXPR)
    check("live_region_absent_before_frames", pre_drip is None, pre_drip=pre_drip)

    # Drip 1 — one REAL frame at the launched run (the /ws loop drains
    # extra_narration once per ~1s tick; one frame cycle + margin).
    t0 = time.time()
    set_fixture(ORIGIN, extra_narration=[
        {"session": "r-launched-1", "ord": 0, "text": "Z-LIVE-alpha: probing retry backoff"}])
    first = settled(
        """() => {
          const pre = document.querySelector('[data-testid="live-output"] pre');
          return !!pre && pre.textContent.includes('Z-LIVE-alpha');
        }""",
        timeout=10000)
    drip1 = page.evaluate(LIVE_TEXT_EXPR)
    check("live_region_renders_first_frame",
          first and drip1 is not None and drip1["label"] == HONEST_LABEL,
          seconds_to_render=round(time.time() - t0, 2), **(drip1 or {}))

    # Drip 2 — the region grows MONOTONICALLY: strictly longer, both lines kept.
    set_fixture(ORIGIN, extra_narration=[
        {"session": "r-launched-1", "ord": 0, "text": "Z-LIVE-beta: backoff curve applied"}])
    grew = settled(
        """(prevLen) => {
          const pre = document.querySelector('[data-testid="live-output"] pre');
          return !!pre && pre.textContent.length > prevLen
              && pre.textContent.includes('Z-LIVE-alpha')
              && pre.textContent.includes('Z-LIVE-beta');
        }""",
        arg=drip1["len"], timeout=10000)
    drip2 = page.evaluate(LIVE_TEXT_EXPR)
    check("live_region_grows_monotonically",
          grew and drip2["len"] > drip1["len"],
          len_before=drip1["len"], len_after=drip2["len"])

    # ── Scene 3 (AC 3): a reload mid-drip re-renders the run view, live region
    #    resuming — never the composer ──────────────────────────────────────────
    page.reload(wait_until="domcontentloaded")
    after_reload = settled(
        """() => !document.querySelector('[data-testid="launch-problem"]')
              && (!!document.querySelector('[data-testid="run-pending"]')
                  || !!document.querySelector('[data-testid="thread"]'))""",
        timeout=15000)
    check("reload_never_composer", after_reload, **surface())
    page.locator('[data-testid="thread"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    set_fixture(ORIGIN, extra_narration=[
        {"session": "r-launched-1", "ord": 0, "text": "Z-LIVE-gamma: resumed after reload"}])
    resumed = settled(
        """() => {
          const pre = document.querySelector('[data-testid="live-output"] pre');
          return !!pre && pre.textContent.includes('Z-LIVE-gamma');
        }""",
        timeout=10000)
    check("reload_live_region_resumes", resumed,
          **(page.evaluate(LIVE_TEXT_EXPR) or {}), **surface())

    # The honest unresolved state: a run URL the daemon does not serve renders
    # run-pending (with the index loaded, the honest not-listed copy) — never
    # the composer.
    page.goto(f"{ORIGIN}/runs/r-ghost", wait_until="domcontentloaded")
    ghost_ok = settled(
        """() => !!document.querySelector('[data-testid="run-pending"]')
              && !document.querySelector('[data-testid="launch-problem"]')""",
        timeout=15000)
    check("unknown_run_renders_pending", ghost_ok, **surface())

    # ── Scene 4 (AC 2, Term tab): the SAME live region leads the Term modal —
    #    never an empty shell mid-run ───────────────────────────────────────────
    # The standing executing run: its /ws loop drips one narration line per
    # second unprompted, so the run view streams on arrival (EC41 on a run
    # whose cursor unit the DTO still calls `pending`).
    page.goto(f"{ORIGIN}{UPLOAD_THREAD}", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    upload_live = settled(
        """() => {
          const pre = document.querySelector('[data-testid="live-output"] pre');
          return !!pre && pre.textContent.length > 0;
        }""",
        timeout=15000)
    check("standing_run_streams_on_run_view", upload_live,
          **(page.evaluate(LIVE_TEXT_EXPR) or {}))

    # ── Capture: the executing run's own page, live region streaming ───────────
    page.screenshot(path=str(VSHOTS / "ux-Z-live-output.png"))

    # The Term button announces the live record, and the modal leads with it.
    page.locator("button[aria-label=\"View this run's live output\"]").click()
    term = settled(
        """() => {
          const t = document.querySelector('[data-testid="term-transcript"]');
          const pre = t?.querySelector('[data-testid="live-output"] pre');
          return !!t && !!pre && pre.textContent.length > 0;
        }""",
        timeout=15000)
    term_state = page.evaluate(
        """() => {
          const t = document.querySelector('[data-testid="term-transcript"]');
          const label = t?.querySelector('[data-testid="live-output-label"]');
          const len0 = t?.querySelector('[data-testid="live-output"] pre')?.textContent.length ?? 0;
          return { label: label?.textContent ?? null, len: len0,
                   title: Array.from(document.querySelectorAll('h2, h3, [role="dialog"] *'))
                     .some(el => (el.textContent ?? '').trim() === "This run's live output") };
        }""")
    # The modal's region keeps streaming too (the loop drips ~1/s).
    term_grows = settled(
        """(prevLen) => {
          const pre = document.querySelector(
            '[data-testid="term-transcript"] [data-testid="live-output"] pre');
          return !!pre && pre.textContent.length > prevLen;
        }""",
        arg=term_state["len"], timeout=10000)
    check("term_tab_leads_with_live_region",
          term and term_grows and term_state["label"] == HONEST_LABEL and term_state["title"],
          **term_state)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
