#!/usr/bin/env python3
"""
vision_slice8_test.py — the /theme page, after the theme-wire correction
(issue #65; formerly the DES-VISION-001 slice-8 brand-learn gate).

Slice 8's subject — the brand-learn extraction loop (learn a source, poll a
theme list, read a palette back, map it onto the studio accent) — was built
entirely on INVENTED wires: `POST /api/theme/learn`, a polled `GET /api/themes`
and `GET /api/themes/:id` were never served by the real wicked-interactive
bridge (verified in interactive_wire_contract_test.py, which now pins all
three as must-stay-404). On the real bridge a theme is learned FOR ONE
DOCUMENT via the `wicked.interactive.theme.requested` bus command, and its
result is never readable back over HTTP — so a studio-accent extraction leg
has no wire to ride, and the honest fix removed the affordance (BrandLearn)
rather than keeping a dead one.

What this rig proves instead, in a real browser against the shared W2 fixture:

  1. THE PAGE IS HONEST: /theme renders the appearance surface
     (data-testid="appearance-settings" — accent wheel, logo, theme mode; all
     real, crew-persisted wires) and NO brand-learn affordance survives — no
     [data-testid="brand-learn"], no learn-submit, no "Learn from brand
     source" copy.
  2. NO INVENTED WIRE IS EVEN ATTEMPTED: across the whole visit not one
     request path contains /api/themes or /api/theme/learn — the browser-side
     twin of the contract check's grep AC.
  3. THE REAL SURFACE STILL WORKS: the appearance settings PUT (the slice-7
     machinery this page hosts) still answers, so removing the dead leg did
     not take the live one with it.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  theme-wire-fix-theme-page.png  the /theme page — appearance surface present,
                                 brand-learn affordance honestly absent.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: VISION_PORT (default 4348), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4348"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
SHOT_PAGE = VSHOTS / "theme-wire-fix-theme-page.png"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the other rigs — same dist dir) ─────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server ────────────────────────────────────────────
start_server(VISION_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

console_errors: list[str] = []
request_paths: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda req: request_paths.append(urlparse(req.url).path))

    page.goto(f"{ORIGIN}/theme", wait_until="domcontentloaded")
    page.locator('[data-testid="appearance-settings"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # AC 1 — the appearance surface is present; the brand-learn affordance is not.
    surface = page.evaluate(
        """() => ({
             appearance: !!document.querySelector('[data-testid="appearance-settings"]'),
             hueWheel: !!document.querySelector('[data-testid="hue-wheel"]'),
             preview: !!document.querySelector('[data-testid="appearance-preview"]'),
             brandLearn: !!document.querySelector('[data-testid="brand-learn"]'),
             learnSubmit: !!document.querySelector('[data-testid="learn-submit"]'),
             learnCopy: (document.body.innerText || '').includes('Learn from brand source'),
           })"""
    )
    report["steps"]["theme_page_honest"] = {
        "ok": all([
            surface["appearance"], surface["hueWheel"], surface["preview"],
            not surface["brandLearn"], not surface["learnSubmit"], not surface["learnCopy"],
        ]),
        **surface,
    }

    # AC 3 — the REAL wire this page hosts still answers: move the accent lightness
    # and wait for the debounced settings PUT to land (the slice-7 machinery).
    page.locator('[data-testid="accent-lgt"]').wait_for(timeout=30000)
    put_before = sum(1 for q in request_paths if q == "/api/v1/settings")
    page.locator('[data-testid="accent-lgt"]').fill("55")
    page.wait_for_timeout(1500)  # the store debounces its PUT; give it one beat
    put_after = sum(1 for q in request_paths if q == "/api/v1/settings")
    report["steps"]["appearance_put_lands"] = {
        "ok": put_after > put_before,
        "puts_before": put_before, "puts_after": put_after,
    }

    page.screenshot(path=str(SHOT_PAGE))

    # AC 2 — no invented theme wire was even attempted, page-wide.
    invented = [q for q in request_paths if "/api/themes" in q or "/api/theme/learn" in q]
    report["steps"]["no_invented_wire_attempted"] = {
        "ok": invented == [],
        "invented_requests": invented,
        "requests_seen": len(request_paths),
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [str(SHOT_PAGE)]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("slice8_verdict", f"theme-page assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
