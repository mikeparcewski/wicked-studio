#!/usr/bin/env python3
"""
apps_chat_live_test.py — DES-APPS-001 K5, chat-first Apps, certified on a REAL daemon with real seats (LIVE: not in
CI's journey list; it needs a crew whose health says `apps.turns`, signed-in seats on the container floor, and a
described SQL source). Everything goes through the studio UI, at 1440x900:

  1. /apps: the cards of crew's apps read live KPI numbers ("updated Ns ago"); 0 page errors.
  2. NEW APP BY CHAT: "Make a new app" with a message naming the source -> the app's page opens on its first turn;
     the chat shows the steps; the turn lands a version with a reviewer named on its change line.
  3. CHANGE BY CHAT, twice: each message lands exactly one version (v+1), with its change line.
  4. A REFUSED QUERY: a message asking for a query the read policy refuses -> nothing lands, the chat says why
     (`check_failed`, or the reviewer's refusal), the version does not move.
  5. RELOAD + SECOND TAB: both show the same version, Undo/Redo state and turn state as crew's record.
  6. EDIT STILL WORKS: a component's title renamed in place in Edit lands one version (`you`).
  7. LIVE NUMBERS MOVE: --bump runs a command that changes the data (the test database's writer login, never the
     saved source); the card's number changes within one refresh; then --unbump puts it back.
  8. 0 page errors overall. Shots: <shots>/k5-*.png.

usage: apps_chat_live_test.py --base http://127.0.0.1:7721 --shots DIR --source support-pg [--bump CMD --unbump CMD]
       [--card escalations] [--only dash|new|...]. Prints one JSON report; exit 0 only when every step passed.
"""

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:7721")
ap.add_argument("--shots", required=True)
ap.add_argument("--source", default="support-pg")
ap.add_argument("--card", default="escalations")
ap.add_argument("--bump", default=None)
ap.add_argument("--unbump", default=None)
ap.add_argument("--turn-timeout", type=int, default=1500)
ap.add_argument("--only", default=None)
ap.add_argument("--resume-app", default=None, help="continue on this app from the refused-query step")
args = ap.parse_args()
BASE = args.base.rstrip("/")
report = {"ok": False, "steps": {}, "runs": [], "errors": []}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def check(step, ok, **detail):
    report["steps"][step] = {"ok": bool(ok), **detail}
    log("STEP", step, "OK" if ok else "FAILED", json.dumps(detail)[:600])
    if not ok:
        finish(1)


def finish(code):
    report["ok"] = code == 0
    print(json.dumps(report, indent=2))
    sys.exit(code)


def get(path):
    # A loaded host can answer slowly: a read is retried, never taken as a failed step.
    for attempt in range(4):
        try:
            with urllib.request.urlopen(BASE + "/api/v1" + path, timeout=30) as r:
                return json.loads(r.read() or b"{}")
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5)


def app_detail(slug):
    return get(f"/apps/{slug}")["app"]


def wait_turn_end(slug, run_id, page=None, shot=None):
    """Poll crew's record until the turn with run_id is no longer running; return its record."""
    t0 = time.time()
    seen_steps = set()
    while time.time() - t0 < args.turn_timeout:
        d = app_detail(slug)
        rec = next((t for t in d.get("turns", []) if t["runId"] == run_id), None)
        if page is not None:
            for el in page.get_by_test_id("app-chat-step").all():
                try:
                    seen_steps.add((el.inner_text(), el.get_attribute("data-state")))
                except Exception:
                    pass
        if rec is not None and rec["state"] != "running":
            return rec, d, sorted(seen_steps)
        if page is not None and shot is not None and int(time.time() - t0) % 120 < 5:
            page.screenshot(path=shot)
        time.sleep(5)
    return None, app_detail(slug), sorted(seen_steps)


