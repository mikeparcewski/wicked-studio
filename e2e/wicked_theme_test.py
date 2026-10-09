#!/usr/bin/env python3
"""
wicked_theme_test.py — DES-STUDIO-REBUILD-001 S1: the wicked themes and self-hosted fonts,
in a real browser at 1440x700.

  1. DEFAULT UNCHANGED: with the fixture's default appearance, <html> carries no data-theme,
     the body's computed font is Archivo (the base --font-sans in styles/tokens.css since S18c),
     that face is actually loaded (document.fonts), and the
     computed --accent is the default accent (230/74/68).
  2. WICKED-LIGHT: on /theme, choosing "Wicked light" stamps data-theme="wicked-light",
     writes the harbor preset inline (200 / 47% / 25%), the computed --accent is #224A5E
     (rgb(34, 74, 94)), the body font is Archivo and Archivo is loaded; the debounced PUT
     carries theme "wicked-light" with the preset.
  3. THE ACCENT PICKER STILL WORKS: ArrowRight x10 on the hue wheel moves --_accent-h and
     the computed --accent, and the theme stays wicked-light.
  5. WICKED-DARK stamps data-theme="wicked-dark".
  6. 0 FONT CDN REQUESTS over the whole session, and at least one woff2 served same-origin.
  7. THE OFL LICENCES SHIP: dist/fonts/LICENSE-{Inter,Archivo,JetBrainsMono}.txt are served.

Captures: e2e/shots/wicked-light-theme.png, e2e/shots/wicked-dark-theme.png.
Env: FEEDBACK_PORT (default 4351). Prints a JSON report; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4351"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
FONT_CDN = re.compile(r"fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|jsdelivr\.net/npm/@fontsource")

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


STATE = """async () => {
  await document.fonts.ready;
  const probe = (value) => { const el = document.createElement('div');
    el.style.backgroundColor = value; document.body.appendChild(el);
    const v = getComputedStyle(el).backgroundColor; el.remove(); return v; };
  const root = document.documentElement;
  const fam = getComputedStyle(document.body).fontFamily;
  return {
    theme: root.getAttribute('data-theme'),
    h: root.style.getPropertyValue('--_accent-h'),
    s: root.style.getPropertyValue('--_accent-s'),
    l: root.style.getPropertyValue('--_accent-l'),
    accent: probe('var(--accent)'),
    defaultAccent: probe('hsl(230 74% 68%)'),
    bodyFont: fam.split(',')[0].trim().replace(/['"]/g, ''),
    interLoaded: [...document.fonts].some(f => f.family.replace(/['"]/g, '') === 'Inter' && f.status === 'loaded'),
    archivoLoaded: [...document.fonts].some(f => f.family.replace(/['"]/g, '') === 'Archivo' && f.status === 'loaded'),
  }; }"""

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
requests: list[str] = []
puts: list[dict] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
    set_fixture(origin, appearance=dict(DEFAULT_APPEARANCE))
    page = ctx.new_page()
    page.on("request", lambda r: requests.append(r.url))
    page.on("request", lambda r: puts.append(json.loads(r.post_data or "{}").get("studio.appearance") or {})
            if r.method == "PUT" and r.url.endswith("/api/v1/settings") else None)

    # 1. the default theme is unchanged
    page.goto(f"{origin}/theme", wait_until="domcontentloaded")
    page.get_by_test_id("appearance-settings").wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_function("() => document.documentElement.style.getPropertyValue('--_accent-h') !== ''", timeout=15000)
    s0 = page.evaluate(STATE)
    # S18c moved the Desk's face into styles/tokens.css (--font-sans Archivo): the default body font.
    face, face_loaded = "Archivo", s0["archivoLoaded"]
    check("default_unchanged", s0["theme"] is None and s0["bodyFont"] == face and face_loaded
          and s0["accent"] == s0["defaultAccent"], state=s0)

    # 2. wicked-light writes the harbor accent; computed --accent is #224A5E
    try:
        page.get_by_test_id("theme-wicked-light").click(timeout=10000)
    except Exception as e:  # noqa: BLE001
        fail("wicked_light_harbor", f"no Wicked light theme button on /theme: {e}")
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'wicked-light'", timeout=5000)
    s1 = page.evaluate(STATE)
    page.wait_for_timeout(700)  # the 400 ms persist debounce
    last_put = puts[-1] if puts else {}
    check("wicked_light_harbor", (s1["h"], s1["s"], s1["l"]) == ("200", "47%", "25%")
          and s1["accent"] == "rgb(34, 74, 94)" and s1["bodyFont"] == "Archivo" and s1["archivoLoaded"]
          and last_put.get("theme") == "wicked-light" and last_put.get("accent_h") == 200,
          state=s1, put=last_put)
    page.wait_for_timeout(1000)  # let colour transitions settle before the capture
    page.screenshot(path=str(SHOTS / "wicked-light-theme.png"))

    # 3. the accent picker still changes --accent under the wicked theme
    wheel = page.get_by_test_id("hue-wheel")
    wheel.focus()
    for _ in range(10):
        page.keyboard.press("ArrowRight")
    s2 = page.evaluate(STATE)
    check("accent_picker_works", s2["h"] == "210" and s2["accent"] != s1["accent"] and s2["theme"] == "wicked-light",
          state=s2)

    # 5. wicked-dark
    page.get_by_test_id("theme-wicked-dark").click()
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'wicked-dark'", timeout=5000)
    s4 = page.evaluate(STATE)
    check("wicked_dark", s4["theme"] == "wicked-dark" and s4["h"] == "210" and s4["bodyFont"] == "Archivo", state=s4)
    page.wait_for_timeout(1000)  # let colour transitions settle before the capture
    page.screenshot(path=str(SHOTS / "wicked-dark-theme.png"))

    browser.close()

# 6. 0 requests to a font CDN; the faces came from the app's own origin
cdn = [u for u in requests if FONT_CDN.search(u)]
woff2 = [u for u in requests if u.endswith(".woff2")]
check("no_font_cdn", cdn == [] and len(woff2) > 0 and all(u.startswith(origin) for u in woff2),
      cdn=cdn, woff2=[u.rsplit("/", 1)[-1] for u in woff2])

# 7. the OFL licence texts ship in the build beside the fonts (dist/fonts/LICENSE-*.txt)
import urllib.request  # noqa: E402

licences = {}
for name in ("LICENSE-Inter.txt", "LICENSE-Archivo.txt", "LICENSE-JetBrainsMono.txt"):
    try:
        with urllib.request.urlopen(f"{origin}/fonts/{name}", timeout=10) as res:
            licences[name] = "SIL Open Font License" in res.read().decode("utf8", "replace")
    except Exception:  # noqa: BLE001
        licences[name] = False
check("font_licences_shipped", all(licences.values()), licences=licences)

report["ok"] = True
print(json.dumps(report, indent=2))
