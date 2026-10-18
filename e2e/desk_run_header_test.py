#!/usr/bin/env python3
"""
desk_run_header_test.py — the run page's header, banner, panel and jump (operator 2026-10-18: "The since you left
banner sits over some of the run page … should have a quick scroll down option when not scrolled to end … Header
could be much cleaner; we don't need the details button, details should be expanded by default and closeable as well
as viewable as a right panel when it's closed. Stopped should stand out — something red and dangerous. Waiting on you
line should appear as a banner below the header (when needed) and putting mouse over the yellow text will give you a
quick overview"). Against the `chat_native` corpus (e2e/chat_native_corpus.py), at 1440x700 and 390x844:

  1. NOTHING OVER THE THREAD: no "since you left" card; the header is the title and one state badge (no Details
     button); a waiting run's "1 needs you" banner sits between the header and the thread, in the flow.
  2. THE OVERVIEW: hovering the yellow words lists each waiting item (kind · step · age, the question) with Go to it,
     which brings the plan card into view. Keyboard focus opens it too; Esc closes it. A running run has no banner.
  3. JUMP TO LATEST: scrolled up from the newest message, a ↓ button shows above the composer; it goes back to the
     newest message and goes away.
  4. THE PANEL: open by default beside the chat; its close leaves a right-edge handle (labelled, focusable) that
     opens it again from the keyboard; a closed panel is remembered across a reload.
  5. STOP STANDS OUT: a running run's Stop says "Stop run" in red; a failed run's badge is filled red — text on it
     clears 4.5:1 in the light and dark themes.
  6. PHONE: the panel starts behind the handle and opens over the page; the banner and the header fit; no
     horizontal scroll. 0 page errors.

Captures: e2e/shots/desk-run-header-*.png. Env: FEEDBACK_PORT (default 4615).
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4615"))
SHOTS = REPO / "e2e" / "shots"
SW = {"chat_native": True, "run_chat_id": True, "sessions": True, "ask_path": True, "team_plan": True}

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

LAYOUT = """() => {
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const q = (s) => document.querySelector(s);
  const head = q('.wk-session-head');
  return {
    head: box(head), banner: box(q('[data-testid="session-needs-banner"]')), thread: box(q('[data-testid="session-thread"]')),
    panel: box(q('[data-testid="host-panel"]')), handle: box(q('[data-testid="run-details-handle"]')),
    since: document.querySelectorAll('[data-testid="since-you-left"], .wk-since').length,
    detailsButton: document.querySelectorAll('[data-testid="session-details-toggle"]').length,
    headText: head ? head.innerText : null,
    status: q('[data-testid="session-status"]')?.innerText ?? null,
    tone: q('[data-testid="session-status"]')?.dataset.tone ?? null,
    needs: q('[data-testid="session-needs-trigger"]')?.innerText ?? null,
    jump: box(q('[data-testid="session-jump-latest"]')), composer: box(q('.wk-session-composer-wrap')),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

# WCAG contrast of an element's text on its own background (both opaque, as the badge and the confirm are).
CONTRAST = """(sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const cs = getComputedStyle(el);
  const rgb = (c) => { const ctx = document.createElement('canvas').getContext('2d'); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const fg = rgb(cs.color), bg = rgb(cs.backgroundColor);
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return { ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, fg, bg, red: bg[0] > bg[1] + 60 && bg[0] > bg[2] + 60, redText: fg[0] > fg[1] + 60 && fg[0] > fg[2] + 60 };
}"""

errors: list[str] = []


def new_page(browser, w: int, h: int):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return ctx, page


def open_run(page, run_id: str, wait_for: str, theme: str = "light") -> dict:
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, **SW)
    page.goto(f"{origin}/s/run%3A{run_id}", wait_until="networkidle")
    try:
        page.locator(wait_for).first.wait_for(state="attached", timeout=15000)
    except Exception:  # noqa: BLE001
        fail(f"open-{run_id}", {"why": f"{wait_for} never showed"})
    page.wait_for_timeout(800)
    return page.evaluate(LAYOUT)


PLAN = '[data-testid="chat-plan"][data-open="true"]'

with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = new_page(browser, 1440, 700)

    # ── 1. nothing over the thread; the banner sits between the header and the thread ──────────────
    d = open_run(page, "r-cn-plan", PLAN)
    page.screenshot(path=str(SHOTS / "desk-run-header-waiting-1440.png"))
    check("header-clean", d["since"] == 0 and d["detailsButton"] == 0 and d["status"] == "Waiting"
          and "needs you" not in (d["headText"] or "") and "Waiting on you" not in (d["headText"] or ""), page=d)
    check("banner-in-flow", d["banner"] is not None and d["needs"] == "1 needs you"
          and d["head"]["b"] <= d["banner"]["t"] and d["banner"]["b"] <= d["thread"]["t"], page=d)

    # ── 2. the overview on hover; Go to it brings the plan card into view ─────────────────────────────
    page.get_by_test_id("session-needs-trigger").hover()
    overview = page.get_by_test_id("session-needs-overview")
    overview.wait_for(state="visible", timeout=3000)
    page.screenshot(path=str(SHOTS / "desk-run-header-overview-1440.png"))
    items = page.locator('[data-testid="session-needs-item"]').evaluate_all(
        "els => els.map(e => ({ kind: e.querySelector('[data-testid=\"session-needs-kind\"]')?.innerText, "
        "question: e.querySelector('[data-testid=\"session-needs-question\"]')?.innerText, run: e.dataset.runId }))")
    check("overview-items", len(items) == 1 and items[0]["run"] == "r-cn-plan" and items[0]["kind"] == "Plan approval"
          and (items[0]["question"] or "").startswith("Approve the plan"), items=items)
    page.get_by_test_id("session-thread").evaluate("el => { el.scrollTop = el.scrollHeight; }")
    page.get_by_test_id("session-needs-jump").first.click()
    page.wait_for_timeout(900)
    inview = page.evaluate("""() => { const t = document.querySelector('[data-testid="session-thread"]').getBoundingClientRect();
      const c = document.querySelector('[data-testid="chat-plan"][data-open="true"]').getBoundingClientRect();
      return c.top >= t.top - 2 && c.top < t.bottom; }""")
    check("overview-go-to-it", inview and not overview.is_visible())
    page.mouse.move(700, 650)
    page.get_by_test_id("session-needs-trigger").focus()
    check("overview-keyboard-opens", overview.is_visible())
    page.keyboard.press("Escape")
    check("overview-esc-closes", not overview.is_visible())

    # ── 3. jump to latest ───────────────────────────────────────────────────────────────────────────
    d = open_run(page, "r-cn-bug", '[data-testid="chat-final"]')
    check("finished-no-banner", d["banner"] is None and d["jump"] is None and d["tone"] == "ok", page=d)
    page.screenshot(path=str(SHOTS / "desk-run-header-finished-1440.png"))
    thread = page.get_by_test_id("session-thread")
    tb = thread.bounding_box()
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2)
    for _ in range(6):
        page.mouse.wheel(0, -600)
        page.wait_for_timeout(80)
    page.wait_for_timeout(400)
    d = page.evaluate(LAYOUT)
    page.screenshot(path=str(SHOTS / "desk-run-header-jump-1440.png"))
    check("jump-shows", d["jump"] is not None and d["jump"]["b"] <= d["composer"]["t"]
          and abs((d["jump"]["l"] + d["jump"]["r"]) / 2 - (d["thread"]["l"] + d["thread"]["r"]) / 2) <= 4, page=d)
    page.get_by_test_id("session-jump-latest").click()
    page.wait_for_timeout(1200)
    at_end = thread.evaluate("el => el.scrollHeight - el.scrollTop - el.clientHeight < 80")
    check("jump-goes-to-latest", at_end and page.get_by_test_id("session-jump-latest").count() == 0)

    # ── 4. the panel: open by default; close → edge handle → keyboard reopens; remembered ─────────────
    check("panel-open-default", d["panel"] is not None and d["panel"]["w"] == 400 and d["panel"]["r"] == 1440 and d["handle"] is None, page=d)
    page.get_by_test_id("host-panel-fold").click()
    page.wait_for_timeout(300)
    d = page.evaluate(LAYOUT)
    page.screenshot(path=str(SHOTS / "desk-run-header-finished-closed-1440.png"))
    handle = page.get_by_test_id("run-details-handle")
    check("panel-closes-to-handle", d["panel"] is None and d["handle"] is not None and d["handle"]["r"] == 1440 and d["handle"]["w"] <= 40
          and handle.get_attribute("aria-label") == "Show the run’s details"
          and page.evaluate("() => document.activeElement?.dataset?.testid") == "run-details-handle", page=d)
    page.reload(wait_until="networkidle")
    page.locator('[data-testid="chat-final"]').first.wait_for(state="attached", timeout=15000)
    page.wait_for_timeout(600)
    check("panel-remembered-closed", page.locator('[data-testid="host-panel"]').count() == 0 and handle.count() == 1)
    handle.focus()
    page.keyboard.press("Enter")
    page.locator('[data-testid="host-panel"]').wait_for(state="visible", timeout=5000)
    check("handle-keyboard-opens", page.evaluate("() => document.activeElement?.dataset?.testid") == "host-panel-fold")

    # ── 5. Stop stands out; a failed run reads red — in both themes ───────────────────────────────────
    for theme in ("light", "dark"):
        d = open_run(page, "r-cn-live", '[data-testid="session-working"]', theme)
        stop = page.get_by_test_id("session-stop")
        sc = page.evaluate(CONTRAST, '[data-testid="session-stop"]')
        page.screenshot(path=str(SHOTS / f"desk-run-header-running-{theme}-1440.png"))
        check(f"{theme}-stop-red", stop.inner_text().strip() == "Stop run" and sc["redText"] and sc["ratio"] >= 4.5, stop=sc)
        stop.click()
        cc = page.evaluate(CONTRAST, '[data-testid="session-stop-confirm"]')
        check(f"{theme}-stop-confirm-filled-red", cc["red"] and cc["ratio"] >= 4.5, confirm=cc)
        page.get_by_test_id("session-stop-keep").click()
        d = open_run(page, "r-cn-fail", '[data-testid="chat-final"]', theme)
        bc = page.evaluate(CONTRAST, '[data-testid="session-status"]')
        page.screenshot(path=str(SHOTS / f"desk-run-header-stopped-{theme}-1440.png"))
        check(f"{theme}-failed-badge-red", d["status"] == "Failed" and d["tone"] == "danger" and bc["red"] and bc["ratio"] >= 4.5, badge=bc, page=d)
    ctx.close()

    # ── 6. phone ────────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844)
    d = open_run(page, "r-cn-plan", PLAN)
    page.screenshot(path=str(SHOTS / "desk-run-header-waiting-390.png"))
    check("phone-banner-handle", d["banner"] is not None and d["head"]["b"] <= d["banner"]["t"] and d["banner"]["b"] <= d["thread"]["t"]
          and d["panel"] is None and d["handle"] is not None and d["handle"]["r"] == 390 and not d["hscroll"], page=d)
    page.get_by_test_id("session-needs-trigger").click()
    page.get_by_test_id("session-needs-overview").wait_for(state="visible", timeout=3000)
    ov = page.get_by_test_id("session-needs-overview").bounding_box()
    page.screenshot(path=str(SHOTS / "desk-run-header-overview-390.png"))
    check("phone-overview-fits", ov is not None and ov["x"] >= 0 and ov["x"] + ov["width"] <= 390, overview=ov)
    page.keyboard.press("Escape")
    page.get_by_test_id("run-details-handle").click()
    page.locator('[data-testid="host-panel"]').wait_for(state="visible", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-run-header-panel-390.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("phone-panel-overlay-esc", page.locator('[data-testid="host-panel"]').count() == 0 and page.get_by_test_id("run-details-handle").count() == 1)
    ctx.close()

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
