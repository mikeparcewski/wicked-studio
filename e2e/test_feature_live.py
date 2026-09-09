#!/usr/bin/env python3
"""
LIVE test of wicked-studio's Test feature (the interactive / gated testing approach) — driven
through the studio UI on the operator's dogfood daemon, against wicked-studio itself.

Unlike `studio_standalone_test.py` this harness spawns NOTHING: it talks only to the live crew
daemon (default http://localhost:7701, the bundled studio SPA + /api/v1 + /ws) and drives the
real "Run recon" / "New test" flows a user would: open the verb on /testing/campaigns, attach the
registered `wicked-studio` repo through the picker, type a ONE-sentence brief, submit, wait for the
intake gate to arrive on the panel's SteeringGate card, approve it THERE (never via the API), then
watch the governed run to a terminal state and inspect what it produced.

Scenarios (see docs/testing/test-feature-live-report.md for the results):
  LT-1  "Run recon" over wicked-studio — gate shape, unitPlanned count (core#393), the plan's
        quality, whether ANY sibling runs are launched after completion (crew#473).
  LT-2  "New test" over wicked-studio — same, plus: do sibling runs appear under a campaign on
        /testing/campaigns and reach verdicts?
  LT-3  consistency — LT-1 again with the IDENTICAL brief; plan diff + overlap %.
  LT-4  surfaces coverage — which studio surfaces (WS events, /api/v1 routes, CLI, UI pages) the
        plan(s) propose to test vs what the brief asked.
  LT-5  the operator's view — screenshots of the Tests landing / campaign scoreboard / run page
        after each run; stale state, statuses, rename leftovers.

HARD RULES this harness enforces on itself:
  * SERIALIZATION PREFLIGHT before EVERY governed launch — exactly four gates: (1) zero runs in
    running/executing/awaiting_human on the daemon, (2) 1-minute load average < 20, (3) swap used
    < 85 % — the contract default (brief-test-feature-live.md: "refuse to run if … swap > 85%"),
    (4) NO heavy worker / build fan-out on the host — `fanout_processes()` reads
    `ps -axo pid=,command=`, tokenizes every command line (`shlex.split`, whitespace fallback) and
    matches on TOKENS, never on argument order (`fanout_rule`, documented in `FANOUT_RULES`): the
    program (basename of argv[0] — a `.js`/`.mjs`/`.cjs` extension stripped — or of the script a
    runtime launcher such as `node` runs) is `cargo` with build/test/clippy/run among its tokens
    (`cargo +stable build` included), `go` with build/test, `claude` with `-p`/`--print` anywhere,
    `codex` with `exec`, a package runner (`npm`/`pnpm`/`yarn`/`bun`) with build/test/typecheck/
    lint/check ANYWHERE among its tokens — with or without `run`, `test:*`/`build:*` scripts
    included (`pnpm build`, `yarn build`, `bun test`), a direct build/test executable by basename
    (`vite`, `tsc`, `esbuild`, `webpack`, `rollup`, `vitest`, `jest`, `playwright`, `rustc`,
    `make`, `ninja`, `gradle`, `mvn`, `pytest`, `py.test` — `node …/vite/bin/vite.js build`
    included), a `python*` (`python`, `python3`, `python3.12` …) whose tokens carry `-m pytest` or
    `-m unittest` (with or without `-n`; `python3 -m json.tool` and the harness's own
    `python3 e2e/test_feature_live.py` never), or a
    `wicked-crew serve` whose `--port` VALUE (`--port N` / `--port=N`, any position) is not 7701 —
    the dogfood daemon itself (no port, or 7701), an idle `node` and `npm view x` never match.
    `FANOUT_PATTERN` (a regex) ADDS matches; it never replaces the rules. Matches are recorded in
    the reading (`fanout: ["<pid> <cmd>", …]`) and a failed `ps` is itself a failed preflight (fail
    closed) — a build outside the daemon's run list can no longer overlap a launch.
    ONLY an explicit `SWAP_MAX_PCT` env var moves the swap gate, and ONLY together with
    `SWAP_MAX_PCT_ACK=contract-deviation` (without the acknowledgement the harness exits naming both
    vars) — exactly what the contract's 2026-09-09 AMENDMENT permits ("an EXPLICIT operator override
    … is permitted and MUST be recorded in the report as a contract deviation"); the move is logged
    as `CONTRACT DEVIATION` at every preflight, stamped on every preflight reading and recorded in
    the report's top-level `contract_deviation` {var, contract, effective, ack} — never a silent
    constant edit. (`vm_stat` free/available memory is recorded for the
    report but NOT gated on — macOS keeps free pages near zero by design.) Polls every 60 s for up
    to 20 min; if the gate never clears the harness STOPS and reports "preflight never cleared".
  * The preflight is RE-RUN (all four gates, one reading) immediately before the submit click; if
    it fails the launch is not submitted (`launch_aborted_by_preflight`, `harness_ok=false`,
    reason `preflight-at-submit`). A launch reservation that protects the DAEMON, not a worktree
    — `fcntl.flock` on `<system temp dir>/wicked-test-feature-live-<uid>/<sha256(daemon
    origin)>.launch.lock`: a per-user directory OUTSIDE every worktree (never under the operator's
    `~/.wicked-crew`), created 0700 and refused unless it is this user's and not writable by
    anyone else, the file named by the sha256 of `scheme://host:port` of STUDIO_URL so every
    worktree aiming at `:7701` contends for ONE lock and different daemons never contend (codex
    round 7: a lock under each worktree's evidence dir let two worktrees both clear their
    preflights on an idle daemon and both submit); the lock is created `O_NOFOLLOW` on the
    DESCRIPTOR of that directory, which is reached by the same trusted descriptor walk as every
    artifact (`open_artifact_root`: no pathname open on the way) — and is held from that
    pre-submit preflight until the launched run's intake gate has been decided; a second harness
    process, in any worktree, fails fast with a named message instead of racing the preflight. The
    (scrubbed) lock path, scope and origin are recorded in the report (`launch_lock`).
  * Exactly one governed run in flight at a time; the next launch waits for a terminal/gated state.
  * GATE IDENTITY before any click (`gate_state_conflict`). A POST to `/runs/:id/gate` carries no
    ord — it decides whatever the daemon's CURRENT gate is — so the card being clicked must BE that
    gate. Before EVERY click (intake, later gates, parent and siblings) `current_gate` reads the
    daemon's current gate read-only and FRESH: `GET /runs/:id/gate` (the cached open-gate record
    `GateInfo {runId, ord, prompt}`, wicked-crew-api-types 0.25.0); on ANY other answer (404,
    non-2xx, transport failure, malformed 2xx) the ONLY fallback is a FRESH `GET /runs/:id/events`
    and the current UNRESOLVED gate in it — the LATEST `awaitingHuman` with no later
    `gateDecided`/`resumed` for its ord and no terminal event after it — its ord and its verbatim
    prompt, NEVER an older event's (an unreadable latest prompt is unreadable, full stop) and
    NEVER events fetched before the card rendered (codex round 7: those approved a stale ord-1
    card against a 503 / 404 / malformed daemon whose current gate was an ord-4 delivery). When the
    fresh fetch fails too, or the log establishes no gate (none, already decided, ambiguous, run
    over), the gate state is UNKNOWN. The card must match the current gate: same run
    (`data-run-id`), same ord (the card's `before unit #N` line, when rendered; and the ord the
    harness read from the events), same headline (`cleanPrompt(current.prompt)` == the card's
    `steering-prompt` text). ANY conflict — a card for ord 1 while the daemon's current gate is
    ord 4, a headline that is not the current prompt's, a current prompt the daemon does not serve
    — means NO click at all: the decision is recorded as `reject-by-abstention` with BOTH texts
    and both ords (`gates[].prompt` vs `prompt_card`, `current_ord` vs `card_ord`), the finding is
    `gate-state-conflict` — or `gate-state-unknown` when no current gate could be established —
    `harness_ok=false`, and the run is left exactly as it is (a rejected legitimate gate would end
    the run; an approved stale card could deliver).
  * ONE gate policy for EVERY gate, the intake gate and every sibling's gates included
    (`gate_decision`) — an ALLOW-LIST that fails CLOSED, applied to the COMPLETE CURRENT PROMPT
    read from the daemon (`current_gate`), never to the card's text: SteeringGate renders
    `cleanPrompt()` (the text before the first `[`, the bracketed remainder folded into a
    disclosure), so the verbatim prompt the daemon serves is what `gate_decision` judges; the card's
    headline is recorded alongside (`prompt_card`, `card_consistent`). A gate is
    approved ONLY when ALL of:
    (a) the prompt is an allow-listed SHAPE — crew's pre-execution unit gate (`Approve unit N
    before it runs: …`) or a plan approval (`Approve [the] [proposed] [test] plan…`); (b) the gated
    unit's `stage`/`gate` (GET /runs/:id) is KNOWN and not a delivery kind (deliver / release /
    publish / merge); (c) NO delivery verb or command appears ANYWHERE in the complete prompt
    (`DELIVERY_VERB_RE`: deliver(y), push, git push, push the branch, gh pr create, open a PR /
    pull request, merge, publish, npm/cargo publish, release, create a release) — `Approve unit 4
    before it runs: Finalize the test [gh pr create --fill]` is rejected on the bracketed command
    the card never shows. EVERYTHING ELSE
    is REJECTED with a named reason: SteeringGate's `Prompt
    unavailable (daemon restarted)…` fallback or any other shape (`unknown-prompt-shape`), an
    unknown unit kind — lookup failed, `stage`/`gate` null (`unknown-gate-kind`), a delivery verb
    (`delivery-verb`), a delivery kind. (A full prompt the daemon does not serve, or a card whose
    headline is not the current prompt's, never reaches the policy — it is a gate-state conflict,
    above, and nothing is clicked.) A plan whose body lists `/runs/:id/deliver` among the
    routes to test is therefore rejected too — a rejected legitimate plan is a recorded finding;
    an approved delivery is not recoverable. Every decision is clicked on
    the UI card and its WIRE is verified: the response must be a POST to exactly
    `/api/v1/runs/<this run id>/gate`, its body's `approve` must equal the decision taken and its
    status must be 2xx — anything else is a finding and `harness_ok=false` (`gate-wire-mismatch`;
    a SIBLING gate's wire failure is `sibling-gate-wire-mismatch`, judged the same way).
    Every decision is recorded in the scenario's `measured.gates[]` (or the sibling's `gates[]`)
    with the complete prompt (excerpt), its source, the card's headline, the unit's stage/gate,
    the reason and the wire check. Sibling gates are decided on `/runs/<sibling id>` — never the API.
  * Never registers/modifies/deletes repos or projects; read-only GETs for every assertion.
  * Never kills a wedged run (no events for 10 min while executing) — it is reported.
  * Evidence fetches that FAIL (non-2xx, transport error) are typed misses recorded in
    `measured.fetch_errors[]` + a finding, distinct from evidence that is ABSENT (204 / null output,
    `missing_outputs`); a scenario with any fetch error cannot be `pass`.

VERDICTS are split (`derive_result`): `harness_ok` says the harness did its job (launch → gate on
the UI → decision → terminal; no wedge, no blocker); `result` is the FEATURE contract —
`"pass"` REQUIRES ≥ 1 attributable sibling run, EVERY attributable sibling terminal and EVERY one
carrying its own acceptance verdict (`measured.sibling_verdicts`), and, for "New test", a
registered campaign; otherwise `"fail"` with `fail_reasons[]` naming the sibling. Siblings are
attributed by a daemon-visible relationship (`attribute_siblings`), never by "a run appeared" and
never by the brief text (identical briefs are intentional); attributable siblings are followed to a
terminal state (their gates decided on the UI on the way) before their acceptance is sampled — and
the attributable set is REDISCOVERED on every poll of `follow_siblings` (runs + campaigns re-listed,
`attribute_siblings` re-run, newly attributable runs added and followed), finishing only when the
set has been stable for two polls AND every member is terminal; `SIBLING_FOLLOW_MAX_S` elapsing
first is recorded (`timed_out`) and the scenario cannot `pass`.
EVERY artifact — report.json, the captured plans, the screenshots — lands through ONE writer
(`write_artifact`) that never resolves a pathname under `e2e/artifacts`: the repo root (`ROOT`,
already resolved) is opened ONCE as the trusted descriptor (`open_anchor`, `O_DIRECTORY`), then
EVERY component of the artifacts directory — `e2e`, `artifacts`, `test-feature-live` — is opened
RELATIVE to the previous descriptor with `os.open(name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
dir_fd=parent_fd)` (`open_dir_nofollow`; a missing component is created with `os.mkdir(name,
dir_fd=parent_fd)` and then re-opened the same no-follow way), so a symlink swapped in for ANY
ancestor — `e2e/artifacts -> /elsewhere` planted after startup validated it — is refused by the
kernel (ELOOP) at exactly that step, never followed (`walk_dir` → `open_artifact_root`; the walk
is repeated on every write, so there is no window between a validation and a use). On the final
trusted descriptor the data is written to a unique temp name created `O_WRONLY | O_CREAT | O_EXCL
| O_NOFOLLOW` via `dir_fd=`, `fsync`ed and `os.rename`d onto the final name with
`src_dir_fd=dst_dir_fd=` that descriptor — a link planted at the final name after the check is
replaced by the rename, never written through. The launch lock is created on the same descriptor
(`LaunchLock`). Screenshots are taken as bytes (`page.screenshot()` without `path`) and written
the same way — Playwright never writes a path of its own. report.json is written after every
scenario and on every exit path (an abort is recorded in `aborted`). The artifacts root is walked
and created this way BEFORE anything else happens (`ensure_artifact_root`, the first thing
`main()` does) — a symlinked `e2e/artifacts` refuses startup instead of planting a directory
outside the repository.

Usage: python3 e2e/test_feature_live.py            (playwright + chromium must be installed)
Env:   STUDIO_URL (default http://localhost:7701), TARGET_REPO (default wicked-studio),
       ONLY=LT-1,LT-2 (subset), PREFLIGHT_MAX_MIN (default 20), GATE_TIMEOUT_MIN (default 25),
       RUN_TIMEOUT_MIN (default 60), SIBLING_GRACE_S (default 120), SIBLING_FOLLOW_MAX_S
       (default 900), SWAP_MAX_PCT (default 85 — a contract deviation when moved; requires
       SWAP_MAX_PCT_ACK=contract-deviation), FANOUT_PATTERN (an EXTRA regex over `ps` command
       lines that also blocks the preflight — the token rules in `FANOUT_RULES` always apply),
       TEST_PROBLEM_PREFIX (default "" — a marker a sibling's `problem` must carry, together with
       our run id or campaign label, to be attributed).
Prints a JSON report to stdout; artifacts land in e2e/artifacts/test-feature-live/.

Offline self-test (no daemon, no Playwright, no network; studio's CI runs no Python step, so run
it by hand before pushing a harness change):
    python3 -m unittest e2e/test_feature_live_selftest.py -v
    python3 -m py_compile e2e/test_feature_live.py
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import secrets
import shlex
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "e2e" / "artifacts" / "test-feature-live"
BASE = os.environ.get("STUDIO_URL", "http://localhost:7701").rstrip("/")
API = f"{BASE}/api/v1"


def daemon_origin(base: str = BASE) -> str:
    """The daemon the reservation protects, as an origin — `scheme://host:port` (lower-cased, the
    default port filled in, path/query dropped) — so `http://localhost:7701` and
    `http://localhost:7701/` are ONE daemon. (Distinct spellings of one host — `localhost` vs
    `127.0.0.1` — stay distinct; set STUDIO_URL the same way in every worktree.)"""
    u = urllib.parse.urlsplit(base if "://" in base else f"http://{base}")
    scheme = (u.scheme or "http").lower()
    port = u.port or {"https": 443}.get(scheme, 80)
    return f"{scheme}://{(u.hostname or '').lower()}:{port}"


def origin_key(base: str = BASE) -> str:
    """sha256 of the daemon origin — the reservation's file name, the same in every worktree."""
    return hashlib.sha256(daemon_origin(base).encode()).hexdigest()


# The launch reservation (`LaunchLock`) protects the DAEMON, not a worktree: two harnesses in two
# worktrees launching against the same `:7701` must contend for ONE lock (codex round 7 — a lock
# under each worktree's `e2e/artifacts/…` let both clear their preflights on an idle daemon and
# both submit). So the lock lives OUTSIDE any worktree, in a per-user directory under the system
# temp dir — `wicked-test-feature-live-<uid>`, created 0700 (never under the operator's
# `~/.wicked-crew`) — and is named by the sha256 of the daemon origin (`origin_key`).
LOCK_DIR = Path(tempfile.gettempdir()) / f"wicked-test-feature-live-{os.getuid()}"


def lock_path_for(base: str = BASE, lock_dir: Path | None = None) -> Path:
    return (lock_dir or LOCK_DIR) / f"{origin_key(base)}.launch.lock"


LOCK_PATH = lock_path_for()  # the launch reservation for THIS daemon (fcntl.flock), shared across worktrees
TARGET_REPO = os.environ.get("TARGET_REPO", "wicked-studio")
PREFLIGHT_MAX_S = int(float(os.environ.get("PREFLIGHT_MAX_MIN", "20")) * 60)
GATE_TIMEOUT_S = int(float(os.environ.get("GATE_TIMEOUT_MIN", "25")) * 60)
RUN_TIMEOUT_S = int(float(os.environ.get("RUN_TIMEOUT_MIN", "60")) * 60)
SIBLING_GRACE_S = int(os.environ.get("SIBLING_GRACE_S", "120"))
SIBLING_FOLLOW_MAX_S = int(os.environ.get("SIBLING_FOLLOW_MAX_S", "900"))
TEST_PROBLEM_PREFIX = os.environ.get("TEST_PROBLEM_PREFIX", "")
# The contract (brief-test-feature-live.md): "the harness must refuse to run if … swap > 85%" —
# AMENDED by its author (the coordinator) on 2026-09-09, after codex rounds 2-4 of PR #215: "the 85%
# default stands; an EXPLICIT operator override (SWAP_MAX_PCT together with
# SWAP_MAX_PCT_ACK=contract-deviation) is permitted and MUST be recorded in the report as a contract
# deviation (threshold, reading, acknowledgement)". The three recorded launches (d293f4d7…,
# f8bc2bad…, d12adb6c…) ran under an authorized 95 % override at 93 % swap because this host idles
# above 85 %; the amendment accepts them as deviation evidence. `preflight_policy` implements exactly
# that: 85 by default, the override honoured only with the acknowledgement, the deviation recorded.
SWAP_MAX_PCT_CONTRACT = 85
# Moving the swap gate is honoured ONLY with this acknowledgement set — the deviation is meant to be
# impossible to miss (logged at every preflight, stamped on every reading, a top-level report
# object), not impossible to do: compliant live evidence is unobtainable on a host idling at ~93 %.
SWAP_ACK_VAR = "SWAP_MAX_PCT_ACK"
SWAP_ACK_VALUE = "contract-deviation"
LOAD1_MAX = 20
# Preflight gate (4): heavy worker / build fan-out on the host — a governed council or a build
# outside the daemon's run list overlapping a launch is exactly the capacity spike the serialization
# rule exists to prevent. Decided on the TOKENS of each `ps` command line (`fanout_rule`), never on
# a positional regex: `cargo +stable build`, `claude --model opus --print task` and
# `wicked-crew serve --db /tmp/x --port 62432` (codex round 4's three probes) all block; the dogfood
# daemon itself (`wicked-crew serve`, no port or `--port 7701`) and an unrelated `node` never do.
# `FANOUT_PATTERN` (a regex) only ADDS matches. Recorded in `preflight_policy.fanout_rules`.
FANOUT_RULES = (
    "cargo: build|test|clippy|run among its tokens (a `+toolchain` token is just another token); go: build|test; "
    "claude: -p|--print anywhere; codex: exec anywhere; "
    "npm|pnpm|yarn|bun: build|test|typecheck|lint|check ANYWHERE among the tokens, with or without `run` "
    "(test:*/build:* scripts included — `pnpm build`, `yarn build`, `bun test`); "
    "direct build/test executables by basename, always: vite|tsc|esbuild|webpack|rollup|vitest|jest|playwright|rustc|make|ninja|gradle|mvn|pytest|py.test "
    "(`node …/vite/bin/vite.js build` included — a .js/.mjs/.cjs extension is stripped; `pytest -n 8`); "
    "python* (python, python3, python3.12 …): `-m pytest` or `-m unittest` among its tokens, with or without `-n` "
    "(`python3 -m pytest -n 8`; `python3 -m json.tool` and `python3 e2e/test_feature_live.py` never); "
    "wicked-crew (also via `node …/wicked-crew`): `serve` with a --port VALUE (`--port N` or `--port=N`, any position) other than 7701; "
    "the program is basename(argv[0]) or, under a runtime launcher (node, python3, sh, …), the script or -m module it runs"
)
# argv[0]s that only launch the real program — under one of them the program is the first token whose
# basename names a program the rules know (`node …/.bin/codex exec`, `nice -n 10 cargo clippy`).
RUNTIME_LAUNCHERS = {"node", "nodejs", "bun", "deno", "npx", "python", "python3", "sh", "bash", "zsh", "env",
                     "nice", "caffeinate", "time", "arch"}
