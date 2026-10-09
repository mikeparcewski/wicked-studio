#!/usr/bin/env python3
"""
desk_ports_gates_test.py — S18a: two gate-answering ports on the Desk (DES-STUDIO-REBUILD-001
Amendment 5), 1440x700 under STUDIO_SKIN=desk. REAL 10 s undo window throughout.

Against the in-process fixture's wave-1 + wave-2b corpus with g1 + g2 served as simple def gates
(they fold into the "2 approvals" group on the Desk):

  approve-all   Approve all on the group row sends ONE POST /runs/:id/gate per member
                ({approve:true}), each after the 10 s window — and nothing before it.
  undo          Approve all, then Undo inside the window: NO POST at all.
  reason        Reject with a typed reason POSTs {approve:false, amend:"wrong branch"} per member.
  digit         A bare digit reject in a member's own question row POSTs {approve:false}, no amend.

Fixture note (deviation from the slice intent's literal `batch_gates=True`): g1/g2 live only in the
WAVE2B corpus, and `simple_gates` only overrides the status of runs already present — so the
approvals group needs `wave1=True, wave2b=True, simple_gates=["g1","g2"]` (the recipe wave2b_queue
and desk_everything already use). `batch_gates` serves a DIFFERENT corpus (r-batch1/2) and would not
produce the g1/g2 fold; it is omitted here.

Captures: e2e/shots/desk-ports-gates*.png. Env: FEEDBACK_PORT (default 4372).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4372"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok and os.environ.get("JOURNEY_ALL_STEPS") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")


def gate_posts(origin: str, rid: str | None = None) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        posts = json.loads(res.read())["posts"]
    return posts if rid is None else [p for p in posts if p["runId"] == rid]


GROUP = '[data-testid="need-row"][data-key="group:approval"]'

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def desk(browser):
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[],
                status_over={}, extra_frames=[], reset_gate_posts=True)
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.locator(GROUP).wait_for(state="visible", timeout=10000)
    return page


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── the group row is present with both members ────────────────────────────────
    page = desk(browser)
    group = page.locator(GROUP)
    check("group-row", group.get_attribute("data-count") == "2", count=group.get_attribute("data-count"))
    page.screenshot(path=str(SHOTS / "desk-ports-gates-group.png"))

    # ── 1. Approve all: one POST per member after 10 s, none before ───────────────
    group.get_by_test_id("need-group-approve-all").click()
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=5000)
    pressed = time.monotonic()
    check("approve-all-queued-no-posts", len(gate_posts(origin)) == 0, posts=len(gate_posts(origin)))
    page.wait_for_timeout(max(0, int((pressed + 11.5 - time.monotonic()) * 1000)))
    g1 = gate_posts(origin, "g1")
    g2 = gate_posts(origin, "g2")
    check("approve-all-posts",
          len(g1) == 1 and len(g2) == 1
          and g1[0]["body"] == {"approve": True, "ord": 0}
          and g2[0]["body"] == {"approve": True, "ord": 0},
          bodies=[p["body"] for p in gate_posts(origin)])
    page.close()

    # ── 2. Undo within the window: nothing is sent ────────────────────────────────
    page = desk(browser)
    page.locator(GROUP).get_by_test_id("need-group-approve-all").click()
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=5000)
    pressed = time.monotonic()
    page.wait_for_timeout(2500)
    page.get_by_test_id("undo-toast").get_by_role("button", name="Undo").click()
    page.wait_for_timeout(max(0, int((pressed + 12.0 - time.monotonic()) * 1000)))
    check("undo-nothing-sent", len(gate_posts(origin)) == 0, posts=gate_posts(origin))
    page.close()

    # ── 3. Reject with a typed reason: {approve:false, amend} per member ──────────
    page = desk(browser)
    group = page.locator(GROUP)
    group.get_by_test_id("need-group-reject").click()
    reason = group.get_by_test_id("need-group-reject-reason")
    reason.wait_for(state="visible", timeout=5000)
    reason.fill("wrong branch")
    reason.press("Enter")
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=5000)
    pressed = time.monotonic()
    page.screenshot(path=str(SHOTS / "desk-ports-gates-reason.png"))
    page.wait_for_timeout(max(0, int((pressed + 11.5 - time.monotonic()) * 1000)))
    want = {"approve": False, "amend": "wrong branch", "ord": 0}
    g1 = gate_posts(origin, "g1")
    g2 = gate_posts(origin, "g2")
    check("reject-reason-posts",
          len(g1) == 1 and len(g2) == 1 and g1[0]["body"] == want and g2[0]["body"] == want,
          bodies=[p["body"] for p in gate_posts(origin)])
    page.close()

    # ── 4. A bare digit reject in a member's own question row: {approve:false} ─────
    page = desk(browser)
    page.locator(GROUP).get_by_test_id("need-group-toggle").click()  # "Show each"
    member = page.locator('[data-testid="need-member"][data-key="gate:g1"]')
    member.wait_for(state="visible", timeout=10000)
    member.get_by_test_id("need-answer").click()
    member.get_by_test_id("need-choices").wait_for(state="visible", timeout=5000)
    member.get_by_test_id("need-choices").press("2")  # the reject digit — commits at once, bare
    page.get_by_test_id("undo-toast").wait_for(state="visible", timeout=5000)
    pressed = time.monotonic()
    # The reason input must never appear on the keyboard fast path (boundary 2).
    check("digit-no-reason-input", member.get_by_test_id("need-choice-reason").count() == 0)
    page.wait_for_timeout(max(0, int((pressed + 11.5 - time.monotonic()) * 1000)))
    g1 = gate_posts(origin, "g1")
    check("digit-reject-bare",
          len(g1) == 1 and g1[0]["body"] == {"approve": False, "ord": 0} and "amend" not in g1[0]["body"],
          body=g1[0]["body"] if g1 else None)
    page.close()

    check("no-page-errors", not errors, errors=errors[:5])
    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], reset_gate_posts=True)
    browser.close()

report["ok"] = all(v.get("ok") for v in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
