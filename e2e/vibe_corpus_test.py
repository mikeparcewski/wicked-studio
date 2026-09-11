#!/usr/bin/env python3
"""
vibe_corpus_test.py — `/vibe` and the Home door count what the daemon SERVES (acceptance finding
F-A45-008 MEDIUM), in a real browser against the shared loopback fixture (uxfix_fixture.py — no
switch: the standing corpus already holds the `notes` project's two documents). No crew daemon.

  1. A FRESH browser at /vibe (nothing opened this session) lists the notes documents without a
     click: the census fans out once per project on mount (GET /projects/<id>/interactive/api/docs
     — crew has no daemon-wide docs route), the tile says "N · all P projects" (never "projects
     opened this session"), the corpus label carries data-census=all-projects, the per-project chip
     narrows the grid and the tile keeps the corpus count, the button reads "reload all projects".
  2. A FRESH browser at / — the Home Vibe door says "N documents" (N ≥ 2), not "0 documents".

Captures (1440x700, device_scale_factor=1) into e2e/shots/vibe-corpus/: vibe-corpus.png.
Prereqs: Python Playwright with Chromium installed. Builds dist-sameorigin/ unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4437). Prints a JSON report; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, NOTES_DOCS, REPO, ensure_build, start_server

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4437"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
SHOTS = REPO / "e2e" / "shots" / "vibe-corpus"

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


dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)
NOTE_NAMES = sorted(d["name"] for d in NOTES_DOCS)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    docs_gets: list = []
    page.on("request", lambda r: docs_gets.append(r.url.replace(ORIGIN, ""))
            if r.method == "GET" and r.url.endswith("/interactive/api/docs") else None)

    # ── Scene 1: a fresh browser at /vibe — no click, the corpus is there ────────────────────
    page.goto(f"{ORIGIN}/vibe", wait_until="domcontentloaded")
    page.locator('[data-testid="vibe-doc-row"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_function(
        """() => document.querySelector('[data-testid="vibe-corpus-label"]')?.getAttribute('data-census') === 'all-projects'""",
        timeout=30000)
    vibe = page.evaluate(
        """() => {
          const t = (s) => document.querySelector(s)?.textContent ?? '';
          const rows = Array.from(document.querySelectorAll('[data-testid="vibe-doc-row"]'));
          const chips = Array.from(document.querySelectorAll('[data-testid="vibe-filter"] button'))
            .map(b => (b.textContent ?? '').replace(/\\s+/g, ''))
            .filter(x => /^(Allprojects|notes|q3-review-deck)\\d+$/.test(x));
          return {
            names: rows.map(r => r.querySelector('a')?.textContent ?? '').sort(),
            tile: t('[data-testid="stat-vibe-items"]'),
            label: t('[data-testid="vibe-corpus-label"]'),
            census: document.querySelector('[data-testid="vibe-corpus-label"]')?.getAttribute('data-census'),
            chips,
            button: t('[data-testid="vibe-load-all"]').trim(),
            buttonCensus: document.querySelector('[data-testid="vibe-load-all"]')?.getAttribute('data-census'),
          };
        }""")
    projects_asked = sorted({re.sub(r"^/api/v1/projects/([^/]+)/.*$", r"\1", u) for u in docs_gets})
    check(
        "vibe_lists_the_daemon_corpus_without_a_click",
        vibe["names"] == NOTE_NAMES
        and re.search(r"all \d+ projects", vibe["tile"]) is not None
        and "opened this session" not in vibe["tile"] and "opened this session" not in vibe["label"]
        and vibe["census"] == "all-projects"
        and any(c.startswith("Allprojects") for c in vibe["chips"]) and any(c.startswith("notes") for c in vibe["chips"])
        and vibe["button"] == "reload all projects" and vibe["buttonCensus"] == "done"
        and "notes" in projects_asked and "default" not in projects_asked and len(projects_asked) >= 3,
        projects_asked=projects_asked, **vibe,
    )
    page.screenshot(path=str(SHOTS / "vibe-corpus.png"))

    # The per-project chip is a FILTER: the grid narrows, the tile keeps the corpus count.
    page.locator('[data-testid="vibe-filter"] button', has_text=re.compile(r"^notes")).first.click()
    page.wait_for_timeout(200)
    narrowed = page.evaluate(
        """() => ({
          rows: document.querySelectorAll('[data-testid="vibe-doc-row"]').length,
          tile: document.querySelector('[data-testid="stat-vibe-items"]')?.textContent ?? '',
        })""")
    check("project_chip_narrows_the_grid", narrowed["rows"] == len(NOTES_DOCS) and re.search(r"all \d+ projects", narrowed["tile"]) is not None, **narrowed)

    # ── Scene 2: a fresh browser at / — the Home door counts the corpus ─────────────────────
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    home = ctx2.new_page()
    home.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    home.locator('[data-testid="section-door"][data-section="vibe"]').first.wait_for(timeout=30000)
    home.add_style_tag(content=HIDE_GATE_TOASTS)
    got = home.wait_for_function(
        """() => { const d = document.querySelector('[data-testid="section-door"][data-section="vibe"]');
                   const m = /(\\d+) documents?/.exec(d?.textContent ?? ''); return m && Number(m[1]) >= 2; }""",
        timeout=30000)
    door = home.locator('[data-testid="section-door"][data-section="vibe"]').first.text_content() or ""
    check("home_vibe_door_counts_the_corpus", bool(got) and "0 documents" not in door, door=door)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
