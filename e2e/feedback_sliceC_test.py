#!/usr/bin/env python3
"""
feedback_sliceC_test.py — the DES-FEEDBACK-001 slice-C gate: Chat default
agent chips (§6, §8.3 slice C), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py).

The slice DOM ACs (§8.3), as RE-SCOPED TWICE — by DES-UX-001 slice AB
(§11.2, roster-first) and by BRIEF-UX-001 C6/EC44 (round 3: chips are truth —
the fallback trio is GONE; no chip is painted until the roster is known):

  1. `[data-testid="agent-chip"]` elements resolve on this cold route from the
     surface's ONE named mount request (GET /roster) — roster-true, never a
     fabricated trio (`data-source="roster"`);
  2. the `data-count` attribute equals the CHAT-CAPABLE seat count;
  3. clicking a chip's ✕ removes it (count decrements);
  4. `[data-testid="add-agent"]` button opens the roster picker (from the
     now-warm cache — no second fetch);
  5. zero `openChat` requests fire on mount (verified by `page.on('request')`).

The mount-network assertion is the same DELTA discipline as before: the tap
records EVERY /api/v1/* request; the chat-surface set on mount must be
EXACTLY the one named GET /roster (EC44's carve-out from the §2.4 budget) and
zero /chats requests. The rail's own requests are reported informationally,
never asserted against.

Plus the §8.3 preservation list this rig can see: the chat first-run teaching
state (EC7 — the surface teaches itself; pinned in depth by uxfix_slice4) and
EC13 (chip text reads in the SANS — asserted via computed style, with the
token anatomy: --radius-full resolves to 9999px, --text-xs to 11px).

Captures (§8.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback-C-chat-chips.png          Chat first-run, capable default chips, no thread
  feedback-C-chat-chips-removed.png  one chip removed, 2 remaining

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4353),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    REPO,
    ensure_build,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4353"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
CHAT_URL = f"{ORIGIN}/p/q3-review-deck/chat"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# EC44: the cold route resolves the roster on mount; the default chips are
# the CHAT-CAPABLE subset (acp object or absent key — pi's arm; explicit
# null = incapable, offered only in the labeled picker).
ROSTER_KEYS = ["claude", "codex", "agy", "pi"]
CAPABLE = ["claude", "pi"]

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []


def is_chat_surface(path: str) -> bool:
    """The requests THIS slice could add — the §2.4 delta under assertion."""
    return path.startswith("/api/v1/chats") or path == "/api/v1/roster"


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    # The tap: every API request since navigation, split into the chat-surface
    # delta (asserted empty on mount) and the rail's own calls (reported only).
    api_log: list[tuple[str, str, dict | None]] = []

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
        api_log.append((req.method, path, body))

    page.on("request", on_request)

    page.goto(CHAT_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page.locator('[data-testid="agent-chips-bar"]').wait_for(timeout=30000)
    # EC44: the chips RESOLVE (the honest resolving row first, then roster-true
    # chips) — wait for the resolved state before the census.
    page.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    fonts_ok = page.evaluate("() => document.fonts.status") is not None  # settle probe below
    try:
        page.wait_for_function(
            """() => document.fonts.status === 'loaded'
                  && document.fonts.check('12px "Inter"')""",
            timeout=20000,
        )
        fonts_ok = True
    except Exception:
        fonts_ok = False

    # ── AC 1 + 2 (+ EC13 anatomy): chips on first render, count 3, token-built ──
    first_render = page.evaluate(
        """() => {
             const bar = document.querySelector('[data-testid="agent-chips-bar"]');
             const chips = Array.from(document.querySelectorAll('[data-testid="agent-chip"]'));
             const c0 = chips[0] ? getComputedStyle(chips[0]) : null;
             const x0 = chips[0]?.querySelector('button');
             const xs = x0 ? getComputedStyle(x0) : null;
             const add = document.querySelector('[data-testid="add-agent"]');
             return {
               barCount: bar ? bar.dataset.count : null,
               barSource: bar ? bar.dataset.source : null,
               chipKeys: chips.map(c => c.dataset.agent),
               chipRadius: c0 ? c0.borderRadius : null,
               chipFontSize: c0 ? c0.fontSize : null,
               chipFontFamily: c0 ? c0.fontFamily : null,
               chipPadding: c0 ? c0.padding : null,
               xSize: xs ? `${xs.width} ${xs.height}` : null,
               xBackground: xs ? xs.backgroundColor : null,
               addPresent: !!add,
               addDashed: add ? getComputedStyle(add).borderTopStyle === 'dashed' : false,
               noThread: !document.querySelector('[data-testid="seat-chip"]'),
               teachPresent: !!document.querySelector('[data-testid="chat-firstrun"]'),
               pickerClosed: !document.querySelector('[data-testid="agent-picker"]'),
             };
           }"""
    )

    # ── AC 5 (+ AC 1's "without any network request"): the mount delta is empty ─
    mount_chat_surface = [(m, q) for (m, q, _b) in api_log if is_chat_surface(q)]
    mount_rail = sorted({q for (_m, q, _b) in api_log if not is_chat_surface(q)})
    open_posts_on_mount = [1 for (m, q, _b) in api_log if m == "POST" and q == "/api/v1/chats"]

    # ── Capture 1: first-run, 3 default chips, no thread ───────────────────────
    page.screenshot(path=str(VSHOTS / "feedback-C-chat-chips.png"))

    # ── AC 3: ✕ removes — count decrements, chip gone ──────────────────────────
    page.locator('[data-testid="agent-chip"][data-agent="claude"] button').click()
    removed = page.evaluate(
        """() => ({
             barCount: document.querySelector('[data-testid="agent-chips-bar"]')?.dataset.count ?? null,
             chipKeys: Array.from(document.querySelectorAll('[data-testid="agent-chip"]'))
               .map(c => c.dataset.agent),
           })"""
    )

    # ── Capture 2: one removed, 2 remaining ────────────────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback-C-chat-chips-removed.png"))

    # ── AC 4: [+ Add] opens the roster picker (its fetch rides the click) ──────
    roster_gets_before = len([1 for (_m, q, _b) in api_log if q == "/api/v1/roster"])
    page.locator('[data-testid="add-agent"]').click()
    page.locator('[data-testid="agent-picker"]').wait_for(timeout=10000)
    try:
        page.wait_for_function(
            """n => document.querySelectorAll('[data-testid="agent-picker-option"]').length === n""",
            arg=len(ROSTER_KEYS), timeout=10000,
        )
        picker_options_ok = True
    except Exception:
        picker_options_ok = False
    roster_gets_after = len([1 for (_m, q, _b) in api_log if q == "/api/v1/roster"])
    picker = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="agent-picker-option"]'))
                 .map(o => o.dataset.agentKey)"""
    )

    page.close()
    ctx.close()
    browser.close()

