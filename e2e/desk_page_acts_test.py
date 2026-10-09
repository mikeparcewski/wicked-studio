#!/usr/bin/env python3
"""
desk_page_acts_test.py — EP-P3: the `wicked-page` plugin's act-first verbs, device widths and the host's
checks panel (DES-EDITOR-PLUGINS-001 §7.1 R-a…R-d, §5.8, §12.4 J1) at 1440x700 on the Desk.

Against the in-process fixture: the `launch-page` document (its theme as `--wi-*` colours, its parts in
`section-{i}` containers, as interactive renders a page) on project `notes`, a run bound to it, crew's
editor registry stand-in, and crew's checks read (EP-C2) serving four reviewers' verdicts.

  1. CHECKS: the pane shows the checks panel under the page — four reviewers (Intent, Accessibility,
     Copy, Quality), each with its state and who reviewed (independent or not, as recorded); a finding's
     "Point at it" puts a chip on the session composer in the HOST's words.
  2. WIDTHS: Phone / Tablet / Desktop set the width the page lays out at (the nested document's own
     `innerWidth` is 390 / 820 / 1280); the pressed width again lets the page fill the editor.
  3. SECTION: a picked heading's ⌥↑ picks its section; a second click on the picked element does too.
  4. RESTYLE: a fill swatch from the page's theme lands ONE version — the host's line "Restyled … ·
     Undo" — and the element wears the colour; Undo forks the page before it, the colour is gone.
  5. REMOVE: bare Backspace on a picked paragraph removes nothing; Ctrl+Backspace lands ONE version
     ("Removed …"), the paragraph is gone; Undo brings it back.
  6. A NARROW PANE (a 640 px window): a picked element's peek stays inside the editor.
  7. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-page-acts-*.png. Env: FEEDBACK_PORT (default 4362).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4362"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "launch-page"
RUN = "r-doc-bound"

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


def doc_check(cid: str, reviewer: str, source: str, state: str, sentence: str, seat: str, evaluator: bool, findings=None) -> dict:
    return {"id": cid, "source": source, "reviewer": reviewer, "version": 1, "state": state, "sentence": sentence,
            "findings": findings or [], "by": {"seat": seat, "evaluator": evaluator, "excluded_seats": ["claude"], "author_known": True},
            "skill": None, "run_id": f"r-review-{reviewer}", "at": "2026-10-04T07:00:00Z"}


CHECKS = [
    doc_check("c-intent", "match", "review:intent", "pass", "It says what the brief asked for.", "codex", True),
    doc_check("c-a11y", "a11y", "review:a11y", "fail", "One heading is too faint to read.", "pi", True,
              [{"wid": "slide-1-heading-1", "severity": "high", "sentence": "Contrast is under 4.5:1."}]),
    doc_check("c-copy", "copy", "review:copy", "pass", "Plain and short.", "agy", True),
    doc_check("c-qe", "qe", "review:quality", "inconclusive", "The reviewer could not open the page.", "claude", False),
]


dist = ensure_build(fail)
if not (dist / "editors" / "wicked-page" / "editor.json").is_file():
    fail("build", f"{dist} carries no editors/wicked-page/editor.json — rebuild it (vite.config.ts emits the editor bundles)")
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

PAGE_EDITOR = """() => { const e = document.querySelector('[data-testid="page-editor"]');
  return e ? { pickable: e.dataset.pickable, head: e.dataset.head, selected: e.dataset.selected, size: e.dataset.size, width: e.dataset.width } : null; }"""


def plugin_frame(page):
    for f in page.frames:
        if f.parent_frame == page.main_frame and "/api/v1/editors/" in f.url:
            return f
    return None


def page_doc(page):
    """The nested page frame (inside the plugin) that holds the page's sections."""
    for f in page.frames:
        if f == page.main_frame or f.parent_frame is None or f.parent_frame == page.main_frame:
            continue
        try:
            if f.evaluate("() => document.readyState !== 'loading' && !!document.querySelector('[data-wid=\"section-0\"]')"):
                return f
        except Exception:
            continue
    return None


def editor_state(page) -> dict:
    pf = plugin_frame(page)
    try:
        return pf.evaluate(PAGE_EDITOR) if pf is not None else {}
    except Exception:
        return {}


def wait_pickable(page, head: int) -> None:
    deadline = time.time() + 15
    last = None
    while time.time() < deadline:
        last = editor_state(page)
        if last and last.get("pickable") == "true" and last.get("head") == str(head):
            return
        page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / f"desk-page-acts-pickable-{head}-timeout.png"))
    fail("pickable", {"why": f"the plugin never became pickable at head {head}", "found": last})


