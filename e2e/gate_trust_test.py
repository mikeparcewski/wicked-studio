#!/usr/bin/env python3
"""
gate_trust_test.py — trust at the gate (brainstorm-actionable ideas 7 + 8), at 1440x700.

  record   /runs/r-trust (a review gate on claude's build) and /runs/r-trust-codex (the same gate on
           codex's build): the Approve button carries the creator seat's record on this kind of step,
           different for the two seats ("claude: 8/10 approvals held · 2 sent back" vs
           "codex: 1/5 approvals held · 3 sent back · 1 rejected"), as neutral text.
  offer    on r-trust, after the last 3 alike approvals (northwind, band 0-19): "Always approve band
           0-19 unit reviews on Northwind?" with the 14-day preview (8 gates: 5 approved, 2 sent back,
           1 by an order) shown above "Make it a rule"; clicking it POSTs /standing-orders with the
           band-scoped project rule, and the card says the order was made. No gate decision is sent.
  covered  r-trust-codex (same project and band) then offers nothing: the order covers it.
  deliver  /runs/r-trust-deliver: the deliver gate carries the record but NEVER the offer.

Captures (e2e/shots/): gate-trust-<skin>-offer.png, gate-trust-<skin>-codex.png, gate-trust-<skin>-deliver.png.
Env: FEEDBACK_PORT (default 4473), STUDIO_SKIN. JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4473"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SKIN = STUDIO_SKIN
RULE = {"scope": {"kind": "project", "projectId": "northwind"},
        "trigger": {"kind": "gate", "phase": "*", "band": "0-19"},
        "action": "approve", "activeWhen": "always"}

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
set_fixture(origin, **{"trust_rules": True, "reset_orders": True, "reset_gate_posts": True,
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

    def section_offer() -> None:
        page.goto(f"{origin}/runs/r-trust", wait_until="networkidle")
        page.get_by_test_id("gate-track-record").wait_for(state="visible", timeout=15000)
        record = text(page, "gate-track-record")
        inside = page.evaluate("""() => !!document.querySelector('[data-testid="steering-approve"] [data-testid="gate-track-record"]')""")
        check("claude-record-on-approve", record == "claude: 8/10 approvals held · 2 sent back" and inside, record=record)
        page.get_by_test_id("gate-rule-offer").wait_for(state="visible", timeout=10000)
        question = text(page, "gate-rule-question")
        preview = page.get_by_test_id("gate-rule-preview")
        counts = {k: preview.get_attribute(f"data-{k}") for k in ("would-approve", "you-approved", "you-sent-back")}
        check("offer-after-three-alike-approvals", question == "Always approve band 0-19 unit reviews on Northwind?",
              question=question)
        check("preview-counts", counts == {"would-approve": "8", "you-approved": "5", "you-sent-back": "2"}
              and "It also approves this gate now." in (preview.text_content() or ""), counts=counts)
        page.get_by_test_id("gate-rule-make").scroll_into_view_if_needed()
        check("offer-on-screen", on_screen(page, "gate-rule-make") and on_screen(page, "gate-rule-preview"))
        page.screenshot(path=str(SHOTS / f"gate-trust-{SKIN}-offer.png"))
        page.get_by_test_id("gate-rule-make").click()
        page.get_by_test_id("gate-rule-made").wait_for(state="visible", timeout=10000)
        posts = fixture_posts(origin, "standing-order-posts")
        check("confirm-creates-the-order", len(posts) == 1 and posts[0].get("rule") == RULE
              and posts[0].get("text") == "Always approve band 0-19 unit reviews on Northwind"
              and page.get_by_test_id("gate-rule-offer").count() == 0, posts=posts)
        check("no-gate-decision-sent", fixture_posts(origin, "gate-posts") == [])

    def section_codex() -> None:
        page.goto(f"{origin}/runs/r-trust-codex", wait_until="networkidle")
        page.get_by_test_id("gate-track-record").wait_for(state="visible", timeout=15000)
        record = text(page, "gate-track-record")
        check("codex-record-differs", record == "codex: 1/5 approvals held · 3 sent back · 1 rejected", record=record)
        page.wait_for_timeout(500)
        check("covered-by-the-order-no-offer", page.get_by_test_id("gate-rule-offer").count() == 0)
        page.screenshot(path=str(SHOTS / f"gate-trust-{SKIN}-codex.png"))

    def section_deliver() -> None:
        # A fresh fixture with no orders: the deliver gate is refused on its own, not because an order covers it.
        set_fixture(origin, **{"reset_orders": True})
        page.goto(f"{origin}/runs/r-trust-deliver", wait_until="networkidle")
        page.get_by_test_id("gate-recommended").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("gate-track-record").wait_for(state="visible", timeout=10000)
        inside = page.evaluate("""() => !!document.querySelector('[data-testid="gate-recommended"] [data-testid="gate-track-record"]')""")
        move = page.get_by_test_id("gate-move").get_attribute("data-move")
        check("deliver-record-on-the-recommended-move", inside and move == "deliver", move=move)
        page.wait_for_timeout(800)
        check("no-offer-for-deliver", page.get_by_test_id("gate-rule-offer").count() == 0)
        page.screenshot(path=str(SHOTS / f"gate-trust-{SKIN}-deliver.png"))

    for section in (section_offer, section_codex, section_deliver):
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
