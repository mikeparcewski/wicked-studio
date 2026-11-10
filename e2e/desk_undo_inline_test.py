#!/usr/bin/env python3
"""
desk_undo_inline_test.py — studio 0.16.4 (operator: "Still seeing the extra modal for undo"): a queued
decision's countdown, what-will-happen line, page-close note, Undo and result render INLINE, in the block
where it was taken. There is no floating toast: a MutationObserver records any `undo-toast`, or any
inline Undo laid out `position: fixed`, that EVER mounts during the run. Each step fails on main, where the
only Undo is the toast.

  1. GATE CARD  /s/run%3Ab1: Approve → the gate row holds the inline Undo ("Approving … in 10 s", the
                preview, the close note, Undo); Undo → zero POSTs, the gate stays open. Approve again and
                let it run → exactly one POST, and the "Approved …" result is inline on the same card.
  1b. ONE UNDO  /needs: the inbox lists b1 and reads its gate card beside it; approving in the card shows ONE
                Undo on the page, on the card, and the list row reads the quiet "Waiting to send · N s".
  2. PROPOSAL   /s/chat-ship: Go on r-ship-plan's card → exactly ONE Undo button on the page, on that card;
                every other block on the page showing that run's gate reads the quiet "Waiting to send" line.
                Refused (proposal_refuse): the card says it in its own words ("Didn't work" + the reason, beside
                Try again), once — no second failure line under it.
  3. BATCH      /needs, the approvals group: Approve all → "Approving 2 gates in 10 s" inline under the
                group row; Undo → zero POSTs. A member crew refuses (409): "1 of 2 … 1 failed" inline under the
                group, still there 10 s later; Dismiss removes it.
  4. 390x844    the gate card's inline Undo fits the phone width (no horizontal scroll).
  5. 0 page errors; no `undo-toast` and no fixed-position Undo ever mounted.

Shots: e2e/shots/desk-undo-inline-*.png. Env: FEEDBACK_PORT (default 4621). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, OPEN_RUN_DETAILS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4621"))
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


# Any floating Undo that EVER mounts is counted (a whole-run fact, not a sample); sessionStorage survives the
# navigations below.
WATCH_TOASTS = """
  new MutationObserver(() => {
    const toast = document.querySelector('[data-testid="undo-toast"]');
    const fixed = [...document.querySelectorAll('[data-testid="inline-undo"]')]
      .some((n) => { for (let e = n; e; e = e.parentElement) { if (getComputedStyle(e).position === 'fixed') return true; } return false; });
    if (toast || fixed) sessionStorage.setItem('floating-undo', String(Number(sessionStorage.getItem('floating-undo') || '0') + 1)
      + ':' + location.pathname + (toast ? ':toast' : ':fixed'));
  }).observe(document, { childList: true, subtree: true });
