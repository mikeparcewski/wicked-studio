#!/usr/bin/env python3
"""
agent_1on1_test.py — the weekly 1:1 per agent on the Health panel's seat rows
(brainstorm-actionable idea 9), at 1440x700.

  week    Health expanded: each seat row carries its week off GET /roster/record (units, first pass,
          rework, stalls, bench, cost where recorded) and exactly ONE coaching move. Different
          records earn different moves: claude "No change needed", codex "Route review away from
          codex" (3 stalls), agy "No change needed" (no units), pi "Sign in to pi" (benched, signed out).
          The consequence sits above the button and is on screen.
  route   taking codex's move POSTs the operations rule to /governance/rules (id
          seat-coach:codex:review) and the row says what landed.
  signin  taking pi's move opens pi's own sign-in line in a terminal dialog.
  absent  a daemon without the route: the caption says so and no seat offers a move.

Captures (e2e/shots/): agent-1on1-desk-week.png, agent-1on1-desk-done.png,
agent-1on1-desk-signin.png.
Env: FEEDBACK_PORT (default 4481). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4481"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def rule_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/rule-posts", timeout=10) as res:
        return json.loads(res.read())["posts"]


def reset(origin: str, week: bool) -> None:
    set_fixture(origin, **{"seat_week": week, "reset_rule_posts": True,
                           "appearance": {**DEFAULT_APPEARANCE}})


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def open_health() -> None:
        page.goto(f"{origin}/", wait_until="networkidle")
        toggle = page.get_by_test_id("rail-health-toggle")
        toggle.wait_for(state="visible", timeout=15000)
        if toggle.get_attribute("aria-expanded") != "true":
            toggle.click()
        page.get_by_test_id("rail-seat-week-window").wait_for(state="visible", timeout=15000)

    def move(seat: str):
        return page.locator(f'[data-testid="rail-seat-move"][data-seat="{seat}"]')

    def section_week() -> None:
        reset(origin, True)
        open_health()
        page.wait_for_function("""() => document.querySelector('[data-testid="rail-seat-week-window"]')
            ?.getAttribute('data-state') === 'ok'""", timeout=10000)
        kinds = page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('[data-testid="rail-seat"]')]
            .map(el => [el.dataset.seat, [...el.querySelectorAll('[data-testid="rail-seat-move"]')].map(m => m.dataset.kind)]))""")
        check("one-move-per-seat", kinds == {"claude": ["no-change"], "codex": ["route-away"], "agy": ["no-change"],
                                             "pi": ["sign-in"]}, kinds=kinds)
        line = (page.locator('[data-testid="rail-seat-week"][data-seat="codex"] [data-testid="rail-seat-week-line"]')
                .text_content() or "").strip()
        check("week-line", line == "5 units · 3/4 first pass · 1 rework · 3 stalls · $0.84", line=line)
        codex = move("codex")
        codex.scroll_into_view_if_needed()
        consequence = (codex.get_by_test_id("rail-seat-move-consequence").text_content() or "").strip()
        label = (codex.get_by_test_id("rail-seat-move-button").text_content() or "").strip()
        check("move-named", label == "Route review away from codex ›", label=label)
        check("consequence-first", consequence == ('3 stalls this week. Adds a recall-only operations rule '
                                                   '"Route review work away from codex"; seats read it, nothing is blocked.')
              and page.evaluate("""() => { const m = document.querySelector('[data-testid="rail-seat-move"][data-seat="codex"]');
                  const c = m.querySelector('[data-testid="rail-seat-move-consequence"]').getBoundingClientRect();
                  const b = m.querySelector('[data-testid="rail-seat-move-button"]').getBoundingClientRect();
                  return c.bottom <= b.top && b.top >= 0 && b.bottom <= window.innerHeight; }"""), consequence=consequence)
        check("no-change-has-no-button", move("claude").get_by_test_id("rail-seat-move-button").count() == 0)
        page.screenshot(path=str(SHOTS / f"agent-1on1-desk-week.png"))

        codex.get_by_test_id("rail-seat-move-button").click()
        deadline = time.monotonic() + 10
        while not rule_posts(origin) and time.monotonic() < deadline:
            page.wait_for_timeout(200)
        posts = rule_posts(origin)
        body = posts[0] if posts else {}
        check("route-away-posts-the-rule", len(posts) == 1 and body.get("id") == "seat-coach:codex:review"
              and body.get("steering_type") == "operations" and body.get("rule_type") == "policy"
              and "Route review work away from codex" in body.get("statement", ""), body=body)
        result = codex.get_by_test_id("rail-seat-move-result")
        result.wait_for(state="visible", timeout=8000)
        check("result-in-place", result.get_attribute("data-status") == "done"
              and "Rule seat-coach:codex:review added" in (result.text_content() or ""))
        page.screenshot(path=str(SHOTS / f"agent-1on1-desk-done.png"))

        pi = move("pi")
        pi.scroll_into_view_if_needed()
        pi_consequence = (pi.get_by_test_id("rail-seat-move-consequence").text_content() or "").strip()
        check("signin-consequence", pi_consequence.startswith("benched from 2 runs this week: not signed in.")
              and "Shows the one command that signs pi in" in pi_consequence, consequence=pi_consequence)
        pi.get_by_test_id("rail-seat-move-button").click()
        dialog = page.get_by_role("dialog")
        dialog.wait_for(state="visible", timeout=8000)
        check("signin-opens-terminal", "Sign in — pi" in (dialog.text_content() or "")
              and "pi login" in (dialog.text_content() or ""))
        page.screenshot(path=str(SHOTS / f"agent-1on1-desk-signin.png"))
        page.keyboard.press("Escape")
        check("no-rule-for-signin", len(rule_posts(origin)) == 1)

    def section_absent() -> None:
        reset(origin, False)
        open_health()
        page.wait_for_function("""() => document.querySelector('[data-testid="rail-seat-week-window"]')
            ?.getAttribute('data-state') === 'absent'""", timeout=10000)
        cap = (page.get_by_test_id("rail-seat-week-window").text_content() or "").strip()
        check("absent-named", "not reported by this daemon" in cap
              and page.get_by_test_id("rail-seat-move").count() == 0
              and page.get_by_test_id("rail-seat-row").count() == 4, caption=cap)

    for section in (section_week, section_absent):
        try:
            section()
        except SectionFailed:
            pass
        except Exception as exc:  # noqa: BLE001 — every failure lands in the report
            report["steps"][f"{section.__name__}-error"] = {"ok": False, "error": repr(exc)[:500]}
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
