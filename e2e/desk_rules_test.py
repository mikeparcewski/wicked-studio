#!/usr/bin/env python3
"""
desk_rules_test.py — DC-S8 (DES-DECISION-CAPTURE §3 B10, B11): the considered line on a reply and on a
run step, and ORIGIN + "Where it was considered" on the rule page, at 1440x700 under STUDIO_SKIN=desk.

Drives the built UI against the in-process fixture's sessions corpus plus `decisions` (chat-pay's
turns with crew's `/considered` reads on the DC-S7 wire) and `steering_rules` (GET /governance/rules
serves the rule dec-auto landed), and proves:

  1. B10  under the reply that cited a rule: "2 of your rules considered · 1 set aside · cited 1
          (unchecked) · 1 unverified citation" — one line, closed, under the helper's turn.
  2. B10  it opens to one row per rule: Cited by claude — unchecked / Considered / Set aside — other
          project / an unverified citation shown by its id with nothing to open.
  3. B10  a turn crew holds no record of (never mind, 404) has no line; the first turn reads
          "1 of your rules considered"; the word "Followed" is nowhere on the page.
  4. B10  the Build step's sheet carries the step's line: "Cited by the step — unchecked".
  5. B11  a row opens the rule on the Rules page: the drawer, scope and effect as one sentence.
  6. B11  ORIGIN from the ledger: the verbatim words, the actor, how it was remembered, where (a link
          to the conversation); the history row.
  7. B11  "Where it was considered": the conversation as ONE row by its title ("· 6 turns", cited) and
          the Build step (cited — unchecked),
          and "look underneath" opens that step's sheet.
  8. N7   no "Hold work to it" control on a decision rule.
  9. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-rules*.png. Env: FEEDBACK_PORT (default 4357).
"""

import json
import os
import sys
import time

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4357"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": str(why)}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

