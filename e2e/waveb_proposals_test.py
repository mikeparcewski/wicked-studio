#!/usr/bin/env python3
"""
waveb_proposals_test.py — studio Wave B, idea 4 (1440x700): TRIAGE BY CONSEQUENCE on Home's
"N proposals to review" row.

Against 11 pending proposals (5 memory, 6 policy) served on crew's GET /proposals wire:

  row      the group row counts what an accept does ("5 memory-only · 6 change enforcement") and
           carries "Accept 5 memory-only ›".
  list     expanded, it shows at most 4 at a time, enforcement-changing ones first, and pages.
  preview  the click names exactly the 5 memories and posts NOTHING.
  undo     confirm queues it behind the undo window; Undo in the toast sends nothing.
  accept   confirm again and let the window close: the fixture receives POST /proposals/<id>/approve
           for exactly the 5 memories, none for a policy; the row then lists the 6 that change
           enforcement, with no batch accept left.

Captures (e2e/shots/): waveb-desk-row.png, waveb-desk-preview.png, waveb-desk-after.png.
Env: FEEDBACK_PORT (default 4419). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4419"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}

NOW_S = int(time.time())
MEMS = [{"id": f"mem-{i}", "kind_type": "memory",
         "payload": {"content": f"Remember: fact {i} about the build cache", "tier": "semantic"},
         "facets": {}, "provenance": {"run": "r-cap"}, "state": "pending", "created_at": NOW_S - 3600 - i}
        for i in range(5)]
POLS = [{"id": f"pol-{i}", "kind_type": f"policy:{'security' if i % 2 == 0 else 'testing'}",
         "payload": {"rule": f"Rule {i}: every change carries a test", "severity": "warn"},
         "facets": {}, "provenance": {"run": "r-cap"}, "state": "pending", "created_at": NOW_S - 7200 - i}
        for i in range(6)]
MEM_IDS = sorted(p["id"] for p in MEMS)


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/approve-posts", timeout=10) as res:
        return json.loads(res.read())["posts"]


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    GROUP = '[data-testid="need-row"][data-key="group:proposal"]'

    def run() -> None:
        set_fixture(origin, proposals=[dict(r) for r in MEMS + POLS], reset_repairs=True,
                    appearance={**DEFAULT_APPEARANCE})
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
        page.wait_for_selector(GROUP)
        row = page.locator(GROUP)
        check("row-count-11", row.get_attribute("data-count") == "11", count=row.get_attribute("data-count"))
        line = row.get_by_test_id("need-line").inner_text()
        check("row-consequence-first",
              line == "5 memory-only · 6 change enforcement", line=line)
        act = row.get_by_test_id("need-accept-act")
        check("row-accept-label", act.inner_text().strip() == "Accept 5 memory-only ›", label=act.inner_text())

        # The list: at most 4 at a time, enforcement first, and it pages.
        row.get_by_test_id("need-group-toggle").click()
        members = page.locator('[data-testid="need-members"][data-group="group:proposal"] [data-testid="need-member"]')
        keys = [members.nth(i).get_attribute("data-key") for i in range(members.count())]
        check("list-at-most-4", len(keys) == 4, keys=keys)
        check("list-enforcement-first", all(k.startswith("proposal:pol-") for k in keys), keys=keys)
        check("list-member-consequence",
              "Changes enforcement" in members.first.get_by_test_id("need-line").inner_text())
        page.screenshot(path=str(SHOTS / f"waveb-desk-row.png"))
        page.get_by_test_id("need-page-next").click()
        check("list-pages", "Showing 5–8 of 11" in page.get_by_test_id("need-members-pager").inner_text(),
              pager=page.get_by_test_id("need-members-pager").inner_text())

        # Preview: exactly the five memories, nothing posted.
        act.click()
        preview = page.get_by_test_id("need-accept-preview")
        preview.wait_for(state="visible")
        items = sorted(preview.get_by_test_id("need-accept-item").evaluate_all("els => els.map(e => e.dataset.id)"))
        check("preview-exact-set", items == MEM_IDS, items=items)
        check("preview-consequence", "no rule is written and enforcement is unchanged" in preview.inner_text()
              and "6 proposals stay for individual review" in preview.inner_text(), text=preview.inner_text())
        check("preview-posts-nothing", posts(origin) == [])
        page.screenshot(path=str(SHOTS / f"waveb-desk-preview.png"))

        # Undo: confirm, then Undo in the toast — nothing is sent.
        page.get_by_test_id("need-accept-confirm").click()
        toast = page.get_by_test_id("undo-toast")
        toast.wait_for(state="visible")
        check("undo-toast-names-it", "memory-only proposals" in toast.inner_text(), text=toast.inner_text())
        page.get_by_test_id("undo-button").click()
        toast.wait_for(state="detached")
        time.sleep(1)
        check("undo-sends-nothing", posts(origin) == [])
        check("undo-back-to-idle", act.get_attribute("data-accept-phase") == "idle")

        # Accept: confirm and let the window close.
        act.click()
        page.get_by_test_id("need-accept-confirm").click()
        page.get_by_test_id("undo-toast").wait_for(state="visible")
        time.sleep(4)
        check("window-holds-the-post", posts(origin) == [])
        page.wait_for_function(
            """() => !document.querySelector('[data-testid="need-accept-act"]')""", timeout=25000)
        sent = sorted(posts(origin))
        check("accepts-exactly-the-harmless-set", sent == MEM_IDS, posts=sent)
        page.wait_for_selector(GROUP)
        row = page.locator(GROUP)
        check("enforcement-ones-remain", row.get_attribute("data-count") == "6", count=row.get_attribute("data-count"))
        line = row.get_by_test_id("need-line").inner_text()
        check("remaining-line", line == "6 change enforcement", line=line)
        page.screenshot(path=str(SHOTS / f"waveb-desk-after.png"))

    ok = True
    try:
        run()
    except SectionFailed:
        ok = False
    except Exception as e:  # noqa: BLE001 — a journey reports, never tracebacks
        report["steps"]["run"] = {"ok": False, "error": repr(e)[:400]}
        ok = False
    browser.close()

report["ok"] = ok
print(json.dumps(report, indent=2))
sys.exit(0 if ok else 1)
