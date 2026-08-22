#!/usr/bin/env python3
"""
feedback3_sliceO_test.py — the DES-FEEDBACK-003 slice-O gate: the rail-foot
health section (§6.2/§6.3) + the /make combined list-and-reporting dashboard
(§4.2/§4.5), against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py, its
roster extended with the REAL crew#274 SeatHealth shape) with metrics_ws ON so
the Spend tile has real cliUsage dollars to fold.

The slice DOM ACs, from §6.3 + §4.5:

  1. `[data-testid="rail-health-section"]` renders at the rail bottom with
     `data-open="false"` by default; `rail-settings-section` is gone from that
     slot; ZERO `GET /health` / `GET /roster` requests fire on app mount (EC30).
  2. Expanding fires exactly one `GET /health` and one `GET /roster`;
     collapsing and re-expanding refetches (staleness by gesture).
  3. Registry rows: the fixture's inactive seat (codex) shows `✗` + the 40ch
     message excerpt with the full text on `title`; the health-less seat (pi)
     shows the dim `·` / `data-health="unknown"` — never a fabricated active;
     `[data-testid="rail-health-summary-dot"]` renders on the COLLAPSED header
     in computed `var(--status-fail)` (EC15).
  4. Clicking `[data-testid="connection-dot"]` expands the health section; no
     popover element mounts (the old "Health checks" DOM is absent). The dot's
     `data-state` glance contract and the logo slot are PRESERVED (§8.2), and
     the NotificationBell sits directly under the chrome (§6.1).
  5. `/make` renders `[data-testid="make-dashboard-tiles"]` ABOVE the list,
     every tile carrying its §4.2.1 `data-question` (EC19/EC28); navigating
     there fires no health/roster/docs requests (loaded stores only).
  6. `[data-testid="make-corpus-label"]` names both corpora and the not-listed
     clause (EC24); `[load docs for all projects]` fires exactly P
     `GET .../interactive/api/docs` requests on click and zero before
     (request interception; P = non-default projects), then collapses to the
     session-cached quiet note; the landed doc rows render `▤/▶ name · vN ·
     project` links.
  7. The run list is the non-chat spine — every fixture run (all carry a real
     workflow stamp), active before terminal, each row an `<a href=runPath>`.

Captures (§10.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback3-O-health-open.png     registry expanded, one inactive seat
  feedback3-O-make-dashboard.png  tiles + corpus label + list, W2 fixture

Finally: `npm run lint` must exit 0 with zero raw-color findings (EC15 is
ERROR repo-wide).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK3O_PORT (default 4363),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    CODEX_HEALTH_MESSAGE,
    HIDE_GATE_TOASTS,
    NOW0,
    NPM,
    PROJECTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK3O_PORT = int(os.environ.get("FEEDBACK3O_PORT", "4363"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK3O_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
P_PROJECTS = [p["id"] for p in PROJECTS if p["id"] != "default"]

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches) ──────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server; metrics_ws ON (the Spend tile's dollars) ─
start_server(FEEDBACK3O_PORT, dist)
set_fixture(ORIGIN, metrics_ws=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []
api_paths: list[str] = []


def n_health() -> int:
    return sum(1 for p in api_paths if p == "/api/v1/health")


def n_roster() -> int:
    return sum(1 for p in api_paths if p == "/api/v1/roster")


def n_docs() -> int:
    return sum(1 for p in api_paths if p.endswith("/interactive/api/docs"))


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: api_paths.append(urlparse(r.url).path)
            if "/api/v1/" in r.url and r.method == "GET" else None)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── AC 1: cold `/` — the section at the rail foot, zero gesture-gated GETs ─
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.locator('[data-testid="rail-health-section"]').wait_for(timeout=30000)
    page.wait_for_timeout(2500)  # let every mount read settle before counting

    foot = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const section = q('[data-testid="rail-health-section"]');
             const rail = q('[data-testid="left-rail"]');
             const headings = Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'));
             const lastHeading = headings[headings.length - 1];
             const chrome = q('[data-testid="app-chrome"]');
             const bell = q('[aria-label="Notifications"], [aria-label$="notifications"]');
             return {
               open: section?.dataset.open ?? null,
               settingsSection: !!q('[data-testid="rail-settings-section"]'),
               inRail: !!section && !!rail && rail.contains(section),
               belowHeadings: !!section && !!lastHeading
                 && section.getBoundingClientRect().top
                    >= lastHeading.getBoundingClientRect().bottom - 1,
               // §6.1/§6.3: the bell sits directly under the chrome, above the headings.
               bellUnderChrome: !!bell && !!chrome && !!lastHeading
                 && !!(chrome.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING)
                 && !!(bell.compareDocumentPosition(headings[0]) & Node.DOCUMENT_POSITION_FOLLOWING),
             }; }""")
    mount_health, mount_roster = n_health(), n_roster()
    ac1_ok = (foot["open"] == "false" and not foot["settingsSection"] and foot["inRail"]
              and foot["belowHeadings"] and foot["bellUnderChrome"]
              and mount_health == 0 and mount_roster == 0)

    # ── AC 2+3: expand — one GET each; the registry's honest anatomy ───────────
    page.locator('[data-testid="rail-health-toggle"]').click()
    page.locator('[data-testid="rail-seat-row"]').first.wait_for(timeout=15000)
    page.wait_for_timeout(1000)
    expand_health, expand_roster = n_health(), n_roster()

    seats = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="rail-seat-row"]'))
              .map(r => ({ seat: r.dataset.seat, health: r.dataset.health,
                           title: r.getAttribute('title'), text: r.textContent }))""")
    by_seat = {s["seat"]: s for s in seats}
    excerpt = CODEX_HEALTH_MESSAGE[:40] + "…"
    seats_ok = (
        [s["seat"] for s in seats] == ["claude", "codex", "agy", "pi"]
        and by_seat["claude"]["health"] == "active"
        and "✓" in by_seat["claude"]["text"] and "signed in" in by_seat["claude"]["text"]
        and by_seat["codex"]["health"] == "inactive"
        and "✗" in by_seat["codex"]["text"] and excerpt in by_seat["codex"]["text"]
        and CODEX_HEALTH_MESSAGE not in by_seat["codex"]["text"]
        and by_seat["codex"]["title"] == CODEX_HEALTH_MESSAGE
        and by_seat["pi"]["health"] == "unknown"
        and "·" in by_seat["pi"]["text"] and "active" not in by_seat["pi"]["text"]
    )

    # ── Capture 1: the registry expanded, one inactive seat ────────────────────
    page.screenshot(path=str(VSHOTS / "feedback3-O-health-open.png"))

    # Collapse: the answers stay, the summary dot says "look inside" (EC15).
    page.locator('[data-testid="rail-health-toggle"]').click()
    dot = page.evaluate(
        """() => { const probeBg = name => { const el = document.createElement('div');
                     el.style.background = `var(${name})`;
                     document.body.appendChild(el);
                     const v = getComputedStyle(el).backgroundColor;
                     el.remove(); return v; };
                   const section = document.querySelector('[data-testid="rail-health-section"]');
                   const d = document.querySelector('[data-testid="rail-health-summary-dot"]');
                   return { open: section?.dataset.open ?? null,
                            present: !!d,
                            bg: d ? getComputedStyle(d).backgroundColor : null,
                            statusFail: probeBg('--status-fail') }; }""")
    summary_dot_ok = dot["open"] == "false" and dot["present"] and dot["bg"] == dot["statusFail"]

    # Re-expand refetches — staleness by gesture (§6.3).
    page.locator('[data-testid="rail-health-toggle"]').click()
    page.wait_for_timeout(1000)
    refetch_ok = n_health() == expand_health + 1 and n_roster() == expand_roster + 1
    page.locator('[data-testid="rail-health-toggle"]').click()  # collapsed again

    # ── AC 4: the chrome dot hands off; the popover is gone; §8.2 preserved ────
    chrome_facts = page.evaluate(
        """() => ({ dotState: document.querySelector('[data-testid="connection-dot"]')?.dataset.state ?? null,
                    logoSlot: !!document.querySelector('[data-testid="logo-slot"]') })""")
    page.locator('[data-testid="connection-dot"]').click()
    dot_click = page.evaluate(
        """() => ({ open: document.querySelector('[data-testid="rail-health-section"]')?.dataset.open ?? null,
                    popover: Array.from(document.querySelectorAll('p'))
                      .some(el => (el.textContent ?? '').trim() === 'Health checks') })""")
    dot_click_ok = (dot_click["open"] == "true" and not dot_click["popover"]
                    and chrome_facts["dotState"] == "connected" and chrome_facts["logoSlot"])

    # ── AC 5: /make — tiles above the list, zero requests ride the navigation ──
    page.wait_for_timeout(1200)  # let the dot-click expand's own gesture fetch land
    pre_nav = (n_health(), n_roster(), n_docs())
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-dashboard"]').click()
    page.locator('[data-testid="make-dashboard"]').wait_for(timeout=30000)
    page.locator('[data-testid="make-run-row"]').first.wait_for(timeout=15000)
    page.wait_for_timeout(1500)
    nav_zero_ok = (n_health(), n_roster(), n_docs()) == pre_nav

    make = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const band = q('[data-testid="make-dashboard-tiles"]');
             const list = q('[data-testid="make-list"]');
             const question = tid => band?.querySelector(`[data-testid="${tid}"]`)?.dataset.question ?? null;
             const rows = Array.from(document.querySelectorAll('[data-testid="make-run-row"]'))
               .map(r => ({ id: r.dataset.runId, status: r.dataset.status,
                            href: r.getAttribute('href'), tag: r.tagName }));
             return {
               bandAboveList: !!band && !!list
                 && !!(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
               questions: { made: question('made-tile'),
                            outcome: question('run-outcome-bar'),
                            spend: question('token-burn-sparkline') },
               corpusLabel: q('[data-testid="make-corpus-label"]')?.textContent ?? null,
               fanoutButton: !!q('[data-testid="make-load-all-docs"]'),
               rows,
             }; }""")
    ACTIVE = {"planning", "distributing", "executing", "awaiting_human"}
    statuses = [r["status"] for r in make["rows"]]
    first_terminal = next((i for i, s in enumerate(statuses) if s not in ACTIVE), len(statuses))
    EXPECTED_IDS = {"r-q3", "r-api", "r-upload", "r-auth", "r-legacy", "r-smoke1", "r-smoke2", "r-orphan"}
    rows_ok = (
        {r["id"] for r in make["rows"]} == EXPECTED_IDS  # the complete non-chat spine
        and all(r["tag"] == "A" for r in make["rows"])
        and all(s not in ACTIVE for s in statuses[first_terminal:])  # active precede terminal
        and {r["id"]: r["href"] for r in make["rows"]}.get("r-upload") == "/runs/r-upload"
    )
    tiles_ok = (
        make["bandAboveList"]
        and make["questions"]["made"] == "What is the shop producing, and of what kind?"
        and make["questions"]["outcome"] == "Are makes landing or failing?"
        and make["questions"]["spend"] == "What is making costing?"
    )
    label_ok = (
        make["corpusLabel"] is not None
        and "Listing: build runs (all projects) · documents (projects opened this session)"
            in make["corpusLabel"]
        and make["fanoutButton"]
    )

    # ── Capture 2: tiles + corpus label + list ─────────────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback3-O-make-dashboard.png"))

    # ── AC 6: the fan-out gesture — exactly P doc GETs on click, zero before ───
    docs_before = n_docs()
    page.locator('[data-testid="make-load-all-docs"]').click()
    fanout_settles = settled(
        """() => !document.querySelector('[data-testid="make-load-all-docs"]')
              && !document.querySelector('[data-testid="make-fanout-progress"]')""",
        timeout=30000,
    )
    page.wait_for_timeout(1000)
    fanout_paths = [p for p in api_paths if p.endswith("/interactive/api/docs")]
    fanout_delta = n_docs() - docs_before
    fanout_ok = (fanout_settles and fanout_delta == len(P_PROJECTS)
                 # one GET per project, no repeats inside the gesture
                 and len(set(fanout_paths[docs_before:])) == len(P_PROJECTS))
    cached_note_ok = settled(
        """() => Array.from(document.querySelectorAll('p'))
              .some(el => (el.textContent ?? '') === 'docs loaded for all projects')""",
        timeout=5000,
    )
    doc_rows = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="make-doc-row"]'))
              .map(r => ({ kind: r.dataset.docKind, href: r.getAttribute('href'),
                           text: r.textContent }))""")
    # The notes project's registry (2 seed docs); the fixture's demo switch is off.
    doc_rows_ok = (
        len(doc_rows) == 2
        and {r["href"] for r in doc_rows}
            == {"/p/notes/document/ideas", "/p/notes/document/todo"}
        and all("v1" in r["text"] and "notes" in r["text"] for r in doc_rows)
    )

    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([
        ac1_ok, expand_health == 1, expand_roster == 1, seats_ok,
        summary_dot_ok, refetch_ok, dot_click_ok, nav_zero_ok,
        tiles_ok, label_ok, rows_ok, fanout_ok, cached_note_ok, doc_rows_ok,
    ]),
    "ac1_rail_foot": foot,
    "ac1_zero_mount_requests": {"health": mount_health, "roster": mount_roster},
    "ac1_ok": ac1_ok,
    "ac2_expand_counts": {"health": expand_health, "roster": expand_roster},
    "ac2_reexpand_refetches": refetch_ok,
    "ac3_seat_rows": seats,
    "ac3_seats_ok": seats_ok,
    "ac3_summary_dot": dot,
    "ac3_summary_dot_ok": summary_dot_ok,
    "ac4_dot_click": dot_click,
    "ac4_chrome_preserved": chrome_facts,
    "ac4_ok": dot_click_ok,
    "ac5_nav_fires_nothing": nav_zero_ok,
    "ac5_tiles": make["questions"],
    "ac5_tiles_ok": tiles_ok,
    "ac6_corpus_label": make["corpusLabel"],
    "ac6_label_ok": label_ok,
    "ac6_fanout": {"delta": fanout_delta, "expected": len(P_PROJECTS)},
    "ac6_fanout_ok": fanout_ok,
    "ac6_cached_note": cached_note_ok,
    "ac6_doc_rows": doc_rows,
    "ac6_doc_rows_ok": doc_rows_ok,
    "ac7_run_rows": make["rows"],
    "ac7_rows_ok": rows_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("feedback3-O-health-open.png", "feedback3-O-make-dashboard.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-O DOM assertions did not all hold — see dom_acs")

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
