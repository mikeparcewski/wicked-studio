#!/usr/bin/env python3
"""
vibe_corpus_test.py — `/vibe` and the Home door count what the daemon serves, WITHOUT spawning a
bridge per project (acceptance finding F-A45-008, bounded by the independent review of #263 F-1/F-2),
in a real browser against the shared loopback fixture (uxfix_fixture.py — no switch). The fixture
serves the per-project docs route (`notes` holds two documents) and, like a pre-0.36 daemon, answers
the unknown-route 404 for the daemon-wide index. No crew daemon.

  1. A FRESH browser at /vibe fans out to NO project on mount: the only per-project docs GETs are the
     app's board model's own root-guarded reads (q3-review-deck, notes — the two rooted projects),
     plus one presence-checked index read (answered 404); the tile says "documents in opened
     projects" — never "all N projects" on the strength of an unasked bridge.
  2. The operator's explicit `[load for all projects]` asks the projects ONE AT A TIME (never two
     docs GETs in flight), names the project being asked, then lists the notes documents; the label
     reads "all N projects" (the fixture's bridges all answer) and the button "reload all projects".
  3. The per-project chip narrows the grid; the tile keeps the corpus count.
  4. A FRESH browser at / — the Home Vibe door counts honestly: "N documents in opened projects",
     never "0 documents" as a bare claim about the daemon.

Captures (1440x700, device_scale_factor=1) into e2e/shots/vibe-corpus/: vibe-corpus.png.
Prereqs: Python Playwright with Chromium installed. Builds dist-sameorigin/ unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4437), PLAYWRIGHT_CHANNEL (e.g. `chrome`). Prints a JSON report; exit 0/1.
"""

import json
import os
import re
import sys
import threading

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
DOCS_RE = re.compile(r"^/api/v1/projects/([^/]+)/interactive/api/docs$")

