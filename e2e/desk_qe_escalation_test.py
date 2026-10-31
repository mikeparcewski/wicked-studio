#!/usr/bin/env python3
"""
desk_qe_escalation_test.py — studio#761 / studio#762: a run stopped because its QE review recorded
no verdict (wicked-core `qe_review` outcome `invalid`), answered the way an operator would, at
1440x700 against the in-process fixture (switch `escalation_arms`, run r-qe-noverdict).

  1. The Desk's Needs you lists the run; the operator opens its session page.
  2. The gate's first line says WHY, in plain words: the QE reviewer didn't record a verdict, so
     nothing was judged (#762). The line under it says what went wrong; neither carries the QE run id.
  3. The suggested choice is "Retry the QE review" (#761). Nothing offers Send back or "Rerun from
     build" (the build had nothing wrong with it), and no choice says "Approve".
  4. Taking it POSTs exactly {approve: true, ord: 4} — the engine's retry of the QE unit alone (no request
     changes, no rewind, no note).

Captures (e2e/shots/): desk-qe-escalation-{light,dark}.png.
Env: FEEDBACK_PORT (default 4611). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4611"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
RID = "r-qe-noverdict"
report: dict = {"ok": False, "steps": {}}


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


def gate_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if p["runId"] == RID]


dist = ensure_build(fail)
origin = start_server(PORT, dist)
set_fixture(origin, **{"escalation_arms": True, "reset_gate_posts": True, "appearance": {**DEFAULT_APPEARANCE}})

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
CHOICE = '[data-testid="session-gate-choice"]'
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    try:
        # 1. From the Desk to the run, the way the operator gets there. Home v2: the landing shows one
        # card and "N more waiting", which opens Needs you in full.
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk-needs-more").click()
        page.wait_for_function("() => location.pathname === '/needs'", timeout=8000)
        # The escalated runs share one title, so Needs you folds them into one decision group; the
        # operator opens it and follows the run's own link.
        page.locator('[data-testid="desk-inbox-row"][data-key="group:approval"]').first.click()
        link = page.locator(f'a.wk-link[href="/s/run%3A{RID}"]').first
        link.wait_for(state="visible", timeout=15000)
        link.click()
        page.wait_for_url(f"**/s/run%3A{RID}**", timeout=12000)
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15000)
        page.locator(f'{CHOICE}[data-choice-key="retry"]').wait_for(state="visible", timeout=10000)

        # 2. Why, first and plain.
        q = (page.get_by_test_id("session-gate-question").first.text_content() or "").strip()
        why = (page.get_by_test_id("session-gate-qe-why").first.text_content() or "").strip()
        check("leads-with-why", q.startswith("The QE reviewer didn't record a verdict, so nothing was judged"), question=q)
        check("says-what-went-wrong", why == "Nothing was found wrong with the work, so the steps before it are kept.", why=why)
        check("no-engine-ids", not any(t in q + why for t in ("56b40976", "QE run", "NOT PASS", "bound")), text=q + " | " + why)

        # 3. The retry is suggested; nothing sends the build back.
        keys = page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-gate-choice"]')].map(e => e.dataset.choiceKey)""")
        labels = page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-gate-choice"] .wk-ask-opt-label')].map(e => e.textContent.trim())""")
        first = page.locator(CHOICE).first
        check("retry-suggested-first", keys[:1] == ["retry"] and first.get_attribute("data-recommended") == "true"
              and first.get_attribute("aria-checked") == "true"
              and (first.text_content() or "").strip().startswith("Retry the QE review"), keys=keys, labels=labels)
        check("no-send-back-or-rerun", "send-back" not in keys and "rerun" not in keys
              and not any(l.startswith("Rerun from") or l == "Send back" for l in labels), keys=keys, labels=labels)
        check("never-approve", not any("Approve" in l for l in labels), labels=labels)
        cons = page.get_by_test_id("session-gate-consequence")
        check("consequence-says-only-qe", cons.count() > 0 and "Only the QE check and its review run again" in (cons.first.text_content() or ""))

        for theme in ("wicked-light", "wicked-dark"):
            page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
            page.wait_for_timeout(200)
            page.screenshot(path=str(SHOTS / f"desk-qe-escalation-{theme.split('-')[1]}.png"))
        page.evaluate("() => document.documentElement.setAttribute('data-theme', 'wicked-light')")

        # 4. The retry is the engine's approve at the QE unit — nothing else rides it.
        first.click()
        page.get_by_test_id("session-gate-confirm").click()  # guided asks: the primary sends the selected card
        deadline = time.monotonic() + 25
        while not gate_posts(origin) and time.monotonic() < deadline:
            page.wait_for_timeout(200)
        page.wait_for_timeout(500)
        posts = gate_posts(origin)
        body = posts[0]["body"] if len(posts) == 1 else {"posts": len(posts)}
        check("retry-posts-a-plain-approve", body == {"approve": True, "ord": 4}, body=body)
        check("no-page-errors", errors == [], errors=errors[:3])
    except SectionFailed:
        pass
    except Exception as exc:  # noqa: BLE001 — every failure lands in the report
        report["steps"]["error"] = {"ok": False, "error": repr(exc)[:500]}
    browser.close()

report["ok"] = bool(report["steps"]) and all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
