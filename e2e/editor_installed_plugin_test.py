#!/usr/bin/env python3
"""
editor_installed_plugin_test.py — an editor plugin that a /workflow-editor-plugin run BUILT and garden's
install.py INSTALLED is listed on the Plugins page, opens in the editor host, and WORKS: it shows the page it
is opened on, the user fills its form, sees the entry it renders and adds it to the page as a version
(PRODUCT-WORKS J6: "it opens in the editor host"; the operator's "no tests that show the plugins being exercised",
2026-10-26; plugins-complete G9 / ruling D7: the entry is appended to the page, dated, as a version).

`e2e/editor-fixtures/changelog-entry.html` started as, byte for byte, `editors/mpx-changelog-entry/index.html` from
the pack a run delivered (crew 0.16.3: type, summary and PR fields that render a CHANGELOG line, and nothing else:
it never read the page and could not save, G9). It now has the behaviour garden's conformance cases 18 and 7
require of every editor (G9b): it asks `artifact.read` and lists the page's parts (read again when another version
lands), and its "Add entry" control (`data-wicked-save`) appends a dated `### <Type> (YYYY-MM-DD)` entry to the
page's last part as ONE `version.write`. It passes garden's conformance run (0-18). Its pinned hash is in
`changelog-entry.wicked-pack.json` and `changelog-entry.registry.json` (crew's `GET /api/v1/editors` row shape, with
its three permissions). The fixture (`installed_editor`) serves both, the entry hash-pinned with crew's bundle CSP,
and its grants as decided at its install consent (read, write, full screen).

  1. LISTED: /plugins shows the card "Changelog entry" tagged You installed (not Built in); its details say version 0.1.0,
     with its three permissions in plain words.
  2. OPENS: its "Try it on a sample page" opens the editor test page for exactly that editor, version and
     hash; the host draws the card from the plugin's declaration (protocol 2, actions Clear form + Ask
     about it) and the plugin's frame loads.
  3. SHOWS the page: the sample page's parts are listed in it ("Book a study room in under a minute"), and the
     entry is said to go after the last one.
  4. USED: Type Fixed, summary "The export button no longer hangs", PR 123 renders
     "### Fixed (<today>)\\n- The export button no longer hangs (#123)"; "#45" is accepted as 45; a PR that is not
     digits is dropped from the line with the hint "PR number must be digits"; no summary shows the prompt and
     "Add entry" is disabled.
  5. SAVES: "Add entry" lands ONE version (version 2): the page's last part is what it was plus the entry; the
     plugin says "Added as version 2" and clears the form; the card keeps the host's edited line with its Undo,
     and Undo takes the entry back out (the plugin reads the page again and shows it as it was).
  6. HOST ACTION: the host-drawn "Clear form" (verb plugin) reaches the plugin, which clears the form and
     answers "Form cleared" on the card's line.
  7. 0 page errors, in light and dark, at 1440x700.

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
FIXED_NOW = "2026-11-06T12:00:00Z"

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
        # One date for the whole run, in the editor's frame too (a run across UTC midnight never splits an entry).
        page.clock.set_fixed_time(FIXED_NOW)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

        # ── 1. listed on the Plugins page as installed ──────────────────────────────────────────────
        page.goto(f"{origin}/plugins", wait_until="networkidle")
        # The Plugins page is cards (DES-LEARN §2): the installed one's card, then its details.
        tile = page.locator(f'[data-testid="plugin-tile"][data-plugin="{EDITOR}"]')
        try:
            tile.wait_for(state="visible", timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"editor-installed-plugin-missing-{theme}.png"))
            fail(f"{theme}-listed", f"no card for the installed plugin: {e}")
        tile.scroll_into_view_if_needed()
        tile_text = tile.inner_text()
        tile.click()
        details = page.get_by_test_id("plugin-details")
        details.wait_for(state="visible", timeout=10000)
        row = details.locator(f'[data-testid="editor-plugin-row"][data-editor="{EDITOR}"]')
        head = details.locator(".wk-plugdetail-name").inner_text()
        # May do is what crew decided (F37): read once its answer is in.
        try:
            page.wait_for_function("() => (document.querySelector('[data-testid=\"plugin-details\"] [data-testid=\"editor-plugin-permissions\"]')?.textContent || '').startsWith('Can')", timeout=10000)
        except Exception:
            pass
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-list-{theme}.png"))
        check(f"{theme}-listed-as-installed",
              tile.get_by_test_id("plugin-tile-title").inner_text() == "Changelog entry" and tile.get_by_test_id("plugin-tile-source").inner_text() == "You installed"
              and "0.1.0" in head and details.get_by_test_id("editor-plugin-permissions").inner_text().strip()
              == "Can: read what it opens · change it (you can undo) · go full screen",
              text=tile_text[:300], head=head)

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
        today = frame.locator("body").evaluate("() => new Date().toISOString().slice(0, 10)")
        check(f"{theme}-the-editor-sees-the-fixed-date", today == FIXED_NOW[:10], today=today)
        check(f"{theme}-starts-with-the-prompt", out(frame) == f"### Changed ({today})\nAdd a summary to see the entry line."
              and frame.locator("#add").is_disabled(), out=out(frame))

        # ── 3. shows the page it is opened on ───────────────────────────────────────────────────────
        frame.locator("#page li").first.wait_for(state="visible", timeout=10000)
        shown = frame.locator("#page li").all_inner_texts()
        target = frame.locator("#target").inner_text()
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-shows-{theme}.png"))
        check(f"{theme}-shows-the-page", "Book a study room in under a minute" in shown
              and target.startswith("The entry goes after: ") and shown[-1].startswith(target.removeprefix("The entry goes after: ")[:40]),
              shown=shown[:6], target=target)

        # ── 4. used: fill the form, read the entry it renders ───────────────────────────────────────
        frame.locator("#type").select_option("Fixed")
        fill(frame, "#summary", "The export button no longer hangs")
        fill(frame, "#pr", "123")
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-filled-{theme}.png"))
        check(f"{theme}-renders-the-entry", out(frame) == f"### Fixed ({today})\n- The export button no longer hangs (#123)", out=out(frame))
        fill(frame, "#pr", "#45")
        check(f"{theme}-hash-pr-accepted", out(frame) == f"### Fixed ({today})\n- The export button no longer hangs (#45)", out=out(frame))
        fill(frame, "#pr", "12a")
        hint = frame.locator("#prnote").inner_text()
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-bad-pr-{theme}.png"))
        check(f"{theme}-bad-pr-dropped-with-hint",
              out(frame) == f"### Fixed ({today})\n- The export button no longer hangs" and hint == "PR number must be digits",
              out=out(frame), hint=hint)
        frame.locator("#type").select_option("Security")
        fill(frame, "#summary", "")
        check(f"{theme}-no-summary-prompts", out(frame) == f"### Security ({today})\nAdd a summary to see the entry line."
              and frame.locator("#add").is_disabled(), out=out(frame))

        # ── 5. saves: Add entry lands ONE version whose last part ends with the entry ────────────────
        # The card's own host and adapter (the test page's `window.__wickedEditor` is not the card's): what the
        # plugin reads back from the host after the write is the evidence, with the version the write's reply named.
        orig_last = frame.locator("#page li").last.inner_text()
        frame.locator("#type").select_option("Changed")
        fill(frame, "#summary", "The export button no longer hangs")
        fill(frame, "#pr", "123")
        want = f"### Changed ({today})\n- The export button no longer hangs (#123)"
        check(f"{theme}-entry-ready", out(frame) == want and frame.locator("#add").is_enabled(), out=out(frame))
        frame.locator("#add").click()
        try:
            frame.locator("#status", has_text="Added as version").wait_for(state="visible", timeout=10000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"editor-installed-plugin-nosave-{theme}.png"))
            fail(f"{theme}-saves", f"no version landed: {e}; status {frame.locator('#status').inner_text()!r}")
        frame.locator("#page li", has_text="The export button no longer hangs (#123)").wait_for(state="visible", timeout=5000)
        last_part = frame.locator("#page li").last.inner_text()
        page_text = "\n".join(frame.locator("#page li").all_inner_texts())
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-saved-{theme}.png"))
        # The host's own line for the write, with its Undo (the plugin never talks over it).
        host_line = card.get_by_test_id("page-line")
        check(f"{theme}-saves-one-version",
              frame.locator("#status").inner_text() == "Added as version 2" and last_part == f"{orig_last}\n\n{want}"
              and page_text.count("The export button no longer hangs (#123)") == 1
              and host_line.get_attribute("data-kind") == "edited" and card.get_by_test_id("page-undo").count() == 1
              and frame.locator("#summary").input_value() == "" and frame.locator("#pr").input_value() == "",
              last_part=last_part[-160:], original=orig_last, line=host_line.inner_text(), status=frame.locator("#status").inner_text())
        # The host's Undo takes the entry back out, and the plugin shows the page as it was.
        card.get_by_test_id("page-undo").click()
        frame.locator("#page li", has_text="The export button no longer hangs (#123)").wait_for(state="detached", timeout=10000)
        check(f"{theme}-host-undo-takes-it-back", frame.locator("#page li").last.inner_text() == orig_last,
              last=frame.locator("#page li").last.inner_text()[-120:], line=host_line.inner_text())

        # ── 6. the host-drawn Clear form reaches the plugin ─────────────────────────────────────────
        fill(frame, "#summary", "Something to clear")
        card.locator('[data-testid="plugin-card-action"][data-action="clear"]').click()
        line = card.get_by_test_id("page-line")
        line.wait_for(state="visible", timeout=5000)
        page.wait_for_function(
            "(sel) => (document.querySelector(sel + ' [data-testid=\"page-line\"]')?.textContent || '').includes('Form cleared')",
            arg=CARD, timeout=5000)
        page.screenshot(path=str(SHOTS / f"editor-installed-plugin-cleared-{theme}.png"))
        check(f"{theme}-clear-form-action",
              out(frame) == f"### Changed ({today})\nAdd a summary to see the entry line." and frame.locator("#summary").input_value() == ""
              and frame.locator("#pr").input_value() == "",
              out=out(frame), line=line.inner_text())
        page.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
