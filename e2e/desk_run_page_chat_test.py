#!/usr/bin/env python3
"""
desk_run_page_chat_test.py — H3 (DES-EDITOR-PLUGIN-CONTRACT-001 §2 goal 2, §7.2): the run page is the chat,
with the ONE host panel beside it (option B), at 1440x700 in both themes, and the ribbon below 1200 px.

Against the fixture's runs it proves, at `/s/run:r-review` (paused at a review gate) and `/s/run:r-walk-demo`
(a finished demo run):

  1. PANEL B: the session sits in a frame beside the host panel (400 css px, flush right); the panel's Run tab
     names the workflow, the phases with the current one, the agents and their roles, checks and spend, and the
     actions (Look underneath, Tech details). The thread never runs under the panel; no horizontal scroll.
  2. WHO RESPONDED: every thread entry that is not a chat bubble sits under a "who" line; each line says seat,
     you or crew (`data-role`), and the run's own block is crew's.
  3. THE GATE CARD is the chat's: in the decision dock under the thread, its marker in the run's block (the panel
     holds no gate card).
  4. LOOK UNDERNEATH from the Run tab opens the run's sheet.
  5. NARROW (1100x700): no ribbon line over the chat; the header's Details opens the panel over the page
     (DES-CHAT-NATIVE-RUN: the panel is closed by default and opened from Details, wide or narrow).
  6. 0 page errors.

Captures: e2e/shots/desk-run-page-chat-{review,demo}-{light,dark}.png, desk-run-page-chat-narrow{,-open}-light.png.
Env: FEEDBACK_PORT (default 4481).
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server, open_details

PORT = int(os.environ.get("FEEDBACK_PORT", "4481"))
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

PAGE = """() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const panel = document.querySelector('[data-testid="host-panel"]');
  const tab = panel ? panel.querySelector('[data-testid="run-tab"]') : null;
  const thread = document.querySelector('[data-testid="session-thread"]');
  const txt = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
  return {
    frame: !!document.querySelector('[data-testid="session-frame"] > [data-testid="session"]'),
    panel: r(panel), thread: r(thread), ribbon: r(document.querySelector('[data-testid="host-panel-ribbon"]')),
    runTab: tab ? {
      workflow: txt(tab.querySelector('[data-testid="run-tab-workflow"]')),
      phases: [...tab.querySelectorAll('[data-testid="run-tab-phase"]')].map((p) => ({ label: txt(p), current: p.dataset.current === 'true' })),
      agents: [...tab.querySelectorAll('[data-testid="run-tab-agent"]')].map(txt),
      checks: txt(tab.querySelector('[data-testid="run-tab-checks"]')),
      sections: [...tab.querySelectorAll('[data-testid="run-panel-section"]')].map((s) => s.dataset.section), tech: !!tab.querySelector('[data-testid="run-tab-tech"]'),
    } : null,
    who: [...document.querySelectorAll('[data-testid="session-thread"] [data-testid="turn-who"]')].map((w) => ({ role: w.dataset.role, text: txt(w) })),
    // ui-v2 gate: the gate card is in the decision dock between the thread and the composer (never the panel); the
    // run's block in the thread keeps its marker where the question was asked.
    gateInThread: !!document.querySelector('[data-testid="session-thread"] [data-testid="session-run"] [data-testid="decision-marker"]')
      && !!document.querySelector('[data-testid="decision-dock"] [data-testid="session-gate-row"]')
      && !(panel && panel.contains(document.querySelector('[data-testid="decision-dock"]'))),
    gateInPanel: !!(panel && panel.querySelector('[data-testid="session-gate-row"]')),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""


def open_run(page, run_id: str, theme: str) -> dict:
    # r-review is served (paused at its review gate) under gate_move; r-walk-demo under walkthrough.
    flags = ({"gate_move": True, "walkthrough": False, "sessions": False, "run_chat_id": False} if run_id == "r-review"
             else {"gate_move": False, "walkthrough": True, "walk_recorded": 3, "extra_frames": [], "reset_walkthrough": True,
                   "sessions": True, "run_chat_id": True})
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, **flags)
    page.goto(f"{origin}/s/run%3A{run_id}", wait_until="networkidle")
    try:
        page.get_by_test_id("session-run").first.wait_for(state="visible", timeout=15000)
        # Operator 2026-10-18: the panel is open by default; closed (remembered), its edge handle opens it.
        open_details(page)
        page.locator('[data-testid="host-panel"] [data-testid="run-tab"]').wait_for(state="visible", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-run-page-chat-{run_id}-missing.png"))
        fail(f"{run_id}-{theme}-open", {"why": "no run block or no host panel Run tab", "found": page.evaluate(PAGE)})
    page.wait_for_timeout(600)
    return page.evaluate(PAGE)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    for theme in ("light", "dark"):
        # ── 1-3. the gated run: panel B, who responded, the gate card inline ─────────────────────
        d = open_run(page, "r-review", theme)
        page.screenshot(path=str(SHOTS / f"desk-run-page-chat-review-{theme}.png"))
        rt = d["runTab"] or {}
        check(f"{theme}-panel-b", d["frame"] and d["panel"] is not None and d["panel"]["w"] == 400 and d["panel"]["r"] == W
              and d["thread"] is not None and d["thread"]["r"] <= d["panel"]["l"] and not d["hscroll"]
              and bool(rt.get("workflow")) and len(rt.get("phases", [])) > 0 and rt.get("sections") == ["now", "plan", "changes", "checks", "agents", "record"] and rt.get("tech")
              and rt.get("checks") is not None, page=d)
        check(f"{theme}-who-responded", len(d["who"]) > 0 and all(w["role"] in ("seat", "operator", "crew") for w in d["who"])
              and d["who"][0]["role"] in ("operator", "crew") and any(w["role"] == "crew" for w in d["who"]), who=d["who"])
        check(f"{theme}-gate-inline", d["gateInThread"] and not d["gateInPanel"], page={k: d[k] for k in ("gateInThread", "gateInPanel")})

        # The finished demo run: its artifact in the thread, the panel beside it.
        d2 = open_run(page, "r-walk-demo", theme)
        page.screenshot(path=str(SHOTS / f"desk-run-page-chat-demo-{theme}.png"))
        check(f"{theme}-demo-panel", d2["panel"] is not None and d2["thread"]["r"] <= d2["panel"]["l"] and not d2["hscroll"]
              and any(w["role"] == "seat" and "made" in (w["text"] or "") for w in d2["who"]), who=d2["who"], panel=d2["panel"])

    # ── 4. Look underneath is the same panel: the Plan section's steps fold, no sheet over the page ──────────
    plan = page.locator('[data-testid="host-panel"] [data-testid="run-panel-toggle"][data-section="plan"]')
    if plan.get_attribute("aria-expanded") != "true":
        plan.click()
    page.locator('[data-testid="host-panel"] [data-testid="run-panel-item-toggle"][data-item="steps"]').click()
    try:
        page.locator('[data-testid="host-panel"] [data-testid="sheet-step-row"]').first.wait_for(state="visible", timeout=8000)
    except Exception:
        fail("look-underneath", {"why": "the panel's steps fold showed no steps"})
    check("look-underneath", page.get_by_test_id("sheet").count() == 0 and page.get_by_test_id("session-sheet-open").count() == 0)

    # ── 5. narrow: no ribbon line over the chat (DES-CHAT-NATIVE-RUN); Details opens the panel over the page ──
    page.set_viewport_size({"width": 1100, "height": H})
    set_fixture(origin, gate_move=True, walkthrough=False, sessions=False, run_chat_id=False, appearance={**DEFAULT_APPEARANCE, "theme": "light"})
    page.goto(f"{origin}/s/run%3Ar-review", wait_until="networkidle")
    page.get_by_test_id("run-details-handle").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    d3 = page.evaluate(PAGE)
    page.screenshot(path=str(SHOTS / "desk-run-page-chat-narrow-light.png"))
    # Below 1200 px the panel starts behind its right-edge handle (it would cover the chat), never a ribbon line.
    check("narrow-no-ribbon", d3["panel"] is None and d3["ribbon"] is None and not d3["hscroll"]
          and page.get_by_test_id("run-details-handle").get_attribute("aria-expanded") == "false", page=d3)
    page.get_by_test_id("run-details-handle").click()
    page.locator('[data-testid="host-panel"] [data-testid="run-tab"]').wait_for(state="visible", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-run-page-chat-narrow-open-light.png"))
    check("narrow-opens", page.evaluate(PAGE)["panel"] is not None and page.get_by_test_id("run-details-handle").count() == 0)

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
