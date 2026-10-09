#!/usr/bin/env python3
"""
main_scroll_test.py — the main pane scrolls; nothing on a top-level page sits clipped below the fold
(1440x700).

  home     Home at 1440x700 with the home-runs corpus (a full Needs You queue, the portfolio wall, the
           Unfiled runs shelf last): the page's own content is taller than the pane. Scrolling with the
           mouse wheel alone (no scripted scrollTop) brings the LAST Home section fully into view, above
           the status bar and unobscured — and the left sidebar and the status bar stay where they were.
  pages    every other top-level page, and a run page paused at a tall gate card: no pane at least 40% of
           the viewport tall hides content behind `overflow: hidden` (the clipping class the Home bug
           was) — a pane taller than its box must be one the user can scroll.

On the Desk (the one shell since S18d) Home is the Desk: its own
scroller must bring the last block of its list column fully into view above the Start row + composer
band by the wheel alone, and the session rail and that band stay where they were. "pages" is the same.

Captures (e2e/shots/): main-scroll-desk-home-top.png, main-scroll-desk-home-bottom.png.
Env: FEEDBACK_PORT (default 4499). JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4499"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


CORPUS = {"home_runs": True, "trust_rules": True, "project_dto": True, "reset_home_runs": True,
          "gate_move": True, "repo": True, "appearance": {**DEFAULT_APPEARANCE}}

# Every top-level page the rail and the palette reach, plus a run paused at a tall gate card.
PAGES = ["/work", "/execute", "/vibe", "/demo", "/projects", "/chats", "/repos", "/skills",
         "/steering/dashboard", "/testing/evals", "/testing/campaigns", "/system", "/theme", "/workflows",
         "/runs/new", "/runs/r-review"]

# The clipping class: a big pane whose content is taller than its box behind overflow hidden/clip.
CLIPPED_PANES = """() => {
  const out = [];
  for (const el of [document.getElementById('main'), ...document.querySelectorAll('#main *')]) {
    if (!el) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'hidden' && oy !== 'clip') continue;
    const r = el.getBoundingClientRect();
    if (r.height < innerHeight * 0.4) continue;
    if (el.scrollHeight > el.clientHeight + 4) {
      out.push({ testid: el.dataset.testid || null, cls: String(el.className).slice(0, 80),
                 height: Math.round(r.height), content: el.scrollHeight });
    }
  }
  return out;
}"""

# Where the last Home section is, whether it is fully inside the visible band (above the status bar)
# and whether the topmost element at its centre belongs to it.
LAST_SECTION = """() => {
  const board = document.querySelector('[data-testid="project-board"]');
  if (!board) return null;
  const sections = board.querySelectorAll(':scope > section');
  const last = sections.length ? sections[sections.length - 1] : board;
  const r = last.getBoundingClientRect();
  const bar = document.querySelector('[data-testid="runs-bottom-bar"]');
  const floor = bar ? bar.getBoundingClientRect().top : innerHeight;
  const cx = r.left + Math.min(r.width / 2, 120), cy = r.top + Math.min(r.height / 2, 12);
  const hit = document.elementFromPoint(cx, cy);
  return { testid: last.dataset.testid || null, top: Math.round(r.top), bottom: Math.round(r.bottom),
           floor: Math.round(floor), inView: r.top >= 0 && r.bottom <= floor + 1,
           unobscured: !!hit && last.contains(hit) };
}"""

# The Desk (the one shell since S18d): its own scroller holds the list and the chores; the
# floor is the Start row + composer band, which never scrolls.
DESK_LAST_SECTION = """() => {
  const main = document.querySelector('[data-place-scroll="desk"] .wk-desk-main');
  if (!main) return null;
  const last = main.lastElementChild || main;
  const r = last.getBoundingClientRect();
  const bar = document.querySelector('.wk-desk-bottom');
  const floor = bar ? bar.getBoundingClientRect().top : innerHeight;
  const cx = r.left + Math.min(r.width / 2, 120), cy = r.top + Math.min(r.height / 2, 12);
  const hit = document.elementFromPoint(cx, cy);
  return { testid: last.dataset.testid || null, top: Math.round(r.top), bottom: Math.round(r.bottom),
           floor: Math.round(floor), inView: r.top >= 0 && r.bottom <= floor + 1,
           unobscured: !!hit && last.contains(hit) };
}"""

DESK_CHROME = """() => {
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
  return { sidebar: rect('[data-testid="session-rail"]'), main: rect('#main'), bar: rect('.wk-desk-bottom') };
}"""

CHROME = """() => {
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; };
  return { sidebar: rect('[data-testid="rail-heading-projects"]'), main: rect('#main'), bar: rect('[data-testid="runs-bottom-bar"]') };
}"""


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    last_section = DESK_LAST_SECTION
    chrome = DESK_CHROME

    def section_home() -> None:
        set_fixture(origin, **CORPUS)
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("desk").wait_for(state="attached")
        page.wait_for_timeout(600)
        start = page.evaluate(last_section)
        check("home-last-section-starts-below-fold", start is not None and not start["inView"], start=start)
        chrome_before = page.evaluate(chrome)
        page.screenshot(path=str(SHOTS / f"main-scroll-desk-home-top.png"))
        # The wheel only — the user's move. Parked over the Home header's empty stretch, which is no
        # nested scroller, so a pane that cannot scroll simply does not move.
        header = page.locator("#main header").first.bounding_box()  # the Desk's greeting under desk
        page.mouse.move(header["x"] + header["width"] * 0.6, header["y"] + header["height"] / 2)
        last = start
        for _ in range(30):
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(90)
            last = page.evaluate(last_section)
            if last["inView"] and last["unobscured"]:
                break
        page.screenshot(path=str(SHOTS / f"main-scroll-desk-home-bottom.png"))
        check("home-last-section-scrolls-into-view", last["inView"] and last["unobscured"], last=last)
        chrome_after = page.evaluate(chrome)
        check("home-sidebar-and-status-bar-stay-fixed", chrome_after == chrome_before,
              before=chrome_before, after=chrome_after)
        clipped = page.evaluate(CLIPPED_PANES)
        check("home-no-clipped-pane", clipped == [], clipped=clipped)

    def section_pages() -> None:
        set_fixture(origin, **CORPUS)
        bad = {}
        for path in PAGES:
            page.goto(f"{origin}{path}", wait_until="networkidle")
            page.wait_for_timeout(700)
            clipped = page.evaluate(CLIPPED_PANES)
            if clipped:
                bad[path] = clipped
        check("pages-no-clipped-pane", bad == {}, clipped=bad)

    ok = True
    for section in (section_home, section_pages):
        try:
            section()
        except SectionFailed:
            ok = False
        except Exception as e:  # noqa: BLE001 — reported as the section's failure
            report["steps"][section.__name__] = {"ok": False, "error": repr(e)[:600]}
            ok = False
    browser.close()

report["ok"] = ok
print(json.dumps(report, indent=2))
sys.exit(0 if ok else 1)
