#!/usr/bin/env python3
"""
ux_sliceV_test.py — the DES-UX-001 slice-V gate: provenance + retry (§3, §4).
Runs against the shared frozen-NOW0 W2 fixture (uxfix_fixture.py) with its
`provenance` corpus on (real wire shapes only): GET /audit?runId= serves REAL
AuditEntry rows (actor{id,kind,trust} + the run.launched detail, crew
routes.ts:266/570) for r-auth and r-retry — r-retry's detail carries
`retryOf: "r-auth"` (CREW-UX-3) and its session echoes `retry_of` (api-types
0.8.0) — while r-legacy answers an EMPTY audit page: the degraded no-audit run.
`repo`+`repo_refs` ride along so r-auth carries repo_ref studio-api (the retry
prefill's repo field has something true to carry).

The §3.5 / §4.5 DOM ACs, verbatim mapping:

  1. r-auth's detail renders `[data-testid="run-provenance"]` naming actor id +
     kind + channel ("launched by mika · human via API"), and exactly ONE
     `GET /audit?runId=r-auth` fires per detail view (request-tap, cached on a
     client-side revisit);
  2. r-legacy (no matching audit entry) renders the EXACT degraded copy
     "launched via API (actor unknown)" — the line is never absent;
  3. notification rows for run events carry `[data-testid="notif-provenance"]`
     with the same contract (named for r-auth, degraded for r-legacy), read
     from the cache only — opening the bell fires NO audit fetch (no fan-out);
  4. lineage cross-links: r-retry's line renders "retry of r-auth" and
     navigates back to r-auth on click; r-auth's line renders "retried as
     r-retry" from the loaded index;
  5. the failed r-auth renders `[data-testid="run-retry"]`; the completed
     r-retry does NOT (the loop closes failures, not successes);
  6. clicking Retry opens the composer PREFILLED — intent textarea equal to
     the original `problem`, workflow/roster/repo pills matching the original
     run — with ZERO `POST /runs` until the operator sends; the send's body
     carries `retryOf: "r-auth"` (request-tap).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-V-provenance.png   r-auth: the named provenance line + "retried as" link
                        in the What/Where card, beside the failed post-mortem
  ux-V-retry.png        the composer prefilled from Retry — intent, workflow,
                        repo, roster and the clearable "Retry of r-auth" pill

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4382),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import sys
from urllib.parse import parse_qs, urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4382"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

AUTH_THREAD = "/p/auth-refactor/build/r-auth"
LEGACY_THREAD = "/p/legacy-spike/build/r-legacy"
RETRY_THREAD = "/runs/r-retry"

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


# ── 1. The same-origin build + the shared W2 fixture, provenance ON ─────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, provenance=True, repo=True, repo_refs=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The request tap: every audit read (by runId) and every launch POST.
    audit_reads: list[str] = []
    launch_posts: list[dict] = []

    def on_request(req):
        u = urlparse(req.url)
        if u.path == "/api/v1/audit" and req.method == "GET":
            audit_reads.append((parse_qs(u.query).get("runId") or [""])[0])
        elif u.path == "/api/v1/runs" and req.method == "POST":
            try:
                launch_posts.append(json.loads(req.post_data or "{}"))
            except json.JSONDecodeError:
                launch_posts.append({"__unparseable__": req.post_data})

    page.on("request", on_request)

    def nav(path: str) -> None:
        """CLIENT-side navigation (pushState + popstate) — a full page.goto
        would drop the in-memory provenance cache the revisit AC pins."""
        page.evaluate(
            """(p) => { history.pushState(null, '', p);
                        window.dispatchEvent(new PopStateEvent('popstate')); }""",
            path)

    # ── Scene 1 (AC 1): the named provenance line, first row of What/Where ──────
    page.goto(f"{ORIGIN}{AUTH_THREAD}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="run-provenance"]').wait_for(timeout=30000)
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="run-provenance"]')
          ?.innerText ?? '').includes('launched by')""",
        timeout=15000)
    named = page.evaluate(
        """() => {
          const line = document.querySelector('[data-testid="run-provenance"]');
          const text = line?.innerText ?? '';
          const fwd = document.querySelector('[data-testid="lineage-retried-as"]');
          return {
            namesActor: text.includes('launched by mika'),
            namesKind: /human/i.test(text),
            namesChannel: text.includes('via API'),
            degradedCopyAbsent: !text.includes('actor unknown'),
            retriedAs: fwd?.innerText ?? null,
            retriedAsRun: fwd?.getAttribute('data-run-id') ?? null,
          };
        }""")
    check("provenance_named", named["namesActor"] and named["namesKind"]
          and named["namesChannel"] and named["degradedCopyAbsent"]
          and named["retriedAsRun"] == "r-retry"
          and audit_reads.count("r-auth") == 1,
          **named, audit_reads=list(audit_reads))
    page.screenshot(path=str(VSHOTS / "ux-V-provenance.png"))

    # ── Scene 2 (AC 2): the degraded run — the exact copy, never an absent line ─
    nav(LEGACY_THREAD)
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="run-provenance"]')
          ?.innerText ?? '').includes('launched via API (actor unknown)')""",
        timeout=15000)
    check("provenance_degraded", audit_reads.count("r-legacy") == 1,
          audit_reads=list(audit_reads))

    # ── Scene 3 (AC 1): the revisit is served from the cache — no second fetch ──
    nav(AUTH_THREAD)
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="run-provenance"]')
          ?.innerText ?? '').includes('launched by mika')""",
        timeout=15000)
    check("provenance_cached_on_revisit", audit_reads.count("r-auth") == 1,
          audit_reads=list(audit_reads))

    # ── Scene 4 (AC 4): lineage — r-retry links back to r-auth ──────────────────
    nav(RETRY_THREAD)
    page.locator('[data-testid="lineage-retry-of"]').wait_for(timeout=15000)
    back = page.evaluate(
        """() => {
          const el = document.querySelector('[data-testid="lineage-retry-of"]');
          return { text: el?.innerText ?? '', runId: el?.getAttribute('data-run-id') ?? null };
        }""")
    page.locator('[data-testid="lineage-retry-of"]').click()
    page.wait_for_function("() => location.pathname === '/runs/r-auth'", timeout=10000)
    check("lineage_back_link", back["runId"] == "r-auth"
          and "retry of r-auth" in back["text"],
          **back, landed=page.evaluate("() => location.pathname"))

    # ── Scene 5 (AC 3): notification rows — same contract, cache only ───────────
    audit_before_bell = len(audit_reads)
    set_fixture(ORIGIN, extra_frames=[
        {"type": "sessionFailed", "session": "r-auth"},
        {"type": "sessionFailed", "session": "r-legacy"},
    ])
    bell = page.locator('button[title="Notifications"]')
    bell.wait_for(timeout=10000)
    # The one-shot frames drain on the next 1s WS tick; the unread badge lands.
    page.wait_for_function(
        """() => /unread notification/.test(
             document.querySelector('button[title="Notifications"]')
               ?.getAttribute('aria-label') ?? '')""",
        timeout=15000)
    bell.click()
    page.locator('[data-testid="notif-provenance"]').first.wait_for(timeout=10000)
    rows = page.evaluate(
        """() => {
          const items = [...document.querySelectorAll('[role="menuitem"]')];
          const rowFor = (rid) => items.find((el) => el.innerText.includes(rid));
          const prov = (el) =>
            el?.querySelector('[data-testid="notif-provenance"]')?.innerText ?? null;
          return { auth: prov(rowFor('r-auth')), legacy: prov(rowFor('r-legacy')) };
        }""")
    check("notif_provenance_rows",
          rows["auth"] is not None and "launched by mika" in rows["auth"]
          and rows["legacy"] is not None
          and "launched via API (actor unknown)" in rows["legacy"]
          and len(audit_reads) == audit_before_bell,  # cache only — no fan-out
          **rows, audit_reads=list(audit_reads))
    page.keyboard.press("Escape")

    # ── Scene 6 (AC 5): Retry renders on the failed run, never on the completed ─
    nav(RETRY_THREAD)
    page.locator('[data-testid="run-provenance"]').wait_for(timeout=15000)
    retry_on_completed = page.evaluate(
        "() => !!document.querySelector('[data-testid=\"run-retry\"]')")
    nav(AUTH_THREAD)
    page.locator('[data-testid="run-retry"]').wait_for(timeout=15000)
    check("retry_failed_only", not retry_on_completed, retry_on_completed=retry_on_completed)

    # ── Scene 7 (AC 6): Retry-as-prefill — editable, zero launch until send ─────
    page.locator('[data-testid="run-retry"]').click()
    page.wait_for_function("() => location.pathname === '/runs/new'", timeout=10000)
    page.locator('[data-testid="launch-problem"]').wait_for(timeout=10000)
    prefill = page.evaluate(
        """() => {
          const pills = [...document.querySelectorAll('span')].map((s) => s.innerText);
          const has = (t) => pills.some((p) => p.startsWith(t));
          return {
            problem: document.querySelector('[data-testid="launch-problem"]')?.value ?? '',
            retryPill: has('Retry of r-auth'),
            workflowPill: has('Workflow: wf-w2'),
            repoPill: has('Repo: studio-api'),
            cliPill: has('CLIs: claude'),
            project: document.querySelector('[data-testid="project-field"]')?.innerText ?? '',
          };
        }""")
    check("retry_prefill", prefill["problem"] == "refactor the auth middleware"
          and prefill["retryPill"] and prefill["workflowPill"] and prefill["repoPill"]
          and prefill["cliPill"] and "auth-refactor" in prefill["project"]
          and len(launch_posts) == 0,
          **prefill, launch_posts=list(launch_posts))
    page.screenshot(path=str(VSHOTS / "ux-V-retry.png"))

    # The operator sends — the launch body carries the lineage (CREW-UX-3).
    page.locator('[data-testid="launch-submit"]').click()
    page.wait_for_function("() => location.pathname !== '/runs/new'", timeout=15000)
    body = launch_posts[0] if launch_posts else {}
    check("retry_launch_body", len(launch_posts) == 1
          and body.get("retryOf") == "r-auth"
          and body.get("problem") == "refactor the auth middleware"
          and body.get("workflow") == "wf-w2"
          and body.get("repoRef") == "studio-api"
          and body.get("projectId") == "auth-refactor",
          body=body)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