# Any `python*` is a launcher too — `python3.12 -m pytest` must not hide behind a versioned basename.
_PYTHON_LAUNCHER_RE = re.compile(r"python\d*(?:\.\d+)*")
# Codex round 5: `pnpm build`, `yarn build` and `node …/vite/bin/vite.js build` all cleared the round-4
# fence, which required a literal `run` token before a build script and knew no direct build executable.
PACKAGE_RUNNERS = {"npm", "pnpm", "yarn", "bun"}
BUILD_SCRIPT_TOKENS = {"build", "test", "typecheck", "lint", "check"}
# Direct build/test executables — heavy by construction (a bundler, a compiler, a test runner, a build
# system), matched by basename after the launcher look-through, whatever their arguments. Codex round 6:
# `pytest -n 8` and `python3 -m pytest -n 8` both cleared the round-5 fence (no pytest rule at all).
BUILD_PROGRAMS = {"vite", "tsc", "esbuild", "webpack", "rollup", "vitest", "jest", "playwright", "rustc", "make", "ninja",
                  "gradle", "mvn", "pytest", "py.test"}
# Module-launched test runners: `python* -m pytest …` / `python* -m unittest …` — the `-m` form names no
# executable, so the module token right after `-m` is the program (`json.tool`, `venv`, `http.server` are not).
PY_TEST_MODULES = {"pytest", "unittest"}
KNOWN_PROGRAMS = {"cargo", "go", "claude", "codex", "wicked-crew"} | PACKAGE_RUNNERS | BUILD_PROGRAMS | PY_TEST_MODULES
_SCRIPT_EXT_RE = re.compile(r"\.(?:m?js|cjs|exe)$")
DOGFOOD_PORT = "7701"
WEDGE_S = 10 * 60
ACTIVE = {"running", "executing", "awaiting_human", "planning", "pending", "starting"}
TERMINAL = {"completed", "failed", "cancelled", "canceled", "rejected"}
# Gate KINDS that authorize delivery — decided from the unit's `stage`/`gate`, never from a keyword
# somewhere in a plan body.
DELIVER_KINDS = {"deliver", "release", "publish", "merge"}

# ONE sentence by construction: no `. ` / `! ` / `? ` / `;` / newline anywhere (core#393 splits on
# those), naming the four surfaces the brief asked the plan to cover. Identical for every scenario
# so LT-3 diffs like against like.
INSTRUCTION = (
    "Survey wicked-studio at its current main and propose a test plan covering its live /ws "
    "CoreEvent fold (awaitingHuman, unitPlanned, sessionCompleted frames), the /api/v1 routes it "
    "calls (runs, campaigns, testing/recon, projects, repos), its CLI entry points, and its UI "
    "pages (/testing/campaigns, /runs/:id, /steering, the home deck), naming the real source files "
    "behind each scenario and classifying each as a deterministic tool check or a governed agent run"
)
assert not re.search(r"[.!?]\s|;|\n", INSTRUCTION), "INSTRUCTION must be one sentence (core#393)"

# Every testid this harness touches — verified against testid-inventory.json before anything runs.
TESTIDS = [
    "campaigns-page", "campaigns-probing", "testing-recon-open", "testing-campaign-open",
    "testing-launch-panel", "testing-launch-instructions", "testing-launch-repo-search",
    "testing-launch-repo-option", "testing-launch-chip", "testing-launch-submit",
    "testing-launch-waiting", "testing-launch-resolved", "testing-launch-error",
    "steering-gate", "steering-prompt", "steering-approve", "steering-reject",
    "campaign-card", "campaigns-empty", "campaign-scoreboard", "campaign-notfound", "run-header",
]

REPORT: dict = {
    "harness": "e2e/test_feature_live.py",
    "target": {"daemon": BASE, "repo": TARGET_REPO},
    "instruction": INSTRUCTION,
    "preflights": [],
    "scenarios": {},
    "findings": [],
    "blockers": [],
}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


# A worker listing its own toolchain: `- ~/.pi/agent/skills/x/SKILL.md`, `- ~/.claude/skills/y`…
# Environment-specific, not evidence — runs of them collapse to one elision marker.
TOOLCHAIN_LINE = re.compile(r"^\s*(?:[-*]\s*)?`?~/\.[A-Za-z0-9_-]+/\S*`?\s*$")


def scrub(text: str) -> str:
    """Worker output and daemon DTOs carry absolute paths under the operator's home — the
    committed artifacts must not (privacy): fold them onto `~`, then elide any run of lines that
    is nothing but a home-relative toolchain path (a seat enumerating its installed skills)."""
    folded = text.replace(os.path.expanduser("~"), "~")
    out: list[str] = []
    run = 0
    for line in folded.split("\n"):
        if TOOLCHAIN_LINE.match(line):
            run += 1
            continue
        if run:
            out.append(f"- … ({run} local toolchain path{'s' if run != 1 else ''} elided)")
            run = 0
        out.append(line)
    if run:
        out.append(f"- … ({run} local toolchain path{'s' if run != 1 else ''} elided)")
    return "\n".join(out)


def finding(text: str) -> None:
    REPORT["findings"].append(text)
    log(f"FINDING: {text}")


def blocker(text: str) -> None:
    REPORT["blockers"].append(text)
    log(f"BLOCKER: {text}")


# ── HTTP (read-only except where the UI drives the write) ─────────────────────────────────────


