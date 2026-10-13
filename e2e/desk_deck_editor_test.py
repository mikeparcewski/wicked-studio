#!/usr/bin/env python3
"""
desk_deck_editor_test.py — P-D1, the `wicked-deck` editor plugin and the host's deck review
(DES-PRESENTATION-EDITOR-001 §3-§4; operator decisions D1, D3, D4, D5, D8) at 1440x700 on the Desk.

Against the in-process fixture: a deck created on project `notes` (`style: ppt`, four slides with stable
`data-slide-id`s, speaker notes on slide 1), bound to the run `r-doc-bound`; crew's editor registry stand-in
lists the `wicked-deck` bundle the served dist carries; the bridge stand-in mirrors interactive's deck ops
(`POST /d/<doc>/api/deck`, one version per op) and review store (`/d/<doc>/api/deck/review`, decisions,
audience, proposals); an audience rewrite is answered by a stand-in for crew's governed edit run.

  1. INLINE: the run's deck is a live preview in the `wicked-deck` plugin: slide 1 and "4 slides".
  2. FILMSTRIP: in the pane, the slides in document order, numbered by place; slide 1's notes under it.
  3. MOVING BETWEEN SLIDES: → / End / Home in the editor, "3 Enter" in the filmstrip; a click on a thumbnail makes the
     slide the subject of the next message (a chip the host words).
  4. MOVE + UNDO: Move up on slide 3 lands ONE version ("Moved slide 3 to after slide 1 — version 2."),
     the strip follows the DOCUMENT (the moved slide is numbered by its new place); the engine got one
     deck op with `expect_head`; Undo puts the order back (version 3).
  5. DUPLICATE, ADD, DELETE: ⌘D, Add slide ▾ "like slide 4", Delete — one version each, the host's words.
  6. NOTES: typed under slide 1 and left — one version; the version's HTML holds them in the notes aside.
  7. TEXT: a click on slide 1's title in the slide, Enter, new words, Enter — "Changed slide 1’s text".
  8. REVIEW (full): the host's rail lists the slides; Approve slide 1, ask for changes on slide 2 with a
     note. A move keeps slide 1's approval current; an edit to its words shows "approved on version N —
     changed since" (D5). The rail says approvals don't hold up delivery (D4).
  9. AUDIENCE → PROPOSAL → COMPARE → KEEP: "Rewrite it for them" (Executives) sends ONE structural batch on
     the version with `expect_head`; the proposal waits, then (the run lands) compares slide by slide; Keep
     records the audience. A second change (Customers) is Dropped: the version it adapted is back (a fork
     with `expect_head`).
 10. PRESENT: Present hides the editor's chrome; → moves; Esc leaves present first.
 11. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-deck-editor-*.png. Env: FEEDBACK_PORT (default 4389).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4389"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DECK = "library-deck"
RUN = "r-doc-bound"
SETTLE_MS = 600

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"{}")


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read() or b"{}")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ARTIFACT = """() => { const a = document.querySelector('[data-testid="artifact"]');
  return a ? { size: a.dataset.size, kind: a.dataset.kind,
               plugin: (document.querySelector('[data-testid="plugin-artifact"]') || {dataset: {}}).dataset.editor || null,
               rail: document.querySelectorAll('[data-testid="deck-review"]').length,
               hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth } : null; }"""
CHIPS = """() => [...document.querySelectorAll('[data-testid="composer-chip"]')].map(c => c.dataset.key)"""
STATE = "e => ({ head: e.dataset.head, current: e.dataset.current, n: e.dataset.currentN, count: e.dataset.count, present: e.dataset.present, size: e.dataset.size })"
THUMBS = "bs => bs.map(b => [b.dataset.n, b.dataset.slideId, b.querySelector('.t').innerText])"


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DECK, "brief": "the pitch, four slides", "style": "ppt"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DECK}, editors=True, extra_frames=[], deck_adapt_ms=600)

    plugin = page.frame_locator('[data-testid="editor-frame"][data-editor="wicked-deck"]')
    stage = plugin.frame_locator('[data-testid="deck-frame"]').first  # the newest (a previous one stays until it loads)
    deck = plugin.locator('[data-testid="deck-editor"]')

    def state() -> dict:
        return deck.evaluate(STATE)

    def thumbs() -> list:
        return plugin.locator('[data-testid="deck-thumb"]').evaluate_all(THUMBS)

    def wait_head(v: int, step: str, timeout_s: float = 20) -> dict:
        t0 = time.time()
        st: dict = {}
        while time.time() - t0 < timeout_s:
            try:
                st = state()
                if st.get("head") == str(v):
                    return st
            except Exception:
                pass
            page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / f"desk-deck-editor-{step}-timeout.png"))
        fail(step, {"why": f"the editor never showed version {v}", "state": st,
                    "line": page.locator('[data-testid="page-line"]').all_inner_texts()})
        return st

    def line() -> str:
        return page.get_by_test_id("page-line").inner_text()

    def focus_deck() -> None:
        deck.focus()

    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("artifact").wait_for(state="visible", timeout=15000)
    try:
        plugin.locator('[data-testid="deck-inline-count"]').wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-deck-editor-inline-missing.png"))
        fail("inline", "no wicked-deck preview in the run's block")
    a0 = page.evaluate(ARTIFACT)
    page.screenshot(path=str(SHOTS / "desk-deck-editor-inline.png"))
    # ── 1. inline ──────────────────────────────────────────────────────────────────
    check("inline", a0 == {"size": "inline", "kind": "deck", "plugin": "wicked-deck", "rail": 0, "hscroll": False}
          and plugin.locator('[data-testid="deck-inline-count"]').inner_text() == "4 slides"
          and plugin.locator('[data-testid="deck-frame"]').get_attribute("title") == "Slide 1",
          artifact=a0)

    # ── 2. filmstrip ───────────────────────────────────────────────────────────────
    page.get_by_test_id("artifact-open").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"artifact\"]').dataset.size === 'pane'", timeout=5000)
    deck.wait_for(state="visible")
    t2 = thumbs()
    notes2 = plugin.locator('[data-testid="deck-notes"]').input_value()
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-deck-editor-pane.png"))
    check("filmstrip", t2 == [["1", "s1", "Library room booking"], ["2", "s2", "Residents first"], ["3", "s3", "Staff stay in control"], ["4", "s4", "The pilot"]]
          and state()["current"] == "s1" and notes2 == "Open with the waiting-list numbers.", thumbs=t2, notes=notes2)

    # ── 3. moving between slides ───────────────────────────────────────────────────
    focus_deck()
    seen3 = []
    for k in ["ArrowRight", "End", "Home"]:
        page.keyboard.press(k)
        seen3.append(state()["current"])
    # a number then Enter goes to that slide in the FILMSTRIP (a focused composite); elsewhere it is typing
    plugin.locator('[data-testid="deck-thumb"]').first.focus()
    page.keyboard.press("3")
    page.keyboard.press("Enter")
    seen3.append(state()["current"])
    plugin.locator('[data-testid="deck-thumb"][data-slide-id="s3"]').click()
    page.wait_for_function(f"() => [...document.querySelectorAll('[data-testid=\"composer-chip\"]')].some(c => c.dataset.key === 'el:{DECK}/section-2')", timeout=5000)
    check("navigate", seen3 == ["s2", "s4", "s1", "s3"] and f"el:{DECK}/section-2" in page.evaluate(CHIPS), seen=seen3, chips=page.evaluate(CHIPS))

    # ── 4. move + undo ─────────────────────────────────────────────────────────────
    plugin.locator('[data-testid="deck-move-up"]').click()
    wait_head(2, "move")
    l4 = line()
    t4 = thumbs()
    ops4 = get_json(f"{origin}/__fixture/deck-ops")["ops"]
    page.screenshot(path=str(SHOTS / "desk-deck-editor-moved.png"))
    check("move", l4.startswith("Moved slide 3 to after slide 1 — version 2.")
          and [t[1] for t in t4] == ["s1", "s3", "s2", "s4"] and t4[1][0] == "2" and state()["current"] == "s3"
          and ops4[-1] == {"pid": PID, "doc": DECK, "expect_head": 1, "op": {"type": "slide-move", "slide": "s3", "after": "s1"}},
          line=l4, thumbs=t4, op=ops4[-1] if ops4 else None)
    page.get_by_test_id("page-undo").click()
    wait_head(3, "move-undo")
    check("move-undo", "version 3" in line() and [t[1] for t in thumbs()] == ["s1", "s2", "s3", "s4"], line=line(), thumbs=thumbs())

    # ── 5. duplicate, add, delete ──────────────────────────────────────────────────
    focus_deck()
    page.keyboard.press("Home")
    page.keyboard.press("ControlOrMeta+d")
    wait_head(4, "duplicate")
    l5a, t5a, cur5a = line(), thumbs(), state()
    plugin.locator('[data-testid="deck-add"]').click()
    plugin.locator('[data-testid="deck-add-like"][data-slide-id="s4"]').click()
    wait_head(5, "add")
    l5b, t5b, cur5b = line(), thumbs(), state()
    plugin.locator('[data-testid="deck-delete"]').click()
    wait_head(6, "delete")
    l5c, t5c = line(), thumbs()
    check("duplicate-add-delete", l5a.startswith("Duplicated slide 1 — version 4.") and len(t5a) == 5 and cur5a["n"] == "2"
          and t5a[1][2] == "Library room booking" and t5a[1][1] not in ("s1", "s2", "s3", "s4")
          and l5b.startswith("Added a slide after slide 2 — version 5.") and len(t5b) == 6 and cur5b["n"] == "3" and t5b[2][2] == "Slide 3"
          and l5c.startswith("Removed slide 3 — version 6.") and len(t5c) == 5 and [t[2] for t in t5c] == [t[2] for t in t5a],
          duplicate=l5a, add=l5b, delete=l5c, after=t5c)

    # ── 6. notes ───────────────────────────────────────────────────────────────────
    focus_deck()
    page.keyboard.press("Home")
    notes = plugin.locator('[data-testid="deck-notes"]')
    notes.fill("Open with the waiting list: 140 residents.")
    focus_deck()
    wait_head(7, "notes")
    l6 = line()
    with urllib.request.urlopen(f"{origin}/api/v1/projects/{PID}/interactive/d/{DECK}/doc/7", timeout=10) as r:
        html7 = r.read().decode()
    import re  # noqa: PLC0415
    s1_notes = re.findall(r'data-notes-for="s1"[^>]*>([^<]*)</aside>', html7)
    check("notes", l6.startswith("Changed slide 1’s notes — version 7.") and s1_notes == ["Open with the waiting list: 140 residents."],
          line=l6, slide1_notes=s1_notes)

    # ── 7. text on the slide ───────────────────────────────────────────────────────
    stage.locator('[data-wid="slide-0-heading-1"]').click()
    plugin.locator('[data-testid="deck-selected-box"]').wait_for(state="visible", timeout=8000)
    page.keyboard.press("Enter")
    page.keyboard.type("Library rooms, booked in seconds")
    page.keyboard.press("Enter")
    wait_head(8, "text")
    l7 = line()
    check("text", l7.startswith("Changed slide 1’s text — version 8.") and thumbs()[0][2] == "Library rooms, booked in seconds", line=l7, thumbs=thumbs())

    # ── 8. review at full size ─────────────────────────────────────────────────────
    page.get_by_test_id("artifact-grow").click()
    page.get_by_test_id("deck-review").wait_for(state="visible", timeout=8000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"deck-review-row\"]').length === 5", timeout=8000)
    row = lambda sid: page.locator(f'[data-testid="deck-review-row"][data-slide-id="{sid}"]')  # noqa: E731
    sum0 = page.get_by_test_id("deck-review-summary").inner_text()
    row("s1").get_by_test_id("deck-review-approve").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"deck-review-row\"][data-slide-id=\"s1\"]').dataset.state === 'approved'", timeout=8000)
    row("s2").get_by_test_id("deck-review-ask").click()
    row("s2").get_by_test_id("deck-review-note").fill("Name the branches")
    row("s2").get_by_test_id("deck-review-save-changes").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"deck-review-row\"][data-slide-id=\"s2\"]').dataset.state === 'changes'", timeout=8000)
    b8 = {sid: row(sid).get_by_test_id("deck-review-badge").inner_text() for sid in ("s1", "s2")}
    sum8 = page.get_by_test_id("deck-review-summary").inner_text()
    note8 = page.get_by_test_id("deck-review").inner_text()
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-deck-editor-review.png"))
    # a MOVE keeps slide 1's approval: slide 2 (Residents first, now third) goes down
    plugin.locator(f'[data-testid="deck-thumb"][data-slide-id="s2"]').click()
    plugin.locator('[data-testid="deck-move-down"]').click()
    wait_head(9, "carry-move")
    page.wait_for_function("() => document.querySelector('[data-testid=\"deck-review\"]').dataset.version === '9'", timeout=10000)
    page.wait_for_timeout(400)
    after_move = row("s1").get_by_test_id("deck-review-badge").inner_text()
    # an EDIT to slide 1's words shows its approval as changed since
    focus_deck()
    page.keyboard.press("Home")
    stage.locator('[data-wid="slide-0-paragraph-1"]').click()
    plugin.locator('[data-testid="deck-selected-box"]').wait_for(state="visible", timeout=8000)
    page.keyboard.press("Enter")
    page.keyboard.type("A study room in one tap.")
    page.keyboard.press("Enter")
    wait_head(10, "carry-edit")
    page.wait_for_function("() => document.querySelector('[data-testid=\"deck-review-row\"][data-slide-id=\"s1\"]').dataset.state === 'stale'", timeout=10000)
    after_edit = row("s1").get_by_test_id("deck-review-badge").inner_text()
    check("review", sum0 == "0 of 5 approved" and b8 == {"s1": "Approved on version 8", "s2": "Changes asked: Name the branches"}
          and sum8 == "1 of 5 approved · 1 asks for changes" and "don’t hold up delivery" in note8
          and after_move == "Approved on version 8" and after_edit == "Approved on version 8 — changed since",
          first=sum0, badges=b8, summary=sum8, after_move=after_move, after_edit=after_edit)

    # ── 9. audience → proposal → compare → keep; then a second, dropped ─────────────
    posts_before = len(get_json(f"{origin}/__fixture/feedback-posts")["posts"])
    page.get_by_test_id("deck-audience-change").click()
    page.locator('[data-testid="deck-audience-preset"][value="exec"]').check()
    page.get_by_test_id("deck-audience-adapt").click()
    page.wait_for_selector('[data-testid="deck-proposal"]', timeout=8000)
    waiting = page.get_by_test_id("deck-proposal").get_attribute("data-state")
    posts = get_json(f"{origin}/__fixture/feedback-posts")["posts"]
    batch = posts[-1] if len(posts) > posts_before else None
    page.wait_for_selector('[data-testid="deck-proposal"][data-state="ready"]', timeout=25000)
    proposed = page.get_by_test_id("deck-proposal").inner_text()
    page.get_by_test_id("deck-proposal-compare").click()
    page.get_by_test_id("deck-compare").wait_for(state="visible", timeout=8000)
    cmp_sum = page.get_by_test_id("deck-compare-summary").inner_text()
    ins = page.locator('[data-testid="deck-compare-words"] ins').all_inner_texts()
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-deck-editor-compare.png"))
    page.get_by_test_id("deck-proposal-keep").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"deck-proposal\"]') && document.querySelector('[data-testid=\"deck-audience-label\"]').innerText === 'Executives'", timeout=8000)
    check("audience-keep", waiting == "waiting" and batch is not None and batch["version"] == 10
          and all(i["type"] == "structural-change" and i["instruction"].startswith("Rewrite this slide for executives") for i in batch["items"])
          and len(batch["items"]) == 5 and proposed.startswith("Proposed for Executives: version 11 (from version 10)")
          and cmp_sum.startswith("Version 10 → 11: 5 changed") and any("executives" in t for t in ins),
          batch_items=None if batch is None else [i["selector"] for i in batch["items"]], proposed=proposed, compare=cmp_sum)
    page.get_by_test_id("deck-audience-change").click()
    page.locator('[data-testid="deck-audience-preset"][value="customer"]').check()
    page.get_by_test_id("deck-audience-adapt").click()
    page.wait_for_selector('[data-testid="deck-proposal"][data-state="ready"]', timeout=25000)
    page.get_by_test_id("deck-proposal-drop").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"deck-proposal\"]')", timeout=8000)
    dropped_line = page.get_by_test_id("deck-review-line").inner_text()
    m9 = get_json(f"{origin}/api/v1/projects/{PID}/interactive/d/{DECK}/api/versions")
    last9 = sorted(m9["versions"], key=lambda v: v["version"])[-1]
    wait_head(13, "drop")
    check("audience-drop", dropped_line == "Dropped: version 11 is back." and m9["head"] == 13 and last9["parent"] == 11
          and page.get_by_test_id("deck-audience-label").inner_text() == "Executives",
          line=dropped_line, head=m9["head"], last=last9)

    # ── 10. present ────────────────────────────────────────────────────────────────
    plugin.locator('[data-testid="deck-present"]').click()
    page.wait_for_function("() => true")
    t0 = time.time()
    while time.time() - t0 < 5 and state()["present"] != "true":
        page.wait_for_timeout(100)
    pres = state()
    tools_hidden = plugin.locator('[data-testid="deck-tools"]').is_hidden()
    page.keyboard.press("ArrowRight")
    moved = state()["current"] != pres["current"]
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-deck-editor-present.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    after_esc = state()
    a10 = page.evaluate(ARTIFACT)
    check("present", pres["present"] == "true" and tools_hidden and moved and after_esc["present"] == "false" and a10["size"] == "full",
          present=pres, after_esc=after_esc, artifact=a10)

    check("no-errors", not errors and not a10["hscroll"], errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
