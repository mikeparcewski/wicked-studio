#!/usr/bin/env python3
"""
desk_e2e7721_test.py — the studio defects the :7721 E2E certification found (crew 0.13.2 / studio 0.9.6),
each walked on the operator's own path at 1440x700 against the fixture's `e2e7721` corpus.

  1. studio#813 (run 9c3f20fa): a review unit failed on copilot; pi made the work it checks, so the
     engine refuses pi as its reassign target. crew serves that as `WorkUnit.reassign_refused`
     (wicked-crew#1058). The gate row offers "Reassign to" claude and NOT pi, and Technical details
     say why pi is not offered. A reassign crew refuses (409) is said ON the row, the gate still open.
  2. studio#814 (run 9ec286dc): a refused hand-over (nothing to deliver), RELOADED — on an older crew
     (`GET /runs/:id/gate` without `gateKind`) and on a newer one (with it). Both read "The hand-over
     failed — deliver again or stop?" with the line the script failed on, never "Ready to hand it over".
  3. studio#815 (run 89da69fb): a run that failed at planning (an engine `error`, no step failed). The
     Desk's failure row → See why says the engine's reason, not "No reason was recorded".
  4. studio#816 (chat ae8ffa61): a CLOSED ask (crew dropped its transcript). The thread still shows the
     answer, read from the run's answer step, control lines dropped.
  5. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-e2e7721-*.png. Env: FEEDBACK_PORT (default 4483).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4483"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ROW = """() => {
  const txt = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
  return {
    choices: [...document.querySelectorAll('[data-testid="session-gate-choice"]')].map((b) => [b.dataset.choiceKey, txt(b)]),
    question: txt(document.querySelector('[data-testid="session-gate-question"]')),
    error: txt(document.querySelector('[data-testid="session-gate-error"]')),
    body: document.body.innerText,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""


def reassign_posts() -> list:
    got = json.loads(urllib.request.urlopen(f"{origin}/__fixture/reassign-posts", timeout=10).read())["posts"]
    return [p_ for p_ in got if p_["runId"] == "r-7721-reassign"]


def new_page(browser):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return page


def open_details(page) -> None:
    """Open every Technical details / overflow disclosure in the gate row so their text is readable."""
    page.evaluate("""() => document.querySelectorAll('[data-testid="session-gate-row"] details').forEach((d) => { d.open = true; })""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, e2e7721=True, e2e7721_gate_kind=False, e2e7721_reassign_409=False,
                run_chat_id=True, ask_path=True, reset_gate_posts=True)

    # ── 1. studio#813: only the seats the engine accepts are offered ─────────────────
    page = new_page(browser)
    page.goto(f"{origin}/s/run%3Ar-7721-reassign", wait_until="networkidle")
    try:
        page.locator('[data-testid="session-gate-choice"]').first.wait_for(state="attached", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721-reassign-missing.png"))
        fail("reassign-row", page.evaluate("() => document.body.innerText.slice(0, 800)"))
    open_details(page)
    page.locator('[data-testid="session-gate-row"]').first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-e2e7721-1-reassign-offer.png"))
    row = page.evaluate(ROW)
    keys = [k for k, _ in row["choices"]]
    check("813-pi-not-offered", "reassign:pi" not in keys and "reassign:claude" in keys, choices=row["choices"])
    check("813-why-said", "Not offered for reassign: pi — it made the work this step checks" in row["body"],
          body=row["body"][-1200:])

    # A reassign crew refuses (409, the gate still open) is said on the row.
    set_fixture(origin, e2e7721_reassign_409=True, reset_gate_posts=True)
    other = page.locator('[data-testid="session-gate-choice"][data-choice-key="reassign:claude"]')
    if not other.is_visible():
        page.locator(".wk-session-gate-overflow-summary").first.click()
    other.click()
    try:
        page.get_by_test_id("session-gate-error").first.wait_for(state="visible", timeout=25000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721-1-refused-missing.png"))
        fail("813-refusal-shown", {"posts": reassign_posts(), "row": page.evaluate(ROW)["choices"]})
    page.get_by_test_id("session-gate-error").first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-e2e7721-2-reassign-refused.png"))
    row = page.evaluate(ROW)
    check("813-refusal-shown", row["error"] is not None and "the gate is still open" in row["error"]
          and len(reassign_posts()) == 1 and reassign_posts()[0]["body"].get("cli") == "claude",
          error=row["error"], posts=reassign_posts())
    set_fixture(origin, e2e7721_reassign_409=False)
    page.close()

    # ── 2. studio#814: a reloaded refused hand-over is the failure, with its cause ───
    for kind_on, tag in ((False, "older-crew"), (True, "newer-crew")):
        set_fixture(origin, e2e7721_gate_kind=kind_on)
        page = new_page(browser)
        page.goto(f"{origin}/s/run%3Ar-7721-handover", wait_until="networkidle")
        try:
            page.wait_for_function("() => document.body.innerText.includes('deliver again or stop')", timeout=15000)
        except Exception:
            page.screenshot(path=str(SHOTS / f"desk-e2e7721-3-handover-{tag}-missing.png"))
            fail(f"814-{tag}", page.evaluate("() => document.body.innerText.slice(0, 1200)"))
        page.locator('[data-testid="session-gate-row"]').first.scroll_into_view_if_needed()
        page.screenshot(path=str(SHOTS / f"desk-e2e7721-3-handover-{tag}.png"))
        body = page.evaluate("() => document.body.innerText")
        check(f"814-{tag}", "Ready to hand it over" not in body
              and "The hand-over failed — deliver again or stop?" in body
              and "The hand-over failed: nothing to deliver" in body
              and "applies to github.com origins only" not in body.split("Technical details")[0],
              body=body[:1500])
        page.close()

    # ── 3. studio#815: the Desk's failure row says the engine's reason ──────────────
    page = new_page(browser)
    page.goto(f"{origin}/", wait_until="networkidle")
    fail_row = page.locator('[data-key="fail:r-7721-failed"]').first
    try:
        fail_row.wait_for(state="attached", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721-4-failure-missing.png"))
        fail("815-row", page.evaluate("() => document.body.innerText.slice(0, 1200)"))
    fail_row.scroll_into_view_if_needed()
    fail_row.get_by_test_id("need-why-toggle").click()
    why = page.locator('[data-testid="need-why-line"]').first
    try:
        why.wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721-4-failure-nowhy.png"))
        fail("815-why", page.evaluate("() => document.body.innerText.slice(0, 1200)"))
    why.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-e2e7721-4-failure-why.png"))
    line = why.inner_text()
    check("815-why", line == "No helper was eligible to take the work — Technical details say why.", line=line)
    page.close()

    # ── 4. studio#816: a closed ask keeps its answer ────────────────────────────────
    page = new_page(browser)
    page.goto(f"{origin}/s/chat-7721", wait_until="networkidle")
    answer = page.locator('[data-testid="session-turn"][data-who="helper"]').filter(has_text="off-by-one")
    try:
        answer.first.wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721-5-ask-missing.png"))
        fail("816-answer", page.evaluate("() => document.body.innerText.slice(0, 1500)"))
    answer.first.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-e2e7721-5-ask-closed-answer.png"))
    text = answer.first.inner_text()
    hscroll = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("816-answer", "Start it at" in text and "SCOPE answer" not in text, text=text)
    check("no-hscroll", not hscroll)
    page.close()

    browser.close()

check("page-errors", errors == [], errors=errors)
report["ok"] = True
print(json.dumps(report, indent=2))
