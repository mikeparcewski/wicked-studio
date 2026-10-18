#!/usr/bin/env python3
"""
desk_slash_workflows_test.py — S19a (DES-STUDIO-REBUILD-001 §5.5/§5.7): a workflow is named with a
`/workflow-<key>` FIRST token in a composer (concept A: a session's; the Desk has none) and Enter launches it, at 1440x700 against the
in-process fixture (`workflow_catalog` serves GET /workflows; `repo` serves GET /repos; `sessions`
records POST /runs):

  1. MENU: `/wo` groups "Start work" with the daemon's five ordinary defs (feature, bug, migration,
     domain-extraction, capture-learnings), each line read off the catalog ("2 steps: plan → build"),
     and never the system flow (chat); a mid-text `/workflow-` is a sentence — no rows.
  2. WIZARD (operator 2026-10-11): picking a row opens the launch wizard — a modal dialog on its
     "what" step, focus in the box, no inline strip, no POST.
  3. REFUSE: with no repository the wizard's Where step holds Next and says why; nothing is sent.
  4. LAUNCH: with a repository (the lone one is picked), Next → options → review → Launch makes
     exactly ONE POST /runs carrying workflow=bug, repoRef=studio-api, humanConfirm=before:1,
     deliver=pr and the intent as `problem` — then the page opens the run's session.
  5. Escape closes the wizard, keeps the draft for the next open, and never launches.
  S19b (the removals, the launch form's grammar, discoverability):
  6. ⌘K `>New job` — from a page with no composer (/runs/new) and from the Desk — opens the wizard
     where you are, on its first step (the kind of job, the daemon's catalog); nothing is sent.
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

SESSION = "/s/run%3Ac1"  # a finished wave-1 run's session: its composer is the page's composer

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
        # Concept A (DES-frontdoor): the Desk has no composer; a session's composer carries the menu.
        page.goto(f"{origin}{SESSION}", wait_until="networkidle")
        page.get_by_test_id("session-composer-input").wait_for(state="visible", timeout=15000)

    # ── 1 + 2: the menu, and naming the work ──────────────────────────────────────
    set_fixture(origin, wave1=True, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    open_desk()
    box = page.get_by_test_id("session-composer-input")
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
          and len(feature_line) == 1 and "2 steps: plan → build" in feature_line[0],
          groups=groups, cmds=cmds, feature_line=feature_line)

    # ── compact menu geometry: 1440×700 ──────────────────────────────────────────
    _GEO_JS = """() => {
        const menu = document.querySelector('[data-testid="composer-menu"]');
        if (!menu) return { missing: true };
        const box = menu.getBoundingClientRect();
        const items = [...document.querySelectorAll('[data-testid="composer-menu-item"]')];
        const rowHeights = items.map(e => Math.round(e.getBoundingClientRect().height));
        const keyOnce = items.every(e => {
            const key = e.dataset.workflow || e.dataset.cmd || '';
            if (!key) return true;
            const cnt = (e.innerText.toLowerCase().split(key.toLowerCase())).length - 1;
            return cnt === 1;
        });
        const rowsHit = items.every(e => {
            const rect = e.getBoundingClientRect();
            const probeX = rect.left + 8;
            const probeY = rect.top + rect.height / 2;
            if (probeX < 0 || probeY < 0 || probeX > window.innerWidth || probeY > window.innerHeight) return false;
            const hit = document.elementFromPoint(probeX, probeY);
            return hit !== null && (e.contains(hit) || e === hit);
        });
        return {
            inView: box.x >= 0 && box.y >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
            maxRowH: Math.max(...rowHeights, 0),
            keyOnce,
            rowsHit,
            hscroll: document.documentElement.scrollWidth > window.innerWidth + 1
        };
    }"""
    page.screenshot(path=str(SHOTS / "desk-slash-menu-1440-dark.png"))
    page.evaluate("() => { document.documentElement.dataset.theme = 'wicked-light'; }")
    page.screenshot(path=str(SHOTS / "desk-slash-menu-1440-light.png"))
    page.evaluate("() => { delete document.documentElement.dataset.theme; }")
    geo_1440 = page.evaluate(_GEO_JS)
    check("compact-menu-1440",
          geo_1440.get("inView") and geo_1440.get("maxRowH", 99) <= 32
          and geo_1440.get("keyOnce") and geo_1440.get("rowsHit") and not geo_1440.get("hscroll"),
          geo=geo_1440)

    # ── compact menu geometry: 390×844 ───────────────────────────────────────────
    narrow = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    narrow.on("pageerror", lambda e: errors.append(str(e)))
    narrow.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    narrow.goto(f"{origin}{SESSION}", wait_until="networkidle")
    narrow.get_by_test_id("session-composer-input").wait_for(state="visible", timeout=15000)
    narrow_box = narrow.get_by_test_id("session-composer-input")
    narrow_box.click()
    narrow_box.type("/wo")
    narrow.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
    narrow.screenshot(path=str(SHOTS / "desk-slash-menu-390-dark.png"))
    narrow.evaluate("() => { document.documentElement.dataset.theme = 'wicked-light'; }")
    narrow.screenshot(path=str(SHOTS / "desk-slash-menu-390-light.png"))
    narrow.evaluate("() => { delete document.documentElement.dataset.theme; }")
    geo_390 = narrow.evaluate(_GEO_JS)
    # UI contract §2: on a phone every target is at least --tap-min (44 px), so a row is exactly that
    # tall, never taller (compact still means one line per row, no boilerplate).
    check("compact-menu-390",
          geo_390.get("inView") and geo_390.get("maxRowH", 99) <= 44
          and geo_390.get("keyOnce") and geo_390.get("rowsHit") and not geo_390.get("hscroll"),
          geo=geo_390)

    # ── a full `/` list (both groups) is taller than the cap: the MENU scrolls, no row is squeezed,
    #    ArrowDown keeps the active row in view, and the active row is tinted in light as in dark ──
    narrow_box.fill("")
    narrow_box.type("/")
    narrow.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"composer-menu-item\"][data-group=\"add-step\"]').length > 0",
        timeout=8000)
    rows_n = narrow.locator('[data-testid="composer-menu-item"]').count()
    for _ in range(rows_n - 1):
        narrow_box.press("ArrowDown")
    _FULL_JS = """() => {
        const menu = document.querySelector('[data-testid="composer-menu"]');
        const items = [...menu.querySelectorAll('[data-testid="composer-menu-item"]')];
        const on = menu.querySelector('[aria-selected="true"]');
        const m = menu.getBoundingClientRect(), a = on.getBoundingClientRect();
        const bg = (e) => getComputedStyle(e).backgroundColor;
        return {
            scrolls: menu.scrollHeight > menu.clientHeight + 1,
            squeezed: items.filter(e => e.scrollHeight > e.clientHeight + 1).map(e => e.dataset.cmd),
            activeLast: on === items[items.length - 1],
            activeInView: a.top >= m.top - 1 && a.bottom <= m.bottom + 1,
            tinted: bg(on) !== bg(menu) && bg(on) !== 'rgba(0, 0, 0, 0)',
        };
    }"""
    full_dark = narrow.evaluate(_FULL_JS)
    narrow.evaluate("() => { document.documentElement.dataset.theme = 'wicked-light'; }")
    full_light = narrow.evaluate(_FULL_JS)
    narrow.screenshot(path=str(SHOTS / "desk-slash-menu-390-full-light.png"))
    narrow.evaluate("() => { delete document.documentElement.dataset.theme; }")
    narrow.close()
    check("compact-menu-full-list",
          full_dark["scrolls"] and full_dark["squeezed"] == [] and full_dark["activeLast"]
          and full_dark["activeInView"] and full_dark["tinted"] and full_light["tinted"],
          dark=full_dark, light=full_light)

    # ── 2: a pick opens the LAUNCH WIZARD (operator 2026-10-11) — a modal, no chip, no POST ──
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.get_by_test_id("launch-wizard").wait_for(state="visible", timeout=8000)
    wiz = page.evaluate("""() => { const d = document.querySelector('[data-testid="launch-wizard"]');
        return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
                 step: document.querySelector('[data-testid="launch-wizard-step"]').dataset.step,
                 focused: document.activeElement?.dataset?.testid ?? null,
                 strip: document.querySelectorAll('[data-testid="composer-launch-row"]').length }; }""")
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-wizard.png"))
    check("pick-opens-the-wizard",
          wiz["role"] == "dialog" and wiz["modal"] == "true" and wiz["step"] == "what"
          and wiz["focused"] == "launch-wizard-intent" and wiz["strip"] == 0 and launch_posts() == [],
          wiz=wiz, posts=launch_posts())
    page.keyboard.press("Escape")
    page.get_by_test_id("launch-wizard").wait_for(state="detached", timeout=5000)

    # a mid-text /workflow- is a sentence: no Start work rows
    box.fill("")
    box.type("please /workflow-bug")
    page.wait_for_timeout(300)
    mid = page.eval_on_selector_all(
        '[data-testid="composer-menu-item"][data-group="start-work"]', "els => els.length")
    check("mid-text-is-a-sentence", mid == 0, rows=mid)
    page.keyboard.press("Escape")

    def wizard_for_bug(intent: str) -> None:
        box = page.get_by_test_id("session-composer-input")
        box.click()
        box.fill("")
        box.type("/workflow-")
        page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').wait_for(state="visible", timeout=8000)
        page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
        page.get_by_test_id("launch-wizard-intent").wait_for(state="visible", timeout=8000)
        page.get_by_test_id("launch-wizard-intent").fill(intent)
        page.get_by_test_id("launch-wizard-next").click()

    # ── 3: no repository → the wizard's Where step holds Next and says why; nothing is sent ──
    set_fixture(origin, wave1=True, workflow_catalog=True, repo=False, sessions=True, reset_gate_posts=True)
    open_desk()
    wizard_for_bug("the charge never clears")
    page.get_by_test_id("launch-wizard-repo").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(300)
    blocker = page.get_by_test_id("launch-wizard-blocker").inner_text()
    held = page.get_by_test_id("launch-wizard-next").is_disabled()
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-refused.png"))
    check("no-repo-refuses", "Choose the repository" in blocker and held and launch_posts() == [],
          blocker=blocker, held=held, posts=launch_posts())
    page.keyboard.press("Escape")

    # ── 4: with a repository: Next, Next, review, Launch → exactly one POST, then the session ──
    set_fixture(origin, wave1=True, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    page.evaluate("() => { try { localStorage.removeItem('wicked_composer_dropped_seats'); } catch (e) {} }")
    open_desk()
    wizard_for_bug("the charge never clears")
    page.wait_for_function(
        "() => { const e = document.querySelector('[data-testid=\"launch-wizard-repo\"]'); return e && e.value && e.value !== ''; }",
        timeout=8000)
    page.get_by_test_id("launch-wizard-next").click()
    page.get_by_test_id("launch-wizard-next").click()
    review = page.get_by_test_id("launch-wizard-review").inner_text()
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-ready.png"))
    page.get_by_test_id("launch-wizard-launch").click()
    posts = wait_posts(1)
    try:
        page.wait_for_function("() => location.pathname.startsWith('/s/')", timeout=8000)
        went = page.evaluate("() => location.pathname")
    except Exception:
        went = page.evaluate("() => location.pathname")
    page.screenshot(path=str(SHOTS / "desk-slash-workflows-launched.png"))
    body = posts[0] if posts else {}
    check("one-launch",
          len(posts) == 1 and "the charge never clears" in review
          and body.get("workflow") == "bug" and body.get("repoRef") == "studio-api"
          and body.get("humanConfirm") == "before:1" and body.get("deliver") == "pr"
          and body.get("problem") == "the charge never clears",
          review=review, count=len(posts), body=body)
    check("opens-the-run", went.startswith("/s/"), path=went)

    # ── 5: Escape closes the wizard, keeps the draft, and never launches ───────────
    set_fixture(origin, wave1=True, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    open_desk()
    wizard_for_bug("keep this draft")
    page.keyboard.press("Escape")
    page.get_by_test_id("launch-wizard").wait_for(state="detached", timeout=5000)
    page.wait_for_timeout(300)
    box = page.get_by_test_id("session-composer-input")
    box.click()
    box.type("/workflow-")
    page.locator('[data-testid="composer-menu-item"][data-cmd="workflow-bug"]').click()
    page.get_by_test_id("launch-wizard-intent").wait_for(state="visible", timeout=8000)
    kept = page.get_by_test_id("launch-wizard-intent").input_value()
    page.keyboard.press("Escape")
    check("escape-sends-nothing", launch_posts() == [] and kept == "keep this draft", kept=kept, posts=launch_posts())

    # ── 6: ⌘K "New job" opens the wizard on its first step (the kind of job) — from a page with
    #    no composer (/runs/new) and from the Desk; nothing is sent ──
    def new_job() -> dict:
        page.keyboard.press("ControlOrMeta+k")
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
        page.get_by_test_id("palette-input").fill("> New job")
        page.locator('[data-testid="palette-row"]', has_text="New job").first.click()
        page.get_by_test_id("launch-wizard").wait_for(state="visible", timeout=8000)
        # The catalog may still be on its way (the Desk no longer warms it with a composer). Demo video
        # and Draft epics are studio's own cards, always listed (#749, operator 2026-10-12), so wait past both.
        try:
            page.wait_for_function("() => document.querySelectorAll('[data-testid^=\"launch-wizard-workflow-\"]').length > 2", timeout=8000)
        except Exception:  # noqa: BLE001 — reported by the check
            pass
        st = page.evaluate("""() => ({ path: location.pathname,
            step: document.querySelector('[data-testid="launch-wizard-step"]')?.dataset.step ?? null,
            rows: document.querySelectorAll('[data-testid^="launch-wizard-workflow-"]').length })""")
        page.keyboard.press("Escape")
        page.get_by_test_id("launch-wizard").wait_for(state="detached", timeout=5000)
        return st

    set_fixture(origin, wave1=True, workflow_catalog=True, repo=True, sessions=True, reset_gate_posts=True)
    page.goto(f"{origin}/runs/new", wait_until="networkidle")
    page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
    from_form = new_job()
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-new-job").wait_for(state="visible", timeout=15000)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    from_desk = new_job()
    check("new-job-opens-the-wizard",
          from_form["path"] == "/runs/new" and from_desk["path"] == "/"
          and all(st["rows"] >= 5 for st in (from_form, from_desk))
          and launch_posts() == [],
          from_form=from_form, from_desk=from_desk, posts=launch_posts())

    # ── 7: no "Detected:" anywhere — the Desk, and the launch form ─────────────────
    sentence = "fix the crash in checkout"
    open_desk()
    box = page.get_by_test_id("session-composer-input")
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
