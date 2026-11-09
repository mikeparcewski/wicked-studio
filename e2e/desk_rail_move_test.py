#!/usr/bin/env python3
"""
desk_rail_move_test.py — crew-0182 (studio 0.16.2): the rail's "Move to project" picker stays open.

On the desktop rail the trigger floated over the row with `transform: translateY(-50%)`. A transformed ancestor is the
containing block of a `position: fixed` box, so the picker's viewport placement (studio#723) landed inside the rail's
scroller; focusing its first item scrolled the scroller, and the picker's own scroll listener closed it ~14 ms after
the click (the operator: "clicking does nothing").

At 1440x700 (the rail) and 390x844 (the drawer), against the in-process fixture:
  1. expand Recent, hover a run row, click its Move to project icon;
  2. 300 ms later the picker is still open (aria-expanded=true), sits inside the viewport, and the element at its
     centre is inside the picker (nothing covers it);
  3. readable in both themes (the theme set BEFORE the page loads, then 600 ms for the colour transitions): every text
     of the open picker and of the rail's links and run rows is >= 4.5:1 on what it sits on (WCAG AA, measured from the
     computed colours, opacity and alpha included);
  4. crew-0183 (operator: it STILL closed at once on the one "Not in a project" row): the rail's scroller overflowing
     (scrollHeight > clientHeight), the LAST row of the last group scrolled so it sits on the scroller's bottom edge.
     A plain focus of the picker's first item scrolled the scroller and the picker's scroll listener closed it 14 ms
     later. Click: 300 ms later it is still open and the scroller has not moved; Tab and Shift+Tab move between its
     items without scrolling the rail or closing it. (The move itself, and the only member of "Not in a project",
     run on a real daemon: the fixture keeps no membership writes.)
  5. 0 page errors.

Captures: e2e/shots/desk-rail-move-<w>x<h>-<theme>.png (light and dark). Env: FEEDBACK_PORT (default 4497).
JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4497"))
SHOTS = REPO / "e2e" / "shots"

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


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

# WCAG contrast of every visible text under `root` against the first opaque background behind it: the text colour's
# alpha and every ancestor's opacity up to that background blend it toward the background first.
CONTRAST = """(root) => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!own || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const fg = parse(getComputedStyle(el).color);
    let alpha = fg[3]; let bg = null;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c[3] >= 0.99) { bg = c; break; }
      alpha *= Number(cs.opacity);
    }
    bg = bg ?? [255, 255, 255, 1];
    const shown = [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
    const a = lum(shown), b = lum(bg);
    out.push({ text: el.textContent.trim().slice(0, 32), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 });
  }
  return out;
}"""

IN_PICKER = """([x, y]) => { const el = document.elementFromPoint(x, y);
  return !!el && !!el.closest('[data-testid="session-move-picker"]'); }"""


def open_picker(page, w: int, h: int) -> None:
    page.goto(f"{origin}/", wait_until="networkidle")
    if w < 768:
        page.get_by_test_id("rail-drawer-toggle").click()
    rail = page.get_by_test_id("session-rail")
    rail.wait_for(state="visible", timeout=15000)
    rows = rail.locator(".wk-rail-session-row")
    if rows.count() == 0:
        rail.get_by_role("button", name="Recent").first.click()
    try:
        rows.first.wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        fail(f"rows-{w}", f"no run row in the rail: {e}")
    row = rows.first
    row.hover()
    trigger = row.get_by_test_id("session-move")
    trigger.click()
    page.wait_for_timeout(300)
    picker = page.get_by_test_id("session-move-picker")
    expanded = trigger.get_attribute("aria-expanded")
    check(f"open-after-300ms-{w}", picker.count() == 1 and expanded == "true", expanded=expanded, pickers=picker.count())
    box = picker.bounding_box()
    inside = box is not None and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w and box["y"] + box["height"] <= h
    check(f"in-viewport-{w}", inside, box=box)
    hit = page.evaluate(IN_PICKER, [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
    check(f"centre-hits-picker-{w}", hit)


EDGE = """() => {
  const rows = [...document.querySelectorAll('[data-testid="session-rail"] .wk-rail-session-row')];
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  // The row's own scroller: the desktop rail's `.wk-rail-groups`, the phone drawer's panel.
  let sc = last.parentElement;
  while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  if (!sc) return null;
  document.querySelectorAll('[data-e2e-scroller]').forEach((e) => e.removeAttribute('data-e2e-scroller'));
  sc.setAttribute('data-e2e-scroller', '1');
  // Room above the rows (the fixture's rows alone may fit), then the row scrolled down onto the scroller's bottom edge
  // (or the screen's, when the scroller runs past it): where the operator's one "Not in a project" row sat.
  const pad = document.createElement('div'); pad.dataset.e2ePad = '1'; pad.style.height = `${sc.clientHeight}px`; pad.style.flex = "0 0 auto";
  sc.insertBefore(pad, sc.firstChild);
  sc.scrollTop = sc.scrollHeight;
  const edge = () => Math.min(sc.getBoundingClientRect().bottom, innerHeight);
  sc.scrollTop -= edge() - last.getBoundingClientRect().bottom;
  const s = sc.getBoundingClientRect(), r = last.getBoundingClientRect();
  last.setAttribute('data-e2e-edge', '1');
  return { scroller: sc.className, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, scrollTop: sc.scrollTop,
    rowBottom: Math.round(r.bottom), scrollerBottom: Math.round(Math.min(s.bottom, innerHeight)) };
}"""


def edge_row_stays_open(page, w: int, h: int) -> None:
    """The bottom-edge row of an overflowing rail: the picker opens and stays open, and Tab never scrolls the rail."""
    page.goto(f"{origin}/", wait_until="networkidle")
    if w < 768:
        page.get_by_test_id("rail-drawer-toggle").click()
    rail = page.get_by_test_id("session-rail")
    rail.wait_for(state="visible", timeout=15000)
    rows = rail.locator(".wk-rail-session-row")
    if rows.count() == 0:
        rail.get_by_role("button", name="Recent").first.click()
    rows.first.wait_for(state="visible", timeout=15000)
    geo = page.evaluate(EDGE)
    check(f"edge-overflowing-{w}", geo is not None and geo["scrollHeight"] > geo["clientHeight"]
          and geo["scrollTop"] > 0 and abs(geo["scrollerBottom"] - geo["rowBottom"]) <= 2, geo=geo)
    row = page.locator('[data-e2e-edge="1"]')
    row.hover()
    trigger = row.get_by_test_id("session-move")
    top0 = page.evaluate("document.querySelector('[data-e2e-scroller]').scrollTop")
    trigger.click()
    page.wait_for_timeout(300)
    picker = page.get_by_test_id("session-move-picker")
    top1 = page.evaluate("document.querySelector('[data-e2e-scroller]').scrollTop")
    check(f"edge-open-after-300ms-{w}", picker.count() == 1 and trigger.get_attribute("aria-expanded") == "true" and top1 == top0,
          pickers=picker.count(), scrollTop=[top0, top1])
    for key in ("Tab", "Tab", "Shift+Tab"):
        page.keyboard.press(key)
        page.wait_for_timeout(150)
    top2 = page.evaluate("document.querySelector('[data-e2e-scroller]').scrollTop")
    focus_in = page.evaluate("() => !!document.activeElement?.closest('[data-testid=\"session-move-picker\"]')")
    check(f"edge-tab-stays-open-{w}", picker.count() == 1 and top2 == top0 and focus_in, scrollTop=[top0, top2], focusIn=focus_in)


def readable(page, w: int, theme: str) -> None:
    """Every picker and rail text >= 4.5:1, with the numbers in the report."""
    for part, sel in (("picker", '[data-testid="session-move-picker"]'), ("rail", '[data-testid="session-rail"]')):
        rows = page.locator(sel).first.evaluate(CONTRAST)
        low = [r for r in rows if r["ratio"] < 4.5]
        ratios = sorted(r["ratio"] for r in rows)
        check(f"contrast-{part}-{w}-{theme}", bool(rows) and not low, texts=len(rows), lowest=ratios[:3], low=low[:5])


with sync_playwright() as p:
    browser = p.chromium.launch()
    for (w, h) in ((1440, 700), (390, 844)):
        for theme in ("light", "dark"):
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(
                "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
                f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
            # The theme is the stored setting before the page loads (never switched under a running transition).
            set_fixture(origin, repo=True, sessions=True, appearance={"theme": f"wicked-{theme}"})
            edge_row_stays_open(page, w, h)
            page.wait_for_timeout(600)  # every colour transition (140 ms) has ended
            page.screenshot(path=str(SHOTS / f"desk-rail-move-edge-{w}x{h}-{theme}.png"))
            open_picker(page, w, h)
            page.wait_for_timeout(600)  # every colour transition (140 ms) has ended
            check(f"theme-{w}-{theme}", page.evaluate("document.documentElement.getAttribute('data-theme')") == f"wicked-{theme}")
            readable(page, w, theme)
            page.screenshot(path=str(SHOTS / f"desk-rail-move-{w}x{h}-{theme}.png"))
            page.close()
    set_fixture(origin, appearance=None)
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
