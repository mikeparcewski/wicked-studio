#!/usr/bin/env python3
"""
desk_slash_workflows_test.py — S19a (DES-STUDIO-REBUILD-001 §5.5/§5.7): a workflow is named with a
`/workflow-<key>` FIRST token in the Desk composer and Enter launches it, at 1440x700 against the
in-process fixture (`workflow_catalog` serves GET /workflows; `repo` serves GET /repos; `sessions`
records POST /runs):

  1. MENU: `/workflow-` groups "Start work" with the daemon's ordinary defs (workflow-bug,
     workflow-feature) and never the system flow (chat); a mid-text `/workflow-` is a sentence —
     no rows.
  2. NAME: picking a rowNames it — a `/workflow-bug` chip and the options row, no POST.
  3. REFUSE: with no repository the composer says "Pick the repository this works in" and Enter
     sends NOTHING (0 POST /runs recorded).
  4. LAUNCH: with a repository the lone repo is picked, the line reads ready, and Enter makes
     exactly ONE POST /runs carrying workflow=bug, repoRef=studio-api, humanConfirm=before:1,
     deliver=pr and the intent as `problem` — then the page opens the run's session.
  5. × removes the chip; Escape never launches.
  6. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-slash-workflows*.png. Env: FEEDBACK_PORT (default 4382).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4382"))
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


def launch_posts() -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/launch-posts", timeout=10) as r:
        return json.loads(r.read())["posts"]


def wait_posts(n: int, timeout: float = 6.0) -> list:
    end = time.time() + timeout
    posts = launch_posts()
    while len(posts) < n and time.time() < end:
        time.sleep(0.1)
        posts = launch_posts()
    return posts


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

    def open_desk() -> None:
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk-composer-input").wait_for(state="visible", timeout=15000)

    # ── 1 + 2: the menu, and naming the work ──────────────────────────────────────
    set_fixture(origin, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    open_desk()
    box = page.get_by_test_id("desk-composer-input")
    box.click()
    box.type("/workflow-")
    page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
    cmds = page.eval_on_selector_all(
        '[data-testid="composer-menu-item"][data-group="start-work"]',
        "els => els.map(e => e.dataset.cmd)")
    groups = page.eval_on_selector_all('[data-testid="composer-menu-group"]', "els => els.map(e => e.dataset.group)")
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-menu.png"))
    check("menu-lists-workflows",
          "start-work" in groups and "workflow-bug" in cmds and "workflow-feature" in cmds
          and "workflow-chat" not in cmds,
          groups=groups, cmds=cmds)

    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.get_by_test_id("composer-chip").wait_for(state="visible", timeout=8000)
    chip = page.get_by_test_id("composer-chip").inner_text()
    check("pick-names-the-workflow", "/workflow-bug" in chip and launch_posts() == [],
          chip=chip, posts=launch_posts())

    # a mid-text /workflow- is a sentence: no Start work rows
    box.fill("")
    box.type("please /workflow-bug")
    page.wait_for_timeout(300)
    mid = page.eval_on_selector_all(
        '[data-testid="composer-menu-item"][data-group="start-work"]', "els => els.length")
    check("mid-text-is-a-sentence", mid == 0, rows=mid)
    page.keyboard.press("Escape")

    # ── 3: no repository → the composer refuses and sends nothing ─────────────────
    set_fixture(origin, workflow_catalog=True, repo=False, sessions=True, reset_gate_posts=True)
    open_desk()
    box = page.get_by_test_id("desk-composer-input")
    box.click()
    box.type("/workflow-")
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').wait_for(state="visible", timeout=8000)
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.wait_for_timeout(150)
    box.type("the charge never clears")
    page.wait_for_timeout(300)
    line = page.get_by_test_id("composer-launch-line").inner_text()
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-refused.png"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    check("no-repo-refuses", "Pick the repository this works in" in line and launch_posts() == [],
          line=line, posts=launch_posts())

    # ── 4: with a repository, Enter launches exactly once ─────────────────────────
    set_fixture(origin, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    open_desk()
    box = page.get_by_test_id("desk-composer-input")
    box.click()
    box.type("/workflow-")
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').wait_for(state="visible", timeout=8000)
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.wait_for_timeout(150)
    box.type("the charge never clears")
    page.wait_for_function(
        "() => { const e = document.querySelector('[data-testid=\"launch-row-repo\"]'); return e && e.value && e.value !== ''; }",
        timeout=8000)
    ready = page.get_by_test_id("composer-launch-line").inner_text()
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-ready.png"))
    page.keyboard.press("Enter")
    posts = wait_posts(1)
    try:
        page.wait_for_function("() => location.pathname.startsWith('/s/')", timeout=8000)
        went = page.evaluate("() => location.pathname")
    except Exception:
        went = page.evaluate("() => location.pathname")
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-launched.png"))
    body = posts[0] if posts else {}
    check("one-launch",
          len(posts) == 1 and "Ready to send" in ready
          and body.get("workflow") == "bug" and body.get("repoRef") == "studio-api"
          and body.get("humanConfirm") == "before:1" and body.get("deliver") == "pr"
          and body.get("problem") == "the charge never clears",
          ready=ready, count=len(posts), body=body)
    check("opens-the-run", went.startswith("/s/"), path=went)

    # ── 5: × removes the chip; Escape is never a launch ───────────────────────────
    set_fixture(origin, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    open_desk()
    box = page.get_by_test_id("desk-composer-input")
    box.click()
    box.type("/workflow-")
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').wait_for(state="visible", timeout=8000)
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.get_by_test_id("composer-chip").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("composer-chip-remove").click()
    page.wait_for_timeout(200)
    removed = page.locator('[data-testid="composer-chip"]').count() == 0
    check("x-removes-the-chip", removed and launch_posts() == [], removed=removed, posts=launch_posts())

    box.type("/workflow-")
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').wait_for(state="visible", timeout=8000)
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.wait_for_timeout(150)
    box.type("the charge never clears")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    check("escape-sends-nothing", launch_posts() == [], posts=launch_posts())

    # no horizontal scroll on any captured state
    hscroll = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
    check("no-errors", not errors and not hscroll, errors=errors[:5], hscroll=hscroll)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