LINE = '[data-testid="considered-line"][data-key="{}"]'
SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    looked_at = int(time.time() * 1000) - 90 * 60 * 1000
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});"
        f"if (!localStorage.getItem('studio.visit')) localStorage.setItem('studio.visit', JSON.stringify({{lastSeenAt: {looked_at}, handover: null}}));")

    set_fixture(origin, sessions=True, run_chat_id=True, decisions=True, decisions_mode="on", steering_rules=True,
                extra_frames=[], reset_decisions=True)

    # ── 1. B10: the line under the reply that cited a rule ─────────────────────────────
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    d2 = page.locator(LINE.format("considered:chat-pay:d2"))
    try:
        d2.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-rules-missing.png"))
        fail("considered-line", f"no considered line under chat-pay's d2 reply: {e}")
    d2.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-rules-line.png"))
    text = d2.get_by_test_id("considered-text").inner_text()
    host = page.evaluate(
        "() => { const el = document.querySelector('[data-testid=\"considered-line\"][data-key=\"considered:chat-pay:d2\"]');"
        " const t = el?.closest('[data-testid=\"session-turn\"]'); return t ? {who: t.dataset.who, text: t.innerText} : null; }")
    check("considered-line", text == "2 of your rules considered · 1 set aside · cited 1 (unchecked) · 1 unverified citation"
          and d2.get_attribute("data-subject") == "turn" and d2.get_attribute("data-open") == "false"
          and host is not None and host["who"] == "helper" and "[rule:proposal:pr-auto]" in host["text"],
          text=text, host=host)

    # ── 2. B10: it opens to one row per rule ───────────────────────────────────────────
    d2.get_by_test_id("considered-toggle").click()
    rows = d2.locator('[data-testid="considered-row"]')
    rows.first.wait_for(state="visible", timeout=8000)
    verdicts = [rows.nth(i).get_attribute("data-verdict") for i in range(rows.count())]
    details = [rows.nth(i).get_by_test_id("considered-row-detail").inner_text() for i in range(rows.count())]
    unverified = d2.locator('[data-testid="considered-row"][data-verdict="unverified"]')
    page.screenshot(path=str(SHOTS / "desk-rules-rows.png"))
    check("considered-rows", verdicts == ["cited", "considered", "set-aside", "unverified"]
          and details == ["Cited by claude — unchecked", "Considered", "Set aside — other project",
                          "Unverified citation by claude — not a rule in force here"]
          and unverified.get_by_test_id("considered-row-id").inner_text() == "[rule:POL-999]"
          and unverified.get_by_test_id("considered-row-open").count() == 0
          and d2.get_attribute("data-open") == "true",
          verdicts=verdicts, details=details)

    # ── 3. B10: no line for a 404 turn; the first turn; no "Followed" anywhere ──────────
    never = page.locator('[data-testid="session-turn"][data-who="helper"]').filter(has_text="Skipping it.")
    d1 = page.locator(LINE.format("considered:chat-pay:d1"))
    body = page.evaluate("() => document.body.innerText")
    check("quiet-and-no-followed", never.count() == 1 and never.locator('[data-testid="considered-line"]').count() == 0
          and d1.count() == 1 and d1.get_by_test_id("considered-text").inner_text() == "1 of your rules considered"
          and "Followed" not in body,
          d1=d1.get_by_test_id("considered-text").inner_text() if d1.count() else None)

    # ── 4. B10: the Build step's sheet carries the step's line ─────────────────────────
    step = page.locator('[data-testid="chain-step"][data-step-id="build"] [data-testid="chain-step-open"]')
    try:
        step.first.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-rules-step-missing.png"))
        fail("step-line", f"r-pay-2's Build step is not openable: {e}")
    step.first.click()
    step_line = page.locator('[data-testid="considered-line"][data-subject="step"]')
    try:
        step_line.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-rules-step-missing.png"))
        fail("step-line", f"the Build step's sheet shows no considered line: {e}")
    step_line.get_by_test_id("considered-toggle").click()
    step_detail = step_line.locator('[data-testid="considered-row"][data-verdict="cited"] [data-testid="considered-row-detail"]').inner_text()
    page.screenshot(path=str(SHOTS / "desk-rules-step.png"))
    check("step-line", step_line.get_attribute("data-key") == "considered:r-pay-2:1:0"
          and step_line.get_by_test_id("considered-text").inner_text() == "2 of your rules considered · 1 set aside · cited 1 (unchecked)"
          and step_detail == "Cited by the step — unchecked",
          detail=step_detail)
    page.keyboard.press("Escape")

    # ── 5. B11: a row opens the rule on the Rules page ──────────────────────────────────
    d2 = page.locator(LINE.format("considered:chat-pay:d2"))
    if d2.get_attribute("data-open") != "true":
        d2.get_by_test_id("considered-toggle").click()
    d2.locator('[data-testid="considered-row"][data-verdict="cited"] [data-testid="considered-row-open"]').click()
    page.wait_for_function("() => location.pathname === '/steering/policies' && location.search.includes('rule=proposal%3Apr-auto')", timeout=8000)
    drawer = page.get_by_test_id("steering-rule-drawer")
    try:
        drawer.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-rules-page-missing.png"))
        fail("rule-page", f"the rule drawer did not open from the row: {e}")
    sentence = drawer.get_by_test_id("rule-sentence").inner_text()
    check("rule-page", sentence == "A Development rule for upload-endpoint — helpers are told about it when it applies; it never blocks."
          and drawer.get_by_test_id("steering-rule-statement").inner_text() == "Always check the payment provider’s records, not just our database",
          sentence=sentence)

    # ── 6. B11: ORIGIN from the ledger, and the history ─────────────────────────────────
    origin_block = drawer.get_by_test_id("rule-origin")
    try:
        origin_block.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-rules-origin-missing.png"))
        fail("rule-origin", f"no ORIGIN block on the rule page: {e}")
    words = origin_block.get_by_test_id("rule-origin-words").inner_text()
    meta = origin_block.get_by_test_id("rule-origin-meta").inner_text()
    where_link = origin_block.get_by_test_id("rule-origin-where")
    history = [drawer.locator('[data-testid="rule-history-row"]').nth(i).inner_text()
               for i in range(drawer.locator('[data-testid="rule-history-row"]').count())]
    check("rule-origin", origin_block.get_attribute("data-decision-id") == "dec-auto"
          and words == "“from now on, always check the payment provider’s records, not just our database”"
          and meta.startswith("operator · ") and "remembered on the spot" in meta
          and where_link.inner_text() == "in a conversation →" and where_link.get_attribute("href") == "/s/chat-pay"
          and any("Remembered — remembered on the spot" in h for h in history),
          words=words, meta=meta, history=history)

    # ── 7. B11: where it was considered — the turns and the step read this session ─────
    where = drawer.get_by_test_id("rule-where")
    # The rows come from the Considerations read this session (the conversation's turns, folded into ONE
    # row named by the conversation's title, + the Build step); wait for the turn count to settle.
    page.wait_for_function("() => [...document.querySelectorAll('[data-testid=\"rule-where-row\"][data-kind=\"chat\"]')].some((r) => / · 6 turns$/.test(r.querySelector('[data-testid=\"rule-where-open\"]')?.textContent ?? ''))", timeout=10000)
    where_rows = where.locator('[data-testid="rule-where-row"]')
    kinds = [(where_rows.nth(i).get_attribute("data-kind"), where_rows.nth(i).get_attribute("data-verdict"),
              where_rows.nth(i).get_by_test_id("rule-where-open").inner_text()) for i in range(where_rows.count())]
    unit_rows = [k for k in kinds if k[0] == "unit"]
    drawer.screenshot(path=str(SHOTS / "desk-rules-page.png"))
    check("rule-where", where.get_attribute("data-count") == str(len(kinds)) and len(kinds) == 2
          and [k for k in kinds if k[0] == "chat"] == [("chat", "cited", "Find why checkout charges twice · 6 turns")]
          and unit_rows == [("unit", "cited", "Fix the double charge on checkout, then show me · Build")]
          and where.locator('[data-testid="rule-where-empty"]').count() == 0,
          rows=kinds)
    where.locator('[data-testid="rule-where-row"][data-kind="unit"] [data-testid="rule-where-step"]').click()
    try:
        page.locator('[data-testid="considered-line"][data-subject="step"]').wait_for(state="visible", timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-rules-where-step-missing.png"))
        fail("rule-where-step", f"look underneath did not open the step's sheet: {e}")
    check("rule-where-step", page.locator('[data-testid="considered-line"][data-subject="step"]').get_attribute("data-key") == "considered:r-pay-2:1:0")
    page.keyboard.press("Escape")

    # ── 8. N7: no Hold control on a decision rule ───────────────────────────────────────
    check("no-hold", page.get_by_text("Hold work to it").count() == 0
          and "Followed" not in page.evaluate("() => document.body.innerText"))

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
