#!/usr/bin/env python3
"""
desk_demo_plain_test.py — DEMO MODE IN PLAIN WORDS at 1440x700 on the Desk (studio#520,
#521 — two defects the W12 reel found on the released 0.6.1 Desk; the frames had to be blurred).

  1. #520 — Project › Demo mode › "This project's demos": a row read the run's raw `problem`, which on
     crew 0.8.1 carries the brief's absolute home path ("…follow the demo brief at
     /Users/<user>/.wicked/demos/<id>/BRIEF.md. Demo root: …") with "Show technical details" off. Now
     a row reads by what the demo is of ("Demo of <url>") and its state; no home path on screen.
  2. #521 — the demo's page said "The team is scoping the demo before planning starts." while the run
     was `awaiting_human` on an ESCALATION gate (a denied tool call) — only the team plan gate had a
     card. Now any gate that is not one of the demo's own three gets a card naming the gate's prompt
     head with a way to the run, and the stage line says the run is waiting on a decision.

Against the in-process fixture (its demo runs), plus Playwright routes: `GET /runs` gains one demo run
whose problem carries a home path; `GET /runs/:id/demo` answers stage `preparing` and
`GET /runs/:id/gate` the escalation gate for that run.

Captures: e2e/shots/desk-demo-plain-*.png. Env: FEEDBACK_PORT (default 4474). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4474"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PROJECT = "upload-endpoint"
RID = "r-demo-esc"
URL = "http://127.0.0.1:4582/"
PROBLEM = (f"Make a demo of {URL} with the wicked-garden-demo skill for new team leads. Follow the demo brief at "
           f"/Users/reel-operator/.wicked/demos/{RID}/BRIEF.md. Demo root: /Users/reel-operator/.wicked/demos/{RID}")
GATE_PROMPT = ("Unit 3 was DENIED by input governance — a tool call was refused (`Bash`): input governance denied a "
               "tool-call in unit-3 (claim witness-deny:unit-3). Approve to retry, or reject to cancel the run.")

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok and os.environ.get("DESK_ALL") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def demo_run() -> dict:
    return {"session": {
        "id": RID, "workflow_id": f"{RID}:plan-2", "problem": PROBLEM, "entity_mode": "shared", "collection_scope": None,
        "clis": ["claude"], "status": "awaiting_human", "human_confirm": "all", "unit_ix": 2, "attempt": 0, "workdir": None,
        "repo_ref": None, "extra_write_roots": [], "archived_at": None, "archive_note": None, "project_id": PROJECT,
        "team_plan": {"rev": 2, "accepted_rev": 2, "preset": "demo"}, "created_at": 1_759_600_000,
    }, "units": [{
        "id": f"{RID}:u{i}", "session_id": RID, "ord": i, "description": d, "stage": "produce", "assigned_cli": "claude",
        "assigned_invocation": None, "council_task_ref": None, "routing": None,
        "denial_reason": ("input governance denied a tool-call in unit-3" if i == 3 else None), "phase_ref": None,
        "conformance_ref": None, "phase_status": None, "collection_scope": None, "status": ("failed" if i == 3 else "done"),
    } for i, d in enumerate(["demo: pa-scope", "demo: plan", "demo: record", "demo: review"])]}


def demo_view() -> dict:
    return {"runId": RID, "url": URL, "audience": "New team leads", "stage": "preparing", "script": None, "chapters": [],
            "markers": [], "sheets": [], "video": None, "recording": {"readOnly": None},
            "review": {"verdict": None, "rejected": False, "findings": [], "text": None},
            "seats": {"recorder": None, "reviewer": None}, "syntheticLabelled": False}


def route_runs(route):
    if route.request.method != "GET":
        route.fallback()
        return
    res = route.fetch()
    body = res.json()
    body["runs"] = list(body.get("runs", [])) + [demo_run()]
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    # The run page consumes the "#gate" hash on arrival (scrolls the gate into view, focuses it, then
    # strips it with replaceState) — so the destination the button pushed is recorded here.
    page.add_init_script("window.__pushed = []; const _ps = history.pushState.bind(history); "
                         "history.pushState = (st, t, u) => { window.__pushed.push(String(u)); return _ps(st, t, u); };")
    set_fixture(origin, wave1=True, demo_runs=True, reset_demo=True, appearance={**DEFAULT_APPEARANCE})
    page.route("**/api/v1/runs", route_runs)
    page.route("**/api/v1/runs?*", route_runs)
    page.route(f"**/api/v1/runs/{RID}/demo", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(demo_view())))
    page.route(f"**/api/v1/runs/{RID}/gate", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(
        {"runId": RID, "ord": 3, "prompt": GATE_PROMPT, "lifecycle": "pending", "receivedAt": "2026-10-05T12:00:00.000Z"})))

    # ── 1. the demos list, in plain words (#520) ─────────────────────────────────────────────
    page.goto(f"{origin}/p/{PROJECT}/video", wait_until="networkidle")
    page.get_by_test_id("demo-start").wait_for(state="visible", timeout=15000)
    row = page.locator(f'[data-testid="demo-list-row"][data-run="{RID}"]')
    row.wait_for(state="visible", timeout=10000)
    text = row.inner_text().replace("\n", " ")
    page_text = page.locator("body").inner_text()
    page.screenshot(path=str(SHOTS / "desk-demo-plain-list.png"))
    check("list-row-plain", f"Demo of {URL}" in text and "/Users/" not in text and "BRIEF.md" not in text
          and "/Users/" not in page_text, row=text[:200], home_path_on_page="/Users/" in page_text)

    # ── 2. the demo page while an escalation gate is open (#521) ────────────────────────────
    row.click()
    page.wait_for_url(f"**/p/{PROJECT}/video/{RID}", timeout=10000)
    run = page.get_by_test_id("demo-run")
    run.wait_for(state="visible", timeout=10000)
    card = page.get_by_test_id("demo-waiting-gate")
    try:
        card.wait_for(state="visible", timeout=6000)
        card_text = card.inner_text().replace("\n", " ")
    except Exception:  # noqa: BLE001
        card_text = ""
    stage_line = page.get_by_test_id("demo-stage-line").inner_text()
    waiting = run.get_attribute("data-waiting")
    page.screenshot(path=str(SHOTS / "desk-demo-plain-gate.png"))
    check("gate-named-on-demo-page", "Unit 3 was DENIED by input governance" in card_text and waiting == "gate"
          and "scoping" not in stage_line and "waiting" in stage_line.lower(),
          card=card_text[:200], stage_line=stage_line, waiting=waiting, stage=run.get_attribute("data-stage"))
    # The way to the run: the card's link opens the run's session thread WITH the gate in view
    # (S15e: gateOpenPath = /s/run%3A<id> + "#gate"; the thread consumes the hash on arrival by
    # focusing the answerable row), not just the page.
    try:
        page.get_by_test_id("demo-open-run-gate").click(timeout=3000)
        page.wait_for_url(f"**/s/run%3A{RID}*", timeout=8000)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(500)
    opened = page.url.replace(origin, "")
    pushed = page.evaluate("() => window.__pushed.slice(-3)")
    focused_gate = page.evaluate("() => !!document.activeElement?.closest?.('[data-testid=\"steering-gate\"], [data-testid=\"session-gate-row\"]')")
    page.screenshot(path=str(SHOTS / "desk-demo-plain-run.png"))
    check("open-the-run", opened.startswith(f"/s/run%3A{RID}") and any(u.endswith(f"/s/run%3A{RID}#gate") for u in pushed),
          url=opened, pushed=pushed, gate_focused_on_arrival=focused_gate)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
