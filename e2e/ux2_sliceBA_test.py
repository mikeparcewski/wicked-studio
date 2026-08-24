#!/usr/bin/env python3
"""
ux2_sliceBA_test.py — the DES-UX-002 slice-BA gate: the portfolio nerve
center's active-card enrichment (§1 — brief DoD conditions 1 and 6: "see live
evidence accumulating without entering the run"; "the nerve center shows
gate-approaching and quiet accumulation"). Runs against the shared frozen-NOW0
W2 fixture (uxfix_fixture.py) with `nerve` switched on: r-upload (executing)
carries the §1.5 five-unit plan — 2 done, 1 distributed, 2 pending.

The §1.5 DOM ACs, verbatim mapping:

  1. the ACTIVE card renders `[data-testid="phase-strip"]` with 5 nodes; the
     active node carries `data-active="true"`; the 2 done nodes carry
     `data-complete="true"` (EC46);
  2. a `gateEscalated` fixture event renders `[data-testid="gate-approaching"]`
     with `data-criterion` populated BEFORE the gate posts; NO Approve/Reject
     buttons visible in the pre-gate state (EC47) — and the preview RETIRES
     when `awaitingHuman` posts the gate;
  3. `[data-testid="active-unit-description"]` renders the current unit's
     description truncated to 60 chars and MOVES on a live `unitDispatched`
     frame (injected over the same /ws the app already holds);
  4. the live-feed block for the same project renders
     `[data-testid="feed-phase-line"]` spelling `phase n/N · stage-name`,
     which moves with the dispatch too;
  5. request-tap: the card enrichment fires ZERO new HTTP requests — the
     `unitDispatched` and `gateEscalated` frames repaint the board from the
     /ws relay + the already-fetched SessionView alone.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-BA-phase-strip.png       the enriched ACTIVE card: strip + description
  ux-BA-feed-phase.png        the sidebar block after the live dispatch moved it
  ux-BA-gate-approaching.png  the pre-gate posture: amber ring, criterion, no buttons

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4407),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import time
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NERVE_UPLOAD_UNITS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4407"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

CARD = '[data-testid="project-card"][data-project-id="upload-endpoint"]'
FEED = '[data-testid="live-feed-block-upload-endpoint"]'

# The gate criterion the daemon escalates with (wire field: `condition` — the
# slice-BB verified spelling). >40 chars on purpose: the feed line's §1.3
# truncation needs a real overflow.
CRITERION = ("the rate-limit middleware keeps every existing upload test green "
             "and enforces the burst budget")

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


# ── 1. The same-origin build + the shared W2 fixture with the nerve plan ON ────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, nerve=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN,
                                     "plan_units": len(NERVE_UPLOAD_UNITS)}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap (AC 5): every API request the page fires, by path.
    api_requests: list[str] = []
    page.on("request", lambda req: api_requests.append(urlparse(req.url).path)
            if "/api/v1/" in req.url else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator(CARD).wait_for(timeout=30000)

    # ── Scene 1 (AC 1 / EC46): the strip — 5 nodes, 2 complete, 1 active ────────
    page.locator(f'{CARD} [data-testid="phase-strip"]').wait_for(timeout=15000)
    strip = page.evaluate(
        """(card) => {
          const root = document.querySelector(card);
          const nodes = [...root.querySelectorAll('[data-testid="phase-node"]')];
          const desc = root.querySelector('[data-testid="active-unit-description"]');
          return {
            variant: root.dataset.variant,
            nodeCount: nodes.length,
            stages: nodes.map((n) => n.dataset.stage),
            complete: nodes.filter((n) => n.dataset.complete === 'true').length,
            activeIx: nodes.findIndex((n) => n.dataset.active === 'true'),
            overflow: !!root.querySelector('[data-testid="phase-strip-overflow"]'),
            descText: desc?.textContent ?? null,
            descTitle: desc?.getAttribute('title') ?? null,
            descRunId: desc?.dataset.runId ?? null,
          };
        }""", CARD)
    check("phase_strip_five_nodes",
          strip["variant"] == "active"
          and strip["nodeCount"] == 5
          and strip["stages"] == ["recon", "build", "review", "build", "test"]
          and strip["complete"] == 2
          and strip["activeIx"] == 2
          and not strip["overflow"],
          **strip)

    # ── Scene 2 (AC 3, truncation half): 60 chars, honest ellipsis, full text
    #    on the tooltip ─────────────────────────────────────────────────────────
    full_desc = NERVE_UPLOAD_UNITS[2]["description"]
    check("description_truncated_60",
          strip["descRunId"] == "r-upload"
          and strip["descTitle"] == full_desc
          and len(full_desc) > 60
          and strip["descText"] is not None
          and len(strip["descText"]) == 60
          and strip["descText"].endswith("…")
          and strip["descText"].startswith(full_desc[:40]),
          desc_len=len(strip["descText"] or ""), title_len=len(full_desc))

    # ── Scene 3 (AC 4): the sidebar block's phase line ───────────────────────────
    feed = page.evaluate(
        """(sel) => {
          const block = document.querySelector(sel);
          return {
            phaseLine: block?.querySelector('[data-testid="feed-phase-line"]')?.textContent ?? null,
            unitDesc: block?.querySelector('[data-testid="feed-unit-description"]')?.textContent ?? null,
          };
        }""", FEED)
    check("feed_phase_line",
          feed["phaseLine"] == "phase 3/5 · review"
          and feed["unitDesc"] is not None
          and feed["unitDesc"].startswith("review the rate-limit middleware"),
          **feed)
    page.screenshot(path=str(VSHOTS / "ux-BA-phase-strip.png"))

    # ── Scene 4 (AC 3 live half + AC 5): a unitDispatched frame moves the
    #    description AND the strip AND the feed line — with ZERO new HTTP ─────────
    page.wait_for_timeout(1500)  # let the boot-time fetch storm fully settle
    reads_before = len(api_requests)
    set_fixture(ORIGIN, extra_frames=[
        {"type": "unitDispatched", "session": "r-upload", "ord": 3, "attempt": 0},
    ])
    t0 = time.monotonic()
    page.wait_for_function(
        """(card) => document.querySelector(card + ' [data-testid="active-unit-description"]')
             ?.textContent === 'apply the review fixes to the middleware chain'""",
        arg=CARD, timeout=10000)
    moved_ms = int((time.monotonic() - t0) * 1000)
    after = page.evaluate(
        """([card, feedSel]) => {
          const nodes = [...document.querySelector(card)
            .querySelectorAll('[data-testid="phase-node"]')];
          return {
            activeIx: nodes.findIndex((n) => n.dataset.active === 'true'),
            feedPhase: document.querySelector(feedSel + ' [data-testid="feed-phase-line"]')
              ?.textContent ?? null,
            feedDesc: document.querySelector(feedSel + ' [data-testid="feed-unit-description"]')
              ?.textContent ?? null,
          };
        }""", [CARD, FEED])
    page.wait_for_timeout(800)  # a late fetch would land here
    check("dispatch_moves_the_board",
          after["activeIx"] == 3
          and after["feedPhase"] == "phase 4/5 · build"
          and after["feedDesc"] == "apply the review fixes to the middleware chain",
          moved_ms=moved_ms, **after)
    check("dispatch_zero_new_requests",
          len(api_requests) == reads_before,
          reads_before=reads_before, reads_after=len(api_requests),
          tail=api_requests[reads_before:])
    page.screenshot(path=str(VSHOTS / "ux-BA-feed-phase.png"))

    # ── Scene 5 (AC 2 / EC47 + AC 5): gateEscalated → the APPROACHING posture,
    #    criterion named, NO Approve/Reject, zero new HTTP ───────────────────────
    reads_before = len(api_requests)
    set_fixture(ORIGIN, extra_frames=[
        {"type": "gateEscalated", "session": "r-upload", "ord": 3,
         "condition": CRITERION,
         "verdictSummary": "agent judge: fail — the burst budget is not enforced"},
    ])
    page.locator(f'{CARD} [data-testid="gate-approaching"]').wait_for(timeout=10000)
    page.wait_for_timeout(800)  # a late fetch would land here
    approaching = page.evaluate(
        """([card, feedSel]) => {
          const root = document.querySelector(card);
          const chip = root.querySelector('[data-testid="gate-approaching"]');
          const feedGate = document.querySelector(
            feedSel + ' [data-testid="feed-gate-approaching"]');
          return {
            criterion: chip?.dataset.criterion ?? null,
            runId: chip?.dataset.runId ?? null,
            text: chip?.textContent ?? '',
            approveVisible: !!root.querySelector('[data-testid="gate-approve-r-upload"]'),
            rejectVisible: !!root.querySelector('[data-testid="gate-reject-r-upload"]'),
            feedGateText: feedGate?.textContent ?? null,
            feedGateTitle: feedGate?.getAttribute('title') ?? null,
          };
        }""", [CARD, FEED])
    check("gate_approaching_pre_gate",
          approaching["criterion"] == CRITERION
          and approaching["runId"] == "r-upload"
          and "gate approaching" in approaching["text"]
          and not approaching["approveVisible"]
          and not approaching["rejectVisible"],
          **{k: v for k, v in approaching.items() if not k.startswith("feed")})
    # The feed's amber line: truncated to 40 chars, full criterion on the tooltip.
    check("feed_gate_approaching",
          approaching["feedGateText"] is not None
          and approaching["feedGateText"].startswith("⏳ gate: ")
          and len(approaching["feedGateText"]) <= len("⏳ gate: ") + 40
          and approaching["feedGateText"].endswith("…")
          and approaching["feedGateTitle"] == CRITERION,
          feedGateText=approaching["feedGateText"])
    check("escalation_zero_new_requests",
          len(api_requests) == reads_before,
          reads_before=reads_before, reads_after=len(api_requests),
          tail=api_requests[reads_before:])
    page.screenshot(path=str(VSHOTS / "ux-BA-gate-approaching.png"))

    # ── Scene 6 (AC 2, the posture switch): awaitingHuman posts the gate — the
    #    preview retires (the full pill is the standing GateChip contract, owned
    #    by the run status on the wire; the preview must never outlive the post) ─
    set_fixture(ORIGIN, extra_gates=[
        {"session": "r-upload", "ord": 3, "prompt": "Approve the middleware review?"},
    ])
    page.wait_for_function(
        """(card) => !document.querySelector(card + ' [data-testid="gate-approaching"]')""",
        arg=CARD, timeout=10000)
    check("approaching_retires_on_post", True)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
