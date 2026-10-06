#!/usr/bin/env python3
"""
desk_ask_team_test.py — ASK-S1 (DES-ASK-TEAM-CHAT-001 §4.8; DES-STUDIO-REBUILD-001 Amendment 6) at
1440x700, under STUDIO_SKIN=desk.

An ask is a team path driven by one agent. Against the fixture's `ask_path` replay of the frames the
crew lane captured live (one primary helper picked at random, a reviewer member, a finding on the
answer, a HELP: exchange), it proves:

  1. ONE VOICE: a question typed on the Desk opens a chat whose seats are the eligible roster (nothing
     warm) and sends ONE message; the session `/s/<chat>` shows the operator's turn, "<pa> is thinking",
     then the PA's reply as the ONLY bubble on the agent side — no second helper answers.
  2. THE QUIET LINES, in time order: "claude answers · picked at random" (expands to the pick, the
     score and the shape), "<reviewer> is reviewing", "reviewer · 1 finding: …" (expands to the evidence
     and suggestion); the ask run has NO block and NO chain line (the thread is the chain); the shape
     line under the thread names the steps.
  3. A SECOND MESSAGE continues the path: a second "thinking" line, then the second bubble with its help
     line under it ("asked <reviewer>: … · answered", expandable to the answer) — still one voice; the
     first turn's lines stay where they were.
  4. THE TURN GATE DRAWS NOTHING: the ask run is awaiting_human after the reply and the Desk lists no
     gate row for it; the session is "waiting".
  5. ONE SEAT (ask_one_seat): "No reviewer — only <pa> is signed in." with Sign in, which opens the
     session sheet on Sign-ins; the one-seat refusal line reads in plain words.
  6. OLDER DAEMON (ask_path off): the chat-pay session renders as before and says every helper answers.
  7. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-ask-team*.png. Env: FEEDBACK_PORT (default 4466).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4466"))
W, H = 1440, 700
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


def ask_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/ask-posts", timeout=10) as res:
        return json.loads(res.read())["posts"]


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

THREAD = """() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const order = q('[data-testid="session-turn"], [data-testid="ask-line"], [data-testid="ask-typing"], [data-testid="session-run"]')
    .map((el) => { const t = el.dataset.testid; return t === 'ask-line' ? 'line:' + el.dataset.kind : t === 'session-turn' ? 'turn:' + el.dataset.who + (el.dataset.pending ? ':pending' : '') : t === 'ask-typing' ? 'typing' : 'run'; });
  return { order,
           lines: q('[data-testid="ask-line"]').map((l) => ({ kind: l.dataset.kind, tone: l.dataset.tone, text: l.innerText.replace(/\\s+/g, ' ').trim() })),
           helperBubbles: q('[data-testid="session-turn"][data-who="helper"]').map((b) => b.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60)),
           you: q('[data-testid="session-turn"][data-who="you"]').length,
           runs: q('[data-testid="session-run"]').length, chain: q('[data-testid="chain"]').length,
           typing: (document.querySelector('[data-testid="ask-typing"]') || {}).innerText || null,
           shape: (document.querySelector('[data-testid="session-ask-shape"]') || {}).innerText || null,
           older: (document.querySelector('[data-testid="session-ask-older"]') || {}).innerText || null,
           state: (document.querySelector('[data-testid="session"]') || {}).dataset?.state || null,
           newestInView: (() => { const th = document.querySelector('[data-testid="session-thread"]'); const last = th && th.lastElementChild;
             if (!th || !last) return null; const a = th.getBoundingClientRect(), b = last.getBoundingClientRect(); return b.bottom <= a.bottom + 1 && b.top >= a.top - 1; })(),
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""


def new_page(browser):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return page


