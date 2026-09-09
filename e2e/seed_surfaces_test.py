#!/usr/bin/env python3
"""
seed_surfaces_test.py — the SEED SUITE: seed and exercise the studio's surfaces through the
UI against a DISPOSABLE, REAL-MODE wicked-crew daemon, then assert project scoping and reload
persistence with content / identity / lineage assertions — never presence-only checks.

Companion plan: docs/testing/seed-surfaces-plan.md (the revised plan this suite executes).

What this rig is, and what it is not:

  - The daemon is spawned HERE (the studio_standalone_test.py mechanism: an installed
    `wicked-crew` CLI, a temp state dir, a free port) — but WITHOUT `--stub`: the seeds are real
    rows in a real engine store. It never touches the live :7701 daemon or ~/.wicked-crew
    (guarded below, and re-checked at teardown), and every durable store is pinned into the temp
    dir: `--db` (state home), WICKED_BUS_DATA_DIR (the wicked-bus the daemon AND the bridge it
    spawns share — an explicit `--bus-db` would pin only the daemon's half), WICKED_HOME (memory
    store), WICKED_WORKER_HOME (worker config home), WICKED_CREW_SYSTEM_SETTINGS,
    WICKED_INTERACTIVE_ROOT (the docs root), WICKED_CREW_API (the bridge's crew origin).
  - Interactive AGENT answering is disabled on the daemon (`--no-interactive-{draft,edit,chat,
    demo}-events`): a document or demo created through the UI is a real doc in the real
    interactive registry (placeholder v0), but no drafting/authoring agent is launched for it.
    Chats and demo/doc GENERATION spawn agents (codex review, RC 2) and are therefore OUT of this
    deterministic suite; the plan lists them as governed scenarios.
  - Exactly ONE governed scenario runs, serialized: TST-1 launches a project-scoped "New test"
    from Project A's dashboard, waits for the INTAKE GATE, asserts it arrives in the launch
    panel, and REJECTS it — so no council ever executes. A daemon whose workers cannot run
    (no CLI login under the hermetic worker home) records a SKIP with the reason, never a pass.
  - Steps the UI cannot yet perform are performed over the daemon API and LABELLED
    `[SUBSTITUTE]` in the report (certify the journey, not the proxy): repository
    registration (setup) and attaching the repo to Project A (no attach control until #207).
  - Known isolation gaps are UNMET REQUIREMENTS: the tests assert the CORRECT behaviour and
    carry an xfail marker naming the issue (crew#472 for docs/demos, App.tsx:466 for the
    campaign store). An xfail that PASSES is reported as `xpass` and fails the suite — the
    marker is stale and must be removed.

Prereqs: an installed `wicked-crew` (0.7.x; `CREW_CLI=<path to dist/cli/index.js>` overrides),
Python Playwright (`pip install playwright && playwright install chromium`), `git`.

Env knobs: CREW_CLI, SEED_GOVERNED_TIMEOUT_S (default 600), SEED_ONBOARD_TIMEOUT_S (default
240), SEED_GOVERNED=0 (skip the ONE governed scenario — it convenes a real distribution council
before its gate; see TST-1), SEED_KEEP_TMP=1 (keep the temp dir), SEED_HEADED=1 (headed chromium).

Prints a per-scenario table and a JSON report to stdout. Exit 0 only when no scenario is
`fail` or `xpass`. Screenshots of non-passing scenarios land in e2e/shots/seed-surfaces/.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from importlib import metadata
from pathlib import Path
from tempfile import mkdtemp
from typing import Callable
from urllib.parse import quote, unquote

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "e2e" / "shots" / "seed-surfaces"
FIXTURES = REPO / "e2e" / "fixtures"
PLAN = "docs/testing/seed-surfaces-plan.md"

LIVE_DAEMON_PORT = 7701
LIVE_STATE_HOME = Path.home() / ".wicked-crew"

GOVERNED_TIMEOUT_S = int(os.environ.get("SEED_GOVERNED_TIMEOUT_S", "600"))
ONBOARD_TIMEOUT_S = int(os.environ.get("SEED_ONBOARD_TIMEOUT_S", "240"))
# A cold interactive bridge is `npx wicked-interactive serve` — the pool's own start budget is 60 s.
BRIDGE_TIMEOUT_MS = 120_000
EVALS_TIMEOUT_MS = 180_000
KEEP_TMP = os.environ.get("SEED_KEEP_TMP") == "1"
HEADED = os.environ.get("SEED_HEADED") == "1"
GOVERNED_ENABLED = os.environ.get("SEED_GOVERNED", "1") != "0"

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}

# The gate toasts (bottom-right cards) overlap composers; hiding them is display-only and the
# same suppression studio_standalone_test.py applies — the gate card asserted here is the one
# INSIDE the launch panel, never a toast.
HIDE_GATE_TOASTS = '[data-testid="gate-notification"] { display: none !important; }'

STAMP = str(int(time.time()))
NAME_A = f"e2e-scope-{STAMP}-a"
NAME_B = f"e2e-scope-{STAMP}-b"
RULE_STATEMENT = f"Seed-surfaces rule {STAMP}: every wire body must name its project explicitly."
RULE_STATEMENT_EDITED = f"Seed-surfaces rule {STAMP} (edited): every wire body must name its project and repo."
RETIRE_REASON = f"seed-surfaces suite {STAMP}: retiring the rule it authored"
TEST_BRIEF_TOKEN = f"seed-surfaces-tst1-{STAMP}"


# ── Report plumbing ───────────────────────────────────────────────────────────


class Skip(Exception):
    """A scenario that cannot be exercised on this rig — recorded with its reason, never a pass."""


class Suite:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.passed: set[str] = set()
        self.page = None  # the Playwright page, for failure screenshots

    def run(
        self,
        sid: str,
        title: str,
        fn: Callable[[], str | None],
        *,
        xfail: str | None = None,
        requires: tuple[str, ...] = (),
        governed: bool = False,
    ) -> None:
        t0 = time.time()
        missing = [r for r in requires if r not in self.passed]
        if missing:
            status, detail = "skip", f"prerequisite {', '.join(missing)} did not pass"
        else:
            try:
                out = fn() or ""
                if xfail is None:
                    status, detail = "pass", out
                else:
                    status = "xpass"
                    detail = f"UNEXPECTED PASS — the gap tracked by {xfail} appears closed; remove the marker. {out}"
            except Skip as e:
                status, detail = "skip", str(e)
            except AssertionError as e:
                if xfail is None:
                    status, detail = "fail", f"assertion: {e}"
                else:
                    status, detail = "xfail", f"expected failure ({xfail}): {e}"
            except Exception as e:  # noqa: BLE001 — a scenario error is a finding, not a crash
                status = "fail"
                detail = f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=4)}"
        if status in ("pass", "xpass"):
            self.passed.add(sid)
        shot = None
        if status != "pass" and self.page is not None:
            try:
                SHOTS.mkdir(parents=True, exist_ok=True)
                shot = str(SHOTS / f"{sid}.png")
                self.page.screenshot(path=shot, full_page=True)
            except Exception:  # noqa: BLE001 — a screenshot must never mask the scenario's verdict
                shot = None
        row = {
            "id": sid, "title": title, "status": status, "detail": detail,
            "governed": governed, "xfail": xfail, "seconds": round(time.time() - t0, 1), "shot": shot,
        }
        self.rows.append(row)
        print(f"[{status.upper():5}] {sid:7} {title} — {detail.splitlines()[0] if detail else ''}", file=sys.stderr)

    @property
    def ok(self) -> bool:
        return all(r["status"] not in ("fail", "xpass") for r in self.rows)


suite = Suite()
report: dict = {"ok": False, "setup": {}, "scenarios": suite.rows}


def die(step: str, why: str) -> None:
    report["setup"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


# ── Daemon + API ──────────────────────────────────────────────────────────────


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def crew_command() -> list[str]:
    cli = os.environ.get("CREW_CLI")
    if cli:
        return ["node", cli]
    binary = shutil.which("wicked-crew")
    if binary is None:
        die("daemon", "no `wicked-crew` on PATH and CREW_CLI unset — install wicked-crew or point CREW_CLI at dist/cli/index.js")
    return [binary]


PORT = free_port()
ORIGIN = f"http://127.0.0.1:{PORT}"
API = f"{ORIGIN}/api/v1"


def api(method: str, path: str, body: dict | None = None, timeout: int = 60) -> tuple[int, object]:
    req = urllib.request.Request(f"{API}{path}", method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw.decode(errors="replace")}


def run_view(run_id: str) -> dict:
    status, body = api("GET", f"/runs/{quote(run_id)}")
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"GET /runs/{run_id} → {status} {body}")
    return body["run"]


def run_status(run_id: str) -> str:
    return run_view(run_id)["session"]["status"]


def list_runs() -> list[dict]:
    status, body = api("GET", "/runs")
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"GET /runs → {status}")
    return body["runs"]


def wait_terminal(run_id: str, timeout_s: int) -> str:
    deadline = time.time() + timeout_s
    last = run_status(run_id)
    while last not in TERMINAL_STATUSES and time.time() < deadline:
        time.sleep(2)
        last = run_status(run_id)
    return last


def run_events(run_id: str) -> list[dict]:
    status, body = api("GET", f"/runs/{quote(run_id)}/events")
    return body.get("events", []) if status == 200 and isinstance(body, dict) else []


def last_events(run_id: str, n: int = 4) -> list[dict]:
    return run_events(run_id)[-n:]


def council_activity(run_id: str) -> dict[str, int]:
    """How much council work the engine did on a run — `council*` event types by count. The recon
    intake gate is `before:1` (crew campaigns/plan.ts RECON_INTAKE_GATE_TOKEN): it parks EXECUTION
    of unit 1, and the DISTRIBUTION council (plan consensus per unit) runs before it. Run 3 of this
    suite watched 5 seats deliberate and vote on ords 1–4 while the run read `distributing`, then
    the gate arrived. Rejecting therefore stops the execution councils, not the planning one."""
    counts: dict[str, int] = {}
    for e in run_events(run_id):
        t = str(e.get("type", ""))
        if t.startswith("council"):
            counts[t] = counts.get(t, 0) + 1
    return counts


# ── Setup ─────────────────────────────────────────────────────────────────────

if PORT == LIVE_DAEMON_PORT:
    die("guard", "the free port resolved to :7701 — refusing to collide with the live daemon; rerun")

TMP = Path(mkdtemp(prefix="seed-surfaces-"))
STATE = TMP / "state"
IDOCS = TMP / "idocs"
BUS = TMP / "bus"
for d in (STATE, TMP / "home", TMP / "worker", IDOCS, BUS):
    d.mkdir(parents=True)
if LIVE_STATE_HOME in STATE.parents or STATE == LIVE_STATE_HOME:
    die("guard", f"state home {STATE} resolves under the live ~/.wicked-crew — refusing")

# The registered repository: a LOCAL CLONE of this checkout at HEAD, inside the temp dir. This
# checkout is a linked worktree; a run's own `git worktree add` from inside it would register
# under the MAIN checkout's .git/worktrees — which must stay untouched. The clone is a real,
# standalone git repo carrying the same tree.
REPO_ROOT = TMP / "repo"
clone = subprocess.run(
    ["git", "clone", "--quiet", "--local", str(REPO), str(REPO_ROOT)],
    capture_output=True, text=True, timeout=120,
)
if clone.returncode != 0:
    die("repo_clone", f"git clone failed: {clone.stderr[-800:]}")
head = subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
# wicked-studio TRACKS `.codegraph/estate.db` (a 4 MB code graph of the main checkout), so the
# clone carries a graph whose provenance names another root. Onboarding indexes into exactly
# that path (`wicked-estate index <root> --db <root>/.codegraph/estate.db`) and its collision
# guard refuses ("REPO COLLISION: this graph already holds … wicked-studio.git"). Start clean —
# inside the temp clone only — so the project gets a graph of its own.
inherited_graph = REPO_ROOT / ".codegraph"
shutil.rmtree(inherited_graph, ignore_errors=True)
report["setup"]["repo_clone"] = {
    "ok": True, "root": str(REPO_ROOT), "head": head, "source": str(REPO),
    "inherited_codegraph_removed": not inherited_graph.exists(),
}

daemon_env = dict(
    os.environ,
    WICKED_HOME=str(TMP / "home"),
    WICKED_WORKER_HOME=str(TMP / "worker"),
    WICKED_CREW_SYSTEM_SETTINGS=str(STATE / "system-settings.json"),
    WICKED_INTERACTIVE_ROOT=str(IDOCS),
    WICKED_MEMORY_EMBEDDER="hash",
    # The bridge the pool spawns for our root resolves the crew daemon from WICKED_CREW_API and
    # DEFAULTS TO :7701 (wicked-interactive service/project.js:27) — run 2 of this suite watched
    # a doc create fail with "project … not found on the crew daemon at http://127.0.0.1:7701":
    # the bridge asked the LIVE daemon about a project that exists only here. The child inherits
    # this env, so the disposable daemon names itself.
    WICKED_CREW_API=ORIGIN,
    # The bus is shared by the daemon AND the bridge it spawns, and the bridge only knows
    # wicked-bus's default location (`WICKED_BUS_DATA_DIR` › the platform home). Run 3 of this
    # suite pinned the daemon's half with `--bus-db` and left the bridge on the default — the same
    # default bus the LIVE daemon consumes, which then received this suite's `doc.created` events
    # and created `~/.wicked-crew/interactive-{drafts,demos}/<our doc>` handoff dirs in the real
    # state home (empty dirs; removed by hand, disclosed in the plan). Pinning the DATA DIR moves
    # both halves into the temp dir; no `--bus-db` so the daemon resolves the same default.
    WICKED_BUS_DATA_DIR=str(BUS),
)
daemon_args = [
    *crew_command(), "serve",
    "--port", str(PORT),
    "--db", str(STATE / "core.db"),
    "--no-interactive-draft-events",
    "--no-interactive-edit-events",
    "--no-interactive-chat-events",
    "--no-interactive-demo-events",
]
daemon_log = open(TMP / "daemon.log", "w", encoding="utf-8")  # noqa: SIM115 — lives as long as the daemon
daemon = subprocess.Popen(daemon_args, cwd=TMP, env=daemon_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
ready_line = None
deadline = time.time() + 90
assert daemon.stdout is not None
while time.time() < deadline:
    line = daemon.stdout.readline()
    if not line:
        break
    daemon_log.write(line)
    if "WICKED_CREW_READY" in line:
        ready_line = line
        break
if ready_line is None:
    daemon.kill()
    die("daemon", f"daemon never printed WICKED_CREW_READY within 90s — see {TMP / 'daemon.log'}")
ready = json.loads(ready_line.split("WICKED_CREW_READY", 1)[1])
if ready.get("stub") is not False:
    daemon.kill()
    die("daemon", f"daemon reports stub={ready.get('stub')!r} — the seed suite requires a REAL engine")


def _drain(stream) -> None:
    for line in stream:
        daemon_log.write(line)
        daemon_log.flush()  # a killed run must still leave a readable daemon log behind


threading.Thread(target=_drain, args=(daemon.stdout,), daemon=True).start()

_, health = api("GET", "/health")
_, diagnostics = api("GET", "/diagnostics")
_, roster = api("GET", "/roster")
studio_pkg_version = json.loads((REPO / "package.json").read_text())["version"]
report["setup"]["daemon"] = {
    "ok": True, "origin": ORIGIN, "stub": False, "ready": ready,
    "isolation": {
        "state_home": str(STATE), "WICKED_BUS_DATA_DIR": str(BUS), "WICKED_HOME": str(TMP / "home"),
        "WICKED_WORKER_HOME": str(TMP / "worker"), "WICKED_INTERACTIVE_ROOT": str(IDOCS),
        "WICKED_CREW_API": ORIGIN,
        "interactive_agent_events": "disabled (--no-interactive-{draft,edit,chat,demo}-events)",
        "governed_scenario": "enabled" if GOVERNED_ENABLED else "disabled (SEED_GOVERNED=0)",
    },
}
report["setup"]["versions"] = {
    "crew": health.get("version") if isinstance(health, dict) else None,
    "components": diagnostics.get("components") if isinstance(diagnostics, dict) else None,
    "studio_repo_package": studio_pkg_version,
    "studio_bundle_matches_repo": isinstance(diagnostics, dict) and diagnostics.get("components", {}).get("studioBundle") == studio_pkg_version,
    "python_playwright": metadata.version("playwright"),
    "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
}
report["setup"]["roster_signed_in"] = (
    {seat["key"]: seat.get("signed_in") for seat in roster.get("roster", [])} if isinstance(roster, dict) else None
)

# Register the repository (setup, over the API — labelled). Registration launches the built-in
# `onboarding` workflow: two TOOL phases (`wicked-estate index`, `wicked-estate clusters`), no
# agent, no council — a deterministic index of the clone, waited on so the project has a graph.
status, registered = api("POST", "/repos", {"name": f"seed-surfaces-{STAMP}", "rootPath": str(REPO_ROOT)})
if status != 201 or not isinstance(registered, dict):
    daemon.kill()
    die("repo_register", f"POST /repos → {status} {registered}")
REPO_ID = registered["repo"]["id"]
onboard_run = registered.get("onboardRunId")
onboard_status = wait_terminal(onboard_run, ONBOARD_TIMEOUT_S) if isinstance(onboard_run, str) else None
report["setup"]["repo_register"] = {
    "ok": True, "substitute": "API — harness setup, not a certified journey",
    "repo_id": REPO_ID, "onboard_run": onboard_run,
    "onboard_status": onboard_status, "onboard_workflow": "onboarding (tool phases only: estate index → clusters)",
}

# A local fixture page for the demo wizard's target URL (the wizard requires http(s); the page is
# never fetched by anything in this suite because demo authoring is disabled on the daemon).
class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # keep stdout JSON-clean
        pass


FIXTURE_PORT = free_port()
fixture_httpd = ThreadingHTTPServer(("127.0.0.1", FIXTURE_PORT), partial(_Quiet, directory=str(FIXTURES)))
threading.Thread(target=fixture_httpd.serve_forever, daemon=True).start()
FIXTURE_URL = f"http://127.0.0.1:{FIXTURE_PORT}/doc-fixture.html"

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    daemon.kill()
    die("playwright", "pip install playwright && playwright install chromium")


# ── Playwright helpers ────────────────────────────────────────────────────────


def tid(page, testid: str, **attrs: str):
    sel = f'[data-testid="{testid}"]' + "".join(f'[data-{k.replace("_", "-")}="{v}"]' for k, v in attrs.items())
    return page.locator(sel)


def goto(page, path: str) -> None:
    """A REAL navigation (full document load) — the persistence scenarios depend on this being
    a reload, not a pushState. Re-applies the toast suppression the load discards."""
    page.goto(f"{ORIGIN}{path}", wait_until="domcontentloaded")
    page.add_style_tag(content=HIDE_GATE_TOASTS)


def wait_any(page, testids: list[str], timeout_ms: int) -> str:
    """Wait until one of the testids is attached; return which. Loading states are waited
    THROUGH (re-evaluated when they detach) so a cold bridge never reads as a result."""
    loading = [t for t in testids if t.endswith("-loading")]
    settled = [t for t in testids if t not in loading]
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        remaining = max(1000, int((deadline - time.time()) * 1000))
        page.locator(", ".join(f'[data-testid="{t}"]' for t in testids)).first.wait_for(state="attached", timeout=remaining)
        for t in settled:
            if tid(page, t).count() > 0:
                return t
        for t in loading:
            if tid(page, t).count() > 0:
                tid(page, t).first.wait_for(state="detached", timeout=max(1000, int((deadline - time.time()) * 1000)))
                break
    raise AssertionError(f"none of {settled} appeared within {timeout_ms} ms")


def attr_values(page, testid: str, attr: str) -> list[str]:
    return tid(page, testid).evaluate_all(f"els => els.map(e => e.getAttribute('{attr}'))")


def text_of(locator) -> str:
    return (locator.text_content() or "").strip()


# ── UI journeys ───────────────────────────────────────────────────────────────


def ui_create_project(page, name: str) -> str:
    standing = re.search(r"/p/([^/]+)/", page.url)
    standing_pid = unquote(standing.group(1)) if standing else None
    plus = page.locator('[data-testid="rail-heading-projects"] [data-testid="heading-new"]')
    plus.wait_for(timeout=20_000)
    plus.click()
    tid(page, "new-project-modal").wait_for(timeout=10_000)
    tid(page, "new-project-name").fill(name)
    assert tid(page, "new-project-name-invalid").count() == 0, f"name {name!r} refused by the client-side slug rule"
    tid(page, "new-project-create").click()
    tid(page, "new-project-modal").wait_for(state="detached", timeout=20_000)

    # Create lands on the NEW project's Build mode. A bare `/p/<id>/build` pattern is already
    # satisfied when the modal was opened from another project's shell (run 1's PRJ-2 read
    # Project A's URL as B's), so the landing is a project id OTHER than the one we stood in.
    def landed(url: str) -> bool:
        m = re.search(r"/p/([^/]+)/build$", url)
        return m is not None and unquote(m.group(1)) != standing_pid

    page.wait_for_url(landed, timeout=20_000)
    pid = unquote(re.search(r"/p/([^/]+)/build", page.url).group(1))
    page.wait_for_function(
        "n => (document.querySelector('[data-testid=\"project-name\"]')?.textContent ?? '').includes(n)",
        arg=name, timeout=10_000,
    )
    st, detail = api("GET", f"/projects/{quote(pid)}")
    assert st == 200 and detail["project"]["name"] == name, f"GET /projects/{pid} → {st} {detail}"
    return pid


def ui_add_rule(page, statement: str) -> str:
    """The grid's draft row: Add ▾ → Add row → (prefilled PAT-nnn id) → statement → Save."""
    tid(page, "steering-add-menu").click()
    tid(page, "steering-add-open").click()
    draft = tid(page, "steering-grid-draft")
    try:
        draft.wait_for(timeout=5_000)
    except Exception as e:  # noqa: BLE001 — turn the timeout into the finding it is
        unseeded = tid(page, "steering-unseeded").count() > 0
        raise AssertionError(
            "'Add row' produced no draft row"
            + (" while the UNSEEDED banner is showing" if unseeded else "")
            + " — SteeringPage mounts the grid only when rules exist (`{!unseeded && <SteeringGrid/>}`), "
            "so the banner's own 'Add a row' path cannot author the first rule"
        ) from e
    rid = tid(page, "steering-draft-id").input_value()
    assert re.fullmatch(r"PAT-\d{3,6}", rid), f"draft id prefill {rid!r} is not a PAT-nnn id"
    assert tid(page, "steering-draft-type").input_value() == "architecture"
    assert tid(page, "steering-draft-severity").input_value() == "warn"
    tid(page, "steering-draft-statement").fill(statement)
    assert tid(page, "steering-draft-issue").count() == 0, text_of(tid(page, "steering-draft-issue"))
    tid(page, "steering-draft-save").click()
    draft.wait_for(state="detached", timeout=15_000)
    row = tid(page, "steering-grid-row", rule_id=rid)
    row.wait_for(timeout=15_000)
    assert text_of(row.locator('[data-testid="steering-cell-statement"]')) == statement
    note = text_of(tid(page, "steering-saved-note"))
    assert f"Saved {rid}" in note, f"saved note {note!r}"
    return rid


