#!/usr/bin/env python3
"""
wave1_raw_test.py — studio wave 1, behaviour 2: RAW IN ONE STEP (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` corpus.

  events   on `/`, expand the Working band and scroll the board; open the palette
           (Ctrl+K), type `>events r1`, Enter: the address is /runs/r1/events and
           the raw JSON event list for r1 shows — exactly the fixture's recorded
           tail (GET /runs/r1/events). Browser Back returns to `/` with the palette
           closed, the band still expanded and the board's scroll restored.
  files    `>files r1` opens /runs/r1/files (the existing diff viewer); Back → `/`.
  config   `>config` opens /system (settings); Back → `/`.

Capture: e2e/shots/wave1-raw-events.png, e2e/shots/wave1-raw-back.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env: FEEDBACK_PORT (default 4342). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (HIDE_GATE_TOASTS, REPO, WAVE1_R1_EVENTS, ensure_build, set_fixture,
                           start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4342"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SCROLL_TO = 240

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def palette_run(page, text: str) -> None:
    page.keyboard.press("Control+k")
    page.get_by_test_id("command-palette").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("palette-input").fill(text)
    page.wait_for_timeout(150)
    page.keyboard.press("Enter")


def back_home(page, step: str) -> None:
    page.go_back()
    page.wait_for_function("() => window.location.pathname === '/'", timeout=10000)
    page.get_by_test_id("project-board").wait_for(state="visible", timeout=10000)
    check(f"{step}-back-palette-closed", page.get_by_test_id("command-palette").count() == 0)


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, wave1=True, gate_now=[])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("home-calm").wait_for(state="visible", timeout=15000)

    # ── where you were: the Working band expanded, the board scrolled ──────────
    page.get_by_test_id("band-working").wait_for(state="visible", timeout=10000)
    if page.get_by_test_id("band-working").get_attribute("data-expanded") == "false":
        page.get_by_test_id("band-working-toggle").click()
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"band-working\"] [data-testid=\"project-card\"]').length === 3",
        timeout=10000)
    page.evaluate(f"() => {{ document.querySelector('[data-testid=\"project-board\"]').scrollTop = {SCROLL_TO}; }}")
    page.wait_for_timeout(300)
    before = page.evaluate("() => document.querySelector('[data-testid=\"project-board\"]').scrollTop")
    check("board-scrolled", before >= SCROLL_TO - 2, scroll_top=before)

    # ── >events r1 → the raw JSON event list ────────────────────────────────────
    palette_run(page, ">events r1")
    page.wait_for_function("() => window.location.pathname === '/runs/r1/events'", timeout=10000)
    raw = page.get_by_test_id("raw-events")
    raw.wait_for(state="visible", timeout=10000)
    page.wait_for_function(
        "() => { try { return JSON.parse(document.querySelector('[data-testid=\"raw-events\"]').textContent).length > 0; }"
        " catch { return false; } }", timeout=10000)
    page.screenshot(path=str(SHOTS / "wave1-raw-events.png"))
    check("palette-closed-on-events", page.get_by_test_id("command-palette").count() == 0)
    shown = json.loads(raw.text_content())
    check("raw-json-is-r1-tail", shown == WAVE1_R1_EVENTS, shown=shown[:3])

    # ── Back → `/`, palette closed, scroll restored ─────────────────────────────
    back_home(page, "events")
    band = page.get_by_test_id("band-working")
    check("back-band-still-expanded", band.get_attribute("data-expanded") == "true",
          expanded=band.get_attribute("data-expanded"))
    try:
        page.wait_for_function(
            f"() => Math.abs(document.querySelector('[data-testid=\"project-board\"]').scrollTop - {before}) <= 2",
            timeout=5000)
        restored = True
    except Exception:  # noqa: BLE001 — reported below
        restored = False
    after = page.evaluate("() => document.querySelector('[data-testid=\"project-board\"]').scrollTop")
    page.screenshot(path=str(SHOTS / "wave1-raw-back.png"))
    check("back-scroll-restored", restored, before=before, after=after)

    # ── >files r1 → the worktree diff viewer, as a route ────────────────────────
    palette_run(page, ">files r1")
    page.wait_for_function("() => window.location.pathname === '/runs/r1/files'", timeout=10000)
    page.get_by_test_id("file-viewer").wait_for(state="visible", timeout=10000)
    check("files-route-shows-viewer", True)
    back_home(page, "files")

    # ── >config → /system ────────────────────────────────────────────────────────
    palette_run(page, ">config")
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=10000)
    check("config-route", True)
    back_home(page, "config")

    set_fixture(origin, wave1=False, gate_now=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
