#!/usr/bin/env python3
"""
ux2_docfb_test.py — the doc-feedback-round gate: OPERATOR FEEDBACK on the
Document surface, each verbatim bullet mapped to an AC and proven in a real
browser against the shared W2 fixture (uxfix_fixture.py). No crew daemon.

The operator's words, verbatim, and the AC each one becomes:

  1. "export should move under chat box in right panel"
       AC1: the ExportMenu renders INSIDE the panel's Chat tab, geometrically
       BELOW the composer (measured rects, not inferred), and the slice-X
       point-of-action contract rides along at the NEW click site unchanged:
       export-pending on the clicked control, export-ready as a REAL anchor
       whose same-origin href serves attachment-framed bytes, the thread
       message remaining. The strip carries NO export control in either spot.
  2. "Compare & Theme should become tabs on chat panel to right"
       AC2: the right panel is a tabbed column — Chat | Compare | Theme |
       Versions, in that order. The Compare tab wears the slice-K controls
       (same testids; toggling renders the two compare-pane iframes on the
       CANVAS — the lens stays the canvas owner's); the Theme tab hosts the
       doc-scoped learn form INLINE (same testids, same EC37 lifecycle:
       inflight → done), with NO themes-open trigger anywhere on the surface.
  3. "The banner at bottom should only be versions, but get rid of the
     'Threads X' and make the right chat column have it's own expand/collapse"
       AC3a: the band is the SLIM variant — version pills only: no Fork /
       In-thread chiclets, no spine caption, no [Themes]/[Export] toolbar, no
       thread-toggle, no compare cluster, and no 'Thread'-labeled control.
       AC3b: the panel owns its OWN expand/collapse — panel-collapse shrinks
       it to the rail (canvas measurably reflows wider), panel-expand and the
       rail's tab buttons bring it back (a rail tab lands STRAIGHT on its tab).
  4. "remove the 'fork' and 'in thread' chiclets and reduce the overall height
     of the band"
       AC4: the band's height is MEASURED ≤ SLIM_BAND_MAX_PX (the old full
       band stacked version+stamp+two-action-row entries inside 10px padding —
       ~80px+; the slim row is a single pill line inside 4px padding). The
       §0-protected gestures SURVIVE in the Versions tab: Fork forks (the
       service's answer navigates to the new version), In-thread flips the
       panel to Chat and focuses the producing message.
  5. "chatbox should expand when typing (to like a max of 5 lines, the scroll
     with more content (can't stay one line)"
       AC5: driven by KEYBOARD TYPING (Shift+Enter for the newlines — plain
       Enter submits): 1 line stays 1 line high; 3 lines grow the textarea to
       3 lines; 7 lines cap it at 5 lines (COMPOSER_MAX_LINES × 24px) with
       overflow-y auto actually scrolling (scrollHeight > clientHeight);
       clearing shrinks it back to one line.
  6. "additional version tab with details on each version, it can use the git
     history"
       AC6: the Versions tab renders one detail row per REAL manifest entry
       (GET /d/:doc/api/versions — versions.json verbatim), newest first,
       showing version, lineage (parent), timestamp and the html_file record
       — cross-checked against the SAME wire fetched independently by this
       rig. The document workspace keeps NO git wire (verified against
       wicked-interactive server.js: loadManifest reads versions.json and
       nothing else), so the tab SAYS the manifest is the history — the
       honesty line is pinned verbatim-ish, and nothing on the tab dresses
       up as a commit.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into
e2e/shots/vision/:
  ux2-docfb-panel.png      the tabbed panel on Chat: export under the chatbox,
                           the slim band beneath the canvas
  ux2-docfb-versions.png   the Versions tab: detail rows + the honesty line

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4410),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
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
    set_fixture,
    start_server,
    wake_strip,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4410"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

DOC_URL = f"{ORIGIN}/p/scratch/document"
BRIEF = "Make me a deck for the Q3 review"
STEER = "Tighten the headline on slide one"

# AC4's measured bound: the slim band is one pill row (text-xs line ≈ 19px +
# 2px pill borders) inside 4px vertical padding + the 2px accent rule — ~33px
# rendered. 44px is the bound with rendering slack; the OLD band could not get
# under ~80px (version + stamp + action row stacked in a 10px-padded entry).
SLIM_BAND_MAX_PX = 44

# The composer's growth constants — DocumentThread.tsx COMPOSER_MAX_LINES /
# COMPOSER_LINE_PX, pinned here so a drive-by change re-answers the operator.
LINE_PX = 24
MAX_LINES = 5

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


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read())


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

    # ── Scene 0: the journey — create v1, steer v2 (the slice-6 W3 shape) ──────
    page.goto(DOC_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # ── AC5 FIRST (a pristine composer): growth 1 → 3 → cap-at-5 → scroll ──────
    composer = page.locator('[data-testid="doc-composer"]')
    composer.click()
    page.keyboard.type("line one")
    one = page.evaluate(
        """() => { const el = document.querySelector('[data-testid="doc-composer"]');
                   return { h: el.clientHeight, overflow: getComputedStyle(el).overflowY }; }""")
    for line in ["line two", "line three"]:
        page.keyboard.press("Shift+Enter")
        page.keyboard.type(line)
    three = page.evaluate(
        """() => { const el = document.querySelector('[data-testid="doc-composer"]');
                   return { h: el.clientHeight, overflow: getComputedStyle(el).overflowY }; }""")
    for line in ["line four", "line five", "line six", "line seven"]:
        page.keyboard.press("Shift+Enter")
        page.keyboard.type(line)
    seven = page.evaluate(
        """() => { const el = document.querySelector('[data-testid="doc-composer"]');
                   return { h: el.clientHeight, scrollH: el.scrollHeight,
                            overflow: getComputedStyle(el).overflowY,
                            maxLines: el.getAttribute('data-max-lines') }; }""")
    composer.fill("")
    cleared = page.evaluate(
        """() => document.querySelector('[data-testid="doc-composer"]').clientHeight""")
    check("AC5_composer_grows_then_scrolls",
          # 1 line: one line high (± the sub-pixel slack), no scrollbar.
          abs(one["h"] - LINE_PX) <= 2 and one["overflow"] == "hidden"
          # 3 lines: grew to exactly 3 lines — expansion, not a jump to max.
          and abs(three["h"] - 3 * LINE_PX) <= 2 and three["overflow"] == "hidden"
          # 7 lines: capped at 5 lines and genuinely scrolling past the cap.
          and abs(seven["h"] - MAX_LINES * LINE_PX) <= 2
          and seven["overflow"] == "auto" and seven["scrollH"] > seven["h"]
          and seven["maxLines"] == str(MAX_LINES)
          # cleared: back to one line — growth is content-driven both ways.
          and abs(cleared - LINE_PX) <= 2,
          one_line=one, three_lines=three, seven_lines=seven, cleared_h=cleared)

    # Create v1, then steer v2 — the versions the tabs act on.
    composer.fill(BRIEF)
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    v1_msg_id = page.evaluate(
        """() => document.querySelector('[data-testid="doc-message"]')
                  ?.getAttribute('data-message-id')""")
    composer.fill(STEER)
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)

    doc_id = urlparse(page.url).path.rsplit("/", 1)[-1]
    manifest = get_json(f"{ORIGIN}/api/v1/projects/scratch/interactive/d/{doc_id}/api/versions")

    # ── AC2 (structure): the tabbed column — Chat | Compare | Theme | Versions ─
    tabs = page.evaluate(
        """() => {
             const panel = document.querySelector('[data-testid="doc-panel"]');
             const tabs = Array.from(document.querySelectorAll('[data-testid="panel-tab"]'));
             return {
               panelUp: !!panel,
               activeTab: panel?.getAttribute('data-tab'),
               order: tabs.map(t => t.getAttribute('data-tab')),
               labels: tabs.map(t => (t.textContent || '').trim()),
               collapseInPanel: !!panel?.querySelector('[data-testid="panel-collapse"]'),
               threadInChatBody: !!document.querySelector(
                 '[data-testid="panel-body"][data-tab="chat"] [data-testid="thread"]'),
             };
           }""")
    check("AC2_tab_structure",
          tabs["panelUp"] and tabs["activeTab"] == "chat"
          and tabs["order"] == ["chat", "compare", "theme", "versions"]
          and tabs["labels"] == ["Chat", "Compare", "Theme", "Versions"]
          and tabs["collapseInPanel"] and tabs["threadInChatBody"], **tabs)

    # ── AC1: export UNDER the chat box, in the right panel — measured ───────────
    under = page.evaluate(
        """() => {
             const chatBody = document.querySelector('[data-testid="panel-body"][data-tab="chat"]');
             const exportBox = chatBody?.querySelector('[data-testid="chat-export"]');
             const menu = exportBox?.querySelector('[data-testid="export-menu"]');
             const composer = chatBody?.querySelector('[data-testid="doc-composer"]');
             const er = exportBox?.getBoundingClientRect(), cr = composer?.getBoundingClientRect();
             const strip = document.querySelector('[data-testid="version-strip"]');
             return {
               exportInChatTab: !!menu,
               belowComposer: !!er && !!cr && er.top >= cr.bottom - 2,
               stripHasNoExport: !!strip && !strip.querySelector('[data-testid="export-menu"]')
                 && !strip.querySelector('[data-testid="export-format"]'),
             };
           }""")
    check("AC1_export_under_chatbox",
          under["exportInChatTab"] and under["belowComposer"] and under["stripHasNoExport"],
          **under)

    page.screenshot(path=str(VSHOTS / "ux2-docfb-panel.png"))

    # AC1 (behavior): the slice-X point-of-action contract at the NEW click site.
    set_fixture(ORIGIN, export_delay_ms=1500)
    page.locator('[data-testid="chat-export"] [data-testid="export-format"][data-format="html"]').click()
    page.locator('[data-testid="export-pending"]').wait_for(timeout=5000)
    pending = page.evaluate(
        """() => {
             const pend = document.querySelector('[data-testid="export-pending"]');
             const host = pend?.closest('[data-testid="export-format"]');
             const inChat = !!pend?.closest('[data-testid="chat-export"]');
             const others = Array.from(
               document.querySelectorAll('[data-testid="export-format"]'))
               .filter(b => b.getAttribute('data-format') !== 'html');
             return { onClickedControl: host?.getAttribute('data-format') === 'html',
                      answersUnderChatbox: inChat,
                      siblingsHeld: others.length > 0 && others.every(b => b.disabled) };
           }""")
    ready = page.locator('[data-testid="export-ready"][data-format="html"]')
    ready.wait_for(timeout=15000)
    facts = page.evaluate(
        """() => {
             const a = document.querySelector('[data-testid="export-ready"]');
             const inThread = Array.from(
               document.querySelectorAll('[data-testid="doc-agent"]'))
               .some(m => /export ready/i.test(m.textContent || '')
                          && !!m.querySelector('[data-testid="doc-artifact-download"]'));
             return { tag: a?.tagName ?? null, href: a?.getAttribute('href') ?? null,
                      file: a?.getAttribute('download') ?? null,
                      sameOrigin: (a?.href ?? '').startsWith(location.origin),
                      inChatExport: !!a?.closest('[data-testid="chat-export"]'),
                      threadMessageRemains: inThread };
           }""")
    dl = page.request.get(f"{ORIGIN}{facts['href']}" if (facts["href"] or "").startswith("/")
                          else (facts["href"] or ""))
    check("AC1_export_answers_at_new_click_site",
          pending["onClickedControl"] and pending["answersUnderChatbox"]
          and pending["siblingsHeld"]
          and facts["tag"] == "A" and facts["sameOrigin"] and facts["inChatExport"]
          and facts["file"] == f"{doc_id}_v2.html"  # per-version: v2 is addressed
          and facts["threadMessageRemains"]
          and dl.status == 200
          and "attachment" in (dl.headers.get("content-disposition") or "")
          and len(dl.body()) > 0,
          **pending, **facts, dl_status=dl.status)
    set_fixture(ORIGIN, export_delay_ms=0)

    # ── AC3a + AC4 (band): versions only, measured height ───────────────────────
    wake_strip(page)
    band = page.evaluate(
        """() => {
             const strip = document.querySelector('[data-testid="version-strip"]');
             const r = strip?.getBoundingClientRect();
             const q = (sel) => strip ? strip.querySelectorAll(sel).length : -1;
             return {
               variant: strip?.getAttribute('data-variant'),
               height: r ? r.height : null,
               pills: q('[data-testid="version-entry"]'),
               forkChiclets: q('[data-testid="version-fork"]'),
               inThreadChiclets: q('[data-testid="version-scroll"]'),
               caption: q('[data-testid="version-spine-caption"]'),
               themes: q('[data-testid="themes-open"]'),
               exports: q('[data-testid="export-menu"]'),
               compare: q('[data-testid="version-compare-toggle"]'),
               threadToggle: q('[data-testid="thread-toggle"]'),
               threadsLabel: /Thread/.test(strip?.textContent || ''),
             };
           }""")
    check("AC3a_AC4_band_is_versions_only_and_short",
          band["variant"] == "slim"
          and band["pills"] == 2
          and band["forkChiclets"] == 0 and band["inThreadChiclets"] == 0
          and band["caption"] == 0 and band["themes"] == 0 and band["exports"] == 0
          and band["compare"] == 0 and band["threadToggle"] == 0
          and not band["threadsLabel"]
          and band["height"] is not None and band["height"] <= SLIM_BAND_MAX_PX,
          **band, max_px=SLIM_BAND_MAX_PX)

    # ── AC3b: the panel's OWN expand/collapse — the canvas measurably reflows ──
    canvas_w_open = page.evaluate(
        """() => document.querySelector('[data-testid="document-canvas"]')
                  .getBoundingClientRect().width""")
    page.locator('[data-testid="panel-collapse"]').click()
    page.locator('[data-testid="doc-panel-rail"]').wait_for(timeout=15000)
    collapsed = page.evaluate(
        """() => ({
             panelGone: !document.querySelector('[data-testid="doc-panel"]'),
             railTabs: Array.from(document.querySelectorAll('[data-testid="panel-rail-tab"]'))
               .map(t => t.getAttribute('data-tab')),
             canvasW: document.querySelector('[data-testid="document-canvas"]')
               .getBoundingClientRect().width,
           })""")
    # Expand STRAIGHT onto a tab from the rail — the versions tab, for AC6.
    page.locator('[data-testid="panel-rail-tab"][data-tab="versions"]').click()
    page.locator('[data-testid="doc-panel"][data-tab="versions"]').wait_for(timeout=15000)
    check("AC3b_panel_owns_expand_collapse",
          collapsed["panelGone"]
          and collapsed["railTabs"] == ["chat", "compare", "theme", "versions"]
          and collapsed["canvasW"] > canvas_w_open + 100,
          **collapsed, canvas_w_open=canvas_w_open)

    # ── AC6: the Versions tab — detail rows off the REAL manifest, honest copy ──
    page.locator('[data-testid="version-detail"]').first.wait_for(timeout=15000)
    detail = page.evaluate(
        """() => {
             const note = document.querySelector('[data-testid="versions-history-note"]');
             const rows = Array.from(document.querySelectorAll('[data-testid="version-detail"]'));
             const body = document.querySelector('[data-testid="panel-body"][data-tab="versions"]');
             return {
               note: note?.textContent || '',
               rows: rows.map(r => ({
                 version: r.getAttribute('data-version'),
                 parent: r.getAttribute('data-parent'),
                 selected: r.getAttribute('data-selected'),
                 stamp: r.querySelector('[data-testid="version-detail-stamp"]')?.textContent || '',
                 lineage: r.querySelector('[data-testid="version-detail-lineage"]')?.textContent || '',
                 files: r.querySelector('[data-testid="version-detail-files"]')?.textContent || '',
               })),
               noCommitDress: !/\\bcommit\\b/i.test(body?.textContent || ''),
             };
           }""")
    wire = sorted(manifest["versions"], key=lambda e: -e["version"])
    rows_match = (
        len(detail["rows"]) == len(wire)
        and all(
            r["version"] == str(e["version"])
            and r["parent"] == ("" if e["parent"] is None else str(e["parent"]))
            and e["html_file"] in r["files"]
            and r["stamp"].strip() != ""
            for r, e in zip(detail["rows"], wire))
    )
    check("AC6_versions_tab_from_real_manifest",
          rows_match
          # The honesty line: the operator asked for git history; the workspace
          # has no git wire, and the tab says the manifest IS the history.
          and "keeps no" in detail["note"] and "git log" in detail["note"]
          and "manifest is the history" in detail["note"]
          and detail["noCommitDress"]
          and detail["rows"][0]["selected"] == "true"  # newest first; v2 shown
          and "root" in detail["rows"][-1]["lineage"],
          wire_versions=[e["version"] for e in wire], **detail)

    page.screenshot(path=str(VSHOTS / "ux2-docfb-versions.png"))

    # ── AC4 (gestures survive): Fork from the tab is the REAL service fork ─────
    page.locator('[data-testid="version-detail"][data-version="1"] [data-testid="version-fork"]').click()
    page.locator('[data-testid="version-entry"][data-version="3"]').wait_for(timeout=30000)
    page.locator('[data-testid="version-detail"][data-version="3"]').wait_for(timeout=30000)
    forked = page.evaluate(
        """() => ({
             url: location.pathname + location.search,
             lineage: document.querySelector(
               '[data-testid="version-detail"][data-version="3"] '
               + '[data-testid="version-detail-lineage"]')?.textContent || '',
             pills: document.querySelectorAll(
               '[data-testid="version-strip"] [data-testid="version-entry"]').length,
           })""")
    check("AC4_fork_survives_in_versions_tab",
          forked["url"].endswith("?v=3")
          and "branched from v1" in forked["lineage"]
          and forked["pills"] == 3,
          **forked)

    # ── AC4 (gestures survive): In-thread flips the panel to Chat and focuses ──
    page.locator('[data-testid="version-detail"][data-version="1"] [data-testid="version-scroll"]').click()
    page.locator('[data-testid="doc-panel"][data-tab="chat"]').wait_for(timeout=15000)
    page.wait_for_function(
        """(id) => document.activeElement?.getAttribute('data-message-id') === id""",
        arg=v1_msg_id, timeout=15000)
    check("AC4_in_thread_flips_to_chat_and_focuses", True, focused=v1_msg_id)

    # ── AC2 (behavior): the Compare tab drives the canvas lens ─────────────────
    page.locator('[data-testid="panel-tab"][data-tab="compare"]').click()
    page.locator('[data-testid="compare-explainer"]').wait_for(timeout=15000)
    page.locator('[data-testid="version-compare-toggle"]').click()
    page.locator('[data-testid="compare-panes"]').wait_for(timeout=15000)
    cmp = page.evaluate(
        """() => {
             const panes = Array.from(document.querySelectorAll('[data-testid="compare-pane"]'));
             const inCanvas = panes.every(p =>
               !!p.closest('[data-testid="document-canvas"]'));
             return {
               versions: panes.map(p => p.getAttribute('data-version')),
               panesOnCanvas: inCanvas,
               controlsInPanel: !!document.querySelector(
                 '[data-testid="panel-body"][data-tab="compare"] [data-testid="compare-controls"]'),
             };
           }""")
    page.locator('[data-testid="compare-exit"]').click()
    page.locator('[data-testid="compare-panes"]').wait_for(state="detached", timeout=15000)
    check("AC2_compare_tab_drives_canvas_lens",
          # v3 is selected; its lineage parent v1 is the default comparand.
          cmp["versions"] == ["3", "1"] and cmp["panesOnCanvas"] and cmp["controlsInPanel"],
          **cmp)

    # ── AC2 (behavior): the Theme tab hosts the inline learn form, EC37 intact ─
    page.locator('[data-testid="panel-tab"][data-tab="theme"]').click()
    page.locator('[data-testid="panel-body"][data-tab="theme"] [data-testid="themes-panel"]') \
        .wait_for(timeout=15000)
    no_trigger = page.evaluate(
        """() => document.querySelectorAll('[data-testid="themes-open"]').length""")
    page.locator('[data-testid="themes-input"]').fill("https://acme.example/brand")
    page.locator('[data-testid="themes-submit"]').click()
    page.locator('[data-testid="learn-inflight"]').wait_for(timeout=10000)
    page.locator('[data-testid="learn-done"]').wait_for(timeout=90000)
    check("AC2_theme_tab_inline_learn_lifecycle", no_trigger == 0,
          themes_open_triggers=no_trigger)

    # Console hygiene: nothing unexpected (the learned-theme 404s before a learn
    # ripens are the readback's real contract, logged by the browser as resource
    # errors).
    unexpected = [e for e in console_errors
                  if "404" not in e and "Failed to load resource" not in e]
    check("console_hygiene", unexpected == [], errors=unexpected)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
report["shots"] = ["ux2-docfb-panel.png", "ux2-docfb-versions.png"]
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
