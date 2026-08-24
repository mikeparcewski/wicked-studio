#!/usr/bin/env python3
"""
uxfix_slice6_test.py — the DES-UXFIX-001 slice-6 gate: Document mode's three-pane
doc→canvas→thread relationship made visible (§2.6, F9) and the "theme library"
pill become an explained **Themes** control (V19), proven in a real browser
against the shared W2 fixture (`uxfix_fixture.py`) extended with the interactive
document surface (preflight/themes/manifest/rendered HTML/create/fork/events,
frames relayed over the same /ws).

Same rig pattern as the slice-1/2/3/4 gates: the shared deterministic fixture
server serves the `dist-sameorigin/` build plus every endpoint the routes read;
no crew daemon is involved anywhere. This rig never flips the fixture switches.

The journey is W3's, driven through the REAL composer on the empty `scratch`
project: create a deck from a brief, watch v1 land, continue with a change,
watch v2 land — then walk the relationship in both directions.

What it asserts (design §4.3, the slice-6 DOM AC — the GEOMETRY half re-scoped
by DES-FEEDBACK-001 §7.3, which made Document mode canvas-first, and AGAIN by
the doc-feedback round, which replaced the thread drawer with the tabbed right
PANEL and slimmed the band to version pills only):
  1. The spine (§2.6 rules 1+2, as re-drawn): the version strip — the SLIM
     band now — floats INSIDE the canvas container over its bottom edge
     (measured from getBoundingClientRect, not inferred), the canvas and the
     OPEN right panel (whose Chat tab holds the thread) are non-overlapping
     siblings in one row, and there is no dead middle column between the
     panes. The spine caption retired with the slim band; Themes and Export
     moved into the panel (the Theme tab; the chat-export box), and the strip
     carries NEITHER any more.
     (The panel is open throughout this journey: it starts on the picker,
     whose empty state points at the thread, and the panel state survives the
     navigation the composer makes.)
  2. Thread tags: each message that produced a version carries
     data-testid="version-marker" with its data-version, reading
     "▤ v<N> landed"; a tag click navigates to that version (?v=N) and the
     strip entry highlights — the thread→strip direction.
  3. The slice-9 regression guard (§7.6): selecting a strip entry swaps the
     canvas to that version AND scrolls/focuses the thread message whose id
     the manifest's meta.sourceMessageId names — the id the CLIENT minted at
     submit, echoed back through the fixture's manifest.
  4. Themes (V19, corrected by issue #65; re-homed by the doc-feedback round):
     the control is the panel's Theme TAB (the [Themes] strip trigger retired
     with the slim band), and opening it reveals the one-line explanation
     ("Borrow a look from a site, PDF, or image.") plus the REAL capability —
     learn a look for THIS document. Submitting a URL rides the corrected wire
     (POST /api/events, theme.requested) and lands as a thread message; there
     is NO theme list, NO picking, NO composer chip. NO data-testid and NO
     copy reading "theme library" anywhere.

Captures (§4.0 contract: 1440x900 viewport, device_scale_factor=1, waits on
data-testid, never a sleep) into e2e/shots/uxfix/ — gitignored evidence:
  uxfix-6-document.png           the three-pane surface, v1+v2 landed (full page)
  uxfix-6-version-crosslink.png  v1 selected: canvas at v1, its message focused
  uxfix-6-themes.png             the Themes panel open, explaining itself
  ../vision/theme-wire-fix-themes-menu.png  the same open panel — issue #65's
                                 corrected-surface evidence, on the vision shelf

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: W2_PORT (default 4334), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    NOW0,
    SHOTS,
    ensure_build,
    start_server,
    wake_strip,
)

W2_PORT = int(os.environ.get("W2_PORT", "4334"))
ORIGIN = f"http://127.0.0.1:{W2_PORT}"
DOC_URL = f"{ORIGIN}/p/scratch/document"
EXPLAINER = "Borrow a look from a site, PDF, or image."

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build (shared with the other uxfix rigs — same dist dir) ─
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server (§4.2 + the slice-6 document surface) ──────
start_server(W2_PORT, dist)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "now0": NOW0}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)

console_errors: list[str] = []


def tap(page):
    """Record the document journey's writes: (method, path, json-body-or-None)."""
    log: list[tuple[str, str, dict | None]] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "POST" and "/interactive/" in path:
            body = None
            if req.post_data:
                try:
                    body = json.loads(req.post_data)
                except ValueError:
                    body = None
            log.append((req.method, path, body))

    page.on("request", on_request)
    return log


