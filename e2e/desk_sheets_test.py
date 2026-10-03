#!/usr/bin/env python3
"""
desk_sheets_test.py — S11 (DES-STUDIO-REBUILD-001 §11 S11; DESIGN-simple §4-§5; DESIGN-interaction
rule 9): look underneath, ⌘K for the pointed object, ⌥ peek — at 1440x700 under STUDIO_SKIN=desk.

Against the in-process fixture (wave1 corpus; `sheets`: every unit names a seat, cancels recorded):

  1. DESK SHEET: ⋯ on the Desk opens "The Desk" with Studio itself · This computer · Sign-ins ·
     All helpers · Hold deliveries, one primary (See everything); Esc closes it.
  2. SESSION SHEET: a session's ⋯ opens its sheet; the run's sections (What and where, Governance,
     Steering…) are tabs and render.
  3. STEP SHEET: a chain step opens its sheet on What's happening; What it did reads the unit output.
  4. HELPER SHEET: the helper chip opens its sheet; the Terminal is read-only (typing off) until
     "Let me type into it" is pressed.
  5. ⌘K ON THE POINTED OBJECT: hovering a chain step and pressing ⌘K lists "ACTIONS FOR …" first.
  6. STOP WITH UNDO: Stop it from ⌘K → the undo toast "Stopping …" → Undo → after the window,
     0 cancel posts.
  7. ⌥ PEEK: holding ⌥ over the step shows one fact; letting go hides it.
  8. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-sheets*.png. Env: FEEDBACK_PORT (default 4356).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4356"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)


def cancels() -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/cancel-posts", timeout=10) as r:
        return json.loads(r.read())["posts"]


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
    set_fixture(origin, wave1=True, sheets=True, reset_gate_posts=True)

    def tabs() -> list:
        return page.get_by_test_id("sheet-tab").evaluate_all("els => els.map(e => e.dataset.tab)")

    # ── 1. the Desk's sheet ────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-sheet-open").click()
    page.get_by_test_id("sheet").wait_for(state="visible", timeout=5000)
    desk_tabs = tabs()
    primary = page.get_by_test_id("sheet-primary").inner_text()
    for t in desk_tabs:
        page.locator(f'[data-testid="sheet-tab"][data-tab="{t}"]').click()
        page.wait_for_timeout(150)
    page.locator('[data-testid="sheet-tab"][data-tab="studio"]').click()
    page.wait_for_timeout(400)
    studio = page.get_by_test_id("sheet-body").inner_text()
    page.screenshot(path=str(SHOTS / "desk-sheets-desk.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("desk-sheet", desk_tabs == ["studio", "computer", "signins", "helpers", "hold"] and primary == "See everything"
          and page.get_by_test_id("sheet").count() == 0 and studio.startswith("wicked-crew "),
          tabs=desk_tabs, primary=primary, studio=studio[:120])

    # ── 2. a session's sheet: the run's sections as tabs ───────────────────────────
    page.goto(f"{origin}/s/run:a1", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("session-sheet-open").click()
    page.get_by_test_id("sheet").wait_for(state="visible", timeout=5000)
    s_tabs = tabs()
    page.locator('[data-testid="sheet-tab"][data-tab="governance"]').click()
    page.get_by_test_id("sheet-section").wait_for(state="visible", timeout=5000)
    section = page.get_by_test_id("sheet-section").get_attribute("data-section")
    page.locator('[data-testid="sheet-tab"][data-tab="helpers"]').click()
    helpers = page.get_by_test_id("sheet-helper-open").count()
    page.screenshot(path=str(SHOTS / "desk-sheets-session.png"))
    page.get_by_test_id("sheet-close").click()
    check("session-sheet", all(t in s_tabs for t in ("goal", "helpers", "activity", "signins", "whatwhere", "governance", "steering"))
          and section == "governance" and helpers >= 1, tabs=s_tabs, section=section, helpers=helpers)

    # ── 3. a step's sheet ──────────────────────────────────────────────────────────
    step = page.get_by_test_id("chain-step-open").first
    step.wait_for(state="visible", timeout=8000)
    step_name = step.inner_text()
    step.click()
    page.get_by_test_id("sheet").wait_for(state="visible", timeout=5000)
    title = page.get_by_test_id("sheet-title").inner_text()
    first_tab = page.get_by_test_id("sheet-body").get_attribute("data-tab")
    page.locator('[data-testid="sheet-tab"][data-tab="did"]').click()
    page.wait_for_timeout(600)
    did = page.get_by_test_id("sheet-body").inner_text()
    page.screenshot(path=str(SHOTS / "desk-sheets-step.png"))
    page.keyboard.press("Escape")
    check("step-sheet", title == step_name and first_tab == "happening" and "14 passed" in did, title=title, step_name=step_name, did=did[:80])

    # ── 4. a helper's sheet: the terminal is read-only by default ──────────────────
    page.get_by_test_id("session-run-helper").first.click()
    page.get_by_test_id("sheet-terminal").wait_for(state="visible", timeout=5000)
    typing_before = page.get_by_test_id("sheet-terminal").get_attribute("data-typing")
    inputs_before = page.get_by_test_id("sheet-message-input").count()
    page.get_by_test_id("sheet-terminal-typing").click()
    typing_after = page.get_by_test_id("sheet-terminal").get_attribute("data-typing")
    inputs_after = page.get_by_test_id("sheet-message-input").count()
    page.screenshot(path=str(SHOTS / "desk-sheets-helper.png"))
    page.keyboard.press("Escape")
    check("helper-terminal", typing_before == "off" and inputs_before == 0 and typing_after == "on" and inputs_after == 1,
          before=typing_before, after=typing_after)

    # ── 5. ⌘K on the pointed object ────────────────────────────────────────────────
    page.get_by_test_id("chain-step-open").first.hover()
    page.wait_for_timeout(200)
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
    rows = page.get_by_test_id("palette-row").evaluate_all("els => els.map(e => ({ g: e.dataset.group, t: e.innerText.split('\\n')[0] }))")
    page.screenshot(path=str(SHOTS / "desk-sheets-cmdk.png"))
    lead = rows[0]["g"] if rows else None
    check("cmdk-pointed", lead == "actions" and any(r["t"].startswith("Stop it") for r in rows), lead=lead, rows=rows[:8])

    # ── 6. Stop waits 10 s with Undo ───────────────────────────────────────────────
    page.get_by_test_id("palette-input").fill("stop it")
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=5000)
    headline = page.get_by_test_id("undo-headline").inner_text()
    page.screenshot(path=str(SHOTS / "desk-sheets-stop.png"))
    page.get_by_test_id("undo-button").click()
    page.wait_for_timeout(11_000)
    check("stop-undo", headline.startswith("Stopping") and cancels() == [], headline=headline, cancels=cancels())

    # ── 7. ⌥ peek ──────────────────────────────────────────────────────────────────
    page.get_by_test_id("chain-step-open").first.hover()
    page.wait_for_timeout(200)
    page.keyboard.down("Alt")
    try:
        page.get_by_test_id("alt-peek").wait_for(state="visible", timeout=3000)
        fact = page.get_by_test_id("alt-peek").inner_text()
    except Exception:  # noqa: BLE001
        fact = ""
    page.screenshot(path=str(SHOTS / "desk-sheets-peek.png"))
    page.keyboard.up("Alt")
    page.wait_for_timeout(200)
    gone = page.get_by_test_id("alt-peek").count() == 0
    check("alt-peek", fact != "" and gone, fact=fact, gone=gone)

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors[:5], overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
