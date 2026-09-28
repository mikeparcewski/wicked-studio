#!/usr/bin/env python3
"""
wavea_home_test.py — studio Wave A, lane "home" (1440x700): Home's elements carry their own next
move, with the consequence shown before it runs.

  idea 3   collapse clones — 9 never-indexed repos render as ONE Needs You row whose line states
           the consequence ("Launches 9 onboarding runs …") and whose "Index all 9 repos" launches
           them: the fixture records 9 POST /repos/<id>/onboard.
  idea 5   numbers are repair moves — the Governed tile's dead-letter count carries "Replay dead
           letters": the click asks for a DRY RUN only and shows its preview; the real replay is
           posted only on confirm, and the result is stated.
  idea 14  broken-clock pill — a never-indexed repo whose registered_at reads 1970 shows an
           "impossible age" pill linking to the repo, never "20702d".

Captures (e2e/shots/): wavea-<skin>-clones.png, wavea-<skin>-replay-preview.png,
wavea-<skin>-replay-done.png, wavea-<skin>-pill.png.
Env: FEEDBACK_PORT (default 4397), STUDIO_SKIN. JSON report; exit 0/1.
"""

import json
import os
import re
import sys
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4397"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SKIN = STUDIO_SKIN

report: dict = {"ok": False, "skin": SKIN, "steps": {}}


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


def get_json(origin: str, path: str):
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())


