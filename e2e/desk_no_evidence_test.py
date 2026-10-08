#!/usr/bin/env python3
"""
desk_no_evidence_test.py — S17c (DES-STUDIO-REBUILD-001 Amendment 5): a terminal run with no
checked governance entries says so once ("No governance evidence was recorded for this run —
it ended <ago>"), the reasons are only under ⋯ (closed by default), and the chain sentence
adds "· nothing checked".

Against the in-process fixture at 1440x700 under STUDIO_SKIN=desk:

  1. NO-EVIDENCE LINE: r-pay-1's run page shows the one line, not individual reason bullets.
  2. REASONS CLOSED: the disclosure starts closed; ⋯ opens it; 8 entries visible.
  3. CHAIN SENTENCE: the session thread's RunBlock for r-pay-1 says "2 of 2 done · nothing checked".
  4. LIVE-RUN BOUNDARY: b1's run page still shows the live "Not checked on this run: …" line.
  5. 0 page errors.

Captures: e2e/shots/desk-no-evidence*.png.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4349"))
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

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

# 8 not_checked entries served by the Playwright route for r-pay-1.
R_PAY_1_COVERAGE = [
    {"entry_id": "scope-drift", "state": "not_checked", "reason": "no declared scope"},
    {"entry_id": "claim-vs-evidence", "state": "not_checked", "reason": "no evidence file"},
    {"entry_id": "test-coverage", "state": "not_checked", "reason": "no test report"},
    {"entry_id": "security-scan", "state": "not_checked", "reason": "no scan output"},
    {"entry_id": "license-check", "state": "not_checked", "reason": "no license manifest"},
    {"entry_id": "dependency-audit", "state": "not_checked", "reason": "no audit log"},
    {"entry_id": "change-description", "state": "not_checked", "reason": "no description"},
    {"entry_id": "deployment-target", "state": "not_checked", "reason": "no target declared"},
]


def route_watch(route, request) -> None:
    """Intercept GET /api/v1/watch: serve 8 not_checked for r-pay-1; fall through for everything else."""
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(request.url).query)
    run = (q.get("run") or [None])[0]
    if run == "r-pay-1":
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"findings": [], "cleared": [], "coverage": R_PAY_1_COVERAGE}),
        )
    else:
        route.fallback()


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, sessions=True, run_chat_id=True, watch_feed=True)
    page.route("**/api/v1/watch*", route_watch)

    # ── 1. no-evidence line on r-pay-1's run page ──────────────────────────────────
    page.goto(f"{origin}/runs/r-pay-1", wait_until="networkidle")
    try:
        page.get_by_test_id("watch-coverage").wait_for(state="visible", timeout=10000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-no-evidence-missing.png"))
        fail("no-evidence-line", "watch-coverage not visible on r-pay-1's run page")
    cov = page.get_by_test_id("watch-coverage").inner_text()
    check(
        "no-evidence-line",
        cov.startswith("No governance evidence was recorded for this run — it ended "),
        line=cov,
    )

    # ── 2a. disclosure closed by default ───────────────────────────────────────────
    reasons_count_before = page.get_by_test_id("watch-coverage-reasons").count()
    check("reasons-closed", reasons_count_before == 0, count=reasons_count_before)

    # ── 2b. ⋯ opens the disclosure with all 8 entries ──────────────────────────────
    page.get_by_test_id("watch-coverage-toggle").click()
    try:
        page.get_by_test_id("watch-coverage-reasons").wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001
        fail("reasons-open", "watch-coverage-reasons not visible after clicking ⋯")
    li_count = page.get_by_test_id("watch-coverage-reasons").locator("li").count()
    check("reasons-count", li_count == 8, count=li_count)
    page.screenshot(path=str(SHOTS / "desk-no-evidence.png"))

    # ── 3. chain sentence in the session thread ─────────────────────────────────────
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    try:
        page.wait_for_function(
            "() => !!document.querySelector('[data-testid=\"session-run\"][data-run-id=\"r-pay-1\"] [data-testid=\"chain-sentence\"]')",
            timeout=12000,
        )
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-no-evidence-chain-missing.png"))
        fail("chain-nothing-checked", "chain-sentence not visible in r-pay-1 RunBlock")
    sentence = page.evaluate(
        "() => document.querySelector('[data-testid=\"session-run\"][data-run-id=\"r-pay-1\"] [data-testid=\"chain-sentence\"]').textContent"
    )
    check("chain-nothing-checked", sentence.endswith("· nothing checked"), sentence=sentence)
    page.screenshot(path=str(SHOTS / "desk-no-evidence-chain.png"))

    # ── 4. live-run boundary: b1 still shows per-entry line ────────────────────────
    set_fixture(origin, sessions=False, wave1=True, gate_now=["b1"], watch_feed=True)
    page.goto(f"{origin}/runs/b1", wait_until="networkidle")
    try:
        page.get_by_test_id("watch-coverage").wait_for(state="visible", timeout=10000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-no-evidence-b1-missing.png"))
        fail("live-run-unchanged", "watch-coverage not visible on b1's run page")
    cov_b1 = page.get_by_test_id("watch-coverage").inner_text()
    check(
        "live-run-unchanged",
        cov_b1 == "Not checked on this run: scope drift (no declared scope)",
        line=cov_b1,
    )
    page.screenshot(path=str(SHOTS / "desk-no-evidence-b1.png"))

    # ── 5. 0 page errors ───────────────────────────────────────────────────────────
    check("no-errors", not errors, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
