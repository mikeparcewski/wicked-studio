#!/usr/bin/env python3
"""
ux2_docfb2_test.py — the click-to-edit RESTORE gate (operator finding: "can't
click and edit like the original wicked-interactive"), proven in a real browser
against the shared W2 fixture (uxfix_fixture.py). No crew daemon.

The diagnosis this rig pins (src/interactive/instrumented.ts carries the full
story): the production instrument-bridge injector promised by doc-fixture.html's
contract comment half-shipped — interactive's instrument.js injects data-wid
ANCHORS but no repo anywhere served the bridge SCRIPT, so studio's sandboxed
frame never answered the overlay's handshake and "Comment" rendered permanently
disabled. The restore: studio fetches the version HTML, injects the bridge
itself, renders via srcdoc (same sandbox, opaque origin), and the bridge
restores the ORIGINAL grammar — click a block, get the card.

The ACs:

  1. HANDSHAKE FROM INJECTION, HONESTLY: the wire's own /doc/1 HTML carries NO
     bridge (asserted against the fixture bytes), yet the overlay reaches
     data-ready="true" — readiness can only have come from studio's injected
     bridge. The frame renders via srcdoc with sandbox="allow-scripts" and the
     src attribute still names the version address.
  2. CLICK-TO-EDIT, NO MODE TOGGLE (the original grammar): hovering the
     headline INSIDE the frame highlights it; clicking it opens the targeted
     card at that wid — with the comment mode toggle still OFF and no hit
     layer mounted. A composite block (click the footer → nearest ancestor
     slide-1) gets a card WITHOUT the Change-text pair (the destructive-
     replace rule).
  3. THE DETERMINISTIC EDIT RIDES THE REAL WIRE: Change text seeds the block's
     EXACT current text; the submitted POST body is the ADR-0002 schema —
     feedback.submitted with items [{selector, type:"content-edit", value,
     before}] — one event, one inject.
  4. THE EDIT LANDS AS A NEW VERSION: the fixture materializes (the real
     materializeFeedback shape) — version.created {kind:"deterministic"} — the
     canvas swaps to v2 whose h1 IS the typed text, the composer returns
     terminal (the landing consumed the anchor), and the THREAD records the
     batch: one user message wearing the item deep-link and the v2 marker.
  5. STRUCTURAL COMMENTS STAY HONEST: a This-block comment submits as
     structural-change and the thread STAYS generating — the agent owes the
     version, and nothing pretends otherwise.

Captures (§12.0 contract: 1440x900, dsf 1) into e2e/shots/vision/:
  ux2-docfb2-card.png     the card open on the clicked headline, mode pair up
  ux2-docfb2-landed.png   v2 landed: edited canvas + the batch in the thread

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4411), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import urllib.request
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4411"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

DOC_URL = f"{ORIGIN}/p/scratch/document"
BRIEF = "Make me a deck for the Q3 review"
NEW_HEADLINE = "Q3: the quarter we shipped everything"
STRUCTURAL_ASK = "make this whole slide darker"

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


def get_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=10) as res:
        return res.read().decode("utf-8", "replace")


# ── 1. The same-origin build + the shared W2 fixture (default switches) ────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # ── Scene 0: create v1 — the document the loop edits ───────────────────────
    page.goto(DOC_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    composer = page.locator('[data-testid="doc-composer"]')
    composer.fill(BRIEF)
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=30000)
    doc_id = urlparse(page.url).path.rsplit("/", 1)[-1]

    # ── AC1: readiness CAME FROM the injection — the wire html has no bridge ───
    wire_html = get_text(
        f"{ORIGIN}/api/v1/projects/scratch/interactive/d/{doc_id}/doc/1")
    page.locator('[data-testid="feedback-overlay"][data-ready="true"]').wait_for(timeout=30000)
    frame_facts = page.evaluate(
        """() => {
             const f = document.querySelector('[data-testid="doc-canvas"]');
             return {
               sandbox: f?.getAttribute('sandbox'),
               srcNamesVersion: /\\/doc\\/1$/.test(f?.getAttribute('src') || ''),
               srcdocInjected: (f?.getAttribute('srcdoc') || '').includes('request-inventory'),
               toggleEnabled: !document.querySelector('[data-testid="feedback-toggle"]')?.disabled,
             };
           }""")
    check("AC1_handshake_from_injection",
          "request-inventory" not in wire_html          # the wire serves NO bridge…
          and 'data-wid="headline"' in wire_html        # …but the anchors are there
          and frame_facts["srcdocInjected"]             # studio injected its own
          and frame_facts["sandbox"] == "allow-scripts"
          and frame_facts["srcNamesVersion"]
          and frame_facts["toggleEnabled"],
          **frame_facts)

    # ── AC2: the original grammar — hover highlights, click opens the card ─────
    doc_frame = page.frame_locator('[data-testid="doc-canvas"]')
    doc_frame.locator('[data-wid="headline"]').hover()
    page.locator('[data-testid="feedback-hover"][data-wid="headline"]').wait_for(timeout=10000)
    doc_frame.locator('[data-wid="headline"]').click()
    card = page.locator('[data-testid="feedback-comment"]')
    card.wait_for(timeout=10000)
    direct = page.evaluate(
        """() => ({
             cardWid: document.querySelector('[data-testid="feedback-comment"]')
               ?.getAttribute('data-wid'),
             hitLayer: !!document.querySelector('[data-testid="feedback-hitlayer"]'),
             toggleActive: document.querySelector('[data-testid="feedback-toggle"]')
               ?.getAttribute('data-active'),
             modePair: !!document.querySelector('[data-testid="feedback-mode"]'),
           })""")
    check("AC2_click_to_edit_no_toggle",
          direct["cardWid"] == "headline"
          and not direct["hitLayer"]           # no mode was entered…
          and direct["toggleActive"] == "false"
          and direct["modePair"],              # …and the leaf block offers both modes
          **direct)
    page.screenshot(path=str(VSHOTS / "ux2-docfb2-card.png"))

    # A COMPOSITE block (the slide container, reached via its un-anchored footer)
    # gets a card WITHOUT the Change-text pair.
    page.locator('[data-testid="feedback-comment-cancel"]').click()
    doc_frame.locator("footer").click()
    card.wait_for(timeout=10000)
    composite = page.evaluate(
        """() => ({
             cardWid: document.querySelector('[data-testid="feedback-comment"]')
               ?.getAttribute('data-wid'),
             modePair: !!document.querySelector('[data-testid="feedback-mode"]'),
           })""")
    check("AC2_composite_hides_change_text",
          composite["cardWid"] == "slide-1" and not composite["modePair"], **composite)
    page.locator('[data-testid="feedback-comment-cancel"]').click()

    # ── AC3: Change text — seeded with the EXACT current text, schema on the wire ─
    v1_headline = doc_frame.locator('[data-wid="headline"]').inner_text().strip()
    doc_frame.locator('[data-wid="headline"]').click()
    card.wait_for(timeout=10000)
    page.locator('[data-testid="feedback-mode-change-text"]').click()
    seeded = page.locator('[data-testid="feedback-comment-input"]').input_value()
    page.locator('[data-testid="feedback-comment-input"]').fill(NEW_HEADLINE)
    page.locator('[data-testid="feedback-comment-add"]').click()
    page.locator('[data-testid="feedback-pin"][data-wid="headline"]').wait_for(timeout=10000)

    with page.expect_request(
        lambda r: r.method == "POST" and r.url.endswith("/interactive/api/events")
        and "feedback.submitted" in (r.post_data or ""),
        timeout=15000,
    ) as req_info:
        page.locator('[data-testid="feedback-submit"]').click()
    batch_body = json.loads(req_info.value.post_data or "{}")
    payload = batch_body.get("payload") or {}
    items = payload.get("items") or []
    check("AC3_schema_item_on_the_real_wire",
          seeded == v1_headline
          and batch_body.get("event_type") == "wicked.interactive.feedback.submitted"
          and payload.get("document_id") == doc_id
          and payload.get("version") == 1
          and bool(payload.get("source_message_id"))
          and items == [{"selector": "headline", "type": "content-edit",
                         "value": NEW_HEADLINE, "before": v1_headline}],
          seeded=seeded, wire_body=batch_body)

    # ── AC4: the deterministic edit LANDS — canvas, composer, thread ───────────
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    page.frame_locator('[data-testid="doc-canvas"]') \
        .locator('[data-wid="headline"]').wait_for(timeout=30000)
    v2_headline = page.frame_locator('[data-testid="doc-canvas"]') \
        .locator('[data-wid="headline"]').inner_text().strip()
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=15000)
    page.locator('[data-testid="version-marker"][data-version="2"]').wait_for(timeout=15000)
    thread_facts = page.evaluate(
        """() => {
             const msgs = Array.from(document.querySelectorAll('[data-testid="doc-message"]'));
             const batch = msgs.find(m => m.getAttribute('data-items') === '1');
             return {
               batchRecorded: !!batch,
               itemLink: !!batch?.querySelector(
                 '[data-testid="feedback-item-link"][data-wid="headline"]'),
               textCarriesEdit: (batch?.textContent || '').includes('[headline]'),
               generatingChips: document.querySelectorAll(
                 '[data-testid="thread-generating"]').length,
             };
           }""")
    manifest = json.loads(get_text(
        f"{ORIGIN}/api/v1/projects/scratch/interactive/d/{doc_id}/api/versions"))
    v2 = next((e for e in manifest["versions"] if e["version"] == 2), None)
    check("AC4_deterministic_edit_lands_as_v2",
          v2_headline == NEW_HEADLINE
          and v2 is not None and v2["parent"] == 1
          and bool(v2.get("feedback_file"))     # the manifest records the batch
          and thread_facts["batchRecorded"] and thread_facts["itemLink"]
          and thread_facts["textCarriesEdit"]
          and thread_facts["generatingChips"] == 0,   # the landing consumed the anchor
          v2_headline=v2_headline, manifest_v2=v2, **thread_facts)
    page.screenshot(path=str(VSHOTS / "ux2-docfb2-landed.png"))

    # ── AC5: a structural comment stays honestly UNANSWERED ────────────────────
    doc_frame2 = page.frame_locator('[data-testid="doc-canvas"]')
    doc_frame2.locator('[data-wid="headline"]').click()
    card.wait_for(timeout=10000)
    page.locator('[data-testid="feedback-comment-input"]').fill(STRUCTURAL_ASK)
    page.locator('[data-testid="feedback-comment-add"]').click()
    with page.expect_request(
        lambda r: r.method == "POST" and r.url.endswith("/interactive/api/events")
        and "feedback.submitted" in (r.post_data or ""),
        timeout=15000,
    ) as req2_info:
        page.locator('[data-testid="feedback-submit"]').click()
    body2 = json.loads(req2_info.value.post_data or "{}")
    items2 = (body2.get("payload") or {}).get("items") or []
    page.locator('[data-testid="thread"][data-composer-state="generating"]').wait_for(timeout=15000)
    check("AC5_structural_comment_stays_generating",
          len(items2) == 1
          and items2[0].get("selector") == "headline"
          and items2[0].get("type") == "structural-change"
          and items2[0].get("instruction") == STRUCTURAL_ASK,
          wire_body=body2)

    # ── The mode toggle SURVIVES beside the direct grammar ─────────────────────
    page.locator('[data-testid="feedback-toggle"]').click()
    page.locator('[data-testid="feedback-hitlayer"]').wait_for(timeout=10000)
    page.locator('[data-testid="feedback-toggle"]').click()
    page.locator('[data-testid="feedback-hitlayer"]').wait_for(state="detached", timeout=10000)
    report["steps"]["comment_mode_survives"] = {"ok": True}

    # Console hygiene (the sibling rig's contract): nothing unexpected.
    unexpected = [e for e in console_errors
                  if "404" not in e and "Failed to load resource" not in e]
    check("console_hygiene", unexpected == [], errors=unexpected)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
report["shots"] = ["ux2-docfb2-card.png", "ux2-docfb2-landed.png"]
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
