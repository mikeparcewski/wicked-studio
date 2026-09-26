#!/usr/bin/env python3
"""
wave2b_switch_test.py — studio wave 2b, behaviour 7: SWITCHING PROJECTS WITH A BRIEF (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` + `wave2b` corpora.

In alpha open Build run a1; pivot to beta through the crumb switcher. While the operator is
in beta, alpha moves on: a1 completes and g1 stops at a gate (both over /ws). Pivot back to
alpha: the shell restores alpha's LAST ROUTE (/p/alpha/build/a1, not the bare mode) and shows
the "since you were last here" brief — "since HH:MM: 1 run finished, 1 gate".

Capture: e2e/shots/wave2b-switch-brief.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4347). Prints a JSON report; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4347"))
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


def switch_to(page, pid: str) -> None:
    page.get_by_test_id("project-name").click()
    page.locator(f'[data-testid="project-switcher-option"][data-project-id="{pid}"]').click()
    page.locator(f'[data-testid="project-shell"][data-project-id="{pid}"]').wait_for(state="visible", timeout=10000)


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

    set_fixture(origin, wave1=True, wave2b=True, simple_gates=[], gate_now=[],
                status_over={}, extra_frames=[])

    # ── alpha, Build, run a1 ────────────────────────────────────────────────────
    page.goto(f"{origin}/p/alpha/build/a1", wait_until="networkidle")
    page.get_by_test_id("run-header").wait_for(state="visible", timeout=15000)
    check("alpha-build-a1", page.evaluate("() => window.location.pathname") == "/p/alpha/build/a1")
    check("no-brief-on-first-visit", page.locator('[data-testid="project-brief"]').count() == 0)

    # ── pivot to beta (never visited: its bare mode, no brief) ──────────────────
    switch_to(page, "beta")
    page.wait_for_function("() => window.location.pathname === '/p/beta/build'", timeout=10000)
    check("beta-first-visit-bare-mode", True)
    check("no-brief-in-beta", page.locator('[data-testid="project-brief"]').count() == 0)

    # ── alpha moves on while the operator is away ───────────────────────────────
    set_fixture(origin, status_over={"a1": "completed"}, simple_gates=["g1"],
                extra_frames=[{"type": "sessionCompleted", "session": "a1"},
                              {"type": "awaitingHuman", "session": "g1", "ord": 0,
                               "prompt": "Approve the schema change?"}])
    page.wait_for_timeout(2500)

    # ── back to alpha: its last route, and the brief ────────────────────────────
    switch_to(page, "alpha")
    try:
        page.wait_for_function("() => window.location.pathname === '/p/alpha/build/a1'", timeout=5000)
    except Exception:
        fail("restores-last-route", page.evaluate("() => window.location.pathname"))
    check("restores-last-route", True)
    try:
        page.get_by_test_id("project-brief").wait_for(state="visible", timeout=5000)
    except Exception:
        page.screenshot(path=str(SHOTS / "wave2b-switch-no-brief.png"))
        fail("brief-shows", "no project brief after returning to alpha")
    text = page.get_by_test_id("project-brief").inner_text()
    check("brief-text", re.search(r"since \d{2}:\d{2}: 1 run finished, 1 gate", text) is not None, text=text)
    page.screenshot(path=str(SHOTS / "wave2b-switch-brief.png"))

    # The brief is dismissable.
    page.get_by_test_id("project-brief-dismiss").click()
    check("brief-dismissed", page.locator('[data-testid="project-brief"]').count() == 0)

    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], status_over={}, extra_frames=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
