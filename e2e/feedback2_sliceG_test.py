#!/usr/bin/env python3
"""
feedback2_sliceG_test.py — the DES-FEEDBACK-002 slice-G gate: shortcut registry
+ universal command palette (§1, P0-1), against the shared frozen-NOW0 W2
fixture (uxfix_fixture.py) with the `repo` switch on (so the REPOSITORIES group
has the studio-api entry to list — the §1.4 GET /repos cache has something true
to fetch).

The slice DOM ACs, verbatim from §1.7:

  1. `[data-testid="command-palette"]` is absent until Cmd+K/Ctrl+K or Ctrl+P
     fires; present and focused (activeElement is its input) after;
  2. palette CLOSED + non-terminal run selected: Ctrl+Shift+K cancels (assert
     `POST /runs/:id/cancel`); plain Ctrl+K does NOT cancel — it opens the
     palette (assert no cancel request);
  3. with focus inside an input/textarea, Cmd+K does nothing (typing guard —
     asserted by focusing the chat composer first);
  4. `p:` filters rows to `[data-group="projects"]` only; `run:`, `repo:`, `>`
     likewise; the `[data-testid="palette-row"]` count matches the fixture;
  5. ArrowDown/ArrowUp move `[data-selected="true"]`; Enter on a row navigates
     (assert URL); Escape closes and returns focus;
  6. zero palette-attributable requests on mount; on first OPEN exactly one
     `GET /repos`; a warm cache fetches nothing on reopen;
  7. computed `background` of the overlay and the selected row resolve from
     `var()` token references (EC15).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback2-G-palette-mixed.png   open palette, mixed groups, selection ring
  feedback2-G-palette-verbs.png   `>` prefix, verb list with Cancel run present

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4359),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import urllib.request
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4359"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build ────────────────────────────────────────────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server, repo switch ON ─────────────────────────────
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, repo=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN, "repo": True}

# The fixture's own run count — AC 4's "count matches the fixture" is measured
# against the wire, never hardcoded.
with urllib.request.urlopen(f"{ORIGIN}/api/v1/runs", timeout=10) as res:
    FIXTURE_RUNS = len(json.load(res)["runs"])

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

TOKEN_PROBE = """() => {
  const resolve = (token, prop) => {
    const el = document.createElement('span');
    el.style[prop || 'background'] = `var(${token})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).backgroundColor;
    el.remove();
    return c;
  };
  return { overlay: resolve('--surface-overlay'),
           accentSubtle: resolve('--accent-subtle') };
}"""

PALETTE_STATE = """() => {
  const pal = document.querySelector('[data-testid="command-palette"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="palette-row"]'));
  const sel = rows.findIndex((r) => r.dataset.selected === 'true');
  return {
    present: !!pal,
    inputFocused: document.activeElement?.dataset?.testid === 'palette-input',
    groups: rows.map((r) => r.dataset.group),
    labels: rows.map((r) => r.textContent ?? ''),
    hrefs: rows.map((r) => r.getAttribute('href')),
    selectedIx: sel,
    paletteBg: pal ? getComputedStyle(pal).backgroundColor : null,
    selectedBg: sel >= 0 ? getComputedStyle(rows[sel]).backgroundColor : null,
    selectedOutline: sel >= 0 ? getComputedStyle(rows[sel]).outlineStyle : null,
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

    def repos_gets() -> int:
        return sum(1 for m, p_ in requests if m == "GET" and p_ == "/api/v1/repos")

    def cancel_posts() -> list[str]:
        return [p_ for m, p_ in requests if m == "POST" and p_.endswith("/cancel")]

    # ── Scene 1: the home board — palette absent, corpus loading is the BOARD's ──
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="band-needs-you"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1200)  # let the board's own fetch burst settle

    try:
        page.wait_for_function(
            """() => document.fonts.status === 'loaded'
                  && document.fonts.check('12px "Inter"')""",
            timeout=20000,
        )
        fonts_ok = True
    except Exception:
        fonts_ok = False

    absent_before = page.evaluate(
        "() => document.querySelector('[data-testid=\"command-palette\"]') === null"
    )
    repos_before_open = repos_gets()
    requests_before_open = len(requests)

    # ── AC 1 + 6: Ctrl+K opens; first open fires exactly one GET /repos ─────────
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_timeout(800)  # request-settle tick for the tap
    opened = page.evaluate(PALETTE_STATE)
    tokens = page.evaluate(TOKEN_PROBE)
    new_reqs = requests[requests_before_open:]
    # Attribution: App/board machinery (debounced GET /runs reconciles, gate
    # cache reads, per-project member/doc trickle, /ws) keeps its own cadence —
    # the palette has no code path to any of it; everything else new must be
    # the ONE repo fetch the doc allows on first open.
    palette_reqs = [
        (m, p_) for m, p_ in new_reqs
        if not p_.startswith("/api/v1/runs")
        and not p_.startswith("/api/v1/projects")
        and p_ != "/ws"
    ]

    report["steps"]["open_on_ctrl_k"] = {
        "ok": all([
            fonts_ok,
            absent_before,
            opened["present"],
            opened["inputFocused"],
            opened["selectedIx"] == 0,
            # Mixed groups in §1.3 order, each contiguous.
            [g for i, g in enumerate(opened["groups"]) if i == 0 or opened["groups"][i - 1] != g]
            == ["runs", "projects", "repos", "verbs"],
            # Gates lead the runs group (r-q3 / r-api are the awaiting_human pair).
            "gate" in opened["labels"][0],
            # EC15: overlay + selected row backgrounds ARE the resolved tokens.
            opened["paletteBg"] == tokens["overlay"],
            opened["selectedBg"] == tokens["accentSubtle"],
            opened["selectedOutline"] == "solid",
            # §1.4: exactly one GET /repos on first open, nothing else stolen.
            palette_reqs == [("GET", "/api/v1/repos")],
            repos_gets() == repos_before_open + 1,
        ]),
        "absent_before": absent_before,
        "web_fonts_loaded": fonts_ok,
        **{k: opened[k] for k in ("present", "inputFocused", "selectedIx",
                                  "paletteBg", "selectedBg", "selectedOutline")},
        "group_run": [g for i, g in enumerate(opened["groups"])
                      if i == 0 or opened["groups"][i - 1] != g],
        "first_label": opened["labels"][0] if opened["labels"] else None,
        "resolved_tokens": tokens,
        "palette_requests_on_open": palette_reqs,
    }

    # ── Capture 1: mixed groups, selection ring on row 0 ────────────────────────
    page.screenshot(path=str(VSHOTS / "feedback2-G-palette-mixed.png"))

    # ── AC 5: arrows move the selection ─────────────────────────────────────────
    page.keyboard.press("ArrowDown")
    down = page.evaluate(PALETTE_STATE)
    page.keyboard.press("ArrowUp")
    up = page.evaluate(PALETTE_STATE)
    report["steps"]["arrows_move_selection"] = {
        "ok": down["selectedIx"] == 1 and up["selectedIx"] == 0,
        "after_down": down["selectedIx"],
        "after_up": up["selectedIx"],
    }

    # ── AC 4 + navigation: "p: q3" → projects only, Enter → the q3 dashboard ────
    page.keyboard.type("p: q3")
    scoped = page.evaluate(PALETTE_STATE)
    page.keyboard.press("Enter")
    page.locator('[data-testid="project-dashboard"]').wait_for(timeout=10000)
    landed = page.evaluate("() => window.location.pathname")
    closed_after_enter = page.evaluate(
        "() => document.querySelector('[data-testid=\"command-palette\"]') === null"
    )
    report["steps"]["p_prefix_and_navigate"] = {
        "ok": all([
            len(scoped["groups"]) > 0,
            all(g == "projects" for g in scoped["groups"]),
            "q3-review-deck" in scoped["labels"][0],
            scoped["hrefs"][0] == "/p/q3-review-deck",
            landed == "/p/q3-review-deck",
            closed_after_enter,
        ]),
        "groups": scoped["groups"],
        "first_label": scoped["labels"][0] if scoped["labels"] else None,
        "landed": landed,
        "closed_after_enter": closed_after_enter,
    }

    # ── AC 6 (warm cache) + AC 4 (run:/repo: counts match the fixture) ──────────
    repos_before_reopen = repos_gets()
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000
    )
    page.wait_for_timeout(500)
    page.keyboard.type("run:")
    run_scoped = page.evaluate(PALETTE_STATE)
    for _ in range(4):
        page.keyboard.press("Backspace")
    page.keyboard.type("repo:")
    repo_scoped = page.evaluate(PALETTE_STATE)
    report["steps"]["run_repo_prefixes_warm_cache"] = {
        "ok": all([
            repos_gets() == repos_before_reopen,  # warm cache: nothing at all
            all(g == "runs" for g in run_scoped["groups"]),
            len(run_scoped["groups"]) == FIXTURE_RUNS,
            all(g == "repos" for g in repo_scoped["groups"]),
            len(repo_scoped["groups"]) == 1,
            "studio-api" in repo_scoped["labels"][0],
            repo_scoped["hrefs"][0] == "/repo-detail/studio-api",
        ]),
        "fixture_runs": FIXTURE_RUNS,
        "run_rows": len(run_scoped["groups"]),
        "repo_rows": repo_scoped["labels"],
        "repos_gets_after_reopen": repos_gets(),
    }

    # ── Into a run view via the palette itself: "run: rate" → r-upload ──────────
    for _ in range(5):
        page.keyboard.press("Backspace")
    page.keyboard.type("run: rate")
    page.keyboard.press("Enter")
    # The palette navigates to `/runs/r-upload`; the pre-merge legacy redirect
    # (§1.5, untouched by this slice) immediately rewrites it into the shell.
    page.wait_for_function(
        "() => window.location.pathname === '/p/upload-endpoint/build/r-upload'",
        timeout=10000,
    )

    # ── AC 2: kill-run relocation on the selected non-terminal run ──────────────
    pre_cancels = cancel_posts()
    page.keyboard.press("Control+Shift+K")
    page.wait_for_timeout(600)
    after_shift = {
        "cancels": cancel_posts()[len(pre_cancels):],
        "palette_open": page.evaluate(
            "() => document.querySelector('[data-testid=\"command-palette\"]') !== null"
        ),
    }
    cancels_after_shift = len(cancel_posts())
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000
    )
    page.wait_for_timeout(400)
    plain_k_cancels = len(cancel_posts()) - cancels_after_shift
    report["steps"]["kill_relocated_to_ctrl_shift_k"] = {
        "ok": all([
            after_shift["cancels"] == ["/api/v1/runs/r-upload/cancel"],
            not after_shift["palette_open"],
            plain_k_cancels == 0,
        ]),
        "shift_k_cancels": after_shift["cancels"],
        "palette_open_after_shift_k": after_shift["palette_open"],
        "plain_k_cancels": plain_k_cancels,
    }

    # ── The verb list on a run view: Cancel run present (non-terminal selected) ──
    page.keyboard.type("> ")
    verbs = page.evaluate(PALETTE_STATE)
    verb_names = ["New Build", "New Chat", "New Project", "Toggle Theme",
                  "Open Terminal", "Cancel run"]
    report["steps"]["verb_list"] = {
        "ok": all([
            all(g == "verbs" for g in verbs["groups"]),
            all(any(v in lbl for lbl in verbs["labels"]) for v in verb_names),
        ]),
        "labels": verbs["labels"],
    }

    # ── Capture 2: the `>` prefix with Cancel run present ───────────────────────
    page.screenshot(path=str(VSHOTS / "feedback2-G-palette-verbs.png"))

    # ── AC 5: Escape closes and returns focus ───────────────────────────────────
    page.keyboard.press("Escape")
    escape_state = page.evaluate(
        """() => ({
             closed: document.querySelector('[data-testid="command-palette"]') === null,
             focusReturned: document.activeElement !== null
               && document.activeElement.dataset?.testid !== 'palette-input',
           })"""
    )
    report["steps"]["escape_closes"] = {
        "ok": escape_state["closed"] and escape_state["focusReturned"],
        **escape_state,
    }

    # ── Verb execution E2E: "> New Chat" lands on the group-chat surface ────────
    page.keyboard.press("Control+p")  # the OTHER chord the operator named
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.activeElement?.dataset?.testid === 'palette-input'", timeout=10000
    )
    ctrl_p_opened = True
    page.keyboard.type("> new chat")
    page.keyboard.press("Enter")
    # Inside the shell the verb is PROJECT-SCOPED (§1.3's table): the new chat
    # files into the current project, never a silent unfiled thread.
    try:
        page.wait_for_function(
            "() => window.location.pathname === '/p/upload-endpoint/chat/new'", timeout=10000
        )
    except Exception:
        dump = page.evaluate(
            """() => ({
                 path: window.location.pathname,
                 palette: !!document.querySelector('[data-testid="command-palette"]'),
                 active: document.activeElement?.dataset?.testid
                   ?? document.activeElement?.tagName,
                 value: document.querySelector('[data-testid="palette-input"]')?.value ?? null,
                 rows: Array.from(document.querySelectorAll('[data-testid="palette-row"]'))
                   .map((r) => r.textContent?.slice(0, 40)),
               })"""
        )
        fail("new_chat_verb", f"did not land on the project-scoped chat: {json.dumps(dump)}")
    page.locator("textarea.wk-composer").wait_for(timeout=10000)

    # ── AC 3: the typing guard — Cmd+K inside the chat composer does nothing ────
    page.locator("textarea.wk-composer").click()
    page.keyboard.type("k")
    cancels_before_guard = len(cancel_posts())
    page.keyboard.press("Meta+k")
    page.keyboard.press("Control+k")
    page.wait_for_timeout(400)
    guard = page.evaluate(
        """() => ({
             paletteAbsent: document.querySelector('[data-testid="command-palette"]') === null,
             composerFocused: document.activeElement?.classList?.contains('wk-composer') ?? false,
             composerValue: document.querySelector('textarea.wk-composer')?.value ?? null,
           })"""
    )
    report["steps"]["typing_guard"] = {
        "ok": all([
            ctrl_p_opened,
            guard["paletteAbsent"],
            guard["composerFocused"],
            guard["composerValue"] == "k",
            len(cancel_posts()) == cancels_before_guard,
        ]),
        "ctrl_p_opened": ctrl_p_opened,
        **guard,
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback2-G-palette-mixed.png"),
    str(VSHOTS / "feedback2-G-palette-verbs.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceG_verdict", f"slice-G assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
