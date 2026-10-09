#!/usr/bin/env python3
"""
desk_reel_words_test.py — the defects the wave-4 reel takes found on a live crew 0.7.46 stack
(studio#440, #441, #442, #443, #444, #445), at 1440x900 on the Desk, gate toasts SHOWN.

Drives the built UI against the fixture's `reel_runs` corpus (the live wire's shapes: unit
descriptions `<phase> — <problem> ||| <instruction>`, UUID run ids, a deliver card naming a local
origin by its absolute path, a deliver Tool unit that never reaches the team bus; the team route
answers after REEL_TEAM_DELAY_S) and proves:

  1. #440 — from the first paint to the team fold, no chain step and no status sentence carries a
     unit prompt, a phase id, ' ||| ', ' — ' or a path (sampled every 100 ms, before and after).
  2. #442 — after the fold the chain names each step once ("Scope → Clarify → Plan → Build →
     Challenge → Test → Review"), and the proposal says the same steps in the same words.
  3. #441 — the gate toast is the desk variant: the plain question and the work, no "Run awaiting
     human", run hash, "before unit #N" or raw prompt; sans type; its dot is not violet.
  4. #443 — Go's undo notice names the work ("Approving the plan for “…” in N s"), never a UUID.
     Undo sends nothing.
  5. #444 — the hand-over card, its "Are you sure?" and the undo notice say one plain sentence
     ("…to checkout-demo’s origin on this machine. There is no pull request: …"): no path, no run
     branch, no "gh resolves". Undo sends nothing.
  6. #445 — the delivered run's chain shows Deliver done and counts 8 of 8, as GET /runs says.
  7. 0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-reel-words*.png. Env: FEEDBACK_PORT (default 4349).
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4349"))
W, H = 1440, 900
SHOTS = REPO / "e2e" / "shots"
PLAN = "5d0c1e2a-9f3b-4c6d-8e7f-0a1b2c3d4e5f"
DELIVER = "6e1d2f3b-0a4c-4d7e-9f80-1b2c3d4e5f60"
DONE = "7f2e304c-1b5d-4e8f-a091-2c3d4e5f6071"
WORDS = ["Scope", "Clarify", "Plan", "Build", "Challenge", "Test", "Review"]
# Engine text the default layer never carries.
ENGINE = re.compile(r"\|\|\||—|/var/|/w/|pa-scope|Pa scope|adversarial-review|PHASE SCOPE|Rules for booking")
UUIDISH = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-")

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



dist = ensure_build(fail)
origin = start_server(PORT, dist)


def posts(run_id: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as r:
        return [p for p in json.loads(r.read())["posts"] if p["runId"] == run_id]


def session_url(rid: str) -> str:
    return f"{origin}/s/{urllib.parse.quote('run:' + rid, safe='')}"


CHAIN = """(rid) => {
  const c = document.querySelector(`[data-testid="chain"][data-run-id="${rid}"]`);
  const run = document.querySelector(`[data-testid="session-run"][data-run-id="${rid}"]`);
  const status = run ? run.querySelector('[data-testid="session-status-sentence"]') : null;
  if (!c) return {source: null, labels: [], steps: [], status: status ? status.innerText : null, sentence: null};
  const sentence = c.querySelector('[data-testid="chain-sentence"]');
  return {
    source: c.dataset.source,
    labels: [...c.querySelectorAll('[data-testid="chain-step"] .wk-chain-label')].map(s => s.innerText),
    steps: [...c.querySelectorAll('[data-testid="chain-step"]')].map(s => [s.dataset.stepId, s.dataset.state]),
    status: status ? status.innerText : null,
    sentence: sentence ? sentence.innerText : null,
  };
}"""

TOASTS = """() => [...document.querySelectorAll('[data-testid="gate-notification"]')].map(t => {
  const dot = t.querySelector('.wk-desk-dot');
  const q = t.querySelector('[data-testid="gate-toast-question"]');
  return {
    run: t.dataset.runId, variant: t.dataset.variant ?? null, text: t.innerText, q: q ? q.innerText : null,
    work: t.querySelector('[data-testid="gate-toast-work"]')?.innerText ?? null,
    font: getComputedStyle(q ?? t).fontFamily, dot: dot ? getComputedStyle(dot).backgroundColor : null,
    violet: getComputedStyle(document.documentElement).getPropertyValue('--status-gate').trim(),
  };
})"""

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    set_fixture(origin, sessions=True, run_chat_id=True, reel_runs=True, ship_proposals=False,
                extra_frames=[], reset_gate_posts=True)

    # ── 1. #440: first paint → team fold, sampled ─────────────────────────────────
    page.goto(session_url(PLAN), wait_until="domcontentloaded")
    samples: list = []
    deadline = time.time() + 20
    while time.time() < deadline:
        c = page.evaluate(CHAIN, PLAN)
        if c["labels"] or c["status"]:
            samples.append(c)
        if c["source"] == "team" and len(c["labels"]) == 7:
            break
        page.wait_for_timeout(100)
    before = [s for s in samples if s["source"] == "units"]
    leaks = [x for s in samples for x in (s["labels"] + [s["status"] or ""]) if ENGINE.search(x)]
    check("440-no-unit-prompt-flash", len(before) >= 3 and not leaks and samples and samples[-1]["source"] == "team",
          before_fold=len(before), first=before[0] if before else None, leaks=leaks[:5],
          last=samples[-1] if samples else None)
    page.screenshot(path=str(SHOTS / "desk-reel-words-plan.png"))

    # ── 2. #442: one name per step, the proposal in the same words ────────────────
    c = page.evaluate(CHAIN, PLAN)
    card = page.locator(f'[data-testid="session-proposal"][data-run-id="{PLAN}"]')
    card.wait_for(state="visible", timeout=10000)
    text = card.get_by_test_id("session-proposal-text").inner_text()
    want = "Here’s the plan: " + " → ".join(WORDS) + " (7 steps)."
    check("442-one-vocabulary", c["labels"] == WORDS and len(set(c["labels"])) == 7 and text == want
          and c["sentence"] == "1 of 7 done",
          labels=c["labels"], text=text, want=want, sentence=c["sentence"])

    # ── 3. #441: the desk toast ───────────────────────────────────────────────────
    try:
        page.wait_for_selector(f'[data-testid="gate-notification"][data-run-id="{PLAN}"]', timeout=10000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-reel-words-no-toast.png"))
        fail("441-toast-shown", str(e))
    toasts = page.evaluate(TOASTS)
    mine = [t for t in toasts if t["run"] == PLAN][0]
    bad = [t["text"] for t in toasts if re.search(r"Run awaiting human|before unit|band|manual mode|Review →|\|\|\||/var/|pa-scope|gh resolves", t["text"])
           or UUIDISH.search(t["text"])]
    hand_toast = [t for t in toasts if t["run"] == DELIVER]
    page.screenshot(path=str(SHOTS / "desk-reel-words-toast.png"))
    check("441-desk-toast", all(t["variant"] == "desk" for t in toasts) and not bad
          and mine["q"] == "Approve the plan (7 steps)"
          and mine["work"] == "Add a short \"Rules for booking\" section to PROPOSAL.md"
          and "mono" not in mine["font"].lower() and mine["dot"] is not None
          and "111, 66, 193" not in mine["dot"]
          and len(hand_toast) == 1 and hand_toast[0]["q"] == "Approve the hand-over",
          toasts=toasts, bad=bad)

    # ── 4. #443: the undo notice names the work ───────────────────────────────────
    card.get_by_test_id("session-proposal-go").click()
    page.get_by_test_id("undo-toast").first.wait_for(state="visible", timeout=5000)
    head = page.get_by_test_id("undo-headline").first.inner_text()
    page.screenshot(path=str(SHOTS / "desk-reel-words-undo-plan.png"))
    page.get_by_test_id("undo-button").first.click()
    page.wait_for_timeout(600)
    check("443-undo-names-the-work",
          re.match(r"^Approving the plan for “Add a short \"Rules for booking\" section to PROPOSAL\.md” in \d+ s$", head) is not None
          and not UUIDISH.search(head) and len(posts(PLAN)) == 0,
          headline=head, posts=len(posts(PLAN)))

    # ── 5. #444: the hand-over in one plain sentence ──────────────────────────────
    page.goto(session_url(DELIVER), wait_until="domcontentloaded")
    hand = page.locator(f'[data-testid="session-proposal"][data-run-id="{DELIVER}"]')
    hand.wait_for(state="visible", timeout=15000)
    page.wait_for_function(
        f"() => document.querySelector('[data-testid=\"session-proposal\"][data-run-id=\"{DELIVER}\"]')?.dataset.state === 'ask'",
        timeout=10000)
    plain = ("Pushes your changes as a new branch to checkout-demo’s origin on this machine. "
             "There is no pull request: the branch is the delivery.")
    why = hand.get_by_test_id("session-proposal-why").inner_text()
    tech_hidden = hand.get_by_test_id("tech-proposal-deliver-card").count() == 0
    hand.get_by_test_id("session-proposal-go").click()
    hand.get_by_test_id("session-proposal-confirm").wait_for(state="visible", timeout=5000)
    sure = hand.get_by_test_id("session-proposal-confirm").inner_text()
    page.screenshot(path=str(SHOTS / "desk-reel-words-handover-sure.png"))
    hand.get_by_test_id("session-proposal-confirm-yes").click()
    page.get_by_test_id("undo-toast").first.wait_for(state="visible", timeout=5000)
    u_head = page.get_by_test_id("undo-headline").first.inner_text()
    u_prev = page.get_by_test_id("undo-preview").first.inner_text()
    page.screenshot(path=str(SHOTS / "desk-reel-words-handover-undo.png"))
    page.get_by_test_id("undo-button").first.click()
    page.wait_for_timeout(600)
    shown = [why, sure, u_head, u_prev]
    leaks = [x for x in shown if re.search(r"/var/|wicked/|gh resolves|IS the delivery|Push identity", x) or UUIDISH.search(x)]
    check("444-plain-hand-over", why == plain and plain in sure and u_prev == plain and tech_hidden
          and re.match(r"^Approving the hand-over of “Add a SAVE20 discount code to applyDiscount in src/cart\.js[^”]*” in \d+ s$", u_head) is not None
          and not leaks and len(posts(DELIVER)) == 0,
          why=why, sure=sure, undo_headline=u_head, undo_preview=u_prev, leaks=leaks, tech_hidden=tech_hidden,
          posts=len(posts(DELIVER)))

    # ── 6. #445: delivered = Deliver done, 8 of 8 ─────────────────────────────────
    page.goto(session_url(DONE), wait_until="domcontentloaded")
    try:
        page.wait_for_function(
            f"() => (document.querySelector('[data-testid=\"chain\"][data-run-id=\"{DONE}\"]')||{{}}).dataset?.source === 'team'",
            timeout=15000)
    except Exception as e:  # noqa: BLE001
        fail("445-team", str(e))
    d = page.evaluate(CHAIN, DONE)
    page.screenshot(path=str(SHOTS / "desk-reel-words-delivered.png"))
    check("445-delivered-8-of-8", d["steps"][-1] == ["deliver", "done"] and d["labels"][-1] == "Deliver"
          and d["sentence"] == "8 of 8 done" and d["status"] == "Finished · branch pushed · 8 of 8 done",
          chain=d)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
