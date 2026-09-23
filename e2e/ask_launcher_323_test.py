#!/usr/bin/env python3
"""
ask_launcher_323_test.py — the studio#323 R1–R3 browser gate, at 1440x700.

Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) serving the
same-origin build — no crew daemon involved.

  R1  the Ask launcher is a floating bubble VISIBLE in the viewport's bottom-right
      corner (clear of the 28px runs bar), the rail carries no `rail-ask`, and a
      click opens the Ask dock as a FLOATING panel anchored above the bubble —
      #main keeps its width (the dock pushes no layout);
  R2  a question sent from Ask shows up on /chats as a live card labelled "Ask"
      with the question as its title;
  R3  closing and reopening Ask resumes the SAME session (its block is back, keyed
      by the same chat id), and "Open in full chat" lands on /chat/<that id>;
  #328 after the daemon reaps the session, reopening Ask drops the dead block, offers
      no "Open in full chat", and forgets the stored id;
  narrow at 375px wide with a run selected (right panel up), the bubble AND the
      open panel stay fully on screen.

Capture: e2e/shots/ask-323-open.png (bubble + open panel).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env: FEEDBACK_PORT (default 4323). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4323"))
W, H = 1440, 700
RUNS_BAR_PX = 28
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
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

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.goto(f"{origin}/", wait_until="networkidle")

    # ── R1: the bubble, bottom-right, visible ──────────────────────────────────
    bubble = page.get_by_test_id("ask-launcher")
    bubble.wait_for(state="visible", timeout=10000)
    b = bubble.bounding_box()
    check("r1-bubble-in-viewport", b is not None and b["x"] >= 0 and b["y"] >= 0
          and b["x"] + b["width"] <= W and b["y"] + b["height"] <= H, box=b)
    check("r1-bubble-bottom-right",
          b["x"] + b["width"] >= W - 40 and b["x"] > W / 2 and b["y"] > H / 2,
          right_gap=W - (b["x"] + b["width"]), bottom_gap=H - (b["y"] + b["height"]))
    check("r1-bubble-clears-runs-bar", b["y"] + b["height"] <= H - RUNS_BAR_PX,
          bubble_bottom=b["y"] + b["height"], bar_top=H - RUNS_BAR_PX)
    hit = page.evaluate(
        "([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid=\"ask-launcher\"]') !== null",
        [b["x"] + b["width"] / 2, b["y"] + b["height"] / 2])
    check("r1-bubble-not-covered", hit is True)
    check("r1-rail-has-no-ask", page.get_by_test_id("rail-ask").count() == 0)

    main_w_before = page.locator("#main").bounding_box()["width"]
    bubble.click()
    panel = page.get_by_test_id("ask-panel")
    panel.wait_for(state="visible", timeout=5000)
    page.get_by_test_id("assist-dock").wait_for(state="visible", timeout=5000)
    pb = panel.bounding_box()
    check("r1-panel-anchored-above-bubble",
          pb["y"] + pb["height"] <= b["y"] and abs((pb["x"] + pb["width"]) - (b["x"] + b["width"])) <= 1
          and pb["y"] >= 0, panel=pb, bubble=b)
    main_w_after = page.locator("#main").bounding_box()["width"]
    check("r1-panel-pushes-no-layout", abs(main_w_after - main_w_before) < 1,
          before=main_w_before, after=main_w_after)
    page.screenshot(path=str(SHOTS / "ask-323-open.png"))

    # ── R2: ask a question, find it on /chats ──────────────────────────────────
    question = "What is in the estate store?"
    page.get_by_test_id("assist-input").fill(question)
    page.get_by_test_id("assist-send").click()
    chat_block = page.get_by_test_id("assist-chat")
    chat_block.wait_for(state="visible", timeout=10000)
    chat_id = chat_block.get_attribute("data-chat-id")
    check("r2-ask-opened-a-chat", bool(chat_id), chat_id=chat_id)

    # Close Ask (the bubble toggles), navigate in-app to /chats.
    bubble.click()
    panel.wait_for(state="detached", timeout=5000)
    page.evaluate("() => { history.pushState({}, '', '/chats'); dispatchEvent(new PopStateEvent('popstate')); }")
    row = page.locator(f'[data-testid="live-chat-row"][data-chat-id="{chat_id}"]')
    row.wait_for(state="visible", timeout=10000)
    check("r2-card-says-ask", row.get_by_test_id("live-chat-origin").inner_text().strip() == "Ask",
          origin=row.get_by_test_id("live-chat-origin").inner_text())
    check("r2-card-title-is-the-question",
          row.get_by_test_id("live-chat-title").inner_text().strip() == question,
          title=row.get_by_test_id("live-chat-title").inner_text())

    # ── R3: reopen resumes the same session; promote to the full chat ─────────
    bubble.click()
    resumed = page.get_by_test_id("assist-chat")
    resumed.wait_for(state="visible", timeout=5000)
    check("r3-reopen-resumes-same-id", resumed.get_attribute("data-chat-id") == chat_id,
          resumed=resumed.get_attribute("data-chat-id"), original=chat_id)
    page.get_by_test_id("assist-dock-expand").click()
    page.wait_for_url(f"**/chat/{chat_id}", timeout=5000)
    check("r3-open-in-full-chat", page.url.endswith(f"/chat/{chat_id}"), url=page.url)
    check("r3-dock-closed-after-promote", page.get_by_test_id("ask-panel").count() == 0)

    # ── studio#328: the daemon reaps the session; reopening Ask must not present it ──
    status = page.evaluate(
        "async (id) => (await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })).status",
        chat_id)
    check("r328-fixture-reaped", status == 200, status=status)
    page.get_by_test_id("ask-launcher").click()
    page.get_by_test_id("assist-dock").wait_for(state="visible", timeout=5000)
    page.get_by_text("earlier session has ended").wait_for(state="visible", timeout=5000)
    check("r328-dead-block-dropped", page.get_by_test_id("assist-chat").count() == 0
          and page.get_by_test_id("assist-dock-expand").count() == 0)
    stored = page.evaluate("() => sessionStorage.getItem('wicked.ask.session')")
    check("r328-stored-id-forgotten", stored is None, stored=stored)
    page.get_by_test_id("ask-launcher").click()

    # ── Narrow viewport + a selected run (right panel): the panel stays on screen ──
    narrow = browser.new_page(viewport={"width": 375, "height": 700}, device_scale_factor=1)
    narrow.goto(f"{origin}/runs/r-upload", wait_until="networkidle")
    nb = narrow.get_by_test_id("ask-launcher")
    nb.wait_for(state="visible", timeout=10000)
    nbb = nb.bounding_box()
    check("narrow-bubble-on-screen", nbb["x"] >= 0 and nbb["x"] + nbb["width"] <= 375, bubble=nbb)
    nb.click()
    npanel = narrow.get_by_test_id("ask-panel")
    npanel.wait_for(state="visible", timeout=5000)
    npb = npanel.bounding_box()
    check("narrow-panel-on-screen", npb["x"] >= 0 and npb["x"] + npb["width"] <= 375 and npb["width"] >= 200,
          panel=npb)
    # The INNER dock must fit its container — not a fixed 384px column clipped by it.
    ndock = narrow.get_by_test_id("assist-dock").bounding_box()
    check("narrow-dock-inside-viewport", ndock["x"] >= 0 and ndock["x"] + ndock["width"] <= 375
          and ndock["x"] + ndock["width"] <= npb["x"] + npb["width"] + 0.5, dock=ndock, panel=npb)
    nsend = narrow.get_by_test_id("assist-send").bounding_box()
    check("narrow-send-inside-viewport", nsend["x"] + nsend["width"] <= npb["x"] + npb["width"], send=nsend, panel=npb)
    narrow.close()

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
