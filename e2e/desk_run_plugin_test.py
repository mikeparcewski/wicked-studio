#!/usr/bin/env python3
"""
desk_run_plugin_test.py — a plugin observes run events it doesn't own and renders a live SECTION in the run's Details
panel (program DES-PLUGIN-EVENTS spike 1; DES-LEARN §1.2, operator 2026-10-30: phase reports move from the thread to the
right panel, as plugin-registered sections). Against the `run_page` corpus with `run_plugin` on: r-rerun-mid's event
log is a real rig run's recorded trail, cut at the fix step's failed floor. `/ws` is played by the journey
(page.route_web_socket), so a live frame arrives exactly when the journey sends it.

  1. MOUNT + REPLAY: one sandboxed section (`sandbox="allow-scripts"`) in the Details panel, between Now and Plan and
     steps (its manifest's order 10), open while the run is live; none in the thread. Its heading carries the line the
     plugin said from the REPLAY alone (`panel.summary`: "Fix · step 6 of 10 · checks: 3 of 4 passed · 1 decision
     open"), the host's Plugin mark and its attribution line. The replay asked the log only for the types the plugin's
     topics are made from (no qeAcceptanceDecided, no gateDecided).
  2. LIVE: three live frames (the decision answered, Fix done, Review started) move the heading to "Review · step 7 of
     10" within 1.5 s, and add one "Phase report updated · Review · Show in Details" row in the thread.
  3. SHOW IN DETAILS: with the section folded, the row opens it (the dashboard: Now, Checks, Decisions, Helpers, Time
     and cost), lights it and brings it into view in the panel; what is open is remembered for this run.
  4. PIN / UNPIN (keyboard): Enter on Pin moves the section to the top of the panel (before Now), aria-pressed=true,
     the focus stays on Pin at its new place; a live frame makes the pinned heading pulse. A reload keeps it pinned
     (per run and section) and keeps a folded section folded. Unpin returns it to its place after Now.
  5. PHONE (390x844): Show in Details opens the panel as its overlay with the section open; it fits the width (no
     horizontal scroll), its buttons are 28 px targets. 0 page errors.

Captures: e2e/shots/desk-run-plugin-*.png. Env: FEEDBACK_PORT (default 4661).
"""

import json
import os
import sys
import time

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4661"))
SHOTS = REPO / "e2e" / "shots"
RUN = "r-rerun-mid"
SECTION = '[data-testid="run-tab"] [data-testid="run-plugin"]'
KEY = "wicked-phase-report:phase"
PIN_STORE = f"wicked.studio.runPanel.pinned.{KEY}.{RUN}"

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

errors: list[str] = []
history_urls: list[str] = []
sockets: list = []


def new_page(browser, w: int, h: int, theme: str = "light"):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: history_urls.append(r.url) if f"/runs/{RUN}/events" in r.url else None)
    # The journey plays /ws: it keeps the socket and sends frames when it wants them.
    page.route_web_socket("**/ws", lambda ws: sockets.append(ws))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, run_page=True, run_plugin=True)
    return ctx, page


def summary(page) -> str:
    """The section heading's line: the plugin's own `panel.summary`, drawn by the host."""
    loc = page.locator(f"{SECTION} [data-testid=run-plugin-summary] .wk-runplugin-summary-text").first
    return loc.inner_text(timeout=10000) if loc.count() else ""


def wait_summary(page, prefix: str, within_ms: int) -> tuple[str, int]:
    t0 = time.monotonic()
    text = ""
    while (time.monotonic() - t0) * 1000 < within_ms + 4000:
        text = summary(page)
        if text.startswith(prefix):
            return text, int((time.monotonic() - t0) * 1000)
        page.wait_for_timeout(100)
    return text, -1


def send(frames: list[dict]) -> None:
    for f in frames:
        sockets[-1].send(json.dumps({**f, "session": RUN}))


