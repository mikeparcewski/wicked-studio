#!/usr/bin/env python3
"""
desk_plain_words_test.py — error states and plain words (studio#684 row 59, #734, #735), at 1440x700
against the in-process fixture (switch escalation_arms; the repositories read is failed in the browser).

  1. Repositories while studio's service is unreachable (#684 row 59): one banner with Retry, no raw
     "Failed to fetch" in the page's own words, and "Add repository" disabled (no write offline).
  2. A run stopped at a required check that did not finish (#734): its gate asks "A required check
     failed — how should the step go on?", never "The floor failed".
  3. The notice strip above the page (#735): on another page it announces the waiting run; on that
     run's own session page it does not repeat the question the thread already asks.

Captures (e2e/shots/): desk-plain-words-{repos-offline,session}-{light,dark}.png.
Env: FEEDBACK_PORT (default 4614). JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4614"))
SHOTS = REPO / "e2e" / "shots"
RID = "r-timeout"
report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, **{"escalation_arms": True, "appearance": {**DEFAULT_APPEARANCE}})

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list = []


def shoot(page, name: str) -> None:
    for theme in ("wicked-light", "wicked-dark"):
        page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / f"desk-plain-words-{name}-{theme.split('-')[1]}.png"))
    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'wicked-light')")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1. Repositories, service unreachable: the read fails at the network.
    page.route("**/api/v1/repos*", lambda r: r.abort("connectionrefused"))
    page.goto(f"{origin}/repos", wait_until="networkidle")
    page.get_by_test_id("repos-error").wait_for(state="visible")
    banner = page.get_by_test_id("repos-error")
    retry = banner.get_by_role("button", name="Retry")
    add = page.get_by_test_id("repos-add")
    words = page.locator("main").inner_text() if page.locator("main").count() > 0 else page.inner_text("body")
    check("offline-banner-with-retry", retry.count() == 1, banner=banner.inner_text()[:200])
    check("no-write-offline", add.is_disabled() and "Retry" in (add.get_attribute("title") or ""), title=add.get_attribute("title"))
    check("no-raw-error-in-words", "Failed to fetch" not in words.replace(banner.locator("details").inner_text() if banner.locator("details").count() > 0 else "", ""), sample=words[:300])
    shoot(page, "repos-offline")
    # codex r1: /repos/new opens with the form already up — its own submit holds too.
    page.goto(f"{origin}/repos/new", wait_until="networkidle")
    page.get_by_test_id("repos-error").wait_for(state="visible")
    page.get_by_test_id("repo-register").wait_for(state="visible")
    page.get_by_test_id("repo-path").fill("/work/checkout-demo")
    page.get_by_test_id("repo-name").fill("checkout-demo")
    submit = page.get_by_test_id("repo-register-submit")
    why = page.get_by_test_id("repo-register-why").inner_text() if page.get_by_test_id("repo-register-why").count() > 0 else ""
    check("no-register-offline", submit.is_disabled() and "can’t reach its service" in why, why=why)
    page.goto(f"{origin}/repos", wait_until="networkidle")
    page.get_by_test_id("repos-error").wait_for(state="visible")
    retry = page.get_by_test_id("repos-error").get_by_role("button", name="Retry")
    page.unroute("**/api/v1/repos*")
    retry.click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"repos-error\"]')")
    check("retry-recovers-and-add-is-back", not add.is_disabled())

    # 3a. Another page announces the waiting run in the strip.
    page.goto(f"{origin}/watch", wait_until="networkidle")
    others = page.locator('[data-testid="gate-notification"]')
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"gate-notification\"]').length > 0")
    announced = [others.nth(i).get_attribute("data-run-id") for i in range(others.count())]
    check("strip-announces-elsewhere", len(announced) > 0, announced=announced)

    # 3b. The announced run's own session page: its question is in the thread, not repeated above it.
    shown = announced[0]
    page.goto(f"{origin}/s/run%3A{shown}", wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible")
    page.wait_for_timeout(500)
    on_page = [others.nth(i).get_attribute("data-run-id") for i in range(others.count())]
    check("strip-does-not-repeat-the-open-session", shown not in on_page, run=shown, strip=on_page)
    shoot(page, "session")

    # 2. A run stopped at a required check that did not finish: the plain question.
    page.goto(f"{origin}/s/run%3A{RID}", wait_until="networkidle")
    page.get_by_test_id("session-gate-row").wait_for(state="visible")
    q = (page.get_by_test_id("session-gate-question").first.text_content() or "").strip()
    check("plain-gate-question", q == "A required check failed — how should the step go on?" and "floor" not in q.lower(), question=q)
    check("strip-skips-this-run-too", page.locator(f'[data-testid="gate-notification"][data-run-id="{RID}"]').count() == 0)
    browser.close()

check("no-page-errors", errors == [], errors=errors[:3])
report["ok"] = True
print(json.dumps(report, indent=2))
