#!/usr/bin/env python3
"""
desk_proposal_test.py — S6b (DES-STUDIO-REBUILD-001 §11): the proposal card, the status sentence,
the sources and the deliver card, at 1440x700 on the Desk.

Drives the built UI against the in-process fixture's sessions corpus plus `ship_proposals` (chat-ship:
r-ship-plan waiting at its plan gate, r-ship-deliver waiting at its deliver gate, and a helper
reply whose citations record confirms three places) and proves:

  1. THE PROPOSAL: r-ship-plan's card says the plan in one sentence ("Here's the plan: … (4
     steps).") with Go / Not now — no rev, unit, band or mode — under the run's one status
     sentence ("Waiting on your go for the plan").
  2. NOT NOW sends nothing; the proposal is kept, and "Bring it back" restores it.
  3. REFUSED: with the daemon refusing the plan (400 + reason), a DOUBLE click on Go posts the gate
     ONCE (after the 10 s undo window); the card says "Didn't work" with the reason and keeps its
     buttons. Try again, accepted, posts exactly once more and the card reads "Going".
  4. DELIVER: r-ship-deliver's card says the deliver unit's target in one plain sentence (studio#444); Deliver asks
     "Are you sure? This leaves studio."; Cancel sends nothing; Yes posts approve exactly once.
  5. SOURCES: the reply shows "Based on 3 sources" (the unverified citation is not a source); the
     corrected chip's hover names where it really is; a chip opens the passage with the cited line
     highlighted (read through GET /runs/:id/files), and Back closes it; a place no run can read
     says so and shows no text.
  6. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-proposal*.png. Env: FEEDBACK_PORT (default 4348).
"""

import json
import os
import re
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4348"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
UNDO_S = 10.0

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


