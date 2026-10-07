#!/usr/bin/env python3
"""
desk_everything_test.py — "SEE EVERYTHING" and the §5.4 moves (DES-STUDIO-REBUILD-001 §5.4, slice
S15c) at 1440x700 under STUDIO_SKIN=desk.

Against the in-process fixture (wave-1 + wave-2b corpus: alpha/beta/gamma with runs, one failed):

  1. THE PAGE: /everything renders five tabs — Sessions, Everything made, Helpers, Handed over, Projects — the
     tab is the address (?tab=), and the Sessions tab lists every session grouped by project.
  2. THE MOVES (replace, never push): /projects → /everything; /work?filter=failed →
     /everything?tab=sessions&filter=failed with the Blocked filter pressed and only blocked sessions
     shown; /chats and /execute → the Sessions tab; /vibe → made, documents; /demo → made, videos;
     /p/beta/chronicle → the Sessions tab scoped to beta; /runs (bare) → the Sessions tab.
     None leaves a history entry: Back from the landing returns to where the operator came from.
  3. /p/:id → the project's scoped Sessions tab, including a project with nothing started.
  4. HELPERS: the roster, one row per seat; the signed-out seat offers "Sign in →" which opens the
     sign-in panel (desk_signin proves the panel).
  5. The Desk's "See everything →" opens /everything. 0 page errors.

Captures: e2e/shots/desk-everything-*.png. Env: FEEDBACK_PORT (default 4367).
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4367"))
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

PAGE = """() => {
  const ev = document.querySelector('[data-testid="everything"]');
  const sess = document.querySelector('[data-testid="everything-sessions"]');
  return {
    present: !!ev, tab: ev?.dataset.tab ?? null,
    tabs: [...document.querySelectorAll('[data-testid="everything-tab"]')].map(t => t.innerText.trim()),
    selected: document.querySelector('[data-testid="everything-tab"][aria-selected="true"]')?.dataset.tab ?? null,
    filter: sess?.dataset.filter ?? null, project: sess?.dataset.project ?? null, count: sess ? Number(sess.dataset.count) : null,
    pressed: document.querySelector('[data-testid="everything-filter"][aria-pressed="true"]')?.dataset.filter ?? null,
    groups: [...document.querySelectorAll('[data-testid="everything-group"]')].map(g => g.dataset.projectId),
    states: [...document.querySelectorAll('[data-testid="everything-session"]')].map(s => s.dataset.state),
    kind: document.querySelector('[data-testid="everything-made"]')?.dataset.kind ?? null,
    notFound: !!document.querySelector('[data-testid="not-found"]'),
  };
}"""


def address(page) -> str:
    u = urllib.parse.urlparse(page.url)
    return u.path + (f"?{u.query}" if u.query else "")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"])

    # ── 1. the page ───────────────────────────────────────────────────────────────
    page.goto(f"{origin}/everything", wait_until="networkidle")
    page.get_by_test_id("everything").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"everything-session\"]').length >= 5", timeout=10000)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "desk-everything-sessions.png"))
    s1 = page.evaluate(PAGE)
    check("page", s1["present"] and s1["tabs"] == ["Sessions", "Everything made", "Helpers", "Handed over", "Projects"]
          and s1["selected"] == "sessions" and s1["count"] >= 5 and set(s1["groups"]) >= {"alpha", "beta", "gamma"},
          **s1)
    # A tab is a page (pushed): the address carries it.
    page.locator('[data-testid="everything-tab"][data-tab="made"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('tab') === 'made'", timeout=5000)
    page.get_by_test_id("everything-made").wait_for(state="visible", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-everything-made.png"))
    page.locator('[data-testid="everything-tab"][data-tab="handed"]').click()
    page.get_by_test_id("everything-handed").wait_for(state="visible", timeout=5000)
    check("tabs-are-addresses", address(page) == "/everything?tab=handed", address=address(page))

    # ── 2. the moves ──────────────────────────────────────────────────────────────
    MOVES = [
        ("/projects", "/everything", "sessions", None, None),
        ("/work?filter=failed", "/everything?tab=sessions&filter=failed", "sessions", "failed", None),
        ("/chats", "/everything?tab=sessions", "sessions", None, None),
        ("/execute", "/everything?tab=sessions", "sessions", None, None),
        ("/runs", "/everything?tab=sessions", "sessions", None, None),
        ("/vibe", "/everything?tab=made&kind=documents", "made", None, "documents"),
        ("/demo", "/everything?tab=made&kind=videos", "made", None, "videos"),
        ("/p/beta/chronicle", "/everything?tab=sessions&project=beta", "sessions", None, None),
    ]
    results = []
    for old, new, tab, filt, kind in MOVES:
        # Arrive from the Desk so Back has somewhere honest to go.
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
        page.evaluate("u => history.pushState({}, '', u)", old)
        page.evaluate("() => dispatchEvent(new PopStateEvent('popstate'))")
        try:
            page.wait_for_function("to => location.pathname + location.search === to", arg=new, timeout=5000)
        except Exception:
            results.append({"old": old, "ok": False, "landed": address(page)})
            continue
        page.wait_for_timeout(250)
        st = page.evaluate(PAGE)
        ok = (st["present"] and st["selected"] == tab and not st["notFound"]
              and (filt is None or (st["pressed"] == filt and st["states"] and all(x == "blocked" for x in st["states"])))
              and (kind is None or st["kind"] == kind)
              and (old != "/p/beta/chronicle" or st["project"] == "beta" and st["groups"] == ["beta"]))
        # Replaced, not pushed: Back leaves the page for where the operator came from (the Desk).
        page.go_back()
        page.wait_for_timeout(300)
        back = page.evaluate("() => location.pathname")
        results.append({"old": old, "ok": ok and back == "/", "landed": address(page) if not ok else new, "back": back,
                        "pressed": st["pressed"], "states": st["states"][:4], "kind": st["kind"], "project": st["project"]})
    page.screenshot(path=str(SHOTS / "desk-everything-moved.png"))
    check("moves", all(r["ok"] for r in results), results=results)

    # ── 3. /p/:id → the project's scoped Sessions tab ────────────────────────────
    page.goto(f"{origin}/p/alpha", wait_until="networkidle")
    page.wait_for_function("() => new URLSearchParams(location.search).get('project') === 'alpha'", timeout=10000)
    page.get_by_test_id("everything-project-header").wait_for(state="visible", timeout=10000)
    check("project-to-sessions-tab", address(page) == "/everything?tab=sessions&project=alpha", landed=address(page))
    page.goto(f"{origin}/p/gamma", wait_until="networkidle")
    page.wait_for_function("() => new URLSearchParams(location.search).get('project') === 'gamma'", timeout=10000)
    check("project-to-sessions-tab-other", address(page) == "/everything?tab=sessions&project=gamma", landed=address(page))
    page.goto(f"{origin}/p/nothing-here", wait_until="networkidle")
    page.get_by_test_id("everything").wait_for(state="visible", timeout=10000)
    page.wait_for_function("() => new URLSearchParams(location.search).get('project') === 'nothing-here'", timeout=10000)
    empty = page.get_by_test_id("everything-empty").inner_text()
    check("project-without-sessions", "Nothing has been started in this project yet" in empty, text=empty, address=address(page))

    # ── 4. helpers ────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=helpers", wait_until="networkidle")
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"everything-helper\"]').length >= 3", timeout=10000)
    helpers = page.evaluate("""() => [...document.querySelectorAll('[data-testid="everything-helper"]')]
        .map(h => ({seat: h.dataset.seat, standing: h.dataset.standing, signin: !!h.querySelector('[data-testid="everything-helper-signin"]')}))""")
    page.screenshot(path=str(SHOTS / "desk-everything-helpers.png"))
    codex = next((h for h in helpers if h["seat"] == "codex"), None)
    # Sign in is offered to every seat whose sign-in lapsed (codex is signed out; claude and agy are in).
    check("helpers", codex is not None and codex["standing"] == "signed-out" and codex["signin"]
          and all(not h["signin"] for h in helpers if h["seat"] in ("claude", "agy")), helpers=helpers)
    page.locator('[data-testid="everything-helper"][data-seat="codex"] [data-testid="everything-helper-signin"]').click()
    page.get_by_test_id("signin-panel").wait_for(state="visible", timeout=5000)
    check("helpers-signin-panel", page.get_by_test_id("signin-panel").get_attribute("data-seat") == "codex")
    page.keyboard.press("Escape")

    # ── 5. from the Desk ──────────────────────────────────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-see-everything").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-see-everything").click()
    page.wait_for_function("() => location.pathname === '/everything'", timeout=5000)
    check("desk-see-everything", page.get_by_test_id("everything").count() == 1)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
