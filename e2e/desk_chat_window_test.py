#!/usr/bin/env python3
"""
desk_chat_window_test.py — journey 2026-11-04 (apps-k5-chat's knowledge journey on :7721, shot 5-chat-query-on): in
the system chat's window the second reply was drawn inside the first reply's box, above the second question, and the
box's "chat session · claude · codex · pi · copilot" header sat over the first lines of the answer's code block.

The operator's path through the rail's Chat icon, on the fixture's chat (replies pushed as the daemon's own
`chatReply` frames). At 1440x700 and on a 390x844 phone, light and dark, it proves:

  1. ORDER: the thread reads q1, a1, q2, a2: each reply under its own question.
  2. NOTHING OVER THE ANSWER: no seat-chip header is drawn, the chat block has no scroller of its own, and the first
     line of each answer's code block is its own hit target when scrolled to (no header and no clip over it).
  3. 0 page errors.

Captures: e2e/shots/desk-chat-window-*.png. Env: FEEDBACK_PORT (default 4392).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4392"))
SHOTS = REPO / "e2e" / "shots"
Q1, Q2 = "how many open tickets per region?", "and now that query is on?"
SQL = "SELECT r.name AS region, count(*) AS open_tickets\nFROM support.tickets t\nJOIN support.regions r ON r.id = t.region_id\nWHERE t.status = 'open'\nGROUP BY r.name\nORDER BY open_tickets DESC"


def answer(n: int) -> str:
    return (f"FIRSTLINE-{n}: here is the query.\n\n```sql\n-- CODE-{n}\n{SQL}\n```\n\n"
            + "It counts only `status = 'open'`, so `pending` and `escalated` tickets are left out. " * 4)


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


def theme(page, t: str) -> None:
    page.evaluate("(t) => t === 'dark' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t)", t)


dist = ensure_build(fail)
origin = start_server(PORT, dist)

ORDER = """() => [...document.querySelectorAll('[data-testid="system-chat"] [data-testid="assist-user-msg"], [data-testid="system-chat"] [data-testid="assist-chat-msg"]')]
  .map((el) => { const own = el.getAttribute('data-testid') === 'assist-user-msg' || el.getAttribute('data-agent') === 'you';
    const t = (el.textContent || '').replace(/^(you|claude)/, '').trim(); return (own ? 'Q:' : 'A:') + t.slice(0, 40); })"""

# The first line of an answer's code block: scrolled to, is it what a pointer at it hits? (A header or an inner clip over
# it makes another element, or nothing in the message, the hit.)
CODE_HIT = """(n) => { const code = [...document.querySelectorAll('[data-testid="system-chat"] [data-testid="assist-chat-msg"] pre')]
    .find((p) => (p.textContent || '').includes('CODE-' + n));
  if (!code) return { found: false };
  code.scrollIntoView({ block: 'center' });
  const r = code.getBoundingClientRect(); const x = r.left + 24, y = r.top + 8; const hit = document.elementFromPoint(x, y);
  const header = [...document.querySelectorAll('[data-testid="system-chat"] [data-testid="assist-chat-seat"]')].filter((s) => s.getClientRects().length > 0).length;
  const block = code.closest('[data-testid="assist-chat"]');
  const scrollers = block ? [...block.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1 && !e.closest('pre'); }).length : -1;
  return { found: true, hitIsCode: !!hit && code.contains(hit), hit: hit && (hit.getAttribute('data-testid') || hit.tagName), visibleSeatChips: header, innerScrollers: scrollers, flow: block && block.getAttribute('data-flow') }; }"""

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
drawer_left_open = False
with sync_playwright() as p:
    browser = p.chromium.launch()
    for w, h in ((1440, 700), (390, 844)):
        set_fixture(origin, repo=True, chat_scope=True, chat_transcripts=True)
        page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
        page.add_init_script("try { sessionStorage.removeItem('wicked.ask.session'); } catch (e) {}")
        page.goto(f"{origin}/", wait_until="networkidle")
        if w < 600:  # the phone's rail is a drawer: its Chat icon is inside it
            page.get_by_test_id("rail-drawer-toggle").click()
            page.get_by_test_id("desk-rail-chat").wait_for(state="visible", timeout=8000)
        page.get_by_test_id("desk-rail-chat").click()
        box = page.get_by_test_id("assist-input")
        box.wait_for(timeout=15000)
        if w < 600 and page.get_by_test_id("rail-drawer-scrim").is_visible():
            drawer_left_open = True  # reported below: the drawer stays over the chat it opened
            page.get_by_test_id("rail-drawer-scrim").click(position={"x": 380, "y": 400})
            page.wait_for_timeout(400)
        box.fill(Q1)
        page.get_by_test_id("assist-send").click()
        try:
            page.wait_for_function("() => !!JSON.parse(sessionStorage.getItem('wicked.ask.session') || '{}').chatId", timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"desk-chat-window-nochat-{w}.png"))
            fail(f"chat-opened-{w}", str(e))
        chat_id = page.evaluate("() => JSON.parse(sessionStorage.getItem('wicked.ask.session') || '{}').chatId || ''")
        set_fixture(origin, chat_frames=[{"type": "chatReply", "chat": chat_id, "cliKey": "claude", "ok": True, "text": answer(1)}])
        page.locator('[data-testid="system-chat"] [data-testid="assist-chat-msg"][data-agent="claude"][data-pending="false"]').first.wait_for(timeout=15000)
        box.fill(Q2)
        page.get_by_test_id("assist-send").click()
        page.locator('[data-testid="system-chat"] [data-testid="assist-chat-msg"][data-agent="you"]').first.wait_for(timeout=15000)
        set_fixture(origin, chat_frames=[{"type": "chatReply", "chat": chat_id, "cliKey": "claude", "ok": True, "text": answer(2)}])
        page.locator('[data-testid="system-chat"] [data-testid="assist-chat-msg"][data-agent="claude"][data-pending="false"]').nth(1).wait_for(timeout=15000)
        page.wait_for_timeout(600)
        order = page.evaluate(ORDER)
        want = ["Q:" + Q1, "A:FIRSTLINE-1", "Q:" + Q2, "A:FIRSTLINE-2"]
        check(f"order-{w}x{h}", len(order) == 4 and all(o.startswith(x[:40]) for o, x in zip(order, want)), order=order)
        for n in (1, 2):
            r = page.evaluate(CODE_HIT, n)
            check(f"answer-{n}-uncovered-{w}x{h}", r.get("found") and r["hitIsCode"] and r["visibleSeatChips"] == 0 and r["innerScrollers"] == 0 and r["flow"] == "true", **r)
        for t in ("light", "dark"):
            theme(page, t)
            page.wait_for_timeout(300)
            page.evaluate(CODE_HIT, 2)
            page.wait_for_timeout(200)
            page.screenshot(path=str(SHOTS / f"desk-chat-window-{w}-{t}.png"))
        page.close()
    browser.close()

report["phone_drawer_left_open_over_chat"] = drawer_left_open
check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