def http_json(method: str, url: str, timeout: float = 30) -> tuple[int, object]:
    """(status, body). A transport failure (refused, DNS, timeout, reset) is status 0 with the error
    named — it must stay distinguishable from a daemon answer."""
    req = urllib.request.Request(url, method=method, headers={"accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw.decode("utf-8", "replace")}
    except (urllib.error.URLError, OSError, ValueError) as e:  # ValueError: malformed JSON on a 2xx
        return 0, {"error": f"{type(e).__name__}: {e}"}


class FetchMiss(dict):
    """A TYPED evidence-fetch failure: `{kind: "fetch-error", endpoint, status, error}`. Returned
    (not swallowed) by the evidence helpers so a caller can tell "the daemon has no output for this
    unit" (None) from "the daemon did not answer" — and it serializes as plain JSON."""

    def __init__(self, endpoint: str, status: int, error: str) -> None:
        super().__init__(kind="fetch-error", endpoint=endpoint, status=status, error=error[:300])


class FetchError(RuntimeError):
    """`get()` failed — carries the same typed fields as `FetchMiss` (`.miss`)."""

    def __init__(self, miss: FetchMiss) -> None:
        super().__init__(f"GET {miss['endpoint']} → {miss['status']}: {miss['error']}")
        self.miss = miss


# Every fetch error lands in the CURRENT sink — the running scenario's `measured.fetch_errors[]`
# while a scenario is live, the report's top-level `fetch_errors[]` otherwise — plus one finding
# per (endpoint, status) so a daemon outage during a 20-minute preflight poll is one line, not 20.
_FETCH_SINK: list | None = None


def set_fetch_sink(sink: list | None) -> None:
    global _FETCH_SINK
    _FETCH_SINK = sink


def record_fetch_error(endpoint: str, status: int, error: object) -> FetchMiss:
    miss = FetchMiss(endpoint, status, error if isinstance(error, str) else json.dumps(error, default=str))
    sink = REPORT.setdefault("fetch_errors", []) if _FETCH_SINK is None else _FETCH_SINK
    if not any(e.get("endpoint") == endpoint and e.get("status") == status for e in sink):
        finding(f"evidence fetch failed: GET {endpoint} → {status} ({miss['error'][:120]}) — recorded as a fetch error, not as absent evidence")
    sink.append(miss)
    return miss


def _fetch(path: str) -> tuple[int, object]:
    return http_json("GET", f"{API}{path}")


def get(path: str) -> object:
    status, body = _fetch(path)
    if not 200 <= status < 300:
        raise FetchError(record_fetch_error(path, status, body))
    return body


def enc(run_id: str) -> str:
    # Campaign-shaped ids carry `:` — always encode a run id into a path.
    return urllib.parse.quote(run_id, safe="")


def _typed_list(path: str, key: str) -> list[dict]:
    """A 2xx whose body is not `{key: [...]}` is a TYPED miss (recorded, then raised) — never an
    `AttributeError`/`TypeError` on `None` (204) or on an unexpected shape, and never an empty list
    silently standing in for "the daemon listed nothing"."""
    body = get(path)
    if not isinstance(body, dict) or not isinstance(body.get(key), list):
        raise FetchError(record_fetch_error(path, 200, f"no `{key}` list in the answer: {json.dumps(body, default=str)[:120]}"))
    return body[key]


def list_runs() -> list[dict]:
    return _typed_list("/runs", "runs")


def list_campaigns() -> list[dict]:
    return _typed_list("/campaigns", "campaigns")


def run_detail(run_id: str) -> dict:
    """The run DTO; a non-2xx / transport failure raises `FetchError` AFTER recording the typed miss."""
    body = get(f"/runs/{enc(run_id)}")
    if not isinstance(body, dict) or not isinstance(body.get("run"), dict):
        raise FetchError(record_fetch_error(f"/runs/{enc(run_id)}", 200, f"no `run` object in the answer: {json.dumps(body)[:120]}"))
    return body["run"]


def run_events(run_id: str) -> list[dict]:
    """The run's events — a bare list or `{events: [...]}` (studio's client types the latter). Any
    other 2xx shape (a 204 decoded as None, a dict without `events`) is a typed miss recorded and
    raised like `run_detail`'s, never an `AttributeError` that crashes the harness unrecorded."""
    path = f"/runs/{enc(run_id)}/events"
    body = get(path)
    if isinstance(body, list):
        return body
    if isinstance(body, dict) and isinstance(body.get("events"), list):
        return body["events"]
    raise FetchError(record_fetch_error(path, 200, f"no events list in the answer: {json.dumps(body, default=str)[:120]}"))


def unit_output(run_id: str, ord_: int) -> str | None | FetchMiss:
    """The unit's captured output: a string; None when the daemon answers 2xx with no output (204,
    `output` absent / null / "") — evidence that is ABSENT; a `FetchMiss` when the fetch FAILED or
    the 2xx body is not the contract's shape — a non-dict body, or an `output` that is present but
    not a string (a number, an object: schema drift or corruption, recorded as
    `unexpected output type: <type>` like `run_events`/`acceptance` record theirs, never folded
    into "absent")."""
    path = f"/runs/{enc(run_id)}/units/{ord_}/output"
    status, body = _fetch(path)
    if not 200 <= status < 300:
        return record_fetch_error(path, status, body)
    if body is None:
        return None
    if not isinstance(body, dict):
        return record_fetch_error(path, status, f"unexpected body shape: {json.dumps(body)[:120]}")
    out = body.get("output")
    if out is None or out == "":
        return None
    if not isinstance(out, str):
        return record_fetch_error(path, status, f"unexpected output type: {type(out).__name__} ({json.dumps(out, default=str)[:80]})")
    return out


def acceptance(run_id: str) -> dict | None | FetchMiss:
    """The acceptance record; None for a 2xx with no body; `FetchMiss` when the fetch FAILED."""
    path = f"/runs/{enc(run_id)}/acceptance"
    status, body = _fetch(path)
    if not 200 <= status < 300:
        return record_fetch_error(path, status, body)
    if body is None:
        return None
    if not isinstance(body, dict):
        return record_fetch_error(path, status, f"unexpected body shape: {json.dumps(body)[:120]}")
    return body


def acceptance_verdict(run_id: str) -> str | None | FetchMiss:
    """The run's acceptance verdict string, None when there is none, or the typed miss."""
    a = acceptance(run_id)
    if isinstance(a, FetchMiss) or a is None:
        return a
    v = (a.get("acceptance") or {}).get("verdict") if isinstance(a.get("acceptance"), dict) else None
    return v if isinstance(v, str) and v else None


# ── Preflight (the serialization + capacity gate) ─────────────────────────────────────────────


def _probe(argv: list[str]) -> str:
    """Run a preflight probe; a missing command is a failed preflight with a named cause, not a
    traceback."""
    try:
        return subprocess.run(argv, capture_output=True, text=True, check=True).stdout
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        raise SystemExit(f"preflight probe `{' '.join(argv)}` unavailable ({e}) — the capacity gate "
                         "reads macOS vm_stat/sysctl; run this harness on the macOS dogfood host") from e


def _field(pattern: str, text: str, what: str) -> str:
    m = re.search(pattern, text)
    if not m:
        raise SystemExit(f"preflight could not read {what}: /{pattern}/ did not match:\n{text[:300]}")
    return m.group(1)


def fanout_pattern(env: Mapping[str, str] | None = None) -> re.Pattern | None:
    """The OPTIONAL extra fan-out regex: `FANOUT_PATTERN` from the environment when set (an invalid
    regex is a named exit, never a silently disabled gate), else None. It ADDS matches to the token
    rules (`fanout_rule`) — an operator can widen the gate, never narrow or replace it."""
    env = os.environ if env is None else env
    raw = (env.get("FANOUT_PATTERN") or "").strip()
    if not raw:
        return None
    try:
        return re.compile(raw)
    except re.error as e:
        raise SystemExit(f"FANOUT_PATTERN={raw!r} is not a valid regex ({e})") from None


FANOUT_RE = fanout_pattern()
PS_ARGV = ["ps", "-axo", "pid=,command="]


def _tokens(cmd: str) -> list[str]:
    """The command line's argv: `shlex.split` (quotes respected), plain whitespace when the line is
    not shell-parsable (an unbalanced quote in a worker's prompt argument)."""
    try:
        return shlex.split(cmd)
    except ValueError:
        return cmd.split()


def _prog_name(token: str) -> str:
    """A token as a program name: its basename with a `.js`/`.mjs`/`.cjs`/`.exe` extension stripped
    (`…/vite/bin/vite.js` → `vite`, `…/.bin/codex` → `codex`)."""
    return _SCRIPT_EXT_RE.sub("", os.path.basename(token))


def _is_launcher(name: str) -> bool:
    """argv[0] only launches the real program: one of `RUNTIME_LAUNCHERS`, or any `python*`
    (`python`, `python3`, `python3.12`) — `python3.12 -m pytest` is a pytest run."""
    return name in RUNTIME_LAUNCHERS or _PYTHON_LAUNCHER_RE.fullmatch(name) is not None


def _program(tokens: list[str]) -> tuple[str, int]:
    """(name of the program, index of its token): argv[0] — or, when argv[0] is only a runtime
    launcher (`node …/.bin/codex exec`, `node …/vite/bin/vite.js build`, `env FOO=1 cargo build`,
    `nice -n 10 cargo clippy`, `python3 -m pytest`), the first later token whose name (`_prog_name`)
    is a program the rules know (`KNOWN_PROGRAMS` — the `-m` module token included); a launcher
    running something else (`node /x/app.js --port 62432`, `python3 e2e/test_feature_live.py`,
    `python3 -m json.tool`, an idle `node`) stays the launcher, which no rule names — except `bun`,
    a launcher that is also a package runner (`bun test`, `bun run build`)."""
    if not tokens:
        return "", 0
    name = _prog_name(tokens[0])
    if _is_launcher(name):
        for j in range(1, len(tokens)):
            if _prog_name(tokens[j]) in KNOWN_PROGRAMS:
                return _prog_name(tokens[j]), j
    return name, 0


def _port_value(tokens: list[str]) -> str | None:
    """The VALUE of a `--port N` / `--port=N` token anywhere in the argv, else None."""
    for k, t in enumerate(tokens):
        if t == "--port" and k + 1 < len(tokens):
            return tokens[k + 1]
        if t.startswith("--port="):
            return t[len("--port="):]
    return None


def fanout_rule(cmd: str) -> str | None:
    """The fan-out rule this `ps` command line trips, NAMED — or None. Decided on TOKENS (see
    `FANOUT_RULES`), so argument order never matters: `cargo +stable build`,
    `claude --model opus --print task` and `wicked-crew serve --db /tmp/x --port 62432` (codex
    round 4's probes, none of which the positional regex caught), `pnpm build`, `yarn build`,
    `bun test` and `node …/vite/bin/vite.js build` (codex round 5's, which the `run`-literal fence
    let through), `pytest -n 8` and `python3 -m pytest -n 8` (codex round 6's, which knew no pytest
    at all) all trip a rule; `wicked-crew serve` without a port or on 7701 (the dogfood
    daemon), the interactive `Claude` app, `npm run dev`, `npm view x`, `python3 -m json.tool`, an
    idle `node` REPL and an unrelated `node` do not."""
    tokens = _tokens(cmd)
    if not tokens:
        return None
    prog, i = _program(tokens)
    args = tokens[i + 1:]
    argset = set(args)
    if prog == "cargo" and argset & {"build", "test", "clippy", "run"}:
        return "cargo build|test|clippy|run"
    if prog == "go" and argset & {"build", "test"}:
        return "go build|test"
    if prog == "claude" and argset & {"-p", "--print"}:
        return "claude -p|--print"
    if prog == "codex" and "exec" in argset:
        return "codex exec"
    if prog in PY_TEST_MODULES and i >= 1 and tokens[i - 1] == "-m":
        # `python* -m pytest …` / `python* -m unittest …`: the module right after `-m` is the runner.
        return f"python -m {prog} (module-launched test runner)"
    if prog in BUILD_PROGRAMS:
        return f"{prog} (direct build/test executable)"
    if prog in PACKAGE_RUNNERS:
        # build|test|typecheck|lint|check ANYWHERE — `pnpm build` (no `run`), `npm run build:with-studio`,
        # `bun test`, `yarn lint`; `npm view x` / `npm install` / `npm run dev` name no such script.
        scripts = {a.split(":", 1)[0] for a in args}
        if scripts & BUILD_SCRIPT_TOKENS:
            return f"{prog} build|test|typecheck|lint|check"
    if "wicked-crew" in {os.path.basename(t) for t in tokens} and "serve" in argset:
        port = _port_value(tokens)
        if port is not None and port != DOGFOOD_PORT:
            return f"second wicked-crew serve --port {port}"
    return None


def fanout_processes(table: str | None = None, pattern: re.Pattern | None = None) -> list[str]:
    """Every process on the host whose command line trips a fan-out rule (`fanout_rule`, on tokens)
    or the optional extra regex (`FANOUT_PATTERN`), as `"<pid> <cmd>"` strings — [] means the gate
    is clear. `table` is the `ps -axo pid=,command=` output (injected by the self-test); when None
    it is read live, and a `ps` that cannot be run or fails is returned as a single `ERR …` entry so
    the gate BLOCKS (fail closed) rather than passing on no information."""
    rx = FANOUT_RE if pattern is None else pattern
    if table is None:
        try:
            table = subprocess.run(PS_ARGV, capture_output=True, text=True, check=True).stdout
        except (FileNotFoundError, subprocess.CalledProcessError, OSError) as e:
            return [f"ERR `{' '.join(PS_ARGV)}` failed ({type(e).__name__}: {e}) — the fan-out gate cannot be read; failing closed"]
    hits: list[str] = []
    for line in table.splitlines():
        line = line.strip()
        if not line:
            continue
        pid, _, cmd = line.partition(" ")
        cmd = cmd.strip()
        if fanout_rule(cmd) or (rx is not None and rx.search(cmd)):
            hits.append(f"{pid} {cmd[:160]}")
    return hits


def readings() -> dict:
    if sys.platform != "darwin":
        raise SystemExit(f"the capacity gate is macOS-only (vm_stat / sysctl vm.*); this is {sys.platform} — "
                         "run the harness on the dogfood host, or port readings() before running here")
    out = _probe(["vm_stat"])
    pg = int(_field(r"page size of (\d+)", out, "the vm_stat page size"))

    def pages(k: str) -> int:
        m = re.search(rf"{k}:\s+(\d+)", out)
        return int(m.group(1)) * pg if m else 0

    load = float(_probe(["sysctl", "-n", "vm.loadavg"]).strip("{} \n").split()[0])
    sw = _probe(["sysctl", "-n", "vm.swapusage"])
    total = float(_field(r"total = ([\d.]+)M", sw, "swap total"))
    used = float(_field(r"used = ([\d.]+)M", sw, "swap used"))
    try:
        active = [r["session"]["id"] for r in list_runs() if r["session"]["status"] in ACTIVE]
    except Exception as e:  # the daemon being unreachable is itself a failed preflight
        active = [f"ERR {e}"]
    return {
        "ts": time.strftime("%H:%M:%S"),
        "free_mb": pages("Pages free") // 2**20,
        # macOS keeps "free" small on purpose — recorded for context, NOT used by the gate.
        "available_mb": (pages("Pages free") + pages("Pages inactive") + pages("Pages speculative")
                         + pages("Pages purgeable")) // 2**20,
        "load1": load,
        "swap_pct": round(100 * used / total, 1) if total else 0.0,
        "active_runs": active,
        # Gate (4): heavy worker / build processes on the host — `[]` is the only clear reading.
        "fanout": fanout_processes(),
    }


def preflight_policy(env: Mapping[str, str] | None = None) -> dict:
    """The capacity thresholds in force for this invocation. The swap gate is the contract's 85 %
    unless an EXPLICIT `SWAP_MAX_PCT` env var moves it — which is honoured ONLY when
    `SWAP_MAX_PCT_ACK=contract-deviation` is ALSO set (otherwise the harness exits naming both
    vars). A moved gate is a recorded, acknowledged contract deviation (`contract_deviation`
    {var, contract, effective, ack}) — every launch cleared under it is evidence gathered outside
    the brief's terms, and the report must make that impossible to miss."""
    env = os.environ if env is None else env
    raw = (env.get("SWAP_MAX_PCT") or "").strip()
    ack = (env.get(SWAP_ACK_VAR) or "").strip()
    swap_max: float = SWAP_MAX_PCT_CONTRACT
    if raw:
        try:
            swap_max = float(raw)
        except ValueError:
            raise SystemExit(f"SWAP_MAX_PCT={raw!r} is not a number") from None
        if not 0 < swap_max <= 100:
            raise SystemExit(f"SWAP_MAX_PCT={raw!r} must be in (0, 100]")
        if swap_max.is_integer():
            swap_max = int(swap_max)
        if swap_max != SWAP_MAX_PCT_CONTRACT and ack != SWAP_ACK_VALUE:
            raise SystemExit(
                f"SWAP_MAX_PCT={raw} moves the swap gate off the contract's {SWAP_MAX_PCT_CONTRACT}% — a contract "
                f"deviation. It is honoured only when {SWAP_ACK_VAR}={SWAP_ACK_VALUE} is ALSO set "
                f"(got {SWAP_ACK_VAR}={ack!r}); unset SWAP_MAX_PCT or acknowledge the deviation explicitly")
    extra = fanout_pattern(env)
    policy: dict = {
        "swap_max_pct": swap_max,
        "contract_swap_max_pct": SWAP_MAX_PCT_CONTRACT,
        "load1_max": LOAD1_MAX,
        "active_runs_max": 0,
        "fanout_max": 0,
        "fanout_rules": FANOUT_RULES,
        "fanout_pattern": extra.pattern if extra else None,
        "fanout_source": "token rules + FANOUT_PATTERN env (extra matches)" if extra else "token rules",
        "source": "SWAP_MAX_PCT env" if raw else "contract default",
    }
    if swap_max != SWAP_MAX_PCT_CONTRACT:
        policy["contract_deviation"] = {
            "var": "SWAP_MAX_PCT",
            "contract": SWAP_MAX_PCT_CONTRACT,
            "effective": swap_max,
            "ack": f"{SWAP_ACK_VAR}={ack}",
            "note": (f"swap gate is {swap_max}% (SWAP_MAX_PCT), not the brief's {SWAP_MAX_PCT_CONTRACT}% — "
                     "every launch in this report cleared under the relaxed threshold; recorded + acknowledged, not enforced"),
        }
    return policy


def deviation_line(policy: dict) -> str | None:
    d = policy.get("contract_deviation")
    if not d:
        return None
    return f"CONTRACT DEVIATION: {d['var']} {d['contract']}% → {d['effective']}% ({d['ack']}) — {d['note']}"


def preflight_ok(r: dict, policy: dict | None = None) -> list[str]:
    policy = policy or preflight_policy()
    why = []
    if len(r["active_runs"]) > policy["active_runs_max"]:
        why.append(f"active runs: {r['active_runs']}")
    # No free-memory gate: macOS keeps `Pages free` near zero by design (58 MB–2 GB swings were
    # observed at load 9–14) — `free_mb`/`available_mb` are RECORDED for the report, never gated on.
    if r["load1"] >= policy["load1_max"]:
        why.append(f"load1 {r['load1']} >= {policy['load1_max']}")
    if r["swap_pct"] >= policy["swap_max_pct"]:
        why.append(f"swap {r['swap_pct']}% >= {policy['swap_max_pct']}%")
    # Gate (4): the fan-out reading must be an EMPTY list — a match list blocks, and so does a
    # missing / `ERR` reading (fail closed: no information is not "clear").
    fan = r.get("fanout")
    if fan != []:
        why.append(f"fanout: {fan if fan is not None else 'not measured'}")
    return why


def _policy() -> dict:
    policy = REPORT.setdefault("preflight_policy", preflight_policy())
    if policy.get("contract_deviation"):
        REPORT["contract_deviation"] = policy["contract_deviation"]  # top-level, impossible to miss
    return policy


def _judge(entry: dict, policy: dict) -> list[str]:
    """One reading, judged against all four gates, appended to `entry.readings[]` with the
    thresholds it was judged against — a reader of the report must never have to guess whether
    93 % swap "cleared" under 85 or under a relaxed gate."""
    line = deviation_line(policy)
    if line:
        log(line)  # at EVERY preflight, not once at startup
    r = readings()
    why = preflight_ok(r, policy)
    entry["readings"].append({**r, "swap_max_pct": policy["swap_max_pct"], "load1_max": policy["load1_max"],
                              "blocked_by": why})
    return why


def preflight(tag: str) -> bool:
    started = time.time()
    policy = _policy()
    entry = {"scenario": tag, "at": "before-launch", "readings": [], "cleared": False, "waited_s": 0}
    REPORT["preflights"].append(entry)
    while True:
        why = _judge(entry, policy)
        r = entry["readings"][-1]
        if not why:
            entry["cleared"] = True
            entry["waited_s"] = int(time.time() - started)
            log(f"preflight[{tag}] cleared: {r}")
            return True
        if time.time() - started >= PREFLIGHT_MAX_S:
            entry["waited_s"] = int(time.time() - started)
            blocker(f"preflight never cleared for {tag} after {PREFLIGHT_MAX_S // 60} min — last: {r} ({why})")
            return False
        log(f"preflight[{tag}] blocked by {why}; retry in 60s")
        time.sleep(60)


def preflight_at_submit(tag: str) -> list[str]:
    """The SAME four gates, ONE reading, immediately before the submit click — the minutes spent
    starting the browser, picking the repo and taking screenshots are a window another run can
    start in. Returns the blocking reasons ([] = clear); never waits."""
    policy = _policy()
    entry = {"scenario": tag, "at": "submit", "readings": [], "cleared": False, "waited_s": 0}
    REPORT["preflights"].append(entry)
    why = _judge(entry, policy)
    entry["cleared"] = not why
    log(f"preflight[{tag}] at submit: {'clear' if not why else why}")
    return why


class LaunchLock:
    """The launch reservation for ONE DAEMON: `fcntl.flock(LOCK_EX | LOCK_NB)` on
    `LOCK_DIR/<sha256(daemon origin)>.launch.lock` — a per-user directory under the system temp
    dir, outside every worktree — held from the pre-submit preflight until the launched run's
    intake gate has been decided. A second harness process, in THIS worktree or any other, aiming
    at the same daemon fails FAST with a named message instead of clearing its own preflight in the
    same window; harnesses aiming at different daemons never contend (codex round 7: a lock under
    each worktree's evidence dir serialized nothing across worktrees)."""

    def __init__(self, path: Path | None = None, *, base: str | None = None, lock_dir: Path | None = None) -> None:
        self.origin = daemon_origin(base or BASE)
        self.path = path or lock_path_for(base or BASE, lock_dir)
        self._fd: int | None = None

    def describe(self) -> dict:
        """What the report records about the reservation: its (scrubbed) path, scope and origin."""
        return {"path": scrub(str(self.path)), "dir": scrub(str(self.path.parent)), "scope": "daemon-origin",
                "origin": self.origin, "key": self.path.name, "held": self.held, "pid": os.getpid()}

    def acquire(self) -> "LaunchLock":
        # Never write THROUGH a link: the lock's directory is reached by the same trusted descriptor
        # walk as every artifact (`open_artifact_root` — the anchor opened once, then every component
        # opened O_RDONLY|O_DIRECTORY|O_NOFOLLOW RELATIVE to the previous descriptor, created where
        # missing — 0700 here: the per-user lock dir is private) and the lock file itself is created
        # O_NOFOLLOW RELATIVE to that descriptor — a symlink anywhere on the way, whenever planted, is
        # refused by the kernel (ELOOP), never followed. No pathname under the evidence dir is opened
        # or created (codex round 6). The directory reached must be THIS user's and not writable by
        # anyone else: the system temp dir is shared, so a directory of that name planted by another
        # user (or left group/world-writable) is refused, never locked in.
        dfd = open_artifact_root(self.path.parent, create=True, mode=0o700)
        try:
            st = os.fstat(dfd)
            if st.st_uid != os.getuid() or st.st_mode & 0o022:
                raise SystemExit(f"launch reservation directory {self.path.parent} is not a private directory of this user "
                                 f"(uid {st.st_uid}, mode {stat.filemode(st.st_mode)}) — refusing to lock in it")
            flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW
            try:
                fd = os.open(self.path.name, flags, 0o600, dir_fd=dfd)
            except OSError as e:  # ELOOP: a symlink at the lock's name — or any other refusal
                raise SystemExit(f"launch reservation {self.path} is a symlink or could not be opened without following a link "
                                 f"({type(e).__name__}: {e}) — refusing to write through it") from e
        finally:
            os.close(dfd)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, PermissionError) as e:
            os.close(fd)
            raise SystemExit(f"launch reservation {self.path} is held by another harness process — exactly one "
                             f"governed launch at a time; wait for its intake gate to be decided ({e})") from e
        os.write(fd, f"{os.getpid()} {time.strftime('%Y-%m-%dT%H:%M:%S')}\n".encode())
        self._fd = fd
        return self

    @property
    def held(self) -> bool:
        return self._fd is not None

    def release(self) -> None:
        if self._fd is not None:
            fcntl.flock(self._fd, fcntl.LOCK_UN)
            os.close(self._fd)
            self._fd = None


# ── Testid inventory check ────────────────────────────────────────────────────────────────────


def verify_testids() -> None:
    inv = json.loads((ROOT / "testid-inventory.json").read_text())
    known: set[str] = set()
    patterns: list[str] = []
    for sec in ("static", "dynamic", "computed"):
        for e in inv.get(sec, []):
            t = e.get("testId") or e.get("pattern") or e.get("prefix")
            if not t:
                continue
            if "*" in t:
                patterns.append(re.escape(t).replace(r"\*", ".*"))
            else:
                known.add(t)
    missing = [t for t in TESTIDS if t not in known and not any(re.fullmatch(p, t) for p in patterns)]
    if missing:
        raise SystemExit(f"testids missing from testid-inventory.json: {missing}")
    log(f"testids verified: {len(TESTIDS)} used, all in inventory ({len(known)} static)")


# ── Event / plan analysis ─────────────────────────────────────────────────────────────────────


def planned_units(events: list[dict]) -> list[dict]:
    return [{"ord": e.get("ord"), "stage": e.get("stage"), "gate": e.get("gate"),
             "executorType": e.get("executorType"), "description": e.get("description")}
            for e in events if e.get("type") == "unitPlanned"]


RepoIndex = tuple[set[str], dict[str, list[str]]]
_REPO_INDEX: RepoIndex | None = None


def repo_files() -> RepoIndex:
    """The repo's tracked paths plus a basename → paths index (cached; one `git ls-files`). A git
    failure (no git, not a worktree) is a named `SystemExit`, never an empty repo: an empty index
    would silently classify every file a plan names as nonexistent and invalidate the analysis."""
    global _REPO_INDEX
    if _REPO_INDEX is None:
        argv = ["git", "-C", str(ROOT), "ls-files"]
        try:
            out = subprocess.run(argv, capture_output=True, text=True, check=True).stdout
        except (FileNotFoundError, subprocess.CalledProcessError) as e:
            detail = getattr(e, "stderr", "") or str(e)
            raise SystemExit(f"`{' '.join(argv)}` failed ({type(e).__name__}: {detail.strip()[:300]}) — the plan "
                             "analysis needs the repo's tracked file list; run the harness from a git worktree of wicked-studio") from e
        paths = set(out.split())
        if not paths:
            raise SystemExit(f"`{' '.join(argv)}` returned no tracked files — {ROOT} is not the wicked-studio worktree")
        by_base: dict[str, list[str]] = {}
        for p in paths:
            by_base.setdefault(p.rsplit("/", 1)[-1], []).append(p)
        _REPO_INDEX = (paths, by_base)
    return _REPO_INDEX


def canonical_files(real_paths: list[str], real_bare: list[str], index: RepoIndex) -> list[str]:
    """One identity per file: a bare `App.tsx` IS `src/App.tsx` when that basename is unique in the
    repo; an ambiguous basename stays a basename (and is dropped when one of its paths is already
    named). File-overlap Jaccard is computed over THIS set — a plan that says `App.tsx` and one that
    says `src/App.tsx` name the same file."""
    _, by_base = index
    canon = set(real_paths)
    for b in real_bare:
        hits = by_base.get(b, [])
        if len(hits) == 1:
            canon.add(hits[0])
        elif not any(h in canon for h in hits):
            canon.add(b)
    return sorted(canon)


# What a test scenario looks like (besides carrying an id): a verb from the checking vocabulary AND
# a noun from the four asked surfaces. A survey bullet, a heading, a table-of-contents line or a
# toolchain path has neither and is not a scenario.
SCENARIO_ID_RE = r"(?:\b(?:S|SC|SCN|T|TC|TS|LT|R|D|G)-?\d{1,3}\b|(?<![\d.])\d{1,2}\.\d{1,2}(?![\d.]))"
SCENARIO_VERB_RE = re.compile(r"\b(?:verif(?:y|ies|ied)|assert(?:s|ed|ing)?|check(?:s|ed|ing)?|should|expect(?:s|ed)?|tests?)\b", re.I)
SURFACE_NOUN_RE = re.compile(
    r"/ws\b|websocket|socket|\bframes?\b|coreevent|awaitinghuman|unitplanned|sessioncompleted|\bevents?\b|\bfold\b|\bstores?\b"
    r"|/api/v1|\broutes?\b|\bendpoints?\b|\b(?:get|post|patch)\s+/|/runs\b|/campaigns\b|/repos\b|/projects\b|/testing\b|/steering\b|/health\b"
    r"|\bcli\b|\bnpm\b|\bnpx\b|\bscripts?\b|\bbin\b|wicked-crew serve"
    r"|\bpages?\b|\bui\b|\bdeck\b|\bboard\b|\bcomponents?\b|\brender(?:s|ing|ed)?\b|\btestid|playwright|\be2e\b|\bgates?\b",
    re.I)
_BULLET_RE = re.compile(r"^(?:[-*•]|\d{1,3}[.)])\s+(\S.*)$")
_TAG_RE = re.compile(r"\[(?:TOOL|AGENT)\]|\*\*|`")
_RULE_RE = re.compile(r"^\|?\s*:?-{2,}")
# Bare basenames resolve only into the roots the path pattern already counted — a plan naming
# `needsYou.test.ts` cites its own coverage, not a source file behind a scenario.
SOURCE_ROOTS = ("src/", "e2e/", "docs/", "scripts/", "public/", ".github/")


def _looks_like_scenario(title: str, has_id: bool) -> bool:
    return has_id or bool(SCENARIO_VERB_RE.search(title) and SURFACE_NOUN_RE.search(title))


def _title(text: str) -> str:
    return re.sub(r"\s+", " ", _TAG_RE.sub("", text)).strip()[:120]


# Execution summaries are RESULTS a worker reports, not scenarios a plan proposes. A line is a
# result only when it carries a RESULT STRUCTURE, never a bare word (codex round 5: `- S-1 Verify
# failed /runs cards render red [TOOL]` and `- S-2 Verify /runs returns a FAIL verdict [AGENT]` are
# proposed scenarios that NAME an expected outcome; an unqualified `red`/`FAIL` match discarded
# them). The structures (`result_marker`, per table cell / bullet body):
#   * a tally in summary position — `N passed|failed|skipped|error(s)` followed by the end, a
#     separator, `in` or `of` ("12 passed, 0 failed", "2442 passed in 69s"; NOT "21 failed runs ⇒ …",
#     a fixture count);
#   * a ✓ ✔ ✗ ✘ tick;
#   * an exit code (`exit 1`, `exit code 0`);
#   * PASS|PASSED|FAIL|FAILED (case-sensitive) ONLY when the cell/body STARTS with it or it follows
#     `→` / `=>` / `:` at the END of the cell/body ("PASS — verify /steering", "npm test → FAIL");
#   * green|red ONLY in a cell/body that also carries a tally / duration / fraction or a COMMAND
#     (a backticked or bare `npm|pnpm|yarn|bun|npx|cargo|go|make|pytest|vitest|jest|playwright|tsc
#     …` invocation): "`npm test` → 237 files / 2442 tests green" is a result.
# AND — codex round 6 — a structure excludes ONLY a cell/body WITHOUT a scenario verb (verify /
# assert / check / should / expect / test, outside its commands and code spans; "2442 tests",
# "Tests:" and "test results" are the tally noun / a label, not the verb): a cell that PROPOSES a
# check is a scenario whatever outcome it names — `S-1 Verify CLI returns exit code 1 for invalid
# input [TOOL]`, `S-2 Verify completed UI cards show ✓ [TOOL]`, "Verify failed /runs cards render
# red" — the verb wins (round 5 still dropped the first two as an exit code / a tick). Judged per
# table CELL, so a results table (`| verify /ws fold | 12 passed, 0 failed |`) is still a result:
# its Result cell carries a structure and no verb.
# A line that merely names a command ("Run npm run typecheck to verify CLI behavior") PROPOSES a
# check and is a scenario. Everything under an "Execution verdict" heading is excluded wholesale
# (`plan_lines`).
RESULT_COUNT_RE = re.compile(r"\b\d+ (?:passed|failed|skipped|errors?)\b(?=\s*(?:$|[,;.)|\]*`—–-]|in\b|of\b))")
RESULT_TICK_RE = re.compile(r"[✓✔✗✘]")
RESULT_EXIT_RE = re.compile(r"\bexit (?:code )?\d+\b")
_VERDICT = r"(?:PASS|FAIL)(?:ED)?"
RESULT_VERDICT_START_RE = re.compile(rf"^\W*{_VERDICT}\b")
RESULT_VERDICT_END_RE = re.compile(rf"(?:→|=>|:)\s*\**{_VERDICT}\**\W*$")
RESULT_COLOR_RE = re.compile(r"\b(?:green|red)\b", re.I)
# What makes green/red a verdict: a tally / duration / fraction, or a command the colour reports on.
RESULT_TALLY_RE = re.compile(
    r"\b\d+\s+(?:tests?|files?|specs?|cases?|checks?|suites?|assertions?|passed|failed|skipped|errors?|warnings?)\b"
    r"|\b\d+\s*/\s*\d+\b|\b\d+(?:\.\d+)?\s*(?:ms|s|sec|m|min)\b", re.I)
_RUNNERS = r"(?:npm|pnpm|yarn|bun|npx|cargo|go|make|ninja|pytest|vitest|jest|playwright|tsc|vite|python3?|node|git|gh|curl)"
RESULT_COMMAND_RE = re.compile(rf"`{_RUNNERS}\b[^`]*`|\b(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?[\w:.-]+|\b(?:cargo|go|make|pytest|vitest|jest|playwright|tsc|vite)\s+[\w:./-]+", re.I)
_CODE_SPAN_RE = re.compile(r"`[^`]*`")
# The scenario verbs, as VERBS: not inside a command / code span; `N tests`, a `Tests:` label and a
# `test results|summary|report` compound are the tally noun, not the verb.
RESULT_SCENARIO_VERB_RE = re.compile(
    r"\b(?:verif(?:y|ies|ied)|assert(?:s|ed|ing)?|check(?:s|ed|ing)?|should|expect(?:s|ed)?)\b"
    r"|(?<!\d\s)\btests?(?:ed|ing)?\b(?!\s*:)(?!\s+(?:results?|summar(?:y|ies)|reports?)\b)", re.I)
# A leading scenario id (`S-7`, `1.2`) is an id, not a count: stripped before the structures are judged
# (`S-7 check …` is not the tally "7 checks"; `S-3 Expect …` keeps its verb).
_LEAD_ID_RE = re.compile(rf"^\W*(?:{SCENARIO_ID_RE})\b\W*")


def result_marker(item: str) -> str | None:
    """The RESULT STRUCTURE this plan item carries, NAMED — or None when it proposes rather than
    reports. Judged per table cell (`raw` joins cells with ` | `) / bullet body — with a leading
    scenario id stripped — so "starts with" means the cell, not the row's number column. A cell
    with a scenario verb (`RESULT_SCENARIO_VERB_RE`, outside its commands / code spans) PROPOSES a
    check and carries no marker whatever outcome it names (codex round 6: `Verify CLI returns exit
    code 1 for invalid input` and `Verify completed UI cards show ✓` were dropped as an exit code /
    a tick); only a verb-less cell is judged on its structures."""
    for seg in item.split(" | "):
        seg = _LEAD_ID_RE.sub("", seg.strip(), count=1)
        plain = _CODE_SPAN_RE.sub(" ", RESULT_COMMAND_RE.sub(" ", seg))
        if RESULT_SCENARIO_VERB_RE.search(plain):
            continue  # the verb wins: an expected outcome, not a reported one
        if RESULT_COUNT_RE.search(seg):
            return "count"
        if RESULT_TICK_RE.search(seg):
            return "tick"
        if RESULT_EXIT_RE.search(seg):
            return "exit-code"
        if RESULT_VERDICT_START_RE.match(seg) or RESULT_VERDICT_END_RE.search(seg):
            return "verdict-word"
        if RESULT_COLOR_RE.search(seg) and (RESULT_COMMAND_RE.search(seg) or RESULT_TALLY_RE.search(seg)):
            return "colour-verdict"
    return None


EXEC_SECTION_RE = re.compile(r"execution verdict", re.I)
# The two classification vocabularies the plans use: prose (deterministic tool check vs governed
# agent run) and tags (`[TOOL]` vs `[AGENT]`). A plan classifies when BOTH classes appear among its
# scenario lines / plan-table rows — not somewhere in the surrounding survey text.
CLASS_DET_RE = re.compile(r"deterministic|tool check|\[TOOL\]", re.I)
CLASS_GOV_RE = re.compile(r"governed|agent run|\[AGENT\]", re.I)
SURFACE_RES = {
    "ws_events": re.compile(r"/ws\b|websocket|awaitinghuman|coreevent|unitplanned|sessioncompleted|framereceived"),
    "api_routes": re.compile(r"/api/v1|/testing/recon|\b(get|post) /|/runs\b|/campaigns\b|/repos\b|/projects\b"),
    "cli": re.compile(r"\bcli\b|npx |npm run|\bbin/|wicked-crew serve|command[- ]line|vite build"),
    "ui_pages": re.compile(r"/testing/campaigns|/runs/|/steering|playwright|data-testid|home deck|homecommand|leftsidebar"),
}


MEASURED_OVER = ("scenario lines + plan-table rows only (execution results excluded: items carrying a result STRUCTURE — a "
                 "summary tally, a tick, an exit code, PASS/FAIL starting the cell or ending it after →/=>/:, green/red with a "
                 "tally or a command — in a cell/body WITHOUT a scenario verb, and 'Execution verdict' sections; a proposed "
                 "command or an expected outcome — 'exit code 1', 'show ✓', 'render red' — is a scenario: the verb wins)")


def plan_lines(text: str) -> tuple[list[str], int]:
    """The plan's lines with every "Execution verdict" section removed — from that heading up to
    the next heading of the same or a higher level. Returns (kept lines, dropped line count)."""
    kept: list[str] = []
    dropped = 0
    skip_level: int | None = None
    for line in text.splitlines():
        h = re.match(r"^(#{1,6})\s", line)
        if h:
            level = len(h.group(1))
            if skip_level is not None and level <= skip_level:
                skip_level = None
            if skip_level is None and EXEC_SECTION_RE.search(line):
                skip_level = level
                dropped += 1
                continue
        if skip_level is None:
            kept.append(line)
        else:
            dropped += 1
    return kept, dropped


def scenario_records(text: str) -> tuple[list[dict], dict]:
    """Extract the plan's scenarios as `{title, id, raw}` records — `raw` is the FULL item (the
    bullet body with its tags, or every cell of the table row), the only text `classifies` and
    `surfaces` are measured over. Returns (records, {execution_section_lines, execution_summary_items}
    — what was excluded as execution results rather than proposed scenarios).
    * A markdown table whose header names a `Scenario` column IS a plan table: every data row is
      one scenario (title = that cell) — the author labelled it so; the verb usually sits in the
      row's Class column, not the title.
    * Any other table row: title = the first non-numeric cell, accepted only with a leading id or
      a checking verb AND a surface noun in that cell (a survey table is not a plan).
    * Bullet / numbered items: accepted with a leading id (`S-1`, `1.2` — a bare number is not an
      id) or a verb AND a noun in the item text.
    Headings, bold-label paragraphs, table headers/rules, table-of-contents lines, toolchain paths
    and execution RESULTS (an item carrying a result STRUCTURE in a verb-less cell —
    `result_marker`; "Execution verdict" sections) are none of these — an item that merely names a
    command, or an expected outcome ("Verify failed /runs cards render red", "Verify CLI returns
    exit code 1", "Verify completed UI cards show ✓"), is a proposed check."""
    records: list[dict] = []
    lines, section_lines = plan_lines(text)
    excluded = {"execution_section_lines": section_lines, "execution_summary_items": 0}
    header: list[str] | None = None

    def accept(title: str, lead_id: str | None, raw: str) -> None:
        if result_marker(raw):
            excluded["execution_summary_items"] += 1
            return
        records.append({"title": title, "id": lead_id, "raw": re.sub(r"\s+", " ", raw).strip()})

    for i, line in enumerate(lines):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if _RULE_RE.match(s):  # table rule
            continue
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if s.startswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            if _RULE_RE.match(nxt):  # this row is a table header
                header = [c.lower() for c in cells]
                continue
            scol = next((j for j, h in enumerate(header or []) if re.search(r"\bscenario", h)), None)
            if scol is not None and scol < len(cells):
                body, is_plan_row = cells[scol], True
            else:
                body, is_plan_row = next((c for c in cells if c and not re.fullmatch(r"#?\s*\d{1,3}|#", c)), ""), False
            lead = re.match(rf"^\s*({SCENARIO_ID_RE})\b\s*[:.)\-–—]?\s*", body)
            lead_id = lead.group(1) if lead else None
            if not lead_id and cells and re.fullmatch(rf"#?\s*{SCENARIO_ID_RE}", cells[0]):
                lead_id = re.sub(r"^#?\s*", "", cells[0])
            title = _title(body[lead.end():] if lead else body)
            if title and not re.fullmatch(r"\d{1,3}", title) and (is_plan_row or _looks_like_scenario(title, bool(lead_id))):
                accept(title, lead_id, " | ".join(cells))
            continue
        header = None
        b = _BULLET_RE.match(s)
        if not b:
            continue
        body = b.group(1)
        lead = re.match(rf"^({SCENARIO_ID_RE})\b\s*[:.)\-–—]?\s*", body)
        lead_id = lead.group(1) if lead else None
        title = _title(body[lead.end():] if lead else body)
        if title and _looks_like_scenario(title, bool(lead_id)):
            accept(title, lead_id, body)
    return records, excluded


def scenario_items(text: str) -> tuple[list[str], list[str]]:
    """(scenario titles, sorted unique leading scenario ids) — see `scenario_records`."""
    records, _ = scenario_records(text)
    return [r["title"] for r in records], sorted({r["id"] for r in records if r["id"]})


def analyze_plan(text: str, index: RepoIndex | None = None) -> dict:
    """Measure a captured plan. File identities are collected over the whole text (a plan's survey
    map names the files behind its scenarios); `classifies` and `surfaces` are measured over the
    extracted scenario lines + plan-table rows ONLY — a survey paragraph that repeats the brief's
    surface names, or a "No plan available" answer, proposes nothing. `names_real_files` needs
    ≥ 3 canonical files AND ≥ 1 extracted scenario: files without scenarios are a survey."""
    paths, by_base = index or repo_files()
    path_hits = set(re.findall(r"(?<![\w/])((?:src|e2e|docs|scripts|public|\.github)/[\w./\-\[\]]+\.(?:tsx?|py|json|md|css|html|ya?ml))", text))
    # Bare source basenames (`App.tsx`, `useEventStream.ts`, `gates.ts`) — kept only when the repo
    # tracks a file of that name, then canonicalized to the repo path when the name is unique.
    bare = set(re.findall(r"(?<![\w./-])([A-Za-z][\w.-]*\.(?:tsx?|mjs|py))\b", text))
    real_paths = sorted(p for p in path_hits if p in paths)
    real_bare = sorted(b for b in bare if any(h.startswith(SOURCE_ROOTS) for h in by_base.get(b, [])))
    fake_paths = sorted(p for p in path_hits if p not in paths)
    canon = canonical_files(real_paths, real_bare, (paths, by_base))
    records, excluded = scenario_records(text)
    scenario_lines = [r["title"] for r in records]
    ids = sorted({r["id"] for r in records if r["id"]})
    measured = "\n".join(r["raw"] for r in records)
    low = measured.lower()
    return {
        "chars": len(text),
        "real_files": real_paths,
        "real_basenames": real_bare,
        "canonical_files": canon,
        "nonexistent_paths": fake_paths,
        "names_real_files": len(canon) >= 3 and bool(records),
        "classifies": bool(CLASS_DET_RE.search(measured) and CLASS_GOV_RE.search(measured)),
        "deterministic_mentions": len(CLASS_DET_RE.findall(measured)),
        "governed_mentions": len(CLASS_GOV_RE.findall(measured)),
        "scenario_ids": ids,
        "scenario_lines": scenario_lines,
        "excluded": excluded,
        "measured_over": MEASURED_OVER,
        "surfaces": {k: bool(rx.search(low)) for k, rx in SURFACE_RES.items()},
    }


def jaccard(a: set, b: set) -> float | None:
    if not a and not b:
        return None
    return round(100 * len(a & b) / len(a | b), 1)


def norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower())[:60].strip()


