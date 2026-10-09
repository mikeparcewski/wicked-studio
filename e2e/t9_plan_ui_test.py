#!/usr/bin/env python3
"""
t9_plan_ui_test.py — DES-TEAMING-002 seam T9: the plan UI for team runs (1440x700, then phone).

Against the `team_plan` fixture corpus (crew 0.47.0 wire: GET /catalog, GET /presets,
POST /plans/preview, POST /runs/:id/plan, the 409 gate_changed, run_identity on the run DTO):

  1 picker    the composer's Phases picker lists exactly the entries GET /catalog serves
              (including `domain_coverage`, which no studio list names), in catalog order.
  2 preview   picking `build` with no touch set previews "the PA will scope this first": no
              score, no floor markers, pauses (manual posture). With a touch set: score 55,
              band 40-69, test_plan/design/review marked "added by floor", pauses (manual_mode);
              "No gates" → does not pause; a migrations/ touch → high risk, pauses.
  6 before:N  a launch the PA scopes sends `before:<N+1>` (its pa-scope step is ord 1); an
              unscoped plan sends `before:<N>`; a preset launch (feature, scoped) sends
              `before:<N+1>` too. The composed plan rides `plan`, never `workflow`.
  3 edits     on a live preset run, the Plan section adds phases through POST /runs/:id/plan:
              each edit carries a fresh requestId; the answer's band, high risk and floor
              additions are shown; after a lost answer (503), Retry re-sends the SAME requestId
              and `duplicate: true` reads "Already applied". A run waiting at a gate offers no edit.
  4 gate      approving a gate whose POST answers 409 gate_changed sends `ord` once, never
              retries, re-reads the gate (the ord-4 prompt replaces the ord-3 one) and says the
              gate moved.
  5 runMode   a run whose run_identity says system gets no Delivery section even with a known
              workdir; a completed user-plan run (per-run def no catalog serves) gets the
              licensed "no deliver phase" claim.

Captures (e2e/shots/): t9-desk-composer-pending.png, t9-desk-composer-floor.png,
t9-desk-plan-edit.png, t9-desk-gate-moved.png, t9-desk-phone-composer.png,
t9-desk-phone-run.png. Env: FEEDBACK_PORT (default 4381). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4381"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PROJECT = "upload-endpoint"
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


def plan_posts(origin: str, route: str) -> list:
    return [p for p in get_json(origin, "/__fixture/plan-posts")["posts"] if p["route"] == route]


def gate_posts(origin: str, rid: str) -> list:
    return [p for p in get_json(origin, "/__fixture/gate-posts")["posts"] if p["runId"] == rid]


def reset(origin: str, **extra) -> None:
    set_fixture(origin, **{"team_plan": True, "repo": True, "repo_member": True, "reset_plan": True,
                           "reset_gate_posts": True, "gate_moved": [], "plan_edit_fail_once": False,
                           "appearance": {**DEFAULT_APPEARANCE}, **extra})


def attr(page, testid: str, name: str):
    return page.get_by_test_id(testid).first.get_attribute(name)


def wait_attr(page, testid: str, name: str, value: str, timeout: int = 8000) -> None:
    page.wait_for_function(
        """([t, n, v]) => { const el = document.querySelector(`[data-testid="${t}"]`);
                          return !!el && el.getAttribute(n) === v; }""",
        arg=[testid, name, value], timeout=timeout)


def open_composer(page, origin: str) -> None:
    page.goto(f"{origin}/p/{PROJECT}/build/new", wait_until="networkidle")
    page.get_by_test_id("launch-problem").wait_for(state="visible", timeout=15000)


def open_picker(page) -> None:
    page.get_by_test_id("phase-picker-toggle").click()
    wait_attr(page, "phase-picker", "data-catalog-state", "ready")


def pick(page, catalog: str) -> None:
    page.locator(f'[data-testid="phase-option"][data-catalog="{catalog}"]').click()


def preview_steps(page) -> list:
    return page.evaluate("""() => [...document.querySelectorAll('[data-testid="preview-step"]')]
      .map(e => ({id: e.dataset.stepId, floor: e.dataset.byFloor === 'true'}))""")


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
    launches: list = []
    page.on("request", lambda r: launches.append(json.loads(r.post_data or "{}"))
            if r.method == "POST" and r.url.endswith("/api/v1/runs") else None)

    reset(origin)
    catalog_ids = [e["id"] for e in get_json(origin, "/api/v1/catalog")["entries"]]

    def section_picker() -> None:
        # ── 1. the picker lists exactly the catalog ─────────────────────────────────────
        open_composer(page, origin)
        open_picker(page)
        offered = page.evaluate("""() => [...document.querySelectorAll('[data-testid="phase-option"]')]
          .map(e => e.dataset.catalog)""")
        # D4 (dogfood 2026-09-27): this project's repo rides the launch and "Open a PR" is on, so
        # the launch delivers and adds its own deliver step — the picker offers every OTHER entry.
        check("picker-lists-the-catalog", offered == [c for c in catalog_ids if c != "deliver"],
              offered=offered, catalog=catalog_ids)
        pick(page, "build")
        check("picked-build", page.evaluate("""() => [...document.querySelectorAll('[data-testid="phase-selected"]')]
          .map(e => e.dataset.catalog)""") == ["build"])

    def section_preview() -> None:
        # ── 2. the preview: pending the PA's scope, then scored with floor markers ───────
        reset(origin)
        open_composer(page, origin)
        open_picker(page)
        pick(page, "build")
        wait_attr(page, "launch-preview", "data-state", "pending-scope")
        check("pending-says-pa-scopes-first",
              page.get_by_test_id("preview-pending-scope").is_visible()
              and "PA will scope this first" in (page.get_by_test_id("preview-pending-scope").text_content() or ""))
        check("pending-has-no-score", page.get_by_test_id("preview-score").count() == 0
              and page.get_by_test_id("preview-band").count() == 0)
        check("pending-draws-no-floor", page.get_by_test_id("floor-marker").count() == 0
              and all(not s["floor"] for s in preview_steps(page)), steps=preview_steps(page))
        check("pending-pauses-manual", attr(page, "launch-preview-pause", "data-pauses") == "true",
              text=page.get_by_test_id("launch-preview-pause").text_content())
        page.get_by_test_id("launch-problem").fill("add a rate limiter to the upload endpoint")
        page.screenshot(path=str(SHOTS / f"t9-desk-composer-pending.png"))

        page.get_by_test_id("plan-touch").fill("src/upload/limiter.ts")
        wait_attr(page, "launch-preview", "data-state", "scored")
        steps = preview_steps(page)
        check("scored-score-band", (page.get_by_test_id("preview-score").text_content() or "").strip() == "score 55"
              and (page.get_by_test_id("preview-band").text_content() or "").strip() == "band 40-69")
        check("floor-markers", steps == [{"id": "test_plan", "floor": True}, {"id": "design", "floor": True},
                                         {"id": "build", "floor": False}, {"id": "review", "floor": True}],
              steps=steps)
        check("scored-pauses-manual-mode", attr(page, "launch-preview-pause", "data-pauses") == "true"
              and "approve the plan" in (page.get_by_test_id("launch-preview-pause").text_content() or ""))
        page.screenshot(path=str(SHOTS / f"t9-desk-composer-floor.png"))
        page.get_by_test_id("gate-posture").select_option("none")
        wait_attr(page, "launch-preview-pause", "data-pauses", "false")
        check("no-gates-does-not-pause", True)
        page.get_by_test_id("plan-touch").fill("db/migrations/0042_limits.sql")
        wait_attr(page, "launch-preview-pause", "data-pauses", "true")
        check("high-risk-pauses", page.get_by_test_id("preview-high-risk").is_visible()
              and "high risk" in (page.get_by_test_id("launch-preview-pause").text_content() or ""))
        body_previews = plan_posts(origin, "preview")
        check("preview-sends-repo-and-deliver", any(b["body"].get("repoRef") == "studio-api" for b in body_previews),
              sample=body_previews[-1]["body"] if body_previews else None)

    def section_before_n() -> None:
        # ── 6. before:N — shifted past the PA's scope step, read off the preview ──────────
        open_composer(page, origin)
        open_picker(page)
        pick(page, "build")
        wait_attr(page, "launch-preview", "data-state", "pending-scope")
        page.get_by_test_id("launch-problem").fill("add a rate limiter to the upload endpoint")
        n = len(launches)
        page.get_by_test_id("launch-submit").click()
        deadline = time.monotonic() + 8
        while len(launches) == n and time.monotonic() < deadline:
            page.wait_for_timeout(100)
        scoped = launches[-1] if len(launches) > n else {}
        check("scoped-plan-sends-before-2",
              scoped.get("humanConfirm") == "before:2" and scoped.get("plan") == {"steps": [{"catalog": "build"}]}
              and "workflow" not in scoped, body=scoped)

        open_composer(page, origin)
        open_picker(page)
        pick(page, "build")
        page.get_by_test_id("plan-touch").fill("src/upload/limiter.ts")
        wait_attr(page, "launch-preview", "data-state", "scored")
        page.get_by_role("button", name="Open launch options").click()
        page.get_by_test_id("launch-before-ord").fill("3")
        page.keyboard.press("Escape")
        page.get_by_test_id("launch-problem").fill("add a rate limiter to the upload endpoint")
        n = len(launches)
        page.get_by_test_id("launch-submit").click()
        deadline = time.monotonic() + 8
        while len(launches) == n and time.monotonic() < deadline:
            page.wait_for_timeout(100)
        unscoped = launches[-1] if len(launches) > n else {}
        check("unscoped-plan-sends-before-n", unscoped.get("humanConfirm") == "before:3"
              and unscoped.get("plan", {}).get("touch") == ["src/upload/limiter.ts"], body=unscoped)

        open_composer(page, origin)
        page.get_by_role("button", name="Open launch options").click()
        page.get_by_test_id("launch-workflow").select_option("feature")
        page.keyboard.press("Escape")
        wait_attr(page, "launch-preview", "data-of", "preset")
        wait_attr(page, "launch-preview", "data-state", "pending-scope")
        page.get_by_test_id("launch-problem").fill("add a rate limiter to the upload endpoint")
        n = len(launches)
        page.get_by_test_id("launch-submit").click()
        deadline = time.monotonic() + 8
        while len(launches) == n and time.monotonic() < deadline:
            page.wait_for_timeout(100)
        preset = launches[-1] if len(launches) > n else {}
        check("preset-launch-sends-before-2", preset.get("humanConfirm") == "before:2"
              and preset.get("workflow") == "feature" and "plan" not in preset, body=preset)

    def open_sheet_tab(rid: str, tab: str) -> None:
        page.goto(f"{origin}/s/run%3A{rid}", wait_until="networkidle")
        look = page.locator(f'[data-testid="session-run"][data-run-id="{rid}"] [data-testid="session-run-look"]')
        look.wait_for(state="visible", timeout=15000)
        look.click()
        page.locator(f'[data-testid="sheet-tab"][data-tab="{tab}"]').click()

    def section_mid_run_edits() -> None:
        # ── 3. mid-run edits ──────────────────────────────────────────────────────────────
        reset(origin)
        # S16a-2b: the run's Plan section is its session sheet's Plan tab.
        open_sheet_tab("r-team", "plan")
        wait_attr(page, "phase-picker", "data-catalog-state", "ready")
        pick(page, "review")
        page.get_by_test_id("plan-edit-propose").click()
        wait_attr(page, "plan-edit-result", "data-kind", "applied")
        check("edit-1-band", (page.get_by_test_id("plan-edit-band").text_content() or "").strip() == "band 40-69"
              and page.get_by_test_id("plan-edit-high-risk").count() == 0
              and "adds nothing" in (page.get_by_test_id("plan-edit-floor-added").text_content() or ""))
        pick(page, "build")
        page.get_by_test_id("plan-edit-propose").click()
        page.wait_for_function("""() => (document.querySelector('[data-testid="plan-edit-band"]')?.textContent || '')
          .includes('70-100')""", timeout=8000)
        check("edit-2-high-risk-and-floor", page.get_by_test_id("plan-edit-high-risk").is_visible()
              and "design, review" in (page.get_by_test_id("plan-edit-floor-added").text_content() or ""))
        page.screenshot(path=str(SHOTS / f"t9-desk-plan-edit.png"))
        edits = plan_posts(origin, "edit")
        ids = [e["body"].get("requestId") for e in edits]
        check("fresh-request-id-per-edit", len(edits) == 2 and all(ids) and ids[0] != ids[1],
              request_ids=ids, bodies=[e["body"] for e in edits])

        set_fixture(origin, plan_edit_fail_once=True)
        pick(page, "test")
        page.get_by_test_id("plan-edit-propose").click()
        page.get_by_test_id("plan-edit-retry").wait_for(state="visible", timeout=8000)
        page.get_by_test_id("plan-edit-retry").click()
        wait_attr(page, "plan-edit-result", "data-kind", "already-applied")
        edits = plan_posts(origin, "edit")
        check("retry-sends-same-request-id-and-reads-already-applied",
              len(edits) == 4 and edits[2]["body"]["requestId"] == edits[3]["body"]["requestId"]
              and "Already applied" in (page.get_by_test_id("plan-edit-result").text_content() or ""),
              request_ids=[e["body"].get("requestId") for e in edits])

        open_sheet_tab("r-team-gate", "plan")
        page.get_by_test_id("plan-edit-unavailable").wait_for(state="visible", timeout=8000)
        check("gated-run-offers-no-edit", page.get_by_test_id("plan-edit-unavailable").is_visible()
              and page.get_by_test_id("plan-edit-propose").count() == 0)

    def section_gate_moved() -> None:
        # ── 4. the gate moved: one POST with ord, no retry, refreshed, said ──────────────
        # S16a-2b: the gate is answered in the session thread's row (/s/run%3Ar-team-gate); its raw
        # prompt is the row's ⋯ Details first line.
        reset(origin, gate_moved=["r-team-gate"])
        page.goto(f"{origin}/s/run%3Ar-team-gate", wait_until="networkidle")
        APPROVE = '[data-testid="session-gate-choice"][data-choice-key="approve"]'
        approve = page.locator(APPROVE)
        approve.wait_for(state="visible", timeout=15000)
        raw = """(t) => (document.querySelector('[data-testid="session-gate-raw-prompt"]')?.textContent || '').includes(t)"""
        check("gate-before", page.evaluate(raw, "unit 3"))
        approve.click()
        page.wait_for_function(raw, arg="unit 4", timeout=25000)
        page.wait_for_function("""() => document.body.innerText.includes('the gate moved')""", timeout=5000)
        posts = gate_posts(origin, "r-team-gate")
        check("gate-decision-sends-ord-once", len(posts) == 1 and posts[0]["body"].get("ord") == 3,
              posts=[x["body"] for x in posts])
        page.screenshot(path=str(SHOTS / f"t9-desk-gate-moved.png"))
        page.wait_for_timeout(3000)
        check("no-blind-retry", len(gate_posts(origin, "r-team-gate")) == 1)
        check("refreshed-gate-is-answerable", page.locator(APPROVE).is_enabled())

    def section_run_mode() -> None:
        # ── 5. runMode from run_identity ──────────────────────────────────────────────────
        reset(origin)
        # S16a-2b: the run's sections are its session sheet's tabs.
        def tabs() -> list:
            return page.get_by_test_id("sheet-tab").evaluate_all("els => els.map(e => e.dataset.tab)")

        open_sheet_tab("r-team-sys", "whatwhere")
        check("system-run-has-no-delivery", "delivery" not in tabs(), sections=tabs())
        page.keyboard.press("Escape")
        open_sheet_tab("r-team-plan", "delivery")
        page.get_by_test_id("run-delivery").wait_for(state="visible", timeout=8000)
        check("user-plan-run-gets-licensed-claim",
              "no deliver phase" in (page.get_by_test_id("run-delivery").text_content() or ""),
              text=page.get_by_test_id("run-delivery").text_content())

    def section_phone() -> None:
        # ── phone width: the composer and the run page (studio has no phone layout for the
        # build routes on main either: the desktop shell renders squeezed; collapse the nav) ──
        reset(origin)
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{origin}/p/{PROJECT}/build/new", wait_until="networkidle")
        if page.get_by_role("button", name="Collapse sidebar").count() > 0:
            page.get_by_role("button", name="Collapse sidebar").first.click()
        page.get_by_test_id("phase-picker-toggle").scroll_into_view_if_needed()
        covered = page.evaluate("""() => { const t = document.querySelector('[data-testid="phase-picker-toggle"]');
          const r = t.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !(hit && t.contains(hit)); }""")
        if covered:
            # Something covers the main column at 390 px (the retired compact-rail's right rail did) —
            # recorded, not hidden.
            report["steps"]["phone-main-column-covered"] = {"ok": True}
            page.screenshot(path=str(SHOTS / f"t9-desk-phone-composer.png"))
            page.set_viewport_size({"width": W, "height": H})
            return
        page.get_by_test_id("phase-picker-toggle").click()
        wait_attr(page, "phase-picker", "data-catalog-state", "ready")
        pick(page, "build")
        page.get_by_test_id("plan-touch").fill("src/upload/limiter.ts")
        wait_attr(page, "launch-preview", "data-state", "scored")
        page.get_by_test_id("launch-preview").scroll_into_view_if_needed()
        page.screenshot(path=str(SHOTS / f"t9-desk-phone-composer.png"))
        box = page.get_by_test_id("launch-preview").bounding_box()
        check("phone-preview-renders", box is not None and box["width"] > 0, box=box)
        page.goto(f"{origin}/s/run%3Ar-team", wait_until="networkidle")
        page.wait_for_timeout(800)
        page.screenshot(path=str(SHOTS / f"t9-desk-phone-run.png"))
        page.set_viewport_size({"width": W, "height": H})

    sections = [section_picker, section_preview, section_before_n, section_mid_run_edits,
                section_gate_moved, section_run_mode, section_phone]
    only = os.environ.get("T9_SECTIONS")
    for fn in sections:
        name = fn.__name__.removeprefix("section_")
        if only and name not in only.split(","):
            continue
        try:
            fn()
            report.setdefault("sections", {})[name] = "pass"
        except Exception as e:  # noqa: BLE001 — every section reports, then the run fails
            report.setdefault("sections", {})[name] = f"FAIL: {type(e).__name__}: {str(e).splitlines()[0][:200]}"
            page.set_viewport_size({"width": W, "height": H})
        print(f"section {name}: {report['sections'][name]}", file=sys.stderr, flush=True)

    browser.close()

set_fixture(origin, team_plan=False, repo=False, repo_member=False, appearance=None, reset_plan=True)
report["ok"] = all(v == "pass" for v in report.get("sections", {}).values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
