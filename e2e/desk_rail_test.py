#!/usr/bin/env python3
"""
desk_rail_test.py — THE DESK RAIL after the sidebar regroup (ui-v2, operator 2026-10-26; mockup
desk-home-redesign; before it the IA change of 2026-10-13) at 1440x700 on the Desk.

Against the in-process fixture (wave-1 + wave-2b corpus):

  1. ORDER: top to bottom — the wordmark (a label, not a link) · the four icon buttons (New job · New
     project · Chat · Search) · the pages in three groups under small-caps labels — WORK (Home, Jobs,
     Repositories), INSIGHT (Report, Understand, Evaluate), GOVERN (Steering, Memory, Agents) · RECENT
     (the sessions by project, at most five, then All jobs) · Build & settings · the Nerve Center tile
     pinned last. Home carries the needs-you badge and its name says it. No Workspace group, no More,
     no "General settings"; no Notifications entry (no bell, no "notifications" nav-dest).
  1b. MEASURED: the section labels are small caps (uppercase, letter-spaced, <= 11px), the pages 13px
     at >= 4.5:1, and Nerve Center larger than every other item; HOVER on a page is a visible accent
     tint (dE_OK >= 0.08 from its rest fill, words still >= 4.5:1).
  2. NEW PROJECT: the button opens the New project modal; Escape closes it.
  3. RETIRED /settings: the address REPLACES itself with /system, the Settings page on its General
     tab; /theme REPLACES itself with /system?tab=theme. Build & settings is current on both.
  4. NAVIGATES: every page opens its address and is marked current; Build & settings opens its page,
     whose links open Skills, MCP, Plugins, Workflows and Settings (Build & settings current on each);
     the old Desk addresses (`/?tab=…`) replace themselves with their pages; Nerve Center opens /watch.
  5. NERVE CENTER: /health REPLACES itself with /watch (the dashboard), and the tile is marked current.
  6. 0 page errors.

Captures: e2e/shots/desk-rail.png, desk-rail-general.png (/settings landing on General), and the
rail-polish evidence set rail-polish-{rail,general,nerve}-{1440x700,390x844}-{light,dark}.png (dark =
no data-theme). Env: FEEDBACK_PORT (default 4366).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4366"))
W, H = 1440, 700
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



PAGES = ["nav-projects", "nav-jobs", "nav-repos", "nav-report", "nav-understand", "nav-evaluate",
         "nav-steering", "nav-memory", "nav-agents"]

RAIL = """() => {
  const rail = document.querySelector('[data-testid="session-rail"]');
  const ids = ['desk-rail-wordmark', 'desk-rail-new-job', 'desk-rail-new-project', 'nav-projects', 'nav-jobs', 'nav-repos',
               'nav-report', 'nav-understand', 'nav-evaluate', 'nav-steering', 'nav-memory', 'nav-agents', 'rail-recent-toggle',
               'rail-group', 'rail-all-jobs', 'desk-rail-build', 'desk-rail-nerve',
               'desk-rail-skills', 'desk-rail-general', 'rail-foot-label', 'desk-tabs-more', 'desk-rail-more'];
  const seen = [];
  for (const el of rail.querySelectorAll('[data-testid]')) {
    const id = el.dataset.testid;
    if (ids.includes(id) && seen[seen.length - 1] !== id) seen.push(id);
  }
  // The wordmark is the link Home (operator 2026-10-27); its badge is said as its description.
  const home = rail.querySelector('[data-testid="desk-rail-wordmark"]');
  const descId = home?.getAttribute('aria-describedby');
  const primary = rail.querySelector('[data-testid="nav-projects"]');
  const jobs = rail.querySelector('[data-testid="nav-jobs"]');
  const badge = rail.querySelector('[data-testid="desk-rail-badge"]');
  return {
    order: seen,
    dests: [...rail.querySelectorAll('[data-nav-dest]')].map(e => e.dataset.navDest),
    text: rail.innerText,
    bell: !!rail.querySelector('[data-nav-dest="notifications"], [aria-label^="Notifications"], [aria-label$="notifications"]'),
    homeLinks: rail.querySelectorAll('a[href="/"]').length,
    homeName: home?.getAttribute('aria-label') ?? null,
    homeTag: home?.tagName ?? null,
    homeDesc: descId ? (document.getElementById(descId)?.textContent ?? null) : null,
    primaries: [...rail.querySelectorAll('[data-primary="true"]')].map(e => e.dataset.testid),
    primaryWeight: primary ? parseInt(getComputedStyle(primary).fontWeight, 10) : null,
    jobsWeight: jobs ? parseInt(getComputedStyle(jobs).fontWeight, 10) : null,
    primaryMark: !!primary?.querySelector('.wk-rail-nav-mark'),
    badge: badge && home?.contains(badge) ? badge.innerText.trim() : null,
    nerveLast: !!rail.lastElementChild?.querySelector('[data-testid="desk-rail-nerve"]'),
    secs: [...rail.querySelectorAll('.wk-rail-sec')].map(e => e.innerText.trim()),
    sessions: rail.querySelectorAll('[data-testid="rail-session"]').length,
    allJobs: rail.querySelector('[data-testid="rail-all-jobs"]')?.getAttribute('href') ?? null,
    nerveWords: rail.querySelector('[data-testid="nerve-center-words"]')?.innerText ?? null,
    nerveTone: rail.querySelector('[data-testid="desk-rail-nerve"]')?.dataset.tone ?? null,
    actions: [...rail.querySelectorAll('[data-testid="desk-rail-actions"] button')].map(b => b.dataset.testid),
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
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"rail-session\"]').length >= 3", timeout=10000)
    page.mouse.move(W // 2, 20)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-rail.png"))

    # ── 1. the order ─────────────────────────────────────────────────────────────
    # The badge is said once the needs-you count has settled (useSettledNeeds).
    page.get_by_test_id("desk-rail-badge").wait_for(state="visible", timeout=15000)
    r = page.evaluate(RAIL)
    want = ['desk-rail-wordmark', 'desk-rail-new-job', 'desk-rail-new-project', *PAGES, 'rail-recent-toggle',
            'rail-group', 'rail-all-jobs', 'desk-rail-build', 'desk-rail-nerve']
    badge = r["badge"]
    check("order",
          r["order"] == want
          and r["dests"] == ["page:home", "page:projects", "page:jobs", "page:repos", "page:report", "page:understand", "page:evaluate",
                             "page:steering", "page:memory", "page:agents", "page:build", "watch"]
          and not r["bell"] and r["homeLinks"] == 1 and r["nerveLast"]
          # The wordmark is the link Home; its description says the badge (the fixture has gates waiting).
          and r["homeTag"] == "A" and r["homeName"] == "Home"
          and badge is not None and r["homeDesc"] in (f"{badge} need you", f"{badge} needs you")
          # Projects is WORK's one primary entry: a stronger weight than its siblings and an accent mark.
          and r["primaries"] == ["nav-projects"] and r["primaryMark"]
          and (r["primaryWeight"] or 0) > (r["jobsWeight"] or 0)
          and r["secs"] == ["WORK", "INSIGHT", "GOVERN", "RECENT"]
          and 1 <= r["sessions"] <= 5 and r["allJobs"] == "/jobs"
          and all(w not in r["text"] for w in ("Everything else", "Product", "Workspace", "General settings", "Configuration", "MCP tools", "Skills"))
          # DES-SYSTEM-CHAT §1: four equal icon buttons (no words), New job · New project · Chat · Search.
          and r["actions"] == ["desk-rail-new-job", "desk-rail-new-project", "desk-rail-chat", "desk-rail-search"]
          and (r["nerveWords"] or "").strip() != "" and r["nerveTone"] in ("green", "yellow", "red"),
          **{k: v for k, v in r.items() if k != "text"})

    # ── 1b. the sidebar MEASURED in the browser: small-caps labels, 13px pages at AA, Nerve Center the
    #        largest item; and hover on a page is a visible ACCENT tint (operator 2026-10-26).
    MEASURE = """(hovered) => {
      const px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
      // Any CSS colour (oklch, color-mix…) to sRGB through a 1×1 canvas; alpha < 0.5 counts as transparent.
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
      const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      // The background actually behind el: every translucent layer composited over the first opaque one.
      const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
        let out = [255, 255, 255]; for (const c of layers.reverse()) out = [0, 1, 2].map((i) => c[3] * c[i] + (1 - c[3]) * out[i]); return out; };
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const contrast = (el) => { const bg = bgOf(el); const f = rgb(getComputedStyle(el).color); const ink = [0, 1, 2].map((i) => f[3] * f[i] + (1 - f[3]) * bg[i]); const a = lum(ink), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const oklab = ([r, g, b]) => { const [R, G, B] = [lin(r), lin(g), lin(b)];
        const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
      const dE = (a, b) => { const [x, y] = [oklab(a), oklab(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
      const rail = document.querySelector('[data-testid="session-rail"]');
      const pages = [...rail.querySelectorAll('.wk-rail-nav-item')].filter((e) => e.getAttribute('aria-current') !== 'page');
      const label = rail.querySelector('.wk-rail-sec');
      const el = document.querySelector(`[data-testid="${hovered}"]`);
      return { page: Math.max(...pages.map(px)), contrast: Math.min(...pages.map(contrast)),
               nerve: px(document.querySelector('[data-testid="desk-rail-nerve"] .wk-nc-name')),
               session: px(document.querySelector('[data-testid="rail-session"] .wk-rail-session-title')),
               label: px(label), labelTransform: label ? getComputedStyle(label).textTransform : null, labelSpacing: label ? parseFloat(getComputedStyle(label).letterSpacing) || 0 : null,
               fill: el ? bgOf(el) : null, rail: bgOf(rail), hoverContrast: el ? contrast(el) : null, dE: el ? dE(bgOf(el), bgOf(rail)) : null };
    }"""
    page.mouse.move(W // 2, 20)
    page.wait_for_timeout(250)
    rest = page.evaluate(MEASURE, "nav-report")
    page.get_by_test_id("nav-report").hover()
    page.wait_for_timeout(400)
    hov = page.evaluate(MEASURE, "nav-report")
    page.screenshot(path=str(SHOTS / "desk-rail-hover.png"))
    page.mouse.move(W // 2, 20)
    check("sidebar-measured", rest["page"] == 13 and rest["contrast"] >= 4.5
          and rest["labelTransform"] == "uppercase" and rest["label"] is not None and rest["label"] <= 11 and (rest["labelSpacing"] or 0) > 0
          # DES-SYSTEM-VIEW: Nerve Center is larger than every other rail item.
          and rest["nerve"] is not None and rest["nerve"] > max(rest["session"] or 0, rest["page"])
          # Hover: the page's fill moves off the rail by a visible step, an accent tint (blue leads), AA words.
          and (rest["dE"] or 0) < 0.01 and (hov["dE"] or 0) >= 0.08 and (hov["hoverContrast"] or 0) >= 4.5,
          rest=rest, hover={k: hov[k] for k in ("fill", "rail", "dE", "hoverContrast")})

    # ── 2. New project opens the one New project modal; Escape closes it ──────────
    page.get_by_test_id("desk-rail-new-project").click()
    page.get_by_test_id("new-project-modal").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(150)
    page.screenshot(path=str(SHOTS / "desk-rail-new-project.png"))
    page.keyboard.press("Escape")
    page.get_by_test_id("new-project-modal").wait_for(state="detached", timeout=5000)
    check("new-project", page.evaluate("() => window.location.pathname") == "/")

    # ── 3. the retired "General settings" overview: /settings REPLACES itself with General ──
    page.goto(f"{origin}/settings", wait_until="networkidle")
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
    page.get_by_role("heading", name="Settings", exact=True).first.wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-rail-general.png"))
    general_tab = page.locator('[data-testid="settings-tab"][data-tab="general"]').get_attribute("aria-selected")
    cfg = page.evaluate("""() => ({ testing: !!document.querySelector('[data-testid="settings-testing-link"]'),
      developer: !!document.querySelector('[data-testid="developer-settings"]'),
      overview: !!document.querySelector('[data-testid="settings-overview"]'),
      current: document.querySelector('[data-testid="desk-rail-build"]')?.getAttribute('aria-current') ?? null })""")
    check("general", not cfg["testing"] and not cfg["developer"] and not cfg["overview"] and cfg["current"] == "page"
          and general_tab == "true", general_tab=general_tab, **cfg)

    # ── 3a. studio-settings-tabs: the retired /theme REPLACES itself with the Settings page's Theme tab ──
    page.goto(f"{origin}/theme", wait_until="networkidle")
    page.wait_for_function("() => window.location.pathname === '/system' && window.location.search === '?tab=theme'", timeout=5000)
    page.get_by_role("radiogroup", name="Theme").wait_for(state="visible", timeout=8000)
    tabs = page.evaluate("""() => ({ selected: [...document.querySelectorAll('[data-testid="settings-tab"]')].map(t => [t.dataset.tab, t.getAttribute('aria-selected')]),
      panel: document.querySelector('[data-testid="settings-panel"]')?.dataset.tab ?? null,
      current: document.querySelector('[data-testid="desk-rail-build"]')?.getAttribute('aria-current') ?? null,
      themeLink: !!document.querySelector('[data-testid="desk-rail-theme"]') })""")
    page.screenshot(path=str(SHOTS / "desk-rail-theme-tab.png"))
    check("theme-tab", tabs["selected"] == [["general", "false"], ["theme", "true"]] and tabs["panel"] == "theme"
          and tabs["current"] == "page" and not tabs["themeLink"], **tabs)

    # ── 3. the pages navigate and mark the current one; Build & settings lists the rest ──
    went = {}
    page.goto(f"{origin}/", wait_until="networkidle")
    for tid, path in (("nav-projects", "/projects"), ("nav-jobs", "/jobs"), ("nav-repos", "/repos"), ("nav-report", "/report"), ("nav-understand", "/understand"),
                      ("nav-evaluate", "/testing/evals"), ("nav-steering", "/rules"), ("nav-memory", "/memory"),
                      ("nav-agents", "/agents"), ("desk-rail-wordmark", "/"), ("desk-rail-build", "/build")):
        page.get_by_test_id(tid).click()
        page.wait_for_function(f"() => window.location.pathname === '{path}'", timeout=5000)
        page.wait_for_timeout(150)
        went[tid] = {"path": page.evaluate("() => window.location.pathname"),
                     "current": page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-rail"] [aria-current="page"]')].map(e => e.dataset.testid)""")}
    page.screenshot(path=str(SHOTS / "desk-rail-build.png"))
    for tid, path in (("build-link-skills", "/skills"), ("build-link-mcp", "/mcp"), ("build-link-plugins", "/plugins"),
                      ("build-link-workflows", "/workflows"), ("build-link-settings", "/system")):
        page.goto(f"{origin}/build", wait_until="networkidle")
        page.get_by_test_id(tid).click()
        page.wait_for_function(f"() => window.location.pathname === '{path}'", timeout=5000)
        went[tid] = {"path": page.evaluate("() => window.location.pathname"),
                     "current": page.evaluate("""() => [...document.querySelectorAll('[data-testid="session-rail"] [aria-current="page"]')].map(e => e.dataset.testid)""")}
    page.get_by_test_id("desk-rail-nerve").click()
    page.wait_for_function("() => window.location.pathname === '/watch'", timeout=5000)
    went["watch"] = page.evaluate("() => window.location.pathname")
    check("navigates", all(v["current"] == [k if not k.startswith("build-link-") else "desk-rail-build"] for k, v in went.items() if k != "watch")
          and went["watch"] == "/watch", **went)

    # ── 3a'. the old Desk addresses REPLACE themselves with their pages (Back skips them) ──
    moved = {}
    for old, new in (("/?tab=runs", "/jobs"), ("/?tab=report&focus=spend", "/report?focus=spend"), ("/?tab=understand", "/understand"),
                     ("/?tab=steer", "/rules"), ("/?tab=memory&at=%2Fmemory%3Fview%3Dproposals", "/memory?view=proposals"),
                     ("/?tab=agents&at=%2Fagents%3Ffix%3Dclaude", "/agents?fix=claude"), ("/?tab=evaluate", "/testing/evals"),
                     ("/?tab=repositories", "/repos")):
        page.goto(f"{origin}{old}", wait_until="networkidle")
        page.wait_for_function(f"() => window.location.pathname + window.location.search === {json.dumps(new)}", timeout=5000)
        moved[old] = page.evaluate("() => window.location.pathname + window.location.search")
    check("old-desk-addresses", all(moved[o] == n for o, n in (("/?tab=runs", "/jobs"), ("/?tab=evaluate", "/testing/evals"))), **moved)

    # ── 3b. the group icons: a project's four-boxes icon opens its DASHBOARD (/projects/:id, not the
    #        Product flow); "Not in a project" carries the open icon to See everything › Projects.
    page.get_by_test_id("desk-rail-wordmark").click()
    page.wait_for_function("() => window.location.pathname === '/'", timeout=5000)
    view = page.locator('[data-testid="rail-group"]:not([data-project-id=""]) [data-testid="rail-group-view"]').first
    view.wait_for(state="visible", timeout=5000)
    pid = view.evaluate("e => e.closest('[data-testid=\"rail-group\"]').dataset.projectId")
    view.click()
    page.wait_for_function("() => window.location.pathname.startsWith('/projects/')", timeout=5000)
    dash = page.evaluate("() => window.location.pathname")
    set_fixture(origin, project_dto=True)  # adds r-unfiled, so the rail has a "Not in a project" group
    page.goto(f"{origin}/", wait_until="networkidle")
    unfiled = page.get_by_test_id("rail-group-view-unfiled")
    unfiled.wait_for(state="visible", timeout=5000)
    label = unfiled.get_attribute("aria-label")
    unfiled.click()
    # 2026-10-16: "Not in a project" opens its own dashboard, the same ProjectDesk every project has.
    page.wait_for_function("() => window.location.pathname === '/projects/default'", timeout=5000)
    where = page.evaluate("() => window.location.pathname + window.location.search")
    page.get_by_test_id("project-desk").wait_for(state="visible", timeout=8000)
    check("group-icons", dash == f"/projects/{pid}" and label == "Open work not in a project" and where == "/projects/default",
          dash=dash, pid=pid, label=label, where=where)
    set_fixture(origin, project_dto=False)

    # ── 4. the rail-polish evidence shots (studio#421 r1): the rail and the /health page at two
    #       viewports and both themes — the visible foot separator and the framed settings button.
    def shots(subject: str) -> None:
        for width, height in ((1440, 700), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            for label, attr in (("light", "light"), ("dark", None)):
                page.evaluate(
                    "(t) => t ? document.documentElement.setAttribute('data-theme', t)"
                    " : document.documentElement.removeAttribute('data-theme')", attr)
                page.wait_for_timeout(150)
                page.screenshot(path=str(SHOTS / f"rail-polish-{subject}-{width}x{height}-{label}.png"))
        page.set_viewport_size({"width": W, "height": H})
        page.evaluate("() => document.documentElement.removeAttribute('data-theme')")

    page.get_by_test_id("desk-rail-wordmark").click()
    page.wait_for_function("() => window.location.pathname === '/'", timeout=5000)
    page.get_by_test_id("desk-rail-build").wait_for(state="visible", timeout=5000)
    shots("rail")

    # r3: the same matrix on the Settings page (through Build & settings).
    page.get_by_test_id("desk-rail-build").click()
    page.get_by_test_id("build-link-settings").click()
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
    shots("general")

    # The old Health address lands on Nerve Center (replace), and the tile is current there.
    page.goto(f"{origin}/health", wait_until="networkidle")
    page.wait_for_function("() => window.location.pathname === '/watch'", timeout=5000)
    page.get_by_test_id("nerve-center-page").wait_for(state="visible", timeout=5000)
    check("nerve-center", page.get_by_test_id("desk-rail-nerve").get_attribute("aria-current") == "page",
          current=page.get_by_test_id("desk-rail-nerve").get_attribute("aria-current"))
    shots("nerve")

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
