#!/usr/bin/env python3
"""
chat_citations_test.py — crew#561 / F-RC1-117: no fabricated citation renders unmarked (1440x700).

On the RC1 Phase 6 re-run a seat answered with 26 commit SHAs, two of which existed in no
repository, and the thread rendered all 26 as identical plain text — a customer could not tell a
real SHA from an invented one, and a SHA is exactly what a reader copies into `git show`. The daemon
now verifies every citation against the repositories the chat can read and broadcasts one
`chatCitations` frame per reply; this rig proves what a reader SEES.

  1. a repo-scoped chat, one reply citing a real SHA, a fabricated SHA and an off-by line ref:
     before the verdicts arrive, nothing is marked (the RC1 state);
  2. the `chatCitations` frame lands (pushed verbatim over POST /__fixture `chat_frames`, the way
     the daemon would broadcast it): the fabricated SHA is struck through and UNVERIFIED where it
     sits, the off-by line ref shows the real line, the real SHA is untouched, and the reply's
     footer reads "2 verified · 1 unverifiable · 1 corrected".

Capture: e2e/shots/chat-citations-plain.png, e2e/shots/chat-citations-marked.png.
Env: CITATIONS_PORT (default 4374).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("CITATIONS_PORT", "4374"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def TID(t: str) -> str:
    return f'[data-testid="{t}"]'


REAL_SHA = "dd621c0"
FAKE_SHA = "6d77153"
REPLY = (
    "Release notes: the chat transcript landed in `" + REAL_SHA + "`, and the deliver gate "
    "defaulted on in `" + FAKE_SHA + "`. `acceptancePhaseIds` is at `acceptance.ts:79`."
)

CITATIONS = {
    "type": "chatCitations",
    "verified": 2,
    "unverifiable": 1,
    "corrected": 1,
    "unchecked": 0,
    "items": [
        {"raw": REAL_SHA, "kind": "sha", "status": "verified", "resolved": "studio-api"},
        {"raw": FAKE_SHA, "kind": "sha", "status": "unverified",
         "note": "no such commit in any repo in this chat's scope"},
        {"raw": "acceptance.ts:79", "kind": "line", "status": "corrected",
         "resolved": "acceptance.ts:80", "note": "acceptancePhaseIds is on line 80, not 79"},
    ],
}

MARKS = """() => [...document.querySelectorAll('[data-testid="citation-mark"]')].map((el) => ({
  raw: el.getAttribute('data-raw'), status: el.getAttribute('data-status'),
  text: el.textContent.trim(), title: el.getAttribute('title')}))"""

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # A chat scoped to a repository — the only kind that HAS read roots to verify against.
    set_fixture(origin, repo=True, chat_scope=True)
    page.goto(f"{origin}/chat/new", wait_until="networkidle")
    page.locator(TID("chat-scope-row")).wait_for(timeout=15000)
    page.locator(TID("chat-scope-repos")).click()
    option = page.locator('[data-testid="chat-scope-repo-option"][data-repo-id="studio-api"]')
    option.wait_for(timeout=10000)
    option.locator('input[type="checkbox"]').check()
    composer = page.locator("textarea")
    composer.fill("summarize the last 10 commits as release notes")
    composer.press("Enter")
    page.locator(TID("chat-scope")).wait_for(timeout=15000)
    bubble = page.locator(TID("seat-bubble")).first
    # The narrated feed (§11.1, the default view) keeps a STILL-STREAMING reply behind its
    # narration line, so the pending bubble is attached but hidden — that is the state to read the
    # seat from; the finished reply below is the one a reader sees.
    bubble.wait_for(state="attached", timeout=15000)
    seat = bubble.get_attribute("data-agent")
    chat_id = page.url.rsplit("/", 1)[-1]
    check("a-repo-scoped-chat-is-live", bool(seat) and chat_id not in ("", "new"),
          seat=seat, chat=chat_id)

    # The seat's answer, with the RC1 citation mix.
    set_fixture(origin, chat_frames=[
        {"type": "chatReply", "chat": chat_id, "cliKey": seat, "ok": True, "text": REPLY}])
    page.wait_for_function(
        '() => document.querySelector(\'[data-testid="seat-bubble"]\')'
        '?.getAttribute("data-pending") === "false"', timeout=15000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "chat-citations-plain.png"))
    check("before-the-verdicts-nothing-is-marked",
          page.locator(TID("citation-mark")).count() == 0
          and page.locator(TID("seat-citations")).count() == 0
          and FAKE_SHA in page.locator(TID("seat-bubble")).first.inner_text(),
          marks=page.locator(TID("citation-mark")).count())

    # The daemon's verdicts.
    # Stamped with the turn the send opened (the fixture answers `t-<n>`, as the daemon does): a
    # frame for a turn this client never saw is DELIBERATELY ignored, so the stamp must be right.
    set_fixture(origin, chat_frames=[{**CITATIONS, "chat": chat_id, "cliKey": seat, "turn_id": "t-1"}])
    page.locator(TID("seat-citations")).wait_for(timeout=15000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "chat-citations-marked.png"))

    strip = page.locator(TID("seat-citations")).first
    check("the-reply-counts-its-citations",
          "2 verified · 1 unverifiable · 1 corrected" in strip.inner_text()
          and strip.get_attribute("data-unverifiable") == "1",
          text=strip.inner_text()[:120])

    marks = page.evaluate(MARKS)
    by_raw = {m["raw"]: m for m in marks}
    check("the-fabricated-sha-is-marked-where-it-sits",
          FAKE_SHA in by_raw and by_raw[FAKE_SHA]["status"] == "unverified"
          and "UNVERIFIED" in by_raw[FAKE_SHA]["text"]
          and "no such commit" in (by_raw[FAKE_SHA]["title"] or ""),
          mark=by_raw.get(FAKE_SHA))
    check("the-off-by-line-ref-shows-the-real-line",
          "acceptance.ts:79" in by_raw
          and by_raw["acceptance.ts:79"]["status"] == "corrected"
          and "acceptance.ts:80" in by_raw["acceptance.ts:79"]["text"],
          mark=by_raw.get("acceptance.ts:79"))
    check("a-verified-citation-is-left-alone",
          REAL_SHA not in by_raw and REAL_SHA in page.locator(TID("seat-bubble")).first.inner_text(),
          marked=sorted(by_raw))
    # The struck-through token is the seat's own text: marked, never rewritten.
    check("the-seats-text-is-intact",
          "defaulted on in" in page.locator(TID("seat-bubble")).first.inner_text(),
          text=page.locator(TID("seat-bubble")).first.inner_text()[:160])

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
