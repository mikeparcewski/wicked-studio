#!/usr/bin/env python3
"""
ux_sliceX2_test.py — the DES-UX-001 slice-X2 gate: affordance honesty + the
copy pass (§7.3 B6/EC45 + §7.10 D/EC33).

Runs against the shared frozen-NOW0 W2 fixture with the `viewer` corpus (the
r-upload workdir + the crew#305 file/diff routes, incl. the real 403) and the
new `project_create` switch (POST /api/v1/projects answers the daemon's real
contract: 201 {project} with a proj_-minted id, the engine's verbatim 409
sentence on an active-name collision).

The §7.10 + §7.3 DOM ACs, verbatim mapping:

  1. GRAMMAR: the rail ＋ affordances carry the corrected singular strings —
     Projects' ＋ is "New Project", Repositories' ＋ is "New Repository"
     (the "New Projects"/"New Repositories" plurals retire).
  2. THE WALK: across /, /projects, /work and the r-upload run detail (What/
     Where + Files open), the strings `API 4`, `API 5`, `DTO`, `work_output`,
     `instrument bridge`, `(core#`, and `/private/var` appear NOWHERE in
     user-visible text, and no rendered text carries a raw `proj_` id.
  3. HYDRATION: a project created through the modal renders its DISPLAY NAME
     in the shell breadcrumb immediately (no reload) — never the proj_ id;
     re-creating the same name surfaces the daemon's 409 as the translated
     sentence ("the daemon refused this — project name '…' is already in use
     by an active project"), with `API 409` nowhere in the DOM.
  4. EC33 FALLBACK: the viewer's 403 (outside every allowed root) renders as
     "the daemon refused this — path is outside every allowed root (…)" — the
     daemon's sentence whole, the `API 403` framing gone. (The two diff 409s
     stay slice R's named-cause cards; ux_sliceR pins those exact strings.)
  5. RELATIVE PATHS: Files rows render WORKTREE-RELATIVE text (src/…, not
     /w2/upload/src/…) while `title`/copy/open keep the absolute path (the
     sliceI locators still resolve).
  6. §7.3 QUOTED-NAME: on the launch composer, `a deck named "uxr-x" …` shows
     the parse BEFORE submit (create-parse names uxr-x + the remainder), and
     the submitted POST /api/docs body carries name=uxr-x with the remainder
     as its brief (fixture-received, tapped off the wire); the landed doc's
     URL carries uxr-x.
  7. EC45: the doc's Comment button, disabled because the fixture document
     never answers the bridge, says WHY in operator language with a next step
     ("Comments need the document's preview to finish loading — reopen the
     document or regenerate this version…"); the wire phrase "instrument
     bridge" appears nowhere in the DOM (attributes included).

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-X2-copy.png   the r-upload Files panel (relative rows) with the translated
                   403 sentence in the open viewer — the EC33 frame at work

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT (default 4396), SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    VIEWER_FILE_403,
    VIEWER_FILE_TS,
    VIEWER_WORKDIR,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4396"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

UPLOAD_THREAD = "/p/upload-endpoint/build/r-upload"
LAUNCH_COMPOSER = "/p/scratch/document"
QUOTED_ASK = 'a deck named "uxr-x" summarizing the Q3 results'
EXPECTED_BRIEF = "a deck summarizing the Q3 results"
NEW_NAME = "uxr quarterly"

# What must never render (§7.10's DOM-wide assert + this round's retirements).
FORBIDDEN_TEXT = ["API 4", "API 5", "DTO", "work_output", "instrument bridge",
                  "(core#", "/private/var"]

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


# ── 1. The same-origin build + the shared W2 fixture ─────────────────────────
dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, viewer=True, project_create=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

# The innerText scan: forbidden strings + any rendered proj_ id.
SCAN = """(forbidden) => {
  const text = document.body.innerText;
  const hits = forbidden.filter((s) => text.includes(s));
  if (/\\bproj_[0-9]/.test(text)) hits.push('proj_<id> rendered as text');
  return { hits, sample: text.slice(0, 120) };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    # The wire tap: the create-doc POST body (AC 6's fixture-received parse).
    doc_creates: list[dict] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "POST" and path.endswith("/interactive/api/docs"):
            try:
                doc_creates.append(json.loads(req.post_data or "{}"))
            except json.JSONDecodeError:
                doc_creates.append({})

    page.on("request", on_request)

    def open_route(route: str, waitfor: str) -> None:
        page.goto(f"{ORIGIN}{route}", wait_until="domcontentloaded")
        page.locator(waitfor).first.wait_for(timeout=30000)
        page.add_style_tag(content=HIDE_GATE_TOASTS)

    # ── Scene 1 (AC 1): the corrected grammar on the rail's ＋ affordances ──────
    open_route("/", '[data-testid="left-rail"]')
    labels = page.evaluate(
        """() => {
          const grab = (key) => document.querySelector(
            `[data-testid="rail-heading-${key}"] [data-testid="heading-new"]`)
            ?.getAttribute('title') ?? null;
          return { projects: grab('projects'), repos: grab('repos') };
        }""")
    check("grammar_singular",
          labels["projects"] == "New Project" and labels["repos"] == "New Repository",
          **labels)

    # ── Scene 2 (AC 2, part 1): the walk — board, /projects, /work ─────────────
    walk_hits: dict = {}
    for route, waitfor in [("/", '[data-testid="project-board"]'),
                           ("/projects", '[data-testid="left-rail"]'),
                           ("/work", '[data-testid="left-rail"]')]:
        open_route(route, waitfor)
        page.wait_for_timeout(400)  # let the route's own fetch burst paint
        walk_hits[route] = page.evaluate(SCAN, FORBIDDEN_TEXT)
    check("copy_walk_clean",
          all(len(v["hits"]) == 0 for v in walk_hits.values()),
          **{k.replace("/", "_") or "_root": v for k, v in walk_hits.items()})

    # ── Scene 3 (AC 3): fresh-entity hydration + the translated 409 ────────────
    open_route("/", '[data-testid="rail-heading-projects"]')
    page.locator('[data-testid="rail-heading-projects"] [data-testid="heading-new"]').click()
    page.locator('[data-testid="new-project-modal"]').wait_for(timeout=10000)
    page.locator('[data-testid="new-project-name"]').fill(NEW_NAME)
    page.locator('[data-testid="new-project-create"]').click()
    page.wait_for_url(re.compile(r"/p/proj_\d+/build$"), timeout=15000)
    page.locator('[data-testid="project-name"]').wait_for(timeout=15000)
    crumb = page.locator('[data-testid="project-name"]').inner_text().strip()
    fresh = page.evaluate(SCAN, FORBIDDEN_TEXT)
    check("created_project_hydrates",
          NEW_NAME in crumb and len(fresh["hits"]) == 0,
          crumb=crumb, scan=fresh, url=page.url)

    # The collision: same name again → the translated daemon sentence, no API 409.
    page.locator('[data-testid="rail-heading-projects"] [data-testid="heading-new"]').click()
    page.locator('[data-testid="new-project-modal"]').wait_for(timeout=10000)
    page.locator('[data-testid="new-project-name"]').fill(NEW_NAME)
    page.locator('[data-testid="new-project-create"]').click()
    page.locator('[data-testid="new-project-error"]').wait_for(timeout=10000)
    err = page.locator('[data-testid="new-project-error"]').inner_text()
    check("collision_translated",
          f"the daemon refused this — project name '{NEW_NAME}' is already in use" in err
          and "API 409" not in page.evaluate("() => document.body.innerText"),
          error_text=err)
    page.keyboard.press("Escape")

    # ── Scene 4 (ACs 4 + 5): the run detail — relative rows, translated 403 ────
    open_route(UPLOAD_THREAD, '[data-testid="left-rail"]')
    page.get_by_role("button", name=re.compile("^Files")).click()
    row = page.locator(f'button[title="View {VIEWER_FILE_TS}"]')
    row.wait_for(timeout=15000)
    row_text = row.inner_text()
    rel = VIEWER_FILE_TS[len(VIEWER_WORKDIR) + 1:]  # src/middleware.ts
    detail_scan = page.evaluate(SCAN, FORBIDDEN_TEXT)
    check("files_rows_relative",
          rel in row_text and VIEWER_WORKDIR not in row_text
          and len(detail_scan["hits"]) == 0,
          row_text=row_text, expected_rel=rel, scan=detail_scan)

    page.locator(f'button[title="View {VIEWER_FILE_403}"]').click()
    page.locator('[data-testid="viewer-error"]').wait_for(timeout=10000)
    err403 = page.locator('[data-testid="viewer-error"]').inner_text()
    check("forbidden_translated",
          err403.startswith("the daemon refused this — path is outside every allowed root")
          and "API 403" not in page.evaluate("() => document.body.innerText"),
          error_text=err403)
    page.screenshot(path=str(VSHOTS / "ux-X2-copy.png"))
    page.keyboard.press("Escape")
    page.locator('[data-testid="file-viewer"]').wait_for(state="detached", timeout=5000)

    # ── Scene 5 (AC 6): the quoted-name create — parse shown, then honored ─────
    open_route(LAUNCH_COMPOSER, '[data-testid="thread"][data-composer-state="idle"]')
    page.locator('[data-testid="doc-composer"]').fill(QUOTED_ASK)
    parse_line = page.locator('[data-testid="create-parse"]')
    parse_line.wait_for(timeout=10000)
    preview = parse_line.inner_text()
    check("create_parse_preview",
          "uxr-x" in preview and EXPECTED_BRIEF in preview,
          preview=preview)
    page.keyboard.press("Enter")
    page.wait_for_url(re.compile(r"/document/uxr-x"), timeout=30000)
    check("create_parse_honored",
          len(doc_creates) == 1
          and doc_creates[0].get("name") == "uxr-x"
          and doc_creates[0].get("brief") == EXPECTED_BRIEF,
          doc_creates=doc_creates, url=page.url)

    # ── Scene 6 (AC 7, EC45): the disabled Comment says why, operator-voiced ───
    toggle = page.locator('[data-testid="feedback-toggle"]')
    toggle.wait_for(timeout=15000)
    # The fixture document never answers the bridge — wait past GIVE_UP_MS for
    # the degraded title to settle on the still-disabled control.
    page.wait_for_function(
        """() => {
          const t = document.querySelector('[data-testid="feedback-toggle"]');
          return !!t && t.disabled && (t.getAttribute('title') ?? '').includes('preview');
        }""", timeout=20000)
    title = toggle.get_attribute("title") or ""
    bridge_free = page.evaluate(
        """() => !document.body.innerHTML.includes('instrument bridge')""")
    check("disabled_comment_operator_copy",
          "Comments need the document’s preview to finish loading" in title
          and "reopen the document or regenerate this version" in title
          and bridge_free,
          title=title, bridge_free=bridge_free)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
