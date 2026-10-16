"""New job → "Don't show this again — start in chat" (operator 2026-10-16, DES-CHAT-FIRST-001 C5).

The operator's path, end to end, through the real buttons:
  1. Desk → New job opens the job picker, whose footer offers the checkbox and the Settings note.
  2. Ticking it closes the picker and opens a chat, and the choice is saved in crew's settings.
  3. After a reload, Desk → New job opens a chat, not the picker.
  4. Settings → View → "Show New job" turns it back; after a reload New job opens the picker again.

Captures: e2e/shots/desk-newjob-chat-*.png. Env: FEEDBACK_PORT (default 4526).
"""
import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4526"))
SHOTS = REPO / "e2e" / "shots"
W, H = 1440, 700

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []


def wait_stored(page, want: bool) -> dict | None:
    """Poll crew's settings until studio.composer.startInChat is `want` (the save is debounced)."""
    got = None
    for _ in range(40):
        got = page.evaluate(STORED)
        if isinstance(got, dict) and got.get("startInChat") is want:
            return got
        page.wait_for_timeout(100)
    return got


STORED = "async () => ((await (await fetch('/api/v1/settings')).json()).settings || {})['studio.composer'] || null"

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # 1. the picker offers it
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-cards").wait_for(state="visible", timeout=8000)
    skip = page.get_by_test_id("launch-wizard-skip")
    text = skip.inner_text()
    page.screenshot(path=str(SHOTS / "desk-newjob-chat-offer.png"))
    check("offered", "Don’t show this again — start in chat" in text and "Settings → View" in text
          and not page.get_by_test_id("launch-wizard-skip-toggle").is_checked(), text=text)

    # 2. ticking it goes to chat and saves the choice
    page.get_by_test_id("launch-wizard-skip-toggle").click()  # the picker closes as it saves
    page.get_by_test_id("assist-input").wait_for(state="visible", timeout=8000)
    stored = wait_stored(page, True)
    page.screenshot(path=str(SHOTS / "desk-newjob-chat-ticked.png"))
    check("ticked-goes-to-chat", page.get_by_test_id("launch-wizard").count() == 0
          and isinstance(stored, dict) and stored.get("startInChat") is True, stored=stored)

    # 3. after a reload, New job is a chat
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    try:
        page.get_by_test_id("assist-input").wait_for(state="visible", timeout=8000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-newjob-chat-reload-missing.png"))
        check("reload-still-chat", False, wizard=page.get_by_test_id("launch-wizard").count(),
              assist=page.get_by_test_id("assist-input").count(), stored=page.evaluate(STORED))
    page.wait_for_timeout(300)
    check("reload-still-chat", page.get_by_test_id("launch-wizard").count() == 0)
    page.keyboard.press("Escape")

    # 4. Settings → View turns it back
    page.goto(f"{origin}/system", wait_until="networkidle")
    toggle = page.get_by_test_id("show-new-job-toggle")
    toggle.wait_for(state="visible", timeout=8000)
    check("settings-shows-off", not toggle.is_checked())
    toggle.click()
    stored = wait_stored(page, False)
    check("settings-saved-off", isinstance(stored, dict) and stored.get("startInChat") is False, stored=stored)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-new-job").click()
    page.get_by_test_id("launch-wizard-cards").wait_for(state="visible", timeout=8000)
    page.screenshot(path=str(SHOTS / "desk-newjob-chat-restored.png"))
    check("settings-restores-picker", True)

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
