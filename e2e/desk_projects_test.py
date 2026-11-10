#!/usr/bin/env python3
"""S17a Projects surface at 1440x700 under the Desk skin."""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4397"))
report = {"ok": False, "steps": {}}


def check(name, ok, **detail):
    report["steps"][name] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def address(page):
    u = urllib.parse.urlparse(page.url)
    return u.path + ("?" + u.query if u.query else "")



dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    set_fixture(origin, project_create=True, repo=True)
    patches = []
    member_posts = []
    create_posts = []
    archived = {"id": "old-proj", "name": "Old sprint", "status": "archived", "description": "Past work",
                "scope": "project:old-proj", "created_at": 1, "updated_at": 1}

    def project_route(route):
        request = route.request
        if request.method == "PATCH":
            body = request.post_data_json
            patches.append(body)
            pid = request.url.rsplit("/", 1)[-1]
            if pid == "old-proj":
                row = {**archived, **body}
            else:
                row = {"id": pid, "name": "scratch", "status": "active", "description": "",
                       "scope": f"project:{pid}", "created_at": 1, "updated_at": 1, **body}
            route.fulfill(status=200, json={"project": row})
        else:
            route.fallback()

    def member_route(route):
        if route.request.method == "POST":
            member_posts.append(route.request.post_data_json)
            route.fulfill(status=201, json={"member": {"id": "m1"}})
        else:
            route.fallback()

    def create_route(route):
        if route.request.method == "POST":
            create_posts.append(route.request.post_data_json)
        route.fallback()

    page.route("**/api/v1/projects?status=archived*", lambda route: route.fulfill(status=200, json={"projects": [archived]}))
    page.route("**/api/v1/projects/*/members", member_route)
    page.route("**/api/v1/projects/*", project_route)
    page.route("**/api/v1/projects", create_route)

    page.goto(f"{origin}/everything?tab=projects", wait_until="networkidle")
    page.get_by_test_id("projects-tab").wait_for()
    page.locator('[data-testid="projects-row"][data-project-id="scratch"]').wait_for()
    ids = page.get_by_test_id("projects-row").evaluate_all("els => els.map(e => e.dataset.projectId)")
    check("projects-tab", "scratch" in ids and "default" not in ids and "legacy-spike" in ids and len(ids) >= 8, ids=ids)

    page.goto(origin, wait_until="networkidle")
    page.get_by_test_id("desk-rail-new-project").click()  # the rail's New project is the one door (the Desk's duplicate is gone)
    page.get_by_test_id("new-project-modal").wait_for()
    check("desk-door", page.get_by_test_id("new-project-start").count() == 0)
    page.get_by_test_id("new-project-name").fill("s17a journey project")
    page.get_by_test_id("new-project-repo").select_option(index=1)
    page.get_by_test_id("new-project-create").click()
    # Operator 2026-11-09: a new project lands on its homepage, never a filtered Sessions list.
    page.wait_for_function("() => /^\\/projects\\/proj_[0-9]+$/.test(location.pathname)", timeout=10000)
    created = urllib.parse.urlparse(page.url).path.rsplit("/", 1)[-1]
    page.get_by_test_id("project-home").wait_for(timeout=10000)
    check("new-project", create_posts == [{"name": "s17a journey project"}]
          and len(member_posts) == 1 and member_posts[0].get("kind") == "crew.repo"
          and member_posts[0].get("attachedBy") == "studio"
          and address(page) == f"/projects/{created}", posts=create_posts + member_posts, landed=address(page))

    # A row opens the project's homepage; rename and archive are the project's Settings tab's, and only there.
    page.goto(f"{origin}/everything?tab=projects", wait_until="networkidle")
    row = page.locator('[data-testid="projects-row"][data-project-id="scratch"]')
    row.wait_for()
    edits = page.locator('[data-testid="projects-row"] :is([data-testid="projects-row-rename"], [data-testid="projects-row-archive"], [data-testid="projects-row-unarchive"])').count()
    check("rows-open-home", row.get_by_test_id("projects-row-open").get_attribute("href") == "/projects/scratch" and edits == 0, edits=edits)

    page.get_by_role("button", name="Archived").click()
    old = page.locator('[data-testid="projects-row"][data-project-id="old-proj"]')
    old.wait_for()
    check("archived-lens", old.get_by_test_id("projects-row-archived").count() == 1 and old.locator("button").count() == 0
          and old.get_by_test_id("projects-row-open").get_attribute("href") == "/projects/old-proj" and patches == [], patches=patches)

    # The Sessions list filtered to a project is a plain filter: no second project card.
    page.goto(f"{origin}/everything?tab=sessions&project=legacy-spike", wait_until="networkidle")
    page.locator('[data-testid="everything-group"][data-project-id="legacy-spike"]').wait_for(timeout=10000)
    check("project-sessions", address(page) == "/everything?tab=sessions&project=legacy-spike"
          and page.get_by_test_id("everything-project-header").count() == 0
          and page.locator('[data-testid="everything-group"][data-project-id="legacy-spike"]').count() == 1,
          landed=address(page))
    check("page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
