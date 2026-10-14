#!/usr/bin/env python3
"""
desk_doc_editors_test.py — S9, the document and slide editors (DES-STUDIO-REBUILD-001 §11 S9;
DES-EDITOR-PLUGINS-001 §7.2) at 1440x700 on the Desk.

Against the in-process fixture: two documents created on project `notes` with a recorded style — a
written document (`style: doc`) and a deck (`style: ppt`), anchored the way the real engine anchors
(`slide-{i}-{role}-{n}`, `section-{i}`) — each bound in turn to the run `r-doc-bound`, and proves:

  THE DOCUMENT EDITOR
  1. KIND: the run's document opens in a protocol-2 `wicked-doc` plugin card bound to
     `r-doc-bound:notes/library-response`; its nested document frame shows the heading.
  2. COVERAGE = THE READ: the card's Options → Coverage plugin frame shows exactly the repository
     read's ids, titles and total, and says "2 of 3 named in this document". Full-screen Advanced
     also shows the coverage side list; Simple hides it. Risk flags are not part of the plugin read.
  3. A REQUIREMENT IS A SUBJECT: a click on REQ-002 in full-screen Advanced picks its paragraph
     and puts that element's chip on the session composer (no separate requirement chip).
  4. A PARAGRAPH EDIT IS ONE VERSION: Enter on that paragraph — longer than 400 characters — opens
     the field holding its WHOLE text; new text + Enter lands version 2 ("Changed paragraph 2 —
     version 2." on the host card — plain words, never the raw anchor id) with Undo. What was SENT
     is one batch of one content-edit whose `before` is the paragraph's whole text (the stale guard).
  5. UNDO: version 3 is the page before; the long paragraph is back. The bridge's own manifest
     holds exactly versions 1, 2 (the edit, off 1) and 3 (the fork of 1) — one version per act.
  6. A CONTAINER IS NOT TEXT: a section picked by its own edge says it holds other parts, and
     typing on it opens no field.
  7. COVERAGE ABSENT ELSEWHERE: a run with no repository, and a run on a repository with no
     requirements read (404), show no requirement rows in Options → Coverage and no horizontal
     scroll. A read with more than one page still says "(the first 50 of 60)", total 60, 50 rows.

  THE SLIDE EDITOR (P-D1)
  8. A DECK OPENS IN ITS OWN EDITOR: a protocol-2 plugin card hosts `wicked-deck`
     (DES-PRESENTATION-EDITOR-001, operator decision D1), its filmstrip naming the deck's four slides
     in order. desk_deck_editor_test.py walks the editor itself (slide ops, notes, review, audience).
     DEMO VIDEO SUGGESTION: the empty session composer offers "Make a demo video of this";
     it opens the New job wizard on the demo video form, and Escape closes it.
 12. EXPORT: Export ▾ offers PowerPoint and PDF, by keyboard too (Tab walks the formats;
     Esc on a format closes the menu, not the card, and returns the focus to Export); PowerPoint
     answers "PPTX export ready — …" with a Download link.
 13. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-doc-editors-*.png. Env: FEEDBACK_PORT (default 4359).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, LONG_PARAGRAPH, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4359"))
W, H = 1440, 700
SETTLE_MS = 450  # the card/full transition has finished: the capture shows the settled size
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "library-response"
DECK = "library-pitch"
RUN = "r-doc-bound"
REPO_ID = "studio-api"
REQS = [
    {"key": "booking::REQ-001", "reqId": "REQ-001", "title": "Residents and staff each get their own view"},
    {"key": "booking::REQ-002", "reqId": "REQ-002", "title": "An unclaimed room goes back to the list", "risk": True},
    {"key": "booking::REQ-003", "reqId": "REQ-003", "title": "Staff can export a day’s bookings"},
]
# Crew's builtin posture (EDITOR-BUILTIN, EDITOR-BUILTIN-THEME) allows a first-party editor what it declares: the
# fixture's default grants are a pack's, so wicked-doc's checks.read (Coverage) and the deck's artifact.export are
# granted here as the daemon grants them.
FIRST_PARTY_GRANTS = ["artifact.read", "artifact.write", "selection.chip", "composer.draft", "checks.read", "checks.contribute",
                      "ui.fullscreen", "artifact.export", "artifact.theme"]
P2 = "slide-0-paragraph-2"
NEW_P2 = "Residents book a study room in two taps (REQ-002)."

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



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

DOC_CARD = '[data-testid="plugin-card"][data-editor="wicked-doc"][data-protocol="2"]'
CHIPS = """() => [...document.querySelectorAll('[data-testid="composer-chip"]')].map(c => ({ key: c.dataset.key, text: c.innerText.replace(/\\n×$/, '') }))"""
EDIT_FIELD = """() => { const i = document.querySelector('[data-testid="page-edit-input"]');
  // The plugin keeps its textarea mounted; only a visible field means an edit is open.
  return i && !i.hidden ? { value: i.value, focused: document.activeElement === i } : null; }"""


def doc_card_frame(page):
    """The wicked-doc card/full instance, separate from its Options instance and nested page."""
    return page.frame_locator(f'{DOC_CARD} [data-testid="editor-frame"]')


def coverage_options_frame(page):
    """The plugin Options iframe shown by the host panel's Coverage tab."""
    return page.frame_locator('[data-testid="host-panel"] [data-testid="host-panel-frame"] [data-testid="editor-frame"]')