def reset(origin: str, **switches) -> None:
    set_fixture(origin, **{"never_indexed": 0, "broken_clock": False, "governance": None,
                           "reset_repairs": True, "appearance": {**DEFAULT_APPEARANCE, "skin": SKIN},
                           **switches})


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def home() -> None:
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)

    def section_clones() -> None:
        reset(origin, never_indexed=9)
        home()
        page.wait_for_function(
            """() => document.querySelectorAll('[data-testid="need-row"][data-kind="repo-graph"]').length > 0""")
        repo_rows = page.locator('[data-testid="need-row"][data-kind="repo-graph"]')
        check("clones-one-row", repo_rows.count() == 1, rows=repo_rows.count())
        row = repo_rows.first
        check("clones-count-9", row.get_attribute("data-count") == "9", count=row.get_attribute("data-count"))
        line = row.get_by_test_id("need-line").inner_text()
        check("clones-consequence-first", line.startswith("Launches 9 onboarding runs"), line=line)
        act = row.get_by_test_id("need-batch-act")
        check("clones-batch-label", act.inner_text().strip() == "Index all 9 repos ›", label=act.inner_text())
        check("clones-nothing-posted-yet", get_json(origin, "/__fixture/onboard-posts")["posts"] == [])
        page.screenshot(path=str(SHOTS / f"wavea-{SKIN}-clones.png"))
        act.click()
        page.wait_for_function(
            """() => document.querySelector('[data-testid="need-batch-act"]')?.dataset.batchPhase === 'done'""")
        posts = get_json(origin, "/__fixture/onboard-posts")["posts"]
        check("clones-9-launches", sorted(posts) == sorted(f"idx-{i}" for i in range(9)), posts=posts)
        check("clones-result-stated", "Launched 9" in page.get_by_test_id("need-batch-act").inner_text())

    def section_replay() -> None:
        reset(origin, governance="deadletters")
        home()
        tile = page.get_by_test_id("home-kpi-governed")
        tile.wait_for(state="visible")
        check("replay-count-shown", "128+ governance events dead-lettered" in tile.inner_text())
        repair = page.locator('[data-testid="kpi-repair"][data-repair="replay"]')
        check("replay-move-on-tile", repair.count() == 1)
        # The move must not sit on the tile's own rows (label, value, sub): at 1440 a two-digit value,
        # its delta badge or its unit ran under the chip. Checked on every tile carrying a move.
        overlaps = page.evaluate("""() => {
          const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const out = [];
          for (const chip of document.querySelectorAll('[data-testid="kpi-repair"]')) {
            const c = chip.getBoundingClientRect();
            for (const row of chip.parentElement.querySelectorAll('.deck-lab, .deck-val, .deck-sub, .deck-bar')) {
              if (hit(c, row.getBoundingClientRect())) out.push(chip.dataset.repair + ' over ' + row.className);
            }
          }
          return out;
        }""")
        check("repair-move-clear-of-tile-rows", overlaps == [], overlaps=overlaps)
        repair.click()
        preview = page.get_by_test_id("kpi-repair-preview")
        preview.wait_for(state="visible")
        page.wait_for_function(
            """() => (document.querySelector('[data-testid="kpi-repair-preview"]')?.textContent || '')
                      .includes('Would replay 128')""")
        text = preview.inner_text()
        check("replay-dry-run-preview", "Dry run — nothing has moved yet" in text
              and "stay quarantined" in text, text=text)
        check("replay-only-dry-run-posted", get_json(origin, "/__fixture/replay-posts")["posts"] == [{"dryRun": True}],
              posts=get_json(origin, "/__fixture/replay-posts")["posts"])
        page.screenshot(path=str(SHOTS / f"wavea-{SKIN}-replay-preview.png"))
        page.get_by_test_id("kpi-repair-confirm").click()
        page.get_by_test_id("kpi-repair-result").wait_for(state="visible")
        result = page.get_by_test_id("kpi-repair-result").inner_text()
        check("replay-result", "120 landed" in result and "8 still quarantined" in result, result=result)
        check("replay-posted-after-confirm",
              get_json(origin, "/__fixture/replay-posts")["posts"] == [{"dryRun": True}, {"dryRun": False}])
        # The page re-read diagnostics: the tile no longer reads dead-lettered.
        page.wait_for_function(
            """() => !(document.querySelector('[data-testid="home-kpi-governed"]')?.textContent || '')
                      .includes('dead-lettered')""")
        page.screenshot(path=str(SHOTS / f"wavea-{SKIN}-replay-done.png"))

    def section_pill() -> None:
        reset(origin, never_indexed=1, broken_clock=True)
        home()
        page.wait_for_function(
            """() => !!document.querySelector('[data-testid="need-row"][data-kind="repo-graph"]')""")
        row = page.locator('[data-testid="need-row"][data-kind="repo-graph"]').first
        age = row.get_by_test_id("need-age")
        check("pill-shown", age.get_attribute("data-age-pill") == "impossible",
              pill=age.get_attribute("data-age-pill"), text=age.inner_text())
        check("pill-says-so", "impossible age" in age.inner_text() and not re.search(r"\d{3,}d", row.inner_text()),
              row=row.inner_text())
        check("pill-links-record", age.get_attribute("href") == "/repo-detail/idx-0", href=age.get_attribute("href"))
        page.screenshot(path=str(SHOTS / f"wavea-{SKIN}-pill.png"))
        age.click()
        page.wait_for_function("() => window.location.pathname === '/repo-detail/idx-0'")
        check("pill-opens-record", True)

    def section_retry() -> None:
        # Idea 5's other repair move: the Failed tile's "Retry failed" relaunches f1 (wave 2b: failed an
        # hour ago) with `retryOf` lineage. The preview posts nothing; the confirm launches once.
        reset(origin, wave1=True, wave2b=True, simple_gates=[], project_dto=True)
        launches: list = []
        page.on("request", lambda r: launches.append(json.loads(r.post_data or "{}"))
                if r.method == "POST" and r.url.endswith("/api/v1/runs") else None)
        home()
        repair = page.locator('[data-testid="kpi-repair"][data-repair="retry"]')
        repair.wait_for(state="visible")
        repair.click()
        preview = page.locator('[data-testid="kpi-repair-preview"][data-repair="retry"]')
        preview.wait_for(state="visible")
        check("retry-preview-first", preview.inner_text().startswith("Relaunches 1 run with the same brief")
              and launches == [], text=preview.inner_text())
        preview.get_by_test_id("kpi-repair-confirm").click()
        result = preview.get_by_test_id("kpi-repair-result")
        result.wait_for(state="visible")
        check("retry-relaunched", result.inner_text().startswith("Relaunched 1")
              and len(launches) == 1 and launches[0].get("retryOf") == "f1", result=result.inner_text(), launches=launches)
        page.screenshot(path=str(SHOTS / f"wavea-{SKIN}-retry.png"))

    ok = True
    for section in (section_clones, section_replay, section_pill, section_retry):
        try:
            section()
        except SectionFailed:
            ok = False
        except Exception as e:  # noqa: BLE001 — a journey reports, never tracebacks
            report["steps"][section.__name__] = {"ok": False, "error": repr(e)[:400]}
            ok = False
    browser.close()

report["ok"] = ok
print(json.dumps(report, indent=2))
sys.exit(0 if ok else 1)
