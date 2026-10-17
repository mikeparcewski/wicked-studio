"""General settings without the agents block, and "Not in a project" as a project dashboard
(operator 2026-10-16: "General settings page doesn't need 'agents' block anymore." and "Not in a project
dashboard should be same as project dashboard").

The operator's paths, through the real buttons:
  1. Rail › General: the page has no agents block (no "Helpers and sign-in", no per-agent switches, no
     "Save CLI defaults"); everything else it had is there.
  2. Desk › Agents › an agent: its modal carries what the block did — "Use <agent> for new work" (it
     writes the composers' defaults) and "Sign <agent> out here".
  3. Rail › "Not in a project" › its open icon: lands on `/projects/default`, the SAME dashboard a
     project has — the project desk with its header actions, the Desk's tabs, the inbox, the tiles and
     the unfiled job in its Runs tab — on a daemon that serves the synthesized project (crew) and on one
     that answers 404 (the stand-in), never "Project not found".
  4. See everything › Projects › the "Not in a project" card › Open: the same dashboard.
At 1440x700 in light and dark, and on a 390px phone; 0 page errors.

Captures: e2e/shots/desk-unfiled-settings-*.png. Env: FEEDBACK_PORT (default 4604).
"""
import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4604"))
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, project_dto=True)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

DASH = """() => ({
  desk: !!document.querySelector('[data-testid="project-desk"]'),
  title: document.querySelector('[data-testid="project-title"]')?.innerText ?? null,
  tabs: [...document.querySelectorAll('[data-testid^="desk-tab-"]')].map((t) => t.dataset.testid),
  inbox: !!document.querySelector('[data-testid="desk-inbox"]'),
  blocks: !!document.querySelector('[data-testid="desk-blocks"]'),
  actions: [...document.querySelectorAll('[data-testid="project-actions"] [data-testid]')].map((a) => a.dataset.testid).filter((t) => t.startsWith('project-')),
  notFound: document.body.innerText.includes('Project not found'),
})"""


