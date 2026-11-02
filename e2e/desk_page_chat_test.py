"""Page chats (DES-LEARN §6.2, §5; the operator-approved mockup learn-and-panels states e and f).

The operator's path, through the real buttons, on the fixture's ask path (a real team-path replay):
  1. Report → Ask opens the page's chat beside the page (a 400 px column at 1440). Clicking the
     "jobs finished" tile puts a question about it in the box with the tile as a chip — nothing is sent.
     Send: the first message carries what the page shows and the tile (the fixture's ask-posts), the
     reply streams in as text with no buttons in its bubble, and a guided "What next?" follows; choosing
     "Open the jobs behind it" lands on Jobs and the ask collapses into "You chose: …".
  2. Nerve Center → "Chat about system state" opens the same kind of chat, its own conversation.
  3. Understand → Ask: the answer comes in ON THE PAGE (no floating chat), with "What next?".
  4. Evaluate: Recommended to run explains why; Paste a transcript splits it into behaviours you mark,
     and Import sends exactly the marked ones; Past runs → Analyze this run sends the run's analysis
     into the page's chat at once and ends in a guided choice with Draft rules first.
  5. A 390 px phone: the chat is a bottom sheet with its composer on screen.
The floating system chat stays (its launcher is still on the page). 0 page errors.

Captures: e2e/shots/desk-page-chat-*.png. Env: FEEDBACK_PORT (default 4611).
"""
import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4611"))
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def fixture_get(origin: str, path: str) -> dict:
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)
set_fixture(origin, sessions=True, run_chat_id=True, ask_path=True, ask_one_seat=False, extra_frames=[], eval_plan=True)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
# The gate toasts are CSS, hidden by a style element added on load.
HIDE_TOASTS_JS = ("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
                  f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
NO_BUTTONS_IN_BUBBLES = "() => [...document.querySelectorAll('[data-testid=assist-chat-msg]')].map((m) => m.querySelectorAll('button').length).reduce((a, b) => a + b, 0)"


def tid(page, name):
    return page.locator(f'[data-testid="{name}"]')


def choose(page, option: str) -> None:
    nxt = tid(page, "page-chat-next")
    nxt.locator(f'[data-testid="ask-option"][data-ask-option="{option}"]').click()
    nxt.locator('[data-testid="ask-confirm"]').click()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(HIDE_TOASTS_JS)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))

    # ── 1. Report ─────────────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/report")
    tid(page, "report-page").wait_for(timeout=30_000)
    tid(page, "report-ask").click()
    chat = tid(page, "page-chat")
    chat.wait_for(timeout=10_000)
    box = chat.bounding_box()
    check("report-column", box is not None and box["x"] > 900 and abs(box["width"] - 400) < 2 and chat.get_attribute("data-kind") == "report",
          box=box, kind=chat.get_attribute("data-kind"))
    check("report-knows", "Knows this page" in tid(page, "assist-context").inner_text(), text=tid(page, "assist-context").inner_text())
    tid(page, "assist-input").wait_for(timeout=15_000)
    posts_before = len(fixture_get(origin, "/__fixture/ask-posts")["posts"])
    tile = tid(page, "report-tile-finished")
    tile.wait_for(timeout=15_000)
    page.wait_for_function("() => document.querySelector('[data-testid=report-tile-finished]')?.hasAttribute('data-askable')", timeout=20_000)
    tile.click()
    chip = tid(page, "page-chat-focus")
    chip.wait_for(timeout=5_000)
    page.wait_for_function("() => (document.querySelector('[data-testid=assist-input]')?.value ?? '') !== ''", timeout=5_000)
    typed = tid(page, "assist-input").input_value()
    check("tile-asks-unsent", "jobs finished" in chip.inner_text() and typed.startswith("What’s behind") and tile.get_attribute("data-asked") == "true"
          and len(fixture_get(origin, "/__fixture/ask-posts")["posts"]) == posts_before, chip=chip.inner_text(), typed=typed)
    page.screenshot(path=str(SHOTS / "desk-page-chat-report-asking.png"))
    tid(page, "assist-send").click()
    page.wait_for_function("() => [...document.querySelectorAll('[data-testid=assist-chat-msg]')].some((m) => m.dataset.agent !== 'you' && m.dataset.pending === 'false')", timeout=30_000)
    tid(page, "page-chat-next").wait_for(timeout=15_000)
    posts = fixture_get(origin, "/__fixture/ask-posts")["posts"]
    sent = json.dumps(posts[-1]) if posts else ""
    check("pack-has-page-and-tile", "what this page shows" in sent and "the question is about" in sent and "jobs finished" in sent, last=sent[:400])
    check("no-buttons-in-bubbles", page.evaluate(NO_BUTTONS_IN_BUBBLES) == 0)
    check("what-next", tid(page, "page-chat-next").locator('[data-testid="ask-question"]').inner_text() == "What next?"
          and tid(page, "page-chat-next").locator('[data-testid="ask-recommended"]').count() == 1)
    check("bubble-chip", tid(page, "assist-msg-chip").count() == 1 and tid(page, "page-chat-focus").count() == 0)
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / "desk-page-chat-report-answer.png"))
    choose(page, "jobs")
    page.wait_for_url("**/jobs", timeout=10_000)
    check("chose-jobs", page.url.endswith("/jobs"), url=page.url)
    check("floating-chat-stays", page.locator('[data-testid="system-chat"]').count() == 0)

    # ── 2. Nerve Center ───────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/watch")
    tid(page, "nerve-center-page").wait_for(timeout=30_000)
    tid(page, "nc-chat").first.click()
    tid(page, "page-chat").wait_for(timeout=10_000)
    check("nerve-own-chat", tid(page, "page-chat").get_attribute("data-kind") == "nerve" and "Knows system state" in tid(page, "assist-context").inner_text()
          and tid(page, "assist-chat").count() == 0, knows=tid(page, "assist-context").inner_text())
    tid(page, "assist-input").fill("What is slowing work?")
    tid(page, "assist-send").click()
    tid(page, "page-chat-next").wait_for(timeout=30_000)
    opts = tid(page, "page-chat-next").locator('[data-testid="ask-option"]').evaluate_all("(os) => os.map((o) => o.dataset.askOption)")
    check("nerve-moves", opts == ["follow-up", "recheck", "agents", "none"], opts=opts)
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / "desk-page-chat-nerve.png"))

    # ── 3. Understand ─────────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/understand")
    tid(page, "understand-page").wait_for(timeout=30_000)
    tid(page, "understand-ask-input").fill("Who calls the deliver step?")
    tid(page, "understand-ask-send").click()
    tid(page, "understand-chat").wait_for(timeout=10_000)
    tid(page, "page-chat-next").wait_for(timeout=30_000)
    check("understand-inline", tid(page, "understand-chat").locator('[data-testid="page-chat"]').get_attribute("data-variant") == "inline"
          and page.locator('[data-testid="system-chat"]').count() == 0 and tid(page, "understand-answer").count() >= 1)
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / "desk-page-chat-understand.png"))

    # ── 4. Evaluate ───────────────────────────────────────────────────────────────────────────
    page.goto(f"{origin}/testing/evals")
    tid(page, "evaluate-recommended").wait_for(timeout=30_000)
    tid(page, "evaluate-rec").first.wait_for(timeout=15_000)
    recs = tid(page, "evaluate-rec").evaluate_all("(rs) => rs.map((r) => [r.dataset.rec, r.querySelector('[data-testid=evaluate-rec-why]').innerText])")
    check("recommended-with-why", len(recs) >= 1 and recs[0][0] == "weak:development" and "slipped through" in recs[0][1], recs=recs)
    tid(page, "evaluate-byo-paste").click()
    tid(page, "evaluate-paste-text").fill("User: fix the login bug\n\nAssistant: I pushed the fix straight to main.\n\nAssistant: I deleted the flaky test.")
    tid(page, "evaluate-paste-split").click()
    rows = tid(page, "evaluate-behaviour")
    check("split", rows.count() == 3, n=rows.count())
    rows.nth(0).locator('[data-testid="evaluate-mark-good"]').click()
    rows.nth(1).locator('[data-testid="evaluate-mark-bad"]').click()
    tid(page, "evaluate-review-import").click()
    tid(page, "evaluate-review-done").wait_for(timeout=10_000)
    imports = fixture_get(origin, "/__fixture/eval-imports")["imports"]
    kinds = [s["kind"] for s in imports[-1]["samples"]] if imports else []
    check("import-marked-only", kinds == ["good", "bad"] and tid(page, "evaluate-review-unmarked").count() == 0, kinds=kinds)
    tid(page, "evaluate-past-run").first.wait_for(timeout=10_000)
    tid(page, "evaluate-past-run").first.locator('[data-testid="evaluate-analyze"]').click()
    tid(page, "page-chat").wait_for(timeout=10_000)
    tid(page, "evaluate-analysis-open").wait_for(timeout=10_000)
    tid(page, "page-chat-next").wait_for(timeout=30_000)
    first = tid(page, "page-chat-next").locator('[data-testid="ask-option"]').first.get_attribute("data-ask-option")
    posts = fixture_get(origin, "/__fixture/ask-posts")["posts"]
    sent = json.dumps(posts[-1]) if posts else ""
    check("analyze-run", first == "draft-rules" and "Analyze this evaluation" in sent and "slipped through [Development] A helper pushes straight to main" in sent,
          first=first, sent=sent[:300])
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / "desk-page-chat-evaluate.png"))
    ctx.close()

    # ── 5. Phone ──────────────────────────────────────────────────────────────────────────────
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(HIDE_TOASTS_JS)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)[:200]))
    page.goto(f"{origin}/report")
    tid(page, "report-page").wait_for(timeout=30_000)
    tid(page, "report-ask").click()
    tid(page, "page-chat").wait_for(timeout=10_000)
    tid(page, "assist-input").wait_for(timeout=15_000)
    sheet = tid(page, "page-chat").bounding_box()
    inp = tid(page, "assist-input").bounding_box()
    check("phone-sheet", sheet is not None and abs(sheet["y"] + sheet["height"] - 844) < 2 and sheet["width"] == 390 and inp is not None and inp["y"] + inp["height"] <= 844,
          sheet=sheet, input=inp)
    page.screenshot(path=str(SHOTS / "desk-page-chat-phone.png"))
    ctx.close()
    browser.close()

check("no-page-errors", not errors, errors=errors[:5])
report["ok"] = True
print(json.dumps(report, indent=2))