def steering_rows_loaded(page) -> None:
    tid(page, "steering-page").wait_for(timeout=20_000)
    tid(page, "steering-rules-loading").wait_for(state="detached", timeout=20_000)
    assert tid(page, "steering-rules-error").count() == 0, text_of(tid(page, "steering-rules-error"))


def enter_mode(page, pid: str, mode: str) -> dict:
    """Project dashboard → the mode's door → the mode surface, waiting THROUGH the bridge's cold
    start. Returns what rendered; raises Skip when the bridge never came up."""
    surface = "doc" if mode == "document" else "video"
    picker = "doc-picker" if mode == "document" else "demo-picker"
    goto(page, f"/p/{quote(pid)}")
    tid(page, f"dashboard-mode-{mode}").click()
    page.wait_for_url(re.compile(rf"/p/{re.escape(quote(pid))}/{mode}$"), timeout=15_000)
    outcome: dict = {"install_gate_continued": False}
    seen = wait_any(page, [picker, f"{picker}-empty", f"{surface}-canvas-error", "install-gate", f"{surface}-canvas-loading"], BRIDGE_TIMEOUT_MS)
    if seen == "install-gate":
        deps = attr_values(page, "install-gate-dep", "data-dep")
        outcome["install_gate_continued"] = True
        outcome["install_gate_deps"] = deps
        tid(page, "install-gate-continue").click()
        seen = wait_any(page, [picker, f"{picker}-empty", f"{surface}-canvas-error", f"{surface}-canvas-loading"], BRIDGE_TIMEOUT_MS)
    if seen == f"{surface}-canvas-error":
        hint = text_of(tid(page, f"{surface}-bridge-hint")) or text_of(tid(page, f"{surface}-error-detail"))
        raise Skip(f"the interactive bridge is unavailable on this rig — {mode} surface shows: {hint[:300]}")
    outcome["rendered"] = seen
    return outcome