report["steps"]["chips_first_render"] = {
    "ok": all([
        fonts_ok,
        first_render["barCount"] == str(len(CAPABLE)),
        first_render["barSource"] == "roster",  # EC44's honesty attr: chips are seats
        first_render["chipKeys"] == CAPABLE,
        # §6.3 anatomy in tokens: --radius-full → 9999px, --text-xs → 11px,
        # EC13: the chip label reads in the SANS (Inter stack), 3px 8px 3px 6px.
        first_render["chipRadius"] == "9999px",
        first_render["chipFontSize"] == "11px",
        "Inter" in (first_render["chipFontFamily"] or ""),
        first_render["chipPadding"] == "3px 8px 3px 6px",
        first_render["xSize"] == "12px 12px",
        first_render["addPresent"], first_render["addDashed"],
        first_render["noThread"], first_render["teachPresent"],
        first_render["pickerClosed"],
    ]),
    **first_render,
    "web_fonts_loaded": fonts_ok,
    "screenshot": str(VSHOTS / "feedback-C-chat-chips.png"),
}
report["steps"]["mount_network_delta"] = {
    # EC44: exactly the ONE named roster resolve — and nothing chat-shaped.
    "ok": mount_chat_surface == [("GET", "/api/v1/roster")] and len(open_posts_on_mount) == 0,
    "chat_surface_requests_on_mount": mount_chat_surface,
    "openChat_posts_on_mount": len(open_posts_on_mount),
    "rail_owned_requests_ignored": mount_rail,
}
report["steps"]["chip_remove"] = {
    "ok": removed["barCount"] == "1" and removed["chipKeys"] == ["pi"],
    **removed,
    "screenshot": str(VSHOTS / "feedback-C-chat-chips-removed.png"),
}
report["steps"]["add_agent_picker"] = {
    "ok": all([
        picker_options_ok,
        picker == ROSTER_KEYS,
        # The mount already resolved the roster (EC44's one named request);
        # the picker reads the warm cache — the click adds NO fetch.
        roster_gets_before == 1,
        roster_gets_after == 1,
    ]),
    "picker_options": picker,
    "roster_gets_before_click": roster_gets_before,
    "roster_gets_after_click": roster_gets_after,
}
report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback-C-chat-chips.png"),
    str(VSHOTS / "feedback-C-chat-chips-removed.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceC_verdict", f"slice-C assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
