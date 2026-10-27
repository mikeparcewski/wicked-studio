#!/usr/bin/env python3
"""
escalation_arms_test.py — batch W2-S3: the gate's escalation arms, its source line and the
work under review, at 1440x700. S16a-2a: answered in the session thread's row (/s/run%3A<id>), in the decision
dock since ui-v2; each arm says its consequence before it is taken — the face's one button on the line above the
buttons, every other arm as its own second line under Other options.

  timeout  r-timeout, paused at a repo-checks floor that did not finish (the test check hit
           its bound): the card offers "Re-run the checks with twice the time" (extend), "Re-run with
           the targeted tests" (targeted) and "Accept what passed" (accept_partial, naming the
           waived `test`), each consequence ABOVE its button, and no suggestion arm. Taking extend
           POSTs {approve: true, action: "extend"} and nothing else.
  suggest  r-suggest, a verify evaluator the worktree guard denied, its edit pinned: the card
           offers "Adopt the evaluator's edit" naming src/importer.ts, the ref and the creator phase
           (fix), and no timeout arm. Taking it POSTs {approve: true, action: "accept_suggestion"}.
  prerun   r-prerun, a run-level pre-run gate before triage: the card leads with "Under review:
           recon" and "Approve runs next: triage", reads recon's output when opened, names the gate
           "Run-level gate" (never "Workflow-declared"), and the steer scope defaults to the fix
           phase; Approve + steer POSTs {approve: true, amend, amendScope: "creator"}.

Captures (e2e/shots/): escalation-arms-desk-{timeout,suggest,prerun}.png.
Env: FEEDBACK_PORT (default 4472). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, choice_consequence, click_gate_choice,
                           ensure_build, open_tech_details, set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4472"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
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


def gate_posts(origin: str, rid: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if p["runId"] == rid]


def wait_post(page, origin: str, rid: str) -> dict:
    # The 10 s undo window, then the one POST.
    deadline = time.monotonic() + 25
    while not gate_posts(origin, rid) and time.monotonic() < deadline:
        page.wait_for_timeout(200)
    posts = gate_posts(origin, rid)
    page.wait_for_timeout(500)
    posts = gate_posts(origin, rid)
    return posts[0]["body"] if len(posts) == 1 else {"posts": len(posts)}


def reset(origin: str) -> None:
    set_fixture(origin, **{"escalation_arms": True, "reset_gate_posts": True,
                           "appearance": {**DEFAULT_APPEARANCE}})


def text(page, testid: str) -> str:
    return (page.get_by_test_id(testid).first.text_content() or "").strip()


ABOVE = """([c, b]) => { const ce = document.querySelector(`[data-testid="${c}"]`);
  const be = document.querySelector(`[data-testid="${b}"]`);
  return !!ce && !!be && ce.getBoundingClientRect().bottom <= be.getBoundingClientRect().top; }"""
ABOVE_SEL = """([c, b]) => { const ce = document.querySelector(c); const be = document.querySelector(b);
  return !!ce && !!be && ce.getBoundingClientRect().bottom <= be.getBoundingClientRect().top; }"""


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

    CHOICE = '[data-testid="session-gate-choice"][data-choice-key="{}"]'

    def keys() -> list:
        return page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-gate-choice"]')].map(e => e.dataset.choiceKey)""")

    def peek(key: str) -> str:
        # ui-v2 gate: a choice says what it does BEFORE it is taken — on its menu item, or above the face's buttons.
        return choice_consequence(page, key)

    def consequence_on(key: str) -> bool:
        """The consequence is ON the choice (its menu item's second line) or above the face's buttons — never a line
        that appears under the buttons and moves them."""
        loc = page.locator(CHOICE.format(key)).first
        if loc.get_attribute("role") == "menuitem":
            return loc.is_visible() and (loc.get_attribute("data-sub") or "") != ""
        return page.evaluate(ABOVE_SEL, ['[data-testid="session-gate-consequence"]', '[data-testid="session-gate-choices"]'])

    def section_timeout() -> None:
        # S16a-2a: the gate is answered in the session thread's row (/s/run%3Ar-timeout).
        reset(origin)
        page.goto(f"{origin}/s/run%3Ar-timeout", wait_until="networkidle")
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15000)
        page.locator(CHOICE.format("offer:extend")).wait_for(state="attached", timeout=10000)
        arms = [k for k in keys() if k.startswith("offer:")]
        check("three-timeout-arms", arms == ["offer:extend", "offer:targeted", "offer:accept_partial"], arms=arms)
        for a in ("extend", "targeted", "accept_partial"):
            line = peek(f"offer:{a}")
            check(f"consequence-above-{a}", line != "" and consequence_on(f"offer:{a}"), line=line)
        waived = peek("offer:accept_partial")
        check("accept-partial-names-the-waiver", "waives test" in waived, text=waived)
        ks = keys()
        check("escalation-layout", "approve" not in ks and "offer:accept_suggestion" not in ks
              and page.evaluate("""() => { const c = [...document.querySelectorAll('[data-testid="session-gate-choices"] [data-testid="session-gate-choice"]')]; return c[c.length - 1].dataset.choiceKey === 'stop'; }"""), keys=ks)
        page.screenshot(path=str(SHOTS / f"escalation-arms-desk-timeout.png"))
        click_gate_choice(page, "offer:extend")
        body = wait_post(page, origin, "r-timeout")
        check("extend-posts-the-arm-alone", body.get("approve") is True and body.get("action") == "extend"
              and "amend" not in body and "amendScope" not in body, body=body)

    def section_suggest() -> None:
        reset(origin)
        page.goto(f"{origin}/s/run%3Ar-suggest", wait_until="networkidle")
        page.locator(CHOICE.format("offer:accept_suggestion")).wait_for(state="attached", timeout=15000)
        c = peek("offer:accept_suggestion")
        check("suggestion-consequence", "src/importer.ts" in c and "refs/wicked/suggestions/r-suggest/2/0" in c and "fix" in c, text=c)
        check("no-timeout-arms", "offer:extend" not in keys())
        check("consequence-above-suggestion", consequence_on("offer:accept_suggestion"))
        page.screenshot(path=str(SHOTS / f"escalation-arms-desk-suggest.png"))
        click_gate_choice(page, "offer:accept_suggestion")
        body = wait_post(page, origin, "r-suggest")
        check("suggestion-posts-the-arm-alone", body.get("approve") is True and body.get("action") == "accept_suggestion"
              and "amend" not in body, body=body)

    def section_prerun() -> None:
        reset(origin)
        page.goto(f"{origin}/s/run%3Ar-prerun", wait_until="networkidle")
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15000)
        page.locator(CHOICE.format("steer")).wait_for(state="attached", timeout=10000)
        # The work under review and the source line sit in the row's Technical details (S16a-1b), under its
        # "More about this" since ui-v2.
        open_tech_details(page)
        page.get_by_test_id("gate-under-review").wait_for(state="visible", timeout=8000)
        check("under-review-leads", "Under review: recon" in text(page, "gate-under-review")
              and "Approve runs next: triage" in text(page, "gate-next"))
        page.get_by_test_id("gate-under-review-toggle").click()
        page.get_by_test_id("gate-under-review-output").wait_for(state="visible", timeout=8000)
        check("reviewed-output-read", "drops a trailing row" in text(page, "gate-under-review-output"))
        row = page.get_by_test_id("session-gate-row").text_content() or ""
        check("run-level-source", "Run-level gate" in text(page, "session-gate-source")
              and "Workflow-declared" not in row)
        # The row's steer targets the creator phase (fix) whenever one follows the gate — no picker.
        click_gate_choice(page, "steer")
        page.get_by_test_id("session-gate-note").fill("merge the parser branch first")
        page.screenshot(path=str(SHOTS / f"escalation-arms-desk-prerun.png"))
        page.get_by_test_id("session-gate-send").click()
        body = wait_post(page, origin, "r-prerun")
        check("steer-targets-the-creator", body.get("approve") is True and body.get("amend") == "merge the parser branch first"
              and body.get("amendScope") == "creator", body=body)

    for section in (section_timeout, section_suggest, section_prerun):
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
