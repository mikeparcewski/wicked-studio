#!/usr/bin/env python3
"""
desk_watchtower_test.py — S14 (DES-STUDIO-REBUILD-001 §5.4, §11 S14): the Watchtower placed, at
1440x700 on the Desk.

Against the in-process fixture (wave-1 corpus, b1 waiting at a gate, `watch_feed` on):

  1. ONE COUNT: the Desk sentence's count is the count Nerve Center's "waits on you" item says (this
     fixture crew has no system snapshot, so the tile folds it from the needs-you count); the
     Watchtower feed's sentence counts the open items its own feed shows (UX audit row 55).
  2. THE FEED: /watch lists TR's rows newest first — the open claim finding with "Jump in", the
     fixed older one, finished runs — and never the gate-attached finding (that is a line on the
     gate card). The kind chips filter it (Problems → the problem rows only).
  3. JUMP IN: the claim finding's "Jump in" lands on b1's run page at its moment.
  4. ⌥W: from the Desk, ⌥W opens /watch.
  5. THE TILE: the rail's Nerve Center tile (DES-SYSTEM-VIEW, which replaced the pill) says the
     waiting work in words and opens /watch: the calm overview counts the waiting jobs in one line,
     and All the details opens its Attention tab; the feed is in the Runs tab (`/watch?tab=runs`).
  6. NO REGISTRY: with the registry off the page says so and still shows studio's own fold.
  7. EMPTY KINDS: every kind with no rows says why (never "Nothing of this kind yet.") and offers
     Show everything, which lands on Everything (DEST); at 390x844 that button is a 44 px tap target
     (MEASURE, getComputedStyle + the box).
  8. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-watchtower*.png. Env: FEEDBACK_PORT (default 4352).
"""

import json
import re
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4352"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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



