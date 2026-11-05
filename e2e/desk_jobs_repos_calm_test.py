#!/usr/bin/env python3
"""
desk_jobs_repos_calm_test.py — ARE JOBS AND REPOSITORIES CALM? (operator 2026-10-26, on the pages mockup:
"needs more whitespace — easy to scan — think humans, we get overwhelmed easy"). In a real browser, in every
shipped theme (wicked-dark, wicked-light, dark, light), on the in-process fixture:

  1. THE PATTERN: one centred column no wider than ~860 px; a 32 px title; one sentence of live state; one
     primary action (New job / Add repository); at most one filter on the face (Jobs: Active / Finished);
     rows at least 64 px tall, each with a status dot, a title, one muted line and (Jobs) one status word.
  2. NO IDS ON THE FACE: no run id, uuid or path in a row's visible words.
  3. DOORS: a job row is a link to its run; a repository row is a link to its page (2026-11-05: tabs, with
     Capture learnings and Re-index / Re-run onboarding on Settings); the page's What-we-know tiles sit side by side.
  4. VISIBLE HOVER: every row, the primary action, the filter's other option and the Search-and-filter
     button move dE_OK >= 0.08 (OKLab) from rest when hovered, composited over the page by the browser.
  5. VISIBLE FOCUS: a row reached by keyboard wears the focus ring (a box-shadow).
  6. A PHONE (390x844): neither page scrolls sideways.
  6b. BY PROJECT (operator 2026-11-01): Jobs' list head has a project picker (All projects, each project, No
     project last); each row's line leads with its project ("No project" when unfiled); No project keeps those.
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
# The Repositories list is a table of columns (approved mockup design/mockups/repos-page.html, 2026-11-05): a wider measure.
MAX_COL_REPOS = 1100
MIN_ROW = 64
# Each theme with the accent it writes (the rail hover journey's presets: HARBOR for the wicked themes, IRIS for
# the others), then each theme again with the rig's own accent (HARBOR, a dark teal) to catch an accent-tinted
# hover or link that only reads under one accent. `paired` = the accent that theme writes when chosen.
HARBOR = {"accent_h": 200, "accent_s": 47, "accent_l": 25}
IRIS = {"accent_h": 230, "accent_s": 74, "accent_l": 68}
# A legacy "dark"/"light" choice renders as Wicked Dark/Light (appearance.ts LEGACY_THEMES, round 4).
CASES = [("wicked-dark", "wicked-dark", HARBOR, True), ("wicked-light", "wicked-light", HARBOR, True),
         ("dark", "wicked-dark", IRIS, True), ("light", "wicked-light", IRIS, True),
         ("dark-harbor", "wicked-dark", HARBOR, False), ("light-harbor", "wicked-light", HARBOR, False)]
MIN_TEXT = 4.5
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


# Every background under an element, from the nearest opaque ancestor down to its parent (a translucent track
# or a hovered row counts), then each fill composited over that stack in a 1x1 canvas.
STACK = """e => { const k = document.createElement('canvas'); k.width = k.height = 1; const x = k.getContext('2d', { willReadFrequently: true });
  const alpha = (c) => { x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data[3]; };
  const out = []; for (let a = e.parentElement; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor;
    if (!c || alpha(c) === 0) continue; out.unshift(c); if (alpha(c) === 255) break; }
  if (out.length === 0 || alpha(out[0]) !== 255) out.unshift(getComputedStyle(document.documentElement).backgroundColor || '#fff');
  return out; }"""
PAINT = """([stack, fills]) => { const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  return fills.map(f => { x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillRect(0, 0, 1, 1);
    for (const g of stack) { x.fillStyle = g; x.fillRect(0, 0, 1, 1); }
    x.fillStyle = f; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3); }); }"""
BG = "e => getComputedStyle(e).backgroundColor"

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
PARK = (W - 40, H - 40)


def lum(c) -> float:
    r, g, b = (lin(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b) -> float:
    hi, lo = sorted([lum(a), lum(b)], reverse=True)
    return round((hi + 0.05) / (lo + 0.05), 2)


def hover_de(page, el, target=None, words=None) -> tuple:
    """rest -> hover distance of `target`'s fill (default: el) while the pointer is on `el`, and the contrast of
    `words` (default: target) on that hovered fill."""
    target = target or el
    words = words or target
    page.mouse.move(*PARK)
    page.wait_for_timeout(260)
    ground = target.evaluate(STACK)
    rest = target.evaluate(BG)
    el.hover()
    page.wait_for_timeout(300)
    hov = target.evaluate(BG)
    ink = words.evaluate("e => getComputedStyle(e).color")
    page.mouse.move(*PARK)
    a, b = page.evaluate(PAINT, [ground, [rest, hov]])
    under = "rgb(%d, %d, %d)" % tuple(b)
    text = page.evaluate(PAINT, [[under], [ink]])[0]
    return de(a, b), ratio(text, b)


def rest_contrast(page, el) -> float:
    """The words of `el` at rest on what is under them."""
    page.mouse.move(*PARK)
    page.wait_for_timeout(200)
    ground = el.evaluate(STACK)
    a = page.evaluate(PAINT, [ground, [el.evaluate(BG)]])[0]
    under = "rgb(%d, %d, %d)" % tuple(a)
    text = page.evaluate(PAINT, [[under], [el.evaluate("e => getComputedStyle(e).color")]])[0]
    return ratio(text, a)


def shape(page, root: str, title: str) -> dict:
    return page.evaluate("""([root, title]) => { const r = document.querySelector(root);
      const col = r.querySelector('.wk-jr-col'); const h = [...r.querySelectorAll('h1, h2')].find(x => x.textContent.trim() === title);
      return { col: col ? col.getBoundingClientRect().width : 0, title: h ? getComputedStyle(h).fontSize : null,
        sentence: (r.querySelector('.wk-jr-sentence') || {}).textContent || '',
        visibleFilters: [...r.querySelectorAll('[role="radiogroup"]')].filter(g => g.offsetParent !== null).length,
        primary: [...r.querySelectorAll('.wk-jr-head .wk-jr-btn--primary')].filter(b => b.offsetParent !== null).length }; }""", [root, title])


def rows_of(page, sel: str) -> list:
    return page.evaluate("""sel => [...document.querySelectorAll(sel)].filter(r => r.offsetParent !== null).map(r => {
      const row = r.querySelector('.wk-jr-row, .wk-rl-row'); return { h: row ? row.getBoundingClientRect().height : 0,
        dot: !!r.querySelector('.wk-jr-dot'), title: (r.querySelector('.wk-jr-row-title') || {}).textContent || '',
        sub: [...r.querySelectorAll('.wk-jr-row-sub, .wk-rl-sub, .wk-rl-phone')].filter(x => x.offsetParent !== null).map(x => x.textContent).join(' '), text: row ? row.innerText : '' }; })""", sel)


def focus_ring(page, sel: str) -> str:
    page.keyboard.press("Tab")  # a keyboard interaction first, so a programmatic focus is focus-visible
    page.locator(sel).first.evaluate("e => e.focus()")
    page.wait_for_timeout(200)
    return page.locator(sel).first.evaluate("e => e.matches(':focus-visible') ? getComputedStyle(e).boxShadow : 'not focus-visible'")


def overflow(page) -> int:
    return page.evaluate("() => Math.max(...[document.scrollingElement, ...document.querySelectorAll('.wk-desk2-scroll, .h-full.overflow-y-auto')]"
                         ".filter(Boolean).map(e => e.scrollWidth - e.clientWidth))")


def marks_layout(page) -> dict | None:
    """A repository page's What-we-know band: its display, how many tiles, and on how many lines they sit."""
    return page.evaluate("""() => { const u = document.querySelector('[data-testid="repo-know-band"] .wk-know--band');
      if (u === null) return null; const tops = [...u.querySelectorAll('[data-testid="repo-know-mark"]')].map((m) => Math.round(m.getBoundingClientRect().top));
      return { display: getComputedStyle(u).display, n: tops.length, lines: new Set(tops).size }; }""")


