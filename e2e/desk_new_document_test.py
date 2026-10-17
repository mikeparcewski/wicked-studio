#!/usr/bin/env python3
"""
desk_new_document_test.py — the New document form and the page it makes (studio#765, #766, #768),
at 1440x700 against the in-process fixture (switches editors, doc_v0, doc_silent, doc_bound_run).

  1. Everything › Made › Pages › New document: the form opens on Web page (#768).
  2. The form looks like a form (#766): the Name field draws a box, the Format select and the notes are
     in the form's own face (not monospace), and a disabled Create looks disabled (no fill, dashed edge)
     where an enabled one is filled.
  3. One helper is not enough (#765): with one helper on, Create is disabled and the form says a second
     one checks the work. With two, Create sends both.
  4. Create lands on Pages with the new page open (#768: never a "No documents yet" filter beside it).
     The page has no version yet; its draft run is live, so the page says it is being written and links
     the run (#765). The link opens the run's session.
  5. The draft run fails (the engine's "evaluator≠creator unsatisfiable" error): the page says the draft
     stopped and why, in plain words, with the run linked (#765).

Captures (e2e/shots/): desk-new-document-{form,writing,stopped}-{light,dark}.png.
Env: FEEDBACK_PORT (default 4613). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4613"))
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "tip-page"
report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, editors=True, shell_csp=True, doc_v0=True, doc_silent=True, doc_bound_run={"pid": PID, "doc": DOC})

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
STYLE = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e);
  return { font: c.fontFamily, border: parseFloat(c.borderTopWidth), borderStyle: c.borderTopStyle, bg: c.backgroundColor,
           h: e.getBoundingClientRect().height, disabled: e.disabled === true }; }"""
errors: list = []
creates: list = []


def shoot(page, name: str) -> None:
    for theme in ("wicked-light", "wicked-dark"):
        page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / f"desk-new-document-{name}-{theme.split('-')[1]}.png"))
    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'wicked-light')")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: creates.append(r.post_data) if r.method == "POST" and r.url.endswith("/interactive/api/docs") else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # 1. Made › Pages › New document opens on Web page.
    page.goto(f"{origin}/everything?tab=made&project={PID}&kind=pages", wait_until="networkidle")
    page.get_by_test_id("made-new-document").click()
    page.get_by_test_id("made-new-document-form").wait_for(state="visible")
    check("pages-list-starts-on-web-page", page.get_by_test_id("doc-format").input_value() == "web",
          format=page.get_by_test_id("doc-format").input_value())

    # 2. It looks like a form.
    page.get_by_test_id("made-new-document-seats").wait_for(state="visible")
    name = page.evaluate(STYLE, '[data-testid="made-new-document-name"]')
    brief = page.evaluate(STYLE, '[data-testid="made-new-document-brief"]')
    fmt = page.evaluate(STYLE, '[data-testid="doc-format"]')
    mono = page.evaluate("""() => [...document.querySelectorAll('[data-testid="made-new-document-form"] *')]
      .filter((e) => e.childElementCount === 0 && e.textContent.trim() !== '' && /mono/i.test(getComputedStyle(e).fontFamily))
      .map((e) => e.textContent.trim().slice(0, 40))""")
    off = page.evaluate(STYLE, '[data-testid="made-new-document-create"]')
    check("name-is-a-field", name["border"] >= 1 and name["h"] >= 28 and name["borderStyle"] == "solid", name=name)
    check("one-face", fmt["font"] == brief["font"] and mono == [], format=fmt["font"], brief=brief["font"], mono=mono)
    page.get_by_test_id("made-new-document-brief").fill("A landing page for the tip splitter")
    page.get_by_test_id("made-new-document-name").fill(DOC)
    page.wait_for_function("() => !document.querySelector('[data-testid=\"made-new-document-create\"]').disabled")
    on = page.evaluate(STYLE, '[data-testid="made-new-document-create"]')
    check("disabled-create-looks-disabled", off["disabled"] and off["borderStyle"] == "dashed" and on["borderStyle"] == "solid"
          and off["bg"] != on["bg"], disabled=off, enabled=on)

    # 3. One helper is not enough.
    pressed = page.eval_on_selector_all('[data-testid="made-new-document-seat"][aria-pressed="true"]', "els => els.map(e => e.dataset.seat)")
    check("two-helpers-by-default", len(pressed) >= 2, pressed=pressed)
    for seat in pressed[1:]:
        page.locator(f'[data-testid="made-new-document-seat"][data-seat="{seat}"]').click()
    line = page.get_by_test_id("made-new-document-council").inner_text()
    check("one-helper-refused", page.get_by_test_id("made-new-document-create").is_disabled()
          and "Add a second helper: one writes the document and another checks it." in line, line=line)
    shoot(page, "form")
    page.locator(f'[data-testid="made-new-document-seat"][data-seat="{pressed[1]}"]').click()

    # 4. Create lands on Pages with the page open; the draft is being written.
    page.get_by_test_id("made-new-document-create").click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('open') !== null")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    sent = [s.get("key") for s in json.loads(json.loads(creates[0] or "{}").get("clisJson") or "[]")] if creates else None
    check("create-sends-two-helpers", sent == pressed[:2], sent=sent)
    check("lands-on-pages", q.get("kind") == ["pages"] and q.get("open") == [DOC], query=q)
    status = page.get_by_test_id("made-draft-status")
    status.wait_for(state="visible")
    check("says-being-written", status.get_attribute("data-state") == "writing"
          and "This page is being written" in status.inner_text()
          and page.get_by_test_id("made-draft-run").inner_text() == "Watch it being written", text=status.inner_text())
    shoot(page, "writing")
    page.get_by_test_id("made-draft-run").click()
    page.wait_for_url("**/s/**r-doc-bound**")
    check("link-opens-the-run", "r-doc-bound" in urllib.parse.unquote(page.url), url=page.url)

    # 5. The draft fails: the page says it stopped, and why.
    set_fixture(origin, doc_bound_run={"pid": PID, "doc": DOC, "status": "failed",
                                       "error": "plan refused: evaluator≠creator unsatisfiable: no seat distinct from the creator (claude)"})
    page.goto(f"{origin}/everything?tab=made&project={PID}&kind=pages&open={DOC}", wait_until="networkidle")
    status.wait_for(state="visible")
    page.wait_for_function("() => document.querySelector('[data-testid=\"made-draft-status\"]')?.dataset.state === 'stopped' && /check/.test(document.querySelector('[data-testid=\"made-draft-line\"]').textContent)")
    text = page.get_by_test_id("made-draft-line").inner_text()
    check("says-stopped-and-why", text.startswith("The draft stopped before it wrote a first version.")
          and "No second helper could check the work" in text and "≠" not in text
          and page.get_by_test_id("made-draft-run").inner_text() == "Open the run", text=text)
    shoot(page, "stopped")
    browser.close()

check("no-page-errors", errors == [], errors=errors[:3])
report["ok"] = True
print(json.dumps(report, indent=2))
