#!/usr/bin/env python3
"""
standing_orders_test.py — Studio OS behaviour 10: STANDING ORDERS (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` + `wave2b` corpora and
the `standing_orders` surface on. The fixture emulates crew's evaluator (crew's own journey,
wicked-crew tests/standing-orders-journey.test.ts, proves the daemon half): an active approve
order answers a matching open gate and writes crew's `gate.decided` line with the order as actor.

  1. Home shows the Standing-orders strip. Manage → type "Auto-approve intake on project alpha"
     → "Read it back" → the rule is SAID BACK in plain words; nothing is stored yet.
  2. Keep it → the order is listed.
  3. An order that would approve the deliver gate is refused in words and cannot be kept.
  4. Mark yourself away → the intake gate on alpha (g1) clears within 5 s (beta's g2 stays).
  5. The handover after the absence lists the order's action, NAMING the order, linking to g1.

Capture: e2e/shots/standing-orders-<skin>.png. Skin: STUDIO_SKIN (studio | compact-rail).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4347). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4347"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
HOUR_MS = 3_600_000
ORDER = "Auto-approve intake on project alpha"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def run_status(origin: str, rid: str) -> str | None:
    with urllib.request.urlopen(f"{origin}/api/v1/runs") as r:
        body = json.loads(r.read())
    rows = body if isinstance(body, list) else body.get("runs", [])
    row = next((x for x in rows if x["session"]["id"] == rid), None)
    return None if row is None else row["session"]["status"]


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

    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[],
                status_over={}, extra_frames=[], audit_delay_ms=0, standing_orders=True,
                reset_standing=True)
    page.goto(f"{origin}/", wait_until="domcontentloaded")
    try:
        page.get_by_test_id("standing-orders-panel").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"standing-orders-missing-{STUDIO_SKIN}.png"))
        fail("panel-shows", "no standing-orders panel on Home")
    check("panel-shows", True)

    # ── 1. words → the rule said back ─────────────────────────────────────────
    page.get_by_test_id("standing-orders-toggle").click()
    page.get_by_test_id("standing-order-input").fill(ORDER)
    page.get_by_test_id("standing-order-parse").click()
    words_el = page.get_by_test_id("standing-order-words")
    try:
        words_el.wait_for(state="visible", timeout=5000)
    except Exception:
        fail("rule-said-back", page.get_by_test_id("standing-orders-panel").inner_text())
    words = words_el.inner_text()
    check("rule-said-back", words == "While you are away: approve the intake gate on project alpha", words=words)
    with urllib.request.urlopen(f"{origin}/api/v1/standing-orders") as r:
        stored = json.loads(r.read())
    check("nothing-stored-before-confirm", stored["orders"] == [], orders=stored["orders"])

    # ── 2. keep it ───────────────────────────────────────────────────────────
    page.get_by_test_id("standing-order-confirm").click()
    try:
        page.get_by_test_id("standing-order-row").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("order-listed", page.get_by_test_id("standing-orders-panel").inner_text())
    check("order-listed", ORDER in page.get_by_test_id("standing-order-row").inner_text())

    # ── 3. the invariant, said ────────────────────────────────────────────────
    page.get_by_test_id("standing-order-input").fill("approve every deliver")
    page.get_by_test_id("standing-order-parse").click()
    refused = page.get_by_test_id("standing-order-refused")
    refused.wait_for(state="visible", timeout=5000)
    check("deliver-refused",
          "deliver gate" in refused.inner_text() and page.get_by_test_id("standing-order-confirm").is_disabled(),
          text=refused.inner_text())
    page.get_by_test_id("standing-order-cancel").click()
    check("g1-still-waiting-while-present", run_status(origin, "g1") == "awaiting_human")
    page.screenshot(path=str(SHOTS / f"standing-orders-{STUDIO_SKIN}.png"))

    # ── 4. away → the intake gate on alpha clears within 5 s ─────────────────
    page.evaluate(f"localStorage.setItem('studio.visit', JSON.stringify({{ lastSeenAt: Date.now() - {HOUR_MS} }}))")
    t0 = time.time()
    page.get_by_test_id("standing-orders-away").click()
    try:
        page.wait_for_function(
            "() => document.querySelector('[data-testid=\"standing-orders-away\"]')?.getAttribute('aria-pressed') === 'true'",
            timeout=5000)
    except Exception:
        fail("away-on", page.get_by_test_id("standing-orders-panel").inner_text())
    cleared = False
    while time.time() - t0 < 5:
        if run_status(origin, "g1") != "awaiting_human":
            cleared = True
            break
        time.sleep(0.2)
    check("intake-gate-cleared-within-5s", cleared, seconds=round(time.time() - t0, 2))
    check("other-project-untouched", run_status(origin, "g2") == "awaiting_human")

    # ── 5. the handover names the order ───────────────────────────────────────
    page.reload(wait_until="domcontentloaded")
    try:
        page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            """() => { const s = document.querySelector('[data-testid="handover-section"][data-section="system"]');
                       return s && s.dataset.state === 'ready'; }""", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"standing-orders-handover-missing-{STUDIO_SKIN}.png"))
        fail("handover", "no handover after the absence")
    rows = page.evaluate("""() => [...document.querySelectorAll(
        '[data-testid="handover-section"][data-section="system"] [data-testid="handover-row"]')]
        .map(r => ({ text: r.innerText, href: r.getAttribute('href') }))""")
    named = [r for r in rows if f'Standing order "{ORDER}" approved a gate for you' in r["text"]]
    check("handover-names-the-order", len(named) == 1 and "g1" in (named[0]["href"] or ""), rows=rows)
    page.screenshot(path=str(SHOTS / f"standing-orders-handover-{STUDIO_SKIN}.png"))
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
