#!/usr/bin/env python3
"""
ux2_sliceBE_test.py — the DES-UX-002 slice-BE gate (§8.1, the FINAL slice):
CREW-UX-7 adoption + navigation wiring.

CONTEXT CORRECTION applied throughout: the endpoint the doc specs as
"CREW-UX-4" (§7.2) LANDED as CREW-UX-7 (crew#312, live on the daemon):
`PUT /api/v1/runs/:id/guidance {text}` upserts ('' clears, 404 unknown, 8KB
cap named in a 400, response {runId, guidance}); the run DTOs carry
`guidance?: string` ABSENT-when-never-set (api-types 0.9.0 — unpublished on
npm, so the studio types the fields locally; src/api/guidance.ts). And per
slice BD's measurement finding (gateEscalated barely exists on real runs),
the ANY-TIME annotation widget — not the approaching chip — is the operative
entry point this slice wires.

The ACs:

  1. WIRE SHAPE — the fixture mirrors the real wire: the seeded run's DTO
     carries `guidance`; every unseeded run's session has NO `guidance` key
     (absent-when-never-set, confirmed against the live daemon 2026-08-24);
     PUT round-trip: unknown run → 404 "Run not found"; >8192 bytes → a 400
     NAMING the cap; set → echoed on GET; '' → cleared (key drops).
  2. DURABLE PRE-POPULATION — the board widget mounts OPEN with the DTO's
     durable note; NO scope label (nothing is session-scoped); save disarmed.
  3. LABEL HONESTY (EC52 honest split) — an edit raises the label with the
     exact unsaved-edit copy; the durable state never carries it.
  4. SAVE ACTION (EC37) — "save guidance" PUTs {text} once, feedback lands at
     the point of action ("saved — survives this session"), the label retires.
  5. MULTI-SESSION SURVIVAL (the point) — a full reload (fresh stores = a new
     session as far as client state goes) pre-populates from the DTO again.
  6. ROUTES (§5.2/§5.3) — /p/:id/chronicle is a REAL route rendering the
     chronicle; the Runs|Chronicle toggle NAVIGATES (URL flips both ways,
     Back restores); /runs/:id still defaults to the timeline lens (BB pin).
  7. KEYS (§5.4, the one registry) — `u`/`t` switch the run detail's lenses;
     `n` focuses the selected board card's annotation widget; the '?' overlay
     documents all three from the registry itself; board Enter on a card with
     a MOVING run opens that run (the §5.3 timeline entry point).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-BE-durable-guidance.png   the board widget: durable note + saved feedback
  ux-BE-nav-chrome.png         the /p/:id/chronicle route: shell + toggle + chronicle

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 (ensure_build CACHES — delete a stale dist-sameorigin/
when the source changed). Env knobs: FEEDBACK_PORT (default 4412),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
import urllib.error
import urllib.request

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4412"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

CARD = '[data-testid="project-card"][data-project-id="upload-endpoint"]'
WIDGET = f'{CARD} [data-testid="pre-gate-annotate"]'
INPUT = f'{CARD} [data-testid="pre-gate-annotate-input"]'

DURABLE = ("rate-limit by API key, not by IP\n"
           "keep the burst budget tests green")
EDIT_LINE = "\nprefer the token-bucket middleware"

# EC52's honest-split copy — must match src/store/annotations.ts
# DRAFT_SCOPE_LABEL verbatim.
SCOPE_COPY = "unsaved edit — this browser session only until you save guidance."

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


def api_get_runs() -> list:
    with urllib.request.urlopen(f"{ORIGIN}/api/v1/runs", timeout=10) as res:
        return json.loads(res.read())["runs"]


def put_guidance(rid: str, text: str):
    req = urllib.request.Request(
        f"{ORIGIN}/api/v1/runs/{rid}/guidance", method="PUT",
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


# ── 1. Build + fixture: nerve plan on, ONE durable note seeded ─────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, nerve=True, guidance={"r-upload": DURABLE})
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

# ── AC 1a: the DTO echo — present where set, ABSENT where never set ────────────
runs = {r["session"]["id"]: r["session"] for r in api_get_runs()}
check("dto_absent_when_never_set",
      runs["r-upload"].get("guidance") == DURABLE
      and "guidance" not in runs["r-auth"]
      and "guidance" not in runs["r-q3"],
      upload=runs["r-upload"].get("guidance"),
      auth_has_key="guidance" in runs["r-auth"])

# ── AC 1b: the PUT contract round-trip, mirrored verbatim (on r-api) ───────────
code, body = put_guidance("r-nope", "x")
check("put_unknown_run_404", code == 404 and body.get("error") == "Run not found",
      code=code, body=body)
code, body = put_guidance("r-api", "x" * 8193)
check("put_cap_named_400", code == 400 and "8192-byte cap" in body.get("error", ""),
      code=code)
code, body = put_guidance("r-api", "focus the migration on the auth tables")
check("put_upsert_echoes", code == 200
      and body == {"runId": "r-api", "guidance": "focus the migration on the auth tables"},
      body=body)
check("put_lands_on_dto",
      {r["session"]["id"]: r["session"] for r in api_get_runs()}["r-api"].get("guidance")
      == "focus the migration on the auth tables")
code, body = put_guidance("r-api", "")
check("put_empty_clears", code == 200 and body == {"runId": "r-api", "guidance": ""}
      and "guidance" not in {r["session"]["id"]: r["session"] for r in api_get_runs()}["r-api"],
      body=body)

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The PUT tap (AC 4): every guidance write the page fires, with its body.
    guidance_puts: list = []
    page.on("request", lambda r: guidance_puts.append(r.post_data)
            if r.method == "PUT" and r.url.endswith("/runs/r-upload/guidance") else None)

    def load_board() -> None:
        page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
        page.locator('[data-testid="project-board"]').wait_for(timeout=30000)
        page.add_style_tag(content=HIDE_GATE_TOASTS)
        page.locator(CARD).wait_for(timeout=30000)

    load_board()

    # ── AC 2: durable pre-population — open, populated, unlabelled, disarmed ───
    page.locator(WIDGET).wait_for(timeout=15000)
    pre = page.evaluate(
        """(card) => {
          const root = document.querySelector(card);
          const w = root.querySelector('[data-testid="pre-gate-annotate"]');
          const input = root.querySelector('[data-testid="pre-gate-annotate-input"]');
          return {
            open: w?.dataset.open ?? null,
            value: input?.value ?? null,
            label: !!root.querySelector('[data-testid="annotation-scope-label"]'),
            saveDisabled: root.querySelector('[data-testid="save-guidance"]')?.disabled ?? null,
          };
        }""", CARD)
    check("durable_prepopulates_widget",
          pre["open"] == "true" and pre["value"] == DURABLE
          and not pre["label"] and pre["saveDisabled"] is True,
          **pre)

    # ── AC 3: an edit raises the EC52 honest-split label, exact copy ───────────
    page.locator(INPUT).fill(DURABLE + EDIT_LINE)
    label = page.evaluate(
        """(card) => document.querySelector(
             card + ' [data-testid="annotation-scope-label"]')?.textContent ?? null""",
        CARD)
    check("unsaved_edit_labelled", label == SCOPE_COPY, label=label)

    # ── AC 4: the save gesture — ONE PUT {text}, point-of-action feedback,
    #    label retires where durability now holds ────────────────────────────────
    page.locator(f'{CARD} [data-testid="save-guidance"]').click()
    page.wait_for_function(
        """(card) => document.querySelector(
             card + ' [data-testid="guidance-save-state"]')?.dataset.phase === 'saved'""",
        arg=CARD, timeout=10000)
    feedback = page.evaluate(
        """(card) => {
          const root = document.querySelector(card);
          return {
            text: root.querySelector('[data-testid="guidance-save-state"]')?.textContent ?? null,
            label: !!root.querySelector('[data-testid="annotation-scope-label"]'),
            saveDisabled: root.querySelector('[data-testid="save-guidance"]')?.disabled ?? null,
          };
        }""", CARD)
    posts = [json.loads(b) for b in guidance_puts]
    check("save_puts_once_with_text",
          posts == [{"text": DURABLE + EDIT_LINE}], posts=posts)
    check("save_feedback_at_point_of_action",
          feedback["text"] == "saved — survives this session"
          and not feedback["label"] and feedback["saveDisabled"] is True,
          **feedback)
    page.locator(WIDGET).scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path=str(VSHOTS / "ux-BE-durable-guidance.png"))

    # ── AC 5: multi-session survival — a fresh load pre-populates the SAVED
    #    text from the DTO alone (client stores start empty) ────────────────────
    load_board()
    page.locator(WIDGET).wait_for(timeout=15000)
    survived = page.evaluate(
        """(card) => {
          const root = document.querySelector(card);
          return {
            value: root.querySelector('[data-testid="pre-gate-annotate-input"]')?.value ?? null,
            label: !!root.querySelector('[data-testid="annotation-scope-label"]'),
          };
        }""", CARD)
    check("guidance_survives_sessions",
          survived["value"] == DURABLE + EDIT_LINE and not survived["label"],
          **survived)

    # ── AC 7a: `n` — select the widget's card with j, then n focuses the note ──
    selected = None
    for _ in range(20):
        page.keyboard.press("j")
        selected = page.evaluate(
            "() => document.querySelector('[data-kbd-selected]')?.dataset.projectId ?? null")
        if selected == "upload-endpoint":
            break
    check("triage_reaches_widget_card", selected == "upload-endpoint", selected=selected)
    page.keyboard.press("n")
    page.wait_for_function(
        """(card) => document.activeElement === document.querySelector(
             card + ' [data-testid="pre-gate-annotate-input"]')""",
        arg=CARD, timeout=5000)
    check("n_focuses_annotation_widget", True)
    # The overlay documents it from the registry — folded to ONE row (EC42).
    page.evaluate("() => document.activeElement?.blur?.()")
    page.keyboard.press("?")
    page.locator('[data-testid="shortcut-overlay"]').wait_for(timeout=5000)
    gates_text = page.evaluate(
        """() => document.querySelector('[data-testid="shortcut-group-gates"]')
             ?.textContent ?? ''""")
    check("overlay_lists_n_once",
          gates_text.count("Compose a steer note on the selected card") == 1,
          gates=gates_text[:200])
    page.keyboard.press("Escape")

    # ── AC 7b: board Enter on the MOVING-run card opens that run (§5.3) — the
    #    legacy /runs/:id redirect may then rewrite it into the shell ───────────
    page.keyboard.press("Escape")  # clear the triage cursor, then re-walk from the top
    for _ in range(20):
        page.keyboard.press("j")
        if page.evaluate(
                "() => document.querySelector('[data-kbd-selected]')?.dataset.projectId ?? null") \
                == "upload-endpoint":
            break
    page.keyboard.press("Enter")
    page.wait_for_function(
        """() => ['/runs/r-upload/timeline', '/runs/r-upload',
                  '/p/upload-endpoint/build/r-upload'].includes(window.location.pathname)""",
        timeout=15000)
    check("card_enter_opens_moving_run", True,
          landed=page.evaluate("() => window.location.pathname"))

    # ── AC 6 + 7c: run-detail lenses — timeline default (BB pin), u/t keys,
    #    overlay documentation ──────────────────────────────────────────────────
    page.goto(f"{ORIGIN}/runs/r-auth", wait_until="domcontentloaded")
    page.locator('[data-testid="tab-timeline"]').wait_for(timeout=30000)
    check("timeline_stays_default",
          page.evaluate("""() => document.querySelector('[data-testid="tab-timeline"]')
                              ?.getAttribute('aria-selected') === 'true'"""))
    page.keyboard.press("u")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="tab-unit-list"]')
             ?.getAttribute('aria-selected') === 'true'""", timeout=5000)
    page.keyboard.press("t")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="tab-timeline"]')
             ?.getAttribute('aria-selected') === 'true'""", timeout=5000)
    check("t_u_switch_lenses", True)
    page.keyboard.press("?")
    page.locator('[data-testid="shortcut-overlay"]').wait_for(timeout=5000)
    panels_text = page.evaluate(
        """() => document.querySelector('[data-testid="shortcut-group-panels"]')
             ?.textContent ?? ''""")
    check("overlay_lists_t_u",
          "Run detail: show the evidence timeline" in panels_text
          and "Run detail: show the unit list" in panels_text,
          panels=panels_text[:300])
    page.keyboard.press("Escape")

    # ── AC 6: /p/:id/chronicle is a REAL route; the toggle NAVIGATES ───────────
    set_fixture(ORIGIN, chronicle=True, project_dto=True)
    page.goto(f"{ORIGIN}/p/auth-refactor/chronicle", wait_until="domcontentloaded")
    page.locator('[data-testid="work-chronicle"]').wait_for(timeout=30000)
    chron = page.evaluate(
        """() => ({
          path: window.location.pathname,
          chronicleSelected: document.querySelector('[data-testid="build-view-chronicle"]')
            ?.getAttribute('aria-selected') === 'true',
          modeTab: document.querySelector('[data-testid="mode-switcher"] [aria-selected="true"]')
            ?.dataset.mode ?? null,
        })""")
    check("chronicle_route_renders",
          chron["path"] == "/p/auth-refactor/chronicle"
          and chron["chronicleSelected"] and chron["modeTab"] == "build",
          **chron)
    page.screenshot(path=str(VSHOTS / "ux-BE-nav-chrome.png"))
    # The toggle re-points: each segment is a NAVIGATION, so Back restores.
    page.locator('[data-testid="build-view-runs"]').click()
    page.wait_for_function(
        "() => window.location.pathname === '/p/auth-refactor/build'", timeout=10000)
    check("toggle_runs_navigates",
          page.evaluate(
              "() => !document.querySelector('[data-testid=\"work-chronicle\"]')"))
    page.locator('[data-testid="build-view-chronicle"]').click()
    page.wait_for_function(
        "() => window.location.pathname === '/p/auth-refactor/chronicle'", timeout=10000)
    page.locator('[data-testid="work-chronicle"]').wait_for(timeout=10000)
    page.go_back()
    page.wait_for_function(
        "() => window.location.pathname === '/p/auth-refactor/build'", timeout=10000)
    check("toggle_chronicle_navigates_and_back_restores", True)

    browser.close()

# Reset the mutable switches for any rig that shares this port later.
set_fixture(ORIGIN, guidance={}, chronicle=False, project_dto=False, nerve=False)

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
