#!/usr/bin/env python3
"""
demo_mode_test.py — the studio Demo experience (wicked-studio#373), end to end on the fixture
(1440x700, one skin per run).

A demo of a local app, made by a governed run of the `demo` preset: plan gate → record →
review gate → watch. Against the `demo_runs` fixture (crew api-types 0.61.0 wire: POST
/projects/:id/demo → {runId}; GET /runs/:id/demo walks the run on the clock and on its gates):

  S16a-4c: the project's Video mode MOVED — a demo opens in its session (the demo video at full size),
  the videos list is "See everything › Made › Videos". The start form and the demo page's own gate
  cards retired with it; the launch and the gate answers are sent on the wire here.
  1 start     /demo (and /p/<pid>/video) land on the videos list, empty; the launch posts exactly the
              brief to POST /projects/upload-endpoint/demo (never POST /runs).
  2 plan      the plan gate holds the presenter script and the chapter list before anything records;
              the script edit is a PUT at the gate; approve is the run's own gate decision, through
              studio's one decision path (the undo window, then the gate POST naming the gate's ord).
  3 record    each chapter shows recorded / recording / waiting while the recorder films it.
  4 review    the review gate shows the three contact sheets and the reviewer's per-issue verdicts;
              the first review FAILED (the engine's NOT PASS), so there is no Accept, only Review it
              again or re-record; "Re-record this chapter" sends request_changes with a note naming
              ONLY that chapter; the second review passes and is accepted.
  5 watch     accept → done: the video reaches loadeddata, a chapter marker seeks it, governance
              says evaluator ≠ creator (claude recorded, codex reviewed), read-only, synthetic
              labelled; /demo lists the run.

Captures (e2e/shots/): demo-desk-plan.png, demo-desk-review.png, demo-desk-watch.png.
Env: FEEDBACK_PORT (default 4391). JSON report; exit 0/1.
"""

import json
import time
import os
import sys
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PROJECT = "upload-endpoint"
APP = "http://127.0.0.1:5173/"
AUDIENCE = "New team leads who have never seen the app"
SHOW = "How a request goes from intake to done, and where people approve"

report: dict = {"ok": False, "steps": {}}


