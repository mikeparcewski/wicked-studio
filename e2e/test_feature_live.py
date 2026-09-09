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
  * SERIALIZATION PREFLIGHT before EVERY governed launch — exactly three gates: (1) zero runs in
    running/executing/awaiting_human on the daemon, (2) 1-minute load average < 20, (3) swap used
    < 85 % — the contract default (brief-test-feature-live.md: "refuse to run if … swap > 85%").
    ONLY an explicit `SWAP_MAX_PCT` env var moves the swap gate, and ONLY together with
    `SWAP_MAX_PCT_ACK=contract-deviation` (without the acknowledgement the harness exits naming both
    vars); the move is logged as `CONTRACT DEVIATION` at every preflight, stamped on every preflight
    reading and recorded in the report's top-level `contract_deviation` {var, contract, effective,
    ack} — never a silent constant edit. (`vm_stat` free/available memory is recorded for the
    report but NOT gated on — macOS keeps free pages near zero by design.) Polls every 60 s for up
    to 20 min; if the gate never clears the harness STOPS and reports "preflight never cleared".
  * The preflight is RE-RUN (all three gates, one reading) immediately before the submit click; if
    it fails the launch is not submitted (`launch_aborted_by_preflight`, `harness_ok=false`,
    reason `preflight-at-submit`). A process-wide reservation — `fcntl.flock` on
    `e2e/artifacts/test-feature-live/.launch.lock` — is held from that pre-submit preflight until
    the launched run's intake gate has been decided; a second harness process fails fast with a
    named message instead of racing the preflight.
  * Exactly one governed run in flight at a time; the next launch waits for a terminal/gated state.
  * ONE gate policy for EVERY gate, the intake gate and every sibling's gates included
    (`gate_decision`), decided by gate KIND and failing CLOSED: a gate whose unit `stage`/`gate` is
    deliver/release/publish/merge, or whose prompt's imperative (its first clause) is deliver /
    delivery / push / open a PR / merge / publish / release, is REJECTED through the UI card; a gate
    whose prompt is unreadable and whose unit is unknown is REJECTED (`unreadable-gate`); any other
    gate (plan approval, pre-execution unit gate) is approved. A plan whose BODY mentions
    `/runs/:id/deliver` is a plan, not a delivery — approved. Every decision is recorded in the
    scenario's `measured.gates[]` (or the sibling's `gates[]`) with the prompt excerpt, the unit's
    stage/gate and the reason. Sibling gates are decided on `/runs/<sibling id>` — never the API.
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
terminal state (their gates decided on the UI on the way) before their acceptance is sampled.
report.json is written atomically (unique temp file + rename, contained under the artifacts dir,
never through a symlink) after every scenario and on every exit path (an abort is recorded in
`aborted`).

