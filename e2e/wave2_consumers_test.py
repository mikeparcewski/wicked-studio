#!/usr/bin/env python3
"""
wave2_consumers_test.py — the wave-2 consumers gate (studio#251 / #246 / #248,
wicked-crew-api-types 0.32.0): the three surfaces render what wave 2 put on the wire.

Runs against the shared frozen-NOW0 W2 fixture with the wave-2 switches on
(`repo`, `repo_findings`, `governance="deadletters"`, `chat_scope`) — no crew
daemon anywhere; the fixture answers the REAL contract shapes (RepoEntry.findings,
DiagnosticsResponse.governance, ChatOpenResponse.scope and crew#502's 404/501).

The DOM ACs, verbatim mapping:

  1. REPO FINDINGS (#251): on /repos the studio-api card carries ONE finding row —
     code in_tree_code_graph_ignored, severity error (no live graph), the engine's
     message, and a "Re-run onboarding" button; clicking it POSTs
     /api/v1/repos/studio-api/onboard (tapped off the fixture) and follows the
     started run — never falling through to the card's own link (repo detail).
     The repo detail header renders the same finding.
     With `repo_findings` off the card renders NO findings block (silent).
  2. GOVERNANCE (#246): expanding the rail's Health section renders the governance
     group — store via flag + path, "0 records", dead letters 128+ with the by-type
     / by-reason tallies, and the governance.deadletter ERROR row whose text carries
     the `wicked-crew governance replay …` recipe; the heart reads unhealthy. With
     the route ABSENT (older daemon) the group reads "not reported by this daemon"
     (the heart's governance contribution is pinned in the unit suite — this roster's
     inactive codex seat colours it on its own).
  3. SCOPED NEW CHAT (#248): on /chat/new the Scope row is present; an Unfiled send
     is BLOCKED (nothing POSTed, the gap stated, the draft kept); "Unscoped" then
     opens with neither projectId nor repoRefs and the header states "unscoped".
     A fresh /chat/new with "Choose repos…" lists the registry (GET /repos on that
     gesture), picking studio-api sends repoRefs=["studio-api"], and the header
     states the repo (path on hover) and the daemon's no-graph reason. With
     `chat_scope_501` the scoped open renders the 501 sentence inline with the
     "Continue unscoped" fallback.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  wave2-repo-findings.png   the /repos card with the finding row + action
  wave2-governance.png      the expanded Health rail with the F-022 rows
  wave2-chat-scope.png      a scoped chat's header statement

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1.
Env knobs: FEEDBACK_PORT (default 4397), SKIP_STUDIO_BUILD. Prints a JSON report; exit 0/1.
"""

import json
import os
import sys

