#!/usr/bin/env python3
"""
desk_made_opens_test.py — S16a-4c: a made thing opens in the session that made it, at 1440x700 on the
Desk. Against the in-process fixture: project `notes`, doc `offsite-plan` bound to run `r-doc-bound`
(with a second version made first), and an unbound doc `loose-notes`.

  1. MADE ROW: the Made list's `offsite-plan` row opens its session with the document at full size
     (`/s/<session>/a/<key>?size=full`).
  2. OLD BOOKMARK: `/p/notes/document/offsite-plan?v=1` lands on that address with `v=1` — the lens.
  3. UNBOUND: `/p/notes/document/loose-notes` lands on the Made list with the document open at full
     size (`open=loose-notes`); Esc closes it back to the list.
  4. BARE VIDEO: `/p/notes/video` lands on the project's Made › Videos list.
  5. 0 page errors.

Captures: e2e/shots/desk-made-opens-*.png. Env: FEEDBACK_PORT (default 4476). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4476"))
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
SIZE = "() => document.querySelector('[data-testid=\"artifact\"]')?.dataset.size ?? null"


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
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/d/{DOC}/api/fork", {"from": 1})
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": "loose-notes", "brief": "notes no run made"})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC}, extra_frames=[], editors=True, shell_csp=True)

    # ── 1. a Made row opens its session at full size ───────────────────────────────────────────
    page.goto(f"{origin}/everything?tab=made&project={PID}&kind=documents", wait_until="networkidle")
    row = page.locator(f'[data-testid="everything-made-row"][data-name="{DOC}"]')
    row.wait_for(state="visible", timeout=15000)
    href = row.get_attribute("href")
    row.click()
    page.wait_for_function("() => location.pathname.startsWith('/s/') && location.pathname.includes('/a/')", timeout=15000)
    page.wait_for_function("() => document.querySelector('[data-testid=\"artifact\"]')?.dataset.size === 'full'", timeout=15000)
    page.screenshot(path=str(SHOTS / "desk-made-opens-row.png"))
    check("made-row-opens-the-session-at-full", "/a/" in (href or "") and "size=full" in (href or "")
          and page.evaluate(SIZE) == "full", href=href, url=page.url)

    # ── 2. an old bookmark with ?v=1 lands on the lens ─────────────────────────────────────────
    page.goto(f"{origin}/p/{PID}/document/{DOC}?v=1", wait_until="networkidle")
    page.wait_for_function("() => location.pathname.includes('/a/') && new URLSearchParams(location.search).get('v') === '1'", timeout=15000)
    page.get_by_test_id("artifact-lens-line").wait_for(state="visible", timeout=15000)
    check("bookmark-lands-on-the-lens", page.get_by_test_id("artifact-version-frame").get_attribute("data-version") == "1", url=page.url)

    # ── 3. an unbound document opens on the Made list ──────────────────────────────────────────
    page.goto(f"{origin}/p/{PID}/document/loose-notes", wait_until="networkidle")
    page.wait_for_function("() => location.pathname === '/everything' && new URLSearchParams(location.search).get('open') === 'loose-notes'", timeout=15000)
    page.locator('[data-testid="everything-made-open"] [data-testid="artifact"]').wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => document.querySelector('[data-testid=\"everything-made-open\"] [data-testid=\"artifact\"]')?.dataset.size === 'full'", timeout=10000)
    page.screenshot(path=str(SHOTS / "desk-made-opens-unbound.png"))
    q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    check("unbound-opens-on-the-made-list", q.get("tab") == ["made"] and q.get("project") == [PID] and q.get("kind") == ["documents"], url=page.url)
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"everything-made-open\"]')", timeout=8000)
    check("esc-closes-to-the-list", "open=" not in page.url, url=page.url)

    # ── 4. bare /p/<pid>/video ─────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/p/{PID}/video", wait_until="networkidle")
    page.wait_for_function("() => location.pathname === '/everything'", timeout=10000)
    q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    check("bare-video-lands-on-videos", q.get("kind") == ["videos"] and q.get("project") == [PID] and q.get("tab") == ["made"], url=page.url)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
