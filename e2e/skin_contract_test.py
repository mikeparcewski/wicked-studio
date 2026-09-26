#!/usr/bin/env python3
"""
skin_contract_test.py — the SKIN CONTRACT (src/theming/skins.ts) at 1440x700.

A skin changes shape, never behaviour. This journey drives the SAME wave-2b queue corpus
(two simple gates grouped, one MCP elicitation, one failure) under both skins and proves:

  0. ENV SWITCH: with the fixture's default appearance, the page boots under STUDIO_SKIN
     (default `studio`) — the switch every behaviour journey runs under.
  1. STRUCTURE CHANGES under `compact-rail`:
       - <html data-skin="compact-rail">;
       - the Needs-you queue lives INSIDE the shell's right rail, flush with the right edge
         (not in the command center), rendered with data-skin-variant="rail";
       - the left nav is collapsed to icons (the glyph column, 56px wide);
       - the type scale is denser (computed --text-sm is 12px, not 13px).
     Under `studio`: no right rail, the queue sits in the command center, the full nav rail.
  2. BEHAVIOUR STAYS IDENTICAL: the queue's rows (keys, kinds, counts, order), the j cursor,
     Enter-expands-the-group and its members, k back, and Enter-opens-a-row are the same
     under both skins.
  3. EVERY NAV DESTINATION IS REACHABLE UNDER EVERY SKIN: the nav's destinations (the ten
     section dashboards, the three Settings pages, Notifications, Health — every element
     stamped `data-nav-dest`) are enumerated under both skins with Settings opened (the
     accordion under `studio`, the icon flyout under `compact-rail`); the sets must be equal,
     every icon must carry an aria-label, Health must open its registry and a Settings page
     must navigate under both.
  4. THE PICKER: on /theme, choosing `Compact rail` flips data-skin live, the debounced PUT
     carries `studio.appearance.skin`, and Home then renders the queue in the right rail.

Captures: e2e/shots/skin-{studio,compact-rail}-home.png, skin-{studio,compact-rail}-nav.png,
skin-picker.png.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4346), STUDIO_SKIN. Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4346"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
RAIL_PX = 340

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


TOP_ROWS = """() => [...document.querySelectorAll('[data-testid="needs-you-queue"] [data-testid="need-row"]')]
  .map(r => ({key: r.dataset.key, kind: r.dataset.kind, count: Number(r.dataset.count || '1')}))"""
MEMBERS = """() => [...document.querySelectorAll('[data-testid="need-member"]')].map(r => r.dataset.key)"""
SELECTED = """() => { const el = document.querySelector('[data-testid="needs-you-queue"] [data-kbd-selected="true"]');
  return el ? el.dataset.key : null; }"""
STRUCTURE = """() => {
  const q = document.querySelector('[data-testid="needs-you-queue"]');
  const rail = document.querySelector('[data-testid="skin-right-rail"]');
  const cc = document.querySelector('[data-testid="command-center"]');
  const nav = document.querySelector('[data-testid="left-rail"]');
  const qb = q.getBoundingClientRect();
  return {
    skin: document.documentElement.getAttribute('data-skin'),
    queueVariant: q.getAttribute('data-skin-variant'),
    queueInRail: !!rail && rail.contains(q),
    queueInCommandCenter: !!cc && cc.contains(q),
    railPresent: !!rail,
    queueLeft: Math.round(qb.left), queueRight: Math.round(qb.right), queueHeight: Math.round(qb.height),
    navWidth: Math.round(nav.getBoundingClientRect().width),
    navVariant: nav.getAttribute('data-skin-variant'),
    navGlyphs: document.querySelectorAll('[data-testid="rail-collapsed-glyph"]').length,
    textSm: getComputedStyle(document.documentElement).getPropertyValue('--text-sm').trim(),
    space4: getComputedStyle(document.documentElement).getPropertyValue('--space-4').trim(),
  };
}"""

CORPUS = dict(wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={},
              extra_frames=[])


def boot_home(page, origin: str, skin: str | None) -> None:
    """Seed the stored appearance (None = the fixture default, i.e. STUDIO_SKIN), load Home."""
    appearance = None if skin is None else {**DEFAULT_APPEARANCE, "skin": skin}
    set_fixture(origin, appearance=appearance, **CORPUS)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    set_fixture(origin, extra_frames=[{"type": "elicitationCreated", "session": "e1",
                                       "elicitationId": "el-1",
                                       "message": "Which region should the backfill target?",
                                       "options": None}])
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"need-row\"][data-kind=\"elicitation\"]')",
        timeout=5000)


def behaviour(page) -> dict:
    """The queue's behaviour, read through testids and keys only — skin-blind."""
    rows = page.evaluate(TOP_ROWS)
    q = page.get_by_test_id("needs-you-queue")
    q.focus()
    page.keyboard.press("j")
    first = page.evaluate(SELECTED)
    page.keyboard.press("Enter")
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"need-member\"]').length === 2", timeout=3000)
    members = page.evaluate(MEMBERS)
    page.keyboard.press("j")
    into = page.evaluate(SELECTED)
    page.keyboard.press("j")
    page.keyboard.press("j")
    elicit = page.evaluate(SELECTED)
    page.keyboard.press("k")
    back = page.evaluate(SELECTED)
    return {"rows": rows, "j": first, "members": members, "j_into_members": into,
            "j_to_elicitation": elicit, "k_back": back}


