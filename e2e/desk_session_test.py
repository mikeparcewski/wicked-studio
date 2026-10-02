#!/usr/bin/env python3
"""
desk_session_test.py — A SESSION (DES-STUDIO-REBUILD-001 §11 S6a) at 1440x700, under STUDIO_SKIN=desk.

Drives the built UI against the in-process fixture's sessions corpus (two runs launched from
chat-pay — one not a team run, one a team run mid-build —, r-solo, a team run with no team
transport, and r-old, launched from a chat the daemon reclaimed) and proves the S6a acceptance:

  1. GROUPED BY CHAT: with GET /health.capabilities.runChatId the rail shows chat-pay as ONE
     session holding r-pay-1 and r-pay-2; r-solo (no chat) is its own session run:r-solo.
  2. THE SESSION: the rail row opens /s/chat-pay — the goal sentence is the chat's first operator
     turn, the thread holds the turns and both runs in time order.
  3. THE CHAIN: r-pay-2's chain hydrates from GET /runs/:id/team (understand done, build running,
     the floor's test and review marked), r-pay-1 (not a team run) renders from its units.
  4. LIVE, NO DOUBLE-APPLY: teamEvent frames over /ws (build completed — sent twice — then review
     claimed) move the chain in event order; the count reads 2 of 5 done, not 3.
  5. NEVER "CHECKED": no step or sentence says "checked" (no check_state on the wire).
  6. UN-TEAMED: run:r-solo says "Team transport unavailable: <reason>".
  7. CLOSED: /s/chat-gone renders r-old under "The conversation before this was closed. …"; a
     FAILED chat read says so with a retry and never claims the conversation closed.
  8. R4: a draft and the thread's scroll survive switching to another session and back.
  9. R2: opened 5 h after the last visit, the since-you-left card overlays the thread; collapsing
     it moves nothing in the thread; the next visit shows no card.
 10. LETTERS TYPE: a letter typed with the body focused lands in the session composer.
 11. CAPABILITY ABSENT: without runChatId every run is its own session (run:r-pay-1, run:r-pay-2).
 12. OLD PAGES: /runs/r-pay-2 still renders the run page (no redirect).
 13. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-session*.png. Env: FEEDBACK_PORT (default 4347).
"""

import json
import os
import sys
import time

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4347"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

RAIL = """() => [...document.querySelectorAll('[data-testid="rail-session"]')]
  .map(s => ({id: s.dataset.sessionId, runs: s.dataset.runIds, href: s.getAttribute('href')}))"""

CHAIN = """(rid) => {
  const c = document.querySelector(`[data-testid="chain"][data-run-id="${rid}"]`);
  if (!c) return null;
  const sentence = c.querySelector('[data-testid="chain-sentence"]');
  const transport = c.querySelector('[data-testid="chain-transport"]');
  return {
    source: c.dataset.source,
    steps: [...c.querySelectorAll('[data-testid="chain-step"]')].map(s =>
      [s.dataset.stepId, s.dataset.block, s.dataset.state, s.dataset.addedBy]),
    sentence: sentence ? sentence.innerText : null,
    transport: transport ? transport.innerText : null,
  };
}"""

THREAD = """() => {
  const t = document.querySelector('[data-testid="session-thread"]');
  const kids = t ? [...t.children].map(el => el.dataset.testid + ':' + (el.dataset.runId || el.dataset.who || '')) : [];
  const first = t ? t.querySelector('[data-testid="session-turn"], [data-testid="session-run"]') : null;
  return {kids, scrollTop: t ? t.scrollTop : null, scrollable: t ? t.scrollHeight > t.clientHeight + 50 : false,
          firstTop: first ? Math.round(first.getBoundingClientRect().top + t.scrollTop) : null,
          threadTop: t ? Math.round(t.getBoundingClientRect().top) : null};
}"""

PAGE = """() => ({
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  checked: /\\bchecked\\b/i.test(document.querySelector('[data-testid="session"]')?.innerText || ''),
  path: location.pathname,
})"""


