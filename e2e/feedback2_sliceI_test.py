#!/usr/bin/env python3
"""
feedback2_sliceI_test.py — the DES-FEEDBACK-002 slice-I gate: the in-studio
file & diff viewer (§3, P0-3), against the shared frozen-NOW0 W2 fixture
(uxfix_fixture.py) with its `viewer` corpus switched on: r-upload carries a
workdir, its Files panel lists a modified TS file, a >512 KB generated file, a
binary asset and an outside-root path, and the crew#305 routes answer with the
REAL RunFileContent/RunDiff shapes and error strings.

The slice DOM ACs, from §3.7 (studio side):

  1. clicking a modified-file row opens `[data-testid="file-viewer"]` with the
     Diff tab active; `[data-testid="diff-line-add"]` computed `color` resolves
     from `var(--status-run)` and `diff-line-del` from `var(--status-fail)`
     (EC15); switching to File shows numbered content;
  2. file/diff requests fire ONLY on user gesture — zero fetches while the
     panel merely sits open, zero external-open calls from inline viewing;
  3. the binary file renders the honest state ("binary file — N bytes"), never
     mojibake; the truncated file renders
     `[data-testid="viewer-truncation-banner"]` naming the cap + full size (EC23);
  4. a 403 (outside every allowed root) surfaces the route's error VERBATIM;
  5. no highlight/grammar library ships in the bundle (the §2.3 precedent's
     grep gate) — the adversarial `+++`-leading ADDED line in the untracked
     hunk still colors as an addition (the zero-dep classifier is stateful);
  6. Escape closes the viewer and focus returns to the FilesPanel row;
  7. against a daemon WITHOUT the routes (Fastify default 404), the row click
     falls back to today's exact behavior: `POST /open` external launch (+ the
     copy feedback when that too is absent) — the viewer never lingers as an
     empty shell.

Captures (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  feedback2-I-diff-view.png       viewer open on the fixture's modified file,
                                  Diff tab, colored hunks
  feedback2-I-file-truncated.png  File tab on the >512 KB fixture file with the
                                  truncation banner

Prereqs: Python Playwright. Builds dist-sameorigin/ itself unless
SKIP_STUDIO_BUILD=1 — ensure_build CACHES: delete a stale dist-sameorigin/
when the source changed. Env knobs: FEEDBACK_PORT (default 4361),
SKIP_STUDIO_BUILD. Prints a JSON report to stdout; exit 0/1.
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
    VIEWER_FILE_BIG,
    VIEWER_FILE_BIN,
    VIEWER_FILE_TS,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4361"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

PROJECT, RUN = "upload-endpoint", "r-upload"
THREAD = f"/p/{PROJECT}/build/{RUN}"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── 1. The same-origin build + the §2.3-precedent grep gate ─────────────────────
dist = ensure_build(fail)
GRAMMAR_LIBS = re.compile(r"shiki|highlight\.js|hljs|prismjs|Prism\.highlight", re.I)
offenders = []
for asset in sorted((dist / "assets").glob("*.js")):
    if GRAMMAR_LIBS.search(asset.read_text(errors="replace")):
        offenders.append(asset.name)
report["steps"]["no_grammar_library_in_bundle"] = {"ok": not offenders, "offenders": offenders}
if offenders:
    fail("no_grammar_library_in_bundle", f"grammar-library tokens found in {offenders}")

# ── 2. The shared W2 fixture server, viewer corpus ON ───────────────────────────
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, viewer=True)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

# ── 3. The browser gate ────────────────────────────────────────────────────────
from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)
console_errors: list[str] = []

TOKEN_PROBE = """(token) => {
  const el = document.createElement('span');
  el.style.color = `var(${token})`;
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  return c;
}"""


def open_files_panel(page) -> None:
    page.goto(f"{ORIGIN}{THREAD}", wait_until="domcontentloaded")
    page.get_by_role("button", name=re.compile("^Files")).wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.get_by_role("button", name=re.compile("^Files")).click()
    page.locator(f'button[title="View {VIEWER_FILE_TS}"]').wait_for(timeout=15000)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # The tap: every viewer read + every external-open the page fires.
    reads: list[str] = []
    opens: list[str] = []

    def on_request(req):
        path = urlparse(req.url).path
        q = urlparse(req.url).query
        if req.method == "GET" and re.search(r"/api/v1/runs/[^/]+/(files|diff)$", path):
            reads.append(f"{path}?{q}" if q else path)
        if req.method == "POST" and path == "/api/v1/open":
            opens.append(path)

    page.on("request", on_request)

    # ── Scene 1: the Files panel sits open — NOTHING is prefetched ──────────────
    open_files_panel(page)
    try:
        page.wait_for_function(
            """() => document.fonts.status === 'loaded'
                  && document.fonts.check('12px "Inter"')""",
            timeout=20000,
        )
        fonts_ok = True
    except Exception:
        fonts_ok = False
    page.wait_for_timeout(1200)  # let the panel's own fetch burst settle
    report["steps"]["no_prefetch_on_panel_open"] = {
        "ok": fonts_ok and reads == [] and opens == [],
        "fonts_ok": fonts_ok, "reads": list(reads), "opens": list(opens),
    }

    # ── Scene 2 (AC 1): modified row → viewer, Diff tab active, token colors ────
    status_run = page.evaluate(TOKEN_PROBE, "--status-run")
    status_fail = page.evaluate(TOKEN_PROBE, "--status-fail")
    page.locator(f'button[title="View {VIEWER_FILE_TS}"]').click()
    page.locator('[data-testid="file-viewer"]').wait_for(timeout=10000)
    page.locator('[data-testid="diff-line-add"]').first.wait_for(timeout=10000)
    diff_state = page.evaluate(
        """([run, failc]) => {
          const add = document.querySelector('[data-testid="diff-line-add"]');
          const del = document.querySelector('[data-testid="diff-line-del"]');
          const hunk = document.querySelector('[data-testid="diff-line-hunk"]');
          return {
            diffTabActive: document.querySelector('[data-testid="viewer-tab-diff"]')
              ?.getAttribute('aria-selected') === 'true',
            addColor: add ? getComputedStyle(add).color : null,
            addOk: add ? getComputedStyle(add).color === run : false,
            delOk: del ? getComputedStyle(del).color === failc : false,
            hunkText: hunk?.textContent ?? null,
          };
        }""",
        [status_run, status_fail],
    )
    page.screenshot(path=str(VSHOTS / "feedback2-I-diff-view.png"))
    report["steps"]["diff_tab_token_colors"] = {
        "ok": all([
            diff_state["diffTabActive"],
            diff_state["addOk"],                       # EC15: added = --status-run
            diff_state["delOk"],                       # removed = --status-fail
            diff_state["hunkText"] is not None and diff_state["hunkText"].startswith("@@"),
            reads == [f"/api/v1/runs/{RUN}/diff?path={VIEWER_FILE_TS.replace('/', '%2F')}"],
            opens == [],                               # inline view: zero external opens
        ]),
        "status_run_resolved": status_run,
        **diff_state,
        "reads": list(reads),
    }

    # ── Scene 3 (AC 1 second half): File tab shows numbered content ─────────────
    page.locator('[data-testid="viewer-tab-file"]').click()
    page.get_by_text("export function rateLimit(opts: Opts) {").wait_for(timeout=10000)
    file_state = page.evaluate(
        """() => {
          const pre = document.querySelector('[data-testid="file-viewer"] pre');
          const nums = pre ? pre.querySelectorAll('span[aria-hidden="true"]') : [];
          return {
            lineNumbers: nums.length,
            firstNum: nums[0]?.textContent ?? null,
            numsUnselectable: nums[0] ? getComputedStyle(nums[0]).userSelect === 'none' : false,
          };
        }"""
    )
    report["steps"]["file_tab_numbered_content"] = {
        "ok": all([
            file_state["lineNumbers"] >= 15,
            file_state["firstNum"] == "1",
            file_state["numsUnselectable"],
            len(reads) == 2 and reads[1].startswith(f"/api/v1/runs/{RUN}/files?path="),
        ]),
        **file_state,
        "reads": list(reads),
    }

    # ── Scene 4 (AC 6): Escape closes; focus returns to the row ─────────────────
    page.keyboard.press("Escape")
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"file-viewer\"]') === null", timeout=5000
    )
    focus_back = page.evaluate(
        """(title) => document.activeElement?.getAttribute('title') === title""",
        f"View {VIEWER_FILE_TS}",
    )
    report["steps"]["escape_closes_focus_returns"] = {"ok": bool(focus_back)}

    # ── Scene 5 (AC 3): the >512 KB file — truncation banner on the File tab ────
    page.locator(f'button[title="View {VIEWER_FILE_BIG}"]').click()
    page.locator('[data-testid="file-viewer"]').wait_for(timeout=10000)
    page.locator('[data-testid="viewer-tab-file"]').click()
    page.locator('[data-testid="viewer-truncation-banner"]').wait_for(timeout=10000)
    banner = page.locator('[data-testid="viewer-truncation-banner"]').text_content() or ""
    page.screenshot(path=str(VSHOTS / "feedback2-I-file-truncated.png"))
    report["steps"]["truncation_banner"] = {
        "ok": "showing first 512 KB" in banner and "700.0 KB total" in banner,
        "banner": banner,
    }
    page.keyboard.press("Escape")

    # ── Scene 6 (AC 3): the binary file — honest state, never mojibake ──────────
    page.locator(f'button[title="View {VIEWER_FILE_BIN}"]').click()
    page.locator('[data-testid="viewer-binary"]').wait_for(timeout=10000)
    binary_text = page.locator('[data-testid="viewer-binary"]').text_content() or ""
    report["steps"]["binary_honest_state"] = {
        "ok": "binary file — 20.0 KB" in binary_text and opens == [],
        "text": binary_text, "opens": list(opens),
    }
    page.keyboard.press("Escape")

    # ── Scene 7 (AC 4): the outside-root file — 403 surfaced VERBATIM ───────────
    page.locator(f'button[title="View {VIEWER_FILE_403}"]').click()
    page.locator('[data-testid="viewer-error"]').wait_for(timeout=10000)
    err_text = page.locator('[data-testid="viewer-error"]').text_content() or ""
    report["steps"]["forbidden_surfaced_verbatim"] = {
        "ok": "API 403: path is outside every allowed root (the run's workdir/write roots "
              "and the registered repos)" in err_text,
        "text": err_text,
    }
    page.keyboard.press("Escape")

    # ── Scene 8 (AC 5): [Full diff] — whole-run diff + the adversarial +++ line ─
    reads_before = len(reads)
    page.locator('[data-testid="files-full-diff"]').click()
    page.locator('[data-testid="file-viewer"]').wait_for(timeout=10000)
    page.locator('[data-testid="diff-line-add"]').first.wait_for(timeout=10000)
    adversarial = page.evaluate(
        """() => {
          const adds = Array.from(document.querySelectorAll('[data-testid="diff-line-add"]'));
          const trap = adds.find((el) => el.textContent.includes('staged: bucket first'));
          const headers = Array.from(document.querySelectorAll('[data-testid="file-viewer"] pre div'))
            .filter((el) => el.textContent.startsWith('+++ b/'))
            .map((el) => el.dataset.testid ?? 'none');
          return {
            trapIsAddition: !!trap && trap.textContent.startsWith('+++ staged'),
            fileHeadersNotAdds: headers.every((t) => t === 'none'),
            addCount: adds.length,
          };
        }"""
    )
    report["steps"]["full_diff_and_adversarial_classifier"] = {
        "ok": all([
            adversarial["trapIsAddition"],       # `+++ staged…` = ADDED content line
            adversarial["fileHeadersNotAdds"],   # `+++ b/…` headers stay headers
            adversarial["addCount"] >= 5,
            reads[reads_before:] == [f"/api/v1/runs/{RUN}/diff"],  # NO ?path
        ]),
        **adversarial,
        "reads": reads[reads_before:],
    }
    page.keyboard.press("Escape")

    # ── Scene 9 (AC 7): a daemon WITHOUT the routes — today's exact fallback ────
    set_fixture(ORIGIN, file_routes=False)
    opens.clear()
    open_files_panel(page)
    page.locator(f'button[title="View {VIEWER_FILE_TS}"]').click()
    # The viewer never lingers as an empty shell: it yields to the external open,
    # whose own 404 fallback (this fixture has no /open either) copies the path.
    page.get_by_text("open unavailable — path copied").wait_for(timeout=10000)
    page.wait_for_function(
        "() => document.querySelector('[data-testid=\"file-viewer\"]') === null", timeout=5000
    )
    report["steps"]["route_absent_fallback"] = {
        "ok": opens == ["/api/v1/open"],
        "opens": list(opens),
    }

    page.close()
    ctx.close()
    browser.close()

report["console_errors"] = console_errors[:10]
report["screenshots"] = [
    str(VSHOTS / "feedback2-I-diff-view.png"),
    str(VSHOTS / "feedback2-I-file-truncated.png"),
]

bad = [k for k, v in report["steps"].items() if not v["ok"]]
if bad:
    fail("sliceI_verdict", f"slice-I assertions did not all hold — see {', '.join(bad)}")

report["ok"] = True
print(json.dumps(report, indent=2))
