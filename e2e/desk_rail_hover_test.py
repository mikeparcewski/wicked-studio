#!/usr/bin/env python3
"""
desk_rail_hover_test.py — CAN A PERSON SEE THE RAIL'S HOVER? (operator 2026-10-26: "no hovers on the
buttons"). The first hover pass tinted items one surface step up (--surface-card), which on the rail's
own ground measured dE_OK 0.03 (dark) to 0.06 (wicked-dark) and looked the same as rest. This journey
measures what the eye gets, in a real browser at 1440x700, in every shipped theme (wicked-dark,
wicked-light, dark, light; each chosen the way the app stores it, with the accent that theme writes),
and again in each theme with a CUSTOM accent picked to sit close to that theme's rail (the accent
picker takes any hue, saturation and lightness, so the hover cannot rest on the accent alone).

For every interactive rail item type — the wordmark, an icon button (New job), a group icon, a group
header, a session row, "All jobs", a sidebar page item (Jobs), Build & settings and the Nerve Center tile:

  1. VISIBLE: the hover fill, composited over the rail's own background by the browser (a 1x1 canvas),
     sits dE_OK >= 0.08 (OKLab distance) from the rest fill. The current page's hover (the wordmark on
     Home on the Desk, Build & settings on /build) moves >= 0.06 from its wash.
  2. READABLE: every visible word in the item (each element with its own text, its colour composited
     over the fill; badges and the move button carry their own fill and are skipped) keeps >= 4.5:1 on
     the hover fill; every item but the Nerve Center tile (its own ink) goes to full ink (--ink-high).
  3. THE ICON BUTTONS draw an accent edge on hover: the button's border (the group icon: its inset ring)
     sits dE_OK >= 0.10 from the rail.
  4. PRESSED (a sidebar page item and Home, held down) is a stronger fill than hover (further from
     the rail), with its words still >= 4.5:1.
  5. REDUCED MOTION: a hovered icon button does not move (transform none); with motion it lifts.
  6. 0 page errors.

Captures: e2e/shots/rail-hover-<theme>.png (the rail with a session row hovered; preset accents).
Env: FEEDBACK_PORT (default 4391). Prints a JSON report; exit 0/1.
"""

import json
import math
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
MIN_DE = 0.08          # rest -> hover, over the rail
MIN_DE_CURRENT = 0.06  # current wash -> current hover
MIN_EDGE_DE = 0.10     # an icon button's hover edge against the rail
MIN_TEXT = 4.5

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def lin(v: float) -> float:
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def oklab(rgb) -> tuple:
    r, g, b = (lin(v) for v in rgb)
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)


def de(a, b) -> float:
    return round(math.dist(oklab(a), oklab(b)), 4)


HARBOR = {"accent_h": 200, "accent_s": 47, "accent_l": 25}
IRIS = {"accent_h": 230, "accent_s": 74, "accent_l": 68}
# (case, data-theme, appearance): each theme with the accent it writes, then with an accent near its rail.
CASES = [
    ("wicked-dark", "wicked-dark", {"theme": "wicked-dark", **HARBOR}),
    ("wicked-light", "wicked-light", {"theme": "wicked-light", **HARBOR}),
    ("dark", None, {"theme": "dark", **IRIS}),
    ("light", "light", {"theme": "light", **IRIS}),
    ("wicked-dark-custom", "wicked-dark", {"theme": "wicked-dark", "accent_h": 240, "accent_s": 50, "accent_l": 0}),
    ("wicked-light-custom", "wicked-light", {"theme": "wicked-light", "accent_h": 0, "accent_s": 0, "accent_l": 88}),
    ("dark-custom", None, {"theme": "dark", "accent_h": 210, "accent_s": 25, "accent_l": 8}),
    ("light-custom", "light", {"theme": "light", "accent_h": 60, "accent_s": 100, "accent_l": 68}),
]
# (name, selector, kind): kind "button" = an icon button (accent edge), "nc" = the Nerve Center tile.
ITEMS = [
    # The wordmark is the link Home (operator 2026-10-27): current on the Desk, but quiet at rest, so its
    # hover is a full rest -> hover step.
    ("wordmark", '[data-testid="desk-rail-wordmark"]', "row"),
    ("icon-button", '[data-testid="desk-rail-new-job"]', "button"),
    ("group-icon", '[data-testid="rail-group-new"], [data-testid="rail-group-view-unfiled"]', "ring"),
    ("group-header", '[data-testid="rail-group-toggle"]', "row"),
    ("session", '[data-testid="rail-session"]:not([aria-current="page"])', "row"),
    ("all-jobs", '[data-testid="rail-all-jobs"]', "row"),
    # The ui-v2 sidebar: a page item (Jobs) and Build & settings replace the Workspace links and General.
    ("page-item", '[data-testid="nav-jobs"]', "row"),
    # WORK's primary entry (Projects): stronger words, the same hover as every page item.
    ("page-primary", '[data-testid="nav-projects"]', "row"),
    ("build", '[data-testid="desk-rail-build"]', "row"),
    ("nerve-center", '[data-testid="desk-rail-nerve"]', "nc"),
]