NAV_DESTS = """() => [...document.querySelectorAll('[data-testid="left-rail"] [data-nav-dest], [data-nav-dest="health"]')]
  .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(el => ({dest: el.dataset.navDest, label: el.getAttribute('aria-label'),
               name: (el.getAttribute('aria-label') || el.innerText || '').trim()}))"""
EXPECTED_DESTS = sorted([
    "section:projects", "section:execute", "section:test", "section:vibe", "section:demo",
    "section:chat", "section:repos", "section:skills", "section:steering", "section:testing",
    "settings:/theme", "settings:/workflows", "settings:/system", "notifications", "health",
])


def nav_reach(page, skin: str) -> dict:
    """Open Settings the way this skin offers it, then enumerate the reachable destinations."""
    if skin == "compact-rail":
        page.get_by_test_id("rail-icon-settings").click()
        page.get_by_test_id("rail-settings-flyout").wait_for(state="visible", timeout=5000)
    else:
        page.get_by_test_id("rail-title-settings").click()
    page.get_by_role("menuitem", name="Theme").wait_for(state="visible", timeout=5000)
    dests = page.evaluate(NAV_DESTS)
    page.screenshot(path=str(SHOTS / f"skin-{skin}-nav.png"))
    page.keyboard.press("Escape")
    # Health opens its registry (a flyout at icon width, the rail foot at full width).
    page.get_by_test_id("rail-health-toggle").click()
    page.wait_for_function(
        "() => { const s = document.querySelector('[data-testid=\"rail-health-section\"]');"
        " return !!s && s.dataset.open === 'true' && s.innerText.includes('WebSocket'); }", timeout=5000)
    health_open = True
    page.get_by_test_id("rail-health-toggle").click()
    # A Settings page navigates.
    if skin == "compact-rail":
        page.get_by_test_id("rail-icon-settings").click()
    page.get_by_role("menuitem", name="Theme").click()
    page.wait_for_function("() => window.location.pathname === '/theme'", timeout=5000)
    return {"dests": dests, "health_opens": health_open, "settings_navigates": True}


