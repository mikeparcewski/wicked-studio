#!/usr/bin/env python3
"""
feedback3_sliceQ_test.py — the DES-FEEDBACK-003 slice-Q gate: the narrative
landing (§7) — the data-composed lede, the per-project 24h activity river, the
margin notes, and the metrics bar's supersession — against the shared W2
fixture with the slice-Q switches on: `river` (the §10.2 24h-spread activity
variant: spread attach clocks, the r-auth failure tail at 5h, one relayed
version.created for q3-review-deck) and `metrics_ws` (the costed burn drip, so
the spend note and the margin sparkline have real dollars).

The slice DOM ACs, verbatim from §7.6:

  1. `[data-testid="narrative-band"]` replaces `[data-testid="metrics-bar"]`
     on `/` (old testid absent — supersession).
  2. `[data-testid="landing-lede"]` text matches the fixture's true counts —
     COMPUTED here from the fixture's own data via the §7.3 grammar, never
     snapshotted from the page; each numeric segment is an `<a>`; the
     all-quiet fixture reads the quiet phrase with no zero-count segment.
  3. `[data-testid="activity-river"]` renders ≤6 river lanes in board
     attention order; the live run's span reaches the right edge with the
     arrowhead; the waiting gate mark's computed fill resolves from
     `var(--status-gate)` (EC15); clicking it navigates to the run + #gate.
  4. The lede and river carry their `data-question` attributes (EC19).
  5. Zero requests beyond what the board already fetches (interception —
     the band is a pure re-reader).
  6. The needs-you band, quiet band, and LiveFeed render unchanged below the
     band (C3/C6); no chart-library <script>; all river geometry inline SVG.

Plus the honest-clock derivations (§7.3): river lane/span/mark counts and the
margin tiles' totals are re-derived here from the fixture constants — spans on
attach + observed-frame + failure-tail clocks only, the clockless orphan
excluded and counted `data-unplaced`.

Captures (§10.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback3-Q-landing-story.png  the money shot: lede, river (live run + gate
                                 marks + ✗ + doc tick), margin notes, bands below
  feedback3-Q-landing-quiet.png  the all-quiet fixture: quiet lede, calm river

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK3Q_PORT (default 4366),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    PROJECTS,
    REPO,
    RIVER_ATTACHED_AT,
    RIVER_AUTH_EVENTS,
    RUNS,
    ATTACHED_AT,
    ensure_build,
    set_fixture,
    start_server,
)

PORT = int(os.environ.get("FEEDBACK3Q_PORT", "4366"))
ORIGIN = f"http://127.0.0.1:{PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
HOUR = 3_600_000

# ── The independent derivation (§7.6 AC 2: computed, not snapshotted) ──────────
#
# The same clocks the page can honestly reach, rebuilt from the fixture's own
# constants: merged attach clocks (river overrides on), the r-auth failure
# tail, membership (which lanes exist). The page's "now" is minutes past NOW0
# at most; every margin below is hours, so NOW0 stands in for it.

CLOCKS = {**ATTACHED_AT, **RIVER_ATTACHED_AT}
FAIL_TAILS = {"r-auth": RIVER_AUTH_EVENTS[-1]["ts"], "r-legacy": NOW0 - 8 * 24 * HOUR}
TERMINAL = {"completed", "failed", "cancelled"}
WINDOW_START = NOW0 - 24 * HOUR

finished = passed = failed = gates = live = 0
for view in RUNS:  # the orphan is NOT here — it is the clockless unplaced case
    s = view["session"]
    if s["status"] == "awaiting_human":
        gates += 1
    if s["status"] in ("planning", "distributing", "executing"):
        live += 1
    if s["status"] not in TERMINAL:
        continue
    points = [c for c in (CLOCKS.get(s["id"]), FAIL_TAILS.get(s["id"])) if c is not None]
    if not points or max(points) < WINDOW_START:
        continue
    finished += 1
    if s["status"] == "completed":
        passed += 1
    else:
        failed += 1

BOARD_PROJECTS = [p for p in PROJECTS if p["status"] == "active" and p["id"] != "default"]


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


EXPECTED_LEDE = compose_lede(finished, passed, failed, gates, live, len(BOARD_PROJECTS))
EXPECTED_QUIET_LEDE = compose_lede(0, 0, 0, 0, 0, len(BOARD_PROJECTS))

# Lane-eligible projects: in-window observed activity (spans or the q3 doc
# landing). With the river clocks: q3 (30s gate), api (2m gate), upload (live
# 20h), auth (failed 6h→5h), smokes (16h/10h) — legacy is 8 DAYS out.
EXPECTED_LANES = {"q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint", "smoke-tests"}
EXPECTED_QUIET_COUNT = len(BOARD_PROJECTS) - len(EXPECTED_LANES)
# In-window attach clocks for the margin outcome bar; outside/clockless counted.
OUTCOME_TOTAL = sum(1 for v in RUNS if CLOCKS.get(v["session"]["id"], 0) >= WINDOW_START)
OUTCOME_UNPLACED = (len(RUNS) + 1) - OUTCOME_TOTAL  # + the clockless orphan

# The board's own fetch budget — the band may add NOTHING to it (§7.6 AC).
ALLOWED_API = (
    "/api/v1/settings",
    "/api/v1/health",
    "/api/v1/runs",       # + /runs/:id/gate reconciles + /runs/:id/events backfills
    "/api/v1/projects",   # + /projects/:id/members + .../interactive/api/docs
    "/api/v1/repos",
)

report: dict = {"ok": False, "steps": {}, "derived": {
    "expected_lede": EXPECTED_LEDE, "expected_quiet_lede": EXPECTED_QUIET_LEDE,
    "lanes": sorted(EXPECTED_LANES), "quiet": EXPECTED_QUIET_COUNT,
    "outcome_total": OUTCOME_TOTAL, "outcome_unplaced": OUTCOME_UNPLACED,
}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build ────────────────────────────────────────────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture, slice-Q switches on ──────────────────────────────
start_server(PORT, dist)
set_fixture(ORIGIN, river=True, metrics_ws=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0,
                                     "river": True, "metrics_ws": True}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []
api_requests: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: api_requests.append(urlparse(r.url).path)
            if urlparse(r.url).path.startswith("/api/") else None)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ══ Scene 1 — the story landing (the money shot) ═══════════════════════════
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="narrative-band"]').wait_for(timeout=30000)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('13px "Inter"')
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    # Settle each derived surface on its own wire: the lede on the members read
    # + failure backfill, the doc mark on the relayed /ws frame, the spend note
    # + margin sparkline on the drained burn drip (4 costed frames = $0.42).
    lede_ok = settled(
        """expected => document.querySelector('[data-testid="landing-lede"]')
                         ?.textContent === expected""",
        EXPECTED_LEDE,
    )
    mark_ok = settled(
        """() => !!document.querySelector('[data-testid="river-version-mark"]')""")
    spend_ok = settled(
        """() => document.querySelector('[data-testid="lede-spend"]')
                   ?.textContent === '$0.42 observed'""")
    burn_ok = settled(
        """() => document.querySelector('[data-testid="river-margin"] '
                   + '[data-testid="token-burn-sparkline"]')
                   ?.getAttribute('data-points') === '4'""")
    fail_mark_ok = settled(
        """() => !!document.querySelector('[data-testid="river-fail-mark"][data-run-id="r-auth"]')""")

    home = page.evaluate(
        """(expectedLanes) => {
             const band = document.querySelector('[data-testid="narrative-band"]');
             const river = document.querySelector('[data-testid="activity-river"]');
             const margin = document.querySelector('[data-testid="river-margin"]');
             const lede = document.querySelector('[data-testid="landing-lede"]');
             const lanes = Array.from(document.querySelectorAll('[data-testid="river-lane"]'));
             const laneIds = lanes.map((l) => l.getAttribute('data-project-id'));
             const probe = (token) => {
               const el = document.createElement('div');
               el.style.background = token;
               document.body.appendChild(el);
               const c = getComputedStyle(el).backgroundColor;
               el.remove();
               return c;
             };
             const gateMark = document.querySelector(
               '[data-testid="river-gate-mark"][data-run-id="r-q3"] polygon');
             const liveSpan = document.querySelector(
               '[data-testid="river-span"][data-run-id="r-upload"]');
             const svg = river ? river.querySelector('svg') : null;
             const nowArrow = liveSpan ? liveSpan.querySelector('[data-testid="river-now-arrow"]') : null;
             const shapes = band ? Array.from(band.querySelectorAll(
               'rect, circle, line, polyline, polygon, stop')) : [];
             const raw = shapes.filter((el) => ['fill', 'stroke', 'stop-color'].some((a) => {
               const v = el.getAttribute(a);
               return v !== null && v !== 'none' && !v.startsWith('var(--') && !v.startsWith('url(#');
             })).length;
             const scripts = Array.from(document.querySelectorAll('script'))
               .map((s) => s.getAttribute('src') || '')
               .filter((src) => /chart|d3|recharts|echarts|plotly|highcharts/i.test(src));
             return {
               bandPresent: !!band,
               oldBarAbsent: !document.querySelector('[data-testid="metrics-bar"]'),
               latencyChartAbsent: !document.querySelector('[data-testid="gate-latency-chart"]'),
               ledeQuestion: lede?.getAttribute('data-question') ?? null,
               riverQuestion: river?.getAttribute('data-question') ?? null,
               ledeLinkHrefs: Array.from(lede?.querySelectorAll('a[data-testid="lede-segment"]') ?? [])
                 .map((a) => a.getAttribute('href')),
               spendHref: document.querySelector('[data-testid="lede-spend"]')
                 ?.getAttribute('href') ?? null,
               laneCount: laneIds.length,
               laneIds,
               laneFirst: laneIds[0] ?? null,
               dataLanes: river?.getAttribute('data-lanes') ?? null,
               dataQuiet: river?.getAttribute('data-quiet') ?? null,
               dataUnplaced: river?.getAttribute('data-unplaced') ?? null,
               quietLabel: document.querySelector('[data-testid="river-quiet"]')?.textContent ?? '',
               gateMarksWaiting: document.querySelectorAll(
                 '[data-testid="river-gate-mark"][data-waiting="true"]').length,
               gateMarkFill: gateMark ? getComputedStyle(gateMark).fill : null,
               gateToken: probe('var(--status-gate)'),
               gateMarkPulses: gateMark ? gateMark.classList.contains('wk-river-gate-waiting') : false,
               failMarks: document.querySelectorAll('[data-testid="river-fail-mark"]').length,
               versionMarkKind: document.querySelector('[data-testid="river-version-mark"]')
                 ?.getAttribute('data-kind') ?? null,
               versionOnQ3: !!document.querySelector(
                 '[data-testid="river-lane"][data-project-id="q3-review-deck"] [data-testid="river-version-mark"]'),
               liveSpanLive: liveSpan?.getAttribute('data-live') ?? null,
               liveHasArrow: !!nowArrow,
               // The live span's paint reaches the now edge: the arrowhead's tip
               // sits PAST the right-edge gridline by construction; measure it.
               arrowReachesEdge: (() => {
                 if (!nowArrow || !svg) return false;
                 const a = nowArrow.getBoundingClientRect();
                 const s = svg.getBoundingClientRect();
                 return a.right >= s.right - 4;
               })(),
               svgOnly: !!svg && !!river && river.querySelectorAll('canvas').length === 0,
               rawPaints: raw,
               chartLibScripts: scripts,
               // C3/C6: the wall + feed beneath, unchanged.
               needsYou: !!document.querySelector('[data-testid="band-needs-you"]'),
               needsYouCards: document.querySelectorAll(
                 '[data-testid="band-needs-you"] [data-testid="project-card"]').length,
               quietBand: !!document.querySelector('[data-testid="band-quiet"]'),
               quietChips: document.querySelectorAll('[data-testid="quiet-chip"]').length,
               liveFeed: !!document.querySelector('[data-testid="live-feed"]'),
               allRunsLink: !!document.querySelector('[data-testid="all-runs-link"]'),
             };
           }""",
        sorted(EXPECTED_LANES),
    )

    # ── Capture 1: the money shot ───────────────────────────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback3-Q-landing-story.png"))

    # ── The request budget: nothing beyond the board's own fetches (§7.6) ──────
    # Snapshotted BEFORE leaving `/` — later pages own their own budgets.
    offenders = sorted({p for p in api_requests if not p.startswith(ALLOWED_API)})

    # ── The gate mark is a real link: click → the run, at the gate (§7.6) ──────
    # The href carries `#gate`; on arrival the SteeringGate CONSUMES the hash
    # (one-shot focus intent, SteeringGate.tsx) after focusing the question —
    # so the landing proof is: right run path + the hash gone + the gate
    # message holding focus.
    gate_href = page.locator(
        '[data-testid="river-gate-mark"][data-run-id="r-q3"]').get_attribute("href")
    page.locator('[data-testid="river-gate-mark"][data-run-id="r-q3"]').click()
    nav_ok = settled(
        """() => location.pathname === '/p/q3-review-deck/build/r-q3'
              && location.hash === ''""") and gate_href == "/p/q3-review-deck/build/r-q3#gate"

    # ══ Scene 2 — the all-quiet fixture (quiet lede, calm river) ═══════════════
    set_fixture(ORIGIN, no_runs=True, river=False, metrics_ws=False)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="narrative-band"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    quiet_lede_ok = settled(
        """expected => document.querySelector('[data-testid="landing-lede"]')
                         ?.textContent === expected""",
        EXPECTED_QUIET_LEDE,
    )
    quiet = page.evaluate(
        """() => ({
             lede: document.querySelector('[data-testid="landing-lede"]')?.textContent ?? '',
             spendAbsent: !document.querySelector('[data-testid="lede-spend"]'),
             dataLanes: document.querySelector('[data-testid="activity-river"]')
               ?.getAttribute('data-lanes') ?? null,
             dataQuiet: document.querySelector('[data-testid="activity-river"]')
               ?.getAttribute('data-quiet') ?? null,
             spans: document.querySelectorAll('[data-testid="river-span"]').length,
             marks: document.querySelectorAll(
               '[data-testid="river-gate-mark"], [data-testid="river-fail-mark"],'
               + ' [data-testid="river-version-mark"]').length,
             boardAllQuiet: !!document.querySelector('[data-testid="board-all-quiet"]'),
             noZeroSegment: !(document.querySelector('[data-testid="landing-lede"]')
               ?.textContent ?? '').includes('0 '),
           })"""
    )

    # ── Capture 2: the quiet landing ────────────────────────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback3-Q-landing-quiet.png"))

    page.close()
    ctx.close()
    browser.close()

report["steps"]["supersession"] = {
    "ok": all([home["bandPresent"], home["oldBarAbsent"], home["latencyChartAbsent"]]),
    **{k: home[k] for k in ("bandPresent", "oldBarAbsent", "latencyChartAbsent")},
}
report["steps"]["lede"] = {
    "ok": all([
        fonts_ok, lede_ok, spend_ok,
        home["ledeQuestion"] == "What happened and what needs me?",
        home["ledeLinkHrefs"] == ["/runs", "#needs-you"],
        home["spendHref"] == "/make",
    ]),
    "web_fonts": fonts_ok, "lede_settled": lede_ok, "spend_settled": spend_ok,
    **{k: home[k] for k in ("ledeQuestion", "ledeLinkHrefs", "spendHref")},
}
report["steps"]["river"] = {
    "ok": all([
        mark_ok, fail_mark_ok,
        home["riverQuestion"] == "What ran, when, and how did it end?",
        home["laneCount"] <= 6,
        set(home["laneIds"]) == EXPECTED_LANES,
        home["laneFirst"] == "q3-review-deck",  # board attention order leads
        home["dataLanes"] == str(len(EXPECTED_LANES)),
        home["dataQuiet"] == str(EXPECTED_QUIET_COUNT),
        home["dataUnplaced"] == "1",            # the clockless orphan — counted, never painted
        f"({EXPECTED_QUIET_COUNT} quiet)" in home["quietLabel"],
        home["gateMarksWaiting"] == 2,
        home["gateMarkFill"] == home["gateToken"],  # EC15: resolves from var(--status-gate)
        home["gateMarkPulses"],
        home["failMarks"] == 1,
        home["versionMarkKind"] == "doc",
        home["versionOnQ3"],
        home["liveSpanLive"] == "true",
        home["liveHasArrow"],
        home["arrowReachesEdge"],
        home["svgOnly"],
    ]),
    "version_mark_settled": mark_ok, "fail_mark_settled": fail_mark_ok,
    **{k: home[k] for k in (
        "riverQuestion", "laneCount", "laneIds", "laneFirst", "dataLanes", "dataQuiet",
        "dataUnplaced", "quietLabel", "gateMarksWaiting", "gateMarkFill", "gateToken",
        "gateMarkPulses", "failMarks", "versionMarkKind", "versionOnQ3",
        "liveSpanLive", "liveHasArrow", "arrowReachesEdge", "svgOnly")},
}
report["steps"]["gate_mark_link"] = {"ok": nav_ok, "navigated": nav_ok, "href": gate_href}
report["steps"]["margin_notes"] = {
    "ok": burn_ok,
    "burn_settled": burn_ok,
}
report["steps"]["request_budget"] = {
    "ok": offenders == [],
    "offenders": offenders,
    "api_paths_seen": sorted(set(api_requests))[:30],
}
report["steps"]["no_chart_library_ec15"] = {
    "ok": home["chartLibScripts"] == [] and home["rawPaints"] == 0,
    "chart_lib_scripts": home["chartLibScripts"],
    "raw_paints": home["rawPaints"],
}
report["steps"]["board_preserved"] = {
    "ok": all([
        home["needsYou"], home["needsYouCards"] >= 2, home["quietBand"],
        home["quietChips"] >= 1, home["liveFeed"], home["allRunsLink"],
    ]),
    **{k: home[k] for k in ("needsYou", "needsYouCards", "quietBand",
                            "quietChips", "liveFeed", "allRunsLink")},
}
report["steps"]["quiet_landing"] = {
    "ok": all([
        quiet_lede_ok,
        quiet["lede"] == EXPECTED_QUIET_LEDE,
        quiet["spendAbsent"],           # no observed dollars → the note drops out
        quiet["dataLanes"] == "0",
        quiet["dataQuiet"] == str(len(BOARD_PROJECTS)),
        quiet["spans"] == 0,
        quiet["marks"] == 0,
        quiet["boardAllQuiet"],
        quiet["noZeroSegment"],
    ]),
    "quiet_lede_settled": quiet_lede_ok,
    **quiet,
}
report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback3-Q-landing-story.png"),
    str(VSHOTS / "feedback3-Q-landing-quiet.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceQ_verdict", f"slice-Q assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
