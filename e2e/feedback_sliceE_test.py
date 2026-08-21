#!/usr/bin/env python3
"""
feedback_sliceE_test.py — the DES-FEEDBACK-001 slice-E gate: home metrics bar
(§2) + repo profile visuals (§3), against the shared W2 fixture
(uxfix_fixture.py) with the `metrics_ws` + `repo` switches on.

The slice DOM ACs, verbatim from §8.3:

  1. `[data-testid="metrics-bar"]` is present on the home board;
  2. it contains `[data-testid="run-outcome-bar"]`,
     `[data-testid="gate-latency-chart"]`, `[data-testid="token-burn-sparkline"]`
     — each with a `data-question` attribute matching its §2.1 named question;
  3. no `<script>` tags for chart libraries are in the page HTML;
  4. every `fill`/`stroke` on chart elements resolves from `var()` references
     (EC15) — EXCEPT the sanctioned linguist hexes on the repo page (§3.3, the
     ONLY raw-color exemption in the codebase);
  5. `[data-testid="language-bar"]` is present on the repo profile page.

Plus what the slice means beyond its testids:

  - WIRE HONESTY: the outcome bar buckets on the membership attach clock (the
    one per-run timestamp the wire carries), the burn tile folds REAL cliUsage
    frames (`costUsd: null` never becomes $0.00), the cadence chart lives at
    the git-history wire's own resolution (20 commits, %ar relative dates);
  - the wall + live feed are UNCHANGED beneath the bar (the slice-2 NEEDS YOU
    order and the live feed still hold — §8.3 preservation);
  - the quiet-band rows carry the 7-day ProjectSparkline (--ink-dim bars);
  - under 900px the gate-latency tile hides (§2.2).

DELIBERATELY NOT frozen-clock: the burn + latency tiles fold ARRIVAL clocks
(Date.now at ingest); freezing the page clock would collapse every arrival to
one instant and the cumulative fold to a point. Ages in these two captures are
therefore approximate ("35s" not "30s") — every assertion is on structure, not
rendered ages.

Captures (§8.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback-E-home-metrics.png   the W2 board with the metrics bar populated
  feedback-E-repo-profile.png   the repo profile: language bar, cadence, hotspots

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 (delete a stale dist-sameorigin/ when the source changed).
Env knobs: FEEDBACK_PORT (default 4355), SKIP_STUDIO_BUILD. Prints a JSON
report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4355"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# §2.1's named operator questions, verbatim (EC19).
QUESTIONS = {
    "run-outcome-bar": "Is the system healthy right now?",
    "gate-latency-chart": "Am I answering gates quickly or letting things stall?",
    "token-burn-sparkline": "What am I spending, is it accelerating?",
}

# The sanctioned linguist hexes (§3.3) as jsdom/Chromium-normalized rgb() —
# the ONLY raw colors allowed anywhere, and only on the repo profile.
LINGUIST_RGB = {
    "typescript": "rgb(49, 120, 198)",   # #3178c6
    "javascript": "rgb(247, 223, 30)",   # #f7df1e
    "css":        "rgb(86, 61, 124)",    # #563d7c
    "python":     "rgb(53, 114, 165)",   # #3572a5
    "rust":       "rgb(222, 165, 132)",  # #dea584
    "go":         "rgb(0, 173, 216)",    # #00add8
}

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build ────────────────────────────────────────────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture, slice-E switches on ──────────────────────────────
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, metrics_ws=True, repo=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0,
                                     "metrics_ws": True, "repo": True}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ══ Scene 1 — home board with the metrics bar (§2) ═════════════════════════
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="metrics-bar"]').wait_for(timeout=30000)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('13px "Inter"')
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    # Settle: outcome bar bucketed off the members read (4 in-window W2 runs),
    # both open gates reconciled into latency dots, and the burn drip drained
    # (4 costed frames — the costUsd:null one must NOT count).
    outcome_ok = settled(
        """() => document.querySelector('[data-testid="run-outcome-bar"]')
                   ?.getAttribute('data-total') === '4'""")
    gates_ok = settled(
        """() => document.querySelector('[data-testid="gate-latency-chart"]')
                   ?.getAttribute('data-open') === '2'""")
    burn_ok = settled(
        """() => document.querySelector('[data-testid="token-burn-sparkline"]')
                   ?.getAttribute('data-points') === '4'""")

    # §8.3 preservation: the slice-2 NEEDS YOU order + the live feed, unchanged.
    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )

    home = page.evaluate(
        """() => {
             const bar = document.querySelector('[data-testid="metrics-bar"]');
             const tile = (id) => bar ? bar.querySelector(`[data-testid="${id}"]`) : null;
             const shapes = bar ? Array.from(bar.querySelectorAll(
               'rect, circle, line, polyline, polygon, stop')) : [];
             const paints = shapes.map((el) => ({
               tag: el.tagName.toLowerCase(),
               fill: el.getAttribute('fill'),
               stroke: el.getAttribute('stroke'),
               stop: el.getAttribute('stop-color'),
             }));
             // EC15: every painted attribute is a var() reference (the burn
             // area's url(#gradient) is a reference INTO var()-colored stops).
             const raw = paints.filter((p) => [p.fill, p.stroke, p.stop].some((v) =>
               v !== null && v !== 'none' && !v.startsWith('var(--') && !v.startsWith('url(#')));
             // And each var() resolves to a real computed color on screen.
             const resolved = shapes.every((el) => {
               const cs = getComputedStyle(el);
               return (cs.fill === 'none' || cs.fill.startsWith('rgb') || cs.fill.startsWith('url'))
                   && (cs.stroke === 'none' || cs.stroke.startsWith('rgb'));
             });
             const scripts = Array.from(document.querySelectorAll('script'))
               .map((s) => s.getAttribute('src') || '')
               .filter((src) => /chart|d3|recharts|echarts|plotly|highcharts/i.test(src));
             const barCs = bar ? getComputedStyle(bar) : null;
             return {
               barPresent: !!bar,
               barHeight: bar ? bar.getBoundingClientRect().height : null,
               barAboveWall: (() => {
                 const wall = document.querySelector('[data-testid="project-board"]');
                 return !!bar && !!wall
                   && bar.getBoundingClientRect().bottom <= wall.getBoundingClientRect().top + 1;
               })(),
               barBg: barCs ? barCs.backgroundColor : null,
               railBg: (() => {
                 const probe = document.createElement('div');
                 probe.style.background = 'var(--surface-rail)';
                 document.body.appendChild(probe);
                 const c = getComputedStyle(probe).backgroundColor;
                 probe.remove();
                 return c;
               })(),
               questions: Object.fromEntries(
                 ['run-outcome-bar', 'gate-latency-chart', 'token-burn-sparkline']
                   .map((id) => [id, tile(id)?.getAttribute('data-question') ?? null])),
               outcomeRects: tile('run-outcome-bar')?.querySelectorAll('rect').length ?? 0,
               outcomeUnplaced: tile('run-outcome-bar')?.getAttribute('data-unplaced') ?? null,
               gateDots: tile('gate-latency-chart')?.querySelectorAll('circle').length ?? 0,
               thresholdDashed: tile('gate-latency-chart')
                 ?.querySelector('line')?.getAttribute('stroke-dasharray') ?? null,
               burnTotal: tile('token-burn-sparkline')?.getAttribute('data-total') ?? null,
               burnText: tile('token-burn-sparkline')?.textContent ?? '',
               rawPaints: raw,
               computedResolved: resolved,
               chartLibScripts: scripts,
               liveFeedPresent: !!document.querySelector('[data-testid="live-feed"]'),
             };
           }"""
    )

    # ── Capture 1: the home board with the metrics bar populated ───────────────
    page.screenshot(path=str(VSHOTS / "feedback-E-home-metrics.png"))

    # ── The quiet-band 7-day sparkline (§2.1): expand QUIET, find smoke-tests —
    #    its two runs attached 6d ago sit inside the window. --ink-dim bars. ──
    page.locator('[data-testid="band-quiet-toggle"]').click()
    # The quiet grid is WINDOWED against the board scroller — smoke-tests sorts
    # near the tail, so scroll until its card mounts.
    for _ in range(40):
        if page.evaluate(
            """() => !!document.querySelector(
                 '[data-testid="project-card"][data-project-id="smoke-tests"]')"""
        ):
            break
        at_bottom = page.evaluate(
            """() => { const s = document.querySelector('[data-testid="project-board"]');
                       if (!s) return true;
                       s.scrollTop += Math.max(200, s.clientHeight / 2);
                       return s.scrollTop + s.clientHeight >= s.scrollHeight - 2; }"""
        )
        page.wait_for_timeout(150)
        if at_bottom:
            break
    page.locator('[data-testid="project-card"][data-project-id="smoke-tests"]').wait_for(timeout=10000)
    quiet_spark = page.evaluate(
        """() => {
             const card = document.querySelector(
               '[data-testid="project-card"][data-project-id="smoke-tests"]');
             const spark = card ? card.querySelector('[data-testid="project-sparkline"]') : null;
             const rects = spark ? Array.from(spark.querySelectorAll('rect')) : [];
             return {
               present: !!spark,
               total: spark?.getAttribute('data-total') ?? null,
               question: spark?.getAttribute('data-question') ?? null,
               fills: rects.map((r) => r.getAttribute('fill')),
             };
           }"""
    )
    page.locator('[data-testid="band-quiet-toggle"]').click()  # collapse back
    page.evaluate(
        """() => { const s = document.querySelector('[data-testid="project-board"]');
                   if (s) s.scrollTop = 0; }""")

    # ── §2.2: under 900px the gate-latency tile hides ──────────────────────────
    page.set_viewport_size({"width": 860, "height": 900})
    narrow = page.evaluate(
        """() => {
             const mid = document.querySelector('.wk-metrics-mid');
             return {
               midHidden: mid ? getComputedStyle(mid).display === 'none' : false,
               barPresent: !!document.querySelector('[data-testid="metrics-bar"]'),
             };
           }"""
    )
    page.set_viewport_size({"width": 1440, "height": 900})

    # ══ Scene 2 — the repo profile (§3) ════════════════════════════════════════
    page.goto(f"{ORIGIN}/repo-detail/studio-api", wait_until="domcontentloaded")
    page.locator('[data-testid="language-bar"][data-state="ready"]').wait_for(timeout=30000)
    page.locator('[data-testid="commit-cadence"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    repo = page.evaluate(
        """(linguist) => {
             const bar = document.querySelector('[data-testid="language-bar"]');
             const segs = Array.from(document.querySelectorAll('[data-testid="language-segment"]'));
             const cadence = document.querySelector('[data-testid="commit-cadence"]');
             const cadenceRects = cadence
               ? Array.from(cadence.querySelectorAll('rect')).map((r) => r.getAttribute('fill'))
               : [];
             const excerpt = document.querySelector('[data-testid="hotspots-excerpt"]');
             const buttons = Array.from(document.querySelectorAll('button')).map((b) => b.textContent || '');
             return {
               barPresent: !!bar,
               barState: bar?.getAttribute('data-state') ?? null,
               segLangs: segs.map((s) => s.getAttribute('data-lang')),
               // §3.3: the segments carry EXACTLY the sanctioned linguist colors
               // (raw hex is legal here and nowhere else).
               segColors: segs.map((s) => getComputedStyle(s).backgroundColor),
               segSanctioned: segs.every((s) => {
                 const lang = s.getAttribute('data-lang');
                 const c = getComputedStyle(s).backgroundColor;
                 return c === linguist[lang] || (!(lang in linguist) && c !== '');
               }),
               labelText: Array.from(document.querySelectorAll('[data-testid="language-label"]'))
                 .map((l) => (l.textContent || '').trim()),
               unitNamed: (bar?.textContent || '').includes('by files indexed'),
               cadenceState: cadence?.getAttribute('data-state') ?? null,
               cadenceTotal: cadence?.getAttribute('data-total') ?? null,
               cadenceQuestion: cadence?.getAttribute('data-question') ?? null,
               cadenceFillsVar: cadenceRects.length > 0
                 && cadenceRects.every((f) => f && f.startsWith('var(--')),
               cadenceCaption: (cadence?.textContent || ''),
               excerptPresent: !!excerpt,
               excerptCount: excerpt?.getAttribute('data-count') ?? null,
               viewAllPresent: !!document.querySelector('[data-testid="hotspots-view-all"]'),
               graphButtonPresent: buttons.some((t) => t.includes('Open Graph')),
             };
           }""",
        LINGUIST_RGB,
    )

    # ── Capture 2: the repo profile with its visuals ────────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback-E-repo-profile.png"))

    page.close()
    ctx.close()
    browser.close()

report["steps"]["metrics_bar"] = {
    "ok": all([
        fonts_ok, outcome_ok, gates_ok, burn_ok,
        home["barPresent"],
        home["barHeight"] == 64,
        home["barAboveWall"],
        home["barBg"] == home["railBg"],  # --surface-rail band (§2.2)
        home["questions"] == QUESTIONS,   # EC19, verbatim
        home["outcomeRects"] >= 3,        # run/gate/fail stacks over the 4 in-window runs
        home["outcomeUnplaced"] == "4",   # legacy(8d) + smokes(6d) + clockless orphan: excluded, counted
        home["gateDots"] == 2,
        home["thresholdDashed"] == "3 3",
        home["burnTotal"] == "0.4200",    # 0.04+0.11+0.09+0.18 — the null-cost frame did NOT fold
        "$0.42" in home["burnText"],
    ]),
    "web_fonts": fonts_ok,
    "outcome_settled": outcome_ok, "gates_settled": gates_ok, "burn_settled": burn_ok,
    **{k: home[k] for k in ("barPresent", "barHeight", "barAboveWall", "barBg", "railBg",
                            "questions", "outcomeRects", "outcomeUnplaced", "gateDots",
                            "thresholdDashed", "burnTotal")},
    "screenshot": str(VSHOTS / "feedback-E-home-metrics.png"),
}
report["steps"]["no_chart_library_and_ec15"] = {
    "ok": all([
        home["chartLibScripts"] == [],
        home["rawPaints"] == [],
        home["computedResolved"],
    ]),
    "chart_lib_scripts": home["chartLibScripts"],
    "raw_paints": home["rawPaints"],
    "computed_resolved": home["computedResolved"],
}
report["steps"]["board_preserved"] = {
    "ok": all([order_ok, home["liveFeedPresent"]]),
    "needs_you_order": order_ok,
    "live_feed_present": home["liveFeedPresent"],
}
report["steps"]["quiet_sparkline"] = {
    "ok": all([
        quiet_spark["present"],
        quiet_spark["total"] == "2",
        quiet_spark["question"] == "Which of my quiet projects is quietly doing work?",
        len(quiet_spark["fills"]) >= 1,
        all(f == "var(--ink-dim)" for f in quiet_spark["fills"]),
    ]),
    **quiet_spark,
}
report["steps"]["narrow_hides_gate_tile"] = {
    "ok": narrow["midHidden"] and narrow["barPresent"],
    **narrow,
}
report["steps"]["repo_profile"] = {
    "ok": all([
        repo["barPresent"],
        repo["barState"] == "ready",
        # files per lang off the graph: ts 8, rust 3, python 2, js 1 — sorted.
        repo["segLangs"] == ["typescript", "rust", "python", "javascript"],
        repo["segSanctioned"],
        repo["segColors"][0] == LINGUIST_RGB["typescript"],
        any(l.startswith("TypeScript") for l in repo["labelText"]),
        repo["unitNamed"],
        repo["cadenceState"] == "ready",
        repo["cadenceTotal"] == "14",     # 15 commits on the wire, 1 older than 30d
        repo["cadenceQuestion"] == "Is this repo active or stagnant?",
        repo["cadenceFillsVar"],
        "last 15 commits" in repo["cadenceCaption"],
        "1 older than 30d" in repo["cadenceCaption"],
        repo["excerptPresent"],
        repo["excerptCount"] == "5",
        repo["viewAllPresent"],
        repo["graphButtonPresent"],
    ]),
    **repo,
    "screenshot": str(VSHOTS / "feedback-E-repo-profile.png"),
}
report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback-E-home-metrics.png"),
    str(VSHOTS / "feedback-E-repo-profile.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceE_verdict", f"slice-E assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