def open_selected(page) -> str:
    page.keyboard.press("j")
    page.keyboard.press("Enter")
    page.wait_for_function("() => window.location.pathname.includes('e1')", timeout=5000)
    return page.evaluate("() => window.location.pathname")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    # Keep the pointer off the icon rail so its hover-expand never widens it mid-measure.
    page.mouse.move(W // 2, H // 2)

    # ── 0. the env switch: the fixture default boots under STUDIO_SKIN ─────────────────
    boot_home(page, origin, None)
    booted = page.evaluate("() => document.documentElement.getAttribute('data-skin')")
    check("env-switch-boots-env-skin", booted == STUDIO_SKIN, env=STUDIO_SKIN, booted=booted)

    # ── 1 + 2. both skins: structure, then behaviour ──────────────────────────────────
    seen: dict = {}
    for skin in ("studio", "compact-rail"):
        boot_home(page, origin, skin)
        page.mouse.move(W // 2, H // 2)
        page.wait_for_function(
            f"() => document.documentElement.getAttribute('data-skin') === {json.dumps(skin)}",
            timeout=5000)
        # The rail's slot registers on commit; the queue docks on the next render.
        if skin == "compact-rail":
            page.wait_for_function(
                "() => { const r = document.querySelector('[data-testid=\"skin-right-rail\"]');"
                " return !!r && !!r.querySelector('[data-testid=\"needs-you-queue\"]'); }",
                timeout=5000)
        structure = page.evaluate(STRUCTURE)
        page.screenshot(path=str(SHOTS / f"skin-{skin}-home.png"))
        beh = behaviour(page)
        opened = open_selected(page)
        seen[skin] = {"structure": structure, "behaviour": beh, "opened": opened}

    s, c = seen["studio"]["structure"], seen["compact-rail"]["structure"]
    check("studio-structure",
          s["skin"] == "studio" and not s["railPresent"] and s["queueInCommandCenter"]
          and s["queueVariant"] == "inline" and s["navVariant"] == "full" and s["navGlyphs"] == 0
          and s["navWidth"] >= 250 and s["textSm"] == "13px",
          **s)
    check("compact-rail-queue-in-right-rail",
          c["skin"] == "compact-rail" and c["railPresent"] and c["queueInRail"]
          and not c["queueInCommandCenter"] and c["queueVariant"] == "rail"
          and c["queueLeft"] >= W - RAIL_PX - 1 and c["queueRight"] >= W - 24,
          **c)
    check("compact-rail-nav-collapsed-to-icons",
          c["navVariant"] == "icons" and c["navGlyphs"] > 0 and c["navWidth"] <= 64,
          navWidth=c["navWidth"], glyphs=c["navGlyphs"])
    check("compact-rail-denser-scale",
          c["textSm"] == "12px" and c["space4"] == "10px" and s["space4"] == "16px",
          studio={"text_sm": s["textSm"], "space_4": s["space4"]},
          compact={"text_sm": c["textSm"], "space_4": c["space4"]})

    bs, bc = seen["studio"]["behaviour"], seen["compact-rail"]["behaviour"]
    check("behaviour-identical",
          bs == bc and seen["studio"]["opened"] == seen["compact-rail"]["opened"]
          and len(bs["rows"]) == 3 and bs["rows"][0]["count"] == 2
          and bs["members"] == ["gate:g1", "gate:g2"] and bs["k_back"] == "gate:g2",
          studio=bs, compact_rail=bc, opened=seen["studio"]["opened"])

    # ── 3. every nav destination reachable under every skin ───────────────────────────
    reach: dict = {}
    for skin in ("studio", "compact-rail"):
        boot_home(page, origin, skin)
        page.mouse.move(W // 2, H // 2)
        reach[skin] = nav_reach(page, skin)
    rs = sorted(d["dest"] for d in reach["studio"]["dests"])
    rc = sorted(d["dest"] for d in reach["compact-rail"]["dests"])
    unlabelled = [d["dest"] for d in reach["compact-rail"]["dests"] if not d["name"]]
    icons_without_aria = [d["dest"] for d in reach["compact-rail"]["dests"]
                          if d["dest"].startswith(("section:", "notifications", "health")) and not d["label"]]
    check("nav-destinations-same-under-both-skins",
          rs == EXPECTED_DESTS and rc == EXPECTED_DESTS and not unlabelled and not icons_without_aria
          and all(r["health_opens"] and r["settings_navigates"] for r in reach.values()),
          studio=rs, compact_rail=rc, unlabelled=unlabelled, icons_without_aria=icons_without_aria)

    # ── 4. the picker: live swap + persisted through the same PUT ─────────────────────
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "skin": "studio"}, **CORPUS)
    page.goto(f"{origin}/theme", wait_until="networkidle")
    page.get_by_test_id("skin-picker").wait_for(state="visible", timeout=10000)
    with page.expect_request(lambda r: r.method == "PUT" and r.url.endswith("/api/v1/settings"),
                             timeout=5000) as put:
        page.get_by_test_id("skin-option-compact-rail").click()
        live = page.evaluate("() => document.documentElement.getAttribute('data-skin')")
    stored = json.loads(put.value.post_data or "{}").get("studio.appearance") or {}
    checked = page.get_by_test_id("skin-option-compact-rail").get_attribute("aria-checked")
    page.mouse.move(W // 2, H // 2)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "skin-picker.png"))
    check("picker-applies-live-and-persists",
          live == "compact-rail" and stored.get("skin") == "compact-rail" and checked == "true",
          live=live, put_skin=stored.get("skin"), aria_checked=checked)
    # A fresh load of Home reads the skin back from the settings store the PUT wrote.
    page.goto(f"{origin}/", wait_until="networkidle")
    page.wait_for_function(
        "() => { const r = document.querySelector('[data-testid=\"skin-right-rail\"]');"
        " return !!r && !!r.querySelector('[data-testid=\"needs-you-queue\"]'); }",
        timeout=10000)
    check("picker-swap-reaches-home", True)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
