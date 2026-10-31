#!/usr/bin/env python3
"""
desk_learn_test.py — Learn (program DES-LEARN §3; the operator-approved mockup learn-and-panels state c), at
1440x900 and 390x844, on the in-process fixture. The routes crew 0.157 adds (persona, steering draft) and the
learning jobs are answered in the page (page.route), every write recorded, so the journey proves what is SENT:

  1. The rail: Learn is first in Work, above Projects, marked "Start here", while studio.firstRun says unused.
  2. /learn has four tabs: Style, Rules, Personality, Brand.
  3. Personality: a dial re-answers the preview; Save sends PUT /persona {scope:user}; Learn then sits below
     Evaluate in the rail, unmarked (studio.firstRun.learnUsedAt was written through PUT /settings).
  4. Rules: picking a starter POSTs a real steering rule (ui provenance, learn:starter).
  5. Style: a link and a repository become sources; Learn my style starts a steering-author job and a
     capture-learnings job with the style lens; the four stations follow the jobs; the review is two
     pick-several asks; keep sends approve / reject per memory and the propose gate's keepRules.
  6. Brand holds "Learn from a brand"; Settings → Theme links to it.
  7. 0 page errors; no horizontal scroll at either size.

Captures: e2e/shots/desk-learn-{style,persona,rules}-{1440,390}.png. Env: FEEDBACK_PORT (default 4561).
"""

import json
import os
import sys
import time

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4561"))
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

NOW = int(time.time())
sent: list = []
persona = {"user": None, "projects": {}, "voice": {"user": None, "projects": {}}}
rules: list = []
runs = {}
MEMS = [{"id": "m1", "kind_type": "memory", "payload": {"content": "Tests sit beside the code as *.test.ts."}, "facets": {}, "provenance": {"run_id": "j-repo"}, "state": "pending", "created_at": NOW},
        {"id": "m2", "kind_type": "memory", "payload": {"content": "Commits are imperative, area first."}, "facets": {}, "provenance": {"run_id": "j-repo"}, "state": "pending", "created_at": NOW}]
DRAFT = [{"id": f"POL-01{i}", "rule_type": "policy", "statement": s, "severity": "warn", "confidence": 0.9, "targets": {}, "provenance": {"source": "chat", "source_kinds": []}, "steering_type": "development"}
         for i, s in enumerate(["Every pull request links an issue.", "Branches are named type/short-slug."])]


def body(r):
    try:
        return json.loads(r.request.post_data or "null")
    except Exception:
        return None


def give(r, obj, status=200):
    r.fulfill(status=status, content_type="application/json", body=json.dumps(obj))


def handle(r):
    req = r.request
    path = req.url.split("/api/v1", 1)[1].split("?")[0]
    m = req.method
    if m != "GET":
        sent.append({"m": m, "path": path, "body": body(r)})
    if path == "/persona":
        if m == "PUT":
            b = body(r)
            p = {**b["persona"], "version": 1, "updatedAt": NOW}
            persona["user"] = p
            persona["voice"]["user"] = "## Voice"
            return give(r, {"scope": "user", "persona": p, "voice": "## Voice"})
        return give(r, persona)
    if path == "/setup/known":
        return give(r, {"git": {"name": "Sam Rivera", "email": "sam@acme.dev"}, "languages": [], "filesCounted": 0, "nearby": []})
    if path == "/governance/rules":
        if m == "POST":
            rules.append(body(r))
            return give(r, {"status": "ok"})
        return give(r, {"rules": rules})
    if path == "/governance/steering/author" and m == "POST":
        runs["j-rules"] = "executing"
        return give(r, {"runId": "j-rules"})
    if path == "/runs" and m == "POST":
        runs["j-repo"] = "executing"
        return give(r, {"runId": "j-repo"})
    if path in ("/runs/j-rules", "/runs/j-repo"):
        rid = path.split("/")[-1]
        st = runs.get(rid, "executing")
        units = [{"id": f"{rid}:analyze", "ord": 1}, {"id": f"{rid}:propose", "ord": 2}] if rid == "j-rules" else [{"id": "a", "ord": 1}, {"id": "b", "ord": 2}, {"id": "c", "ord": 3}]
        return give(r, {"run": {"session": {"id": rid, "status": st, "unit_ix": len(units) if st != "executing" else 0, "problem": "x"}, "units": units}})
    if path == "/governance/steering/author/j-rules/draft":
        ready = runs.get("j-rules") == "awaiting_human"
        return give(r, {"runId": "j-rules", "ready": ready, "rules": DRAFT if ready else []})
    if path == "/proposals" and m == "GET":
        return give(r, {"proposals": MEMS if runs.get("j-repo") == "completed" else []})
    if path.startswith("/proposals/") and m == "POST":
        return give(r, {"outcome": "promoted"} if path.endswith("/approve") else {"ok": True})
    if path == "/runs/j-rules/gate" and m == "POST":
        return give(r, {"status": "completed", "landing": {"outcome": "landed", "ruleIds": body(r)["keepRules"]}})
    r.continue_()


