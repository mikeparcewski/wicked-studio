#!/usr/bin/env python3
"""
desk_repo_page_test.py — the repo page says what is true about its code graph (studio#461), under
the Desk at 1440x700 against the in-process fixture's registered repo:

  1. A BUILT GRAPH WITH NO CODE (a Markdown-only repo: 7 symbols, 2 files, nothing to rank): the
     hotspots and the language mix say so, and nothing on the page says "run onboarding".
  2. A FAILED GRAPH READ: the page says it could not read the graph, with "Try again"; no "run
     onboarding". When the daemon answers again, "Try again" brings the hotspots back.
  3. 0 page errors.

Captures: e2e/shots/desk-repo-page-*.png. Env: FEEDBACK_PORT (default 4359).
"""

import json
import os
import sys

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4359"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))

    def open_repo() -> str:
        """The page's graph sentences — hotspots, language mix, the Code graph card — not the header's
        own Run Onboarding action, which stays on every repo (codex on #461: scope the check)."""
        page.goto(f"{origin}/repo-detail/studio-api", wait_until="networkidle")
        page.get_by_test_id("language-bar").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(400)
        return page.evaluate("""() => ['repo-hotspots-empty', 'language-bar', 'repo-graph-empty']
            .map(t => (document.querySelector(`[data-testid="${t}"]`) || {}).innerText || `<no ${t}>`).join('\\n')""")

    # ── 1. built, no code ────────────────────────────────────────────────────────
    set_fixture(origin, repo=True, repo_graph="docs")
    text = open_repo()
    page.screenshot(path=str(SHOTS / "desk-repo-page-docs.png"))
    stats = page.locator('[data-testid^="graph-stat-"]').count()
    check("indexed-but-no-code-is-said", "7 symbols indexed across 2 files" in text
          and "No code files in the indexed graph" in text and "7 symbols indexed — none of them code" in text
          and "run onboarding" not in text.lower() and stats == 0, text=text, stat_rows=stats)

    # ── 2. the graph read failed ─────────────────────────────────────────────────
    set_fixture(origin, repo_graph="fail")
    text = open_repo()
    page.screenshot(path=str(SHOTS / "desk-repo-page-failed.png"))
    check("failed-read-is-said", "Couldn’t read the code graph" in text and "run onboarding" not in text.lower()
          and page.get_by_test_id("repo-graph-retry").count() == 1, text=text)
    set_fixture(origin, repo_graph=None)
    page.get_by_test_id("repo-graph-retry").click()
    try:
        page.get_by_test_id("hotspots-excerpt").wait_for(state="visible", timeout=10000)
        back = True
    except Exception:
        back = False
    check("try-again-reads-again", back)
    set_fixture(origin, repo=False)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
