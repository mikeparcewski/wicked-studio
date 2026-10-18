#!/usr/bin/env python3
"""
editor_surfaces_test.py — H7, the acceptance journey for the editor plugin contract's three surfaces
(DES-EDITOR-PLUGIN-CONTRACT-001 §8.3): a protocol-2 plugin, loaded on the editor test page (/editors/dev) over
the scripted sample artifact, renders its CARD (host chrome, the declared actions), its OPTIONS group in the host
panel (a plugin tab and a host-rendered controls tab) and FULL SCREEN (the nav collapses and returns,
Simple/Advanced, the chat drawer) — all drawn from its declaration, with no host code that knows the plugin.

  python3 e2e/editor_surfaces_test.py                       # both bundles (CI)
  python3 e2e/editor_surfaces_test.py --bundle v2-sample    # the hand-written protocol-2 sample (e2e/editor-fixtures/v2-sample.html)
  python3 e2e/editor_surfaces_test.py --bundle scaffold     # the builder-scaffolded plugin (e2e/editor-fixtures/scaffold.html),
                                                            # garden scaffold.py with the defaults, untouched

Light and dark at 1440x700. Captures: e2e/shots/editor-surfaces-<bundle>-<surface>-<theme>.png.
Env: FEEDBACK_PORT (default 4356).
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.parse

from uxfix_fixture import DEFAULT_APPEARANCE, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4356"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
FIX = REPO / "e2e" / "editor-fixtures"
# scaffold.html is garden's `scaffold.py` output with the defaults (the B1 builder's acme-notes sample, pinned as
# its pack manifest pins it); scaffold.surfaces.json is that manifest's `surfaces`.
BUNDLES = {"v2-sample": ("acme-v2", "v2-sample.html"), "scaffold": ("acme-notes", "scaffold.html")}

ap = argparse.ArgumentParser()
ap.add_argument("--bundle", choices=sorted(BUNDLES) + ["all"], default="all")
args = ap.parse_args()
if args.bundle == "all":
    # Each bundle in its own run (its own server port): one red one says which.
    import subprocess
    rcs = [subprocess.run([sys.executable, __file__, "--bundle", b], env=dict(os.environ, FEEDBACK_PORT=str(PORT + i))).returncode
           for i, b in enumerate(sorted(BUNDLES))]
    sys.exit(max(rcs))
EDITOR, FILE = BUNDLES[args.bundle]

report: dict = {"ok": False, "bundle": args.bundle, "cases": {}}


def fail(case: str, why) -> None:
    report["cases"][case] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(case: str, ok: bool, **detail) -> None:
    report["cases"][case] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


entry = FIX / FILE
if not entry.is_file():
    fail("bundle", f"{entry} is missing")
# The declaration the plugin sends, from its manifest sidecar (<bundle>.surfaces.json — the scaffold's manifest
# `surfaces`): the journey asserts the host drew exactly that.
side = entry.with_suffix(".surfaces.json")
if not side.is_file():
    fail("declaration", f"{side} is missing")
decl = json.loads(side.read_text())
SHA = hashlib.sha256(entry.read_bytes()).hexdigest()

dist = ensure_build(fail)
origin = start_server(PORT, dist)
GRANTS = ["artifact.read", "artifact.write", "selection.chip", "composer.draft", "ui.fullscreen"]
set_fixture(origin, editors=True, shell_csp=True, editor_grants=GRANTS)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
q = {"editor": EDITOR, "version": "0.1.0", "sha": SHA, "title": "Sample editor"}
URL = f"{origin}/editors/dev?{urllib.parse.urlencode(q)}"
CARD = '[data-testid="editor-surfaces"] [data-testid="plugin-card"]'

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors: list[str] = []
    for theme in ("light", "dark"):
        attr = None if theme == "dark" else theme
        set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme})
        page = browser.new_page(viewport={"width": W, "height": H})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="networkidle")
        try:
            page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=attr, timeout=8000)
            page.locator(f'{CARD}[data-protocol="2"]').wait_for(state="visible", timeout=15000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / f"editor-surfaces-{args.bundle}-missing-{theme}.png"))
            fail(f"{theme}-card-protocol-2", f"the card did not negotiate protocol 2: {e}")
        card = page.locator(CARD)
        frame = page.frame_locator(f'{CARD} [data-testid="editor-frame"]')

        # ── the card: host chrome drawn from the declaration ──
        want_actions = [a["id"] for a in decl["card"].get("actions", [])]
        got_actions = card.get_by_test_id("plugin-card-action").evaluate_all("els => els.map(e => e.dataset.action)")
        check(f"{theme}-card-actions", got_actions == want_actions, want=want_actions, got=got_actions)
        check(f"{theme}-card-options-full", card.get_by_test_id("plugin-card-options").count() == (1 if "options" in decl else 0)
              and card.get_by_test_id("plugin-card-full").count() == (1 if "full" in decl else 0))
        frame.locator("body").wait_for(state="attached", timeout=5000)
        page.wait_for_timeout(400)
        page.screenshot(path=str(SHOTS / f"editor-surfaces-{args.bundle}-card-{theme}.png"))
        plugin_actions = [a for a in decl["card"].get("actions", []) if a["verb"] == "plugin"]
        if plugin_actions:
            card.locator(f'[data-testid="plugin-card-action"][data-action="{plugin_actions[0]["id"]}"]').click()
            page.wait_for_timeout(600)
            line = card.get_by_test_id("page-line")
            check(f"{theme}-card-action-answered", line.count() == 1 and "no answer" not in line.inner_text(), line=line.inner_text() if line.count() else None)

        # ── options: the plugin's tabs join the host panel, then × removes them ──
        if "options" in decl:
            card.get_by_test_id("plugin-card-options").click()
            panel = page.get_by_test_id("host-panel")
            panel.wait_for(state="visible", timeout=5000)
            tabs = panel.get_by_test_id("host-panel-tab").evaluate_all("els => els.map(e => e.dataset.group + ':' + e.dataset.tab)")
            want_tabs = ["run:run"] + [f"plugin:{t['id']}" for t in decl["options"]["tabs"]]
            check(f"{theme}-options-tabs", tabs[: len(want_tabs)] == want_tabs, want=want_tabs, got=tabs)
            for t in decl["options"]["tabs"]:
                panel.locator(f'[data-testid="host-panel-tab"][data-tab="{t["id"]}"]').click()
                if t["render"] == "controls":
                    controls = panel.get_by_test_id("host-control")
                    controls.first.wait_for(state="visible", timeout=5000)
                    check(f"{theme}-controls-{t['id']}", controls.count() == len(t["controls"]), count=controls.count())
                    toggle = next((c for c in t["controls"] if c["type"] == "toggle"), None)
                    if toggle is not None:
                        ctl = panel.locator(f'[data-testid="host-control"][data-control="{toggle["id"]}"]')
                        ctl.locator("input").click()
                        page.wait_for_function(f"""() => document.querySelector('[data-testid="host-control"][data-control="{toggle["id"]}"]')?.dataset.state === 'confirmed'""", timeout=5000)
                else:
                    panel.get_by_test_id("host-panel-frame").wait_for(state="visible", timeout=5000)
                page.wait_for_timeout(400)
                page.screenshot(path=str(SHOTS / f"editor-surfaces-{args.bundle}-options-{t['id']}-{theme}.png"))
            panel.get_by_test_id("host-panel-close").click()
            # Back to the run's details alone: one panel, no one-tab strip.
            check(f"{theme}-options-closed", panel.get_by_test_id("host-panel-tab").count() == 0)

        # ── full screen: the nav collapses, modes, the chat drawer, Esc returns ──
        if "full" in decl:
            nav_before = page.evaluate("() => document.querySelector('[data-shell]')?.dataset.navCollapsed ?? null")
            card.get_by_test_id("plugin-card-full").click()
            shell = page.get_by_test_id("full-shell")
            shell.wait_for(state="visible", timeout=5000)
            check(f"{theme}-full-nav-collapsed", page.evaluate("() => document.querySelector('[data-shell]')?.dataset.navCollapsed") == "true")
            modes = decl["full"].get("modes")
            got_modes = shell.get_by_test_id("full-shell-mode").count()
            check(f"{theme}-full-modes", got_modes == (len(modes) if modes else 0), got=got_modes)
            if modes:
                shell.locator('[data-testid="full-shell-mode"][data-mode="advanced"]').click()
                page.wait_for_function("""() => document.querySelector('[data-testid="full-shell-mode"][data-mode="advanced"]')?.getAttribute('aria-checked') === 'true'""", timeout=5000)
            shell.get_by_test_id("full-shell-chat").click()
            shell.get_by_test_id("full-shell-drawer").wait_for(state="visible", timeout=5000)
            page.wait_for_timeout(400)
            page.screenshot(path=str(SHOTS / f"editor-surfaces-{args.bundle}-full-{theme}.png"))
            shell.get_by_test_id("full-shell-exit").click()
            page.get_by_test_id("full-shell").wait_for(state="detached", timeout=5000)
            check(f"{theme}-full-nav-restored", page.evaluate("() => document.querySelector('[data-shell]')?.dataset.navCollapsed ?? null") == nav_before)
        page.close()
    browser.close()
    check("no-page-errors", not errors, errors=errors[:5])

report["ok"] = True
print(json.dumps(report, indent=2))
