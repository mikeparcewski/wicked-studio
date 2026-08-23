#!/usr/bin/env python3
"""
ux_sliceR_test.py — the DES-UX-001 slice-R gate: failure forensics (§1, the
campaign's #1 CRITICAL — "a failed run's page shows only a one-line verdict").
Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with its
`forensics` corpus switched on (real wire shapes only): r-auth (failed 13m ago)
carries a done survey with a captured transcript on the REAL
GET /runs/:id/units/:unitKey/output wire (citing /w2/auth-evidence/NOTES.md,
served via extra_write_roots), a rejected review answering the daemon's honest
outputUnavailable, a gateEvaluated deny with the FINDING-025 vacuous
default-allow shape, and a workdir-less /diff answering the REAL 409; r-legacy
(failed 8 days ago) keeps a tail with NO gateEvaluated and a /diff that HANGS.
The `viewer` corpus rides along only for the r-upload baseline-note scene.

The §1.5 DOM ACs, verbatim mapping:

  1. the failed r-auth renders `[data-testid="work-unit"]` (units-as-spine) and
     its `[data-testid="unit-transcript"]` auto-opens (the rejected-unit
     contract, WorkUnitDetail:38) — FailureBanner is the HEADLINE above the
     list, not the whole story (DOM order asserted);
  2. `[data-testid="verdict-detail"]` names the deciding phase
     (`data-phase-ord`), shows the agentReasoning text, and renders
     `[data-vacuous="true"]` with the "default-allow" label (empty
     evaluatorPolicies beside evaluatorPass:true);
  3. r-legacy's verdict card renders `[data-empty="true"]` with the exact copy
     "no evaluator record survives for this run" — never blank, never a
     fabricated verdict;
  4. Full diff on workdir-less r-auth renders `[data-testid="diff-named-cause"]`
     with the no-repository copy — and the raw strings `API 409` /
     `has no workdir` NEVER appear in the DOM;
  5. Full diff on r-legacy (whose /diff never resolves in time) renders
     `[data-testid="diff-error"]` within the timeout budget, never an
     indefinite "Loading…" — and the request tap asserts ≥1 /diff fetch was
     attempted (the zero-request hang is the regression this pins);
  6. an evidence reference is an <a> that, on click, opens
     `[data-testid="file-viewer"]` populated from readRunFile (no dead click);
  7. while CREW-UX-1 is unlanded, the diff view carries
     `[data-testid="diff-baseline-note"]` naming its HEAD baseline honestly;
  + the Term tab lands on "View this run's transcript" when captured output
    exists, with the ungoverned operator shell as the labeled SECONDARY action.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-R-failed-postmortem.png   r-auth: FailureBanner headline + VerdictDetail +
                               the auto-opened unit spine
  ux-R-verdict-empty.png       r-legacy: the retention empty state
  ux-R2-diff-cause.png         the named-cause 409 card (no repository attached)
  ux-R2-diff-baseline.png      the honest HEAD-baseline note on a resolving diff

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4377),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    FORENSICS_GATE_DENY,
    FORENSICS_NOTES_PATH,
    HIDE_GATE_TOASTS,
    REPO,
    VIEWER_FILE_TS,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4377"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

AUTH_THREAD = "/p/auth-refactor/build/r-auth"
LEGACY_THREAD = "/p/legacy-spike/build/r-legacy"
UPLOAD_THREAD = "/p/upload-endpoint/build/r-upload"

# The client's own diff budget is DIFF_TIMEOUT_MS = 8000 (FileViewer.tsx); the
# rig grants it a margin but stays far under the fixture's 30s hang.
DIFF_ERROR_DEADLINE_MS = 12_000

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


# ── 1. The same-origin build + the shared W2 fixture, forensics ON ──────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, forensics=True, viewer=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap: every unit-output, file, and diff read the page fires.
    diff_reads: list[str] = []
    file_reads: list[str] = []
    output_reads: list[str] = []

    def on_request(req):
        path = urlparse(req.url).path
        q = urlparse(req.url).query
        full = f"{path}?{q}" if q else path
        if req.method != "GET":
            return
        if re.search(r"/api/v1/runs/[^/]+/diff$", path):
            diff_reads.append(full)
        elif re.search(r"/api/v1/runs/[^/]+/files$", path):
            file_reads.append(full)
        elif re.search(r"/api/v1/runs/[^/]+/units/[^/]+/output$", path):
            output_reads.append(full)

    page.on("request", on_request)

    def open_thread(thread: str) -> None:
        page.goto(f"{ORIGIN}{thread}", wait_until="domcontentloaded")
        page.add_style_tag(content=HIDE_GATE_TOASTS)

    # ── Scene 1 (AC 1): units-as-spine — the failed run's post-mortem page ──────
    open_thread(AUTH_THREAD)
    page.locator('[data-testid="failure-banner"]').first.wait_for(timeout=30000)
    page.locator('[data-testid="work-unit"]').first.wait_for(timeout=15000)
    page.locator('[data-testid="unit-transcript"]').first.wait_for(timeout=15000)
    # Both terminal units' transcripts auto-open (the WorkUnitDetail:38 contract):
    # the done survey's captured markdown AND the rejected review's honest
    # outputUnavailable sentence — no clicks made yet.
    page.get_by_text("Mapped the middleware chain").wait_for(timeout=15000)
    page.get_by_text("That is the deny-dominates rule holding").wait_for(timeout=15000)
    spine = page.evaluate(
        """() => {
          const banner = document.querySelector('[data-testid="failure-banner"]');
          const list = document.querySelector('[data-testid="unit-list"]');
          const units = document.querySelectorAll('[data-testid="work-unit"]');
          const transcripts = document.querySelectorAll('[data-testid="unit-transcript"]');
          return {
            units: units.length,
            transcripts: transcripts.length,
            bannerPresent: !!banner,
            listPresent: !!list,
            bannerAboveList: !!banner && !!list
              && !!(banner.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
          };
        }""")
    check("units_as_spine", spine["units"] == 2 and spine["transcripts"] >= 2
          and spine["bannerAboveList"],
          **spine, output_reads=list(output_reads))

    # ── Scene 2 (AC 2): the VerdictDetail card — deciding phase, reasoning,
    #    and the FINDING-025 vacuous default-allow label ─────────────────────────
    page.locator('[data-testid="verdict-detail"]').wait_for(timeout=15000)
    verdict = page.evaluate(
        """() => {
          const card = document.querySelector('[data-testid="verdict-detail"]');
          const text = card ? card.innerText : '';
          return {
            phaseOrd: card?.getAttribute('data-phase-ord') ?? null,
            vacuous: card?.getAttribute('data-vacuous') ?? null,
            empty: card?.getAttribute('data-empty') ?? null,
            namesPhase: text.includes('review'),
            hasCriterion: !!document.querySelector('[data-testid="verdict-criterion"]'),
            hasDenial: !!document.querySelector('[data-testid="verdict-denial"]'),
            hasDefaultAllowLabel: text.includes('default-allow'),
            hasReasoning: text.includes('drops the token-refresh path'),
          };
        }""")
    check("verdict_detail", verdict["phaseOrd"] == str(FORENSICS_GATE_DENY["ord"])
          and verdict["vacuous"] == "true" and verdict["empty"] is None
          and verdict["namesPhase"] and verdict["hasCriterion"] and verdict["hasDenial"]
          and verdict["hasDefaultAllowLabel"] and verdict["hasReasoning"],
          **verdict)
    page.screenshot(path=str(VSHOTS / "ux-R-failed-postmortem.png"))

    # ── Scene 3 (AC 6): the evidence reference resolves — readRunFile, no dead
    #    click ──────────────────────────────────────────────────────────────────
    ref = page.locator('[data-testid="evidence-ref"]', has_text="NOTES.md").first
    ref.wait_for(timeout=10000)
    is_anchor = page.evaluate(
        """() => document.querySelector('[data-testid="evidence-ref"]')?.tagName === 'A'""")
    ref.click()
    page.locator('[data-testid="file-viewer"]').wait_for(timeout=10000)
    page.get_by_text("Token refresh").wait_for(timeout=10000)
    expected_file_read = (
        f"/api/v1/runs/r-auth/files?path={FORENSICS_NOTES_PATH.replace('/', '%2F')}")
    check("evidence_ref_opens_viewer", is_anchor and expected_file_read in file_reads,
          is_anchor=is_anchor, file_reads=list(file_reads))
    page.keyboard.press("Escape")
    page.locator('[data-testid="file-viewer"]').wait_for(state="detached", timeout=5000)

    # ── Scene 4 (AC 4): Full diff on the repo-less run → the named-cause card;
    #    the raw wire strings never reach the DOM ────────────────────────────────
    page.get_by_role("button", name=re.compile("^Files")).click()
    page.locator('[data-testid="files-full-diff"]').wait_for(timeout=10000)
    page.locator('[data-testid="files-full-diff"]').click()
    page.locator('[data-testid="diff-named-cause"]').wait_for(timeout=10000)
    cause = page.evaluate(
        """() => {
          const card = document.querySelector('[data-testid="diff-named-cause"]');
          const body = document.body.innerText;
          return {
            cause: card?.getAttribute('data-cause') ?? null,
            copyOk: (card?.innerText ?? '').includes(
              'This run had no repository attached — nothing was produced to review'),
            remediation: !!document.querySelector('[data-testid="diff-cause-remediation"]'),
            raw409InDom: body.includes('API 409'),
            rawWorkdirInDom: body.includes('has no workdir'),
          };
        }""")
    check("diff_named_cause", cause["cause"] == "no-repo" and cause["copyOk"]
          and cause["remediation"] and not cause["raw409InDom"]
          and not cause["rawWorkdirInDom"],
          **cause, diff_reads=list(diff_reads))
    page.screenshot(path=str(VSHOTS / "ux-R2-diff-cause.png"))
    page.keyboard.press("Escape")
    page.locator('[data-testid="file-viewer"]').wait_for(state="detached", timeout=5000)

    # ── Scene 5: the Term tab lands on the run's transcript; the ungoverned
    #    shell is the labeled SECONDARY ──────────────────────────────────────────
    term_btn = page.get_by_role("button", name="View this run's transcript")
    term_btn.wait_for(timeout=10000)
    term_btn.click()
    page.locator('[data-testid="term-transcript"]').wait_for(timeout=10000)
    # The transcript body is fetched per-unit after the container mounts — wait
    # for the fixture's known transcript line, not just the container.
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="term-transcript"]')
          ?.innerText ?? '').includes('Mapped the middleware chain')""",
        timeout=10000)
    term = page.evaluate(
        """() => ({
          transcriptShown: (document.querySelector('[data-testid="term-transcript"]')
            ?.innerText ?? '').includes('Mapped the middleware chain'),
          shellSecondary: (document.querySelector('[data-testid="term-open-shell"]')
            ?.innerText ?? '').includes('ungoverned'),
        })""")
    check("term_transcript_first", term["transcriptShown"] and term["shellSecondary"], **term)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # ── Scene 6 (AC 3): the retention empty state on the historical run ─────────
    open_thread(LEGACY_THREAD)
    page.locator('[data-testid="verdict-detail"][data-empty="true"]').wait_for(timeout=30000)
    empty = page.evaluate(
        """() => {
          const card = document.querySelector('[data-testid="verdict-detail"]');
          return {
            empty: card?.getAttribute('data-empty') ?? null,
            copyOk: (card?.innerText ?? '').includes(
              'no evaluator record survives for this run'),
            fabricated: !!card?.getAttribute('data-phase-ord'),
          };
        }""")
    check("retention_empty_state", empty["empty"] == "true" and empty["copyOk"]
          and not empty["fabricated"], **empty)
    page.screenshot(path=str(VSHOTS / "ux-R-verdict-empty.png"))

    # ── Scene 7 (AC 5): the hanging diff — ≥1 fetch attempted, the error branch
    #    within the client's own budget, never an eternal "Loading…" ─────────────
    diff_reads.clear()
    page.get_by_role("button", name=re.compile("^Files")).click()
    page.locator('[data-testid="files-full-diff"]').wait_for(timeout=10000)
    page.locator('[data-testid="files-full-diff"]').click()
    page.locator('[data-testid="diff-error"]').wait_for(timeout=DIFF_ERROR_DEADLINE_MS)
    legacy_diff_attempts = [r for r in diff_reads if "/runs/r-legacy/diff" in r]
    hang = page.evaluate(
        """() => ({
          errorShown: !!document.querySelector('[data-testid="diff-error"]'),
          retryOffered: !!document.querySelector('[data-testid="diff-retry"]'),
          stillLoading: (document.querySelector('[data-testid="file-viewer"]')
            ?.innerText ?? '').includes('Loading'),
        })""")
    check("diff_hang_budget", hang["errorShown"] and hang["retryOffered"]
          and not hang["stillLoading"] and len(legacy_diff_attempts) >= 1,
          **hang, diff_attempts=legacy_diff_attempts)
    page.keyboard.press("Escape")

    # ── Scene 8 (AC 7): the honest HEAD-baseline note on a resolving diff ────────
    open_thread(UPLOAD_THREAD)
    page.get_by_role("button", name=re.compile("^Files")).wait_for(timeout=30000)
    page.get_by_role("button", name=re.compile("^Files")).click()
    page.locator(f'button[title="View {VIEWER_FILE_TS}"]').wait_for(timeout=15000)
    page.locator(f'button[title="View {VIEWER_FILE_TS}"]').click()
    page.locator('[data-testid="file-viewer"]').wait_for(timeout=10000)
    page.locator('[data-testid="diff-baseline-note"]').wait_for(timeout=10000)
    note = page.evaluate(
        """() => (document.querySelector('[data-testid="diff-baseline-note"]')
            ?.innerText ?? '')""")
    check("diff_baseline_note",
          "showing uncommitted changes vs HEAD; committed work is not shown here" in note,
          note=note)
    page.screenshot(path=str(VSHOTS / "ux-R2-diff-baseline.png"))

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