with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, sessions=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[])

    # ── 1. one voice: ask from the Desk, read the session ─────────────────────────
    page = new_page(browser)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-composer-input").wait_for(state="visible", timeout=15000)
    # The Desk's rows BEFORE the ask (by key): the ask's turn gate must add no row and remove none.
    rows_before = page.evaluate("""() => [...document.querySelectorAll('[data-testid="need-row"]')].map((n) => n.dataset.key)""")
    page.get_by_test_id("desk-composer-input").fill("why does greet() not trim its input?")
    page.get_by_test_id("desk-composer-input").press("Enter")
    for _ in range(60):
        posts = ask_posts(origin)
        if posts:
            break
        time.sleep(0.25)
    else:
        fail("ask-sent", "no POST /chats/:id/messages reached the fixture's ask path")
    chat_id = posts[0]["chatId"]
    check("ask-sent-once", len(posts) == 1 and posts[0]["turn"] == 1, posts=posts)
    page.goto(f"{origin}/s/{chat_id}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.wait_for_function("""() => document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').length === 1
            && document.querySelectorAll('[data-testid="ask-line"][data-kind="finding"]').length === 1""", timeout=20000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-ask-team-missing.png"))
        fail("reply", page.evaluate(THREAD))
    page.wait_for_timeout(300)
    t1 = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "desk-ask-team.png"))
    check("one-voice",
          t1["order"] == ["turn:you", "line:who", "line:reviewer", "turn:helper", "line:finding"]
          and t1["you"] == 1 and len(t1["helperBubbles"]) == 1 and t1["runs"] == 0 and t1["chain"] == 0
          and t1["typing"] is None and not t1["hscroll"], thread=t1)
    pa = t1["lines"][0]["text"].split(" answers")[0]
    reviewer = t1["lines"][1]["text"].split(" is reviewing")[0]
    check("quiet-lines",
          t1["lines"][0]["text"] == f"{pa} answers · picked at random"
          and t1["lines"][1]["text"] == f"{reviewer} is reviewing"
          and t1["lines"][2]["text"].startswith("reviewer · 1 finding: the cited line is the signature")
          and t1["shape"] == f"Shape: answer · {pa} answers · {reviewer} reviews", lines=t1["lines"], shape=t1["shape"])

    # ── 2. the look-underneath ────────────────────────────────────────────────────
    page.locator('[data-testid="ask-line"][data-kind="who"] [data-testid="ask-line-toggle"]').click()
    page.locator('[data-testid="ask-line"][data-kind="finding"] [data-testid="ask-line-toggle"]').click()
    details = page.evaluate("""() => [...document.querySelectorAll('[data-testid="ask-line-detail"]')].map((d) => [...d.querySelectorAll('li')].map((li) => li.innerText.trim()))""")
    page.screenshot(path=str(SHOTS / "desk-ask-team-underneath.png"))
    check("look-underneath",
          len(details) == 2
          and details[0][0].startswith(f"Picked {pa} at random from ") and details[0][1].startswith("Score 0 · band 0–19")
          and details[0][2] == "Shape: answer."
          and details[1] == ["Evidence: greet.js:2 is the template literal; the signature is line 1", "Suggestion: cite greet.js:2 as the body"],
          details=details)

    # ── 3. a second message continues the path ────────────────────────────────────
    page.get_by_test_id("session-composer-input").fill("ask the reviewer whether trimming breaks any caller")
    page.get_by_test_id("session-composer-input").press("Enter")
    # The typing line stands only while the answer step is claimed and nothing has landed — read its
    # words in the same evaluation that finds it (the fixture's first delta can follow within a tick).
    try:
        thinking = page.wait_for_function("() => document.querySelector('[data-testid=\"ask-typing\"]')?.innerText ?? null", timeout=10000).json_value()
    except Exception:
        fail("thinking", page.evaluate(THREAD))
    try:
        page.wait_for_function("""() => document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').length === 2
            && document.querySelectorAll('[data-testid="ask-line"][data-kind="help"]').length === 1""", timeout=20000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-ask-team-turn2-missing.png"))
        fail("turn-2", page.evaluate(THREAD))
    page.wait_for_timeout(300)
    t2 = page.evaluate(THREAD)
    page.locator('[data-testid="ask-line"][data-kind="help"] [data-testid="ask-line-toggle"]').click()
    help_detail = page.evaluate("""() => [...document.querySelectorAll('[data-testid="ask-line"][data-kind="help"] [data-testid="ask-line-detail"] li')].map((li) => li.innerText.trim())""")
    page.screenshot(path=str(SHOTS / "desk-ask-team-turn2.png"))
    posts = ask_posts(origin)
    check("second-turn",
          thinking is not None and f"{pa} is thinking" in thinking
          and t2["order"][:5] == ["turn:you", "line:who", "line:reviewer", "turn:helper", "line:finding"]
          and t2["order"][5:] == ["turn:you", "turn:helper", "line:help"]  # the help line sits UNDER the reply (§4.8)
          and t2["you"] == 2 and len(t2["helperBubbles"]) == 2 and t2["runs"] == 0 and t2["typing"] is None
          and t2["newestInView"] is True  # the thread followed the conversation to its newest line
          and t2["lines"][-1]["text"] == f"asked {reviewer}: is trimming the name a behaviour change any caller relies on? · answered"
          and help_detail == ["No caller passes padded names; trimming is safe."]
          and len(posts) == 2 and posts[1]["chatId"] == chat_id and posts[1]["turn"] == 2,
          thread=t2, posts=posts, help_detail=help_detail, thinking=thinking)

    # ── 3b. the Helpers sheet names the path's seats by role (ASK-S3) ─────────────
    page.get_by_test_id("session-sheet-open").click()
    page.locator('[data-testid="sheet-tab"]', has_text="Helpers").click()
    try:
        page.wait_for_function("() => document.querySelectorAll('[data-testid=\"sheet-helper-role\"]').length >= 2", timeout=10000)
    except Exception:
        fail("helpers-sheet", page.evaluate("() => [...document.querySelectorAll('[data-testid=\"sheet-helper-role\"]')].map((n) => n.innerText)"))
    roles = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"sheet-helper-role\"]')].map((n) => [n.dataset.role, n.innerText.replace(/\\s+/g, ' ').trim()])")
    page.screenshot(path=str(SHOTS / "desk-ask-team-helpers.png"))
    check("helpers-sheet",
          roles[0] == ["pa", f"{pa} answers · picked at random"]
          and roles[1][0] == "reviewer" and roles[1][1].startswith(f"{reviewer} reviews"),
          roles=roles)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # ── 4. the turn gate draws nothing ────────────────────────────────────────────
    check("session-waiting", t2["state"] == "waiting", state=t2["state"])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-composer-input").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    with urllib.request.urlopen(f"{origin}/api/v1/chats/{chat_id}", timeout=10) as res:
        ask_run = json.loads(res.read())["path"]["runId"]
    desk = page.evaluate("""(rid) => ({
      keys: [...document.querySelectorAll('[data-testid="need-row"]')].map((n) => n.dataset.key),
      session: [...document.querySelectorAll('[data-testid="desk-session"]')].filter((s) => s.dataset.runId === rid).map((s) => s.dataset.state) })""", ask_run)
    page.screenshot(path=str(SHOTS / "desk-ask-team-desk.png"))
    # The ask run waits at its turn gate: no row is keyed to it (`gate:<run>`, or any key naming the run),
    # the rows that were there before the ask are all still there, and its session is listed, waiting.
    check("no-gate-row",
          not any(ask_run in (k or "") for k in desk["keys"])
          and sorted(k for k in desk["keys"] if k) == sorted(k for k in rows_before if k)
          and desk["session"] == ["waiting"], desk=desk, rows_before=rows_before)
    page.close()

    # ── 5. one seat: no reviewer, Sign in; the refusal line ───────────────────────
    set_fixture(origin, ask_one_seat=True)
    page = new_page(browser)  # a fresh page: a fresh sessionStorage, so the dock opens a NEW chat
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-composer-input").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-composer-input").fill("should greet() trim?")
    page.get_by_test_id("desk-composer-input").press("Enter")
    for _ in range(60):
        posts = ask_posts(origin)
        if len(posts) == 3:
            break
        time.sleep(0.25)
    else:
        fail("one-seat-sent", {"posts": posts})
    chat2 = posts[2]["chatId"]
    check("one-seat-new-chat", chat2 != chat_id, chats=[chat_id, chat2])
    page.goto(f"{origin}/s/{chat2}", wait_until="networkidle")
    try:
        page.wait_for_function("""() => document.querySelectorAll('[data-testid="ask-line"][data-kind="refused"]').length === 1
            && document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').length === 1""", timeout=20000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-ask-team-oneseat-missing.png"))
        fail("one-seat", page.evaluate(THREAD))
    t3 = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "desk-ask-team-oneseat.png"))
    kinds = [l["kind"] for l in t3["lines"]]
    check("one-seat-lines",
          kinds == ["who", "reviewer", "refused"]
          and t3["lines"][1]["text"] == f"No reviewer — only {pa} is signed in. Sign in"
          and t3["lines"][2]["text"] == f"Can’t build from here: only {pa} is signed in; sign in another helper so review can run. Sign in"
          and t3["lines"][2]["tone"] == "problem" and len(t3["helperBubbles"]) == 1, lines=t3["lines"])
    page.locator('[data-testid="ask-line"][data-kind="reviewer"] [data-testid="ask-line-signin"]').click()
    try:
        page.wait_for_function("""() => (document.querySelector('[data-testid="sheet-body"]') || {}).dataset?.tab === 'signins'""", timeout=5000)
    except Exception:
        fail("sign-in-sheet", page.evaluate("() => (document.querySelector('[data-testid=\"sheet-body\"]') || {}).dataset?.tab || null"))
    page.screenshot(path=str(SHOTS / "desk-ask-team-signin.png"))
    check("sign-in-opens-sheet", True)
    page.close()

    # ── 6. an older daemon ────────────────────────────────────────────────────────
    set_fixture(origin, ask_path=False, ask_one_seat=False)
    page = new_page(browser)
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"session-ask-older\"]')", timeout=10000)
    except Exception:
        fail("older", page.evaluate(THREAD))
    t4 = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "desk-ask-team-older.png"))
    check("older-daemon", t4["older"].startswith("Older daemon: every helper answers at once") and not any(k.startswith("line:") for k in t4["order"]), thread=t4)
    page.close()

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
