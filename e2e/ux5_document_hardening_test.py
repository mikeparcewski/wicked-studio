#!/usr/bin/env python3
"""
ux5_document_hardening_test.py — the wave-5 document-thread gate (phase4-r2 re-run
findings F-4R2-016 / -014 / -005 / -006 / -003), driven in a REAL browser against the
deterministic loopback fixture (uxfix_fixture.py — no crew daemon, no bridge).

Scenes, one per finding:

  1. F-4R2-016 — the export bar answers PER FORMAT: with the HTML download READY and
     un-acted, asking for the PDF shows the pending spinner ON the PDF button, then the
     PDF button becomes its own download while the HTML one stays; the bridge's
     additive report (interactive#219) reads "PDF ready — 2 pages · A4 portrait" under
     the row and on the thread line.
  2. F-4R2-014 — a deliverable-floor failure renders as the human card: one sentence,
     a link to the run page, the raw dump folded (no absolute path / API URL in the
     visible copy), and Retry re-posts the SAME ask on the inject wire.
  3. F-4R2-005 — heartbeats fold: five re-emissions of the current narration are ONE
     `doc-narration` row with `data-repeats` and a ticking elapsed span.
  4. F-4R2-006 — a fresh context (no session storage) opening a doc whose run is still
     executing reads `generating` (not `terminal`) from the run record, with the
     "open run" link on the chip.
  5. F-4R2-003 — the name field: derived live from the brief; a 409 on an existing name
     names the document, links it, and "use a different name" creates `<name>-2`.

Captures (1440x900, dsf 1) into e2e/shots/vision/: ux5-export-per-format.png,
ux5-run-failed-card.png, ux5-heartbeat-fold.png, ux5-reload-restore.png,
ux5-name-collision.png.

Prereqs: Python Playwright with a Chromium already installed (this rig never installs
browsers). Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1. Env knobs:
FEEDBACK_PORT (default 4405). Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4405"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
PID = "scratch"

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


def visible_text(page, selector: str) -> str:
    """The element's text WITHOUT its <details> children — what a reader sees folded."""
    return page.evaluate(
        """(sel) => {
             const el = document.querySelector(sel);
             if (!el) return '';
             return Array.from(el.childNodes)
               .filter((n) => !(n instanceof HTMLElement && n.tagName === 'DETAILS'))
               .map((n) => n.textContent).join(' ');
           }""", selector)


def open_panel(page) -> None:
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    if page.locator('[data-testid="panel-expand"]').count() > 0:
        page.locator('[data-testid="panel-expand"]').click()
    page.locator('[data-testid="chat-export"]').wait_for(timeout=15000)


