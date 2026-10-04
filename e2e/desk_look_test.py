#!/usr/bin/env python3
"""
desk_look_test.py — THE DESK's look at 1440x900 under STUDIO_SKIN=desk + theme wicked-light
(studio#425, studio#421; DESIGN-simple §1a, the restated skin contract).

Drives the built UI against the in-process fixture (the wave-2b queue corpus, 9 rail sessions)
with the stored appearance set to wicked-light + the harbor accent, and proves:

  1. SPARK: the highlighter behind "N things need you." and the dot on the most urgent needs-you
     row compute to signal yellow #FFDA19 (rgb 255, 218, 25); the Desk rail badge is yellow too.
     No needs-you mark (rail session dot, list dot, Watchtower dot, card underline) is the
     control violet #6F42C1 — violet is only a quiet gate/rule tint.
  2. NO MONOSPACE in the default layer: no visible text in the session rail or the Desk computes
     to a monospace font-family while "Show technical details" is off. With it on, a technical
     handle ([data-tech]) keeps the mono face.
  3. EVERYTHING ELSE FITS (studio#421): opening "Additional settings" at 1440x900 covers neither the
     sessions nor "+ Start something", and every destination is reachable — on screen, or in a
     scroller of its own — and still navigates.
  4. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-look.png, desk-look-everything.png. Env: FEEDBACK_PORT (default 4347).
"""

import json
import os
import sys

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture,
                           start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4347"))
W, H = 1440, 900
SHOTS = REPO / "e2e" / "shots"
SPARK = "rgb(255, 218, 25)"
VIOLET = "rgb(111, 66, 193)"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

# wicked-light with the harbor preset (appearance.ts HARBOR_ACCENT = 200/47/25), as the Theme
# page stores it when the operator picks the theme.
LIGHT = dict(DEFAULT_APPEARANCE, theme="wicked-light", accent_h=200, accent_s=47, accent_l=25)
CORPUS = dict(wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={},
              extra_frames=[], appearance=LIGHT, view_prefs=None)

MARKS = """(violet) => {
  const bg = (el) => el ? getComputedStyle(el).backgroundColor : null;
  const rows = [...document.querySelectorAll('[data-testid="needs-you-queue"] [data-testid="need-row"]')];
  const first = rows[0] ? rows[0].querySelector('.wk-desk-dot') : null;
  const violetMarks = [
    ...[...document.querySelectorAll('[data-testid="session-rail"] .wk-desk-dot, [data-testid="desk"] .wk-desk-dot')]
      .filter((d) => bg(d) === violet).map((d) => 'dot:' + (d.closest('[data-testid]')?.dataset.testid ?? '?')),
    ...[...document.querySelectorAll('.wk-desk-underline')]
      .filter((u) => getComputedStyle(u).textDecorationColor === violet).map(() => 'underline'),
  ];
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    mark: bg(document.querySelector('[data-testid="desk-headline"] mark')),
    urgentDot: bg(first),
    urgentKey: rows[0] ? rows[0].dataset.key : null,
    badge: bg(document.querySelector('[data-testid="desk-rail-badge"]')),
    violetMarks,
  };
}"""

MONO = """() => {
  const roots = [...document.querySelectorAll('[data-testid="session-rail"], [data-testid="desk"]')];
  const out = [];
  for (const root of roots) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || n.textContent.trim() === '' || el.getClientRects().length === 0) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (/mono/i.test(getComputedStyle(el).fontFamily)) out.push(n.textContent.trim().slice(0, 40));
    }
  }
  return out;
}"""

TECH_PROBE = """() => {
  const host = document.querySelector('[data-testid="desk-headline"]');
  const s = document.createElement('span');
  s.setAttribute('data-tech', 'on'); s.className = 'font-mono'; s.textContent = 'run 1234abcd';
  host.appendChild(s);
  const f = getComputedStyle(s).fontFamily; s.remove();
  return f;
}"""

