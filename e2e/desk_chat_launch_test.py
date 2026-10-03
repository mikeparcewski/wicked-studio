#!/usr/bin/env python3
"""
desk_chat_launch_test.py — studio#446: a run launched from a chat lands in that chat's session, at
1440x900 under STUDIO_SKIN=desk. No `chat_id` is seeded: the launch itself carries it.

Drives the built UI against the fixture's sessions corpus (`sessions` + `run_chat_id`; crew's
`capabilities.chatIdOnLaunch` is on) and proves:

  1. PROMOTE: /chat/chat-pay rejoins the chat with its transcript; "Continue in Build" opens the
     composer prefilled, and nothing is launched until Send.
  2. LAUNCH: Send posts ONE `POST /runs` whose body carries `chatId: "chat-pay"`.
  3. SESSION: /s/chat-pay now lists the new run beside the chat's other runs, and the rail's
     chat-pay session counts it — the run is the chat's, not a `run:<id>` session of its own.
  4. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-chat-launch*.png. Env: FEEDBACK_PORT (default 4350).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4350"))
W, H = 1440, 900
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
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


def launches() -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/launch-posts", timeout=10) as r:
        return json.loads(r.read())["posts"]


RAIL = """() => [...document.querySelectorAll('[data-testid="rail-session"]')]
  .map(s => ({id: s.dataset.sessionId, runs: s.dataset.runIds}))"""

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    set_fixture(origin, sessions=True, run_chat_id=True, ship_proposals=False,
                extra_frames=[], reset_gate_posts=True)

    # ── 1. promote from the chat ──────────────────────────────────────────────────
    page.goto(f"{origin}/chat/chat-pay", wait_until="domcontentloaded")
    try:
        page.get_by_test_id("chat-promote").wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-launch-no-promote.png"))
        fail("promote-visible", str(e))
    # The promote carries the seats that replied; a click before the transcript marked claude as
    # replied carries none and Send stays off (main CI 1cf9702). Wait for the replied seat first.
    try:
        page.locator('[data-testid="seat-chip"][data-agent="claude"][data-state="replied"]').wait_for(
            state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-launch-no-seat.png"))
        fail("chat-seat-selected", str(e))
    page.get_by_test_id("chat-promote").click()
    page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=10000)
    problem = page.get_by_test_id("launch-problem").input_value()
    page.wait_for_timeout(800)
    check("promote-prefills", problem.startswith("fix the double charge on checkout, then show me")
          and len(launches()) == 0, problem=problem[:120], launches=len(launches()))
    page.screenshot(path=str(SHOTS / "desk-chat-launch-composer.png"))

    # ── 2. Send: one POST /runs carrying chatId ───────────────────────────────────
    if page.get_by_test_id("preflight-override").count() > 0:
        page.get_by_test_id("preflight-override").click()
    submit = page.get_by_test_id("launch-submit")
    try:
        page.wait_for_function(
            "() => { const b = document.querySelector('[data-testid=\"launch-submit\"]'); return b && !b.disabled; }",
            timeout=20000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-launch-send-off.png"))
        fail("send-enabled", str(e))
    submit.click()
    deadline = time.time() + 10
    while time.time() < deadline and not launches():
        page.wait_for_timeout(200)
    if page.get_by_test_id("preflight-override").count() > 0 and not launches():
        page.get_by_test_id("preflight-override").click()
        deadline = time.time() + 10
        while time.time() < deadline and not launches():
            page.wait_for_timeout(200)
    page.wait_for_timeout(600)
    posted = launches()
    check("launch-carries-chat-id", len(posted) == 1 and posted[0].get("chatId") == "chat-pay",
          posts=[{k: (v if k != "problem" else v[:60]) for k, v in b.items() if k != "clisJson"} for b in posted])

    # ── 3. the run is in the chat's session ───────────────────────────────────────
    page.goto(f"{origin}/s/chat-pay", wait_until="domcontentloaded")
    try:
        page.wait_for_selector('[data-testid="session-run"][data-run-id="r-chat-launch-1"]', timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-launch-session-missing.png"))
        fail("in-chat-session", str(e))
    in_session = page.evaluate(
        "() => [...document.querySelectorAll('[data-testid=\"session-run\"]')].map(r => r.dataset.runId)")
    try:
        page.wait_for_function(
            "() => [...document.querySelectorAll('[data-testid=\"rail-session\"]')]"
            ".some(s => s.dataset.sessionId === 'chat-pay' && (s.dataset.runIds || '').includes('r-chat-launch-1'))",
            timeout=10000)
    except Exception:  # noqa: BLE001
        pass  # reported below with what the rail holds
    rail = {s["id"]: s for s in page.evaluate(RAIL)}
    page.screenshot(path=str(SHOTS / "desk-chat-launch-session.png"))
    check("in-chat-session", "r-chat-launch-1" in in_session and "r-pay-2" in in_session
          and "r-chat-launch-1" in (rail.get("chat-pay", {}).get("runs") or "")
          and "run:r-chat-launch-1" not in rail,
          session_runs=in_session, rail=rail)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
