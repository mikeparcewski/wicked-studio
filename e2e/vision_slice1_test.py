#!/usr/bin/env python3
"""
vision_slice1_test.py — the DES-VISION-001 slice-1 gate: the token foundation
exists and changed NOTHING visible (§6.3 slice 1).

Slice 1 ships `src/styles/tokens.css` (primitives + semantics), the light-theme
override file, the tailwind var-backed color aliases, the no-raw-color ESLint
rule in WARN mode, and the global.css import chain — and NO component changes.
The gate is therefore two-sided:

  1. the tokens are THERE — `--surface-card` (and a sample across every §2
     table) resolves to a non-empty value on the document root in a real
     browser (the slice DOM AC; read via getComputedStyle, which is where a
     stylesheet-declared custom property is observable);
  2. the components do NOT use them yet — `[data-testid="project-card"]`'s
     computed background is still the hardcoded `#161b22` → `rgb(22, 27, 34)`,
     the baseline the next slice moves from (EC15 baseline, not yet passing);
  3. ZERO VISUAL CHANGE — `vision-1-token-check.png` is pixel-identical to
     `vision-1-baseline.png`, the same rig's capture of the SAME settled W2
     board from the pre-slice build (run this rig with VISION_BASELINE=1 on
     the parent commit to produce it);
  4. `npm run lint` exits 0 while the new rule WARNS on the existing raw
     colors (the migration baseline §2.11 defines).

Pixel-identity needs the page deterministic, so beyond the shared frozen-NOW0
fixture (uxfix_fixture.py) this rig also:
  - freezes the BROWSER clock at NOW0 + 5s (page.clock.set_fixed_time), so
    every rendered age ("30s", "8d") is the same in both captures even though
    the two runs import the fixture minutes apart;
  - freezes animations/transitions by injected CSS (the live-edge breathes on
    wall-clock phase otherwise) — display-only, both captures get the same CSS;
  - waits for the web fonts before the shot (a fallback-font frame is not the
    board).

Captures (§4.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/uxfix/:
  vision-1-baseline.png     (VISION_BASELINE=1 — run on the pre-slice commit)
  vision-1-token-check.png  (default — the slice's named screenshot)

Prereqs: Python Playwright + Pillow. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — NOTE ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: VISION_PORT (default 4340), VISION_BASELINE,
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NARRATION,
    NOW0,
    NPM,
    REPO,
    SHOTS,
    ensure_build,
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4340"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
BASELINE_MODE = os.environ.get("VISION_BASELINE") == "1"
BASELINE_SHOT = SHOTS / "vision-1-baseline.png"
CHECK_SHOT = SHOTS / "vision-1-token-check.png"

# The pre-token card background (ProjectCard.tsx's hardcoded #161b22) — the EC15
# baseline this slice records and slice 2 moves.
CARD_BG_RGB = "rgb(22, 27, 34)"

# One name per §2 table, so a hole in any section is caught, not just §2.3.
SAMPLED_TOKENS = [
    "--_surface-2", "--surface-card",            # §2.3 surface ramp
    "--ink-body",                                 # §2.4 ink ramp
    "--_accent-h", "--accent",                    # §2.5 accent system
    "--status-gate", "--status-gate-dim",         # §2.6 status colors
    "--space-4",                                  # §2.7 spacing
    "--font-mono", "--text-sm",                   # §2.8 type
    "--radius-lg", "--shadow-card",               # §2.9 radius/shadow
    "--ease-out", "--dur-base",                   # §2.10 motion
]

FREEZE_MOTION = (
    "*, *::before, *::after { animation: none !important; transition: none !important; }"
)

report: dict = {"ok": False, "mode": "baseline" if BASELINE_MODE else "check", "steps": {}}


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

SHOTS.mkdir(parents=True, exist_ok=True)

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]
console_errors: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Freeze Date.now at NOW0 + 5s BEFORE the app boots (timers keep running —
    # the /ws narration and the attention re-sorts still happen).
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

    # The SAME settled state the uxfix slice-1 rig waits on — a comparison of two
    # half-settled paints would prove nothing.
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
    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('12px "Archivo"')
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    # ── The slice DOM ACs ──────────────────────────────────────────────────────
    tokens = page.evaluate(
        """names => { const cs = getComputedStyle(document.documentElement);
             return Object.fromEntries(names.map(n => [n, cs.getPropertyValue(n).trim()])); }""",
        SAMPLED_TOKENS,
    )
    surface_card = tokens.get("--surface-card", "")
    card_bg = page.evaluate(
        """() => getComputedStyle(
             document.querySelector('[data-testid="project-card"]')).backgroundColor"""
    )

    shot = BASELINE_SHOT if BASELINE_MODE else CHECK_SHOT
    page.screenshot(path=str(shot))
    browser.close()

tokens_present = all(v != "" for v in tokens.values())
report["steps"]["dom_acs"] = {
    "ok": (order_ok and narration_ok and fonts_ok and card_bg == CARD_BG_RGB
           and (True if BASELINE_MODE else (surface_card != "" and tokens_present))),
    "board_settled_w2_order": order_ok,
    "live_narration_streamed": narration_ok,
    "web_fonts_loaded": fonts_ok,
    "surface_card_token": surface_card,
    "surface_card_nonempty": surface_card != "",
    "all_sampled_tokens_nonempty": tokens_present,
    "sampled_tokens": tokens,
    "project_card_computed_background": card_bg,
    "card_bg_still_hardcoded_rgb_not_token": card_bg == CARD_BG_RGB,
    "console_errors": console_errors[:10],
    "screenshot": str(shot),
}
if not report["steps"]["dom_acs"]["ok"]:
    fail("dom_acs_verdict", "slice-1 DOM assertions did not all hold — see dom_acs")

# ── 4. Zero visual regression: pixel-identical to the pre-slice baseline ───────
if not BASELINE_MODE:
    if not BASELINE_SHOT.is_file():
        fail("pixel_compare", f"{BASELINE_SHOT} missing — run this rig with "
             "VISION_BASELINE=1 on the pre-slice commit first")
    from PIL import Image, ImageChops  # noqa: E402

    a = Image.open(BASELINE_SHOT).convert("RGB")
    b = Image.open(CHECK_SHOT).convert("RGB")
    same_size = a.size == b.size
    bbox = ImageChops.difference(a, b).getbbox() if same_size else None
    identical = same_size and bbox is None
    diff_pixels = 0
    if same_size and not identical:
        diff_pixels = sum(
            1 for pa, pb in zip(a.getdata(), b.getdata()) if pa != pb
        )
    report["steps"]["pixel_compare"] = {
        "ok": identical,
        "baseline": str(BASELINE_SHOT),
        "check": str(CHECK_SHOT),
        "same_size": same_size,
        "pixel_identical": identical,
        "diff_bbox": bbox,
        "diff_pixels": diff_pixels,
    }
    if not identical:
        fail("pixel_compare_verdict", "vision-1-token-check.png is not pixel-identical "
             "to the pre-slice baseline — see pixel_compare")

# ── 5. Lint posture: exit 0, and the new rule WARNS on the existing raw colors ─
if not BASELINE_MODE:
    r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                       capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    raw_color_warnings = out.count("(DES-VISION-001 §2.11)")
    report["steps"]["lint"] = {
        "ok": r.returncode == 0 and raw_color_warnings > 0,
        "exit_code": r.returncode,
        "exits_zero_no_errors": r.returncode == 0,
        "raw_color_warnings": raw_color_warnings,
        "tail": out[-600:],
    }
    if not report["steps"]["lint"]["ok"]:
        fail("lint_verdict", "lint must exit 0 (warnings only) AND warn on the "
             "existing raw colors — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
