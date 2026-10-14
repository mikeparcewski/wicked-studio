#!/usr/bin/env python3
"""
desk_artifact_address_test.py — S16a-4a (DES-STUDIO-REBUILD-001 §5.4): a grown artifact has an address,
/s/:sessionId/a/:artifactKey?size=full, at 1440x700 on the Desk.

Against the in-process fixture with the bound document desk_page_editor uses (project `notes`, doc
`offsite-plan`, run `r-doc-bound`):

  1. FULL: the host's Full screen opens the editor; the address gains /a/<key>?size=full.
  2. BACK: the browser's Back returns to the card and the session's own address.
  3. ESC: Esc from full returns to the card and the session's own address.
  4. DEEP LINK: the copied full address, loaded fresh, opens the artifact at full at once.
  5. UNKNOWN KEY: an address naming an artifact the session does not hold shows the session with
     "That artifact is not in this session any more." and grows nothing.
  6. 0 page errors.

Captures: e2e/shots/desk-artifact-address-*.png. Env: FEEDBACK_PORT (default 4474). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4474"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "offsite-plan"
RUN = "r-doc-bound"

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


def post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"{}")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
CARD = '[data-testid="plugin-card"][data-editor="wicked-page"]'
SURFACE = "() => document.querySelector('[data-testid=\"plugin-card\"][data-editor=\"wicked-page\"]')?.dataset.surface ?? null"


def addr(page) -> dict:
    u = urllib.parse.urlparse(page.url)
    return {"path": u.path, "size": urllib.parse.parse_qs(u.query).get("size", [None])[0]}


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DOC, "brief": "the offsite plan"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC}, extra_frames=[], editors=True, shell_csp=True)

    page.goto(f"{origin}/", wait_until="networkidle")
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.locator(f'{CARD}[data-protocol="2"]').wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(600)
    base = urllib.parse.urlparse(page.url).path

    # ── 1. full screen: the host card opens its full editor and pushes an address ──────
    page.locator(CARD).get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=5000)
    # Preserve the address contract. PluginCard must be connected to the address provider;
    # a full editor with no bookmarkable address is an integration failure, not a passing journey.
    page.wait_for_function("() => location.pathname.includes('/a/') && new URLSearchParams(location.search).get('size') === 'full'", timeout=8000)
    full_url = page.url
    a1 = addr(page)
    page.screenshot(path=str(SHOTS / "desk-artifact-address-full.png"))
    check("full-pushes-address", a1["path"].startswith(base + "/a/") and a1["size"] == "full"
          and page.evaluate(SURFACE) == "full", address=a1)

    # ── 2. Back: return to the card and the session's own address ────────────────────
    page.go_back()
    page.get_by_test_id("full-shell").wait_for(state="detached", timeout=8000)
    a2 = addr(page)
    check("back-to-the-card", a2["path"] == base and a2["size"] is None
          and page.evaluate(SURFACE) == "card", address=a2)

    # ── 3. Esc from full also returns to the card and the session address ────────────
    page.locator(CARD).get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Escape")
    page.get_by_test_id("full-shell").wait_for(state="detached", timeout=8000)
    page.wait_for_function("() => !location.pathname.includes('/a/')", timeout=8000)
    a3 = addr(page)
    page.screenshot(path=str(SHOTS / "desk-artifact-address-thread.png"))
    check("esc-to-the-thread", a3["path"] == base and page.evaluate(SURFACE) == "card", address=a3)

    # ── 4. the copied full address, fresh ─────────────────────────────────────────────────────
    page.goto(full_url, wait_until="networkidle")
    try:
        page.wait_for_function("() => document.querySelector('[data-testid=\"plugin-card\"]')?.dataset.surface === 'full'", timeout=15000)
        deep = page.evaluate(SURFACE)
    except Exception:  # noqa: BLE001
        deep = page.evaluate(SURFACE)
    page.screenshot(path=str(SHOTS / "desk-artifact-address-deep.png"))
    check("deep-link-opens-full", deep == "full", size=deep, url=page.url)

    # ── 5. an unknown key ──────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}{base}/a/{urllib.parse.quote('r-none:notes/nothing', safe='')}?size=full", wait_until="networkidle")
    page.get_by_test_id("session-artifact-missing").wait_for(state="visible", timeout=15000)
    missing = page.get_by_test_id("session-artifact-missing").inner_text().strip()
    page.wait_for_timeout(400)
    grown = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"plugin-card\"]')].filter(e => e.dataset.surface === 'full').length")
    page.screenshot(path=str(SHOTS / "desk-artifact-address-unknown.png"))
    check("unknown-key-says-so", missing == "That artifact is not in this session any more." and grown == 0,
          line=missing, grown=grown)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