# ── Gate policy, sibling attribution, the verdict split ───────────────────────────────────────

# The IMPERATIVE of a gate prompt is its first clause — up to the first ":" or newline, ≤ 80 chars:
# "Approve unit 1 before it runs: Recon: survey…" → "Approve unit 1 before it runs";
# "Deliver: open a PR against main" → "Deliver". Since round 4 it only NAMES a prompt in reasons and
# findings — it decides nothing (the allow-list and the complete-prompt scan in `gate_decision` do).


def imperative(prompt: str | None) -> str:
    first = re.split(r"[:\n]", (prompt or "").strip(), maxsplit=1)[0]
    first = re.sub(r"^[\s#>\-•]+", "", first)  # bullet / heading decoration
    first = re.sub(r"[*`]+", "", first)  # markdown emphasis / code ticks
    return re.sub(r"\s+", " ", first).strip()[:80]


def gate_unit(detail: dict | None, ord_: int | None) -> dict | None:
    """The run detail's unit for a gate's ord — `{ord, stage, gate}` — or None when unknown."""
    if ord_ is None:
        return None
    for u in (detail or {}).get("units") or []:
        if isinstance(u, dict) and u.get("ord") == ord_:
            return {"ord": ord_, "stage": u.get("stage"), "gate": u.get("gate")}
    return None


# (c) NO delivery verb or COMMAND anywhere in the complete prompt. The first clause alone hid
# "Approve unit 4 before it runs: Push the branch and open a PR" (round 3), and a verb list that only
# knew `push` approved "Approve unit 4 before it runs: gh pr create --fill" (round 4). Longer
# alternatives first, so the reason names the whole command that was asked for.
DELIVERY_VERB_RE = re.compile(
    r"\b(?:gh pr create|pr create|git push|push (?:the )?branch|push|open (?:a |the )?(?:pr|pull request)|pull request"
    r"|npm publish|cargo publish|publish|create (?:a )?release|release|delivery|deliver|merge)\b", re.I)
# (a) The allow-listed prompt SHAPES — the only two a gate may be approved on: crew's pre-execution
# unit gate and a plan approval. Anything else — SteeringGate's `Prompt unavailable (daemon
# restarted)…` fallback, "Please push the branch…", "Amend the plan?" — is `unknown-prompt-shape`.
PRE_EXECUTION_RE = re.compile(r"^Approve unit \d+ before it runs:")
PLAN_APPROVAL_RE = re.compile(r"^Approve (?:the )?(?:proposed )?(?:test )?plan\b")
GATE_SHAPES = (("pre-execution", PRE_EXECUTION_RE), ("plan-approval", PLAN_APPROVAL_RE))


def gate_shape(text: str) -> str | None:
    """The allow-listed shape `text` has — "pre-execution" / "plan-approval" — or None."""
    return next((name for name, rx in GATE_SHAPES if rx.match(text)), None)


def gate_kinds(unit: dict | None) -> set[str]:
    """The gated unit's non-empty `stage`/`gate` values, lower-cased. EMPTY means the kind is
    UNKNOWN: the unit lookup failed (None), or `stage` and `gate` are both missing / null / blank."""
    if not isinstance(unit, dict):
        return set()
    return {unit[k].strip().lower() for k in ("stage", "gate") if isinstance(unit.get(k), str) and unit[k].strip()}


def gate_decision(prompt: str | None, unit: dict | None = None) -> tuple[str, str]:
    """THE gate policy, applied to every gate — the intake gate, every later gate, every sibling's
    gate — an ALLOW-LIST that fails CLOSED. A gate is APPROVED only when ALL of these hold:
      (a) the prompt is an allow-listed SHAPE (`gate_shape`): crew's pre-execution unit gate
          (`Approve unit N before it runs: …`) or a plan approval
          (`Approve [the] [proposed] [test] plan…`);
      (b) the gated unit's `stage`/`gate` (from GET /runs/:id) is KNOWN and is not a delivery kind
          (deliver / release / publish / merge);
      (c) NO delivery verb or command appears ANYWHERE in the complete prompt (`DELIVERY_VERB_RE`).
    EVERYTHING ELSE is rejected with a named reason — absence of a recognized delivery keyword is
    not authorization (codex round 4):
      * a delivery KIND → reject, whatever the prompt says;
      * an empty / unreadable prompt → `unreadable-gate`, ALWAYS;
      * a delivery verb / command anywhere → `delivery-verb` ("…before it runs: gh pr create --fill",
        "Please push the branch and open a PR", a plan body that lists `/runs/:id/deliver` among the
        routes to test — rejecting a legitimate plan is a recorded finding, approving a delivery is
        not recoverable);
      * any other shape — SteeringGate's `Prompt unavailable (daemon restarted)…` fallback included,
        whatever the kind says → `unknown-prompt-shape`;
      * an allow-listed shape whose unit KIND is unknown (lookup failed, `stage`/`gate` null) →
        `unknown-gate-kind` — the shape alone no longer approves.
    Returns (decision, reason); the caller records both together with the unit's stage/gate."""
    kinds = gate_kinds(unit)
    hit_kind = sorted(kinds & DELIVER_KINDS)
    if hit_kind:
        return "reject", f"gate kind {hit_kind[0]!r} (the unit's stage/gate) authorizes delivery (never deliver)"
    text = (prompt or "").strip()
    if not text:
        return "reject", "unreadable-gate"
    kind_tail = f"; unit stage/gate {unit.get('stage')}/{unit.get('gate')}" if kinds else "; unit stage/gate unknown"  # type: ignore[union-attr]
    verb = DELIVERY_VERB_RE.search(text)
    if verb:
        return "reject", f"delivery-verb: the complete prompt asks to {verb.group(0).lower()!r} (never deliver)" + kind_tail
    shape = gate_shape(text)
    if shape is None:
        return "reject", (f"unknown-prompt-shape: {imperative(text)!r} is neither crew's pre-execution gate "
                          "('Approve unit N before it runs:') nor a plan approval ('Approve [the] [proposed] [test] plan') "
                          "— not on the allow-list" + kind_tail)
    if not kinds:
        return "reject", (f"unknown-gate-kind: the unit's stage/gate is unknown (lookup failed or null) — the {shape} prompt "
                          f"{imperative(text)!r} alone does not authorize approving")
    return "approve", (f"{shape} gate {imperative(text)!r}: allow-listed shape, known non-delivery kind, "
                       "no delivery verb anywhere in the complete prompt" + kind_tail)


# Explicit parent pointers a sibling DTO may carry (wicked-crew-api-types `AgentSession` and its
# successors) — any of them naming one of our run ids is a relationship.
PARENT_FIELDS = ("parent_run_id", "parent_id", "parent_session_id", "parent", "launched_by", "spawned_by")


