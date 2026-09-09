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
    ONLY an explicit `SWAP_MAX_PCT` env var moves the swap gate, and the move is recorded in every
    preflight reading and in `report.preflight_policy.contract_deviation` — never a silent constant
    edit. (`vm_stat` free/available memory is recorded for the report but NOT gated on — macOS
    keeps free pages near zero by design.) Polls every 60 s for up to 20 min; if the gate never
    clears the harness STOPS and reports "preflight never cleared" with the readings.
  * Exactly one governed run in flight at a time; the next launch waits for a terminal/gated state.
  * ONE gate policy for EVERY gate, the intake gate included (`gate_decision`): a prompt asking to
    deliver / push / open a PR / merge / publish / release is REJECTED through the UI card; any
    other gate (plan approval, pre-execution unit gate) is approved. Every decision is recorded in
    the scenario's `measured.gates[]` with the prompt excerpt and the reason.
  * Never registers/modifies/deletes repos or projects; read-only GETs for every assertion.
  * Never kills a wedged run (no events for 10 min while executing) — it is reported.

VERDICTS are split (`derive_result`): `harness_ok` says the harness did its job (launch → gate on
the UI → decision → terminal; no wedge, no blocker); `result` is the FEATURE contract —
`"pass"` REQUIRES attributable sibling runs that reach verdicts (and, for "New test", a registered
campaign); otherwise `"fail"` with `fail_reasons[]`. Siblings are attributed by a daemon-visible
relationship (`attribute_siblings`), never by "a run appeared"; attributable siblings are
followed to a terminal state before their acceptance is sampled. report.json is written
atomically after every scenario and on every exit path (an abort is recorded in `aborted`).

