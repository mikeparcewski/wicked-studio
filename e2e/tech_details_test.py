#!/usr/bin/env python3
"""
tech_details_test.py — DES-studio-rebuild S3, "Show technical details" (1440x700).

Runs against the shared fixture (uxfix_fixture.py) with the `wave1` corpus, b1 at a gate and a
`base_commit` on b1 (`session_over`). The preference is one switch in Settings, off by default,
saved as `studio.view` = {technical_details: bool} through PUT /api/v1/settings (DESIGN-simple §4).

  1. Off by default: the run's head in its session thread (S16a-1d), the gate card and the Runs list
     row show no handles.
  2. Settings › "Show technical details" is unchecked; turning it on PUTs `studio.view` and the
     fixture's settings store holds {technical_details: true}.
  3. After a full reload the switch is still on, and all three surfaces show the run id, the
     7-char base sha and the seat names, in small grey type.
  4. Turning it off hides them again, and that persists through a reload too.

Every page: 0 page errors, no horizontal scroll. Shots: e2e/shots/tech-details-{off,on}.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4371). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4371"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SHA = "a41c9e2b7d0f5e6a9c8b"

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


def stored_view(origin: str):
    with urllib.request.urlopen(f"{origin}/api/v1/settings", timeout=10) as res:
        return json.loads(res.read())["settings"].get("studio.view")


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
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    puts: list = []
    page.on("request", lambda r: puts.append(r.post_data or "")
            if r.method == "PUT" and r.url.endswith("/api/v1/settings") else None)

    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=[], status_over={}, extra_gates=[],
                session_over={"b1": {"base_commit": SHA, "clis": ["claude", "codex"]}},
                view_prefs=None, reset_gate_posts=True)

    def no_hscroll(step: str) -> None:
        sw = page.evaluate("() => document.documentElement.scrollWidth")
        check(step, sw <= W, scroll_width=sw)

    def run_page() -> None:
        # The gate card's handle (`tech-gate`) is still read on the run page's gate card.
        page.goto(f"{origin}/p/beta/build/b1", wait_until="networkidle")
        page.get_by_test_id("run-header").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("steering-gate").wait_for(state="visible", timeout=15000)

    def session_page() -> None:
        # S16a-1d: the run's handles ride its run block's head in the session thread.
        page.goto(f"{origin}/s/run%3Ab1", wait_until="networkidle")
        page.locator('[data-testid="session-run"][data-run-id="b1"]').wait_for(state="visible", timeout=15000)

    def runs_list() -> None:
        # S15c: /work moved onto "See everything › Sessions"; a live run is a session row there.
        page.goto(f"{origin}/work", wait_until="networkidle")
        page.locator('[data-testid="everything-session"][data-run-id="b1"]').first.wait_for(state="visible", timeout=15000)

    # ── 1. off by default ───────────────────────────────────────────────────────
    session_page()
    check("off-run-header", page.get_by_test_id("tech-session-run").count() == 0)
    no_hscroll("off-session-no-hscroll")
    run_page()
    check("off-gate", page.get_by_test_id("tech-gate").count() == 0)
    page.screenshot(path=str(SHOTS / "tech-details-off.png"))
    no_hscroll("off-run-page-no-hscroll")
    runs_list()
    check("off-run-row", page.get_by_test_id("tech-run-row").count() == 0 and page.get_by_test_id("tech-session-row").count() == 0)

    # ── 2. Settings: the switch, off; turn it on → PUT studio.view ──────────────
    page.goto(f"{origin}/system", wait_until="networkidle")
    toggle = page.get_by_test_id("tech-details-toggle")
    toggle.wait_for(state="visible", timeout=15000)
    check("settings-switch-off", not toggle.is_checked())
    toggle.click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"tech-details-toggle\"]').checked", timeout=5000)
    page.wait_for_timeout(1200)  # the 400 ms debounce + the PUT
    stored = stored_view(origin)
    check("put-studio-view-on", stored == {"technical_details": True}
          and any('"studio.view"' in b for b in puts), stored=stored, puts=puts)
    check("settings-no-unsaved-note", page.get_by_test_id("tech-details-unsaved").count() == 0)

    # ── 3. reload: still on, and the three surfaces show their handles ──────────
    page.reload(wait_until="networkidle")
    page.get_by_test_id("tech-details-toggle").wait_for(state="visible", timeout=15000)
    check("reload-switch-on", page.get_by_test_id("tech-details-toggle").is_checked())

    session_page()
    hdr = page.get_by_test_id("tech-session-run")
    hdr.wait_for(state="visible", timeout=10000)
    t = hdr.text_content() or ""
    check("on-run-header", "run b1" in t and "base a41c9e2" in t and "seats claude, codex" in t, text=t)
    color = hdr.evaluate("(el) => getComputedStyle(el).color")
    size = hdr.evaluate("(el) => parseFloat(getComputedStyle(el).fontSize)")
    check("on-small-grey-type", size <= 12.5, color=color, font_size=size)
    no_hscroll("on-session-no-hscroll")
    run_page()
    hdr = page.get_by_test_id("tech-run-header")
    gate = page.get_by_test_id("tech-gate")
    gate.wait_for(state="visible", timeout=10000)
    t = gate.text_content() or ""
    check("on-gate", "run b1" in t and "base a41c9e2" in t and "seats claude, codex" in t, text=t)
    page.screenshot(path=str(SHOTS / "tech-details-on.png"))
    no_hscroll("on-run-page-no-hscroll")

    runs_list()
    row = page.locator('[data-testid="everything-session"][data-run-id="b1"] [data-testid="tech-session-row"]').first
    row.wait_for(state="visible", timeout=10000)
    t = row.text_content() or ""
    check("on-run-row", "run b1" in t and "base a41c9e2" in t and "seats claude, codex" in t, text=t)
    no_hscroll("on-runs-list-no-hscroll")

    # ── 4. off again, and that persists ─────────────────────────────────────────
    page.goto(f"{origin}/system", wait_until="networkidle")
    page.get_by_test_id("tech-details-toggle").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("tech-details-toggle").click()
    page.wait_for_timeout(1200)
    stored = stored_view(origin)
    check("put-studio-view-off", stored == {"technical_details": False}, stored=stored)
    page.reload(wait_until="networkidle")
    session_page()
    check("off-again-run-header", page.get_by_test_id("tech-session-run").count() == 0)
    run_page()
    check("off-again-gate", page.get_by_test_id("tech-gate").count() == 0)

    check("zero-page-errors", len(errors) == 0, errors=errors)

    set_fixture(origin, wave1=False, gate_now=[], session_over={}, view_prefs=None, reset_gate_posts=True)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
