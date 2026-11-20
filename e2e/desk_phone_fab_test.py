#!/usr/bin/env python3
"""The phone Ask bubble leaves page endings usable, in both Wicked themes."""

import json
import os

from uxfix_fixture import DEFAULT_APPEARANCE, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4393"))
SHOTS = REPO / "e2e" / "shots"
report = {"ok": False, "steps": {}}


def check(name, ok, **detail):
    report["steps"][name] = {"ok": bool(ok), **detail}
    if not ok:
        raise AssertionError(json.dumps(report, indent=2))


def page_end(page, root, name, theme):
    """End every page scroller, including wrappers above the page's own root."""
    root.evaluate("""root => {
      const nodes = [...root.querySelectorAll('*'), root];
      for (let p = root.parentElement; p && p.id !== 'main'; p = p.parentElement) nodes.push(p);
      for (const el of nodes) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
      }
    }""")
    # Let scroll events and the browser's layout settle before measuring the ending.
    page.wait_for_timeout(200)
    bubble = page.get_by_test_id("ask-launcher")
    bubble.wait_for(state="visible")
    box = bubble.bounding_box()
    last = root.evaluate("""root => {
      const shown = el => {
        for (let p = el; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden' || p.hidden) return false;
        }
        return true;
      };
      const ends = [...root.querySelectorAll('p, button, input, select, a, h1, h2, h3, li')]
        .filter(shown).map(el => {
          const r = el.getBoundingClientRect();
          return { text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 100),
            x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
        }).filter(r => r.width > 0 && r.height > 0);
      ends.sort((a, b) => b.bottom - a.bottom || b.width - a.width);
      return ends[0] || null;
    }""")
    page.screenshot(path=str(SHOTS / f"phone-fab-{name}-{theme}.png"))
    check(f"{theme}:{name}:ending-visible", last is not None and last["y"] >= 0
          and last["bottom"] <= 844, last=last)
    intersects = (last["x"] < box["x"] + box["width"] and last["x"] + last["width"] > box["x"]
                  and last["y"] < box["y"] + box["height"] and last["bottom"] > box["y"])
    check(f"{theme}:{name}:clear-of-bubble", not intersects, last=last, bubble=box)
    # studio#1071: the shell reserves the bubble's band, so every page scroller ends above the bubble, whatever its
    # content (a short page's last line is clear by luck; this is what keeps a long one clear).
    area = page.evaluate("""() => {
      const main = document.getElementById('main');
      return main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom);
    }""")
    check(f"{theme}:{name}:scroll-area-ends-above-bubble", area <= box["y"], area=area, bubble=box)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
SHOTS.mkdir(parents=True, exist_ok=True)

from playwright.sync_api import sync_playwright  # noqa: E402

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for theme in ("wicked-dark", "wicked-light"):
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1,
                                  is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        set_fixture(origin, wave1=True, repo=False, repo_refs=False, project_dto=True,
                    appearance={**DEFAULT_APPEARANCE, "theme": theme})

        page.goto(f"{origin}/repos/new", wait_until="networkidle")
        form = page.get_by_test_id("repo-register")
        form.wait_for(state="visible")
        page.wait_for_function("t => document.documentElement.dataset.theme === t", arg=theme)
        page_end(page, form, "add-repository", theme)

        page.goto(f"{origin}/projects/default", wait_until="networkidle")
        project = page.get_by_test_id("project-home")
        project.wait_for(state="visible")
        page.get_by_test_id("project-home-loading").wait_for(state="hidden")
        page_end(page, project, "project", theme)

        page.goto(f"{origin}/?tab=work", wait_until="networkidle")
        desk = page.get_by_test_id("desk")
        desk.wait_for(state="visible")
        page_end(page, desk, "desk", theme)
        ctx.close()
    browser.close()

check("no-page-errors", not errors, errors=errors)
report["ok"] = True
print(json.dumps(report, indent=2))
