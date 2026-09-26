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

Round 2 (review of #336): the queue beside other focus owners —
  R2-1  a selected queue row never steals focus back from Ask on a run event;
  R2-2  with a wall card selected AND the queue focused on another project's gate,
        `a` decides nothing (the wall yields; the queue does not own `a`);
  R2-3  Enter on a focused act control does that control's verb, not the remembered
        row's; a click on a row selects it.

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

    # ── Round 2: the queue beside other focus owners ───────────────────────────
    gate_posts: list = []
    page.on("request", lambda r: gate_posts.append(r.url)
            if r.method == "POST" and "/gate" in r.url else None)

    def fresh_home() -> None:
        set_fixture(origin, simple_gates=["g1", "g2"], status_over={}, extra_frames=[])
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            "() => !!document.querySelector('[data-testid=\"need-row\"][data-key=\"group:approval\"]')",
            timeout=10000)

    # W2B_R2 (optional, e.g. "2,3"; 4 = R2-3b) runs a subset of the round-2 steps — each is independent.
    only = {x.strip() for x in os.environ.get("W2B_R2", "1,2,3,4").split(",")}

    # R2-1. A selected queue row must not steal focus back from Ask on a run event.
    if "1" in only:
        fresh_home()
        page.get_by_test_id("needs-you-queue").focus()
        page.keyboard.press("j")
        check("r2-queue-row-selected", page.evaluate(SELECTED) == "group:approval")
        page.keyboard.press("Control+Shift+A")
        page.get_by_test_id("assist-input").wait_for(state="visible", timeout=10000)
        page.get_by_test_id("assist-input").click()
        page.keyboard.type("hello there")
        set_fixture(origin, extra_frames=[{"type": "unitExecuting", "session": "e1", "ord": 0},
                                          {"type": "resumed", "session": "b1", "ord": 0}])
        page.wait_for_timeout(2500)
        page.keyboard.type(" again")
        focus = page.evaluate("() => { const a = document.activeElement; return a ? (a.dataset.testid || a.tagName) : null; }")
        typed = page.get_by_test_id("assist-input").input_value()
        check("r2-ask-keeps-focus-through-run-event", focus == "assist-input" and typed == "hello there again",
              focus=focus, typed=typed)

    # R2-2. Wall selection on card A + queue focus on gate B: `a` must decide NOTHING.
    if "2" in only:
        fresh_home()
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("j")
        wall = page.evaluate("() => { const c = document.querySelector('[data-testid=\"band-needs-you\"] [data-kbd-selected]'); "
                             "return c ? c.getAttribute('data-kbd-item') : null; }")
        check("r2-wall-card-selected", wall in ("alpha", "beta"), wall=wall)
        other_run = "g2" if wall == "alpha" else "g1"
        page.get_by_test_id("needs-you-queue").focus()
        page.keyboard.press("j")
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.querySelectorAll('[data-testid=\"need-member\"]').length === 2", timeout=3000)
        for _ in range(3):
            if page.evaluate(SELECTED) == f"gate:{other_run}":
                break
            page.keyboard.press("j")
        check("r2-queue-on-gate-b", page.evaluate(SELECTED) == f"gate:{other_run}", selected=page.evaluate(SELECTED))
        gate_posts.clear()
        page.keyboard.press("a")
        page.wait_for_timeout(1000)
        check("r2-a-decides-nothing-while-queue-focused", gate_posts == [], posts=gate_posts, wall=wall)

    # R2-3a. Enter on a focused control acts on THAT control, not the remembered row.
    if "3" in only:
        fresh_home()
        page.get_by_test_id("needs-you-queue").focus()
        page.keyboard.press("j")  # remembered row = the approvals group
        page.locator('[data-testid="need-row"][data-key="fail:f1"] [data-testid="need-act"]').focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(800)
        path = page.evaluate("() => window.location.pathname")
        expanded = page.locator('[data-testid="need-member"]').count()
        check("r2-enter-on-retry-runs-retry", path == "/runs/new" and expanded == 0, path=path, expanded=expanded)

    # R2-3b. A click on a row selects it (focus and selection agree).
    if "4" in only:
        fresh_home()
        page.locator('[data-testid="need-row"][data-key="fail:f1"] [data-testid="need-line"]').click()
        check("r2-click-selects-row", page.evaluate(SELECTED) == "fail:f1", selected=page.evaluate(SELECTED))
        page.screenshot(path=str(SHOTS / "wave2b-queue-click-selects.png"))

    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], status_over={}, extra_frames=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
