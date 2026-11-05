#!/usr/bin/env python3
"""
desk_repo_page_test.py — the repo page says what is true about its code graph (studio#461), under
the Desk at 1440x700 against the in-process fixture's registered repo:

  1. A BUILT GRAPH WITH NO CODE (a Markdown-only repo: 7 symbols, 2 files, nothing to rank): the
     hotspots and the language mix say so, and nothing on the page says "run onboarding".
  2. A FAILED GRAPH READ: the page says it could not read the graph, with "Try again"; no "run
     onboarding". When the daemon answers again, "Try again" brings the hotspots back.
  3. RECENT COMMITS (lane repo-page): the list is a fixed-height card (about 6 rows) that scrolls inside,
     so it does not push the page down; "Show all" opens the full list in a dialog.
  4. NO REQUIREMENTS GRAPH YET (lane repo-page): Requirements says so plainly (crew's typed 404
     `code: notGenerated`), never "the daemon refused this"; "Generate it" opens New job filled in with
     the generating workflow and this repository, and sends nothing (no POST).
  5. WHAT WE KNOW (round 10): the band's five marks say the code graph's size, the real share against the
     minimum (a meter), the requirements graph's build (behind) and the runs; Requirements opens the
     requirements, Requirements graph opens the graph on its domain view.
  6. TABS (2026-11-05): ?tab=history opens History alone (one tabpanel); clicking Knowledge moves the address;
     Back returns to History.
  7. 0 page errors.

Captures: e2e/shots/desk-repo-page-*.png. Env: FEEDBACK_PORT (default 4359).
"""

