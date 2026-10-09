#!/usr/bin/env python3
"""
desk_fit_test.py — THE CHROME FITS at 1440x700 on the Desk (the W12 reel's stage height,
a common laptop browser height). Four defects the released 0.6.1 Desk showed on that stage:

  1. studio#514 — Standing orders from the rail's "Additional settings": the anchored overlay opened
     BELOW its Manage toggle (y ≈ 628) with a 160-px floor and ran off the viewport; its input and
     Read-it-back / Keep / Not-that were under the fold, and `position: fixed` meant nothing could
     scroll them in. Now it opens ABOVE the toggle: the whole overlay, its input and its buttons are
     inside the viewport; from the Desk header it still opens below.
  2. studio#515 — Skills: the drawer (a fixed right-side aside) covered the header's Refresh baseline /
     Analyze / Publish and the catalog re-read while a skill was open — the re-read being meant for
     exactly that moment. Now the drawer starts where the header ends: with a skill open, each verb's
     centre hits the verb itself (`elementFromPoint`), and the drawer's top is at the header's bottom.
  3. studio#516 — Configuration: a long worker_config_root refusal (a ~130-character sentence from the
     daemon's 400) rendered on one line and made the control column as wide as the sentence; the
     label column collapsed to a word per line. Now the error wraps at the input's width (224 px),
     and the label keeps its width.
  4. studio#509 — the Demo video's native `<video controls>` took Esc, so the artifact did not shrink
     while the player had the focus. Now Esc from the focused player shrinks one step (pane → inline),
     with the ⤡ / × buttons unchanged.

Against the in-process fixture; the Skills drawer's file routes and the settings refusal are served
by Playwright routes (the fixture has no skills file tree, and its PUT /settings never refuses).

Captures: e2e/shots/desk-fit-*.png. Env: FEEDBACK_PORT (default 4471). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4471"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
ART = '[data-testid="artifact"][data-kind="demo-video"]'
LONG_REFUSAL = ("worker_config_root must be an absolute path on the daemon host, and the directory it names "
                "must exist and be writable by the daemon's user before any worker can be spawned from it")

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    # DESK_FIT_ALL=1: keep going after a red step, so one run reports every defect (the red-first run).
    if not ok and os.environ.get("DESK_FIT_ALL") != "1":
        print(json.dumps(report, indent=2))
        sys.exit(1)



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

RECT = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; }"""

