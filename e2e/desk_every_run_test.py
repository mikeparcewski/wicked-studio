#!/usr/bin/env python3
"""
desk_every_run_test.py — SEE EVERYTHING › Sessions › "Every run" (S17b) at 1440x700 under
STUDIO_SKIN=desk.

Against the in-process fixture (wave-1 + wave-2b corpus) with runs_delay_ms=3000, plus a Playwright
route on GET /runs that synthesizes a 1200-run list over the fixture's own answer. The daemon serves
archived runs only on `GET /runs?include=archived`; `POST /runs/:id/archive {archived:false}` flips
the one archived synthetic row.

  1. checking-visible — "Reading your work…" shows while GET /runs is in flight (the 3 s delay).
  2. paint-within-1s — the table paints within 1 s of GET /runs answering (measured, pasted).
  3. run-count — the tab header says "1200 runs" (data-runs ≥ 1200), never waiting on the fan-out.
  4. sort-col — the Title column header sorts the rows and flips aria-sort when clicked twice.
  5. filter-text — a text filter narrows to one known synthetic run, then clears.
  6. last-page — paging to the last page works; the pager names the page and rows remain.
  7. archived-lens — the Archived chip reads GET /runs?include=archived and lists the archived row.
  8. unarchive — Unarchive POSTs {archived:false}; the row leaves.
  9. grouped-unchanged — ?tab=sessions (no ?view=) still renders the grouped sessions, not the table.

Captures: e2e/shots/desk-every-run-*.png. Env: FEEDBACK_PORT (default 4486). Prints a JSON report;
exit 0/1.
"""

import json
import os
import re
import sys
import time

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4486"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
EXTRA = 1200
ARCHIVED_EXTRA_ID = "r-extra-archived-1"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok and os.environ.get("DESK_ALL") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
state = {"runs_gets": 0, "archive_posts": [], "fulfill_time": None}

STATUSES = ["executing", "completed", "cancelled", "failed", "awaiting_human"]
PROJECTS = ["alpha", "beta", "gamma", None]
NOW_S = 1_760_000_000


def synth_run(i: int, *, archived: bool = False, rid: str | None = None) -> dict:
    return {"session": {
        "id": rid or f"r-extra-{i}", "workflow_id": f"wf-{i % 5}",
        "problem": f"Extra run number {i}",
        "status": "cancelled" if archived else STATUSES[i % 5],
        "project_id": PROJECTS[i % 4],
        "created_at": NOW_S + i,
        "ended_at": NOW_S + i + 600 if i % 5 in (1, 3) else None,
        "finished_at": None,
        "repo_ref": f"repo-{i % 3}" if i % 3 != 0 else None,
        "archived_at": (NOW_S + 1) if archived else None, "archive_note": None,
        "entity_mode": "shared", "collection_scope": None, "clis": ["claude"],
        "human_confirm": "none", "unit_ix": 0, "attempt": 0,
        "workdir": None, "extra_write_roots": [],
    }, "units": []}


