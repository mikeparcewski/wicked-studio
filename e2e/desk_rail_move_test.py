#!/usr/bin/env python3
"""
desk_rail_move_test.py — crew-0182 (studio 0.16.2): the rail's "Move to project" picker stays open.

On the desktop rail the trigger floated over the row with `transform: translateY(-50%)`. A transformed ancestor is the
containing block of a `position: fixed` box, so the picker's viewport placement (studio#723) landed inside the rail's
scroller; focusing its first item scrolled the scroller, and the picker's own scroll listener closed it ~14 ms after
the click (the operator: "clicking does nothing").

At 1440x700 (the rail) and 390x844 (the drawer), against the in-process fixture:
  1. expand Recent, hover a run row, click its Move to project icon;
  2. 300 ms later the picker is still open (aria-expanded=true), sits inside the viewport, and the element at its
     centre is inside the picker (nothing covers it);
  3. 0 page errors.

Captures: e2e/shots/desk-rail-move-<w>x<h>-<theme>.png (light and dark). Env: FEEDBACK_PORT (default 4497).
JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4497"))
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

IN_PICKER = """([x, y]) => { const el = document.elementFromPoint(x, y);
  return !!el && !!el.closest('[data-testid="session-move-picker"]'); }"""


def open_picker(page, w: int, h: int) -> None:
    page.goto(f"{origin}/", wait_until="networkidle")
    if w < 768:
        page.get_by_test_id("rail-drawer-toggle").click()
    rail = page.get_by_test_id("session-rail")
    rail.wait_for(state="visible", timeout=15000)
    rows = rail.locator(".wk-rail-session-row")
    if rows.count() == 0:
        rail.get_by_role("button", name="Recent").first.click()
    try:
        rows.first.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        fail(f"rows-{w}", f"no run row in the rail: {e}")
    row = rows.first
    row.hover()
    trigger = row.get_by_test_id("session-move")
    trigger.click()
    page.wait_for_timeout(300)
    picker = page.get_by_test_id("session-move-picker")
    expanded = trigger.get_attribute("aria-expanded")
    check(f"open-after-300ms-{w}", picker.count() == 1 and expanded == "true", expanded=expanded, pickers=picker.count())
    box = picker.bounding_box()
    inside = box is not None and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w and box["y"] + box["height"] <= h
    check(f"in-viewport-{w}", inside, box=box)
    hit = page.evaluate(IN_PICKER, [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
    check(f"centre-hits-picker-{w}", hit)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h) in ((1440, 700), (390, 844)):
        for theme in ("light", "dark"):
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(
                "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
                f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
            set_fixture(origin, repo=True, sessions=True)
            open_picker(page, w, h)
            page.evaluate(f"document.documentElement.setAttribute('data-theme', 'wicked-{theme}')")
            page.screenshot(path=str(SHOTS / f"desk-rail-move-{w}x{h}-{theme}.png"))
            page.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
