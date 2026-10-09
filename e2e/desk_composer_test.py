#!/usr/bin/env python3
"""
desk_composer_test.py — S7 (DES-STUDIO-REBUILD-001 §5.7, §11 S7): the composer's about-chips, the
`@` and `/` menus and plan drafts, at 1440x700 on the Desk.

Against the in-process fixture (team_plan + plan_gate: r-team executing a preset plan, r-plan-gate
paused at its plan_approval gate):

  1. MID-RUN UNDO: on r-team's session, `/te` opens the menu, Enter queues Test ("Adding Test ·
     Undo"); Undo inside the window → after the window, 0 plan POSTs.
  2. MID-RUN SEND: `/test` again, the window runs out → exactly one POST /runs/r-team/plan with
     the test step and a requestId; the run reads "Added Test" with no Undo.
  3. REFUSED: `/plan` is refused in the menu with the engine's reason; nothing is queued.
  4. QUESTION: "should we just plan it?" opens no menu and makes no plan POST.
  5. GATE AMEND: on r-plan-gate's session, `/test` puts "The steps change: + Test." on the plan
     card and the primary reads "Approve with these changes"; no gate POST until it is pressed;
     then exactly one POST /runs/r-plan-gate/gate whose plan carries test.
  6. CHIPS: a selection in the thread becomes "about: “…”"; Backspace in the empty box removes
     it; on the Desk `@` names a project → "in: …" chip.
  7. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-composer*.png. Env: FEEDBACK_PORT (default 4351).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4351"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
WINDOW_MS = 11_500

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


def tap(path: str) -> list:
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as r:
        return json.loads(r.read())["posts"]


def plan_edits() -> list:
    return [p for p in tap("/__fixture/plan-posts") if p.get("route") == "edit"]


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
    set_fixture(origin, team_plan=True, plan_gate=True, reset_plan=True, reset_gate_posts=True)

    box = page.get_by_test_id("session-composer-input")

    def open_session(rid: str) -> None:
        page.goto(f"{origin}/s/run:{rid}", wait_until="networkidle")
        page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
        box.wait_for(state="visible", timeout=8000)

    def pick(text: str) -> None:
        box.click()
        box.fill("")
        box.type(text)
        page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
        page.keyboard.press("Enter")

    # ── 1. mid-run: Undo inside the window sends nothing ─────────────────────────────
    open_session("r-team")
    box.click()
    box.type("/te")
    page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
    items = page.get_by_test_id("composer-menu-item").evaluate_all("els => els.map(e => e.dataset.cmd)")
    page.screenshot(path=str(SHOTS / "desk-composer-slash.png"))
    page.keyboard.press("Enter")
    page.get_by_test_id("session-step-queued").wait_for(state="visible", timeout=8000)
    queued = page.get_by_test_id("session-step-queued").inner_text()
    page.screenshot(path=str(SHOTS / "desk-composer-queued.png"))
    page.get_by_test_id("session-step-undo").click()
    page.wait_for_timeout(WINDOW_MS)
    undone = plan_edits()
    check("mid-run-undo", items == ["test"] and queued.startswith("Adding Test") and undone == [],
          items=items, queued=queued, posts=len(undone))

    # ── 2. mid-run: the window runs out → exactly one POST with a requestId ──────────
    pick("/test")
    page.wait_for_timeout(WINDOW_MS)
    sent = plan_edits()
    try:
        page.get_by_test_id("session-step-added").wait_for(state="visible", timeout=8000)
        added = page.get_by_test_id("session-step-added").inner_text()
    except Exception:  # noqa: BLE001
        added = ""
    page.screenshot(path=str(SHOTS / "desk-composer-added.png"))
    body = sent[0]["body"] if sent else {}
    check("mid-run-send", len(sent) == 1 and sent[0]["runId"] == "r-team"
          and body.get("plan", {}).get("steps") == [{"catalog": "test"}]
          and isinstance(body.get("requestId"), str) and added.startswith("Added Test")
          and page.get_by_test_id("session-step-undo").count() == 0,
          posts=sent, added=added)

    # ── 3. a refused command says why and queues nothing ─────────────────────────────
    pick("/plan")
    page.get_by_test_id("composer-note").wait_for(state="visible", timeout=8000)
    note = page.get_by_test_id("composer-note").inner_text()
    queued_after = page.get_by_test_id("session-step-queued").count()
    check("refused", "only grows" in note and queued_after == 0, note=note)

    # ── 4. a question is never a command ─────────────────────────────────────────────
    box.fill("")
    box.type("should we just plan it?")
    page.wait_for_timeout(400)
    menu = page.get_by_test_id("composer-menu").count()
    box.fill("")
    page.wait_for_timeout(WINDOW_MS)
    check("question", menu == 0 and len(plan_edits()) == 1, menu=menu, plan_posts=len(plan_edits()))

    # ── 6a. a selection in the thread becomes a chip; Backspace removes it ───────────
    page.evaluate("""() => {
      const el = document.querySelector('[data-testid="session-run"] .wk-session-run-title');
      const r = document.createRange(); r.selectNodeContents(el);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }""")
    page.get_by_test_id("composer-chip").wait_for(state="visible", timeout=8000)
    chip = page.get_by_test_id("composer-chip").inner_text()
    page.screenshot(path=str(SHOTS / "desk-composer-chip.png"))
    box.click()
    box.fill("")
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)
    check("selection-chip", chip.startswith("about: “") and page.get_by_test_id("composer-chip").count() == 0, chip=chip)

    # ── 5. the plan gate: a draft on its card, sent only by "Approve with these changes"
    open_session("r-plan-gate")
    page.get_by_test_id("session-proposal").wait_for(state="visible", timeout=15000)
    before = len(tap("/__fixture/gate-posts"))
    pick("/test")
    page.get_by_test_id("session-proposal-draft").wait_for(state="visible", timeout=8000)
    draft = page.get_by_test_id("session-proposal-draft").inner_text()
    go = page.get_by_test_id("session-proposal-go").inner_text()
    page.screenshot(path=str(SHOTS / "desk-composer-gate-draft.png"))
    page.wait_for_timeout(1500)
    quiet = len(tap("/__fixture/gate-posts")) - before
    page.get_by_test_id("session-proposal-go").click()
    page.wait_for_timeout(WINDOW_MS)
    gate_posts = [g for g in tap("/__fixture/gate-posts") if g["runId"] == "r-plan-gate"]
    steps = [s.get("catalog") for s in (gate_posts[-1]["body"].get("plan", {}).get("steps", []) if gate_posts else [])]
    check("gate-amend", draft.startswith("The steps change: + Test.") and go == "Approve with these changes"
          and quiet == 0 and len(gate_posts) == 1 and "test" in steps and gate_posts[0]["body"].get("approve") is True
          and len(plan_edits()) == 1,
          draft=draft, go=go, before_press=quiet, gate_posts=len(gate_posts), steps=steps)

    # ── 6b. the Desk: @ names a project → "in: …" ─────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    desk_box = page.get_by_test_id("desk-composer-input")
    desk_box.wait_for(state="visible", timeout=15000)
    desk_box.click()
    desk_box.type("@")
    page.get_by_test_id("composer-menu").wait_for(state="visible", timeout=8000)
    first = page.locator('[data-testid="composer-menu-item"][data-kind="project"]').first
    first.wait_for(state="visible", timeout=8000)
    page.keyboard.press("Enter")
    page.get_by_test_id("composer-chip").wait_for(state="visible", timeout=8000)
    pchip = page.get_by_test_id("composer-chip").inner_text()
    page.screenshot(path=str(SHOTS / "desk-composer-project.png"))
    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("project-chip", pchip.startswith("in: ") and not overflow, chip=pchip, overflow=overflow)

    check("no-errors", not errors, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
