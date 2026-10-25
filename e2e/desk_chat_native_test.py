#!/usr/bin/env python3
"""
desk_chat_native_test.py — DES-CHAT-NATIVE-RUN (operator 2026-10-17: "I never see a clean simple chat display"): the
run page IS a chat. Against the `chat_native` corpus (e2e/chat_native_corpus.py), at 1440x900 in both themes and at
390x844, it certifies the user's paths:

  1. AN OLD RUN OPENS ON ITS CONVERSATION: /s/run:r-cn-old (archived, its chat reclaimed) lands on the chat's thread,
     opened at the newest message: a divider, your kickoff bubble, one assistant bubble per finished step with the
     words crew recorded for it, and the final message — never the old summary card. The details panel is open
     beside it (operator 2026-10-18: open by default).
  2. THE FINAL MESSAGE IS PLAIN WORDS: the finished Bug run ends "Done. Tests pass (38), and codex reviewed and
     approved it. Pull request #12 is open." with the pull request, Changes and Evidence as chips.
  3. THE PLAN IS APPROVED INLINE: r-cn-plan's plan message says its 5 steps with Approve plan / Edit / Not now; Edit
     opens the plan editor; Approve plan posts the gate once (after the undo window).
  4. THE DETAILS PANEL: open by default beside the conversation (status, phases, delivery); its own close folds it
     to a handle at the right edge, which opens it again; on a phone it starts behind the handle and opens over the
     page.
  5. WORK IN PROGRESS is one quiet "Working on Build…" line; a chat Q&A is bubbles both ways, its code block copyable.
  6. The column is the chat measure (≤ 768 px of text), no horizontal scroll, 0 page errors.

Captures: e2e/shots/desk-chat-native-{old,bug,plan,live,qa}-{light,dark}.png, desk-chat-native-{bug,plan}-panel-*.png,
desk-chat-native-phone-*.png. Env: FEEDBACK_PORT (default 4483).
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4483"))
W, H = 1440, 900
SHOTS = REPO / "e2e" / "shots"
UNDO_S = 10.0
SW = {"chat_native": True, "run_chat_id": True, "sessions": True, "ask_path": True, "team_plan": True}

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


def gate_posts(run_id: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as r:
        return [p for p in json.loads(r.read())["posts"] if p["runId"] == run_id]


from playwright.sync_api import sync_playwright  # noqa: E402

PAGE = """() => {
  const txt = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }; };
  const thread = document.querySelector('[data-testid="session-thread"]');
  const inner = thread ? (() => { const cs = getComputedStyle(thread); return Math.round(thread.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); })() : null;
  const finalEl = document.querySelector('[data-testid="chat-final"]');
  const tb = box(thread);
  const fb = box(finalEl);
  const bodyBg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
  return {
    url: location.pathname,
    panel: box(document.querySelector('[data-testid="host-panel"]')),
    handle: !!document.querySelector('[data-testid="run-details-handle"]'),
    divider: txt(document.querySelector('[data-testid="session-closed-line"]')),
    you: [...document.querySelectorAll('[data-testid="session-turn"][data-who="you"]')].map(txt),
    youDecisions: [...document.querySelectorAll('[data-testid="chat-you-decision"]')].map(txt),
    plan: document.querySelector('[data-testid="chat-plan"]') ? { open: document.querySelector('[data-testid="chat-plan"]').dataset.open, text: txt(document.querySelector('[data-testid="chat-plan"] [data-testid="session-proposal-text"]')) } : null,
    steps: [...document.querySelectorAll('[data-testid="chat-step"]')].map((s) => ({ key: s.dataset.step, who: txt(s.querySelector('[data-testid="turn-who"]')), text: txt(s.querySelector('.wk-chat-body')) })),
    finalText: txt(document.querySelector('[data-testid="chat-final-text"]')),
    chips: [...document.querySelectorAll('[data-testid="chat-final"] .wk-chat-chips > *')].map(txt),
    finalInView: !!(tb && fb && fb.t < tb.b && fb.b > tb.t),
    oldCard: !!document.querySelector('[data-testid="session-thread"] [data-testid="session-proposal"][data-variant="card"]'),
    details: !!document.querySelector('[data-testid="chat-run-details"]'),
    detailsOpen: !!document.querySelector('[data-testid="chat-run-details"][open]'),
    working: [...document.querySelectorAll('[data-testid="session-working"]')].map((n) => txt(n.querySelector('[data-testid="session-working-text"]') ?? n)),
    workingMenu: document.querySelectorAll('[data-testid="session-working"] [data-testid="session-working-menu-button"]').length,
    helperBubble: bodyBg('[data-testid="session-turn"][data-who="helper"] > .wk-session-text'),
    stepBubble: bodyBg('[data-testid="chat-step"] .wk-chat-body'),
    pageBg: getComputedStyle(document.body).backgroundColor,
    codeCopy: document.querySelectorAll('[data-testid="md-code-copy"]').length,
    measure: inner,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

errors: list[str] = []


def open_session(page, path: str, theme: str, wait_for: str) -> dict:
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme}, **SW)
    page.goto(f"{origin}{path}", wait_until="networkidle")
    try:
        page.locator(wait_for).first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        page.screenshot(path=str(SHOTS / f"desk-chat-native-missing-{theme}.png"))
        fail(f"open-{path}-{theme}", {"why": f"{wait_for} never showed", "page": page.evaluate(PAGE)})
    page.wait_for_timeout(1200)
    return page.evaluate(PAGE)


