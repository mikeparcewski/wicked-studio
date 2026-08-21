#!/usr/bin/env python3
"""
vision_slice3_test.py — the DES-VISION-001 slice-3 gate: the chrome + mode
switcher (§3.1, §5.2, §6.3 slice 3), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py — §6.2), on the project shell route /p/q3-review-deck/build.

The slice DOM ACs, verbatim from §6.3:

  1. `[data-testid="logo-slot"]` has `background-image` resolving from the
     `--logo-url` CSS var (even when empty/none): computed 'none' by default,
     and setting the property on <html> resolves a real image URL — plus the
     §3.1 slot contract (exactly 32×32; the default mark is an SVG path whose
     computed stroke IS the accent token, by probe);
  2. the active mode segment's computed `background` resolves from
     `var(--accent)` and its `color` from `var(--accent-fg)` (EC15 — probe
     technique, no hex copied into this rig);
  3. the active fill `<div>` transition FIRES on mode change — asserted via
     `page.wait_for_function` on the fill's computed `left` changing, with the
     CDP Animation domain slowed (setPlaybackRate) so a mid-transition frame is
     capturable (§6.3's "capture via CDP timeline");
  4. the connection status dot carries `data-state` matching the websocket
     state ('connected' here: the run list only renders once /ws is up).

Plus the slice's checklist reads (§6.1): EC8 (the switcher looks like the
spine — filled active segment, glyph+label segments, summary on screen), EC11
(no ornament in the chrome), EC12 (the accent is none of the status colors;
the dot speaks the status layer), EC15 (chrome computed styles resolve from
tokens), and the §6.3 preservation list (UXFIX-001 §2.5: glyphs match the
board quick actions, active summary always visible, unavailable modes stay
rendered — never hidden). The §2.8 reconciliation is asserted too: the loaded
sans is Inter (the token names it; the legacy Archivo load is gone).

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-3-chrome.png                the chrome closeup (logo slot + name + dot + gear)
  vision-3-switcher-active.png       the switcher with Build active + summary line
  vision-3-switcher-transition.png   a mid-slide frame (CDP-slowed timeline)

Finally: `npm run lint` must exit 0 with ZERO findings in this slice's files
(the no-raw-color rule is ERROR there now) while the warn baseline still fires
elsewhere.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: VISION_PORT (default 4342),
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
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4342"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# This slice's error-mode files (eslint.config.mjs TOKEN_CLEAN): lint findings
# here are FAILURES now, and the gate greps for them by name.
SLICE_FILES = ["AppChrome.tsx", "WickedLogo.tsx", "LeftSidebar.tsx",
               "SettingsMenu.tsx", "ModeSwitcher.tsx", "ProjectShell.tsx"]

# A minimal SVG data URL for the --logo-url resolution probe (AC 1) — the value
# is throwaway; the assertion is that the SLOT's computed background-image
# follows the custom property. Unquoted CSS url() with the quotes URL-encoded,
# so the string survives both Python and the CSS parser verbatim.
LOGO_PROBE_URL = "url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27/%3E)"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(VISION_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Freeze Date.now at NOW0 + 5s BEFORE the app boots (timers keep running),
    # so every rendered age in the captures is deterministic (§6.0).
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/p/q3-review-deck/build", wait_until="domcontentloaded")
    page.locator('[data-testid="mode-switcher"]').wait_for(timeout=30000)
    page.locator('[data-testid="app-chrome"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # §2.8 reconciled: BOTH faces load — Inter (the --font-sans token's own
    # name) and JetBrains Mono. Archivo is not requested at all.
    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('13px "Inter"')
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    # AC 4 precondition: the run list renders only once /ws is connected, so
    # the dot must read connected. Wait for the state, then read the DOM fact.
    dot_connected = settled(
        """() => document.querySelector('[data-testid="connection-dot"]')
                   ?.dataset.state === 'connected'""",
    )

    # ── AC 1 + §3.1: the logo slot contract ────────────────────────────────────
    logo = page.evaluate(
        """probeUrl => {
             const probeColor = name => { const el = document.createElement('div');
               el.style.color = `var(${name})`;
               document.body.appendChild(el);
               const v = getComputedStyle(el).color;
               el.remove(); return v; };
             const slot = document.querySelector('[data-testid="logo-slot"]');
             const rect = slot.getBoundingClientRect();
             const before = getComputedStyle(slot).backgroundImage;
             document.documentElement.style.setProperty('--logo-url', probeUrl);
             const after = getComputedStyle(slot).backgroundImage;
             document.documentElement.style.removeProperty('--logo-url');
             const restored = getComputedStyle(slot).backgroundImage;
             const mark = document.querySelector('[data-testid="logo-wicked-mark"]');
             const path = mark ? mark.querySelector('path') : null;
             return {
               width: rect.width, height: rect.height,
               bgDefault: before,
               bgWithVar: after,
               bgRestored: restored,
               markPresent: !!mark && mark.tagName.toLowerCase() === 'svg',
               markStroke: path ? getComputedStyle(path).stroke : null,
               accent: probeColor('--accent'),
               fit: getComputedStyle(slot).backgroundSize,
             }; }""",
        LOGO_PROBE_URL,
    )
    logo_ok = (
        logo["width"] == 32 and logo["height"] == 32
        and logo["bgDefault"] == "none"
        and "data:image/svg" in logo["bgWithVar"]
        and logo["bgRestored"] == "none"
        and logo["markPresent"]
        and logo["markStroke"] == logo["accent"]
        and logo["fit"] == "contain")

    # ── AC 2 + EC8/EC12/EC15: the switcher + chrome computed FROM the tokens ──
    styles = page.evaluate(
        """() => {
             const probeBg = name => { const el = document.createElement('div');
               el.style.background = `var(${name})`;
               document.body.appendChild(el);
               const v = getComputedStyle(el).backgroundColor;
               el.remove(); return v; };
             const probeColor = name => { const el = document.createElement('div');
               el.style.color = `var(${name})`;
               document.body.appendChild(el);
               const v = getComputedStyle(el).color;
               el.remove(); return v; };
             const active = document.querySelector('[data-testid="mode-tab-build"]');
             const inactive = document.querySelector('[data-testid="mode-tab-chat"]');
             const summary = document.querySelector('[data-testid="mode-summary"]');
             const switcher = document.querySelector('[data-testid="mode-switcher"]');
             const rail = document.querySelector('[data-testid="left-rail"]');
             const dot = document.querySelector('[data-testid="connection-dot"]');
             const fill = document.querySelector('[data-testid="mode-fill"]');
             const tabs = Array.from(document.querySelectorAll(
               '[data-testid="mode-switcher"] [role="tab"]'));
             return {
               accent: probeBg('--accent'),
               accentFg: probeColor('--accent-fg'),
               inkDim: probeColor('--ink-dim'),
               surfaceRail: probeBg('--surface-rail'),
               statusGate: probeBg('--status-gate'),
               statusFail: probeBg('--status-fail'),
               statusRun: probeBg('--status-run'),
               activeBg: getComputedStyle(active).backgroundColor,
               activeColor: getComputedStyle(active).color,
               inactiveBg: getComputedStyle(inactive).backgroundColor,
               fillBg: fill ? getComputedStyle(fill).backgroundColor : null,
               summaryColor: summary ? getComputedStyle(summary).color : null,
               summaryText: summary ? summary.textContent : null,
               summaryVisible: summary !== null && summary.offsetParent !== null,
               switcherBg: getComputedStyle(switcher).backgroundColor,
               railBg: getComputedStyle(rail).backgroundColor,
               dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
               dotState: dot ? dot.dataset.state : null,
               tabTexts: tabs.map(t => t.textContent),
               glyphsPresent: ['💬','⚙','▤','▶'].every((g, i) => tabs[i].textContent.includes(g)),
               noneHidden: tabs.every(t => t.offsetParent !== null && !t.disabled),
               unavailableFlags: tabs.map(t => t.dataset.unavailable ?? null),
               railActionGlyphs: (document.querySelector('[data-testid="rail-actions"]')
                 ?.textContent ?? ''),
             }; }""")
    active_ok = (styles["activeBg"] == styles["accent"]
                 and styles["activeColor"] == styles["accentFg"]
                 and styles["inactiveBg"] != styles["accent"]
                 and styles["fillBg"] == styles["accent"])
    ec12_ok = styles["accent"] not in (
        styles["statusGate"], styles["statusFail"], styles["statusRun"])
    ec15_ok = (styles["switcherBg"] == styles["surfaceRail"]
               and styles["railBg"] == styles["surfaceRail"]
               and styles["summaryColor"] == styles["inkDim"]
               and styles["dotBg"] == styles["statusRun"])
    dot_ok = dot_connected and styles["dotState"] == "connected"
    # UXFIX-001 §2.5 preserved: four glyph+label segments (the board's own four
    # glyphs — the rail's creation verbs carry two of them on this same page),
    # the active summary ON SCREEN, no mode hidden or inert.
    preserved_ok = (
        len(styles["tabTexts"]) == 4 and styles["glyphsPresent"]
        and styles["summaryVisible"]
        and (styles["summaryText"] or "").startswith("Governed code work")
        and styles["noneHidden"]
        and "⚙" in styles["railActionGlyphs"] and "💬" in styles["railActionGlyphs"])

    # ── The named steady-state screenshots (§6.3) — before the transition ─────
    page.locator('[data-testid="app-chrome"]').screenshot(
        path=str(VSHOTS / "vision-3-chrome.png"))
    page.locator('[data-testid="mode-switcher"]').screenshot(
        path=str(VSHOTS / "vision-3-switcher-active.png"))

    # ── AC 3: the fill transition fires — CDP-slowed so mid-flight is real ────
    switcher_box = page.locator('[data-testid="mode-switcher"]').bounding_box()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 0.08})

    geometry = page.evaluate(
        """() => ({
             from: document.querySelector('[data-testid="mode-tab-build"]').offsetLeft,
             to: document.querySelector('[data-testid="mode-tab-chat"]').offsetLeft,
             fillLeft: parseFloat(getComputedStyle(
               document.querySelector('[data-testid="mode-fill"]')).left),
           })""")
    page.locator('[data-testid="mode-tab-chat"]').click()
    # The AC verbatim: the computed left CHANGES (the transition is running)…
    fill_moved = settled(
        """start => { const f = document.querySelector('[data-testid="mode-fill"]');
             return f && Math.abs(parseFloat(getComputedStyle(f).left) - start) > 0.5; }""",
        geometry["fillLeft"], timeout=5000,
    )
    # …and is BETWEEN the segments when the mid-flight frame is captured.
    fill_mid = settled(
        """g => { const f = document.querySelector('[data-testid="mode-fill"]');
             if (!f) return false;
             const left = parseFloat(getComputedStyle(f).left);
             return left > g.to + 2 && left < g.from - 2; }""",
        geometry, timeout=5000,
    )
    page.screenshot(path=str(VSHOTS / "vision-3-switcher-transition.png"), clip=switcher_box)
    fill_settled = settled(
        """g => { const f = document.querySelector('[data-testid="mode-fill"]');
             return f && Math.abs(parseFloat(getComputedStyle(f).left) - g.to) < 1; }""",
        geometry, timeout=15000,
    )
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    # The switch LANDED (mode surface + summary follow — §2.5 rule 2 held through it).
    chat_active = settled(
        """() => document.querySelector('[data-testid="mode-surface"]')?.dataset.mode === 'chat'
              && document.querySelector('[data-testid="mode-tab-chat"]')
                   ?.getAttribute('aria-selected') === 'true'""")

    browser.close()

report["steps"]["dom_acs"] = {
    "ok": all([fonts_ok, logo_ok, active_ok, ec12_ok, ec15_ok, dot_ok, preserved_ok,
               fill_moved, fill_mid, fill_settled, chat_active,
               len(console_errors) == 0]),
    "web_fonts_inter_and_mono": fonts_ok,
    "logo_slot": logo,
    "logo_slot_ok": logo_ok,
    "computed": styles,
    "active_segment_from_accent_tokens": active_ok,
    "ec12_accent_not_a_status_color": ec12_ok,
    "ec15_chrome_from_tokens": ec15_ok,
    "connection_dot_state_matches_ws": dot_ok,
    "uxfix_2_5_preserved": preserved_ok,
    "fill_transition_fired": fill_moved,
    "fill_mid_flight_captured": fill_mid,
    "fill_settled_on_target": fill_settled,
    "mode_switch_landed": chat_active,
    "transition_geometry": geometry,
    "console_errors": console_errors[:10],
    "screenshots": [str(VSHOTS / n) for n in
                    ("vision-3-chrome.png", "vision-3-switcher-active.png",
                     "vision-3-switcher-transition.png")],
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-3 DOM assertions did not all hold — see dom_acs")

# ── 4. Lint posture: exit 0; ZERO findings in the error-mode slice files ──────
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
slice_hits = [f for f in SLICE_FILES if f in out]
baseline_warnings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and not slice_hits and baseline_warnings > 0,
    "exit_code": r.returncode,
    "slice_files_with_findings": slice_hits,
    "warn_baseline_still_firing_elsewhere": baseline_warnings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with no findings in the slice-3 "
         "error-mode files (and the warn baseline still firing elsewhere) — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
