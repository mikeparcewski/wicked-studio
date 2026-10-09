#!/usr/bin/env python3
"""
desk_calm_test.py — S15a: the Desk is DARK WHEN HEALTHY, a STALL IS AN EXCEPTION, and ZERO IS QUIET
(1440x700, on the Desk). The desk counterpart of wave1_dark, wave1_stall and wave1_tone:
Home showed these through its bands and count tiles; the Desk has neither, so the same behaviours are
read off its one sentence, its list and its project sentences.

  healthy   the `wave1` corpus (3 executing runs, 1 completed, no gates, no failures): the sentence
            reads "Nothing needs you." with no highlight; the list has no row; the 3 executing runs read
            as working and c1 as done; nothing animates (no live edge, no animation on the Desk).
  exception b1 waits on a human: the sentence says 1 thing needs you and is highlighted; exactly ONE
            row, b1's gate; b1 reads as waiting and the two healthy runs still as working.
  stall     r1 (gamma) is still `executing` but its event tail ended 2 hours ago: the Desk is NOT
            calm — r1 has a row in the list, the sentence counts it.
  zero      c1 flips to `failed`: exactly ONE row, c1's failed run, in the fail tone, and the
            sentence counts 1. Healthy again: no row, no highlight.

Captures: e2e/shots/desk-calm-{healthy,exception,stall,failed}.png.
Env: FEEDBACK_PORT (default 4363). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4363"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok and os.environ.get("JOURNEY_ALL_STEPS") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)



# Everything the Desk paints that animates in view (a pulsing dot, a glow).
ANIMATED = """() => [...document.querySelectorAll('[data-testid="desk"] *')].filter((el) => {
  const r = el.getBoundingClientRect();
  const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  const cs = getComputedStyle(el);
  return inView && cs.animationName !== 'none' && cs.animationPlayState !== 'paused';
}).map((el) => (el.dataset.testid || el.className || el.tagName).toString().slice(0, 60))"""

ROWS = """() => [...document.querySelectorAll('[data-testid="need-row"], [data-testid="need-member"]')]
  .map((r) => ({ key: r.dataset.key, kind: r.dataset.kind }))"""

SESSIONS = """() => [...document.querySelectorAll('[data-testid="desk-session"]')]
  .map((s) => ({ run: s.dataset.runId, state: s.dataset.state }))"""


def headline(page) -> dict:
    return page.evaluate("""() => { const h = document.querySelector('[data-testid="desk-headline"]');
      return h ? { count: h.dataset.count, text: h.textContent.trim(), marked: !!h.querySelector('mark') } : null; }""")


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

    def desk(count: str) -> None:
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
        try:
            page.wait_for_selector(f'[data-testid="desk-headline"][data-count="{count}"]', timeout=15000)
        except Exception:  # noqa: BLE001 — the check that follows reports what it read
            pass
        page.wait_for_timeout(500)

    # ── healthy: dark ────────────────────────────────────────────────────────────
    set_fixture(origin, wave1=True, wave1_stall=False, gate_now=[], gate_simple=[], status_over={})
    desk("0")
    page.screenshot(path=str(SHOTS / "desk-calm-healthy.png"))
    h = headline(page)
    check("healthy-sentence-is-calm", h is not None and h["count"] == "0" and not h["marked"]
          and h["text"].startswith("Nothing needs you"), headline=h)
    rows = page.evaluate(ROWS)
    check("healthy-no-row", rows == [], rows=rows)
    sessions = page.evaluate(SESSIONS)
    states = {s["run"]: s["state"] for s in sessions}
    check("healthy-projects-say-working", {k: states.get(k) for k in ("a1", "b1", "r1")}
          == {"a1": "working", "b1": "working", "r1": "working"} and states.get("c1") == "done", sessions=sessions)
    animated = page.evaluate(ANIMATED)
    check("healthy-nothing-animates", animated == [], animated=animated)

    # ── one exception: b1 waits on a human ───────────────────────────────────────
    set_fixture(origin, gate_now=["b1"], gate_simple=["b1"])
    desk("1")
    page.screenshot(path=str(SHOTS / "desk-calm-exception.png"))
    h = headline(page)
    check("exception-sentence-counts-and-marks", h is not None and h["count"] == "1" and h["marked"], headline=h)
    rows = page.evaluate(ROWS)
    check("exception-one-row-b1", [r["key"] for r in rows] == ["gate:b1"], rows=rows)
    sessions = page.evaluate(SESSIONS)
    states = {s["run"]: s["state"] for s in sessions}
    check("exception-others-still-working", states.get("b1") == "waiting"
          and states.get("a1") == "working" and states.get("r1") == "working", sessions=sessions)

    # ── a stalled run is an exception ────────────────────────────────────────────
    set_fixture(origin, wave1_stall=True, gate_now=[], gate_simple=[])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    try:
        page.wait_for_function("""() => [...document.querySelectorAll('[data-testid="need-row"], [data-testid="need-member"]')]
            .some((r) => (r.dataset.key || '').endsWith(':r1'))""", timeout=15000)
    except Exception:  # noqa: BLE001 — reported below
        pass
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / "desk-calm-stall.png"))
    rows = page.evaluate(ROWS)
    h = headline(page)
    check("stall-has-a-row", any(r["key"].endswith(":r1") for r in rows), rows=rows)
    check("stall-is-not-calm", h is not None and h["count"] != "0" and h["marked"], headline=h)

    # ── zero is quiet: one failure is the one loud thing ─────────────────────────
    set_fixture(origin, wave1_stall=False, status_over={"c1": "failed"})
    desk("1")
    page.screenshot(path=str(SHOTS / "desk-calm-failed.png"))
    rows = page.evaluate(ROWS)
    h = headline(page)
    check("one-failure-one-row", [(r["key"], r["kind"]) for r in rows] == [("fail:c1", "failed-run")], rows=rows)
    check("one-failure-counted", h is not None and h["count"] == "1" and h["marked"], headline=h)
    set_fixture(origin, status_over={})
    desk("0")
    h = headline(page)
    check("healthy-again-quiet", h is not None and h["count"] == "0" and not h["marked"]
          and page.evaluate(ROWS) == [], headline=h)

    set_fixture(origin, wave1=False, wave1_stall=False, gate_now=[], gate_simple=[], status_over={})
    browser.close()

report["ok"] = all(v.get("ok") for v in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
