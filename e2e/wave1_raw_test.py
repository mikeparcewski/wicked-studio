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

from uxfix_fixture import (HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, WAVE1_R1_EVENTS, ensure_build, set_fixture,
                           start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4342"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SCROLL_TO = 240

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}
# Under STUDIO_SKIN=desk (S15a: the desk variant, in run_journeys.py DESK) Home is the Desk: "where you
# were" is the Desk's own scroller (data-place-scroll="desk") — the Desk has no Working band to expand —
# and every palette, route and Back assertion is the same.
DESK = STUDIO_SKIN == "desk"
HOME = "desk" if DESK else "project-board"
SCROLLER = '[data-place-scroll="desk"]' if DESK else '[data-place-scroll="home-board"]'


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
    page.get_by_test_id(HOME).wait_for(state="visible", timeout=10000)
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
    if DESK:
        page.wait_for_selector('[data-testid="desk-headline"][data-count="0"]', timeout=15000)
        # The calm Desk is short at 1440x700: room below its content (a style in <head>, so it outlives the
        # Desk's remount on Back) makes "where you were" a real scroll position.
        page.evaluate("() => { const s = document.createElement('style');"
                      " s.textContent = '[data-place-scroll=\"desk\"]::after { content: \"\"; display: block; height: 1200px; }';"
                      " document.head.appendChild(s); }")
    else:
        page.get_by_test_id("home-calm").wait_for(state="visible", timeout=15000)

        # ── where you were: the Working band expanded, the board scrolled ──────────
        page.get_by_test_id("band-working").wait_for(state="visible", timeout=10000)
        if page.get_by_test_id("band-working").get_attribute("data-expanded") == "false":
            page.get_by_test_id("band-working-toggle").click()
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid=\"band-working\"] [data-testid=\"project-card\"]').length === 3",
            timeout=10000)
    page.evaluate(f"(sel) => {{ document.querySelector(sel).scrollTop = {SCROLL_TO}; }}", SCROLLER)
    page.wait_for_timeout(300)
    before = page.evaluate("(sel) => document.querySelector(sel).scrollTop", SCROLLER)
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
    if not DESK:
        band = page.get_by_test_id("band-working")
        check("back-band-still-expanded", band.get_attribute("data-expanded") == "true",
              expanded=band.get_attribute("data-expanded"))
    try:
        page.wait_for_function(
            f"(sel) => Math.abs(document.querySelector(sel).scrollTop - {before}) <= 2", arg=SCROLLER,
            timeout=5000)
        restored = True
    except Exception:  # noqa: BLE001 — reported below
        restored = False
    after = page.evaluate("(sel) => document.querySelector(sel).scrollTop", SCROLLER)
    page.screenshot(path=str(SHOTS / "wave1-raw-back.png"))
    check("back-scroll-restored", restored, before=before, after=after)

    # ── >files r1 → the worktree diff viewer, as a route ────────────────────────
    palette_run(page, ">files r1")
    page.wait_for_function("() => window.location.pathname === '/runs/r1/files'", timeout=10000)
    page.get_by_test_id("file-viewer").wait_for(state="visible", timeout=10000)
    page.wait_for_function(
        "() => (document.querySelector('[data-testid=\"file-viewer\"]')?.textContent ?? '').includes('maxBytes')",
        timeout=10000)
    check("files-route-shows-r1-diff", True)
    back_home(page, "files")

    # ── round 2: Escape with the palette open over /runs/r1/files closes ONLY the palette ──
    palette_run(page, ">files r1")
    page.wait_for_function("() => window.location.pathname === '/runs/r1/files'", timeout=10000)
    page.get_by_test_id("file-viewer").wait_for(state="visible", timeout=10000)
    page.keyboard.press("Control+k")
    page.get_by_test_id("command-palette").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Escape")
    page.get_by_test_id("command-palette").wait_for(state="detached", timeout=5000)
    page.wait_for_timeout(400)
    check("escape-closes-palette-not-files",
          page.evaluate("() => window.location.pathname") == "/runs/r1/files"
          and page.get_by_test_id("file-viewer").count() == 1,
          path=page.evaluate("() => window.location.pathname"))
    back_home(page, "files-escape")

    # ── >config → /system ────────────────────────────────────────────────────────
    palette_run(page, ">config")
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=10000)
    check("config-route", True)
    back_home(page, "config")

    # ── round 2: the raw view opened as the FIRST entry — its Back stays in studio ──
    first = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    first.goto(f"{origin}/runs/r1/events", wait_until="networkidle")
    first.get_by_test_id("raw-events").wait_for(state="visible", timeout=10000)
    first.get_by_test_id("run-raw-back").click()
    try:
        first.wait_for_function("() => window.location.origin + window.location.pathname === "
                                f"{json.dumps(origin + '/')}", timeout=10000)
        landed = True
    except Exception:  # noqa: BLE001 — reported below
        landed = False
    check("first-entry-back-lands-home", landed, url=first.url)
    first.close()

    set_fixture(origin, wave1=False, gate_now=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
