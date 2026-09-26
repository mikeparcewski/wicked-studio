#!/usr/bin/env python3
"""
wave1_draft_test.py — studio wave 1, behaviour 3: OUTBOUND HARNESS WITH COPY (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` corpus.

  draft  open the COMPLETED run c1 and click "Draft update": an editable text
         area shows crew's drafted text (GET /runs/c1/deliver-text) — its first
         line equals line 1 of the fixture's deliver-text.
  copy   edit the text, click Copy: the clipboard equals the text area.
  live   an EXECUTING run (r1) offers the same action (a status draft).

Capture: e2e/shots/wave1-draft-update.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env: FEEDBACK_PORT (default 4343). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (HIDE_GATE_TOASTS, REPO, WAVE1_RUNS, ensure_build, set_fixture,
                           start_server, wave1_deliver_text)

PORT = int(os.environ.get("FEEDBACK_PORT", "4343"))
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


C1 = next(r for r in WAVE1_RUNS if r["session"]["id"] == "c1")
LINE1 = wave1_deliver_text(C1).split("\n")[0]

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1,
                              permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, wave1=True, gate_now=[])
    page.goto(f"{origin}/runs/c1", wait_until="networkidle")
    page.get_by_test_id("run-header").wait_for(state="visible", timeout=15000)

    # ── Draft update on a finished run ──────────────────────────────────────────
    page.get_by_test_id("run-draft-update").click()
    text = page.get_by_test_id("outbound-text")
    text.wait_for(state="visible", timeout=10000)
    page.wait_for_function(
        "() => (document.querySelector('[data-testid=\"outbound-text\"]')?.value ?? '').length > 0",
        timeout=10000)
    value = text.input_value()
    check("first-line-is-deliver-text-title", value.split("\n")[0] == LINE1,
          first=value.split("\n")[0], expected=LINE1)
    check("kind-is-pr", page.get_by_test_id("outbound-draft").get_attribute("data-kind") == "pr",
          kind=page.get_by_test_id("outbound-draft").get_attribute("data-kind"))

    # ── editable, then Copy: clipboard == text area ─────────────────────────────
    text.evaluate("el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }")
    page.keyboard.type("\nThanks — reviewed by hand.")
    edited = text.input_value()
    check("text-area-is-editable", edited.endswith("Thanks — reviewed by hand.") and edited != value)
    page.locator('[data-testid="outbound-draft"] [data-testid="copy-command"]').click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"outbound-draft\"] [data-testid=\"copy-command\"]')"
        "?.getAttribute('data-state') === 'copied'", timeout=5000)
    clip = page.evaluate("() => navigator.clipboard.readText()")
    page.screenshot(path=str(SHOTS / "wave1-draft-update.png"))
    check("clipboard-equals-text-area", clip == text.input_value(), clip_len=len(clip),
          area_len=len(text.input_value()))
    # One action today — no dead Mail/Message buttons drawn.
    buttons = page.locator('[data-testid="outbound-draft"] button').all_inner_texts()
    check("only-live-actions", [b.strip().lower() for b in buttons] == ["copied"], buttons=buttons)

    # ── a live run offers the same action (a status draft) ──────────────────────
    page.keyboard.press("Escape")
    page.goto(f"{origin}/runs/r1", wait_until="networkidle")
    page.get_by_test_id("run-header").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("run-draft-update").click()
    page.get_by_test_id("outbound-text").wait_for(state="visible", timeout=10000)
    check("live-run-kind-is-status",
          page.get_by_test_id("outbound-draft").get_attribute("data-kind") == "status")

    set_fixture(origin, wave1=False, gate_now=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
