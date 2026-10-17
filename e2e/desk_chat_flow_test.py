"""The chat flow (operator 2026-10-16): "No option in new job modal for just starting with chat" and
"Clicking checking the don't show box on 'New Job' modal means new job just opens ask after - it should
bring to chat flow." Plus "In the chat view we're not putting bubbles for the agent messages".

The operator's path, through the real buttons, on the fixture's ask path (a real team path replay):
  1. Desk → New job: the picker's FIRST card is "Start with chat", focused. Clicking it lands on a NEW
     CHAT'S OWN PAGE (`/s/<id>`, "New chat", its composer) — not the Ask side dock.
  2. Typing a question there and pressing Send opens the chat under THAT page's id (the fixture's POST
     /chats/:id/messages names it), the page stays where it is, the operator's words are a bubble on
     the right and the helper's reply is a bubble on the left, labelled with the helper.
  3. New job → tick "Don't show this again — start in chat": the picker closes onto a new chat's page;
     after a reload, New job goes straight to a new chat's page (no picker, no dock).
  4. Settings → View → "Show New job" turns it back.
At 1440x700 and on a 390px phone (1 and 3), light and dark; 0 page errors.

Captures: e2e/shots/desk-chat-flow-*.png. Env: FEEDBACK_PORT (default 4602).
"""
import json
import os
import re
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4602"))
SHOTS = REPO / "e2e" / "shots"
W, H = 1440, 700

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def ask_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/ask-posts", timeout=10) as res:
        return json.loads(res.read())["posts"]


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, sessions=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[])

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
SESSION_RE = re.compile(r"/s/([0-9a-f-]{20,})$")
STORED = "async () => ((await (await fetch('/api/v1/settings')).json()).settings || {})['studio.composer'] || null"

# A bubble: a box with its own background and rounded corners, on one side of the thread.
BUBBLES = """() => {
  const thread = document.querySelector('[data-testid="session-thread"]').getBoundingClientRect();
  return [...document.querySelectorAll('[data-testid="session-turn"]')].map((t) => {
    const cs = getComputedStyle(t); const r = t.getBoundingClientRect();
    return { who: t.dataset.who, kickoff: t.dataset.kickoff === 'true', pending: t.dataset.pending === 'true',
      bg: cs.backgroundColor, radius: parseFloat(cs.borderTopRightRadius), border: cs.borderTopStyle,
      side: (r.left - thread.left) < (thread.right - r.right) ? 'left' : 'right',
      label: t.querySelector('[data-testid="turn-who"]')?.innerText ?? null, text: t.innerText.slice(0, 80) };
  });
}"""


def theme(page, t: str) -> None:
    page.evaluate("(t) => t === 'dark' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t)", t)
    page.wait_for_timeout(150)


