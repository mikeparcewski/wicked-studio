#!/usr/bin/env python3
"""
desk_chat_live_test.py — a working chat turn says what it is doing, and after a while offers "Check on it?"
(operator 2026-10-30: "On the 'studio working' activity in the chat, people get impatient. We should be broadcasting
live events happening (or summaries) … and if it's been running long you can have an agent analyze right there").

Against the fixture's `ask_path` replay with `ask_hold`: the ask turn stays "thinking", its engine frames say it was
dispatched 4 min ago, read three files under packages/crew/src/api, is searching, and has used 415k tokens ($0.21).

  1. THE DOCK (system chat): under the chat, the live list — the meter "Claude · 4 min … · 415k tokens · $0.21",
     the rolling line, the tool rows, the seat's newest words — and, past 3 min, the guided ask "Check on it?".
  2. THE SESSION PAGE (/s/<chat>): the same under "<pa> is thinking".
  3. CHECK ON IT: one POST /runs/:id/units/:ord/inspect; "Checking with codex · it only reads"; then the verdict card
     (Looping, codex checked · read only · this check: 38k tokens · $0.04, evidence, What now? with Steer preselected
     and its note filled in). Nothing is sent until the person chooses: Let it run → one record line, no inject.
  4. Desktop 1440x700 and phone 390x844, dark and light; 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-chat-live-*.png. Env: FEEDBACK_PORT (default 4691).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4691"))
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(1)


def get(origin: str, path: str):
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())


def post(origin: str, path: str, body: dict) -> None:
    req = urllib.request.Request(f"{origin}{path}", method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        res.read()


def frames(run_id: str, ord_: int, ago_s: int = 250) -> list[dict]:
    """The engine frames of a turn working for `ago_s` seconds (what a reload has to be told again)."""
    now = int(time.time() * 1000)
    t0 = now - ago_s * 1000
    base = {"session": run_id, "ord": ord_, "attempt": 0}
    out = [{"type": "unitDispatched", "ts": t0}, {"type": "unitExecuting", "ts": t0}]
    for i, (dt, tool, kind, target, state) in enumerate([
        (50, "Read", "read", "packages/crew/src/api/routes.ts", "finished"),
        (20, "Read", "read", "packages/crew/src/api/server.ts", "finished"),
        (12, "Read", "read", "packages/crew/src/api/audit.ts", "finished"),
        (4, "Grep", "search", "isHumanOperator", "started"),
    ]):
        out.append({"type": "toolActivity", "at": now - dt * 1000, "ts": now - dt * 1000, "id": f"j{i}", "state": state, "kind": kind,
                    "tool": tool, "target": target, "ok": True if state == "finished" else None, "durationMs": 30 if state == "finished" else None})
    out.append({"type": "usageProgress", "at": now - 3000, "ts": now - 3000, "inputTokens": 412_000, "outputTokens": 3_100, "costUsd": 0.21})
    out.append({"type": "unitOutputDelta", "text": "Reading how crew decides who may answer a gate."})
    return [{**base, **f} for f in out]


LOOK = """() => {
  const t = (s, root = document) => { const el = root.querySelector(s); return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
  return { meter: t('[data-testid="live-meter"]'), rolling: t('[data-testid="live-rolling"]'),
           rows: [...document.querySelectorAll('[data-testid="live-activity-row"]')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()),
           said: t('[data-testid="live-activity-said"]'),
           check: (document.querySelector('[data-testid="inflight-check"]') || {}).dataset?.state || null,
           q: t('[data-testid="inflight-check-q"]'), verdict: t('[data-testid="inflight-check-verdict"]'), by: t('[data-testid="inflight-check-by"]'),
           doing: t('[data-testid="inflight-check-doing"]'), progress: t('[data-testid="inflight-check-progress"]'),
           evidence: t('[data-testid="inflight-check-evidence"]'),
           steer: (document.querySelector('[data-testid="inflight-check-opt-steer"]') || {}).getAttribute?.('aria-checked') ?? null,
           note: (document.querySelector('[data-testid="inflight-check-note"]') || {}).value ?? null,
           record: t('[data-testid="inflight-check-record"]'),
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

errors: list[str] = []


def new_page(browser, w: int, h: int, theme: str):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, color_scheme=theme)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme})
    return ctx, page


