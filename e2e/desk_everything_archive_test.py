#!/usr/bin/env python3
"""
desk_everything_archive_test.py — SEE EVERYTHING › Sessions: onboarding runs are named, and Unarchive
re-reads the list (studio#510, #511) at 1440x700 on the Desk.

Against the in-process fixture (wave-1 + wave-2b corpus), plus three onboarding runs the fixture does
not carry, served by Playwright routes over the fixture's own answers: two finished ("Onboard
repository: notes-a" / "notes-b") and one stopped-and-archived ("Onboard repository: offsite-plan").
The daemon excludes archived runs from `GET /runs` and lists them on `GET /runs?include=archived`
(crew#265); `POST /runs/:id/archive {archived:false}` flips the one archived run.

  1. #510 — the Done filter lists the two finished onboarding runs as "Set up notes-a" / "Set up
     notes-b" (the Desk rail's word since #423), never the shared "Onboard repository" clause.
  2. #510 — the Archived lens names its one row "Set up offsite-plan".
  3. #511 — Unarchive on that row: the runs list is re-read (a `GET /runs` leaves within 3 s), and the
     Stopped lens — picked in place, no reload, no other navigation — lists the run.

Captures: e2e/shots/desk-everything-archive-*.png. Env: FEEDBACK_PORT (default 4472). Prints a JSON
report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4472"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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

ARCHIVED_ID = "r-onb-c"
state = {"archived": True, "runs_gets": 0, "archive_posts": []}


def onboarding(rid: str, status: str, repo: str, archived_at: int | None) -> dict:
    return {"session": {
        "id": rid, "workflow_id": "wf-onboard", "problem": f"Onboard repository: {repo}", "entity_mode": "shared",
        "collection_scope": None, "clis": ["claude"], "status": status, "human_confirm": "none",
        "unit_ix": 1, "attempt": 0, "workdir": None, "repo_ref": None, "extra_write_roots": [],
        "archived_at": archived_at, "archive_note": None, "project_id": "alpha",
        "created_at": 1_759_600_000, "ended_at": 1_759_600_600,
    }, "units": [{
        "id": f"{rid}:u0", "session_id": rid, "ord": 0, "description": f"index {repo}", "stage": "build",
        "assigned_cli": "claude", "assigned_invocation": None, "council_task_ref": None, "routing": None,
        "denial_reason": None, "phase_ref": None, "conformance_ref": None, "phase_status": None,
        "collection_scope": None, "status": "done",
    }]}


def injected(include_archived: bool) -> list:
    rows = [onboarding("r-onb-a", "completed", "notes-a", None), onboarding("r-onb-b", "completed", "notes-b", None)]
    archived_at = 1_759_601_000 if state["archived"] else None
    if include_archived or not state["archived"]:
        rows.append(onboarding(ARCHIVED_ID, "cancelled", "offsite-plan", archived_at))
    return rows


def route_runs(route):
    req = route.request
    if req.method != "GET":
        route.fallback()
        return
    state["runs_gets"] += 1
    include = "include=archived" in req.url
    res = route.fetch()
    body = res.json()
    body["runs"] = list(body.get("runs", [])) + injected(include)
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def route_archive(route):
    body = json.loads(route.request.post_data or "{}")
    state["archive_posts"].append(body)
    state["archived"] = bool(body.get("archived", True))
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"runId": ARCHIVED_ID, "archived": state["archived"]}))


def route_run_detail(route):
    if route.request.method != "GET":
        route.fallback()
        return
    body = onboarding(ARCHIVED_ID, "cancelled", "offsite-plan", 1_759_601_000 if state["archived"] else None)
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"run": body}))


TITLES = """(sel) => [...document.querySelectorAll(sel)].map((e) => ({ id: e.dataset.runId || e.dataset.runIds || '', text: e.innerText.replace(/\\s+/g, ' ').trim() }))"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True, wave2b=True)
    page.route("**/api/v1/runs", route_runs)
    page.route("**/api/v1/runs?*", route_runs)
    page.route(f"**/api/v1/runs/{ARCHIVED_ID}/archive", route_archive)
    page.route(f"**/api/v1/runs/{ARCHIVED_ID}", route_run_detail)

    # ── 1. the Done filter names the onboarding runs ─────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=sessions&filter=completed", wait_until="networkidle")
    page.get_by_test_id("everything-sessions").wait_for(state="visible", timeout=15000)
    page.locator('[data-testid="everything-session"][data-run-id="r-onb-a"]').wait_for(state="visible", timeout=10000)
    rows = page.evaluate(TITLES, '[data-testid="everything-session"]')
    mine = [r for r in rows if r["id"] in ("r-onb-a", "r-onb-b")]
    page.screenshot(path=str(SHOTS / "desk-everything-archive-done.png"))
    check("done-rows-named",
          len(mine) == 2 and all("Set up notes-" in r["text"] for r in mine)
          and not any("Onboard repository" in r["text"] for r in rows),
          rows=mine, any_onboard_clause=[r for r in rows if "Onboard repository" in r["text"]][:3])

    # ── 2. the Archived lens names its row ───────────────────────────────────────────────────
    page.get_by_test_id("everything-filter").filter(has_text="Archived").click()
    row = page.locator(f'[data-testid="everything-archived-run"][data-run-id="{ARCHIVED_ID}"]')
    row.wait_for(state="visible", timeout=10000)
    title = row.locator(".wk-desk-session-title").inner_text().strip()
    page.screenshot(path=str(SHOTS / "desk-everything-archive-lens.png"))
    check("archived-row-named", title == "Set up offsite-plan", title=title)

    # ── 3. clicking the archived row opens its session and shows · Archived (studio#675) ─────
    # The session resolves via GET /runs/:id; the pending line must never appear.
    row.locator("a").first.click()
    try:
        page.get_by_test_id("session-run-archived").wait_for(state="visible", timeout=5000)
        session_archived_ok = True
    except Exception:  # noqa: BLE001
        session_archived_ok = False
    session_pending_shown = page.query_selector('[data-testid="session-run-pending"]') is not None
    page.screenshot(path=str(SHOTS / "desk-everything-archive-session.png"))
    check("archived-session-resolves",
          session_archived_ok and not session_pending_shown,
          session_archived=session_archived_ok,
          session_pending=session_pending_shown,
          url=page.url.replace(origin, ""))
    page.go_back()
    page.get_by_test_id("everything-filter").filter(has_text="Archived").click()
    row = page.locator(f'[data-testid="everything-archived-run"][data-run-id="{ARCHIVED_ID}"]')
    row.wait_for(state="visible", timeout=10000)

    # ── 4. Unarchive re-reads the list; the Stopped lens shows the run in place ──────────────
    gets_before = state["runs_gets"]
    row.get_by_test_id("everything-unarchive").click()
    try:
        page.wait_for_function("() => true", timeout=10)  # yield once
        for _ in range(30):
            if state["runs_gets"] > gets_before:
                break
            page.wait_for_timeout(100)
    except Exception:  # noqa: BLE001
        pass
    reread = state["runs_gets"] - gets_before
    row.wait_for(state="hidden", timeout=5000)
    page.get_by_test_id("everything-filter").filter(has_text="Stopped").click()
    stopped = page.locator(f'[data-testid="everything-session"][data-run-id="{ARCHIVED_ID}"]')
    try:
        stopped.wait_for(state="visible", timeout=4000)
        listed = True
        text = stopped.inner_text().replace("\n", " ")
    except Exception:  # noqa: BLE001
        listed = False
        text = ""
    page.screenshot(path=str(SHOTS / "desk-everything-archive-stopped.png"))
    check("unarchive-rereads-in-place",
          state["archive_posts"] == [{"archived": False}] and reread >= 1 and listed and "Set up offsite-plan" in text,
          posts=state["archive_posts"], reread_gets=reread, listed=listed, text=text[:160],
          url=page.url.replace(origin, ""))

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors[:5], overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
