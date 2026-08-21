#!/usr/bin/env python3
"""
uxfix_slice1_test.py — the DES-UXFIX-001 slice-1 gate: attention decay + board
bands, proven in a real browser against the W2 messy-reality fixture (§4.2).

The daemon cannot produce an 8-day-old failure — its durable log is stamped at
emit and `POST /runs` starts now — so the fixture is served by the SHARED
DETERMINISTIC FIXTURE SERVER in `uxfix_fixture.py` (extracted from this rig;
same pattern the doc rig in studio_standalone_test.py §12 uses): a
ThreadingHTTPServer that serves the `dist-sameorigin/` build (the
no-VITE_API_HOST build — `apiBase()` derives from window.location, so the page,
the API and the `/ws` handshake share ONE origin, no rebuild) plus every
endpoint the home route reads, with all timestamps computed from a single NOW0
captured at import.  No crew daemon is involved anywhere.

What it asserts (design §5.5, the slice-1 DOM AC):
  1. `legacy-spike` (failed 8 DAYS ago, but its project touched an hour ago —
     the R3 trap) is NOT inside band-needs-you; its card carries
     data-band="quiet". This exercises the `runEvents` backfill for real.
  2. `upload-endpoint` (live, streaming narration over the rig's /ws) IS inside
     band-needs-you and precedes legacy-spike in document order.
  3. The full expected NEEDS YOU order: q3-review-deck (gate 30s) →
     api-migration (gate 2m) → auth-refactor (failed 12m) → upload-endpoint.
  4. A gate whose receivedAt is 8 days old STILL leads (∞ half-life, in the
     browser) — driven by flipping the fixture's gate age and reloading.
  5. `band-not-in-project` is last in document order, collapsed, its count
     matches the orphan run; with the orphan removed it is absent entirely.
  6. No card inside band-needs-you has data-score < 20; no mounted card outside
     it has one >= 20.
  7. The bounded-page invariants hold with the 20 quiet clones: board height <=
     viewport, document height <= viewport, cards mounted < data-total.

Captures (§4.0 contract: 1440x900, device_scale_factor=1, waits on data-testid,
never a sleep) into e2e/shots/uxfix/ — gitignored evidence, referenced by path
from the JSON report this script prints:
  uxfix-1-messy-board.png     the full W2 board, QUIET collapsed
  uxfix-1-quiet-expanded.png  the same board, QUIET expanded via its toggle

Prereqs: Python Playwright (`pip install playwright && playwright install
chromium`). Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env knobs: W2_PORT (default 4330), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    DAY,
    HIDE_GATE_TOASTS,
    NARRATION,
    NOW0,
    SHOTS,
    ensure_build,
    set_fixture as fixture_post,
    start_server,
)

W2_PORT = int(os.environ.get("W2_PORT", "4330"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the doc rig — no third studio build) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (§4.2 — `uxfix_fixture.py`, one frozen NOW0) ─
start_server(W2_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}


def set_fixture(**kwargs) -> None:
    fixture_post(ORIGIN, **kwargs)


# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

NEEDS_YOU_IDS = """() => Array.from(document.querySelectorAll(
    '[data-testid="band-needs-you"] [data-testid="project-card"]'))
    .map(c => c.dataset.projectId)"""

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]

console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # Settle on the DECAYED verdict, not the first paint: legacy-spike enters the
    # live band on its fresh `updated_at` and leaves it when the 8-day durable-log
    # tail lands (D3 step 2) — the wait is on that final state.
    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    # The live headline is streaming from the rig's own /ws before the shot.
    narration_ok = settled(
        """text => (document.querySelector(
             '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]')
             ?.textContent ?? '').includes(text)""",
        NARRATION,
    )

    needs_you = page.evaluate(NEEDS_YOU_IDS)
    legacy_not_leading = "legacy-spike" not in needs_you
    upload_leading = "upload-endpoint" in needs_you

    # Band order in the document: needs-you < quiet < not-in-project, shelf LAST.
    band_order_ok = page.evaluate(
        """() => { const b = document.querySelector('[data-testid="project-board"]');
                   const kids = Array.from(b.children).map(el => el.dataset.testid || '');
                   const iN = kids.indexOf('band-needs-you'), iQ = kids.indexOf('band-quiet'),
                         iU = kids.indexOf('band-not-in-project');
                   return iN >= 0 && iQ > iN && iU > iQ
                       && b.lastElementChild.dataset.testid === 'band-not-in-project'; }""")
    shelf_collapsed = page.evaluate(
        """() => { const s = document.querySelector('[data-testid="band-not-in-project"]');
                   return !!s && s.dataset.expanded === 'false' && s.dataset.count === '1'
                       && document.querySelectorAll('[data-testid="unfiled-run"]').length === 0; }""")
    # F5/V18: the junk bucket neither renders as a card nor by its old name.
    no_default_card = page.evaluate(
        """() => !document.querySelector('[data-project-id="default"]')
              && !document.body.innerText.includes('Unfiled')""")

    # ── Capture 1: the default first impression — QUIET collapsed (§4.0) ──────
    page.locator('[data-testid="band-quiet"][data-expanded="false"]').wait_for(timeout=10000)
    page.screenshot(path=str(SHOTS / "uxfix-1-messy-board.png"))

    # ── Expand QUIET; capture 2; then read the decay verdict off legacy's card ─
    page.locator('[data-testid="band-quiet-toggle"]').click()
    page.locator('[data-testid="band-quiet"][data-expanded="true"]').wait_for(timeout=10000)
    page.locator('[data-testid="band-quiet"] [data-testid="project-card"]').first.wait_for(timeout=10000)
    page.screenshot(path=str(SHOTS / "uxfix-1-quiet-expanded.png"))

    # Assertion 6, over every card the two windows currently mount.
    scores_ok = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="project-card"]'))
             .every(c => (c.closest('[data-testid="band-needs-you"]') !== null)
                       === (Number(c.dataset.score) >= 20))""")

    # Assertion 7: the bounded-page invariants, with the 20 clones expanded.
    board_h = page.evaluate(
        """() => document.querySelector('[data-testid="project-board"]').clientHeight""")
    doc_h = page.evaluate("() => document.documentElement.scrollHeight")
    total = int(page.locator('[data-testid="project-board"]').get_attribute("data-total") or 0)
    mounted = page.locator('[data-testid="project-card"]').count()
    invariants_ok = board_h <= 900 and doc_h <= 900 + 1 and 0 < mounted < total

    # Assertion 1's second half: legacy-spike's card carries the verdict. Its
    # epsilon score (≈3e-13, still > the clones' 0) puts it in the quiet band's
    # FIRST row, so at scrollTop 0 it is co-mounted with the whole NEEDS YOU band
    # — no scrolling. (Scrolling to the bottom here would race: once the scroll
    # event's re-render lands, the quiet window moves past row 0 and unmounts the
    # very card under assertion.)
    legacy_card_ok = settled(
        """() => { const c = document.querySelector(
                     '[data-testid="project-card"][data-project-id="legacy-spike"]');
                   return !!c && c.dataset.band === 'quiet' && c.dataset.signal === 'failing'
                       && Number(c.dataset.score) < 1; }""")
    # …and upload-endpoint's CARD precedes legacy-spike's in document order (EC4,
    # read from the DOM). Card-scoped: since slice 3 the RAIL also carries
    # data-project-id rows (the same axis as the board), so the bare attribute
    # is ambiguous — the assertion's subject was always the board card.
    precedes_ok = page.evaluate(
        """() => { const up = document.querySelector(
                     '[data-testid="project-card"][data-project-id="upload-endpoint"]');
                   const legacy = document.querySelector(
                     '[data-testid="project-card"][data-project-id="legacy-spike"]');
                   return !!up && !!legacy &&
                     !!(up.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING); }""")

    # ── Assertion 4: an 8-day-old GATE still leads — flip the age, reload ──────
    set_fixture(q3_gate_age_ms=8 * DAY)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    ancient_gate_ok = settled(
        """() => { const ids = Array.from(document.querySelectorAll(
                     '[data-testid="band-needs-you"] [data-testid="project-card"]'))
                     .map(c => c.dataset.projectId);
                   // still present, still ahead of every non-gate signal
                   return ids.includes('q3-review-deck')
                       && ids.indexOf('q3-review-deck') < ids.indexOf('auth-refactor'); }""")
    ancient_gate_score = page.evaluate(
        """() => document.querySelector(
             '[data-testid="project-card"][data-project-id="q3-review-deck"]')?.dataset.score ?? null""")

    # ── Assertion 5's second half: no orphan ⇒ no shelf in the DOM at all ──────
    set_fixture(orphan=False)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    settled("""() => document.querySelectorAll(
                 '[data-testid="band-needs-you"] [data-testid="project-card"]').length === 4""")
    shelf_absent = page.evaluate(
        """() => document.querySelector('[data-testid="band-not-in-project"]') === null""")

    ctx.close()
    browser.close()

