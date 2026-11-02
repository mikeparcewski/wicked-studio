#!/usr/bin/env python3
"""
desk_working_doc_test.py — the run's WORKING DOCUMENT in the Phase report section of the run's Details panel (DES-LEARN
§1.2: the phase report moved there from the thread), and steering from it (power mode spike 3). Against the `run_page` corpus with `run_plugin` (r-rerun-mid's trail) and `working_doc` (crew's working-doc
routes, in memory). `/ws` is played by the journey.

  1. OPEN (a live run's section is), the section shows the dashboard and then the Working document: six sections, the note "Edits steer the
     next step. They can raise rigor, never lower it.", Goal waiting to be started.
  2. A PERSON'S EDIT: click Constraints and steering, type, press Save (a real click in the frame). crew is sent
     `author: 'operator'` with the plugin as the surface; the trail reads "v1 · You · Constraints and steering · …
     · waiting for the next step"; the thread shows "You edited the working document · Constraints · waiting for the
     next step". A Save by keyboard (Cmd/Ctrl+Enter) is a person's too.
  1b. FILLED FROM EVENTS: before any document exists, the block shows the plugin's own line under Open questions
     ("Waiting on you · …", marked not saved yet) and writes nothing. Once a person's edit starts the document, the
     plugin saves it as itself: "Phase report (plugin) · Open questions · … · not sent to a step".
  3. THE PLUGIN'S OWN LINE: a decision answered live adds its line under Decisions and takes its question back, sent as
     `author: 'plugin'` and shown in the trail as "Phase report (plugin)", never as You.
  4. PICKED UP: the next step picks the note up (crew's workingDocChanged on /ws): the trail and the thread row say
     "picked up at Review".
  5. PINNED (to the top of the panel) AND OPEN: the document is there too. PHONE (390x844): the Details overlay holds
     it and the editor fits the width. An OLDER SERVICE (no
     working-doc routes): the block says it keeps no working document, and nothing is written. 0 page errors.

Captures: e2e/shots/desk-working-doc-*.png. Env: FEEDBACK_PORT (default 4662).
"""

import json
import os
import re
import sys
import time
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4662"))
SHOTS = REPO / "e2e" / "shots"
RUN = "r-rerun-mid"
BLOCK = '[data-testid="run-tab"] [data-testid="run-plugin"]'

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


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

errors: list[str] = []
version_posts: list[dict] = []
sockets: list = []


def post(path: str, body: dict) -> None:
    req = urllib.request.Request(f"{origin}{path}", method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        res.read()


def new_page(browser, w: int, h: int, theme: str = "light", working_doc: bool = True):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: version_posts.append(json.loads(r.post_data or "{}")) if r.method == "POST" and r.url.endswith(f"/runs/{RUN}/working-doc/versions") else None)
    page.route_web_socket("**/ws", lambda ws: sockets.append(ws))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, run_page=True, run_plugin=True, working_doc=working_doc, reset_working_doc=True)
    return ctx, page


def frame(page):
    return page.frame_locator(f"{BLOCK} iframe").first


def ensure_open(page) -> None:
    """The section open (a live run's opens by itself; a remembered fold is undone)."""
    if page.locator(BLOCK).first.get_attribute("data-open") != "true":
        page.locator(f'{BLOCK} [data-testid="run-plugin-fold"]').first.click()


def open_expanded(page) -> None:
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="domcontentloaded")
    try:
        page.locator(BLOCK).first.wait_for(state="attached", timeout=20000)
    except Exception:  # noqa: BLE001
        fail("mount", {"why": "the panel section never showed"})
    # A phone: the Details panel is an overlay, opened from its handle.
    if page.viewport_size["width"] < 1200:
        page.get_by_test_id("run-details-handle").click()
        page.wait_for_timeout(600)
    ensure_open(page)
    try:
        frame(page).locator("#wd .wd-sec").first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        fail("doc", {"why": "the working document never showed in the unfolded block"})
    page.wait_for_timeout(500)


def trail(page) -> list[str]:
    return frame(page).locator(".wd-trail li").all_inner_texts()


def wait_trail(page, pred, ms: int = 8000) -> list[str]:
    t0 = time.monotonic()
    lines: list[str] = []
    while (time.monotonic() - t0) * 1000 < ms:
        lines = trail(page)
        if pred(lines):
            return lines
        page.wait_for_timeout(150)
    return lines


