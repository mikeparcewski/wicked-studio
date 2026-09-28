#!/usr/bin/env python3
"""
demo_mode_test.py — the studio Demo experience (wicked-studio#373), end to end on the fixture
(1440x700, one skin per run).

A demo of a local app, made by a governed run of the `demo` preset: plan gate → record →
review gate → watch. Against the `demo_runs` fixture (crew api-types 0.61.0 wire: POST
/projects/:id/demo → {runId}; GET /runs/:id/demo walks the run on the clock and on its gates):

  1 start     /demo is the demo RUNS page: empty, it says how to start; ＋ Demo opens a project picker
              locked to Demo mode. The project's Demo mode is the start form: Plan the demo stays
              disabled until the URL, audience and what to show are filled; launching posts exactly
              those to POST /projects/upload-endpoint/demo (never POST /runs from the page) and opens
              the run.
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

Captures (e2e/shots/): demo-<skin>-plan.png, demo-<skin>-review.png, demo-<skin>-watch.png.
Env: FEEDBACK_PORT (default 4391), STUDIO_SKIN. JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PROJECT = "upload-endpoint"
SKIN = STUDIO_SKIN
APP = "http://127.0.0.1:5173/"
AUDIENCE = "New team leads who have never seen the app"
SHOW = "How a request goes from intake to done, and where people approve"

report: dict = {"ok": False, "skin": SKIN, "steps": {}}


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

    set_fixture(origin, demo_runs=True, reset_demo=True, appearance={**DEFAULT_APPEARANCE, "skin": SKIN})
    state: dict = {}

    def stage_is(stage: str, timeout: int = 15000) -> None:
        page.wait_for_function(
            f"""() => document.querySelector('[data-testid="demo-run"]')?.dataset.stage === '{stage}'""",
            timeout=timeout)

    def section_start() -> None:
        page.goto(f"{origin}/demo", wait_until="networkidle")
        check("skin-applied", page.evaluate("() => document.documentElement.getAttribute('data-skin')") == SKIN)
        check("demo-page-empty-says-how", page.get_by_test_id("demo-runs-empty").is_visible())
        page.get_by_test_id("demo-new").click()
        check("new-demo-picker-locked-to-demo", page.get_by_test_id("project-mode-picker").get_attribute("data-mode") == "video")
        page.goto(f"{origin}/p/{PROJECT}/video", wait_until="networkidle")
        page.get_by_test_id("demo-start").wait_for(state="visible")
        go = page.get_by_test_id("demo-launch")
        check("launch-disabled-until-filled", go.is_disabled())
        page.get_by_test_id("demo-url").fill(APP)
        page.get_by_test_id("demo-audience").fill(AUDIENCE)
        check("launch-still-disabled-without-what-to-show", go.is_disabled())
        page.get_by_test_id("demo-show").fill(SHOW)
        go.click()
        page.wait_for_url(f"**/p/{PROJECT}/video/r-demo-1", timeout=10000)
        sent = [x for x in posts(origin) if x["route"] == "launch"]
        check("one-launch-with-the-brief", len(sent) == 1 and sent[0]["projectId"] == PROJECT
              and sent[0]["body"] == {"url": APP, "audience": AUDIENCE, "show": SHOW}, sent=sent)
        check("page-never-posts-runs", run_posts == [], run_posts=run_posts)
        state["rid"] = sent[0]["runId"]

    def section_plan() -> None:
        stage_is("plan_gate")
        gate = page.get_by_test_id("demo-plan-gate")
        check("plan-gate-names-the-chapters", "3 chapters planned" in gate.inner_text())
        check("script-shown", "synthetic data" in page.get_by_test_id("demo-script").inner_text())
        keys = page.locator('[data-testid="demo-chapter"]').evaluate_all("els => els.map(e => e.dataset.key)")
        check("chapter-list", keys == ["01-intake", "02-approve", "03-done"], keys=keys)
        check("nothing-recorded-before-approval",
              page.get_by_test_id("demo-record-progress").inner_text() == "0/3 recorded")
        check("stepper-on-plan", page.get_by_test_id("demo-stepper").get_attribute("data-step") == "plan")
        page.screenshot(path=str(SHOTS / f"demo-{SKIN}-plan.png"))
        page.get_by_test_id("demo-edit-script").click()
        editor = page.get_by_test_id("demo-script-editor")
        editor.fill(editor.input_value() + "\n\nOpen on the dashboard.")
        page.get_by_test_id("demo-save-script").click()
        page.get_by_test_id("demo-answered").wait_for(state="visible")
        edits = [x for x in posts(origin) if x["route"] == "script"]
        check("script-edit-is-a-put-at-the-gate", len(edits) == 1 and edits[0]["content"].endswith("Open on the dashboard."))
        page.get_by_test_id("demo-approve-plan").click()
        stage_is("recording")
        gates = [x for x in posts(origin) if x["route"] == "gate"]
        check("plan-approved-on-the-runs-gate", len(gates) == 1 and gates[0]["stage"] == "plan_gate"
              and gates[0]["body"] == {"approve": True, "ord": 3}, gates=gates)

    def section_record() -> None:
        page.wait_for_function(
            """() => [...document.querySelectorAll('[data-testid="demo-chapter"]')].some(e => e.dataset.state === 'recorded')""",
            timeout=15000)
        states = page.locator('[data-testid="demo-chapter"]').evaluate_all("els => els.map(e => e.dataset.state)")
        check("per-chapter-progress", states[0] == "recorded" and "waiting" not in states[:1], states=states)

    def section_review() -> None:
        stage_is("review_gate", 20000)
        check("review-verdict-changes", page.get_by_test_id("demo-review-verdict").get_attribute("data-verdict") == "changes")
        check("failed-review-cannot-be-accepted", page.get_by_test_id("demo-review-verdict").get_attribute("data-rejected") == "true"
              and page.get_by_test_id("demo-accept").count() == 0 and page.get_by_test_id("demo-review-again").is_visible())
        sheets = page.locator('[data-testid="demo-sheet"]').evaluate_all("els => els.map(e => e.dataset.name)")
        check("three-contact-sheets", sheets == ["chapters", "joins", "end"], sheets=sheets)
        loaded = page.locator('[data-testid="demo-sheet"] img').evaluate_all(
            "els => Promise.all(els.map(i => i.complete ? i.naturalWidth : new Promise(r => i.onload = () => r(i.naturalWidth))))")
        check("contact-sheets-load", all(w > 0 for w in loaded), widths=loaded)
        verdicts = page.locator('[data-testid="demo-finding"]').evaluate_all("els => els.map(e => e.dataset.verdict)")
        check("per-issue-verdicts", verdicts == ["re-record", "re-encode"], verdicts=verdicts)
        check("governance-seats-apart", page.get_by_test_id("demo-gov-seats").get_attribute("data-ok") == "true")
        page.screenshot(path=str(SHOTS / f"demo-{SKIN}-review.png"))
        page.locator('[data-testid="demo-rerecord"][data-key="02-approve"]').click()
        stage_is("recording")
        gate = [x for x in posts(origin) if x["route"] == "gate"][-1]
        body = gate["body"]
        check("rerecord-is-request-changes-naming-one-chapter",
              gate["stage"] == "review_gate" and body.get("approve") is False and body.get("action") == "request_changes"
              and body.get("ord") == 4
              and "Re-record only chapter 02-approve" in body.get("amend", "") and "01-intake" not in body.get("amend", ""),
              body=body)
        states = page.locator('[data-testid="demo-chapter"]').evaluate_all("els => els.map(e => e.dataset.state)")
        check("only-that-chapter-rerecords", states[0] == "recorded" and states[2] == "recorded", states=states)
        stage_is("review_gate", 20000)
        check("second-review-accepts", page.get_by_test_id("demo-review-verdict").get_attribute("data-verdict") == "accept")
        page.get_by_test_id("demo-accept").click()
        stage_is("done")
        accept = [x for x in posts(origin) if x["route"] == "gate"][-1]
        check("accept-names-the-reopened-review-gate", accept["stage"] == "review_gate"
              and accept["body"] == {"approve": True, "ord": 4}, body=accept["body"])

    def section_watch() -> None:
        video = page.get_by_test_id("demo-video")
        page.wait_for_function(
            """() => document.querySelector('[data-testid="demo-video"]')?.readyState >= 2""", timeout=15000)
        check("video-loads", video.evaluate("v => v.readyState") >= 2)
        markers = page.locator('[data-testid="demo-marker"]')
        check("chapter-markers", markers.count() == 3, count=markers.count())
        check("governance-read-only", page.get_by_test_id("demo-gov-readonly").get_attribute("data-ok") == "true")
        check("governance-synthetic", page.get_by_test_id("demo-gov-synthetic").get_attribute("data-ok") == "true")
        seats = page.get_by_test_id("demo-gov-seats").inner_text()
        check("evaluator-not-creator-named", "recorded by claude, reviewed by codex" in seats, seats=seats)
        check("draft-update-offered", page.get_by_test_id("demo-draft-update").is_visible())
        check("stepper-on-watch", page.get_by_test_id("demo-stepper").get_attribute("data-step") == "watch")
        page.get_by_test_id("demo-watch").scroll_into_view_if_needed()
        page.screenshot(path=str(SHOTS / f"demo-{SKIN}-watch.png"))
        page.goto(f"{origin}/demo", wait_until="networkidle")
        rows = page.locator('[data-testid="demo-run-row"]')
        rows.first.wait_for(state="visible")
        check("demo-page-lists-the-run", rows.count() == 1 and rows.first.get_attribute("data-run-id") == state["rid"]
              and rows.first.get_attribute("data-status") == "completed")
        rows.first.click()
        page.wait_for_url(f"**/p/{PROJECT}/video/{state['rid']}", timeout=10000)
        check("still-never-posted-runs", run_posts == [], run_posts=run_posts)

    ok = True
    for section in (section_start, section_plan, section_record, section_review, section_watch):
        try:
            section()
        except SectionFailed:
            ok = False
            page.screenshot(path=str(SHOTS / f"demo-{SKIN}-fail.png"))
            break
        except Exception as e:  # noqa: BLE001 — a journey reports, never tracebacks
            report["steps"][section.__name__] = {"ok": False, "error": repr(e)[:400]}
            page.screenshot(path=str(SHOTS / f"demo-{SKIN}-fail.png"))
            ok = False
            break
    browser.close()

report["ok"] = ok
print(json.dumps(report, indent=2))
sys.exit(0 if ok else 1)
