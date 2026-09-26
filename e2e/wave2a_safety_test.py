#!/usr/bin/env python3
"""
wave2a_safety_test.py — studio wave 2a round 3: A QUEUED DECISION IS ABOUT ONE GATE (1440x700).

REAL 10 s window throughout. Against the `wave1` corpus with a SIMPLE gate waiting on b1 (unit 3).

  label     j, a on the board: the toast reads "Approving beta · b1 in 10 s".
  peek      with that decision queued, P does NOT resurface b1 (nothing else needs you).
  elsewhere the gate is answered elsewhere mid-window (a live `resumed` frame, the run moves on):
            NO POST ever reaches the daemon, and the notice reads "Not sent: … answered elsewhere".
  new gate  fresh page, a again; mid-window a NEW gate opens on b1 (awaitingHuman, unit 4): NO POST,
            the notice says a new gate opened — the old decision is never applied to the new gate.
  ord       fresh page, a, no interference: exactly ONE POST after 10 s, body {approve:true, ord:3}.
  card      on /p/beta/build/b1, Approve on the gate card: the card reads "queued · undo in toast"
            with Approve disabled; its a key then says why it did nothing (a visible notice).

Capture: e2e/shots/wave2a-safety-elsewhere.png, wave2a-safety-newgate.png, wave2a-safety-card.png.
Env: FEEDBACK_PORT (default 4354). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4354"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    # JOURNEY_ALL_STEPS=1 records every step instead of stopping at the first red (red-run evidence).
    if not ok and os.environ.get("JOURNEY_ALL_STEPS") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)


def server_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if p["runId"] == "b1"]


def notice(page) -> str:
    return page.evaluate(
        "() => [...document.querySelectorAll('[data-testid=\"undo-result\"]')].map(n => n.dataset.kind + ': ' + n.textContent).join(' | ')")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)


def board(browser):
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={},
                extra_gates=[], extra_frames=[], reset_gate_posts=True)
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("gate-chip-b1").wait_for(state="visible", timeout=15000)
    return page


def approve_on_board(page) -> float:
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("j")
    page.wait_for_function(
        "() => !!document.querySelector('[data-kbd-item=\"beta\"][data-kbd-selected=\"true\"]')", timeout=5000)
    page.keyboard.press("a")
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
    return time.monotonic()


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── label + peek + answered elsewhere ───────────────────────────────────────
    page = board(browser)
    pressed = approve_on_board(page)
    text = page.get_by_test_id("undo-toast").text_content() or ""
    check("toast-names-the-gate", "Approving beta · b1 in 10 s" in text, text=text)
    page.keyboard.press("p")
    page.get_by_test_id("peek-card").wait_for(state="visible", timeout=3000)
    check("peek-skips-queued-gate", page.get_by_test_id("peek-card").get_attribute("data-run-id") != "b1"
          and page.get_by_test_id("peek-empty").count() == 1,
          peek=page.get_by_test_id("peek-card").get_attribute("data-key"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(max(0, int((pressed + 4.0 - time.monotonic()) * 1000)))
    set_fixture(origin, status_over={"b1": "executing"}, gate_now=[],
                extra_frames=[{"type": "resumed", "session": "b1"}])
    page.wait_for_timeout(max(0, int((pressed + 6.5 - time.monotonic()) * 1000)))  # the frame lands within ~1 s
    page.screenshot(path=str(SHOTS / "wave2a-safety-elsewhere.png"))
    check("elsewhere-notice", "not-sent: Not sent: the gate on beta · b1 was answered elsewhere" in notice(page),
          notice=notice(page))
    page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
    check("elsewhere-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))
    page.close()

    # ── a NEW gate on the same run mid-window ───────────────────────────────────
    page = board(browser)
    pressed = approve_on_board(page)
    page.wait_for_timeout(max(0, int((pressed + 4.0 - time.monotonic()) * 1000)))
    set_fixture(origin, extra_gates=[{"session": "b1", "ord": 4, "prompt": "Approve unit 4 before it runs: ship it"}])
    page.wait_for_timeout(max(0, int((pressed + 6.5 - time.monotonic()) * 1000)))
    page.screenshot(path=str(SHOTS / "wave2a-safety-newgate.png"))
    check("newgate-notice", "not-sent: Not sent: a new gate opened on beta · b1" in notice(page), notice=notice(page))
    page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
    check("newgate-nothing-sent", len(server_posts(origin)) == 0, server=len(server_posts(origin)))
    page.close()

    # ── undisturbed: one POST after 10 s, naming its gate ───────────────────────
    page = board(browser)
    pressed = approve_on_board(page)
    page.wait_for_timeout(max(0, int((pressed + 9.3 - time.monotonic()) * 1000)))
    check("ord-nothing-before-window", len(server_posts(origin)) == 0)
    page.wait_for_timeout(2500)
    posts = server_posts(origin)
    check("ord-one-post-names-gate", len(posts) == 1 and posts[0]["body"] == {"approve": True, "ord": 3},
          posts=[q["body"] for q in posts])
    check("sent-result", "sent: Approved beta · b1." in notice(page), notice=notice(page))
    page.close()

    # ── the gate card shows the shared queued state ─────────────────────────────
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=[], status_over={}, extra_gates=[],
                extra_frames=[], reset_gate_posts=True)
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.goto(f"{origin}/p/beta/build/b1", wait_until="networkidle")
    page.get_by_test_id("steering-approve").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("steering-approve").click()
    try:
        page.get_by_test_id("steering-queued").wait_for(state="visible", timeout=3000)
    except Exception:  # noqa: BLE001 — reported by the check below
        pass
    check("card-queued-state", page.get_by_test_id("steering-queued").count() == 1
          and (page.get_by_test_id("steering-queued").text_content() or "") == "queued · undo in toast"
          and page.get_by_test_id("steering-approve").is_disabled())
    page.get_by_test_id("steering-prompt").focus()
    page.keyboard.press("a")
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "wave2a-safety-card.png"))
    check("card-second-a-not-silent", "not-sent:" in notice(page), notice=notice(page))
    if page.get_by_test_id("undo-toast").count():
        page.get_by_test_id("undo-toast").first.get_by_role("button", name="Undo").click()
    page.wait_for_timeout(500)
    check("card-undo-rearms", page.get_by_test_id("steering-queued").count() == 0
          and page.get_by_test_id("steering-approve").is_enabled())
    page.close()

    set_fixture(origin, wave1=False, gate_now=[], gate_simple=[], status_over={}, reset_gate_posts=True)
    browser.close()

report["ok"] = all(v.get("ok") for v in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
