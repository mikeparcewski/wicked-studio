#!/usr/bin/env python3
"""
desk_e2e7721_r3_test.py — the studio defect the third :7721 E2E found (crew 0.14.1 / studio 0.10.1), walked on
the operator's own path at 1440x700.

studio#840: helpers turned off in the New job wizard stayed off for every later Desk Ask (both used one saved
choice), and the Ask drawer then refused with "turn one on in the helpers row" — a row it did not have.
  1. Desk → New job → a job → its Helpers step: turn every helper but one off, close the wizard.
  2. Desk → Chat (the Ask drawer): it shows a helpers row, every helper on; Send opens the chat with all of
     them (POST /chats `clis`), not the wizard's one.
  3. In the drawer's row, turn every helper off: the row says so, Send refuses by pointing at the row that is
     on screen, and no chat opens. Turn one back on: Send opens the chat with that one.
  4. The wizard kept its own choice: reopening its Helpers step shows the one helper still on.
  5. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-e2e7721r3-*.png. Env: FEEDBACK_PORT (default 4486).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4486"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
opens: list[dict] = []

PILLS = """(sel) => [...document.querySelectorAll(sel)].map((b) => [b.dataset.key, b.getAttribute('aria-pressed')])"""
HSCROLL = "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"


def note_open(req) -> None:
    if req.method == "POST" and req.url.endswith("/api/v1/chats"):
        try:
            opens.append(json.loads(req.post_data or "{}"))
        except ValueError:
            opens.append({})


def wizard_helpers(page, tag: str):
    """Desk → New job → the first ordinary job → its Helpers step; returns the helper pills."""
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-new-job").click()
    page.get_by_test_id("launch-wizard").wait_for(state="visible", timeout=10000)
    if page.get_by_test_id("launch-wizard-cards").count() > 0:
        page.get_by_test_id("launch-wizard-workflow-bug").click()
    intent = page.get_by_test_id("launch-wizard-intent")
    intent.wait_for(state="visible", timeout=8000)
    if intent.input_value() == "":
        intent.fill("fix the greeting so it trims its input")
    for _ in range(4):
        if page.locator('[data-testid="launch-wizard-seat"]').count() > 0:
            break
        repo = page.get_by_test_id("launch-wizard-repo")
        if repo.count() > 0 and repo.input_value() == "":
            value = page.evaluate("""() => [...document.querySelectorAll('[data-testid="launch-wizard-repo"] option')]
              .map((o) => o.value).find((v) => v) || ''""")
            if value:
                repo.select_option(value)
        page.get_by_test_id("launch-wizard-next").click()
        page.wait_for_timeout(300)
    if page.locator('[data-testid="launch-wizard-seat"]').count() == 0:
        page.screenshot(path=str(SHOTS / f"desk-e2e7721r3-{tag}-missing.png"))
        fail(f"{tag}-helpers-step", page.evaluate("() => document.body.innerText.slice(0, 1200)"))
    return page.evaluate(PILLS, '[data-testid="launch-wizard-seat"]')


def open_ask(page):
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-chat").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("desk-rail-chat").click()
    page.get_by_test_id("assist-input").wait_for(state="visible", timeout=10000)
    try:
        page.get_by_test_id("ask-helpers").wait_for(state="visible", timeout=8000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721r3-ask-no-row.png"))
        fail("ask-has-a-helpers-row", page.evaluate("() => document.body.innerText.slice(0, 1200)"))


def ask_pill(page, key: str):
    return page.locator(f'[data-testid="ask-helper"][data-key="{key}"]')


with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, sessions=True, ask_path=True, ask_one_seat=False, extra_frames=[], repo=True)
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", note_open)
    # One ordinary job in the catalog (the E2E's Bug), as e2e/desk_newjob_cards_test.py serves it.
    page.route("**/api/v1/workflows", lambda r: r.fulfill(status=200, json={"workflows": [
        {"id": "bug", "is_system": False, "phases": [{"id": "build", "executes_code": True}]}]}))
    page.route("**/api/v1/presets*", lambda r: r.fulfill(status=200, json={"presets": []}))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # ── 1. the wizard: every helper but one off, then close without launching ─────────
    pills = wizard_helpers(page, "1-wizard")
    keys = [k for k, _ in pills]
    check("wizard-has-helpers", len(keys) >= 2, pills=pills)
    keep = keys[0]
    for k in keys[1:]:
        btn = page.locator(f'[data-testid="launch-wizard-seat"][data-key="{k}"]')
        if btn.get_attribute("aria-pressed") == "true":
            btn.click()
    after = page.evaluate(PILLS, '[data-testid="launch-wizard-seat"]')
    page.screenshot(path=str(SHOTS / "desk-e2e7721r3-1-wizard-one-helper.png"))
    check("wizard-one-on", [k for k, on in after if on == "true"] == [keep], pills=after)
    page.get_by_test_id("launch-wizard-close").click()
    page.get_by_test_id("launch-wizard").wait_for(state="hidden", timeout=5000)

    # ── 2. the Ask drawer: its own row, every helper on, and the send uses them all ────
    open_ask(page)
    row = page.evaluate(PILLS, '[data-testid="ask-helper"]')
    page.screenshot(path=str(SHOTS / "desk-e2e7721r3-2-ask-row.png"))
    check("ask-row-all-on", len(row) >= 1 and all(on == "true" for _, on in row), row=row)
    ask_keys = [k for k, _ in row]
    page.get_by_test_id("assist-input").fill("what does greet() do with spaces?")
    page.get_by_test_id("assist-send").click()
    for _ in range(40):
        if opens:
            break
        page.wait_for_timeout(250)
    check("ask-opens-with-every-helper", len(opens) == 1 and opens[0].get("clis") == ask_keys,
          opens=opens, row=ask_keys)

    # ── 3. every Ask helper off: the refusal points at the row on screen; one back on sends ──
    page.evaluate("() => { try { sessionStorage.clear(); } catch (e) {} }")
    open_ask(page)
    for k in ask_keys:
        ask_pill(page, k).click()
    page.get_by_test_id("ask-helpers-none").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("assist-input").fill("and with tabs?")
    page.get_by_test_id("assist-send").click()
    page.wait_for_timeout(800)
    notes = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"assist-note\"]')].map((n) => n.innerText)")
    page.screenshot(path=str(SHOTS / "desk-e2e7721r3-3-ask-all-off.png"))
    check("refusal-points-at-the-row", any("turn one on in the helpers row" in n for n in notes)
          and page.get_by_test_id("ask-helpers").is_visible(), notes=notes)
    check("refused-send-opens-nothing", len(opens) == 1, opens=opens)
    ask_pill(page, ask_keys[-1]).click()
    page.get_by_test_id("assist-input").fill("and with tabs?")
    page.get_by_test_id("assist-send").click()
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOTS / "desk-e2e7721r3-3-ask-one-on.png"))
    check("one-back-on-sends", len(opens) == 2 and opens[1].get("clis") == [ask_keys[-1]], opens=opens)
    # Put the Ask choice back for any later journey sharing this browser profile.
    page.evaluate("() => { try { localStorage.removeItem('wicked_composer_dropped_seats'); } catch (e) {} }")

    # ── 4. the wizard kept its own choice ─────────────────────────────────────────────
    page.keyboard.press("Escape")
    again = wizard_helpers(page, "4-wizard-again")
    page.screenshot(path=str(SHOTS / "desk-e2e7721r3-4-wizard-kept.png"))
    check("wizard-kept-its-choice", [k for k, on in again if on == "true"] == [keep], pills=again)
    check("no-hscroll", not page.evaluate(HSCROLL))
    page.get_by_test_id("launch-wizard-close").click()
    ctx.close()
    browser.close()

check("no-page-errors", errors == [], errors=errors)
report["ok"] = True
print(json.dumps(report, indent=2))
