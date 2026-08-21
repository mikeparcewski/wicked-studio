#!/usr/bin/env python3
"""
vision_slice6_test.py — the DES-VISION-001 slice-6 gate: the remaining
component token conversion is COMPLETE and §2.11 holds globally (§6.3 slice 6,
EC15 passing for the first time).

Slice 6 is the bulk conversion: every component that still spoke the inherited
GitHub-dark shell palette (the ~1166-warning lint baseline slices 1–5 left)
now consumes the semantic tokens; the legacy --wk-* palette and its Tailwind
aliases are retired; the no-raw-color rule is ERROR repo-wide (the TOKEN_CLEAN
per-file staging deleted) with a PostCSS twin guarding the stylesheets. No
behavioral change, no new features — so the gate is:

  1. EC15 sweep — a getComputedStyle sweep across TEN data-testid elements,
     spanning both long-converted surfaces (rail, card, gate chip) and
     slice-6-converted code (the RunCard STATUS_STYLE phase labels on the home
     board's run chips, RunLink status dots on the Work page): every probed
     background / color / border-color equals the computed value of its
     semantic token, probed via a scratch element so no hex is copied into
     this rig (EC15 globally — the §6.3 DOM AC);
  2. `npm run lint` exits 0 with ZERO §2.11 findings anywhere in src/;
  3. the enforcement posture is the end state: eslint.config.mjs carries the
     rule as ERROR for src/** and no TOKEN_CLEAN allowlist; postcss.config.js
     carries the `no-raw-colors` twin; global.css carries no --wk-* block.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-6-token-complete.png   the settled W2 board — the §6.3 screenshot,
                                confirming zero visual regression from slices
                                1–5 after the bulk conversion (the vision-1
                                pixel gate re-proves this against its baseline;
                                the ONLY home-board deltas slice 6 makes are
                                the §2.6 status recolors of the run-chip phase
                                labels, re-baselined per that rig's flow).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: VISION_PORT (default 4346),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NARRATION,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4346"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
SHOT = VSHOTS / "vision-6-token-complete.png"

FREEZE_MOTION = (
    "*, *::before, *::after { animation: none !important; transition: none !important; }"
)

# The token probe (slice-4's technique): computed color of `var(<name>)` on a
# scratch element — keeps every hex value OUT of this rig.
PROBES = """() => {
  const probe = (name, prop) => { const el = document.createElement('div');
    el.style[prop] = `var(${name})`;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop === 'background' ? 'backgroundColor' : prop];
    el.remove(); return v; };
  return {
    surfaceRail:   probe('--surface-rail', 'background'),
    surfaceCard:   probe('--surface-card', 'background'),
    inkBody:       probe('--ink-body', 'color'),
    statusGate:    probe('--status-gate', 'color'),
    statusGateDim: probe('--status-gate-dim', 'background'),
    statusRun:     probe('--status-run', 'color'),
    statusRunDim:  probe('--status-run-dim', 'background'),
    statusFail:    probe('--status-fail', 'background'),
    statusDone:    probe('--status-done', 'background'),
  }; }"""

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(VISION_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Frozen browser clock (slice-1's determinism recipe) — every rendered age
    # is stable so the shot is comparable across runs.
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    # ── Scene A: the settled W2 board (the §6.3 screenshot + home sweep) ──────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS + "\n" + FREEZE_MOTION)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    narration_ok = settled(
        """text => (document.querySelector(
             '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]')
             ?.textContent ?? '').includes(text)""",
        NARRATION,
    )
    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'""",
        timeout=20000,
    )

    probes = page.evaluate(PROBES)

    # EC15 home sweep — element, property, expected token (probed, not hexed).
    home_sweep = page.evaluate(
        """() => {
      const cs = (sel, prop) => { const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null; };
      const chipSpan = (status, prop) => { const el = document.querySelector(
        `[data-testid="run-chip"][data-status="${status}"] span:not([data-testid="live-edge"])`);
        return el ? getComputedStyle(el)[prop] : null; };
      return {
        leftRailBg:        cs('[data-testid="left-rail"]', 'backgroundColor'),
        projectCardBg:     cs('[data-testid="project-card"]', 'backgroundColor'),
        gateChipBorder:    cs('[data-testid="run-chip"][data-status="awaiting_human"]', 'borderTopColor'),
        gateChipBg:        cs('[data-testid="run-chip"][data-status="awaiting_human"]', 'backgroundColor'),
        gatePhaseColor:    chipSpan('awaiting_human', 'color'),
        execPhaseColor:    chipSpan('executing', 'color'),
        liveLineColor:     cs('[data-testid="live-line"]', 'color'),
        liveLineFont:      cs('[data-testid="live-line"]', 'fontFamily'),
        approveBg:         cs('[data-testid^="gate-approve-"]', 'backgroundColor'),
        approveColor:      cs('[data-testid^="gate-approve-"]', 'color'),
      }; }"""
    )

    page.screenshot(path=str(SHOT))

    home_checks = {
        "left_rail_bg_is_surface_rail": home_sweep["leftRailBg"] == probes["surfaceRail"],
        "project_card_bg_is_surface_card": home_sweep["projectCardBg"] == probes["surfaceCard"],
        "awaiting_chip_border_is_status_gate_dim": home_sweep["gateChipBorder"] == probes["statusGateDim"],
        "awaiting_chip_bg_is_status_gate_dim": home_sweep["gateChipBg"] == probes["statusGateDim"],
        "awaiting_phase_label_is_status_gate": home_sweep["gatePhaseColor"] == probes["statusGate"],
        "executing_phase_label_is_status_run": home_sweep["execPhaseColor"] == probes["statusRun"],
        "live_line_color_is_ink_body": home_sweep["liveLineColor"] == probes["inkBody"],
        "live_line_is_mono": "JetBrains Mono" in (home_sweep["liveLineFont"] or ""),
        "gate_approve_bg_is_status_run_dim": home_sweep["approveBg"] == probes["statusRunDim"],
        "gate_approve_color_is_status_run": home_sweep["approveColor"] == probes["statusRun"],
    }
    report["steps"]["home_sweep"] = {
        "ok": order_ok and narration_ok and fonts_ok and all(home_checks.values()),
        "board_settled_w2_order": order_ok,
        "live_narration_streamed": narration_ok,
        "web_fonts_loaded": fonts_ok,
        **home_checks,
        "computed": home_sweep,
        "screenshot": str(SHOT),
    }

    # ── Scene B: the Work page — slice-6 RunLink status dots (§2.6 vocabulary) ─
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")
    page.locator('[data-testid="run-link"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS + "\n" + FREEZE_MOTION)

    work_sweep = page.evaluate(
        """() => {
      const dot = (status) => { const el = document.querySelector(
        `[data-testid="run-link"][data-status="${status}"] .rounded-full`);
        return el ? getComputedStyle(el).backgroundColor : null; };
      return {
        awaitingDot:  dot('awaiting_human'),
        executingDot: dot('executing'),
        failedDot:    dot('failed'),
        completedDot: dot('completed'),
      }; }"""
    )
    # Re-probe on this document (same stylesheet — belt and braces).
    probes_b = page.evaluate(PROBES)
    work_checks = {
        "awaiting_dot_is_status_gate": work_sweep["awaitingDot"] == probes_b["statusGate"],
        "executing_dot_is_status_run": work_sweep["executingDot"] == probes_b["statusRun"],
        "failed_dot_is_status_fail": work_sweep["failedDot"] == probes_b["statusFail"],
        "completed_dot_is_status_done": work_sweep["completedDot"] == probes_b["statusDone"],
    }
    report["steps"]["work_sweep"] = {
        "ok": all(work_checks.values()),
        **work_checks,
        "computed": work_sweep,
    }

    browser.close()

report["steps"]["console"] = {"ok": len(console_errors) == 0, "errors": console_errors[:10]}
report["screenshots"] = [str(SHOT)]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("dom_acs_verdict", f"slice-6 assertions did not all hold — see {', '.join(bad)}")

# ── 4. Lint: exit 0, ZERO §2.11 findings anywhere (the migration is complete) ──
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
findings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and findings == 0,
    "exit_code": r.returncode,
    "raw_color_findings": findings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with zero §2.11 findings — see lint")

# ── 5. Enforcement posture: the end state, statically read ─────────────────────
eslint_cfg = (REPO / "eslint.config.mjs").read_text()
postcss_cfg = (REPO / "postcss.config.js").read_text()
global_css = (REPO / "src" / "styles" / "global.css").read_text()
posture = {
    "rule_is_error_for_src": "'no-restricted-syntax': ['error', ...NO_RAW_COLOR]" in eslint_cfg
                             and "src/**/*.{ts,tsx}" in eslint_cfg,
    # The machinery, not its mention: the config may NAME the retired allowlist
    # in prose; what must be gone is the declaration and any files: use of it.
    "token_clean_allowlist_deleted": "const TOKEN_CLEAN" not in eslint_cfg
                                     and "files: TOKEN_CLEAN" not in eslint_cfg,
    "warn_mode_gone": "['warn', ...NO_RAW_COLOR]" not in eslint_cfg,
    "postcss_twin_present": "no-raw-colors" in postcss_cfg,
    "wk_palette_retired": "--wk-canvas" not in global_css and ".wk-crew-bg" not in global_css,
}
report["steps"]["posture"] = {"ok": all(posture.values()), **posture}
if not report["steps"]["posture"]["ok"]:
    fail("posture_verdict", "the slice-6 enforcement end state is not in place — see posture")

report["ok"] = True
print(json.dumps(report, indent=2))
