#!/usr/bin/env python3
"""
desk_plan_order_test.py — S10 (DES-STUDIO-REBUILD-001 §5.7, §11 S10; §6 Q-R5 order only): the ordered
plan editor in the run's artifact slot, at 1440x700 under STUDIO_SKIN=desk.

Against the in-process fixture (team_plan + plan_gate: r-plan-gate paused at its plan_approval gate
before unit 2 of pa-scope → understand → design → build → review → deliver; r-team executing a preset):

  1. THE PLAN IS AN ARTIFACT: r-plan-gate's block has `artifact[data-kind=plan]`; inline it lists the
     six steps in order; Scope reads "first" and Deliver "last" (fixed, no arrows); the four authored
     steps have arrows. A click opens it beside the thread — the same element (data-size pane).
  2. MOVE: Review ↑ → the list reads Research, Plan, Review, Build; the gate card says "The order
     changes: Research → Plan → Review → Build." and its primary reads "Approve with these changes";
     0 gate POSTs (nothing is sent by a move).
  3. REFUSED, SHOWN: Research ↑ (it is first among the steps you can order) → a note with the reason,
     the list unchanged.
  4. ADD HERE: + Test → the card's line says "+ Test" and the order; Test is movable: Test ↑ puts it
     before Build.
  5. DROP: "Drop the changes" on the card → the list is the held order again, no draft line.
  6. SEND: Review ↑ again, then "Approve with these changes" → after the 10 s window exactly ONE
     POST /runs/r-plan-gate/gate with approve: true and plan.steps = understand, design, review, build.
  7. MID-RUN: r-team's plan artifact says the order is set — every row fixed, no arrows; + Test
     queues "Adding Test · Undo" (S7's window); Undo → 0 plan POSTs.
  8. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-plan-order*.png. Env: FEEDBACK_PORT (default 4356).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4356"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
WINDOW_MS = 11_500

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


def tap(path: str) -> list:
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as r:
        return json.loads(r.read())["posts"]


def gate_posts() -> list:
    return [g for g in tap("/__fixture/gate-posts") if g["runId"] == "r-plan-gate"]


def plan_edits() -> list:
    return [p for p in tap("/__fixture/plan-posts") if p.get("route") == "edit"]


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
    set_fixture(origin, team_plan=True, plan_gate=True, reset_plan=True, reset_gate_posts=True)

    plan = page.locator('[data-testid="artifact"][data-kind="plan"]')
    rows = plan.get_by_test_id("plan-step")

    def labels() -> list:
        return rows.evaluate_all("els => els.map(e => e.querySelector('.wk-plan-label').textContent)")

    def fixed() -> list:
        return rows.evaluate_all("els => els.map(e => e.dataset.fixed)")

    def row(label: str):
        return rows.filter(has=page.locator(".wk-plan-label", has_text=label)).first

    def open_session(rid: str) -> None:
        page.goto(f"{origin}/s/run:{rid}", wait_until="networkidle")
        page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
        plan.wait_for(state="visible", timeout=15000)
        rows.first.wait_for(state="visible", timeout=8000)

    # ── 1. the plan is an artifact; inline it lists the steps; a click opens it as the same element ──
    open_session("r-plan-gate")
    page.get_by_test_id("session-proposal").wait_for(state="visible", timeout=15000)
    inline_labels = labels()
    inline_fixed = fixed()
    arrows_inline = plan.get_by_test_id("plan-step-up").count()
    node_before = plan.evaluate("el => { el.__planNode = true; return true }")
    page.screenshot(path=str(SHOTS / "desk-plan-order-inline.png"))
    plan.get_by_test_id("artifact-open").click()
    page.locator('[data-testid="artifact"][data-kind="plan"][data-size="pane"]').wait_for(state="visible", timeout=8000)
    same_node = plan.evaluate("el => el.__planNode === true")
    page.screenshot(path=str(SHOTS / "desk-plan-order-pane.png"))
    check("artifact", inline_labels == ["Scope", "Research", "Plan", "Build", "Review", "Deliver"]
          and inline_fixed == ["scope", "no", "no", "no", "no", "deliver"] and arrows_inline == 4
          and node_before and same_node,
          labels=inline_labels, fixed=inline_fixed, arrows=arrows_inline, same_node=same_node)

    # ── 2. a move is a draft on the card; nothing is sent ─────────────────────────────
    before = len(gate_posts())
    row("Review").get_by_test_id("plan-step-up").click()
    page.get_by_test_id("session-proposal-draft").wait_for(state="visible", timeout=8000)
    moved = labels()
    draft = page.get_by_test_id("session-proposal-draft").inner_text()
    go = page.get_by_test_id("session-proposal-go").inner_text()
    line = plan.get_by_test_id("plan-order-line").inner_text()
    page.wait_for_timeout(1200)
    quiet = len(gate_posts()) - before
    page.screenshot(path=str(SHOTS / "desk-plan-order-moved.png"))
    check("move", moved == ["Scope", "Research", "Plan", "Review", "Build", "Deliver"]
          and draft.startswith("The order changes: Research → Plan → Review → Build.")
          and go == "Approve with these changes" and quiet == 0
          and line.startswith("The order changes: Research → Plan → Review → Build."),
          labels=moved, draft=draft, go=go, posts_after_move=quiet, line=line)

    # ── 3. a refused move is shown, with the reason; the list stands ─────────────────
    row("Research").get_by_test_id("plan-step-up").click()
    plan.get_by_test_id("plan-order-note").wait_for(state="visible", timeout=8000)
    note = plan.get_by_test_id("plan-order-note").inner_text()
    check("refused", "already first" in note and labels() == moved, note=note, labels=labels())

    # ── 4. a step added here joins the draft and can be moved ────────────────────────
    plan.locator('[data-testid="plan-add-item"][data-catalog="test"]').click()
    row("Test").wait_for(state="visible", timeout=8000)
    added_tag = row("Test").get_by_test_id("plan-step-added").count()
    draft2 = page.get_by_test_id("session-proposal-draft").inner_text()
    row("Test").get_by_test_id("plan-step-up").click()
    page.wait_for_timeout(200)
    with_test = labels()
    page.screenshot(path=str(SHOTS / "desk-plan-order-added.png"))
    check("add", added_tag == 1 and draft2.startswith("The steps change: + Test. The order changes: Research → Plan → Review → Build → Test.")
          and with_test == ["Scope", "Research", "Plan", "Review", "Test", "Build", "Deliver"],
          tag=added_tag, draft=draft2, labels=with_test)

    # ── 5. drop the changes: the held order, no draft ────────────────────────────────
    page.get_by_test_id("session-proposal-drop-draft").click()
    page.get_by_test_id("session-proposal-draft").wait_for(state="hidden", timeout=8000)
    check("drop", labels() == inline_labels and page.get_by_test_id("session-proposal-draft").count() == 0, labels=labels())

    # ── 6. approve with the order: ONE gate POST carrying the plan in that order ─────
    row("Review").get_by_test_id("plan-step-up").click()
    page.get_by_test_id("session-proposal-draft").wait_for(state="visible", timeout=8000)
    before = len(gate_posts())
    page.get_by_test_id("session-proposal-go").click()
    page.wait_for_timeout(WINDOW_MS)
    posts = gate_posts()[before:]
    steps = [s.get("catalog") for s in (posts[-1]["body"].get("plan", {}).get("steps", []) if posts else [])]
    page.screenshot(path=str(SHOTS / "desk-plan-order-sent.png"))
    check("send", len(posts) == 1 and posts[0]["body"].get("approve") is True
          and steps == ["understand", "design", "review", "build"],
          posts=len(posts), steps=steps)

    # ── 7. mid-run: the order is set; a step added here is S7's undo window ──────────
    open_session("r-team")
    mid_fixed = fixed()
    mid_arrows = plan.get_by_test_id("plan-step-up").count()
    mid_line = plan.get_by_test_id("plan-order-line").inner_text()
    plan.get_by_test_id("artifact-open").click()
    page.locator('[data-testid="artifact"][data-kind="plan"][data-size="pane"]').wait_for(state="visible", timeout=8000)
    plan.locator('[data-testid="plan-add-item"][data-catalog="test"]').click()
    page.get_by_test_id("session-step-queued").wait_for(state="visible", timeout=8000)
    queued = page.get_by_test_id("session-step-queued").inner_text()
    page.screenshot(path=str(SHOTS / "desk-plan-order-midrun.png"))
    page.get_by_test_id("session-step-undo").click()
    page.wait_for_timeout(WINDOW_MS)
    check("mid-run", all(f != "no" for f in mid_fixed) and mid_arrows == 0 and "order is set" in mid_line
          and queued.startswith("Adding Test") and plan_edits() == [],
          fixed=mid_fixed, arrows=mid_arrows, line=mid_line, queued=queued, posts=len(plan_edits()))

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors, overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
