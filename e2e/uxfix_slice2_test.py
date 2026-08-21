#!/usr/bin/env python3
"""
uxfix_slice2_test.py — the DES-UXFIX-001 slice-2 gate: card variants, the
empty-state budget, and the mode-spine quick actions, proven in a real browser
against the W2 messy-reality fixture (§4.2).

Same rig pattern as uxfix_slice1_test.py (which stays the slice-1 gate): the
SHARED deterministic fixture server in `uxfix_fixture.py` serves the
`dist-sameorigin/` build plus every endpoint the home route reads, all
timestamps computed from one frozen NOW0, the live run narrating over the rig's
own /ws. No crew daemon is involved anywhere. This rig never flips the fixture
switches, so it sees the default W2 board (orphan present, 30s q3 gate).

What it asserts (design §4.3, the slice-2 DOM AC):
  1. Every mounted card in band-needs-you carries data-variant="active"; an
     active card with no documents renders NO doc tile — the region is OMITTED
     (auth-refactor and q3-review-deck are the fixture's proof).
  2. Every mounted card in band-quiet (expanded) carries data-variant="quiet",
     exactly ONE data-testid="quiet-summary" line, and none of the region
     furniture (doc-tile / live-line / run-chip).
  3. The banned absence strings appear NOWHERE in the page text: "No documents
     yet", "Nothing running", "No runs yet", "Start here" (F1, §3.7).
  4. The four data-testid="quick-action" per card have distinct data-mode
     (chat/build/document/video) and labels matching MODE_SPECS (Chat / Build /
     Document / Video) — the old near-synonyms ("New chat", "Do work") are gone.
  5. `scratch` (brand-new, empty) shows the first-run invitation as its ONE
     line and the 2×2 sublabelled action grid, sublabels matching MODE_SPECS.
  6. No mounted card is clipped (scrollHeight <= clientHeight + 1): the fixed
     variant heights actually fit their fullest content.

Captures (§4.0 contract: 1440x900 viewport, device_scale_factor=1, waits on
data-testid, never a sleep) into e2e/shots/uxfix/ — gitignored evidence:
  uxfix-2-active-card.png   q3-review-deck: pill, live gate chip, no dead regions
  uxfix-2-quiet-card.png    smoke-tests: the one-line QUIET variant
  uxfix-2-actions.png       scratch: invitation + the four differentiated verbs

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4331), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NARRATION,
    NOW0,
    SHOTS,
    ensure_build,
    start_server,
)

W2_PORT = int(os.environ.get("W2_PORT", "4331"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the slice-1 rig — same dist dir) ─────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (§4.2 — `uxfix_fixture.py`, one frozen NOW0) ─
start_server(W2_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]
# The §1 spine, verbatim from MODE_SPECS — labels and first-run sublabels.
MODE_LABELS = ["Chat", "Build", "Document", "Video"]
MODE_KEYS = ["chat", "build", "document", "video"]
SUBLABELS = [
    "think out loud with an agent",
    "ship code, with checks",
    "a deck, page, or report",
    "record a demo",
]
BANNED = ["No documents yet", "Nothing running", "No runs yet", "Start here", "Unfiled"]

console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # Settle on the DECAYED verdict (the slice-1 order), so every later read and
    # shot is against the final board, not the first paint.
    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    # The live headline is streaming from the rig's own /ws before the shot.
    narration_ok = settled(
        """text => (document.querySelector(
             '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]')
             ?.textContent ?? '').includes(text)""",
        NARRATION,
    )

    # ── AC 3: the banned absence strings appear nowhere on the surface ─────────
    body_text = page.evaluate("() => document.body.innerText")
    banned_hits = [s for s in BANNED if s in body_text]

    # ── AC 1: every NEEDS YOU card is the ACTIVE variant; empty regions omitted ─
    active_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="band-needs-you"] [data-testid="project-card"]'))
              .every(c => c.dataset.variant === 'active'
                       && c.querySelectorAll('[data-testid="quiet-summary"]').length === 0)""")
    # auth-refactor (failed, docless) and q3-review-deck (gated, docless): the
    # Documents region is OMITTED — no tile, no invitation, nothing.
    docless_ok = page.evaluate(
        """() => ['auth-refactor', 'q3-review-deck'].every(id => {
               const c = document.querySelector(`[data-testid="project-card"][data-project-id="${id}"]`);
               return !!c && c.querySelectorAll('[data-testid="doc-tile"]').length === 0; })""")
    # The gate chip is live on the q3 card (§2.1.5 weight — it is why the card leads).
    gate_chip_ok = page.evaluate(
        """() => { const c = document.querySelector('[data-project-id="q3-review-deck"]');
                   return !!c && !!c.querySelector('[data-testid="gate-approve-r-q3"]')
                       && !!c.querySelector('[data-testid="gate-reject-r-q3"]'); }""")
    # The header pill names the signal in user words (V3: 'working', not 'distributing').
    pill_ok = page.evaluate(
        """() => { const kind = id => document.querySelector(
                     `[data-project-id="${id}"] [data-testid="attention-pill"]`)?.textContent ?? '';
                   return kind('q3-review-deck') === 'gate'
                       && kind('auth-refactor') === 'failed'
                       && kind('upload-endpoint') === 'working'; }""")

    # ── AC 4: the mode-spine actions, on every mounted card ────────────────────
    actions_ok = page.evaluate(
        """spine => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
              .every(c => {
                const acts = Array.from(c.querySelectorAll('[data-testid="quick-action"]'));
                const modes = acts.map(a => a.dataset.mode);
                const labels = acts.map(a => a.textContent);
                return acts.length === 4
                    && JSON.stringify(modes) === JSON.stringify(spine.keys)
                    && new Set(modes).size === 4
                    && spine.labels.every((l, i) => labels[i].includes(l));
              })""",
        {"keys": MODE_KEYS, "labels": MODE_LABELS},
    )

    # ── Capture 1: the ACTIVE card (q3-review-deck — pill, gate chip, no dead regions)
    q3 = page.locator('[data-testid="project-card"][data-project-id="q3-review-deck"]')
    q3.locator('[data-testid="gate-approve-r-q3"]').wait_for(timeout=10000)
    q3.screenshot(path=str(SHOTS / "uxfix-2-active-card.png"))

    # ── AC 2 + 5: expand QUIET; the one-line variant and the first-run card ────
    page.locator('[data-testid="band-quiet-toggle"]').click()
    page.locator('[data-testid="band-quiet"][data-expanded="true"]').wait_for(timeout=10000)
    page.locator('[data-testid="band-quiet"] [data-testid="project-card"]').first.wait_for(timeout=10000)

    quiet_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="band-quiet"] [data-testid="project-card"]'))
              .every(c => c.dataset.variant === 'quiet'
                       && c.querySelectorAll('[data-testid="quiet-summary"]').length === 1
                       && c.querySelectorAll('[data-testid="doc-tile"]').length === 0
                       && c.querySelectorAll('[data-testid="live-line"]').length === 0
                       && c.querySelectorAll('[data-testid="run-chip"]').length === 0
                       && c.clientHeight <= 110)""")

    # `scratch` (brand-new, empty): the invitation IS its one line, and the
    # sublabelled grid teaches what each verb produces (§2.2, EC6).
    scratch = page.locator('[data-testid="project-card"][data-project-id="scratch"]')
    scratch.wait_for(timeout=10000)
    firstrun_ok = page.evaluate(
        """subs => { const c = document.querySelector('[data-project-id="scratch"]');
               if (!c) return false;
               const line = c.querySelector('[data-testid="quiet-summary"]');
               const got = Array.from(c.querySelectorAll('[data-testid="quick-action-sublabel"]'))
                   .map(s => s.textContent);
               return !!line && line.dataset.invitation === 'true'
                   && (line.textContent ?? '').includes('Start by describing what you want')
                   && c.querySelector('[data-testid="quick-actions"]')?.dataset.detail === 'true'
                   && JSON.stringify(got) === JSON.stringify(subs); }""",
        SUBLABELS,
    )
    # …and it is the ONLY invitation: every other quiet card says "Quiet — last active".
    others_calm_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll(
              '[data-testid="band-quiet"] [data-testid="project-card"]'))
              .filter(c => c.dataset.projectId !== 'scratch')
              .every(c => /Quiet — last active \\d+[smhd] ago/.test(
                  c.querySelector('[data-testid="quiet-summary"]')?.textContent ?? ''))""")

    # ── Capture 3: the first-run card — invitation + four differentiated verbs ─
    scratch.screenshot(path=str(SHOTS / "uxfix-2-actions.png"))

    # ── Capture 2: a stale-debris QUIET card. smoke-tests (6d) may sit past the
    # mounted window, so scroll the quiet band up and let the window re-mount. ──
    page.evaluate(
        """() => { const b = document.querySelector('[data-testid="project-board"]');
                   b.scrollTop = document.querySelector('[data-testid="band-quiet"]').offsetTop; }""")
    smoke = page.locator('[data-testid="project-card"][data-project-id="smoke-tests"]')
    smoke.wait_for(timeout=10000)
    smoke_summary = smoke.locator('[data-testid="quiet-summary"]').text_content() or ""
    smoke.screenshot(path=str(SHOTS / "uxfix-2-quiet-card.png"))
    smoke_ok = "Quiet — last active 6d ago" in smoke_summary

    # ── AC 6: nothing is clipped — each variant's fixed height fits its content ─
    clipped = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
             .filter(c => c.scrollHeight > c.clientHeight + 1)
             .map(c => `${c.dataset.projectId}:${c.scrollHeight}>${c.clientHeight}`)""")

    ctx.close()
    browser.close()

report["steps"]["slice2_board"] = {
    "ok": all([
        order_ok, narration_ok, not banned_hits, active_ok, docless_ok, gate_chip_ok,
        pill_ok, actions_ok, quiet_ok, firstrun_ok, others_calm_ok, smoke_ok, not clipped,
    ]),
    "needs_you_order_ok": order_ok,
    "live_narration_streamed": narration_ok,
    "banned_strings_found": banned_hits,
    "needs_you_cards_all_active_variant": active_ok,
    "docless_active_cards_omit_documents_region": docless_ok,
    "gate_chip_answerable_on_card": gate_chip_ok,
    "attention_pill_user_words": pill_ok,
    "quick_actions_mode_spine_on_every_card": actions_ok,
    "quiet_cards_one_line_no_furniture": quiet_ok,
    "first_run_invitation_and_sublabels": firstrun_ok,
    "other_quiet_cards_say_last_active": others_calm_ok,
    "smoke_tests_summary": smoke_summary,
    "smoke_tests_summary_ok": smoke_ok,
    "clipped_cards": clipped,
    "console_errors": console_errors[:10],
    "screenshots": [str(SHOTS / n) for n in
                    ("uxfix-2-active-card.png", "uxfix-2-quiet-card.png", "uxfix-2-actions.png")],
}
if not report["steps"]["slice2_board"]["ok"]:
    fail("slice2_verdict", "slice-2 assertions did not all hold — see slice2_board")

report["ok"] = True
print(json.dumps(report, indent=2))
