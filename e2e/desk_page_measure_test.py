"""The page measure (operator 2026-10-16): "All of the workspace pages are left aligned and full width -
they should be centered and constrained" and "run pages - like the workspace ones should be centered and
constrained".

The operator's path: open each Workspace page from the rail (Skills, MCP, Plugins, Workflows,
General — the Settings page, whose Theme tab is checked by address), then Nerve Center, then a run's page and a chat's page. On each, at 1440x700 and at 1920x1000:

  1. the page's content sits centred in the main column: its left and right gaps differ by at most 2 px;
  2. it is constrained: never wider than the measure (1120 px for a page and Nerve Center, 832 px for
     Settings (General and Theme tabs), 896 px for a session's thread), so at 1920 there is room on both sides;
  3. the session's header, thread and composer share one left edge and one right edge;
  4. at 1920 the composer's `/` menu opens under its input, and with an artifact open beside the thread
     the head, thread and composer centre in the room left (the composer keeps a usable width);
  5. on a phone (390x844) nothing scrolls sideways.

Captures: e2e/shots/desk-page-measure-*.png. Env: FEEDBACK_PORT (default 4601).
"""
import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4601"))
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, sessions=True, run_chat_id=True)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

# The content box of an element (its border box minus its inline padding) against a reference box.
BOX = """([sel, ref]) => {
  const el = document.querySelector(sel); const host = document.querySelector(ref);
  if (!el || !host) return null;
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const left = r.left + parseFloat(cs.paddingLeft); const right = r.right - parseFloat(cs.paddingRight);
  const h = host.getBoundingClientRect();
  // The reference's own scrollbar is not part of the column the content is centred in.
  const hostRight = h.left + host.clientLeft + host.clientWidth;
  return { left: Math.round(left - h.left), right: Math.round(hostRight - right), width: Math.round(right - left) };
}"""

