#!/usr/bin/env python3
"""
desk_decisions_test.py — DC-S6 (DES-DECISION-CAPTURE §9): the decision line, the Remember chip, the
Needs You rule row and the Desk sentence, at 1440x700 on the Desk.

Drives the built UI against the in-process fixture's sessions corpus plus `decisions` (chat-pay's
transcript grows one operator turn per scene, each with crew's `decisions` record; GET /decisions
and the five POST verbs on the DC-S4a wire) and proves B1–B4, B6–B9 and B12:

  1. B12  the offered decision's review proposal sits in Needs You as a rule in the operator's words.
  2. B1   rule-auto (scene 26): "Remembered for upload-endpoint: ‘Always check …’" under the message, with Undo.
  3. B4   Undo posts once and reads "Not remembered".
  4. B2   rule-offer (scene 27): one Remember chip — the derived rule, its type, the project; nothing
          stored until the click; Remember posts once and the line becomes "Remembered for …".
  5. B3   never-mind (scene 44): the turn shows no line at all.
  6. B6   "lets do it" after a seat's proposal: a chip with "You approved: …" quoted under it.
  7. B7   a restatement asks "Same as your rule?"; Same posts and reads "Already in force".
  8. B8   decided in two projects: "Make it apply everywhere" posts widen and reads "Remembered everywhere".
  9. LIVE a chatDecisions frame over /ws puts the line under a turn that had none.
 10. RELOAD restores every line from the transcript's `decisions` records.
 11. Q1   a clear rule under auth=off is the chip, never auto.
 12. B9   desk-rule (scene 47): the Desk says "One new rule for upload-endpoint, from your words — see it".
 13. LEDGER under WICKED_DECISIONS=ledger nothing is drawn.
 14. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-decisions*.png. Env: FEEDBACK_PORT (default 4356).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4356"))
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


def posts(verb: str | None = None) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/decision-posts", timeout=10) as r:
        rows = json.loads(r.read())["posts"]
    return [p for p in rows if verb is None or p["verb"] == verb]


from playwright.sync_api import sync_playwright  # noqa: E402

LINE = '[data-testid="decision-line"][data-decision-id="{}"]'
SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    looked_at = int(time.time() * 1000) - 90 * 60 * 1000  # last looked 90 min ago: before every decision
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});"
        f"if (!localStorage.getItem('studio.visit')) localStorage.setItem('studio.visit', JSON.stringify({{lastSeenAt: {looked_at}, handover: null}}));")

    # `steering_rules`: GET /governance/rules serves the corpus plus what a Remember lands (S12: "see it" opens that rule).
    set_fixture(origin, sessions=True, run_chat_id=True, decisions=True, decisions_mode="on", steering_rules=True, extra_frames=[], reset_decisions=True)

    # ── 1. B12: the review proposal is a Needs You row in the operator's words ─────────
    page.goto(f"{origin}/", wait_until="networkidle")
    row = page.locator('[data-testid="need-row"]').filter(has_text="From your words")
    try:
        row.first.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-decisions-needs-missing.png"))
        fail("needs-you-rule-row", f"no 'From your words' row on the Desk: {e}")
    row_text = row.first.locator('[data-testid="need-line"]').inner_text()
    page.screenshot(path=str(SHOTS / "desk-decisions-needs.png"))
    check("needs-you-rule-row", row_text.startswith("From your words — Remember lands a design-ux rule")
          and "Demos for the panel should feel calmer" in row_text, text=row_text)

    # ── 2. B1: rule-auto ────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    auto = page.locator(LINE.format("dec-auto"))
    try:
        auto.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-decisions-missing.png"))
        fail("rule-auto", f"no decision line for dec-auto: {e}")
    auto.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-decisions-auto.png"))
    auto_text = auto.get_by_test_id("decision-text").inner_text()
    under_you = page.evaluate(
        "() => document.querySelector('[data-testid=\"decision-line\"][data-decision-id=\"dec-auto\"]')"
        "?.closest('[data-testid=\"session-turn\"]')?.dataset.who")
    check("rule-auto", auto.get_attribute("data-kind") == "remembered"
          and auto_text == "Remembered for upload-endpoint: ‘Always check the payment provider’s records, not just our database.’"
          and under_you == "you" and auto.get_by_test_id("decision-undo").count() == 1,
          text=auto_text, under=under_you)

    # ── 3. B4: Undo ─────────────────────────────────────────────────────────────────────
    auto.get_by_test_id("decision-undo").click()
    page.wait_for_function(f"() => document.querySelector('{LINE.format('dec-auto')}')?.dataset.state === 'undone'", timeout=8000)
    undone = auto.get_by_test_id("decision-text").inner_text()
    check("undo", undone == "Not remembered" and len(posts("undo")) == 1 and posts("undo")[0]["id"] == "dec-auto",
          text=undone, posts=posts("undo"))

    # ── 4. B2: rule-offer, the chip, Remember posts once ────────────────────────────────
    offer = page.locator(LINE.format("dec-offer"))
    offer.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-decisions-offer.png"))
    rule = offer.get_by_test_id("decision-rule").inner_text()
    scope = offer.get_by_test_id("decision-scope").inner_text()
    sent_before = len(posts("remember"))
    offer.get_by_test_id("decision-remember").dblclick()
    page.wait_for_function(f"() => document.querySelector('{LINE.format('dec-offer')}')?.dataset.state === 'remembered'", timeout=8000)
    page.wait_for_timeout(400)
    remembered = offer.get_by_test_id("decision-text").inner_text()
    check("rule-offer", offer.get_attribute("data-kind") == "remembered" and rule == "‘Demos for the panel should feel calmer.’"
          and scope == "Design/UX · for upload-endpoint" and sent_before == 0 and len(posts("remember")) == 1
          and remembered.startswith("Remembered for upload-endpoint: ‘Demos for the panel should feel calmer.’"),
          rule=rule, scope=scope, remembered=remembered, posts=posts("remember"))

    # ── 5. B3: never mind ───────────────────────────────────────────────────────────────
    turn3 = page.locator('[data-testid="session-turn"][data-who="you"]').filter(has_text="never mind, skip that for now")
    check("never-mind", turn3.count() == 1 and page.locator(LINE.format("dec-none")).count() == 0
          and turn3.locator('[data-testid="decision-line"]').count() == 0)

    # ── 6. B6: an approval quotes "You approved" ────────────────────────────────────────
    approve = page.locator(LINE.format("dec-approve"))
    approved = approve.get_by_test_id("decision-approved").inner_text()
    check("approval", approve.get_attribute("data-kind") == "offer" and approved == "You approved: “lets do it”"
          and approve.get_by_test_id("decision-rule").inner_text() == "‘Treat every copy-only change as tests-only.’", approved=approved)

    # ── 7. B7: Same as your rule? → Same → Already in force ─────────────────────────────
    maybe = page.locator(LINE.format("dec-maybe"))
    asked = maybe.get_by_test_id("decision-text").inner_text()
    maybe.get_by_test_id("decision-same").click()
    page.wait_for_function(f"() => document.querySelector('{LINE.format('dec-maybe')}')?.dataset.state === 'restated'", timeout=8000)
    in_force = maybe.get_by_test_id("decision-text").inner_text()
    check("restated", asked == "Same as your rule?" and in_force == "Already in force" and maybe.get_by_test_id("decision-see").count() == 1
          and posts("same")[0]["body"] == {"same": True}, asked=asked, in_force=in_force)

    # ── 8. B8: decided in two projects → Make it apply everywhere ───────────────────────
    widen = page.locator(LINE.format("dec-widen"))
    widen_text = widen.get_by_test_id("decision-text").inner_text()
    widen.get_by_test_id("decision-widen").click()
    page.wait_for_function(f"() => document.querySelector('{LINE.format('dec-widen')}')?.dataset.state === 'widened'", timeout=8000)
    everywhere = widen.get_by_test_id("decision-text").inner_text()
    check("widen", widen_text == "You’ve decided this in 2 projects" and everywhere.startswith("Remembered everywhere")
          and len(posts("widen")) == 1, text=widen_text, after=everywhere)

    # ── 9. LIVE: a chatDecisions frame lands under the turn that had no record ──────────
    with urllib.request.urlopen(f"{origin}/api/v1/decisions?chat=chat-pay", timeout=10) as r:
        live_item = [d for d in json.loads(r.read())["decisions"] if d["id"] == "dec-live"]
    check("live-frame-precondition", page.locator(LINE.format("dec-live")).count() == 0 and len(live_item) == 1)
    set_fixture(origin, extra_frames=[{"type": "chatDecisions", "chat": "chat-pay", "turn_id": "d7", "items": live_item, "project_id": "upload-endpoint"}])
    try:
        page.locator(LINE.format("dec-live")).wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-decisions-live-missing.png"))
        fail("live-frame", f"the chatDecisions frame drew no line: {e}")
    check("live-frame", page.locator(LINE.format("dec-live")).get_attribute("data-kind") == "offer")

    # ── 10. RELOAD restores every line from the transcript ──────────────────────────────
    page.reload(wait_until="networkidle")
    page.locator(LINE.format("dec-offer")).wait_for(state="visible", timeout=15000)
    kinds = {i: page.locator(LINE.format(i)).get_attribute("data-kind") for i in ("dec-auto", "dec-offer", "dec-approve", "dec-maybe", "dec-widen")}
    check("reload-restores", kinds == {"dec-auto": "undone", "dec-offer": "remembered", "dec-approve": "offer", "dec-maybe": "restated", "dec-widen": "remembered"}
          and page.locator(LINE.format("dec-none")).count() == 0, kinds=kinds)

    # ── 11. auth=off: a clear rule is the chip ──────────────────────────────────────────
    authoff = page.locator(LINE.format("dec-authoff"))
    check("auth-off-chip", authoff.get_attribute("data-kind") == "offer" and authoff.get_by_test_id("decision-remember").count() == 1
          and authoff.get_by_test_id("decision-rule").inner_text() == "‘Never push on a Friday.’")

    # ── 12. B9: the Desk's sentence ─────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        page.get_by_test_id("desk-rule-line").wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-decisions-desk-missing.png"))
        fail("desk-rule", f"no desk rule line: {e}")
    page.screenshot(path=str(SHOTS / "desk-decisions-desk.png"))
    desk_line = page.get_by_test_id("desk-rule-line").inner_text()
    page.get_by_test_id("desk-rule-see").click()
    # S12: "see it" lands on the Rules page with THAT rule open — the drawer for the rule the Remember landed,
    # its statement in the operator's words; the address alone (or a missing-rule page) is not enough.
    page.wait_for_function("() => decodeURIComponent(location.pathname) === '/rules/proposal:pr-offer'", timeout=8000)
    try:
        page.get_by_test_id("steering-rule-drawer").wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-decisions-rule-missing.png"))
        fail("desk-rule", f"the remembered rule's drawer did not open from 'see it': {e}")
    statement = page.get_by_test_id("steering-rule-drawer").get_by_test_id("steering-rule-statement").inner_text()
    check("desk-rule", desk_line == "One new rule for upload-endpoint, from your words — see it"
          and statement == "Demos for the panel should feel calmer" and page.get_by_test_id("rules-missing").count() == 0,
          text=desk_line, statement=statement)

    # ── 13. LEDGER: nothing drawn ───────────────────────────────────────────────────────
    set_fixture(origin, decisions_mode="ledger")
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    page.locator('[data-testid="session-turn"][data-who="you"]').first.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    check("ledger-draws-nothing", page.locator('[data-testid="decision-line"]').count() == 0)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
