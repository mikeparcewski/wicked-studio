#!/usr/bin/env python3
"""
ux2_fixC6_test.py — the BRIEF-UX-002 final-gate C6 MAJOR pin: the home board's
WORKING band derives from run DTO STATUS, never from a decaying clock.

The live-observed failure (rereview5): with 2 runs actively EXECUTING, the
board's active card rendered in exactly ONE 25s sample, then decayed back to
QUIET ("Nothing needs you right now", chip "·15h") for ~5 of 6 minutes — while
the same page's footer said "2 working" and the rail streamed the run's phases.
Root cause: the band hung off the decayed attention score, whose `running`
clock ladder bottomed out at a 15h-stale project clock when no live frame had
arrived yet. Two conflations rode along: the no-gate WORKING card rendered
under the "NEEDS YOU" header, and the quiet chip stamped live work "·15h".

This rig runs the shared W2 fixture under the `c6_stale` switch — the exact
reproduction posture: r-upload EXECUTING while every clock the board can read
for upload-endpoint (project.updated_at, the attach clock) is 15 HOURS stale
and the /ws narration for it is MUTED. The only working evidence the board
holds is the run DTO status — which is precisely what the fix derives from.

The ACs, DOM-verbatim:

  1. WORKING, not QUIET, on a cold load: the upload-endpoint card renders
     data-band="working" (ACTIVE variant) inside its OWN
     `[data-testid="band-working"]` section headed "Working" — NEVER under
     the NEEDS YOU header, and NO quiet-chip for it anywhere (the "·15h"
     stale-freshness chip cannot exist because the project never lands in
     QUIET while a run is non-terminal);
  2. NEEDS YOU stays gates + fresh failures ONLY: q3-review-deck + api-migration
     (waiting gates) and auth-refactor (13-min-old failure) — upload-endpoint
     is not among them;
  3. survives a reload: a second cold load lands the card in WORKING again
     (the C6 bug fired on exactly this path — no frames yet, stale clocks);
  4. survives a 60s soak sampled every ~20s (the live decay was caught in a
     25s sample; TICK_MS=60s guarantees at least one decay-clock recompute
     inside the window): data-band === "working" at every sample, and the
     board NEVER shows "Nothing needs you right now" as the only content;
  5. a gate posting for the working run MOVES it to NEEDS YOU (live
     awaitingHuman frame + status flip): band-working empties, the card
     re-renders data-band="needs-you";
  6. idle stays QUIET throughout: the 20 quiet clones never enter WORKING
     (band-working data-count is exactly 1 before the gate posts), and the
     quiet band keeps its population.

Captures (§12.0 contract: 1440x900, dsf=1) into e2e/shots/vision/:
  ux-C6-working-band.png   cold load: WORKING band between NEEDS YOU and QUIET
  ux-C6-soak.png           after the 60s soak: the card has NOT decayed
  ux-C6-gate-posted.png    the gate posted: the card now under NEEDS YOU

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4413),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import time

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4413"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

CARD = '[data-testid="project-card"][data-project-id="upload-endpoint"]'
WORKING_BAND = '[data-testid="band-working"]'
NEEDS_BAND = '[data-testid="band-needs-you"]'

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


def board_state(page) -> dict:
    """One DOM read: everything the ACs assert about the three bands."""
    return page.evaluate(
        """() => {
          const board = document.querySelector('[data-testid="project-board"]');
          const card = document.querySelector(
            '[data-testid="project-card"][data-project-id="upload-endpoint"]');
          const workingBand = document.querySelector('[data-testid="band-working"]');
          const needsCards = [...document.querySelectorAll(
            '[data-testid="band-needs-you"] [data-testid="project-card"]')]
            .map((c) => c.dataset.projectId);
          const workingCards = [...document.querySelectorAll(
            '[data-testid="band-working"] [data-testid="project-card"]')]
            .map((c) => c.dataset.projectId);
          const quietChipIds = [...document.querySelectorAll(
            '[data-testid="quiet-chip"]')].map((c) => c.dataset.projectId);
          const workingLabel = workingBand
            ? workingBand.querySelector('p')?.textContent ?? null : null;
          return {
            working: Number(board?.dataset.working ?? -1),
            needsYou: Number(board?.dataset.needsYou ?? -1),
            quiet: Number(board?.dataset.quiet ?? -1),
            cardBand: card?.dataset.band ?? null,
            cardVariant: card?.dataset.variant ?? null,
            cardInWorking: workingCards.includes('upload-endpoint'),
            cardInNeeds: needsCards.includes('upload-endpoint'),
            needsCards,
            workingCards,
            workingLabel,
            uploadQuietChip: quietChipIds.includes('upload-endpoint'),
            quietChipCount: quietChipIds.length,
            allQuietLine: !!document.querySelector('[data-testid="board-all-quiet"]'),
            cardText: card?.textContent ?? '',
          };
        }""")


def assert_working(step: str, s: dict) -> None:
    """The AC-1/AC-2 invariant, applied at every sample point."""
    check(step,
          s["cardBand"] == "working"
          and s["cardVariant"] == "active"
          and s["cardInWorking"]
          and not s["cardInNeeds"]
          and s["working"] == 1
          and s["workingLabel"] == "Working"
          and not s["uploadQuietChip"]
          and "15h" not in s["cardText"]
          # NEEDS YOU is gates + the fresh failure, never the executing run.
          and set(s["needsCards"]) == {"q3-review-deck", "api-migration", "auth-refactor"},
          **{k: v for k, v in s.items() if k != "cardText"})


# ── 1. The same-origin build + the stale-clock reproduction switched ON ───────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, c6_stale=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # ── Scene 1 (AC 1 + 2): cold load — WORKING off the DTO status alone ───────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator(f"{WORKING_BAND} {CARD}").wait_for(timeout=30000)
    s1 = board_state(page)
    assert_working("cold_load_working", s1)
    # AC 6 half: the calm majority is untouched — quiet population intact.
    check("idle_stays_quiet", s1["quiet"] >= 20 and s1["quietChipCount"] > 0,
          quiet=s1["quiet"], chips=s1["quietChipCount"])
    page.screenshot(path=str(VSHOTS / "ux-C6-working-band.png"))

    # ── Scene 2 (AC 3): a reload lands in WORKING again — the exact C6 path
    #    (fresh page, zero frames, every clock stale) ─────────────────────────────
    page.reload(wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator(f"{WORKING_BAND} {CARD}").wait_for(timeout=30000)
    assert_working("reload_still_working", board_state(page))

    # ── Scene 3 (AC 4): the 60s soak, sampled inside the observed decay window —
    #    TICK_MS=60s guarantees at least one decay-clock recompute in-window ─────
    samples: list[dict] = []
    t0 = time.monotonic()
    for wait_s in (20, 20, 25):  # samples at ~20s / ~40s / ~65s
        page.wait_for_timeout(wait_s * 1000)
        s = board_state(page)
        samples.append({"t_s": round(time.monotonic() - t0),
                        "band": s["cardBand"], "working": s["working"],
                        "allQuietLine": s["allQuietLine"]})
        assert_working(f"soak_sample_{samples[-1]['t_s']}s", s)
    report["steps"]["soak_no_decay"] = {"ok": True, "samples": samples}
    page.screenshot(path=str(VSHOTS / "ux-C6-soak.png"))

    # ── Scene 4 (AC 5): the gate posts for the working run — it MOVES to
    #    NEEDS YOU (live awaitingHuman frame + the status flip on the wires) ─────
    set_fixture(ORIGIN, gate_now=["r-upload"], extra_gates=[
        {"session": "r-upload", "ord": 0,
         "prompt": "Approve the rate-limit middleware?"},
    ])
    page.wait_for_function(
        """(card) => document.querySelector(card)?.dataset.band === 'needs-you'""",
        arg=CARD, timeout=15000)
    s4 = board_state(page)
    check("gate_moves_to_needs_you",
          s4["cardInNeeds"]
          and not s4["cardInWorking"]
          and s4["working"] == 0
          and "upload-endpoint" in s4["needsCards"]
          and not s4["uploadQuietChip"],
          **{k: v for k, v in s4.items() if k != "cardText"})
    page.screenshot(path=str(VSHOTS / "ux-C6-gate-posted.png"))

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
