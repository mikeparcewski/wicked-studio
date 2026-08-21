#!/usr/bin/env python3
"""
feedback_sliceA_test.py — the DES-FEEDBACK-001 slice-A gate: the nav
restructure (§1, §8.3 slice A), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py) — messy reality, so the rail's runs section has real rows.

The slice DOM ACs, verbatim from §8.3:

  1. `[data-testid="rail-quick"]` header text is "QUICK";
  2. `[data-testid="new-project"]` button is present and clicking it opens
     `[data-testid="new-project-modal"]`;
  3. no `+` glyph is rendered inside `[data-testid="rail-actions"]` (EC20:
     no "+" character in any child element);
  4. `[data-testid="rail-settings-section"]` is collapsed by default and
     expands on click;
  5. `[data-testid="rail-runs"]` is present and non-empty when runs exist.

Plus the §8.3 preservation list: rail project + repo taxonomies unchanged
(attention order intact), AppChrome connection dot + logo slot unchanged —
and the chrome gear GONE (§4.4).

Captures (§8.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback-A-rail-expanded.png     the full rail: QUICK, runs, projects, repos,
                                   settings collapsed
  feedback-A-new-project-modal.png the new-project modal open, name filled

Finally: `npm run lint` must exit 0 with zero raw-color findings (EC15 is
ERROR repo-wide).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4351),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4351"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

EXPECTED_PROJECT_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]

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
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Freeze Date.now at NOW0 + 5s BEFORE the app boots so every rendered age
    # is deterministic in the captures.
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="left-rail"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )
    # Settle: rail projects reach the W2 attention order (preservation) and the
    # runs section has rows (AC 5's precondition — the fixture always has runs).
    rail_settled = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="rail-section-projects"] [data-testid="rail-project"]'))
               .map(r => r.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected)
                 && document.querySelectorAll('[data-testid="rail-runs"] [data-testid="rail-run"]').length > 0; }""",
        EXPECTED_PROJECT_ORDER,
    )

    # ── ACs 1/3/5 + preservation, read off the settled DOM in one pass ────────
    dom = page.evaluate(
        """() => {
             const q = s => document.querySelector(s);
             const runs = Array.from(document.querySelectorAll(
               '[data-testid="rail-runs"] [data-testid="rail-run"]'));
             return {
               quickHeader: q('[data-testid="rail-quick"]')?.textContent ?? null,
               actionLabels: Array.from(document.querySelectorAll(
                 '[data-testid="rail-actions"] button')).map(b => b.getAttribute('aria-label')),
               actionsText: q('[data-testid="rail-actions"]')?.textContent ?? null,
               plusInActions: Array.from(q('[data-testid="rail-actions"]')?.querySelectorAll('*') ?? [])
                 .some(el => (el.textContent ?? '').includes('+')),
               runsPresent: !!q('[data-testid="rail-runs"]'),
               runRows: runs.map(r => ({ id: r.dataset.runId, status: r.dataset.status })),
               allRunsInSection: !!q('[data-testid="rail-runs"] [data-testid="rail-all-runs"]'),
               settingsOpenDefault: q('[data-testid="rail-settings-section"]')?.dataset.open ?? null,
               settingsMenuItems: document.querySelectorAll(
                 '[data-testid="rail-settings-section"] [role="menuitem"]').length,
               // §8.3 preserved: taxonomies + chrome anatomy (gear GONE, §4.4).
               projectsSection: !!q('[data-testid="rail-section-projects"]'),
               reposSection: !!q('[data-testid="rail-section-repos"]'),
               logoSlot: !!q('[data-testid="logo-slot"]'),
               connectionDot: q('[data-testid="connection-dot"]')?.dataset.state ?? null,
               chromeGear: !!q('[data-testid="chrome-settings"]'),
             }; }""")

    quick_ok = dom["quickHeader"] == "QUICK"
    order_ok = dom["actionLabels"] == ["Project", "Build", "Chat", "Repository"]
    ec20_ok = (not dom["plusInActions"]) and "+" not in (dom["actionsText"] or "")
    runs_ok = dom["runsPresent"] and len(dom["runRows"]) > 0 and dom["allRunsInSection"]
    # §1.4 ordering: active rows lead, terminal rows trail.
    TERMINAL = {"completed", "cancelled", "failed"}
    statuses = [r["status"] for r in dom["runRows"]]
    first_terminal = next((i for i, s in enumerate(statuses) if s in TERMINAL), len(statuses))
    runs_order_ok = all(s in TERMINAL for s in statuses[first_terminal:])
    preserved_ok = (dom["projectsSection"] and dom["reposSection"] and dom["logoSlot"]
                    and dom["connectionDot"] == "connected" and not dom["chromeGear"])

    # ── AC 4: settings collapsed by default, expands on click ─────────────────
    settings_default_collapsed = dom["settingsOpenDefault"] == "false" and dom["settingsMenuItems"] == 0

    # ── Capture 1: the full rail — QUICK, runs, projects, repos, settings
    #    collapsed — BEFORE any state-mutating interaction. ─────────────────────
    page.locator('[data-testid="left-rail"]').screenshot(
        path=str(VSHOTS / "feedback-A-rail-expanded.png"))

    page.locator('[data-testid="rail-settings-toggle"]').click()
    settings_expands = settled(
        """() => { const s = document.querySelector('[data-testid="rail-settings-section"]');
                   return !!s && s.dataset.open === 'true'
                       && s.querySelectorAll('[role="menuitem"]').length >= 7; }""",
        timeout=5000,
    )
    # Both the Theme and the System shortcuts ride the section (§1.2: it carries
    # what the retired AppChrome dropdown carried).
    settings_entries = page.evaluate(
        """() => Array.from(document.querySelectorAll(
             '[data-testid="rail-settings-section"] [role="menuitem"]')).map(b => b.textContent)""")
    settings_entries_ok = "Theme" in settings_entries and "System" in settings_entries
    page.locator('[data-testid="rail-settings-toggle"]').click()  # back to collapsed

    # ── AC 2: the Project quick action opens the modal; fill the name ─────────
    page.locator('[data-testid="new-project"]').click()
    modal_opens = settled(
        """() => !!document.querySelector('[data-testid="new-project-modal"]')""",
        timeout=5000,
    )
    page.locator('[data-testid="new-project-name"]').fill("api gateway revamp")
    modal_state = page.evaluate(
        """() => ({
             name: document.querySelector('[data-testid="new-project-name"]')?.value ?? null,
             buildDefault: document.querySelector(
               '[data-testid="new-project-start"] input[value="build"]')?.checked ?? false,
             createEnabled: !document.querySelector('[data-testid="new-project-create"]')?.disabled,
           })""")
    modal_ok = (modal_opens and modal_state["name"] == "api gateway revamp"
                and modal_state["buildDefault"] and modal_state["createEnabled"])

    # ── Capture 2: the modal open, name filled ─────────────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback-A-new-project-modal.png"))

    # Escape closes it (§1.3).
    page.keyboard.press("Escape")
    modal_closes = settled(
        """() => !document.querySelector('[data-testid="new-project-modal"]')""",
        timeout=5000,
    )
    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([fonts_ok, rail_settled, quick_ok, order_ok, ec20_ok, runs_ok,
               runs_order_ok, settings_default_collapsed, settings_expands,
               settings_entries_ok, modal_ok, modal_closes, preserved_ok]),
    "web_fonts_loaded": fonts_ok,
    "rail_settled_w2": rail_settled,
    "ac1_quick_header": quick_ok,
    "quick_action_order": dom["actionLabels"],
    "quick_action_order_ok": order_ok,
    "ac3_ec20_no_plus_in_actions": ec20_ok,
    "ac5_runs_nonempty": runs_ok,
    "run_rows": dom["runRows"],
    "runs_active_before_terminal": runs_order_ok,
    "ac4_settings_collapsed_default": settings_default_collapsed,
    "ac4_settings_expands_on_click": settings_expands,
    "settings_entries": settings_entries,
    "settings_carries_theme_and_system": settings_entries_ok,
    "ac2_modal_opens_name_filled": modal_ok,
    "modal_closes_on_escape": modal_closes,
    "preserved_taxonomies_chrome": preserved_ok,
    "dom": dom,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("feedback-A-rail-expanded.png", "feedback-A-new-project-modal.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-A DOM assertions did not all hold — see dom_acs")

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