Usage: python3 e2e/test_feature_live.py            (playwright + chromium must be installed)
Env:   STUDIO_URL (default http://localhost:7701), TARGET_REPO (default wicked-studio),
       ONLY=LT-1,LT-2 (subset), PREFLIGHT_MAX_MIN (default 20), GATE_TIMEOUT_MIN (default 25),
       RUN_TIMEOUT_MIN (default 60), SIBLING_GRACE_S (default 120), SIBLING_FOLLOW_MAX_S
       (default 900), SWAP_MAX_PCT (default 85 — a contract deviation when moved; requires
       SWAP_MAX_PCT_ACK=contract-deviation), TEST_PROBLEM_PREFIX (default "" — a marker a
       sibling's `problem` must carry, together with our run id or campaign label, to be attributed).
Prints a JSON report to stdout; artifacts land in e2e/artifacts/test-feature-live/.

Offline self-test (no daemon, no Playwright, no network; studio's CI runs no Python step, so run
it by hand before pushing a harness change):
    python3 -m unittest e2e/test_feature_live_selftest.py -v
    python3 -m py_compile e2e/test_feature_live.py
"""
from __future__ import annotations

import fcntl
import json
import os
import re
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
LOCK_PATH = ART / ".launch.lock"  # the process-wide launch reservation (fcntl.flock)
BASE = os.environ.get("STUDIO_URL", "http://localhost:7701").rstrip("/")
API = f"{BASE}/api/v1"
TARGET_REPO = os.environ.get("TARGET_REPO", "wicked-studio")
PREFLIGHT_MAX_S = int(float(os.environ.get("PREFLIGHT_MAX_MIN", "20")) * 60)
GATE_TIMEOUT_S = int(float(os.environ.get("GATE_TIMEOUT_MIN", "25")) * 60)
RUN_TIMEOUT_S = int(float(os.environ.get("RUN_TIMEOUT_MIN", "60")) * 60)
SIBLING_GRACE_S = int(os.environ.get("SIBLING_GRACE_S", "120"))
SIBLING_FOLLOW_MAX_S = int(os.environ.get("SIBLING_FOLLOW_MAX_S", "900"))
TEST_PROBLEM_PREFIX = os.environ.get("TEST_PROBLEM_PREFIX", "")
# The contract (brief-test-feature-live.md): "the harness must refuse to run if … swap > 85%".
# The three recorded launches (d293f4d7…, f8bc2bad…, d12adb6c…) cleared under a 95 % threshold the
# coordinator authorized mid-run because this host idles at ~93 % swap — that relaxation is a
# recorded contract deviation (see `preflight_policy`), not the default.
SWAP_MAX_PCT_CONTRACT = 85
# Moving the swap gate is honoured ONLY with this acknowledgement set — the deviation is meant to be
# impossible to miss (logged at every preflight, stamped on every reading, a top-level report
# object), not impossible to do: compliant live evidence is unobtainable on a host idling at ~93 %.
SWAP_ACK_VAR = "SWAP_MAX_PCT_ACK"
SWAP_ACK_VALUE = "contract-deviation"
LOAD1_MAX = 20
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


def list_runs() -> list[dict]:
    return get("/runs")["runs"]  # type: ignore[index]


def list_campaigns() -> list[dict]:
    body = get("/campaigns")
    return body.get("campaigns", []) if isinstance(body, dict) else []  # type: ignore[union-attr]


def run_detail(run_id: str) -> dict:
    """The run DTO; a non-2xx / transport failure raises `FetchError` AFTER recording the typed miss."""
    body = get(f"/runs/{enc(run_id)}")
    if not isinstance(body, dict) or not isinstance(body.get("run"), dict):
        raise FetchError(record_fetch_error(f"/runs/{enc(run_id)}", 200, f"no `run` object in the answer: {json.dumps(body)[:120]}"))
    return body["run"]


def run_events(run_id: str) -> list[dict]:
    body = get(f"/runs/{enc(run_id)}/events")
    return body if isinstance(body, list) else body.get("events", [])  # type: ignore[union-attr]


def unit_output(run_id: str, ord_: int) -> str | None | FetchMiss:
    """The unit's captured output: a string; None when the daemon answers 2xx with no output (204,
    `output: null`, empty) — evidence that is ABSENT; a `FetchMiss` when the fetch FAILED."""
    path = f"/runs/{enc(run_id)}/units/{ord_}/output"
    status, body = _fetch(path)
    if not 200 <= status < 300:
        return record_fetch_error(path, status, body)
    if body is None or (isinstance(body, dict) and not isinstance(body.get("output"), str)):
        return None
    if not isinstance(body, dict):
        return record_fetch_error(path, status, f"unexpected body shape: {json.dumps(body)[:120]}")
    return body["output"] or None


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
    policy: dict = {
        "swap_max_pct": swap_max,
        "contract_swap_max_pct": SWAP_MAX_PCT_CONTRACT,
        "load1_max": LOAD1_MAX,
        "active_runs_max": 0,
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
    return why


def _policy() -> dict:
    policy = REPORT.setdefault("preflight_policy", preflight_policy())
    if policy.get("contract_deviation"):
        REPORT["contract_deviation"] = policy["contract_deviation"]  # top-level, impossible to miss
    return policy


def _judge(entry: dict, policy: dict) -> list[str]:
    """One reading, judged against all three gates, appended to `entry.readings[]` with the
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
    """The SAME three gates, ONE reading, immediately before the submit click — the minutes spent
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
    """The process-wide launch reservation: `fcntl.flock(LOCK_EX | LOCK_NB)` on
    `ART/.launch.lock`, held from the pre-submit preflight until the launched run's intake gate has
    been decided. A second harness process (or a second launch in this one) fails FAST with a
    named message instead of clearing its own preflight in the same window."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or LOCK_PATH
        self._fd: int | None = None

    def acquire(self) -> "LaunchLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(self.path), os.O_RDWR | os.O_CREAT, 0o644)
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


# Execution summaries are RESULTS a worker reports, not scenarios a plan proposes: `npm test` green,
# a ✓/✔/PASS/FAIL line, "Tests: 12 passed" — and everything under an "Execution verdict" heading.
EXEC_SUMMARY_RE = re.compile(r"npm (run )?(test|lint|typecheck)|Tests?:\s*\d+ (passed|failed)|✓|✔|PASS|FAIL\b")
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
    and execution summaries (`EXEC_SUMMARY_RE`, "Execution verdict" sections) are none of these."""
    records: list[dict] = []
    lines, section_lines = plan_lines(text)
    excluded = {"execution_section_lines": section_lines, "execution_summary_items": 0}
    header: list[str] | None = None

    def accept(title: str, lead_id: str | None, raw: str) -> None:
        if EXEC_SUMMARY_RE.search(raw):
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
        "measured_over": "scenario lines + plan-table rows only (execution summaries excluded)",
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
# "Deliver: open a PR against main" → "Deliver". A route listed in a plan's BODY
# (`/runs/:id/deliver` among the endpoints to test) is never an imperative.
IMPERATIVE_DELIVER_RE = re.compile(r"^(approve )?(the )?(deliver|delivery|push|open (a )?pr|merge|publish|release)\b", re.I)


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


def gate_decision(prompt: str | None, unit: dict | None = None) -> tuple[str, str]:
    """THE gate policy, applied to every gate — the intake gate, every later gate, every sibling's
    gate — decided by gate KIND and failing CLOSED:
      * reject iff the gated unit's `stage`/`gate` (from GET /runs/:id) is a delivery kind
        (deliver / release / publish / merge), OR the prompt's IMPERATIVE — its first clause, not a
        keyword anywhere in a plan body — asks to deliver / push / open a PR / merge / publish /
        release;
      * an unreadable prompt (empty / None) with NO unit information → reject, reason
        `unreadable-gate`: never approve what cannot be read;
      * anything else — the intake gate, a proposed-plan approval whose body lists
        `/runs/:id/deliver` among the routes to test, a pre-execution unit gate — is approved.
    Returns (decision, reason); the caller records both together with the unit's stage/gate."""
    kinds = {str(unit.get(k) or "").strip().lower() for k in ("stage", "gate")} if unit else set()
    hit_kind = sorted(kinds & DELIVER_KINDS)
    if hit_kind:
        return "reject", f"gate kind {hit_kind[0]!r} (the unit's stage/gate) authorizes delivery (never deliver)"
    text = (prompt or "").strip()
    if not text:
        if not unit:
            return "reject", "unreadable-gate"
        return "approve", (f"empty prompt, but the unit's stage/gate ({unit.get('stage')}/{unit.get('gate')}) "
                           "is not a delivery kind")
    imp = imperative(text)
    hit = IMPERATIVE_DELIVER_RE.match(imp)
    if hit:
        return "reject", f"the prompt's imperative {imp!r} asks to {hit.group(3).lower()} (never deliver)"
    tail = f"; unit stage/gate {unit.get('stage')}/{unit.get('gate')}" if unit else "; no unit info"
    return "approve", f"imperative {imp!r} is not deliver-class" + tail


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


def decide_gate_on_card(page, card, *, run_id: str, ord_: int | None, unit: dict | None, tag: str,
                        first: bool, prompt: str | None = None) -> dict:
    """Read the prompt on a rendered SteeringGate card, decide (`gate_decision` with the unit's
    stage/gate), click the matching button, wait for the POST …/gate and return the `gates[]`
    entry. Every gate the harness answers — intake, later, sibling — goes through here."""
    if prompt is None:
        try:
            prompt = card.first.locator('[data-testid="steering-prompt"]').inner_text()
        except Exception as e:  # no prompt element: unreadable → gate_decision fails closed
            prompt = ""
            log(f"{tag}: gate ord={ord_} on {run_id}: steering-prompt unreadable ({type(e).__name__}: {e})")
    decision, reason = gate_decision(prompt, unit)
    if reason == "unreadable-gate":
        finding(f"{tag}: gate ord={ord_} on run {run_id} had an unreadable prompt and no unit info — REJECTED (never approve what cannot be read)")
    with page.expect_response(lambda r: "/gate" in r.url and r.request.method == "POST", timeout=60000) as gr:
        card.first.locator(f'[data-testid="steering-{decision}"]').click()
    resp = gr.value
    try:
        body = json.loads(resp.request.post_data or "{}")
    except Exception:
        body = {"raw": str(resp.request.post_data)[:200]}
    entry = {"ord": ord_, "first": first, "prompt": (prompt or "")[:200], "decision": decision, "reason": reason,
             "unit": {"stage": unit.get("stage"), "gate": unit.get("gate")} if unit else None,
             "status": resp.status, "url": resp.url.replace(BASE, ""), "body": body}
    log(f"{tag}: gate ord={ord_} on {run_id[:8]} → {decision.upper()} ({reason}) → POST {entry['url']} {resp.status}")
    if decision == "reject":
        finding(f"{tag}: gate ord={ord_} on run {run_id} ('{(prompt or '')[:80]}…') was REJECTED by policy ({reason})")
    return entry


def latest_gate_ord(events: list[dict]) -> int | None:
    aw = [e for e in events if e.get("type") == "awaitingHuman"]
    return aw[-1].get("ord") if aw else None


def decide_sibling_gate(page, sid: str, *, tag: str, return_to: str) -> dict:
    """A sibling in `awaiting_human` gets its gate decided THROUGH THE UI: navigate to
    /runs/<sibling id>, wait for `[data-testid="steering-gate"][data-run-id="<id>"]`, read the
    prompt, decide with the gated unit's stage/gate (from GET /runs/:id — read-only), click — then
    navigate back to the launch panel. Never the API."""
    ord_: int | None = None
    unit: dict | None = None
    lookup_error: str | None = None
    try:
        ord_ = latest_gate_ord(run_events(sid))
        unit = gate_unit(run_detail(sid), ord_)
    except Exception as e:  # a FetchError is already recorded by get(); decide from the card, failing closed
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
                    tag: str = "", return_to: str | None = None, decide=None) -> dict:
    """Follow attributable siblings to a terminal state (or `max_s`), deciding any gate a sibling
    raises THROUGH THE UI on the way (`decide_sibling_gate` — a sibling left in `awaiting_human`
    would otherwise sit there until the timeout), THEN sample their acceptance — a verdict sampled
    while a sibling is still executing proves nothing either way. Returns per-sibling statuses,
    the gates decided (`gates[sid][]`) and verdicts (None = no verdict; a FetchMiss = the fetch
    FAILED, which is not the same thing)."""
    decide = decide or decide_sibling_gate
    return_to = return_to or f"{BASE}/testing/campaigns"
    started = time.time()
    statuses: dict[str, str] = {}
    gates: dict[str, list[dict]] = {sid: [] for sid in sibling_ids}
    warned: set[str] = set()
    while True:
        for sid in sibling_ids:
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
            if sum(1 for g in gates[sid] if g.get("status") is None) >= 2:
                continue  # its card never rendered twice — stop re-navigating, let the timeout report it
            gates[sid].append(decide(page, sid, tag=tag, return_to=return_to))
        done = all(st in TERMINAL or st.startswith("ERR") for st in statuses.values())
        if done or time.time() - started >= max_s:
            break
        sleep(15)
    return {
        "statuses": statuses,
        "gates": gates,
        "followed_s": int(time.time() - started),
        "all_terminal": bool(statuses) and all(st in TERMINAL for st in statuses.values()),
        "acceptance": {sid: acceptance_verdict(sid) for sid in sibling_ids},
    }


