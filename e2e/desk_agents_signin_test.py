#!/usr/bin/env python3
"""
desk_agents_signin_test.py — THE CONTAINER SIGN-IN (crew#1006, the login scheme C4) on the Agents tab, at 1440x700.

Against the in-process fixture with `container_login: ["claude"]`: crew marks the claude seat `sign_in: "container"`,
POST /seats/claude/container-login answers a fake terminal id, and that terminal's /ws/terminals/:id is a FAKE
login prompt (Enter = "signed in"; there is no credential anywhere, and nothing signs in for real). Every write
goes to the fixture; any other write is aborted and must stay at zero.

  1. COPY STEPS STAY ELSEWHERE: Codex (no container sign-in) keeps its copy-the-command sign-in.
  2. SIGN IN (dark): its modal has a "Sign in to claude" button and no command to copy; it opens
     the login container's terminal over the modal (POST container-login with the terminal's size), and the
     terminal shows the container's prompt.
  3. FINISH: Enter in the terminal → the container exits → the window closes → studio waits for crew's ingest
     (GET container-login 404 → 200) → re-checks (GET /roster?refresh=claude) → "claude is signed in." and
     the row flips off "Not ready".
  4. SIGN OUT: the modal's "Sign claude out" → POST container-logout → "claude is signed out."
  5. SIGN IN (light): the same flow under the light theme (the terminal's colours are read when it opens).
  6. CLOSE EARLY: closing the login window before finishing ingests nothing and the re-check says still signed out.
  7. 0 page errors, 0 aborted writes.

Captures: e2e/shots/desk-agents-signin-*.png. Env: FEEDBACK_PORT (default 4393).
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4393"))
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
blocked: list[str] = []
# The container sign-in's own writes, matched exactly and only toward the fixture (codex r4: never a live daemon).
WRITES = (r"^/api/v1/seats/[^/]+/container-(login|logout)$", r"^/api/v1/terminals/[^/]+/(close|resize)$")


def container_posts() -> list[dict]:
    with urllib.request.urlopen(f"{origin}/__fixture/container-login-posts", timeout=10) as res:
        return [p for p in json.loads(res.read())["posts"] if "/seats/" in p["path"]]


def fixture_origin(url: str) -> bool:
    """Exactly the fixture's scheme + authority (http or its ws twin), never a prefix match."""
    u, o = urllib.parse.urlparse(url), urllib.parse.urlparse(origin)
    return u.netloc == o.netloc and u.scheme in ("http", "ws")


def guard(rt):
    """Only the container sign-in's own writes reach the fixture; anything else is aborted and counted."""
    u = urllib.parse.urlparse(rt.request.url)
    own = fixture_origin(rt.request.url) and any(re.match(w, u.path) for w in WRITES)
    if rt.request.method not in ("GET", "HEAD", "OPTIONS") and not own:
        blocked.append(f"{rt.request.method} {rt.request.url}")
        return rt.abort()
    return rt.fallback()


FOCUS_IN_MODAL = "() => !!document.activeElement && !!document.activeElement.closest('[data-testid=\"agents-modal\"]')"
TERM_TEXT = "() => document.querySelector('[data-testid=\"agents-login\"] .xterm-rows')?.innerText ?? ''"


def open_modal(page, key: str) -> None:
    page.goto(f"{origin}/agents?fix={key}", wait_until="networkidle")
    page.locator(f'[data-testid="agents-modal"][data-agent="{key}"]').wait_for(state="visible", timeout=10000)


def row_ready(page, key: str) -> str:
    return page.evaluate(f"() => document.querySelector('[data-testid=\"agents-row\"][data-agent=\"{key}\"]')?.dataset.ready ?? null")


