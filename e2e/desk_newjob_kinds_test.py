#!/usr/bin/env python3
"""
desk_newjob_kinds_test.py — studio#767: each kind of job in New job starts with its own words, at
1440x700 against the in-process fixture (nothing is launched).

  1. Desk › New job › Demo video: the operator types "What it should show", then closes the wizard.
  2. New job again (the draft resumes on Demo video, its words kept), Change job › Draft epics:
     "Instructions for the draft" is EMPTY — the demo's sentence is not carried over.
  3. The operator types instructions, then Change job › Demo video: its own words come back.
  4. Change job › Draft epics again: the instructions typed for it come back.

Captures (e2e/shots/): desk-newjob-kinds-draft-{light,dark}.png. Env: FEEDBACK_PORT (default 4612).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4612"))
SHOTS = REPO / "e2e" / "shots"
DEMO_WORDS = "Split a bill three ways with a tip"
DRAFT_WORDS = "Group them by checkout step"
report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list = []
posts: list = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page.set_default_timeout(10000)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: posts.append(f"{r.method} {r.url}") if r.method == "POST" and ("/launch" in r.url or "/demo" in r.url or "/compose" in r.url) else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def change_to(job: str) -> None:
        page.get_by_test_id("launch-wizard-change").click()
        page.get_by_test_id(f"launch-wizard-workflow-{job}").click()

    def val(testid: str) -> str:
        return page.get_by_test_id(testid).input_value()

    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-cards").wait_for(state="visible")
    page.get_by_test_id("launch-wizard-workflow-demo-video").click()
    page.get_by_test_id("launch-wizard-demo-show").fill(DEMO_WORDS)
    page.get_by_test_id("launch-wizard-close").click()
    page.get_by_test_id("launch-wizard").wait_for(state="hidden")

    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-demo-show").wait_for(state="visible")
    check("reopen-keeps-the-demo-words", val("launch-wizard-demo-show") == DEMO_WORDS, value=val("launch-wizard-demo-show"))

    change_to("draft-epics")
    page.get_by_test_id("launch-wizard-draft-instructions").wait_for(state="visible")
    check("draft-epics-starts-empty", val("launch-wizard-draft-instructions") == "", value=val("launch-wizard-draft-instructions"))
    page.get_by_test_id("launch-wizard-draft-instructions").fill(DRAFT_WORDS)
    for theme in ("wicked-light", "wicked-dark"):
        page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / f"desk-newjob-kinds-draft-{theme.split('-')[1]}.png"))
    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'wicked-light')")

    change_to("demo-video")
    page.get_by_test_id("launch-wizard-demo-show").wait_for(state="visible")
    check("demo-words-come-back", val("launch-wizard-demo-show") == DEMO_WORDS, value=val("launch-wizard-demo-show"))
    change_to("draft-epics")
    page.get_by_test_id("launch-wizard-draft-instructions").wait_for(state="visible")
    check("draft-words-come-back", val("launch-wizard-draft-instructions") == DRAFT_WORDS, value=val("launch-wizard-draft-instructions"))
    browser.close()

check("nothing-launched", posts == [], posts=posts)
check("no-page-errors", errors == [], errors=errors[:3])
report["ok"] = True
print(json.dumps(report, indent=2))
