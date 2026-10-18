#!/usr/bin/env python3
"""
desk_memory_test.py — Memory is its own Desk tab, separate from Steer (operator 2026-10-17: "memories
and steering are separate"), at 1440x700 in light and dark.

Drives the built UI against the in-process fixture's `memories` store and `proposals` queue (one
memory proposal, one policy proposal) and proves the user's path end to end:

  1. Desk → the Memory tab: the page renders the store's totals (GET /memory/coverage) and lists the
     memories, newest first; a kind card narrows the list; a search re-reads the wire.
  2. Proposals: only the MEMORY proposal is here; Edit → Approve with this edit approves it with the
     edited words, and the new memory is listed with them.
  3. Add a memory: files a proposal and approves it in one step (the dialog says so); the memory is
     listed; then Retire removes exactly it.
  4. Steer shows rules and POLICY proposals only: no memory link, the proposals tile counts the
     policy proposal, its Proposals view has the rule proposals and no memory section.
  5. The old addresses land where they live now: /steering/memories → the Memory tab;
     /proposals?type=memory → Memory's proposals; /steering/dashboard → Steer's Proposals view.
  6. ⌘K reaches the Memory page.
  7. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-memory-{light,dark}.png, desk-memory-proposals.png, desk-memory-add.png,
desk-memory-steer-{light,dark}.png. Env: FEEDBACK_PORT (default 4531).
"""

import json
import os
import sys
import time

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4531"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
LIGHT = dict(DEFAULT_APPEARANCE, theme="wicked-light", accent_h=200, accent_s=47, accent_l=25)
DARK = dict(DEFAULT_APPEARANCE)

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": str(why)}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


NOW = int(time.time())
MEMORIES = [
    {"id": "mem-ops", "content": "Pushes pin the GitHub account per command; a drifted account answers 403.",
     "tier": "semantic", "scope": "org:wicked/doc:ops", "facets": {"domain": "ops"}, "created_at": NOW - 3600},
    {"id": "mem-mac", "content": "An overwritten .node module dies with a silent SIGKILL until it is codesigned again.",
     "tier": "episodic", "scope": "org:wicked/doc:macos", "facets": {"domain": "macos"}, "created_at": NOW - 86400},
]
PROPOSALS = [
    {"id": "pm-1", "kind_type": "memory", "payload": {"content": "CI runs the tests one file at a time", "tier": "semantic"},
     "facets": {}, "provenance": {"agent": "claude"}, "state": "pending", "created_at": NOW - 600},
    {"id": "pp-1", "kind_type": "policy:testing", "payload": {"rule": "Every PR runs the journeys", "severity": "warn"},
     "facets": {}, "provenance": {"agent": "codex"}, "state": "pending", "created_at": NOW - 900},
]
EDITED = "CI runs the vitest files one at a time on a shared host"
ADDED = "The release train bumps six npm packages; check all six before releasing crew."

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

ADDR = "(() => { const u = new URL(location.href); const a = u.searchParams.get('at'); return { tab: u.searchParams.get('tab'), at: a }; })()"
SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def rows(page) -> list[dict]:
    return page.locator('[data-testid="memory-row"]').evaluate_all(
        "els => els.map(e => ({ id: e.dataset.memoryId, tier: e.dataset.tier, content: e.querySelector('[data-testid=\"memory-content\"]').textContent }))")


def settled(page) -> None:
    page.get_by_test_id("memory-page").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("memories-loading").wait_for(state="detached", timeout=15000)


