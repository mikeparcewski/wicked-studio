#!/usr/bin/env python3
"""
wave1_stall_test.py — studio wave 1 round 2: A STALLED RUN IS AN EXCEPTION (1440x700).

Dark when healthy must never hide a wedged run. Against the `wave1` corpus with
`wave1_stall`: r1 (gamma) is still `executing`, but its durable event tail ended
2 HOURS ago. The board must treat that silence as an exception:

  - gamma's card sits in NEEDS YOU, expanded (a mounted project card);
  - `[data-testid=home-calm]` is ABSENT (the needs-you queue has a row for r1);
  - WORKING still collapses the two healthy projects to a count (2).

Capture: e2e/shots/wave1-stall.png. Env: FEEDBACK_PORT (default 4345).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4345"))
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

    set_fixture(origin, wave1=True, wave1_stall=True, gate_now=[], status_over={})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("project-board").wait_for(state="visible", timeout=15000)
    try:
        page.wait_for_function(
            "() => !!document.querySelector('[data-testid=\"band-needs-you\"] [data-testid=\"project-card\"][data-project-id=\"gamma\"]')",
            timeout=15000)
        in_needs = True
    except Exception:  # noqa: BLE001 — reported below
        in_needs = False
    page.wait_for_timeout(400)
    page.get_by_test_id("home-kpis").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "wave1-stall.png"))
    check("stalled-run-in-needs-you-expanded", in_needs,
          needs=page.evaluate("() => [...document.querySelectorAll('[data-testid=\"band-needs-you\"] [data-testid=\"project-card\"]')].map(c => c.dataset.projectId)"))
    check("home-calm-absent", page.get_by_test_id("home-calm").count() == 0)
    rows = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"need-row\"]')].map(r => r.dataset.kind + ':' + r.dataset.key)")
    check("queue-has-the-stalled-run", any("r1" in r for r in rows), rows=rows)
    band = page.get_by_test_id("band-working")
    check("healthy-work-still-collapsed", band.get_attribute("data-count") == "2"
          and band.get_attribute("data-expanded") == "false",
          count=band.get_attribute("data-count"), expanded=band.get_attribute("data-expanded"))

    set_fixture(origin, wave1=False, wave1_stall=False, gate_now=[], status_over={})
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
