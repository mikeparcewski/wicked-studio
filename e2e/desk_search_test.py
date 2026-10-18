#!/usr/bin/env python3
"""
desk_search_test.py — global search and the rail's action row (operator 2026-10-18: "search, new run
and chat on every page"; one search modal, used from the rail and ⌘K alike).

Against the in-process fixture (its `GET /api/v1/search` stands in for crew's), at 1440x700:

  1. The rail's action row (New job · Search · Chat · New project) is on the Desk, a project page, a
     run page and General; no page header carries its own search bar, Chat or New job.
  2. The rail's Search opens THE search modal; "upload" answers tabbed by entity — runs, projects,
     transcripts, rules, memories, docs — each match marked; a tab narrows to its type.
  3. Enter on a hit opens it where studio shows it (a run opens its session).
  4. ⌘K opens the same modal from another page; the last search is offered as a recent search.
  5. A query nothing matches says so.
  6. New job and Chat from the rail on General open the wizard and the chat panel.
  7. At 390x844 the phone top bar's Search opens the same modal.
  8. 0 page errors.

Captures: e2e/shots/desk-search-*.png. Env: FEEDBACK_PORT (default 4391).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
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


ROW = """() => [...document.querySelectorAll('[data-testid="palette-row"]')].map(e => ({
  group: e.dataset.group, href: e.getAttribute('href'), text: e.innerText.split('\\n')[0],
  marks: [...e.querySelectorAll('mark')].map(m => m.textContent) }))"""
TABS = """() => [...document.querySelectorAll('[data-testid="search-tab"]')].map(t => ({
  type: t.dataset.type, selected: t.getAttribute('aria-selected') === 'true',
  count: t.querySelector('[data-testid="search-tab-count"]')?.textContent ?? null }))"""
CHROME = """() => ({
  rail: [...document.querySelectorAll('[data-testid="desk-rail-actions"] button')].map(b => b.dataset.testid),
  headerSearch: !!document.querySelector('[data-testid="desk-command"]'),
  headerChat: !!document.querySelector('[data-testid="desk-chat"], [data-testid="project-chat"]'),
  headerNewJob: !!document.querySelector('[data-testid="desk-new-job"], [data-testid="project-new-job"]'),
})"""
RAIL = ["desk-rail-new-job", "desk-rail-search", "desk-rail-chat", "desk-rail-new-project"]

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, repo=True)
    page.route("**/api/v1/projects/upload-endpoint", lambda r: r.fulfill(status=200, json={
        "project": {"id": "upload-endpoint", "name": "upload-endpoint", "description": None, "status": "active",
                    "scope": "project:upload-endpoint", "created_at": 1, "updated_at": 1}, "members": []})
        if r.request.method == "GET" else r.fallback())

    # ── 1. the action row on every page; no page header of its own ─────────────────────
    chrome = {}
    for name, path, ready in (("desk", "/", "desk-tabs"), ("project", "/projects/upload-endpoint", "project-desk"),
                              ("run", "/s/run%3Ar-upload", "session-rail"), ("general", "/system", "session-rail")):
        page.goto(f"{origin}{path}", wait_until="networkidle")
        page.get_by_test_id(ready).first.wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(300)
        chrome[name] = page.evaluate(CHROME)
        page.screenshot(path=str(SHOTS / f"desk-search-header-{name}.png"))
    check("action-row-everywhere", all(c["rail"] == RAIL and not c["headerSearch"] and not c["headerChat"]
                                       and not c["headerNewJob"] for c in chrome.values()), chrome=chrome)

    # ── 2. the rail's Search opens the modal; results tabbed by entity, the match marked ──
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-tabs").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-rail-search").click()
    page.get_by_test_id("command-palette").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("palette-input").fill("upload")
    page.get_by_test_id("search-tabs").wait_for(state="visible", timeout=5000)
    page.wait_for_function("() => document.querySelector('[data-testid=\"palette-row\"][data-group=\"hit-run\"]')", timeout=5000)
    rows = page.evaluate(ROW)
    tabs = page.evaluate(TABS)
    page.screenshot(path=str(SHOTS / "desk-search-all.png"))
    groups = [r["group"] for r in rows if r["group"].startswith("hit-")]
    want = {"hit-run", "hit-project", "hit-transcript", "hit-rule", "hit-memory", "hit-doc"}
    marked = all(any(m.lower() == "upload" for m in r["marks"]) for r in rows if r["group"].startswith("hit-"))
    check("tabbed-results", want <= set(groups) and marked and [t["type"] for t in tabs][:2] == ["all", "run"]
          and next(t for t in tabs if t["type"] == "rule")["count"] == "1", groups=sorted(set(groups)), tabs=tabs, rows=rows[:12])

    page.get_by_test_id("search-tab").and_(page.locator('[data-type="rule"]')).click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"search-tab\"][data-type=\"rule\"]')?.getAttribute('aria-selected') === 'true'", timeout=3000)
    page.wait_for_timeout(400)
    rule_rows = page.evaluate(ROW)
    page.screenshot(path=str(SHOTS / "desk-search-rules.png"))
    check("tab-narrows", [r["group"] for r in rule_rows] == ["hit-rule"]
          and rule_rows[0]["href"] == "/rules/POL-upload-limits", rows=rule_rows)

    # ── 3. Enter opens a hit (back on All: the run hit opens its session) ──────────────
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    page.wait_for_timeout(300)
    rows = page.evaluate(ROW)
    ix = next((i for i, r in enumerate(rows) if r["group"] == "hit-run"), -1)
    for _ in range(ix):
        page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    at = page.evaluate("() => window.location.pathname")
    check("enter-opens", ix >= 0 and at == "/s/run%3Ar-upload" and page.get_by_test_id("command-palette").count() == 0, at=at, ix=ix)

    # ── 4. ⌘K, another page: the same modal, the last search offered ───────────────────
    page.locator("body").click(position={"x": 900, "y": 12})
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
    rows = page.evaluate(ROW)
    page.screenshot(path=str(SHOTS / "desk-search-recent.png"))
    check("recent", rows[:1] == [{"group": "recent", "href": None, "text": "upload", "marks": []}], rows=rows[:3])

    # ── 5. nothing matches ───────────────────────────────────────────────────────────────
    page.get_by_test_id("palette-input").fill("zzqx nothing")
    page.get_by_test_id("search-empty").wait_for(state="visible", timeout=5000)
    empty = page.get_by_test_id("search-empty").inner_text()
    page.screenshot(path=str(SHOTS / "desk-search-empty.png"))
    page.keyboard.press("Escape")
    check("no-match", "Nothing matches “zzqx nothing”." in empty, empty=empty)

    # ── 6. New job and Chat from the rail, on General ────────────────────────────────────
    page.goto(f"{origin}/system", wait_until="networkidle")
    page.get_by_test_id("desk-rail-new-job").click()
    page.get_by_test_id("launch-wizard").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.get_by_test_id("desk-rail-chat").click()
    page.get_by_test_id("ask-panel").wait_for(state="visible", timeout=5000)
    check("rail-new-job-and-chat", True)

    # ── 7. the phone: the top bar's Search opens the same modal ──────────────────────────
    phone = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    phone.on("pageerror", lambda e: errors.append(str(e)))
    phone.goto(f"{origin}/", wait_until="networkidle")
    phone.get_by_test_id("topbar-search").click()
    phone.get_by_test_id("palette-input").fill("upload")
    phone.wait_for_function("() => document.querySelector('[data-testid=\"palette-row\"][data-group=\"hit-run\"]')", timeout=5000)
    phone.wait_for_timeout(200)
    phone.screenshot(path=str(SHOTS / "desk-search-phone.png"))
    width = phone.evaluate("() => document.querySelector('[data-testid=\"command-palette\"]').getBoundingClientRect().width")
    check("phone", width <= 390 - 8, width=width)

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
