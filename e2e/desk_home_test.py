#!/usr/bin/env python3
"""
desk_home_test.py — THE DESK (DES-STUDIO-REBUILD-001 §11 S4) at 1440x700, on the Desk.

Drives the built UI against the in-process fixture (the wave-2b queue corpus: two simple gates
grouped, one MCP elicitation, one failure; the fixture roster has a seat whose sign-in lapsed) and
proves the S4 acceptance:

  1. SHELL: data-shell="desk" (the one shell since S18d), the session rail is 236 px, and the classic left nav, the runs
     bottom bar and every KPI tile are gone.
  2. ONE COUNT (concept A, operator ruling 2026-10-12): the Desk rail badge = the landing's count
     (decisions + failures; reviews are never in it). Home v2 (2026-10-26): the landing shows ONE card,
     the top decision, and "N more waiting" for the rest; the session badges never add up past it.
  3. CHORES: the lapsed-seat sign-in (GET /roster) is not in the count and not on the landing (home
     v2 left chores off it): the Agents view shows codex as needing a sign-in. No disk chore anywhere.
  4. NO COMPOSER (concept A): the Desk has no bottom composer; its header carries the ⌘K command
     bar (it opens the palette), Chat and New job.
  5. WHILE YOU WERE AWAY: after a 3 h absence the handover renders on the Desk, from
     board/handover.ts, as its `desk-away` variant.
  6. LETTERS TYPE: a letter typed with the body focused opens the Ask dock with it (the Desk has
     no composer) and sends nothing. Chat opens the same dock; its Send sends the message exactly
     once — closing and reopening the dock sends nothing.
  7. THE RAIL (operator IA 2026-10-13): the wordmark (the Desk link) · New project · sessions ·
     Skills · MCP · Plugins · Workflows · General · Nerve Center, in that order, no
     Notifications entry; a destination navigates.
  8. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-home.png, desk-home-away.png. Env: FEEDBACK_PORT (default 4346).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4346"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
HOUR_MS = 3_600_000

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



CORPUS = dict(wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={},
              extra_frames=[])

SHELL = """() => {
  const rail = document.querySelector('[data-testid="session-rail"]');
  return {
    skin: document.querySelector('[data-shell]')?.getAttribute('data-shell') ?? null,
    rail: rail ? Math.round(rail.getBoundingClientRect().width) : null,
    leftNav: !!document.querySelector('[data-testid="left-rail"]'),
    runsBar: !!document.querySelector('[data-testid="runs-bottom-bar"]'),
    kpis: document.querySelectorAll('[data-testid="home-kpis"], [data-testid^="kpi-"], .deck-kpi').length,
    desk: !!document.querySelector('[data-testid="desk"]'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

# The landing's sentence says a count in words up to ten (board/deskHome.ts countWord).
COUNT_WORDS = {2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten"}

COUNTS = """() => {
  const h = document.querySelector('[data-testid="desk-story"][data-count]');
  const card = document.querySelector('[data-testid="desk-card"]');
  const more = document.querySelector('[data-testid="desk-needs-more"]');
  const b = document.querySelector('[data-testid="desk-rail-badge"]');
  const sessions = [...document.querySelectorAll('[data-testid="rail-session"]')]
    .map(s => ({run: s.dataset.runId, badge: Number(s.dataset.badge || '0')}));
  return {
    count: h ? Number(h.dataset.count) : null, sentence: h ? h.innerText : null,
    cardKind: card ? card.dataset.kind : null, cardKey: card ? card.dataset.key : null,
    more: more ? Number(more.dataset.count) : 0,
    badge: b ? Number(b.innerText) : 0,
    sessions,
  };
}"""

HEADER = """() => ({
  composer: !!document.querySelector('[data-testid="composer"][data-composer="desk"]'),
  command: !!document.querySelector('[data-testid="desk-rail-search"]'),
  chat: document.querySelector('[data-testid="desk-rail-chat"]')?.getAttribute('aria-label') ?? null,
  newJob: document.querySelector('[data-testid="desk-rail-new-job"]')?.getAttribute('aria-label') ?? null,
})"""

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
        fail("desk-renders", "no [data-testid=desk] on /")
    page.get_by_test_id("desk-card").wait_for(state="visible", timeout=10000)
    set_fixture(origin, extra_frames=[{"type": "elicitationCreated", "session": "e1", "elicitationId": "el-1",
                                       "message": "Which region should the backfill target?", "options": None}])
    # The elicitation joins the count (home v2: the card stays on the top decision, a gate).
    page.wait_for_function(
        "() => Number(document.querySelector('[data-testid=\"desk-story\"][data-count]')?.dataset.count || '0') >= 4", timeout=15000)
    page.mouse.move(W // 2, 20)
    page.wait_for_timeout(300)

    # ── 1. the shell ──────────────────────────────────────────────────────────────
    shell = page.evaluate(SHELL)
    check("shell", shell["skin"] == "desk" and shell["rail"] == 236 and not shell["leftNav"]
          and not shell["runsBar"] and shell["kpis"] == 0 and shell["desk"] and not shell["hscroll"], **shell)
    page.screenshot(path=str(SHOTS / "desk-home.png"))

    # ── 2. one count ──────────────────────────────────────────────────────────────
    # studio#723: the count is said only once it holds still (NEEDS_QUIET_MS) — wait for it.
    page.locator('[data-testid="desk-story"][data-count]').wait_for(state="visible", timeout=10000)
    page.get_by_test_id("desk-rail-badge").wait_for(state="visible", timeout=10000)
    c = page.evaluate(COUNTS)
    badged = [s for s in c["sessions"] if s["badge"] > 0]
    check("one-count",
          c["count"] is not None and c["count"] >= 3 and c["badge"] == c["count"]
          and c["cardKind"] in ("gate", "elicitation", "steer-request")
          and c["more"] == c["count"] - 1
          and (c["sentence"] or "").startswith(f"{COUNT_WORDS.get(c['count'], str(c['count']))} things need you")
          and len(badged) > 0 and sum(s["badge"] for s in badged) <= c["count"],
          counts=c)

    # ── 3. chores: off the landing, not counted; the Agents view has the sign-in ─────
    landing = page.evaluate("""() => ({ chores: document.querySelectorAll('[data-testid="desk-chores"], [data-testid="desk-chore"]').length,
      text: (document.querySelector('[data-testid="desk"]') || document.body).innerText.toLowerCase() })""")
    page.goto(f"{origin}/?tab=agents", wait_until="networkidle")
    codex = page.locator('[data-testid="agents-row"][data-agent="codex"]').first
    codex.wait_for(state="visible", timeout=10000)
    codex_ready = codex.get_attribute("data-ready")
    check("chores",
          landing["chores"] == 0 and codex_ready is not None and codex_ready.lower() != "ready"
          and not any(w in landing["text"] for w in ("disk space", "storage")),
          codex_ready=codex_ready, landing_chores=landing["chores"])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.locator('[data-testid="desk-story"][data-count]').wait_for(state="visible", timeout=15000)

    # ── 4. no composer: Search, Chat and New job in the rail's action row ──────────
    head = page.evaluate(HEADER)
    page.get_by_test_id("desk-rail-search").click()
    try:
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=4000)
        palette = True
    except Exception:
        palette = False
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("no-composer-command-bar", not head["composer"] and head["command"] and head["chat"] == "New chat"
          and head["newJob"] == "New job" and palette, palette=palette, **head)

    # ── 6. letters open the Ask dock with them; nothing is sent ──────────────────
    before = len(posts)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.type("hi")
    page.get_by_test_id("ask-panel").wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(500)
    typed = page.evaluate("() => document.querySelector('[data-testid=\"assist-input\"]')?.value ?? null")
    check("letters-open-the-dock", typed is not None and typed.startswith("h") and len(posts) == before, typed=typed, posts=posts[before:])
    blur = "() => document.activeElement && document.activeElement.blur()"
    page.get_by_test_id("assist-input").fill("")
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"ask-panel\"]')", timeout=5000)

    # ── 6b. Chat opens the dock; its Send sends ONCE ─────────────────────────────
    msgs = lambda: [x for x in posts if "/messages" in x]
    page.get_by_test_id("desk-rail-chat").click()
    page.get_by_test_id("ask-panel").wait_for(state="visible", timeout=10000)
    page.get_by_test_id("assist-input").fill("what changed in beta today?")
    page.get_by_test_id("assist-send").click()
    for _ in range(40):
        if msgs():
            break
        page.wait_for_timeout(250)
    page.wait_for_timeout(1500)  # a late duplicate of the first send would land in this window
    first_send = len(msgs())
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"ask-panel\"]')", timeout=5000)
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.get_by_test_id("ask-panel").wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(1500)
    check("chat-sends-once", first_send == 1 and len(msgs()) == 1, first_send=first_send, after_reopen=len(msgs()))
    page.evaluate(blur)
    page.keyboard.press("Control+Shift+A")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"ask-panel\"]')", timeout=5000)

    # ── 7. the rail (operator IA 2026-10-13): the wordmark (the Desk link) · New project · sessions ·
    #       Skills · MCP · Plugins · Workflows · General · Nerve Center (last); no Notifications entry.
    dests = page.evaluate("""() => [...document.querySelectorAll(
      '[data-testid="session-rail"] [data-nav-dest]')].map(e => e.dataset.navDest)""")
    # DES-LEARN §3.0: a fresh fixture has never used Learn, so it leads Work, above Projects.
    expected = ["page:home", "page:learn", "page:projects", "page:jobs", "page:repos", "page:report", "page:understand", "page:evaluate",
                "page:steering", "page:memory", "page:agents", "page:build", "watch"]
    page.get_by_test_id("desk-rail-build").click()
    page.get_by_test_id("build-link-settings").click()
    page.wait_for_function("() => window.location.pathname === '/system'", timeout=5000)
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
      return {variant: h.classList.contains('wk-handover--desk-away') ? 'desk-away' : 'other', inDesk: !!d && d.contains(h), text: h.innerText}; }""")
    page.screenshot(path=str(SHOTS / "desk-home-away.png"))
    check("while-you-were-away", away["variant"] == "desk-away" and away["inDesk"]
          and "While you were away" in away["text"], **away)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
