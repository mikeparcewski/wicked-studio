#!/usr/bin/env python3
"""
uxfix_slice3_test.py — the DES-UXFIX-001 slice-3 gate: the rail consolidated to
TWO taxonomies (§2.3, F4), proven in a real browser against the W2
messy-reality fixture (§4.2).

Same rig pattern as the slice-1/2 gates: the SHARED deterministic fixture
server in `uxfix_fixture.py` serves the `dist-sameorigin/` build plus every
endpoint the home route reads, all timestamps computed from one frozen NOW0,
the live run narrating over the rig's own /ws. No crew daemon is involved
anywhere. This rig never flips the fixture switches, so it sees the default W2
board (orphan present, 30s q3 gate).

What it asserts (design §4.3, the slice-3 DOM AC):
  1. The rail contains data-testid="rail-section-projects" AND
     "rail-section-repos", and NO rail-section-chats / rail-section-work; the
     retired section labels and their empty strings ("Chats", "Work",
     "No chats yet", "No work yet") appear nowhere in the rail's text, and the
     old near-synonym verbs ("Do Work", "New Chat") appear nowhere on the page.
  2. Projects lists ATTENTION-ORDERED: the rail's rows settle to the same
     decayed-score order as the board's NEEDS YOU band — q3-review-deck (gate
     30s) → api-migration (gate 2m) → auth-refactor (failed 12m) →
     upload-endpoint (live) — capped at SECTION_MAX (4 of the fixture's 28)
     with a "view all". legacy-spike (8-day failure, the R3 trap) is NOT among
     them: the rail agrees with the board, read from the same DOM.
  3. The creation verbs speak the mode spine (V9/V10): Build / Chat /
     Repository inside data-testid="rail-actions".
  4. /runs remains reachable via data-testid="rail-all-runs": a real <a
     href="/runs"> whose click lands the SPA on /runs (the flat-list escape
     hatch), with the board unmounted.
  5. A rail project row enters the project shell, Chat mode default (§1.5):
     clicking q3-review-deck lands on /p/q3-review-deck/chat.

Captures (§4.0 contract: 1440x900 viewport, device_scale_factor=1, waits on
data-testid, never a sleep) into e2e/shots/uxfix/ — gitignored evidence:
  uxfix-3-rail.png   the consolidated rail beside the settled W2 board

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4332), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    SHOTS,
    ensure_build,
    start_server,
)

W2_PORT = int(os.environ.get("W2_PORT", "4332"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the slice-1/2 rigs — same dist dir) ──
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (§4.2 — `uxfix_fixture.py`, one frozen NOW0) ─
start_server(W2_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]
RAIL_ROWS = """() => Array.from(document.querySelectorAll(
    '[data-testid="rail-section-projects"] [data-testid="rail-project"]'))
    .map(r => r.dataset.projectId)"""
# Retired vocabulary that must not survive inside the rail (AC 1). "Chats" and
# "Work" are checked against the RAIL's text only — the board legitimately
# renders run problems containing the word "work" in prose.
RAIL_BANNED = ["Chats", "Work", "No chats yet", "No work yet"]
PAGE_BANNED = ["Do Work", "New Chat", "New Repository"]

console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="left-rail"]').wait_for(timeout=30000)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── AC 2: settle on the DECAYED verdict — the rail's rows reach the same
    # order as the board's NEEDS YOU band (legacy-spike demoted by its 8-day
    # durable-log tail, the gate leading regardless). Wait on BOTH surfaces.
    rail_order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="rail-section-projects"] [data-testid="rail-project"]'))
               .map(r => r.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    board_order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    rail_rows = page.evaluate(RAIL_ROWS)
    # The rail and the board AGREE (§2.3: "the same axis as the board").
    rail_matches_board = page.evaluate(
        """() => { const rail = Array.from(document.querySelectorAll(
                     '[data-testid="rail-section-projects"] [data-testid="rail-project"]'))
                     .map(r => r.dataset.projectId);
                   const board = Array.from(document.querySelectorAll(
                     '[data-testid="band-needs-you"] [data-testid="project-card"]'))
                     .map(c => c.dataset.projectId);
                   return JSON.stringify(rail) === JSON.stringify(board); }""")
    capped_ok = len(rail_rows) == 4 and "legacy-spike" not in rail_rows
    view_all_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="rail-section-projects"] button'))
              .some(b => (b.textContent ?? '').trim() === 'view all')""")

    # ── AC 1: two taxonomies, and only two ─────────────────────────────────────
    sections_ok = page.evaluate(
        """() => !!document.querySelector('[data-testid="rail-section-projects"]')
              && !!document.querySelector('[data-testid="rail-section-repos"]')
              && !document.querySelector('[data-testid="rail-section-chats"]')
              && !document.querySelector('[data-testid="rail-section-work"]')""")
    rail_text = page.evaluate(
        """() => document.querySelector('[data-testid="left-rail"]').innerText""")
    rail_banned_hits = [s for s in RAIL_BANNED if s in rail_text]
    body_text = page.evaluate("() => document.body.innerText")
    page_banned_hits = [s for s in PAGE_BANNED if s in body_text]

    # ── AC 3: the creation verbs are the mode spine's words — re-scoped to
    #    DES-FEEDBACK-001 §1.2 (slice A): a VERTICAL QUICK list with Project
    #    leading; the spine verbs (Build/Chat/Repository) are all still there.
    verbs_ok = page.evaluate(
        """() => { const labels = Array.from(document.querySelectorAll(
                     '[data-testid="rail-actions"] button'))
                     .map(b => b.getAttribute('aria-label'));
                   return JSON.stringify(labels)
                       === JSON.stringify(['Project', 'Build', 'Chat', 'Repository']); }""")

    # ── Capture: the consolidated rail beside the settled W2 board (§4.0) ──────
    page.locator('[data-testid="rail-all-runs"]').wait_for(timeout=10000)
    page.locator('[data-testid="left-rail"]').screenshot(path=str(SHOTS / "uxfix-3-rail.png"))

    # ── AC 4: the ONE escape hatch — a real link that lands on /runs ───────────
    hatch_href = page.evaluate(
        """() => document.querySelector('[data-testid="rail-all-runs"]')?.getAttribute('href')""")
    page.locator('[data-testid="rail-all-runs"]').click()
    hatch_ok = settled(
        """() => window.location.pathname === '/runs'
              && !document.querySelector('[data-testid="project-board"]')""")

    # ── AC 5: a rail project row enters the shell, Chat mode default (§1.5) ────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="rail-project"][data-project-id="q3-review-deck"]').wait_for(timeout=30000)
    page.locator('[data-testid="rail-project"][data-project-id="q3-review-deck"]').click()
    shell_ok = settled("""() => window.location.pathname === '/p/q3-review-deck/chat'""")

    ctx.close()
    browser.close()