def marks_in_a_row(marks) -> bool:
    """Tiles side by side, not one box per line (knowledge.css once styled `.wk-know` as a column too)."""
    return marks is not None and marks["display"] == "grid" and marks["n"] > 1 and marks["lines"] < marks["n"]


with sync_playwright() as p:
    browser = p.chromium.launch()
    for theme, want, accent, paired in CASES:
        ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
        set_fixture(origin, wave1=True, repo=True, repo_refs=True, appearance={**DEFAULT_APPEARANCE, **accent, "theme": theme.removesuffix("-harbor")})

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
        check(f"{theme}:jobs-pattern", 600 <= s["col"] <= MAX_COL and s["title"] == "28px" and s["sentence"] != ""
              and s["visibleFilters"] == 1 and s["primary"] == 1 and len(rows) > 0
              and all(r["h"] >= MIN_ROW and r["dot"] and r["title"] and r["sub"] for r in rows)
              and all(w in ("Working", "Waiting on you", "Needs a decision", "Finished", "Answered", "Failed", "Stopped", "Unknown") for w in words),
              shape=s, rows=rows[:3], words=words[:6])
        check(f"{theme}:jobs-no-ids", not any(FACE_IDS.search(r["text"]) for r in rows), faces=[r["text"] for r in rows][:6])
        row = page.get_by_test_id("desk-runs-row").first
        href = row.get_by_test_id("desk-runs-open").get_attribute("href") or ""
        other = page.locator('[data-testid="desk-runs-group"] [aria-checked="false"]').first
        h_row = hover_de(page, row, words=row.locator(".wk-jr-row-title"))
        h_new = hover_de(page, page.get_by_test_id("desk-runs-new"))
        h_seg = hover_de(page, other)
        h_tools = hover_de(page, page.get_by_test_id("desk-runs-tools"))
        ring = focus_ring(page, '[data-testid="desk-runs-open"]')
        moves = {"row": h_row, "filter": h_seg, "tools": h_tools, **({"new_job": h_new} if paired else {})}
        check(f"{theme}:jobs-hover-focus", all(d >= MIN_DE for d, _ in moves.values()) and h_new[1] >= MIN_TEXT
              and h_row[1] >= MIN_TEXT and ring not in ("none", "not focus-visible") and "/s" in href,
              **{k: {"dE": d, "text": t} for k, (d, t) in moves.items()}, new_job_text=h_new[1], ring=ring, href=href)
        # A link's words read at rest (Show finished jobs, at the list's foot when there are ended jobs).
        foot = page.get_by_test_id("desk-runs-show-finished")
        if foot.count() > 0:
            foot.scroll_into_view_if_needed()
            link = hover_de(page, foot)
            check(f"{theme}:jobs-link", rest_contrast(page, foot) >= MIN_TEXT and link[0] >= MIN_DE and link[1] >= MIN_TEXT,
                  rest=rest_contrast(page, foot), hover={"dE": link[0], "text": link[1]})
        page.mouse.move(*PARK)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.screenshot(path=str(SHOTS / f"jobs-repos-jobs-{theme}.png"))

        # ── Repositories ──
        page.goto(f"{origin}/repos", wait_until="networkidle")
        page.get_by_test_id("repo-card").first.wait_for(state="visible", timeout=15000)
        s = shape(page, '[data-testid="repos-page"]', "Repositories")
        rows = rows_of(page, '[data-testid="repo-card"]')
        check(f"{theme}:repos-pattern", 600 <= s["col"] <= MAX_COL_REPOS and s["title"] == "28px" and s["sentence"] != "" and s["primary"] == 1
              and s["visibleFilters"] == 0 and len(rows) > 0 and all(r["h"] >= MIN_ROW and r["dot"] and r["title"] and r["sub"] for r in rows),
              shape=s, rows=rows[:3])
        check(f"{theme}:repos-no-ids", not any(FACE_IDS.search(r["text"]) for r in rows), faces=[r["text"] for r in rows][:6])
        card = page.get_by_test_id("repo-card").first
        h_row = hover_de(page, card.get_by_test_id("repo-row"), card, card.locator(".wk-jr-row-title"))
        h_add = hover_de(page, page.get_by_test_id("repos-add"))
        ring = focus_ring(page, '[data-testid="repo-row"]')
        # A next step on a row's right (Re-index / Index) is a link that reads in every theme.
        step = page.locator('[data-testid="repo-row-reindex"], [data-testid="repo-row-index"]').first
        steps = {}
        if step.count() > 0:
            steps = {"rest": rest_contrast(page, step), "hover": hover_de(page, step)}
        page.mouse.move(*PARK)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.screenshot(path=str(SHOTS / f"jobs-repos-repos-{theme}.png"))
        # A row is a door to its repository's page (2026-11-05: no expander, no box of details under each row).
        repo_id = card.get_attribute("data-repo-id")
        href = card.get_by_test_id("repo-row").get_attribute("href")
        # Still on the list: no expander, no details and no box of marks under the rows.
        no_details = (page.get_by_test_id("repo-details").count() == 0 and page.locator('[data-testid="repo-card"] .wk-know').count() == 0
                      and page.locator('[data-testid="repo-row"][aria-expanded]').count() == 0)
        card.get_by_test_id("repo-row").click()
        page.wait_for_url(f"**/repo-detail/{repo_id}", timeout=10000)
        page.get_by_test_id("repo-know-band").wait_for(state="visible", timeout=15000)
        marks = marks_layout(page)
        tabs = page.get_by_role("tab").all_inner_texts()
        page.get_by_test_id("repo-tab-settings").click()
        page.wait_for_url(f"**/repo-detail/{repo_id}?tab=settings", timeout=10000)
        page.get_by_test_id("repo-upkeep").wait_for(state="visible", timeout=10000)
        acts = page.get_by_test_id("repo-upkeep").locator("button").all_inner_texts()
        # The repository page's buttons are studio's shared ones (wk-btn), not the calm list's; their hover is not this page's.
        check(f"{theme}:repos-hover-focus-door", h_row[0] >= MIN_DE and h_row[1] >= MIN_TEXT and (h_add[0] >= MIN_DE or not paired)
              and h_add[1] >= MIN_TEXT
              and (not steps or (steps["rest"] >= MIN_TEXT and steps["hover"][0] >= MIN_DE and steps["hover"][1] >= MIN_TEXT))
              and ring not in ("none", "not focus-visible")
              and href == f"/repo-detail/{repo_id}" and no_details
              # Trackers is there only on a crew with tracker links.
              and [re.sub(r"\d+$", "", t) for t in tabs] in (["Overview", "Knowledge", "Jobs", "History", "Trackers", "Settings"], ["Overview", "Knowledge", "Jobs", "History", "Settings"])
              and any("Capture learnings" in a for a in acts) and any(a in ("Re-index…", "Re-run onboarding") for a in acts),
              row=h_row, add=h_add, next_step=steps, ring=ring, href=href, no_details=no_details, tabs=tabs, actions=acts)
        check(f"{theme}:repo-band-tiles-side-by-side", marks_in_a_row(marks), marks=marks)
        page.screenshot(path=str(SHOTS / f"jobs-repos-repo-page-{theme}.png"))

        ctx.close()

    # ── By project (operator 2026-11-01): the project_dto corpus files most jobs in projects and leaves r-unfiled
    #    in none. Each row's line leads with its project's name ("No project" when unfiled); each choice in the list
    #    head's picker keeps exactly the rows of that project, and its count says how many. ──
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    set_fixture(origin, wave1=False, repo=False, repo_refs=False, project_dto=True, appearance={**DEFAULT_APPEARANCE, **HARBOR, "theme": "wicked-dark"})
    page.goto(f"{origin}/?tab=runs", wait_until="networkidle")
    page.get_by_test_id("desk-runs-row").first.wait_for(state="visible", timeout=15000)
    pick = page.get_by_test_id("desk-runs-project")
    ROWS = "rs => rs.map(r => [r.dataset.runId, r.dataset.project, r.querySelector('[data-testid=desk-runs-line]').textContent])"
    by_group = {}
    for group in ("active", "finished"):
        page.get_by_test_id(f"desk-runs-group-{group}").click()
        page.wait_for_timeout(200)
        options = pick.locator("option").evaluate_all("os => os.map(o => [o.value, o.textContent])")
        label = {v: re.sub(r" \(\d+\)$", "", t) for v, t in options}
        count = {v: int(m.group(1)) for v, t in options if (m := re.search(r"\((\d+)\)$", t))}
        rows = page.locator('[data-testid="desk-runs-row"]').evaluate_all(ROWS)
        picked = {}
        for value, _ in options[1:]:
            pick.select_option(value)
            page.wait_for_timeout(150)
            picked[value] = sorted(r[0] for r in page.locator('[data-testid="desk-runs-row"]').evaluate_all(ROWS))
        pick.select_option("")
        page.wait_for_timeout(150)
        by_group[group] = {"options": options, "rows": rows, "picked": picked,
                           "led": all(line.startswith(label[proj] + " · ") for _, proj, line in rows),
                           "exact": all(picked[v] == sorted(r[0] for r in rows if r[1] == v) and count[v] == len(picked[v]) for v in picked),
                           "all": count.get("", -1) == len(rows) and len(rows) < 40,
                           "back": page.get_by_test_id("desk-runs-row").count() == len(rows)}
    every = [r for g in by_group.values() for r in g["rows"]]
    check("jobs-by-project", all(g["led"] and g["exact"] and g["all"] and g["back"] for g in by_group.values())
          and any(r[1] == "default" for r in every) and any(r[1] != "default" for r in every)
          and all(g["options"][0][0] == "" and g["options"][-1][0] == "default" and g["options"][-1][1].startswith("No project (")
                  for g in by_group.values()),
          **{g: {k: v for k, v in d.items() if k != "rows"} | {"rows": d["rows"][:6]} for g, d in by_group.items()})
    page.get_by_test_id("desk-runs-group-active").click()
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / "jobs-repos-jobs-by-project.png"))
    ctx.close()

    # ── A phone ──
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    set_fixture(origin, wave1=True, repo=True, repo_refs=True, project_dto=False, appearance={**DEFAULT_APPEARANCE, **HARBOR, "theme": "wicked-dark"})
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
    page.get_by_test_id("repo-row").first.click()
    page.get_by_test_id("repo-know-band").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(300)
    phone_marks = marks_layout(page)
    page_over = overflow(page)
    check("phone-repo-page-tiles-side-by-side", marks_in_a_row(phone_marks) and page_over <= 1, marks=phone_marks, over=page_over)
    page.screenshot(path=str(SHOTS / "jobs-repos-repo-page-phone.png"))
    check("phone-no-sideways-scroll", jobs_over <= 1 and repos_over <= 1, jobs=jobs_over, repos=repos_over)
    ctx.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
