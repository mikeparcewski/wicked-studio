#!/usr/bin/env python3
"""
ux_sliceAC_test.py — the DES-UX-001 slice-AC gate: keyboard coherence (§7.7,
EC42) + composer preflight (§7.8, EC43), against the shared frozen-NOW0 W2
fixture (uxfix_fixture.py).

§7.7 DOM ACs:
  1. '?' renders [shortcut-overlay] on every route — board, project shell,
     doc surface — and the overlay is REGISTRY-rendered: the entries it lists
     are the slice-G registrations live on that surface (triage keys appear on
     the board, not on the doc surface), never a hand list;
  2. with the gate panel focused, 'a' fires the same POST /runs/:id/gate the
     Approve button fires (tap, exactly once — a double-tap is dropped); 'r'
     fires the reject; unfocused, both yield;
  3. ONE Escape contract: Escape closes the '?' overlay FIRST (an expanded
     runs sheet survives that press and collapses on the next), closes the
     bell popover, and closes the Operator-shell modal (the old
     disableEscapeKey opt-out is gone);
  4. the shell takes focus on open: xterm's helper textarea is
     document.activeElement without any click.

§7.8 DOM ACs:
  5. a code-shaped intent launched with no repo renders [preflight-block] and
     fires ZERO POST /runs until the override;
  6. entering the composer from a repo-bound project auto-attaches the repo
     chip ([repo-chip][data-auto-attached="true"], removable);
  7. [gate-posture] sits at top level and its shipped default is not "none"
     (COMPOSER_DEFAULT_GATE_POSTURE = before:1 — the launch body carries
     humanConfirm "before:1");
  8. named actions carry [action-preview] (Run Onboarding on the repo page).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-AC-shortcut-overlay.png  the board with the '?' overlay up, its grouped
                              registry-fed sections visible
  ux-AC-preflight.png         the composer blocked on a repo-less code intent —
                              warn copy, Attach / Launch-anyway, gate posture

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4399),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4399"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

SIMPLE_PROJECT = "q3-review-deck"
SIMPLE_RUN = "r-q3"
BOUND_PROJECT = "upload-endpoint"   # repo_member=True binds studio-api here
REPO_ID = "studio-api"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

OVERLAY_STATE = """() => {
  const ov = document.querySelector('[data-testid="shortcut-overlay"]');
  const groups = Array.from(document.querySelectorAll('[data-testid^="shortcut-group-"]'))
    .map((g) => g.dataset.testid.replace('shortcut-group-', ''));
  return { open: !!ov, groups, text: ov ? ov.textContent : '' };
}"""


def open_overlay(page) -> dict:
    page.keyboard.press("?")
    page.wait_for_function(
        "() => !!document.querySelector('[data-testid=\"shortcut-overlay\"]')", timeout=5000
    )
    return page.evaluate(OVERLAY_STATE)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # ════ Scene 1 (§7.7 AC1): '?' answers on every route, from the registry ════
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="band-needs-you"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    board = open_overlay(page)
    # Registry-rendered on the BOARD: triage + gates entries are mounted here,
    # and the palette chords + the overlay's own keys ride along.
    board_ok = all([
        board["open"],
        "triage" in board["groups"],
        "gates" in board["groups"],
        "palette" in board["groups"],
        "panels" in board["groups"],
        "Select the next card" in board["text"],          # useTriageCursor's entry
        "Approve the selected gate" in board["text"],     # its 'a' entry
        "Open the command palette" in board["text"],      # paletteShortcutEntries
        "Keyboard shortcuts (this overlay)" in board["text"],  # self-documenting
    ])
    page.screenshot(path=str(VSHOTS / "ux-AC-shortcut-overlay.png"))

    # Escape closes the overlay (chain rung 1).
    page.keyboard.press("Escape")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"shortcut-overlay\"]') === null", timeout=5000
    )

    # Project shell.
    page.goto(f"{ORIGIN}/p/{SIMPLE_PROJECT}/build", wait_until="domcontentloaded")
    page.locator('[data-testid="runs-bottom-bar"]').wait_for(timeout=30000)
    page.wait_for_timeout(300)
    shell_ov = open_overlay(page)
    page.keyboard.press("Escape")

    # Doc surface — the registry truth cuts the other way here: no triage
    # cursor is mounted, so the overlay documents NO triage keys.
    page.goto(f"{ORIGIN}/p/{SIMPLE_PROJECT}/document", wait_until="domcontentloaded")
    page.wait_for_timeout(500)
    doc_ov = open_overlay(page)
    doc_ok = doc_ov["open"] and "triage" not in doc_ov["groups"]
    page.keyboard.press("Escape")

    check("overlay_every_route_from_registry",
          board_ok and shell_ov["open"] and doc_ok,
          board_groups=board["groups"], shell_groups=shell_ov["groups"],
          doc_groups=doc_ov["groups"],
          screenshot=str(VSHOTS / "ux-AC-shortcut-overlay.png"))

    # ════ Scene 2 (§7.7 AC2): the gate panel honors a / r ═════════════════════
    gate_posts: list = []
    page.on("request", lambda r: gate_posts.append(r.post_data)
            if r.method == "POST" and r.url.endswith(f"/runs/{SIMPLE_RUN}/gate") else None)

    page.goto(f"{ORIGIN}/p/{SIMPLE_PROJECT}/build/{SIMPLE_RUN}", wait_until="domcontentloaded")
    page.locator('[data-testid="steering-gate"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # Unfocused first: 'a' yields silently.
    page.evaluate("() => document.activeElement?.blur?.()")
    page.keyboard.press("a")
    page.wait_for_timeout(300)
    unfocused_posts = len(gate_posts)

    # Focus the panel (click arms the keys), double-tap 'a' — exactly one POST.
    page.locator('[data-testid="steering-gate"]').click()
    page.keyboard.press("a")
    page.keyboard.press("a")
    page.wait_for_function("() => window.__done === undefined || true", timeout=1000)
    page.wait_for_timeout(600)
    approve_posts = [json.loads(b) for b in gate_posts[unfocused_posts:]]

    check("gate_panel_a_approves_once",
          unfocused_posts == 0
          and len(approve_posts) == 1
          and approve_posts[0].get("approve") is True,
          unfocused_posts=unfocused_posts, posts=approve_posts)

    # Reload: the fixture still answers awaiting_human, so the panel re-renders;
    # focused 'r' fires the reject POST.
    gate_posts.clear()
    page.goto(f"{ORIGIN}/p/{SIMPLE_PROJECT}/build/{SIMPLE_RUN}", wait_until="domcontentloaded")
    page.locator('[data-testid="steering-gate"]').wait_for(timeout=30000)
    page.locator('[data-testid="steering-gate"]').click()
    page.keyboard.press("r")
    page.wait_for_timeout(600)
    reject_posts = [json.loads(b) for b in gate_posts]
    check("gate_panel_r_rejects",
          len(reject_posts) == 1 and reject_posts[0].get("approve") is False,
          posts=reject_posts)

    # ════ Scene 3 (§7.7 AC3/AC4): the one Escape contract + shell focus ═══════
    # 3a. Overlay closes BEFORE the expanded runs sheet (chain order).
    page.goto(f"{ORIGIN}/work", wait_until="domcontentloaded")
    page.locator('[data-testid="runs-bottom-bar"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.get_by_label("Expand the runs sheet").click()
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"runs-bottom-bar\"]')?.dataset?.expanded === 'true'",
        timeout=5000)
    open_overlay(page)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    after_first = page.evaluate(
        """() => ({
          overlay: !!document.querySelector('[data-testid="shortcut-overlay"]'),
          sheet: document.querySelector('[data-testid="runs-bottom-bar"]')?.dataset?.expanded ?? null,
        })""")
    page.keyboard.press("Escape")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"runs-bottom-bar\"]')?.dataset?.expanded === 'false'",
        timeout=5000)
    check("escape_chain_overlay_before_sheet",
          after_first["overlay"] is False and after_first["sheet"] == "true",
          after_first=after_first)

    # 3b. The bell popover closes on Escape (the brief's named gap).
    page.get_by_title("Notifications").click()
    page.locator('[data-testid="bell-popover"]').wait_for(timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"bell-popover\"]') === null", timeout=5000)
    report["steps"]["escape_closes_bell"] = {"ok": True}

    # 3c. The Operator shell: opens focused, closes on Escape.
    page.keyboard.press("Control+k")
    page.locator('[data-testid="palette-input"]').wait_for(timeout=5000)
    page.keyboard.type("> open terminal")
    page.wait_for_function(
        """() => Array.from(document.querySelectorAll('[data-testid="palette-row"]'))
              .some((r) => (r.textContent || '').includes('Open Terminal'))""",
        timeout=5000)
    page.keyboard.press("Enter")
    page.locator('[data-testid="terminal"]').wait_for(timeout=10000)
    # §7.7: the shell TAKES focus on open — xterm's helper textarea is the
    # active element with no click (xterm opens on the next animation frame).
    focused = page.wait_for_function(
        """() => document.activeElement?.classList?.contains('xterm-helper-textarea')""",
        timeout=5000)
    page.keyboard.press("Escape")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"terminal\"]') === null", timeout=5000)
    check("shell_focused_and_escape_closes", bool(focused))

    # 3d. Stacked layers — ONE press, ONE layer (§7.7's "one contract"): bell
    # popover + Operator-shell modal + palette stacked; each Escape closes
    # exactly the top rung — palette first, then the modal, then the popover.
    STACK = """() => ({
      palette: !!document.querySelector('[data-testid="palette-input"]'),
      modal: !!document.querySelector('[data-testid="terminal"]'),
      bell: !!document.querySelector('[data-testid="bell-popover"]'),
    })"""
    page.get_by_title("Notifications").click()
    page.locator('[data-testid="bell-popover"]').wait_for(timeout=5000)
    page.keyboard.press("Control+k")           # palette over the popover (no mousedown)
    page.locator('[data-testid="palette-input"]').wait_for(timeout=5000)
    page.keyboard.type("> open terminal")
    page.keyboard.press("Enter")               # modal opens; palette closes itself
    page.locator('[data-testid="terminal"]').wait_for(timeout=10000)
    page.wait_for_timeout(300)
    page.evaluate("() => (document.activeElement)?.blur?.()")
    page.keyboard.press("Control+k")           # palette re-opens over the modal
    page.locator('[data-testid="palette-input"]').wait_for(timeout=5000)
    stack0 = page.evaluate(STACK)
    presses = []
    for _ in range(3):
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        presses.append(page.evaluate(STACK))
    check(
        "escape_one_press_one_layer",
        stack0 == {"palette": True, "modal": True, "bell": True}
        and presses[0] == {"palette": False, "modal": True, "bell": True}
        and presses[1] == {"palette": False, "modal": False, "bell": True}
        and presses[2] == {"palette": False, "modal": False, "bell": False},
        stack=stack0, presses=presses)

    # ════ Scene 4 (§7.8): preflight, auto-attach, gate posture, previews ══════
    set_fixture(ORIGIN, repo=True, repo_member=True, project_dto=True)
    run_posts: list = []
    pageB = ctx.new_page()
    pageB.on("request", lambda r: run_posts.append(r.post_data)
             if r.method == "POST" and r.url.endswith("/api/v1/runs") else None)
    pageB.goto(f"{ORIGIN}/runs/new", wait_until="domcontentloaded")
    pageB.locator('[data-testid="launch-problem"]').wait_for(timeout=30000)
    pageB.add_style_tag(content=HIDE_GATE_TOASTS)

    # AC7: gate posture at top level, shipped default ≠ none.
    posture = pageB.evaluate(
        "() => document.querySelector('[data-testid=\"gate-posture\"]')?.value ?? null")
    check("gate_posture_top_level_default", posture == "before", value=posture)

    # AC5: code intent, no repo → warn-and-block, ZERO POST /runs.
    pageB.locator('[data-testid="launch-problem"]').fill("fix the login crash bug")
    pageB.locator('[data-testid="launch-submit"]').click()
    pageB.locator('[data-testid="preflight-block"]').wait_for(timeout=10000)
    pageB.wait_for_timeout(400)
    blocked_posts = len(run_posts)
    pageB.screenshot(path=str(VSHOTS / "ux-AC-preflight.png"))
    check("preflight_blocks_with_zero_posts", blocked_posts == 0,
          posts=blocked_posts, screenshot=str(VSHOTS / "ux-AC-preflight.png"))

    # …and the override launches, carrying the default posture on the wire.
    pageB.locator('[data-testid="preflight-override"]').click()
    pageB.wait_for_function("() => window.location.pathname !== '/runs/new'", timeout=10000)
    launched = [json.loads(b) for b in run_posts]
    check("override_launches_with_default_posture",
          len(launched) == 1 and launched[0].get("humanConfirm") == "before:1",
          bodies=launched)

    # AC6: the bound project's crew.repo auto-attaches as a removable chip.
    pageB.goto(f"{ORIGIN}/p/{BOUND_PROJECT}/build/new", wait_until="domcontentloaded")
    pageB.locator('[data-testid="repo-chip"]').wait_for(timeout=15000)
    chip = pageB.evaluate(
        """() => {
          const c = document.querySelector('[data-testid="repo-chip"]');
          return { auto: c?.dataset?.autoAttached ?? null, text: c?.textContent ?? '',
                   removable: !!c?.querySelector('button') };
        }""")
    pageB.locator('[data-testid="repo-chip"] button').click()
    pageB.wait_for_function(
        "() => document.querySelector('[data-testid=\"repo-chip\"]') === null", timeout=5000)
    check("repo_auto_attach_chip",
          chip["auto"] == "true" and REPO_ID in chip["text"] and chip["removable"],
          chip=chip)

    # AC8: the named action previews what it does and writes.
    pageB.goto(f"{ORIGIN}/repo-detail/{REPO_ID}", wait_until="domcontentloaded")
    pageB.locator('[data-testid="action-preview"]').wait_for(timeout=15000)
    preview = pageB.evaluate(
        "() => document.querySelector('[data-testid=\"action-preview\"]')?.textContent ?? ''")
    check("named_action_preview",
          "governed run" in preview and "writes" in preview.replace("rewrites", "writes"),
          preview=preview.strip())

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
