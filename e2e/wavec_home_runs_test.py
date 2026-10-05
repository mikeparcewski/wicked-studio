#!/usr/bin/env python3
"""
wavec_home_runs_test.py — Wave C, lane home-runs (brainstorm-actionable ideas 10, 11, 15), at 1440x700.

  top     Home: the header's "Just the top one" holds the highest-consequence Needs You item — the
          queue shows 1 item and says "N hidden, back when this clears"; turning it off restores
          every item (same count as before).
  reuse   /work (→ /everything, S15c): the finished user-plan run r-reuse offers "Reuse as preset" and "Draft update" beside
          Archive. Opening the save shows the consequence ABOVE the button, on screen, and writes
          nothing; saving PUTs /presets/tidy-upload with the run's 3 catalog steps (PA scope and
          deliver left out) and the row says it was saved. "Draft update" opens the outbound draft.
  freeze  the status bar's "Freeze deliveries" says what it does first; freezing PUTs the switch and
          the bar carries the audited banner (who, why). While frozen, approving r-trust-deliver's
          deliver gate is refused with crew's message; after "Unfreeze" the same approve goes through.

Under STUDIO_SKIN=desk (S15a: the desk variant, in run_journeys.py DESK) "Just the top one" sits in the
Desk's header, and the freeze is switched where the Desk keeps it — "Look underneath" › Hold deliveries
(the Desk has no status bar) — and said on the Desk as ONE row while on ("Deliveries frozen by …"),
unfrozen from that row. The refusal, the audit and the approve-after-unfreeze are the same.

Captures (e2e/shots/): wavec-<skin>-top.png, wavec-<skin>-reuse.png, wavec-<skin>-frozen.png.
Env: FEEDBACK_PORT (default 4491), STUDIO_SKIN. JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4491"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SKIN = STUDIO_SKIN

report: dict = {"ok": False, "skin": SKIN, "steps": {}}


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def fixture_get(origin: str, leaf: str) -> dict:
    with urllib.request.urlopen(f"{origin}/__fixture/{leaf}", timeout=10) as res:
        return json.loads(res.read())


def gate_posts(origin: str, rid: str) -> list:
    return [p for p in fixture_get(origin, "gate-posts")["posts"] if p["runId"] == rid]


def reset(origin: str) -> None:
    set_fixture(origin, **{"home_runs": True, "trust_rules": True, "reset_home_runs": True, "reset_orders": True,
                           "appearance": {**DEFAULT_APPEARANCE, "skin": SKIN}})


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def text(testid: str) -> str:
        return (page.get_by_test_id(testid).first.text_content() or "").strip()

    def section_top() -> None:
        reset(origin)
        page.goto(f"{origin}/", wait_until="networkidle")
        queue = page.get_by_test_id("needs-you-queue")
        queue.wait_for(state="visible", timeout=15000)
        page.wait_for_function("""() => Number(document.querySelector('[data-testid="needs-you-queue"]')
            ?.getAttribute('data-count')) >= 3""", timeout=15000)
        before = int(queue.get_attribute("data-count") or "0")
        rows_before = page.get_by_test_id("need-row").count()
        toggle = page.get_by_test_id("home-focus-toggle")
        check("toggle-in-header", toggle.is_visible() and toggle.get_attribute("aria-pressed") == "false"
              and page.evaluate("""() => !!document.querySelector('header [data-testid="home-focus-toggle"]')"""),
              before=before)
        toggle.click()
        page.wait_for_function("""() => document.querySelector('[data-testid="needs-you-queue"]')
            ?.getAttribute('data-focus-lock') === 'on'""", timeout=8000)
        shown = page.get_by_test_id("need-row").count()
        note = text("need-focus-note")
        check("toggle-shows-one", shown == 1 and queue.get_attribute("data-count") == "1"
              and note.startswith(f"{before - 1} hidden, back when this clears"), shown=shown, note=note, before=before)
        page.screenshot(path=str(SHOTS / f"wavec-{SKIN}-top.png"))
        toggle.click()
        page.wait_for_function("""() => document.querySelector('[data-testid="needs-you-queue"]')
            ?.getAttribute('data-focus-lock') === 'off'""", timeout=8000)
        check("toggle-off-restores", int(queue.get_attribute("data-count") or "0") == before
              and page.get_by_test_id("need-row").count() == rows_before
              and page.get_by_test_id("need-focus-note").count() == 0)

    def section_reuse() -> None:
        reset(origin)
        page.goto(f"{origin}/work", wait_until="networkidle")
        row = page.locator('[data-testid="run-finished-row"][data-run-id="r-reuse"]')
        row.wait_for(state="visible", timeout=15000)
        check("next-use-moves", row.get_by_test_id("run-reuse-preset").count() == 1
              and row.get_by_test_id("run-draft-update-row").count() == 1
              and row.get_by_test_id("run-archive-row").count() == 1)
        row.get_by_test_id("run-reuse-preset").click()
        panel = row.get_by_test_id("run-reuse-panel")
        panel.wait_for(state="visible", timeout=8000)
        # S15c: the row lives on "See everything › Sessions" under the page's header and lenses, so the
        # panel is brought into view before its geometry (consequence above the button) is read.
        panel.scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        consequence = (panel.get_by_test_id("run-reuse-consequence").text_content() or "").strip()
        check("consequence-first", consequence.startswith("Saves this run's 3 steps (understand → build → review) as the preset")
              and page.evaluate("""() => { const p = document.querySelector('[data-run-id="r-reuse"] [data-testid="run-reuse-panel"]');
                  const c = p.querySelector('[data-testid="run-reuse-consequence"]').getBoundingClientRect();
                  const b = p.querySelector('[data-testid="run-reuse-save"]').getBoundingClientRect();
                  return c.bottom <= b.top && b.top >= 0 && b.bottom <= window.innerHeight; }""")
              and fixture_get(origin, "preset-puts")["puts"] == [], consequence=consequence)
        name = panel.get_by_test_id("run-reuse-name")
        name.fill("tidy-upload")
        page.screenshot(path=str(SHOTS / f"wavec-{SKIN}-reuse.png"))
        panel.get_by_test_id("run-reuse-save").click()
        deadline = time.monotonic() + 10
        while not fixture_get(origin, "preset-puts")["puts"] and time.monotonic() < deadline:
            page.wait_for_timeout(200)
        puts = fixture_get(origin, "preset-puts")["puts"]
        body = puts[0]["body"] if puts else {}
        check("reuse-puts-the-preset", len(puts) == 1 and puts[0]["name"] == "tidy-upload"
              and body == {"steps": [{"catalog": "understand", "id": "understand"}, {"catalog": "build", "id": "build"},
                                     {"catalog": "review", "id": "review"}]}, puts=puts)
        saved = row.get_by_test_id("run-reuse-saved")
        saved.wait_for(state="visible", timeout=8000)
        check("saved-in-place", "Saved as preset “tidy-upload”" in (saved.text_content() or ""))
        row.get_by_test_id("run-draft-update-row").click()
        dialog = page.get_by_role("dialog")
        dialog.wait_for(state="visible", timeout=8000)
        check("draft-update-opens", "Draft update" in (dialog.text_content() or "")
              and page.get_by_test_id("outbound-draft").count() == 1)
        page.keyboard.press("Escape")

    def approve_deliver() -> None:
        page.goto(f"{origin}/runs/r-trust-deliver", wait_until="networkidle")
        move = page.get_by_test_id("gate-recommended")
        move.wait_for(state="visible", timeout=15000)
        before = (move.text_content() or "").strip()
        move.click()
        page.wait_for_timeout(400)
        # With a diff to read, the first press opens it and relabels the move "Deliver"; the second delivers.
        if not before.startswith("Deliver") and page.get_by_test_id("undo-toast").count() == 0:
            move.click()

    def desk_freeze_open() -> None:
        """The Desk keeps the switch under "Look underneath" › Hold deliveries."""
        page.get_by_test_id("desk-sheet-open").click()
        page.locator('[data-testid="sheet-tab"][data-tab="hold"]').click()
        page.get_by_test_id("sheet-hold").wait_for(state="visible", timeout=8000)

    def section_freeze() -> None:
        reset(origin)
        page.goto(f"{origin}/", wait_until="networkidle")
        if SKIN == "desk":
            desk_freeze()
            return
        open_btn = page.get_by_test_id("delivery-freeze-open")
        open_btn.wait_for(state="visible", timeout=15000)
        check("switch-in-status-bar", (open_btn.text_content() or "").strip() == "Freeze deliveries"
              and page.evaluate("""() => !!document.querySelector('[data-testid="runs-bottom-bar"] [data-testid="delivery-freeze-open"]')"""))
        open_btn.click()
        consequence = text("delivery-freeze-consequence")
        check("freeze-consequence-first", "no run pushes a branch or opens a PR until you unfreeze" in consequence,
              consequence=consequence)
        page.get_by_test_id("delivery-freeze-reason").fill("incident 42")
        page.get_by_test_id("delivery-freeze-confirm-btn").click()
        banner = page.get_by_test_id("delivery-freeze-banner")
        banner.wait_for(state="visible", timeout=8000)
        banner_text = (banner.text_content() or "").strip()
        check("banner-audited", banner_text.startswith("❄ Deliveries frozen by local") and "incident 42" in banner_text
              and page.get_by_test_id("runs-bottom-bar").get_attribute("data-deliveries-frozen") == "true",
              banner=banner_text)
        page.screenshot(path=str(SHOTS / f"wavec-{SKIN}-frozen.png"))

        approve_deliver()
        deadline = time.monotonic() + 20
        while not gate_posts(origin, "r-trust-deliver") and time.monotonic() < deadline:
            page.wait_for_timeout(250)
        posts = gate_posts(origin, "r-trust-deliver")
        check("approve-sent", len(posts) == 1 and posts[0]["body"].get("approve") is True, posts=posts)
        page.wait_for_function("""() => [...document.querySelectorAll('[data-testid="undo-result"], [data-testid="steering-error"]')]
            .some(e => e.textContent.includes('Deliveries are frozen'))""", timeout=10000)
        msg = page.evaluate("""() => [...document.querySelectorAll('[data-testid="undo-result"], [data-testid="steering-error"]')]
            .map(e => e.textContent).find(t => t.includes('Deliveries are frozen'))""")
        check("frozen-refusal-is-clear", "unfreeze deliveries, then approve again" in msg
              and "incident 42" in msg and page.get_by_test_id("gate-recommended").count() == 1, message=msg)
        page.wait_for_timeout(800)
        report["steps"]["frozen-refusal-is-clear"]["toasts_after"] = page.get_by_test_id("undo-toast").count()
        report["steps"]["frozen-refusal-is-clear"]["gate_error"] = (page.get_by_test_id("steering-error").first.text_content()
                                                                    if page.get_by_test_id("steering-error").count() else None)
        page.screenshot(path=str(SHOTS / f"wavec-{SKIN}-refused.png"))

        page.get_by_test_id("delivery-freeze-open").click()
        check("unfreeze-consequence-first", "Deliver gates can be approved again" in text("delivery-freeze-consequence"))
        page.get_by_test_id("delivery-freeze-confirm-btn").click()
        page.wait_for_function("""() => !document.querySelector('[data-testid="delivery-freeze-banner"]')""", timeout=8000)
        check("unfrozen", (page.get_by_test_id("delivery-freeze-open").text_content() or "").strip() == "Freeze deliveries")

        approve_deliver()
        deadline = time.monotonic() + 20
        while len(gate_posts(origin, "r-trust-deliver")) < 2 and time.monotonic() < deadline:
            page.wait_for_timeout(250)
        posts = gate_posts(origin, "r-trust-deliver")
        check("approve-goes-through-after-unfreeze", len(posts) == 2 and posts[1]["body"].get("approve") is True,
              posts=len(posts))
        page.wait_for_function("""() => [...document.querySelectorAll('[data-testid="undo-result"]')]
            .some(e => e.getAttribute('data-kind') === 'sent')""", timeout=10000)

    def desk_freeze() -> None:
        page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
        desk_freeze_open()
        open_btn = page.get_by_test_id("sheet-hold").get_by_test_id("delivery-freeze-open")
        check("switch-under-the-desk", (open_btn.text_content() or "").strip() == "Freeze deliveries")
        open_btn.click()
        consequence = text("delivery-freeze-consequence")
        check("freeze-consequence-first", "no run pushes a branch or opens a PR until you unfreeze" in consequence,
              consequence=consequence)
        page.get_by_test_id("delivery-freeze-reason").fill("incident 42")
        page.get_by_test_id("delivery-freeze-confirm-btn").click()
        page.keyboard.press("Escape")  # close the sheet: the Desk says it
        row = page.locator('[data-testid="desk-state"][data-state="frozen"]')
        row.wait_for(state="visible", timeout=8000)
        line = (row.get_by_test_id("desk-state-line").text_content() or "").strip()
        check("banner-audited", line.startswith("Deliveries frozen by local") and "incident 42" in line, banner=line)
        page.screenshot(path=str(SHOTS / f"wavec-{SKIN}-frozen.png"))

        approve_deliver()
        deadline = time.monotonic() + 20
        while not gate_posts(origin, "r-trust-deliver") and time.monotonic() < deadline:
            page.wait_for_timeout(250)
        posts = gate_posts(origin, "r-trust-deliver")
        check("approve-sent", len(posts) == 1 and posts[0]["body"].get("approve") is True, posts=posts)
        page.wait_for_function("""() => [...document.querySelectorAll('[data-testid="undo-result"], [data-testid="steering-error"]')]
            .some(e => e.textContent.includes('Deliveries are frozen'))""", timeout=10000)
        msg = page.evaluate("""() => [...document.querySelectorAll('[data-testid="undo-result"], [data-testid="steering-error"]')]
            .map(e => e.textContent).find(t => t.includes('Deliveries are frozen'))""")
        check("frozen-refusal-is-clear", "unfreeze deliveries, then approve again" in msg
              and "incident 42" in msg and page.get_by_test_id("gate-recommended").count() == 1, message=msg)
        page.screenshot(path=str(SHOTS / f"wavec-{SKIN}-refused.png"))

        # Unfreeze from the Desk's own row.
        page.goto(f"{origin}/", wait_until="networkidle")
        row = page.locator('[data-testid="desk-state"][data-state="frozen"]')
        row.wait_for(state="visible", timeout=10000)
        row.get_by_test_id("delivery-freeze-open").click()
        check("unfreeze-consequence-first", "Deliver gates can be approved again" in text("delivery-freeze-consequence"))
        page.get_by_test_id("delivery-freeze-confirm-btn").click()
        page.wait_for_function("""() => !document.querySelector('[data-testid="desk-state"][data-state="frozen"]')""", timeout=8000)
        check("unfrozen", True)

        approve_deliver()
        deadline = time.monotonic() + 20
        while len(gate_posts(origin, "r-trust-deliver")) < 2 and time.monotonic() < deadline:
            page.wait_for_timeout(250)
        posts = gate_posts(origin, "r-trust-deliver")
        check("approve-goes-through-after-unfreeze", len(posts) == 2 and posts[1]["body"].get("approve") is True,
              posts=len(posts))
        page.wait_for_function("""() => [...document.querySelectorAll('[data-testid="undo-result"]')]
            .some(e => e.getAttribute('data-kind') === 'sent')""", timeout=10000)

    for section in (section_top, section_reuse, section_freeze):
        try:
            section()
        except SectionFailed:
            pass
        except Exception as exc:  # noqa: BLE001 — every failure lands in the report
            report["steps"][f"{section.__name__}-error"] = {"ok": False, "error": repr(exc)[:500]}
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
