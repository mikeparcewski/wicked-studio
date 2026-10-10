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
  LC-3 Archived lens + Unarchive, and
  LC-4 leaving the lens hides the archived row while live runs stay: both are the CI-wired
       `desk_everything_archive` journey (steps 2 and 3, on the Everything page that replaced the
       Work board's chip). They are not duplicated here.
  LC-5 Repo register form (`/repos/new`): Register is disabled until both name and path are set;
       submit POSTs `/api/v1/repos {name, rootPath}` and lands on `/repo-detail/<id>` (the POST is
       answered by a Playwright route, so the fixture needs no register switch).

Captures: e2e/shots/desk-run-lifecycle-*.png. Env: FEEDBACK_PORT (default 4482). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys
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
    page.locator('[data-testid="session-gate-choice"][data-choice-key="approve"]').click()
    page.get_by_test_id("session-gate-chosen").wait_for(state="visible", timeout=10000)
    check("lc2-nothing-sent-in-undo-window", gate_posts("r-home-gate") == [])
    page.wait_for_timeout(11_500)  # the 10 s undo window
    posts = gate_posts("r-home-gate")
    bodies = [x.get("body", {}) for x in posts]
    chosen = page.get_by_test_id("session-gate-chosen").inner_text()
    page.screenshot(path=str(SHOTS / "desk-run-lifecycle-lc2.png"))
    check("lc2-one-approve-with-its-gate",
          len(bodies) == 1 and bodies[0].get("approve") is True and bodies[0].get("ord") == 1,
          bodies=bodies)
    check("lc2-row-says-what-was-sent", chosen.startswith("You chose: Approve,"), chosen=chosen)

    # ── LC-5: repo register form ─────────────────────────────────────────────────────────────
    registered: list = []

    def route_register(route):
        if route.request.method != "POST":
            route.fallback()
            return
        body = json.loads(route.request.post_data or "{}")
        registered.append(body)
        route.fulfill(status=201, content_type="application/json", body=json.dumps({"repo": {
            "id": "my-repo", "name": body.get("name", "my-repo"), "root_path": body.get("rootPath", ""),
            "created_at": 1_759_600_000}, "onboardRunId": "r-onboard-my-repo"}))

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
        page.wait_for_url("**/repo-detail/**", timeout=10000)
        landed = True
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
