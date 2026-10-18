#!/usr/bin/env python3
"""
desk_rail_test.py — THE DESK RAIL after the operator's IA change (2026-10-13; first Amendment 5, S15c)
at 1440x700 on the Desk.

Against the in-process fixture (wave-1 + wave-2b corpus):

  1. ORDER (operator IA 2026-10-13): top to bottom — the wordmark (ONE link to the Desk, its name
     saying the needs-you badge) · New project · the sessions list · then the Workspace: Watchtower ·
     Skills · MCP · Plugins · Workflows · Theme · General · Health (set apart, last); no separate Desk
     item, no Product, no Testing, none of the Desk tabs (Repositories, Steering, Evals, Agents), no
     "General settings"; no Notifications entry (no bell, no "notifications" nav-dest).
  2. NEW PROJECT: the button opens the New project modal; Escape closes it.
  3. RETIRED /settings: the address REPLACES itself with /system, the page titled "General"; General
     no longer links to Testing.
  4. NAVIGATES: Skills, MCP, Plugins, Workflows, Theme and General open their pages and are marked
     current; Watchtower opens /watch; the wordmark opens the Desk.
  5. HEALTH: the rail's Health link says its state word, opens /health and is marked current there.
  6. 0 page errors.

Captures: e2e/shots/desk-rail.png, desk-rail-general.png (/settings landing on General), and the
rail-polish evidence set rail-polish-{rail,general,health}-{1440x700,390x844}-{light,dark}.png (dark =
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



RAIL = """() => {
  const rail = document.querySelector('[data-testid="session-rail"]');
  const ids = ['desk-rail-home', 'desk-rail-new-project', 'rail-group', 'desk-rail-watch', 'desk-rail-skills', 'desk-rail-mcp',
               'desk-rail-plugins', 'desk-rail-workflows', 'desk-rail-theme', 'desk-rail-general', 'desk-rail-health',
               'desk-rail-steering', 'desk-rail-evals', 'desk-rail-repos', 'desk-rail-more', 'desk-rail-product', 'desk-rail-testing'];
  const seen = [];
  for (const el of rail.querySelectorAll('[data-testid]')) {
    const id = el.dataset.testid;
    if (ids.includes(id) && seen[seen.length - 1] !== id) seen.push(id);
  }
  const home = rail.querySelector('[data-testid="desk-rail-home"]');
  const badge = rail.querySelector('[data-testid="desk-rail-badge"]');
  return {
    order: seen,
    dests: [...rail.querySelectorAll('[data-nav-dest]')].map(e => e.dataset.navDest),
    text: rail.innerText,
    bell: !!rail.querySelector('[data-nav-dest="notifications"], [aria-label^="Notifications"], [aria-label$="notifications"]'),
    homeLinks: rail.querySelectorAll('a[href="/"]').length,
    homeName: home?.getAttribute('aria-label') ?? null,
    badge: badge && home?.contains(badge) ? badge.innerText.trim() : null,
    watchInFoot: !!rail.querySelector('.wk-rail-foot [data-testid="desk-rail-watch"]'),
    general: rail.querySelector('[data-testid="desk-rail-general"]')?.innerText ?? null,
    footLabel: rail.querySelector('[data-testid="rail-foot-label"]')?.textContent ?? null,
    healthState: rail.querySelector('[data-testid="rail-health-state"]')?.innerText ?? null,
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
    want = ['desk-rail-home', 'desk-rail-new-project', 'rail-group', 'desk-rail-watch', 'desk-rail-skills', 'desk-rail-mcp',
            'desk-rail-plugins', 'desk-rail-workflows', 'desk-rail-theme', 'desk-rail-general', 'desk-rail-health']
    badge = r["badge"]
    check("order",
          r["order"] == want
          and r["dests"] == ["watch", "section:skills", "section:mcp", "section:plugins", "section:workflows", "section:theme", "section:general", "health"]
          and not r["bell"] and r["homeLinks"] == 1 and r["watchInFoot"]
          # The wordmark link's name says the badge (the fixture has gates waiting).
          and badge is not None and r["homeName"] in (f"wicked studio — Desk, {badge} need you", f"wicked studio — Desk, {badge} needs you")
          and all(w not in r["text"] for w in ("Rules", "Everything else", "Product", "Steering", "Evals", "Repositories", "Agents", "General settings", "Configuration", "MCP tools"))
          and "Skills" in r["text"] and "MCP" in r["text"] and "New job" in r["text"]
          and r["actions"] == ["desk-rail-new-job", "desk-rail-search", "desk-rail-chat", "desk-rail-new-project"]
          and r["general"] == "General"
          and (r["healthState"] or "").strip() in ("· all good", "· needs attention", "· failing")
          and r["footLabel"] == "Workspace",
          **{k: v for k, v in r.items() if k != "text"})

    # ── 1b. the Workspace tier MEASURED (operator 2026-10-11 20:50Z: "still large"): computed font
    #        sizes in the browser — every Workspace link is smaller than the session rows and Desk.
    sizes = page.evaluate("""() => {
      const px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
      // Any CSS colour (oklch, color-mix…) to sRGB through a 1×1 canvas; alpha < 0.5 counts as transparent.
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
      const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      // The background actually behind el: every translucent layer composited over the first opaque one.
      const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
        let out = [255, 255, 255]; for (const c of layers.reverse()) out = [0, 1, 2].map((i) => c[3] * c[i] + (1 - c[3]) * out[i]); return out; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const contrast = (el) => { const bg = bgOf(el); const f = rgb(getComputedStyle(el).color); const ink = [0, 1, 2].map((i) => f[3] * f[i] + (1 - f[3]) * bg[i]); const a = lum(ink), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const foot = [...document.querySelectorAll('[data-testid="session-rail"] .wk-rail-foot .wk-rail-link')].filter((e) => e.getAttribute('aria-current') !== 'page');
      const label = document.querySelector('[data-testid="rail-foot-label"]');
      return { desk: px(document.querySelector('[data-testid="desk-rail-new-project"]')),
               watch: px(document.querySelector('[data-testid="watch-pill"]')),
               session: px(document.querySelector('[data-testid="rail-session"] .wk-rail-session-title')),
               workspace: foot.map(px), contrast: Math.min(...foot.map(contrast)), ink: foot[0] ? getComputedStyle(foot[0]).color : null, bg: foot[0] ? bgOf(foot[0]).join(',') : null, theme: document.documentElement.dataset.theme ?? null,
               label: px(label), labelTransform: label ? getComputedStyle(label).textTransform : null, labelSpacing: label ? parseFloat(getComputedStyle(label).letterSpacing) || 0 : null };
    }""")
    ws = sizes["workspace"]
    # Operator 23:40Z: unmistakably smaller — ≤ 11px AND ≤ 0.85× the session rows, still ≥ 4.5:1.
    check("workspace-tier-measured", len(ws) >= 6 and None not in ws and sizes["desk"] == 13 and sizes["session"] == 13
          and max(ws) <= 11 and max(ws) <= 0.85 * sizes["session"] and max(ws) < sizes["desk"]
          and sizes["contrast"] >= 4.5 and sizes["labelTransform"] == "uppercase"
          and sizes["label"] is not None and sizes["label"] <= 11 and (sizes["labelSpacing"] or 0) > 0, **sizes)

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
    page.get_by_role("heading", name="General", exact=True).first.wait_for(state="visible", timeout=8000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-rail-general.png"))
    cfg = page.evaluate("""() => ({ testing: !!document.querySelector('[data-testid="settings-testing-link"]'),
      developer: !!document.querySelector('[data-testid="developer-settings"]'),
      overview: !!document.querySelector('[data-testid="settings-overview"]'),
      current: document.querySelector('[data-testid="desk-rail-general"]')?.getAttribute('aria-current') ?? null })""")
    check("general", not cfg["testing"] and not cfg["developer"] and not cfg["overview"] and cfg["current"] == "page", **cfg)

    # ── 3. the rail entries navigate and mark the current one ────────────────────
    went = {}
    for tid, path in (("desk-rail-skills", "/skills"), ("desk-rail-mcp", "/mcp"), ("desk-rail-plugins", "/plugins"),
                      ("desk-rail-workflows", "/workflows"), ("desk-rail-theme", "/theme"), ("desk-rail-general", "/system")):
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

    page.get_by_test_id("desk-rail-home").click()
    page.wait_for_function("() => window.location.pathname === '/'", timeout=5000)
    page.get_by_test_id("desk-rail-plugins").wait_for(state="visible", timeout=5000)
    shots("rail")

    # r3: the same matrix on the General page.
    page.get_by_test_id("desk-rail-general").click()
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
    shots("general")

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
