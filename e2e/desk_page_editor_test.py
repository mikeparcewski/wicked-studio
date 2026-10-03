#!/usr/bin/env python3
"""
desk_page_editor_test.py — S8, the morphing artifact and the page element editor
(DES-STUDIO-REBUILD-001 §11 S8; DESIGN-interaction rules 1, 2 and 3) at 1440x700 under
STUDIO_SKIN=desk.

Against the in-process fixture: a document created on project `notes`, a run bound to it
(`doc_bound_run` — the draft seam's write root names the doc) in the sessions corpus, and proves:

  1. INLINE: the session `/s/run:r-doc-bound` shows the run's page as a live preview in its block
     (`artifact[data-size=inline]`, the frame renders the document's headline).
  2. MORPH: a click on the preview grows it to a pane beside the thread (the thread makes room);
     ⤢ grows it to full screen; Esc shrinks one step each time back to inline. The same element
     throughout (never re-parented): its `data-object` identity is unchanged across sizes.
  3. POINT: in the pane, a click on the headline picks it (`page-selected-box[data-wid=headline]`)
     and makes it the subject of the next message — an "about: “…”" chip on the session composer.
  4. EDIT BY TOUCHING: typing on the picked headline opens the edit field prefilled with the typed
     character; the new text + Enter lands ONE version (`page-line[data-kind=edited]`, version 2,
     the frame shows the new headline) with Undo.
  5. UNDO: Undo forks the page before the change as version 3 (`page-line[data-kind=undone]`), and
     the frame shows the original headline again.
  6. NOT UNDONE: after a second touch edit (version 4), a helper's version lands in between (a
     feedback batch posted straight to the bridge → version 5); Undo is refused — `409 head_moved`
     — and the line reads "Not undone … (version 5)"; the helper's text is what the frame shows.
  7. TEXT, NOT MARKUP: typing `<b>x</b>` on the headline lands as those characters: the frame's
     headline text is literally `<b>x</b>` and holds no <b> element.
  8. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-page-editor-*.png. Env: FEEDBACK_PORT (default 4358).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4358"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "offsite-plan"
RUN = "r-doc-bound"
HEADLINE_V1 = "Q3 was a quarter of significant and wide-ranging positive developments"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


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


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ARTIFACT = """() => {
  const a = document.querySelector('[data-testid="artifact"]');
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return { size: a.dataset.size, object: a.dataset.object, doc: a.dataset.doc, w: Math.round(r.width), h: Math.round(r.height),
           left: Math.round(r.left), version: (document.querySelector('[data-testid="artifact-version"]') || {}).innerText || '',
           pane: document.querySelector('[data-testid="session"]')?.dataset.pane,
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""


def frame_headline(page) -> dict:
    """What the sandboxed frame shows for the headline: its text, and whether it holds markup. The
    frame reloads on every new version (its srcdoc changes), so a detached or half-loaded frame is
    skipped and the newest frame that holds a headline wins."""
    found: dict = {"text": None, "bold": None, "html": None}
    for f in page.frames:
        if f == page.main_frame:
            continue
        try:
            got = f.evaluate("""() => { const h = document.querySelector('[data-wid="headline"]');
              if (!h || document.readyState === 'loading') return null;
              return { text: h.textContent, bold: h.querySelector('b') !== null, html: h.innerHTML.slice(0, 80) }; }""")
        except Exception:
            continue
        if got is not None and got.get("text"):
            found = got
    return found


def wait_pickable(page, head: int) -> None:
    """The frame for `head` has loaded and answered the bridge's inventory — a click will register."""
    page.wait_for_function(
        "h => { const e = document.querySelector('[data-testid=\"page-editor\"]'); return !!e && e.dataset.pickable === 'true' && e.dataset.head === String(h); }",
        arg=head, timeout=15000)


def wait_line(page, kind: str, step: str, timeout_ms: int = 20000) -> str:
    """The line under the page reaches `kind`; on a timeout the failure names the line it found
    (its kind and text) and the artifact's head, so a CI failure is readable."""
    try:
        page.wait_for_selector(f'[data-testid="page-line"][data-kind="{kind}"]', timeout=timeout_ms)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-page-editor-{step}-timeout.png"))
        found = page.evaluate("""() => { const l = document.querySelector('[data-testid="page-line"]');
          const e = document.querySelector('[data-testid="page-editor"]');
          return { kind: l ? l.dataset.kind : null, text: l ? l.innerText : null, head: e ? e.dataset.head : null,
                   pickable: e ? e.dataset.pickable : null, editing: !!document.querySelector('[data-testid="page-edit-input"]') }; }""")
        fail(step, {"why": f"no page-line[data-kind={kind}] within {timeout_ms} ms", "found": found})
    return page.get_by_test_id("page-line").inner_text()


def wait_headline(page, text: str, timeout_ms: int = 10000) -> dict:
    deadline = timeout_ms / 1000
    import time as _t
    t0 = _t.time()
    last: dict = {}
    while _t.time() - t0 < deadline:
        last = frame_headline(page)
        if last.get("text") == text:
            return last
        page.wait_for_timeout(250)
    return last


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # The document exists on the bridge (v1), and a run is drafting it.
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DOC, "brief": "the offsite plan"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC}, extra_frames=[])

    # ── 1. inline in the run's block ──────────────────────────────────────────────────
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("artifact").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-page-editor-missing.png"))
        fail("inline", "no [data-testid=artifact] in the session's run block")
    shown = wait_headline(page, HEADLINE_V1)
    a0 = page.evaluate(ARTIFACT)
    page.screenshot(path=str(SHOTS / "desk-page-editor-inline.png"))
    check("inline", a0 is not None and a0["size"] == "inline" and a0["doc"] == DOC and shown.get("text") == HEADLINE_V1
          and "version 1" in a0["version"] and not a0["hscroll"], artifact=a0, headline=shown)

    # ── 2. morph: inline → pane → full → pane → inline, one element ──────────────────
    page.get_by_test_id("artifact-open").click()
    page.wait_for_timeout(400)
    a1 = page.evaluate(ARTIFACT)
    page.screenshot(path=str(SHOTS / "desk-page-editor-pane.png"))
    page.get_by_test_id("artifact-grow").click()
    page.wait_for_timeout(400)
    a2 = page.evaluate(ARTIFACT)
    page.screenshot(path=str(SHOTS / "desk-page-editor-full.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    a3 = page.evaluate(ARTIFACT)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    a4 = page.evaluate(ARTIFACT)
    check("morph",
          a1["size"] == "pane" and a1["pane"] == "true" and a1["h"] > a0["h"] * 2 and a1["left"] > W / 2
          and a2["size"] == "full" and a2["w"] == W and a2["h"] == H
          and a3["size"] == "pane" and a4["size"] == "inline" and a4["pane"] == "false"
          and a0["object"] == a1["object"] == a2["object"] == a3["object"] == a4["object"]
          and not a2["hscroll"],
          inline=a0, pane=a1, full=a2, back_pane=a3, back_inline=a4)

    # ── 3. point: pick the headline → about-chip ─────────────────────────────────────
    page.get_by_test_id("artifact-open").click()
    page.wait_for_timeout(500)
    wait_pickable(page, 1)
    frame = page.frame_locator('[data-testid="page-frame"]')
    frame.locator('[data-wid="headline"]').click()
    page.get_by_test_id("page-selected-box").wait_for(state="visible", timeout=5000)
    sel = page.get_by_test_id("page-selected-box").get_attribute("data-wid")
    chips = page.evaluate("""() => [...document.querySelectorAll('[data-testid="composer-chip"]')]
      .map(c => ({ kind: c.dataset.kind, key: c.dataset.key, text: c.innerText }))""")
    page.screenshot(path=str(SHOTS / "desk-page-editor-point.png"))
    check("point", sel == "headline" and any(c["key"] == f"el:{DOC}/headline" and "Q3 was a quarter" in c["text"] for c in chips), selected=sel, chips=chips)

    # ── 4. edit by touching: type on the headline → one version ─────────────────────
    page.keyboard.type("Q")
    page.get_by_test_id("page-edit-input").wait_for(state="visible", timeout=5000)
    prefilled = page.get_by_test_id("page-edit-input").input_value()
    page.keyboard.type("3: revenue up 18%")
    page.keyboard.press("Enter")
    line1 = wait_line(page, "edited", "edit-by-touching")
    after1 = wait_headline(page, "Q3: revenue up 18%")
    v1 = page.evaluate(ARTIFACT)["version"]
    page.screenshot(path=str(SHOTS / "desk-page-editor-edited.png"))
    check("edit-by-touching", prefilled == "Q" and "version 2" in line1 and "headline" in line1 and after1.get("text") == "Q3: revenue up 18%"
          and "version 2" in v1, prefilled=prefilled, line=line1, headline=after1, version=v1)

    # ── 5. undo → version 3 is the page before ───────────────────────────────────────
    page.get_by_test_id("page-undo").click()
    line2 = wait_line(page, "undone", "undo")
    after2 = wait_headline(page, HEADLINE_V1)
    page.screenshot(path=str(SHOTS / "desk-page-editor-undone.png"))
    check("undo", "version 3" in line2 and after2.get("text") == HEADLINE_V1, line=line2, headline=after2)

    # ── 6. not undone: a helper's version lands between the edit and the Undo ──────
    wait_pickable(page, 3)
    frame.locator('[data-wid="headline"]').click()
    page.get_by_test_id("page-selected-box").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Enter")
    page.get_by_test_id("page-edit-input").wait_for(state="visible", timeout=5000)
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.type("Q3 in one line")
    page.keyboard.press("Enter")
    line3 = wait_line(page, "edited", "not-undone-edit")
    wait_headline(page, "Q3 in one line")
    # The helper: a feedback batch straight to the bridge, landing version 5 on top.
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/events", {
        "event_type": "wicked.interactive.feedback.submitted",
        "payload": {"document_id": DOC, "version": 4, "author": "helper",
                    "items": [{"selector": "headline", "type": "content-edit", "value": "Q3, by the helper"}]}})
    page.get_by_test_id("page-undo").click()
    line4 = wait_line(page, "not-undone", "not-undone")
    after4 = wait_headline(page, "Q3, by the helper")
    page.screenshot(path=str(SHOTS / "desk-page-editor-not-undone.png"))
    check("not-undone", "version 4" in line3 and line4.startswith("Not undone") and "version 5" in line4
          and after4.get("text") == "Q3, by the helper", edited=line3, line=line4, headline=after4)

    # ── 7. typed markup lands as text ────────────────────────────────────────────────
    wait_pickable(page, 5)
    frame.locator('[data-wid="headline"]').click()
    page.get_by_test_id("page-selected-box").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Enter")
    page.get_by_test_id("page-edit-input").wait_for(state="visible", timeout=5000)
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.type("<b>x</b>")
    page.keyboard.press("Enter")
    wait_line(page, "edited", "text-not-markup")
    after5 = wait_headline(page, "<b>x</b>")
    page.screenshot(path=str(SHOTS / "desk-page-editor-markup.png"))
    check("text-not-markup", after5.get("text") == "<b>x</b>" and after5.get("bold") is False, headline=after5)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