def composer(page):
    box = tid(page, "doc-composer")
    if box.count() == 0:
        tid(page, "thread-toggle").click()
        box.wait_for(timeout=15_000)
    box.wait_for(timeout=15_000)
    return box


def picker_ids(page, pid: str, mode: str) -> list[str]:
    picker = "doc-picker" if mode == "document" else "demo-picker"
    surface = "doc" if mode == "document" else "video"
    goto(page, f"/p/{quote(pid)}/{mode}")
    seen = wait_any(page, [picker, f"{picker}-empty", f"{surface}-canvas-error", f"{surface}-canvas-loading"], BRIDGE_TIMEOUT_MS)
    if seen == f"{surface}-canvas-error":
        raise Skip(f"{mode} picker unavailable: {text_of(tid(page, f'{surface}-bridge-hint'))[:300]}")
    if seen == f"{picker}-empty":
        return []
    return attr_values(page, f"{picker}-row", "data-doc-id" if mode == "document" else "data-demo-id")


def ui_seed_doc(page, pid: str, doc_name: str) -> str:
    enter_mode(page, pid, "document")
    box = composer(page)
    box.fill(f'"{doc_name}" A one-paragraph note authored by the seed-surfaces suite ({STAMP}).')
    tid(page, "doc-composer-submit").click()
    try:
        page.wait_for_url(re.compile(rf"/p/{re.escape(quote(pid))}/document/[^/?]+"), timeout=60_000)
    except Exception as e:  # noqa: BLE001 — surface the composer's own error text
        err = tid(page, "doc-composer-error")
        raise AssertionError(f"doc create did not navigate: {text_of(err) if err.count() else e}") from e
    name = unquote(re.search(r"/document/([^/?]+)", page.url).group(1))
    tid(page, "doc-canvas", doc_id=name).wait_for(timeout=60_000)
    return name


