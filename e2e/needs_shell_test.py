#!/usr/bin/env python3
"""
needs_shell_test.py — the Needs-you queue lifted into the APP SHELL (1440x700).

The queue's inputs (live chats, campaigns, repo graphs, pending proposals) are loaded by ONE
app-level store (src/store/needsSources.ts) and folded by ONE hook (src/hooks/useNeedsRows.ts),
so the Desk and peek read the same ranked rows on every route. (Part A — the compact-rail skin's
right rail on every route — retired with the classic skins, S18d.) This journey proves it through
testids and keys only:

  B. PEEK OFF HOME SEES THE WHOLE QUEUE: on a run page, in a healthy
     portfolio with one pending memory proposal, P peeks the PROPOSAL (a Home-only wire before
     the lift); an MCP elicitation then raised on r1 outranks it and P peeks the elicitation.
  C. NO DUPLICATE FETCHING: a cold Home load reads each queue input (GET /chats, /campaigns,
     /proposals, /repos) at most once, and walking Home → run page → /work → Home re-reads none
     of them.

Captures: e2e/shots/needs-shell-{home,run,work}.png, needs-shell-peek-{proposal,elicitation}.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4352). Prints a JSON report; exit 0/1.
"""

import collections
import json
import os
import sys
import time

from uxfix_fixture import (HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4352"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
# S16a-2b: the run's place is its session thread now.
RUN_PAGE = "/s/run%3Ar1"

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


def wait_ok(page, js: str, timeout: int = 10000) -> bool:
    try:
        page.wait_for_function(js, timeout=timeout)
        return True
    except Exception:  # noqa: BLE001 — the caller reports
        return False


# One pending memory proposal (the crew wire: unix-SECONDS created_at).
PROPOSAL = {"id": "prop-1", "kind_type": "memory", "state": "pending",
            "payload": {"content": "Prefer the retry helper over hand-rolled loops", "tier": "semantic"},
            "facets": {"project": "gamma"}, "provenance": {"run": "c1"},
            "created_at": int(time.time()) - 30 * 60}
# The corpus behind C: wave 2b's queue (two simple gates, a failure) plus the proposal.
QUEUE_CORPUS = dict(wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={},
                    extra_frames=[], extra_gates=[], proposals=[PROPOSAL])
QUEUE_INPUTS = ("/api/v1/chats", "/api/v1/campaigns", "/api/v1/proposals", "/api/v1/repos")


def nav(page, path: str) -> None:
    """An in-app navigation (the router's own popstate path) — no reload."""
    page.evaluate(f"() => {{ history.pushState({{}}, '', {json.dumps(path)});"
                  " dispatchEvent(new PopStateEvent('popstate')); }")
    page.wait_for_function(f"() => window.location.pathname === {json.dumps(path)}", timeout=5000)


def new_page(browser):
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return page


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── B. peek on a run page sees a proposal, then an elicitation ────────────────────────
    set_fixture(origin, appearance=None, wave1=True, wave2b=False, simple_gates=[], gate_now=[],
                status_over={}, extra_frames=[], extra_gates=[], proposals=[PROPOSAL])
    page = new_page(browser)
    page.goto(f"{origin}{RUN_PAGE}", wait_until="networkidle")
    page.locator('[data-testid="session-thread"]').wait_for(state="visible", timeout=15000)
    href0 = page.evaluate("() => window.location.href")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")

    def peek_key() -> str | None:
        page.keyboard.press("Alt+p")
        if not wait_ok(page, "() => !!document.querySelector('[data-testid=\"peek-card\"]')", 5000):
            return None
        return page.get_by_test_id("peek-card").get_attribute("data-key")

    got = None
    for _ in range(10):  # the proposal lands asynchronously after boot
        got = peek_key()
        if got == "proposal:prop-1":
            break
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "needs-shell-peek-proposal.png"))
    check("run-page-peek-proposal", got == "proposal:prop-1"
          and page.evaluate("() => window.location.href") == href0,
          peek=got, text=(page.get_by_test_id("peek-card").text_content() if got else None))
    page.keyboard.press("Escape")
    wait_ok(page, "() => !document.querySelector('[data-testid=\"peek-card\"]')", 3000)

    set_fixture(origin, extra_frames=[{"type": "elicitationCreated", "session": "r1",
                                       "elicitationId": "el-r1",
                                       "message": "Which bucket holds the upload limits?",
                                       "options": None}])
    got = None
    for _ in range(12):  # the frame drains on the next /ws tick
        got = peek_key()
        if got == "elicit:r1":
            break
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "needs-shell-peek-elicitation.png"))
    check("run-page-peek-elicitation-outranks-proposal", got == "elicit:r1", peek=got)
    page.keyboard.press("Escape")
    page.close()

    # ── C. no duplicate fetching of the queue's inputs ────────────────────────────────────
    set_fixture(origin, appearance=None, **QUEUE_CORPUS)
    page = new_page(browser)
    counts: collections.Counter = collections.Counter()

    def tap(req) -> None:
        path = req.url.split("?")[0].replace(origin, "")
        if req.method == "GET" and path in QUEUE_INPUTS:
            counts[path] += 1

    page.on("request", tap)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(1500)
    cold = dict(counts)
    check("home-cold-reads-each-input-once", all(cold.get(k, 0) <= 1 for k in QUEUE_INPUTS)
          and all(cold.get(k, 0) == 1 for k in QUEUE_INPUTS[:3]), counts=cold)
    counts.clear()
    nav(page, RUN_PAGE)
    page.wait_for_timeout(1500)
    nav(page, "/everything")
    page.wait_for_timeout(1000)
    nav(page, "/")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(1500)
    walk = dict(counts)
    check("route-walk-rereads-nothing", sum(walk.values()) == 0, counts=walk)
    page.close()

    set_fixture(origin, appearance=None, wave1=False, wave2b=False, simple_gates=[], proposals=None,
                extra_frames=[])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
