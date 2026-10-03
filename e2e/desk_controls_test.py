#!/usr/bin/env python3
"""
desk_controls_test.py — COVERAGE.md finding 2 (wave 5): the delivery freeze and standing orders
have a desk home, at 1440x700 under STUDIO_SKIN=desk (where the runs bar and HomeBoard that held
them are not drawn).

Against the in-process fixture (home_runs: the freeze surface; standing_orders on, no orders):

  1. CALM: with deliveries thawed and you present, the Desk says neither.
  2. FREEZE FROM THE RAIL: "Everything else" holds the controls; Freeze deliveries opens its
     consequence in place, a reason is typed, and the confirm freezes (PUT /deliveries/freeze).
  3. THE DESK SAYS IT: "Deliveries are frozen" with who, since and why, under "For whoever runs
     studio"; Unfreeze on that row (its consequence first) thaws it and the row goes.
  4. AWAY FROM THE RAIL: "Mark me away" in the controls → the Desk says "You are marked away";
     "I'm back" on the row turns it off and the row goes.
  5. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-controls*.png. Env: FEEDBACK_PORT (default 4355).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4355"))
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
    set_fixture(origin, wave1=True, home_runs=True, reset_home_runs=True, standing_orders=True, reset_standing=True)

    # ── 1. calm ────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    check("calm", page.get_by_test_id("desk-state").count() == 0, states=page.get_by_test_id("desk-state").count())

    def open_controls() -> None:
        if page.get_by_test_id("desk-rail-controls").count() == 0:
            page.get_by_test_id("desk-rail-more").click()
        page.get_by_test_id("desk-rail-controls").wait_for(state="visible", timeout=5000)

    # ── 2. freeze from the rail ────────────────────────────────────────────────────
    open_controls()
    rail = page.get_by_test_id("desk-rail-controls")
    rail.get_by_test_id("delivery-freeze-open").click()
    rail.get_by_test_id("delivery-freeze-confirm").wait_for(state="visible", timeout=5000)
    consequence = rail.get_by_test_id("delivery-freeze-consequence").inner_text()
    rail.get_by_test_id("delivery-freeze-reason").fill("incident 42")
    page.screenshot(path=str(SHOTS / "desk-controls-freeze.png"))
    rail.get_by_test_id("delivery-freeze-confirm-btn").click()
    page.wait_for_timeout(600)

    # ── 3. the Desk says it, and unfreezes in place ────────────────────────────────
    row = page.locator('[data-testid="desk-state"][data-state="frozen"]')
    try:
        row.wait_for(state="visible", timeout=8000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-controls-missing.png"))
        fail("frozen-row", "no frozen row on the Desk after freezing")
    line = row.get_by_test_id("desk-state-line").inner_text()
    page.screenshot(path=str(SHOTS / "desk-controls-frozen.png"))
    check("freeze", "freez" in consequence.lower() and "incident 42" in line and "Deliveries frozen" in line,
          consequence=consequence, line=line)
    row.get_by_test_id("delivery-freeze-open").click()
    row.get_by_test_id("delivery-freeze-confirm").wait_for(state="visible", timeout=5000)
    action = row.get_by_test_id("delivery-freeze-confirm").get_attribute("data-action")
    row.get_by_test_id("delivery-freeze-confirm-btn").click()
    try:
        page.wait_for_function("() => !document.querySelector('[data-testid=\"desk-state\"][data-state=\"frozen\"]')", timeout=8000)
        gone = True
    except Exception:  # noqa: BLE001
        gone = False
    check("unfreeze", action == "unfreeze" and gone, action=action, gone=gone)

    # ── 4. away from the rail; I'm back on the Desk ────────────────────────────────
    open_controls()
    page.get_by_test_id("desk-rail-controls").get_by_test_id("standing-orders-away").click()
    away = page.locator('[data-testid="desk-state"][data-state="away"]')
    try:
        away.wait_for(state="visible", timeout=8000)
        said = away.get_by_test_id("desk-state-line").inner_text()
    except Exception:  # noqa: BLE001
        said = ""
    page.screenshot(path=str(SHOTS / "desk-controls-away.png"))
    if said:
        away.get_by_test_id("desk-state-back").click()
    try:
        page.wait_for_function("() => !document.querySelector('[data-testid=\"desk-state\"][data-state=\"away\"]')", timeout=8000)
        back = True
    except Exception:  # noqa: BLE001
        back = False
    check("away", said != "" and back, said=said, back=back)

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors[:5], overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
