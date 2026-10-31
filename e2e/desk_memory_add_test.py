#!/usr/bin/env python3
"""
desk_memory_add_test.py — Memory gets Steering's ways in (program DES-LEARN §6.3; mockup learn-and-panels
f-memory), at 1440x900 and 390x844, on the in-process fixture. The capture run's proposals and the memory
edit are answered in the page; every write is recorded.

  1. Memory's Add menu offers Add a memory, Add with chat, Import a doc, Edit as a table, Show retired.
  2. Add with chat: what you type goes to POST /projects/default/capture; the reply is a pick-several of the
     memories it would keep; keeping one and unticking the other approves one and rejects the other.
  3. Import a doc: a picked file rides the capture as a text file.
  4. Edit as a table: only the changed row is sent to POST /memory/edit.
  5. Show retired says retiring erases, and brings back a declined suggestion (POST /proposals + approve).
  6. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-memory-add-{chat,table}-{1440,390}.png. Env: FEEDBACK_PORT (default 4563).
"""

import json
import os
import sys
import time

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4563"))
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
captures: list = []
MEMS = [{"id": "mem-a", "content": "Releases cut on Thursdays.", "tier": "semantic", "scope": "", "facets": {}, "created_at": NOW - 60},
        {"id": "mem-b", "content": "Hotfixes get a second reviewer.", "tier": "semantic", "scope": "", "facets": {}, "created_at": NOW - 120}]


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
    q = req.url.split("?", 1)[1] if "?" in req.url else ""
    m = req.method
    if m != "GET":
        sent.append({"m": m, "path": path, "body": body(r)})
    if path == "/memory" and m == "GET":
        return give(r, {"memories": MEMS})
    if path == "/memory/coverage":
        return give(r, {"total": 2, "by_tier": {"semantic": 2}})
    if path.startswith("/projects/") and path.endswith("/capture") and m == "POST":
        rid = f"cap-{len(captures) + 1}"
        captures.append(rid)
        return give(r, {"runId": rid})
    if path.startswith("/runs/cap-"):
        rid = path.split("/")[-1]
        return give(r, {"run": {"session": {"id": rid, "status": "completed", "unit_ix": 1, "problem": "x"}, "units": [{}]}})
    if path == "/proposals" and m == "GET":
        if "state=rejected" in q:
            return give(r, {"proposals": [{"id": "old-1", "kind_type": "memory", "payload": {"content": "An old idea."}, "facets": {}, "provenance": {}, "state": "rejected", "created_at": NOW - 999}]})
        rows = []
        for rid in captures:
            rows += [{"id": f"{rid}-1", "kind_type": "memory", "payload": {"content": "We cut releases on Thursdays."}, "facets": {}, "provenance": {"run_id": rid}, "state": "pending", "created_at": NOW},
                     {"id": f"{rid}-2", "kind_type": "memory", "payload": {"content": "Nothing merges after 3pm that day."}, "facets": {}, "provenance": {"run_id": rid}, "state": "pending", "created_at": NOW}]
        return give(r, {"proposals": rows})
    if path == "/proposals" and m == "POST":
        return give(r, {"id": "back-1"})
    if path.startswith("/proposals/") and m == "POST":
        return give(r, {"outcome": "promoted", "active_id": "x"} if path.endswith("/approve") else {"ok": True})
    if path == "/memory/edit" and m == "POST":
        return give(r, {"memory_id": "new", "retired": body(r)["memory_id"]})
    r.continue_()


def menu(page, item):
    page.get_by_test_id("memory-more").click()
    page.get_by_test_id(item).click()


