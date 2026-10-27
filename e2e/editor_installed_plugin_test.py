#!/usr/bin/env python3
"""
editor_installed_plugin_test.py — an editor plugin that a /workflow-editor-plugin run BUILT and garden's
install.py INSTALLED is listed on the Plugins page, opens in the editor host, and WORKS: the user fills its
form and sees the entry it renders (PRODUCT-WORKS J6: "it opens in the editor host"; the operator's
"no tests that show the plugins being exercised", 2026-10-26).

The plugin is the real artifact, not a hand-written fixture. `e2e/editor-fixtures/changelog-entry.html` is,
byte for byte, `editors/mpx-changelog-entry/index.html` from the pack the run delivered ("Changelog entry":
type, summary and PR fields that render a CHANGELOG line; sha256 9bb3121a…, pinned in the pack's
`wicked-pack.json`, copied beside it as `changelog-entry.wicked-pack.json`). `changelog-entry.registry.json`
is crew 0.16.3's own `GET /api/v1/editors` row for it after `install.py --from-run --target daemon`
registered it. The fixture (`installed_editor`) serves both, the entry hash-pinned with crew's bundle CSP.

  1. LISTED: /plugins shows the row "Changelog entry" tagged Installed (not Built in), version 0.1.0,
     with its one permission in plain words.
  2. OPENS: its "Try it on a sample page" opens the editor test page for exactly that editor, version and
     hash; the host draws the card from the plugin's declaration (protocol 2, actions Clear form + Ask
     about it) and the plugin's frame loads.
  3. USED: Type Fixed, summary "The export button no longer hangs", PR 123 renders
     "### Fixed\\n- The export button no longer hangs (#123)"; "#45" is accepted as 45; a PR that is not
     digits is dropped from the line with the hint "PR number must be digits"; no summary shows the prompt.
  4. HOST ACTION: the host-drawn "Clear form" (verb plugin) reaches the plugin, which clears the form and
     answers "Form cleared" on the card's line.
  5. 0 page errors, in light and dark, at 1440x700.

Captures: e2e/shots/editor-installed-plugin-*.png. Env: FEEDBACK_PORT (default 4481). JSON report; exit 0/1.
"""

import hashlib
import json
import os
import sys
import urllib.parse

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4481"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
FIX = REPO / "e2e" / "editor-fixtures"
EDITOR = "mpx-changelog-entry"

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


# ── 0. the artifact is the one the run delivered: the pack pins this exact entry ──────────────────────
entry = (FIX / "changelog-entry.html").read_bytes()
pack = json.loads((FIX / "changelog-entry.wicked-pack.json").read_text())
row_wire = json.loads((FIX / "changelog-entry.registry.json").read_text())
SHA = hashlib.sha256(entry).hexdigest()
pinned = next((e for e in pack["editors"] if e["id"] == EDITOR), {})
check("artifact-is-the-pinned-pack-entry",
      pinned.get("sha256") == SHA and row_wire["sha256"] == SHA and row_wire["source"] == "pack"
      and row_wire["first_party"] is False and row_wire["bytes"] == len(entry),
      sha=SHA, pinned=pinned.get("sha256"), registry=row_wire["sha256"])
WANT_ACTIONS = [a["id"] for a in pinned["surfaces"]["card"]["actions"]]

dist = ensure_build(fail)
origin = start_server(PORT, dist)
set_fixture(origin, editors=True, shell_csp=True, installed_editor=True)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
CARD = '[data-testid="plugin-card"][data-editor="mpx-changelog-entry"]'


def fill(frame, sel: str, text: str) -> None:
    """Type the way a user does (focus, keys), so the plugin's own input listeners render the entry."""
    box = frame.locator(sel)
    box.click()
    box.press("ControlOrMeta+a")
    box.press("Backspace")
    if text:
        box.press_sequentially(text)


def out(frame) -> str:
    return frame.locator("#out").inner_text()