# (rail test id or path, the page's content element, the column it is centred in, its measure)
# The ui-v2 nav regroup: Skills, MCP, Plugins, Workflows and Settings are links on Build & settings
# (`build-link-*`, reached through the rail's `desk-rail-build`), which is itself a narrow page.
PAGES = [
    # Build & settings is a calm page (the column the Steering/Memory/Agents pages use, 840 px).
    ("desk-rail-build", "[data-testid='build-page'] .wk-calm-col", "#main", 840),
    ("build-link-skills", ".wk-page", "#main", 1120),
    ("build-link-mcp", ".wk-page", "#main", 1120),
    ("build-link-plugins", ".wk-page", "#main", 1120),
    ("build-link-workflows", ".wk-page", "#main", 1120),
    ("build-link-settings", ".wk-page", "#main", 832),
    # studio-settings-tabs: the Theme tab of the same Settings page (picked from its tab row).
    ("settings-tab-theme", ".wk-page", "#main", 832),
    # Nerve Center (DES-SYSTEM-VIEW): the dashboard on /watch, the Watchtower feed under its panels.
    ("desk-rail-nerve", "[data-testid='nerve-center-page']", "#main", 1120 - 64),
]
SESSION = [("/s/run%3Ar-solo", "run"), ("/s/chat-pay", "chat")]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h) in ((1440, 700), (1920, 1000)):
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
        page.goto(f"{origin}/", wait_until="networkidle")
        for rail, sel, ref, measure in PAGES:
            if rail == "settings-tab-theme":
                page.locator('[data-testid="settings-tab"][data-tab="theme"]').click()
                page.wait_for_function("() => window.location.search === '?tab=theme'", timeout=5000)
            elif rail.startswith("build-link-"):
                page.get_by_test_id("desk-rail-build").click()
                page.get_by_test_id(rail).click()
            else:
                page.get_by_test_id(rail).click()
            page.wait_for_selector(sel, state="visible", timeout=8000)
            page.wait_for_timeout(250)
            # Nerve Center measures its scroller's CONTENT box (padding is the gutter).
            box = page.evaluate(BOX, [sel, ref])
            if sel == ".wk-page":
                # A PageFrame is itself the box: its border box is the measure, its padding the page's own.
                box = page.evaluate("""([sel, ref]) => { const r = document.querySelector(sel).getBoundingClientRect();
                  const host = document.querySelector(ref); const h = host.getBoundingClientRect();
                  return { left: Math.round(r.left - h.left), right: Math.round(h.left + host.clientLeft + host.clientWidth - r.right), width: Math.round(r.width) }; }""", [sel, ref])
            page.screenshot(path=str(SHOTS / f"desk-page-measure-{rail.replace('desk-rail-', '')}-{w}.png"))
            check(f"{rail}-{w}-centred", box is not None and abs(box["left"] - box["right"]) <= 2, box=box)
            check(f"{rail}-{w}-constrained", box["width"] <= measure and (w < 1900 or box["left"] >= 100), box=box, measure=measure)
        for path, name in SESSION:
            page.goto(f"{origin}{path}", wait_until="networkidle")
            page.get_by_test_id("session-thread").wait_for(state="visible", timeout=8000)
            page.wait_for_timeout(300)
            boxes = {part: page.evaluate(BOX, [sel, "[data-testid='session']"]) for part, sel in
                     (("head", ".wk-session-head"), ("thread", "[data-testid='session-thread']"), ("composer", ".wk-session-composer-wrap"))}
            page.screenshot(path=str(SHOTS / f"desk-page-measure-{name}-{w}.png"))
            t = boxes["thread"]
            check(f"session-{name}-{w}-centred", t is not None and abs(t["left"] - t["right"]) <= 2, boxes=boxes)
            check(f"session-{name}-{w}-constrained", t["width"] <= 896 - 96, boxes=boxes)
            check(f"session-{name}-{w}-one-edge", all(b is not None and abs(b["left"] - t["left"]) <= 1 and abs(b["right"] - t["right"]) <= 1
                                                     for b in boxes.values()), boxes=boxes)
        if w == 1920:
            # 4a. The `/` menu opens under the input it belongs to (its left edge is the form's).
            page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
            box_in = page.get_by_test_id("session-composer-input")
            box_in.click()
            page.keyboard.type("/")
            page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
            edges = page.evaluate("""() => ({ form: Math.round(document.querySelector('.wk-session-composer .wk-desk-composer').getBoundingClientRect().left),
              menu: Math.round(document.querySelector('[data-testid="composer-menu"]').getBoundingClientRect().left) })""")
            check("slash-menu-under-input", abs(edges["menu"] - edges["form"]) <= 2, edges=edges)
            page.keyboard.press("Escape")
            # 4b. With an artifact open beside the thread, head, thread and composer centre in what is left
            #    and the composer keeps a usable width.
            set_fixture(origin, walkthrough=True, walk_recorded=3, extra_frames=[], reset_walkthrough=True)
            page.goto(f"{origin}/s/run%3Ar-walk-fail", wait_until="networkidle")
            page.get_by_test_id("walkthrough-watch").click()
            page.wait_for_selector(".wk-session--pane", timeout=10000)
            page.wait_for_timeout(500)
            boxes = {part: page.evaluate(BOX, [sel, "[data-testid='session']"]) for part, sel in
                     (("head", ".wk-session-head"), ("thread", "[data-testid='session-thread']"), ("composer", ".wk-session-composer-wrap"))}
            page.screenshot(path=str(SHOTS / "desk-page-measure-pane-1920.png"))
            t = boxes["thread"]
            check("pane-one-edge", all(b is not None and abs(b["left"] - t["left"]) <= 1 and abs(b["width"] - t["width"]) <= 1 for b in boxes.values())
                  and boxes["composer"]["width"] >= 400, boxes=boxes)
        ctx.close()

    # Phone: nothing scrolls sideways on any of them.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    for path in ("/watch", "/skills", "/mcp", "/plugins", "/workflows", "/theme", "/system", "/health", "/s/run%3Ar-solo", "/s/chat-pay"):
        page.goto(f"{origin}{path}", wait_until="networkidle")
        page.wait_for_timeout(300)
        over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"phone-{path}-no-sideways", over <= 0, over=over)
    page.goto(f"{origin}/system", wait_until="networkidle")
    page.screenshot(path=str(SHOTS / "desk-page-measure-general-phone.png"))
    ctx.close()

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
