#!/usr/bin/env python3
"""
feedback3_sliceM_test.py — the DES-FEEDBACK-003 slice-M gate: the five-path
accordion rail (§1–§3), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py) with the repo switch ON so the Repositories accordion and
the palette corpus have a real row.

The slice DOM ACs, verbatim from §3.6:

  1. `[data-testid="rail-heading-projects|make|chat|repos|settings"]` all
     render; settings' row contains NO `heading-dashboard`/`heading-new`
     child; the other four contain both.
  2. At most one `[data-testid^="rail-heading-"]` has `aria-expanded="true"`
     at any time — asserted after clicking two different titles in sequence
     (EC26).
  3. Clicking Make's title expands it (chevron rotates, contents render);
     clicking it again collapses (zero open — legal).
  4. On load at `/p/q3-review-deck/build`, Projects is expanded and no other;
     on load at `/`, none.
  5. Projects' ▦ is an `<a href="/projects">`; Make's ▦ → `/make` (and lands
     on a real page, never a 404); each ＋ fires its §2.1 action (Make's opens
     `[data-testid="make-picker"]` with exactly 3 rows).
  6. The old testids `rail-quick`, `rail-actions`, `rail-runs`,
     `rail-settings-section` are ABSENT from the DOM (supersession, §8.1).
  7. Repositories expansion fires at most one `GET /repos` (cold cache), and
     NO interval poll exists (grep: no `setInterval` in LeftSidebar.tsx).
  8. Collapsed rail shows exactly 5 glyph links; entering `/p/x/document`
     auto-collapses (slice-F behavior preserved).

Plus the standing constraints: the RAIL adds zero `GET /repos` outside the
expand gesture (the board's own mount fetches are the board's — counted from
a settled page, the idle window must stay at zero),
the palette corpus still full after the rail data moved (its project/repo
sources ride the shared stores/cache — §8.4 untouched), and the §3.2
mid-territory rule: a manual collapse survives moves between one project's
modes.

Captures (§10.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback3-M-rail-headings.png   five headings, Make expanded, W2 fixture
  feedback3-M-make-picker.png     the ＋ popover open, 3 rows
  feedback3-M-rail-collapsed.png  the 48px glyph column

Finally: `npm run lint` must exit 0 with zero raw-color findings (EC15 is
ERROR repo-wide).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK3_PORT (default 4361),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK3_PORT = int(os.environ.get("FEEDBACK3_PORT", "4361"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK3_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

HEADING_KEYS = ["projects", "make", "chat", "repos", "settings"]

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server; repo switch ON (a row for the accordion) ──
start_server(FEEDBACK3_PORT, dist)
set_fixture(ORIGIN, repo=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []
repo_gets: list[str] = []

EXPANDED = """() => Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'))
    .filter(h => h.getAttribute('aria-expanded') === 'true')
    .map(h => h.dataset.testid.replace('rail-heading-', ''))"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: repo_gets.append(r.url)
            if r.method == "GET" and r.url.endswith("/api/v1/repos") else None)

    # Freeze Date.now at NOW0 + 5s BEFORE the app boots so every rendered age
    # is deterministic in the captures.
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    def expanded() -> list:
        return page.evaluate(EXPANDED)

    # ── AC 4b + 1 + 6: load at `/` — five closed headings, anatomy, supersession ─
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="left-rail"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)

    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    dom = page.evaluate(
        """keys => {
             const q = s => document.querySelector(s);
             const anatomy = {};
             for (const k of keys) {
               const h = q(`[data-testid="rail-heading-${k}"]`);
               anatomy[k] = h === null ? null : {
                 dash: h.querySelector('[data-testid="heading-dashboard"]')?.getAttribute('href') ?? null,
                 plus: !!h.querySelector('[data-testid="heading-new"]'),
                 expanded: h.getAttribute('aria-expanded'),
               };
             }
             return {
               anatomy,
               headingOrder: Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'))
                 .map(h => h.dataset.testid.replace('rail-heading-', '')),
               // §8.1 supersession: the slice-A zones are GONE from the DOM.
               quick: !!q('[data-testid="rail-quick"]'),
               actions: !!q('[data-testid="rail-actions"]'),
               runs: !!q('[data-testid="rail-runs"]'),
               settingsSection: !!q('[data-testid="rail-settings-section"]'),
               // §6.1/§8.2 preserved: bell + chrome anatomy untouched.
               bell: !!q('[aria-label="Notifications"], [aria-label$="notifications"]'),
               logoSlot: !!q('[data-testid="logo-slot"]'),
               connectionDot: q('[data-testid="connection-dot"]')?.dataset.state ?? null,
             }; }""",
        HEADING_KEYS,
    )
    a = dom["anatomy"]
    anatomy_ok = (
        all(a[k] is not None for k in HEADING_KEYS)
        and a["projects"]["dash"] == "/projects" and a["projects"]["plus"]
        and a["make"]["dash"] == "/make" and a["make"]["plus"]
        and a["chat"]["dash"] == "/chats" and a["chat"]["plus"]
        and a["repos"]["dash"] == "/repos" and a["repos"]["plus"]
        and a["settings"]["dash"] is None and not a["settings"]["plus"]
        and dom["headingOrder"] == HEADING_KEYS
    )
    none_open_on_home = all(a[k]["expanded"] == "false" for k in HEADING_KEYS)
    superseded_ok = not (dom["quick"] or dom["actions"] or dom["runs"] or dom["settingsSection"])
    preserved_ok = dom["bell"] and dom["logoSlot"] and dom["connectionDot"] == "connected"
    # Page-wide GETs at this point belong to the BOARD (App.tsx ws bootstrap +
    # useBoardModel's repo join — pre-existing, not the rail's); the rail's own
    # gesture rule is pinned below (AC 7: zero during idle, ≤1 on expand).
    mount_repo_gets_page_wide = len(repo_gets)

    # ── AC 3 + 2 (EC26): title clicks — expand, exclusivity, zero-open ─────────
    page.locator('[data-testid="rail-title-make"]').click()
    make_expands = settled(
        """() => { const h = document.querySelector('[data-testid="rail-heading-make"]');
                   const c = h?.querySelector('[data-testid="rail-chevron"]');
                   return h?.getAttribute('aria-expanded') === 'true'
                       && !!c && getComputedStyle(c).transform !== 'none'; }""",
        timeout=5000,
    )
    make_only = expanded() == ["make"]

    # ── Capture 1: five headings, Make expanded, W2 fixture ────────────────────
    page.locator('[data-testid="left-rail"]').screenshot(
        path=str(VSHOTS / "feedback3-M-rail-headings.png"))

    page.locator('[data-testid="rail-title-projects"]').click()
    projects_only = settled(
        """() => { const open = Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'))
                     .filter(h => h.getAttribute('aria-expanded') === 'true');
                   return open.length === 1
                       && open[0].dataset.testid === 'rail-heading-projects'; }""",
        timeout=5000,
    )
    # Projects' accordion carries the board-ordered rows (C3: reads, never re-sorts).
    projects_rows = page.evaluate(
        """() => Array.from(document.querySelectorAll(
             '[data-testid="rail-heading-projects"] [data-testid="rail-project"]'))
             .map(r => r.dataset.projectId)""")
    projects_rows_ok = projects_rows[:4] == [
        "q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"] and len(projects_rows) <= 6

    page.locator('[data-testid="rail-title-projects"]').click()
    zero_open_ok = settled(
        """() => Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'))
              .every(h => h.getAttribute('aria-expanded') === 'false')""",
        timeout=5000,
    )

    # ── AC 5: the ＋ actions ────────────────────────────────────────────────────
    # Projects ＋ → the slice-A NewProjectModal, unchanged.
    page.locator('[data-testid="rail-heading-projects"] [data-testid="heading-new"]').click()
    modal_ok = settled("""() => !!document.querySelector('[data-testid="new-project-modal"]')""", timeout=5000)
    page.keyboard.press("Escape")
    modal_closes = settled("""() => !document.querySelector('[data-testid="new-project-modal"]')""", timeout=5000)

    # Make ＋ → the three-way picker (MODE_SPECS vocabulary, §3.4).
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-new"]').click()
    picker_opens = settled("""() => !!document.querySelector('[data-testid="make-picker"]')""", timeout=5000)
    picker = page.evaluate(
        """() => { const rows = Array.from(document.querySelectorAll(
                     '[data-testid="make-picker"] [data-testid="make-picker-row"]'));
                   return { count: rows.length,
                            modes: rows.map(r => r.dataset.mode),
                            text: rows.map(r => r.textContent) }; }""")
    picker_ok = (picker_opens and picker["count"] == 3
                 and picker["modes"] == ["build", "document", "video"]
                 and all(g in "".join(picker["text"]) for g in ("⚙", "▤", "▶")))

    # ── Capture 2: the ＋ popover open, 3 rows ─────────────────────────────────
    page.locator('[data-testid="left-rail"]').screenshot(
        path=str(VSHOTS / "feedback3-M-make-picker.png"))

    # Build tine → the unbound launch form (slice B semantics).
    page.locator('[data-testid="make-picker-row"][data-mode="build"]').click()
    build_tine_ok = settled(
        """() => window.location.pathname === '/runs/new'
              && !document.querySelector('[data-testid="make-picker"]')""")

    # Chat ＋ → /chat/new; Repositories ＋ → /repos/new (existing create routes).
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="rail-heading-chat"] [data-testid="heading-new"]').click()
    chat_plus_ok = settled("""() => window.location.pathname === '/chat/new'""")
    chat_territory_ok = expanded() == ["chat"]  # /chat/new is Chat's territory (§3.2)
    page.locator('[data-testid="rail-heading-repos"] [data-testid="heading-new"]').click()
    repos_plus_ok = settled("""() => window.location.pathname === '/repos/new'""")

    # ── AC 5 (▦): Make's ▦ lands on a real /make page — never a 404 ────────────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-dashboard"]').click()
    make_dash_ok = settled(
        """() => window.location.pathname === '/make'
              && !!document.querySelector('[data-testid="make-placeholder"]')""")
    make_dash_territory_ok = expanded() == ["make"]

    # ── AC 7: fetch-on-expand, at most one GET /repos, no poll ─────────────────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="rail-heading-repos"]').wait_for(timeout=30000)
    # Let the BOARD's own mount fetches (its repo join) land before counting:
    # the rail's discipline is measured from a settled page.
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.wait_for_timeout(1500)
    repo_gets.clear()
    page.wait_for_timeout(6000)  # longer than the retired 5s poll interval
    gets_before_gesture = len(repo_gets)
    page.locator('[data-testid="rail-title-repos"]').click()
    repo_row_ok = settled(
        """() => document.querySelectorAll(
             '[data-testid="rail-heading-repos"] [data-testid="rail-repo"]').length === 1""",
        timeout=10000,
    )
    # Collapse and re-expand: the session cache is warm — no second GET.
    page.locator('[data-testid="rail-title-repos"]').click()
    page.locator('[data-testid="rail-title-repos"]').click()
    page.wait_for_timeout(500)
    gets_after_gestures = len(repo_gets)
    repos_fetch_ok = gets_before_gesture == 0 and gets_after_gestures <= 1
    no_interval = "setInterval" not in (REPO / "src" / "components" / "LeftSidebar.tsx").read_text()

    # The palette corpus still opens FULL (§8.4: sources ride the shared
    # stores/cache the rail now shares — one gesture warmed both).
    page.keyboard.press("Control+k")
    palette_ok = settled("""() => !!document.querySelector('[data-testid="command-palette"]')""", timeout=5000)
    page.locator('[data-testid="palette-input"]').fill("studio-api")
    palette_repo_ok = settled(
        """() => Array.from(document.querySelectorAll('[data-testid="palette-row"]'))
              .some(r => (r.textContent ?? '').includes('studio-api'))""", timeout=5000)
    page.locator('[data-testid="palette-input"]').fill("q3-review")
    palette_project_ok = settled(
        """() => Array.from(document.querySelectorAll('[data-testid="palette-row"]'))
              .some(r => (r.textContent ?? '').includes('q3-review-deck'))""", timeout=5000)
    palette_no_new_get = len(repo_gets) <= 1  # the palette reused the rail's warm cache
    page.keyboard.press("Escape")

    # ── AC 4a: deep-link default — /p/*/build expands Projects and no other ────
    page.goto(f"{ORIGIN}/p/q3-review-deck/build", wait_until="domcontentloaded")
    page.locator('[data-testid="mode-switcher"]').wait_for(timeout=30000)
    deep_link_ok = settled(
        """() => { const open = Array.from(document.querySelectorAll('[data-testid^="rail-heading-"]'))
                     .filter(h => h.getAttribute('aria-expanded') === 'true');
                   return open.length === 1
                       && open[0].dataset.testid === 'rail-heading-projects'; }""",
        timeout=10000,
    )
    # §3.2: a manual collapse survives moves WITHIN the project's territory.
    page.locator('[data-testid="rail-title-projects"]').click()
    page.locator('[data-testid="mode-tab-chat"]').click()
    page.locator('[data-testid="mode-surface"][data-mode="chat"]').wait_for(timeout=15000)
    stays_collapsed_ok = expanded() == []

    # ── AC 8: collapsed rail — exactly 5 glyph links; immersive auto-collapse ──
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="left-rail"]').wait_for(timeout=30000)
    page.mouse.move(720, 450)  # park mid-board: no hover-peek while measured
    page.locator('[aria-label="Collapse sidebar"]').click()
    glyphs = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="rail-collapsed-glyph"]'))
              .map(g => g.getAttribute('href'))""")
    collapsed_ok = glyphs == ["/projects", "/make", "/chats", "/repos", "/system"]

    # ── Capture 3: the 48px glyph column ───────────────────────────────────────
    page.locator('[data-testid="left-rail"]').screenshot(
        path=str(VSHOTS / "feedback3-M-rail-collapsed.png"))

    # Slice F preserved: entering Document auto-collapses the (re-expanded) rail.
    page.locator('[aria-label="Expand sidebar"]').click()
    page.goto(f"{ORIGIN}/p/q3-review-deck/document", wait_until="domcontentloaded")
    page.mouse.move(720, 450)
    immersive_ok = settled(
        """() => { const r = document.querySelector('[data-testid="left-rail"]');
                   return !!r && r.getBoundingClientRect().width < 80; }""",
        timeout=15000,
    )

    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([
        fonts_ok, anatomy_ok, none_open_on_home, superseded_ok, preserved_ok,
        make_expands, make_only, projects_only,
        projects_rows_ok, zero_open_ok, modal_ok, modal_closes, picker_ok,
        build_tine_ok, chat_plus_ok, chat_territory_ok, repos_plus_ok,
        make_dash_ok, make_dash_territory_ok, repo_row_ok, repos_fetch_ok,
        no_interval, palette_ok, palette_repo_ok, palette_project_ok,
        palette_no_new_get, deep_link_ok, stays_collapsed_ok, collapsed_ok,
        immersive_ok,
    ]),
    "web_fonts_loaded": fonts_ok,
    "ac1_heading_anatomy": dom["anatomy"],
    "ac1_anatomy_ok": anatomy_ok,
    "heading_order": dom["headingOrder"],
    "ac4_none_open_on_home": none_open_on_home,
    "ac6_superseded_testids_absent": superseded_ok,
    "preserved_bell_chrome": preserved_ok,
    "repo_gets_on_mount_page_wide_board_owned": mount_repo_gets_page_wide,
    "ac3_make_expands_chevron_rotates": make_expands,
    "ac2_make_only_open": make_only,
    "ac2_projects_collapses_make": projects_only,
    "projects_accordion_rows": projects_rows,
    "projects_rows_board_ordered": projects_rows_ok,
    "ac3_again_click_zero_open": zero_open_ok,
    "ac5_projects_plus_modal": modal_ok and modal_closes,
    "ac5_make_picker": picker,
    "ac5_make_picker_ok": picker_ok,
    "ac5_build_tine_lands_launch_form": build_tine_ok,
    "ac5_chat_plus_lands_chat_new": chat_plus_ok,
    "chat_new_is_chat_territory": chat_territory_ok,
    "ac5_repos_plus_lands_register": repos_plus_ok,
    "ac5_make_dash_real_page": make_dash_ok,
    "make_dash_is_make_territory": make_dash_territory_ok,
    "ac7_repo_row_after_expand": repo_row_ok,
    "ac7_repo_gets_before_gesture": gets_before_gesture,
    "ac7_repo_gets_after_gestures": gets_after_gestures,
    "ac7_no_setinterval_in_rail": no_interval,
    "palette_opens": palette_ok,
    "palette_repo_corpus": palette_repo_ok,
    "palette_project_corpus": palette_project_ok,
    "palette_reused_warm_cache": palette_no_new_get,
    "ac4_deep_link_expands_projects_only": deep_link_ok,
    "manual_collapse_survives_mode_moves": stays_collapsed_ok,
    "ac8_collapsed_glyph_hrefs": glyphs,
    "ac8_collapsed_ok": collapsed_ok,
    "slice_f_immersive_auto_collapse": immersive_ok,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("feedback3-M-rail-headings.png", "feedback3-M-make-picker.png",
                     "feedback3-M-rail-collapsed.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-M DOM assertions did not all hold — see dom_acs")

# ── 4. Lint posture: exit 0, zero raw-color findings (EC15 error repo-wide) ───
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
raw_color_findings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and raw_color_findings == 0,
    "exit_code": r.returncode,
    "raw_color_findings_repo_wide": raw_color_findings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with zero raw-color findings — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
