#!/usr/bin/env python3
"""
desk_project_moves_test.py — S16a-4f: the project shell's Build view and its project Tests view
live on the Desk. X1 (operator ruling 2026-10-09): the shell addresses no longer redirect. At
1440x700 on the Desk, against the in-process fixture.

  1. RETIRED: /p/<pid>, /p/<pid>/build, /p/<pid>/build/new and /p/<pid>/campaigns each show the
     not-found page with the typed address kept; nothing is POSTed (no run, no chat).
  2. SESSIONS: /everything?tab=sessions&project=<pid> shows the project header.
  3. TESTS: /testing/campaigns?project=<pid> opens the launch wizard on the test workflow with the
     project preselected (the Testing landing retired, operator 2026-10-12).
  4. NO SHELL LINKS: no anchor on the Desk, a session or Everything (sessions, made, projects) has
     an href under /p/<pid>/.
  5. 0 page errors.

Captures: e2e/shots/desk-project-moves-*.png. Env: FEEDBACK_PORT (default 4483). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4483"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "upload-endpoint"

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
CHIP = '[data-testid="composer"][data-composer="desk"] [data-testid="composer-chip"][data-kind="project"]'
SHELL_LINKS = """() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))
  .filter(h => /^\\/p\\//.test(h))"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    posts: list = []
    page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and "/api/v1/" in r.url else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, sessions=True, governed_testing=True)

    # ── 1. the retired shell addresses are dead: not-found, the typed address kept ─────
    for step, path in (("retired-project", f"/p/{PID}"), ("retired-build", f"/p/{PID}/build"),
                       ("retired-build-new", f"/p/{PID}/build/new"), ("retired-campaigns", f"/p/{PID}/campaigns")):
        posts.clear()
        page.goto(f"{origin}{path}", wait_until="networkidle")
        try:
            page.get_by_test_id("not-found").wait_for(timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"desk-project-moves-{step}-miss.png"))
            fail(step, f"{e} at {page.url}")
        sent = [u for u in posts if urllib.parse.urlparse(u).path in ("/api/v1/runs", "/api/v1/chats") or u.endswith("/messages")]
        check(step, urllib.parse.urlparse(page.url).path == path
              and page.get_by_test_id("not-found-path").inner_text().strip() == path and sent == [],
              url=page.url, sent=sent)
    page.screenshot(path=str(SHOTS / "desk-project-moves-retired.png"))

    # ── 2. the project's Sessions live on See everything ─────────────────────────────
    page.goto(f"{origin}/everything?tab=sessions&project={PID}", wait_until="networkidle")
    try:
        page.get_by_test_id("everything-project-header").wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-build-miss.png"))
        fail("project-sessions", f"{e} at {page.url}")
    page.screenshot(path=str(SHOTS / "desk-project-moves-build.png"))
    check("project-sessions", True)

    # ── 3. /testing/campaigns?project=<pid> → the launch wizard on the test workflow, the project
    #       preselected (operator 2026-10-12: writing tests is a workflow; the Testing landing retired).
    page.goto(f"{origin}/testing/campaigns?project={urllib.parse.quote(PID)}", wait_until="networkidle")
    try:
        page.get_by_test_id("launch-wizard-step").wait_for(timeout=15000)
        page.wait_for_function("() => window.location.pathname === '/'", timeout=5000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-tests-miss.png"))
        fail("tests-preselect", f"{e} at {page.url}")
    step = page.get_by_test_id("launch-wizard-step").get_attribute("data-step")
    page.get_by_test_id("launch-wizard-intent").fill("cover the checkout flow")
    page.get_by_test_id("launch-wizard-next").click()
    sel = page.get_by_test_id("launch-wizard-project")
    try:
        sel.wait_for(timeout=10000)
        page.wait_for_function(
            f"() => document.querySelector('[data-testid=\"launch-wizard-project\"]')?.value === {json.dumps(PID)}", timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-tests-nosel.png"))
        fail("tests-preselect", f"{e}; value={sel.input_value() if sel.count() else None}")
    page.screenshot(path=str(SHOTS / "desk-project-moves-tests.png"))
    check("tests-preselect", step == "what", first_step=step, value=sel.input_value(), path=page.evaluate("() => location.pathname"))
    page.get_by_test_id("launch-wizard-close").click()

    # ── 4. nothing on the Desk, a session or Everything links into the shell ──────────
    found: dict = {}
    for addr in ["/", "/s/run%3Ar-pay-2", "/everything?tab=sessions", f"/everything?tab=sessions&project={PID}",
                 "/everything?tab=made", "/everything?tab=projects"]:
        page.goto(f"{origin}{addr}", wait_until="networkidle")
        page.wait_for_timeout(500)
        hits = page.evaluate(SHELL_LINKS)
        if hits:
            found[addr] = hits[:5]
    check("no-shell-links", not found, found=found)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
