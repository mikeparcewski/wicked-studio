#!/usr/bin/env python3
"""
ux2_videofb_test.py — the VIDEO-FB gate: the video surface brought up to the
document overhaul, each cold-operator finding an AC proven in a real browser
against the shared W2 fixture (uxfix_fixture.py, `demo` switch on). The fixture
serves the REAL bridge shapes: storyboard() markup with ROOT-ABSOLUTE
`/d/<slug>/api/demo/recording/...` URLs, a real tiny VP8 webm with Range
support, and a materialized `wicked.interactive.demo.requested`.

The findings, each an AC:

  1. CRITICAL playback — the storyboard's root-absolute recording/thumbnail
     URLs fell through to the SPA fallback and answered HTML (MediaError 4).
       AC1: the framed <video>'s RESOLVED currentSrc is the PROJECT-SCOPED
       `/api/v1/projects/<pid>/interactive/d/<slug>/api/demo/recording/_vN.webm`,
       the element reaches loadeddata (readyState ≥ 2, real duration, no
       MediaError), play() advances currentTime, every chapter thumbnail
       decodes, and no recording request 4xx'd.
  2. CRITICAL record trigger — the old chip posted chat.posted; nobody answers
     that wire.
       AC2: the surface carries a REAL Record button; clicking it POSTs
       `wicked.interactive.demo.requested` (payload.document_id = the demo)
       over /api/events, the button itself wears the point-of-action pending
       state (EC37: queuing → recording, disabled) with honest re-record copy,
       and the landing advances the manifest (v2 pill, frame follows head,
       button re-arms, the send's marker lands on its message).
  3. Surface parity with the doc overhaul:
       AC3a: the tabbed right panel — Chat | Compare | Theme | Versions — with
       its OWN expand/collapse rail; Compare renders two compare-pane frames on
       the canvas; the Versions tab speaks the DEMO noun.
       AC3b: the bottom band is the SLIM versions-only variant (measured height,
       no toolbar/caption/chiclets).
       AC3c: thread history RESTORES on reload in video mode (the same
       conversation read doc mode does) — the authored spec is back on screen.
       AC3d: EXPORT offers 'RECORDING ↓' when (and only because) the shown
       version's webm exists — a same-origin project-scoped href that serves
       video/webm bytes.
       AC3e: the stuck 'generating' badge — a chat ask the agent answers IN
       CHAT (complete, no version) resolves the send chip; no eternal
       "being worked now", no fabricated timeout.
  4. Wizard honesty:
       AC4a: the wizard is FLOW, not an inset-0 overlay — the composer beneath
       stays visible and is DISABLED with the reason as its words (never
       silently pointer-trapped).
       AC4b: pre-target the steps stage is EXPLAINED (the hint), not hidden
       mystery; the target unlocks the step form.
       AC4c: CREW-UX-9 copy truth — describe-first submits with demo_steps
       OMITTED (the governed run authors the spec from the description); the
       manual Subject/Action path is labeled advanced.
  5. Copy:
       AC5: chapter cards never read '1 0' — junk labels are replaced by the
       authored step SUBJECTS (from the demo's brief); 'document' vocabulary is
       absent from the video surface's own copy.

Captures (§12.0 contract: 1440x900, dsf=1) into e2e/shots/vision/:
  ux2-videofb-player.png     the storyboard playing: chapters titled, RECORDING
                             in export, slim band
  ux2-videofb-wizard.png     the flow wizard with the composer visibly disabled

Prereqs: Python Playwright + Pillow. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4414), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import (
    DEMO_STEPS,
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
    wake_strip,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4414"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

PID = "q3-review-deck"
DEMO = "checkout-demo"
VIDEO_URL = f"{ORIGIN}/p/{PID}/video/{DEMO}"
MOUNT = f"/api/v1/projects/{PID}/interactive"
SUBJECTS = [s["title"] for s in DEMO_STEPS]

# AC3b's measured bound — the same slim-band bound the docfb rig pins.
SLIM_BAND_MAX_PX = 44

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


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read())


# ── 0. Build + fixture (demo on, with the live-observed junk chapter labels) ──
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, demo=True, demo_bare_labels=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    bad_media: list[str] = []
    page.on(
        "response",
        lambda r: bad_media.append(f"{r.status} {r.url}")
        if r.status >= 400 and "/api/demo/recording/" in r.url else None)
    all_4xx: list[str] = []
    page.on("response", lambda r: all_4xx.append(r.url) if r.status >= 400 else None)
    api_posts: list[dict] = []

    def on_request(req) -> None:
        if req.method == "POST" and "/interactive/api/" in req.url:
            try:
                api_posts.append({"url": req.url, "body": json.loads(req.post_data or "{}")})
            except Exception:
                api_posts.append({"url": req.url, "body": None})

    page.on("request", on_request)

    # ══ Scene 1 — AC1 playback + AC5 chapter subjects ══════════════════════════
    page.goto(VIDEO_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="demo-player"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)

    player_attrs = page.evaluate(
        """() => { const f = document.querySelector('[data-testid="demo-player"]');
                   return { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'),
                            hasSrcdoc: f.hasAttribute('srcdoc'), version: f.dataset.version }; }""")
    check("AC1_frame_shape",
          (player_attrs["src"] or "").endswith(f"{MOUNT}/d/{DEMO}/doc/1")
          and player_attrs["sandbox"] == "allow-scripts"
          # The re-homed bytes render via srcdoc — src stays the version address.
          and player_attrs["hasSrcdoc"] and player_attrs["version"] == "1",
          **player_attrs)

    sb = page.frame_locator('[data-testid="demo-player"]')
    video = sb.locator("#wi-demo-video")
    video.wait_for(state="attached", timeout=30000)

    # The <video> must ACTUALLY load: resolved project-scoped src, loadeddata,
    # a real duration, no MediaError — the exact assertions the live break failed.
    loaded = video.evaluate(
        """v => new Promise(res => {
             const done = () => res({
               currentSrc: v.currentSrc, readyState: v.readyState,
               duration: v.duration, error: v.error ? v.error.code : null,
               w: v.videoWidth, h: v.videoHeight });
             if (v.readyState >= 2) return done();
             v.addEventListener('loadeddata', done);
             v.addEventListener('error', done);
             setTimeout(done, 15000);
           })""")
    check("AC1_video_loads",
          f"{MOUNT}/d/{DEMO}/api/demo/recording/_v1.webm" in (loaded["currentSrc"] or "")
          and loaded["readyState"] >= 2 and loaded["error"] is None
          and loaded["duration"] and loaded["duration"] > 0
          and loaded["w"] > 0 and loaded["h"] > 0,
          **loaded)

    played = video.evaluate(
        """v => v.play().then(() => new Promise(res =>
             setTimeout(() => res({ t: v.currentTime, paused: v.paused }), 900)))
           .catch(e => ({ playError: String(e) }))""")
    check("AC1_video_plays",
          played.get("t", 0) > 0 and played.get("paused") is False, **played)

    # Every chapter thumbnail decoded — root-absolute imgs re-homed too.
    thumbs = sb.locator(".wi-demo__thumb img")
    thumb_count = thumbs.count()
    thumbs_ok = sb.locator("body").evaluate(
        """() => Array.from(document.images).map(i =>
             ({ src: i.src, ok: i.complete && i.naturalWidth > 0 }))""")
    check("AC1_thumbnails_decode",
          thumb_count == len(SUBJECTS) and all(t["ok"] for t in thumbs_ok)
          and all(f"{MOUNT}/d/{DEMO}/api/demo/recording/" in t["src"] for t in thumbs_ok),
          count=thumb_count, thumbs=thumbs_ok)

    check("AC1_no_recording_4xx", len(bad_media) == 0, bad_4xx=bad_media[:10])

    # AC5: the junk '1 0' captions wear the AUTHORED subjects (from the demo's
    # brief, restored by the same conversation read that rehydrates the thread).
    def captions() -> list:
        return sb.locator(".wi-demo__name").all_inner_texts()

    got = captions()
    deadline_ok = got == SUBJECTS
    if not deadline_ok:
        # Subjects arrive with the thread hydration; the frame re-renders once.
        page.wait_for_timeout(2500)
        got = captions()
        deadline_ok = got == SUBJECTS
    check("AC5_chapter_subjects", deadline_ok, captions=got, expected=SUBJECTS)

    # AC5's vocabulary sweep: the surface's own chrome never says "document".
    surface_copy = page.evaluate(
        """() => { const panel = document.querySelector('[data-testid="doc-panel-rail"]')
                     ?? document.querySelector('[data-testid="doc-panel"]');
                   const record = document.querySelector('[data-testid="video-record"]');
                   return { recordTitle: record ? record.title : null,
                            railTitles: panel ? Array.from(panel.querySelectorAll('button'))
                              .map(b => b.title).join(' | ') : null }; }""")
    check("AC5_no_document_vocabulary",
          "document" not in (surface_copy["railTitles"] or "").lower()
          and "re-records" in (surface_copy["recordTitle"] or ""),
          **surface_copy)

    # ══ Scene 2 — AC2: the record button, EC37 at the click site ══════════════
    set_fixture(ORIGIN, demo_record_ms=1500)
    api_posts.clear()
    record = page.locator('[data-testid="video-record"]')
    check("AC2_button_idle_and_honest",
          record.get_attribute("data-state") == "idle"
          and "re-records" in (record.get_attribute("title") or "")
          and "does not change the steps" in (record.get_attribute("title") or ""),
          title=record.get_attribute("title"))
    record.click()

    # Point of action: the button answers where it was clicked (EC37).
    page.wait_for_function(
        """() => ['queuing','recording'].includes(
             document.querySelector('[data-testid="video-record"]')?.dataset.state)""",
        timeout=5000)
    pending_state = record.get_attribute("data-state")
    pending_disabled = record.is_disabled()

    # The wire is demo.requested — the one the bridge's workspace materializes.
    page.wait_for_timeout(500)
    record_posts = [x for x in api_posts
                    if x["body"] and x["body"].get("event_type") == "wicked.interactive.demo.requested"]
    chat_posts = [x for x in api_posts
                  if x["body"] and x["body"].get("event_type") == "wicked.interactive.chat.posted"]
    check("AC2_wire_is_demo_requested",
          len(record_posts) == 1
          and record_posts[0]["body"]["payload"].get("document_id") == DEMO
          and record_posts[0]["url"].endswith(f"{MOUNT}/api/events")
          and len(chat_posts) == 0,
          posts=record_posts, chat_leak=chat_posts,
          pending_state=pending_state, pending_disabled=pending_disabled)
    check("AC2_point_of_action_pending",
          pending_state in ("queuing", "recording") and pending_disabled,
          state=pending_state, disabled=pending_disabled)

    # The landing: v2 pill on the slim band, the frame follows the head, the
    # button re-arms, and the send's marker lands on its message (no stuck badge).
    page.locator('[data-testid="version-entry"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="demo-player"][data-version="2"]').wait_for(timeout=30000)
    page.wait_for_function(
        """() => document.querySelector('[data-testid="video-record"]')?.dataset.state === 'idle'""",
        timeout=15000)
    manifest = get_json(f"{ORIGIN}{MOUNT}/d/{DEMO}/api/versions")
    check("AC2_landing_advances",
          manifest["head"] == 2 and len(manifest["versions"]) == 2,
          manifest_head=manifest["head"])

    # ══ Scene 3 — AC3a/b/d: panel parity, slim band, RECORDING download ═══════
    band = page.evaluate(
        """() => { const s = document.querySelector('[data-testid="version-strip"]');
                   const r = s.getBoundingClientRect();
                   return { variant: s.dataset.variant, height: r.height,
                            hasExport: !!s.querySelector('[data-testid="export-menu"]'),
                            hasThemes: !!s.querySelector('[data-testid="themes-open"]'),
                            hasFork: !!s.querySelector('[data-testid="version-fork"]'),
                            hasToggle: !!s.querySelector('[data-testid="thread-toggle"]') }; }""")
    check("AC3b_slim_band",
          band["variant"] == "slim" and band["height"] <= SLIM_BAND_MAX_PX
          and not band["hasExport"] and not band["hasThemes"]
          and not band["hasFork"] and not band["hasToggle"],
          **band)

    # The rail is the collapsed panel — its OWN expand/collapse (AC3a).
    check("AC3a_rail_default",
          page.locator('[data-testid="doc-panel-rail"]').count() == 1
          and page.locator('[data-testid="doc-panel"]').count() == 0)
    page.locator('[data-testid="panel-expand"]').click()
    tabs = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="panel-tab"]'))
                   .map(t => t.dataset.tab)""")
    check("AC3a_tabs", tabs == ["chat", "compare", "theme", "versions"], tabs=tabs)

    # AC3d: RECORDING ↓ beside the export formats — proven-on-the-wire, same
    # origin, project-scoped; the bytes really are the webm.
    page.locator('[data-testid="export-recording"]').wait_for(timeout=15000)
    rec_href = page.locator('[data-testid="export-recording"]').get_attribute("href")
    rec_abs = rec_href if rec_href.startswith("http") else f"{ORIGIN}{rec_href}"
    with urllib.request.urlopen(rec_abs, timeout=10) as res:
        rec_type = res.headers.get("Content-Type")
        rec_bytes = res.read(4)
    check("AC3d_recording_download",
          f"{MOUNT}/d/{DEMO}/api/demo/recording/_v2.webm" in rec_abs
          and rec_type == "video/webm" and rec_bytes == b"\x1a\x45\xdf\xa3",
          href=rec_href, content_type=rec_type)

    # The record send's marker landed on its message — the badge resolved into
    # the anchor, not an eternal chip (the doc-mode grammar, kept).
    marker = page.locator('[data-testid="version-marker"][data-version="2"]')
    check("AC2_marker_lands",
          marker.count() == 1
          and page.locator('[data-testid="thread-generating"]').count() == 0)

    # Versions tab speaks the demo noun (AC3a copy).
    page.locator('[data-testid="panel-tab"][data-tab="versions"]').click()
    note = page.locator('[data-testid="versions-history-note"]').inner_text()
    rows = page.locator('[data-testid="version-detail"]').count()
    check("AC3a_versions_demo_noun",
          "demo’s own version manifest" in note and rows == 2
          and "document" not in note, note=note, rows=rows)

    # Compare renders two panes ON the canvas (AC3a) — both re-homed frames.
    page.locator('[data-testid="panel-tab"][data-tab="compare"]').click()
    page.locator('[data-testid="version-compare-toggle"]').click()
    page.locator('[data-testid="compare-panes"]').wait_for(timeout=15000)
    # Each pane fetches its version's HTML before framing it — wait for both.
    page.wait_for_function(
        """() => document.querySelectorAll('[data-testid="compare-pane"]').length === 2""",
        timeout=15000)
    panes = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="compare-pane"]'))
                   .map(f => ({ v: f.dataset.version, srcdoc: f.hasAttribute('srcdoc') }))""")
    check("AC3a_compare_panes",
          len(panes) == 2 and {x["v"] for x in panes} == {"1", "2"},
          panes=panes)
    page.locator('[data-testid="compare-exit"]').click()

    wake_strip(page)
    page.locator('[data-testid="panel-tab"][data-tab="chat"]').click()
    page.screenshot(path=str(VSHOTS / "ux2-videofb-player.png"))

    # ══ Scene 3e — the stuck badge: a chat reply with NO landing resolves ═════
    composer = page.locator('[data-testid="doc-composer"]')
    composer.fill("does the spec cover the cart?")
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-agent"]').wait_for(timeout=15000)
    page.wait_for_function(
        """() => !document.querySelector('[data-testid="thread-generating"]')
              && !document.querySelector('[data-testid="steering-chip"]')""",
        timeout=10000)
    badge = page.evaluate(
        """() => ({
             composerState: document.querySelector('[data-testid="thread"]')?.dataset.composerState,
             generating: !!document.querySelector('[data-testid="thread-generating"]'),
             timedOut: !!document.querySelector('[data-testid="thread-generating-timeout"]'),
             agentReply: document.querySelector('[data-testid="doc-agent"]')?.innerText ?? '' })""")
    check("AC3e_badge_resolves_on_reply",
          badge["composerState"] == "terminal" and not badge["generating"]
          and not badge["timedOut"] and "nothing to re-record" in badge["agentReply"],
          **badge)

    # ══ Scene 3c — thread restore on reload, in VIDEO mode ════════════════════
    page.reload(wait_until="domcontentloaded")
    page.locator('[data-testid="demo-player"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="panel-expand"]').click()
    page.locator('[data-testid="thread"]').wait_for(timeout=15000)
    page.locator('[data-testid="doc-message"]').first.wait_for(timeout=15000)
    restored = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
                   .map(m => m.innerText)""")
    check("AC3c_thread_restores_in_video_mode",
          any("Record a demo of https://shop.example/" in t for t in restored)
          and any("1. Open the storefront" in t for t in restored)
          and any("does the spec cover the cart?" in t for t in restored),
          restored=[t[:80] for t in restored])

    # ══ Scene 4 — the wizard: flow, hinted, describe-first ════════════════════
    page.goto(f"{ORIGIN}/p/{PID}/video", wait_until="domcontentloaded")
    page.locator('[data-testid="demo-picker"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    composer = page.locator('[data-testid="doc-composer"]')
    composer.fill("a walkthrough of the run board")
    page.keyboard.press("Enter")
    page.locator('[data-testid="demo-wizard"]').wait_for(timeout=15000)

    # AC4a: FLOW, not a pointer trap — the composer is on screen, hit-testable
    # (elementFromPoint reaches IT, not an overlay), and disabled WITH ITS REASON.
    overlay = page.evaluate(
        """() => { const w = document.querySelector('[data-testid="demo-wizard"]');
                   const c = document.querySelector('[data-testid="doc-composer"]');
                   const ws = getComputedStyle(w);
                   const cr = c.getBoundingClientRect();
                   const hit = document.elementFromPoint(cr.left + cr.width / 2,
                                                         cr.top + cr.height / 2);
                   return { position: ws.position,
                            composerVisible: cr.width > 0 && cr.height > 0,
                            hitIsComposer: hit === c,
                            composerDisabled: c.disabled,
                            placeholder: c.placeholder,
                            wizardStage: w.dataset.stage }; }""")
    check("AC4a_wizard_is_flow_composer_stated",
          overlay["position"] != "absolute" and overlay["composerVisible"]
          and overlay["hitIsComposer"] and overlay["composerDisabled"]
          and "wizard" in overlay["placeholder"].lower(),
          **overlay)

    # AC4b: the pre-target stage EXPLAINS the missing step form.
    hint = page.locator('[data-testid="wizard-steps-hint"]')
    note = page.locator('[data-testid="wizard-pipeline-note"]').inner_text()
    check("AC4b_steps_stage_hinted",
          overlay["wizardStage"] == "target" and hint.count() == 1
          and "target URL" in hint.inner_text()
          and "governed run" in note and "advanced" in note,
          hint=hint.inner_text(), note=note)
    page.screenshot(path=str(VSHOTS / "ux2-videofb-wizard.png"))

    page.locator('[data-testid="wizard-target"]').fill("https://board.example/")
    check("AC4b_target_unlocks_steps",
          page.locator('[data-testid="demo-wizard"]').get_attribute("data-stage") == "steps"
          and page.locator('[data-testid="wizard-step-subject"]').count() == 1)

    # AC4c: describe-first — no steps pinned, the create is enabled and the
    # body OMITS demo_steps (the governed run authors the spec).
    api_posts.clear()
    create = page.locator('[data-testid="wizard-create"]')
    check("AC4c_describe_first_enabled",
          create.is_enabled() and "authored from your description" in create.inner_text(),
          label=create.inner_text())
    create.click()
    page.wait_for_url("**/video/a-walkthrough-of-the-run-board", timeout=15000)
    doc_posts = [x for x in api_posts if x["url"].endswith("/interactive/api/docs")]
    body = doc_posts[0]["body"] if doc_posts else {}
    check("AC4c_describe_first_body",
          len(doc_posts) == 1 and body.get("kind") == "demo"
          and body.get("url") == "https://board.example/"
          and "demo_steps" not in body
          and "a walkthrough of the run board" in (body.get("brief") or ""),
          body=body)

    browser.close()

# The ONE sanctioned 4xx: the recording-existence probe on the just-created
# (never-recorded) wizard demo — absence IS its honest 404, and the download is
# correctly not offered. Chromium logs that probe as a resource error; it is
# accounted for exactly, and any OTHER 4xx (or console error) still fails.
expected_probe_4xx = [
    u for u in all_4xx
    if "/d/a-walkthrough-of-the-run-board/api/demo/recording/" in u]
unexpected_4xx = [u for u in all_4xx if u not in expected_probe_4xx]
resource_noise = len(unexpected_4xx) == 0
filtered_errors = [
    e for e in console_errors
    if not (resource_noise and e.startswith("Failed to load resource")
            and "404" in e)]
report["steps"]["console"] = {
    "ok": len(filtered_errors) == 0 and len(unexpected_4xx) == 0,
    "errors": filtered_errors[:10], "unexpected_4xx": unexpected_4xx[:10],
    "expected_probe_4xx": expected_probe_4xx[:5]}
report["screenshots"] = [str(VSHOTS / n) for n in
                         ("ux2-videofb-player.png", "ux2-videofb-wizard.png")]
report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
