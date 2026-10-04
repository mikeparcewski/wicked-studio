#!/usr/bin/env python3
"""
desk_gate_moves_test.py — moves made from a gate say what happened, under STUDIO_SKIN=desk at 1440x700
against the in-process fixture:

  1. #480 REASSIGN IS ONE MOVE: on a run paused at a seat-failure escalation (unit 1 failed on codex),
     picking claude and pressing Reassign sends ONE `POST /runs/:id/reassign {cli}` after the undo
     window — no `POST /gate` approve first.
  2. #480 A REFUSED MOVE STAYS IN VIEW: with the daemon refusing the move, the gate stays open, the
     card shows the daemon's sentence and "reassign again", and a "Not moved" notice is raised; the
     second try sends a second reassign and still no approve.
  3. #476 ONE SAVE PER EDIT: on /steering/policies, adding `vendor` to PAT-100's excludes with Enter
     and moving to the next cell sends exactly one `POST /governance/rules` (excludes [vendor]); the row
     then reads the daemon's value, and no later save carries the earlier excludes.
  4. 0 page errors.

Captures: e2e/shots/desk-gate-moves-*.png. Env: FEEDBACK_PORT (default 4358).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4358"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def posts(kind: str) -> list:
    got = json.loads(urllib.request.urlopen(f"{origin}/__fixture/{kind}-posts", timeout=10).read())["posts"]
    return [p_ for p_ in got if p_["runId"] == "r-seat"]


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))

    def open_card() -> None:
        page.goto(f"{origin}/runs/r-seat", wait_until="networkidle")
        row = page.get_by_test_id("steering-reassign-row").first
        try:
            row.wait_for(state="visible", timeout=15000)
        except Exception:
            page.screenshot(path=str(SHOTS / "desk-gate-moves-no-reassign.png"))
            fail("reassign-offered", {"why": "no steering-reassign-row on the escalation card",
                                      "text": page.evaluate("() => document.body.innerText.slice(0, 600)")})
        page.get_by_test_id("steering-reassign-seat").first.select_option("claude")

    # ── 1. one move ──────────────────────────────────────────────────────────────
    set_fixture(origin, seat_escalation=True, reassign_refuse=0, reset_gate_posts=True)
    open_card()
    page.get_by_test_id("steering-reassign").first.click()
    page.wait_for_timeout(11500)  # the 10 s undo window, then the send
    re1, gate1 = posts("reassign"), posts("gate")
    page.screenshot(path=str(SHOTS / "desk-gate-moves-one-call.png"))
    check("one-call-no-approve-first", len(re1) == 1 and re1[0]["body"].get("cli") == "claude" and gate1 == [],
          reassign=re1, gate=gate1)

    # ── 2. a refused move stays in view ──────────────────────────────────────────
    set_fixture(origin, reassign_refuse=1, reset_gate_posts=True)
    open_card()
    page.get_by_test_id("steering-reassign").first.click()
    try:
        page.get_by_test_id("steering-reassign-error").first.wait_for(state="visible", timeout=15000)
        err = page.get_by_test_id("steering-reassign-error").first.inner_text()
    except Exception:
        err = None
    body = page.evaluate("() => document.body.innerText")
    page.screenshot(path=str(SHOTS / "desk-gate-moves-refused.png"))
    check("refused-move-in-view", err is not None and "not in this run" in err
          and page.get_by_test_id("steering-reassign-retry").count() >= 1 and posts("gate") == []
          and "Not moved" in body, error=err, gate=posts("gate"))
    page.get_by_test_id("steering-reassign-retry").first.click()
    page.wait_for_timeout(11500)
    re2 = posts("reassign")
    check("move-again-is-a-second-reassign", len(re2) == 2 and posts("gate") == [], reassign=re2)
    set_fixture(origin, seat_escalation=False)

    # ── 3. #476: one save per chip edit; nothing stale follows it ─────────────────
    def rule_posts() -> list:
        got = json.loads(urllib.request.urlopen(f"{origin}/__fixture/rule-posts", timeout=10).read())["posts"]
        return [b for b in got if isinstance(b, dict) and b.get("id") == "PAT-100"]

    set_fixture(origin, steering_rules=True)
    before = len(rule_posts())
    page.goto(f"{origin}/steering/policies", wait_until="networkidle")
    row = page.locator('[data-testid="steering-grid-row"][data-rule-id="PAT-100"]')
    row.wait_for(state="visible", timeout=15000)
    row.get_by_test_id("steering-cell-excludes").click()
    inp = row.get_by_test_id("steering-cell-excludes-input")
    inp.fill("vendor")
    inp.press("Enter")   # adds the chip
    inp.press("Enter")   # done editing: the one save
    page.wait_for_timeout(1500)
    row.get_by_test_id("steering-cell-statement").click()  # the next cell
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    sent = rule_posts()[before:]
    shown = row.get_by_test_id("steering-cell-excludes").inner_text()
    page.screenshot(path=str(SHOTS / "desk-gate-moves-steering-grid.png"))
    check("one-save-no-stale-resend", len(sent) == 1 and sent[0].get("excludes") == ["vendor"] and "vendor" in shown,
          sent=[b.get("excludes") for b in sent], shown=shown)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