def posts(run_id: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as r:
        return [p for p in json.loads(r.read())["posts"] if p["runId"] == run_id]


from playwright.sync_api import sync_playwright  # noqa: E402

CARD = '[data-testid="session-proposal"][data-run-id="{}"]'
SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, sessions=True, run_chat_id=True, ship_proposals=True, proposal_refuse=False,
                extra_frames=[], reset_gate_posts=True)
    page.goto(f"{origin}/s/chat-ship", wait_until="networkidle")
    plan = page.locator(CARD.format("r-ship-plan"))
    try:
        plan.wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            f"() => document.querySelector('{CARD.format('r-ship-plan')}')?.dataset.state === 'ask'", timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-proposal-missing.png"))
        fail("proposal-renders", f"no proposal card for r-ship-plan: {e}")
    page.screenshot(path=str(SHOTS / "desk-proposal.png"))

    # ── 1. the proposal, in one sentence, under the status sentence ───────────────
    text = plan.get_by_test_id("session-proposal-text").inner_text()
    status = page.locator('[data-testid="session-run"][data-run-id="r-ship-plan"] [data-testid="session-status-sentence"]').inner_text()
    buttons = [plan.get_by_test_id("session-proposal-go").inner_text(), plan.get_by_test_id("session-proposal-not-now").inner_text()]
    tech = re.findall(r"\b(?:rev|unit|band|mode|understand)\b", text.lower())
    check("proposal-one-sentence", text.startswith("Here’s the plan:") and "(4 steps)" in text and not tech
          and status.startswith("Waiting on your go for the plan") and buttons == ["Go", "Not now"],
          text=text, status=status, buttons=buttons, tech=tech)

    # ── 2. Not now sends nothing; Bring it back ───────────────────────────────────
    plan.get_by_test_id("session-proposal-not-now").click()
    page.wait_for_function(f"() => document.querySelector('{CARD.format('r-ship-plan')}')?.dataset.state === 'no'", timeout=5000)
    no_text = plan.get_by_test_id("session-proposal-no").inner_text()
    page.wait_for_timeout(500)
    sent_after_no = len(posts("r-ship-plan"))
    plan.get_by_test_id("session-proposal-bring-back").click()
    page.wait_for_function(f"() => document.querySelector('{CARD.format('r-ship-plan')}')?.dataset.state === 'ask'", timeout=5000)
    check("not-now-sends-nothing", no_text == "Not now — nothing was sent; the question stays open and the run waits for you." and sent_after_no == 0,
          text=no_text, posts=sent_after_no)

    # ── 3. refused: a double click posts once; the reason, the buttons kept ───────
    set_fixture(origin, proposal_refuse=True)
    plan.get_by_test_id("session-proposal-go").dblclick()
    page.wait_for_function(f"() => document.querySelector('{CARD.format('r-ship-plan')}')?.dataset.state === 'run'", timeout=5000)
    deadline = time.time() + UNDO_S + 8
    while time.time() < deadline and not posts("r-ship-plan"):
        page.wait_for_timeout(250)
    try:
        page.wait_for_function(f"() => document.querySelector('{CARD.format('r-ship-plan')}')?.dataset.state === 'fail'", timeout=8000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-proposal-refused-missing.png"))
    page.wait_for_timeout(800)
    refused = posts("r-ship-plan")
    reason = plan.get_by_test_id("session-proposal-reason").inner_text() if plan.get_by_test_id("session-proposal-reason").count() else None
    kept = plan.get_by_test_id("session-proposal-go").count() == 1 and plan.get_by_test_id("session-proposal-not-now").count() == 1
    page.screenshot(path=str(SHOTS / "desk-proposal-refused.png"))
    check("refused-once-reason-buttons-kept", len(refused) == 1 and refused[0]["body"].get("approve") is True
          and reason is not None and "plan refused" in reason and kept,
          posts=len(refused), reason=reason, kept=kept)

    set_fixture(origin, proposal_refuse=False)
    plan.get_by_test_id("session-proposal-go").click()
    deadline = time.time() + UNDO_S + 8
    while time.time() < deadline and len(posts("r-ship-plan")) < 2:
        page.wait_for_timeout(250)
    page.wait_for_timeout(800)
    accepted = posts("r-ship-plan")
    state = page.evaluate(f"() => document.querySelector('{CARD.format('r-ship-plan')}')?.dataset.state ?? null")
    check("try-again-posts-once", len(accepted) == 2 and state == "run", posts=len(accepted), state=state)

    # ── 4. the deliver card and the one "Are you sure?" ───────────────────────────
    deliver = page.locator(CARD.format("r-ship-deliver"))
    deliver.scroll_into_view_if_needed()
    why = deliver.get_by_test_id("session-proposal-why").inner_text()
    deliver.get_by_test_id("session-proposal-go").click()
    deliver.get_by_test_id("session-proposal-confirm").wait_for(state="visible", timeout=5000)
    sure = deliver.get_by_test_id("session-proposal-confirm").inner_text()
    page.screenshot(path=str(SHOTS / "desk-proposal-deliver-confirm.png"))
    deliver.get_by_test_id("session-proposal-confirm-cancel").click()
    page.wait_for_timeout(400)
    after_cancel = len(posts("r-ship-deliver"))
    state_cancel = page.evaluate(f"() => document.querySelector('{CARD.format('r-ship-deliver')}')?.dataset.state ?? null")
    deliver.get_by_test_id("session-proposal-go").click()
    deliver.get_by_test_id("session-proposal-confirm-yes").focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    focus_after_yes = page.evaluate("() => document.activeElement?.dataset?.testid ?? null")
    deadline = time.time() + UNDO_S + 8
    while time.time() < deadline and not posts("r-ship-deliver"):
        page.wait_for_timeout(250)
    page.wait_for_timeout(800)
    delivered = posts("r-ship-deliver")
    check("deliver-are-you-sure",
          why == "Pushes your changes as a new branch to acme/shop on GitHub and opens a pull request there. Merging stays yours."
          and "Are you sure? This leaves studio." in sure and why in sure
          and after_cancel == 0 and state_cancel == "ask"
          and len(delivered) == 1 and delivered[0]["body"].get("approve") is True and focus_after_yes == "session-proposal",
          why=why, sure=sure, after_cancel=after_cancel, state_cancel=state_cancel, posts=len(delivered),
          focus_after_yes=focus_after_yes)

    # ── 5. sources ────────────────────────────────────────────────────────────────
    src = page.get_by_test_id("session-sources")
    src.scroll_into_view_if_needed()
    chips = page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-source"]')]
      .map(c => ({label: c.innerText, title: c.title}))""")
    line = src.inner_text()
    page.locator('[data-testid="session-source"][data-source="src/checkout.ts:12"]').click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"session-passage\"]')?.dataset.state === 'shown'", timeout=8000)
    hit = page.evaluate("() => document.querySelector('[data-testid=\"session-passage\"] [data-hit=\"true\"]')?.innerText ?? null")
    page.screenshot(path=str(SHOTS / "desk-proposal-passage.png"))
    page.get_by_test_id("session-passage-back").focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    closed = page.get_by_test_id("session-passage").count() == 0
    focus_back = page.evaluate("() => document.activeElement?.dataset?.source ?? null")
    page.locator('[data-testid="session-source"][data-source="src/cart/Banner.tsx"]').click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"session-passage\"]')?.dataset.state === 'unreadable'", timeout=8000)
    unreadable = page.get_by_test_id("session-passage-unreadable").inner_text()
    check("sources",
          line.startswith("Based on 3 sources")
          and [c["label"] for c in chips] == ["checkout.ts:12", "Banner.tsx", "total.ts:7"]
          and "the reply said src/cart/total.ts:3" in chips[2]["title"]
          and hit is not None and "FREE_SHIPPING_OVER" in hit and closed and focus_back == "src/checkout.ts:12"
          and unreadable.startswith("Studio can’t open this here"),
          line=line, chips=chips, hit=hit, closed=closed, focus_back=focus_back, unreadable=unreadable)

    # ── 6. studio#575: the hand-over's receipt links the pull request it opened ─────
    # Step 4 approved r-ship-deliver's hand-over here (the POST landed). The daemon now finishes the
    # run and reports the PR: the fixture flips the run to completed + delivered and pushes a
    # lifecycle frame so the app re-reads the list. The receipt — "Finished · delivered" — then
    # carries `Pull request ↗` (the Handed-over row's link) where the operator approved it.
    SHIP_PR = "https://github.com/acme/shop/pull/42"
    set_fixture(origin, status_over={"r-ship-deliver": "completed"},
                session_over={"r-ship-deliver": {"delivery": "delivered", "deliverUrl": SHIP_PR}},
                extra_frames=[{"type": "unitDone", "session": "r-ship-deliver", "ord": 4,
                               "ts": int(time.time() * 1000), "seq": 9001}])
    try:
        page.wait_for_function(
            f"() => document.querySelector('{CARD.format('r-ship-deliver')}')?.dataset.state === 'done'", timeout=25000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-proposal-delivered-missing.png"))
        fail("delivered-receipt", {"why": f"the hand-over card never reached its receipt: {e}",
                                   "state": page.evaluate(f"() => document.querySelector('{CARD.format('r-ship-deliver')}')?.dataset.state ?? null")})
    pr_link = deliver.get_by_test_id("session-proposal-pr")
    outcome = deliver.get_by_test_id("session-proposal-outcome").inner_text()
    check("delivered-receipt", outcome == "Finished · delivered" and pr_link.count() == 1
          and pr_link.get_attribute("href") == SHIP_PR and pr_link.get_attribute("target") == "_blank"
          and pr_link.inner_text() == "Pull request ↗" and deliver.get_by_test_id("session-proposal-branch").count() == 0,
          outcome=outcome, href=pr_link.get_attribute("href") if pr_link.count() else None)
    page.screenshot(path=str(SHOTS / "desk-proposal-delivered.png"))

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