def open_coverage(page):
    page.locator(DOC_CARD).get_by_test_id("plugin-card-options").click()
    page.get_by_test_id("host-panel").wait_for(state="visible", timeout=15000)
    page.locator('[data-testid="host-panel-tab"][data-group="plugin"][data-tab="coverage"]').click()
    frame = coverage_options_frame(page)
    frame.get_by_test_id("doc-coverage").wait_for(state="visible", timeout=15000)
    return frame


def coverage_state(frame) -> dict:
    return frame.get_by_test_id("doc-coverage").evaluate("""c => ({
      total: Number(c.dataset.total), rows: Number(c.dataset.rows), named: Number(c.dataset.named),
      line: c.querySelector('[data-testid="doc-coverage-line"]')?.innerText || '',
      items: [...c.querySelectorAll('[data-testid="doc-coverage-row"]')].map(r => ({
        req: r.dataset.req, named: r.dataset.named, text: r.innerText }))
    })""")


def frame_wid(page, wid: str) -> dict:
    """What the CARD instance's document frame shows for one anchor: its text and where it sits in the frame's
    viewport. Scoped to the wicked-doc card (an Options instance renders the same document in its own hidden frame;
    agy review). The frame reloads on every new version; the locator follows it."""
    loc = page.frame_locator(f'{DOC_CARD} [data-testid="editor-frame"]').frame_locator('[data-testid="page-frame"]').locator(f'[data-wid="{wid}"]')
    try:
        if loc.count() == 0:
            return {"text": None}
        return loc.first.evaluate("""(h) => { const r = h.getBoundingClientRect();
          return { text: h.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; }""")
    except Exception:
        return {"text": None}


def wait_text(page, wid: str, text: str, timeout_ms: int = 10000) -> dict:
    t0 = time.time()
    last: dict = {}
    while time.time() - t0 < timeout_ms / 1000:
        last = frame_wid(page, wid)
        if last.get("text") == text:
            return last
        page.wait_for_timeout(250)
    return last


