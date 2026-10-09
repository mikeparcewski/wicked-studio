#!/usr/bin/env python3
"""
desk_ask_path_test.py — ASK-S2 (DES-ASK-TEAM-CHAT-001 §4.7, §9's Playwright item) at 1440x700, under
the Desk: Continue in Build happens IN the thread.

Against the fixture's `ask_path` replay: question → one reply + the reviewer line → "Build this" →
the PA proposes the work (a `change` adding the first creator step, scored on its declared touch,
the floor's review added, the first_creator approval row) → the proposal card in the thread →
Continue in Build → the chain line appears. It proves:

  1. THE CARD: after "Build this" the thread shows ONE card "Continue in Build? <pa> proposes: Build →
     Check (required)." with "band 20–39 · touches 2 declared paths · 12 dependents", and three answers —
     Continue in Build / Not now / End; the run's own block is still hidden (no chain yet).
  2. NOT NOW posts ONE gate decision whose plan is the ACCEPTED rev's steps (answer-1 only — nothing
     accepted is removed, no build); the card stays as "Not now — the conversation goes on" with
     "Bring it back", which prefills the composer with the operator's own words.
  3. BRING IT BACK → send → the PA re-proposes; CONTINUE IN BUILD posts ONE approve (no plan) and the
     run's block appears with its chain line: Answer done, Build working, Review (floor-added) not started — the
     shape line is gone (the chain line is the shape now).
  4. END (a fresh ask): one reject; "Conversation ended" is said; the session is finished.
  5. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-ask-path*.png. Env: FEEDBACK_PORT (default 4467).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4467"))
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


def fixture_get(origin: str, path: str):
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

CARD = """() => {
  const c = document.querySelector('[data-testid="session-ask-proposal"]');
  const p = c && c.querySelector('[data-testid="session-proposal"]');
  const txt = (s) => { const el = c && c.querySelector(s); return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
  return { card: !!c, firstCreator: c ? c.dataset.firstCreator : null, state: p ? p.dataset.state : null,
           text: txt('[data-testid="session-proposal-text"]'), why: txt('[data-testid="session-proposal-why"]'),
           buttons: c ? [...c.querySelectorAll('.wk-prop-btns button')].map((b) => b.innerText.trim()) : [],
           no: txt('[data-testid="session-proposal-no"]'),
           runs: document.querySelectorAll('[data-testid="session-run"]').length,
           chain: [...document.querySelectorAll('[data-testid="chain-step"]')].map((s) => [s.innerText.replace(/\\s+/g, ' ').trim(), s.dataset.state]),
           shape: (document.querySelector('[data-testid="session-ask-shape"]') || {}).innerText || null,
           lines: [...document.querySelectorAll('[data-testid="ask-line"]')].map((l) => [l.dataset.kind, l.innerText.replace(/\\s+/g, ' ').trim()]),
           draft: (document.querySelector('[data-testid="session-composer-input"]') || {}).value || null,
           state_: (document.querySelector('[data-testid="session"]') || {}).dataset?.state || null,
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""


def new_page(browser):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return page


def ask_from_desk(page, origin: str, text: str, expect_posts: int, project: str | None = "upload-endpoint") -> str:
    """Ask from the Desk composer. With `project`, the message names it with an `@project` chip (the
    composer's menu), so the chat is scoped to that project and its repo — the only kind of ask a
    creator proposal can be built from (§4.7; an `everything` ask is repo-less for building)."""
    page.goto(f"{origin}/", wait_until="networkidle")
    box = page.get_by_test_id("desk-composer-input")
    box.wait_for(state="visible", timeout=15000)
    if project is not None:
        box.type("@")
        page.locator('[data-testid="composer-menu"][data-trigger="@"]').wait_for(timeout=10000)
        page.locator('[data-testid="composer-menu-item"]', has_text=project).first.click()
        page.locator('[data-testid="composer-chip"][data-kind="project"]').wait_for(timeout=5000)
        # The chip took the `@` token out of the box; type only once the caret is back at the end of it.
        box.focus()
        box.press("End")
        page.wait_for_timeout(150)
    box.type(text)
    page.wait_for_function("(v) => (document.querySelector('[data-testid=\"desk-composer-input\"]') || {}).value === v", arg=text, timeout=5000)
    box.press("Enter")
    for _ in range(60):
        posts = fixture_get(origin, "/__fixture/ask-posts")["posts"]
        if len(posts) >= expect_posts:
            return posts[-1]["chatId"]
        time.sleep(0.25)
    fail("ask-sent", {"posts": posts})
    return ""


def wait_reply(page, n: int) -> None:
    try:
        page.wait_for_function(f"""() => document.querySelectorAll('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').length === {n}""", timeout=20000)
    except Exception:
        fail(f"reply-{n}", page.evaluate(CARD))


with sync_playwright() as p:
    browser = p.chromium.launch()
    # chat_scope + repo + repo_member: an ask that names the `upload-endpoint` project is scoped to it and
    # its one repo, so the path is repo-bound and a creator proposal is allowed (§4.7); a plain Desk ask
    # (scope `everything`) is repo-less for building — the negative case below.
    set_fixture(origin, sessions=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[], reset_gate_posts=True, chat_scope=True, repo=True, repo_member=True)

    # ── 1. the card ───────────────────────────────────────────────────────────────
    page = new_page(browser)
    chat_id = ask_from_desk(page, origin, "why does greet() not trim its input?", 1)
    page.goto(f"{origin}/s/{chat_id}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    wait_reply(page, 1)
    page.get_by_test_id("session-composer-input").fill("Build this.")
    page.get_by_test_id("session-composer-input").press("Enter")
    wait_reply(page, 2)
    try:
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"session-ask-proposal\"] [data-testid=\"session-proposal-go\"]')", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-ask-path-missing.png"))
        fail("card", page.evaluate(CARD))
    page.wait_for_timeout(300)
    c1 = page.evaluate(CARD)
    page.screenshot(path=str(SHOTS / "desk-ask-path-card.png"))
    pa = c1["lines"][0][1].split(" answers")[0]
    check("card",
          c1["card"] and c1["firstCreator"] == "true" and c1["state"] == "ask"
          and c1["text"] == f"Continue in Build? {pa} proposes: Build → Check (required)."
          and c1["why"].startswith("band 20–39 · touches 2 declared paths · 12 dependents · Continue starts the work on")
          and c1["buttons"] == ["Continue in Build", "Not now", "End"]
          and c1["runs"] == 0 and c1["chain"] == [] and c1["shape"] is not None and not c1["hscroll"], card=c1)
    run_id = fixture_get(origin, f"/api/v1/chats/{chat_id}")["path"]["runId"]

    # ── 2. Not now ────────────────────────────────────────────────────────────────
    page.locator('[data-testid="session-ask-proposal"] [data-testid="session-proposal-not-now"]').click()
    # The one decision path: a 10 s undo window, then the POST.
    for _ in range(80):
        posts = [g for g in fixture_get(origin, "/__fixture/gate-posts")["posts"] if g["runId"] == run_id]
        if posts:
            break
        time.sleep(0.25)
    else:
        fail("not-now-post", page.evaluate(CARD))
    page.wait_for_timeout(600)
    c2 = page.evaluate(CARD)
    page.screenshot(path=str(SHOTS / "desk-ask-path-not-now.png"))
    check("not-now",
          len(posts) == 1 and posts[0]["body"].get("approve") is True
          # the ACCEPTED rev's steps — every answer step so far (answer-1, and answer-2 for "Build this."), no build
          and posts[0]["body"].get("plan", {}).get("steps") == [{"catalog": "understand", "id": "answer-1"}, {"catalog": "understand", "id": "answer-2"}]
          and c2["state"] == "no" and (c2["no"] or "").startswith("Not now — the conversation goes on")
          and c2["runs"] == 0 and c2["state_"] == "waiting", posts=posts, card=c2)
    page.locator('[data-testid="session-ask-proposal"] [data-testid="session-proposal-bring-back"]').click()
    page.wait_for_timeout(200)
    c3 = page.evaluate(CARD)
    check("bring-it-back-prefills", c3["draft"] == "Go ahead with the plan you proposed.", draft=c3["draft"])

    # ── 3. Continue in Build — Bring it back's prefill is sent as it is (the operator's own words) ──
    page.get_by_test_id("session-composer-input").press("Enter")
    wait_reply(page, 3)
    try:
        page.wait_for_function("() => (document.querySelector('[data-testid=\"session-ask-proposal\"] [data-testid=\"session-proposal\"]') || {}).dataset?.state === 'ask'", timeout=15000)
    except Exception:
        fail("re-proposed", page.evaluate(CARD))
    page.locator('[data-testid="session-ask-proposal"] [data-testid="session-proposal-go"]').click()
    for _ in range(80):
        posts = [g for g in fixture_get(origin, "/__fixture/gate-posts")["posts"] if g["runId"] == run_id]
        if len(posts) == 2:
            break
        time.sleep(0.25)
    else:
        fail("continue-post", page.evaluate(CARD))
    try:
        page.wait_for_function("""() => document.querySelectorAll('[data-testid="session-run"]').length === 1
            && !!document.querySelector('[data-testid="chain-step"][data-step-id="build-1"]')""", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-ask-path-chain-missing.png"))
        fail("chain", page.evaluate(CARD))
    page.wait_for_timeout(400)
    c4 = page.evaluate(CARD)
    page.screenshot(path=str(SHOTS / "desk-ask-path-chain.png"))
    chain = dict(c4["chain"])
    check("continue-in-build",
          posts[1]["body"].get("approve") is True and "plan" not in posts[1]["body"]
          and c4["runs"] == 1 and c4["shape"] is None and not c4["card"]
          # The chain line's own words: the floor-added review reads "Review added" (S6a marks floor steps).
          and chain.get("Build") == "running" and any(k.startswith("Review") and v == "todo" for k, v in chain.items()) and any(k.startswith("Answer") and v == "done" for k, v in chain.items())
          and not c4["hscroll"], posts=posts, card=c4)
    page.close()

    # ── 4. End ────────────────────────────────────────────────────────────────────
    page = new_page(browser)
    chat2 = ask_from_desk(page, origin, "Build this: make greet() trim", 4)
    page.goto(f"{origin}/s/{chat2}", wait_until="networkidle")
    try:
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"session-ask-proposal\"] [data-testid=\"session-proposal-end\"]')", timeout=30000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-ask-path-card2-missing.png"))
        fail("card-2", {"card": page.evaluate(CARD), "posts": fixture_get(origin, "/__fixture/ask-posts")["posts"][-2:], "runBlock": page.evaluate("() => (document.querySelector('[data-testid=\"session-run\"]') || {}).innerText?.slice(0, 600) || null"),
                        "team": fixture_get(origin, f"/api/v1/runs/{fixture_get(origin, f'/api/v1/chats/{chat2}')['path']['runId']}/team")})
    run2 = fixture_get(origin, f"/api/v1/chats/{chat2}")["path"]["runId"]
    page.locator('[data-testid="session-ask-proposal"] [data-testid="session-proposal-end"]').click()
    for _ in range(80):
        posts2 = [g for g in fixture_get(origin, "/__fixture/gate-posts")["posts"] if g["runId"] == run2]
        if posts2:
            break
        time.sleep(0.25)
    else:
        fail("end-post", page.evaluate(CARD))
    try:
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"ask-line\"][data-kind=\"ended\"]')", timeout=15000)
        # The daemon's run status follows the cancel: the session leaves "waiting" and no run block appears.
        page.wait_for_function("() => (document.querySelector('[data-testid=\"session\"]') || {}).dataset?.state !== 'waiting' && document.querySelectorAll('[data-testid=\"session-run\"]').length === 0", timeout=15000)
    except Exception:
        fail("ended", page.evaluate(CARD))
    page.wait_for_timeout(400)
    c5 = page.evaluate(CARD)
    page.screenshot(path=str(SHOTS / "desk-ask-path-end.png"))
    check("end", len(posts2) == 1 and posts2[0]["body"].get("approve") is False
          and ["ended", "Conversation ended"] in c5["lines"] and c5["state_"] in ("done", "blocked", "quiet")
          and c5["runs"] == 0 and c5["state"] == "cancelled", posts=posts2, card=c5)
    page.close()

    # ── 5. the engine refuses creator work: no repo bound (F11); one seat (D1) — no card, a plain line ──
    page = new_page(browser)
    chat3 = ask_from_desk(page, origin, "Build this: make greet() trim", 5, project=None)  # a plain Desk ask: scope everything
    page.goto(f"{origin}/s/{chat3}", wait_until="networkidle")
    try:
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"ask-line\"][data-kind=\"refused\"]')", timeout=20000)
        # The run keeps its accepted rev and waits at its turn gate: the session settles on "waiting".
        page.wait_for_function("() => (document.querySelector('[data-testid=\"session\"]') || {}).dataset?.state === 'waiting'", timeout=10000)
    except Exception:
        fail("refused-repo", page.evaluate(CARD))
    c6 = page.evaluate(CARD)
    page.screenshot(path=str(SHOTS / "desk-ask-path-refused-repo.png"))
    refused = [l for l in c6["lines"] if l[0] == "refused"]
    check("refused-no-repo", not c6["card"] and len(refused) == 1 and refused[0][1].startswith("This conversation isn’t attached to a repo")
          and c6["state_"] == "waiting", card=c6)
    page.close()
    set_fixture(origin, ask_one_seat=True)
    page = new_page(browser)
    chat4 = ask_from_desk(page, origin, "Build this: make greet() trim", 6)
    page.goto(f"{origin}/s/{chat4}", wait_until="networkidle")
    try:
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"ask-line\"][data-kind=\"refused\"]')", timeout=20000)
        page.wait_for_function("() => (document.querySelector('[data-testid=\"session\"]') || {}).dataset?.state === 'waiting'", timeout=10000)
    except Exception:
        fail("refused-seat", page.evaluate(CARD))
    c7 = page.evaluate(CARD)
    page.screenshot(path=str(SHOTS / "desk-ask-path-refused-seat.png"))
    refused = [l for l in c7["lines"] if l[0] == "refused"]
    check("refused-one-seat", not c7["card"] and len(refused) == 1 and refused[0][1].startswith("Can’t build from here: only")
          and c7["state_"] == "waiting", card=c7)
    page.close()

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
