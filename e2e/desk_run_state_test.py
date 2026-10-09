#!/usr/bin/env python3
"""
desk_run_state_test.py — the gate and run-state defects the desk reel found, on the Desk at
1440x700 against the in-process fixture:

  1. #466 A FAILED READ IS NOT AN EMPTY LIST: with GET /runs answering 500 and a registered repo, the
     Desk says the read failed (`desk-runs-failed`) with a retry; it derives no "never indexed" row, no
     "Index all" batch, no "Nothing has been started yet". Retry after the daemon recovers → headline.
  2. #473 ⌘K FROM A FOCUSED FIELD: on /chat/new (the composer takes focus on arrival) ⌘K opens the
     palette; ⌘K inside the palette's own input closes it.
  3. #478 A REJECTED PLAN ENDS CANCELLED: the run page's banner says "Run cancelled.", shows the
     operator's reject note (crew's `gate.decided` audit, `detail.amend`), and its all-runs link lands
     on /work with the Cancelled filter, where the run is listed.
  4. #469 A STEP GATE IS ANSWERABLE ON THE SESSION: a run paused before its first unit shows a
     proposal card ("Start the triage step?") with Go; Go posts the gate answer.
  5. #470 ONE PLAN, ONE COUNT: a plan gate whose floor added 3 steps to the PA's 8 proposes 11, in the
     chain's words, says what the floor added, and the chain under it lists the same 11.
  6. 0 page errors.

Captures: e2e/shots/desk-run-state-*.png. Env: FEEDBACK_PORT (default 4357).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4357"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # ── 1. #466: GET /runs fails ─────────────────────────────────────────────────
    set_fixture(origin, wave1=True, repo=True, runs_fail=True)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("desk-runs-failed").wait_for(state="visible", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-run-state-runs-failed-missing.png"))
        text = page.evaluate("() => (document.querySelector('[data-testid=\"desk\"]') || document.body).innerText.slice(0, 600)")
        fail("runs-read-failed-said", {"why": "no [data-testid=desk-runs-failed] while GET /runs answered 500", "desk_text": text})
    page.wait_for_timeout(1500)  # the repo register lands; nothing may be derived from the missing list
    desk = page.evaluate("() => document.querySelector('[data-testid=\"desk\"]').innerText")
    page.screenshot(path=str(SHOTS / "desk-run-state-runs-failed.png"))
    check("no-verdict-from-a-failed-read",
          "never indexed" not in desk and "Index all" not in desk and "Nothing has been started yet" not in desk
          and "Nothing needs you" not in desk and page.get_by_test_id("desk-runs-retry").count() == 1,
          desk=desk[:500])
    set_fixture(origin, runs_fail=False)
    page.get_by_test_id("desk-runs-retry").click()
    page.get_by_test_id("desk-headline").wait_for(state="visible", timeout=15000)
    check("retry-reads-again", page.get_by_test_id("desk-runs-failed").count() == 0)
    set_fixture(origin, repo=False)

    # ── 2. #473: ⌘K from the composer /chat/new focuses ─────────────────────────
    page.goto(f"{origin}/chat/new", wait_until="networkidle")
    page.wait_for_timeout(600)
    focused = page.evaluate("() => { const a = document.activeElement; return a ? a.tagName.toLowerCase() : ''; }")
    if focused not in ("textarea", "input"):
        # The page focuses its composer on arrival; if this build does not, focus it as an operator would.
        page.locator('[data-testid="chat-composer"] textarea').first.focus()
        focused = page.evaluate("() => document.activeElement.tagName.toLowerCase()")
    page.keyboard.press("ControlOrMeta+k")
    try:
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=4000)
        opened = True
    except Exception:
        opened = False
        page.screenshot(path=str(SHOTS / "desk-run-state-cmdk-from-field.png"))
    check("cmdk-opens-from-a-field", opened and focused in ("textarea", "input"), focused=focused)
    page.keyboard.press("ControlOrMeta+k")
    page.wait_for_timeout(400)
    check("cmdk-closes-from-the-palette-input", page.get_by_test_id("palette-input").count() == 0)

    # ── 3. #478: the cancelled run's banner keeps the note; the link finds the run ──
    set_fixture(origin, reject_note=True)
    page.goto(f"{origin}/runs/r-rejected", wait_until="networkidle")
    banner = page.locator('[data-testid="failure-banner"][data-kind="cancelled"]').first
    banner.wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("failure-reject-note").first.wait_for(state="visible", timeout=8000)
        note = page.get_by_test_id("failure-reject-note").first.inner_text()
    except Exception:
        note = None
        page.screenshot(path=str(SHOTS / "desk-run-state-reject-note-missing.png"))
    link = banner.get_by_test_id("failure-all-runs")
    href = link.get_attribute("href") if link.count() else None
    check("reject-note-on-the-banner", note is not None and "the hall is booked that week" in note, note=note,
          banner=banner.inner_text()[:300])
    # S15c: the list is "See everything › Sessions" with the Stopped lens (`/work?filter=` moved).
    check("all-runs-link-follows-the-banner", href == "/everything?tab=sessions&filter=cancelled", href=href)
    link.click()
    page.wait_for_function("() => location.pathname === '/everything'", timeout=8000)
    page.wait_for_timeout(800)
    listed = page.locator('[data-testid="run-finished-row"][data-run-id="r-rejected"]').count()
    page.screenshot(path=str(SHOTS / "desk-run-state-work-cancelled.png"))
    check("the-run-is-in-the-list", listed == 1, url=page.url, listed=listed)
    set_fixture(origin, reject_note=False)

    # ── 4. #469: the pre-unit def gate in the session thread (S15e) ─────────────
    set_fixture(origin, home_paths=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-home-gate", wait_until="networkidle")
    try:
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-run-state-step-card-missing.png"))
    gate_row = page.get_by_test_id("session-gate-row")
    check("step-gate-in-thread", gate_row.is_visible() and gate_row.get_attribute("data-reason") == "def",
          got=gate_row.get_attribute("data-reason") if gate_row.is_visible() else "missing")
    # Approve: first choice for a def gate
    page.get_by_test_id("session-gate-choice").first.click()
    page.wait_for_timeout(11500)  # the 10 s undo window, then the one post
    posts = json.loads(urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10).read())["posts"]
    mine = [p_ for p_ in posts if p_["runId"] == "r-home-gate"]
    check("go-answers-the-gate", len(mine) == 1 and mine[0]["body"].get("approve") is True, posts=mine)
    set_fixture(origin, home_paths=False)

    # ── 5. #470: the floor-filled plan, one count ────────────────────────────────
    set_fixture(origin, floor_plan=True)
    page.goto(f"{origin}/s/run%3Ar-floor", wait_until="networkidle")
    page.locator('[data-testid="session-proposal"][data-kind="plan"]').wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(600)
    plan_text = page.get_by_test_id("session-proposal-text").inner_text()
    plan_why = page.get_by_test_id("session-proposal-why").inner_text()
    chain = page.evaluate("""() => [...document.querySelectorAll('[data-testid="chain-step"]')]
        .map(e => ({ id: e.dataset.stepId, by: e.dataset.addedBy }))""")
    page.screenshot(path=str(SHOTS / "desk-run-state-floor-plan.png"))
    check("proposal-names-the-11-steps", "(11 steps)" in plan_text and "Test plan" in plan_text and "Security check" in plan_text
          and "3 required by the floor: Test plan, Architecture, Security check" in plan_why, text=plan_text, why=plan_why)
    check("chain-lists-the-same-11", len(chain) == 11 and [c["id"] for c in chain if c["by"] == "floor"]
          == ["test_plan", "architecture", "security_review"], chain=chain)
    set_fixture(origin, floor_plan=False)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
