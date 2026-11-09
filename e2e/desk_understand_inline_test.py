"""crew-0183 (studio 0.16.3): Understand's Ask answers in Understand's own page chat; the floating Ask window never
mounts (operator: "why does understand open new panel? It's a weird user experience").

A guard: on studio 0.16.2 the Ask box already sends through the page's own chat (`askPage` → PageChat, variant
inline) and the dock's `askInChat` handoff had no caller; 0.16.3 deletes that handoff. On /understand at 1440x700 and
390x844, light and dark: type a question, press Ask. A MutationObserver and a per-frame probe never see `ask-panel`,
`system-chat` or `chat-tray`; the answer renders inside `understand-chat`; the question was posted exactly once; the
system chat's stored chat (`sessionStorage['wicked.ask.session']`) is unchanged.

Captures: e2e/shots/desk-understand-ask-<w>x<h>-<theme>-{before,answered}.png. Env: FEEDBACK_PORT (default 4613).
"""
import json
import os
import re
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4613"))
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

def journey(browser, w: int, h: int, theme: str) -> None:
    phone = w < 768
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=phone, has_touch=phone)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.add_init_script(f"try {{ if (window === window.top && !sessionStorage.getItem('wicked.ask.session')) sessionStorage.setItem('wicked.ask.session', {json.dumps(STORED_CHAT)}); }} catch {{}}")
    page.add_init_script(WATCH)
    tag = f"{w}x{h}-{theme}"
    set_fixture(origin, sessions=True, repo=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[],
                appearance={"theme": f"wicked-{theme}"})
    page.goto(f"{origin}/understand", wait_until="networkidle")
    before = len(ask_posts(origin))
    question = f"Where is the login handled? ({tag})"
    page.get_by_test_id("understand-ask-input").fill(question)
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / f"desk-understand-ask-{tag}-before.png"))
    page.get_by_test_id("understand-ask-send").click()
    posts = []
    for _ in range(80):
        posts = ask_posts(origin)
        if len(posts) > before:
            break
        time.sleep(0.25)
    time.sleep(1.0)
    posts = ask_posts(origin)
    check(f"asked-once-{tag}", len(posts) == before + 1 and question in posts[-1]["text"], posts=[p["text"][:60] for p in posts[before:]])
    chat = page.get_by_test_id("understand-chat")
    try:
        page.wait_for_function("""() => { const c = document.querySelector('[data-testid="understand-chat"]');
            return !!c && /stand-in|answer|fixture|helper|greet/i.test(c.innerText) && c.innerText.length > 80; }""", timeout=20000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-understand-ask-{tag}-no-answer.png"))
        check(f"answer-in-page-{tag}", False, text=chat.inner_text()[:400] if chat.count() else None)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(SHOTS / f"desk-understand-ask-{tag}-answered.png"))
    check(f"answer-in-page-{tag}", chat.is_visible() and question.split(" (")[0] in chat.inner_text(), text=chat.inner_text()[:200])
    dock = page.evaluate("window.__dock")
    check(f"window-never-mounted-{tag}", dock == [], seen=dock[:5])
    check(f"stays-on-understand-{tag}", page.url.rstrip("/").endswith("/understand"), url=page.url)
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
