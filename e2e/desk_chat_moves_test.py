#!/usr/bin/env python3
"""
desk_chat_moves_test.py — S16a-4e: a chat IS its session, and a new chat starts in the Desk
composer. At 1440x700 on the Desk, against the in-process fixture.

  1. NEW: /chat/new lands on `/` with the Desk composer focused; nothing is POSTed.
  2. PROJECT: /p/upload-endpoint/chat lands on `/` with the project's `@` chip; nothing is POSTed.
  3. FIRST SEND: the Desk send opens exactly ONE chat (POST /chats) and one message.
  4. CHAT ADDRESS: /chat/<id>?q=1#t lands on /s/<id>?q=1#t (history replaced: Back never re-enters
     /chat/<id>); a reply from the session composer posts to THAT chat — one POST
     /chats/<id>/messages, no second POST /chats.
  5. CHAT RUN: /p/upload-endpoint/chat/r-pay-2 lands on /s/run%3Ar-pay-2.
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
FOCUSED = "() => document.activeElement?.getAttribute('data-testid') === 'desk-composer-input'"
CHIP = f'[data-testid="composer"][data-composer="desk"] [data-testid="composer-chip"][data-kind="project"]'


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

    # ── 1. /chat/new → the Desk composer, focused ─────────────────────────────────────
    page.goto(f"{origin}/chat/new", wait_until="networkidle")
    try:
        page.wait_for_function("() => location.pathname === '/'", timeout=15000)
        page.wait_for_function(FOCUSED, timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-moves-new-miss.png"))
        fail("new-chat-desk", str(e))
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "desk-chat-moves-new.png"))
    check("new-chat-desk", chat_posts(posts) == {"opens": [], "sends": []}, posts=posts)

    # ── 2. /p/<pid>/chat → the Desk composer with the project's chip ──────────────────
    page.goto(f"{origin}/p/{PID}/chat", wait_until="networkidle")
    try:
        page.wait_for_function("() => location.pathname === '/'", timeout=15000)
        page.locator(CHIP).first.wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-moves-chip-miss.png"))
        fail("project-chat-chip", str(e))
    chip = page.locator(CHIP).first
    page.screenshot(path=str(SHOTS / "desk-chat-moves-chip.png"))
    check("project-chat-chip", chip.get_attribute("data-key") == f"project:{PID}"
          and chat_posts(posts) == {"opens": [], "sends": []}, key=chip.get_attribute("data-key"), posts=posts)

    # ── 3. the first send opens one chat ───────────────────────────────────────────────
    page.goto(f"{origin}/chat/new", wait_until="networkidle")
    page.wait_for_function("() => location.pathname === '/'", timeout=15000)
    composer = page.get_by_test_id("desk-composer-input")
    composer.wait_for(timeout=15000)
    composer.fill("summarize the last 10 commits as release notes")
    composer.press("Enter")
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

    # ── 4. /chat/<id> → its session; a reply goes to that chat ──────────────────────────
    page.goto(f"{origin}/everything?tab=sessions", wait_until="networkidle")
    posts.clear()
    page.goto(f"{origin}/chat/{urllib.parse.quote(chat_id)}?q=1#t", wait_until="networkidle")
    try:
        page.wait_for_function(f"() => location.pathname === {json.dumps('/s/' + urllib.parse.quote(chat_id))}", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-chat-moves-session-miss.png"))
        fail("chat-is-its-session", f"{e} at {page.url}")
    landed = urllib.parse.urlparse(page.url)
    page.go_back(wait_until="networkidle")
    page.wait_for_timeout(400)
    back = urllib.parse.urlparse(page.url).path
    check("chat-is-its-session", landed.query == "q=1" and landed.fragment == "t" and back == "/everything",
          landed=landed.geturl(), back=back)
    page.go_forward(wait_until="networkidle")
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

    # ── 5. the shell's chat-run address → the run's session ────────────────────────────
    page.goto(f"{origin}/p/{PID}/chat/r-pay-2", wait_until="networkidle")
    try:
        page.wait_for_function("() => location.pathname === '/s/run%3Ar-pay-2'", timeout=15000)
    except Exception as e:  # noqa: BLE001
        fail("chat-run-session", f"{e} at {page.url}")
    check("chat-run-session", page.get_by_test_id("not-found").count() == 0, url=page.url)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
