#!/usr/bin/env python3
"""
feedback2_sliceH_test.py — the DES-FEEDBACK-002 slice-H gate: keyboard-first
gate triage (§2, P0-2), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py). j/k walk the needs-you cards / the dashboard's gate-inbox
rows, `a` approves through the ONE shared decideGate, `r` opens the inline
reject note whose text rides the POST's `amend`, Enter opens, Escape clears —
all through the slice-G registry, so the typing guard and the paletteOpen
yield hold by construction.

The slice DOM ACs, from §2.6:

  1. pressing `j` sets `[data-kbd-selected="true"]` on the FIRST needs-you card
     and moves DOM focus there; `j` again advances; `k` returns; the walk is
     the band's own render order and CLAMPS at the ends; the ring's computed
     `outline-color` resolves from `var(--accent)` (EC15/EC22);
  2. with the cursor on a simple-gate card, `a` fires `POST /runs/:id/gate`
     `{"approve":true}` exactly once (request tap); the card shows the
     answered state without navigation; a second `a` is dropped;
  3. `r` renders `[data-testid="gate-reject-note"]` focused inside the
     selected card; typing a reason and Enter fires `{approve:false,
     amend:"<reason>"}`; Escape instead restores the chip row, firing nothing;
  4. while the note input is focused, `j`/`a`/`r` insert characters normally
     and move no cursor (the §1.2 typing guard — EC21);
  5. with the palette open, keys belong to the PALETTE (its focused input /
     its arrow selection), and the board cursor does not move;
  6. on a complex-gate card, `a` navigates to the run thread with `#gate` and
     fires no gate POST;
  7. the ProjectDashboard's gate-inbox rows carry the same cursor: `j` selects
     the first row (focus + ring), `a` fires the same POST.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback2-H-triage-cursor.png  needs-you band, SECOND card ring-selected,
                                 hint row visible
  feedback2-H-reject-note.png    inline note open and focused on the selected card

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4360),
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

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4360"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

SIMPLE_PROJECT = "q3-review-deck"   # r-q3 — the fixture's simple gate
SIMPLE_RUN = "r-q3"
COMPLEX_PROJECT = "api-migration"   # r-api — options:null ⇒ complex (§7.11)
COMPLEX_RUN = "r-api"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build ────────────────────────────────────────────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}

# ── 2. The shared W2 fixture server ─────────────────────────────────────────────
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN)  # defaults — the board scenes need no switches
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

TOKEN_PROBE = """() => {
  const el = document.createElement('span');
  el.style.color = 'var(--accent)';
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  return c;
}"""

# The board's cursor state, read straight off the DOM the ACs name.
CURSOR_STATE = """() => {
  const cards = Array.from(document.querySelectorAll(
    '[data-testid="band-needs-you"] [data-testid="project-card"]'));
  const sel = cards.find((c) => c.dataset.kbdSelected === 'true') ?? null;
  return {
    order: cards.map((c) => c.dataset.projectId),
    selected: sel?.dataset?.projectId ?? null,
    focusedItem: document.activeElement?.dataset?.kbdItem ?? null,
    ringColor: sel ? getComputedStyle(sel).outlineColor : null,
    ringStyle: sel ? getComputedStyle(sel).outlineStyle : null,
    hint: !!document.querySelector('[data-testid="triage-hint"]'),
    noteOpen: !!document.querySelector('[data-testid="gate-reject-note"]'),
    noteFocused: document.activeElement?.dataset?.testid === 'gate-reject-note',
  };
}"""


def select_project(page, pid: str, order: list) -> None:
    """Walk the cursor onto `pid` with j presses from a CLEARED cursor."""
    page.keyboard.press("Escape")
    for _ in range(order.index(pid) + 1):
        page.keyboard.press("j")
    page.wait_for_function(
        """(pid) => document.querySelector(
             '[data-kbd-selected="true"]')?.dataset?.projectId === pid""",
        arg=pid, timeout=5000,
    )


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # The tap: every gate decision the page POSTs, path + parsed body.
    gate_posts: list[tuple[str, dict | None]] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "POST" and path.startswith("/api/v1/runs/") and path.endswith("/gate"):
            try:
                body = json.loads(req.post_data or "null")
            except json.JSONDecodeError:
                body = None
            gate_posts.append((path, body))

    page.on("request", on_request)

    # ── Scene 1: the home board — the cursor walk (AC 1) ────────────────────────
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

    accent = page.evaluate(TOKEN_PROBE)
    before = page.evaluate(CURSOR_STATE)
    order = before["order"]
    if len(order) < 2 or SIMPLE_PROJECT not in order or COMPLEX_PROJECT not in order:
        fail("fixture_shape", f"needs-you band lacks the two gated projects: {order}")

    page.keyboard.press("j")
    first = page.evaluate(CURSOR_STATE)
    page.keyboard.press("j")
    second = page.evaluate(CURSOR_STATE)

    # ── Capture 1: second card ring-selected, hint row visible ──────────────────
    page.screenshot(path=str(VSHOTS / "feedback2-H-triage-cursor.png"))

    page.keyboard.press("k")
    back = page.evaluate(CURSOR_STATE)

    # The full walk follows the band's own render order and clamps at the end.
    walked = [back["selected"]]
    for _ in range(len(order) - 1):
        page.keyboard.press("j")
        walked.append(page.evaluate(CURSOR_STATE)["selected"])
    page.keyboard.press("j")  # past the end — must clamp, never wrap
    clamped = page.evaluate(CURSOR_STATE)["selected"]

    page.keyboard.press("Escape")
    cleared = page.evaluate(CURSOR_STATE)

    report["steps"]["cursor_walk"] = {
        "ok": all([
            fonts_ok,
            before["selected"] is None and not before["hint"],
            first["selected"] == order[0],
            first["focusedItem"] == order[0],       # EC22: the cursor is focus
            first["ringColor"] == accent,           # EC15: the ring IS the token
            first["ringStyle"] == "solid",
            first["hint"],                          # §2.5: hint while active
            second["selected"] == order[1],
            second["focusedItem"] == order[1],
            back["selected"] == order[0],
            walked == order,
            clamped == order[-1],
            cleared["selected"] is None and not cleared["hint"],
        ]),
        "band_order": order,
        "accent_resolved": accent,
        "first": {k: first[k] for k in ("selected", "focusedItem", "ringColor", "ringStyle", "hint")},
        "walked": walked,
        "clamped_at": clamped,
        "cleared": cleared["selected"],
    }

    # ── AC 3 (cancel half) + capture 2: r opens the note; Escape fires nothing ──
    select_project(page, SIMPLE_PROJECT, order)
    posts_before = len(gate_posts)
    page.keyboard.press("r")
    page.locator('[data-testid="gate-reject-note"]').wait_for(timeout=5000)
    note_open = page.evaluate(CURSOR_STATE)
    page.screenshot(path=str(VSHOTS / "feedback2-H-reject-note.png"))

    # ── AC 4: the open note is a typing context — j/a/r are just characters ─────
    page.keyboard.type("jar")
    typed = page.evaluate(
        """() => ({
             value: document.querySelector('[data-testid="gate-reject-note"]')?.value ?? null,
             selected: document.querySelector('[data-kbd-selected="true"]')?.dataset?.projectId ?? null,
           })"""
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    note_cancelled = page.evaluate(CURSOR_STATE)

    report["steps"]["reject_note_cancel_and_typing_guard"] = {
        "ok": all([
            note_open["noteOpen"],
            note_open["noteFocused"],                       # focused immediately
            note_open["selected"] == SIMPLE_PROJECT,
            typed["value"] == "jar",                        # the keys became TEXT
            typed["selected"] == SIMPLE_PROJECT,            # …and moved no cursor
            not note_cancelled["noteOpen"],                 # Escape restores the row
            note_cancelled["selected"] == SIMPLE_PROJECT,   # selection survives
            len(gate_posts) == posts_before,                # …and NOTHING fired
        ]),
        "note_open": {k: note_open[k] for k in ("noteOpen", "noteFocused", "selected")},
        "typed": typed,
        "posts_during": gate_posts[posts_before:],
    }

    # ── AC 5: with the palette open, the keyboard belongs to the palette ────────
    page.keyboard.press("Control+k")
    page.locator('[data-testid="command-palette"]').wait_for(timeout=10000)
    PALETTE_SEL = """() => ({
      paletteSel: Array.from(document.querySelectorAll('[data-testid="palette-row"]'))
        .findIndex((r) => r.dataset.selected === 'true'),
      query: document.querySelector('[data-testid="palette-input"]')?.value ?? null,
      boardSel: document.querySelector('[data-kbd-selected="true"]')?.dataset?.projectId ?? null,
    })"""
    page.keyboard.press("ArrowDown")  # moves the PALETTE selection…
    arrowed = page.evaluate(PALETTE_SEL)
    page.keyboard.press("j")          # …and letters are QUERY text, never triage
    typed_palette = page.evaluate(PALETTE_SEL)
    page.keyboard.press("Escape")     # close the palette; focus returns
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"command-palette\"]') === null", timeout=5000
    )
    after_palette = page.evaluate(CURSOR_STATE)
    report["steps"]["palette_owns_the_keyboard"] = {
        "ok": all([
            arrowed["paletteSel"] == 1,                     # arrows move the palette
            arrowed["boardSel"] == SIMPLE_PROJECT,          # board cursor unmoved
            typed_palette["query"] == "j",                  # j is query text
            typed_palette["boardSel"] == SIMPLE_PROJECT,
            after_palette["selected"] == SIMPLE_PROJECT,    # …and still there after
            len(gate_posts) == posts_before,
        ]),
        "arrowed": arrowed,
        "typed": typed_palette,
    }

    # ── AC 2: a approves the simple gate — one POST, no navigation ──────────────
    page.keyboard.press("a")
    page.locator(f'[data-testid="gate-answered-{SIMPLE_RUN}"]').wait_for(timeout=10000)
    page.keyboard.press("a")  # answered — the shared guard drops the second
    page.wait_for_timeout(400)
    approve_posts = gate_posts[posts_before:]
    approve_state = page.evaluate(
        """(run) => ({
             path: window.location.pathname,
             answered: document.querySelector(`[data-testid="gate-answered-${run}"]`)?.textContent ?? null,
           })""",
        SIMPLE_RUN,
    )
    report["steps"]["a_approves_once"] = {
        "ok": all([
            approve_posts == [(f"/api/v1/runs/{SIMPLE_RUN}/gate", {"approve": True})],
            approve_state["path"] == "/",                   # answering never navigates
            approve_state["answered"] is not None
            and "approved" in approve_state["answered"],
        ]),
        "gate_posts": approve_posts,
        **approve_state,
    }

    # ── AC 6: a on the COMPLEX gate opens the thread at #gate, POSTs nothing ────
    posts_before_complex = len(gate_posts)
    select_project(page, COMPLEX_PROJECT, order)
    # Tap the pushState itself: `navigate` pushes `…/build/r-api#gate`, then the
    # thread's SteeringGate CONSUMES the one-shot hash — so the pushed URL, not
    # the settled location.hash, is where the `#gate` intent is observable.
    page.evaluate(
        """() => {
          window.__pushed = [];
          const orig = history.pushState.bind(history);
          history.pushState = (s, t, url) => { window.__pushed.push(String(url)); orig(s, t, url); };
        }"""
    )
    page.keyboard.press("a")
    page.wait_for_function(
        """(args) => window.location.pathname === `/p/${args[0]}/build/${args[1]}`""",
        arg=[COMPLEX_PROJECT, COMPLEX_RUN], timeout=10000,
    )
    pushed = page.evaluate("() => window.__pushed")
    report["steps"]["complex_gate_opens_thread"] = {
        "ok": all([
            gate_posts[posts_before_complex:] == [],
            f"/p/{COMPLEX_PROJECT}/build/{COMPLEX_RUN}#gate" in pushed,
        ]),
        "landed": page.evaluate("() => window.location.pathname + window.location.hash"),
        "pushed": pushed,
        "posts_during": gate_posts[posts_before_complex:],
    }

    # ── Scene 2 (fresh load — fresh stores): r + note + Enter sends the amend ───
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="band-needs-you"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1200)
    order2 = page.evaluate(CURSOR_STATE)["order"]
    select_project(page, SIMPLE_PROJECT, order2)
    posts_before_reject = len(gate_posts)
    page.keyboard.press("r")
    page.locator('[data-testid="gate-reject-note"]').wait_for(timeout=5000)
    page.keyboard.type("needs the Q3 numbers first")
    page.keyboard.press("Enter")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"gate-reject-note\"]') === null", timeout=5000
    )
    page.wait_for_timeout(400)
    reject_posts = gate_posts[posts_before_reject:]
    report["steps"]["r_note_rides_amend"] = {
        "ok": reject_posts == [(
            f"/api/v1/runs/{SIMPLE_RUN}/gate",
            {"approve": False, "amend": "needs the Q3 numbers first"},
        )],
        "gate_posts": reject_posts,
    }

    # Enter opens the selected card (the same target as clicking it).
    page.keyboard.press("Enter")
    page.wait_for_function(
        f"() => window.location.pathname === '/p/{SIMPLE_PROJECT}'", timeout=10000
    )
    report["steps"]["enter_opens_card"] = {
        "ok": True,
        "landed": page.evaluate("() => window.location.pathname"),
    }

    # ── Scene 3 (fresh load): the ProjectDashboard's gate-inbox rows (AC 7) ─────
    page.goto(f"{ORIGIN}/p/{SIMPLE_PROJECT}", wait_until="domcontentloaded")
    page.locator('[data-testid="dashboard-gates"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator(f'[data-testid="gate-approve-{SIMPLE_RUN}"]').wait_for(timeout=30000)
    posts_before_dash = len(gate_posts)
    page.keyboard.press("j")
    dash = page.evaluate(
        """(run) => {
          const row = document.querySelector(`[data-testid="dashboard-gate"][data-run-id="${run}"]`);
          return {
            selected: row?.dataset?.kbdSelected === 'true',
            focusedItem: document.activeElement?.dataset?.kbdItem ?? null,
            ringColor: row ? getComputedStyle(row).outlineColor : null,
          };
        }""",
        SIMPLE_RUN,
    )
    page.keyboard.press("a")
    page.locator(f'[data-testid="gate-answered-{SIMPLE_RUN}"]').wait_for(timeout=10000)
    page.wait_for_timeout(400)
    dash_posts = gate_posts[posts_before_dash:]
    report["steps"]["dashboard_inbox_cursor"] = {
        "ok": all([
            dash["selected"],
            dash["focusedItem"] == SIMPLE_RUN,
            dash["ringColor"] == accent,
            dash_posts == [(f"/api/v1/runs/{SIMPLE_RUN}/gate", {"approve": True})],
            page.evaluate("() => window.location.pathname") == f"/p/{SIMPLE_PROJECT}",
        ]),
        **dash,
        "gate_posts": dash_posts,
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback2-H-triage-cursor.png"),
    str(VSHOTS / "feedback2-H-reject-note.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceH_verdict", f"slice-H assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
