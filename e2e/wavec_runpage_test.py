#!/usr/bin/env python3
"""
wavec_runpage_test.py — the run page carries its next move (brainstorm-actionable ideas 6 + 13), 1440x700.

  rerun    /runs/r-rerun (paused at a NOT PASS escalation on review): ONLY the build phase of the
           breadcrumb offers "Rerun from here" (the engine's request_changes rewinds to the newest
           creator before the gate). Clicking it shows the consequence first — "Keeps understand,
           redoes build → review → deliver, ~9 min from past durations (deliver not timed yet)" —
           and "Rerun from build" POSTs /runs/r-rerun/gate {approve:false, action:'request_changes', ord:3}.
  trust    the same run's Insights (What / Where): "Trust this route for low-risk runs like this", its
           consequence (bugfix runs on Northwind at band 0-19 skip plan approval; the deliver gate stays
           manual) above "Trust this route", which POSTs /standing-orders with the band-scoped
           plan-approval rule — never deliver, never a wider band.
  done     /runs/r-rerun-done (completed): no phase offers a rerun; the receipt reads as in force.
  mid      /runs/r-rerun-mid (band 40-69): no receipt at all.

Captures (e2e/shots/): wavec-runpage-<skin>-rerun.png, wavec-runpage-<skin>-trust.png, wavec-runpage-<skin>-done.png.
Env: FEEDBACK_PORT (default 4481), STUDIO_SKIN. JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4481"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SKIN = STUDIO_SKIN
CONSEQUENCE = "Keeps understand, redoes build → review → deliver, ~9 min from past durations (deliver not timed yet)"
RULE = {"scope": {"kind": "project", "projectId": "northwind"},
        "trigger": {"kind": "gate", "phase": "plan_approval", "band": "0-19", "preset": "bugfix"},
        "action": "approve", "activeWhen": "always"}
ORDER_TEXT = "Trust bugfix runs on Northwind at band 0-19: skip plan approval (deliver stays manual)"

report: dict = {"ok": False, "skin": SKIN, "steps": {}}


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


def fixture_posts(origin: str, what: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/{what}", timeout=10) as res:
        return json.loads(res.read())["posts"]


def text(page, testid: str) -> str:
    return (page.get_by_test_id(testid).first.text_content() or "").strip()


def on_screen(page, testid: str) -> bool:
    return page.evaluate("""(t) => { const b = document.querySelector(`[data-testid="${t}"]`)?.getBoundingClientRect();
        return !!b && b.top >= 0 && b.bottom <= window.innerHeight; }""", testid)


dist = ensure_build(fail)
origin = start_server(PORT, dist)
set_fixture(origin, **{"run_page": True, "reset_orders": True, "reset_gate_posts": True,
                       "appearance": {**DEFAULT_APPEARANCE, "skin": SKIN}})

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def section_rerun() -> None:
        page.goto(f"{origin}/runs/r-rerun", wait_until="networkidle")
        crumb = page.get_by_test_id("stepper-phase-2")
        crumb.wait_for(state="visible", timeout=15000)
        page.locator('[data-testid="stepper-phase-2"][data-rerun="offered"]').wait_for(timeout=10000)
        offered = page.evaluate("""() => [...document.querySelectorAll('[data-rerun="offered"]')].map(e => e.dataset.testid)""")
        check("only-the-rewind-target-offers", offered == ["stepper-phase-2"], offered=offered)
        check("no-preview-before-asked", page.get_by_test_id("rerun-preview").count() == 0)
        crumb.click()
        page.get_by_test_id("rerun-consequence").wait_for(state="visible")
        consequence = text(page, "rerun-consequence")
        check("preview-names-kept-and-redone", consequence == CONSEQUENCE, consequence=consequence)
        check("preview-on-screen", on_screen(page, "rerun-consequence") and on_screen(page, "rerun-confirm"))
        check("nothing-sent-by-the-preview", fixture_posts(origin, "gate-posts") == [])
        page.screenshot(path=str(SHOTS / f"wavec-runpage-{SKIN}-rerun.png"))
        label = text(page, "rerun-confirm")
        page.get_by_test_id("rerun-confirm").click()
        page.get_by_test_id("rerun-sent").wait_for(state="visible", timeout=20000)
        posts = fixture_posts(origin, "gate-posts")
        check("action-calls-the-gate-route", label == "Rerun from build" and len(posts) == 1
              and posts[0]["runId"] == "r-rerun"
              and posts[0]["body"] == {"approve": False, "action": "request_changes", "ord": 3},
              label=label, posts=posts)

    def section_trust() -> None:
        page.goto(f"{origin}/runs/r-rerun", wait_until="networkidle")
        page.get_by_test_id("trust-receipt").wait_for(state="visible", timeout=15000)
        question = text(page, "trust-receipt-question")
        consequence = text(page, "trust-receipt-consequence")
        check("receipt-question", question == "Trust this route for low-risk runs like this", question=question)
        check("receipt-consequence-first",
              consequence == ("Runs on Northwind from the bugfix preset whose plan scores band 0-19 skip plan approval. "
                              "The deliver gate stays manual, and every other gate still waits for you."),
              consequence=consequence)
        page.get_by_test_id("trust-receipt-make").scroll_into_view_if_needed()
        check("receipt-on-screen", on_screen(page, "trust-receipt-make"))
        page.screenshot(path=str(SHOTS / f"wavec-runpage-{SKIN}-trust.png"))
        page.get_by_test_id("trust-receipt-make").click()
        page.get_by_test_id("trust-receipt-made").wait_for(state="visible", timeout=10000)
        posts = fixture_posts(origin, "standing-order-posts")
        check("receipt-creates-band-limited-order", len(posts) == 1 and posts[0].get("rule") == RULE
              and posts[0].get("text") == ORDER_TEXT, posts=posts)
        check("order-never-covers-deliver", "deliver" not in json.dumps(posts[0]["rule"])
              and posts[0]["rule"]["trigger"]["band"] == "0-19")

    def section_done() -> None:
        page.goto(f"{origin}/runs/r-rerun-done", wait_until="networkidle")
        page.get_by_test_id("stepper-phase-2").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("trust-receipt-in-force").wait_for(state="visible", timeout=10000)
        check("finished-run-offers-no-rerun", page.locator("[data-rerun]").count() == 0)
        page.screenshot(path=str(SHOTS / f"wavec-runpage-{SKIN}-done.png"))

    def section_mid() -> None:
        page.goto(f"{origin}/runs/r-rerun-mid", wait_until="networkidle")
        page.get_by_test_id("what-where").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(600)
        check("no-receipt-above-band-0-19", page.get_by_test_id("trust-receipt").count() == 0
              and page.get_by_test_id("trust-receipt-in-force").count() == 0)

    for section in (section_rerun, section_trust, section_done, section_mid):
        try:
            section()
        except SectionFailed:
            pass
        except Exception as exc:  # noqa: BLE001 — every failure lands in the report
            report["steps"][f"{section.__name__}-error"] = {"ok": False, "error": repr(exc)[:500]}
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
