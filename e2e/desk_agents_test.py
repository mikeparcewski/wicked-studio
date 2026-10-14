#!/usr/bin/env python3
"""
desk_agents_test.py — THE AGENTS PAGE (DES-seats-page §2–§4) at 1440x700 and 390x844 on the Desk.

Against the in-process fixture, with GET /roster, /diagnostics and /roster/record answered from
`e2e/fixtures/agents_wire.json` (a scrubbed rig-shaped wire: Claude Code signed out, Codex kept off
repository jobs, Pi unconfirmed, Copilot out of quota with writes kept in the repository, opencode
opt-in on an unapproved version, and a reviewer-only Claude Code). Every non-GET is aborted and must
stay at zero (the page is read-only).

  1. THE TABLE: one row per agent (the reviewer-only seat folds into Claude Code), the summary count,
     each row's readiness word, and quality checks "not reported" (crew does not send it yet).
  2. DEST: no rail link (operator 2026-10-13: the Desk's Agents tab hosts the panel); ⌘K "Agents" → /agents; /everything?tab=helpers → /agents; a row's fix button → /agents?fix=<key>
     with that agent's modal; ?fix=<unknown> → /agents, no modal; the Desk sign-in chore's fallback
     address is /agents?fix=<key>.
  3. THE MODAL: Claude Code's signed-out card, its command with $HOME (no home path anywhere in the
     dialog), Copilot's safety warning sorted above its quota warning, opencode's version card with
     crew's disclosure only behind Technical details.
  4. STATES: the roster read failing hides the summary count and shows "Couldn't load agents." while
     the Health tint stays as it was (agents never drive it); an empty roster names what to install.
  5. PHONE: 390x844 renders one card per agent with a full-width fix button of at least 44 px; the
     modal is a bottom sheet with a 44 px close.
  6. MEASURE: the light theme's problem button text clears 4.5:1 on its background.
  7. 0 page errors.
  8. FIRST USE: a fresh install (no `studio.setup`) opened at `/` lands on /agents?setup=1 with the
     setup steps; an agent's sign-in opens its modal over them and closing returns to the steps.

Captures: e2e/shots/desk-agents-*.png. Env: FEEDBACK_PORT (default 4391).
"""

import copy
import datetime
import json
import os
import sys
import time
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
SHOTS = REPO / "e2e" / "shots"
WIRE = json.loads((REPO / "e2e" / "fixtures" / "agents_wire.json").read_text())
FAKE_HOME = "/Users/reel-operator"

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


def iso_ago(mins: int) -> str:
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=mins)).isoformat().replace("+00:00", "Z")


def fill_times(v):
    """The wire's '@ago:N' / '@in:N' placeholders, as ISO times relative to now (crew's bench window)."""
    if isinstance(v, dict):
        return {k: fill_times(x) for k, x in v.items()}
    if isinstance(v, list):
        return [fill_times(x) for x in v]
    if isinstance(v, str) and v.startswith("@ago:"):
        return iso_ago(int(v[5:]))
    if isinstance(v, str) and v.startswith("@in:"):
        return iso_ago(-int(v[4:]))
    if isinstance(v, str) and "@in:" in v:
        return v.split("@in:")[0] + iso_ago(-int(v.split("@in:")[1].split()[0])) + " " + " ".join(v.split("@in:")[1].split()[1:])
    return v


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
blocked: list[str] = []
refreshes: list[str] = []
mode = {"roster": "ok"}

CONTRAST = """(sel) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const bgOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
    let out = [255, 255, 255]; for (const c of layers.reverse()) out = [0, 1, 2].map((i) => c[3] * c[i] + (1 - c[3]) * out[i]); return out; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const el = document.querySelector(sel); if (!el) return null;
  const bg = bgOf(el); const f = rgb(getComputedStyle(el).color); const ink = [0, 1, 2].map((i) => f[3] * f[i] + (1 - f[3]) * bg[i]);
  const x = lum(ink), y = lum(bg); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
}"""


