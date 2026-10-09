#!/usr/bin/env python3
"""
desk_watch_test.py — TR-W8 (DES-TRIGGER-REGISTRY-001 §4.10, §9): the Watchtower's fold on the
surfaces that exist today, at 1440x700 on the Desk.

Against the in-process fixture (wave-1 corpus, b1 waiting at a gate, `watch_feed` on):

  1. GATE LINE: b1's gate card carries the registry's gate-attached finding as ONE quiet line; with
     the registry absent (404) the card carries no line at all.
  2. COVERAGE: b1's run page says "Not checked on this run: scope drift (no declared scope)"; a run
     whose entries were all checked shows no line (never "all clear").
  3. JUMP IN: /runs/b1?jump=0:1:<at> says "You jumped in from the Watchtower" and highlights unit 0.
  4. LIVE: a `watchEvent` frame clearing the gate finding removes the gate line without a reload.
  5. NEEDS-YOU UNCHANGED: the Desk count is the same with the registry on and off.
  6. 0 page errors.

Captures: e2e/shots/desk-watch*.png. Env: FEEDBACK_PORT (default 4349).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, NOW0, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4349"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
MIN = 60_000

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


def desk_count(page) -> int:
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    return int(page.get_by_test_id("desk-headline").get_attribute("data-count") or "0")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # ── 5 (first half). the Desk count with the registry absent ───────────────────
    set_fixture(origin, **CORPUS, watch_feed=False)
    count_off = desk_count(page)

    # ── 1 (absent). no registry: the gate card has no line ─────────────────────────
    page.goto(f"{origin}/runs/b1", wait_until="networkidle")
    page.get_by_test_id("steering-gate").first.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(600)
    absent_line = page.get_by_test_id("watch-gate-line").count()
    absent_cov = page.get_by_test_id("watch-coverage").count()

    # ── 1. the registry on: one quiet line on the gate card ───────────────────────
    set_fixture(origin, watch_feed=True)
    count_on = desk_count(page)
    page.goto(f"{origin}/runs/b1", wait_until="networkidle")
    page.get_by_test_id("steering-gate").first.wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("watch-gate-line").first.wait_for(state="visible", timeout=8000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-watch-missing.png"))
        fail("gate-line", "no watch gate line on b1's gate card with the registry on")
    lines = page.locator('[data-testid="steering-gate"] [data-testid="watch-gate-line"]').all_inner_texts()
    page.screenshot(path=str(SHOTS / "desk-watch-gate.png"))
    check("gate-line", absent_line == 0 and lines[:1] == ["This asks you to push to origin; the plan delivers to acme/web."]
          and len(set(lines)) == 1, absent=absent_line, lines=lines)

    # ── 2. coverage ───────────────────────────────────────────────────────────────
    page.get_by_test_id("watch-coverage").wait_for(state="visible", timeout=8000)
    cov = page.get_by_test_id("watch-coverage").inner_text()
    page.goto(f"{origin}/runs/a1", wait_until="networkidle")
    page.wait_for_timeout(1200)
    cov_a1 = page.get_by_test_id("watch-coverage").count()
    check("coverage", cov == "Not checked on this run: scope drift (no declared scope)" and cov_a1 == 0 and absent_cov == 0,
          line=cov, a1_lines=cov_a1, absent=absent_cov)

    # ── 3. jump in ────────────────────────────────────────────────────────────────
    # b1's feed shows no unit block for unit 0: the page says so, and highlights nothing else.
    page.goto(f"{origin}/runs/b1?jump=0:1:{NOW0 - 5 * MIN}", wait_until="networkidle")
    page.get_by_test_id("watch-jumped").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("watch-jump-missing").wait_for(state="visible", timeout=8000)
    none = page.evaluate("() => document.querySelectorAll('[data-jumped=\"true\"]').length")
    # r-pay-2 (the sessions corpus) shows unit 0 done: the jump highlights that block.
    set_fixture(origin, sessions=True, run_chat_id=True)
    page.goto(f"{origin}/runs/r-pay-2?jump=0:1:{NOW0}", wait_until="networkidle")
    page.get_by_test_id("watch-jumped").wait_for(state="visible", timeout=8000)
    try:
        page.wait_for_function("() => !!document.querySelector('[data-jumped=\"true\"]')", timeout=8000)
    except Exception:  # noqa: BLE001
        pass
    jumped = page.evaluate("() => [...document.querySelectorAll('[data-jumped=\"true\"]')].map(e => e.dataset.unitOrd)")
    page.screenshot(path=str(SHOTS / "desk-watch-jump.png"))
    set_fixture(origin, sessions=False, run_chat_id=False)
    check("jump-in", none == 0 and jumped == ["0"], missing_highlights=none, jumped=jumped,
          text=page.get_by_test_id("watch-jumped").inner_text())

    # ── 4. live: a clearing frame removes the gate line ───────────────────────────
    page.goto(f"{origin}/runs/b1", wait_until="networkidle")
    page.get_by_test_id("watch-gate-line").first.wait_for(state="visible", timeout=8000)
    set_fixture(origin, extra_frames=[{"type": "watchEvent", "event": {
        "event_id": 99, "event_type": "wicked.crew.watch_finding.cleared",
        "payload": {"run_id": "b1", "ord": 3, "attempt": 1, "by": "watch:gate-ask-vs-plan@1", "at": NOW0,
                    "re": "x", "watch_id": "w-gate-b1", "entry_id": "gate-ask-vs-plan", "entry_version": 1,
                    "reason": "dismissed", "dismissed_by": "person:local"}}}])
    try:
        page.wait_for_function("() => !document.querySelector('[data-testid=\"watch-gate-line\"]')", timeout=10000)
        gone = True
    except Exception:  # noqa: BLE001
        gone = False
    check("live-clear", gone, gone=gone)

    # ── 5. needs-you unchanged ────────────────────────────────────────────────────
    check("needs-you-unchanged", count_on == count_off and count_on >= 1, on=count_on, off=count_off)
    check("no-errors", not errors, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