EVERYTHING = """(h) => {
  const box = (el) => { const b = el.getBoundingClientRect(); return {top: b.top, bottom: b.bottom, left: b.left, right: b.right}; };
  // Is the element's centre the element itself (not covered), and on screen?
  const shown = (el) => {
    const b = el.getBoundingClientRect();
    if (b.height === 0 || b.bottom > h + 0.5 || b.top < -0.5) return false;
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  };
  const list = document.querySelector('[data-testid="desk-rail-additional"]');
  const start = document.querySelector('[data-testid="desk-rail-start"]');
  const sessions = [...document.querySelectorAll('[data-testid="rail-session"]')];
  const unreachable = [];
  for (const a of list.querySelectorAll('a[data-nav-dest]')) {
    a.scrollIntoView({block: 'nearest'});
    if (!shown(a)) unreachable.push(a.dataset.navDest);
  }
  list.scrollTop = 0;
  return {
    list: box(list), listInView: box(list).bottom <= h + 0.5 && box(list).top >= -0.5,
    startShown: !!start && shown(start),
    sessionsShown: sessions.filter(shown).length, sessions: sessions.length,
    unreachable,
  };
}"""

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, **CORPUS)
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=10000)
        page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'wicked-light'",
                               timeout=10000)
        page.wait_for_function("() => !!document.querySelector('[data-testid=\"desk-headline\"] mark')", timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-look-missing.png"))
        fail("desk-renders", f"the Desk under wicked-light did not render: {e}")
    page.mouse.move(W // 2, 20)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-look.png"))

    # ── 1. the spark marks ────────────────────────────────────────────────────────
    m = page.evaluate(MARKS, VIOLET)
    check("spark-marks", m["theme"] == "wicked-light" and m["mark"] == SPARK and m["urgentDot"] == SPARK
          and m["badge"] == SPARK and not m["violetMarks"], expected=SPARK, **m)

    # ── 2. no monospace in the default layer; a technical handle keeps it ─────────
    mono = page.evaluate(MONO)
    check("no-mono-default-layer", not mono, mono=mono)
    set_fixture(origin, view_prefs={"technical_details": True})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => !!document.querySelector('[data-testid=\"desk-headline\"]')", timeout=10000)
    tech_font = page.evaluate(TECH_PROBE)
    check("tech-details-keep-mono", "mono" in tech_font.lower(), font=tech_font)
    set_fixture(origin, view_prefs=None)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"rail-session\"]').length >= 6",
                           timeout=10000)

    # ── 3. "Additional settings" at 1440x900 ──────────────────────────────────────────
    page.get_by_test_id("desk-rail-more").click()
    page.get_by_test_id("desk-rail-additional").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-look-everything.png"))
    ev = page.evaluate(EVERYTHING, H)
    check("everything-else-fits", ev["listInView"] and ev["startShown"] and ev["sessions"] >= 6
          and ev["sessionsShown"] >= 6 and not ev["unreachable"], **ev)
    # The overlay contract: Escape from inside closes it and returns focus to "Additional settings";
    # an Escape a higher layer owns (the shortcut overlay) closes only that layer (Copilot r1).
    page.locator('[data-testid="desk-rail-additional"] [data-nav-dest="settings:/system"]').focus()
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    esc = page.evaluate("""() => ({open: !!document.querySelector('[data-testid="desk-rail-additional"]'),
      focus: document.activeElement?.dataset?.testid ?? null})""")
    page.get_by_test_id("desk-rail-more").click()
    page.get_by_test_id("desk-rail-additional").wait_for(state="visible", timeout=5000)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Alt+/")
    page.get_by_test_id("shortcut-overlay").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    layered = page.evaluate("""() => ({overlay: !!document.querySelector('[data-testid="shortcut-overlay"]'),
      open: !!document.querySelector('[data-testid="desk-rail-additional"]')})""")
    check("everything-else-escape", not esc["open"] and esc["focus"] == "desk-rail-more"
          and not layered["overlay"] and layered["open"], esc=esc, layered=layered)
    last = page.locator('[data-testid="desk-rail-additional"] [data-nav-dest="settings:/theme"]')
    last.scroll_into_view_if_needed()
    last.click()
    page.wait_for_function("() => window.location.pathname === '/theme'", timeout=5000)
    closed = page.evaluate("() => !document.querySelector('[data-testid=\"desk-rail-additional\"]')")
    check("everything-else-navigates", closed, closed=closed)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
