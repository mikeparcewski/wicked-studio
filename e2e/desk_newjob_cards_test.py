"""Journey: New job's workflow catalog (launch-modal, operator 2026-11-01). The Desk's "New job" opens
the launch wizard on a catalog: search on top, category chips and filters, "Your top", then a section
per category; typing a sentence ranks the workflows, Enter picks the best, and the pick lands on the
step that asks only for what that workflow needs. An older daemon (no catalog route) gets today's
list, uncategorised and still searchable.

MEASURED at 1440x700, 1920x1080, 860x900 and 390x844: the dialog fits the window and the document
never scrolls (the results panel does); 3 cards across on a desktop, 2 at 860, 1 on a phone; every card
has a decorative drawing (aria-hidden SVG, no external image) and a target of at least 44 px. Keyboard
at 1440: focus starts in search, Down goes to the cards and follows the layout, Up from the top row
returns to search, the focused card shows the focus ring.

GET /workflows/catalog is stubbed with the WIRE v1 fixture (tests/fixtures/workflowCatalog.json) and
GET /workflows with the list a real daemon served; nothing is posted.

Captures: e2e/shots/desk-newjob-catalog-*.png. Env: FEEDBACK_PORT (default 4523).
"""

import json
import os
import sys
from datetime import datetime, timezone

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4523"))
SHOTS = REPO / "e2e" / "shots"
CATALOG = json.loads((REPO / "tests" / "fixtures" / "workflowCatalog.json").read_text())
# Your top is recency-weighted against the real clock: keep each launch the same distance from now as it
# is from the fixture's day (2026-11-01T12:00Z), so the expected order never drifts (codex r1).
_FIXTURE_NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
_SHIFT = datetime.now(timezone.utc) - _FIXTURE_NOW
for _e in CATALOG["entries"]:
    _at = _e.get("usage", {}).get("lastUsedAt")
    if _at:
        _e["usage"]["lastUsedAt"] = (datetime.fromisoformat(_at.replace("Z", "+00:00")) + _SHIFT).isoformat().replace("+00:00", "Z")

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

# The workflows a real daemon served on 2026-10-12 (ids, phases, system flag): the older-daemon list.
DEFS = [
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
    {"id": i, "is_system": s, "phases": [{"id": p, "executes_code": True} for p in ph]} for (i, ph, s) in DEFS]}
# Older daemon: every ordinary workflow (no 8-row cap), then studio's own kinds, then the app builder (coming soon).
OLDER = [i for (i, _, s) in DEFS if not s] + ["demo-video", "draft-epics", "apps"]

MEASURE = r"""() => {
  const panel = document.querySelector('[data-testid=launch-catalog-results]');
  if (!panel) return null;
  const dlg = document.querySelector('[data-testid=launch-wizard]').getBoundingClientRect();
  const se = document.scrollingElement;
  const cards = [...panel.querySelectorAll('[data-catalog-card], [data-testid^="launch-catalog-soon-"]:not([data-testid="launch-catalog-soon-tag"])')];
  const grid = panel.querySelector('[data-section]:not([data-section=top]):not([data-section=fit]) .wk-catalog-grid');
  const kids = grid ? [...grid.children] : [];
  const top0 = kids[0]?.getBoundingClientRect().top;
  return {
    sections: [...panel.querySelectorAll('[data-section]')].map((s) => s.dataset.section),
    ids: cards.map((c) => c.dataset.testid.replace(/^launch-(wizard-workflow|catalog-soon|catalog-top|catalog-fit)-/, '')),
    across: kids.filter((c) => Math.abs(c.getBoundingClientRect().top - top0) < 1).length,
    dialogFits: dlg.top >= 0 && dlg.bottom <= innerHeight + 0.5 && dlg.left >= 0 && dlg.right <= innerWidth + 0.5,
    docScrolls: se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1,
    panelScrolls: panel.scrollHeight > panel.clientHeight + 1, overflowY: getComputedStyle(panel).overflowY,
    minSide: Math.round(Math.min(...cards.map((c) => { const r = c.getBoundingClientRect(); return Math.min(r.width, r.height); }))),
    art: cards.every((c) => { const s = c.querySelector('svg'); return s && s.getAttribute('aria-hidden') === 'true' && !s.querySelector('image'); }),
    searchTop: Math.round(document.querySelector('[data-testid=launch-catalog-search]').getBoundingClientRect().top),
    chips: document.querySelectorAll('[data-testid=launch-catalog-cat]').length,
    older: !!document.querySelector('[data-testid=launch-catalog-older]'),
  };
}"""

FOCUSED = "() => document.activeElement?.dataset?.testid ?? null"


def new_page(browser, w: int, h: int, catalog: bool):
    phone = w < 600
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=phone, has_touch=phone)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: posts.append(f"{r.method} {r.url}") if r.method == "POST" and ("/runs" in r.url or "/launch" in r.url or "/demo" in r.url or "/compose" in r.url) else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.route("**/api/v1/workflows", lambda r: r.fulfill(status=200, json=WORKFLOWS))
    page.route("**/api/v1/presets*", lambda r: r.fulfill(status=200, json={"presets": []}))
    if catalog:
        page.route("**/api/v1/workflows/catalog*", lambda r: r.fulfill(status=200, json=CATALOG))
    page.goto(f"{origin}/", wait_until="networkidle")
    # The phone's rail is a drawer: New job is the top bar's there.
    page.get_by_test_id("topbar-new-job" if phone else "desk-rail-new-job").click()
    page.wait_for_selector('[data-testid="launch-catalog"]:not([data-source="loading"])', timeout=8000)
    page.wait_for_timeout(250)
    return ctx, page


