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
  3. the Chat mode first-run state shows the instruction text and NO openChat
     request (`POST /api/v1/chats`) fires on mount. (RE-SCOPED TWICE — slice C
     chips, then BRIEF-UX-001 C6/EC44 round 3: the fallback constant is GONE;
     the chips RESOLVE roster-true from the surface's one named mount GET
     /roster and show the CHAT-CAPABLE seats with a `✕` each; `[+ Add]`
     (dashed border, --ink-dim) opens the roster picker.);
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
zero-requests-on-mount with the §6 default chips; Document three-pane +
cross-link; Video narration naming its subject). The §5.5 cross-link flash
(wk-anchor-flash, one run) is asserted live.

Captures (§6.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  vision-4-chat-firstrun.png   Chat mode, first-run state (§5.3)
  vision-4-build-runs.png      Build mode: q3-review-deck's Build tab — the gate
                               run's left-border coloring, gate inbox, purpose,
                               primary action (§5.4; scene 2 visits the project
                               tabs that own each status edge — see the scene)
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
    # EC44: the chips RESOLVE roster-true — census the resolved state.
    page.locator('[data-testid="agent-chip"]').first.wait_for(timeout=30000)
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
             // The §6 chips reality (DES-FEEDBACK-001, slice C): default agent
             // chips + the separate [+ Add] affordance — the pre-slice-C
             // "add-agents" opt-in this scene originally pinned is gone.
             const chipsBar = document.querySelector('[data-testid="agent-chips-bar"]');
             const chips = Array.from(document.querySelectorAll('[data-testid="agent-chip"]'));
             const add = document.querySelector('[data-testid="add-agent"]');
             const addCs = add ? getComputedStyle(add) : null;
             const composer = document.querySelector('textarea.wk-composer');
             const cs = composer ? getComputedStyle(composer) : null;
             return {{
               probes,
               instructionText: instruction ? instruction.textContent : null,
               instructionColor: instruction ? getComputedStyle(instruction).color : null,
               instructionFont: instruction ? getComputedStyle(instruction).fontFamily : null,
               chipsBarCount: chipsBar ? chipsBar.getAttribute('data-count') : null,
               chipAgents: chips.map(c => c.getAttribute('data-agent')),
               chipFont: chips[0] ? getComputedStyle(chips[0]).fontFamily : null,
               chipColor: chips[0] ? getComputedStyle(chips[0]).color : null,
               addAgentPresent: !!add,
               addAgentColor: addCs ? addCs.color : null,
               addAgentBorderStyle: addCs ? addCs.borderTopStyle : null,
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
        # EC44: the default chips are the resolved CHAT-CAPABLE seats.
        chat["chipsBarCount"] == "2",
        chat["chipAgents"] == ["claude", "pi"],
        # EC13: chip text in the sans; §6.3 anatomy — [+ Add] dashed, --ink-dim.
        "Inter" in (chat["chipFont"] or ""),
        chat["chipColor"] == pr["inkBody"],
        chat["addAgentPresent"],
        chat["addAgentColor"] == pr["inkDim"],
        chat["addAgentBorderStyle"] == "dashed",
        chat["composerBg"] == pr["surfaceRaised"],
        chat["composerRadius"] == "16px",
        pr["accentDim"] in ring and pr["accent"] not in ring,
        len(chat_posts) == 0,  # AC 3 (unchanged): NO openChat fired on mount
    ])
    page.screenshot(path=str(VSHOTS / "vision-4-chat-firstrun.png"))
    report["steps"]["chat_firstrun"] = {
        "ok": chat_ok, "web_fonts": fonts_ok, **chat,
        "focus_ring": ring, "openchat_posts_on_mount": list(chat_posts),
    }

    # ══ Scene 2 — Build (§5.4): left-border status, purpose, gate inbox, footer ═
    # Re-scope history — this scene has followed the §5.4 anatomy twice:
    #   · DES-UX-001 slice S (§2.3 rule 2) scoped a project's Build tab to
    #     exactly its own runs, so the multi-status whole-fixture list (gate +
    #     working + failed edges beside one $0.42 footer) moved to the FLAT
    #     `/runs` home — this scene's §11.2 re-scope (slice W) pointed here.
    #   · DES-UX-001 slice Y then retired bare `/runs` outright: it is a
    #     replace-redirect to `/work`, whose rows are run-LINK anatomy, and the
    #     unscoped CenterDashboard now sits behind the legacy-redirect fallback
    #     — URL-unreachable. No `build-run-row` renders at ANY URL outside a
    #     project shell.
    # So this scene follows the anatomy to where it truly renders: the project
    # Build tabs (`/p/:id/build`, slice S), visiting the tab that OWNS each
    # status edge — q3-review-deck (gate, plus purpose/pill/action: the named
    # capture), upload-endpoint (working, plus the ONLY real cost footer),
    # auth-refactor (failed). Token contracts unchanged; the footer is asserted
    # per-project because that is what each page truly folds (see below).
    set_fixture(ORIGIN, usage_ws=True)

    # The same §5.4 extraction, run on each project's Build tab.
    BUILD_READ = f"""() => {{
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
           footerPresent: !!footer,
           footerWindow: footer ? footer.getAttribute('data-window') : null,
           footerFont: footer ? getComputedStyle(footer).fontFamily : null,
           footerColor: footer ? getComputedStyle(footer).color : null,
           footerText: footer ? footer.textContent : null,
           actionBg: action ? getComputedStyle(action).backgroundColor : null,
           campaignsAbsent: !document.body.innerText.toLowerCase().includes('campaign'),
         }}; }}"""

    # ── 2a. The gate project (q3-review-deck → r-q3 at awaiting_human) ────────
    page.goto(f"{ORIGIN}/p/q3-review-deck/build", wait_until="domcontentloaded")
    page.locator('[data-testid="build-run-row"][data-status="gate"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    gate_page = page.evaluate(BUILD_READ)
    pb = gate_page["probes"]
    gate_ok = all([
        gate_page["purposeVisible"],
        gate_page["purposeColor"] == pb["inkBody"],                # AC 1
        "Inter" in (gate_page["purposeFont"] or ""),
        (gate_page["gateEdge"] or {}).get("color") == pb["statusGate"],  # AC 2
        (gate_page["gateEdge"] or {}).get("width") == "2px",
        "Inter" in (gate_page["intentFont"] or ""),                # EC13
        "JetBrains Mono" in (gate_page["statusFont"] or ""),
        gate_page["pillBg"] == pb["statusGateDim"],
        gate_page["pillColor"] == pb["statusGate"],
        gate_page["actionBg"] == pb["accent"],
        # r-q3 is parked at its gate (`awaiting_human` — core: paused BEFORE a
        # not-yet-done unit, so nothing is in flight) and no cliUsage frame has
        # ever addressed it, so the data-gated footer (§2.7 rule 2) renders
        # NOTHING on this page — never a $0.00 or an em-dash.
        not gate_page["footerPresent"],
        gate_page["campaignsAbsent"],
        # EC12: the accent is none of the status colors.
        pb["accent"] not in (pb["statusGate"], pb["statusRun"], pb["statusFail"]),
    ])
    page.screenshot(path=str(VSHOTS / "vision-4-build-runs.png"))

    # ── 2b. The working project (upload-endpoint → r-upload executing) ────────
    page.goto(f"{ORIGIN}/p/upload-endpoint/build", wait_until="domcontentloaded")
    page.locator('[data-testid="build-run-row"][data-status="working"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    # This page's footer TRUTH, derived from the fixture's usage wires (the
    # flat home's old "$0.42" was ALREADY this project's spend — the one
    # `usage_ws` cliUsage frame is addressed to r-upload, and the REST events
    # backfill carries no cliUsage for any run):
    #   /ws pushes ONE frame on connect: {session: "r-upload",
    #     inputTokens: 84000, outputTokens: 14000, costUsd: 0.42}
    #   → usageTotals: tokens = 84000 + 14000 = 98000 → formatTokens "98.0k";
    #                  cost = 0.42 → formatCost "$0.42";
    #   → unitsInFlight: r-upload is `executing` with its cursor unit pending
    #     → 1 → "1 step in flight";
    #   → footerParts.join(' · ') = "1 step in flight · $0.42 · 98.0k tokens",
    #     windowed "30d" (the useTimeRange default, EC39).
    footer_folded = settled(
        """() => { const f = document.querySelector('[data-testid="build-stats-footer"]');
             return !!f && (f.textContent || '').includes('$0.42'); }""",
        timeout=30000,
    )
    working_page = page.evaluate(BUILD_READ)
    pw = working_page["probes"]
    working_ok = all([
        footer_folded,
        (working_page["workingEdge"] or {}).get("color") == pw["statusRun"],  # AC 2
        (working_page["workingEdge"] or {}).get("width") == "2px",
        working_page["purposeVisible"],
        working_page["footerPresent"],
        "JetBrains Mono" in (working_page["footerFont"] or ""),
        working_page["footerColor"] == pw["inkDim"],
        "1 step in flight" in (working_page["footerText"] or ""),
        "$0.42" in (working_page["footerText"] or ""),
        "98.0k tokens" in (working_page["footerText"] or ""),
        working_page["footerWindow"] == "30d",                     # EC39
        working_page["campaignsAbsent"],
    ])

    # ── 2c. The failed project (auth-refactor → r-auth failed) ────────────────
    page.goto(f"{ORIGIN}/p/auth-refactor/build", wait_until="domcontentloaded")
    page.locator('[data-testid="build-run-row"][data-status="failed"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    failed_page = page.evaluate(BUILD_READ)
    pf = failed_page["probes"]
    failed_ok = all([
        (failed_page["failedEdge"] or {}).get("color") == pf["statusFail"],  # AC 2
        (failed_page["failedEdge"] or {}).get("width") == "2px",
        failed_page["purposeVisible"],
        # r-auth is terminal-failed (nothing in flight) and its events backfill
        # holds no cliUsage — the data-gated footer renders nothing here too.
        not failed_page["footerPresent"],
        failed_page["campaignsAbsent"],
    ])

    build_ok = gate_ok and working_ok and failed_ok
    report["steps"]["build_runs"] = {
        "ok": build_ok,
        "gate_ok": gate_ok, "working_ok": working_ok, "failed_ok": failed_ok,
        "gate_project": {k: v for k, v in gate_page.items() if k != "probes"},
        "working_project": {k: v for k, v in working_page.items() if k != "probes"},
        "failed_project": {k: v for k, v in failed_page.items() if k != "probes"},
        "footer_folded": footer_folded,
    }

    # ══ Scene 3 — Document (§5.5): drive the W3 journey, then read the tokens ══
    page.goto(f"{ORIGIN}/p/scratch/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="doc-composer"]').fill("Make me a deck for the Q3 review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-composer"]').fill("Tighten this headline")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="version-entry"][data-version="2"][data-selected="true"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)

    doc = page.evaluate(
        f"""() => {{
             const probes = ({PROBES})();
             const strip = document.querySelector('[data-testid="version-strip"]');
             const dot = document.querySelector('[data-testid="version-active-dot"]');
             const selected = document.querySelector('[data-testid="version-entry"][data-selected="true"]');
             const tag = document.querySelector('[data-testid="version-marker"][data-version="2"]');
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
    page.locator('[data-testid="version-marker"][data-version="2"]').click()
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
    # Park the pointer mid-canvas before measuring EC18: the rail is
    # hover-to-peek (§7.3), so a stationary cursor left over the rail band by
    # the PREVIOUS scene's last click keeps it expanded and shrinks the canvas
    # below the 0.8 ratio — a cursor artifact, not a layout regression. (Became
    # visible when slice D's 32px context header shifted the document scene's
    # click targets; the geometry itself is unchanged on a fresh navigation.)
    page.mouse.move(720, 450)
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
