#!/usr/bin/env python3
"""
desk_rail_hover_test.py — CAN A PERSON SEE THE RAIL'S HOVER? (operator 2026-10-26: "no hovers on the
buttons"). The first hover pass tinted items one surface step up (--surface-card), which on the rail's
own ground measured dE_OK 0.03 (dark) to 0.06 (wicked-dark) and looked the same as rest. This journey
measures what the eye gets, in a real browser at 1440x700, in every shipped theme (wicked-dark,
wicked-light, dark, light; each chosen the way the app stores it, with the accent that theme writes).

For every interactive rail item type — the wordmark, an icon button (New job), a group icon, a group
header, a session row, "Show N more", a Workspace link, Settings (General) and the Nerve Center tile:

  1. VISIBLE: the hover fill, composited over the rail's own background by the browser (a 1x1 canvas),
     sits dE_OK >= 0.08 (OKLab distance) from the rest fill. The current page's hover (the wordmark on
     the Desk, General on /system) moves >= 0.06 from its wash.
  2. READABLE: the hovered words keep >= 4.5:1 on the hover fill; every item but the Nerve Center tile
     (its own ink) goes to full ink (--ink-high).
  3. THE ICON BUTTONS draw an accent edge on hover: the button's border (the group icon: its inset ring)
     sits dE_OK >= 0.10 from the rail.
  4. PRESSED is a stronger fill than hover (further from the rail).
  5. REDUCED MOTION: a hovered icon button does not move (transform none); with motion it lifts.
  6. 0 page errors.

Captures: e2e/shots/rail-hover-<theme>.png (the rail with a session row hovered).
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


def contrast(a, b) -> float:
    la, lb = (0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) for c in (a, b))
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


THEMES = {
    "wicked-dark": {"theme": "wicked-dark", "accent_h": 200, "accent_s": 47, "accent_l": 25},
    "wicked-light": {"theme": "wicked-light", "accent_h": 200, "accent_s": 47, "accent_l": 25},
    "dark": {"theme": "dark", "accent_h": 230, "accent_s": 74, "accent_l": 68},
    "light": {"theme": "light", "accent_h": 230, "accent_s": 74, "accent_l": 68},
}
# (name, selector, kind): kind "button" = an icon button (accent edge), "nc" = the Nerve Center tile.
ITEMS = [
    ("wordmark", '[data-testid="desk-rail-home"]', "current"),
    ("icon-button", '[data-testid="desk-rail-new-job"]', "button"),
    ("group-icon", '[data-testid="rail-group-new"], [data-testid="rail-group-view-unfiled"]', "ring"),
    ("group-header", '[data-testid="rail-group-toggle"]', "row"),
    ("session", '[data-testid="rail-session"]:not([aria-current="page"])', "row"),
    ("show-more", '[data-testid="rail-group-more"]', "row"),
    ("workspace-link", '[data-testid="desk-rail-skills"]', "row"),
    ("settings", '[data-testid="desk-rail-general"]', "row"),
    ("nerve-center", '[data-testid="desk-rail-nerve"]', "nc"),
]

# The browser composites each computed colour over the rail's background in a 1x1 canvas.
PAINT = """([under, fills]) => { const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  return fills.map(f => { x.clearRect(0, 0, 1, 1); x.fillStyle = under; x.fillRect(0, 0, 1, 1);
    x.fillStyle = f; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); }); }"""
STYLE = """e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color,
  border: s.borderTopColor, borderW: s.borderTopWidth, shadow: s.boxShadow, transform: s.transform }; }"""
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
    for theme, appearance in THEMES.items():
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
        want = None if theme == "dark" else theme
        page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=want, timeout=10000)
        page.locator('[data-testid="rail-session"]').first.wait_for(state="visible", timeout=10000)
        rail_bg = page.get_by_test_id("session-rail").evaluate("e => getComputedStyle(e).backgroundColor")
        ink_high = page.evaluate(INK_HIGH)
        rows: dict = {}
        for name, sel, kind in ITEMS:
            el = page.locator(sel).first
            if el.count() == 0:
                fail(f"{theme}:{name}", f"no {sel} in the rail")
            el.scroll_into_view_if_needed()
            settle(page)
            rest = el.evaluate(STYLE)
            settle(page, el)
            hov = el.evaluate(STYLE)
            rest_rgb, hov_rgb, ink_rgb = page.evaluate(PAINT, [rail_bg, [rest["bg"], hov["bg"], hov["color"]]])
            row = {"rest": rest["bg"], "hover": hov["bg"], "dE": de(rest_rgb, hov_rgb), "text": contrast(ink_rgb, hov_rgb),
                   "ink": hov["color"]}
            ok = row["dE"] >= (MIN_DE_CURRENT if kind == "current" else MIN_DE) and row["text"] >= MIN_TEXT
            if kind != "nc":
                ok = ok and hov["color"] == ink_high
            if kind == "button":
                edge = page.evaluate(PAINT, [rail_bg, [hov["border"]]])[0]
                row["edge_dE"] = de(page.evaluate(PAINT, [rail_bg, [rail_bg]])[0], edge)
                ok = ok and hov["borderW"] != "0px" and row["edge_dE"] >= MIN_EDGE_DE
            if kind == "ring":
                ring = page.evaluate(RING, hov["shadow"])
                row["ring"] = ring
                row["edge_dE"] = de(page.evaluate(PAINT, [rail_bg, [rail_bg]])[0], page.evaluate(PAINT, [rail_bg, [ring]])[0]) if ring else 0
                ok = ok and row["edge_dE"] >= MIN_EDGE_DE
            row["ok"] = ok
            rows[name] = row
        # Settings while it is the current page: hovering its wash still shows.
        page.get_by_test_id("desk-rail-general").click()
        page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
        gen = page.get_by_test_id("desk-rail-general")
        settle(page)
        rest = gen.evaluate(STYLE)
        settle(page, gen)
        hov = gen.evaluate(STYLE)
        r_rgb, h_rgb, i_rgb = page.evaluate(PAINT, [rail_bg, [rest["bg"], hov["bg"], hov["color"]]])
        cur = {"dE": de(r_rgb, h_rgb), "text": contrast(i_rgb, h_rgb)}
        cur["ok"] = cur["dE"] >= MIN_DE_CURRENT and cur["text"] >= MIN_TEXT
        rows["settings-current"] = cur
        # Pressed: a stronger fill than hover (held with the button down, released off the rail).
        link = page.get_by_test_id("desk-rail-skills")
        settle(page, link)
        hov_rgb = page.evaluate(PAINT, [rail_bg, [link.evaluate(STYLE)["bg"]]])[0]
        page.mouse.down()
        page.wait_for_timeout(320)
        press_rgb = page.evaluate(PAINT, [rail_bg, [link.evaluate(STYLE)["bg"]]])[0]
        page.mouse.move(*PARK)
        page.mouse.up()
        base = page.evaluate(PAINT, [rail_bg, [rail_bg]])[0]
        press = {"hover_dE": de(base, hov_rgb), "press_dE": de(base, press_rgb)}
        press["ok"] = press["press_dE"] > press["hover_dE"] + 0.02
        rows["pressed"] = press
        # The evidence shot: a session row hovered.
        page.goto(f"{origin}/", wait_until="networkidle")
        page.locator('[data-testid="rail-session"]').first.wait_for(state="visible", timeout=10000)
        settle(page, page.locator('[data-testid="rail-session"]:not([aria-current="page"])').first)
        page.screenshot(path=str(SHOTS / f"rail-hover-{theme}.png"))
        ctx.close()
        results[theme] = rows
        check(f"visible:{theme}", all(r["ok"] for r in rows.values()), rail=rail_bg, items=rows)

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
