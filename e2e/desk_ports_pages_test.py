#!/usr/bin/env python3
"""
desk_ports_pages_test.py — S18b: the classic skins' pieces of value, on the Desk's pages, at 1440x700
on the Desk, against the in-process fixture (project_create, wave2b, provenance).

  1. SEARCH (port 1c): on /everything › Sessions under the Blocked filter, typing into everything-search
     finds a working session the filter hid (a non-empty search lifts the state filter); clearing it
     brings the filter back.
  2. MADE (port 1d): "Ask every project" starts the fan-out; everything-made-cancel sits beside the
     progress sentence and stops it after the project being asked answers (no further project is
     asked); ?project= narrows the rows to that project and the scope line names it; a grounded
     document row carries the grounding chip from crew#512's record (studio#567).
  3. /projects/:id (port 1e): the Documents root row shows beside Repositories; Set… saves a root
     (PATCH {interactiveRoot}) and the row reads it back; Clear sends null.
  4. SHEETS (port 1f): a session sheet's Activity tab speaks sentences (sheet-activity-line with a
     data-tone, never a raw event type); a retried run's "What & where" tab lists its retry; the Desk
     sheet's "Studio itself" tab carries "$X observed this session" only once a cliUsage frame arrived.
  5. RAIL (port 1g): with a stored logo_url the rail brand shows desk-rail-logo in the dot's place.
  0 page errors.

Captures: e2e/shots/desk-ports-*.png. Env: FEEDBACK_PORT (default 4398).
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4398"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)



dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

SESSIONS = """() => [...document.querySelectorAll('[data-testid="everything-session"]')].map(s => ({
  id: s.dataset.sessionId, state: s.dataset.state, text: s.innerText }))"""


def address(page) -> str:
    u = urllib.parse.urlparse(page.url)
    return u.path + (f"?{u.query}" if u.query else "")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, project_create=True, wave2b=True, provenance=True, demo=True, usage_ws=False, appearance=None)

    # ── 1. the Sessions search ─────────────────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=sessions&filter=failed", wait_until="networkidle")
    page.get_by_test_id("everything-sessions").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"everything-session\"]').length >= 1", timeout=10000)
    blocked = page.evaluate(SESSIONS)
    hidden = "rate-limiting"  # r-upload — working, so the Blocked filter hides it
    page.get_by_test_id("everything-search").fill(hidden)
    page.wait_for_function(
        "w => [...document.querySelectorAll('[data-testid=\"everything-session\"]')].some(s => s.innerText.includes(w))",
        arg=hidden, timeout=5000)
    found = page.evaluate(SESSIONS)
    page.screenshot(path=str(SHOTS / "desk-ports-search.png"))
    page.get_by_test_id("everything-search").fill("")
    page.wait_for_timeout(200)
    after = page.evaluate(SESSIONS)
    check("search", all(s["state"] == "blocked" for s in blocked) and not any(hidden in s["text"] for s in blocked)
          and len(found) >= 1 and all(hidden in s["text"] for s in found) and any(s["state"] != "blocked" for s in found)
          and [s["id"] for s in after] == [s["id"] for s in blocked]
          and address(page) == "/everything?tab=sessions&filter=failed",
          blocked=[s["id"] for s in blocked], found=[(s["id"], s["state"]) for s in found], after=[s["id"] for s in after])

    # ── 2. Made: Cancel the fan-out, ?project= narrows ────────────────────────────
    held = []
    asked = []

    def docs_route(route):
        asked.append(route.request.url)
        if len(asked) == 1:
            held.append(route)  # the first project's answer waits until Cancel is pressed
        else:
            route.fallback()

    page.goto(f"{origin}/everything?tab=made", wait_until="networkidle")
    page.get_by_test_id("everything-made").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("everything-made-load").wait_for(state="visible", timeout=10000)
    # Held from the gesture on: the page's own boot reads (root-bound projects) are not the fan-out.
    page.route("**/api/v1/projects/*/interactive/api/docs", docs_route)
    page.get_by_test_id("everything-made-load").click()
    page.get_by_test_id("everything-made-cancel").wait_for(state="visible", timeout=5000)
    census = page.get_by_test_id("everything-made-census").inner_text()
    page.screenshot(path=str(SHOTS / "desk-ports-made-cancel.png"))
    page.get_by_test_id("everything-made-cancel").click()
    for r in held:
        r.fallback()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"everything-made-cancel\"]')", timeout=8000)
    page.wait_for_timeout(500)
    stopped = page.get_by_test_id("everything-made").get_attribute("data-census")
    asked_n = len(asked)
    page.unroute("**/api/v1/projects/*/interactive/api/docs")
    # A full fan-out so the rows hold more than one project, then the scope.
    page.goto(f"{origin}/everything?tab=made", wait_until="networkidle")
    page.get_by_test_id("everything-made-load").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"everything-made-cancel\"]') && document.querySelectorAll('[data-testid=\"everything-made-row\"]').length > 0", timeout=20000)
    all_rows = page.get_by_test_id("everything-made-row").evaluate_all("els => els.map(e => e.dataset.projectId)")
    target = "notes"  # the notes registry seeds; q3-review-deck carries the demo's documents (`demo`)
    page.evaluate("u => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }",
                  f"/everything?tab=made&project={target}")
    page.get_by_test_id("everything-scope").wait_for(state="visible", timeout=5000)
    scoped = page.get_by_test_id("everything-made-row").evaluate_all("els => els.map(e => e.dataset.projectId)")
    scope_text = page.get_by_test_id("everything-scope").inner_text()
    page.screenshot(path=str(SHOTS / "desk-ports-made-scope.png"))
    check("made", "Asking" in census and asked_n == 1 and stopped == "fanout"
          and len(set(all_rows)) > 1 and len(scoped) >= 1 and len(scoped) < len(all_rows)
          and all(x == target for x in scoped) and target in scope_text,
          census=census, asked=asked_n, stopped=stopped, all_rows=sorted(set(all_rows)), target=target, scoped=scoped)

    # studio#567: the grounded fixture document's row carries the chip from the structured record;
    # the row without the record carries none.
    chip = page.evaluate("""() => {
      const row = n => document.querySelector(`[data-testid="everything-made-row"][data-name="${n}"]`);
      const g = row('ideas'), t = row('todo');
      const q = (el, id) => el ? el.querySelector(`[data-testid="${id}"]`) : null;
      return { repos: q(g, 'doc-grounding-repos')?.innerText ?? null, reposTitle: q(g, 'doc-grounding-repos')?.title ?? null,
               source: q(g, 'doc-grounding-source')?.innerText ?? null, skipped: q(g, 'doc-grounding-skipped')?.innerText ?? null,
               skippedTitle: q(g, 'doc-grounding-skipped')?.title ?? null, plain: t !== null && q(t, 'doc-grounding-chip') === null };
    }""")
    check("made_grounding_chip", chip["repos"] == "Grounded on 1 repo" and chip["reposTitle"] == "notes-app"
          and chip["source"] == "the project's only repo" and chip["skipped"] == "skipped 1"
          and "old-notes" in (chip["skippedTitle"] or "") and chip["plain"], **chip)

    # ── 3. /projects/:id — the Documents root ─────────────────────────────────────
    patches = []
    # The fixture serves no `GET /projects/:id`: the route answers the detail (crew's ProjectDetail) for
    # `scratch` — no root bound yet — and echoes each PATCH the way crew does.
    scratch = {"id": "scratch", "name": "scratch", "status": "active", "description": None,
               "scope": "project:scratch", "created_at": 1, "updated_at": 1}

    def project_route(route):
        req = route.request
        if req.method == "GET":
            route.fulfill(status=200, json={"project": scratch, "members": []})
        elif req.method == "PATCH":
            body = req.post_data_json
            patches.append(body)
            row = {**scratch, **body}
            route.fulfill(status=200, json={"project": row})
        else:
            route.fallback()

    page.route("**/api/v1/projects/scratch", project_route)
    page.goto(f"{origin}/projects/scratch", wait_until="networkidle")
    page.get_by_test_id("project-docs-root").wait_for(state="visible", timeout=15000)
    before = page.get_by_test_id("project-docs-root").get_attribute("data-bound")
    page.get_by_test_id("project-docs-root-edit").click()
    page.get_by_test_id("project-docs-root-input").fill("/tmp/wi-scratch")
    page.get_by_test_id("project-docs-root-save").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"project-docs-root\"]')?.dataset.bound === 'true'", timeout=5000)
    value = page.get_by_test_id("project-docs-root-value").inner_text()
    page.screenshot(path=str(SHOTS / "desk-ports-docs-root.png"))
    page.get_by_test_id("project-docs-root-clear").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"project-docs-root\"]')?.dataset.bound === 'false'", timeout=5000)
    page.goto(f"{origin}/projects/default", wait_until="networkidle")
    page.wait_for_timeout(800)
    on_default = page.get_by_test_id("project-docs-root").count()
    page.unroute("**/api/v1/projects/scratch")
    check("docs-root", before == "false" and value == "/tmp/wi-scratch" and on_default == 0
          and patches == [{"interactiveRoot": "/tmp/wi-scratch"}, {"interactiveRoot": None}],
          before=before, value=value, patches=patches, on_default=on_default)

    # ── 4. sheets: narrated Activity, the retry lineage, the observed spend ───────
    page.goto(f"{origin}/s/run:r-auth", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("session-sheet-open").click()
    page.get_by_test_id("sheet").wait_for(state="visible", timeout=5000)
    page.locator('[data-testid="sheet-tab"][data-tab="activity"]').click()
    page.get_by_test_id("sheet-activity-line").first.wait_for(state="visible", timeout=8000)
    lines = page.get_by_test_id("sheet-activity-line").evaluate_all(
        "els => els.map(e => ({ tone: e.dataset.tone, text: e.innerText }))")
    page.screenshot(path=str(SHOTS / "desk-ports-activity.png"))
    page.locator('[data-testid="sheet-tab"][data-tab="whatwhere"]').click()
    page.get_by_test_id("sheet-section").wait_for(state="visible", timeout=5000)
    page.locator('[data-testid="sheet-section"] [data-testid="lineage-retried-as"]').first.wait_for(state="visible", timeout=8000)
    retried = page.locator('[data-testid="sheet-section"] [data-testid="lineage-retried-as"]').all_inner_texts()
    page.keyboard.press("Escape")
    check("activity", len(lines) >= 1 and all(l["tone"] in ("info", "work", "gate", "fail", "human") for l in lines)
          and not any("sessionStarted" in l["text"] or "sessionFailed" in l["text"] for l in lines)
          and any("Run failed" in l["text"] for l in lines), lines=lines)
    check("retried-as", any("r-retry" in t for t in retried), retried=retried)

    def studio_tab() -> dict:
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(600)
        page.get_by_test_id("desk-sheet-open").click()
        page.get_by_test_id("sheet").wait_for(state="visible", timeout=5000)
        page.locator('[data-testid="sheet-tab"][data-tab="studio"]').click()
        # The daemon's own lines need the fixture's diagnostics (desk_sheets proves them); the spend
        # line is the store's fold and is said either way.
        page.get_by_test_id("sheet-studio").wait_for(state="visible", timeout=8000)
        page.wait_for_timeout(800)
        loc = page.get_by_test_id("sheet-studio-spend")
        out = {"count": loc.count(), "text": loc.first.inner_text() if loc.count() else None}
        page.keyboard.press("Escape")
        return out

    no_frames = studio_tab()
    set_fixture(origin, usage_ws=True)
    framed = None
    for _ in range(3):
        framed = studio_tab()
        if framed["count"] == 1:
            break
    page.screenshot(path=str(SHOTS / "desk-ports-spend.png"))
    set_fixture(origin, usage_ws=False)
    check("spend", no_frames["count"] == 0 and framed is not None and framed["count"] == 1
          and framed["text"].startswith("$") and framed["text"].endswith(" observed this session"),
          no_frames=no_frames, framed=framed)

    # ── 5. the rail logo ──────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-brand").wait_for(state="visible", timeout=15000)
    dot_before = page.get_by_test_id("desk-rail-logo").count()
    logo = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCAzMiI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjMyIiBmaWxsPSIjMGU3NDkwIi8+PC9zdmc+"
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "logo_url": logo})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-logo").wait_for(state="visible", timeout=15000)
    box = page.get_by_test_id("desk-rail-logo").bounding_box()
    dots = page.locator('[data-testid="desk-rail-brand"] .wk-desk-dot').count()
    page.screenshot(path=str(SHOTS / "desk-ports-logo.png"))
    set_fixture(origin, appearance=None)
    check("logo", dot_before == 0 and box is not None and round(box["width"]) == 32 and round(box["height"]) == 32 and dots == 0,
          dot_before=dot_before, box=box, dots=dots)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
