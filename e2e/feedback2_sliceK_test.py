#!/usr/bin/env python3
"""
feedback2_sliceK_test.py — the DES-FEEDBACK-002 slice-K gate: the chat
grid/columns toggle (§6, P1-6) and the document version compare lens (§7, P2-7),
proven in a real browser against the shared W2 fixture (`uxfix_fixture.py`).

Same rig pattern as the slice-G/H/I/J gates: the deterministic fixture server
serves the `dist-sameorigin/` build plus every endpoint the routes read; no crew
daemon anywhere. The chat scene flips the NEW `chat_replies` switch (real
chatReply / chatSessionFailed frame shapes over the one /ws — the daemon's
fan-out, nothing invented); the document scene drives the REAL composer journey
(create → continue → continue), so the multi-version manifest is grown exactly
the way the bridge grows it.

What it asserts (§6.5 + §7.5 DOM ACs, EC18 as amended by §12.1 and
DES-FEEDBACK-003 §8.6 — the canvas REGION, panes included, ends above the bar):

  Chat columns (§6.5):
   1. First-run: no layout toggle (no replying seats yet). After a full round
      the toggle appears; columns mode renders [data-testid="chat-round"] with
      a [data-testid="chat-round-grid"] of data-columns="4" — since DES-UX-001
      slice AB (§7.9-1, the §11.2 re-scope) the first pristine cold-cache send
      is ROSTER-TRUE (EC44 round-3 re-scope): it warms the CHAT-CAPABLE
      seats the chips display (claude + pi), not the
      fallback trio.
   2. The same seat's cells share a column index across rounds; a seat that
      died between rounds (real chatSessionFailed) renders
      [data-testid="chat-cell-empty"] in the next round — never a collapsed
      column.
   3. Toggling fires ZERO /api requests (C1), keeps the composer's focus and
      draft, and Enter still sends from columns mode.

  Version compare (§7.5):
   4. On the 3-version doc, [data-testid="version-compare-toggle"] enters
      compare: two [data-testid="compare-pane"] iframes, src ending /doc/3 and
      /doc/2 (the lineage parent); the pane pair spans >80% viewport width
      (EC18-as-region); the URL keeps ?v=3 throughout.
   5. The vs: dropdown lists every OTHER version; picking v1 re-points ONLY the
      right pane. Overlay stacks the two frames with the opacity slider.
   6. The slice-F strip machinery survives compare: the strip auto-hides after
      idle WITH TWO IFRAMES PRESENT and wakes on bottom proximity; the thread
      drawer still opens/closes.
   7. Exits: Escape returns to the solo canvas at the selected version; a strip
      selection while comparing re-points the LEFT pane only; ✕ exits. Entering
      compare adds no history entry.
   8. On a fresh v1-only document the toggle is DISABLED with the stated reason.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback2-K-chat-columns.png    4-seat rounds side by side, one empty cell
  feedback2-K-compare-split.png   v3 ↔ v2 split with the strip toolbar cluster
  feedback2-K-compare-overlay.png overlay mode, slider at 50

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4347), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    ensure_build,
    set_fixture,
    start_server,
    wake_strip,
)

W2_PORT = int(os.environ.get("W2_PORT", "4347"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"
CHAT_URL = f"{ORIGIN}/p/q3-review-deck/chat"
DOC_URL = f"{ORIGIN}/p/scratch/document"
VSHOTS = Path(__file__).resolve().parent / "shots" / "vision"
VSHOTS.mkdir(parents=True, exist_ok=True)

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def step(name: str, ok: bool, **detail) -> None:
    report["steps"][name] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


try:
    from playwright.sync_api import sync_playwright
except ImportError:
    fail("prereq", "python playwright missing — pip install playwright && playwright install chromium")

dist = ensure_build(fail)
start_server(W2_PORT, dist)
set_fixture(ORIGIN, chat_replies=True)

console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    api_requests: list[str] = []
    page.on(
        "request",
        lambda r: api_requests.append(f"{r.method} {urlparse(r.url).path}")
        if "/api/v1/" in r.url else None,
    )

    # ══ Scene 1 — chat columns (§6.5) ═══════════════════════════════════════════
    page.goto(CHAT_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    # EC44: wait for the chips to RESOLVE (Send is disabled while the roster
    # is unknown — typing earlier would no-op).
    page.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # AC: no toggle before anything replied (a single/zero-seat chat has nothing
    # to compare — the toggle would be dead chrome).
    step("K1_toggle_absent_firstrun",
         page.locator('[data-testid="chat-layout-toggle"]').count() == 0)

    # Round 1: the first send is roster-TRUE (EC44) — it warms exactly the
    # chat-capable chips (claude + pi); the fixture fans out one REAL
    # chatReply per seat, then kills the last-warmed seat
    # (chatSessionFailed → 'pi').
    composer = page.locator("textarea.wk-composer")
    composer.fill("How should we refactor the fetch layer?")
    page.keyboard.press("Enter")
    page.wait_for_function(
        """() => [...document.querySelectorAll('[data-testid="doc-canvas"], p, div')]
                 .filter(el => el.childElementCount === 0 && (el.textContent || '').includes('(round 1)'))
                 .length >= 2""",
        timeout=30000)
    # The dying seat's chip goes failed BEFORE round 2 (its title carries the reason).
    page.locator('[title="session exited unexpectedly (fixture)"]').wait_for(timeout=30000)
    step("K1_round1_replies", True)

    # The toggle appeared (2 distinct replying seats). Type a draft, then switch
    # layouts — the composer must keep focus AND the draft (§6.5), and the
    # toggle must fire ZERO requests (C1).
    page.locator('[data-testid="chat-layout-toggle"]').wait_for(timeout=30000)
    composer.click()
    composer.fill("a draft in progress")
    before_toggle = list(api_requests)
    page.locator('[data-testid="chat-layout-columns"]').click()
    page.locator('[data-testid="chat-round-grid"]').wait_for(timeout=30000)
    page.locator('[data-testid="chat-layout-list"]').click()
    page.locator('[data-testid="chat-round-grid"]').wait_for(state="detached", timeout=30000)
    page.locator('[data-testid="chat-layout-columns"]').click()
    page.locator('[data-testid="chat-round-grid"]').wait_for(timeout=30000)
    grid1 = page.evaluate(
        """() => {
             const grid = document.querySelector('[data-testid="chat-round-grid"]');
             const composer = document.querySelector('textarea.wk-composer');
             return {
               columns: grid?.getAttribute('data-columns'),
               agents: [...(grid?.children ?? [])].map(c => c.getAttribute('data-agent')),
               draft: composer?.value,
               focused: document.activeElement === composer,
               rounds: document.querySelectorAll('[data-testid="chat-round"]').length,
             };
           }""")
    step("K1_columns_grid",
         grid1["columns"] == "2" and grid1["rounds"] == 1 and len(grid1["agents"]) == 2,
         **grid1)
    step("K1_toggle_zero_requests_keeps_draft",
         api_requests == before_toggle
         and grid1["draft"] == "a draft in progress" and grid1["focused"],
         new_requests=[r for r in api_requests if r not in before_toggle])

    # Round 2, sent FROM columns mode (Enter still sends — the toggle never
    # intercepts composer keys): the surviving seat replies; the dead seat's
    # column renders the dimmed EMPTY cell, and column indexes hold.
    composer.fill("Which part ships first?")
    page.keyboard.press("Enter")
    page.wait_for_function(
        """() => [...document.querySelectorAll('div,p')]
                 .filter(el => el.childElementCount === 0 && (el.textContent || '').includes('(round 2)'))
                 .length >= 1""",
        timeout=30000)
    rounds = page.evaluate(
        """() => {
             const grids = [...document.querySelectorAll('[data-testid="chat-round-grid"]')];
             const empty = [...document.querySelectorAll('[data-testid="chat-cell-empty"]')];
             return {
               count: grids.length,
               columns: grids.map(g => g.getAttribute('data-columns')),
               agents: grids.map(g => [...g.children].map(c => c.getAttribute('data-agent'))),
               emptyAgents: empty.map(e => e.getAttribute('data-agent')),
               emptyInSecond: empty.length === 1 && grids[1]?.contains(empty[0]),
               noHorizPageScroll: document.documentElement.scrollWidth
                 <= document.documentElement.clientWidth,
             };
           }""")
    step("K2_empty_cell_stable_columns",
         rounds["count"] == 2 and rounds["columns"] == ["2", "2"]
         and rounds["agents"][0] == rounds["agents"][1]
         and rounds["emptyAgents"] == ["pi"] and rounds["emptyInSecond"]
         and rounds["noHorizPageScroll"],
         **rounds)
    page.screenshot(path=str(VSHOTS / "feedback2-K-chat-columns.png"))

    # ══ Scene 2 — version compare (§7.5) ════════════════════════════════════════
    # Grow a REAL 3-version lineage through the composer (the W3 journey + one
    # more continue): v1 from the brief, v2 and v3 as forks-with-steer.
    page.goto(DOC_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="doc-picker-empty"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-composer"]').fill("Make me a deck for the Q3 review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-composer"]').fill("Tighten this headline")
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-composer"]').fill("Now rebalance the slide")
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-canvas"][data-version="3"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=30000)
    if "?v=3" not in page.url:
        fail("K3_journey", f"expected the route at ?v=3 after the third landing, got {page.url}")

    # Close the drawer: EC18 measures the canvas-first posture (drawer closed by
    # default; this journey opened it on the picker and it survived — by design).
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    page.locator('[data-testid="thread-drawer"]').wait_for(state="detached", timeout=30000)

    # Enter compare from the strip toolbar (§7.2).
    wake_strip(page)
    history_before = page.evaluate("() => history.length")
    page.locator('[data-testid="version-compare-toggle"]').click()
    page.locator('[data-testid="compare-pane"]').first.wait_for(timeout=30000)
    split = page.evaluate(
        """() => {
             const panes = [...document.querySelectorAll('[data-testid="compare-pane"]')];
             const rects = panes.map(p => p.getBoundingClientRect());
             const left = Math.min(...rects.map(r => r.left));
             const right = Math.max(...rects.map(r => r.right));
             return {
               count: panes.length,
               srcs: panes.map(p => new URL(p.src).pathname),
               pairWidthFrac: (right - left) / window.innerWidth,
               soloGone: !document.querySelector('[data-testid="doc-canvas"]'),
               cluster: document.querySelector('[data-testid="compare-controls"]')?.textContent || '',
               parentLabel: [...document.querySelectorAll('span')]
                 .some(s => (s.textContent || '').trim() === 'v2 (parent)'),
               url: location.search,
             };
           }""")
    step("K3_compare_split",
         split["count"] == 2
         and split["srcs"][0].endswith("/doc/3") and split["srcs"][1].endswith("/doc/2")
         and split["pairWidthFrac"] > 0.8 and split["soloGone"]
         and "Comparing v3 ↔ v2" in split["cluster"] and split["parentLabel"]
         and "v=3" in split["url"],
         **split)
    # No history entry was added by entering compare (a lens, not an address).
    step("K3_no_history_entry",
         page.evaluate("() => history.length") == history_before,
         before=history_before, after=page.evaluate("() => history.length"))
    wake_strip(page)
    page.screenshot(path=str(VSHOTS / "feedback2-K-compare-split.png"))

    # AC: vs: lists every OTHER version; picking v1 re-points ONLY the right pane.
    wake_strip(page)
    vs_options = page.evaluate(
        """() => [...document.querySelector('[data-testid="compare-vs"]').options].map(o => o.value)""")
    page.locator('[data-testid="compare-vs"]').select_option("1")
    page.wait_for_function(
        """() => {
             const panes = [...document.querySelectorAll('[data-testid="compare-pane"]')];
             return panes.length === 2
               && new URL(panes[0].src).pathname.endsWith('/doc/3')
               && new URL(panes[1].src).pathname.endsWith('/doc/1');
           }""",
        timeout=30000)
    step("K4_vs_repoints_right_pane", vs_options == ["1", "2"], options=vs_options)
    page.locator('[data-testid="compare-vs"]').select_option("2")

    # AC: overlay — the same two URLs stacked, slider drives the TOP opacity.
    wake_strip(page)
    page.locator('[data-testid="compare-overlay-toggle"]').click()
    page.locator('[data-testid="overlay-slider"]').wait_for(timeout=30000)
    overlay = page.evaluate(
        """() => {
             const top = document.querySelector('[data-testid="compare-pane"][data-layer="top"]');
             const under = document.querySelector('[data-testid="compare-pane"][data-layer="under"]');
             return {
               stacked: !!top && !!under
                 && Math.abs(top.getBoundingClientRect().left - under.getBoundingClientRect().left) < 2,
               topVersion: top?.getAttribute('data-version'),
               topOpacity: top ? getComputedStyle(top).opacity : null,
               underPointer: under ? getComputedStyle(under).pointerEvents : null,
               slider: document.querySelector('[data-testid="overlay-slider"]')?.value,
             };
           }""")
    step("K5_overlay",
         overlay["stacked"] and overlay["topVersion"] == "2"
         and overlay["topOpacity"] == "0.5" and overlay["underPointer"] == "none"
         and overlay["slider"] == "50",
         **overlay)
    page.screenshot(path=str(VSHOTS / "feedback2-K-compare-overlay.png"))
    # Moving the slider changes the top iframe's computed opacity.
    page.locator('[data-testid="overlay-slider"]').fill("20")
    page.wait_for_function(
        """() => getComputedStyle(document.querySelector(
                 '[data-testid="compare-pane"][data-layer="top"]')).opacity === '0.2'""",
        timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="compare-overlay-toggle"]').click()
    page.locator('[data-testid="compare-panes"]').wait_for(timeout=30000)

    # AC 6: the slice-F strip machinery survives compare — the strip auto-hides
    # after 3s idle WITH TWO IFRAMES PRESENT, and bottom proximity wakes it.
    page.mouse.move(720, 300)
    page.wait_for_function(
        """() => document.querySelector('[data-testid="version-strip"]')
                 ?.getAttribute('data-hidden') === 'true'""",
        timeout=15000)
    two_iframes = page.evaluate(
        "() => document.querySelectorAll('[data-testid=\"compare-pane\"]').length")
    wake_strip(page)  # asserts data-hidden flips back to 'false'
    step("K6_strip_hides_and_wakes_in_compare", two_iframes == 2, iframes=two_iframes)

    # …and the thread drawer still opens/closes over the pane pair.
    page.locator('[data-testid="thread-toggle"]').click()
    page.locator('[data-testid="thread-drawer"]').wait_for(timeout=30000)
    drawer_panes = page.evaluate(
        "() => document.querySelectorAll('[data-testid=\"compare-pane\"]').length")
    wake_strip(page)
    page.locator('[data-testid="thread-toggle"]').click()
    page.locator('[data-testid="thread-drawer"]').wait_for(state="detached", timeout=30000)
    step("K6_drawer_works_in_compare", drawer_panes == 2, panes_while_open=drawer_panes)

    # AC 7 exits. Escape → solo canvas at the selected version.
    page.keyboard.press("Escape")
    page.locator('[data-testid="doc-canvas"][data-version="3"]').wait_for(timeout=30000)
    step("K7_escape_exits",
         page.locator('[data-testid="compare-pane"]').count() == 0 and "?v=3" in page.url)
    # A strip selection while comparing re-points the LEFT pane; the comparand stays.
    wake_strip(page)
    page.locator('[data-testid="version-compare-toggle"]').click()
    page.locator('[data-testid="compare-pane"]').first.wait_for(timeout=30000)
    wake_strip(page)
    page.locator('[data-testid="version-entry"][data-version="1"] [data-testid="version-select"]').click()
    page.wait_for_function(
        """() => {
             const panes = [...document.querySelectorAll('[data-testid="compare-pane"]')];
             return panes.length === 2
               && new URL(panes[0].src).pathname.endsWith('/doc/1')
               && new URL(panes[1].src).pathname.endsWith('/doc/2');
           }""",
        timeout=30000)
    step("K7_selection_repoints_left_pane", "?v=1" in page.url, url=page.url)
    # ✕ exits too.
    wake_strip(page)
    page.locator('[data-testid="compare-exit"]').click()
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=30000)
    step("K7_x_exits", page.locator('[data-testid="compare-pane"]').count() == 0)

    # The invented-wire guard (C1/§7.1): compare shipped on the two EXISTING
    # version URLs — nothing under /interactive/ beyond the real bridge routes,
    # and no /compare or /diff route was ever asked of anyone.
    invented = [r for r in api_requests if "/compare" in r or "/diff" in r]
    step("K8_zero_invented_wires", invented == [], invented=invented)

    # AC 8: a fresh v1-only document disables the toggle WITH the stated reason.
    page.goto(DOC_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="doc-picker"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-composer"]').fill("Write a one-pager on the rollout")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=30000)
    wake_strip(page)
    v1only = page.evaluate(
        """() => {
             const t = document.querySelector('[data-testid="version-compare-toggle"]');
             return { present: !!t, disabled: t?.disabled ?? false, title: t?.title || '' };
           }""")
    step("K9_v1_only_disabled_with_reason",
         v1only["present"] and v1only["disabled"]
         and v1only["title"] == "only one version exists",
         **v1only)

    # Zero console errors across both scenes (the standing rig hygiene bar).
    step("K10_console_clean", console_errors == [], errors=console_errors[:5])

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
report["screenshots"] = [
    str(VSHOTS / "feedback2-K-chat-columns.png"),
    str(VSHOTS / "feedback2-K-compare-split.png"),
    str(VSHOTS / "feedback2-K-compare-overlay.png"),
]
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