CORPUS = dict(wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={}, extra_gates=[], extra_frames=[],
              trust_rules=False, gate_move=False)

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, **CORPUS, watch_feed=True)

    # ── 1. one count ───────────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    # Home v2: the landing's sentence carries the "need you" count once it is known.
    story = page.locator('[data-testid="desk-story"][data-count]')
    story.wait_for(state="visible", timeout=15000)
    desk = int(story.get_attribute("data-count") or "-1")
    # ── 5. the tile: the waiting work in words, and it opens /watch ────────────────
    tile = page.get_by_test_id("desk-rail-nerve")
    page.wait_for_function("() => document.querySelector('[data-testid=\"desk-rail-nerve\"]')?.dataset.read === 'fresh'", timeout=10000)
    tile_words = page.get_by_test_id("nerve-center-words").inner_text()
    tile_tone = tile.get_attribute("data-tone")
    page.screenshot(path=str(SHOTS / "desk-watchtower-tile.png"))
    tile.click()
    page.get_by_test_id("nerve-center-page").wait_for(state="visible", timeout=8000)
    # The overview (the approved ui-v2-nerve mockup) counts the waiting jobs in one line; All the details
    # opens the tabbed detail on its landing tab (Attention, while anything needs it).
    waiting_line = page.get_by_test_id("nc-waiting")
    waiting_line.wait_for(state="visible", timeout=8000)
    overview_count = int(waiting_line.get_attribute("data-count") or "-4")
    page.get_by_test_id("nc-details").click()
    waits = page.locator('[data-testid="nc-attention-item"][data-id="waiting-on-you"]')
    waits.wait_for(state="visible", timeout=8000)
    waits_text = waits.inner_text()
    landed = page.get_by_test_id("nerve-center-page").get_attribute("data-tab")
    # The feed is the Runs tab's (Nerve Center's tabs): one click away.
    page.locator('[data-testid="nc-tab"][data-tab="runs"]').click()
    page.get_by_test_id("watchtower").wait_for(state="visible", timeout=8000)
    said = re.search(r"(\d+) things? waits? on you", waits_text)
    pill = int(said.group(1)) if said else -2
    check("tile", tile_tone in ("yellow", "red") and tile_words.strip() != "" and "wait" in waits_text and landed == "attention"
          and overview_count == pill,
          words=tile_words, tone=tile_tone, waits=waits_text, landed=landed, overview=overview_count, pill=pill)
    sentence_count = int(page.get_by_test_id("watchtower-sentence").get_attribute("data-count") or "-3")
    page.locator('[data-testid="watchtower-row"]').first.wait_for(state="visible", timeout=8000)
    open_rows = page.locator('[data-testid="watchtower-row"][data-state="open"]').count()
    # UX audit row 55: the feed's header counts what its feed shows (open items); the Desk and
    # Nerve Center keep the one needs-you count.
    check("one-count", desk == pill and desk >= 1 and sentence_count == open_rows and page.url.endswith("/watch?tab=runs"),
          desk=desk, pill=pill, watchtower=sentence_count, open_rows=open_rows, url=page.url)

    # ── 2. the feed ────────────────────────────────────────────────────────────────
    page.locator('[data-testid="watchtower-row"][data-row-id="w-claim-b1"]').wait_for(state="visible", timeout=8000)
    ids = page.get_by_test_id("watchtower-row").evaluate_all("els => els.map(e => e.dataset.rowId)")
    states = page.get_by_test_id("watchtower-row").evaluate_all("els => Object.fromEntries(els.map(e => [e.dataset.rowId, e.dataset.state]))")
    page.screenshot(path=str(SHOTS / "desk-watchtower.png"))
    page.locator('[data-testid="watchtower-kind"][data-kind="problem"]').click()
    page.wait_for_timeout(300)
    problems = page.get_by_test_id("watchtower-row").evaluate_all("els => els.map(e => e.dataset.kind)")
    page.locator('[data-testid="watchtower-kind"][data-kind="all"]').click()
    check("feed", "w-claim-b1" in ids and "w-gate-b1" not in ids and states.get("w-old-b1") == "fixed"
          and ids.index("w-claim-b1") < ids.index("w-old-b1") and problems and set(problems) == {"problem"},
          ids=ids, states=states, problems=problems)

    # ── 3. jump in ─────────────────────────────────────────────────────────────────
    page.locator('[data-testid="watchtower-row"][data-row-id="w-claim-b1"] [data-testid="watchtower-jump"]').click()
    page.get_by_test_id("watch-jumped").wait_for(state="visible", timeout=8000)
    # S16a-1c: Jump in lands on the run's session thread (/s/run%3Ab1?jump=…), the moment intact.
    check("jump-in", "/s/run%3Ab1?jump=0:1:" in page.url, url=page.url)

    # ── 4. ⌥W from the Desk ────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.locator("body").click(position={"x": 700, "y": 20})
    page.keyboard.press("Alt+KeyW")
    try:
        page.get_by_test_id("nerve-center-page").wait_for(state="visible", timeout=5000)
        via_key = page.url.endswith("/watch")
    except Exception:  # noqa: BLE001
        via_key = False
    check("alt-w", via_key, url=page.url)

    # ── 6. no registry ─────────────────────────────────────────────────────────────
    set_fixture(origin, watch_feed=False)
    page.goto(f"{origin}/watch?tab=runs", wait_until="networkidle")
    page.get_by_test_id("watchtower").wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("watchtower-no-registry").wait_for(state="visible", timeout=8000)
        said = True
    except Exception:  # noqa: BLE001
        said = False
    own = page.get_by_test_id("watchtower-row").evaluate_all("els => els.map(e => e.dataset.source)")
    page.screenshot(path=str(SHOTS / "desk-watchtower-absent.png"))
    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-registry", said and "watch" not in own and not overflow, sources=own, overflow=overflow)

    # ── 7. empty kinds say why, and Show everything widens back ───────────────────
    set_fixture(origin, **CORPUS, watch_feed=True)
    empties: dict = {}
    for vw, vh in ((W, H), (390, 844)):
        page.set_viewport_size({"width": vw, "height": vh})
        page.goto(f"{origin}/watch?tab=runs", wait_until="networkidle")
        page.get_by_test_id("watchtower").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(500)
        for kind in ("problem", "decision", "approved", "rejected", "quiet", "done", "delivery"):
            page.locator(f'[data-testid="watchtower-kind"][data-kind="{kind}"]').click()
            page.wait_for_timeout(250)
            if page.get_by_test_id("watchtower-row").count() > 0:
                continue
            empty = page.get_by_test_id("watchtower-empty")
            text = empty.locator("p").inner_text() if empty.count() else None
            btn = page.get_by_test_id("watchtower-show-all")
            box = btn.bounding_box() if btn.count() else None
            min_h = btn.evaluate("e => getComputedStyle(e).minHeight") if btn.count() else None
            page.screenshot(path=str(SHOTS / f"desk-watchtower-empty-{kind}-{vw}.png"))
            btn.click()
            page.wait_for_timeout(250)
            landed = page.locator('[data-testid="watchtower-kind"][data-kind="all"]').get_attribute("aria-pressed")
            empties[f"{kind}@{vw}"] = {"text": text, "h": box["height"] if box else None, "min_h": min_h, "landed": landed}
    page.set_viewport_size({"width": W, "height": H})
    check("empty-kinds", bool(empties) and all(
        e["text"] and e["text"] != "Nothing of this kind yet." and e["landed"] == "true"
        and (not k.endswith("@390") or (e["h"] or 0) >= 44) for k, e in empties.items()), empties=empties)

    check("no-errors", not errors, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
