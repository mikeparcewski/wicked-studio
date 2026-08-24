#!/usr/bin/env python3
"""
vision_slice7_test.py — the DES-VISION-001 slice-7 gate: the customization
surface (§3) works end-to-end against the crew settings API shape (§6.3
slice 7; EC12, EC15, EC16).

What slice 7 ships and this rig proves, in one browser session against the
shared frozen-NOW0 W2 fixture (whose settings store now serves GET/PUT
/api/v1/settings with `studio.appearance`, §3.3):

  1. STARTUP APPLIES THE STORE (§3.3): with a seeded stored accent (h=200,
     s=60, l=55), loading /system lands those values as INLINE overrides on
     <html> — `--_accent-h` reads back exactly "200" (the DOM AC);
  2. THE WHEEL IS LIVE (§3.4): a pointer-drag on the 240px hue wheel to the
     180° point updates `--_accent-h` within ONE animation frame — the whole
     page is the preview, no apply step;
  3. PERSISTENCE IS DEBOUNCED (§3.3): the PUT to /api/v1/settings fires only
     after the 400ms debounce (elapsed measured), carries the full
     `studio.appearance` object with the dragged hue, and a slider nudge
     (ArrowRight ×2) lands the next debounced PUT;
  4. THE PREVIEW STRIP SPEAKS TOKENS (EC15) and the accent stays DISTINCT
     from the fixed status trio (EC12) — probed computed-vs-computed, no hex
     in this rig;
  5. RESET (§3.5): restores 258/72/62 inline AND persists it; the logo is
     untouched by design (asserted in the unit suite; here reset runs while
     no logo is set);
  6. LOGO (§3.1/EC16): applying a same-origin CUSTOM URL (a deliberately
     non-square 2:1 SVG) sets `--logo-url`, the chrome slot's computed
     background-image resolves it with contain-fit (letterboxed, never
     cropped), and the default wicked mark is ABSENT; Remove restores it;
  7. THEME (§2.14): Light sets `data-theme="light"` on <html> and flips the
     computed `--surface-base`; Dark removes the attribute; both persist;
  8. THE BOARD WEARS IT (EC12): with a stored teal accent (h=180), the W2
     board renders from the stored value with the status colors untouched.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-7-appearance-settings.png  Settings open, Appearance section with the
                                    hue wheel (dragged teal) + preview strip.
  vision-7-custom-accent.png        The W2 board + chrome with the stored teal
                                    accent (≈180°) applied from startup.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: VISION_PORT (default 4347),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NARRATION,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4347"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
SHOT_SETTINGS = VSHOTS / "vision-7-appearance-settings.png"
SHOT_ACCENT = VSHOTS / "vision-7-custom-accent.png"

FREEZE_MOTION = (
    "*, *::before, *::after { animation: none !important; transition: none !important; }"
)

# The token probe (the rig-set's technique): computed color of `var(<name>)` on
# a scratch element — keeps every hex value OUT of this rig.
PROBES = """() => {
  const probe = (name, prop) => { const el = document.createElement('div');
    el.style[prop] = `var(${name})`;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop === 'background' ? 'backgroundColor' : prop];
    el.remove(); return v; };
  return {
    accent:        probe('--accent', 'background'),
    surfaceBase:   probe('--surface-base', 'background'),
    statusGate:    probe('--status-gate', 'color'),
    statusGateDim: probe('--status-gate-dim', 'background'),
    statusFail:    probe('--status-fail', 'color'),
    statusRun:     probe('--status-run', 'color'),
  }; }"""

INLINE = """() => ({
  h: document.documentElement.style.getPropertyValue('--_accent-h'),
  s: document.documentElement.style.getPropertyValue('--_accent-s'),
  l: document.documentElement.style.getPropertyValue('--_accent-l'),
  logo: document.documentElement.style.getPropertyValue('--logo-url'),
  theme: document.documentElement.getAttribute('data-theme'),
})"""

# The stored appearance scene A seeds (a NON-default hue, so "load applies the
# store" is distinguishable from the stylesheet default) and scene B's teal.
STORED_A = {"accent_h": 200, "accent_s": 60, "accent_l": 55, "logo_url": None, "theme": "dark"}
STORED_B = {"accent_h": 180, "accent_s": 70, "accent_l": 58, "logo_url": None, "theme": "dark"}
LOGO_URL = "/__assets/logo-test.svg"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def is_settings_put(r) -> bool:
    return r.method == "PUT" and r.url.endswith("/api/v1/settings")


def put_appearance(req) -> dict:
    body = json.loads(req.post_data or "{}")
    return body.get("studio.appearance") or {}


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(VISION_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

# C6 (BRIEF-UX-002): upload-endpoint (executing, no gate) now renders in the
# WORKING band — NEEDS YOU is gates + fresh failures only.
EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor"]
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    # ══ Scene A: /system — load-applies, wheel, debounce, reset, logo, theme ══
    set_fixture(ORIGIN, appearance=STORED_A)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/theme", wait_until="domcontentloaded")
    page.locator('[data-testid="appearance-settings"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS + "\n" + FREEZE_MOTION)

    # AC 1 — startup applied the STORED values as inline overrides on <html>.
    try:
        page.wait_for_function(
            "() => document.documentElement.style.getPropertyValue('--_accent-h') === '200'",
            timeout=15000)
    except Exception:
        fail("load_applies_store",
             f"--_accent-h never became '200' from the stored appearance; inline now: "
             f"{page.evaluate(INLINE)}")
    inline0 = page.evaluate(INLINE)
    report["steps"]["load_applies_store"] = {
        "ok": inline0 == {"h": "200", "s": "60%", "l": "55%", "logo": "", "theme": None},
        "stored": STORED_A, "inline": inline0,
    }

    # AC 2+3 — drag the wheel to 180°: one-frame application, debounced PUT.
    wheel = page.locator('[data-testid="hue-wheel"]')
    wheel.scroll_into_view_if_needed()
    box = wheel.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    ring_r = box["width"] / 2 - 13  # mid-ring: WHEEL/2 - RING/2 - 1
    with page.expect_request(is_settings_put, timeout=8000) as put1:
        page.mouse.move(cx + ring_r * math.cos(math.pi), cy + ring_r * math.sin(math.pi))
        page.mouse.down()
        page.mouse.up()
        t_up = time.time()
        hue_next_frame = page.evaluate(
            """() => new Promise(res => requestAnimationFrame(
                 () => res(document.documentElement.style.getPropertyValue('--_accent-h'))))""")
    debounce_s = time.time() - t_up
    dragged = put_appearance(put1.value)
    hue_val = int(hue_next_frame or -1)
    report["steps"]["wheel_drag"] = {
        "ok": (178 <= hue_val <= 182
               and debounce_s >= 0.3
               and dragged.get("accent_h") == hue_val
               and dragged.get("accent_s") == 60 and dragged.get("accent_l") == 55),
        "hue_applied_within_one_frame": hue_next_frame,
        "put_after_debounce_seconds": round(debounce_s, 3),
        "put_studio_appearance": dragged,
    }

    # A slider nudge fine-tunes saturation (§3.2) and lands the NEXT debounced PUT.
    with page.expect_request(is_settings_put, timeout=8000) as put2:
        sat = page.locator('[data-testid="accent-sat"]')
        sat.focus()
        sat.press("ArrowRight")
        sat.press("ArrowRight")
    nudged = put_appearance(put2.value)
    inline_s = page.evaluate("() => document.documentElement.style.getPropertyValue('--_accent-s')")
    report["steps"]["slider_nudge"] = {
        "ok": inline_s == "62%" and nudged.get("accent_s") == 62,
        "inline_s": inline_s, "put_studio_appearance": nudged,
    }

    # EC15 + EC12 on the preview strip: tokens end-to-end, accent ≠ status trio.
    probes = page.evaluate(PROBES)
    strip = page.evaluate(
        """() => {
      const cs = (sel, prop) => { const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null; };
      return {
        modeActiveBg: cs('[data-testid="preview-mode-active"]', 'backgroundColor'),
        primaryBg:    cs('[data-testid="preview-primary"]', 'backgroundColor'),
        gateChipBg:   cs('[data-testid="preview-gate-chip"]', 'backgroundColor'),
        gateChipInk:  cs('[data-testid="preview-gate-chip"]', 'color'),
      }; }""")
    strip_checks = {
        "mode_active_bg_is_accent": strip["modeActiveBg"] == probes["accent"],
        "primary_bg_is_accent": strip["primaryBg"] == probes["accent"],
        "gate_chip_bg_is_status_gate_dim": strip["gateChipBg"] == probes["statusGateDim"],
        "gate_chip_ink_is_status_gate": strip["gateChipInk"] == probes["statusGate"],
        "accent_distinct_from_gate": probes["accent"] != probes["statusGate"],
        "accent_distinct_from_fail": probes["accent"] != probes["statusFail"],
        "accent_distinct_from_run": probes["accent"] != probes["statusRun"],
    }
    report["steps"]["preview_strip"] = {"ok": all(strip_checks.values()),
                                        **strip_checks, "computed": strip, "probes": probes}

    # The named screenshot: Appearance section, wheel dragged teal, strip live.
    try:
        page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=20000)
    except Exception:
        pass
    page.screenshot(path=str(SHOT_SETTINGS))

    # AC 4 — reset restores 258/72/62 inline AND persists it (§3.5).
    with page.expect_request(is_settings_put, timeout=8000) as put3:
        page.locator('[data-testid="accent-reset"]').click()
    reset_put = put_appearance(put3.value)
    inline_r = page.evaluate(INLINE)
    report["steps"]["reset"] = {
        "ok": (inline_r["h"] == "258" and inline_r["s"] == "72%" and inline_r["l"] == "62%"
               and reset_put.get("accent_h") == 258 and reset_put.get("accent_s") == 72
               and reset_put.get("accent_l") == 62),
        "inline": inline_r, "put_studio_appearance": reset_put,
    }

    # AC 5 — the custom logo (EC16): URL in, slot resolves it, the mark is gone.
    page.locator('[data-testid="logo-url-input"]').fill(LOGO_URL)
    with page.expect_request(is_settings_put, timeout=8000) as put4:
        page.locator('[data-testid="logo-url-apply"]').click()
    logo_put = put_appearance(put4.value)
    logo_state = page.evaluate(
        """() => { const slot = document.querySelector('[data-testid="logo-slot"]');
      const s = slot ? getComputedStyle(slot) : null;
      return {
        inlineLogo: document.documentElement.style.getPropertyValue('--logo-url'),
        slotBgImage: s ? s.backgroundImage : null,
        slotBgSize: s ? s.backgroundSize : null,
        slotW: s ? s.width : null, slotH: s ? s.height : null,
        markCount: document.querySelectorAll('[data-testid="logo-wicked-mark"]').length,
        removeShown: !!document.querySelector('[data-testid="logo-remove"]'),
      }; }""")
    logo_checks = {
        "inline_logo_url_set": logo_state["inlineLogo"] == f'url("{LOGO_URL}")',
        "slot_bg_image_resolves_asset": (logo_state["slotBgImage"] or "") != "none"
                                        and "logo-test.svg" in (logo_state["slotBgImage"] or ""),
        "slot_contain_fit": logo_state["slotBgSize"] == "contain",
        "slot_is_32x32": logo_state["slotW"] == "32px" and logo_state["slotH"] == "32px",
        "wicked_mark_absent": logo_state["markCount"] == 0,
        "remove_offered": logo_state["removeShown"],
        "put_carries_logo_url": logo_put.get("logo_url") == LOGO_URL,
        "logo_independent_of_accent": logo_put.get("accent_h") == 258,
    }
    report["steps"]["logo"] = {"ok": all(logo_checks.values()), **logo_checks, "computed": logo_state}

    # …and Remove restores the default mark (§3.5 reset 2, independent of accent).
    with page.expect_request(is_settings_put, timeout=8000) as put5:
        page.locator('[data-testid="logo-remove"]').click()
    remove_put = put_appearance(put5.value)
    after_remove = page.evaluate(
        """() => ({
      inlineLogo: document.documentElement.style.getPropertyValue('--logo-url'),
      markCount: document.querySelectorAll('[data-testid="logo-wicked-mark"]').length,
    })""")
    report["steps"]["logo_remove"] = {
        "ok": (after_remove["inlineLogo"] == "" and after_remove["markCount"] >= 1
               and remove_put.get("logo_url") is None and remove_put.get("accent_h") == 258),
        "computed": after_remove, "put_studio_appearance": remove_put,
    }

    # AC 6 — the theme instance picker (§2.14): light flips the surface ramp.
    dark_surface = probes["surfaceBase"]
    with page.expect_request(is_settings_put, timeout=8000) as put6:
        page.locator('[data-testid="theme-light"]').click()
    light_put = put_appearance(put6.value)
    light_state = page.evaluate(INLINE)
    light_surface = page.evaluate(PROBES)["surfaceBase"]
    with page.expect_request(is_settings_put, timeout=8000) as put7:
        page.locator('[data-testid="theme-dark"]').click()
    dark_put = put_appearance(put7.value)
    back_state = page.evaluate(INLINE)
    report["steps"]["theme_picker"] = {
        "ok": (light_state["theme"] == "light" and light_put.get("theme") == "light"
               and light_surface != dark_surface
               and back_state["theme"] is None and dark_put.get("theme") == "dark"),
        "light_inline": light_state, "surface_base_dark": dark_surface,
        "surface_base_light": light_surface,
    }
    page.close()

    # ══ Scene B: the board wears a STORED teal accent from startup (EC12) ══════
    set_fixture(ORIGIN, appearance=STORED_B)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS + "\n" + FREEZE_MOTION)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    narration_ok = settled(
        """text => (document.querySelector(
             '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]')
             ?.textContent ?? '').includes(text)""",
        NARRATION,
    )
    accent_ok = settled(
        "() => document.documentElement.style.getPropertyValue('--_accent-h') === '180'",
        timeout=15000,
    )
    fonts_ok = settled("() => document.fonts.status === 'loaded'", timeout=20000)

    probes_b = page.evaluate(PROBES)
    board_state = page.evaluate(
        """() => ({
      inlineH: document.documentElement.style.getPropertyValue('--_accent-h'),
      markCount: document.querySelectorAll('[data-testid="logo-wicked-mark"]').length,
      markStroke: (() => { const p = document.querySelector(
        '[data-testid="logo-wicked-mark"] path');
        return p ? getComputedStyle(p).stroke : null; })(),
    })""")
    page.screenshot(path=str(SHOT_ACCENT))

    board_checks = {
        "board_settled_w2_order": order_ok,
        "live_narration_streamed": narration_ok,
        "web_fonts_loaded": fonts_ok,
        "stored_teal_applied": accent_ok and board_state["inlineH"] == "180",
        "default_mark_present_no_logo": board_state["markCount"] >= 1,
        "mark_stroke_follows_accent": board_state["markStroke"] == probes_b["accent"],
        "accent_distinct_from_gate": probes_b["accent"] != probes_b["statusGate"],
        "accent_distinct_from_fail": probes_b["accent"] != probes_b["statusFail"],
        "accent_distinct_from_run": probes_b["accent"] != probes_b["statusRun"],
    }
    report["steps"]["board_custom_accent"] = {
        "ok": all(board_checks.values()), **board_checks,
        "computed": board_state, "probes": probes_b, "screenshot": str(SHOT_ACCENT),
    }

    browser.close()

report["steps"]["console"] = {"ok": len(console_errors) == 0, "errors": console_errors[:10]}
report["screenshots"] = [str(SHOT_SETTINGS), str(SHOT_ACCENT)]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("dom_acs_verdict", f"slice-7 assertions did not all hold — see {', '.join(bad)}")

# ── 4. Lint: exit 0, ZERO §2.11 findings (the slice adds no raw color) ─────────
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
findings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and findings == 0,
    "exit_code": r.returncode,
    "raw_color_findings": findings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with zero §2.11 findings — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
