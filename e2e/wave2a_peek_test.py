#!/usr/bin/env python3
"""
wave2a_peek_test.py — studio wave 2a, behaviour 3: PEEK, JUMP, BACK (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` corpus plus
`wave2a_feed` (r1's feed is long enough to scroll).

  where    /p/gamma/build/r1; the feed (`[data-testid=thread]`) scrolled to its middle;
           focus parked on the run header's "Draft update" button.
  arrival  a gate arrives on b1 (project beta): `gate_now` + a live awaitingHuman frame.
  peek     P → the peek card shows the top gate (b1's prompt: its evidence) in place;
           the URL is byte-identical to before.
  jump     G → the address is b1's gate (/p/beta/build/b1#gate; the thread consumes the hash
           and focuses the gate prompt).
  back     B → the address is /p/gamma/build/r1 again, the feed's scrollTop is within
           10px of where it was, and focus is back on "Draft update".
  overlay  ? lists all three keys under their own section.

Capture: e2e/shots/wave2a-peek.png, wave2a-jump.png, wave2a-back.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4351). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import GATE_NOW_PROMPT, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4351"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
FEED = '[data-testid="thread"]'

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def wait_ok(page, js: str, timeout: int = 10000) -> bool:
    try:
        page.wait_for_function(js, timeout=timeout)
        return True
    except Exception:  # noqa: BLE001 — the caller reports
        return False


def feed_top(page) -> float:
    return page.evaluate(f"() => document.querySelector({json.dumps(FEED)}).scrollTop")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, wave1=True, wave2a_feed=True, gate_now=[], gate_simple=[], status_over={},
                extra_gates=[])
    page.goto(f"{origin}/p/gamma/build/r1", wait_until="networkidle")
    page.locator(FEED).wait_for(state="visible", timeout=15000)
    check("feed-is-long", wait_ok(
        page, f"() => {{ const f = document.querySelector({json.dumps(FEED)});"
              " return f && f.scrollHeight - f.clientHeight > 400; }", 15000),
        dims=page.evaluate(f"() => {{ const f = document.querySelector({json.dumps(FEED)});"
                           " return f && [f.scrollHeight, f.clientHeight]; }"))
    page.wait_for_timeout(1200)  # let the live-follow pin to the tail settle

    # ── where you were: the feed at its middle, focus on a header control ──────
    middle = page.evaluate(
        f"() => {{ const f = document.querySelector({json.dumps(FEED)});"
        " const m = Math.round((f.scrollHeight - f.clientHeight) / 2); f.scrollTop = m; return m; }")
    page.wait_for_timeout(300)
    page.get_by_test_id("run-draft-update").focus()
    before = feed_top(page)
    check("feed-at-middle", abs(before - middle) <= 2, middle=middle, before=before)

    # ── a gate arrives on b1 (beta) ─────────────────────────────────────────────
    set_fixture(origin, gate_now=["b1"],
                extra_gates=[{"session": "b1", "ord": 3, "prompt": GATE_NOW_PROMPT}])
    page.wait_for_timeout(3000)  # the frame drains on the next /ws tick; the list reconciles
    href_before = page.evaluate("() => window.location.href")
    check("still-on-r1", page.evaluate("() => window.location.pathname") == "/p/gamma/build/r1")
    before = feed_top(page)

    # ── peek ────────────────────────────────────────────────────────────────────
    page.keyboard.press("p")
    card = page.get_by_test_id("peek-card")
    check("peek-card-shows", wait_ok(page, "() => !!document.querySelector('[data-testid=\"peek-card\"]')", 5000))
    check("peek-is-b1", card.get_attribute("data-run-id") == "b1", run=card.get_attribute("data-run-id"))
    check("peek-shows-evidence", wait_ok(
        page, f"() => (document.querySelector('[data-testid=\"peek-card\"]')?.textContent ?? '').includes({json.dumps(GATE_NOW_PROMPT[:40])})",
        5000), text=card.text_content())
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "wave2a-peek.png"))
    check("peek-url-unchanged", page.evaluate("() => window.location.href") == href_before,
          url=page.evaluate("() => window.location.href"))

    # ── jump ────────────────────────────────────────────────────────────────────
    page.keyboard.press("g")
    # The gate's address is /p/beta/build/b1#gate; the thread consumes the one-shot `#gate` on
    # arrival (SteeringGate) by scrolling the gate card in and focusing its prompt — so "at the
    # gate" is: the b1 thread, with the gate prompt holding focus.
    check("jump-to-b1-gate", wait_ok(
        page, "() => window.location.pathname === '/p/beta/build/b1'"
              " && (window.location.hash === '#gate'"
              "     || document.activeElement?.getAttribute('data-testid') === 'steering-prompt')"),
        url=page.evaluate("() => window.location.href"),
        focused=page.evaluate("() => document.activeElement?.getAttribute('data-testid')"))
    check("peek-closed-on-jump", page.get_by_test_id("peek-card").count() == 0)
    page.wait_for_timeout(800)
    page.screenshot(path=str(SHOTS / "wave2a-jump.png"))

    # ── back to exactly where you were ──────────────────────────────────────────
    page.keyboard.press("b")
    check("back-to-r1", wait_ok(page, "() => window.location.pathname === '/p/gamma/build/r1'"),
          url=page.evaluate("() => window.location.href"))
    restored = wait_ok(
        page, f"() => {{ const f = document.querySelector({json.dumps(FEED)});"
              f" return !!f && Math.abs(f.scrollTop - {before}) <= 10; }}", 8000)
    page.wait_for_timeout(1500)  # and it STAYS there (no late live-follow pin)
    after = feed_top(page)
    page.screenshot(path=str(SHOTS / "wave2a-back.png"))
    check("back-scroll-within-10px", restored and abs(after - before) <= 10, before=before, after=after)
    focused = page.evaluate("() => document.activeElement?.getAttribute('data-testid')")
    check("back-focus-restored", focused == "run-draft-update", focused=focused)

    # ── the ? overlay documents all three keys ──────────────────────────────────
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Shift+?")
    ov = page.get_by_test_id("shortcut-overlay")
    ov.wait_for(state="visible", timeout=5000)
    text = ov.text_content() or ""
    check("overlay-lists-peek-jump-back",
          all(s in text for s in ("Peek at the top item that needs you",
                                  "Jump to the top item that needs you",
                                  "Back to exactly where you were")), text=text[-600:])
    page.keyboard.press("Escape")

    set_fixture(origin, wave1=False, wave2a_feed=False, gate_now=[], extra_gates=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