def wire(page) -> None:
    def roster(rt):
        if rt.request.method != "GET":
            return rt.fallback()
        if mode["roster"] == "error":
            return rt.fulfill(status=500, json={"error": "roster unavailable"})
        if mode["roster"] == "empty":
            return rt.fulfill(status=200, json={"roster": []})
        r = fill_times(copy.deepcopy(WIRE["roster"]))
        if mode["roster"] == "first":
            # First use (§5): the same agents, none signed in yet (the one simulated state).
            r = [{**s, "auth": "signed_out", "council_eligible": False, "account": None, "recent_bench": None,
                  "issues": [{"code": "signed_out", "severity": "problem", "params": {}, "message": "signed out"}]}
                 if s.get("auth") == "signed_in" else s for s in r]
            r = [{k: v for k, v in s.items() if v is not None} for s in r]
        for i, s in enumerate(r):
            if "probed_at" in s:
                s["probed_at"] = iso_ago(4 + i)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(rt.request.url).query).get("refresh")
        refreshes.extend(q or [])
        rt.fulfill(status=200, json={"roster": r, **({"refresh": {"key": q[0], "outcome": "probed"}} if q else {})})
    page.route(lambda url: urllib.parse.urlparse(url).path.endswith("/api/v1/roster"), roster)

    def diag(rt):
        resp = rt.fetch()
        d = resp.json() if resp.ok else {}
        d["seatGovernance"] = WIRE["seatGovernance"]
        d["acp"] = WIRE["acp"]
        rt.fulfill(status=200, json=d)
    page.route("**/api/v1/diagnostics", diag)
    now = int(time.time() * 1000)
    page.route("**/api/v1/roster/record*", lambda rt: rt.fulfill(status=200, json={**WIRE["record"], "since": now - 7 * 86_400_000, "until": now}))

    def guard(r):
        if r.request.method not in ("GET", "HEAD", "OPTIONS"):
            blocked.append(f"{r.request.method} {r.request.url}")
            return r.abort()
        return r.fallback()
    page.route("**/api/v1/**", guard)


def address(page) -> str:
    u = urllib.parse.urlparse(page.url)
    return u.path + (f"?{u.query}" if u.query else "")