with sync_playwright() as p:
    # PLAYWRIGHT_CHANNEL (review R2-6): run on an installed browser channel (`chrome`, `msedge`)
    # when the Playwright browser cache is absent on the host — nothing is installed by a rig.
    channel = os.environ.get("PLAYWRIGHT_CHANNEL")
    browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()

    # Every docs GET, in order, and the largest number in flight at once (the SEQUENTIAL proof).
    lock = threading.Lock()
    docs_gets: list = []
    index_gets: list = []
    inflight = [0]
    max_inflight = [0]

    def on_request(r) -> None:
        path = r.url.replace(ORIGIN, "")
        if r.method != "GET":
            return
        if path == "/api/v1/interactive/docs":
            index_gets.append(path)
        m = DOCS_RE.match(path)
        if m:
            with lock:
                docs_gets.append(m.group(1))
                inflight[0] += 1
                max_inflight[0] = max(max_inflight[0], inflight[0])

    def on_finished(r) -> None:
        if r.method == "GET" and DOCS_RE.match(r.url.replace(ORIGIN, "")):
            with lock:
                inflight[0] -= 1

    page.on("request", on_request)
    page.on("requestfinished", on_finished)
    page.on("requestfailed", on_finished)

    # ── Scene 1: a fresh browser at /vibe — nothing asked per project ────────────────────────
    page.goto(f"{ORIGIN}/vibe", wait_until="domcontentloaded")
    page.locator('[data-testid="vibe-corpus-label"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_function("""() => !!document.querySelector('[data-testid="vibe-load-all"]')""", timeout=30000)
    page.wait_for_timeout(1500)  # give any mount-time fan-out the chance to betray itself
    fresh = page.evaluate(
        """() => {
          const t = (s) => document.querySelector(s)?.textContent ?? '';
          return {
            rows: document.querySelectorAll('[data-testid="vibe-doc-row"]').length,
            tile: t('[data-testid="stat-vibe-items"]'),
            census: document.querySelector('[data-testid="vibe-corpus-label"]')?.getAttribute('data-census'),
            button: t('[data-testid="vibe-load-all"]').trim(),
          };
        }""")
    # The app's board model asks ONLY projects with an interactive root (its own root-guarded read,
    # the pre-existing behaviour the review endorsed) — q3-review-deck and notes here. Anything
    # beyond that set on a fresh page would be the banned per-project fan-out.
    rooted = {"q3-review-deck", "notes"}
    fresh_asked = set(docs_gets)
    check(
        "fresh_vibe_asks_no_bridge_beyond_the_board_models_rooted_reads",
        fresh_asked.issubset(rooted) and len(index_gets) == 1
        and fresh["census"] == "opened"
        and "documents in opened projects" in fresh["tile"] and re.search(r"all \d+ projects", fresh["tile"]) is None
        and fresh["button"] == "load for all projects",
        docs_gets=list(docs_gets), index_gets=list(index_gets), **fresh,
    )

    # ── Scene 2: the explicit gesture — sequential, named, honest at the end ──────────────────
    with lock:
        docs_gets.clear()
        inflight[0] = 0
        max_inflight[0] = 0
    page.locator('[data-testid="vibe-load-all"]').click()
    page.locator('[data-testid="vibe-fanout-progress"]').wait_for(timeout=10000)
    progress = page.locator('[data-testid="vibe-fanout-progress"]').text_content() or ""
    page.wait_for_function(
        """() => document.querySelector('[data-testid="vibe-corpus-label"]')?.getAttribute('data-census') !== 'loading'
              && document.querySelector('[data-testid="vibe-corpus-label"]')?.getAttribute('data-census') !== 'opened'""",
        timeout=120000)
    loaded = page.evaluate(
        """() => {
          const t = (s) => document.querySelector(s)?.textContent ?? '';
          const rows = Array.from(document.querySelectorAll('[data-testid="vibe-doc-row"]'));
          const chips = Array.from(document.querySelectorAll('[data-testid="vibe-filter"] button'))
            .map(b => (b.textContent ?? '').replace(/\\s+/g, ''))
            .filter(x => /^(Allprojects|notes|q3-review-deck)\\d+$/.test(x));
          return {
            names: rows.map(r => r.querySelector('a')?.textContent ?? '').sort(),
            tile: t('[data-testid="stat-vibe-items"]'),
            census: document.querySelector('[data-testid="vibe-corpus-label"]')?.getAttribute('data-census'),
            unreachable: t('[data-testid="vibe-unreachable"]'),
            chips,
            button: t('[data-testid="vibe-load-all"]').trim(),
          };
        }""")
    asked = sorted(set(docs_gets))
    check(
        "explicit_load_is_sequential_and_honest",
        max_inflight[0] == 1 and len(docs_gets) >= 3 and "default" not in asked and "notes" not in asked  # notes was already listed — not asked again
        and "asking " in progress and "one bridge at a time" in progress
        and loaded["names"] == NOTE_NAMES
        and loaded["census"] == "all-projects" and re.search(r"all \d+ projects", loaded["tile"]) is not None
        and loaded["unreachable"] == ""
        and any(c.startswith("Allprojects") for c in loaded["chips"]) and any(c.startswith("notes") for c in loaded["chips"])
        and loaded["button"] == "reload all projects",
        max_inflight=max_inflight[0], asked=asked, progress=progress, **loaded,
    )
    page.screenshot(path=str(SHOTS / "vibe-corpus.png"))

    # ── Scene 3: the per-project chip is a FILTER ─────────────────────────────────────────────
    page.locator('[data-testid="vibe-filter"] button', has_text=re.compile(r"^notes")).first.click()
    page.wait_for_timeout(200)
    narrowed = page.evaluate(
        """() => ({
          rows: document.querySelectorAll('[data-testid="vibe-doc-row"]').length,
          tile: document.querySelector('[data-testid="stat-vibe-items"]')?.textContent ?? '',
        })""")
    check("project_chip_narrows_the_grid", narrowed["rows"] == len(NOTES_DOCS) and re.search(r"all \d+ projects", narrowed["tile"]) is not None, **narrowed)

    # ── Scene 4: a fresh browser at / — the Home door counts honestly, asks no bridge ─────────
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    home = ctx2.new_page()
    home_docs_gets: list = []
    home.on("request", lambda r: home_docs_gets.append(r.url.replace(ORIGIN, ""))
            if r.method == "GET" and DOCS_RE.match(r.url.replace(ORIGIN, "")) else None)
    home.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    home.locator('[data-testid="section-door"][data-section="vibe"]').first.wait_for(timeout=30000)
    home.add_style_tag(content=HIDE_GATE_TOASTS)
    home.wait_for_timeout(2500)  # the board model's own root-guarded reads land; nothing else may fire
    door = home.locator('[data-testid="section-door"][data-section="vibe"]').first.text_content() or ""
    # The board model asks ONLY projects with an interactive root (q3-review-deck, notes) — those two
    # reads are its own, not a census; anything beyond them would be the banned fan-out.
    rooted = {"q3-review-deck", "notes"}
    home_asked = {DOCS_RE.match(u).group(1) for u in home_docs_gets}
    check(
        "home_vibe_door_counts_honestly_without_fanout",
        home_asked.issubset(rooted)
        and re.search(r"\d+ documents? in opened projects", door) is not None
        and "0 documents" not in door.replace("0 documents in opened", ""),
        door=door, home_asked=sorted(home_asked),
    )

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
