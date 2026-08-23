#!/usr/bin/env python3
"""
ux_sliceU_test.py — the DES-UX-001 slice-U gate: the Unfiled path (§6.2, B2).

BRIDGE-UX-1 probe 3 (§8.4.1) fixed the shape: make-Unfiled-work IS the design —
the bridge hosts a project-unbound doc natively (`POST /api/docs` with NO
`project` field), crew's proxy synthesizes the `default` project's interactive
mount by design (proxy-routes.ts `rootFor()` skips the existence check for
`default`), and a refused bind is a loud 502 with NOTHING created.

Two halves, both mandatory:

PART A — the crew-proxy hop (§8.4.1 probe 3's named verify-at-slice-time
obligation: "end-to-end creation THROUGH crew's default mount was not driven
by this rig — slice U's own rig verifies that hop at slice time"). A REAL
wicked-interactive bridge on a temp root (crew lookups pinned to a dead port,
the wire-contract rig's hermeticity rule — never the live 7701 daemon) is
ADOPTED by a REAL crew daemon (`CREW_CLI`, stub engine, throwaway db,
`WICKED_INTERACTIVE_ROOT` = the same root), and the rig drives:
  A1  crew synthesizes `default` (named "Unfiled") on GET /projects;
  A2  POST /api/v1/projects/default/interactive/api/docs with NO `project`
      field → created; listed; the rendered doc serves text/html THROUGH the
      proxy; the doc dir exists in THIS rig's root (the adopted bridge, not a
      stray npx spawn);
  A3  the refused bind through the same mount (a `project` field while the
      bridge's crew lookup points at the dead port) → 502 whose body names
      "unreachable", and NOTHING was created (doc 404s, no dir on disk).

PART B — the studio surface (§6.2's DOM ACs), on the shared W2 fixture:
  B1  Make ＋ → Document → the picker stage says Unfiled works; selecting
      Unfiled BY MOUSE navigates to /p/default/document within the
      interaction (the dead-end regression pin: never a silent close), the
      context header labels it "Unfiled" (the run-surface labeling), and the
      doc surface renders;
  B2  a brief sent from that surface POSTs the create to the DEFAULT mount
      with NO `project` key in the body (the unbound contract on the studio's
      own traffic) and lands on /p/default/document/<doc>;
  B3  the doc is FINDABLE: the default mount's doc picker lists it, and the
      Make dashboard's doc corpus lists it labeled "Unfiled" (in-session
      navigation — the docsCache is session state);
  B4  selecting Unfiled BY KEYBOARD (trigger Enter → ArrowDown → Enter)
      navigates the same way — §6.2 asserts both drive paths;
  B5  the refused bind surfaces HONESTLY on a real-project mount: with the
      fixture answering the bridge's real 502 refused-bind shape, the send
      renders the composer error naming the cause — no navigation, no thread
      row, nothing created (`create_fail`, reset after).

Capture (§12.0 contract: 1440x900, device_scale_factor=1) into e2e/shots/vision/:
  ux-U-unfiled.png   the created unfiled doc open at /p/default/document/<doc>,
                     context header reading "Unfiled"

Prereqs: Python Playwright; a built crew CLI (CREW_CLI, default
../wicked-crew/packages/crew/dist/cli/index.js); the wicked-interactive
checkout (WICKED_INTERACTIVE_DIR, default ../wicked-interactive). Builds
dist-sameorigin/ itself unless SKIP_STUDIO_BUILD=1. Env knobs: FEEDBACK_PORT
(default 4392), CREW_CLI, WICKED_INTERACTIVE_DIR, SKIP_STUDIO_BUILD.
Prints a JSON report to stdout; exit 0/1.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from uxfix_fixture import (
    HIDE_GATE_TOASTS,
    REPO,
    ensure_build,
    set_fixture,
    start_server,
)

FEEDBACK_PORT = int(os.environ.get("FEEDBACK_PORT", "4392"))
ORIGIN = f"http://127.0.0.1:{FEEDBACK_PORT}"
VSHOTS = REPO / "e2e" / "shots" / "vision"

CREW_CLI = Path(os.environ.get(
    "CREW_CLI",
    REPO.parent / "wicked-crew" / "packages" / "crew" / "dist" / "cli" / "index.js"))
WI_DIR = Path(os.environ.get("WICKED_INTERACTIVE_DIR", str(REPO.parent / "wicked-interactive")))

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


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http(method: str, url: str, body: dict | None = None) -> tuple[int, str, str]:
    """status, text, content-type — non-2xx answers return, never raise."""
    req = urllib.request.Request(url, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=30) as res:
            return res.status, res.read().decode(), res.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), e.headers.get("Content-Type", "")


# ═══ PART A — the crew-proxy hop (§8.4.1 probe 3's slice-time obligation) ═══════

if not CREW_CLI.is_file():
    fail("crew_cli", f"{CREW_CLI} missing — build wicked-crew first, or set CREW_CLI")
wi_cli = WI_DIR / "bin" / "wicked-interactive.js"
if not wi_cli.is_file():
    fail("bridge_checkout",
         f"wicked-interactive not found at {WI_DIR} — set WICKED_INTERACTIVE_DIR")

tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="ux-sliceU-")))
docs_root = tmp / "docs"
docs_root.mkdir(parents=True)
bridge_port = free_port()
crew_port = free_port()
# Hermeticity (the wire-contract rig's rule): the BRIDGE's crew lookups pin to a
# port nothing listens on, so the refused-bind leg can never reach — let alone
# write into — the operator's live daemon on 7701. The synthesized-default hop
# under test is crew→bridge; the bridge only dials crew when a `project` field
# asks it to bind, which is exactly the leg that must refuse loudly here.
dead_crew_port = free_port()

bridge_log = (tmp / "bridge.log").open("w")
bridge = subprocess.Popen(
    ["node", str(wi_cli), "serve", "--root", str(docs_root), "--port", str(bridge_port)],
    cwd=str(WI_DIR),
    env=dict(os.environ, WICKED_BUS_DATA_DIR=str(tmp / "bus"),
             WICKED_CREW_API=f"http://127.0.0.1:{dead_crew_port}"),
    stdout=bridge_log, stderr=bridge_log,
)
daemon: subprocess.Popen | None = None

try:
    deadline = time.time() + 30
    bridge_up = False
    while time.time() < deadline:
        if bridge.poll() is not None:
            fail("bridge_start", f"bridge exited rc={bridge.returncode}:\n"
                 + (tmp / "bridge.log").read_text()[-2000:])
        try:
            s, t, _ = http("GET", f"http://127.0.0.1:{bridge_port}/api/health")
            if s == 200 and json.loads(t).get("ok") is True:
                bridge_up = True
                break
        except OSError:
            pass
        time.sleep(0.2)
    if not bridge_up:
        fail("bridge_start", "bridge /api/health never answered ok:true")
    report["steps"]["bridge_start"] = {"ok": True, "root": str(docs_root), "port": bridge_port}

    # The REAL crew daemon (studio_standalone's spawn pattern) with its shared
    # default root pointed at the SAME directory, so the pool ADOPTS the bridge
    # above via <root>/.wi-serve.json instead of npx-spawning a second one.
    daemon = subprocess.Popen(
        ["node", str(CREW_CLI), "serve", "--port", str(crew_port),
         "--db", str(tmp / "core.db"), "--stub"],
        cwd=str(tmp),
        env=dict(os.environ, WICKED_MEMORY_EMBEDDER="hash",
                 WICKED_INTERACTIVE_ROOT=str(docs_root)),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    ready = False
    deadline = time.time() + 60
    assert daemon.stdout is not None
    while time.time() < deadline:
        line = daemon.stdout.readline()
        if not line:
            break
        if "WICKED_CREW_READY" in line:
            ready = True
            break
    if not ready:
        fail("crew_daemon", "daemon never printed WICKED_CREW_READY within 60s")
    threading.Thread(target=lambda: [None for _ in daemon.stdout], daemon=True).start()
    CREW = f"http://127.0.0.1:{crew_port}/api/v1"
    report["steps"]["crew_daemon"] = {"ok": True, "port": crew_port, "stub": True}

    # A1 — crew synthesizes `default`, named "Unfiled" (the labeling truth the
    # studio's context header renders from the projects list).
    s, t, _ = http("GET", f"{CREW}/projects")
    rows = json.loads(t).get("projects", []) if s == 200 else []
    default_row = next((p for p in rows if p.get("id") == "default"), None)
    check("A1_crew_synthesizes_default_named_unfiled",
          s == 200 and default_row is not None and default_row.get("name") == "Unfiled",
          status=s, default_row=default_row)

    # A2 — end-to-end creation THROUGH crew's default mount: no `project` field.
    MOUNT = f"{CREW}/projects/default/interactive"
    DOC = "ux-u-unfiled-doc"
    s_create, t_create, _ = http("POST", f"{MOUNT}/api/docs", {
        "name": DOC,
        "html": "<!DOCTYPE html><html><body><h1>unfiled</h1><p>slice U</p></body></html>",
    })
    created = s_create == 200 and json.loads(t_create).get("name") == DOC
    s_list, t_list, _ = http("GET", f"{MOUNT}/api/docs")
    listed = s_list == 200 and any(d.get("name") == DOC for d in json.loads(t_list))
    s_doc, _, ct_doc = http("GET", f"{MOUNT}/d/{DOC}/doc")
    served = s_doc == 200 and ct_doc.startswith("text/html")
    # The doc landed in THIS rig's root — crew adopted the pre-started bridge
    # (an npx-spawned stray would have written somewhere else entirely).
    on_disk = (docs_root / DOC).is_dir()
    check("A2_create_through_crews_default_mount",
          created and listed and served and on_disk,
          create_status=s_create, listed=listed, doc_status=s_doc,
          content_type=ct_doc, adopted_bridge_root_has_doc=on_disk)

    # A3 — the refused bind through the SAME mount is loud and creates nothing:
    # a `project` field makes the bridge dial crew (pinned dead above) BEFORE
    # any disk write; the 502 rides back through crew's proxy verbatim.
    GHOST = "ux-u-ghost-doc"
    s_bind, t_bind, _ = http("POST", f"{MOUNT}/api/docs", {
        "name": GHOST, "html": "<html><body>x</body></html>", "project": "default",
    })
    s_ghost, _, _ = http("GET", f"{MOUNT}/d/{GHOST}/doc")
    check("A3_refused_bind_is_loud_502_creating_nothing",
          s_bind == 502 and "unreachable" in t_bind and s_ghost == 404
          and not (docs_root / GHOST).exists(),
          bind_status=s_bind, body=t_bind[:200], ghost_doc_status=s_ghost,
          ghost_on_disk=(docs_root / GHOST).exists())
finally:
    if daemon is not None:
        daemon.kill()
    bridge.kill()

# ═══ PART B — the studio surface (§6.2 DOM ACs), on the shared W2 fixture ═══════

dist = ensure_build(fail)
start_server(FEEDBACK_PORT, dist)
set_fixture(ORIGIN, create_fail=False)
report["steps"]["fixture_server"] = {"ok": True, "origin": ORIGIN}

from playwright.sync_api import sync_playwright  # noqa: E402 (import after server, harness style)

VSHOTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()

    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # Tap every create POST: B2 pins the studio's OWN traffic to the unbound
    # contract (no `project` key through the default mount), B5 the bound one.
    create_posts: list[dict] = []

    def on_request(req):
        path = urlparse(req.url).path
        if req.method == "POST" and path.endswith("/interactive/api/docs"):
            try:
                body = json.loads(req.post_data or "{}")
            except json.JSONDecodeError:
                body = {}
            create_posts.append({"path": path, "body": body})

    page.on("request", on_request)

    # ── B1: Make ＋ → Document → Unfiled BY MOUSE lands on the doc surface ──────
    page.goto(f"{ORIGIN}/", wait_until="domcontentloaded")
    page.locator('[data-testid="rail-heading-make"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-new"]').click()
    page.locator('[data-testid="make-picker-row"][data-mode="document"]').click()
    page.locator('[data-testid="make-picker-project-stage"]').wait_for(timeout=10000)
    stage_copy = page.locator('[data-testid="make-picker-project-stage"] p').first.text_content() or ""
    page.locator('[data-testid="project-field"]').click()
    page.locator('[data-testid="project-switcher-unfiled"]').click()
    page.wait_for_function(
        """() => window.location.pathname === '/p/default/document'
              && !document.querySelector('[data-testid="make-picker"]')""", timeout=10000)
    # The surface labels it the way run surfaces label Unfiled runs (§6.2): the
    # context header's project name renders the synthesized row's name.
    page.wait_for_function(
        """() => (document.querySelector('[data-testid="project-name"]')?.textContent ?? '')
                   .includes('Unfiled')""", timeout=10000)
    surface = page.evaluate(
        """() => ({
             path: window.location.pathname,
             pickerGone: !document.querySelector('[data-testid="make-picker"]'),
             docSurface: !!document.querySelector('[data-testid="mode-surface"][data-mode="document"]'),
             header: document.querySelector('[data-testid="project-name"]')?.textContent ?? null,
             composer: !!document.querySelector('[data-testid="doc-composer"]'),
           })""")
    check("B1_mouse_unfiled_navigates_not_dead_end",
          surface["path"] == "/p/default/document" and surface["pickerGone"]
          and surface["docSurface"] and surface["composer"]
          and "Unfiled" in (surface["header"] or "")
          and "Unfiled" in stage_copy,
          stage_copy=stage_copy, **surface)

    # ── B2: the create rides the DEFAULT mount UNBOUND, and lands ──────────────
    BRIEF = "Collect the unfiled meeting notes into a brief"
    page.locator('[data-testid="doc-composer"]').fill(BRIEF)
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-canvas"]').wait_for(timeout=30000)
    doc_path = urlparse(page.url).path
    doc_id = doc_path.rsplit("/", 1)[-1]
    unfiled_creates = [c for c in create_posts
                       if c["path"] == "/api/v1/projects/default/interactive/api/docs"]
    check("B2_create_unbound_through_default_mount",
          doc_path.startswith("/p/default/document/") and len(unfiled_creates) == 1
          and "project" not in unfiled_creates[0]["body"]
          and unfiled_creates[0]["body"].get("brief") == BRIEF,
          doc_path=doc_path, create_bodies=[c["body"] for c in unfiled_creates])

    # The named shot: the unfiled doc open, context header reading "Unfiled".
    page.screenshot(path=str(VSHOTS / "ux-U-unfiled.png"))

    # ── B3: findable — the mount's doc picker AND the Make dashboard corpus ────
    page.go_back()  # SPA history → /p/default/document (the picker re-lists + deposits)
    page.locator(f'[data-testid="doc-picker-row"][data-doc-id="{doc_id}"]').wait_for(timeout=10000)
    # In-session navigation (the docsCache is session state): header ‹ Projects
    # → the rail → the Make dashboard.
    page.locator('[data-testid="project-context-header"] button').first.click()
    page.locator('[data-testid="rail-heading-make"]').wait_for(timeout=10000)
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-dashboard"]').click()
    page.locator('[data-testid="make-list"]').wait_for(timeout=10000)
    make_row = page.evaluate(
        """(doc) => {
             const row = Array.from(document.querySelectorAll('[data-testid="make-doc-row"]'))
               .find((r) => (r.getAttribute('href') ?? '').includes(doc));
             return row === undefined ? null : {
               href: row.getAttribute('href'),
               label: row.textContent ?? '',
             };
           }""", doc_id)
    check("B3_doc_findable_in_picker_and_make_corpus",
          make_row is not None
          and make_row["href"] == f"/p/default/document/{doc_id}"
          and "Unfiled" in make_row["label"],
          doc_id=doc_id, make_row=make_row)

    # ── B4: the KEYBOARD drive of the same selection (§6.2: both paths) ────────
    page.locator('[data-testid="rail-heading-make"] [data-testid="heading-new"]').click()
    page.locator('[data-testid="make-picker-row"][data-mode="document"]').click()
    page.locator('[data-testid="make-picker-project-stage"]').wait_for(timeout=10000)
    page.locator('[data-testid="project-field"]').press("Enter")   # open the list
    page.locator('[data-testid="project-switcher-list"]').wait_for(timeout=5000)
    page.keyboard.press("ArrowDown")                               # focus the Unfiled row
    focused = page.evaluate(
        """() => document.activeElement?.getAttribute('data-testid') ?? null""")
    page.keyboard.press("Enter")                                   # select it
    page.wait_for_function(
        """() => window.location.pathname === '/p/default/document'
              && !document.querySelector('[data-testid="make-picker"]')""", timeout=10000)
    check("B4_keyboard_unfiled_navigates",
          focused == "project-switcher-unfiled"
          and urlparse(page.url).path == "/p/default/document",
          focused=focused, path=urlparse(page.url).path)

    # ── B5: the refused bind surfaces HONESTLY on a real-project mount ─────────
    page.goto(f"{ORIGIN}/p/scratch/document", wait_until="domcontentloaded")
    page.locator('[data-testid="thread"][data-composer-state="idle"]').wait_for(timeout=30000)
    page.add_style_tag(content=HIDE_GATE_TOASTS)
    set_fixture(ORIGIN, create_fail=True)
    create_posts.clear()
    page.locator('[data-testid="doc-composer"]').fill("A deck that cannot be filed")
    page.keyboard.press("Enter")
    page.locator('[data-testid="doc-composer-error"]').wait_for(timeout=10000)
    refused = page.evaluate(
        """() => ({
             path: window.location.pathname,
             error: document.querySelector('[data-testid="doc-composer-error"]')?.textContent ?? '',
             noThreadRow: !document.querySelector('[data-testid="doc-message"]'),
             noCanvas: !document.querySelector('[data-testid="doc-canvas"]'),
           })""")
    bound = [c for c in create_posts if c["path"].endswith("/scratch/interactive/api/docs")]
    check("B5_refused_bind_loud_on_the_surface",
          refused["path"] == "/p/scratch/document"
          and "unreachable" in refused["error"]
          and refused["noThreadRow"] and refused["noCanvas"]
          and len(bound) == 1 and bound[0]["body"].get("project") == "scratch",
          bound_bodies=[c["body"] for c in bound], **refused)
    set_fixture(ORIGIN, create_fail=False)

    # Console hygiene: the deliberate 502 logs one resource error; nothing else may.
    unexpected = [e for e in console_errors
                  if "502" not in e and "Failed to load resource" not in e]
    check("B6_no_unexpected_console_errors", unexpected == [], errors=unexpected)

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
report["shots"] = ["ux-U-unfiled.png"]
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