"""

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
seen_all: list[str] = []


def new_page(browser, w: int = W, h: int = H):
    page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(OPEN_RUN_DETAILS)
    page.add_init_script(WATCH_TOASTS)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return page


def floating(page) -> str:
    return page.evaluate("() => sessionStorage.getItem('floating-undo') || ''")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── 1. the gate card ───────────────────────────────────────────────────────────
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={},
                extra_gates=[], reset_gate_posts=True)
    page = new_page(browser)
    page.goto(f"{origin}/s/run%3Ab1", wait_until="networkidle")
    APPROVE = '[data-testid="session-gate-choice"][data-choice-key="approve"]'
    page.locator(APPROVE).wait_for(state="visible", timeout=15000)
    row = page.get_by_test_id("session-gate-row")
    page.locator(APPROVE).click()
    page.get_by_test_id("session-gate-confirm").click()
    pressed = time.monotonic()
    try:
        row.get_by_test_id("inline-undo").wait_for(state="visible", timeout=4000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-undo-inline-missing.png"))
        fail("gate-inline", {"why": "no inline Undo on the gate card", "floating": floating(page)})
    head = row.get_by_test_id("inline-undo-headline").inner_text()
    preview = row.get_by_test_id("inline-undo-preview").inner_text()
    close = row.get_by_test_id("inline-undo-close-note").inner_text()
    page.screenshot(path=str(SHOTS / "desk-undo-inline-gate.png"))
    check("gate-inline", head.startswith("Approving ") and " in " in head and preview != "" and "nothing is sent" in close
          and page.get_by_test_id("inline-undo-button").count() == 1,
          head=head, preview=preview, close=close)
    page.wait_for_timeout(2000)
    later = row.get_by_test_id("inline-undo-headline").inner_text()
    live = row.get_by_test_id("inline-undo-live").inner_text()
    check("gate-counts-down-live-once", later != head and "You can undo it until it sends." in live, head=head, later=later, live=live)
    row.get_by_test_id("inline-undo-button").click()
    page.wait_for_timeout(max(0, int((pressed + UNDO_S + 2 - time.monotonic()) * 1000)))
    check("gate-undo-sends-nothing", posts("b1") == [] and page.locator(APPROVE).count() == 1,
          posts=posts("b1"))

    page.locator(APPROVE).click()
    page.get_by_test_id("session-gate-confirm").click()
    pressed = time.monotonic()
    while time.monotonic() < pressed + UNDO_S + 6 and not posts("b1"):
        page.wait_for_timeout(250)
    try:
        page.get_by_test_id("inline-undo-result").first.wait_for(state="visible", timeout=4000)
        result = page.get_by_test_id("inline-undo-result").first
        res = (result.inner_text(), result.get_attribute("data-kind"),
               result.evaluate("n => n.closest('[data-undo-host]')?.dataset.undoHost ?? null"))
    except Exception:  # noqa: BLE001
        res = (None, None, None)
    page.screenshot(path=str(SHOTS / "desk-undo-inline-gate-sent.png"))
    check("gate-sent-result-inline", len(posts("b1")) == 1 and res[1] == "sent" and (res[0] or "").startswith("Approved")
          and res[2] == "gate-card", posts=len(posts("b1")), result=res)
    seen_all.append(floating(page))
    page.close()

    # ── 1b. one Undo per page: the inbox lists b1 AND reads its gate card beside it ───────────
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={}, extra_gates=[], reset_gate_posts=True)
    page = new_page(browser)
    page.goto(f"{origin}/needs", wait_until="networkidle")
    item = page.locator('[data-testid="need-row"][data-key="gate:b1"]')
    item.wait_for(state="visible", timeout=15000)
    item.get_by_test_id("desk-inbox-row").click()
    pane = page.get_by_test_id("desk-inbox-gate")
    pane.locator(APPROVE).wait_for(state="visible", timeout=10000)
    pane.locator(APPROVE).click()
    pane.get_by_test_id("session-gate-confirm").click()
    pane.get_by_test_id("inline-undo").wait_for(state="visible", timeout=4000)
    page.wait_for_timeout(300)
    hosts = page.evaluate("""() => [...document.querySelectorAll('[data-testid="inline-undo-host"]')]
      .filter((n) => (n.dataset.undoKeys || '').split(' ').includes('gate:b1'))
      .map((n) => ({ host: n.dataset.undoFor, fallback: n.dataset.undoFallback === 'true',
                     full: !!n.querySelector('[data-testid="inline-undo-button"]'),
                     quiet: (n.querySelector('[data-testid="inline-undo-quiet"]')?.textContent) ?? null }))""")
    page.screenshot(path=str(SHOTS / "desk-undo-inline-one-per-page.png"))
    check("inbox-one-undo-per-page", page.get_by_test_id("inline-undo-button").count() == 1
          and pane.get_by_test_id("inline-undo-button").count() == 1 and len(hosts) >= 2
          # A fallback block (where a row WAS) says nothing while the row is on screen.
          and all(h["quiet"] is not None and h["quiet"].startswith("Waiting to send") for h in hosts if not h["full"] and not h["fallback"])
          and all(h["quiet"] is None and not h["full"] for h in hosts if h["fallback"]),
          hosts=hosts)
    pane.get_by_test_id("inline-undo-button").click()
    page.wait_for_timeout(500)
    check("inbox-undo-sends-nothing", posts("b1") == [], posts=posts("b1"))
    seen_all.append(floating(page))
    page.close()

    # ── 4. the phone width ─────────────────────────────────────────────────────────
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], reset_gate_posts=True)
    page = new_page(browser, 390, 844)
    page.goto(f"{origin}/s/run%3Ab1", wait_until="networkidle")
    page.locator(APPROVE).wait_for(state="visible", timeout=15000)
    page.locator(APPROVE).click()
    page.get_by_test_id("session-gate-confirm").click()
    page.get_by_test_id("inline-undo").wait_for(state="visible", timeout=4000)
    page.wait_for_timeout(300)
    box = page.get_by_test_id("inline-undo").bounding_box()
    scroll = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    page.screenshot(path=str(SHOTS / "desk-undo-inline-gate-390.png"))
    check("phone-fits", box is not None and box["x"] >= 0 and box["x"] + box["width"] <= 390 and scroll <= 0,
          box=box, scroll=scroll)
    page.get_by_test_id("inline-undo-button").click()
    seen_all.append(floating(page))
    page.close()

    # ── 2. the proposal card: one Undo per page, and a failure that stays ─────────
    CARD = '[data-testid="session-proposal"][data-run-id="r-ship-plan"]'
    set_fixture(origin, wave1=False, gate_now=[], gate_simple=[], sessions=True, run_chat_id=True,
                ship_proposals=True, proposal_refuse=False, extra_frames=[], reset_gate_posts=True)
    page = new_page(browser)
    page.goto(f"{origin}/s/chat-ship", wait_until="networkidle")
    card = page.locator(CARD)
    card.wait_for(state="visible", timeout=15000)
    page.wait_for_function(f"() => document.querySelector('{CARD}')?.dataset.state === 'ask'", timeout=10000)
    card.get_by_test_id("session-proposal-go").click()
    card.get_by_test_id("inline-undo").wait_for(state="visible", timeout=4000)
    hosts = page.evaluate("""() => [...document.querySelectorAll('[data-testid="inline-undo-host"]')]
      .filter((n) => (n.dataset.undoKeys || '').split(' ').includes('gate:r-ship-plan'))
      .map((n) => ({ host: n.dataset.undoFor, fallback: n.dataset.undoFallback === 'true',
                     full: !!n.querySelector('[data-testid="inline-undo-button"]'),
                     quiet: !!n.querySelector('[data-testid="inline-undo-quiet"]') }))""")
    page.screenshot(path=str(SHOTS / "desk-undo-inline-proposal.png"))
    buttons = page.get_by_test_id("inline-undo-button").count()
    others_quiet = all(h["quiet"] for h in hosts if not h["full"] and not h["fallback"])
    check("one-undo-per-page", buttons == 1 and card.get_by_test_id("inline-undo-button").count() == 1 and others_quiet,
          buttons=buttons, hosts=hosts)
    card.get_by_test_id("inline-undo-button").click()
    page.wait_for_timeout(500)

    set_fixture(origin, proposal_refuse=True)
    card.get_by_test_id("session-proposal-go").click()
    deadline = time.time() + UNDO_S + 8
    while time.time() < deadline and not posts("r-ship-plan"):
        page.wait_for_timeout(250)
    try:
        page.wait_for_function(f"() => document.querySelector('{CARD}')?.dataset.state === 'fail'", timeout=8000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-undo-inline-failed-missing.png"))
        fail("failed-on-card", {"why": "the proposal card did not say the refusal", "posts": len(posts("r-ship-plan"))})
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "desk-undo-inline-failed.png"))
    # The card says the refusal in its own words beside Try again; the same failure is not said twice under it.
    reason = card.get_by_test_id("session-proposal-reason").inner_text()
    twice = card.locator('[data-testid="inline-undo-result"][data-kind="failed"]').count()
    page.wait_for_timeout(10_000)
    check("failed-said-once-on-card", "plan refused" in reason and twice == 0
          and card.get_by_test_id("session-proposal-reason").count() == 1, reason=reason, twice=twice)
    set_fixture(origin, proposal_refuse=False, sessions=False, run_chat_id=False, ship_proposals=False)
    seen_all.append(floating(page))
    page.close()

    # ── 3. a batch decision: the approvals group ──────────────────────────────────
    GROUP = '[data-testid="need-row"][data-key="group:approval"]'
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={},
                extra_frames=[], reset_gate_posts=True)
    page = new_page(browser)
    page.goto(f"{origin}/needs", wait_until="networkidle")
    group = page.locator(GROUP)
    group.wait_for(state="visible", timeout=15000)
    group.get_by_test_id("need-group-approve-all").click()
    pressed = time.monotonic()
    group.get_by_test_id("inline-undo").wait_for(state="visible", timeout=4000)
    head = group.get_by_test_id("inline-undo-headline").inner_text()
    page.screenshot(path=str(SHOTS / "desk-undo-inline-batch.png"))
    group.get_by_test_id("inline-undo-button").click()
    page.wait_for_timeout(max(0, int((pressed + UNDO_S + 2 - time.monotonic()) * 1000)))
    check("batch-inline-undo", head == "Approving 2 gates in 10 s" and posts("g1") == [] and posts("g2") == [],
          head=head, g1=posts("g1"), g2=posts("g2"))

    # A batch whose member crew refuses: the failure is inline under the group, and stays until it is dismissed.
    set_fixture(origin, gate_409=["g1"], reset_gate_posts=True)
    group.get_by_test_id("need-group-approve-all").click()
    pressed = time.monotonic()
    failed = group.locator('[data-testid="inline-undo-result"][data-kind="failed"]')
    try:
        failed.wait_for(state="visible", timeout=int((UNDO_S + 8) * 1000))
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-undo-inline-batch-failed-missing.png"))
        fail("batch-failed-inline", {"why": "no failed result under the group", "g1": posts("g1"), "g2": posts("g2")})
    words = failed.inner_text()
    page.screenshot(path=str(SHOTS / "desk-undo-inline-batch-failed.png"))
    # Said ONCE on the page, in studio's words: the job by name, never the gate id or the wire sentence; one Retry style.
    members = page.get_by_test_id("need-group-failure")
    member = members.first.inner_text() if members.count() else ""
    check("batch-failed-said-once", members.count() == 1 and "no longer waiting for that answer" in member
          and "g1 (" not in member and "not awaiting a human gate" not in member.split("Technical details")[0]
          and page.get_by_test_id("need-group-retry").first.inner_text() == "Retry",
          count=members.count(), member=member)
    page.wait_for_timeout(10_000)
    stays = failed.count() == 1
    group.get_by_test_id("inline-undo-dismiss").click()
    page.wait_for_timeout(300)
    check("batch-failed-stays-until-dismissed", "Couldn’t send 1" in words and stays and failed.count() == 0, words=words, stays=stays)
    set_fixture(origin, gate_409=[])
    seen_all.append(floating(page))
    page.close()
    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], reset_gate_posts=True)

    check("no-floating-undo", all(x == "" for x in seen_all), floating=seen_all)
    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
