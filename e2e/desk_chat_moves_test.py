#!/usr/bin/env python3
"""
desk_chat_moves_test.py — S16a-4e: a chat IS its session, and a new chat starts from the Desk's
Chat (concept A: the Ask dock). X1 (operator ruling 2026-10-09): the old chat addresses no longer redirect. At 1440x700
on the Desk, against the in-process fixture.

  1. RETIRED: /chat/new, /p/upload-endpoint/chat, /chat/<id> and /p/upload-endpoint/chat/r-pay-2
     each show the not-found page with the typed address kept; nothing is POSTed.
  3. FIRST SEND: the Desk's Chat send opens exactly ONE chat (POST /chats) and one message.
  4. CHAT ADDRESS: /s/<id>?q=1#t is the chat's session; a reply from the session composer posts to
     THAT chat — one POST /chats/<id>/messages, no second POST /chats.
  6. 0 page errors.

The needs-you stalled-chat row's link (`/s/<chat>`) is pinned in tests/needsYou.test.ts: the
fixture's GET /chats never reports a chat idle past the stall threshold.

Captures: e2e/shots/desk-chat-moves-*.png. Env: FEEDBACK_PORT (default 4481). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4481"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "upload-endpoint"

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


def chat_posts(posts: list) -> dict:
    opens = [u for u in posts if urllib.parse.urlparse(u).path == "/api/v1/chats"]
    sends = [u for u in posts if urllib.parse.urlparse(u).path.endswith("/messages")]
    return {"opens": opens, "sends": sends}


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    posts: list = []
    page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and "/api/v1/chats" in r.url else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, repo=True, chat_scope=True, chat_transcripts=True, sessions=True)

    # ── 1. the retired chat addresses are dead: not-found, the typed address kept ─────
    for step, path in (("retired-chat-new", "/chat/new"), ("retired-project-chat", f"/p/{PID}/chat"),
                       ("retired-chat-id", "/chat/chat-pay"), ("retired-chat-run", f"/p/{PID}/chat/r-pay-2")):
        page.goto(f"{origin}{path}", wait_until="networkidle")
        try:
            page.get_by_test_id("not-found").wait_for(timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"desk-chat-moves-{step}-miss.png"))
            fail(step, f"{e} at {page.url}")
        check(step, urllib.parse.urlparse(page.url).path == path
              and page.get_by_test_id("not-found-path").inner_text().strip() == path
              and chat_posts(posts) == {"opens": [], "sends": []}, url=page.url, posts=posts)
    page.screenshot(path=str(SHOTS / "desk-chat-moves-retired.png"))

    # ── 3. the first send opens one chat ───────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    # Concept A: the Desk's Chat opens the Ask dock — the one chat surface — and its Send opens the chat.
    page.get_by_test_id("desk-chat").click()
    composer = page.get_by_test_id("assist-input")
    composer.wait_for(timeout=15000)
    composer.fill("summarize the last 10 commits as release notes")
    page.get_by_test_id("assist-send").click()
    try:
        page.wait_for_function("() => !!JSON.parse(sessionStorage.getItem('wicked.ask.session') || '{}').chatId", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-moves-send-miss.png"))
        fail("first-send", str(e))
    chat_id = page.evaluate("() => JSON.parse(sessionStorage.getItem('wicked.ask.session') || '{}').chatId || ''")
    page.wait_for_timeout(600)
    first = chat_posts(posts)
    check("first-send", chat_id not in ("", "new") and len(first["opens"]) == 1 and len(first["sends"]) == 1,
          chat=chat_id, **first)

    # ── 4. /s/<id> is the chat's session; a reply goes to that chat ────────────────────
    posts.clear()
    page.goto(f"{origin}/s/{urllib.parse.quote(chat_id)}?q=1#t", wait_until="networkidle")
    landed = urllib.parse.urlparse(page.url)
    check("chat-is-its-session", landed.path == "/s/" + urllib.parse.quote(chat_id) and landed.query == "q=1"
          and landed.fragment == "t" and page.get_by_test_id("not-found").count() == 0, landed=landed.geturl())
    reply = page.get_by_test_id("session-composer-input")
    try:
        reply.wait_for(timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-moves-reply-miss.png"))
        fail("reply-goes-to-the-chat", str(e))
    reply.fill("and group them by area")
    reply.press("Enter")
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / "desk-chat-moves-reply.png"))
    got = chat_posts(posts)
    want_send = f"/api/v1/chats/{urllib.parse.quote(chat_id)}/messages"
    check("reply-goes-to-the-chat", got["opens"] == [] and len(got["sends"]) == 1
          and urllib.parse.urlparse(got["sends"][0]).path == want_send, want=want_send, **got)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
