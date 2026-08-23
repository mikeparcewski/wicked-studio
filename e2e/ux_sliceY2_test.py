#!/usr/bin/env python3
"""
ux_sliceY2_test.py — the DES-UX-001 slice-Y2 gate: run identity (§7.5, C2,
EC40 — "five visually identical rows… retries are indistinguishable").
Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with its
`provenance` corpus on, which is ALREADY the slice's corpus (zero fixture
additions): r-auth (failed) and r-retry (completed) carry IDENTICAL prompts
("refactor the auth middleware") — the EC40 pair — r-auth's durable event
tail holds sessionStarted (NOW0-13m) + sessionFailed (NOW0-12m) on the real
GET /runs/:id/events wire, and r-smoke1 (completed) answers an EMPTY event
log: the honest-absent-times run. The DTO carries no timestamps (wire
verdict §7.5) — everything asserted here is CLIENT-derived.

The §7.5 DOM ACs, verbatim mapping:

  1. every /work run row carries `[data-testid="run-title"]` (the synthesized
     title: truncated intent · short-id · #ordinal) + `[data-testid="run-when"]`
     (the membership attach clock); the identical-prompt pair r-auth/r-retry
     renders DISTINGUISHABLE rows — the short-id assert — and r-retry (no
     membership record) renders the honest "time unknown", never a fabricated
     clock;
  2. the runs bottom sheet's rows carry the same run-title + run-when contract;
  3. palette rows for runs carry it too — and the short-id is now SEARCHABLE:
     typing `r-retr` finds r-retry (the composed label is the fuzzy corpus);
  4. run detail renders `[data-testid="run-times"]` derived from the event
     log — started/ended (data-started/-ended="log") and the duration
     ("took 1m 0s": NOW0-13m → NOW0-12m) for r-auth;
  5. r-smoke1 (empty event log) renders the honest absent state — the exact
     copy "no start or end times survive in this run's event log",
     data-started="none" — absence stated, never fabricated.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-Y2-run-rows.png    /work with the identical-prompt pair rendered as
                        distinguishable rows (title + attach clock)
  ux-Y2-run-times.png   r-auth's detail: the event-log-derived times line

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4387),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4387"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

AUTH_THREAD = "/p/auth-refactor/build/r-auth"
SMOKE_THREAD = "/p/smoke-tests/build/r-smoke1"

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


# ── 1. The same-origin build + the shared W2 fixture, provenance ON ─────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, provenance=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    def nav(path: str) -> None:
        """CLIENT-side navigation (pushState + popstate) — keeps stores warm."""
        page.evaluate(
            """(p) => { history.pushState(null, '', p);
                        window.dispatchEvent(new PopStateEvent('popstate')); }""",
            path)

    # ── Scene 1 (AC 1): /work — the identical-prompt pair is distinguishable ────
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="run-link"][data-run-id="r-retry"]').wait_for(timeout=30000)
    # The attach clock rides the members read (the board model's mirror) —
    # wait until r-auth's row shows a real age word, not the pre-mirror state.
    page.wait_for_function(
        """() => /\\d+[smhd] ago/.test(
             document.querySelector('[data-testid="run-link"][data-run-id="r-auth"]')
               ?.querySelector('[data-testid="run-when"]')?.textContent ?? '')""",
        timeout=15000)
    rows = page.evaluate(
        """() => {
          const rowOf = (rid) => {
            const row = document.querySelector(`[data-testid="run-link"][data-run-id="${rid}"]`);
            return row === null ? null : {
              title: row.querySelector('[data-testid="run-title"]')?.textContent ?? null,
              when: row.querySelector('[data-testid="run-when"]')?.textContent ?? null,
              text: row.textContent ?? '',
            };
          };
          return { auth: rowOf('r-auth'), retry: rowOf('r-retry') };
        }""")
    auth, retry = rows["auth"], rows["retry"]
    check("work_rows_distinguishable",
          auth is not None and retry is not None
          # the synthesized title: intent · short-id · #ordinal (EC40)
          and auth["title"] == "refactor the auth middleware · r-auth · #1"
          and retry["title"] == "refactor the auth middleware · r-retr · #1"
          and auth["title"] != retry["title"]        # the short-id assert
          and auth["text"] != retry["text"]          # whole rows differ, not just titles
          # the attach clock: real for the filed r-auth; the HONEST absent
          # state for r-retry (no membership record names a clock for it)
          and re.search(r"\d+[smhd] ago", auth["when"] or "") is not None
          and retry["when"] == "time unknown",
          **rows)
    page.screenshot(path=str(VSHOTS / "ux-Y2-run-rows.png"))

    # ── Scene 2 (AC 2): the bottom sheet rows carry the same contract ───────────
    page.locator('[data-testid="runs-bar-toggle"]').click()
    page.locator('[data-testid="runs-bottom-sheet"]').wait_for(timeout=10000)
    sheet = page.evaluate(
        """() => {
          const rows = [...document.querySelectorAll('[data-testid="runs-sheet-row"]')];
          const authRow = rows.find((r) => r.dataset.runId === 'r-auth');
          return {
            total: rows.length,
            titled: rows.filter((r) => r.querySelector('[data-testid="run-title"]')).length,
            clocked: rows.filter((r) => r.querySelector('[data-testid="run-when"]')).length,
            authTitle: authRow?.querySelector('[data-testid="run-title"]')?.textContent ?? null,
          };
        }""")
    check("sheet_rows_identified",
          sheet["total"] > 0
          and sheet["titled"] == sheet["total"]      # EVERY row (EC40)
          and sheet["clocked"] == sheet["total"]
          and sheet["authTitle"] == "refactor the auth middleware · r-auth · #1",
          **sheet)
    page.keyboard.press("Escape")

    # ── Scene 3 (AC 3): palette rows — titled, clocked, short-id searchable ─────
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.locator('[data-testid="palette-input"]').fill("r-retr")
    page.wait_for_function(
        """() => [...document.querySelectorAll('[data-testid="palette-row"][data-group="runs"]')]
              .some((r) => (r.querySelector('[data-testid="run-title"]')?.textContent ?? '')
                .includes('· r-retr ·'))""",
        timeout=10000)
    palette = page.evaluate(
        """() => {
          const rows = [...document.querySelectorAll('[data-testid="palette-row"][data-group="runs"]')];
          const hit = rows.find((r) => (r.querySelector('[data-testid="run-title"]')?.textContent ?? '')
            .includes('· r-retr ·'));
          return {
            runRows: rows.length,
            hitTitle: hit?.querySelector('[data-testid="run-title"]')?.textContent ?? null,
            hitWhen: hit?.querySelector('[data-testid="run-when"]')?.textContent ?? null,
          };
        }""")
    check("palette_short_id_finds_run",
          palette["hitTitle"] == "refactor the auth middleware · r-retr · #1"
          and palette["hitWhen"] is not None,
          **palette)
    page.keyboard.press("Escape")

    # ── Scene 4 (AC 4): run detail — event-log-derived start/end/duration ───────
    nav(AUTH_THREAD)
    page.locator('[data-testid="run-times"]').wait_for(timeout=15000)
    # The FINDING-013 backfill lands the durable tail; both clocks flip to "log".
    page.wait_for_function(
        """() => document.querySelector('[data-testid="run-times"]')
              ?.getAttribute('data-started') === 'log'""",
        timeout=15000)
    times = page.evaluate(
        """() => {
          const el = document.querySelector('[data-testid="run-times"]');
          return { started: el?.getAttribute('data-started'),
                   ended: el?.getAttribute('data-ended'),
                   text: el?.textContent ?? '' };
        }""")
    check("detail_times_from_event_log",
          times["started"] == "log" and times["ended"] == "log"
          and re.search(r"started \d+[smhd] ago", times["text"]) is not None
          and re.search(r"ended \d+[smhd] ago", times["text"]) is not None
          # NOW0-13m → NOW0-12m: the duration is frozen-clock exact
          and "took 1m 0s" in times["text"]
          # durable-log clocks are capture-stamped, never "(observed)"
          and "(observed)" not in times["text"],
          **times)
    page.screenshot(path=str(VSHOTS / "ux-Y2-run-times.png"))

    # ── Scene 5 (AC 5): the honest absent state — an empty event log says so ────
    nav(SMOKE_THREAD)
    page.wait_for_function(
        """() => document.querySelector('[data-testid="run-times"]')
              ?.getAttribute('data-started') === 'none'""",
        timeout=15000)
    absent = page.evaluate(
        """() => {
          const el = document.querySelector('[data-testid="run-times"]');
          return { started: el?.getAttribute('data-started'),
                   ended: el?.getAttribute('data-ended'),
                   text: el?.textContent ?? '' };
        }""")
    check("detail_times_honest_absent",
          absent["started"] == "none" and absent["ended"] == "none"
          and "no start or end times survive in this run's event log" in absent["text"]
          # never a fabricated clock on the absent run
          and "ago" not in absent["text"] and "took" not in absent["text"],
          **absent)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
