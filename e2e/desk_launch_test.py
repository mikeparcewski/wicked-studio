#!/usr/bin/env python3
"""
desk_launch_test.py — the launch form says what the launch will be, on the Desk at 1440x700
against the in-process fixture (team_plan + repo):

  1. #431 A SLOW PREVIEW SAYS SO: with POST /plans/preview held 12 s, the preview says the engine
     didn't answer and that the summary below is studio's own reading — then the late answer lands;
     Send pressed while it has timed out waits for the answer and launches (never refused as failed).
  2. #429 A REPO LAUNCH WITH NO STEPS SAYS WHAT IT RUNS AS: with a repository picked and no phase,
     the note says it runs as one step with no PA scope, review or delivery; picking a phase takes it
     away (the launch becomes build work, with the pre-send line naming the plan).
  3. 0 page errors.

Captures: e2e/shots/desk-launch-*.png. Env: FEEDBACK_PORT (default 4360).
"""

import json
import os
import sys

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4360"))
W, H = 1440, 700
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

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))

    def open_form(problem: str) -> None:
        page.goto(f"{origin}/runs/new", wait_until="networkidle")
        page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("launch-problem").fill(problem)
        picker = page.locator('[data-testid="launch-repo-picker"]').first
        repo_id = page.evaluate("""() => [...document.querySelectorAll('[data-testid="launch-repo-picker"] option')]
          .map(o => o.value).find(v => v && v !== '__several__') || ''""")
        if repo_id == "":
            fail("repo-to-pick", "the launch form offers no repository")
        picker.select_option(repo_id)
        page.wait_for_timeout(400)

    # ── 2. #429 first (no preview is asked without a plan) ───────────────────────
    set_fixture(origin, team_plan=True, repo=True, preview_delay_ms=0)
    open_form("add SSO login to the admin console")
    note = page.get_by_test_id("launch-plan-note")
    page.screenshot(path=str(SHOTS / "desk-launch-unplanned.png"))
    check("unplanned-launch-says-so", note.count() == 1 and "one step on the repository" in note.inner_text()
          and "no PA scope, no review, no delivery" in note.inner_text(),
          note=note.inner_text() if note.count() else None)
    page.get_by_test_id("phase-picker-toggle").click()
    page.locator('[data-testid="phase-option"][data-catalog="build"]').click()
    page.wait_for_timeout(500)
    line2 = page.get_by_test_id("launch-confirm").inner_text()
    check("a-phase-takes-the-note-away", page.get_by_test_id("launch-plan-note").count() == 0
          and "plan: build" in line2, line=line2)

    # ── 1. #431: the preview held past the timeout ───────────────────────────────
    set_fixture(origin, preview_delay_ms=12000)
    open_form("add SSO login to the admin console, slowly")
    page.get_by_test_id("phase-picker-toggle").click()
    page.locator('[data-testid="phase-option"][data-catalog="review"]').click()
    try:
        page.get_by_test_id("launch-preview-error").wait_for(state="visible", timeout=14000)
        said = page.get_by_test_id("launch-preview-error").inner_text()
    except Exception:
        said = None
        page.screenshot(path=str(SHOTS / "desk-launch-preview-stuck.png"))
    check("slow-preview-says-so", said is not None and "didn’t answer in 10 s" in said and "studio’s own reading" in said,
          said=said, state=page.get_by_test_id("launch-preview").get_attribute("data-state"))
    try:
        page.wait_for_function("""() => { const e = document.querySelector('[data-testid="launch-preview"]');
          return e && e.dataset.state !== 'error' && e.dataset.state !== 'loading'; }""", timeout=8000)
        landed = page.get_by_test_id("launch-preview").get_attribute("data-state")
    except Exception:
        landed = None
    page.screenshot(path=str(SHOTS / "desk-launch-preview-late.png"))
    check("late-answer-lands", landed not in (None, "error", "loading"), state=landed)

    # codex on #431: Send while the preview has timed out — the launch waits for the engine's answer
    # (the gate placement needs it) and goes; it is never refused because the engine was slow.
    set_fixture(origin, preview_delay_ms=12000)
    open_form("add SSO login to the admin console, sent while slow")
    page.get_by_test_id("phase-picker-toggle").click()
    page.locator('[data-testid="phase-option"][data-catalog="test"]').click()
    page.get_by_test_id("launch-preview-error").wait_for(state="visible", timeout=14000)
    page.get_by_test_id("launch-submit").click()
    try:
        page.wait_for_function("() => !location.pathname.startsWith('/runs/new')", timeout=12000)
        went = True
    except Exception:
        went = False
    refused = page.get_by_test_id("launch-error").count()
    page.screenshot(path=str(SHOTS / "desk-launch-sent-while-slow.png"))
    check("send-while-slow-goes", went and refused == 0, path=page.evaluate("() => location.pathname"), refused=refused)
    set_fixture(origin, preview_delay_ms=0, team_plan=False, repo=False)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