# The browser composites each computed colour over the rail's background in a 1x1 canvas.
PAINT = """([under, fills]) => { const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  return fills.map(f => { x.clearRect(0, 0, 1, 1); x.fillStyle = under; x.fillRect(0, 0, 1, 1);
    x.fillStyle = f; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); }); }"""
STYLE = """e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color,
  border: s.borderTopColor, borderW: s.borderTopWidth, shadow: s.boxShadow, transform: s.transform }; }"""
# The lowest contrast of any visible word in `el` on `fill` (an opaque rgb string): every element with
# its own text, its colour composited over the fill; a descendant with its own fill (a badge, the move
# button) or display:none is skipped.
WORDS = """(el, fill) => { const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  const paint = (f) => { x.clearRect(0, 0, 1, 1); x.fillStyle = fill; x.fillRect(0, 0, 1, 1); x.fillStyle = f;
    x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const bg = paint('transparent'); let min = 99, who = null;
  const own = (n) => { for (let a = n; a && a !== el; a = a.parentElement) {
    const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true;
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') return true; } return false; };
  for (const n of [el, ...el.querySelectorAll('*')]) {
    if (![...n.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim())) continue;
    if (own(n)) continue;
    const ink = paint(getComputedStyle(n).color); const [hi, lo] = [lum(ink), lum(bg)].sort((a, b) => b - a);
    const r = (hi + 0.05) / (lo + 0.05); if (r < min) { min = r; who = n.className || n.tagName; } }
  return [Math.round(min * 100) / 100, String(who)]; }"""
INK_HIGH = """() => { const p = document.createElement('div'); p.style.color = 'var(--ink-high)';
  document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return v; }"""
# The first colour in an inset box-shadow (the group icon's hover ring).
RING = """(shadow) => { const m = /(rgba?\\([^)]*\\)|oklab\\([^)]*\\)|color\\([^)]*\\))[^,]*inset|inset[^,]*?(rgba?\\([^)]*\\)|oklab\\([^)]*\\)|color\\([^)]*\\))/.exec(shadow);
  return m ? (m[1] || m[2]) : null; }"""

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
PARK = (W - 200, H - 120)  # over the Desk, away from the rail


def settle(page, el=None) -> None:
    if el is None:
        page.mouse.move(*PARK)
    else:
        el.hover()
    page.wait_for_timeout(320)  # the 140 ms transition, with room


