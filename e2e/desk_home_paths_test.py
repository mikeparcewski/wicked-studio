#!/usr/bin/env python3
"""
desk_home_paths_test.py — under STUDIO_SKIN=desk at 1440x700, no rendered text carries the operator's
home directory on any route (studio#458 settings, #460 skills, #462 run output — the rule #444 set for
the hand-over card), and the Desk shows an honest loading state while GET /runs is held (studio#459).

Against the in-process fixture with `home_paths` on — every path it serves lives under
/Users/reel-operator: GET /settings carries `path`, GET /skills a catalog rooted there, GET /diagnostics a
skills block and a governance block, GET /repos the registered repo with the core#406 finding (whose
message names the graph file under the state home), and every unit output route the index line with the
graph file's absolute path — plus the wave-1 and team corpora, and proves:

  1. EVERY ROUTE: every address the ⌘K GO TO group lists (each parameterless destination and every
     parametric row the corpus holds) is visited; on each, every "Show output" / "View transcript" is
     opened; then document.body.innerText and every [title] attribute are free of the home directory.
  2. THE FORMATTER RAN: /system and /skills print `~/` — the fixture's paths were abbreviated, not
     left out — and the technical-details switch is off (the default layer is what was scanned).
  3. #459: with GET /runs held 2.5 s, a fresh `/` shows `desk-loading` and no headline, no calm copy
     in the needs-you fold (rows already known may show), no "Nothing has been started yet."; when
     /runs answers, the headline appears, the loading line goes, and the projects sentence is back.
  4. 0 page errors.

Captures: e2e/shots/desk-home-paths-*.png. Env: FEEDBACK_PORT (default 4356).
"""

import json
import os
import re
import sys
import urllib.parse

from uxfix_fixture import FAKE_HOME, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4356"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

# What the default layer may never print: the home directory, anywhere in the page's text or in a
# hover title. Returns the first offending snippet of each kind, and whether `~/` is on the page.
SCAN = """(home) => {
  const text = document.body.innerText || '';
  const i = text.indexOf(home);
  const titles = [...document.querySelectorAll('[title]')]
    .map(e => e.getAttribute('title') || '').filter(t => t.includes(home));
  return {
    text: i >= 0 ? text.slice(Math.max(0, i - 80), i + 140) : null,
    titles: titles.slice(0, 3),
    tilde: text.includes('~/') || [...document.querySelectorAll('[title]')].some(e => (e.getAttribute('title') || '').includes('~/')),
  };
}"""

