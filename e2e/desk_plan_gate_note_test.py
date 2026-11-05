#!/usr/bin/env python3
"""
desk_plan_gate_note_test.py — studio#992 (crew#1139; wire core#1270 + crew#1350): the plan gate takes a note, as a
reply at the plan. Against the `chat_native` corpus (r-cn-plan waits at its plan approval), in both themes, at
1440x700 and 390x844:

  1. CAPABILITY ON (GET /health.capabilities.planGateNote): r-cn-plan's plan card docks above the reply box with its
     quick replies (Approve plan / Change something / Not now / Don't start); the reply box reads "Type a note to approve
     the plan with…".
     A typed reply's switch reads "Replies to this decision (Approve plan with your note)".
  2. SEND (last, light, 1440): Send queues the approval with its undo window; after it exactly ONE
     POST /runs/r-cn-plan/gate carries {approve: true, amend: <the note>}.
  3. CAPABILITY OFF (before the send): the same page says "Send asks a separate question" and the box asks a separate
     question.
  4. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-plan-gate-note-{1440,390}-{light,dark}.png, desk-plan-gate-note-off.png.
Env: FEEDBACK_PORT (default 4391).
"""

import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
SHOTS = REPO / "e2e" / "shots"
NOTE = "approve, and keep the public API unchanged"
SW = {"chat_native": True, "run_chat_id": True, "sessions": True, "ask_path": True, "team_plan": True}
WINDOW_S = 12

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


def fixture_post(body: dict) -> None:
    req = urllib.request.Request(f"{origin}/__fixture", method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()


def gate_posts(run_id: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as r:
        return [p for p in json.loads(r.read())["posts"] if p["runId"] == run_id]


STATE = """() => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
  const labels = [...document.querySelectorAll('[data-testid="decision-dock"] [data-testid="session-proposal-choices"] [role="radio"] .wk-ask-opt-label')].map((e) => e.textContent.trim());
  return {
    docked: !!document.querySelector('[data-testid="decision-dock"] [data-testid="session-proposal"]'),
    labels,
    consequence: t('[data-testid="decision-dock"] [data-testid="session-proposal-consequence"]'),
    dest: t('[data-testid="session-reply-dest"]'),
    placeholder: (document.querySelector('[data-testid="session-composer-input"]') || {}).placeholder || null,
    sw: t('[data-testid="session-reply-switch"]'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
}"""

errors: list[str] = []


def open_plan(page, theme: str, note_on: bool) -> dict:
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, plan_gate_note=note_on, **SW)
    page.goto(f"{origin}/s/run%3Ar-cn-plan", wait_until="networkidle")
    try:
        page.locator('[data-testid="decision-dock"] [data-testid="session-proposal"]').first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-plan-gate-note-missing-{theme}.png"))
        fail(f"open-{theme}", {"why": "the plan card never docked", "page": page.evaluate(STATE)})
    page.wait_for_timeout(800)
    return page.evaluate(STATE)


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    for (w, h) in ((1440, 700), (390, 844)):
        for theme in ("light", "dark"):
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(
                "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
                f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
            d = open_plan(page, theme, True)
            check(f"{w}-{theme}-quick-replies", d["labels"][:1] == ["Approve plan"] and "Don’t start" in d["labels"], labels=d["labels"])
            check(f"{w}-{theme}-box-says-note", (d["placeholder"] or "").startswith("Type a note to"), placeholder=d["placeholder"])
            page.locator('[data-testid="session-composer-input"]').fill(NOTE)
            page.wait_for_timeout(500)
            d = page.evaluate(STATE)
            check(f"{w}-{theme}-reply-is-note", d["dest"] == "Replies to this decision (Approve plan with your note)", dest=d["dest"])
            check(f"{w}-{theme}-no-hscroll", not d["hscroll"])
            page.screenshot(path=str(SHOTS / f"desk-plan-gate-note-{w}-{theme}.png"))
            ctx.close()

    # Capability off: the box asks a separate question, and Send answers nothing.
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    fixture_post({"reset_gate_posts": True})
    d = open_plan(page, "light", False)
    check("off-no-note-hint", d["placeholder"] == "Ask a separate question about this job…", placeholder=d["placeholder"])
    page.locator('[data-testid="session-composer-input"]').fill(NOTE)
    page.wait_for_timeout(500)
    d = page.evaluate(STATE)
    check("off-asks-separately", d["sw"] == "Send asks a separate question", sw=d["sw"])
    page.screenshot(path=str(SHOTS / "desk-plan-gate-note-off.png"))
    ctx.close()

    # Send, last (the fixture may move r-cn-plan past its gate once answered): one POST, the note as `amend`.
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    open_plan(page, "light", True)
    fixture_post({"reset_gate_posts": True})
    page.locator('[data-testid="session-composer-input"]').fill(NOTE)
    page.wait_for_timeout(500)
    page.locator('[data-testid="session-composer-input"]').press("Enter")
    deadline = time.time() + WINDOW_S + 8
    while time.time() < deadline and not gate_posts("r-cn-plan"):
        page.wait_for_timeout(250)
    sent = gate_posts("r-cn-plan")
    body = sent[0].get("body") if sent else None
    check("send-one-post-with-note", len(sent) == 1 and isinstance(body, dict) and body.get("approve") is True
          and body.get("amend") == NOTE and "plan" not in body, posts=sent)
    ctx.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
