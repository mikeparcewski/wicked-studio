#!/usr/bin/env python3
"""
ux_sliceX_test.py — the DES-UX-001 slice-X gate: act-feedback for export +
theme-learn (§7.2, the campaign's B5 MAJOR — "Clicking HTML export fires the
API call but nothing visible happens at the button… a theme learn from a
trivial URL narrated 'Grabbing the page…' then hung 10+ minutes with no
progress, timeout, or error").

EC37, mechanically enforced: the control you clicked answers — pending,
ready, or failed — WHERE you clicked it.

DOC-FEEDBACK RE-SCOPE (operator round on the doc surface): the click sites
MOVED — export now renders under the chatbox in the right panel's Chat tab,
and the Themes popover became the panel's Theme tab (inline form, no
trigger button). Same testids, same EC37 lifecycle, new geometry; every
scene below drives the same contract at the new sites. The in-flight pulse
that lived on the [Themes] trigger is asserted on the form's own submit
button now.

The §7.2 DOM ACs, verbatim mapping:

  1. clicking an export format renders `[data-testid="export-pending"]` on
     THAT control (the fixture's `export_delay_ms` slows the render so the
     state is witnessable) and resolves to `[data-testid="export-ready"]` —
     a REAL download affordance (an anchor whose same-origin href serves the
     artifact bytes with a Content-Disposition attachment) — at the click
     site. The thread message remains (§4.4): the click site answering never
     replaces the transcript's record.
  2. a refused export (the bridge's real pptx lazy-dependency 400) answers
     at the click site too: the service's install command verbatim in
     `[data-testid="export-hint"]`, with the retriable row re-enabled above.
  3. a theme learn renders `[data-testid="learn-inflight"]` in the Themes
     popover, staging the bridge's OWN status frame ("Grabbing the page…" —
     the announce stream, no new wires) — then resolves to `learn-done` when
     the readback (GET /api/theme/learned, interactive#181) ripens.
  4. a learn the bridge REFUSES (§8.4.1 probe 4's lifecycle truth,
     re-verified at slice time against handlers.js materializeThemeRequested:
     exactly one doc-scoped `status.posted {state:"error", message}`) resolves
     the popover to `learn-error` carrying the bridge's own sentence VERBATIM,
     with a retry — never a timeout shrug when the bridge actually spoke.
  5. on fixture-simulated silence (`learn_silent` — the ack lands, then
     NOTHING: the brief's real failure mode), the wait resolves to
     `[data-testid="learn-timeout"]` with retry within the budget (the
     learnPoll hard cap, ~66s) — never an unresolved "Grabbing…" past it.
     This scene rides the REAL production schedule: no shortened test seam,
     so the rig witnesses the actual bound a user would.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into
e2e/shots/vision/:
  ux-X-export-ready.png   the export box under the chatbox: the clicked HTML
                          control now IS the download (accent anchor), the
                          thread's export message above it.
  ux-X-learn-timeout.png  the Theme tab: the honest timeout copy + Retry
                          after the bounded wait on a silent bridge.

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4388),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.

NOTE scene 5 waits out the real ~66s poll cap — this rig runs ~2 minutes.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4388"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

PID = "scratch"
DOC = "uxr-q3-brief"

# The copy contract (§7.2): the client's honest-timeout sentence — shaped to the
# probe-4 truth that a learn the bridge KNOWS failed reports itself (scene 4),
# so a timeout only ever means silence. Pinned verbatim against ThemesMenu.tsx.
TIMEOUT_COPY = ("The learn did not report back — the bridge may still be "
                "working; retry, or check the thread for progress.")

# The bridge's real pptx lazy-dependency refusal (uxfix_fixture.PPTX_MISSING_ERROR
# mirrors server.js's catch: 400 {error} with pptx.js's install command inside).
PPTX_HINT_FRAGMENT = "pip install python-pptx"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


# ── The same-origin build + the shared W2 fixture ──────────────────────────────
dist = ensure_build(lambda step, why: check(step, False, error=why))
start_server(FEEDBACK_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

# Setup, not the certified journey (slice 6's rig certifies composer-create):
# the doc this slice's controls act on, created on the real create wire.
req = urllib.request.Request(
    f"{ORIGIN}/api/v1/projects/{PID}/interactive/api/docs", method="POST",
    data=json.dumps({"name": DOC, "brief": "Q3 review one-pager"}).encode())
req.add_header("Content-Type", "application/json")
with urllib.request.urlopen(req, timeout=10) as res:
    created = json.loads(res.read())
check("doc_created", created.get("name") == DOC, created=created)

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    def goto_doc() -> None:
        page.goto(f"{ORIGIN}/p/{PID}/document/{DOC}", wait_until="domcontentloaded")
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)

    # ── Scene 1 (AC 1): export answers PENDING then READY at the click site ────
    # Doc-feedback re-scope: the export controls moved UNDER THE CHATBOX in the
    # right panel's Chat tab (operator: "export should move under chat box in
    # right panel") — same testids, same EC37 contract, new click site. The
    # panel is collapsed to its rail by default on a doc route; its own rail
    # tab expands it straight onto Chat (the thread + the export box together —
    # the strip carries no thread-toggle and no export any more).
    set_fixture(ORIGIN, export_delay_ms=1500)
    goto_doc()
    page.locator('[data-testid="panel-rail-tab"][data-tab="chat"]').click()
    page.locator('[data-testid="thread"]').wait_for(timeout=15000)
    page.locator('[data-testid="chat-export"]').wait_for(timeout=15000)
    html_btn = page.locator('[data-testid="export-format"][data-format="html"]')
    html_btn.wait_for(timeout=15000)
    html_btn.click()
    # PENDING lives ON the clicked control — inside the html button, no other.
    page.locator('[data-testid="export-pending"]').wait_for(timeout=5000)
    pending = page.evaluate(
        """() => {
             const pend = document.querySelector('[data-testid="export-pending"]');
             const host = pend?.closest('[data-testid="export-format"]');
             const others = Array.from(
               document.querySelectorAll('[data-testid="export-format"]'))
               .filter(b => b.getAttribute('data-format') !== 'html');
             return { onClickedControl: host?.getAttribute('data-format') === 'html',
                      siblingsHeld: others.length > 0 && others.every(b => b.disabled) };
           }""")
    check("export_pending_at_click_site",
          pending["onClickedControl"] and pending["siblingsHeld"], **pending)

    # READY: the control that was clicked IS the download now — a real anchor.
    ready = page.locator('[data-testid="export-ready"][data-format="html"]')
    ready.wait_for(timeout=15000)
    facts = page.evaluate(
        """() => {
             const a = document.querySelector('[data-testid="export-ready"]');
             // The transcript's record (§4.4): the export lands as an agent message
             // (doc-agent) with its own download affordance — the click site
             // answering never replaces it.
             const inThread = Array.from(
               document.querySelectorAll('[data-testid="doc-agent"]'))
               .some(m => /export ready/i.test(m.textContent || '')
                          && !!m.querySelector('[data-testid="doc-artifact-download"]'));
             return { tag: a?.tagName ?? null, href: a?.getAttribute('href') ?? null,
                      file: a?.getAttribute('download') ?? null,
                      sameOrigin: (a?.href ?? '').startsWith(location.origin),
                      threadMessageRemains: inThread };
           }""")
    check("export_ready_is_real_anchor",
          facts["tag"] == "A" and facts["sameOrigin"]
          and facts["file"] == f"{DOC}_v1.html"
          and facts["threadMessageRemains"], **facts)

    # The affordance is REAL: its href serves the artifact bytes, attachment-framed.
    dl = page.request.get(f"{ORIGIN}{facts['href']}" if facts["href"].startswith("/")
                          else facts["href"])
    check("export_ready_href_serves_bytes",
          dl.status == 200
          and "attachment" in (dl.headers.get("content-disposition") or "")
          and len(dl.body()) > 0,
          status=dl.status, disposition=dl.headers.get("content-disposition"))

    page.screenshot(path=str(VSHOTS / "ux-X-export-ready.png"))

    # ── Scene 2 (AC 2): a refused export answers FAILED at the click site ──────
    # (No wake needed: the click site lives in the panel now, which never
    # auto-hides — only the version band does.)
    set_fixture(ORIGIN, export_delay_ms=0, export_pptx_missing=True)
    page.locator('[data-testid="export-format"][data-format="pptx"]').click()
    hint = page.locator('[data-testid="export-hint"]')
    hint.wait_for(timeout=15000)
    failed = page.evaluate(
        """() => {
             const hint = document.querySelector('[data-testid="export-hint"]');
             const rows = Array.from(
               document.querySelectorAll('[data-testid="export-format"]'));
             return { hint: hint?.textContent ?? null,
                      retriable: rows.length > 0 && rows.every(b => !b.disabled) };
           }""")
    check("export_failed_at_click_site",
          PPTX_HINT_FRAGMENT in (failed["hint"] or "") and failed["retriable"],
          **failed)
    set_fixture(ORIGIN, export_pptx_missing=False)

    # ── Scene 3 (AC 3): learn answers IN-FLIGHT (staged) then DONE ─────────────
    # Doc-feedback re-scope: the Themes popover became the panel's THEME TAB
    # (operator: "Compare & Theme should become tabs on chat panel to right") —
    # the inline host renders the SAME learn form (same testids, same EC37
    # lifecycle) with no [Themes] trigger button; the tab is how it opens. The
    # in-flight state that used to pulse on the trigger now shows on the form's
    # own submit button ("Learning…") — asserted per scene below.
    set_fixture(ORIGIN, learn_delay_s=4)  # long enough to witness the stage line
    page.locator('[data-testid="panel-tab"][data-tab="theme"]').click()
    page.locator('[data-testid="themes-panel"]').wait_for(timeout=15000)
    page.locator('[data-testid="themes-input"]').fill("https://acme.example/brand")
    page.locator('[data-testid="themes-submit"]').click()
    page.locator('[data-testid="learn-inflight"]').wait_for(timeout=10000)
    # Staged progress is the bridge's OWN status frame, no rotating filler. The
    # client's send subject ("Queued — …") renders first; the bridge's frame
    # SUPERSEDES it — wait for that supersession, the thing this AC is about.
    page.wait_for_function(
        """() => /Grabbing the page/.test(
                 document.querySelector('[data-testid="learn-stage"]')?.textContent ?? '')""",
        timeout=15000)
    inflight = page.evaluate(
        """() => ({
             stage: document.querySelector('[data-testid="learn-stage"]')?.textContent ?? null,
             submitLabel: document.querySelector('[data-testid="themes-submit"]')?.textContent ?? null,
             inputHeld: !!document.querySelector('[data-testid="themes-input"]')?.disabled,
           })""")
    check("learn_inflight_stages_bridge_frame",
          "Grabbing the page" in (inflight["stage"] or "")
          and "Learning…" in (inflight["submitLabel"] or "")
          and inflight["inputHeld"], **inflight)

    # DONE: the readback ripening is the one completion truth; the popover says so.
    page.locator('[data-testid="learn-done"]').wait_for(timeout=90000)
    check("learn_done_at_click_site", True)

    # ── Scene 4 (AC 4): a learn the bridge REFUSES answers with ITS sentence ───
    # §8.4.1 probe 4 (re-verified at slice time): one doc-scoped status.posted
    # {state:"error"} — surfaced verbatim, never re-worded into the timeout copy.
    # (No wake: the form lives in the panel's Theme tab, which never auto-hides.)
    page.locator('[data-testid="themes-input"]').fill("http://169.254.169.254/")
    page.locator('[data-testid="themes-submit"]').click()
    err = page.locator('[data-testid="learn-error"]')
    err.wait_for(timeout=15000)
    refusal = page.evaluate(
        """() => ({
             reason: document.querySelector('[data-testid="learn-error"]')?.textContent ?? null,
             retry: !!document.querySelector('[data-testid="learn-retry"]'),
             timedOut: !!document.querySelector('[data-testid="learn-timeout"]'),
           })""")
    check("learn_error_verbatim_with_retry",
          "Couldn't grab that URL" in (refusal["reason"] or "")
          and refusal["retry"] and not refusal["timedOut"], **refusal)

    # ── Scene 5 (AC 5): SILENCE resolves to the honest timeout, in budget ──────
    # learn_silent: the ack lands, then nothing — no status frame, no error, no
    # readback. The client's bounded poll (~66s hard cap, the REAL schedule) is
    # the only thing standing between the user and eternal narration.
    set_fixture(ORIGIN, learn_silent=True, reset_learn=True)
    page.locator('[data-testid="themes-input"]').fill("https://slow.example/never")
    page.locator('[data-testid="themes-submit"]').click()
    page.locator('[data-testid="learn-inflight"]').wait_for(timeout=10000)
    check("silent_learn_shows_inflight_first", True)

    # Within the budget: the poll caps at ~66s — 100s here is the rig's margin,
    # not the promise. Past the cap there must be NO unresolved in-flight state.
    # (The panel never auto-hides, so no strip wake/fade dance before capture.)
    timeout_el = page.locator('[data-testid="learn-timeout"]')
    timeout_el.wait_for(timeout=100000)
    silence = page.evaluate(
        """() => ({
             copy: document.querySelector('[data-testid="learn-timeout"]')?.textContent ?? '',
             retry: !!document.querySelector('[data-testid="learn-retry"]'),
             stillInflight: !!document.querySelector('[data-testid="learn-inflight"]'),
             submitSettled: (document.querySelector('[data-testid="themes-submit"]')
                             ?.textContent ?? '').startsWith('Learn from this'),
           })""")
    check("silence_resolves_to_honest_timeout",
          TIMEOUT_COPY in silence["copy"] and silence["retry"]
          and not silence["stillInflight"] and silence["submitSettled"],
          **silence)

    page.screenshot(path=str(VSHOTS / "ux-X-learn-timeout.png"))

    # The retry is LIVE: with the bridge speaking again, the same control lands
    # the learn — the §3.3 rule that a failure state always carries its own fix.
    set_fixture(ORIGIN, learn_silent=False, reset_learn=True, learn_delay_s=0.75)
    page.locator('[data-testid="learn-retry"]').click()
    page.locator('[data-testid="learn-inflight"]').wait_for(timeout=10000)
    page.locator('[data-testid="learn-done"]').wait_for(timeout=90000)
    check("timeout_retry_is_live", True)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