with sync_playwright() as p:
    browser = p.chromium.launch()
    # §4.0's capture contract, verbatim: 1440x900, device_scale_factor=1.
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    net = tap(page)
    # EVERY request URL, method-agnostic — the SSRF assertion below needs to see a GET
    # to the target too, which the POST-only tap would miss.
    all_request_urls: list[str] = []
    page.on("request", lambda r: all_request_urls.append(r.url))

    # ── Scene 0: the doc-less mode — empty state points at the thread (§2.6 rule 5) ─
    page.goto(DOC_URL, wait_until="domcontentloaded")
    page.locator('[data-testid="doc-picker-empty"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    empty = page.evaluate(
        """() => ({
             invitesThread: (document.querySelector('[data-testid="doc-picker-empty"]')?.innerText || '')
               .toLowerCase().includes('thread'),
             noStrip: !document.querySelector('[data-testid="version-strip"]'),
             threadUp: !!document.querySelector('[data-testid="doc-composer"]'),
           })"""
    )
    report["steps"]["slice6_empty_state"] = {"ok": all(empty.values()), **empty}

    # ── Scene A: W3 — create from the brief, watch v1 land ────────────────────────
    page.locator('[data-testid="doc-composer"]').fill("Make me a deck for the Q3 review")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="version-entry"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="thread"][data-composer-state="terminal"]').wait_for(timeout=30000)

    # ── Scene B: continue — ONE plain send, the ANSWERER lands v2, everything ─────
    # advances (round-3 J3 re-scope: a plain continue-send no longer forks — the
    # revised version arrives from the service, and NO continuation divider renders;
    # the divider is the explicit-branch gesture's anchor, which this journey never
    # makes).
    page.locator('[data-testid="doc-composer"]').fill("Tighten this headline")
    page.keyboard.press("Enter")
    page.locator('[data-testid="version-marker"][data-version="2"]').wait_for(timeout=30000)
    page.locator('[data-testid="version-entry"][data-version="2"][data-selected="true"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    # The canvas is LOADED (its named loading state has retired) before any capture.
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)
    no_divider = page.evaluate(
        "() => document.querySelectorAll('[data-testid=\"version-divider\"]').length")
    report["steps"]["slice6_plain_send_no_divider"] = {
        "ok": no_divider == 0, "dividers": no_divider,
    }

    # AC 1 — the spine, in the §7.3 canvas-first geometry, RE-SCOPED by the
    # doc-feedback round: the strip (now the SLIM band — version pills only)
    # still floats INSIDE the canvas container over its bottom edge; the canvas
    # and the OPEN right PANEL (which replaced the thread drawer on the doc
    # surface — its Chat tab holds the thread) are non-overlapping siblings in
    # one row (no dead middle column). Themes and Export left the strip for the
    # panel: the Theme tab and the chat-export box under the composer.
    wake_strip(page)  # the strip auto-hides after 3s idle — measure it awake
    spine = page.evaluate(
        """() => {
             const strip = document.querySelector('[data-testid="version-strip"]');
             const container = document.querySelector('[data-testid="document-canvas"]');
             const canvas = document.querySelector('[data-testid="doc-canvas"]');
             const panel = document.querySelector('[data-testid="doc-panel"]');
             const thread = document.querySelector('[data-testid="thread"]');
             const themeTab = document.querySelector('[data-testid="panel-tab"][data-tab="theme"]');
             const exportBox = panel?.querySelector('[data-testid="chat-export"] [data-testid="export-menu"]');
             const sr = strip?.getBoundingClientRect(), cr = container?.getBoundingClientRect();
             const kr = canvas?.getBoundingClientRect(), pr = panel?.getBoundingClientRect();
             return {
               stripVariant: strip?.getAttribute('data-variant'),
               stripInsideCanvasContainer: !!container && container.contains(strip),
               stripOverBottomEdge: !!sr && !!cr && Math.abs(sr.bottom - cr.bottom) < 3
                 && sr.left >= cr.left - 1 && sr.right <= cr.right + 1,
               panelHoldsThread: !!panel && panel.contains(thread),
               canvasBesidePanel: !!kr && !!pr && kr.right <= pr.left + 1
                 && pr.right - pr.left > 300,
               noCaption: !document.querySelector('[data-testid="version-spine-caption"]'),
               themesOffStrip: !!strip && !strip.querySelector('[data-testid="themes-open"]'),
               exportOffStrip: !!strip && !strip.querySelector('[data-testid="export-menu"]'),
               themeTabUp: !!themeTab, exportUnderChatbox: !!exportBox,
               entries: document.querySelectorAll('[data-testid="version-entry"]').length,
             };
           }"""
    )
    report["steps"]["slice6_spine"] = {
        "ok": all([
            spine["stripVariant"] == "slim",
            spine["stripInsideCanvasContainer"], spine["stripOverBottomEdge"],
            spine["panelHoldsThread"], spine["canvasBesidePanel"],
            spine["noCaption"],
            spine["themesOffStrip"], spine["exportOffStrip"],
            spine["themeTabUp"], spine["exportUnderChatbox"],
            spine["entries"] == 2,
        ]),
        **spine,
    }

    # AC 2 — the tags: both landed versions are tagged, legibly, on their messages.
    tags = page.evaluate(
        """() => {
             const tags = Array.from(document.querySelectorAll('[data-testid="version-marker"]'));
             const msgs = Array.from(document.querySelectorAll('[data-testid="doc-message"]'));
             return {
               tagTexts: tags.map(t => t.textContent.trim()),
               tagVersions: tags.map(t => t.getAttribute('data-version')),
               taggedMessageIds: msgs.filter(m => m.hasAttribute('data-version'))
                 .map(m => [m.getAttribute('data-version'), m.getAttribute('data-message-id')]),
             };
           }"""
    )
    report["steps"]["slice6_thread_tags"] = {
        "ok": tags["tagVersions"] == ["1", "2"]
              and tags["tagTexts"] == ["▤ v1 landed", "▤ v2 landed"]
              and len(tags["taggedMessageIds"]) == 2,
        **tags,
    }

    # AC 4 (half) — no spelling of "theme library" anywhere on the surface.
    # Doc-feedback re-scope: the [Themes] strip trigger retired — the control
    # is the panel's Theme TAB now, labeled "Theme" (PANEL_TABS), same ban on
    # the invented "theme library" spelling.
    v19 = page.evaluate(
        """() => ({
             libraryTestids: document.querySelectorAll('[data-testid*="theme-library"]').length,
             libraryCopy: document.body.innerText.toLowerCase().includes('theme library'),
             themesLabel: document.querySelector('[data-testid="panel-tab"][data-tab="theme"]')
               ?.textContent.trim(),
           })"""
    )
    report["steps"]["slice6_v19_rename"] = {
        "ok": v19["libraryTestids"] == 0 and not v19["libraryCopy"] and v19["themesLabel"] == "Theme",
        **v19,
    }

    page.screenshot(path=str(SHOTS / "uxfix-6-document.png"))

    # ── Scene C: the cross-link, BOTH directions ──────────────────────────────────
    # strip → thread (the slice-9 regression guard): selecting v1 swaps the canvas
    # AND focuses the message whose id the manifest's meta.sourceMessageId names.
    v1_msg_id = page.evaluate(
        """() => document.querySelector('[data-testid="doc-message"][data-version="1"]')
                  ?.getAttribute('data-message-id')"""
    )
    wake_strip(page)
    page.locator('[data-testid="version-entry"][data-version="1"] [data-testid="version-select"]').click()
    page.locator('[data-testid="doc-canvas"][data-version="1"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas-loading"]').wait_for(state="detached", timeout=30000)
    strip_to_thread = page.evaluate(
        """() => ({
             url: location.pathname + location.search,
             canvasVersion: document.querySelector('[data-testid="doc-canvas"]')?.getAttribute('data-version'),
             v1Selected: document.querySelector('[data-testid="version-entry"][data-version="1"]')
               ?.getAttribute('data-selected'),
             focusedMessageId: document.activeElement?.getAttribute('data-message-id') || null,
           })"""
    )
    page.screenshot(path=str(SHOTS / "uxfix-6-version-crosslink.png"))
    # Doc-feedback re-scope: the In-thread affordances moved off the band into
    # the panel's Versions tab — open it to read them, then return to Chat (the
    # thread must be visible for the thread→strip direction below).
    page.locator('[data-testid="panel-tab"][data-tab="versions"]').click()
    page.locator('[data-testid="version-detail"]').first.wait_for(timeout=30000)
    in_thread_enabled = page.evaluate(
        """() => { const b = Array.from(document.querySelectorAll('[data-testid="version-scroll"]'));
                   return b.length > 0 && b.every(x => !x.disabled); }""")
    page.locator('[data-testid="panel-tab"][data-tab="chat"]').click()
    report["steps"]["slice6_strip_to_thread"] = {
        "ok": all([
            strip_to_thread["url"].endswith("?v=1"),
            strip_to_thread["canvasVersion"] == "1",
            strip_to_thread["v1Selected"] == "true",
            v1_msg_id is not None and strip_to_thread["focusedMessageId"] == v1_msg_id,
            in_thread_enabled,
        ]),
        "v1_message_id": v1_msg_id,
        "inThreadEnabled": in_thread_enabled,
        **strip_to_thread,
    }

    # thread → strip: clicking a tag navigates to ITS version; the strip follows.
    page.locator('[data-testid="version-marker"][data-version="2"]').click()
    page.locator('[data-testid="version-entry"][data-version="2"][data-selected="true"]').wait_for(timeout=30000)
    page.locator('[data-testid="doc-canvas"][data-version="2"]').wait_for(timeout=30000)
    thread_to_strip = page.evaluate("() => location.pathname + location.search")
    report["steps"]["slice6_thread_to_strip"] = {
        "ok": thread_to_strip.endswith("?v=2"),
        "url": thread_to_strip,
    }

    # ── Scene D: Themes explains itself and offers the REAL capability (#65) ──────
    # No list, no picking: the doc-scoped learn form (the SAME testids the popover
    # carried), hosted inline by the panel's Theme tab since the doc-feedback
    # round; a submit rides the corrected wire — theme.requested over POST
    # /api/events.
    page.locator('[data-testid="panel-tab"][data-tab="theme"]').click()
    page.locator('[data-testid="themes-panel"]').wait_for(timeout=30000)
    page.locator('[data-testid="themes-input"]').wait_for(timeout=30000)
    themes = page.evaluate(
        """expected => {
             const explain = document.querySelector('[data-testid="themes-explanation"]');
             const sticks = document.querySelector('[data-testid="themes-sticks"]');
             return {
               explainText: explain ? explain.textContent.trim() : null,
               explainMatches: !!explain && explain.textContent.trim() === expected,
               saysSticks: !!sticks && /sticks to this document/i.test(sticks.textContent),
               rowCount: document.querySelectorAll('[data-testid="theme-row"]').length,
               chipCount: document.querySelectorAll('[data-chip-kind="theme"]').length,
             };
           }""",
        EXPLAINER,
    )
    page.screenshot(path=str(SHOTS / "uxfix-6-themes.png"))
    # Issue #65's corrected-surface evidence, on the vision shelf beside the
    # /theme-page shot the slice-8 rig captures.
    VSHOTS = SHOTS.parent / "vision"
    VSHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(VSHOTS / "theme-wire-fix-themes-menu.png"))

    # (No wake: the form rides the panel now, which never auto-hides.)
    page.locator('[data-testid="themes-input"]').fill("https://acme.example/brand")
    page.locator('[data-testid="themes-submit"]').click()
    # DES-UX-001 §7.2 (slice X, EC37) SUPERSEDES the close-on-submit here: the popover
    # now STAYS OPEN and answers — in-flight, then done when the readback ripens. The
    # submission is still a MESSAGE (§2.3): the ask lands in the thread verbatim.
    page.locator('[data-testid="learn-inflight"]').wait_for(timeout=30000)
    # The ask lands in the thread, which lives in the KEPT-MOUNTED Chat tab body
    # (display:none while the Theme tab shows) — assert its DOM presence
    # (state="attached"), not visibility; the Chat tab's visible transcript is
    # covered by the scenes that run on it.
    page.locator('[data-testid="doc-message"]',
                 has_text="Learn a theme from https://acme.example/brand") \
        .first.wait_for(state="attached", timeout=30000)
    learned = page.evaluate(
        """() => ({
             askInThread: Array.from(document.querySelectorAll('[data-testid="doc-message"]'))
               .some(m => (m.textContent || '').includes('Learn a theme from https://acme.example/brand')),
             panelAnswers: !!document.querySelector('[data-testid="themes-panel"]'),
             chipCount: document.querySelectorAll('[data-chip-kind="theme"]').length,
           })"""
    )
    page.locator('[data-testid="learn-done"]').wait_for(timeout=90000)
    # The ASYNC guard (issue #65): a link-local source is refused by the SERVICE, in
    # its own status line, arriving over the bus — never an HTTP 4xx on the ack. The
    # fixture emits exactly the frame materializeThemeRequested writes. The panel is
    # still open (slice X) — editing the input starts the fresh ask.
    page.locator('[data-testid="themes-input"]').fill("http://169.254.169.254/")
    page.locator('[data-testid="themes-submit"]').click()
    # Same kept-mounted-but-hidden thread: presence, not visibility.
    page.locator('[data-testid="doc-narration"]', has_text="Couldn't grab that URL") \
        .first.wait_for(state="attached", timeout=30000)
    refusal = page.evaluate(
        """() => {
             const lines = Array.from(document.querySelectorAll('[data-testid="doc-narration"]'))
               .map(n => n.textContent || '');
             return {
               serviceRefusal: lines.find(t => t.includes("Couldn't grab that URL")) || null,
             };
           }"""
    )
    theme_events = [b for (_m, q, b) in net if q.endswith("/api/events")
                    and (b or {}).get("event_type") == "wicked.interactive.theme.requested"]
    ssrf_outbound = [u for u in all_request_urls if "169.254.169.254" in u]
    report["steps"]["slice6_themes"] = {
        "ok": all([
            themes["explainMatches"],
            themes["saysSticks"],
            themes["rowCount"] == 0,          # the invented library's rows are gone
            themes["chipCount"] == 0,
            learned["askInThread"],
            learned["panelAnswers"],  # slice X (§7.2): the popover stays and answers
            learned["chipCount"] == 0,        # no pick, so no chip — ever
            len(theme_events) == 2,           # the good learn + the refused one
            (theme_events[0] or {}).get("payload", {}).get("document_id") not in (None, ""),
            (theme_events[0] or {}).get("payload", {}).get("url") == "https://acme.example/brand",
            (theme_events[1] or {}).get("payload", {}).get("url") == "http://169.254.169.254/",
            # The refusal is the service's own sentence, and the SPA never touched
            # the target — the guard lives (and refuses) server-side.
            refusal["serviceRefusal"] is not None,
            "link-local" in (refusal["serviceRefusal"] or ""),
            ssrf_outbound == [],
        ]),
        **themes, **learned, **refusal,
        "theme_event_bodies": theme_events,
        "spa_requests_to_the_target": ssrf_outbound,
    }

    # ── The wire, as the tap saw it (round-3 J3 re-scope): create carried the
    # anchor; the continue rode the inject event ALONE — NO fork on a plain send
    # (the pre-fix fork-per-send minted a byte-identical version before any work). ─
    creates = [b for (_m, q, b) in net if q.endswith("/interactive/api/docs")]
    forks = [b for (_m, q, b) in net if q.endswith("/api/fork")]
    events = [b for (_m, q, b) in net if q.endswith("/api/events")]
    report["steps"]["slice6_wire"] = {
        "ok": all([
            len(creates) == 1, bool((creates[0] or {}).get("source_message_id")),
            len(forks) == 0,
            any((e or {}).get("event_type") == "wicked.interactive.chat.posted" for e in events),
        ]),
        "create_bodies": creates, "fork_bodies": forks, "event_types":
            [(e or {}).get("event_type") for e in events],
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(SHOTS / "uxfix-6-document.png"),
    str(SHOTS / "uxfix-6-version-crosslink.png"),
    str(SHOTS / "uxfix-6-themes.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("slice6_verdict", f"slice-6 assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
