#!/usr/bin/env python3
"""
ux_sliceT_test.py — the DES-UX-001 slice-T gate: thread truth (§6.1 + §6.3).
Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) grown with the
REAL bridge shapes BRIDGE-UX-1 pinned (§8.4.1): `chat.posted` acks
`200 {ok, event_id, correlation_id}` and QUEUES (`doc_run_ms` slows the FIFO so
the queue is witnessable), `GET /d/:doc/api/conversation` serves the announce
history as {role, text, ts[, state]} ONLY (no message ids, no version markers),
and `restart_bridge` clears process state while the disk (docs + conversation)
survives.

The §6.1 / §6.3 DOM ACs, verbatim mapping:

  1. §6.1: a send while idle renders `[data-testid="thread-generating"]`, then a
     `[data-testid="version-marker"]` whose `data-caused-by` equals the send's
     message id; a send while a run is in flight renders
     `[data-testid="thread-queued"]` (the honest client-side rendering — the
     wire carries no queue-position ack) and later its own anchored marker; a
     refused send renders `[data-testid="thread-send-failed"]` with a retry —
     never silence (EC36). Every ack on the wire is the pinned real shape.
  2. EC36 negative: NO version-marker renders whose `data-caused-by` does not
     match its own containing user message (the gaslight regression pin), and
     the failed send is never tagged.
  3. §6.3 same-session reload: the thread's TEXT is back FROM THE WIRE (exactly
     ONE `GET /d/:doc/api/conversation` on doc open — the one sanctioned mount
     fetch this slice adds; the other doc-open reads stay the standing manifest
     + rendered-doc pair), the version markers are back from the session-storage
     stopgap, "In thread" is enabled and scrolls, and the stopgap note is
     ABSENT (nothing is missing).

     DOC-FEEDBACK RE-SCOPE: the thread opens via the right panel's own rail
     (the strip's thread-toggle retired with the slim band), and the In-thread
     gesture lives in the panel's Versions tab per-version rows — clicking it
     flips the panel to Chat first, so the focus assertion is awaited.
  4. §6.3 fresh-session reload (cleared session storage + bridge restart): the
     text is STILL back from the wire — never an empty state — while the
     version-anchor gap (the only thing the wire lacks) is stated by
     `[data-testid="thread-stopgap"]` with the promise-with-a-pointer copy, no
     marker is faked, and "In thread" disables with the honest reason.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-T-thread-states.png   one thread wearing all three §6.1 send states at once:
                           generating (head), queued (behind it), failed (retry)
  ux-T-thread-reload.png   the fresh-session reload: thread text restored from
                           the wire, stopgap copy on the anchor gap alone

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4383),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4383"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

DOC_URL = f"{ORIGIN}/p/scratch/document"
BRIEF = "Make me a deck for the Q3 review"
STEER = "Tighten the headline on slide one"
FAILING = "Add a closing slide with the roadmap"

# §6.3's stopgap copy — the promise with a pointer, scoped to the anchor gap.
# Round-3 copy pass: operator language — the spec ref (BRIDGE-UX-1 §8.4.1) no
# longer leaks into product copy; the promise names the service capability.
STOPGAP_MUST_SAY = [
    "restored from the document’s transcript",
    "what this session observed",
    "return once the document service records which message produced each version",
]

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


# ── 1. The same-origin build + the shared W2 fixture, slow doc runs ON ──────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, doc_run_ms=6000, send_fail=False)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Request/response taps: every interactive GET path (the mount-budget AC) and
    # every chat.posted ACK body (the pinned real shape).
    interactive_gets: list[str] = []
    send_acks: list[dict] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "GET" and "/interactive/" in path:
            interactive_gets.append(path)

    def on_response(res):
        path = urlparse(res.url).path
        if res.request.method == "POST" and path.endswith("/interactive/api/events"):
            try:
                body = json.loads(res.request.post_data or "{}")
            except json.JSONDecodeError:
                body = {}
            if body.get("event_type") == "wicked.interactive.chat.posted":
                ack = None
                try:
                    ack = res.json() if res.status == 200 else None
                except Exception:
                    ack = None
                send_acks.append({"status": res.status, "ack": ack})

    page.on("request", on_request)
    page.on("response", on_response)

    # ── Scene 1 (§6.1): the send lifecycle — generating, queued, failed, anchored ─
    page.goto(DOC_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # Send A while IDLE: the create. Its chip must be thread-generating.
    page.locator('[data-testid="doc-composer"]').fill(BRIEF)
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-generating"]').wait_for(timeout=30000)
    a_id = page.evaluate(
        """() => document.querySelector('[data-testid="doc-message"]')?.getAttribute('data-message-id')""")
    check("T1_idle_send_renders_generating", bool(a_id), message_id=a_id)

    # Send B while the run is IN FLIGHT: queued-behind-current-run (§6.1 — the
    # bridge queues per §8.4.1 probe 1; the queued rendering is client-side).
    page.locator('[data-testid="doc-composer"]').fill(STEER)
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-queued"]').wait_for(timeout=30000)
    b_id = page.evaluate(
        """() => { const m = document.querySelectorAll('[data-testid="doc-message"]');
                   return m[m.length - 1]?.getAttribute('data-message-id'); }""")
    both = page.evaluate(
        """() => ({
             generating: !!document.querySelector('[data-testid="thread-generating"]'),
             queued: !!document.querySelector('[data-testid="thread-queued"]'),
           })""")
    check("T2_midrun_send_renders_queued", both["generating"] and both["queued"] and bool(b_id),
          **both, message_id=b_id)

    # Send C against a REFUSING bridge: the visible failure with a retry.
    set_fixture(ORIGIN, send_fail=True)
    page.locator('[data-testid="doc-composer"]').fill(FAILING)
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-send-failed"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread-send-retry"]').wait_for(timeout=30000)
    set_fixture(ORIGIN, send_fail=False)
    c_id = page.evaluate(
        """() => { const m = document.querySelectorAll('[data-testid="doc-message"]');
                   return m[m.length - 1]?.getAttribute('data-message-id'); }""")

    # The named shot: one thread wearing all three states at once.
    tri = page.evaluate(
        """() => ({
             generating: !!document.querySelector('[data-testid="thread-generating"]'),
             queued: !!document.querySelector('[data-testid="thread-queued"]'),
             failed: !!document.querySelector('[data-testid="thread-send-failed"]'),
           })""")
    check("T3_all_three_states_visible", all(tri.values()), **tri)
    page.screenshot(path=str(VSHOTS / "ux-T-thread-states.png"))

    # A's landing anchors to A — data-caused-by equals the send's message id.
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    a_marker_cause = page.locator('[data-testid="version-marker"][data-version="1"]') \
        .get_attribute("data-caused-by")
    check("T4_idle_send_marker_anchored", a_marker_cause == a_id,
          caused_by=a_marker_cause, expected=a_id)

    # B's landing anchors to B — the queued send resolves to its OWN marker (FIFO).
    page.locator('[data-testid="version-marker"][data-version="2"]').wait_for(timeout=30000)
    b_marker_cause = page.locator('[data-testid="version-marker"][data-version="2"]') \
        .get_attribute("data-caused-by")
    check("T5_queued_send_marker_anchored", b_marker_cause == b_id,
          caused_by=b_marker_cause, expected=b_id)

    # C is still failed — never silently tagged — until its retry lands v3.
    still_failed = page.evaluate(
        """() => !!document.querySelector('[data-testid="thread-send-failed"]')""")
    page.locator('[data-testid="thread-send-retry"]').click()
    page.locator('[data-testid="version-marker"][data-version="3"]').wait_for(timeout=30000)
    c_marker_cause = page.locator('[data-testid="version-marker"][data-version="3"]') \
        .get_attribute("data-caused-by")
    check("T6_retry_resolves_to_anchored_marker",
          still_failed and c_marker_cause == c_id,
          was_failed_before_retry=still_failed, caused_by=c_marker_cause, expected=c_id)

    # EC36 negative (the gaslight pin): every marker's data-caused-by matches the
    # user message IN ITS OWN bubble — no marker under an unrelated request.
    ec36 = page.evaluate(
        """() => {
             const markers = Array.from(document.querySelectorAll('[data-testid="version-marker"]'));
             const ids = new Set(Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
               .map((m) => m.getAttribute('data-message-id')));
             return {
               markers: markers.length,
               allAnchoredToOwnMessage: markers.every((mk) => {
                 const cause = mk.getAttribute('data-caused-by');
                 const own = mk.parentElement?.querySelector('[data-testid="doc-message"]');
                 return ids.has(cause) && own?.getAttribute('data-message-id') === cause;
               }),
               noStrayState: !document.querySelector('[data-testid="thread-generating"]')
                 && !document.querySelector('[data-testid="thread-queued"]')
                 && !document.querySelector('[data-testid="thread-send-failed"]'),
             };
           }""")
    check("T7_ec36_no_marker_without_causing_message",
          ec36["markers"] == 3 and ec36["allAnchoredToOwnMessage"] and ec36["noStrayState"], **ec36)

    # The wire's ack shape, pinned in the client's own traffic (§8.4.1 probe 1):
    # every accepted chat.posted answered 200 {ok, event_id, correlation_id}; the
    # refused one answered 500 (the send_fail branch) — no other shape exists.
    # (A is a CREATE — POST /api/docs — so exactly two sends ride chat.posted:
    # B's steer and C's retry; C's first attempt is the one refusal.)
    accepted = [a for a in send_acks if a["status"] == 200]
    refused = [a for a in send_acks if a["status"] == 500]
    ack_ok = (len(accepted) == 2 and len(refused) == 1
              and all(sorted((a["ack"] or {}).keys()) == ["correlation_id", "event_id", "ok"]
                      for a in accepted))
    check("T8_real_ack_shapes_on_the_wire", ack_ok,
          accepted=len(accepted), refused=len(refused),
          ack_keys=[sorted((a["ack"] or {}).keys()) for a in accepted])

    doc_path = urlparse(page.url).path  # /p/scratch/document/<docId>
    doc_id = doc_path.rsplit("/", 1)[-1]

    # ── Scene 2 (§6.3): same-session reload — text from the wire, anchors from ──
    # the session-storage stopgap, In-thread enabled, ONE conversation read.
    interactive_gets.clear()
    page.reload(wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)  # re-add: styles die with the reload
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    # Doc-open budget window (before the drawer opens): the standing manifest +
    # rendered-doc reads plus EXACTLY ONE sanctioned conversation read — nothing else.
    page.wait_for_function(
        """() => !!document.querySelector('[data-testid="version-entry"]')""", timeout=30000)
    conv_path = f"/api/v1/projects/scratch/interactive/d/{doc_id}/api/conversation"
    page.wait_for_timeout(800)  # settle one beat so late mount fetches register
    mount_gets = list(interactive_gets)
    conv_reads = [g for g in mount_gets if g.endswith("/api/conversation")]
    # The budget is scoped to THIS DOC'S MOUNT: the doc-open reads stay the standing
    # manifest + rendered-doc pair plus EXACTLY ONE sanctioned conversation read —
    # the one new fetch this slice adds. (App-boot reads outside the mount — the
    # preflight gate, the board's docs-cache warms for other projects — are the
    # standing pre-slice set and ride the reload, not the doc open.)
    doc_mount = f"/api/v1/projects/scratch/interactive/d/{doc_id}/"
    mount_scoped = [g for g in mount_gets if g.startswith(doc_mount)]
    unsanctioned = [g for g in mount_scoped
                    if g != conv_path
                    and g != f"{doc_mount}api/versions"
                    and not g.startswith(f"{doc_mount}doc/")]
    check("T9_one_sanctioned_conversation_read_on_doc_open",
          conv_reads == [conv_path] and unsanctioned == [],
          conversation_reads=conv_reads, unsanctioned=unsanctioned, mount_gets=mount_gets)

    # Open the panel onto Chat (doc-feedback re-scope: the thread is no longer
    # a strip-toggled drawer — the right panel collapses to its own rail on a
    # doc route, and a rail tab expands it straight onto its tab).
    page.locator('[data-testid="panel-rail-tab"][data-tab="chat"]').click()
    page.locator('[data-testid="thread"]').wait_for(timeout=30000)
    same_session = page.evaluate(
        """(brief) => {
             const texts = Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
               .map((m) => m.textContent || '');
             const markers = Array.from(document.querySelectorAll('[data-testid="version-marker"]'))
               .map((m) => m.getAttribute('data-version'));
             const ids = new Set(Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
               .map((m) => m.getAttribute('data-message-id')));
             const anchored = Array.from(document.querySelectorAll('[data-testid="version-marker"]'))
               .every((mk) => ids.has(mk.getAttribute('data-caused-by')));
             return {
               textBack: texts.some((t) => t.includes(brief)),
               notEmpty: !!texts.length,
               markers,
               anchored,
               stopgapAbsent: !document.querySelector('[data-testid="thread-stopgap"]'),
             };
           }""", BRIEF)
    check("T10_same_session_reload_thread_back",
          same_session["textBack"] and same_session["anchored"]
          and set(same_session["markers"]) == {"1", "2", "3"}
          and same_session["stopgapAbsent"],
          **same_session)

    # §6.3: "In thread" is ENABLED for the reloaded session's v1 and actually
    # scrolls — the anchor survived the reload. Doc-feedback re-scope: the
    # In-thread gesture moved off the band into the panel's VERSIONS TAB
    # (per-version detail rows); clicking it flips the panel to Chat first —
    # the thread lives there — and focuses the producing message on the next
    # frame, so the focus is awaited, not read synchronously.
    v1_cause = page.locator('[data-testid="version-marker"][data-version="1"]') \
        .get_attribute("data-caused-by")
    page.locator('[data-testid="panel-tab"][data-tab="versions"]').click()
    v1_scroll = page.locator(
        '[data-testid="version-detail"][data-version="1"] [data-testid="version-scroll"]')
    v1_scroll.wait_for(timeout=30000)
    v1_enabled = v1_scroll.is_enabled()
    v1_scroll.click()
    page.locator('[data-testid="doc-panel"][data-tab="chat"]').wait_for(timeout=15000)
    try:
        page.wait_for_function(
            """(id) => document.activeElement?.getAttribute('data-testid') === 'doc-message'
                       && document.activeElement?.getAttribute('data-message-id') === id""",
            arg=v1_cause, timeout=15000)
        landed_on_msg = v1_cause
    except Exception:
        landed_on_msg = page.evaluate(
            """() => document.activeElement?.getAttribute('data-message-id') ?? null""")
    check("T11_in_thread_enabled_and_scrolls_after_reload",
          v1_enabled and landed_on_msg == v1_cause,
          enabled=v1_enabled, focused=landed_on_msg, expected=v1_cause)

    # ── Scene 3 (§6.3): FRESH session — cleared session storage + bridge restart ─
    page.evaluate("() => window.sessionStorage.clear()")
    set_fixture(ORIGIN, restart_bridge=True)
    interactive_gets.clear()
    page.reload(wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)  # re-add: styles die with the reload
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    # Doc-feedback re-scope: rail tab instead of the retired strip toggle.
    page.locator('[data-testid="panel-rail-tab"][data-tab="chat"]').click()
    page.locator('[data-testid="thread"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread-stopgap"]').wait_for(timeout=30000)

    fresh = page.evaluate(
        """(args) => {
             const [brief, steer] = args;
             const texts = Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
               .map((m) => m.textContent || '');
             const stopgap = document.querySelector('[data-testid="thread-stopgap"]')?.textContent || '';
             return {
               textBack: texts.some((t) => t.includes(brief)) && texts.some((t) => t.includes(steer)),
               narrationBack: !!document.querySelector('[data-testid="doc-narration"]'),
               noMarkerFaked: !document.querySelector('[data-testid="version-marker"]'),
               noEmptyState: !!texts.length,
               stopgap,
             };
           }""", [BRIEF, STEER])
    stopgap_ok = all(phrase in fresh["stopgap"] for phrase in STOPGAP_MUST_SAY)
    conv_reads = [g for g in interactive_gets if g.endswith("/api/conversation")]

    page.screenshot(path=str(VSHOTS / "ux-T-thread-reload.png"))

    # The In-thread affordances live in the panel's Versions tab now (doc-
    # feedback re-scope) — open it to read their disabled-with-reason state.
    page.locator('[data-testid="panel-tab"][data-tab="versions"]').click()
    page.locator('[data-testid="version-detail"]').first.wait_for(timeout=30000)
    scroll_state = page.evaluate(
        """() => {
             const scrolls = Array.from(document.querySelectorAll('[data-testid="version-scroll"]'));
             return {
               inThreadAllDisabled: scrolls.length > 0 && scrolls.every((b) => b.disabled),
               disabledReasonHonest: (scrolls[0]?.title || '').includes('version anchors'),
             };
           }""")
    check("T12_fresh_session_text_back_stopgap_on_anchor_gap_only",
          fresh["textBack"] and fresh["narrationBack"] and fresh["noMarkerFaked"]
          and fresh["noEmptyState"] and stopgap_ok
          and scroll_state["inThreadAllDisabled"] and scroll_state["disabledReasonHonest"]
          and conv_reads == [conv_path],
          stopgap_copy_ok=stopgap_ok, conversation_reads=conv_reads, **scroll_state,
          **{k: v for k, v in fresh.items() if k != "stopgap"})

    # Console hygiene: the deliberate 500 refusal logs one resource error; nothing
    # else may.
    unexpected = [e for e in console_errors
                  if "500" not in e and "Failed to load resource" not in e]
    check("T13_no_unexpected_console_errors", unexpected == [], errors=unexpected)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
report["shots"] = ["ux-T-thread-states.png", "ux-T-thread-reload.png"]
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