import json
import os
import sys

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4359"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))

    def open_repo() -> str:
        """The page's graph sentences — hotspots, language mix, the Code graph card — not the header's
        own Run Onboarding action, which stays on every repo (codex on #461: scope the check)."""
        page.goto(f"{origin}/repo-detail/studio-api?tab=knowledge", wait_until="networkidle")
        page.get_by_test_id("language-bar").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(400)
        return page.evaluate("""() => ['repo-hotspots-empty', 'language-bar', 'repo-graph-empty']
            .map(t => (document.querySelector(`[data-testid="${t}"]`) || {}).innerText || `<no ${t}>`).join('\\n')""")

    # ── 1. built, no code ────────────────────────────────────────────────────────
    set_fixture(origin, repo=True, repo_graph="docs")
    text = open_repo()
    page.screenshot(path=str(SHOTS / "desk-repo-page-docs.png"))
    stats = page.locator('[data-testid^="graph-stat-"]').count()
    check("indexed-but-no-code-is-said", "7 symbols indexed across 2 files" in text
          and "No code files in the indexed graph" in text and "7 symbols indexed — none of them code" in text
          and "run onboarding" not in text.lower() and stats == 0, text=text, stat_rows=stats)

    # ── 2. the graph read failed ─────────────────────────────────────────────────
    set_fixture(origin, repo_graph="fail")
    text = open_repo()
    page.screenshot(path=str(SHOTS / "desk-repo-page-failed.png"))
    # Said ONCE, in the page banner with its Retry (audit row 43); the panels only say they wait on it.
    banner = page.get_by_test_id("repo-graph").inner_text() if page.get_by_test_id("repo-graph").count() == 1 else ""
    check("failed-read-is-said", "Couldn’t load the code map" in banner and "run onboarding" not in text.lower()
          and "Couldn’t" not in text and page.get_by_test_id("repo-graph-retry").count() == 1, text=text, banner=banner)
    set_fixture(origin, repo_graph=None)
    page.get_by_test_id("repo-graph-retry").click()
    try:
        page.get_by_test_id("hotspots-excerpt").wait_for(state="visible", timeout=10000)
        back = True
    except Exception:
        back = False
    check("try-again-reads-again", back)
    # ── 3. recent commits (the History tab): capped card + Show all ─────────────
    page.goto(f"{origin}/repo-detail/studio-api?tab=history", wait_until="networkidle")
    lst = page.get_by_test_id("repo-commits")
    lst.wait_for(state="visible", timeout=15000)
    box = lst.evaluate("el => ({h: el.clientHeight, sh: el.scrollHeight, rows: el.querySelectorAll('li').length,"
                       " rowH: el.querySelector('li').getBoundingClientRect().height})")
    page.screenshot(path=str(SHOTS / "desk-repo-page-commits.png"))
    # About six rows visible (row + the list's 8 px gap per row): shorter than its 15 rows, scrolls inside.
    visible_rows = (box["h"] + 8) / max(box["rowH"] + 8, 1)
    check("commits-capped", box["rows"] == 15 and box["sh"] > box["h"] and 5.5 <= visible_rows <= 7, **box,
          visible_rows=round(visible_rows, 2))
    page.get_by_test_id("repo-commits-show-all").click()
    full = page.get_by_test_id("repo-commits-all")
    full.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-repo-page-commits-all.png"))
    n = full.locator("li").count()
    note = page.get_by_test_id("repo-commits-all-note").inner_text()
    check("show-all-opens-full-list", n == 15 and "The latest 15 commits" in note, rows=n, note=note)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("show-all-closes", full.count() == 0)

    # ── 4. no requirements graph yet → Generate it opens New job ────────────────
    set_fixture(origin, workflow_catalog=True)
    page.goto(f"{origin}/repo-detail/studio-api", wait_until="networkidle")
    posts: list[str] = []
    page.on("request", lambda r: posts.append(r.method + " " + r.url) if r.method != "GET" and "/api/v1/" in r.url else None)
    page.get_by_test_id("repo-open-requirements").click()
    panel = page.get_by_test_id("requirements-not-generated")
    panel.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-repo-page-requirements-none.png"))
    words = panel.inner_text()
    body = page.evaluate("() => document.body.innerText")
    check("not-generated-is-said", "No requirements graph yet for this repository" in words
          and "refused" not in body and "requirements_graph.json" not in body, words=words)
    page.get_by_test_id("requirements-generate").click()
    wiz = page.get_by_test_id("launch-wizard")
    wiz.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "desk-repo-page-requirements-generate.png"))
    intent = page.get_by_test_id("launch-wizard-intent").input_value() if page.get_by_test_id("launch-wizard-intent").count() else ""
    check("generate-opens-new-job", panel.count() == 0 and intent.startswith("Map the domain of studio-api")
          and not posts, intent=intent, posts=posts[:5], wizard_step=page.get_by_test_id("launch-wizard-step").get_attribute("data-step"))
    page.get_by_test_id("launch-wizard-close").click()

    # ── 5. what we know (round 10): the band's marks, each opening the thing itself ──
    cov = {"realPct": 54, "minPct": 80, "behaviorBearing": 100, "real": 54, "placeholders": 6, "unmapped": 40, "notProduct": 12}
    set_fixture(origin, requirements={"studio-api": [{"key": "booking::REQ-001", "reqId": "REQ-001", "title": "A booking needs a date"}]},
                requirements_header={"studio-api": {"coverage": cov, "graphBuild": {"generation": 2, "coverage": None, "behind": True}}},
                graph_kinds={"studio-api": [{"kind": "File", "count": 2}, {"kind": "Function", "count": 5}, {"kind": "domain", "count": 3}]})
    page.goto(f"{origin}/repo-detail/studio-api", wait_until="networkidle")
    band = page.get_by_test_id("repo-know-band")
    band.wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => [...document.querySelectorAll('[data-testid=repo-know-value]')].every((v) => v.textContent !== '…')", timeout=15000)
    marks = band.locator('[data-testid="repo-know-mark"]').evaluate_all(
        "(ms) => ms.map((m) => [m.dataset.mark, m.dataset.tone, m.querySelector('[data-testid=repo-know-value]').textContent, m.tagName])")
    page.screenshot(path=str(SHOTS / "desk-repo-page-know.png"))
    by = {m[0]: m for m in marks}
    check("what-we-know-marks", [m[0] for m in marks] == ["code", "reqs", "reqgraph", "domain-runs", "runs"]
          and by["reqs"][1] == "warn" and by["reqs"][2] == "54% real"
          and by["reqgraph"][1] == "warn" and by["reqgraph"][2] == "build 2 · 3 domains"
          and band.get_by_test_id("repo-know-flag").inner_text() == "behind"
          and by["code"][2] == "10 symbols", marks=marks)
    meter = band.get_by_test_id("repo-know-meter")
    check("requirements-meter", meter.get_attribute("data-pct") == "54" and meter.get_attribute("data-min") == "80")
    band.locator('[data-mark="reqs"]').click()
    page.get_by_test_id("requirement-row").first.wait_for(state="visible", timeout=10000)
    behind = page.get_by_test_id("requirements-graph-behind").count()
    check("requirements-mark-opens-requirements", page.get_by_test_id("requirement-row").count() == 1, behind_note=behind)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    band.locator('[data-mark="reqgraph"]').click()
    page.get_by_role("button", name="Close graph").wait_for(state="visible", timeout=10000)
    pressed = page.evaluate("() => [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Domain').map((b) => b.getAttribute('aria-pressed'))")
    page.screenshot(path=str(SHOTS / "desk-repo-page-know-reqgraph.png"))
    check("requirements-graph-mark-opens-the-domain-graph", pressed == ["true"], pressed=pressed)
    page.get_by_role("button", name="Close graph").click()
    set_fixture(origin, requirements=None, requirements_header=None, graph_kinds=None)
    set_fixture(origin, repo=False, workflow_catalog=False)

    # ── 6. tabs (2026-11-05): each its own address, one panel at a time, Back returns ──
    set_fixture(origin, repo=True)
    page.goto(f"{origin}/repo-detail/studio-api?tab=history", wait_until="networkidle")
    page.get_by_test_id("repo-panel-history").wait_for(state="visible", timeout=15000)
    first = {"selected": page.get_by_test_id("repo-tab-history").get_attribute("aria-selected"),
             "panels": page.locator('[role="tabpanel"]').count(), "commits": page.get_by_test_id("repo-history-commits").count(),
             "band": page.get_by_test_id("repo-know-band").count()}
    page.get_by_test_id("repo-tab-knowledge").click()
    page.wait_for_url("**/repo-detail/studio-api?tab=knowledge", timeout=10000)
    page.get_by_test_id("repo-panel-knowledge").wait_for(state="visible", timeout=10000)
    second = {"commits": page.get_by_test_id("repo-history-commits").count(), "map": page.get_by_test_id("repo-code-map").count()}
    page.go_back()
    page.get_by_test_id("repo-panel-history").wait_for(state="visible", timeout=10000)
    check("tabs-deep-link-one-panel-back", first == {"selected": "true", "panels": 1, "commits": 1, "band": 0}
          and second == {"commits": 0, "map": 1} and page.url.endswith("/repo-detail/studio-api?tab=history"),
          first=first, second=second, url=page.url)
    page.screenshot(path=str(SHOTS / "desk-repo-page-tabs.png"))
    set_fixture(origin, repo=False)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
