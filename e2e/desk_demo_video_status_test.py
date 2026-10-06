#!/usr/bin/env python3
"""
desk_demo_video_status_test.py — studio#507 at 1440x900, under STUDIO_SKIN=desk.

On the released 0.6.1 Desk the inline "Demo video" artifact played in place (S15d, #503), but its state
line ("✓ Ready to watch · 3 chapters · 1:45 · codex reviews, claude records") rendered half-hidden
behind the card's "Demo video" header. The preview's content (padding + the line + a fixed 150px
player) overran the 200px card by 19px, and `overflow: hidden` left the preview a scroll container —
so the first scroll-into-view (keyboard focus landing on the player: Tab from a chapter mark, a click
on its controls) slid the whole body up and the line went under the header.

Against the fixture's finished demo run (`r-walk-demo`) at `/s/run:r-walk-demo`, in BOTH themes (the
stored appearance's `theme`: the default dark is the bare stylesheet, light stamps `<html data-theme="light">`), at EVERY size (inline, pane, full):

  1. THE STATE LINE SITS BETWEEN THE HEADER AND THE PLAYER: its box does not intersect the header's
     and lies inside the card; the player's box is below it and inside the card too.
  2. …AND STAYS THERE WHEN THE PLAYER TAKES FOCUS: Shift+Tab from the first chapter mark puts the
     focus on the `<video>` (so the browser scrolls it into view if anything can scroll) — the same
     boxes hold, and the preview has nothing to scroll (scrollHeight == clientHeight, scrollTop 0).
  3. #503 HOLDS: the `<video>` in the pane and at full screen is the SAME node that was inline (no
     remount); Esc shrinks back FROM THE FOCUSED PLAYER (studio#509: a keyboard entry is kept on the
     player itself, where the artifact sees the key — inside the native controls' own buttons Chromium
     delivers no key to the page); 0 page errors; no horizontal scroll.

Then a narrow 960x700 card at inline: the same, and every chapter mark inside the card (the words
keep to the row and scroll on their own, never the body).

Captures: e2e/shots/desk-demo-video-status-{dark,light,dark-narrow}.png (inline). Env: FEEDBACK_PORT
(default 4464).
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4464"))
W, H = 1440, 900
SHOTS = REPO / "e2e" / "shots"
ART = '[data-testid="artifact"][data-kind="demo-video"]'

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


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

# The boxes that matter, read from the demo-video artifact: the card, its header, the walkthrough body
# (and whether it can scroll), the state line, the seats and the player.
BOXES = """() => {
  const a = document.querySelector('[data-testid="artifact"][data-kind="demo-video"]');
  if (!a) return null;
  const q = (id) => a.querySelector(`[data-testid="${id}"]`);
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
  const walk = q('walkthrough'); const v = q('walkthrough-video');
  return {
    size: a.dataset.size, theme: document.documentElement.getAttribute('data-theme'),
    card: r(a), head: r(q('artifact-head')), state: r(q('walkthrough-state')), seats: r(q('walkthrough-seats')), video: r(v),
    stateText: q('walkthrough-state') ? q('walkthrough-state').innerText.replace(/\\s+/g, ' ').trim() : null,
    scroll: walk ? { top: walk.scrollTop, height: walk.scrollHeight, client: walk.clientHeight } : null,
    markers: [...a.querySelectorAll('[data-testid="walkthrough-marker"]')].map(r),
    marked: !!v && v.__s507 === 1,
    focusOnVideo: document.activeElement === v,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""


def inside(inner: dict, outer: dict) -> bool:
    return inner["top"] >= outer["top"] and inner["bottom"] <= outer["bottom"] and inner["left"] >= outer["left"] and inner["right"] <= outer["right"]


def well_placed(d: dict) -> bool:
    """The state line below the header and inside the card; the player below the line and inside the card;
    the body with nothing to scroll."""
    if d is None or d["state"] is None or d["head"] is None or d["video"] is None:
        return False
    s, hd, c, v, sc = d["state"], d["head"], d["card"], d["video"], d["scroll"]
    return (s["top"] >= hd["bottom"] and inside(s, c)
            and (d["seats"] is None or (d["seats"]["top"] >= hd["bottom"] and inside(d["seats"], c)))
            and v["top"] >= s["bottom"] and inside(v, c)
            and sc is not None and sc["top"] == 0 and sc["height"] <= sc["client"])


def focus_player(page) -> None:
    """A keyboard user's way onto the player: Shift+Tab from the first chapter mark (the <video> with
    controls is the focusable thing before it in the tree)."""
    page.locator(f'{ART} [data-testid="walkthrough-marker"]').first.focus()
    page.keyboard.press("Shift+Tab")
    page.wait_for_timeout(300)


def morph_to(page, size: str) -> None:
    cur = page.evaluate(f"() => document.querySelector('{ART}').dataset.size")
    order = ["inline", "pane", "full"]
    while cur != size:
        if order.index(size) > order.index(cur):
            page.locator(f'{ART} [data-testid="artifact-grow"]').click()
        else:
            # Esc shrinks one step (rule 1) — from the focused player too (studio#509): a keyboard entry
            # onto the player is kept on the player itself, where the artifact sees the key. That real
            # path is what runs here: the key is pressed with the player focused, and it must shrink.
            on_player = page.evaluate("() => !!document.activeElement && document.activeElement.dataset.testid === 'walkthrough-video'")
            page.keyboard.press("Escape")
            if on_player:
                try:
                    page.wait_for_function(f"(s) => (document.querySelector('{ART}')||{{}}).dataset?.size === s", arg=order[order.index(cur) - 1], timeout=3000)
                    shrank = True
                except Exception:  # noqa: BLE001
                    shrank = False
                check("esc-from-player", shrank, size_before=cur, shrank=shrank)
        nxt = order[order.index(cur) + (1 if order.index(size) > order.index(cur) else -1)]
        page.wait_for_function(f"(s) => (document.querySelector('{ART}')||{{}}).dataset?.size === s", arg=nxt, timeout=5000)
        page.wait_for_timeout(500)
        cur = nxt


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # Both themes at 1440x900 over every size; then a narrow 960x700 card (the words wrap) at inline.
    for theme, (vw, vh), sizes in (("dark", (W, H), ("inline", "pane", "full")), ("light", (W, H), ("inline", "pane", "full")), ("dark", (960, 700), ("inline",))):
        attr = None if theme == "dark" else theme  # the default (dark) theme is the bare stylesheet: no data-theme on <html>
        tag = theme if vw == W else f"{theme}-narrow"
        page.set_viewport_size({"width": vw, "height": vh})
        set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[], reset_walkthrough=True,
                    appearance={**DEFAULT_APPEARANCE, "theme": theme})
        page.goto(f"{origin}/s/run%3Ar-walk-demo", wait_until="networkidle")
        page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
        try:
            page.wait_for_function(f"""() => {{ const v = document.querySelector('{ART} [data-testid="walkthrough-video"]'); return !!v && v.readyState >= 1; }}""", timeout=15000)
            page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=attr, timeout=5000)
        except Exception:
            page.screenshot(path=str(SHOTS / f"desk-demo-video-status-{tag}-missing.png"))
            fail(f"{tag}-inline-video", {"why": "the inline Demo video artifact holds no playable <video> under this theme", "found": page.evaluate(BOXES)})
        page.evaluate(f"""() => {{ document.querySelector('{ART} [data-testid="walkthrough-video"]').__s507 = 1; }}""")

        for size in sizes:
            morph_to(page, size)
            # ── 1 + 2. at rest, then with the focus on the player: the line between the header and the
            # player, the player inside the card, nothing to scroll — both read before either is judged,
            # so a red report shows the slide itself (the state line's top above the header's bottom).
            d0 = page.evaluate(BOXES)
            if size == "inline":
                page.screenshot(path=str(SHOTS / f"desk-demo-video-status-{tag}.png"))
            focus_player(page)
            d1 = page.evaluate(BOXES)
            if size == "inline" and not well_placed(d1):
                page.screenshot(path=str(SHOTS / f"desk-demo-video-status-{tag}-focused.png"))
            check(f"{tag}-{size}-state-line", d0 is not None and d0["size"] == size and d0["theme"] == attr
                  and (d0["stateText"] or "").startswith("✓ Ready to watch · 3 chapters") and well_placed(d0)
                  and d1 is not None and d1["focusOnVideo"] and d1["marked"] and well_placed(d1)
                  and all(inside(m, d1["card"]) for m in d1["markers"]) and len(d1["markers"]) == 3,
                  at_rest=d0, player_focused=d1)

        # ── 3. back to the thread: the same player, nothing broke ──────────────────
        morph_to(page, "inline")
        d2 = page.evaluate(BOXES)
        check(f"{tag}-back-and-clean", d2["size"] == "inline" and d2["marked"] and not d2["hscroll"] and errors == [],
              size=d2["size"], marked=d2["marked"], errors=errors[:3])

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