def attribute_siblings(runs: list[dict], campaigns: list[dict], *, before: set[str], own: list[str],
                       label: str | None) -> dict:
    """Split the runs that appeared since launch into ATTRIBUTABLE siblings and unrelated new runs.
    A sibling is related to this launch by a daemon-visible RELATIONSHIP only (wicked-crew-api-types
    0.25.0 `AgentSession` / `Campaign`):
      * `session.campaign_id` or `group_label` equal to the returned campaign label;
      * membership in that campaign's `node_run_id` values or `attached_runs[].runId` (DAG-node ids
        are `{campaign}:{node}:a{n}` but membership is read from the campaign, not the id shape);
      * an explicit parent field on the DTO (`PARENT_FIELDS`) naming one of our run ids;
      * `session.problem` carrying one of our run ids or the campaign label — prefixed by the
        `TEST_PROBLEM_PREFIX` marker when one is configured.
    The brief text is NOT a relationship: identical briefs are intentional (LT-3 repeats LT-1's), so
    a run whose problem merely equals INSTRUCTION is `unrelated`. A run that APPEARED is not a sibling."""
    linked: set[str] = set()
    for c in campaigns:
        if label and c.get("id") == label:
            linked |= {v for v in (c.get("node_run_id") or {}).values() if isinstance(v, str)}
            linked |= {a.get("runId") for a in (c.get("attached_runs") or []) if isinstance(a, dict) and a.get("runId")}
    own_ids = [o for o in own if o]
    siblings: list[dict] = []
    unrelated: list[dict] = []
    for r in runs:
        s = r.get("session") or {}
        rid = s.get("id")
        if not rid or rid in before or rid in own_ids:
            continue
        problem = s.get("problem") or ""
        marked = problem if not TEST_PROBLEM_PREFIX else (problem if TEST_PROBLEM_PREFIX in problem else "")
        why = None
        if label and (s.get("campaign_id") == label or s.get("group_label") == label):
            why = "session.campaign_id/group_label == the launch's campaign label"
        elif rid in linked:
            why = "listed in the campaign's node_run_id/attached_runs"
        elif any(s.get(f) in own_ids for f in PARENT_FIELDS if isinstance(s.get(f), str)):
            why = "an explicit parent field on the DTO names the launched run"
        elif any(o in marked for o in own_ids):
            why = "session.problem carries the launched run id" + (" after the TEST_PROBLEM_PREFIX marker" if TEST_PROBLEM_PREFIX else "")
        elif label and label in marked:
            why = "session.problem carries the campaign label" + (" after the TEST_PROBLEM_PREFIX marker" if TEST_PROBLEM_PREFIX else "")
        entry = {"id": rid, "status": s.get("status"), "problem": problem[:100]}
        if why:
            siblings.append({**entry, "attributed_by": why})
        else:
            unrelated.append(entry)
    return {"attributable_siblings": siblings, "unrelated_new_runs": unrelated}


# ── Gates through the UI — the ONE click path for every gate ──────────────────────────────────


def gate_url_matches(url: str, run_id: str) -> bool:
    """True iff `url` is EXACTLY this run's gate endpoint — `/api/v1/runs/<run_id>/gate` (studio
    posts `encodeURIComponent(id)`, so the path is compared decoded) — with or without the daemon
    origin, query string ignored. `"/gate" in url` accepted any run's gate; this accepts one."""
    path = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
    return path in {f"/api/v1/runs/{run_id}/gate", f"{urllib.parse.urlsplit(API).path}/runs/{run_id}/gate"}


def gate_wire_check(entry: dict, run_id: str) -> str | None:
    """None when the recorded wire proves THIS decision reached THIS run's gate: the POST went to
    exactly `/api/v1/runs/<run_id>/gate`, the request body's `approve` equals the decision taken
    (`{approve: true}` approve, `{approve: false}` reject — studio's client contract), and the
    status is 2xx. Otherwise every mismatch, named — a REJECT that wired `{approve: true}` is a
    dangerous UI regression, not evidence."""
    problems: list[str] = []
    url = entry.get("url") or ""
    if not gate_url_matches(url, run_id):
        problems.append(f"url {url!r} is not /api/v1/runs/{run_id}/gate")
    want = entry.get("decision") == "approve"
    body = entry.get("body")
    got = body.get("approve") if isinstance(body, dict) else None
    if got is not want:
        problems.append(f"request body approve={got!r} but the decision {entry.get('decision')!r} requires approve={want}")
    st = entry.get("status")
    if not (isinstance(st, int) and 200 <= st < 300):
        problems.append(f"status {st!r} is not 2xx")
    return "; ".join(problems) or None


def card_headline(prompt: str | None) -> str:
    """What SteeringGate shows for `prompt`: `cleanPrompt()` — the text before the first `[`,
    trimmed (the bracketed remainder is folded into a "why this gate fired" disclosure the
    `steering-prompt` element never carries) — whitespace-normalized like `inner_text()`."""
    text = prompt or ""
    i = text.find("[")
    return re.sub(r"\s+", " ", text if i == -1 else text[:i]).strip()


def latest_awaiting_human(events: list[dict]) -> dict | None:
    """The LATEST `awaitingHuman` event — the daemon's current gate while the run is
    awaiting_human — or None. Never an older one: a later gate whose prompt cannot be read is an
    unreadable CURRENT gate, not a reason to look further back (codex round 6)."""
    aw = [e for e in events if isinstance(e, dict) and e.get("type") == "awaitingHuman"]
    return aw[-1] if aw else None


RESOLVES_GATE = {"gateDecided", "resumed"}  # what closes an `awaitingHuman` gate in the daemon's log (studio folds the same two)
ENDS_RUN = {"sessionCompleted", "runCancelled", "sessionFailed"}  # a finished run has no gate


def unresolved_gate(events: list[dict]) -> tuple[dict | None, str]:
    """The run's current UNRESOLVED gate from a FRESH event log — `(event, "")` — or `(None, why)`.
    The gate is the LATEST `awaitingHuman` event, provided nothing after it resolves it: no
    `gateDecided` / `resumed` for ITS ord (`gateDecided` also fires for auto gates, so an unrelated
    ord's decision resolves nothing) and no terminal event. An older `awaitingHuman` is superseded
    by a later one (a run gates one unit at a time). AMBIGUOUS — no gate is established — when a
    later `gateDecided` / `resumed` cannot be attributed (it, or the gate, carries no ord): whether
    the gate the card shows is still open cannot be told, and the harness must not guess."""
    latest = latest_awaiting_human(events)
    if latest is None:
        return None, "no awaitingHuman event in the fresh events"
    ord_ = latest.get("ord")
    tag = f"awaitingHuman event (ord {ord_}, seq {latest.get('seq')})"
    start = next(i for i, e in enumerate(events) if e is latest) + 1
    for e in events[start:]:
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        if t in ENDS_RUN:
            return None, f"the latest {tag} is followed by {t} (seq {e.get('seq')}) — the run has no open gate"
        if t in RESOLVES_GATE:
            r_ord = e.get("ord")
            if isinstance(ord_, int) and isinstance(r_ord, int):
                if r_ord == ord_:
                    return None, f"the latest {tag} was already resolved by {t} (ord {r_ord}, seq {e.get('seq')}) — no unresolved gate"
                continue  # another unit's gate deciding (an auto gate) — not this one
            return None, (f"ambiguous: the latest {tag} is followed by {t} (ord {r_ord!r}, seq {e.get('seq')}) that can neither be "
                          "attributed to it nor ruled out — whether the gate is still open cannot be established")
    return latest, ""


def _gate_state(run_id: str, *, record_run_id=None, ord_=None, prompt=None, source=None, why=None, known: bool = True) -> dict:
    ok = isinstance(prompt, str) and bool(prompt.strip())
    return {"run_id": run_id, "record_run_id": record_run_id if isinstance(record_run_id, str) and record_run_id else None,
            "ord": ord_ if isinstance(ord_, int) else None, "prompt": prompt if ok else None, "readable": ok, "known": bool(known),
            "source": source if ok else None, "why": None if ok else why}


def current_gate(run_id: str) -> dict:
    """The daemon's CURRENT gate for `run_id`, read read-only and FRESH — `{run_id, record_run_id,
    ord, prompt, readable, known, source, why}` — the ONLY gate a POST to `/runs/:id/gate` can
    decide (the POST carries no ord). Never the card's `cleanPrompt()` headline, never an older
    gate's prompt, never events a caller fetched EARLIER (codex round 7):
      1. `GET /runs/:id/gate` — the daemon's cached open-gate record (`GateInfo {runId, ord, prompt,
         …}`, wicked-crew-api-types 0.25.0; studio's own late-join reconcile). When it answers 2xx
         with an object, THAT record is the current gate — its `ord` and its `prompt`; an empty /
         non-string prompt makes the current gate UNREADABLE (`readable: false`) and the events are
         NOT consulted for a substitute;
      2. on ANY other answer — a 404 (nothing cached), a non-2xx, a transport failure, a 2xx that is
         not an object (the last three are recorded typed misses) — the ONLY permitted fallback: a
         FRESH `GET /runs/:id/events` and the current UNRESOLVED gate in it (`unresolved_gate`: the
         LATEST `awaitingHuman` with no later `gateDecided` / `resumed` for its ord and no terminal
         event after it) — its `ord` and its verbatim `prompt`; an unreadable prompt there is
         UNREADABLE (an older event's never stands in). When that fetch fails too, or the fresh log
         establishes no gate (none / already decided / ambiguous / run over), the gate state is
         UNKNOWN (`known: false`).
    Codex round 7 (HIGH): the failure branches fell back to the events the CALLER had fetched before
    the card rendered — a stale ord-1 log approved a 503 / 404 / malformed-200 daemon whose current
    gate was an ord-4 delivery, and `/events` was never re-read. An unreadable or unknown current
    gate is a gate-state conflict for the caller (`gate_state_conflict`): nothing is clicked."""
    path = f"/runs/{enc(run_id)}/gate"
    status, body = _fetch(path)
    if 200 <= status < 300 and isinstance(body, dict):
        p = body.get("prompt")
        return _gate_state(run_id, record_run_id=body.get("runId"), ord_=body.get("ord"), prompt=p,
                           source="GET /runs/:id/gate (GateInfo.prompt, the daemon's cached open-gate record)",
                           why=f"GET /runs/:id/gate answered ord {body.get('ord')!r} with an empty prompt — the current record is "
                               "unreadable; an awaitingHuman event's prompt is never substituted for it")
    if status == 404:
        why_gate = "GET /runs/:id/gate → 404 (no cached gate)"
    elif not 200 <= status < 300:
        record_fetch_error(path, status, body)
        why_gate = f"GET /runs/:id/gate → {status}"
    else:
        record_fetch_error(path, status, f"unexpected body shape: {json.dumps(body, default=str)[:120]}")
        why_gate = "GET /runs/:id/gate answered a non-object body"
    # The ONLY fallback: the events re-read NOW — never a log fetched before the card rendered.
    try:
        events = run_events(run_id)
    except FetchError as e:  # recorded by get()
        return _gate_state(run_id, known=False, why=f"{why_gate}; the fresh GET /runs/:id/events failed ({e}) — gate state unknown")
    latest, why_none = unresolved_gate(events)
    if latest is None:
        return _gate_state(run_id, known=False, why=f"{why_gate}; fresh events: {why_none} — gate state unknown")
    src = f"awaitingHuman event (ord {latest.get('ord')}, seq {latest.get('seq')})"
    return _gate_state(run_id, record_run_id=latest.get("session"), ord_=latest.get("ord"), prompt=latest.get("prompt"),
                       source=f"{src} — unresolved in the fresh GET /runs/:id/events",
                       why=f"{why_gate}; the latest {src} carries no readable prompt — an older event's prompt is never substituted")


# What SteeringGate renders as the gate's identity: `run <id8> · before unit #N` (src/components/
# SteeringGate.tsx) — the ord is exposed as TEXT, the run id as `data-run-id`.
CARD_ORD_RE = re.compile(r"before unit #(\d+)")


def card_ord_from_text(card_text: str | None) -> int | None:
    """The ord SteeringGate renders on the card (`… · before unit #N`), or None when the card
    carries no such line (the SPA had no numeric ord to show)."""
    m = CARD_ORD_RE.search(card_text or "")
    return int(m.group(1)) if m else None


def card_identity(card) -> tuple[str | None, int | None]:
    """Best-effort reads of the rendered card's own identity — its `data-run-id` attribute and the
    ord in its text (`card_ord_from_text`); None for whatever the card does not expose. An
    unexposed identity is not a match: the headline comparison in `gate_state_conflict` still
    applies, and an exposed one that DISAGREES with the daemon's current gate is a conflict."""
    run_id = ord_ = None
    try:
        v = card.first.get_attribute("data-run-id")
        run_id = v if isinstance(v, str) and v else None
    except Exception:
        pass
    try:
        ord_ = card_ord_from_text(card.first.inner_text())
    except Exception:
        pass
    return run_id, ord_


def gate_state_conflict(cur: dict, *, run_id: str, ord_: int | None, card_run_id: str | None, card_ord: int | None,
                        card_text: str | None) -> str | None:
    """None when the card being clicked IS the daemon's current gate (`cur`, from `current_gate`);
    otherwise the conflict, NAMED — and the caller clicks NOTHING (`reject-by-abstention`). Codex
    round 6 (HIGH): a fake daemon serving a delivery prompt for ord 4 while an old ord-1 event/card
    was still rendered produced `approve` — the ord-mismatched record was discarded and the ord-1
    event's readable prompt stood in, and the POST (no ord on the wire) would have approved the
    daemon's current delivery gate. A conflict is ANY of:
      * the current gate's prompt is unreadable (`cur.readable` false — unserved, empty, or the
        latest event has none; never replaced by an older readable prompt);
      * the record / event names another run (`record_run_id`), or the card does (`data-run-id`);
      * the card's rendered ord (`before unit #N`) differs from the current gate's ord;
      * the ord the harness read from the events (`ord_`) differs from the current gate's ord;
      * the card's headline is not `cleanPrompt(current.prompt)` (`card-prompt-mismatch` — the click
        surface does not show the gate being decided).
    Absence of an identity (no ord on the card, `ord_` None) is not a match and not a conflict on
    its own — the headline comparison always applies. Codex round 7: when the current gate could not
    be ESTABLISHED at all (`cur.known` false — the gate read failed and the FRESH events settle
    nothing: fetch failed, no gate, already decided, ambiguous, run over) the conflict is
    `unknown-gate` and the caller files it as `gate-state-unknown`; events fetched before the card
    rendered never stand in."""
    if cur.get("known") is False:
        return (f"unknown-gate: the daemon's CURRENT gate could not be established ({cur.get('why')}) — a card headline alone "
                "never decides, and events fetched before the card rendered never stand in")
    if not cur.get("readable"):
        return (f"unreadable-gate: the daemon's CURRENT gate prompt cannot be read ({cur.get('why')}) — a card headline alone "
                "never decides, and an older prompt never stands in")
    rid = cur.get("record_run_id")
    if rid is not None and rid != run_id:
        return f"the daemon's current gate record names run {rid!r}, not {run_id!r}"
    if card_run_id is not None and card_run_id != run_id:
        return f"the card is run {card_run_id}'s (data-run-id), not {run_id}'s"
    cur_ord = cur.get("ord")
    if card_ord is not None and cur_ord is not None and card_ord != cur_ord:
        return f"the card shows ord {card_ord} but the daemon's current gate is ord {cur_ord}"
    if ord_ is not None and cur_ord is not None and ord_ != cur_ord:
        return f"the harness read ord {ord_} from the events but the daemon's current gate is ord {cur_ord}"
    shown = re.sub(r"\s+", " ", card_text or "").strip()
    want = card_headline(cur.get("prompt"))
    if shown != want:
        return (f"card-prompt-mismatch: the card shows {shown[:80]!r} but the daemon's current prompt reads {want[:80]!r} "
                f"(+{len(cur.get('prompt') or '') - len(want)} chars) — the click surface does not show the gate being decided")
    return None


def abstention_label(entry: dict) -> str:
    """The finding a recorded abstention (`gates[]` entry, `decision: reject-by-abstention`) is
    filed under: `gate-state-unknown` when the daemon's current gate could not be ESTABLISHED (the
    reason says so — `current_gate` → `known: false`), else `gate-state-conflict` (a current gate
    that is not the card's, or one whose prompt is unreadable)."""
    return "gate-state-unknown" if str(entry.get("reason") or "").startswith("gate-state-unknown") else "gate-state-conflict"


def decide_gate_on_card(page, card, *, run_id: str, ord_: int | None, unit: dict | None, tag: str,
                        first: bool, card_text: str | None = None) -> dict:
    """Decide a rendered SteeringGate card — or refuse to touch it. FIRST the gate's IDENTITY: the
    daemon's CURRENT gate is read read-only and FRESH, here and now (`current_gate` — `GET
    /runs/:id/gate`, else a FRESH `GET /runs/:id/events` and its current UNRESOLVED gate; never
    events the caller fetched earlier — there is no argument for them) and must be the gate this
    card shows (`gate_state_conflict`: same run, same ord — the card's `before unit #N` line and
    the ord the caller read from the events — and the same headline, `cleanPrompt(current.prompt)`
    == the card's `steering-prompt` text). Any conflict — a stale ord-1 card while the daemon's
    current gate is ord 4, a current prompt the daemon does not serve, a headline that is not the
    current prompt's — means NO CLICK: the entry is recorded as `reject-by-abstention` with both
    texts and both ords, the finding is `gate-state-conflict` (`harness_ok=false`), the run is left
    as it is; a current gate that could not be ESTABLISHED at all (the gate read failed and the
    fresh events settle nothing) is the same abstention filed as `gate-state-unknown` (codex round
    7). (Codex round 6: a POST to `/runs/:id/gate` carries no ord — approving off a stale card
    would have approved the daemon's current delivery gate.) THEN, with the identity proven, the policy:
    `gate_decision` over the COMPLETE current prompt with the unit's stage/gate — the card's text
    is only the CLICK SURFACE (recorded alongside as `prompt_card`, `card_consistent`); codex
    round 5: `Approve unit 4 before it runs: Finalize the test [gh pr create --fill]` rendered a
    clean headline and was approved off the card; the full prompt rejects it on `gh pr create`.
    Then click the matching button, wait for the POST to EXACTLY this run's gate endpoint and
    verify the wire (`gate_wire_check`: endpoint, body.approve == decision, 2xx) — a mismatch, or
    no such POST within 60 s, is a finding and `wire_ok: false` (`harness_ok=false`,
    `gate-wire-mismatch`). Returns the `gates[]` entry. Every gate the harness answers — intake,
    later, sibling — goes through here; the decision is executed ONLY through the UI card."""
    if card_text is None:
        try:
            card_text = card.first.locator('[data-testid="steering-prompt"]').inner_text()
        except Exception as e:  # no prompt element: the click surface has no headline — recorded, compared below
            card_text = ""
            log(f"{tag}: gate ord={ord_} on {run_id}: steering-prompt unreadable ({type(e).__name__}: {e})")
    card_run_id, card_ord = card_identity(card)
    cur = current_gate(run_id)
    prompt, source = cur["prompt"], cur["source"] or cur["why"]
    shown = re.sub(r"\s+", " ", card_text or "").strip()
    consistent: bool | None = (shown == card_headline(prompt)) if prompt is not None else None
    entry = {"ord": ord_, "current_ord": cur["ord"], "card_ord": card_ord, "card_run_id": card_run_id, "first": first,
             "prompt": prompt[:400] if prompt is not None else None, "prompt_len": len(prompt) if prompt else None,
             "prompt_source": source, "prompt_card": (card_text or "")[:400], "card_consistent": consistent,
             "decision": None, "reason": None,
             "unit": {"stage": unit.get("stage"), "gate": unit.get("gate")} if unit else None,
             "status": None, "url": None, "body": None, "wire_ok": None, "wire_check": None}
    conflict = gate_state_conflict(cur, run_id=run_id, ord_=ord_, card_run_id=card_run_id, card_ord=card_ord, card_text=card_text)
    if conflict:
        label = "gate-state-unknown" if cur.get("known") is False else "gate-state-conflict"
        entry.update(decision="reject-by-abstention", reason=f"{label}: {conflict}",
                     wire_check=f"not clicked — {label} (no POST was made; the run is left as it is)")
        finding(f"{tag}: {label} on run {run_id}: {conflict} — NO click (reject-by-abstention). The card showed "
                f"{shown[:80]!r} (card ord {card_ord}, harness ord {ord_}); the daemon's current gate is ord {cur['ord']} reading "
                f"{(prompt if prompt is not None else '<unreadable>')[:80]!r} ({source})")
        log(f"{tag}: gate on {run_id[:8]} → ABSTAINED ({conflict[:120]})")
        return entry
    decision, reason = gate_decision(prompt, unit)
    entry.update(decision=decision, reason=reason, wire_ok=False)
    if reason.startswith("unknown-gate-kind"):
        finding(f"{tag}: gate ord={ord_} on run {run_id}: the gated unit's stage/gate is unknown — the allow-listed prompt "
                f"('{(prompt or '')[:80]}…') alone does not authorize approving — REJECTED ({reason})")
    elif reason.startswith("unknown-prompt-shape"):
        finding(f"{tag}: gate ord={ord_} on run {run_id}: the prompt ('{(prompt or '')[:80]}…') is not an allow-listed "
                f"shape (pre-execution unit gate / plan approval) — REJECTED ({reason})")
    expected = f"POST {urllib.parse.urlsplit(API).path}/runs/{run_id}/gate"
    try:
        with page.expect_response(lambda r: r.request.method == "POST" and gate_url_matches(r.url, run_id), timeout=60000) as gr:
            card.first.locator(f'[data-testid="steering-{decision}"]').click()
        resp = gr.value
    except Exception as e:  # the SPA posted nothing to THIS run's gate endpoint (or the click failed)
        entry["wire_check"] = f"no {expected} observed within 60s of the {decision} click ({type(e).__name__}: {str(e)[:120]})"
        finding(f"{tag}: gate ord={ord_} on run {run_id} → {decision.upper()} clicked but {entry['wire_check']} — gate-wire-mismatch")
        return entry
    try:
        body = json.loads(resp.request.post_data or "{}")
    except Exception:
        body = {"raw": str(resp.request.post_data)[:200]}
    entry.update(status=resp.status, url=resp.url.replace(BASE, ""), body=body)
    mismatch = gate_wire_check(entry, run_id)
    entry["wire_ok"] = mismatch is None
    entry["wire_check"] = mismatch or f"{expected} for this run, body.approve == {decision == 'approve'}, status {resp.status}"
    log(f"{tag}: gate ord={ord_} on {run_id[:8]} → {decision.upper()} ({reason}) → POST {entry['url']} {resp.status}"
        f"{'' if mismatch else ' (wire verified)'}")
    if mismatch:
        finding(f"{tag}: gate ord={ord_} on run {run_id} → {decision.upper()} clicked but the wire disagrees: {mismatch} — gate-wire-mismatch")
    if decision == "reject":
        finding(f"{tag}: gate ord={ord_} on run {run_id} ('{(prompt if prompt is not None else card_text or '')[:80]}…') was REJECTED by policy ({reason})")
    return entry


