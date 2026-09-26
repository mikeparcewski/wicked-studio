#!/usr/bin/env python3
"""
wave2b_queue_test.py — studio wave 2b, behaviour 4: ONE QUEUE RANKED BY CONSEQUENCE (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` + `wave2b` corpora:
two SIMPLE gates in different projects (g1 alpha, waiting 20 min; g2 beta, 10 min), one MCP
elicitation raised over /ws on e1, and one failed run (f1, an hour ago).

  1. The queue ranks: the grouped "2 approvals" row, then the elicitation, then the failure.
  2. The group expands to its two members, the longest-waiting first.
  3. Keys on the queue itself: focus it, j selects, Enter expands a group / opens a row.
  4. Resolve one gate over /ws (a `resumed` frame): within 2 s, with no reload, the
     approvals drop to 1 — a lone gate row, no group.

Captures: e2e/shots/wave2b-queue-{grouped,expanded,resolved}.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4345). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4345"))
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


TOP_ROWS = """() => [...document.querySelectorAll('[data-testid="needs-you-queue"] [data-testid="need-row"]')]
  .map(r => ({key: r.dataset.key, kind: r.dataset.kind, count: Number(r.dataset.count || '1'),
              text: r.textContent}))"""
MEMBERS = """() => [...document.querySelectorAll('[data-testid="need-member"]')].map(r => r.dataset.key)"""
SELECTED = """() => { const el = document.querySelector('[data-testid="needs-you-queue"] [data-kbd-selected="true"]');
  return el ? el.dataset.key : null; }"""

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

    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[],
                status_over={}, extra_frames=[])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.evaluate("() => { window.__w2bNoReload = true; }")

    # ── an MCP elicitation arrives over /ws on e1 ──────────────────────────────
    set_fixture(origin, extra_frames=[{"type": "elicitationCreated", "session": "e1",
                                       "elicitationId": "el-1",
                                       "message": "Which region should the backfill target?",
                                       "options": None}])
    try:
        page.wait_for_function(
            "() => !!document.querySelector('[data-testid=\"need-row\"][data-kind=\"elicitation\"]')",
            timeout=5000)
    except Exception:
        fail("elicitation-row", f"no elicitation row: {page.evaluate(TOP_ROWS)}")

    # ── 1. ranked: approvals group › elicitation › failure ─────────────────────
    rows = page.evaluate(TOP_ROWS)
    keys = [r["key"] for r in rows]
    check("ranked-order",
          len(rows) == 3
          and rows[0]["kind"] == "gate" and rows[0]["count"] == 2 and "2 approvals" in rows[0]["text"]
          and rows[1]["kind"] == "elicitation" and rows[1]["key"] == "elicit:e1"
          and rows[2]["kind"] == "failed-run" and rows[2]["key"] == "fail:f1",
          rows=keys, texts=[r["text"][:80] for r in rows])
    page.screenshot(path=str(SHOTS / "wave2b-queue-grouped.png"))

    # ── 2 + 3. keys on the queue: focus, j selects the group, Enter expands ────
    page.get_by_test_id("needs-you-queue").focus()
    page.keyboard.press("j")
    check("j-selects-first", page.evaluate(SELECTED) == keys[0], selected=page.evaluate(SELECTED))
    page.keyboard.press("Enter")
    try:
        page.wait_for_function(
            "() => document.querySelectorAll('[data-testid=\"need-member\"]').length === 2", timeout=3000)
    except Exception:
        fail("enter-expands-group", f"members: {page.evaluate(MEMBERS)}")
    members = page.evaluate(MEMBERS)
    check("group-members-longest-waiting-first", members == ["gate:g1", "gate:g2"], members=members)
    page.screenshot(path=str(SHOTS / "wave2b-queue-expanded.png"))
    page.keyboard.press("j")
    check("j-walks-into-members", page.evaluate(SELECTED) == "gate:g1", selected=page.evaluate(SELECTED))
    page.keyboard.press("j")
    page.keyboard.press("j")
    check("j-reaches-elicitation", page.evaluate(SELECTED) == "elicit:e1", selected=page.evaluate(SELECTED))
    page.keyboard.press("k")
    check("k-walks-back", page.evaluate(SELECTED) == "gate:g2", selected=page.evaluate(SELECTED))
    page.keyboard.press("j")
    page.keyboard.press("Enter")
    try:
        page.wait_for_function("() => window.location.pathname.includes('e1')", timeout=5000)
    except Exception:
        fail("enter-opens-row", f"path: {page.evaluate('() => window.location.pathname')}")
    check("enter-opens-row", True, path=page.evaluate("() => window.location.pathname"))
    page.go_back()
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=10000)

    # ── 4. resolve g1 over /ws: the approvals drop to 1 within 2 s, no reload ──
    set_fixture(origin, simple_gates=["g2"],
                extra_frames=[{"type": "resumed", "session": "g1", "ord": 0}])
    t0 = time.time()
    try:
        page.wait_for_function(
            """() => { const rows = [...document.querySelectorAll('[data-testid="needs-you-queue"] [data-testid="need-row"]')];
                       const gates = rows.filter(r => r.dataset.kind === 'gate');
                       return gates.length === 1 && gates[0].dataset.key === 'gate:g2'
                         && Number(gates[0].dataset.count || '1') === 1; }""",
            timeout=2000)
    except Exception:
        fail("resolved-within-2s", f"rows: {page.evaluate(TOP_ROWS)}")
    elapsed = round(time.time() - t0, 2)
    check("resolved-within-2s", True, elapsed_s=elapsed, rows=[r["key"] for r in page.evaluate(TOP_ROWS)])
    check("no-reload", page.evaluate("() => window.__w2bNoReload === true"))
    page.screenshot(path=str(SHOTS / "wave2b-queue-resolved.png"))

    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], status_over={}, extra_frames=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
