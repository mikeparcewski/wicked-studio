#!/usr/bin/env python3
"""
desk_doc_editors_test.py — S9, the document and slide editors (DES-STUDIO-REBUILD-001 §11 S9;
DES-EDITOR-PLUGINS-001 §7.2) at 1440x700 on the Desk.

Against the in-process fixture: two documents created on project `notes` with a recorded style — a
written document (`style: doc`) and a deck (`style: ppt`), anchored the way the real engine anchors
(`slide-{i}-{role}-{n}`, `section-{i}`) — each bound in turn to the run `r-doc-bound`, and proves:

  THE DOCUMENT EDITOR
  1. KIND: the run's artifact is `artifact[data-kind=document]` (from the recorded style), and the
     pane's hint speaks of paragraphs.
  2. COVERAGE = THE READ: at full screen, with the run on a repository whose requirements read
     serves, the coverage slot shows exactly that read — the same ids and titles, the same total —
     and says how many the document names ("2 of 3 named in this document"); in the pane (no room
     for a column) the slot is absent.
  3. A REQUIREMENT IS A SUBJECT: a click on a named requirement puts "about: requirement REQ-002"
     on the composer and picks the paragraph that names it.
  4. A PARAGRAPH EDIT IS ONE VERSION: Enter on that paragraph — longer than 400 characters — opens
     the field holding its WHOLE text; new text + Enter lands version 2 ("Changed paragraph 2 —
     version 2." — plain words, never the raw anchor id) with Undo. What was SENT is one batch of
     one content-edit whose `before` is the paragraph's whole text (the engine's stale guard).
  5. UNDO: version 3 is the page before; the long paragraph is back. The bridge's own manifest
     holds exactly versions 1, 2 (the edit, off 1) and 3 (the fork of 1) — one version per act.
  6. A CONTAINER IS NOT TEXT: a section picked by its own edge says it holds other parts, and
     typing on it opens no field.
  7. COVERAGE ABSENT ELSEWHERE: a run with no repository, and a run on a repository with no
     requirements read (404), show the document editor with NO coverage slot. A repository whose
     read holds more than one page says so: "(the first 50 of 60)", total 60, 50 rows.

  THE SLIDE EDITOR (P-D1)
  8. A DECK OPENS IN ITS OWN EDITOR: `artifact[data-kind=deck]` hosts the `wicked-deck` plugin
     (DES-PRESENTATION-EDITOR-001, operator decision D1), its filmstrip naming the deck's four slides
     in order. desk_deck_editor_test.py walks the editor itself (slide ops, notes, review, audience).
 12. EXPORT: Export ▾ offers PowerPoint and PDF, by keyboard too (the first format holds the
     focus, ↓ moves, Esc closes the menu — not the artifact — and returns the focus); PowerPoint
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
SETTLE_MS = 450  # a morph's view transition has finished: the capture shows the settled size
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

ARTIFACT = """() => {
  const a = document.querySelector('[data-testid="artifact"]');
  if (!a) return null;
  return { size: a.dataset.size, kind: a.dataset.kind, doc: a.dataset.doc,
           version: (document.querySelector('[data-testid="artifact-version"]') || {}).innerText || '',
           hint: (document.querySelector('[data-testid="page-hint"]') || {}).innerText || '',
           coverage: document.querySelectorAll('[data-testid="doc-coverage"]').length,
           strip: document.querySelectorAll('[data-testid="slide-strip"]').length,
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""
CHIPS = """() => [...document.querySelectorAll('[data-testid="composer-chip"]')].map(c => ({ key: c.dataset.key, text: c.innerText.replace(/\\n×$/, '') }))"""
EDIT_FIELD = """() => { const i = document.querySelector('[data-testid="page-edit-input"]');
  return i ? { value: i.value, focused: document.activeElement === i } : null; }"""


def frame_wid(page, wid: str) -> dict:
    """What the sandboxed frame shows for one anchor: its text and where it sits in the frame's
    viewport. The frame reloads on every new version, so the newest frame that holds it wins."""
    found: dict = {"text": None}
    for f in page.frames:
        if f == page.main_frame:
            continue
        try:
            got = f.evaluate("""(wid) => { const h = document.querySelector('[data-wid="' + wid + '"]');
              if (!h || document.readyState === 'loading') return null;
              const r = h.getBoundingClientRect();
              return { text: h.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; }""", wid)
        except Exception:
            continue
        if got is not None and got.get("text"):
            found = got
    return found


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
    page.wait_for_function(
        "h => { const e = document.querySelector('[data-testid=\"page-editor\"]'); return !!e && e.dataset.pickable === 'true' && e.dataset.head === String(h); }",
        arg=head, timeout=15000)


def wait_line(page, kind: str, step: str, timeout_ms: int = 20000) -> str:
    try:
        page.wait_for_selector(f'[data-testid="page-line"][data-kind="{kind}"]', timeout=timeout_ms)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-doc-editors-{step}-timeout.png"))
        found = page.evaluate("""() => { const l = document.querySelector('[data-testid="page-line"]');
          const e = document.querySelector('[data-testid="page-editor"]');
          const i = document.querySelector('[data-testid="page-edit-input"]');
          return { kind: l ? l.dataset.kind : null, text: l ? l.innerText : null, head: e ? e.dataset.head : null,
                   field: i ? { length: i.value.length, focused: document.activeElement === i } : null }; }""")
        fail(step, {"why": f"no page-line[data-kind={kind}] within {timeout_ms} ms", "found": found})
    return page.get_by_test_id("page-line").inner_text()


def manifest(page, doc: str) -> list:
    """The bridge's own version manifest for `doc`: [version, parent, deterministic?] per version."""
    m = page.evaluate(f"""async () => {{ const r = await fetch('/api/v1/projects/{PID}/interactive/d/{doc}/api/versions'); return r.json(); }}""")
    return [m["head"]] + [[v["version"], v["parent"], v["feedback_file"] is not None] for v in sorted(m["versions"], key=lambda v: v["version"])]


def open_session(page, step: str, editor: str | None = None) -> None:
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        if editor is None:
            page.get_by_test_id("artifact").wait_for(state="visible", timeout=15000)
        else:
            page.locator(f'[data-testid="plugin-card"][data-editor="{editor}"][data-protocol="2"]').wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-doc-editors-{step}-missing.png"))
        fail(step, f"no {editor or 'artifact'} in the session's run block")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    docs_url = f"{origin}/api/v1/projects/{PID}/interactive/api/docs"
    post_json(docs_url, {"name": DOC, "brief": "our response to the library's request", "style": "doc"})
    post_json(docs_url, {"name": DECK, "brief": "the pitch, four slides", "style": "ppt"})

    # ════ THE DOCUMENT EDITOR ════════════════════════════════════════════════════════
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC, "repo": REPO_ID},
                requirements={REPO_ID: REQS}, extra_frames=[])
    open_session(page, "document")
    wait_text(page, "slide-0-heading-1", "Library room booking — our response")
    a0 = page.evaluate(ARTIFACT)
    page.get_by_test_id("artifact-open").click()
    wait_pickable(page, 1)
    a1 = page.evaluate(ARTIFACT)
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-document-pane.png"))
    # ── 1. kind ────────────────────────────────────────────────────────────────────
    check("document-kind", a0 is not None and a0["kind"] == "document" and a0["size"] == "inline" and a0["doc"] == DOC
          and a1["size"] == "pane" and "paragraph" in a1["hint"] and a1["coverage"] == 0, inline=a0, pane=a1)

    # ── 2. coverage = the read ─────────────────────────────────────────────────────
    page.get_by_test_id("artifact-grow").click()
    try:
        page.get_by_test_id("doc-coverage").wait_for(state="visible", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-doc-editors-coverage-missing.png"))
        fail("coverage-is-the-read", "no [data-testid=doc-coverage] at full screen on a run whose repository serves requirements")
    read = page.evaluate(f"""async () => {{ const r = await fetch('/api/v1/repos/{REPO_ID}/requirements?offset=0&limit=50'); return r.json(); }}""")
    cov = page.evaluate("""() => { const c = document.querySelector('[data-testid="doc-coverage"]');
      return { repo: c.dataset.repo, total: Number(c.dataset.total), named: Number(c.dataset.named),
               line: document.querySelector('[data-testid="doc-coverage-line"]').innerText,
               rows: [...c.querySelectorAll('[data-testid="doc-coverage-row"]')].map(r => ({ key: r.dataset.key, req: r.dataset.req, named: r.dataset.named, text: r.innerText })) }; }""")
    page.wait_for_timeout(SETTLE_MS)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-coverage.png"))
    by_key = {r["key"]: r for r in cov["rows"]}
    same_rows = (sorted(by_key) == sorted(i["key"] for i in read["items"])
                 and all(by_key[i["key"]]["req"] == i["reqId"] and i["title"] in by_key[i["key"]]["text"] for i in read["items"]))
    check("coverage-is-the-read", cov["repo"] == REPO_ID and cov["total"] == read["total"] == 3 and same_rows
          and cov["named"] == 2 and cov["line"].startswith("2 of 3 named in this document")
          and by_key["booking::REQ-003"]["named"] == "false" and "at risk" in by_key["booking::REQ-002"]["text"],
          coverage=cov, read={"total": read["total"], "keys": [i["key"] for i in read["items"]]})

    # ── 3. a requirement is a subject ──────────────────────────────────────────────
    wait_pickable(page, 1)
    page.locator('[data-testid="doc-coverage-row"][data-key="booking::REQ-002"]').click()
    page.get_by_test_id("page-selected-box").wait_for(state="visible", timeout=5000)
    sel = page.get_by_test_id("page-selected-box").get_attribute("data-wid")
    chips = page.evaluate(CHIPS)
    check("requirement-subject", sel == P2 and any(c["key"] == "req:booking::REQ-002" and c["text"] == "about: requirement REQ-002" for c in chips)
          and any(c["key"] == f"el:{DOC}/{P2}" for c in chips), selected=sel, chips=chips)

    # ── 4. a paragraph edit is one version ─────────────────────────────────────────
    page.keyboard.press("Enter")
    opened = page.evaluate(EDIT_FIELD)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-paragraph-field.png"))
    whole = opened is not None and opened["value"] == LONG_PARAGRAPH and opened["focused"]
    page.keyboard.type(NEW_P2)
    page.keyboard.press("Enter")
    if not whole:
        # Say what the field held before the edit is judged: a cut text is the cause, not a symptom.
        check("paragraph-edit", False, why="Enter did not open the field on the paragraph's whole text",
              field_length=None if opened is None else len(opened["value"]), paragraph_length=len(LONG_PARAGRAPH))
    line1 = wait_line(page, "edited", "paragraph-edit")
    after1 = wait_text(page, P2, NEW_P2)
    v1 = page.evaluate(ARTIFACT)["version"]
    page.screenshot(path=str(SHOTS / "desk-doc-editors-paragraph-edited.png"))
    sent = [p for p in json.loads(urllib.request.urlopen(f"{origin}/__fixture/feedback-posts", timeout=10).read())["posts"] if p["doc"] == DOC]
    one_edit = (len(sent) == 1 and sent[0]["version"] == 1 and len(sent[0]["items"]) == 1
                and sent[0]["items"][0] == {"selector": P2, "type": "content-edit", "value": NEW_P2, "before": LONG_PARAGRAPH})
    check("paragraph-edit", line1.startswith("Changed paragraph 2 — version 2.") and "slide-0" not in line1
          and after1.get("text") == NEW_P2 and "version 2" in v1 and one_edit, line=line1, paragraph=after1.get("text"), version=v1,
          field_length=len(opened["value"]), batches_sent=len(sent),
          sent=[{**i, "before": f"<{len(i.get('before') or '')} characters>"} for p in sent for i in p["items"]])

    # ── 5. undo ────────────────────────────────────────────────────────────────────
    page.get_by_test_id("page-undo").click()
    line2 = wait_line(page, "undone", "paragraph-undo")
    after2 = wait_text(page, P2, LONG_PARAGRAPH)
    versions = manifest(page, DOC)
    check("paragraph-undo", "version 3" in line2 and after2.get("text") == LONG_PARAGRAPH
          and versions == [3, [1, None, False], [2, 1, True], [3, 1, False]], line=line2,
          paragraph_length=len(after2.get("text") or ""), manifest=versions)

    # ── 6. a container is not text ─────────────────────────────────────────────────
    wait_pickable(page, 3)
    frame = page.frame_locator('[data-testid="page-frame"]')
    # The section's own top edge: its padding is its own, the heading starts below it.
    frame.locator('[data-wid="section-1"]').click(position={"x": 3, "y": 3})
    page.get_by_test_id("page-selected-box").wait_for(state="visible", timeout=5000)
    sel6 = page.get_by_test_id("page-selected-box").get_attribute("data-wid")
    hint6 = page.get_by_test_id("page-hint").inner_text()
    editable6 = page.get_by_test_id("page-hint").get_attribute("data-editable")
    page.keyboard.type("x")
    page.wait_for_timeout(200)
    field6 = page.evaluate(EDIT_FIELD)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-container.png"))
    check("container-is-not-text", sel6 == "section-1" and editable6 == "false" and hint6.startswith("Section 2 holds other parts")
          and field6 is None, selected=sel6, hint=hint6, field=field6)

    # ── 7. coverage absent elsewhere ───────────────────────────────────────────────
    absent: dict = {}
    for name, bound in (("no-repository", {"pid": PID, "doc": DOC}), ("no-requirements-read", {"pid": PID, "doc": DOC, "repo": "no-reqs-repo"})):
        set_fixture(origin, doc_bound_run=bound)
        open_session(page, name)
        page.get_by_test_id("artifact-open").click()
        page.get_by_test_id("artifact-grow").click()
        wait_pickable(page, 3)
        page.wait_for_timeout(600)  # the requirements read (when there is one) has answered by now
        absent[name] = page.evaluate(ARTIFACT)
    page.screenshot(path=str(SHOTS / "desk-doc-editors-no-coverage.png"))
    # More requirements than one page of the read: the slot says so instead of passing 50 off as all.
    many = [{"key": f"booking::REQ-{n:03d}", "reqId": f"REQ-{n:03d}", "title": f"Requirement {n}"} for n in range(101, 161)]
    set_fixture(origin, doc_bound_run={"pid": PID, "doc": DOC, "repo": "big-repo"}, requirements={REPO_ID: REQS, "big-repo": many})
    open_session(page, "more-than-a-page")
    page.get_by_test_id("artifact-open").click()
    page.get_by_test_id("artifact-grow").click()
    page.get_by_test_id("doc-coverage").wait_for(state="visible", timeout=10000)
    paged = page.evaluate("""() => { const c = document.querySelector('[data-testid="doc-coverage"]');
      return { total: c.dataset.total, rows: c.dataset.rows, shown: c.querySelectorAll('[data-testid="doc-coverage-row"]').length,
               line: document.querySelector('[data-testid="doc-coverage-line"]').innerText }; }""")
    check("coverage-absent-elsewhere", all(a["kind"] == "document" and a["size"] == "full" and a["coverage"] == 0 and not a["hscroll"] for a in absent.values())
          and paged["total"] == "60" and paged["rows"] == "50" and paged["shown"] == 50 and "(the first 50 of 60)" in paged["line"], **absent, more_than_a_page=paged)

    # ════ THE SLIDE EDITOR (P-D1: the `wicked-deck` plugin; desk_deck_editor_test.py walks it) ═══
    set_fixture(origin, doc_bound_run={"pid": PID, "doc": DECK}, editors=True)
    open_session(page, "deck", editor="wicked-deck")
    card = page.locator('[data-testid="plugin-card"][data-editor="wicked-deck"]')
    deck_frame = page.frame_locator('[data-testid="plugin-card"][data-editor="wicked-deck"] [data-testid="editor-frame"]')
    d0 = {"surface": card.get_attribute("data-surface"), "key": card.get_attribute("data-artifact")}
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
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Enter")
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
