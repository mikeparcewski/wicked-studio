#!/usr/bin/env python3
"""
desk_live_activity_test.py — what a working step is doing, live (operator 2026-10-30: "stream every few seconds, like
Claude Code or Codex"), against the `power_mode` corpus (r-pm-build, executing: the orchestrator's turn 3). `/ws` is
played by the journey with the engine's per-tool frames (power-mode-engine's contract: `toolActivity {ord, attempt,
id, state: started|finished, kind, tool, target, ok, durationMs}`), a burst every LIVE_GAP_MS (default 12 s).

  1. LIVE: under the working line, a compact list of the newest tool calls — "Reading src/lib/money.ts", then "Read
     …", "Running the tests `npm test -- jpy`", "Edited src/payments/charge.ts" — with their age; a started call reads
     as running until its finish arrives. Three screenshots LIVE_GAP_MS apart show it change.
  2. IT SAYS ITSELF: the step's own newest line (unitOutputDelta) shows under the list, plain.
  3. ENDS: the turn ends (powerTurnCompleted): the live list folds away and the turn's message carries one summary
     line ("Read … · ran the tests … · edited …").
  4. 0 page errors; at 390x844 the list fits the width.

Captures: e2e/shots/desk-live-activity-{1,2,3,ended}-1440.png, desk-live-activity-390.png. Env: FEEDBACK_PORT
(default 4672), LIVE_GAP_MS (default 12000).
"""

import json
import os
import sys
import time

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4672"))
GAP = int(os.environ.get("LIVE_GAP_MS", "12000"))
SHOTS = REPO / "e2e" / "shots"
RUN = "r-pm-build"
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


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

errors: list[str] = []
sockets: list = []


def new_page(browser, w: int, h: int, theme: str = "dark"):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route_web_socket("**/ws", lambda ws: sockets.append(ws))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, power_mode=True, reset_power=True)
    return ctx, page


def send(frames: list[dict]) -> None:
    for f in frames:
        sockets[-1].send(json.dumps({"session": RUN, "ord": 1, "attempt": 0, **f}))


def tool(id_: str, state: str, kind: str, tool_: str, target: str, ok=None, ms=None) -> dict:
    return {"type": "toolActivity", "at": int(time.time() * 1000), "id": id_, "state": state, "kind": kind, "tool": tool_,
            "target": target, "ok": ok, "durationMs": ms}


def rows(page) -> list[str]:
    return page.locator('[data-testid="live-activity-row"]').evaluate_all(
        "(els) => els.map((e) => (e.dataset.running === 'true' ? '… ' : '') + e.querySelector('.wk-live-text').innerText)")


def shot(page, name: str) -> None:
    box = page.locator('[data-testid="live-activity"]').first
    if box.count() > 0:
        box.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / name))


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = new_page(browser, 1440, 900)
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="domcontentloaded")
    try:
        page.locator('[data-testid="power-switch"]').first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        fail("mount", {"why": "the run page never showed"})
    page.wait_for_timeout(800)
    if not sockets:
        fail("ws", {"why": "studio opened no /ws"})

    # ── 1. live, three moments GAP apart ─────────────────────────────────────────────────────────────
    send([tool("t1", "started", "read", "Read", "src/lib/money.ts"),
          {"type": "unitOutputDelta", "text": "Looking at how money.ts rounds minor units.\n"}])
    page.locator('[data-testid="live-activity-row"]').first.wait_for(timeout=10000)
    page.wait_for_timeout(500)
    m1 = rows(page)
    said1 = page.locator('[data-testid="live-activity-said"]').first.inner_text()
    shot(page, "desk-live-activity-1-1440.png")
    t1 = time.monotonic()

    page.wait_for_timeout(GAP // 2)
    send([tool("t1", "finished", "read", "Read", "src/lib/money.ts", ok=True, ms=120),
          tool("t2", "started", "run", "Bash", "npm test -- jpy")])
    page.wait_for_timeout(GAP - GAP // 2)
    m2 = rows(page)
    shot(page, "desk-live-activity-2-1440.png")
    t2 = time.monotonic()

    page.wait_for_timeout(GAP // 2)
    send([tool("t2", "finished", "test", "Bash", "npm test -- jpy", ok=True, ms=9100),
          tool("t3", "started", "edit", "Edit", "src/payments/charge.ts"),
          tool("t3", "finished", "edit", "Edit", "src/payments/charge.ts", ok=True, ms=40),
          {"type": "unitOutputDelta", "text": "JPY passes now; tightening the charge rounding.\n"}])
    page.wait_for_timeout(GAP - GAP // 2)
    m3 = rows(page)
    said3 = page.locator('[data-testid="live-activity-said"]').first.inner_text()
    shot(page, "desk-live-activity-3-1440.png")
    t3 = time.monotonic()
    check("1-live", m1 == ["… Reading src/lib/money.ts"] and "Read src/lib/money.ts" in m2 and "… Running the tests `npm test -- jpy`" in m2
          and any(r.startswith("Tests passed") for r in m3) and "Edited src/payments/charge.ts" in m3 and m1 != m2 != m3
          and 10 <= t2 - t1 <= 20 and 10 <= t3 - t2 <= 20, m1=m1, m2=m2, m3=m3, gaps=[round(t2 - t1, 1), round(t3 - t2, 1)])
    check("2-says-itself", said1 == "“Looking at how money.ts rounds minor units.”" and said3 == "“JPY passes now; tightening the charge rounding.”", said1=said1, said3=said3)

    # ── 3. the turn ends: one summary line on its message ────────────────────────────────────────────
    send([{"type": "powerTurnCompleted", "turn": 3, "cli": "claude", "outcome": "checkpoint", "summary": "JPY rounding fixed."}])
    page.wait_for_timeout(1500)
    sums = page.locator('[data-testid="activity-summary"]').all_inner_texts()
    shot(page, "desk-live-activity-ended-1440.png")
    live_left = page.locator('[data-testid="live-activity"]').count()
    check("3-ends", any("Read 1 file" in s and "ran the tests once" in s and "edited" in s for s in sums) and live_left == 0, summaries=sums, live=live_left)
    ctx.close()

    # ── 4. phone ─────────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844, theme="light")
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="domcontentloaded")
    page.locator('[data-testid="power-switch"]').first.wait_for(state="visible", timeout=20000)
    page.wait_for_timeout(800)
    send([tool("p1", "started", "run", "Bash", "npm test -- payments/charge.test.ts --reporter=dot --run")])
    page.locator('[data-testid="live-activity-row"]').first.wait_for(timeout=10000)
    fit = page.evaluate("""() => { const b = document.querySelector('[data-testid=live-activity]').getBoundingClientRect();
      return { right: Math.round(b.right), vw: innerWidth, hscroll: document.documentElement.scrollWidth > innerWidth }; }""")
    shot(page, "desk-live-activity-390.png")
    check("4-phone", fit["right"] <= fit["vw"] and not fit["hscroll"], fit=fit)
    ctx.close()
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2, ensure_ascii=False))
