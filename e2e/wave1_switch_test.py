#!/usr/bin/env python3
"""
wave1_switch_test.py — studio wave 1, behaviour 4: THE PROJECT-SWITCH BUG (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` corpus.

The project shell remembers the artifact each mode last showed (so Build → Chat →
Build lands back on the same run). That memory belonged to the PREVIOUS project
after a switch: in project alpha open Build run a1, pivot to beta through the
crumb switcher, click beta's Build tab — the shell navigated to
/p/beta/build/a1, alpha's run inside beta. It must stay on beta's own Build.

Capture: e2e/shots/wave1-switch-build.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env: FEEDBACK_PORT (default 4344). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4344"))
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

    set_fixture(origin, wave1=True, gate_now=[])

    # ── project alpha, Build, run a1 ────────────────────────────────────────────
    page.goto(f"{origin}/p/alpha/build/a1", wait_until="networkidle")
    page.locator('[data-testid="project-shell"][data-project-id="alpha"]').wait_for(state="visible", timeout=15000)
    page.get_by_test_id("run-header").wait_for(state="visible", timeout=15000)
    check("alpha-build-a1", page.evaluate("() => window.location.pathname") == "/p/alpha/build/a1")

    # ── pivot to beta through the crumb switcher ────────────────────────────────
    page.get_by_test_id("project-name").click()
    page.locator('[data-testid="project-switcher-option"][data-project-id="beta"]').click()
    page.wait_for_function("() => window.location.pathname === '/p/beta/build'", timeout=10000)
    page.locator('[data-testid="project-shell"][data-project-id="beta"]').wait_for(state="visible", timeout=10000)
    check("switched-to-beta", True)

    # ── beta's Build tab must not route to alpha's run ──────────────────────────
    page.get_by_test_id("mode-tab-build").click()
    page.wait_for_timeout(600)
    path = page.evaluate("() => window.location.pathname")
    page.screenshot(path=str(SHOTS / "wave1-switch-build.png"))
    check("build-tab-stays-in-beta", path.startswith("/p/beta/build") and "a1" not in path, path=path)

    # ── and the per-mode memory still works WITHIN a project ────────────────────
    page.goto(f"{origin}/p/beta/build/b1", wait_until="networkidle")
    page.get_by_test_id("run-header").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("mode-tab-chat").click()
    page.wait_for_function("() => window.location.pathname.startsWith('/p/beta/chat')", timeout=10000)
    page.get_by_test_id("mode-tab-build").click()
    page.wait_for_function("() => window.location.pathname === '/p/beta/build/b1'", timeout=10000)
    check("memory-within-project-kept", True)

    set_fixture(origin, wave1=False, gate_now=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