from uxfix_fixture import (
    REPO,
    REPO_FINDING_NO_LIVE,
    ensure_build,
    onboard_posts,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4397"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

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


# ── 1. The same-origin build + the shared W2 fixture, wave-2 switches on ─────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, repo=True, repo_findings=True, governance="deadletters", chat_scope=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
TID = lambda t: f'[data-testid="{t}"]'  # noqa: E731

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    posts: list = []
    page.on("request", lambda r: posts.append((r.method, r.url)) if r.method == "POST" else None)

    # ── 2. #251 — the repo card + detail render the finding; the action posts the remedy ──
    page.goto(f"{ORIGIN}/repos")
    card = page.locator(TID("repo-card")).filter(has=page.locator('[data-repo-id="studio-api"]')).or_(
        page.locator('[data-testid="repo-card"][data-repo-id="studio-api"]'))
    card.first.wait_for(timeout=15000)
    row = card.first.locator(TID("repo-card-findings-row"))
    row.wait_for(timeout=10000)
    check("repo_card_finding_row",
          row.get_attribute("data-code") == "in_tree_code_graph_ignored"
          and row.get_attribute("data-severity") == "error"
          and row.get_attribute("data-reonboard") == "true"
          and "re-run onboarding" in (row.inner_text() or "")
          and card.first.locator(TID("repo-card-findings")).get_attribute("data-count") == "1",
          code=row.get_attribute("data-code"), severity=row.get_attribute("data-severity"))
    page.screenshot(path=str(VSHOTS / "wave2-repo-findings.png"))
    row.locator(TID("repo-card-findings-reonboard")).click()
    page.wait_for_timeout(500)
    # The host's EXISTING onboard trigger follows the started run (as the card's own
    # Onboard button does); what must NOT happen is the click falling through to the
    # card's role=link and opening the repo detail instead.
    check("repo_card_reonboard_posts_the_onboard_wire",
          onboard_posts == ["studio-api"] and "/repo-detail/" not in page.url,
          onboard_posts=list(onboard_posts), landed=page.url.replace(ORIGIN, ""))

    page.goto(f"{ORIGIN}/repo-detail/studio-api")
    detail_row = page.locator(TID("repo-findings-row"))
    detail_row.wait_for(timeout=15000)
    check("repo_detail_finding_row",
          detail_row.get_attribute("data-code") == "in_tree_code_graph_ignored"
          and REPO_FINDING_NO_LIVE["message"][:40] in (detail_row.inner_text() or "")
          and detail_row.locator(TID("repo-findings-reonboard")).count() == 1)

    # Silent when the record carries no findings (the switch off = the standing shape).
    set_fixture(ORIGIN, repo_findings=False)
    page.goto(f"{ORIGIN}/repos")
    page.locator('[data-testid="repo-card"][data-repo-id="studio-api"]').wait_for(timeout=15000)
    check("repo_card_silent_without_findings",
          page.locator(TID("repo-card-findings")).count() == 0)
    set_fixture(ORIGIN, repo_findings=True)

    # ── 3. #246 — the Health rail renders diagnostics.governance ────────────────────
    page.goto(f"{ORIGIN}/")
    page.locator(TID("rail-health-toggle")).wait_for(timeout=15000)
    page.locator(TID("rail-health-toggle")).click()
    gov = page.locator(TID("rail-governance"))
    gov.wait_for(timeout=10000)
    gov_text = gov.inner_text()
    finding = gov.locator(TID("rail-governance-finding"))
    check("governance_rows",
          gov.get_attribute("data-state") == "error"
          and gov.get_attribute("data-deadletters") == "128"
          and gov.get_attribute("data-store") == "flag"
          and "via flag" in gov_text
          and "0 records" in gov_text
          and "128+" in gov_text
          and "wicked.crew.governance.conformance_recorded ×96" in gov.locator(TID("rail-governance-by-type")).inner_text()
          and "no shared store (WICKED_ESTATE_DB unset) ×128" in gov.locator(TID("rail-governance-by-reason")).inner_text()
          and finding.get_attribute("data-kind") == "governance.deadletter"
          and finding.get_attribute("data-severity") == "error"
          and "wicked-crew governance replay" in finding.inner_text(),
          state=gov.get_attribute("data-state"), deadletters=gov.get_attribute("data-deadletters"))
    check("governance_heart_unhealthy",
          page.locator(TID("rail-health-heart")).get_attribute("data-health") == "unhealthy"
          and page.locator(TID("rail-health-summary-dot")).count() == 1)  # (codex is inactive on this roster too)
    page.screenshot(path=str(VSHOTS / "wave2-governance.png"))

    # An older daemon: no /diagnostics route at all → "not reported", heart healthy.
    set_fixture(ORIGIN, governance=None)
    page.goto(f"{ORIGIN}/")
    page.locator(TID("rail-health-toggle")).wait_for(timeout=15000)
    page.locator(TID("rail-health-toggle")).click()
    gov = page.locator(TID("rail-governance"))
    gov.wait_for(timeout=10000)
    # (The heart's colour is not asserted here: the shared W2 roster carries an
    # inactive codex seat, which reads unhealthy on its own — the governance
    # contribution to the heart is pinned in HealthRailSection.governance.test.)
    check("governance_absent_is_named",
          gov.get_attribute("data-state") == "absent"
          and gov.get_attribute("data-why") == "no-route"
          and "not reported by this daemon" in gov.inner_text(),
          state=gov.get_attribute("data-state"), why=gov.get_attribute("data-why"))
    set_fixture(ORIGIN, governance="deadletters")

    # ── 4. #248 — the scope control, the gate, the statement, the refusals ──────────
    page.goto(f"{ORIGIN}/chat/new")
    page.locator(TID("chat-scope-row")).wait_for(timeout=15000)
    posts.clear()
    composer = page.locator("textarea")
    composer.fill("hello crew")
    composer.press("Enter")
    page.locator(TID("chat-scope-gap")).wait_for(timeout=5000)
    check("unfiled_send_is_blocked",
          page.locator(TID("chat-scope-row")).get_attribute("data-blocked") == "true"
          and not [u for m, u in posts if "/api/v1/chats" in u]
          and composer.input_value() == "hello crew",
          gap=page.locator(TID("chat-scope-gap")).inner_text())
    page.locator(TID("chat-scope-none")).click()
    composer.press("Enter")
    line = page.locator(TID("chat-scope"))
    line.wait_for(timeout=10000)
    chat_posts = [u for m, u in posts if u.endswith("/api/v1/chats")]
    check("unscoped_opens_and_is_stated",
          len(chat_posts) == 1 and line.get_attribute("data-kind") == "none"
          and "unscoped" in line.inner_text(),
          kind=line.get_attribute("data-kind"))

    # A fresh chat, scoped to a picked repo.
    page.locator(TID("chat-close")).click()
    page.goto(f"{ORIGIN}/chat/new")
    page.locator(TID("chat-scope-row")).wait_for(timeout=15000)
    bodies: list = []
    page.on("request", lambda r: bodies.append(r.post_data_json) if r.method == "POST" and r.url.endswith("/api/v1/chats") else None)
    page.locator(TID("chat-scope-repos")).click()
    option = page.locator('[data-testid="chat-scope-repo-option"][data-repo-id="studio-api"]')
    option.wait_for(timeout=10000)
    option.locator('input[type="checkbox"]').check()
    composer = page.locator("textarea")
    composer.fill("what does studio-api do?")
    composer.press("Enter")
    line = page.locator(TID("chat-scope"))
    line.wait_for(timeout=10000)
    repo_chip = line.locator(TID("chat-scope-repo"))
    check("repo_scope_sends_repoRefs_and_is_stated",
          len(bodies) == 1 and bodies[0].get("repoRefs") == ["studio-api"] and "projectId" not in bodies[0]
          and line.get_attribute("data-kind") == "repos"
          and repo_chip.count() == 1 and repo_chip.inner_text() == "studio-api"
          and repo_chip.get_attribute("title") == "/tmp/w2/studio-api"
          and line.get_attribute("data-graph-bound") == "false"
          and "no code graph" in line.locator(TID("chat-scope-graph")).inner_text(),
          body=bodies[0] if bodies else None, kind=line.get_attribute("data-kind"))
    page.screenshot(path=str(VSHOTS / "wave2-chat-scope.png"))
    page.locator(TID("chat-close")).click()

    # crew#502's 501: the engine predates chat scope — stated inline, Unscoped offered.
    set_fixture(ORIGIN, chat_scope_501=True)
    page.goto(f"{ORIGIN}/chat/new")
    page.locator(TID("chat-scope-row")).wait_for(timeout=15000)
    page.locator(TID("chat-scope-repos")).click()
    option = page.locator('[data-testid="chat-scope-repo-option"][data-repo-id="studio-api"]')
    option.wait_for(timeout=10000)
    option.locator('input[type="checkbox"]').check()
    composer = page.locator("textarea")
    composer.fill("scoped on an old engine")
    composer.press("Enter")
    err = page.locator(TID("chat-open-error"))
    err.wait_for(timeout=10000)
    check("scoped_open_501_is_stated_with_fallback",
          err.get_attribute("data-status") == "501"
          and "predates chat scope" in err.inner_text()
          and err.locator(TID("chat-scope-fallback-none")).count() == 1
          and "API 501" not in page.inner_text("body"),
          text=err.inner_text()[:160])
    set_fixture(ORIGIN, chat_scope_501=False)

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
