#!/usr/bin/env python3
"""
desk_editor_grant_save_test.py — F37 (e2e W9 P10): an installed editor that asks to change documents can save
once the person allows it, and only then. 1440x700 on the Desk, against the in-process fixture: a document on
project `notes`, a run bound to it (`doc_bound_run`), and crew's registry stand-in listing the third-party page
editor `acme-good` (e2e/editor-fixtures/good.html, source `pack`) that asks for artifact.write, with grants decided
over the fixture's EDITOR-GRANTS stand-in (`writer_editor`).

  1. ASKS: the run's page, opened with "Acme outline (installed)", renders read-only ("Read-only here.") and the
     host note says it asks to change it, with "Allow it in Plugins" linking to /plugins?editor=acme-good&allow=
     artifact.write.
  2. ALLOW: the link opens the Plugins page on that editor's details with the keyboard on its "Can change documents
     (you can undo)" switch, off; Space turns it on through crew's POST /editors/acme-good/grants, naming the
     build that was shown (version 0.1.0 + its hash).
  3. SAVE: back on the run, the editor is editable and the note is gone; an edit of the headline lands version 2
     through the host (the host's line, with Undo; a plugin's own "Saved as …" status never replaces it).
  4. UNDO: Undo lands version 3, the page as it was.
  5. OFF AGAIN: the switch turned off withdraws it (allow:false); back on the run the editor is read-only again
     and the note asks again.
  6. 0 page errors.

It runs twice: acme-good listed as protocol 1 (the session hosts it in the page's plugin body, PluginArtifact; the
page opens beside the thread to be edited) and as protocol 1+2 with a card declaration (the card drawn from it,
PluginCard: the path W9's installed checklist takes).

Captures: e2e/shots/desk-editor-grant-*.png. Env: FEEDBACK_PORT (default 4493). JSON report; exit 0/1.
"""

import hashlib
import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4493"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "offsite-plan"
RUN = "r-doc-bound"
EDITOR = "acme-good"
SHA = hashlib.sha256((REPO / "e2e" / "editor-fixtures" / "good.html").read_bytes()).hexdigest()
# acme-good speaks protocol 1: the session hosts it in the page's plugin body (PluginArtifact), the host's line below it.
CARD = f'[data-testid="plugin-artifact"][data-editor="{EDITOR}"]'
NOTE = f'{CARD} [data-testid="plugin-grants-note"]'
LINE = '[data-testid="page-line"]'
SWITCH = '[data-testid="plugin-grant-switch"][data-permission="artifact.write"]'

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


def plugin(page):
    """acme-good's own document (the frame crew's bundle route serves)."""
    for f in page.frames:
        if f.parent_frame == page.main_frame and f"/api/v1/editors/{EDITOR}/" in f.url:
            return f
    return None


def plugin_state(page) -> dict | None:
    f = plugin(page)
    if f is None:
        return None
    try:
        return f.evaluate("""() => ({ mode: document.getElementById('mode')?.textContent || '',
          headline: document.querySelector('[data-wid="headline"]')?.textContent || null })""")
    except Exception:
        return None


def wait_mode(page, want: str, step: str, timeout_s: float = 15) -> dict:
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        last = plugin_state(page)
        if last is not None and want in last["mode"] and last["headline"]:
            return last
        page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-{step}-timeout.png"))
    fail(step, {"why": f"the editor never said {want!r}", "found": last})
    return {}


