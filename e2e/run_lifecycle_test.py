#!/usr/bin/env python3
"""
run_lifecycle_test.py — functional e2e coverage for wicked-studio's run lifecycle UI.

LC-1  Launch-form validation: submit disabled until instructions AND a repo scope are set.
LC-2  Gate answering: awaitingHuman WS frame → gate card → Approve → POST confirmed.
LC-3  Archive chip ON + Unarchive: chip reveals the archived row; Unarchive removes it.
LC-4  Archive chip OFF: toggling the chip off hides the archived group; live run stays.
LC-5  Repo register form: disabled until both fields are filled; submit POSTs to /repos.

Pattern: uxfix_fixture.py shared server, Playwright sync_api, no time.sleep().
Env: LC_PORT (default 4500), SKIP_STUDIO_BUILD. Prints JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

LC_PORT = int(os.environ.get("LC_PORT", "4500"))
ORIGIN = f"http://127.0.0.1:{LC_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "lifecycle"

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


# ── 1. Same-origin build + shared W2 fixture ──────────────────────────────────
dist = ensure_build(fail)
start_server(LC_PORT, dist)
set_fixture(ORIGIN,
            orphan=True, repo=True,
            extra_gates=[], gate_now=[],
            lc_archived_runs=False, lc_register_ok=False)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
TID = lambda t: f'[data-testid="{t}"]'  # noqa: E731

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    # Track gate and repo POST requests.
    gate_posts: list = []
    repo_posts: list = []
    page.on("request", lambda r: gate_posts.append(r.url)
            if r.method == "POST" and "/gate" in r.url else None)
    page.on("request", lambda r: repo_posts.append(r.url)
            if r.method == "POST" and r.url.endswith("/api/v1/repos") else None)

    # ── LC-1: Launch-form validation ───────────────────────────────────────────
    # The testing campaigns panel (`/testing/campaigns`) renders the launch form.
    # Submit must stay disabled until BOTH a non-whitespace instruction AND a
    # repo scope chip are present — this exercises the browser's canSubmit gate.
    page.goto(f"{ORIGIN}/testing/campaigns", wait_until="domcontentloaded")
    page.locator(TID("testing-launch-panel")).wait_for(timeout=15000)
    submit = page.locator(TID("testing-launch-submit"))

    check("lc1_submit_disabled_empty", submit.is_disabled())

    page.locator(TID("testing-launch-instructions")).fill("smoke the auth endpoint")
    check("lc1_submit_disabled_no_scope", submit.is_disabled())

    # Search for the fixture's repo ("studio-api") and pick it.
    page.locator(TID("testing-launch-repo-search")).fill("studio")
    page.locator(TID("testing-launch-repo-option")).first.wait_for(timeout=8000)
    page.locator(TID("testing-launch-repo-option")).first.click()
    check("lc1_submit_enabled_with_scope", submit.is_enabled())
    page.screenshot(path=str(VSHOTS / "lc1-launch-form.png"))

    # ── LC-2: Gate answering ────────────────────────────────────────────────────
    # r-q3 is awaiting_human in the standing corpus. Pushing an awaitingHuman WS
    # frame fills the gate store; navigating to the run's thread surface then
    # renders the ApprovalDock with SteeringGate. Clicking Approve must POST to
    # /api/v1/runs/r-q3/gate and the gate card must detach afterward.
    gate_posts.clear()
    set_fixture(ORIGIN,
                extra_gates=[{"session": "r-q3", "ord": 0, "prompt": "Approve the deck outline?"}])
    # Navigate directly to the run detail — the WS drains extra_gates on connect.
    page.goto(f"{ORIGIN}/p/q3-review-deck/build/r-q3", wait_until="domcontentloaded")
    page.locator(TID("steering-gate")).wait_for(timeout=20000)
    page.screenshot(path=str(VSHOTS / "lc2-gate-open.png"))

    page.locator(TID("steering-approve")).first.click()
    page.locator(TID("steering-gate")).wait_for(state="detached", timeout=10000)
    check("lc2_gate_approved",
          any("/r-q3/gate" in u for u in gate_posts),
          gate_posts=list(gate_posts))
    page.screenshot(path=str(VSHOTS / "lc2-gate-approved.png"))

    # Reset the extra_gates drain (it's already empty; just make state explicit).
    set_fixture(ORIGIN, extra_gates=[], gate_now=[])

    # ── LC-3: Archive chip ON + Unarchive success ──────────────────────────────
    # With lc_archived_runs=True, GET /runs?include=archived includes lc-old-1.
    # Toggling the chip ON shows the archived row; Unarchive removes it optimistically.
    set_fixture(ORIGIN, lc_archived_runs=True)
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")

    chip = page.locator("button[aria-pressed]").filter(has_text="Archived").first
    chip.wait_for(timeout=10000)
    chip.click()

    archived_row = page.get_by_text("campaign leftover · lc-old-1")
    archived_row.wait_for(timeout=10000)
    check("lc3_archived_row_visible", archived_row.is_visible())
    page.screenshot(path=str(VSHOTS / "lc3-archived-chip-on.png"))

    page.get_by_role("button", name="Unarchive").first.click()
    archived_row.wait_for(state="detached", timeout=10000)
    check("lc3_unarchive_removes_row", archived_row.count() == 0)
    page.screenshot(path=str(VSHOTS / "lc3-unarchived.png"))

    # ── LC-4: Archive chip OFF hides group; live run stays visible ────────────
    # Fresh page load so component state resets (chip starts OFF by default).
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")

    chip = page.locator("button[aria-pressed]").filter(has_text="Archived").first
    chip.wait_for(timeout=10000)
    chip.click()  # ON
    page.get_by_text("campaign leftover · lc-old-1").wait_for(timeout=10000)

    chip.click()  # OFF
    page.get_by_text("campaign leftover · lc-old-1").wait_for(state="detached", timeout=8000)
    # At least one non-archived run card must still be visible.
    page.locator(TID("run-card")).first.wait_for(timeout=5000)
    check("lc4_chip_off_hides_archived_group",
          page.locator(TID("run-card")).first.is_visible())
    page.screenshot(path=str(VSHOTS / "lc4-chip-off.png"))

    # ── LC-5: Repo register form — validation then submit ─────────────────────
    # With repo=False the panel opens empty (repos-empty state). Navigating to
    # /repos/new auto-shows the register form (autoShowRegister prop). The submit
    # button stays disabled until both name and path are provided; after submit the
    # page navigates to /repo-detail/<id>.
    set_fixture(ORIGIN, repo=False, lc_register_ok=True)
    page.goto(f"{ORIGIN}/repos/new", wait_until="domcontentloaded")

    submit_btn = page.get_by_role("button", name="Register & onboard")
    submit_btn.wait_for(timeout=10000)
    check("lc5_register_disabled_empty", submit_btn.is_disabled())

    page.get_by_placeholder("Repo name").fill("my-repo")
    check("lc5_register_disabled_no_path", submit_btn.is_disabled())

    page.get_by_placeholder("Absolute path to git repo").fill("/tmp/my-repo")
    check("lc5_register_enabled", submit_btn.is_enabled())

    repo_posts.clear()
    submit_btn.click()
    # Registration POSTs to /repos and then navigates to /repo-detail/<id>.
    page.wait_for_url("**/repo-detail/**", timeout=10000)
    check("lc5_register_posts_to_repos",
          any("/api/v1/repos" in u for u in repo_posts),
          repo_posts=list(repo_posts))
    page.screenshot(path=str(VSHOTS / "lc5-registered.png"))

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
