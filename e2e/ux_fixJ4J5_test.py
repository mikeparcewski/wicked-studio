#!/usr/bin/env python3
"""
ux_fixJ4J5_test.py — the BRIEF-UX-001 re-review fix gate for the two blockers:

J4/C6 (CRITICAL) — the chat session is unfindable after navigating away:
  1. an opened chat gets a REAL URL: the first send mints the session and the
     address becomes /chat/:id (replace — Back never re-enters /chat/new);
  2. /chats live rows are DOORS: clicking one lands on /chat/:id, where the
     surface REJOINS the warm session (GET /chats/:id probe) and states the
     honest boundary — the wire keeps seats, not history (crew routes.ts:
     chatSeats), so earlier messages are not replayed and the page SAYS so
     (chat-rejoined-note), never a silent empty;
  3. a routed id the daemon no longer holds renders the honest ended boundary
     (chat-session-ended) — transcripts are not persisted beyond the live
     session; a send starts fresh and the URL follows the new session;
  4. one truth per screen: the /chats empty-state copy ("No chat sessions
     yet") never renders beside a non-empty live band — the live-band variant
     (chats-empty-live) states the persistence boundary instead.

J5/A5 (MAJOR) — "failed" had two definitions:
  5. ONE outcome partition (src/board/metrics.ts outcomeOf): cancelled ≠
     failed on every surface — this rig derives the expected counts from the
     fixture's own corpus (j5_runs: cancelled in/out of the 24h window +
     undatable terminal rows) and asserts them independently;
  6. reconciliation: the bottom bar's all-window failed count EQUALS the
     /work Failed filter's rendered rows (set equality on run ids); the
     landing's 24h failed count is a labeled subset of those rows; cancelled
     rows live under their OWN /work filter, absent from Failed;
  7. EC39 honesty: windowed counts STATE their exclusions — the lede wears
     "excludes N undated runs" and the outcome bar its no-clock note — so no
     number exists that a user cannot rebuild from a visible list.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4402),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    ATTACHED_AT,
    HIDE_GATE_TOASTS,
    J5_RUNS,
    NOW0,
    ORPHAN,
    REPO,
    RUNS,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4402"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
HOUR = 3_600_000

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


# ── The independent derivation (never snapshotted from the page) ──────────────
#
# The served corpus with j5_runs on: RUNS + ORPHAN (default) + J5_RUNS.
ALL = [v["session"] for v in RUNS + [ORPHAN] + J5_RUNS]
TERMINAL = {"completed", "failed", "cancelled"}

# Window "all": status === 'failed' ALONE (the ONE partition) — and cancelled.
EXP_FAILED_ALL_IDS = sorted(s["id"] for s in ALL if s["status"] == "failed")
EXP_CANCELLED_ALL_IDS = sorted(s["id"] for s in ALL if s["status"] == "cancelled")
EXP_WORKING = sum(1 for s in ALL if s["status"] not in TERMINAL and s["status"] != "awaiting_human")
EXP_GATES = sum(1 for s in ALL if s["status"] == "awaiting_human")

# Window "24h" (the lede): terminal runs whose LAST observed clock is
# in-window. Clocks reachable here (no metrics_ws drip): the attach clocks and
# the failed-run event tails the board backfills (RUN_EVENTS holds tails only
# for r-auth/r-legacy, both the same side of the window as their attach).
WINDOW_START = NOW0 - 24 * HOUR
EXP_24H = {"finished": 0, "passed": 0, "failed": 0, "cancelled": 0, "undatable": 0}
for s in ALL:
    if s["status"] not in TERMINAL:
        continue
    attach = ATTACHED_AT.get(s["id"])
    if attach is None:
        EXP_24H["undatable"] += 1
        continue
    if attach < WINDOW_START:
        continue
    EXP_24H["finished"] += 1
    key = ("failed" if s["status"] == "failed"
           else "cancelled" if s["status"] == "cancelled" else "passed")
    EXP_24H[key] += 1

# The outcome bar (attach clock alone): in-window vs unplaced.
EXP_BAR_TOTAL = sum(1 for s in ALL if ATTACHED_AT.get(s["id"], 0) >= WINDOW_START)
EXP_BAR_UNPLACED = len(ALL) - EXP_BAR_TOTAL

# Sanity: the corpus really carries the blocker's shape.
assert EXP_24H["cancelled"] == 1 and EXP_24H["failed"] == 1, EXP_24H
assert EXP_24H["undatable"] == 2, EXP_24H
assert len(EXP_FAILED_ALL_IDS) == 3 and len(EXP_CANCELLED_ALL_IDS) == 3

MSG1 = "compare the auth options"
MSG2 = "still with me after the round trip?"
MSG3 = "start a fresh thread here"

# ── 1. Build + the fixture with the J5 corpus ─────────────────────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, j5_runs=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []


def tap(page) -> list:
    net: list = []

    def on_request(req):
        path = urlparse(req.url).path
        if not path.startswith("/api/"):
            return
        body = None
        if req.post_data:
            try:
                body = json.loads(req.post_data)
            except ValueError:
                body = None
        net.append((req.method, path, body))

    page.on("request", on_request)
    return net


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    # ── Scene 1 (J5): the landing — one partition, labeled windows, stated
    #    exclusions ──────────────────────────────────────────────────────────────
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="landing-lede"]').wait_for(timeout=30000)
    page.locator('[data-testid="runs-bottom-bar"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # The failed-tail backfill (r-auth/r-legacy) settles within a tick; the
    # numbers below are attach-clock stable either way.
    page.wait_for_timeout(500)

    facts = page.evaluate(
        """() => {
             const q = (sel) => document.querySelector(sel);
             const lede = q('[data-testid="landing-lede"]');
             const bar = q('[data-testid="runs-bottom-bar"]');
             const outcome = q('[data-testid="run-outcome-bar"]');
             const segs = [...document.querySelectorAll('[data-testid="lede-segment"]')]
               .map((a) => ({ text: a.textContent, href: a.getAttribute('href') }));
             return {
               lede: lede?.textContent ?? null,
               segs,
               undatable: q('[data-testid="lede-undatable"]')?.textContent ?? null,
               ledeWindow: q('[data-testid="lede-window"]')?.textContent ?? null,
               barWorking: bar?.dataset.working ?? null,
               barGates: bar?.dataset.gates ?? null,
               barFailed: bar?.dataset.failed ?? null,
               outcomeTotal: outcome?.dataset.total ?? null,
               outcomeUnplaced: outcome?.dataset.unplaced ?? null,
               outcomeText: outcome?.textContent ?? null,
               unplacedNote: q('[data-testid="outcome-unplaced-note"]')?.textContent ?? null,
             };
           }""")

    # 5 — cancelled ≠ failed in the lede, and both numbers link to THEIR filter.
    exp_lede = (f"While you were away: {EXP_24H['finished']} runs finished — "
                f"{EXP_24H['failed']} failed, {EXP_24H['cancelled']} cancelled — and "
                f"{EXP_GATES} gates are waiting on you.")
    check("lede_partitions_cancelled",
          facts["lede"] == exp_lede and facts["ledeWindow"] == "24h",
          expected=exp_lede, lede=facts["lede"], window=facts["ledeWindow"])
    seg_by_text = {s["text"]: s["href"] for s in facts["segs"]}
    check("lede_numbers_link_their_filters",
          seg_by_text.get(f"{EXP_24H['failed']} failed") == "/work?filter=failed"
          and seg_by_text.get(f"{EXP_24H['cancelled']} cancelled") == "/work?filter=cancelled",
          segs=facts["segs"])

    # 7 — the stated exclusions (EC39): the lede names its undatable rows, the
    # outcome bar its no-clock rows.
    check("windowed_counts_state_exclusions",
          facts["undatable"] == f"· excludes {EXP_24H['undatable']} undated runs"
          and facts["unplacedNote"] == f"excludes {EXP_BAR_UNPLACED} runs with no clock in this window",
          undatable=facts["undatable"], unplaced_note=facts["unplacedNote"])

    # The outcome bar's fold on the honest attach clock, cancelled as its own
    # named bucket in the visible value.
    check("outcome_bar_partition",
          facts["outcomeTotal"] == str(EXP_BAR_TOTAL)
          and facts["outcomeUnplaced"] == str(EXP_BAR_UNPLACED)
          and f"{EXP_24H['failed']} failed" in (facts["outcomeText"] or "")
          and f"{EXP_24H['cancelled']} cancelled" in (facts["outcomeText"] or ""),
          expected={"total": EXP_BAR_TOTAL, "unplaced": EXP_BAR_UNPLACED},
          **{k: facts[k] for k in ("outcomeTotal", "outcomeUnplaced", "outcomeText")})

    # The bottom bar's all-window counts (the other labeled truth).
    check("bottom_bar_all_window",
          facts["barWorking"] == str(EXP_WORKING)
          and facts["barGates"] == str(EXP_GATES)
          and facts["barFailed"] == str(len(EXP_FAILED_ALL_IDS)),
          expected={"working": EXP_WORKING, "gates": EXP_GATES,
                    "failed": len(EXP_FAILED_ALL_IDS)},
          **{k: facts[k] for k in ("barWorking", "barGates", "barFailed")})

    page.screenshot(path=str(VSHOTS / "ux-fixJ4J5-landing.png"))

    # ── Scene 2 (J5): /work — the failed count is REPRODUCIBLE from rows ──────
    def work_rows(filter_id: str) -> dict:
        page.goto(f"{ORIGIN}/work?filter={filter_id}", wait_until="domcontentloaded")
        page.locator('[role="tablist"][data-filter="' + filter_id + '"]').wait_for(timeout=30000)
        return page.evaluate(
            """() => ({
                 filter: document.querySelector('[role="tablist"]')?.dataset.filter ?? null,
                 rows: [...document.querySelectorAll('[role="tabpanel"] [data-testid="run-link"]')]
                   .map((r) => r.dataset.runId).sort(),
               })""")

    failed_view = work_rows("failed")
    # 6 — set equality: the bar's all-window "N failed" IS these rows; the
    # lede's 24h failed run (r-auth) is among them; no cancelled id intrudes.
    check("work_failed_rows_reconcile",
          failed_view["rows"] == EXP_FAILED_ALL_IDS
          and str(len(failed_view["rows"])) == facts["barFailed"]
          and "r-auth" in failed_view["rows"]
          and not any(r in failed_view["rows"] for r in EXP_CANCELLED_ALL_IDS),
          expected=EXP_FAILED_ALL_IDS, **failed_view)
    page.screenshot(path=str(VSHOTS / "ux-fixJ4J5-work-failed.png"))

    cancelled_view = work_rows("cancelled")
    check("work_cancelled_own_filter",
          cancelled_view["rows"] == EXP_CANCELLED_ALL_IDS,
          expected=EXP_CANCELLED_ALL_IDS, **cancelled_view)
    page.close()

    # ── Scene 3 (J4): the chat session gets a real URL and stays findable ─────
    page2 = ctx.new_page()
    page2.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net2 = tap(page2)
    page2.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page2.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    # EC44 (round 3): the chips RESOLVE before the send — Send is disabled
    # while the roster is unknown, so wait for the resolved chips first.
    page2.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)

    page2.locator("textarea").fill(MSG1)
    page2.keyboard.press("Enter")
    # 1 — the URL names the session the moment it exists.
    page2.wait_for_function(
        """() => location.pathname.startsWith('/chat/') && location.pathname !== '/chat/new'""",
        timeout=30000)
    opens = [(m, q, b) for (m, q, b) in net2 if m == "POST" and q == "/api/v1/chats"]
    chat_id = (opens[0][2] or {}).get("chatId") if opens else None
    url_id = page2.evaluate("() => decodeURIComponent(location.pathname.split('/')[2])")
    check("open_chat_gets_real_url",
          len(opens) == 1 and chat_id is not None and url_id == chat_id,
          opens=len(opens), chat_id=chat_id, url_id=url_id,
          pathname=page2.evaluate("() => location.pathname"))

    # 4 — /chats: the live band lists the session, its row is a DOOR, and the
    # empty-state copy tells ONE truth (no "No chat sessions yet" beside it).
    page2.goto(f"{ORIGIN}/chats", wait_until="domcontentloaded")
    page2.locator('[data-testid="live-chat-row"]').wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)
    chats_screen = page2.evaluate(
        """() => ({
             rowChatId: document.querySelector('[data-testid="live-chat-row"]')?.dataset.chatId ?? null,
             staleEmpty: document.body.innerText.includes('No chat sessions yet'),
             liveEmpty: document.querySelector('[data-testid="chats-empty-live"]')?.textContent ?? null,
           })""")
    check("chats_one_truth_per_screen",
          chats_screen["rowChatId"] == chat_id
          and not chats_screen["staleEmpty"]
          and "aren’t stored beyond the live session" in (chats_screen["liveEmpty"] or ""),
          **chats_screen)
    page2.screenshot(path=str(VSHOTS / "ux-fixJ4J5-chats.png"))

    # 2 — click through: the row opens /chat/:id, the surface rejoins the warm
    # session and states the honest history boundary; a send still works.
    page2.locator('[data-testid="live-chat-row"]').click()
    page2.wait_for_function(
        f"""() => location.pathname === '/chat/{chat_id}'""", timeout=30000)
    page2.locator('[data-testid="chat-rejoined-note"]').wait_for(timeout=30000)
    rejoined = page2.evaluate(
        """() => ({
             note: document.querySelector('[data-testid="chat-rejoined-note"]')?.textContent ?? null,
             ready: [...document.querySelectorAll('[data-testid="seat-chip"][data-state="ready"]')].length,
             firstrun: !!document.querySelector('[data-testid="chat-firstrun"]'),
           })""")
    check("row_click_rejoins_with_honest_boundary",
          "can’t be replayed" in (rejoined["note"] or "")
          and rejoined["ready"] > 0 and not rejoined["firstrun"],
          **rejoined)

    page2.locator("textarea").fill(MSG2)
    page2.keyboard.press("Enter")
    page2.wait_for_function(
        f"""() => [...document.querySelectorAll('[data-testid="user-bubble"]')]
                  .some((u) => u.textContent === {json.dumps(MSG2)})""",
        timeout=30000)
    sends = [(m, q) for (m, q, _b) in net2
             if m == "POST" and q == f"/api/v1/chats/{chat_id}/messages"]
    reopens = [(m, q) for (m, q, _b) in net2 if m == "POST" and q == "/api/v1/chats"]
    # The tap spans this page's whole life: MSG1's fan-out plus MSG2's — both
    # into the SAME session — and exactly the ONE open from scene 3's mint.
    # A re-mint on rejoin (the FINDING-027 regression) would show opens == 2.
    check("rejoined_send_reattaches_not_remints",
          len(sends) == 2 and len(reopens) == 1,
          sends=len(sends), opens_total=len(reopens))
    page2.screenshot(path=str(VSHOTS / "ux-fixJ4J5-rejoined.png"))

    # ── Scene 4 (J4): a dead routed id says so — honestly ─────────────────────
    page2.goto(f"{ORIGIN}/chat/ghost-session-1", wait_until="domcontentloaded")
    page2.locator('[data-testid="chat-session-ended"]').wait_for(timeout=30000)
    ended = page2.evaluate(
        """() => ({
             text: document.querySelector('[data-testid="chat-session-ended"]')?.textContent ?? null,
             firstrun: !!document.querySelector('[data-testid="chat-firstrun"]'),
           })""")
    check("dead_routed_id_states_the_boundary",
          "aren’t stored beyond the live session" in (ended["text"] or "")
          and not ended["firstrun"],
          **ended)
    page2.screenshot(path=str(VSHOTS / "ux-fixJ4J5-ended.png"))

    # 3 — a send from the ended boundary starts a NEW session; the URL follows.
    page2.locator("textarea").fill(MSG3)
    page2.keyboard.press("Enter")
    page2.wait_for_function(
        """() => location.pathname.startsWith('/chat/')
              && location.pathname !== '/chat/ghost-session-1'""",
        timeout=30000)
    new_id = page2.evaluate("() => decodeURIComponent(location.pathname.split('/')[2])")
    check("ended_send_starts_fresh_and_url_follows",
          new_id not in ("", "new", "ghost-session-1") and new_id != chat_id,
          new_id=new_id, old_id=chat_id)

    page2.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [str(VSHOTS / n) for n in (
    "ux-fixJ4J5-landing.png", "ux-fixJ4J5-work-failed.png",
    "ux-fixJ4J5-chats.png", "ux-fixJ4J5-rejoined.png", "ux-fixJ4J5-ended.png")]
report["ok"] = True
print(json.dumps(report, indent=2))
