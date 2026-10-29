#!/usr/bin/env python3
"""
desk_chat_native_artifacts_test.py — DES-CHAT-NATIVE-RUN, what a run MADE (operator 2026-10-17: "have we made sure the
editor preview is built into that flow?"). Claude-artifacts / ChatGPT-canvas style: an artifact is a rich preview card
INSIDE the producing agent's message bubble, in the 768 px column, and it morphs in place — one mechanism
(RunArtifacts → PluginArtifact / ArtifactMorph), never a fork.

  a. A DOCUMENT (wicked-page plugin, r-doc-bound): its card (live frame, title, version) sits in an agent bubble
     ("… · made this"); Full screen opens the editor over the page and Escape brings back the SAME card in the
     same bubble (one plugin frame throughout).
  b. A DECK (wicked-deck plugin): the same, in a bubble.
  c. A DEMO VIDEO (r-walk-demo): an inline player in the bubble that fits at 1440x700 (its bottom on screen);
     Open → the side pane with the conversation still visible beside it → Shrink → back in the bubble.
  d. AN OLD RUN WITH WHAT IT MADE, opened fresh: the document run finished and archived; the page opens at its final
     message, and the document's card is still in its bubble above it.
  e. Light and dark at 1440x700 and a phone (390x844): the bubble stays in the column, no horizontal scroll.
     0 page errors.

The point-to-chip path ("about: …" from the full editor into this chat's composer) is the editors' own journeys'
(desk_page_editor, desk_deck_editor), which run on this same placement.

Captures: e2e/shots/desk-chat-native-art-*.png. Env: FEEDBACK_PORT (default 4484).
"""

import json
import os
import re
import sys
import time
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, NOW0, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4484"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
PAGE_DOC, DECK_DOC = "offsite-plan", "library-deck"
RUN = "r-doc-bound"

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


def post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"{}")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

