#!/usr/bin/env python3
"""
desk_plugins_document_test.py — the built-in Document editor opens real documents from the Plugins page,
and the app builder is shown as coming soon (operator 2026-10-12, lane editors-document). 1440x700 on
the Desk, against the in-process fixture with the daemon-wide document index on: project `notes`, a
page-style doc `launch-page`, an unstyled doc `loose-notes` and a written doc `q4-brief`.

  1. LIST: /plugins shows the built-in row named "Document", listing the documents it opens
     (launch-page, loose-notes) and not the written one (q4-brief), with the honest "written documents
     open in studio's own editor; decks open in Slides" line.
  2. OPEN: a click on launch-page opens THAT document full size (the `open=` address opens full screen)
     in the plugin frame (the hash-pinned bundle, kind `page`), on the Made list's `open=` address — not the editor test page's sample;
     picking version 1 in its version list shows version 1 (no address to write there).
  3. ESC from full screen comes back to the card (DES §7.3); Esc on the card closes it back to the list.
  4. SOON (Plugins): "Vibe — app builder · Coming soon" is one row with no link or button.
  5. SOON (New job): the grid ends with the same entry as a tile that is not a button.
  6. 0 page errors.

Captures: e2e/shots/desk-plugins-document-*.png. Env: FEEDBACK_PORT (default 4477). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4477"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"

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

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    for body in ({"name": "launch-page", "brief": "the launch page", "style": "web"},
                 {"name": "loose-notes", "brief": "notes no run made"},
                 {"name": "q4-brief", "brief": "a written brief", "style": "doc"}):
        post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", body)
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/d/launch-page/api/fork", {"from": 1})
    set_fixture(origin, editors=True, shell_csp=True, docs_index=True, extra_frames=[])

    # ── 1. the built-in row lists the documents it opens ───────────────────────────────────────
    page.goto(f"{origin}/plugins", wait_until="networkidle")
    row = page.locator('[data-testid="editor-plugin-row"][data-editor="wicked-page"]')
    row.wait_for(state="visible", timeout=15000)
    row.locator('[data-testid="plugin-document"]').first.wait_for(state="visible", timeout=15000)
    names = row.locator('[data-testid="plugin-document"]').evaluate_all("els => els.map(e => e.dataset.doc)")
    title = row.locator("p").first.inner_text()
    page.screenshot(path=str(SHOTS / "desk-plugins-document-list.png"))
    check("built-in-row-lists-its-documents",
          title.startswith("Page") and "launch-page" in names and "loose-notes" in names and "q4-brief" not in names
          and row.get_by_test_id("editor-plugin-elsewhere").is_visible(),
          title=title, names=names)

    # ── 2. a click opens the real document in the plugin ───────────────────────────────────────
    row.locator('[data-testid="plugin-document"][data-doc="launch-page"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('open') === 'launch-page'", timeout=10000)
    art = page.locator('[data-testid="everything-made-open"] [data-testid="plugin-card"][data-editor="wicked-page"]')
    art.wait_for(state="visible", timeout=15000)
    # The `open=` address opens it full screen by itself (a deep link opens full; no click masks a broken one).
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=10000)
    frame = page.locator('[data-testid="everything-made-open"] iframe[title^="Page: "]')
    frame.wait_for(state="attached", timeout=15000)
    src = frame.get_attribute("src") or ""
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / "desk-plugins-document-open.png"))
    q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    check("opens-the-real-document-in-the-plugin",
          art.get_attribute("data-editor") == "wicked-page" and art.get_attribute("data-artifact") == f"made:{PID}/launch-page"
          and page.get_by_test_id("everything-made-open").get_attribute("data-doc") == "launch-page"
          and "/api/v1/editors/wicked-page/" in src and "/editors/dev" not in page.url
          and q.get("tab") == ["made"] and q.get("project") == [PID],
          url=page.url, src=src[:120], editor=art.get_attribute("data-editor"))

    page.get_by_test_id("full-shell-exit").click()
    page.get_by_test_id("full-shell").wait_for(state="detached", timeout=5000)
    art.get_by_test_id("plugin-card-options").click()
    page.get_by_test_id("host-panel").wait_for(state="visible", timeout=5000)
    page.locator('[data-testid="host-panel-tab"][data-group="host"][data-tab="versions"]').click()

    # ── 2b. its versions work here too: picking version 1 shows version 1 (codex r1) ───────────
    page.locator('[data-testid="artifact-version-row"][data-version="1"] [data-testid="artifact-version-lens"]').click()
    page.get_by_test_id("artifact-lens-line").wait_for(state="visible", timeout=10000)
    shown = page.get_by_test_id("artifact-version-frame").get_attribute("data-version")
    page.get_by_test_id("artifact-lens-back").click()
    page.get_by_test_id("artifact-lens-line").wait_for(state="detached", timeout=10000)
    check("version-lens-works-on-the-made-list", shown == "1", shown=shown)

    # ── 3. Esc closes it back to the list ──────────────────────────────────────────────────────
    page.get_by_test_id("host-panel-close").click()
    art.get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Escape")
    page.get_by_test_id("full-shell").wait_for(state="detached", timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.querySelector('[data-testid=\"everything-made-open\"]')", timeout=8000)
    check("esc-closes-to-the-list", "open=" not in page.url, url=page.url)

    # ── 4. the app builder is coming soon on the Plugins page: no link, no button ──────────────
    page.goto(f"{origin}/plugins", wait_until="networkidle")
    soon = page.get_by_test_id("plugin-coming-soon")
    soon.wait_for(state="visible", timeout=10000)
    check("plugins-vibe-coming-soon",
          "Vibe — app builder" in soon.inner_text() and "Coming soon" in soon.inner_text()
          and "Apps are already built by pipelines today." in soon.inner_text()
          and soon.locator("a, button").count() == 0 and soon.get_attribute("aria-disabled") == "true",
          text=soon.inner_text())

    # ── 5. … and on the New job grid: the last tile, not a button ──────────────────────────────
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-new-job").click()
    tile = page.get_by_test_id("launch-wizard-soon")
    tile.wait_for(state="visible", timeout=8000)
    tile.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-plugins-document-newjob.png"))
    last = page.evaluate("() => document.querySelector('[data-testid=\"launch-wizard-cards\"]').lastElementChild?.dataset.testid ?? null")
    check("newjob-vibe-coming-soon",
          last == "launch-wizard-soon" and tile.evaluate("e => e.tagName") != "BUTTON"
          and tile.locator("a, button").count() == 0 and "Coming soon" in tile.inner_text(),
          last=last)

    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
