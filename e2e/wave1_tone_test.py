#!/usr/bin/env python3
"""
wave1_tone_test.py — studio wave 1 round 2: ZERO IS QUIET (1440x700).

Home is dark when healthy only if its counters are: a zero count renders in the
neutral tone, and a status colour belongs to a NON-ZERO exception. Every count
tile on home carries `data-tone` (neutral | gate | fail), decided by the count-tone
model, never by the skin.

  healthy   the `wave1` corpus (3 executing, 1 completed): no tile is in a
            `fail` or `gate` tone.
  one fail  c1 flips to `failed` (`status_over`): exactly ONE tile is in the
            `fail` tone, and it is the Failed tile.

Capture: e2e/shots/wave1-tone-healthy.png, e2e/shots/wave1-tone-failed.png.
Env: FEEDBACK_PORT (default 4346).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4346"))
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


TONES = """() => [...document.querySelectorAll('[data-tone]')].map((el) => ({
  id: el.getAttribute('data-testid'), tone: el.getAttribute('data-tone'), text: el.textContent.trim().slice(0, 40)}))"""

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

    set_fixture(origin, wave1=True, wave1_stall=False, gate_now=[], status_over={})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("home-calm").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "wave1-tone-healthy.png"))
    tones = page.evaluate(TONES)
    check("count-tiles-carry-a-tone", len(tones) >= 6, tones=tones)
    loud = [t for t in tones if t["tone"] in ("fail", "gate")]
    check("healthy-has-no-status-tone", loud == [], loud=loud)

    set_fixture(origin, status_over={"c1": "failed"})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"home-kpi-failed\"] [data-tone]')?.getAttribute('data-tone') === 'fail'"
        " || document.querySelector('[data-testid=\"home-kpi-failed\"]')?.getAttribute('data-tone') === 'fail'",
        timeout=15000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "wave1-tone-failed.png"))
    tones = page.evaluate(TONES)
    fail = [t for t in tones if t["tone"] == "fail"]
    check("exactly-one-fail-tone", len(fail) == 1 and fail[0]["id"] == "home-kpi-failed", fail=fail)

    set_fixture(origin, wave1=False, gate_now=[], status_over={})
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
