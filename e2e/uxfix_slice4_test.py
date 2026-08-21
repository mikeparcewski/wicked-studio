#!/usr/bin/env python3
"""
uxfix_slice4_test.py — the DES-UXFIX-001 slice-4 gate: the mode switcher given
real visual weight (§2.5, F8) and Chat's first-run moment made to teach
(§2.4, F6), proven in a real browser against the W2 messy-reality fixture
(§4.2) extended with the chat surface (roster + instant-warm chat endpoints in
`uxfix_fixture.py`).

Same rig pattern as the slice-1/2/3 gates: the SHARED deterministic fixture
server serves the `dist-sameorigin/` build plus every endpoint the routes read;
no crew daemon is involved anywhere. This rig never flips the fixture switches.

What it asserts (design §4.3, the slice-4 DOM AC):
  1. Switcher weight (F8): data-testid="mode-switcher" renders four segments,
     each glyph + label; the ACTIVE segment's computed background is FILLED
     (≠ transparent — asserted as the literal accent rgb), an inactive one is
     not; the active mode's summary is IN THE DOM (data-testid="mode-summary"),
     not just a title attribute.
  2. Chat first-run (F6): entering /p/<id>/chat with nothing stored warms ZERO
     seats — the rig taps the network and proves NO POST /api/v1/chats and NO
     GET /api/v1/roster fires on mount — and shows the teaching state
     (chat-firstrun), a focused composer, ONE disclosure (add-agents), no seat
     chips, no Close, and no "Group chat"/"End chat" copy anywhere.
  3. The disclosure: clicking add-agents fires exactly ONE POST /api/v1/chats
     (with NO `clis` — the daemon warms its own roster), the four-seat chip
     strip appears all-ready, Close appears, the disclosure retires.
  4. Typing is the other opt-in: in a FRESH tab (own sessionStorage), typing a
     message and pressing Enter fires exactly ONE POST /api/v1/chats whose
     `clis` is ["claude"] — the single default agent, not the roster — then
     POSTs the message to /chats/<id>/messages; the user bubble renders and the
     disclosure is still available (one agent is not the multi-agent strip).

Captures (§4.0 contract: 1440x900 viewport, device_scale_factor=1, waits on
data-testid, never a sleep) into e2e/shots/uxfix/ — gitignored evidence:
  uxfix-4-switcher.png        the weighted segmented control (element shot)
  uxfix-4-chat-firstrun.png   the teaching first-run Chat surface (full page)
  uxfix-4-chat-multiagent.png the disclosed multi-agent strip + Close (full page)

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4333), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    SHOTS,
    ensure_build,
    start_server,
)

W2_PORT = int(os.environ.get("W2_PORT", "4333"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"
CHAT_URL = f"{ORIGIN}/p/q3-review-deck/chat"
# The switcher's fill was pinned to the pre-token accent literal here; vision
# slice 3 moved the active segment onto `var(--accent)` (DES-VISION-001 §5.2),
# so the assertion is re-pinned to the TOKEN by in-page probe — same
# supersession the slice-1 rig went through when the card background moved onto
# `--surface-card`. The design assertion is unchanged: the active segment is
# FILLED and an inactive one is not (F8).
ACCENT_PROBE_JS = """() => {
  const el = document.createElement('div');
  el.style.background = 'var(--accent)';
  document.body.appendChild(el);
  const v = getComputedStyle(el).backgroundColor;
  el.remove();
  return v;
}"""
ROSTER_KEYS = ["claude", "codex", "agy", "pi"]

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the slice-1/2/3 rigs — same dist dir) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (§4.2 + the slice-4 chat surface) ─────────
start_server(W2_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ───────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

console_errors: list[str] = []


def tap(page):
    """Record the chat-surface requests: (method, path, json-body-or-None)."""
    log: list[tuple[str, str, dict | None]] = []

    def on_request(req):
        from urllib.parse import urlparse
        path = urlparse(req.url).path
        if path.startswith("/api/v1/chats") or path == "/api/v1/roster":
            body = None
            if req.post_data:
                try:
                    body = json.loads(req.post_data)
                except ValueError:
                    body = None
            log.append((req.method, path, body))

    page.on("request", on_request)
    return log


def opens(log) -> list[dict | None]:
    return [b for (m, p, b) in log if m == "POST" and p == "/api/v1/chats"]


with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    # ── Scene A: first-run + the disclosure, on one tab ────────────────────────
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net = tap(page)

    page.goto(CHAT_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="mode-switcher"]').wait_for(timeout=30000)
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # AC 1 — the switcher is the spine (F8): filled active segment, glyph+label
    # segments, summary in the DOM. All read from computed style / live DOM;
    # the fill's value comes from the accent TOKEN by probe (see ACCENT_PROBE_JS).
    accent_rgb = page.evaluate(ACCENT_PROBE_JS)
    switcher = page.evaluate(
        """accent => {
             const active = document.querySelector('[data-testid="mode-tab-chat"]');
             const inactive = document.querySelector('[data-testid="mode-tab-build"]');
             const summary = document.querySelector('[data-testid="mode-summary"]');
             const tabs = Array.from(document.querySelectorAll(
               '[data-testid="mode-switcher"] [role="tab"]'));
             return {
               activeBg: getComputedStyle(active).backgroundColor,
               inactiveBg: getComputedStyle(inactive).backgroundColor,
               activeFilled: getComputedStyle(active).backgroundColor === accent,
               inactiveNotFilled: getComputedStyle(inactive).backgroundColor !== accent,
               tabTexts: tabs.map(t => t.textContent),
               glyphsPresent: ['💬','⚙','▤','▶'].every((g, i) => tabs[i].textContent.includes(g)),
               summaryText: summary ? summary.textContent : null,
               summaryVisible: summary !== null && summary.offsetParent !== null,
             };
           }""",
        accent_rgb,
    )

    # AC 2 — first-run teaches, nothing warms. The network tap has recorded every
    # chat/roster request since navigation; by now the page settled through several
    # DOM waits, so an eager mount-warm would already be in the log.
    firstrun = page.evaluate(
        """() => {
             const teach = document.querySelector('[data-testid="chat-firstrun"]');
             const body = document.body.innerText;
             return {
               teachText: teach ? teach.innerText : null,
               addAgents: !!document.querySelector('[data-testid="add-agents"]'),
               closeAbsent: !document.querySelector('[data-testid="chat-close"]'),
               noChips: !document.querySelector('[title="ready"], [title="warming"]'),
               noGroupChatCopy: !body.includes('Group chat') && !body.includes('End chat'),
               composerFocused: document.activeElement?.tagName === 'TEXTAREA',
             };
           }"""
    )
    mount_opens = len(opens(net))
    mount_roster = len([1 for (m, q, _b) in net if q == "/api/v1/roster"])

    # Captures: the weighted switcher (element) + the teaching surface (full page).
    page.locator('[data-testid="mode-switcher"]').screenshot(
        path=str(SHOTS / "uxfix-4-switcher.png"))
    page.screenshot(path=str(SHOTS / "uxfix-4-chat-firstrun.png"))

    # AC 3 — the disclosure warms the roster and reveals the strip.
    page.locator('[data-testid="add-agents"]').click()
    page.locator('[data-testid="chat-close"]').wait_for(timeout=30000)
    page.wait_for_function(
        """n => document.querySelectorAll('[title="ready"]').length === n""",
        arg=len(ROSTER_KEYS), timeout=30000,
    )
    disclosed = page.evaluate(
        """keys => {
             const chips = Array.from(document.querySelectorAll('[title="ready"]'))
               .map(c => c.textContent.trim());
             return {
               chips,
               allSeats: keys.every(k => chips.includes(k)),
               addAgentsRetired: !document.querySelector('[data-testid="add-agents"]'),
               closePresent: !!document.querySelector('[data-testid="chat-close"]'),
               firstrunGone: !document.querySelector('[data-testid="chat-firstrun"]'),
             };
           }""",
        ROSTER_KEYS,
    )
    disclosed_opens = opens(net)
    page.screenshot(path=str(SHOTS / "uxfix-4-chat-multiagent.png"))
    page.close()

    # ── Scene B: typing is the opt-in — a FRESH tab (own sessionStorage) ───────
    page2 = ctx.new_page()
    page2.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net2 = tap(page2)
    page2.goto(CHAT_URL, wait_until="domcontentloaded")
    page2.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page2.add_style_tag(content=HIDE_GATE_TOASTS)

    page2.locator("textarea").fill("make me a deck")
    page2.keyboard.press("Enter")
    page2.locator('[data-testid="chat-close"]').wait_for(timeout=30000)
    typed = page2.evaluate(
        """() => ({
             userBubble: document.body.innerText.includes('make me a deck'),
             readyChips: Array.from(document.querySelectorAll('[title="ready"]'))
               .map(c => c.textContent.trim()),
             addAgentsStillOffered: !!document.querySelector('[data-testid="add-agents"]'),
           })"""
    )
    typed_opens = opens(net2)
    sent = [(m, q, b) for (m, q, b) in net2 if m == "POST" and q.endswith("/messages")]
    page2.close()

    ctx.close()
    browser.close()

report["steps"]["slice4_switcher"] = {
    "ok": all([
        switcher["activeFilled"], switcher["inactiveNotFilled"], switcher["glyphsPresent"],
        switcher["summaryVisible"],
        (switcher["summaryText"] or "").startswith("Talk to an agent"),
        len(switcher["tabTexts"]) == 4,
    ]),
    **switcher,
}
report["steps"]["slice4_chat_firstrun"] = {
    "ok": all([
        firstrun["teachText"] is not None,
        "Chat with an agent about this project." in (firstrun["teachText"] or ""),
        "just talk" in (firstrun["teachText"] or ""),
        firstrun["addAgents"], firstrun["closeAbsent"], firstrun["noChips"],
        firstrun["noGroupChatCopy"], firstrun["composerFocused"],
        mount_opens == 0, mount_roster == 0,
    ]),
    **firstrun,
    "openChat_requests_on_mount": mount_opens,
    "roster_requests_on_mount": mount_roster,
}
report["steps"]["slice4_add_agents"] = {
    "ok": all([
        disclosed["allSeats"], disclosed["addAgentsRetired"], disclosed["closePresent"],
        disclosed["firstrunGone"],
        len(disclosed_opens) == 1,
        (disclosed_opens[0] or {}).get("clis") is None,
    ]),
    **disclosed,
    "openChat_requests_total": len(disclosed_opens),
    "open_body_clis": (disclosed_opens[0] or {}).get("clis") if disclosed_opens else "none",
}
report["steps"]["slice4_first_send"] = {
    "ok": all([
        typed["userBubble"],
        typed["readyChips"] == ["claude"],
        typed["addAgentsStillOffered"],
        len(typed_opens) == 1,
        (typed_opens[0] or {}).get("clis") == ["claude"],
        len(sent) == 1,
        (sent[0][2] or {}).get("text") == "make me a deck",
    ]),
    **typed,
    "openChat_requests_total": len(typed_opens),
    "open_body_clis": (typed_opens[0] or {}).get("clis") if typed_opens else "none",
    "message_posts": len(sent),
}
report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(SHOTS / "uxfix-4-switcher.png"),
    str(SHOTS / "uxfix-4-chat-firstrun.png"),
    str(SHOTS / "uxfix-4-chat-multiagent.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("slice4_verdict", f"slice-4 assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
