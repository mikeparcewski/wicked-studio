#!/usr/bin/env python3
"""
desk_made_doors_test.py — S16a-4d: a project's documents are started and deleted from Everything ›
Made, at 1440x700 on the Desk. Against the in-process fixture's interactive bridge (project `notes`).

  1. NEW: "New document" on the Made bar opens the door; Create sends exactly ONE
     POST …/interactive/api/docs; the address gains `open=<name>` (the new document, at full size).
  2. COLLISION: a second create with the same name keeps the form and names the document with
     "Open it" — one more POST, nothing created.
  3. DELETE: "Delete…" on a document row asks first; the confirm sends exactly ONE DELETE and the
     row leaves the list.
  4. ⌘K: "New Document" opens the Made list with the door open.
  5. 0 page errors.

Captures: e2e/shots/desk-made-doors-*.png. Env: FEEDBACK_PORT (default 4477). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4477"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "offsite-plan"
RUN = "r-doc-bound"

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


def post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"{}")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
SIZE = "() => document.querySelector('[data-testid=\"artifact\"]')?.dataset.size ?? null"


def addr(page) -> dict:
    u = urllib.parse.urlparse(page.url)
    return {"path": u.path, "size": urllib.parse.parse_qs(u.query).get("size", [None])[0]}


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    creates: list = []
    deletes: list = []
    page.on("request", lambda r: creates.append(r.url) if r.method == "POST" and r.url.endswith(f"/projects/{PID}/interactive/api/docs") else None)
    page.on("request", lambda r: deletes.append(r.url) if r.method == "DELETE" and "/interactive/docs/" in r.url else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": "old-notes", "brief": "to be deleted"})
    # The bridge's real collision: 409 {error: "doc already exists"} for a name that is already a doc.
    set_fixture(origin, editors=True, shell_csp=True, create_409_existing=True)

    # ── 1. New document ─────────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=made&project={PID}&kind=documents", wait_until="networkidle")
    page.get_by_test_id("made-new-document").click()
    page.get_by_test_id("made-new-document-form").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("made-new-document-brief").fill("Offsite plan for the team")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"made-new-document-create\"]')?.disabled", timeout=15000)
    page.get_by_test_id("made-new-document-create").click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('open') !== null", timeout=15000)
    opened = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).get("open", [None])[0]
    page.screenshot(path=str(SHOTS / "desk-made-doors-created.png"))
    check("new-document-one-post", len(creates) == 1 and opened is not None and opened.startswith("offsite-plan"), creates=creates, open=opened)

    # ── 2. the same name again: the collision, named ───────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=made&project={PID}&kind=documents&new=document", wait_until="networkidle")
    page.get_by_test_id("made-new-document-form").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("made-new-document-brief").fill("Offsite plan for the team")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"made-new-document-create\"]')?.disabled", timeout=15000)
    page.get_by_test_id("made-new-document-create").click()
    page.get_by_test_id("made-new-document-collision").wait_for(state="visible", timeout=10000)
    collision = page.get_by_test_id("made-new-document-collision").inner_text()
    check("collision-named-with-open-it", len(creates) == 2 and "already exists" in collision
          and page.get_by_test_id("made-new-document-open").count() == 1, creates=len(creates), line=collision)

    # ── 3. Delete a row ────────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=made&project={PID}&kind=documents", wait_until="networkidle")
    # The fixture's bridge serves no DELETE: answered here as the governed route does (interactive#189,
    # the soft tombstone), and the doc left off the next list read.
    def route_delete(route):
        if route.request.method != "DELETE":
            route.fallback()
            return
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"retired": True, "already_retired": False, "name": "old-notes"}))
    page.route("**/interactive/docs/old-notes", route_delete)
    row_del = page.locator('[data-testid="made-row-delete"][data-name="old-notes"]')
    row_del.wait_for(state="visible", timeout=15000)
    row_del.click()
    page.get_by_test_id("doc-delete-confirm").wait_for(state="visible", timeout=8000)
    check("delete-asks-first", deletes == [], deletes=deletes)
    page.get_by_test_id("doc-delete-go").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"everything-made-row\"][data-name=\"old-notes\"]')", timeout=10000)
    page.screenshot(path=str(SHOTS / "desk-made-doors-deleted.png"))
    check("delete-one-request-row-gone", len(deletes) == 1, deletes=deletes)

    # ── 4. ⌘K New Document ─────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("palette-input").fill("> New Document")
    page.wait_for_timeout(400)
    page.keyboard.press("Enter")
    page.get_by_test_id("made-new-document-form").wait_for(state="visible", timeout=10000)
    check("cmdk-opens-the-door", "new=document" in page.url and "tab=made" in page.url, url=page.url)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
