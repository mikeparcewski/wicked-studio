#!/usr/bin/env python3
"""
vision_slice8_test.py — the DES-VISION-001 slice-8 gate: brand learning (§4)
works end-to-end through the EXISTING interactive proxy (§6.3 slice 8;
EC12, EC15, EC16).

What slice 8 ships and this rig proves, in one browser session against the
shared frozen-NOW0 W2 fixture (whose bridge surface now speaks the theme-learn
loop — POST /api/theme/learn with the server-side SSRF guard, GET /api/themes
ripening `learned_at`, GET /api/themes/<id> serving the ThemeDetail):

  1. THE PROXY IS THE ONLY WIRE (§4.4 / the slice DOM AC): clicking Learn with
     a valid URL fires EXACTLY ONE request to
     /api/v1/projects/:id/interactive/api/theme/learn and ZERO requests to the
     brand host itself (page.on('request') filter — the SPA never fetches the
     source);
  2. THE SSRF GUARD REFUSES THE METADATA ADDRESS server-side: learning
     http://169.254.169.254/ is a bridge 400, the status shows the refusal
     VERBATIM, and no outbound request touches 169.254.169.254;
  3. THE BRIDGE MESSAGE IS VERBATIM (§4.3 step 3): the queued status is the
     bridge's own `message`, never a paraphrase;
  4. THE POLL FINDS THE THEME (§4.3 step 4): listThemes every 3s until
     `learned_at` is set, then getTheme → the §4.5 mapper. The deep-navy brand
     (#0a2a5e) forces TWO disclosed adjustments (lightness-clamp 20→42, then
     contrast-floor 42→59 — pinned in tests/brandMapper.test.ts), landing the
     accent at (217°, 81%, 59%);
  5. PREVIEW IS THE PAGE, NOT A PERSIST (§3.4): the mapped primitives land as
     inline overrides on <html> (the slice-7 machinery), the §3.2 preview
     strip wears them (EC15, computed-vs-probe), the adjustments are disclosed
     in [data-testid="mapper-adjustments"], and NO settings PUT fires until
     Apply;
  6. APPLY PERSISTS (§4.5): one debounced PUT carrying the mapped accent AND
     the RESOLVED same-origin logo URL (bridge-relative no more — the logo
     must survive the bridge);
  7. THE BOARD WEARS THE BRAND (EC12/EC16): a fresh page load applies the
     stored brand accent from startup, the chrome slot shows the brand logo
     (contain-fit, the default mark absent), and the accent stays distinct
     from the fixed status trio — probed computed-vs-computed, no hex here.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-8-brand-learn-running.png  Settings mid-learn: source row filled, the
                                    bridge's queued message visible verbatim.
  vision-8-brand-learn-applied.png  The W2 board + chrome wearing the learned
                                    brand: navy accent, brand logo in the slot,
                                    status colors untouched.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: VISION_PORT (default 4348),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NARRATION,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4348"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"
SHOT_RUNNING = VSHOTS / "vision-8-brand-learn-running.png"
SHOT_APPLIED = VSHOTS / "vision-8-brand-learn-applied.png"

BRAND_URL = "https://acme.example/brand"
SSRF_URL = "http://169.254.169.254/"
# The §4.5 mapping of the fixture's #0a2a5e brand — pinned by the unit suite.
MAPPED = {"h": "217", "s": "81%", "l": "59%"}
# §4.5: the FULLY RESOLVED URL is what persists (apiBase() is origin-absolute
# in the same-origin build, so the stored logo survives the bridge going away).
RESOLVED_LOGO = f"{ORIGIN}/api/v1/projects/notes/interactive/api/brand/logo.svg"

FREEZE_MOTION = (
    "*, *::before, *::after { animation: none !important; transition: none !important; }"
)

# The token probe (the rig-set's technique): computed color of `var(<name>)` on
# a scratch element — keeps every hex value OUT of this rig.
PROBES = """() => {
  const probe = (name, prop) => { const el = document.createElement('div');
    el.style[prop] = `var(${name})`;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop === 'background' ? 'backgroundColor' : prop];
    el.remove(); return v; };
  return {
    accent:        probe('--accent', 'background'),
    statusGate:    probe('--status-gate', 'color'),
    statusFail:    probe('--status-fail', 'color'),
    statusRun:     probe('--status-run', 'color'),
  }; }"""

INLINE = """() => ({
  h: document.documentElement.style.getPropertyValue('--_accent-h'),
  s: document.documentElement.style.getPropertyValue('--_accent-s'),
  l: document.documentElement.style.getPropertyValue('--_accent-l'),
  logo: document.documentElement.style.getPropertyValue('--logo-url'),
})"""

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def host_of(url: str) -> str:
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(VISION_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

EXPECTED_ORDER = ["q3-review-deck", "api-migration", "auth-refactor", "upload-endpoint"]
console_errors: list[str] = []
requests_log: list[str] = []  # every URL the page requested, in order


def on_console(m) -> None:
    if m.type != "error":
        return
    # The SSRF probe's 400 is BY DESIGN (scene A step 2) — the refusal itself
    # is the assertion. Everything else stays a failure.
    if "400" in m.text and "Failed to load resource" in m.text:
        return
    console_errors.append(m.text)


def is_learn_response(res) -> bool:
    return "/interactive/api/theme/learn" in res.url and res.request.method == "POST"


def is_settings_put(r) -> bool:
    return r.method == "PUT" and r.url.endswith("/api/v1/settings")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)

    # ══ Scene A: /system — SSRF refusal, then the full §4.1 loop to Apply ══════
    set_fixture(ORIGIN, appearance=None, reset_learn=True, learn_delay_s=4.0)
    page = ctx.new_page()
    page.on("console", on_console)
    page.on("request", lambda r: requests_log.append(f"{r.method} {r.url}"))
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/theme", wait_until="domcontentloaded")
    page.locator('[data-testid="brand-learn"]').wait_for(timeout=30000)
    # Pin the proxy project this rig asserts against: the form DEFAULTS to the
    # first root-bound project, and the W2 fixture now has more than one
    # (q3-review-deck gained a root for the slice-D dashboard tiles), so the
    # rig picks `notes` explicitly — same journey, deterministic wire.
    page.locator('[data-testid="learn-project"]').select_option("notes")
    page.add_style_tag(content=HIDE_GATE_TOASTS + "\n" + FREEZE_MOTION)
    try:
        page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=20000)
    except Exception:
        pass

    # AC 2 — the SSRF guard: the metadata address is refused SERVER-SIDE.
    page.locator('[data-testid="learn-input"]').fill(SSRF_URL)
    mark = len(requests_log)
    with page.expect_response(is_learn_response, timeout=8000) as ssrf_res:
        page.locator('[data-testid="learn-submit"]').click()
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="learn-status"]')?.textContent ?? '')
                 .includes('SSRF guard')""", timeout=8000)
    ssrf_status = page.locator('[data-testid="learn-status"]').text_content() or ""
    ssrf_window = requests_log[mark:]
    ssrf_checks = {
        "bridge_refused_400": ssrf_res.value.status == 400,
        "status_carries_refusal_verbatim":
            "refusing to fetch 169.254.169.254: loopback, private and link-local "
            "addresses are blocked (SSRF guard)" in ssrf_status,
        "no_outbound_to_metadata_address":
            all(host_of(u.split(" ", 1)[1]) != "169.254.169.254" for u in ssrf_window),
        "exactly_one_learn_post": sum(1 for u in ssrf_window if "/api/theme/learn" in u) == 1,
        "no_apply_offered": page.locator('[data-testid="learn-apply"]').count() == 0,
    }
    report["steps"]["ssrf_guard"] = {"ok": all(ssrf_checks.values()), **ssrf_checks,
                                     "status_text": ssrf_status}

    # AC 1+3 — the real learn: one proxy POST, zero to the brand host, message verbatim.
    page.locator('[data-testid="learn-input"]').fill(BRAND_URL)
    mark = len(requests_log)
    with page.expect_response(is_learn_response, timeout=8000) as learn_res:
        page.locator('[data-testid="learn-submit"]').click()
    learn_body = learn_res.value.json()
    page.wait_for_function(
        """msg => (document.querySelector('[data-testid="learn-status"]')?.textContent ?? '') === msg""",
        arg=learn_body.get("message"), timeout=8000)
    learn_window = requests_log[mark:]
    learn_checks = {
        "learn_posted_through_notes_proxy":
            any("/api/v1/projects/notes/interactive/api/theme/learn" in u for u in learn_window),
        "exactly_one_learn_post": sum(1 for u in learn_window if "/api/theme/learn" in u) == 1,
        "zero_requests_to_brand_host":
            all(host_of(u.split(" ", 1)[1]) != "acme.example" for u in requests_log),
        "status_is_bridge_message_verbatim": True,  # the wait above IS the assertion
        "queued_shape": learn_body.get("status") == "queued" and bool(learn_body.get("theme_id")),
    }
    report["steps"]["learn_submit"] = {"ok": all(learn_checks.values()), **learn_checks,
                                       "bridge_message": learn_body.get("message")}

    # The named screenshot: the learn in progress, status verbatim on screen.
    page.screenshot(path=str(SHOT_RUNNING))

    # AC 4+5 — the poll lands the theme; the mapper previews WITHOUT persisting.
    puts_before_apply = sum(1 for u in requests_log if u.startswith("PUT ") and u.endswith("/api/v1/settings"))
    try:
        page.wait_for_function(
            """() => (document.querySelector('[data-testid="learn-status"]')?.textContent ?? '')
                     === 'Ready — preview below'""", timeout=25000)
    except Exception:
        fail("poll_to_ready",
             f"learn never became ready; status now: "
             f"{page.locator('[data-testid=\"learn-status\"]').text_content()}")
    inline_preview = page.evaluate(INLINE)
    probes_a = page.evaluate(PROBES)
    strip_bg = page.evaluate(
        """() => getComputedStyle(document.querySelector(
             '[data-testid="preview-mode-active"]')).backgroundColor""")
    adjustments = page.evaluate(
        """() => Array.from(document.querySelectorAll(
             '[data-testid="mapper-adjustments"] li')).map(li => li.textContent)""")
    theme_gets = [u for u in requests_log if "/interactive/api/themes/" in u]
    puts_at_ready = sum(1 for u in requests_log if u.startswith("PUT ") and u.endswith("/api/v1/settings"))
    ready_checks = {
        "mapped_accent_inline": (inline_preview["h"] == MAPPED["h"]
                                 and inline_preview["s"] == MAPPED["s"]
                                 and inline_preview["l"] == MAPPED["l"]),
        "resolved_logo_previewed": inline_preview["logo"] == f'url("{RESOLVED_LOGO}")',
        "preview_strip_wears_mapped_accent": strip_bg == probes_a["accent"],
        "adjustments_disclosed": len(adjustments) == 2
            and any("lightness-clamp" in a for a in adjustments)
            and any("contrast-floor" in a for a in adjustments),
        "theme_detail_fetched_once": len(theme_gets) == 1
            and "/projects/notes/interactive/api/themes/" in theme_gets[0],
        "no_put_before_apply": puts_at_ready == puts_before_apply,
        "accent_distinct_from_gate": probes_a["accent"] != probes_a["statusGate"],
        "accent_distinct_from_fail": probes_a["accent"] != probes_a["statusFail"],
        "accent_distinct_from_run": probes_a["accent"] != probes_a["statusRun"],
    }
    report["steps"]["preview_ready"] = {"ok": all(ready_checks.values()), **ready_checks,
                                        "inline": inline_preview, "adjustments": adjustments}

    # AC 6 — Apply persists the mapped overrides + the RESOLVED logo URL.
    with page.expect_request(is_settings_put, timeout=8000) as put_req:
        page.locator('[data-testid="learn-apply"]').click()
    applied = (json.loads(put_req.value.post_data or "{}")).get("studio.appearance") or {}
    apply_checks = {
        "put_carries_mapped_accent": (applied.get("accent_h") == 217
                                      and applied.get("accent_s") == 81
                                      and applied.get("accent_l") == 59),
        "put_carries_resolved_logo": applied.get("logo_url") == RESOLVED_LOGO,
        "theme_untouched": applied.get("theme") == "dark",
    }
    report["steps"]["apply_persists"] = {"ok": all(apply_checks.values()), **apply_checks,
                                         "put_studio_appearance": applied}
    page.close()

    # ══ Scene B: a fresh load — the board wears the learned brand (EC12/EC16) ══
    page = ctx.new_page()
    page.on("console", on_console)
    page.on("request", lambda r: requests_log.append(f"{r.method} {r.url}"))
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS + "\n" + FREEZE_MOTION)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    order_ok = settled(
        """expected => { const ids = Array.from(document.querySelectorAll(
               '[data-testid="band-needs-you"] [data-testid="project-card"]'))
               .map(c => c.dataset.projectId);
             return JSON.stringify(ids) === JSON.stringify(expected); }""",
        EXPECTED_ORDER,
    )
    narration_ok = settled(
        """text => (document.querySelector(
             '[data-testid="project-card"][data-project-id="upload-endpoint"] [data-testid="live-line"]')
             ?.textContent ?? '').includes(text)""",
        NARRATION,
    )
    accent_ok = settled(
        f"""() => document.documentElement.style.getPropertyValue('--_accent-h') === '{MAPPED["h"]}'""",
        timeout=15000,
    )
    fonts_ok = settled("() => document.fonts.status === 'loaded'", timeout=20000)

    probes_b = page.evaluate(PROBES)
    board_state = page.evaluate(
        """() => { const slot = document.querySelector('[data-testid="logo-slot"]');
      const s = slot ? getComputedStyle(slot) : null;
      return {
        inline: {
          h: document.documentElement.style.getPropertyValue('--_accent-h'),
          logo: document.documentElement.style.getPropertyValue('--logo-url'),
        },
        slotBgImage: s ? s.backgroundImage : null,
        slotBgSize: s ? s.backgroundSize : null,
        slotW: s ? s.width : null, slotH: s ? s.height : null,
        markCount: document.querySelectorAll('[data-testid="logo-wicked-mark"]').length,
      }; }""")
    page.screenshot(path=str(SHOT_APPLIED))

    board_checks = {
        "board_settled_w2_order": order_ok,
        "live_narration_streamed": narration_ok,
        "web_fonts_loaded": fonts_ok,
        "stored_brand_accent_applied": accent_ok and board_state["inline"]["h"] == MAPPED["h"],
        "brand_logo_in_slot": "brand/logo.svg" in (board_state["slotBgImage"] or ""),
        "slot_contain_fit": board_state["slotBgSize"] == "contain",
        "slot_is_32x32": board_state["slotW"] == "32px" and board_state["slotH"] == "32px",
        "wicked_mark_absent": board_state["markCount"] == 0,
        "accent_distinct_from_gate": probes_b["accent"] != probes_b["statusGate"],
        "accent_distinct_from_fail": probes_b["accent"] != probes_b["statusFail"],
        "accent_distinct_from_run": probes_b["accent"] != probes_b["statusRun"],
    }
    report["steps"]["board_wears_brand"] = {
        "ok": all(board_checks.values()), **board_checks,
        "computed": board_state, "probes": probes_b, "screenshot": str(SHOT_APPLIED),
    }

    browser.close()

# The whole session never spoke to a non-fixture origin (the §4.4 posture:
# the proxy is the ONLY wire — brand host and metadata address asserted above;
# this closes the door on every other host too, web fonts excepted).
FONT_HOSTS = {"fonts.googleapis.com", "fonts.gstatic.com"}
foreign = sorted({host_of(u.split(" ", 1)[1]) for u in requests_log}
                 - {"127.0.0.1", ""} - FONT_HOSTS)
report["steps"]["no_foreign_hosts"] = {"ok": foreign == [], "foreign_hosts": foreign}

report["steps"]["console"] = {"ok": len(console_errors) == 0, "errors": console_errors[:10]}
report["screenshots"] = [str(SHOT_RUNNING), str(SHOT_APPLIED)]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("dom_acs_verdict", f"slice-8 assertions did not all hold — see {', '.join(bad)}")

# ── 4. Lint: exit 0, ZERO §2.11 findings (the slice adds no raw color) ─────────
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
findings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and findings == 0,
    "exit_code": r.returncode,
    "raw_color_findings": findings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with zero §2.11 findings — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
