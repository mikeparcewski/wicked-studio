#!/usr/bin/env python3
"""
desk_orphaned_test.py — studio#545: a run the daemon restart orphaned says so and offers Resume, under
the Desk at 1440x700 against the in-process fixture. The fixture's `r-orphan` is `executing` and
its trail ends on the engine's `runOrphaned` report (crew#830): no worker, nothing moving.

  1. THE DESK COUNTS IT: the needs-you queue carries the run with the orphan line and a `Resume ›` act —
     never under running work alone.
  2. THE WATCHTOWER SAYS IT: /watch carries "1 run was orphaned by a restart — nothing is working on it."
  3. THE SESSION THREAD SAYS IT: /s/run:r-orphan shows the row "The daemon restarted while this step was
     running; nothing is working on it." with one action, Resume.
  4. RESUME WORKS: Resume → POST /runs/r-orphan/resume (GET /__fixture/resume-posts records it); the
     re-read trail carries the dispatch after the report, and the row goes.
  5. 0 page errors.

Captures: e2e/shots/desk-orphaned-*.png. Env: FEEDBACK_PORT (default 4371).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4371"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
LINE = "The daemon restarted while this step was running; nothing is working on it."

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


def resume_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/resume-posts", timeout=5) as r:
        return json.loads(r.read())["posts"]



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
    set_fixture(origin, reset_gate_posts=True, orphan=True)

    # ── 1. The Desk counts it ────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    need = page.locator('[data-testid="need-line"]', has_text="nothing is working on it")
    try:
        need.first.wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-orphaned-desk-missing.png"))
        text = page.evaluate("() => (document.querySelector('[data-testid=\"desk\"]') || document.body).innerText.slice(0, 800)")
        fail("desk-counts-the-orphan", {"why": "no needs-you row with the orphan line", "desk_text": text})
    page.screenshot(path=str(SHOTS / "desk-orphaned-desk.png"))
    desk = page.evaluate("() => document.querySelector('[data-testid=\"desk\"]').innerText")
    check("desk-counts-the-orphan", need.count() == 1 and "Resume ›" in desk, rows=need.count())

    # ── 2. The Watchtower says it ────────────────────────────────────────────────
    page.goto(f"{origin}/watch", wait_until="networkidle")
    try:
        page.get_by_test_id("watchtower-orphaned").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-orphaned-watch-missing.png"))
        fail("watchtower-says-it", {"why": "no [data-testid=watchtower-orphaned]"})
    strip = page.get_by_test_id("watchtower-orphaned").inner_text()
    page.screenshot(path=str(SHOTS / "desk-orphaned-watch.png"))
    check("watchtower-says-it", strip == "1 run was orphaned by a restart — nothing is working on it.", strip=strip)

    # ── 3. The session thread says it ───────────────────────────────────────────
    page.goto(f"{origin}/s/run%3Ar-orphan", wait_until="networkidle")
    try:
        page.get_by_test_id("session-orphaned").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-orphaned-session-missing.png"))
        text = page.evaluate("() => (document.querySelector('[data-testid=\"session\"]') || document.body).innerText.slice(0, 800)")
        fail("session-says-it", {"why": "no [data-testid=session-orphaned]", "session_text": text})
    row = page.get_by_test_id("session-orphaned")
    page.screenshot(path=str(SHOTS / "desk-orphaned-session.png"))
    check("session-says-it",
          row.inner_text().startswith(LINE) and row.get_attribute("data-ord") == "1"
          and page.get_by_test_id("session-orphaned-resume").count() == 1,
          text=row.inner_text())

    # ── 4. Resume works ──────────────────────────────────────────────────────────
    page.get_by_test_id("session-orphaned-resume").click()
    deadline = time.time() + 10
    posts: list = []
    while time.time() < deadline:
        posts = resume_posts(origin)
        if any(p_["runId"] == "r-orphan" for p_ in posts):
            break
        page.wait_for_timeout(200)
    check("resume-posts", any(p_["runId"] == "r-orphan" for p_ in posts), posts=posts)
    try:
        page.get_by_test_id("session-orphaned").wait_for(state="hidden", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-orphaned-row-stays.png"))
        fail("row-goes-after-resume", {"why": "the orphan row stayed after the re-read trail carried the dispatch",
                                      "text": page.get_by_test_id("session-orphaned").inner_text()})
    page.screenshot(path=str(SHOTS / "desk-orphaned-resumed.png"))
    check("row-goes-after-resume", page.get_by_test_id("session-orphaned").count() == 0)

    # ── 5. 0 page errors ─────────────────────────────────────────────────────────
    check("no-page-errors", len(errors) == 0, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
