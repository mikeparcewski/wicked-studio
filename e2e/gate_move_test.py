#!/usr/bin/env python3
"""
gate_move_test.py — the gate card carries its own next move (brainstorm-actionable ideas 1 + 2),
at 1440x700.

  card    /runs/r-review, paused at an evaluator NOT PASS escalation (the engine's recorded
          `VERDICT: FAIL` frames): the primary button names the recommended move ("Send back to the
          creator: …") with its consequence line above it ("produce reruns with 2 items; critique
          re-reviews"); the note is pre-filled with the reviewer's failing lines; the duplicate
          "Request changes" answer is not repeated while Retry / Reject / Cancel stay secondary.
  diff    the "Why it failed" toggle lists the reviewer's failing criteria beside what the creator
          (produce) claimed, read from the creator's transcript.
  send    taking the move POSTs {approve: false, action: "request_changes", amend: <the items>}.
  home    the Home "Needs you" row for r-review names the move ("Send back… ›") and opens the gate in the
          session thread (S15e: /s/run%3Ar-review#gate, the move preselected in the gate row).

Captures (e2e/shots/): gate-move-<skin>-card.png, gate-move-<skin>-diff.png, gate-move-<skin>-home.png.
Env: FEEDBACK_PORT (default 4471), STUDIO_SKIN. JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4471"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SKIN = STUDIO_SKIN
PREFILL = ("Fix the reviewer's failing items:\n- the regression test is missing\n"
           "- src/app.ts still reads `buggy`")

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


def gate_posts(origin: str, rid: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if p["runId"] == rid]


def reset(origin: str) -> None:
    set_fixture(origin, **{"gate_move": True, "reset_gate_posts": True,
                           "appearance": {**DEFAULT_APPEARANCE, "skin": SKIN}})


def text(page, testid: str) -> str:
    return (page.get_by_test_id(testid).first.text_content() or "").strip()


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

    def section_card() -> None:
        reset(origin)
        page.goto(f"{origin}/runs/r-review", wait_until="networkidle")
        page.get_by_test_id("gate-recommended").wait_for(state="visible", timeout=15000)
        move = page.get_by_test_id("gate-move").get_attribute("data-move")
        label = text(page, "gate-recommended")
        check("move-named-on-the-primary-button", move == "send-back"
              and label == "Send back to the creator: the regression test is missing (+1 more)", move=move, label=label)
        consequence = text(page, "gate-move-consequence")
        check("consequence-above-the-button", consequence == "produce reruns with 2 items; critique re-reviews"
              and page.evaluate("""() => { const c = document.querySelector('[data-testid="gate-move-consequence"]');
                  const b = document.querySelector('[data-testid="gate-recommended"]');
                  return c.getBoundingClientRect().bottom <= b.getBoundingClientRect().top; }"""), consequence=consequence)
        note = page.get_by_test_id("steering-amend")
        check("note-pre-filled", note.input_value() == PREFILL
              and note.get_attribute("data-prefill") == "verdict", note=note.input_value())
        check("others-secondary", page.get_by_test_id("steering-request-changes").count() == 0
              and page.get_by_test_id("steering-retry").is_visible()
              and page.get_by_test_id("steering-reject").is_visible()
              and page.get_by_test_id("steering-cancel").is_visible())
        check("button-on-screen", page.get_by_test_id("gate-recommended").is_visible()
              and page.evaluate("""() => { const b = document.querySelector('[data-testid="gate-recommended"]').getBoundingClientRect();
                  return b.top >= 0 && b.bottom <= window.innerHeight; }"""))
        page.screenshot(path=str(SHOTS / f"gate-move-{SKIN}-card.png"))

        page.get_by_test_id("verdict-diff-toggle").click()
        page.wait_for_function("""() => document.querySelector('[data-testid="verdict-diff"]')
          ?.getAttribute('data-state') === 'ready'""", timeout=8000)
        criteria = page.evaluate("""() => [...document.querySelectorAll('[data-testid="verdict-diff-criterion"]')]
          .map(e => e.textContent.trim())""")
        claims = page.evaluate("""() => [...document.querySelectorAll('[data-testid="verdict-diff-claim"]')]
          .map(e => e.textContent.trim())""")
        check("diff-lists-failing-criteria", criteria == ["the regression test is missing", "src/app.ts still reads `buggy`"],
              criteria=criteria)
        check("diff-beside-creator-claims", claims == ["added a regression test for the buggy path",
                                                       "src/app.ts now reads `fixed` instead of `buggy`"], claims=claims)
        page.get_by_test_id("verdict-diff").scroll_into_view_if_needed()
        page.screenshot(path=str(SHOTS / f"gate-move-{SKIN}-diff.png"))

        page.get_by_test_id("gate-recommended").click()
        deadline = time.monotonic() + 15
        while not gate_posts(origin, "r-review") and time.monotonic() < deadline:
            page.wait_for_timeout(200)
        posts = gate_posts(origin, "r-review")
        body = posts[0]["body"] if posts else {}
        check("move-sends-request-changes", len(posts) == 1 and body.get("approve") is False
              and body.get("action") == "request_changes" and body.get("amend") == PREFILL, body=body)

    def section_home() -> None:
        reset(origin)
        page.goto(f"{origin}/", wait_until="networkidle")
        row = page.locator('[data-testid="need-row"][data-key="gate:r-review"], [data-testid="need-member"][data-key="gate:r-review"]')
        if row.count() == 0 and page.get_by_test_id("need-group-toggle").count() > 0:
            page.get_by_test_id("need-group-toggle").first.click()
        row.first.wait_for(state="visible", timeout=15000)
        page.wait_for_function("""() => { const r = document.querySelector('[data-key="gate:r-review"] [data-testid="need-act"]');
            return !!r && r.textContent.includes('Send back'); }""", timeout=10000)
        act = row.first.get_by_test_id("need-act")
        verb = (act.text_content() or "").strip()
        check("home-row-names-the-move", verb == "Send back… ›" and act.get_attribute("data-act") == "open", verb=verb)
        page.screenshot(path=str(SHOTS / f"gate-move-{SKIN}-home.png"))
        act.click()
        # S15e: the row opens the session thread at the gate (`/s/run%3Ar-review#gate`), where the
        # move is the preselected choice of `session-gate-row`; the run page's `gate-recommended`
        # stays accepted for a skin that still routes there.
        page.locator('[data-testid="session-gate-row"], [data-testid="gate-recommended"]').first.wait_for(state="visible", timeout=15000)
        check("home-row-opens-the-gate", "r-review" in page.url, url=page.url)

    for section in (section_card, section_home):
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
