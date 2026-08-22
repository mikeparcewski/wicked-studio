#!/usr/bin/env python3
"""
brand_learn_test.py — the /theme "Learn from a brand" flow, end to end against
the shared W2 fixture (the restored capability studio#73 retracted; back on the
real wires now that interactive#181 gave the doc-scoped learn a readback).

What this rig proves in a real browser:

  1. INERT AT REST: /theme renders the brand-learn section beside the manual
     appearance surface, and fires ZERO learn-related requests until the user
     acts — no /api/theme read, no write under the bridge proxy. (The board
     rail's ordinary GET …/interactive/api/docs is page chrome on every route
     and predates this flow.)
  2. THE FLOW IS THE REAL WIRE CHAIN: submit → the scratch doc is ensured via
     the real registry route (POST …/interactive/api/docs), the learn rides
     POST …/api/events (theme.requested), and the readback poll walks
     GET …/d/brand-learn/api/theme/learned through the 404→200 ripening.
  3. THE PREVIEW IS REAL: the mapped accent (fixture navy #0a2a5e → hue 217)
     lands inline on <html> — getComputedStyle proves the var changed — with
     the mapper's adjustments disclosed, and NOTHING persisted yet.
  4. APPLY PERSISTS THROUGH THE EXISTING STORE: the debounced settings PUT
     lands and the fixture's settings store holds the mapped accent.
  5. NO LOOP OUTLIVES THE FLOW: once the tokens landed, the readback route is
     never polled again.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  brand-learn-form.png     the section, source filled, before submit.
  brand-learn-applied.png  mapped accent applied — page wearing the brand.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: BRAND_LEARN_PORT (default 4352).
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

PORT = int(os.environ.get("BRAND_LEARN_PORT", "4352"))
ORIGIN = f"http://127.0.0.1:{PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
SHOT_FORM = VSHOTS / "brand-learn-form.png"
SHOT_APPLIED = VSHOTS / "brand-learn-applied.png"

# The project the learn rides: the fixture's one interactive-rooted project —
# the component's default pick (first project bound to a root).
PROJECT = "q3-review-deck"
READBACK = f"/api/v1/projects/{PROJECT}/interactive/d/brand-learn/api/theme/learned"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build + the shared W2 fixture server ────────────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}
start_server(PORT, dist)
# A generous ripening delay so the poll PROVABLY witnesses the 404 before the 200.
set_fixture(ORIGIN, learn_delay_s=1.5, reset_learn=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

# ── 2. The browser flow ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

console_errors: list[str] = []
request_log: list[tuple[str, str]] = []  # every (method, path), in order
readback_statuses: list[int] = []        # every response status of the readback route


def learn_related(method: str, path: str) -> bool:
    """The LEARN flow's own wires: any theme read, any write under the bridge
    proxy (the scratch-doc create, the events emit). The board rail's ordinary
    GET …/interactive/api/docs (LeftSidebar's doc tiles, on every route since
    long before this flow) is page chrome, not the learn."""
    return "/api/theme" in path or (method == "POST" and "/interactive/" in path)


def accent_h(page) -> str:
    return page.evaluate(
        "() => getComputedStyle(document.documentElement).getPropertyValue('--_accent-h').trim()")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda req: request_log.append((req.method, urlparse(req.url).path)))
    page.on("response", lambda res: readback_statuses.append(res.status)
            if urlparse(res.url).path == READBACK else None)

    page.goto(f"{ORIGIN}/theme", wait_until="domcontentloaded")
    page.locator('[data-testid="brand-learn"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1200)  # give any eager wire time to (wrongly) fire

    # AC 1 — both sections render; the learn section is INERT until the user acts.
    surface = page.evaluate(
        """() => ({
             appearance: !!document.querySelector('[data-testid="appearance-settings"]'),
             brandLearn: !!document.querySelector('[data-testid="brand-learn"]'),
             sourceUrl: !!document.querySelector('[data-testid="learn-source-url"]'),
             sourcePdf: !!document.querySelector('[data-testid="learn-source-pdf"]'),
             sourceImage: !!document.querySelector('[data-testid="learn-source-image"]'),
             projectPick: !!document.querySelector('[data-testid="learn-project"]'),
             logoHonesty: (document.body.innerText || '').includes('the logo stays your manual choice'),
           })"""
    )
    eager = [f"{m} {q}" for m, q in request_log if learn_related(m, q)]
    report["steps"]["inert_at_rest"] = {
        "ok": all(surface.values()) and eager == [],
        **surface,
        "eager_learn_requests": eager,
        "requests_seen": len(request_log),
    }

    accent_before = accent_h(page)

    # AC 2 — the flow: url source in, the interactive-rooted project preselected.
    page.locator('[data-testid="learn-input"]').fill("https://acme.example.com")
    picked = page.locator('[data-testid="learn-project"]').input_value()
    page.locator('[data-testid="brand-learn"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOT_FORM))
    page.locator('[data-testid="learn-submit"]').click()

    page.locator('[data-testid="learn-preview-chip"]').wait_for(timeout=30000)

    ensured_doc = any(
        m == "POST" and q == f"/api/v1/projects/{PROJECT}/interactive/api/docs"
        for m, q in request_log)
    fired_event = any(
        m == "POST" and q == f"/api/v1/projects/{PROJECT}/interactive/api/events"
        for m, q in request_log)
    report["steps"]["real_wire_chain"] = {
        "ok": (picked == PROJECT and ensured_doc and fired_event
               and 404 in readback_statuses and 200 in readback_statuses),
        "project_preselected": picked,
        "scratch_doc_route_hit": ensured_doc,
        "events_route_hit": fired_event,
        "readback_statuses": readback_statuses[:10],
    }

    # AC 3 — the preview is real: the accent var CHANGED to the mapped hue,
    # the adjustments are disclosed, and nothing has persisted yet.
    accent_preview = accent_h(page)
    adjustments = page.locator('[data-testid="mapper-adjustments"]').inner_text()
    report["steps"]["preview_is_real"] = {
        "ok": (accent_before == "258" and accent_preview == "217"
               and "contrast-floor" in adjustments and "lightness-clamp" in adjustments),
        "accent_before": accent_before,
        "accent_preview": accent_preview,
        "adjustments_excerpt": adjustments[:300],
    }

    # Nothing persisted before Apply: the fixture settings store still holds 258.
    with urllib.request.urlopen(f"{ORIGIN}/api/v1/settings", timeout=10) as res:
        stored = json.loads(res.read())["settings"]["studio.appearance"]
    report["steps"]["nothing_persisted_before_apply"] = {
        "ok": stored["accent_h"] == 258, "stored": stored,
    }

    # AC 4 — Apply persists through the EXISTING appearance store (debounced PUT).
    page.locator('[data-testid="learn-apply"]').click()
    page.wait_for_timeout(1500)  # the store's 400ms debounce + slack
    with urllib.request.urlopen(f"{ORIGIN}/api/v1/settings", timeout=10) as res:
        stored = json.loads(res.read())["settings"]["studio.appearance"]
    accent_applied = accent_h(page)
    report["steps"]["apply_persists"] = {
        "ok": (stored["accent_h"] == 217 and stored["accent_s"] == 81
               and stored["accent_l"] == 59 and stored["logo_url"] is None
               and accent_applied == "217"),
        "stored": stored,
        "accent_applied": accent_applied,
    }

    page.screenshot(path=str(SHOT_APPLIED))

    # AC 5 — no poll outlives the flow: the readback count freezes.
    polls_at_done = len(readback_statuses)
    page.wait_for_timeout(3000)
    report["steps"]["no_poll_outlives_the_flow"] = {
        "ok": len(readback_statuses) == polls_at_done,
        "polls_at_done": polls_at_done,
        "polls_after_3s": len(readback_statuses),
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [str(SHOT_FORM), str(SHOT_APPLIED)]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("brand_learn_verdict", f"brand-learn assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
