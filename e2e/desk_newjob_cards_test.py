"""Journey: the New job cards (operator 2026-10-12) — the Desk's "New job" opens the launch wizard on
a grid of cards, one per kind of job (the daemon's ordinary workflows, then Draft epics).

MEASURED, not eyeballed, at 1440x700 and 1920x1080: 4 across and exactly 3 whole rows in the grid's
view with no partial row (the row height is a third of the room the modal leaves, in CSS); at 860
wide 2 across; on a phone (390x844) 1 across; past the view the cards scroll inside the grid, and the
modal itself always fits the window. Every card has a decorative drawing (aria-hidden SVG, no external image), arrow keys move
across the grid as laid out, the focused card carries the focus ring, and Enter picks it into its
job's first step. GET /workflows is stubbed with the catalog a real daemon serves (system ones
included, so the filter is exercised); nothing is posted.

Captures: e2e/shots/desk-newjob-cards-*.png. Env: FEEDBACK_PORT (default 4523).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4523"))
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
posts: list[str] = []

# The catalog a real daemon served on 2026-10-12 (ids, phases, system flag).
CATALOG = [
    ("bug", ["triage", "reproduce", "fix", "verify"], False),
    ("capture-learnings", ["churn", "hotspots", "capture"], True),
    ("chat", ["explore"], True),
    ("domain-extraction", ["survey", "analyze", "extract", "coverage", "domain-graph"], False),
    ("editor-plugin", ["scope", "design", "build", "test"], False),
    ("feature", ["clarify", "design", "build", "adversarial-review", "test", "review"], False),
    ("learn", ["scope", "research", "synthesize", "walkthrough", "author", "review"], False),
    ("mcp-server", ["scope", "design", "build", "test", "install"], False),
    ("migration", ["plan", "execute", "cutover", "verify", "cleanup"], False),
    ("onboarding", ["index", "annotate"], True),
    ("qe-author-tests", ["recon", "author", "verify", "review"], False),
]
WORKFLOWS = {"workflows": [
    {"id": i, "is_system": s, "phases": [{"id": p, "executes_code": True} for p in ph]} for (i, ph, s) in CATALOG]}
# Today's offer: the ordinary workflows in catalog order (at most 8), then Draft epics.
EXPECTED = [i for (i, _, s) in CATALOG if not s][:8] + ["draft-epics"]

MEASURE = r"""() => {
  const grid = document.querySelector('[data-testid=launch-wizard-cards]');
  if (!grid) return null;
  const g = grid.getBoundingClientRect();
  const cards = [...grid.querySelectorAll('button')];
  const tops = [...new Set(cards.map((c) => Math.round(c.offsetTop)))].sort((a, b) => a - b);
  let full = 0, partial = 0;
  for (const t of tops) {
    const r = cards.find((c) => Math.round(c.offsetTop) === t).getBoundingClientRect();
    if (r.top >= g.top - 0.5 && r.bottom <= g.bottom + 0.5) full++;
    else if (r.bottom > g.top + 0.5 && r.top < g.bottom - 0.5) partial++;
  }
  const dlg = document.querySelector('[data-testid=launch-wizard]').getBoundingClientRect();
  return {
    ids: cards.map((c) => c.dataset.testid.replace('launch-wizard-workflow-', '')),
    across: cards.filter((c) => Math.round(c.offsetTop) === tops[0]).length,
    rows: tops.length, full, partial,
    gridScrolls: grid.scrollHeight > grid.clientHeight + 1, overflowY: getComputedStyle(grid).overflowY,
    dialogFits: dlg.top >= 0 && dlg.bottom <= innerHeight + 0.5,
    minSide: Math.round(Math.min(...cards.map((c) => { const r = c.getBoundingClientRect(); return Math.min(r.width, r.height); }))),
    art: cards.every((c) => { const s = c.querySelector('svg'); return s && s.getAttribute('aria-hidden') === 'true' && !s.querySelector('image'); }),
    clamped: cards.filter((c) => { const l = c.querySelector('.wk-launch-wizard-choice-line'); return l.scrollHeight > l.clientHeight + 1; }).length,
    // The grid is bounded by its frame (it never grows to fit its cards): its height is the frame's,
    // and a row is a third of it less the gaps and padding (codex r1: not just "9 cards fit").
    frameH: grid.parentElement.getBoundingClientRect().height, gridH: g.height,
    rowH: cards[0].getBoundingClientRect().height,
    gap: parseFloat(getComputedStyle(grid).rowGap), pad: parseFloat(getComputedStyle(grid).paddingTop),
  };
}"""

FOCUSED = "() => document.activeElement?.dataset?.testid?.replace('launch-wizard-workflow-', '') ?? null"

with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h, across, rows_in_view) in ((1440, 700, 4, 3), (1920, 1080, 4, 3), (860, 900, 2, 3), (390, 844, 1, None)):
        phone = w < 600
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=phone, has_touch=phone)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: posts.append(f"{r.method} {r.url}") if r.method == "POST" and "/launch" in r.url else None)
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
        page.route("**/api/v1/workflows", lambda r: r.fulfill(status=200, json=WORKFLOWS))
        page.route("**/api/v1/presets*", lambda r: r.fulfill(status=200, json={"presets": []}))
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk-new-job").click()
        page.get_by_test_id("launch-wizard-cards").wait_for(state="visible", timeout=8000)
        page.wait_for_function(f"() => document.querySelectorAll('[data-testid^=\"launch-wizard-workflow-\"]').length >= {len(EXPECTED)}", timeout=8000)
        page.wait_for_timeout(200)
        m = page.evaluate(MEASURE)
        page.screenshot(path=str(SHOTS / f"desk-newjob-cards-{w}x{h}.png"))
        tag = f"{w}x{h}"
        check(f"{tag}-same-set-same-order", m["ids"] == EXPECTED, ids=m["ids"], expected=EXPECTED)
        check(f"{tag}-across", m["across"] == across, measured=m)
        if rows_in_view is not None:
            check(f"{tag}-three-whole-rows-none-cut", m["full"] == rows_in_view and m["partial"] == 0, measured=m)
            third = (m["frameH"] - (rows_in_view - 1) * m["gap"] - 2 * m["pad"]) / rows_in_view
            check(f"{tag}-row-is-a-third-of-the-frame", abs(m["gridH"] - m["frameH"]) <= 1 and abs(m["rowH"] - third) <= 1,
                  third=third, measured=m)
        else:
            check(f"{tag}-phone-no-cut-row", m["full"] >= 3 and m["partial"] == 0, measured=m)
        check(f"{tag}-scrolls-inside", m["overflowY"] == "auto" and m["dialogFits"] and (m["gridScrolls"] or m["rows"] <= 3), measured=m)
        check(f"{tag}-art-and-targets", m["art"] and m["minSide"] >= 44 and m["clamped"] == 0, measured=m)

        if not phone:
            # Keyboard: focus starts on the first card; arrows follow the layout (Down = one row of
            # `across`); the focused card matches :focus-visible and its ring differs from a resting card.
            first = page.evaluate(FOCUSED)
            page.keyboard.press("ArrowRight")
            right = page.evaluate(FOCUSED)
            page.keyboard.press("ArrowDown")
            down = page.evaluate(FOCUSED)
            ring = page.evaluate("""() => { const a = document.activeElement; const rest = [...a.parentElement.children].find((c) => c !== a && c.getAttribute('aria-pressed') !== 'true');
              return { visible: a.matches(':focus-visible'), focused: getComputedStyle(a).boxShadow, resting: getComputedStyle(rest).boxShadow }; }""")
            page.screenshot(path=str(SHOTS / f"desk-newjob-cards-focus-{tag}.png"))
            check(f"{tag}-keyboard-moves-across-the-grid",
                  first == EXPECTED[0] and right == EXPECTED[1] and down == EXPECTED[1 + across]
                  and ring["visible"] and ring["focused"] not in ("", "none") and ring["focused"] != ring["resting"],
                  first=first, right=right, down=down, ring=ring)
        if w == 1440:
            down = page.evaluate(FOCUSED)
            page.keyboard.press("Enter")
            page.get_by_test_id("launch-wizard-intent").wait_for(state="visible", timeout=5000)
            step = page.get_by_test_id("launch-wizard-step").get_attribute("data-step")
            title = page.locator(".wk-launch-wizard-title").inner_text()
            check("enter-picks-into-the-first-step", step == "what" and title == "New job: MCP server", landed=step, title=title)
            page.get_by_test_id("launch-wizard-change").click()
            back = page.evaluate(FOCUSED)
            check("change-job-returns-to-the-picked-card", back == EXPECTED[5], focused=back)
        ctx.close()
    browser.close()

check("nothing-launched", posts == [], posts=posts)
check("no-page-errors", errors == [], errors=errors)
report["ok"] = True
print(json.dumps(report, indent=2))
