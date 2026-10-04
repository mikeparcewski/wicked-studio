#!/usr/bin/env python3
"""
desk_checks_test.py — WT-U2 (DES-WALKTHROUGH-PROOF-001 §3 scenes 21, 22, 28; §4.9; WT-W3): "checked"
comes only from crew's acceptance read, at 1440x700 under STUDIO_SKIN=desk.

Against the in-process fixture's `walkthrough` corpus with its `acceptance_wt` wire (GET
/runs/:id/acceptance → the WT-W2 `walkthrough` block and the WT-W3 `summary`), in the session thread:

  1. CHECKED-LINK (21/22): `/s/run:r-walk-pass` — the Build step wears "checked at 0:30 ▸" (the step a
     sealed take proves; the word from `checkState`, the moment from the take's chapter marks: 04-pay
     starts at 0:30), the step reads checked, the sentence "6 of 6 done · 1 checked"; the chip opens the
     walkthrough artifact as the pane with the playhead at 0:30; Esc shrinks it back.
  2. WALK-FAIL + CHIP (19): `/s/run:r-walk-fail` — the Build step wears "check failed at 0:41" (the
     failing moment of the chapter that proves it), the step stays "done" (the bus says so; the seal says
     the check failed).
  3. QA-YOURS (28): `/s/run:r-walk-yours` — the accepted plan's override removed the walkthrough pair:
     the chain has no walkthrough step, no walkthrough artifact, Build wears "end-to-end testing is
     yours", the sentence stays "3 of 4 done"; the hand-over card carries crew's acceptance line
     verbatim ("Accepted: the checks this run had to pass have passed.") in the ok tone; nothing sent.
  4. A DAEMON BEFORE WT-W2/W3 (`acceptance_wt` off): no chip, "6 of 6 done", no acceptance line.
  5. The word "Followed" is nowhere; 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-checks-*.png. Env: FEEDBACK_PORT (default 4359).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4359"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why if isinstance(why, dict) else str(why)}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read())


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

# What the run block says about its checks.
CHAIN = """(run) => {
  const block = document.querySelector(`[data-testid="session-run"][data-run-id="${run}"]`);
  if (!block) return null;
  const chips = [...block.querySelectorAll('[data-testid="chain-step-check"]')].map((c) => ({
    step: c.closest('[data-testid="chain-step"]')?.dataset.stepId, check: c.dataset.check, sec: c.dataset.sec ?? null,
    text: c.innerText.replace(/\\s+/g, ' ').trim(), button: c.tagName === 'BUTTON' }));
  const steps = [...block.querySelectorAll('[data-testid="chain-step"]')].map((s) => [s.dataset.stepId, s.dataset.state]);
  const art = block.querySelector('[data-testid="artifact"][data-kind="walkthrough"]');
  const video = art?.querySelector('video');
  const prop = block.querySelector('[data-testid="session-proposal"]');
  const acc = block.querySelector('[data-testid="session-proposal-acceptance"]');
  return {
    chips, steps, sentence: block.querySelector('[data-testid="chain-sentence"]')?.innerText ?? null,
    artifact: art ? { size: art.dataset.size, playhead: video ? Math.round(video.currentTime * 10) / 10 : null, ready: video ? video.readyState : null } : null,
    proposal: prop ? { kind: prop.dataset.kind, state: prop.dataset.state, text: prop.querySelector('[data-testid="session-proposal-text"]')?.innerText ?? null } : null,
    acceptance: acc ? { tone: acc.dataset.tone, text: acc.innerText } : null,
  };
}"""


def open_run(page, run: str, want_chips: bool, step: str) -> dict:
    page.goto(f"{origin}/s/run%3A{run}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.locator(f'[data-testid="session-run"][data-run-id="{run}"] [data-testid="chain-line"]').wait_for(state="visible", timeout=15000)
        if want_chips:
            page.wait_for_function(
                """(run) => !!document.querySelector(`[data-testid="session-run"][data-run-id="${run}"] [data-testid="chain-step-check"]`)""",
                arg=run, timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-checks-{step}-missing.png"))
        fail(step, {"why": f"{run}: the chain or its check chips never appeared: {e}", "found": page.evaluate(CHAIN, run)})
    return page.evaluate(CHAIN, run)


def open_run_after_acceptance(page, run: str, step: str) -> dict:
    """Open the run and return its chain once the run block has APPLIED the acceptance read's body:
    RunBlock marks itself `data-acceptance="read"` in the same render that draws from that body, so
    what is absent then is absent because the body said nothing — not because it has not landed."""
    open_run(page, run, False, step)
    try:
        page.locator(f'[data-testid="session-run"][data-run-id="{run}"][data-acceptance="read"]').wait_for(state="attached", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-checks-{step}-noread.png"))
        fail(step, {"why": f"{run}: the acceptance read never reached the run block: {e}", "found": page.evaluate(CHAIN, run)})
    return page.evaluate(CHAIN, run)


def gate_posts(run: str) -> list:
    return [p["body"] for p in get_json(f"{origin}/__fixture/gate-posts")["posts"] if p["runId"] == run]


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[],
                acceptance_wt=True, reset_walkthrough=True, reset_gate_posts=True)

    # ── 1. checked-link (scenes 21/22) ─────────────────────────────────────────────────
    # The chip's moment comes from the take's chapter marks, which the artifact reads: wait for a timed chip.
    open_run(page, "r-walk-pass", True, "checked")
    try:
        page.wait_for_function(
            """() => document.querySelector('[data-testid="session-run"][data-run-id="r-walk-pass"] [data-testid="chain-step-check"][data-sec]') !== null""",
            timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-checked-notimed.png"))
        fail("checked", {"why": f"the checked chip never got its moment from the take: {e}", "found": page.evaluate(CHAIN, "r-walk-pass")})
    c = page.evaluate(CHAIN, "r-walk-pass")
    page.screenshot(path=str(SHOTS / "desk-checks-checked.png"))
    check("checked", c["chips"] == [{"step": "build", "check": "checked", "sec": "30", "text": "checked at 0:30 ▸", "button": True}]
          and ["build", "checked"] in c["steps"] and c["sentence"] == "6 of 6 done · 1 checked"
          and c["artifact"] is not None and c["artifact"]["size"] == "inline" and "Followed" not in page.evaluate("() => document.body.innerText"),
          found=c)

    # The chip opens the walkthrough as the pane, playhead at the proving moment.
    page.locator('[data-testid="session-run"][data-run-id="r-walk-pass"] [data-testid="chain-step-check"]').click()
    try:
        page.wait_for_function(
            """() => { const a = document.querySelector('[data-testid="session-run"][data-run-id="r-walk-pass"] [data-testid="artifact"][data-kind="walkthrough"]');
                      const v = a?.querySelector('video'); return !!a && a.dataset.size === 'pane' && !!v && v.readyState >= 1 && v.currentTime >= 29.5; }""",
            timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-link-timeout.png"))
        fail("checked-link", {"why": f"the pane with the playhead at 0:30 never came: {e}", "found": page.evaluate(CHAIN, "r-walk-pass")})
    c = page.evaluate(CHAIN, "r-walk-pass")
    page.screenshot(path=str(SHOTS / "desk-checks-link.png"))
    check("checked-link", c["artifact"]["size"] == "pane" and 29.5 <= c["artifact"]["playhead"] <= 33.0, found=c["artifact"])
    page.keyboard.press("Escape")
    page.wait_for_function(
        """() => document.querySelector('[data-testid="session-run"][data-run-id="r-walk-pass"] [data-testid="artifact"][data-kind="walkthrough"]')?.dataset.size === 'inline'""",
        timeout=8000)
    check("checked-link-esc", True)

    # ── 2. the failed check's chip (scene 19) ──────────────────────────────────────────
    open_run(page, "r-walk-fail", True, "failed")
    try:
        page.wait_for_function(
            """() => document.querySelector('[data-testid="session-run"][data-run-id="r-walk-fail"] [data-testid="chain-step-check"][data-sec]') !== null""",
            timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-failed-notimed.png"))
        fail("failed", {"why": f"the failed chip never got its moment: {e}", "found": page.evaluate(CHAIN, "r-walk-fail")})
    c = page.evaluate(CHAIN, "r-walk-fail")
    page.screenshot(path=str(SHOTS / "desk-checks-failed.png"))
    check("failed", c["chips"] == [{"step": "build", "check": "failed", "sec": "41", "text": "check failed at 0:41 ▸", "button": True}]
          and ["build", "done"] in c["steps"] and c["sentence"] == "4 of 6 done · 0 checked", found=c)

    # ── 3. qa-yours (scene 28) + the deliver card's acceptance line (WT-W3) ────────────
    c = open_run(page, "r-walk-yours", True, "yours")
    page.screenshot(path=str(SHOTS / "desk-checks-yours.png"))
    check("yours", c["chips"] == [{"step": "build", "check": "yours", "sec": None, "text": "end-to-end testing is yours", "button": False}]
          and [s[0] for s in c["steps"]] == ["understand", "build", "test", "deliver"] and c["sentence"] == "3 of 4 done"
          and c["artifact"] is None, found=c)
    try:
        page.wait_for_function(
            """() => !!document.querySelector('[data-testid="session-run"][data-run-id="r-walk-yours"] [data-testid="session-proposal-acceptance"]')""",
            timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-deliver-missing.png"))
        fail("deliver-line", {"why": f"no acceptance line on the hand-over card: {e}", "found": page.evaluate(CHAIN, "r-walk-yours")})
    c = page.evaluate(CHAIN, "r-walk-yours")
    page.screenshot(path=str(SHOTS / "desk-checks-deliver.png"))
    check("deliver-line", c["proposal"] is not None and c["proposal"]["kind"] == "deliver" and c["proposal"]["state"] == "ask"
          and c["acceptance"] == {"tone": "ok", "text": "Accepted: the checks this run had to pass have passed."}
          and gate_posts("r-walk-yours") == [], found=c)

    # ── 4. a daemon before WT-W2/W3: nothing claimed ───────────────────────────────────
    set_fixture(origin, acceptance_wt=False)
    # Absence is judged after the acceptance read has ANSWERED and two frames have painted — not after
    # a sleep: the old daemon's body (no walkthrough, no summary) must be what the screen is drawn from.
    c = open_run_after_acceptance(page, "r-walk-pass", "older-daemon")
    y = open_run_after_acceptance(page, "r-walk-yours", "older-daemon")
    page.screenshot(path=str(SHOTS / "desk-checks-older.png"))
    check("older-daemon", c["chips"] == [] and c["sentence"] == "6 of 6 done" and ["build", "done"] in c["steps"]
          and y["chips"] == [] and y["acceptance"] is None and y["proposal"] is not None and y["proposal"]["kind"] == "deliver",
          pass_run=c, yours=y)

    # ── 5. Hold work to it (scenes 29-30, WT §4.12): the one explicit switch on a TESTING rule ────
    set_fixture(origin, steering_rules=True, reset_rule_posts=True)

    def rule_posts() -> list:
        return get_json(f"{origin}/__fixture/rule-posts")["posts"]

    def hold_state() -> dict:
        return page.evaluate("""() => { const d = document.querySelector('[data-testid="steering-rule-drawer"]');
          const sw = d?.querySelector('[data-testid="steering-rule-hold-switch"]');
          return { present: !!sw, checked: sw ? sw.checked : null, words: d?.querySelector('[data-testid="steering-rule-hold-words"]')?.innerText ?? null,
                   effect: d?.querySelector('[data-testid="steering-rule-effect"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
                   badge: d?.querySelector('[data-testid="steering-rule-effect"] [data-testid="steering-effect-badge"]')?.dataset.effect ?? null,
                   pick: !!d?.querySelector('[data-testid="steering-rule-hold-pick"]') }; }""")

    page.goto(f"{origin}/steering/policies?rule=TST-1002", wait_until="networkidle")
    try:
        page.get_by_test_id("steering-rule-drawer").wait_for(state="visible", timeout=15000)
        page.get_by_test_id("steering-rule-hold-switch").wait_for(state="visible", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-hold-missing.png"))
        fail("hold-advisory", {"why": f"TST-1002's drawer shows no Hold switch: {e}", "found": hold_state()})
    h = hold_state()
    page.screenshot(path=str(SHOTS / "desk-checks-hold-advisory.png"))
    check("hold-advisory", h["present"] and h["checked"] is False and h["words"] == "Advisory — helpers are told about it while planning; nothing is inserted."
          and "recall-only" in (h["effect"] or "") and not h["pick"] and rule_posts() == [], found=h)

    # On: a rule that carries known obligations is held to them with one click — ONE POST.
    page.get_by_test_id("steering-rule-hold-switch").click()
    try:
        page.wait_for_function("""() => document.querySelector('[data-testid="steering-rule-hold-switch"]')?.checked === true""", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-hold-on-timeout.png"))
        fail("hold-on", {"why": f"the switch never read held after the write: {e}", "found": hold_state(), "posts": rule_posts()})
    h = hold_state()
    posts = rule_posts()
    page.screenshot(path=str(SHOTS / "desk-checks-hold-on.png"))
    check("hold-on", len(posts) == 1 and posts[0]["id"] == "TST-1002" and posts[0]["effect"] == "allow_with_conditions"
          and posts[0]["obligations"] == ["step:test", "step:walkthrough"] and posts[0]["steering_type"] == "testing"
          and posts[0]["trigger"] == {"contains": "\"kinds\":\\[[^\\]]*\"(code|config)\""}
          and h["checked"] is True and h["words"] == "Held — when it fires, work gets a Test step and a walkthrough — planned and reviewed by a different helper; only your own plan can drop that."
          and h["badge"] == "allow_with_conditions",
          found=h, posts=posts)

    # Off: advisory again — the effect goes, the trigger and obligations stay. ONE more POST.
    page.get_by_test_id("steering-rule-hold-switch").click()
    try:
        page.wait_for_function("""() => document.querySelector('[data-testid="steering-rule-hold-switch"]')?.checked === false""", timeout=15000)
    except Exception as e:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / "desk-checks-hold-off-timeout.png"))
        fail("hold-off", {"why": f"the switch never read advisory after the write: {e}", "found": hold_state(), "posts": rule_posts()})
    h = hold_state()
    posts = rule_posts()
    check("hold-off", len(posts) == 2 and "effect" not in posts[1] and posts[1]["obligations"] == ["step:test", "step:walkthrough"]
          and posts[1]["trigger"] == posts[0]["trigger"] and h["checked"] is False and h["words"].startswith("Advisory")
          and h["badge"] is None and "recall-only" in (h["effect"] or ""), found=h, posts=posts)

    # A decision rule (DC) shows no Hold at all (DC rev 2 N7).
    page.goto(f"{origin}/steering/policies?rule=proposal%3Apr-auto", wait_until="networkidle")
    page.get_by_test_id("steering-rule-drawer").wait_for(state="visible", timeout=15000)
    body = page.evaluate("() => document.body.innerText")
    check("no-hold-on-decision", page.get_by_test_id("steering-rule-hold").count() == 0 and "Hold work to it" not in body and "Followed" not in body)

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