# Where an artifact sits: inside an agent's message bubble, in the conversation column.
WHERE = """(sel) => {
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  const card = document.querySelector(sel);
  const msg = card ? card.closest('[data-testid="chat-artifacts"]') : null;
  const bubble = msg ? msg.querySelector(':scope > .wk-chat-body') : null;
  const thread = document.querySelector('[data-testid="session-thread"]');
  const who = msg ? msg.querySelector('[data-testid="turn-who"]') : null;
  return {
    inBubble: !!(bubble && bubble.contains(card)),
    who: who ? who.innerText.replace(/\\s+/g, ' ').trim() : null,
    card: box(card), bubble: box(bubble), thread: box(thread),
    bubbleBg: bubble ? getComputedStyle(bubble).backgroundColor : null,
    text: card ? card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) : null,
    frames: document.querySelectorAll('[data-testid="editor-frame"]').length,
    fullShell: !!document.querySelector('[data-testid="full-shell"]'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""
VIDEO = """() => {
  const a = document.querySelector('[data-testid="artifact"][data-kind="demo-video"]');
  const v = a ? a.querySelector('[data-testid="walkthrough-video"]') : null;
  const b = v ? v.getBoundingClientRect() : null;
  const thread = document.querySelector('[data-testid="session-thread"]');
  const tb = thread ? thread.getBoundingClientRect() : null;
  return { size: a ? a.dataset.size : null, inBubble: !!(a && a.closest('[data-testid="chat-artifacts"] > .wk-chat-body')),
           video: b ? { w: Math.round(b.width), bottom: Math.round(b.bottom), ready: v.readyState } : null,
           thread: tb ? { w: Math.round(tb.width), visible: tb.width > 200 && getComputedStyle(thread).visibility !== 'hidden' } : null };
}"""

errors: list[str] = []


def new_page(browser, w: int, h: int, theme: str):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return ctx, page


def doc_run(page, doc: str, theme: str, editor: str, **extra) -> dict:
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, run_chat_id=True, doc_bound_run={"pid": PID, "doc": doc},
                editors=True, extra_frames=[], sessions=False, walkthrough=False, **extra)
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    card = f'[data-testid="plugin-card"][data-editor="{editor}"]'
    try:
        page.locator(card).wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-chat-native-art-{editor}-missing.png"))
        fail(f"{editor}-{theme}-card", {"why": f"no {editor} card on the run's page"})
    page.wait_for_timeout(1500)
    return page.evaluate(WHERE, card)


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": PAGE_DOC, "brief": "the offsite plan"})
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DECK_DOC, "brief": "the pitch, four slides", "style": "ppt"})

    for theme in ("light", "dark"):
        ctx, page = new_page(browser, W, H, theme)
        # ── a. a document: the card in the agent's bubble; full screen and back, one frame ────────
        d = doc_run(page, PAGE_DOC, theme, "wicked-page")
        page.screenshot(path=str(SHOTS / f"desk-chat-native-art-doc-{theme}.png"))
        check(f"{theme}-doc-in-bubble", d["inBubble"] and re.match(r"^studio · made this( · [0-9:–A-Za-z ]+)?$", d["who"] or "") is not None and "Version 1" in (d["text"] or "")
              and d["bubble"]["l"] >= d["thread"]["l"] and d["bubble"]["r"] <= d["thread"]["r"] and d["bubble"]["w"] <= 768
              and d["bubbleBg"] not in (None, "rgba(0, 0, 0, 0)") and not d["hscroll"], where=d)
        page.locator('[data-testid="plugin-card"][data-editor="wicked-page"]').get_by_test_id("plugin-card-full").click()
        page.get_by_test_id("full-shell").wait_for(state="visible", timeout=8000)
        page.wait_for_timeout(500)
        full = page.evaluate(WHERE, '[data-testid="plugin-card"][data-editor="wicked-page"]')
        page.screenshot(path=str(SHOTS / f"desk-chat-native-art-doc-full-{theme}.png"))
        page.keyboard.press("Escape")
        page.get_by_test_id("full-shell").wait_for(state="detached", timeout=8000)
        page.wait_for_timeout(400)
        back = page.evaluate(WHERE, '[data-testid="plugin-card"][data-editor="wicked-page"]')
        check(f"{theme}-doc-full-and-back", full["fullShell"] and full["frames"] == 1 and back["inBubble"] and back["frames"] == 1
              and not back["fullShell"], full=full, back=back)

        # ── b. a deck: in a bubble too ──────────────────────────────────────────────────────────
        d = doc_run(page, DECK_DOC, theme, "wicked-deck", deck_adapt_ms=600)
        page.screenshot(path=str(SHOTS / f"desk-chat-native-art-deck-{theme}.png"))
        check(f"{theme}-deck-in-bubble", d["inBubble"] and "made this" in (d["who"] or "") and d["bubble"]["w"] <= 768 and not d["hscroll"], where=d)

        # ── c. a demo video: an inline player in the bubble that fits; the pane keeps the chat beside it ──
        set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, sessions=True, run_chat_id=True, walkthrough=True,
                    walk_recorded=3, extra_frames=[], reset_walkthrough=True, doc_bound_run=None, editors=False)
        page.goto(f"{origin}/s/run%3Ar-walk-demo", wait_until="networkidle")
        page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="walkthrough-video"]').wait_for(state="visible", timeout=15000)
        page.wait_for_function("""() => { const v = document.querySelector('[data-testid="artifact"][data-kind="demo-video"] [data-testid="walkthrough-video"]'); return !!v && v.readyState >= 1; }""", timeout=15000)
        # The operator scrolls the video into view (the page opens at the newest message).
        page.locator('[data-testid="artifact"][data-kind="demo-video"]').scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        v0 = page.evaluate(VIDEO)
        page.screenshot(path=str(SHOTS / f"desk-chat-native-art-video-{theme}.png"))
        check(f"{theme}-video-in-bubble-fits", v0["inBubble"] and v0["size"] == "inline" and v0["video"] is not None
              and v0["video"]["w"] >= 200 and v0["video"]["bottom"] <= H and v0["video"]["ready"] >= 1, video=v0)
        # The card's own head control (⤢) opens it beside the conversation (a click ON the player plays it).
        page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="artifact-grow"]').click()
        page.locator('[data-testid="artifact"][data-kind="demo-video"][data-size="pane"]').wait_for(state="visible", timeout=8000)
        page.wait_for_timeout(400)
        v1 = page.evaluate(VIDEO)
        page.screenshot(path=str(SHOTS / f"desk-chat-native-art-video-pane-{theme}.png"))
        page.locator('[data-testid="artifact"][data-kind="demo-video"]').get_by_test_id("artifact-shrink").first.click()
        page.locator('[data-testid="artifact"][data-kind="demo-video"][data-size="inline"]').wait_for(state="visible", timeout=8000)
        v2 = page.evaluate(VIDEO)
        check(f"{theme}-video-pane-and-back", v1["size"] == "pane" and v1["thread"] is not None and v1["thread"]["visible"]
              and v2["size"] == "inline" and v2["inBubble"], pane=v1, back=v2)
        ctx.close()

    # ── d. an old run with what it made, opened fresh (a new browser: no place, no receipts) ─────────
    ctx, page = new_page(browser, W, H, "light")
    ended = int((NOW0 - 9 * 86400 * 1000) / 1000)
    d = doc_run(page, PAGE_DOC, "light", "wicked-page", status_over={RUN: "completed"},
                session_over={RUN: {"archived_at": ended + 600, "ended_at": ended, "created_at": ended - 1800}})
    final = page.locator(f'[data-testid="session-run"][data-run-id="{RUN}"] [data-testid="chat-final"]')
    final.wait_for(state="visible", timeout=10000)
    in_view = page.evaluate("""() => { const t = document.querySelector('[data-testid="session-thread"]').getBoundingClientRect();
      const f = document.querySelector('[data-testid="chat-final"]').getBoundingClientRect(); return f.top < t.bottom && f.bottom > t.top; }""")
    page.screenshot(path=str(SHOTS / "desk-chat-native-art-old-light.png"))
    check("old-run-keeps-what-it-made", d["inBubble"] and in_view and final.get_by_test_id("chat-final-text").inner_text().startswith("Done."),
          where=d, final_in_view=in_view)
    ctx.close()

    # ── e. phone ───────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844, "light")
    d = doc_run(page, PAGE_DOC, "light", "wicked-page", status_over={}, session_over={})
    page.locator('[data-testid="plugin-card"][data-editor="wicked-page"]').scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-chat-native-art-doc-phone.png"))
    d = page.evaluate(WHERE, '[data-testid="plugin-card"][data-editor="wicked-page"]')
    check("phone-doc-in-bubble", d["inBubble"] and not d["hscroll"] and d["bubble"]["r"] <= 390, where=d)
    set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[], reset_walkthrough=True,
                doc_bound_run=None, editors=False)
    page.goto(f"{origin}/s/run%3Ar-walk-demo", wait_until="networkidle")
    page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="walkthrough-video"]').wait_for(state="visible", timeout=15000)
    page.locator('[data-testid="artifact"][data-kind="demo-video"]').scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "desk-chat-native-art-video-phone.png"))
    vp = page.evaluate(VIDEO)
    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("phone-video-in-bubble", vp["inBubble"] and vp["video"] is not None and vp["video"]["w"] <= 390 and not hs, video=vp)
    ctx.close()

    check("no-page-errors", errors == [], errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
