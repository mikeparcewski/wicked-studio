#!/usr/bin/env python3
"""
desk_slash_workflows_test.py — S19a (DES-STUDIO-REBUILD-001 §5.5/§5.7): a workflow is named with a
`/workflow-<key>` FIRST token in the Desk composer and Enter launches it, at 1440x700 against the
in-process fixture (`workflow_catalog` serves GET /workflows; `repo` serves GET /repos; `sessions`
records POST /runs):

  1. MENU: `/wo` groups "Start work" with the daemon's five ordinary defs (feature, bug, migration,
     domain-extraction, capture-learnings), each line read off the catalog ("2 phases: plan → build"),
     and never the system flow (chat); a mid-text `/workflow-` is a sentence — no rows.
  2. NAME: picking a row names it — a `/workflow-bug` chip and the options row, no POST.
  3. REFUSE: with no repository the composer says "Pick the repository this works in" and Enter
     sends NOTHING (0 POST /runs recorded).
  4. LAUNCH: with a repository the lone repo is picked, the line reads ready, and Enter makes
     exactly ONE POST /runs carrying workflow=bug, repoRef=studio-api, humanConfirm=before:1,
     deliver=pr and the intent as `problem` — then the page opens the run's session.
  5. × removes the chip; Escape never launches.
  S19b (the removals, the launch form's grammar, discoverability):
  6. ⌘K `>New Build` — from a page with no composer (/runs/new) and from the Desk — lands on the
     Desk with `/workflow-` in its composer, focused, the menu open on "Start work"; nothing is sent.
  7. no "Detected:" anywhere on the Desk or the launch form, for a code-shaped sentence (the banner
     is gone), and the launch options drawer has no "Choose workflow".
  8. on /runs/new, `/` at the start of launch-problem opens the same menu; a pick sets the form's
     pill to /workflow-<key> and drops the token; nothing is sent.
  9. 0 page errors, no horizontal scroll.

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
    box.type("/wo")
    page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
    cmds = page.eval_on_selector_all(
        '[data-testid="composer-menu-item"][data-group="start-work"]',
        "els => els.map(e => e.dataset.cmd)")
    feature_line = page.eval_on_selector_all(
        '[data-testid="composer-menu-item"][data-cmd="workflow-feature"]', "els => els.map(e => e.innerText)")
    groups = page.eval_on_selector_all('[data-testid="composer-menu-group"]', "els => els.map(e => e.dataset.group)")
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-menu.png"))
    ordinary = ["workflow-feature", "workflow-bug", "workflow-migration", "workflow-domain-extraction",
                "workflow-capture-learnings"]
    check("menu-lists-workflows",
          "start-work" in groups and all(c in cmds for c in ordinary) and "workflow-chat" not in cmds
          and len(feature_line) == 1 and "2 phases: plan → build" in feature_line[0],
          groups=groups, cmds=cmds, feature_line=feature_line)

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

    # ── 6: ⌘K "New Build" seeds /workflow- in the Desk composer with the menu open ────
    def new_build() -> None:
        page.keyboard.press("ControlOrMeta+k")
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
        page.get_by_test_id("palette-input").fill("> New Build")
        page.locator('[data-testid="palette-row"]', has_text="New Build").first.click()

    def seeded_state() -> dict:
        page.wait_for_function(
            "() => document.querySelector('[data-testid=\"desk-composer-input\"]')?.value === '/workflow-'",
            timeout=8000)
        page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
        return page.evaluate("""() => ({
            path: location.pathname,
            value: document.querySelector('[data-testid="desk-composer-input"]')?.value ?? null,
            focused: document.activeElement?.dataset?.testid ?? null,
            rows: [...document.querySelectorAll('[data-testid="composer-menu-item"][data-group="start-work"]')].length,
            hint: document.querySelectorAll('[data-testid="composer-hint"]').length })""")

    set_fixture(origin, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    page.goto(f"{origin}/runs/new", wait_until="networkidle")
    page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    new_build()
    from_form = seeded_state()
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-new-build.png"))
    page.keyboard.press("Escape")
    page.get_by_test_id("desk-composer-input").fill("")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    new_build()
    from_desk = seeded_state()
    page.keyboard.press("Escape")
    page.get_by_test_id("desk-composer-input").fill("")
    check("new-build-seeds-the-composer",
          all(st["path"] == "/" and st["value"] == "/workflow-" and st["focused"] == "desk-composer-input"
              and st["rows"] >= 5 and st["hint"] == 0 for st in (from_form, from_desk))
          and launch_posts() == [],
          from_form=from_form, from_desk=from_desk, posts=launch_posts())

    # ── 7: no "Detected:" anywhere — the Desk, and the launch form ─────────────────
    sentence = "fix the crash in checkout"
    box = page.get_by_test_id("desk-composer-input")
    box.click()
    box.type(sentence)
    page.wait_for_timeout(400)
    desk_detected = page.evaluate("() => document.body.innerText.includes('Detected')")
    box.fill("")
    page.goto(f"{origin}/runs/new", wait_until="networkidle")
    problem = page.get_by_test_id("launch-problem")
    problem.wait_for(state="visible", timeout=15000)
    problem.click()
    problem.type(sentence)
    page.wait_for_timeout(400)
    form_detected = page.evaluate("() => document.body.innerText.includes('Detected')")
    page.get_by_role("button", name="Open launch options").click()
    page.wait_for_timeout(200)
    drawer = page.evaluate("""() => ({ select: document.querySelectorAll('[data-testid="launch-workflow"]').length,
        words: document.body.innerText.includes('Choose workflow') })""")
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-no-detected.png"))
    page.get_by_role("button", name="Open launch options").click()
    check("no-detected-anywhere", not desk_detected and not form_detected and drawer["select"] == 0
          and not drawer["words"] and launch_posts() == [],
          desk=desk_detected, form=form_detected, drawer=drawer, posts=launch_posts())

    # ── 8: the launch form takes the grammar: `/` opens the menu, a pick sets the pill ──
    problem.fill("")
    problem.type("/")
    page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
    form_cmds = page.eval_on_selector_all(
        '[data-testid="composer-menu-item"][data-group="start-work"]', "els => els.map(e => e.dataset.cmd)")
    menu_box = page.get_by_test_id("composer-menu").bounding_box()
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-launch-form-menu.png"))
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.get_by_test_id("launch-workflow-pill").wait_for(state="visible", timeout=8000)
    pill = page.get_by_test_id("launch-workflow-pill").inner_text()
    after = problem.input_value()
    menu_gone = page.get_by_test_id("composer-menu").count() == 0
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-launch-form-pill.png"))
    in_view = menu_box is not None and menu_box["y"] >= 0 and menu_box["y"] + menu_box["height"] <= H
    check("launch-form-menu-sets-the-pill",
          all(c in form_cmds for c in ordinary) and "workflow-chat" not in form_cmds and in_view
          and "/workflow-bug" in pill and after == "" and menu_gone and launch_posts() == [],
          cmds=form_cmds, menu_box=menu_box, pill=pill, after=after, menu_gone=menu_gone, posts=launch_posts())

    # no horizontal scroll on any captured state
    hscroll = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
    check("no-errors", not errors and not hscroll, errors=errors[:5], hscroll=hscroll)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
