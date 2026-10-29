#!/usr/bin/env python3
"""
desk_run_plugin_test.py — a plugin observes run events it doesn't own and renders a live block in the run thread
(program DES-PLUGIN-EVENTS spike 1; operator placement 2026-10-28). Against the `run_page` corpus with `run_plugin`
on: r-rerun-mid's event log is a real rig run's recorded trail, cut at the fix step's failed floor. `/ws` is played by
the journey (page.route_web_socket), so a live frame arrives exactly when the journey sends it.

  1. MOUNT + REPLAY: one sandboxed block (`sandbox="allow-scripts"`) at the run's first unit, folded to one line that
     the plugin drew from the REPLAY alone ("Fix · step 6 of 10 · checks: 3 of 4 passed · 1 decision open"); the
     host's attribution line ("From plugin · Phase report <v> · observes run events") and its grant label. The replay
     asked the log only for the types the plugin's topics are made from (no qeAcceptanceDecided, no gateDecided).
  2. LIVE: three live frames (the decision answered, Fix done, Review started) move the summary to "Review · step 7
     of 10" within 1.5 s, and add one "Phase report updated · Review · Jump ↑" row at that point of the conversation.
  3. JUMP: the row scrolls to the block, unfolds it (the dashboard: Now, Checks, Decisions, Helpers, Time and cost)
     and highlights it.
  4. PIN / UNPIN (keyboard): Enter on Pin sticks the block to the top of the thread, folded (aria-pressed=true), the
     focus stays on Pin at its new place and nothing flashes for the move; no
     jump rows while pinned; it stays at the thread's top when the thread scrolls; a live frame makes the pinned
     summary pulse. A reload keeps it pinned (per run and
     plugin). Unpin returns it to its place at the first unit.
  5. PHONE (390x844): the block fits the width (no horizontal scroll), its buttons are 28 px targets. 0 page errors.

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
BLOCK = '[data-testid="run-plugin"]'

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
    return page.frame_locator(f"{BLOCK} iframe").first.locator("#sum-text").inner_text(timeout=10000)


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
        page.locator(BLOCK).first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        fail("mount", {"why": "the run-thread block never showed"})


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = new_page(browser, 1440, 900)
    open_run(page)

    # ── 1. mount + replay ────────────────────────────────────────────────────────────────────────────
    text, _ = wait_summary(page, "Fix · step 6 of 10", 8000)
    blk = page.locator(BLOCK).first
    attrs = blk.evaluate("""(b) => ({ placement: b.dataset.placement, folded: b.dataset.folded, pinned: b.dataset.pinned,
      sandbox: b.querySelector('iframe')?.getAttribute('sandbox'), frames: document.querySelectorAll('[data-testid="run-plugin"]').length,
      attribution: b.querySelector('[data-testid="run-plugin-attribution"]')?.textContent,
      grant: b.querySelector('[data-testid="run-plugin-grant"]')?.textContent,
      afterPlan: (() => { const plan = document.querySelector('[data-testid="chat-plan"]'); return plan === null || !!(plan.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); })(),
      beforeSteps: [...document.querySelectorAll('[data-testid="session-run"] [data-testid="chat-step"]')].every((s) => !!(b.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING)) })""")
    # The plugin's replay is the typed read (the page's own backfill reads the whole log for its own panels).
    typed = [u for u in history_urls if "type=" in u]
    types = sorted({t for u in typed for t in u.split("type=")[1].split("&")[0].replace("%2C", ",").split(",")})
    check("1-mount-replay", text == "Fix · step 6 of 10 · checks: 3 of 4 passed · 1 decision open"
          and attrs["placement"] == "thread" and attrs["folded"] == "true" and attrs["pinned"] == "false"
          and attrs["sandbox"] == "allow-scripts" and attrs["frames"] == 1 and attrs["afterPlan"] and attrs["beforeSteps"]
          and (attrs["attribution"] or "").startswith("From plugin · Phase report ") and (attrs["attribution"] or "").endswith(" · observes run events")
          and attrs["grant"] == "Built in · pre-granted"
          and len(typed) == 1 and "qeAcceptanceDecided" not in types and "gateDecided" not in types and "repoChecksEvaluated" in types,
          summary=text, attrs=attrs, types=types)
    blk.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-run-plugin-folded-1440.png"))

    # ── 2. live ──────────────────────────────────────────────────────────────────────────────────────
    if not sockets:
        fail("2-live", {"why": "studio opened no /ws"})
    send([{"type": "resumed", "ord": 6}, {"type": "unitDone", "ord": 6}, {"type": "unitExecuting", "ord": 7}])
    text, ms = wait_summary(page, "Review · step 7 of 10", 1500)
    rows = page.locator('[data-testid="run-plugin-updated"]')
    row_texts = rows.all_inner_texts()
    check("2-live", ms >= 0 and ms <= 1500 and text == "Review · step 7 of 10 · checks: 3 of 4 passed"
          and any(t.startswith("Phase report updated · Review") for t in row_texts), summary=text, ms=ms, rows=row_texts)

    # ── 3. jump ──────────────────────────────────────────────────────────────────────────────────────
    page.locator('[data-testid="run-plugin-updated"][data-ord="7"] [data-testid="run-plugin-jump"]').click()
    page.wait_for_timeout(900)
    j = blk.evaluate("""(b) => { const r = b.getBoundingClientRect(); return { folded: b.dataset.folded, flash: b.dataset.flash || null,
      inView: r.top >= 0 && r.top < innerHeight - 40, height: Math.round(r.height) }; }""")
    tiles = page.frame_locator(f"{BLOCK} iframe").first.locator(".tile .label").all_inner_texts()
    check("3-jump", j["folded"] == "false" and j["flash"] == "highlight" and j["inView"] and j["height"] > 300
          and [t.upper() for t in tiles] == ["NOW", "CHECKS", "DECISIONS", "HELPERS", "TIME AND COST"], jump=j, tiles=tiles)
    page.wait_for_timeout(1700)
    page.screenshot(path=str(SHOTS / "desk-run-plugin-expanded-1440.png"))

    # ── 4. pin / unpin, by keyboard ──────────────────────────────────────────────────────────────────
    page.locator('[data-testid="run-plugin-pin"]').first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    pinned = page.evaluate("""() => { const b = document.querySelector('[data-testid="run-plugin"]'); const t = document.querySelector('[data-testid="session-thread"]');
      const strip = b.closest('[data-testid="run-plugins-pinned"]');
      return { placement: b.dataset.placement, folded: b.dataset.folded, pressed: b.querySelector('[data-testid="run-plugin-pin"]').getAttribute('aria-pressed'),
        focusKept: document.activeElement === b.querySelector('[data-testid="run-plugin-pin"]'), flash: b.dataset.flash || null,
        sticky: strip ? getComputedStyle(strip).position : null, jumpRows: document.querySelectorAll('[data-testid="run-plugin-updated"]').length,
        firstInThread: !!(b.compareDocumentPosition(document.querySelector('[data-testid="session-turn"], [data-testid="session-run"]')) & Node.DOCUMENT_POSITION_FOLLOWING)
          && strip !== null && strip.parentElement === t,
        stored: localStorage.getItem('wicked.studio.runPlugin.pinned.wicked-phase-report.r-rerun-mid') }; }""")
    # The corpus thread is short: a tall spacer at its end lets it scroll far past the block's own place.
    page.evaluate("() => { const t = document.querySelector('[data-testid=\"session-thread\"]'); const d = document.createElement('div'); d.style.flex = '0 0 2400px'; d.setAttribute('data-journey-spacer', ''); t.appendChild(d); t.scrollTop = t.scrollHeight; }")
    page.wait_for_timeout(400)
    stuck = page.evaluate("""() => { const b = document.querySelector('[data-testid="run-plugin"]').getBoundingClientRect();
      const t = document.querySelector('[data-testid="session-thread"]').getBoundingClientRect(); return { top: Math.round(b.top - t.top), h: Math.round(b.height) }; }""")
    send([{"type": "unitDone", "ord": 7}, {"type": "unitExecuting", "ord": 8}])
    page.wait_for_timeout(250)
    flash = page.locator(BLOCK).first.get_attribute("data-flash")
    page.screenshot(path=str(SHOTS / "desk-run-plugin-pinned-1440.png"))
    stuck["thread"] = page.evaluate("() => { const t = document.querySelector('[data-testid=\"session-thread\"]'); return [t.scrollTop, t.scrollHeight, t.clientHeight]; }")
    check("4a-pin", pinned["placement"] == "pinned" and pinned["folded"] == "true" and pinned["pressed"] == "true" and pinned["focusKept"] and pinned["flash"] is None
          and pinned["sticky"] == "sticky" and pinned["jumpRows"] == 0 and pinned["firstInThread"] and pinned["stored"] == "1"
          and 0 <= stuck["top"] <= 24 and stuck["h"] <= 56 and flash == "pulse", pinned=pinned, stuck=stuck, flash=flash)
    page.reload(wait_until="domcontentloaded")
    page.locator(BLOCK).first.wait_for(state="visible", timeout=20000)
    after = page.locator(BLOCK).first.get_attribute("data-placement")
    replay_again, _ = wait_summary(page, "Fix · step 6 of 10", 8000)
    check("4b-pin-kept", after == "pinned" and replay_again.startswith("Fix · step 6 of 10"), placement=after, summary=replay_again)
    page.locator('[data-testid="run-plugin-pin"]').first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)
    back = page.evaluate("""() => { const b = document.querySelector('[data-testid="run-plugin"]'); return { placement: b.dataset.placement,
      pressed: b.querySelector('[data-testid="run-plugin-pin"]').getAttribute('aria-pressed'),
      stored: localStorage.getItem('wicked.studio.runPlugin.pinned.wicked-phase-report.r-rerun-mid') }; }""")
    check("4c-unpin", back["placement"] == "thread" and back["pressed"] == "false" and back["stored"] is None, back=back)
    ctx.close()

    # ── 5. phone ─────────────────────────────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 390, 844, theme="dark")
    open_run(page)
    wait_summary(page, "Fix · step 6 of 10", 8000)
    page.locator('[data-testid="run-plugin-fold"]').first.click()
    page.wait_for_timeout(1200)
    page.locator(BLOCK).first.scroll_into_view_if_needed()
    phone = page.evaluate("""() => { const b = document.querySelector('[data-testid="run-plugin"]').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.wk-runplugin-btn')].map((x) => Math.round(x.getBoundingClientRect().width));
      return { left: Math.round(b.left), right: Math.round(b.right), vw: innerWidth, hscroll: document.documentElement.scrollWidth > innerWidth, btns }; }""")
    page.screenshot(path=str(SHOTS / "desk-run-plugin-expanded-390.png"))
    check("5-phone", phone["left"] >= 0 and phone["right"] <= phone["vw"] and not phone["hscroll"] and all(w >= 28 for w in phone["btns"]), phone=phone)
    ctx.close()
    browser.close()

check("page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
