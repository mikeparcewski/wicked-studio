#!/usr/bin/env python3
"""
wave2a_peek_test.py — studio wave 2a, behaviour 3: PEEK, JUMP, BACK (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` corpus plus
`wave2a_feed` (r1's feed is long enough to scroll).

  where    /s/run%3Ar1 (S16a-2b: the session thread); the thread scrolled to its middle (when it
           overflows); focus parked on the run block's ⋯.
  arrival  a gate arrives on b1 (project beta): `gate_now` + a live awaitingHuman frame.
  peek     P → the peek card shows the top gate (b1's prompt: its evidence) in place;
           the URL is byte-identical to before.
  jump     G → the address is b1's gate (/s/run%3Ab1#gate; the thread consumes the hash
           and focuses the gate row).
  back     B → the address is /s/run%3Ar1 again, the thread's scrollTop is within
           10px of where it was, and focus is back on the run's ⋯.
  overlay  ? lists all three keys under their own section.
  queue    (wave 2b corpus) with the ranked needs-you queue focused, P peeks the QUEUE's top
           item (the approvals group's top member, gate:g1) with the URL unchanged; Esc closes
           it and focus stays in the queue; G opens /s/run%3Ag1#gate; B comes back to `/`
           with focus back in the queue.

Capture: e2e/shots/wave2a-peek.png, wave2a-jump.png, wave2a-back.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4351). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import GATE_NOW_PROMPT, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4351"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
FEED = '[data-testid="session-thread"]'
WHERE = '/s/run%3Ar1'
PARK = '[data-testid="session-run"][data-run-id="r1"] [data-testid="session-run-look"]'

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
    # S16a-2b: "where you were" is r1's session thread (/s/run%3Ar1), focus parked on its run's ⋯.
    page.goto(f"{origin}{WHERE}", wait_until="networkidle")
    page.locator(FEED).wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(1200)  # let the live-follow pin to the tail settle
    # PORT GAP (S16a-2b): r1's thread may not overflow at 1440x700 (the run page's long event feed is
    # the sheet's Activity tab now); the scroll pins hold only when there is a scroll to hold.
    scrolls = page.evaluate(f"() => {{ const f = document.querySelector({json.dumps(FEED)}); return !!f && f.scrollHeight - f.clientHeight > 40; }}")
    report["steps"]["feed-scrolls"] = {"ok": True, "scrolls": scrolls}

    # ── where you were: the thread at its middle, focus on the run's ⋯ ─────────
    middle = page.evaluate(
        f"() => {{ const f = document.querySelector({json.dumps(FEED)});"
        " const m = Math.round((f.scrollHeight - f.clientHeight) / 2); f.scrollTop = m; return m; }")
    page.wait_for_timeout(300)
    page.locator(PARK).focus()
    before = feed_top(page)
    check("feed-at-middle", abs(before - middle) <= 2, middle=middle, before=before)

    # ── a gate arrives on b1 (beta) ─────────────────────────────────────────────
    set_fixture(origin, gate_now=["b1"],
                extra_gates=[{"session": "b1", "ord": 3, "prompt": GATE_NOW_PROMPT}])
    page.wait_for_timeout(3000)  # the frame drains on the next /ws tick; the list reconciles
    href_before = page.evaluate("() => window.location.href")
    check("still-on-r1", page.evaluate("() => window.location.pathname") == WHERE)
    before = feed_top(page)

    # ── peek ────────────────────────────────────────────────────────────────────
    page.keyboard.press("Alt+p")
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
    page.keyboard.press("Alt+g")
    # The gate's address is the session thread at the gate anchor, /s/run%3Ab1#gate (S15e:
    # `gateOpenPath` lands every gate deep link in the thread); the thread consumes the one-shot
    # `#gate` on arrival by focusing the answerable row — so "at the gate" is: the b1 session,
    # with the gate row (or the proposal card's primary button) holding focus.
    check("jump-to-b1-gate", wait_ok(
        page, "() => (window.location.pathname === '/s/run%3Ab1' || window.location.pathname === '/s/run:b1')"
              " && (window.location.hash === '#gate'"
              "     || ['session-gate-row', 'session-proposal-go'].includes(document.activeElement?.getAttribute('data-testid')))"),
        url=page.evaluate("() => window.location.href"),
        focused=page.evaluate("() => document.activeElement?.getAttribute('data-testid')"))
    check("peek-closed-on-jump", page.get_by_test_id("peek-card").count() == 0)
    page.wait_for_timeout(800)
    page.screenshot(path=str(SHOTS / "wave2a-jump.png"))

    # ── back to exactly where you were ──────────────────────────────────────────
    page.keyboard.press("Alt+b")
    check("back-to-r1", wait_ok(page, f"() => window.location.pathname === {json.dumps(WHERE)}"),
          url=page.evaluate("() => window.location.href"))
    restored = wait_ok(
        page, f"() => {{ const f = document.querySelector({json.dumps(FEED)});"
              f" return !!f && Math.abs(f.scrollTop - {before}) <= 10; }}", 8000)
    page.wait_for_timeout(1500)  # and it STAYS there (no late live-follow pin)
    after = feed_top(page)
    page.screenshot(path=str(SHOTS / "wave2a-back.png"))
    check("back-scroll-within-10px", restored and abs(after - before) <= 10, before=before, after=after)
    focused = page.evaluate("() => document.activeElement?.getAttribute('data-testid')")
    check("back-focus-restored", focused == "session-run-look", focused=focused)

    # ── the ? overlay documents all three keys ──────────────────────────────────
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Alt+/")
    ov = page.get_by_test_id("shortcut-overlay")
    ov.wait_for(state="visible", timeout=5000)
    text = ov.text_content() or ""
    check("overlay-lists-peek-jump-back",
          all(s in text for s in ("Peek at the top item that needs you",
                                  "Jump to the top item that needs you",
                                  "Back to exactly where you were")), text=text[-600:])
    page.keyboard.press("Escape")

    # ── a message to the team on the live run: crew's POST /runs/:id/inject answers ok ──
    note = "Keep the 5 GB cap from standup"
    # PORT GAP (S16a-2b): the session has no "message every helper" box (the step sheet's
    # "Message it" targets the working helper), so this step still reads the run page.
    page.goto(f"{origin}/p/gamma/build/r1", wait_until="networkidle")
    composer = page.get_by_placeholder("Send message to all agents…")
    composer.fill(note)
    page.keyboard.press("Control+Enter")
    check("team-message-sent", wait_ok(
        page, "() => (document.querySelector('textarea[placeholder=\"Send message to all agents…\"]')?.value ?? 'x') === ''",
        5000) and "refused" not in (page.evaluate("() => document.body.innerText") or ""),
        body=page.evaluate("() => document.body.innerText")[-300:])
    with urllib.request.urlopen(f"{origin}/__fixture/inject-posts", timeout=10) as res:
        injected = json.loads(res.read())["posts"]
    check("team-message-on-the-wire", injected == [{"runId": "r1", "body": {"message": note, "target": "all"}}],
          injected=injected)

    # ── the ranked queue (wave 2b) holds focus: P peeks the QUEUE's top item ────
    set_fixture(origin, wave1=True, wave2a_feed=False, wave2b=True, simple_gates=["g1", "g2"],
                gate_now=[], extra_gates=[], extra_frames=[], status_over={})
    q = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    q.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    q.goto(f"{origin}/", wait_until="networkidle")
    q.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    check("queue-top-is-approvals", wait_ok(
        q, "() => { const r = document.querySelector('[data-testid=\"need-row\"]');"
           " return !!r && r.dataset.kind === 'gate' && (r.textContent ?? '').includes('2 approvals'); }", 10000),
        top=q.evaluate("() => document.querySelector('[data-testid=\"need-row\"]')?.dataset.key"))
    q.get_by_test_id("needs-you-queue").focus()
    href0 = q.evaluate("() => window.location.href")
    q.keyboard.press("Alt+p")
    check("queue-focused-peek-shows", wait_ok(q, "() => !!document.querySelector('[data-testid=\"peek-card\"]')", 5000))
    # The approvals group stands for its top-ranked member: g1 has waited 20 min, g2 10 min.
    peek_key = q.get_by_test_id("peek-card").get_attribute("data-key")
    check("queue-focused-peek-is-queue-top", peek_key == "gate:g1", peek_key=peek_key)
    check("queue-focused-peek-url-unchanged", q.evaluate("() => window.location.href") == href0)
    q.screenshot(path=str(SHOTS / "wave2a-peek-queue.png"))
    q.keyboard.press("Escape")
    check("queue-escape-closes-peek-keeps-queue-focus",
          wait_ok(q, "() => !document.querySelector('[data-testid=\"peek-card\"]')", 3000)
          and q.evaluate("() => !!document.activeElement?.closest('[data-testid=\"needs-you-queue\"]')"),
          focused=q.evaluate("() => document.activeElement?.getAttribute('data-testid')"))
    q.keyboard.press("Alt+g")
    # S15e: the queue's jump lands in g1's session thread at the gate (/s/run%3Ag1#gate).
    check("queue-jump-to-g1", wait_ok(q, "() => window.location.pathname === '/s/run%3Ag1' || window.location.pathname === '/s/run:g1'"),
          url=q.evaluate("() => window.location.href"))
    q.keyboard.press("Alt+b")
    check("queue-back-home-focus-on-queue", wait_ok(
        q, "() => window.location.pathname === '/'"
           " && !!document.activeElement?.closest('[data-testid=\"needs-you-queue\"]')", 8000),
        url=q.evaluate("() => window.location.href"),
        focused=q.evaluate("() => document.activeElement?.getAttribute('data-testid')"))
    q.close()

    set_fixture(origin, wave1=False, wave2a_feed=False, wave2b=False, simple_gates=[], gate_now=[],
                extra_gates=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
