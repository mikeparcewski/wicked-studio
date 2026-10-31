#!/usr/bin/env python3
"""
floor_override_test.py — (crew api-types 0.135.0, wicked-core `operator_judgment`, operator ruling
2026-10-21) "Approve as your own judgment" at a failed repo-checks floor, at 1440x700.

  r-floor-ovr  a build step whose repo-checks floor failed on load flakes after its retries (the shape
           run 2ebd9da2 parked in at attempt 8). The engine's prompt names the `operator_judgment`
           arm, so the row offers "Approve as your own judgment" inline beside Send back, Retry this
           step with a note and Stop. Its hover says the consequence first. Taking it opens an EMPTY
           rationale box whose consequence line ("Overrides the failed floor; recorded on the run and
           delivery; QE acceptance still required.") sits ABOVE the box; Send stays off while the box
           is blank or whitespace; with words it POSTs {approve: true, action: "operator_judgment",
           amend: <the rationale>} and nothing else.

Captures (e2e/shots/): floor-override-desk-{card,rationale}.png.
Env: FEEDBACK_PORT (default 4473). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, choice_consequence, ensure_build, gate_choice,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4473"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
RID = "r-floor-ovr"
CONSEQUENCE = "Overrides the failed floor; recorded on the run and delivery; QE acceptance still required."
RATIONALE = "21 head-only failures are load flakes in files this change never touched; each passes alone on this tree."
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


def wait_post(page, origin: str) -> dict:
    # The 10 s undo window, then the one POST.
    deadline = time.monotonic() + 25
    while not gate_posts(origin) and time.monotonic() < deadline:
        page.wait_for_timeout(200)
    page.wait_for_timeout(500)
    posts = gate_posts(origin)
    return posts[0]["body"] if len(posts) == 1 else {"posts": len(posts)}


ABOVE = """([a, b]) => { const ae = document.querySelector(a); const be = document.querySelector(b);
  return !!ae && !!be && ae.getBoundingClientRect().bottom <= be.getBoundingClientRect().top; }"""

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
        return page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-gate-choices"] [data-testid="session-gate-choice"]')].map(e => e.dataset.choiceKey)""")

    def labels() -> list:
        return page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-gate-choices"] [data-testid="session-gate-choice"]')].map(e => e.textContent)""")

    def section() -> None:
        set_fixture(origin, **{"floor_override": True, "reset_gate_posts": True, "appearance": {**DEFAULT_APPEARANCE}})
        page.goto(f"{origin}/s/run%3A{RID}", wait_until="networkidle")
        page.get_by_test_id("session-gate-row").wait_for(state="visible", timeout=15000)
        # Guided asks: it is one of the gate's cards, on the face.
        own = gate_choice(page, "operator-judgment")
        # It renders: in the gate's choices, named for what it is, Stop still last.
        ks = keys()
        check("renders-inline", "operator-judgment" in ks and ks[-1] == "stop", keys=ks, labels=labels())
        check("named", (own.text_content() or "").startswith("Approve as your own judgment"), label=own.text_content())
        # It says the consequence before it is taken: the line under the cards, for the card under the pointer.
        peek = choice_consequence(page, "operator-judgment")
        check("consequence-first-on-hover", peek.startswith(CONSEQUENCE), peek=peek)
        page.screenshot(path=str(SHOTS / "floor-override-desk-card.png"))
        # The rationale is required: the box opens empty, the consequence above it, Send off while blank.
        own.click()
        note = page.get_by_test_id("session-gate-note")
        note.wait_for(state="visible", timeout=5000)
        check("box-opens-empty", note.input_value() == "", value=note.input_value())
        line = (page.get_by_test_id("session-gate-floor-override-consequence").text_content() or "").strip()
        check("consequence-line", line == CONSEQUENCE, line=line)
        check("consequence-above-the-box", page.evaluate(ABOVE, ['[data-testid="session-gate-floor-override-consequence"]', '[data-testid="session-gate-note"]']))
        check("box-is-required", note.get_attribute("aria-required") == "true"
              and "required" in (page.get_by_test_id("session-gate-floor-override-label").text_content() or ""))
        send = page.get_by_test_id("session-gate-send")
        check("send-off-while-empty", send.is_disabled(), label=send.text_content())
        note.fill("   \n  ")
        check("send-off-while-blank", send.is_disabled())
        send.click(force=True)
        page.wait_for_timeout(600)
        check("nothing-posted-while-blank", gate_posts(origin) == [])
        note.fill(RATIONALE)
        check("send-on-with-words", send.is_enabled(), label=send.text_content())
        page.screenshot(path=str(SHOTS / "floor-override-desk-rationale.png"))
        # It submits: the arm and the rationale, nothing else.
        send.click()
        body = wait_post(page, origin)
        check("posts-the-judgment", body == {"approve": True, "action": "operator_judgment", "amend": RATIONALE}
              or (body.get("approve") is True and body.get("action") == "operator_judgment" and body.get("amend") == RATIONALE
                  and "amendScope" not in body and "plan" not in body), body=body)

    try:
        section()
    except SectionFailed:
        pass
    except Exception as exc:  # noqa: BLE001 — every failure lands in the report
        report["steps"]["section-error"] = {"ok": False, "error": repr(exc)[:500]}
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
