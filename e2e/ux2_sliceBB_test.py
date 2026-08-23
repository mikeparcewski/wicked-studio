#!/usr/bin/env python3
"""
ux2_sliceBB_test.py — the DES-UX-002 slice-BB gate: the run evidence timeline
(§2 — brief DoD conditions 3 and 4: "navigate a completed run's evidence
timeline"; "failed run diagnosed in sixty seconds"). Runs against the shared
frozen-NOW0 W2 fixture (uxfix_fixture.py) with `forensics` (r-auth's real-shape
units + the REAL unit-output wire) + `timeline` (r-auth's FULL recorded
chronology: real event_to_json shapes with RecordedEvent ts/seq) + `provenance`
(r-retry, whose session echoes retry_of:"r-auth") switched on.

The §2.5 DOM ACs, verbatim mapping:

  1. the timeline rail renders `[data-testid="timeline"]` with 8 or more rows
     ON FIRST MOUNT (timeline is the DEFAULT lens — EC48), and phase headers
     group `unitDispatched` events by their unit's stage (`phase: recon` /
     `phase: review`, the §2.2 CLIENT derivation — no phase event on the wire);
  2. clicking a `unitOutputCaptured` row renders the transcript in
     `[data-testid="timeline-detail"]` within one frame cycle — request-tap:
     ZERO additional `/units/*/output` fetches at click time (the reused
     WorkUnitDetail mounted, and fetched, with the page);
  3. clicking a `gateEvaluated` row renders `[data-testid="verdict-detail"]` —
     the DES-UX-001 component REUSED (deciding phase ord, agentReasoning,
     denialReason all present);
  4. clicking a `unitReworkAmended` row renders `[data-testid="amendment-diff"]`
     with the amendment text and the amended description in a two-column
     layout beside the ORIGINAL description (EC49);
  5. r-retry (retry_of: "r-auth") renders `[data-testid="retry-link"]` in the
     timeline header; clicking it navigates to the parent run's timeline
     (`location.pathname` == /runs/r-auth);
  6. the pre-BB view remains accessible via `[data-testid="tab-unit-list"]`
     and renders unchanged: FailureBanner ABOVE the unit spine, transcripts
     auto-opened (the slice-R regression pin, re-verified in the two-tab
     layout).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-BB-timeline-rail.png     the default timeline lens: rail + empty detail
  ux-BB-gate-verdict.png      the gateEvaluated row selected — VerdictDetail
  ux-BB-amendment-diff.png    the unitReworkAmended row selected — the diff

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4406),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    FORENSICS_GATE_DENY,
    HIDE_GATE_TOASTS,
    REPO,
    TIMELINE_AMENDMENT,
    TIMELINE_AUTH_EVENTS,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4406"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

AUTH_THREAD = "/p/auth-refactor/build/r-auth"
RETRY_THREAD = "/runs/r-retry"

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


# ── 1. The same-origin build + the shared W2 fixture: forensics + timeline +
#       provenance ON ────────────────────────────────────────────────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, forensics=True, timeline=True, provenance=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN,
                                     "corpus_events": len(TIMELINE_AUTH_EVENTS)}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap: every unit-output read the page fires (AC 2's budget).
    output_reads: list[str] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "GET" and re.search(r"/api/v1/runs/[^/]+/units/[^/]+/output$", path):
            output_reads.append(path)

    page.on("request", on_request)

    def row(event_type: str):
        return page.locator(f'[data-testid="timeline-row"][data-event-type="{event_type}"]').first

    # ── Scene 1 (AC 1 / EC48): the timeline is the DEFAULT lens, ≥8 rows,
    #    phase headers derived from the units' stages ─────────────────────────────
    page.goto(f"{ORIGIN}{AUTH_THREAD}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="timeline"]').wait_for(timeout=30000)
    # No tab was clicked: the timeline mounted as the default (EC48).
    rail = page.evaluate(
        """() => {
          const rows = [...document.querySelectorAll('[data-testid="timeline-row"]')];
          // textContent, not innerText: the header's uppercase is a CSS
          // text-transform — the DOM text keeps the derivation's spelling.
          const phases = [...document.querySelectorAll('[data-testid="timeline-phase"]')]
            .map((el) => el.textContent.trim());
          const under = (label) => {
            // rows between a header and the next header belong to its bucket
            const all = [...document.querySelectorAll(
              '[data-testid="timeline-phase"], [data-testid="timeline-row"]')];
            const start = all.findIndex(
              (el) => el.dataset.testid === 'timeline-phase' && el.textContent.trim() === label);
            if (start === -1) return [];
            const bucket = [];
            for (let i = start + 1; i < all.length; i++) {
              if (all[i].dataset.testid === 'timeline-phase') break;
              bucket.push(all[i].dataset.eventType);
            }
            return bucket;
          };
          return {
            rowCount: rows.length,
            types: rows.map((el) => el.dataset.eventType),
            phases,
            reconBucket: under('phase: recon'),
            reviewBucket: under('phase: review'),
            timelineTabSelected: document.querySelector('[data-testid="tab-timeline"]')
              ?.getAttribute('aria-selected'),
            unitListTabPresent: !!document.querySelector('[data-testid="tab-unit-list"]'),
            emptyDetail: (document.querySelector('[data-testid="timeline-detail"]')
              ?.innerText ?? '').includes('select an event to see its detail'),
          };
        }""")
    check("timeline_default_rail",
          rail["rowCount"] >= 8
          and rail["timelineTabSelected"] == "true"
          and rail["unitListTabPresent"]
          and "phase: recon" in rail["phases"] and "phase: review" in rail["phases"]
          and "unitDispatched" in rail["reconBucket"]
          and "unitOutputCaptured" in rail["reconBucket"]
          and "unitDispatched" in rail["reviewBucket"]
          and rail["emptyDetail"],
          **rail)
    page.screenshot(path=str(VSHOTS / "ux-BB-timeline-rail.png"))

    # ── Scene 2 (AC 2): the captured-output row — transcript in the panel,
    #    ZERO additional output fetches at click time ─────────────────────────────
    # The reused WorkUnitDetail mounted with the page and fetched the survey
    # transcript already; wait for that mount-time fetch to land, then
    # snapshot the tap.
    deadline = 15_000
    while len(output_reads) == 0 and deadline > 0:
        page.wait_for_timeout(250)
        deadline -= 250
    page.wait_for_timeout(500)
    reads_before = len(output_reads)
    row("unitOutputCaptured").click()
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="timeline-detail"]')
          ?.innerText ?? '').includes('Mapped the middleware chain')""",
        timeout=5000)
    page.wait_for_timeout(400)  # a late fetch would land here
    check("output_click_zero_refetch",
          len(output_reads) == reads_before and reads_before >= 1,
          reads_before=reads_before, reads_after=len(output_reads),
          output_reads=list(output_reads))

    # ── Scene 3 (AC 3): the gateEvaluated row — VerdictDetail REUSED ─────────────
    row("gateEvaluated").click()
    page.locator('[data-testid="timeline-detail"] [data-testid="verdict-detail"]').wait_for(
        timeout=10000)
    verdict = page.evaluate(
        """() => {
          const card = document.querySelector('[data-testid="verdict-detail"]');
          const text = card ? card.innerText : '';
          return {
            phaseOrd: card?.getAttribute('data-phase-ord') ?? null,
            hasCriterion: !!document.querySelector('[data-testid="verdict-criterion"]'),
            hasDenial: !!document.querySelector('[data-testid="verdict-denial"]'),
            hasReasoning: text.includes('drops the token-refresh path'),
          };
        }""")
    check("gate_verdict_reused",
          verdict["phaseOrd"] == str(FORENSICS_GATE_DENY["ord"])
          and verdict["hasCriterion"] and verdict["hasDenial"] and verdict["hasReasoning"],
          **verdict)
    page.wait_for_timeout(300)  # let the selection transition settle before the capture
    page.screenshot(path=str(VSHOTS / "ux-BB-gate-verdict.png"))

    # ── Scene 4 (AC 4 / EC49): the amendment diff — original vs amended,
    #    side by side, plus the operator's amendment text ─────────────────────────
    row("unitReworkAmended").click()
    page.locator('[data-testid="amendment-diff"]').wait_for(timeout=10000)
    diff = page.evaluate(
        """() => {
          const d = document.querySelector('[data-testid="amendment-diff"]');
          const orig = document.querySelector('[data-testid="amendment-original"]');
          const amended = document.querySelector('[data-testid="amendment-amended"]');
          const cols = orig && amended
            ? [orig.getBoundingClientRect(), amended.getBoundingClientRect()] : null;
          return {
            text: d?.innerText ?? '',
            origText: orig?.innerText ?? '',
            amendedText: amended?.innerText ?? '',
            sideBySide: !!cols && cols[1].left > cols[0].right - 1
              && Math.abs(cols[0].top - cols[1].top) < 4,
          };
        }""")
    check("amendment_diff",
          TIMELINE_AMENDMENT.split(":")[0] in diff["text"]
          and "review the middleware refactor" in diff["origText"]
          and TIMELINE_AMENDMENT in diff["amendedText"]
          and diff["sideBySide"],
          **{k: (v[:200] if isinstance(v, str) else v) for k, v in diff.items()})
    page.wait_for_timeout(300)  # let the selection transition settle before the capture
    page.screenshot(path=str(VSHOTS / "ux-BB-amendment-diff.png"))

    # ── Scene 5 (AC 6): the Units tab — the slice-R spine, unchanged ─────────────
    page.locator('[data-testid="tab-unit-list"]').click()
    page.locator('[data-testid="unit-list"]').wait_for(timeout=15000)
    page.locator('[data-testid="unit-transcript"]').first.wait_for(timeout=15000)
    spine = page.evaluate(
        """() => {
          const banner = document.querySelector('[data-testid="failure-banner"]');
          const list = document.querySelector('[data-testid="unit-list"]');
          return {
            units: document.querySelectorAll('[data-testid="work-unit"]').length,
            transcripts: document.querySelectorAll('[data-testid="unit-transcript"]').length,
            bannerAboveList: !!banner && !!list
              && !!(banner.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
            timelineGone: !document.querySelector('[data-testid="timeline"]'),
          };
        }""")
    check("unit_list_tab_preserved",
          spine["units"] == 2 and spine["transcripts"] >= 2
          and spine["bannerAboveList"] and spine["timelineGone"],
          **spine)

    # ── Scene 6 (AC 5): the retry-link header — lineage into the parent's
    #    timeline ─────────────────────────────────────────────────────────────────
    page.goto(f"{ORIGIN}{RETRY_THREAD}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="retry-link"]').wait_for(timeout=30000)
    link_text = page.locator('[data-testid="retry-link"]').inner_text()
    page.locator('[data-testid="retry-link"]').click()
    # The link navigates to /runs/r-auth; the §1.5 legacy redirect then
    # canonicalizes a project-filed run into its shell route — either spelling
    # IS the parent run's page, and the timeline must be mounted on it.
    page.wait_for_function(
        "() => location.pathname.endsWith('/r-auth')", timeout=10000)
    page.locator('[data-testid="timeline"]').wait_for(timeout=15000)
    landed = page.evaluate("() => location.pathname")
    check("retry_link_navigates",
          "retry of r-auth" in link_text
          and landed in ("/runs/r-auth", "/p/auth-refactor/build/r-auth"),
          link_text=link_text, landed=landed)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
