#!/usr/bin/env python3
"""
type_to_composer_test.py — S2b: LETTERS ALWAYS TYPE (DES-STUDIO-REBUILD-001 §5.6 rule 4), 1440x700.

A printable key with no modifier, with focus outside any editable and outside a composite control
that claims keys, goes to a composer: the open Ask dock, else the page's composer, else the Ask
dock opened with the text. Typing never answers a gate (§10). Against the `wave1` corpus with a
SIMPLE gate waiting on b1:

  body      Home, nothing focused: "approve this" opens the Ask dock and lands in its input.
  card      Home, the beta card selected and focused (⌥J): "approve this" lands in the dock.
  button    Home, the b1 gate chip's Approve button focused: "approve this" lands in the dock;
            the button is not pressed (no undo toast).
  page      /runs/new, the launch composer mounted, a button focused: "approve this" lands in
            the page's composer (launch-problem), and no Ask dock opens.
  gate      the b1 thread (/p/beta/build/b1), the gate card's Approve focused: the gate card's
            own steer box (whose send approves the gate) stays EMPTY; the text lands in the dock.
  composite /theme, a skin radio focused: a typed letter and digit stay with the radiogroup —
            no dock opens, no composer receives them.
  zero      after waiting past the 10 s undo window, NO gate POST reached the daemon (browser
            and fixture both) and no undo toast ever appeared.

Captures: e2e/shots/type-to-composer-{home,gate,page}.png.
Env: FEEDBACK_PORT (default 4362), STUDIO_SKIN. Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4362"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
TEXT = "approve this"

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


def server_posts(origin: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as res:
        return json.loads(res.read())["posts"]


VALUE = "(id) => document.querySelector(`[data-testid=\"${id}\"]`)?.value ?? null"
ACTIVE = "() => { const a = document.activeElement; return a ? (a.dataset.testid || a.tagName) : null; }"

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, wave1=True, gate_now=["b1"], gate_simple=["b1"], status_over={},
                extra_gates=[], extra_frames=[], reset_gate_posts=True)
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    # Every undo toast that EVER mounts (however briefly, on any page) is recorded, so "no toast"
    # is a whole-run fact, not a sample. sessionStorage survives the navigations below.
    page.add_init_script("""
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="undo-toast"]')) {
          sessionStorage.setItem('t2c-toasts', String(Number(sessionStorage.getItem('t2c-toasts') || '0') + 1)
            + ':' + location.pathname);
        }
      }).observe(document, { childList: true, subtree: true });
      // Whether the page prevented the default of each keydown (a redirect does), read after dispatch.
      window.__keys = [];
      window.addEventListener('keydown', (e) => { setTimeout(() => window.__keys.push([e.key, e.defaultPrevented]), 0); });
    """)
    posts: list = []
    toasts: list = []
    page.on("request", lambda r: posts.append(r.url)
            if r.method == "POST" and r.url.rstrip("/").endswith("/gate") else None)

    def note_toast() -> None:
        seen = page.evaluate("() => sessionStorage.getItem('t2c-toasts')")
        if seen and seen not in toasts:
            toasts.append(seen)

    def home() -> None:
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("gate-chip-b1").wait_for(state="visible", timeout=15000)

    def typed_into_dock(step: str) -> None:
        page.keyboard.type(TEXT)
        try:
            page.wait_for_function(f"() => ({VALUE})('assist-input') === {json.dumps(TEXT)}", timeout=5000)
        except Exception:  # noqa: BLE001 — reported by the check below
            pass
        note_toast()
        # Focus must land in the dock too: a later Space then types there instead of
        # pressing the card/button that held focus before.
        active = page.evaluate(ACTIVE)
        check(step, page.evaluate(VALUE, "assist-input") == TEXT and active == "assist-input" and not toasts,
              dock=page.evaluate(VALUE, "assist-input"), active=active, toasts=toasts)

    # ── body: nothing focused on Home ──────────────────────────────────────────────
    home()
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    typed_into_dock("body-focus-types-into-ask-dock")
    page.screenshot(path=str(SHOTS / "type-to-composer-home.png"))

    # ── card: the triage-selected card holds focus ─────────────────────────────────
    home()
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("Alt+j")
    page.wait_for_function(
        "() => document.activeElement?.getAttribute('data-kbd-item') === 'beta'", timeout=5000)
    typed_into_dock("focused-card-types-into-ask-dock")

    # ── button: the gate chip's Approve button holds focus ─────────────────────────
    home()
    page.get_by_test_id("gate-approve-b1").focus()
    check("approve-button-focused", page.evaluate(ACTIVE) == "gate-approve-b1", active=page.evaluate(ACTIVE))
    typed_into_dock("focused-approve-button-types-into-ask-dock")

    # ── page: the launch composer is the page's composer ───────────────────────────
    page.goto(f"{origin}/runs/new", wait_until="networkidle")
    page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("launch-problem").fill("")
    # A real, enabled button holds focus (the Send button is disabled while the box is empty).
    page.evaluate("""() => [...document.querySelectorAll('main button:not([disabled]), button:not([disabled])')]
      .find((b) => !b.closest('[role]') && b.offsetParent !== null)?.focus()""")
    page_focus = page.evaluate("() => document.activeElement?.tagName ?? null")
    check("page-button-focused", page_focus == "BUTTON", active=page_focus)
    page.keyboard.type(TEXT)
    page.wait_for_timeout(300)
    launch = page.evaluate(VALUE, "launch-problem")
    dock_open = page.get_by_test_id("assist-input").count()
    page.screenshot(path=str(SHOTS / "type-to-composer-page.png"))
    check("page-composer-takes-the-letters", launch == TEXT and dock_open == 0,
          launch=launch, dock_open=dock_open, active=page.evaluate(ACTIVE))

    # ── gate: the gate card's steer box never takes typed-elsewhere letters ────────
    page.goto(f"{origin}/p/beta/build/b1", wait_until="networkidle")
    page.get_by_test_id("steering-approve").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("steering-approve").focus()
    check("gate-approve-focused", page.evaluate(ACTIVE) == "steering-approve", active=page.evaluate(ACTIVE))
    page.keyboard.type(TEXT)
    try:
        page.wait_for_function(f"() => ({VALUE})('assist-input') === {json.dumps(TEXT)}", timeout=5000)
    except Exception:  # noqa: BLE001 — reported by the check below
        pass
    note_toast()
    gate_box = page.evaluate(VALUE, "gate-composer")
    amend = page.evaluate(VALUE, "steering-amend")
    page.screenshot(path=str(SHOTS / "type-to-composer-gate.png"))
    gate_active = page.evaluate(ACTIVE)
    check("gate-steer-boxes-stay-empty",
          page.evaluate(VALUE, "assist-input") == TEXT and gate_active == "assist-input"
          and not gate_box and not amend
          and page.get_by_test_id("steering-queued").count() == 0 and not toasts,
          dock=page.evaluate(VALUE, "assist-input"), active=gate_active, gate_composer=gate_box,
          steering_amend=amend, toasts=toasts)

    # ── composite: a focused radiogroup keeps its keys ─────────────────────────────
    page.goto(f"{origin}/theme", wait_until="networkidle")
    page.get_by_test_id("skin-picker").wait_for(state="visible", timeout=10000)
    page.get_by_test_id("skin-option-studio").focus()
    page.evaluate("() => { window.__keys = []; }")
    page.keyboard.press("x")
    page.keyboard.press("2")
    page.wait_for_timeout(400)
    keys = page.evaluate("() => window.__keys")
    # The redirect prevents the default of every key it takes; inside the composite it took none.
    check("composite-keeps-its-keys",
          page.get_by_test_id("assist-input").count() == 0
          and page.evaluate(ACTIVE) == "skin-option-studio"
          and keys == [["x", False], ["2", False]],
          dock_open=page.get_by_test_id("assist-input").count(), active=page.evaluate(ACTIVE), keys=keys)

    # ── zero: past the undo window, nothing reached the gate endpoint ──────────────
    # A queued decision POSTs only when its 10 s window closes, so the wait IS the evidence.
    page.wait_for_timeout(11000)
    note_toast()
    srv = server_posts(origin)
    check("zero-gate-posts", posts == [] and srv == [] and not toasts,
          browser_posts=posts, server_posts=srv, toasts=toasts)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
