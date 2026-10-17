#!/usr/bin/env python3
"""
desk_signin_test.py — CLI SIGN-IN IS OBVIOUS (DES-seats-page §4.2, "they see it while authenticating")
at 1440x700 on the Desk.

Against the in-process fixture, whose roster has a seat whose sign-in lapsed (codex) and, through the
`roster_login_lines` / `roster_signed_in` / `roster_probed` switches, the daemon's own login line and a
later re-check:

  1. THE DESK ROW: "An AI helper (codex) needs signing in again" with a Sign in action that opens the
     agent's modal in place — no navigation.
  2. THE MODAL: the agent's name; a "Signed out" problem card saying what is happening, why it matters
     and what to do; the daemon's command with the home directory as $HOME (no absolute home path in
     the words, the Copy button's name or its tooltip); Copy; "I've signed in: check again".
  3. CHECK AGAIN (crew's on-demand re-check, GET /roster?refresh=<key>): one read per click; while the
     daemon checks the modal says it is checking; a still-out answer says "Still signed out"; after the
     seat signs in, the next check says the sign-in worked, the problem card is gone, and the Desk row
     clears without a reload. It never opens a terminal (no POST /terminals).
  4. HEALTH: the rail's Health registry offers the same modal for a benched signed-out seat.
  5. FIRST RUN: with every seat signed out, the Desk leads with the sign-in.
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
# The daemon's line names the worker home by its absolute path (as the real daemon does); the modal
# draws it as $HOME/… (DES-seats-page §4.2: it expands inside the quotes, `~` would not).
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
  const p = document.querySelector('[data-testid="agents-modal"]');
  if (!p) return null;
  const copy = p.querySelector('[data-testid="agents-copy"]');
  return {
    seat: p.dataset.agent, title: p.querySelector('h2')?.innerText ?? null, text: p.innerText, html: p.outerHTML.includes('/Users/reel-operator'),
    cards: [...p.querySelectorAll('[data-testid="agents-issue"]')].map(c => c.dataset.code),
    line: p.querySelector('[data-testid="agents-command"]')?.innerText ?? null,
    copy: copy?.getAttribute('aria-label') ?? null, copyTitle: copy?.getAttribute('title') ?? null,
    check: p.querySelector('[data-testid="agents-check"]')?.innerText ?? null,
    result: p.querySelector('[data-testid="agents-check-result"]')?.dataset.state ?? null,
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

    # ── 1. the Desk row opens the modal in place ───────────────────────────────────
    row = page.locator('[data-testid="desk-chore"][data-seat="codex"]')
    row_text = row.inner_text()
    row.get_by_test_id("desk-chore-signin").click()
    page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    page.wait_for_function("() => !!document.querySelector('[data-testid=\"agents-modal\"] [data-testid=\"agents-command\"]')", timeout=5000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-signin-panel.png"))
    check("desk-row", "needs signing in again" in row_text and page.evaluate("() => location.pathname") == "/", row=row_text)

    # ── 2. the modal ──────────────────────────────────────────────────────────────
    pn = page.evaluate(PANEL)
    check("panel",
          pn is not None and pn["seat"] == "codex" and pn["title"] == "codex"
          and pn["cards"][:1] == ["signed_out"] and "What you can do" in pn["text"] and "terminal" in pn["text"].lower()
          and pn["line"] == 'CODEX_HOME="$HOME/.wicked-worker/codex" codex login'
          and "/Users/reel-operator" not in pn["text"] and not pn["html"]
          and pn["copy"] == "Copy the sign-in command"
          and (pn["check"] or "").startswith("I’ve signed in")
          and not pn["terminal"],
          **{k: v for k, v in (pn or {}).items() if k != "text"})

    # ── 3. check again: one GET /roster?refresh=<key> per click (A3b); checking, still out, then back in ──
    before = len([r for r in requests if r.startswith("GET /roster?refresh=codex")])
    set_fixture(origin, roster_signed_in={"codex": False}, roster_refresh_delay_ms=900)
    page.get_by_test_id("agents-check").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state === 'checking'", timeout=5000)
    checking = page.get_by_test_id("agents-check-result").inner_text()
    # The service re-checks: still signed out.
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state === 'still'", timeout=12000)
    still = page.get_by_test_id("agents-check-result").inner_text()
    page.screenshot(path=str(SHOTS / "desk-signin-still.png"))
    # The operator signs in; the service re-checks again.
    set_fixture(origin, roster_signed_in={"codex": True})
    page.get_by_test_id("agents-check").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state === 'in'", timeout=12000)
    back = page.get_by_test_id("agents-check-result").inner_text()
    cards = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"agents-modal\"] [data-testid=\"agents-issue\"]')].map(c => c.dataset.code)")
    reads = len([r for r in requests if r.startswith("GET /roster?refresh=codex")]) - before
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-signin-back.png"))
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"agents-modal\"]')", timeout=5000)
    page.wait_for_function("() => !document.querySelector('[data-testid=\"desk-chore\"][data-seat=\"codex\"]')", timeout=5000)
    check("check-again", "Checking" in checking and "Still signed out" in still and "The sign-in worked" in back
          and "signed_out" not in cards and reads == 2
          and not any(r.startswith("POST /terminals") or r.startswith("POST /seats") for r in requests),
          checking=checking, still=still, back=back, cards=cards, refresh_reads=reads, posts=[r for r in requests if r.startswith("POST")][:5])
    set_fixture(origin, roster_probed=[], roster_refresh_delay_ms=600)

    # ── 4. Health offers the same modal ───────────────────────────────────────────
    set_fixture(origin, roster_signed_in={}, seat_week=True, roster_login_lines={"codex": LINE, "pi": 'PI_CONFIG_DIR="/Users/reel-operator/.wicked-worker/pi" pi login'})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-rail-health").click()
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"rail-seat-move\"]').length >= 1", timeout=10000)
    move = page.locator('[data-testid="rail-seat-move"][data-kind="sign-in"]').first
    move.get_by_test_id("rail-seat-move-button").click()
    page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    page.wait_for_function("() => !!document.querySelector('[data-testid=\"agents-modal\"] [data-testid=\"agents-command\"]')", timeout=5000)
    hp = page.evaluate(PANEL)
    page.screenshot(path=str(SHOTS / "desk-signin-health.png"))
    check("health", hp is not None and hp["line"] is not None and "$HOME/.wicked-worker/" in hp["line"] and not hp["terminal"]
          and not any(r.startswith("POST /terminals") for r in requests), **{k: v for k, v in hp.items() if k != "text"})
    page.keyboard.press("Escape")

    # ── 5. a first-run Desk with no signed-in helper leads with the sign-in ───────
    set_fixture(origin, seat_week=False, roster_signed_in={"claude": False, "codex": False, "agy": False, "pi": False})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    # 2026-10-17: the lead is the pinned setup item "Set up your agents" (a live item, gone once one is signed in).
    page.locator('[data-testid="desk-setup"][data-setup="agents"]').wait_for(state="visible", timeout=10000)
    lead = page.evaluate("""() => {
      // Desk v2: the chores lead the Needs-you inbox's list (the first thing in it).
      const main = document.querySelector('[data-testid="desk-inbox-list"]');
      const first = main ? main.firstElementChild?.dataset.testid : null;
      const chores = document.querySelector('[data-testid="desk-chores"]');
      return { first, lead: chores?.dataset.lead, text: document.querySelector('[data-testid="desk-setup"][data-setup="agents"]')?.innerText,
               rows: document.querySelectorAll('[data-testid="desk-chore"] [data-testid="desk-chore-signin"]').length };
    }""")
    page.screenshot(path=str(SHOTS / "desk-signin-firstrun.png"))
    check("first-run", lead["first"] == "desk-chores" and lead["rows"] >= 4
          and "Set up your agents" in (lead["text"] or "") and "Set up agents" in (lead["text"] or ""), **lead)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
