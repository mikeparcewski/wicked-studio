#!/usr/bin/env python3
"""
desk_e2e7721_r2_test.py — the studio defects the second :7721 E2E found (crew 0.14.0 / studio 0.10.0), each
walked on the operator's own path at 1440x700 against the fixture's `e2e7721r2` corpus.

  1. studio#834 (run 531faaef): a finished run's page opens at its newest message on a first visit, though
     its step words land after the page opened, and opens there again on a reload.
  2. studio#832 (run bef20223): a verify FAIL escalation whose approve re-runs the step offers "Retry this step
     with a note", never "Approve with a note for the next step".
  3. studio#835 (run 63c38801): the only seat out of quota — the gate says "Copilot is out of quota", offers no
     approve that retries it, and names the way out.
  4. studio#833: an empty project's Needs you settles (no skeleton left after 6 s).
  5. studio#836: every Steer rule row shows its reach; a global one reads "Everywhere".
  6. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-e2e7721r2-*.png. Env: FEEDBACK_PORT (default 4484).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4484"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

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

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ROW = """() => {
  const txt = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
  return {
    choices: [...document.querySelectorAll('[data-testid="session-gate-choice"]')].map((b) => [b.dataset.choiceKey, txt(b)]),
    question: txt(document.querySelector('[data-testid="session-gate-question"]')),
    dead: txt(document.querySelector('[data-testid="session-gate-dead-seat"]')),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

THREAD = """() => {
  const t = document.querySelector('[data-testid="session-thread"]');
  return t ? { top: Math.round(t.scrollTop), max: t.scrollHeight - t.clientHeight, short: t.scrollHeight - t.clientHeight - Math.round(t.scrollTop) } : null;
}"""


def new_page(ctx):
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    return page


def gate_row(page, run: str, tag: str):
    page.goto(f"{origin}/s/run%3A{run}", wait_until="networkidle")
    try:
        page.locator('[data-testid="session-gate-choice"]').first.wait_for(state="attached", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-e2e7721r2-{tag}-missing.png"))
        fail(f"{tag}-row", page.evaluate("() => document.body.innerText.slice(0, 1200)"))
    page.locator('[data-testid="session-gate-row"]').first.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / f"desk-e2e7721r2-{tag}.png"))
    return page.evaluate(ROW)


with sync_playwright() as p:
    browser = p.chromium.launch()
    set_fixture(origin, e2e7721r2=True, steering_rules=True, reset_gate_posts=True)
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)

    # ── 1. studio#834: a first visit opens at the newest message, and a reload too ─────
    page = new_page(ctx)
    page.goto(f"{origin}/s/run%3Ar-7721b-long", wait_until="networkidle")
    page.wait_for_timeout(4500)  # eight step outputs, each ~0.4 s late
    first = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "desk-e2e7721r2-1-run-first-visit.png"))
    check("834-first-visit-at-newest", first is not None and first["max"] > 200 and first["short"] < 80, thread=first)
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(4500)
    again = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "desk-e2e7721r2-1-run-reload.png"))
    check("834-reload-at-newest", again is not None and again["short"] < 80, thread=again)
    page.close()

    # ── 2. studio#832: the verify FAIL's approve-with-note says it re-runs the step ─────
    page = new_page(ctx)
    row = gate_row(page, "r-7721b-verify", "2-verify-fail")
    labels = [t for _, t in row["choices"]]
    check("832-retry-label", any(t.startswith("Retry this step with a note") for t in labels)
          and not any("next step" in t for t in labels), choices=row["choices"])
    page.close()

    # ── 3. studio#835: the dead seat is named, with no approve that retries it ──────────
    page = new_page(ctx)
    row = gate_row(page, "r-7721b-dead", "3-dead-seat")
    keys = [k for k, _ in row["choices"]]
    check("835-says-why", row["dead"] is not None and "Copilot is out of quota." in row["dead"]
          and "No other helper is in this job" in row["dead"], dead=row["dead"])
    check("835-question", row["question"] is not None and row["question"].startswith("Copilot is out of quota"),
          question=row["question"])
    check("835-no-retry-of-dead-seat", keys == ["stop"], choices=row["choices"])
    page.close()

    # ── 4. studio#833: an empty project's Needs you settles ───────────────────────────
    page = new_page(ctx)
    # `scratch`: a project with no jobs (crew's GET /projects/:id, no members), while the rail counts 7.
    scratch = {"id": "scratch", "name": "scratch", "status": "active", "description": None,
               "scope": "project:scratch", "created_at": 1, "updated_at": 1}
    page.route("**/api/v1/projects/scratch", lambda route: route.fulfill(status=200, json={"project": scratch, "members": []}))
    page.goto(f"{origin}/projects/scratch", wait_until="networkidle")
    page.wait_for_timeout(6000)
    page.screenshot(path=str(SHOTS / "desk-e2e7721r2-4-empty-project.png"))
    busy = page.evaluate("() => document.querySelectorAll('[data-testid=\"desk-loading\"]').length")
    listed = page.evaluate("() => !!document.querySelector('[data-testid=\"desk-inbox-list\"]')")
    check("833-needs-settled", busy == 0 and listed, loading=busy, list=listed)
    page.close()

    # ── 5. studio#836: every Steer rule shows its reach ───────────────────────────────
    page = new_page(ctx)
    page.goto(f"{origin}/?tab=steer", wait_until="networkidle")
    try:
        page.locator('[data-testid="rules-row"]').first.wait_for(state="attached", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-e2e7721r2-5-steer-missing.png"))
        fail("836-rows", page.evaluate("() => document.body.innerText.slice(0, 1200)"))
    page.screenshot(path=str(SHOTS / "desk-e2e7721r2-5-steer.png"))
    reach = page.evaluate("""() => [...document.querySelectorAll('[data-testid="rules-row"]')].map((r) => {
      const el = r.querySelector('[data-testid="rules-row-reach"]');
      return el ? [el.dataset.reach, el.innerText.trim(), el.offsetWidth > 0] : null;
    })""")
    check("836-reach-on-every-row", len(reach) > 0 and all(x is not None and x[2] for x in reach)
          and any(x[0] == "everywhere" and x[1] == "Everywhere" for x in reach), reach=reach[:8])
    hscroll = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    page.close()

    check("no-page-errors", errors == [] and not hscroll, errors=errors[:5], hscroll=hscroll)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