def no_hscroll(page) -> bool:
    return page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, memories=MEMORIES, proposals=PROPOSALS, steering_rules=True, appearance=LIGHT, reset_repairs=True)

    # ── 1. Desk → Memory tab: totals, the list, a kind card, a search ─────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    tab = page.get_by_test_id("desk-tab-memory")
    try:
        tab.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-memory-missing.png"))
        fail("tab", f"no Memory tab on the Desk: {e}")
    tabs = page.get_by_test_id("desk-tabs").locator('[role="tab"]').all_inner_texts()
    tab.click()
    settled(page)
    page.wait_for_function("() => /2/.test(document.querySelector('[data-testid=\"memory-stat-total\"]')?.textContent ?? '')", timeout=10000)
    first = rows(page)
    total = page.get_by_test_id("memory-stat-total").inner_text()
    review = page.get_by_test_id("memory-stat-review").inner_text()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-memory-light.png"))
    check("browse", tabs.index("Memory") == tabs.index("Steer") + 1
          and [r["id"] for r in first] == ["mem-ops", "mem-mac"]
          and "1 semantic · 1 episodic" in total and "1" in review
          and page.evaluate(ADDR)["tab"] == "memory" and no_hscroll(page),
          tabs=tabs, rows=first, total=total, review=review)
    page.locator('[data-testid="memory-kind"][data-tier="episodic"]').click()
    by_kind = [r["id"] for r in rows(page)]
    page.locator('[data-testid="memory-kind"][data-tier="all"]').click()
    page.get_by_test_id("memories-search").fill("codesigned")
    page.get_by_test_id("memories-search-go").click()
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"memory-row\"]').length === 1", timeout=10000)
    by_search = [r["id"] for r in rows(page)]
    page.get_by_test_id("memories-clear").click()
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"memory-row\"]').length === 2", timeout=10000)
    check("filters", by_kind == ["mem-mac"] and by_search == ["mem-mac"], by_kind=by_kind, by_search=by_search)

    # ── 2. Proposals: memory only; approve with an edit ───────────────────────────────
    page.get_by_test_id("memory-view-proposals").click()
    cards = page.locator('[data-testid="proposal-card"]')
    cards.first.wait_for(state="visible", timeout=10000)
    ids = [cards.nth(i).get_attribute("data-proposal-id") for i in range(cards.count())]
    at = page.evaluate(ADDR)
    card = page.locator('[data-testid="proposal-card"][data-proposal-id="pm-1"]')
    card.get_by_test_id("proposal-edit").click()
    card.get_by_test_id("proposal-edit-text").fill(EDITED)
    page.screenshot(path=str(SHOTS / "desk-memory-proposals.png"))
    card.get_by_test_id("proposal-approve-edited").click()
    note = page.get_by_test_id("proposals-section-note")
    note.wait_for(state="visible", timeout=10000)
    approved_note = note.inner_text()
    card.wait_for(state="detached", timeout=10000)
    page.get_by_test_id("memory-view-memories").click()
    settled(page)
    page.wait_for_function(f"() => [...document.querySelectorAll('[data-testid=\"memory-content\"]')].some(e => e.textContent === {json.dumps(EDITED)})", timeout=10000)
    check("approve-edited", ids == ["pm-1"] and at["at"] == "/memory?view=proposals"
          and approved_note.startswith("Approved with your edit: ")
          and EDITED in [r["content"] for r in rows(page)],
          ids=ids, at=at, note=approved_note)

    # ── 3. Add a memory, then retire it ───────────────────────────────────────────────
    page.get_by_test_id("memory-add").click()
    dialog = page.get_by_test_id("memory-add-dialog")
    dialog.wait_for(state="visible", timeout=8000)
    honest = "files it as a memory proposal and you approve it in the same step" in dialog.inner_text()
    dialog.get_by_test_id("memory-add-text").fill(ADDED)
    page.wait_for_function("() => !document.querySelector('[data-testid=\"memory-add-save\"]').disabled", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-memory-add.png"))
    dialog.get_by_test_id("memory-add-save").click()
    page.get_by_test_id("memories-note").wait_for(state="visible", timeout=10000)
    added_note = page.get_by_test_id("memories-note").inner_text()
    page.wait_for_function(f"() => [...document.querySelectorAll('[data-testid=\"memory-content\"]')].some(e => e.textContent === {json.dumps(ADDED)})", timeout=10000)
    added = next(r for r in rows(page) if r["content"] == ADDED)
    check("add", honest and added_note.startswith("Added: ") and added["tier"] == "semantic", note=added_note, added=added)
    row = page.locator(f'[data-testid="memory-row"][data-memory-id="{added["id"]}"]')
    row.get_by_test_id("memory-actions-button").click()
    page.get_by_role("menuitem", name="Retire", exact=True).click()
    page.get_by_test_id("memory-retire-dialog").wait_for(state="visible", timeout=8000)
    page.get_by_test_id("memory-retire-confirm").click()
    row.wait_for(state="detached", timeout=10000)
    retired_note = page.get_by_test_id("memories-note").inner_text()
    left = [r["id"] for r in rows(page)]
    check("retire", retired_note.startswith("Retired: ") and added["id"] not in left and len(left) == 3, note=retired_note, left=left)

    # ── 4. Steer: rules and policy proposals only ─────────────────────────────────────
    page.get_by_test_id("desk-tab-steer").click()
    page.get_by_test_id("steer-surface").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => /\\d/.test(document.querySelector('[data-testid=\"steer-stat-review\"]')?.textContent ?? '')", timeout=10000)
    steer_review = page.get_by_test_id("steer-stat-review").inner_text()
    memory_link = page.get_by_test_id("steer-memories").count()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-memory-steer-light.png"))
    page.get_by_test_id("steer-stat-review-open").click()
    page.locator('[data-testid="proposals-section"][data-kind="policy"] [data-testid="proposal-card"]').first.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-memory-steer-proposals.png"))
    kinds = page.locator('[data-testid="proposals-section"]').evaluate_all("els => els.map(e => e.dataset.kind)")
    policy_cards = page.locator('[data-testid="proposal-card"]').evaluate_all("els => els.map(e => e.dataset.proposalId)")
    check("steer", memory_link == 0 and "1" in steer_review and "Memory" not in page.get_by_test_id("steer-rules").inner_text()
          and kinds == ["policy"] and policy_cards == ["pp-1"],
          review=steer_review, kinds=kinds, cards=policy_cards)

    # ── 5. The old addresses land where they live now ─────────────────────────────────
    landed = {}
    for old, want_tab, want_test in (("/steering/memories", "memory", "memory-page"),
                                     ("/proposals?type=memory", "memory", "memory-proposals"),
                                     ("/steering/dashboard", "steer", "steer-surface")):
        page.goto(f"{origin}{old}", wait_until="networkidle")
        page.get_by_test_id(want_test).wait_for(state="visible", timeout=15000)
        landed[old] = page.evaluate(ADDR)
        landed[old]["ok"] = landed[old]["tab"] == want_tab
    page.locator('[data-testid="proposals-section"][data-kind="policy"]').wait_for(state="visible", timeout=10000)
    dash_view = page.locator('[data-testid="steer-view-proposals"]').get_attribute("aria-checked") or page.locator('[data-testid="steer-view-proposals"]').get_attribute("aria-pressed")
    check("legacy", all(v["ok"] for v in landed.values()) and landed["/proposals?type=memory"]["at"] == "/memory?view=proposals"
          and landed["/steering/dashboard"]["at"] == "/steering/proposals", landed=landed, dashboard_view=dash_view)

    # ── 6. ⌘K reaches the Memory page ─────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-search").click()
    page.keyboard.type("go: memory")
    row = page.locator('[data-testid="palette-row"][href="/memory"]')
    try:
        row.first.wait_for(state="visible", timeout=8000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-memory-cmdk.png"))
        fail("cmdk", f"no ⌘K row for /memory: {e}")
    row.first.click()
    page.get_by_test_id("memory-page").wait_for(state="visible", timeout=15000)
    check("cmdk", page.evaluate(ADDR)["tab"] == "memory")

    # ── 7. Dark: the same page and Steer ──────────────────────────────────────────────
    set_fixture(origin, appearance=DARK)
    page.goto(f"{origin}/?tab=memory", wait_until="networkidle")
    settled(page)
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') !== 'wicked-light'", timeout=10000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-memory-dark.png"))
    page.goto(f"{origin}/?tab=steer", wait_until="networkidle")
    page.get_by_test_id("steer-surface").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-memory-steer-dark.png"))
    check("dark", no_hscroll(page))

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