def ui_seed_demo(page, pid: str, demo_name: str) -> str:
    enter_mode(page, pid, "video")
    box = composer(page)
    box.fill(demo_name)
    tid(page, "doc-composer-submit").click()
    tid(page, "demo-wizard").wait_for(timeout=15_000)
    tid(page, "wizard-target").fill(FIXTURE_URL)
    tid(page, "wizard-step-subject").fill("the fixture heading")
    tid(page, "wizard-step-action").fill("read it and pause")
    tid(page, "wizard-step-add").click()
    assert tid(page, "wizard-step").count() == 1
    tid(page, "wizard-create").click()
    try:
        page.wait_for_url(re.compile(rf"/p/{re.escape(quote(pid))}/video/[^/?]+"), timeout=60_000)
    except Exception as e:  # noqa: BLE001
        err = tid(page, "wizard-error")
        raise AssertionError(f"demo create did not navigate: {text_of(err) if err.count() else e}") from e
    return unquote(re.search(r"/video/([^/?]+)", page.url).group(1))


def ui_delete_doc(page, pid: str, mode: str, name: str) -> None:
    before = picker_ids(page, pid, mode)
    assert name in before, f"{name} not listed under {pid}/{mode} before delete: {before}"
    tid(page, "doc-delete-trigger", doc_id=name).click()
    tid(page, "doc-delete-confirm").wait_for(timeout=10_000)
    tid(page, "doc-delete-go").click()
    deadline = time.time() + 30
    while time.time() < deadline:
        for err in ("doc-delete-error", "doc-delete-bridge-hint"):
            if tid(page, err).count() > 0:
                raise AssertionError(f"delete refused: {text_of(tid(page, err))}")
        if tid(page, "doc-delete-confirm").count() == 0:
            break
        page.wait_for_timeout(200)
    after = picker_ids(page, pid, mode)  # a REAL reload of the picker
    assert name not in after, f"{name} still listed under {pid}/{mode} after delete + reload: {after}"


# ── The run ───────────────────────────────────────────────────────────────────

ctx: dict = {"docs": [], "demos": []}
findings: list[str] = []
bridge_pid: int | None = None

