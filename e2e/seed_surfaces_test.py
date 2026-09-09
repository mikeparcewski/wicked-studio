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
  - ISOLATION IS RE-DERIVED, NOT ASSERTED. At teardown the suite (a) scans the real `~/.wicked-crew`
    for entries stamped by this run, (b) byte-scans every operator-global wicked store
    (`~/.wicked-crew`, `~/.something-wicked`, `~/.wicked`, `~/wicked-interactive`, `~/.config/wicked-*`)
    modified DURING the run for this run's identifiers (stamp, temp-dir name, project/repo/run ids),
    and (c) diffs the live `:7701` daemon's run ids before/after (read-only GETs). Any hit is
    `live_touched` and FAILS THE PROCESS regardless of the scenario table. What the daemon wrote
    into the scratch HOME is listed as the `HOME-WRITES` finding — those are the writes that would
    have landed in the operator's home without the scratch.
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
  - TEARDOWN AFFECTS THE VERDICT (`teardown_failures`): a failed cancellation, `daemon_stopped=
    false`, a bridge pid surviving SIGKILL, an unverified bridge identity, a failed temp-dir
    removal, or an isolation scan that could not run (or hit an unreadable file: `live_scan_error`
    with path + errno) each make `report.ok=false` — cleanup continues past each failure, and every
    failure lands in `findings` AND `setup.teardown.failures[]`.
  - BUILD IDENTITY IS BYTES, not a version label: the served `index.html` and every referenced
    asset are hashed and compared against THIS worktree's `dist/` build (`npm run build`); a
    mismatch or a missing asset is a setup failure.

Prereqs: an installed `wicked-crew` (0.7.x; `CREW_CLI=<path to dist/cli/index.js>` overrides),
`wicked-estate-mcp` on PATH (the substitute producer — the same binary crew spawns), a `dist/`
build of this checkout (`npm run build`), Python Playwright (`pip install playwright &&
playwright install chromium`), `git`.

Env knobs: CREW_CLI, SEED_GOVERNED_TIMEOUT_S (default 600), SEED_ONBOARD_TIMEOUT_S (default
240), SEED_GOVERNED=0 (disables the governed scenario — TST-1 then FAILS, by design),
SEED_KEEP_TMP=1, SEED_HEADED=1. `--report-out <path>` writes the JSON report (operator home
scrubbed to `~`) to a file as well as stdout.

