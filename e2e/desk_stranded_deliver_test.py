#!/usr/bin/env python3
"""
desk_stranded_deliver_test.py — S16a-1a (studio#587, #583): a finished run's delivery is answered in
its own session thread, on the Desk at 1440x700 against the in-process fixture.

The fixture carries no stranded run and no `POST /runs/:id/deliver` handler, so two finished runs are
served by Playwright routes over the fixture's own answers (the overlay pattern of
desk_everything_archive_test.py): `r-strand` (completed, `delivery: stranded`, its deliver phase
rejected, a worktree on disk) and `r-handed` (completed, `delivery: delivered`, a PR url). The
deliver POST is answered by the route: refused (409, the daemon's words) the first time, then 200
with a PR url.

  1. THE DESK ROW: the needs-you queue carries r-strand with an age off the daemon's clock (never
     "age unknown") and the one verb "Deliver ›" — an open-in-place link to /s/run%3Ar-strand#deliver.
  2. IT LANDS ON THE DOOR: the verb opens the run's thread; the stranded card is there and its
     "Deliver — open a PR" button has focus. Nothing was POSTed on arrival.
  3. A REFUSAL KEEPS THE DAEMON'S WORDS: the press sends exactly one POST; the 409's words show
     verbatim under "Delivery failed — the run is still stranded."; the button stays.
  4. DELIVERED: a second press sends one more POST (two in all); the card becomes the receipt with
     the pull request link the POST answered.
  5. A FRESH LOAD OF A DELIVERED RUN: /s/run%3Ar-handed shows "Finished · delivered" with its PR link,
     with no gate and no receipt in this browser.
  6. 0 page errors.

Captures: e2e/shots/desk-stranded-deliver-*.png. Env: FEEDBACK_PORT (default 4473). Prints a JSON
report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4473"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
STRAND = "r-strand"
HANDED = "r-handed"
PR_POSTED = "https://github.com/example/studio-api/pull/1201"
PR_HANDED = "https://github.com/example/studio-api/pull/1200"
REFUSAL = "rebase onto origin/main hit a conflict in src/api/routes.ts — nothing was pushed"

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
state = {"posts": 0}


def unit(rid: str, ord_: int, name: str, status: str) -> dict:
    return {
        "id": f"{rid}:{name}", "session_id": rid, "ord": ord_, "description": name, "stage": "build",
        "assigned_cli": "claude" if name != "deliver" else None, "assigned_invocation": None,
        "council_task_ref": None, "routing": None, "denial_reason": None, "phase_ref": None,
        "conformance_ref": None, "phase_status": None, "collection_scope": None, "status": status,
    }


def finished(rid: str, problem: str, **extra) -> dict:
    session = {
        "id": rid, "workflow_id": "feature", "problem": problem, "entity_mode": "shared",
        "collection_scope": None, "clis": ["claude"], "status": "completed", "human_confirm": "none",
        "unit_ix": 2, "attempt": 0, "workdir": f"/w/trees/{rid}", "repo_ref": None, "extra_write_roots": [],
        "archived_at": None, "archive_note": None, "project_id": None,
        "created_at": 1_759_600_000, "ended_at": 1_759_600_600, **extra,
    }
    deliver_status = "rejected" if extra.get("delivery") == "stranded" else "done"
    return {"session": session, "units": [unit(rid, 0, "build", "done"), unit(rid, 1, "deliver", deliver_status)]}


RUNS = {
    STRAND: finished(STRAND, "Fix the double charge on retry", delivery="stranded"),
    HANDED: finished(HANDED, "Add the refund receipt", delivery="delivered", deliverUrl=PR_HANDED),
}


def route_runs(route):
    if route.request.method != "GET":
        route.fallback()
        return
    res = route.fetch()
    body = res.json()
    body["runs"] = list(body.get("runs", [])) + list(RUNS.values())
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def route_one(rid: str):
    def handler(route):
        if route.request.method != "GET":
            route.fallback()
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"run": RUNS[rid]}))
    return handler


def route_events(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"events": []}))


def route_deliver(route):
    state["posts"] += 1
    if state["posts"] == 1:
        route.fulfill(status=409, content_type="application/json", body=json.dumps({"error": REFUSAL}))
    else:
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"prUrl": PR_POSTED}))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True)
    page.route("**/api/v1/runs", route_runs)
    page.route("**/api/v1/runs?*", route_runs)
    for rid in RUNS:
        page.route(f"**/api/v1/runs/{rid}", route_one(rid))
        page.route(f"**/api/v1/runs/{rid}/events*", route_events)
    page.route(f"**/api/v1/runs/{STRAND}/deliver", route_deliver)

    # ── 1. the Desk row: an age off the daemon's clock, "Deliver ›" to the thread ───────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    row = page.locator(f'[data-testid="need-row"][data-key="stranded:{STRAND}"]')
    row.wait_for(state="visible", timeout=15000)
    act = row.get_by_test_id("need-act")
    age = row.get_by_test_id("need-age").inner_text().strip()
    href = act.get_attribute("href")
    verb = act.inner_text().strip()
    page.screenshot(path=str(SHOTS / "desk-stranded-deliver-row.png"))
    check("desk-row", verb == "Deliver ›" and href == f"/s/run%3A{STRAND}#deliver"
          and "unknown" not in age.lower() and age != "",
          verb=verb, href=href, age=age)

    # ── 2. it lands on the thread with the door focused; nothing POSTed on arrival ─────────────
    act.click()
    card = page.get_by_test_id("session-stranded")
    card.wait_for(state="visible", timeout=10000)
    button = page.get_by_test_id("session-stranded-deliver")
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.dataset.testid === 'session-stranded-deliver'",
        timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-stranded-deliver-door.png"))
    check("lands-on-door", page.url.endswith(f"/s/run%3A{STRAND}#deliver") and state["posts"] == 0
          and button.inner_text().strip() == "Deliver — open a PR",
          url=page.url, posts=state["posts"], card=card.inner_text()[:200])

    # ── 3. a refusal: one POST, the daemon's words verbatim, the door stays ────────────────────
    button.click()
    err = page.get_by_test_id("session-stranded-error")
    err.wait_for(state="visible", timeout=10000)
    text = err.inner_text()
    page.screenshot(path=str(SHOTS / "desk-stranded-deliver-refused.png"))
    check("refusal-verbatim", state["posts"] == 1 and "Delivery failed — the run is still stranded." in text
          and REFUSAL in text and button.is_enabled(),
          posts=state["posts"], text=text)

    # ── 4. delivered: one more POST, the receipt with the PR the POST answered ─────────────────
    button.click()
    page.locator('[data-testid="session-stranded"][data-state="delivered"]').wait_for(state="visible", timeout=10000)
    pr = page.get_by_test_id("session-proposal-pr").get_attribute("href")
    page.screenshot(path=str(SHOTS / "desk-stranded-deliver-delivered.png"))
    check("delivered-receipt", state["posts"] == 2 and pr == PR_POSTED, posts=state["posts"], pr=pr)

    # ── 5. a delivered run opened fresh shows its receipt and link ──────────────────────────────
    page.goto(f"{origin}/s/run%3A{HANDED}", wait_until="networkidle")
    prop = page.locator(f'[data-testid="session-proposal"][data-run-id="{HANDED}"]')
    prop.wait_for(state="visible", timeout=10000)
    out = prop.get_by_test_id("session-proposal-outcome").inner_text().strip()
    link = prop.get_by_test_id("session-proposal-pr").get_attribute("href")
    page.screenshot(path=str(SHOTS / "desk-stranded-deliver-fresh.png"))
    check("fresh-receipt", prop.get_attribute("data-state") == "done" and out == "Finished · delivered"
          and link == PR_HANDED, state=prop.get_attribute("data-state"), out=out, link=link)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