def route_runs(route):
    req = route.request
    if req.method != "GET":
        route.fallback()
        return
    state["runs_gets"] += 1
    include = "include=archived" in req.url
    res = route.fetch()
    body = res.json()
    injected = [synth_run(i) for i in range(EXTRA)]
    if include:
        injected.append(synth_run(9999, archived=True, rid=ARCHIVED_EXTRA_ID))
    body["runs"] = list(body.get("runs", [])) + injected
    state["fulfill_time"] = time.monotonic()
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def route_archive(route):
    body = json.loads(route.request.post_data or "{}")
    state["archive_posts"].append(body)
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"runId": ARCHIVED_EXTRA_ID, "archived": body.get("archived", True)}))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True, wave2b=True, runs_delay_ms=3000)
    page.route("**/api/v1/runs", route_runs)
    page.route("**/api/v1/runs?*", route_runs)
    page.route(f"**/api/v1/runs/{ARCHIVED_EXTRA_ID}/archive", route_archive)

    # ── 1. "Reading your work…" is visible while GET /runs is in flight ───────────────────────
    page.goto(f"{origin}/everything?tab=sessions&view=runs", wait_until="domcontentloaded")
    checking_visible = False
    for _ in range(25):
        if page.get_by_test_id("everything-checking").is_visible():
            checking_visible = True
            break
        if page.locator('[data-testid="runs-row"]').count() > 0:
            break
        page.wait_for_timeout(100)
    check("checking-visible", checking_visible, checking=checking_visible)

    # ── 2. the table paints within 1 s of GET /runs answering ────────────────────────────────
    page.locator('[data-testid="runs-row"]').first.wait_for(state="visible", timeout=10000)
    paint_delta_ms = (time.monotonic() - (state["fulfill_time"] or time.monotonic())) * 1000
    page.screenshot(path=str(SHOTS / "desk-every-run-table.png"))
    check("paint-within-1s", paint_delta_ms < 1000, paint_delta_ms=round(paint_delta_ms))

    # ── 3. the count says ≥ 1200 runs ────────────────────────────────────────────────────────
    count_el = page.get_by_test_id("everything-count")
    runs_attr = int(count_el.get_attribute("data-runs") or "0")
    page_rows = page.locator('[data-testid="runs-row"]').count()
    check("run-count", runs_attr >= EXTRA and page_rows == 100,
          runs_attr=runs_attr, text=count_el.inner_text()[:80], page_rows=page_rows)

    # ── 4. clicking the Title column sorts, and a second click flips the direction ────────────
    col_title = page.locator('[data-testid="runs-col"][data-key="title"]')
    col_title.click()
    page.wait_for_timeout(200)
    first_asc = page.locator('[data-testid="runs-row"]').first.inner_text().replace("\n", " ")
    aria_asc = col_title.get_attribute("aria-sort")
    col_title.click()
    page.wait_for_timeout(200)
    first_desc = page.locator('[data-testid="runs-row"]').first.inner_text().replace("\n", " ")
    aria_desc = col_title.get_attribute("aria-sort")
    check("sort-col",
          aria_asc == "ascending" and aria_desc == "descending" and first_asc != first_desc,
          aria_asc=aria_asc, aria_desc=aria_desc, first_asc=first_asc[:50], first_desc=first_desc[:50])

    # ── 5. a text filter narrows to one known synthetic run, then clears ─────────────────────
    page.locator('[data-testid="runs-filter"]').fill("r-extra-999")
    page.wait_for_timeout(300)
    filtered_count = page.locator('[data-testid="runs-row"]').count()
    page.locator('[data-testid="runs-filter"]').fill("")
    page.wait_for_timeout(200)
    full_count = page.locator('[data-testid="runs-row"]').count()
    check("filter-text", filtered_count == 1 and full_count == 100,
          filtered=filtered_count, full=full_count)

    # ── 6. paging to the last page works ─────────────────────────────────────────────────────
    nxt = page.get_by_test_id("runs-pager-next")
    for _ in range(20):
        if nxt.is_disabled():
            break
        nxt.click()
        page.wait_for_timeout(60)
    pager_text = page.get_by_test_id("runs-pager-at").inner_text().lower()
    rows_on_last = page.locator('[data-testid="runs-row"]').count()
    page.screenshot(path=str(SHOTS / "desk-every-run-last-page.png"))
    check("last-page", bool(re.search(r"page \d+ of \d+", pager_text)) and rows_on_last > 0 and nxt.is_disabled(),
          pager=pager_text[:60], rows=rows_on_last)

    # ── 7. the Archived lens reads GET /runs?include=archived and lists the archived row ──────
    page.goto(f"{origin}/everything?tab=sessions&view=runs", wait_until="domcontentloaded")
    page.locator('[data-testid="runs-row"]').first.wait_for(state="visible", timeout=10000)
    page.get_by_test_id("everything-filter").filter(has_text="Archived").click()
    arch_row = page.locator(f'[data-testid="runs-row"][data-run-id="{ARCHIVED_EXTRA_ID}"]')
    arch_row.wait_for(state="visible", timeout=10000)
    page.screenshot(path=str(SHOTS / "desk-every-run-archived.png"))
    check("archived-lens", arch_row.count() == 1, rows=page.locator('[data-testid="runs-row"]').count())

    # ── 8. Unarchive POSTs {archived:false}; the row leaves ──────────────────────────────────
    arch_row.get_by_test_id("everything-unarchive").click()
    arch_row.wait_for(state="hidden", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-every-run-unarchive.png"))
    check("unarchive", state["archive_posts"] == [{"archived": False}], posts=state["archive_posts"])

    # ── 9. grouped stays the default (no ?view=): the sessions groups render, not the table ───
    page.goto(f"{origin}/everything?tab=sessions", wait_until="networkidle")
    page.locator('[data-testid="everything-group"]').first.wait_for(state="visible", timeout=15000)
    has_groups = page.locator('[data-testid="everything-group"]').count() > 0
    no_table = page.locator('[data-testid="runs-row"]').count() == 0
    check("grouped-unchanged", has_groups and no_table, groups=has_groups, table_absent=no_table)

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors[:5], overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
