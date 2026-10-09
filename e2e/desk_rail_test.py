#!/usr/bin/env python3
"""
desk_rail_test.py — THE DESK RAIL after Amendment 5 (DES-STUDIO-REBUILD-001 Amendment 5, as revised;
S15c) at 1440x700 on the Desk.

Against the in-process fixture (wave-1 + wave-2b corpus):

  1. ORDER: top to bottom — Desk · Watchtower · the sessions list · Skills · MCP tools · Steering ·
     Health · "Additional settings"; no Notifications entry (no bell, no "notifications" nav-dest);
     no "Rules", no "Everything else".
  2. MENU: "Additional settings" lists exactly Configuration, Repositories, Workflows, Evals, Theme —
     in that order — plus the orders/away and freeze controls; nothing that redirects.
  3. NAVIGATES: Steering opens /rules and is marked current; Skills opens /skills; MCP tools opens /mcp;
     Watchtower opens /watch; Configuration opens /system (and Configuration links to Testing campaigns).
  4. 0 page errors.

Captures: e2e/shots/desk-rail.png, desk-rail-additional.png. Env: FEEDBACK_PORT (default 4366).
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
  const ids = ['desk-rail-home', 'desk-rail-watch', 'rail-group', 'desk-rail-start', 'desk-rail-skills', 'desk-rail-mcp',
               'desk-rail-steering', 'rail-health-section', 'desk-rail-more'];
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
  };
}"""

MENU = """() => {
  const m = document.querySelector('[data-testid="desk-rail-additional"]');
  const links = [...m.querySelectorAll('a[data-nav-dest]')];
  return {
    labels: links.map(a => a.innerText.trim()),
    hrefs: links.map(a => a.getAttribute('href')),
    controls: !!m.querySelector('[data-testid="desk-rail-controls"]'),
    orders: !!m.querySelector('[data-testid="standing-orders-away"], [data-testid^="standing-orders"]'),
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
          r["order"] == ['desk-rail-home', 'desk-rail-watch', 'rail-group', 'desk-rail-start', 'desk-rail-skills', 'desk-rail-mcp',
                         'desk-rail-steering', 'rail-health-section', 'desk-rail-more']
          and r["dests"] == ["watch", "section:skills", "section:mcp", "section:steering", "health"]
          and not r["bell"] and "Rules" not in r["text"] and "Everything else" not in r["text"]
          and "Steering" in r["text"] and "Skills" in r["text"] and "MCP tools" in r["text"]
          and r["steering"] == "/rules" and (r["more"] or "").startswith("Additional settings"),
          **{k: v for k, v in r.items() if k != "text"})

    # ── 2. the menu ──────────────────────────────────────────────────────────────
    page.get_by_test_id("desk-rail-more").click()
    page.get_by_test_id("desk-rail-additional").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-rail-additional.png"))
    m = page.evaluate(MENU)
    check("menu",
          m["labels"] == ["Configuration", "Repositories", "Workflows", "Evals", "Theme"]
          and m["hrefs"] == ["/system", "/repos", "/workflows", "/testing/evals", "/theme"]
          and m["controls"], **m)
    page.locator('[data-testid="desk-rail-additional"] a[href="/system"]').click()
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
    page.get_by_test_id("settings-testing-link").wait_for(state="visible", timeout=5000)
    testing_href = page.locator('[data-testid="settings-testing-link"] a').get_attribute("href")
    check("configuration", testing_href == "/testing/campaigns", testing_href=testing_href)

    # ── 3. the rail entries navigate and mark the current one ────────────────────
    went = {}
    for tid, path in (("desk-rail-steering", "/rules"), ("desk-rail-skills", "/skills"), ("desk-rail-mcp", "/mcp")):
        page.get_by_test_id(tid).click()
        page.wait_for_function(f"() => window.location.pathname === '{path}'", timeout=5000)
        went[tid] = {"path": page.evaluate("() => window.location.pathname"),
                     "current": page.get_by_test_id(tid).get_attribute("aria-current")}
    page.get_by_test_id("watch-pill").click()
    page.wait_for_function("() => window.location.pathname === '/watch'", timeout=5000)
    went["watch"] = page.evaluate("() => window.location.pathname")
    check("navigates", all(v["current"] == "page" for k, v in went.items() if k != "watch") and went["watch"] == "/watch", **went)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
