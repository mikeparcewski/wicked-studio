#!/usr/bin/env python3
"""
wave2b_handover_test.py — HANDOVER ON ARRIVAL (studio wave 2b, behaviour 1), as a strip (1440x700).

Operator feedback: the four-column "While you were away" panel pushed every dashboard section off
the page, and its rows were text only. The handover is now ONE fixed-height strip of chips that
never holds the page; each chip does something.

Runs against the shared W2 fixture (uxfix_fixture.py) with the `wave1` + `wave2b` + `handover_many`
corpora. The operator's last visit is seeded 3 hours ago (localStorage, before the app boots).
Since then about three things happened per chip: g1/g2/g3 wait at simple gates, f1/f2/f3 failed,
d1/d2/d3 completed (d3 ran a catalog plan), and the system acted three times (the stall watchdog on
r1, a turn timeout on f2, a delivery on d2 — `GET /audit?since=`).

  1. `/` shows the strip: "Since HH:MM · 3h ago" then the chips — 3 decisions due, 3 broke,
     3 finished, 3 done for you — and Got it. While the audit read is in flight the "done for you"
     chip says it is loading, never "cannot say".
  2. The strip is ONE line (under compact-rail at most two), and the Needs You queue's top is above
     the fold at 1440x700 with the handover showing.
  3. "decisions due" / "broke" scroll to and highlight those rows in the Needs You queue (a folded
     approvals group opens) — the handover never duplicates their Open gate / Retry verbs.
  4. "finished" opens an OVERLAY: every element on the page keeps its position. Each finished run
     has Open, Draft update and (d3, a catalog plan) Reuse as preset. Draft update opens the draft;
     Escape closes the draft first, then the overlay, and focus returns to the chip.
  5. "done for you" opens the same kind of overlay: each action with Open (it has a run) and its
     audit entry. An outside click closes it and focus returns to the chip. Open goes to the run.
  6. Got it clears the handover; a reload keeps it gone.
  7. Clearing by acting: with a 1-per-chip handover (no handover_many), acting on every item —
     Open gate and Retry from the queue, Draft update on the finished run, the audit entry of what
     the system did — clears the handover without Got it.

Capture: e2e/shots/wave2b-handover-desk.png (+ -finished, -done).

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env: FEEDBACK_PORT (default 4346). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4346"))
W, H = int(os.environ.get("HANDOVER_W", "1440")), int(os.environ.get("HANDOVER_H", "700"))
SHOTS = REPO / "e2e" / "shots"
HOUR_MS = 3_600_000

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


CHIPS = """() => [...document.querySelectorAll('[data-testid="handover-chip"]')].map(c => ({
  section: c.dataset.section, count: Number(c.dataset.count), state: c.dataset.state, text: c.innerText}))"""

# Every element worth watching, by a stable key: the page's landmarks plus the strip's own chips.
POSITIONS = """() => {
  const out = {};
  const pick = (key, el) => { if (!el) return; const r = el.getBoundingClientRect();
    out[key] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  pick('strip', document.querySelector('[data-testid="handover-panel"]'));
  pick('queue', document.querySelector('[data-testid="needs-you-queue"]'));
  pick('center', document.querySelector('[data-testid="command-center"]'));
  pick('header', document.querySelector('header'));
  document.querySelectorAll('[data-testid="handover-chip"]').forEach(c => pick('chip:' + c.dataset.section, c));
  document.querySelectorAll('[data-testid="need-row"]').forEach(r => pick('row:' + r.dataset.key, r));
  return out; }"""

REVEALED = """() => [...document.querySelectorAll('[data-reveal="true"]')].map(e => {
  const r = e.getBoundingClientRect();
  return { key: e.dataset.key, inView: r.top >= 0 && r.bottom <= window.innerHeight }; })"""

ACTIVE = """() => { const a = document.activeElement;
  return a ? { testid: a.dataset.testid || null, section: a.dataset.section || null } : null; }"""


def wait_closed(page, step: str) -> None:
    try:
        page.wait_for_function("() => !document.querySelector('[data-testid=\"handover-overlay\"]')", timeout=3000)
    except Exception:
        fail(step, "the overlay stayed open")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SEED_VISIT = (
    "if (!sessionStorage.getItem('w2b.seeded')) { sessionStorage.setItem('w2b.seeded', '1'); "
    f"localStorage.setItem('studio.visit', JSON.stringify({{ lastSeenAt: Date.now() - {3 * HOUR_MS} }})); }}")

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    # The last visit, 3 h ago — seeded ONCE per tab, before the app's first script runs.
    page.add_init_script(SEED_VISIT)

    # The audit read answers only after 4 s: its in-flight state must say "loading",
    # never "this daemon cannot say" (review of #336, item 6).
    # Standing orders on, with none in force: a small header chip, never a row of its own.
    set_fixture(origin, wave1=True, wave2b=True, handover_many=True, simple_gates=["g1", "g2", "g3"],
                gate_now=[], status_over={}, extra_frames=[], audit_delay_ms=4000,
                standing_orders=True, reset_standing=True, standing_seed=[])
    page.goto(f"{origin}/", wait_until="domcontentloaded")
    try:
        page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"wave2b-handover-missing-desk.png"))
        fail("handover-shows", "no handover after a 3 h absence")
    done = page.locator('[data-testid="handover-chip"][data-section="done"]')
    try:
        done.wait_for(state="attached", timeout=5000)
    except Exception:
        fail("chips", {"strip": page.get_by_test_id("handover-panel").inner_text()})
    loading = {"state": done.get_attribute("data-state"), "text": done.inner_text()}
    check("audit-in-flight-says-loading",
          loading["state"] == "loading" and "cannot say" not in loading["text"], **loading)
    try:
        page.wait_for_function(
            """() => { const c = [...document.querySelectorAll('[data-testid="handover-chip"]')];
                       return c.length === 4 && c.every(x => x.dataset.state === 'ready' && Number(x.dataset.count) === 3); }""",
            timeout=10000)
    except Exception:
        fail("chips-3-3-3-3", page.evaluate(CHIPS))
    chips = page.evaluate(CHIPS)
    check("chips-in-order", [c["section"] for c in chips] == ["decisions", "broke", "finished", "done"],
          chips=chips)
    since = page.get_by_test_id("handover-since").inner_text()
    check("since-and-age", since.startswith("Since ") and "3h" in since, since=since)
    check("got-it", page.get_by_test_id("handover-dismiss").inner_text().strip() == "Got it")
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / f"wave2b-handover-desk.png"))

    # ── 2. one line; the queue's top is above the fold ─────────────────────────
    strip = page.get_by_test_id("handover-panel").bounding_box()
    tops = sorted({round(b["y"]) for b in (page.locator('[data-testid="handover-chip"]').nth(i).bounding_box()
                                            for i in range(4))})
    lines = len({t // 12 for t in tops})
    max_lines = 1
    check("strip-is-one-line", lines <= max_lines and strip["height"] <= 44 * max_lines,
          height=strip["height"], chip_tops=tops, lines=lines, max_lines=max_lines)
    queue_box = page.get_by_test_id("needs-you-queue").bounding_box()
    first_row = page.locator('[data-testid="needs-you-queue"] [data-testid="need-row"]').first.bounding_box()
    check("needs-you-above-the-fold",
          queue_box is not None and first_row is not None and first_row["y"] + first_row["height"] <= H,
          queue_top=None if queue_box is None else queue_box["y"],
          first_row_bottom=None if first_row is None else first_row["y"] + first_row["height"], fold=H)
    # 0 orders in force: the orders surface is a chip in the header, not a banner row.
    orders = page.get_by_test_id("standing-orders-panel")
    try:
        orders.wait_for(state="attached", timeout=5000)
    except Exception:
        fail("orders-none-is-a-header-chip", "no standing-orders surface")
    chip = page.evaluate("""() => { const e = document.querySelector('[data-testid="standing-orders-panel"]');
        return { inHeader: !!e.closest('header'), variant: e.dataset.variant, text: e.innerText.replace(/\\s+/g, ' ').trim() }; }""")
    check("orders-none-is-a-header-chip",
          chip["inHeader"] and chip["variant"] == "chip" and chip["text"].startswith("Orders: none")
          and "Mark me away" in chip["text"], **chip)

    # ── 3. decisions due / broke → the queue's rows, highlighted ──────────────
    page.locator('[data-testid="handover-chip"][data-section="decisions"]').click()
    try:
        page.wait_for_function(
            """() => ['gate:g1', 'gate:g2', 'gate:g3'].every(k =>
                 document.querySelector(`[data-queue-item="${k}"][data-reveal="true"]`))""", timeout=4000)
    except Exception:
        fail("decisions-reveal-queue-rows", page.evaluate(REVEALED))
    page.wait_for_timeout(700)  # the smooth scroll settles
    rev = page.evaluate(REVEALED)
    check("decisions-reveal-queue-rows", any(r["inView"] for r in rev) and
          {r["key"] for r in rev} >= {"gate:g1", "gate:g2", "gate:g3"}, revealed=rev)
    check("decisions-not-duplicated", page.locator('[data-testid="handover-overlay"]').count() == 0)
    page.locator('[data-testid="handover-chip"][data-section="broke"]').click()
    try:
        page.wait_for_function(
            """() => ['fail:f1', 'fail:f2', 'fail:f3'].every(k =>
                 document.querySelector(`[data-queue-item="${k}"][data-reveal="true"]`))""", timeout=4000)
    except Exception:
        fail("broke-reveal-queue-rows", page.evaluate(REVEALED))
    page.wait_for_timeout(700)
    rev = page.evaluate(REVEALED)
    check("broke-reveal-queue-rows", any(r["inView"] for r in rev), revealed=rev)
    # The highlight is brief.
    try:
        page.wait_for_function("() => !document.querySelector('[data-reveal=\"true\"]')", timeout=5000)
    except Exception:
        fail("highlight-is-brief", page.evaluate(REVEALED))
    check("highlight-is-brief", True)

    # ── 4. finished → an overlay that shifts nothing ──────────────────────────
    # The page's own scroller (Home's board, or the Desk's under desk) back at the top.
    page.evaluate("() => document.querySelectorAll('[data-place-scroll=\"home-board\"], [data-place-scroll=\"desk\"]')"
                  ".forEach((el) => el.scrollTo(0, 0))")
    page.wait_for_timeout(300)
    before = page.evaluate(POSITIONS)
    page.locator('[data-testid="handover-chip"][data-section="finished"]').click()
    overlay = page.locator('[data-testid="handover-overlay"][data-section="finished"]')
    try:
        overlay.wait_for(state="visible", timeout=3000)
    except Exception:
        fail("finished-overlay", "no overlay")
    try:
        page.wait_for_function(
            "() => document.activeElement?.closest?.('[data-testid=\"handover-overlay\"]') !== null", timeout=1500)
    except Exception:
        fail("focus-moves-into-overlay", page.evaluate(ACTIVE))
    check("focus-moves-into-overlay", True)
    after = page.evaluate(POSITIONS)
    moved = {k: (before[k], after.get(k)) for k in before if before[k] != after.get(k)}
    check("overlay-shifts-nothing", moved == {} and len(before) >= 8, moved=moved, watched=len(before))
    items = page.evaluate("""() => [...document.querySelectorAll('[data-testid="handover-overlay"] [data-testid="handover-item"]')]
        .map(i => ({ run: i.dataset.runId,
                     acts: [...i.querySelectorAll('button, a')].map(b => b.dataset.testid).filter(Boolean) }))""")
    runs = [i["run"] for i in items]
    check("finished-lists-each-run", sorted(runs) == ["d1", "d2", "d3"], items=items)
    ok = all("handover-item-open" in i["acts"] and "handover-item-draft" in i["acts"] for i in items) \
        and "handover-item-reuse" in next(i for i in items if i["run"] == "d3")["acts"]
    check("finished-next-use-actions", ok, items=items)
    page.screenshot(path=str(SHOTS / f"wave2b-handover-finished-desk.png"))
    # Reuse as preset: the save's consequence is said first (the Runs list's model).
    overlay.locator('[data-testid="handover-item"][data-run-id="d3"] [data-testid="handover-item-reuse"]').click()
    try:
        cons = overlay.get_by_test_id("run-reuse-consequence")
        cons.wait_for(state="visible", timeout=3000)
    except Exception:
        fail("reuse-consequence", overlay.inner_text())
    check("reuse-consequence", "understand → build → review" in cons.inner_text(), text=cons.inner_text())
    # Draft update: the outbound draft, nothing sent. Escape closes the draft first, then the overlay.
    overlay.locator('[data-testid="handover-item"][data-run-id="d1"] [data-testid="handover-item-draft"]').click()
    try:
        page.get_by_test_id("outbound-text").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("draft-update-opens", page.locator('[role="dialog"]').all_inner_texts())
    check("draft-update-opens", True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    check("escape-closes-draft-first",
          page.get_by_test_id("outbound-text").count() == 0 and overlay.count() == 1)
    page.keyboard.press("Escape")
    wait_closed(page, "escape-closes-overlay")
    try:
        page.wait_for_function("() => document.activeElement?.dataset?.section === 'finished'", timeout=1500)
    except Exception:
        pass
    focus = page.evaluate(ACTIVE)
    check("escape-returns-focus-to-chip",
          focus == {"testid": "handover-chip", "section": "finished"}, focus=focus)

    # ── 5. done for you → overlay; outside click closes it ────────────────────
    page.locator('[data-testid="handover-chip"][data-section="done"]').click()
    doverlay = page.locator('[data-testid="handover-overlay"][data-section="done"]')
    doverlay.wait_for(state="visible", timeout=3000)
    ditems = page.evaluate("""() => [...document.querySelectorAll('[data-testid="handover-overlay"] [data-testid="handover-item"]')]
        .map(i => ({ run: i.dataset.runId, text: i.innerText,
                     acts: [...i.querySelectorAll('button, a')].map(b => b.dataset.testid).filter(Boolean) }))""")
    check("done-lists-each-action",
          sorted(i["run"] for i in ditems) == ["d2", "f2", "r1"]
          and all("handover-item-open" in i["acts"] and "handover-item-audit" in i["acts"] for i in ditems),
          items=ditems)
    page.screenshot(path=str(SHOTS / f"wave2b-handover-done-desk.png"))
    doverlay.locator('[data-testid="handover-item"][data-run-id="r1"] [data-testid="handover-item-audit"]').click()
    entry = doverlay.get_by_test_id("handover-item-audit-entry")
    entry.wait_for(state="visible", timeout=3000)
    check("audit-entry-shown", "run.stall.escalated" in entry.inner_text() and "crew.stall-watchdog" in entry.inner_text(),
          text=entry.inner_text())
    page.locator("h1").first.click()
    wait_closed(page, "outside-click-closes")
    try:
        page.wait_for_function("() => document.activeElement?.dataset?.section === 'done'", timeout=1500)
    except Exception:
        pass
    focus = page.evaluate(ACTIVE)
    check("outside-click-returns-focus-to-chip", focus == {"testid": "handover-chip", "section": "done"}, focus=focus)
    page.locator('[data-testid="handover-chip"][data-section="done"]').click()
    doverlay.locator('[data-testid="handover-item"][data-run-id="r1"] [data-testid="handover-item-open"]').click()
    try:
        page.wait_for_function("() => window.location.pathname.includes('r1')", timeout=5000)
    except Exception:
        fail("open-goes-to-run", page.evaluate("() => window.location.pathname"))
    check("open-goes-to-run", True, path=page.evaluate("() => window.location.pathname"))
    page.go_back()
    page.get_by_test_id("handover-panel").wait_for(state="visible", timeout=10000)

    # ── 6. Got it; reload: gone until the next absence ────────────────────────
    page.evaluate("() => document.querySelectorAll('[data-place-scroll=\"home-board\"], [data-place-scroll=\"desk\"]')"
                  ".forEach((el) => el.scrollTo(0, 0))")
    with_top = page.get_by_test_id("needs-you-queue").bounding_box()["y"]
    page.get_by_test_id("handover-dismiss").click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"handover-panel\"]')", timeout=3000)
    page.wait_for_timeout(300)
    without_top = page.get_by_test_id("needs-you-queue").bounding_box()["y"]
    # The handover costs the page at most its one line — never a block that grows with its items.
    check("handover-holds-at-most-one-line", with_top - without_top <= (52),
          with_handover=with_top, without=without_top, delta=with_top - without_top)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    check("got-it-stays-gone", page.locator('[data-testid="handover-panel"]').count() == 0)

    # ── 7. acting on every item clears it (1 per chip) ────────────────────────
    set_fixture(origin, wave1=True, wave2b=True, handover_many=False, simple_gates=["g1"],
                gate_now=[], status_over={}, extra_frames=[], audit_delay_ms=0)
    page.evaluate(f"localStorage.setItem('studio.visit', JSON.stringify({{ lastSeenAt: Date.now() - {3 * HOUR_MS} }}))")
    page.goto(f"{origin}/", wait_until="domcontentloaded")
    try:
        page.wait_for_function(
            """() => { const c = [...document.querySelectorAll('[data-testid="handover-chip"]')];
                       return c.length === 4 && c.every(x => x.dataset.state === 'ready' && Number(x.dataset.count) === 1); }""",
            timeout=15000)
    except Exception:
        fail("one-per-chip", page.evaluate(CHIPS))
    home = page.url

    def back_home() -> None:
        page.goto(home, wait_until="domcontentloaded")
        page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)

    for key in ("gate:g1", "fail:f1"):
        page.locator('[data-testid="handover-chip"][data-section="%s"]' % ("decisions" if key.startswith("gate") else "broke")).click()
        row = page.locator(f'[data-queue-item="{key}"]')
        row.wait_for(state="visible", timeout=4000)
        row.locator('[data-testid="need-act"]').first.click()
        page.wait_for_timeout(500)
        back_home()
        check(f"still-open-after-{key}", page.locator('[data-testid="handover-panel"]').count() == 1)
    page.locator('[data-testid="handover-chip"][data-section="finished"]').click()
    page.locator('[data-testid="handover-item"][data-run-id="d1"] [data-testid="handover-item-draft"]').click()
    page.get_by_test_id("outbound-text").wait_for(state="visible", timeout=5000)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    wait_closed(page, "finished-closed")
    check("still-open-with-one-left", page.locator('[data-testid="handover-panel"]').count() == 1)
    page.locator('[data-testid="handover-chip"][data-section="done"]').click()
    page.locator('[data-testid="handover-item"][data-run-id="r1"] [data-testid="handover-item-audit"]').click()
    try:
        page.wait_for_function("() => !document.querySelector('[data-testid=\"handover-panel\"]')", timeout=4000)
    except Exception:
        fail("acted-on-all-clears", page.get_by_test_id("handover-panel").inner_text())
    check("acted-on-all-clears", True)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("needs-you-queue").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(800)
    check("cleared-stays-gone", page.locator('[data-testid="handover-panel"]').count() == 0)

    set_fixture(origin, wave1=False, wave2b=False, handover_many=False, simple_gates=[], status_over={},
                extra_frames=[], audit_delay_ms=0)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
