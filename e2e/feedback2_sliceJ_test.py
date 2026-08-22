#!/usr/bin/env python3
"""
feedback2_sliceJ_test.py — the DES-FEEDBACK-002 slice-J gate: project pivot on
the context header (§4, P1-4), cross-project global search — the palette's
`?` deep mode (§5, P1-5) — and the two gap notes: LiveFeed lines deep-link to
the run (§10.1) and the project dashboard surfaces bound repos (§10.2).
Against the shared frozen-NOW0 W2 fixture with `repo` + `repo_member` on.

The slice DOM ACs, verbatim from §4.4 / §5.5 / §10.1 / §10.2:

  1. inside /p/A/build, clicking [data-testid="project-name"] opens
     [data-testid="project-switcher-list"]; choosing project B navigates to
     /p/B/build (URL asserted — mode verb retained, no artifact segment);
     the same pivot from /p/A/document lands on /p/B/document;
  2. [data-testid="switcher-dashboard-row"] navigates to /p/A; zero network
     requests fire on dropdown open (projects store already warm);
  3. keyboard: the trigger opens on Enter, ArrowDown walks rows with REAL
     focus (EC22), Escape closes and restores focus to the trigger;
  4. typing `?auth` renders [data-testid="search-corpus-label"] naming the
     four searched corpora and the not-searched clause (EC24 — archived runs
     included); run hits whose problem contains "auth" appear accent-marked;
  5. a word from the W2 gated run's prompt returns a gate hit that navigates
     to the run with #gate (observed on the pushState, the slice-H pattern —
     the legacy redirect then rewrites into the shell);
  6. entering search mode fires at most GET /governance/claims (+ /repos on a
     cold palette cache); ten keystrokes fire zero further requests; inside
     /p/A/* the label adds "prompts: this project" and ONE
     GET /projects/A/prompts fires; no request to any /search route EVER;
  7. Cmd+Shift+F opens the palette pre-seeded with `?` (search mode);
  8. every [data-testid="feed-line"] is an <a href> ending with its
     data-run-id (middle-clickable — a real href); clicking navigates;
  9. with the fixture's crew.repo member, [data-testid="dashboard-repos"]
     renders one chip linking to that repo's page; a project without one
     renders no testid at all.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback2-J-crumb-pivot.png     context-header dropdown open inside Build,
                                  current project checked
  feedback2-J-search-corpus.png   search mode with the corpus label and a gate hit
  feedback2-J-dashboard-repos.png dashboard with the bound-repo chip row

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4361),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4361"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. Build + the shared W2 fixture server, repo + repo_member ON ─────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, repo=True, repo_member=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN,
                                     "repo": True, "repo_member": True}

# ── 2. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

TOKEN_PROBE = """() => {
  const resolve = (token) => {
    const el = document.createElement('span');
    el.style.color = `var(${token})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  };
  return { statusGate: resolve('--status-gate'), accent: resolve('--accent'),
           inkMuted: resolve('--ink-muted') };
}"""

SWITCHER_STATE = """() => {
  const list = document.querySelector('[data-testid="project-switcher-list"]');
  const opts = Array.from(document.querySelectorAll('[data-testid="project-switcher-option"]'));
  return {
    listOpen: !!list,
    options: opts.map((o) => o.dataset.projectId),
    checked: opts.filter((o) => o.getAttribute('aria-selected') === 'true')
      .map((o) => o.dataset.projectId),
    checkGlyph: opts.find((o) => o.getAttribute('aria-selected') === 'true')
      ?.textContent?.includes('✓') ?? false,
    unfiledRow: !!document.querySelector('[data-testid="project-switcher-unfiled"]'),
    addRow: !!document.querySelector('[data-testid="project-switcher-add"]'),
    dashRow: document.querySelector('[data-testid="switcher-dashboard-row"]')?.getAttribute('href') ?? null,
  };
}"""

SEARCH_STATE = """() => {
  const label = document.querySelector('[data-testid="search-corpus-label"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="palette-row"]'));
  const notLine = label ? Array.from(label.querySelectorAll('p'))
    .find((p) => (p.textContent ?? '').startsWith('Not searched')) : null;
  return {
    labelText: label?.textContent ?? null,
    notSearchedColor: notLine ? getComputedStyle(notLine).color : null,
    groups: rows.map((r) => r.dataset.group),
    labels: rows.map((r) => r.textContent ?? ''),
    hrefs: rows.map((r) => r.getAttribute('href')),
    inputValue: document.querySelector('[data-testid="palette-input"]')?.value ?? null,
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # The tap: every request the page makes, by API path.
    requests: list[tuple[str, str]] = []

    def on_request(req):
        path = urlparse(req.url).path
        if path.startswith("/api/") or path == "/ws":
            requests.append((req.method, path))

    page.on("request", on_request)

    def gets(path: str) -> int:
        return sum(1 for m, p_ in requests if m == "GET" and p_ == path)

    def foreign(since: int) -> list[tuple[str, str]]:
        """New requests since `since`, minus the app's own cadence (the
        debounced GET /runs reconcile + gate-cache reads and /ws)."""
        return [
            (m, p_) for m, p_ in requests[since:]
            if p_ != "/ws" and not (m == "GET" and p_.startswith("/api/v1/runs"))
        ]

    # ── Scene 1: the crumb pivot inside Build (§4.4 ACs 1–2) ───────────────────
    page.goto(f"{ORIGIN}/p/api-migration/build", wait_until="domcontentloaded")
    page.locator('[data-testid="project-context-header"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1500)  # the surface's own fetch burst settles

    try:
        page.wait_for_function(
            """() => document.fonts.status === 'loaded'
                  && document.fonts.check('12px "Inter"')""",
            timeout=20000,
        )
        fonts_ok = True
    except Exception:
        fonts_ok = False

    before_open = len(requests)
    page.locator('[data-testid="project-name"]').click()
    page.locator('[data-testid="project-switcher-list"]').wait_for(timeout=10000)
    page.wait_for_timeout(700)  # request-settle tick for the tap
    sw = page.evaluate(SWITCHER_STATE)
    dropdown_reqs = foreign(before_open)

    report["steps"]["crumb_opens_zero_requests"] = {
        "ok": all([
            fonts_ok,
            sw["listOpen"],
            "upload-endpoint" in sw["options"],
            # The current project renders checked, with the ✓ (§4.2).
            sw["checked"] == ["api-migration"],
            sw["checkGlyph"],
            # No Unfiled row, no + New project — a pivot, not a binding field.
            not sw["unfiledRow"],
            not sw["addRow"],
            # The dashboard row is a REAL link to /p/api-migration.
            sw["dashRow"] == "/p/api-migration",
            # §4.4: zero requests on dropdown open — the store is warm.
            dropdown_reqs == [],
        ]),
        "web_fonts_loaded": fonts_ok,
        **sw,
        "requests_on_open": dropdown_reqs,
    }

    # ── Capture 1: dropdown open inside Build, current project checked ─────────
    page.screenshot(path=str(VSHOTS / "feedback2-J-crumb-pivot.png"))

    # Choosing project B lands on /p/B/build — mode retained, no artifact.
    page.locator('[data-testid="project-switcher-option"][data-project-id="upload-endpoint"]').click()
    page.wait_for_function(
        "() => window.location.pathname === '/p/upload-endpoint/build'", timeout=10000
    )
    pivot_build = page.evaluate("() => window.location.pathname")

    # The same pivot from Document retains Document.
    page.goto(f"{ORIGIN}/p/api-migration/document", wait_until="domcontentloaded")
    page.locator('[data-testid="project-context-header"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="project-name"]').click()
    page.locator('[data-testid="project-switcher-list"]').wait_for(timeout=10000)
    page.locator('[data-testid="project-switcher-option"][data-project-id="upload-endpoint"]').click()
    page.wait_for_function(
        "() => window.location.pathname === '/p/upload-endpoint/document'", timeout=10000
    )
    pivot_doc = page.evaluate("() => window.location.pathname")

    # The dashboard row navigates to the project dashboard.
    page.locator('[data-testid="project-name"]').click()
    page.locator('[data-testid="switcher-dashboard-row"]').wait_for(timeout=10000)
    page.locator('[data-testid="switcher-dashboard-row"]').click()
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=10000)
    dash_landed = page.evaluate("() => window.location.pathname")

    report["steps"]["pivot_retains_mode"] = {
        "ok": all([
            pivot_build == "/p/upload-endpoint/build",
            pivot_doc == "/p/upload-endpoint/document",
            dash_landed == "/p/upload-endpoint",
        ]),
        "build": pivot_build, "document": pivot_doc, "dashboard": dash_landed,
    }

    # ── Scene 2: keyboard — Enter opens, arrows walk REAL focus, Escape restores
    page.goto(f"{ORIGIN}/p/api-migration/build", wait_until="domcontentloaded")
    page.locator('[data-testid="project-name"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.evaluate("() => document.querySelector('[data-testid=\"project-name\"]').focus()")
    page.keyboard.press("Enter")
    page.locator('[data-testid="project-switcher-list"]').wait_for(timeout=10000)
    page.keyboard.press("ArrowDown")
    kbd_row = page.evaluate(
        """() => ({
             isRow: document.activeElement?.classList?.contains('wk-switcher-row') ?? false,
             projectId: document.activeElement?.dataset?.projectId ?? null,
             outline: document.activeElement
               ? getComputedStyle(document.activeElement).outlineStyle : null,
           })"""
    )
    page.keyboard.press("ArrowDown")
    kbd_row2 = page.evaluate("() => document.activeElement?.dataset?.projectId ?? null")
    page.keyboard.press("Escape")
    kbd_after = page.evaluate(
        """() => ({
             closed: document.querySelector('[data-testid="project-switcher-list"]') === null,
             triggerFocused: document.activeElement?.dataset?.testid === 'project-name',
           })"""
    )
    report["steps"]["switcher_keyboard"] = {
        "ok": all([
            kbd_row["isRow"],
            kbd_row["projectId"] is not None,
            kbd_row2 is not None and kbd_row2 != kbd_row["projectId"],
            kbd_after["closed"],
            kbd_after["triggerFocused"],
        ]),
        "first_row": kbd_row, "second_row": kbd_row2, **kbd_after,
    }

    # ── Scene 3: global search on the home board (§5.5) ────────────────────────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="band-needs-you"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1500)  # board fetch burst + gate-cache reconcile

    claims_before = gets("/api/v1/governance/claims")
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000
    )
    entry_mark = len(requests)
    page.keyboard.type("?auth")
    page.locator('[data-testid="search-corpus-label"]').wait_for(timeout=10000)
    page.wait_for_timeout(700)
    s1 = page.evaluate(SEARCH_STATE)
    tokens = page.evaluate(TOKEN_PROBE)
    entry_reqs = foreign(entry_mark)
    accent_marked = page.evaluate(
        """accent => {
             const row = Array.from(document.querySelectorAll(
               '[data-testid="palette-row"][data-group="search-runs"]'))[0];
             if (!row) return false;
             return Array.from(row.querySelectorAll('span span'))
               .some((s) => getComputedStyle(s).color === accent);
           }""",
        tokens["accent"],
    )

    run_hits = [l for g, l in zip(s1["groups"], s1["labels"]) if g == "search-runs"]
    report["steps"]["search_corpus_label"] = {
        "ok": all([
            s1["labelText"] is not None,
            "Searching: runs (all non-archived) · open gates · decisions (governance claims) · repos"
            in s1["labelText"],
            "Not searched: archived runs, transcripts, historical events —" in s1["labelText"],
            "prompts: this project" not in s1["labelText"],  # not inside a shell
            # EC15/EC24: the honesty clause earns the attention color.
            s1["notSearchedColor"] == tokens["statusGate"],
            # Run hits whose problem contains "auth", accent-marked matches.
            any("migrate the auth tables" in l for l in run_hits),
            any("refactor the auth middleware" in l for l in run_hits),
            accent_marked,
        ]),
        "label": s1["labelText"],
        "not_searched_color": s1["notSearchedColor"],
        "resolved_tokens": tokens,
        "run_hits": run_hits,
        "accent_marked": accent_marked,
    }

    # The [why?] popover states the wire truth.
    page.locator('[data-testid="search-why"]').click()
    why = page.evaluate(
        "() => document.querySelector('[data-testid=\"search-why-popover\"]')?.textContent ?? null"
    )
    report["steps"]["why_popover"] = {
        "ok": why == "The crew daemon has no search index yet; the studio searches what it holds.",
        "text": why,
    }

    # §5.5 budget: entry fired exactly one claims GET (repos was warmed by the
    # palette OPEN — cold cache on this page load — before search mode).
    claims_after_entry = gets("/api/v1/governance/claims")
    keystrokes_mark = len(requests)
    page.keyboard.type(" middleware")  # ten more keystrokes
    page.wait_for_timeout(700)
    keystroke_reqs = foreign(keystrokes_mark)
    report["steps"]["search_budget"] = {
        "ok": all([
            claims_after_entry == claims_before + 1,
            [p_ for _, p_ in entry_reqs if not p_.startswith("/api/v1/governance/claims")] == [],
            keystroke_reqs == [],
        ]),
        "claims_gets_on_entry": claims_after_entry - claims_before,
        "entry_requests": entry_reqs,
        "keystroke_requests": keystroke_reqs,
    }

    # ── A gate hit: a word from the W2 gated run's prompt → run + #gate ────────
    # Tap pushState (the slice-H pattern): the legacy redirect immediately
    # rewrites /runs/:id into the shell, so the #gate intent is observable on
    # the push, and the settled hash still carries it.
    page.evaluate(
        """() => {
             window.__pushed = [];
             const orig = history.pushState.bind(history);
             history.pushState = (s, t, url) => { window.__pushed.push(String(url)); return orig(s, t, url); };
           }"""
    )
    page.locator('[data-testid="palette-input"]').fill("?deck outline")
    page.wait_for_selector('[data-testid="palette-row"][data-group="search-gates"]', timeout=10000)
    s2 = page.evaluate(SEARCH_STATE)
    gate_hrefs = [h for g, h in zip(s2["groups"], s2["hrefs"]) if g == "search-gates"]

    # ── Capture 2: search mode with the corpus label and a gate hit ────────────
    page.screenshot(path=str(VSHOTS / "feedback2-J-search-corpus.png"))

    page.locator('[data-testid="palette-row"][data-group="search-gates"]').first.click()
    page.wait_for_function("() => (window.__pushed ?? []).length > 0", timeout=10000)
    pushed = page.evaluate("() => window.__pushed")
    page.wait_for_timeout(800)
    settled = page.evaluate("() => ({ path: window.location.pathname, hash: window.location.hash })")
    report["steps"]["gate_hit_navigates"] = {
        "ok": all([
            len(gate_hrefs) == 1,
            gate_hrefs[0] == "/runs/r-q3#gate",
            any(u.endswith("/runs/r-q3#gate") for u in pushed),
            "r-q3" in settled["path"],
        ]),
        "gate_hrefs": gate_hrefs,
        "pushed": pushed,
        "settled": settled,
    }

    # ── Scoped prompts inside the shell (§5.5) ─────────────────────────────────
    page.goto(f"{ORIGIN}/p/api-migration/build", wait_until="domcontentloaded")
    page.locator('[data-testid="project-context-header"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1200)
    prompts_before = gets("/api/v1/projects/api-migration/prompts")
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000
    )
    page.keyboard.type("?tables")
    page.locator('[data-testid="search-corpus-label"]').wait_for(timeout=10000)
    page.wait_for_timeout(700)
    s3 = page.evaluate(SEARCH_STATE)
    prompts_after = gets("/api/v1/projects/api-migration/prompts")
    prompt_rows = [h for g, h in zip(s3["groups"], s3["hrefs"]) if g == "search-prompts"]
    report["steps"]["scoped_prompts"] = {
        "ok": all([
            "prompts: this project" in (s3["labelText"] or ""),
            prompts_after == prompts_before + 1,
            len(prompt_rows) == 1,
            prompt_rows[0].endswith("#gate"),
        ]),
        "label": s3["labelText"],
        "prompts_gets": prompts_after - prompts_before,
        "prompt_rows": prompt_rows,
    }
    page.keyboard.press("Escape")
    # The chord below routes through the GLOBAL registry, which yields while the
    # palette input has focus — wait for the close to land first.
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"command-palette\"]') === null",
        timeout=10000,
    )

    # ── Cmd+Shift+F opens pre-seeded with `?` (§5.5 / the §1.2 table) ──────────
    page.keyboard.press("Control+Shift+F")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.locator('[data-testid="search-corpus-label"]').wait_for(timeout=10000)
    seeded = page.evaluate(SEARCH_STATE)
    report["steps"]["cmd_shift_f"] = {
        "ok": seeded["inputValue"] == "?" and seeded["labelText"] is not None,
        "input_value": seeded["inputValue"],
    }
    page.keyboard.press("Escape")

    # ── The invented-wire guard: no /search route EVER fired ───────────────────
    search_requests = [p_ for _, p_ in requests if "/search" in p_]
    report["steps"]["no_search_route"] = {
        "ok": search_requests == [],
        "search_requests": search_requests,
    }

    # ── Scene 4: LiveFeed lines are real links to the run (§10.1) ──────────────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="live-feed"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_function(
        "() => document.querySelectorAll('[data-testid=\"feed-line\"]').length > 0",
        timeout=15000,
    )
    feed = page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid="feed-line"]')).map((l) => ({
             tag: l.tagName,
             runId: l.dataset.runId ?? null,
             href: l.getAttribute('href'),
           }))"""
    )
    feed_ok = len(feed) > 0 and all(
        f["tag"] == "A" and f["href"] is not None and f["runId"] is not None
        and f["href"].endswith("/" + f["runId"])
        for f in feed
    )
    # Clicking a narration line lands on the run view.
    page.locator('[data-testid="feed-line"][data-run-id="r-upload"]').first.click()
    page.wait_for_function(
        "() => window.location.pathname === '/p/upload-endpoint/build/r-upload'", timeout=10000
    )
    feed_landed = page.evaluate("() => window.location.pathname")
    report["steps"]["feed_deep_links"] = {
        "ok": feed_ok and feed_landed == "/p/upload-endpoint/build/r-upload",
        "lines": feed,
        "landed": feed_landed,
    }

    # ── Scene 5: dashboard bound repos (§10.2) ─────────────────────────────────
    # Warm the palette repo cache with a real gesture IN THIS page load, then
    # navigate in-app to the dashboard — the chip resolves the repo NAME from
    # the same cache, zero requests of its own.
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="band-needs-you"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000
    )
    page.wait_for_timeout(600)  # the one GET /repos lands, cache warm
    page.keyboard.type("p: upload")
    page.keyboard.press("Enter")
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=10000)
    repos_mark = len(requests)
    page.locator('[data-testid="dashboard-repos"]').wait_for(timeout=10000)
    page.wait_for_timeout(600)
    chip = page.evaluate(
        """muted => {
             const chips = Array.from(document.querySelectorAll('[data-testid="dashboard-repo"]'));
             return chips.map((c) => ({
               href: c.getAttribute('href'),
               text: c.textContent ?? '',
               color: getComputedStyle(c).color,
             }));
           }""",
        tokens["inkMuted"],
    )
    chip_reqs = [
        (m, p_) for m, p_ in requests[repos_mark:]
        if p_ == "/api/v1/repos"
    ]

    # ── Capture 3: the dashboard with the bound-repo chip row ──────────────────
    page.screenshot(path=str(VSHOTS / "feedback2-J-dashboard-repos.png"))

    # The absence case: q3-review-deck has no crew.repo member.
    page.goto(f"{ORIGIN}/p/q3-review-deck", wait_until="domcontentloaded")
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=30000)
    page.wait_for_timeout(1000)
    absent = page.evaluate(
        "() => document.querySelector('[data-testid=\"dashboard-repos\"]') === null"
    )

    report["steps"]["dashboard_repos"] = {
        "ok": all([
            len(chip) == 1,
            chip[0]["href"] == "/repo-detail/studio-api",
            "studio-api" in chip[0]["text"],
            # Resolved from the warm cache: muted ink, and NO repos GET of its own.
            chip[0]["color"] == tokens["inkMuted"],
            chip_reqs == [],
            absent,
        ]),
        "chips": chip,
        "repo_gets_from_dashboard": chip_reqs,
        "absent_without_member": absent,
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback2-J-crumb-pivot.png"),
    str(VSHOTS / "feedback2-J-search-corpus.png"),
    str(VSHOTS / "feedback2-J-dashboard-repos.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceJ_verdict", f"slice-J assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
