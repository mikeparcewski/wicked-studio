#!/usr/bin/env python3
"""
desk_run_team_test.py — who leads a run, who watches it and why, and the Lead agent choice
(DES-TEAMING-002 §0, §8.1, §8.5, §8.8). Against the `chat_native` corpus (e2e/chat_native_corpus.py) at 1440x700:

  1. THE TEAM ON THE RUN PAGE: the run panel's Agents and spend section says who leads ("claude (you chose
     it)"), how many watch and why ("score 30 → 1 monitor"), each member — the one that could not open is
     disclosed with its reason, never silent — and the step another helper did (understand, by pi).
  2. THE LEAD AGENT: New job's options step offers "Lead agent" (Random by default + each helper on), the
     review step says who leads, and Launch sends `primary` only for a chosen seat (Random sends none).
  3. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-run-team-{panel,wizard}-1440.png. Env: FEEDBACK_PORT (default 4498).
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4498"))
SHOTS = REPO / "e2e" / "shots"
SW = {"chat_native": True, "run_chat_id": True, "sessions": True, "ask_path": True, "team_plan": True}

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

TEAM = """() => {
  const q = (t) => document.querySelector(`[data-testid="host-panel"] [data-testid="${t}"]`);
  const text = (t) => q(t)?.innerText ?? null;
  return {
    lead: text('run-tab-team-lead'),
    watch: text('run-tab-team-watch'),
    members: [...document.querySelectorAll('[data-testid="host-panel"] [data-testid="run-tab-team-member"]')]
      .map((m) => ({ seat: m.dataset.seat, status: m.dataset.status, text: m.innerText })),
    work: text('run-tab-team-work'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # ── 1. the team on the run page ────────────────────────────────────────────────────────────────
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": "light"}, **SW)
    page.goto(f"{origin}/s/run%3Ar-cn-live", wait_until="networkidle")
    try:
        page.locator('[data-testid="session-working"]').first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        fail("open-run", "the running run never showed")
    toggle = page.get_by_test_id("session-details-toggle")
    if toggle.get_attribute("aria-expanded") != "true":
        toggle.click()
    agents = page.locator('[data-testid="host-panel"] [data-testid="run-panel-toggle"][data-section="agents"]')
    agents.wait_for(state="visible", timeout=10000)
    if agents.get_attribute("aria-expanded") != "true":
        agents.click()
    try:
        page.locator('[data-testid="host-panel"] [data-testid="run-tab-team"]').wait_for(state="visible", timeout=10000)
    except Exception:  # noqa: BLE001
        fail("team-shown", page.evaluate(TEAM))
    page.locator('[data-testid="host-panel"] [data-testid="run-tab-team"]').scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    d = page.evaluate(TEAM)
    page.screenshot(path=str(SHOTS / "desk-run-team-panel-1440.png"))
    check("team-lead", d["lead"] is not None and d["lead"].lower().startswith("leading: claude") and "you chose it" in d["lead"], team=d)
    check("team-watch", d["watch"] == "Watching: 1 of 1 monitor (score 30 → 1 monitor)", team=d)
    failed = [m for m in d["members"] if m["status"] == "failed"]
    check("team-member-failed-disclosed", len(failed) == 1 and failed[0]["seat"] == "codex"
          and "could not watch" in failed[0]["text"] and "seat image is not built" in failed[0]["text"], team=d)
    check("team-member-watching", any(m["seat"] == "pi" and m["status"] == "watching" for m in d["members"]), team=d)
    check("team-work", d["work"] is not None and "understand" in d["work"], team=d)
    check("team-no-hscroll", not d["hscroll"], team=d)

    # ── 2. the Lead agent in New job ───────────────────────────────────────────────────────────────
    posted: list[dict] = []

    def on_request(req) -> None:
        if req.method == "POST" and req.url.split("?")[0].endswith("/api/v1/runs"):
            try:
                posted.append(json.loads(req.post_data or "{}"))
            except ValueError:
                posted.append({})

    page.on("request", on_request)

    def to_options() -> None:
        set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": "light"}, **SW, repo=True)
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk-rail-new-job").click()
        page.get_by_test_id("launch-wizard").wait_for(state="visible", timeout=10000)
        if page.get_by_test_id("launch-wizard-step").get_attribute("data-step") == "workflow":
            card = page.locator('[data-testid="launch-wizard-cards"] button[data-testid^="launch-wizard-workflow-"]'
                                ':not([data-testid$="demo-video"]):not([data-testid$="draft-epics"])').first
            card.click()
        page.get_by_test_id("launch-wizard-intent").fill("add a CSV export")
        for _ in range(6):
            step = page.get_by_test_id("launch-wizard-step").get_attribute("data-step")
            if step == "options":
                return
            if step == "where" and page.get_by_test_id("launch-wizard-repo").input_value() == "":
                page.get_by_test_id("launch-wizard-repo").select_option(index=1)
            page.get_by_test_id("launch-wizard-next").click()
            page.wait_for_timeout(200)
        fail("wizard-options", page.get_by_test_id("launch-wizard-step").get_attribute("data-step"))

    to_options()
    lead = page.get_by_test_id("launch-wizard-lead")
    try:
        lead.wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001
        fail("wizard-lead-offered", "no Lead agent picker on the options step")
    labels = page.locator('[data-testid="launch-wizard-lead"] option').all_inner_texts()
    seats = page.locator('[data-testid="launch-wizard-seat"][aria-pressed="true"]').all_inner_texts()
    # Every helper that is on and can take work; codex is signed out in the fixture's roster, so it cannot lead.
    check("wizard-lead-options", lead.input_value() == "" and labels[0] == "Random" and len(labels) > 2
          and all(x in seats for x in labels[1:]) and "codex" not in labels, labels=labels, seats=seats)
    value = page.locator('[data-testid="launch-wizard-lead"] option').nth(2).get_attribute("value")
    lead.select_option(value)
    page.screenshot(path=str(SHOTS / "desk-run-team-wizard-1440.png"))
    page.get_by_test_id("launch-wizard-next").click()
    review = page.get_by_test_id("launch-wizard-review-lead").inner_text()
    check("wizard-review-lead", labels[2] in review, review=review)
    page.get_by_test_id("launch-wizard-launch").click()
    page.wait_for_timeout(1500)
    check("wizard-sends-primary", len(posted) == 1 and posted[0].get("primary") == value, posted=posted, value=value)

    # Random sends none.
    to_options()
    page.get_by_test_id("launch-wizard-lead").select_option("")
    page.get_by_test_id("launch-wizard-next").click()
    page.get_by_test_id("launch-wizard-launch").click()
    page.wait_for_timeout(1500)
    check("wizard-random-sends-none", len(posted) == 2 and "primary" not in posted[1], posted=posted)

    check("no-page-errors", errors == [], errors=errors)
    ctx.close()
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
