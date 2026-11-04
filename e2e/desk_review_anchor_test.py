#!/usr/bin/env python3
"""
desk_review_anchor_test.py — journey 2026-11-04 (apps-k5-chat's knowledge journey on :7721): Understand's review of
30 knowledge proposals. The first Approve click on a card far down the list was taken by another card, and every card
said "Data shape". Proves, at 1440x900 (the journey's) and 1440x700:

  1. LABELS: a knowledge note an agent filed about a repository says "Knowledge note"; only a proposal that links
     something (crew's profiler, garden's shapes pass) says "Data shape".
  2. HIT TARGET: a far card's Approve is its own hit target once scrolled to (Playwright's actionability check,
     `trial`), for cards near the middle and the end of the list; a real click on one far card's Approve approves
     THAT card (the fixture sees its id, once).
  3. THE RULE: every review card computes `overflow-anchor: none` in the real browser (deterministic).
  NEGATIVE CONTROL (reported, never fatal): with the cards made scroll anchors again, the same check is run and its
     result is recorded. Locally it failed (card 12 -> card 15, card 20 -> card 25); it rides a Chromium timing, so a
     run where it passes must not fail a correct build (review r1).
  4. 0 page errors.

Captures: e2e/shots/desk-review-anchor*.png. Env: FEEDBACK_PORT (default 4391).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
SHOTS = REPO / "e2e" / "shots"
FAR = (12, 20, 27)

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


def note(i: int) -> dict:
    """An agent-filed knowledge note, as :7721 held them (no links: the map never draws one)."""
    body = (f"src/module_{i}.rs owns step {i} of the governed spine: it reads the run's plan, applies one step result, "
            "and posts the outcome back to the actor over a channel; a duplicate result is ignored as stale. ") * (1 + i % 3)
    return {"id": f"k-note-{i:02d}", "kind_type": "knowledge", "state": "pending", "created_at": 1_790_000_000 + i,
            "payload": {"content": "__PROBE__ test" if i == 0 else body.strip(), "class": "concept",
                        "source": f"wicked-core:src/module_{i}.rs", "source_rev": "probe" if i == 0 else "a340826"},
            "facets": {"project": "wicked-core", "repo": "wicked-core"},
            "provenance": {"run_agent": "pi" if i % 2 else "claude", "run_id": f"run-{i}"}}


def shape(i: int, relation: str) -> dict:
    """A data shape crew's profiler filed (payload.shape plus its links)."""
    sid = "3f0c9a1e-0000-4000-8000-00000000b4a1"
    return {"id": f"k-shape-{i:02d}", "kind_type": "knowledge", "state": "pending", "created_at": 1_790_000_100 + i,
            "payload": {"content": f"{relation} in data source support-pg: 100-9,999 rows. Key candidates: id. It joins support.tickets on ticket_id = id.",
                        "class": "concept", "scope": f"source:{sid}", "capture": "profile",
                        "source": f"crew:profile/support-pg/{relation}",
                        "relate": [{"rel": "derived_from", "to": "x"}], "relate_code": [],
                        "shape": {"format": 1, "sourceId": sid, "source": "support-pg", "relation": relation,
                                  "profile": {"key": relation, "rows": "100-9,999", "columns": [], "error": None},
                                  "joins": [{"from": relation, "columns": ["ticket_id"], "to": "support.tickets", "references": ["id"], "basis": "fk", "overlap": "all"}],
                                  "describes": []}},
            "facets": {}, "provenance": {}}


QUEUE = [note(i) for i in range(25)] + [shape(i, r) for i, r in enumerate(
    ("support.assignments", "support.audit_log", "support.regions", "support.sla_events", "support.events"))]

dist = ensure_build(fail)
origin = start_server(PORT, dist)
set_fixture(origin, proposals=QUEUE)


def approve_posts() -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/approve-posts", timeout=10) as r:
        return json.loads(r.read())["posts"]


def far_checks(page) -> list:
    """For each far card: does Playwright's own scroll-then-check find its Approve as the hit target?"""
    cards = page.locator('[data-testid="proposal-card"]')
    out = []
    for i in FAR:
        btn = cards.nth(i).get_by_test_id("proposal-approve")
        try:
            btn.click(trial=True, timeout=3000)
            out.append((i, True, None))
        except Exception as e:  # noqa: BLE001 — Playwright's timeout carries the interceptor in its log
            hit = next((ln.strip()[:160] for ln in str(e).splitlines() if "intercepts pointer events" in ln), str(e).splitlines()[0][:160])
            out.append((i, False, hit))
    return out


def open_review(page) -> None:
    page.goto(f"{origin}/understand?view=knowledge", wait_until="domcontentloaded")
    page.locator('[data-testid="proposal-card"]').nth(len(QUEUE) - 1).wait_for(timeout=30000)
    page.wait_for_timeout(1500)


from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for w, h in ((1440, 900), (1440, 700)):
        page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
        page.on("pageerror", lambda e: errors.append(str(e)))
        open_review(page)
        if w == 1440 and h == 900:
            chips = page.locator('[data-testid="proposal-card"]').evaluate_all(
                "cs => cs.map(c => [c.getAttribute('data-proposal-id'), c.querySelector('[data-testid=proposal-kind-chip]').textContent])")
            notes = [c for c in chips if c[0].startswith("k-note-")]
            shapes = [c for c in chips if c[0].startswith("k-shape-")]
            check("labels", len(chips) == len(QUEUE) and all(c[1] == "Knowledge note" for c in notes) and all(c[1] == "Data shape" for c in shapes),
                  notes=len(notes), shapes=len(shapes), wrong=[c for c in chips if c[1] != ("Data shape" if c[0].startswith("k-shape-") else "Knowledge note")])
            page.screenshot(path=str(SHOTS / "desk-review-anchor-labels.png"))
        anchors = page.locator('[data-testid="proposal-card"]').evaluate_all("cs => [...new Set(cs.map(c => getComputedStyle(c).overflowAnchor))]")
        check(f"cards-never-anchor-{w}x{h}", anchors == ["none"], computed=anchors)
        res = far_checks(page)
        check(f"hit-target-{w}x{h}", all(ok for _, ok, _ in res), cards=res)
        if w == 1440 and h == 900:
            # A real click on a far card's Approve approves that card, and only it.
            target = page.locator('[data-testid="proposal-card"]').nth(20)
            want = target.get_attribute("data-proposal-id")
            before = approve_posts()
            target.get_by_test_id("proposal-approve").click(timeout=5000)
            page.wait_for_timeout(1200)
            got = approve_posts()[len(before):]
            page.screenshot(path=str(SHOTS / "desk-review-anchor-approved.png"))
            check("approve-own-card", got == [want], want=want, got=got)
            set_fixture(origin, proposals=QUEUE)
        page.close()
    # The control: the review cards are scroll anchors again (main before this fix).
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    open_review(page)
    page.add_style_tag(content=".wk-gk-card { overflow-anchor: auto !important; }")
    page.wait_for_timeout(300)
    control = far_checks(page)
    report["negative_control"] = {"reproduced": not all(ok for _, ok, _ in control), "cards": control,
                                  "note": "the cards as scroll anchors again (main before the fix); informational"}
    page.close()
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
