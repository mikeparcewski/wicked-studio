#!/usr/bin/env python3
"""
ux2_sliceBC_test.py — the DES-UX-002 slice-BC gate: the work chronicle (§3).

Runs against the shared W2 fixture with the `chronicle` + `project_dto`
corpora on (real wire shapes only): auth-refactor's membership carries a
3-LINK retry chain (r-auth failed → r-retry failed, attempt 1 → r-retry2
completed, attempt 2 — `retry_of` is the api-types 0.8.0 DTO echo) plus a
standalone in-progress episode (r-hooks), the audit trail serves REAL
gate.decided entries (routes.ts:983 detail {approve, amend?, status}) and
honours `?action=`, and r-unfiled rides the run list as the UNFILED episode
that must never leak into a project's chronicle.

The §3.5 DOM ACs, mapped (the fixture's chain is the AC's A→B pair EXTENDED
to three links per the slice brief, so the pinned "attempt 2" sub-row is
r-retry — the middle attempt):

  1. grouping (EC50): the chronicle renders exactly 2 chain cards for the 4
     scoped runs — one 3-attempt episode (header names `3 attempts`), one
     solo card; retry siblings are SUB-ROWS, never peer rows; sub-rows list
     attempts 1..3 in order (r-auth, r-retry, r-retry2);
  2. `[data-testid="attempt-row"][data-attempt="2"]`'s
     `[data-testid="view-timeline"]` navigates to run B's (r-retry's)
     evidence timeline route;
  3. the current-state strip renders the last completed run's criterion
     phrase (off r-retry2's durable gateEvaluated tail) + `3 phases`; on a
     project with NO completed run (upload-endpoint) it renders the EXACT
     no-run copy (EC53 — never a fabricated state);
  4. the guidance panel is gesture-gated: ZERO /audit requests on chronicle
     mount; the explicit open fires EXACTLY ONE GET /audit?action=gate.decided
     (request-tap), and the rows are the project's amendments only — the
     foreign-project amend and the no-amend reject are filtered client-side;
  5. "use in next run" opens the composer with the amendment text in
     `[data-testid="steer-prefill"]`; the launch POST carries the fold
     (problem + the labelled Operator guidance paragraph).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-BC-chronicle.png       the chronicle: state strip, 2 episode cards,
                            gesture-gated guidance panel
  ux-BC-chain-expanded.png  the 3-attempt episode expanded into sub-rows
  ux-BC-guidance-panel.png  the guidance summary opened, amendments listed

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 (ensure_build CACHES — delete a stale dist-sameorigin/
when the source changed). Env knobs: FEEDBACK_PORT (default 4408),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import parse_qs, urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4408"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

PROJECT = "auth-refactor"
BUILD_TAB = f"/p/{PROJECT}/build"
CRITERION = "auth middleware refactor passes the full test suite"
AMEND_AUTH = "focus on the middleware tests, skip the docs pass"
AMEND_TIP = "keep the session-token API unchanged; refactor only the middleware layer"
AMEND_FOREIGN = "rate-limit by API key, not by IP"
NO_RUN_COPY = ("No completed run yet — this project's first successful build "
               "will appear here.")
LAUNCH_INTENT = "tighten the retry backoff for auth"

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


# ── 1. The same-origin build + the shared W2 fixture, chronicle corpus ON ──────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, chronicle=True, project_dto=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap: every audit read (with its query), every per-run events
    # read, every launch POST body.
    audit_reads: list[dict] = []
    event_reads: list[str] = []
    launch_posts: list[dict] = []

    def on_request(req):
        u = urlparse(req.url)
        if req.method == "GET" and u.path == "/api/v1/audit":
            q = parse_qs(u.query)
            audit_reads.append({"action": (q.get("action") or [""])[0],
                                "runId": (q.get("runId") or [""])[0]})
        elif req.method == "GET" and u.path.startswith("/api/v1/runs/") \
                and u.path.endswith("/events"):
            event_reads.append(u.path.split("/")[4])
        elif req.method == "POST" and u.path == "/api/v1/runs":
            try:
                launch_posts.append(json.loads(req.post_data or "{}"))
            except ValueError:
                launch_posts.append({"unparseable": req.post_data})

    page.on("request", on_request)

    def goto(path: str) -> None:
        page.goto(f"{ORIGIN}{path}", wait_until="domcontentloaded")
        page.add_style_tag(content=HIDE_GATE_TOASTS)

    def open_chronicle() -> None:
        page.locator('[data-testid="build-dashboard"]').wait_for(timeout=30000)
        page.locator('[data-testid="build-view-chronicle"]').click()
        page.locator('[data-testid="work-chronicle"]').wait_for(timeout=15000)

    # ── Scene 1 (AC 1, EC50): grouping — 2 chain cards for 4 scoped runs ────────
    goto(BUILD_TAB)
    open_chronicle()
    page.wait_for_function(
        """() => document.querySelectorAll('[data-testid="episode-chain"]').length === 2""",
        timeout=15000)
    cards = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="episode-chain"]'))
                 .map(c => ({ attempts: c.dataset.attempts, status: c.dataset.chainStatus,
                              expanded: c.dataset.expanded,
                              header: c.querySelector('[data-testid="chain-header"]')
                                ?.innerText.replace(/\\s+/g, ' ') ?? '' }))""")
    chain = next((c for c in cards if c["attempts"] == "3"), None)
    solo = next((c for c in cards if c["attempts"] == "1"), None)
    check("chain_grouping_ec50",
          len(cards) == 2 and chain is not None and solo is not None
          # the resolved 3-link chain: completed (r-retry2 completed ⇒ any-completed),
          # quiet posture (ships collapsed); header names the attempt count.
          and chain["status"] == "completed" and chain["expanded"] == "false"
          and "3 attempts" in chain["header"]
          and "refactor the auth middleware" in chain["header"]
          # the in-progress solo episode ships expanded.
          and solo["status"] == "executing" and solo["expanded"] == "true"
          and "add pre-commit hooks" in solo["header"],
          cards=cards)

    # The unfiled episode (r-unfiled, project_id: null) never leaks into a
    # project's chronicle; the retry siblings never render as peer cards.
    leak = page.evaluate(
        """() => (document.querySelector('[data-testid="work-chronicle"]')
                  ?.innerText ?? '').includes('poke at the flaky CI job')""")
    check("unfiled_episode_never_leaks", not leak)

    # ── Scene 2 (AC 3): the current-state strip — criterion phrase + phases ─────
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="chronicle-state"]')
                  ?.innerText ?? '').includes('passed:')""",
        timeout=15000)
    strip = page.evaluate(
        """() => ({ empty: document.querySelector('[data-testid="chronicle-state"]')
                      ?.dataset.empty ?? null,
                    text: document.querySelector('[data-testid="chronicle-state"]')
                      ?.innerText.replace(/\\s+/g, ' ') ?? '' })""")
    check("state_strip_criterion",
          strip["empty"] == "false"
          and "Last completed run:" in strip["text"]
          and "3 phases" in strip["text"]
          and CRITERION in strip["text"]
          and "wf-w2" in strip["text"]
          # the derivation read the TIP run's durable tail — the sanctioned read.
          and event_reads.count("r-retry2") >= 1,
          **strip, event_reads=event_reads)

    # AC 4's first half: the guidance panel fired ZERO audit reads on mount.
    check("guidance_gesture_gated_mount", len(audit_reads) == 0, audit_reads=audit_reads)
    page.screenshot(path=str(VSHOTS / "ux-BC-chronicle.png"))

    # ── Scene 3 (AC 1 sub-rows + AC 2): expand the chain, walk the attempts ─────
    chain_sel = '[data-testid="episode-chain"][data-attempts="3"]'
    page.locator(f'{chain_sel} [data-testid="chain-header"]').click()
    page.locator(f'{chain_sel} [data-testid="attempt-row"]').first.wait_for(timeout=10000)
    rows = page.evaluate(
        f"""() => Array.from(document.querySelectorAll(
                    '{chain_sel} [data-testid="attempt-row"]'))
                  .map(r => ({{ attempt: r.dataset.attempt, run: r.dataset.runId,
                                text: r.innerText.replace(/\\s+/g, ' ') }}))""")
    check("attempt_subrows_in_order",
          [r["attempt"] for r in rows] == ["1", "2", "3"]
          and [r["run"] for r in rows] == ["r-auth", "r-retry", "r-retry2"]
          and "failed" in rows[0]["text"] and "failed" in rows[1]["text"]
          and "done" in rows[2]["text"],
          rows=rows)
    page.screenshot(path=str(VSHOTS / "ux-BC-chain-expanded.png"))

    # AC 2: attempt 2's "view timeline" navigates to run B's evidence timeline.
    page.locator(f'{chain_sel} [data-testid="attempt-row"][data-attempt="2"] '
                 '[data-testid="view-timeline"]').click()
    page.wait_for_function(
        """() => window.location.pathname === '/runs/r-retry/timeline'""", timeout=10000)
    page.locator('[data-testid="thread"]').wait_for(timeout=15000)
    check("view_timeline_navigates", True,
          pathname=page.evaluate("() => window.location.pathname"))

    # ── Scene 4 (AC 3, EC53): the honest empty state — no completed run ─────────
    goto("/p/upload-endpoint/build")
    open_chronicle()
    empty = page.evaluate(
        """() => ({ empty: document.querySelector('[data-testid="chronicle-state"]')
                      ?.dataset.empty ?? null,
                    text: document.querySelector('[data-testid="chronicle-state"]')
                      ?.innerText.trim() ?? '' })""")
    check("state_strip_honest_empty",
          empty["empty"] == "true" and empty["text"] == NO_RUN_COPY, **empty)

    # ── Scene 5 (AC 4): the gesture-gated audit fan-out + the scope filter ──────
    goto(BUILD_TAB)
    open_chronicle()
    # Scene 3's run-detail visit legitimately read `?runId=r-retry` (the
    # What/Where provenance line, slice V) — the guidance panel's OWN request
    # signature is `?action=gate.decided`, and there must be NONE before the
    # explicit open gesture.
    def gate_reads() -> list:
        return [a for a in audit_reads if a["action"] == "gate.decided"]

    check("zero_guidance_reads_before_open", len(gate_reads()) == 0,
          audit_reads=audit_reads)
    page.locator('[data-testid="guidance-open"]').click()
    page.locator('[data-testid="guidance-row"]').first.wait_for(timeout=10000)
    rows = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="guidance-row"]'))
                 .map(r => r.innerText.replace(/\\s+/g, ' '))""")
    check("guidance_one_request_scoped_rows",
          gate_reads() == [{"action": "gate.decided", "runId": ""}]
          and len(rows) == 2
          and AMEND_TIP in rows[0] and "approved" in rows[0]
          and AMEND_AUTH in rows[1] and "approved" in rows[1]
          # the foreign-project amend and the no-amend reject never render.
          and all(AMEND_FOREIGN not in t for t in rows)
          and all("rejected" not in t for t in rows),
          audit_reads=audit_reads, rows=rows)
    page.screenshot(path=str(VSHOTS / "ux-BC-guidance-panel.png"))

    # ── Scene 6 (AC 5): "use in next run" — the composer steer prefill ──────────
    page.locator('[data-testid="guidance-row"]').nth(1) \
        .locator('[data-testid="guidance-use"]').click()
    page.wait_for_function(
        f"""() => window.location.pathname === '{BUILD_TAB}/new'""", timeout=10000)
    page.locator('[data-testid="steer-prefill"]').wait_for(timeout=10000)
    prefill = page.evaluate(
        """() => ({ steer: document.querySelector('[data-testid="steer-prefill"]')?.value ?? null,
                    bound: document.querySelector('[data-testid="launch-project-row"]')
                      ?.innerText ?? '' })""")
    check("steer_prefill_populated",
          prefill["steer"] == AMEND_AUTH and PROJECT in prefill["bound"], **prefill)

    # The launch folds the guidance into the problem body, visibly labelled —
    # LaunchRunBody carries no guidance key until CREW-UX-4 (§7.2).
    page.locator('[data-testid="launch-problem"]').fill(LAUNCH_INTENT)
    page.locator('[data-testid="launch-submit"]').click()
    page.wait_for_function(
        f"""() => window.location.pathname.startsWith('{BUILD_TAB}/r-launched-')""",
        timeout=15000)
    check("launch_carries_guidance_fold",
          len(launch_posts) == 1
          and launch_posts[0].get("problem")
              == f"{LAUNCH_INTENT}\n\nOperator guidance: {AMEND_AUTH}"
          and launch_posts[0].get("projectId") == PROJECT,
          posts=launch_posts)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
