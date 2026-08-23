#!/usr/bin/env python3
"""
ux_sliceAB_test.py — the DES-UX-001 slice-AB gate: chat repair (§7.9, EC44, C6).
Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with the
slice-AB corpus: `chat_deltas` (buffered interleaved chunk rounds + a flush
control — the §7.9-3 splice corpus) and `chat_reject_seats=["codex"]` (the
open-time failed-with-reason seat, §7.9-4).

The §7.9 DOM ACs, verbatim mapping:

  1. roster-true chips (§7.9-1, re-scoped per §11.2 to roster-first with the
     cold-cache fallback): a fresh /chat/new mounts with the FALLBACK trio and
     ZERO chat-surface requests (`data-source="fallback"` — the §2.4 budget
     holds); the FIRST SEND fetches the roster ON THE GESTURE (exactly one
     GET /roster) and opens with the ROSTER's seats — the daemon accepts them,
     no rejected-chip error renders, and ≥1 reply frame lands after flush;
  2. a fixture-failed send (chat_send_fail) leaves the composer text INTACT,
     retracts the optimistic bubbles, and renders inline retry (§7.9-2);
     retry after the failure clears resends exactly the failed text;
  3. chunk routing (§7.9-3): turn 1's interleaved chunks arrive AFTER turn 2
     opened its pending bubbles — every chunk lands in the bubble matching its
     seat+turn (round-1 text never appears in a data-turn="2" bubble);
  4. seat chips wear explicit state badges (§7.9-4/EC44): working while a
     reply is pending, replied when it lands, and failed-with-reason carrying
     the daemon's own open-time error for the rejected seat;
  5. /chats lists the live session (GET /chats riding the navigation — the one
     declared fetch, nothing gesture-gated fires) and flags it "streaming now"
     from its first observed frame; End tears it down in place (§7.9-5);
  6. the zombie pin: with the chat's tab CLOSED, a fresh page's bottom-bar
     working count equals the pre-chat baseline — no orphan increment, and the
     session is findable in /chats rather than haunting a counter;
  7. the conversation→action bridge: Continue in Build lands on /runs/new with
     the transcript prefilled as context and ZERO POST /runs fired.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-AB-chat-states.png   the chat thread after two answered rounds + one
                          failed send: replied chips beside the
                          failed-with-reason chip, the inline retry row, the
                          surviving draft in the composer
  ux-AB-chats-list.png    /chats with the live-session band up — the streaming
                          session flagged, endable, above the dashboard tiles'
                          untouched list

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4398),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import urllib.request
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4398"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# The fixture's roster (uxfix_fixture.ROSTER keys) and the §6.2 fallback trio.
ROSTER_KEYS = ["claude", "codex", "agy", "pi"]
FALLBACK = ["writer", "reviewer", "planner"]
REJECTED = "codex"  # chat_reject_seats — the open-time failed-with-reason seat
WARM = [k for k in ROSTER_KEYS if k != REJECTED]

MSG1 = "compare the auth options"
MSG2 = "now sketch the migration plan"
MSG3 = "and the rollback risks?"

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


def api_get(path: str) -> dict:
    with urllib.request.urlopen(f"{ORIGIN}{path}", timeout=10) as res:
        return json.loads(res.read())


def api_post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{ORIGIN}{path}", method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())


# ── 1. Build + the shared fixture with the slice-AB corpus ────────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, chat_deltas=True, chat_reject_seats=[REJECTED])
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


def is_chat_surface(path: str) -> bool:
    """The §2.4 mount delta: what the chat surface itself could fire."""
    return path.startswith("/api/v1/chats") or path == "/api/v1/roster"


# One evaluate for the whole seat/bubble census, so no frame can split it.
CHAT_CENSUS = """() => {
  const chips = [...document.querySelectorAll('[data-testid="seat-chip"]')];
  const bubbles = [...document.querySelectorAll('[data-testid="seat-bubble"]')];
  const users = [...document.querySelectorAll('[data-testid="user-bubble"]')];
  const bar = document.querySelector('[data-testid="agent-chips-bar"]');
  return {
    chips: Object.fromEntries(chips.map((c) => [c.dataset.agent, c.dataset.state])),
    failedChipText: chips.find((c) => c.dataset.state === 'failed')?.textContent ?? null,
    bubbles: bubbles.map((b) => ({ agent: b.dataset.agent, turn: b.dataset.turn,
                                   pending: b.dataset.pending, text: b.textContent })),
    users: users.map((u) => ({ turn: u.dataset.turn, text: u.textContent })),
    chipsBar: bar ? { count: bar.dataset.count, source: bar.dataset.source } : null,
    composer: document.querySelector('textarea')?.value ?? null,
    openError: document.body.innerText.includes('Could not open chat'),
    sendFailed: !!document.querySelector('[data-testid="chat-send-failed"]'),
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    # ── Scene 1: /chat/new — roster-true first send, states, routing, draft ───
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net = tap(page)
    page.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page.locator('[data-testid="agent-chips-bar"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    baseline_working = page.locator('[data-testid="runs-bottom-bar"]').get_attribute("data-working")

    mount = page.evaluate(CHAT_CENSUS)
    mount_chat_requests = [(m, q) for (m, q, _b) in net if is_chat_surface(q)]
    check("mount_fallback_zero_requests",
          mount["chipsBar"] is not None
          and mount["chipsBar"]["source"] == "fallback"
          and mount["chipsBar"]["count"] == str(len(FALLBACK))
          and len(mount_chat_requests) == 0,
          chips_bar=mount["chipsBar"], mount_chat_requests=mount_chat_requests)

    # AC 1 — the first send is roster-first: ONE /roster GET rides the gesture,
    # the open names the roster's seats, and no rejected-chip error renders.
    page.locator("textarea").fill(MSG1)
    page.keyboard.press("Enter")
    page.wait_for_function(
        f"""() => document.querySelectorAll('[data-testid="seat-bubble"][data-turn="1"]').length === {len(WARM)}
               && document.querySelector('textarea')?.value === ''""",
        timeout=30000)  # the composer clears only when the daemon ACCEPTS (§7.9-2)
    roster_gets = [(m, q) for (m, q, _b) in net if q == "/api/v1/roster"]
    opens = [(m, q, b) for (m, q, b) in net if m == "POST" and q == "/api/v1/chats"]
    sent1 = page.evaluate(CHAT_CENSUS)
    chat_id = (opens[0][2] or {}).get("chatId") if opens else None
    check("roster_first_send",
          len(roster_gets) == 1
          and len(opens) == 1
          and (opens[0][2] or {}).get("clis") == ROSTER_KEYS
          and not sent1["openError"]
          and sent1["chips"].get(REJECTED) == "failed"
          and all(sent1["chips"].get(k) == "working" for k in WARM)
          and f"unknown agent '{REJECTED}'" in (sent1["failedChipText"] or "")
          and sent1["composer"] == ""  # the ACCEPTED draft left the composer
          and chat_id is not None,
          roster_gets=len(roster_gets), open_body=opens[0][2] if opens else None,
          chips=sent1["chips"], failed_chip=sent1["failedChipText"])

    # AC 3 setup — turn 2 opens BEFORE turn 1's chunks arrive (chat_deltas
    # buffers them until the flush): the splice scenario, live.
    page.locator("textarea").fill(MSG2)
    page.keyboard.press("Enter")
    page.wait_for_function(
        f"""() => document.querySelectorAll('[data-testid="seat-bubble"][data-turn="2"]').length === {len(WARM)}""",
        timeout=30000)
    set_fixture(ORIGIN, chat_flush=True)
    page.wait_for_function(
        """() => [...document.querySelectorAll('[data-testid="seat-bubble"]')]
                 .every((b) => b.dataset.pending === 'false')""",
        timeout=30000)
    routed = page.evaluate(CHAT_CENSUS)
    by_key = {(b["agent"], b["turn"]): b for b in routed["bubbles"]}
    splice_free = (
        all(by_key[(k, "1")]["text"].endswith("(round 1)") for k in WARM)
        and all(by_key[(k, "2")]["text"].endswith("(round 2)") for k in WARM)
        and not any("(round 1)" in b["text"] for b in routed["bubbles"] if b["turn"] == "2")
        and not any("(round 2)" in b["text"] for b in routed["bubbles"] if b["turn"] == "1")
    )
    check("chunk_routing_seat_turn",
          splice_free
          and len(routed["bubbles"]) == 2 * len(WARM)
          and all(routed["chips"].get(k) == "replied" for k in WARM)
          and routed["chips"].get(REJECTED) == "failed",
          bubbles=routed["bubbles"], chips=routed["chips"])

    # AC 2 — a refused fan-out keeps the draft and renders inline retry.
    set_fixture(ORIGIN, chat_send_fail=True)
    page.locator("textarea").fill(MSG3)
    page.keyboard.press("Enter")
    page.locator('[data-testid="chat-send-failed"]').wait_for(timeout=30000)
    failed = page.evaluate(CHAT_CENSUS)
    check("failed_send_keeps_draft",
          failed["composer"] == MSG3
          and failed["sendFailed"]
          and all(u["text"] != MSG3 for u in failed["users"])  # no phantom turn
          and len([b for b in failed["bubbles"] if b["turn"] == "3"]) == 0
          # EC44: no seat claims to be WORKING on a message that never went out
          # (the revert lands on warm-idle "ready"; a frame would re-correct).
          and all(failed["chips"].get(k) in ("ready", "replied") for k in WARM),
          composer=failed["composer"], users=failed["users"], chips=failed["chips"])

    page.screenshot(path=str(VSHOTS / "ux-AB-chat-states.png"))

    # Retry after the failure clears: exactly the failed text goes out.
    set_fixture(ORIGIN, chat_send_fail=False)
    page.locator('[data-testid="chat-send-retry"]').click()
    page.wait_for_function(
        f"""() => [...document.querySelectorAll('[data-testid="user-bubble"]')]
                  .some((u) => u.textContent === {json.dumps(MSG3)})
               && !document.querySelector('[data-testid="chat-send-failed"]')
               && document.querySelector('textarea')?.value === ''""",
        timeout=30000)  # acceptance clears the composer (§7.9-2)
    retried = page.evaluate(CHAT_CENSUS)
    check("retry_resends_draft",
          retried["composer"] == "" and not retried["sendFailed"],
          composer=retried["composer"])

    # AC 7 — the conversation→action bridge: prefill, never a launch.
    page.locator('[data-testid="chat-promote"]').click()
    page.locator('[data-testid="launch-problem"]').wait_for(timeout=30000)
    prefill_value = page.locator('[data-testid="launch-problem"]').input_value()
    run_posts = [(m, q) for (m, q, _b) in net if m == "POST" and q == "/api/v1/runs"]
    check("promote_prefills_composer",
          page.evaluate("() => location.pathname") == "/runs/new"
          and "Continue from this chat" in prefill_value
          and f"operator: {MSG1}" in prefill_value
          and len(run_posts) == 0,
          pathname=page.evaluate("() => location.pathname"),
          prefill_head=prefill_value[:120], run_posts=len(run_posts))

    # The chat's tab closes — the session must stay findable, not haunt counters.
    page.close()

    # ── Scene 2: /chats on a fresh page — listing, streaming flag, End, zombie ─
    page2 = ctx.new_page()
    page2.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net2 = tap(page2)
    page2.goto(f"{ORIGIN}/chats", wait_until="domcontentloaded")
    page2.locator('[data-testid="chats-dashboard-tiles"]').wait_for(timeout=30000)
    page2.locator('[data-testid="live-chat-row"]').wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)

    # The budget is THIS PAGE's delta (the slice-P convention): the app shell
    # fires its own startup reads (repos, doc registries) identically on main —
    # reported, never asserted. ChatsPage may add exactly ONE GET /chats and
    # must not touch the gesture-gated roster/health.
    lists = [(m, q) for (m, q, _b) in net2 if m == "GET" and q == "/api/v1/chats"]
    gesture_gated = [(m, q) for (m, q, _b) in net2
                     if q in ("/api/v1/roster", "/api/v1/health")]
    shell_owned = sorted({q for (_m, q, _b) in net2
                          if q == "/api/v1/repos" or q.endswith("/interactive/api/docs")})
    listed = page2.evaluate(
        """() => {
          const row = document.querySelector('[data-testid="live-chat-row"]');
          const bar = document.querySelector('[data-testid="runs-bottom-bar"]');
          return { chatId: row?.dataset.chatId ?? null,
                   streaming: row?.dataset.streaming ?? null,
                   text: row?.textContent ?? null,
                   endPresent: !!row?.querySelector('[data-testid="live-chat-end"]'),
                   working: bar?.dataset.working ?? null };
        }""")
    check("chats_lists_live_session",
          listed["chatId"] == chat_id
          and listed["streaming"] == "false"
          and listed["endPresent"]
          and all(k in (listed["text"] or "") for k in WARM)
          and len(lists) == 1 and len(gesture_gated) == 0,
          **listed, list_gets=len(lists), gesture_gated=gesture_gated,
          shell_owned_requests_ignored=shell_owned)

    # AC 6 — the zombie pin: the closed tab left NO orphan working increment.
    check("no_orphan_working_count",
          listed["working"] == baseline_working,
          baseline=baseline_working, fresh_page=listed["working"])

    # AC 5 — streaming-now from the first observed frame: a send lands on the
    # warm session from OUTSIDE this tab, the flush broadcasts its frames.
    api_post(f"/api/v1/chats/{chat_id}/messages", {"text": "still with me?"})
    set_fixture(ORIGIN, chat_flush=True)
    page2.locator('[data-testid="live-chat-row"][data-streaming="true"]').wait_for(timeout=30000)
    check("streaming_now_flag",
          page2.locator('[data-testid="live-chat-streaming"]').text_content() == "streaming now")

    page2.screenshot(path=str(VSHOTS / "ux-AB-chats-list.png"))

    # AC 5 — End tears the session down in place; the daemon's pool empties.
    page2.locator('[data-testid="live-chat-end"]').click()
    page2.wait_for_function(
        """() => !document.querySelector('[data-testid="live-chat-row"]')""",
        timeout=30000)
    deletes = [(m, q) for (m, q, _b) in net2 if m == "DELETE" and q.startswith("/api/v1/chats/")]
    pool = api_get("/api/v1/chats")
    check("end_cleans_up",
          len(deletes) == 1 and pool.get("chats") == [],
          deletes=deletes, pool=pool)

    page2.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [str(VSHOTS / "ux-AB-chat-states.png"),
                         str(VSHOTS / "ux-AB-chats-list.png")]
report["ok"] = True
print(json.dumps(report, indent=2))
