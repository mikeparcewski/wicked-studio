#!/usr/bin/env python3
"""
wavec_takes_test.py — studio Wave C, idea 12 (1440x700): TAKES, NOT VERSIONS on the Document
surface's compare split.

A document made in the thread (v1 from the brief, v2 from a steer) has two real candidates. With
Compare on, the split's panes are takes:

  split    two takes render side by side (take 1 = the selected v2 on the left, take 2 = v1 on the
           right), each pane header carrying its own "Pick take N".
  preview  "Pick take 2" states the consequence first (v1 becomes the latest version, a fork; a
           preference is filed for review) and posts NOTHING.
  pick     confirming files ONE preference proposal through crew's POST /proposals (content names
           v1 over v2, project + source ride along) — GET /proposals then lists it pending, a
           memory with capture "preference" — and the bridge forks v1 as the working v3.
  remix    compare v3 against v2, name what to keep, and "Remix ›" sends ONE steer on the doc
           thread: "Build on take 2 (v2), and keep take 1's (v3) headline." — it lands on the
           thread, and the fork it builds on (parent v2) is in the manifest. No second proposal.

Captures (e2e/shots/): wavec-desk-takes.png, wavec-desk-preview.png, wavec-desk-picked.png,
wavec-desk-remix.png. Env: FEEDBACK_PORT (default 4491). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.request
from urllib.parse import urlparse

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4491"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
BRIEF = "Make me a deck for the Q3 review"
STEER = "Tighten the headline on slide one"

report: dict = {"ok": False, "steps": {}}


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read())


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(15000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def run() -> None:
        set_fixture(origin, proposals=[], reset_repairs=True,
                    appearance={**DEFAULT_APPEARANCE})
        page.goto(f"{origin}/p/scratch/document", wait_until="domcontentloaded")
        page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)

        # Two real candidates: v1 from the brief, v2 from a steer.
        composer = page.locator('[data-testid="doc-composer"]')
        composer.fill(BRIEF)
        page.keyboard.press("Enter")
        page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
        composer.fill(STEER)
        page.keyboard.press("Enter")
        page.locator('[data-testid="version-marker"][data-version="2"]').wait_for(timeout=30000)
        page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
        doc_id = urlparse(page.url).path.rsplit("/", 1)[-1]
        versions_url = f"{origin}/api/v1/projects/scratch/interactive/d/{doc_id}/api/versions"

        # ── split: two takes side by side ──────────────────────────────────────────
        page.locator('[data-testid="panel-tab"][data-tab="compare"]').click()
        page.get_by_test_id("version-compare-toggle").click()
        page.get_by_test_id("compare-panes").wait_for()
        headers = page.get_by_test_id("take-header")
        takes = [headers.nth(i).get_attribute("data-take") for i in range(headers.count())]
        panes = page.locator('[data-testid="compare-panes"] [data-testid="compare-pane"]')
        pane_versions = [panes.nth(i).get_attribute("data-version") for i in range(panes.count())]
        boxes = [panes.nth(i).bounding_box() for i in range(panes.count())]
        check("split-two-takes", takes == ["1", "2"] and pane_versions == ["2", "1"],
              takes=takes, panes=pane_versions)
        check("split-side-by-side",
              len(boxes) == 2 and boxes[0]["x"] + boxes[0]["width"] <= boxes[1]["x"] + 1
              and abs(boxes[0]["y"] - boxes[1]["y"]) < 2 and boxes[0]["width"] > 200,
              boxes=boxes)
        labels = [headers.nth(i).inner_text() for i in range(2)]
        check("split-take-labels", "Take 1" in labels[0] and "v2" in labels[0]
              and "Take 2" in labels[1] and "v1" in labels[1], labels=labels)
        page.screenshot(path=str(SHOTS / f"wavec-desk-takes.png"))

        # ── preview: consequence first, nothing sent ───────────────────────────────
        page.locator('[data-testid="take-pick"][data-take="2"]').click()
        consequence = page.get_by_test_id("take-pick-consequence").inner_text()
        check("preview-consequence",
              "v1 becomes the latest version" in consequence and "filed for your review" in consequence,
              text=consequence)
        check("preview-posts-nothing", get_json(f"{origin}/__fixture/proposal-posts")["posts"] == [])
        page.screenshot(path=str(SHOTS / f"wavec-desk-preview.png"))

        # ── pick: the preference proposal, and v1 as the working version ───────────
        page.get_by_test_id("take-pick-confirm").click()
        page.get_by_test_id("takes-receipt").wait_for()
        posts = get_json(f"{origin}/__fixture/proposal-posts")["posts"]
        check("pick-files-one-proposal",
              len(posts) == 1 and posts[0]["content"].startswith(f"Prefers takes like v1 of “{doc_id}” (picked over v2)")
              and posts[0].get("project") == "scratch" and posts[0].get("source") == f"doc:{doc_id}@v1",
              posts=posts)
        queue = get_json(f"{origin}/api/v1/proposals?state=pending")["proposals"]
        check("pick-lands-in-review-queue",
              len(queue) == 1 and queue[0]["kind_type"] == "memory"
              and queue[0]["payload"]["capture"] == "preference",
              queue=queue)
        manifest = get_json(versions_url)
        v3 = next((v for v in manifest["versions"] if v["version"] == 3), None)
        check("pick-forks-working-version", v3 is not None and v3["parent"] == 1, versions=manifest["versions"])
        page.locator('[data-testid="doc-canvas"][data-version="3"]').wait_for()
        receipt = page.get_by_test_id("takes-receipt").inner_text()
        check("pick-receipt", "Picked take 2 (v1)" in receipt and "as v3" in receipt
              and "filed for your review" in receipt, text=receipt)
        page.screenshot(path=str(SHOTS / f"wavec-desk-picked.png"))

        # ── remix: one steer to the document agent ─────────────────────────────────
        page.get_by_test_id("version-compare-toggle").click()
        page.get_by_test_id("compare-vs").select_option("2")
        page.locator('[data-testid="compare-pane"][data-version="2"]').wait_for()
        page.get_by_test_id("takes-remix-keep").fill("headline")
        steer = page.get_by_test_id("takes-remix-steer").inner_text()
        want = "Build on take 2 (v2), and keep take 1's (v3) headline."
        check("remix-steer-shown-first", want in steer, text=steer)
        page.screenshot(path=str(SHOTS / f"wavec-desk-remix.png"))
        page.get_by_test_id("takes-remix-send").click()
        page.locator('[data-testid="doc-panel"][data-tab="chat"]').wait_for()
        msg = page.locator('[data-testid="doc-message"]', has_text=want)
        msg.first.wait_for()
        manifest = get_json(versions_url)
        branched = [v for v in manifest["versions"] if v["parent"] == 2]
        check("remix-steers-from-take-2", len(branched) >= 1, versions=manifest["versions"])
        check("remix-files-no-proposal", len(get_json(f"{origin}/__fixture/proposal-posts")["posts"]) == 1)

    try:
        run()
        report["ok"] = True
    except SectionFailed:
        pass
    except Exception as e:  # noqa: BLE001 — report any driver failure as the step it hit
        report["steps"]["exception"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        try:
            page.screenshot(path=str(SHOTS / f"wavec-desk-failure.png"))
        except Exception:  # noqa: BLE001
            pass
    browser.close()

print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
