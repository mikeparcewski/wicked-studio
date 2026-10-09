#!/usr/bin/env python3
"""
desk_artifact_versions_test.py — S16a-4b: a page opened FULL screen in its session lists its versions;
`?v=N` on the artifact address is a read-only lens; "Make this the working version" forks once, at
1440x700 on the Desk.

Against the in-process fixture with the bound document desk_page_editor uses (project `notes`, doc
`offsite-plan`, run `r-doc-bound`), a second version made first (a fork of v1 on the bridge):

  1. LIST: full screen lists two versions newest first, version 2 marked working.
  2. LENS: picking version 1 puts `v=1` in the address and shows "Looking at version 1 — Back to the
     working version" over a read-only frame of v1.
  3. BACK: the browser's Back returns to the working version (no `v`, no lens); the lens line's own
     "Back to the working version" is hit at its centre (not the frame) and a click leaves the lens
     (studio#616).
  4. RESTORE: "Make this the working version" on version 1 sends exactly ONE fork (from 1, expect_head
     2) and version 3 is the working one; the address carries no `v`.
  5. RELOAD: a `v=1` address loaded fresh opens the lens at once.
  6. 0 page errors.

Captures: e2e/shots/desk-artifact-versions-*.png. Env: FEEDBACK_PORT (default 4475). JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4475"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PID = "notes"
DOC = "offsite-plan"
RUN = "r-doc-bound"

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


def post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"{}")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
SIZE = "() => document.querySelector('[data-testid=\"artifact\"]')?.dataset.size ?? null"


def addr(page) -> dict:
    u = urllib.parse.urlparse(page.url)
    return {"path": u.path, "size": urllib.parse.parse_qs(u.query).get("size", [None])[0]}


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    forks: list = []
    page.on("request", lambda r: forks.append(json.loads(r.post_data or "{}")) if r.method == "POST" and r.url.endswith("/api/fork") else None)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/api/docs", {"name": DOC, "brief": "the offsite plan"})
    post_json(f"{origin}/api/v1/projects/{PID}/interactive/d/{DOC}/api/fork", {"from": 1})
    set_fixture(origin, run_chat_id=True, doc_bound_run={"pid": PID, "doc": DOC}, extra_frames=[], editors=True, shell_csp=True)

    page.goto(f"{origin}/", wait_until="networkidle")
    page.goto(f"{origin}/s/run%3A{RUN}", wait_until="networkidle")
    page.get_by_test_id("artifact").first.wait_for(state="visible", timeout=15000)
    page.get_by_test_id("artifact-open").first.click()
    page.get_by_test_id("artifact-grow").first.click()

    # ── 1. the list ────────────────────────────────────────────────────────────────────────────
    page.get_by_test_id("artifact-versions").wait_for(state="visible", timeout=10000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"artifact-version-row\"]').length >= 2", timeout=10000)
    rows = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"artifact-version-row\"]')].map(e => [e.dataset.version, e.dataset.working])")
    page.screenshot(path=str(SHOTS / "desk-artifact-versions-list.png"))
    check("list-newest-first-head-working", rows[:2] == [["2", "true"], ["1", "false"]], rows=rows)

    # ── 2. the lens ────────────────────────────────────────────────────────────────────────────
    page.locator('[data-testid="artifact-version-row"][data-version="1"] [data-testid="artifact-version-lens"]').click()
    page.get_by_test_id("artifact-lens-line").wait_for(state="visible", timeout=8000)
    a = addr(page)
    v = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).get("v", [None])[0]
    lens = page.get_by_test_id("artifact-lens-line").inner_text().strip()
    frame_v = page.get_by_test_id("artifact-version-frame").get_attribute("data-version")
    page.screenshot(path=str(SHOTS / "desk-artifact-versions-lens.png"))
    check("lens-in-the-address", v == "1" and a["size"] == "full" and lens.startswith("Looking at version 1")
          and frame_v == "1" and forks == [], v=v, lens=lens, frame=frame_v, forks=forks)

    # ── 3. Back to the working version ─────────────────────────────────────────────────────────
    page.go_back()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"artifact-lens-line\"]')", timeout=8000)
    v_back = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).get("v", [None])[0]
    check("back-to-the-head", v_back is None, url=page.url)

    # ── 3b. studio#616: the lens line's OWN Back is a control — its centre hits the button (not the
    #        frame painted over it) and a real click leaves the lens ─────────────────────────────
    page.locator('[data-testid="artifact-version-row"][data-version="1"] [data-testid="artifact-version-lens"]').click()
    page.get_by_test_id("artifact-lens-line").wait_for(state="visible", timeout=8000)
    hit = page.evaluate("""() => {
      const b = document.querySelector('[data-testid="artifact-lens-back"]');
      if (!b) return 'missing';
      const r = b.getBoundingClientRect();
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return e === b || b.contains(e) ? 'button' : (e?.className || e?.tagName || 'nothing');
    }""")
    page.get_by_test_id("artifact-lens-back").click(timeout=5000)
    page.wait_for_function("() => !document.querySelector('[data-testid=\"artifact-lens-line\"]')", timeout=8000)
    check("lens-back-is-clickable", hit == "button", hit=hit)

    # ── 4. restore v1: one fork with the expected head; v3 is the working version ──────────────
    page.locator('[data-testid="artifact-version-row"][data-version="1"] [data-testid="artifact-version-restore"]').click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"artifact-version-row\"][data-version=\"3\"]')?.dataset.working === 'true'", timeout=10000)
    line = page.get_by_test_id("artifact-version-line").inner_text().strip()
    v_after = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query).get("v", [None])[0]
    page.screenshot(path=str(SHOTS / "desk-artifact-versions-restored.png"))
    check("restore-forks-once", len(forks) == 1 and forks[0].get("from") == 1 and forks[0].get("expect_head") == 2
          and v_after is None and "as version 3" in line, forks=forks, line=line, url=page.url)

    # ── 5. a v=1 address, fresh ────────────────────────────────────────────────────────────────
    page.goto(page.url.split("?")[0] + "?size=full&v=1", wait_until="networkidle")
    page.get_by_test_id("artifact-lens-line").wait_for(state="visible", timeout=15000)
    check("reload-opens-the-lens", page.get_by_test_id("artifact-version-frame").get_attribute("data-version") == "1")

    check("no-page-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
sys.exit(0)
