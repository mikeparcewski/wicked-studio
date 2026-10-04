#!/usr/bin/env python3
"""
desk_page_editor_test.py — S8, the morphing artifact and the page element editor, now the `wicked-page`
PLUGIN in the kind slot (EP-P2; DES-STUDIO-REBUILD-001 §11 S8; DES-EDITOR-PLUGINS-001 §7.1, §9.3;
DESIGN-interaction rules 1, 2 and 3) at 1440x700 under STUDIO_SKIN=desk.

Against the in-process fixture: a document created on project `notes`, a run bound to it
(`doc_bound_run` — the draft seam's write root names the doc) in the sessions corpus, crew's editor
registry stand-in listing the `wicked-page` bundle the served dist carries (hash-pinned, with the
bundle CSP), and the grants route answering the engine's decided set. It proves S8's acceptance
against the plugin, and EP-P2's own:

  1. INLINE: the session `/s/run:r-doc-bound` shows the run's page as a live preview in its block
     (`artifact[data-size=inline]` → the plugin frame → the nested page frame renders the headline).
     ONE handshake, 0 ignored window messages.
  2. MORPH: a click on the preview grows it to a pane beside the thread; ⤢ grows it to full screen;
     Esc shrinks one step each time back to inline. The same element throughout (never re-parented):
     the artifact's `data-object` AND the plugin frame element itself are unchanged across pane ↔ full.
  3. POINT: in the pane, a click on the headline (inside the nested frame) picks it
     (`page-selected-box[data-wid=headline]` in the plugin) and makes it the subject of the next message
     — an "about: “…”" chip on the session composer, its words written by the HOST from its own
     inventory of the version.
  4. EDIT BY TOUCHING: typing on the picked headline opens the edit field prefilled with the typed
     character AND focused in the same turn (every animation frame held back), the new text + Enter lands
     ONE version through the host (`page-line[data-kind=edited]`, version 2, the nested frame shows the
     new headline) with Undo — the host's line, under the plugin.
  5. UNDO: Undo forks the page before the change as version 3 (`page-line[data-kind=undone]`), and the
     frame shows the original headline again.
  6. NOT UNDONE: after a second touch edit (version 4), a helper's version lands in between (a feedback
     batch posted straight to the bridge → version 5); Undo is refused — `409 head_moved` — and the line
     reads "Not undone … (version 5)"; the helper's text is what the frame shows.
  7. TEXT, NOT MARKUP: the headline picked again makes no second chip — the one chip now quotes the
     helper's text; Enter opens the field focused with that text selected (frames held back), and
     typing `<b>x</b>` lands as those characters: the headline text is literally `<b>x</b>` and holds no
     <b> element (the host escapes the op; the engine applies content-edit as HTML).
  8. NO NETWORK: across the whole session the plugin frame and its nested page frame made 0 requests
     beyond the bundle entry itself (`network.media` images: none in this page); the registry was read
     once; 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-page-editor-*.png. Env: FEEDBACK_PORT (default 4358).
"""

import json
import os
import sys
import time
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
if not (dist / "editors" / "wicked-page" / "editor.json").is_file():
    fail("build", f"{dist} carries no editors/wicked-page/editor.json — rebuild it (vite.config.ts emits the editor bundles)")
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ARTIFACT = """() => {
  const a = document.querySelector('[data-testid="artifact"]');
  if (!a) return null;
  const r = a.getBoundingClientRect();
  const f = document.querySelector('[data-testid="editor-frame"]');
  if (f && !f.__wk) f.__wk = String(Math.random()).slice(2);
  return { size: a.dataset.size, object: a.dataset.object, doc: a.dataset.doc, kind: a.dataset.kind, w: Math.round(r.width), h: Math.round(r.height),
           left: Math.round(r.left), version: (document.querySelector('[data-testid="artifact-version"]') || {}).innerText || '',
           pane: document.querySelector('[data-testid="session"]')?.dataset.pane,
           frames: document.querySelectorAll('[data-testid="editor-frame"]').length, frame: f ? f.__wk : null,
           editor: document.querySelector('[data-testid="plugin-artifact"]')?.dataset.editor ?? null,
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""

PAGE_EDITOR = """() => { const e = document.querySelector('[data-testid="page-editor"]');
  return e ? { pickable: e.dataset.pickable, head: e.dataset.head, selected: e.dataset.selected, size: e.dataset.size } : null; }"""

HOLD_FRAMES = """() => { if (window.__heldFrames) return; window.__heldFrames = []; window.__raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { window.__heldFrames.push(cb); return 0; }; }"""
RELEASE_FRAMES = """() => { if (!window.__heldFrames) return; const held = window.__heldFrames; window.requestAnimationFrame = window.__raf;
  window.__heldFrames = null; for (const cb of held) window.requestAnimationFrame(cb); }"""
EDIT_FIELD = """() => { const i = document.querySelector('[data-testid="page-edit-input"]');
  return i && !i.hidden ? { value: i.value, focused: document.activeElement === i } : null; }"""


def plugin_frame(page):
    """The `wicked-page` plugin's own document (the frame crew's bundle route serves)."""
    for f in page.frames:
        if f.parent_frame == page.main_frame and "/api/v1/editors/" in f.url:
            return f
    return None


def frame_headline(page) -> dict:
    """What the nested page frame shows for the headline: its text, and whether it holds markup. The
    nested frame reloads on every new version (its srcdoc changes), so a detached or half-loaded frame
    is skipped and the newest frame that holds a headline wins."""
    found: dict = {"text": None, "bold": None, "html": None}
    for f in page.frames:
        if f == page.main_frame:
            continue
        try:
            got = f.evaluate("""() => { const h = document.querySelector('[data-wid="headline"]');
              if (!h || document.readyState === 'loading') return null;
              return { text: h.textContent.trim(), bold: h.querySelector('b') !== null, html: h.innerHTML.slice(0, 120) }; }""")
        except Exception:
            continue
        if got is not None:
            found = got
    return found


def wait_pickable(page, head: int) -> None:
    """The nested frame for `head` has loaded and answered the bridge's inventory — a click will register."""
    deadline = time.time() + 15
    last = None
    while time.time() < deadline:
        pf = plugin_frame(page)
        if pf is not None:
            try:
                last = pf.evaluate(PAGE_EDITOR)
            except Exception:
                last = None
            if last and last.get("pickable") == "true" and last.get("head") == str(head):
                return
        page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / f"desk-page-editor-pickable-{head}-timeout.png"))
    fail("pickable", {"why": f"the plugin never became pickable at head {head}", "found": last})


