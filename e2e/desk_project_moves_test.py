#!/usr/bin/env python3
"""
desk_project_moves_test.py — S16a-4f: the project shell's Build view and its project Tests view
moved onto the Desk. At 1440x700 on the Desk, against the in-process fixture.

  1. BUILD: /p/<pid>/build lands on /everything?tab=sessions&project=<pid> with the project header;
     Back never re-enters /p/<pid>/build.
  2. NEW BUILD: /p/<pid>/build/new lands on `/` with the Desk composer and the project's `@` chip;
     nothing is POSTed (no run, no chat).
  3. TESTS: /p/<pid>/campaigns lands on /testing/campaigns?project=<pid>; "New test" opens the launch
     panel with the project preselected.
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
  .filter(h => /^\\/p\\/[^/]+\\/./.test(h))"""

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

    # ── 1. /p/<pid>/build → the project's Sessions ──────────────────────────────────
    page.goto(f"{origin}/watch", wait_until="networkidle")
    page.goto(f"{origin}/p/{PID}/build", wait_until="networkidle")
    try:
        page.wait_for_function("() => location.pathname === '/everything'", timeout=15000)
        page.get_by_test_id("everything-project-header").wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-build-miss.png"))
        fail("build-is-sessions", f"{e} at {page.url}")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    page.screenshot(path=str(SHOTS / "desk-project-moves-build.png"))
    page.go_back(wait_until="networkidle")
    page.wait_for_timeout(300)
    back = urllib.parse.urlparse(page.url).path
    check("build-is-sessions", q.get("tab") == ["sessions"] and q.get("project") == [PID] and back == "/watch",
          query=q, back=back)

    # ── 2. /p/<pid>/build/new → the Desk composer with the chip, nothing sent ──────────
    posts.clear()
    page.goto(f"{origin}/p/{PID}/build/new", wait_until="networkidle")
    try:
        page.wait_for_function("() => location.pathname === '/'", timeout=15000)
        page.locator(CHIP).first.wait_for(timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-new-miss.png"))
        fail("new-build-desk-chip", f"{e} at {page.url}")
    page.wait_for_timeout(800)
    page.screenshot(path=str(SHOTS / "desk-project-moves-new.png"))
    sent = [u for u in posts if urllib.parse.urlparse(u).path in ("/api/v1/runs", "/api/v1/chats") or u.endswith("/messages")]
    check("new-build-desk-chip", page.locator(CHIP).first.get_attribute("data-key") == f"project:{PID}" and sent == [],
          key=page.locator(CHIP).first.get_attribute("data-key"), sent=sent)

    # ── 3. /p/<pid>/campaigns → Testing, the project preselected ──────────────────────
    page.goto(f"{origin}/p/{PID}/campaigns", wait_until="networkidle")
    try:
        page.wait_for_function("() => location.pathname === '/testing/campaigns'", timeout=15000)
        page.get_by_test_id("testing-campaign-open").wait_for(timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-tests-miss.png"))
        fail("tests-preselect", f"{e} at {page.url}")
    tq = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    page.get_by_test_id("testing-campaign-open").click()
    sel = page.get_by_test_id("testing-launch-project")
    try:
        sel.wait_for(timeout=10000)
        page.wait_for_function(
            f"() => document.querySelector('[data-testid=\"testing-launch-project\"]')?.value === {json.dumps(PID)}", timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-project-moves-tests-nosel.png"))
        fail("tests-preselect", f"{e}; value={sel.input_value() if sel.count() else None}")
    page.screenshot(path=str(SHOTS / "desk-project-moves-tests.png"))
    check("tests-preselect", tq.get("project") == [PID], query=tq, value=sel.input_value())

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
