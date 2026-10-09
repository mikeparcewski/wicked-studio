#!/usr/bin/env python3
"""
desk_session_live_test.py — S15d (DES-STUDIO-REBUILD-001 Amendment 5, item 1) at 1440x700, on the Desk.

The session IS the running chat. Against the fixture's sessions corpus (chat-pay: r-pay-1 finished,
r-pay-2 a team run mid-build with live frames over /ws), it proves at `/s/chat-pay`:

  1. NO RUN PAGE: no run block offers "Open the run page →"; each carries its own ⋯ (look underneath).
  2. THE STATUS SENTENCE REWRITES IN PLACE (rule 7): a `wicked.team.step.completed` frame for build
     changes r-pay-2's sentence — the SAME element, new words, the chain moved with it.
  3. THE RUN'S DEPTH IS THE SHEET (S11): the block's ⋯ opens the session sheet on Steps — every step
     in order with its state and helper, in plain words; a step row opens that step's sheet on "What it
     did" (its transcript); the session sheet also offers Changes and Evidence.
  4. A FINISHED RUN READS THE SAME, SETTLED: r-pay-1's block shows its sentence and no run-page link.
  5. 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-session-live*.png. Env: FEEDBACK_PORT (default 4465).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4465"))
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


def team_frame(eid: int, etype: str, **payload) -> dict:
    base = {"run_id": "r-pay-2", "ord": payload.pop("ord", None), "attempt": None, "by": "codex", "at": eid, "re": None}
    return {"type": "teamEvent", "event": {"event_id": eid, "event_type": etype, "emitted_at": eid,
                                           "payload": dict(base, **payload)}}



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

RUNS = """() => [...document.querySelectorAll('[data-testid="session-run"]')].map((r) => {
  const s = r.querySelector('[data-testid="session-status-sentence"]');
  return { id: r.dataset.runId, state: r.dataset.state, sentence: s ? s.innerText.trim() : null, sentenceMarked: !!(s && s.__s15d === 1),
           look: r.querySelectorAll('[data-testid="session-run-look"]').length, open: r.querySelectorAll('[data-testid="session-run-open"]').length,
           chain: [...r.querySelectorAll('[data-testid="chain-step"]')].map((c) => [c.dataset.stepId, c.dataset.state]) };
})"""

SHEET = """() => {
  const body = document.querySelector('[data-testid="sheet-body"]');
  const title = document.querySelector('[data-testid="sheet-title"]');
  return { open: !!body, tab: body ? body.dataset.tab : null, title: title ? title.innerText.trim() : null,
           tabs: [...document.querySelectorAll('[data-testid="sheet-tab"]')].map((t) => t.dataset.tab),
           steps: [...document.querySelectorAll('[data-testid="sheet-step-row"]')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()),
           output: (document.querySelector('[data-testid="sheet-output"]') || {}).innerText || null,
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, sessions=True, run_chat_id=True, extra_frames=[])
    page.goto(f"{origin}/s/chat-pay", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.wait_for_function("""() => document.querySelectorAll('[data-testid="session-run"]').length === 2
            && !!document.querySelector('[data-testid="session-run"][data-run-id="r-pay-2"] [data-testid="chain-step"][data-step-id="build"]')""", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-session-live-missing.png"))
        fail("thread", {"runs": page.evaluate(RUNS)})
    page.evaluate("""() => { document.querySelector('[data-testid="session-run"][data-run-id="r-pay-2"] [data-testid="session-status-sentence"]').__s15d = 1; }""")

    # ── 1. no run page ────────────────────────────────────────────────────────────
    r0 = {r["id"]: r for r in page.evaluate(RUNS)}
    body0 = page.evaluate("() => document.body.innerText")
    check("no-run-page", all(r["open"] == 0 and r["look"] == 1 for r in r0.values()) and "Open the run page" not in body0
          and r0["r-pay-2"]["state"] == "working" and r0["r-pay-1"]["state"] == "done", runs=r0)
    page.screenshot(path=str(SHOTS / "desk-session-live.png"))

    # ── 2. the sentence rewrites in place ─────────────────────────────────────────
    before = r0["r-pay-2"]["sentence"]
    set_fixture(origin, extra_frames=[
        team_frame(906, "wicked.team.step.completed", ord=1, step_id="build", status="ok", tree=None, output_bytes=1, output_ref="u1"),
        team_frame(907, "wicked.team.step.claimed", ord=2, step_id="test", role="creator", kind="agent",
                   phase="test", criterion="", baseline_tree=None, repo=None, code_graph_db=None),
    ])
    try:
        page.wait_for_function(
            "(before) => { const r = document.querySelector('[data-testid=\"session-run\"][data-run-id=\"r-pay-2\"]'); const s = r && r.querySelector('[data-testid=\"session-status-sentence\"]'); return !!s && s.innerText.trim() !== before; }",
            arg=before, timeout=10000)
    except Exception:
        fail("sentence-live", {"before": before, "runs": page.evaluate(RUNS)})
    r1 = {r["id"]: r for r in page.evaluate(RUNS)}
    check("sentence-rewrites-in-place", r1["r-pay-2"]["sentenceMarked"] and r1["r-pay-2"]["sentence"] != before
          and dict(r1["r-pay-2"]["chain"]).get("build") == "done" and dict(r1["r-pay-2"]["chain"]).get("test") == "running",
          before=before, after=r1["r-pay-2"]["sentence"], chain=r1["r-pay-2"]["chain"])

    # ── 3. the run's depth is the sheet ───────────────────────────────────────────
    page.locator('[data-testid="session-run"][data-run-id="r-pay-2"] [data-testid="session-run-look"]').click()
    page.get_by_test_id("sheet-body").wait_for(state="visible", timeout=5000)
    s0 = page.evaluate(SHEET)
    page.screenshot(path=str(SHOTS / "desk-session-live-steps.png"))
    page.locator('[data-testid="sheet-step-row"]').nth(1).get_by_test_id("sheet-step-open").click()
    try:
        page.wait_for_function("""() => (document.querySelector('[data-testid="sheet-body"]')||{}).dataset?.tab === 'did' && !!document.querySelector('[data-testid="sheet-output"]')""", timeout=5000)
    except Exception:
        fail("step-sheet", page.evaluate(SHEET))
    s1 = page.evaluate(SHEET)
    page.screenshot(path=str(SHOTS / "desk-session-live-step.png"))
    check("depth-is-the-sheet",
          s0["open"] and s0["tab"] == "steps" and len(s0["steps"]) == 5
          and s0["steps"][0].startswith("Research — done") and s0["steps"][1].split(" — ")[1] in ("working", "handed to a helper")
          and {"steps", "changes", "evidence", "helpers", "activity"} <= set(s0["tabs"])
          and s1["tab"] == "did" and s1["output"] is not None and not s1["hscroll"],
          sheet=s0, step_sheet={"tab": s1["tab"], "title": s1["title"], "output": (s1["output"] or "")[:80]})
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # ── 4. a finished run reads the same, settled ────────────────────────────────
    r2 = {r["id"]: r for r in page.evaluate(RUNS)}
    check("finished-settled", r2["r-pay-1"]["state"] == "done" and (r2["r-pay-1"]["sentence"] or "").startswith("Finished")
          and r2["r-pay-1"]["open"] == 0 and not page.evaluate("() => !!document.querySelector('[data-testid=\"sheet-body\"]')")
          and errors == [], run=r2["r-pay-1"], errors=errors[:3])

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
