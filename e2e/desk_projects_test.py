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
    page.get_by_test_id("desk-new-project").click()
    page.get_by_test_id("new-project-modal").wait_for()
    check("desk-door", page.get_by_test_id("new-project-start").count() == 0)
    page.get_by_test_id("new-project-name").fill("s17a journey project")
    page.get_by_test_id("new-project-repo").select_option(index=1)
    page.get_by_test_id("new-project-create").click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('project')?.startsWith('proj_')", timeout=10000)
    created = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)["project"][0]
    check("new-project", create_posts == [{"name": "s17a journey project"}]
          and len(member_posts) == 1 and member_posts[0].get("kind") == "crew.repo"
          and member_posts[0].get("attachedBy") == "studio"
          and address(page) == f"/everything?tab=sessions&project={created}", posts=create_posts + member_posts, landed=address(page))

    page.goto(f"{origin}/everything?tab=projects", wait_until="networkidle")
    row = page.locator('[data-testid="projects-row"][data-project-id="scratch"]')
    row.get_by_test_id("projects-row-rename").click()
    row.get_by_label("Project name").fill("Scratch renamed")
    row.get_by_role("button", name="Save").click()
    page.wait_for_function("() => document.querySelector('[data-testid=projects-row][data-project-id=scratch]')?.textContent.includes('Scratch renamed')")
    check("rename", any(x.get("name") == "Scratch renamed" and "description" in x for x in patches), patches=patches)
    row.get_by_test_id("projects-row-archive").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=projects-row][data-project-id=scratch]')")
    check("archive", any(x.get("status") == "archived" for x in patches), patches=patches)

    page.get_by_role("button", name="Archived").click()
    old = page.locator('[data-testid="projects-row"][data-project-id="old-proj"]')
    old.wait_for()
    old.get_by_test_id("projects-row-unarchive").click()
    old.wait_for(state="detached")
    check("archived-lens", any(x.get("status") == "active" for x in patches), patches=patches)

    page.goto(f"{origin}/p/legacy-spike", wait_until="networkidle")
    page.get_by_test_id("everything-project-header").wait_for(timeout=10000)
    check("p-id-move", address(page) == "/everything?tab=sessions&project=legacy-spike"
          and page.locator('[data-testid="everything-group"][data-project-id="legacy-spike"]').count() == 1,
          landed=address(page))
    check("page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
