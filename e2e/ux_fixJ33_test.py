#!/usr/bin/env python3
"""
ux_fixJ33_test.py — the round-3 J3 blocker gate (round-2 cold-review findings
1-4), driven against the shared W2 fixture extended with the REAL bridge's
generation shape (doc_v0: create seeds a v0 "Building…" placeholder, the first
draft lands LATER as v1) and the UNBOUND-doc frame reality (doc_unbound: doc
frames carry NO project_id — exactly what an Unfiled doc's frames look like,
whose silent dropping was round 2's dead-canvas repro on the live stack).

The four ACs, verbatim mapping to the round-2 findings:

  1. NO FABRICATED VERSIONS: a plain terminal-state send fires NO POST /api/fork
     (pre-fix: every send minted a byte-identical version before any work). The
     revised version arrives from the ANSWERER, tags the send via the wire's own
     version.created, no continuation divider ever renders, and the manifest
     grows by exactly one version per ask.
  2. LIVE FIRST GENERATION: with the page OPEN on the v0 placeholder, the
     answerer landing v1 swaps the canvas to v1 WITHOUT a reload — the frames
     of an Unfiled (project-unbound) doc reach the canvas.
  3. EXPORT ANSWERS SOMEWHERE, ALWAYS (drawer CLOSED): an export whose pending
     answer is re-addressed by a mid-flight landing (the head advances, the
     strip follows) stays visible at the click site, labeled with ITS version;
     the strip stays clickable while it is still visibly fading (pointer-events
     retire only after the fade), and a press on the hidden sensor band summons
     the strip instead of dying silently.
  4. SEND-STATE SURVIVES RELOAD: a send that was PENDING at reload comes back
     pending with its ORIGINAL clock (an already-stalled send re-renders the
     honest timeout + a WORKING retry, not a plain accepted message); a REFUSED
     send — which the announce history has no line for — comes back wearing its
     failure and a WORKING retry. Export entries survive in the transcript.

Captures (§12.0 contract: 1440x900, dsf 1) into e2e/shots/vision/:
  ux-fixJ33-live-first-gen.png    the canvas at v1 with no reload, marker landed
  ux-fixJ33-stalled-after-reload.png  the restored stalled send + retry
  ux-fixJ33-export-relabel.png    the v-labeled READY answer after re-addressing

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4403), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
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

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4403"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# The Unfiled mount — the round-2 repro ran here: unbound docs, unstamped frames.
PID = "default"
DOC = "fixj33-live"
KEY = f"{PID}:{DOC}"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def fixture_get(path: str):
    with urllib.request.urlopen(f"{ORIGIN}{path}", timeout=10) as res:
        return json.loads(res.read())


def post_chat(text: str) -> None:
    """An ask landing from OUTSIDE this page (another client) — the churn source."""
    req = urllib.request.Request(
        f"{ORIGIN}/api/v1/projects/{PID}/interactive/api/events", method="POST",
        data=json.dumps({"event_type": "wicked.interactive.chat.posted",
                         "payload": {"role": "user", "text": text, "document_id": DOC}}).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        res.read()


# ── The same-origin build + the shared W2 fixture, in the honest bridge shape ──
dist = ensure_build(lambda step, why: check(step, False, error=why))
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, doc_v0=True, doc_unbound=True, doc_run_ms=2500)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    fork_posts: list[str] = []
    page.on("request", lambda r: fork_posts.append(r.url)
            if r.method == "POST" and r.url.endswith("/api/fork") else None)

    # ── Scene A (AC 2 + AC 1): create → v0 placeholder → v1 lands LIVE ──────────
    page.goto(f"{ORIGIN}/p/{PID}/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-composer"]').fill(f'make a "{DOC}" deck for the launch review')
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-canvas"][data-version="0"]').wait_for(timeout=30000)
    create_id = page.evaluate(
        """() => document.querySelector('[data-testid="doc-message"]')?.getAttribute('data-message-id')""")
    # The v0 the canvas frames IS the placeholder — the real create shape.
    v0_html = urllib.request.urlopen(
        f"{ORIGIN}/api/v1/projects/{PID}/interactive/d/{DOC}/doc/0", timeout=10).read().decode()
    check("A1_create_frames_the_v0_placeholder",
          "Building" in v0_html and bool(create_id)
          and page.locator('[data-testid="thread-generating"]').count() == 1,
          message_id=create_id)

    # The answerer lands v1 (2.5s): the OPEN page must swap — no reload anywhere.
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=20000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)
    landed = page.evaluate(
        """(createId) => ({
             markerV1CausedByCreate: document.querySelector(
               `[data-testid="version-marker"][data-version="1"]`)?.getAttribute('data-caused-by') === createId,
             generatingChipGone: !document.querySelector('[data-testid="thread-generating"]'),
             composerState: document.querySelector('[data-testid="thread"]')?.getAttribute('data-composer-state'),
           })""", create_id)
    check("A2_first_generation_swaps_the_open_canvas_live",
          landed["markerV1CausedByCreate"] and landed["generatingChipGone"]
          and landed["composerState"] == "terminal" and fork_posts == [],
          forks_fired=len(fork_posts), **landed)
    page.screenshot(path=str(VSHOTS / "ux-fixJ33-live-first-gen.png"))

    # ── Scene B (AC 1): a plain continue-send never forks ───────────────────────
    versions_before = fixture_get(f"/api/v1/projects/{PID}/interactive/d/{DOC}/api/versions")
    page.locator('[data-testid="doc-composer"]').fill("tighten the headline")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=15000)
    b_id = page.evaluate(
        """() => { const m = document.querySelectorAll('[data-testid="doc-message"]');
                   return m[m.length - 1]?.getAttribute('data-message-id'); }""")
    # The wire's own v2 answers the ask — and tags it; nothing was minted client-side.
    page.locator(f'[data-testid="version-marker"][data-caused-by="{b_id}"]').wait_for(timeout=20000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=20000)
    versions_after = fixture_get(f"/api/v1/projects/{PID}/interactive/d/{DOC}/api/versions")
    plain = page.evaluate(
        """(bId) => ({
             markerVersion: document.querySelector(
               `[data-testid="version-marker"][data-caused-by="${bId}"]`)?.getAttribute('data-version'),
             divider: !!document.querySelector('[data-testid="version-divider"]'),
           })""", b_id)
    check("B_plain_send_no_fork_no_divider_one_new_version",
          fork_posts == [] and plain["markerVersion"] == "2" and not plain["divider"]
          and len(versions_after["versions"]) == len(versions_before["versions"]) + 1,
          forks_fired=len(fork_posts),
          versions_before=len(versions_before["versions"]),
          versions_after=len(versions_after["versions"]), **plain)

    # ── Scene C (AC 4): send-state survives the reload ──────────────────────────
    # C1: a send the bridge ACKS and never answers (the silent no-answerer).
    set_fixture(ORIGIN, doc_silent=True)
    page.locator('[data-testid="doc-composer"]').fill("add a roadmap slide")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=15000)
    # The reload happens AFTER the honesty budget would have expired: rewind the
    # persisted clock instead of sleeping 90s — the assertion is that hydrate
    # RESUMES the original clock (already stalled ⇒ visibly stalled), never re-arms.
    rewound = page.evaluate(
        """(key) => {
             const raw = sessionStorage.getItem(`wk-thread-sends:${key}`);
             return raw === null ? null : JSON.parse(raw);
           }""", KEY)
    check("C1_pending_send_persisted", bool(rewound) and rewound[0]["state"] == "pending",
          persisted=rewound)
    # The rewind itself rides an init script so it executes on the NEXT document
    # BEFORE any app code — a live-tab rewrite here can lose a race with the
    # store's own persist (any late frame re-derives the snapshot and restores
    # the fresh clock; the cold-run flake). One-shot: later reloads must see the
    # app's own writes, so the marker retires the rewind after this reload.
    page.add_init_script(f"""
        (() => {{
          if (sessionStorage.getItem('fixj33-rewound') !== null) return;
          const k = 'wk-thread-sends:{KEY}';
          const raw = sessionStorage.getItem(k);
          if (raw === null) return;
          sessionStorage.setItem('fixj33-rewound', '1');
          sessionStorage.setItem(k, JSON.stringify(
            JSON.parse(raw).map((s) => ({{ ...s, sentAt: s.sentAt - 95000 }}))));
        }})();
    """)

    page.reload(wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    # The restored send is STALLED, visibly — honest copy + a retry — never a
    # plain accepted message, and never a fresh "being worked now" claim.
    page.locator('[data-testid="thread-generating-timeout"]').wait_for(timeout=15000)
    stalled = page.evaluate(
        """() => ({
             retry: !!document.querySelector('[data-testid="thread-generating-retry"]'),
             freshGenerating: !!document.querySelector('[data-testid="thread-generating"]'),
             steeringStalled: !!document.querySelector('[data-testid="steering-stalled"]'),
             textBack: Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
               .some((m) => (m.textContent || '').includes('add a roadmap slide')),
           })""")
    check("C2_stalled_send_restored_stalled_with_retry",
          stalled["retry"] and not stalled["freshGenerating"]
          and stalled["steeringStalled"] and stalled["textBack"], **stalled)
    page.screenshot(path=str(VSHOTS / "ux-fixJ33-stalled-after-reload.png"))

    # The restored retry WORKS: with the bridge answering again, the same send
    # lands its version and the timeout retires into the real anchor.
    set_fixture(ORIGIN, doc_silent=False, doc_run_ms=1500)
    page.locator('[data-testid="thread-generating-retry"]').click()
    page.locator('[data-testid="version-marker"][data-version="3"]').wait_for(timeout=20000)
    revived = page.evaluate(
        """() => ({
             timedOut: !!document.querySelector('[data-testid="thread-generating-timeout"]'),
             markerOnRoadmap: (() => {
               const mk = document.querySelector('[data-testid="version-marker"][data-version="3"]');
               const cause = mk?.getAttribute('data-caused-by');
               const msg = document.querySelector(`[data-testid="doc-message"][data-message-id="${cause}"]`);
               return !!msg && (msg.textContent || '').includes('add a roadmap slide');
             })(),
           })""")
    check("C3_restored_retry_is_live_and_anchors",
          not revived["timedOut"] and revived["markerOnRoadmap"], **revived)

    # C4: a REFUSED send (the bridge never accepted it — no wire line exists).
    set_fixture(ORIGIN, send_fail=True)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=15000)
    page.locator('[data-testid="doc-composer"]').fill("add a pricing slide")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-send-failed"]').wait_for(timeout=15000)
    set_fixture(ORIGIN, send_fail=False)

    page.reload(wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    page.locator('[data-testid="thread-send-failed"]').wait_for(timeout=15000)
    refused = page.evaluate(
        """() => {
             const msgs = Array.from(document.querySelectorAll('[data-testid="doc-message"]'));
             const pricing = msgs.find((m) => (m.textContent || '').includes('add a pricing slide'));
             return {
               refusedTextBack: !!pricing,
               retry: !!document.querySelector('[data-testid="thread-send-retry"]'),
             };
           }""")
    check("C5_refused_send_restored_failed_with_retry",
          refused["refusedTextBack"] and refused["retry"], **refused)
    # …and ITS retry works too: the re-armed send is accepted and lands v4.
    page.locator('[data-testid="thread-send-retry"]').click()
    page.locator('[data-testid="version-marker"][data-version="4"]').wait_for(timeout=20000)
    check("C6_refused_retry_lands", True)

    # ── Scene D (AC 3): the export answers with the drawer CLOSED, through churn ─
    set_fixture(ORIGIN, export_delay_ms=4000, doc_run_ms=1500)
    page.goto(f"{ORIGIN}/p/{PID}/document/{DOC}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"][data-version="4"]').wait_for(timeout=30000)
    check("D1_drawer_closed_by_default",
          page.locator('[data-testid="thread-drawer"]').count() == 0)

    wake_strip(page)
    page.locator('[data-testid="export-format"][data-format="html"]').click()  # exports v4
    post_chat("one more tweak from another client")  # lands v5 in 1.5s — the churn
    # Mid-flight, PAST the landing: the strip has re-addressed to v5, and the
    # pending answer is STILL VISIBLE at the click site (pre-fix: wiped here).
    page.locator('[data-testid="export-menu"][data-version="5"]').wait_for(timeout=15000)
    mid = page.evaluate(
        """() => ({
             pending: !!document.querySelector('[data-testid="export-pending"]'),
             ready: !!document.querySelector('[data-testid="export-ready"]'),
             stripHidden: document.querySelector('[data-testid="version-strip"]')?.getAttribute('data-hidden'),
           })""")
    check("D2_pending_answer_survives_the_readdressing",
          (mid["pending"] or mid["ready"]) and mid["stripHidden"] == "false", **mid)

    # The READY answer lands labeled with ITS version (v4) under the v5 label row.
    ready = page.locator('[data-testid="export-ready"][data-version="4"]')
    ready.wait_for(timeout=15000)
    page.wait_for_timeout(3600)  # a full idle budget with the mouse parked: still up
    answered = page.evaluate(
        """() => ({
             stripHidden: document.querySelector('[data-testid="version-strip"]')?.getAttribute('data-hidden'),
             label: document.querySelector('[data-testid="export-ready"]')?.textContent ?? '',
             href: document.querySelector('[data-testid="export-ready"]')?.getAttribute('href'),
             menuVersion: document.querySelector('[data-testid="export-menu"]')?.getAttribute('data-version'),
           })""")
    check("D3_ready_answer_visible_v_labeled_strip_held",
          answered["stripHidden"] == "false" and "v4" in answered["label"]
          and bool(answered["href"]) and answered["menuVersion"] == "5",
          **answered)
    page.screenshot(path=str(VSHOTS / "ux-fixJ33-export-relabel.png"))

    # The affordance is REAL (attachment bytes), and ACTING on it retires it.
    dl = page.request.get(answered["href"] if str(answered["href"]).startswith("http")
                          else f"{ORIGIN}{answered['href']}")
    check("D4_ready_href_serves_bytes",
          dl.status == 200 and "attachment" in (dl.headers.get("content-disposition") or "")
          and len(dl.body()) > 0,
          status=dl.status)
    ready.click()
    page.locator('[data-testid="export-ready"]').wait_for(state="detached", timeout=10000)

    # D5: the fading strip keeps its hit targets until the fade FINISHES, and a
    # press on the hidden sensor band summons the strip instead of dying.
    page.mouse.move(700, 300)  # park away from the strip; let the idle budget run
    page.wait_for_function(
        """() => document.querySelector('[data-testid="version-strip"]')?.getAttribute('data-hidden') === 'true'""",
        timeout=10000)
    grace = page.evaluate(
        """() => getComputedStyle(document.querySelector('[data-testid="version-strip"]')).pointerEvents""")
    page.wait_for_timeout(600)  # past STRIP_FADE_GRACE_MS
    after_grace = page.evaluate(
        """() => ({
             pe: getComputedStyle(document.querySelector('[data-testid="version-strip"]')).pointerEvents,
             sensor: !!document.querySelector('[data-testid="strip-sensor"]'),
           })""")
    page.evaluate(
        """() => {
             const sensor = document.querySelector('[data-testid="strip-sensor"]');
             sensor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
           }""")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="version-strip"]')?.getAttribute('data-hidden') === 'false'""",
        timeout=5000)
    check("D5_fade_grace_and_sensor_press_summons_the_strip",
          grace == "auto" and after_grace["pe"] == "none" and after_grace["sensor"],
          pointer_events_during_fade=grace, **after_grace)

    # ── Scene E (minor): the export entry survives in the transcript ────────────
    set_fixture(ORIGIN, export_delay_ms=0, doc_run_ms=0)
    page.reload(wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    page.locator('[data-testid="doc-artifact-download"]').wait_for(timeout=15000)
    entry = page.evaluate(
        """() => ({
             href: document.querySelector('[data-testid="doc-artifact-download"]')?.getAttribute('href'),
             text: document.querySelector('[data-testid="doc-artifact-download"]')?.closest('[data-testid="doc-agent"]')?.textContent ?? '',
           })""")
    check("E_export_entry_restored_in_the_transcript",
          bool(entry["href"]) and "export ready" in entry["text"], **entry)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
report["shots"] = ["ux-fixJ33-live-first-gen.png", "ux-fixJ33-stalled-after-reload.png",
                   "ux-fixJ33-export-relabel.png"]
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