ROWS = """() => [...document.querySelectorAll('[data-testid="agents-row"]')].map(r => ({
  key: r.dataset.agent, ready: r.dataset.ready,
  fix: r.querySelector('[data-testid="agents-fix"]')?.innerText ?? null,
  qe: r.querySelector('[data-testid="agents-qe"]')?.dataset.qe ?? null }))"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
                        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    wire(page)
    set_fixture(origin, wave1=True, wave2b=True)

    # ── 2a. no rail link (operator 2026-10-13: Agents is a Desk tab, hosted by studio-desk-v2) ──
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    rail = page.evaluate("""() => ({ link: !!document.querySelector('[data-testid="desk-rail-agents"]'), health: document.querySelector('[data-testid="desk-rail-health"]').dataset.health })""")
    page.goto(f"{origin}/agents", wait_until="networkidle")
    page.get_by_test_id("agents-table").wait_for(state="visible", timeout=10000)
    check("rail", not rail["link"] and page.get_by_test_id("agents-panel").count() == 1, **rail)
    healthy_before = rail["health"]

    # ── 1. the table ─────────────────────────────────────────────────────────────
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "desk-agents-table.png"))
    rows = page.evaluate(ROWS)
    summary = page.get_by_test_id("agents-tiles").inner_text()
    check("table", [r["key"] for r in rows] == ["claude", "codex", "pi", "copilot", "opencode"]
          and [r["ready"] for r in rows] == ["Not ready", "Ready, except repository jobs", "Ready", "Out of quota", "Not recommended"]
          and [r["fix"] for r in rows] == ["Fix 1 problem", "See 1 warning", "See 2 notes", "See 2 warnings", "See 1 warning"]
          and all(r["qe"] is None for r in rows) and "which agents can run quality checks" in page.get_by_test_id("agents-foot").inner_text() and "1 / 5" in summary and "1 more with limits · 1 held back for now · 1 not recommended · 1 signed out" in summary and "1 on a sandbox floor only, 1 on a repository boundary only" in summary and "plus 4 notes" in summary, rows=rows, summary=summary)

    # ── 3. the modals ────────────────────────────────────────────────────────────
    page.locator('[data-testid="agents-fix"][data-agent="claude"]').click()
    page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    m = page.evaluate("""() => { const d = document.querySelector('[data-testid="agents-modal"]');
      return { agent: d.dataset.agent, title: d.querySelector('h2').innerText, cards: [...d.querySelectorAll('[data-testid="agents-issue"]')].map(c => c.dataset.code),
               cmd: d.querySelector('[data-testid="agents-command"]')?.innerText ?? null, leak: d.outerHTML.includes('reel-operator'),
               role: d.getAttribute('role'), modal: d.getAttribute('aria-modal') }; }""")
    page.screenshot(path=str(SHOTS / "desk-agents-modal-claude.png"))
    check("modal-claude", address(page) == "/agents?fix=claude" and m["title"] == "Claude Code" and m["cards"][:1] == ["signed_out"]
          and m["cmd"] == 'CLAUDE_CONFIG_DIR="$HOME/.wicked-worker/claude" claude' and not m["leak"] and m["role"] == "dialog" and m["modal"] == "true", **m)
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"agents-modal\"]')", timeout=5000)
    check("modal-closes", address(page) == "/agents", landed=address(page))
    page.locator('[data-testid="agents-fix"][data-agent="copilot"]').click()
    page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    cop = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"agents-modal\"] [data-testid=\"agents-issue\"]')].map(c => c.dataset.code)")
    quota = page.locator('[data-testid="agents-issue"][data-code="quota"]').inner_text()
    page.get_by_test_id("agents-modal-close").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"agents-modal\"]')", timeout=5000)
    # A3: crew's window is studio's retry, never the provider's reset.
    check("modal-copilot-order", cop[:2] == ["fence_scoped", "quota"] and "Out of quota" in quota and "studio tries it again by" in quota
          and "not when your plan resets" in quota, cards=cop, quota=quota[:400])

    # ── 3b. the sign-in hooks' default affordances: Check now (GET ?refresh=<key>) and Sign out (a copied command) ──
    page.locator('[data-testid="agents-fix"][data-agent="codex"]').click()
    page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    foot = page.evaluate("""() => ({ check: !!document.querySelector('[data-testid="agents-check-now"]'),
      signout: document.querySelector('[data-testid="agents-signout-how"] summary')?.innerText ?? null,
      signin: !!document.querySelector('[data-testid="agents-signin"]') })""")
    page.get_by_test_id("agents-check-now").click()
    page.wait_for_function("() => ['in', 'status-only', 'cant-confirm'].includes(document.querySelector('[data-testid=\"agents-check-result\"]')?.dataset.state)", timeout=10000)
    foot["result"] = page.get_by_test_id("agents-check-result").get_attribute("data-state")
    page.get_by_test_id("agents-modal-close").click()
    check("hooks", foot["check"] and foot["signout"] == "Sign out" and not foot["signin"] and "codex" in refreshes and foot["result"] == "in", refreshes=refreshes, **foot)
    page.goto(f"{origin}/agents?fix=opencode", wait_until="networkidle")
    page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=10000)
    oc = page.evaluate("""() => { const d = document.querySelector('[data-testid="agents-modal"]'); const t = d.querySelector('[data-testid="agents-tech"]');
      const outside = d.innerText.replace(t ? t.innerText : '', '');
      return { cards: [...d.querySelectorAll('[data-testid="agents-issue"]')].map(c => c.dataset.code), tech: !!t, techClosed: t ? !t.open : null,
               leak: outside.includes('fails closed') || outside.includes('ACP') }; }""")
    # Crew's own disclosure text reaches Technical details only (§4.3).
    check("modal-opencode", oc["cards"][:1] == ["version_unproven"] and oc["tech"] and oc["techClosed"] and not oc["leak"], **oc)

    # ── 2b. the other doors in ───────────────────────────────────────────────────
    dest = {}
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    page.keyboard.press("ControlOrMeta+k")
    page.get_by_test_id("palette-input").fill("Agents")
    page.wait_for_timeout(400)
    row = page.locator('[data-testid="palette-row"][href="/agents"]').first
    dest["cmdk_label"] = row.inner_text().split("\n")[0]
    row.click()
    page.wait_for_timeout(600)
    dest["cmdk"] = address(page)
    page.goto(f"{origin}/everything?tab=helpers", wait_until="networkidle")
    page.wait_for_timeout(500)
    dest["helpers_tab"] = address(page)
    page.goto(f"{origin}/agents?fix=nobody", wait_until="networkidle")
    page.wait_for_timeout(600)
    dest["unknown_fix"] = address(page)
    dest["unknown_modal"] = page.get_by_test_id("agents-modal").count()
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    chore = page.locator('[data-testid="desk-chore"][data-seat="claude"]')
    dest["chore"] = chore.count()
    if dest["chore"]:
        chore.get_by_test_id("desk-chore-signin").click()
        page.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
        dest["chore_modal"] = page.get_by_test_id("agents-modal").get_attribute("data-agent")
        dest["chore_stays"] = address(page)
        page.keyboard.press("Escape")
    check("dest", dest["cmdk"] == "/agents" and dest["cmdk_label"].startswith("Agents") and dest["helpers_tab"] == "/agents"
          and dest["unknown_fix"] == "/agents" and dest["unknown_modal"] == 0
          and dest["chore"] == 1 and dest.get("chore_modal") == "claude" and dest.get("chore_stays") == "/", **dest)

    # ── 6. MEASURE: the light problem button ──────────────────────────────────────
    page.goto(f"{origin}/agents", wait_until="networkidle")
    page.get_by_test_id("agents-table").wait_for(state="visible", timeout=10000)
    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
    page.wait_for_timeout(200)
    light = page.evaluate(CONTRAST, '[data-testid="agents-fix"][data-tone="fail"]')
    warn = page.evaluate(CONTRAST, '[data-testid="agents-fix"][data-tone="gate"]')
    page.evaluate("() => document.documentElement.removeAttribute('data-theme')")
    page.wait_for_timeout(200)
    dark = page.evaluate(CONTRAST, '[data-testid="agents-fix"][data-tone="fail"]')
    check("measure", light is not None and light >= 4.5 and dark >= 4.5 and warn >= 4.5, light_fail=light, light_warn=warn, dark_fail=dark)

    # ── 8. FIRST USE (§5.1): a fresh install opened at `/` lands on the setup steps ──
    mode["roster"] = "first"
    set_fixture(origin, setup=None)
    pf = ctx.new_page()
    pf.on("pageerror", lambda e: errors.append(str(e)))
    wire(pf)
    pf.goto(f"{origin}/", wait_until="networkidle")
    pf.get_by_test_id("agents-setup").wait_for(state="visible", timeout=15000)
    pf.wait_for_timeout(300)
    first = pf.evaluate("""() => ({ count: document.querySelector('[data-testid="agents-setup-count"]').innerText,
      moves: [...document.querySelectorAll('[data-testid="agents-setup-move"]')].map(b => b.innerText),
      place: document.querySelector('[data-testid="agents-setup-step-project"]').dataset.done })""")
    first["landed"] = address(pf)
    pf.screenshot(path=str(SHOTS / "desk-agents-first-use.png"))
    pf.locator('[data-testid="agents-setup-move"][data-agent="pi"]').click()
    pf.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    first["modal_at"] = address(pf)
    pf.keyboard.press("Escape")
    pf.wait_for_timeout(300)
    first["back_at"] = address(pf)
    first["still_steps"] = pf.get_by_test_id("agents-setup").count()
    pf.close()
    set_fixture(origin, setup={"completedAt": 1})
    mode["roster"] = "ok"
    check("first-use", first["landed"] == "/agents?setup=1" and first["count"] == "No agent can take new jobs yet."
          and "Sign in Pi CLI" in first["moves"] and first["modal_at"] == "/agents?setup=1&fix=pi"
          and first["back_at"] == "/agents?setup=1" and first["still_steps"] == 1, **first)

    # ── 4. states: a failed roster read; an empty roster ──────────────────────────
    mode["roster"] = "error"
    page2 = ctx.new_page()
    page2.on("pageerror", lambda e: errors.append(str(e)))
    wire(page2)
    page2.goto(f"{origin}/agents", wait_until="networkidle")
    page2.get_by_test_id("agents-banner").wait_for(state="visible", timeout=10000)
    st = page2.evaluate("""() => ({ banner: document.querySelector('[data-testid="agents-banner"]').innerText,
      count: !!document.querySelector('[data-testid="agents-tiles"]'), action: !!document.querySelector('[data-testid="agents-check-all"]'),
      health: document.querySelector('[data-testid="desk-rail-health"]').dataset.health })""")
    page2.screenshot(path=str(SHOTS / "desk-agents-error.png"))
    check("error", "Couldn’t load agents." in st["banner"] and not st["count"] and not st["action"] and st["health"] == healthy_before, **st)
    page2.close()
    mode["roster"] = "empty"
    page3 = ctx.new_page()
    page3.on("pageerror", lambda e: errors.append(str(e)))
    wire(page3)
    page3.goto(f"{origin}/agents", wait_until="networkidle")
    page3.get_by_test_id("agents-empty").wait_for(state="visible", timeout=10000)
    em = page3.get_by_test_id("agents-empty").inner_text()
    check("empty", "No AI agents found on this computer." in em and "Claude Code, Codex" in em
          and page3.get_by_test_id("agents-tiles").count() == 0, text=em)
    page3.close()
    mode["roster"] = "ok"
    ctx.close()

    # ── 5. phone ─────────────────────────────────────────────────────────────────
    ph = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    pp = ph.new_page()
    pp.on("pageerror", lambda e: errors.append(str(e)))
    wire(pp)
    pp.goto(f"{origin}/agents", wait_until="networkidle")
    pp.get_by_test_id("agents-cards").wait_for(state="visible", timeout=10000)
    phone = pp.evaluate("""() => ({ cards: document.querySelectorAll('[data-testid="agents-row"]').length,
      fixH: Math.min(...[...document.querySelectorAll('[data-testid="agents-fix"]')].map(b => b.getBoundingClientRect().height)),
      overflow: document.documentElement.scrollWidth > window.innerWidth })""")
    pp.screenshot(path=str(SHOTS / "desk-agents-phone.png"))
    pp.locator('[data-testid="agents-fix"][data-agent="claude"]').click()
    pp.get_by_test_id("agents-modal").wait_for(state="visible", timeout=5000)
    sheet = pp.evaluate("""() => { const d = document.querySelector('[data-testid="agents-modal"]').getBoundingClientRect();
      const x = document.querySelector('[data-testid="agents-modal-close"]').getBoundingClientRect();
      const c = document.querySelector('[data-testid="agents-check"]').getBoundingClientRect();
      return { bottom: Math.round(window.innerHeight - d.bottom), width: Math.round(d.width), close: Math.round(Math.min(x.width, x.height)), check: Math.round(c.height) }; }""")
    pp.screenshot(path=str(SHOTS / "desk-agents-phone-modal.png"))
    pp.goto(f"{origin}/agents?fix=opencode", wait_until="networkidle")
    pp.get_by_test_id("agents-tech").first.wait_for(state="visible", timeout=10000)
    sheet["tech"] = pp.evaluate("() => Math.round(document.querySelector('[data-testid=\"agents-tech\"] summary').getBoundingClientRect().height)")
    check("phone", phone["cards"] == 5 and phone["fixH"] >= 44 and not phone["overflow"]
          and sheet["bottom"] == 0 and sheet["width"] == 390 and sheet["close"] >= 44 and sheet["check"] >= 44 and sheet["tech"] >= 44, **phone, **sheet)
    ph.close()

    check("read-only", not blocked, blocked=blocked[:5])
    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
