#!/usr/bin/env python3
"""
seed_surfaces_test.py — the SEED SUITE: seed and exercise the studio's surfaces through the
UI against a DISPOSABLE, REAL-MODE wicked-crew daemon, then assert project scoping and reload
persistence with content / identity / lineage assertions — never presence-only checks.

Companion plan: docs/testing/seed-surfaces-plan.md (the revised plan this suite executes; §4b is
the binding coverage matrix).

What this rig is, and what it is not:

  - The daemon is spawned HERE (an installed `wicked-crew` CLI, a temp state dir, a free port) —
    WITHOUT `--stub`: the seeds are real rows in a real engine store.
  - HERMETIC ENVIRONMENT. The daemon does NOT inherit this process's environment or HOME. It gets
    a minimal env built from scratch (`Rig.build_env`): `PATH` (pass-through — node, npx, git,
    wicked-estate and the CLI seats resolve from it; documented), a SCRATCH `HOME`, a scratch
    `TMPDIR`, and every `WICKED_*` / npm knob pointed INTO the temp dir: `--db` (state home),
    `WICKED_BUS_DATA_DIR` (the bus the daemon AND the bridge it spawns share), `WICKED_HOME`
    (memory store), `WICKED_WORKER_HOME`, `WICKED_CREW_SYSTEM_SETTINGS`, `WICKED_INTERACTIVE_ROOT`,
    `WICKED_WORKFLOWS_DIR`, `WICKED_STEERING_INBOX_DIR`, the estate / apps-core dead-letter spools,
    `npm_config_cache` (the bridge is `npx wicked-interactive@^0.8.1 serve`; the operator's cached
    `_npx` install is CLONED into the scratch cache so no network is needed), and
    `WICKED_CREW_API=<bound origin>` (the bridge resolves the crew daemon from it and defaults to
    :7701 — crew#476). Every child of the daemon (bridge, workers, estate-mcp) inherits this env.
    Before anything starts, every write target is resolved and asserted NOT to be under the
    operator's real home or `~/.wicked-crew` (`setup.write_targets`).
  - THE BRIDGE IS PINNED TO AN EXACT VERSION (`BRIDGE_PINNED_VERSION`) — BY BYTES. Setup resolves
    the offline `_npx` cache for the spec and VALIDATES its lock metadata (`resolve_bridge_pin`: the
    installed `package.json`, the root `package-lock.json` entry AND npm's hidden lockfile all name
    the pin; the integrity is a well-formed `sha512-<base64>` and identical in both lockfiles),
    clones it into the scratch npm cache, then VERIFIES THE CLONE (`verify_bridge_clone`: an lstat
    walk refusing any symlink that escapes the clone; every file sha256-equal to the source install
    with nothing missing or extra; and — when the operator's cacache still holds the tarball blob
    for that integrity — the blob's sha512 == integrity and every `package/` member byte-equal to
    the clone; otherwise the tie is npm's hidden lockfile, which records the sha512 npm verified
    when it extracted this very tree). `setup.bridge.clone_verification.bytes_verified_by` states
    which route ran. No cache, a version drift, a lock naming another version, a malformed or
    disagreeing integrity, an escaping symlink or a byte mismatch is a SETUP FAILURE — the bridge
    never falls back to the registry (`npm_config_offline=true` on the daemon's env makes a cache
    miss loud). At teardown the identified bridge process must have run FROM the scratch clone
    (`bridge_not_from_pinned_cache` otherwise). Why the pin matters: 0.8.1 predates `DELETE
    /api/docs/:doc`, which is exactly the studio#213 expected gap (CLN-1, ISO-D/ISO-DD) — a
    different bridge flips those rows.
  - ISOLATION IS RE-DERIVED, NOT ASSERTED. At teardown the suite (a) scans the real `~/.wicked-crew`
    for entries stamped by this run, (b) byte-scans every operator-global wicked store
    (`~/.wicked-crew`, `~/.something-wicked`, `~/.wicked`, `~/wicked-interactive`, `~/.config/wicked-*`)
    modified DURING the run for this run's identifiers (stamp, temp-dir name, project/repo/run ids),
    and (c) diffs the live `:7701` daemon's run ids before/after (read-only GETs). Any hit is
    `live_touched` and FAILS THE PROCESS regardless of the scenario table. The scan's
    `files_modified_during_run` count and `modified_sample` are the AMBIENT writes it observed in
    the window — the live daemon's own log + WAL files, the operator's own tooling — which it
    cannot attribute to a writer: context, never a verdict input (the output says so in
    `attribution`; the committed report placeholders the operator-specific segments of those paths
    — `wicked-<project>`, `<uuid>`, `<proj>`). What the daemon wrote into the scratch HOME is listed
    as the `HOME-WRITES` finding — those are the writes that would have landed in the operator's
    home without the scratch.
  - TEARDOWN ON EVERY EXIT PATH. The daemon runs in its own process group; Chromium is launched
    inside the same try/finally that owns it. On any exception or interruption: live runs on the
    disposable daemon are cancelled (responses verified, terminal state polled), the browser is
    closed, the group is SIGTERMed → polled → SIGKILLed, the detached bridge is found by IDENTITY
    (its command line names `wicked-interactive` AND our unique docs root, started after our daemon)
    — never by trusting a daemon-written pid blindly (symlinked `.wi-serve.json` refused, positive
    integer pid required, lock pid cross-checked against the identified processes) — and the temp
    dir is removed.
  - Interactive AGENT answering is disabled on the daemon (`--no-interactive-{draft,edit,chat,
    demo}-events`): a document or demo created through the UI is a real doc in the real
    interactive registry (placeholder v0), but no drafting/authoring agent is launched for it.
  - Exactly ONE governed scenario runs, serialized: TST-1 launches a project-scoped "New test"
    from Project A's dashboard, waits for the INTAKE GATE, asserts it arrives in the launch
    panel, and REJECTS it. The oracle reads the run's EVENT LOG: no `unitDispatched` /
    `unitExecuting` / `unitOutputDelta` / `unitOutputCaptured` / `unitDone` / `acpSessionStarted`
    anywhere, a `runCancelled` after the `awaitingHuman`, every planned unit still un-executed
    (`pending|distributed|rejected`), and a non-empty units array.
  - CAMPAIGN ISOLATION (TST-2) IS EXERCISED WITH REAL FIXTURE DATA, without a governed run. The
    only daemon writer for a campaign is `POST /campaigns` → `adapter.launchCampaign` (the engine
    LAUNCHES: every node dispatches a run — governed). So the suite writes the campaign record the
    way the engine itself does (`wicked_core::campaign::persist` → `put_node` → the estate `nodes`
    row: kind `{"other":"campaign"}`, `metadata` = the serialized `Campaign`, symbol
    `wicked-apps synthetic campaign/<id>:` interned in `symbols`) straight into the scratch
    `core.db`, mirroring the row layout of the `project` node the daemon just wrote — status
    `cancelled`, one node whose `run_spec.repo_ref` is Project A's repo. `campaign_list` opens the
    store read-only per call (core-ts `campaign_list` → `open_store_ro` + `find_symbols`), so the
    seed is visible on `GET /campaigns` with no restart. TST-2 is NEVER `blocked`: a fixture write
    that raises (`campaign-seed-write-failed`), a wire that is not 200 + a `campaigns` list (a 500
    carrying `{"campaigns": []}` included), a transport error, or a 200 list without the seed
    (`campaign-seed-missing`) are FAILURES with their cause — validated in that order, HTTP first;
    a listed seed makes the partition assertion real: A renders its card (ownership, plain) and B
    must not (the ONE expected gap, xfail studio#216). `campaign_isolation_scenario` is the body
    the suite runs AND the self-tests drive.
  - RUN MANAGEMENT IS COVERED OVER TST-1's TERMINAL RUN, no second governed launch: RUN-DET (the
    detail after a full reload: cancelled status, the rejected gate narrated before `Run cancelled`,
    nothing actionable, the raw wire view == `GET /runs/:id/events`), RUN-ARC (archive — a
    `[SUBSTITUTE]` over `POST /runs/:id/archive`, because the studio mounts NO archive control:
    WorkPage's only `archiveRun` call is Unarchive — then the UI proves it left A's dashboard and
    /work's active list and sits under the Archived toggle, on two full loads), RUN-UNARC (the
    mounted Unarchive control restores it; wire + reload agree).
  - Steps the UI cannot yet perform are performed over the daemon API and LABELLED
    `[SUBSTITUTE]` in the report (certify the journey, not the proxy). Memories and proposals
    have NO UI author path (agents are the only producer), so their seeds use a SUBSTITUTE
    PRODUCER: the very `wicked-estate-mcp` binary crew itself spawns for `/memory*` and
    `/proposals*` (`core/estate-mcp-client.js`), run with the rig's hermetic env and
    `WICKED_MEMORY_DB` pinned INTO the temp dir (asserted before every call) — then every
    management step (retire, approve, reject) runs through the UI and is verified on reload.
  - Known product gaps are UNMET REQUIREMENTS with an issue marker. `expect_gap(...)` marks the
    ONE assertion tied to the issue; every other assertion in an xfail scenario fails normally.
    An xfail that PASSES is `xpass` and fails the suite (stale marker). A scenario the rig cannot
    make observable is `blocked` — explicit, with the reason and issue — never a silent skip.
  - Skips are restricted to ESTABLISHED environmental causes: a bridge error is a skip only when
    the daemon itself reports `bridge_unavailable` (503); an unsupported eval/corpus surface only
    when the route answers 501. The gate journey (TST-1) can NEVER skip: a pre-gate failure is a
    FAIL carrying the captured cause (last events, roster snapshot); `SEED_GOVERNED=0` is a FAIL
    too (certification requires the rejection proven from the run's events).
  - DEM-REC is `blocked` ONLY for a POSITIVELY IDENTIFIED prerequisite (`classify_recorder_answer`
    over `RECORDER_PREREQS`): the record request acknowledged 2xx AND the bridge's whole answer IS
    `Recording failed: no demo.spec.mjs authored yet …` or the recorder-browser-not-installed
    message ("Playwright is not installed — run npx playwright install …", or Playwright's own
    "browserType.launch: Executable doesn't exist at …"), anchored at the start. `browserType.launch`
    alone is NOT a prerequisite: a launch timeout, a crashed/closed browser, `spawn EACCES`, any
    other recorder error, an HTTP ≥ 400 ack, a missing ack, or no answer within the budget is a FAIL.
  - TEARDOWN AFFECTS THE VERDICT (`teardown_failures`): a failed cancellation, `daemon_stopped=
    false`, a bridge pid surviving SIGKILL, an unverified bridge identity, a live lock pid nobody
    identified (`bridge_unidentified_alive`), a failed `ps` (`bridge_enumeration_failed` — nothing
    beyond the owned daemon group is signalled), a bridge that did not run from the pinned clone, a
    malformed advisory lock pid (`bridge_lock_pid_invalid` — the lock is ignored, the identified
    processes are still stopped), a browser that failed to close, a failed temp-dir removal, an
    isolation scan that could not run (or could not ENUMERATE a directory / read a file:
    `live_scan_error` with path + errno), or a live `:7701` observation that was established at
    baseline and LOST at the final snapshot (`live_observation_lost` — the run-id diff is unproven)
    each make `report.ok=false`. Every teardown step runs in its own try/except
    (`run_teardown_steps`): a failure in one never prevents the next, and every failure lands in
    `findings` AND `setup.teardown.failures[]`.
  - BUILD IDENTITY IS BYTES, not a version label: the served `index.html` and every referenced
    asset are hashed and compared against THIS worktree's `dist/` build (`npm run build`); a
    mismatch or a missing asset is a setup failure.

Prereqs: an installed `wicked-crew` (0.7.x; `CREW_CLI=<path to dist/cli/index.js>` overrides),
`wicked-estate-mcp` on PATH (the substitute producer — the same binary crew spawns), a `dist/`
build of this checkout (`npm run build`), Python Playwright (`pip install playwright &&
playwright install chromium`), `git`.

Env knobs: CREW_CLI, SEED_GOVERNED_TIMEOUT_S (default 600), SEED_ONBOARD_TIMEOUT_S (default
240), SEED_GOVERNED=0 (disables the governed scenario — TST-1 then FAILS, by design),
SEED_KEEP_TMP=1, SEED_HEADED=1. `--report-out <path>` writes the JSON report to a file as well as
stdout, SCRUBBED (`scrub_report_text`): the operator's home → `~`, this checkout's root → `<repo>`
(screenshot paths repo-relative), the per-user temp root → `$TMPDIR` — exact strings in both
`/private` spellings and dashed forms, plus any `/var/folders/<x>/<y>` prefix by shape (truncated
included); the isolation scan's ambient `modified_sample` paths get stable placeholders for their
operator-specific segments (`scrub_operator_path`: `wicked-<8 hex>` → `wicked-<project>`, UUIDs →
`<uuid>`, `proj_<digits>` → `<proj>`) and the scan carries its `attribution` note. `--rescrub-report
<path>` re-applies the current scrub to an existing report offline — a deterministic re-derivation
(text scrub, then the JSON-aware pass, re-serialized as `--report-out` writes); a second pass is a no-op;
its residue guard (`scrub_residue`) fails closed — raises, writes nothing — if any spelling the scrub masks
survives (plain, `/private`-prefixed or dashed) or the degraded `/private~` appears.

`python3 e2e/seed_surfaces_test.py --self-test` runs the in-process checks of the harness's own
safety plumbing (exit semantics, xfail hygiene, pid identity, gate oracle, fail-closed teardown,
isolation-scan errors incl. directory enumeration, the ACTUAL TST-2 scenario function under the
codex probes, recorder classification incl. crash/timeout/EACCES, bridge-stop planning, the real
`stop_bridge` with a malformed lock pid, teardown continuity, bridge pin metadata + clone byte
verification + escaping symlinks, the real `scan_operator_state` losing the live observation,
build-identity compare, per-target cleanup rows, persistence content oracle, the report scrub) —
no daemon.

Prints a per-scenario table and a JSON report to stdout. Exit 0 ONLY when `report.ok`: no
scenario is `fail`/`xpass`, nothing was contaminated, setup did not fail, nothing aborted, and
teardown recorded no failure. Screenshots of non-passing scenarios land in e2e/shots/seed-surfaces/.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import shutil
import signal
import socket
import sqlite3
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
from typing import Callable, Iterator
from urllib.parse import quote, unquote

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "e2e" / "shots" / "seed-surfaces"
FIXTURES = REPO / "e2e" / "fixtures"
PLAN = "docs/testing/seed-surfaces-plan.md"

LIVE_DAEMON_PORT = 7701
LIVE_ORIGIN = f"http://127.0.0.1:{LIVE_DAEMON_PORT}"
REAL_HOME = Path(os.environ.get("HOME") or Path.home()).resolve()
LIVE_STATE_HOME = REAL_HOME / ".wicked-crew"
# Every operator-global store a wicked-* process is known to write (crew state home, wicked-bus +
# wicked-apps-core + wicked-estate spools under .something-wicked, the memory store, interactive's
# default docs root + instance registry, core/crew config). Scanned at teardown for this run's marks.
OPERATOR_STATE_ROOTS = (
    REAL_HOME / ".wicked-crew",
    REAL_HOME / ".something-wicked",
    REAL_HOME / ".wicked",
    REAL_HOME / ".wicked-estate",  # graph.db + repo-graphs/<repo>/estate.db (run 5 caught the daemon writing here under the scratch HOME)
    REAL_HOME / "wicked-interactive",
    REAL_HOME / ".wicked-interactive",
    REAL_HOME / ".wicked-worker",
    REAL_HOME / ".config" / "wicked-core",
    REAL_HOME / ".config" / "wicked-crew",
)

STARTUP_TIMEOUT_S = 90
GOVERNED_TIMEOUT_S = int(os.environ.get("SEED_GOVERNED_TIMEOUT_S", "600"))
ONBOARD_TIMEOUT_S = int(os.environ.get("SEED_ONBOARD_TIMEOUT_S", "240"))
# A cold interactive bridge is `npx wicked-interactive serve` — the pool's own start budget is 60 s.
BRIDGE_TIMEOUT_MS = 120_000
EVALS_TIMEOUT_MS = 180_000
KEEP_TMP = os.environ.get("SEED_KEEP_TMP") == "1"
HEADED = os.environ.get("SEED_HEADED") == "1"
GOVERNED_ENABLED = os.environ.get("SEED_GOVERNED", "1") != "0"
# crew 0.7.25 `bridge-pool.ts INTERACTIVE_SPEC` — the exact spec npx resolves, and therefore the
# `_npx/<hash>` cache key we clone into the scratch npm cache.
INTERACTIVE_SPEC = "wicked-interactive@^0.8.1"
# The EXACT bridge this revision is certified against. The offline cache must hold precisely this
# version (setup fails otherwise): 0.8.1 has no `DELETE /api/docs/:doc`, which is the studio#213
# expected gap the delete rows (CLN-1*, ISO-D, ISO-DD) assert — a newer bridge flips them to xpass.
BRIDGE_PINNED_VERSION = "0.8.1"
# `ps` is parsed (`lstart` → strptime with English month/day names); it must run under the C locale
# so a non-English operator locale cannot turn every start time into "unverified".
PS_ENV = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "LC_ALL": "C", "LANG": "C"}
# DEM-REC: the ONLY recorder answers that excuse execution — the POSITIVELY IDENTIFIED prerequisites
# the pinned bridge itself raises (`wicked-interactive` 0.8.1 `src/service/handlers.js:104` posts
# `Recording failed: ${e.message}`; `src/service/demo.js:160` throws the missing-spec message and
# `:168` the not-installed one; `preflight.js:85` names Playwright's own missing-browser error as the
# second install gate). Each pattern is ANCHORED at the start of the answer and names the whole
# message — `browserType.launch` alone is NOT a prerequisite: a launch timeout, a crashed or closed
# browser, `spawn EACCES` and every other recorder error are FAILURES.
RECORDER_PREREQS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("no demo.spec.mjs authored yet",
     re.compile(r"^\s*Recording failed: no demo\.spec\.mjs authored yet(?: — the agent must write the spec before recording)?\s*\.?\s*$")),
    ("recorder browser not installed",
     re.compile(r"^\s*Recording failed: Playwright is not installed — run `npx playwright install` \(the install gate should have caught this\)\s*$")),
    ("recorder browser not installed",
     re.compile(r"^\s*Recording failed: browserType\.launch: Executable doesn't exist at \S+")),
)

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
# wicked-core domain.rs `UnitStatus`: pending → distributed → done | rejected. Only `done` means a
# worker executed the unit; `distributed` is the planning council's assignment.
UNIT_STATUSES_UNEXECUTED = {"pending", "distributed", "rejected"}
# wicked-core event.rs — every event that can only exist once a worker was dispatched for a unit.
EXECUTION_EVENT_TYPES = {"unitDispatched", "unitExecuting", "unitOutputDelta", "unitOutputCaptured", "unitDone", "acpSessionStarted"}

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
# STR-IMP: the .json rule batch the assist dock imports directly (two rules, ids clear of the
# draft row's max+1 prefill), and STR-INL's inline-cell rewrite of the first.
IMPORT_IDS = ("PAT-150", "PAT-151")
IMPORT_STATEMENTS = {
    "PAT-150": f"Seed-surfaces import {STAMP} A: every imported rule names the batch that carried it.",
    "PAT-151": f"Seed-surfaces import {STAMP} B: a rule batch is applied per entry, never all-or-nothing.",
}
INLINE_STATEMENT = f"Seed-surfaces import {STAMP} A (inline edit): the statement cell commits on Enter."
# EVL-3: the eval corpus imported through the UI — the store scopes it as `evals:<name>`.
CORPUS_NAME = f"seed-surfaces-{STAMP}"
CORPUS_SCOPE = f"evals:{CORPUS_NAME}"
# MEM-S/MEM-R: two EXCLUSIVE scopes (estate scopes are slash-separated kind:id segments) so the
# subtree retire of one is provably narrower than the store.
MEMORY_SCOPE_ROOT = f"suite:seed-surfaces-{STAMP}"
MEMORY_SCOPE_KEEP = f"{MEMORY_SCOPE_ROOT}/case:keep"
MEMORY_SCOPE_RETIRE = f"{MEMORY_SCOPE_ROOT}/case:retire"
MEMORY_CONTENT_KEEP = f"seed-surfaces memory {STAMP} KEEP: the sibling scope must survive a subtree retire."
MEMORY_CONTENT_RETIRE = f"seed-surfaces memory {STAMP} RETIRE: this scope is erased through the UI."
# PRP-S/PRP-A/PRP-R: two memory proposals, one approved and one rejected through the dashboard inbox.
PROPOSAL_CONTENT_APPROVE = f"seed-surfaces-proposal-{STAMP} APPROVE: approving promotes this line into the memory store."
PROPOSAL_CONTENT_REJECT = f"seed-surfaces-proposal-{STAMP} REJECT: rejecting writes nothing to the memory store."
SUITE_FACET = {"suite": f"seed-surfaces-{STAMP}"}
# FBK-1: the exact text a point-and-comment "Change text" batch writes into A's document (a
# deterministic `content-edit` the bridge applies itself — no agent).
FEEDBACK_TEXT = f"seed-surfaces feedback {STAMP}: this block was rewritten through point-and-comment."
# TST-2: the campaign fixture written in the engine's own row format (see `Rig.seed_campaign_record`).
CAMPAIGN_ID = f"seed-campaign-{STAMP}"
CAMPAIGN_NAME = f"Seed-surfaces campaign {STAMP} (Project A's repo)"

ORIGIN = ""  # the disposable daemon's origin — set by Rig
API = ""


# ── Report plumbing ───────────────────────────────────────────────────────────


class Skip(Exception):
    """A scenario that cannot be exercised on this rig for an ESTABLISHED environmental cause —
    recorded with its reason, never a pass."""


class Blocked(Exception):
    """A scenario the rig cannot make observable within its budget — recorded explicitly with the
    reason and the issue it waits on, never a silent skip."""


class ExpectedGap(AssertionError):
    """The ONE assertion an xfail scenario ties to its issue. Any other AssertionError in an xfail
    scenario is an unrelated regression and fails normally."""


class SetupFailure(Exception):
    def __init__(self, step: str, why: str) -> None:
        super().__init__(f"{step}: {why}")
        self.step, self.why = step, why


def expect_gap(condition: bool, issue: str, message: str) -> None:
    """Assert the CORRECT behaviour; when it does not hold, raise the expected gap named by `issue`."""
    if not condition:
        raise ExpectedGap(f"{issue}: {message}")


class Suite:
    STATUSES = ("pass", "fail", "xfail", "xpass", "skip", "blocked")

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
        no_skip: bool = False,
    ) -> None:
        """`no_skip`: the scenario can never be `skip` — a missing prerequisite or a `Skip` raised
        inside it is recorded as `fail` (the gate journey TST-1: certification needs its verdict)."""
        t0 = time.time()
        missing = [r for r in requires if r not in self.passed]
        if missing:
            status, detail = "skip", f"prerequisite {', '.join(missing)} did not pass"
            if no_skip:
                status, detail = "fail", f"{detail} — and this scenario cannot be skipped: certification requires its verdict"
        else:
            try:
                out = fn() or ""
                if xfail is None:
                    status, detail = "pass", out
                else:
                    status = "xpass"
                    detail = f"UNEXPECTED PASS — the gap tracked by {xfail} appears closed; remove the marker. {out}"
            except Skip as e:
                if no_skip:
                    status, detail = "fail", f"skip is not available to this scenario (certification requires its verdict): {e}"
                else:
                    status, detail = "skip", str(e)
            except Blocked as e:
                status, detail = "blocked", str(e)
            except ExpectedGap as e:
                if xfail is None:
                    status, detail = "fail", f"expected-gap assertion fired in a scenario with NO xfail marker: {e}"
                else:
                    status, detail = "xfail", f"expected failure ({xfail}): {e}"
            except AssertionError as e:
                # A plain assertion fails even inside an xfail scenario — only the ExpectedGap tied to
                # the issue is excused (unrelated regressions must never become "expected").
                status, detail = "fail", f"assertion: {e}"
            except Exception as e:  # noqa: BLE001 — a scenario error is a finding, not a crash
                status = "fail"
                detail = f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=4)}"
        if status in ("pass", "xpass"):
            self.passed.add(sid)
        shot = None
        if status != "pass" and self.page is not None:
            try:
                SHOTS.mkdir(parents=True, exist_ok=True)
                target = SHOTS / f"{sid}.png"
                self.page.screenshot(path=str(target), full_page=True)
                shot = str(target.relative_to(REPO))  # repo-relative: the report never names this checkout's root
            except Exception:  # noqa: BLE001 — a screenshot must never mask the scenario's verdict
                shot = None
        row = {
            "id": sid, "title": title, "status": status, "detail": detail,
            "governed": governed, "xfail": xfail, "seconds": round(time.time() - t0, 1), "shot": shot,
        }
        self.rows.append(row)
        print(f"[{status.upper():7}] {sid:7} {title} — {detail.splitlines()[0] if detail else ''}", file=sys.stderr)

    @property
    def ok(self) -> bool:
        return all(r["status"] not in ("fail", "xpass") for r in self.rows)

    def counts(self) -> dict[str, int]:
        return {s: sum(1 for r in self.rows if r["status"] == s) for s in self.STATUSES}


def teardown_failures(t: dict) -> list[str]:
    """Derive the VERDICT-AFFECTING failures from a teardown record — pure, self-tested. Cleanup
    keeps going past each of these; none of them may leave `report.ok` true:
      - a live-run cancellation that was refused, errored, or never reached a terminal state;
      - `daemon_stopped` false (leader alive or group non-empty after SIGKILL);
      - bridge pids still alive after SIGKILL, or a bridge identity that could not be verified
        (`ps` failed / a candidate had no readable start time) — such pids are never signalled;
      - `bridge_enumeration_failed`: `ps` failed, so NO row (even a partially identified one) was
        signalled — only the owned daemon group was stopped; a live bridge may remain;
      - `bridge_unidentified_alive`: the advisory lock names a pid that is ALIVE but matches no
        identified process — refusing to signal it is right; calling the cleanup a success is not;
      - `bridge_not_from_pinned_cache`: an identified bridge did not run from the scratch clone of
        the pinned version (the results would describe some other bridge);
      - `bridge_lock_pid_invalid`: the advisory `.wi-serve.json` names a pid that is not a positive
        integer (a list, a string, a bool …) — the lock was ignored, cleanup of the independently
        identified processes still ran, but a bridge that writes a malformed lock is a finding;
      - `bridge_lock_unreadable`: the advisory lock could not be DECODED (not UTF-8, not JSON, or the
        reader raised) — the identified processes were terminated BEFORE the lock was read, so nothing
        was left running, but the cross-check against the lock pid could not happen (a finding);
      - `live_observation_lost`: the live `:7701` daemon answered at baseline but not at the final
        snapshot (connection refused / non-200 / non-list) — the before/after run-id diff that
        proves nothing landed there is UNPROVEN, so the isolation verdict cannot be clean;
      - `browser_close_error`: Chromium did not close cleanly;
      - the temp dir still present after removal was attempted;
      - the isolation scan raising, or any directory that could not be ENUMERATED / file that could
        not be read or stat'ed inside the operator stores (`live_scan_error`: the store was not fully
        inspected, so "uncontaminated" is unproven);
      - any teardown step that raised (`teardown_step_raised`)."""
    out: list[str] = []
    for c in t.get("cancelled_runs") or []:
        if not isinstance(c, dict):
            continue
        if "error" in c and "run" not in c:
            out.append(f"cancel_listing_failed: {c['error']}")
        elif c.get("error") or c.get("accepted") is not True or c.get("verified_terminal") is not True:
            out.append(f"run_cancel_failed: run {c.get('run')} accepted={c.get('accepted')} final={c.get('final')} error={c.get('error')}")
    if "daemon" in t and t.get("daemon_stopped") is not True:
        out.append(f"daemon_not_stopped: {t.get('daemon')}")
    bridge = t.get("bridge") or {}
    if isinstance(bridge, dict):
        remaining = (bridge.get("terminated") or {}).get("remaining") or []
        if remaining:
            out.append(f"bridge_survived_sigkill: pids {remaining}")
        if bridge.get("identity_unverified"):
            out.append(f"bridge_identity_unverified: {bridge.get('identity_unverified')}")
        if bridge.get("enumeration_failed"):
            out.append(f"bridge_enumeration_failed: {bridge.get('enumeration_failed')}")
        if bridge.get("unidentified_alive"):
            out.append(f"bridge_unidentified_alive: {bridge.get('unidentified_alive')}")
        if bridge.get("not_from_pinned_cache"):
            out.append(f"bridge_not_from_pinned_cache: {bridge.get('not_from_pinned_cache')}")
        if bridge.get("lock_pid_invalid"):
            out.append(f"bridge_lock_pid_invalid: {bridge.get('lock_pid_invalid')}")
        if bridge.get("lock_unreadable"):
            out.append(f"bridge_lock_unreadable: {bridge.get('lock_unreadable')}")
        if bridge.get("error"):
            out.append(f"bridge_stop_error: {bridge['error']}")
    if t.get("browser_close_error"):
        out.append(f"browser_close_error: {t['browser_close_error']}")
    if "tmp_removed" in t and t.get("tmp_removed") is not True:
        out.append(f"tmp_not_removed: {t.get('tmp')} ({t.get('tmp_remove_error') or 'still present'})")
    if t.get("isolation_scan_error"):
        out.append(f"isolation_scan_failed: {t['isolation_scan_error']}")
    scan = t.get("isolation_scan") or {}
    for e in (scan.get("scan_errors") or []) if isinstance(scan, dict) else []:
        out.append(f"live_scan_error: {e.get('file')} — {e.get('error')} (errno {e.get('errno')}{', ' + e['stage'] if e.get('stage') else ''})")
    live = (scan.get("live_7701") or {}) if isinstance(scan, dict) else {}
    if isinstance(live, dict) and live.get("observation_lost"):
        out.append(f"live_observation_lost: the live :{LIVE_DAEMON_PORT} daemon answered at baseline ({live.get('runs_before')} runs) but not at the "
                   f"final snapshot ({live.get('error_after') or 'no error recorded'}) — the before/after run-id diff is unproven")
    for e in t.get("step_errors") or []:
        out.append(f"teardown_step_raised: {e}")
    return out


def run_teardown_steps(steps: list[tuple[str, Callable[[], None]]]) -> list[str]:
    """Run EVERY step in its own try/except — a raise in one never prevents the next. Returns the
    recorded errors (`<step>: <type>: <message>`), each of which is a `teardown_step_raised` verdict
    failure. Pure with respect to the steps; self-tested."""
    errors: list[str] = []
    for name, fn in steps:
        try:
            fn()
        except BaseException as e:  # noqa: BLE001 — cleanup continues; the failure is recorded, never swallowed
            errors.append(f"{name}: {type(e).__name__}: {e}")
    return errors


def finalize(rep: dict, suite_ok: bool) -> dict:
    """`report.ok` is the ONLY thing the exit code reads: the scenario table AND the isolation proof
    AND a clean setup AND a clean teardown (no verdict-affecting failure) must all hold. A browser
    that failed to close is a teardown failure too (recorded on `setup.browser_close_error` by the
    browser's own `finally`, before the rig's teardown runs)."""
    setup = rep.get("setup") or {}
    failures = list((setup.get("teardown") or {}).get("failures") or [])
    close_error = setup.get("browser_close_error")
    if close_error and not any(f.startswith("browser_close_error") for f in failures):
        failures.append(f"browser_close_error: {close_error}")
    rep["teardown_failures"] = failures
    rep["ok"] = (
        bool(suite_ok)
        and not rep.get("live_touched")
        and rep.get("setup_failure") is None
        and rep.get("aborted") is None
        and not failures
    )
    return rep


def exit_code(rep: dict) -> int:
    return 0 if rep.get("ok") is True else 1


# ── Pure oracles (self-tested) ────────────────────────────────────────────────


def disjoint_pickers_oracle(a_ids: list[str], b_ids: list[str], doc_a: str, doc_b: str, issue: str, kind: str = "document") -> None:
    """VIB-3's / DEM-3's oracle. OWNERSHIP is a plain assertion (an empty picker is a FAIL, never an
    expected gap); only the leak itself is the expected gap tied to `issue`. `kind` names the artifact
    in every message (`document` for VIB-3, `demo` for DEM-3 — Copilot: a DEM-3 row must not say
    "document")."""
    assert a_ids, f"Project A's picker is empty — it must list at least its own {kind} {doc_a!r}"
    assert b_ids, f"Project B's picker is empty — it must list at least its own {kind} {doc_b!r}"
    assert doc_a in a_ids, f"Project A's picker does not list A's own {kind} {doc_a!r}: {a_ids}"
    assert doc_b in b_ids, f"Project B's picker does not list B's own {kind} {doc_b!r}: {b_ids}"
    expect_gap(doc_b not in a_ids, issue, f"Project A's picker lists B's {kind} {doc_b!r}: {a_ids}")
    expect_gap(doc_a not in b_ids, issue, f"Project B's picker lists A's {kind} {doc_a!r}: {b_ids}")


def assert_execution_prevented(units: object, events: object) -> dict:
    """TST-1's gate oracle: prove no unit EXECUTED, from the run view AND the run's event log."""
    assert isinstance(units, list) and units, (
        f"the run view carries no planned units (units={units!r}) — cannot prove nothing executed")
    statuses = [u.get("status") if isinstance(u, dict) else None for u in units]
    executed = [(i, s) for i, s in enumerate(statuses) if s not in UNIT_STATUSES_UNEXECUTED]
    assert not executed, f"units left the un-executed states {sorted(UNIT_STATUSES_UNEXECUTED)}: {executed}"
    assert isinstance(events, list) and events, "the run's event log is empty or unavailable — cannot prove execution was prevented"
    types = [str(e.get("type")) if isinstance(e, dict) else "?" for e in events]
    hits = [(i, t) for i, t in enumerate(types) if t in EXECUTION_EVENT_TYPES]
    assert not hits, f"execution events recorded despite the rejected intake gate: {hits[:8]}"
    gate_at = [i for i, t in enumerate(types) if t == "awaitingHuman"]
    cancelled_at = [i for i, t in enumerate(types) if t == "runCancelled"]
    assert gate_at, f"no awaitingHuman event — the intake gate never parked the run; types: {types[-10:]}"
    assert cancelled_at, f"no runCancelled event after the rejection; types: {types[-10:]}"
    assert cancelled_at[-1] > gate_at[-1], f"runCancelled (#{cancelled_at[-1]}) precedes awaitingHuman (#{gate_at[-1]})"
    after_gate = [t for t in types[gate_at[-1] + 1:] if t in EXECUTION_EVENT_TYPES]
    assert not after_gate, f"execution events AFTER the gate/rejection: {after_gate}"
    return {
        "units": len(units), "unit_statuses": statuses, "events": len(events),
        "awaiting_human_at": gate_at[-1], "run_cancelled_at": cancelled_at[-1],
        "types_between": types[gate_at[-1] + 1: cancelled_at[-1]],
        "types_after_cancel": types[cancelled_at[-1] + 1:],
    }


def event_identity(e: dict) -> tuple[int | None, str, int | None]:
    """What the studio's raw wire view RENDERS per row, as an identity: (`seq`, `type`, `ord`) —
    NarratorFeed.tsx paints exactly the seq column, the type, `u<ord>` when `ord` is a number, and a
    narration derived from the payload (no other payload field is painted verbatim)."""
    seq = e.get("seq")
    ord_ = e.get("ord")
    return (seq if isinstance(seq, int) and not isinstance(seq, bool) else None,
            str(e.get("type", "")),
            ord_ if isinstance(ord_, int) and not isinstance(ord_, bool) else None)


def _is_num(v: object) -> bool:
    """JS `typeof v === 'number'` for a JSON value: int or float, never a bool."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _hydrate_compare(a: dict, b: dict) -> int:
    """`store/events.ts hydrate`: `typeof a.seq === 'number' && typeof b.seq === 'number' ? a.seq - b.seq : 0`."""
    if _is_num(a.get("seq")) and _is_num(b.get("seq")):
        return (a["seq"] > b["seq"]) - (a["seq"] < b["seq"])
    return 0


def _feed_compare(a: dict, b: dict) -> int:
    """`narrator.ts sortFeedEvents`: frames that BOTH carry a numeric `ts` AND `seq` compare by `seq`;
    every other pair compares EQUAL (0) — an unsequenced frame is never moved, it keeps its relative
    placement (DES-RUN-NARRATOR §3 rule 2)."""
    a_s = a["seq"] if _is_num(a.get("ts")) and _is_num(a.get("seq")) else None
    b_s = b["seq"] if _is_num(b.get("ts")) and _is_num(b.get("seq")) else None
    if a_s is None or b_s is None:
        return 0
    return (a_s > b_s) - (a_s < b_s)


def expected_raw_rows(events: list[dict], run_id: str, ignored: set[str]) -> list[tuple[int | None, str, int | None]]:
    """The rows the raw view MUST show for `GET /runs/:id/events` — the UI's OWN two comparators, in
    the UI's order (codex r6 #5): the store hydrates `session == run_id` minus its never-rendered types
    (store/events.ts IGNORED) sorted by `_hydrate_compare`, then the feed sorts by `_feed_compare`
    (narrator.ts sortFeedEvents). Both comparators return 0 for any pair with an unsequenced frame, so
    such a frame KEEPS ITS RELATIVE PLACEMENT — it is never moved to the end (revision 10 keyed it to
    +inf, which the UI does not do). `Array.prototype.sort` (V8's TimSort, ported from CPython's
    listsort) and `list.sort` are the same stable algorithm, so the same comparator over the same input
    yields the same order."""
    import functools
    kept = [e for e in events if isinstance(e, dict) and e.get("session") == run_id and e.get("type") not in ignored]
    kept.sort(key=functools.cmp_to_key(_hydrate_compare))
    kept.sort(key=functools.cmp_to_key(_feed_compare))
    return [event_identity(e) for e in kept]


def assert_raw_view_matches_log(events: list[dict], rows: list[dict], run_id: str, ignored: set[str]) -> dict:
    """RUN-DET's equality oracle (codex r5 #6): the raw view's rows must be IDENTICAL to the durable
    log — the same ordered list of (seq, type, ord), not the same count. A substituted type, a
    dropped, duplicated or reordered frame, or a corrupted `ord` is a plain FAIL naming the first
    divergence. `rows` are what the DOM exposes per `raw-event`: `{seq, type, ord}` (None where the
    view paints nothing)."""
    assert isinstance(events, list) and events, "GET /runs/:id/events served no events — nothing to compare the raw view against"
    expected = expected_raw_rows(events, run_id, ignored)
    assert expected, f"the log holds no renderable frame for run {run_id} (types: {[e.get('type') for e in events[:8]]})"
    actual = [(r.get("seq"), str(r.get("type", "")), r.get("ord")) for r in rows]
    assert len(actual) == len(expected), (f"the raw view lists {len(actual)} rows, the log renders to {len(expected)} "
                                          f"(first UI rows {actual[:4]}, first log rows {expected[:4]})")
    for i, (a, x) in enumerate(zip(actual, expected)):
        assert a == x, f"raw view row #{i} is {a}, the log's frame there is {x} (UI {actual[max(0, i - 1): i + 2]} vs log {expected[max(0, i - 1): i + 2]})"
    seqs = [s for s, _t, _o in actual if s is not None]
    assert len(seqs) == len(set(seqs)), f"the raw view repeats a seq: {sorted(s for s in set(seqs) if seqs.count(s) > 1)[:5]}"
    assert seqs == sorted(seqs), f"the raw view is not in seq order: {seqs[:12]}…"
    return {"rows": len(actual), "with_seq": len(seqs), "first": actual[0], "last": actual[-1],
            "types": sorted({t for _s, t, _o in actual})}


def compare_build(dist: dict[str, str], served: dict[str, str]) -> list[str]:
    """Build identity by BYTES: every served entry (index + each referenced asset) must hash equal
    to the same path in this worktree's `dist/`. Returns the mismatches (empty = identical)."""
    problems: list[str] = []
    if not dist:
        problems.append("no dist/ build to compare against (run `npm run build` in this checkout)")
        return problems
    for path, sha in served.items():
        expected = dist.get(path)
        if expected is None:
            problems.append(f"{path}: served but absent from dist/")
        elif sha != expected:
            problems.append(f"{path}: served sha256 {sha[:16]}… ≠ dist {expected[:16]}…")
    if "index.html" not in served:
        problems.append("index.html was not served")
    return problems


def campaigns_isolation_oracle(status: int, body: object, seeded_id: str, a_cards: list[str], b_cards: list[str], issue: str) -> dict:
    """TST-2's oracle over REAL fixture data (the campaign seeded in the engine's own row format,
    scoped to Project A's repo). The wire must answer 200 with a `campaigns` list that carries the
    seed (any other answer is a FAIL with status/body — never "zero campaigns"); OWNERSHIP is plain:
    A's page must render the seeded card. The ONE expected gap tied to `issue` is the partition:
    B's page renders A's campaign (App.tsx: the campaign store is not project-partitioned)."""
    assert status == 200, f"GET /campaigns → {status} {str(body)[:300]}"
    campaigns = body.get("campaigns") if isinstance(body, dict) else body
    assert isinstance(campaigns, list), f"GET /campaigns answered 200 without a `campaigns` list: {str(body)[:300]}"
    ids = [c.get("id") for c in campaigns if isinstance(c, dict)]
    assert seeded_id in ids, f"the daemon does not list the seeded campaign {seeded_id!r}: {ids}"
    assert seeded_id in a_cards, f"Project A's campaigns page does not render its own campaign {seeded_id!r}: {a_cards}"
    foreign_on_b = sorted(set(b_cards) - {seeded_id})
    assert not foreign_on_b, f"Project B's campaigns page renders cards that belong to nobody in this rig: {foreign_on_b}"
    expect_gap(seeded_id not in b_cards, issue, f"Project B's campaigns page renders Project A's campaign {seeded_id!r} (B owns no repo and no campaign): {b_cards}")
    return {"engine_campaigns": len(campaigns), "engine_ids": ids, "a_cards": a_cards, "b_cards": b_cards}


CAMPAIGN_WRITERS_INSPECTED = (
    "crew `POST /campaigns` → `adapter.launchCampaign` (engine `campaign::launch`: persists AND dispatches every node's run — governed); "
    "the engine's own row (`wicked_core::campaign::persist` → `put_node` → estate `nodes`/`symbols`, read back by core-ts `campaign_list` "
    "via `open_store_ro` + `find_symbols`) is the only non-governed path"
)


def campaign_isolation_scenario(
    *, seed: Callable[[], dict], get: Callable[[str], tuple[int, object]], cards: Callable[[str], list[str]],
    campaign_id: str, repo_id: str, a: str, b: str, issue: str, record: dict | None = None,
) -> str:
    """TST-2's ACTUAL scenario body (the suite's closure only binds the collaborators; the self-tests
    drive THIS function with fakes and the real `Rig.seed_campaign_record` against a corrupt store).
    Every operational failure is a FAIL with its captured cause — never `blocked`:
      - the fixture write raising (DB corruption, a schema drift, a missing sibling row) ⇒
        `campaign-seed-write-failed`;
      - the wire answering anything but 200 with a `campaigns` list (a 500 carrying `{"campaigns":
        []}` included), a transport error, an exception ⇒ FAIL with status/body — validated FIRST;
      - a 200 list that does not carry the seed ⇒ `campaign-seed-missing`;
      - `GET /campaigns/:id` not serving the seed with A's repo on its node ⇒ FAIL.
    Only THEN the partition: A renders its card (plain); B rendering A's campaign is the ONE
    expected gap tied to `issue` (studio#216)."""
    try:
        seeded = seed()
    except Exception as e:  # noqa: BLE001 — an operational failure of the fixture writer is a FAIL, never a blocked row
        raise AssertionError(
            f"campaign-seed-write-failed: the campaign fixture could not be written into the scratch store — {type(e).__name__}: {e}. "
            f"Writers inspected: {CAMPAIGN_WRITERS_INSPECTED}; mirroring the engine's row failed as above (operational, not studio#216)."
        ) from e
    st, body = get("/campaigns")
    assert st == 200, f"GET /campaigns → HTTP {st} {str(body)[:300]} — the campaign wire is not answering (operational failure, not a gap)"
    campaigns = body.get("campaigns") if isinstance(body, dict) else None
    assert isinstance(campaigns, list), f"GET /campaigns answered 200 without a `campaigns` list: {str(body)[:300]}"
    ids = [c.get("id") for c in campaigns if isinstance(c, dict)]
    assert campaign_id in ids, (
        f"campaign-seed-missing: the fixture was written ({(seeded or {}).get('symbol')!r}) but GET /campaigns (200, {len(ids)} campaigns) does not "
        f"list it (ids {ids}) — the mirrored row does not match what `campaign_list` reads on this engine; seed record: {json.dumps(seeded, default=str)[:400]}"
    )
    dst, detail = get(f"/campaigns/{quote(campaign_id)}")
    assert dst == 200 and isinstance(detail, dict) and (detail.get("campaign") or {}).get("id") == campaign_id, f"GET /campaigns/{campaign_id} → {dst} {str(detail)[:200]}"
    nodes = ((detail["campaign"].get("def") or {}).get("nodes") or [{}])
    node_repo = (nodes[0].get("run_spec") or {}).get("repo_ref") if isinstance(nodes[0], dict) else None
    assert node_repo == repo_id, f"the daemon serves the seed with repo_ref {node_repo!r}, not A's repo {repo_id!r}"
    a_cards = cards(a)
    b_cards = cards(b)
    proof = campaigns_isolation_oracle(st, body, campaign_id, a_cards, b_cards, issue)
    if record is not None:
        record.update(proof)
    return f"A renders its campaign {campaign_id} and B renders none of A's (A: {a_cards}, B: {b_cards}; engine lists {proof['engine_campaigns']})"


def classify_recorder_answer(ack_status: int | None, answer: str | None, timed_out: bool) -> tuple[str, str]:
    """DEM-REC's verdict rule — pure, self-tested. `blocked` ONLY when the record request was
    acknowledged 2xx AND the bridge's answer IS one of the positively identified prerequisites in
    `RECORDER_PREREQS` (the whole message, anchored: no agent-authored `demo.spec.mjs`, or the
    recorder browser not installed). Everything else — a ≥ 400 ack, no ack at all, no answer within
    the budget, a launch timeout, a crashed/closed browser, `spawn EACCES`, a bare `browserType.launch`
    mention or ANY other recorder error — is a `fail` carrying what was observed."""
    if ack_status is None:
        return "fail", "the record request produced no acknowledgment (no POST /api/events response was observed)"
    if not 200 <= ack_status < 300:
        return "fail", f"the record request was refused: POST /api/events → HTTP {ack_status}"
    if timed_out or not answer:
        return "fail", "the recorder gave no answer within the budget (no 'Recording failed' entry and no new version)"
    for name, pattern in RECORDER_PREREQS:
        if pattern.match(answer):
            return "blocked", f"established prerequisite ({name}): {answer[:240]!r}"
    return "fail", f"the recorder answered with an error that is NOT one of the identified prerequisites {[n for n, _ in RECORDER_PREREQS]}: {answer[:300]!r}"


def plan_bridge_stop(found: dict, lock_pid: object, idocs: object, alive: Callable[[int], bool] = None) -> tuple[list[int], dict]:
    """Decide WHICH pids the bridge teardown may signal — pure, self-tested. Only rows identified by
    a SUCCESSFUL `ps` (command line names `wicked-interactive` + our root, verified start time) are
    signalled. A failed `ps` signals NOTHING — not even a partially identified row — and records
    `enumeration_failed`; a candidate with no readable start time records `identity_unverified`; a
    lock pid that is alive but matches no identified process records `unidentified_alive` (refused,
    and a verdict failure). Returns (pids_to_signal, info)."""
    alive = alive or pid_alive
    info: dict = {}
    procs = found.get("identified") or []
    identified = {p["pid"] for p in procs}
    if not found.get("ps_ok"):
        info["identity_unverified"] = f"ps failed ({found.get('ps_error')}) — no bridge pid can be identified; only the daemon group we spawned was stopped"
        info["enumeration_failed"] = (f"ps failed ({found.get('ps_error')}) — {len(procs)} partially identified row(s) "
                                      f"{sorted(identified)} NOT signalled; a live bridge for {idocs} may remain")
        pids: list[int] = []
    else:
        if found.get("unverified"):
            info["identity_unverified"] = (f"{len(found['unverified'])} candidate(s) serving {idocs} have no readable start time "
                                           f"(pids {[p['pid'] for p in found['unverified']]}) — NOT signalled")
        pids = sorted(identified)
    if valid_pid(lock_pid) and lock_pid not in identified and alive(lock_pid):  # type: ignore[arg-type]
        info["unidentified_alive"] = (f"lock pid {lock_pid} is ALIVE but no identified process serving {idocs} carries it — "
                                      f"NOT signalled (identity unproven); a live bridge may remain")
    return pids, info


def parse_semver(v: str) -> tuple[int, int, int] | None:
    m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", v)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def caret_max(versions: list[str], spec: str) -> str | None:
    """The version npm's `^` resolution picks from `versions` for `spec` (`name@^X.Y.Z`): the highest
    RELEASE version in the caret range (`^X.Y.Z` = >=X.Y.Z <(X+1).0.0; `^0.Y.Z` = >=0.Y.Z <0.(Y+1).0;
    `^0.0.Z` = exactly 0.0.Z). Pre-releases never satisfy a caret range. None when nothing does."""
    m = re.search(r"@\^(\d+\.\d+\.\d+)$", spec)
    if not m:
        raise ValueError(f"not a caret spec: {spec!r}")
    lo = parse_semver(m.group(1))
    assert lo is not None
    if lo[0] > 0:
        hi = (lo[0] + 1, 0, 0)
    elif lo[1] > 0:
        hi = (0, lo[1] + 1, 0)
    else:
        hi = (0, 0, lo[2] + 1)
    best: tuple[int, int, int] | None = None
    for v in versions:
        t = parse_semver(v)
        if t is not None and lo <= t < hi and (best is None or t > best):
            best = t
    return ".".join(map(str, best)) if best else None


def seed_registry_manifest(src_npm: Path, dst_npm: Path, name: str) -> dict:
    """Copy the CACHED registry manifest (npm's `make-fetch-happen:request-cache:https://registry.
    npmjs.org/<name>` cacache entry — its index file AND every content blob it names) from the
    operator's npm cache into the scratch cache, same layout, so `npx --offline` can resolve the
    spec without the network. Returns what was seeded plus the newest manifest's `versions`,
    `dist-tags` and cache time — or `error`. Pure over the filesystem; self-tested."""
    key = f"make-fetch-happen:request-cache:https://registry.npmjs.org/{name}"
    src_cc, dst_cc = src_npm / "_cacache", dst_npm / "_cacache"
    index_root = src_cc / "index-v5"
    if not index_root.is_dir():
        return {"error": f"no npm content cache at {src_cc} — npx cannot resolve {name} offline"}
    copied_index: list[str] = []
    copied_blobs: list[str] = []
    newest: tuple[int, dict] | None = None
    for idx in sorted(p for p in index_root.rglob("*") if p.is_file()):
        try:
            text = idx.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if key not in text:
            continue
        entries = []
        for line in text.splitlines():
            parts = line.split("\t", 1)
            if len(parts) != 2:
                continue
            try:
                entry = json.loads(parts[1])
            except json.JSONDecodeError:
                continue
            if entry.get("key") == key:
                entries.append(entry)
        if not entries:
            continue
        rel = idx.relative_to(src_cc)
        (dst_cc / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(idx, dst_cc / rel)
        copied_index.append(str(rel))
        for entry in entries:
            integrity = str(entry.get("integrity") or "")
            if "-" not in integrity:
                continue
            algo, b64 = integrity.split("-", 1)
            try:
                import base64
                hexd = base64.b64decode(b64).hex()
            except Exception:  # noqa: BLE001 — a malformed entry is skipped, the manifest check below decides
                continue
            blob_rel = Path("content-v2") / algo / hexd[:2] / hexd[2:4] / hexd[4:]
            blob = src_cc / blob_rel
            if not blob.is_file():
                continue
            # Two index entries may name the SAME blob (a re-fetch with an unchanged manifest); copy
            # and list it once (Copilot: the committed report carried a duplicate `blobs` entry).
            if str(blob_rel) not in copied_blobs:
                (dst_cc / blob_rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(blob, dst_cc / blob_rel)
                copied_blobs.append(str(blob_rel))
            try:
                manifest = json.loads(blob.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            t = int(entry.get("time") or 0)
            if isinstance(manifest, dict) and "versions" in manifest and (newest is None or t > newest[0]):
                newest = (t, manifest)
    if not copied_index or newest is None:
        return {"error": f"the npm cache at {src_cc} holds no usable registry manifest for {name} — npx cannot resolve the spec offline "
                         f"(index files copied: {copied_index}, blobs: {copied_blobs})"}
    t, manifest = newest
    return {
        "index_files": copied_index, "blobs": copied_blobs,
        "versions": sorted(manifest.get("versions", {}).keys()), "dist_tags": manifest.get("dist-tags"),
        "cached_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t / 1000)) if t else None,
    }


# A well-formed npm `integrity` for sha512: the 64-byte digest is 88 base64 characters ending in `==`.
INTEGRITY_RE = re.compile(r"^sha512-[A-Za-z0-9+/]{86}==$")
BRIDGE_PACKAGE_REL = Path("node_modules") / "wicked-interactive"


def resolve_bridge_pin(npx_root: Path, spec: str, pinned: str) -> dict:
    """Find the OFFLINE `_npx/<hash>` install npx would use for exactly `spec` and VALIDATE its lock
    metadata: the INSTALLED `wicked-interactive/package.json` version, the root `package-lock.json`
    entry's version AND npm's hidden lockfile (`node_modules/.package-lock.json`, written after npm
    verified the extracted tarball against `integrity`) must all name `pinned`; the recorded
    integrity must be a well-formed `sha512-<base64>` and identical in both lockfiles. Pure over the
    filesystem; self-tested. Returns the record — with `error` set whenever the pin cannot be met
    (no cache, another version, a lock naming another version, a malformed or disagreeing integrity):
    the caller turns that into a setup failure, never into a registry fallback."""
    candidates: list[dict] = []
    try:
        pkgs = sorted(npx_root.glob("*/package.json")) if npx_root.is_dir() else []
    except OSError as e:
        return {"candidates": [], "error": f"cannot enumerate {npx_root}: {e}"}
    for pkg in pkgs:
        try:
            meta = json.loads(pkg.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if (meta.get("_npx") or {}).get("packages") != [spec]:
            continue
        root = pkg.parent
        version = None
        try:
            version = json.loads((root / BRIDGE_PACKAGE_REL / "package.json").read_text()).get("version")
        except (OSError, json.JSONDecodeError):
            pass
        entry: dict = {}
        try:
            lock = json.loads((root / "package-lock.json").read_text())
            entry = (lock.get("packages") or {}).get("node_modules/wicked-interactive") or {}
        except (OSError, json.JSONDecodeError):
            pass
        hidden: dict = {}
        hidden_state = "absent"
        try:
            hidden = (json.loads((root / "node_modules" / ".package-lock.json").read_text()).get("packages") or {}).get("node_modules/wicked-interactive") or {}
            hidden_state = "ok" if hidden else "no wicked-interactive entry"
        except (OSError, json.JSONDecodeError) as e:
            hidden_state = f"unreadable: {type(e).__name__}"
        candidates.append({"path": str(root), "key": root.name, "version": version, "lock_version": entry.get("version"),
                           "integrity": entry.get("integrity"), "resolved": entry.get("resolved"),
                           "hidden_lock": hidden_state, "hidden_lock_version": hidden.get("version"), "hidden_lock_integrity": hidden.get("integrity")})
    if not candidates:
        return {"candidates": [], "error": (f"no offline `_npx` cache holds {spec} under {npx_root} — the bridge would have to resolve the spec "
                                           f"from the registry (unpinned, needs network); prime the cache once and rerun")}
    exact = [c for c in candidates if c["version"] == pinned]
    if not exact:
        return {"candidates": candidates, "error": f"the offline cache holds wicked-interactive {[c['version'] for c in candidates]}, not the pinned {pinned}"}
    chosen = exact[0]
    if chosen.get("lock_version") != pinned:
        return {"candidates": candidates, **chosen, "error": (f"the cache's package-lock.json names wicked-interactive {chosen.get('lock_version')!r}, not the pinned {pinned} "
                                                            f"(installed package.json says {pinned}) — lock metadata and installed tree disagree; the bytes cannot be identified")}
    integrity = chosen.get("integrity")
    if not isinstance(integrity, str) or not INTEGRITY_RE.match(integrity):
        return {"candidates": candidates, **chosen, "error": (f"the cached install of wicked-interactive {pinned} carries no well-formed tarball integrity in its lockfile "
                                                            f"(got {integrity!r}; expected `sha512-<86 base64 chars>==`) — its bytes cannot be identified")}
    if chosen.get("hidden_lock") != "ok":
        return {"candidates": candidates, **chosen, "error": (f"npm's hidden lockfile (node_modules/.package-lock.json) is {chosen.get('hidden_lock')} — without it npm itself would "
                                                            f"not trust this node_modules tree; the install's provenance cannot be tied to the integrity")}
    if chosen.get("hidden_lock_version") != pinned or chosen.get("hidden_lock_integrity") != integrity:
        return {"candidates": candidates, **chosen, "error": (f"npm's hidden lockfile records wicked-interactive {chosen.get('hidden_lock_version')!r} / {str(chosen.get('hidden_lock_integrity'))[:24]}…, "
                                                            f"the root lockfile {pinned} / {integrity[:24]}… — the installed tree does not descend from the recorded tarball")}
    return {"candidates": candidates, **chosen}


def integrity_blob_path(cacache: Path, integrity: str) -> Path | None:
    """Where cacache stores the content blob for an `<algo>-<base64>` integrity (`content-v2/<algo>/
    <hex[:2]>/<hex[2:4]>/<hex[4:]>`). None for a malformed integrity."""
    import base64
    if "-" not in integrity:
        return None
    algo, b64 = integrity.split("-", 1)
    try:
        hexd = base64.b64decode(b64, validate=True).hex()
    except (ValueError, TypeError):
        return None
    return cacache / "content-v2" / algo / hexd[:2] / hexd[2:4] / hexd[4:]


def _tree_digest(root: Path, errors: list[str], symlinks: list[dict]) -> dict[str, str]:
    """Every regular file under `root` (lstat walk — symlinks are RECORDED, never followed) → its
    sha256, keyed by the path relative to `root`. Enumeration/read errors are recorded, not swallowed."""
    out: dict[str, str] = {}
    stack: list[Path] = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                entries = list(it)
        except OSError as e:
            errors.append(f"{d}: {type(e).__name__}: {e.strerror or e}")
            continue
        for ent in entries:
            p = Path(ent.path)
            try:
                if ent.is_symlink():
                    symlinks.append({"path": str(p.relative_to(root)), "target": os.readlink(p)})
                    continue
                if ent.is_dir(follow_symlinks=False):
                    stack.append(p)
                elif ent.is_file(follow_symlinks=False):
                    out[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
            except OSError as e:
                errors.append(f"{p}: {type(e).__name__}: {e.strerror or e}")
    return out


def clone_root_containment(dst: Path, scratch: Path | None) -> dict:
    """BEFORE anything under the clone is read (codex r6 #1): the clone ROOT itself, and every ancestor
    of it strictly under `scratch`, is `lstat`ed — a symlink anywhere on that chain is an error (a copied
    cache-root link would resolve straight back into the operator's cache while the descendant walk
    sees "zero symlinks"); and the root's realpath must lie inside the scratch dir's realpath. Ancestors
    ABOVE scratch are not judged (macOS's `/var` → `/private/var` is a symlink the scratch dir legitimately
    lives under); `scratch=None` still refuses a symlinked root. Pure; self-tested."""
    import stat as _stat
    rec: dict = {"scratch": str(scratch) if scratch is not None else None, "ancestors_checked": []}
    try:
        st = os.lstat(dst)
    except OSError as e:
        rec["error"] = f"the clone root {dst} cannot be lstat'ed: {type(e).__name__}: {e.strerror or e}"
        return rec
    rec["root_is_symlink"] = _stat.S_ISLNK(st.st_mode)
    if rec["root_is_symlink"]:
        try:
            target = os.readlink(dst)
        except OSError as e:
            target = f"<unreadable: {e.strerror or e}>"
        rec["root_target"] = target
        rec["realpath"] = os.path.realpath(dst)
        rec["error"] = f"the clone root {dst} is a SYMLINK → {target} (resolves to {rec['realpath']}) — refused before reading anything"
        return rec
    if not _stat.S_ISDIR(st.st_mode):
        rec["error"] = f"the clone root {dst} is not a directory"
        return rec
    rec["realpath"] = os.path.realpath(dst)
    if scratch is None:
        return rec
    scratch_abs = os.path.abspath(scratch)
    dst_abs = os.path.abspath(dst)
    if not (dst_abs == scratch_abs or dst_abs.startswith(scratch_abs + os.sep)):
        rec["error"] = f"the clone root {dst} is not lexically under the scratch dir {scratch}"
        return rec
    # every ancestor strictly under scratch, from the top down, then the root itself (already lstat'ed)
    rel_parts = Path(dst_abs).relative_to(scratch_abs).parts
    cur = Path(scratch_abs)
    for part in rel_parts[:-1]:
        cur = cur / part
        rec["ancestors_checked"].append(str(cur))
        try:
            if os.path.islink(cur):
                rec["error"] = f"the clone root's ancestor {cur} under the scratch dir is a SYMLINK → {os.readlink(cur)} — refused before reading anything"
                return rec
        except OSError as e:
            rec["error"] = f"the clone root's ancestor {cur} cannot be inspected: {type(e).__name__}: {e.strerror or e}"
            return rec
    scratch_real = os.path.realpath(scratch_abs)
    rec["scratch_realpath"] = scratch_real
    rec["inside_scratch"] = rec["realpath"] == scratch_real or rec["realpath"].startswith(scratch_real + os.sep)
    if not rec["inside_scratch"]:
        rec["error"] = f"the clone root {dst} resolves to {rec['realpath']}, OUTSIDE the scratch dir {scratch_real} — refused before reading anything"
    return rec


def verify_bridge_clone(src: Path, dst: Path, integrity: str, cacache: Path | None, *, scratch: Path | None = None) -> dict:
    """Establish what CAN be established about the scratch clone `dst` — pure over the filesystem;
    self-tested. Five checks, all recorded:
      0. ROOT CONTAINMENT (codex r6 #1, `clone_root_containment`): BEFORE any read, the clone root and
         every ancestor under `scratch` are `lstat`ed (a symlink ⇒ error) and the root's realpath must
         be inside the scratch dir — else `error`, `clone_equals_source: false`, `bytes_authenticated:
         false`, and nothing under the root is opened.
      1. SYMLINKS ESCAPING: an lstat walk of the clone; every symlink's target (resolved from its own
         directory) must stay INSIDE the clone — an escaping or absolute target is an error (npm's
         `.bin` shims are relative links into `node_modules`, so a legitimate clone has none).
      2. SYMLINKS == SOURCE (codex r5 #2): the clone's symlinks — by path AND by `readlink` target —
         must be exactly the source install's: a link missing, added, or RETARGETED (e.g. the
         `.bin/wicked-interactive` shim pointed at another internal file) is an error. Regular-file
         hashing never sees a link's target, so this is a separate comparison.
      3. CLONE == SOURCE: every regular file under the clone hashes (sha256) equal to the same
         path under the source install, with no file missing or extra — the bytes the bridge
         executes are the bytes of the operator's install.
      4. THE TARBALL, when the operator's cacache still holds the content blob for `integrity`:
         its sha512 must equal the integrity (what npm/pacote verified at install), the tarball's file
         SET must EQUAL the clone's `node_modules/wicked-interactive` file set (no member missing from
         the clone, NO installed file the tarball does not carry — codex r6 #3), every member must hash
         equal, and every symlink member must exist in the clone with the same target (a hard link or
         any other special member is an error — not comparable) — ONLY then are the bytes AUTHENTICATED
         against the registry tarball (`bytes_authenticated: true`); any difference is listed under
         `tarball.{members_missing_in_clone, members_extra_in_clone, members_mismatched,
         symlinks_missing_in_clone, symlinks_extra_in_clone, symlinks_retargeted, members_unsupported}`
         with `bytes_authenticated: false`.
         When the blob is absent (npx does not retain tarballs after extraction) there is NO trusted
         source of the package's bytes on the host: npm's lockfiles record the tarball's sha512 but no
         per-file digest, and nothing records the lockfiles' own integrity — so the tie from the bytes
         on disk to the recorded sha512 is npm METADATA, mutable and unauthenticated. That route is
         recorded as `bytes_verified_by: "lockfile-metadata (unauthenticated): …"` with
         `bytes_authenticated: false`; checks 1–3 still hold (the clone IS the source install), and the
         claim the plan may make is exactly that much — never "verified against the tarball".
    `error` is set on any failure."""
    import base64
    import tarfile
    rec: dict = {"src": str(src), "dst": str(dst)}
    containment = clone_root_containment(dst, scratch)
    rec["root_containment"] = containment
    if containment.get("error"):
        rec.update(clone_equals_source=False, bytes_authenticated=False, error=containment["error"])
        return rec
    errors: list[str] = []
    src_links: list[dict] = []
    dst_links: list[dict] = []
    src_files = _tree_digest(src, errors, src_links)
    dst_files = _tree_digest(dst, errors, dst_links)
    dst_real = os.path.realpath(dst)
    escaping = []
    for link in dst_links:
        resolved = os.path.realpath(os.path.join(dst_real, os.path.dirname(link["path"]), link["target"]))
        if os.path.isabs(link["target"]) or not (resolved == dst_real or resolved.startswith(dst_real + os.sep)):
            escaping.append({**link, "resolves_to": resolved})
    src_link_map = {l["path"]: l["target"] for l in src_links}
    dst_link_map = {l["path"]: l["target"] for l in dst_links}
    links_missing = sorted(set(src_link_map) - set(dst_link_map))
    links_extra = sorted(set(dst_link_map) - set(src_link_map))
    links_retargeted = [
        {"path": p, "source_target": src_link_map[p], "clone_target": dst_link_map[p]}
        for p in sorted(set(src_link_map) & set(dst_link_map)) if src_link_map[p] != dst_link_map[p]
    ]
    rec.update(files_compared=len(dst_files), symlinks=len(dst_links), symlinks_in_source=len(src_links), escaping_symlinks=escaping,
               symlinks_missing_in_clone=links_missing[:20], symlinks_extra_in_clone=links_extra[:20], symlinks_retargeted=links_retargeted[:20],
               symlinks_compared_by_target=len(set(src_link_map) & set(dst_link_map)), walk_errors=errors[:20])
    missing = sorted(set(src_files) - set(dst_files))
    extra = sorted(set(dst_files) - set(src_files))
    mismatched = sorted(p for p in set(src_files) & set(dst_files) if src_files[p] != dst_files[p])
    rec.update(missing_in_clone=missing[:20], extra_in_clone=extra[:20], mismatched=mismatched[:20],
               missing_count=len(missing), extra_count=len(extra), mismatched_count=len(mismatched))
    pkg_prefix = str(BRIDGE_PACKAGE_REL) + os.sep
    pkg_files = {p[len(pkg_prefix):]: h for p, h in dst_files.items() if p.startswith(pkg_prefix)}
    rec["package_files"] = len(pkg_files)
    rec["package_tree_sha256"] = hashlib.sha256("".join(f"{p}\t{h}\n" for p, h in sorted(pkg_files.items())).encode()).hexdigest()
    # The clone digest covers the symlinks too (path + target): a retargeted shim changes it.
    rec["clone_tree_sha256"] = hashlib.sha256(("".join(f"{p}\t{h}\n" for p, h in sorted(dst_files.items()))
                                               + "".join(f"{p}\t-> {t}\n" for p, t in sorted(dst_link_map.items()))).encode()).hexdigest()
    problems: list[str] = []
    if errors:
        problems.append(f"{len(errors)} path(s) could not be walked/read: {errors[:3]}")
    if escaping:
        problems.append(f"{len(escaping)} symlink(s) escape the scratch clone: {escaping[:3]}")
    if links_missing or links_extra or links_retargeted:
        problems.append(f"the clone's symlinks differ from the source install's: {len(links_missing)} missing, {len(links_extra)} extra, "
                        f"{len(links_retargeted)} retargeted (e.g. {(links_retargeted or links_missing or links_extra)[:3]})")
    if missing or extra or mismatched:
        problems.append(f"the clone differs from the source install: {len(missing)} missing, {len(extra)} extra, {len(mismatched)} mismatched (e.g. {(mismatched or missing or extra)[:3]})")
    if not pkg_files:
        problems.append(f"the clone holds no files under {BRIDGE_PACKAGE_REL}")
    tarball: dict = {"present": False}
    blob = integrity_blob_path(cacache, integrity) if cacache is not None else None
    if blob is not None:
        tarball["path"] = str(blob)
    if blob is not None and blob.is_file():
        tarball["present"] = True
        try:
            data = blob.read_bytes()
            digest = hashlib.sha512(data).digest()
            expected = base64.b64decode(integrity.split("-", 1)[1])
            tarball["sha512_matches_integrity"] = digest == expected
            if digest != expected:
                problems.append(f"the cached tarball {blob} does not hash to the lockfile integrity (sha512 {base64.b64encode(digest).decode()[:24]}…)")
            else:
                # COMPLETE comparison (codex r6 #3): the tarball's file set vs the clone's package file
                # set in BOTH directions, symlink members by target, anything else unsupported.
                tar_files: dict[str, str | None] = {}
                tar_links: dict[str, str] = {}
                unsupported: list[str] = []
                import io
                with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
                    for m in tf.getmembers():
                        if m.isdir():
                            continue
                        rel = m.name.split("/", 1)[1] if "/" in m.name else m.name
                        if m.isfile():
                            fh = tf.extractfile(m)
                            tar_files[rel] = hashlib.sha256(fh.read()).hexdigest() if fh is not None else None
                        elif m.issym():
                            tar_links[rel] = m.linkname
                        else:
                            unsupported.append(f"{rel} ({'hardlink' if m.islnk() else m.type!r})")
                pkg_links = {p[len(pkg_prefix):]: t for p, t in dst_link_map.items() if p.startswith(pkg_prefix)}
                members_missing = sorted(set(tar_files) - set(pkg_files))
                members_extra = sorted(set(pkg_files) - set(tar_files))
                members_mismatched = sorted(p for p in set(tar_files) & set(pkg_files) if tar_files[p] != pkg_files[p])
                links_missing_t = sorted(set(tar_links) - set(pkg_links))
                links_extra_t = sorted(set(pkg_links) - set(tar_links))
                links_retargeted_t = [{"path": p, "tarball_target": tar_links[p], "clone_target": pkg_links[p]}
                                      for p in sorted(set(tar_links) & set(pkg_links)) if tar_links[p] != pkg_links[p]]
                tarball.update(members=len(tar_files), symlink_members=len(tar_links), members_missing_in_clone=members_missing[:20],
                               members_extra_in_clone=members_extra[:20], members_mismatched=members_mismatched[:20],
                               symlinks_missing_in_clone=links_missing_t[:20], symlinks_extra_in_clone=links_extra_t[:20],
                               symlinks_retargeted=links_retargeted_t[:20], members_unsupported=unsupported[:20])
                if members_missing or members_extra or members_mismatched:
                    problems.append(f"the clone's {BRIDGE_PACKAGE_REL} differs from the tarball: {len(members_missing)} missing, {len(members_extra)} extra "
                                    f"(installed but not in the tarball), {len(members_mismatched)} mismatched (e.g. {(members_mismatched or members_extra or members_missing)[:3]})")
                if links_missing_t or links_extra_t or links_retargeted_t:
                    problems.append(f"the clone's {BRIDGE_PACKAGE_REL} symlinks differ from the tarball's: {len(links_missing_t)} missing, {len(links_extra_t)} extra, "
                                    f"{len(links_retargeted_t)} retargeted (e.g. {(links_retargeted_t or links_missing_t or links_extra_t)[:3]})")
                if unsupported:
                    problems.append(f"the tarball carries {len(unsupported)} member(s) that cannot be compared (hard links / special files): {unsupported[:3]}")
        except (OSError, tarfile.TarError, ValueError) as e:
            tarball["error"] = f"{type(e).__name__}: {e}"
            problems.append(f"the cached tarball could not be verified: {type(e).__name__}: {e}")
    rec["tarball"] = tarball
    rec["clone_equals_source"] = not problems
    # `bytes_authenticated` is ALWAYS stated (codex r6 #3): true only for a present tarball with NO
    # difference of any kind; false otherwise — with the differences listed under `tarball`.
    rec["bytes_authenticated"] = bool(tarball.get("present")) and not problems
    if rec["bytes_authenticated"]:
        rec["bytes_verified_by"] = ("tarball: the cacache blob for the lockfile integrity hashes (sha512) to that integrity, the tarball's file SET equals the "
                                    "clone's node_modules/wicked-interactive file set (nothing missing, nothing extra), every member is byte-equal and every "
                                    "symlink member has the same target; plus the whole clone tree (files sha256 per file, symlinks by target) is byte-equal "
                                    "to the source install")
    elif not problems:
        rec["bytes_verified_by"] = ("lockfile-metadata (unauthenticated): the tarball for the recorded integrity is not retained in the operator's npm cacache on "
                                    "this host, so NOTHING on the host authenticates the package bytes against that sha512 — npm's lockfiles record the tarball "
                                    "digest but no per-file digest, and nothing records the lockfiles' own integrity. PROVEN: the clone is the source install "
                                    "(every file sha256-equal, every symlink target equal, no symlink escapes). UNAUTHENTICATED: that the source install's bytes "
                                    "are the registry tarball's — that rests on npm's metadata (validated consistent by resolve_bridge_pin), which is mutable")
    if problems:
        rec["error"] = "; ".join(problems)
    return rec


def persistence_oracle(before: dict, after: dict) -> None:
    """VIB-4's content oracle: what the canvas RENDERED and what the versions wire said (head,
    lineage, head-html bytes) must be identical before and after a full reload. A 200 with any
    body is not persistence."""
    for key in ("rendered_html_sha256", "rendered_text", "head", "lineage", "head_html_sha256"):
        assert key in before and key in after, f"persistence capture lacks {key!r}: before={sorted(before)} after={sorted(after)}"
        assert before[key] == after[key], f"{key} changed across the reload: {str(before[key])[:120]!r} → {str(after[key])[:120]!r}"
    assert before["rendered_html_sha256"] and before["head_html_sha256"], "nothing rendered/served before the reload — nothing to compare"
    assert isinstance(before["head"], int) and before["head"] in before["lineage"], f"head {before['head']!r} is not in the lineage {before['lineage']}"


def run_delete_rows(s: "Suite", targets: list[tuple[str, str, str]], deleter: Callable[[str, str, str], None], issue: str, prefix: str = "CLN-1") -> list[str]:
    """CLN-1 per TARGET: every seeded doc/demo gets its OWN row, so an ExpectedGap on one never
    hides the others. `targets` = (project id, mode, name); rows are `<prefix>a`, `<prefix>b`, …"""
    ids: list[str] = []
    for i, (pid, mode, name) in enumerate(targets):
        sid = f"{prefix}{chr(ord('a') + i)}"
        ids.append(sid)
        s.run(sid, f"Delete the seeded {'document' if mode == 'document' else 'demo'} {name} through the picker",
              lambda pid=pid, mode=mode, name=name: (deleter(pid, mode, name), f"{mode} {name} deleted via 🗑 → confirm → Delete; absent after a real reload")[1],
              xfail=issue)
    return ids


def read_package_version(path: Path) -> str:
    """The `version` of a package.json, or an `unreadable: …` sentence — NEVER a raise (codex r5 #1):
    a missing file, invalid JSON, a JSON `null`/list/string (no `["version"]`), or a non-string
    version all come back as text the caller records and compares (it will not equal the pin)."""
    try:
        doc = json.loads(path.read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        return f"unreadable: {type(e).__name__}: {e}"
    if not isinstance(doc, dict):
        return f"unreadable: package.json is JSON {type(doc).__name__}, not an object"
    version = doc.get("version")
    if not isinstance(version, str):
        return f"unreadable: version is {type(version).__name__} ({version!r}), not a string"
    return version


# ── Process identity + termination helpers (self-tested) ──────────────────────


def valid_pid(value: object) -> bool:
    """A pid we may ever signal: a positive integer above 1 — never 0 (our own group), never
    negative (a group), never a bool/str the JSON could smuggle in."""
    return isinstance(value, int) and not isinstance(value, bool) and value > 1


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def ps_rows() -> tuple[list[dict], str | None]:
    """The process table, or (partial rows, error) when `ps` itself failed — a failed `ps` must
    never read as "no bridge running"."""
    try:
        res = subprocess.run(["ps", "-axo", "pid=,pgid=,ppid=,command="], capture_output=True, text=True, timeout=20, env=PS_ENV)
    except (OSError, subprocess.TimeoutExpired) as e:
        return [], f"ps failed: {e}"
    rows = []
    for line in res.stdout.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        try:
            # `ps -o command=` pads the column with trailing blanks — strip them so the recorded
            # command line is the command line (Copilot: trailing spaces in the committed report).
            rows.append({"pid": int(parts[0]), "pgid": int(parts[1]), "ppid": int(parts[2]), "command": parts[3].rstrip()})
        except ValueError:
            continue
    if res.returncode != 0:
        return rows, f"ps exited {res.returncode}: {res.stderr.strip()[:200]}"
    return rows, None


def ps_started_at(pid: int, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> float | None:
    """The process start time, or None when it could not be READ (a failed/odd `ps`, a vanished
    pid, an unparseable `lstart`) — None means UNVERIFIED (listed, never signalled), never "started
    recently enough". `ps` runs under `LC_ALL=C` (`PS_ENV`) so `lstart` is the English
    `%a %b %d %H:%M:%S %Y` regardless of the operator's locale; a parse failure still yields None
    and therefore NARROWS matching (unverified ⇒ not identified ⇒ not signalled), never widens it."""
    try:
        res = runner(["ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True, timeout=20, env=PS_ENV)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    try:
        return time.mktime(time.strptime(res.stdout.strip(), "%a %b %d %H:%M:%S %Y"))
    except ValueError:
        return None


def read_bridge_lock(root: Path) -> tuple[dict | None, str]:
    """`<root>/.wi-serve.json` — advisory only. A symlink is refused outright. NEVER raises on the
    file's content (codex r6 #2): bytes that are not UTF-8 (`UnicodeDecodeError`), not JSON
    (`JSONDecodeError`) or any other `ValueError` from decoding come back as `unreadable: <Type>: …`
    — the caller records that as `bridge_lock_unreadable` (a verdict failure) and has ALREADY
    terminated the identified processes by the time it reads the lock."""
    lock = root / ".wi-serve.json"
    try:
        if lock.is_symlink():
            return None, "refused: .wi-serve.json is a symlink"
        if not lock.is_file():
            return None, "absent"
        data = json.loads(lock.read_bytes().decode("utf-8"))
    except (OSError, ValueError) as e:  # UnicodeDecodeError and JSONDecodeError are both ValueErrors
        return None, f"unreadable: {type(e).__name__}: {str(e)[:200]}"
    if not isinstance(data, dict):
        return None, "refused: lock is not a JSON object"
    return data, "ok"


def bridge_processes(
    root: Path, not_before: float, *,
    ps: Callable[[], tuple[list[dict], str | None]] = ps_rows,
    started_at: Callable[[int], float | None] = ps_started_at,
) -> dict:
    """The processes serving OUR docs root — identified by COMMAND LINE (`wicked-interactive` AND
    the unique temp root) AND a VERIFIED start time no earlier than our daemon. Both the detached
    `npx` wrapper and the node bridge it execs match; an older process merely mentioning the path
    does not. A candidate whose start time cannot be read is `unverified` — listed, NEVER
    signalled; a failed `ps` makes the whole identification unverified (`ps_ok=false`)."""
    rows, ps_error = ps()
    identified: list[dict] = []
    unverified: list[dict] = []
    older: list[dict] = []
    for r in rows:
        cmd = r["command"]
        if "wicked-interactive" not in cmd or str(root) not in cmd:
            continue
        started = started_at(r["pid"])
        entry = {**r, "started_at": started}
        if started is None:
            unverified.append(entry)
        elif started < not_before - 5:
            older.append(entry)
        else:
            identified.append(entry)
    return {"identified": identified, "unverified": unverified, "older_excluded": older,
            "ps_ok": ps_error is None, "ps_error": ps_error}


def terminate_pids(pids: list[int], grace_s: float = 10) -> dict:
    """SIGTERM → poll until gone → SIGKILL the rest → poll. Returns what happened, not a claim."""
    pids = [p for p in pids if valid_pid(p)]
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + grace_s
    while time.time() < deadline and any(pid_alive(p) for p in pids):
        time.sleep(0.2)
    forced = [p for p in pids if pid_alive(p)]
    for pid in forced:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    deadline = time.time() + 5
    while time.time() < deadline and any(pid_alive(p) for p in forced):
        time.sleep(0.2)
    return {"signalled": pids, "forced": forced, "remaining": [p for p in pids if pid_alive(p)]}


def stop_process_group(proc: subprocess.Popen, grace_s: float = 15) -> dict:
    """The daemon was started with `start_new_session=True`, so its pid is the group id and every
    non-detached child (workers, estate-mcp) is in the group. SIGTERM the group, poll for BOTH the
    leader's exit and an empty group, SIGKILL if not, poll again."""
    pgid = proc.pid
    result: dict = {"pid": proc.pid, "forced": False}
    if proc.poll() is None or group_alive(pgid):
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + grace_s
    while time.time() < deadline and (proc.poll() is None or group_alive(pgid)):
        time.sleep(0.2)
    if proc.poll() is None or group_alive(pgid):
        result["forced"] = True
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        deadline = time.time() + 5
        while time.time() < deadline and (proc.poll() is None or group_alive(pgid)):
            time.sleep(0.2)
    result["exit_code"] = proc.returncode
    result["group_empty"] = not group_alive(pgid)
    return result


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
        raise SetupFailure("daemon", "no `wicked-crew` on PATH and CREW_CLI unset — install wicked-crew or point CREW_CLI at dist/cli/index.js")
    return [binary]


def fetch(path: str, base: str | None = None, timeout: int = 30) -> tuple[int, bytes]:
    """A raw GET (HTML, JS, anything) → (status, bytes)."""
    req = urllib.request.Request(f"{base or ORIGIN}{path}", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def api(method: str, path: str, body: dict | None = None, timeout: int = 60, base: str | None = None) -> tuple[int, object]:
    req = urllib.request.Request(f"{base or API}{path}", method=method)
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


def run_events(run_id: str) -> list[dict] | None:
    """The run's durable event log, or None when the daemon cannot serve it (503: no read binding)."""
    status, body = api("GET", f"/runs/{quote(run_id)}/events")
    return body.get("events", []) if status == 200 and isinstance(body, dict) else None


def last_events(run_id: str, n: int = 4) -> list[dict]:
    return (run_events(run_id) or [])[-n:]


def council_activity(run_id: str) -> dict[str, int]:
    """How much council work the engine did on a run — `council*` event types by count. The recon
    intake gate is `before:1` (crew campaigns/plan.ts RECON_INTAKE_GATE_TOKEN): it parks EXECUTION
    of unit 1, and the DISTRIBUTION council (plan consensus per unit) runs before it (crew#473)."""
    counts: dict[str, int] = {}
    for e in run_events(run_id) or []:
        t = str(e.get("type", ""))
        if t.startswith("council"):
            counts[t] = counts.get(t, 0) + 1
    return counts


def snapshot_live_runs(get: Callable[..., tuple[int, object]] | None = None) -> dict:
    """READ-ONLY look at the live :7701 daemon — its run ids, so teardown can prove nothing new
    appeared there. Never a POST. `reachable` is true ONLY for a 200 whose body carries a `runs`
    LIST of run views each naming `session.id` (codex r5 #3): a 200 `{"error": …}`, a `runs` that
    is not a list, or a malformed run view is NOT an observation — it is recorded unreachable with
    the shape named, so `scan_operator_state` marks it `observation_lost` (never an empty list, which
    would read as "no runs" and let a clean verdict through). `get` is injectable for the self-tests."""
    get = get or api
    try:
        st, body = get("GET", "/runs", timeout=5, base=f"{LIVE_ORIGIN}/api/v1")
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return {"reachable": False, "error": str(e)[:200], "run_ids": []}
    if st != 200 or not isinstance(body, dict):
        return {"reachable": False, "error": f"GET /runs → {st}", "run_ids": []}
    runs = body.get("runs")
    if not isinstance(runs, list):
        return {"reachable": False, "run_ids": [],
                "error": f"GET /runs → 200 without a `runs` list (body keys {sorted(body)[:8]}: {str(body)[:160]}) — not an observation"}
    ids: list[str] = []
    problems: dict[str, str] = {}
    for i, r in enumerate(runs):
        session = r.get("session") if isinstance(r, dict) else None
        rid = session.get("id") if isinstance(session, dict) else None
        if not isinstance(rid, str) or not rid:
            return {"reachable": False, "run_ids": [],
                    "error": f"GET /runs → 200 but runs[{i}] carries no `session.id` ({str(r)[:160]}) — the listing is malformed, not an observation"}
        ids.append(rid)
        problems[rid] = str(session.get("problem", ""))[:200]
    return {"reachable": True, "run_ids": sorted(ids), "problems": problems}


# ── The rig ───────────────────────────────────────────────────────────────────


def under(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def scan_file_for(path: Path, needles: list[bytes], opener: Callable[[Path], object] | None = None) -> tuple[list[bytes], dict | None]:
    """Which needles occur in the file's bytes (chunked; overlap keeps a needle spanning chunks).
    Returns (found, error): a file that could not be opened or read is an ERROR carrying the path
    and errno — never an empty hit list (an unread file proves nothing)."""
    found: list[bytes] = []
    overlap = max((len(n) for n in needles), default=0)
    tail = b""
    try:
        with (opener(path) if opener is not None else path.open("rb")) as fh:  # type: ignore[attr-defined]
            while True:
                chunk = fh.read(8 * 1024 * 1024)
                if not chunk:
                    break
                buf = tail + chunk
                for n in needles:
                    if n not in found and n in buf:
                        found.append(n)
                if len(found) == len(needles):
                    break
                tail = buf[-overlap:] if overlap else b""
    except OSError as e:
        return found, {"file": str(path), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}"}
    return found, None


def walk_files(root: Path, errors: list[dict], scandir: Callable = os.scandir) -> Iterator[tuple[Path, os.DirEntry | None]]:
    """An EXPLICIT directory walk (no `Path.rglob`, which swallows enumeration errors before any
    caller sees them). Every directory that cannot be enumerated, and every entry whose type cannot
    be determined, is RECORDED in `errors` (path, errno, stage) and the walk continues with the
    rest. Symlinks are never followed. Yields (path, DirEntry) for regular files."""
    stack: list[Path] = [root]
    while stack:
        d = stack.pop()
        try:
            with scandir(d) as it:
                entries = list(it)
        except OSError as e:
            errors.append({"file": str(d), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}", "stage": "scandir"})
            continue
        for ent in entries:
            try:
                if ent.is_symlink():
                    continue
                if ent.is_dir(follow_symlinks=False):
                    stack.append(Path(ent.path))
                    continue
                if ent.is_file(follow_symlinks=False):
                    yield Path(ent.path), ent
            except OSError as e:
                errors.append({"file": str(ent.path), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}", "stage": "entry"})


def scan_tree(roots: tuple[Path, ...] | list[Path], since: float, needles: list[bytes], opener: Callable[[Path], object] | None = None,
              scandir: Callable = os.scandir) -> dict:
    """Every regular file under `roots` modified since `since` (mtime OR ctime) is byte-scanned for
    the needles. Enumeration, stat and read errors are ALL RECORDED (`scan_errors`, with the stage)
    and scanning continues — an error means the store was not fully inspected, which
    `teardown_failures` turns into `live_scan_error` (⇒ `report.ok=false`). Fails closed: a
    directory the walk could not open is an error, never an empty result."""
    modified: list[str] = []
    hits: list[dict] = []
    errors: list[dict] = []
    for root in roots:
        try:
            if not root.exists():
                continue
        except OSError as e:
            errors.append({"file": str(root), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}", "stage": "exists"})
            continue
        for p, _ent in walk_files(root, errors, scandir):
            try:
                st = p.stat()
            except OSError as e:
                errors.append({"file": str(p), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}", "stage": "stat"})
                continue
            if st.st_mtime < since - 2 and st.st_ctime < since - 2:
                continue
            modified.append(str(p))
            if st.st_size > 512 * 1024 * 1024:
                hits.append({"file": str(p), "needle": None, "note": "too large to scan — treated as a hit"})
                continue
            found, err = scan_file_for(p, needles, opener)
            for n in found:
                hits.append({"file": str(p), "needle": n.decode()})
            if err is not None:
                errors.append({**err, "stage": "read"})
    return {"modified": modified, "hits": hits, "scan_errors": errors}


class Rig:
    """Everything the suite owns on this machine: the temp tree, the hermetic env, the daemon (a
    process group), the fixture server — and their teardown."""

    def __init__(self, report: dict) -> None:
        self.report = report
        self.run_started_at = time.time()
        self.daemon: subprocess.Popen | None = None
        self.daemon_log = None
        self.daemon_started_at: float | None = None
        self.fixture_httpd: ThreadingHTTPServer | None = None
        self.fixture_url = ""
        self.repo_id = ""
        # This run's identifiers, as they appear on any wire or disk: COMPOSITE forms only — the bare
        # 10-digit stamp is a substring of every millisecond timestamp written in that same second,
        # which would turn the live daemon's own housekeeping into a false contamination hit.
        self.needles: list[str] = [
            f"e2e-scope-{STAMP}", f"seed-surfaces-{STAMP}", f"seed-doc-a-{STAMP}", f"seed-doc-b-{STAMP}",
            f"seed-demo-a-{STAMP}", f"seed-demo-b-{STAMP}", f"Seed-surfaces rule {STAMP}", TEST_BRIEF_TOKEN,
            f"Seed-surfaces import {STAMP}", CORPUS_SCOPE, MEMORY_SCOPE_ROOT, f"seed-surfaces memory {STAMP}",
            f"seed-surfaces-proposal-{STAMP}", CAMPAIGN_ID, f"seed-surfaces feedback {STAMP}",
        ]
        self.live_before = snapshot_live_runs()
        self.tmp = Path(mkdtemp(prefix="seed-surfaces-")).resolve()
        self.needles.append(self.tmp.name)
        self.state = self.tmp / "state"
        self.idocs = self.tmp / "idocs"
        self.bus = self.tmp / "bus"
        self.home = self.tmp / "home"
        self.tmpdir = self.tmp / "tmp"
        self.worker = self.tmp / "worker"
        self.wicked_home = self.tmp / "wicked-home"
        self.npm_cache = self.tmp / "npm-cache"
        self.workflows = self.tmp / "workflows"
        self.inbox = self.tmp / "steering-inbox"
        self.repo_root = self.tmp / "repo"
        for d in (self.state, self.idocs, self.bus, self.home, self.tmpdir, self.worker, self.wicked_home,
                  self.npm_cache / "_npx", self.workflows, self.inbox):
            d.mkdir(parents=True, exist_ok=True)
        self.port = free_port()
        global ORIGIN, API
        ORIGIN = f"http://127.0.0.1:{self.port}"
        API = f"{ORIGIN}/api/v1"
        self.env = self.build_env()

    # ── environment ───────────────────────────────────────────────────────────
    def build_env(self) -> dict[str, str]:
        """A MINIMAL env from scratch — never `dict(os.environ)`. `PATH` is the one pass-through
        (node/npx/git/wicked-estate/the CLI seats resolve from it) and is recorded as such."""
        return {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(self.home),
            "TMPDIR": str(self.tmpdir), "TMP": str(self.tmpdir), "TEMP": str(self.tmpdir),
            "LANG": os.environ.get("LANG", "en_US.UTF-8"),
            # identity, not paths — git/npm/node `os.userInfo()` fallbacks read these
            "USER": os.environ.get("USER", "seed-surfaces"),
            "LOGNAME": os.environ.get("LOGNAME", os.environ.get("USER", "seed-surfaces")),
            # npm/npx (the bridge spawn): cache pinned into the temp dir, update chatter off, and
            # OFFLINE — the pinned clone is the only source; a cache miss fails the bridge start
            # loudly instead of resolving the spec from the registry (an unpinned bridge).
            "npm_config_cache": str(self.npm_cache),
            "npm_config_offline": "true",
            "npm_config_update_notifier": "false",
            "NO_UPDATE_NOTIFIER": "1",
            # crew + the engine
            "WICKED_HOME": str(self.wicked_home),  # memory store (`${WICKED_HOME}/memory.db`)
            "WICKED_WORKER_HOME": str(self.worker),  # hermetic worker config home (crew#396 idiom)
            "WICKED_CREW_SYSTEM_SETTINGS": str(self.state / "system-settings.json"),
            "WICKED_WORKFLOWS_DIR": str(self.workflows),  # else ~/.config/wicked-core/workflows
            "WICKED_STEERING_INBOX_DIR": str(self.inbox),  # else ~/.wicked/steering-inbox
            "WICKED_MEMORY_EMBEDDER": "hash",
            # the interactive bridge the pool spawns for our root (crew#476: it resolves the crew
            # daemon from WICKED_CREW_API and DEFAULTS TO :7701; it emits on the bus resolved from
            # WICKED_BUS_DATA_DIR — the same default the live daemon consumes when unset)
            "WICKED_INTERACTIVE_ROOT": str(self.idocs),
            "WICKED_CREW_API": ORIGIN,
            "WICKED_BUS_DATA_DIR": str(self.bus),
            # the Rust spools that otherwise append to ~/.something-wicked/{wicked-estate,wicked-apps}
            "WICKED_ESTATE_EMIT_DEADLETTER": str(self.tmp / "estate-emit-deadletter.ndjson"),
            "WICKED_APPS_EMIT_DEADLETTER": str(self.tmp / "apps-emit-outbox.ndjson"),
            # the per-repo code graph the engine hangs off `~/.wicked-estate/repo-graphs` (wicked-core
            # code_graph.rs `repo_graph_root`) — run 5 caught it under the scratch HOME
            "WICKED_ESTATE_REPO_GRAPH_ROOT": str(self.tmp / "repo-graphs"),
        }

    def prepare(self) -> None:
        self.assert_write_targets()
        self.pin_bridge()
        self.clone_repo()

    def assert_write_targets(self) -> None:
        """Every path the daemon (or a child) may write, resolved, must be outside the operator's
        real home and outside ~/.wicked-crew — asserted BEFORE anything starts."""
        if self.port == LIVE_DAEMON_PORT:
            raise SetupFailure("guard", "the free port resolved to :7701 — refusing to collide with the live daemon; rerun")
        targets = {
            "tmp": self.tmp, "HOME": self.home, "TMPDIR": self.tmpdir, "state_home(--db)": self.state,
            "repo_clone": self.repo_root, "npm_config_cache": self.npm_cache,
        }
        for key, value in self.env.items():
            if key.startswith("WICKED_") and value.startswith("/"):
                targets[key] = Path(value)
        resolved = {k: str(Path(p).resolve()) for k, p in targets.items()}
        bad = {k: p for k, p in resolved.items() if under(Path(p), REAL_HOME) or under(Path(p), LIVE_STATE_HOME)}
        self.report["setup"]["write_targets"] = {
            "ok": not bad, "real_home": str(REAL_HOME), "live_state_home": str(LIVE_STATE_HOME),
            "targets": resolved, "env_passthrough": ["PATH", "LANG", "USER", "LOGNAME"],
            "env_keys": sorted(self.env.keys()), "violations": bad,
        }
        if bad:
            raise SetupFailure("guard", f"write targets resolve under the operator's home: {bad}")

    def pin_bridge(self) -> None:
        """Resolve the bridge to an EXACT version from an OFFLINE source, or fail setup. The bridge
        is `npx --yes wicked-interactive@^0.8.1 serve` under the SCRATCH HOME; `resolve_bridge_pin`
        finds the operator's already-resolved `_npx/<hash>` install for exactly that spec, reads the
        INSTALLED version + the tarball integrity from the cache's own lockfile, and requires
        version == `BRIDGE_PINNED_VERSION`. The install is then CLONED (read-only on the source;
        APFS clonefile when available) into the scratch npm cache under the same key, and the
        clone's own package.json is re-read as the recorded version. No cache, a version drift, a
        missing integrity or a failed clone is a SETUP FAILURE — never a registry fallback."""
        t0 = time.time()
        pin = resolve_bridge_pin(REAL_HOME / ".npm" / "_npx", INTERACTIVE_SPEC, BRIDGE_PINNED_VERSION)
        info: dict = {"pinned": BRIDGE_PINNED_VERSION, "spec": INTERACTIVE_SPEC, "offline": True, **pin}
        self.report["setup"]["bridge"] = info
        if pin.get("error"):
            raise SetupFailure("bridge_pin", pin["error"])
        src = Path(pin["path"])
        dst = self.npm_cache / "_npx" / src.name
        try:
            if sys.platform == "darwin":
                subprocess.run(["cp", "-Rc", str(src), str(dst)], check=True, capture_output=True, timeout=300)
            else:
                shutil.copytree(src, dst, symlinks=True)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            info["error"] = f"cloning the pinned bridge cache failed: {str(e)[:300]}"
            raise SetupFailure("bridge_pin", info["error"]) from e
        try:
            cloned = json.loads((dst / "node_modules" / "wicked-interactive" / "package.json").read_text())["version"]
        except (OSError, json.JSONDecodeError, KeyError) as e:
            info["error"] = f"the scratch clone carries no readable wicked-interactive/package.json: {e}"
            raise SetupFailure("bridge_pin", info["error"]) from e
        info.update(scratch_path=str(dst), cloned_version=cloned)
        if cloned != BRIDGE_PINNED_VERSION:
            info["error"] = f"the scratch clone is wicked-interactive {cloned}, not the pinned {BRIDGE_PINNED_VERSION}"
            raise SetupFailure("bridge_pin", info["error"])
        # BYTES: the clone must be the pinned install (sha256 per file vs the source; no escaping
        # symlink), tied to the lockfile integrity through the cached tarball when the operator's
        # cacache still holds it, else through npm's hidden lockfile — `verify_bridge_clone` says which.
        verification = verify_bridge_clone(src, dst, str(pin["integrity"]), REAL_HOME / ".npm" / "_cacache", scratch=self.tmp)
        info["clone_verification"] = verification
        if verification.get("error"):
            info["error"] = f"the scratch clone could not be verified as the pinned bridge: {verification['error']}"
            raise SetupFailure("bridge_pin", info["error"])
        # npx resolves the RANGE against the registry manifest even with a warm `_npx` install (an
        # `--offline` run without it fails ENOTCACHED). Seed the operator's CACHED manifest into the
        # scratch cache and prove the range resolves to the pin from THAT frozen snapshot — then the
        # daemon's `npm_config_offline=true` makes any other resolution impossible, not just unlikely.
        manifest = seed_registry_manifest(REAL_HOME / ".npm", self.npm_cache, "wicked-interactive")
        info["registry_manifest"] = manifest
        if manifest.get("error"):
            info["error"] = manifest["error"]
            raise SetupFailure("bridge_pin", info["error"])
        resolves_to = caret_max(manifest["versions"], INTERACTIVE_SPEC)
        manifest["resolves_to"] = resolves_to
        if resolves_to != BRIDGE_PINNED_VERSION:
            info["error"] = (f"the cached registry manifest ({manifest.get('cached_at')}) resolves {INTERACTIVE_SPEC} to {resolves_to!r}, not the pinned "
                             f"{BRIDGE_PINNED_VERSION} — the bridge would not be the certified one")
            raise SetupFailure("bridge_pin", info["error"])
        self._cacache_blobs_seeded = self._cacache_blobs()
        info.update(seconds=round(time.time() - t0, 1), cacache_blobs_seeded=len(self._cacache_blobs_seeded))

    def _cacache_blobs(self) -> set[str]:
        """Every content blob in the scratch npm cache — a NEW one after the bridge started means npm
        fetched something (a registry resolution the pin forbids)."""
        root = self.npm_cache / "_cacache" / "content-v2"
        if not root.is_dir():
            return set()
        return {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}

    def clone_repo(self) -> None:
        """The registered repository: a LOCAL CLONE of this checkout at HEAD, inside the temp dir.
        This checkout is a linked worktree; a run's own `git worktree add` from inside it would
        register under the MAIN checkout's .git/worktrees — which must stay untouched."""
        clone = subprocess.run(
            ["git", "clone", "--quiet", "--local", str(REPO), str(self.repo_root)],
            capture_output=True, text=True, timeout=120,
        )
        if clone.returncode != 0:
            raise SetupFailure("repo_clone", f"git clone failed: {clone.stderr[-800:]}")
        head = subprocess.run(["git", "-C", str(self.repo_root), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
        # wicked-studio TRACKS `.codegraph/estate.db` (a code graph of the main checkout); onboarding
        # indexes into exactly that path and its collision guard refuses a graph naming another root.
        inherited_graph = self.repo_root / ".codegraph"
        shutil.rmtree(inherited_graph, ignore_errors=True)
        self.report["setup"]["repo_clone"] = {
            "ok": True, "root": str(self.repo_root), "head": head, "source": str(REPO),
            "inherited_codegraph_removed": not inherited_graph.exists(),
        }

    # ── daemon ────────────────────────────────────────────────────────────────
    def _pump(self, stream, q: queue.Queue, startup: list[bool]) -> None:
        """Reader thread: every line to the log file; during startup a copy onto the queue. The
        main thread never blocks on the pipe, so a silent daemon cannot hang the deadline."""
        for line in stream:
            self.daemon_log.write(line)
            self.daemon_log.flush()  # a killed run must still leave a readable daemon log behind
            if startup[0]:
                q.put(line)
        q.put(None)

    def start_daemon(self) -> None:
        args = [
            *crew_command(), "serve",
            "--port", str(self.port),
            "--db", str(self.state / "core.db"),
            "--no-interactive-draft-events",
            "--no-interactive-edit-events",
            "--no-interactive-chat-events",
            "--no-interactive-demo-events",
        ]
        self.daemon_log = open(self.tmp / "daemon.log", "w", encoding="utf-8")  # noqa: SIM115 — lives as long as the daemon
        self.daemon_started_at = time.time()
        self.daemon = subprocess.Popen(
            args, cwd=self.tmp, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,  # its own process group: the leader's pid is the group we tear down
        )
        q: queue.Queue = queue.Queue()
        startup = [True]
        threading.Thread(target=self._pump, args=(self.daemon.stdout, q, startup), daemon=True).start()
        ready_line = None
        eof = False
        deadline = time.monotonic() + STARTUP_TIMEOUT_S
        while ready_line is None and not eof:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                line = q.get(timeout=remaining)
            except queue.Empty:
                break
            if line is None:
                eof = True
            elif "WICKED_CREW_READY" in line:
                ready_line = line
        startup[0] = False
        if ready_line is None:
            stopped = stop_process_group(self.daemon)
            tail = self._log_tail()
            raise SetupFailure("daemon", f"no WICKED_CREW_READY within {STARTUP_TIMEOUT_S}s "
                               f"({'daemon exited' if eof else 'deadline'}; stop={stopped}); daemon.log tail: {tail}")
        ready = json.loads(ready_line.split("WICKED_CREW_READY", 1)[1])
        if ready.get("stub") is not False:
            raise SetupFailure("daemon", f"daemon reports stub={ready.get('stub')!r} — the seed suite requires a REAL engine")
        _, health = api("GET", "/health")
        _, diagnostics = api("GET", "/diagnostics")
        _, roster = api("GET", "/roster")
        self.report["setup"]["daemon"] = {
            "ok": True, "origin": ORIGIN, "pid": self.daemon.pid, "process_group": self.daemon.pid, "stub": False, "ready": ready,
            "isolation": {
                **{k: v for k, v in self.env.items() if k.startswith("WICKED_") or k.startswith("npm_") or k in ("HOME", "TMPDIR")},
                "interactive_agent_events": "disabled (--no-interactive-{draft,edit,chat,demo}-events)",
                "governed_scenario": "enabled" if GOVERNED_ENABLED else "disabled (SEED_GOVERNED=0)",
            },
        }
        self.report["setup"]["versions"] = {
            "crew": health.get("version") if isinstance(health, dict) else None,
            "components": diagnostics.get("components") if isinstance(diagnostics, dict) else None,
            "python_playwright": metadata.version("playwright"),
            "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
        }
        self.report["setup"]["roster_signed_in"] = (
            {seat["key"]: seat.get("signed_in") for seat in roster.get("roster", [])} if isinstance(roster, dict) else None
        )
        self._diagnostics = diagnostics

    def _log_tail(self, n: int = 3000) -> str:
        try:
            return (self.tmp / "daemon.log").read_text(encoding="utf-8", errors="replace")[-n:]
        except OSError:
            return "(no daemon.log)"

    def build_identity(self) -> None:
        """The served studio bundle must BE this checkout's build — by BYTES, not by version label.
        The served `index.html` and every `/assets/*` it references are fetched and SHA-256'd, and
        each must equal the same path under THIS worktree's `dist/` (`npm run build`). Both hash sets
        land in the report; a mismatch, a missing asset, or no `dist/` is a setup failure (the
        results would describe some other revision). The version label is recorded, not trusted."""
        pkg = json.loads((REPO / "package.json").read_text())["version"]
        served_label = None
        if isinstance(self._diagnostics, dict):
            served_label = (self._diagnostics.get("components") or {}).get("studioBundle")
        dist_dir = REPO / "dist"
        dist: dict[str, str] = {}
        dist_mtime: str | None = None
        if (dist_dir / "index.html").is_file():
            for p in [dist_dir / "index.html", *sorted((dist_dir / "assets").glob("*"))]:
                if p.is_file():
                    dist[str(p.relative_to(dist_dir))] = hashlib.sha256(p.read_bytes()).hexdigest()
            dist_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime((dist_dir / "index.html").stat().st_mtime))
        st, html = fetch("/")
        text = html.decode(errors="replace")
        assets = sorted(set(re.findall(r'(?:src|href)="/(assets/[^"]+)"', text)))
        served: dict[str, str] = {"index.html": hashlib.sha256(html).hexdigest()} if st == 200 else {}
        served_status: dict[str, int] = {"index.html": st}
        for a in assets:
            ast, body = fetch(f"/{a}")
            served_status[a] = ast
            if ast == 200:
                served[a] = hashlib.sha256(body).hexdigest()
        mismatches = compare_build(dist, served)
        for a, ast in served_status.items():
            if ast != 200:
                mismatches.append(f"{a}: HTTP {ast}")
        git_head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
        src_dirty = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--", "src", "package.json", "vite.config.ts"], capture_output=True, text=True).stdout.strip()
        info = {
            "ok": not mismatches, "method": "sha256 of served index.html + referenced assets == this worktree's dist/ bytes",
            "studio_repo_package": pkg, "studio_bundle_served_label": served_label, "label_matches": served_label == pkg,
            "worktree_head": git_head, "worktree_src_uncommitted_changes": src_dirty or None,
            "dist_present": bool(dist), "dist_built_at": dist_mtime, "dist_sha256": dist,
            "served_status": served_status, "served_sha256": served, "mismatches": mismatches,
        }
        self.report["setup"]["build_identity"] = info
        if mismatches:
            raise SetupFailure("build_identity", "the served studio bundle is not this worktree's dist/ build: " + "; ".join(mismatches)
                               + " — the results would not describe this revision (build with `npm run build`, then rerun)")

    # ── substitute producer (memories / proposals have no UI author path) ─────────
    def estate_tool(self, tool: str, args: dict, timeout_s: int = 60) -> dict:
        """Call one estate MCP tool the way crew does (`core/estate-mcp-client.js`: spawn
        `wicked-estate-mcp` per call, initialize → initialized → tools/call, one JSON frame per line)
        — with the RIG's hermetic env and `WICKED_MEMORY_DB` pinned INTO the temp dir, so the seed
        lands in exactly the store the daemon's `/memory*` and `/proposals*` routes read. Refuses to
        run unless that path resolves under the temp dir."""
        memory_db = Path(self.env["WICKED_HOME"]) / "memory.db"
        if not under(memory_db.resolve(), self.tmp):
            raise RuntimeError(f"substitute producer refused: memory store {memory_db} is not under the temp dir {self.tmp}")
        exe = shutil.which("wicked-estate-mcp", path=self.env["PATH"])
        if exe is None:
            raise RuntimeError("wicked-estate-mcp is not on PATH — the substitute producer needs the same binary crew spawns")
        env = {**self.env, "WICKED_MEMORY_DB": str(memory_db)}
        frames = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "seed-surfaces-suite", "version": STAMP}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": args}},
        ]
        proc = subprocess.run([exe], input="".join(json.dumps(f) + "\n" for f in frames), capture_output=True, text=True,
                              env=env, cwd=str(self.tmp), timeout=timeout_s)
        server_info = None
        result = None
        for line in proc.stdout.splitlines():
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == 1 and isinstance(msg.get("result"), dict):
                server_info = msg["result"].get("serverInfo")
            if msg.get("id") == 2:
                result = msg
        producer = self.report["setup"].setdefault("substitute_producer", {"exe": exe, "memory_db": str(memory_db), "calls": []})
        if server_info and "server" not in producer:
            producer["server"] = server_info
        producer["calls"].append({"tool": tool, "args": args, "exit": proc.returncode})
        if result is None:
            raise RuntimeError(f"{tool}: wicked-estate-mcp gave no id-2 answer (exit {proc.returncode}): {proc.stderr[-400:]}")
        if isinstance(result.get("error"), dict):
            raise RuntimeError(f"{tool}: {result['error'].get('code')} {result['error'].get('message')}")
        content = (result.get("result") or {}).get("content") or []
        text = content[0].get("text") if content and isinstance(content[0], dict) else None
        payload = json.loads(text) if isinstance(text, str) else None
        if (result.get("result") or {}).get("isError"):
            raise RuntimeError(f"{tool}: tool error {text}")
        if not isinstance(payload, dict):
            raise RuntimeError(f"{tool}: result was not a JSON object: {text!r}")
        return payload

    # ── campaign fixture (TST-2) — the engine's own row, no governed run ────────────
    def seed_campaign_record(self, cid: str, name: str, project_id: str, repo_ref: str) -> dict:
        """Write ONE campaign into the scratch engine store exactly the way the engine persists it —
        without `POST /campaigns`, whose only implementation (`adapter.launchCampaign`) LAUNCHES the
        campaign (every node dispatches a governed run). `wicked_core::campaign::persist` →
        `put_node` → the estate `nodes` row {kind `{"other":"campaign"}`, language `wicked-apps`,
        file `campaign/<id>`, `data` = the Node JSON whose `metadata` IS the serialized `Campaign`}
        with its symbol `wicked-apps synthetic campaign/<id>:` interned in `symbols`. The row layout
        is MIRRORED from the `project` node the daemon itself wrote for `project_id` (same table,
        same columns, same encodings) — so a store-schema drift shows up as a seed that the daemon
        does not list (⇒ TST-2 FAILS `campaign-seed-missing` with this record), never as a silently
        wrong row; a write that raises (a corrupt store, no sibling row) FAILS `campaign-seed-write-failed`. The
        campaign is TERMINAL (`cancelled`, its one node `cancelled`) so the scheduler never touches
        it; its node's `run_spec.repo_ref` is Project A's repo — the only project attribution the
        engine's `CampaignDef` can carry today (no campaign-level project id; `POST /campaigns
        {projectId}` fans over the project's repos exactly like this)."""
        db = self.state / "core.db"
        assert under(db.resolve(), self.tmp), f"refusing to write a store outside the temp dir: {db}"
        campaign = {
            "id": cid, "def_id": cid, "status": "cancelled",
            "def": {
                "id": cid, "name": name,
                "nodes": [{"node_id": "n1", "run_spec": {
                    "problem": f"{name}: seed-surfaces campaign fixture — never dispatched (terminal on write)",
                    "clis": [], "entity_mode": "shared", "human_confirm": "none", "repo_ref": repo_ref, "workflow_id": None,
                }}],
                "edges": [], "policy": "continue_independent", "max_concurrency": 1,
            },
            "node_status": {"n1": "cancelled"}, "node_run_id": {}, "node_attempt": {},
            "pending_decision_amend": {}, "pending_failure_gates": [], "fail_fast_tripped": False,
        }
        record: dict = {"method": "mirror of the daemon's own `project` node row in the scratch estate store", "db": str(db), "campaign_id": cid,
                        "engine_writer": "wicked_core::campaign::persist → put_node → estate `nodes` + `symbols` (core-ts campaign_list reads via open_store_ro + find_symbols)"}
        con = sqlite3.connect(str(db), timeout=15)
        con.row_factory = sqlite3.Row
        try:
            con.execute("PRAGMA busy_timeout=15000")
            cols = [r[1] for r in con.execute("PRAGMA table_info(nodes)")]
            tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            record.update(nodes_columns=cols, has_symbols_table="symbols" in tables, journal_mode=con.execute("PRAGMA journal_mode").fetchone()[0])
            sibling = con.execute("SELECT * FROM nodes WHERE name=? AND kind LIKE '%project%'", (project_id,)).fetchone()
            if sibling is None:
                raise RuntimeError(f"no `project` node row for {project_id} in {db} — nothing to mirror (kinds present: "
                                   f"{[r[0] for r in con.execute('SELECT DISTINCT kind FROM nodes')]})")
            data = json.loads(sibling["data"])
            old_tag, new_tag = f"project/{project_id}", f"campaign/{cid}"
            sym_old = str(data.get("symbol"))
            if old_tag not in sym_old or "project" not in json.dumps(data.get("kind")):
                raise RuntimeError(f"the sibling row does not have the expected synthetic layout: symbol={sym_old!r} kind={data.get('kind')!r}")
            sym_new = sym_old.replace(old_tag, new_tag)
            node = dict(data)
            node["symbol"] = sym_new
            node["name"] = cid
            node["kind"] = json.loads(json.dumps(data["kind"]).replace('"project"', '"campaign"'))
            loc = data.get("location")
            if isinstance(loc, dict):
                node["location"] = {k: (v.replace(old_tag, new_tag) if isinstance(v, str) else v) for k, v in loc.items()}
            node["metadata"] = campaign
            values = {c: sibling[c] for c in cols}
            values.update(name=cid, kind=sibling["kind"].replace('"project"', '"campaign"'), data=json.dumps(node))
            if "file" in values and isinstance(values["file"], str):
                values["file"] = values["file"].replace(old_tag, new_tag)
            if "symbols" in tables:
                con.execute("INSERT INTO symbols(sym) VALUES (?)", (sym_new,))
                sid = con.execute("SELECT sid FROM symbols WHERE sym=?", (sym_new,)).fetchone()[0]
                sym_cols = {r[1] for r in con.execute("PRAGMA table_info(symbols)")}
                if "had_node" in sym_cols:
                    con.execute("UPDATE symbols SET had_node=1 WHERE sid=?", (sid,))
                values["symbol"] = sid
                record["sid"] = sid
            else:
                values["symbol"] = sym_new
            con.execute(f"INSERT INTO nodes({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", [values[c] for c in cols])
            con.commit()
            record.update(symbol=sym_new, kind=values["kind"], file=values.get("file"), status="cancelled", repo_ref=repo_ref, written=True)
        finally:
            con.close()
        self.report["setup"]["campaign_seed"] = record
        return record

    def register_repo(self, *, post: Callable[..., tuple[int, object]] | None = None, wait: Callable[[str, int], str] | None = None) -> dict:
        """Setup, over the API — labelled. Registration launches the built-in `onboarding` workflow:
        two TOOL phases (`wicked-estate index`, `wicked-estate clusters`), no agent, no council.
        Setup SUCCEEDS only when that run reports `completed` within `ONBOARD_TIMEOUT_S` (codex r5 #5):
        no `onboardRunId`, a `failed`/`cancelled` run, or one still `running` at the deadline is a
        `SetupFailure` (`repo_register`, `ok: false`) — the scenarios need an indexed repo, and a
        half-onboarded one would describe some other fixture. `post`/`wait` are injectable for the
        self-tests; the suite uses `api` and `wait_terminal`."""
        post = post or api
        wait = wait or wait_terminal
        status, registered = post("POST", "/repos", {"name": f"seed-surfaces-{STAMP}", "rootPath": str(self.repo_root)})
        if status != 201 or not isinstance(registered, dict):
            raise SetupFailure("repo_register", f"POST /repos → {status} {registered}")
        self.repo_id = registered["repo"]["id"]
        self.needles.append(self.repo_id)
        onboard_run = registered.get("onboardRunId")
        record: dict = {
            "ok": False, "substitute": "API — harness setup, not a certified journey",
            "repo_id": self.repo_id, "onboard_run": onboard_run, "onboard_status": None,
            "onboard_workflow": "onboarding (tool phases only: estate index → clusters)", "onboard_deadline_s": ONBOARD_TIMEOUT_S,
        }
        self.report["setup"]["repo_register"] = record
        if not isinstance(onboard_run, str) or not onboard_run:
            record["error"] = f"POST /repos answered 201 without an `onboardRunId` ({str(registered)[:200]}) — onboarding was not launched; the repo is not indexed"
            raise SetupFailure("repo_register", record["error"])
        onboard_status = wait(onboard_run, ONBOARD_TIMEOUT_S)
        record["onboard_status"] = onboard_status
        if onboard_status != "completed":
            still = "still" if onboard_status not in TERMINAL_STATUSES else "ended"
            record["error"] = (f"onboarding run {onboard_run} {still} {onboard_status!r} after {ONBOARD_TIMEOUT_S}s — setup requires `completed` "
                               f"(a repo whose index/clusters never landed is not the fixture the scenarios describe)")
            raise SetupFailure("repo_register", record["error"])
        record["ok"] = True
        return record

    def start_fixture_server(self) -> None:
        """A local fixture page for the demo wizard's target URL (the wizard requires http(s); the
        page is never fetched by anything in this suite because demo authoring is disabled)."""
        class _Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *_args) -> None:  # keep stdout JSON-clean
                pass

        port = free_port()
        self.fixture_httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(_Quiet, directory=str(FIXTURES)))
        threading.Thread(target=self.fixture_httpd.serve_forever, daemon=True).start()
        self.fixture_url = f"http://127.0.0.1:{port}/doc-fixture.html"

    # ── teardown ──────────────────────────────────────────────────────────────
    def daemon_alive(self) -> bool:
        return self.daemon is not None and self.daemon.poll() is None

    def cancel_live_runs(self) -> list[dict]:
        """Cancel anything still live on the DISPOSABLE daemon, verifying each response and waiting
        for the terminal state — so the group stop below is a stop, not an interruption."""
        cancelled: list[dict] = []
        if not self.daemon_alive():
            return cancelled
        try:
            views = list_runs()
        except Exception as e:  # noqa: BLE001 — a dead daemon has nothing to cancel
            return [{"error": f"GET /runs failed: {e}"}]
        for view in views:
            rid = view["session"]["id"]
            if view["session"]["status"] in TERMINAL_STATUSES:
                continue
            entry: dict = {"run": rid, "before": view["session"]["status"]}
            try:
                st, body = api("POST", f"/runs/{quote(rid)}/cancel", timeout=30)
                entry.update(status_code=st, response=body)
                entry["accepted"] = st == 200
                entry["final"] = wait_terminal(rid, 30)
                entry["verified_terminal"] = entry["final"] in TERMINAL_STATUSES
            except Exception as e:  # noqa: BLE001
                entry["error"] = str(e)[:300]
            cancelled.append(entry)
        return cancelled

    def stop_bridge(self, *, processes: Callable[..., dict] | None = None, terminate: Callable[[list[int]], dict] | None = None,
                    lock_reader: Callable[[Path], tuple[dict | None, str]] | None = None) -> dict:
        """The pool spawns the bridge DETACHED (its own group), so the daemon's group stop does not
        reach it. Identify it by command line + VERIFIED start time, TERMINATE, then cross-check the
        advisory lock — never signal a pid the identity check did not produce (`plan_bridge_stop`
        decides; it is pure and self-tested). A failed `ps` signals NOTHING beyond the daemon group
        we spawned (`enumeration_failed`); an alive lock pid nobody identified is `unidentified_alive`
        — both are verdict failures. An identified bridge that did not run from the scratch clone of
        the pinned version is `not_from_pinned_cache`. The lock's `pid` is TYPE-VALIDATED before any
        set membership (a list/str/bool pid is `lock_pid_invalid` — a verdict failure — and the
        identified processes are still stopped); a lock that cannot be DECODED (invalid UTF-8, not
        JSON, a raising reader) is `lock_unreadable` — a verdict failure — and, because the terminate
        already happened, never a running bridge (codex r6 #2). `processes`/`terminate`/`lock_reader`
        are injectable for the self-tests; the suite runs the real `bridge_processes` /
        `terminate_pids` / `read_bridge_lock`."""
        processes = processes or bridge_processes
        terminate = terminate or terminate_pids
        lock_reader = lock_reader or read_bridge_lock
        info: dict = {}
        found = processes(self.idocs, self.daemon_started_at or self.run_started_at)
        procs = found["identified"]
        identified = {p["pid"] for p in procs}
        # TERMINATE FIRST (codex r5 #1, r6 #2): every identified pid is signalled BEFORE the advisory
        # lock is read and before any metadata is inspected — `plan_bridge_stop`'s pid set never
        # depends on the lock (the lock can only ADD a failure, never a pid), so nothing that the lock
        # or the inspection does afterwards can leave the detached bridge running.
        pids, _lock_free_plan = plan_bridge_stop(found, None, self.idocs)
        if pids:
            info["terminated"] = terminate(pids)
        try:
            lock, lock_state = lock_reader(self.idocs)
        except Exception as e:  # noqa: BLE001 — a lock reader raise is a FINDING (verdict failure), never a skipped teardown
            lock, lock_state = None, f"unreadable: {type(e).__name__}: {str(e)[:200]}"
        if str(lock_state).startswith("unreadable"):
            info["lock_unreadable"] = (f"the advisory .wi-serve.json could not be decoded ({lock_state}) — the lock was IGNORED; the "
                                       f"{len(identified)} identified process(es) {sorted(identified)} had already been terminated before it was read")
        lock_pid_raw = lock.get("pid") if lock else None
        lock_pid: int | None = lock_pid_raw if valid_pid(lock_pid_raw) else None
        brief = lambda p: {"pid": p["pid"], "pgid": p["pgid"], "ppid": p["ppid"], "started_at": p["started_at"], "command": p["command"][:200]}  # noqa: E731
        info.update(
            lock=lock_state, lock_pid=lock_pid_raw if isinstance(lock_pid_raw, (int, str, float, bool, type(None))) else repr(lock_pid_raw),
            lock_pid_valid=lock_pid is not None,
            ps_ok=found["ps_ok"], ps_error=found["ps_error"],
            identified=[brief(p) for p in procs],
            unverified=[brief(p) for p in found["unverified"]],
            lock_pid_matches_identified=lock_pid is not None and lock_pid in identified,
        )
        if lock is not None and "pid" in lock and lock_pid is None:
            info["lock_pid_invalid"] = (f"the advisory .wi-serve.json names pid {lock_pid_raw!r} ({type(lock_pid_raw).__name__}), not a positive integer — "
                                        f"the lock was IGNORED for signalling; the {len(identified)} independently identified process(es) {sorted(identified)} were still stopped")
        # The lock-AWARE plan adds the `unidentified_alive` cross-check; by construction it names the
        # same pids — any pid it would add beyond the ones already signalled is signalled now (defensive).
        pids_aware, plan = plan_bridge_stop(found, lock_pid, self.idocs)
        info.update(plan)
        late = [p for p in pids_aware if p not in pids]
        if late:
            info["terminated_after_lock"] = terminate(late)
        try:
            self._inspect_pinned_clone_at_teardown(info, procs, identified, lock)
        except Exception as e:  # noqa: BLE001 — the inspection failing is a FINDING (verdict failure), never a skipped teardown
            info["pinned_clone_inspection_error"] = f"{type(e).__name__}: {e}"
            info["not_from_pinned_cache"] = "; ".join(x for x in (info.get("not_from_pinned_cache"),
                                                                 f"the pinned-clone inspection at teardown raised {type(e).__name__}: {e} — the bridge's provenance could not be confirmed") if x)
        return info

    def _inspect_pinned_clone_at_teardown(self, info: dict, procs: list[dict], identified: set[int], lock: dict | None) -> None:
        """AFTER termination: did the identified bridge run from the scratch clone of the pinned version,
        is the clone still that version, did npm fetch anything? Every read is guarded — an unreadable
        or malformed answer is recorded as a `not_from_pinned_cache` problem (a verdict failure), so
        nothing here can raise past `stop_bridge` except a genuine harness bug (which `stop_bridge`
        records too)."""
        bridge_setup = self.report["setup"].get("bridge") or {}
        scratch_key = bridge_setup.get("scratch_path") if isinstance(bridge_setup, dict) else None
        lock_version = lock.get("version") if isinstance(lock, dict) else None
        info["lock_version"] = lock_version if isinstance(lock_version, (str, int, float, bool, type(None))) else repr(lock_version)
        if not (procs and scratch_key):
            return
        problems: list[str] = []
        if lock_version is not None and str(lock_version) != BRIDGE_PINNED_VERSION:
            problems.append(f"the running bridge reports version {lock_version!r} in its lock, not the pinned {BRIDGE_PINNED_VERSION}")
        from_clone = [p["pid"] for p in procs if str(scratch_key) in str(p.get("command", ""))]
        info["ran_from_pinned_clone"] = from_clone
        if not from_clone:
            problems.append(f"none of the identified bridge processes {sorted(identified)} run from the pinned scratch clone {scratch_key} "
                            f"— commands: {[str(p.get('command', ''))[:160] for p in procs]}")
        now_version = read_package_version(Path(str(scratch_key)) / "node_modules" / "wicked-interactive" / "package.json")
        info["pinned_clone_version_at_teardown"] = now_version
        if now_version != BRIDGE_PINNED_VERSION:
            problems.append(f"the scratch clone is wicked-interactive {now_version!r} at teardown, not the pinned {BRIDGE_PINNED_VERSION} (npx re-installed, or the package metadata is unreadable)")
        try:
            added = sorted(self._cacache_blobs() - getattr(self, "_cacache_blobs_seeded", set()))
        except OSError as e:
            added = []
            problems.append(f"the scratch npm cache could not be enumerated at teardown ({type(e).__name__}: {e}) — whether npm fetched anything is unknown")
        info["cacache_blobs_added_during_run"] = added
        if added:
            problems.append(f"npm fetched {len(added)} new content blob(s) into the scratch cache during the run (a registry resolution): {added[:5]}")
        if problems:
            info["not_from_pinned_cache"] = "; ".join(problems)

    def scratch_writes(self, base: Path, cap: int = 400) -> list[str]:
        """What landed under a scratch dir (informational — the HOME-WRITES finding). Uses the
        explicit walk; enumeration errors are recorded on the teardown record, never raised, so this
        inspection can never block the steps after it."""
        out: list[str] = []
        errors: list[dict] = []
        if not base.exists():
            return out
        for p, _ent in walk_files(base, errors):
            out.append(str(p.relative_to(self.tmp)))
            if len(out) >= cap:
                out.append("… (truncated)")
                break
        if errors:
            self.report["setup"].setdefault("teardown", {}).setdefault("scratch_writes_errors", []).extend(errors[:20])
        return sorted(out)

    def scan_operator_state(self, *, snapshot: Callable[[], dict] | None = None, roots: tuple[Path, ...] | list[Path] | None = None,
                            state_home: Path | None = None) -> dict:
        """Re-derive isolation: every file under the operator-global wicked stores that was modified
        DURING this run is byte-scanned for this run's identifiers; entries stamped by this run under
        ~/.wicked-crew are listed; the live :7701 run ids are diffed. The live-daemon leg is only a
        proof while BOTH snapshots succeeded: a baseline that answered and a final snapshot that did
        not (connection refused, non-200, non-list) is `observation_lost` — a verdict failure, since
        "no new run id" cannot be read off a failed listing. `snapshot`/`roots`/`state_home` are
        injectable for the self-tests; the suite uses the real ones."""
        snapshot = snapshot or snapshot_live_runs
        roots = OPERATOR_STATE_ROOTS if roots is None else roots
        state_home = LIVE_STATE_HOME if state_home is None else state_home
        needles = [n.encode() for n in dict.fromkeys(self.needles) if n]
        since = self.run_started_at
        tree = scan_tree(roots, since, needles)
        modified, hits = tree["modified"], tree["hits"]
        # Stamped ENTRY NAMES under ~/.wicked-crew (files and directories) — the same explicit walk;
        # a directory the walk cannot open is a scan error (the proof is incomplete), never silence.
        stamped: list[str] = []
        if state_home.is_dir():
            name_errors: list[dict] = []
            stack = [state_home]
            while stack:
                d = stack.pop()
                try:
                    with os.scandir(d) as it:
                        entries = list(it)
                except OSError as e:
                    name_errors.append({"file": str(d), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}", "stage": "scandir"})
                    continue
                for ent in entries:
                    if any(n in ent.name for n in self.needles):
                        stamped.append(str(Path(ent.path).relative_to(state_home)))
                    try:
                        if ent.is_dir(follow_symlinks=False):
                            stack.append(Path(ent.path))
                    except OSError as e:
                        name_errors.append({"file": str(ent.path), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}", "stage": "entry"})
            tree["scan_errors"].extend(name_errors)
            stamped.sort()
        live_after = snapshot()
        before_reachable = self.live_before.get("reachable") is True
        after_reachable = live_after.get("reachable") is True
        new_live = sorted(set(live_after.get("run_ids") or []) - set(self.live_before.get("run_ids") or []))
        ours_on_live = [
            rid for rid in new_live
            if any(n in (live_after.get("problems") or {}).get(rid, "") for n in self.needles)
        ]
        return {
            "roots": [str(r) for r in roots], "needles": list(dict.fromkeys(self.needles)),
            "files_modified_during_run": len(modified), "modified_sample": [scrub_operator_path(p) for p in modified[:20]],
            "attribution": MODIFIED_ATTRIBUTION,
            "scan_errors": tree["scan_errors"],
            "identifier_hits": hits, "stamped_entries_in_live_state_home": stamped,
            "live_7701": {
                "reachable_before": self.live_before.get("reachable"), "reachable_after": live_after.get("reachable"),
                "error_before": self.live_before.get("error"), "error_after": live_after.get("error"),
                "runs_before": len(self.live_before.get("run_ids") or []), "runs_after": len(live_after.get("run_ids") or []),
                "new_run_ids": new_live, "new_runs_carrying_our_identifiers": ours_on_live,
                # The diff is a PROOF only when both snapshots answered; an established observation
                # that is lost at the end invalidates it (verdict failure `live_observation_lost`).
                "observation_lost": before_reachable and not after_reachable,
                "observed": before_reachable and after_reachable,
            },
        }

    def teardown(self, findings: list[str]) -> list[str]:
        """Runs on EVERY exit path. EVERY step runs in its own try/except (`run_teardown_steps`):
        cancel → daemon group → log → bridge → fixture server → scratch-writes inspection →
        isolation scan → temp-dir removal — a raise in any one is recorded (`step_errors`, a
        `teardown_step_raised` failure) and the NEXT step still runs (an inspection failure can
        never keep the temp dir alive). Every failure lands in `findings` and `failures` via
        `teardown_failures` — the verdict reads them. Returns the contamination findings."""
        t: dict = self.report["setup"].setdefault("teardown", {})
        live_touched: list[str] = []

        def _cancel() -> None:
            t["cancelled_runs"] = self.cancel_live_runs()

        def _daemon() -> None:
            if self.daemon is not None:
                t["daemon"] = stop_process_group(self.daemon)
                t["daemon_stopped"] = self.daemon.returncode is not None and t["daemon"]["group_empty"]

        def _log() -> None:
            if self.daemon_log is not None:
                self.daemon_log.close()

        def _bridge() -> None:
            t["bridge"] = self.stop_bridge()

        def _fixture() -> None:
            if self.fixture_httpd is not None:
                self.fixture_httpd.shutdown()

        def _scratch_writes() -> None:
            home_writes = self.scratch_writes(self.home, cap=100_000)
            tmp_writes = self.scratch_writes(self.tmpdir)
            # Per-directory counts survive the list cap: run 6 wrote 391 codex plugin-clone files that
            # pushed the bridge's `.wicked-interactive/instances.json` past a 400-entry list.
            by_dir: dict[str, int] = {}
            for p in home_writes:
                parts = p.split("/")
                key = "/".join(parts[1:3]) if len(parts) > 2 else p
                by_dir[key] = by_dir.get(key, 0) + 1
            t["scratch_home_writes"] = home_writes[:400] + (["… (truncated)"] if len(home_writes) > 400 else [])
            t["scratch_home_writes_by_dir"] = dict(sorted(by_dir.items(), key=lambda kv: -kv[1]))
            t["scratch_tmpdir_writes"] = {"count": len(tmp_writes), "sample": tmp_writes[:5]}
            if home_writes:
                # The writes no WICKED_* knob pins today — they would have landed in the operator's real
                # home without the scratch HOME (TMPDIR writes are expected and counted separately).
                findings.append(f"HOME-WRITES: the daemon/bridge/CLIs wrote {len(home_writes)} entries under the scratch HOME "
                                f"(would have landed in the operator's home) — by directory: {t['scratch_home_writes_by_dir']}; "
                                f"plus {len(tmp_writes)} under the scratch TMPDIR")

        def _scan() -> None:
            try:
                scan = self.scan_operator_state()
            except BaseException as e:  # noqa: BLE001 — an un-run scan is a verdict-affecting failure, never a clean bill
                t["isolation_scan_error"] = f"{type(e).__name__}: {e}"
                return
            t["isolation_scan"] = scan
            for e in scan["stamped_entries_in_live_state_home"]:
                live_touched.append(f"~/.wicked-crew/{e} carries this run's stamp")
            for h in scan["identifier_hits"]:
                live_touched.append(f"{h['file']} contains {h.get('needle') or h.get('note')}")
            for rid in scan["live_7701"]["new_runs_carrying_our_identifiers"]:
                live_touched.append(f"live :7701 gained run {rid} carrying this run's identifiers")
            if scan["live_7701"]["new_run_ids"] and not scan["live_7701"]["new_runs_carrying_our_identifiers"]:
                findings.append(f"LIVE-7701: {len(scan['live_7701']['new_run_ids'])} run(s) appeared on the live daemon during this run "
                                f"without this run's identifiers (operator activity, not ours): {scan['live_7701']['new_run_ids']}")
            if scan["live_7701"].get("observation_lost"):
                findings.append(f"LIVE-OBSERVATION-LOST: the live :{LIVE_DAEMON_PORT} daemon answered at baseline but not at the final snapshot "
                                f"({scan['live_7701'].get('error_after')}) — the run-id diff is unproven; the isolation verdict is INVALID")
            elif not scan["live_7701"].get("observed"):
                findings.append(f"LIVE-7701-UNOBSERVED: the live :{LIVE_DAEMON_PORT} daemon did not answer at baseline "
                                f"({scan['live_7701'].get('error_before')}) — the run-id diff leg of the isolation proof was never established")
            if scan["scan_errors"]:
                findings.append(f"LIVE-SCAN-ERROR: {len(scan['scan_errors'])} entr(ies) inside the operator stores could not be inspected — "
                                f"the isolation proof is INCOMPLETE: {scan['scan_errors'][:5]}")

        def _tmp() -> None:
            t["tmp"] = str(self.tmp)
            t["tmp_kept"] = KEEP_TMP
            if not KEEP_TMP:
                try:
                    shutil.rmtree(self.tmp)
                except OSError as e:
                    t["tmp_remove_error"] = f"{type(e).__name__}: {e}"
                t["tmp_removed"] = not self.tmp.exists()

        t["step_errors"] = run_teardown_steps([
            ("cancel_live_runs", _cancel),
            ("stop_daemon_group", _daemon),
            ("close_daemon_log", _log),
            ("stop_bridge", _bridge),
            ("stop_fixture_server", _fixture),
            ("scratch_writes", _scratch_writes),
            ("isolation_scan", _scan),
            ("remove_tmp", _tmp),
        ])
        if "bridge" not in t:
            t["bridge"] = {"error": "stop_bridge raised — see step_errors"}
        if "isolation_scan" not in t and "isolation_scan_error" not in t:
            t["isolation_scan_error"] = "the isolation scan step did not record a result — see step_errors"
        t["failures"] = teardown_failures(t)
        for f in t["failures"]:
            findings.append(f"TEARDOWN: {f}")
        return live_touched


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


def bridge_unavailable_reason(pid: str) -> str | None:
    """The ESTABLISHED environmental cause for a bridge skip: the daemon itself answers 503
    `bridge_unavailable` for the project's interactive proxy. Anything else is a product failure."""
    st, body = api("GET", f"/projects/{quote(pid)}/interactive/api/docs", timeout=90)
    if st == 503 and isinstance(body, dict) and body.get("code") == "bridge_unavailable":
        return str(body.get("hint") or body)
    return None


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
    # satisfied when the modal was opened from another project's shell, so the landing is a
    # project id OTHER than the one we stood in.
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


def ui_add_rule(page, statement: str, unseeded_gap_issue: str | None = None) -> str:
    """The grid's draft row: Add ▾ → Add row → (prefilled PAT-nnn id) → statement → Save.
    `unseeded_gap_issue`: the ONE expected gap — no draft row WHILE the unseeded banner shows."""
    tid(page, "steering-add-menu").click()
    tid(page, "steering-add-open").click()
    draft = tid(page, "steering-grid-draft")
    try:
        draft.wait_for(timeout=5_000)
    except Exception as e:  # noqa: BLE001 — turn the timeout into the finding it is
        unseeded = tid(page, "steering-unseeded").count() > 0
        message = (
            "'Add row' produced no draft row"
            + (" while the UNSEEDED banner is showing" if unseeded else "")
            + " — SteeringPage mounts the grid only when rules exist (`{!unseeded && <SteeringGrid/>}`), "
            "so the banner's own 'Add a row' path cannot author the first rule"
        )
        if unseeded and unseeded_gap_issue:
            raise ExpectedGap(f"{unseeded_gap_issue}: {message}") from e
        raise AssertionError(message) from e
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


def surface_error(page, pid: str, mode: str) -> None:
    """A `*-canvas-error` on a mode surface: a Skip only when the DAEMON reports the bridge
    unavailable (established cause); otherwise a product failure."""
    surface = "doc" if mode == "document" else "video"
    hint = text_of(tid(page, f"{surface}-bridge-hint")) or text_of(tid(page, f"{surface}-error-detail"))
    reason = bridge_unavailable_reason(pid)
    if reason is not None:
        raise Skip(f"the interactive bridge is unavailable on this rig (daemon 503 bridge_unavailable: {reason[:200]}); "
                   f"{mode} surface shows: {hint[:200]}")
    raise AssertionError(f"{mode} surface shows an error while the daemon serves the bridge: {hint[:300]}")


def enter_mode(page, pid: str, mode: str) -> dict:
    """Project dashboard → the mode's door → the mode surface, waiting THROUGH the bridge's cold
    start. Returns what rendered."""
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
        surface_error(page, pid, mode)
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
        surface_error(page, pid, mode)
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


def ui_seed_demo(page, pid: str, demo_name: str, fixture_url: str) -> str:
    enter_mode(page, pid, "video")
    box = composer(page)
    box.fill(demo_name)
    tid(page, "doc-composer-submit").click()
    tid(page, "demo-wizard").wait_for(timeout=15_000)
    tid(page, "wizard-target").fill(fixture_url)
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


PREDATES_DELETE_RE = re.compile(r"predates\s+DELETE\s+/api/docs|answered 404 without the retire wire", re.I)


def delete_capture(page, owner: str, name: str, mode: str, foreign: str | None) -> dict:
    """Everything a REFUSED delete must have left in place, read from the authorities (codex r5 #4):
    the owner's picker (UI), crew's `interactive.doc` membership for the owner AND the foreign project
    (server-side owner record), and the artifact's content — versions head + lineage and the head
    document's bytes (`…/d/:name/doc/:head` — the storyboard for demos). Taken BEFORE the delete and
    again AFTER the wire refused it; `assert_delete_preserved` compares."""
    manifest = doc_versions(owner, name)
    head = manifest.get("head")
    st, html = fetch(f"/api/v1/projects/{quote(owner)}/interactive/d/{quote(name)}/doc/{head}")
    assert st == 200 and html, f"{owner}'s {mode} {name!r} head v{head} → {st} — no content to protect"
    return {
        "owner_picker": picker_ids(page, owner, mode),
        "owner_members": doc_members(owner),
        "foreign_members": doc_members(foreign) if foreign is not None else None,
        "head": head, "lineage": [v.get("version") for v in manifest.get("versions") or []],
        "head_html_sha256": hashlib.sha256(html).hexdigest(),
    }


def assert_delete_preserved(before: dict, after: dict, *, owner: str, foreign: str | None, name: str, mode: str) -> None:
    """BILATERAL preservation after a delete the wire REFUSED — plain assertions, never the excused
    gap (codex r5 #4): the owner still lists AND still owns the artifact, the foreign project still
    does not (and its membership is unchanged), and the content is byte-identical (head, lineage,
    head-document bytes). A refused DELETE that nevertheless dropped the owner record, re-filed the
    artifact, or altered a version is a regression the xfail must NOT excuse."""
    for key in ("owner_picker", "owner_members", "head", "lineage", "head_html_sha256"):
        assert key in before and key in after, f"delete capture lacks {key!r}: before={sorted(before)} after={sorted(after)}"
    assert name in after["owner_picker"], f"the refused delete REMOVED {owner}'s {mode} {name!r} from its own picker ({before['owner_picker']} → {after['owner_picker']})"
    assert name in after["owner_members"], (f"the refused delete dropped crew's owner record: {name!r} is no longer an interactive.doc member of {owner} "
                                            f"({before['owner_members']} → {after['owner_members']})")
    if foreign is not None:
        assert isinstance(after.get("foreign_members"), list), f"no membership read for the foreign project {foreign} after the delete"
        assert name not in after["foreign_members"], f"the refused delete RE-FILED {name!r} under the foreign project {foreign}: {after['foreign_members']}"
        assert after["foreign_members"] == before.get("foreign_members"), f"{foreign}'s membership changed across the refused delete: {before.get('foreign_members')} → {after['foreign_members']}"
    assert (after["head"], after["lineage"]) == (before["head"], before["lineage"]), (
        f"{owner}'s {mode} {name!r} lineage changed across the refused delete: head {before['head']} → {after['head']}, versions {before['lineage']} → {after['lineage']}")
    assert after["head_html_sha256"] == before["head_html_sha256"], (
        f"{owner}'s {mode} {name!r} head content changed across the refused delete (sha256 {before['head_html_sha256'][:12]}… → {after['head_html_sha256'][:12]}…)")


def refused_delete_gap(before: dict, after: dict, *, owner: str, foreign: str | None, name: str, mode: str, issue: str, message: str) -> None:
    """The ONLY way a delete row may become the studio#213 xfail: the preservation checks hold as
    PLAIN assertions first (a failure there is a FAIL), and only then the delete failure itself is
    raised as the excused `ExpectedGap`. Both delete paths (the CLN-1 cleanup helper and the ISO-D /
    ISO-DD foreign arm) go through here; self-tested through `Suite.run`."""
    assert_delete_preserved(before, after, owner=owner, foreign=foreign, name=name, mode=mode)
    raise ExpectedGap(f"{issue}: {message}")


def ui_delete_doc(page, pid: str, mode: str, name: str, bridge_gap_issue: str, foreign: str | None = None) -> None:
    """Picker 🗑 → confirm → Delete → absent after a REAL reload. The ONE expected gap: crew's own
    sentence that the pinned bridge predates `DELETE /api/docs/:doc` (a `wire` failure rendered in
    `doc-delete-error`, studio#213) — and even then ONLY after the owner's listing + membership and
    the content are re-read and found preserved, and `foreign` (the other project) still does not own
    it (`refused_delete_gap`, codex r5 #4). A bridge-unavailable hint is a skip only when the daemon
    confirms it; a partial delete or any other wire error is a plain failure."""
    before = delete_capture(page, pid, name, mode, foreign)
    assert name in before["owner_picker"], f"{name} not listed under {pid}/{mode} before delete: {before['owner_picker']}"
    assert name in before["owner_members"], f"crew does not file {name!r} under {pid} before the delete (interactive.doc members: {before['owner_members']})"
    tid(page, "doc-delete-trigger", doc_id=name).click()
    tid(page, "doc-delete-confirm").wait_for(timeout=10_000)
    tid(page, "doc-delete-go").click()
    deadline = time.time() + 30
    while time.time() < deadline:
        if tid(page, "doc-delete-error").count() > 0:
            wire = text_of(tid(page, "doc-delete-error"))
            if PREDATES_DELETE_RE.search(wire):
                after = delete_capture(page, pid, name, mode, foreign)
                refused_delete_gap(before, after, owner=pid, foreign=foreign, name=name, mode=mode, issue=bridge_gap_issue,
                                   message=(f"the pinned bridge predates DELETE /api/docs/:doc — {wire[:300]} — preservation held: {pid} still lists + owns "
                                            f"{name!r}, {foreign or 'no other project'} does not, head v{after['head']} / lineage {after['lineage']} / content unchanged"))
            raise AssertionError(f"delete failed on the wire: {wire[:400]}")
        if tid(page, "doc-delete-partial").count() > 0:
            raise AssertionError(f"PARTIAL delete: {text_of(tid(page, 'doc-delete-partial'))[:400]}")
        if tid(page, "doc-delete-bridge-hint").count() > 0:
            hint = text_of(tid(page, "doc-delete-bridge-hint"))
            reason = bridge_unavailable_reason(pid)
            if reason is not None:
                raise Skip(f"bridge unavailable during delete (daemon 503 bridge_unavailable: {reason[:200]}); UI: {hint[:200]}")
            raise AssertionError(f"delete shows a bridge hint while the daemon serves the bridge: {hint[:300]}")
        if tid(page, "doc-delete-confirm").count() == 0:
            break
        page.wait_for_timeout(200)
    after = picker_ids(page, pid, mode)  # a REAL reload of the picker
    assert name not in after, f"{name} still listed under {pid}/{mode} after delete + reload: {after}"


def fetch_with_type(path: str, timeout: int = 30) -> tuple[int, str, bytes]:
    """A raw GET that also reports the Content-Type — the recording probe needs the header."""
    req = urllib.request.Request(f"{ORIGIN}{path}", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", e.read()


def ensure_dock_open(page) -> None:
    """The assist dock's collapse is a persisted preference — open it if the rail is showing."""
    if tid(page, "assist-dock").count() == 0:
        tid(page, "assist-dock-toggle").first.click()
    tid(page, "assist-dock").wait_for(timeout=10_000)


def rule_row_api(rid: str) -> dict | None:
    st, body = api("GET", "/governance/rules")
    assert st == 200 and isinstance(body, dict), f"GET /governance/rules → {st}"
    mine = [r for r in body["rules"] if r["id"] == rid]
    return mine[0] if mine else None


def wait_rule_field(rid: str, field: str, value: object, timeout_s: float = 15) -> dict:
    """Poll the server row until `field` equals `value` (the UI's optimistic cell must be backed by
    the store, not just painted)."""
    deadline = time.time() + timeout_s
    row = rule_row_api(rid)
    while time.time() < deadline and not (row is not None and row.get(field) == value):
        time.sleep(0.5)
        row = rule_row_api(rid)
    assert row is not None, f"{rid} vanished from the store"
    assert row.get(field) == value, f"server row {rid}.{field} = {row.get(field)!r}, expected {value!r} after {timeout_s}s"
    return row


def memory_rows(page) -> list[dict]:
    """The memories browser's rows as (id, scope, content) — read after the panel settled."""
    return tid(page, "memory-row").evaluate_all(
        "els => els.map(e => ({id: e.getAttribute('data-memory-id'), "
        "scope: (e.querySelector('[data-testid=\"memory-scope\"]')?.textContent ?? '').trim(), "
        "content: (e.querySelector('[data-testid=\"memory-content\"]')?.textContent ?? '').trim()}))"
    )


def memories_api(scope_prefix: str) -> list[dict]:
    st, body = api("GET", f"/memory?scope_prefix={quote(scope_prefix, safe='')}")
    assert st == 200 and isinstance(body, dict) and isinstance(body.get("memories"), list), f"GET /memory?scope_prefix={scope_prefix} → {st} {str(body)[:200]}"
    return body["memories"]


def proposals_api(state: str) -> list[dict]:
    st, body = api("GET", f"/proposals?state={state}")
    assert st == 200 and isinstance(body, dict) and isinstance(body.get("proposals"), list), f"GET /proposals?state={state} → {st} {str(body)[:200]}"
    return body["proposals"]


def proposal_section(page, kind: str):
    section = tid(page, "proposals-section", kind=kind)
    section.wait_for(timeout=20_000)
    section.locator('[data-testid="proposals-loading"]').wait_for(state="detached", timeout=20_000)
    assert section.locator('[data-testid="proposals-section-unsupported"]').count() == 0, "this daemon reports the proposal queue as unsupported"
    assert section.locator('[data-testid="proposals-error"]').count() == 0, text_of(section.locator('[data-testid="proposals-error"]'))
    return section


def frame_of(iframe_locator):
    """The Playwright Frame behind an <iframe> locator (srcdoc frames included), loaded."""
    handle = iframe_locator.element_handle(timeout=15_000)
    frame = handle.content_frame()
    assert frame is not None, "the iframe has no content frame"
    frame.wait_for_load_state("load", timeout=30_000)
    return frame


def doc_versions(pid: str, name: str) -> dict:
    st, manifest = api("GET", f"/projects/{quote(pid)}/interactive/d/{quote(name)}/api/versions")
    assert st == 200 and isinstance(manifest, dict), f"versions wire → {st} {str(manifest)[:300]}"
    return manifest


def doc_members(pid: str) -> list[str]:
    """The SERVER-SIDE owner record: crew's project membership. The bridge files every doc/demo it
    creates for a project as an `interactive.doc` member (`POST /projects/:id/members`, project.js
    `bindDocToProject`) — the one authority that says which project a document belongs to."""
    st, detail = api("GET", f"/projects/{quote(pid)}")
    assert st == 200 and isinstance(detail, dict), f"GET /projects/{pid} → {st} {str(detail)[:200]}"
    return sorted(m.get("member_ref") for m in detail.get("members", []) if m.get("member_kind") == "interactive.doc")


def doc_conversation(pid: str, name: str) -> list[dict]:
    st, conv = api("GET", f"/projects/{quote(pid)}/interactive/d/{quote(name)}/api/conversation")
    assert st == 200 and isinstance(conv, list), f"conversation wire → {st} {str(conv)[:200]}"
    return [e for e in conv if isinstance(e, dict)]


def frame_text(frame) -> str:
    return str(frame.evaluate("() => (document.body?.innerText ?? '').trim()"))


def open_panel(page, tab: str) -> None:
    """The right panel starts COLLAPSED once a document owns the canvas (`DocumentCanvas`:
    `panelOpen = useState(docId === null)`), so the thread's `doc-message`s are NOT in the DOM until
    the rail's glyph opens the panel on a tab. Run 8 of this suite asserted the thread while the panel
    was collapsed — the wait could never succeed; every thread read now opens the Chat tab first."""
    if tid(page, "doc-panel", tab=tab).count() == 0:
        tid(page, "panel-rail-tab", tab=tab).click()
    tid(page, "doc-panel", tab=tab).wait_for(timeout=10_000)


THREAD_HAS_TEXT_JS = "t => Array.from(document.querySelectorAll('[data-testid=\"doc-message\"]')).some(m => (m.textContent || '').includes(t))"


def feedback_journey(page, A: str, doc_a: str, B: str, doc_b: str) -> str:
    """FBK-1 — FEEDBACK through the real UI: point at an instrumented block of A's document, choose
    "Change text", type, submit ONE batch. The bridge applies a deterministic `content-edit` ITSELF
    (no agent: `materializeFeedback` → `applyFeedbackItems`) and lands a NEW version whose HTML
    carries the text; the batch is ALSO the thread's user message (`chat.posted` →
    `conversation.jsonl`). Persistence: after a FULL reload the canvas frames the new head with the
    text and the thread (Chat tab opened) rehydrates the message from `GET /api/conversation`.
    Isolation: B's own document shows none of it (thread, lineage, conversation). Module-level so the
    fix-validation probe runs exactly the code the suite runs."""
    before = doc_versions(A, doc_a)
    n_before, head_before = len(before["versions"]), before["head"]
    b_before = doc_versions(B, doc_b)
    goto(page, f"/p/{quote(A)}/document/{quote(doc_a)}")
    canvas = tid(page, "doc-canvas", doc_id=doc_a)
    canvas.wait_for(timeout=BRIDGE_TIMEOUT_MS)
    tid(page, "feedback-overlay").wait_for(timeout=15_000)
    try:
        page.wait_for_function("() => document.querySelector('[data-testid=\"feedback-overlay\"]')?.getAttribute('data-ready') === 'true'", timeout=20_000)
    except Exception as e:  # noqa: BLE001 — the disabled overlay's own reason is the finding
        raise AssertionError("point-and-comment never became ready: the injected instrument bridge did not answer the inventory request "
                             f"(toggle title: {tid(page, 'feedback-toggle').get_attribute('title')!r})") from e
    frame = frame_of(canvas.first)
    target = frame.evaluate(
        "() => { const els = Array.from(document.querySelectorAll('[data-wid]'));"
        " const el = els.find(e => !e.querySelector('[data-wid]') && (e.innerText || '').trim().length > 0);"
        " return el ? { wid: el.getAttribute('data-wid'), text: (el.innerText || '').trim() } : null; }"
    )
    assert target, "the document renders no non-composite instrumented block (`[data-wid]` with text) to comment on"
    # The ORIGINAL click grammar: a click on an instrumented block INSIDE the frame is preempted by
    # the injected bridge and reported (`wid-click`) — the targeted card opens, no mode toggle.
    frame.locator(f'[data-wid="{target["wid"]}"]').first.click()
    card = tid(page, "feedback-comment")
    card.wait_for(timeout=10_000)
    mode = tid(page, "feedback-mode-change-text")
    assert mode.count() == 1, f"'Change text' is not offered for block {target['wid']!r} (the bridge reported no text, or a composite block)"
    mode.click()
    tid(page, "feedback-comment-input").fill(FEEDBACK_TEXT)
    tid(page, "feedback-comment-add").click()
    card.wait_for(state="detached", timeout=10_000)
    assert tid(page, "feedback-pin").count() == 1, f"{tid(page, 'feedback-pin').count()} pins after one comment"
    with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/interactive/api/events"), timeout=30_000) as ack:
        tid(page, "feedback-submit").click()
    ack_status = ack.value.status
    assert 200 <= ack_status < 300, f"the feedback batch was refused: POST /api/events → HTTP {ack_status}"
    assert tid(page, "feedback-error").count() == 0, text_of(tid(page, "feedback-error"))
    deadline = time.time() + 60
    after = doc_versions(A, doc_a)
    while time.time() < deadline and len(after["versions"]) == n_before:
        time.sleep(1)
        after = doc_versions(A, doc_a)
    assert len(after["versions"]) == n_before + 1, f"no new version landed within 60 s of the feedback batch (versions {n_before} → {len(after['versions'])})"
    new_head = after["head"]
    assert new_head != head_before and any(v.get("version") == new_head and v.get("parent") == head_before for v in after["versions"]), f"the new head {new_head} is not a child of {head_before}: {after}"
    st, new_html = fetch(f"/api/v1/projects/{quote(A)}/interactive/d/{quote(doc_a)}/doc/{new_head}")
    assert st == 200 and FEEDBACK_TEXT.encode() in new_html, f"v{new_head} does not carry the typed text (HTTP {st})"
    st, old_html = fetch(f"/api/v1/projects/{quote(A)}/interactive/d/{quote(doc_a)}/doc/{head_before}")
    assert st == 200 and FEEDBACK_TEXT.encode() not in old_html, f"v{head_before} was rewritten in place (write-once violated)"
    # The thread lives in the right panel, which is COLLAPSED while a doc owns the canvas: open Chat.
    open_panel(page, "chat")
    page.wait_for_function(THREAD_HAS_TEXT_JS, arg=FEEDBACK_TEXT, timeout=30_000)
    # Persistence: a FULL reload — canvas at the new head, text rendered, thread rehydrated from the wire.
    goto(page, f"/p/{quote(A)}/document/{quote(doc_a)}")
    canvas = tid(page, "doc-canvas", doc_id=doc_a)
    canvas.wait_for(timeout=BRIDGE_TIMEOUT_MS)
    assert canvas.first.get_attribute("data-version") == str(new_head), f"after reload the canvas frames v{canvas.first.get_attribute('data-version')}, not the new head v{new_head}"
    rendered = frame_text(frame_of(canvas.first))
    assert FEEDBACK_TEXT in rendered, f"the reloaded canvas does not render the edited text: {rendered[:200]!r}"
    open_panel(page, "chat")
    page.wait_for_function(THREAD_HAS_TEXT_JS, arg=FEEDBACK_TEXT, timeout=30_000)
    mine = [e for e in doc_conversation(A, doc_a) if FEEDBACK_TEXT in str(e.get("text", ""))]
    assert mine and mine[0].get("role") == "user", f"GET /api/conversation does not carry the batch as a user message: {mine}"
    # Isolation: Project B's OWN document saw nothing of it (its thread OPENED, so the check is not vacuous).
    goto(page, f"/p/{quote(B)}/document/{quote(doc_b)}")
    tid(page, "doc-canvas", doc_id=doc_b).wait_for(timeout=BRIDGE_TIMEOUT_MS)
    open_panel(page, "chat")
    page.wait_for_load_state("networkidle")
    assert tid(page, "thread").count() == 1, "B's document thread did not render after opening the Chat tab"
    b_thread = tid(page, "doc-message").all_text_contents()
    assert not any(FEEDBACK_TEXT in t for t in b_thread), "Project B's document thread shows A's feedback batch"
    b_after = doc_versions(B, doc_b)
    assert (len(b_after["versions"]), b_after["head"]) == (len(b_before["versions"]), b_before["head"]), f"B's document lineage changed: {b_before} → {b_after}"
    assert not [e for e in doc_conversation(B, doc_b) if FEEDBACK_TEXT in str(e.get("text", ""))], "B's conversation carries A's feedback"
    return (f"feedback on block {target['wid']} of '{doc_a}' (Change text → {FEEDBACK_TEXT[:40]!r}…) submitted as ONE batch (POST /api/events {ack_status}); "
            f"the bridge landed v{new_head} (parent v{head_before}) carrying the text, v{head_before} untouched; the Chat tab shows the batch; after a full reload the canvas "
            f"frames v{new_head} with the text and the thread rehydrates the batch from GET /api/conversation (role user); B's own document ({len(b_thread)} thread messages): "
            f"none carry it, lineage and conversation unchanged")


def compare_journey(page, A: str, doc_a: str) -> str:
    """VIB-CMP — DOCUMENT COMPARISON: two versions of A's document (v_head carries FBK-1's edit, its
    parent does not) side by side through the Compare tab. The lens is split / overlay of two real
    version frames — the product has NO textual diff markers, so the oracle is per-pane CONTENT
    identity: each pane renders exactly its version (the head pane carries the edited text, the parent
    pane does not; the served `/doc/<v>` bytes agree), the comparand selector lists every other
    version, overlay stacks the same two, and exit returns to the solo canvas at the head without
    writing a comparand into the URL (compare is a lens, not an address)."""
    manifest = doc_versions(A, doc_a)
    assert len(manifest["versions"]) >= 2, f"comparison needs two versions; the manifest has {len(manifest['versions'])}"
    head = manifest["head"]
    parent = next(v.get("parent") for v in manifest["versions"] if v.get("version") == head)
    assert isinstance(parent, int), f"the head v{head} has no parent to compare against: {manifest}"
    goto(page, f"/p/{quote(A)}/document/{quote(doc_a)}")
    tid(page, "doc-canvas", doc_id=doc_a).wait_for(timeout=BRIDGE_TIMEOUT_MS)
    open_panel(page, "compare")
    toggle = tid(page, "version-compare-toggle")
    toggle.wait_for(timeout=10_000)
    assert toggle.is_enabled(), f"Compare is disabled: {toggle.get_attribute('title')!r}"
    toggle.click()
    tid(page, "compare-split").wait_for(timeout=15_000)
    tid(page, "compare-controls").wait_for(timeout=10_000)
    panes = tid(page, "compare-pane")
    assert panes.count() == 2, f"{panes.count()} compare panes"
    pane_versions = attr_values(page, "compare-pane", "data-version")
    assert pane_versions == [str(head), str(parent)], f"panes show {pane_versions}, expected [selected v{head}, parent v{parent}]"
    texts = {pane_versions[i]: frame_text(frame_of(panes.nth(i))) for i in range(2)}
    assert texts[str(head)] and texts[str(parent)], f"a pane rendered nothing: {texts}"
    assert FEEDBACK_TEXT in texts[str(head)], f"the head pane (v{head}) does not render the edited text"
    assert FEEDBACK_TEXT not in texts[str(parent)], f"the parent pane (v{parent}) renders the edited text — both panes show the same version"
    st1, h_head = fetch(f"/api/v1/projects/{quote(A)}/interactive/d/{quote(doc_a)}/doc/{head}")
    st2, h_parent = fetch(f"/api/v1/projects/{quote(A)}/interactive/d/{quote(doc_a)}/doc/{parent}")
    assert st1 == 200 and st2 == 200 and FEEDBACK_TEXT.encode() in h_head and FEEDBACK_TEXT.encode() not in h_parent, "the served version bytes disagree with the panes"
    options = tid(page, "compare-vs").locator("option").evaluate_all("els => els.map(e => e.value)")
    assert sorted(options, key=int) == sorted((str(v["version"]) for v in manifest["versions"] if v["version"] != head), key=int), f"comparand options {options}"
    tid(page, "compare-overlay-toggle").click()
    tid(page, "compare-overlay").wait_for(timeout=10_000)
    layers = attr_values(page, "compare-pane", "data-layer")
    assert sorted(layers) == ["top", "under"], f"overlay layers {layers}"
    assert tid(page, "overlay-slider").count() == 1
    overlay_versions = dict(zip(attr_values(page, "compare-pane", "data-layer"), attr_values(page, "compare-pane", "data-version")))
    assert overlay_versions == {"under": str(head), "top": str(parent)}, f"overlay stacks {overlay_versions}"
    tid(page, "compare-exit").click()
    tid(page, "compare-pane").first.wait_for(state="detached", timeout=10_000)
    canvas = tid(page, "doc-canvas", doc_id=doc_a)
    canvas.wait_for(timeout=BRIDGE_TIMEOUT_MS)
    assert canvas.first.get_attribute("data-version") == str(head), "exiting compare did not return to the head"
    assert not re.search(r"[?&](cmp|compare|vs|comparand)=", page.url), f"compare wrote a comparand into the URL: {page.url}"
    return (f"v{head} ↔ v{parent} of '{doc_a}' compared side by side (each pane renders its own version: the head pane carries the FBK-1 text, the parent does not; "
            f"served bytes agree), comparand options {options}, overlay stacks under=v{head}/top=v{parent} with the opacity slider, exit returns to the solo canvas at v{head} "
            f"with no comparand in the URL — the product has no textual diff markers; the lens is split/overlay of the two real version frames")


def campaign_cards(page, pid: str) -> list[str]:
    """`/p/:id/campaigns` → every `campaign-card` id, with the recency window widened to `all` — a
    campaign with no member run is outside every window, and the surface offers it only behind the
    '+N older' chip / the `all` range (never silently gone)."""
    goto(page, f"/p/{quote(pid)}/campaigns")
    tid(page, "project-campaigns", project_id=pid).wait_for(timeout=15_000)
    wait_any(page, ["campaigns-page", "campaigns-unsupported"], 30_000)
    assert tid(page, "campaigns-unsupported").count() == 0, "this daemon has no campaign surface (`GET /campaigns` not served)"
    page.wait_for_load_state("networkidle")
    older = tid(page, "campaigns-show-older")
    if older.count() > 0:
        older.click()
    else:
        all_btn = page.locator('[data-testid="campaigns-filter"] button[data-range="all"]')
        if all_btn.count() > 0 and all_btn.get_attribute("aria-pressed") != "true":
            all_btn.click()
    page.wait_for_load_state("networkidle")
    return attr_values(page, "campaign-card", "data-campaign-id")


def doc_capture(page, pid: str, name: str) -> dict:
    """What the canvas RENDERED (the frame's document) + what the wire says (head, lineage, head
    html bytes) — captured before and after a reload for `persistence_oracle`."""
    canvas = tid(page, "doc-canvas", doc_id=name)
    canvas.wait_for(timeout=BRIDGE_TIMEOUT_MS)
    frame = frame_of(canvas.first)
    html = frame.evaluate("() => document.documentElement.outerHTML")
    text = frame.evaluate("() => (document.body?.innerText ?? '').trim()")
    manifest = doc_versions(pid, name)
    st, head_html = fetch(f"/api/v1/projects/{quote(pid)}/interactive/d/{quote(name)}/doc")
    assert st == 200 and head_html, f"the head's rendered document → {st}"
    return {
        "rendered_html_sha256": hashlib.sha256(html.encode()).hexdigest(), "rendered_text": text,
        "head": manifest.get("head"), "lineage": [v.get("version") for v in manifest.get("versions") or []],
        "head_html_sha256": hashlib.sha256(head_html).hexdigest(), "canvas_version": canvas.first.get_attribute("data-version"),
    }


# ── The scenarios ─────────────────────────────────────────────────────────────

suite = Suite()
findings: list[str] = []


def run_scenarios(rig: Rig, page) -> None:
    ctx: dict = {"docs": [], "demos": []}
    REPO_ID = rig.repo_id
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    rig.report["console_errors"] = console_errors

    # ── Projects ──────────────────────────────────────────────────────────────
    def prj1() -> str:
        goto(page, "/")
        ctx["A"] = ui_create_project(page, NAME_A)
        rig.needles.append(ctx["A"])
        return f"Project A = {ctx['A']} ({NAME_A}); landed on /p/{ctx['A']}/build with the shell header naming it"

    suite.run("PRJ-1", "Create Project A via the rail ＋ → modal → Create", prj1)

    def prj2() -> str:
        ctx["B"] = ui_create_project(page, NAME_B)
        rig.needles.append(ctx["B"])
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
        return (f"[SUBSTITUTE] repo {REPO_ID} attached to A over POST /projects/{A}/members (no UI attach control until studio#207); "
                "UI verifies: A's dashboard renders the repo tile, B's renders none")

    suite.run("ATT-1", "Attach the repository to Project A (API substitute, UI-verified)", att1, requires=("PRJ-1", "PRJ-2"))

    # ── Steering (global corpus) ──────────────────────────────────────────────
    def str1() -> str:
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        rid = ui_add_rule(page, RULE_STATEMENT, unseeded_gap_issue="studio#212")
        ctx["rule_first_ui"] = rid
        return f"first rule {rid} authored through the draft row on the unseeded store"

    suite.run("STR-1", "Author the FIRST rule via Add row on the unseeded store", str1, xfail="studio#212")

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
        findings.append("STR-1 (studio#212): 'Add row' is inert on an unseeded store (grid not mounted) — the first rule needed an API substitute")
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
        # The id is the drawer's HEADER (SteeringRuleDrawer.tsx); `steering-rule-detail` is the field list under it.
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

    def ui_retire_rule(rid: str, reason: str) -> None:
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
        # (SteeringGrid.tsx GRID_FACETS_DEFAULT.includeRetired = true; the chip reads "retired shown").
        toggle = tid(page, "steering-filter-retired")
        assert toggle.get_attribute("aria-pressed") == "true", f"retired facet default: {text_of(toggle)!r}"
        ui_retire_rule(rid, RETIRE_REASON)
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

    def strimp() -> str:
        """Import a .json rule batch through the assist dock's attachment fork ("Import directly" →
        `importDirect` → POST /governance/steering/import), then verify each rule on a full reload."""
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        ensure_dock_open(page)
        batch = [
            {
                "id": rid, "rule_type": "pattern", "statement": IMPORT_STATEMENTS[rid], "severity": "warn",
                "confidence": 0.9, "targets": {}, "provenance": {"source": "ui", "source_kinds": ["doc"]},
                "steering_type": "architecture", "applies_to": [], "excludes": [], "weight": 1.0,
            }
            for rid in IMPORT_IDS
        ]
        tid(page, "assist-attach").set_input_files([{
            "name": f"seed-surfaces-import-{STAMP}.json", "mimeType": "application/json",
            "buffer": json.dumps(batch, indent=1).encode(),
        }])
        chip = tid(page, "assist-attachment-chip", mode="ask")
        chip.wait_for(timeout=10_000)
        assert f"seed-surfaces-import-{STAMP}.json" in text_of(chip), text_of(chip)
        tid(page, "assist-import-now").click()
        page.wait_for_function(
            "() => Array.from(document.querySelectorAll('[data-testid=\"assist-note\"]')).some(n => / of \\d+ entr/.test(n.textContent ?? ''))",
            timeout=30_000,
        )
        notes = tid(page, "assist-note").evaluate_all("els => els.map(e => ({tone: e.getAttribute('data-tone'), text: (e.textContent ?? '').trim()}))")
        summary = [n for n in notes if re.search(r" of \d+ entr", n["text"])][-1]
        assert re.search(rf"\b{len(IMPORT_IDS)} of {len(IMPORT_IDS)} entr", summary["text"]), f"import summary: {summary} — all notes: {notes}"
        joined = " | ".join(n["text"] for n in notes)
        for rid in IMPORT_IDS:
            assert rid in joined, f"the dock's import notes never name {rid}: {notes}"
        assert not [n for n in notes if n["tone"] == "fail"], f"a fail-tone note appeared: {notes}"
        # The page reloaded its rules after the import; a FULL reload proves the store, not the state.
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        for rid in IMPORT_IDS:
            row = tid(page, "steering-grid-row", rule_id=rid)
            row.wait_for(timeout=15_000)
            assert text_of(row.locator('[data-testid="steering-cell-statement"]')) == IMPORT_STATEMENTS[rid]
            assert row.locator('[data-testid="steering-cell-severity"]').input_value() == "warn"
            assert row.locator('[data-testid="steering-cell-type"]').input_value() == "architecture"
            server = rule_row_api(rid)
            assert server is not None and server["statement"] == IMPORT_STATEMENTS[rid], f"server row {rid}: {server}"
        ctx["imported"] = list(IMPORT_IDS)
        return (f"{', '.join(IMPORT_IDS)} imported through the dock's attachment → 'Import directly' (notes: {summary['text']!r}); "
                "after a full reload both rows render their statements/severity/type and the server rows agree")

    suite.run("STR-IMP", "Import a .json rule batch via the assist-dock attachment (importDirect) and reload", strimp, requires=("STR-1B",))

    def strinl() -> str:
        """Inline CELL edits on a grid row (no drawer): severity select, statement text cell (Enter
        commits), type select — each commit is a per-row upsert; all three survive a full reload."""
        rid = IMPORT_IDS[0]
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        row.locator('[data-testid="steering-cell-severity"]').select_option("critical")
        wait_rule_field(rid, "severity", "critical")
        assert tid(page, "steering-commit-error").count() == 0, text_of(tid(page, "steering-commit-error"))
        row.locator('[data-testid="steering-cell-statement"]').click()
        cell_input = row.locator('[data-testid="steering-cell-statement-input"]')
        cell_input.wait_for(timeout=5_000)
        cell_input.fill(INLINE_STATEMENT)
        cell_input.press("Enter")
        wait_rule_field(rid, "statement", INLINE_STATEMENT)
        row.locator('[data-testid="steering-cell-type"]').select_option("security")
        server = wait_rule_field(rid, "steering_type", "security")
        assert tid(page, "steering-commit-error").count() == 0, text_of(tid(page, "steering-commit-error"))
        note = text_of(tid(page, "steering-saved-note"))
        assert f"Saved {rid}" in note, f"saved note after the inline commits: {note!r}"
        assert server["severity"] == "critical" and server["statement"] == INLINE_STATEMENT, server
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        row = tid(page, "steering-grid-row", rule_id=rid)
        row.wait_for(timeout=15_000)
        sev = row.locator('[data-testid="steering-cell-severity"]').input_value()
        typ = row.locator('[data-testid="steering-cell-type"]').input_value()
        stmt = text_of(row.locator('[data-testid="steering-cell-statement"]'))
        assert (sev, typ, stmt) == ("critical", "security", INLINE_STATEMENT), f"after reload: severity={sev!r} type={typ!r} statement={stmt!r}"
        return (f"{rid} edited INLINE (severity cell warn→critical, statement cell rewritten on Enter, type cell architecture→security); "
                "each commit reached the server row and all three survive a full reload")

    suite.run("STR-INL", "Inline grid-cell edits (severity/statement/type) persist across reload", strinl, requires=("STR-IMP",))

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
            st, _ = api("GET", "/testing/evals")
            if st == 501:
                raise Skip("this daemon's engine predates the eval bindings (GET /testing/evals → 501)")
            raise AssertionError(f"the UI shows evals as unsupported but GET /testing/evals answers {st}")
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

    def evl3() -> str:
        """Corpus SELECTION: import a corpus through the UI (name + .json file), run against it via the
        `testing-evals-corpus` field, and prove the selection is reflected (provenance line, history
        row, API) and persists (the recorded run still names the corpus after a full reload)."""
        goto(page, "/testing/evals")
        tid(page, "testing-evals").wait_for(timeout=20_000)
        samples = [
            {"id": f"seed-{STAMP}-bad", "description": f"seed-surfaces {STAMP}: a wire body that never names its project",
             "kind": "bad", "steering_type": "architecture",
             "signals": {"phase": "build", "tool": "Edit", "files": ["src/api/wire.ts"], "content": "post the body without the project field"}},
            {"id": f"seed-{STAMP}-good", "description": f"seed-surfaces {STAMP}: a wire body that names its project and repo",
             "kind": "good", "steering_type": "architecture",
             "signals": {"phase": "build", "tool": "Edit", "files": ["src/api/wire.ts"], "content": "post the body with project and repo named explicitly"}},
        ]
        tid(page, "testing-corpus-name").fill(CORPUS_NAME)
        tid(page, "testing-corpus-file").set_input_files([{"name": f"{CORPUS_NAME}.json", "mimeType": "application/json", "buffer": json.dumps(samples).encode()}])
        seen = wait_any(page, ["testing-corpus-summary", "testing-corpus-error", "testing-corpus-unsupported"], 60_000)
        if seen == "testing-corpus-unsupported":
            st, _ = api("POST", "/testing/corpora/import", {"name": "x", "samples": samples})
            if st == 501:
                raise Skip("this daemon's engine predates corpus import (POST /testing/corpora/import → 501)")
            raise AssertionError(f"the UI shows corpus import as unsupported but the route answers {st}")
        assert seen == "testing-corpus-summary", f"corpus import failed: {text_of(tid(page, 'testing-corpus-error'))}"
        summary = text_of(tid(page, "testing-corpus-summary"))
        assert CORPUS_SCOPE in summary and f"imported {len(samples)} samples" in summary, f"import summary: {summary!r}"
        embedded = "(embedded)" in summary
        # The SELECTION: the import pre-fills the corpus field with the landed scope; exercise the field
        # itself too (clear + type the scope) so the typed path is what the run sends.
        assert tid(page, "testing-evals-corpus").input_value() == CORPUS_SCOPE, f"corpus field after import: {tid(page, 'testing-evals-corpus').input_value()!r}"
        tid(page, "testing-evals-corpus").fill("")
        tid(page, "testing-evals-corpus").fill(CORPUS_SCOPE)
        tid(page, "testing-evals-run").click()
        seen = wait_any(page, ["testing-evals-summary", "testing-evals-error", "testing-evals-unsupported"], EVALS_TIMEOUT_MS)
        assert seen == "testing-evals-summary", f"evals against {CORPUS_SCOPE} failed: {text_of(tid(page, 'testing-evals-error'))}"
        provenance = text_of(tid(page, "testing-evals-provenance"))
        assert f"corpus: {CORPUS_SCOPE}" in provenance, f"provenance line {provenance!r} does not name the selected corpus"
        assert f"{len(samples)} samples" in provenance, provenance
        history = tid(page, "eval-history-row")
        page.wait_for_function("n => document.querySelectorAll('[data-testid=\"eval-history-row\"]').length === n", arg=2, timeout=15_000)
        newest = history.first
        run_id = newest.get_attribute("data-run-id")
        assert run_id and run_id != ctx.get("eval_run"), f"newest history row is {run_id!r} (EVL-1's run was {ctx.get('eval_run')!r})"
        assert CORPUS_SCOPE in text_of(newest), f"the newest history row does not name the corpus: {text_of(newest)!r}"
        st, listing = api("GET", "/testing/evals")
        mine = [r for r in listing["runs"] if r["id"] == run_id]
        assert st == 200 and mine and mine[0].get("corpus") == CORPUS_SCOPE, f"GET /testing/evals row for {run_id}: {mine}"
        st, detail = api("GET", f"/testing/evals/{quote(run_id)}")
        assert st == 200 and detail["summary"]["total"] == len(samples), f"GET /testing/evals/{run_id} → {st} {detail.get('summary')}"
        assert detail.get("corpus", CORPUS_SCOPE) == CORPUS_SCOPE, f"detail corpus: {detail.get('corpus')!r}"
        newest.locator("button").first.click()
        detail_el = tid(page, "eval-history-detail")
        detail_el.wait_for(timeout=15_000)
        page.wait_for_function("() => /\\d+ samples · \\d+ caught/.test(document.querySelector('[data-testid=\"eval-history-detail\"]')?.textContent ?? '')", timeout=15_000)
        before = text_of(detail_el)
        # Persistence: a FULL reload — the recorded run still names the corpus; its drilldown is byte-identical.
        goto(page, "/testing/evals")
        row = tid(page, "eval-history-row", run_id=run_id)
        row.wait_for(timeout=20_000)
        assert CORPUS_SCOPE in text_of(row), f"after reload the history row no longer names the corpus: {text_of(row)!r}"
        row.locator("button").first.click()
        detail_el = tid(page, "eval-history-detail")
        detail_el.wait_for(timeout=15_000)
        page.wait_for_function("() => /\\d+ samples · \\d+ caught/.test(document.querySelector('[data-testid=\"eval-history-detail\"]')?.textContent ?? '')", timeout=15_000)
        assert text_of(detail_el) == before, f"drilldown changed across the reload: {text_of(detail_el)!r} ≠ {before!r}"
        field_after_reload = tid(page, "testing-evals-corpus").input_value()
        ctx["eval_corpus_run"] = run_id
        return (f"corpus {CORPUS_NAME} imported through the UI ({len(samples)} samples → {CORPUS_SCOPE}, {'embedded' if embedded else 'facet-only'}); "
                f"selected in `testing-evals-corpus` and run: provenance names it, run {run_id} recorded with corpus={CORPUS_SCOPE} "
                f"(history row + GET /testing/evals + /:id agree, total {len(samples)}); after a full reload the row still names the corpus and its "
                f"drilldown is byte-identical (the corpus FIELD itself is session state: reads {field_after_reload!r} after reload — the recorded run carries the selection)")

    suite.run("EVL-3", "Corpus selection: import via the UI, run against it, history names it, persists on reload", evl3, requires=("EVL-1",))

    # ── Memories (read-only browse; retire is a scope-subtree erasure — never exercised, studio#206) ──
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

    def mems() -> str:
        """[SUBSTITUTE producer] two memories in EXCLUSIVE sibling scopes via the same estate MCP crew
        spawns, pinned to the scratch store — then the UI lists both (content + scope), and the wire agrees."""
        for scope, content in ((MEMORY_SCOPE_KEEP, MEMORY_CONTENT_KEEP), (MEMORY_SCOPE_RETIRE, MEMORY_CONTENT_RETIRE)):
            rig.estate_tool("memory.capture", {"content": content, "scope": scope, "tier": "semantic", "kind": "fact", "facets": SUITE_FACET})
        stored = memories_api(MEMORY_SCOPE_ROOT)
        assert {m["scope"] for m in stored} == {MEMORY_SCOPE_KEEP, MEMORY_SCOPE_RETIRE}, f"GET /memory under {MEMORY_SCOPE_ROOT}: {stored}"
        goto(page, "/steering/memories")
        state, _count = memories_state()
        assert state == "memories-list", f"memories panel state {state!r} after seeding two memories"
        rows = memory_rows(page)
        by_scope = {r["scope"]: r for r in rows}
        for scope, content in ((MEMORY_SCOPE_KEEP, MEMORY_CONTENT_KEEP), (MEMORY_SCOPE_RETIRE, MEMORY_CONTENT_RETIRE)):
            assert scope in by_scope, f"the browser lists no row for scope {scope}: {rows}"
            assert by_scope[scope]["content"] == content, f"row {scope} content {by_scope[scope]['content']!r}"
        coverage = text_of(tid(page, "memories-coverage")) if tid(page, "memories-coverage").count() else ""
        ctx["memories_seeded"] = True
        return (f"[SUBSTITUTE producer: {rig.report['setup']['substitute_producer']['exe']} → memory.capture ×2 into the scratch store] "
                f"the UI lists both rows with their content and scopes ({MEMORY_SCOPE_KEEP}, {MEMORY_SCOPE_RETIRE}); coverage line {coverage!r}; GET /memory agrees")

    suite.run("MEM-S", "Seed two exclusive-scope memories (substitute producer) → the browser lists both", mems, requires=("MEM-2",))

    def memr() -> str:
        """Retire ONE scope through the UI (row → Retire… → typed banner → confirm): the note reports
        exactly one erased memory, the sibling scope survives, and a full reload + the wire agree."""
        goto(page, "/steering/memories")
        state, _ = memories_state()
        assert state == "memories-list"
        target = tid(page, "memory-row").filter(has=page.locator('[data-testid="memory-scope"]', has_text=MEMORY_SCOPE_RETIRE))
        assert target.count() == 1, f"{target.count()} rows carry scope {MEMORY_SCOPE_RETIRE}"
        target.locator('[data-testid="memory-retire"]').click()
        banner = tid(page, "memory-retire-confirm-banner")
        banner.wait_for(timeout=10_000)
        assert MEMORY_SCOPE_RETIRE in text_of(banner) and "SUBTREE" in text_of(banner), text_of(banner)
        tid(page, "memory-retire-confirm").click()
        note = tid(page, "memories-note")
        note.wait_for(timeout=20_000)
        assert text_of(note) == f"Retired scope {MEMORY_SCOPE_RETIRE} — erased 1 memory.", f"retire note: {text_of(note)!r}"
        # The panel re-reads the wire after the retire; wait for the row to be GONE (not for a loading
        # marker that may have come and gone), then read the surviving rows.
        page.wait_for_function(
            "s => document.querySelector('[data-testid=\"memories-loading\"]') === null && "
            "!Array.from(document.querySelectorAll('[data-testid=\"memory-scope\"]')).some(e => (e.textContent ?? '').trim() === s)",
            arg=MEMORY_SCOPE_RETIRE, timeout=20_000,
        )
        scopes = {r["scope"] for r in memory_rows(page)}
        assert MEMORY_SCOPE_RETIRE not in scopes and MEMORY_SCOPE_KEEP in scopes, f"rows after retire: {scopes}"
        goto(page, "/steering/memories")
        memories_state()
        scopes = {r["scope"] for r in memory_rows(page)}
        assert MEMORY_SCOPE_RETIRE not in scopes and MEMORY_SCOPE_KEEP in scopes, f"rows after a full reload: {scopes}"
        assert memories_api(MEMORY_SCOPE_RETIRE) == [], "the retired scope still answers memories on the wire"
        keep = memories_api(MEMORY_SCOPE_KEEP)
        assert len(keep) == 1 and keep[0]["content"] == MEMORY_CONTENT_KEEP, f"the sibling scope changed: {keep}"
        assert len(memories_api(MEMORY_SCOPE_ROOT)) == 1, "the suite's root scope should hold exactly the surviving sibling"
        return (f"{MEMORY_SCOPE_RETIRE} retired through the UI (Retire… → subtree banner → confirm); note 'erased 1 memory'; "
                f"the sibling {MEMORY_SCOPE_KEEP} survives in the UI and on the wire, before and after a full reload")

    suite.run("MEM-R", "Retire one exclusive scope through the UI; the sibling scope survives; reload + wire agree", memr, requires=("MEM-S",))

    def prps() -> str:
        """[SUBSTITUTE producer] two MEMORY proposals via `proposal.submit` on the scratch store (agents are
        the only producer today) — the dashboard's review inbox lists both with their content."""
        for content in (PROPOSAL_CONTENT_APPROVE, PROPOSAL_CONTENT_REJECT):
            rig.estate_tool("proposal.submit", {"kind_type": "memory", "payload": {"content": content, "tier": "semantic"}, "facets": SUITE_FACET})
        pending = proposals_api("pending")
        ids = {}
        for p in pending:
            content = (p.get("payload") or {}).get("content") if isinstance(p.get("payload"), dict) else None
            if content in (PROPOSAL_CONTENT_APPROVE, PROPOSAL_CONTENT_REJECT):
                ids[content] = p["id"]
        assert set(ids) == {PROPOSAL_CONTENT_APPROVE, PROPOSAL_CONTENT_REJECT}, f"pending proposals after submit: {pending}"
        ctx["proposal_approve"], ctx["proposal_reject"] = ids[PROPOSAL_CONTENT_APPROVE], ids[PROPOSAL_CONTENT_REJECT]
        rig.needles.extend(ids.values())
        goto(page, "/steering/dashboard")
        tid(page, "governance-dashboard").wait_for(timeout=20_000)
        section = proposal_section(page, "memory")
        for content, pid_ in ids.items():
            card = section.locator(f'[data-testid="proposal-card"][data-proposal-id="{pid_}"]')
            card.wait_for(timeout=15_000)
            assert card.get_attribute("data-kind") == "memory"
            assert text_of(card.locator('[data-testid="proposal-memory-content"]')) == content, text_of(card)
        return (f"[SUBSTITUTE producer → proposal.submit ×2 (memory)] the dashboard's Memory proposals inbox lists "
                f"{ctx['proposal_approve']} and {ctx['proposal_reject']} with their content")

    suite.run("PRP-S", "Seed two memory proposals (substitute producer) → the dashboard inbox lists both", prps)

    def prpa() -> str:
        pid_ = ctx["proposal_approve"]
        goto(page, "/steering/dashboard")
        section = proposal_section(page, "memory")
        card = section.locator(f'[data-testid="proposal-card"][data-proposal-id="{pid_}"]')
        card.wait_for(timeout=15_000)
        card.locator('[data-testid="proposal-approve"]').click()
        note = section.locator('[data-testid="proposals-section-note"]')
        note.wait_for(timeout=20_000)
        assert text_of(note) == f"Approved {pid_}.", f"note after approve: {text_of(note)!r}"
        card.wait_for(state="detached", timeout=15_000)
        approved = [p["id"] for p in proposals_api("approved")]
        assert pid_ in approved, f"GET /proposals?state=approved lacks {pid_}: {approved}"
        assert pid_ not in [p["id"] for p in proposals_api("pending")]
        st, body = api("GET", f"/memory?query={quote(PROPOSAL_CONTENT_APPROVE, safe='')}")
        promoted = [m for m in body["memories"] if m["content"] == PROPOSAL_CONTENT_APPROVE]
        assert len(promoted) == 1, f"approval did not materialize the memory (GET /memory query): {body}"
        goto(page, "/steering/dashboard")
        section = proposal_section(page, "memory")
        assert section.locator(f'[data-testid="proposal-card"][data-proposal-id="{pid_}"]').count() == 0, "the approved proposal is still pending after a reload"
        goto(page, "/steering/memories")
        memories_state()
        assert PROPOSAL_CONTENT_APPROVE in {r["content"] for r in memory_rows(page)}, "the memories browser does not list the promoted memory"
        return (f"{pid_} approved through the inbox (note 'Approved …'); it left pending, GET /proposals?state=approved lists it, the memory "
                f"materialized in the store (scope {promoted[0]['scope']!r}) and the memories browser lists it after a reload")

    suite.run("PRP-A", "Approve a memory proposal through the inbox → promoted memory; pending excludes it on reload", prpa, requires=("PRP-S",))

    def prpr() -> str:
        pid_ = ctx["proposal_reject"]
        goto(page, "/steering/dashboard")
        section = proposal_section(page, "memory")
        card = section.locator(f'[data-testid="proposal-card"][data-proposal-id="{pid_}"]')
        card.wait_for(timeout=15_000)
        card.locator('[data-testid="proposal-reject"]').click()
        note = section.locator('[data-testid="proposals-section-note"]')
        note.wait_for(timeout=20_000)
        assert text_of(note) == f"Rejected {pid_}.", f"note after reject: {text_of(note)!r}"
        card.wait_for(state="detached", timeout=15_000)
        assert pid_ in [p["id"] for p in proposals_api("rejected")], "GET /proposals?state=rejected lacks the rejected proposal"
        assert pid_ not in [p["id"] for p in proposals_api("pending")]
        st, body = api("GET", f"/memory?query={quote(PROPOSAL_CONTENT_REJECT, safe='')}")
        assert [m for m in body["memories"] if m["content"] == PROPOSAL_CONTENT_REJECT] == [], f"a REJECTED proposal wrote a memory: {body}"
        goto(page, "/steering/dashboard")
        section = proposal_section(page, "memory")
        assert section.locator(f'[data-testid="proposal-card"][data-proposal-id="{pid_}"]').count() == 0, "the rejected proposal is still pending after a reload"
        return f"{pid_} rejected through the inbox (note 'Rejected …'); it left pending, GET /proposals?state=rejected lists it, and no memory was written"

    suite.run("PRP-R", "Reject a memory proposal through the inbox → nothing written; pending excludes it on reload", prpr, requires=("PRP-S",))

    # ── Documents / demos — deterministic seeds (agent answering disabled) + the crew#472 xfails ──
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
        # CONTENT ORACLE: capture what the canvas renders + the wire's head/lineage/head-html BEFORE
        # the reload, then again AFTER a full reload — equality is the persistence claim.
        goto(page, f"/p/{quote(pid)}/document/{quote(name)}")
        before = doc_capture(page, pid, name)
        goto(page, f"/p/{quote(pid)}/document/{quote(name)}")
        after = doc_capture(page, pid, name)
        persistence_oracle(before, after)
        ctx["doc_a_capture"] = after
        ids = picker_ids(page, pid, "document")
        assert name in ids, f"{name} missing from A's picker after reload: {ids}"
        # The versions wire: 200, a head, a lineage consistent with itself and with the docs listing.
        st, manifest = api("GET", f"/projects/{quote(pid)}/interactive/d/{quote(name)}/api/versions")
        assert st == 200 and isinstance(manifest, dict), f"versions wire → {st} {str(manifest)[:300]}"
        head, versions = manifest.get("head"), manifest.get("versions")
        assert isinstance(head, int) and isinstance(versions, list) and versions, f"manifest lacks an int head / non-empty versions: {manifest}"
        numbers = [v.get("version") for v in versions]
        assert head in numbers, f"head {head} is not one of the lineage's versions {numbers}"
        assert numbers == sorted(numbers) and len(set(numbers)) == len(numbers), f"lineage is not a strictly increasing chain: {numbers}"
        for v in versions:
            parent = v.get("parent")
            if v.get("version") == 0:
                assert parent is None, f"v0 has a parent: {v}"
            else:
                assert parent in numbers and parent < v["version"], f"version {v.get('version')} names a parent outside the chain: {v}"
            assert v.get("html_file"), f"version {v.get('version')} names no html file: {v}"
        st2, listing = api("GET", f"/projects/{quote(pid)}/interactive/api/docs")
        assert st2 == 200 and isinstance(listing, list), f"docs listing → {st2} {str(listing)[:200]}"
        mine = [d for d in listing if d.get("name") == name]
        assert len(mine) == 1, f"docs listing carries {len(mine)} entries named {name!r}"
        assert mine[0].get("head") == head and mine[0].get("versions") == len(versions), f"listing {mine[0]} disagrees with the manifest (head {head}, {len(versions)} versions)"
        st3, html = fetch(f"/api/v1/projects/{quote(pid)}/interactive/d/{quote(name)}/doc")
        assert st3 == 200 and html, f"the head's rendered document → {st3}"
        assert hashlib.sha256(html).hexdigest() == after["head_html_sha256"], "the head html changed between the capture and the final fetch"
        return (f"after a full reload the canvas frames '{name}' with IDENTICAL rendered content (frame html sha256 {after['rendered_html_sha256'][:12]}…, "
                f"text {len(after['rendered_text'])} chars), head={head} lineage={numbers} and head-html sha256 {after['head_html_sha256'][:12]}… all equal "
                f"before/after; A's picker lists it; docs listing agrees ({len(versions)} versions); head html renders (200)")

    suite.run("VIB-4", "Document survives a reload (canvas identity + picker listing + versions head/lineage)", vib4, requires=("VIB-1D",))

    def fbk1() -> str:
        (A, doc_a), (B, doc_b) = ctx["docs"][0], ctx["docs"][1]
        return feedback_journey(page, A, doc_a, B, doc_b)

    suite.run("FBK-1", "Feedback journey: point-and-comment on A's doc → deterministic version + thread message; persists on reload; not on B's doc", fbk1, requires=("VIB-4", "VIB-2D"))

    def vibcmp() -> str:
        A, doc_a = ctx["docs"][0]
        return compare_journey(page, A, doc_a)

    suite.run("VIB-CMP", "Document comparison: two versions of A's doc side by side + overlay; each pane renders its own version", vibcmp, requires=("FBK-1",))

    def vib3() -> str:
        (A, doc_a), (B, doc_b) = ctx["docs"][0], ctx["docs"][1]
        a_ids = picker_ids(page, A, "document")
        b_ids = picker_ids(page, B, "document")
        disjoint_pickers_oracle(a_ids, b_ids, doc_a, doc_b, "crew#472")
        return "A and B list only their own documents"

    suite.run("VIB-3", "Documents are disjoint per project (A ∌ B's doc, B ∌ A's doc)", vib3, xfail="crew#472", requires=("VIB-1D", "VIB-2D"))

    def vib3f() -> str:
        """A foreign deep link: B's shell asked for A's document by URL must not frame it."""
        (A, doc_a), (B, _doc_b) = ctx["docs"][0], ctx["docs"][1]
        goto(page, f"/p/{quote(B)}/document/{quote(doc_a)}")
        seen = wait_any(page, ["doc-canvas", "doc-canvas-error", "doc-picker-empty", "doc-canvas-loading"], BRIDGE_TIMEOUT_MS)
        framed = seen == "doc-canvas" and tid(page, "doc-canvas", doc_id=doc_a).count() > 0
        expect_gap(not framed, "crew#472", f"Project B's shell frames A's document {doc_a!r} through a deep link (/p/{B}/document/{doc_a})")
        return f"B's shell refuses A's document by deep link (rendered: {seen})"

    suite.run("VIB-3F", "Foreign deep link: /p/B/document/<A's doc> must not frame A's document", vib3f, xfail="crew#472", requires=("VIB-1D", "VIB-2D"))

    def foreign_fork(mode: str, owner: str, name: str, foreign: str, own_name: str, surface_testid: str) -> str:
        """The shared body of ISO-F (documents) and ISO-DF (demos): from the FOREIGN project's shell,
        fork the owner's artifact (Versions tab → Fork = `POST /d/:doc/api/fork`). Correct: the
        foreign shell does not frame it, or the fork is refused. When the fork LANDS (crew#472), the
        BILATERAL ownership/persistence checks run FIRST, on RELOAD, as plain assertions — the
        owner's shell frames the new head and its Versions tab lists the whole lineage; the wire
        agrees; the foreign project's own artifact is untouched and still listed; the server-side
        owner record (crew `interactive.doc` membership) still files the artifact under the owner
        and NOT under the foreign project — and only then the ONE expected gap fires."""
        before = doc_versions(owner, name)
        n_before = len(before["versions"])
        foreign_before = doc_versions(foreign, own_name)
        goto(page, f"/p/{quote(foreign)}/{mode}/{quote(name)}")
        picker = "doc-picker" if mode == "document" else "demo-picker"
        surface = "doc" if mode == "document" else "video"
        seen = wait_any(page, [surface_testid, f"{surface}-canvas-error", f"{picker}-empty", picker, f"{surface}-canvas-loading"], BRIDGE_TIMEOUT_MS)
        attr = {"doc_id": name} if mode == "document" else {"demo_id": name}
        if not (seen == surface_testid and tid(page, surface_testid, **attr).count() > 0):
            return f"{foreign}'s shell does not frame {owner}'s {mode} (rendered: {seen}) — no foreign mutation is reachable"
        # The panel starts collapsed once an artifact owns the canvas: the rail's Versions glyph opens it on that tab.
        tid(page, "panel-rail-tab", tab="versions").click()
        tid(page, "doc-panel", tab="versions").wait_for(timeout=10_000)
        head_row = tid(page, "version-detail", version=str(before["head"]))
        head_row.wait_for(timeout=10_000)
        head_row.locator('[data-testid="version-fork"]').click()
        deadline = time.time() + 30
        outcome = None
        while time.time() < deadline and outcome is None:
            if tid(page, "version-fork-error").count() > 0:
                outcome = ("refused", text_of(tid(page, "version-fork-error")))
            elif re.search(r"[?&]v=\d+", page.url):
                outcome = ("landed", page.url)
            else:
                page.wait_for_timeout(250)
        after = doc_versions(owner, name)
        n_after = len(after["versions"])
        if outcome is None:
            raise AssertionError(f"the fork from {foreign}'s shell neither landed nor was refused within 30s ({owner}'s versions {n_before} → {n_after})")
        if outcome[0] == "refused":
            assert n_after == n_before, f"the UI reported a refused fork but {owner}'s {mode} gained versions ({n_before} → {n_after})"
            return f"{foreign}'s shell framed {owner}'s {mode} but the fork was REFUSED ({outcome[1][:200]}); lineage unchanged ({n_before} versions)"
        leaked = n_after != n_before
        # ── BILATERAL, on RELOAD, before the gap fires ──
        goto(page, f"/p/{quote(owner)}/{mode}/{quote(name)}")
        canvas = tid(page, surface_testid, **attr)
        canvas.wait_for(timeout=BRIDGE_TIMEOUT_MS)
        assert canvas.first.get_attribute("data-version") == str(after["head"]), f"the owner's shell frames v{canvas.first.get_attribute('data-version')} after reload, not the current head v{after['head']}"
        tid(page, "panel-rail-tab", tab="versions").click()
        tid(page, "doc-panel", tab="versions").wait_for(timeout=10_000)
        page.wait_for_function("n => document.querySelectorAll('[data-testid=\"version-detail\"]').length === n", arg=n_after, timeout=15_000)
        listed = sorted(attr_values(page, "version-detail", "data-version"), key=int)
        assert listed == sorted((str(v["version"]) for v in after["versions"]), key=int), f"the owner's Versions tab lists {listed}, the wire says {[v['version'] for v in after['versions']]}"
        reloaded = doc_versions(owner, name)
        assert (reloaded["head"], [v["version"] for v in reloaded["versions"]]) == (after["head"], [v["version"] for v in after["versions"]]), "the mutation did not persist on the wire"
        foreign_ids = picker_ids(page, foreign, mode)
        assert own_name in foreign_ids, f"{foreign}'s picker lost its OWN {mode} {own_name!r}: {foreign_ids}"
        foreign_after = doc_versions(foreign, own_name)
        assert (len(foreign_after["versions"]), foreign_after["head"]) == (len(foreign_before["versions"]), foreign_before["head"]), f"{foreign}'s own {mode} lineage changed: {foreign_before} → {foreign_after}"
        owner_docs, foreign_docs = doc_members(owner), doc_members(foreign)
        assert name in owner_docs, f"crew no longer files {name!r} under its owner {owner} (interactive.doc members: {owner_docs})"
        assert name not in foreign_docs, f"the foreign fork RE-FILED {name!r} under {foreign} (interactive.doc members: {foreign_docs})"
        assert own_name in foreign_docs, f"crew no longer files {own_name!r} under {foreign}: {foreign_docs}"
        expect_gap(not leaked, "crew#472",
                   f"a fork issued from Project {foreign}'s shell LANDED on Project {owner}'s {mode} {name!r}: versions {n_before} → {n_after} "
                   f"(new head {after.get('head')}, url {outcome[1].replace(ORIGIN, '')}) — the shared root accepts foreign mutations; "
                   f"bilateral checks held: owner frames v{after['head']} + lists {listed} after reload, foreign project's own {mode} untouched, "
                   f"crew membership still {owner}∋{name} / {foreign}∌{name}")
        return f"the fork from {foreign}'s shell changed nothing on {owner}'s {mode}"

    def isof() -> str:
        """MUTATION isolation, the EDIT arm for DOCUMENTS: fork A's document from B's shell."""
        (A, doc_a), (B, doc_b) = ctx["docs"][0], ctx["docs"][1]
        return foreign_fork("document", A, doc_a, B, doc_b, "doc-canvas")

    suite.run("ISO-F", "Foreign-context mutation (edit arm): fork A's doc from B's shell must be refused or unreachable; bilateral ownership after", isof,
              xfail="crew#472", requires=("VIB-1D", "VIB-2D"))

    def foreign_delete(mode: str, owner: str, name: str, foreign: str) -> str:
        """The shared body of ISO-D (documents) and ISO-DD (demos): from the FOREIGN project's picker,
        delete the owner's artifact. Correct: not listed there (invisible) or refused by scope. Two
        known gaps gate this today — the picker leak (crew#472) and the pinned bridge's missing
        DELETE route (studio#213); the one that fires is named in the detail."""
        foreign_ids = picker_ids(page, foreign, mode)
        if name not in foreign_ids:
            return f"{owner}'s {mode} is invisible from {foreign}'s picker ({foreign_ids}) — no foreign delete is reachable"
        # Everything the delete must leave in place — owner's picker, crew membership on BOTH sides,
        # head/lineage/content — read BEFORE, re-read AFTER a refused delete (`refused_delete_gap`).
        before = delete_capture(page, owner, name, mode, foreign)
        owner_before = before["owner_picker"]
        assert name in owner_before, f"{owner}'s own picker lost {name} before the foreign delete: {owner_before}"
        assert name in before["owner_members"] and name not in (before["foreign_members"] or []), (
            f"crew's membership is not bilateral BEFORE the foreign delete: {owner}∋{name}? {name in before['owner_members']}, {foreign}∌{name}? {name not in (before['foreign_members'] or [])}")
        picker = "doc-picker" if mode == "document" else "demo-picker"
        surface = "doc" if mode == "document" else "video"
        goto(page, f"/p/{quote(foreign)}/{mode}")
        wait_any(page, [picker, f"{picker}-empty", f"{surface}-canvas-error", f"{surface}-canvas-loading"], BRIDGE_TIMEOUT_MS)
        tid(page, "doc-delete-trigger", doc_id=name).click()
        tid(page, "doc-delete-confirm").wait_for(timeout=10_000)
        tid(page, "doc-delete-go").click()
        deadline = time.time() + 30
        while time.time() < deadline:
            if tid(page, "doc-delete-error").count() > 0:
                wire = text_of(tid(page, "doc-delete-error"))
                if PREDATES_DELETE_RE.search(wire):
                    after = delete_capture(page, owner, name, mode, foreign)
                    refused_delete_gap(before, after, owner=owner, foreign=foreign, name=name, mode=mode, issue="studio#213",
                                       message=(f"the foreign delete cannot reach a scope check — the pinned bridge {BRIDGE_PINNED_VERSION} predates DELETE /api/docs/:doc "
                                                f"({wire[:200]}) — preservation held bilaterally: {owner} still lists + owns {name!r}, {foreign} does not, "
                                                f"head v{after['head']} / lineage {after['lineage']} / content unchanged"))
                if re.search(r"project|scope|not (in|part of)|forbidden|403", wire, re.I):
                    return f"the delete of {owner}'s {mode} from {foreign}'s shell was REFUSED by scope: {wire[:200]}"
                raise AssertionError(f"delete from {foreign}'s shell failed on the wire for an unrelated reason: {wire[:300]}")
            if tid(page, "doc-delete-partial").count() > 0:
                raise AssertionError(f"PARTIAL delete from a foreign shell: {text_of(tid(page, 'doc-delete-partial'))[:300]}")
            if tid(page, "doc-delete-bridge-hint").count() > 0:
                reason = bridge_unavailable_reason(foreign)
                if reason is not None:
                    raise Skip(f"bridge unavailable during the foreign delete (daemon 503 bridge_unavailable: {reason[:200]})")
                raise AssertionError(f"foreign delete shows a bridge hint while the daemon serves the bridge: {text_of(tid(page, 'doc-delete-bridge-hint'))[:200]}")
            if tid(page, "doc-delete-confirm").count() == 0:
                break
            page.wait_for_timeout(200)
        owner_after = picker_ids(page, owner, mode)
        expect_gap(name in owner_after, "crew#472", f"a delete issued from Project {foreign}'s shell REMOVED Project {owner}'s {mode} {name!r} (owner's picker: {owner_before} → {owner_after})")
        return f"the delete from {foreign}'s shell left {owner}'s {mode} in place"

    def isod() -> str:
        """MUTATION isolation, the DELETE arm for DOCUMENTS: delete A's document from B's picker."""
        (A, doc_a), (B, _doc_b) = ctx["docs"][0], ctx["docs"][1]
        return foreign_delete("document", A, doc_a, B)

    suite.run("ISO-D", "Foreign-context mutation (delete arm): delete A's doc from B's shell must be refused or invisible", isod,
              xfail="studio#213 (delete wire) / crew#472 (leak)", requires=("VIB-1D", "VIB-2D"))

    def dem1d() -> str:
        name = ui_seed_demo(page, ctx["A"], f"seed-demo-a-{STAMP}", rig.fixture_url)
        ctx["demos"].append((ctx["A"], name))
        ids = picker_ids(page, ctx["A"], "video")
        assert name in ids, f"{name} missing from A's demo picker: {ids}"
        return f"demo '{name}' created under A via the wizard (target {rig.fixture_url}, one hand-pinned step; authoring agent disabled); A's picker lists it"

    suite.run("DEM-1D", "Seed a demo in Project A via the wizard (deterministic)", dem1d, requires=("PRJ-1",))

    def dem2d() -> str:
        name = ui_seed_demo(page, ctx["B"], f"seed-demo-b-{STAMP}", rig.fixture_url)
        ctx["demos"].append((ctx["B"], name))
        ids = picker_ids(page, ctx["B"], "video")
        assert name in ids, f"{name} missing from B's demo picker: {ids}"
        members = doc_members(ctx["B"])
        assert name in members, f"crew does not file the demo under B (interactive.doc members: {members})"
        return f"demo '{name}' created under B via the wizard (the scoping control for DEM-3/DEM-3F/ISO-DF/ISO-DD); B's picker lists it; crew files it under B"

    suite.run("DEM-2D", "Seed a demo in Project B via the wizard (deterministic)", dem2d, requires=("PRJ-2", "DEM-1D"))

    def demplay() -> str:
        """PLAYBACK of the seeded demo: the player frames the storyboard at the manifest head, the
        head html serves, no recording is offered for a version that has none — and it all survives
        a full reload."""
        A, demo = ctx["demos"][0]
        manifest = doc_versions(A, demo)
        head = manifest["head"]

        def observe() -> dict:
            goto(page, f"/p/{quote(A)}/video/{quote(demo)}")
            player = tid(page, "demo-player", demo_id=demo)
            player.wait_for(timeout=BRIDGE_TIMEOUT_MS)
            tid(page, "video-record").wait_for(timeout=15_000)
            frame = frame_of(player.first)
            html = frame.evaluate("() => document.documentElement.outerHTML")
            return {"version": player.first.get_attribute("data-version"), "src": player.first.get_attribute("src"),
                    "frame_sha256": hashlib.sha256(html.encode()).hexdigest(), "record_state": tid(page, "video-record").get_attribute("data-state")}

        before = observe()
        assert before["version"] == str(head), f"player shows v{before['version']} while the manifest head is {head}"
        assert before["record_state"] == "idle", f"record control state {before['record_state']!r}"
        st, ctype, body = fetch_with_type(f"/api/v1/projects/{quote(A)}/interactive/d/{quote(demo)}/doc/{head}")
        assert st == 200 and body, f"storyboard html v{head} → {st}"
        rst, rtype, _ = fetch_with_type(f"/api/v1/projects/{quote(A)}/interactive/d/{quote(demo)}/api/demo/recording/_v{head}.webm")
        assert not rtype.startswith("video/"), f"a recording is served for v{head} although none was recorded ({rst} {rtype})"
        after = observe()
        assert after["version"] == before["version"] and after["frame_sha256"] == before["frame_sha256"], f"player changed across the reload: {before} → {after}"
        ctx["demo_head_before_record"] = head
        return (f"demo '{demo}' plays back at v{head} (player frames the storyboard, frame html sha256 {before['frame_sha256'][:12]}…, identical after a full reload); "
                f"storyboard html 200 ({ctype.split(';')[0]}); no recording offered for v{head} (probe {rst} {rtype.split(';')[0] or 'no type'}); record control idle")

    suite.run("DEM-PLAY", "Demo playback: player frames the storyboard head; identical after reload; no phantom recording", demplay, requires=("DEM-1D",))

    def demrec() -> str:
        """RECORDING: click ⏺ Re-record and capture what the wire answers. The bridge's recorder
        (`wicked-interactive/src/service/demo.js recordDemo`) replays the demo's `demo.spec.mjs` in
        ITS OWN Playwright Chromium — a second browser this hermetic rig does not host — and refuses
        before any launch when no spec exists, and the spec is written only by the demo AUTHORING run
        this rig disables by design (`--no-interactive-demo-events`). So the journey is BLOCKED here;
        a recording that nevertheless lands breaks the premise and FAILS this row."""
        A, demo = ctx["demos"][0]
        head = ctx["demo_head_before_record"]
        n_before = len(doc_versions(A, demo)["versions"])
        goto(page, f"/p/{quote(A)}/video/{quote(demo)}")
        tid(page, "demo-player", demo_id=demo).wait_for(timeout=BRIDGE_TIMEOUT_MS)
        button = tid(page, "video-record")
        button.wait_for(timeout=15_000)
        # The ACK: the click posts `wicked.interactive.demo.requested` over POST /api/events — its
        # HTTP status is captured here; no observed response is "no acknowledgment" (a FAIL).
        ack_status: int | None = None
        try:
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/interactive/api/events"), timeout=15_000) as ack:
                button.click()
            ack_status = ack.value.status
        except Exception:  # noqa: BLE001 — Playwright's timeout: no response was observed
            ack_status = None
        page.wait_for_function(
            "() => ['queuing','recording'].includes(document.querySelector('[data-testid=\"video-record\"]')?.getAttribute('data-state')) "
            "|| document.querySelector('[data-testid=\"video-record-error\"]') !== null",
            timeout=15_000,
        )
        if tid(page, "video-record-error").count() > 0:
            raise AssertionError(f"the record request itself was refused at the click site (ack {ack_status}): {text_of(tid(page, 'video-record-error'))[:300]}")
        deadline = time.time() + 30
        bridge_answer = None
        landed = None
        while time.time() < deadline and bridge_answer is None and landed is None:
            st, conv = api("GET", f"/projects/{quote(A)}/interactive/d/{quote(demo)}/api/conversation")
            if st == 200 and isinstance(conv, list):
                for entry in conv:
                    if isinstance(entry, dict) and "Recording failed" in str(entry.get("text", "")):
                        bridge_answer = entry
            m = doc_versions(A, demo)
            if m["head"] != head or len(m["versions"]) != n_before:
                landed = m
            if bridge_answer is None and landed is None:
                time.sleep(1)
        if landed is not None:
            raise AssertionError(f"a recording LANDED (head {head} → {landed['head']}) — the BLOCKED premise no longer holds; implement the playback-of-recording assertion")
        state = button.get_attribute("data-state")
        answer = str(bridge_answer.get("text")) if bridge_answer else None
        verdict, reason = classify_recorder_answer(ack_status, answer, timed_out=bridge_answer is None)
        ctx["recorder"] = {"ack_status": ack_status, "answer": (answer or "")[:240], "state": state, "verdict": verdict}
        if verdict == "fail":
            raise AssertionError(f"DEM-REC: {reason} (⏺ data-state {state!r}, ack {ack_status})")
        raise Blocked(
            f"BLOCKED — demo RECORDING needs a second browser/recorder the rig cannot host. The record request was queued through the UI "
            f"(⏺ → data-state {state!r}; POST /api/events wicked.interactive.demo.requested acknowledged HTTP {ack_status}) and the bridge "
            f"answered with the {reason}. The recorder is the bridge's OWN Playwright Chromium (`recordDemo`: `import('playwright')` → "
            "`chromium.launch`), resolved from the bridge's HOME/PLAYWRIGHT_BROWSERS_PATH — under the hermetic scratch HOME there is no browser "
            "cache, and the rig's Playwright is the test client, not the bridge's; it also replays `demo.spec.mjs`, which only the demo AUTHORING "
            "run writes (disabled here: `--no-interactive-demo-events`, no agent runs in the seed suite; the wizard's steps have no backend "
            "consumer — finding 10). Any OTHER recorder answer, a ≥400 ack, a missing ack or no answer is a FAIL (`classify_recorder_answer`). "
            "Playback of the seeded storyboard IS certified (DEM-PLAY). Tracked in studio#217."
        )

    suite.run("DEM-REC", "Demo recording (⏺ Re-record → new version → playback of the recording)", demrec, requires=("DEM-PLAY",))

    def dem3() -> str:
        (A, demo_a), (B, demo_b) = ctx["demos"][0], ctx["demos"][1]
        a_ids = picker_ids(page, A, "video")
        b_ids = picker_ids(page, B, "video")
        disjoint_pickers_oracle(a_ids, b_ids, demo_a, demo_b, "crew#472", kind="demo")
        return "A and B list only their own demos"

    suite.run("DEM-3", "Demos are disjoint per project (A ∌ B's demo, B ∌ A's demo)", dem3, xfail="crew#472", requires=("DEM-1D", "DEM-2D"))

    def dem3f() -> str:
        """A foreign deep link for DEMOS: B's shell asked for A's demo by URL must not frame it. A
        refusal (error surface, picker, empty) is the correct answer here — not a product failure."""
        (A, demo_a), (B, _demo_b) = ctx["demos"][0], ctx["demos"][1]
        goto(page, f"/p/{quote(B)}/video/{quote(demo_a)}")
        seen = wait_any(page, ["demo-player", "video-canvas-error", "demo-picker-empty", "demo-picker", "video-canvas-loading"], BRIDGE_TIMEOUT_MS)
        framed = seen == "demo-player" and tid(page, "demo-player", demo_id=demo_a).count() > 0
        expect_gap(not framed, "crew#472", f"Project B's shell frames A's demo {demo_a!r} through a deep link (/p/{B}/video/{demo_a})")
        return f"B's shell refuses A's demo by deep link (rendered: {seen})"

    suite.run("DEM-3F", "Foreign deep link: /p/B/video/<A's demo> must not frame A's demo", dem3f, xfail="crew#472", requires=("DEM-1D", "DEM-2D"))

    def isodf() -> str:
        """MUTATION isolation, the EDIT arm for DEMOS: fork A's demo from B's shell (the storyboard's
        Versions tab → Fork), then the bilateral ownership/persistence checks on reload."""
        (A, demo_a), (B, demo_b) = ctx["demos"][0], ctx["demos"][1]
        return foreign_fork("video", A, demo_a, B, demo_b, "demo-player")

    suite.run("ISO-DF", "Foreign-context mutation (edit arm, demo): fork A's demo from B's shell must be refused or unreachable; bilateral ownership after", isodf,
              xfail="crew#472", requires=("DEM-1D", "DEM-2D"))

    def isodd() -> str:
        """MUTATION isolation, the DELETE arm for DEMOS: delete A's demo from B's picker."""
        (A, demo_a), (B, _demo_b) = ctx["demos"][0], ctx["demos"][1]
        return foreign_delete("video", A, demo_a, B)

    suite.run("ISO-DD", "Foreign-context mutation (delete arm, demo): delete A's demo from B's shell must be refused or invisible", isodd,
              xfail="studio#213 (delete wire) / crew#472 (leak)", requires=("DEM-1D", "DEM-2D"))

    # ── THE ONE GOVERNED SCENARIO — serialized, gate rejected ─────────────────
    def tst1() -> str:
        if not GOVERNED_ENABLED:
            raise AssertionError("governed scenario disabled by the operator (SEED_GOVERNED=0) — certification requires the intake-gate "
                                 "rejection proven from the run's events; this journey cannot be skipped (a recon launch convenes the "
                                 "distribution council BEFORE its intake gate, crew#473 — run it serialized, once)")
        A = ctx["A"]
        goto(page, f"/p/{quote(A)}")
        tid(page, "dashboard-campaigns").click()
        page.wait_for_url(re.compile(rf"/p/{re.escape(quote(A))}/campaigns$"), timeout=15_000)
        tid(page, "project-campaigns", project_id=A).wait_for(timeout=15_000)
        tid(page, "testing-campaign-open").wait_for(timeout=30_000)
        tid(page, "testing-campaign-open").click()
        panel = tid(page, "testing-launch-panel", intent="campaign")
        panel.wait_for(timeout=10_000)
        # The panel seeds `projectId` from `initialProjectId` at mount, but the <select>'s OPTIONS
        # come from an async `listProjects()` — until it resolves, a controlled select whose value
        # matches no option reports "" (and the zero-repo hint flashes). Wait for the bound value
        # to become readable, then assert it (run 5 of this suite read it at mount and raced).
        try:
            page.wait_for_function(
                "pid => document.querySelector('[data-testid=\"testing-launch-project\"]')?.value === pid",
                arg=A, timeout=15_000,
            )
        except Exception:  # noqa: BLE001 — report the value the select settled on, not a timeout
            pass
        bound = tid(page, "testing-launch-project").input_value()
        assert bound == A, f"the project selector is not pre-bound to A after the projects list loaded (reads {bound!r})"
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
        rig.needles.append(run_id)
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
            # A pre-gate failure is a FAIL carrying its captured cause — the roster's `signed_in` flags
            # are RECORDED (they can read false while a keychain-backed seat still convenes, §6.9),
            # never used as an excuse; `skip` is not available to this journey at all.
            roster = rig.report["setup"].get("roster_signed_in") or {}
            tail = json.dumps(last_events(run_id, 6))[-1600:]
            ctx["gate_failure_capture"] = {"run": run_id, "status": status, "roster_signed_in": roster, "council": council_activity(run_id), "last_events": last_events(run_id, 6)}
            if status == "failed":
                raise AssertionError(f"run {run_id} FAILED before its intake gate (roster signed_in={roster}, council {council_activity(run_id)}); last events: {tail}")
            if status == "awaiting_human":
                raise AssertionError(f"run {run_id} is awaiting_human on the wire but the launch panel never rendered the gate card; last events: {tail}")
            raise AssertionError(f"run {run_id} never reached its intake gate within {GOVERNED_TIMEOUT_S}s (status {status}, roster signed_in={roster}); last events: {tail}")
        prompt = text_of(gate.locator('[data-testid="steering-prompt"]'))
        assert prompt != "", "the gate card carries no prompt"
        assert run_status(run_id) == "awaiting_human"
        before_gate = council_activity(run_id)
        gate.locator('[data-testid="steering-reject"]').click()
        tid(page, "testing-launch-resolved").wait_for(timeout=30_000)
        final = wait_terminal(run_id, 60)
        assert final == "cancelled", f"rejected run ended {final!r}, expected cancelled"
        view = run_view(run_id)
        proof = assert_execution_prevented(view.get("units"), run_events(run_id))
        ctx["gate_proof"] = proof
        return (f"run {run_id} launched from A (project pre-bound, repo chip via project), parked at its intake gate "
                f"after the distribution council ({before_gate or 'no council events'}), REJECTED in the panel → cancelled; "
                f"event log proves no execution: {proof['units']} planned units {proof['unit_statuses']}, {proof['events']} events, "
                f"none of {sorted(EXECUTION_EVENT_TYPES)}, awaitingHuman@{proof['awaiting_human_at']} → runCancelled@{proof['run_cancelled_at']}; "
                f"prompt: {prompt[:120]!r}")

    suite.run("TST-1", "New test from Project A → intake gate arrives → REJECT (event log proves no execution)", tst1,
              requires=("ATT-1",), governed=True, no_skip=True)

    def tsts() -> str:
        run_id = ctx["test_run"]
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

    suite.run("TST-S", "The test run is scoped: on A's dashboard, absent from B's", tsts, requires=("PRJ-2", "TST-1"))

    def tst2() -> str:
        """Campaign isolation over REAL fixture data, without a governed run. The only daemon writer
        (`POST /campaigns`) LAUNCHES the campaign — every node dispatches a run — so the fixture is
        written the way the engine persists one (`Rig.seed_campaign_record`: the estate `nodes` row,
        terminal status, node scoped to Project A's repo) into the scratch store; `GET /campaigns`
        reads the store read-only per call, so the seed lists without a restart. The body is
        `campaign_isolation_scenario` (module-level, self-tested with the codex probes): a fixture
        write that raises, a non-200/non-list wire, a transport error or a 200 list WITHOUT the seed
        are FAILURES with their cause — never `blocked`; only "seed listed, A renders it, B renders
        it too" is the ONE expected gap (studio#216)."""
        A, B = ctx["A"], ctx["B"]
        proof: dict = {}
        out = campaign_isolation_scenario(
            seed=lambda: rig.seed_campaign_record(CAMPAIGN_ID, CAMPAIGN_NAME, A, REPO_ID),
            get=lambda path: api("GET", path),
            cards=lambda pid: campaign_cards(page, pid),
            campaign_id=CAMPAIGN_ID, repo_id=REPO_ID, a=A, b=B, issue="studio#216", record=proof,
        )
        ctx["campaigns_proof"] = proof
        return out

    suite.run("TST-2", "Tests list is partitioned per project (campaign isolation over a seeded campaign scoped to A's repo)", tst2,
              xfail="studio#216", requires=("PRJ-2", "ATT-1"))

    # ── Run management over TST-1's TERMINAL run — deterministic, no new governed launch ──────
    # The archived run must not be in the shell's default run index (a `run-pending` detail), so
    # the detail journey runs FIRST, then archive → unarchive restores the state the cleanup expects.
    RUN_STORE_IGNORED = {"cliOutputDelta", "unitOutputDelta", "heartbeat"}  # studio store/events.ts IGNORED — never rendered, not even raw

    def work_page(pid_hint: str | None = None) -> None:
        goto(page, "/work")
        page.locator("#work-panel-all").wait_for(timeout=20_000)
        page.wait_for_load_state("networkidle")

    def archived_row_unarchive(rid: str):
        """The Unarchive button that WorkPage renders beside a run-link ONLY inside its Archived
        group (WorkPage.tsx: `<div class="flex …"><div class="flex-1"><RunLink/></div><button>Unarchive`)."""
        return page.locator(f"xpath=//*[@data-testid='run-link' and @data-run-id='{rid}']/ancestor::div[1]/following-sibling::button[normalize-space()='Unarchive']")

    def show_archived(rid: str | None = None) -> None:
        toggle = page.get_by_role("button", name=re.compile(r"^Archived"))
        toggle.wait_for(timeout=15_000)
        if toggle.get_attribute("aria-pressed") != "true":
            toggle.click()
        # The group fetches `GET /runs?include=archived` on toggle-on; settle on its answer.
        page.wait_for_function(
            "() => /Nothing archived\\./.test(document.body.textContent || '') || Array.from(document.querySelectorAll('button')).some(b => (b.textContent || '').trim() === 'Unarchive')",
            timeout=20_000,
        )

    def rundet() -> str:
        """RUN-DET: the run detail after a FULL reload of its legacy address — `/runs/:id` redirects into
        A's shell (`useLegacyRedirect`: the run is filed under A) — renders the cancelled status, the
        rejected intake gate in the narrated feed (`Gate: waiting on you …` then `Run cancelled`, in
        that order), offers nothing actionable (no approval dock), and the raw wire view lists exactly
        the durable events `GET /runs/:id/events` serves (minus the store's never-rendered deltas/heartbeats)."""
        rid, A = ctx["test_run"], ctx["A"]
        wire_status = run_status(rid)
        assert wire_status == "cancelled", f"TST-1's run is {wire_status!r}, not cancelled"
        events = run_events(rid)
        assert isinstance(events, list) and events, "GET /runs/:id/events served no events — nothing to compare the detail against"
        expected_rows = expected_raw_rows(events, rid, RUN_STORE_IGNORED)
        rendered_types = [t for _s, t, _o in expected_rows]
        assert "awaitingHuman" in rendered_types and "runCancelled" in rendered_types, f"the event log lacks the gate/cancel pair: {rendered_types[-8:]}"

        def observe() -> dict:
            goto(page, f"/runs/{quote(rid)}")
            page.wait_for_url(re.compile(rf"/p/{re.escape(quote(A))}/build/{re.escape(quote(rid))}$"), timeout=20_000)
            header = tid(page, "run-header")
            header.wait_for(timeout=30_000)
            assert tid(page, "run-pending").count() == 0, "the detail is stuck in its pending state (run not in the shell's index)"
            status_text = text_of(header)
            # The status CHIP is an element of its own (ChatPanel.tsx `<span>{style.label}</span>`): compare the
            # header's ELEMENT texts to the wire status — never its concatenated textContent (run 11's harness
            # defect: `#1CancelledRetryInspect ▾…` split on whitespace never yields `Cancelled`).
            header_texts = header.evaluate(RUN_HEADER_TEXTS_JS)
            assert header_carries_status(header_texts, wire_status), (
                f"no element of the run header reads the wire status {wire_status!r} (a STATUS_STYLE label): elements {header_texts[:12]}; textContent {status_text[:200]!r}")
            tid(page, "thread").wait_for(timeout=15_000)
            page.wait_for_function(
                "() => { const t = Array.from(document.querySelectorAll('[data-testid=\"narration-line\"]')).map(e => e.textContent || '');"
                " return t.some(x => x.includes('Gate: waiting on you')) && t.some(x => x.includes('Run cancelled')); }",
                timeout=20_000,
            )
            lines = tid(page, "narration-line").all_text_contents()
            gate_at = next(i for i, t in enumerate(lines) if "Gate: waiting on you" in t)
            cancel_at = next(i for i, t in enumerate(lines) if "Run cancelled" in t)
            assert gate_at < cancel_at, f"the feed narrates the cancellation (#{cancel_at}) before the gate (#{gate_at})"
            assert tid(page, "approval-dock").count() == 0 and tid(page, "steering-reject").count() == 0, "a cancelled run still offers an actionable gate"
            tid(page, "feed-view-raw").click()
            page.wait_for_function("n => document.querySelectorAll('[data-testid=\"raw-event\"]').length === n", arg=len(expected_rows), timeout=20_000)
            # Per row, exactly what NarratorFeed.tsx paints as fields (RAW_ROW_EXTRACT_JS — self-tested against a
            # headless replica of the markup): seq column, type, `u<ord>` when present.
            raw_rows = tid(page, "raw-event").evaluate_all(RAW_ROW_EXTRACT_JS)
            identity = assert_raw_view_matches_log(events, raw_rows, rid, RUN_STORE_IGNORED)
            stepper = tid(page, "process-stepper")
            stepper.wait_for(timeout=10_000)
            return {"status": status_text, "gate_line": lines[gate_at][:160], "cancel_line": lines[cancel_at][:80], "raw_events": identity["rows"],
                    "raw_identity": identity, "url": page.url.replace(ORIGIN, "")}

        first = observe()
        second = observe()  # a second FULL load — the same rendering from the durable log
        assert (first["raw_identity"], first["gate_line"], first["cancel_line"]) == (second["raw_identity"], second["gate_line"], second["cancel_line"]), f"the detail changed across reloads: {first} → {second}"
        ctx["run_detail"] = second
        ident = second["raw_identity"]
        return (f"/runs/{rid} → {second['url']} (filed under A); header carries the wire status {wire_status!r}; the narrated feed shows the intake gate "
                f"({second['gate_line']!r}) before {second['cancel_line']!r}; no approval dock; raw view == GET /runs/:id/events BY IDENTITY — the same ordered "
                f"{ident['rows']} (seq, type, ord) rows ({ident['with_seq']} with a seq, first {ident['first']}, last {ident['last']}; {len(events)} frames on the wire, "
                f"{len(events) - len(expected_rows)} delta/heartbeat frames the store never renders); identical on a second full load")

    suite.run("RUN-DET", "Run detail after reload: cancelled status, rejected gate narrated, raw events == API", rundet, requires=("TST-1",))

    def runarc() -> str:
        """RUN-ARC: archive TST-1's terminal run and prove it through the UI. The studio mounts NO
        archive control (WorkPage.tsx: `api.archiveRun(id, false)` — Unarchive — is the only caller),
        so the archive itself is a `[SUBSTITUTE]` over `POST /runs/:id/archive`; the UI then verifies:
        the run leaves the active surfaces (A's dashboard `dashboard-run`, the /work list) and appears
        under /work's Archived toggle with its Unarchive control — after a FULL reload, twice."""
        rid, A = ctx["test_run"], ctx["A"]
        goto(page, f"/p/{quote(A)}")
        tid(page, "dashboard-run", run_id=rid).wait_for(timeout=30_000)
        work_page()
        listed_before = tid(page, "run-link", run_id=rid).count() > 0
        show_archived()
        assert archived_row_unarchive(rid).count() == 0, "the run is already under Archived before the archive step"
        # [SUBSTITUTE] — no UI control archives a run (WorkPage mounts Unarchive only).
        st, body = api("POST", f"/runs/{quote(rid)}/archive", {"archived": True, "note": f"seed-surfaces {STAMP}: RUN-ARC write-off of the rejected TST-1 run"})
        assert st == 200 and body == {"runId": rid, "archived": True}, f"POST /runs/{rid}/archive → {st} {body}"
        view = run_view(rid)
        assert view["session"].get("archived_at"), f"the run view carries no archived_at after the archive: {view['session'].get('archived_at')!r}"
        assert rid not in {v["session"]["id"] for v in list_runs()}, "the default GET /runs still lists the archived run"
        st2, all_runs = api("GET", "/runs?include=archived")
        assert st2 == 200 and rid in {v["session"]["id"] for v in all_runs["runs"]}, "GET /runs?include=archived does not carry the archived run"
        # UI, after a FULL reload: gone from the active surfaces …
        goto(page, f"/p/{quote(A)}")
        tid(page, "project-dashboard", project_id=A).wait_for(timeout=20_000)
        page.wait_for_load_state("networkidle")
        assert tid(page, "dashboard-run", run_id=rid).count() == 0, "A's dashboard still lists the archived run"
        work_page()
        assert tid(page, "run-link", run_id=rid).count() == 0, "/work's active list still shows the archived run"
        # … and present under Archived, with the Unarchive control, on two consecutive full loads.
        show_archived()
        archived_row_unarchive(rid).wait_for(timeout=15_000)
        row = tid(page, "run-link", run_id=rid)
        assert row.get_attribute("data-status") == "cancelled", f"archived row status {row.get_attribute('data-status')!r}"
        work_page()
        show_archived()
        archived_row_unarchive(rid).wait_for(timeout=15_000)
        ctx["run_archived"] = True
        return (f"[SUBSTITUTE] run {rid} archived over POST /runs/:id/archive (the studio mounts no archive control — WorkPage.tsx's only "
                f"`archiveRun` call is Unarchive); wire: archived_at set, default GET /runs excludes it, ?include=archived carries it; UI after a full reload: "
                f"A's dashboard no longer lists it, /work's active list does not ({'it was listed there before' if listed_before else 'it was not in /work''s active list before either — no workflow_id'}), "
                f"the Archived toggle shows it (status cancelled) with its Unarchive control — again after a second full load")

    suite.run("RUN-ARC", "Archive the terminal run ([SUBSTITUTE] API — no UI control) → leaves active surfaces, listed under Archived; reload persists", runarc, requires=("RUN-DET",))

    def rununarc() -> str:
        """RUN-UNARC: the mounted UI control — WorkPage's Unarchive beside the archived row — restores
        the run: it leaves the Archived group, the wire clears `archived_at`, the default listing and
        A's dashboard carry it again after a FULL reload."""
        rid, A = ctx["test_run"], ctx["A"]
        work_page()
        show_archived()
        button = archived_row_unarchive(rid)
        button.wait_for(timeout=15_000)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith(f"/runs/{quote(rid)}/archive"), timeout=15_000) as ack:
            button.click()
        assert ack.value.status == 200, f"POST /runs/:id/archive (unarchive) → HTTP {ack.value.status}"
        button.wait_for(state="detached", timeout=15_000)
        view = run_view(rid)
        assert not view["session"].get("archived_at"), f"archived_at still set after Unarchive: {view['session'].get('archived_at')!r}"
        assert rid in {v["session"]["id"] for v in list_runs()}, "the default GET /runs does not list the restored run"
        goto(page, f"/p/{quote(A)}")
        tid(page, "dashboard-run", run_id=rid).wait_for(timeout=30_000)
        work_page()
        show_archived()
        assert archived_row_unarchive(rid).count() == 0, "the run is still under Archived after Unarchive + reload"
        ctx["run_archived"] = False
        return (f"Unarchive clicked beside run {rid} in /work's Archived group (WorkPage.tsx, the mounted control) → POST /runs/:id/archive 200; "
                f"the row left the group, archived_at is null on the wire, the default GET /runs lists it; after a full reload A's dashboard renders it again and Archived no longer holds it")

    suite.run("RUN-UNARC", "Unarchive through WorkPage's control → back on active surfaces; reload persists", rununarc, requires=("RUN-ARC",))

    # ── Cleanup — only after every consumer ───────────────────────────────────
    # CLN-1 PER TARGET: one row per seeded doc/demo — an ExpectedGap on the first never hides the rest.
    targets = [(pid, "document", name) for pid, name in ctx["docs"]] + [(pid, "video", name) for pid, name in ctx["demos"]]
    if targets:
        # The OTHER project is the bilateral control: a refused delete may not re-file the artifact there.
        other = {ctx.get("A"): ctx.get("B"), ctx.get("B"): ctx.get("A")}
        run_delete_rows(suite, targets, lambda pid, mode, name: ui_delete_doc(page, pid, mode, name, bridge_gap_issue="studio#213", foreign=other.get(pid)), "studio#213")
    else:
        def cln1_nothing() -> str:
            raise Blocked("nothing was seeded to delete — the seed scenarios (VIB-1D/VIB-2D/DEM-1D) did not run")

        suite.run("CLN-1a", "Delete every seeded document/demo through the UI", cln1_nothing)

    def clnstr() -> str:
        seed = ctx.get("rule_seed_api")
        if seed is None:
            raise Skip("no API-seeded rule to retire — STR-1 authored the first rule through the UI")
        goto(page, "/steering/policies")
        steering_rows_loaded(page)
        ui_retire_rule(seed, f"seed-surfaces suite {STAMP}: retiring the STR-1S substitute seed")
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
        expect_gap(
            f"/projects/{quote(A)}" in page.url and archive.count() > 0, "studio#214",
            f"ProjectDetailPage (the only Archive/Restore control, ProjectDetailPage.tsx) is unreachable: /projects/{A} "
            f"redirected to {page.url.replace(ORIGIN, '')} (useLegacyRedirect) — no reachable UI affordance archives or restores a project",
        )
        archive.click()
        page.wait_for_function("() => document.body.textContent.includes('archived')", timeout=10_000)
        st, detail = api("GET", f"/projects/{quote(A)}")
        assert st == 200 and detail["project"]["status"] == "archived", f"archive did not persist: {detail.get('project')}"
        return "archived through ProjectDetailPage; server row status=archived"

    suite.run("CLN-2", "Archive a project through the UI (ProjectDetailPage → Archive)", cln2, xfail="studio#214", requires=("PRJ-1",))

    def cln2s() -> str:
        A, B = ctx["A"], ctx["B"]
        for pid in (A, B):
            st, detail = api("GET", f"/projects/{quote(pid)}")
            if st == 200 and detail["project"]["status"] == "archived":
                continue  # CLN-2 archived it through the UI
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
            findings.append("CLN-2 (studio#214): no reachable UI affordance archives/restores a project — /projects/:id (ProjectDetailPage) redirects to /p/:id")
        return "[SUBSTITUTE] both projects archived over PATCH /projects/:id; UI verifies: no active card, both listed under the archived toggle"

    suite.run("CLN-2S", "Archive both projects (API substitute, UI-verified)", cln2s, requires=("PRJ-1", "PRJ-2"))

    rig.report["console_errors"] = console_errors[:20]


# ── RUN-DET's DOM readers (shared by the scenario and the self-test) ──────────

RUN_HEADER_TEXTS_JS = "h => Array.from(h.querySelectorAll('*')).map(e => (e.textContent || '').trim()).filter(t => t !== '')"
"""Every ELEMENT's own text inside `run-header` — the status chip (`ChatPanel.tsx`: `<span …>{style.label}</span>`,
labels from `RunCard.tsx STATUS_STYLE`) is one of them. Run 11 read the header's whole `textContent` and split it
on whitespace; the row's children concatenate without separators (`←New test · 10a592 · #1CancelledRetryInspect ▾…`),
so `Cancelled` never appeared as a word and RUN-DET failed on a HARNESS defect. Element identity, not string surgery."""

RAW_ROW_EXTRACT_JS = (
    "els => els.map(e => { const k = Array.from(e.children); const seq = (k[0] ? k[0].textContent : '').trim();"
    " const ordEl = k.slice(2).find(x => !x.classList.contains('truncate') && /^u\\d+$/.test((x.textContent || '').trim()));"
    " return { seq: seq === '' ? null : Number(seq), type: k[1] ? k[1].textContent : '',"
    " ord: ordEl ? Number(ordEl.textContent.trim().slice(1)) : null }; })"
)
"""Per `raw-event` row, exactly the fields NarratorFeed.tsx paints: children[0] = the seq column (blank when the
frame has none), children[1] = the type, then `u<ord>` when `ord` is a number, then the narration (`truncate`)."""


def header_carries_status(element_texts: list[str], wire_status: str) -> bool:
    """Does the run header carry the WIRE status as an element of its own? `STATUS_STYLE` labels are the status
    capitalised with spaces for underscores (`awaiting_human` → `Awaiting human`), so an element's text normalised
    (strip, lower, spaces → `_`) must EQUAL the status. A concatenation such as `#1CancelledRetry` is NOT a match —
    the run-11 defect this replaces split that string on whitespace and found no word; a substring test would
    have accepted it and any other stray occurrence. Pure; self-tested with run 11's exact header text."""
    want = wire_status.strip().lower()
    return any(t.strip().lower().replace(" ", "_") == want for t in element_texts if isinstance(t, str))


# ── Self-test of the harness's own safety plumbing ────────────────────────────


def self_test() -> int:
    global KEEP_TMP
    results: dict[str, bool] = {}
    # 1. exit semantics: report.ok is the ONLY thing the exit code reads
    results["exit_nonzero_when_report_not_ok"] = exit_code({"ok": False}) != 0
    results["exit_zero_when_report_ok"] = exit_code({"ok": True}) == 0
    rep = finalize({"live_touched": ["~/.wicked-crew/interactive-drafts/seed-doc-a-0"]}, suite_ok=True)
    results["live_touched_forces_nonzero_even_when_suite_ok"] = rep["ok"] is False and exit_code(rep) != 0
    results["setup_failure_forces_nonzero"] = exit_code(finalize({"setup_failure": {"step": "guard"}}, suite_ok=True)) != 0
    results["abort_forces_nonzero"] = exit_code(finalize({"aborted": "interrupted"}, suite_ok=True)) != 0
    results["clean_run_exits_zero"] = exit_code(finalize({"live_touched": []}, suite_ok=True)) == 0
    results["failed_scenario_exits_nonzero"] = exit_code(finalize({"live_touched": []}, suite_ok=False)) != 0
    # 2. xfail hygiene: only the ExpectedGap tied to the issue is excused
    s = Suite()

    def plain_failure() -> str:
        raise AssertionError("unrelated regression")

    def blocked() -> str:
        raise Blocked("needs a fan")

    s.run("T-plain", "plain assertion inside an xfail scenario", plain_failure, xfail="issue#0")
    s.run("T-gap", "expected gap inside an xfail scenario", lambda: expect_gap(False, "issue#0", "leak"), xfail="issue#0")
    s.run("T-xpass", "xfail scenario that passes", lambda: "fine", xfail="issue#0")
    s.run("T-gap-nomarker", "expected gap WITHOUT an xfail marker", lambda: expect_gap(False, "issue#0", "leak"))
    s.run("T-blocked", "explicitly blocked", blocked)
    by_id = {r["id"]: r["status"] for r in s.rows}
    results["plain_assertion_in_xfail_is_fail"] = by_id["T-plain"] == "fail"
    results["expected_gap_in_xfail_is_xfail"] = by_id["T-gap"] == "xfail"
    results["passing_xfail_is_xpass"] = by_id["T-xpass"] == "xpass"
    results["expected_gap_without_marker_is_fail"] = by_id["T-gap-nomarker"] == "fail"
    results["blocked_is_blocked_not_skip"] = by_id["T-blocked"] == "blocked"
    results["suite_ok_false_with_fail_or_xpass"] = s.ok is False
    # 3. the VIB-3 oracle: empty/ownership states are FAILs, only the leak is the gap
    def oracle_raises(a, b, cls) -> bool:
        try:
            disjoint_pickers_oracle(a, b, "doc-a", "doc-b", "issue#0")
        except cls as e:
            return type(e) is cls
        except AssertionError:
            return False
        return False
    results["vib3_empty_lists_is_plain_fail"] = oracle_raises([], [], AssertionError)
    results["vib3_missing_own_doc_is_plain_fail"] = oracle_raises(["doc-b"], ["doc-b"], AssertionError)
    results["vib3_leak_is_expected_gap"] = oracle_raises(["doc-a", "doc-b"], ["doc-b", "doc-a"], ExpectedGap)
    try:
        disjoint_pickers_oracle(["doc-a"], ["doc-b"], "doc-a", "doc-b", "issue#0")
        results["vib3_disjoint_passes"] = True
    except AssertionError:
        results["vib3_disjoint_passes"] = False
    # 4. the gate oracle: missing units / any execution event / no cancellation are failures
    good_events = [{"type": "sessionStarted"}, {"type": "unitPlanned"}, {"type": "councilConvened"}, {"type": "unitDistributed"},
                   {"type": "awaitingHuman", "ord": 1}, {"type": "runCancelled"}]
    good_units = [{"ord": 1, "status": "distributed"}, {"ord": 2, "status": "pending"}]

    def gate_raises(units, events) -> bool:
        try:
            assert_execution_prevented(units, events)
        except AssertionError:
            return True
        return False
    results["gate_missing_units_fails"] = gate_raises(None, good_events) and gate_raises([], good_events)
    results["gate_execution_event_fails"] = gate_raises(good_units, good_events[:5] + [{"type": "unitExecuting", "ord": 1}, {"type": "runCancelled"}])
    results["gate_done_unit_fails"] = gate_raises([{"ord": 1, "status": "done"}], good_events)
    results["gate_no_cancel_fails"] = gate_raises(good_units, good_events[:5])
    results["gate_clean_passes"] = not gate_raises(good_units, good_events)
    # 5. pid identity: never trust a daemon-written pid blindly
    results["valid_pid_rejects_zero_negative_one_bool_str_none"] = not any(valid_pid(v) for v in (0, -1, 1, True, "12", None, 3.0))
    results["valid_pid_accepts_ordinary_pid"] = valid_pid(os.getpid())
    scratch = Path(mkdtemp(prefix="seed-selftest-"))
    try:
        (scratch / ".wi-serve.json").symlink_to("/etc/hosts")
        lock, state = read_bridge_lock(scratch)
        results["symlinked_lock_refused"] = lock is None and state.startswith("refused")
        (scratch / ".wi-serve.json").unlink()
        (scratch / ".wi-serve.json").write_text(json.dumps({"pid": 0, "port": 1}))
        lock, state = read_bridge_lock(scratch)
        results["lock_pid_zero_is_not_signallable"] = lock is not None and not valid_pid(lock.get("pid"))
        found = bridge_processes(scratch, 0)
        results["own_process_never_identified_as_bridge"] = os.getpid() not in {p["pid"] for p in found["identified"] + found["unverified"]}
        results["stale_older_process_excluded"] = all(p["started_at"] >= time.time() - 5 for p in bridge_processes(scratch, time.time())["identified"])
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    # 6. bridge identity fails closed (codex r2 item 8): a candidate with NO readable start time is
    #    unverified (never identified ⇒ never signalled); a failed `ps` makes the whole lookup unverified.
    fake_rows = [
        {"pid": 4242, "pgid": 4242, "ppid": 1, "command": f"node wicked-interactive serve --root {scratch}/idocs"},
        {"pid": 4343, "pgid": 4343, "ppid": 1, "command": f"node wicked-interactive serve --root {scratch}/idocs"},
    ]
    found = bridge_processes(scratch / "idocs", 100.0, ps=lambda: (fake_rows, None), started_at=lambda pid: None if pid == 4242 else 200.0)
    results["bridge_unverified_start_time_is_not_identified"] = (
        [p["pid"] for p in found["identified"]] == [4343] and [p["pid"] for p in found["unverified"]] == [4242] and found["ps_ok"]
    )
    found = bridge_processes(scratch / "idocs", 100.0, ps=lambda: ([], "ps exited 1"), started_at=lambda pid: 200.0)
    results["bridge_ps_failure_is_unverified"] = found["ps_ok"] is False and found["identified"] == []
    results["teardown_flags_unverified_bridge_identity"] = any(
        f.startswith("bridge_identity_unverified") for f in teardown_failures({"bridge": {"identity_unverified": "ps failed"}}))
    # 7. teardown affects the verdict (item 2): every failure kind is named, and finalize refuses ok.
    all_bad = {
        "cancelled_runs": [{"run": "r1", "before": "running", "accepted": False, "final": "running", "verified_terminal": False}],
        "daemon": {"pid": 1, "forced": True, "exit_code": None, "group_empty": False}, "daemon_stopped": False,
        "bridge": {"terminated": {"signalled": [9], "forced": [9], "remaining": [9]}, "identity_unverified": "no start time",
                   "enumeration_failed": "ps exited 1", "unidentified_alive": "lock pid 7 alive", "not_from_pinned_cache": "ran from elsewhere",
                   "lock_pid_invalid": "pid [] (list)", "lock_unreadable": "unreadable: UnicodeDecodeError: invalid start byte"},
        "browser_close_error": "Target closed",
        "tmp": "/x", "tmp_removed": False, "tmp_remove_error": "EBUSY",
        "isolation_scan_error": "PermissionError: scan aborted",
        "isolation_scan": {"scan_errors": [{"file": "/x/y", "errno": 13, "error": "PermissionError: Permission denied", "stage": "scandir"}],
                           "live_7701": {"observation_lost": True, "runs_before": 46, "error_after": "Connection refused"}},
        "step_errors": ["stop_bridge: RuntimeError: boom"],
    }
    fails = teardown_failures(all_bad)
    kinds = {f.split(":")[0] for f in fails}
    results["teardown_names_every_failure_kind"] = {
        "run_cancel_failed", "daemon_not_stopped", "bridge_survived_sigkill", "bridge_identity_unverified", "bridge_enumeration_failed",
        "bridge_unidentified_alive", "bridge_not_from_pinned_cache", "bridge_lock_pid_invalid", "bridge_lock_unreadable", "browser_close_error",
        "tmp_not_removed", "isolation_scan_failed", "live_scan_error", "live_observation_lost", "teardown_step_raised",
    } <= kinds
    rep = finalize({"live_touched": [], "setup": {"teardown": {"failures": fails}}}, suite_ok=True)
    results["teardown_failures_force_ok_false_and_nonzero_exit"] = rep["ok"] is False and exit_code(rep) != 0
    results["clean_teardown_keeps_ok"] = teardown_failures({
        "cancelled_runs": [], "daemon": {"group_empty": True}, "daemon_stopped": True,
        "bridge": {"terminated": {"remaining": []}}, "tmp_removed": True, "isolation_scan": {"scan_errors": []}, "step_errors": [],
    }) == [] and finalize({"live_touched": [], "setup": {"teardown": {"failures": []}}}, suite_ok=True)["ok"] is True
    # 8. the gate journey can never skip (item 3): a Skip inside, a missing prerequisite, and SEED_GOVERNED=0
    #    all land as FAIL; an execution event after the gate fails the oracle.
    g = Suite()

    def skipper() -> str:
        raise Skip("roster shows no signed-in seat")

    g.run("G-skip", "gate scenario raising Skip", skipper, no_skip=True)
    g.run("G-prereq", "gate scenario with a failed prerequisite", lambda: "unreachable", requires=("ATT-X",), no_skip=True)
    by_id = {r["id"]: r["status"] for r in g.rows}
    results["gate_skip_becomes_fail"] = by_id["G-skip"] == "fail"
    results["gate_missing_prereq_becomes_fail"] = by_id["G-prereq"] == "fail"
    results["skipped_gate_suite_exits_nonzero"] = g.ok is False and exit_code(finalize({"live_touched": [], "setup": {}}, suite_ok=g.ok)) != 0
    results["gate_execution_after_rejection_fails"] = gate_raises(good_units, good_events + [{"type": "unitExecuting", "ord": 1}])
    # 9. the isolation scan fails closed (item 4): an unreadable file is a recorded error (its readable
    #    sibling is still scanned); a stat error is recorded too — and both are `live_scan_error`.
    scan_root = Path(mkdtemp(prefix="seed-selftest-scan-"))
    try:
        (scan_root / "readable.log").write_bytes(b"prefix e2e-scope-selftest suffix")
        (scan_root / "secret.log").write_bytes(b"e2e-scope-selftest")

        def opener(p: Path):
            if p.name == "secret.log":
                raise PermissionError(13, "Permission denied")
            return p.open("rb")

        tree = scan_tree([scan_root], 0.0, [b"e2e-scope-selftest"], opener)
        results["scan_read_error_is_recorded_not_swallowed"] = (
            any(e["file"].endswith("secret.log") and e["errno"] == 13 for e in tree["scan_errors"])
            and any(h["file"].endswith("readable.log") for h in tree["hits"])
        )
        found_hits, err = scan_file_for(scan_root / "secret.log", [b"e2e-scope-selftest"], opener)
        results["scan_permission_error_is_not_an_empty_hit_list"] = err is not None and err["errno"] == 13 and found_hits == []
        real_stat = Path.stat

        def flaky_stat(self: Path, *a, **k):
            if self.name == "readable.log":
                raise PermissionError(13, "Permission denied")
            return real_stat(self, *a, **k)

        Path.stat = flaky_stat  # type: ignore[method-assign]
        try:
            tree2 = scan_tree([scan_root], 0.0, [b"e2e-scope-selftest"])
        finally:
            Path.stat = real_stat  # type: ignore[method-assign]
        results["scan_stat_error_is_recorded"] = any(e["file"].endswith("readable.log") for e in tree2["scan_errors"])
        results["scan_errors_are_live_scan_error_failures"] = any(
            f.startswith("live_scan_error") for f in teardown_failures({"isolation_scan": {"scan_errors": tree["scan_errors"]}}))
    finally:
        shutil.rmtree(scan_root, ignore_errors=True)
    # 10. campaign isolation oracle (r3 item 1): the wire must be 200 + a list THAT CARRIES THE SEED
    #     (a 500 body is a FAIL, never "zero campaigns"); A must render its own card (ownership, plain);
    #     B rendering the seed is the ONE expected gap; any other card on B is a plain FAIL; the
    #     partitioned answer returns.
    def camp_raises(st, body, a, b, cls=AssertionError) -> bool:
        try:
            campaigns_isolation_oracle(st, body, "c1", a, b, "issue#0")
        except cls as e:
            return type(e) is cls
        except AssertionError:
            return False
        return False
    results["campaigns_500_is_fail"] = camp_raises(500, {"error": "database unavailable"}, ["c1"], [])
    results["campaigns_200_without_list_is_fail"] = camp_raises(200, {"ok": True}, ["c1"], [])
    results["campaigns_seed_unlisted_is_fail"] = camp_raises(200, {"campaigns": []}, ["c1"], [])
    results["campaigns_owner_missing_card_is_fail"] = camp_raises(200, {"campaigns": [{"id": "c1"}]}, [], [])
    results["campaigns_b_carrying_seed_is_expected_gap"] = camp_raises(200, {"campaigns": [{"id": "c1"}]}, ["c1"], ["c1"], ExpectedGap)
    results["campaigns_foreign_card_on_b_is_fail"] = camp_raises(200, {"campaigns": [{"id": "c1"}, {"id": "zz"}]}, ["c1"], ["zz"])
    results["campaigns_partitioned_passes"] = not camp_raises(200, {"campaigns": [{"id": "c1"}]}, ["c1"], []) and not camp_raises(200, {"campaigns": [{"id": "c1"}]}, ["c1"], [], ExpectedGap)
    # 11. build identity is bytes (item 6): same label + different bytes, or a missing asset, is a mismatch.
    dist = {"index.html": "aa" * 32, "assets/index-X.js": "bb" * 32}
    results["build_identical_bytes_pass"] = compare_build(dist, dict(dist)) == []
    results["build_same_label_different_bytes_fail"] = compare_build(dist, {"index.html": "aa" * 32, "assets/index-X.js": "cc" * 32}) != []
    results["build_missing_asset_fail"] = compare_build(dist, {"index.html": "aa" * 32, "assets/other.js": "bb" * 32}) != []
    results["build_no_dist_fail"] = compare_build({}, {"index.html": "aa" * 32}) != []
    results["build_no_index_served_fail"] = compare_build(dist, {"assets/index-X.js": "bb" * 32}) != []
    # 12. CLN-1 per target (item 7): an ExpectedGap on the first target never stops the others.
    d = Suite()
    attempted: list[str] = []

    def deleter(pid: str, mode: str, name: str) -> None:
        attempted.append(name)
        if name == "doc-a":
            raise ExpectedGap("issue#0: predates DELETE")

    rows = run_delete_rows(d, [("A", "document", "doc-a"), ("B", "document", "doc-b"), ("A", "video", "demo-a")], deleter, "issue#0")
    statuses = {r["id"]: r["status"] for r in d.rows}
    results["cleanup_each_target_attempted"] = attempted == ["doc-a", "doc-b", "demo-a"] and rows == ["CLN-1a", "CLN-1b", "CLN-1c"]
    results["cleanup_gap_on_one_does_not_hide_others"] = statuses["CLN-1a"] == "xfail" and statuses["CLN-1b"] == "xpass" and statuses["CLN-1c"] == "xpass"
    # 13. VIB persistence content oracle (item 9): equal captures pass; a changed body/head/lineage fails.
    cap = {"rendered_html_sha256": "h1", "rendered_text": "hello", "head": 0, "lineage": [0], "head_html_sha256": "d1"}

    def pers_raises(after) -> bool:
        try:
            persistence_oracle(cap, after)
        except AssertionError:
            return True
        return False
    results["persistence_identical_passes"] = not pers_raises(dict(cap))
    results["persistence_changed_body_fails"] = pers_raises({**cap, "head_html_sha256": "d2"})
    results["persistence_changed_head_fails"] = pers_raises({**cap, "head": 1, "lineage": [0, 1]})
    results["persistence_changed_rendered_fails"] = pers_raises({**cap, "rendered_html_sha256": "h2"})
    results["persistence_missing_key_fails"] = pers_raises({k: v for k, v in cap.items() if k != "lineage"})
    # 14. the committed report carries no operator home path.
    results["report_scrub_removes_home"] = str(REAL_HOME) not in scrub_report_text(json.dumps({"p": f"{REAL_HOME}/.wicked-crew/x", "q": f"/private{REAL_HOME}/y"}))
    import tempfile as _tempfile
    _tmp_root = _tempfile.gettempdir().rstrip("/")
    results["report_scrub_removes_tmp_root"] = (_tmp_root == "/tmp" or _tmp_root not in scrub_report_text(json.dumps({"c": f"node /private{_tmp_root}/seed-surfaces-x/idocs", "d": f"{_tmp_root}/y"})))
    # 15. the isolation scan fails closed on DIRECTORY ENUMERATION (r3 item 3a): a subdirectory whose
    #     `scandir` raises is a `scan_errors` entry (stage scandir) while its readable sibling is still
    #     scanned; an unreadable root is an error, never an empty clean result.
    enum_root = Path(mkdtemp(prefix="seed-selftest-enum-"))
    try:
        (enum_root / "ok.log").write_bytes(b"e2e-scope-selftest")
        (enum_root / "locked").mkdir()
        (enum_root / "locked" / "hidden.log").write_bytes(b"e2e-scope-selftest")
        real_scandir = os.scandir

        def flaky_scandir(p):
            if str(p).endswith("locked"):
                raise PermissionError(13, "Permission denied")
            return real_scandir(p)

        def dead_scandir(p):
            raise PermissionError(13, "Permission denied")

        tree = scan_tree([enum_root], 0.0, [b"e2e-scope-selftest"], scandir=flaky_scandir)
        results["scan_enumeration_error_is_recorded_sibling_still_scanned"] = (
            any(e.get("stage") == "scandir" and e["errno"] == 13 and e["file"].endswith("locked") for e in tree["scan_errors"])
            and any(h["file"].endswith("ok.log") for h in tree["hits"])
        )
        results["scan_enumeration_error_is_live_scan_error"] = any(
            f.startswith("live_scan_error") for f in teardown_failures({"isolation_scan": {"scan_errors": tree["scan_errors"]}}))
        dead = scan_tree([enum_root], 0.0, [b"e2e-scope-selftest"], scandir=dead_scandir)
        results["scan_unreadable_root_is_error_not_clean"] = bool(dead["scan_errors"]) and dead["modified"] == [] and dead["hits"] == []
    finally:
        shutil.rmtree(enum_root, ignore_errors=True)
    # 16. bridge-stop planning fails closed (r3 items 3b/3c): a failed `ps` signals NOTHING — not even a
    #     partially identified row — and is a failure; an ALIVE lock pid nobody identified is refused AND
    #     a failure; a dead stale lock pid is not; the identified + matching case signals cleanly.
    ident = {"pid": 4242, "pgid": 4242, "ppid": 1, "command": "node wicked-interactive serve --root /x/idocs", "started_at": 200.0}
    pids, info = plan_bridge_stop({"identified": [ident], "unverified": [], "ps_ok": False, "ps_error": "ps exited 1"}, None, "/x/idocs", alive=lambda p: True)
    results["bridge_failed_ps_signals_nothing_even_partial_rows"] = pids == [] and "enumeration_failed" in info
    results["bridge_failed_ps_is_teardown_failure"] = any(f.startswith("bridge_enumeration_failed") for f in teardown_failures({"bridge": info}))
    pids, info = plan_bridge_stop({"identified": [], "unverified": [], "ps_ok": True, "ps_error": None}, 5150, "/x/idocs", alive=lambda p: True)
    results["bridge_alive_unidentified_lock_pid_is_refused"] = pids == [] and "unidentified_alive" in info
    results["bridge_alive_unidentified_lock_pid_is_teardown_failure"] = any(f.startswith("bridge_unidentified_alive") for f in teardown_failures({"bridge": info}))
    pids, info = plan_bridge_stop({"identified": [ident], "unverified": [], "ps_ok": True, "ps_error": None}, 4242, "/x/idocs", alive=lambda p: True)
    results["bridge_identified_matching_lock_signals_cleanly"] = pids == [4242] and teardown_failures({"bridge": {**info, "terminated": {"remaining": []}}}) == []
    pids, info = plan_bridge_stop({"identified": [], "unverified": [], "ps_ok": True, "ps_error": None}, 5150, "/x/idocs", alive=lambda p: False)
    results["bridge_dead_stale_lock_pid_is_not_a_failure"] = pids == [] and teardown_failures({"bridge": info}) == []
    results["teardown_flags_bridge_not_from_pinned_cache"] = any(f.startswith("bridge_not_from_pinned_cache") for f in teardown_failures({"bridge": {"not_from_pinned_cache": "x"}}))
    # 17. DEM-REC classification (r3 item 4): only the established prerequisite with a 2xx ack is blocked.
    prereq = "Recording failed: no demo.spec.mjs authored yet — the agent must write the spec before recording"
    results["recorder_unrelated_error_is_fail"] = classify_recorder_answer(200, "Recording failed: database corrupt", False)[0] == "fail"
    results["recorder_http_500_then_timeout_is_fail"] = classify_recorder_answer(500, None, True)[0] == "fail"
    results["recorder_http_500_with_prereq_is_fail"] = classify_recorder_answer(500, prereq, False)[0] == "fail"
    results["recorder_timeout_is_fail"] = classify_recorder_answer(200, None, True)[0] == "fail"
    results["recorder_missing_ack_is_fail"] = classify_recorder_answer(None, prereq, False)[0] == "fail"
    results["recorder_prereq_with_2xx_ack_is_blocked"] = classify_recorder_answer(202, prereq, False)[0] == "blocked"
    results["recorder_missing_browser_with_2xx_ack_is_blocked"] = classify_recorder_answer(
        200, "Recording failed: browserType.launch: Executable doesn't exist at /scratch/ms-playwright/chromium", False)[0] == "blocked"
    # 18. cleanup continuity (r3 item 5): every step runs past a raise (pure), and the REAL Rig teardown
    #     still removes the temp dir when the scratch-writes inspection raises.
    attempted_steps: list[str] = []

    def step_raise() -> None:
        attempted_steps.append("b")
        raise RuntimeError("boom")

    errs = run_teardown_steps([("a", lambda: attempted_steps.append("a")), ("b", step_raise), ("c", lambda: attempted_steps.append("c"))])
    results["teardown_steps_all_run_past_a_raise"] = attempted_steps == ["a", "b", "c"] and errs == ["b: RuntimeError: boom"]
    rig = Rig.__new__(Rig)
    rig.report = {"setup": {}}
    rig.tmp = Path(mkdtemp(prefix="seed-selftest-rig-")).resolve()
    rig.home, rig.tmpdir, rig.idocs = rig.tmp / "home", rig.tmp / "tmp", rig.tmp / "idocs"
    rig.home.mkdir(); rig.tmpdir.mkdir()
    (rig.home / "written.txt").write_text("x")
    rig.daemon = None; rig.daemon_log = None; rig.fixture_httpd = None
    rig.run_started_at = time.time(); rig.daemon_started_at = None
    rig.needles = []; rig.live_before = {"reachable": False, "run_ids": []}

    def inspection_boom(*_a, **_k):
        raise RuntimeError("inspection boom")

    rig.scratch_writes = inspection_boom  # type: ignore[method-assign]
    rig.stop_bridge = lambda: {}  # type: ignore[method-assign]
    rig.scan_operator_state = lambda: {  # type: ignore[method-assign]
        "stamped_entries_in_live_state_home": [], "identifier_hits": [], "scan_errors": [],
        "live_7701": {"new_run_ids": [], "new_runs_carrying_our_identifiers": []},
    }
    keep_before = KEEP_TMP
    KEEP_TMP = False
    try:
        rig_findings: list[str] = []
        rig.teardown(rig_findings)
    finally:
        KEEP_TMP = keep_before
        shutil.rmtree(rig.tmp, ignore_errors=True)
    t_rec = rig.report["setup"]["teardown"]
    results["teardown_inspection_failure_does_not_block_tmp_removal"] = (
        t_rec.get("tmp_removed") is True and any(e.startswith("scratch_writes: RuntimeError") for e in t_rec["step_errors"]) and "isolation_scan" in t_rec)
    results["teardown_inspection_failure_is_verdict_failure"] = any(f.startswith("teardown_step_raised: scratch_writes") for f in t_rec["failures"])
    rep = finalize({"live_touched": [], "setup": {"browser_close_error": "Target closed", "teardown": {"failures": []}}}, suite_ok=True)
    results["browser_close_error_forces_ok_false"] = rep["ok"] is False and any(f.startswith("browser_close_error") for f in rep["teardown_failures"])
    # 19. bridge pin (r3 item 6): no cache / a version drift / a missing integrity are ERRORS (setup
    #     failures — never a registry fallback); the exact version resolves with its sha512.
    npx = Path(mkdtemp(prefix="seed-selftest-npx-"))
    try:
        results["bridge_pin_no_cache_is_error"] = "error" in resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1")

        GOOD_INTEGRITY = "sha512-" + "A" * 86 + "=="

        def mk(key: str, version: str, integrity: object = True, lock_version: str | None = None, hidden: object = True) -> Path:
            """A fake `_npx/<key>` install: installed package.json `version`; root lock entry
            (`lock_version` defaults to `version`; `integrity` True = well-formed, False = absent, str =
            that literal); npm's hidden lockfile (`hidden` True = same entry, False = absent, str = that
            integrity)."""
            d = npx / key
            (d / "node_modules" / "wicked-interactive").mkdir(parents=True)
            (d / "package.json").write_text(json.dumps({"_npx": {"packages": [INTERACTIVE_SPEC]}}))
            (d / "node_modules" / "wicked-interactive" / "package.json").write_text(json.dumps({"name": "wicked-interactive", "version": version}))
            entry: dict = {"version": lock_version or version, "resolved": f"https://registry.npmjs.org/wicked-interactive/-/wicked-interactive-{version}.tgz"}
            if integrity is True:
                entry["integrity"] = GOOD_INTEGRITY
            elif isinstance(integrity, str):
                entry["integrity"] = integrity
            (d / "package-lock.json").write_text(json.dumps({"packages": {"node_modules/wicked-interactive": entry}}))
            if hidden is not False:
                h = dict(entry)
                if isinstance(hidden, str):
                    h["integrity"] = hidden
                (d / "node_modules" / ".package-lock.json").write_text(json.dumps({"packages": {"node_modules/wicked-interactive": h}}))
            return d

        mk("k1", "0.9.0")
        results["bridge_pin_version_drift_is_error"] = "error" in resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1")
        mk("k2", "0.8.1", integrity=False)
        results["bridge_pin_missing_integrity_is_error"] = "error" in resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1")
        shutil.rmtree(npx / "k2")
        # r4 item 4 — lock metadata is VALIDATED, not merely present: a lock naming another version
        # than the installed tree, a malformed integrity, a missing or disagreeing hidden lockfile.
        mk("k2", "0.8.1", lock_version="9.9.9")
        results["bridge_pin_lock_version_mismatch_is_error"] = "9.9.9" in str(resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1").get("error"))
        shutil.rmtree(npx / "k2")
        mk("k2", "0.8.1", integrity="not-an-integrity")
        results["bridge_pin_malformed_integrity_is_error"] = "not-an-integrity" in str(resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1").get("error"))
        shutil.rmtree(npx / "k2")
        mk("k2", "0.8.1", hidden=False)
        results["bridge_pin_missing_hidden_lockfile_is_error"] = "hidden lockfile" in str(resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1").get("error"))
        shutil.rmtree(npx / "k2")
        mk("k2", "0.8.1", hidden="sha512-" + "B" * 86 + "==")
        results["bridge_pin_hidden_lockfile_disagreeing_integrity_is_error"] = "hidden lockfile" in str(resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1").get("error"))
        shutil.rmtree(npx / "k2")
        src_install = mk("k3", "0.8.1")
        pin = resolve_bridge_pin(npx, INTERACTIVE_SPEC, "0.8.1")
        results["bridge_pin_exact_version_resolves_with_integrity"] = (
            "error" not in pin and pin["version"] == "0.8.1" and INTEGRITY_RE.match(str(pin["integrity"])) is not None and pin["key"] == "k3"
            and pin["hidden_lock_integrity"] == pin["integrity"])
        # r4 item 4 — the CLONE's bytes: identical clone passes (relative `.bin` symlink stays inside);
        # an escaping symlink, a tampered byte, a missing file each fail; the tarball route verifies
        # sha512 == integrity + member bytes when the blob exists, and a tampered blob fails.
        import base64 as _b64b
        import io as _io
        import tarfile as _tarfile
        pkg = src_install / "node_modules" / "wicked-interactive"
        (pkg / "bin").mkdir()
        (pkg / "bin" / "wicked-interactive.js").write_text("#!/usr/bin/env node\nconsole.log('bridge 0.8.1')\n")
        (pkg / "src").mkdir()
        (pkg / "src" / "server.js").write_text("export const v = '0.8.1';\n")
        (src_install / "node_modules" / ".bin").mkdir()
        (src_install / "node_modules" / ".bin" / "wicked-interactive").symlink_to("../wicked-interactive/bin/wicked-interactive.js")
        clone_root = Path(mkdtemp(prefix="seed-selftest-clone-"))
        try:
            clone = clone_root / "k3"
            shutil.copytree(src_install, clone, symlinks=True)
            ok_rec = verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None)
            results["bridge_clone_identical_passes_via_hidden_lockfile_route"] = (
                "error" not in ok_rec and ok_rec["symlinks"] == 1 and ok_rec["escaping_symlinks"] == [] and ok_rec["mismatched_count"] == 0
                and ok_rec["symlinks_compared_by_target"] == 1 and ok_rec["symlinks_retargeted"] == [] and ok_rec["tarball"]["present"] is False)
            # codex r5 #2 — without the tarball the bytes are NOT authenticated, and the record says so.
            results["bridge_clone_without_tarball_is_unauthenticated_not_verified"] = (
                ok_rec.get("bytes_authenticated") is False and str(ok_rec.get("bytes_verified_by", "")).startswith("lockfile-metadata (unauthenticated)")
                and "verified against" not in str(ok_rec.get("bytes_verified_by", "")).split("UNAUTHENTICATED")[0].lower() and ok_rec["clone_equals_source"] is True)
            (clone / "node_modules" / ".bin" / "escape").symlink_to("../../../../../../etc/hosts")
            esc = verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None)
            results["bridge_clone_escaping_symlink_is_error"] = "escape" in str(esc.get("error")) and len(esc["escaping_symlinks"]) == 1
            (clone / "node_modules" / ".bin" / "escape").unlink()
            (clone / "node_modules" / ".bin" / "abs").symlink_to("/etc/hosts")
            results["bridge_clone_absolute_symlink_is_error"] = "escape" in str(verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None).get("error"))
            (clone / "node_modules" / ".bin" / "abs").unlink()
            # codex r5 #2 — the `.bin/wicked-interactive` shim RETARGETED to another INTERNAL file: no
            # escape, every regular file still byte-equal — only the target comparison can see it.
            shim = clone / "node_modules" / ".bin" / "wicked-interactive"
            shim.unlink()
            shim.symlink_to("../wicked-interactive/src/server.js")
            retargeted = verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None)
            results["bridge_clone_retargeted_internal_symlink_is_error"] = (
                "retargeted" in str(retargeted.get("error")) and retargeted["escaping_symlinks"] == [] and retargeted["mismatched_count"] == 0
                and retargeted["symlinks_retargeted"] == [{"path": "node_modules/.bin/wicked-interactive", "source_target": "../wicked-interactive/bin/wicked-interactive.js",
                                                          "clone_target": "../wicked-interactive/src/server.js"}]
                and retargeted["clone_tree_sha256"] != ok_rec["clone_tree_sha256"] and "bytes_verified_by" not in retargeted)
            shim.unlink()
            missing_link = verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None)
            results["bridge_clone_missing_symlink_is_error"] = "symlinks differ" in str(missing_link.get("error")) and missing_link["symlinks_missing_in_clone"] == ["node_modules/.bin/wicked-interactive"]
            shim.symlink_to("../wicked-interactive/bin/wicked-interactive.js")
            (clone / "node_modules" / ".bin" / "extra").symlink_to("../wicked-interactive/bin/wicked-interactive.js")
            extra_link = verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None)
            results["bridge_clone_extra_symlink_is_error"] = "symlinks differ" in str(extra_link.get("error")) and extra_link["symlinks_extra_in_clone"] == ["node_modules/.bin/extra"]
            (clone / "node_modules" / ".bin" / "extra").unlink()
            results["bridge_clone_restored_symlinks_pass_again"] = "error" not in verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None)
            (pkg_clone := clone / "node_modules" / "wicked-interactive" / "src" / "server.js").write_text("export const v = '0.8.1'; // tampered\n")
            results["bridge_clone_tampered_byte_is_error"] = "mismatched" in str(verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None).get("error"))
            pkg_clone.write_text("export const v = '0.8.1';\n")
            (clone / "node_modules" / "wicked-interactive" / "bin" / "wicked-interactive.js").unlink()
            results["bridge_clone_missing_file_is_error"] = "missing" in str(verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None).get("error"))
            shutil.copy2(pkg / "bin" / "wicked-interactive.js", clone / "node_modules" / "wicked-interactive" / "bin" / "wicked-interactive.js")
            # the tarball route: a synthetic `package/…` tarball of the source files, stored under its own sha512 in a fake cacache
            buf = _io.BytesIO()
            with _tarfile.open(fileobj=buf, mode="w:gz") as tf:
                for p in sorted(x for x in pkg.rglob("*") if x.is_file()):
                    tf.add(p, arcname=f"package/{p.relative_to(pkg)}")
            blob_bytes = buf.getvalue()
            real_integrity = "sha512-" + _b64b.b64encode(hashlib.sha512(blob_bytes).digest()).decode()
            cacache = clone_root / "_cacache"
            blob_path = integrity_blob_path(cacache, real_integrity)
            blob_path.parent.mkdir(parents=True)
            blob_path.write_bytes(blob_bytes)
            tar_ok = verify_bridge_clone(src_install, clone, real_integrity, cacache)
            results["bridge_clone_tarball_route_verifies_sha512_and_members"] = (
                "error" not in tar_ok and tar_ok["tarball"]["present"] and tar_ok["tarball"]["sha512_matches_integrity"]
                and tar_ok["tarball"]["members"] == 3 and str(tar_ok["bytes_verified_by"]).startswith("tarball") and tar_ok["bytes_authenticated"] is True)
            blob_path.write_bytes(blob_bytes[:-1] + bytes([blob_bytes[-1] ^ 0xFF]))
            results["bridge_clone_tampered_tarball_is_error"] = "does not hash" in str(verify_bridge_clone(src_install, clone, real_integrity, cacache).get("error"))
            blob_path.write_bytes(blob_bytes)
            # codex r6 #3 — tarball COMPLETENESS: an installed file the tarball does not carry (present in
            # source AND clone, so the clone still equals the source) must NOT authenticate; the diff is listed.
            for d in (pkg, clone / "node_modules" / "wicked-interactive"):
                (d / "extra-unpublished.js").write_text("// not in the tarball\n")
            extra_file = verify_bridge_clone(src_install, clone, real_integrity, cacache)
            results["bridge_clone_extra_installed_file_is_not_authenticated"] = (
                extra_file.get("bytes_authenticated") is False and "extra" in str(extra_file.get("error")) and extra_file["clone_equals_source"] is False
                and extra_file["tarball"]["members_extra_in_clone"] == ["extra-unpublished.js"] and extra_file["tarball"]["members_missing_in_clone"] == []
                and extra_file["mismatched_count"] == 0 and extra_file["extra_count"] == 0)
            for d in (pkg, clone / "node_modules" / "wicked-interactive"):
                (d / "extra-unpublished.js").unlink()
            # codex r6 #3 — a SYMLINK member of the tarball: missing from the clone ⇒ not authenticated; present
            # with the same target ⇒ authenticated (counted as a symlink member); RETARGETED ⇒ not authenticated.
            buf2 = _io.BytesIO()
            with _tarfile.open(fileobj=buf2, mode="w:gz") as tf:
                for p in sorted(x for x in pkg.rglob("*") if x.is_file()):
                    tf.add(p, arcname=f"package/{p.relative_to(pkg)}")
                link_member = _tarfile.TarInfo("package/bin/alias")
                link_member.type = _tarfile.SYMTYPE
                link_member.linkname = "../src/server.js"
                tf.addfile(link_member)
            blob2 = buf2.getvalue()
            integrity2 = "sha512-" + _b64b.b64encode(hashlib.sha512(blob2).digest()).decode()
            blob2_path = integrity_blob_path(cacache, integrity2)
            blob2_path.parent.mkdir(parents=True, exist_ok=True)
            blob2_path.write_bytes(blob2)
            link_missing = verify_bridge_clone(src_install, clone, integrity2, cacache)
            results["bridge_clone_tarball_symlink_missing_in_clone_is_not_authenticated"] = (
                link_missing.get("bytes_authenticated") is False and "symlinks differ from the tarball" in str(link_missing.get("error"))
                and link_missing["tarball"]["symlinks_missing_in_clone"] == ["bin/alias"] and link_missing["tarball"]["symlink_members"] == 1)
            for d in (pkg, clone / "node_modules" / "wicked-interactive"):
                (d / "bin" / "alias").symlink_to("../src/server.js")
            link_ok = verify_bridge_clone(src_install, clone, integrity2, cacache)
            results["bridge_clone_tarball_symlink_same_target_authenticates"] = (
                "error" not in link_ok and link_ok["bytes_authenticated"] is True and link_ok["tarball"]["symlink_members"] == 1
                and link_ok["tarball"]["symlinks_retargeted"] == [] and "file SET equals" in str(link_ok["bytes_verified_by"]))
            for d in (pkg, clone / "node_modules" / "wicked-interactive"):
                (d / "bin" / "alias").unlink()
                (d / "bin" / "alias").symlink_to("../bin/wicked-interactive.js")
            link_re = verify_bridge_clone(src_install, clone, integrity2, cacache)
            results["bridge_clone_tarball_symlink_retargeted_is_not_authenticated"] = (
                link_re.get("bytes_authenticated") is False and link_re["clone_equals_source"] is False
                and link_re["tarball"]["symlinks_retargeted"] == [{"path": "bin/alias", "tarball_target": "../src/server.js", "clone_target": "../bin/wicked-interactive.js"}])
            for d in (pkg, clone / "node_modules" / "wicked-interactive"):
                (d / "bin" / "alias").unlink()
            results["bridge_clone_bytes_authenticated_always_stated"] = all(
                "bytes_authenticated" in r for r in (ok_rec, esc, retargeted, missing_link, extra_link, extra_file, link_missing, link_re))
            # codex r6 #1 — ROOT CONTAINMENT, the codex probe: a clone root that is a SYMLINK pointing at the
            # operator cache (here: the fake `_npx` install) is refused BEFORE anything is read — no
            # `clone_equals_source: true`, no "zero symlinks", no files compared.
            scratch = clone_root / "scratch"
            scratch.mkdir()
            (scratch / "k3-link").symlink_to(src_install)
            linked_root = verify_bridge_clone(src_install, scratch / "k3-link", GOOD_INTEGRITY, cacache=None, scratch=scratch)
            results["bridge_clone_symlinked_root_is_refused_before_reading"] = (
                "SYMLINK" in str(linked_root.get("error")) and linked_root["clone_equals_source"] is False and linked_root["bytes_authenticated"] is False
                and linked_root["root_containment"]["root_is_symlink"] is True and "files_compared" not in linked_root and "symlinks" not in linked_root
                and linked_root["root_containment"]["realpath"] == os.path.realpath(src_install))
            results["bridge_clone_symlinked_root_refused_even_without_scratch"] = "SYMLINK" in str(
                verify_bridge_clone(src_install, scratch / "k3-link", GOOD_INTEGRITY, cacache=None).get("error"))
            # an ANCESTOR under scratch that is a symlink (target inside scratch — realpath containment alone would pass)
            (scratch / "real").mkdir()
            shutil.copytree(src_install, scratch / "real" / "k3", symlinks=True)
            (scratch / "alias").symlink_to("real")
            via_alias = verify_bridge_clone(src_install, scratch / "alias" / "k3", GOOD_INTEGRITY, cacache=None, scratch=scratch)
            results["bridge_clone_symlinked_ancestor_under_scratch_is_refused"] = (
                "ancestor" in str(via_alias.get("error")) and str(scratch / "alias") in str(via_alias.get("error")) and "files_compared" not in via_alias)
            # a real directory whose realpath lies OUTSIDE scratch (given lexically under it through a link) — refused; and a
            # root that is not lexically under scratch at all — refused
            (scratch / "outside").symlink_to(clone_root)
            outside = verify_bridge_clone(src_install, scratch / "outside" / "k3", GOOD_INTEGRITY, cacache=None, scratch=scratch)
            results["bridge_clone_root_resolving_outside_scratch_is_refused"] = "error" in outside and "files_compared" not in outside
            not_under = verify_bridge_clone(src_install, clone, GOOD_INTEGRITY, cacache=None, scratch=scratch)
            results["bridge_clone_root_not_under_scratch_is_refused"] = "not lexically under" in str(not_under.get("error")) and "files_compared" not in not_under
            # the legitimate layout — a real directory chain under scratch — passes with the containment recorded
            contained = verify_bridge_clone(src_install, scratch / "real" / "k3", GOOD_INTEGRITY, cacache=None, scratch=scratch)
            results["bridge_clone_contained_root_passes_with_containment_recorded"] = (
                "error" not in contained and contained["root_containment"]["inside_scratch"] is True and contained["root_containment"]["root_is_symlink"] is False
                and contained["root_containment"]["ancestors_checked"] == [str(scratch / "real")] and contained["clone_equals_source"] is True)
            results["clone_root_containment_missing_root_is_error"] = "cannot be lstat'ed" in str(clone_root_containment(scratch / "nope", scratch).get("error"))
        finally:
            shutil.rmtree(clone_root, ignore_errors=True)
    finally:
        shutil.rmtree(npx, ignore_errors=True)
    # 19b. the offline range resolution: `^` semantics npm applies, and the cached registry manifest is
    #      copied (index + blob) so `npx --offline` resolves without the network.
    results["caret_zero_minor_excludes_next_minor"] = caret_max(["0.8.0", "0.8.1", "0.9.0", "0.8.2-rc.1"], "wicked-interactive@^0.8.1") == "0.8.1"
    results["caret_picks_highest_in_range"] = caret_max(["0.8.1", "0.8.3", "0.8.2", "0.9.0"], "wicked-interactive@^0.8.1") == "0.8.3"
    results["caret_major_excludes_next_major"] = caret_max(["1.2.3", "1.9.0", "2.0.0"], "x@^1.2.3") == "1.9.0"
    results["caret_nothing_satisfying_is_none"] = caret_max(["0.7.0", "0.9.0"], "x@^0.8.1") is None
    cc_src, cc_dst = Path(mkdtemp(prefix="seed-selftest-cc-src-")), Path(mkdtemp(prefix="seed-selftest-cc-dst-"))
    try:
        import base64 as _b64
        results["registry_manifest_missing_is_error"] = "error" in seed_registry_manifest(cc_src, cc_dst, "wicked-interactive")
        blob = json.dumps({"name": "wicked-interactive", "dist-tags": {"latest": "0.9.0"}, "versions": {"0.8.1": {}, "0.9.0": {}}}).encode()
        digest = hashlib.sha512(blob).digest()
        hexd = digest.hex()
        integrity = "sha512-" + _b64.b64encode(digest).decode()
        blob_path = cc_src / "_cacache" / "content-v2" / "sha512" / hexd[:2] / hexd[2:4] / hexd[4:]
        blob_path.parent.mkdir(parents=True)
        blob_path.write_bytes(blob)
        idx = cc_src / "_cacache" / "index-v5" / "ab" / "cd" / "deadbeef"
        idx.parent.mkdir(parents=True)
        entry = {"key": "make-fetch-happen:request-cache:https://registry.npmjs.org/wicked-interactive", "integrity": integrity, "time": 1788928058856, "size": len(blob)}
        idx.write_text("0123\t" + json.dumps(entry) + "\n")
        seeded = seed_registry_manifest(cc_src, cc_dst, "wicked-interactive")
        results["registry_manifest_seeded_index_and_blob"] = (
            "error" not in seeded and (cc_dst / "_cacache" / "index-v5" / "ab" / "cd" / "deadbeef").is_file()
            and (cc_dst / "_cacache" / "content-v2" / "sha512" / hexd[:2] / hexd[2:4] / hexd[4:]).read_bytes() == blob
            and seeded["versions"] == ["0.8.1", "0.9.0"] and caret_max(seeded["versions"], INTERACTIVE_SPEC) == "0.8.1")
    finally:
        shutil.rmtree(cc_src, ignore_errors=True)
        shutil.rmtree(cc_dst, ignore_errors=True)
    # 20. `ps` runs under the C locale (Copilot): a non-English `lstart` still parses to None
    #     (UNVERIFIED — narrows matching, never widens), the env pins LC_ALL=C, and the C-locale form parses.
    seen_env: dict = {}

    def fake_ps_de(args, **kw):
        seen_env.update(kw.get("env") or {})
        return subprocess.CompletedProcess(args, 0, stdout="Di. Sep  9 03:37:00 2026\n", stderr="")

    def fake_ps_c(args, **kw):
        return subprocess.CompletedProcess(args, 0, stdout="Tue Sep  9 03:37:00 2026\n", stderr="")

    results["ps_started_at_unparseable_locale_is_unverified"] = ps_started_at(1, runner=fake_ps_de) is None and seen_env.get("LC_ALL") == "C"
    results["ps_started_at_c_locale_parses"] = isinstance(ps_started_at(1, runner=fake_ps_c), float)
    results["ps_env_pins_c_locale"] = PS_ENV.get("LC_ALL") == "C" and "PATH" in PS_ENV
    # 21. TST-2 — the ACTUAL scenario function (codex r4 item 1), driven through `Suite.run` exactly as
    #     the suite does (xfail marker on): every operational failure is a FAIL, never `blocked`.
    listing_ok = (200, {"campaigns": [{"id": "c1", "status": "cancelled"}]})
    detail_ok = (200, {"campaign": {"id": "c1", "def": {"nodes": [{"node_id": "n1", "run_spec": {"repo_ref": "repo-a"}}]}}})

    def tst2_probe(*, seed=None, listing=listing_ok, detail=detail_ok, a_cards=("c1",), b_cards=()) -> dict:
        s2 = Suite()

        def getter(path: str):
            if path == "/campaigns":
                if isinstance(listing, BaseException):
                    raise listing
                return listing
            return detail

        s2.run("TST-2", "probe", lambda: campaign_isolation_scenario(
            seed=seed or (lambda: {"symbol": "wicked-apps synthetic campaign/c1:", "written": True}), get=getter,
            cards=lambda pid: list(a_cards) if pid == "A" else list(b_cards),
            campaign_id="c1", repo_id="repo-a", a="A", b="B", issue="issue#0"), xfail="issue#0")
        return s2.rows[0]

    corrupt = Rig.__new__(Rig)
    corrupt.report = {"setup": {}}
    corrupt.tmp = Path(mkdtemp(prefix="seed-selftest-corrupt-")).resolve()
    corrupt.state = corrupt.tmp / "state"
    corrupt.state.mkdir()
    (corrupt.state / "core.db").write_bytes(b"this is not a sqlite database " * 64)
    try:
        row = tst2_probe(seed=lambda: corrupt.seed_campaign_record("c1", "Probe", "projA", "repo-a"))
        results["tst2_db_corruption_is_fail_not_blocked"] = row["status"] == "fail" and "campaign-seed-write-failed" in row["detail"] and "DatabaseError" in row["detail"]
    finally:
        shutil.rmtree(corrupt.tmp, ignore_errors=True)
    row = tst2_probe(listing=(500, {"campaigns": []}))
    results["tst2_http_500_empty_list_is_fail_not_blocked"] = row["status"] == "fail" and "HTTP 500" in row["detail"]
    row = tst2_probe(listing=(200, {"ok": True}))
    results["tst2_200_without_list_is_fail"] = row["status"] == "fail" and "without a `campaigns` list" in row["detail"]
    row = tst2_probe(listing=(200, {"campaigns": []}))
    results["tst2_seed_missing_is_fail_named"] = row["status"] == "fail" and "campaign-seed-missing" in row["detail"]
    row = tst2_probe(listing=urllib.error.URLError("connection refused"))
    results["tst2_transport_error_is_fail"] = row["status"] == "fail" and "URLError" in row["detail"]
    row = tst2_probe(detail=(404, {"error": "not found"}))
    results["tst2_detail_404_is_fail"] = row["status"] == "fail" and "GET /campaigns/c1" in row["detail"]
    row = tst2_probe(a_cards=(), b_cards=())
    results["tst2_owner_card_missing_is_fail"] = row["status"] == "fail" and "does not render its own campaign" in row["detail"]
    row = tst2_probe(a_cards=("c1",), b_cards=("c1",))
    results["tst2_b_rendering_seed_is_the_xfail"] = row["status"] == "xfail" and "issue#0" in row["detail"]
    row = tst2_probe(a_cards=("c1",), b_cards=())
    results["tst2_partitioned_passes_scenario_body"] = row["status"] == "xpass"  # the marker is stale ONLY when the product partitions
    results["tst2_never_blocked"] = all(r != "blocked" for r in [
        tst2_probe(listing=(500, {"campaigns": []}))["status"], tst2_probe(listing=(200, {"campaigns": []}))["status"],
        tst2_probe(seed=lambda: (_ for _ in ()).throw(sqlite3.DatabaseError("database disk image is malformed")))["status"]])
    # 22. DEM-REC (codex r4 item 2): `browserType.launch` alone is NOT a prerequisite — a crash, a launch
    #     timeout, EACCES, a closed browser and an embedded mention are FAILURES; only the two identified
    #     answers (anchored) are blocked.
    fails_22 = [
        "Recording failed: browserType.launch: Target page, context or browser has been closed",
        "Recording failed: browserType.launch: Timeout 180000ms exceeded.",
        "Recording failed: browserType.launch: spawn EACCES",
        "Recording failed: browserType.launch: Browser closed unexpectedly",
        "Recording failed: Target page, context or browser has been closed",
        "Recording failed: browserType.launch",
        "Recording failed: ENOSPC: no space left on device, while writing demo.spec.mjs authored yet",
        "the spec said: no demo.spec.mjs authored yet",  # not the bridge's answer shape (not anchored)
        "Recording failed: Playwright is not installed",  # a truncated / different not-installed sentence is not the identified one
    ]
    results["recorder_crash_timeout_eacces_closed_are_fail"] = all(classify_recorder_answer(200, a, False)[0] == "fail" for a in fails_22)
    blocked_22 = [
        "Recording failed: no demo.spec.mjs authored yet — the agent must write the spec before recording",
        "Recording failed: Playwright is not installed — run `npx playwright install` (the install gate should have caught this)",
        "Recording failed: browserType.launch: Executable doesn't exist at /scratch/ms-playwright/chromium-1200/chrome-mac/Chromium.app",
    ]
    results["recorder_identified_prereqs_with_2xx_are_blocked"] = all(classify_recorder_answer(200, a, False)[0] == "blocked" for a in blocked_22)
    results["recorder_identified_prereqs_with_4xx_are_fail"] = all(classify_recorder_answer(400, a, False)[0] == "fail" for a in blocked_22)
    # 23. advisory lock pid TYPES (codex r4 item 5): the REAL `Rig.stop_bridge` with `{"pid": []}` (and a
    #     string pid) must terminate the independently identified bridge, record `lock_pid_invalid` (a
    #     verdict failure) and never raise; a valid matching pid records no such failure.
    ident_bridge = {"pid": 4242, "pgid": 4242, "ppid": 1, "command": "node wicked-interactive serve --root /x/idocs", "started_at": 200.0}

    _NO_PKG = object()

    def stop_probe(lock_body: object, *, scratch_pkg: object = _NO_PKG, inspect_raise: bool = False, lock_bytes: bytes | None = None,
                   lock_reader: Callable | None = None, calls: list[list[int]] | None = None) -> tuple[dict, list[list[int]], str | None]:
        """The REAL `Rig.stop_bridge` with an identified bridge (pid 4242). `scratch_pkg` (codex r5 #1)
        materialises a scratch clone whose `node_modules/wicked-interactive/package.json` holds that
        JSON text (a `null`, a list, garbage …) and points `setup.bridge.scratch_path` at it, so the
        metadata inspection runs; `inspect_raise` makes the inspection itself raise. `lock_bytes`
        (codex r6 #2) writes the lock as RAW bytes (invalid UTF-8 …) instead of `json.dumps(lock_body)`;
        `lock_reader` injects the lock reader (a raising one, an ordering spy)."""
        pr = Rig.__new__(Rig)
        pr.report = {"setup": {}}
        pr.tmp = Path(mkdtemp(prefix="seed-selftest-lock-")).resolve()
        pr.idocs = pr.tmp / "idocs"
        pr.idocs.mkdir()
        if lock_bytes is not None:
            (pr.idocs / ".wi-serve.json").write_bytes(lock_bytes)
        else:
            (pr.idocs / ".wi-serve.json").write_text(json.dumps(lock_body))
        pr.daemon_started_at = 100.0
        pr.run_started_at = 100.0
        pr.npm_cache = pr.tmp / "npm-cache"
        if scratch_pkg is not _NO_PKG:
            pkg_dir = pr.npm_cache / "_npx" / "k" / "node_modules" / "wicked-interactive"
            pkg_dir.mkdir(parents=True)
            (pkg_dir / "package.json").write_text(str(scratch_pkg))
            pr.report["setup"]["bridge"] = {"scratch_path": str(pr.npm_cache / "_npx" / "k")}
        if inspect_raise:
            def _boom(*_a, **_k):
                raise RuntimeError("inspection boom")
            pr._inspect_pinned_clone_at_teardown = _boom  # type: ignore[method-assign]
        calls = [] if calls is None else calls  # a caller-supplied list lets a lock-reader spy observe the terminate ORDER
        try:
            info = pr.stop_bridge(
                processes=lambda root, nb: {"identified": [ident_bridge], "unverified": [], "older_excluded": [], "ps_ok": True, "ps_error": None},
                terminate=lambda pids: (calls.append(list(pids)), {"signalled": list(pids), "forced": [], "remaining": []})[1],
                lock_reader=lock_reader,
            )
            return info, calls, None
        except Exception as e:  # noqa: BLE001 — the probe records the raise instead of crashing the self-test
            return {}, calls, f"{type(e).__name__}: {e}"
        finally:
            shutil.rmtree(pr.tmp, ignore_errors=True)

    info, calls, raised = stop_probe({"pid": [], "version": "0.8.1"})
    results["lock_pid_list_no_typeerror_bridge_still_terminated"] = raised is None and calls == [[4242]]
    results["lock_pid_list_is_recorded_failure"] = bool(info.get("lock_pid_invalid")) and any(f.startswith("bridge_lock_pid_invalid") for f in teardown_failures({"bridge": info}))
    info, calls, raised = stop_probe({"pid": "4242"})
    results["lock_pid_string_is_refused_and_recorded"] = raised is None and calls == [[4242]] and bool(info.get("lock_pid_invalid")) and info["lock_pid_matches_identified"] is False
    info, calls, raised = stop_probe({"pid": 4242, "version": "0.8.1"})
    results["lock_pid_valid_matching_is_clean"] = raised is None and calls == [[4242]] and "lock_pid_invalid" not in info and info["lock_pid_matches_identified"] is True \
        and teardown_failures({"bridge": {**info, "terminated": {"remaining": []}}}) == []
    # 24. the live-daemon observation (codex r4 item 6): the REAL `Rig.scan_operator_state` with a
    #     reachable baseline and a connection-refused final snapshot ⇒ `observation_lost` ⇒ a verdict
    #     failure ⇒ `report.ok=false`; both reachable ⇒ observed, no failure; an unreachable baseline
    #     is "never observed", not "lost".
    empty_root = Path(mkdtemp(prefix="seed-selftest-live-")).resolve()
    try:
        def scan_probe(before: dict, after: dict) -> dict:
            lr = Rig.__new__(Rig)
            lr.report = {"setup": {}}
            lr.needles = ["e2e-scope-selftest"]
            lr.run_started_at = time.time()
            lr.live_before = before
            return lr.scan_operator_state(snapshot=lambda: after, roots=(empty_root,), state_home=empty_root / "no-such-home")

        lost = scan_probe({"reachable": True, "run_ids": ["r1", "r2"], "problems": {}},
                          {"reachable": False, "error": "<urlopen error [Errno 61] Connection refused>", "run_ids": []})
        lost_fails = teardown_failures({"isolation_scan": lost})
        results["live_observation_lost_is_flagged"] = lost["live_7701"]["observation_lost"] is True and lost["live_7701"]["error_after"].endswith("Connection refused>")
        results["live_observation_lost_is_verdict_failure"] = any(f.startswith("live_observation_lost") for f in lost_fails)
        results["live_observation_lost_forces_ok_false"] = finalize({"live_touched": [], "setup": {"teardown": {"failures": lost_fails}}}, suite_ok=True)["ok"] is False
        lost_500 = scan_probe({"reachable": True, "run_ids": ["r1"], "problems": {}}, {"reachable": False, "error": "GET /runs → 500", "run_ids": []})
        results["live_final_listing_error_is_lost"] = lost_500["live_7701"]["observation_lost"] is True
        kept = scan_probe({"reachable": True, "run_ids": ["r1"], "problems": {}}, {"reachable": True, "run_ids": ["r1"], "problems": {}})
        results["live_observation_kept_is_clean"] = kept["live_7701"]["observed"] is True and kept["live_7701"]["observation_lost"] is False and teardown_failures({"isolation_scan": kept}) == []
        results["real_scan_output_carries_attribution_note"] = kept["attribution"] == MODIFIED_ATTRIBUTION and kept["modified_sample"] == [] and kept["files_modified_during_run"] == 0
        never = scan_probe({"reachable": False, "error": "refused", "run_ids": []}, {"reachable": False, "error": "refused", "run_ids": []})
        results["live_never_observed_is_not_lost"] = never["live_7701"]["observation_lost"] is False and never["live_7701"]["observed"] is False
    finally:
        shutil.rmtree(empty_root, ignore_errors=True)
    # 25. the report scrub (Copilot threads): this checkout's root → `<repo>` in both spellings, shots
    #     repo-relative, a TRUNCATED temp-root prefix → `$TMPDIR` by shape (both spellings, dashed), the
    #     `/private`-prefixed home never degrades to `/private~`, and the scrub is idempotent.
    repo_s = str(REPO)
    repo_alt_s = repo_s[len("/private"):] if repo_s.startswith("/private/") else f"/private{repo_s}"
    sample = json.dumps({
        "source": repo_s, "alt": f"{repo_alt_s}/e2e/x.py", "shot": f"{repo_s}/e2e/shots/seed-surfaces/STR-1.png",
        # synthetic per-user folder ids — the shape (`<2>/<30>/T`) is what matters, never a real one
        "trunc": "node .../wicked-interactive serve --root /private/var/folders/zz/zz0000000000000000000",
        "full": "/var/folders/zz/zz00000000000000000000000000gn/T/seed-surfaces-abc/idocs",
        "full_private": "/private/var/folders/zz/zz00000000000000000000000000gn/T/seed-surfaces-abc/idocs",
        "dashed": ".claude/projects/-private-var-folders-zz-zz00000000000000000000000000gn-T-seed-surfaces-abc-repo",
        "dashed_trunc": "-var-folders-zz-zz000",
        "home": f"{REAL_HOME}/.wicked-crew/x", "home_private": f"/private{REAL_HOME}/y", "tmp_mask": "$TMPDIR/already",
    })
    scrubbed = scrub_report_text(sample)
    doc = json.loads(scrubbed)
    results["scrub_repo_root_both_spellings"] = doc["source"] == "<repo>" and doc["alt"] == "<repo>/e2e/x.py"
    results["scrub_shot_is_repo_relative"] = doc["shot"] == "e2e/shots/seed-surfaces/STR-1.png"
    results["scrub_truncated_tmp_root_masked"] = doc["trunc"].endswith("--root $TMPDIR") and "var/folders" not in scrubbed
    results["scrub_full_tmp_root_both_spellings"] = doc["full"] == "$TMPDIR/seed-surfaces-abc/idocs" and doc["full_private"] == "$TMPDIR/seed-surfaces-abc/idocs"
    results["scrub_dashed_tmp_root_incl_truncated"] = doc["dashed"] == ".claude/projects/-TMPDIR-seed-surfaces-abc-repo" and doc["dashed_trunc"] == "-TMPDIR"
    results["scrub_home_never_degrades_to_private_tilde"] = doc["home"] == "~/.wicked-crew/x" and doc["home_private"] == "~/y" and "/private~" not in scrubbed
    results["scrub_is_idempotent"] = scrub_report_text(scrubbed) == scrubbed and doc["tmp_mask"] == "$TMPDIR/already"
    rescrub_dir = Path(mkdtemp(prefix="seed-selftest-rescrub-"))
    try:
        target = rescrub_dir / "report.json"
        target.write_text(sample, encoding="utf-8")
        outcome = rescrub_report_file(target)
        results["rescrub_file_in_place_leaves_valid_json_without_residue"] = outcome["changed"] is True and json.loads(target.read_text())["source"] == "<repo>" and rescrub_report_file(target)["changed"] is False
    finally:
        shutil.rmtree(rescrub_dir, ignore_errors=True)
    # 25b. ambient-path placeholders (Copilot on #211): the operator-specific SEGMENTS of `modified_sample`
    #      — a garden project id, a UUID, an engine project id — become stable placeholders; product names
    #      and the rig's own identifiers (`needles`) stay verbatim; the JSON-aware pass is scoped to
    #      `isolation_scan`, inserts `attribution` after `modified_sample`, and is a no-op the second time.
    #      Synthetic ids throughout — no real operator id is ever spelled in this file.
    ambient = "~/.something-wicked/wicked-garden/projects/wicked-0badf00d/wicked-mem/emitted/01234567-89ab-cdef-0123-456789abcdef.json"
    results["scrub_operator_path_placeholders_each_shape"] = (
        scrub_operator_path(ambient) == "~/.something-wicked/wicked-garden/projects/wicked-<project>/wicked-mem/emitted/<uuid>.json"
        and scrub_operator_path("~/.wicked-crew/projects/proj_178800000000000000/x") == "~/.wicked-crew/projects/<proj>/x"
        and scrub_operator_path("~/.wicked-crew/interactive-drafts/proj_1788000000001-run-01234567-89AB-cdef-0123-456789abcdef") == "~/.wicked-crew/interactive-drafts/<proj>-run-<uuid>")
    results["scrub_operator_path_leaves_product_names_and_short_ids"] = all(
        scrub_operator_path(p) == p for p in ("~/.wicked-crew/core.db-wal", "~/.something-wicked/wicked-bus/bus.db-wal", "~/.wicked/memory.db.memext",
                                              "$TMPDIR/seed-surfaces-22jwc682/idocs", "~/wicked-interactive/docs/wicked-crew-x", "wicked-0badf00/short", "proj_/x"))
    results["scrub_operator_path_is_idempotent"] = scrub_operator_path(scrub_operator_path(ambient)) == scrub_operator_path(ambient)
    scan_doc = {"setup": {"teardown": {"isolation_scan": {
        "roots": ["~/.wicked-crew"], "needles": ["proj_178800000000000000", "01234567-89ab-cdef-0123-456789abcdef", "seed-surfaces-x"],
        "files_modified_during_run": 2, "modified_sample": [ambient, "~/.wicked-crew/core.db-wal"], "scan_errors": [],
        "identifier_hits": [{"file": "~/.wicked-crew/projects/proj_178800000000000000/x", "needle": "proj_178800000000000000"}],
        "stamped_entries_in_live_state_home": ["interactive-drafts/proj_178800000000000000"], "live_7701": {}}}},
        "scenarios": [{"id": "X", "detail": "run 01234567-89ab-cdef-0123-456789abcdef under proj_178800000000000000"}]}
    first = scrub_report_json(scan_doc)
    sc = scan_doc["setup"]["teardown"]["isolation_scan"]
    results["rescrub_json_placeholders_only_the_ambient_sample"] = (
        first is True and sc["modified_sample"] == [scrub_operator_path(ambient), "~/.wicked-crew/core.db-wal"]
        and sc["needles"][0] == "proj_178800000000000000" and sc["identifier_hits"][0]["file"].endswith("proj_178800000000000000/x")
        and sc["stamped_entries_in_live_state_home"] == ["interactive-drafts/proj_178800000000000000"]
        and scan_doc["scenarios"][0]["detail"].endswith("under proj_178800000000000000"))
    results["rescrub_json_inserts_attribution_after_modified_sample"] = (
        sc["attribution"] == MODIFIED_ATTRIBUTION and list(sc)[list(sc).index("modified_sample") + 1] == "attribution")
    results["rescrub_json_second_pass_is_noop"] = scrub_report_json(scan_doc) is False and sc["attribution"] == MODIFIED_ATTRIBUTION
    results["rescrub_json_ignores_documents_without_a_scan"] = scrub_report_json({"setup": {}, "scenarios": [{"detail": ambient}]}) is False
    # 25c. the residue guard (Copilot on #211): every needle the scrub masks — the DASHED temp-root and
    #      repo-root spellings included, derived from `scrub_literals()` rather than typed here — plus the
    #      two temp-root shapes and the degraded `/private~` are residue; planted in a report with the scrub
    #      BYPASSED, each one makes `rescrub_report_file` raise before writing (the file is byte-identical
    #      afterwards). Unpatched, `/private~` still raises (the scrub neither produces nor removes it) while a
    #      planted dashed temp root is SCRUBBED to `-TMPDIR`, not refused — the guard is belt and braces.
    needles = [n for n, _ in scrub_literals()]
    results["residue_needles_include_dashed_tmp_and_repo_spellings"] = (
        any(n.startswith("-") and n.endswith(repo_s.replace("/", "-")[-12:]) for n in needles)
        and (_tmp_root == "/tmp" or any(n == _tmp_root.replace("/", "-") for n in needles))
        and all(len(n) > 8 for n in needles) and scrub_residue(scrubbed) == [])
    planted = needles + list(RESIDUE_SHAPES)
    # (`in`, not `==`: a `/private`-prefixed or dashed spelling legitimately contains its shorter siblings too)
    results["residue_detector_finds_each_planted_spelling"] = all(n in scrub_residue(json.dumps({"x": f"a{n}b"})) for n in planted)
    guard_dir = Path(mkdtemp(prefix="seed-selftest-residue-"))
    identity_scrub = globals()["scrub_report_text"]
    try:
        globals()["scrub_report_text"] = lambda text: text  # bypass the scrub: what survives is the GUARD's call
        closed: list[bool] = []
        for n in planted:
            target = guard_dir / "report.json"
            raw = json.dumps({"setup": {"p": f"a{n}b"}}, indent=2) + "\n"
            target.write_text(raw, encoding="utf-8")
            try:
                rescrub_report_file(target)
                closed.append(False)
            except RuntimeError as e:
                closed.append(n in str(e) and "scrub left residue" in str(e) and target.read_text(encoding="utf-8") == raw)
        results["residue_guard_fails_closed_on_each_planted_spelling_and_writes_nothing"] = bool(closed) and all(closed)
    finally:
        globals()["scrub_report_text"] = identity_scrub
        shutil.rmtree(guard_dir, ignore_errors=True)
    guard_dir = Path(mkdtemp(prefix="seed-selftest-residue2-"))
    try:
        target = guard_dir / "report.json"
        target.write_text(json.dumps({"home": "/private~/.wicked-crew/x"}), encoding="utf-8")
        try:
            rescrub_report_file(target)
            results["degraded_private_tilde_is_refused_end_to_end"] = False
        except RuntimeError as e:
            results["degraded_private_tilde_is_refused_end_to_end"] = "/private~" in str(e)
        target.write_text(json.dumps({"cwd": ".claude/projects/-private-var-folders-zz-zz00000000000000000000000000gn-T-seed-x"}), encoding="utf-8")
        results["planted_dashed_tmp_root_is_scrubbed_not_refused"] = rescrub_report_file(target)["changed"] is True and json.loads(target.read_text())["cwd"] == ".claude/projects/-TMPDIR-seed-x"
    finally:
        shutil.rmtree(guard_dir, ignore_errors=True)
    # 26. bridge termination is INDEPENDENT of metadata (codex r5 #1): the REAL `stop_bridge` with a scratch
    #     clone whose package.json is JSON `null` (the codex probe), a list, or garbage — and with the
    #     inspection itself raising — must STILL call terminate([4242]), never raise, and record the
    #     unreadable metadata as `not_from_pinned_cache` (a verdict failure).
    for label, pkg_text in (("null", "null"), ("list", "[1, 2]"), ("garbage", "{not json"), ("int_version", '{"version": 81}')):
        info, calls, raised = stop_probe({"pid": 4242, "version": "0.8.1"}, scratch_pkg=pkg_text)
        results[f"bridge_metadata_{label}_still_terminates_identified"] = raised is None and calls == [[4242]]
        results[f"bridge_metadata_{label}_is_recorded_failure"] = (
            str(info.get("pinned_clone_version_at_teardown", "")).startswith("unreadable") and bool(info.get("not_from_pinned_cache"))
            and any(f.startswith("bridge_not_from_pinned_cache") for f in teardown_failures({"bridge": info})))
    info, calls, raised = stop_probe({"pid": 4242, "version": "0.8.1"}, scratch_pkg='{"version": "0.8.1"}', inspect_raise=True)
    results["bridge_inspection_raise_still_terminates_identified"] = raised is None and calls == [[4242]]
    results["bridge_inspection_raise_is_recorded_failure"] = (
        "RuntimeError" in str(info.get("pinned_clone_inspection_error")) and "inspection boom" in str(info.get("not_from_pinned_cache"))
        and any(f.startswith("bridge_not_from_pinned_cache") for f in teardown_failures({"bridge": info})))
    pkg_probe = Path(mkdtemp(prefix="seed-selftest-pkg-"))
    try:
        results["read_package_version_missing_file_is_unreadable"] = read_package_version(pkg_probe / "nope.json").startswith("unreadable: FileNotFoundError")
        (pkg_probe / "p.json").write_text("null")
        results["read_package_version_null_is_unreadable_not_typeerror"] = read_package_version(pkg_probe / "p.json") == "unreadable: package.json is JSON NoneType, not an object"
        (pkg_probe / "p.json").write_text('{"name": "x"}')
        results["read_package_version_no_version_is_unreadable"] = read_package_version(pkg_probe / "p.json").startswith("unreadable: version is NoneType")
        (pkg_probe / "p.json").write_text('{"version": "0.8.1"}')
        results["read_package_version_reads_string_version"] = read_package_version(pkg_probe / "p.json") == "0.8.1"
    finally:
        shutil.rmtree(pkg_probe, ignore_errors=True)
    # 27. (in §19 above) symlink TARGETS compared source vs clone; no tarball ⇒ `bytes_authenticated: false`.
    # 28. the live-run response SHAPE (codex r5 #3): the REAL `snapshot_live_runs` with an injected transport —
    #     HTTP 200 `{"error": "store unavailable"}` (the codex payload), a non-list `runs`, a run view without
    #     `session.id` are NOT observations (unreachable, shape named); through the REAL `scan_operator_state`
    #     after a reachable baseline they are `observation_lost` ⇒ verdict failure ⇒ `ok=false`. A well-formed
    #     listing — including a genuinely EMPTY one — is an observation.
    def fake_get(st: int, body: object):
        return lambda *_a, **_k: (st, body)

    snap_err = snapshot_live_runs(get=fake_get(200, {"error": "store unavailable"}))
    results["live_snapshot_200_error_body_is_unreachable_not_empty"] = snap_err["reachable"] is False and "without a `runs` list" in snap_err["error"] and snap_err["run_ids"] == []
    results["live_snapshot_runs_not_a_list_is_unreachable"] = snapshot_live_runs(get=fake_get(200, {"runs": "nope"}))["reachable"] is False
    results["live_snapshot_malformed_run_view_is_unreachable"] = "session.id" in str(snapshot_live_runs(get=fake_get(200, {"runs": [{"session": {}}]}))["error"])
    good = snapshot_live_runs(get=fake_get(200, {"runs": [{"session": {"id": "r2", "problem": "x"}}, {"session": {"id": "r1"}}]}))
    results["live_snapshot_well_formed_is_observed"] = good["reachable"] is True and good["run_ids"] == ["r1", "r2"] and good["problems"] == {"r2": "x", "r1": ""}
    results["live_snapshot_empty_list_is_an_observation"] = snapshot_live_runs(get=fake_get(200, {"runs": []})) == {"reachable": True, "run_ids": [], "problems": {}}
    results["live_snapshot_transport_error_is_unreachable"] = snapshot_live_runs(get=lambda *_a, **_k: (_ for _ in ()).throw(urllib.error.URLError("refused")))["reachable"] is False
    live_root = Path(mkdtemp(prefix="seed-selftest-live2-")).resolve()
    try:
        lr2 = Rig.__new__(Rig)
        lr2.report = {"setup": {}}
        lr2.needles = ["e2e-scope-selftest"]
        lr2.run_started_at = time.time()
        lr2.live_before = {"reachable": True, "run_ids": ["r1"], "problems": {}}
        scan = lr2.scan_operator_state(snapshot=lambda: snapshot_live_runs(get=fake_get(200, {"error": "store unavailable"})),
                                       roots=(live_root,), state_home=live_root / "no-such-home")
        scan_fails = teardown_failures({"isolation_scan": scan})
        results["live_200_error_body_through_real_scan_is_observation_lost"] = (
            scan["live_7701"]["observation_lost"] is True and scan["live_7701"]["observed"] is False and scan["live_7701"]["new_run_ids"] == []
            and "without a `runs` list" in str(scan["live_7701"]["error_after"]))
        results["live_200_error_body_is_verdict_failure_ok_false"] = (
            any(f.startswith("live_observation_lost") for f in scan_fails)
            and finalize({"live_touched": [], "setup": {"teardown": {"failures": scan_fails}}}, suite_ok=True)["ok"] is False)
    finally:
        shutil.rmtree(live_root, ignore_errors=True)
    # 29. delete xfails PRESERVE (codex r5 #4): `refused_delete_gap` — the path both delete arms take on the
    #     old-bridge DELETE error — driven through `Suite.run` with the xfail marker on: preservation intact ⇒
    #     the ONE xfail; the owner record dropped, the owner's picker emptied, the artifact re-filed under the
    #     foreign project, the content or lineage changed, or the foreign read missing ⇒ FAIL naming the cause.
    cap_before = {"owner_picker": ["doc-a"], "owner_members": ["doc-a"], "foreign_members": ["doc-b"], "head": 1, "lineage": [0, 1], "head_html_sha256": "h1"}

    def delete_row(after: dict, *, foreign: str | None = "B") -> dict:
        d5 = Suite()
        before = cap_before if foreign is not None else {**cap_before, "foreign_members": None}
        d5.run("D", "probe", lambda: refused_delete_gap(before, after, owner="A", foreign=foreign, name="doc-a", mode="document",
                                                          issue="issue#0", message="predates DELETE"), xfail="issue#0")
        return d5.rows[0]

    results["delete_refused_with_preservation_is_xfail"] = delete_row(dict(cap_before))["status"] == "xfail"
    dropped = delete_row({**cap_before, "owner_members": []})
    results["delete_refused_owner_record_dropped_is_fail"] = dropped["status"] == "fail" and "owner record" in dropped["detail"]
    results["delete_refused_owner_picker_lost_is_fail"] = delete_row({**cap_before, "owner_picker": []})["status"] == "fail"
    refiled = delete_row({**cap_before, "foreign_members": ["doc-a", "doc-b"]})
    results["delete_refused_refiled_under_foreign_is_fail"] = refiled["status"] == "fail" and "RE-FILED" in refiled["detail"]
    results["delete_refused_content_changed_is_fail"] = delete_row({**cap_before, "head_html_sha256": "h2"})["status"] == "fail"
    results["delete_refused_lineage_changed_is_fail"] = delete_row({**cap_before, "head": 0, "lineage": [0]})["status"] == "fail"
    results["delete_refused_missing_foreign_read_is_fail"] = delete_row({**cap_before, "foreign_members": None})["status"] == "fail"
    results["delete_refused_without_control_project_still_guards_owner_and_content"] = (
        delete_row({**cap_before, "foreign_members": None}, foreign=None)["status"] == "xfail"
        and delete_row({**cap_before, "foreign_members": None, "owner_members": []}, foreign=None)["status"] == "fail")
    # 30. onboarding status (codex r5 #5): the REAL `Rig.register_repo` with an injected wire — `failed`, or
    #     `running` at the deadline, or no `onboardRunId` ⇒ `SetupFailure(repo_register)` with `ok: false`
    #     ⇒ `finalize(...).ok=false`; `completed` ⇒ the record is ok.
    def register_probe(onboard_status: str, *, run_id: object = "run-1") -> tuple[dict | None, str | None, dict]:
        rr = Rig.__new__(Rig)
        rr.report = {"setup": {}}
        rr.repo_root = Path("/x/repo")
        rr.needles = []
        rr.repo_id = ""
        body: dict = {"repo": {"id": "repo-1"}}
        if run_id is not None:
            body["onboardRunId"] = run_id
        try:
            rec = rr.register_repo(post=lambda *_a, **_k: (201, body), wait=lambda _rid, _t: onboard_status)
            return rec, None, rr.report
        except SetupFailure as e:
            return None, f"{e.step}: {e.why}", rr.report

    rec, err, rep = register_probe("failed")
    results["onboarding_failed_is_setup_failure"] = rec is None and str(err).startswith("repo_register") and "'failed'" in str(err) and rep["setup"]["repo_register"]["ok"] is False
    results["onboarding_failed_forces_ok_false"] = finalize({"live_touched": [], "setup_failure": {"step": "repo_register", "error": err}}, suite_ok=True)["ok"] is False
    rec, err, _ = register_probe("running")
    results["onboarding_running_at_deadline_is_setup_failure"] = rec is None and "still 'running'" in str(err)
    rec, err, _ = register_probe("completed", run_id=None)
    results["onboarding_without_run_id_is_setup_failure"] = rec is None and "onboardRunId" in str(err)
    rec, err, rep = register_probe("completed")
    results["onboarding_completed_is_ok"] = err is None and rec is not None and rec["ok"] is True and rec["onboard_status"] == "completed" and rep["setup"]["repo_register"] is rec
    # 31. RUN-DET event EQUALITY (codex r5 #6): `assert_raw_view_matches_log` compares the raw view to the log
    #     as the ordered list of (seq, type, ord). The codex probe — every other type replaced by WRONG_EVENT
    #     with the total and the gate/cancel counts preserved — FAILS; so do a dropped, duplicated or
    #     reordered row, a corrupted ord and a missing seq; ignored and foreign-session frames are excluded
    #     from the expectation; an identical view passes.
    log = [
        {"seq": 10, "ts": 1.0, "session": "r", "type": "sessionStarted"},
        {"seq": 11, "ts": 1.0, "session": "r", "type": "unitPlanned", "ord": 1},
        {"seq": 12, "ts": 1.0, "session": "r", "type": "cliOutputDelta", "ord": 1},  # store IGNORED — never rendered
        {"seq": 13, "ts": 1.0, "session": "other", "type": "unitPlanned", "ord": 9},  # another run's frame
        {"seq": 14, "ts": 1.0, "session": "r", "type": "councilConvened", "ord": 1},
        {"seq": 15, "ts": 1.0, "session": "r", "type": "unitDistributed", "ord": 1},
        {"seq": 16, "ts": 1.0, "session": "r", "type": "awaitingHuman", "ord": 1},
        {"seq": 17, "ts": 1.0, "session": "r", "type": "runCancelled"},
    ]
    ignored = {"cliOutputDelta", "unitOutputDelta", "heartbeat"}
    rows_ok = [{"seq": 10, "type": "sessionStarted", "ord": None}, {"seq": 11, "type": "unitPlanned", "ord": 1}, {"seq": 14, "type": "councilConvened", "ord": 1},
               {"seq": 15, "type": "unitDistributed", "ord": 1}, {"seq": 16, "type": "awaitingHuman", "ord": 1}, {"seq": 17, "type": "runCancelled", "ord": None}]

    def raw_raises(rows: list[dict], events: list[dict] = log) -> bool:
        try:
            assert_raw_view_matches_log(events, rows, "r", ignored)
        except AssertionError:
            return True
        return False

    results["rundet_identical_rows_pass"] = not raw_raises(rows_ok) and assert_raw_view_matches_log(log, rows_ok, "r", ignored)["rows"] == 6
    wrong = [dict(r, type="WRONG_EVENT") if i % 2 == 1 and r["type"] not in ("awaitingHuman", "runCancelled") else dict(r) for i, r in enumerate(rows_ok)]
    results["rundet_probe_keeps_the_counts_the_old_check_read"] = (
        len(wrong) == len(rows_ok) and [r["type"] for r in wrong].count("awaitingHuman") == 1 and [r["type"] for r in wrong].count("runCancelled") == 1
        and [r["type"] for r in wrong].count("WRONG_EVENT") == 2)
    results["rundet_wrong_event_substitution_fails"] = raw_raises(wrong)
    results["rundet_dropped_row_fails"] = raw_raises(rows_ok[:-1])
    results["rundet_duplicated_row_same_count_fails"] = raw_raises(rows_ok[:2] + [dict(rows_ok[1])] + rows_ok[3:])
    results["rundet_reordered_rows_same_counts_fail"] = raw_raises(rows_ok[:4] + [rows_ok[5], rows_ok[4]])
    results["rundet_corrupted_ord_fails"] = raw_raises([dict(r, ord=2) if r["type"] == "awaitingHuman" else r for r in rows_ok])
    results["rundet_missing_seq_fails"] = raw_raises([dict(r, seq=None) if r["type"] == "councilConvened" else r for r in rows_ok])
    results["rundet_ignored_and_foreign_frames_are_excluded"] = expected_raw_rows(log, "r", ignored) == [
        (10, "sessionStarted", None), (11, "unitPlanned", 1), (14, "councilConvened", 1), (15, "unitDistributed", 1), (16, "awaitingHuman", 1), (17, "runCancelled", None)]
    results["rundet_expectation_is_seq_ordered_like_the_feed"] = expected_raw_rows(list(reversed(log)), "r", ignored) == expected_raw_rows(log, "r", ignored)
    results["rundet_empty_log_fails"] = raw_raises(rows_ok, events=[])
    # 32. RUN-DET's DOM readers (run 11's HARNESS defect, revision 10): the header's status is an ELEMENT — run 11
    #     split the header's concatenated textContent on whitespace and never saw `Cancelled` inside
    #     `#1CancelledRetryInspect ▾…`. The pure matcher rejects that exact string and accepts the element list;
    #     a headless page built from ChatPanel's header markup and NarratorFeed's raw-row markup proves the two JS
    #     readers feed the oracles correctly (blank seq column, a `u9` inside narration that is NOT an ord).
    run11_header = "←New test · 10a592 · #1CancelledRetryInspect ▾AskBalancedAutonomous"
    results["header_status_concatenated_textcontent_is_not_a_match"] = not header_carries_status([run11_header], "cancelled")
    results["header_status_element_text_matches_wire"] = header_carries_status(["←", "New test · 10a592 · #1", "Cancelled", "Retry", "Inspect ▾"], "cancelled")
    results["header_status_label_spaces_match_underscored_wire_and_other_labels_do_not"] = (
        header_carries_status(["Awaiting human"], "awaiting_human") and not header_carries_status(["Completed", "Cancelled…"], "cancelled"))
    try:
        from playwright.sync_api import sync_playwright as _sync_pw
    except ImportError:
        results["dom_probe_available (pip install playwright && playwright install chromium)"] = False
    else:
        with _sync_pw() as _pw:
            _browser = _pw.chromium.launch(headless=True)
            try:
                _page = _browser.new_page()
                _page.set_content(
                    '<div data-testid="run-header" class="flex items-center gap-3"><button type="button" aria-label="Back to run list">←</button>'
                    '<span class="w-2.5 h-2.5 rounded-full shrink-0"></span><p class="flex-1 text-base font-semibold truncate">New test · 10a592 · #1</p>'
                    '<span class="text-xs font-medium shrink-0 font-mono">Cancelled</span><button type="button" data-testid="run-retry">Retry</button>'
                    '<button type="button">Inspect ▾</button><span>Ask</span><span>Balanced</span><span>Autonomous</span></div>'
                    '<div data-testid="raw-event" class="flex items-baseline gap-2"><span class="shrink-0">   10</span><span class="shrink-0 font-semibold">sessionStarted</span><span class="truncate">Run started</span></div>'
                    '<div data-testid="raw-event" class="flex items-baseline gap-2"><span class="shrink-0">   11</span><span class="shrink-0 font-semibold">unitPlanned</span><span class="shrink-0">u1</span><span class="truncate">Unit 1 planned</span></div>'
                    '<div data-testid="raw-event" class="flex items-baseline gap-2"><span class="shrink-0">   16</span><span class="shrink-0 font-semibold">awaitingHuman</span><span class="shrink-0">u1</span><span class="truncate"></span></div>'
                    '<div data-testid="raw-event" class="flex items-baseline gap-2"><span class="shrink-0">     </span><span class="shrink-0 font-semibold">noSeqFrame</span><span class="truncate">u9 here is narration, not an ord</span></div>'
                )
                header_texts = _page.locator('[data-testid="run-header"]').evaluate(RUN_HEADER_TEXTS_JS)
                whole = _page.locator('[data-testid="run-header"]').evaluate("h => h.textContent")
                results["header_js_reads_status_chip_as_its_own_element"] = (
                    "Cancelled" in header_texts and header_carries_status(header_texts, "cancelled") and not header_carries_status(header_texts, "completed"))
                results["header_replica_reproduces_run11_concatenation"] = "#1CancelledRetryInspect" in whole and not header_carries_status([whole], "cancelled")
                rows = _page.locator('[data-testid="raw-event"]').evaluate_all(RAW_ROW_EXTRACT_JS)
                results["raw_row_js_reads_seq_type_ord_incl_blank_seq_and_no_ord"] = rows == [
                    {"seq": 10, "type": "sessionStarted", "ord": None}, {"seq": 11, "type": "unitPlanned", "ord": 1},
                    {"seq": 16, "type": "awaitingHuman", "ord": 1}, {"seq": None, "type": "noSeqFrame", "ord": None}]
                dom_log = [{"seq": 10, "ts": 1.0, "session": "r", "type": "sessionStarted"}, {"seq": 11, "ts": 1.0, "session": "r", "type": "unitPlanned", "ord": 1},
                           {"seq": 16, "ts": 1.0, "session": "r", "type": "awaitingHuman", "ord": 1}, {"session": "r", "type": "noSeqFrame"}]
                results["raw_rows_from_dom_satisfy_identity_oracle"] = assert_raw_view_matches_log(dom_log, rows, "r", ignored)["rows"] == 4
                results["raw_rows_from_dom_fail_identity_oracle_on_wrong_log"] = raw_raises(rows, events=dom_log[:2] + [dict(dom_log[2], type="WRONG_EVENT")] + dom_log[3:])
            finally:
                _browser.close()
    # 33. codex round 6 — (#2) termination is INDEPENDENT of lock decoding: the REAL `stop_bridge` with a lock
    #     of invalid UTF-8 bytes (the codex probe) must call terminate([4242]) BEFORE the lock is read, never
    #     raise, and record `lock_unreadable` → `bridge_lock_unreadable` (a verdict failure); a lock reader that
    #     RAISES likewise; `read_bridge_lock` itself never raises on content. (#5) the raw-event expectation
    #     mirrors the UI comparators: an unsequenced frame between two sequenced ones KEEPS its place.
    bad_utf8 = b'{"pid": 4242, "version": "\xff\xfe\x80"}'
    lock, state = read_bridge_lock(Path(mkdtemp(prefix="seed-selftest-utf8-")))
    results["read_bridge_lock_absent_is_absent"] = lock is None and state == "absent"
    utf8_dir = Path(mkdtemp(prefix="seed-selftest-utf8-"))
    try:
        (utf8_dir / ".wi-serve.json").write_bytes(bad_utf8)
        lock, state = read_bridge_lock(utf8_dir)
        results["read_bridge_lock_invalid_utf8_is_unreadable_not_a_raise"] = lock is None and state.startswith("unreadable: UnicodeDecodeError")
    finally:
        shutil.rmtree(utf8_dir, ignore_errors=True)
    info, calls, raised = stop_probe(None, lock_bytes=bad_utf8)
    results["lock_invalid_utf8_bridge_still_terminated_no_raise"] = raised is None and calls == [[4242]]
    results["lock_invalid_utf8_is_recorded_failure"] = (
        str(info.get("lock", "")).startswith("unreadable: UnicodeDecodeError") and bool(info.get("lock_unreadable"))
        and any(f.startswith("bridge_lock_unreadable") for f in teardown_failures({"bridge": info})) and info["lock_pid_matches_identified"] is False)

    def _raising_reader(_root: Path) -> tuple[dict | None, str]:
        raise RuntimeError("lock reader boom")

    info, calls, raised = stop_probe({"pid": 4242}, lock_reader=_raising_reader)
    results["lock_reader_raise_bridge_still_terminated_no_raise"] = raised is None and calls == [[4242]]
    results["lock_reader_raise_is_recorded_failure"] = "RuntimeError: lock reader boom" in str(info.get("lock")) and any(
        f.startswith("bridge_lock_unreadable") for f in teardown_failures({"bridge": info}))
    order: list[int] = []
    shared_calls: list[list[int]] = []

    def _spy_reader(root: Path) -> tuple[dict | None, str]:
        order.append(len(shared_calls))  # how many terminate calls had ALREADY happened when the lock was read
        return read_bridge_lock(root)

    info, calls, raised = stop_probe({"pid": 4242, "version": "0.8.1"}, lock_reader=_spy_reader, calls=shared_calls)
    results["terminate_happens_before_the_lock_is_read"] = (
        raised is None and calls == [[4242]] and order == [1] and "lock_unreadable" not in info and info["lock"] == "ok"
        and info["lock_pid_matches_identified"] is True and teardown_failures({"bridge": {**info, "terminated": {"remaining": []}}}) == [])
    mixed = [
        {"seq": 1, "ts": 1.0, "session": "r", "type": "sessionStarted"},
        {"session": "r", "type": "liveOnlyFrame"},  # no seq, no ts — the UI keeps it HERE
        {"seq": 2, "ts": 1.0, "session": "r", "type": "unitPlanned", "ord": 1},
    ]
    kept_order = expected_raw_rows(mixed, "r", set())
    results["rundet_unsequenced_frame_keeps_its_relative_placement"] = kept_order == [(1, "sessionStarted", None), (None, "liveOnlyFrame", None), (2, "unitPlanned", 1)]
    ui_rows = [{"seq": 1, "type": "sessionStarted", "ord": None}, {"seq": None, "type": "liveOnlyFrame", "ord": None}, {"seq": 2, "type": "unitPlanned", "ord": 1}]
    results["rundet_ui_interleaved_order_passes_the_oracle"] = assert_raw_view_matches_log(mixed, ui_rows, "r", set())["rows"] == 3
    moved_to_end = [ui_rows[0], ui_rows[2], ui_rows[1]]  # revision 10's expectation — NOT what the UI renders
    results["rundet_unsequenced_moved_to_end_is_rejected"] = raw_raises(moved_to_end, events=mixed)
    results["rundet_seq_without_ts_sorts_in_hydrate_not_in_feed"] = expected_raw_rows(
        [{"seq": 5, "session": "r", "type": "b"}, {"seq": 4, "session": "r", "type": "a"}], "r", set()) == [(4, "a", None), (5, "b", None)]
    ok = all(results.values())
    print(json.dumps({"self_test": results, "ok": ok}, indent=2))
    return 0 if ok else 1


# ── main ──────────────────────────────────────────────────────────────────────


def _on_sigterm(*_args) -> None:
    raise KeyboardInterrupt("SIGTERM")


# The macOS per-user temp root, by SHAPE — `/var/folders/<2 chars>/<30 chars>/T` — so a TRUNCATED prefix
# (a `command[:200]` cut mid-segment, as run 9's report carried) is masked too, not only the exact string.
TMP_ROOT_RE = re.compile(r"(?:/private)?/var/folders/[^/\s\"'\\]+/[^/\s\"'\\]+(?:/T(?=[/\s\"'\\]|$))?")
TMP_ROOT_DASHED_RE = re.compile(r"-(?:private-)?var-folders-[A-Za-z0-9_]+-[A-Za-z0-9_]+(?:-T(?=-|[\s\"']|$))?")


def scrub_report_text(text: str) -> str:
    """What the committed artifact masks — exactly:
      - the operator's real HOME (`~`): the plain spelling, the `/private`-prefixed spelling, and
        `Path.home()`;
      - THIS checkout's root (`<repo>`): `Path(__file__).resolve().parents[1]`, in both its
        `/private/…` and un-prefixed spellings and their dashed forms (the CLI seats' project-dir
        naming), so `setup.repo_clone.source` and every path under the worktree read `<repo>/…`;
      - screenshot paths repo-relative (`"shot": "e2e/shots/…"`, never `<repo>/e2e/…`);
      - the per-user temp root (`$TMPDIR`): `tempfile.gettempdir()` in both spellings and the dashed
        spelling, AND — by shape — any `/private/var/folders/<x>/<y>[/T]` or `/var/folders/<x>/<y>[/T]`
        prefix however long, truncated included (`TMP_ROOT_RE`), plus the dashed shape.
    Longer literals are replaced first so a `/private`-prefixed path never degrades to `/private~`.
    Idempotent (masks are never re-matched); self-tested. The literal list is `scrub_literals()` —
    shared with `scrub_residue`, so the guard checks exactly the spellings the scrub masks."""
    for needle, mask in scrub_literals():
        text = text.replace(needle, mask)
    text = TMP_ROOT_RE.sub("$TMPDIR", text)
    text = TMP_ROOT_DASHED_RE.sub("-TMPDIR", text)
    text = re.sub(r'("shot": ")<repo>/', r"\1", text)
    return text


def scrub_literals() -> list[tuple[str, str]]:
    """The exact (needle, mask) literals `scrub_report_text` replaces, longest first: the operator's
    home (plain, `/private`-prefixed, `Path.home()`), this checkout's root (both spellings and their
    dashed forms), the per-user temp root (both spellings and the dashed CLI-seat spelling of each).
    Filtered here — never a bare `/`, `/tmp` or their dashed forms, never a needle of ≤ 8 chars — so
    the scrub and the residue guard agree on what counts. Derived from the constants, never typed."""
    import tempfile
    tmp_root = tempfile.gettempdir().rstrip("/")
    dashed = tmp_root.replace("/", "-")  # the CLI seats' project-dir spelling of a cwd (`-private-var-folders-…-T-…`)
    repo = str(REPO)
    repo_alt = repo[len("/private"):] if repo.startswith("/private/") else f"/private{repo}"
    literals = [
        (str(REAL_HOME), "~"), (f"/private{REAL_HOME}", "~"), (str(Path.home()), "~"),
        (repo, "<repo>"), (repo_alt, "<repo>"), (repo.replace("/", "-"), "-repo"), (repo_alt.replace("/", "-"), "-repo"),
        (f"/private{tmp_root}", "$TMPDIR"), (tmp_root, "$TMPDIR"),
        (f"-private{dashed}", "-TMPDIR"), (dashed, "-TMPDIR"),
    ]
    return [
        (needle, mask) for needle, mask in sorted(dict.fromkeys(literals), key=lambda kv: -len(kv[0]))
        if needle and needle not in ("/", "/tmp", "/private/tmp", "-tmp", "-private-tmp") and len(needle) > 8
    ]


# The two macOS temp-root SHAPES (`TMP_ROOT_RE` / `TMP_ROOT_DASHED_RE`) as residue substrings, and the one
# degraded form the scrub must never produce (a `/private`-prefixed home masked AFTER its plain spelling).
RESIDUE_SHAPES = ("/var/folders/", "-var-folders-", "/private~")


def scrub_residue(text: str) -> list[str]:
    """Every spelling that must NOT survive in a scrubbed artifact, found in `text` (Copilot on #211):
    each needle of `scrub_literals()` — so the dashed temp-root and repo-root spellings are checked with
    the same constants the scrub uses, never hand-typed — plus `RESIDUE_SHAPES`. Empty means clean."""
    return [n for n, _ in scrub_literals() if n in text] + [s for s in RESIDUE_SHAPES if s in text]


# What the isolation scan's `files_modified_during_run` / `modified_sample` ARE (Copilot on #211): the
# writes under the operator-global stores that landed in the run window — the live :7701 daemon's own
# log + WAL files, the operator's own tooling (garden auto-memorize, the bus WAL, `~/.wicked/memory.db*`)
# — which the scan observes but cannot attribute to a writer. The isolation VERDICT is the identifier
# scan (`identifier_hits`), the stamp check (`stamped_entries_in_live_state_home`) and the live run-id
# diff (`live_7701`) → `live_touched`; the count is context, never a verdict input. Emitted with every
# scan and stamped onto a committed report by `--rescrub-report`.
MODIFIED_ATTRIBUTION = (
    "ambient/unattributed: files under the operator-global stores modified during the run window by the "
    "live :7701 daemon and the operator's own tooling; the scan observes them but cannot attribute them to "
    "a writer. The isolation verdict is identifier_hits + stamped_entries_in_live_state_home + live_7701 "
    "(-> live_touched), not this count."
)
# The operator-specific SEGMENTS of an ambient path, by shape: a wicked-garden project id (`wicked-` + 8
# hex), a UUID (a session id, a run id), an engine-minted project id (`proj_` + digits).
GARDEN_PROJECT_ID_RE = re.compile(r"\bwicked-[0-9a-f]{8}\b")
UUID_RE = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
ENGINE_PROJECT_ID_RE = re.compile(r"\bproj_[0-9]+\b")


def scrub_operator_path(path: str) -> str:
    """Stable placeholders for the operator-specific segments of an AMBIENT path (`modified_sample`):
    `wicked-<8 hex>` → `wicked-<project>`, a UUID → `<uuid>`, `proj_<digits>` → `<proj>`. Applied to the
    ambient paths ONLY — the rig's own identifiers (`needles`, `identifier_hits`,
    `stamped_entries_in_live_state_home`) are the proof and stay verbatim. Idempotent: no placeholder
    matches any of the three shapes."""
    path = GARDEN_PROJECT_ID_RE.sub("wicked-<project>", path)
    path = UUID_RE.sub("<uuid>", path)
    return ENGINE_PROJECT_ID_RE.sub("<proj>", path)


def scrub_report_json(report: object) -> bool:
    """The JSON-aware half of the scrub: every `isolation_scan` dict in the document gets its
    `modified_sample` paths placeholdered (`scrub_operator_path`) and its `attribution` note (inserted
    right after `modified_sample`, where a fresh scan emits it, when a report written before the note
    existed lacks it). Scoped to the AMBIENT paths on purpose — `needles`, `identifier_hits` and
    `stamped_entries_in_live_state_home` are the rig's own identifiers and stay verbatim. Mutates in
    place; True when anything changed (a second pass over the same document returns False)."""
    changed = False
    stack: list[object] = [report]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            scan = node.get("isolation_scan")
            if isinstance(scan, dict):
                sample = scan.get("modified_sample")
                if isinstance(sample, list):
                    scrubbed = [scrub_operator_path(p) if isinstance(p, str) else p for p in sample]
                    if scrubbed != sample:
                        scan["modified_sample"] = scrubbed
                        changed = True
                if "attribution" not in scan:
                    items = list(scan.items())
                    at = next((i for i, (k, _) in enumerate(items) if k == "modified_sample"), len(items) - 1) + 1
                    items.insert(at, ("attribution", MODIFIED_ATTRIBUTION))
                    scan.clear()
                    scan.update(items)
                    changed = True
                elif scan["attribution"] != MODIFIED_ATTRIBUTION:
                    scan["attribution"] = MODIFIED_ATTRIBUTION
                    changed = True
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return changed


def rescrub_report_file(path: Path) -> dict:
    """Apply the current scrub to an EXISTING report file in place (no re-run): `scrub_report_text`
    over the text, then `scrub_report_json` over the parsed document, re-serialized exactly as
    `--report-out` writes it (`json.dumps(indent=2)` + newline). The JSON must still parse and NO
    spelling the scrub masks may survive — plain, `/private`-prefixed or dashed temp root / repo root /
    home (`scrub_residue`, the scrub's own literal list) — nor the two temp-root shapes or the degraded
    `/private~`; residue raises BEFORE anything is written (fail closed). A deterministic
    re-derivation — a second pass is a no-op. Returns what changed."""
    before = path.read_text(encoding="utf-8")
    report = json.loads(scrub_report_text(before))  # a scrub must never corrupt the artifact
    scrub_report_json(report)
    after = json.dumps(report, indent=2, default=str) + "\n"
    residue = scrub_residue(after)
    if residue:
        raise RuntimeError(f"scrub left residue: {residue}")
    if after != before:
        path.write_text(after, encoding="utf-8")
    return {"path": str(path), "changed": after != before, "bytes_before": len(before), "bytes_after": len(after)}


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    if "--rescrub-report" in argv:
        # Offline: re-apply the current scrub to an already-committed report (no daemon, no re-run).
        target = Path(argv[argv.index("--rescrub-report") + 1])
        print(json.dumps(rescrub_report_file(target)))
        return 0
    report_out = argv[argv.index("--report-out") + 1] if "--report-out" in argv and argv.index("--report-out") + 1 < len(argv) else None
    signal.signal(signal.SIGTERM, _on_sigterm)
    report: dict = {"ok": False, "setup": {}, "scenarios": suite.rows, "findings": findings, "live_touched": [], "counts": {}}
    rig: Rig | None = None
    try:
        rig = Rig(report)
        rig.prepare()
        rig.start_daemon()
        rig.build_identity()
        rig.register_repo()
        rig.start_fixture_server()
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            raise SetupFailure("playwright", "pip install playwright && playwright install chromium") from e
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not HEADED)
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 800})
                suite.page = page
                report["setup"]["versions"]["chromium"] = browser.version
                run_scenarios(rig, page)
            finally:
                suite.page = None
                try:
                    browser.close()
                except Exception as e:  # noqa: BLE001 — a close failure must not skip the daemon teardown
                    report["setup"]["browser_close_error"] = str(e)[:300]
    except SetupFailure as e:
        report["setup"][e.step] = {"ok": False, "error": e.why}
        report["setup_failure"] = {"step": e.step, "error": e.why}
        print(f"[SETUP  ] {e.step}: {e.why.splitlines()[0][:200]}", file=sys.stderr)
    except KeyboardInterrupt as e:
        report["aborted"] = f"interrupted ({e or 'SIGINT'}) — teardown still ran"
    except BaseException as e:  # noqa: BLE001 — a harness bug is a failed run, never a leaked daemon
        report["aborted"] = f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=6)}"
    finally:
        if rig is not None:
            try:
                report["live_touched"] = rig.teardown(findings)
            except BaseException as e:  # noqa: BLE001
                report["setup"]["teardown_error"] = f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=4)}"
                report["aborted"] = report.get("aborted") or f"teardown raised: {e}"
    for touched in report["live_touched"]:
        findings.append(f"ISOLATION: {touched}")
    finalize(report, suite.ok)
    report["counts"] = suite.counts()
    print("\n| id | scenario | status | seconds | detail |\n|---|---|---|---|---|")
    for r in suite.rows:
        first = r["detail"].splitlines()[0] if r["detail"] else ""
        print(f"| {r['id']} | {r['title']} | {r['status'].upper()} | {r['seconds']} | {first.replace('|', '/')} |")
    print(f"\ncounts: {report['counts']}  live_touched: {len(report['live_touched'])}  teardown_failures: {len(report.get('teardown_failures') or [])}  ok: {report['ok']}\n")
    scrub_report_json(report)  # idempotent over a fresh scan; keeps `--report-out` == its own `--rescrub-report`
    text = json.dumps(report, indent=2, default=str)
    print(text)
    if report_out:
        try:
            Path(report_out).parent.mkdir(parents=True, exist_ok=True)
            Path(report_out).write_text(scrub_report_text(text) + "\n", encoding="utf-8")
            print(f"[REPORT ] written to {report_out} (operator home scrubbed)", file=sys.stderr)
        except OSError as e:
            print(f"[REPORT ] could not write {report_out}: {e}", file=sys.stderr)
            return 1
    return exit_code(report)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