def send(frames: list[dict]) -> None:
    for f in frames:
        sockets[-1].send(json.dumps({**f, "session": RUN}))


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = new_page(browser, 1440, 900)
    open_expanded(page)

    # ── 1. the document under the dashboard ──────────────────────────────────────────────────────────
    f = frame(page)
    labels = f.locator(".wd-sec h4").all_inner_texts()
    note = f.locator(".wd-note").inner_text()
    order = f.locator("main").evaluate("(m) => { const d = m.querySelector('#dash'), w = m.querySelector('#wd'); return !!(d.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING); }")
    check("1-document", [l.split("\n")[0].upper() for l in labels] == ["GOAL", "APPROACH", "DECISIONS", "CONSTRAINTS AND STEERING", "OPEN QUESTIONS", "NEXT AND TRAILING WORK"]
          and note == "Edits steer the next step. They can raise rigor, never lower it." and order, labels=labels, note=note)

    # ── 1b. filled from the run's events: what waits on a person, by the plugin, before any document exists ─────
    gen = f.locator('.wd-sec[data-section="questions"] .wd-gen').all_inner_texts()
    q_head = f.locator('.wd-sec[data-section="questions"] h4').inner_text()
    check("1b-filled", len(gen) == 1 and gen[0].startswith("Waiting on you · ") and "Phase report (plugin)" in q_head
          and not version_posts, shown=gen, head=q_head, posts=version_posts)

    # ── 2. a person's edit, saved by their own click ─────────────────────────────────────────────────
    f.locator('.wd-sec[data-section="constraints"] .wd-text').click()
    f.locator('.wd-sec[data-section="constraints"] textarea').fill("Keep /v1/invoice.pdf working: the mobile app calls it.")
    f.locator('.wd-sec[data-section="constraints"] button.primary').click()
    you = lambda section: re.compile(rf"^v\d+ · You · {section}")  # noqa: E731
    lines = wait_trail(page, lambda ls: any(you("Constraints and steering").match(l) for l in ls))
    page.wait_for_timeout(300)
    row = page.locator('[data-testid="working-doc-steer"]').all_inner_texts()
    first = next((x for x in version_posts if x.get("author") == "operator"), {})
    check("2-person-edit", any(you("Constraints and steering").match(l) and l.endswith("waiting for the next step") for l in lines)
          and first.get("author") == "operator" and first.get("plugin", {}).get("id") == "wicked-phase-report" and first.get("base") == 0
          and row == ["You edited the working document · Constraints · waiting for the next step"],
          trail=lines, post=first, rows=row)
    page.locator(BLOCK).first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-working-doc-edited-1440.png"))

    # The person's edit started the document: the plugin's line is saved now, as itself, and never steers.
    lines = wait_trail(page, lambda ls: any("Phase report (plugin) · Open questions" in l for l in ls))
    q_post = next((x for x in version_posts if x.get("author") == "plugin" and "questions" in x.get("sections", {})), {})
    saved_q = f.locator('.wd-sec[data-section="questions"] .wd-text').inner_text()
    check("2a-plugin-saved", any("Phase report (plugin) · Open questions" in l and l.endswith("not sent to a step") for l in lines)
          and list(q_post.get("sections", {}).keys()) == ["questions"] and saved_q.startswith("Waiting on you · ")
          and f.locator('.wd-sec[data-section="questions"] .wd-gen').count() == 0, trail=lines, post=q_post, questions=saved_q)

    # Cmd/Ctrl+Enter saves too (a key in the frame is the person's gesture).
    f.locator('.wd-sec[data-section="next"] .wd-text').click()
    f.locator('.wd-sec[data-section="next"] textarea').fill("Add GBP and JPY tests.")
    f.locator('.wd-sec[data-section="next"] textarea').press("Control+Enter")
    lines = wait_trail(page, lambda ls: any(you("Next and trailing work").match(l) for l in ls))
    check("2b-keyboard-save", any(you("Next and trailing work").match(l) for l in lines) and version_posts[-1].get("author") == "operator", trail=lines)

    # Long text (120 lines) stays reachable: the section scrolls in its own box, and every later section and the
    # trail can still be reached (the frame has a height cap).
    f.locator('.wd-sec[data-section="approach"] .wd-text').click()
    f.locator('.wd-sec[data-section="approach"] textarea').fill("\n".join(f"line {i}" for i in range(1, 121)))
    f.locator('.wd-sec[data-section="approach"] button.primary').click()
    wait_trail(page, lambda ls: any(you("Approach").match(l) for l in ls))
    box = f.locator('.wd-sec[data-section="approach"] .wd-text').evaluate("(e) => ({ sh: e.scrollHeight, ch: e.clientHeight, last: e.textContent.trim().endsWith('line 120') })")
    f.locator('.wd-trail').scroll_into_view_if_needed()
    reach = f.locator('main').evaluate("""() => { const t = document.querySelector('.wd-trail').getBoundingClientRect();
      const n = document.querySelector('.wd-sec[data-section="next"] .wd-text').getBoundingClientRect();
      return { trailVisible: t.bottom <= innerHeight + 1 && t.top >= -1, nextHeight: Math.round(n.height), docHeight: document.documentElement.scrollHeight, frameHeight: innerHeight }; }""")
    check("2c-long-text", box["sh"] > box["ch"] and box["last"] and reach["trailVisible"] and reach["nextHeight"] > 0, box=box, reach=reach)

    # ── 3. the plugin's own line under Decisions ─────────────────────────────────────────────────────
    if not sockets:
        fail("3-plugin-line", {"why": "studio opened no /ws"})
    send([{"type": "resumed", "ord": 6}, {"type": "unitDone", "ord": 6}, {"type": "unitExecuting", "ord": 7}])
    lines = wait_trail(page, lambda ls: any("Phase report (plugin) · Decisions" in l for l in ls))
    page.wait_for_timeout(600)
    lines = trail(page)
    plugin_post = next((x for x in version_posts if x.get("author") == "plugin" and "decisions" in x.get("sections", {})), {})
    decisions = f.locator('.wd-sec[data-section="decisions"] .wd-text').inner_text()
    questions = f.locator('.wd-sec[data-section="questions"] .wd-text').inner_text()
    check("3-plugin-line", any(re.match(r"^v\d+ · Phase report \(plugin\) · Decisions", l) for l in lines)
          and list(plugin_post.get("sections", {}).keys()) == ["decisions"] and "answered" in decisions
          and "Waiting on you" not in questions
          and not any("You · Decisions" in l for l in lines), trail=lines, post=plugin_post, decisions=decisions, questions=questions)

    # ── 4. picked up by the next step ────────────────────────────────────────────────────────────────
    post("/__fixture/working-doc-pickup", {"runId": RUN, "ord": 7, "step": "review"})
    send([{"type": "workingDocChanged", "head": 4}])
    lines = wait_trail(page, lambda ls: any("picked up at Review" in l for l in ls))
    page.wait_for_timeout(400)
    rows = page.locator('[data-testid="working-doc-steer"]').all_inner_texts()
    check("4-picked-up", any(you("Approach").match(l) and "picked up at Review" in l for l in lines)
          and "You edited the working document · Approach · picked up at Review" in rows, trail=lines, rows=rows)
    page.locator(BLOCK).first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-working-doc-picked-1440.png"))

    # ── 5a. pinned and expanded ──────────────────────────────────────────────────────────────────────
    page.locator(f'{BLOCK} [data-testid="run-plugin-pin"]').first.click()
    page.wait_for_timeout(800)
    ensure_open(page)
    frame(page).locator("#wd .wd-sec").first.wait_for(state="visible", timeout=15000)
    pinned_doc = frame(page).locator(".wd-sec").count()
    page.screenshot(path=str(SHOTS / "desk-working-doc-pinned-1440.png"))
    check("5a-pinned-expanded", page.locator(BLOCK).first.get_attribute("data-pinned") == "true" and pinned_doc == 6, sections=pinned_doc)
    page.locator(f'{BLOCK} [data-testid="run-plugin-pin"]').first.click()
    ctx.close()

    # ── 5b. phone ────────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844, theme="dark")
    open_expanded(page)
    frame(page).locator('.wd-sec[data-section="approach"] .wd-text').click()
    page.wait_for_timeout(300)
    phone = page.evaluate("""() => { const b = document.querySelector('[data-testid="run-tab"] [data-testid="run-plugin"]').getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), vw: innerWidth, hscroll: document.documentElement.scrollWidth > innerWidth }; }""")
    ta = frame(page).locator('.wd-sec[data-section="approach"] textarea').evaluate("(t) => ({ w: Math.round(t.getBoundingClientRect().width), vw: document.documentElement.clientWidth })")
    frame(page).locator('.wd-sec[data-section="approach"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-working-doc-390.png"))
    check("5b-phone", phone["left"] >= 0 and phone["right"] <= phone["vw"] and not phone["hscroll"] and ta["w"] <= ta["vw"], phone=phone, textarea=ta)
    ctx.close()

    # ── 5c. an older service ─────────────────────────────────────────────────────────────────────────
    n_before = len(version_posts)
    ctx, page = new_page(browser, 1440, 900, working_doc=False)
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="domcontentloaded")
    page.locator(BLOCK).first.wait_for(state="attached", timeout=20000)
    ensure_open(page)
    frame(page).locator("#wd").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    said = frame(page).locator("#wd").inner_text()
    check("5c-older-service", "keeps no working document" in said and len(version_posts) == n_before, said=said[:200])
    ctx.close()
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