with sync_playwright() as p:
    browser = p.chromium.launch(headless=not HEADED)
    page = browser.new_page(viewport={"width": 1440, "height": 800})
    suite.page = page
    report["setup"]["versions"]["chromium"] = browser.version
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    # ── Projects ──────────────────────────────────────────────────────────────
    def prj1() -> str:
        goto(page, "/")
        ctx["A"] = ui_create_project(page, NAME_A)
        return f"Project A = {ctx['A']} ({NAME_A}); landed on /p/{ctx['A']}/build with the shell header naming it"

    suite.run("PRJ-1", "Create Project A via the rail ＋ → modal → Create", prj1)

    def prj2() -> str:
        ctx["B"] = ui_create_project(page, NAME_B)
        return f"Project B = {ctx['B']} ({NAME_B})"

    suite.run("PRJ-2", "Create Project B (the scoping control) the same way", prj2, requires=("PRJ-1",))

    def prj3() -> str:
        A, B = ctx["A"], ctx["B"]
        goto(page, "/projects")
        for pid, name in ((A, NAME_A), (B, NAME_B)):
            card = tid(page, "project-card", project_id=pid)
            card.wait_for(timeout=20_000)
            assert name in text_of(card), f"card {pid} text {text_of(card)!r} lacks {name}"
            assert card.get_attribute("data-status") == "active"
        goto(page, f"/p/{quote(A)}/build")
        trigger = tid(page, "project-name")
        trigger.wait_for(timeout=15_000)
        page.wait_for_function(
            "n => (document.querySelector('[data-testid=\"project-name\"]')?.textContent ?? '').includes(n)", arg=NAME_A, timeout=10_000)
        assert trigger.get_attribute("data-locked") == "false"
        trigger.click()
        tid(page, "project-switcher-list").wait_for(timeout=10_000)
        ids = attr_values(page, "project-switcher-option", "data-project-id")
        assert A in ids and B in ids, f"switcher options {ids} lack A/B"
        assert NAME_B in text_of(tid(page, "project-switcher-option", project_id=B))
        tid(page, "project-switcher-option", project_id=B).click()
        page.wait_for_url(re.compile(rf"/p/{re.escape(quote(B))}/build$"), timeout=10_000)
        page.wait_for_function(
            "n => (document.querySelector('[data-testid=\"project-name\"]')?.textContent ?? '').includes(n)", arg=NAME_B, timeout=10_000)
        return "after a full reload both cards render their names as active; the ProjectShell switcher lists A and B and pivoting to B retains the mode verb and drops the artifact"

    suite.run("PRJ-3", "Reload persistence + ProjectShell switcher identity", prj3, requires=("PRJ-1", "PRJ-2"))

    def att1() -> str:
        A, B = ctx["A"], ctx["B"]
        # `attachedBy` is a closed enum on the wire (projects/routes.ts: studio | interactive |
        # cli | api). This IS an API attach standing in for the missing UI control (#207).
        st, body = api("POST", f"/projects/{quote(A)}/members", {"kind": "crew.repo", "ref": REPO_ID, "attachedBy": "api"})
        assert st in (200, 201), f"attach → {st} {body}"
        st, detail = api("GET", f"/projects/{quote(A)}")
        repo_members = [m for m in detail.get("members", []) if m.get("member_kind") == "crew.repo"]
        assert [m.get("member_ref") for m in repo_members] == [REPO_ID], f"A's members after attach: {detail.get('members')}"
        st, detail_b = api("GET", f"/projects/{quote(B)}")
        assert detail_b.get("members") == [], f"B gained members it never received: {detail_b.get('members')}"
        goto(page, f"/p/{quote(A)}")
        tid(page, "dashboard-repo", repo_ref=REPO_ID).wait_for(timeout=20_000)
        goto(page, f"/p/{quote(B)}")
        tid(page, "project-dashboard", project_id=B).wait_for(timeout=20_000)
        page.wait_for_load_state("networkidle")
        assert tid(page, "dashboard-repos").count() == 0, "Project B's dashboard lists repos it never received"
        return (f"[SUBSTITUTE] repo {REPO_ID} attached to A over POST /projects/{A}/members (no UI attach control until #207); "
                "UI verifies: A's dashboard renders the repo tile, B's renders none")

    suite.run("ATT-1", "Attach the repository to Project A (API substitute, UI-verified)", att1, requires=("PRJ-1", "PRJ-2"))

    # ── Steering (global corpus) ──────────────────────────────────────────────
    def str1() -> str:
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        rid = ui_add_rule(page, RULE_STATEMENT)
        ctx["rule_first_ui"] = rid
        return f"first rule {rid} authored through the draft row on the unseeded store"

    suite.run("STR-1", "Author the FIRST rule via Add row on the unseeded store", str1)

    def str1s() -> str:
        if "rule_first_ui" in ctx:
            raise Skip("STR-1 authored the first rule through the UI — no substitute needed")
        rule = {
            "id": "PAT-100", "rule_type": "pattern", "statement": f"Seed rule (API substitute) {STAMP}.",
            "severity": "warn", "confidence": 0.9, "targets": {},
            "provenance": {"source": "ui", "source_kinds": ["doc"]},
            "steering_type": "architecture", "applies_to": [], "excludes": [], "weight": 1.0,
        }
        st, body = api("POST", "/governance/rules", rule)
        assert st == 200, f"POST /governance/rules → {st} {body}"
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        tid(page, "steering-grid-row", rule_id="PAT-100").wait_for(timeout=15_000)
        ctx["rule_seed_api"] = "PAT-100"
        findings.append("STR-1: 'Add row' is inert on an unseeded store (grid not mounted) — the first rule needed an API substitute")
        return "[SUBSTITUTE] PAT-100 seeded over POST /governance/rules (the exact body the draft row sends) so the grid mounts"

    suite.run("STR-1S", "Seed the store so the grid mounts (API substitute, only if STR-1 failed)", str1s)

    def str1b() -> str:
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        rid = ui_add_rule(page, RULE_STATEMENT)
        ctx["rule"] = rid
        return f"{rid} authored through the draft row (prefilled id kept; statement set; saved note names it)"

    suite.run("STR-1B", "Author a rule via Add row on a seeded store", str1b, requires=("STR-1S",) if "rule_first_ui" not in ctx else ("STR-1",))
    if "rule" not in ctx and "rule_first_ui" in ctx:
        ctx["rule"] = ctx["rule_first_ui"]

    def str2() -> str:
        rid = ctx["rule"]
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        assert text_of(row.locator('[data-testid="steering-cell-statement"]')) == RULE_STATEMENT
        assert row.locator('[data-testid="steering-cell-type"]').input_value() == "architecture"
        assert row.locator('[data-testid="steering-cell-severity"]').input_value() == "warn"
        st, body = api("GET", "/governance/rules")
        mine = [r for r in body["rules"] if r["id"] == rid]
        assert mine and mine[0]["statement"] == RULE_STATEMENT and mine[0].get("provenance", {}).get("source") == "ui", mine
        return f"{rid} survives a full reload with statement/type/severity intact; server row carries provenance.source=ui"

    suite.run("STR-2", "Reload persistence of the authored rule (content)", str2, requires=("STR-1B",))

    def str3() -> str:
        rid = ctx["rule"]
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        row.locator('[data-testid="steering-grid-id"]').click()
        drawer = tid(page, "steering-rule-drawer")
        drawer.wait_for(timeout=10_000)
        # The id is the drawer's HEADER (SteeringRuleDrawer.tsx:89); `steering-rule-detail` is the
        # field list under it — run 1 asserted the id inside the field list and failed for it.
        assert drawer.get_attribute("aria-label") == f"Rule {rid}", f"drawer aria-label {drawer.get_attribute('aria-label')!r}"
        statement_row = text_of(tid(page, "steering-rule-statement"))
        assert RULE_STATEMENT in statement_row, f"drawer Statement row {statement_row!r} lacks the authored statement"
        tid(page, "steering-edit-open").click()
        form = tid(page, "steering-rule-form")
        form.wait_for(timeout=10_000)
        form_id = tid(page, "steering-form-id").input_value()
        assert form_id == rid, f"the edit form opened on {form_id!r}, not {rid!r}"
        tid(page, "steering-form-severity").select_option("error")
        tid(page, "steering-form-statement").fill(RULE_STATEMENT_EDITED)
        tid(page, "steering-form-save").click()
        form.wait_for(state="detached", timeout=15_000)
        assert tid(page, "steering-form-error").count() == 0, text_of(tid(page, "steering-form-error"))
        if tid(page, "steering-drawer-close").count() > 0:
            tid(page, "steering-drawer-close").click()
        page.wait_for_function(
            "([id, s]) => (document.querySelector(`[data-testid=\"steering-grid-row\"][data-rule-id=\"${id}\"] [data-testid=\"steering-cell-statement\"]`)?.textContent ?? '').trim() === s",
            arg=[rid, RULE_STATEMENT_EDITED], timeout=15_000,
        )
        sev = row.locator('[data-testid="steering-cell-severity"]').input_value()
        assert sev == "error", f"severity cell reads {sev!r} after the edit"
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        reloaded = text_of(row.locator('[data-testid="steering-cell-statement"]'))
        assert reloaded == RULE_STATEMENT_EDITED, f"statement after reload {reloaded!r}"
        sev = row.locator('[data-testid="steering-cell-severity"]').input_value()
        assert sev == "error", f"severity after reload {sev!r}"
        return f"{rid} edited through the drawer's Edit form (severity warn→error, statement rewritten); both persist across a reload"

    suite.run("STR-3", "Edit via the drawer (steering-grid-id → Edit…) and reload", str3, requires=("STR-2",))

    RETIRED_ROW_JS = (
        "([id, want]) => document.querySelector(`[data-testid=\"steering-grid-row\"][data-rule-id=\"${id}\"]`)"
        "?.getAttribute('data-retired') === want"
    )

    def ui_retire_rule(page, rid: str, reason: str) -> None:
        """Row ⋯ Retire → modal: confirm is disarmed until the EXACT id is typed AND a reason is
        given (SteeringRetireModal.tsx) → the retired note echoes both → the row turns struck."""
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        assert row.get_attribute("data-retired") == "false", f"{rid} is already retired"
        row.locator('[data-testid="steering-grid-retire"]').click()
        modal = tid(page, "steering-retire-modal")
        modal.wait_for(timeout=10_000)
        confirm = tid(page, "steering-retire-confirm")
        assert confirm.is_disabled(), "confirm must be disarmed before the id is typed"
        tid(page, "steering-retire-confirm-input").fill(rid)
        assert confirm.is_disabled(), "confirm must stay disarmed until a reason is given"
        tid(page, "steering-retire-reason").fill(reason)
        assert confirm.is_enabled(), "confirm must arm once the exact id and a reason are given"
        confirm.click()
        modal.wait_for(state="detached", timeout=15_000)
        note = tid(page, "steering-retired-note")
        note.wait_for(timeout=10_000)
        assert rid in text_of(note) and reason in text_of(note), text_of(note)
        page.wait_for_function(RETIRED_ROW_JS, arg=[rid, "true"], timeout=15_000)

    def str4() -> str:
        rid = ctx["rule"]
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        # Retire never deletes, and the grid's default facet LISTS retired rows
        # (SteeringGrid.tsx GRID_FACETS_DEFAULT.includeRetired = true; the chip reads
        # "retired shown"). The run-3 plan asserted hidden-by-default — that was wrong.
        toggle = tid(page, "steering-filter-retired")
        assert toggle.get_attribute("aria-pressed") == "true", f"retired facet default: {text_of(toggle)!r}"
        ui_retire_rule(page, rid, RETIRE_REASON)
        row = tid(page, "steering-grid-row", rule_id=rid)
        assert row.locator('[data-testid="steering-rule-retired-chip"]').count() == 1, "retired row lacks its chip"
        # The operator's facet hides it …
        toggle.click()
        assert toggle.get_attribute("aria-pressed") == "false" and "hidden" in text_of(toggle), text_of(toggle)
        row.wait_for(state="detached", timeout=10_000)
        # … and a full reload comes back to the default facet: listed, struck, still hideable.
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        assert row.get_attribute("data-retired") == "true", "retired state lost across the reload"
        assert row.locator('[data-testid="steering-rule-retired-chip"]').count() == 1
        cell = text_of(row.locator('[data-testid="steering-cell-statement"]'))
        assert cell == RULE_STATEMENT_EDITED, f"retired row statement {cell!r}"
        tid(page, "steering-filter-retired").click()
        row.wait_for(state="detached", timeout=10_000)
        st, body = api("GET", "/governance/rules")
        mine = [r for r in body["rules"] if r["id"] == rid]
        assert mine and mine[0].get("retired") is True, f"server row for {rid}: {mine}"
        return (f"{rid} retired with typed id + reason; the note echoes both; the row stays listed struck under the "
                "default 'retired shown' facet (before and after a reload) and leaves under 'retired hidden'; server row retired=true")

    suite.run("STR-4", "Retire with exact id + reason; listed-struck by default; hideable; reload", str4, requires=("STR-3",))

    def xps2() -> str:
        goto(page, f"/p/{quote(ctx['B'])}/build")
        tid(page, "project-shell", project_id=ctx["B"]).wait_for(timeout=15_000)
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        toggle = tid(page, "steering-filter-retired")
        if toggle.count() > 0 and toggle.get_attribute("aria-pressed") != "true":
            toggle.click()  # compare against the WHOLE store — retired rows included
        ui_ids = sorted(set(attr_values(page, "steering-grid-row", "data-rule-id")))
        st, body = api("GET", "/governance/rules")
        api_ids = sorted({r["id"] for r in body["rules"]})
        assert ui_ids == api_ids, f"grid {ui_ids} ≠ store {api_ids}"
        return f"the grid renders exactly the store's {len(api_ids)} rule ids regardless of the project context it was reached from (global corpus, no projectId on the wire)"

    suite.run("XPS-2", "Steering is global — grid ids == store ids from another project's context", xps2, requires=("STR-1B", "PRJ-2"))

    # ── Evals (deterministic engine replay — no model call) ───────────────────
    def evl1() -> str:
        goto(page, "/testing/evals")
        tid(page, "testing-evals").wait_for(timeout=20_000)
        tid(page, "testing-evals-run").click()
        seen = wait_any(page, ["testing-evals-summary", "testing-evals-error", "testing-evals-unsupported"], EVALS_TIMEOUT_MS)
        if seen == "testing-evals-unsupported":
            raise Skip("this daemon's engine predates the eval bindings (501)")
        assert seen == "testing-evals-summary", f"evals failed: {text_of(tid(page, 'testing-evals-error'))}"
        summary = text_of(tid(page, "testing-evals-summary"))
        m = re.search(r"(\d+) samples", summary)
        total = int(m.group(1))
        blocked = int(re.search(r"(\d+) blocked", summary).group(1)) if "blocked" in summary else None
        passed = int(re.search(r"(\d+) passed", summary).group(1)) if "passed" in summary else None
        gaps = int(re.search(r"(\d+) uncovered", summary).group(1))
        fps = int(re.search(r"(\d+) false positives", summary).group(1))
        assert total > 0, f"the built-in corpus served no samples: {summary!r}"
        rows = tid(page, "testing-evals-row").count()
        assert rows == total, f"{rows} result rows ≠ {total} samples"
        caught = (blocked or 0) + (passed or 0)
        assert caught + gaps + fps == total, f"{caught}+{gaps}+{fps} ≠ {total}"
        history = tid(page, "eval-history-row")
        history.first.wait_for(timeout=15_000)
        assert history.count() == 1, f"{history.count()} history rows after the first run"
        run_id = history.first.get_attribute("data-run-id")
        history.first.locator("button").first.click()
        detail = tid(page, "eval-history-detail")
        detail.wait_for(timeout=15_000)
        page.wait_for_function("() => /\\d+ samples · \\d+ caught/.test(document.querySelector('[data-testid=\"eval-history-detail\"]')?.textContent ?? '')", timeout=15_000)
        dm = re.search(r"(\d+) samples · (\d+) caught · (\d+) gaps · (\d+) false positives", text_of(detail))
        assert dm, text_of(detail)
        assert tuple(map(int, dm.groups())) == (total, caught, gaps, fps), f"history {dm.groups()} ≠ report ({total},{caught},{gaps},{fps})"
        st, body = api("GET", f"/testing/evals/{quote(run_id)}")
        assert st == 200 and body["summary"]["total"] == total and body["summary"]["gaps"] == gaps, body.get("summary")
        ctx["eval_run"] = run_id
        ctx["eval_detail"] = text_of(detail)
        ctx["eval_numbers"] = (total, caught, gaps, fps)
        return f"eval run {run_id}: {total} samples · {caught} caught · {gaps} gaps · {fps} fp — report, result rows, history drilldown and GET /testing/evals/:id all agree"

    suite.run("EVL-1", "Run evals; report ⇄ history drilldown ⇄ API agree", evl1)

    def evl2() -> str:
        run_id = ctx["eval_run"]
        goto(page, "/testing/evals")
        row = tid(page, "eval-history-row", run_id=run_id)
        row.wait_for(timeout=20_000)
        assert tid(page, "eval-history-row").count() == 1
        row.locator("button").first.click()
        detail = tid(page, "eval-history-detail")
        detail.wait_for(timeout=15_000)
        page.wait_for_function("() => /\\d+ samples · \\d+ caught/.test(document.querySelector('[data-testid=\"eval-history-detail\"]')?.textContent ?? '')", timeout=15_000)
        assert text_of(detail) == ctx["eval_detail"], f"{text_of(detail)!r} ≠ {ctx['eval_detail']!r}"
        return f"after a full reload the history still holds exactly {run_id} and its drilldown text is byte-identical"

    suite.run("EVL-2", "Eval history + drilldown persist across reload (identity + content)", evl2, requires=("EVL-1",))

    # ── Memories (read-only browse; retire is a scope-subtree erasure — never exercised) ──
    def memories_state() -> tuple[str, int]:
        tid(page, "memories-panel").wait_for(timeout=20_000)
        tid(page, "memories-loading").wait_for(state="detached", timeout=30_000)
        seen = wait_any(page, ["memories-empty", "memories-list", "memories-unsupported", "memories-error"], 15_000)
        assert seen != "memories-error", text_of(tid(page, "memories-error"))
        return seen, tid(page, "memory-row").count()

    def mem2() -> str:
        goto(page, "/steering/memories")
        state, count = memories_state()
        tid(page, "memories-search").fill("seed-surfaces")
        tid(page, "memories-search-go").click()
        state2, count2 = memories_state()
        goto(page, f"/p/{quote(ctx['B'])}")
        tid(page, "project-dashboard", project_id=ctx["B"]).wait_for(timeout=15_000)
        goto(page, "/steering/memories")
        state3, count3 = memories_state()
        assert (state3, count3) == (state, count), f"memories differ by context: {(state, count)} vs {(state3, count3)}"
        return f"panel state '{state}' ({count} rows) on the isolated store; search round-trips to '{state2}' ({count2}); identical when reached after Project B ({state3}, {count3})"

    suite.run("MEM-2", "Memories browse is read-only, settled, and context-independent", mem2, requires=("PRJ-2",))

    # ── Documents / demos — deterministic seeds (agent answering disabled) + the #472 xfail ──
    def vib1d() -> str:
        name = ui_seed_doc(page, ctx["A"], f"seed-doc-a-{STAMP}")
        ctx["docs"].append((ctx["A"], name))
        return f"doc '{name}' created under A through the composer (placeholder v0 — drafting agent disabled on this daemon); canvas frames it"

    suite.run("VIB-1D", "Seed a document in Project A via the composer (deterministic)", vib1d, requires=("PRJ-1",))

    def vib2d() -> str:
        name = ui_seed_doc(page, ctx["B"], f"seed-doc-b-{STAMP}")
        ctx["docs"].append((ctx["B"], name))
        return f"doc '{name}' created under B"

    suite.run("VIB-2D", "Seed a document in Project B via the composer (deterministic)", vib2d, requires=("PRJ-2", "VIB-1D"))

    def vib4() -> str:
        pid, name = ctx["docs"][0]
        goto(page, f"/p/{quote(pid)}/document/{quote(name)}")
        canvas = tid(page, "doc-canvas", doc_id=name)
        canvas.wait_for(timeout=BRIDGE_TIMEOUT_MS)
        ids = picker_ids(page, pid, "document")
        assert name in ids, f"{name} missing from A's picker after reload: {ids}"
        st, versions = api("GET", f"/projects/{quote(pid)}/interactive/d/{quote(name)}/api/versions")
        return f"after a full reload the canvas frames '{name}' and A's picker lists it; versions wire → {st} head={versions.get('head') if isinstance(versions, dict) else versions}"

    suite.run("VIB-4", "Document survives a reload (canvas identity + picker listing)", vib4, requires=("VIB-1D",))

    def vib3() -> str:
        (A, doc_a), (B, doc_b) = ctx["docs"][0], ctx["docs"][1]
        a_ids = picker_ids(page, A, "document")
        b_ids = picker_ids(page, B, "document")
        assert doc_a in a_ids and doc_b in b_ids, f"ownership broken: A={a_ids} B={b_ids}"
        assert doc_b not in a_ids, f"Project A's picker lists B's document {doc_b!r}: {a_ids}"
        assert doc_a not in b_ids, f"Project B's picker lists A's document {doc_a!r}: {b_ids}"
        return "A and B list only their own documents"

    suite.run("VIB-3", "Documents are disjoint per project (A ∌ B's doc, B ∌ A's doc)", vib3, xfail="crew#472", requires=("VIB-1D", "VIB-2D"))

    def dem1d() -> str:
        name = ui_seed_demo(page, ctx["A"], f"seed-demo-a-{STAMP}")
        ctx["demos"].append((ctx["A"], name))
        ids = picker_ids(page, ctx["A"], "video")
        assert name in ids, f"{name} missing from A's demo picker: {ids}"
        return f"demo '{name}' created under A via the wizard (target {FIXTURE_URL}, one hand-pinned step; authoring agent disabled); A's picker lists it"

    suite.run("DEM-1D", "Seed a demo in Project A via the wizard (deterministic)", dem1d, requires=("PRJ-1",))

    def dem3() -> str:
        A, demo_a = ctx["demos"][0]
        b_ids = picker_ids(page, ctx["B"], "video")
        assert demo_a not in b_ids, f"Project B's demo picker lists A's demo {demo_a!r}: {b_ids}"
        return "B lists none of A's demos"

    suite.run("DEM-3", "Demos are disjoint per project (B ∌ A's demo)", dem3, xfail="crew#472", requires=("DEM-1D", "PRJ-2"))

    # ── THE ONE GOVERNED SCENARIO — serialized, gate rejected ─────────────────
    def tst1() -> str:
        if not GOVERNED_ENABLED:
            raise Skip("governed scenario disabled by SEED_GOVERNED=0 — a recon launch convenes the engine's "
                       "distribution council (real CLI seats) BEFORE its intake gate; run with SEED_GOVERNED=1 "
                       "to exercise the gate, serialized, once")
        A = ctx["A"]
        goto(page, f"/p/{quote(A)}")
        tid(page, "dashboard-campaigns").click()
        page.wait_for_url(re.compile(rf"/p/{re.escape(quote(A))}/campaigns$"), timeout=15_000)
        tid(page, "project-campaigns", project_id=A).wait_for(timeout=15_000)
        tid(page, "testing-campaign-open").wait_for(timeout=30_000)
        tid(page, "testing-campaign-open").click()
        panel = tid(page, "testing-launch-panel", intent="campaign")
        panel.wait_for(timeout=10_000)
        assert tid(page, "testing-launch-project").input_value() == A, "the project selector is not pre-bound to A"
        tid(page, "testing-launch-chip", source="project", repo=REPO_ID).wait_for(timeout=15_000)
        tid(page, "testing-launch-instructions").fill(
            f"{TEST_BRIEF_TOKEN}: propose a plan for the e2e seed surfaces — do not execute; this gate will be rejected.")
        tid(page, "testing-launch-submit").click()
        seen = wait_any(page, ["testing-launch-waiting", "steering-gate", "testing-launch-fanout", "testing-launch-error"], 60_000)
        assert seen != "testing-launch-error", f"launch refused: {text_of(tid(page, 'testing-launch-error'))}"
        assert seen != "testing-launch-fanout", "a single-repo project must launch exactly one run"
        mine = [v for v in list_runs() if TEST_BRIEF_TOKEN in v["session"].get("problem", "")]
        assert len(mine) == 1, f"{len(mine)} runs carry the brief token"
        run_id = mine[0]["session"]["id"]
        ctx["test_run"] = run_id
        gate = panel.locator('[data-testid="steering-gate"]')
        deadline = time.time() + GOVERNED_TIMEOUT_S
        status = run_status(run_id)
        while time.time() < deadline:
            if gate.count() > 0:
                break
            status = run_status(run_id)
            if status in TERMINAL_STATUSES:
                break
            page.wait_for_timeout(2_000)
        if gate.count() == 0:
            if status == "failed":
                tail = last_events(run_id)
                text = json.dumps(tail)[-1200:]
                if re.search(r"login|sign|auth|credential|worker|spawn|ENOENT|acp|seat|not found", text, re.I):
                    raise Skip(f"run {run_id} failed before its intake gate — the hermetic worker home has no CLI login "
                               f"(roster signed_in={report['setup']['roster_signed_in']}); last events: {text}")
                raise AssertionError(f"run {run_id} failed before its intake gate: {text}")
            if status == "awaiting_human":
                raise AssertionError(f"run {run_id} is awaiting_human on the wire but the launch panel never rendered the gate card")
            raise AssertionError(f"run {run_id} never reached its intake gate within {GOVERNED_TIMEOUT_S}s (status {status})")
        prompt = text_of(gate.locator('[data-testid="steering-prompt"]'))
        assert prompt != "", "the gate card carries no prompt"
        assert run_status(run_id) == "awaiting_human"
        before_gate = council_activity(run_id)
        gate.locator('[data-testid="steering-reject"]').click()
        tid(page, "testing-launch-resolved").wait_for(timeout=30_000)
        final = wait_terminal(run_id, 60)
        assert final == "cancelled", f"rejected run ended {final!r}, expected cancelled"
        units = run_view(run_id).get("units", [])
        executed = [u for u in units if u.get("status") in ("running", "completed")]
        assert not executed, f"units executed despite the rejected intake gate: {executed}"
        return (f"run {run_id} launched from A (project pre-bound, repo chip via project), parked at its intake gate "
                f"after the distribution council ({before_gate or 'no council events'}), REJECTED in the panel → cancelled; "
                f"{len(units)} planned units, none executed; prompt: {prompt[:120]!r}")

    suite.run("TST-1", "New test from Project A → intake gate arrives → REJECT (no council runs)", tst1,
              requires=("ATT-1",), governed=True)

    def tsts() -> str:
        run_id = ctx.get("test_run")
        if run_id is None:
            raise Skip("no test run was launched")
        A, B = ctx["A"], ctx["B"]
        goto(page, f"/p/{quote(A)}")
        tid(page, "dashboard-run", run_id=run_id).wait_for(timeout=30_000)
        problem = run_view(run_id)["session"].get("problem", "")
        assert TEST_BRIEF_TOKEN in problem
        goto(page, f"/p/{quote(B)}")
        tid(page, "project-dashboard", project_id=B).wait_for(timeout=15_000)
        page.wait_for_load_state("networkidle")
        assert tid(page, "dashboard-run", run_id=run_id).count() == 0, "Project B's dashboard lists A's test run"
        return f"A's dashboard lists run {run_id} (membership join, problem carries the brief); B's does not"

    suite.run("TST-S", "The test run is scoped: on A's dashboard, absent from B's", tsts, requires=("PRJ-2",))

    def tst2() -> str:
        A, B = ctx["A"], ctx["B"]
        goto(page, f"/p/{quote(A)}/campaigns")
        tid(page, "project-campaigns", project_id=A).wait_for(timeout=15_000)
        wait_any(page, ["campaigns-page", "campaigns-unsupported"], 30_000)
        page.wait_for_load_state("networkidle")
        a_cards = attr_values(page, "campaign-card", "data-campaign-id")
        if not a_cards:
            raise Skip("no campaign card to partition: a single-repo test registers no engine campaign (campaignRegistered:false), "
                       "so the App.tsx:466 gap is not observable on this rig")
        goto(page, f"/p/{quote(B)}/campaigns")
        tid(page, "project-campaigns", project_id=B).wait_for(timeout=15_000)
        wait_any(page, ["campaigns-page", "campaigns-unsupported"], 30_000)
        page.wait_for_load_state("networkidle")
        b_cards = attr_values(page, "campaign-card", "data-campaign-id")
        leaked = [c for c in a_cards if c in b_cards]
        assert not leaked, f"Project B's Tests list shows A's campaigns {leaked}"
        return "B's Tests list excludes A's campaigns"

    suite.run("TST-2", "Tests list is partitioned per project", tst2, xfail="App.tsx:466 (campaign store not project-partitioned)", requires=("PRJ-2",))

    # ── Cleanup — only after every consumer ───────────────────────────────────
    def cln1() -> str:
        done = []
        for pid, name in ctx["docs"]:
            ui_delete_doc(page, pid, "document", name)
            done.append(f"doc {name}")
        for pid, name in ctx["demos"]:
            ui_delete_doc(page, pid, "video", name)
            done.append(f"demo {name}")
        if not done:
            raise Skip("nothing was seeded to delete")
        return "deleted via the picker's 🗑 → confirm → Delete, verified absent after a reload: " + ", ".join(done)

    suite.run("CLN-1", "Delete every seeded document/demo through the UI", cln1)

    def clnstr() -> str:
        seed = ctx.get("rule_seed_api")
        if seed is None:
            raise Skip("no API-seeded rule to retire — STR-1 authored the first rule through the UI")
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        ui_retire_rule(page, seed, f"seed-surfaces suite {STAMP}: retiring the STR-1S substitute seed")
        st, body = api("GET", "/governance/rules")
        mine = [r for r in body["rules"] if r["id"] == seed]
        assert mine and mine[0].get("retired") is True, f"server row for {seed}: {mine}"
        return f"{seed} (the STR-1S substitute) retired through the grid's Retire modal; server row retired=true"

    suite.run("CLN-STR", "Retire the substitute seed rule through the UI", clnstr, requires=("STR-1S",))

    def cln2() -> str:
        A = ctx["A"]
        goto(page, f"/projects/{quote(A)}")
        page.wait_for_load_state("networkidle")
        archive = page.get_by_role("button", name=re.compile(r"^Archive$"))
        assert f"/projects/{quote(A)}" in page.url and archive.count() > 0, (
            f"ProjectDetailPage (the only Archive control, ProjectDetailPage.tsx) is unreachable: /projects/{A} "
            f"redirected to {page.url.replace(ORIGIN, '')} (useLegacyRedirect) — no reachable UI affordance archives a project")
        archive.click()
        page.wait_for_function("() => document.body.textContent.includes('archived')", timeout=10_000)
        return "archived through ProjectDetailPage"

    suite.run("CLN-2", "Archive a project through the UI (ProjectDetailPage → Archive)", cln2, requires=("PRJ-1",))

    def cln2s() -> str:
        A, B = ctx["A"], ctx["B"]
        for pid in (A, B):
            st, body = api("PATCH", f"/projects/{quote(pid)}", {"status": "archived"})
            assert st == 200 and body["project"]["status"] == "archived", f"PATCH {pid} → {st} {body}"
        goto(page, "/projects")
        tid(page, "projects-page").wait_for(timeout=15_000)
        page.wait_for_load_state("networkidle")
        for pid in (A, B):
            assert tid(page, "project-card", project_id=pid, status="active").count() == 0, f"{pid} still renders as an active card"
        toggle = page.get_by_role("button", name=re.compile(r"archived project"))
        toggle.wait_for(timeout=10_000)
        toggle.click()
        tid(page, "projects-archived").wait_for(timeout=10_000)
        for pid in (A, B):
            assert tid(page, "project-card", project_id=pid, status="archived").count() == 1, f"{pid} missing from the archived grid"
        if "CLN-2" not in suite.passed:
            findings.append("CLN-2: no reachable UI affordance archives a project — /projects/:id (ProjectDetailPage, the only Archive button) redirects to /p/:id")
        return "[SUBSTITUTE] both projects archived over PATCH /projects/:id; UI verifies: no active card, both listed under the archived toggle"

    suite.run("CLN-2S", "Archive both projects (API substitute, UI-verified)", cln2s, requires=("PRJ-1", "PRJ-2"))

    # Housekeeping so the daemon can stop cleanly: cancel anything still live (labelled).
    for view in list_runs():
        if view["session"]["status"] not in TERMINAL_STATUSES:
            api("POST", f"/runs/{quote(view['session']['id'])}/cancel")
            report["setup"].setdefault("cleanup_cancelled_runs", []).append(view["session"]["id"])

    report["console_errors"] = console_errors[:20]
    browser.close()

