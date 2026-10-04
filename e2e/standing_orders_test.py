#!/usr/bin/env python3
"""
standing_orders_test.py — Studio OS behaviour 10: STANDING ORDERS (1440x700).

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` + `wave2b` corpora and
the `standing_orders` surface on. The fixture emulates crew's evaluator (crew's own journey,
wicked-crew tests/standing-orders-journey.test.ts, proves the daemon half): an active approve
order answers a matching open gate and writes crew's `gate.decided` line with the order as actor.

  0. Two orders are already in force: one made at a gate ("make it a rule", idea 8: band 0-19
     unit reviews on alpha) and one trust receipt (idea 13: plan approval of bugfix runs at band
     0-19). Home's header carries ONE orders line ("2 orders active · while away: will approve
     band 0-19 (LOW) unit reviews on alpha; … · Manage · Mark me away") — never a banner row.
     Manage opens an overlay that previews what the Away switch will do BEFORE it is flipped
     ("2 orders active: …; deliver gates always wait") above crew's invariant (no order answers a
     deliver gate or a high-risk plan approval; messages are queued, never sent), and lists both
     orders, each saying its origin.
  1. Manage → type "Auto-approve intake on project alpha" → "Read it back" → the rule is SAID
     BACK in plain words; nothing is stored yet.
  2. Keep it → the order is listed, and the preview now counts 3 orders.
  3. An order that would approve the deliver gate is refused in words and cannot be kept.
  4. Mark yourself away → the intake gate on alpha (g1) clears within 5 s (beta's g2 stays; the
     band-scoped orders never touch the unscored runs).
  5. The handover after the absence: its "done for you" overlay has a "What your standing orders
     did" group listing the order's action, NAMING the order, opening g1.

Capture: e2e/shots/standing-orders-<skin>.png. Skin: STUDIO_SKIN (studio | compact-rail).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4347). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, SKIN_SHELL, STUDIO_SKIN, ensure_build, set_fixture, start_server, wait_for_skin

PORT = int(os.environ.get("FEEDBACK_PORT", "4347"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
HOUR_MS = 3_600_000
ORDER = "Auto-approve intake on project alpha"
# The orders already in force: made at a gate (idea 8) and from the trust receipt (idea 13).
SEED = [
    {"id": "so-1", "text": "Always approve band 0-19 unit reviews on alpha", "createdAt": 1,
     "rule": {"scope": {"kind": "project", "projectId": "alpha"},
              "trigger": {"kind": "gate", "phase": "*", "band": "0-19"},
              "action": "approve", "activeWhen": "always"}},
    {"id": "so-2", "text": "Trust bugfix runs on alpha at band 0-19: skip plan approval (deliver stays manual)",
     "createdAt": 2,
     "rule": {"scope": {"kind": "project", "projectId": "alpha"},
              "trigger": {"kind": "gate", "phase": "plan_approval", "band": "0-19", "preset": "bugfix"},
              "action": "approve", "activeWhen": "always"}},
]

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def run_status(origin: str, rid: str) -> str | None:
    with urllib.request.urlopen(f"{origin}/api/v1/runs") as r:
        body = json.loads(r.read())
    rows = body if isinstance(body, list) else body.get("runs", [])
    row = next((x for x in rows if x["session"]["id"] == rid), None)
    return None if row is None else row["session"]["status"]


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[],
                status_over={}, extra_frames=[], audit_delay_ms=0, standing_orders=True,
                reset_standing=True, standing_seed=SEED, settings_delay_ms=1500)
    page.goto(f"{origin}/", wait_until="domcontentloaded")
    # GET /settings is slowed (settings_delay_ms) so the default skin's first paint is on screen
    # long enough to be read by mistake; every read below waits for this journey's skin first.
    wait_for_skin(page)
    try:
        page.get_by_test_id("standing-orders-panel").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"standing-orders-missing-{STUDIO_SKIN}.png"))
        fail("panel-shows", "no standing-orders panel on Home")
    check("panel-shows", True)

    # ── 0. one line in the header; the Away switch's consequence, before it is flipped ──
    line = page.evaluate("""() => { const e = document.querySelector('[data-testid="standing-orders-panel"]');
        const r = e.getBoundingClientRect();
        return { shell: document.querySelector('[data-shell]')?.getAttribute('data-shell') ?? null,
                 inHeader: !!e.closest('header'), variant: e.dataset.variant, height: r.height,
                 count: e.querySelector('[data-testid="standing-orders-count"]').innerText,
                 summary: e.querySelector('[data-testid="standing-orders-summary"]').textContent,
                 title: e.getAttribute('title') }; }""")
    # The panel read is this skin's: the first paint is the default skin (desk since S15b) until
    # studio.appearance lands, and the Desk's header carries the same panel.
    check("read-under-this-skin", line["shell"] == SKIN_SHELL[STUDIO_SKIN], shell=line["shell"], skin=STUDIO_SKIN)
    check("one-line-in-the-header",
          line["inHeader"] and line["variant"] == "line" and line["height"] <= 32
          and line["count"] == "2 orders active"
          and line["summary"].startswith("while away: will approve band 0-19 (LOW) unit reviews on alpha;")
          and "No order answers a deliver gate" in (line["title"] or ""), **line)
    page.get_by_test_id("standing-orders-toggle").click()
    try:
        page.get_by_test_id("standing-orders-manage").wait_for(state="visible", timeout=3000)
    except Exception:
        fail("manage-overlay", "Manage did not open")
    preview = page.get_by_test_id("standing-orders-preview").inner_text()
    check("away-preview-before-flip",
          preview.startswith("While you are away: 2 orders active: will approve band 0-19 (LOW) unit reviews on alpha;")
          and "will approve the plan of runs from the bugfix preset scoring band 0-19 (LOW) on alpha" in preview
          and preview.endswith("deliver gates always wait")
          and page.get_by_test_id("standing-orders-away").get_attribute("aria-pressed") == "false",
          preview=preview)
    invariant = page.get_by_test_id("standing-orders-invariant").inner_text()
    check("invariant-visible",
          "No order answers a deliver gate or a high-risk plan approval" in invariant
          and "queued, never sent" in invariant, invariant=invariant)
    origins = page.evaluate("""() => [...document.querySelectorAll('[data-testid="standing-order-row"]')]
        .map(r => [r.dataset.origin, r.querySelector('[data-testid="standing-order-origin"]').innerText])""")
    check("gate-and-receipt-orders-in-the-list",
          origins == [["gate", "made at a gate"], ["receipt", "trust receipt"]], origins=origins)
    page.screenshot(path=str(SHOTS / f"standing-orders-preview-{STUDIO_SKIN}.png"))

    # ── 1. words → the rule said back ─────────────────────────────────────────
    page.get_by_test_id("standing-order-input").fill(ORDER)
    page.get_by_test_id("standing-order-parse").click()
    words_el = page.get_by_test_id("standing-order-words")
    try:
        words_el.wait_for(state="visible", timeout=5000)
    except Exception:
        fail("rule-said-back", page.get_by_test_id("standing-orders-manage").inner_text())
    words = words_el.inner_text()
    check("rule-said-back", words == "While you are away: approve the intake gate on project alpha", words=words)
    with urllib.request.urlopen(f"{origin}/api/v1/standing-orders") as r:
        stored = json.loads(r.read())
    check("nothing-stored-before-confirm", [o["id"] for o in stored["orders"]] == ["so-1", "so-2"],
          orders=stored["orders"])

    # ── 2. keep it ───────────────────────────────────────────────────────────
    page.get_by_test_id("standing-order-confirm").click()
    try:
        page.get_by_test_id("standing-order-row").nth(2).wait_for(state="visible", timeout=5000)
    except Exception:
        fail("order-listed", page.get_by_test_id("standing-orders-manage").inner_text())
    mine = page.get_by_test_id("standing-order-row").nth(2)
    check("order-listed", ORDER in mine.inner_text() and mine.get_attribute("data-origin") == "words")
    preview = page.get_by_test_id("standing-orders-preview").inner_text()
    check("preview-counts-the-new-order",
          preview.startswith("While you are away: 3 orders active:") and "will approve the intake gate on alpha" in preview,
          preview=preview)

    # ── 3. the invariant, said ────────────────────────────────────────────────
    page.get_by_test_id("standing-order-input").fill("approve every deliver")
    page.get_by_test_id("standing-order-parse").click()
    refused = page.get_by_test_id("standing-order-refused")
    refused.wait_for(state="visible", timeout=5000)
    check("deliver-refused",
          "deliver gate" in refused.inner_text() and page.get_by_test_id("standing-order-confirm").is_disabled(),
          text=refused.inner_text())
    page.get_by_test_id("standing-order-cancel").click()
    check("g1-still-waiting-while-present", run_status(origin, "g1") == "awaiting_human")
    page.screenshot(path=str(SHOTS / f"standing-orders-{STUDIO_SKIN}.png"))

    # ── 4. away → the intake gate on alpha clears within 5 s ─────────────────
    page.evaluate(f"localStorage.setItem('studio.visit', JSON.stringify({{ lastSeenAt: Date.now() - {HOUR_MS} }}))")
    t0 = time.time()
    page.get_by_test_id("standing-orders-away").click()
    try:
        page.wait_for_function(
            "() => document.querySelector('[data-testid=\"standing-orders-away\"]')?.getAttribute('aria-pressed') === 'true'",
            timeout=5000)
    except Exception:
        fail("away-on", page.get_by_test_id("standing-orders-panel").inner_text())
    cleared = False
    while time.time() - t0 < 5:
        if run_status(origin, "g1") != "awaiting_human":
            cleared = True
            break
        time.sleep(0.2)
    check("intake-gate-cleared-within-5s", cleared, seconds=round(time.time() - t0, 2))
    check("other-project-untouched", run_status(origin, "g2") == "awaiting_human")

    # ── 5. the handover names the order ───────────────────────────────────────
    page.reload(wait_until="domcontentloaded")
    wait_for_skin(page)
    try:
        page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=15000)
        page.wait_for_function(
            """() => { const c = document.querySelector('[data-testid="handover-chip"][data-section="done"]');
                       return c && c.dataset.state === 'ready' && Number(c.dataset.count) >= 1; }""", timeout=10000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"standing-orders-handover-missing-{STUDIO_SKIN}.png"))
        fail("handover", "no handover after the absence")
    page.locator('[data-testid="handover-chip"][data-section="done"]').click()
    group = page.locator('[data-testid="handover-overlay-group"][data-group="orders"]')
    try:
        group.wait_for(state="visible", timeout=3000)
    except Exception:
        fail("handover-says-what-orders-did", page.locator('[data-testid="handover-overlay"]').all_inner_texts())
    rows = page.evaluate("""() => [...document.querySelectorAll(
        '[data-testid="handover-overlay-group"][data-group="orders"] [data-testid="handover-item"]')]
        .map(r => ({ text: r.innerText, href: r.querySelector('[data-testid="handover-item-open"]')?.getAttribute('href') }))""")
    named = [r for r in rows if f'Standing order "{ORDER}" approved a gate for you' in r["text"]]
    check("handover-names-the-order", len(named) == 1 and "g1" in (named[0]["href"] or ""), rows=rows)
    title = group.inner_text()
    check("handover-says-what-orders-did", "what your standing orders did" in title.lower(), title=title)
    page.screenshot(path=str(SHOTS / f"standing-orders-handover-{STUDIO_SKIN}.png"))
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
