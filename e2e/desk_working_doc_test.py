#!/usr/bin/env python3
"""
desk_working_doc_test.py — the run's WORKING DOCUMENT in the Phase report block, and steering from it (power mode
spike 3). Against the `run_page` corpus with `run_plugin` (r-rerun-mid's trail) and `working_doc` (crew's working-doc
routes, in memory). `/ws` is played by the journey.

  1. UNFOLDED, the block shows the dashboard and then the Working document: six sections, the note "Edits steer the
     next step. They can raise rigor, never lower it.", Goal waiting to be started.
  2. A PERSON'S EDIT: click Constraints and steering, type, press Save (a real click in the frame). crew is sent
     `author: 'operator'` with the plugin as the surface; the trail reads "v1 · You · Constraints and steering · …
     · waiting for the next step"; the thread shows "You edited the working document · Constraints · waiting for the
     next step". A Save by keyboard (Cmd/Ctrl+Enter) is a person's too.
  3. THE PLUGIN'S OWN LINE: a decision answered live adds its line under Decisions, sent as `author: 'plugin'` and
     shown in the trail as "Phase report (plugin)", never as You.
  4. PICKED UP: the next step picks the note up (crew's workingDocChanged on /ws): the trail and the thread row say
     "picked up at Review".
  5. PINNED AND EXPANDED: the document is there too. PHONE (390x844): the editor fits the width. An OLDER SERVICE (no
     working-doc routes): the block says it keeps no working document, and nothing is written. 0 page errors.

Captures: e2e/shots/desk-working-doc-*.png. Env: FEEDBACK_PORT (default 4662).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4662"))
SHOTS = REPO / "e2e" / "shots"
RUN = "r-rerun-mid"
BLOCK = '[data-testid="run-plugin"]'

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


def open_expanded(page) -> None:
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="domcontentloaded")
    try:
        page.locator(BLOCK).first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        fail("mount", {"why": "the run-thread block never showed"})
    page.locator('[data-testid="run-plugin-fold"]').first.click()
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

    # ── 2. a person's edit, saved by their own click ─────────────────────────────────────────────────
    f.locator('.wd-sec[data-section="constraints"] .wd-text').click()
    f.locator('.wd-sec[data-section="constraints"] textarea').fill("Keep /v1/invoice.pdf working: the mobile app calls it.")
    f.locator('.wd-sec[data-section="constraints"] button.primary').click()
    lines = wait_trail(page, lambda ls: any(l.startswith("v1 · You · Constraints and steering") for l in ls))
    page.wait_for_timeout(300)
    row = page.locator('[data-testid="working-doc-steer"]').all_inner_texts()
    first = version_posts[0] if version_posts else {}
    check("2-person-edit", any(l.startswith("v1 · You · Constraints and steering") and l.endswith("waiting for the next step") for l in lines)
          and first.get("author") == "operator" and first.get("plugin", {}).get("id") == "wicked-phase-report" and first.get("base") == 0
          and row == ["You edited the working document · Constraints · waiting for the next step"],
          trail=lines, post=first, rows=row)
    page.locator(BLOCK).first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-working-doc-edited-1440.png"))

    # Cmd/Ctrl+Enter saves too (a key in the frame is the person's gesture).
    f.locator('.wd-sec[data-section="next"] .wd-text').click()
    f.locator('.wd-sec[data-section="next"] textarea').fill("Add GBP and JPY tests.")
    f.locator('.wd-sec[data-section="next"] textarea').press("Control+Enter")
    lines = wait_trail(page, lambda ls: any(l.startswith("v2 · You · Next and trailing work") for l in ls))
    check("2b-keyboard-save", any(l.startswith("v2 · You · Next and trailing work") for l in lines) and version_posts[-1].get("author") == "operator", trail=lines)

    # ── 3. the plugin's own line under Decisions ─────────────────────────────────────────────────────
    if not sockets:
        fail("3-plugin-line", {"why": "studio opened no /ws"})
    send([{"type": "resumed", "ord": 6}, {"type": "unitDone", "ord": 6}, {"type": "unitExecuting", "ord": 7}])
    lines = wait_trail(page, lambda ls: any("Phase report (plugin) · Decisions" in l for l in ls))
    plugin_post = next((x for x in version_posts if x.get("author") == "plugin"), {})
    decisions = f.locator('.wd-sec[data-section="decisions"] .wd-text').inner_text()
    check("3-plugin-line", any(l.startswith("v3 · Phase report (plugin) · Decisions") for l in lines)
          and list(plugin_post.get("sections", {}).keys()) == ["decisions"] and "answered" in decisions
          and not any("You · Decisions" in l for l in lines), trail=lines, post=plugin_post, decisions=decisions)

    # ── 4. picked up by the next step ────────────────────────────────────────────────────────────────
    post("/__fixture/working-doc-pickup", {"runId": RUN, "ord": 7, "step": "review"})
    send([{"type": "workingDocChanged", "head": 3}])
    lines = wait_trail(page, lambda ls: any("picked up at Review" in l for l in ls))
    page.wait_for_timeout(400)
    rows = page.locator('[data-testid="working-doc-steer"]').all_inner_texts()
    check("4-picked-up", any(l.startswith("v2 · You · Next and trailing work") and "picked up at Review" in l for l in lines)
          and "You edited the working document · Next work · picked up at Review" in rows, trail=lines, rows=rows)
    page.locator(BLOCK).first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-working-doc-picked-1440.png"))

    # ── 5a. pinned and expanded ──────────────────────────────────────────────────────────────────────
    page.locator('[data-testid="run-plugin-pin"]').first.click()
    page.wait_for_timeout(800)
    page.locator('[data-testid="run-plugin-fold"]').first.click()
    frame(page).locator("#wd .wd-sec").first.wait_for(state="visible", timeout=15000)
    pinned_doc = frame(page).locator(".wd-sec").count()
    page.screenshot(path=str(SHOTS / "desk-working-doc-pinned-1440.png"))
    check("5a-pinned-expanded", page.locator(BLOCK).first.get_attribute("data-placement") == "pinned" and pinned_doc == 6, sections=pinned_doc)
    page.locator('[data-testid="run-plugin-pin"]').first.click()
    ctx.close()

    # ── 5b. phone ────────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844, theme="dark")
    open_expanded(page)
    frame(page).locator('.wd-sec[data-section="approach"] .wd-text').click()
    page.wait_for_timeout(300)
    phone = page.evaluate("""() => { const b = document.querySelector('[data-testid="run-plugin"]').getBoundingClientRect();
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
    page.locator(BLOCK).first.wait_for(state="visible", timeout=20000)
    page.locator('[data-testid="run-plugin-fold"]').first.click()
    frame(page).locator("#wd").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    said = frame(page).locator("#wd").inner_text()
    check("5c-older-service", "keeps no working document" in said and len(version_posts) == n_before, said=said[:200])
    ctx.close()
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
