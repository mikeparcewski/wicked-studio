"""Journey: the project's Coverage and Domain sections (studio#158) and the Product view (studio#157)
at 1440x700 on the Desk.

crew's project folds (crew#371: GET /projects/:id/{coverage,domain}) are stubbed with page.route,
and the Product view's fold and compose launch (crew#371/#372: GET /projects/:id/requirements,
POST /projects/:id/product/compose) are stubbed with page.route, so the journey pins studio's
rendering of the published wire. Every member repo is a row with its
state, an unread one names crew's reason, and the synthesized `default` project draws neither section.

Captures: e2e/shots/desk-product-*.png. Env: FEEDBACK_PORT (default 4471).
"""

import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4471"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

NOW = 1_757_300_000_000
PROJECT = {"id": "shop", "name": "Shop", "description": None, "status": "active", "scope": "project:shop", "created_at": NOW, "updated_at": NOW}
MEMBERS = [
    {"id": f"shop:crew.repo:{r}", "project_id": "shop", "member_kind": "crew.repo", "member_ref": r, "meta": None, "attached_at": NOW, "attached_by": "studio"}
    for r in ("r-api", "r-web")
]
TOTALS = {"repos": 2, "ok": 1, "absent": 1, "errors": 0, "dangling": 0}
COVERAGE = {
    "projectId": "shop",
    "totals": {**TOTALS, "behavior_bearing": 40, "resolved": 12, "coverage": 0.3},
    "rows": [
        {"repo": {"id": "r-api", "name": "shop-api"}, "state": "ok", "report": {
            "total": 50, "behavior_bearing": 40, "resolved": 12, "risk_flagged": 2, "unaccounted": 26, "coverage": 0.35,
            "resolved_rate": 0.86, "mean_confidence": 0.8, "resolve_threshold": 0.75, "per_app": []}},
        {"repo": {"id": "r-web", "name": "shop-web"}, "state": "absent", "reason": "the code graph is not indexed yet", "report": None},
    ],
}
DOMAIN = {
    "projectId": "shop",
    "totals": {**TOTALS, "domains": 2, "requirements": 30, "entities": 9},
    "merged": [{"name": "billing", "repoIds": ["r-api"], "requirements": 20, "entities": 6},
               {"name": "auth", "repoIds": ["r-api"], "requirements": 10, "entities": 3}],
    "rows": [
        {"repo": {"id": "r-api", "name": "shop-api"}, "state": "ok", "domains": [
            {"name": "billing", "description": None, "requirements": 20, "entities": 6},
            {"name": "auth", "description": None, "requirements": 10, "entities": 3}]},
        {"repo": {"id": "r-web", "name": "shop-web"}, "state": "absent", "reason": "no requirements_graph.json", "domains": []},
    ],
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.route("**/api/v1/projects/shop", lambda r: r.fulfill(status=200, json={"project": PROJECT, "members": MEMBERS}))
    page.route("**/api/v1/projects/shop/activity*", lambda r: r.fulfill(status=200, json={"entries": [], "nextCursor": None, "projectId": "shop"}))
    page.route("**/api/v1/projects/shop/coverage", lambda r: r.fulfill(status=200, json=COVERAGE))
    page.route("**/api/v1/projects/shop/domain", lambda r: r.fulfill(status=200, json=DOMAIN))

    # ── 1. Coverage: one row per member repo, the unread one with crew's reason ──────────────────
    page.goto(f"{origin}/projects/shop", wait_until="networkidle")
    page.get_by_test_id("project-coverage").wait_for(state="visible", timeout=15000)
    totals = page.get_by_test_id("project-coverage-totals").inner_text()
    rows = page.get_by_test_id("project-coverage-row").evaluate_all("els => els.map(e => ({ repo: e.dataset.repo, state: e.dataset.state, text: e.innerText }))")
    page.get_by_test_id("project-coverage").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-product-coverage.png"))
    check("coverage", totals.startswith("Resolved 12 of 40 behavior-bearing nodes (30.0%)")
          and [r["state"] for r in rows] == ["ok", "absent"]
          and "35.0%" in rows[0]["text"] and "the code graph is not indexed yet" in rows[1]["text"],
          totals=totals, rows=rows)

    # ── 2. Domain: merged domains, then each repo's own ─────────────────────────────────────────
    page.get_by_test_id("project-domain").wait_for(state="visible", timeout=8000)
    merged = page.get_by_test_id("project-domain-merged-row").evaluate_all("els => els.map(e => e.dataset.domain)")
    drows = page.get_by_test_id("project-domain-row").evaluate_all("els => els.map(e => ({ state: e.dataset.state, text: e.innerText }))")
    page.get_by_test_id("project-domain").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "desk-product-domain.png"))
    check("domain", merged == ["billing", "auth"] and [r["state"] for r in drows] == ["ok", "absent"]
          and "billing · auth" in drows[0]["text"] and "no requirements_graph.json" in drows[1]["text"], merged=merged, rows=drows)

    # ── 3. a repo row is a door to the repo ─────────────────────────────────────────────────────
    page.locator('[data-testid="project-coverage-row"][data-repo="r-api"] a').click()
    page.wait_for_url("**/repo-detail/r-api", timeout=8000)
    check("repo-door", page.url.endswith("/repo-detail/r-api"), url=page.url)

    # ── 4. the synthesized default project draws neither section ────────────────────────────────
    # Served in full (detail, activity AND both folds), so the page renders and only the exclusion
    # keeps the sections off it (codex on #158).
    default = {**PROJECT, "id": "default", "name": "Unfiled stub", "scope": "project:default"}
    folds: list[str] = []
    page.route("**/api/v1/projects/default", lambda r: r.fulfill(status=200, json={"project": default, "members": []}))
    page.route("**/api/v1/projects/default/activity*", lambda r: r.fulfill(status=200, json={"entries": [], "nextCursor": None, "projectId": "default"}))
    page.route("**/api/v1/projects/default/coverage", lambda r: (folds.append("coverage"), r.fulfill(status=200, json={**COVERAGE, "projectId": "default"})))
    page.route("**/api/v1/projects/default/domain", lambda r: (folds.append("domain"), r.fulfill(status=200, json={**DOMAIN, "projectId": "default"})))
    page.goto(f"{origin}/projects/default", wait_until="networkidle")
    page.get_by_text("Unfiled stub", exact=True).wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    on_default = page.get_by_test_id("project-coverage").count() + page.get_by_test_id("project-domain").count()
    check("default-none", on_default == 0 and folds == [], on_default=on_default, folds=folds)

    # ── 5. Product: the rail entry, one project's requirements, Draft epics → the run's session ──
    def req(n, **extra):
        return {"key": f"k{n}", "domain": "billing", "reqId": f"REQ-{n}", "title": f"Refund rule {n}", "category": "functional",
                "statement": "s", "status": "draft", "risk": False, "riskSource": None, "edited": False, **extra}
    REQS = {"projectId": "shop", "offset": 0, "limit": 50,
            "totals": {**TOTALS, "total": 3, "corpus": 3},
            "rows": [{"repo": {"id": "r-api", "name": "shop-api"}, "state": "ok", "total": 3, "corpus": 3, "orphanedOverrides": 0,
                      "items": [req(1, risk=True), req(2), req(3)]},
                     {"repo": {"id": "r-web", "name": "shop-web"}, "state": "absent", "reason": "no requirements artifact yet",
                      "total": 0, "corpus": 0, "orphanedOverrides": 0, "items": []}]}
    composes: list = []

    def compose_route(route):
        composes.append(route.request.post_data_json)
        route.fulfill(status=202, json={"runId": "r-auth", "requirements": len(route.request.post_data_json["requirements"])})

    page.route("**/api/v1/projects/shop/requirements*", lambda r: r.fulfill(status=200, json=REQS))
    page.route("**/api/v1/projects/shop/product/compose", compose_route)
    page.goto(f"{origin}/", wait_until="networkidle")
    page.get_by_test_id("desk-rail-product").click()
    page.wait_for_function("() => window.location.pathname === '/product'", timeout=5000)
    page.get_by_test_id("product-page").wait_for(state="visible", timeout=8000)
    rail_current = page.get_by_test_id("desk-rail-product").get_attribute("aria-current")
    page.goto(f"{origin}/product?project=shop", wait_until="networkidle")
    page.get_by_test_id("product-repo").wait_for(state="visible", timeout=15000)
    reqs = page.get_by_test_id("product-requirement").evaluate_all("els => els.map(e => e.dataset.key)")
    unread = page.get_by_test_id("product-repo-unread").inner_text()
    picks = page.get_by_test_id("product-requirement-pick")
    picks.nth(0).check()
    picks.nth(2).check()
    page.get_by_test_id("product-instructions").fill("one epic per domain")
    chosen = page.get_by_test_id("product-chosen").inner_text()
    page.screenshot(path=str(SHOTS / "desk-product-view.png"))
    check("product-list", rail_current == "page" and reqs == ["k1", "k2", "k3"] and "no requirements artifact yet" in unread
          and chosen.startswith("2 requirements chosen"), rail_current=rail_current, reqs=reqs, unread=unread, chosen=chosen)
    page.get_by_test_id("product-draft").click()
    page.wait_for_function("() => window.location.pathname.startsWith('/s/')", timeout=8000)
    check("product-draft", composes == [{"requirements": [{"repoId": "r-api", "key": "k1"}, {"repoId": "r-api", "key": "k3"}], "instructions": "one epic per domain"}]
          and page.url.endswith("/s/run%3Ar-auth"), composes=composes, url=page.url)

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