errors: list = []
NO_HSCROLL = "document.documentElement.scrollWidth <= window.innerWidth + 1"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    for (w, h) in [(1440, 900), (390, 844)]:
        set_fixture(origin, appearance=dict(DEFAULT_APPEARANCE))
        sent.clear(); captures.clear()
        ctx = b.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.route("**/api/v1/**", handle)
        page.add_init_script(f"document.addEventListener('DOMContentLoaded', () => {{ const s = document.createElement('style'); s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }})")
        page.goto(f"{origin}/memory", wait_until="domcontentloaded")
        page.get_by_test_id("memory-page").wait_for(timeout=30000)
        page.get_by_test_id("memory-more").click()
        items = [t.strip() for t in page.locator('[role="menuitem"]').all_inner_texts()]
        check(f"1-menu-{w}", all(x in items for x in ["Add with chat", "Import a doc…", "Edit as a table", "Show retired"]), items=items)
        page.keyboard.press("Escape")
        # 2. Add with chat
        menu(page, "memory-add-chat")
        page.get_by_test_id("memory-add-text").fill("We cut releases on Thursdays and freeze merges after 3pm that day.")
        page.get_by_test_id("memory-add-send").click()
        ask = page.get_by_test_id("memory-add-ask")
        ask.wait_for(timeout=20000)
        cap = [s["body"] for s in sent if s["path"] == "/projects/default/capture"]
        check(f"2a-capture-{w}", len(cap) == 1 and "freeze merges after 3pm" in cap[0]["notes"])
        page.screenshot(path=str(SHOTS / f"desk-memory-add-chat-{w}.png"))
        ask.get_by_test_id("ask-option").nth(1).click()
        ask.get_by_test_id("ask-confirm").click()
        page.get_by_test_id("memory-add-record").wait_for(timeout=15000)
        dec = sorted(s["path"] for s in sent if s["path"].startswith("/proposals/cap-1"))
        check(f"2b-kept-{w}", dec == ["/proposals/cap-1-1/approve", "/proposals/cap-1-2/reject"], dec=dec,
              line=page.get_by_test_id("memory-add-record").inner_text())
        page.get_by_test_id("memory-add-close").click()
        # 3. Import a doc
        menu(page, "memory-add-import")
        page.locator('[data-testid="memory-import"] input[type="file"]').set_input_files(files=[{"name": "notes.md", "mimeType": "text/markdown", "buffer": b"# Release notes\nWe cut on Thursdays."}])
        page.get_by_test_id("memory-add-send").click()
        page.get_by_test_id("memory-add-ask").wait_for(timeout=20000)
        cap = [s["body"] for s in sent if s["path"] == "/projects/default/capture"]
        check(f"3-import-{w}", len(cap) == 2 and cap[1]["files"][0]["name"] == "notes.md" and "Thursdays" in cap[1]["files"][0]["text"])
        page.get_by_test_id("memory-add-close").click()
        # 4. Edit as a table
        menu(page, "memory-add-table")
        page.get_by_test_id("memory-table-text").nth(1).fill("Hotfixes get a second reviewer, always.")
        if w > 1000:
            page.screenshot(path=str(SHOTS / f"desk-memory-add-table-{w}.png"))
        page.get_by_test_id("memory-table-save").click()
        page.get_by_test_id("memory-table-note").wait_for(timeout=15000)
        edits = [s["body"] for s in sent if s["path"] == "/memory/edit"]
        check(f"4-table-{w}", edits == [{"memory_id": "mem-b", "content": "Hotfixes get a second reviewer, always."}], edits=edits)
        page.get_by_test_id("memory-table-close").click()
        # 5. Show retired
        menu(page, "memory-add-retired")
        erased = page.get_by_test_id("memory-retired-erased").inner_text()
        page.get_by_test_id("memory-retired-bring").click()
        page.get_by_test_id("memory-retired-back").wait_for(timeout=15000)
        filed = [s["body"] for s in sent if s["path"] == "/proposals" and s["m"] == "POST"]
        check(f"5-retired-{w}", "erased" in erased and filed == [{"content": "An old idea."}], filed=filed)
        check(f"6-no-hscroll-{w}", page.evaluate(NO_HSCROLL))
        ctx.close()
    b.close()

check("6-no-page-errors", len(errors) == 0, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
