#!/usr/bin/env python3
"""
desk_run_lifecycle_test.py — the run-lifecycle suite (LC-1…LC-5, studio#312), revived on the Desk
against the in-process fixture at 1440x700. It was written for the run page (`/p/:id/:mode/:run`,
SteeringGate), which is gone: a run lives on its session thread (`/s/run:<id>`) now. CI runs it
(`DESK_ONLY` in run_journeys.py), so it cannot rot unexecuted again.

  LC-1 Launch-form validation (`/runs/new`): Send is disabled with no problem, enabled once a
       problem and a repository are set, and Send POSTs `/runs` with that problem.
  LC-2 Gate answering on the session thread (`/s/run:r-home-gate#gate`). Re-specified (#312): the
       old card-detaches assertion was wrong for a status-driven surface; the proof is the WIRE —
       after the undo window the fixture's gate tap holds exactly one `{approve: true, ord: 1}` —
       and the row's receipt ("You chose: Approve, …").
  LC-3 Archived lens + Unarchive: the CI-wired `desk_everything_archive` journey (steps 2–3, on the
       Everything page that replaced the Work board's chip); not duplicated here.
  LC-4 Lens switching keeps archived runs apart: with one run archived (`GET /runs` leaves it out,
       `?include=archived` carries it, as crew#265 serves it), the All lens shows a live run and not
       the archived one; Archived shows it; back on All it is gone again and the live run stays.
  LC-5 Repo register form (`/repos/new`): Register is disabled until both name and path are set;
       submit POSTs `/api/v1/repos {name, rootPath}` and lands on `/repo-detail/<id>` (the POST is
       answered by a Playwright route, so the fixture needs no register switch).

Captures: e2e/shots/desk-run-lifecycle-*.png. Env: FEEDBACK_PORT (default 4482). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4482"))
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


def gate_posts(run_id: str) -> list:
    got = json.loads(urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10).read())["posts"]
    return [p for p in got if p["runId"] == run_id]


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    run_posts: list = []
    gate_sent_at: list = []  # when the browser sent each gate POST (LC-2's timing, off the request itself)
    page.on("request", lambda r: gate_sent_at.append(time.monotonic())
            if r.method == "POST" and "/r-home-gate/gate" in r.url else None)
    page.on("request", lambda r: run_posts.append(json.loads(r.post_data or "{}"))
            if r.method == "POST" and r.url.split("?")[0].endswith("/api/v1/runs") else None)

    # ── LC-1: launch-form validation ─────────────────────────────────────────────────────────
    set_fixture(origin, team_plan=True, repo=True, preview_delay_ms=0)
    page.goto(f"{origin}/runs/new", wait_until="networkidle")
    problem = page.get_by_test_id("launch-problem")
    problem.wait_for(state="visible", timeout=15000)
    send = page.get_by_test_id("launch-submit")
    check("lc1-send-disabled-empty", send.is_disabled())
    problem.fill("SAVE20 should give twenty percent off")
    repo_id = page.evaluate("""() => [...document.querySelectorAll('[data-testid="launch-repo-picker"] option')]
      .map(o => o.value).find(v => v && v !== '__several__') || ''""")
    if repo_id == "":
        fail("lc1-repo-to-pick", "the launch form offers no repository")
    page.locator('[data-testid="launch-repo-picker"]').first.select_option(repo_id)
    page.wait_for_timeout(400)
    check("lc1-send-enabled", send.is_enabled(), repo=repo_id)
    page.screenshot(path=str(SHOTS / "desk-run-lifecycle-lc1.png"))
    send.click()
    for _ in range(40):
        if run_posts:
            break
        page.wait_for_timeout(250)
    check("lc1-send-posts-runs", len(run_posts) == 1 and run_posts[0].get("problem") == "SAVE20 should give twenty percent off",
          posts=run_posts[:2])

    # ── LC-2: gate answering on the session thread (re-specified: the wire, not a detach) ────
    set_fixture(origin, home_paths=True, reset_gate_posts=True)
    page.goto(f"{origin}/s/run%3Ar-home-gate#gate", wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15000)
    gate_sent_at.clear()
    clicked_at = time.monotonic()
    page.locator('[data-testid="session-gate-choice"][data-choice-key="approve"]').click()
    page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10000)
    # The one POST and the settled receipt, polled (a loaded runner's timer may lag) …
    posts: list = []
    chosen = ""
    for _ in range(60):
        posts = gate_posts("r-home-gate")
        chosen = page.get_by_test_id("session-gate-chosen").inner_text() if page.get_by_test_id("session-gate-chosen").count() else ""
        if posts and chosen.startswith("You chose: Approve,"):
            break
        page.wait_for_timeout(250)
    bodies = [x.get("body", {}) for x in posts]
    # … and it left no earlier than the 10 s undo window allows: measured from just BEFORE the click
    # to the request itself, so a slow runner can only make the gap longer, never fail it falsely.
    waited = (gate_sent_at[0] - clicked_at) if gate_sent_at else None
    check("lc2-sent-only-after-the-undo-window", waited is not None and waited >= 9.5, waited_s=waited)
    page.screenshot(path=str(SHOTS / "desk-run-lifecycle-lc2.png"))
    check("lc2-one-approve-with-its-gate",
          len(bodies) == 1 and bodies[0].get("approve") is True and bodies[0].get("ord") == 1,
          bodies=bodies)
    check("lc2-row-says-what-was-sent", chosen.startswith("You chose: Approve,"), chosen=chosen)

    # ── LC-4: lens switching keeps archived runs apart ───────────────────────────────────────
    ARCHIVED_ID = "r-lc-archived"

    def archived_run() -> dict:
        return {"session": {
            "id": ARCHIVED_ID, "workflow_id": "bug", "problem": "LC archived leftover", "entity_mode": "shared",
            "collection_scope": None, "clis": ["claude"], "status": "cancelled", "human_confirm": "none",
            "unit_ix": 1, "attempt": 0, "workdir": None, "repo_ref": None, "extra_write_roots": [],
            "archived_at": 1_759_601_000, "archive_note": None, "project_id": None,
            "created_at": 1_759_600_000, "ended_at": 1_759_600_600,
        }, "units": [{
            "id": f"{ARCHIVED_ID}:u0", "session_id": ARCHIVED_ID, "ord": 0, "description": "fix it", "stage": "build",
            "assigned_cli": "claude", "assigned_invocation": None, "council_task_ref": None, "routing": None,
            "denial_reason": None, "phase_ref": None, "conformance_ref": None, "phase_status": None,
            "collection_scope": None, "status": "done",
        }]}

    def route_runs(route):
        if route.request.method != "GET":
            route.fallback()
            return
        body = route.fetch().json()
        if "include=archived" in route.request.url:
            body["runs"] = list(body.get("runs", [])) + [archived_run()]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    set_fixture(origin, wave1=True, wave2b=True)
    page.route("**/api/v1/runs", route_runs)
    page.route("**/api/v1/runs?*", route_runs)
    archived_sel = f'[data-run-id="{ARCHIVED_ID}"]'
    page.goto(f"{origin}/everything?tab=sessions&filter=all", wait_until="networkidle")
    page.get_by_test_id("everything-sessions").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("everything-session").first.wait_for(state="visible", timeout=10000)
    live_before = page.get_by_test_id("everything-session").count()
    check("lc4-all-has-live-not-archived", live_before > 0 and page.locator(archived_sel).count() == 0, live=live_before)
    page.locator('[data-testid="everything-filter"][data-filter="archived"]').click()
    page.locator(f'[data-testid="everything-archived-run"]{archived_sel}').wait_for(state="visible", timeout=10000)
    check("lc4-archived-lens-shows-it", True)
    page.locator('[data-testid="everything-filter"][data-filter="all"]').click()
    page.get_by_test_id("everything-session").first.wait_for(state="visible", timeout=10000)
    page.screenshot(path=str(SHOTS / "desk-run-lifecycle-lc4.png"))
    check("lc4-back-on-all-hidden-live-stays",
          page.locator(archived_sel).count() == 0 and page.get_by_test_id("everything-session").count() == live_before,
          live=page.get_by_test_id("everything-session").count(), before=live_before)
    page.unroute("**/api/v1/runs", route_runs)
    page.unroute("**/api/v1/runs?*", route_runs)

    # ── LC-5: repo register form ─────────────────────────────────────────────────────────────
    registered: list = []
    MY_REPO = {"id": "my-repo", "name": "my-repo", "root_path": "/tmp/my-repo", "created_at": 1_759_600_000}

    def route_register(route):
        if route.request.method != "POST":
            # The repo list after registration carries the new repo, as the daemon's does.
            res = route.fetch()
            body = res.json()
            if registered:
                body["repos"] = list(body.get("repos", [])) + [MY_REPO]
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
            return
        body = json.loads(route.request.post_data or "{}")
        registered.append(body)
        route.fulfill(status=201, content_type="application/json",
                      body=json.dumps({"repo": MY_REPO, "onboardRunId": "r-onboard-my-repo"}))

    page.route("**/api/v1/repos", route_register)
    page.goto(f"{origin}/repos/new", wait_until="networkidle")
    register = page.get_by_role("button", name="Register & onboard")
    register.wait_for(state="visible", timeout=15000)
    check("lc5-register-disabled-empty", register.is_disabled())
    page.get_by_placeholder("Repo name").fill("my-repo")
    check("lc5-register-disabled-no-path", register.is_disabled())
    page.get_by_placeholder("Absolute path to git repo").fill("/tmp/my-repo")
    check("lc5-register-enabled", register.is_enabled())
    register.click()
    try:
        page.wait_for_url("**/repo-detail/my-repo", timeout=10000)
        page.get_by_text("my-repo").first.wait_for(state="visible", timeout=10000)
        landed = page.get_by_text("Repo not found.").count() == 0
    except Exception:  # noqa: BLE001
        landed = False
    page.screenshot(path=str(SHOTS / "desk-run-lifecycle-lc5.png"))
    check("lc5-register-posts-and-lands",
          landed and len(registered) == 1 and registered[0].get("name") == "my-repo" and registered[0].get("rootPath") == "/tmp/my-repo",
          registered=registered, url=page.url.replace(origin, ""))

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
