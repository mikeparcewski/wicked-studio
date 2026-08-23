#!/usr/bin/env python3
"""
ux_sliceS_test.py — the DES-UX-001 slice-S gate: project scoping that means it
(§2, the campaign's A2 CRITICAL — "runs launched with a project selected record
as 'Unfiled'… footer counters remain global inside project views").

Runs against the shared W2 fixture with its `project_dto` corpus on (real wire
shapes only, CREW-UX-2 / api-types 0.8.0): every run DTO carries `project_id`
(a string echoed from the membership record, or null = GENUINELY unfiled),
r-unfiled rides the list with a null claim and NO membership record, and
POST /api/v1/runs is a real launch — `{runId}` answered, the run atomically
filed into `body.projectId` and echoed back on the next GET /runs.

The §2.5 DOM ACs, verbatim mapping:

  1. launching from `/p/upload-endpoint/build/new` with the chip set: the POST
     body carries `projectId`, the created run reaches the client within one
     live-update cycle WITHOUT a reload (the always-mounted bottom bar's
     `data-working` bumps), and on the project's Build tab
     `[data-testid="project-run-count"]` equals the rendered
     `[data-testid="build-run-row"]` count — SET-equal (EC34): both named
     intents present, every foreign intent absent;
  2. entry points entered from a project context pre-bind: the rail's Make ＋
     Build tine and Chat ＋ land on `/p/:id/{build,chat}/new`, the palette's
     "New Build" verb the same, and Repositories ＋ lands on
     `/repos/new?project=:id` where the register form's ProjectSwitcher
     renders `data-locked="true"` naming the project — never Unfiled;
  3. the footer bar carries `data-scope="project"` inside the shell with
     counters scoped to ITS runs (1/0/0 for upload-endpoint), and
     `data-scope="global"` on `/` with the whole-fixture counts (2/2/2 —
     r-unfiled counts as working GLOBALLY, never inside a project);
  4. with the DTO echo present, project attribution costs ZERO extra membership
     fetches: no /members path is read again after the mount passes settle
     (the pre-S unplaced-run re-read must NOT fire for r-unfiled or the
     launched run), and opening the runs sheet — whose rows render project
     names — fires zero /members requests;
  + the home board's "not in a project" shelf is the DAEMON's unfiled set:
    exactly r-unfiled (`project_id: null`), never a failed-join artifact.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-S-project-scoped.png   /p/upload-endpoint/build after the launch: the
                            scoped list (2 rows), the EC34 count beside it,
                            the project-scoped footer bar

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4377),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4377"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

PROJECT = "upload-endpoint"
BUILD_TAB = f"/p/{PROJECT}/build"
LAUNCH_FORM = f"{BUILD_TAB}/new"
LAUNCH_INTENT = "wire the retry backoff"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


# ── 1. The same-origin build + the shared W2 fixture, project_dto ON ────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
# orphan=False: r-orphan (a membership-less executing run) would be a SECOND
# genuinely-unfiled row under DTO truth — one null-claim run (r-unfiled) keeps
# every count in this rig's scenes deterministic and singular.
set_fixture(ORIGIN, project_dto=True, orphan=False)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap: every membership read and every launch POST body.
    member_reads: list[str] = []
    launch_posts: list[dict] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "GET" and re.search(r"/api/v1/projects/[^/]+/members$", path):
            member_reads.append(path)
        elif req.method == "POST" and path == "/api/v1/runs":
            try:
                launch_posts.append(json.loads(req.post_data or "{}"))
            except ValueError:
                launch_posts.append({"unparseable": req.post_data})

    page.on("request", on_request)

    def member_counts() -> dict:
        counts: dict = {}
        for pth in member_reads:
            counts[pth] = counts.get(pth, 0) + 1
        return counts

    def goto(path: str) -> None:
        page.goto(f"{ORIGIN}{path}", wait_until="domcontentloaded")
        page.add_style_tag(content=HIDE_GATE_TOASTS)

    def bar() -> dict:
        return page.evaluate(
            """() => { const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                       return b ? { scope: b.dataset.scope, working: b.dataset.working,
                                    gates: b.dataset.gates, failed: b.dataset.failed } : null; }""")

    # ── Scene 1 (AC 3 global + the shelf): `/` — global scope, daemon-truth
    #    unfiled ────────────────────────────────────────────────────────────────
    goto("/")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.wait_for_function(
        """() => { const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                   return !!b && b.dataset.working === '2'
                       && b.dataset.gates === '2' && b.dataset.failed === '2'; }""",
        timeout=15000)
    check("global_scope_counters", (bar() or {}).get("scope") == "global", **(bar() or {}))

    # The shelf is the DTO-null set: exactly r-unfiled, off daemon truth — the
    # membership-joined seven never look unfiled.
    page.locator('[data-testid="band-not-in-project"]').wait_for(timeout=15000)
    # The shelf ships collapsed (F5: it can never lead a real project) — expand
    # it to read the rows.
    page.locator('[data-testid="band-not-in-project-toggle"]').click()
    page.locator('[data-testid="unfiled-run"]').first.wait_for(timeout=5000)
    shelf = page.evaluate(
        """() => { const band = document.querySelector('[data-testid="band-not-in-project"]');
                   return { count: band?.dataset.count ?? null,
                            rows: Array.from(document.querySelectorAll(
                              '[data-testid="unfiled-run"]')).map(r => r.innerText) }; }""")
    check("unfiled_is_daemon_truth", shelf["count"] == "1"
          and any("poke at the flaky CI job" in t for t in shelf["rows"]), **shelf)

    # ── Scene 2 (AC 4): the DTO claim costs zero placement re-reads — after the
    #    mount passes settle, NO /members path is read again (pre-S, r-unfiled
    #    would have triggered a full re-read pass) ───────────────────────────────
    page.wait_for_timeout(2500)
    settled_counts = member_counts()
    page.wait_for_timeout(2000)
    late_counts = member_counts()
    check("no_membership_rereads", late_counts == settled_counts,
          paths_read=len(settled_counts),
          max_reads_per_path=max(settled_counts.values(), default=0))

    # Opening the runs sheet — whose rows render project names — fires ZERO
    # membership fetches: the labels come off the DTO claim + the projects
    # store (§2.5's request-tap AC). r-unfiled's label is honestly blank.
    before_sheet = len(member_reads)
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-sheet-row"]').first.wait_for(timeout=10000)
    sheet = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="runs-sheet-row"]'))
                 .map(r => ({ text: r.innerText.replace(/\\s+/g, ' '),
                              project: r.querySelector(
                                '[data-testid="runs-sheet-row-project"]')?.textContent ?? null }))""")
    unfiled_row = next((r for r in sheet if "poke at the flaky CI job" in r["text"]), None)
    filed_row = next((r for r in sheet if "add rate-limiting" in r["text"]), None)
    check("sheet_labels_zero_fetches",
          len(member_reads) == before_sheet
          and unfiled_row is not None and (unfiled_row["project"] or "") == ""
          and filed_row is not None and filed_row["project"] == PROJECT,
          new_member_reads=len(member_reads) - before_sheet,
          unfiled_row=unfiled_row, filed_row=filed_row)
    page.locator('[data-testid="runs-sheet-collapse"]').click()

    # ── Scene 3 (AC 3 project): inside the shell the bar scopes to ITS runs —
    #    and the Build tab's gate inbox never shows a foreign gate ───────────────
    goto(BUILD_TAB)
    page.locator('[data-testid="build-dashboard"]').wait_for(timeout=30000)
    page.wait_for_function(
        """() => { const b = document.querySelector('[data-testid="runs-bottom-bar"]');
                   return !!b && b.dataset.scope === 'project'
                       && b.dataset.working === '1' && b.dataset.gates === '0'
                       && b.dataset.failed === '0'; }""",
        timeout=15000)
    scoped = page.evaluate(
        """() => ({
             rows: Array.from(document.querySelectorAll('[data-testid="build-run-row"]'))
               .map(r => r.innerText.replace(/\\s+/g, ' ')),
             count: document.querySelector('[data-testid="project-run-count"]')
               ?.textContent ?? null,
             gateInbox: !!document.querySelector('[data-testid="gate-inbox"]'),
           })""")
    check("project_scope_before_launch",
          (bar() or {}).get("scope") == "project"
          and scoped["count"] == "1" and len(scoped["rows"]) == 1
          and "add rate-limiting" in scoped["rows"][0]
          and not scoped["gateInbox"],  # the 2 global gates are FOREIGN here
          **scoped, bar=bar())

    # ── Scene 4 (AC 2): every entry point carries the ambient binding ───────────
    # The rail's Make ＋ Build tine → the pre-bound form.
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-new"]').click()
    page.locator('[data-testid="make-picker-row"][data-mode="build"]').wait_for(timeout=5000)
    page.locator('[data-testid="make-picker-row"][data-mode="build"]').click()
    page.wait_for_function(
        f"""() => window.location.pathname === '{LAUNCH_FORM}'""", timeout=10000)
    make_build_ok = True

    # The rail's Chat ＋ → the project's chat form.
    goto(BUILD_TAB)
    page.locator('[data-testid="left-rail"]').wait_for(timeout=30000)
    page.locator('[data-testid="rail-heading-chat"] [data-testid="heading-new"]').click()
    page.wait_for_function(
        f"""() => window.location.pathname === '/p/{PROJECT}/chat/new'""", timeout=10000)
    chat_plus_ok = True

    # The palette's "New Build" verb — the same shared spelling.
    goto(BUILD_TAB)
    page.locator('[data-testid="build-dashboard"]').wait_for(timeout=30000)
    page.keyboard.press("Control+p")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000)
    page.keyboard.type("> new build")
    page.keyboard.press("Enter")
    page.wait_for_function(
        f"""() => window.location.pathname === '{LAUNCH_FORM}'""", timeout=10000)
    palette_build_ok = True

    # Repositories ＋ → the ?project= carry; the register form pre-binds + LOCKS.
    goto(BUILD_TAB)
    page.locator('[data-testid="left-rail"]').wait_for(timeout=30000)
    page.locator('[data-testid="rail-heading-repos"] [data-testid="heading-new"]').click()
    page.wait_for_function(
        f"""() => window.location.pathname === '/repos/new'
              && window.location.search === '?project={PROJECT}'""", timeout=10000)
    page.locator('[data-testid="project-switcher"]').wait_for(timeout=10000)
    register = page.evaluate(
        f"""() => {{ const sw = document.querySelector('[data-testid="project-switcher"]');
                     return {{ locked: sw?.querySelector('[data-locked]')?.dataset.locked
                                 ?? sw?.dataset.locked ?? null,
                               lockedAnywhere: !!document.querySelector(
                                 '[data-testid="project-switcher"] [data-locked="true"], '
                                 + '[data-testid="project-switcher"][data-locked="true"]'),
                               names: sw?.innerText ?? '' }}; }}""")
    check("entry_points_carry_binding",
          make_build_ok and chat_plus_ok and palette_build_ok
          and register["lockedAnywhere"] and PROJECT in register["names"],
          register=register)

    # ── Scene 5 (AC 1): the launch — chip set, POST carries the binding, the
    #    run reaches the client within one live-update cycle, no reload ─────────
    goto(LAUNCH_FORM)
    page.locator('[data-testid="launch-problem"]').wait_for(timeout=30000)
    prebound = page.evaluate(
        """() => { const row = document.querySelector('[data-testid="launch-project-row"]');
                   return { lockedShown: !!row?.querySelector('[data-locked="true"]'),
                            text: row?.innerText ?? '' }; }""")
    check("launch_form_prebound", prebound["lockedShown"] and PROJECT in prebound["text"],
          **prebound)

    pre_launch_members = len(member_reads)
    page.locator('[data-testid="launch-problem"]').fill(LAUNCH_INTENT)
    page.locator('[data-testid="launch-submit"]').click()
    # onLaunched navigates INTO the run (SPA — no reload) and refreshes the run
    # list; the always-mounted bar's scoped working count bumps 1 → 2 within
    # one live-update cycle.
    page.wait_for_function(
        f"""() => window.location.pathname.startsWith('{BUILD_TAB}/r-launched-')""",
        timeout=15000)
    page.wait_for_function(
        """() => document.querySelector('[data-testid="runs-bottom-bar"]')
                   ?.dataset.working === '2'""",
        timeout=15000)
    check("launch_carries_binding",
          len(launch_posts) == 1 and launch_posts[0].get("projectId") == PROJECT
          and launch_posts[0].get("problem") == LAUNCH_INTENT
          # The DTO claim placed it — the launch cost zero membership re-reads.
          and len(member_reads) == pre_launch_members,
          posts=launch_posts, new_member_reads=len(member_reads) - pre_launch_members)

    # ── Scene 6 (EC34): the Build tab shows EXACTLY its runs; the count equals
    #    the rows, set-equal, on the same paint ─────────────────────────────────
    goto(BUILD_TAB)
    page.locator('[data-testid="build-dashboard"]').wait_for(timeout=30000)
    page.wait_for_function(
        """() => document.querySelectorAll('[data-testid="build-run-row"]').length === 2""",
        timeout=15000)
    ec34 = page.evaluate(
        """() => ({
             rows: Array.from(document.querySelectorAll('[data-testid="build-run-row"]'))
               .map(r => r.innerText.replace(/\\s+/g, ' ')),
             count: document.querySelector('[data-testid="project-run-count"]')
               ?.textContent ?? null,
           })""")
    foreign = [t for t in ec34["rows"]
               if not ("add rate-limiting" in t or LAUNCH_INTENT in t)]
    check("count_equals_rows",
          ec34["count"] == "2" and len(ec34["rows"]) == 2 and foreign == []
          and any(LAUNCH_INTENT in t for t in ec34["rows"])
          and any("add rate-limiting" in t for t in ec34["rows"]),
          **ec34, foreign_rows=foreign, bar=bar())
    page.screenshot(path=str(VSHOTS / "ux-S-project-scoped.png"))

    # ── Scene 7: the scoped sheet — its rows are the project's, labeled off the
    #    DTO claim, zero membership fetches on open ──────────────────────────────
    before_sheet = len(member_reads)
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-sheet-row"]').first.wait_for(timeout=10000)
    scoped_sheet = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="runs-sheet-row"]'))
                 .map(r => ({ text: r.innerText.replace(/\\s+/g, ' '),
                              project: r.querySelector(
                                '[data-testid="runs-sheet-row-project"]')?.textContent ?? null }))""")
    check("scoped_sheet",
          len(scoped_sheet) == 2
          and all(r["project"] == PROJECT for r in scoped_sheet)
          and len(member_reads) == before_sheet,
          rows=scoped_sheet, new_member_reads=len(member_reads) - before_sheet)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