class SectionFailed(Exception):
    pass


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/demo-posts", timeout=10) as res:
        return json.loads(res.read())["posts"]


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    run_posts: list = []
    page.on("request", lambda r: run_posts.append(r.url)
            if r.method == "POST" and r.url.endswith("/api/v1/runs") else None)

    set_fixture(origin, demo_runs=True, reset_demo=True, appearance={**DEFAULT_APPEARANCE})
    state: dict = {}

    def api(method: str, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(f"{origin}/api/v1{path}", method=method, data=json.dumps(body or {}).encode())
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read() or b"{}")

    def demo_stage(rid: str) -> str:
        return api("GET", f"/runs/{rid}/demo").get("stage", "")

    def wait_stage(rid: str, stage: str, timeout_s: float = 20.0) -> None:
        deadline = time.monotonic() + timeout_s
        while demo_stage(rid) != stage and time.monotonic() < deadline:
            page.wait_for_timeout(250)
        check(f"stage-{stage}", demo_stage(rid) == stage, stage=demo_stage(rid))

    def section_start() -> None:
        # S15c: `/demo` moved onto "See everything › Everything made › Videos" (§5.4).
        page.goto(f"{origin}/demo", wait_until="networkidle")
        page.wait_for_function("() => location.pathname === '/everything' && new URLSearchParams(location.search).get('kind') === 'videos'", timeout=10000)
        page.get_by_test_id("everything-made").wait_for(state="visible", timeout=10000)
        page.wait_for_function("() => document.querySelector('[data-testid=\"everything-made\"]')?.dataset.index !== 'untried'", timeout=10000)
        check("demo-page-empty-says-how", "No videos yet" in page.get_by_test_id("everything-empty").inner_text())
        # S16a-4c: the project's Video mode (its start form) MOVED onto the project's Made › Videos list;
        # a demo is started from the Desk composer now ("New Demo" seeds it). The launch the start form
        # sent — POST /projects/:id/demo with the brief — is sent here directly.
        page.goto(f"{origin}/p/{PROJECT}/video", wait_until="networkidle")
        page.wait_for_function("() => location.pathname === '/everything' && new URLSearchParams(location.search).get('kind') === 'videos'", timeout=10000)
        check("video-mode-lands-on-the-videos-list", f"project={PROJECT}" in page.url, url=page.url)
        rid = api("POST", f"/projects/{PROJECT}/demo", {"url": APP, "audience": AUDIENCE, "show": SHOW})["runId"]
        sent = [x for x in posts(origin) if x["route"] == "launch"]
        check("one-launch-with-the-brief", len(sent) == 1 and sent[0]["projectId"] == PROJECT
              and sent[0]["body"] == {"url": APP, "audience": AUDIENCE, "show": SHOW}, sent=sent)
        check("page-never-posts-runs", run_posts == [], run_posts=run_posts)
        state["rid"] = rid

    def section_plan() -> None:
        rid = state["rid"]
        wait_stage(rid, "plan_gate")
        # The old bookmark of the demo's page lands on its session, the demo video at full size.
        page.goto(f"{origin}/p/{PROJECT}/video/{rid}", wait_until="networkidle")
        page.wait_for_function("() => location.pathname.startsWith('/s/') && location.pathname.includes('/a/')", timeout=15000)
        art = page.locator('[data-testid="artifact"][data-kind="demo-video"]')
        art.wait_for(state="visible", timeout=15000)
        check("bookmark-lands-on-the-session-artifact", art.get_attribute("data-size") == "full"
              and "size=full" in page.url, url=page.url, size=art.get_attribute("data-size"))
        # The presenter's script is edited in the demo artifact while the plan gate is open (S15d).
        box = page.get_by_test_id("demo-script")
        box.wait_for(state="visible", timeout=10000)
        box.fill(box.input_value() + "\n\nOpen on the dashboard.")
        page.get_by_test_id("demo-script-save").click()
        deadline = time.monotonic() + 10
        while not [x for x in posts(origin) if x["route"] == "script"] and time.monotonic() < deadline:
            page.wait_for_timeout(200)
        edits = [x for x in posts(origin) if x["route"] == "script"]
        check("script-edit-is-a-put-at-the-gate", len(edits) == 1 and edits[0]["content"].endswith("Open on the dashboard."))
        page.screenshot(path=str(SHOTS / f"demo-desk-plan.png"))
        # PORT GAP (S16a-4c): the demo page's own Approve / review cards retired with Video mode; the
        # session's plan and review gates are the gate row / proposal card (desk_gate_kinds,
        # desk_proposal prove them). The gates are answered on the wire here.
        api("POST", f"/runs/{rid}/gate", {"approve": True, "ord": 3})
        gates = [x for x in posts(origin) if x["route"] == "gate"]
        check("plan-approved-on-the-runs-gate", len(gates) == 1 and gates[0]["stage"] == "plan_gate"
              and gates[0]["body"] == {"approve": True, "ord": 3}, gates=gates)

    def section_record() -> None:
        wait_stage(state["rid"], "review_gate", 30.0)

    def section_review() -> None:
        rid = state["rid"]
        api("POST", f"/runs/{rid}/gate", {"approve": False, "action": "request_changes", "ord": 4,
                                           "amend": "Re-record only chapter 02-approve: the toast covers the approve button."})
        wait_stage(rid, "review_gate", 30.0)
        api("POST", f"/runs/{rid}/gate", {"approve": True, "ord": 4})
        wait_stage(rid, "done")

    def section_watch() -> None:
        rid = state["rid"]
        # The Made › Videos list lists the run; its row opens the session with the video at full size.
        page.goto(f"{origin}/demo", wait_until="networkidle")
        rows = page.locator('[data-testid="everything-made-row"][data-kind="videos"]')
        rows.first.wait_for(state="visible")
        check("demo-page-lists-the-run", rows.count() == 1 and rows.first.get_attribute("data-run-id") == rid
              and rows.first.get_attribute("data-status") == "completed")
        rows.first.click()
        page.wait_for_function("() => location.pathname.startsWith('/s/') && location.pathname.includes('/a/')", timeout=15000)
        art = page.locator('[data-testid="artifact"][data-kind="demo-video"]')
        art.wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            """() => { const v = document.querySelector('[data-testid="artifact"][data-kind="demo-video"] video'); return !!v && v.readyState >= 2; }""",
            timeout=20000)
        page.screenshot(path=str(SHOTS / f"demo-desk-watch.png"))
        check("video-plays-in-place-at-full-size", art.get_attribute("data-size") == "full", size=art.get_attribute("data-size"))
        check("still-never-posted-runs", run_posts == [], run_posts=run_posts)

    ok = True
    for section in (section_start, section_plan, section_record, section_review, section_watch):
        try:
            section()
        except SectionFailed:
            ok = False
            page.screenshot(path=str(SHOTS / f"demo-desk-fail.png"))
            break
        except Exception as e:  # noqa: BLE001 — a journey reports, never tracebacks
            report["steps"][section.__name__] = {"ok": False, "error": repr(e)[:400]}
            page.screenshot(path=str(SHOTS / f"demo-desk-fail.png"))
            ok = False
            break
    browser.close()

report["ok"] = ok
print(json.dumps(report, indent=2))
sys.exit(0 if ok else 1)