def landed_on_new_chat(page, step: str) -> str:
    page.wait_for_url(SESSION_RE, timeout=8000)
    page.get_by_test_id("session").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("session-fresh").wait_for(state="visible", timeout=8000)
    chat_id = SESSION_RE.search(page.url).group(1)
    got = page.evaluate("""() => ({ conv: document.querySelector('[data-testid="session"]').dataset.conversation,
      title: document.querySelector('[data-testid="session-title"]')?.innerText ?? null,
      composer: !!document.querySelector('[data-testid="session-composer-input"]'),
      dock: document.querySelectorAll('[data-testid="assist-dock"], [data-testid="assist-input"]').length,
      wizard: document.querySelectorAll('[data-testid="launch-wizard"]').length })""")
    check(step, got["conv"] == "fresh" and got["title"] == "New chat" and got["composer"] and got["dock"] == 0 and got["wizard"] == 0,
          url=page.url, got=got)
    return chat_id


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/", wait_until="networkidle")
    page.evaluate("""() => fetch('/api/v1/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'studio.composer': { deliverPr: true, startInChat: false } }) })""")
    page.goto(f"{origin}/", wait_until="networkidle")

    # 1. New job offers "Start with chat" first, and it lands on a new chat's page — and an Ask panel
    #    left open (another conversation) closes (codex r1).
    page.get_by_test_id("desk-chat").click()
    page.get_by_test_id("assist-input").wait_for(state="visible", timeout=8000)
    # The Ask panel covers the Desk's buttons: New job from ⌘K, as an operator in Ask would reach it.
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("palette-input").fill("> New job")
    page.keyboard.press("Enter")
    page.get_by_test_id("launch-wizard-cards").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(300)
    first = page.evaluate("""() => { const b = document.querySelector('[data-testid="launch-wizard-cards"] button');
      return { id: b?.dataset.testid, text: b?.innerText, focused: document.activeElement === b }; }""")
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        page.screenshot(path=str(SHOTS / f"desk-chat-flow-newjob-{t}.png"))
    check("newjob-offers-chat-first", first["id"] == "launch-wizard-start-chat" and "Start with chat" in (first["text"] or "") and first["focused"], first=first)
    page.get_by_test_id("launch-wizard-start-chat").click()
    chat_id = landed_on_new_chat(page, "start-with-chat-lands-in-chat")
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        page.screenshot(path=str(SHOTS / f"desk-chat-flow-fresh-{t}.png"))

    # 2. The first Send opens THIS chat; the page stays; bubbles on both sides.
    box = page.get_by_test_id("session-composer-input")
    box.click()
    box.fill("why does greet() not trim its input?")
    page.get_by_test_id("session-composer-send").click()
    posts = []
    for _ in range(60):
        posts = ask_posts(origin)
        if posts:
            break
        time.sleep(0.25)
    check("first-send-opens-this-chat", len(posts) == 1 and posts[0]["chatId"] == chat_id, posts=posts, page_chat=chat_id)
    try:
        page.wait_for_function("""() => document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').length >= 1""", timeout=20000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-chat-flow-reply-missing.png"))
        check("reply", False, bubbles=page.evaluate(BUBBLES), url=page.url)
    page.wait_for_timeout(400)
    page.evaluate("() => { const t = document.querySelector('[data-testid=session-thread]'); t.scrollTop = t.scrollHeight; }")
    page.wait_for_timeout(200)
    bubbles = page.evaluate(BUBBLES)
    for t in ("wicked-light", "wicked-dark", "light", "dark"):
        theme(page, t)
        page.screenshot(path=str(SHOTS / f"desk-chat-flow-bubbles-{t}.png"))
    you = [b for b in bubbles if b["who"] == "you" and not b["kickoff"]]
    helper = [b for b in bubbles if b["who"] == "helper" and not b["pending"]]
    check("stays-on-its-page", SESSION_RE.search(page.url) is not None and SESSION_RE.search(page.url).group(1) == chat_id
          and page.get_by_test_id("assist-dock").count() == 0, url=page.url)
    check("helper-reply-is-a-bubble-on-the-left",
          len(helper) >= 1 and all(b["side"] == "left" and b["bg"] not in ("rgba(0, 0, 0, 0)", "transparent") and b["radius"] >= 8
                                   and b["border"] == "solid" and (b["label"] or "").strip() != "" for b in helper)
          and len(you) >= 1 and all(b["side"] == "right" for b in you), bubbles=bubbles)

    # 3. "Don't show this again" lands in the chat flow, now and after a reload.
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-skip-toggle").click()
    second = landed_on_new_chat(page, "ticked-lands-in-chat")
    stored = None
    for _ in range(40):
        stored = page.evaluate(STORED)
        if isinstance(stored, dict) and stored.get("startInChat") is True:
            break
        page.wait_for_timeout(100)
    check("ticked-saved", isinstance(stored, dict) and stored.get("startInChat") is True and second != chat_id, stored=stored)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    third = landed_on_new_chat(page, "reload-new-job-is-chat")
    check("each-new-job-is-a-new-chat", third not in (chat_id, second))
    page.screenshot(path=str(SHOTS / "desk-chat-flow-after-reload.png"))

    # 4. Settings → View turns it back.
    page.goto(f"{origin}/system", wait_until="networkidle")
    toggle = page.get_by_test_id("show-new-job-toggle")
    toggle.wait_for(state="visible", timeout=8000)
    toggle.click()
    for _ in range(40):
        stored = page.evaluate(STORED)
        if isinstance(stored, dict) and stored.get("startInChat") is False:
            break
        page.wait_for_timeout(100)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-cards").wait_for(state="visible", timeout=8000)
    check("settings-restores-picker", True)
    ctx.close()

    # Phone: the card and the new chat's page.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-start-chat").wait_for(state="visible", timeout=8000)
    page.screenshot(path=str(SHOTS / "desk-chat-flow-newjob-phone.png"))
    page.get_by_test_id("launch-wizard-start-chat").click()
    landed_on_new_chat(page, "phone-start-with-chat-lands-in-chat")
    over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    page.screenshot(path=str(SHOTS / "desk-chat-flow-fresh-phone.png"))
    check("phone-no-sideways", over <= 0, over=over)
    ctx.close()

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
