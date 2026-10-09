#!/usr/bin/env python3
"""
desk_answer_test.py — ANSWER A QUESTION IN ITS ROW (DES-STUDIO-REBUILD-001 §11 S5), 1440x700,
on the Desk. REAL 10 s undo window throughout.

The wave-1 corpus with a SIMPLE gate waiting on b1 (unit 3), answered from its Desk row:

  open      "Answer" opens the row's choices (Approve / Reject); C3 absent: nothing is preselected.
  enter     Enter with nothing moved to sends nothing and queues nothing (§5.6 rule 3).
  undo      ↓ then Enter queues Approve: the row folds to "You chose Approve · Undo N s"; the toast
            names the gate ("Approving “migrate beta's settings page to the new form kit” in 10 s"); Undo restores the row; 12 s later the
            daemon has received NOTHING.
  elsewhere the digit 1 queues Approve; mid-window the gate is answered elsewhere (a live `resumed`
            frame): NO POST, the notice reads "Not sent: … answered elsewhere".
  new gate  fresh page, 1 again; mid-window a NEW gate opens on b1: NO POST, the notice says so.
  close     fresh page, 1 again, then the page is reloaded inside the window: NO POST.
  ord       fresh page, a click on Approve, no interference: exactly ONE POST after 10 s,
            body {approve: true, ord: 3}, and "Approved “migrate beta's settings page to the new form kit”." is reported.
  cards     with the trust + gate-move corpus: the DELIVER gate (r-trust-deliver) and the
            ESCALATION gate (r-review) offer no Answer — their row opens the card — while the plain
            gate (b1) beside them can be answered in its row.
  re-ask    studio#439: 1 queues Approve; mid-window the SAME ord is asked again (a new
            `awaitingHuman`): NO POST, the notice says it was asked again, the row asks afresh.
  C3        a gate carrying `recommended: 0` preselects Approve (marked "suggested"), and Enter is
            STILL inert until the operator moves.

Captures: e2e/shots/desk-answer*.png. Env: FEEDBACK_PORT (default 4348); DESK_ANSWER_PART=a|b runs
only the window steps (a) or the card/C3 steps (b) — CI runs both.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4348"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok and os.environ.get("JOURNEY_ALL_STEPS") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)




def server_posts(origin: str, rid: str = "b1") -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if p["runId"] == rid]


def notice(page) -> str:
    return page.evaluate(
        "() => [...document.querySelectorAll('[data-testid=\"undo-result\"]')].map(n => n.dataset.kind + ': ' + n.textContent).join(' | ')")


ROW = '[data-testid="need-row"][data-key="gate:b1"], [data-testid="need-member"][data-key="gate:b1"]'

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def desk(browser, **corpus):
    set_fixture(origin, **{**dict(wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={},
                                  extra_gates=[], extra_frames=[], reset_gate_posts=True,
                                  trust_rules=False, gate_move=False), **corpus})
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    for t in page.locator('[data-testid="need-group-toggle"][aria-expanded="false"]').all():
        t.click()
    page.locator(ROW).wait_for(state="visible", timeout=10000)
    return page


def open_row(page, row=ROW):
    page.locator(row).locator('[data-testid="need-answer"]').click()
    page.locator(row).locator('[data-testid="need-choices"]').wait_for(state="visible", timeout=10000)
    return page.locator(row)


PART = os.environ.get("DESK_ANSWER_PART", "")

with sync_playwright() as p:
    browser = p.chromium.launch()
    if PART in ("", "a"):
        # ── open, Enter inert, ↓ Enter queues, Undo restores, nothing sent ────────────
        page = desk(browser)
        row = open_row(page)
        choices = row.locator('[data-testid="need-choice"]').evaluate_all(
            "els => els.map(e => [e.dataset.choice, e.innerText.trim(), e.dataset.focus, e.dataset.recommended || ''])")
        check("open", [c[0] for c in choices] == ["approve", "reject"]
              and all(c[2] == "false" and c[3] == "" for c in choices), choices=choices)
        page.screenshot(path=str(SHOTS / "desk-answer-open.png"))
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        check("enter-inert", page.get_by_test_id("undo-toast").count() == 0
              and row.locator('[data-testid="need-choices"]').count() == 1)
        page.keyboard.press("ArrowDown")
        # The moved-to choice is announced (aria-activedescendant names it; codex).
        active = row.locator('[data-testid="need-choices"]').evaluate(
            "g => { const id = g.getAttribute('aria-activedescendant'); const el = id && document.getElementById(id); "
            "return el ? [el.dataset.choice, el.getAttribute('aria-checked')] : null; }")
        check("moved-is-announced", active == ["approve", "true"], active=active)
        page.keyboard.press("Enter")
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        pressed = time.monotonic()
        line = row.locator('[data-testid="need-chosen-line"]').inner_text()
        toast = page.get_by_test_id("undo-toast").text_content() or ""
        check("folded", line.startswith("You chose Approve · Undo ") and "Approving “migrate beta's settings page to the new form kit” in" in toast,
              line=line, toast=toast)
        page.screenshot(path=str(SHOTS / "desk-answer-chosen.png"))
        row.locator('[data-testid="need-chosen-undo"]').click()
        page.wait_for_timeout(300)
        check("undo-restores", row.locator('[data-testid="need-answer"]').count() == 1
              and row.locator('[data-testid="need-chosen"]').count() == 0)
        page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
        check("undo-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))

        # ── answered elsewhere mid-window ─────────────────────────────────────────────
        open_row(page)
        page.keyboard.press("1")
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        pressed = time.monotonic()
        page.wait_for_timeout(3000)
        set_fixture(origin, status_over={"b1": "executing"}, gate_now=[],
                    extra_frames=[{"type": "resumed", "session": "b1"}])
        page.wait_for_timeout(max(0, int((pressed + 6.5 - time.monotonic()) * 1000)))
        check("elsewhere-notice", "not-sent: Not sent: the gate on “migrate beta's settings page to the new form kit” was answered elsewhere" in notice(page),
              notice=notice(page))
        page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
        check("elsewhere-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))
        page.close()

        # ── a NEW gate on the same run mid-window ─────────────────────────────────────
        page = desk(browser)
        open_row(page)
        page.keyboard.press("1")
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        pressed = time.monotonic()
        page.wait_for_timeout(3000)
        set_fixture(origin, extra_gates=[{"session": "b1", "ord": 4, "prompt": "Approve unit 4 before it runs: ship it"}])
        page.wait_for_timeout(max(0, int((pressed + 6.5 - time.monotonic()) * 1000)))
        check("newgate-notice", "not-sent: Not sent: a new gate opened on “migrate beta's settings page to the new form kit”" in notice(page), notice=notice(page))
        page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
        check("newgate-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))
        page.close()

        # ── the page closes inside the window: nothing is sent ────────────────────────
        page = desk(browser)
        open_row(page)
        page.keyboard.press("1")
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        pressed = time.monotonic()
        page.close()
        time.sleep(max(0.0, pressed + 12.0 - time.monotonic()))
        check("close-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))

        # ── undisturbed: one POST after 10 s, naming its gate ─────────────────────────
        page = desk(browser)
        row = open_row(page)
        row.locator('[data-testid="need-choice"][data-choice="approve"]').click()
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        pressed = time.monotonic()
        page.wait_for_timeout(max(0, int((pressed + 9.3 - time.monotonic()) * 1000)))
        check("ord-nothing-before-window", len(server_posts(origin)) == 0)
        page.wait_for_timeout(2500)
        posts = server_posts(origin)
        check("ord-one-post-names-gate", len(posts) == 1 and posts[0]["body"] == {"approve": True, "ord": 3},
              posts=[q["body"] for q in posts])
        check("sent-result", "sent: Approved “migrate beta's settings page to the new form kit”." in notice(page), notice=notice(page))
        # The row says it was sent while the run has no gate (Copilot): never falls back to Open.
        sent_line = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"need-chosen-line\"]')].map(e => e.innerText)")
        check("sent-row", sent_line in ([], ["You chose Approve · sent"]), sent_line=sent_line)
        page.close()

    if PART in ("", "b"):
        # ── deliver and escalation gates open their card; a plain gate is answered ────
        page = desk(browser, trust_rules=True, gate_move=True)
        for t in page.locator('[data-testid="need-group-toggle"][aria-expanded="false"]').all():
            t.click()
        page.wait_for_timeout(500)
        rows = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll(
            '[data-testid="need-row"][data-kind="gate"], [data-testid="need-member"][data-kind="gate"]')].map(r => [r.dataset.key, {
              answer: !!r.querySelector('[data-testid="need-answer"]'),
              card: (r.querySelector('[data-testid="need-act"][data-card-reason]') || {}).dataset?.cardReason || null}]))""")
        check("cards", rows.get("gate:r-trust-deliver", {}).get("card") == "deliver"
              and not rows.get("gate:r-trust-deliver", {}).get("answer")
              and rows.get("gate:r-review", {}).get("card") == "escalation"
              and not rows.get("gate:r-review", {}).get("answer")
              and rows.get("gate:b1", {}).get("answer") is True, rows=rows)
        page.screenshot(path=str(SHOTS / "desk-answer-cards.png"))
        page.close()

        # ── studio#439: the SAME ord asked again mid-window is a new gate ──────────────
        page = desk(browser)
        row = open_row(page)
        page.keyboard.press("1")
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        pressed = time.monotonic()
        page.wait_for_timeout(2500)
        set_fixture(origin, extra_frames=[{"type": "awaitingHuman", "session": "b1", "ord": 3,
                                           "prompt": "Approve unit 3 before it runs: build"}])
        page.wait_for_timeout(max(0, int((pressed + 6.5 - time.monotonic()) * 1000)))
        afresh = page.locator(ROW).locator('[data-testid="need-answer"]').count() == 1 \
            and page.locator(ROW).locator('[data-testid="need-chosen"]').count() == 0
        page.screenshot(path=str(SHOTS / "desk-answer-reask.png"))
        check("reask-notice-and-asks-afresh", "was asked again" in notice(page) and afresh,
              notice=notice(page), afresh=afresh)
        page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
        check("reask-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))
        page.close()

        # ── C3: a recommendation preselects, Enter still waits for a move ─────────────
        page = desk(browser)
        # The recommendation rides the live gate frame; sent once the page's socket is up.
        set_fixture(origin, extra_frames=[{"type": "awaitingHuman", "session": "b1", "ord": 3,
                                           "prompt": "Approve unit 3 before it runs: build", "recommended": 0}])
        page.wait_for_timeout(1500)
        row = open_row(page)
        try:
            row.locator('[data-testid="need-choice"][data-recommended="true"]').wait_for(state="visible", timeout=5000)
        except Exception:  # noqa: BLE001 — reported by the check below
            pass
        rec = row.locator('[data-testid="need-choice"]').evaluate_all(
            "els => els.map(e => [e.dataset.choice, e.dataset.focus, e.dataset.recommended || ''])")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        inert = page.get_by_test_id("undo-toast").count() == 0
        check("c3-preselect-only", rec[0] == ["approve", "true", "true"] and inert, choices=rec, inert=inert)
        page.screenshot(path=str(SHOTS / "desk-answer-c3.png"))
        page.close()

    check("no-page-errors", not errors, errors=errors[:5])
    set_fixture(origin, wave1=False, gate_now=[], gate_simple=[], status_over={}, extra_gates=[],
                trust_rules=False, gate_move=False, reset_gate_posts=True)
    browser.close()

report["ok"] = all(v.get("ok") for v in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