`python3 e2e/seed_surfaces_test.py --self-test` runs the in-process checks of the harness's own
safety plumbing (exit semantics, xfail hygiene, pid identity, gate oracle, fail-closed teardown,
isolation-scan errors, campaign oracle, build-identity compare, per-target cleanup rows,
persistence content oracle) — no daemon.

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
                shot = str(SHOTS / f"{sid}.png")
                self.page.screenshot(path=shot, full_page=True)
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
      - the temp dir still present after removal was attempted;
      - the isolation scan raising, or any unreadable file / stat error inside the operator stores
        (`live_scan_error`: the store was not fully inspected, so "uncontaminated" is unproven)."""
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
        if bridge.get("error"):
            out.append(f"bridge_stop_error: {bridge['error']}")
    if "tmp_removed" in t and t.get("tmp_removed") is not True:
        out.append(f"tmp_not_removed: {t.get('tmp')} ({t.get('tmp_remove_error') or 'still present'})")
    if t.get("isolation_scan_error"):
        out.append(f"isolation_scan_failed: {t['isolation_scan_error']}")
    scan = t.get("isolation_scan") or {}
    for e in (scan.get("scan_errors") or []) if isinstance(scan, dict) else []:
        out.append(f"live_scan_error: {e.get('file')} — {e.get('error')} (errno {e.get('errno')})")
    for e in t.get("step_errors") or []:
        out.append(f"teardown_step_raised: {e}")
    return out


def finalize(rep: dict, suite_ok: bool) -> dict:
    """`report.ok` is the ONLY thing the exit code reads: the scenario table AND the isolation proof
    AND a clean setup AND a clean teardown (no verdict-affecting failure) must all hold."""
    failures = list((rep.get("setup") or {}).get("teardown", {}).get("failures") or [])
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


def disjoint_pickers_oracle(a_ids: list[str], b_ids: list[str], doc_a: str, doc_b: str, issue: str) -> None:
    """VIB-3's oracle. OWNERSHIP is a plain assertion (an empty picker is a FAIL, never an expected
    gap); only the leak itself is the expected gap tied to `issue`."""
    assert a_ids, f"Project A's picker is empty — it must list at least its own document {doc_a!r}"
    assert b_ids, f"Project B's picker is empty — it must list at least its own document {doc_b!r}"
    assert doc_a in a_ids, f"Project A's picker does not list A's own document {doc_a!r}: {a_ids}"
    assert doc_b in b_ids, f"Project B's picker does not list B's own document {doc_b!r}: {b_ids}"
    expect_gap(doc_b not in a_ids, issue, f"Project A's picker lists B's document {doc_b!r}: {a_ids}")
    expect_gap(doc_a not in b_ids, issue, f"Project B's picker lists A's document {doc_a!r}: {b_ids}")


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


def campaigns_isolation_oracle(status: int, body: object, a_cards: list[str], b_cards: list[str]) -> dict:
    """TST-2's deterministic half. The campaigns wire must answer 200 with a list (any other
    answer is a FAIL carrying status/body — never "zero campaigns"); Project B's cards must exclude
    every card A renders (the isolation assertion); a card on the single-repo project A FAILS the
    BLOCKED premise (the assertion then has data and the row must stop being blocked)."""
    assert status == 200, f"GET /campaigns → {status} {str(body)[:300]}"
    campaigns = body.get("campaigns") if isinstance(body, dict) else body
    assert isinstance(campaigns, list), f"GET /campaigns answered 200 without a `campaigns` list: {str(body)[:300]}"
    leaked = sorted(set(a_cards) & set(b_cards))
    assert not leaked, f"Project B's campaign list carries A's campaign card(s): {leaked}"
    return {"engine_campaigns": len(campaigns), "a_cards": a_cards, "b_cards": b_cards}


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
        res = subprocess.run(["ps", "-axo", "pid=,pgid=,ppid=,command="], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as e:
        return [], f"ps failed: {e}"
    rows = []
    for line in res.stdout.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        try:
            rows.append({"pid": int(parts[0]), "pgid": int(parts[1]), "ppid": int(parts[2]), "command": parts[3]})
        except ValueError:
            continue
    if res.returncode != 0:
        return rows, f"ps exited {res.returncode}: {res.stderr.strip()[:200]}"
    return rows, None


def ps_started_at(pid: int) -> float | None:
    """The process start time, or None when it could not be READ (a failed/odd `ps`, a vanished
    pid) — None means UNVERIFIED, never "started recently enough"."""
    try:
        res = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    try:
        return time.mktime(time.strptime(res.stdout.strip(), "%a %b %d %H:%M:%S %Y"))
    except ValueError:
        return None


def read_bridge_lock(root: Path) -> tuple[dict | None, str]:
    """`<root>/.wi-serve.json` — advisory only. A symlink is refused outright."""
    lock = root / ".wi-serve.json"
    if lock.is_symlink():
        return None, "refused: .wi-serve.json is a symlink"
    if not lock.is_file():
        return None, "absent"
    try:
        data = json.loads(lock.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return None, f"unreadable: {e}"
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


def snapshot_live_runs() -> dict:
    """READ-ONLY look at the live :7701 daemon — its run ids, so teardown can prove nothing new
    appeared there. Never a POST."""
    try:
        st, body = api("GET", "/runs", timeout=5, base=f"{LIVE_ORIGIN}/api/v1")
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return {"reachable": False, "error": str(e)[:200], "run_ids": []}
    if st != 200 or not isinstance(body, dict):
        return {"reachable": False, "error": f"GET /runs → {st}", "run_ids": []}
    runs = body.get("runs", [])
    return {
        "reachable": True, "run_ids": sorted(r["session"]["id"] for r in runs),
        "problems": {r["session"]["id"]: str(r["session"].get("problem", ""))[:200] for r in runs},
    }


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


def scan_tree(roots: tuple[Path, ...] | list[Path], since: float, needles: list[bytes], opener: Callable[[Path], object] | None = None) -> dict:
    """Every regular file under `roots` modified since `since` (mtime OR ctime) is byte-scanned for
    the needles. Stat and read errors are RECORDED (`scan_errors`), and scanning continues — an
    error means the store was not fully inspected, which `teardown_failures` turns into
    `live_scan_error`."""
    modified: list[str] = []
    hits: list[dict] = []
    errors: list[dict] = []
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            try:
                if p.is_symlink() or not p.is_file():
                    continue
                st = p.stat()
            except OSError as e:
                errors.append({"file": str(p), "errno": e.errno, "error": f"{type(e).__name__}: {e.strerror or e}"})
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
                errors.append(err)
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
            f"seed-demo-a-{STAMP}", f"Seed-surfaces rule {STAMP}", TEST_BRIEF_TOKEN,
            f"Seed-surfaces import {STAMP}", CORPUS_SCOPE, MEMORY_SCOPE_ROOT, f"seed-surfaces memory {STAMP}",
            f"seed-surfaces-proposal-{STAMP}",
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
            # npm/npx (the bridge spawn): cache pinned into the temp dir, update chatter off.
            "npm_config_cache": str(self.npm_cache),
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
        self.seed_bridge_cache()
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

    def seed_bridge_cache(self) -> None:
        """The bridge is `npx --yes wicked-interactive@^0.8.1 serve` under the SCRATCH HOME, so npx
        would otherwise fetch 200 MB into a cold cache. Clone the operator's already-resolved
        `_npx/<hash>` install (read-only on the source; APFS clonefile when available) into the
        scratch npm cache under the same key, so the bridge starts offline in seconds."""
        info: dict = {"seeded": False, "spec": INTERACTIVE_SPEC}
        t0 = time.time()
        for pkg in sorted((REAL_HOME / ".npm" / "_npx").glob("*/package.json")):
            try:
                meta = json.loads(pkg.read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if meta.get("_npx", {}).get("packages") != [INTERACTIVE_SPEC]:
                continue
            src = pkg.parent
            dst = self.npm_cache / "_npx" / src.name
            try:
                if sys.platform == "darwin":
                    subprocess.run(["cp", "-Rc", str(src), str(dst)], check=True, capture_output=True, timeout=300)
                else:
                    shutil.copytree(src, dst, symlinks=True)
                info.update(seeded=True, source=str(src), key=src.name, seconds=round(time.time() - t0, 1))
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
                info["error"] = str(e)[:300]
            break
        if not info["seeded"]:
            info["note"] = "no cached install found — the bridge's npx will resolve the spec from the registry (slower; needs network)"
        self.report["setup"]["bridge_cache"] = info

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

    def register_repo(self) -> None:
        """Setup, over the API — labelled. Registration launches the built-in `onboarding` workflow:
        two TOOL phases (`wicked-estate index`, `wicked-estate clusters`), no agent, no council."""
        status, registered = api("POST", "/repos", {"name": f"seed-surfaces-{STAMP}", "rootPath": str(self.repo_root)})
        if status != 201 or not isinstance(registered, dict):
            raise SetupFailure("repo_register", f"POST /repos → {status} {registered}")
        self.repo_id = registered["repo"]["id"]
        self.needles.append(self.repo_id)
        onboard_run = registered.get("onboardRunId")
        onboard_status = wait_terminal(onboard_run, ONBOARD_TIMEOUT_S) if isinstance(onboard_run, str) else None
        self.report["setup"]["repo_register"] = {
            "ok": True, "substitute": "API — harness setup, not a certified journey",
            "repo_id": self.repo_id, "onboard_run": onboard_run,
            "onboard_status": onboard_status, "onboard_workflow": "onboarding (tool phases only: estate index → clusters)",
        }

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

    def stop_bridge(self) -> dict:
        """The pool spawns the bridge DETACHED (its own group), so the daemon's group stop does not
        reach it. Identify it by command line + VERIFIED start time, cross-check the advisory lock,
        then terminate — never signal a pid the identity check did not produce. A failed `ps` or a
        candidate with no readable start time leaves the identity UNVERIFIED: nothing is signalled
        beyond the daemon group we spawned ourselves, and the teardown records the failure."""
        info: dict = {}
        found = bridge_processes(self.idocs, self.daemon_started_at or self.run_started_at)
        procs = found["identified"]
        lock, lock_state = read_bridge_lock(self.idocs)
        lock_pid = lock.get("pid") if lock else None
        identified = {p["pid"] for p in procs}
        brief = lambda p: {"pid": p["pid"], "pgid": p["pgid"], "ppid": p["ppid"], "started_at": p["started_at"], "command": p["command"][:200]}  # noqa: E731
        info.update(
            lock=lock_state, lock_pid=lock_pid, lock_pid_valid=valid_pid(lock_pid),
            ps_ok=found["ps_ok"], ps_error=found["ps_error"],
            identified=[brief(p) for p in procs],
            unverified=[brief(p) for p in found["unverified"]],
            lock_pid_matches_identified=lock_pid in identified,
        )
        if not found["ps_ok"]:
            info["identity_unverified"] = f"ps failed ({found['ps_error']}) — no bridge pid can be identified; only the daemon group we spawned was stopped"
        elif found["unverified"]:
            info["identity_unverified"] = (f"{len(found['unverified'])} candidate(s) serving {self.idocs} have no readable start time "
                                           f"(pids {[p['pid'] for p in found['unverified']]}) — NOT signalled")
        if procs:
            info["terminated"] = terminate_pids(sorted(identified))
        elif valid_pid(lock_pid) and pid_alive(lock_pid):
            info["refused"] = f"lock pid {lock_pid} is alive but no process serving {self.idocs} was identified — NOT signalled"
        return info

    def scratch_writes(self, base: Path, cap: int = 400) -> list[str]:
        out: list[str] = []
        if not base.exists():
            return out
        for p in sorted(base.rglob("*")):
            if p.is_file() or p.is_symlink():
                out.append(str(p.relative_to(self.tmp)))
            if len(out) >= cap:
                out.append("… (truncated)")
                break
        return out

    def scan_operator_state(self) -> dict:
        """Re-derive isolation: every file under the operator-global wicked stores that was modified
        DURING this run is byte-scanned for this run's identifiers; entries stamped by this run under
        ~/.wicked-crew are listed; the live :7701 run ids are diffed."""
        needles = [n.encode() for n in dict.fromkeys(self.needles) if n]
        since = self.run_started_at
        tree = scan_tree(OPERATOR_STATE_ROOTS, since, needles)
        modified, hits = tree["modified"], tree["hits"]
        stamped = sorted(
            str(p.relative_to(LIVE_STATE_HOME))
            for p in LIVE_STATE_HOME.rglob("*")
            if any(n in p.name for n in self.needles)
        ) if LIVE_STATE_HOME.is_dir() else []
        live_after = snapshot_live_runs()
        new_live = sorted(set(live_after["run_ids"]) - set(self.live_before["run_ids"]))
        ours_on_live = [
            rid for rid in new_live
            if any(n in live_after.get("problems", {}).get(rid, "") for n in self.needles)
        ]
        return {
            "roots": [str(r) for r in OPERATOR_STATE_ROOTS], "needles": list(dict.fromkeys(self.needles)),
            "files_modified_during_run": len(modified), "modified_sample": modified[:20],
            "scan_errors": tree["scan_errors"],
            "identifier_hits": hits, "stamped_entries_in_live_state_home": stamped,
            "live_7701": {
                "reachable_before": self.live_before.get("reachable"), "reachable_after": live_after.get("reachable"),
                "runs_before": len(self.live_before["run_ids"]), "runs_after": len(live_after["run_ids"]),
                "new_run_ids": new_live, "new_runs_carrying_our_identifiers": ours_on_live,
            },
        }

    def teardown(self, findings: list[str]) -> list[str]:
        """Runs on EVERY exit path. Every step is attempted even when an earlier one failed; every
        failure is recorded (`step_errors`, then `failures` via `teardown_failures`) and lands in
        `findings` — the verdict reads them. Returns the contamination findings (`live_touched`)."""
        t: dict = self.report["setup"].setdefault("teardown", {})
        step_errors: list[str] = []
        t["step_errors"] = step_errors

        def step(name: str, fn: Callable[[], None]) -> None:
            try:
                fn()
            except BaseException as e:  # noqa: BLE001 — cleanup continues; the failure is recorded, never swallowed
                step_errors.append(f"{name}: {type(e).__name__}: {e}")

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

        step("cancel_live_runs", _cancel)
        step("stop_daemon_group", _daemon)
        step("close_daemon_log", _log)
        step("stop_bridge", _bridge)
        step("stop_fixture_server", _fixture)
        if "bridge" not in t:
            t["bridge"] = {"error": "stop_bridge raised — see step_errors"}
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
        live_touched: list[str] = []
        try:
            scan = self.scan_operator_state()
        except BaseException as e:  # noqa: BLE001 — an un-run scan is a verdict-affecting failure, never a clean bill
            t["isolation_scan_error"] = f"{type(e).__name__}: {e}"
            scan = None
        if scan is not None:
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
            if scan["scan_errors"]:
                findings.append(f"LIVE-SCAN-ERROR: {len(scan['scan_errors'])} file(s) inside the operator stores could not be inspected — "
                                f"the isolation proof is INCOMPLETE: {scan['scan_errors'][:5]}")
        t["tmp"] = str(self.tmp)
        t["tmp_kept"] = KEEP_TMP
        if not KEEP_TMP:
            try:
                shutil.rmtree(self.tmp)
            except OSError as e:
                t["tmp_remove_error"] = f"{type(e).__name__}: {e}"
            t["tmp_removed"] = not self.tmp.exists()
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


def ui_delete_doc(page, pid: str, mode: str, name: str, bridge_gap_issue: str) -> None:
    """Picker 🗑 → confirm → Delete → absent after a REAL reload. The ONE expected gap: crew's own
    sentence that the pinned bridge predates `DELETE /api/docs/:doc` (a `wire` failure rendered in
    `doc-delete-error`, studio#213). A bridge-unavailable hint is a skip only when the daemon
    confirms it; a partial delete or any other wire error is a plain failure."""
    before = picker_ids(page, pid, mode)
    assert name in before, f"{name} not listed under {pid}/{mode} before delete: {before}"
    tid(page, "doc-delete-trigger", doc_id=name).click()
    tid(page, "doc-delete-confirm").wait_for(timeout=10_000)
    tid(page, "doc-delete-go").click()
    deadline = time.time() + 30
    while time.time() < deadline:
        if tid(page, "doc-delete-error").count() > 0:
            wire = text_of(tid(page, "doc-delete-error"))
            if PREDATES_DELETE_RE.search(wire):
                raise ExpectedGap(f"{bridge_gap_issue}: the pinned bridge predates DELETE /api/docs/:doc — {wire[:300]}")
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

    def isof() -> str:
        """MUTATION isolation, the EDIT arm: from Project B's shell, fork A's document (Versions tab →
        Fork = `POST /d/:doc/api/fork`, a new version). Correct: B's shell does not frame it, or the
        fork is refused. Expected gap (crew#472): the fork lands a new version on A's document."""
        (A, doc_a), (B, _doc_b) = ctx["docs"][0], ctx["docs"][1]
        before = doc_versions(A, doc_a)
        n_before = len(before["versions"])
        goto(page, f"/p/{quote(B)}/document/{quote(doc_a)}")
        seen = wait_any(page, ["doc-canvas", "doc-canvas-error", "doc-picker-empty", "doc-canvas-loading"], BRIDGE_TIMEOUT_MS)
        if not (seen == "doc-canvas" and tid(page, "doc-canvas", doc_id=doc_a).count() > 0):
            return f"B's shell does not frame A's document (rendered: {seen}) — no foreign mutation is reachable"
        # The panel starts collapsed once a doc owns the canvas: the rail's Versions glyph opens it on that tab.
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
        after = doc_versions(A, doc_a)
        n_after = len(after["versions"])
        if outcome is None:
            raise AssertionError(f"the fork from B's shell neither landed nor was refused within 30s (A's versions {n_before} → {n_after})")
        if outcome[0] == "refused":
            assert n_after == n_before, f"the UI reported a refused fork but A's document gained versions ({n_before} → {n_after})"
            return f"B's shell framed A's document but the fork was REFUSED ({outcome[1][:200]}); A's lineage unchanged ({n_before} versions)"
        expect_gap(n_after == n_before, "crew#472",
                   f"a fork issued from Project B's shell LANDED on Project A's document {doc_a!r}: versions {n_before} → {n_after} "
                   f"(new head {after.get('head')}, url {outcome[1].replace(ORIGIN, '')}) — the shared root accepts foreign mutations")
        return "the fork from B's shell changed nothing on A's document"

    suite.run("ISO-F", "Foreign-context mutation (edit arm): fork A's doc from B's shell must be refused or unreachable", isof,
              xfail="crew#472", requires=("VIB-1D", "VIB-2D"))

    def isod() -> str:
        """MUTATION isolation, the DELETE arm: from Project B's picker, delete A's document. Correct:
        A's doc is not listed under B (invisible) or the delete is refused by scope. Two known gaps
        gate this today — the picker leak (crew#472) and the pinned bridge's missing DELETE route
        (studio#213); the one that fires is named in the detail."""
        (A, doc_a), (B, _doc_b) = ctx["docs"][0], ctx["docs"][1]
        b_ids = picker_ids(page, B, "document")
        if doc_a not in b_ids:
            return f"A's document is invisible from B's picker ({b_ids}) — no foreign delete is reachable"
        a_before = picker_ids(page, A, "document")
        assert doc_a in a_before, f"A's own picker lost {doc_a} before the foreign delete: {a_before}"
        goto(page, f"/p/{quote(B)}/document")
        wait_any(page, ["doc-picker", "doc-picker-empty", "doc-canvas-error", "doc-canvas-loading"], BRIDGE_TIMEOUT_MS)
        tid(page, "doc-delete-trigger", doc_id=doc_a).click()
        tid(page, "doc-delete-confirm").wait_for(timeout=10_000)
        tid(page, "doc-delete-go").click()
        deadline = time.time() + 30
        while time.time() < deadline:
            if tid(page, "doc-delete-error").count() > 0:
                wire = text_of(tid(page, "doc-delete-error"))
                if PREDATES_DELETE_RE.search(wire):
                    raise ExpectedGap(f"studio#213: the foreign delete cannot reach a scope check — the pinned bridge predates DELETE /api/docs/:doc ({wire[:200]})")
                if re.search(r"project|scope|not (in|part of)|forbidden|403", wire, re.I):
                    return f"the delete of A's document from B's shell was REFUSED by scope: {wire[:200]}"
                raise AssertionError(f"delete from B's shell failed on the wire for an unrelated reason: {wire[:300]}")
            if tid(page, "doc-delete-partial").count() > 0:
                raise AssertionError(f"PARTIAL delete from a foreign shell: {text_of(tid(page, 'doc-delete-partial'))[:300]}")
            if tid(page, "doc-delete-bridge-hint").count() > 0:
                reason = bridge_unavailable_reason(B)
                if reason is not None:
                    raise Skip(f"bridge unavailable during the foreign delete (daemon 503 bridge_unavailable: {reason[:200]})")
                raise AssertionError(f"foreign delete shows a bridge hint while the daemon serves the bridge: {text_of(tid(page, 'doc-delete-bridge-hint'))[:200]}")
            if tid(page, "doc-delete-confirm").count() == 0:
                break
            page.wait_for_timeout(200)
        a_after = picker_ids(page, A, "document")
        expect_gap(doc_a in a_after, "crew#472", f"a delete issued from Project B's shell REMOVED Project A's document {doc_a!r} (A's picker: {a_before} → {a_after})")
        return "the delete from B's shell left A's document in place"

    suite.run("ISO-D", "Foreign-context mutation (delete arm): delete A's doc from B's shell must be refused or invisible", isod,
              xfail="studio#213 (delete wire) / crew#472 (leak)", requires=("VIB-1D", "VIB-2D"))

    def dem1d() -> str:
        name = ui_seed_demo(page, ctx["A"], f"seed-demo-a-{STAMP}", rig.fixture_url)
        ctx["demos"].append((ctx["A"], name))
        ids = picker_ids(page, ctx["A"], "video")
        assert name in ids, f"{name} missing from A's demo picker: {ids}"
        return f"demo '{name}' created under A via the wizard (target {rig.fixture_url}, one hand-pinned step; authoring agent disabled); A's picker lists it"

    suite.run("DEM-1D", "Seed a demo in Project A via the wizard (deterministic)", dem1d, requires=("PRJ-1",))

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
        button.click()
        page.wait_for_function(
            "() => ['queuing','recording'].includes(document.querySelector('[data-testid=\"video-record\"]')?.getAttribute('data-state')) "
            "|| document.querySelector('[data-testid=\"video-record-error\"]') !== null",
            timeout=15_000,
        )
        if tid(page, "video-record-error").count() > 0:
            raise AssertionError(f"the record request itself was refused at the click site: {text_of(tid(page, 'video-record-error'))[:300]}")
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
        answer = str(bridge_answer.get("text"))[:240] if bridge_answer else "no bridge answer within 30 s"
        raise Blocked(
            "BLOCKED — demo RECORDING needs a second browser/recorder the rig cannot host: the record request was queued through the UI "
            f"(⏺ → data-state {state!r}, POST /api/events wicked.interactive.demo.requested accepted) and the bridge answered: {answer!r}. "
            "The recorder is the bridge's OWN Playwright Chromium (`recordDemo`: `import('playwright')` → `chromium.launch`), resolved from the "
            "bridge's HOME/PLAYWRIGHT_BROWSERS_PATH — under the hermetic scratch HOME there is no browser cache, and the rig's Playwright is the "
            "test client, not the bridge's; it also replays `demo.spec.mjs`, which only the demo AUTHORING run writes (disabled here: "
            "`--no-interactive-demo-events`, no agent runs in the seed suite; the wizard's steps have no backend consumer — finding 10). "
            "Playback of the seeded storyboard IS certified (DEM-PLAY). Tracked in studio#217."
        )

    suite.run("DEM-REC", "Demo recording (⏺ Re-record → new version → playback of the recording)", demrec, requires=("DEM-PLAY",))

    def dem3() -> str:
        A, demo_a = ctx["demos"][0]
        a_ids = picker_ids(page, A, "video")
        assert a_ids and demo_a in a_ids, f"ownership broken: A's demo picker does not list its own demo {demo_a!r}: {a_ids}"
        b_ids = picker_ids(page, ctx["B"], "video")
        expect_gap(demo_a not in b_ids, "crew#472", f"Project B's demo picker lists A's demo {demo_a!r}: {b_ids}")
        return "B lists none of A's demos"

    suite.run("DEM-3", "Demos are disjoint per project (B ∌ A's demo)", dem3, xfail="crew#472", requires=("DEM-1D", "PRJ-2"))

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
        """Campaign isolation: the wire MUST answer 200 with a list (anything else FAILS with
        status/body); Project B's campaign cards MUST exclude A's (the isolation assertion, run on
        whatever data exists); only the part the governed budget prevents — LAUNCHING a fan so the
        assertion has a campaign to bite on — is reported blocked."""
        A, B = ctx["A"], ctx["B"]

        def cards(pid: str) -> list[str]:
            goto(page, f"/p/{quote(pid)}/campaigns")
            tid(page, "project-campaigns", project_id=pid).wait_for(timeout=15_000)
            wait_any(page, ["campaigns-page", "campaigns-unsupported"], 30_000)
            page.wait_for_load_state("networkidle")
            return attr_values(page, "campaign-card", "data-campaign-id")

        a_cards = cards(A)
        b_cards = cards(B)
        st, body = api("GET", "/campaigns")
        proof = campaigns_isolation_oracle(st, body, a_cards, b_cards)
        ctx["campaigns_proof"] = proof
        if a_cards:
            raise AssertionError(f"campaign card(s) rendered on the single-repo project A ({a_cards}) — the BLOCKED premise no longer holds; "
                                 f"the partition assertion ran (B renders {b_cards}) and this row must become a plain verdict (App.tsx:466)")
        raise Blocked(
            f"BLOCKED (fan only) — deterministic half executed: GET /campaigns → 200 with a list of {proof['engine_campaigns']} campaigns; "
            f"A renders {len(a_cards)} campaign cards, B renders {len(b_cards)}, and B's set excludes A's (∩ = ∅). What the budget prevents: "
            "a single-repo test registers no engine campaign (`campaignRegistered:false`), so the partition (App.tsx:466) has no campaign to bite on; "
            "observing it needs a ≥2-repo FAN (crew#390 shape) = ≥2 governed runs, over the one-governed-scenario budget. Fixture path when a fan is "
            "affordable: attach a second repo to A, launch once, then this same assertion (B's cards ∌ A's) is the verdict. Context: studio#216."
        )

    suite.run("TST-2", "Tests list is partitioned per project (campaign isolation)", tst2, requires=("PRJ-2",))

    # ── Cleanup — only after every consumer ───────────────────────────────────
    # CLN-1 PER TARGET: one row per seeded doc/demo — an ExpectedGap on the first never hides the rest.
    targets = [(pid, "document", name) for pid, name in ctx["docs"]] + [(pid, "video", name) for pid, name in ctx["demos"]]
    if targets:
        run_delete_rows(suite, targets, lambda pid, mode, name: ui_delete_doc(page, pid, mode, name, bridge_gap_issue="studio#213"), "studio#213")
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


# ── Self-test of the harness's own safety plumbing ────────────────────────────


def self_test() -> int:
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
        "bridge": {"terminated": {"signalled": [9], "forced": [9], "remaining": [9]}, "identity_unverified": "no start time"},
        "tmp": "/x", "tmp_removed": False, "tmp_remove_error": "EBUSY",
        "isolation_scan_error": "PermissionError: scan aborted",
        "isolation_scan": {"scan_errors": [{"file": "/x/y", "errno": 13, "error": "PermissionError: Permission denied"}]},
        "step_errors": ["stop_bridge: RuntimeError: boom"],
    }
    fails = teardown_failures(all_bad)
    kinds = {f.split(":")[0] for f in fails}
    results["teardown_names_every_failure_kind"] = {
        "run_cancel_failed", "daemon_not_stopped", "bridge_survived_sigkill", "bridge_identity_unverified", "tmp_not_removed",
        "isolation_scan_failed", "live_scan_error", "teardown_step_raised",
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
    # 10. campaign isolation oracle (item 5): a 500 body is a FAIL (never "zero campaigns"), a 200
    #     without a list is a FAIL, B carrying A's card is a FAIL, a clean answer returns.
    def camp_raises(st, body, a, b) -> bool:
        try:
            campaigns_isolation_oracle(st, body, a, b)
        except AssertionError:
            return True
        return False
    results["campaigns_500_is_fail"] = camp_raises(500, {"error": "database unavailable"}, [], [])
    results["campaigns_200_without_list_is_fail"] = camp_raises(200, {"ok": True}, [], [])
    results["campaigns_b_carrying_a_is_fail"] = camp_raises(200, {"campaigns": [{"id": "c1"}]}, ["c1"], ["c1"])
    results["campaigns_clean_passes"] = not camp_raises(200, {"campaigns": []}, [], []) and not camp_raises(200, {"campaigns": [{"id": "c1"}]}, ["c1"], [])
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
    ok = all(results.values())
    print(json.dumps({"self_test": results, "ok": ok}, indent=2))
    return 0 if ok else 1


# ── main ──────────────────────────────────────────────────────────────────────


def _on_sigterm(*_args) -> None:
    raise KeyboardInterrupt("SIGTERM")


def scrub_report_text(text: str) -> str:
    """The committed artifact must not carry the operator's home path: every occurrence of the real
    HOME (and its /private-prefixed spelling) reads `~`."""
    for home in dict.fromkeys([str(REAL_HOME), f"/private{REAL_HOME}", str(Path.home())]):
        if home and home != "/":
            text = text.replace(home, "~")
    return text


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
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
