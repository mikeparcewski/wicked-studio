#!/usr/bin/env python3
"""
wave2a_gatecard_test.py — studio wave 2a round 2: ONE DECISION MECHANISM (1440x700).

The session thread's gate row (S16a-2a: moved off the run page) decides through the same undo
window as the board. Against the `wave1` corpus with a gate waiting on b1 (`gate_now`):

  approve  on /s/run%3Ab1, click the gate row's Approve: the toast reads
           "Approving “migrate beta's settings page to the new form kit” in 10 s" with Undo; ZERO POST /runs/b1/gate for the first 9 s
           (browser tap AND the fixture's server log).
  undo     Undo → still zero POSTs past the window; the gate row is still there with
           Approve enabled (the gate stays open).
  key      focus the row, press 1 (its first choice) → the same toast; let it run → exactly ONE POST, after 10 s.

Capture: e2e/shots/wave2a-gatecard-toast.png, wave2a-gatecard-undo.png.
Env: FEEDBACK_PORT (default 4353). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4353"))
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


def toast_shown(page) -> bool:
    try:
        page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=3000)
        return True
    except Exception:  # noqa: BLE001 — reported by the caller
        return False


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
    posts: list = []
    page.on("request", lambda r: posts.append(time.monotonic())
            if r.method == "POST" and r.url.endswith("/api/v1/runs/b1/gate") else None)

    # S16a-2a: b1's gate in its SIMPLE shape (the daemon's GateInfo, no `options`): the session's
    # row answers it in place with Approve / Approve and steer / Send back / Stop.
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={},
                extra_gates=[], reset_gate_posts=True)
    # S16a-2a: the gate is answered in b1's session thread, on its gate row.
    page.goto(f"{origin}/s/run%3Ab1", wait_until="networkidle")
    APPROVE = '[data-testid="session-gate-choice"][data-choice-key="approve"]'
    approve = page.locator(APPROVE)
    approve.wait_for(state="visible", timeout=15000)

    # ── approve from the session's gate row ─────────────────────────────────────
    pressed = time.monotonic()
    approve.click()
    shown = toast_shown(page)
    check("card-approve-shows-toast", shown, browser_posts_after_click=len(posts),
          server_posts_after_click=len(server_posts(origin)))
    text = page.get_by_test_id("undo-toast").text_content() or ""
    check("toast-reads-approving-in-10s", "Approving “migrate beta's settings page to the new form kit” in 10 s" in text, text=text)
    check("toast-has-undo", page.get_by_test_id("undo-toast").get_by_role("button", name="Undo").count() == 1)
    page.screenshot(path=str(SHOTS / "wave2a-gatecard-toast.png"))
    page.wait_for_timeout(max(0, int((pressed + 9.0 - time.monotonic()) * 1000)))
    check("zero-posts-first-9s", len(posts) == 0 and len(server_posts(origin)) == 0,
          browser_posts=len(posts), server=len(server_posts(origin)))

    # ── undo: the gate stays open ───────────────────────────────────────────────
    page.get_by_test_id("undo-toast").get_by_role("button", name="Undo").click()
    page.wait_for_timeout(3000)
    check("undo-zero-posts", len(posts) == 0 and len(server_posts(origin)) == 0,
          browser_posts=len(posts), server=len(server_posts(origin)))
    check("undo-gate-still-open", page.locator(APPROVE).count() == 1
          and page.locator(APPROVE).is_enabled())
    page.screenshot(path=str(SHOTS / "wave2a-gatecard-undo.png"))

    # ── the row's keyboard (digit 1 = its first choice, Approve): same window, then exactly one POST ──
    page.get_by_test_id("session-gate-row").focus()
    pressed = time.monotonic()
    page.keyboard.press("1")
    check("key-a-shows-toast", toast_shown(page))
    page.wait_for_timeout(max(0, int((pressed + 9.3 - time.monotonic()) * 1000)))
    check("key-nothing-before-window", len(posts) == 0, browser_posts=len(posts))
    page.wait_for_timeout(3000)
    first_at = posts[0] - pressed if posts else None
    check("key-exactly-one-post-after-10s",
          len(posts) == 1 and len(server_posts(origin)) == 1 and first_at is not None and first_at >= 9.9,
          browser_posts=len(posts), server=len(server_posts(origin)), first_at_s=first_at)

    set_fixture(origin, wave1=False, gate_now=[], reset_gate_posts=True)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