errors: list = []
ADDR_RAIL = """(() => { const g = (id) => [...document.querySelectorAll(`[data-testid="rail-nav-${id}"] a`)].map((a) => a.dataset.testid);
  return { work: g('work'), insight: g('insight'), mark: document.querySelector('[data-testid="nav-learn-mark"]')?.textContent ?? null }; })()"""
NO_HSCROLL = "document.documentElement.scrollWidth <= window.innerWidth + 1"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    for (w, h) in [(1440, 900), (390, 844)]:
        # Fresh state per size: unused Learn, no style jobs, no personality, no rules.
        set_fixture(origin, appearance=dict(DEFAULT_APPEARANCE))
        sent.clear(); rules.clear(); runs.clear(); persona["user"] = None
        ctx = b.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.route("**/api/v1/**", handle)
        page.add_init_script(f"document.addEventListener('DOMContentLoaded', () => {{ const s = document.createElement('style'); s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }})")
        # The fixture's settings store keeps studio.* keys; clear Learn's before the page reads them.
        page.goto(f"{origin}/learn", wait_until="domcontentloaded")
        page.evaluate("""() => fetch('/api/v1/settings', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({'studio.firstRun': {}, 'studio.learn.style': {}})})""")
        page.reload(wait_until="domcontentloaded")
        page.get_by_test_id("learn-hub").wait_for(timeout=30000)
        if w > 1000:
            page.get_by_test_id("nav-learn").wait_for(timeout=15000)
            rail = page.evaluate(ADDR_RAIL)
            check("1-rail-unused", rail["work"][:2] == ["nav-learn", "nav-projects"] and rail["mark"] == "Start here", rail=rail)
        tabs = page.get_by_test_id("learn-tab").all_inner_texts()
        check(f"2-tabs-{w}", tabs == ["Style", "Rules", "Personality", "Brand"], tabs=tabs)

        # 3. Personality
        page.get_by_test_id("learn-tab").nth(2).click()
        ans = page.get_by_test_id("persona-answer")
        ans.wait_for(timeout=15000)
        before = ans.inner_text()
        page.get_by_test_id("persona-dial-pushback").fill("0")
        after = ans.inner_text()
        check(f"3a-preview-{w}", "rather fix the bound" in before and "rather fix the bound" not in after)
        if w > 1000:
            page.screenshot(path=str(SHOTS / f"desk-learn-persona-{w}.png"))
        page.get_by_test_id("persona-save").click()
        page.wait_for_function("() => document.querySelector('[data-testid=\"persona-status\"]')?.textContent?.includes('version 1')", timeout=15000)
        put = [s for s in sent if s["m"] == "PUT" and s["path"] == "/persona"]
        check(f"3b-saved-{w}", len(put) == 1 and put[0]["body"]["scope"] == "user" and put[0]["body"]["persona"]["dials"]["pushback"] == 0)
        if w > 1000:
            page.wait_for_function("() => [...document.querySelectorAll('[data-testid=\"rail-nav-insight\"] a')].some((a) => a.dataset.testid === 'nav-learn')", timeout=15000)
            rail = page.evaluate(ADDR_RAIL)
            check("3c-rail-used", rail["insight"][-1] == "nav-learn" and "nav-learn" not in rail["work"] and rail["mark"] is None, rail=rail)

        # 4. Rules
        page.get_by_test_id("learn-tab").nth(1).click()
        page.locator('[data-starter="learn-small-prs"]').click()
        page.wait_for_function("() => document.querySelectorAll('[data-testid=\"learn-rule\"]').length === 1", timeout=15000)
        posted = [s["body"] for s in sent if s["path"] == "/governance/rules"]
        check(f"4-starter-{w}", len(posted) == 1 and posted[0]["id"] == "learn-small-prs" and posted[0]["provenance"]["ref"] == "learn:starter")
        if w > 1000:
            page.screenshot(path=str(SHOTS / f"desk-learn-rules-{w}.png"))

        # 5. Style
        page.get_by_test_id("learn-tab").nth(0).click()
        page.get_by_test_id("style-input").fill("https://wiki.acme.dev/CONTRIBUTING")
        page.get_by_test_id("style-add").click()
        page.get_by_test_id("style-kind").select_option("repo")
        repo_opts = page.get_by_test_id("style-repo").locator("option").all_inner_texts()
        if len(repo_opts) > 1:
            page.get_by_test_id("style-repo").select_option(index=1)
            page.get_by_test_id("style-add").click()
        n_sources = page.get_by_test_id("style-source").count()
        page.get_by_test_id("style-go").click()
        page.wait_for_function("() => document.querySelector('[data-testid=\"style-runline\"]')?.textContent?.startsWith('Running as')", timeout=20000)
        author = [s for s in sent if s["path"] == "/governance/steering/author"]
        launched = [s for s in sent if s["path"] == "/runs" and s["m"] == "POST"]
        check(f"5a-launched-{w}", len(author) == 1 and "https://wiki.acme.dev/CONTRIBUTING" in author[0]["body"]["instructions"]
              and (n_sources < 2 or (len(launched) == 1 and launched[0]["body"]["workflow"] == "capture-learnings" and "style lens" in launched[0]["body"]["problem"])),
              sources=n_sources, launched=len(launched))
        st = page.get_by_test_id("style-station").evaluate_all("els => els.map((e) => e.dataset.s)")
        check(f"5b-running-{w}", st[0] == "run", stations=st)
        runs["j-rules"] = "awaiting_human"
        runs["j-repo"] = "completed"
        page.get_by_test_id("style-results").wait_for(timeout=20000)
        if n_sources >= 2:
            mem = page.get_by_test_id("style-memories")
            mem.get_by_test_id("ask-option").nth(1).click()
            mem.get_by_test_id("ask-confirm").click()
            page.get_by_test_id("style-memories-record").wait_for(timeout=15000)
        rk = page.get_by_test_id("style-rules")
        rk.get_by_test_id("ask-option").nth(0).click()
        if w > 1000:
            page.screenshot(path=str(SHOTS / f"desk-learn-style-{w}.png"), full_page=False)
        rk.get_by_test_id("ask-confirm").click()
        page.get_by_test_id("style-rules-record").wait_for(timeout=15000)
        gate = [s["body"] for s in sent if s["path"] == "/runs/j-rules/gate"]
        approved = [s["path"] for s in sent if s["path"].endswith("/approve")]
        rejected = [s["path"] for s in sent if s["path"].endswith("/reject")]
        check(f"5c-decided-{w}", gate == [{"approve": True, "keepRules": ["POL-011"]}]
              and (n_sources < 2 or (approved == ["/proposals/m1/approve"] and rejected == ["/proposals/m2/reject"])), gate=gate, approved=approved, rejected=rejected)

        # 6. Brand + Theme's link
        page.get_by_test_id("learn-tab").nth(3).click()
        page.get_by_test_id("brand-learn").wait_for(timeout=15000)
        page.goto(f"{origin}/system?tab=theme", wait_until="domcontentloaded")
        page.get_by_test_id("theme-learn-brand").wait_for(timeout=20000)
        check(f"6-theme-link-{w}", page.get_by_test_id("brand-learn").count() == 0)
        page.goto(f"{origin}/learn", wait_until="domcontentloaded")
        page.get_by_test_id("learn-hub").wait_for(timeout=20000)
        check(f"7-no-hscroll-{w}", page.evaluate(NO_HSCROLL))
        ctx.close()
    b.close()

check("7-no-page-errors", len(errors) == 0, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
