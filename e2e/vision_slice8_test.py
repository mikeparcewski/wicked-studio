#!/usr/bin/env python3
"""
vision_slice8_test.py — the /theme page honesty gate, re-scoped again.

The history this gate carries: slice 8 built the brand-learn extraction loop
on INVENTED wires (POST /api/theme/learn, a polled GET /api/themes,
GET /api/themes/:id — never served by the real bridge), so issue #65 removed
the affordance and this gate pinned its ABSENCE. wicked-interactive#181 then
gave the doc-scoped learn the readback it was missing
(GET /d/:docId/api/theme/learned), and the affordance is BACK — on real wires
this time (theme.requested over POST /api/events + the readback poll; see
brand_learn_test.py for the full flow rig). So the honesty this gate now pins
is three-sided:

  1. THE PAGE IS WHOLE: /theme renders BOTH surfaces — the manual appearance
     section (accent wheel, logo, theme mode; untouched) AND the restored
     "Learn from a brand" section (data-testid="brand-learn", its submit, its
     logo-stays-manual copy).
  2. THE DEAD WIRES STAY DEAD, AND THE LIVE ONE STAYS LAZY: across the whole
     visit not one request path contains /api/themes (the registry that never
     existed), and the REAL readback route (/api/theme/learned) is not touched
     either — the section renders with zero learn-related requests until the
     user acts. (The browser-side twin of the contract check's grep AC.)
  3. THE MANUAL SURFACE STILL WORKS: the appearance settings PUT (the slice-7
     machinery) still answers — restoring the learn leg did not disturb the
     live one.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  theme-page-restored-learn.png  the /theme page — both surfaces present.

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
SHOT_PAGE = VSHOTS / "theme-page-restored-learn.png"

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
    page.locator('[data-testid="brand-learn"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # AC 1 — both surfaces present: the manual appearance section AND the
    # restored brand-learn section (real wires — see brand_learn_test.py).
    surface = page.evaluate(
        """() => ({
             appearance: !!document.querySelector('[data-testid="appearance-settings"]'),
             hueWheel: !!document.querySelector('[data-testid="hue-wheel"]'),
             preview: !!document.querySelector('[data-testid="appearance-preview"]'),
             brandLearn: !!document.querySelector('[data-testid="brand-learn"]'),
             learnSubmit: !!document.querySelector('[data-testid="learn-submit"]'),
             learnCopy: (document.body.innerText || '').toLowerCase()
               .includes('learn from a brand'),  // the heading is CSS-uppercased
             logoHonesty: (document.body.innerText || '')
               .includes('the logo stays your manual choice'),
           })"""
    )
    report["steps"]["theme_page_whole"] = {
        "ok": all(surface.values()),
        **surface,
    }

    # AC 3 — the REAL manual wire this page hosts still answers: move the accent
    # lightness and wait for the debounced settings PUT to land (slice-7 machinery).
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

    # AC 2 — the invented wires stay dead, and the real readback stays LAZY:
    # nothing touched /api/themes (the never-existed registry) or
    # /api/theme/learn(ed) — the user never acted on the learn section.
    invented = [q for q in request_paths if "/api/themes" in q]
    learn_touched = [q for q in request_paths if "/api/theme/learn" in q]
    report["steps"]["dead_wires_dead_live_wire_lazy"] = {
        "ok": invented == [] and learn_touched == [],
        "invented_requests": invented,
        "learn_requests_before_user_acts": learn_touched,
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
