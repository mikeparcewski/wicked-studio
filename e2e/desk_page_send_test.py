"""crew-0183 (studio 0.16.3): a send from a chat's own page never mounts the floating Ask window.

The operator: "why is chat opening up ask when I kick off a job? Supposed to stay inline - but opens ask, then
redirects to inline chat". On studio 0.16.2 every Send on a session page handed the words to the Ask dock, which opened
its floating window to open the chat and post, then stepped aside once the post was accepted: the window flashed for
~2.7 s on a first message and ~1.1 s on a reply.

The operator's path on the fixture's ask path (a real team path replay):
  1. Desk → type in "What do you want done?" → Start: a new chat's own page (`/s/<id>`), the words waiting unsent in
     its composer (DES-CATALOG-002 §8.6, unchanged). A daemon with the v2 command list gets there through
     `openCommandList`; the fixture serves no v2 catalog, so "start in chat" is saved and New job takes the same
     `openChatFlow` to the same page.
  2. Enter: the chat opens under THAT page's id; the helper answers on the page.
  3. A reply on the same page.
Through all of it, a MutationObserver installed before load records any node that IS (or holds) the floating window,
the system chat or its tray (`ask-panel`, `system-chat`, `chat-tray`), and a per-frame probe looks for them too: none
ever mounts. The URL stays `/s/<id>`, each message shows exactly once and the fixture saw exactly one POST per send,
and the system chat's stored chat (`sessionStorage['wicked.ask.session']`) is the one it held before.
At 1440x700 and 390x844, light and dark (the theme set before load); 0 page errors.

Captures: e2e/shots/desk-page-send-<w>x<h>-<theme>-{fresh,answered}.png. Env: FEEDBACK_PORT (default 4611).
"""
import json
import os
import re
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4611"))
SHOTS = REPO / "e2e" / "shots"

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

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
SESSION_RE = re.compile(r"/s/([0-9a-f-]{20,})$")
STORED_CHAT = json.dumps({"chatId": "kept-system-chat", "title": "the dock's own chat", "seeded": True, "scope": None})
DOCK_IDS = ["ask-panel", "system-chat", "chat-tray"]

WATCH = """(() => {
  if (window !== window.top) return;
  const ids = %s;
  window.__dock = [];
  const sel = ids.map((i) => `[data-testid="${i}"]`).join(',');
  const note = (how) => { const el = document.querySelector(sel); if (el) window.__dock.push({ how, id: el.dataset.testid, url: location.pathname, t: performance.now() }); };
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType === 1 && (n.matches?.(sel) || n.querySelector?.(sel))) note('mutation');
    }
  }).observe(document, { childList: true, subtree: true });
  const tick = () => { note('frame'); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();""" % json.dumps(DOCK_IDS)

YOU = """(text) => [...document.querySelectorAll('[data-testid="session-turn"][data-who="you"]')]
  .filter((t) => (t.innerText || '').includes(text)).length"""


def send_and_wait(page, n_posts: int, helpers: int, text: str, step: str) -> None:
    posts = []
    for _ in range(80):
        posts = ask_posts(origin)
        if len(posts) >= n_posts:
            break
        time.sleep(0.25)
    check(f"{step}-posted-once", len(posts) == n_posts and text in posts[-1]["text"], posts=[p["text"][:60] for p in posts])
    try:
        page.wait_for_function(
            """(n) => document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').length >= n""",
            arg=helpers, timeout=20000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-page-send-{step}-no-reply.png"))
        check(f"{step}-reply", False, url=page.url)
    page.wait_for_timeout(700)


def journey(browser, w: int, h: int, theme: str) -> None:
    phone = w < 768
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=phone, has_touch=phone)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    # Top document only, guarded: the init script also runs in sandboxed artifact frames, which have no storage.
    page.add_init_script(f"try {{ if (window === window.top && !sessionStorage.getItem('wicked.ask.session')) sessionStorage.setItem('wicked.ask.session', {json.dumps(STORED_CHAT)}); }} catch {{}}")
    page.add_init_script(WATCH)
    tag = f"{w}x{h}-{theme}"
    set_fixture(origin, sessions=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[],
                appearance={"theme": f"wicked-{theme}"})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.evaluate("""() => fetch('/api/v1/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'studio.composer': { deliverPr: true, startInChat: true } }) })""")
    page.goto(f"{origin}/", wait_until="networkidle")
    before = len(ask_posts(origin))

    # 1. Desk → words → Start: a new chat's own page, the words unsent.
    words = f"Add a health check endpoint ({tag})"
    page.get_by_test_id("desk-ask").locator("input").fill(words)
    page.get_by_test_id("desk-ask").locator("button[type=submit]").click()
    page.wait_for_url(SESSION_RE, timeout=8000)
    chat_id = SESSION_RE.search(page.url).group(1)
    page.get_by_test_id("session-fresh").wait_for(state="visible", timeout=8000)
    box = page.get_by_test_id("session-composer-input")
    check(f"start-lands-unsent-{tag}", box.input_value() == words and len(ask_posts(origin)) == before,
          value=box.input_value(), posts=len(ask_posts(origin)) - before)
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / f"desk-page-send-{tag}-fresh.png"))

    # 2. Enter: the chat opens under the page's id, the answer lands on the page, the window never mounts.
    box.click()
    box.press("Enter")
    send_and_wait(page, before + 1, 1, words, f"first-{tag}")
    posts = ask_posts(origin)
    check(f"first-opens-this-chat-{tag}", posts[-1]["chatId"] == chat_id, chat=chat_id, posted=posts[-1]["chatId"])

    # 3. A reply on the same page.
    reply = f"And add a test for it ({tag})"
    box = page.get_by_test_id("session-composer-input")
    box.click()
    box.fill(reply)
    box.press("Enter")
    send_and_wait(page, before + 2, 2, reply, f"reply-{tag}")
    page.evaluate("() => { const t = document.querySelector('[data-testid=session-thread]'); if (t) t.scrollTop = t.scrollHeight; }")
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / f"desk-page-send-{tag}-answered.png"))

    dock = page.evaluate("window.__dock")
    check(f"window-never-mounted-{tag}", dock == [], seen=dock[:5])
    check(f"stays-on-its-page-{tag}", SESSION_RE.search(page.url) is not None and SESSION_RE.search(page.url).group(1) == chat_id, url=page.url)
    check(f"each-message-once-{tag}", page.evaluate(YOU, words) == 1 and page.evaluate(YOU, reply) == 1,
          first=page.evaluate(YOU, words), reply=page.evaluate(YOU, reply))
    stored = page.evaluate("sessionStorage.getItem('wicked.ask.session')")
    check(f"system-chat-stored-chat-unchanged-{tag}", stored == STORED_CHAT, stored=stored)
    ctx.close()


with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h) in ((1440, 700), (390, 844)):
        for theme in ("light", "dark"):
            journey(browser, w, h, theme)
    set_fixture(origin, appearance=None)
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
