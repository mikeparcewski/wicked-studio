#!/usr/bin/env python3
"""
ux_fixJ3J1_test.py — the re-review blocker gate for J3 (client honesty on the
doc create/iteration path) and J1 (the Governance panel's self-contradiction).
BRIEF-UX-001 DoD gate; DES-UX-001 governs.

The four ACs, verbatim mapping:

  1. J3 bounded honesty budget: on a bridge that ACKS and then says NOTHING
     (`doc_silent` — the reproduced 28-min no-answerer), the "generating — this
     message is being worked now" pill must flip, within
     GENERATING_SILENCE_BUDGET_MS (90s, docThread.ts) of silence, to
     `[data-testid="thread-generating-timeout"]` carrying the honest copy
     ("no worker has picked this up — the generation service may be down") and
     a WORKING `[data-testid="thread-generating-retry"]`. The composer's own
     steering chip stops claiming a live run at the same moment
     (`steering-stalled`). This scene rides the REAL production budget — no
     shortened test seam — so the rig witnesses the actual bound a user would.
  2. J3 no premature anchors: on the terminal-continue path (fork + inject),
     NO `continues as vN` divider and NO new version chip render before the
     thread OBSERVES a `version.created` arrival — the anchor lands only with
     the wire's proof, positioned immediately above its continuation message.
  3. J3 closed-drawer export: with the thread drawer CLOSED, the export click
     site keeps its answer VISIBLE — the strip must not auto-hide while the
     export is pending or its READY answer sits un-acted (pre-fix: the whole
     strip faded to opacity 0 three seconds after the click; zero response).
  4. J1 governance non-contradiction: on the r-auth-class run (halt banner +
     Decisions DENY, EMPTY /governance/claims), the Governance panel must NOT
     say "No governance claims recorded for this run" — it states which wire
     it reads and that the wire is empty (`governance-wire-empty`), and
     surfaces the run's own decision record (`governance-run-record`).

Captures (§12.0 contract: 1440x900, dsf 1) into e2e/shots/vision/:
  ux-fixJ3J1-generating-timeout.png   the honest timeout pill + retry
  ux-fixJ3J1-export-closed-drawer.png the READY answer, drawer closed, strip up
  ux-fixJ3J1-governance.png           the non-contradicting Governance panel

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4401), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.

NOTE scene 1 waits out the real 90s budget — this rig runs ~3 minutes.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
    wake_strip,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4401"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

PID = "scratch"

# The client's budget (docThread.ts GENERATING_SILENCE_BUDGET_MS) and its honest
# copy (DocumentThread.tsx GENERATING_TIMEOUT_COPY), pinned verbatim.
BUDGET_MS = 90_000
TIMEOUT_COPY = "no worker has picked this up — the generation service may be down"

# The J1 forensics deny (uxfix_fixture FORENSICS_REVIEW_DENIAL's head).
DENY_FRAGMENT = "Governance DENIED unit 1 (review)"
CONTRADICTION = "No governance claims recorded for this run"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def api_create_doc(name: str, brief: str) -> dict:
    req = urllib.request.Request(
        f"{ORIGIN}/api/v1/projects/{PID}/interactive/api/docs", method="POST",
        data=json.dumps({"name": name, "brief": brief}).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


# ── The same-origin build + the shared W2 fixture ──────────────────────────────
dist = ensure_build(lambda step, why: check(step, False, error=why))
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # ── Scene 1 (AC 1): the bounded honesty budget on a silent bridge ──────────
    set_fixture(ORIGIN, doc_silent=True)
    page.goto(f"{ORIGIN}/p/{PID}/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    t0 = time.monotonic()
    page.locator('[data-testid="doc-composer"]').fill("a deck for the quarterly business review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=30000)
    msg_id = page.evaluate(
        """() => document.querySelector('[data-testid="doc-message"]')?.getAttribute('data-message-id')""")
    check("silent_create_shows_generating_first", bool(msg_id), message_id=msg_id)

    # INSIDE the budget the working claim stands — the timeout must not be early.
    # (Checked at 75s: comfortably inside 90s, past any scheduling jitter.)
    while time.monotonic() - t0 < 75:
        time.sleep(1)
    inside = page.evaluate(
        """() => ({
             generating: !!document.querySelector('[data-testid="thread-generating"]'),
             timedOut: !!document.querySelector('[data-testid="thread-generating-timeout"]'),
           })""")
    check("no_timeout_inside_the_budget",
          inside["generating"] and not inside["timedOut"],
          seconds_elapsed=round(time.monotonic() - t0), **inside)

    # PAST the budget: the visible timeout state, never eternal "being worked now".
    page.locator('[data-testid="thread-generating-timeout"]').wait_for(timeout=40000)
    flipped_at = time.monotonic() - t0
    silence = page.evaluate(
        """() => ({
             copy: document.querySelector('[data-testid="thread-generating-timeout"]')?.textContent ?? '',
             retry: !!document.querySelector('[data-testid="thread-generating-retry"]'),
             stillGenerating: !!document.querySelector('[data-testid="thread-generating"]'),
             steeringChip: !!document.querySelector('[data-testid="steering-chip"]'),
             steeringStalled: !!document.querySelector('[data-testid="steering-stalled"]'),
           })""")
    check("silence_resolves_to_honest_timeout",
          TIMEOUT_COPY in silence["copy"] and silence["retry"]
          and not silence["stillGenerating"] and not silence["steeringChip"]
          and silence["steeringStalled"],
          flipped_after_s=round(flipped_at, 1), **silence)

    page.screenshot(path=str(VSHOTS / "ux-fixJ3J1-generating-timeout.png"))

    # The retry is LIVE: with the bridge speaking again, the same send lands its
    # version — the pill retires into the real anchor (§3.3: a failure state
    # always carries its own fix).
    set_fixture(ORIGIN, doc_silent=False)
    page.locator('[data-testid="thread-generating-retry"]').click()
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=15000)
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    revived = page.evaluate(
        """() => ({
             causedBy: document.querySelector('[data-testid="version-marker"][data-version="1"]')
               ?.getAttribute('data-caused-by'),
             timedOut: !!document.querySelector('[data-testid="thread-generating-timeout"]'),
             generating: !!document.querySelector('[data-testid="thread-generating"]'),
           })""")
    check("timeout_retry_is_live_and_anchors",
          revived["causedBy"] == msg_id and not revived["timedOut"] and not revived["generating"],
          expected_cause=msg_id, **revived)

    # ── Scene 2 (AC 2): no premature anchors — re-scoped to the round-3 contract:
    # a PLAIN continue-send never forks (no divider, ever); the deferred divider
    # is the explicit BRANCH gesture's anchor (sending from an older ?v=N). ─────
    created = api_create_doc("anchor-truth", "the anchor-truth brief")
    DOC2 = created["name"]
    set_fixture(ORIGIN, doc_run_ms=2500)
    fork_posts: list[str] = []
    page.on("request", lambda r: fork_posts.append(r.url)
            if r.method == "POST" and r.url.endswith("/api/fork") else None)
    page.goto(f"{ORIGIN}/p/{PID}/document/{DOC2}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    # A reloaded doc with nothing in flight is TERMINAL — the continue path.
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=15000)

    page.locator('[data-testid="doc-composer"]').fill("tighten the intro")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=15000)
    cont_id = page.evaluate(
        """() => { const m = document.querySelectorAll('[data-testid="doc-message"]');
                   return m[m.length - 1]?.getAttribute('data-message-id'); }""")
    # The send has acked but nothing has LANDED: no version chip yet — and no fork
    # was fired, so no divider will EVER render for this plain send.
    page.wait_for_timeout(900)  # inside the 2.5s scheduled landing
    premature = page.evaluate(
        """(contId) => ({
             divider: !!document.querySelector('[data-testid="version-divider"]'),
             chipOnSend: !!document.querySelector(
               `[data-testid="version-marker"][data-caused-by="${contId}"]`),
           })""", cont_id)
    check("no_anchor_before_the_version_arrives",
          not premature["divider"] and not premature["chipOnSend"],
          forks_fired=len(fork_posts), **premature)

    # The ANSWERER's version.created is what tags the plain send — v2, from the
    # service, with NO fork fired and NO continuation divider.
    page.locator(f'[data-testid="version-marker"][data-caused-by="{cont_id}"]').wait_for(timeout=15000)
    plain = page.evaluate(
        """(contId) => ({
             markerVersion: document.querySelector(
               `[data-testid="version-marker"][data-caused-by="${contId}"]`)?.getAttribute('data-version'),
             divider: !!document.querySelector('[data-testid="version-divider"]'),
           })""", cont_id)
    check("plain_send_answered_by_the_wire_no_fork_no_divider",
          plain["markerVersion"] == "2" and not plain["divider"] and fork_posts == [],
          forks_fired=len(fork_posts), **plain)

    # The BRANCH gesture: send from the explicitly selected OLDER v1 — the one
    # case fork survives, and the divider stays the deferred wire-proof anchor.
    page.goto(f"{ORIGIN}/p/{PID}/document/{DOC2}?v=1", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=15000)
    page.locator('[data-testid="doc-composer"]').fill("branch: keep the original intro")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=15000)
    branch_id = page.evaluate(
        """() => { const m = document.querySelectorAll('[data-testid="doc-message"]');
                   return m[m.length - 1]?.getAttribute('data-message-id'); }""")
    # The fork has acked (v3 committed) but nothing has LANDED: the divider is
    # only REGISTERED — no anchor renders before the wire's proof.
    page.wait_for_timeout(900)
    branch_premature = page.evaluate(
        """(bid) => ({
             divider: !!document.querySelector('[data-testid="version-divider"]'),
             chipOnSend: !!document.querySelector(
               `[data-testid="version-marker"][data-caused-by="${bid}"]`),
           })""", branch_id)
    check("branch_divider_deferred_until_the_wire_proves_it",
          len(fork_posts) == 1
          and not branch_premature["divider"] and not branch_premature["chipOnSend"],
          forks_fired=len(fork_posts), **branch_premature)

    # The landing materializes the divider ABOVE its message.
    page.locator('[data-testid="version-divider"]').wait_for(timeout=15000)
    anchored = page.evaluate(
        """(bid) => {
             const divider = document.querySelector('[data-testid="version-divider"]');
             const next = divider?.nextElementSibling;
             return {
               dividerVersion: divider?.getAttribute('data-version'),
               dividerText: divider?.textContent ?? '',
               aboveItsMessage: !!next?.querySelector(
                 `[data-testid="doc-message"][data-message-id="${bid}"]`),
               chipOnSend: !!document.querySelector(
                 `[data-testid="version-marker"][data-caused-by="${bid}"]`),
             };
           }""", branch_id)
    check("divider_anchors_on_arrival_above_its_message",
          anchored["dividerVersion"] == "3"
          and "continues as v3" in anchored["dividerText"]
          and anchored["aboveItsMessage"] and anchored["chipOnSend"],
          **anchored)
    set_fixture(ORIGIN, doc_run_ms=0)

    # ── Scene 3 (AC 3): the export answers with the drawer CLOSED ──────────────
    created = api_create_doc("closed-drawer-export", "the closed-drawer brief")
    DOC3 = created["name"]
    set_fixture(ORIGIN, export_delay_ms=4500)
    page.goto(f"{ORIGIN}/p/{PID}/document/{DOC3}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    drawer_closed = page.evaluate(
        "() => !document.querySelector('[data-testid=\"thread-drawer\"]')")
    check("drawer_is_closed_by_default", drawer_closed)

    wake_strip(page)
    page.locator('[data-testid="export-format"][data-format="html"]').click()
    # Do NOT move the mouse again: pre-fix, the strip auto-hid 3s from now and
    # took the pending answer with it. Past the idle budget the click site must
    # still be answering, visibly.
    page.wait_for_timeout(3600)
    mid = page.evaluate(
        """() => ({
             stripHidden: document.querySelector('[data-testid="version-strip"]')?.getAttribute('data-hidden'),
             pending: !!document.querySelector('[data-testid="export-pending"]'),
           })""")
    check("pending_answer_survives_the_idle_budget",
          mid["stripHidden"] == "false" and mid["pending"], **mid)

    ready = page.locator('[data-testid="export-ready"][data-format="html"]')
    ready.wait_for(timeout=15000)
    page.wait_for_timeout(3600)  # past another idle budget with the mouse still parked
    landed = page.evaluate(
        """() => ({
             stripHidden: document.querySelector('[data-testid="version-strip"]')?.getAttribute('data-hidden'),
             opacity: getComputedStyle(document.querySelector('[data-testid="version-strip"]')).opacity,
             readyHref: document.querySelector('[data-testid="export-ready"]')?.getAttribute('href'),
             drawerStillClosed: !document.querySelector('[data-testid="thread-drawer"]'),
           })""")
    check("ready_answer_holds_the_strip_visible_drawer_closed",
          landed["stripHidden"] == "false" and landed["opacity"] == "1"
          and bool(landed["readyHref"]) and landed["drawerStillClosed"],
          **landed)

    # The affordance is REAL: its href serves the artifact bytes, attachment-framed.
    dl = page.request.get(f"{ORIGIN}{landed['readyHref']}"
                          if landed["readyHref"].startswith("/") else landed["readyHref"])
    check("closed_drawer_ready_href_serves_bytes",
          dl.status == 200
          and "attachment" in (dl.headers.get("content-disposition") or "")
          and len(dl.body()) > 0,
          status=dl.status, disposition=dl.headers.get("content-disposition"))

    page.screenshot(path=str(VSHOTS / "ux-fixJ3J1-export-closed-drawer.png"))
    set_fixture(ORIGIN, export_delay_ms=0)

    # ── Scene 4 (AC 4): the Governance panel does not contradict its page ──────
    set_fixture(ORIGIN, forensics=True)
    page.goto(f"{ORIGIN}/p/auth-refactor/build/r-auth", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="failure-banner"]').wait_for(timeout=30000)
    banner = page.locator('[data-testid="failure-banner"]').text_content() or ""
    check("halt_banner_carries_the_deny", DENY_FRAGMENT in banner, banner=banner[:200])

    page.get_by_role("button", name="Decisions").click()
    page.locator('[data-testid="decisions-ledger"]').wait_for(timeout=15000)
    ledger = page.locator('[data-testid="decisions-ledger"]').text_content() or ""
    check("decisions_panel_shows_the_deny", "DENY" in ledger, ledger=ledger[:200])

    page.get_by_role("button", name="Governance").click()
    page.locator('[data-testid="governance-wire-empty"]').wait_for(timeout=15000)
    governance = page.evaluate(
        """() => ({
             wireEmpty: document.querySelector('[data-testid="governance-wire-empty"]')?.textContent ?? '',
             runRecord: document.querySelector('[data-testid="governance-run-record"]')?.textContent ?? '',
             contradiction: document.body.textContent.includes(%s),
           })""" % json.dumps(CONTRADICTION))
    check("governance_panel_states_the_split_not_a_contradiction",
          "claims wire" in governance["wireEmpty"]
          and "holds no claims" in governance["wireEmpty"]
          and "DENY" in governance["runRecord"]
          and DENY_FRAGMENT in governance["runRecord"]
          and "Decisions panel" in governance["runRecord"]
          and not governance["contradiction"],
          **{k: (v[:200] if isinstance(v, str) else v) for k, v in governance.items()})

    page.screenshot(path=str(VSHOTS / "ux-fixJ3J1-governance.png"))
    set_fixture(ORIGIN, forensics=False)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