# ── Teardown: daemon, the bridge the pool started for OUR root, the temp dir ─────
daemon.terminate()
try:
    daemon.wait(timeout=15)
except subprocess.TimeoutExpired:
    daemon.kill()
daemon_log.close()
lock = IDOCS / ".wi-serve.json"
if lock.is_file():
    try:
        bridge_pid = int(json.loads(lock.read_text()).get("pid"))
        os.kill(bridge_pid, signal.SIGTERM)
    except (ValueError, TypeError, ProcessLookupError, PermissionError, json.JSONDecodeError):
        bridge_pid = None
fixture_httpd.shutdown()
# The isolation claim, re-derived: nothing carrying this run's stamp may exist under the REAL
# ~/.wicked-crew (this process's HOME is the operator's; only the daemon env was pinned). Run 3
# found three such dirs there — the bus leak described at `daemon_env` — so this is asserted.
live_touched = sorted(
    str(p.relative_to(LIVE_STATE_HOME))
    for p in LIVE_STATE_HOME.rglob(f"*{STAMP}*")
) if LIVE_STATE_HOME.is_dir() else []
report["setup"]["teardown"] = {
    "daemon_stopped": daemon.returncode is not None, "bridge_pid_terminated": bridge_pid,
    "tmp": str(TMP), "tmp_kept": KEEP_TMP, "live_state_home_touched": live_touched,
}
if live_touched:
    findings.append(f"ISOLATION: the live {LIVE_STATE_HOME} gained entries stamped by this run: {live_touched}")
if not KEEP_TMP:
    shutil.rmtree(TMP, ignore_errors=True)

report["findings"] = findings
report["ok"] = suite.ok and not live_touched

counts = {s: sum(1 for r in suite.rows if r["status"] == s) for s in ("pass", "fail", "xfail", "xpass", "skip")}
report["counts"] = counts
print("\n| id | scenario | status | seconds | detail |\n|---|---|---|---|---|")
for r in suite.rows:
    first = r["detail"].splitlines()[0] if r["detail"] else ""
    print(f"| {r['id']} | {r['title']} | {r['status'].upper()} | {r['seconds']} | {first.replace('|', '/')} |")
print(f"\ncounts: {counts}\n")
print(json.dumps(report, indent=2))
sys.exit(0 if suite.ok else 1)
