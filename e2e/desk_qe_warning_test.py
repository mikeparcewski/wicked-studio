#!/usr/bin/env python3
"""
desk_qe_warning_test.py — a failure BECAUSE QE acceptance is required says why, and links straight to
the Settings switch that turns it off (operator ask, 2026-10-14). On the Desk at 1440x700 against the
in-process fixture, light and dark.

The fixture has no QE refusals, so Playwright routes answer over it (the overlay pattern of
desk_stranded_deliver_test.py): GET /health carries `capabilities.qeAcceptance` (flipped mid-journey),
a stranded run `r-qe` whose POST /runs/:id/deliver answers crew's 409 `qe_acceptance_required`, and
POST /runs answers crew's launch 400 with the same code.

  1. DELIVERY REFUSED (setting required): the stranded card's Deliver press gets the warning — "Not
     delivered: QE acceptance hasn't passed", nothing pushed, the switch applies to jobs started after
     it — with the link; crew's own sentence only behind Technical details.
  2. THE LINK LANDS ON THE SWITCH: /system#qe-acceptance, the switch in view, focused and ringed.
  3. LAUNCH REFUSED (setting required): the composer's Send gets "Not started: this job needs QE
     acceptance" with the link; no bare error line; one POST (never retried without delivery).
  4. QE ALREADY OFF: the same delivery refusal says what else to do, and offers no link.
  Steps 1-4 run in the light theme, then again in the dark one.
  5. 0 page errors.

Captures: e2e/shots/desk-qe-warning-*.png. Env: FEEDBACK_PORT (default 4481). Prints a JSON report;
exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4481"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
RID = "r-qe"
DELIVERY_SENTENCE = (
    "run r-qe requires QE acceptance (qe_acceptance) and its delivery is refused: the QE ledger holds no PASS "
    "attributed to this run. Nothing was pushed — record a PASS attributed to this run in its QE ledger "
    "(garden qe accept), then deliver again."
)
LAUNCH_SENTENCE = (
    "workflow feature requires QE acceptance (required_instruments: qe_acceptance), so it delivers only through "
    "the deliver gate, where the verdict is checked — deliverGate: \"auto\" cannot apply to it (unless the launch "
    "explicitly skips QE acceptance with a reason: skipQeAcceptance)"
)

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
state = {"qe": "required", "deliver_posts": 0, "launch_posts": 0}


def unit(rid: str, ord_: int, name: str, status: str) -> dict:
    return {
        "id": f"{rid}:{name}", "session_id": rid, "ord": ord_, "description": name, "stage": "build",
        "assigned_cli": "claude" if name != "deliver" else None, "assigned_invocation": None,
        "council_task_ref": None, "routing": None, "denial_reason": None, "phase_ref": "deliver" if name == "deliver" else None,
        "conformance_ref": None, "phase_status": None, "collection_scope": None, "status": status,
    }


RUN = {
    "session": {
        "id": RID, "workflow_id": "feature", "problem": "Fix the double charge on retry", "entity_mode": "shared",
        "collection_scope": None, "clis": ["claude"], "status": "completed", "human_confirm": "none",
        "unit_ix": 2, "attempt": 0, "workdir": f"/w/trees/{RID}", "repo_ref": None, "extra_write_roots": [],
        "archived_at": None, "archive_note": None, "project_id": None,
        "created_at": 1_759_600_000, "ended_at": 1_759_600_600, "delivery": "stranded",
    },
    "units": [unit(RID, 0, "build", "done"), unit(RID, 1, "deliver", "rejected")],
}


def route_health(route):
    res = route.fetch()
    body = res.json()
    caps = dict(body.get("capabilities") or {})
    caps["qeAcceptance"] = state["qe"]
    body["capabilities"] = caps
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def route_runs(route):
    if route.request.method == "POST":
        state["launch_posts"] += 1
        route.fulfill(status=400, content_type="application/json",
                      body=json.dumps({"code": "qe_acceptance_required", "error": LAUNCH_SENTENCE}))
        return
    res = route.fetch()
    body = res.json()
    body["runs"] = list(body.get("runs", [])) + [RUN]
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def route_settings(route):
    # crew >= 0.12.0 serves the setting (the fixture predates it): the switch is live, so it takes focus.
    if route.request.method != "GET":
        route.fallback()
        return
    res = route.fetch()
    body = res.json()
    body.setdefault("settings", {})["qeAcceptance"] = state["qe"]
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def route_one(route):
    if route.request.method != "GET":
        route.fallback()
        return
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"run": RUN}))


def route_events(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"events": []}))


def route_deliver(route):
    state["deliver_posts"] += 1
    route.fulfill(status=409, content_type="application/json", body=json.dumps({
        "code": "qe_acceptance_required", "error": DELIVERY_SENTENCE,
        "acceptance": {"status": "required", "satisfied": False, "reason": "no PASS", "verdictId": None, "reviewer": None},
        "assurance": None,
    }))


def refuse_delivery(page) -> str:
    page.goto(f"{origin}/s/run%3A{RID}", wait_until="networkidle")
    page.get_by_test_id("session-stranded-deliver").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("session-stranded-deliver").click()
    card = page.get_by_test_id("session-stranded-qe-refused")
    card.wait_for(state="visible", timeout=10000)
    page.get_by_test_id("session-stranded-qe-refused-fix").wait_for(state="visible", timeout=10000)
    card.scroll_into_view_if_needed()
    return card.inner_text()


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.route("**/api/v1/health", route_health)
    page.route("**/api/v1/health?*", route_health)
    page.route("**/api/v1/runs", route_runs)
    page.route("**/api/v1/runs?*", route_runs)
    page.route("**/api/v1/settings", route_settings)
    page.route(f"**/api/v1/runs/{RID}", route_one)
    page.route(f"**/api/v1/runs/{RID}/events*", route_events)
    page.route(f"**/api/v1/runs/{RID}/deliver", route_deliver)

    for theme in ("light", "dark"):
        attr = None if theme == "dark" else theme  # the default (dark) theme is the bare stylesheet
        set_fixture(origin, wave1=True, repo=True, appearance={**DEFAULT_APPEARANCE, "theme": theme})
        state.update(qe="required", deliver_posts=0, launch_posts=0)

        # ── 1. delivery refused, setting required ────────────────────────────────────────────────
        text = refuse_delivery(page)
        page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=attr, timeout=5000)
        link = page.get_by_test_id("session-stranded-qe-refused-link")
        page.screenshot(path=str(SHOTS / f"desk-qe-warning-delivery-{theme}.png"))
        check(f"{theme}-delivery-refused-says-why", state["deliver_posts"] == 1
              and "Not delivered: QE acceptance hasn’t passed" in text and "Nothing was pushed." in text
              and "applies to jobs started after that" in text and link.count() == 1
              and link.get_attribute("href") == "/system#qe-acceptance"
              and "garden qe accept" not in text.split("Technical details")[0]
              and page.get_by_test_id("session-stranded-error").count() == 0,
              text=text, posts=state["deliver_posts"])

        # ── 2. the link lands on the switch ──────────────────────────────────────────────────────
        link.click()
        page.wait_for_function("() => location.pathname === '/system' && location.hash === '#qe-acceptance'", timeout=10000)
        target = page.locator('[data-testid="qe-acceptance-setting"][data-targeted="true"]')
        target.wait_for(state="visible", timeout=10000)
        page.wait_for_timeout(600)  # the smooth scroll settles
        focused = page.evaluate("() => document.activeElement && document.activeElement.dataset.testid")
        box = target.bounding_box()
        in_view = box is not None and box["y"] >= 0 and box["y"] + box["height"] <= H
        page.screenshot(path=str(SHOTS / f"desk-qe-warning-settings-{theme}.png"))
        check(f"{theme}-link-lands-on-switch", focused == "qe-acceptance-toggle" and in_view, focused=focused, box=box)

        # ── 3. launch refused, setting required ──────────────────────────────────────────────────
        page.goto(f"{origin}/runs/new", wait_until="networkidle")
        page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("launch-problem").fill("Fix the double charge on retry")
        repo_id = page.evaluate("""() => [...document.querySelectorAll('[data-testid="launch-repo-picker"] option')]
          .map(o => o.value).find(v => v && v !== '__several__') || ''""")
        if repo_id == "":
            fail(f"{theme}-repo-to-pick", "the launch form offers no repository")
        page.locator('[data-testid="launch-repo-picker"]').first.select_option(repo_id)
        page.wait_for_timeout(400)
        page.get_by_test_id("launch-submit").click()
        launch_card = page.get_by_test_id("launch-qe-refused")
        try:
            launch_card.wait_for(state="visible", timeout=15000)
        except Exception:
            page.screenshot(path=str(SHOTS / f"desk-qe-warning-launch-missing-{theme}.png"))
            fail(f"{theme}-launch-refused-says-why", {"posts": state["launch_posts"],
                 "submit_enabled": page.get_by_test_id("launch-submit").is_enabled(),
                 "error": page.get_by_test_id("launch-error").all_inner_texts()})
        page.get_by_test_id("launch-qe-refused-link").wait_for(state="visible", timeout=10000)
        launch_card.scroll_into_view_if_needed()
        ltext = launch_card.inner_text()
        page.screenshot(path=str(SHOTS / f"desk-qe-warning-launch-{theme}.png"))
        check(f"{theme}-launch-refused-says-why", "Not started: this job needs QE acceptance" in ltext
              and "turn off QE acceptance in Settings" in ltext and state["launch_posts"] == 1
              and page.get_by_test_id("launch-error").count() == 0,
              text=ltext, posts=state["launch_posts"])

        # ── 4. QE already off: what else to do, no link ──────────────────────────────────────────
        state["qe"] = "off"
        text_off = refuse_delivery(page)
        page.screenshot(path=str(SHOTS / f"desk-qe-warning-off-{theme}.png"))
        check(f"{theme}-off-says-what-else", "keeps the QE requirement it started with" in text_off
              and "Record a QE pass for it, or start the job again without requiring QE acceptance." in text_off
              and page.get_by_test_id("session-stranded-qe-refused-link").count() == 0, text=text_off)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