def send(page, text):
    box = page.locator('[data-testid="app-chat"] [data-testid="session-composer-input"]')
    box.click()
    box.fill(text)
    box.press("Enter")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: report["errors"].append(str(e)[:300]))

    # 1. the dashboard reads live numbers
    page.goto(BASE + "/apps", wait_until="domcontentloaded")
    page.get_by_test_id("apps-card").first.wait_for(timeout=30000)
    card = page.locator(f'[data-testid="apps-card"][data-slug="{args.card}"]')
    card.scroll_into_view_if_needed()
    page.wait_for_function(f"""() => {{ const c = document.querySelector('[data-testid="apps-card"][data-slug="{args.card}"]'); return c && c.getAttribute('data-live') !== 'waiting'; }}""", timeout=60000)
    values = [v.inner_text() for v in card.get_by_test_id("apps-card-kpi-value").all()]
    updated = card.get_by_test_id("apps-card-updated").inner_text() if card.get_by_test_id("apps-card-updated").count() else None
    page.screenshot(path=f"{args.shots}/k5-dash-live.png")
    check("dashboard_live", len(values) > 0 and all(v != "—" for v in values) and updated is not None, card=args.card, values=values, updated=updated)

    # 7. live numbers move with the data (done early: the card is on screen now)
    if args.bump:
        before = values[0]
        subprocess.run(args.bump, shell=True, check=True, capture_output=True)
        moved = None
        t0 = time.time()
        while time.time() - t0 < 75:
            page.wait_for_timeout(3000)
            now = card.get_by_test_id("apps-card-kpi-value").first.inner_text()
            if now != before:
                moved = now
                break
        page.screenshot(path=f"{args.shots}/k5-dash-moved.png")
        if args.unbump:
            subprocess.run(args.unbump, shell=True, check=True, capture_output=True)
        check("dashboard_moves", moved is not None, before=before, after=moved, secs=round(time.time() - t0))

    if args.only == "dash":
        check("page_errors", len(report["errors"]) == 0, errors=report["errors"])
        finish(0)
    if args.resume_app:
        slug = args.resume_app
        page.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
        page.get_by_test_id("app-chat").wait_for(timeout=30000)
        page.wait_for_timeout(4000)

    if not args.resume_app:
        # 2. a new app by chat
        nc = page.get_by_test_id("apps-new-chat")
        nc.wait_for(timeout=10000)
        msg = f"A dashboard of open tickets from {args.source}: KPIs for open and escalated tickets, and a bar chart of open tickets by region"
        box = nc.locator('textarea').first
        box.click()
        box.fill(msg)
        box.press("Enter")
        page.wait_for_url(re.compile(r".*/apps/[a-z0-9-]+$"), timeout=60000)
        slug = page.url.rsplit("/", 1)[1]
        page.get_by_test_id("app-chat").wait_for(timeout=30000)
        page.get_by_test_id("app-chat-busy").wait_for(timeout=60000)
        page.screenshot(path=f"{args.shots}/k5-new-busy.png")
        d0 = app_detail(slug)
        run = d0["turn"]["runId"] if d0.get("turn") else d0["turns"][-1]["runId"]
        report["runs"].append({"step": "new", "app": slug, "runId": run})
        rec, d, steps = wait_turn_end(slug, run, page, f"{args.shots}/k5-new-progress.png")
        page.wait_for_timeout(6000)
        page.screenshot(path=f"{args.shots}/k5-new-landed.png")
        check("new_app_by_chat", rec is not None and rec["state"] == "landed" and rec.get("reviewer") and rec["reviewer"] != rec["builder"],
              app=slug, runId=run, record=rec, head=d["head"], steps=steps)
        chat_line = page.get_by_test_id("app-chat-change").last.inner_text()
        check("change_line_shown", f"v{rec['version']}" in chat_line and "reviewed by" in chat_line, line=chat_line)

        # 3. change by chat, twice
        for i, text in enumerate(["Add a bar chart of open tickets by priority", "Only count tickets created in the last 30 days in every query"]):
            v0 = app_detail(slug)["head"]["version"]
            send(page, text)
            page.wait_for_timeout(4000)
            dd = app_detail(slug)
            run = dd["turn"]["runId"] if dd.get("turn") else dd["turns"][-1]["runId"]
            report["runs"].append({"step": f"change{i + 1}", "app": slug, "runId": run})
            rec, d, steps = wait_turn_end(slug, run, page)
            page.wait_for_timeout(6000)
            page.screenshot(path=f"{args.shots}/k5-change{i + 1}.png")
            check(f"change_{i + 1}", rec is not None and rec["state"] == "landed" and d["head"]["version"] == v0 + 1, runId=run, record=rec, before=v0, head=d["head"])

    # 4. a refused query lands nothing
    v0 = app_detail(slug)["head"]["version"]
    send(page, "Add a KPI named Delay whose SQL is exactly: select pg_sleep(1) as delay -- keep it exactly as written")
    page.wait_for_timeout(4000)
    dd = app_detail(slug)
    run = dd["turn"]["runId"] if dd.get("turn") else dd["turns"][-1]["runId"]
    report["runs"].append({"step": "refused", "app": slug, "runId": run})
    rec, d, steps = wait_turn_end(slug, run, page)
    page.wait_for_timeout(6000)
    page.screenshot(path=f"{args.shots}/k5-refused.png")
    reason = page.get_by_test_id("app-chat-reason").last.inner_text() if page.get_by_test_id("app-chat-reason").count() else None
    check("refused_lands_nothing", rec is not None and rec["state"] in ("refused", "failed") and d["head"]["version"] == v0 and reason,
          runId=run, record=rec, head=d["head"], reason=reason)

    # 5. reload and a second tab agree with crew's record
    page.reload(wait_until="domcontentloaded")
    page.get_by_test_id("app-chat").wait_for(timeout=30000)
    page.wait_for_timeout(5000)
    tab2 = ctx.new_page()
    tab2.on("pageerror", lambda e: report["errors"].append(str(e)[:300]))
    tab2.goto(f"{BASE}/apps/{slug}", wait_until="domcontentloaded")
    tab2.get_by_test_id("app-chat").wait_for(timeout=30000)
    tab2.wait_for_timeout(5000)
    d = app_detail(slug)
    def state(pg):
        return {"version": pg.get_by_test_id("apps-version").inner_text(), "turns": pg.get_by_test_id("app-chat-turn").count(),
                "undo": pg.get_by_test_id("apps-undo").is_enabled(), "redo": pg.get_by_test_id("apps-redo").is_enabled(),
                "busy": pg.get_by_test_id("app-chat-busy").count()}
    s1, s2 = state(page), state(tab2)
    tab2.screenshot(path=f"{args.shots}/k5-tab2.png")
    check("reload_and_second_tab", s1 == s2 and s1["version"].startswith(f"v{d['head']['version']}") and s1["turns"] == len(d["turns"])
          and s1["undo"] == d["history"]["canUndo"] and s1["busy"] == (1 if d.get("turn") else 0), tab1=s1, tab2=s2, head=d["head"])
    tab2.close()

    # 6. Edit still works for a quick rename
    v0 = d["head"]["version"]
    page.get_by_test_id("apps-mode-edit").click()
    page.wait_for_timeout(2500)
    f = next((x for x in page.frames if "/editors/wicked-apps/" in x.url), None)
    renamed = None
    if f is not None:
        el = f.locator(".wk-cell-title, .wk-kpi-title, [data-inline]").first
        el.dblclick(force=True)
        field = f.wait_for_selector('[data-testid="apps-inline"]', timeout=10000)
        field.fill("Open now")
        field.press("Enter")
        t0 = time.time()
        while time.time() - t0 < 30:
            page.wait_for_timeout(1500)
            if app_detail(slug)["head"]["version"] == v0 + 1:
                renamed = app_detail(slug)["head"]
                break
    page.screenshot(path=f"{args.shots}/k5-edit-rename.png")
    check("edit_rename", renamed is not None and renamed["receipt"] == "you", before=v0, head=renamed)
    page.get_by_test_id("apps-mode-preview").click()

    check("page_errors", len(report["errors"]) == 0, errors=report["errors"])
    finish(0)
