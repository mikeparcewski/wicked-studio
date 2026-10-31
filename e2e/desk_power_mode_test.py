#!/usr/bin/env python3
"""
desk_power_mode_test.py — power mode on the run page (program DES-POWER-MODE; mockup design/mockups/power-mode.html),
against the `power_mode` corpus (e2e/power_mode_corpus.py, the api-types 0.149.0 wire; GET /health says powerMode).

  1. HEADER: the power switch sits beside the run's name (On), then the state badge, then the rigor chip
     "Rigor high ↑". The chip opens the rigor history (intake, then checkpoint 2: standard → high).
  2. THREAD (r-pm-build): the intake QE-plan card ("QE plan · set at intake", "Rigor standard — …", Raise rigor, More
     about this), the orchestrator's turns as "<seat> · orchestrator · HH:MM" messages, slim activity rows (edited
     files with +/-, tests, commits with their short sha), "Checkpoint 1 · commit 1 · rigor stays standard (score 34 →
     36)", "Checkpoint 2 · commit 2 · picked up your note" and "Rigor ↑ standard → high · sign-in module touched —
     hand-off now runs the full suite"; every thread message's speaker line ends with its time.
  3. RAISE: the intake card's Raise rigor → Highest POSTs {atLeast: 'highest'} to /runs/:id/rigor (tapped).
  4. FLIP: On → Off asks first; "Turn off" POSTs {on: false} to /runs/:id/power; the switch reads Off.
  5. HAND-OFF (r-pm-handoff): "Hand-off · HH:MM", one card: Checks ✓ Passed, the reviewer ✓ Approved, QE Running,
     compliance Waiting.
  6. THIS GREW (r-pm-pause, executing: a pause is not an engine gate): the header says Waiting, no "working" line runs,
     the dock says "Claude Code is waiting", the Nerve Center is not green (GET /system lists the pause as crew will
     after wicked-crew#1206); the decision dock holds the pause card, "Split
     into lanes" leads, the reasons are listed, Other options lists Switch to phased / Continue at high rigor / Stop;
     Continue POSTs {decision: 'continue_high'} to /runs/:id/power/pause after the undo window, and the card goes.
  7. PHASED REQUIRED (r-pm-phased): the switch is Off and disabled, its tooltip "Phased is required: …"; a click sends
     nothing.
  8. SETTINGS: "Power mode for new jobs: On".
  5b. ONE REPORT PER PHASE (operator 2026-10-30; DES-LEARN §1.2: in the Details panel, not the thread): r-pm-handoff
     has one Phase report section per phase in the Details panel — Intake, Build, Checks, Review, QE, Deliver — each the
     run plugin's own sandboxed frame titled by its phase; only the current one (QE) is open; the thread holds none, only
     the slim "Phase report · <phase> … · Show in Details" rows; r-pm-build has Intake and Build, Build open.
  6b. THE WORKING DOCUMENT IS FILLED: r-pm-pause's Build block shows the plugin's own line under Open questions
     ("Waiting on you · checkpoint 3 paused …"), attributed "Phase report (plugin)", marked not saved yet (no document
     is started on this run).
  9. LOOK: every corpus run at 1440x900 and 390x844, dark and light, no horizontal scroll; 0 page errors.

Captures: e2e/shots/desk-power-mode-*.png. Env: FEEDBACK_PORT (default 4671).
"""

import json
import os
import re
import sys
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4671"))
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(1)


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

errors: list[str] = []


def posts() -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/power-posts", timeout=10) as r:
        return json.loads(r.read())["posts"]


def new_page(browser, w: int, h: int, theme: str = "dark"):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, power_mode=True, reset_power=True, working_doc=True, reset_working_doc=True)
    return ctx, page


def open_run(page, rid: str) -> None:
    page.goto(f"{origin}/s/run%3A{rid}", wait_until="domcontentloaded")
    try:
        page.locator('[data-testid="power-switch"]').first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        fail(f"mount-{rid}", {"why": "the power switch never showed"})
    page.wait_for_timeout(800)


TXT = "(el) => el.innerText.replace(/\\s+/g, ' ').trim()"

