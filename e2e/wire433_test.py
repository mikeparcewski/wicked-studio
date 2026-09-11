#!/usr/bin/env python3
"""
wire433_test.py — the wicked-core#431 wire (api-types 0.33.0) on the three
studio surfaces, in a real browser against the shared loopback fixture
(uxfix_fixture.py, switch `wire433`). No crew daemon is involved.

  1. GATE CARD (r-api's escalated verify gate): the verdict header names the
     judge seat (`judge: codex`); the restored-tree denial says "the evaluator's
     edit was discarded and the creator's verified tree restored", lists the
     discarded path, and carries the copyable `git show refs/wicked/suggestions/…`
     hint; Approve reads "Retry against the restored tree" (`data-retry-restored`);
     the engine's NEW prompt renders whole. No `git read-tree` command is offered
     (the engine already ran the remedy).
  2. RUN HEAD / TIMELINE (r-auth, failed): the What / Where card carries the
     `base` row ("origin/main @ f57069d · 5 behind · lifted to the tip"); the
     Timeline tab shows the `based on` head row and the `lift` row (LIFT-CONFLICT
     · testid-inventory.json); clicking the lift row renders the shared
     DeliverLift card in the detail panel.
  3. DELIVERY CARD (r-auth's rail Delivery section): `deliver-lift` in the
     `conflict` outcome — the conflicting file, "nothing was rebased and nothing
     was pushed", the remedy — and the unit's own refusal ONCE (the lift block
     omits its copy because `denial_reason` already carries it).

Captures (1440x900, device_scale_factor=1) into e2e/shots/wire433/:
  wire433-gate-restored.png     the gate card with the restored denial
  wire433-delivery-conflict.png the rail's Delivery body + the timeline lift detail

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/ when
the source changed. Env knobs: FEEDBACK_PORT (default 4433), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    WIRE433_BASE_AFTER,
    WIRE433_RESTORED_PROMPT,
    WIRE433_SUGGESTION_REF,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4433"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
SHOTS = REPO / "e2e" / "shots" / "wire433"

API_THREAD = "/p/api-migration/build/r-api"
AUTH_THREAD = "/p/auth-refactor/build/r-auth"

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


# ── 1. The same-origin build + the fixture with the wire433 corpus on ──────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, wire433=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)


def text(page, selector: str) -> str:
    loc = page.locator(selector)
    return loc.first.text_content() if loc.count() > 0 else ""


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── Scene 1: the gate card on r-api's thread ───────────────────────────────
    page.goto(f"{ORIGIN}{API_THREAD}", wait_until="domcontentloaded")
    page.locator('[data-testid="steering-gate"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # The verdict block is a view over the hydrated log — wait for it, not just the card.
    got_verdict = settled("""() => !!document.querySelector('[data-testid="gate-verdict-restored"]')""")
    gate = page.evaluate(
        """() => {
          const q = (s) => document.querySelector(s);
          const t = (s) => q(s)?.textContent ?? '';
          const card = q('[data-testid="steering-gate"]');
          const verdict = q('[data-testid="gate-verdict"]');
          return {
            prompt: t('[data-testid="steering-prompt"]'),
            retryRestored: card?.getAttribute('data-retry-restored'),
            approve: t('[data-testid="steering-approve"]').trim(),
            approveSteer: t('[data-testid="steering-approve-steer"]').trim(),
            verdict: verdict?.getAttribute('data-verdict'),
            denialSource: verdict?.getAttribute('data-denial-source'),
            judgeSeat: t('[data-testid="gate-verdict-judge-seat"]'),
            judgeDistinct: q('[data-testid="gate-verdict-judge-seat"]')?.getAttribute('data-judge-distinct'),
            sameSeatWarning: !!q('[data-testid="gate-verdict-judge-same-seat"]'),
            restored: t('[data-testid="gate-verdict-restored"]'),
            suggestionRef: q('[data-testid="gate-verdict-restored"]')?.getAttribute('data-suggestion-ref'),
            hint: t('[data-testid="gate-verdict-suggestion-hint"]'),
            hintTag: q('[data-testid="gate-verdict-suggestion-hint"]')?.tagName,
            denial: t('[data-testid="gate-verdict-denial"]'),
            readTreeOffered: /git read-tree/.test(t('[data-testid="gate-verdict"]')),
            restoreFailed: !!q('[data-testid="gate-verdict-restore-failed"]'),
            liftBlock: !!q('[data-testid="deliver-lift"]'),
          };
        }""")
    check(
        "gate_card_restored_denial",
        got_verdict
        and gate["prompt"].strip() == WIRE433_RESTORED_PROMPT
        and gate["retryRestored"] == "true"
        and gate["approve"] == "Retry against the restored tree"
        and gate["approveSteer"] == "Retry + steer"
        and gate["verdict"] == "fail"
        and gate["denialSource"] == "worktree_guard"
        and "judge: codex" in gate["judgeSeat"]
        and gate["judgeDistinct"] == "true"
        and not gate["sameSeatWarning"]
        and "the evaluator's edit was discarded and the creator's verified tree restored" in gate["restored"]
        and "discarded: M src/App.tsx" in gate["restored"]
        and gate["suggestionRef"] == WIRE433_SUGGESTION_REF
        and gate["hint"].strip() == f"git show {WIRE433_SUGGESTION_REF}"
        and gate["hintTag"] == "CODE"
        and "The evaluator's edit was DISCARDED" in gate["denial"]
        and not gate["readTreeOffered"]
        and not gate["restoreFailed"]
        and not gate["liftBlock"],  # a gate on the verify ord shows no deliver lift
        **gate,
    )
    page.locator('[data-testid="gate-verdict-restored"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "wire433-gate-restored.png"))

    # ── Scene 2: the run head + timeline on r-auth's thread ───────────────────
    page.goto(f"{ORIGIN}{AUTH_THREAD}", wait_until="domcontentloaded")
    page.locator('[data-testid="failure-banner"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # The What / Where accordion may not be the open one — open it if the base row is not visible.
    if page.locator('[data-testid="run-base"]').count() == 0:
        page.get_by_role("button", name=re.compile(r"What / Where")).first.click()
    base_ok = settled("""() => !!document.querySelector('[data-testid="run-base"]')""")
    base_text = text(page, '[data-testid="run-base"]')
    check(
        "run_head_base_row",
        base_ok
        and f"origin/main @ {WIRE433_BASE_AFTER[:7]}" in base_text
        and "5 behind" in base_text
        and "lifted to the tip" in base_text,
        base=base_text,
    )

    # The FEED is the default lens: the narrator speaks the new frames.
    feed_ok = settled(
        """() => Array.from(document.querySelectorAll('[data-testid="narration-line"]'))
              .some(n => /Deliver lift: CONFLICT/.test(n.textContent ?? ''))""")
    lines = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="narration-line"]'))
              .map(n => (n.textContent ?? '').trim())
              .filter(t => /Based on|Deliver lift/.test(t))""")
    check(
        "feed_narration",
        feed_ok
        and any(f"Based on origin/main @ {WIRE433_BASE_AFTER[:7]} · 5 behind · lifted to the tip" in t for t in lines)
        and any("Deliver lift: CONFLICT in testid-inventory.json — nothing rebased, nothing pushed" in t for t in lines),
        lines=lines,
    )

    # The Timeline lens (a terminal run's recorded trail) is demoted behind the
    # Inspect menu (DES-RUN-NARRATOR §8, revised) — the menu item keeps `tab-timeline`.
    page.locator('[data-testid="run-inspect"]').first.click()
    page.locator('[data-testid="tab-timeline"]').first.wait_for(timeout=10000)
    page.locator('[data-testid="tab-timeline"]').first.click()
    rows_ok = settled(
        """() => !!document.querySelector('[data-testid="timeline-row"][data-event-type="runBaseResolved"]')
              && !!document.querySelector('[data-testid="timeline-row"][data-event-type="deliverLiftEvaluated"]')""")
    rows = page.evaluate(
        """() => {
          const r = (t) => document.querySelector(`[data-testid="timeline-row"][data-event-type="${t}"]`);
          return {
            based: r('runBaseResolved')?.textContent ?? '',
            lift: r('deliverLiftEvaluated')?.textContent ?? '',
            failed: r('stepFailed')?.textContent ?? '',
            rowCount: document.querySelectorAll('[data-testid="timeline-row"]').length,
          };
        }""")
    check(
        "timeline_rows",
        rows_ok
        and "based on" in rows["based"]
        and f"origin/main @ {WIRE433_BASE_AFTER[:7]}" in rows["based"]
        and "lift" in rows["lift"]
        and "LIFT-CONFLICT" in rows["lift"]
        and "testid-inventory.json" in rows["lift"],
        **rows,
    )
    page.locator('[data-testid="timeline-row"][data-event-type="deliverLiftEvaluated"]').first.click()
    detail_ok = settled(
        """() => !!document.querySelector('[data-testid="timeline-detail"] [data-testid="deliver-lift"][data-outcome="conflict"]')""")
    detail = page.evaluate(
        """() => {
          const d = document.querySelector('[data-testid="timeline-detail"]');
          const t = (s) => d?.querySelector(s)?.textContent ?? '';
          return {
            outcome: d?.querySelector('[data-testid="deliver-lift"]')?.getAttribute('data-outcome'),
            conflicts: t('[data-testid="deliver-lift-conflicts"]'),
            remedy: t('[data-testid="deliver-lift-remedy"]'),
            failure: t('[data-testid="deliver-lift-failure"]'),
          };
        }""")
    check(
        "timeline_lift_detail",
        detail_ok
        and detail["outcome"] == "conflict"
        and detail["conflicts"].strip() == "testid-inventory.json"
        and "rebase onto origin/main" in detail["remedy"]
        and detail["failure"].startswith("deliver: LIFT-CONFLICT"),
        **detail,
    )

    # ── Scene 3: the rail's Delivery section ───────────────────────────────────
    page.get_by_role("button", name=re.compile(r"^Delivery")).first.click()
    lift_ok = settled("""() => !!document.querySelector('[data-testid="run-delivery"] [data-testid="deliver-lift"]')""")
    delivery = page.evaluate(
        """() => {
          const card = document.querySelector('[data-testid="run-delivery"]');
          const t = (s) => card?.querySelector(s)?.textContent ?? '';
          const all = (s) => card ? card.querySelectorAll(s).length : 0;
          return {
            state: card?.getAttribute('data-state'),
            badge: document.querySelector('[data-testid="run-delivery-badge"]')?.textContent ?? '',
            outcome: card?.querySelector('[data-testid="deliver-lift"]')?.getAttribute('data-outcome'),
            summary: t('[data-testid="deliver-lift-summary"]'),
            conflicts: t('[data-testid="deliver-lift-conflicts"]'),
            remedy: t('[data-testid="deliver-lift-remedy"]'),
            reason: t('[data-testid="run-delivery-reason"]'),
            liftFailureBlocks: all('[data-testid="deliver-lift-failure"]'),
            refusalMentions: (card?.textContent ?? '').split('LIFT-CONFLICT — lifting').length - 1,
            worktree: /the work is in/.test(card?.textContent ?? ''),
            pushOrPrClaimed: /PR open|pushed the branch/.test(card?.textContent ?? ''),
          };
        }""")
    check(
        "delivery_card_lift_conflict",
        lift_ok
        and delivery["state"] == "failed"
        and delivery["badge"] == "deliver failed"
        and delivery["outcome"] == "conflict"
        and "nothing was rebased and nothing was pushed" in delivery["summary"]
        and delivery["conflicts"].strip() == "testid-inventory.json"
        and "remedy:" in delivery["remedy"]
        and delivery["reason"].startswith("deliver: LIFT-CONFLICT")
        and delivery["liftFailureBlocks"] == 0  # denial_reason already carries the refusal
        and delivery["refusalMentions"] == 1
        and delivery["worktree"]
        and not delivery["pushOrPrClaimed"],
        **delivery,
    )
    page.screenshot(path=str(SHOTS / "wire433-delivery-conflict.png"))

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
