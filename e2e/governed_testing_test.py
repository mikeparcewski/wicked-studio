#!/usr/bin/env python3
"""
governed_testing_test.py — the governed testing journey (wave 6, api-types 0.36.0) in a real
browser against the shared loopback fixture (uxfix_fixture.py, switch `governed_testing`).
No crew daemon is involved. Acceptance findings F-075 / F-076 / F-7R2-003 / -005 / -006 /
-008 / -009 / -010 / -011 / -012 / -013 / -014 / -017, studio half.

  1. ROUTES (F-075 / F-7R2-009): `/testing` and `/testing/harness` land on the TEST landing
     (h2 "Test", `campaigns-page`), not Evals; `/testing/evals` stays Evals.
  2. NEW TEST (F-7R2-003 / -011 / -008): the panel names the `qe-author-tests` workflow and its
     five phases (read off GET /workflows), the launch rides POST /testing/author with the
     attached repo, the panel then LINKS the run (`testing-launch-fanout-run`), names the
     workflow + wire and shows the waiting line; the intake gate arrives over /ws and the card
     carries the PLAN — five phases with executor / skill / seat. Project chips carry a DROP
     button (F-076). Screenshots at 1440x700 and 400px.
  3. THE PRODUCED SET (F-7R2-014): the landing's card shows "2 test files · 11 tests · 11
     executed · 11 passed · 0 failed" off the campaign's `test_set`, the workflow chip, the plan.
  4. THE RUN PAGE (F-7R2-005 / -006 / -012 / -013 / -017): the run head says "council degraded:
     4 of 5 seats benched …"; the feed says "Gate UNGATED on author — no eligible judge seat …"
     (never "Checks ran — pass" for that gate) and "Refused a remote write by claude (creator)
     … gh pr create … delivery is performed by the run's deliver phase"; the Files section
     offers Full diff and the viewer labels the answer as the run branch (`source: "branch"`).
  5. THE PLAIN FALLBACK: with `governed_testing_workflow_absent`, the panel shows the honest
     banner "this daemon has no governed test workflow — plain run" BEFORE launching, and the
     launch takes POST /testing/recon (the fixture answers the standing 404 for /testing/author).

Captures (device_scale_factor=1) into e2e/shots/governed-testing/:
  gt-landing.png (1440x700)  gt-intake-plan.png (1440x700)  gt-intake-plan-400.png (400x900)
  gt-run-page.png (1440x700)

Prereqs: Python Playwright with Chromium installed (never installed here). Builds
dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale
dist-sameorigin/ when the source changed. Env knobs: FEEDBACK_PORT (default 4436),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys

from uxfix_fixture import (
    GT_DEGRADED_REASON,
    GT_INTAKE_PROMPT,
    GT_REMEDY,
    GT_RUN,
    GT_UNGATED_REASON,
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4436"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
SHOTS = REPO / "e2e" / "shots" / "governed-testing"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
# The governed corpus + the registered repo the panel attaches (`repo` lights GET /repos).
set_fixture(ORIGIN, governed_testing=True, repo=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

SHOTS.mkdir(parents=True, exist_ok=True)


def text(page, selector: str) -> str:
    loc = page.locator(selector)
    return loc.first.text_content() if loc.count() > 0 else ""


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    posted: list = []
    page.on("request", lambda r: posted.append((r.method, r.url.replace(ORIGIN, ""), r.post_data))
            if r.method == "POST" and "/api/v1/" in r.url else None)

    def settled(expr: str, arg=None, timeout=30000) -> bool:
        try:
            page.wait_for_function(expr, arg=arg, timeout=timeout)
            return True
        except Exception:
            return False

    # ── Scene 1: the routes land on Test (F-075 / F-7R2-009) ──────────────────────
    routes = {}
    for path_ in ("/testing", "/testing/harness", "/testing/evals"):
        page.goto(f"{ORIGIN}{path_}", wait_until="domcontentloaded")
        page.locator('[data-testid="testing-page"]').first.wait_for(timeout=30000)
        settled("""() => location.pathname !== '/testing' && location.pathname !== '/testing/harness'""", timeout=10000)
        routes[path_] = {
            "landed": page.evaluate("() => location.pathname"),
            "page": page.locator('[data-testid="testing-page"]').first.get_attribute("data-testing-page"),
            "h2": text(page, '[data-testid="testing-page"] h2').strip(),
        }
    check(
        "routes_land_on_test",
        routes["/testing"] == {"landed": "/testing/campaigns", "page": "campaigns", "h2": "Test"}
        and routes["/testing/harness"] == {"landed": "/testing/campaigns", "page": "campaigns", "h2": "Test"}
        and routes["/testing/evals"] == {"landed": "/testing/evals", "page": "evals", "h2": "Evals"},
        **routes,
    )

    # ── Scene 3 (first, the landing is already here): the produced set ─────────────
    page.goto(f"{ORIGIN}/testing/campaigns", wait_until="domcontentloaded")
    page.locator('[data-testid="campaign-card"]').first.wait_for(timeout=30000)
    card = page.evaluate(
        """() => {
          const c = document.querySelector('[data-testid="campaign-card"]');
          const t = (s) => c?.querySelector(s)?.textContent?.trim() ?? '';
          const set = c?.querySelector('[data-testid="campaign-card-testset"]');
          return {
            kind: c?.getAttribute('data-kind'),
            title: (c?.textContent ?? '').includes('Tests · studio-api · run lifecycle'),
            workflow: c?.querySelector('[data-testid="campaign-card-workflow"]')?.getAttribute('data-workflow'),
            set: t('[data-testid="campaign-card-testset"]'),
            tests: set?.getAttribute('data-tests'), executed: set?.getAttribute('data-executed'),
            passed: set?.getAttribute('data-passed'), failed: set?.getAttribute('data-failed'),
            unverified: !!c?.querySelector('[data-testid="campaign-card-testset-unverified"]'),
            plan: t('[data-testid="campaign-card-testset-plan"]'),
            delivery: t('[data-testid="campaign-card-delivery"]'),
            header: document.querySelector('[data-testid="campaigns-header-copy"]')?.textContent ?? '',
            authorVerb: document.querySelector('[data-testid="testing-author-open"]')?.textContent?.trim(),
            testsKpi: document.querySelector('[data-testid="stat-campaigns"]')?.textContent ?? '',
          };
        }""")
    check(
        "landing_shows_produced_set",
        card["kind"] == "campaign" and card["title"]
        and card["workflow"] == "qe-author-tests"
        and card["set"].startswith("2 test files · 11 tests · 11 executed · 11 passed · 0 failed")
        and (card["tests"], card["executed"], card["passed"], card["failed"]) == ("11", "11", "11", "0")
        and not card["unverified"]
        and card["plan"] == "plan: tests/PLAN-run-lifecycle.md"
        and "1 of 1 delivered" in card["delivery"]
        and "qe-author-tests" in card["header"]
        and card["authorVerb"] == "Add testing rules",
        **card,
    )
    page.screenshot(path=str(SHOTS / "gt-landing.png"))

    # ── Scene 2: New test — governed launch, link + waiting, the intake plan ────────
    page.locator('[data-testid="testing-campaign-open"]').click()
    panel = page.locator('[data-testid="testing-launch-panel"]')
    panel.wait_for(timeout=10000)
    page.locator('[data-testid="testing-launch-workflow"]').wait_for(timeout=15000)
    pre = page.evaluate(
        """() => {
          const p = document.querySelector('[data-testid="testing-launch-panel"]');
          return {
            governed: p?.getAttribute('data-governed'),
            chip: p?.querySelector('[data-testid="testing-launch-workflow"]')?.textContent ?? '',
            banner: !!p?.querySelector('[data-testid="testing-launch-plain-banner"]'),
            blurb: (p?.textContent ?? '').includes('deliver — the engine, never the worker — opens the PR'),
          };
        }""")
    check(
        "panel_names_the_workflow",
        pre["governed"] == "true"
        and pre["chip"] == "qe-author-tests · recon → author → verify → review → deliver"
        and not pre["banner"] and pre["blurb"],
        **pre,
    )
    page.locator('[data-testid="testing-launch-instructions"]').fill("Cover the run lifecycle UI")
    page.locator('[data-testid="testing-launch-repo-search"]').fill("studio")
    page.locator('[data-testid="testing-launch-repo-option"]').first.click()
    page.locator('[data-testid="testing-launch-chip"][data-source="explicit"]').wait_for(timeout=5000)
    page.locator('[data-testid="testing-launch-submit"]').click()
    page.locator('[data-testid="testing-launch-waiting"]').wait_for(timeout=15000)
    launched = page.evaluate(
        """() => {
          const p = document.querySelector('[data-testid="testing-launch-panel"]');
          const t = (s) => p?.querySelector(s)?.textContent ?? '';
          return {
            route: p?.querySelector('[data-testid="testing-launch-launched"]')?.getAttribute('data-route'),
            link: p?.querySelector('[data-testid="testing-launch-fanout-run"]')?.getAttribute('data-run-id'),
            waiting: t('[data-testid="testing-launch-waiting"]'),
            workflow: t('[data-testid="testing-launch-launched-workflow"]'),
            routeLine: t('[data-testid="testing-launch-route"]'),
            label: t('[data-testid="testing-launch-fanout-label"]'),
          };
        }""")
    author_posts = [pd for m, u, pd in posted if u == "/api/v1/testing/author"]
    body = json.loads(author_posts[0]) if author_posts else None
    check(
        "governed_launch_links_the_run",
        launched["route"] == "testing-author"
        and launched["link"] == "r-gt-1"
        and "r-gt-1" in launched["waiting"] and "intake gate will appear here" in launched["waiting"]
        and launched["workflow"] == "qe-author-tests"
        and "via POST /testing/author" in launched["routeLine"]
        and launched["label"] == "author-r-gt-1"
        and body is not None and body.get("repoRefs") == ["studio-api"] and "projectId" not in body
        and body.get("problem", "").startswith("New test: plan the test for the attached scope")
        and not any(u in ("/api/v1/testing/recon", "/api/v1/runs") for _, u, _ in posted),
        posted=[(m, u) for m, u, _ in posted], body=body, **launched,
    )

    # The intake gate arrives over /ws; the card carries the PLAN (F-7R2-008).
    page.locator('[data-testid="intake-plan"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    plan = page.evaluate(
        """() => {
          const p = document.querySelector('[data-testid="testing-launch-panel"]');
          const plan = p?.querySelector('[data-testid="intake-plan"]');
          const rows = Array.from(plan?.querySelectorAll('[data-testid="intake-plan-unit"]') ?? []);
          return {
            units: plan?.getAttribute('data-units'),
            workflow: plan?.getAttribute('data-workflow'),
            head: (plan?.textContent ?? '').includes('The plan you are approving — 5 phases · workflow qe-author-tests'),
            rows: rows.map(r => [r.dataset.ord, r.dataset.phase, r.dataset.executor, r.dataset.seat ?? null]),
            seats: rows.map(r => r.querySelector('[data-testid="intake-plan-seat"]')?.textContent ?? ''),
            skills: rows.map(r => r.querySelector('[data-testid="intake-plan-skill"]')?.textContent ?? null),
            prompt: p?.querySelector('[data-testid="steering-prompt"]')?.textContent?.trim() ?? '',
            gateRun: p?.querySelector('[data-testid="steering-gate"]')?.getAttribute('data-run-id'),
            waitingGone: !p?.querySelector('[data-testid="testing-launch-waiting"]'),
            linkStays: !!p?.querySelector('[data-testid="testing-launch-fanout-run"]'),
          };
        }""")
    check(
        "intake_gate_shows_the_plan",
        plan["units"] == "5" and plan["workflow"] == "qe-author-tests" and plan["head"]
        and plan["rows"] == [["1", "recon", "agent", "claude"], ["2", "author", "agent", None],
                             ["3", "verify", "tool", None], ["4", "review", "agent", None],
                             ["5", "deliver", "tool", None]]
        and plan["seats"][0] == "seat: claude"
        and plan["seats"][1] == "council picks from claude, codex, pi"
        and plan["seats"][2] == "no seat — a direct command"
        and plan["skills"][1] == "wicked-garden-qe"
        and plan["prompt"] == GT_INTAKE_PROMPT
        and plan["gateRun"] == "r-gt-1" and plan["waitingGone"] and plan["linkStays"],
        **plan,
    )
    page.locator('[data-testid="intake-plan"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "gt-intake-plan.png"))

    # Phone width (400px): the rail is collapsed to its icon column (the shell keeps the expanded
    # rail at any width — a phone user collapses it); the panel, the plan and the gate card then
    # hold one column ≥ 280px wide, no horizontal scroll.
    page.set_viewport_size({"width": 400, "height": 900})
    page.get_by_role("button", name="Collapse sidebar").click()
    page.wait_for_timeout(300)
    narrow = page.evaluate(
        """() => ({
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          plan: !!document.querySelector('[data-testid="intake-plan"]'),
          panelW: document.querySelector('[data-testid="testing-launch-panel"]')?.getBoundingClientRect().width,
          planW: document.querySelector('[data-testid="intake-plan"]')?.getBoundingClientRect().width,
        })""")
    check(
        "phone_width_no_horizontal_scroll",
        narrow["scrollW"] <= narrow["innerW"] + 1 and narrow["plan"] and (narrow["panelW"] or 0) >= 280,
        **narrow,
    )
    page.locator('[data-testid="intake-plan"]').scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "gt-intake-plan-400.png"), full_page=False)
    page.get_by_role("button", name="Expand sidebar").click()
    page.set_viewport_size({"width": 1440, "height": 700})

    # F-076 / review F-9: a project's chips carry a DROP button each. The fixture's `upload-endpoint`
    # holds one `crew.repo` member (studio-api) under the governed switch — pick it, expect ONE
    # via-project chip WITH its drop button, drop it, and see the dropped line refuse the launch.
    page.goto(f"{ORIGIN}/testing/campaigns?new=test", wait_until="domcontentloaded")
    page.locator('[data-testid="testing-launch-panel"]').wait_for(timeout=15000)
    select = page.locator('[data-testid="testing-launch-project"]')
    select.wait_for(timeout=10000)
    page.wait_for_function(
        """() => Array.from(document.querySelectorAll('[data-testid="testing-launch-project"] option')).some(o => o.value === 'upload-endpoint')""",
        timeout=10000)
    select.select_option("upload-endpoint")
    page.locator('[data-testid="testing-launch-chip"][data-source="project"]').first.wait_for(timeout=10000)
    chips = page.evaluate(
        """() => ({
          chips: Array.from(document.querySelectorAll('[data-testid="testing-launch-chip"]')).map(c => [c.dataset.repo, c.dataset.source]),
          drops: Array.from(document.querySelectorAll('[data-testid="testing-launch-chip-remove"]')).map(d => [d.dataset.repo, d.dataset.source, d.getAttribute('aria-label')]),
        })""")
    page.locator('[data-testid="testing-launch-chip-remove"][data-repo="studio-api"]').click()
    page.locator('[data-testid="testing-launch-dropped"]').wait_for(timeout=5000)
    dropped = page.evaluate(
        """() => ({
          text: document.querySelector('[data-testid="testing-launch-dropped"]')?.textContent ?? '',
          count: document.querySelector('[data-testid="testing-launch-dropped"]')?.getAttribute('data-count'),
          chipsLeft: document.querySelectorAll('[data-testid="testing-launch-chip"]').length,
          restore: !!document.querySelector('[data-testid="testing-launch-restore"]'),
        })""")
    check(
        "project_chips_are_droppable",
        chips["chips"] == [["studio-api", "project"]]
        and chips["drops"] == [["studio-api", "project", "Drop studio-api from this test"]]
        and dropped["count"] == "1" and dropped["chipsLeft"] == 0 and dropped["restore"]
        and "nothing left to test: keep one, attach a codebase, or clear the project" in dropped["text"],
        **chips, **dropped,
    )

    # ── Scene 4: the run page — degraded council, UNGATED, the refused remote write, the branch diff ──
    page.goto(f"{ORIGIN}/runs/{GT_RUN}", wait_until="domcontentloaded")
    page.locator('[data-testid="run-header"]').first.wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    got_degraded = settled("""() => !!document.querySelector('[data-testid="run-degraded"]')""")
    feed_ok = settled(
        """() => Array.from(document.querySelectorAll('[data-testid="narration-line"]'))
              .some(n => /Refused a remote write/.test(n.textContent ?? ''))""")
    head = page.evaluate(
        """() => {
          const d = document.querySelector('[data-testid="run-degraded"]');
          const lines = Array.from(document.querySelectorAll('[data-testid="narration-line"]')).map(n => (n.textContent ?? '').trim());
          return {
            degraded: d?.textContent ?? '', degradedUnits: d?.getAttribute('data-units'),
            ungated: lines.filter(t => /Gate UNGATED/.test(t)),
            checksRanPass: lines.filter(t => /Checks ran on .* — pass/.test(t)),
            refused: lines.filter(t => /Refused a remote write/.test(t)),
            routed: lines.filter(t => /routed to .* council degraded/.test(t)),
          };
        }""")
    check(
        "run_page_honest_gates",
        got_degraded and feed_ok
        and head["degraded"].startswith(f"council degraded: {GT_DEGRADED_REASON}")
        and head["degradedUnits"] == "2"
        # Feed lines carry the tone glyph first ("◆Gate UNGATED …") — match the sentence, not the glyph.
        and any(t.endswith(f"Gate UNGATED on author — {GT_UNGATED_REASON}; repository checks ran, no distinct judge") for t in head["ungated"])
        and head["checksRanPass"] == []
        and any("Refused a remote write by claude (creator) during author" in t
                and "gh pr create" in t and t.endswith(f"— {GT_REMEDY}") for t in head["refused"])
        and len(head["routed"]) == 2,
        **head,
    )
    # The Files section: Full diff is offered on the completed run and the viewer names the branch.
    page.get_by_role("button", name=re.compile(r"Files")).first.click()
    page.locator('[data-testid="files-full-diff"]').first.wait_for(timeout=10000)
    page.locator('[data-testid="files-full-diff"]').first.click()
    page.locator('[data-testid="diff-baseline-note"]').wait_for(timeout=15000)
    diff = page.evaluate(
        """() => {
          const note = document.querySelector('[data-testid="diff-baseline-note"]');
          return {
            source: note?.getAttribute('data-source'), note: note?.textContent ?? '',
            adds: document.querySelectorAll('[data-testid="diff-line-add"]').length,
            cause: !!document.querySelector('[data-testid="diff-named-cause"]'),
          };
        }""")
    check(
        "files_view_reads_the_run_branch",
        diff["source"] == "branch" and "showing the run branch vs its base" in diff["note"]
        and diff["adds"] >= 3 and not diff["cause"],
        **diff,
    )
    page.keyboard.press("Escape")
    page.screenshot(path=str(SHOTS / "gt-run-page.png"))

    # ── Scene 5: the plain fallback — no governed workflow on this daemon ─────────────
    set_fixture(ORIGIN, governed_testing_workflow_absent=True)
    posted.clear()
    page.goto(f"{ORIGIN}/testing/campaigns?new=test", wait_until="domcontentloaded")
    page.locator('[data-testid="testing-launch-plain-banner"]').wait_for(timeout=15000)
    banner = page.evaluate(
        """() => {
          const p = document.querySelector('[data-testid="testing-launch-panel"]');
          return {
            governed: p?.getAttribute('data-governed'),
            banner: p?.querySelector('[data-testid="testing-launch-plain-banner"]')?.textContent ?? '',
            reason: p?.querySelector('[data-testid="testing-launch-plain-banner"]')?.getAttribute('data-reason'),
            chip: !!p?.querySelector('[data-testid="testing-launch-workflow"]'),
          };
        }""")
    check(
        "plain_banner_before_launch",
        banner["governed"] == "false" and banner["reason"] == "workflow-absent" and not banner["chip"]
        and banner["banner"].startswith("this daemon has no governed test workflow — plain run"),
        **banner,
    )
    page.locator('[data-testid="testing-launch-instructions"]').fill("Plain")
    page.locator('[data-testid="testing-launch-unscoped"]').check()
    page.locator('[data-testid="testing-launch-submit"]').click()
    # The fixture answers /testing/recon with its standing "no such endpoint" 404 (a named refusal,
    # not the route-absent body), so the launch surfaces an error — what this scene pins is the WIRE:
    # the plain path posted /testing/recon with NO `workflow` key and never touched /testing/author.
    settled("""() => !!document.querySelector('[data-testid="testing-launch-error"], [data-testid="testing-launch-launched"]')""", timeout=15000)
    recon_posts = [json.loads(pd) for m, u, pd in posted if u == "/api/v1/testing/recon"]
    check(
        "plain_launch_takes_recon_without_workflow",
        len(recon_posts) == 1 and "workflow" not in recon_posts[0]
        and not any(u == "/api/v1/testing/author" for _, u, _ in posted),
        posted=[(m, u) for m, u, _ in posted], body=recon_posts[0] if recon_posts else None,
    )

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