with sync_playwright() as p:
    browser = p.chromium.launch()
    SHOTS.mkdir(parents=True, exist_ok=True)
    for theme in ("light", "dark"):
        # A fresh context per theme: the panel's closed default and the thread's place are a first visit's.
        ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(
            "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
            f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

        # ── 1. an old run opens on its conversation, at the newest message ───────────────────────
        d = open_session(page, "/s/run%3Ar-cn-old", theme, '[data-testid="chat-final"]')
        page.screenshot(path=str(SHOTS / f"desk-chat-native-old-{theme}.png"))
        check(f"{theme}-old-run-conversation",
              d["url"].endswith("chat-cn-gone") and d["divider"] is not None and len(d["you"]) == 1 and "Rename the invoice fields" in d["you"][0]
              and [s["key"] for s in d["steps"]] == ["understand", "build", "review"]
              and "Found 14 uses" in (d["steps"][0]["text"] or "") and "codex" in (d["steps"][2]["who"] or "")
              and (d["finalText"] or "").startswith("Done.") and "Pull request #7" in " ".join(d["chips"])
              and d["finalInView"] and not d["oldCard"] and d["details"] and not d["detailsOpen"]
              and d["panel"] is not None and d["panel"]["r"] == W and not d["handle"], page=d)
        check(f"{theme}-chat-measure", d["measure"] is not None and 700 <= d["measure"] <= 768 and not d["hscroll"], measure=d["measure"])
        check(f"{theme}-agent-bubbles", d["stepBubble"] not in (None, d["pageBg"], "rgba(0, 0, 0, 0)"), bubble=d["stepBubble"], page_bg=d["pageBg"])

        # ── 2. the final message in plain words ─────────────────────────────────────────────────
        d = open_session(page, "/s/run%3Ar-cn-bug", theme, '[data-testid="chat-final"]')
        page.screenshot(path=str(SHOTS / f"desk-chat-native-bug-{theme}.png"))
        want = "Done. Tests pass (38), and codex reviewed and approved it. Pull request #12 is open."
        check(f"{theme}-final-plain-words", d["finalText"] == want and "QE" not in (d["finalText"] or "")
              and d["chips"][:3] == ["Pull request #12 ↗", "Changes", "Evidence"] and d["youDecisions"] == ["Approved the plan"]
              and len(d["steps"]) == 4 and d["codeCopy"] >= 1, final=d["finalText"], chips=d["chips"], decisions=d["youDecisions"])

        # ── 4. the details panel: open by default beside, its close leaves the handle, the handle reopens ─
        page.locator('[data-testid="host-panel"] [data-testid="run-tab-now"]').wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(400)
        d2 = page.evaluate(PAGE)
        page.screenshot(path=str(SHOTS / f"desk-chat-native-bug-panel-{theme}.png"))
        status = page.get_by_test_id("run-tab-status").inner_text()
        delivery = page.get_by_test_id("run-tab-delivery").inner_text()
        check(f"{theme}-details-opens", not d2["handle"] and d2["panel"] is not None and d2["panel"]["r"] == W and d2["panel"]["w"] == 400
              and "Finished" in status and "Pull request #12" in delivery and not d2["hscroll"], status=status, delivery=delivery, panel=d2["panel"])
        page.get_by_test_id("host-panel-fold").click()
        page.wait_for_timeout(400)
        d3 = page.evaluate(PAGE)
        check(f"{theme}-details-closes", d3["panel"] is None and d3["handle"], page=d3)
        page.get_by_test_id("run-details-handle").click()
        page.locator('[data-testid="host-panel"] [data-testid="run-tab-now"]').wait_for(state="visible", timeout=5000)
        check(f"{theme}-handle-reopens", page.evaluate(PAGE)["panel"] is not None)

        # ── 3. the plan, approved inline ─────────────────────────────────────────────────────────
        d = open_session(page, "/s/run%3Ar-cn-plan", theme, '[data-testid="chat-plan"][data-open="true"]')
        page.screenshot(path=str(SHOTS / f"desk-chat-native-plan-{theme}.png"))
        check(f"{theme}-plan-inline", d["plan"] is not None and d["plan"]["text"] == "Here’s the plan: Research → Build → Test → Review → Deliver (5 steps)."
              and page.get_by_test_id("session-proposal-go").inner_text().strip() == "Approve plan"
              and page.get_by_test_id("session-proposal-edit").count() == 1 and page.get_by_test_id("session-proposal-not-now").count() == 1,
              plan=d["plan"])
        if theme == "light":
            page.get_by_test_id("session-proposal-edit").click()
            page.locator('[data-testid="run-artifacts"]').wait_for(state="visible", timeout=8000)
            page.screenshot(path=str(SHOTS / "desk-chat-native-plan-edit-light.png"))
            check("plan-edit-opens-editor", page.get_by_test_id("session-proposal-edit").get_attribute("aria-expanded") == "true")
            page.get_by_test_id("session-proposal-edit").click()
            before = len(gate_posts("r-cn-plan"))
            page.get_by_test_id("session-proposal-go").click()
            deadline = time.time() + UNDO_S + 8
            while time.time() < deadline and len(gate_posts("r-cn-plan")) == before:
                page.wait_for_timeout(250)
            sent = gate_posts("r-cn-plan")[before:]
            check("plan-approved-once", len(sent) == 1 and sent[0]["body"].get("approve") is True, sent=sent)

        # ── 5. work in progress, and a chat Q&A ──────────────────────────────────────────────────
        d = open_session(page, "/s/run%3Ar-cn-live", theme, '[data-testid="session-working"]')
        page.screenshot(path=str(SHOTS / f"desk-chat-native-live-{theme}.png"))
        check(f"{theme}-one-working-line", len(d["working"]) == 1 and d["working"][0].endswith("Working on Build…")
              and [s["key"] for s in d["steps"]] == ["understand"] and d["finalText"] is None, working=d["working"])
        check(f"{theme}-working-step-menu", d["workingMenu"] == 1, menus=d["workingMenu"])
        d = open_session(page, "/s/chat-cn-qa", theme, '[data-testid="session-turn"][data-who="helper"]')
        page.screenshot(path=str(SHOTS / f"desk-chat-native-qa-{theme}.png"))
        check(f"{theme}-qa-bubbles", len(d["you"]) == 2 and d["helperBubble"] not in (None, d["pageBg"], "rgba(0, 0, 0, 0)")
              and d["codeCopy"] == 1, you=d["you"], helper_bg=d["helperBubble"])
        ctx.close()

    # ── phone: the same conversation; the edge handle opens the panel over the page ──────────────
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    d = open_session(page, "/s/run%3Ar-cn-bug", "light", '[data-testid="chat-final"]')
    page.screenshot(path=str(SHOTS / "desk-chat-native-phone-bug.png"))
    check("phone-conversation", d["finalText"] is not None and d["finalInView"] and not d["hscroll"] and d["panel"] is None and d["handle"], page=d)
    page.get_by_test_id("run-details-handle").click()
    page.locator('[data-testid="host-panel"] [data-testid="run-tab-now"]').wait_for(state="visible", timeout=5000)
    page.screenshot(path=str(SHOTS / "desk-chat-native-phone-panel.png"))
    check("phone-details-overlay", page.evaluate(PAGE)["panel"] is not None)
    ctx.close()

    check("no-page-errors", errors == [], errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
