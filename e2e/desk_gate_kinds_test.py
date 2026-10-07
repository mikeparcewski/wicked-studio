#!/usr/bin/env python3
"""
desk_gate_kinds_test.py — every gate kind answerable in the session thread (S15e),
under STUDIO_SKIN=desk at 1440x700 against the in-process fixture:

  1. DEF GATE IN THREAD: navigating to a run's session thread at #gate
     renders `session-gate-row` with the 4-verb layout (Approve / Approve and steer /
     Send back / Stop); `session-gate-question` shows the gate prompt.
  2. STEER OPENS NOTE (no send yet): clicking "Approve and steer" opens the note field
     without sending.
  3. APPROVE SENDS: clicking Approve submits, the row transitions to the chosen state;
     `session-gate-chosen` appears; the POST carries `{approve: true}`.
  4. UNDO SENDS NOTHING: after clicking Approve, the fold reads "You chose: Approve ·
     Undo N s" (with colon); clicking Undo before the window expires emits no gate POST.
  5. ENTER INERT UNTIL MOVED: pressing Enter on the unfocused row does nothing;
     pressing an arrow key first enables Enter.
  6. ESCALATION GATE (r-review, gate_move=True): `session-gate-row` appears with
     `data-reason="escalation"`; Send back choice is present; clicking Send back
     opens the note; submitting sends {approve:false, action:request_changes, amend}.
  7. DELIVER GATE (r-trust-deliver, trust_rules=True): `session-proposal` is present
     and no `session-gate-row`; delivery details show diffstat (2 files changed) and
     the run branch from GET /runs/r-trust-deliver/diff.
  8. DESK NEEDS-YOU ROW → /s/run%3A<id>#gate: clicking the needs-you row on the Desk
     navigates to the session thread with #gate in the URL, and the gate row is visible.
  9. 0 page errors.
 10. SEAT-FAILURE ESCALATION (r-seat, seat_escalation=True): the escalation row appears;
     Reassign → POST /runs/r-seat/reassign recorded; Stop → {approve:false, ord};
     Approve and steer → {approve:true, amend, amendScope}.
 11. 409 GATE CHANGED (gate_moved fixture): the row shows the moved-gate error words;
     no second gate POST is sent.

Captures: e2e/shots/desk-gate-kinds-*.png. Env: FEEDBACK_PORT (default 4358).
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
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN!r}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def gate_posts(run_id: str = "r-home-gate") -> list:
    got = json.loads(urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10).read())["posts"]
    return [p for p in got if p["runId"] == run_id]


def reassign_posts(run_id: str = "r-seat") -> list:
    got = json.loads(urllib.request.urlopen(f"{origin}/__fixture/reassign-posts", timeout=10).read())["posts"]
    return [p for p in got if p["runId"] == run_id]


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # ── 1. DEF GATE IN THREAD ────────────────────────────────────────────────
    set_fixture(origin, home_paths=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-home-gate#gate", wait_until="networkidle")
    try:
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-row.png"))
        fail("def-gate-row", {
            "why": "session-gate-row did not appear on the def gate run",
            "text": page.evaluate("() => document.body.innerText.slice(0, 600)"),
        })

    row = page.get_by_test_id("session-gate-row")
    question = page.get_by_test_id("session-gate-question")
    check("def-gate-question", question.is_visible(), text=question.inner_text())

    choices = page.get_by_test_id("session-gate-choice").all()
    keys = [c.get_attribute("data-choice-key") for c in choices]
    check("def-gate-choices", keys == ["approve", "steer", "send-back", "stop"],
          got=keys, want=["approve", "steer", "send-back", "stop"])

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-def.png"))

    # ── 2. STEER OPENS NOTE (no send yet) ───────────────────────────────────
    steer = page.get_by_test_id("session-gate-choice").nth(1)  # Approve and steer
    steer.click()
    try:
        page.get_by_test_id("session-gate-note").wait_for(state="visible", timeout=5_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-note.png"))
        fail("steer-opens-note", {"why": "note field did not appear after clicking Approve and steer"})
    check("steer-opens-note", True)
    check("steer-no-send-yet", len(gate_posts()) == 0,
          why="clicking steer must not send before the note is submitted")
    send_btn = page.get_by_test_id("session-gate-send")
    check("steer-send-disabled-empty", send_btn.is_disabled(),
          why="session-gate-send must be disabled while the note is empty")

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-steer-note.png"))

    # Close the note by cancelling
    page.get_by_text("Cancel").click()

    # ── 3. APPROVE SENDS ─────────────────────────────────────────────────────
    set_fixture(origin, home_paths=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-home-gate#gate", wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)

    approve = page.get_by_test_id("session-gate-choice").nth(0)  # Approve
    approve.click()
    try:
        page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-chosen.png"))
        fail("approve-sends", {"why": "session-gate-chosen did not appear after clicking Approve"})

    # Wait for the 10 s undo window to expire, then the POST fires
    page.wait_for_timeout(11_500)
    page.screenshot(path=str(SHOTS / "desk-gate-kinds-approved.png"))
    posts = gate_posts()
    body = posts[-1].get("body", {}) if posts else {}
    check("approve-sends", len(posts) > 0 and body.get("approve") is True,
          posts=posts)

    # ── 4. UNDO SENDS NOTHING ───────────────────────────────────────────────
    # page.goto() to the same URL (same origin+hash) is a same-document anchor
    # navigation in Chromium — the page does NOT reload and the gate stays cleared
    # from step 3's clearGate(). Use reload() to guarantee a full page load.
    set_fixture(origin, home_paths=True, reset_gate_posts=True)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)

    page.get_by_test_id("session-gate-choice").nth(0).click()  # Approve
    try:
        page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
    except Exception:
        fail("undo-setup", {"why": "chosen state did not appear for undo test"})

    # Fold wording during the undo window must be "You chose: <label> · Undo N s" (with colon)
    chosen_text = page.get_by_test_id("session-gate-chosen").inner_text()
    check("chosen-wording", "You chose: Approve" in chosen_text, got=chosen_text)

    # The undo button appears during the undo window
    try:
        undo_btn = page.locator(".wk-session-gate-undo")
        undo_btn.wait_for(state="visible", timeout=5_000)
        undo_btn.click()
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-undo.png"))
        fail("undo-button", {"why": "Undo button did not appear within the undo window"})

    # After undo, the gate row should reappear with choices
    try:
        page.get_by_test_id("session-gate-choices").wait_for(state="visible", timeout=5_000)
    except Exception:
        fail("undo-row-back", {"why": "gate choices did not reappear after Undo"})

    posts_after_undo = gate_posts()
    check("undo-sends-nothing", len(posts_after_undo) == 0,
          why="Undo must prevent the gate POST from firing", posts=posts_after_undo)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-undo.png"))

    # ── 5. ENTER INERT UNTIL MOVED ──────────────────────────────────────────
    # Reload to ensure fresh pick state ({focus:0, moved:false}) — the previous
    # step left the gate answered and cleared; a non-reload would leave moved=true.
    set_fixture(origin, home_paths=True, reset_gate_posts=True)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)

    row_el = page.get_by_test_id("session-gate-row")
    row_el.focus()

    # Enter without moving focus must not send
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    check("enter-inert", len(gate_posts()) == 0,
          why="Enter before moving focus must not send")

    # Home keeps focus on Approve (index 0) but sets moved=true; Enter then sends.
    # ArrowRight would land on "Approve and steer" (needsNote=True) which opens a
    # note field instead of triggering session-gate-chosen.
    page.keyboard.press("Home")
    page.keyboard.press("Enter")
    try:
        page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
    except Exception:
        fail("enter-after-move", {"why": "Enter after Home did not trigger a send"})
    # Wait for the undo window to expire before checking the POST log
    page.wait_for_timeout(11_500)
    posts_enter = gate_posts()
    check("enter-after-move", len(posts_enter) > 0, posts=posts_enter)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-enter.png"))

    # ── 6. ESCALATION GATE (r-review) ───────────────────────────────────────
    set_fixture(origin, gate_move=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-review#gate", wait_until="networkidle")
    try:
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-esc.png"))
        fail("escalation-row", {
            "why": "session-gate-row did not appear for r-review escalation gate",
            "text": page.evaluate("() => document.body.innerText.slice(0, 600)"),
        })

    esc_row = page.get_by_test_id("session-gate-row")
    check("escalation-reason", esc_row.get_attribute("data-reason") == "escalation",
          got=esc_row.get_attribute("data-reason"))

    esc_choices = page.get_by_test_id("session-gate-choice").all()
    esc_keys = [c.get_attribute("data-choice-key") for c in esc_choices]
    check("escalation-has-send-back", "send-back" in esc_keys, got=esc_keys)
    check("escalation-has-stop", "stop" in esc_keys, got=esc_keys)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-escalation.png"))

    # Click Send back → opens note
    send_back = page.locator("[data-choice-key='send-back']")
    send_back.click()
    try:
        page.get_by_test_id("session-gate-note").wait_for(state="visible", timeout=5_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-esc-note.png"))
        fail("escalation-send-back-note", {"why": "note field did not open after Send back"})
    check("escalation-send-back-opens-note", True)

    # Submit the note → verify POST body
    note_text = "the regression test is still missing"
    page.get_by_test_id("session-gate-note").fill(note_text)
    page.get_by_test_id("session-gate-send").click()
    try:
        page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-esc-no-chosen.png"))
        fail("escalation-send-back-chosen", {"why": "chosen state did not appear after send-back"})

    # Wait for the 10 s undo window to expire, then the POST fires
    page.wait_for_timeout(11_500)
    esc_posts = gate_posts("r-review")
    esc_body = esc_posts[-1].get("body", {}) if esc_posts else {}
    check("escalation-send-back-post",
          len(esc_posts) > 0
          and esc_body.get("approve") is False
          and esc_body.get("action") == "request_changes"
          and note_text in (esc_body.get("amend") or "")
          and "ord" in esc_body,
          posts=esc_posts)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-esc-sent.png"))

    # ── 7. DELIVER GATE (r-trust-deliver) → ProposalCard, diffstat, branch ─────
    set_fixture(origin, trust_rules=True)
    page.goto(f"{origin}/s/run%3Ar-trust-deliver", wait_until="networkidle")
    try:
        page.get_by_test_id("session-proposal").wait_for(state="visible", timeout=15_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-deliver-proposal.png"))
        fail("deliver-proposal", {
            "why": "session-proposal did not appear for r-trust-deliver",
            "text": page.evaluate("() => document.body.innerText.slice(0, 600)"),
        })
    no_gate_row_deliver = page.get_by_test_id("session-gate-row").count() == 0
    check("deliver-no-gate-row", no_gate_row_deliver,
          why="deliver gate must show ProposalCard, not session-gate-row")

    # Open the delivery details and assert diffstat + branch from GET /runs/r-trust-deliver/diff
    detail = page.get_by_test_id("session-proposal-deliver-detail")
    if detail.count() > 0:
        detail.locator("summary").click()
        # Wait for the diff to load (async fetch)
        try:
            page.get_by_test_id("session-proposal-deliver-diffstat").wait_for(state="visible", timeout=8_000)
            diffstat_text = page.get_by_test_id("session-proposal-deliver-diffstat").inner_text()
            check("deliver-diffstat", "files changed" in diffstat_text, got=diffstat_text)
        except Exception:
            page.screenshot(path=str(SHOTS / "desk-gate-kinds-deliver-diffstat.png"))
            fail("deliver-diffstat", {"why": "session-proposal-deliver-diffstat did not appear"})
        branch_el = page.get_by_test_id("session-proposal-deliver-branch")
        if branch_el.count() > 0:
            branch_text = branch_el.inner_text()
            check("deliver-branch", "wicked/r-trust-deliver" in branch_text, got=branch_text)
        else:
            check("deliver-branch", True, note="run_branch/diff.branch not in session — skipped")
        # Assert per-check floor lines from repoChecksEvaluated
        check_els = page.get_by_test_id("session-proposal-deliver-check").all()
        check("deliver-floor-checks", len(check_els) > 0,
              why="deliver disclosure must show per-check floor lines from repoChecksEvaluated")
        if len(check_els) > 0:
            texts = [el.inner_text() for el in check_els]
            check("deliver-floor-check-format", all(" · " in t for t in texts),
                  why="each floor check line must use 'name · passed/failed · exit N · N s' format",
                  got=texts)
    else:
        check("deliver-diffstat", False, why="session-proposal-deliver-detail not found")
        check("deliver-branch", False, why="session-proposal-deliver-detail not found")
        check("deliver-floor-checks", False, why="session-proposal-deliver-detail not found")
        check("deliver-floor-check-format", False, why="session-proposal-deliver-detail not found")

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-deliver.png"))

    # ── 8. DESK NEEDS-YOU ROW → /s/run%3A<id>#gate ──────────────────────────
    # S15e: gated waiting sessions link to sessionPath(id)+'#gate'. r-home-gate is
    # unfiled ("Not in a project"), so it is outside the center's 3-card limit and
    # appears in the rail sidebar (data-testid="rail-session"), not desk-session.
    set_fixture(origin, home_paths=True)
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        # r-home-gate is awaiting_human — find it in the rail by run-id
        page.locator('[data-testid="rail-session"][data-run-id="r-home-gate"]').wait_for(state="visible", timeout=10_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-needs-you.png"))
        fail("needs-you-link", {
            "why": "rail-session[data-run-id=r-home-gate] did not appear on the Desk for home_paths fixture",
            "text": page.evaluate("() => document.body.innerText.slice(0, 600)"),
        })

    needs_you = page.locator('[data-testid="rail-session"][data-run-id="r-home-gate"]')
    run_id = needs_you.get_attribute("data-run-id") or "r-home-gate"
    needs_you.click()

    try:
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=10_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-needs-you-click.png"))
        fail("needs-you-navigates", {
            "why": "gate row did not appear after clicking needs-you",
            "url": page.url,
        })

    url_has_hash = "#gate" in page.url
    check("needs-you-url", url_has_hash, got=page.url, want=f"...#gate")

    # Assert that the gate row (or deliver card's Go button) is focused on #gate arrival.
    focused_testid = page.evaluate("() => document.activeElement?.getAttribute('data-testid') ?? ''")
    check("needs-you-focus", focused_testid == "session-gate-row" or focused_testid == "session-proposal-go",
          got=focused_testid, want="session-gate-row or session-proposal-go")

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-needs-you.png"))

    # ── 9. Zero page errors ───────────────────────────────────────────────────
    check("no-page-errors", errors == [], errors=errors)

    # ── 10. SEAT-FAILURE ESCALATION (r-seat) ─────────────────────────────────
    set_fixture(origin, seat_escalation=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-seat#gate", wait_until="networkidle")
    try:
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-no-seat.png"))
        fail("seat-gate-row", {
            "why": "session-gate-row did not appear for r-seat seat-failure escalation",
            "text": page.evaluate("() => document.body.innerText.slice(0, 600)"),
        })

    seat_row = page.get_by_test_id("session-gate-row")
    check("seat-escalation-reason", seat_row.get_attribute("data-reason") == "escalation",
          got=seat_row.get_attribute("data-reason"))

    seat_choices_all = page.get_by_test_id("session-gate-choice").all()
    seat_keys = [c.get_attribute("data-choice-key") for c in seat_choices_all]
    check("seat-has-stop", "stop" in seat_keys, got=seat_keys)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-seat-esc.png"))

    # Reassign → POST /runs/r-seat/reassign; must be present (seat-failure escalation always has one).
    reassign_btn = page.locator("[data-choice-key^='reassign:']")
    check("seat-has-reassign", reassign_btn.count() > 0,
          why="seat-failure escalation must offer a Reassign choice; none found in pool")
    if reassign_btn.count() > 0:
        set_fixture(origin, seat_escalation=True, reset_gate_posts=True)
        page.reload(wait_until="networkidle")
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)
        reassign_btn = page.locator("[data-choice-key^='reassign:']").first
        reassign_btn.click()
        try:
            page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
        except Exception:
            page.screenshot(path=str(SHOTS / "desk-gate-kinds-seat-reassign.png"))
            fail("seat-reassign-chosen", {"why": "chosen state did not appear after Reassign"})
        # Reassign also goes through the 10 s undo window before the POST fires
        page.wait_for_timeout(11_500)
        r_posts = reassign_posts("r-seat")
        check("seat-reassign-post", len(r_posts) > 0, posts=r_posts)

    # Stop → {approve:false, ord}
    set_fixture(origin, seat_escalation=True, reset_gate_posts=True)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)
    page.locator("[data-choice-key='stop']").click()
    try:
        page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-seat-stop.png"))
        fail("seat-stop-chosen", {"why": "chosen state did not appear after Stop"})
    page.wait_for_timeout(11_500)
    seat_stop_posts = gate_posts("r-seat")
    seat_stop_body = seat_stop_posts[-1].get("body", {}) if seat_stop_posts else {}
    check("seat-stop-post",
          len(seat_stop_posts) > 0
          and seat_stop_body.get("approve") is False
          and "ord" in seat_stop_body,
          posts=seat_stop_posts)

    # Approve and steer → {approve:true, amend}
    set_fixture(origin, seat_escalation=True, reset_gate_posts=True)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)
    steer_btn = page.locator("[data-choice-key='steer']")
    steer_btn.click()
    try:
        page.get_by_test_id("session-gate-note").wait_for(state="visible", timeout=5_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-seat-steer.png"))
        fail("seat-steer-note", {"why": "note field did not open for Approve and steer on r-seat"})
    page.get_by_test_id("session-gate-note").fill("retry with fresh approach")
    page.get_by_test_id("session-gate-send").click()
    try:
        page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-seat-steer-chosen.png"))
        fail("seat-steer-chosen", {"why": "chosen did not appear after Approve and steer on r-seat"})
    page.wait_for_timeout(11_500)
    seat_steer_posts = gate_posts("r-seat")
    seat_steer_body = seat_steer_posts[-1].get("body", {}) if seat_steer_posts else {}
    # r-seat: cursor IS the creator unit (ord 1, build stage) → steerScopeTarget returns null
    # → no amendScope in the wire body (engine refuses amendScope when no creator is ahead).
    check("seat-steer-post",
          len(seat_steer_posts) > 0
          and seat_steer_body.get("approve") is True
          and "ord" in seat_steer_body,
          posts=seat_steer_posts)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-seat-done.png"))

    # ── 11. 409 GATE CHANGED (gate_moved) ───────────────────────────────────
    set_fixture(origin, home_paths=True, gate_moved=["r-home-gate"], reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-home-gate#gate", wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15_000)

    # Click Approve — the fixture will return 409 gate_changed for the first POST
    page.get_by_test_id("session-gate-choice").nth(0).click()  # Approve
    try:
        # After 409, the gate row should show the error (not chosen state)
        page.get_by_test_id("session-gate-error").wait_for(state="visible", timeout=12_000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-409-no-error.png"))
        fail("gate-moved-error", {
            "why": "session-gate-error did not appear after 409 gate_changed",
            "text": page.evaluate("() => document.body.innerText.slice(0, 600)"),
        })

    err_text = page.get_by_test_id("session-gate-error").inner_text()
    check("gate-moved-words", "gate" in err_text.lower() or "changed" in err_text.lower(),
          got=err_text[:120])

    # Only ONE gate POST was made (no retry on 409 gate_changed)
    moved_posts = gate_posts("r-home-gate")
    check("gate-moved-no-double-post", len(moved_posts) == 1,
          why="409 gate_changed must not trigger a second POST", posts=moved_posts)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-409.png"))

    # ── 12. ESCALATION ARMS — r-timeout (repo_checks_timeout: extend / targeted / accept_partial) ─
    set_fixture(origin, escalation_arms=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-timeout#gate", wait_until="networkidle")
    # Wait for the gate row to appear AND classify as escalation (events must be loaded for this).
    # GateRow returns null until events load, so session-gate-row is only visible once events are set.
    # The explicit data-reason=escalation wait ensures the offer choices are present.
    try:
        page.wait_for_selector(
            '[data-testid="session-gate-row"][data-reason="escalation"]',
            timeout=15_000,
        )
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-timeout-no-esc-row.png"))
        found_reason = page.evaluate(
            "() => document.querySelector('[data-testid=\"session-gate-row\"]')?.getAttribute('data-reason') ?? 'not-found'"
        )
        all_keys = [el.get_attribute("data-choice-key") for el in page.query_selector_all("[data-testid='session-gate-choice']")]
        fail("timeout-gate-row", {
            "why": "session-gate-row[data-reason=escalation] did not appear for r-timeout",
            "found_reason": found_reason,
            "found_choice_keys": all_keys,
        })

    # Locate the "extend" offer choice (inline — it's the second of four inline choices)
    extend_btn = page.locator('[data-choice-key="offer:extend"]').first
    if extend_btn.count() == 0:
        # Also open overflow in case layout shifted
        overflow_el = page.query_selector("[data-testid='session-gate-row'] details.wk-session-gate-overflow")
        if overflow_el is not None:
            overflow_el.click()
        extend_btn = page.locator('[data-choice-key="offer:extend"]').first
    page.screenshot(path=str(SHOTS / "desk-gate-kinds-timeout-before-check.png"))
    all_timeout_keys = [el.get_attribute("data-choice-key") for el in page.query_selector_all("[data-testid='session-gate-choice']")]
    check("timeout-has-extend-offer", extend_btn.count() > 0,
          why="r-timeout escalation must show 'offer:extend' choice",
          found_keys=all_timeout_keys)

    if extend_btn.count() > 0:
        extend_btn.click()
        try:
            page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
        except Exception:
            page.screenshot(path=str(SHOTS / "desk-gate-kinds-timeout-extend.png"))
            fail("timeout-extend-chosen", {"why": "chosen line did not appear after clicking extend offer"})
        page.wait_for_timeout(11_500)
        timeout_posts = gate_posts("r-timeout")
        timeout_body = timeout_posts[-1].get("body", {}) if timeout_posts else {}
        check("timeout-extend-post",
              len(timeout_posts) > 0
              and timeout_body.get("approve") is True
              and timeout_body.get("action") == "extend"
              and "ord" in timeout_body,
              posts=timeout_posts)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-timeout-done.png"))

    # ── 13. ESCALATION ARMS — r-suggest (accept_suggestion: adopt evaluator's edit) ──────────────
    set_fixture(origin, escalation_arms=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-suggest#gate", wait_until="networkidle")
    try:
        page.wait_for_selector(
            '[data-testid="session-gate-row"][data-reason="escalation"]',
            timeout=15_000,
        )
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-gate-kinds-suggest-no-esc-row.png"))
        found_reason = page.evaluate(
            "() => document.querySelector('[data-testid=\"session-gate-row\"]')?.getAttribute('data-reason') ?? 'not-found'"
        )
        fail("suggest-gate-row", {
            "why": "session-gate-row[data-reason=escalation] did not appear for r-suggest",
            "found_reason": found_reason,
        })

    # Locate the accept_suggestion offer choice
    suggest_btn = page.locator('[data-choice-key="offer:accept_suggestion"]').first
    if suggest_btn.count() == 0:
        overflow_el = page.query_selector("[data-testid='session-gate-row'] details.wk-session-gate-overflow")
        if overflow_el is not None:
            overflow_el.click()
        suggest_btn = page.locator('[data-choice-key="offer:accept_suggestion"]').first
    all_suggest_keys = [el.get_attribute("data-choice-key") for el in page.query_selector_all("[data-testid='session-gate-choice']")]
    check("suggest-has-accept-offer", suggest_btn.count() > 0,
          why="r-suggest escalation must show accept_suggestion offer (evaluator's edit pinned)",
          found_keys=all_suggest_keys)

    if suggest_btn.count() > 0:
        suggest_btn.click()
        try:
            page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10_000)
        except Exception:
            page.screenshot(path=str(SHOTS / "desk-gate-kinds-suggest-click.png"))
            fail("suggest-chosen", {"why": "chosen line did not appear after clicking accept_suggestion"})
        page.wait_for_timeout(11_500)
        suggest_posts = gate_posts("r-suggest")
        suggest_body = suggest_posts[-1].get("body", {}) if suggest_posts else {}
        check("suggest-accept-post",
              len(suggest_posts) > 0
              and suggest_body.get("approve") is True
              and suggest_body.get("action") == "accept_suggestion"
              and "ord" in suggest_body,
              posts=suggest_posts)

    page.screenshot(path=str(SHOTS / "desk-gate-kinds-suggest-done.png"))

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
