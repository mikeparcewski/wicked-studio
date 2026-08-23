#!/usr/bin/env python3
"""
ux_sliceW_test.py — the DES-UX-001 slice-W gate: reconcile the numbers (§5,
the campaign's A5 MAJOR — "Right rail 'No usage reported yet' beside status bar
'$0.12 observed'; 'RUNS (24H) 1 failed' vs unlabeled '12 failed'; 'ACTIVE RUNS
(0)' directly above two listed runs").

One rule, mechanically enforced (§5.3): every displayed metric has exactly one
selector (`src/board/metrics.ts`), and every count names its window (EC39 —
"24h", "all", "this session"; the unlabeled number is a defect class).

The §5.5 DOM ACs, verbatim mapping:

  1. With the W2 fixture (metrics_ws burn drip on): the bottom bar's counts,
     the landing lede's numbers, and the margin notes agree exactly — this rig
     derives the expected values from the fixture's own constants and asserts
     all the surfaces render them. The bar's "2 failed (all)" beside the
     lede's "1 failed (24h)" is two LABELED truths, not a contradiction: both
     windows are named in the DOM.
  2. Every element matching `[data-testid$="-count"]` carries `data-window`
     and a visible window label beside it; a lint-style grep asserts no
     component folds `cliUsage` frames outside `src/board/metrics.ts`, and
     that every §5.1 offender imports the shared module.
  3. A dashboard header's `data-count` equals its list's rendered row count on
     the same paint (set-equality — the "ACTIVE RUNS (0) over two rows"
     regression pin), on the project dashboard's tiles AND the Build tab's
     EC34 count.
  + silent filters declare themselves (§5.3 adjacency): the Build list's cap
    says "showing N of M" in the same breath as the rows it clips.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-W-windows.png   the landing: lede + its 24h label, spend + its session
                     label, the bottom bar's counts + the "all" label — every
                     number windowed, all agreeing.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4385),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import (
    ATTACHED_AT,
    HIDE_GATE_TOASTS,
    NOW0,
    PROJECTS,
    REPO,
    RUNS,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4385"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
HOUR = 3_600_000

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


# ── The independent derivation (AC 1: computed from the fixture, never
#    snapshotted from the page) ─────────────────────────────────────────────────
#
# Window "all" (the bar): the unwindowed status fold over the run list — the
# orphan (executing, default ON) rides it.
TERMINAL = {"completed", "failed", "cancelled"}
ALL_RUNS = [v["session"] for v in RUNS] + [
    {"id": "r-orphan", "status": "executing"}]
EXP_WORKING = sum(1 for s in ALL_RUNS
                  if s["status"] not in TERMINAL and s["status"] != "awaiting_human")
EXP_GATES = sum(1 for s in ALL_RUNS if s["status"] == "awaiting_human")
EXP_FAILED_ALL = sum(1 for s in ALL_RUNS if s["status"] == "failed")

# Window "24h" (the lede + the margin outcome bar): terminal runs whose LAST
# observed clock is in-window. Clocks the page can honestly reach once the
# metrics_ws burn drip has fully landed: the attach clocks, the r-auth durable
# failure tail (13m — same side of the window as its attach), and the drip's
# ARRIVAL-stamped frames, which pull the two smokes (attach 6 DAYS out) into
# the observed window. r-legacy stays out (8-day tail, no drip frame).
DRIP_TOUCHED = {"r-upload", "r-smoke1", "r-smoke2"}
WINDOW_START = NOW0 - 24 * HOUR
EXP_FINISHED = EXP_PASSED = EXP_FAILED_24H = 0
for v in RUNS:  # the orphan is clockless and non-terminal either way
    s = v["session"]
    if s["status"] not in TERMINAL:
        continue
    attach = ATTACHED_AT.get(s["id"])
    in_window = (attach is not None and attach >= WINDOW_START) or s["id"] in DRIP_TOUCHED
    if not in_window:
        continue
    EXP_FINISHED += 1
    if s["status"] == "completed":
        EXP_PASSED += 1
    else:
        EXP_FAILED_24H += 1

BOARD_PROJECTS = [p for p in PROJECTS if p["status"] == "active" and p["id"] != "default"]

# The margin outcome bar buckets on the ATTACH clock alone (no arrival pull):
# q3 (gate), api (gate), upload (run), auth (fail) in-window; legacy + smokes +
# orphan unplaced.
EXP_BAR24_TOTAL = sum(1 for v in RUNS if ATTACHED_AT.get(v["session"]["id"], 0) >= WINDOW_START)
EXP_BAR24_UNPLACED = len(RUNS) + 1 - EXP_BAR24_TOTAL  # +1 = the clockless orphan

# The drip's costed dollars (uxfix_fixture burn_drip: 0.04 + 0.11 + 0.09 + 0.18;
# the null-cost frame must never fold to $0).
EXP_SPEND = "0.42"
EXP_SPEND_POINTS = "4"


def plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def compose_lede(finished: int, passed: int, failed: int, gates: int, live: int, projects: int) -> str:
    """The §7.3 grammar, independently implemented (drop-outs included)."""
    if finished == 0 and gates == 0 and live == 0:
        return f"All quiet. {plural(projects, 'project')}, nothing running, nothing waiting."
    s = "While you were away: "
    if finished > 0:
        split = ", ".join(x for x in (
            f"{passed} passed" if passed else None,
            f"{failed} failed" if failed else None) if x)
        s += f"{plural(finished, 'run')} finished — {split}"
    elif gates == 0:
        s += f"nothing finished — {plural(live, 'run')} still moving"
    if gates > 0:
        if finished > 0:
            s += " — and "
        s += f"{plural(gates, 'gate')} {'is' if gates == 1 else 'are'} waiting on you"
    return s + "."


EXPECTED_LEDE = compose_lede(EXP_FINISHED, EXP_PASSED, EXP_FAILED_24H,
                             EXP_GATES, EXP_WORKING, len(BOARD_PROJECTS))

# ── AC 2's lint-style grep: no component folds cliUsage outside the module ─────
SRC = REPO / "src"
offender_folds: list[str] = []
for path in sorted(SRC.rglob("*.tsx")):
    text = path.read_text(encoding="utf-8")
    if re.search(r"===\s*['\"]cliUsage['\"]", text):
        offender_folds.append(str(path.relative_to(REPO)))
check("no_inline_cliusage_folds", offender_folds == [], folds_found=offender_folds)

MUST_IMPORT = ["components/RunsBottomPanel.tsx", "components/NarrativeBand.tsx",
               "components/CenterDashboard.tsx", "components/TokenBurnSparkline.tsx",
               "components/RunOutcomeBar.tsx", "components/NotificationBell.tsx",
               "components/ProjectDashboard.tsx"]
missing_imports = [f for f in MUST_IMPORT
                   if "board/metrics.js" not in (SRC / f).read_text(encoding="utf-8")]
check("offenders_import_shared_module", missing_imports == [], missing=missing_imports)

# ── The same-origin build + the shared W2 fixture, burn drip ON ────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, metrics_ws=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    def goto(path: str) -> None:
        page.goto(f"{ORIGIN}{path}", wait_until="domcontentloaded")
        page.add_style_tag(content=HIDE_GATE_TOASTS)

    # ── Scene 1 (AC 1): the landing — every surface, one set of numbers ────────
    goto("/")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    # Settle on the drip having FULLY landed (4 costed frames), so every fold
    # below reads the same final store state on the same paint.
    page.wait_for_function(
        f"""() => document.querySelector('[data-testid="token-burn-sparkline"]')
                    ?.getAttribute('data-points') === '{EXP_SPEND_POINTS}'""",
        timeout=20000)
    page.wait_for_function(
        f"""expected => document.querySelector('[data-testid="landing-lede"]')
                          ?.textContent === expected""",
        arg=EXPECTED_LEDE, timeout=15000)

    facts = page.evaluate(
        """() => {
             const q = (sel) => document.querySelector(sel);
             const bar = q('[data-testid="runs-bottom-bar"]');
             const outcome = q('[data-testid="run-outcome-bar"]');
             const burn = q('[data-testid="token-burn-sparkline"]');
             return {
               barWorking: bar?.dataset.working ?? null,
               barGates: bar?.dataset.gates ?? null,
               barFailed: bar?.dataset.failed ?? null,
               barWindow: bar?.dataset.window ?? null,
               barText: (bar?.textContent ?? '').replace(/\\s+/g, ' '),
               barWindowLabel: q('[data-testid="runs-bar-window"]')?.textContent ?? null,
               barSpendLabel: q('[data-testid="runs-bar-spend-window"]')?.textContent ?? null,
               lede: q('[data-testid="landing-lede"]')?.textContent ?? null,
               ledeWindow: q('[data-testid="lede-window"]')?.textContent ?? null,
               ledeSpend: q('[data-testid="lede-spend"]')?.textContent ?? null,
               ledeSpendWindow: q('[data-testid="lede-spend-window"]')?.textContent ?? null,
               outcomeTotal: outcome?.dataset.total ?? null,
               outcomeUnplaced: outcome?.dataset.unplaced ?? null,
               outcomeWindow: outcome?.dataset.window ?? null,
               burnTotal: burn?.dataset.total ?? null,
               burnWindow: burn?.dataset.window ?? null,
               burnText: (burn?.textContent ?? '').replace(/\\s+/g, ' '),
             };
           }""")

    check("bar_counts_match_fixture",
          facts["barWorking"] == str(EXP_WORKING)
          and facts["barGates"] == str(EXP_GATES)
          and facts["barFailed"] == str(EXP_FAILED_ALL)
          and f"${EXP_SPEND} observed" in facts["barText"],
          expected={"working": EXP_WORKING, "gates": EXP_GATES, "failed": EXP_FAILED_ALL},
          **{k: facts[k] for k in ("barWorking", "barGates", "barFailed", "barText")})

    check("lede_matches_fixture", facts["lede"] == EXPECTED_LEDE,
          expected=EXPECTED_LEDE, lede=facts["lede"])

    # The §5.1 offender pair, reconciled: bar spend == lede spend == the burn
    # curve's endpoint — one selector, three surfaces, one number.
    check("spend_agrees_everywhere",
          facts["ledeSpend"] == f"${EXP_SPEND} observed"
          and f"${EXP_SPEND} observed" in facts["barText"]
          and facts["burnTotal"] == f"{float(EXP_SPEND):.4f}"
          and f"${EXP_SPEND}" in facts["burnText"],
          **{k: facts[k] for k in ("ledeSpend", "burnTotal", "burnText")})

    # EC39: "1 failed (24h)" beside "2 failed (all)" — both windows NAMED.
    check("windows_are_named",
          facts["barWindow"] == "all"
          and facts["barWindowLabel"] == "all"
          and facts["barSpendLabel"] == "this session"
          and facts["ledeWindow"] == "24h"
          and facts["ledeSpendWindow"] == "this session"
          and facts["outcomeWindow"] == "24h"
          and facts["burnWindow"] == "session"
          and "this session" in facts["burnText"],
          **{k: facts[k] for k in ("barWindow", "barWindowLabel", "barSpendLabel",
                                   "ledeWindow", "ledeSpendWindow", "outcomeWindow",
                                   "burnWindow")})

    # The margin's 24h outcome bar: the shared selector's totals on the honest
    # attach clock — in-window vs unplaced derived from the fixture.
    check("outcome_bar_24h_fold",
          facts["outcomeTotal"] == str(EXP_BAR24_TOTAL)
          and facts["outcomeUnplaced"] == str(EXP_BAR24_UNPLACED),
          expected={"total": EXP_BAR24_TOTAL, "unplaced": EXP_BAR24_UNPLACED},
          **{k: facts[k] for k in ("outcomeTotal", "outcomeUnplaced")})

    # ── Capture: the money shot — every number on one screen, windowed ─────────
    page.screenshot(path=str(VSHOTS / "ux-W-windows.png"))

    # ── Scene 2 (AC 2): the `-count` class contract, on a paint that HAS one ───
    goto("/p/upload-endpoint/build")
    page.locator('[data-testid="build-dashboard"]').wait_for(timeout=30000)
    page.locator('[data-testid="build-run-row"]').first.wait_for(timeout=15000)
    count_class = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid$="-count"]'))
                 .map(el => ({ id: el.getAttribute('data-testid'),
                               window: el.getAttribute('data-window'),
                               // The visible label lives in the same breath —
                               // the parent's text names the window word.
                               labeled: (el.parentElement?.textContent ?? '')
                                 .includes(el.getAttribute('data-window') ?? '\\u0000') }))""")
    check("count_class_carries_window",
          len(count_class) > 0 and all(c["window"] and c["labeled"] for c in count_class),
          counts=count_class)

    ec34 = page.evaluate(
        """() => ({
             count: document.querySelector('[data-testid="project-run-count"]')
               ?.textContent ?? null,
             rows: document.querySelectorAll('[data-testid="build-run-row"]').length,
             windowLabel: document.querySelector('[data-testid="project-run-count-window"]')
               ?.textContent ?? null,
           })""")
    check("build_count_equals_rows_and_windowed",
          ec34["count"] == str(ec34["rows"]) and ec34["windowLabel"] == "30d",
          **ec34)

    # ── Scene 3 (AC 3): dashboard headers count what their rows render ─────────
    goto("/p/upload-endpoint")
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=30000)
    page.locator('[data-testid="dashboard-run"]').first.wait_for(timeout=15000)
    tiles = page.evaluate(
        """() => {
             const grab = (tile, row) => {
               const t = document.querySelector(`[data-testid="${tile}"]`);
               return { count: t?.dataset.count ?? null,
                        rows: t ? t.querySelectorAll(`[data-testid="${row}"]`).length : null,
                        head: (t?.querySelector('p')?.textContent ?? '').replace(/\\s+/g, ' ') };
             };
             return { runs: grab('dashboard-runs', 'dashboard-run'),
                      gates: grab('dashboard-gates', 'dashboard-gate') };
           }""")
    check("dashboard_headers_set_equal",
          tiles["runs"]["count"] == str(tiles["runs"]["rows"])
          and tiles["gates"]["count"] == str(tiles["gates"]["rows"])
          # The head names the same collection its rows render — never the old
          # "Active runs (open-count)" over an all-runs list.
          and tiles["runs"]["head"].startswith(f"Runs ({tiles['runs']['rows']})"),
          **tiles)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
