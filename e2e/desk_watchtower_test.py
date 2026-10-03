#!/usr/bin/env python3
"""
desk_watchtower_test.py — S14 (DES-STUDIO-REBUILD-001 §5.4, §11 S14): the Watchtower placed, at
1440x700 under STUDIO_SKIN=desk.

Against the in-process fixture (wave-1 corpus, b1 waiting at a gate, `watch_feed` on):

  1. ONE COUNT: the Desk's "N things need you", the rail pill's count and the Watchtower's
     sentence are the same number.
  2. THE FEED: /watch lists TR's rows newest first — the open claim finding with "Jump in", the
     fixed older one, finished runs — and never the gate-attached finding (that is a line on the
     gate card). The kind chips filter it (Problems → the problem rows only).
  3. JUMP IN: the claim finding's "Jump in" lands on b1's run page at its moment.
  4. ⌥W: from the Desk, ⌥W opens /watch.
  5. THE PILL: its card is hidden at rest, shows on hover (the sentence + the newest open row),
     and the pill opens /watch.
  6. NO REGISTRY: with the registry off the page says so and still shows studio's own fold.
  7. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-watchtower*.png. Env: FEEDBACK_PORT (default 4352).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4352"))
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


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

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
    desk = int(page.get_by_test_id("desk-headline").get_attribute("data-count") or "-1")
    pill = int(page.get_by_test_id("watch-pill").get_attribute("data-count") or "-2")
    card_hidden = not page.get_by_test_id("watch-pill-card").is_visible()

    # ── 5. the pill's card: hidden at rest, shown on hover ─────────────────────────
    page.get_by_test_id("watch-pill").hover()
    page.get_by_test_id("watch-pill-card").wait_for(state="visible", timeout=5000)
    card = page.get_by_test_id("watch-pill-card").inner_text()
    card_rows = page.get_by_test_id("watch-pill-row").all_inner_texts()
    page.screenshot(path=str(SHOTS / "desk-watchtower-pill.png"))
    check("pill-card", card_hidden and "need" in card and len(card_rows) >= 1, card=card, rows=card_rows)

    page.get_by_test_id("watch-pill").click()
    page.get_by_test_id("watchtower").wait_for(state="visible", timeout=8000)
    sentence_count = int(page.get_by_test_id("watchtower-sentence").get_attribute("data-count") or "-3")
    check("one-count", desk == pill == sentence_count and desk >= 1 and page.url.endswith("/watch"),
          desk=desk, pill=pill, watchtower=sentence_count, url=page.url)

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
    # /runs/b1 lands, and the legacy project redirect may carry it to /p/<project>/build/b1, jump intact.
    check("jump-in", "/b1?jump=0:1:" in page.url, url=page.url)

    # ── 4. ⌥W from the Desk ────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.locator("body").click(position={"x": 700, "y": 20})
    page.keyboard.press("Alt+KeyW")
    try:
        page.get_by_test_id("watchtower").wait_for(state="visible", timeout=5000)
        via_key = page.url.endswith("/watch")
    except Exception:  # noqa: BLE001
        via_key = False
    check("alt-w", via_key, url=page.url)

    # ── 6. no registry ─────────────────────────────────────────────────────────────
    set_fixture(origin, watch_feed=False)
    page.goto(f"{origin}/watch", wait_until="networkidle")
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

    check("no-errors", not errors, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
