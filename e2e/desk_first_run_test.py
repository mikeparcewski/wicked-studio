#!/usr/bin/env python3
"""
desk_first_run_test.py — the first run (program DES-LEARN §4; mockup learn-and-panels state d), at 1440x900 and
390x844, on the in-process fixture with no jobs yet (a new install). /setup/known and /persona (crew 0.157) are
answered in the page; every write is recorded.

  1. Home opens on the first run: "What we already know" from the reads (git identity, repositories with the
     nearby ones, agents, languages), then the first ask; "Your setup" lists the six rows.
  2. Each ask, answered, collapses to its record line and fills its row: repositories (a nearby one is
     registered over POST /repos), the second agent (Later), style (Later), rules (POST /governance/rules per
     starter kept), personality (PUT /persona, then Learn sits below Evaluate), brand (Keep studio's).
  3. All six answered, Home is Home again (its ask box), and stays so on reload.
  4. Ignore setup (a fresh state): one line with Undo; Undo brings the flow back; ignored, a reload shows Home.
  5. On a phone the ask being answered is a bottom sheet (fixed to the foot of the screen).
  6. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-first-run-{1440,390}.png. Env: FEEDBACK_PORT (default 4562).
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4562"))
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


def fail(step, why):
    report["steps"][step] = {"ok": False, "error": str(why)}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step, ok, **detail):
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(fail)
origin = start_server(PORT, dist)
from playwright.sync_api import sync_playwright  # noqa: E402

sent: list = []
KNOWN = {"git": {"name": "Sam Rivera", "email": "sam@acme.dev"},
         "languages": [{"name": "TypeScript", "files": 62, "share": 0.62}, {"name": "Go", "files": 38, "share": 0.38}],
         "filesCounted": 100, "nearby": [{"name": "handbook", "path": "/home/sam/code/handbook"}]}


def body(r):
    try:
        return json.loads(r.request.post_data or "null")
    except Exception:
        return None


def give(r, obj):
    r.fulfill(status=200, content_type="application/json", body=json.dumps(obj))


def handle(r):
    req = r.request
    path = req.url.split("/api/v1", 1)[1].split("?")[0]
    m = req.method
    if m != "GET" and path != "/settings":
        sent.append({"m": m, "path": path, "body": body(r)})
    if path == "/setup/known":
        return give(r, KNOWN)
    if path == "/persona":
        if m == "PUT":
            b = body(r)
            return give(r, {"scope": "user", "persona": {**b["persona"], "version": 1, "updatedAt": 1}, "voice": ""})
        return give(r, {"user": None, "projects": {}, "voice": {"user": None, "projects": {}}})
    if path == "/repos" and m == "POST":
        return give(r, {"repo": {"id": "r-hb", "name": "handbook"}, "onboardRunId": None})
    if path == "/governance/rules" and m == "POST":
        return give(r, {"status": "ok"})
    r.continue_()


def answer(page, key, pick=None, choose=None):
    ask = page.get_by_test_id(f"first-run-ask-{key}")
    ask.wait_for(timeout=20000)
    if pick is not None:
        for i in pick:
            ask.get_by_test_id("ask-option").nth(i).click()
        ask.get_by_test_id("ask-confirm").click()
    else:
        opt = ask.locator(f'[data-ask-option="{choose}"]')
        opt.click()
        if ask.get_by_test_id("ask-confirm").count() > 0:
            ask.get_by_test_id("ask-confirm").click()
    page.get_by_test_id(f"first-run-record-{key}").wait_for(timeout=20000)
    return page.get_by_test_id(f"first-run-record-{key}").inner_text()


def fresh(page):
    page.evaluate("""() => fetch('/api/v1/settings', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({'studio.firstRun': {}})})""")


errors: list = []
NO_HSCROLL = "document.documentElement.scrollWidth <= window.innerWidth + 1"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    for (w, h) in [(1440, 900), (390, 844)]:
        set_fixture(origin, no_runs=True, appearance=dict(DEFAULT_APPEARANCE))
        sent.clear()
        ctx = b.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.route("**/api/v1/**", handle)
        page.add_init_script(f"document.addEventListener('DOMContentLoaded', () => {{ const s = document.createElement('style'); s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }})")
        page.goto(f"{origin}/learn", wait_until="domcontentloaded")
        fresh(page)
        page.goto(f"{origin}/", wait_until="domcontentloaded")
        page.get_by_test_id("first-run").wait_for(timeout=30000)
        page.get_by_test_id("first-run-ask-repos").wait_for(timeout=30000)
        known = {k: page.get_by_test_id(f"known-{k}").inner_text() for k in ("repos", "git", "agents", "languages")}
        check(f"1-known-{w}", "Sam Rivera" in known["git"] and "nearby" in known["repos"] and "TypeScript" in known["languages"] and "agent" in known["agents"], known=known)
        rows = page.get_by_test_id("first-run-row").evaluate_all("els => els.map((e) => e.dataset.k)")
        check(f"1b-setup-rows-{w}", rows == ["repos", "agents", "style", "rules", "persona", "brand"], rows=rows)
        if w < 800:
            pos = page.get_by_test_id("first-run-live").evaluate("e => getComputedStyle(e).position")
            box = page.get_by_test_id("first-run-live").bounding_box()
            check("5-phone-sheet", pos == "fixed" and box is not None and abs((box["y"] + box["height"]) - h) <= 2, position=pos, box=box)
        page.screenshot(path=str(SHOTS / f"desk-first-run-{w}.png"))
        # 2. The asks
        opts = page.get_by_test_id("first-run-ask-repos").get_by_test_id("ask-option").all_inner_texts()
        near = next((i for i, t in enumerate(opts) if "handbook" in t), None)
        if near is None:
            fail(f"2a-repos-{w}", f"no nearby option in {opts}")
        line = answer(page, "repos", pick=[near])
        reg = [s["body"] for s in sent if s["path"] == "/repos"]
        check(f"2a-repos-{w}", reg == [{"name": "handbook", "rootPath": "/home/sam/code/handbook"}] and line.startswith("You picked:"), line=line, reg=reg)
        row = page.locator('[data-testid="first-run-row"][data-k="repos"]').get_attribute("data-done")
        check(f"2a-row-{w}", row == "true", row=row)
        answer(page, "agents", choose="no")
        answer(page, "style", choose="later")
        line = answer(page, "rules", pick=[])
        posted = [s["body"]["id"] for s in sent if s["path"] == "/governance/rules"]
        check(f"2b-rules-{w}", posted == ["learn-small-prs", "learn-tests-with-fixes"], posted=posted, line=line)
        answer(page, "persona", choose="guide")
        put = [s["body"] for s in sent if s["path"] == "/persona"]
        check(f"2c-persona-{w}", len(put) == 1 and put[0]["persona"]["dials"]["warmth"] == 2)
        if w > 1000:
            page.wait_for_function("() => [...document.querySelectorAll('[data-testid=\"rail-nav-insight\"] a')].some((a) => a.dataset.testid === 'nav-learn')", timeout=15000)
        # The last answer hands Home back at once: its ask box is the next step (§4.3).
        brand = page.get_by_test_id("first-run-ask-brand")
        brand.wait_for(timeout=20000)
        brand.locator('[data-ask-option="no"]').click()
        # 3. Home again
        page.get_by_test_id("desk-ask").wait_for(timeout=20000)
        check(f"3-home-{w}", page.get_by_test_id("first-run-flow").count() == 0)
        page.reload(wait_until="domcontentloaded")
        page.get_by_test_id("desk-ask").wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        check(f"3b-home-stays-{w}", page.get_by_test_id("first-run-flow").count() == 0)
        # 4. Ignore / Undo / stays ignored
        fresh(page)
        page.reload(wait_until="domcontentloaded")
        page.get_by_test_id("first-run-ignore").click()
        page.get_by_test_id("first-run-hidden").wait_for(timeout=15000)
        page.get_by_test_id("first-run-undo").click()
        page.get_by_test_id("first-run-flow").wait_for(timeout=15000)
        page.get_by_test_id("first-run-ignore").click()
        page.get_by_test_id("first-run-hidden").wait_for(timeout=15000)
        page.wait_for_timeout(800)
        page.reload(wait_until="domcontentloaded")
        page.get_by_test_id("desk-ask").wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        check(f"4-ignored-stays-{w}", page.get_by_test_id("first-run").count() == 0)
        check(f"6-no-hscroll-{w}", page.evaluate(NO_HSCROLL))
        ctx.close()
    set_fixture(origin, no_runs=False)
    b.close()

check("6-no-page-errors", len(errors) == 0, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