with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h, across) in ((1440, 700, 3), (1920, 1080, 3), (860, 900, 2), (390, 844, 1)):
        tag = f"{w}x{h}"
        ctx, page = new_page(browser, w, h, True)
        m = page.evaluate(MEASURE)
        page.screenshot(path=str(SHOTS / f"desk-newjob-catalog-{tag}.png"))
        check(f"{tag}-sections", m["sections"] == ["top", "create", "resolve", "analyze", "test", "more"], measured=m)
        check(f"{tag}-your-top", m["ids"][:3] == ["bug", "feature", "review-recent-work"], ids=m["ids"][:6])
        check(f"{tag}-across", m["across"] == across, measured=m)
        check(f"{tag}-fits-no-document-scroll", m["dialogFits"] and not m["docScrolls"] and m["overflowY"] == "auto" and m["panelScrolls"], measured=m)
        check(f"{tag}-art-and-targets", m["art"] and m["minSide"] >= 44 and m["chips"] == 6, measured=m)

        if w == 1440:
            # Keyboard: focus in search; Down to the first card (Your top), Down follows the layout into
            # the next row; Up from the top row returns to search. The focused card shows the ring.
            start = page.evaluate(FOCUSED)
            page.keyboard.press("ArrowDown")
            first = page.evaluate(FOCUSED)
            page.keyboard.press("ArrowDown")
            down = page.evaluate(FOCUSED)
            ring = page.evaluate("""() => { const a = document.activeElement; const rest = document.querySelector('[data-testid="launch-wizard-workflow-docs"]');
              return { visible: a.matches(':focus-visible'), focused: getComputedStyle(a).boxShadow, resting: getComputedStyle(rest).boxShadow }; }""")
            page.screenshot(path=str(SHOTS / f"desk-newjob-catalog-focus-{tag}.png"))
            page.keyboard.press("ArrowUp")
            up = page.evaluate(FOCUSED)
            page.keyboard.press("ArrowUp")
            back = page.evaluate(FOCUSED)
            check("keyboard-search-cards-search",
                  start == "launch-catalog-search" and first == "launch-catalog-top-bug" and down == "launch-wizard-workflow-feature"
                  and (up or "").startswith("launch-catalog-top-") and back == "launch-catalog-search"
                  and ring["visible"] and ring["focused"] not in ("", "none") and ring["focused"] != ring["resting"],
                  start=start, first=first, down=down, up=up, back=back, ring=ring)

            # A sentence ranks the right workflow; Enter picks it into the step that asks for what it needs.
            page.get_by_test_id("launch-catalog-search").fill("write docs for the auth service")
            page.wait_for_timeout(200)
            ranked = page.evaluate("() => [...document.querySelectorAll('[data-section=results] [data-catalog-card]')].map((c) => c.dataset.testid)")
            page.screenshot(path=str(SHOTS / "desk-newjob-catalog-search-1440.png"))
            check("sentence-ranks-docs-first", ranked[:1] == ["launch-wizard-workflow-docs"], ranked=ranked[:5])
            page.keyboard.press("Enter")
            page.get_by_test_id("launch-wizard-intent").wait_for(state="visible", timeout=5000)
            step = page.get_by_test_id("launch-wizard-step").get_attribute("data-step")
            title = page.locator(".wk-launch-wizard-title").inner_text()
            shape = page.get_by_test_id("launch-wizard-shape").inner_text()
            page.screenshot(path=str(SHOTS / "desk-newjob-catalog-shape-1440.png"))
            check("enter-picks-into-shaping", step == "what" and title == "New job: Write docs in the repo"
                  and "Docs in your repository" in shape and "a repository" in shape, landed=step, title=title, shape=shape)
            page.get_by_test_id("launch-wizard-change").click()
            page.wait_for_timeout(300)
            back = page.evaluate(FOCUSED)
            pressed = page.get_by_test_id("launch-wizard-workflow-docs").get_attribute("aria-pressed")
            check("change-job-returns-to-the-picked-card", back == "launch-wizard-workflow-docs" and pressed == "true", focused=back)
            page.keyboard.press("Escape")
            page.get_by_test_id("launch-wizard").wait_for(state="detached", timeout=5000)
        if w == 390:
            check("phone-search-on-top", m["searchTop"] < 140, measured=m)
        ctx.close()

    # An older daemon: no catalog route. Today's list, uncategorised, still searchable.
    ctx, page = new_page(browser, 1440, 700, False)
    m = page.evaluate(MEASURE)
    page.screenshot(path=str(SHOTS / "desk-newjob-catalog-older-1440x700.png"))
    check("older-daemon-flat-list", m["older"] and m["chips"] == 0 and m["sections"] == ["all"] and m["ids"] == OLDER, measured=m)
    page.get_by_test_id("launch-catalog-search").fill("tests")
    page.wait_for_timeout(200)
    hit = page.evaluate("() => document.querySelector('[data-section=results] [data-catalog-card]')?.dataset.testid ?? null")
    check("older-daemon-searchable", hit == "launch-wizard-workflow-qe-author-tests", hit=hit)
    ctx.close()
    browser.close()

check("nothing-launched", posts == [], posts=posts)
check("no-page-errors", errors == [], errors=errors)
report["ok"] = True
print(json.dumps(report, indent=2))
