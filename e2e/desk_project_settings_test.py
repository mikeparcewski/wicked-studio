#!/usr/bin/env python3
"""
desk_project_settings_test.py: one project, created to restored, on its own pages (operator
2026-11-09: "project pages are inconsistent"). At 1440x700 on the Desk, against the in-process fixture
(project_create on: the fixture serves a created project's detail and its PATCH).

  1. CREATE: the rail's New project → Create lands on the project's homepage, /projects/<id>, not a
     filtered Sessions list.
  2. HOME: "More info" (a link, no ⋯) opens the first tab, ?tab=work; the header there keeps Open
     repository at most (no Documents, no Edit / Archive), and the documents are on Work.
  3. NO EVERYTHING LENS: no anchor on the home or on any tab links /everything with project=; Running
     now and Failed open the project's Jobs tab with ?filter=.
  4. SETTINGS (the last tab): rename and describe → one PATCH {name, description}; the title follows.
  5. ARCHIVE: the button asks inline first (Cancel sends nothing), then PATCH {status: archived}; the
     home shows the Archived tag; the Projects page's Archived card opens it and offers no Unarchive.
  6. RESTORE: Settings → Restore → PATCH {status: active}; the danger zone offers Archive again.
  7. LISTS: no Projects page card or Everything > Projects row has a rename or archive control.
  8. 0 page errors.

Captures: e2e/shots/desk-project-settings-*.png. Env: FEEDBACK_PORT (default 4486). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse
import urllib.error
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4486"))
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def address(page) -> str:
    u = urllib.parse.urlparse(page.url)
    return u.path + ("?" + u.query if u.query else "")


def patches(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/project-patches") as r:
        return json.loads(r.read())["posts"]


LENS_LINKS = """() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
  .filter((h) => h.startsWith('/everything') && /[?&]project=/.test(h))"""

dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, project_create=True, repo=True)

    # 1. Create lands on the homepage.
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-new-project").click()
    page.get_by_test_id("new-project-modal").wait_for()
    page.get_by_test_id("new-project-name").fill("Settings journey")
    page.get_by_test_id("new-project-description").fill("Where the shop's checkout lives")
    page.get_by_test_id("new-project-create").click()
    page.wait_for_function("() => /^\\/projects\\/proj_[0-9]+$/.test(location.pathname) && location.search === ''", timeout=10000)
    pid = urllib.parse.urlparse(page.url).path.rsplit("/", 1)[-1]
    base = f"/projects/{pid}"
    page.get_by_test_id("project-home").wait_for(state="visible", timeout=10000)
    check("create-lands-on-home", address(page) == base and page.get_by_test_id("project-title").inner_text() == "Settings journey",
          landed=address(page))

    # 2. More info, not a ⋯.
    check("home-more-info", page.get_by_test_id("project-menu").count() == 0
          and page.get_by_test_id("project-more-info").get_attribute("href") == f"{base}?tab=work"
          and page.get_by_test_id("project-more-info").inner_text().strip() == "More info")
    lens_home = page.evaluate(LENS_LINKS)
    page.get_by_test_id("project-more-info").click()
    page.wait_for_function(f"() => location.pathname + location.search === {json.dumps(base + '?tab=work')}", timeout=5000)
    page.get_by_test_id("desk-work").wait_for(state="visible", timeout=8000)
    actions = page.get_by_test_id("project-actions").inner_text()
    check("header-trimmed", page.locator('[data-testid="project-actions"] [data-testid="project-documents"]').count() == 0
          and not any(w in actions for w in ("Documents", "Archive", "Edit", "Restore"))
          and page.locator("#project-documents").count() == 1, actions=actions)

    # 3. No project surface leads to the filtered Everything list.
    running = page.get_by_test_id("desk-block-running-open").get_attribute("href")
    failed = page.get_by_test_id("desk-block-failed-open").get_attribute("href")
    lens_tabs = {"home": lens_home, "work": page.evaluate(LENS_LINKS)}
    for tab in ("runs", "repositories", "report", "understand", "steer", "memory", "agents", "evaluate", "settings"):
        page.goto(f"{origin}{base}?tab={tab}", wait_until="networkidle")
        page.get_by_test_id("desk").wait_for(state="visible", timeout=8000)
        lens_tabs[tab] = page.evaluate(LENS_LINKS)
    check("no-everything-lens", all(v == [] for v in lens_tabs.values())
          and running == f"{base}?tab=runs&filter=active" and failed == f"{base}?tab=runs&filter=failed",
          lens=lens_tabs, running=running, failed=failed)

    # 4. Settings: rename and describe.
    page.goto(f"{origin}{base}", wait_until="networkidle")
    page.locator('[data-testid="project-view"][data-tab="settings"]').click()
    page.get_by_test_id("project-settings").wait_for(state="visible", timeout=8000)
    tabs = page.locator('[data-testid="desk-tabs"] [role="tab"]').all_inner_texts()
    page.screenshot(path=str(SHOTS / "desk-project-settings-tab.png"))
    page.get_by_test_id("project-settings-name").fill("Checkout")
    page.get_by_test_id("project-settings-description").fill("The storefront's checkout")
    page.get_by_test_id("project-settings-save").click()
    page.get_by_test_id("project-settings-saved").wait_for(timeout=5000)
    renamed = patches(origin)
    check("rename", tabs[-1:] == ["Settings"] and address(page) == f"{base}?tab=settings"
          and renamed == [{"id": pid, "body": {"name": "Checkout", "description": "The storefront's checkout"}}]
          and page.get_by_test_id("project-title").inner_text() == "Checkout", tabs=tabs, patches=renamed)

    # 5. Archive: ask inline first.
    page.get_by_test_id("project-archive").click()
    page.get_by_test_id("project-archive-confirming").wait_for()
    asked = page.get_by_test_id("project-archive-confirming").inner_text()
    page.screenshot(path=str(SHOTS / "desk-project-settings-confirm.png"))
    page.get_by_test_id("project-archive-cancel").click()
    check("archive-cancel", len(patches(origin)) == 1 and page.get_by_test_id("project-archive-confirming").count() == 0
          and page.get_by_role("dialog").count() == 0 and "Archive Checkout?" in asked, asked=asked)
    page.get_by_test_id("project-archive").click()
    page.get_by_test_id("project-archive-confirm").click()
    page.get_by_test_id("project-restore").wait_for(timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-project-settings-archived.png"))
    archived = patches(origin)
    page.goto(f"{origin}{base}", wait_until="networkidle")
    page.get_by_test_id("project-archived").wait_for(timeout=8000)
    page.goto(f"{origin}/projects?filter=archived", wait_until="networkidle")
    card = page.locator(f'[data-testid="projects-row"][data-project-id="{pid}"]')
    card.wait_for(timeout=8000)
    check("archive", archived[-1] == {"id": pid, "body": {"status": "archived"}}
          and card.get_by_test_id("projects-row-state").inner_text() == "Archived"
          and card.locator("button").count() == 0
          and card.get_by_test_id("projects-row-open").get_attribute("href") == base, patches=archived)

    # The fixture refuses what crew's strict PATCH schema refuses, and changes nothing.
    def raw_patch(body: dict) -> int:
        req = urllib.request.Request(f"{origin}/api/v1/projects/{pid}", data=json.dumps(body).encode(), method="PATCH",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
    refused = [raw_patch(b) for b in ({"name": ""}, {"name": "x" * 121}, {"status": "gone"}, {"colour": "red"})]
    check("fixture-refuses-bad-bodies", refused == [400, 400, 400, 400] and len(patches(origin)) == len(archived), refused=refused)

    # 6. Restore from Settings.
    card.get_by_test_id("projects-row-open").click()
    page.wait_for_function(f"() => location.pathname === {json.dumps(base)}", timeout=5000)
    page.goto(f"{origin}{base}?tab=settings", wait_until="networkidle")
    page.get_by_test_id("project-restore").click()
    page.get_by_test_id("project-archive").wait_for(timeout=5000)
    restored = patches(origin)
    check("restore", restored[-1] == {"id": pid, "body": {"status": "active"}} and len(restored) == 3, patches=restored)

    # 7. No rename or archive control on the lists.
    page.goto(f"{origin}/projects", wait_until="networkidle")
    page.locator('[data-testid="projects-row"]').first.wait_for(timeout=8000)
    page_controls = page.locator('[data-testid="projects-row"]').evaluate_all(
        "els => els.flatMap((el) => [...el.querySelectorAll('a, button')].map((c) => c.dataset.testid ?? c.textContent))")
    page.goto(f"{origin}/everything?tab=projects", wait_until="networkidle")
    page.locator('[data-testid="projects-row"]').first.wait_for(timeout=8000)
    tab_controls = page.locator('[data-testid="projects-row"]').evaluate_all(
        "els => els.flatMap((el) => [...el.querySelectorAll('a, button')].map((c) => c.textContent.trim()))")
    check("lists-have-no-edit", set(page_controls) == {"projects-row-open"} and set(tab_controls) == {"Open"},
          page=sorted(set(page_controls)), tab=sorted(set(tab_controls)))

    check("page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