def wait_line(page, kind: str, step: str) -> str:
    try:
        page.locator(f'{LINE}[data-kind="{kind}"]').wait_for(state="visible", timeout=20000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-editor-grant-{step}-timeout.png"))
        fail(step, {"why": f"no page-line[data-kind={kind}]", "line": page.evaluate(
            "() => document.querySelector('[data-testid=\"page-line\"]')?.innerText ?? null")})
    return page.locator(LINE).inner_text()


def wait_headline(page, want: str, timeout_s: float = 15) -> str | None:
    """What the editor shows for the headline, once it reads `want` (it re-reads the page on every version it did
    not write itself), else the last thing it showed."""
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        st = plugin_state(page)
        last = st["headline"] if st else None
        if last == want:
            return last
        page.wait_for_timeout(250)
    return last


def page_headline(pid: str, doc: str, version: int) -> str | None:
    """The headline of a stored version of the document, as the bridge serves it."""
    import re
    try:
        with urllib.request.urlopen(f"{origin}/api/v1/projects/{pid}/interactive/d/{doc}/doc/{version}", timeout=10) as res:
            html = res.read().decode()
    except Exception:
        return None
    m = re.search(r'data-wid="headline"[^>]*>([^<]*)<', html)
    return m.group(1).strip() if m else None


def spa(page, path: str) -> None:
    page.evaluate("(p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }", path)


def run(p, proto: int) -> None:
    global CARD, NOTE, LINE
    if proto == 1:
        # protocol 1: the session hosts it in the page's plugin body (PluginArtifact), the host's line below it.
        CARD = f'[data-testid="plugin-artifact"][data-editor="{EDITOR}"]'
        NOTE = f'{CARD} [data-testid="plugin-grants-note"]'
        LINE = '[data-testid="page-line"]'
    else:
        # protocol 2 (the W9 checklist's): the card drawn from its declaration (PluginCard), the line inside it.
        CARD = f'[data-testid="plugin-card"][data-editor="{EDITOR}"]'
        NOTE = f'{CARD} [data-testid="plugin-card-note"]'
        LINE = f'{CARD} [data-testid="page-line"]'
    errors.clear()
    n0 = len(get_json(f"{origin}/__fixture/editor-grant-posts")["posts"])
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    doc = f"{DOC}-p{proto}"  # each pass on its own document, so each starts at version 1
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": doc, "brief": "the offsite plan"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": doc}, extra_frames=[], editors=True,
                shell_csp=True, writer_editor=True, writer_ledger=[], writer_protocol=proto)

    # ── 1. the run's page, opened with the installed editor: read-only, and the note links to the switch ──
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("plugin-card-open-with-select").first.wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-no-open-with.png"))
        fail(f"p{proto}-open-with", "no Open with choice on the run's page card")
    page.get_by_test_id("plugin-card-open-with-select").first.select_option(EDITOR)
    page.locator(CARD).wait_for(state="visible", timeout=15000)
    s1 = wait_mode(page, "Read-only here.", "asks")
    original = s1["headline"]
    note = page.locator(NOTE)
    note.wait_for(state="visible", timeout=10000)
    link = note.get_by_test_id("editor-grants-allow")
    href = link.get_attribute("href")
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-1-asks.png"))
    check(f"p{proto}-asks", "asks to change it (you can undo)" in note.inner_text() and href == f"/plugins?editor={EDITOR}&allow=artifact.write",
          note=note.inner_text(), href=href, plugin=s1)

    # ── 2. the link opens the switch; Space allows it, for the build that was shown ──
    link.click()
    page.get_by_test_id("plugin-details").wait_for(state="visible", timeout=10000)
    sw = page.locator(SWITCH)
    sw.wait_for(state="visible", timeout=10000)
    page.wait_for_function(f"() => document.activeElement === document.querySelector('{SWITCH}')", timeout=5000)
    before = sw.get_attribute("aria-checked")
    label = page.locator('[data-testid="plugin-grant-row"][data-permission="artifact.write"]').inner_text()
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-2-switch.png"))
    page.keyboard.press("Space")
    page.wait_for_function(f"() => document.querySelector('{SWITCH}')?.getAttribute('aria-checked') === 'true'", timeout=10000)
    posts = get_json(f"{origin}/__fixture/editor-grant-posts")["posts"][n0:]
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-3-allowed.png"))
    check(f"p{proto}-allow", before == "false" and "Can change documents (you can undo)" in label
          and posts == [{"permission": "artifact.write", "allow": True, "version": "0.1.0", "sha256": SHA}]
          and page.get_by_test_id("plugin-details").get_attribute("data-plugin") == EDITOR,
          before=before, label=label, posts=posts)

    # ── 3. back on the run: it saves ──
    page.go_back()
    page.locator(CARD).wait_for(state="visible", timeout=15000)
    s3 = wait_mode(page, "double-click to edit", "editable")
    note_after = page.locator(NOTE).count()
    if proto == 1:
        # Inline, a protocol-1 page is a preview: a click opens it beside the thread, where it is edited.
        page.get_by_test_id("artifact-open").first.click()
        page.locator(f'{CARD}[data-size="pane"]').wait_for(state="visible", timeout=10000)
        wait_mode(page, "double-click to edit", "editable-pane")
    else:
        # The protocol-2 card is a preview too: its catch opens it (full screen), where it is edited.
        page.locator(CARD).get_by_test_id("plugin-card-catch").click()
        page.wait_for_timeout(600)
        wait_mode(page, "double-click to edit", "editable-open")
    f = plugin(page)
    head = f.locator('[data-wid="headline"]')
    head.dblclick()
    f.evaluate("""() => { const h = document.querySelector('[data-wid="headline"]'); const r = document.createRange();
      r.selectNodeContents(h); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    page.keyboard.type("Q3: revenue up 18%")
    page.keyboard.press("Enter")
    line1 = wait_line(page, "edited", "save")
    saved = page_headline(PID, doc, 2)
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-4-saved.png"))
    check(f"p{proto}-save", note_after == 0 and "version 2" in line1 and saved == "Q3: revenue up 18%",
          note_shown=note_after, line=line1, stored_headline=saved, plugin=s3)

    # ── 4. undo ──
    page.locator(LINE).get_by_test_id("page-undo").click()
    line2 = wait_line(page, "undone", "undo")
    shown = wait_headline(page, original)
    restored = page_headline(PID, doc, 3)
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-5-undone.png"))
    check(f"p{proto}-undo", "version 3" in line2 and restored == original and shown == original,
          line=line2, stored_headline=restored, editor_shows=shown, original=original)

    # ── 5. the switch off again: read-only, and it asks again ──
    spa(page, f"/plugins?editor={EDITOR}&allow=artifact.write")
    page.locator(SWITCH).wait_for(state="visible", timeout=10000)
    page.wait_for_function(f"() => document.querySelector('{SWITCH}')?.getAttribute('aria-checked') === 'true'", timeout=10000)
    page.locator(SWITCH).click()
    page.wait_for_function(f"() => document.querySelector('{SWITCH}')?.getAttribute('aria-checked') === 'false'", timeout=10000)
    posts2 = get_json(f"{origin}/__fixture/editor-grant-posts")["posts"][n0:]
    page.go_back()
    page.locator(CARD).wait_for(state="visible", timeout=15000)
    s5 = wait_mode(page, "Read-only here.", "off-again")
    page.locator(NOTE).wait_for(state="visible", timeout=10000)
    page.screenshot(path=str(SHOTS / f"desk-editor-grant-p{proto}-6-off.png"))
    page.evaluate("() => localStorage.clear()")
    check(f"p{proto}-off-again", len(posts2) == 2 and posts2[1] == {"permission": "artifact.write", "allow": False, "version": "0.1.0", "sha256": SHA},
          posts=posts2, plugin=s5)

    check(f"p{proto}-no-page-errors", errors == [], errors=errors)
    browser.close()


with sync_playwright() as pw:
    for proto in (1, 2):
        run(pw, proto)

report["ok"] = True
print(json.dumps(report, indent=2))
