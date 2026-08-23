#!/usr/bin/env python3
"""
ux_fixJ43_test.py — the BRIEF-UX-001 ROUND-3 fix gate (C6/EC44: chips are truth).

The round-3 cold review (real daemon, fresh profile) caught the new-chat
composer painting the writer/reviewer/planner FALLBACK TRIO as if they were
seats on cold render, '+ Add' silently swapping them for the CLI roster, and
the SEND connecting the whole roster regardless of the 3 chips displayed —
plus 4 of 6 roster seats carrying no ACP config, so every cold chat opened
with 4 red "no ACP config" seats. The EC44 contract this rig gates:

  what the chips SHOW at send time == what the send CONNECTS.

Runs against the shared fixture (uxfix_fixture.py), whose roster now mirrors
the REAL daemon's capability wire (round-4 corrected): `acp` is an object on
chat-capable seats and ABSENT on the rest — the engine's skip_serializing_if
never writes a null, so beside a roster that speaks the field, absence IS
"no config" (only a roster with no acp key anywhere reads all-capable — a
daemon predating the field). The fixture keeps one explicit-null belt seat
(agy), and POST /chats rejects BOTH incapable spellings per-seat with the
core's own "no ACP config for '<key>'" (wicked-core acp_runner chat_ensure)
— a UI that silently fans out to incapable seats cannot pass by leniency.

Scenes (each on a FRESH browser context — zero storage, the cold profile):

  1. COLD TRUTH: /chat/new mounts with NO painted chip — a MutationObserver
     (installed pre-navigation) proves the resolving row rendered and that
     writer/reviewer/planner (and the incapable codex/agy) were NEVER painted
     as chips; the surface makes its ONE named mount request (GET /roster);
     the chips resolve to the CHAT-CAPABLE seats (claude + pi, the two
     acp-object seats, as on the live wire); [+ Add] labels the incapable
     seats ("no chat config",
     data-chat-capable="false"); the SEND's POST /chats body names EXACTLY
     the displayed chips (request-tapped), the send succeeds, replies land,
     and NO seat chip is red — the no-4-red-seats-by-default acceptance.
  2. WARM CHIPS: a fresh context resolves once on /chat/new (1 GET /roster),
     navigates away and back — the cached roster renders the chips
     IMMEDIATELY (no resolving flash, no second fetch).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-J43-cold-truth.png   the cold first send answered — roster-true chips
                          became exactly-these warm seats, none red
  ux-J43-warm-chips.png   the warm return: chips immediate from cache

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4405),
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

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4405"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

ROSTER_KEYS = [s["key"] for s in ROSTER]
INCAPABLE = [k for k in ROSTER_KEYS if k not in CHAT_CAPABLE_KEYS]
GHOSTS = ["writer", "reviewer", "planner"]  # the trio that must NEVER paint

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


# ── 1. Build + the shared fixture ─────────────────────────────────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN,
                                     "capable": CHAT_CAPABLE_KEYS, "incapable": INCAPABLE}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

# The paint witness: mutation RECORDS (not a post-hoc DOM scan), so a chip or
# resolving row that rendered and was replaced before any query still counts.
PAINT_OBSERVER = """
(() => {
  window.__paint = { agents: [], resolving: false, sources: [] };
  const note = (el) => {
    if (!el || el.nodeType !== 1) return;
    const all = [el, ...(el.querySelectorAll ? el.querySelectorAll('[data-testid]') : [])];
    for (const n of all) {
      const t = n.dataset ? n.dataset.testid : null;
      if (t === 'agent-chip' && n.dataset.agent && !window.__paint.agents.includes(n.dataset.agent)) {
        window.__paint.agents.push(n.dataset.agent);
      }
      if (t === 'agent-chips-resolving') window.__paint.resolving = true;
      if (t === 'agent-chips-bar' && n.dataset.source
          && !window.__paint.sources.includes(n.dataset.source)) {
        window.__paint.sources.push(n.dataset.source);
      }
    }
  };
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) note(n);
      if (m.type === 'attributes') note(m.target);
    }
  });
  // (init scripts run before <html> exists — observe the document node itself)
  obs.observe(document, { childList: true, subtree: true,
                          attributes: true, attributeFilter: ['data-source', 'data-agent'] });
})();
"""

CENSUS = """() => {
  const bar = document.querySelector('[data-testid="agent-chips-bar"]');
  return {
    pathname: location.pathname,
    chipsBar: bar ? { count: bar.dataset.count, source: bar.dataset.source } : null,
    chips: [...document.querySelectorAll('[data-testid="agent-chip"]')].map((c) => c.dataset.agent),
    seatChips: Object.fromEntries(
      [...document.querySelectorAll('[data-testid="seat-chip"]')]
        .map((c) => [c.dataset.agent, c.dataset.state])),
    seatReasons: Object.fromEntries(
      [...document.querySelectorAll('[data-testid="seat-chip"]')]
        .map((c) => [c.dataset.agent, c.title ?? ''])),
    composer: document.querySelector('textarea')?.value ?? null,
    sendFailed: document.querySelector('[data-testid="chat-send-failed"]')?.textContent ?? null,
    openError: document.body.innerText.includes('Could not open chat'),
    userBubbles: [...document.querySelectorAll('[data-testid="user-bubble"]')].map((u) => u.textContent),
    replies: [...document.querySelectorAll('[data-testid="seat-bubble"][data-pending="false"]')].length,
    painted: window.__paint ?? null,
  };
}"""


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


MSG_COLD = "cold truth: what do these chips connect"

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── Scene 1: COLD TRUTH — resolving → roster-true chips → exact-audience send ──
    set_fixture(ORIGIN, chat_replies=True)
    ctx1 = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    ctx1.add_init_script(PAINT_OBSERVER)
    page = ctx1.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net = tap(page)
    page.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    storage = page.evaluate("() => sessionStorage.length + localStorage.length")
    mount = page.evaluate(CENSUS)
    painted = mount["painted"] or {}
    roster_gets = [(m, q) for (m, q, _b) in net if q == "/api/v1/roster"]
    mount_opens = [(m, q) for (m, q, _b) in net if q.startswith("/api/v1/chats")]

    # The cold render was HONEST: the resolving row painted first, the trio
    # (and the incapable seats) were never painted as chips, and the chips
    # that stand are the chat-capable roster seats.
    check("cold_render_never_paints_ghost_chips",
          storage == 0
          and painted.get("resolving") is True
          and all(g not in painted.get("agents", []) for g in GHOSTS + INCAPABLE)
          and painted.get("agents") == CHAT_CAPABLE_KEYS
          and "resolving" in painted.get("sources", [])
          and mount["chips"] == CHAT_CAPABLE_KEYS
          and mount["chipsBar"] == {"count": str(len(CHAT_CAPABLE_KEYS)), "source": "roster"},
          storage_entries=storage, painted=painted, census_chips=mount["chips"],
          chips_bar=mount["chipsBar"])

    # The ONE named mount request — GET /roster, and nothing chat-shaped else.
    check("cold_mount_one_named_roster_request",
          len(roster_gets) == 1 and len(mount_opens) == 0,
          roster_gets=len(roster_gets), chat_requests=mount_opens)

    # [+ Add] disproves the silent-swap: every roster seat is offered, and the
    # incapable ones are LABELED — capability is a disclosed distinction.
    page.locator('[data-testid="add-agent"]').click()
    page.locator('[data-testid="agent-picker-option"]').first.wait_for(timeout=30000)
    picker = page.evaluate(
        """() => [...document.querySelectorAll('[data-testid="agent-picker-option"]')]
                 .map((o) => ({ key: o.dataset.agentKey, capable: o.dataset.chatCapable,
                                labeled: !!o.querySelector('[data-testid="agent-picker-nochat"]') }))""")
    by_key = {o["key"]: o for o in picker}
    check("picker_labels_capability",
          [o["key"] for o in picker] == ROSTER_KEYS
          and all(by_key[k]["capable"] == "true" and not by_key[k]["labeled"] for k in CHAT_CAPABLE_KEYS)
          and all(by_key[k]["capable"] == "false" and by_key[k]["labeled"] for k in INCAPABLE),
          picker=picker)
    page.locator("textarea").click()  # outside-click closes the picker

    # The SEND connects EXACTLY the displayed chips (request-tapped body) and
    # no seat comes up red — the no-4-red-seats-by-default acceptance.
    displayed = page.evaluate(
        """() => [...document.querySelectorAll('[data-testid="agent-chip"]')].map((c) => c.dataset.agent)""")
    page.locator("textarea").fill(MSG_COLD)
    page.keyboard.press("Enter")
    page.wait_for_function(
        """() => document.querySelector('textarea')?.value === ''
             && document.querySelectorAll('[data-testid="seat-bubble"][data-pending="false"]').length > 0""",
        timeout=30000)
    sent = page.evaluate(CENSUS)
    opens = [(m, q, b) for (m, q, b) in net if m == "POST" and q == "/api/v1/chats"]
    sends = [(m, q) for (m, q, _b) in net if m == "POST" and "/messages" in q]
    roster_gets_after = [(m, q) for (m, q, _b) in net if q == "/api/v1/roster"]
    check("send_connects_exactly_the_displayed_chips",
          len(opens) == 1
          and (opens[0][2] or {}).get("clis") == displayed
          and displayed == CHAT_CAPABLE_KEYS
          and len(sends) == 1
          and len(roster_gets_after) == 1  # no send-time re-fetch or swap
          and sent["userBubbles"] == [MSG_COLD]
          and sent["replies"] > 0
          and not sent["openError"]
          and sent["sendFailed"] is None,
          displayed=displayed, open_body=opens[0][2] if opens else None,
          sends=len(sends), roster_gets=len(roster_gets_after), census=sent)
    # No ACP-config red seats by default: only capable seats have chips at
    # all, and none wears the core's "no ACP config" rejection. (The fixture's
    # slice-K reply drip DELIBERATELY kills the last-warmed seat after round 1
    # with "session exited unexpectedly" — a mid-stream death, allowed here;
    # the round-3 defect was OPEN-time "failed — no ACP config" seats.)
    check("no_acp_red_seats_by_default",
          set(sent["seatChips"]) == set(CHAT_CAPABLE_KEYS)
          and all("no ACP config" not in (sent["seatReasons"].get(k) or "")
                  for k in sent["seatChips"]),
          seat_chips=sent["seatChips"], seat_reasons=sent["seatReasons"])

    page.screenshot(path=str(VSHOTS / "ux-J43-cold-truth.png"))
    ctx1.close()

    # ── Scene 2: WARM CHIPS — the cached roster renders immediately ───────────
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    ctx2.add_init_script(PAINT_OBSERVER)
    page2 = ctx2.new_page()
    page2.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net2 = tap(page2)
    page2.goto(f"{ORIGIN}/chat/new", wait_until="domcontentloaded")
    page2.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)

    # Reset the paint witness, then SPA-navigate away and back (no reload —
    # the module-scope cache survives; a reload would be the cold arm again).
    page2.evaluate("() => { window.__paint = { agents: [], resolving: false, sources: [] }; }")
    page2.evaluate("""() => { history.pushState(null, '', '/chats');
                              window.dispatchEvent(new PopStateEvent('popstate')); }""")
    page2.get_by_text("New Chat", exact=True).first.wait_for(timeout=30000)
    page2.evaluate("""() => { history.pushState(null, '', '/chat/new');
                              window.dispatchEvent(new PopStateEvent('popstate')); }""")
    page2.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)

    warm = page2.evaluate(CENSUS)
    warm_painted = warm["painted"] or {}
    warm_roster_gets = [(m, q) for (m, q, _b) in net2 if q == "/api/v1/roster"]
    check("warm_return_chips_immediate_from_cache",
          warm["chips"] == CHAT_CAPABLE_KEYS
          and warm["chipsBar"] == {"count": str(len(CHAT_CAPABLE_KEYS)), "source": "roster"}
          and warm_painted.get("resolving") is False  # no resolving flash on the warm arm
          and len(warm_roster_gets) == 1,  # the first visit's resolve; the return added none
          census_chips=warm["chips"], chips_bar=warm["chipsBar"],
          painted=warm_painted, roster_gets=len(warm_roster_gets))

    page2.screenshot(path=str(VSHOTS / "ux-J43-warm-chips.png"))
    ctx2.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [str(VSHOTS / "ux-J43-cold-truth.png"),
                         str(VSHOTS / "ux-J43-warm-chips.png")]
report["ok"] = True
print(json.dumps(report, indent=2))
