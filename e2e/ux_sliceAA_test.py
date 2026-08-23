#!/usr/bin/env python3
"""
ux_sliceAA_test.py — the DES-UX-001 slice-AA gate: toast lifecycle (§7.1, EC38, B4).
Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with
`batch_gates` giving four open gates across four projects (r-q3, r-api,
r-batch1, r-batch2) — enough to exercise the card cap, and to make one
project's shell see three FOREIGN gates.

The §7.1 DOM ACs, verbatim mapping (the gate EXPERIENCE is §0-protected —
every scene also asserts the gate RECORD survives its announcement):

  1. every `[data-testid="gate-notification"]` contains a
     `[data-testid="toast-dismiss"]`; dismissing hides the card but the runs
     bar's gate count never moves — the toast is an announcement, not the
     record;
  2. EC38 layout safety: the toast LAYER reserves no pointer surface (only
     its visible cards do), the stack caps at 3 cards + an inert overflow
     line, sits clear of the runs bar (a hit-test at "All runs ›" reaches the
     link with toasts up), and — the interception pin — with a toast visible
     on a gated run's own thread, a hit-test at the composer's Steer/Send
     coordinates reaches the button;
  3. toasts self-expire after the bounded dwell (20s), and the runs bar's
     gate count still names every gate afterwards;
  4. B4: inside `/p/:id/*`, a foreign project's gate paints NO overlay card —
     it announces as the runs bar's labeled "+N elsewhere" count and the
     bell's unread badge; a gate ARRIVING from another project mid-session
     increments that count without a card ever covering the mode surface.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-AA-toast-dismiss.png   /work with the capped toast stack up — each card
                            carrying its ✕, the overflow line beneath, the
                            runs bar's own gate count visible under the stack

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4394),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from datetime import datetime, timezone

from uxfix_fixture import (
    NOW0,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4394"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# Mirrors src/components/GateNotifications.tsx — the slice's two constants.
TOAST_DWELL_MS = 20_000
MAX_TOAST_CARDS = 3

Q3_SHELL = "/p/q3-review-deck/build"
Q3_THREAD = "/p/q3-review-deck/build/r-q3"

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


# ── 1. The same-origin build + the shared W2 fixture, batch gates ON ───────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, batch_gates=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

# The full toast census — every card, its dismiss control, and the layer's
# pointer posture — read in ONE evaluate so the dwell clock can't split it.
TOAST_CENSUS = """() => {
  const layer = document.querySelector('[data-testid="gate-notification-layer"]');
  const cards = [...document.querySelectorAll('[data-testid="gate-notification"]')];
  const bar = document.querySelector('[data-testid="runs-bottom-bar"]');
  const overflow = document.querySelector('[data-testid="gate-toast-overflow"]');
  const lr = layer?.getBoundingClientRect() ?? null;
  return {
    cards: cards.map((c) => c.getAttribute('data-run-id')),
    everyCardDismissible: cards.length > 0
      && cards.every((c) => !!c.querySelector('[data-testid="toast-dismiss"]')),
    layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
    layerBottom: lr ? Math.round(lr.bottom) : null,
    overflowText: overflow?.textContent ?? null,
    overflowPointerEvents: overflow ? getComputedStyle(overflow).pointerEvents : null,
    barGates: bar?.dataset.gates ?? null,
    barGatesElsewhere: bar?.dataset.gatesElsewhere ?? null,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    # Scenes 1–2 freeze Date (the harness convention) so the 20s dwell can never
    # expire a card mid-assert; scenes 3–4 use a fresh, unfrozen context because
    # expiry IS their subject.
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    # ── Scene 1 (AC 1 + EC38): /work — cap, dismiss contract, layout safety ────
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")
    page.locator('[data-testid="gate-notification"]').first.wait_for(timeout=30000)
    # All four gates announced: 3 cards + the overflow line.
    page.wait_for_function(
        """() => document.querySelectorAll('[data-testid="gate-notification"]').length === 3
              && !!document.querySelector('[data-testid="gate-toast-overflow"]')""",
        timeout=15000)
    census = page.evaluate(TOAST_CENSUS)
    check("cap_and_dismiss_contract",
          len(census["cards"]) == MAX_TOAST_CARDS
          and census["everyCardDismissible"]
          and census["layerPointerEvents"] == "none"
          and census["overflowText"] is not None and "+1 more waiting" in census["overflowText"]
          and census["overflowPointerEvents"] == "none"
          and census["barGates"] == "4",
          **census)
    # EC38 geometry: the stack sits clear of the runs bar…
    check("layer_clears_runs_bar",
          census["layerBottom"] is not None and census["barTop"] is not None
          and census["layerBottom"] <= census["barTop"],
          layer_bottom=census["layerBottom"], bar_top=census["barTop"])
    # …and reserves no pointer surface over it: the bar's "All runs ›" link is
    # hit-testable with the full stack up (the OLD stack started at 16px and
    # physically sat on the 28px bar).
    allruns_hit = page.evaluate(
        """() => {
          const link = document.querySelector('[data-testid="runs-bar-all"]');
          if (!link) return { found: false };
          const r = link.getBoundingClientRect();
          const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { found: true, reaches: link === el || link.contains(el),
                   toastsUp: document.querySelectorAll('[data-testid="gate-notification"]').length > 0 };
        }""")
    check("allruns_hit_test", allruns_hit["found"] and allruns_hit["reaches"]
          and allruns_hit["toastsUp"], **allruns_hit)
    page.screenshot(path=str(VSHOTS / "ux-AA-toast-dismiss.png"))

    # Dismiss one card: the 4th slides into the cap, the overflow line goes,
    # and the runs bar's count NEVER moves (§9: the record outlives the toast).
    first_run = census["cards"][0]
    page.locator('[data-testid="gate-notification"]').first \
        .locator('[data-testid="toast-dismiss"]').click()
    page.wait_for_function(
        """(rid) => ![...document.querySelectorAll('[data-testid="gate-notification"]')]
              .some((c) => c.getAttribute('data-run-id') === rid)
              && !document.querySelector('[data-testid="gate-toast-overflow"]')""",
        arg=first_run, timeout=10000)
    after_one = page.evaluate(TOAST_CENSUS)
    check("dismiss_hides_card_never_gate",
          len(after_one["cards"]) == 3 and first_run not in after_one["cards"]
          and after_one["barGates"] == "4",
          dismissed=first_run, **after_one)
    # Dismiss the rest: zero cards, the count still names all four gates.
    for _ in range(3):
        page.locator('[data-testid="toast-dismiss"]').first.click()
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"gate-notification\"]').length === 0",
        timeout=10000)
    check("all_dismissed_record_survives",
          page.evaluate("() => document.querySelector('[data-testid=\"runs-bottom-bar\"]')?.dataset.gates") == "4")

    # ── Scene 2 (EC38, the interception pin): the composer under a live toast ──
    page.goto(f"{ORIGIN}{Q3_THREAD}", wait_until="domcontentloaded")
    page.locator('[data-testid="gate-notification"]').first.wait_for(timeout=30000)
    page.wait_for_function(
        """() => [...document.querySelectorAll('button')]
              .some((b) => (b.textContent ?? '').includes('Steer'))""",
        timeout=15000)
    steer_hit = page.evaluate(
        """() => {
          const steer = [...document.querySelectorAll('button')]
            .find((b) => (b.textContent ?? '').includes('Steer'));
          if (!steer) return { found: false };
          const r = steer.getBoundingClientRect();
          const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          const cards = [...document.querySelectorAll('[data-testid="gate-notification"]')];
          return {
            found: true,
            reaches: steer === el || steer.contains(el),
            hitBy: el ? (el.getAttribute('data-testid') ?? el.tagName) : null,
            toastVisible: cards.length > 0,
            everyCardDismissible: cards.every((c) => !!c.querySelector('[data-testid="toast-dismiss"]')),
          };
        }""")
    check("composer_send_hit_test", steer_hit["found"] and steer_hit["reaches"]
          and steer_hit["toastVisible"] and steer_hit["everyCardDismissible"], **steer_hit)

    # ── Scene 3 (AC: expiry): the announcement dies, the gate does not ──────────
    # A fresh context: real clocks — the bounded dwell is the assertion here.
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx2.new_page()
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")
    page.locator('[data-testid="gate-notification"]').first.wait_for(timeout=30000)
    # Real-time dwell: bounded at 20s; give it 30s of budget.
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"gate-notification\"]').length === 0",
        timeout=TOAST_DWELL_MS + 10_000)
    check("expiry_bounded_record_survives",
          page.evaluate("() => document.querySelector('[data-testid=\"runs-bottom-bar\"]')?.dataset.gates") == "4")

    # ── Scene 4 (B4): the cross-project gate announces in the bar, not the canvas ─
    # `project_dto` on: a gate arriving from a project this session has never
    # seen resolves through the run DTO's own `project_id` claim (CREW-UX-2) —
    # the membership mirror alone can't place a project that joined mid-session.
    set_fixture(ORIGIN, batch_gates=False, project_dto=True)
    page.goto(f"{ORIGIN}{Q3_SHELL}", wait_until="domcontentloaded")
    page.locator('[data-testid="mode-switcher"]').wait_for(timeout=30000)
    # On load: r-q3's own card only; r-api (api-migration) is already a foreign
    # gate — counted, never painted.
    page.wait_for_function(
        """() => document.querySelector('[data-testid="runs-bottom-bar"]')
              ?.dataset.gatesElsewhere === '1'""",
        timeout=15000)
    shell = page.evaluate(TOAST_CENSUS)
    check("foreign_gate_no_card_on_load",
          shell["cards"] == ["r-q3"] and shell["barGates"] == "1"
          and shell["barGatesElsewhere"] == "1",
          **shell)
    bell_unread_before = page.evaluate(
        """() => /unread/.test(document.querySelector('button[title="Notifications"]')
             ?.getAttribute('aria-label') ?? '')""")

    # A gate ARRIVES from another project (the §8.4 one-shot awaitingHuman frame,
    # plus the batch corpus joining the run list on the refresh it triggers).
    set_fixture(ORIGIN, batch_gates=True,
                extra_gates=[{"session": "r-batch1", "ord": 0,
                              "prompt": "Ship the version bump?"}])
    page.wait_for_function(
        """() => document.querySelector('[data-testid="runs-bottom-bar"]')
              ?.dataset.gatesElsewhere === '3'""",
        timeout=30000)
    arrival = page.evaluate(TOAST_CENSUS)
    elsewhere_label = page.evaluate(
        """() => document.querySelector('[data-testid="runs-bar-gates-elsewhere"]')
             ?.textContent ?? null""")
    bell_unread_after = page.evaluate(
        """() => /unread/.test(document.querySelector('button[title="Notifications"]')
             ?.getAttribute('aria-label') ?? '')""")
    check("arrival_increments_bar_never_canvas",
          all(rid == "r-q3" for rid in arrival["cards"])  # own card may have expired; NO foreign card ever
          and arrival["barGatesElsewhere"] == "3"
          and elsewhere_label is not None and "+3 elsewhere" in elsewhere_label
          and bell_unread_after,
          bell_unread_before=bell_unread_before, bell_unread_after=bell_unread_after,
          elsewhere_label=elsewhere_label, **arrival)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