with sync_playwright() as p:
    browser = p.chromium.launch()
    for theme in ("dark", "light"):
        set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme})
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

        # ── 1. listed on the Plugins page as installed ──────────────────────────────────────────────
        page.goto(f"{origin}/plugins", wait_until="networkidle")
        row = page.locator(f'[data-testid="editor-plugin-row"][data-editor="{EDITOR}"]')
        try:
            row.wait_for(state="visible", timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"editor-installed-plugin-missing-{theme}.png"))
            fail(f"{theme}-listed", f"no row for the installed plugin: {e}")
        row.scroll_into_view_if_needed()
        text = row.inner_text()
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-list-{theme}.png"))
        check(f"{theme}-listed-as-installed",
              text.startswith("Changelog entry") and row.get_by_test_id("editor-plugin-source").inner_text() == "Installed"
              and "Version 0.1.0" in text and "Can: " in row.get_by_test_id("editor-plugin-permissions").inner_text(),
              text=text[:300])

        # ── 2. opens in the editor host: this editor, this version, this hash ───────────────────────
        door = row.get_by_test_id("editor-plugin-open")
        door_text = door.inner_text()
        door.click()
        page.wait_for_url("**/editors/dev?**", timeout=10000)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
        card = page.locator(CARD)
        try:
            card.wait_for(state="visible", timeout=15000)
            page.locator(f'{CARD}[data-protocol="2"]').wait_for(state="visible", timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"editor-installed-plugin-nocard-{theme}.png"))
            fail(f"{theme}-opens", f"the card did not load protocol 2: {e}")
        frame = page.frame_locator(f'{CARD} [data-testid="editor-frame"]')
        frame.locator("#summary").wait_for(state="visible", timeout=15000)
        src = card.get_by_test_id("editor-frame").get_attribute("src") or ""
        actions = card.get_by_test_id("plugin-card-action").evaluate_all("els => els.map(e => e.dataset.action)")
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-opened-{theme}.png"))
        check(f"{theme}-opens-in-the-editor-host",
              door_text == "Try it on a sample page" and q.get("editor") == [EDITOR] and q.get("version") == ["0.1.0"]
              and q.get("sha") == [SHA] and f"/api/v1/editors/{EDITOR}/0.1.0/entry" in src and SHA in src
              and actions == WANT_ACTIONS,
              url=page.url, src=src[:160], actions=actions, want=WANT_ACTIONS)
        check(f"{theme}-starts-with-the-prompt", out(frame) == "### Added\nAdd a summary to see the entry line.", out=out(frame))

        # ── 3. used: fill the form, read the entry it renders ───────────────────────────────────────
        frame.locator("#type").select_option("Fixed")
        fill(frame, "#summary", "The export button no longer hangs")
        fill(frame, "#pr", "123")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-filled-{theme}.png"))
        check(f"{theme}-renders-the-entry", out(frame) == "### Fixed\n- The export button no longer hangs (#123)", out=out(frame))
        fill(frame, "#pr", "#45")
        check(f"{theme}-hash-pr-accepted", out(frame) == "### Fixed\n- The export button no longer hangs (#45)", out=out(frame))
        fill(frame, "#pr", "12a")
        hint = frame.locator("#prnote").inner_text()
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-bad-pr-{theme}.png"))
        check(f"{theme}-bad-pr-dropped-with-hint",
              out(frame) == "### Fixed\n- The export button no longer hangs" and hint == "PR number must be digits",
              out=out(frame), hint=hint)
        frame.locator("#type").select_option("Security")
        fill(frame, "#summary", "")
        check(f"{theme}-no-summary-prompts", out(frame) == "### Security\nAdd a summary to see the entry line.", out=out(frame))

        # ── 4. the host-drawn Clear form reaches the plugin ─────────────────────────────────────────
        fill(frame, "#summary", "Something to clear")
        card.locator('[data-testid="plugin-card-action"][data-action="clear"]').click()
        line = card.get_by_test_id("page-line")
        line.wait_for(state="visible", timeout=5000)
        page.wait_for_function(
            "(sel) => (document.querySelector(sel + ' [data-testid=\"page-line\"]')?.textContent || '').includes('Form cleared')",
            arg=CARD, timeout=5000)
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-cleared-{theme}.png"))
        check(f"{theme}-clear-form-action",
              out(frame) == "### Added\nAdd a summary to see the entry line." and frame.locator("#summary").input_value() == ""
              and frame.locator("#pr").input_value() == "",
              out=out(frame), line=line.inner_text())
        page.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