report["steps"]["w2_board"] = {
    "ok": all([
        order_ok, narration_ok, legacy_not_leading, upload_leading, band_order_ok,
        shelf_collapsed, no_default_card, scores_ok, invariants_ok, legacy_card_ok,
        precedes_ok, ancient_gate_ok, shelf_absent,
    ]),
    "needs_you_order": needs_you,
    "expected_order": EXPECTED_ORDER,
    "needs_you_order_ok": order_ok,
    "live_narration_streamed": narration_ok,
    "legacy_spike_not_in_needs_you": legacy_not_leading,
    "upload_endpoint_in_needs_you": upload_leading,
    "upload_precedes_legacy_in_document": precedes_ok,
    "legacy_card_quiet_failing_decayed": legacy_card_ok,
    "band_order_needs_quiet_shelf": band_order_ok,
    "shelf_last_collapsed_counted": shelf_collapsed,
    "shelf_absent_without_orphan": shelf_absent,
    "no_default_card_no_unfiled_word": no_default_card,
    "score_threshold_matches_band": scores_ok,
    "ancient_gate_still_leads": ancient_gate_ok,
    "ancient_gate_score": ancient_gate_score,
    "board_height_px": board_h,
    "document_scroll_height_px": doc_h,
    "projects_total": total,
    "cards_mounted_expanded": mounted,
    "bounded_page_invariants": invariants_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(SHOTS / n) for n in
                    ("uxfix-1-messy-board.png", "uxfix-1-quiet-expanded.png")],
}
if not report["steps"]["w2_board"]["ok"]:
    fail("w2_board_verdict", "slice-1 W2 assertions did not all hold — see w2_board")

report["ok"] = True
print(json.dumps(report, indent=2))
