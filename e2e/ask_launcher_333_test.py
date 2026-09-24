#!/usr/bin/env python3
"""
ask_launcher_333_test.py — the studio#333 browser gate, at 1440x700.

Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) serving the
same-origin build — no crew daemon involved.

  #333  on /chats → New chat the floating Ask bubble (AskLauncher, #326) sat on the
        Chat composer's Send button, clipping it to "S…". The shell now hands the
        launcher a `bottomOffsetPx` for routes that render a bottom composer (the
        same mechanism as the run right-panel's `rightOffsetPx`), so:
          - the Send button's box does NOT intersect the bubble's box;
          - the bubble's bottom edge is ABOVE the composer band's top edge;
          - the point at Send's centre hits the Send button (nothing covers it);
          - the open Ask panel also sits above the composer and inside the viewport;
        and the empty-state helper copy names the #327 scope vocabulary
        (System / Everything / Project repos / Choose repos), not
        "a repo list, or unscoped".

Capture: e2e/shots/ask-333-chats.png (New chat with the bubble beside the composer).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env: FEEDBACK_PORT (default 4333). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4333"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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


def intersects(a: dict, b: dict) -> bool:
    return not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
                or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    # The fixture's r-q3 gate never resolves, so its toast card would sit on the
    # composer's corner for the whole rig — the same display-only suppression every
    # rig on this fixture applies (uxfix_fixture.HIDE_GATE_TOASTS). Toasts are
    # transient and dismissable; the launcher is not — this rig gates the launcher.
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/chats", wait_until="networkidle")

    # ── /chats → New chat: the create window with its full-width bottom composer ──
    page.get_by_test_id("chats-new").click()
    page.wait_for_function("() => window.location.pathname === '/chat/new'", timeout=10000)
    page.get_by_test_id("chat-firstrun").wait_for(state="visible", timeout=15000)

    bubble = page.get_by_test_id("ask-launcher")
    bubble.wait_for(state="visible", timeout=10000)
    send = page.get_by_test_id("chat-send")
    send.wait_for(state="attached", timeout=10000)
    composer = page.get_by_test_id("chat-composer")

    b = bubble.bounding_box()
    s = send.bounding_box()
    c = composer.bounding_box()
    check("boxes-measured", b is not None and s is not None and c is not None, bubble=b, send=s, composer=c)
    page.screenshot(path=str(SHOTS / "ask-333-chats.png"))

    check("bubble-in-viewport", b["x"] >= 0 and b["y"] >= 0
          and b["x"] + b["width"] <= W and b["y"] + b["height"] <= H, box=b)
    check("send-does-not-intersect-bubble", not intersects(s, b), send=s, bubble=b)
    check("bubble-above-composer", b["y"] + b["height"] <= c["y"],
          bubble_bottom=b["y"] + b["height"], composer_top=c["y"])
    hit = page.evaluate(
        "([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid=\"chat-send\"]') !== null",
        [s["x"] + s["width"] / 2, s["y"] + s["height"] / 2])
    check("send-centre-not-covered", hit is True)

    # ── the open panel stays above the composer and inside the viewport ──────────
    bubble.click()
    panel = page.get_by_test_id("ask-panel")
    panel.wait_for(state="visible", timeout=5000)
    pb = panel.bounding_box()
    check("panel-above-composer-in-viewport",
          pb["y"] >= 0 and pb["y"] + pb["height"] <= c["y"] and pb["y"] + pb["height"] <= b["y"],
          panel=pb, composer_top=c["y"], bubble_top=b["y"])
    check("send-does-not-intersect-panel", not intersects(s, pb), send=s, panel=pb)
    bubble.click()
    panel.wait_for(state="detached", timeout=5000)

    # ── the empty-state helper copy names the #327 vocabulary ───────────────────
    scope_copy = page.get_by_test_id("chat-firstrun-scope").inner_text()
    check("helper-copy-uses-scope-vocabulary",
          "repo list" not in scope_copy and "unscoped" not in scope_copy
          and all(word in scope_copy for word in ("System", "Everything", "Project repos", "Choose repos")),
          copy=scope_copy)

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
