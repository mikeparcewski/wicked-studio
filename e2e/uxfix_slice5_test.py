#!/usr/bin/env python3
"""
uxfix_slice5_test.py — the DES-UXFIX-001 slice-5 gate: Build given a purpose
(§2.7, F7) and the dead shells folded, proven in a real browser against the W2
messy-reality fixture (§4.2, `uxfix_fixture.py`) extended with three slice-5
switches (no_runs / usage_ws / long_prompt — all default-off, so the slice-1..4
rigs see the exact fixture they always saw).

Same rig pattern as the earlier gates: the SHARED deterministic fixture server
serves the `dist-sameorigin/` build plus every endpoint the routes read; no
crew daemon is involved anywhere.

What it asserts (design §4.3, the slice-5 DOM AC):
  1. Empty Build (no_runs=True): data-testid="build-purpose" present with a
     non-empty subject; NO `—` anywhere on the surface (the em-dash stat hero is
     gone, F7); no campaigns-panel testid; no Chats panel; the runs region is
     OMITTED (empty-state budget — the purpose IS the empty state, §3.4); the
     ONE primary action is "+ Build something" — the only accent-filled control
     inside the surface (EC1 within the mode surface).
  2. Build with work (usage_ws + long_prompt; on the FLAT `/runs` home since
     DES-UX-001 slice S scoped project Build tabs to their own runs): rows are labelled by
     INTENT phrase, never the raw prompt (the long-prompt run truncates with
     the intent leading; the full prompt survives on the row's title) and never
     by the engine's workflow id; statuses read in user words (working · phase
     k/n, gate · needs you, done, failed) — no `executing`/`distributing`
     anywhere (V3); the gate inbox appears headed by the open-gate count
     ("2 gates need you") and is answerable; the stat row survives only as the data-gated footer
     (steps in flight · $ · tokens), still with no `—`.

Captures (§4.0 contract: 1440x900 viewport, device_scale_factor=1, waits on
data-testid, never a sleep) into e2e/shots/uxfix/ — gitignored evidence:
  uxfix-5-build-empty.png   purpose-first empty Build, one primary action
  uxfix-5-build-runs.png    the ONE intent-labelled runs list + gate inbox + footer

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4334), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    LONG_PROMPT,
    NOW0,
    SHOTS,
    ensure_build,
    set_fixture,
    start_server,
)

W2_PORT = int(os.environ.get("W2_PORT", "4334"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"

# EC1's contract is that exactly ONE element on the surface is filled with THE
# accent — whatever hue the token system says the accent is. Originally this
# was the inherited amber literal; DES-VISION-001 made the accent a token
# (§2.5, applied to this surface by vision slice 4), so the rig PROBES
# var(--accent) in the page rather than pinning a hex that theming may move.
ACCENT_PROBE = """() => { const el = document.createElement('div');
  el.style.background = 'var(--accent)'; document.body.appendChild(el);
  const v = getComputedStyle(el).backgroundColor; el.remove(); return v; }"""

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the slice-1..4 rigs — same dist dir) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (§4.2 + the slice-5 switches) ─────────────
start_server(W2_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

console_errors: list[str] = []

# The whole-surface probe both scenes share: text, testids, and the accent census.
SURFACE_JS = """accent => {
  const dash = document.querySelector('[data-testid="build-dashboard"]');
  const text = dash ? dash.innerText : '';
  const accentFills = dash ? Array.from(dash.querySelectorAll('*'))
    .filter(el => getComputedStyle(el).backgroundColor === accent) : [];
  const purpose = document.querySelector('[data-testid="build-purpose"]');
  const primary = document.querySelector('[data-testid="build-something"]');
  return {
    dashPresent: dash !== null,
    text,
    noEmDash: !text.includes('\\u2014'),
    purposeText: purpose ? purpose.textContent : null,
    primaryText: primary ? primary.textContent : null,
    primaryFilled: primary ? getComputedStyle(primary).backgroundColor === accent : false,
    accentFillCount: accentFills.length,
    campaignsAbsent: !document.querySelector('[data-testid="campaign-dag-stub"]')
      && !text.includes('Campaigns'),
    chatsPanelAbsent: !text.includes('New Chat') && !text.includes('No chats yet'),
    runRows: Array.from(document.querySelectorAll('[data-testid="build-run-row"]'))
      .map(r => ({ text: r.innerText.replace(/\\s+/g, ' ').trim(), title: r.getAttribute('title') })),
    footer: (document.querySelector('[data-testid="build-stats-footer"]') || {}).textContent ?? null,
    gateInbox: (document.querySelector('[data-testid="gate-inbox"]') || {}).innerText ?? null,
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    # ── Scene A: the empty Build — purpose first, one primary action ──────────
    set_fixture(ORIGIN, no_runs=True)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.goto(f"{ORIGIN}/p/scratch/build", wait_until="domcontentloaded")
    page.locator('[data-testid="build-purpose"]').wait_for(timeout=30000)
    page.locator('[data-testid="build-something"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    empty = page.evaluate(SURFACE_JS, page.evaluate(ACCENT_PROBE))
    page.screenshot(path=str(SHOTS / "uxfix-5-build-empty.png"))
    page.close()

    report["steps"]["slice5_build_empty"] = {
        "ok": all([
            empty["dashPresent"],
            (empty["purposeText"] or "").startswith("Build runs governed code work"),
            "independent check" in (empty["purposeText"] or ""),
            "evidence" in (empty["purposeText"] or ""),
            empty["noEmDash"],                       # no `—` stat hero (F7)
            empty["primaryText"] == "+ Build something",
            empty["primaryFilled"],
            empty["accentFillCount"] == 1,           # EC1: the ONE primary on the surface
            empty["campaignsAbsent"],
            empty["chatsPanelAbsent"],
            len(empty["runRows"]) == 0,              # region omitted, not a "nothing" line
            empty["footer"] is None,                 # stats footer is data-gated
            empty["gateInbox"] is None,              # gate inbox only when gates pend
            "No work sessions" not in empty["text"],
            "Working…" not in empty["text"],         # EC10
        ]),
        **{k: v for k, v in empty.items() if k != "text"},
    }

    # ── Scene B: Build with work — one intent-labelled list, inbox, footer ────
    # Re-scoped by DES-UX-001 slice S (§2.3 rule 2): a project's Build tab now
    # shows EXACTLY its runs, so the whole-fixture list this scene asserts
    # lives on the FLAT run home (`/runs`) — the same surface, unscoped, where
    # every global-list assertion below keeps its original meaning.
    set_fixture(ORIGIN, no_runs=False, usage_ws=True, long_prompt=True)
    page2 = ctx.new_page()
    page2.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page2.goto(f"{ORIGIN}/runs", wait_until="domcontentloaded")
    page2.locator('[data-testid="build-purpose"]').wait_for(timeout=30000)
    page2.locator('[data-testid="gate-inbox"]').wait_for(timeout=30000)
    page2.locator('[data-testid="build-stats-footer"]').wait_for(timeout=30000)  # ws cliUsage
    # BOTH open gates land in the inbox via the self-healing `GET /runs/:id/gate`
    # reconcile (useRuns) — wait for the count so the capture is deterministic,
    # never a sleep.
    page2.wait_for_function(
        """() => (document.querySelector('[data-testid="gate-inbox"]')?.innerText ?? '')
                   .includes('2 gates need you')""",
        timeout=30000,
    )
    page2.add_style_tag(content=HIDE_GATE_TOASTS)

    working = page2.evaluate(SURFACE_JS, page2.evaluate(ACCENT_PROBE))
    page2.screenshot(path=str(SHOTS / "uxfix-5-build-runs.png"))
    page2.close()

    ctx.close()
    browser.close()

rows = working["runRows"]
row_texts = [r["text"] for r in rows]
long_rows = [r for r in rows if r["title"] == LONG_PROMPT]


def row_with(fragment: str) -> str:
    return next((t for t in row_texts if fragment in t), "")


report["steps"]["slice5_build_runs"] = {
    "ok": all([
        working["dashPresent"],
        (working["purposeText"] or "").startswith("Build runs governed code work"),
        working["noEmDash"],
        working["campaignsAbsent"],
        working["chatsPanelAbsent"],
        working["primaryText"] == "+ Build something",
        # ONE list: every §4.2 work run rides it (5 active + 4 recent terminal).
        len(rows) == 9,
        # Intent labels, user-word statuses (V3) — never the engine's words.
        "working · phase 1/1" in row_with("add rate-limiting to the upload endpoint"),
        "gate · needs you" in row_with("make the Q3 review deck"),
        "done" in row_with("smoke: login flow"),
        "failed · at phase 1" in row_with("spike the legacy importer"),
        all("executing" not in t and "distributing" not in t and "awaiting_human" not in t
            and "wf-w2" not in t for t in row_texts),
        # The long prompt truncates with the intent leading; full prompt on title.
        len(long_rows) == 1,
        LONG_PROMPT not in long_rows[0]["text"] if long_rows else False,
        long_rows[0]["text"].startswith("⚙ refactor the ingestion pipeline") if long_rows else False,
        "…" in long_rows[0]["text"] if long_rows else False,
        # The gate inbox is present, counted, and answerable (W4): both open
        # gates (§4.2's r-q3 SIMPLE + r-api COMPLEX) with their prompts.
        working["gateInbox"] is not None,
        "2 gates need you" in (working["gateInbox"] or ""),
        "Approve the deck outline?" in (working["gateInbox"] or ""),
        "How should the tables move?" in (working["gateInbox"] or ""),
        "Approve" in (working["gateInbox"] or ""),
        # The stat row survives only as the data-gated footer — real numbers, no `—`.
        # Slice W (DES-UX-001 §5.3, EC39) re-scope: the footer now NAMES its
        # window (the range the pills select) as a dim-mono suffix.
        (working["footer"] or "").startswith("3 steps in flight · $0.42 · 98.0k tokens"),
        (working["footer"] or "").endswith("30d"),
    ]),
    "rows": row_texts,
    "footer": working["footer"],
    "gate_inbox_head": (working["gateInbox"] or "").split("\n")[0],
    "purpose": working["purposeText"],
}

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(SHOTS / "uxfix-5-build-empty.png"),
    str(SHOTS / "uxfix-5-build-runs.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("slice5_verdict", f"slice-5 assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