def derive_result(m: dict, blockers: list[str] | None = None) -> dict:
    """The verdict split, as a pure function of the measurements (so the committed report can be
    re-derived offline). `harness_ok`: the harness did its job — launch submitted (after the
    pre-submit preflight) and accepted with run ids, gate rendered on the UI, every gate decision
    posted, terminal state, no wedge, no blocker. `result`: the FEATURE contract — "pass" REQUIRES
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
    elif any(not isinstance(g.get("status"), int) or g["status"] >= 300 for g in gates):
        hard.append("a gate decision did not post")
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
    if not sibs:
        fail.append(f"no attributable sibling runs after the approved {intent} completed — the approved plan was never executed"
                    f" ({len(after.get('unrelated_new_runs') or [])} unrelated new runs ignored)")
    else:
        followed = x.get("siblings_followed") or {}
        statuses = followed.get("statuses") or {}
        verdicts = followed.get("acceptance") or {}
        sibling_verdicts: dict[str, dict] = {}
        for s in sibs:
            sid = s.get("id")
            st_s = statuses.get(sid)
            v = verdicts.get(sid)
            ok_v = isinstance(v, str) and bool(v)
            sibling_verdicts[sid] = {"status": st_s, "verdict": v if ok_v else None,
                                     "verdict_fetch_error": v if isinstance(v, dict) else None}
            if st_s not in TERMINAL:
                fail.append(f"sibling {sid} did not reach a terminal state (status={st_s})")
            if not ok_v:
                fail.append(f"sibling {sid} carries no acceptance verdict" + (f" (the fetch failed: {v.get('status')})" if isinstance(v, dict) else ""))
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
        p = artifact_path(f"{tag}-{name}.png")
        page.screenshot(path=str(p), full_page=True)
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
        # window another run can start in; the flock stops a second harness process from clearing
        # its own preflight in that window. Held until the intake gate has been decided.
        lock.acquire()
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
        post_body = json.loads(resp.request.post_data or "{}")
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

        prompt = card.first.locator('[data-testid="steering-prompt"]').inner_text()
        raw_prompt = awaiting[0].get("prompt") if awaiting else None
        m["measured"]["gate"] = {
            "ord": awaiting[0].get("ord") if awaiting else None,
            "prompt_ui": prompt,
            "prompt_raw_len": len(raw_prompt) if raw_prompt else None,
            "pre_execution": bool(re.match(r"Approve unit \d+ before it runs", prompt)),
            "contains_plan": bool(re.search(r"scenario\s*\d|S-\d|\bplan:\s", prompt, re.I)) and "before it runs" not in prompt,
            "events_before_gate": [e.get("type") for e in events if e.get("seq", 0) <= (awaiting[0].get("seq", 0) if awaiting else 0)],
        }
        if m["measured"]["gate"]["pre_execution"]:
            finding(f"{tag}: the ONLY human gate is pre-execution ('{prompt[:60]}…') — the operator approves the survey, not a plan (crew#473)")
        shot(page, "03-gate-card")

        # ── Decide the FIRST gate through the UI card — same policy as every later gate ──────
        gates: list[dict] = []
        m["measured"]["gates"] = gates
        gate_ord = awaiting[0].get("ord") if awaiting else None
        try:
            unit = gate_unit(run_detail(run_id), gate_ord)
        except Exception as e:  # recorded as a fetch error; the decision falls back to the prompt (fails closed if unreadable)
            unit = None
            m["notes"].append(f"could not read the gated unit's stage/gate: {e}")
        m["measured"]["gate"]["unit"] = unit
        entry = decide_gate_on_card(page, card, run_id=run_id, ord_=gate_ord, unit=unit, tag=tag, first=True, prompt=prompt)
        gates.append(entry)
        decision = entry["decision"]
        m["measured"]["gate_response"] = {k: entry[k] for k in ("decision", "status", "body", "url")}
        t_approve = time.time()  # the first gate's decision time (approve in every recorded run)
        lock.release()  # the intake gate is decided — the launch reservation ends here
        if decision != "reject" and not fallback_run_page:
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
        while time.time() < deadline:
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
                # Same policy as the first gate — the gated unit's stage/gate + the prompt's
                # imperative, failing closed (an "Approve proposed test plan…" gate whose body
                # lists /runs/:id/deliver among the routes to test is legitimate and goes through).
                unit2 = gate_unit(d, g.get("ord"))
                shot(page, f"05-gate-{g.get('ord', 'x')}-{gate_decision(ptxt, unit2)[0]}")
                gates.append(decide_gate_on_card(page, c2, run_id=run_id, ord_=g.get("ord"), unit=unit2, tag=tag, first=False, prompt=ptxt))
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
        plan_path = artifact_path(f"{tag}-plan-{safe_name(run_id)}.md")
        plan_path.write_text(scrub(f"# {tag} — run {run_id} ({intent})\n\nPOST body:\n```json\n{json.dumps(post_body, indent=1)}\n```\n\n{plan_text}\n"))
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
            log(f"{tag}: following {len(ids)} attributable sibling(s) to terminal (max {SIBLING_FOLLOW_MAX_S}s)")
            # Followed WITH the page: a sibling that raises a gate gets it decided on /runs/<id>
            # (never the API), and the browser returns to the launch panel afterwards.
            m["measured"]["siblings_followed"] = follow_siblings(ids, page=page, tag=tag, return_to=f"{BASE}/testing/campaigns")
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


def artifact_path(name: str, root: Path | None = None) -> Path:
    """An artifact's path under the evidence dir: the target's realpath must stay under the root's
    realpath, and the target itself must not be a symlink (lstat) — a daemon-provided id can never
    redirect a write outside `e2e/artifacts/test-feature-live/` or through a planted link."""
    root = root or ART
    root.mkdir(parents=True, exist_ok=True)
    root_real = root.resolve()
    p = root / name
    if p.is_symlink():  # lstat: never write THROUGH a symlink, wherever it points
        raise SystemExit(f"artifact target {p} is a symlink — refusing to write through it")
    real = p.resolve()
    if root_real not in real.parents:
        raise SystemExit(f"artifact path {p} resolves to {real}, outside {root_real} — refusing to write it")
    return p


def write_report(report: dict | None = None, path: Path | None = None, root: Path | None = None) -> Path:
    """Persist the evidence ATOMICALLY: a UNIQUE temp file per writer (`tempfile.mkstemp`, so two
    concurrent writers can neither overwrite nor rename each other's temp file) + `os.replace`. A
    reader never sees partial JSON and a crash never leaves a half-written report.json or a stray
    temp file behind. The target is contained under `root` (default ART) and is never a symlink.
    Called after every scenario and on every exit path — a 30-minute run that dies at minute 29
    still leaves the first two scenarios' measurements on disk."""
    report = REPORT if report is None else report
    if path is None:
        root = root or ART
        path = root / "report.json"
    root = root or path.parent
    target = artifact_path(os.path.relpath(path, root), root)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=".report-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(scrub(json.dumps(report, indent=1, default=str)))
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return target


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
    ART.mkdir(parents=True, exist_ok=True)
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
