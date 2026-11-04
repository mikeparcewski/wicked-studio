#!/usr/bin/env python3
"""
desk_sidebar_test.py — THE SIDEBAR'S HEADINGS AND ICON RAIL (operator 2026-11-04, studio-sidebar-1104) in a real
browser, on the in-process fixture:

  1. LEARN sits at the foot, above Build & settings, then Nerve Center; never in a group, no "Start here".
  2. FRESH STORAGE: only Work is open; Insight, Govern and Recent are shut (their lists hidden, their pages not
     listed); nothing is written to studio.sidebar.v1 until the viewer changes something.
  3. KEYBOARD: Enter and Space toggle a heading (a real button with aria-expanded and aria-controls); the change
     is saved, and a reload restores it. Junk in storage falls back to Work open.
  4. THE PAGE ON SCREEN IS FINDABLE: on /memory with nothing saved, Govern opens for the view (Memory is the
     current page, the heading's home link is aria-current="true"), and that opening is not saved.
  5. THE ICON RAIL: the fold control folds the rail to 56 px (remembered across a reload, focus kept on the
     control); every heading shows as a named icon with a tooltip (Work, Insight, Govern, Recent, Learn, Build &
     settings, Nerve Center); a group's icon opens its home page (Projects, Report, Steering), Learn, Build &
     settings and Nerve Center open theirs, and Recent (no home page) unfolds the rail with Recent open. The brand
     unfolds it too.
  6. NERVE CENTER keeps its state's fill at icon size: the same tone and the same background colour as the full
     tile, not the rail's ground, and its state in its name.
  7. A PHONE (390x844) keeps its full drawer even with the rail folded on a desktop.
  8. 0 page errors.

Captures: e2e/shots/desk-sidebar-{fresh,memory,icons}-1440x900.png, desk-sidebar-drawer-390x844.png.
Env: FEEDBACK_PORT (default 4717).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4717"))
W, H = 1440, 900
SHOTS = REPO / "e2e" / "shots"
KEY = "studio.sidebar.v1"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


# Every heading toggle: its words and aria-expanded, and whether the list it controls is hidden.
HEADINGS = """() => Object.fromEntries([...document.querySelectorAll('[data-testid^="rail-sec-toggle-"], [data-testid="rail-recent-toggle"]')]
  .map((b) => [b.querySelector('span')?.textContent?.trim(), { expanded: b.getAttribute('aria-expanded'), tag: b.tagName,
    hidden: document.getElementById(b.getAttribute('aria-controls') ?? '')?.hidden ?? null }]))"""
LISTED = """() => [...document.querySelectorAll('[data-testid="session-rail"] .wk-rail-nav-item')].filter((e) => e.offsetParent !== null).map((e) => e.dataset.testid)"""
STORED = f"() => localStorage.getItem({json.dumps(KEY)})"

dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True, wave2b=True)
    page.goto(f"{origin}/jobs", wait_until="networkidle")
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until="networkidle")
    page.get_by_test_id("session-rail").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("rail-recent-toggle").wait_for(state="visible", timeout=15000)

    # ── 1. Learn above Build & settings ─────────────────────────────────────────────────
    foot = page.evaluate("""() => ({ foot: [...document.querySelectorAll('[data-testid="session-rail"] .wk-rail-foot a')].map((a) => a.dataset.testid),
      inGroup: !!document.querySelector('[data-testid="rail-nav"] [data-testid="nav-learn"]'),
      text: document.querySelector('[data-testid="session-rail"]').innerText,
      nerveLast: !!document.querySelector('[data-testid="session-rail"]').lastElementChild.querySelector('[data-testid="desk-rail-nerve"]') })""")
    check("1-learn-above-build", foot["foot"] == ["nav-learn", "desk-rail-build"] and not foot["inGroup"] and foot["nerveLast"]
          and "Start here" not in foot["text"], foot=foot["foot"], inGroup=foot["inGroup"])

    # ── 2. fresh storage: only Work open ────────────────────────────────────────────────
    heads = page.evaluate(HEADINGS)
    listed = page.evaluate(LISTED)
    page.screenshot(path=str(SHOTS / "desk-sidebar-fresh-1440x900.png"))
    check("2-fresh-work-only", {k: v["expanded"] for k, v in heads.items()} == {"Work": "true", "Insight": "false", "Govern": "false", "Recent": "false"}
          and all(v["tag"] == "BUTTON" for v in heads.values())
          and {k: v["hidden"] for k, v in heads.items()} == {"Work": False, "Insight": True, "Govern": True, "Recent": True}
          # Work's pages (however many the nav model lists), then the foot; nothing from a shut heading.
          and listed[0] == "nav-projects" and listed[-2:] == ["nav-learn", "desk-rail-build"]
          and not set(listed) & {"nav-report", "nav-understand", "nav-evaluate", "nav-steering", "nav-memory", "nav-agents"}
          and page.evaluate(STORED) is None, heads=heads, listed=listed)

    # ── 3. keyboard: Enter and Space toggle; saved; restored; junk falls back ───────────
    page.get_by_test_id("rail-sec-toggle-insight").focus()
    page.keyboard.press("Enter")
    after_enter = page.get_by_test_id("rail-sec-toggle-insight").get_attribute("aria-expanded")
    page.get_by_test_id("nav-report").wait_for(state="visible", timeout=3000)
    page.keyboard.press("Space")
    after_space = page.get_by_test_id("rail-sec-toggle-insight").get_attribute("aria-expanded")
    page.keyboard.press("Enter")
    saved = json.loads(page.evaluate(STORED) or "null")
    page.reload(wait_until="networkidle")
    page.get_by_test_id("rail-sec-toggle-insight").wait_for(state="visible", timeout=15000)
    restored = page.evaluate(HEADINGS)
    page.evaluate(f"() => localStorage.setItem({json.dumps(KEY)}, '{{not json')")
    page.reload(wait_until="networkidle")
    page.get_by_test_id("rail-sec-toggle-work").wait_for(state="visible", timeout=15000)
    junk = page.evaluate(HEADINGS)
    check("3-keyboard-saved-restored", after_enter == "true" and after_space == "false"
          and saved == {"open": ["work", "insight"], "icons": False}
          and restored["Insight"]["expanded"] == "true" and restored["Govern"]["expanded"] == "false"
          and {k: v["expanded"] for k, v in junk.items()} == {"Work": "true", "Insight": "false", "Govern": "false", "Recent": "false"},
          after_enter=after_enter, after_space=after_space, saved=saved, restored=restored, junk=junk)

    # ── 4. the page on screen is findable under a shut heading (not saved) ──────────────
    page.evaluate("() => localStorage.clear()")
    page.goto(f"{origin}/memory", wait_until="networkidle")
    page.get_by_test_id("nav-memory").wait_for(state="visible", timeout=15000)
    here = page.evaluate("""() => ({ govern: document.querySelector('[data-testid="rail-sec-toggle-govern"]').getAttribute('aria-expanded'),
      memory: document.querySelector('[data-testid="nav-memory"]').getAttribute('aria-current'),
      home: document.querySelector('[data-testid="rail-sec-home-govern"]').getAttribute('aria-current'),
      others: [...document.querySelectorAll('[data-testid^="rail-sec-home-"][aria-current]')].map((e) => e.dataset.testid) })""")
    page.screenshot(path=str(SHOTS / "desk-sidebar-memory-1440x900.png"))
    check("4-active-page-findable", here == {"govern": "true", "memory": "page", "home": "true", "others": ["rail-sec-home-govern"]}
          and page.evaluate(STORED) is None, **here)

    # ── 5. the icon rail ────────────────────────────────────────────────────────────────
    page.get_by_test_id("rail-fold").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"session-rail\"]').dataset.rail === 'icons'", timeout=5000)
    folded = page.evaluate("""() => ({ width: document.querySelector('[data-testid="session-rail"]').getBoundingClientRect().width,
      focus: document.activeElement?.dataset.testid ?? null, focusName: document.activeElement?.getAttribute('aria-label') ?? null })""")
    page.reload(wait_until="networkidle")
    page.wait_for_function("() => document.querySelector('[data-testid=\"session-rail\"]')?.dataset.rail === 'icons'", timeout=15000)
    page.locator('[data-rail-heading="recent"]').wait_for(state="visible", timeout=15000)
    icons = page.evaluate("""() => [...document.querySelectorAll('[data-rail-heading]')].map((e) => { const b = e.getBoundingClientRect();
      return { id: e.dataset.railHeading, name: e.getAttribute('aria-label'), title: e.getAttribute('title'), words: e.innerText.trim(), svg: !!e.querySelector('svg'),
               shown: b.width > 0 && b.height > 0 && b.right <= 57 && b.bottom <= innerHeight }; })""")
    page.screenshot(path=str(SHOTS / "desk-sidebar-icons-1440x900.png"))
    names = {i["id"]: i["name"] for i in icons}
    check("5a-icon-rail", abs(folded["width"] - 56) < 1 and folded["focus"] == "rail-fold" and folded["focusName"] == "Expand the sidebar"
          and [i["id"] for i in icons] == ["work", "insight", "govern", "recent", "learn", "build", "watch"]
          and all(i["svg"] and i["shown"] and i["title"] and i["words"] == "" for i in icons)
          and names["work"] == "Work: Projects" and names["insight"] == "Insight: Report" and names["govern"] == "Govern: Steering"
          and names["recent"] == "Recent: expand the sidebar" and names["learn"] == "Learn" and names["build"] == "Build & settings"
          and (names["watch"] or "").startswith("Nerve Center: "), folded=folded, icons=icons)

    went = {}
    for heading, path in (("work", "/projects"), ("insight", "/report"), ("govern", "/rules"), ("learn", "/learn"), ("build", "/build"), ("watch", "/watch")):
        page.locator(f'[data-rail-heading="{heading}"]').click()
        page.wait_for_function(f"() => location.pathname === {json.dumps(path)}", timeout=8000)
        went[heading] = {"path": page.evaluate("() => location.pathname"), "rail": page.evaluate("() => document.querySelector('[data-testid=\"session-rail\"]').dataset.rail")}
    check("5b-icons-go-home", all(v["rail"] == "icons" for v in went.values()), **went)

    # ── 6. Nerve Center at icon size keeps the full tile's fill: its background is the one a full tile in the same
    #       state has (a full-size probe with its tone and read, in the same dock), not the rail's ground ──
    NERVE = """() => { const t = document.querySelector('[data-testid="desk-rail-nerve"]'); const rail = document.querySelector('[data-testid="session-rail"]');
      const probe = document.createElement('a'); probe.className = 'wk-nc-tile'; probe.dataset.tone = t.dataset.tone; probe.dataset.read = t.dataset.read;
      t.parentElement.appendChild(probe); const full = getComputedStyle(probe).backgroundColor; const edge = getComputedStyle(probe).borderTopColor; probe.remove();
      return { tone: t.dataset.tone, read: t.dataset.read, bg: getComputedStyle(t).backgroundColor, edge: getComputedStyle(t).borderTopColor, full, fullEdge: edge,
               railBg: getComputedStyle(rail).backgroundColor, name: t.getAttribute('aria-label'), cls: t.className }; }"""
    page.wait_for_function("() => document.querySelector('[data-testid=\"desk-rail-nerve\"]')?.dataset.read !== 'checking'", timeout=15000)
    page.mouse.move(W // 2, H // 2)
    page.wait_for_timeout(300)
    nerve = page.evaluate(NERVE)
    words = {"green": "nothing needs you", "yellow": "needs a look", "red": "work is blocked"}
    check("6-nerve-colour", nerve["tone"] in words and nerve["bg"] == nerve["full"] and nerve["edge"] == nerve["fullEdge"] and nerve["bg"] != nerve["railBg"]
          and "wk-nc-tile--icon" in nerve["cls"] and nerve["name"].startswith("Nerve Center: ") and nerve["name"].endswith(words[nerve["tone"]]), **nerve)

    # Recent has no home page: it unfolds the rail with Recent open. The brand unfolds it too.
    page.locator('[data-rail-heading="recent"]').click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"session-rail\"]').dataset.rail === 'full'", timeout=5000)
    recent = {"expanded": page.get_by_test_id("rail-recent-toggle").get_attribute("aria-expanded"),
              "focus": page.evaluate("() => document.activeElement?.dataset.testid ?? null"), "path": page.evaluate("() => location.pathname")}
    page.get_by_test_id("rail-fold").click()
    page.get_by_test_id("desk-rail-brand-expand").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"session-rail\"]').dataset.rail === 'full'", timeout=5000)
    check("5c-recent-and-brand-unfold", recent == {"expanded": "true", "focus": "rail-recent-toggle", "path": "/watch"}
          and json.loads(page.evaluate(STORED))["icons"] is False, recent=recent)

    # ── 7. a phone keeps its full drawer ───────────────────────────────────────────────
    page.evaluate(f"() => localStorage.setItem({json.dumps(KEY)}, JSON.stringify({{ open: ['work'], icons: true }}))")
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("rail-drawer-toggle").click()
    page.get_by_test_id("rail-drawer").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(400)
    drawer = page.evaluate("""() => ({ rail: document.querySelector('[data-testid="session-rail"]').dataset.rail,
      fold: !!document.querySelector('[data-testid="rail-fold"]') })""")
    page.screenshot(path=str(SHOTS / "desk-sidebar-drawer-390x844.png"))
    check("7-phone-drawer-full", drawer == {"rail": "full", "fold": False}, **drawer)

    check("8-no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