def open_run(page) -> None:
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="domcontentloaded")
    try:
        page.locator(SECTION).first.wait_for(state="attached", timeout=20000)
    except Exception:  # noqa: BLE001
        fail("mount", {"why": "the panel section never showed"})


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = new_page(browser, 1440, 900)
    open_run(page)

    # ── 1. mount + replay ────────────────────────────────────────────────────────────────────────────
    text, _ = wait_summary(page, "Fix · step 6 of 10", 8000)
    sec = page.locator(SECTION).first
    attrs = sec.evaluate("""(s) => {
      const rows = [...document.querySelectorAll('[data-testid="run-tab"] [data-testid="run-panel-section"], [data-testid="run-tab"] [data-testid="run-plugin"]')];
      const ids = rows.map((r) => r.dataset.section ?? r.dataset.sectionKey);
      return { key: s.dataset.sectionKey, open: s.dataset.open, pinned: s.dataset.pinned,
        sandbox: s.querySelector('iframe')?.getAttribute('sandbox'), frames: document.querySelectorAll('[data-testid="run-plugin"]').length,
        inThread: document.querySelectorAll('[data-testid="session-thread"] [data-testid="run-plugin"]').length,
        order: ids.slice(0, 3), title: s.querySelector('[data-testid="run-plugin-title"]')?.textContent,
        attribution: s.querySelector('[data-testid="run-plugin-attribution"]')?.textContent,
        mark: s.querySelector('[data-testid="run-plugin-grant"]')?.textContent?.trim(),
        tone: s.querySelector('[data-testid="run-plugin-summary"]')?.dataset.tone,
        ownLine: (() => { try { return s.querySelector('iframe').contentDocument?.getElementById('sum')?.hidden ?? null; } catch { return null; } })() }; }""")
    # The plugin's replay is the typed read (the page's own backfill reads the whole log for its own panels).
    typed = [u for u in history_urls if "type=" in u]
    types = sorted({t for u in typed for t in u.split("type=")[1].split("&")[0].replace("%2C", ",").split(",")})
    check("1-mount-replay", text == "Fix · step 6 of 10 · checks: 3 of 4 passed · 1 decision open"
          and attrs["key"] == KEY and attrs["open"] == "true" and attrs["pinned"] == "false"
          and attrs["sandbox"] == "allow-scripts" and attrs["frames"] == 1 and attrs["inThread"] == 0
          and attrs["order"] == ["now", KEY, "plan"] and attrs["title"] == "Phase report" and attrs["mark"] == "Plugin" and attrs["tone"] == "wait"
          and (attrs["attribution"] or "").startswith("From plugin · Phase report ") and (attrs["attribution"] or "").endswith(" · observes run events")
          and len(typed) == 1 and "qeAcceptanceDecided" not in types and "gateDecided" not in types and "repoChecksEvaluated" in types,
          summary=text, attrs=attrs, types=types)
    page.screenshot(path=str(SHOTS / "desk-run-plugin-panel-1440.png"))

    # ── 2. live ──────────────────────────────────────────────────────────────────────────────────────
    if not sockets:
        fail("2-live", {"why": "studio opened no /ws"})
    send([{"type": "resumed", "ord": 6}, {"type": "unitDone", "ord": 6}, {"type": "unitExecuting", "ord": 7}])
    text, ms = wait_summary(page, "Review · step 7 of 10", 1500)
    rows = page.locator('[data-testid="session-thread"] [data-testid="run-plugin-updated"]')
    row_texts = rows.all_inner_texts()
    check("2-live", ms >= 0 and ms <= 1500 and text == "Review · step 7 of 10 · checks: 3 of 4 passed"
          and any(t.startswith("Phase report updated · Review") and t.endswith("Show in Details") for t in row_texts), summary=text, ms=ms, rows=row_texts)

    # ── 3. show in details ───────────────────────────────────────────────────────────────────────────
    sec.locator('[data-testid="run-plugin-fold"]').click()
    page.wait_for_timeout(300)
    folded = sec.get_attribute("data-open")
    page.locator('[data-testid="run-plugin-updated"][data-ord="7"] [data-testid="run-plugin-jump"]').click()
    page.wait_for_timeout(900)
    j = sec.evaluate("""(s) => { const r = s.getBoundingClientRect(); const p = document.querySelector('[data-testid="host-panel"]').getBoundingClientRect();
      return { open: s.dataset.open, flash: s.dataset.flash || null, inPanel: r.left >= p.left - 1 && r.right <= p.right + 1,
        inView: r.top >= 0 && r.top < innerHeight - 40, height: Math.round(r.height),
        stored: JSON.parse(localStorage.getItem('studio.runPanel.pluginOpen.v1') || '{}') }; }""")
    tiles = page.frame_locator(f"{SECTION} iframe").first.locator(".tile .label").all_inner_texts()
    check("3-show-in-details", folded == "false" and j["open"] == "true" and j["flash"] == "highlight" and j["inPanel"] and j["inView"] and j["height"] > 300
          and j["stored"].get(RUN, {}).get(KEY) is True
          and [t.upper() for t in tiles] == ["NOW", "CHECKS", "DECISIONS", "HELPERS", "TIME AND COST"], jump=j, tiles=tiles)
    page.wait_for_timeout(1700)
    page.screenshot(path=str(SHOTS / "desk-run-plugin-shown-1440.png"))

    # ── 4. pin / unpin, by keyboard ──────────────────────────────────────────────────────────────────
    page.locator('[data-testid="run-plugin-pin"]').first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    order_js = """() => [...document.querySelectorAll('[data-testid="run-tab"] [data-testid="run-panel-section"], [data-testid="run-tab"] [data-testid="run-plugin"]')].map((r) => r.dataset.section ?? r.dataset.sectionKey).slice(0, 3)"""
    pinned = page.evaluate("""(store) => { const s = document.querySelector('[data-testid="run-tab"] [data-testid="run-plugin"]');
      return { pinned: s.dataset.pinned, pressed: s.querySelector('[data-testid="run-plugin-pin"]').getAttribute('aria-pressed'),
        focusKept: document.activeElement === s.querySelector('[data-testid="run-plugin-pin"]'), stored: localStorage.getItem(store) }; }""", PIN_STORE)
    pinned["order"] = page.evaluate(order_js)
    send([{"type": "unitDone", "ord": 7}, {"type": "unitExecuting", "ord": 8}])
    page.wait_for_timeout(250)
    flash = page.locator(SECTION).first.get_attribute("data-flash")
    page.screenshot(path=str(SHOTS / "desk-run-plugin-pinned-1440.png"))
    check("4a-pin", pinned["pinned"] == "true" and pinned["pressed"] == "true" and pinned["focusKept"] and pinned["stored"] == "1"
          and pinned["order"] == [KEY, "now", "plan"] and flash == "pulse", pinned=pinned, flash=flash)
    # Folded and pinned, then a reload: both are remembered for this run.
    page.locator(SECTION).first.locator('[data-testid="run-plugin-fold"]').click()
    page.reload(wait_until="domcontentloaded")
    page.locator(SECTION).first.wait_for(state="attached", timeout=20000)
    replay_again, _ = wait_summary(page, "Fix · step 6 of 10", 8000)
    kept = {"order": page.evaluate(order_js), "open": page.locator(SECTION).first.get_attribute("data-open")}
    check("4b-pin-kept", kept["order"][0] == KEY and kept["open"] == "false" and replay_again.startswith("Fix · step 6 of 10"), kept=kept, summary=replay_again)
    page.locator('[data-testid="run-plugin-pin"]').first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    back = {"order": page.evaluate(order_js), "pressed": page.locator('[data-testid="run-plugin-pin"]').first.get_attribute("aria-pressed"),
            "stored": page.evaluate("(k) => localStorage.getItem(k)", PIN_STORE)}
    check("4c-unpin", back["order"] == ["now", KEY, "plan"] and back["pressed"] == "false" and back["stored"] is None, back=back)
    ctx.close()

    # ── 5. phone ─────────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844, theme="dark")
    open_run(page)
    wait_summary(page, "Fix · step 6 of 10", 8000)
    send([{"type": "resumed", "ord": 6}, {"type": "unitDone", "ord": 6}, {"type": "unitExecuting", "ord": 7}])
    page.locator('[data-testid="run-plugin-jump"]').first.wait_for(state="visible", timeout=8000)
    page.screenshot(path=str(SHOTS / "desk-run-plugin-thread-390.png"))
    page.locator('[data-testid="run-plugin-jump"]').first.click()
    page.wait_for_timeout(1500)
    phone = page.evaluate("""() => { const s = document.querySelector('[data-testid="run-tab"] [data-testid="run-plugin"]'); const b = s.getBoundingClientRect();
      const btns = [...s.querySelectorAll('.wk-runplugin-btn')].map((x) => Math.round(x.getBoundingClientRect().width));
      const panel = document.querySelector('[data-testid="host-panel"]');
      return { overlay: panel?.dataset.narrow ?? null, open: s.dataset.open, left: Math.round(b.left), right: Math.round(b.right), vw: innerWidth,
        hscroll: document.documentElement.scrollWidth > innerWidth, btns }; }""")
    page.screenshot(path=str(SHOTS / "desk-run-plugin-shown-390.png"))
    check("5-phone", phone["overlay"] == "true" and phone["open"] == "true" and phone["left"] >= 0 and phone["right"] <= phone["vw"]
          and not phone["hscroll"] and all(w >= 28 for w in phone["btns"]), phone=phone)
    ctx.close()
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
