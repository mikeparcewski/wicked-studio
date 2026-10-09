#!/usr/bin/env python3
"""
desk_settings_honest_test.py — SETTINGS AND THEME SAY WHAT IS TRUE at 1440x700 on the Desk
(studio#512, #513, #517, #518 — four defects the W12 reel found on the released 0.6.1 Desk).

  1. #512 — Theme › Site name is shown under the Desk skin: the rail's brand reads the saved name
     ("Reel studio"), and follows a change typed on the Theme page; blank keeps "wicked studio".
  2. #513 — Notifications with the browser permission DENIED: the "permission blocked" line is there
     on load and STAYS after Desktop is picked (`requestPermission()` resolves "default" while the
     permission stays "denied"); a dismissed prompt (permission "default") says the browser did not
     grant it and how to be asked again. The radio reverts to Off in both.
  3. #517 — the appearance is remembered on the client: after one load on wicked-light, a load with
     `GET /settings` refused (the daemon away) is wicked-light already at DOMContentLoaded and stays
     so — with no settings answer possible, only the cache can have painted it — and a daemon that
     answers wicked-dark wins when it does.
  4. #518 — Brand learn: Cancel during "Preparing the scratch document…" (the project's document list
     answering slowly) creates nothing: no `POST …/interactive/api/docs` ever leaves.

The browser's Notification API is stubbed per pass (an init script); the held document list (released
by the test after Cancel) and the refused settings are Playwright routes over the fixture.

Captures: e2e/shots/desk-settings-honest-*.png. Env: FEEDBACK_PORT (default 4473). Prints a JSON
report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4473"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok and os.environ.get("DESK_ALL") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
LIGHT = {**DEFAULT_APPEARANCE, "theme": "wicked-light", "accent_h": 200, "accent_s": 47, "accent_l": 25}


def notification_stub(permission: str, result: str) -> str:
    return f"""
      (() => {{
        class N {{
          static get permission() {{ return {json.dumps(permission)}; }}
          static requestPermission() {{ window.__notifAsked = (window.__notifAsked || 0) + 1; return Promise.resolve({json.dumps(result)}); }}
          constructor() {{}}
        }}
        Object.defineProperty(window, 'Notification', {{ value: N, configurable: true }});
      }})();
    """


def held(page, fn: str, timeout: int = 5000) -> bool:
    """Wait for `fn` to be truthy; False (never raise) on timeout, so a red run reports every step."""
    try:
        page.wait_for_function(fn, timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def brand(page) -> str:
    return page.get_by_test_id("desk-rail-brand").inner_text().replace("\n", " ").strip()


with sync_playwright() as p:
    browser = p.chromium.launch()
    hide = ("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # ── 1. the site name on the rail (#512) ──────────────────────────────────────────────────
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(hide)
    set_fixture(origin, wave1=True, appearance={**LIGHT, "site_name": "Reel studio"})
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    has_brand = held(page, "() => document.querySelector('[data-testid=\"desk-rail-brand\"]')?.innerText.includes('Reel studio')")
    saved = brand(page) if page.get_by_test_id("desk-rail-brand").count() else page.locator(".wk-rail-brand").inner_text().replace("\n", " ").strip()
    page.goto(f"{origin}/theme", wait_until="networkidle")
    inp = page.get_by_test_id("site-name-input")
    inp.wait_for(state="visible", timeout=10000)
    inp.fill("Acme desk")
    held(page, "() => document.querySelector('[data-testid=\"desk-rail-brand\"]')?.innerText.includes('Acme desk')")
    typed = page.locator(".wk-rail-brand").inner_text().replace("\n", " ").strip()
    inp.fill("")
    held(page, "() => /wicked\\s*studio/.test(document.querySelector('.wk-rail-brand')?.innerText || '')")
    blank = page.locator(".wk-rail-brand").inner_text().replace("\n", " ").strip()
    page.screenshot(path=str(SHOTS / "desk-settings-honest-site-name.png"))
    check("site-name-on-rail", has_brand and saved == "Reel studio" and typed == "Acme desk" and "wicked" in blank and "studio" in blank, has_brand=has_brand, saved=saved, typed=typed, blank=blank)
    ctx.close()

    # ── 2. notifications: blocked stays said; a dismissed prompt is named (#513) ─────────────
    set_fixture(origin, wave1=True, appearance=LIGHT)
    outcomes = {}
    for tag, perm, result, want in (("blocked", "denied", "default", "denied"), ("dismissed", "default", "default", "dismissed")):
        ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(hide)
        page.add_init_script(notification_stub(perm, result))
        page.goto(f"{origin}/system", wait_until="networkidle")
        page.get_by_test_id("notif-settings").wait_for(state="visible", timeout=15000)
        line_before = page.get_by_test_id("notif-permission")
        before = line_before.inner_text() if line_before.count() else None
        page.get_by_test_id("notif-desktop").click()
        page.wait_for_timeout(300)
        line = page.get_by_test_id("notif-permission")
        after = line.inner_text() if line.count() else None
        state = line.get_attribute("data-state") if line.count() else None
        asked = page.evaluate("() => window.__notifAsked || 0")
        off = page.get_by_test_id("notif-off").is_checked()
        page.screenshot(path=str(SHOTS / f"desk-settings-honest-notif-{tag}.png"))
        outcomes[tag] = {"before": before, "after": after, "state": state, "asked": asked, "off": off}
        ok = asked == 1 and off and state == want and after is not None and (
            ("blocked in browser settings" in after) if tag == "blocked" else ("did not grant" in after and "Desktop again" in after))
        if tag == "blocked":
            ok = ok and before is not None and "blocked in browser settings" in before
        check(f"notif-{tag}", ok, **outcomes[tag])
        ctx.close()

    # ── 3. the appearance survives an unreachable daemon, and the stored one wins (#517) ─────
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(hide)
    page.goto(f"{origin}/workflows", wait_until="networkidle")
    held(page, "() => document.documentElement.getAttribute('data-theme') === 'wicked-light'", 10000)
    cached = page.evaluate("() => localStorage.getItem('studio.appearance.cache')")
    # Now the daemon is away: every settings read fails at the socket.
    page.route("**/api/v1/settings*", lambda route: route.abort("connectionrefused"))
    page.goto(f"{origin}/workflows", wait_until="domcontentloaded")
    # No settings answer can arrive (refused at the socket): a theme here can only be the cache's.
    early = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    page.wait_for_timeout(1500)
    away = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    refused = page.evaluate("() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/v1/settings')).length")
    page.screenshot(path=str(SHOTS / "desk-settings-honest-theme-away.png"))
    page.unroute("**/api/v1/settings*")
    # The daemon is back and says wicked-dark: the stored record wins.
    set_fixture(origin, wave1=True, appearance={**LIGHT, "theme": "wicked-dark"})
    page.goto(f"{origin}/workflows", wait_until="networkidle")
    try:
        page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'wicked-dark'", timeout=10000)
        stored_wins = True
    except Exception:  # noqa: BLE001
        stored_wins = False
    check("theme-remembered", cached is not None and "wicked-light" in cached and early == "wicked-light" and away == "wicked-light" and stored_wins,
          cached=(cached or "")[:120], early=early, away=away, settings_resources_seen=refused, stored_wins=stored_wins)
    ctx.close()

    # ── 4. Brand learn: Cancel while preparing creates nothing (#518) ────────────────────────
    set_fixture(origin, wave1=True, appearance=LIGHT)
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(hide)
    posts: list = []
    held_lists: list = []

    def docs_route(route):
        req = route.request
        if req.method == "POST":
            posts.append(req.url)
            route.fulfill(status=201, content_type="application/json", body=json.dumps({"name": "brand-learn", "head": 0}))
            return
        # The slow list (the bridge is coming up): HELD here, released by the main flow after Cancel.
        held_lists.append(route)
    page.route("**/interactive/api/docs*", docs_route)
    page.goto(f"{origin}/theme", wait_until="networkidle")
    page.get_by_test_id("learn-input").wait_for(state="visible", timeout=10000)
    page.get_by_test_id("learn-input").fill("https://example.org/")
    page.get_by_test_id("learn-submit").click()
    try:
        page.get_by_test_id("learn-status").wait_for(state="visible", timeout=5000)
        status = page.get_by_test_id("learn-status").inner_text()
    except Exception:  # noqa: BLE001
        status = ""
    # The list request is in flight (held); Cancel lands while it is; then the list answers "no docs".
    for _ in range(50):
        if held_lists:
            break
        page.wait_for_timeout(100)
    held = len(held_lists)
    page.get_by_test_id("learn-cancel").click()
    page.wait_for_timeout(300)
    for route in held_lists:
        route.fulfill(status=200, content_type="application/json", body="[]")
    page.wait_for_timeout(2500)  # a create (if any) would follow the list at once
    idle = page.get_by_test_id("learn-status").count() == 0
    page.screenshot(path=str(SHOTS / "desk-settings-honest-brand-cancel.png"))
    check("brand-cancel-creates-nothing", "Preparing the scratch document" in status and held == 1 and posts == [] and idle,
          status=status, held_lists=held, posts=posts, idle=idle)
    ctx.close()

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
