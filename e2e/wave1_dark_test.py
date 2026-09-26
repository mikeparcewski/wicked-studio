#!/usr/bin/env python3
"""
wave1_dark_test.py — studio wave 1, behaviour 1: DARK WHEN HEALTHY (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` corpus:
three projects, each with ONE executing run, no gates, no failures.

  healthy   `[data-testid=home-calm]` is visible; the Working band is ONE count
            line (data-count=3, data-expanded=false) with NO project card
            mounted anywhere on the board; ZERO animated live edges are in the
            viewport (a live edge whose computed animation is not `none`).
  exception flip b1 to awaiting_human (`gate_now`): exactly ONE project card is
            expanded (beta, in Needs you) and the Working band still collapses
            the other two to a count.

Capture: e2e/shots/wave1-dark-healthy.png, e2e/shots/wave1-dark-exception.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env: FEEDBACK_PORT (default 4341). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4341"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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


# Every live edge inside the viewport whose computed animation actually runs.
ANIMATED_EDGES = """() => [...document.querySelectorAll('[data-testid="live-edge"]')].filter((el) => {
  const r = el.getBoundingClientRect();
  const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
    && r.top < window.innerHeight && r.left < window.innerWidth;
  return inView && getComputedStyle(el).animationName !== 'none';
}).length"""

# Project cards actually painted inside the viewport.
VISIBLE_CARDS = """() => [...document.querySelectorAll('[data-testid="project-card"]')].filter((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}).map((el) => el.getAttribute('data-project-id'))"""

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

    # ── healthy: 3 executing runs, 0 gates ──────────────────────────────────────
    set_fixture(origin, wave1=True, gate_now=[])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("home-calm").wait_for(state="visible", timeout=15000)
    band = page.get_by_test_id("band-working")
    band.wait_for(state="visible", timeout=10000)
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"band-working\"]')?.getAttribute('data-count') === '3'",
        timeout=10000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "wave1-dark-healthy.png"))

    check("calm-visible", page.get_by_test_id("home-calm").is_visible(),
          calm=page.get_by_test_id("home-calm").inner_text())
    check("working-band-counts-3", band.get_attribute("data-count") == "3",
          count=band.get_attribute("data-count"))
    check("working-band-collapsed", band.get_attribute("data-expanded") == "false",
          expanded=band.get_attribute("data-expanded"))
    cards_in_band = band.locator('[data-testid="project-card"]').count()
    check("working-band-has-no-cards", cards_in_band == 0, cards=cards_in_band)
    line = band.inner_text()
    check("working-band-is-a-count-line", "(3)" in line, line=line)
    visible = page.evaluate(VISIBLE_CARDS)
    check("no-project-card-in-viewport", visible == [], visible=visible)
    animated = page.evaluate(ANIMATED_EDGES)
    check("zero-animated-live-edges", animated == 0, animated=animated)

    # ── one exception: b1 waits on a human ──────────────────────────────────────
    set_fixture(origin, gate_now=["b1"])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("band-needs-you").wait_for(state="visible", timeout=15000)
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"band-working\"]')?.getAttribute('data-count') === '2'",
        timeout=10000)
    page.wait_for_timeout(500)
    visible = page.evaluate(VISIBLE_CARDS)
    all_cards = page.locator('[data-testid="project-card"]').count()
    page.get_by_test_id("band-needs-you").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "wave1-dark-exception.png"))
    check("exactly-one-card-expanded", all_cards == 1, mounted=all_cards, visible=visible)
    needs_cards = page.locator('[data-testid="band-needs-you"] [data-testid="project-card"]')
    check("the-card-is-the-gated-project", needs_cards.count() == 1
          and needs_cards.first.get_attribute("data-project-id") == "beta",
          project=needs_cards.first.get_attribute("data-project-id") if needs_cards.count() else None)
    band = page.get_by_test_id("band-working")
    check("working-band-still-collapsed", band.get_attribute("data-expanded") == "false"
          and band.locator('[data-testid="project-card"]').count() == 0,
          expanded=band.get_attribute("data-expanded"))

    set_fixture(origin, wave1=False, gate_now=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
