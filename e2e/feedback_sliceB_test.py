#!/usr/bin/env python3
"""
feedback_sliceB_test.py — the DES-FEEDBACK-001 slice-B gate: create-flow
project defaults (§5, §8.3 slice B), against the shared frozen-NOW0 W2
fixture (uxfix_fixture.py).

The slice DOM ACs, verbatim from §8.3:

  1. In the Build new-run form, `[data-testid="project-field"]` default value
     is "Unfiled";
  2. clicking it opens a dropdown containing project names;
  3. when navigated from `/p/:projectId/build`, the field shows the project
     name and has `data-locked="true"` (locked = not clickable/changeable);
  4. `[data-testid="project-switcher-add"]` option renders in the dropdown.

Plus the §8.3 preservation list this rig can see: the Build purpose statement
(`[data-testid="build-purpose"]`, DES-UXFIX-001 §2.7/EC7 — the surface teaches
itself) and the intent input (`[data-testid="launch-problem"]`, "What do you
need built?"). Chat's single-agent default and §6.2 chips are untouched by
this slice (chips are slice C) and covered at unit level. EC17's
project-context header is slice D's build; here the §4.3 LOCKED project field
is what carries the project context inside the create surface.

Captures (§8.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback-B-build-unfiled.png   the Build create form (/runs/new), Unfiled default
  feedback-B-build-prebound.png  the Build form entered from project context
                                 (/p/q3-review-deck/build → + Build something),
                                 project pre-filled and locked

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4352),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    REPO,
    ensure_build,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4352"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# The fixture's real (non-synthesized, non-quiet-clone) project names the
# dropdown must list — presence, not exhaustiveness.
EXPECTED_NAMES = {"q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"}

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    def new_page():
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        # Freeze Date.now at NOW0 + 5s BEFORE the app boots so every rendered
        # age is deterministic in the captures.
        page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))
        return page

    def settled(page, expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── Scene 1: the flat Build create form (/runs/new) — Unfiled default ─────
    page = new_page()
    page.goto(f"{ORIGIN}/runs/new", wait_until="domcontentloaded")
    page.locator('[data-testid="project-field"]').wait_for(timeout=30000)
    page.locator('[data-testid="launch-problem"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    fonts_ok = settled(
        page,
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    closed = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const field = q('[data-testid="project-field"]');
             return {
               fieldText: field?.textContent ?? null,
               locked: field?.dataset.locked ?? null,
               listOpen: !!q('[data-testid="project-switcher-list"]'),
               // §5.2: the field sits ABOVE the intent input in the form.
               rowFirst: !!q('[data-testid="launch-project-row"]'),
               intentPlaceholder: q('[data-testid="launch-problem"]')?.placeholder ?? null,
               // EC7 preserved: the surface says what it is for, in one line.
               teachesItself: (document.body.innerText || '').includes(
                 'Describe your goal. The council elects a CLI'),
             }; }""")

    ac1_unfiled = (closed["fieldText"] or "").strip().startswith("Unfiled") \
        and closed["locked"] == "false" and not closed["listOpen"]
    intent_ok = closed["intentPlaceholder"] == "What do you need built?" and closed["rowFirst"]

    # ── Capture 1: the Unfiled default, BEFORE any interaction ────────────────
    page.screenshot(path=str(VSHOTS / "feedback-B-build-unfiled.png"))

    # ── ACs 2 + 4: the dropdown — project names + "+ New project" ─────────────
    page.locator('[data-testid="project-field"]').click()
    list_opens = settled(
        page,
        """() => document.querySelectorAll('[data-testid="project-switcher-option"]').length > 3""",
        timeout=10000,
    )
    dropdown = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const names = Array.from(document.querySelectorAll(
               '[data-testid="project-switcher-option"]')).map(r => r.textContent);
             const ids = Array.from(document.querySelectorAll(
               '[data-testid="project-switcher-option"]')).map(r => r.dataset.projectId);
             return {
               names, ids,
               addRow: !!q('[data-testid="project-switcher-add"]'),
               addText: q('[data-testid="project-switcher-add"]')?.textContent ?? null,
               unfiledRow: !!q('[data-testid="project-switcher-unfiled"]'),
               filterInput: !!q('input[placeholder="filter projects…"]'),
             }; }""")

    ac2_names = EXPECTED_NAMES.issubset(set(dropdown["names"]))
    # The synthesized `default` project must never list as a row (F5).
    default_hidden = "default" not in dropdown["ids"]
    ac4_add = dropdown["addRow"] and dropdown["addText"] == "+ New project"
    anatomy_ok = dropdown["unfiledRow"] and dropdown["filterInput"]

    # Selecting a project updates the field; re-selecting Unfiled restores it —
    # the §5.2 "opportunity to change" is one click away in both directions.
    page.locator('[data-testid="project-switcher-option"][data-project-id="q3-review-deck"]').click()
    select_ok = settled(
        page,
        """() => (document.querySelector('[data-testid="project-field"]')?.textContent ?? '')
                   .includes('q3-review-deck')""",
        timeout=5000,
    )
    page.locator('[data-testid="project-field"]').click()
    page.locator('[data-testid="project-switcher-unfiled"]').click()
    unfiled_back = settled(
        page,
        """() => (document.querySelector('[data-testid="project-field"]')?.textContent ?? '')
                   .includes('Unfiled')""",
        timeout=5000,
    )
    page.close()

    report["steps"]["build_unfiled"] = {
        "ok": all([fonts_ok, ac1_unfiled, intent_ok, list_opens, ac2_names,
                   default_hidden, ac4_add, anatomy_ok, select_ok, unfiled_back,
                   closed["teachesItself"]]),
        "web_fonts_loaded": fonts_ok,
        "ac1_field_defaults_unfiled": ac1_unfiled,
        "field_text": closed["fieldText"],
        "intent_input_preserved": intent_ok,
        "ec7_surface_teaches_itself": closed["teachesItself"],
        "ac2_dropdown_lists_projects": ac2_names,
        "dropdown_names_head": dropdown["names"][:8],
        "synthesized_default_hidden": default_hidden,
        "ac4_new_project_row": ac4_add,
        "dropdown_anatomy_filter_and_unfiled": anatomy_ok,
        "select_then_unfiled_roundtrip": select_ok and unfiled_back,
        "screenshot": str(VSHOTS / "feedback-B-build-unfiled.png"),
    }
    if not report["steps"]["build_unfiled"]["ok"]:
        fail("build_unfiled_verdict", "scene-1 DOM assertions did not all hold — see build_unfiled")

    # ── Scene 2: entered from project context — pre-filled and LOCKED (§4.3) ──
    page2 = new_page()
    page2.goto(f"{ORIGIN}/p/q3-review-deck/build", wait_until="domcontentloaded")
    page2.locator('[data-testid="build-purpose"]').wait_for(timeout=30000)   # preserved (EC7)
    page2.locator('[data-testid="build-something"]').wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)
    purpose_ok = page2.evaluate(
        """() => (document.querySelector('[data-testid="build-purpose"]')?.textContent ?? '')
                   .startsWith('Build runs governed code work')""")

    # The journey the AC names: FROM /p/:projectId/build into the create form.
    page2.locator('[data-testid="build-something"]').click()
    route_ok = settled(
        page2,
        """() => location.pathname === '/p/q3-review-deck/build/new'""",
        timeout=10000,
    )
    page2.locator('[data-testid="project-field"]').wait_for(timeout=30000)
    # AC 3: the field shows the project NAME (resolved from /projects) and locks.
    prebound_settled = settled(
        page2,
        """() => { const f = document.querySelector('[data-testid="project-field"]');
                   return !!f && f.dataset.locked === 'true'
                       && (f.textContent ?? '').includes('q3-review-deck'); }""",
        timeout=15000,
    )
    # Locked = not clickable/changeable: a click must NOT open the dropdown.
    page2.locator('[data-testid="project-field"]').click()
    page2.wait_for_timeout(300)
    locked_state = page2.evaluate(
        """() => ({
             listOpen: !!document.querySelector('[data-testid="project-switcher-list"]'),
             caret: (document.querySelector('[data-testid="project-field"]')?.textContent ?? '')
               .includes('▾'),
             intentPresent: !!document.querySelector('[data-testid="launch-problem"]'),
           })""")
    lock_holds = not locked_state["listOpen"] and not locked_state["caret"]

    # ── Capture 2: the pre-bound, locked form ──────────────────────────────────
    page2.screenshot(path=str(VSHOTS / "feedback-B-build-prebound.png"))
    page2.close()
    browser.close()

report["steps"]["build_prebound"] = {
    "ok": all([purpose_ok, route_ok, prebound_settled, lock_holds,
               locked_state["intentPresent"]]),
    "purpose_statement_preserved": purpose_ok,
    "route_is_project_scoped_new": route_ok,
    "ac3_prefilled_and_locked": prebound_settled,
    "lock_refuses_to_open": lock_holds,
    "intent_input_present": locked_state["intentPresent"],
    "console_errors": console_errors[:10],
    "screenshot": str(VSHOTS / "feedback-B-build-prebound.png"),
}
if not report["steps"]["build_prebound"]["ok"]:
    fail("build_prebound_verdict", "scene-2 DOM assertions did not all hold — see build_prebound")

report["ok"] = True
print(json.dumps(report, indent=2))