def latest_gate_ord(events: list[dict]) -> int | None:
    aw = [e for e in events if e.get("type") == "awaitingHuman"]
    return aw[-1].get("ord") if aw else None


def decide_sibling_gate(page, sid: str, *, tag: str, return_to: str) -> dict:
    """A sibling in `awaiting_human` gets its gate decided THROUGH THE UI: navigate to
    /runs/<sibling id>, wait for `[data-testid="steering-gate"][data-run-id="<id>"]`, decide on the
    COMPLETE CURRENT prompt read from the daemon AFRESH (`decide_gate_on_card` → `current_gate`; the
    events fetched here supply only the harness's own ord and the unit — codex round 7: they are
    never the gate's source) with the gated unit's stage/gate (from GET /runs/:id — read-only),
    click — then navigate back to the launch panel. Never the API."""
    ord_: int | None = None
    unit: dict | None = None
    events: list[dict] | None = None
    lookup_error: str | None = None
    try:
        events = run_events(sid)
        ord_ = latest_gate_ord(events)
        unit = gate_unit(run_detail(sid), ord_)
    except Exception as e:  # a FetchError is already recorded by get(); decide_gate_on_card fails closed on what is missing
        lookup_error = f"{type(e).__name__}: {e}"
    page.goto(f"{BASE}/runs/{enc(sid)}", wait_until="networkidle")
    card = page.locator(f'[data-testid="steering-gate"][data-run-id="{sid}"]')
    try:
        card.first.wait_for(timeout=30000)
    except Exception as e:
        entry = {"ord": ord_, "first": False, "prompt": None, "decision": None, "status": None, "unit": unit,
                 "reason": f"no SteeringGate card rendered on /runs/{sid} within 30s ({type(e).__name__})"}
        finding(f"{tag}: sibling {sid} is awaiting_human per REST but /runs/{sid} rendered no gate card within 30s — left undecided")
    else:
        entry = decide_gate_on_card(page, card, run_id=sid, ord_=ord_, unit=unit, tag=tag, first=False)
    if lookup_error:
        entry["unit_lookup_error"] = lookup_error
    page.goto(return_to, wait_until="networkidle")  # back to the launch panel
    return entry


def follow_siblings(sibling_ids: list[str], max_s: int = SIBLING_FOLLOW_MAX_S, sleep=time.sleep, page=None, *,
                    tag: str = "", return_to: str | None = None, decide=None, rediscover=None,
                    clock=time.time, poll_s: int = 15) -> dict:
    """Follow the attributable siblings to a terminal state, REDISCOVERING the set on every poll:
    `rediscover()` (the scenario's `siblings_now` — runs + campaigns re-listed, `attribute_siblings`
    re-run) may surface a sibling that did not exist when the grace period ended (a sequential
    campaign node launched after its predecessor completed); every newly attributable run joins the
    followed set, has its gates decided THROUGH THE UI like the others (`decide_sibling_gate`) and
    is sampled for its verdict. The follow finishes only when the set has been STABLE for two
    consecutive polls AND every member is terminal; `max_s` elapsing first is recorded as
    `timed_out` (the set is not proven complete — the scenario cannot `pass`). A rediscovery that
    fails is a typed miss (recorded by `get()`) and resets the stability count: an unknown set is
    not a stable set. Returns per-sibling statuses, the gates decided (`gates[sid][]`), which
    siblings were discovered late (`discovered`), the poll/stability counters and the verdicts
    (None = no verdict; a FetchMiss = the fetch FAILED, which is not the same thing)."""
    decide = decide or decide_sibling_gate
    return_to = return_to or f"{BASE}/testing/campaigns"
    started = clock()
    followed: list[str] = list(dict.fromkeys(sibling_ids))
    statuses: dict[str, str] = {}
    gates: dict[str, list[dict]] = {sid: [] for sid in followed}
    discovered: dict[str, dict] = {}
    warned: set[str] = set()
    final_attribution: dict | None = None
    stable = polls = rediscover_errors = 0
    timed_out = False
    while True:
        polls += 1
        before = set(followed)
        unknown_set = False
        if rediscover is not None:
            try:
                final_attribution = rediscover()
                for s in final_attribution.get("attributable_siblings") or []:
                    sid = s.get("id")
                    if sid and sid not in before and sid not in followed:
                        followed.append(sid)
                        gates[sid] = []
                        discovered[sid] = {"poll": polls, "at_s": int(clock() - started), "attributed_by": s.get("attributed_by")}
                        log(f"{tag}: sibling {sid} became attributable on poll {polls} ({s.get('attributed_by')}) — following it too")
            except Exception as e:  # already recorded as a typed fetch miss by get(); the set is unknown this poll
                rediscover_errors += 1
                unknown_set = True
                log(f"{tag}: sibling rediscovery failed on poll {polls}: {e}")
        stable = 0 if unknown_set or set(followed) != before else stable + 1
        for sid in followed:
            try:
                statuses[sid] = run_detail(sid)["session"]["status"]
            except Exception as e:
                statuses[sid] = f"ERR {e}"
                continue
            if statuses[sid] != "awaiting_human":
                continue
            if page is None:
                if sid not in warned:
                    warned.add(sid)
                    finding(f"{tag}: sibling {sid} is awaiting_human but no page was supplied — its gate cannot be decided on the UI")
                continue
            if any(g.get("decision") == "reject-by-abstention" for g in gates[sid]):
                continue  # a gate-state conflict was recorded — never re-decided; the timeout reports the sibling as non-terminal
            if sum(1 for g in gates[sid] if g.get("status") is None) >= 2:
                continue  # its card never rendered twice — stop re-navigating, let the timeout report it
            gates[sid].append(decide(page, sid, tag=tag, return_to=return_to))
        all_terminal = bool(statuses) and all(st in TERMINAL for st in statuses.values())
        if all_terminal and stable >= 2:
            break
        if clock() - started >= max_s:
            timed_out = True
            finding(f"{tag}: sibling follow hit SIBLING_FOLLOW_MAX_S ({max_s}s) after {polls} polls with statuses {statuses} "
                    f"(set stable for {stable} poll{'s' if stable != 1 else ''}) — the attributable set is not proven complete")
            break
        sleep(poll_s)
    return {
        "statuses": statuses,
        "gates": gates,
        "discovered": discovered,
        "polls": polls,
        "stable_polls": stable,
        "rediscover_errors": rediscover_errors,
        "timed_out": timed_out,
        "followed_s": int(clock() - started),
        "all_terminal": bool(statuses) and all(st in TERMINAL for st in statuses.values()),
        "acceptance": {sid: acceptance_verdict(sid) for sid in followed},
        "final_attribution": final_attribution,
    }


def sibling_gate_wire_failures(followed: dict | None) -> list[str]:
    """Every DECIDED sibling gate (`siblings_followed.gates[sid][]`, clicked on `/runs/<sid>` by
    `decide_sibling_gate`) whose wire does not prove the decision, named: `wire_ok` false, a recorded
    url/body/status that fails `gate_wire_check` when re-run offline, or no 2xx status. Undecided
    entries (`decision: None` — the card never rendered) are not wire failures; they keep the sibling
    from `pass` through its non-terminal status. Codex round 4: `derive_result` looked only at the
    parent's `measured.gates`, so a completed, verdict-carrying sibling whose REJECT was wired as
    `{approve: true}` still spelled `{harness_ok: true, result: "pass"}`."""
    out: list[str] = []
    for sid, entries in ((followed or {}).get("gates") or {}).items():
        for g in entries or []:
            if not isinstance(g, dict) or g.get("decision") in (None, "reject-by-abstention"):
                continue  # undecided / abstained: no wire was attempted — `sibling_gate_conflicts` names the abstention
            if g.get("wire_ok") is False:
                problem: str | None = g.get("wire_check") or "wire_ok=false"
            elif g.get("url") is not None:
                problem = gate_wire_check(g, sid)
            else:
                st = g.get("status")
                problem = None if isinstance(st, int) and 200 <= st < 300 else f"status {st!r} is not 2xx"
            if problem:
                out.append(f"sibling {sid} gate ord={g.get('ord')} {g.get('decision')}: {problem}")
    return out


def sibling_gate_conflicts(followed: dict | None) -> list[str]:
    """Every followed sibling gate left UNDECIDED on a gate-state conflict (`reject-by-abstention`
    — the card was not the daemon's current gate, or that gate could not be read; nothing was
    clicked), named with both ords: the same harness failure as the parent's
    (`sibling-gate-state-conflict`, codex round 6)."""
    out: list[str] = []
    for sid, entries in ((followed or {}).get("gates") or {}).items():
        for g in entries or []:
            if isinstance(g, dict) and g.get("decision") == "reject-by-abstention":
                out.append(f"sibling {sid} gate ord={g.get('ord')} (daemon current ord={g.get('current_ord')}): {g.get('reason')}")
    return out


def derive_result(m: dict, blockers: list[str] | None = None) -> dict:
    """The verdict split, as a pure function of the measurements (so the committed report can be
    re-derived offline). `harness_ok`: the harness did its job — launch submitted (after the
    pre-submit preflight) and accepted with run ids, gate rendered on the UI, every gate decision
    posted and wire-verified (the parent's AND every followed sibling's — `gate-wire-mismatch` /
    `sibling-gate-wire-mismatch`), terminal state, no wedge, no blocker. `result`: the FEATURE contract — "pass" REQUIRES
    a completed run whose plan names real files and classifies, PLUS ≥ 1 attributable sibling run
    with EVERY attributable sibling terminal and EVERY one carrying its own acceptance verdict
    (recorded per id in `measured.sibling_verdicts`), PLUS (for the "campaign" intent) a registered
    campaign served by GET /campaigns, and NO evidence-fetch error. Anything less is "fail" with
    `fail_reasons[]` naming the sibling / the fetch; recon completion + text heuristics alone
    never spell "pass"."""
    x = m.get("measured") or {}
    tag, intent = m.get("scenario"), m.get("intent") or "run"
    if m.get("result") == "blocked-preflight":
        return {"harness_ok": False, "result": "blocked-preflight", "fail_reasons": ["preflight never cleared"]}
    hard: list[str] = []
    if x.get("launch_aborted_by_preflight"):
        hard.append("preflight-at-submit")
        hard.append(f"launch not submitted: the pre-submit preflight was blocked by {x['launch_aborted_by_preflight']}")
    elif x.get("launch_answer_unexpected"):
        hard.append(f"launch answer carried neither runIds nor runId: {json.dumps(x.get('launch_answer'), default=str)[:120]}")
    st = x.get("post_status")
    if not x.get("launch_aborted_by_preflight") and not (isinstance(st, int) and 200 <= st < 300 and x.get("run_ids")):
        hard.append(f"launch not accepted (POST /testing/recon → {st})")
    if not (x.get("gate_on_panel_card") or x.get("gate_via_run_page_fallback")):
        hard.append("no gate card rendered on the UI")
    gates = x.get("gates") or []
    if not gates:
        hard.append("no gate was answered")
    elif any(g.get("decision") != "reject-by-abstention" and (not isinstance(g.get("status"), int) or g["status"] >= 300) for g in gates):
        hard.append("a gate decision did not post")
    # A gate left UNDECIDED on a gate-state conflict (`reject-by-abstention`: the card was not the
    # daemon's current gate, or that gate could not be read — nothing was clicked, by design) is a
    # harness failure all the same: the run was not brought to a decision the harness can vouch for.
    abstained = [g for g in gates if g.get("decision") == "reject-by-abstention"]
    if abstained:
        hard += sorted({abstention_label(g) for g in abstained})  # `gate-state-conflict` and/or `gate-state-unknown` (round 7)
        hard += [f"gate ord={g.get('ord')} (daemon current ord={g.get('current_ord')}): {g.get('reason')}" for g in abstained]
    # The wire check (`gate_wire_check`): a recorded gate whose POST did not go to THIS run's gate
    # endpoint with `approve` == the decision and a 2xx is not evidence the decision was taken.
    # Entries without the field predate the check (the three recorded runs are re-checked offline).
    bad_wire = [g for g in gates if g.get("wire_ok") is False]
    if bad_wire:
        hard.append("gate-wire-mismatch")
        hard += [f"gate ord={g.get('ord')} {g.get('decision')}: {g.get('wire_check')}" for g in bad_wire]
    # The siblings' gates are decided on the UI and wire-checked exactly like the parent's — a sibling
    # gate whose POST did not prove the decision is the same harness failure (round 4).
    followed = x.get("siblings_followed") or {}
    bad_sibling_wire = sibling_gate_wire_failures(followed)
    if bad_sibling_wire:
        hard.append("sibling-gate-wire-mismatch")
        hard += bad_sibling_wire
    sibling_conflicts = sibling_gate_conflicts(followed)
    if sibling_conflicts:
        labels = {abstention_label(g) for entries in (followed.get("gates") or {}).values() for g in entries or []
                  if isinstance(g, dict) and g.get("decision") == "reject-by-abstention"}
        hard += [f"sibling-{label}" for label in sorted(labels)]  # `sibling-gate-state-conflict` / `sibling-gate-state-unknown`
        hard += sibling_conflicts
    if x.get("wedged"):
        hard.append(f"run wedged (no events for {WEDGE_S // 60} min)")
    if x.get("final_status") not in TERMINAL:
        hard.append(f"run not terminal (status={x.get('final_status')})")
    if tag:
        hard += [f"blocker: {b}" for b in (blockers or []) if b.startswith(f"preflight never cleared for {tag}") or f"{tag}:" in b]
    harness_ok = not hard
    fail = list(hard)
    if x.get("final_status") != "completed":
        fail.append(f"run ended {x.get('final_status')}, not completed")
    fetch_errors = x.get("fetch_errors") or []
    if fetch_errors:
        fail.append(f"{len(fetch_errors)} evidence fetch error(s) — infrastructure, not feature: "
                    + "; ".join(f"GET {e.get('endpoint')} → {e.get('status')}" for e in fetch_errors[:5]))
    plan = x.get("plan") or {}
    if not plan.get("names_real_files"):
        fail.append("plan names fewer than 3 real files or proposes no scenario")
    if not plan.get("classifies"):
        fail.append("plan does not classify deterministic tool checks vs governed agent runs")
    after = x.get("siblings_after_grace") or x.get("siblings_at_terminal") or {}
    sibs = after.get("attributable_siblings") or []
    statuses = followed.get("statuses") or {}
    discovered = followed.get("discovered") or {}
    # The attributable set is everything attributed after the grace period PLUS everything the
    # follow rediscovered later — a sibling that appeared on poll 7 is judged like the others.
    sib_ids = list(dict.fromkeys([s.get("id") for s in sibs if s.get("id")] + list(statuses)))
    if not sib_ids:
        fail.append(f"no attributable sibling runs after the approved {intent} completed — the approved plan was never executed"
                    f" ({len(after.get('unrelated_new_runs') or [])} unrelated new runs ignored)")
    else:
        verdicts = followed.get("acceptance") or {}
        sibling_verdicts: dict[str, dict] = {}
        for sid in sib_ids:
            st_s = statuses.get(sid)
            v = verdicts.get(sid)
            ok_v = isinstance(v, str) and bool(v)
            sibling_verdicts[sid] = {"status": st_s, "verdict": v if ok_v else None,
                                     "verdict_fetch_error": v if isinstance(v, dict) else None,
                                     "discovered_late": sid in discovered}
            if st_s not in TERMINAL:
                fail.append(f"sibling {sid} did not reach a terminal state (status={st_s})")
            if not ok_v:
                fail.append(f"sibling {sid} carries no acceptance verdict" + (f" (the fetch failed: {v.get('status')})" if isinstance(v, dict) else ""))
        if followed.get("timed_out"):
            fail.append(f"the sibling follow hit SIBLING_FOLLOW_MAX_S after {followed.get('followed_s')}s before the attributable set "
                        f"was stable and terminal (stable_polls={followed.get('stable_polls')}) — the set is not proven complete")
        if not followed.get("all_terminal"):
            if not any(r.startswith("sibling ") and "terminal" in r for r in fail):
                fail.append("not every attributable sibling reached a terminal state (all_terminal=false)")
        x["sibling_verdicts"] = sibling_verdicts
    if intent == "campaign":
        if not x.get("campaign_registered"):
            fail.append(f"no engine campaign registered for label {x.get('campaign_label')} (campaignRegistered=false)")
        elif not after.get("campaign_for_label"):
            fail.append(f"campaign label {x.get('campaign_label')} is not served by GET /campaigns")
    result = "wedged" if x.get("wedged") else ("pass" if not fail else "fail")
    return {"harness_ok": harness_ok, "result": result, "fail_reasons": fail}


# ── The UI-driven governed intake ─────────────────────────────────────────────────────────────


def parse_post_body(post_data: str | bytes | None, tag: str) -> dict:
    """The launch request's body, for the report: the parsed JSON object — or, when Playwright hands
    back an empty / non-JSON body or a JSON value that is not an object (Copilot, round 4),
    `{"raw": <first 500 chars>, "parse_error": …}` plus a finding. The harness CONTINUES: the body is
    evidence to record, not control flow (`json.loads` raising here crashed the scenario unrecorded)."""
    raw = post_data.decode("utf-8", "replace") if isinstance(post_data, bytes) else (post_data or "")
    try:
        body = json.loads(raw or "{}")
    except json.JSONDecodeError as e:
        finding(f"{tag}: the launch POST body was not JSON ({e}) — recorded raw (first 500 chars), not parsed")
        return {"raw": raw[:500], "parse_error": str(e)}
    if not isinstance(body, dict):
        finding(f"{tag}: the launch POST body parsed as {type(body).__name__}, not a JSON object — recorded raw")
        return {"raw": raw[:500], "parse_error": f"not a JSON object ({type(body).__name__})"}
    return body


