#!/usr/bin/env python3
"""
desk_signin_test.py — CLI SIGN-IN IS OBVIOUS (DES-STUDIO-REBUILD-001 Amendment 5, decision 5) at
1440x700 on the Desk.

Against the in-process fixture, whose roster has a seat whose sign-in lapsed (codex) and, through the
`roster_login_lines` / `roster_signed_in` switches, the daemon's own login line and a later re-read:

  1. THE DESK ROW: "An AI helper (codex) needs signing in again" with a Sign in action that opens the
     panel in place — no navigation.
  2. THE PANEL: names the CLI; says studio cannot sign in for it and to run ONE command in a terminal;
     shows the daemon's line with the worker home as ~/… (no absolute home path in the words, the Copy
     button's name or its tooltip); a Copy button; "I've signed in — check again".
  3. CHECK AGAIN: with the seat still out, the panel says so (one GET /roster); after the fixture signs
     the seat in, check again says signed in, and the Desk row clears without a reload.
  4. HEALTH: the rail's Health registry offers the same panel for a benched signed-out seat (the
     seat-week move); it never opens a terminal (no POST /terminals).
  5. FIRST RUN: with every seat signed out, the Desk leads with the sign-in (the chores section is
     first, with the lead sentence).
  6. 0 page errors.

Captures: e2e/shots/desk-signin-*.png. Env: FEEDBACK_PORT (default 4368).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4368"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
# The daemon's line names the worker home by its absolute path (as the real daemon does); the panel
# draws it as ~/… (studio#467's rule) — a home-directory spelling `displayText` recognises.
LINE = 'CODEX_HOME="/Users/reel-operator/.wicked-worker/codex" codex login'

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



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
PANEL = """() => {
  const p = document.querySelector('[data-testid="signin-panel"]');
  if (!p) return null;
  const dialog = p.closest('[role="dialog"]');
  return {
    seat: p.dataset.seat, title: dialog?.innerText.split('\\n')[0] ?? null, text: p.innerText,
    line: p.querySelector('[data-testid="signin-line"]')?.innerText ?? null,
    copy: p.querySelector('[data-testid="copy-command"]')?.getAttribute('aria-label') ?? null,
    copyTitle: p.querySelector('[data-testid="copy-command"]')?.getAttribute('title') ?? null,
    copyCommand: p.querySelector('[data-testid="copy-command"]')?.dataset.command ?? null,
    check: p.querySelector('[data-testid="signin-check"]')?.innerText ?? null,
    result: p.querySelector('[data-testid="signin-result"]')?.dataset.state ?? null,
    terminal: !!p.querySelector('[data-testid="agent-terminal"], .xterm'),
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    requests: list[str] = []
    page.on("request", lambda r: requests.append(f"{r.method} {r.url.split('/api/v1')[-1]}") if "/api/v1/" in r.url else None)

    # The daemon's own line for codex (worker home as an absolute path, as the real daemon sends it).
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], seat_week=False,
                roster_login_lines={"codex": LINE}, roster_signed_in={})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => !!document.querySelector('[data-testid=\"desk-chore\"][data-seat=\"codex\"]')", timeout=10000)

    # ── 1. the Desk row opens the panel in place ───────────────────────────────────
    row = page.locator('[data-testid="desk-chore"][data-seat="codex"]')
    row_text = row.inner_text()
    row.get_by_test_id("desk-chore-signin").click()
    page.get_by_test_id("signin-panel").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-signin-panel.png"))
    check("desk-row", "needs signing in again" in row_text and page.evaluate("() => location.pathname") == "/", row=row_text)

    # ── 2. the panel ──────────────────────────────────────────────────────────────
    pn = page.evaluate(PANEL)
    check("panel",
          pn is not None and pn["seat"] == "codex" and (pn["title"] or "").startswith("Sign in — codex")
          and "terminal" in pn["text"].lower() and "can’t sign in for you" in pn["text"]
          and pn["line"] == 'CODEX_HOME="~/.wicked-worker/codex" codex login'
          and "/Users/reel-operator" not in pn["text"]
          and pn["copy"] == "copy the sign-in command for codex" and "/Users/reel-operator" not in (pn["copyTitle"] or "")
          and pn["copyCommand"] == LINE
          and (pn["check"] or "").startswith("I’ve signed in")
          and not pn["terminal"],
          **{k: v for k, v in (pn or {}).items() if k != "text"})

    # ── 3. check again: still out, then back in; the row clears ──────────────────
    before = len([r for r in requests if r == "GET /roster"])
    page.get_by_test_id("signin-check").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"signin-result\"]')?.dataset.state === 'signed-out'", timeout=5000)
    still = page.get_by_test_id("signin-result").inner_text()
    set_fixture(origin, roster_signed_in={"codex": True})
    page.get_by_test_id("signin-check").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"signin-result\"]')?.dataset.state === 'signed-in'", timeout=5000)
    back = page.get_by_test_id("signin-result").inner_text()
    reads = len([r for r in requests if r == "GET /roster"]) - before
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-signin-back.png"))
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"signin-panel\"]')", timeout=5000)
    page.wait_for_function("() => !document.querySelector('[data-testid=\"desk-chore\"][data-seat=\"codex\"]')", timeout=5000)
    check("check-again", "still signed out" in still and "is signed in" in back and reads == 2
          and not any(r.startswith("POST /terminals") for r in requests),
          still=still, back=back, roster_reads=reads, posts=[r for r in requests if r.startswith("POST")][:5])

    # ── 4. Health offers the same panel ───────────────────────────────────────────
    set_fixture(origin, roster_signed_in={}, seat_week=True, roster_login_lines={"codex": LINE, "pi": 'PI_CONFIG_DIR="/Users/reel-operator/.wicked-worker/pi" pi login'})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("rail-health-toggle").click()
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"rail-seat-move\"]').length >= 1", timeout=10000)
    move = page.locator('[data-testid="rail-seat-move"][data-kind="sign-in"]').first
    move.get_by_test_id("rail-seat-move-button").click()
    page.get_by_test_id("signin-panel").wait_for(state="visible", timeout=5000)
    hp = page.evaluate(PANEL)
    page.screenshot(path=str(SHOTS / "desk-signin-health.png"))
    check("health", hp is not None and hp["line"] is not None and "~/.wicked-worker/" in hp["line"] and not hp["terminal"]
          and not any(r.startswith("POST /terminals") for r in requests), **{k: v for k, v in hp.items() if k != "text"})
    page.keyboard.press("Escape")

    # ── 5. a first-run Desk with no signed-in helper leads with the sign-in ───────
    set_fixture(origin, seat_week=False, roster_signed_in={"claude": False, "codex": False, "agy": False, "pi": False})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-signin-lead").wait_for(state="visible", timeout=10000)
    lead = page.evaluate("""() => {
      const main = document.querySelector('.wk-desk-main');
      const first = main ? main.firstElementChild?.dataset.testid : null;
      const chores = document.querySelector('[data-testid="desk-chores"]');
      return { first, lead: chores?.dataset.lead, text: document.querySelector('[data-testid="desk-signin-lead"]')?.innerText,
               rows: document.querySelectorAll('[data-testid="desk-chore"] [data-testid="desk-chore-signin"]').length };
    }""")
    page.screenshot(path=str(SHOTS / "desk-signin-firstrun.png"))
    check("first-run", lead["first"] == "desk-chores" and lead["lead"] == "true" and lead["rows"] >= 4
          and "No AI helper is signed in yet" in (lead["text"] or ""), **lead)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