report["steps"]["slice3_rail"] = {
    "ok": all([
        rail_order_ok, board_order_ok, rail_matches_board, capped_ok, view_all_ok,
        sections_ok, not rail_banned_hits, not page_banned_hits, verbs_ok,
        hatch_href == "/runs", hatch_ok, shell_ok,
    ]),
    "rail_projects_order": rail_rows,
    "expected_order": EXPECTED_ORDER,
    "rail_order_ok": rail_order_ok,
    "board_order_ok": board_order_ok,
    "rail_matches_board_needs_you": rail_matches_board,
    "capped_at_section_max_no_stale": capped_ok,
    "view_all_present": view_all_ok,
    "two_taxonomies_no_chats_no_work": sections_ok,
    "rail_banned_strings_found": rail_banned_hits,
    "page_banned_strings_found": page_banned_hits,
    "creation_verbs_mode_spine": verbs_ok,
    "all_runs_href": hatch_href,
    "all_runs_lands_on_flat_list": hatch_ok,
    "project_row_enters_shell_chat_default": shell_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(SHOTS / "uxfix-3-rail.png")],
}
if not report["steps"]["slice3_rail"]["ok"]:
    fail("slice3_verdict", "slice-3 rail assertions did not all hold — see slice3_rail")

report["ok"] = True
print(json.dumps(report, indent=2))
