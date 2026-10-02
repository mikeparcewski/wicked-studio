#!/usr/bin/env python3
"""
desk_home_test.py — THE DESK (DES-STUDIO-REBUILD-001 §11 S4) at 1440x700, under STUDIO_SKIN=desk.

Drives the built UI against the in-process fixture (the wave-2b queue corpus: two simple gates
grouped, one MCP elicitation, one failure; the fixture roster has a seat whose sign-in lapsed) and
proves the S4 acceptance:

  1. SHELL: <html data-skin="desk">, the session rail is 236 px, and the classic left nav, the runs
     bottom bar and every KPI tile are gone.
  2. ONE COUNT: the Desk sentence's count = the Desk rail badge = the needs-you list's count, and
     every session badge in the rail names a run the needs-you list holds.
  3. CHORES: the lapsed-seat chore ("For whoever runs studio") comes from GET /roster, is not in
     the count, and no disk chore is rendered.
  4. FIT: every needs-you row, every chore and every project card ends above the Start row.
  5. WHILE YOU WERE AWAY: after a 3 h absence the handover renders on the Desk, from
     board/handover.ts, as its `desk-away` variant.
  6. LETTERS TYPE: a letter typed with the body focused lands in the Desk composer; the Start row's
     Test chip puts "Test " in it; neither sends anything. The composer's own Send hands the message
     to the Ask dock, which sends it exactly once — closing and reopening the dock sends nothing.
  7. EVERY DESTINATION: the rail's "Everything else" reaches every nav destination (the restated
     skin contract), and a destination navigates.
  8. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-home.png, desk-home-away.png. Env: FEEDBACK_PORT (default 4346).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4346"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
HOUR_MS = 3_600_000

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

CORPUS = dict(wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={},
              extra_frames=[])

SHELL = """() => {
  const rail = document.querySelector('[data-testid="session-rail"]');
  return {
    skin: document.documentElement.getAttribute('data-skin'),
    rail: rail ? Math.round(rail.getBoundingClientRect().width) : null,
    leftNav: !!document.querySelector('[data-testid="left-rail"]'),
    runsBar: !!document.querySelector('[data-testid="runs-bottom-bar"]'),
    kpis: document.querySelectorAll('[data-testid="home-kpis"], [data-testid^="kpi-"], .deck-kpi').length,
    desk: !!document.querySelector('[data-testid="desk"]'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

COUNTS = """() => {
  const q = document.querySelector('[data-testid="needs-you-queue"]');
  const h = document.querySelector('[data-testid="desk-headline"]');
  const b = document.querySelector('[data-testid="desk-rail-badge"]');
  const sessions = [...document.querySelectorAll('[data-testid="rail-session"]')]
    .map(s => ({run: s.dataset.runId, badge: Number(s.dataset.badge || '0')}));
  return {
    queue: q ? Number(q.dataset.count) : null, variant: q ? q.dataset.skinVariant : null,
    headline: h ? Number(h.dataset.count) : null, headlineText: h ? h.innerText : null,
    badge: b ? Number(b.innerText) : 0,
    sessions,
  };
}"""

KEYS = """() => [...document.querySelectorAll('[data-testid="need-row"], [data-testid="need-member"]')]
  .map(r => r.dataset.key)"""

FIT = """() => {
  const start = document.querySelector('[data-testid="desk-start-row"]');
  const top = start ? start.getBoundingClientRect().top : -1;
  const items = [...document.querySelectorAll(
    '[data-testid="need-row"], [data-testid="desk-chore"], [data-testid="desk-project"]')];
  return {startTop: Math.round(top), n: items.length,
          below: items.filter(el => el.getBoundingClientRect().bottom > top + 0.5)
                      .map(el => el.dataset.testid + ':' + (el.dataset.key || el.dataset.projectId || ''))};
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
    posts: list[str] = []
    page.on("request", lambda r: posts.append(f"{r.method} {r.url}") if r.method in ("POST", "PUT") and "/api/v1/" in r.url
            and not r.url.endswith("/settings") else None)

    set_fixture(origin, **CORPUS)
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-home-missing.png"))
        fail("desk-renders", "no [data-testid=desk] on / under the desk skin")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=10000)
    set_fixture(origin, extra_frames=[{"type": "elicitationCreated", "session": "e1", "elicitationId": "el-1",
                                       "message": "Which region should the backfill target?", "options": None}])
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"need-row\"][data-kind=\"elicitation\"]')", timeout=5000)
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"desk-chore\"]')", timeout=10000)
    page.mouse.move(W // 2, 20)
    page.wait_for_timeout(300)

    # ── 1. the shell ──────────────────────────────────────────────────────────────
    shell = page.evaluate(SHELL)
    check("shell", shell["skin"] == "desk" and shell["rail"] == 236 and not shell["leftNav"]
          and not shell["runsBar"] and shell["kpis"] == 0 and shell["desk"] and not shell["hscroll"], **shell)
    page.screenshot(path=str(SHOTS / "desk-home.png"))

    # ── 2. one count ──────────────────────────────────────────────────────────────
    c = page.evaluate(COUNTS)
    # Open every group so the members' keys are on the page.
    for t in page.locator('[data-testid="need-group-toggle"][aria-expanded="false"]').all():
        t.click()
    keys = page.evaluate(KEYS)
    runs_needing = {k.split(":", 1)[1] for k in keys if k.split(":", 1)[0] in
                    ("gate", "fail", "stall-esc", "stalled", "stranded", "elicit", "steer")}
    badged = [s for s in c["sessions"] if s["badge"] > 0]
    check("one-count",
          c["queue"] is not None and c["queue"] >= 3 and c["variant"] == "desk"
          and c["headline"] == c["queue"] and c["badge"] == c["queue"]
          and f"{c['queue']} things need you" in (c["headlineText"] or "")
          and len(badged) > 0 and all(s["run"] in runs_needing for s in badged)
          and sum(s["badge"] for s in badged) <= c["queue"],
          counts=c, keys=keys)
    for t in page.locator('[data-testid="need-group-toggle"][aria-expanded="true"]').all():
        t.click()

    # ── 3. chores ─────────────────────────────────────────────────────────────────
    chores = page.evaluate("""() => [...document.querySelectorAll('[data-testid="desk-chore"]')]
      .map(c => ({seat: c.dataset.seat, text: c.innerText}))""")
    label = page.get_by_test_id("desk-chores").inner_text()
    check("chores",
          len(chores) >= 1 and any(ch["seat"] == "codex" and "signing in again" in ch["text"] for ch in chores)
          and "For whoever runs studio" in label
          and not any(w in label.lower() for w in ("disk", "space", "storage")),
          chores=chores)

    # ── 4. everything fits above the Start row ───────────────────────────────────
    fit = page.evaluate(FIT)
    cards = page.locator('[data-testid="desk-project"]').count()
    check("fits-above-start-row", fit["startTop"] > 0 and fit["n"] > 0 and not fit["below"]
          and 1 <= cards <= 3, cards=cards, **fit)

    # ── 6. letters type; the Start row only fills the box ─────────────────────────
    before = len(posts)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.type("hi")
    typed = page.evaluate("() => document.querySelector('[data-testid=\"desk-composer-input\"]')?.value ?? null")
    page.get_by_test_id("desk-composer-input").fill("")
    page.locator('[data-testid="desk-start-chip"][data-chip="Test"]').click()
    seeded = page.evaluate("() => document.querySelector('[data-testid=\"desk-composer-input\"]')?.value ?? null")
    try:
        page.wait_for_function("() => document.activeElement?.dataset?.testid === 'desk-composer-input'", timeout=2000)
    except Exception:
        pass
    focused = page.evaluate("() => document.activeElement?.dataset?.testid ?? null")
    page.wait_for_timeout(300)
    check("letters-type-and-chips-fill", typed == "hi" and seeded == "Test " and focused == "desk-composer-input"
          and len(posts) == before, typed=typed, seeded=seeded, focused=focused, posts=posts[before:])
    page.get_by_test_id("desk-composer-input").fill("")

    # ── 6b. the composer's Send hands the message to the Ask dock, which sends it ONCE ──────
    msgs = lambda: [x for x in posts if "/messages" in x]
    page.get_by_test_id("desk-composer-input").fill("what changed in beta today?")
    page.keyboard.press("Enter")
    page.get_by_test_id("ask-panel").wait_for(state="visible", timeout=10000)
    for _ in range(40):
        if msgs():
            break
        page.wait_for_timeout(250)
    page.wait_for_timeout(1500)  # a late duplicate of the first send would land in this window
    first_send = len(msgs())
    cleared = page.evaluate("() => document.querySelector('[data-testid=\"desk-composer-input\"]')?.value ?? null")
    # Close and reopen the dock with its chord: the handoff is spent, nothing is sent again. The
    # chord is inert while focus is in a text box (EC21), so focus leaves the dock's box first.
    blur = "() => document.activeElement && document.activeElement.blur()"
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"ask-panel\"]')", timeout=5000)
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.get_by_test_id("ask-panel").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(1500)
    check("composer-hands-to-ask-once", first_send == 1 and len(msgs()) == 1 and cleared == "",
          first_send=first_send, after_reopen=len(msgs()), cleared=cleared)
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"ask-panel\"]')", timeout=5000)

    # ── 7. every destination reachable from the rail ──────────────────────────────
    page.get_by_test_id("desk-rail-more").click()
    page.get_by_test_id("desk-rail-everything").wait_for(state="visible", timeout=5000)
    dests = sorted(page.evaluate("""() => [...document.querySelectorAll(
      '[data-testid="session-rail"] [data-nav-dest]')].map(e => e.dataset.navDest)"""))
    expected = sorted([
        "section:projects", "section:execute", "section:test", "section:vibe", "section:demo",
        "section:chat", "section:repos", "section:skills", "section:mcp", "section:steering", "section:testing",
        "settings:/theme", "settings:/workflows", "settings:/system", "notifications", "health",
    ])
    page.locator('[data-testid="session-rail"] [data-nav-dest="settings:/theme"]').click()
    page.wait_for_function("() => window.location.pathname === '/theme'", timeout=5000)
    check("every-destination", dests == expected, dests=dests, expected=expected)

    # ── 5. while you were away ────────────────────────────────────────────────────
    page.evaluate(f"() => localStorage.setItem('studio.visit', JSON.stringify({{ lastSeenAt: Date.now() - {3 * HOUR_MS} }}))")
    page.goto(f"{origin}/", wait_until="networkidle")
    try:
        page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-home-away-missing.png"))
        fail("while-you-were-away", "no handover on the Desk after a 3 h absence")
    away = page.evaluate("""() => { const h = document.querySelector('[data-testid="handover-panel"]');
      const d = document.querySelector('[data-testid="desk"]');
      return {variant: h.dataset.skinVariant, inDesk: !!d && d.contains(h), text: h.innerText}; }""")
    page.screenshot(path=str(SHOTS / "desk-home-away.png"))
    away_fit = page.evaluate(FIT)
    check("while-you-were-away", away["variant"] == "desk-away" and away["inDesk"]
          and "While you were away" in away["text"] and not away_fit["below"], fit=away_fit, **away)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