def wait_line(page, kind: str, step: str, timeout_ms: int = 20000) -> str:
    """The host's line under the page reaches `kind`; on a timeout the failure names the line it found
    (its kind and text) and the plugin's head, so a CI failure is readable."""
    try:
        page.wait_for_selector(f'[data-testid="page-line"][data-kind="{kind}"]', timeout=timeout_ms)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-page-editor-{step}-timeout.png"))
        pf = plugin_frame(page)
        found = page.evaluate("""() => { const l = document.querySelector('[data-testid="page-line"]');
          return { kind: l ? l.dataset.kind : null, text: l ? l.innerText : null }; }""")
        found["plugin"] = pf.evaluate(PAGE_EDITOR) if pf is not None else None
        fail(step, {"why": f"no page-line[data-kind={kind}] within {timeout_ms} ms", "found": found})
    return page.get_by_test_id("page-line").inner_text()


def wait_headline(page, text: str, timeout_ms: int = 10000) -> dict:
    deadline = time.time() + timeout_ms / 1000
    last: dict = {}
    while time.time() < deadline:
        last = frame_headline(page)
        if last.get("text") == text:
            return last
        page.wait_for_timeout(250)
    return last


def chips(page) -> list:
    return page.evaluate("""() => [...document.querySelectorAll('[data-testid="composer-chip"]')]
      .map(c => ({ kind: c.dataset.kind, key: c.dataset.key, text: c.innerText }))""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    # Every request a frame other than the shell makes: the plugin frame and the nested page frame.
    frame_requests: list[str] = []
    page.on("request", lambda r: frame_requests.append(r.url) if r.frame is not None and r.frame != page.main_frame else None)
    registry_reads: list[str] = []
    page.on("request", lambda r: registry_reads.append(r.url) if r.url.endswith("/api/v1/editors") else None)

    # The document exists on the bridge (v1), a run is drafting it, and the daemon lists its editors.
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DOC, "brief": "the offsite plan"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC}, extra_frames=[], editors=True, shell_csp=True)

    # ── 1. inline in the run's block: the plugin, one handshake ──────────────────────────
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.get_by_test_id("artifact").wait_for(state="visible", timeout=15000)
        page.locator('[data-testid="plugin-artifact"][data-editor="wicked-page"]').wait_for(state="attached", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-page-editor-missing.png"))
        fail("inline", {"why": "no [data-testid=artifact] hosting the wicked-page plugin in the session's run block",
                        "artifact": page.evaluate(ARTIFACT)})
    shown = wait_headline(page, HEADLINE_V1)
    a0 = page.evaluate(ARTIFACT)
    pf = plugin_frame(page)
    inline_plugin = pf.evaluate(PAGE_EDITOR) if pf is not None else None
    page.screenshot(path=str(SHOTS / "desk-page-editor-inline.png"))
    check("inline", a0 is not None and a0["size"] == "inline" and a0["doc"] == DOC and a0["kind"] == "page" and a0["editor"] == "wicked-page"
          and a0["frames"] == 1 and shown.get("text") == HEADLINE_V1 and "version 1" in a0["version"] and not a0["hscroll"]
          and inline_plugin is not None and inline_plugin["size"] == "inline" and inline_plugin["pickable"] == "false",
          artifact=a0, headline=shown, plugin=inline_plugin)

    # ── 2. morph: inline → pane → full → pane → inline, one element, one plugin frame ──────
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
          # EP-D2: the plugin frame is the same element in the pane, at full screen, and back.
          and a1["frame"] is not None and a1["frame"] == a2["frame"] == a3["frame"] and a1["frames"] == a2["frames"] == a3["frames"] == 1
          and not a2["hscroll"],
          inline=a0, pane=a1, full=a2, back_pane=a3, back_inline=a4)

    # ── 3. point: pick the headline inside the nested frame → the host's about-chip ────────
    page.get_by_test_id("artifact-open").click()
    page.wait_for_timeout(500)
    wait_pickable(page, 1)
    plugin = page.frame_locator('[data-testid="editor-frame"]')
    doc = plugin.frame_locator('[data-testid="page-frame"]')
    doc.locator('[data-wid="headline"]').click()
    plugin.locator('[data-testid="page-selected-box"]').wait_for(state="visible", timeout=5000)
    sel = plugin.locator('[data-testid="page-selected-box"]').get_attribute("data-wid")
    c3 = chips(page)
    page.screenshot(path=str(SHOTS / "desk-page-editor-point.png"))
    check("point", sel == "headline" and any(c["key"] == f"el:{DOC}/headline" and "Q3 was a quarter" in c["text"] for c in c3), selected=sel, chips=c3)

    # ── 4. edit by touching: type on the headline → one version through the host ────────────
    pf = plugin_frame(page)
    pf.evaluate(HOLD_FRAMES)
    page.keyboard.type("Q")
    first = pf.evaluate(EDIT_FIELD)
    page.keyboard.type("3: revenue up 18%")
    typed = pf.evaluate(EDIT_FIELD)
    pf.evaluate(RELEASE_FRAMES)
    check("type-behind", first == {"value": "Q", "focused": True} and typed == {"value": "Q3: revenue up 18%", "focused": True},
          after_first_key=first, after_the_rest=typed)
    page.keyboard.press("Enter")
    line1 = wait_line(page, "edited", "edit-by-touching")
    after1 = wait_headline(page, "Q3: revenue up 18%")
    v1 = page.evaluate(ARTIFACT)["version"]
    page.screenshot(path=str(SHOTS / "desk-page-editor-edited.png"))
    check("edit-by-touching", "version 2" in line1 and "headline" in line1 and after1.get("text") == "Q3: revenue up 18%"
          and "version 2" in v1, line=line1, headline=after1, version=v1)

    # ── 5. undo → version 3 is the page before ─────────────────────────────────────────────
    page.get_by_test_id("page-undo").click()
    line2 = wait_line(page, "undone", "undo")
    after2 = wait_headline(page, HEADLINE_V1)
    page.screenshot(path=str(SHOTS / "desk-page-editor-undone.png"))
    check("undo", "version 3" in line2 and after2.get("text") == HEADLINE_V1, line=line2, headline=after2)

    # ── 6. not undone: a helper's version lands between the edit and the Undo ────────────
    wait_pickable(page, 3)
    doc.locator('[data-wid="headline"]').click()
    plugin.locator('[data-testid="page-selected-box"]').wait_for(state="visible", timeout=5000)
    page.keyboard.press("Enter")
    plugin.locator('[data-testid="page-edit-input"]').wait_for(state="visible", timeout=5000)
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

    # ── 7. typed markup lands as text ──────────────────────────────────────────────────────
    wait_pickable(page, 5)
    doc.locator('[data-wid="headline"]').click()
    plugin.locator('[data-testid="page-selected-box"]').wait_for(state="visible", timeout=5000)
    rechips = chips(page)
    check("chip-follows", len(rechips) == 1 and rechips[0]["key"] == f"el:{DOC}/headline" and "Q3, by the helper" in rechips[0]["text"], chips=rechips)
    pf = plugin_frame(page)
    pf.evaluate(HOLD_FRAMES)
    page.keyboard.press("Enter")
    opened = pf.evaluate(EDIT_FIELD)
    page.keyboard.type("<b>x</b>")
    replaced = pf.evaluate(EDIT_FIELD)
    pf.evaluate(RELEASE_FRAMES)
    check("enter-selects", opened == {"value": "Q3, by the helper", "focused": True} and replaced == {"value": "<b>x</b>", "focused": True},
          after_enter=opened, after_typing=replaced)
    page.keyboard.press("Enter")
    wait_line(page, "edited", "text-not-markup")
    after5 = wait_headline(page, "<b>x</b>")
    page.screenshot(path=str(SHOTS / "desk-page-editor-markup.png"))
    check("text-not-markup", after5.get("text") == "<b>x</b>" and after5.get("bold") is False, headline=after5)

    # ── 8. nothing left the plugin: 0 requests beyond the bundle entry; one registry read ──
    page.wait_for_timeout(300)
    beyond = [u for u in frame_requests if "/api/v1/editors/" not in u or "/entry?" not in u]
    check("no-network", beyond == [] and len(registry_reads) == 1 and all("/api/v1/editors/wicked-page/" in u for u in frame_requests),
          beyond_the_bundle=beyond, frame_requests=len(frame_requests), registry_reads=len(registry_reads))

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