def wait_pickable(page, head: int) -> None:
    try:
        doc_card_frame(page).locator(f'[data-testid="page-editor"][data-pickable="true"][data-head="{head}"]').wait_for(
            state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-doc-editors-pickable-{head}-timeout.png"))
        fail("pickable", f"the wicked-doc card frame never became pickable at head {head}")


def wait_line(page, kind: str, step: str, timeout_ms: int = 15000) -> str:
    card = page.locator(DOC_CARD)
    try:
        card.locator(f'[data-testid="page-line"][data-kind="{kind}"]').wait_for(state="visible", timeout=timeout_ms)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-doc-editors-{step}-timeout.png"))
        found = card.get_by_test_id("page-line").all_inner_texts()
        fail(step, {"why": f"no page-line[data-kind={kind}] within {timeout_ms} ms", "found": found})
    return card.get_by_test_id("page-line").inner_text()


def manifest(page, doc: str) -> list:
    """The bridge's own version manifest for `doc`: [version, parent, deterministic?] per version."""
    m = page.evaluate(f"""async () => {{ const r = await fetch('/api/v1/projects/{PID}/interactive/d/{doc}/api/versions'); return r.json(); }}""")
    return [m["head"]] + [[v["version"], v["parent"], v["feedback_file"] is not None] for v in sorted(m["versions"], key=lambda v: v["version"])]


def open_session(page, step: str, editor: str = "wicked-doc") -> None:
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.locator(f'[data-testid="plugin-card"][data-editor="{editor}"][data-protocol="2"]').wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-doc-editors-{step}-missing.png"))
        fail(step, f"no protocol-2 {editor} card in the session's run block")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(15000)
    page.set_default_navigation_timeout(15000)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    docs_url = f"{origin}/api/v1/projects/{PID}/interactive/api/docs"
    post_json(docs_url, {"name": DOC, "brief": "our response to the library's request", "style": "doc"})
    post_json(docs_url, {"name": DECK, "brief": "the pitch, four slides", "style": "ppt"})

    # ════ THE DOCUMENT EDITOR ════════════════════════════════════════════════════════
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC, "repo": REPO_ID},
                requirements={REPO_ID: REQS}, editors=True, editor_grants=FIRST_PARTY_GRANTS, extra_frames=[])
    open_session(page, "document")
    card = page.locator(DOC_CARD)
    plugin = doc_card_frame(page)
    heading = wait_text(page, "slide-0-heading-1", "Library room booking — our response")
    wait_pickable(page, 1)
    a0 = {"editor": card.get_attribute("data-editor"), "protocol": card.get_attribute("data-protocol"),
          "surface": card.get_attribute("data-surface"), "key": card.get_attribute("data-artifact")}
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-document-card.png"))
    # ── 1. kind ────────────────────────────────────────────────────────────────────
    # The recorded document chooses wicked-doc; the card replaces the old inline/pane sizes, and on the card (no room
    # for it) the coverage list is not shown — it is the Options tab and full screen Advanced's side list.
    card_cov_hidden = not plugin.get_by_test_id("doc-coverage").is_visible()
    check("document-kind", a0 == {"editor": "wicked-doc", "protocol": "2", "surface": "card", "key": f"{RUN}:{PID}/{DOC}"}
          and plugin.get_by_test_id("page-editor").get_attribute("data-kind") == "document" and card_cov_hidden
          and heading.get("text") == "Library room booking — our response", card=a0, heading=heading.get("text"), card_coverage_hidden=card_cov_hidden)

    # ── 2. coverage = the read ─────────────────────────────────────────────────────
    # Coverage is a plugin Options tab, plus a side list in full-screen Advanced; Simple hides it.
    options = open_coverage(page)
    options.locator('[data-testid="doc-coverage"][data-total="3"][data-named="2"]').wait_for(state="visible", timeout=15000)
    read = page.evaluate(f"""async () => {{ const r = await fetch('/api/v1/repos/{REPO_ID}/requirements?offset=0&limit=50'); return r.json(); }}""")
    cov = coverage_state(options)
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-coverage-options.png"))
    # checks.read exposes reqIds and titles only: no repository/key datasets or "at risk" row text.
    by_req = {r["req"]: r for r in cov["items"]}
    same_rows = (len(cov["items"]) == len(read["items"]) == 3
                 and sorted(by_req) == sorted(i["reqId"] for i in read["items"])
                 and all(i["title"] in by_req[i["reqId"]]["text"] for i in read["items"]))
    page.get_by_test_id("host-panel-close").click()  # close the separate Options instance before editing
    card.get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=15000)
    plugin.locator('[data-testid="page-editor"][data-size="full"][data-mode="simple"]').wait_for(state="visible", timeout=15000)
    plugin.get_by_test_id("doc-coverage").wait_for(state="hidden", timeout=15000)
    simple_hidden = not plugin.get_by_test_id("doc-coverage").is_visible()
    page.locator('[data-testid="full-shell-mode"][data-mode="advanced"]').click()
    plugin.locator('[data-testid="page-editor"][data-mode="advanced"]').wait_for(state="visible", timeout=15000)
    plugin.locator('[data-testid="doc-coverage"][data-total="3"][data-named="2"]').wait_for(state="visible", timeout=15000)
    advanced = coverage_state(plugin)
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-coverage-advanced.png"))
    # Simple must hide a list that has already been shown, too.
    page.locator('[data-testid="full-shell-mode"][data-mode="simple"]').click()
    plugin.locator('[data-testid="page-editor"][data-mode="simple"]').wait_for(state="visible", timeout=15000)
    plugin.get_by_test_id("doc-coverage").wait_for(state="hidden", timeout=15000)
    simple_hidden = simple_hidden and not plugin.get_by_test_id("doc-coverage").is_visible()
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-coverage-simple.png"))
    page.locator('[data-testid="full-shell-mode"][data-mode="advanced"]').click()
    plugin.locator('[data-testid="page-editor"][data-mode="advanced"]').wait_for(state="visible", timeout=15000)
    plugin.get_by_test_id("doc-coverage").wait_for(state="visible", timeout=15000)
    check("coverage-is-the-read", cov["total"] == read["total"] == 3 and cov["rows"] == 3 and same_rows
          and cov["named"] == 2 and cov["line"].startswith("2 of 3 named in this document")
          and by_req.get("REQ-003", {}).get("named") == "false" and simple_hidden and advanced == cov,
          coverage=cov, simple_hidden=simple_hidden, advanced=advanced,
          read={"total": read["total"], "reqIds": [i["reqId"] for i in read["items"]]})

    # ── 3. a requirement is a subject ──────────────────────────────────────────────
    wait_pickable(page, 1)
    plugin.locator('[data-testid="doc-coverage-row"][data-req="REQ-002"]').click()
    plugin.locator(f'[data-testid="page-selected-box"][data-wid="{P2}"]').wait_for(state="visible", timeout=15000)
    sel = plugin.get_by_test_id("page-selected-box").get_attribute("data-wid")
    page.locator(f'[data-testid="composer-chip"][data-key="el:{DOC}/{P2}"]').first.wait_for(state="attached", timeout=15000)
    chips = page.evaluate(CHIPS)
    hint3 = plugin.get_by_test_id("page-hint").inner_text()
    el_chip = next((c for c in chips if c["key"] == f"el:{DOC}/{P2}"), None)
    # A coverage row selects its named element (an "about:" element chip on the run's composer, the one the full
    # screen's chat drawer shows); it no longer adds a separate "about: requirement REQ-002" chip. The hint speaks of
    # the paragraph, as the old pane's did.
    check("requirement-subject", sel == P2 and el_chip is not None and el_chip["text"].startswith("about:")
          and "paragraph 2" in hint3, selected=sel, chips=chips, hint=hint3)

    # ── 4. a paragraph edit is one version ─────────────────────────────────────────
    # Coverage keeps focus on its button. Focus the page without clicking the already selected paragraph
    # (a second paragraph click would select its section).
    plugin.get_by_test_id("page-editor").focus()
    page.keyboard.press("Enter")
    plugin.get_by_test_id("page-edit-input").wait_for(state="visible", timeout=15000)
    opened = plugin.get_by_test_id("page-editor").evaluate(EDIT_FIELD)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-paragraph-field.png"))
    whole = opened is not None and opened["value"] == LONG_PARAGRAPH and opened["focused"]
    if not whole:
        # Say what the field held before the edit is judged: a cut text is the cause, not a symptom.
        check("paragraph-edit", False, why="Enter did not open the field on the paragraph's whole text",
              field_length=None if opened is None else len(opened["value"]), paragraph_length=len(LONG_PARAGRAPH))
    page.keyboard.type(NEW_P2)
    page.keyboard.press("Enter")
    wait_pickable(page, 2)
    # The host draws page-line outside FullShell; leave full screen to read it and use Undo on the card.
    page.get_by_test_id("full-shell-exit").click()
    page.get_by_test_id("full-shell").wait_for(state="detached", timeout=15000)
    line1 = wait_line(page, "edited", "paragraph-edit")
    after1 = wait_text(page, P2, NEW_P2)
    # The retired artifact-version badge is replaced by the plugin's reported head.
    v1 = plugin.get_by_test_id("page-editor").get_attribute("data-head")
    page.screenshot(path=str(SHOTS / "desk-doc-editors-paragraph-edited.png"))
    sent = [p for p in json.loads(urllib.request.urlopen(f"{origin}/__fixture/feedback-posts", timeout=10).read())["posts"] if p["doc"] == DOC]
    one_edit = (len(sent) == 1 and sent[0]["version"] == 1 and len(sent[0]["items"]) == 1
                and sent[0]["items"][0] == {"selector": P2, "type": "content-edit", "value": NEW_P2, "before": LONG_PARAGRAPH})
    check("paragraph-edit", line1.startswith("Changed paragraph 2 — version 2.") and "slide-0" not in line1
          and after1.get("text") == NEW_P2 and v1 == "2" and one_edit, line=line1, paragraph=after1.get("text"), version=v1,
          field_length=len(opened["value"]), batches_sent=len(sent),
          sent=[{**i, "before": f"<{len(i.get('before') or '')} characters>"} for p in sent for i in p["items"]])

    # ── 5. undo ────────────────────────────────────────────────────────────────────
    card.get_by_test_id("page-undo").click()
    line2 = wait_line(page, "undone", "paragraph-undo")
    wait_pickable(page, 3)
    after2 = wait_text(page, P2, LONG_PARAGRAPH)
    versions = manifest(page, DOC)
    check("paragraph-undo", "version 3" in line2 and after2.get("text") == LONG_PARAGRAPH
          and versions == [3, [1, None, False], [2, 1, True], [3, 1, False]], line=line2,
          paragraph_length=len(after2.get("text") or ""), manifest=versions)

    # ── 6. a container is not text ─────────────────────────────────────────────────
    card.get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=15000)
    plugin.locator('[data-testid="page-editor"][data-size="full"]').wait_for(state="visible", timeout=15000)
    wait_pickable(page, 3)
    frame = plugin.frame_locator('[data-testid="page-frame"]')
    # The section's own top edge: its padding is its own, the heading starts below it.
    frame.locator('[data-wid="section-1"]').click(position={"x": 3, "y": 3})
    plugin.locator('[data-testid="page-selected-box"][data-wid="section-1"]').wait_for(state="visible", timeout=15000)
    plugin.locator('[data-testid="page-hint"][data-editable="false"]').wait_for(state="visible", timeout=15000)
    sel6 = plugin.get_by_test_id("page-selected-box").get_attribute("data-wid")
    hint6 = plugin.get_by_test_id("page-hint").inner_text()
    editable6 = plugin.get_by_test_id("page-hint").get_attribute("data-editable")
    page.keyboard.type("x")
    page.wait_for_timeout(200)
    field6 = plugin.get_by_test_id("page-editor").evaluate(EDIT_FIELD)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-container.png"))
    check("container-is-not-text", sel6 == "section-1" and editable6 == "false" and hint6.startswith("Section 2 holds other parts")
          and field6 is None, selected=sel6, hint=hint6, field=field6)

    # ── 7. coverage absent elsewhere ───────────────────────────────────────────────
    absent: dict = {}
    for name, bound in (("no-repository", {"pid": PID, "doc": DOC}), ("no-requirements-read", {"pid": PID, "doc": DOC, "repo": "no-reqs-repo"})):
        set_fixture(origin, doc_bound_run=bound, editors=True)
        open_session(page, name)
        wait_pickable(page, 3)
        options = open_coverage(page)
        # No repository, or a repository with no requirements read (crew's 404), is an answer: the Coverage tab says
        # there are none (never "Couldn't read" with a retry that cannot help). Waiting for that sentence also keeps
        # "Reading requirements…" from passing as an empty result.
        options.get_by_test_id("doc-coverage").get_by_text(
            "No requirements for this document's repository", exact=True).wait_for(state="visible", timeout=15000)
        absent[name] = {"key": page.locator(DOC_CARD).get_attribute("data-artifact"),
                        "rows": options.get_by_test_id("doc-coverage-row").count(),
                        "text": options.get_by_test_id("doc-coverage").inner_text(),
                        "hscroll": page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth"),
                        "frame_hscroll": options.get_by_test_id("doc-coverage").evaluate(
                            "c => document.documentElement.scrollWidth > document.documentElement.clientWidth || c.scrollWidth > c.clientWidth")}
        page.wait_for_timeout(SETTLE_MS)
        page.screenshot(path=str(SHOTS / f"desk-doc-editors-{name}-coverage.png"))
    # More requirements than one page of the read: the slot says so instead of passing 50 off as all.
    many = [{"key": f"booking::REQ-{n:03d}", "reqId": f"REQ-{n:03d}", "title": f"Requirement {n}"} for n in range(101, 161)]
    set_fixture(origin, doc_bound_run={"pid": PID, "doc": DOC, "repo": "big-repo"},
                requirements={REPO_ID: REQS, "big-repo": many}, editors=True)
    open_session(page, "more-than-a-page")
    wait_pickable(page, 3)
    options = open_coverage(page)
    options.locator('[data-testid="doc-coverage"][data-total="60"][data-rows="50"]').wait_for(state="visible", timeout=15000)
    paged = coverage_state(options)
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-coverage-first-page.png"))
    # requirementsFor still reads limit=50, and coverageLine still includes the first-page wording.
    check("coverage-absent-elsewhere", all(a["key"] == f"{RUN}:{PID}/{DOC}" and a["rows"] == 0
          and a["text"].strip() == "No requirements for this document's repository"
          and not a["hscroll"] and not a["frame_hscroll"] for a in absent.values())
          and paged["total"] == 60 and paged["rows"] == 50 and len(paged["items"]) == 50
          and "(the first 50 of 60)" in paged["line"], **absent, more_than_a_page=paged)
    page.get_by_test_id("host-panel-close").click()

    # ════ THE SLIDE EDITOR (P-D1: the `wicked-deck` plugin; desk_deck_editor_test.py walks it) ═══
    # Crew's builtin posture allows a first-party editor what it declares; the fixture's default grants are a pack's,
    # so the deck's artifact.export (Export ▾) is granted here as the daemon grants it.
    set_fixture(origin, doc_bound_run={"pid": PID, "doc": DECK}, editors=True,
                editor_grants=["artifact.read", "artifact.write", "selection.chip", "composer.draft", "checks.contribute",
                               "ui.fullscreen", "artifact.export", "artifact.theme"])
    open_session(page, "deck", editor="wicked-deck")
    card = page.locator('[data-testid="plugin-card"][data-editor="wicked-deck"]')
    deck_frame = page.frame_locator('[data-testid="plugin-card"][data-editor="wicked-deck"] [data-testid="editor-frame"]')
    d0 = {"surface": card.get_attribute("data-surface"), "key": card.get_attribute("data-artifact")}

    # A deck/document made in this project offers an ordinary suggestion on the empty composer.
    suggestion = page.locator('[data-testid="composer-suggestion"][data-id="demo-video"]')
    suggestion.wait_for(state="visible", timeout=15000)
    suggestion_text = suggestion.inner_text()
    suggestion.click()
    wizard = page.get_by_test_id("launch-wizard")
    wizard.wait_for(state="visible", timeout=15000)
    wizard.get_by_test_id("launch-wizard-demo").wait_for(state="visible", timeout=15000)
    demo = {"title": wizard.get_by_role("heading").inner_text(),
            "step": wizard.get_by_test_id("launch-wizard-step").get_attribute("data-step"),
            "project": wizard.get_by_test_id("launch-wizard-demo-project").input_value()}
    page.screenshot(path=str(SHOTS / "desk-doc-editors-demo-video-wizard.png"))
    page.keyboard.press("Escape")
    wizard.wait_for(state="detached", timeout=15000)
    check("demo-video-suggestion", suggestion_text == "Make a demo video of this"
          and demo == {"title": "New job: Demo video", "step": "demo", "project": PID}
          and wizard.count() == 0, suggestion=suggestion_text, wizard=demo, closed=wizard.count() == 0)

    card.get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=5000)
    try:
        deck_frame.locator('[data-testid="deck-thumb"]').first.wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-doc-editors-deck-missing.png"))
        fail("deck-plugin", "the full deck shows no wicked-deck filmstrip")
    titles = deck_frame.locator('[data-testid="deck-thumb"]').evaluate_all("bs => bs.map(b => b.dataset.n + ' ' + b.querySelector('.t').innerText)")
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-deck-full.png"))
    # ── 8. kind + the deck's own full editor ──────────────────────────────────────
    check("deck-plugin", d0 == {"surface": "card", "key": f"{RUN}:{PID}/{DECK}"}
          and card.get_attribute("data-surface") == "full"
          and deck_frame.locator('[data-testid="deck-editor"]').get_attribute("data-kind") == "deck"
          and titles == ["1 Library room booking", "2 Residents first", "3 Staff stay in control", "4 The pilot"],
          card=d0, filmstrip=titles)

    # ── 12. export: the host card's declared action, keyboard access, ready download ─
    page.get_by_test_id("full-shell-exit").click()
    page.get_by_test_id("full-shell").wait_for(state="detached", timeout=5000)
    export = card.locator('[data-testid="plugin-card-action"][data-action="export"]')
    export.focus()
    page.keyboard.press("Enter")
    card.get_by_test_id("artifact-export-menu").wait_for(state="visible", timeout=5000)
    formats = card.get_by_test_id("artifact-export-format").evaluate_all("bs => bs.map(b => [b.dataset.format, b.innerText])")
    FOCUS = "() => document.activeElement?.dataset.format || document.activeElement?.dataset.action || null"
    # Host buttons use native Tab order. The action toggles its own menu on Enter.
    page.keyboard.press("Tab")
    first_focus = page.evaluate(FOCUS)
    page.keyboard.press("Tab")
    next_focus = page.evaluate(FOCUS)
    # Esc on a format closes the menu, not the card (or the page around it), and gives Export its focus back.
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    closed = {"menu": card.get_by_test_id("artifact-export-menu").count(), "focus": page.evaluate(FOCUS), "surface": card.get_attribute("data-surface")}
    keys_ok = first_focus == "pptx" and next_focus == "pdf" and closed == {"menu": 0, "focus": "export", "surface": "card"}
    page.keyboard.press("Enter")
    card.get_by_test_id("artifact-export-menu").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Tab")
    page.keyboard.press("Enter")  # PowerPoint
    try:
        card.locator('[data-testid="page-line"][data-kind="export"] [data-testid="artifact-export-download"]').wait_for(state="visible", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-doc-editors-export-timeout.png"))
        fail("export", {"why": "no ready host export line", "line": card.get_by_test_id("page-line").all_inner_texts()})
    ex_line = card.get_by_test_id("page-line").inner_text()
    ex_href = card.get_by_test_id("artifact-export-download").get_attribute("href")
    card.get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-deck-export.png"))
    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("export", keys_ok and formats == [["pptx", "PowerPoint"], ["pdf", "PDF"]] and ex_line.startswith(f"PPTX export ready — {DECK}_v1.pptx")
          and ex_line.endswith("Download") and "/api/export/file/" in (ex_href or "") and card.get_attribute("data-surface") == "full" and not overflow,
          formats=formats, keyboard={"first_format": first_focus, "next_format": next_focus, "closed": closed}, line=ex_line, href=ex_href)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
