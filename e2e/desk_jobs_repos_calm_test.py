#!/usr/bin/env python3
"""
desk_jobs_repos_calm_test.py — ARE JOBS AND REPOSITORIES CALM? (operator 2026-10-26, on the pages mockup:
"needs more whitespace — easy to scan — think humans, we get overwhelmed easy"). In a real browser, in every
shipped theme (wicked-dark, wicked-light, dark, light), on the in-process fixture:

  1. THE PATTERN: one centred column no wider than ~860 px; a 32 px title; one sentence of live state; one
     primary action (New job / Add repository); at most one filter on the face (Jobs: Active / Finished);
     rows at least 64 px tall, each with a status dot, a title, one muted line and (Jobs) one status word.
  2. NO IDS ON THE FACE: no run id, uuid or path in a row's visible words.
  3. DETAILS ON CLICK: a job row is a link to its run; a repository row opens its details (aria-expanded)
     with Open, Capture learnings and Re-index/Onboard in them.
  4. VISIBLE HOVER: every row, the primary action, the filter's other option and the Search-and-filter
     button move dE_OK >= 0.08 (OKLab) from rest when hovered, composited over the page by the browser.
  5. VISIBLE FOCUS: a row reached by keyboard wears the focus ring (a box-shadow).
  6. A PHONE (390x844): neither page scrolls sideways.
  7. 0 page errors.

Captures: e2e/shots/jobs-repos-{jobs,repos}-<theme>.png (1440x700) and -phone (390x844, wicked-dark).
Env: FEEDBACK_PORT (default 4393). Prints a JSON report; exit 0/1.
"""

import json
import math
import os
import re
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4393"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
MIN_DE = 0.08
MAX_COL = 860
MIN_ROW = 64
THEMES = [("wicked-dark", "wicked-dark"), ("wicked-light", "wicked-light"), ("dark", None), ("light", "light")]
FACE_IDS = re.compile(r"run:|[0-9a-f]{8}-[0-9a-f]{4}-|(?:^|\s)/\w+/\w+")  # a run id, a uuid, an absolute path

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


# The first opaque background under an element (its ancestors'), then each fill composited over it in a 1x1 canvas.
GROUND = """e => { for (let a = e.parentElement; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor;
  if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return getComputedStyle(document.body).backgroundColor; }"""
PAINT = """([under, fills]) => { const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  return fills.map(f => { x.clearRect(0, 0, 1, 1); x.fillStyle = under; x.fillRect(0, 0, 1, 1);
    x.fillStyle = f; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); }); }"""
BG = "e => getComputedStyle(e).backgroundColor"

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
PARK = (W - 40, H - 40)


def hover_de(page, el, target=None) -> float:
    """rest -> hover distance of `target`'s fill (default: el) while the pointer is on `el`."""
    target = target or el
    page.mouse.move(*PARK)
    page.wait_for_timeout(260)
    ground = target.evaluate(GROUND)
    rest = target.evaluate(BG)
    el.hover()
    page.wait_for_timeout(260)
    hov = target.evaluate(BG)
    page.mouse.move(*PARK)
    a, b = page.evaluate(PAINT, [ground, [rest, hov]])
    return de(a, b)


def shape(page, root: str, title: str) -> dict:
    return page.evaluate("""([root, title]) => { const r = document.querySelector(root);
      const col = r.querySelector('.wk-jr-col'); const h = [...r.querySelectorAll('h1, h2')].find(x => x.textContent.trim() === title);
      return { col: col ? col.getBoundingClientRect().width : 0, title: h ? getComputedStyle(h).fontSize : null,
        sentence: (r.querySelector('.wk-jr-sentence') || {}).textContent || '',
        visibleFilters: [...r.querySelectorAll('[role="radiogroup"]')].filter(g => g.offsetParent !== null).length,
        primary: [...r.querySelectorAll('.wk-jr-head .wk-jr-btn--primary')].filter(b => b.offsetParent !== null).length }; }""", [root, title])


def rows_of(page, sel: str) -> list:
    return page.evaluate("""sel => [...document.querySelectorAll(sel)].filter(r => r.offsetParent !== null).map(r => {
      const row = r.querySelector('.wk-jr-row'); return { h: row ? row.getBoundingClientRect().height : 0,
        dot: !!r.querySelector('.wk-jr-dot'), title: (r.querySelector('.wk-jr-row-title') || {}).textContent || '',
        sub: (r.querySelector('.wk-jr-row-sub') || {}).textContent || '', text: row ? row.innerText : '' }; })""", sel)


def focus_ring(page, sel: str) -> str:
    page.keyboard.press("Tab")  # a keyboard interaction first, so a programmatic focus is focus-visible
    page.locator(sel).first.evaluate("e => e.focus()")
    page.wait_for_timeout(200)
    return page.locator(sel).first.evaluate("e => e.matches(':focus-visible') ? getComputedStyle(e).boxShadow : 'not focus-visible'")


def overflow(page) -> int:
    return page.evaluate("() => Math.max(...[document.scrollingElement, ...document.querySelectorAll('.wk-desk2-scroll, .h-full.overflow-y-auto')]"
                         ".filter(Boolean).map(e => e.scrollWidth - e.clientWidth))")