# ── The same-origin build + the shared fixture ────────────────────────────────
dist = ensure_build(lambda step, why: check(step, False, error=why))
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # ── Scene 1 (F-4R2-016): the export bar answers per format ────────────────
    set_fixture(ORIGIN, doc_run_ms=0, export_report=True, export_delay_ms=1200)
    doc1 = api_create_doc("w5-brochure", "a two-page A4 brochure")["name"]
    page.goto(f"{ORIGIN}/p/{PID}/document/{doc1}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    open_panel(page)
    page.locator('[data-testid="export-format"][data-format="html"]').click()
    page.locator('[data-testid="export-ready"][data-format="html"]').wait_for(timeout=15000)
    # The HTML download is left UN-ACTED; now the PDF.
    page.locator('[data-testid="export-format"][data-format="pdf"]').click()
    pending = page.evaluate(
        """() => {
             const pend = document.querySelector('[data-testid="export-pending"]');
             return { pending: !!pend, onPdf: !!pend && !!pend.closest('[data-format="pdf"]') };
           }""")
    check("pdf_pending_on_the_pdf_button", pending["pending"] and pending["onPdf"], **pending)
    page.locator('[data-testid="export-ready"][data-format="pdf"]').wait_for(timeout=15000)
    landed = page.evaluate(
        """() => ({
             ready: Array.from(document.querySelectorAll('[data-testid="export-ready"]')).map((a) => a.getAttribute('data-format')),
             pending: !!document.querySelector('[data-testid="export-pending"]'),
             buttons: Array.from(document.querySelectorAll('[data-testid="export-format"]')).map((b) => b.getAttribute('data-format')),
             pdfPages: document.querySelector('[data-testid="export-ready"][data-format="pdf"]')?.getAttribute('data-pages'),
             report: document.querySelector('[data-testid="export-report"][data-format="pdf"]')?.textContent,
             threadLine: Array.from(document.querySelectorAll('[data-testid="doc-agent"]')).map((m) => m.textContent).find((t) => t.includes('PDF export ready')),
           })""")
    check("pdf_chip_flips_while_html_stays",
          landed["ready"] == ["html", "pdf"] and not landed["pending"] and landed["buttons"] == ["pptx"],
          **landed)
    check("pdf_report_rendered",
          landed["pdfPages"] == "2"
          and "PDF ready — 2 pages · A4 portrait" in (landed["report"] or "")
          and "· 2 pages · A4 portrait" in (landed["threadLine"] or ""),
          **landed)
    page.screenshot(path=str(VSHOTS / "ux5-export-per-format.png"))
    set_fixture(ORIGIN, export_delay_ms=0)

    # ── Scene 2 (F-4R2-014): the deliverable-floor failure, for a human ───────
    set_fixture(ORIGIN, doc_fail_floor=True)
    injects: list = []
    page.on("request", lambda r: injects.append(r.post_data or "")
            if r.method == "POST" and r.url.endswith("/interactive/api/events")
            and "chat.posted" in (r.post_data or "") else None)
    ask = "Design change only — replace the violet accent with a deep teal."
    page.locator('[data-testid="doc-composer"]').fill(ask)
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-run-failed"]').wait_for(timeout=15000)
    card = page.evaluate(
        """() => {
             const c = document.querySelector('[data-testid="doc-run-failed"]');
             const d = c.querySelector('[data-testid="doc-run-failed-details"]');
             return {
               runId: c.getAttribute('data-run-id'),
               summary: c.querySelector('[data-testid="doc-run-failed-summary"]')?.textContent,
               href: c.querySelector('[data-testid="doc-run-failed-run"]')?.getAttribute('href'),
               detailsOpen: d ? d.open : null,
               raw: c.querySelector('[data-testid="doc-run-failed-raw"]')?.textContent || '',
               retryKind: c.querySelector('[data-testid="doc-actionable-retry"]')?.getAttribute('data-kind'),
               composer: document.querySelector('[data-testid="thread"]')?.getAttribute('data-composer-state'),
             };
           }""")
    shown = visible_text(page, '[data-testid="doc-run-failed"]')
    check("run_failed_card_human_copy",
          card["summary"] == "The revise step produced no file, so this turn did not land — nothing changed in your document."
          and card["href"] == f"/runs/{card['runId']}/timeline"
          and card["detailsOpen"] is False
          and "/w5/state" in card["raw"]
          and "/w5/state" not in shown and "GET /api/v1/runs" not in shown
          and card["retryKind"] == "resend"
          and card["composer"] == "terminal",
          **{k: v for k, v in card.items() if k != "raw"}, visible=shown[:200])
    page.screenshot(path=str(VSHOTS / "ux5-run-failed-card.png"))
    before = len(injects)
    page.locator('[data-testid="doc-run-failed"] [data-testid="doc-actionable-retry"]').first.click()
    page.wait_for_function(
        """(n) => document.querySelectorAll('[data-testid="doc-message"]').length >= n""", arg=2, timeout=10000)
    time.sleep(0.5)
    resent = [b for b in injects[before:] if ask in b]
    check("retry_resends_the_same_ask", len(resent) == 1, injects_after=len(injects) - before)
    set_fixture(ORIGIN, doc_fail_floor=False)

    # ── Scene 3 (F-4R2-005): heartbeats fold into one row ─────────────────────
    set_fixture(ORIGIN, doc_run_ms=9000, doc_heartbeat_ms=1200)
    page.goto(f"{ORIGIN}/p/{PID}/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-subject"][data-subject-status="ready"]').wait_for(timeout=15000)
    page.locator('[data-testid="doc-composer"]').fill("a deck for the quarterly business review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread"][data-composer-state="generating"]').wait_for(timeout=15000)
    page.wait_for_function(
        """() => {
             const rows = Array.from(document.querySelectorAll('[data-testid="doc-narration"]'));
             const planning = rows.filter((r) => r.textContent.includes('Planning the deck'));
             return planning.length === 1 && Number(planning[0].getAttribute('data-repeats')) >= 3;
           }""", timeout=15000)
    fold = page.evaluate(
        """() => {
             const rows = Array.from(document.querySelectorAll('[data-testid="doc-narration"]'));
             const planning = rows.filter((r) => r.textContent.includes('Planning the deck'));
             return {
               planningRows: planning.length,
               repeats: planning[0]?.getAttribute('data-repeats'),
               elapsed: planning[0]?.querySelector('[data-testid="doc-narration-elapsed"]')?.textContent,
             };
           }""")
    check("heartbeats_fold_into_one_row",
          fold["planningRows"] == 1 and int(fold["repeats"] or 0) >= 3 and "for " in (fold["elapsed"] or ""), **fold)
    page.screenshot(path=str(VSHOTS / "ux5-heartbeat-fold.png"))
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=20000)
    set_fixture(ORIGIN, doc_run_ms=0, doc_heartbeat_ms=0)

    # ── Scene 4 (F-4R2-006): a fresh context restores generating from the run ──
    set_fixture(ORIGIN, doc_run_ms=60000)
    doc4 = api_create_doc("w5-reload", "a brief whose run is still executing")["name"]
    set_fixture(ORIGIN, doc_bound_run={"pid": PID, "doc": doc4})
    fresh = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page4 = fresh.new_page()
    t0 = time.monotonic()
    page4.goto(f"{ORIGIN}/p/{PID}/document/{doc4}", wait_until="domcontentloaded")
    page4.add_style_tag(content=HIDE_GATE_TOASTS)
    page4.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    if page4.locator('[data-testid="panel-expand"]').count() > 0:
        page4.locator('[data-testid="panel-expand"]').click()
    page4.locator('[data-testid="thread"][data-composer-state="generating"]').wait_for(timeout=8000)
    restored = page4.evaluate(
        """() => ({
             state: document.querySelector('[data-testid="thread"]')?.getAttribute('data-composer-state'),
             chip: document.querySelector('[data-testid="steering-chip"]')?.textContent,
             runHref: document.querySelector('[data-testid="doc-bound-run"]')?.getAttribute('href'),
             runStatus: document.querySelector('[data-testid="doc-bound-run"]')?.getAttribute('data-run-status'),
             narration: Array.from(document.querySelectorAll('[data-testid="doc-narration"]')).map((r) => r.textContent),
           })""")
    check("reload_restores_generating_from_the_run_record",
          restored["state"] == "generating"
          and "steering the live document run" in (restored["chip"] or "")
          and restored["runHref"] == "/runs/r-doc-bound/timeline"
          and restored["runStatus"] == "executing"
          and any("Still in progress" in n for n in restored["narration"]),
          seconds=round(time.monotonic() - t0, 1), **restored)
    page4.screenshot(path=str(VSHOTS / "ux5-reload-restore.png"))
    fresh.close()
    set_fixture(ORIGIN, doc_bound_run=None, doc_run_ms=0)

    # ── Scene 5 (F-4R2-003): the name field and the 409 way out ───────────────
    set_fixture(ORIGIN, create_409_existing=True)
    page.goto(f"{ORIGIN}/p/{PID}/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-subject"][data-subject-status="ready"]').wait_for(timeout=15000)
    brief = "Create a high-end, salesy product brochure for Wicked Studio — two pages, A4."
    page.locator('[data-testid="doc-composer"]').fill(brief)
    derived = page.locator('[data-testid="doc-name"]').input_value()
    check("name_derived_from_the_brief", derived == "create-a-high-end-salesy-product-brochure", derived=derived)
    # Point the name at the doc scene 1 created — the collision the finding hit.
    page.locator('[data-testid="doc-name"]').fill(doc1)
    page.locator('[data-testid="doc-composer"]').click()
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-composer-error"][data-status="409"]').wait_for(timeout=15000)
    collision = page.evaluate(
        """() => {
             const e = document.querySelector('[data-testid="doc-composer-error"]');
             return {
               text: e.textContent,
               collides: e.getAttribute('data-collides-with'),
               openHref: e.querySelector('[data-testid="doc-composer-open-existing"]')?.getAttribute('href'),
               brief: document.querySelector('[data-testid="doc-composer"]')?.value,
             };
           }""")
    check("collision_names_the_doc_and_links_it",
          collision["collides"] == doc1
          and f"A document named “{doc1}” already exists" in collision["text"]
          and collision["openHref"] == f"/p/{PID}/document/{doc1}"
          and collision["brief"] == brief,
          **collision)
    page.screenshot(path=str(VSHOTS / "ux5-name-collision.png"))
    page.locator('[data-testid="doc-composer-rename"]').click()
    renamed = page.locator('[data-testid="doc-name"]').input_value()
    check("use_a_different_name_fills_the_next_name", renamed == f"{doc1}-2", renamed=renamed)
    page.locator('[data-testid="doc-composer"]').click()
    page.keyboard.press("Enter")
    page.wait_for_url(f"**/p/{PID}/document/{doc1}-2", timeout=15000)
    check("renamed_create_lands", True, url=page.url)
    set_fixture(ORIGIN, create_409_existing=False)

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