# Does the centre of the element at `sel` belong to that element (nothing fixed over it)?
HIT = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { hit: !!at && (at === e || e.contains(at)), over: at ? (at.dataset.testid || at.tagName) : null, top: r.top }; }"""


def inside(r: dict, vh: int = H, vw: int = W) -> bool:
    return r is not None and r["top"] >= 0 and r["left"] >= 0 and r["bottom"] <= vh and r["right"] <= vw


SKILL = "wicked-garden-repo-learn"
SKILL_MD = f"---\nname: {SKILL}\n---\nLearn the repo."


def skills_routes(page) -> None:
    """The drawer's file routes the fixture does not serve (its catalog is `home_paths`)."""
    def files(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "name": SKILL, "dir": "skills/repo-learn", "enabled": True,
            "files": [{"path": "SKILL.md", "size": len(SKILL_MD), "sha256": "f" * 64,
                       "record": {"baselineHash": "a" * 8, "effectiveHash": "a" * 8, "lastPublishedHash": "a" * 8, "conflict": False}}]}))

    def read(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(
            {"path": "SKILL.md", "content": SKILL_MD, "size": len(SKILL_MD), "truncated": False, "binary": False}))
    page.route(f"**/api/v1/skills/{SKILL}/files", files)
    page.route(f"**/api/v1/skills/{SKILL}/files/SKILL.md*", read)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    # ── 1. Standing orders from the rail, at 700 px (studio#514) ───────────────────────────────
    set_fixture(origin, wave1=True, home_runs=True, reset_home_runs=True, standing_orders=True, reset_standing=True, home_paths=True)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk").wait_for(state="visible", timeout=15000)
    if page.get_by_test_id("desk-rail-controls").count() == 0:
        page.get_by_test_id("desk-rail-more").click()
    rail = page.get_by_test_id("desk-rail-controls")
    rail.wait_for(state="visible", timeout=5000)
    toggle = rail.get_by_test_id("standing-orders-toggle")
    # The orders chip renders once `GET /standing-orders` answers (CI is slower than a laptop): wait
    # for it, and measure the toggle through the locator that is about to be clicked.
    toggle.wait_for(state="visible", timeout=10000)
    tb = toggle.bounding_box()
    toggle_rect = None if tb is None else {"top": tb["y"], "bottom": tb["y"] + tb["height"], "left": tb["x"], "right": tb["x"] + tb["width"], "width": tb["width"], "height": tb["height"]}
    toggle.click()
    overlay = page.get_by_test_id("standing-orders-manage")
    overlay.wait_for(state="visible", timeout=5000)
    page.wait_for_timeout(150)
    ov = page.evaluate(RECT, '[data-testid="standing-orders-manage"]')
    inp = page.evaluate(RECT, '[data-testid="standing-orders-manage"] [data-testid="standing-order-input"]')
    placement = overlay.get_attribute("data-placement")
    page.screenshot(path=str(SHOTS / "desk-fit-standing-orders-rail.png"))
    # The toggle is in the lower half of the stage (the defect's precondition), the overlay is above it
    # and wholly inside the viewport, and its input is visible and typeable.
    try:
        page.get_by_test_id("standing-order-input").fill("Auto-approve intake on alpha", timeout=5000)
        typed = True
    except Exception as e:  # noqa: BLE001
        typed = f"{type(e).__name__}: {str(e)[:120]}"
    check("rail-overlay-in-viewport",
          toggle_rect is not None and toggle_rect["top"] > H / 2 and inside(ov) and inside(inp)
          and placement == "above" and ov["bottom"] <= toggle_rect["top"] and typed is True,
          toggle=toggle_rect, overlay=ov, input=inp, placement=placement, typed=typed)
    page.keyboard.press("Escape")
    page.get_by_test_id("standing-orders-manage").wait_for(state="hidden", timeout=5000)

    # The Desk header's own Manage still opens below (the room is there).
    heads = page.locator('[data-testid="standing-orders-toggle"]')
    head_toggle = None
    for i in range(heads.count()):
        r = heads.nth(i).bounding_box()
        if r is not None and r["y"] < H / 2:
            head_toggle = heads.nth(i)
            break
    if head_toggle is not None:
        head_toggle.click()
        overlay.wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(150)
        ov2 = page.evaluate(RECT, '[data-testid="standing-orders-manage"]')
        check("header-overlay-below", inside(ov2) and overlay.get_attribute("data-placement") == "below", overlay=ov2)
        page.keyboard.press("Escape")
        page.get_by_test_id("standing-orders-manage").wait_for(state="hidden", timeout=5000)
    else:
        report["steps"]["header-overlay-below"] = {"ok": True, "narrowed": "no Manage toggle in the upper half of this Desk"}

    # ── 2. Skills: the header verbs with a skill open (studio#515) ────────────────────────────
    skills_routes(page)
    page.goto(f"{origin}/skills?skill={SKILL}", wait_until="networkidle")
    page.get_by_test_id("skills-drawer").wait_for(state="visible", timeout=15000)
    page.get_by_test_id("skills-publish").wait_for(state="attached", timeout=10000)
    page.wait_for_timeout(200)
    hits = {tid: page.evaluate(HIT, f'[data-testid="{tid}"]') for tid in ("skills-reload", "skills-publish", "skills-analyze", "skills-refresh")}
    head = page.evaluate(RECT, '[data-testid="skills-header"]')
    drawer = page.evaluate(RECT, '[data-testid="skills-drawer"]')
    page.screenshot(path=str(SHOTS / "desk-fit-skills-drawer.png"))
    check("skills-verbs-reachable",
          all(h is not None and h["hit"] for h in hits.values()) and head is not None and drawer is not None
          and abs(drawer["top"] - head["bottom"]) <= 2 and drawer["bottom"] >= H - 1,
          hits=hits, header=head, drawer=drawer)
    # And the re-read really is clickable from here: the catalog is asked for again.
    reloads = {"n": 0}
    page.on("request", lambda req: reloads.__setitem__("n", reloads["n"] + 1) if req.url.endswith("/api/v1/skills") else None)
    try:
        page.get_by_test_id("skills-reload").click(timeout=5000)
        clicked = True
    except Exception as e:  # noqa: BLE001
        clicked = f"{type(e).__name__}: " + next((ln.strip() for ln in str(e).splitlines() if "intercepts" in ln), str(e)[:160])
    page.wait_for_timeout(400)
    check("skills-reload-clicks", clicked is True and reloads["n"] >= 1 and page.get_by_test_id("skills-drawer").count() == 1, clicked=clicked, reloads=reloads["n"])

    # ── 3. Configuration: a long refusal wraps under the input (studio#516) ───────────────────
    def refuse(route):
        if route.request.method == "PUT":
            route.fulfill(status=400, content_type="application/json", body=json.dumps({"error": LONG_REFUSAL}))
        else:
            route.fallback()
    page.route("**/api/v1/settings", refuse)
    page.goto(f"{origin}/system", wait_until="networkidle")
    root = page.get_by_label("Worker config root")
    root.wait_for(state="visible", timeout=15000)
    label_before = page.evaluate("""() => { const p = [...document.querySelectorAll('p')].find((e) => e.textContent === 'Worker config root');
      return p ? p.parentElement.getBoundingClientRect().width : null; }""")
    root.fill("/srv/wicked/workers")
    page.get_by_role("button", name="Save", exact=True).click()
    err = page.get_by_test_id("worker-root-error")
    err.wait_for(state="visible", timeout=10000)
    page.wait_for_timeout(100)
    er = page.evaluate(RECT, '[data-testid="worker-root-error"]')
    label_after = page.evaluate("""() => { const p = [...document.querySelectorAll('p')].find((e) => e.textContent === 'Worker config root');
      return p ? p.parentElement.getBoundingClientRect().width : null; }""")
    lines = page.evaluate("""() => { const p = document.querySelector('[data-testid="worker-root-error"]');
      return p ? Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) : null; }""")
    page.unroute("**/api/v1/settings")
    page.screenshot(path=str(SHOTS / "desk-fit-settings-error.png"))
    check("long-error-wraps",
          er is not None and er["width"] <= 232 and lines is not None and lines >= 3
          and label_after is not None and label_before is not None and label_after >= label_before - 4 and label_after >= 300
          and err.inner_text().strip().endswith(LONG_REFUSAL[-40:]),
          error=er, lines=lines, label_before=label_before, label_after=label_after)

    # ── 4. Esc from the focused player (studio#509) ───────────────────────────────────────────
    set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[], reset_walkthrough=True)
    page.set_viewport_size({"width": W, "height": 900})
    page.goto(f"{origin}/s/run%3Ar-walk-demo", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    page.wait_for_function(f"""() => {{ const v = document.querySelector('{ART} [data-testid="walkthrough-video"]'); return !!v && v.readyState >= 1; }}""", timeout=15000)
    page.locator(f"{ART} [data-testid='artifact-grow']").click()
    page.wait_for_function(f"() => document.querySelector('{ART}')?.dataset.size === 'pane'", timeout=5000)
    # A keyboard user's way onto the player: Shift+Tab from the first chapter mark.
    page.locator(f'{ART} [data-testid="walkthrough-marker"]').first.focus()
    page.keyboard.press("Shift+Tab")
    on_player = page.evaluate("() => document.activeElement?.dataset.testid === 'walkthrough-video'")
    page.keyboard.press("Escape")
    try:
        page.wait_for_function(f"() => document.querySelector('{ART}')?.dataset.size === 'inline'", timeout=3000)
        shrank = True
    except Exception:  # noqa: BLE001
        shrank = False
    size = page.evaluate(f"() => document.querySelector('{ART}')?.dataset.size")
    page.screenshot(path=str(SHOTS / "desk-fit-esc-player.png"))
    check("esc-from-player", on_player and shrank and size == "inline", on_player=on_player, size=size)

    overflow = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors", not errors and not overflow, errors=errors[:5], overflow=overflow)
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