with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = new_page(browser, 1440, 900)

    # ── 1. header ──────────────────────────────────────────────────────────────────────────────
    open_run(page, "r-pm-build")
    head = page.evaluate("""() => {
      const h = document.querySelector('.wk-session-head-body');
      const kids = [...h.children].map((c) => c.getAttribute('data-testid') || c.querySelector('[data-testid]')?.getAttribute('data-testid') || c.className);
      const sw = document.querySelector('[data-testid=power-switch]');
      return { order: kids, checked: sw.getAttribute('aria-checked'), chip: document.querySelector('[data-testid=rigor-chip]').innerText.replace(/\\s+/g, ' ').trim() };
    }""")
    order = head["order"]
    check("header", order.index("session-title") < order.index("power-switch") < order.index("session-status") < order.index("rigor-chip")
          and head["checked"] == "true" and head["chip"] == "Rigor high ↑", head=head)
    page.click('[data-testid="rigor-chip"]')
    hist = page.locator('[data-testid="rigor-history-row"]').evaluate_all(f"(els) => els.map({TXT})")
    check("rigor-history", len(hist) == 2 and hist[0].startswith("standard") and re.search(r"↑ high \d\d:\d\d checkpoint 2, sign-in module touched, score 34 → 58$", hist[1]) is not None, rows=hist)
    page.keyboard.press("Escape")

    # ── 2. thread ──────────────────────────────────────────────────────────────────────────────
    t = page.evaluate("""() => {
      const txt = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
      return {
        intake: txt(document.querySelector('[data-testid=power-intake]')),
        turns: [...document.querySelectorAll('[data-testid=power-turn] [data-testid=turn-who]')].map(txt),
        acts: [...document.querySelectorAll('[data-testid=power-act]')].map(txt),
        marks: [...document.querySelectorAll('[data-testid=power-checkpoint], [data-testid=power-rigor-mark]')].map(txt),
        whos: [...document.querySelectorAll('[data-testid=session-thread] [data-testid=turn-who]')].map(txt),
        planMsg: document.querySelector('[data-testid=chat-plan]') !== null,
      };
    }""")
    check("intake-card", t["intake"] is not None and t["intake"].startswith("QE plan · set at intake")
          and "Rigor standard — targeted tests, a different reviewer and QE acceptance at hand-off" in t["intake"]
          and "Raise rigor" in t["intake"] and "More about this" in t["intake"] and not t["planMsg"], intake=t["intake"])
    check("turns", len(t["turns"]) == 2 and all(re.fullmatch(r"Claude Code · orchestrator · (\d+ \w{3} )?\d\d:\d\d", w or "") for w in t["turns"]), turns=t["turns"])
    rec = page.locator('[data-testid="chat-run-details"] > summary').first.inner_text()
    check("record-fold", rec == "The job’s record: steps, checks and helpers", fold=rec)
    check("activity", any(a.startswith("Edited src/lib/money.ts +31 −6") for a in t["acts"])
          and any(a.startswith("Tests passed · npm test -- invoices · 19 passed") or a.startswith("Tests passed npm test -- invoices · 19 passed") for a in t["acts"])
          and any(re.match(r"Commit 2 c07d1f3 · Serve /v2/invoice.pdf", a) for a in t["acts"]), acts=t["acts"])
    check("markers", [re.sub(r" \d\d:\d\d$", "", m) for m in t["marks"]] == [
        "Checkpoint 1 · commit 1 · rigor stays standard (score 34 → 36)",
        "Checkpoint 2 · commit 2 · picked up your note",
        "Rigor ↑ standard → high · sign-in module touched — hand-off now runs the full suite"], marks=t["marks"])
    check("timestamps", len(t["whos"]) > 0 and all(re.search(r"\d\d:\d\d(–\d\d:\d\d)?$", w or "") for w in t["whos"]), whos=t["whos"])
    page.screenshot(path=str(SHOTS / "desk-power-mode-build.png"))

    # ── 3. raise ───────────────────────────────────────────────────────────────────────────────
    page.locator('[data-testid="power-intake"] [data-testid="rigor-raise"]').click()
    page.locator('[data-testid="rigor-raise-to"][data-rigor="highest"]').click()
    page.locator('[data-testid="rigor-raise-done"]').wait_for(timeout=10000)
    got = [x for x in posts() if x["route"] == "rigor"]
    check("raise", len(got) == 1 and got[0]["runId"] == "r-pm-build" and got[0]["body"]["atLeast"] == "highest", posts=got)

    # ── 4. flip ────────────────────────────────────────────────────────────────────────────────
    page.click('[data-testid="power-switch"]')
    page.locator('[data-testid="power-switch-confirm"]').wait_for(timeout=5000)
    before = len([x for x in posts() if x["route"] == "power"])
    page.click('[data-testid="power-switch-yes"]')
    page.wait_for_function("() => document.querySelector('[data-testid=power-switch]').getAttribute('aria-checked') === 'false'", timeout=10000)
    got = [x for x in posts() if x["route"] == "power"]
    check("flip-off", before == 0 and len(got) == 1 and got[0]["body"] == {"on": False}, posts=got)

    # ── 5. hand-off ────────────────────────────────────────────────────────────────────────────
    open_run(page, "r-pm-handoff")
    h = page.evaluate("""() => ({
      divider: document.querySelector('[data-testid=power-handoff-divider]')?.innerText ?? null,
      rows: [...document.querySelectorAll('[data-testid=power-handoff-row]')].map((r) => r.dataset.step + ':' + r.querySelector('[data-testid=power-handoff-result]').innerText),
    })""")
    check("handoff", re.fullmatch(r"Hand-off · \d\d:\d\d", h["divider"] or "") is not None
          and h["rows"] == ["checks:✓ Passed", "review:✓ Approved", "qe:Running", "compliance:Waiting"], handoff=h)
    page.locator('[data-testid="power-handoff"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-power-mode-handoff.png"))

    # ── 5b. one phase report per phase ─────────────────────────────────────────────────────────────
    BLOCKS = """() => [...document.querySelectorAll('[data-testid=run-tab] [data-testid=run-plugin]')].map((b) => ({
      phase: b.dataset.phase ?? null, folded: b.dataset.folded, plugin: b.dataset.plugin,
      sandbox: b.querySelector('iframe')?.getAttribute('sandbox') ?? null }))"""
    page.wait_for_function("() => document.querySelectorAll('[data-testid=run-tab] [data-testid=run-plugin]').length >= 5", timeout=10000)
    hb = page.evaluate(BLOCKS)
    rows_h = page.evaluate("() => ({ inThread: document.querySelectorAll('[data-testid=session-thread] [data-testid=run-plugin]').length, rows: [...document.querySelectorAll('[data-testid=session-thread] [data-testid=run-plugin-updated]')].map((r) => r.dataset.phase) })")
    open_run(page, "r-pm-build")
    page.wait_for_function("() => document.querySelectorAll('[data-testid=run-tab] [data-testid=run-plugin]').length >= 2", timeout=10000)
    bb = page.evaluate(BLOCKS)
    # The panel lists every phase the run has, a later one folded ("not started", as the mockup's Hand-off at intake).
    check("phase-reports", [b["phase"] for b in hb] == ["intake", "build", "checks", "review", "qe", "deliver"]
          and [b["phase"] for b in hb if b["folded"] == "false"] == ["qe"]
          and all(b["plugin"] == "wicked-phase-report" and b["sandbox"] == "allow-scripts" for b in hb)
          and [b["phase"] for b in bb][:2] == ["intake", "build"] and [b["phase"] for b in bb if b["folded"] == "false"] == ["build"]
          and rows_h["inThread"] == 0 and rows_h["rows"][:2] == ["intake", "build"],
          handoff=hb, build=bb, thread=rows_h)

    # ── 6. this grew ───────────────────────────────────────────────────────────────────────────
    open_run(page, "r-pm-pause")
    dock = page.locator('[data-testid="decision-dock"] [data-testid="power-pause"]')
    try:
        dock.wait_for(timeout=15000)
    except Exception:  # noqa: BLE001
        fail("pause-dock", {"why": "the pause card never docked"})
    lead = dock.locator('[data-testid="power-pause-choice"]').first
    reasons = dock.locator('[data-testid="power-pause-reasons"] li').evaluate_all(f"(els) => els.map({TXT})")
    # Guided asks: every way on is a card, the recommendation marked and preselected (no Other options menu).
    menu = dock.locator('[data-testid="power-pause-choice"]').evaluate_all("(els) => els.map((e) => e.dataset.choice)")
    state_p = page.evaluate("""() => ({
      badge: document.querySelector('[data-testid=session-status]')?.innerText ?? null,
      working: document.querySelectorAll('[data-testid=session-working]').length,
      eyebrow: document.querySelector('[data-testid=decision-dock-eyebrow]')?.innerText ?? null,
      nerve: document.querySelector('[data-testid=desk-rail-nerve]')?.dataset.tone ?? null,
      nerveWords: document.querySelector('[data-testid=nerve-center-words]')?.innerText ?? null,
      panel: document.querySelector('[data-testid=run-tab-status]')?.innerText ?? null,
    })""")
    check("pause-dock", lead.get_attribute("data-choice") == "split" and lead.get_attribute("aria-checked") == "true"
          and len(reasons) == 3 and menu == ["split", "switch_phased", "continue_high", "stop"],
          reasons=reasons, menu=menu)
    # While paused: the header waits, no working line runs, the orchestrator is named, the Nerve Center is not green.
    check("paused-state", state_p["badge"] == "Waiting" and state_p["working"] == 0
          and (state_p["eyebrow"] or "").startswith("Your decision · Claude Code is waiting")
          and state_p["nerve"] not in (None, "green", "ok") and "needs you" in (state_p["nerveWords"] or "")
          and (state_p["panel"] or "").startswith("Paused at checkpoint 3 — waiting on you"), state=state_p)
    page.screenshot(path=str(SHOTS / "desk-power-mode-pause.png"))

    # ── 6b. the working document, filled by the plugin from the run's events ─────────────────────────
    build = page.locator('[data-testid=run-tab] [data-testid=run-plugin][data-phase=build]')
    if build.get_attribute("data-folded") == "true":
        build.locator('[data-testid="run-plugin-fold"]').click()
    wd = build.frame_locator("iframe").first
    try:
        wd.locator('.wd-sec[data-section="questions"] .wd-text:has-text("Waiting on you")').wait_for(timeout=15000)
    except Exception:  # noqa: BLE001
        pass
    q = wd.locator('.wd-sec[data-section="questions"] .wd-text').inner_text()
    qh = wd.locator('.wd-sec[data-section="questions"] h4').inner_text()
    tr = wd.locator(".wd-trail li").all_inner_texts()
    build.scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-power-mode-working-doc.png"))
    # No document is started on this run (a person's first edit starts one): the line is shown, marked not saved yet.
    gen = wd.locator('.wd-sec[data-section="questions"] .wd-gen').count()
    check("working-doc-filled", q.startswith("Waiting on you · checkpoint 3 paused") and "Phase report (plugin)" in qh and gen == 1,
          questions=q, head=qh, trail=tr, unsaved=gen)
    dock.locator('[data-testid="power-pause-choice"][data-choice="continue_high"]').click()
    dock.locator('[data-testid="power-pause-confirm"]').click()
    # Answered: the cards collapse to one line with the undo countdown.
    chosen = (page.locator('[data-testid="power-pause-chosen"]').text_content() or "") if page.locator('[data-testid="power-pause-chosen"]').count() else ""
    check("pause-answer-collapses", chosen == "You chose: Continue at high rigor", chosen=chosen)
    # The answer goes out after the undo window (10 s): wait for the tap.
    page.wait_for_timeout(11500)
    sent = [x for x in posts() if x["route"] in ("pause", "gate")]
    check("pause-continue", len(sent) == 1 and sent[0]["route"] == "pause" and sent[0]["runId"] == "r-pm-pause"
          and sent[0]["body"] == {"decision": "continue_high"}
          and page.locator('[data-testid="power-pause"]').count() == 0, posts=sent)

    # ── 7. phased required ─────────────────────────────────────────────────────────────────────
    open_run(page, "r-pm-phased")
    sw = page.locator('[data-testid="power-switch"]')
    n = len(posts())
    sw.click(force=True)  # aria-disabled: Playwright would wait for it to be enabled
    page.wait_for_timeout(300)
    check("phased-required", sw.get_attribute("aria-checked") == "false" and sw.get_attribute("aria-disabled") == "true"
          and (sw.get_attribute("title") or "").startswith("Phased is required: regulated repository")
          and page.locator('[data-testid="power-switch-confirm"]').count() == 0 and len(posts()) == n, title=sw.get_attribute("title"))

    # ── 8. settings ────────────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/system", wait_until="domcontentloaded")
    st = page.locator('[data-testid="power-mode-default-toggle"]')
    st.wait_for(timeout=15000)
    check("settings", st.get_attribute("aria-checked") == "true" and "Power mode for new jobs: On" in st.inner_text(), text=st.inner_text())
    ctx.close()

    # ── 9. look ────────────────────────────────────────────────────────────────────────────────
    looks = []
    for theme in ("dark", "light"):
        for (w, hgt) in ((1440, 900), (390, 844)):
            ctx, page = new_page(browser, w, hgt, theme)
            for rid in ("r-pm-build", "r-pm-handoff", "r-pm-pause", "r-pm-phased", "r-pm-done"):
                open_run(page, rid)
                hs = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
                looks.append({"run": rid, "w": w, "theme": theme, "hscroll": hs})
                page.screenshot(path=str(SHOTS / f"desk-power-mode-{rid}-{w}-{theme}.png"))
            ctx.close()
    check("look", not any(x["hscroll"] for x in looks), looks=[x for x in looks if x["hscroll"]])
    check("no-page-errors", len(errors) == 0, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2, ensure_ascii=False))
