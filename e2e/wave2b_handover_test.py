#!/usr/bin/env python3
"""
wave2b_handover_test.py — studio wave 2b, behaviour 1: HANDOVER ON ARRIVAL (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` + `wave2b` corpora.
The operator's last visit is seeded 3 hours ago (localStorage, before the app boots). Since
then: f1 failed an hour ago, d1 completed two hours ago, g1 waits at a simple gate, and the
stall watchdog (a SYSTEM actor) escalated r1 — a `run.stall.escalated` audit entry, read
through `GET /audit?since=`.

  1. Loading `/` opens the handover panel: four sections in a fixed order — decisions due,
     what broke, what finished, what the system did — with counts 1/1/1/1.
  2. Each row links to its run.
  3. Dismiss; reload; the panel is gone (it returns only after the next absence).

Capture: e2e/shots/wave2b-handover.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4346). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4346"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
HOUR_MS = 3_600_000

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


SECTIONS = """() => [...document.querySelectorAll('[data-testid="handover-section"]')].map(s => ({
  section: s.dataset.section, count: Number(s.dataset.count),
  rows: [...s.querySelectorAll('[data-testid="handover-row"]')].map(r => r.getAttribute('href'))}))"""

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
    # The last visit, 3 h ago — seeded ONCE per tab, before the app's first script runs.
    page.add_init_script(
        "if (!sessionStorage.getItem('w2b.seeded')) { sessionStorage.setItem('w2b.seeded', '1'); "
        f"localStorage.setItem('studio.visit', JSON.stringify({{ lastSeenAt: Date.now() - {3 * HOUR_MS} }})); }}")

    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1"], gate_now=[],
                status_over={}, extra_frames=[])
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "wave2b-handover-missing.png"))
        fail("handover-shows", "no handover panel after a 3 h absence")
    try:
        page.wait_for_function(
            """() => { const s = [...document.querySelectorAll('[data-testid="handover-section"]')];
                       return s.length === 4 && s.every(x => Number(x.dataset.count) >= 1); }""",
            timeout=10000)
    except Exception:
        fail("four-sections", f"sections: {page.evaluate(SECTIONS)}")

    secs = page.evaluate(SECTIONS)
    check("fixed-order",
          [s["section"] for s in secs] == ["decisions", "broke", "finished", "system"],
          sections=[s["section"] for s in secs])
    check("counts-1-1-1-1", [s["count"] for s in secs] == [1, 1, 1, 1],
          counts=[s["count"] for s in secs])
    want = {"decisions": "g1", "broke": "f1", "finished": "d1", "system": "r1"}
    links_ok = all(len(s["rows"]) == 1 and s["rows"][0] is not None and want[s["section"]] in s["rows"][0]
                   for s in secs)
    check("rows-link-to-runs", links_ok, rows={s["section"]: s["rows"] for s in secs})
    page.screenshot(path=str(SHOTS / "wave2b-handover.png"))

    # A row is a real link: clicking the broken run opens it.
    page.locator('[data-testid="handover-section"][data-section="broke"] [data-testid="handover-row"]').click()
    try:
        page.wait_for_function("() => window.location.pathname.includes('f1')", timeout=5000)
    except Exception:
        fail("row-click-opens-run", page.evaluate("() => window.location.pathname"))
    check("row-click-opens-run", True, path=page.evaluate("() => window.location.pathname"))
    page.go_back()
    page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=10000)

    # ── dismiss, reload: gone until the next absence ───────────────────────────
    page.get_by_test_id("handover-dismiss").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"handover-panel\"]')", timeout=3000)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    check("dismissed-stays-gone", page.locator('[data-testid="handover-panel"]').count() == 0)

    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], status_over={}, extra_frames=[])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