def launched_run_ids(answer: object) -> list[str]:
    """The run ids in a /testing/recon answer — `runIds[]` or the single `runId` — and [] for any
    other shape (studio's own `launchedRunIds()` in src/api/testing.ts allows the empty case)."""
    if not isinstance(answer, dict):
        return []
    ids = answer.get("runIds")
    if isinstance(ids, list) and ids:
        return [r for r in ids if isinstance(r, str) and r]
    rid = answer.get("runId")
    return [rid] if isinstance(rid, str) and rid else []


def drive_intake(tag: str, intent: str) -> dict:
    """Runs one governed intake through the studio UI and returns the measurements. Fetch errors
    during the scenario land in ITS `measured.fetch_errors[]`; the launch reservation is released
    on every exit path."""
    m: dict = {"scenario": tag, "intent": intent, "result": "not-run", "harness_ok": False, "fail_reasons": [], "measured": {}, "notes": []}
    REPORT["scenarios"][tag] = m
    set_fetch_sink(m["measured"].setdefault("fetch_errors", []))
    lock = LaunchLock()
    REPORT["launch_lock"] = lock.describe()  # the reservation's (scrubbed) path, scope and daemon origin — codex round 7
    try:
        return _drive_intake(tag, intent, m, lock)
    finally:
        lock.release()
        set_fetch_sink(None)


def _drive_intake(tag: str, intent: str, m: dict, lock: LaunchLock) -> dict:
    from playwright.sync_api import sync_playwright

    verb = "testing-recon-open" if intent == "recon" else "testing-campaign-open"
    if not preflight(tag):
        m["result"] = "blocked-preflight"
        m.update(derive_result(m, REPORT["blockers"]))
        return m

    runs_before = {r["session"]["id"] for r in list_runs()}
    camps_before = {c["id"] for c in list_campaigns()}
    ws_frames: list[dict] = []
    console_errors: list[str] = []
    shots: list[str] = []

    def shot(page, name: str) -> None:
        # Playwright hands back the PNG bytes when no `path` is given — the file lands through the
        # dir-fd-anchored writer like every other artifact; Playwright never writes a path itself.
        p = write_artifact(f"{tag}-{name}.png", page.screenshot(full_page=True))
        shots.append(str(p.relative_to(ROOT)))

    def on_ws(ws):
        ws.on("framereceived", lambda payload: ws_frames.append(
            json.loads(payload) if isinstance(payload, str) and payload.startswith("{") else {"type": "<non-json>"}))

    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("websocket", on_ws)
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.goto(f"{BASE}/testing/campaigns", wait_until="networkidle")
        page.locator('[data-testid="campaigns-page"]').wait_for(timeout=30000)
        landing_text_before = page.inner_text("body")
        m["measured"]["landing_before"] = {
            "campaign_cards": page.locator('[data-testid="campaign-card"]').count(),
            "empty_state": page.locator('[data-testid="campaigns-empty"]').count() > 0,
            "campaign_word_count": len(re.findall(r"campaign", landing_text_before, re.I)),
        }
        shot(page, "01-landing-before")

        # The verb → the launch panel with this intent.
        page.locator(f'[data-testid="{verb}"]').click()
        panel = page.locator(f'[data-testid="testing-launch-panel"][data-intent="{intent}"]')
        panel.wait_for(timeout=10000)
        panel.locator('[data-testid="testing-launch-instructions"]').fill(INSTRUCTION)
        panel.locator('[data-testid="testing-launch-repo-search"]').fill(TARGET_REPO)
        panel.locator(f'[data-testid="testing-launch-repo-option"][data-repo="{TARGET_REPO}"]').click()
        panel.locator(f'[data-testid="testing-launch-chip"][data-repo="{TARGET_REPO}"][data-source="explicit"]').wait_for(timeout=5000)
        shot(page, "02-panel-filled")

        # ── Reserve the launch, then re-run the preflight at the last possible moment ───────
        # The minutes spent starting the browser, picking the repo and taking screenshots are a
        # window another run can start in; the flock — keyed by the DAEMON origin, shared by every
        # worktree aiming at it (round 7) — stops a second harness process from clearing its own
        # preflight in that window. Held until the intake gate has been decided.
        lock.acquire()
        m["measured"]["launch_lock"] = lock.describe()
        why = preflight_at_submit(tag)
        if why:
            m["measured"]["launch_aborted_by_preflight"] = why
            m["notes"].append(f"launch NOT submitted — the pre-submit preflight was blocked by {why}")
            shot(page, "03-launch-aborted-by-preflight")
            browser.close()
            m["screenshots"] = shots
            m.update(derive_result(m, REPORT["blockers"]))
            return m

        # Submit — capture the exact wire body and answer.
        with page.expect_response(lambda r: "/testing/recon" in r.url and r.request.method == "POST", timeout=120000) as resp_info:
            panel.locator('[data-testid="testing-launch-submit"]').click()
        resp = resp_info.value
        post_body = parse_post_body(resp.request.post_data, tag)  # a non-JSON body is recorded raw, never a crash
        answer = resp.json() if resp.ok else {"status": resp.status, "text": resp.text()[:500]}
        t_launch = time.time()
        m["measured"]["post_body"] = post_body
        m["measured"]["post_status"] = resp.status
        m["measured"]["launch_answer"] = answer
        if not resp.ok:
            m["notes"].append(f"launch refused: {resp.status} {answer}")
            shot(page, "03-launch-refused")
            browser.close()
            m["screenshots"] = shots
            m.update(derive_result(m, REPORT["blockers"]))
            return m
        # An answer with neither `runIds` nor `runId` is a RECORDED launch failure, not an IndexError.
        run_ids = launched_run_ids(answer)
        if not run_ids:
            m["measured"]["launch_answer_unexpected"] = True
            m["measured"]["run_ids"] = []
            m["notes"].append(f"launch answer carried neither runIds nor runId: {json.dumps(answer, default=str)[:200]}")
            shot(page, "03-launch-answer-unexpected")
            browser.close()
            m["screenshots"] = shots
            m.update(derive_result(m, REPORT["blockers"]))
            return m
        run_id = run_ids[0]
        campaign_label = answer.get("campaign")
        m["measured"]["run_ids"] = run_ids
        m["measured"]["campaign_label"] = campaign_label
        m["measured"]["campaign_registered"] = answer.get("campaignRegistered")
        log(f"{tag}: launched {run_ids} campaign={campaign_label}")

        # ── Wait for the intake gate on the panel's card (WS-fed) ───────────────────────────
        card = panel.locator(f'[data-testid="steering-gate"][data-run-id="{run_id}"]')
        gate_seen_ui = False
        gate_seen_rest_at: float | None = None
        fallback_run_page = False
        deadline = time.time() + GATE_TIMEOUT_S
        status = None
        while time.time() < deadline:
            if card.count() > 0:
                gate_seen_ui = True
                break
            try:
                status = run_detail(run_id)["session"]["status"]
            except Exception as e:
                m["notes"].append(f"run_detail error while waiting for gate: {e}")
                status = None
            if status in TERMINAL:
                break
            if status == "awaiting_human":
                gate_seen_rest_at = gate_seen_rest_at or time.time()
                # The REST side says gated; give the panel's WS fold 60 s, then fall back to the run page.
                if time.time() - gate_seen_rest_at > 60:
                    finding(f"{tag}: run {run_id} is awaiting_human per REST but the launch panel never rendered its SteeringGate card within 60s — falling back to /runs/:id")
                    page.goto(f"{BASE}/runs/{urllib.parse.quote(run_id, safe='')}", wait_until="networkidle")
                    card = page.locator(f'[data-testid="steering-gate"][data-run-id="{run_id}"]')
                    fallback_run_page = True
                    try:
                        card.first.wait_for(timeout=30000)
                        gate_seen_ui = True
                    except Exception:
                        pass
                    break
            page.wait_for_timeout(5000)
        t_gate = time.time()
        events = run_events(run_id)
        units = planned_units(events)
        awaiting = [e for e in events if e.get("type") == "awaitingHuman"]
        ws_awaiting = [f for f in ws_frames if f.get("type") == "awaitingHuman" and f.get("session") == run_id]
        m["measured"]["units_planned"] = len(units)
        m["measured"]["units"] = units
        m["measured"]["launch_to_gate_s"] = int(t_gate - t_launch)
        m["measured"]["gate_on_panel_card"] = gate_seen_ui and not fallback_run_page
        m["measured"]["gate_via_run_page_fallback"] = fallback_run_page
        m["measured"]["awaitingHuman_over_ws"] = len(ws_awaiting)
        m["measured"]["event_types_before_gate"] = sorted({e.get("type", "?") for e in events})
        if len(units) != 1:
            finding(f"{tag}: the launch planned {len(units)} units from the UI's prefix + one-sentence brief (product intent is 1 — core#393): {[u['description'][:70] for u in units]}")
        if not gate_seen_ui:
            m["notes"].append(f"no gate card appeared within {GATE_TIMEOUT_S // 60} min (status={status})")
            m["measured"]["final_status"] = status
            shot(page, "03-no-gate")
            browser.close()
            m["screenshots"] = shots
            m.update(derive_result(m, REPORT["blockers"]))
            return m

        prompt = card.first.locator('[data-testid="steering-prompt"]').inner_text()  # the card's headline (cleanPrompt) — the click surface
        raw_prompt = awaiting[0].get("prompt") if awaiting else None  # the awaitingHuman event's verbatim prompt
        m["measured"]["gate"] = {
            "ord": awaiting[0].get("ord") if awaiting else None,
            "prompt_ui": prompt,
            "prompt_raw_len": len(raw_prompt) if raw_prompt else None,
            "pre_execution": bool(re.match(r"Approve unit \d+ before it runs", raw_prompt or prompt)),
            "contains_plan": bool(re.search(r"scenario\s*\d|S-\d|\bplan:\s", raw_prompt or prompt, re.I)) and "before it runs" not in (raw_prompt or prompt),
            "events_before_gate": [e.get("type") for e in events if e.get("seq", 0) <= (awaiting[0].get("seq", 0) if awaiting else 0)],
        }
        if m["measured"]["gate"]["pre_execution"]:
            finding(f"{tag}: the ONLY human gate is pre-execution ('{prompt[:60]}…') — the operator approves the survey, not a plan (crew#473)")
        shot(page, "03-gate-card")

        # ── Decide the FIRST gate through the UI card — same policy as every later gate, on the
        # COMPLETE prompt from the daemon (decide_gate_on_card → full_gate_prompt), never the card ──
        gates: list[dict] = []
        m["measured"]["gates"] = gates
        gate_ord = awaiting[0].get("ord") if awaiting else None
        try:
            unit = gate_unit(run_detail(run_id), gate_ord)
        except Exception as e:  # recorded as a fetch error; an unknown kind fails closed in gate_decision
            unit = None
            m["notes"].append(f"could not read the gated unit's stage/gate: {e}")
        m["measured"]["gate"]["unit"] = unit
        entry = decide_gate_on_card(page, card, run_id=run_id, ord_=gate_ord, unit=unit, tag=tag, first=True, card_text=prompt)
        gates.append(entry)
        decision = entry["decision"]
        abstained = decision == "reject-by-abstention"  # gate-state conflict: nothing was clicked; the run is not followed
        m["measured"]["gate_response"] = {k: entry[k] for k in ("decision", "status", "body", "url")}
        t_approve = time.time()  # the first gate's decision time (approve in every recorded run)
        lock.release()  # the intake gate is decided (or deliberately left alone) — the launch reservation ends here
        if decision == "approve" and not fallback_run_page:
            try:
                panel.locator('[data-testid="testing-launch-resolved"]').wait_for(timeout=15000)
                m["measured"]["panel_resolved_copy"] = panel.locator('[data-testid="testing-launch-resolved"]').inner_text()
            except Exception:
                m["notes"].append("panel never showed testing-launch-resolved after approve")
        shot(page, "04-after-approve")

        # ── Wait for terminal state; handle any further gates; detect wedges ────────────────
        last_seq = max((e.get("seq", 0) for e in events), default=0)
        last_change = time.time()
        wedged = False
        deadline = time.time() + RUN_TIMEOUT_S
        final_status = None
        if abstained:
            # The card was not the daemon's current gate (or that gate could not be read): nothing was
            # clicked and nothing more is done to this run — it is reported, not followed to terminal.
            m["measured"]["gate_abstained"] = True
            finding(f"{tag}: the intake gate on run {run_id} was left UNDECIDED ({abstention_label(entry)}) — the harness does not follow a run it must not touch")
            try:
                final_status = run_detail(run_id)["session"]["status"]
            except Exception as e:
                m["notes"].append(f"status read after the abstention failed: {e}")
        while not abstained and time.time() < deadline:
            page.wait_for_timeout(10000)
            try:
                d = run_detail(run_id)
                final_status = d["session"]["status"]
                evs = run_events(run_id)
            except Exception as e:
                m["notes"].append(f"poll error: {e}")
                continue
            seq = max((e.get("seq", 0) for e in evs), default=0)
            if seq != last_seq:
                last_seq, last_change = seq, time.time()
            if final_status in TERMINAL:
                break
            if final_status == "awaiting_human":
                # A later gate. Find its card wherever the SPA renders it (the run page).
                aw = [e for e in evs if e.get("type") == "awaitingHuman"]
                g = aw[-1] if aw else {}
                page.goto(f"{BASE}/runs/{enc(run_id)}", wait_until="networkidle")
                c2 = page.locator(f'[data-testid="steering-gate"][data-run-id="{run_id}"]')
                try:
                    c2.first.wait_for(timeout=30000)
                    ptxt = c2.first.locator('[data-testid="steering-prompt"]').inner_text() or ""
                except Exception:
                    m["notes"].append("later gate present per REST but no card on the run page")
                    continue
                # Same policy as the first gate — the allow-list (shape + known non-delivery kind +
                # no delivery verb anywhere in the COMPLETE prompt, read from the daemon inside
                # decide_gate_on_card; `ptxt` is only the card's headline), failing closed: an
                # "Approve proposed test plan…" gate whose body lists /runs/:id/deliver among the
                # routes to test is REJECTED and recorded as a finding, never approved on its first
                # clause or on a clean headline. The capture is named by ord; `gates[]` carries the decision.
                unit2 = gate_unit(d, g.get("ord"))
                shot(page, f"05-gate-{g.get('ord', 'x')}")
                later = decide_gate_on_card(page, c2, run_id=run_id, ord_=g.get("ord"), unit=unit2, tag=tag, first=False, card_text=ptxt)
                gates.append(later)
                if later["decision"] == "reject-by-abstention":
                    m["measured"]["gate_abstained"] = True
                    finding(f"{tag}: run {run_id} left at its gate (daemon current ord {later.get('current_ord')}) UNDECIDED "
                            f"({abstention_label(later)}) — the harness stops following it")
                    break
                last_change = time.time()
                continue
            if time.time() - last_change > WEDGE_S:
                wedged = True
                finding(f"{tag}: run {run_id} produced no new events for {WEDGE_S // 60} min while {final_status} — WEDGED (not killed)")
                break
        t_end = time.time()
        m["measured"]["gates_seen"] = len(gates)
        m["measured"]["final_status"] = final_status
        m["measured"]["wedged"] = wedged
        m["measured"]["approve_to_terminal_s"] = int(t_end - t_approve)
        m["measured"]["total_s"] = int(t_end - t0)
        if final_status not in TERMINAL:
            m["notes"].append(f"run not terminal after {RUN_TIMEOUT_S // 60} min (status={final_status})")

        # ── The run's units and outputs — the plan ─────────────────────────────────────────
        d = run_detail(run_id)
        m["measured"]["session"] = {k: d["session"].get(k) for k in ("status", "workflow_id", "repo_ref", "created_at", "human_confirm", "delivery", "unit_ix")}
        m["measured"]["unit_statuses"] = [(u["ord"], u["status"], u["gate"], u.get("stage")) for u in d.get("units", [])]
        # ABSENT evidence (2xx, no output → `missing_outputs`) and FAILED fetches (non-2xx /
        # transport → `failed_fetches`, also in fetch_errors[]) are different facts and stay apart.
        outputs: dict[int, str] = {}
        missing_outputs: list[int] = []
        failed_fetches: list[dict] = []
        for u in d.get("units", []):
            o = unit_output(run_id, u["ord"])
            if isinstance(o, FetchMiss):
                failed_fetches.append({"ord": u["ord"], **o})
            elif o is None:
                missing_outputs.append(u["ord"])
            else:
                outputs[u["ord"]] = o
        # Each unit's output is committed VERBATIM from GET /runs/:id/units/:ord/output (after
        # scrub) with its length, so a truncated or mid-sentence ending is attributable to the
        # daemon's captured output, not to this harness.
        # Scrubbed BEFORE analysis so a seat's toolchain listing is neither committed nor counted as
        # plan content (`…/wicked-testing-scenario-executor/SKILL.md` would read as a scenario line).
        plan_text = scrub("\n\n".join(
            f"## unit {k}\n\n_verbatim from `GET /runs/:id/units/{k}/output` — {len(v)} chars_\n\n{v}"
            for k, v in sorted(outputs.items())
        ))
        plan_path = write_artifact(f"{tag}-plan-{safe_name(run_id)}.md",
                                   scrub(f"# {tag} — run {run_id} ({intent})\n\nPOST body:\n```json\n{json.dumps(post_body, indent=1)}\n```\n\n{plan_text}\n"))
        m["measured"]["plan_file"] = str(plan_path.relative_to(ROOT))
        m["measured"]["units_with_output"] = sorted(outputs)
        m["measured"]["missing_outputs"] = missing_outputs
        m["measured"]["failed_fetches"] = failed_fetches
        m["measured"]["plan"] = analyze_plan(plan_text) if plan_text else {
            "chars": 0, "names_real_files": False, "classifies": False, "scenario_lines": [], "scenario_ids": [],
            "surfaces": {k: False for k in SURFACE_RES}}
        evs = run_events(run_id)
        m["measured"]["event_type_counts"] = {t: sum(1 for e in evs if e.get("type") == t) for t in sorted({e.get("type", "?") for e in evs})}
        m["measured"]["acceptance"] = acceptance(run_id)
        if m["measured"]["session"]["created_at"] is None:
            finding(f"{tag}: run {run_id} has created_at=null on GET /runs/:id (run-timing not recorded)")

        # ── Siblings / campaign / verdicts — immediately, after a grace period, then followed ──
        def siblings_now() -> dict:
            rs = list_runs()
            cs = list_campaigns()
            attributed = attribute_siblings(rs, cs, before=runs_before, own=run_ids, label=campaign_label)
            mine = [c for c in cs if campaign_label and c["id"] == campaign_label]
            return {
                **attributed,
                "new_campaigns": [c["id"] for c in cs if c["id"] not in camps_before],
                "campaign_for_label": [{"id": c["id"], "status": c["status"], "node_status": c.get("node_status"), "attached_runs": c.get("attached_runs")} for c in mine],
                "sibling_acceptance": {s["id"]: acceptance_verdict(s["id"]) for s in attributed["attributable_siblings"]},
            }
        m["measured"]["siblings_at_terminal"] = siblings_now()
        log(f"{tag}: waiting {SIBLING_GRACE_S}s grace for delayed siblings")
        page.wait_for_timeout(SIBLING_GRACE_S * 1000)  # the first check; attributable siblings are then FOLLOWED
        m["measured"]["siblings_after_grace"] = siblings_now()
        sib = m["measured"]["siblings_after_grace"]
        if sib["attributable_siblings"]:
            ids = [s["id"] for s in sib["attributable_siblings"]]
            log(f"{tag}: following {len(ids)} attributable sibling(s) to terminal (max {SIBLING_FOLLOW_MAX_S}s), rediscovering on every poll")
            # Followed WITH the page: a sibling that raises a gate gets it decided on /runs/<id>
            # (never the API), and the browser returns to the launch panel afterwards. The set is
            # rediscovered on every poll (`siblings_now`) so a node launched after its predecessor
            # completed is followed too; the follow ends only on a stable, all-terminal set.
            m["measured"]["siblings_followed"] = follow_siblings(ids, page=page, tag=tag, return_to=f"{BASE}/testing/campaigns",
                                                                 rediscover=siblings_now)
        else:
            finding(f"{tag}: NO attributable sibling runs were launched after the approved {intent} completed "
                    f"(attributable: 0, unrelated new runs: {len(sib['unrelated_new_runs'])}, campaigns for label {campaign_label}: "
                    f"{len(sib['campaign_for_label'])}) — the plan is never executed (crew#473)")

        # ── LT-5: the operator's view after the run ────────────────────────────────────────
        page.goto(f"{BASE}/runs/{urllib.parse.quote(run_id, safe='')}", wait_until="networkidle")
        page.wait_for_timeout(1500)
        shot(page, "06-run-page")
        page.goto(f"{BASE}/testing/campaigns", wait_until="networkidle")
        page.locator('[data-testid="campaigns-page"]').wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        text_after = page.inner_text("body")
        cards = page.locator('[data-testid="campaign-card"]')
        card_texts = [cards.nth(i).inner_text()[:300] for i in range(min(cards.count(), 12))]
        m["measured"]["landing_after"] = {
            "campaign_cards": cards.count(),
            "empty_state": page.locator('[data-testid="campaigns-empty"]').count() > 0,
            "campaign_word_count": len(re.findall(r"campaign", text_after, re.I)),
            "campaign_words": sorted(set(re.findall(r"[^\n]{0,40}campaign[^\n]{0,40}", text_after, re.I)))[:12],
            "mentions_this_run": run_id[:8] in text_after,
            "mentions_label": bool(campaign_label and campaign_label in text_after),
            "card_texts": card_texts,
        }
        shot(page, "07-landing-after")
        if campaign_label:
            page.goto(f"{BASE}/testing/campaigns/{urllib.parse.quote(campaign_label, safe='')}", wait_until="networkidle")
            page.wait_for_timeout(2500)
            m["measured"]["scoreboard"] = {
                "scoreboard": page.locator('[data-testid="campaign-scoreboard"]').count() > 0,
                "notfound": page.locator('[data-testid="campaign-notfound"]').count() > 0,
                "text": page.inner_text("body")[:600],
            }
            shot(page, "08-scoreboard")
        m["measured"]["console_errors"] = console_errors[:10]
        m["measured"]["ws_frame_types"] = sorted({f.get("type", "?") for f in ws_frames})
        browser.close()

    m["screenshots"] = shots
    m.update(derive_result(m, REPORT["blockers"]))
    if m["harness_ok"] and m["result"] == "fail" and not sib["attributable_siblings"]:
        m["notes"].append(f"the {intent} produced a plan but launched no sibling runs — the feature's copy promises otherwise")
    m["notes"] = [n for n in m["notes"] if n]
    return m