with sync_playwright() as p:
    browser = p.chromium.launch()
    for theme, want in THEMES:
        ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
        set_fixture(origin, wave1=True, repo=True, repo_refs=True, appearance={**DEFAULT_APPEARANCE, "theme": theme})

        # ── Jobs ──
        page.goto(f"{origin}/?tab=runs", wait_until="networkidle")
        page.get_by_test_id("desk-runs").wait_for(state="visible", timeout=15000)
        page.wait_for_function("t => (document.documentElement.getAttribute('data-theme') || null) === t", arg=want, timeout=10000)
        page.locator('[data-testid="desk-runs-row"], [data-testid="desk-runs-empty"]').first.wait_for(state="visible", timeout=10000)
        if page.get_by_test_id("desk-runs-row").count() == 0:
            page.get_by_test_id("desk-runs-group-finished").click()
            page.get_by_test_id("desk-runs-row").first.wait_for(state="visible", timeout=5000)
        s = shape(page, '[data-testid="desk-runs"]', "Jobs")
        rows = rows_of(page, '[data-testid="desk-runs-row"]')
        words = page.get_by_test_id("desk-runs-word").all_inner_texts()
        check(f"{theme}:jobs-pattern", 600 <= s["col"] <= MAX_COL and s["title"] == "32px" and s["sentence"] != ""
              and s["visibleFilters"] == 1 and s["primary"] == 1 and len(rows) > 0
              and all(r["h"] >= MIN_ROW and r["dot"] and r["title"] and r["sub"] for r in rows)
              and all(w in ("Working", "Waiting on you", "Needs a decision", "Finished", "Answered", "Failed", "Stopped", "Unknown") for w in words),
              shape=s, rows=rows[:3], words=words[:6])
        check(f"{theme}:jobs-no-ids", not any(FACE_IDS.search(r["text"]) for r in rows), faces=[r["text"] for r in rows][:6])
        row = page.get_by_test_id("desk-runs-row").first
        href = row.get_by_test_id("desk-runs-open").get_attribute("href") or ""
        other = page.locator('[data-testid="desk-runs-group"] [aria-checked="false"]').first
        de_rows = hover_de(page, row)
        de_new = hover_de(page, page.get_by_test_id("desk-runs-new"))
        de_seg = hover_de(page, other)
        de_tools = hover_de(page, page.get_by_test_id("desk-runs-tools"))
        ring = focus_ring(page, '[data-testid="desk-runs-open"]')
        check(f"{theme}:jobs-hover-focus", min(de_rows, de_new, de_seg, de_tools) >= MIN_DE and ring not in ("none", "not focus-visible")
              and "/s" in href, row=de_rows, new_job=de_new, filter=de_seg, tools=de_tools, ring=ring, href=href)
        page.mouse.move(*PARK)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.screenshot(path=str(SHOTS / f"jobs-repos-jobs-{theme}.png"))

        # ── Repositories ──
        page.goto(f"{origin}/repos", wait_until="networkidle")
        page.get_by_test_id("repo-card").first.wait_for(state="visible", timeout=15000)
        s = shape(page, '[data-testid="repos-page"]', "Repositories")
        rows = rows_of(page, '[data-testid="repo-card"]')
        check(f"{theme}:repos-pattern", 600 <= s["col"] <= MAX_COL and s["title"] == "32px" and s["sentence"] != "" and s["primary"] == 1
              and s["visibleFilters"] == 0 and len(rows) > 0 and all(r["h"] >= MIN_ROW and r["dot"] and r["title"] and r["sub"] for r in rows),
              shape=s, rows=rows[:3])
        check(f"{theme}:repos-no-ids", not any(FACE_IDS.search(r["text"]) for r in rows), faces=[r["text"] for r in rows][:6])
        card = page.get_by_test_id("repo-card").first
        de_row = hover_de(page, card.get_by_test_id("repo-row"), card)
        de_add = hover_de(page, page.get_by_test_id("repos-add"))
        ring = focus_ring(page, '[data-testid="repo-row"]')
        page.mouse.move(*PARK)
        card.get_by_test_id("repo-row").click()
        details = card.get_by_test_id("repo-details")
        details.wait_for(state="visible", timeout=3000)
        acts = details.locator("button").all_inner_texts()
        check(f"{theme}:repos-hover-focus-details", min(de_row, de_add) >= MIN_DE and ring not in ("none", "not focus-visible")
              and card.get_by_test_id("repo-row").get_attribute("aria-expanded") == "true"
              and any(a.startswith("Open ") for a in acts) and any("Capture learnings" in a for a in acts)
              and any(a in ("Re-index…", "Onboard") for a in acts), row=de_row, add=de_add, ring=ring, actions=acts)
        card.get_by_test_id("repo-row").click()
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.screenshot(path=str(SHOTS / f"jobs-repos-repos-{theme}.png"))
        ctx.close()

    # ── A phone ──
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    set_fixture(origin, wave1=True, repo=True, repo_refs=True, appearance={**DEFAULT_APPEARANCE, "theme": "wicked-dark"})
    page.goto(f"{origin}/?tab=runs", wait_until="networkidle")
    page.get_by_test_id("desk-runs").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    jobs_over = overflow(page)
    page.screenshot(path=str(SHOTS / "jobs-repos-jobs-phone.png"))
    page.goto(f"{origin}/repos", wait_until="networkidle")
    page.get_by_test_id("repo-card").first.wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(300)
    repos_over = overflow(page)
    page.screenshot(path=str(SHOTS / "jobs-repos-repos-phone.png"))
    check("phone-no-sideways-scroll", jobs_over <= 1 and repos_over <= 1, jobs=jobs_over, repos=repos_over)
    ctx.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
