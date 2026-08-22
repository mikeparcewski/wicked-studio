#!/usr/bin/env python3
"""
feedback_sliceA_test.py — the DES-FEEDBACK-001 slice-A gate, RE-SCOPED by
DES-FEEDBACK-003 §8.7 (slice M): the rail slice A built (QUICK verbs, inline
runs, bottom settings section) is superseded by the five-path accordion rail
(§3), so this rig now pins what slice A's affordances BECAME — never the
retired zones themselves. Same shared frozen-NOW0 W2 fixture
(uxfix_fixture.py) — messy reality, so the accordions have real rows.

The re-scoped ACs (§8.7's amendment row, against §3.6):

  1. The five heading rows render — `rail-heading-projects|make|chat|repos|
     settings` — and Settings is icon-less (no `heading-dashboard` /
     `heading-new` child) while the other four carry both.
  2. One-open (EC26): clicking two different titles in sequence leaves at
     most one `[data-testid^="rail-heading-"]` with `aria-expanded="true"`.
  3. EC20 (amended): no `+` glyph inside accordion CONTENTS — the
     heading-level ＋ icons are the sanctioned spelling now.
  4. The settings menuitem list re-asserts inside the Settings ACCORDION:
     ≥7 menuitems including Theme and System, plus the version line.
  5. The modal AC carries over: Projects' ＋ opens
     `[data-testid="new-project-modal"]`, the name fills, Build is the start
     default, Create enables, Escape closes.
  6. Supersession: `rail-quick`, `rail-actions`, `rail-runs`,
     `rail-settings-section` are ABSENT (§8.1).

Plus the preservation list carried from slice A: the Projects accordion lists
the BOARD's attention order (the same axis, C3), AppChrome connection dot +
logo slot unchanged — and the chrome gear still GONE (§4.4).

Captures (§8.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback-A-rail-expanded.png     the five-path rail, Projects expanded
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
HEADING_KEYS = ["projects", "make", "chat", "repos", "settings"]

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
    # Settle: the board reaches the W2 attention order — the Projects accordion
    # reads the SAME model, so the board settling settles the rail's source.
    board_settled = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_PROJECT_ORDER,
    )

    # ── ACs 1/6 + preservation, read off the settled DOM in one pass ──────────
    dom = page.evaluate(
        """keys => {
             const q = s => document.querySelector(s);
             const anatomy = {};
             for (const k of keys) {
               const h = q(`[data-testid="rail-heading-${k}"]`);
               anatomy[k] = h === null ? null : {
                 dash: !!h.querySelector('[data-testid="heading-dashboard"]'),
                 plus: !!h.querySelector('[data-testid="heading-new"]'),
               };
             }
             return {
               anatomy,
               quick: !!q('[data-testid="rail-quick"]'),
               actions: !!q('[data-testid="rail-actions"]'),
               runs: !!q('[data-testid="rail-runs"]'),
               settingsSection: !!q('[data-testid="rail-settings-section"]'),
               logoSlot: !!q('[data-testid="logo-slot"]'),
               connectionDot: q('[data-testid="connection-dot"]')?.dataset.state ?? null,
               chromeGear: !!q('[data-testid="chrome-settings"]'),
             }; }""",
        HEADING_KEYS,
    )
    a = dom["anatomy"]
    headings_ok = all(a[k] is not None for k in HEADING_KEYS)
    settings_iconless_ok = headings_ok and not a["settings"]["dash"] and not a["settings"]["plus"]
    four_icons_ok = headings_ok and all(
        a[k]["dash"] and a[k]["plus"] for k in ("projects", "make", "chat", "repos"))
    superseded_ok = not (dom["quick"] or dom["actions"] or dom["runs"] or dom["settingsSection"])
    preserved_ok = dom["logoSlot"] and dom["connectionDot"] == "connected" and not dom["chromeGear"]

    # ── AC 2 (EC26) + the preserved attention order, via two title clicks ──────
    page.locator('[data-testid="rail-title-projects"]').click()
    projects_open = settled(
        """expected => { const open = Array.from(document.querySelectorAll(
               '[data-testid^="rail-heading-"]'))
               .filter(h => h.getAttribute('aria-expanded') === 'true');
             if (open.length !== 1 || open[0].dataset.testid !== 'rail-heading-projects') return false;
             const ids = Array.from(document.querySelectorAll(
               '[data-testid="rail-heading-projects"] [data-testid="rail-project"]'))
               .map(r => r.dataset.projectId);
             return JSON.stringify(ids.slice(0, 4)) === JSON.stringify(expected); }""",
        EXPECTED_PROJECT_ORDER,
        timeout=10000,
    )

    # ── Capture 1: the five-path rail, Projects expanded ───────────────────────
    page.locator('[data-testid="left-rail"]').screenshot(
        path=str(VSHOTS / "feedback-A-rail-expanded.png"))

    # ── AC 4: the settings menuitem list, inside the Settings ACCORDION ────────
    page.locator('[data-testid="rail-title-settings"]').click()
    settings_open = settled(
        """() => { const open = Array.from(document.querySelectorAll(
                     '[data-testid^="rail-heading-"]'))
                     .filter(h => h.getAttribute('aria-expanded') === 'true');
                   return open.length === 1
                       && open[0].dataset.testid === 'rail-heading-settings'
                       && open[0].querySelectorAll('[role="menuitem"]').length >= 7; }""",
        timeout=5000,
    )
    ec26_state = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'))
              .filter(h => h.getAttribute('aria-expanded') === 'true').length""")
    ec26_ok = settings_open and ec26_state == 1
    settings_entries = page.evaluate(
        """() => Array.from(document.querySelectorAll(
             '[data-testid="rail-heading-settings"] [role="menuitem"]')).map(b => b.textContent)""")
    settings_entries_ok = "Theme" in settings_entries and "System" in settings_entries
    version_line_ok = page.evaluate(
        """() => /v\\d+\\.\\d+\\.\\d+/.test(document.querySelector(
             '[data-testid="rail-heading-settings"]')?.textContent ?? '')""")

    # ── AC 3 (EC20 amended): no `+` inside the open accordion's CONTENTS ───────
    # The heading-level ＋ (U+FF0B) is sanctioned; the ASCII `+` glyph must not
    # ride inside contents. Check the two accordions this page opened.
    ec20_ok = page.evaluate(
        """() => { const openIds = ['projects', 'settings'];
                   return openIds.every(k => {
                     const h = document.querySelector(`[data-testid="rail-heading-${k}"]`);
                     const rows = h?.querySelectorAll('[role="menuitem"], [data-testid="rail-project"]') ?? [];
                     return Array.from(rows).every(r => !(r.textContent ?? '').includes('+'));
                   }); }""")

    page.locator('[data-testid="rail-title-settings"]').click()  # back to closed

    # ── AC 5: Projects' ＋ opens the modal; fill the name ──────────────────────
    page.locator('[data-testid="rail-heading-projects"] [data-testid="heading-new"]').click()
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
    "ok": all([fonts_ok, board_settled, headings_ok, settings_iconless_ok,
               four_icons_ok, superseded_ok, preserved_ok, projects_open,
               ec26_ok, settings_entries_ok, version_line_ok, ec20_ok,
               modal_ok, modal_closes]),
    "web_fonts_loaded": fonts_ok,
    "board_settled_w2": board_settled,
    "ac1_five_headings": headings_ok,
    "ac1_settings_iconless": settings_iconless_ok,
    "ac1_four_headings_carry_both_icons": four_icons_ok,
    "ac6_superseded_testids_absent": superseded_ok,
    "preserved_chrome_no_gear": preserved_ok,
    "projects_accordion_attention_order": projects_open,
    "ac2_ec26_one_open_after_two_clicks": ec26_ok,
    "ac4_settings_entries": settings_entries,
    "ac4_settings_carries_theme_and_system": settings_entries_ok,
    "ac4_version_line": version_line_ok,
    "ac3_ec20_no_plus_in_contents": ec20_ok,
    "ac5_modal_opens_name_filled": modal_ok,
    "modal_closes_on_escape": modal_closes,
    "anatomy": dom["anatomy"],
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("feedback-A-rail-expanded.png", "feedback-A-new-project-modal.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "re-scoped slice-A DOM assertions did not all hold — see dom_acs")

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
