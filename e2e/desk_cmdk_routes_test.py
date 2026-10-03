#!/usr/bin/env python3
"""
desk_cmdk_routes_test.py — the skin contract's "by ⌘K" half (DES-STUDIO-REBUILD-001 §10, §14 Q2;
COVERAGE.md finding 1): every route the router serves is reachable from ⌘K, at 1440x700 under
STUDIO_SKIN=desk (the skin with the least nav, so ⌘K carries the most).

Against the in-process fixture (wave-1 corpus + the team corpus for a project with runs):

  1. Ctrl/⌘+K, "go:" lists the GO TO group only, and every row's address is a real route
     (none renders the not-found page).
  2. Each parameterless destination is reached by opening the palette, typing its label and
     pressing Enter: the address is the row's, and the page is not the not-found page.
  3. One row of each parametric shape the corpus holds (a project's chat/build/chronicle/
     campaigns, a run's events/files, a session) is reached the same way.
  4. 0 page errors.

Captures: e2e/shots/desk-cmdk-*.png. Env: FEEDBACK_PORT (default 4353).
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4353"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

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
    # Every address the app pushes, in order: proves the row's own address was navigated to,
    # whatever the page then does (a files view on a daemon without the files surface goes Back).
    page.add_init_script("window.__nav = []; const _p = history.pushState.bind(history); "
                         "history.pushState = (s, t, u) => { window.__nav.push(String(u)); return _p(s, t, u); };")
    set_fixture(origin, wave1=True, team_plan=True)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(600)

    def open_palette(query: str) -> None:
        page.locator("body").click(position={"x": 700, "y": 12})
        page.keyboard.press("ControlOrMeta+k")
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
        page.get_by_test_id("palette-input").fill(query)
        page.wait_for_timeout(150)

    # ── 1. the GO TO group (a word lists the per-item rows too) ─────────────────────
    open_palette("go:")
    dest_rows = page.get_by_test_id("palette-row").count()
    page.keyboard.press("Escape")
    open_palette("go: ·")
    rows = page.get_by_test_id("palette-row").evaluate_all(
        "els => els.map(e => ({ group: e.dataset.group, href: e.getAttribute('href'), label: e.innerText.split('\\n')[0] }))")
    page.screenshot(path=str(SHOTS / "desk-cmdk-go.png"))
    page.keyboard.press("Escape")
    groups = {r["group"] for r in rows}
    check("go-group", groups == {"go"} and dest_rows == 24 and len(rows) > 24, groups=sorted(groups), destinations=dest_rows, rows=len(rows))

    def reach(href: str, label: str) -> dict:
        open_palette(f"go: {label}")
        # Reached by the keyboard, as an operator does: ↓ to the row, Enter.
        hrefs = page.get_by_test_id("palette-row").evaluate_all("els => els.map(e => e.getAttribute('href'))")
        if href not in hrefs:
            page.keyboard.press("Escape")
            return {"href": href, "label": label, "ok": False, "why": "row not found by its label"}
        for _ in range(hrefs.index(href)):
            page.keyboard.press("ArrowDown")
        selected = page.locator('[data-testid="palette-row"][data-selected="true"]').get_attribute("href")
        if selected != href:
            page.keyboard.press("Escape")
            return {"href": href, "label": label, "ok": False, "why": f"selection landed on {selected}"}
        before = page.evaluate("() => window.__nav.length")
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        got = urllib.parse.urlparse(page.url)
        path = got.path + (f"?{got.query}" if got.query else "")
        dead = page.get_by_test_id("not-found").count() > 0
        # The row's own address must be the first one pushed, so a broken route that bounces
        # somewhere valid still fails (codex); then the page must not be the not-found page.
        pushed = page.evaluate("n => window.__nav.slice(n)", before)
        first = urllib.parse.unquote(pushed[0]) if pushed else None
        went = first == urllib.parse.unquote(href)
        return {"href": href, "label": label, "ok": not dead and went, "pushed": pushed[:3], "landed": path}

    # ── 2. every parameterless destination ──────────────────────────────────────────
    FIXED = {"/", "/watch", "/work", "/chats", "/chat/new", "/projects", "/execute", "/vibe", "/demo", "/steering/dashboard",
             "/steering/policies", "/steering/memories", "/testing/campaigns", "/testing/evals", "/repos", "/repos/new",
             "/runs/new", "/workflows", "/skills", "/mcp", "/system", "/theme", "/editors/dev", "/editors/conformance"}
    open_palette("go:")
    fixed = page.get_by_test_id("palette-row").evaluate_all(
        "els => els.map(e => ({ href: e.getAttribute('href'), label: e.innerText.split('\\n')[0] }))")
    page.keyboard.press("Escape")
    fixed = [r for r in fixed if r["href"] in FIXED]
    missing_fixed = sorted(FIXED - {r["href"] for r in fixed})
    results = [reach(r["href"], r["label"]) for r in fixed]
    bad = [r for r in results if not r["ok"]]
    page.screenshot(path=str(SHOTS / "desk-cmdk-last.png"))
    check("destinations", not bad and not missing_fixed, reached=len(results), bad=bad, missing=missing_fixed)

    # ── 3. one of each parametric shape the corpus holds ────────────────────────────
    want = (" · chat", " · build", " · chronicle", " · campaigns", " · raw events", " · files and diff", " · session", " · details")
    picked: dict = {}
    for r in rows:
        for w in want:
            if r["label"].endswith(w) and w not in picked:
                picked[w] = r
    presults = [reach(r["href"], r["label"]) for r in picked.values()]
    pbad = [r for r in presults if not r["ok"]]
    check("parametric", not pbad and sorted(picked) == sorted(want), reached=[r["href"] for r in presults], bad=pbad)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