with sync_playwright() as p:
    browser = p.chromium.launch()
    results: dict = {}
    for case, want, appearance in CASES:
        ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
        # project_dto files every run, so the "Not in a project" group runs past five rows: Show N more.
        set_fixture(origin, wave1=True, wave2b=True, project_dto=True, appearance={**DEFAULT_APPEARANCE, **appearance})
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("session-rail").wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            "([t, l]) => document.documentElement.getAttribute('data-theme') === t"
            " && document.documentElement.style.getPropertyValue('--_accent-l') === l",
            arg=[want, f"{appearance['accent_l']}%"], timeout=10000)
        page.locator('[data-testid="rail-session"]').first.wait_for(state="visible", timeout=10000)
        rail_bg = page.get_by_test_id("session-rail").evaluate("e => getComputedStyle(e).backgroundColor")
        ink_high = page.evaluate(INK_HIGH)
        base = page.evaluate(PAINT, [rail_bg, [rail_bg]])[0]
        opaque = lambda c: "rgb(%d, %d, %d)" % tuple(c)  # noqa: E731
        rows: dict = {}
        for name, sel, kind in ITEMS:
            el = page.locator(sel).first
            if el.count() == 0:
                fail(f"{case}:{name}", f"no {sel} in the rail")
            el.scroll_into_view_if_needed()
            settle(page)
            rest = el.evaluate(STYLE)
            settle(page, el)
            hov = el.evaluate(STYLE)
            rest_rgb, hov_rgb = page.evaluate(PAINT, [rail_bg, [rest["bg"], hov["bg"]]])
            words, weakest = el.evaluate(WORDS, opaque(hov_rgb))
            row = {"rest": rest["bg"], "hover": hov["bg"], "dE": de(rest_rgb, hov_rgb), "words": words, "weakest": weakest,
                   "ink": hov["color"]}
            ok = row["dE"] >= (MIN_DE_CURRENT if kind == "current" else MIN_DE) and words >= MIN_TEXT
            if kind != "nc":
                ok = ok and hov["color"] == ink_high
            if kind == "button":
                row["edge_dE"] = de(base, page.evaluate(PAINT, [rail_bg, [hov["border"]]])[0])
                ok = ok and hov["borderW"] != "0px" and row["edge_dE"] >= MIN_EDGE_DE
            if kind == "ring":
                ring = page.evaluate(RING, hov["shadow"])
                row["ring"] = ring
                row["edge_dE"] = de(base, page.evaluate(PAINT, [rail_bg, [ring]])[0]) if ring else 0
                ok = ok and row["edge_dE"] >= MIN_EDGE_DE
            row["ok"] = ok
            rows[name] = row
        # Pressed (held down, released off the rail so nothing navigates): a stronger fill than hover,
        # its words still AA — a sidebar page item, and Home (current on the Desk).
        for name, sel in (("pressed-link", '[data-testid="nav-jobs"]'), ("pressed-wordmark", '[data-testid="desk-rail-wordmark"]')):
            el = page.locator(sel).first
            settle(page, el)
            hov_rgb = page.evaluate(PAINT, [rail_bg, [el.evaluate(STYLE)["bg"]]])[0]
            page.mouse.down()
            page.wait_for_timeout(320)
            press_rgb = page.evaluate(PAINT, [rail_bg, [el.evaluate(STYLE)["bg"]]])[0]
            words, weakest = el.evaluate(WORDS, opaque(press_rgb))
            page.mouse.move(*PARK)
            page.mouse.up()
            press = {"hover_dE": de(base, hov_rgb), "press_dE": de(base, press_rgb), "words": words, "weakest": weakest}
            press["ok"] = press["press_dE"] > press["hover_dE"] + 0.02 and words >= MIN_TEXT
            rows[name] = press
        # Build & settings while it is the current page: hovering its wash still shows.
        page.get_by_test_id("desk-rail-build").click()
        page.wait_for_function("() => window.location.pathname === '/build'", timeout=5000)
        gen = page.get_by_test_id("desk-rail-build")
        settle(page)
        rest = gen.evaluate(STYLE)
        settle(page, gen)
        hov = gen.evaluate(STYLE)
        r_rgb, h_rgb = page.evaluate(PAINT, [rail_bg, [rest["bg"], hov["bg"]]])
        words, weakest = gen.evaluate(WORDS, opaque(h_rgb))
        cur = {"dE": de(r_rgb, h_rgb), "words": words}
        cur["ok"] = cur["dE"] >= MIN_DE_CURRENT and words >= MIN_TEXT
        rows["build-current"] = cur
        if not case.endswith("-custom"):
            # The evidence shot: a session row hovered.
            page.goto(f"{origin}/", wait_until="networkidle")
            page.locator('[data-testid="rail-session"]').first.wait_for(state="visible", timeout=10000)
            settle(page, page.locator('[data-testid="rail-session"]:not([aria-current="page"])').first)
            page.screenshot(path=str(SHOTS / f"rail-hover-{case}.png"))
        ctx.close()
        results[case] = rows
        check(f"visible:{case}", all(r["ok"] for r in rows.values()), rail=rail_bg, items=rows)

    # Reduced motion: no lift under reduce; a 1 px lift without it.
    lifts = {}
    for motion in ("reduce", "no-preference"):
        ctx = browser.new_context(viewport={"width": W, "height": H}, reduced_motion=motion)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        set_fixture(origin, appearance=None)
        page.goto(f"{origin}/", wait_until="networkidle")
        btn = page.get_by_test_id("desk-rail-new-job")
        btn.wait_for(state="visible", timeout=15000)
        settle(page, btn)
        lifts[motion] = btn.evaluate("e => getComputedStyle(e).transform")
        ctx.close()
    check("reduced-motion", lifts["reduce"] == "none" and lifts["no-preference"] not in ("none", ""), **lifts)
    browser.close()

set_fixture(origin, appearance=None, project_dto=False)
check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
