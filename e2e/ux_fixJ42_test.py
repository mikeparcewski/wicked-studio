#!/usr/bin/env python3
"""
ux_fixJ42_test.py — the BRIEF-UX-001 ROUND-2 fix gate (J4 findings 1–4).

Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py), whose
POST /chats now enforces the REAL daemon's roster contract unconditionally:
any cli not in ROSTER answers the core's own per-seat rejection
("no ACP config for '<key>'" — wicked-core acp_runner.rs). The class this
round-2 review caught — the fallback trio riding the wire and every cold
profile's first send failing — can never pass this rig by fixture leniency.

ROUND-3 RE-SCOPE (BRIEF-UX-001 C6/EC44 — chips are truth): the fallback-
trio-as-placeholder arm this rig used to pin is GONE (that placeholder was
the round-3 defect: chips painted that the send did not connect). The scenes
below now pin the same J4 outcomes through the EC44 contract: cold mount
resolves the roster with its ONE named request, the chips are the CHAT-
CAPABLE seats, and every send connects exactly the displayed chips. The
dedicated EC44 gate (paint witness, capability labels) is ux_fixJ43_test.py.

Scenes (each on a FRESH browser context — zero storage, the cold profile):

  1. COLD PROFILE (finding 1 + 3): /chat/new mounts with NO chat request but
     the ONE named GET /roster (EC44); the chips resolve roster-true
     (data-source="roster", the chat-capable seats); the FIRST SEND opens
     with EXACTLY the displayed chips — the strict fixture accepts them,
     the send succeeds, a reply lands — the URL flips to /chat/:id
     (J4: the session is findable), the rail lists the live session and
     never says "no chats", and /chats' Active-now headline counts the
     live row (finding 4a: no "0 of 0" beside a live session).
  2. ROSTER UNREACHABLE (finding 1, re-dressed by EC44): with GET /roster
     answering 500, the MOUNT resolve fails — the bar says so with a
     working Retry, NO chip is painted, Send stays disabled, and nothing
     ships (zero POST /chats); after the roster recovers, Retry resolves
     the chips and the send connects the capable seats, exactly one user
     bubble (no duplicate).
  3. OPEN-FAILURE RECOVERY (finding 2 + 3): every (capable) seat rejected at open →
     the failure renders as a retryable row beside the banner, the draft
     survives; remove one chip, un-reject, Retry → the send succeeds into
     the SAME chat id, the stale banner clears, and the removed seat's
     red chip is pruned (no stale failed chips beside a live conversation).
  4. PICKER VOCABULARY (finding 4b): the [+ Add] menu carries each seat's
     display name and OBSERVED health (data-health; absent on the wire →
     "unknown", never a fabricated "active").

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-J42-cold-first-send.png   the cold profile's first send answered, URL
                               flipped, live session on the rail
  ux-J42-roster-down.png       the inline roster-unreachable failure with
                               the draft intact and Retry offered

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4404),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    CHAT_CAPABLE_KEYS,
    HIDE_GATE_TOASTS,
    REPO,
    ROSTER,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4404"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

ROSTER_KEYS = [s["key"] for s in ROSTER]
CAPABLE = CHAT_CAPABLE_KEYS  # the EC44 default chip set — what a cold send connects

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


# ── 1. Build + the shared fixture (strict roster contract is ALWAYS on) ───────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
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
    return path.startswith("/api/v1/chats") or path == "/api/v1/roster"


CENSUS = """() => {
  const bar = document.querySelector('[data-testid="agent-chips-bar"]');
  const chips = [...document.querySelectorAll('[data-testid="seat-chip"]')];
  return {
    pathname: location.pathname,
    chipsBar: bar ? { count: bar.dataset.count, source: bar.dataset.source } : null,
    seatChips: Object.fromEntries(chips.map((c) => [c.dataset.agent, c.dataset.state])),
    composer: document.querySelector('textarea')?.value ?? null,
    sendDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent === 'Send')?.disabled ?? null,
    openError: document.body.innerText.includes('Could not open chat'),
    sendFailed: document.querySelector('[data-testid="chat-send-failed"]')?.textContent ?? null,
    userBubbles: [...document.querySelectorAll('[data-testid="user-bubble"]')].map((u) => u.textContent),
    replies: [...document.querySelectorAll('[data-testid="seat-bubble"][data-pending="false"]')].length,
    railLiveChats: [...document.querySelectorAll('[data-testid="rail-live-chat"]')]
      .map((r) => r.dataset.chatId),
    railEmptyLabel: document.body.innerText.includes('No recorded chats yet'),
  };
}"""

MSG_COLD = "cold profile: compare the auth options"
MSG_DOWN = "roster is down: still want to chat"
MSG_REJ = "every seat rejected: recover me"

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── Scene 1: the COLD PROFILE first send succeeds (findings 1 + 3 + 4a) ───
    set_fixture(ORIGIN, chat_replies=True)
    ctx1 = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx1.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net = tap(page)
    page.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page.locator('[data-testid="agent-chips-bar"]').wait_for(timeout=30000)
    page.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    storage = page.evaluate("() => sessionStorage.length + localStorage.length")
    mount = page.evaluate(CENSUS)
    mount_chat = [(m, q) for (m, q, _b) in net if is_chat_surface(q)]
    # EC44: the ONE named mount request (GET /roster) resolves the chips
    # roster-true; nothing chat-shaped fires and nothing warms.
    check("cold_mount_resolves_roster_true_chips",
          storage == 0
          and mount["chipsBar"] is not None
          and mount["chipsBar"]["source"] == "roster"
          and mount["chipsBar"]["count"] == str(len(CAPABLE))
          and mount_chat == [("GET", "/api/v1/roster")],
          storage_entries=storage, chips_bar=mount["chipsBar"], mount_chat_requests=mount_chat)

    page.locator("textarea").fill(MSG_COLD)
    page.keyboard.press("Enter")
    # The daemon ACCEPTS (strict contract): composer clears, replies land.
    page.wait_for_function(
        """() => document.querySelector('textarea')?.value === ''
             && document.querySelectorAll('[data-testid="seat-bubble"][data-pending="false"]').length > 0""",
        timeout=30000)
    sent = page.evaluate(CENSUS)
    roster_gets = [(m, q) for (m, q, _b) in net if q == "/api/v1/roster"]
    opens = [(m, q, b) for (m, q, b) in net if m == "POST" and q == "/api/v1/chats"]
    chat_id = (opens[0][2] or {}).get("chatId") if opens else None
    check("cold_first_send_roster_first_and_accepted",
          len(roster_gets) == 1
          and len(opens) == 1
          and (opens[0][2] or {}).get("clis") == CAPABLE
          and not sent["openError"]
          and sent["sendFailed"] is None
          and sent["userBubbles"] == [MSG_COLD]
          and sent["replies"] > 0,
          roster_gets=len(roster_gets), open_body=opens[0][2] if opens else None,
          census=sent)

    # Finding 3: the URL flipped to the session's real address…
    check("cold_url_flips_to_session",
          chat_id is not None and sent["pathname"] == f"/chat/{chat_id}",
          pathname=sent["pathname"], chat_id=chat_id)
    # …and the rail lists the live session — never "no chats" beside it.
    check("rail_lists_live_session",
          chat_id in sent["railLiveChats"] and not sent["railEmptyLabel"],
          rail_live=sent["railLiveChats"], empty_label=sent["railEmptyLabel"])

    page.screenshot(path=str(VSHOTS / "ux-J42-cold-first-send.png"))

    # Finding 4a: /chats' Active-now headline counts the live row it shows.
    page.goto(f"{ORIGIN}/chats", wait_until="domcontentloaded")
    page.locator('[data-testid="chats-dashboard-tiles"]').wait_for(timeout=30000)
    page.locator('[data-testid="live-chat-row"]').wait_for(timeout=30000)
    tile = page.evaluate(
        """() => {
          const t = document.querySelector('[data-testid="chats-active-tile"]');
          return { count: t?.dataset.count, live: t?.dataset.live, text: t?.textContent ?? '' };
        }""")
    check("active_now_counts_the_live_row",
          tile["live"] == "1" and int(tile["count"] or 0) >= 1
          and "live session" in tile["text"] and " in 30d" in tile["text"],
          **tile)
    ctx1.close()

    # ── Scene 2: roster unreachable — NOTHING ships; Retry recovers (finding 1) ─
    set_fixture(ORIGIN, chat_replies=False, roster_fail=True)
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page2 = ctx2.new_page()
    page2.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net2 = tap(page2)
    page2.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page2.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)

    # EC44: the failed MOUNT resolve renders as the bar's unresolved row —
    # no chip is painted, Send stays disabled, and Enter ships NOTHING.
    page2.locator('[data-testid="agent-chips-unresolved"]').wait_for(timeout=30000)
    page2.locator("textarea").fill(MSG_DOWN)
    page2.keyboard.press("Enter")
    down = page2.evaluate(CENSUS)
    down_opens = [(m, q) for (m, q, _b) in net2 if m == "POST" and q == "/api/v1/chats"]
    down_sends = [(m, q) for (m, q, _b) in net2 if m == "POST" and "/messages" in q]
    down_chips = page2.evaluate(
        """() => [...document.querySelectorAll('[data-testid=\"agent-chip\"]')].length""")
    check("roster_down_nothing_ships_draft_survives",
          len(down_opens) == 0 and len(down_sends) == 0
          and down_chips == 0
          and down["composer"] == MSG_DOWN
          and down["userBubbles"] == []
          and down["sendDisabled"] is True
          and down["pathname"] == "/chat/new",
          opens=down_opens, sends=down_sends, chips=down_chips, census=down)

    page2.screenshot(path=str(VSHOTS / "ux-J42-roster-down.png"))

    # The roster recovers → the bar's Retry resolves the chips, and the send
    # connects EXACTLY the displayed (capable) seats, exactly once.
    set_fixture(ORIGIN, roster_fail=False)
    page2.locator('[data-testid="agent-chips-retry"]').click()
    page2.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page2.locator("textarea").click()
    page2.keyboard.press("Enter")
    page2.wait_for_function(
        f"""() => [...document.querySelectorAll('[data-testid="user-bubble"]')]
                  .filter((u) => u.textContent === {json.dumps(MSG_DOWN)}).length === 1
               && !document.querySelector('[data-testid="chat-send-failed"]')
               && document.querySelector('textarea')?.value === ''""",
        timeout=30000)
    retry_opens = [(m, q, b) for (m, q, b) in net2 if m == "POST" and q == "/api/v1/chats"]
    check("roster_recovers_retry_sends_capable_once",
          len(retry_opens) == 1 and (retry_opens[0][2] or {}).get("clis") == CAPABLE,
          open_body=retry_opens[0][2] if retry_opens else None)
    ctx2.close()

    # ── Scene 3: all seats rejected → recover; stale banner + chips clear ─────
    set_fixture(ORIGIN, chat_reject_seats=ROSTER_KEYS)
    ctx3 = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page3 = ctx3.new_page()
    page3.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net3 = tap(page3)
    page3.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page3.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page3.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page3.add_style_tag(content=HIDE_GATE_TOASTS)

    page3.locator("textarea").fill(MSG_REJ)
    page3.keyboard.press("Enter")
    page3.locator('[data-testid="chat-send-failed"]').wait_for(timeout=30000)
    rej = page3.evaluate(CENSUS)
    rej_sends = [(m, q) for (m, q, _b) in net3 if m == "POST" and "/messages" in q]
    check("all_rejected_is_retryable_with_guidance",
          rej["openError"]  # the banner names the rejected chips (§6.2 guidance)
          and rej["sendFailed"] is not None
          and rej["composer"] == MSG_REJ
          and rej["userBubbles"] == []
          and len(rej_sends) == 0
          and all(st == "failed" for st in rej["seatChips"].values())
          and set(rej["seatChips"]) == set(CAPABLE),
          census=rej, sends=rej_sends)

    # Remove one chip; the retried open must not name it — and its stale red
    # seat chip must be PRUNED once the send succeeds (finding 3).
    removed = CAPABLE[-1]
    page3.locator(f'[data-testid="agent-chip"][data-agent="{removed}"] button').click()
    set_fixture(ORIGIN, chat_reject_seats=[])
    page3.locator('[data-testid="chat-send-retry"]').click()
    # Wait for the ACCEPTED send (composer clears only then, §7.9-2), the
    # single user bubble, and the pruned stale chip — not just the optimistic
    # start of the retry (which also renders a bubble while the arm is still
    # in flight).
    page3.wait_for_function(
        f"""() => [...document.querySelectorAll('[data-testid="user-bubble"]')]
                  .filter((u) => u.textContent === {json.dumps(MSG_REJ)}).length === 1
               && !document.querySelector('[data-testid="chat-send-failed"]')
               && document.querySelector('textarea')?.value === ''
               && !document.querySelector('[data-testid="seat-chip"][data-agent="{removed}"]')""",
        timeout=30000)
    recovered = page3.evaluate(CENSUS)
    opens3 = [(m, q, b) for (m, q, b) in net3 if m == "POST" and q == "/api/v1/chats"]
    kept = [k for k in CAPABLE if k != removed]
    check("recovery_same_chat_banner_and_stale_chips_clear",
          len(opens3) == 2
          and (opens3[0][2] or {}).get("chatId") == (opens3[1][2] or {}).get("chatId")
          and (opens3[1][2] or {}).get("clis") == kept
          and not recovered["openError"]
          and recovered["sendFailed"] is None
          and removed not in recovered["seatChips"]  # the stale red chip is gone
          and all(recovered["seatChips"].get(k) == "working" for k in kept),
          open_bodies=[b for (_m, _q, b) in opens3], census=recovered)

    # ── Scene 4: the picker's roster vocabulary (finding 4b) ──────────────────
    # A fresh chat surface (same context, new page — the picker is pre-send UI).
    page4 = ctx3.new_page()
    page4.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    # This tab already stored scene 3's chat id — but the picker renders on the
    # chips bar regardless once the rejoin probe resolves; wait for the bar.
    page4.locator('[data-testid="agent-chips-bar"], [data-testid="seat-chip"]').first.wait_for(timeout=30000)
    if page4.locator('[data-testid="add-agent"]').count() == 0:
        # Rejoined the warm chat (no chips bar) — end it to get the create flow.
        page4.locator('[data-testid="chat-close"]').click()
        page4.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
        page4.locator('[data-testid="add-agent"]').wait_for(timeout=30000)
    page4.locator('[data-testid="add-agent"]').click()
    page4.locator('[data-testid="agent-picker-option"]').first.wait_for(timeout=30000)
    picker = page4.evaluate(
        """() => [...document.querySelectorAll('[data-testid="agent-picker-option"]')]
                 .map((o) => ({ key: o.dataset.agentKey, health: o.dataset.health,
                                title: o.title, text: o.textContent }))""")
    by_key = {o["key"]: o for o in picker}
    check("picker_display_names_and_health",
          [o["key"] for o in picker] == ROSTER_KEYS
          # Fixture wire truth: claude/agy active, codex inactive, pi carries
          # NO health (a pre-crew#274 daemon) and must read unknown — never a
          # fabricated "active".
          and by_key["claude"]["health"] == "active"
          and by_key["codex"]["health"] == "inactive"
          and by_key["pi"]["health"] == "unknown"
          and by_key["codex"]["title"] == "codex — inactive — no chat (ACP) config — can’t join a chat"
          and all((o["text"] or "").strip() != "" for o in picker),
          picker=picker)
    ctx3.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [str(VSHOTS / "ux-J42-cold-first-send.png"),
                         str(VSHOTS / "ux-J42-roster-down.png")]
report["ok"] = True
print(json.dumps(report, indent=2))
