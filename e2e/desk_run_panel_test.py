#!/usr/bin/env python3
"""
desk_run_panel_test.py — the run page's ONE right panel (src/board/runPanelModel.ts; operator 2026-10-18: "for run we
have details and the run right panes, they should be one … group tabs with accordion-like displays so you don't need
30 of them"). Against the `chat_native` corpus (e2e/chat_native_corpus.py), at 1440x700 and 390x844:

  1. ONE PANEL: the header has Details and no ⋯; the panel is headed Details with no one-tab strip, 400 px beside the
     chat; it holds six folding sections (Now · Plan and steps · Changes and delivery · Checks and evidence · Agents
     and spend · Record), never a sheet over the run.
  2. THE STATE PICKS WHAT OPENS: a running run opens Now + Plan; a run at its plan gate opens Now + Plan, with "Go to
     the question" bringing the plan card into view; a finished run opens Now + Changes (its pull request); a failed
     run opens Now alone, which says why it stopped. Quiet sections are one closed line.
  3. KEYBOARD: a section header is a button with aria-expanded; Enter and Space fold it.
  4. REMEMBERED: closing Changes on a finished run survives a reload (this browser); a fresh browser has the default.
  5. A LINK LANDS: `#governance` on a run's address opens the panel at Checks and evidence → Governance.
  6. PHONE: Details opens the panel over the page, the same sections, no horizontal scroll. 0 page errors.

Captures: e2e/shots/desk-run-panel-{running,gate,done,failed}-{1440,390}.png. Env: FEEDBACK_PORT (default 4497).
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4497"))
SHOTS = REPO / "e2e" / "shots"
SW = {"chat_native": True, "run_chat_id": True, "sessions": True, "ask_path": True, "team_plan": True}
SECTIONS = ["now", "plan", "changes", "checks", "agents", "record"]

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

PANEL = """() => {
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const panel = document.querySelector('[data-testid="host-panel"]');
  const secs = panel ? [...panel.querySelectorAll('[data-testid="run-panel-section"]')] : [];
  return {
    panel: box(panel), thread: box(document.querySelector('[data-testid="session-thread"]')),
    heading: panel?.querySelector('[data-testid="host-panel-heading"]')?.innerText ?? null,
    tabs: panel ? panel.querySelectorAll('[data-testid="host-panel-tab"]').length : null,
    sections: secs.map((s) => s.dataset.section),
    open: secs.filter((s) => s.dataset.open === 'true').map((s) => s.dataset.section),
    quiet: secs.filter((s) => s.dataset.quiet === 'true').map((s) => s.dataset.section),
    summaries: Object.fromEntries(secs.map((s) => [s.dataset.section, s.querySelector('[data-testid="run-panel-summary"]')?.innerText ?? ''])),
    ariaOk: secs.every((s) => { const b = s.querySelector('[data-testid="run-panel-toggle"]'); const r = document.getElementById(b.getAttribute('aria-controls')); return b.tagName === 'BUTTON' && r && r.hidden === (b.getAttribute('aria-expanded') !== 'true'); }),
    story: !!panel?.querySelector('[data-testid="run-tab-story"]'),
    pr: panel?.querySelector('[data-testid="run-tab-pr"]')?.innerText ?? null,
    sheetOpen: !!document.querySelector('[data-testid="sheet"]'),
    dots: !!document.querySelector('[data-testid="session-sheet-open"]'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
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


def open_run(page, run_id: str, wait_for: str, hash_: str = "") -> dict:
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": "light"}, **SW)
    page.goto(f"{origin}/s/run%3A{run_id}{hash_}", wait_until="networkidle")
    try:
        page.locator(wait_for).first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        fail(f"open-{run_id}", {"why": f"{wait_for} never showed"})
    toggle = page.get_by_test_id("session-details-toggle")
    if toggle.get_attribute("aria-expanded") != "true":
        toggle.click()
    page.locator('[data-testid="host-panel"] [data-testid="run-tab"]').wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(700)
    return page.evaluate(PANEL)


STATES = [
    ("running", "r-cn-live", '[data-testid="session-working"]', ["now", "plan"]),
    ("gate", "r-cn-plan", '[data-testid="chat-plan"][data-open="true"]', ["now", "plan"]),
    ("done", "r-cn-bug", '[data-testid="chat-final"]', ["now", "changes"]),
    ("failed", "r-cn-fail", '[data-testid="chat-final"]', ["now"]),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)

    # ── 1-2. one panel; the state picks what opens ───────────────────────────────────────────────
    ctx, page = new_page(browser, 1440, 700)
    for name, rid, wait_for, want_open in STATES:
        d = open_run(page, rid, wait_for)
        page.screenshot(path=str(SHOTS / f"desk-run-panel-{name}-1440.png"))
        check(f"{name}-one-panel", d["panel"] is not None and d["panel"]["w"] == 400 and d["panel"]["r"] == 1440
              and d["thread"]["r"] <= d["panel"]["l"] and d["heading"] == "Details" and d["tabs"] == 0
              and d["sections"] == SECTIONS and d["ariaOk"] and not d["sheetOpen"] and not d["dots"] and not d["hscroll"], page=d)
        check(f"{name}-default-open", d["open"] == want_open, open=d["open"], quiet=d["quiet"])
        if name == "done":
            check("done-changes", d["pr"] == "Pull request #12 ↗" and d["summaries"]["changes"] == "Pull request #12"
                  and d["summaries"]["checks"] == "Passed", summaries=d["summaries"], pr=d["pr"])
        if name == "failed":
            check("failed-says-why", d["story"], page=d)
        if name == "gate":
            # The plan card scrolled out of view, then "Go to the question" brings it back.
            page.get_by_test_id("session-thread").evaluate("el => { el.scrollTop = el.scrollHeight; }")
            page.get_by_test_id("run-tab-goto-question").click()
            page.wait_for_timeout(900)
            inview = page.evaluate("""() => { const t = document.querySelector('[data-testid="session-thread"]').getBoundingClientRect();
              const c = document.querySelector('[data-testid="chat-plan"][data-open="true"]').getBoundingClientRect();
              return c.top >= t.top - 2 && c.top < t.bottom; }""")
            check("gate-go-to-question", inview)

    # ── 3. keyboard: Enter and Space fold a section ────────────────────────────────────────────────
    d = open_run(page, "r-cn-bug", '[data-testid="chat-final"]')
    checks = page.locator('[data-testid="host-panel"] [data-testid="run-panel-toggle"][data-section="checks"]')
    checks.focus()
    page.keyboard.press("Enter")
    after_enter = checks.get_attribute("aria-expanded")
    page.keyboard.press("Space")
    after_space = checks.get_attribute("aria-expanded")
    check("keyboard", after_enter == "true" and after_space == "false", enter=after_enter, space=after_space)

    # ── 4. remembered per browser ───────────────────────────────────────────────────────────────────
    page.locator('[data-testid="host-panel"] [data-testid="run-panel-toggle"][data-section="changes"]').click()
    page.reload(wait_until="networkidle")
    d = open_run(page, "r-cn-bug", '[data-testid="chat-final"]')
    check("remembered", d["open"] == ["now"], open=d["open"])
    ctx.close()
    ctx, page = new_page(browser, 1440, 700)
    d = open_run(page, "r-cn-bug", '[data-testid="chat-final"]')
    check("fresh-browser-default", d["open"] == ["now", "changes"], open=d["open"])

    # ── 5. a link lands on its fold ─────────────────────────────────────────────────────────────────
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": "light"}, **SW)
    page.goto(f"{origin}/", wait_until="networkidle")  # arriving from elsewhere (the MCP usage page's link)
    page.goto(f"{origin}/s/run%3Ar-cn-bug#governance", wait_until="networkidle")
    try:
        page.locator('[data-testid="host-panel"] [data-testid="run-panel-item"][data-item="governance"][data-open="true"]').wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        fail("governance-link", page.evaluate(PANEL))
    d = page.evaluate(PANEL)
    check("governance-link", "checks" in d["open"] and not d["sheetOpen"], open=d["open"])
    ctx.close()

    # ── 6. phone: the panel over the page ──────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844)
    for name, rid, wait_for, want_open in STATES:
        d = open_run(page, rid, wait_for)
        page.screenshot(path=str(SHOTS / f"desk-run-panel-{name}-390.png"))
        check(f"phone-{name}", d["panel"] is not None and d["panel"]["w"] == 390 and d["sections"] == SECTIONS
              and d["open"] == want_open and not d["hscroll"], page=d)
        page.get_by_test_id("host-panel-fold").click()
    ctx.close()

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
