#!/usr/bin/env python3
"""
desk_questions_in_thread_test.py — S16a-4g: every question a run or a chat asks the operator is
answered in its session thread; the docks and panels point there ("Answer in its thread ›") and
carry no gate card. At 1440x700 on the Desk, against the in-process fixture (wave1 + wave2b).

  1. MCP QUESTION: the Desk's question row ("Answer ›") opens /s/run%3Ae1#gate with the question
     focused under e1's card; the answer is ONE POST /runs/e1/elicitation.
  2. STALL HAND-OFF: the stall watchdog's hand-off (workerStallEscalated, needsYou) renders in e1's block.
  3. STEERING DOCK: "add with chat" launches the authoring run (routed to g1, a run at a simple gate);
     the dock shows the line and no card; its link lands on /s/run%3Ag1#gate with the gate row
     focused; Approve sends ONE POST /runs/g1/gate after the undo window.
  4. ASK DOCK + CHAT GATE: the Ask dock opens a chat; a chat-keyed gate shows the line in the dock
     (no card); its link lands on /s/<chat>#gate, where the gate is answered — ONE POST after undo.
  5. 0 page errors.

Captures: e2e/shots/desk-questions-*.png. Env: FEEDBACK_PORT (default 4485). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4485"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
UNDO_S = 12

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

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
ACTIVE_IN = """(sel) => { const el = document.querySelector(sel); return !!el && el.contains(document.activeElement); }"""


def path_of(page) -> str:
    u = urllib.parse.urlparse(page.url)
    return u.path + (f"#{u.fragment}" if u.fragment else "")


def wait_posts(page, posts: list, n: int, secs: float) -> None:
    deadline = time.time() + secs
    while time.time() < deadline and len(posts) < n:
        page.wait_for_timeout(250)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    answers: list = []
    gate_posts: list = []
    page.route("**/api/v1/runs/e1/elicitation", lambda r: (answers.append(r.request.post_data), r.fulfill(
        status=200, content_type="application/json", body='{"status":"ok"}'))[1] if r.request.method == "POST" else r.continue_())
    page.on("request", lambda r: gate_posts.append((urllib.parse.urlparse(r.url).path, r.post_data))
            if r.method == "POST" and r.url.rstrip("/").endswith("/gate") else None)
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[],
                status_over={}, extra_frames=[], reset_gate_posts=True)

    # ── 1. the Desk's question row opens the thread with the question focused ──────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    set_fixture(origin, extra_frames=[{"type": "elicitationCreated", "session": "e1", "elicitationId": "el-1",
                                       "message": "Which region should the backfill target?", "options": None}])
    row = page.locator('[data-testid="need-row"][data-kind="elicitation"]')
    try:
        row.wait_for(timeout=8000)
    except Exception as e:  # noqa: BLE001
        fail("question-row", str(e))
    row.locator('[data-testid="need-act"]').click()
    try:
        page.wait_for_function("() => location.pathname === '/s/run%3Ae1' && location.hash === '#gate'", timeout=10000)
        page.locator('[data-testid="session-run-questions"][data-run-id="e1"] [data-testid="elicitation-prompt"]').wait_for(timeout=10000)
        page.wait_for_function(ACTIVE_IN, arg='[data-testid="session-run-questions"][data-run-id="e1"] [data-testid="elicitation-prompt"]', timeout=5000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-mcp-miss.png"))
        fail("question-in-thread-focused", f"{e} at {path_of(page)}")
    page.screenshot(path=str(SHOTS / "desk-questions-mcp.png"))
    prompt = page.locator('[data-testid="session-run-questions"][data-run-id="e1"] [data-testid="elicitation-prompt"]')
    prompt.get_by_placeholder("Your answer").fill("eu-west-1")
    prompt.get_by_role("button", name="Send").click()
    wait_posts(page, answers, 1, 5)
    page.wait_for_timeout(500)
    body = json.loads(answers[0]) if answers else None
    check("question-answered-once", len(answers) == 1 and body is not None and body.get("elicitationId") == "el-1"
          and body.get("action") == "accept" and body.get("content") == {"response": "eu-west-1"},
          answers=list(answers))

    # ── 2. the stall watchdog's hand-off is in the run's block ────────────────────────
    set_fixture(origin, extra_frames=[{"type": "workerStallEscalated", "session": "e1", "ord": 0, "needsYou": True,
                                       "action": "reassign", "outcome": "exhausted", "quietForMs": 900000,
                                       "ts": int(time.time() * 1000)}])
    try:
        page.locator('[data-testid="session-run"][data-run-id="e1"] [data-testid="needs-you-card"]').wait_for(timeout=8000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-stall-miss.png"))
        fail("stall-hand-off-in-block", str(e))
    page.screenshot(path=str(SHOTS / "desk-questions-stall.png"))
    check("stall-hand-off-in-block", True)

    # ── 3. the Steering dock points at the authoring run's thread ─────────────────────
    page.route("**/api/v1/governance/steering/author", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"runId":"g1"}') if r.request.method == "POST" else r.continue_())
    page.goto(f"{origin}/steering/policies", wait_until="networkidle")
    dock_in = page.get_by_test_id("assist-input")
    try:
        dock_in.wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-steer-nodock.png"))
        fail("steering-dock-line", str(e))
    dock_in.fill("author two security rules about secrets")
    # Ctrl/⌘+Enter sends (the floating Ask bubble sits over the dock's Send button at 1440x700 — recorded).
    dock_in.press("ControlOrMeta+Enter")
    line = page.locator('[data-testid="answer-in-thread"][data-subject="g1"]')
    try:
        line.wait_for(timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-steer-noline.png"))
        fail("steering-dock-line", str(e))
    page.screenshot(path=str(SHOTS / "desk-questions-steer-dock.png"))
    check("steering-dock-line", page.get_by_test_id("steering-gate").count() == 0
          and page.get_by_test_id("approval-dock").count() == 0, text=line.inner_text())
    gate_posts.clear()
    line.get_by_test_id("answer-in-thread-open").click()
    try:
        page.wait_for_function("() => location.pathname === '/s/run%3Ag1' && location.hash === '#gate'", timeout=10000)
        page.wait_for_function(ACTIVE_IN, arg='[data-testid="session-run"][data-run-id="g1"] [data-testid="session-gate-row"]', timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-steer-thread-miss.png"))
        fail("steering-gate-in-thread", f"{e} at {path_of(page)}")
    page.locator('[data-testid="session-run"][data-run-id="g1"] [data-testid="session-gate-choice"][data-choice-key="approve"]').click()
    wait_posts(page, gate_posts, 1, UNDO_S)
    page.wait_for_timeout(800)
    page.screenshot(path=str(SHOTS / "desk-questions-steer-answered.png"))
    check("steering-gate-in-thread", len(gate_posts) == 1 and gate_posts[0][0] == "/api/v1/runs/g1/gate", posts=list(gate_posts))

    # ── 4. the Ask dock + a chat-keyed gate answered on the chat's thread ─────────────
    page.goto(f"{origin}/watch", wait_until="networkidle")
    page.get_by_test_id("ask-launcher").click()
    ask_in = page.get_by_test_id("assist-input")
    ask_in.wait_for(timeout=10000)
    ask_in.fill("which checks guard the deploy?")
    page.get_by_test_id("assist-send").click()
    try:
        page.wait_for_function("() => !!JSON.parse(sessionStorage.getItem('wicked.ask.session') || '{}').chatId", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-ask-nochat.png"))
        fail("ask-dock-line", str(e))
    chat_id = page.evaluate("() => JSON.parse(sessionStorage.getItem('wicked.ask.session') || '{}').chatId || ''")
    page.route(f"**/api/v1/runs/{chat_id}/gate", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"status":"ok"}') if r.request.method == "POST" else r.continue_())
    # The daemon fans a chat's frames out to every socket (the Ask dock holds its own); `chat_frames`
    # is the fixture's fan-out — `extra_frames` reach only the newest socket.
    set_fixture(origin, chat_frames=[{"type": "awaitingHuman", "session": chat_id, "ord": 1,
                                      "prompt": "Share the deploy checklist with the team?"}])
    cline = page.locator(f'[data-testid="answer-in-thread"][data-subject="{chat_id}"]')
    try:
        cline.wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-ask-noline.png"))
        fail("ask-dock-line", f"{e}; lines={page.locator('[data-testid=answer-in-thread]').evaluate_all('els => els.map(e => e.dataset.subject)')}; "
             f"chats={page.locator('[data-testid=assist-chat]').evaluate_all('els => els.map(e => e.outerHTML.slice(0, 200))')}")
    page.screenshot(path=str(SHOTS / "desk-questions-ask-dock.png"))
    check("ask-dock-line", page.get_by_test_id("steering-gate").count() == 0, chat=chat_id, text=cline.inner_text())
    gate_posts.clear()
    cline.get_by_test_id("answer-in-thread-open").click()
    want = f"/s/{urllib.parse.quote(chat_id)}"
    try:
        page.wait_for_function(f"() => location.pathname === {json.dumps(want)} && location.hash === '#gate'", timeout=10000)
        page.locator(f'[data-testid="session-chat-questions"][data-chat-id="{chat_id}"] [data-testid="session-gate-row"]').wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-questions-chat-miss.png"))
        fail("chat-gate-in-thread", f"{e} at {path_of(page)}")
    keys = page.locator('[data-testid="session-chat-questions"] [data-testid="session-gate-choice"]').evaluate_all(
        "els => els.map(e => e.dataset.choiceKey)")
    page.locator('[data-testid="session-chat-questions"] [data-testid="session-gate-choice"][data-choice-key="approve"]').click()
    wait_posts(page, gate_posts, 1, UNDO_S)
    page.wait_for_timeout(800)
    page.screenshot(path=str(SHOTS / "desk-questions-chat-answered.png"))
    check("chat-gate-in-thread", len(gate_posts) == 1 and gate_posts[0][0] == f"/api/v1/runs/{chat_id}/gate"
          and not any(k.startswith("reassign") for k in keys), posts=list(gate_posts), keys=keys)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