def theme(page, t: str) -> None:
    page.evaluate("(t) => t === 'dark' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t)", t)
    page.wait_for_timeout(150)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/", wait_until="networkidle")

    # 1. General has no agents block.
    page.get_by_test_id("desk-rail-general").click()
    page.get_by_test_id("view-settings").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(400)
    general = page.evaluate("""() => ({ sections: [...document.querySelectorAll('.wk-section-title')].map((h) => h.innerText),
      seatRows: document.querySelectorAll('[data-testid^="seat-signin-"], [data-testid^="seat-logout-"], .wk-pg-set-helper').length,
      saveClis: [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Save CLI defaults')) })""")
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        page.screenshot(path=str(SHOTS / f"desk-unfiled-settings-general-{t}.png"), full_page=True)
    check("general-has-no-agents-block", "Helpers and sign-in" not in general["sections"] and general["seatRows"] == 0 and not general["saveClis"]
          and all(s in general["sections"] for s in ("Theme", "Notifications", "View", "Work", "Code graph", "Reviews", "Helper configuration")), general=general)

    # 2. The Agents tab's modal carries it.
    page.goto(f"{origin}/?tab=agents&at=%2Fagents%3Ffix%3Dclaude", wait_until="networkidle")
    dialog = page.get_by_test_id("agents-modal")
    dialog.wait_for(state="visible", timeout=8000)
    toggle = dialog.get_by_test_id("agents-new-work-toggle")
    toggle.wait_for(state="visible", timeout=5000)
    before = toggle.get_attribute("aria-checked")
    toggle.click()
    page.wait_for_timeout(200)
    stored = page.evaluate("() => localStorage.getItem('wicked_default_clis')")
    after = dialog.get_by_test_id("agents-new-work-toggle").get_attribute("aria-checked")
    dialog.get_by_test_id("agents-new-work").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-unfiled-settings-agent-modal.png"))
    check("agent-modal-new-work", before in ("true", "false") and after != before and stored is not None, before=before, after=after, stored=stored)
    page.keyboard.press("Escape")

    # 3. Rail › Not in a project › open: the project dashboard (stand-in: the fixture serves no project detail).
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("rail-group-view-unfiled").click()
    page.wait_for_function("() => window.location.pathname === '/projects/default'", timeout=5000)
    page.get_by_test_id("project-desk").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("desk-inbox").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(500)
    unfiled = page.evaluate(DASH)
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        page.screenshot(path=str(SHOTS / f"desk-unfiled-settings-unfiled-{t}.png"))
    # A real project's dashboard, for the same shape (the fixture serves no project detail: crew's is routed in).
    page.route("**/api/v1/projects/legacy-spike", lambda r: r.fulfill(status=200, json={
        "project": {"id": "legacy-spike", "name": "legacy-spike", "description": None, "status": "active",
                    "scope": "project:legacy-spike", "created_at": 1, "updated_at": 1}, "members": []}))
    page.goto(f"{origin}/projects/legacy-spike", wait_until="networkidle")
    page.get_by_test_id("desk-inbox").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(500)
    real = page.evaluate(DASH)
    page.unroute("**/api/v1/projects/legacy-spike")
    check("unfiled-is-a-project-dashboard", unfiled["desk"] and unfiled["title"] == "Not in a project" and not unfiled["notFound"]
          and unfiled["inbox"] and unfiled["blocks"] and unfiled["tabs"] == real["tabs"] and len(unfiled["tabs"]) >= 6
          and {"project-new-job", "project-chat", "project-documents"} <= set(unfiled["actions"]), unfiled=unfiled, real=real)
    page.goto(f"{origin}/projects/default?tab=runs", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.get_by_text("All time", exact=False).first.click()  # r-unfiled carries no start time
    page.wait_for_timeout(300)
    jobs = page.evaluate("() => document.querySelector('[data-testid=\"desk-runs\"]')?.innerText ?? document.body.innerText")
    check("unfiled-job-listed", "poke at the flaky CI job" in jobs and "stranded work from another client" in jobs, jobs=jobs[-700:])

    # 3b. Crew serves the synthesized project: its members are the dashboard's jobs.
    page.route("**/api/v1/projects/default", lambda r: r.fulfill(status=200, json={
        "project": {"id": "default", "name": "Unfiled", "description": "Runs and chats not filed into any project (synthesized; read-only).",
                    "status": "active", "scope": "", "created_at": 1, "updated_at": 1},
        "members": [{"id": "default:crew.run:r-unfiled", "project_id": "default", "member_kind": "crew.run", "member_ref": "r-unfiled",
                     "meta": None, "attached_at": 1, "attached_by": "crew"}]}))
    page.goto(f"{origin}/projects/default?tab=runs", wait_until="networkidle")
    page.get_by_test_id("project-desk").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(800)
    page.get_by_text("All time", exact=False).first.click()
    page.wait_for_timeout(300)
    served = page.evaluate(DASH)
    jobs2 = page.evaluate("() => document.querySelector('[data-testid=\"desk-runs\"]')?.innerText ?? document.body.innerText")
    check("crew-served-unfiled", served["title"] == "Not in a project" and "poke at the flaky CI job" in jobs2 and not served["notFound"], served=served)
    page.unroute("**/api/v1/projects/default")

    # 4. See everything › Projects › Not in a project › Open.
    page.goto(f"{origin}/everything?tab=projects", wait_until="networkidle")
    page.get_by_test_id("projects-unfiled-open").click()
    page.wait_for_function("() => window.location.pathname === '/projects/default'", timeout=5000)
    page.get_by_test_id("project-desk").wait_for(state="visible", timeout=8000)
    check("projects-card-opens-dashboard", True)
    ctx.close()

    # Phone: the unfiled dashboard and General.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{origin}/projects/default", wait_until="networkidle")
    page.get_by_test_id("project-desk").wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(500)
    over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    page.screenshot(path=str(SHOTS / "desk-unfiled-settings-unfiled-phone.png"))
    check("phone-unfiled-no-sideways", over <= 0, over=over)
    page.goto(f"{origin}/system", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / "desk-unfiled-settings-general-phone.png"))
    ctx.close()

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
