#!/usr/bin/env python3
"""
vision_slice2_test.py — the DES-VISION-001 slice-2 gate: the orchestrator home
reimagined (§5.1, §6.3 slice 2), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py — §6.2).

The slice DOM ACs, verbatim from §6.3:

  1. `data-testid="live-feed"` is present and non-empty when at least one
     project has an active run;
  2. a `unitOutputDelta` for a project updates its `live-feed-block-<id>`
     within 2s without navigation (the fixture's `extra_narration` switch
     pushes ONE new line mid-page over the same /ws);
  3. `getComputedStyle([data-testid="project-card"])` resolves `background`
     from `var(--surface-card)` — EC15 passing for these components. Asserted
     by PROBE, not by a hex copied into this file: a probe element is given
     `background: var(--surface-card)` and the card must computed-match it;
  4. the 2px status bar's `border-top-color` matches `--status-gate` for the
     gate-waiting card (q3-review-deck) — same probe technique — and
     `--status-fail` for the fresh failure (auth-refactor).

Plus the slice's checklist reads (§6.1): EC3/EC4 (bands + decay preserved from
UXFIX — the W2 order and the 8-day failure demoted), EC12 (the accent is NOT
any status color), EC13 (narration computed mono, name computed sans), EC14
(the feed reflects the delta), EC15 (probe assertions above), and the §6.3
preservation list (quiet-summary budget, answerable gate chips).

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-2-home-live-feed.png   the full W2 board + live feed
  vision-2-active-card.png      ACTIVE card closeup: status bar + mono narration
                                + answerable gate chip, all token-built

Finally: `npm run lint` must exit 0 with ZERO findings in this slice's files
(the no-raw-color rule is ERROR there now) while the warn-mode baseline still
fires elsewhere.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: VISION_PORT (default 4341),
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
    set_fixture,
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4341"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# The one-shot narration line posted mid-page (AC 2): distinct from the loop's
# repeated NARRATION so "the feed updated" is a NEW string appearing, not the
# old one persisting.
FRESH_LINE = "Applying the token bucket to PUT /upload"

# This slice's error-mode files (eslint.config.mjs TOKEN_CLEAN): lint findings
# here are FAILURES now, and the gate greps for them by name.
SLICE_FILES = ["HomeBoard.tsx", "LiveFeed.tsx", "ProjectCard.tsx",
               "GateChip.tsx", "useBoardHeadline.ts"]

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]

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
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Freeze Date.now at NOW0 + 5s BEFORE the app boots (timers keep running —
    # the /ws narration and the attention sorts still happen), so every rendered
    # age ("30s", "12m", "8d") is deterministic in the captures.
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # The SAME settled state every board rig waits on: the W2 NEEDS YOU order
    # (EC3/EC4 — bands + decay preserved: the 8-day failure is NOT here) and the
    # live narration having streamed at least once.
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
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    # ── AC 1: the feed exists and is non-empty while runs are active ──────────
    feed_ok = settled(
        """() => { const f = document.querySelector('[data-testid="live-feed"]');
                   return !!f && f.querySelectorAll('[data-testid^="live-feed-block-"]').length > 0
                       && (f.textContent ?? '').trim() !== ''; }""",
    )
    # The executing project narrates in its block; the fresh failure gets its
    # fail block with [open run]; the DECAYED failure (legacy-spike, 8d) and the
    # gate-waiting q3 (answerable on the card, §1.3) get no block.
    blocks = page.evaluate(
        """() => ({
             upload: document.querySelector('[data-testid="live-feed-block-upload-endpoint"]')?.textContent ?? null,
             auth: document.querySelector('[data-testid="live-feed-block-auth-refactor"]')?.textContent ?? null,
             authOpenRun: !!document.querySelector(
               '[data-testid="live-feed-block-auth-refactor"] [data-testid="feed-open-run"]'),
             legacy: !!document.querySelector('[data-testid="live-feed-block-legacy-spike"]'),
             q3: !!document.querySelector('[data-testid="live-feed-block-q3-review-deck"]'),
           })""")
    membership_ok = (
        blocks["upload"] is not None and NARRATION in blocks["upload"]
        and blocks["auth"] is not None and "failed" in blocks["auth"] and blocks["authOpenRun"]
        and not blocks["legacy"] and not blocks["q3"])

    # ── AC 2 / EC14: a NEW delta lands in the block within 2s, no navigation ──
    set_fixture(ORIGIN, extra_narration=[FRESH_LINE])
    feed_updated = settled(
        """text => (document.querySelector('[data-testid="live-feed-block-upload-endpoint"]')
             ?.textContent ?? '').includes(text)""",
        FRESH_LINE,
        timeout=2000,
    )

    # ── AC 3/4 + EC12/EC13/EC15: computed styles resolve FROM the tokens ──────
    styles = page.evaluate(
        """() => {
             // Probe: what each token computes to on this page — the assertion
             // target, so no hex is duplicated into the rig.
             const probe = name => { const el = document.createElement('div');
               el.style.background = `var(${name})`;
               document.body.appendChild(el);
               const v = getComputedStyle(el).backgroundColor;
               el.remove(); return v; };
             const card = document.querySelector(
               '[data-testid="project-card"][data-project-id="q3-review-deck"]');
             const authCard = document.querySelector(
               '[data-testid="project-card"][data-project-id="auth-refactor"]');
             const cardCs = getComputedStyle(card);
             const line = document.querySelector(
               '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]');
             const feedLine = document.querySelector(
               '[data-testid="live-feed"] [data-testid="feed-line"]');
             const name = card.querySelector('a');
             return {
               surfaceCard: probe('--surface-card'),
               statusGate: probe('--status-gate'),
               statusFail: probe('--status-fail'),
               accent: probe('--accent'),
               cardBackground: cardCs.backgroundColor,
               gateBarColor: cardCs.borderTopColor,
               gateBarWidth: cardCs.borderTopWidth,
               failBarColor: getComputedStyle(authCard).borderTopColor,
               narrationFont: line ? getComputedStyle(line).fontFamily : null,
               feedLineFont: feedLine ? getComputedStyle(feedLine).fontFamily : null,
               nameFont: name ? getComputedStyle(name).fontFamily : null,
             }; }""")
    ec15_card_bg = styles["cardBackground"] == styles["surfaceCard"]
    bar_gate_ok = styles["gateBarColor"] == styles["statusGate"] and styles["gateBarWidth"] == "2px"
    bar_fail_ok = styles["failBarColor"] == styles["statusFail"]
    # EC12: the accent is singular — it is none of the status colors.
    ec12_ok = styles["accent"] not in (styles["statusGate"], styles["statusFail"])
    # EC13: narration (card + feed) computed MONO; the project name is NOT mono.
    ec13_ok = (
        styles["narrationFont"] is not None and "JetBrains Mono" in styles["narrationFont"]
        and styles["feedLineFont"] is not None and "JetBrains Mono" in styles["feedLineFont"]
        and styles["nameFont"] is not None and "JetBrains Mono" not in styles["nameFont"])

    # ── The §6.3 preservation list, read off the live DOM ─────────────────────
    preserved = page.evaluate(
        """() => { const q3 = document.querySelector(
                     '[data-testid="project-card"][data-project-id="q3-review-deck"]');
                   return {
                     bands: !!document.querySelector('[data-testid="band-needs-you"]')
                         && !!document.querySelector('[data-testid="band-quiet"]'),
                     gateAnswerable: !!q3?.querySelector('[data-testid="gate-approve-r-q3"]')
                         && !!q3?.querySelector('[data-testid="gate-reject-r-q3"]'),
                     // EC4's decay pair: the 8-day failure is DEMOTED out of the
                     // live band while the fresh one leads (boardAttention untouched).
                     legacyDemoted: !document.querySelector(
                       '[data-testid="band-needs-you"] [data-project-id="legacy-spike"]'),
                   }; }""")

    # ── The named screenshots (§6.3) — before any state-mutating interaction ──
    page.screenshot(path=str(VSHOTS / "vision-2-home-live-feed.png"))
    page.locator('[data-testid="project-card"][data-project-id="q3-review-deck"]') \
        .screenshot(path=str(VSHOTS / "vision-2-active-card.png"))

    # Expand QUIET and read the empty-state budget off the mounted quiet cards:
    # absence is still exactly ONE `quiet-summary` line per card (§6.3 preserved).
    page.locator('[data-testid="band-quiet-toggle"]').click()
    budget_ok = settled(
        """() => { const cards = Array.from(document.querySelectorAll(
                     '[data-testid="project-card"][data-variant="quiet"]'));
                   return cards.length > 0 && cards.every(c =>
                     c.querySelectorAll('[data-testid="quiet-summary"]').length === 1); }""")
    preserved["quietBudgetOneLine"] = budget_ok
    preserved_ok = all(preserved.values())
    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([order_ok, narration_ok, fonts_ok, feed_ok, membership_ok, feed_updated,
               ec15_card_bg, bar_gate_ok, bar_fail_ok, ec12_ok, ec13_ok, preserved_ok]),
    "board_settled_w2_order": order_ok,
    "live_narration_streamed": narration_ok,
    "web_fonts_loaded": fonts_ok,
    "live_feed_present_nonempty": feed_ok,
    "feed_blocks": blocks,
    "feed_membership_ok": membership_ok,
    "feed_updated_within_2s": feed_updated,
    "computed": styles,
    "ec15_card_bg_from_surface_card_token": ec15_card_bg,
    "status_bar_2px_gate_token": bar_gate_ok,
    "status_bar_fail_token": bar_fail_ok,
    "ec12_accent_not_a_status_color": ec12_ok,
    "ec13_mono_narration_sans_labels": ec13_ok,
    "uxfix_preserved": preserved,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("vision-2-home-live-feed.png", "vision-2-active-card.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-2 DOM assertions did not all hold — see dom_acs")

# ── 4. Lint posture: exit 0; ZERO findings in the error-mode slice files ──────
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
slice_hits = [f for f in SLICE_FILES if f in out]
baseline_warnings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and not slice_hits and baseline_warnings > 0,
    "exit_code": r.returncode,
    "slice_files_with_findings": slice_hits,
    "warn_baseline_still_firing_elsewhere": baseline_warnings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with no findings in the slice-2 "
         "error-mode files (and the warn baseline still firing elsewhere) — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
