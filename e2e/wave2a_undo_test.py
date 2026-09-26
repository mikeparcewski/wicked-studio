#!/usr/bin/env python3
"""
wave2a_undo_test.py — studio wave 2a, behaviour 5: PREVIEW, THEN COMMIT, WITH AN UNDO
WINDOW (1440x700).

Against the `wave1` corpus with a SIMPLE gate waiting on b1 (`gate_now` + `gate_simple`):
beta's card sits in NEEDS YOU and the triage cursor answers it in place.

  queue    j selects beta, a approves: the toast reads "Approving in 10 s" with an Undo
           button and a what-will-happen line; ZERO POST /runs/b1/gate for the first 9 s
           (counted twice: the browser's request tap AND the fixture's server log).
  undo     Undo → still zero POSTs after the window would have closed; the gate is still
           open (b1's chip still offers Approve).
  commit   a again, no Undo → exactly ONE POST, and only after the 10 s window.
  close    a third decision queued, then the tab is CLOSED inside the window → the
           fixture never receives a POST (the gate stays open), and the toast said so.

Capture: e2e/shots/wave2a-undo-toast.png, wave2a-undo-after.png.
Env: FEEDBACK_PORT (default 4352). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4352"))
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


def server_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if p["runId"] == "b1"]


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)


def open_board(browser):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    posts: list = []
    page.on("request", lambda r: posts.append(time.monotonic())
            if r.method == "POST" and r.url.endswith("/api/v1/runs/b1/gate") else None)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("gate-chip-b1").wait_for(state="visible", timeout=15000)
    return page, posts


def approve_with_a(page) -> float:
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("j")
    page.wait_for_function(
        "() => document.activeElement?.getAttribute('data-kbd-item') === 'beta'", timeout=5000)
    page.keyboard.press("a")
    return time.monotonic()


with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={},
                extra_gates=[], reset_gate_posts=True)
    page, posts = open_board(browser)

    # ── queue: the toast, the preview line, zero POSTs for 9 s ──────────────────
    pressed = approve_with_a(page)
    toast = page.get_by_test_id("undo-toast")
    try:
        toast.wait_for(state="visible", timeout=3000)
        shown = True
    except Exception:  # noqa: BLE001 — reported below
        shown = False
    check("toast-shows", shown, browser_posts_after_press=len(posts),
          server_posts_after_press=len(server_posts(origin)))
    text = toast.text_content() or ""
    check("toast-reads-approving-in-10s", "Approving in 10 s" in text, text=text)
    check("toast-has-undo", toast.get_by_role("button", name="Undo").count() == 1)
    check("toast-says-what-will-happen", toast.get_by_test_id("undo-preview").count() == 1
          and len(toast.get_by_test_id("undo-preview").text_content() or "") > 0,
          preview=toast.get_by_test_id("undo-preview").text_content() if toast.get_by_test_id("undo-preview").count() else None)
    check("toast-says-closing-sends-nothing", "stays open" in text, text=text)
    page.screenshot(path=str(SHOTS / "wave2a-undo-toast.png"))
    page.wait_for_timeout(max(0, int((pressed + 9.0 - time.monotonic()) * 1000)))
    check("zero-posts-first-9s", len(posts) == 0 and len(server_posts(origin)) == 0,
          browser_posts=len(posts), server=len(server_posts(origin)))

    # ── undo: nothing sent, the gate still open ─────────────────────────────────
    toast.get_by_role("button", name="Undo").click()
    page.wait_for_timeout(3000)  # well past the original 10 s mark
    check("undo-zero-posts", len(posts) == 0 and len(server_posts(origin)) == 0,
          browser_posts=len(posts), server=len(server_posts(origin)))
    check("undo-gate-still-open", page.get_by_test_id("gate-approve-b1").count() == 1)
    check("undo-toast-gone", page.get_by_test_id("undo-toast").count() == 0)
    page.screenshot(path=str(SHOTS / "wave2a-undo-after.png"))

    # ── commit: exactly one POST, after the window ──────────────────────────────
    pressed = approve_with_a(page)
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
    page.wait_for_timeout(max(0, int((pressed + 9.3 - time.monotonic()) * 1000)))
    check("commit-nothing-before-window", len(posts) == 0, browser_posts=len(posts))
    page.wait_for_timeout(2500)
    first_at = posts[0] - pressed if posts else None
    page.wait_for_timeout(1500)
    check("commit-exactly-one-post", len(posts) == 1 and len(server_posts(origin)) == 1,
          browser_posts=len(posts), server=len(server_posts(origin)), first_at_s=first_at)
    check("commit-after-10s", first_at is not None and first_at >= 9.9, first_at_s=first_at)
    body = server_posts(origin)[0]["body"]
    check("commit-body-approve", body.get("approve") is True, body=body)
    page.close()

    # ── close the tab inside the window: nothing is sent ────────────────────────
    set_fixture(origin, reset_gate_posts=True)
    page, posts = open_board(browser)
    approve_with_a(page)
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
    page.close()
    time.sleep(12)
    check("closed-tab-sends-nothing", len(server_posts(origin)) == 0, server=len(server_posts(origin)))

    set_fixture(origin, wave1=False, gate_now=[], gate_simple=[], reset_gate_posts=True)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