def wait_line(page, kind: str, step: str, timeout_ms: int = 20000) -> str:
    try:
        page.wait_for_selector(f'[data-testid="page-line"][data-kind="{kind}"]', timeout=timeout_ms)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-page-acts-{step}-timeout.png"))
        found = page.evaluate("""() => { const l = document.querySelector('[data-testid="page-line"]');
          return { kind: l ? l.dataset.kind : null, text: l ? l.innerText : null }; }""")
        found["plugin"] = editor_state(page)
        fail(step, {"why": f"no page-line[data-kind={kind}] within {timeout_ms} ms", "found": found})
    return page.get_by_test_id("page-line").inner_text()


def in_doc(page, script: str, until=lambda v: v is not None, timeout_ms: int = 10000):
    """Evaluate in the newest nested page frame until `until(value)` — the frame reloads per version."""
    deadline = time.time() + timeout_ms / 1000
    last = None
    while time.time() < deadline:
        f = page_doc(page)
        if f is not None:
            try:
                last = f.evaluate(script)
            except Exception:
                last = None
            if until(last):
                return last
        page.wait_for_timeout(200)
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

    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DOC, "brief": "the launch page"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC}, extra_frames=[], editors=True,
                shell_csp=True, doc_checks={DOC: CHECKS})

    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.locator('[data-testid="plugin-artifact"][data-editor="wicked-page"]').wait_for(state="attached", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-page-acts-missing.png"))
        fail("open", {"why": "no wicked-page plugin in the run's block"})
    page.get_by_test_id("artifact-open").click()
    page.locator('[data-testid="artifact"][data-size="pane"]').wait_for(state="visible", timeout=8000)
    wait_pickable(page, 1)
    plugin = page.frame_locator('[data-testid="editor-frame"]')
    doc = plugin.frame_locator('[data-testid="page-frame"]')

    # ── 1. the checks panel: four reviewers, who reviewed, a finding pointed at ───────────
    panel = page.get_by_test_id("artifact-checks")
    try:
        panel.wait_for(state="visible", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-page-acts-checks-missing.png"))
        fail("checks", {"why": "no [data-testid=artifact-checks] under the page in the pane"})
    rows = page.evaluate("""() => [...document.querySelectorAll('[data-testid="artifact-check"]')].map(r => ({
      reviewer: r.dataset.reviewer, state: r.dataset.state,
      independent: r.querySelector('[data-testid="artifact-check-by"]').dataset.independent,
      by: r.querySelector('[data-testid="artifact-check-by"]').innerText }))""")
    summary = page.get_by_test_id("artifact-checks-summary").inner_text()
    page.screenshot(path=str(SHOTS / "desk-page-acts-checks.png"))
    page.get_by_test_id("artifact-check-point").first.click()
    page.wait_for_timeout(600)
    pointed = chips(page)
    check("checks",
          [r["reviewer"] for r in rows] == ["match", "a11y", "copy", "qe"]
          and [r["state"] for r in rows] == ["pass", "fail", "pass", "inconclusive"]
          and [r["independent"] for r in rows] == ["true", "true", "true", "false"]
          and "also wrote it" in rows[3]["by"]
          and summary.startswith("Checks · 2 pass · 1 asks for changes · 1 could not run")
          and any(c["kind"] == "about" and "How it works" in c["text"] for c in pointed),
          rows=rows, summary=summary, chips=pointed)

    # ── 2. widths: the page lays out at 390 / 820 / 1280; pressed again, it fills the editor ──
    widths = {}
    for w in (390, 820, 1280):
        plugin.locator(f'[data-testid="page-width"][data-width="{w}"]').click()
        widths[w] = in_doc(page, "() => window.innerWidth", until=lambda v, w=w: v == w, timeout_ms=5000)
    page.screenshot(path=str(SHOTS / "desk-page-acts-desktop-width.png"))
    plugin.locator('[data-testid="page-width"][data-width="1280"]').click()
    page.wait_for_timeout(300)
    fill = editor_state(page).get("width")
    fit = in_doc(page, "() => window.innerWidth", until=lambda v: isinstance(v, int) and v not in (390, 820, 1280), timeout_ms=5000)
    plugin.locator('[data-testid="page-width"][data-width="390"]').click()
    in_doc(page, "() => window.innerWidth", until=lambda v: v == 390, timeout_ms=5000)
    page.screenshot(path=str(SHOTS / "desk-page-acts-phone.png"))
    plugin.locator('[data-testid="page-width"][data-width="390"]').click()
    page.wait_for_timeout(300)
    check("widths", widths == {390: 390, 820: 820, 1280: 1280} and fill == "" and isinstance(fit, int) and fit not in (390, 820, 1280),
          widths=widths, fill=fill, fit=fit)

    # ── 3. section: ⌥↑, and a second click ───────────────────────────────────────────────
    wait_pickable(page, 1)
    doc.locator('[data-wid="slide-1-heading-1"]').click()
    page.wait_for_timeout(300)
    picked = editor_state(page).get("selected")
    page.keyboard.press("Alt+ArrowUp")
    page.wait_for_timeout(300)
    up = editor_state(page).get("selected")
    doc.locator('[data-wid="slide-0-paragraph-1"]').click()
    page.wait_for_timeout(300)
    doc.locator('[data-wid="slide-0-paragraph-1"]').click()
    page.wait_for_timeout(300)
    again = editor_state(page).get("selected")
    page.screenshot(path=str(SHOTS / "desk-page-acts-section.png"))
    check("section", picked == "slide-1-heading-1" and up == "section-1" and again == "section-0",
          picked=picked, alt_up=up, second_click=again)

    # ── 4. restyle: one version, the colour on the element; Undo takes it away ─────────────
    doc.locator('[data-wid="slide-0-heading-1"]').click()
    page.wait_for_timeout(300)
    swatches = plugin.locator('[data-testid="page-swatch"][data-prop="background"]').evaluate_all("bs => bs.map(b => b.dataset.value)")
    plugin.locator('[data-testid="page-swatch"][data-prop="background"][data-value="#e4572e"]').click()
    restyled = wait_line(page, "edited", "restyle")
    wait_pickable(page, 2)
    bg = in_doc(page, "() => getComputedStyle(document.querySelector('[data-wid=\"slide-0-heading-1\"]')).backgroundColor",
                until=lambda v: v == "rgb(228, 87, 46)")
    page.screenshot(path=str(SHOTS / "desk-page-acts-restyled.png"))
    page.get_by_test_id("page-undo").click()
    wait_line(page, "undone", "restyle-undo")
    wait_pickable(page, 3)
    bg_after = in_doc(page, "() => getComputedStyle(document.querySelector('[data-wid=\"slide-0-heading-1\"]')).backgroundColor",
                      until=lambda v: v is not None and v != "rgb(228, 87, 46)")
    check("restyle", swatches[:3] == ["#f4f1ea", "#fffdf7", "#1f3a5f"] and swatches[-1] == "revert-layer"
          and restyled.startswith("Restyled heading 1 — version 2.") and bg == "rgb(228, 87, 46)" and bg_after != "rgb(228, 87, 46)",
          swatches=swatches, line=restyled, bg=bg, bg_after_undo=bg_after)

    # ── 5. remove: bare Backspace never; Ctrl+Backspace once; Undo brings it back ───────────
    doc.locator('[data-wid="slide-2-paragraph-1"]').click()
    page.wait_for_timeout(300)
    page.keyboard.press("Backspace")
    page.keyboard.press("Delete")
    page.wait_for_timeout(1500)
    head_after_bare = editor_state(page).get("head")
    still = in_doc(page, "() => !!document.querySelector('[data-wid=\"slide-2-paragraph-1\"]')")
    page.keyboard.press("Control+Backspace")
    removed = wait_line(page, "edited", "remove")
    wait_pickable(page, 4)
    gone = in_doc(page, "() => !document.querySelector('[data-wid=\"slide-2-paragraph-1\"]')", until=lambda v: v is True)
    page.screenshot(path=str(SHOTS / "desk-page-acts-removed.png"))
    page.get_by_test_id("page-undo").click()
    wait_line(page, "undone", "remove-undo")
    wait_pickable(page, 5)
    back = in_doc(page, "() => !!document.querySelector('[data-wid=\"slide-2-paragraph-1\"]')", until=lambda v: v is True)
    check("remove", head_after_bare == "3" and still is True and removed.startswith("Removed paragraph 1 in section 3 — version 4.")
          and gone is True and back is True,
          head_after_bare=head_after_bare, still=still, line=removed, gone=gone, back=back)

    # ── 6. a narrow pane: the peek stays inside the editor (codex r1/r2) ──────────────────
    page.set_viewport_size({"width": 640, "height": 700})
    page.wait_for_timeout(600)
    wait_pickable(page, 5)
    doc.locator('[data-wid="slide-1-paragraph-2"]').click()
    page.wait_for_timeout(400)
    fit = plugin_frame(page).evaluate("""() => { const p = document.getElementById('peek'); const r = p.getBoundingClientRect();
      return { hidden: p.hidden, left: Math.round(r.left), right: Math.round(r.right), width: document.documentElement.clientWidth }; }""")
    page.screenshot(path=str(SHOTS / "desk-page-acts-narrow-peek.png"))
    page.set_viewport_size({"width": W, "height": H})
    page.wait_for_timeout(400)
    check("peek-fits", fit is not None and fit["hidden"] is False and fit["left"] >= 0 and fit["right"] <= fit["width"], peek=fit)

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors, overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
