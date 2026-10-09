#!/usr/bin/env python3
"""
dogfood_fixes_test.py — the dogfood findings of 2026-09-27 on the launch screen and a plan gate
(1440x700).

  launch  /runs/new — D1 the header says the team model in one line (the PA scores and plans it,
          you approve the plan, the team works it); D2 no "No PR" notice before anything is
          chosen, and a repo picker sits beside Project on the composer row; D15 the launch
          options offer no file upload (a launch cannot carry files to its run); D4 the phase
          picker offers `deliver` with no repo, and not once a repo is picked (the launch
          delivers, so it adds its own deliver step).
  gate    /s/run%3Ar-plan-gate (S16a-2a: the session thread), paused at a high-risk plan_approval
          gate — D10 the plan card (behind "Why this plan") shows the
          score, band, the score's reason (the stale graph, commits shortened), what the floor
          added and why, "manual mode" at most once, and no evaluator verdict; D11 it offers Go,
          the plan artifact's editor and Not now (no "Approve + steer", no note box), the page
          composer never says it approves the gate, and approving an edited plan POSTs
          {approve: true, plan} with no amend.

Captures (e2e/shots/): dogfood-desk-launch.png, dogfood-desk-launch-picker.png,
dogfood-desk-plan-gate.png, dogfood-desk-plan-edit.png.
Env: FEEDBACK_PORT (default 4391). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4391"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def get_json(origin: str, path: str):
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())


def gate_posts(origin: str, rid: str) -> list:
    return [p for p in get_json(origin, "/__fixture/gate-posts")["posts"] if p["runId"] == rid]


def reset(origin: str) -> None:
    set_fixture(origin, **{"team_plan": True, "plan_gate": True, "repo": True, "reset_gate_posts": True,
                           "appearance": {**DEFAULT_APPEARANCE}})


def wait_attr(page, testid: str, name: str, value: str, timeout: int = 8000) -> None:
    page.wait_for_function(
        """([t, n, v]) => { const el = document.querySelector(`[data-testid="${t}"]`);
                          return !!el && el.getAttribute(n) === v; }""",
        arg=[testid, name, value], timeout=timeout)


def offered(page) -> list:
    wait_attr(page, "phase-picker", "data-catalog-state", "ready")
    return page.evaluate("""() => [...document.querySelectorAll('[data-testid="phase-option"]')]
      .map(e => e.dataset.catalog)""")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    def section_launch() -> None:
        reset(origin)
        page.goto(f"{origin}/runs/new", wait_until="networkidle")
        page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)
        body = page.evaluate("() => document.body.innerText || ''")
        check("d1-team-model-line",
              "The PA scores and plans it, you approve the plan, and the team works it." in body
              and "council elects" not in body)
        check("d2-no-notice-before-a-choice", page.get_by_test_id("deliver-notice").count() == 0)
        picker = page.locator('[data-testid="launch-project-row"] [data-testid="launch-repo-picker"]')
        check("d2-repo-picker-beside-project", picker.count() == 1 and picker.is_visible())
        page.get_by_role("button", name="Open launch options").click()
        dialog = page.get_by_role("dialog", name="Launch options")
        dialog.wait_for(state="visible")
        check("d15-no-upload", dialog.locator('input[type="file"]').count() == 0
              and "Upload files" not in (dialog.text_content() or ""))
        page.get_by_role("button", name="Open launch options").click()
        page.get_by_test_id("launch-problem").fill("add a rate limiter to the upload endpoint")
        page.screenshot(path=str(SHOTS / f"dogfood-desk-launch.png"))

        page.get_by_test_id("phase-picker-toggle").click()
        check("d4-deliver-offered-without-a-repo", "deliver" in offered(page), offered=offered(page))
        repo_id = page.evaluate("""() => [...document.querySelectorAll('[data-testid="launch-repo-picker"] option')]
          .map(o => o.value).find(v => v && v !== '__several__') || ''""")
        check("d2-a-repo-to-pick", repo_id != "", repo=repo_id)
        picker.select_option(repo_id)
        page.wait_for_function("""() => ![...document.querySelectorAll('[data-testid="phase-option"]')]
          .some(e => e.dataset.catalog === 'deliver')""", timeout=8000)
        check("d4-deliver-hidden-when-the-launch-delivers", "deliver" not in offered(page), offered=offered(page))
        check("d2-notice-names-the-pr", page.get_by_test_id("deliver-notice").count() == 0
              or page.get_by_test_id("deliver-notice").get_attribute("data-deliver-state") in ("on", None))
        # The fixture's /health answers crew 0.7.40's capabilities (deliverGate: true), so with a repo
        # picked, a phase making it a build launch and "First gate", the composer promises the deliver
        # gate, never the pre-0.7.33 warning.
        page.locator('[data-testid="phase-option"][data-catalog="build"]').click()
        page.wait_for_function("""() => (document.querySelector('[data-testid="deliver-notice"]')?.textContent || '')
          .includes('pauses at the deliver gate')""", timeout=8000)
        notice = page.get_by_test_id("deliver-notice").text_content() or ""
        check("d2-deliver-gate-promised", "WITHOUT a deliver gate" not in notice
              and page.get_by_test_id("launch-confirm-deliver").get_attribute("data-deliver-gate") == "human",
              notice=notice)
        page.screenshot(path=str(SHOTS / f"dogfood-desk-launch-picker.png"))

    def section_gate() -> None:
        # S16a-2a: the plan gate is answered in the session thread (/s/run%3Ar-plan-gate): the plan
        # proposal card (its score behind "Why this plan") and the plan artifact's ordered editor.
        reset(origin)
        page.goto(f"{origin}/s/run%3Ar-plan-gate", wait_until="networkidle")
        card = page.locator('[data-testid="session-proposal"][data-kind="plan"]')
        card.wait_for(state="visible", timeout=15000)
        page.get_by_test_id("session-proposal-plan-why").locator("summary").click()
        wait_attr(page, "plan-gate-summary", "data-state", "ready")
        score = (page.get_by_test_id("plan-gate-score").text_content() or "").strip()
        check("d10-score-band", score == "Score 100 · band 70-100 · high risk", score=score)
        reason = page.get_by_test_id("plan-gate-reason").first.text_content() or ""
        check("d10-reason-stale-graph", "graph indexed at 3071a76 is not the run base e9d64e7" in reason, reason=reason)
        floor = page.get_by_test_id("plan-gate-floor").text_content() or ""
        check("d10-floor-and-why", "test_plan, architecture, security_review" in floor
              and "band 70-100 requires them" in floor, floor=floor)
        prompt = card.text_content() or ""
        check("d10-manual-mode-once", prompt.count("manual mode") <= 1, prompt=prompt[:400])
        check("d10-no-verdict-wall", page.get_by_test_id("gate-verdict").count() == 0)
        check("d11-no-steer", card.get_by_test_id("session-gate-note").count() == 0
              and page.locator('[data-testid="session-gate-choice"][data-choice-key="steer"]').count() == 0
              and page.get_by_test_id("amend-prepopulated").count() == 0)
        plan = page.locator('[data-testid="artifact"][data-kind="plan"]')
        check("d11-plan-actions", page.get_by_test_id("session-proposal-go").is_visible()
              and page.get_by_test_id("session-proposal-not-now").is_visible()
              and plan.count() > 0)
        composer = page.get_by_test_id("composer")
        check("d11-composer-is-a-team-message", composer.count() > 0
              and "approves gate" not in (composer.first.text_content() or ""))
        page.screenshot(path=str(SHOTS / f"dogfood-desk-plan-gate.png"))

        plan.get_by_test_id("plan-step").first.wait_for(state="visible", timeout=8000)
        plan.get_by_test_id("artifact-open").click()
        page.locator('[data-testid="artifact"][data-kind="plan"][data-size="pane"]').wait_for(state="visible", timeout=8000)
        seeded = plan.get_by_test_id("plan-step").evaluate_all("els => els.filter(e => e.dataset.fixed === 'no').map(e => e.dataset.catalog)")
        check("d11-edit-seeded-from-the-held-plan", seeded == ["understand", "design", "build", "review"], seeded=seeded)
        # An item the editor refuses (aria-disabled, the reason as its title) is offered as a refusal, not authored.
        in_edit = plan.get_by_test_id("plan-add-item").evaluate_all("els => els.filter(e => e.dataset.refused !== 'true').map(e => e.dataset.catalog)")
        check("d11-edit-never-authors-deliver", "deliver" not in in_edit and len(in_edit) > 0, offered=in_edit)
        plan.locator('[data-testid="plan-add-item"][data-catalog="test"]').click()
        page.get_by_test_id("session-proposal-draft").wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(SHOTS / f"dogfood-desk-plan-edit.png"))
        page.get_by_test_id("session-proposal-go").click()
        # The 10 s undo window, then exactly one POST.
        deadline = time.monotonic() + 25
        while not gate_posts(origin, "r-plan-gate") and time.monotonic() < deadline:
            page.wait_for_timeout(250)
        page.wait_for_timeout(500)
        posts = gate_posts(origin, "r-plan-gate")
        body = posts[0]["body"] if posts else {}
        steps = [st.get("catalog") for st in (body.get("plan") or {}).get("steps", [])]
        check("d11-edited-plan-posted", len(posts) == 1 and body.get("approve") is True and "amend" not in body
              and steps == ["understand", "design", "build", "review", "test"], body=body)

    for section in (section_launch, section_gate):
        try:
            section()
        except SectionFailed:
            pass
        except Exception as exc:  # noqa: BLE001 — every failure lands in the report
            report["steps"][f"{section.__name__}-error"] = {"ok": False, "error": repr(exc)[:500]}
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
