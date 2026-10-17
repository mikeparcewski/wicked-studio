"""Learn from a brand with a file you choose (operator 2026-10-17: "When doing an image in 'theme' you need the
ability to upload, it's impossible to guess what paths it would take but it could be an upload or select file").

The operator's path, through the real controls, on /theme at 1440x700 and on a 390px phone:
  1. Learn from a brand › "image file": a drop zone with "Upload or choose a file" — no path box to guess.
  2. Choose a PNG: its name, size and a thumbnail show; a wrong kind of file says what to choose instead.
  3. Learn: the PNG's bytes go to the document engine (PUT …/d/brand-learn/api/theme/source, raw image/png,
     its first bytes a PNG's) and the learn names the path the engine answered — the operator typed nothing.
  4. The learned palette previews on the whole page (the accent var changes); Apply saves it.
  5. An engine from before uploads (404): the page says so and opens "Use a file path instead".
Light and dark; 0 page errors.

Captures: e2e/shots/desk-brand-upload-*.png. Env: FEEDBACK_PORT (default 4605).
"""
import json
import os
import struct
import sys
import tempfile
import time
import urllib.request
import zlib

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4605"))
SHOTS = REPO / "e2e" / "shots"
PROJECT = "q3-review-deck"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def png(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    """A real PNG (a flat brand swatch), so the browser can draw its thumbnail."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)  # noqa: E731
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def fixture_get(origin: str, path: str):
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, learn_delay_s=1.0, reset_learn=True)

tmp = tempfile.mkdtemp(prefix="wk-brand-")
BRAND = os.path.join(tmp, "acme-brand.png")
with open(BRAND, "wb") as f:
    f.write(png(64, 40, (10, 42, 94)))
NOTE = os.path.join(tmp, "notes.txt")
with open(NOTE, "w") as f:
    f.write("not an image")

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
events: list[dict] = []


def theme(page, t: str) -> None:
    page.evaluate("(t) => t === 'dark' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t)", t)
    page.wait_for_timeout(150)


def accent_h(page) -> str:
    return page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--_accent-h').trim()")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: events.append(json.loads(r.post_data)) if r.method == "POST" and r.url.endswith("/interactive/api/events") and r.post_data else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}/theme", wait_until="networkidle")
    section = page.get_by_test_id("brand-learn")
    section.wait_for(state="visible", timeout=15000)

    # 1. image file → a drop zone, no path box.
    page.get_by_test_id("learn-source-image").check()
    zone = page.get_by_test_id("learn-file")
    zone.wait_for(state="visible", timeout=5000)
    section.scroll_into_view_if_needed()
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        section.screenshot(path=str(SHOTS / f"desk-brand-upload-empty-{t}.png"))
    check("image-asks-for-a-file", page.get_by_test_id("learn-input").count() == 0
          and "Upload or choose a file" in page.get_by_test_id("learn-file-choose").inner_text()
          and page.get_by_test_id("learn-submit").is_disabled())

    # 2. A wrong file says what to choose; the PNG shows its name and thumbnail.
    page.get_by_test_id("learn-file-input").set_input_files(NOTE)
    problem = page.get_by_test_id("learn-file-problem").inner_text()
    check("wrong-file-says-what-to-choose", "PNG, JPEG, WebP or GIF" in problem and page.get_by_test_id("learn-submit").is_disabled(), problem=problem)
    with page.expect_file_chooser() as fc:
        page.get_by_test_id("learn-file-choose").click()
    fc.value.set_files(BRAND)
    page.get_by_test_id("learn-file-preview").wait_for(state="visible", timeout=5000)
    page.wait_for_function("() => { const i = document.querySelector('[data-testid=\"learn-file-preview\"]'); return !!i && i.naturalWidth > 0; }", timeout=5000)
    chosen = page.get_by_test_id("learn-file-name").inner_text()
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        section.screenshot(path=str(SHOTS / f"desk-brand-upload-chosen-{t}.png"))
    check("png-chosen", chosen == "acme-brand.png" and not page.get_by_test_id("learn-submit").is_disabled(), chosen=chosen)

    # 3. Learn: the bytes go to the engine; the learn names the path it answered.
    before = accent_h(page)
    page.get_by_test_id("learn-submit").click()
    page.get_by_test_id("learn-preview-chip").wait_for(timeout=30000)
    puts = fixture_get(origin, "/__fixture/theme-sources")["puts"]
    learn = [e for e in events if e.get("event_type") == "wicked.interactive.theme.requested"]
    check("bytes-go-to-the-engine", len(puts) == 1 and puts[0]["type"] == "image/png" and puts[0]["magic"] == "89504e470d0a1a0a"
          and puts[0]["doc"] == "brand-learn" and puts[0]["bytes"] == os.path.getsize(BRAND), puts=puts)
    check("learn-names-the-engines-path", len(learn) == 1 and learn[0]["payload"].get("path") == "/docs/brand-learn/theme/source_1.png"
          and "url" not in learn[0]["payload"], learn=learn)

    # 4. Preview, then Apply.
    preview = accent_h(page)
    for t in ("wicked-light", "wicked-dark"):
        theme(page, t)
        section.screenshot(path=str(SHOTS / f"desk-brand-upload-preview-{t}.png"))
    check("preview-is-real", before != preview and preview == "217", before=before, preview=preview)
    page.get_by_test_id("learn-apply").click()
    page.wait_for_timeout(1500)
    stored = fixture_get(origin, "/api/v1/settings")["settings"]["studio.appearance"]
    check("apply-saves", stored["accent_h"] == 217, stored=stored)
    ctx.close()

    # 5. An engine before uploads: said, and the path box opens.
    set_fixture(origin, theme_source_absent=True, reset_learn=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{origin}/theme", wait_until="networkidle")
    page.get_by_test_id("brand-learn").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("learn-source-image").check()
    page.get_by_test_id("learn-file-input").set_input_files(BRAND)
    page.get_by_test_id("learn-submit").click()
    page.get_by_test_id("learn-input").wait_for(state="visible", timeout=10000)
    status = page.get_by_test_id("learn-status").inner_text()
    page.get_by_test_id("brand-learn").screenshot(path=str(SHOTS / "desk-brand-upload-older-engine.png"))
    check("older-engine-falls-back", "can’t take a file yet" in status and page.get_by_test_id("learn-input").is_visible() and page.get_by_test_id("learn-file").count() == 0, status=status)
    set_fixture(origin, theme_source_absent=False)
    ctx.close()

    # Phone: the drop zone fits.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{origin}/theme", wait_until="networkidle")
    page.get_by_test_id("brand-learn").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("learn-source-image").check()
    page.get_by_test_id("learn-file-input").set_input_files(BRAND)
    page.get_by_test_id("learn-file-preview").wait_for(state="visible", timeout=5000)
    page.get_by_test_id("brand-learn").scroll_into_view_if_needed()
    over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    page.get_by_test_id("brand-learn").screenshot(path=str(SHOTS / "desk-brand-upload-phone.png"))
    check("phone-fits", over <= 0, over=over)
    ctx.close()

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