def team_frame(eid: int, etype: str, **payload) -> dict:
    base = {"run_id": "r-pay-2", "ord": payload.pop("ord", None), "attempt": None, "by": "codex", "at": eid, "re": None}
    return {"type": "teamEvent", "event": {"event_id": eid, "event_type": etype, "emitted_at": eid,
                                           "payload": dict(base, **payload)}}


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, sessions=True, run_chat_id=True, extra_frames=[])
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        page.get_by_test_id("session-rail").wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            "() => !!document.querySelector('[data-testid=\"rail-session\"][data-session-id=\"chat-pay\"]')",
            timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-session-missing.png"))
        fail("rail", {"sessions": page.evaluate(RAIL)})

    # ── 1. grouped by chat ────────────────────────────────────────────────────────
    rail = {s["id"]: s for s in page.evaluate(RAIL)}
    check("grouped-by-chat",
          rail.get("chat-pay", {}).get("runs") == "r-pay-1 r-pay-2"
          and rail.get("run:r-solo", {}).get("runs") == "r-solo"
          and rail.get("chat-pay", {}).get("href") == "/s/chat-pay"
          and "run:r-pay-2" not in rail, rail=rail)

    # ── 2. the session ────────────────────────────────────────────────────────────
    page.locator('[data-testid="rail-session"][data-session-id="chat-pay"]').click()
    page.get_by_test_id("session").wait_for(state="visible", timeout=10000)
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"session-run\"]').length === 2", timeout=10000)
    title = page.get_by_test_id("session-title").inner_text()
    th = page.evaluate(THREAD)
    run_order = [k for k in th["kids"] if k.startswith("session-run:")]
    first_turn = th["kids"].index("session-turn:you") if "session-turn:you" in th["kids"] else -1
    check("session", page.evaluate("() => location.pathname") == "/s/chat-pay"
          and title == "fix the double charge on checkout, then show me"
          and run_order == ["session-run:r-pay-1", "session-run:r-pay-2"]
          and 0 <= first_turn < th["kids"].index("session-run:r-pay-1"),
          title=title, kids=th["kids"][:6])
    page.get_by_test_id("session-thread").evaluate("el => { el.scrollTop = el.scrollHeight; }")
    page.wait_for_function(
        "() => (document.querySelector('[data-testid=\"chain\"][data-run-id=\"r-pay-2\"]')||{}).dataset?.source === 'team'",
        timeout=10000)

    # ── 3. the chain ──────────────────────────────────────────────────────────────
    c2 = page.evaluate(CHAIN, "r-pay-2")
    c1 = page.evaluate(CHAIN, "r-pay-1")
    check("chain-hydrated",
          c2["steps"] == [["understand", "research", "done", "pa"], ["build", "build", "running", "pa"],
                          ["test", "test", "todo", "floor"], ["review", "review", "todo", "floor"],
                          ["deliver", "deliver", "todo", "pa"]]
          and c2["sentence"] == "1 of 5 done"
          and c1["source"] == "units" and [s[2] for s in c1["steps"]] == ["done", "done"],
          pay2=c2, pay1=c1)
    page.screenshot(path=str(SHOTS / "desk-session.png"))

    # ── 4. live frames, no double-apply ───────────────────────────────────────────
    done_build = team_frame(906, "wicked.team.step.completed", ord=1, step_id="build", status="ok",
                            tree=None, output_bytes=1, output_ref="u1")
    set_fixture(origin, extra_frames=[
        done_build, done_build,
        team_frame(907, "wicked.team.step.claimed", ord=3, step_id="review", role="evaluator", kind="agent",
                   phase="review", criterion="", baseline_tree=None, repo=None, code_graph_db=None),
    ])
    try:
        page.wait_for_function(
            "() => (document.querySelector('[data-testid=\"chain-step\"][data-step-id=\"review\"]')||{}).dataset?.state === 'running'",
            timeout=10000)
    except Exception:
        fail("live", page.evaluate(CHAIN, "r-pay-2"))
    c2 = page.evaluate(CHAIN, "r-pay-2")
    check("live-no-double-apply", [s[2] for s in c2["steps"]] == ["done", "done", "todo", "running", "todo"]
          and c2["sentence"] == "2 of 5 done", pay2=c2)

    # ── 5. never "checked" ────────────────────────────────────────────────────────
    pg = page.evaluate(PAGE)
    check("never-checked", not pg["checked"] and not pg["hscroll"], **pg)

    # ── 8a. R4: leave a draft and a scroll position ───────────────────────────────
    page.get_by_test_id("session-composer-input").fill("also refund the customers who were charged twice")
    th = page.evaluate(THREAD)
    if not th["scrollable"]:
        fail("r4-scrollable", th)
    page.get_by_test_id("session-thread").evaluate("el => { el.scrollTop = 180; }")
    page.wait_for_timeout(200)
    kept_top = page.evaluate(THREAD)["scrollTop"]

    # ── 6. un-teamed ──────────────────────────────────────────────────────────────
    page.locator('[data-testid="rail-session"][data-session-id="run:r-solo"]').click()
    page.wait_for_function("() => location.pathname === '/s/run%3Ar-solo'", timeout=5000)
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"chain-transport\"]')", timeout=10000)
    solo = page.evaluate(CHAIN, "r-solo")
    check("un-teamed", solo["transport"] == "Team transport unavailable: the team bus was unreachable at launch"
          and page.get_by_test_id("session-composer-input").input_value() == ""
          # a first visit starts at the top, not at the last session's scroll (Copilot)
          and page.evaluate(THREAD)["scrollTop"] == 0, solo=solo)

    # ── 8b. R4: back again ────────────────────────────────────────────────────────
    page.locator('[data-testid="rail-session"][data-session-id="chat-pay"]').click()
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"session-run\"]').length === 2", timeout=10000)
    page.wait_for_timeout(300)
    back = page.evaluate(THREAD)
    draft = page.get_by_test_id("session-composer-input").input_value()
    check("r4-draft-and-scroll", draft == "also refund the customers who were charged twice"
          and abs((back["scrollTop"] or 0) - kept_top) <= 2, draft=draft, kept=kept_top, now=back["scrollTop"])

    # ── 10. letters type into the session composer ────────────────────────────────
    page.get_by_test_id("session-composer-input").fill("")
    page.locator("body").click(position={"x": 700, "y": 40})
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.type("why")
    typed = page.get_by_test_id("session-composer-input").input_value()
    check("letters-type", typed == "why", typed=typed)
    page.get_by_test_id("session-composer-input").fill("")

    # ── 7. closed ─────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/s/chat-gone", wait_until="networkidle")
    page.get_by_test_id("session-closed-line").wait_for(state="visible", timeout=10000)
    closed = page.evaluate("() => ({conv: document.querySelector('[data-testid=\"session\"]').dataset.conversation, "
                           "runs: [...document.querySelectorAll('[data-testid=\"session-run\"]')].map(r => r.dataset.runId), "
                           "line: document.querySelector('[data-testid=\"session-closed-line\"]').innerText})")
    check("closed", closed["conv"] == "closed" and closed["runs"] == ["r-old"]
          and closed["line"] == "The conversation before this was closed. The work is below.", **closed)
    page.screenshot(path=str(SHOTS / "desk-session-closed.png"))

    # ── 7a. with C1, a run:<id> address of a chat's run lands on the chat's session (Copilot) ──
    page.goto(f"{origin}/s/run%3Ar-pay-2", wait_until="networkidle")
    page.wait_for_function("() => location.pathname === '/s/chat-pay'", timeout=10000)
    check("canonical-session", True)

    # ── 7b. a failed chat read claims nothing (codex): no closed line, a retry that recovers ──
    fails = {"n": 0}

    def broken(route):
        if fails["n"] == 0:
            fails["n"] += 1
            route.fulfill(status=500, content_type="application/json", body='{"error":"boom"}')
        else:
            route.continue_()
    page.route("**/api/v1/chats/chat-pay", broken)
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    page.get_by_test_id("session-chat-error").wait_for(state="visible", timeout=10000)
    unread = page.evaluate("() => ({conv: document.querySelector('[data-testid=\"session\"]').dataset.conversation, "
                           "closed: !!document.querySelector('[data-testid=\"session-closed-line\"]'), "
                           "runs: document.querySelectorAll('[data-testid=\"session-run\"]').length})")
    page.get_by_test_id("session-chat-retry").click()
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"session-turn\"]').length > 0", timeout=10000)
    page.unroute("**/api/v1/chats/chat-pay")
    check("chat-read-failure", unread["conv"] == "unreadable" and not unread["closed"] and unread["runs"] == 2
          and page.locator('[data-testid="session-chat-error"]').count() == 0, **unread)

    # ── 7c. a failed team read is said, never replaced by a plausible chain (Copilot) ──
    page.route("**/api/v1/runs/r-pay-1/team", lambda route: route.fulfill(
        status=500, content_type="application/json", body='{"error":"engine unavailable"}'))
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"chain\"][data-run-id=\"r-pay-1\"] [data-testid=\"chain-team-error\"]')",
        timeout=10000)
    page.unroute("**/api/v1/runs/r-pay-1/team")
    page.locator('[data-testid="chain"][data-run-id="r-pay-1"] [data-testid="chain-team-retry"]').click()
    page.wait_for_function(
        "() => !document.querySelector('[data-testid=\"chain-team-error\"]')", timeout=10000)
    check("team-read-failure", True)

    # ── 9. R2: since you left ─────────────────────────────────────────────────────
    five_h_ago = int(time.time() * 1000) - 5 * 3_600_000
    page.evaluate("(t) => { const k = 'studio.sessionVisits'; const v = JSON.parse(localStorage.getItem(k) || '{}'); "
                  "v['chat-pay'] = t; localStorage.setItem(k, JSON.stringify(v)); }", five_h_ago)
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    try:
        page.get_by_test_id("since-you-left").wait_for(state="visible", timeout=10000)
    except Exception:
        fail("since-shown", page.evaluate(THREAD))
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"session-run\"]').length === 2", timeout=10000)
    before = page.evaluate(THREAD)
    head = page.get_by_test_id("since-you-left").inner_text()
    page.screenshot(path=str(SHOTS / "desk-session-since.png"))
    page.get_by_test_id("since-toggle").click()
    after = page.evaluate(THREAD)
    collapsed = page.get_by_test_id("since-you-left").get_attribute("data-collapsed")
    check("since-overlays", "Since you left · 5 hours" in head and collapsed == "true"
          and before["firstTop"] == after["firstTop"] and before["threadTop"] == after["threadTop"],
          head=head.splitlines()[:2], before=[before["threadTop"], before["firstTop"]],
          after=[after["threadTop"], after["firstTop"]])
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"session-run\"]').length === 2", timeout=10000)
    check("since-once", page.locator('[data-testid="since-you-left"]').count() == 0)

    # ── 11. capability absent ─────────────────────────────────────────────────────
    set_fixture(origin, run_chat_id=False)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"rail-session\"][data-session-id=\"run:r-pay-2\"]')",
        timeout=10000)
    rail = {s["id"]: s for s in page.evaluate(RAIL)}
    check("no-capability", "chat-pay" not in rail and "run:r-pay-1" in rail and "run:r-pay-2" in rail,
          rail=sorted(rail))
    page.locator('[data-testid="rail-session"][data-session-id="run:r-pay-2"]').click()
    page.wait_for_function(
        "() => (document.querySelector('[data-testid=\"chain\"][data-run-id=\"r-pay-2\"]')||{}).dataset?.source === 'team'",
        timeout=10000)
    check("no-capability-session", page.get_by_test_id("session-title").inner_text()
          == "fix the double charge on checkout, then show me")

    # ── 12. the old run page still renders ────────────────────────────────────────
    page.goto(f"{origin}/runs/r-pay-2", wait_until="networkidle")
    page.wait_for_timeout(1500)
    old = page.evaluate("() => ({path: location.pathname, session: !!document.querySelector('[data-testid=\"session\"]'), "
                        "text: document.body.innerText.includes('fix the double charge')})")
    check("old-run-page", not old["path"].startswith("/s/") and not old["session"] and old["text"], **old)

    # ── 13. errors ────────────────────────────────────────────────────────────────
    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