# Every expander that hides an engine transcript: open them all, so what they hold is scanned too.
OPENERS = ('[data-testid^="unit-output-toggle-"]', '[data-testid="unit-transcript-toggle"]')

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True, team_plan=True, repo=True, repo_findings=True, governance="healthy",
                sheets=True, home_paths=True, runs_delay_ms=0)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-headline").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)

    # ── the addresses: the ⌘K GO TO group — every destination, and one row of each parametric shape ──
    def palette_rows(query: str) -> list[dict]:
        page.locator("body").click(position={"x": 700, "y": 12})
        page.keyboard.press("ControlOrMeta+k")
        page.get_by_test_id("palette-input").wait_for(state="visible", timeout=5000)
        page.get_by_test_id("palette-input").fill(query)
        page.wait_for_timeout(200)
        got = page.get_by_test_id("palette-row").evaluate_all(
            "els => els.map(e => ({ group: e.dataset.group, href: e.getAttribute('href'), label: e.innerText.split('\\n')[0] }))")
        page.keyboard.press("Escape")
        return [r for r in got if r["group"] == "go" and r["href"]]

    def shape(href: str) -> str:
        # `/p/<id>/build/<run>` → `/p/*/build/*`, `/runs/<id>/events` → `/runs/*/events`, `/s/<id>` → `/s/*`.
        return re.sub(r"/(p|projects|s|runs|build)/[^/]+", r"/\1/*", href)

    hrefs: list[str] = []
    for r in palette_rows("go:"):  # the parameterless destinations
        if r["href"] not in hrefs:
            hrefs.append(r["href"])
    seen_shapes: set[str] = set()
    for r in palette_rows("go: ·"):  # the per-item rows: one of each shape the corpus holds
        k = shape(r["href"])
        if k not in seen_shapes and r["href"] not in hrefs:
            seen_shapes.add(k)
            hrefs.append(r["href"])
    # The repo's own page is reached from /repos, not from ⌘K: add it by the registered id.
    hrefs.append("/repo-detail/studio-api")
    check("addresses", len(hrefs) >= 25 and "/system" in hrefs and "/skills" in hrefs, count=len(hrefs), hrefs=hrefs)

    # ── 1. every route: no home directory in the rendered text or a title ───────────
    offenders: list[dict] = []
    tilde_on: dict[str, bool] = {}
    for href in hrefs:
        page.goto(f"{origin}{href}", wait_until="networkidle")
        page.wait_for_timeout(400)
        for sel in OPENERS:
            for btn in page.locator(sel).all():
                try:
                    btn.click(timeout=1500)
                except Exception:
                    pass
        if any(page.locator(sel).count() for sel in OPENERS):
            page.wait_for_timeout(600)
        scan = page.evaluate(SCAN, FAKE_HOME)
        tilde_on[href] = scan["tilde"]
        if scan["text"] is not None or scan["titles"]:
            offenders.append({"route": href, "text": scan["text"], "titles": scan["titles"]})
            page.screenshot(path=str(SHOTS / f"desk-home-paths-leak-{urllib.parse.quote(href, safe='')[:40]}.png"))
    check("no-home-path-on-any-route", not offenders, routes=len(hrefs), offenders=offenders[:6])

    # ── 2. the formatter ran: ~/ on /system and /skills, with technical details off ──
    page.goto(f"{origin}/system", wait_until="networkidle")
    page.get_by_test_id("settings-path").wait_for(state="visible", timeout=10000)
    settings_line = page.get_by_test_id("settings-path").inner_text()
    tech = page.evaluate("() => { const e = document.querySelector('[data-testid=\"tech-details-toggle\"]'); return e ? e.checked : 'absent'; }")
    page.screenshot(path=str(SHOTS / "desk-home-paths-system.png"))
    page.goto(f"{origin}/skills", wait_until="networkidle")
    page.get_by_test_id("skills-root").wait_for(state="visible", timeout=10000)
    skills_root = page.get_by_test_id("skills-root").inner_text()
    page.screenshot(path=str(SHOTS / "desk-home-paths-skills.png"))
    check("formatter-ran",
          settings_line.startswith("~/") and skills_root.startswith("root ~/") and tilde_on.get("/system") and tilde_on.get("/skills")
          and tech is False,
          settings_line=settings_line, skills_root=skills_root, technical_details=str(tech))

    # ── 3. #459 / #466: the Desk while /runs is held — with repositories that have no onboarding
    #    run on record, so a repo row derived from the missing list would show ────────────────────
    set_fixture(origin, runs_delay_ms=2500, never_indexed=3)
    page.goto(f"{origin}/", wait_until="commit")
    try:
        page.get_by_test_id("desk-loading").wait_for(state="visible", timeout=6000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-home-paths-loading-missing.png"))
        text = page.evaluate("() => (document.querySelector('[data-testid=\"desk\"]') || document.body).innerText.slice(0, 400)")
        fail("desk-loading", {"why": "no [data-testid=desk-loading] while GET /runs was held", "desk_text": text})
    held = page.evaluate("""() => {
      const d = document.querySelector('[data-testid="desk"]');
      const t = d ? d.innerText : '';
      return {
        loading: d ? d.innerText.includes('Checking what needs you') : false,
        headline: document.querySelectorAll('[data-testid="desk-headline"]').length,
        calm: document.querySelectorAll('[data-testid="home-calm"]').length,
        fold: document.querySelectorAll('[data-testid="needs-you-queue"]').length,
        nothingNeeds: t.includes('Nothing needs you'),
        nothingStarted: t.includes('Nothing has been started yet'),
        projectsLoading: document.querySelectorAll('[data-testid="desk-projects-loading"]').length,
        neverIndexed: /never indexed/i.test(t),
        batchLaunch: document.querySelectorAll('[data-testid="need-batch-act"]').length,
      };
    }""")
    page.screenshot(path=str(SHOTS / "desk-home-paths-loading.png"))
    # Rows already known before /runs answers (the corpus's standing elicitation) may show; the
    # fold's calm copy, the headline's all-clear and the projects sentence may not.
    check("desk-holds-its-verdict", held["loading"] and held["headline"] == 0 and held["calm"] == 0
          and not held["nothingNeeds"] and not held["nothingStarted"] and held["projectsLoading"] == 1
          and not held["neverIndexed"] and held["batchLaunch"] == 0, **held)
    page.get_by_test_id("desk-headline").wait_for(state="visible", timeout=15000)
    after = page.evaluate("""() => ({
      loading: document.querySelectorAll('[data-testid="desk-loading"], [data-testid="desk-projects-loading"]').length,
      headline: (document.querySelector('[data-testid="desk-headline"]') || {}).innerText || '',
      fold: document.querySelectorAll('[data-testid="needs-you-queue"]').length,
      projects: document.querySelectorAll('[data-testid="desk-project"]').length,
    })""")
    page.screenshot(path=str(SHOTS / "desk-home-paths-loaded.png"))
    check("desk-answers-once-runs-arrive", after["loading"] == 0 and after["headline"] != "" and after["fold"] == 1 and after["projects"] >= 1, **after)
    set_fixture(origin, runs_delay_ms=0)

    # ── 4. #466: GET /runs FAILS — the Desk says so, with a retry; no verdict, no chore, no launch ──
    READ = """() => {
      const d = document.querySelector('[data-testid="desk"]');
      const t = d ? d.innerText : '';
      const f = document.querySelector('[data-testid="desk-runs-failed"]');
      return {
        failed: f ? f.innerText : null,
        retry: document.querySelectorAll('[data-testid="desk-runs-retry"]').length,
        loading: document.querySelectorAll('[data-testid="desk-loading"]').length,
        headline: document.querySelectorAll('[data-testid="desk-headline"]').length,
        neverIndexed: /never indexed/i.test(t),
        batchLaunch: document.querySelectorAll('[data-testid="need-batch-act"]').length,
        nothingNeeds: t.includes('Nothing needs you'),
        nothingStarted: t.includes('Nothing has been started yet'),
      };
    }"""
    set_fixture(origin, runs_fail=True, never_indexed=3)
    page.goto(f"{origin}/", wait_until="commit")
    try:
        page.get_by_test_id("desk-runs-failed").wait_for(state="visible", timeout=8000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-home-paths-failed-missing.png"))
        fail("desk-says-the-read-failed", {"why": "no [data-testid=desk-runs-failed] while GET /runs answers 500", "found": page.evaluate(READ)})
    page.wait_for_timeout(600)  # the repos read has answered: a repo row would be up by now
    failed = page.evaluate(READ)
    page.screenshot(path=str(SHOTS / "desk-home-paths-read-failed.png"))
    check("desk-says-the-read-failed", failed["failed"] is not None and "couldn’t read your work" in failed["failed"]
          and "the run store did not answer" in failed["failed"] and failed["retry"] == 1 and failed["loading"] == 0
          and failed["headline"] == 0 and not failed["neverIndexed"] and failed["batchLaunch"] == 0
          and not failed["nothingNeeds"] and not failed["nothingStarted"], **failed)
    # The daemon answers again; Try again reads the list and the Desk gives its verdict.
    set_fixture(origin, runs_fail=False)
    page.get_by_test_id("desk-runs-retry").click()
    page.get_by_test_id("desk-headline").wait_for(state="visible", timeout=15000)
    retried = page.evaluate(READ)
    check("try-again-reads-the-list", retried["failed"] is None and retried["headline"] == 1 and retried["neverIndexed"] and retried["batchLaunch"] == 1, **retried)
    set_fixture(origin, never_indexed=0)

    # ── 5. #468: a stored Ask message — the operator's words; the context pack folded behind one
    #    line; no home directory, closed or open (the pack was stored with absolute store paths) ──
    set_fixture(origin, sessions=True, run_chat_id=True)
    ask: dict = {}
    for name, href, sel in (("session", "/s/chat-ask", '[data-testid="session-turn"][data-who="you"]'),
                            ("full-chat", "/chat/chat-ask", '[data-testid="user-bubble"]')):
        page.goto(f"{origin}{href}", wait_until="networkidle")
        mine = page.locator(sel).first
        try:
            mine.wait_for(state="visible", timeout=10000)
        except Exception:
            page.screenshot(path=str(SHOTS / f"desk-home-paths-ask-{name}-missing.png"))
            fail("ask-context-is-folded", {"why": f"no operator message ({sel}) on {href}"})
        closed_scan = page.evaluate(SCAN, FAKE_HOME)
        words = mine.inner_text()
        toggle = mine.locator('[data-testid="context-sent-toggle"]')
        folded = toggle.count() == 1
        pack = ""
        if folded:
            toggle.click()
            pack = mine.locator('[data-testid="context-sent-pack"]').inner_text()
        opened_scan = page.evaluate(SCAN, FAKE_HOME)
        page.screenshot(path=str(SHOTS / f"desk-home-paths-ask-{name}.png"))
        ask[name] = {"words": words[:160], "folded": folded, "pack_has_tilde": "(~/w2/state/core.db)" in pack,
                     "leak_closed": closed_scan["text"], "leak_open": opened_scan["text"]}
    check("ask-context-is-folded", all(a["words"].startswith("why is the build slow?") and "studio context pack" not in a["words"]
                                       and a["folded"] and a["pack_has_tilde"] and a["leak_closed"] is None and a["leak_open"] is None
                                       for a in ask.values()), **ask)
    set_fixture(origin, sessions=False, run_chat_id=False)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
