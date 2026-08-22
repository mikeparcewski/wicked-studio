#!/usr/bin/env python3
"""
feedback3_sliceP_test.py — the DES-FEEDBACK-003 slice-P gate: the three
remaining path dashboards — /projects (§4.1), /chats (§4.3), /repos (§4.4) —
each "a combined list and reporting dashboard" (§4.5), against the shared
frozen-NOW0 W2 fixture with the slice-P switches on: `chat_runs` (2 chat runs —
one placed, one clockless legacy thread with a cached gate) and `repo_refs` +
`repo` (three runs stamped onto the registered studio-api repo).

The slice DOM ACs, from §4.5 + the §10.3 slice-P block:

  /projects (reached via the rail ▦):
  1. `[data-testid="projects-dashboard-tiles"]` renders ABOVE the register,
     every tile carrying its §4.1 `data-question` verbatim (EC19/EC28).
  2. The register is COMPLETE — every fixture project renders a card (the
     board mirror's active-only subset never truncates it) — and the create
     affordance survives.
  3. Register rows carry the 7-day ProjectSparkline where the board holds
     in-window runs; tile fills resolve from `var()` tokens (EC15).
  4. The gates tile counts every open gate (r-q3 + r-api + the chat gate);
     the outcome bar buckets on the merged attach clocks with the honest
     unplaced count; a row click lands on the project dashboard.

  /chats:
  5. `[data-testid="chats-dashboard-tiles"]` above the untouched list; the
     list is EXACTLY the isChatRun partition (2 rows); navigation there rides
     zero gesture-gated requests (no repos/health/roster/docs).
  6. Honesty: chats-over-time places only the clocked chat (total 1,
     unplaced 1); gates-from-chats counts ONLY the chat gate (1) and never
     the build gates; search still filters; a row click opens the thread.

  /repos:
  7. `[data-testid="repos-dashboard-tiles"]` above the register; runs-per-repo
     groups the three stamped runs onto studio-api; failing-repos flags the
     24h failure; repo-count counts the register.
  8. The fetch budget: the visit costs exactly the page's own GET /repos +
     GET /runs (plus the rail accordion's one cached GET /repos on expand) and
     ZERO per-repo graph GETs — the old Tracked-card fan-out is retired.
     Register/search/add affordances survive; a card click lands on the
     detail page.

Captures (§10.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback3-P-projects-dashboard.png  tile band above the complete register
  feedback3-P-chats-dashboard.png     tile band above the chat partition
  feedback3-P-repos-dashboard.png     tile band above the repo register

Finally: `npm run lint` must exit 0 with zero raw-color findings (EC15).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK3P_PORT (default 4364),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    NPM,
    PROJECTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK3P_PORT = int(os.environ.get("FEEDBACK3P_PORT", "4364"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK3P_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
ALL_PROJECT_IDS = {p["id"] for p in PROJECTS}
CHAT_GATE_PROMPT = "Pick the auth flow the chat should explore"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches) ──────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture; the slice-P switches on ─────────────────────────
start_server(FEEDBACK3P_PORT, dist)
set_fixture(ORIGIN, chat_runs=True, repo_refs=True, repo=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []
api_paths: list[str] = []


def n_of(pred) -> int:
    return sum(1 for p in api_paths if pred(p))


def n_repos() -> int:
    return n_of(lambda p: p == "/api/v1/repos")


def n_graph() -> int:
    return n_of(lambda p: p.startswith("/api/v1/repos/") and p.endswith("/graph"))


def n_gesture_gated() -> tuple:
    """The endpoints /chats must NOT touch: repos, health, roster, doc lists."""
    return (
        n_repos(),
        n_of(lambda p: p == "/api/v1/health"),
        n_of(lambda p: p == "/api/v1/roster"),
        n_of(lambda p: p.endswith("/interactive/api/docs")),
    )


QUESTIONS_JS = """(band) =>
    Object.fromEntries(Array.from(band.querySelectorAll('[data-question]'))
        .map(el => [el.dataset.testid, el.dataset.question]))"""


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: api_paths.append(urlparse(r.url).path)
            if "/api/v1/" in r.url and r.method == "GET" else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.wait_for_timeout(2500)  # let the mount reads + gate backfills settle

    # ── ACs 1–4: /projects, reached through its rail ▦ ─────────────────────────
    page.locator('[data-testid="rail-heading-projects"] [data-testid="heading-dashboard"]').click()
    page.locator('[data-testid="projects-dashboard-tiles"]').wait_for(timeout=30000)
    page.locator('[data-testid="projects-list"]').wait_for(timeout=30000)
    # The page's own board model settles when the split tile counts the board.
    page.wait_for_function(
        """() => document.querySelector('[data-testid="attention-split-tile"]')
                 ?.dataset.total === '28'""", timeout=30000)
    page.wait_for_timeout(1000)

    projects_facts = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const band = q('[data-testid="projects-dashboard-tiles"]');
             const list = q('[data-testid="projects-list"]');
             const cards = Array.from(document.querySelectorAll('[data-testid="project-card"]'));
             const split = q('[data-testid="attention-split-tile"]');
             const bar = q('[data-testid="run-outcome-bar"]');
             const gatesTile = q('[data-testid="gates-waiting-tile"]');
             const q3 = cards.find(c => c.dataset.projectId === 'q3-review-deck');
             const probeBg = name => { const el = document.createElement('div');
                 el.style.background = `var(${name})`;
                 document.body.appendChild(el);
                 const v = getComputedStyle(el).backgroundColor;
                 el.remove(); return v; };
             const rect = split?.querySelector('svg rect');
             return {
               questions: (%s)(band),
               bandAboveList: !!band && !!list
                 && !!(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
               cardIds: cards.map(c => c.dataset.projectId),
               split: { total: split?.dataset.total, needsYou: split?.dataset.needsYou,
                        quiet: split?.dataset.quiet },
               outcome: { total: bar?.dataset.total, unplaced: bar?.dataset.unplaced },
               gates: gatesTile?.dataset.count,
               q3Sparkline: !!q3?.querySelector('[data-testid="project-sparkline"]'),
               createAffordance: Array.from(document.querySelectorAll('button'))
                 .some(b => (b.textContent ?? '').includes('New project')),
               rectFill: rect ? getComputedStyle(rect).fill : null,
               statusGate: rect ? (() => {
                 // Resolve the token THROUGH the same property: a probe rect in
                 // the same SVG, so computed `fill` strings compare exactly.
                 const probe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                 probe.style.fill = 'var(--status-gate)';
                 rect.ownerSVGElement.appendChild(probe);
                 const v = getComputedStyle(probe).fill;
                 probe.remove(); return v; })() : probeBg('--status-gate'),
             }; }""" % QUESTIONS_JS)

    projects_ok = (
        projects_facts["questions"].get("attention-split-tile") == "How much of my estate needs me?"
        and projects_facts["questions"].get("run-outcome-bar") == "Is the system healthy right now?"
        and projects_facts["questions"].get("gates-waiting-tile") == "Am I the blocker anywhere?"
        and projects_facts["bandAboveList"]
        # The COMPLETE register: every fixture project, exactly once.
        and set(projects_facts["cardIds"]) == ALL_PROJECT_IDS
        and len(projects_facts["cardIds"]) == len(ALL_PROJECT_IDS)
        and projects_facts["split"]["total"] == "28"
        and int(projects_facts["split"]["needsYou"]) >= 3
        # In the 24h window: r-q3, r-api, r-upload, r-auth, r-chat-live; the
        # 6d/8d/clockless five are the honest unplaced remainder.
        and projects_facts["outcome"] == {"total": "5", "unplaced": "5"}
        and projects_facts["gates"] == "3"  # r-q3 + r-api + the chat gate
        and projects_facts["q3Sparkline"]
        and projects_facts["createAffordance"]
    )
    # EC15: the split bar's needs-you segment resolves from the status token.
    ec15_ok = (projects_facts["rectFill"] is not None
               and projects_facts["rectFill"] == projects_facts["statusGate"])

    page.screenshot(path=str(VSHOTS / "feedback3-P-projects-dashboard.png"))

    # Row navigation: a card lands on its project dashboard.
    # A card lands on the project dashboard: /projects/:id, which the standing
    # legacy redirect (§1.5) replaces with the dashboard route /p/:id.
    page.locator('[data-testid="project-card"][data-project-id="q3-review-deck"]').click()
    page.wait_for_function(
        "() => window.location.pathname === '/p/q3-review-deck'", timeout=15000)
    projects_nav_ok = True
    # Let the project dashboard's OWN mount reads land before the /chats budget
    # window opens — they are that surface's cost, not this navigation's.
    page.wait_for_timeout(2000)

    # ── ACs 5–6: /chats — zero gesture-gated requests ride the navigation ──────
    pre_chats = n_gesture_gated()
    page.locator('[data-testid="rail-heading-chat"] [data-testid="heading-dashboard"]').click()
    page.locator('[data-testid="chats-dashboard-tiles"]').wait_for(timeout=30000)
    page.wait_for_timeout(1500)
    chats_zero_ok = n_gesture_gated() == pre_chats

    chats_facts = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const band = q('[data-testid="chats-dashboard-tiles"]');
             const list = q('[data-testid="chats-list"]');
             const rows = Array.from(document.querySelectorAll('[data-testid="chat-row"]'));
             const over = q('[data-testid="chats-over-time-tile"]');
             const active = q('[data-testid="chats-active-tile"]');
             const gates = q('[data-testid="chats-gates-tile"]');
             return {
               questions: (%s)(band),
               bandAboveList: !!band && !!list
                 && !!(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
               rowIds: rows.map(r => r.dataset.runId),
               overTime: { total: over?.dataset.total, unplaced: over?.dataset.unplaced },
               activeCount: active?.dataset.count,
               gates: { count: gates?.dataset.count, text: gates?.textContent ?? '' },
             }; }""" % QUESTIONS_JS)

    chats_ok = (
        chats_facts["questions"].get("chats-over-time-tile") == "Is conversation increasing or drying up?"
        and chats_facts["questions"].get("chats-active-tile") == "How many threads are warm?"
        and chats_facts["questions"].get("chats-gates-tile") == "Did a conversation stall on me?"
        and chats_facts["bandAboveList"]
        # The partition: exactly the two chat runs, never a build run.
        and set(chats_facts["rowIds"]) == {"r-chat-live", "r-chat-gated"}
        # Honesty: only the placed chat is painted; the legacy thread is counted.
        and chats_facts["overTime"] == {"total": "1", "unplaced": "1"}
        and chats_facts["activeCount"] == "2"
        # Gate scoping: the chat gate only — the two build gates never count here.
        and chats_facts["gates"]["count"] == "1"
        and CHAT_GATE_PROMPT in chats_facts["gates"]["text"]
        and "Approve the deck outline?" not in chats_facts["gates"]["text"]
    )

    page.screenshot(path=str(VSHOTS / "feedback3-P-chats-dashboard.png"))

    # Preserved affordances: search filters; a row opens the thread.
    page.locator('input[placeholder="Search chats…"]').fill("auth")
    page.wait_for_timeout(300)
    filtered = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="chat-row"]'))
              .map(r => r.dataset.runId)""")
    chats_search_ok = filtered == ["r-chat-gated"]
    page.locator('input[placeholder="Search chats…"]').fill("")
    # A row opens the thread (`/runs/:id`; the standing legacy redirect may
    # then file it into its project's shell — either way the run is reached).
    page.locator('[data-testid="chat-row"][data-run-id="r-chat-live"]').click()
    page.wait_for_function(
        "() => window.location.pathname.includes('r-chat-live')", timeout=15000)
    chats_nav_ok = True

    # ── ACs 7–8: /repos — the tiles + the retired fan-out ──────────────────────
    pre_repos, pre_graph = n_repos(), n_graph()
    page.locator('[data-testid="rail-heading-repos"] [data-testid="heading-dashboard"]').click()
    page.locator('[data-testid="repos-dashboard-tiles"]').wait_for(timeout=30000)
    page.locator('[data-testid="repos-list"]').wait_for(timeout=30000)
    page.wait_for_timeout(1500)
    # The visit's budget: the page's one GET /repos + the rail accordion's one
    # cached GET on its route-mapped expand — and NOT ONE graph GET (the old
    # Tracked-card per-repo fan-out is retired).
    repos_budget = {"repos": n_repos() - pre_repos, "graph": n_graph() - pre_graph}
    repos_budget_ok = repos_budget["repos"] == 2 and repos_budget["graph"] == 0

    repos_facts = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const band = q('[data-testid="repos-dashboard-tiles"]');
             const list = q('[data-testid="repos-list"]');
             const per = q('[data-testid="runs-per-repo-tile"]');
             const count = q('[data-testid="repo-count-tile"]');
             const failing = q('[data-testid="failing-repos-tile"]');
             const cards = Array.from(document.querySelectorAll('[data-testid="repo-card"]'));
             return {
               questions: (%s)(band),
               bandAboveList: !!band && !!list
                 && !!(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
               perRepo: { total: per?.dataset.total, repos: per?.dataset.repos,
                          text: per?.textContent ?? '' },
               repoCount: count?.dataset.count,
               failing: { count: failing?.dataset.count, failures: failing?.dataset.failures,
                          text: failing?.textContent ?? '' },
               cardIds: cards.map(c => c.dataset.repoId),
               addAffordance: Array.from(document.querySelectorAll('button'))
                 .some(b => (b.textContent ?? '').includes('+ Add Repository')),
               searchBox: !!q('input[placeholder="Search repos…"]'),
             }; }""" % QUESTIONS_JS)

    repos_ok = (
        repos_facts["questions"].get("runs-per-repo-tile") == "Where is the work concentrating?"
        and repos_facts["questions"].get("repo-count-tile") == "Is the estate growing?"
        and repos_facts["questions"].get("failing-repos-tile") == "Is any repo a failure hotspot?"
        and repos_facts["bandAboveList"]
        # r-upload (1h) + r-auth (13m) + r-smoke1 (6d) — all in the 7d window.
        and repos_facts["perRepo"]["total"] == "3"
        and repos_facts["perRepo"]["repos"] == "1"
        and "studio-api leads (3)" in repos_facts["perRepo"]["text"]
        and repos_facts["repoCount"] == "1"
        # r-auth failed 13m ago; r-legacy's 8-day failure stays honest-outside.
        and repos_facts["failing"]["count"] == "1"
        and repos_facts["failing"]["failures"] == "1"
        and "studio-api (1)" in repos_facts["failing"]["text"]
        and repos_facts["cardIds"] == ["studio-api"]
        and repos_facts["addAffordance"]
        and repos_facts["searchBox"]
    )

    page.screenshot(path=str(VSHOTS / "feedback3-P-repos-dashboard.png"))

    page.locator('[data-testid="repo-card"][data-repo-id="studio-api"]').click()
    page.wait_for_function(
        "() => window.location.pathname === '/repo-detail/studio-api'", timeout=15000)
    repos_nav_ok = True

    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([
        projects_ok, ec15_ok, projects_nav_ok,
        chats_zero_ok, chats_ok, chats_search_ok, chats_nav_ok,
        repos_budget_ok, repos_ok, repos_nav_ok,
    ]),
    "projects": projects_facts,
    "projects_ok": projects_ok,
    "ec15_split_fill": {"fill": projects_facts["rectFill"],
                        "statusGate": projects_facts["statusGate"], "ok": ec15_ok},
    "chats_zero_gesture_gated": chats_zero_ok,
    "chats": chats_facts,
    "chats_ok": chats_ok,
    "chats_search_ok": chats_search_ok,
    "repos_budget": repos_budget,
    "repos_budget_ok": repos_budget_ok,
    "repos": repos_facts,
    "repos_ok": repos_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("feedback3-P-projects-dashboard.png",
                     "feedback3-P-chats-dashboard.png",
                     "feedback3-P-repos-dashboard.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-P DOM assertions did not all hold — see dom_acs")

# ── 4. Lint posture: exit 0, zero raw-color findings (EC15 error repo-wide) ───
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
raw_color_findings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and raw_color_findings == 0,
    "exit_code": r.returncode,
    "raw_color_findings_repo_wide": raw_color_findings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with zero raw-color findings — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
