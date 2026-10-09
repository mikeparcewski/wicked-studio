#!/usr/bin/env python3
"""
desk_home_paths_test.py — on the Desk at 1440x700, no rendered text carries the operator's
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
  4. #464: the Desk row of a run paused before its first unit (crew's unit prompt: the goal and the
     ` ||| PHASE SCOPE:` scaffold) reads "Approve the triage step"; no "|||" on the Desk.
  5. #479: the delivered run's page — What / Where (worktree), Files referenced, Data used, Delivery (the push
     target) and every unit output (the deliver unit's push line) — names no home directory.
  6. #467: Health → pi's sign-in move: the "Running …" line reads `~/…`; no home directory in the panel.
  7. #468: a chat whose first message carries Ask's context pack (stores by absolute path) shows what
     the operator typed, the pack folded behind one line; opened, it reads `~/…`.
  8. 0 page errors.

Captures: e2e/shots/desk-home-paths-*.png. Env: FEEDBACK_PORT (default 4356).
"""

import json
import os
import re
import sys
import urllib.parse

from uxfix_fixture import FAKE_HOME, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4356"))
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

    # ── 3. #459: the Desk while /runs is held ────────────────────────────────────────
    set_fixture(origin, runs_delay_ms=2500)
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
      };
    }""")
    page.screenshot(path=str(SHOTS / "desk-home-paths-loading.png"))
    # Rows already known before /runs answers (the corpus's standing elicitation) may show; the
    # fold's calm copy, the headline's all-clear and the projects sentence may not.
    check("desk-holds-its-verdict", held["loading"] and held["headline"] == 0 and held["calm"] == 0
          and not held["nothingNeeds"] and not held["nothingStarted"] and held["projectsLoading"] == 1, **held)
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

    def scan_now(where: str) -> dict:
        got = page.evaluate(SCAN, FAKE_HOME)
        if got["text"] is not None or got["titles"]:
            page.screenshot(path=str(SHOTS / f"desk-home-paths-leak-{where}.png"))
        return got

    def open_outputs() -> None:
        for sel in OPENERS:
            for btn in page.locator(sel).all():
                try:
                    btn.click(timeout=1500)
                except Exception:
                    pass
        page.wait_for_timeout(600)

    # ── 4. #464: the pre-unit gate's Desk row says the step, never the engine's unit prompt ──
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-headline").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    desk_text = page.evaluate("() => (document.querySelector('[data-testid=\"desk\"]') || document.body).innerText")
    page.screenshot(path=str(SHOTS / "desk-home-paths-prerun-gate.png"))
    check("prerun-gate-says-the-step", "Approve the triage step" in desk_text and "|||" not in desk_text
          and "PHASE SCOPE" not in desk_text,
          snippet=desk_text[max(0, desk_text.find("SAVE20") - 40):desk_text.find("SAVE20") + 200] if "SAVE20" in desk_text else desk_text[:300])

    # ── 5. #479: the delivered run's page — rail sections and outputs ───────────────
    page.goto(f"{origin}/runs/r-home-done", wait_until="networkidle")
    page.wait_for_timeout(600)
    run_leaks: dict = {}
    sections: list[str] = []
    for acc in ("whatwhere", "files", "data", "delivery"):
        btn = page.get_by_test_id(f"rail-accordion-{acc}")
        if btn.count() == 0:
            continue
        sections.append(acc)
        if btn.first.get_attribute("aria-expanded") != "true":
            btn.first.click()
            page.wait_for_timeout(400)
        got = scan_now(f"run-{acc}")
        if got["text"] is not None or got["titles"]:
            run_leaks[acc] = {"text": got["text"], "titles": got["titles"]}
    open_outputs()
    got = scan_now("run-outputs")
    if got["text"] is not None or got["titles"]:
        run_leaks["outputs"] = {"text": got["text"], "titles": got["titles"]}
    run_text = page.evaluate("() => document.body.innerText")
    check("run-page-no-home-path", not run_leaks and {"whatwhere", "files", "data", "delivery"} <= set(sections)
          and "~/w2/" in run_text, sections=sections, leaks=run_leaks)

    # ── 6. #467: the sign-in panel's line ──────────────────────────────────────────
    set_fixture(origin, seat_week=True)
    page.goto(f"{origin}/", wait_until="networkidle")
    toggle = page.get_by_test_id("rail-health-toggle")
    toggle.wait_for(state="visible", timeout=15000)
    if toggle.get_attribute("aria-expanded") != "true":
        toggle.click()
    pi_move = page.locator('[data-testid="rail-seat-move"][data-seat="pi"] [data-testid="rail-seat-move-button"]')
    pi_move.wait_for(state="visible", timeout=15000)
    pi_move.click()
    page.get_by_test_id("signin-line").wait_for(state="visible", timeout=10000)
    line = page.get_by_test_id("signin-line").inner_text()
    got = scan_now("signin")
    page.screenshot(path=str(SHOTS / "desk-home-paths-signin.png"))
    check("signin-line-no-home-path", line.startswith('PI_CONFIG_DIR="~/w2/.wicked-worker/pi"') and got["text"] is None
          and not got["titles"], line=line, leak=got["text"])
    page.keyboard.press("Escape")
    set_fixture(origin, seat_week=False)

    # ── 7. #468: the operator's message keeps what they typed; the pack folds and says ~ ──
    set_fixture(origin, sessions=True)
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    first = page.locator('[data-testid="session-turn"][data-who="you"]').first
    first.wait_for(state="visible", timeout=15000)
    folded = first.inner_text()
    got_folded = scan_now("ask-pack-folded")
    first.get_by_test_id("context-sent-toggle").click()
    pack = first.get_by_test_id("context-sent-pack").inner_text()
    got_open = scan_now("ask-pack-open")
    page.screenshot(path=str(SHOTS / "desk-home-paths-ask-pack.png"))
    check("ask-pack-folded-and-tilde", "fix the double charge on checkout" in folded and "studio context pack" not in folded
          and got_folded["text"] is None and "studio context pack" in pack and "~/w2/state/core.db" in pack
          and got_open["text"] is None, folded=folded[:200], pack=pack[:300], leak=got_open["text"])
    set_fixture(origin, sessions=False)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
