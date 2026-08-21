#!/usr/bin/env python3
"""
vision_slice4_test.py — the DES-VISION-001 slice-4 gate: the four mode
SURFACES on the token system — Chat + Build (§5.3, §5.4) and Document + Video
(§5.5, §5.6) — against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py,
§6.2), on the project-shell routes.

The slice DOM ACs, verbatim from §6.3 (slice 4, plus the §5.5/§5.6 items the
same branch converts):

  1. `[data-testid="build-purpose"]` text `color` resolves from `--ink-body`
     (EC15 — probe technique, no hex copied into this rig);
  2. a run row's computed `border-left-color` matches `--status-gate` when
     that run is at `awaiting_human` (and, same mechanism: `--status-run`
     while executing, `--status-fail` when failed);
  3. the Chat mode first-run state shows the instruction text and
     `data-testid="add-agents"` is present but NO openChat request
     (`POST /api/v1/chats`) fires on mount;
  4. the version strip's active dot computed `background` resolves from
     `var(--accent)`; the Themes popover `data-testid="themes-explanation"`
     is non-empty. (The storyboard-chapter accent AC retired with the
     client-side player: DES-FEEDBACK-001 §7.4 made the storyboard the
     BRIDGE's version HTML, framed in a sandboxed iframe — chapters and
     their selection styling live inside that HTML now, out of the studio's
     token system. Scene 4 asserts the studio-side §7.4 surface instead:
     the iframe at the real /doc/:version route, the token-built canvas
     framing and version strip, and EC18's canvas-first geometry.)

Plus the slice's checklist reads (§6.1): EC7 (the mode surfaces keep their
UXFIX composition), EC10, EC11 (no ornament), EC13 (two typefaces — intent
labels sans, status words/narration/stamps mono), EC15 (computed styles
resolve from the tokens), and the §6.3 preservation lists (Build purpose
always visible, no campaigns panel, intent labels never raw prompts; Chat
single-agent default with the Add-agents opt-in; Document three-pane +
cross-link; Video narration naming its subject). The §5.5 cross-link flash
(wk-anchor-flash, one run) is asserted live.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-4-chat-firstrun.png   Chat mode, first-run state (§5.3)
  vision-4-build-runs.png      Build mode: W2's running + gate runs, left-border
                               status coloring, gate inbox, cost footer (§5.4)
  vision-5-document.png        Document mode, three-pane, v2 selected, version
                               tags in thread (§5.5)
  vision-5-video.png           Video mode: player + storyboard chapters (§5.6)

Finally: `npm run lint` must exit 0 with ZERO findings in this slice's files
(the no-raw-color rule is ERROR there now) while the warn baseline still fires
elsewhere.

Prereqs: Python Playwright + Pillow (the fixture draws the demo frames).
Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1 — ensure_build
CACHES: delete a stale dist-sameorigin/ when the source changed. Env knobs:
VISION_PORT (default 4343), SKIP_STUDIO_BUILD. Prints a JSON report to
stdout; exit 0/1.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    NPM,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
    wake_strip,
)

VISION_PORT = int(os.environ.get("VISION_PORT", "4343"))
ORIGIN = f"http://127.0.0.1:{VISION_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

# This slice's error-mode files (eslint.config.mjs TOKEN_CLEAN): lint findings
# here are FAILURES now, and the gate greps for them by name.
SLICE_FILES = ["GroupChat.tsx", "ChatPanel.tsx", "CenterDashboard.tsx",
               "DocumentCanvas.tsx", "DocumentThread.tsx", "VersionStrip.tsx",
               "ThemesMenu.tsx", "ExportMenu.tsx", "VideoStoryboard.tsx",
               "SurfaceState.tsx", "threadAnchor.ts"]

# The token probe, shared by every scene: computed color of `var(<name>)` on a
# scratch element — the technique that keeps hex values OUT of this rig.
PROBES = """() => {
  const probe = (name, prop) => { const el = document.createElement('div');
    el.style[prop] = `var(${name})`;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop === 'background' ? 'backgroundColor' : prop];
    el.remove(); return v; };
  return {
    accent:       probe('--accent', 'background'),
    accentDim:    probe('--accent-dim', 'background'),
    accentSubtle: probe('--accent-subtle', 'background'),
    inkBody:      probe('--ink-body', 'color'),
    inkDim:       probe('--ink-dim', 'color'),
    inkHigh:      probe('--ink-high', 'color'),
    statusGate:   probe('--status-gate', 'background'),
    statusGateDim:probe('--status-gate-dim', 'background'),
    statusRun:    probe('--status-run', 'background'),
    statusFail:   probe('--status-fail', 'background'),
    statusDone:   probe('--status-done', 'color'),
    surfaceRail:  probe('--surface-rail', 'background'),
    surfaceRaised:probe('--surface-raised', 'background'),
    surfaceBase:  probe('--surface-base', 'background'),
  }; }"""

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared dist — ensure_build caches; see docstring) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (frozen NOW0, no crew daemon) ──────────────
start_server(VISION_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []
chat_posts: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    # AC 3's wire half: every POST /api/v1/chats the page EVER fires is recorded.
    page.on("request", lambda req: chat_posts.append(urlparse(req.url).path)
            if req.method == "POST" and urlparse(req.url).path == "/api/v1/chats" else None)

    # Freeze Date.now at NOW0 + 5s BEFORE the app boots (timers keep running),
    # so every rendered age in the captures is deterministic (§6.0).
    page.clock.set_fixed_time(datetime.fromtimestamp((NOW0 + 5000) / 1000, tz=timezone.utc))

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ══ Scene 1 — Chat, first run (§5.3) ══════════════════════════════════════
    page.goto(f"{ORIGIN}/p/q3-review-deck/chat", wait_until="domcontentloaded")
    page.locator('[data-testid="chat-firstrun"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    # §2.8 reconciled fonts: both faces load; the sans is Inter.
    fonts_ok = settled(
        """() => document.fonts.status === 'loaded'
              && document.fonts.check('13px "Inter"')
              && document.fonts.check('12px "JetBrains Mono"')""",
        timeout=20000,
    )

    chat = page.evaluate(
        f"""() => {{
             const probes = ({PROBES})();
             const instruction = document.querySelector('[data-testid="chat-firstrun-instruction"]');
             const add = document.querySelector('[data-testid="add-agents"]');
             const composer = document.querySelector('textarea.wk-composer');
             const cs = composer ? getComputedStyle(composer) : null;
             return {{
               probes,
               instructionText: instruction ? instruction.textContent : null,
               instructionColor: instruction ? getComputedStyle(instruction).color : null,
               instructionFont: instruction ? getComputedStyle(instruction).fontFamily : null,
               addAgentsPresent: !!add,
               addAgentsColor: add ? getComputedStyle(add).color : null,
               composerBg: cs ? cs.backgroundColor : null,
               composerRadius: cs ? cs.borderRadius : null,
             }}; }}""")
    pr = chat["probes"]
    # Focus the composer: the §5.3 ring is --accent-dim, never the full accent.
    page.locator("textarea.wk-composer").focus()
    ring = page.evaluate(
        """() => getComputedStyle(document.querySelector('textarea.wk-composer')).boxShadow""")
    chat_ok = all([
        (chat["instructionText"] or "").strip() != "",
        chat["instructionColor"] == pr["inkBody"],
        "Inter" in (chat["instructionFont"] or ""),
        chat["addAgentsPresent"],
        chat["addAgentsColor"] == pr["accent"],
        chat["composerBg"] == pr["surfaceRaised"],
        chat["composerRadius"] == "16px",
        pr["accentDim"] in ring and pr["accent"] not in ring,
        len(chat_posts) == 0,  # AC 3: NO openChat fired on mount
    ])
    page.screenshot(path=str(VSHOTS / "vision-4-chat-firstrun.png"))
    report["steps"]["chat_firstrun"] = {
        "ok": chat_ok, "web_fonts": fonts_ok, **chat,
        "focus_ring": ring, "openchat_posts_on_mount": list(chat_posts),
    }

    # ══ Scene 2 — Build (§5.4): left-border status, purpose, gate inbox, footer ═
    set_fixture(ORIGIN, usage_ws=True)
    page.goto(f"{ORIGIN}/p/q3-review-deck/build", wait_until="domcontentloaded")
    page.locator('[data-testid="build-run-row"][data-status="gate"]').first.wait_for(timeout=30000)
    page.locator('[data-testid="build-stats-footer"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    build = page.evaluate(
        f"""() => {{
             const probes = ({PROBES})();
             const purpose = document.querySelector('[data-testid="build-purpose"]');
             const row = st => document.querySelector(
               `[data-testid="build-run-row"][data-status="${{st}}"]`);
             const edge = el => el ? {{
               color: getComputedStyle(el).borderLeftColor,
               width: getComputedStyle(el).borderLeftWidth }} : null;
             const gateRow = row('gate');
             const spans = gateRow ? gateRow.querySelectorAll('span') : [];
             const pill = document.querySelector('[data-testid="gate-inbox-pill"]');
             const footer = document.querySelector('[data-testid="build-stats-footer"]');
             const action = document.querySelector('[data-testid="build-something"]');
             return {{
               probes,
               purposeVisible: !!purpose && purpose.offsetParent !== null,
               purposeColor: purpose ? getComputedStyle(purpose).color : null,
               purposeFont: purpose ? getComputedStyle(purpose).fontFamily : null,
               gateEdge: edge(row('gate')),
               workingEdge: edge(row('working')),
               failedEdge: edge(row('failed')),
               intentFont: spans[1] ? getComputedStyle(spans[1]).fontFamily : null,
               intentText: spans[1] ? spans[1].textContent : null,
               statusFont: spans[2] ? getComputedStyle(spans[2]).fontFamily : null,
               pillBg: pill ? getComputedStyle(pill).backgroundColor : null,
               pillColor: pill ? getComputedStyle(pill).color : null,
               footerFont: footer ? getComputedStyle(footer).fontFamily : null,
               footerColor: footer ? getComputedStyle(footer).color : null,
               footerText: footer ? footer.textContent : null,
               actionBg: action ? getComputedStyle(action).backgroundColor : null,
               campaignsAbsent: !document.body.innerText.toLowerCase().includes('campaign'),
             }}; }}""")
    pb = build["probes"]
    build_ok = all([
        build["purposeVisible"],
        build["purposeColor"] == pb["inkBody"],                    # AC 1
        "Inter" in (build["purposeFont"] or ""),
        (build["gateEdge"] or {}).get("color") == pb["statusGate"],   # AC 2
        (build["gateEdge"] or {}).get("width") == "2px",
        (build["workingEdge"] or {}).get("color") == pb["statusRun"],
        (build["failedEdge"] or {}).get("color") == pb["statusFail"],
        "Inter" in (build["intentFont"] or ""),                    # EC13
        "JetBrains Mono" in (build["statusFont"] or ""),
        build["pillBg"] == pb["statusGateDim"],
        build["pillColor"] == pb["statusGate"],
        "JetBrains Mono" in (build["footerFont"] or ""),
        build["footerColor"] == pb["inkDim"],
        "$0.42" in (build["footerText"] or ""),
        build["actionBg"] == pb["accent"],
        build["campaignsAbsent"],
        # EC12: the accent is none of the status colors.
        pb["accent"] not in (pb["statusGate"], pb["statusRun"], pb["statusFail"]),
    ])
    page.screenshot(path=str(VSHOTS / "vision-4-build-runs.png"))
    report["steps"]["build_runs"] = {"ok": build_ok, **build}

    # ══ Scene 3 — Document (§5.5): drive the W3 journey, then read the tokens ══
    page.goto(f"{ORIGIN}/p/scratch/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-composer"]').fill("Make me a deck for the Q3 review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-version-tag"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-composer"]').fill("Tighten this headline")
    page.keyboard.press("Enter")
    page.locator('[data-testid="thread-version-tag"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="version-entry"][data-version="2"][data-selected="true"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)

    doc = page.evaluate(
        f"""() => {{
             const probes = ({PROBES})();
             const strip = document.querySelector('[data-testid="version-strip"]');
             const dot = document.querySelector('[data-testid="version-active-dot"]');
             const selected = document.querySelector('[data-testid="version-entry"][data-selected="true"]');
             const tag = document.querySelector('[data-testid="thread-version-tag"][data-version="2"]');
             const thread = document.querySelector('[data-testid="thread"]');
             const stamp = document.querySelector('[data-testid="version-stamp"]');
             return {{
               probes,
               stripBg: strip ? getComputedStyle(strip).backgroundColor : null,
               stripSpine: strip ? getComputedStyle(strip).borderTopColor : null,
               dotPresent: !!dot,
               dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
               dotInSelected: !!dot && !!selected && selected.contains(dot),
               dotCount: document.querySelectorAll('[data-testid="version-active-dot"]').length,
               tagColor: tag ? getComputedStyle(tag).color : null,
               tagRadius: tag ? getComputedStyle(tag).borderRadius : null,
               tagFont: tag ? getComputedStyle(tag).fontFamily : null,
               threadBg: thread ? getComputedStyle(thread).backgroundColor : null,
               stampFont: stamp ? getComputedStyle(stamp).fontFamily : null,
               entries: document.querySelectorAll('[data-testid="version-entry"]').length,
             }}; }}""")
    pd = doc["probes"]

    # The §5.5 cross-link flash: selecting v1 scrolls the thread to the message
    # that made it AND flashes wk-anchor-flash once (then the class retires).
    v1_msg_id = page.evaluate(
        """() => document.querySelector('[data-testid="doc-message"][data-version="1"]')
                  ?.getAttribute('data-message-id')""")
    wake_strip(page)  # §7.3: the strip auto-hides after 3s idle — wake before driving it
    page.locator('[data-testid="version-entry"][data-version="1"] [data-testid="version-select"]').click()
    flash_on = settled(
        """id => { const el = document.querySelector(`[data-message-id="${id}"]`);
             return !!el && el.classList.contains('wk-anchor-flash')
                 && getComputedStyle(el).animationName === 'wk-anchor-flash'; }""",
        v1_msg_id, timeout=3000,
    )
    flash_off = settled(
        """id => { const el = document.querySelector(`[data-message-id="${id}"]`);
             return !!el && !el.classList.contains('wk-anchor-flash'); }""",
        v1_msg_id, timeout=5000,
    )
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=30000)

    # Themes: the popover opens WITH its explanation (the §6.3 AC's testid).
    wake_strip(page)
    page.locator('[data-testid="themes-open"]').click()
    page.locator('[data-testid="themes-panel"]').wait_for(timeout=30000)
    themes = page.evaluate(
        """() => { const ex = document.querySelector('[data-testid="themes-explanation"]');
             return {
               text: ex ? ex.textContent.trim() : null,
               font: ex ? getComputedStyle(ex).fontFamily : null,
               size: ex ? getComputedStyle(ex).fontSize : null,
             }; }""")
    page.keyboard.press("Escape")
    wake_strip(page)
    page.locator('[data-testid="themes-open"]').click()  # toggle shut for the capture

    # Back to v2 for the named capture (the slice entry: v2 selected, tags visible).
    page.locator('[data-testid="thread-version-tag"][data-version="2"]').click()
    page.locator('[data-testid="version-entry"][data-version="2"][data-selected="true"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)

    doc_ok = all([
        doc["stripBg"] == pd["surfaceRail"],
        doc["stripSpine"] == pd["accentSubtle"],
        doc["dotPresent"], doc["dotInSelected"], doc["dotCount"] == 1,
        doc["dotBg"] == pd["accent"],                              # AC 4 (dot)
        doc["tagColor"] == pd["statusDone"],
        doc["tagRadius"] == "4px",
        "JetBrains Mono" in (doc["tagFont"] or ""),
        doc["threadBg"] == pd["surfaceBase"],
        "JetBrains Mono" in (doc["stampFont"] or ""),              # EC13
        doc["entries"] == 2,
        v1_msg_id is not None, flash_on, flash_off,                # §5.5 flash
        (themes["text"] or "") != "",                              # AC 4 (themes)
        "Inter" in (themes["font"] or ""),
        themes["size"] == "13px",
    ])
    wake_strip(page)  # the named capture shows the strip, not its idle fade
    page.screenshot(path=str(VSHOTS / "vision-5-document.png"))
    report["steps"]["document_surface"] = {
        "ok": doc_ok, **doc, "v1_message_id": v1_msg_id,
        "flash_on": flash_on, "flash_off": flash_off, "themes_explanation": themes,
    }

    # ══ Scene 4 — Video, REWIRED by DES-FEEDBACK-001 §7.4: the framed storyboard ═
    # The client-side player (chapter cards, demo-gif, spec state) is GONE — it
    # spoke routes the real bridge never served. The §5.6 claim this scene still
    # makes is token-side and studio-side: the demo surface frames the demo's
    # version HTML (the bridge-built storyboard) in a fully sandboxed iframe at
    # the real /doc/:version route, inside the same token-built canvas framing
    # as Document mode, addressed by the same version strip — and the §7.3
    # canvas-first geometry (EC18) holds on this 1440px viewport.
    set_fixture(ORIGIN, demo=True)
    page.goto(f"{ORIGIN}/p/q3-review-deck/video/checkout-demo", wait_until="domcontentloaded")
    player_el = page.locator('[data-testid="demo-player"]')
    player_el.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # The storyboard rendered INSIDE the frame: its chapters, thumbnails decoded.
    sb = page.frame_locator('[data-testid="demo-player"]')
    sb.locator(".ch").nth(3).wait_for(timeout=30000)

    video = page.evaluate(
        f"""() => {{
             const probes = ({PROBES})();
             const frame = document.querySelector('[data-testid="demo-player"]');
             const canvas = document.querySelector('[data-testid="video-canvas"]');
             const strip = document.querySelector('[data-testid="version-strip"]');
             const drawer = document.querySelector('[data-testid="thread-drawer"]');
             const cs = canvas ? getComputedStyle(canvas) : null;
             const cr = canvas ? canvas.getBoundingClientRect() : null;
             return {{
               probes,
               tag: frame ? frame.tagName : null,
               src: frame ? frame.getAttribute('src') : null,
               sandbox: frame ? frame.getAttribute('sandbox') : null,
               version: frame ? frame.getAttribute('data-version') : null,
               canvasBorder: cs ? cs.borderTopColor : null,
               canvasBg: cs ? cs.backgroundColor : null,
               canvasRatio: cr ? cr.width / 1440 : null,
               drawerClosed: !drawer,
               stripBg: strip ? getComputedStyle(strip).backgroundColor : null,
               stripEntries: document.querySelectorAll('[data-testid="version-entry"]').length,
               headSelected: !!document.querySelector(
                 '[data-testid="version-entry"][data-version="1"][data-selected="true"]'),
             }}; }}""")
    pv = video["probes"]
    # In-frame: 4 chapters in spec order, every image decoded (thumbnails + recording).
    chapters_in_frame = sb.locator(".ch").count()
    chapter_texts = [sb.locator(".ch").nth(i).inner_text() for i in range(chapters_in_frame)]
    sb_frame = next(f for f in page.frames if "/d/checkout-demo/doc/" in (f.url or ""))
    frame_imgs_ok = False
    try:
        sb_frame.wait_for_function(
            "() => Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)",
            timeout=15000)
        frame_imgs_ok = True
    except Exception:
        pass
    video_ok = all([
        video["tag"] == "IFRAME",
        (video["src"] or "").endswith("/interactive/d/checkout-demo/doc/1"),
        video["sandbox"] == "allow-scripts",
        video["version"] == "1",
        video["canvasBorder"] == pv["surfaceRaised"],              # EC15: token framing
        video["canvasBg"] == pv["surfaceBase"],
        video["canvasRatio"] is not None and video["canvasRatio"] > 0.8,  # EC18
        video["drawerClosed"],
        video["stripBg"] == pv["surfaceRail"],
        video["stripEntries"] == 1,
        video["headSelected"],
        chapters_in_frame == 4,
        all(t in " / ".join(chapter_texts) for t in
            ("Open the storefront", "Add a hoodie to the cart",
             "Enter the card details", "Confirm the order")),
        frame_imgs_ok,
    ])
    wake_strip(page)  # the named capture shows the strip addressing the storyboard
    page.screenshot(path=str(VSHOTS / "vision-5-video.png"))
    report["steps"]["video_surface"] = {
        "ok": video_ok, **{k: v for k, v in video.items() if k != "probes"},
        "chapters_in_frame": chapters_in_frame, "chapter_texts": chapter_texts,
        "frame_images_decoded": frame_imgs_ok,
    }

    browser.close()

report["steps"]["console"] = {"ok": len(console_errors) == 0, "errors": console_errors[:10]}
report["screenshots"] = [str(VSHOTS / n) for n in (
    "vision-4-chat-firstrun.png", "vision-4-build-runs.png",
    "vision-5-document.png", "vision-5-video.png")]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("dom_acs_verdict", f"slice-4 assertions did not all hold — see {', '.join(bad)}")

# ── 4. Lint posture: exit 0; ZERO findings in the error-mode slice files ──────
r = subprocess.run([NPM, "run", "lint"], cwd=REPO,
                   capture_output=True, text=True, timeout=600)
out = r.stdout + r.stderr
slice_hits = [f for f in SLICE_FILES if f in out]
# Slice 6 completed the §2.11 migration: the rule is ERROR repo-wide and the
# warn baseline this step once expected is retired — zero findings, full stop.
baseline_warnings = out.count("(DES-VISION-001 §2.11)")
report["steps"]["lint"] = {
    "ok": r.returncode == 0 and not slice_hits and baseline_warnings == 0,
    "exit_code": r.returncode,
    "slice_files_with_findings": slice_hits,
    "raw_color_findings_repo_wide": baseline_warnings,
    "tail": out[-400:],
}
if not report["steps"]["lint"]["ok"]:
    fail("lint_verdict", "lint must exit 0 with no findings in the slice-4 "
         "files (nor anywhere: the rule is error repo-wide since slice 6) — see lint")

report["ok"] = True
print(json.dumps(report, indent=2))
