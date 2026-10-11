#!/usr/bin/env python3
"""
desk_rail_test.py — THE DESK RAIL after Amendment 5 (DES-STUDIO-REBUILD-001 Amendment 5, as revised;
S15c) at 1440x700 on the Desk.

Against the in-process fixture (wave-1 + wave-2b corpus):

  1. ORDER: top to bottom — Desk · Watchtower · the sessions list · Product · Skills · MCP tools ·
     Steering · Health · "Additional settings"; no Notifications entry (no bell, no "notifications" nav-dest);
     no "Rules", no "Everything else".
  2. MENU: "Additional settings" lists exactly Configuration, Repositories, Workflows, Evals, Theme —
     in that order — plus the orders/away and freeze controls; nothing that redirects.
  3. NAVIGATES: Steering opens /rules and is marked current; Skills opens /skills; MCP tools opens /mcp;
     Watchtower opens /watch; Configuration opens /system (and Configuration links to Testing campaigns).
  4. HEALTH: the rail's Health link opens /health and is marked current there.
  5. 0 page errors.

Captures: e2e/shots/desk-rail.png, desk-rail-additional.png (the /settings page), and the rail-polish evidence set
rail-polish-{rail,health}-{1440x700,390x844}-{light,dark}.png (dark = no data-theme). Env:
FEEDBACK_PORT (default 4366).
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



RAIL = """() => {
  const rail = document.querySelector('[data-testid="session-rail"]');
  const ids = ['desk-rail-home', 'desk-rail-watch', 'rail-group', 'desk-rail-product', 'desk-rail-skills', 'desk-rail-mcp',
               'desk-rail-steering', 'desk-rail-testing', 'desk-rail-more', 'desk-rail-health'];
  const seen = [];
  for (const el of rail.querySelectorAll('[data-testid]')) {
    const id = el.dataset.testid;
    if (ids.includes(id) && seen[seen.length - 1] !== id) seen.push(id);
  }
  return {
    order: seen,
    dests: [...rail.querySelectorAll('[data-nav-dest]')].map(e => e.dataset.navDest),
    text: rail.innerText,
    bell: !!rail.querySelector('[data-nav-dest="notifications"], [aria-label^="Notifications"], [aria-label$="notifications"]'),
    steering: rail.querySelector('[data-testid="desk-rail-steering"]')?.getAttribute('href') ?? null,
    more: rail.querySelector('[data-testid="desk-rail-more"]')?.innerText ?? null,
    footLabel: rail.querySelector('[data-testid="rail-foot-label"]')?.textContent ?? null,
    healthState: rail.querySelector('[data-testid="rail-health-state"]')?.innerText ?? null,
  };
}"""

MENU = """() => {
  const m = document.querySelector('[data-testid="settings-overview"]');
  const links = [...m.querySelectorAll('[data-testid="settings-overview-row"] a')];
  return {
    labels: links.map(a => a.innerText.trim()),
    hrefs: links.map(a => a.getAttribute('href')),
    controls: !!m.querySelector('[data-testid="desk-rail-controls"], [data-testid^="standing-orders"], [data-testid^="delivery-freeze"]'),
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
    r = page.evaluate(RAIL)
    check("order",
          r["order"] == ['desk-rail-home', 'desk-rail-watch', 'rail-group', 'desk-rail-product', 'desk-rail-skills', 'desk-rail-mcp',
                         'desk-rail-steering', 'desk-rail-testing', 'desk-rail-more', 'desk-rail-health']
          and r["dests"] == ["watch", "section:product", "section:skills", "section:mcp", "section:steering", "section:testing", "settings", "health"]
          and not r["bell"] and "Rules" not in r["text"] and "Everything else" not in r["text"]
          and "Steering" in r["text"] and "Skills" in r["text"] and "MCP tools" in r["text"]
          and r["steering"] == "/rules" and (r["more"] or "").startswith("Additional settings")
          and r["footLabel"] == "Workspace",
          **{k: v for k, v in r.items() if k != "text"})

    # ── 1b. the Workspace tier MEASURED (operator 2026-10-11 20:50Z: "still large"): computed font
    #        sizes in the browser — every Workspace link is smaller than the session rows and Desk.
    sizes = page.evaluate("""() => {
      const px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
      // Any CSS colour (oklch, color-mix…) to sRGB through a 1×1 canvas; alpha < 0.5 counts as transparent.
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
      const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0.5) return c.slice(0, 3); } return [255, 255, 255]; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const contrast = (el) => { const bg = bgOf(el); const f = rgb(getComputedStyle(el).color); const ink = [0, 1, 2].map((i) => f[3] * f[i] + (1 - f[3]) * bg[i]); const a = lum(ink), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const foot = [...document.querySelectorAll('[data-testid="session-rail"] .wk-rail-foot .wk-rail-link')].filter((e) => e.getAttribute('aria-current') !== 'page');
      const label = document.querySelector('[data-testid="rail-foot-label"]');
      return { desk: px(document.querySelector('[data-testid="desk-rail-home"]')),
               watch: px(document.querySelector('[data-testid="watch-pill"]')),
               session: px(document.querySelector('[data-testid="rail-session"] .wk-rail-session-title')),
               workspace: foot.map(px), contrast: Math.min(...foot.map(contrast)), ink: foot[0] ? getComputedStyle(foot[0]).color : null, bg: foot[0] ? bgOf(foot[0]).join(',') : null, theme: document.documentElement.dataset.theme ?? null,
               label: px(label), labelTransform: label ? getComputedStyle(label).textTransform : null };
    }""")
    ws = sizes["workspace"]
    # Operator 23:40Z: unmistakably smaller — ≤ 11px AND ≤ 0.85× the session rows, still ≥ 4.5:1.
    check("workspace-tier-measured", len(ws) >= 6 and None not in ws and sizes["desk"] == 13 and sizes["session"] == 13
          and max(ws) <= 11 and max(ws) <= 0.85 * sizes["session"] and max(ws) < sizes["desk"]
          and sizes["contrast"] >= 4.5 and sizes["labelTransform"] == "uppercase", **sizes)

    # ── 2. the settings page (operator 2026-10-11: a page, not a dropdown) ─────────
    page.get_by_test_id("desk-rail-more").click()
    page.wait_for_function("() => window.location.pathname === '/settings'", timeout=5000)
    page.get_by_test_id("settings-overview").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-rail-additional.png"))
    m = page.evaluate(MENU)
    check("menu",
          m["labels"] == ["Configuration", "Repositories", "Workflows", "Evals", "Theme"]
          and m["hrefs"] == ["/system", "/repos", "/workflows", "/testing/evals", "/theme"]
          # studio#421 r3 (change 17): the menu is navigation-only — the orders/freeze controls are
          # the Desk's "⋯ › Hold" sheet.
          and not m["controls"], **m)
    page.locator('[data-testid="settings-overview"] a[href="/system"]').click()
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
    page.get_by_test_id("settings-testing-link").wait_for(state="visible", timeout=5000)
    testing_href = page.locator('[data-testid="settings-testing-link"] a').get_attribute("href")
    check("configuration", testing_href == "/testing/campaigns", testing_href=testing_href)

    # ── 3. the rail entries navigate and mark the current one ────────────────────
    went = {}
    for tid, path in (("desk-rail-product", "/product"), ("desk-rail-steering", "/rules"), ("desk-rail-skills", "/skills"), ("desk-rail-mcp", "/mcp"), ("desk-rail-testing", "/testing/campaigns")):
        page.get_by_test_id(tid).click()
        page.wait_for_function(f"() => window.location.pathname === '{path}'", timeout=5000)
        went[tid] = {"path": page.evaluate("() => window.location.pathname"),
                     "current": page.get_by_test_id(tid).get_attribute("aria-current")}
    page.get_by_test_id("watch-pill").click()
    page.wait_for_function("() => window.location.pathname === '/watch'", timeout=5000)
    went["watch"] = page.evaluate("() => window.location.pathname")
    check("navigates", all(v["current"] == "page" for k, v in went.items() if k != "watch") and went["watch"] == "/watch", **went)

    # ── 3b. the group icons: a project's four-boxes icon opens its DASHBOARD (/projects/:id, not the
    #        Product flow); "Not in a project" carries the open icon to See everything › Projects.
    page.get_by_test_id("desk-rail-home").click()
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
    page.wait_for_function("() => window.location.pathname === '/everything'", timeout=5000)
    where = page.evaluate("() => window.location.pathname + window.location.search")
    page.get_by_test_id("projects-unfiled").wait_for(state="visible", timeout=8000)
    check("group-icons", dash == f"/projects/{pid}" and label == "Open work not in a project" and where == "/everything?tab=projects",
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

    page.get_by_test_id("desk-rail-home").click()
    page.wait_for_function("() => window.location.pathname === '/'", timeout=5000)
    page.get_by_test_id("desk-rail-product").wait_for(state="visible", timeout=5000)
    shots("rail")

    # r3: the same matrix with the (now navigation-only) Additional settings popover OPEN.
    page.get_by_test_id("desk-rail-more").click()
    page.get_by_test_id("settings-overview").wait_for(state="visible", timeout=5000)
    shots("settings")
    page.keyboard.press("Escape")

    page.get_by_test_id("desk-rail-health").click()
    page.wait_for_function("() => window.location.pathname === '/health'", timeout=5000)
    page.get_by_test_id("health-page").wait_for(state="visible", timeout=5000)
    check("health", page.get_by_test_id("desk-rail-health").get_attribute("aria-current") == "page",
          current=page.get_by_test_id("desk-rail-health").get_attribute("aria-current"))
    shots("health")

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
