#!/usr/bin/env python3
"""
ux2_sliceBD_test.py — the DES-UX-002 slice-BD gate: the steering annotation
layer (§4 — brief DoD condition 2: "add pre-gate guidance from the home board;
it pre-populates the amend field when the gate arrives"). Runs against the
shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with `nerve` on: r-upload
(executing) is the annotated run; `gate_now` + an extra_gates frame ARRIVE
its gate mid-session.

TWO OPERATOR-STEER RE-SCOPES (recorded at the design run's gate) govern the
§4.5 ACs this rig asserts:

  (1) BINDINGS — the doc's Ctrl+F/K/X steer prefixes collide with native
      editing keys (Ctrl+X is cut). Built as Alt+1/2/3 on `KeyboardEvent.code`
      through the one shortcut registry; AC 4 asserts THOSE.
  (2) MEASURED WINDOW — the escalation→arrival window on the live daemon's
      real event logs is milliseconds (gateEvaluated→awaitingHuman median 4ms,
      p90 7ms over 81 windows; the one real gateEscalated→awaitingHuman gap
      was 1ms), so the honest variant ships: the widget is available on ANY
      executing run at ANY time — AC 1 asserts availability BEFORE any
      escalation, then that the gate-approaching chip is an entry point.

The §4.5 DOM ACs, as re-scoped:

  1. the executing run's ACTIVE card renders `[data-testid="pre-gate-annotate"]`
     with NO gateEscalated seen (the any-time contract); after a gateEscalated
     fixture frame, `[data-testid="gate-approaching"]` renders WITH the widget
     still present, and clicking the chip opens + focuses it;
  2. typing in the annotation field and then receiving the gate (fixture):
     the gate card's steer textarea renders `[data-testid="amend-prepopulated"]`
     with the typed text as its value, auto-expanded to the draft's line count;
     ZERO /api/v1 requests fire between the annotation save and gate arrival
     (request-tap) — the draft is client state, no invented wire;
  3. (RE-SCOPED by slice BE — CREW-UX-7/crew#312 landed, so the whole-widget
     session-scope label RETIRED with the gap it named): the EC52 label now
     names ONLY the unsaved edit — ABSENT on the freshly-opened widget,
     present with the honest-split copy once text is typed and unsaved;
  4. Alt+1 within the steer textarea inserts `Focus: ` at the cursor
     (keyboard event assert); Alt+2 `Skip: `; Alt+3 `Context: `;
  5. the '?' overlay lists the Focus:/Skip:/Context: steer prefixes under the
     GATES shortcut group, labelled with the Alt chords;
  6. (wire law) Approve+steer rides the pre-populated draft verbatim as the
     EXISTING `amend` field of POST /runs/:id/gate — no new wire.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-BD-pre-gate-annotate.png    the open widget on the board: draft + scope
                                 label + the gate-approaching chip
  ux-BD-steer-prepopulated.png   the gate card: steer textarea pre-populated

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4409),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    GATE_NOW_PROMPT,
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4409"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

CARD = '[data-testid="project-card"][data-project-id="upload-endpoint"]'
WIDGET = f'{CARD} [data-testid="pre-gate-annotate"]'
INPUT = f'{CARD} [data-testid="pre-gate-annotate-input"]'

CRITERION = ("the rate-limit middleware keeps every existing upload test green "
             "and enforces the burst budget")

# Three lines on purpose: AC 2's auto-expand needs a draft taller than the
# textarea's 2-row resting height.
DRAFT = ("keep the burst budget tests green\n"
         "prefer the token-bucket middleware\n"
         "do not touch the upload handler itself")

# EC52's honest copy after slice BE — must match src/store/annotations.ts
# DRAFT_SCOPE_LABEL verbatim (the durable endpoint landed: only the UNSAVED
# edit is still session-scoped, and the label says exactly that).
SCOPE_COPY = "unsaved edit — this browser session only until you save guidance."

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
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap (AC 2): every API request the page fires, by path.
    api_requests: list[str] = []
    page.on("request", lambda req: api_requests.append(urlparse(req.url).path)
            if "/api/v1/" in req.url else None)
    # The wire-law tap (AC 6): the gate decision's POST body.
    gate_posts: list = []
    page.on("request", lambda r: gate_posts.append(r.post_data)
            if r.method == "POST" and r.url.endswith("/runs/r-upload/gate") else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator(CARD).wait_for(timeout=30000)

    # ── Scene 1a (AC 1, the measured-truth half): the widget is available on an
    #    EXECUTING run with no escalation anywhere in sight ─────────────────────
    page.locator(WIDGET).wait_for(timeout=15000)
    before = page.evaluate(
        """(card) => {
          const root = document.querySelector(card);
          const w = root.querySelector('[data-testid="pre-gate-annotate"]');
          return {
            widgetOpen: w?.dataset.open ?? null,
            widgetRunId: w?.dataset.runId ?? null,
            approachingVisible: !!root.querySelector('[data-testid="gate-approaching"]'),
          };
        }""", CARD)
    check("widget_available_pre_escalation",
          before["widgetOpen"] == "false"
          and before["widgetRunId"] == "r-upload"
          and not before["approachingVisible"],
          **before)

    # ── Scene 1b (AC 1, the chip entry point): gateEscalated renders the chip
    #    WITH the widget; clicking the chip opens + focuses it ─────────────────
    set_fixture(ORIGIN, extra_frames=[
        {"type": "gateEscalated", "session": "r-upload", "ord": 3,
         "condition": CRITERION,
         "verdictSummary": "agent judge: fail — the burst budget is not enforced"},
    ])
    page.locator(f'{CARD} [data-testid="gate-approaching"]').wait_for(timeout=10000)
    check("chip_and_widget_coexist",
          page.evaluate(
              """(card) => !!document.querySelector(card + ' [data-testid="gate-approaching"]')
                    && !!document.querySelector(card + ' [data-testid="pre-gate-annotate"]')""",
              CARD))
    page.locator(f'{CARD} [data-testid="gate-approaching"]').click()
    page.locator(INPUT).wait_for(timeout=5000)
    # The focus lands on the next animation frame after the textarea mounts.
    page.wait_for_function(
        """(card) => {
          const w = document.querySelector(card + ' [data-testid="pre-gate-annotate"]');
          const input = document.querySelector(card + ' [data-testid="pre-gate-annotate-input"]');
          return w?.dataset.open === 'true' && document.activeElement === input;
        }""", arg=CARD, timeout=5000)
    check("chip_click_opens_and_focuses", True)

    # ── Scene 2 (AC 3 / EC52, slice-BE re-scope): a freshly-opened widget has
    #    NOTHING session-scoped — the label must be absent (durability holds) ───
    check("scope_label_absent_before_edit",
          page.evaluate(
              """(card) => !document.querySelector(
                   card + ' [data-testid="annotation-scope-label"]')""",
              CARD))

    # ── Scene 3 (AC 2, the save half): type the draft; the label now names the
    #    UNSAVED edit (exact honest-split copy); the window between the draft
    #    landing and gate arrival fires ZERO /api/v1 requests ───────────────────
    page.locator(INPUT).fill(DRAFT)
    scope = page.evaluate(
        """(card) => document.querySelector(
             card + ' [data-testid="annotation-scope-label"]')?.textContent ?? null""",
        CARD)
    check("scope_label_exact_honest_copy", scope == SCOPE_COPY, label=scope)
    page.wait_for_timeout(1500)  # let any (illegal) debounced write surface
    reads_before = len(api_requests)
    page.wait_for_timeout(1000)
    check("zero_requests_between_save_and_arrival",
          len(api_requests) == reads_before,
          reads_before=reads_before, tail=api_requests[reads_before:])
    page.screenshot(path=str(VSHOTS / "ux-BD-pre-gate-annotate.png"))

    # ── Scene 4 (AC 2, the arrival half / EC51): the gate ARRIVES — the run
    #    flips to awaiting_human and the thread's gate card pre-populates ───────
    set_fixture(ORIGIN, gate_now=["r-upload"], extra_gates=[
        {"session": "r-upload", "ord": 3, "prompt": GATE_NOW_PROMPT},
    ])
    chip = page.locator(f'{CARD} [data-testid="run-chip"][data-run-id="r-upload"]')
    page.wait_for_function(
        """(card) => document.querySelector(
             card + ' [data-testid="run-chip"][data-run-id="r-upload"]')
             ?.dataset.status === 'awaiting_human'""",
        arg=CARD, timeout=15000)
    # The approaching preview retired on the post (slice BA's standing contract).
    check("approaching_retires_on_arrival",
          page.evaluate(
              """(card) => !document.querySelector(card + ' [data-testid="gate-approaching"]')""",
              CARD))
    # SPA navigation (the draft store is session state — a reload would be a
    # different, dishonest test): the run chip is a real link into the thread.
    chip.click()
    page.locator('[data-testid="steering-gate"]').wait_for(timeout=30000)
    pre = page.evaluate(
        """() => {
          const ta = document.querySelector('[data-testid="amend-prepopulated"]');
          return {
            value: ta?.value ?? null,
            rows: ta?.rows ?? null,
            runId: ta?.dataset.runId ?? null,
            blankTestidAbsent: !document.querySelector('[data-testid="steering-amend"]'),
            steerArmed: !document.querySelector('[data-testid="steering-approve-steer"]')?.disabled,
          };
        }""")
    check("amend_prepopulated_with_draft",
          pre["value"] == DRAFT
          and pre["rows"] == 3  # auto-expanded to the draft's 3 lines
          and pre["runId"] == "r-upload"
          and pre["blankTestidAbsent"]
          and pre["steerArmed"],
          **pre)
    # The shot must SHOW the pre-populated textarea, not the fold above it.
    page.evaluate(
        """() => document.querySelector('[data-testid="amend-prepopulated"]')
             ?.scrollIntoView({ block: 'center' })""")
    page.wait_for_timeout(300)
    page.screenshot(path=str(VSHOTS / "ux-BD-steer-prepopulated.png"))

    # ── Scene 5 (AC 4, steer-corrected bindings): Alt+1/2/3 insert the prefixes
    #    at the cursor, inside the textarea ─────────────────────────────────────
    ta = page.locator('[data-testid="amend-prepopulated"]')
    ta.click()
    page.evaluate(
        """() => { const el = document.querySelector('[data-testid="amend-prepopulated"]');
                   el.focus(); el.setSelectionRange(0, 0); }""")
    page.keyboard.press("Alt+1")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="amend-prepopulated"]')
             ?.value.startsWith('Focus: ')""", timeout=5000)
    # Caret landed after the inserted prefix: Alt+2 at the CURSOR, not at 0.
    page.keyboard.press("Alt+2")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="amend-prepopulated"]')
             ?.value.startsWith('Focus: Skip: ')""", timeout=5000)
    page.keyboard.press("Alt+3")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="amend-prepopulated"]')
             ?.value.startsWith('Focus: Skip: Context: ')""", timeout=5000)
    check("prefixes_insert_at_cursor",
          len(gate_posts) == 0,  # the chords edited text; nothing leaked to the wire
          value_head=page.evaluate(
              """() => document.querySelector('[data-testid="amend-prepopulated"]')
                   ?.value.slice(0, 40)"""))

    # ── Scene 6 (AC 5): the '?' overlay documents the prefixes under GATES,
    #    with the corrected Alt labels ──────────────────────────────────────────
    page.evaluate("() => document.activeElement?.blur?.()")
    page.keyboard.press("?")
    page.locator('[data-testid="shortcut-overlay"]').wait_for(timeout=5000)
    overlay = page.evaluate(
        """() => {
          const g = document.querySelector('[data-testid="shortcut-group-gates"]');
          return { text: g?.textContent ?? '' };
        }""")
    check("overlay_lists_steer_prefixes_under_gates",
          all(s in overlay["text"] for s in
              ("Focus:", "Skip:", "Context:", "Alt/⌥+1", "Alt/⌥+2", "Alt/⌥+3")),
          **overlay)
    page.keyboard.press("Escape")

    # ── Scene 7 (AC 6, wire law): Approve+steer rides the draft as the EXISTING
    #    amend field — the client draft resolves into the standing wire ─────────
    edited = page.evaluate(
        """() => document.querySelector('[data-testid="amend-prepopulated"]')?.value""")
    page.locator('[data-testid="steering-approve-steer"]').click()
    page.wait_for_function("() => true", timeout=1000)
    page.wait_for_timeout(800)
    posts = [json.loads(b) for b in gate_posts]
    check("draft_rides_the_existing_amend_field",
          len(posts) == 1
          and posts[0].get("approve") is True
          and posts[0].get("amend") == edited,
          posts=posts)

    browser.close()

# Reset the mutable switches for any rig that shares this port later.
set_fixture(ORIGIN, gate_now=[])

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
