#!/usr/bin/env python3
"""
desk_home_test.py — THE DESK (DES-STUDIO-REBUILD-001 §11 S4) at 1440x700, on the Desk.

Drives the built UI against the in-process fixture (the wave-2b queue corpus: two simple gates
grouped, one MCP elicitation, one failure; the fixture roster has a seat whose sign-in lapsed) and
proves the S4 acceptance:

  1. SHELL: data-shell="desk" (the one shell since S18d), the session rail is 236 px, and the classic left nav, the runs
     bottom bar and every KPI tile are gone.
  2. ONE COUNT (concept A, operator ruling 2026-10-12): the Desk rail badge = the needs-you list's
     decisions + failures (reviews are never in it), the list is drawn in labelled sections, the
     Desk opens with its one sentence, and every session badge in the rail names a run the list holds.
  3. CHORES: the lapsed-seat chore ("For whoever runs studio") comes from GET /roster, is not in
     the count, and no disk chore is rendered.
  4. NO COMPOSER (concept A): the Desk has no bottom composer; its header carries the ⌘K command
     bar (it opens the palette), Chat and New job.
  5. WHILE YOU WERE AWAY: after a 3 h absence the handover renders on the Desk, from
     board/handover.ts, as its `desk-away` variant.
  6. LETTERS TYPE: a letter typed with the body focused opens the Ask dock with it (the Desk has
     no composer) and sends nothing. Chat opens the same dock; its Send sends the message exactly
     once — closing and reopening the dock sends nothing.
  7. THE RAIL (operator IA 2026-10-13): the wordmark (the Desk link) · New project · sessions ·
     Watchtower · Skills · MCP · Plugins · Workflows · Theme · General · Health, in that order, no
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

COUNTS = """() => {
  const q = document.querySelector('[data-testid="needs-you-queue"]');
  const h = document.querySelector('[data-testid="desk-story"]');
  const inSection = (ids) => [...document.querySelectorAll('[data-testid="need-row"]')]
    .filter(r => ids.includes(r.closest('[data-section]')?.dataset.section)).reduce((n, r) => n + Number(r.dataset.count || '1'), 0);
  const b = document.querySelector('[data-testid="desk-rail-badge"]');
  const sessions = [...document.querySelectorAll('[data-testid="rail-session"]')]
    .map(s => ({run: s.dataset.runId, badge: Number(s.dataset.badge || '0')}));
  return {
    queue: q ? Number(q.dataset.count) : null, variant: q ? (q.classList.contains('wk-desk-needs') ? 'desk' : 'other') : null,
    headlineText: h ? h.innerText : null,
    badgeRows: inSection(['decision', 'failure']), reviewRows: inSection(['review']),
    sections: [...document.querySelectorAll('[data-testid="need-section"]')].map(e => e.dataset.section),
    badge: b ? Number(b.innerText) : 0,
    sessions,
  };
}"""

KEYS = """() => [...document.querySelectorAll('[data-testid="need-row"], [data-testid="need-member"]')]
  .map(r => r.dataset.key)"""

HEADER = """() => ({
  composer: !!document.querySelector('[data-testid="composer"][data-composer="desk"]'),
  command: !!document.querySelector('[data-testid="desk-command"]'),
  chat: document.querySelector('[data-testid="desk-chat"]')?.innerText.trim() ?? null,
  newJob: document.querySelector('[data-testid="desk-new-job"]')?.innerText.trim() ?? null,
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
    # studio#723: the count is said only once it holds still (NEEDS_QUIET_MS) — wait for it.
    page.get_by_test_id("desk-story").wait_for(state="visible", timeout=10000)
    page.get_by_test_id("desk-rail-badge").wait_for(state="visible", timeout=10000)
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
          and c["badge"] == c["badgeRows"] and c["badge"] == c["queue"] - c["reviewRows"] - 0
          and c["sections"][:1] == ["decision"]
          and "waiting for you" in (c["headlineText"] or "")
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

    # ── 4. no composer: the ⌘K bar, Chat and New job in the header ─────────────────
    head = page.evaluate(HEADER)
    page.get_by_test_id("desk-command").click()
    try:
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=4000)
        palette = True
    except Exception:
        palette = False
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("no-composer-command-bar", not head["composer"] and head["command"] and head["chat"] == "Chat"
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
    page.get_by_test_id("desk-chat").click()
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
    #       Watchtower · Skills · MCP · Plugins · Workflows · Theme · General · Health; no Notifications entry.
    dests = page.evaluate("""() => [...document.querySelectorAll(
      '[data-testid="session-rail"] [data-nav-dest]')].map(e => e.dataset.navDest)""")
    expected = ["watch", "section:skills", "section:mcp", "section:plugins", "section:workflows", "section:theme", "section:general", "health"]
    page.get_by_test_id("desk-rail-theme").click()
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