# ── LT-3 / LT-4 analysis over the captured plans ──────────────────────────────────────────────


def _canon(plan: dict) -> set[str]:
    if "canonical_files" in plan:
        return set(plan["canonical_files"])
    return set(canonical_files(plan.get("real_files", []), plan.get("real_basenames", []), repo_files()))


def consistency(a: dict, b: dict) -> dict:
    pa, pb = a.get("measured", {}).get("plan", {}), b.get("measured", {}).get("plan", {})
    fa, fb = _canon(pa), _canon(pb)  # Jaccard over canonical file identities only
    ta = {norm_title(s) for s in pa.get("scenario_lines", [])}
    tb = {norm_title(s) for s in pb.get("scenario_lines", [])}
    ia, ib = set(pa.get("scenario_ids", [])), set(pb.get("scenario_ids", []))
    return {
        "files_overlap_pct": jaccard(fa, fb), "files_only_a": sorted(fa - fb), "files_only_b": sorted(fb - fa), "files_common": sorted(fa & fb),
        "scenario_ids_overlap_pct": jaccard(ia, ib), "ids_a": sorted(ia), "ids_b": sorted(ib),
        "scenario_titles_overlap_pct": jaccard(ta, tb), "titles_a": len(ta), "titles_b": len(tb),
        "units_planned": [a.get("measured", {}).get("units_planned"), b.get("measured", {}).get("units_planned")],
        "surfaces": [pa.get("surfaces"), pb.get("surfaces")],
    }


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_-]")


def safe_name(run_id: str) -> str:
    """A daemon-provided id as a file-name component: `[A-Za-z0-9_-]` only — anything else (`/`,
    `:`, `.`, `..`, whitespace) becomes `_` — and the result is REFUSED (SystemExit) when it is
    empty, starts with `.`, or keeps no alphanumeric character (an id of nothing but separators)."""
    name = SAFE_NAME_RE.sub("_", run_id or "")
    if not name or name.startswith(".") or not re.search(r"[A-Za-z0-9]", name):
        raise SystemExit(f"refusing to derive an artifact name from run id {run_id!r} (→ {name!r})")
    return name


def _anchor(root: Path) -> Path:
    """Where the trusted descriptor walk starts: the repo root when `root` lives under it (so every
    component of `e2e/artifacts/test-feature-live` is opened no-follow — ROOT itself is already
    resolved), else the root's parent (a temp dir in the self-test: `/tmp` and `/var` are
    themselves symlinks on macOS, and the anchor is the one path that IS trusted)."""
    return ROOT if root == ROOT or ROOT in root.parents else root.parent


def open_anchor(anchor: Path) -> int:
    """The TRUSTED starting descriptor — `anchor` opened `O_RDONLY | O_DIRECTORY` by pathname, the
    only pathname open the artifact layer makes (the resolved repo root for the real ART). Every
    component below it is reached RELATIVE to a descriptor, never by pathname."""
    try:
        return os.open(str(anchor), os.O_RDONLY | os.O_DIRECTORY)
    except OSError as e:
        raise SystemExit(f"{anchor} (the trusted anchor of the artifact walk) could not be opened as a directory "
                         f"({type(e).__name__}: {e}) — refusing to write under it") from e


def open_dir_nofollow(name: str, dir_fd: int, shown: Path) -> int:
    """Open ONE directory component `name` RELATIVE to the trusted descriptor `dir_fd` —
    `os.open(name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW, dir_fd=dir_fd)` — so the kernel refuses a
    symlink (ELOOP) or a non-directory (ENOTDIR) at exactly this step, whenever it was planted:
    nothing is resolved by pathname, so nothing can be swapped underneath a check. A missing
    component raises `FileNotFoundError` (the walk decides whether to create it); any other failure
    is a named refusal (`shown` is the component's path, for the message only)."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        return os.open(name, flags, dir_fd=dir_fd)
    except FileNotFoundError:
        raise
    except OSError as e:  # ELOOP: a symlink; ENOTDIR: a file; EACCES …
        raise SystemExit(f"{shown} is a symlink or not a directory — it could not be opened without following a link "
                         f"({type(e).__name__}: {e}); refusing to write through it") from e


def walk_dir(anchor: Path, parts: tuple[str, ...] | list[str], *, create: bool, mode: int = 0o755) -> int:
    """Descend from the trusted `anchor` through `parts`, one no-follow relative open per component
    (`open_dir_nofollow`), creating a missing component with `os.mkdir(name, mode, dir_fd=parent_fd)`
    when `create` (`mode` 0o755 for the evidence dir, 0o700 for the per-user lock dir) and then
    re-opening it the same no-follow way (a link raced in between the ENOENT and the mkdir makes the
    mkdir EEXIST and the re-open ELOOP — refused, never followed). Returns the descriptor of the
    LAST component; every intermediate descriptor is closed. A refusal anywhere closes what was
    opened and raises `SystemExit` naming the component."""
    fd = open_anchor(anchor)
    shown = anchor
    try:
        for part in parts:
            shown = shown / part
            try:
                nxt = open_dir_nofollow(part, fd, shown)
            except FileNotFoundError:
                if not create:
                    raise SystemExit(f"{shown} does not exist — refusing to write under it") from None
                try:
                    os.mkdir(part, mode, dir_fd=fd)
                except FileExistsError:
                    pass  # whatever appeared in between is judged by the no-follow re-open below
                try:
                    nxt = open_dir_nofollow(part, fd, shown)
                except FileNotFoundError:
                    raise SystemExit(f"{shown} vanished between its creation and its open — refusing to write under it") from None
            os.close(fd)
            fd = nxt
    except BaseException:
        os.close(fd)
        raise
    return fd


def _rel_parts(root: Path, anchor: Path) -> tuple[str, ...]:
    try:
        return root.relative_to(anchor).parts
    except ValueError:
        raise SystemExit(f"{root} is not under {anchor} — refusing to write it") from None


def open_artifact_root(root: Path | None = None, base: Path | None = None, *, create: bool = True, mode: int = 0o755) -> int:
    """THE trusted descriptor for the evidence dir: `base` (default `_anchor(root)` — the resolved
    repo root for the real ART) opened once, then every component of `root` below it opened
    no-follow RELATIVE to the previous descriptor (`walk_dir`; created where missing when
    `create`). Returns the descriptor of `root` itself — the caller creates, writes and renames ON
    it (`dir_fd=`) and closes it. Re-walked on every use: there is no pathname to re-resolve and no
    window between a validation and a use (codex round 6: `O_NOFOLLOW` on a pathname open protects
    only the final component; an ancestor — `e2e/artifacts` — swapped for a link after validation
    redirected both the open and the `lstat` to the same outside directory, so the identity check
    passed and the write escaped)."""
    root = root or ART
    anchor = base or _anchor(root)
    return walk_dir(anchor, _rel_parts(root, anchor), create=create, mode=mode)


def ensure_artifact_root(root: Path | None = None, base: Path | None = None) -> Path:
    """Create the evidence dir through the descriptor walk (`open_artifact_root`, `create=True`) —
    every component of it below `base` opened no-follow, created where missing — and close the
    descriptor. A symlinked component refuses BEFORE anything is created, so startup can never
    plant `test-feature-live/` outside the repository (codex round 4: `main()` called
    `ART.mkdir(parents=True)` first; round 6: no pathname `mkdir` remains anywhere)."""
    root = root or ART
    os.close(open_artifact_root(root, base, create=True))
    return root


def _artifact_parts(name: str, root: Path) -> tuple[str, ...]:
    """`name` as path components under `root`: relative, non-empty, no `.`/`..`/empty component."""
    p = Path(name)
    if p.is_absolute() or not p.parts or any(part in {"", ".", ".."} for part in p.parts):
        raise SystemExit(f"artifact path {root / name} is not under {root} — refusing to write it")
    return p.parts


def artifact_path(name: str, root: Path | None = None, base: Path | None = None) -> Path:
    """An artifact's path under the evidence dir, checked through descriptors only: the root is
    reached by the trusted walk (`open_artifact_root`), each directory component of `name` is
    opened no-follow RELATIVE to the previous descriptor (a missing one ends the check — nothing
    exists there to follow), and the final component is `lstat`ed via `dir_fd` and refused when it
    is a symlink. `..`, an absolute name or an empty component is refused up front — a
    daemon-provided id, or a planted link anywhere on the way, can never redirect a write outside
    `e2e/artifacts/test-feature-live/`. No pathname is resolved."""
    root = root or ART
    parts = _artifact_parts(name, root)
    fd = open_artifact_root(root, base, create=True)
    shown = root
    try:
        for part in parts[:-1]:
            shown = shown / part
            try:
                nxt = open_dir_nofollow(part, fd, shown)
            except FileNotFoundError:
                break  # nothing exists below here to follow; a write creates on the descriptor
            os.close(fd)
            fd = nxt
        else:
            try:
                st = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                st = None
            if st is not None and stat.S_ISLNK(st.st_mode):
                raise SystemExit(f"{root / name} is a symlink — refusing to write through it (target {root / name})")
    finally:
        os.close(fd)
    return root / name


# An artifact is ONE plain file name directly under the evidence dir — never a path, never a dotfile.
ARTIFACT_NAME_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]*")


def _refuse_symlink_at(name: str, dfd: int, shown: Path) -> None:
    """Refuse a PRE-EXISTING symlink at `name` (`lstat` RELATIVE to the trusted descriptor). A link
    planted AFTER this check is replaced by the fd-anchored rename, never written through."""
    try:
        st = os.stat(name, dir_fd=dfd, follow_symlinks=False)
    except FileNotFoundError:
        return
    if stat.S_ISLNK(st.st_mode):
        raise SystemExit(f"{shown} is a symlink — refusing to write through it")


def _create_exclusive(tmp: str, dfd: int, shown: Path, name: str) -> int:
    """The temp file, created `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` RELATIVE to the trusted
    descriptor — a link or a file pre-planted at the temp name fails the create."""
    try:
        return os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=dfd)
    except OSError as e:
        raise SystemExit(f"temp file {tmp} under {shown} could not be created exclusively "
                         f"({type(e).__name__}: {e}) — refusing to write {name}") from e


def write_artifact(name: str, payload: bytes | str, root: Path | None = None, base: Path | None = None) -> Path:
    """THE artifact writer — every file the harness lands (report.json, the captured plans, the
    screenshots) goes through here, and NOTHING under the evidence dir is ever opened, created or
    renamed by pathname (codex round 5: a validated pathname was re-resolved by the write; round 6:
    `O_NOFOLLOW` on the final component left every ancestor swappable):
      1. `name` must be a single plain file name (`ARTIFACT_NAME_RE`, no `/`, no leading `.`);
      2. the evidence dir's descriptor is obtained by the trusted walk (`open_artifact_root`: the
         resolved repo root opened once, then `e2e`, `artifacts`, `test-feature-live` each opened
         `O_RDONLY | O_DIRECTORY | O_NOFOLLOW` RELATIVE to the previous descriptor, created where
         missing) — an ancestor swapped for a link is refused (ELOOP) at exactly that step;
      3. a PRE-EXISTING symlink at `name` is refused (`lstat` via `dir_fd`, `_refuse_symlink_at`);
      4. the data is written to a UNIQUE temp name (`.<name>.<pid>.<random>.tmp`) created
         `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` via `dir_fd=` (`_create_exclusive`) — a link
         planted at the temp name fails the create — then `os.write` in full, `os.fsync`;
      5. `os.rename(tmp, name, src_dir_fd=fd, dst_dir_fd=fd)`: atomic, and a link planted at the
         FINAL name after step 3 is REPLACED by the rename (rename never follows its destination),
         never written through.
    A failure at any step unlinks the temp file through the same descriptor. Returns the artifact's
    path (for the report) — a name under the root, never something that was resolved."""
    root = root or ART
    if name in {".", ".."} or not ARTIFACT_NAME_RE.fullmatch(name):
        raise SystemExit(f"artifact name {name!r} is not a single plain file name under {root} — refusing to write it")
    data = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
    dfd = open_artifact_root(root, base, create=True)  # the trusted walk: the anchor once, then every component no-follow
    try:
        _refuse_symlink_at(name, dfd, root / name)
        tmp = f".{name}.{os.getpid()}.{secrets.token_hex(4)}.tmp"
        fd = _create_exclusive(tmp, dfd, root, name)
        try:
            try:
                view = memoryview(data)
                while view:
                    view = view[os.write(fd, view):]
                os.fsync(fd)
            finally:
                os.close(fd)
            os.rename(tmp, name, src_dir_fd=dfd, dst_dir_fd=dfd)
        except BaseException:
            try:
                os.unlink(tmp, dir_fd=dfd)
            except OSError:
                pass
            raise
    finally:
        os.close(dfd)
    return root / name


def write_report(report: dict | None = None, path: Path | None = None, root: Path | None = None) -> Path:
    """Persist the evidence ATOMICALLY through `write_artifact` (unique temp name created
    exclusively on the verified directory's descriptor, `fsync`, `rename` via `dir_fd`) — a reader
    never sees partial JSON, a crash never leaves a half-written report.json or a stray temp file,
    two concurrent writers cannot clobber each other's temp file, and a symlink swapped in after
    validation is refused or replaced, never followed. The target is `report.json` directly under
    `root` (default ART). Called after every scenario and on every exit path — a 30-minute run that
    dies at minute 29 still leaves the first two scenarios' measurements on disk."""
    report = REPORT if report is None else report
    if path is None:
        root = root or ART
        path = root / "report.json"
    root = root or path.parent
    return write_artifact(os.path.relpath(path, root), scrub(json.dumps(report, indent=1, default=str)), root)


SCENARIO_PLAN = (("LT-1", "recon"), ("LT-2", "campaign"), ("LT-3", "recon"))


def analyze(results: dict[str, dict]) -> None:
    """LT-3 consistency, LT-4 surfaces coverage, LT-5 operator's-view rollup — over whatever ran."""
    a, c = results.get("LT-1"), results.get("LT-3")
    if a and c and a["measured"].get("plan") and c["measured"].get("plan"):
        REPORT["scenarios"]["LT-3"]["consistency_vs_LT-1"] = consistency(a, c)
    # LT-4: surfaces asked vs proposed, per plan.
    asked = {"ws_events": True, "api_routes": True, "cli": True, "ui_pages": True}
    REPORT["scenarios"]["LT-4"] = {
        "scenario": "LT-4", "asked": asked,
        "proposed": {t: s["measured"].get("plan", {}).get("surfaces") for t, s in REPORT["scenarios"].items() if t.startswith("LT-") and isinstance(s, dict) and s.get("measured", {}).get("plan")},
    }
    gaps = {t: [k for k, v in (p or {}).items() if asked.get(k) and not v] for t, p in REPORT["scenarios"]["LT-4"]["proposed"].items()}
    REPORT["scenarios"]["LT-4"]["gaps"] = gaps
    REPORT["scenarios"]["LT-4"]["result"] = "pass" if gaps and all(not g for g in gaps.values()) else ("fail" if gaps else "not-run")
    for t, g in gaps.items():
        if g:
            finding(f"LT-4: {t}'s plan never proposes testing these asked surfaces: {g}")
    # LT-5 rolls up the per-run operator-view captures.
    REPORT["scenarios"]["LT-5"] = {
        "scenario": "LT-5",
        "views": {t: {"landing_before": s["measured"].get("landing_before"), "landing_after": s["measured"].get("landing_after"),
                      "scoreboard": s["measured"].get("scoreboard"), "screenshots": s.get("screenshots")}
                  for t, s in REPORT["scenarios"].items() if t in ("LT-1", "LT-2", "LT-3") and isinstance(s, dict)},
        "result": "observed" if any(s.get("screenshots") for t, s in REPORT["scenarios"].items() if t in ("LT-1", "LT-2", "LT-3") and isinstance(s, dict)) else "not-run",
    }


def main() -> None:
    ensure_artifact_root()  # FIRST: every component of e2e/artifacts/test-feature-live lstat-walked from the repo root, THEN created
    policy = _policy()  # also stamps the top-level `contract_deviation` object when the gate is moved
    line = deviation_line(policy)
    if line:
        log(line)  # and again at EVERY preflight (`_judge`)
    verify_testids()
    status, health = http_json("GET", f"{API}/health")
    if status != 200:
        raise SystemExit(f"daemon at {BASE} not healthy: {status} {health}")
    REPORT["daemon"] = health
    st, diag = http_json("GET", f"{API}/diagnostics")
    if st == 200 and isinstance(diag, dict):
        REPORT["components"] = diag.get("components")
    repos = {r["id"] for r in get("/repos")["repos"]}  # type: ignore[index]
    if TARGET_REPO not in repos:
        raise SystemExit(f"{TARGET_REPO} is not registered on {BASE} — registering is out of scope for this harness")
    only = {s.strip() for s in os.environ.get("ONLY", "LT-1,LT-2,LT-3").split(",") if s.strip()}

    results: dict[str, dict] = {}
    current = None
    try:
        for tag, intent in SCENARIO_PLAN:
            if tag not in only:
                continue
            current = tag
            results[tag] = drive_intake(tag, intent)
            write_report()  # evidence lands after EVERY scenario, not once at the end
        current = "analysis"
        analyze(results)
    except BaseException as e:  # SystemExit / KeyboardInterrupt included — the partial evidence still lands
        REPORT["aborted"] = {"scenario": current, "error": f"{type(e).__name__}: {e}"}
        raise
    finally:
        out_path = write_report()
    print(out_path.read_text())


if __name__ == "__main__":
    main()