def sign_in(page, theme: str) -> dict:
    """Sign in → the login terminal → Enter → signed in. Returns what it saw."""
    open_modal(page, "claude")
    want = "light" if theme == "light" else None
    page.wait_for_function(f"() => document.documentElement.getAttribute('data-theme') === {json.dumps(want)}", timeout=10000)
    modal = page.get_by_test_id("agents-modal")
    seen = {"name": modal.locator("h2").inner_text(), "cmd": modal.get_by_test_id("agents-command").count(),
            "button": modal.get_by_test_id("agents-signin").inner_text(), "before": row_ready(page, "claude")}
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / f"desk-agents-signin-modal-{theme}.png"))
    modal.get_by_test_id("agents-signin").click()
    login = page.get_by_test_id("agents-login")
    login.wait_for(state="visible", timeout=5000)
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-login\"]')?.dataset.state === 'open'", timeout=10000)
    page.wait_for_function(f"() => ({TERM_TEXT})().includes('Press Enter')", timeout=10000)
    seen["title"] = login.locator("h2").inner_text()
    seen["line"] = page.get_by_test_id("agents-login-line").inner_text()
    seen["term"] = page.evaluate(TERM_TEXT)
    seen["waiting"] = modal.get_by_test_id("agents-check-result").get_attribute("data-state")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / f"desk-agents-signin-terminal-{theme}.png"))
    page.locator('[data-testid="agents-login"] .xterm-helper-textarea').focus()
    page.keyboard.press("Enter")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"agents-login\"]')", timeout=10000)
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state === 'container-in'", timeout=20000)
    seen["result"] = page.get_by_test_id("agents-check-result").inner_text()
    seen["after"] = row_ready(page, "claude")
    # Focus came back to the agent's modal once the login window closed (codex r7: a real browser enforces inert).
    seen["focus_back"] = page.evaluate(FOCUS_IN_MODAL)
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / f"desk-agents-signin-done-{theme}.png"))
    return seen


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
                        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/api/v1/**", guard)
    # Anything not aimed at the fixture is refused too (a dist built against a live daemon must not reach it).
    page.route(lambda url: urllib.parse.urlparse(url).scheme in ("http", "https") and not fixture_origin(url),
               lambda rt: (rt.request.method not in ("GET", "HEAD", "OPTIONS") and blocked.append(f"{rt.request.method} {rt.request.url}"), rt.abort()))
    # WebSockets too (codex r5): only the fixture's own; any other is closed without ever connecting.
    page.route_web_socket(lambda url: not fixture_origin(url), lambda ws: (blocked.append(f"WS {ws.url}"), ws.close()))
    set_fixture(origin, wave1=True, wave2b=True, reset_container_login=True, container_login=["claude"],
                roster_signed_in={"claude": False, "codex": False}, roster_login_lines={"codex": "codex login"},
                roster_probed=[], roster_refresh_delay_ms=300,
                container_ingest_delay_ms=1500)

    # ── 1. a seat without a container sign-in keeps its copy steps ─────────────────
    open_modal(page, "codex")
    m = page.get_by_test_id("agents-modal")
    check("copy-elsewhere", m.get_by_test_id("agents-signin").count() == 0 and m.get_by_test_id("agents-command").count() >= 1,
          cmds=m.get_by_test_id("agents-command").all_inner_texts())
    page.keyboard.press("Escape")

    # ── 2–3. sign in, dark ───────────────────────────────────────────────────────
    dark = sign_in(page, "dark")
    posts = container_posts()
    name = dark["name"]  # the fixture's seat is named as crew names it ("claude")
    check("signin-dark", name != "" and dark["cmd"] == 0 and dark["button"] == f"Sign in to {name}" and dark["before"] == "Not ready"
          and dark["title"] == f"Sign in to {name}" and f"Follow {name}" in dark["line"] and "Fixture login container" in dark["term"]
          and dark["waiting"] == "signing-in" and dark["focus_back"] and f"{name} is signed in." in dark["result"] and dark["after"] not in (None, "Not ready")
          and [x["path"] for x in posts] == ["/api/v1/seats/claude/container-login"]
          and isinstance(posts[0]["body"].get("cols"), int) and isinstance(posts[0]["body"].get("rows"), int), **dark, posts=posts)

    # ── 4. sign out ──────────────────────────────────────────────────────────────
    page.get_by_test_id("agents-signout").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state === 'out-done'", timeout=15000)
    out = {"result": page.get_by_test_id("agents-check-result").inner_text(), "ready": row_ready(page, "claude"),
           "posts": [x["path"] for x in container_posts()]}
    check("signout", f"{name} is signed out." in out["result"] and out["ready"] == "Not ready"
          and out["posts"][-1] == "/api/v1/seats/claude/container-logout", **out)

    # ── 5. sign in, light ────────────────────────────────────────────────────────
    # The stored appearance (GET /settings) is what the app applies; the terminal reads its colours at open.
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": "light"})
    light = sign_in(page, "light")
    theme = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
    check("signin-light", theme == "light" and f"{name} is signed in." in light["result"] and light["after"] not in (None, "Not ready"), **light, theme=theme)

    # ── 6. close early: nothing ingested, still signed out ───────────────────────
    set_fixture(origin, roster_signed_in={"claude": False, "codex": False})
    open_modal(page, "claude")
    page.get_by_test_id("agents-modal").get_by_test_id("agents-signin").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-login\"]')?.dataset.state === 'open'", timeout=10000)
    page.wait_for_function(f"() => ({TERM_TEXT})().includes('Press Enter')", timeout=10000)
    page.get_by_test_id("agents-login-close").click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state === 'still'", timeout=25000)
    early = {"result": page.get_by_test_id("agents-check-result").inner_text(), "ready": row_ready(page, "claude"),
             "focus_back": page.evaluate(FOCUS_IN_MODAL)}
    check("close-early", "Still signed out." in early["result"] and early["ready"] == "Not ready" and early["focus_back"], **early)

    # ── 7. clean ─────────────────────────────────────────────────────────────────
    check("clean", errors == [] and blocked == [], errors=errors, blocked=blocked)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