Usage: python3 e2e/test_feature_live.py            (playwright + chromium must be installed)
Env:   STUDIO_URL (default http://localhost:7701), TARGET_REPO (default wicked-studio),
       ONLY=LT-1,LT-2 (subset), PREFLIGHT_MAX_MIN (default 20), GATE_TIMEOUT_MIN (default 25),
       RUN_TIMEOUT_MIN (default 60), SIBLING_GRACE_S (default 120), SIBLING_FOLLOW_MAX_S
       (default 900), SWAP_MAX_PCT (default 85 — a contract deviation when set),
       TEST_PROBLEM_PREFIX (default "" — a marker a sibling's `problem` would carry before the brief).
Prints a JSON report to stdout; artifacts land in e2e/artifacts/test-feature-live/.

Offline self-test (no daemon, no Playwright, no network; studio's CI runs no Python step, so run
it by hand before pushing a harness change):
    python3 -m unittest e2e/test_feature_live_selftest.py -v
    python3 -m py_compile e2e/test_feature_live.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
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
LOAD1_MAX = 20
WEDGE_S = 10 * 60
ACTIVE = {"running", "executing", "awaiting_human", "planning", "pending", "starting"}
TERMINAL = {"completed", "failed", "cancelled", "canceled", "rejected"}

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


def get(path: str) -> object:
    status, body = http_json("GET", f"{API}{path}")
    if status >= 400:
        raise RuntimeError(f"GET {path} → {status}: {json.dumps(body)[:300]}")
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
    return get(f"/runs/{enc(run_id)}")["run"]  # type: ignore[index]


def run_events(run_id: str) -> list[dict]:
    body = get(f"/runs/{enc(run_id)}/events")
    return body if isinstance(body, list) else body.get("events", [])  # type: ignore[union-attr]


def unit_output(run_id: str, ord_: int) -> str | None:
    status, body = http_json("GET", f"{API}/runs/{enc(run_id)}/units/{ord_}/output")
    if status != 200 or not isinstance(body, dict):
        return None
    out = body.get("output")
    return out if isinstance(out, str) else None


def acceptance(run_id: str) -> dict | None:
    status, body = http_json("GET", f"{API}/runs/{enc(run_id)}/acceptance")
    return body if status == 200 and isinstance(body, dict) else None


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
    unless an EXPLICIT `SWAP_MAX_PCT` env var moves it — and then the report says so
    (`contract_deviation`), because every launch cleared under a relaxed gate is evidence gathered
    outside the brief's terms."""
    env = os.environ if env is None else env
    raw = (env.get("SWAP_MAX_PCT") or "").strip()
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
    policy: dict = {
        "swap_max_pct": swap_max,
        "contract_swap_max_pct": SWAP_MAX_PCT_CONTRACT,
        "load1_max": LOAD1_MAX,
        "active_runs_max": 0,
        "source": "SWAP_MAX_PCT env" if raw else "contract default",
    }
    if swap_max != SWAP_MAX_PCT_CONTRACT:
        policy["contract_deviation"] = (
            f"swap gate is {swap_max}% (SWAP_MAX_PCT), not the brief's {SWAP_MAX_PCT_CONTRACT}% — "
            "every launch in this report cleared under the relaxed threshold")
    return policy


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


def preflight(tag: str) -> bool:
    started = time.time()
    policy = REPORT.setdefault("preflight_policy", preflight_policy())
    entry = {"scenario": tag, "readings": [], "cleared": False, "waited_s": 0}
    REPORT["preflights"].append(entry)
    while True:
        r = readings()
        why = preflight_ok(r, policy)
        # Every reading carries the threshold it was judged against — a reader of the report must
        # never have to guess whether 93 % swap "cleared" under 85 or under a relaxed gate.
        entry["readings"].append({**r, "swap_max_pct": policy["swap_max_pct"], "load1_max": policy["load1_max"],
                                  "blocked_by": why})
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
    """The repo's tracked paths plus a basename → paths index (cached; one `git ls-files`)."""
    global _REPO_INDEX
    if _REPO_INDEX is None:
        out = subprocess.run(["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True).stdout
        paths = set(out.split())
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


def scenario_items(text: str) -> tuple[list[str], list[str]]:
    """Extract (scenario titles, leading scenario ids) from a plan.
    * A markdown table whose header names a `Scenario` column IS a plan table: every data row is
      one scenario (title = that cell) — the author labelled it so; the verb usually sits in the
      row's Class column, not the title.
    * Any other table row: title = the first non-numeric cell, accepted only with a leading id or
      a checking verb AND a surface noun in that cell (a survey table is not a plan).
    * Bullet / numbered items: accepted with a leading id (`S-1`, `1.2` — a bare number is not an
      id) or a verb AND a noun in the item text.
    Headings, bold-label paragraphs, table headers/rules, table-of-contents lines and toolchain
    paths are none of these and are dropped."""
    titles: list[str] = []
    ids: list[str] = []
    lines = text.splitlines()
    header: list[str] | None = None
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
                titles.append(title)
                if lead_id:
                    ids.append(lead_id)
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
            titles.append(title)
            if lead_id:
                ids.append(lead_id)
    return titles, sorted(set(ids))


def analyze_plan(text: str, index: RepoIndex | None = None) -> dict:
    paths, by_base = index or repo_files()
    path_hits = set(re.findall(r"(?<![\w/])((?:src|e2e|docs|scripts|public|\.github)/[\w./\-\[\]]+\.(?:tsx?|py|json|md|css|html|ya?ml))", text))
    # Bare source basenames (`App.tsx`, `useEventStream.ts`, `gates.ts`) — kept only when the repo
    # tracks a file of that name, then canonicalized to the repo path when the name is unique.
    bare = set(re.findall(r"(?<![\w./-])([A-Za-z][\w.-]*\.(?:tsx?|mjs|py))\b", text))
    real_paths = sorted(p for p in path_hits if p in paths)
    real_bare = sorted(b for b in bare if any(h.startswith(SOURCE_ROOTS) for h in by_base.get(b, [])))
    fake_paths = sorted(p for p in path_hits if p not in paths)
    canon = canonical_files(real_paths, real_bare, (paths, by_base))
    low = text.lower()
    scenario_lines, ids = scenario_items(text)
    surfaces = {
        "ws_events": bool(re.search(r"/ws\b|websocket|awaitinghuman|coreevent|unitplanned|sessioncompleted|framereceived", low)),
        "api_routes": bool(re.search(r"/api/v1|/testing/recon|\b(get|post) /|/runs\b|/campaigns\b|/repos\b|/projects\b", low)),
        "cli": bool(re.search(r"\bcli\b|npx |npm run|\bbin/|wicked-crew serve|command[- ]line|vite build", low)),
        "ui_pages": bool(re.search(r"/testing/campaigns|/runs/|/steering|playwright|data-testid|home deck|homecommand|leftsidebar", low)),
    }
    return {
        "chars": len(text),
        "real_files": real_paths,
        "real_basenames": real_bare,
        "canonical_files": canon,
        "nonexistent_paths": fake_paths,
        "names_real_files": len(canon) >= 3,
        "classifies": ("deterministic" in low and "governed" in low) or ("tool check" in low and "agent run" in low),
        "deterministic_mentions": low.count("deterministic"),
        "governed_mentions": low.count("governed"),
        "scenario_ids": ids,
        "scenario_lines": scenario_lines,
        "surfaces": surfaces,
    }


def jaccard(a: set, b: set) -> float | None:
    if not a and not b:
        return None
    return round(100 * len(a & b) / len(a | b), 1)


def norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower())[:60].strip()


# ── Gate policy, sibling attribution, the verdict split ───────────────────────────────────────

DELIVER_RE = re.compile(r"deliver|push|pull request|\bpr\b|merge|publish|release", re.I)


def gate_decision(prompt: str) -> tuple[str, str]:
    """THE gate policy, applied to every gate including the first: a prompt asking to deliver /
    push / open a PR / merge / publish / release is rejected; anything else — the intake gate, a
    proposed-plan approval, a pre-execution unit gate — is approved. A deny-list, not an
    allow-list: a legitimate "Approve proposed test plan…" gate must not be rejected for its
    wording, and the intake gate must not bypass the deliver prohibition."""
    hit = DELIVER_RE.search(prompt or "")
    if hit:
        return "reject", f"deliver-class keyword {hit.group(0)!r} in the gate prompt (never deliver)"
    return "approve", "no deliver/push/PR/merge/publish/release keyword in the gate prompt"


def attribute_siblings(runs: list[dict], campaigns: list[dict], *, before: set[str], own: list[str],
                       label: str | None, brief: str = "") -> dict:
    """Split the runs that appeared since launch into ATTRIBUTABLE siblings and unrelated new runs.
    A sibling is related to this launch by a daemon-visible relationship (wicked-crew-api-types
    0.25.0 `AgentSession` / `Campaign`): `session.campaign_id` or `group_label` equal to the
    returned campaign label; membership in that campaign's `node_run_id` values or
    `attached_runs[].runId` (DAG-node ids are `{campaign}:{node}:a{n}` but the contract says read
    membership from the campaign, not the id shape); or `session.problem` carrying one of our run
    ids, the label, or the prefixed brief. A run that merely APPEARED is not a sibling."""
    linked: set[str] = set()
    for c in campaigns:
        if label and c.get("id") == label:
            linked |= {v for v in (c.get("node_run_id") or {}).values() if isinstance(v, str)}
            linked |= {a.get("runId") for a in (c.get("attached_runs") or []) if isinstance(a, dict) and a.get("runId")}
    marker = f"{TEST_PROBLEM_PREFIX}{brief}" if brief else None
    siblings: list[dict] = []
    unrelated: list[dict] = []
    for r in runs:
        s = r.get("session") or {}
        rid = s.get("id")
        if not rid or rid in before or rid in own:
            continue
        problem = s.get("problem") or ""
        why = None
        if label and (s.get("campaign_id") == label or s.get("group_label") == label):
            why = "session.campaign_id/group_label == the launch's campaign label"
        elif rid in linked:
            why = "listed in the campaign's node_run_id/attached_runs"
        elif any(o and o in problem for o in own):
            why = "session.problem carries the launched run id"
        elif label and label in problem:
            why = "session.problem carries the campaign label"
        elif marker and marker in problem:
            why = "session.problem carries the brief"
        entry = {"id": rid, "status": s.get("status"), "problem": problem[:100]}
        if why:
            siblings.append({**entry, "attributed_by": why})
        else:
            unrelated.append(entry)
    return {"attributable_siblings": siblings, "unrelated_new_runs": unrelated}


def follow_siblings(sibling_ids: list[str], max_s: int = SIBLING_FOLLOW_MAX_S, sleep=time.sleep) -> dict:
    """Follow attributable siblings to a terminal state (or `max_s`), THEN sample their acceptance —
    a verdict sampled while a sibling is still executing proves nothing either way."""
    started = time.time()
    statuses: dict[str, str] = {}
    while True:
        for sid in sibling_ids:
            try:
                statuses[sid] = run_detail(sid)["session"]["status"]
            except Exception as e:
                statuses[sid] = f"ERR {e}"
        done = all(st in TERMINAL or st.startswith("ERR") for st in statuses.values())
        if done or time.time() - started >= max_s:
            break
        sleep(15)
    return {
        "statuses": statuses,
        "followed_s": int(time.time() - started),
        "all_terminal": bool(statuses) and all(st in TERMINAL for st in statuses.values()),
        "acceptance": {sid: (acceptance(sid) or {}).get("acceptance", {}).get("verdict") for sid in sibling_ids},
    }


def derive_result(m: dict, blockers: list[str] | None = None) -> dict:
    """The verdict split, as a pure function of the measurements (so the committed report can be
    re-derived offline). `harness_ok`: the harness did its job — launch accepted, gate rendered on
    the UI, every gate decision posted, terminal state, no wedge, no blocker. `result`: the FEATURE
    contract — "pass" REQUIRES a completed run whose plan names real files and classifies, PLUS
    attributable sibling runs that reached acceptance verdicts, PLUS (for the "campaign" intent) a
    registered campaign served by GET /campaigns. Anything less is "fail" with `fail_reasons[]`;
    recon completion + text heuristics alone never spell "pass"."""
    x = m.get("measured") or {}
    tag, intent = m.get("scenario"), m.get("intent") or "run"
    if m.get("result") == "blocked-preflight":
        return {"harness_ok": False, "result": "blocked-preflight", "fail_reasons": ["preflight never cleared"]}
    hard: list[str] = []
    st = x.get("post_status")
    if not (isinstance(st, int) and 200 <= st < 300 and x.get("run_ids")):
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
    plan = x.get("plan") or {}
    if not plan.get("names_real_files"):
        fail.append("plan names fewer than 3 real files")
    if not plan.get("classifies"):
        fail.append("plan does not classify deterministic tool checks vs governed agent runs")
    after = x.get("siblings_after_grace") or x.get("siblings_at_terminal") or {}
    sibs = after.get("attributable_siblings") or []
    if not sibs:
        fail.append(f"no attributable sibling runs after the approved {intent} completed — the approved plan was never executed"
                    f" ({len(after.get('unrelated_new_runs') or [])} unrelated new runs ignored)")
    else:
        verdicts = {k: v for k, v in ((x.get("siblings_followed") or {}).get("acceptance") or {}).items() if v}
        if not verdicts:
            fail.append(f"{len(sibs)} attributable sibling(s) reached no acceptance verdict")
    if intent == "campaign":
        if not x.get("campaign_registered"):
            fail.append(f"no engine campaign registered for label {x.get('campaign_label')} (campaignRegistered=false)")
        elif not after.get("campaign_for_label"):
            fail.append(f"campaign label {x.get('campaign_label')} is not served by GET /campaigns")
    result = "wedged" if x.get("wedged") else ("pass" if not fail else "fail")
    return {"harness_ok": harness_ok, "result": result, "fail_reasons": fail}


# ── The UI-driven governed intake ─────────────────────────────────────────────────────────────


def drive_intake(tag: str, intent: str) -> dict:
    """Runs one governed intake through the studio UI and returns the measurements."""
    from playwright.sync_api import sync_playwright

    verb = "testing-recon-open" if intent == "recon" else "testing-campaign-open"
    m: dict = {"scenario": tag, "intent": intent, "result": "not-run", "harness_ok": False, "fail_reasons": [], "measured": {}, "notes": []}
    REPORT["scenarios"][tag] = m
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
        p = ART / f"{tag}-{name}.png"
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
        run_ids = answer.get("runIds") or ([answer["runId"]] if answer.get("runId") else [])
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
        decision, reason = gate_decision(prompt)
        with page.expect_response(lambda r: "/gate" in r.url and r.request.method == "POST", timeout=60000) as gate_resp:
            card.first.locator(f'[data-testid="steering-{decision}"]').click()
        gr = gate_resp.value
        gates.append({"ord": awaiting[0].get("ord") if awaiting else None, "first": True, "prompt": prompt[:200],
                      "decision": decision, "reason": reason, "status": gr.status})
        m["measured"]["gate_response"] = {"decision": decision, "status": gr.status, "body": json.loads(gr.request.post_data or "{}"), "url": gr.url.replace(BASE, "")}
        t_approve = time.time()  # the first gate's decision time (approve in every recorded run)
        log(f"{tag}: {decision.upper()}D intake gate via the SteeringGate card ({reason}) → POST {gr.url.replace(BASE, '')} {gr.status}")
        if decision == "reject":
            finding(f"{tag}: the INTAKE gate ('{prompt[:80]}…') was REJECTED by policy (never deliver)")
        elif not fallback_run_page:
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
                ptxt = g.get("prompt", "") or ""
                page.goto(f"{BASE}/runs/{urllib.parse.quote(run_id, safe='')}", wait_until="networkidle")
                c2 = page.locator(f'[data-testid="steering-gate"][data-run-id="{run_id}"]').first
                try:
                    c2.wait_for(timeout=30000)
                    ptxt = c2.locator('[data-testid="steering-prompt"]').inner_text() or ptxt
                except Exception:
                    m["notes"].append("later gate present per REST but no card on the run page")
                    continue
                # Same deny-list as the first gate: reject iff deliver-class, approve anything else
                # (a "Approve proposed test plan…" gate is legitimate and must go through).
                decision, reason = gate_decision(ptxt)
                shot(page, f"05-gate-{g.get('ord', 'x')}-{decision}")
                with page.expect_response(lambda r: "/gate" in r.url and r.request.method == "POST", timeout=60000) as gr2:
                    c2.locator(f'[data-testid="steering-{decision}"]').click()
                gates.append({"ord": g.get("ord"), "first": False, "prompt": ptxt[:200], "decision": decision,
                              "reason": reason, "status": gr2.value.status})
                log(f"{tag}: later gate ord={g.get('ord')} → {decision} ({reason})")
                if decision == "reject":
                    finding(f"{tag}: a later gate ('{ptxt[:80]}…') was REJECTED by policy (never deliver)")
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
        outputs = {}
        for u in d.get("units", []):
            o = unit_output(run_id, u["ord"])
            if o:
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
        plan_path = ART / f"{tag}-plan-{run_id.replace(':', '_')}.md"
        plan_path.write_text(scrub(f"# {tag} — run {run_id} ({intent})\n\nPOST body:\n```json\n{json.dumps(post_body, indent=1)}\n```\n\n{plan_text}\n"))
        m["measured"]["plan_file"] = str(plan_path.relative_to(ROOT))
        m["measured"]["units_with_output"] = sorted(outputs)
        m["measured"]["plan"] = analyze_plan(plan_text) if plan_text else {"chars": 0, "names_real_files": False, "classifies": False}
        evs = run_events(run_id)
        m["measured"]["event_type_counts"] = {t: sum(1 for e in evs if e.get("type") == t) for t in sorted({e.get("type", "?") for e in evs})}
        m["measured"]["acceptance"] = acceptance(run_id)
        if m["measured"]["session"]["created_at"] is None:
            finding(f"{tag}: run {run_id} has created_at=null on GET /runs/:id (run-timing not recorded)")

        # ── Siblings / campaign / verdicts — immediately, after a grace period, then followed ──
        def siblings_now() -> dict:
            rs = list_runs()
            cs = list_campaigns()
            attributed = attribute_siblings(rs, cs, before=runs_before, own=run_ids, label=campaign_label, brief=INSTRUCTION)
            mine = [c for c in cs if campaign_label and c["id"] == campaign_label]
            return {
                **attributed,
                "new_campaigns": [c["id"] for c in cs if c["id"] not in camps_before],
                "campaign_for_label": [{"id": c["id"], "status": c["status"], "node_status": c.get("node_status"), "attached_runs": c.get("attached_runs")} for c in mine],
                "sibling_acceptance": {s["id"]: (acceptance(s["id"]) or {}).get("acceptance", {}).get("verdict") for s in attributed["attributable_siblings"]},
            }
        m["measured"]["siblings_at_terminal"] = siblings_now()
        log(f"{tag}: waiting {SIBLING_GRACE_S}s grace for delayed siblings")
        page.wait_for_timeout(SIBLING_GRACE_S * 1000)  # the first check; attributable siblings are then FOLLOWED
        m["measured"]["siblings_after_grace"] = siblings_now()
        sib = m["measured"]["siblings_after_grace"]
        if sib["attributable_siblings"]:
            ids = [s["id"] for s in sib["attributable_siblings"]]
            log(f"{tag}: following {len(ids)} attributable sibling(s) to terminal (max {SIBLING_FOLLOW_MAX_S}s)")
            m["measured"]["siblings_followed"] = follow_siblings(ids)
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


def write_report(report: dict | None = None, path: Path | None = None) -> Path:
    """Persist the evidence ATOMICALLY (tmp + os.replace): a reader never sees partial JSON and a
    crash never leaves a half-written report.json or a stray tmp file behind. Called after every
    scenario and on every exit path — a 30-minute run that dies at minute 29 still leaves the
    first two scenarios' measurements on disk."""
    report = REPORT if report is None else report
    path = path or (ART / "report.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(scrub(json.dumps(report, indent=1, default=str)))
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return path


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
    REPORT["preflight_policy"] = preflight_policy()
    if REPORT["preflight_policy"].get("contract_deviation"):
        log(f"CONTRACT DEVIATION: {REPORT['preflight_policy']['contract_deviation']}")
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