def shot(page, name: str, sel: str | None = None) -> None:
    if sel is not None and page.locator(sel).count() > 0:
        page.locator(sel).first.evaluate("(el) => el.scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / name))


SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, sessions=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[], chat_scope=True,
                ask_hold=True, ask_hold_started_ago_s=240)

    # ── 1. the dock ─────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 1440, 700, "dark")
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-chat").click()
    box = page.get_by_test_id("assist-input")
    box.wait_for(state="visible", timeout=15000)
    box.fill("Who may answer a gate in crew, and where is that checked?")
    page.get_by_test_id("assist-send").click()
    chat_id = ""
    for _ in range(60):
        posts = get(origin, "/__fixture/ask-posts")["posts"]
        if posts:
            chat_id = posts[-1]["chatId"]
            break
        time.sleep(0.25)
    if chat_id == "":
        fail("ask-sent", {"posts": posts})
    try:
        page.locator('[data-testid="assist-chat"] [data-testid="inflight-check"]').wait_for(timeout=20000)
    except Exception:  # noqa: BLE001
        fail("1-dock", page.evaluate(LOOK))
    page.wait_for_timeout(600)
    dock = page.evaluate(LOOK)
    shot(page, "desk-chat-live-dock-1440-dark.png")
    check("1-dock", dock["meter"] is not None and "4 min" in dock["meter"] and "415k tokens" in dock["meter"] and "$0.21" in dock["meter"]
          and dock["check"] == "ask" and dock["q"] is not None and dock["q"].startswith("This has been running 4 min")
          and any("Searching isHumanOperator" in r for r in dock["rows"]) and dock["said"] is not None, dock=dock)
    detail = get(origin, f"/api/v1/chats/{chat_id}")
    run_id = detail["path"]["runId"]
    ctx.close()

    # ── 2–4. the session page: desktop and phone, dark and light ─────────────────────────────────
    for (w, h, theme) in ((1440, 700, "dark"), (1440, 700, "light"), (390, 844, "dark"), (390, 844, "light")):
        tag = f"{w}-{theme}"
        ctx, page = new_page(browser, w, h, theme)
        post(origin, "/__fixture", {"reset_inspections": True})
        page.goto(f"{origin}/s/{chat_id}", wait_until="networkidle")
        try:
            page.locator('[data-testid="ask-typing"]').first.wait_for(timeout=15000)
        except Exception:  # noqa: BLE001
            fail(f"2-thinking-{tag}", page.evaluate(LOOK))
        post(origin, "/__fixture/broadcast", {"frames": frames(run_id, 1)})
        try:
            page.locator('[data-testid="inflight-check"][data-state="ask"]').wait_for(timeout=15000)
        except Exception:  # noqa: BLE001
            fail(f"2-live-{tag}", page.evaluate(LOOK))
        page.wait_for_timeout(500)
        live = page.evaluate(LOOK)
        shot(page, f"desk-chat-live-ask-{tag}.png", '[data-testid="inflight-check"]')
        check(f"2-live-{tag}", live["meter"] is not None and "415k tokens" in live["meter"] and live["rolling"] is not None
              and len(live["rows"]) >= 3 and not live["hscroll"], live=live)

        before = 0
        injects = len(get(origin, "/__fixture/inject-posts")["posts"])
        page.get_by_test_id("inflight-check-yes").click()
        try:
            page.locator('[data-testid="inflight-check"][data-state="checking"]').wait_for(timeout=5000)
        except Exception:  # noqa: BLE001
            fail(f"3-checking-{tag}", page.evaluate(LOOK))
        checking = page.evaluate("() => document.querySelector('[data-testid=\"inflight-check\"]').innerText.replace(/\\s+/g, ' ').trim()")
        shot(page, f"desk-chat-live-checking-{tag}.png", '[data-testid="inflight-check"]')
        try:
            page.locator('[data-testid="inflight-check"][data-state="done"]').wait_for(timeout=12000)
        except Exception:  # noqa: BLE001
            fail(f"3-verdict-{tag}", page.evaluate(LOOK))
        page.wait_for_timeout(500)
        verdict = page.evaluate(LOOK)
        shot(page, f"desk-chat-live-verdict-{tag}.png", '[data-testid="inflight-check"]')
        posts = get(origin, "/__fixture/inspect-posts")["posts"]
        check(f"3-verdict-{tag}", len(posts) == before + 1 and posts[-1] == {"runId": run_id, "ord": 1}
              and "Checking with codex · it only reads" in checking
              and verdict["verdict"] == "Looping" and verdict["by"] == "codex checked · read only · this check: 38k tokens · $0.04"
              and verdict["steer"] == "true" and (verdict["note"] or "").startswith("You have the auth check already")
              and "routes.ts 4 times" in (verdict["evidence"] or "") and not verdict["hscroll"]
              and len(get(origin, "/__fixture/inject-posts")["posts"]) == injects, verdict=verdict, checking=checking, posts=posts[-2:])
        page.get_by_test_id("inflight-check-opt-let_run").click()
        page.get_by_test_id("inflight-check-commit").click()
        page.locator('[data-testid="inflight-check-record"]').wait_for(timeout=5000)
        chose = page.evaluate(LOOK)
        shot(page, f"desk-chat-live-chosen-{tag}.png", '[data-testid="inflight-check-record"]')
        check(f"4-chosen-{tag}", (chose["record"] or "").startswith("You chose: Let it run")
              and len(get(origin, "/__fixture/inject-posts")["posts"]) == injects, chose=chose)
        ctx.close()
    post(origin, "/__fixture", {"ask_release": True})
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2, ensure_ascii=False))
