#!/usr/bin/env python3
"""
feedback2_sliceL_test.py — the DES-FEEDBACK-002 slice-L gate: desktop
notifications + chime (§8, P2-8) and batch gate resolution (§9, P2-9),
against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py).

The §8.4 DOM ACs (notifications):
  1. on app load with no stored pref: ZERO `Notification.requestPermission`
     calls (EC25 — the API is tapped by an init script BEFORE load);
  2. selecting the desktop option calls `requestPermission` exactly once;
     with the context permission granted, `PUT /settings` fires with the
     `studio.notifications` key (request tap);
  3. with prefs on + permission granted + the document forced hidden, an
     injected `awaitingHuman` frame constructs ONE Notification with
     `tag` = the run id; a REPLAY of the same frame (same run + ord)
     constructs none (the reconnect-replay de-dupe); a LATER gate (new ord)
     constructs one more with the SAME tag (no unbounded stack);
  4. with the tab visible+focused, the same frame constructs zero;
  5. with chime on, the notification path creates an `AudioContext`
     (stub-asserted); the notification click focuses the window and lands on
     the run thread with the one-shot `#gate` intent;
  6. a settings blob without the key yields defaults (Off) — no crash,
     no prompt.

The §9.5 DOM ACs (batch): 3 simple gates in the fixture (`batch_gates`);
cursor + `x` on two renders `[data-testid="batch-bar"]` `data-count="2"`;
Approve all fires exactly two sequential `POST /runs/:id/gate`
`{"approve":true}` bodies in selection order; the complex-gate card renders
`batch-ineligible`, never a checkbox, and cannot enter the selection via `x`;
reject-all with the note "wrong branch" rides `amend` on every reject; a
stubbed 409 leaves `batch-failure-row` naming run + error with retry firing
ONLY that id; Escape clears the selection, fires nothing.

Captures (1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback2-L-notif-settings.png  the /system Notifications group, permission
                                  state line visible
  feedback2-L-batch-bar.png       two gates selected, batch bar docked, the
                                  complex card's ↗ ineligible marker visible

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 (ensure_build CACHES — delete a stale dist-sameorigin/
when the source changed). Env knobs: FEEDBACK_PORT (default 4361),
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

SIMPLE_PROJECT = "q3-review-deck"
SIMPLE_RUN = "r-q3"
COMPLEX_PROJECT = "api-migration"   # r-api — options:null ⇒ complex (§7.11)
BATCH1_PROJECT, BATCH1_RUN = "batch-one", "r-batch1"
BATCH2_RUN = "r-batch2"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build + the shared W2 fixture server ────────────────────
dist = ensure_build(fail)
report["steps"]["build"] = {"ok": True, "dist": str(dist)}
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN)  # defaults
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

# The Notification/AudioContext tap — installed BEFORE any page script (EC25:
# a requestPermission on load would be counted). The context permission is
# granted too, but headless Chromium reports `Notification.permission` as
# 'denied' regardless (notifications never display headless — verified), so
# the tap OWNS the permission state: `perm0` is the scene's starting state and
# the (counted) requestPermission gesture resolves to `grant`.
def notif_tap(perm0: str, grant: str = "granted") -> str:
    return """(() => {
  let perm = '%s';
  window.__reqPermCalls = 0;
  window.__notifs = [];
  window.__notifObjs = [];
  class TapNotification {
    static get permission() { return perm; }
    static requestPermission() {
      window.__reqPermCalls += 1;
      perm = '%s';
      return Promise.resolve(perm);
    }
    constructor(title, opts) {
      this.title = title;
      this.body = opts && opts.body;
      this.tag = opts && opts.tag;
      this.onclick = null;
      this.closed = false;
      window.__notifs.push({ title: this.title, body: this.body, tag: this.tag });
      window.__notifObjs.push(this);
    }
    close() { this.closed = true; }
  }
  window.Notification = TapNotification;
  window.__audioCtxCount = 0;
  window.AudioContext = class {
    constructor() { window.__audioCtxCount += 1; this.currentTime = 0; this.destination = {}; }
    createGain() {
      return { connect: () => {}, gain: {
        setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } };
    }
    createOscillator() {
      return { type: 'sine', frequency: { setValueAtTime: () => {} },
               connect: () => {}, start: () => {}, stop: () => {} };
    }
    close() { return Promise.resolve(); }
  };
})();""" % (perm0, grant)

FORCE_HIDDEN = """(() => {
  Object.defineProperty(Document.prototype, 'visibilityState',
    { configurable: true, get: () => 'hidden' });
  Document.prototype.hasFocus = () => false;
})();"""

FORCE_VISIBLE = """(() => {
  Object.defineProperty(Document.prototype, 'visibilityState',
    { configurable: true, get: () => 'visible' });
  Document.prototype.hasFocus = () => true;
})();"""

NEEDS_YOU_ORDER = """() => Array.from(document.querySelectorAll(
  '[data-testid="band-needs-you"] [data-testid="project-card"]'))
  .map((c) => c.dataset.projectId)"""


def make_gate_tap(page, sink: list) -> None:
    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "POST" and path.startswith("/api/v1/runs/") and path.endswith("/gate"):
            try:
                body = json.loads(req.post_data or "null")
            except json.JSONDecodeError:
                body = None
            sink.append((path, body))
    page.on("request", on_request)


def open_board(page) -> list:
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="band-needs-you"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.wait_for_timeout(1500)  # board fetch burst + membership mirror
    return page.evaluate(NEEDS_YOU_ORDER)


def cursor_to(page, order: list, pid: str, cur: int | None) -> int:
    """Walk the cursor onto `pid` RELATIVELY (never Escape — Escape would clear
    the batch selection, §9.5); returns the new index. `cur=None` = no cursor."""
    target = order.index(pid)
    if cur is None:
        page.keyboard.press("j")  # first press selects the first row (§2.2)
        cur = 0
    key = "j" if target > cur else "k"
    for _ in range(abs(target - cur)):
        page.keyboard.press(key)
    page.wait_for_function(
        """(pid) => document.querySelector('[data-kbd-selected="true"]')?.dataset?.projectId === pid""",
        arg=pid, timeout=5000,
    )
    return target


def select_at(page, order: list, pid: str, cur: int | None) -> int:
    """Cursor onto `pid`, then `x` (the §9.2 toggle)."""
    ix = cursor_to(page, order, pid, cur)
    page.keyboard.press("x")
    return ix


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ════ Scene A: the settings surface — the EC25 gesture (§8.4 ACs 1–2) ═══════
    ctxA = browser.new_context(
        viewport={"width": 1440, "height": 900}, device_scale_factor=1,
        permissions=["notifications"],
    )
    pageA = ctxA.new_page()
    pageA.add_init_script(notif_tap("default"))
    pageA.add_init_script(FORCE_VISIBLE)  # scene A is the visible-tab case
    pageA.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    settings_puts: list = []

    def on_put(req):
        if req.method == "PUT" and urlparse(req.url).path == "/api/v1/settings":
            try:
                settings_puts.append(json.loads(req.post_data or "null"))
            except json.JSONDecodeError:
                settings_puts.append(None)
    pageA.on("request", on_put)

    pageA.goto(f"{ORIGIN}/system", wait_until="domcontentloaded")
    pageA.locator('[data-testid="notif-settings"]').wait_for(timeout=30000)
    pageA.wait_for_timeout(800)  # the startup settings GET settles

    on_load = pageA.evaluate(
        """() => ({
          reqPerm: window.__reqPermCalls,
          notifs: window.__notifs.length,
          offChecked: document.querySelector('[data-testid="notif-off"]')?.checked ?? null,
          desktopChecked: document.querySelector('[data-testid="notif-desktop"]')?.checked ?? null,
          chimeDisabled: document.querySelector('[data-testid="notif-chime"]')?.disabled ?? null,
        })"""
    )
    report["steps"]["ec25_no_prompt_on_load"] = {
        "ok": all([
            on_load["reqPerm"] == 0,          # EC25: NEVER on load
            on_load["notifs"] == 0,
            on_load["offChecked"] is True,    # no stored key ⇒ defaults (Off)
            on_load["desktopChecked"] is False,
            on_load["chimeDisabled"] is True,
        ]),
        **on_load,
    }

    # The gesture: selecting the desktop option prompts ONCE and persists.
    pageA.locator('[data-testid="notif-desktop"]').click()
    pageA.locator('[data-testid="notif-permission"]').wait_for(timeout=10000)
    pageA.wait_for_timeout(900)  # the 400ms persist debounce + wire
    after_toggle = pageA.evaluate(
        """() => ({
          reqPerm: window.__reqPermCalls,
          desktopChecked: document.querySelector('[data-testid="notif-desktop"]')?.checked ?? null,
          permText: document.querySelector('[data-testid="notif-permission"]')?.textContent ?? null,
        })"""
    )
    put_bodies = [b for b in settings_puts if isinstance(b, dict) and "studio.notifications" in b]
    report["steps"]["gesture_prompts_once_and_persists"] = {
        "ok": all([
            after_toggle["reqPerm"] == 1,
            after_toggle["desktopChecked"] is True,
            "granted" in (after_toggle["permText"] or ""),
            len(put_bodies) >= 1,
            put_bodies[-1]["studio.notifications"] == {"desktop": True, "chime": False},
        ]),
        **after_toggle,
        "puts": put_bodies,
    }

    # Chime opt-in rides the same key.
    pageA.locator('[data-testid="notif-chime"]').click()
    pageA.wait_for_timeout(900)
    chime_puts = [b for b in settings_puts if isinstance(b, dict) and "studio.notifications" in b]
    report["steps"]["chime_pref_persists"] = {
        "ok": chime_puts[-1]["studio.notifications"] == {"desktop": True, "chime": True},
        "last_put": chime_puts[-1] if chime_puts else None,
    }

    # ── Capture 1: the settings group with the permission state line ────────────
    pageA.locator('[data-testid="notif-settings"]').scroll_into_view_if_needed()
    pageA.screenshot(path=str(VSHOTS / "feedback2-L-notif-settings.png"))

    # §8.4 AC 4: with the tab VISIBLE+focused, an arriving gate fires nothing.
    posts0 = pageA.evaluate("() => window.__notifs.length")
    set_fixture(ORIGIN, extra_gates=[{"session": "r-api", "ord": 0,
                                      "prompt": "How should the tables move?"}])
    pageA.wait_for_timeout(2500)  # ws tick ≤1s + margin
    report["steps"]["visible_tab_fires_nothing"] = {
        "ok": pageA.evaluate("() => window.__notifs.length") == posts0,
        "count": pageA.evaluate("() => window.__notifs.length"),
    }
    pageA.close()
    ctxA.close()

    # ════ Scene B: the hidden-tab trigger (§8.4 ACs 3+5) ════════════════════════
    # Prefs were persisted by scene A's PUTs; seed explicitly anyway (chime on).
    set_fixture(ORIGIN, notif_prefs={"desktop": True, "chime": True})
    ctxB = browser.new_context(
        viewport={"width": 1440, "height": 900}, device_scale_factor=1,
        permissions=["notifications"],
    )
    pageB = ctxB.new_page()
    pageB.add_init_script(notif_tap("granted"))
    pageB.add_init_script(FORCE_HIDDEN)
    pageB.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    open_board(pageB)

    # One arrival ⇒ ONE notification, tagged with the run id, project in body.
    set_fixture(ORIGIN, extra_gates=[{"session": SIMPLE_RUN, "ord": 0,
                                      "prompt": "Approve the deck outline?"}])
    pageB.wait_for_function("() => window.__notifs.length === 1", timeout=10000)
    first_notif = pageB.evaluate("() => window.__notifs[0]")
    chime_count = pageB.evaluate("() => window.__audioCtxCount")

    # A REPLAY (same run + ord — the reconnect case) must not re-fire.
    set_fixture(ORIGIN, extra_gates=[{"session": SIMPLE_RUN, "ord": 0,
                                      "prompt": "Approve the deck outline?"}])
    pageB.wait_for_timeout(2500)
    after_replay = pageB.evaluate("() => window.__notifs.length")

    # A LATER gate on the same run (new ord) fires again, SAME tag.
    set_fixture(ORIGIN, extra_gates=[{"session": SIMPLE_RUN, "ord": 1,
                                      "prompt": "And the appendix?"}])
    pageB.wait_for_function("() => window.__notifs.length === 2", timeout=10000)
    second_notif = pageB.evaluate("() => window.__notifs[1]")

    report["steps"]["hidden_tab_notification"] = {
        "ok": all([
            first_notif["tag"] == SIMPLE_RUN,
            first_notif["title"] == "Gate needs you",
            "Approve the deck outline?" in (first_notif["body"] or ""),
            SIMPLE_PROJECT in (first_notif["body"] or ""),   # the project name rode the body
            chime_count >= 1,                                 # chime on ⇒ AudioContext
            after_replay == 1,                                # the replay de-duped
            second_notif["tag"] == SIMPLE_RUN,                # same tag — OS collapses
            pageB.evaluate("() => window.__reqPermCalls") == 0,  # EC25 everywhere
        ]),
        "first": first_notif,
        "chime_audio_contexts": chime_count,
        "after_replay": after_replay,
        "second": second_notif,
    }

    # AC 5 (click): focus + land on the run's gate. The `#gate` intent is
    # one-shot (SteeringGate consumes it) — tap pushState like the H rig.
    pageB.evaluate(
        """() => {
          window.__pushed = [];
          const orig = history.pushState.bind(history);
          history.pushState = (s, t, url) => { window.__pushed.push(String(url)); orig(s, t, url); };
          window.__focused = 0;
          window.focus = () => { window.__focused += 1; };
        }"""
    )
    pageB.evaluate("() => { window.__notifObjs[0].onclick(); }")
    pageB.wait_for_function(
        f"""() => window.location.pathname === '/p/{SIMPLE_PROJECT}/build/{SIMPLE_RUN}'""",
        timeout=10000,
    )
    clicked = pageB.evaluate(
        """() => ({ pushed: window.__pushed, focused: window.__focused,
                    closed: window.__notifObjs[0].closed })"""
    )
    # DES-UX-001 slice AC re-scope (§11.2): gate-posture is a LAUNCH-time
    # control with a non-"none" shipped default (§7.8/§13) — the STEER composer
    # this click lands on must not render one (a live run's gate is answered,
    # never re-postured). Re-derived at slice time: the batch-entry assertions
    # below pin POST /runs/:id/gate bodies, which carry no launch posture, so
    # none of them move; this negative pin is the one the flip adds here.
    posture_leak = pageB.evaluate(
        "() => !!document.querySelector('[data-testid=\"gate-posture\"]')")
    report["steps"]["notification_click_lands_on_gate"] = {
        "ok": all([
            clicked["focused"] >= 1,
            f"/p/{SIMPLE_PROJECT}/build/{SIMPLE_RUN}#gate" in clicked["pushed"],
            clicked["closed"] is True,
            not posture_leak,
        ]),
        "gate_posture_absent_on_steer_composer": not posture_leak,
        **clicked,
    }
    pageB.close()
    ctxB.close()

    # ════ Scene C: batch gate resolution (§9.5) ═════════════════════════════════
    set_fixture(ORIGIN, notif_prefs=None, batch_gates=True)
    ctxC = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pageC = ctxC.new_page()
    pageC.add_init_script(notif_tap("denied"))  # inert here; prefs are cleared
    pageC.add_init_script(FORCE_VISIBLE)
    pageC.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    gate_posts: list = []
    make_gate_tap(pageC, gate_posts)

    order = open_board(pageC)
    if not {SIMPLE_PROJECT, COMPLEX_PROJECT, BATCH1_PROJECT, "batch-two"} <= set(order):
        fail("fixture_shape", f"needs-you band lacks the batch corpus: {order}")

    # `x` on two simple-gate cards → the bar with data-count=2; checkboxes
    # render on gate-bearing cards; the complex card gets the ↗ marker only.
    posts_at_select = len(gate_posts)
    cur = select_at(pageC, order, SIMPLE_PROJECT, None)
    cur = select_at(pageC, order, BATCH1_PROJECT, cur)
    pageC.locator('[data-testid="batch-bar"][data-count="2"]').wait_for(timeout=5000)

    # Escape clears the selection and removes the bar, firing nothing (§9.5).
    pageC.keyboard.press("Escape")
    pageC.wait_for_timeout(300)
    escape_state = pageC.evaluate(
        """() => ({ bar: !!document.querySelector('[data-testid="batch-bar"]') })"""
    )
    report["steps"]["escape_clears_selection"] = {
        "ok": escape_state["bar"] is False and len(gate_posts) == posts_at_select,
        **escape_state,
        "posts_during": gate_posts[posts_at_select:],
    }

    cur = select_at(pageC, order, SIMPLE_PROJECT, None)
    cur = select_at(pageC, order, BATCH1_PROJECT, cur)
    pageC.locator('[data-testid="batch-bar"][data-count="2"]').wait_for(timeout=5000)
    cur = select_at(pageC, order, COMPLEX_PROJECT, cur)  # x on complex — must not enter
    pageC.wait_for_timeout(300)
    shape = pageC.evaluate(
        """(args) => {
          const [simpleRun, b1, b2, complexProject] = args;
          const complexCard = document.querySelector(
            `[data-testid="project-card"][data-project-id="${complexProject}"]`);
          return {
            count: document.querySelector('[data-testid="batch-bar"]')?.dataset?.count ?? null,
            cbSimple: document.querySelector(`[data-testid="batch-select-${simpleRun}"]`)?.checked ?? null,
            cbB1: document.querySelector(`[data-testid="batch-select-${b1}"]`)?.checked ?? null,
            cbB2: document.querySelector(`[data-testid="batch-select-${b2}"]`)?.checked ?? null,
            ineligible: !!complexCard?.querySelector('[data-testid="batch-ineligible"]'),
            complexCheckbox: !!complexCard?.querySelector('[data-testid^="batch-select-"]'),
          };
        }""",
        [SIMPLE_RUN, BATCH1_RUN, BATCH2_RUN, COMPLEX_PROJECT],
    )
    report["steps"]["selection_shape"] = {
        "ok": all([
            shape["count"] == "2",            # the complex x was refused
            shape["cbSimple"] is True,
            shape["cbB1"] is True,
            shape["cbB2"] is False,           # visible once ≥1 selected, unchecked
            shape["ineligible"] is True,      # ↗ needs-the-thread marker
            shape["complexCheckbox"] is False,  # NEVER a checkbox (§9.5)
        ]),
        **shape,
    }

    # ── Capture 2: two selected, bar docked, ineligible marker visible ──────────
    pageC.screenshot(path=str(VSHOTS / "feedback2-L-batch-bar.png"))

    # Approve all: exactly two sequential POSTs, selection order, then the bar leaves.
    posts_before = len(gate_posts)
    pageC.locator('[data-testid="batch-approve-all"]').click()
    pageC.wait_for_function(
        "() => document.querySelector('[data-testid=\"batch-bar\"]') === null", timeout=10000
    )
    pageC.wait_for_timeout(300)
    approve_posts = gate_posts[posts_before:]
    report["steps"]["approve_all_fans_out"] = {
        "ok": approve_posts == [
            (f"/api/v1/runs/{SIMPLE_RUN}/gate", {"approve": True}),
            (f"/api/v1/runs/{BATCH1_RUN}/gate", {"approve": True}),
        ],
        "gate_posts": approve_posts,
    }

    # ── Scene C2 (fresh load): the 409 partial failure + retry-only-that-id ─────
    set_fixture(ORIGIN, gate_409=[BATCH1_RUN])
    order2 = open_board(pageC)
    cur = select_at(pageC, order2, SIMPLE_PROJECT, None)
    cur = select_at(pageC, order2, BATCH1_PROJECT, cur)
    pageC.locator('[data-testid="batch-bar"][data-count="2"]').wait_for(timeout=5000)
    posts_before = len(gate_posts)
    pageC.locator('[data-testid="batch-approve-all"]').click()
    pageC.locator(f'[data-testid="batch-failure-row"][data-run-id="{BATCH1_RUN}"]').wait_for(timeout=10000)
    pageC.wait_for_timeout(300)
    failure = pageC.evaluate(
        """(run) => ({
          rows: document.querySelectorAll('[data-testid="batch-failure-row"]').length,
          text: document.querySelector(`[data-testid="batch-failure-row"][data-run-id="${run}"]`)?.textContent ?? '',
          count: document.querySelector('[data-testid="batch-bar"]')?.dataset?.count ?? null,
        })""",
        BATCH1_RUN,
    )
    partial_posts = gate_posts[posts_before:]
    report["steps"]["partial_failure_honesty"] = {
        "ok": all([
            len(partial_posts) == 2,          # both were tried
            failure["rows"] == 1,             # only the 409 id stays listed
            BATCH1_RUN in failure["text"],
            "not awaiting a human gate" in failure["text"],
            failure["count"] == "1",          # the success left the selection
        ]),
        **failure,
        "gate_posts": partial_posts,
    }

    # Retry fires ONLY the failed id (§9.5) — and succeeds once the 409 lifts.
    set_fixture(ORIGIN, gate_409=[])
    posts_before = len(gate_posts)
    pageC.locator(f'[data-testid="batch-retry-{BATCH1_RUN}"]').click()
    pageC.wait_for_function(
        "() => document.querySelector('[data-testid=\"batch-bar\"]') === null", timeout=10000
    )
    pageC.wait_for_timeout(300)
    retry_posts = gate_posts[posts_before:]
    report["steps"]["retry_fires_only_that_id"] = {
        "ok": retry_posts == [(f"/api/v1/runs/{BATCH1_RUN}/gate", {"approve": True})],
        "gate_posts": retry_posts,
    }

    # ── Scene C3 (fresh load): reject-all — ONE bar-level note rides every amend ─
    order3 = open_board(pageC)
    cur = select_at(pageC, order3, SIMPLE_PROJECT, None)
    cur = select_at(pageC, order3, BATCH1_PROJECT, cur)
    pageC.locator('[data-testid="batch-bar"][data-count="2"]').wait_for(timeout=5000)
    posts_before = len(gate_posts)
    pageC.locator('[data-testid="batch-reject-all"]').click()
    pageC.locator('[data-testid="batch-reject-note"]').wait_for(timeout=5000)
    pageC.keyboard.type("wrong branch")
    pageC.keyboard.press("Enter")
    pageC.wait_for_function(
        "() => document.querySelector('[data-testid=\"batch-bar\"]') === null", timeout=10000
    )
    pageC.wait_for_timeout(300)
    reject_posts = gate_posts[posts_before:]
    report["steps"]["reject_all_rides_amend"] = {
        "ok": reject_posts == [
            (f"/api/v1/runs/{SIMPLE_RUN}/gate", {"approve": False, "amend": "wrong branch"}),
            (f"/api/v1/runs/{BATCH1_RUN}/gate", {"approve": False, "amend": "wrong branch"}),
        ],
        "gate_posts": reject_posts,
    }

    # ── Scene C4: the dashboard's gate-inbox rows carry the same selection ──────
    pageC.goto(f"{ORIGIN}/p/{SIMPLE_PROJECT}", wait_until="domcontentloaded")
    pageC.locator('[data-testid="dashboard-gates"]').wait_for(timeout=30000)
    pageC.add_style_tag(content=HIDE_GATE_TOASTS)
    pageC.wait_for_timeout(1000)
    pageC.keyboard.press("j")
    pageC.keyboard.press("x")
    pageC.locator('[data-testid="batch-bar"][data-count="1"]').wait_for(timeout=5000)
    dash_cb = pageC.evaluate(
        f"""() => document.querySelector('[data-testid="batch-select-{SIMPLE_RUN}"]')?.checked ?? null"""
    )
    posts_before = len(gate_posts)
    pageC.keyboard.press("Escape")
    pageC.wait_for_timeout(300)
    report["steps"]["dashboard_inbox_selection"] = {
        "ok": all([
            dash_cb is True,
            pageC.evaluate("() => !document.querySelector('[data-testid=\"batch-bar\"]')"),
            len(gate_posts) == posts_before,
        ]),
        "checkbox": dash_cb,
    }

    pageC.close()
    ctxC.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback2-L-notif-settings.png"),
    str(VSHOTS / "feedback2-L-batch-bar.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceL_verdict", f"slice-L assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
