"""power_mode_corpus.py — the power-mode run page corpus (switch `power_mode`, e2e/desk_power_mode_test.py).

Program DES-POWER-MODE and its approved mockup (design/mockups/power-mode.html): one orchestrator session builds the
change, rigor is sized at intake and re-scored at checkpoints, and applied once at hand-off. Every field is on the
crew-api-types 0.149.0 wire (crew#1201): `capabilities.powerMode`, `AgentSession.power` (PowerState), the /ws power
frames in each run's recorded trail, GET|POST /runs/:id/power and POST /runs/:id/rigor. The activity rows ride a
`powerActivity` frame the engine lane was asked for (not in 0.149.0).

  r-pm-build    building, after checkpoint 2: rigor went standard -> high (sign-in module touched), your note picked up.
  r-pm-handoff  at hand-off: checks passed, Codex approved on its own seat, Pi CLI's QE acceptance running.
  r-pm-pause    paused at checkpoint 3 ("this grew"): PowerState.pause (no engine gate; the run stays executing),
                answered on POST /runs/:id/power/pause; split into lanes recommended.
  r-pm-phased   phased is required (a regulated repository): the header's switch is Off and disabled.
  r-pm-done     delivered as PR #482.

Timestamps derive from the fixture's NOW0 (passed in), so the corpus is deterministic per server start. POSTs to the
power and rigor routes and to the pause gate are tapped (GET /__fixture/power-posts).
"""

from __future__ import annotations

import copy
import threading

SEC = 1_000
MIN = 60_000

POSTS: list[dict] = []
_lock = threading.Lock()
# Per-run state the POST routes change (the switch, raises), reset by reset().
_over: dict[str, dict] = {}

PROBLEM = ("Invoice PDFs show $ for EUR accounts. A customer billed in euros got a PDF that reads $1,240.00 instead of "
           "€1.240,00. Fix it in acme/billing-web and open a PR.")

APPROACH = ("Found it. Every amount on the PDF goes through `formatMoney()` in `src/lib/money.ts`, which hard-codes USD and "
            "`en-US`. The invoice already loads the account's `billingCurrency`; it just never reaches the template.\n\n"
            "My approach: pass the currency and locale through, cover EUR, GBP and JPY with tests, and keep USD output "
            "byte-for-byte the same. I'll check in at each commit, and anything you type below reaches me at the next "
            "checkpoint.")
PICKED = ("Picked up at commit 2: `/v1/invoice.pdf` now runs the same handler as `/v2`, and a test pins both URLs to "
          "the same bytes. The alias needed a line in the route guard in `src/auth/session.ts`, so this change now "
          "touches sign-in.")
HANDING = ("JPY now prints ¥1,240. All three commits are in, so I'm handing off: the checks run the full suite, Codex "
           "reviews on its own seat, and Pi CLI runs QE acceptance.")
REVIEW_OUT = ("VERDICT: PASS\n\nApprove. Two notes, neither blocking: `formatMoney` falls back to `en-US` silently when "
              "an account has no locale, which is worth a log line; and the `/v1` alias has no sunset date.")


def reset() -> None:
    with _lock:
        POSTS.clear()
        _over.clear()


def _unit(rid: str, key: str, ord_: int, stage: str, role: str, status: str, cli: str | None) -> dict:
    return {"id": f"{rid}:{key}", "session_id": rid, "ord": ord_, "description": f"{key} — show invoice amounts in the account's currency",
            "stage": stage, "role": role, "assigned_cli": cli, "assigned_invocation": None, "council_task_ref": None,
            "routing": None, "denial_reason": None, "phase_ref": key, "conformance_ref": None, "phase_status": None,
            "collection_scope": None, "status": status}


def _plan(t0: int, rigor: str = "standard", score: int = 34, phased: str | None = None, mandatory=None) -> dict:
    return {
        "rigor": rigor, "score": score, "band": "20-39" if rigor == "standard" else "40-69", "highRisk": False,
        "reasons": ["reach 12: 2 modules, 9 dependents within 3 hops", "no new files"],
        "handoff": {"tests": "targeted" if rigor in ("light", "standard") else "full",
                    "reviews": [{"kind": "distinct_seat", "why": "policy: a different seat reviews"}],
                    "qeAcceptance": {"required": True, "why": "a bug fix that changes the application"}, "checks": []},
        "mandatoryPhases": mandatory or [], "phasedRequired": phased, "estimateMinutes": 35,
        "risks": ["Rounding differs per currency (JPY has no minor unit)", "USD output must stay byte-for-byte the same"],
        "scenarios": ["EUR, GBP and JPY invoices render in their own format", "USD invoices are unchanged",
                      "Totals match the line items"],
        "floors": [{"rigor": "standard", "by": "policy", "why": "QE acceptance on application changes"}],
        "plannedBy": "pi", "at": t0 + 20 * SEC,
    }


def _change(seq: int, at: int, trigger: str, frm: str, to: str, planned: int, actual: int, checkpoint, reasons, turn=None,
            paused: bool = False, by: str = "engine") -> dict:
    return {"seq": seq, "at": at, "trigger": trigger, "from": frm, "to": to,
            "direction": "same" if frm == to else ("up" if ["light", "standard", "high", "highest"].index(to) > ["light", "standard", "high", "highest"].index(frm) else "down"),
            "planned": planned, "actual": actual, "delta": actual - planned, "reasons": reasons, "signals": None,
            "by": by, "floors": [], "checkpoint": checkpoint, "turn": turn, "paused": paused}


class _Trail:
    def __init__(self, rid: str, t0: int):
        self.rid, self.t0, self.seq, self.out = rid, t0, 0, []

    def add(self, type_: str, at_min: float, **extra) -> None:
        self.seq += 1
        self.out.append({"type": type_, "session": self.rid, "ts": self.t0 + int(at_min * MIN), "seq": self.seq, **extra})

    def act(self, at_min: float, turn: int, kind: str, **extra) -> None:
        self.add("powerActivity", at_min, ord=1, turn=turn, at=self.t0 + int(at_min * MIN), kind=kind, **extra)


def _build_trail(rid: str, t0: int, upto: str) -> tuple[list, list]:
    """The build as the mockup tells it, cut at `upto` ('build' | 'handoff' | 'pause' | 'done'). Returns (events, history)."""
    tr = _Trail(rid, t0)
    tr.add("sessionStarted", 0, problem=PROBLEM, workflowId="bugfix", cliCount=3, governed=True, entityMode="shared")
    tr.add("unitDispatched", 0.05, ord=0, attempt=0)
    plan = _plan(t0)
    tr.add("powerIntakePlanned", 0.3, ord=0, plan=plan)
    h = [_change(1, t0 + 20 * SEC, "intake", "standard", "standard", 34, 34, None, ["intake: change score 34"])]
    tr.add("rigorRescored", 0.35, change=h[0])
    tr.add("unitDone", 0.4, ord=0)
    tr.add("unitDispatched", 0.5, ord=1, attempt=0)
    tr.add("powerTurnStarted", 0.6, ord=1, attempt=0, turn=1, cli="claude")
    tr.act(0.8, 1, "read", paths=["src/lib/money.ts", "src/pdf/InvoiceTemplate.tsx", "src/routes/invoices.ts", "src/models/account.ts"])
    tr.add("powerTurnCompleted", 1, ord=1, attempt=0, turn=1, cli="claude", outcome="checkpoint", summary=APPROACH)
    tr.add("powerTurnStarted", 1.1, ord=1, attempt=0, turn=2, cli="claude")
    tr.act(3, 2, "edit", path="src/lib/money.ts", added=31, removed=6)
    tr.act(4, 2, "edit", path="src/pdf/InvoiceTemplate.tsx", added=9, removed=7)
    tr.act(5.5, 2, "test", command="npm test -- money invoice-pdf", passed=14, failed=0)
    tr.act(6, 2, "commit", sha="a41c9e2", subject="Format invoice amounts in the account's currency")
    h.append(_change(2, t0 + 7 * MIN, "commit", "standard", "standard", 34, 36, 1, ["3 files, 4 dependents, no sensitive area"], turn=2))
    tr.add("rigorRescored", 7, change=h[-1])
    tr.add("powerCheckpointReached", 7, ord=1, checkpoint=1, turn=2, trigger="commit", head="a41c9e2", picked=0, rigor="standard", paused=False)
    tr.act(9, 2, "edit", path="src/routes/invoices.ts", added=18, removed=11)
    tr.act(13, 2, "edit", path="src/routes/invoices.ts", added=9, removed=2)
    tr.act(14, 2, "edit", path="src/auth/session.ts", added=6, removed=1)
    tr.act(15, 2, "test", command="npm test -- invoices", passed=19, failed=0)
    tr.act(16, 2, "commit", sha="c07d1f3", subject="Serve /v2/invoice.pdf and keep /v1 as an alias")
    tr.add("powerCheckpointReached", 16, ord=1, checkpoint=2, turn=2, trigger="commit", head="c07d1f3", picked=1, rigor="high", paused=False)
    h.append(_change(3, t0 + 17 * MIN, "commit", "standard", "high", 34, 58, 2, ["sign-in module touched"], turn=2))
    tr.add("powerTurnCompleted", 16.5, ord=1, attempt=0, turn=2, cli="claude", outcome="checkpoint", summary=PICKED)
    tr.add("rigorRescored", 17, change=h[-1])
    tr.add("powerTurnStarted", 17.2, ord=1, attempt=0, turn=3, cli="claude")
    if upto == "build":
        return tr.out, h
    if upto == "pause":
        tr.act(20, 3, "edit", path="src/payments/charge.ts", added=24, removed=3)
        tr.act(22, 3, "test", command="npm test -- jpy-rounding", passed=11, failed=1)
        tr.act(25, 3, "test", command="npm test -- jpy-rounding", passed=11, failed=1)
        tr.act(28, 3, "test", command="npm test -- jpy-rounding", passed=11, failed=1)
        h.append(_change(4, t0 + 29 * MIN, "turn", "high", "highest", 34, 78, 3,
                         ["payments touched, and a new dependency (currency-codes)"], turn=3, paused=True))
        tr.add("powerCheckpointReached", 29, ord=1, checkpoint=3, turn=3, trigger="turn", head="c07d1f3", picked=0, rigor="highest", paused=True,
               pause=_pause(t0), at=t0 + 29 * MIN)
        tr.add("rigorRescored", 29, change=h[-1])
        tr.add("powerTurnCompleted", 29.2, ord=1, attempt=0, turn=3, cli="claude", outcome="paused",
               summary="I stopped at the end of this turn: the JPY rounding fix reaches `payments/charge.ts`, and its test has failed three runs in a row.")
        return tr.out, h
    tr.act(19, 3, "edit", path="src/lib/money.ts", added=7, removed=2)
    tr.act(26, 3, "test", command="npm test", passed=412, failed=0)
    tr.act(26, 3, "commit", sha="e19b77a", subject="Respect each currency's minor units")
    h.append(_change(4, t0 + 27 * MIN, "commit", "high", "high", 34, 58, 3, ["no new sensitive area"], turn=3))
    tr.add("rigorRescored", 27, change=h[-1])
    tr.add("powerCheckpointReached", 27, ord=1, checkpoint=3, turn=3, trigger="pre_handoff", head="e19b77a", picked=0, rigor="high", paused=False)
    tr.add("powerTurnCompleted", 27.2, ord=1, attempt=0, turn=3, cli="claude", outcome="handoff", summary=HANDING)
    tr.add("unitDone", 27.3, ord=1)
    step = lambda name, status, seat, summary, at: {"step": name, "ord": None, "status": status, "seat": seat, "summary": summary, "at": t0 + int(at * MIN)}  # noqa: E731
    tr.add("powerHandoffStepped", 27.4, round=1, step=step("checks", "running", None, None, 27.4))
    tr.add("powerHandoffStepped", 33, round=1, step=step("checks", "passed", None, "install 71 s · typecheck 8 s · lint 5 s · 412 tests 3 min 52 s · build 44 s", 33))
    tr.add("unitDispatched", 27.5, ord=2, attempt=0)
    tr.add("powerHandoffStepped", 27.5, round=1, step=step("review", "running", "codex", None, 27.5))
    tr.add("unitDone", 31, ord=2)
    tr.add("powerHandoffStepped", 31, round=1, step=step("review", "passed", "codex", "Read-only review of 3 commits · 2 notes, neither blocking · not the seat that wrote it", 31))
    tr.add("unitDispatched", 33.2, ord=3, attempt=0)
    if upto == "handoff":
        tr.add("powerHandoffStepped", 33.2, round=1, step=step("qe", "running", "pi", None, 33.2))
        tr.add("powerHandoffStepped", 33.2, round=1, step=step("compliance", "pending", "pi", None, 33.2))
        return tr.out, h
    tr.add("powerHandoffStepped", 36, round=1, step=step("qe", "passed", "pi", "7 of 7 acceptance checks (EUR, GBP, JPY, USD unchanged, /v1 alias, totals, PDF text layer)", 36))
    tr.add("powerHandoffStepped", 36, round=1, step=step("compliance", "passed", "pi", "no customer data in logs", 36))
    tr.add("unitDone", 36, ord=3)
    tr.add("awaitingHuman", 36.1, ord=4, prompt="Deliver the currency fix as a pull request?", gateKind="deliver")
    tr.add("resumed", 41, ord=4)
    tr.add("unitDone", 41, ord=4)
    tr.add("sessionCompleted", 41.2)
    return tr.out, h


def _pause(t0: int) -> dict:
    return {"at": t0 + 29 * MIN, "checkpoint": 3,
            "reasons": ["The diff now spans 3 packages: payments/charge.ts was touched",
                        "A new dependency (currency-codes) landed in a sensitive area",
                        "The JPY rounding test failed 3 runs in a row; 29 min in, against an estimate of 35"],
            "recommended": "split"}


def _power(t0: int, history: list, *, rigor: str, turns: int, in_turn: bool, checkpoints: int, handoff=None, pause=None,
           on: bool = True, available: bool = True, refused: str | None = None, plan=None) -> dict:
    return {"on": on, "available": available, "refusedReason": refused, "rigor": rigor, "plan": plan or _plan(t0),
            "history": history, "toggles": [],
            "orchestrator": {"cli": "claude", "ord": 1, "turns": turns, "inTurn": in_turn, "sessionRestarts": 0},
            "checkpoints": checkpoints, "handoff": handoff, "pause": pause, "outcome": None}


def _run(rid: str, status: str, t0: int, units: list, power: dict, *, ended=None) -> dict:
    s = {"id": rid, "workflow_id": "bugfix", "problem": PROBLEM, "entity_mode": "shared", "collection_scope": None,
         "clis": ["claude", "codex", "pi"], "status": status, "human_confirm": "none", "unit_ix": 1, "attempt": 0,
         "workdir": f"/w/pm/{rid}", "repo_ref": "acme/billing-web", "extra_write_roots": [], "archived_at": None,
         "archive_note": None, "created_at": t0 // 1000, "power": power}
    if ended is not None:
        s["ended_at"] = ended // 1000
    return {"session": s, "units": units}


def _units(rid: str, build: str, review: str, qe: str, deliver: str) -> list:
    return [_unit(rid, "intake", 0, "test_plan", "neutral", "done", "pi"),
            _unit(rid, "build", 1, "build", "creator", build, "claude"),
            _unit(rid, "review", 2, "review", "evaluator", review, "codex"),
            _unit(rid, "qe", 3, "test", "evaluator", qe, "pi"),
            _unit(rid, "deliver", 4, "build", "neutral", deliver, None)]


def _corpus(now0: int) -> dict:
    out: dict[str, dict] = {}
    t_build = now0 - 19 * MIN
    ev, h = _build_trail("r-pm-build", t_build, "build")
    out["r-pm-build"] = {"run": _run("r-pm-build", "executing", t_build, _units("r-pm-build", "executing", "pending", "pending", "pending"),
                                     _power(t_build, h, rigor="high", turns=3, in_turn=True, checkpoints=2)), "events": ev}
    t_hand = now0 - 34 * MIN
    ev, h = _build_trail("r-pm-handoff", t_hand, "handoff")
    steps = [e["step"] for e in ev if e["type"] == "powerHandoffStepped"]
    latest: dict[str, dict] = {}
    for s in steps:
        latest[s["step"]] = s
    out["r-pm-handoff"] = {"run": _run("r-pm-handoff", "executing", t_hand, _units("r-pm-handoff", "done", "done", "executing", "pending"),
                                       _power(t_hand, h, rigor="high", turns=3, in_turn=False, checkpoints=3,
                                              handoff={"round": 1, "maxRounds": 3, "steps": list(latest.values())})), "events": ev}
    t_pause = now0 - 30 * MIN
    ev, h = _build_trail("r-pm-pause", t_pause, "pause")
    pause = _pause(t_pause)
    out["r-pm-pause"] = {"run": _run("r-pm-pause", "executing", t_pause, _units("r-pm-pause", "executing", "pending", "pending", "pending"),
                                     _power(t_pause, h, rigor="highest", turns=3, in_turn=False, checkpoints=3, pause=pause)), "events": ev}
    t_ph = now0 - 50 * MIN
    plan_ph = _plan(t_ph, "high", 52, phased="regulated repository (acme/payments-core)",
                    mandatory=[{"phase": "design", "why": "policy: payments changes get a design review"}])
    tr = _Trail("r-pm-phased", t_ph)
    tr.add("sessionStarted", 0, problem="Round refunds to the currency's minor unit", workflowId="bugfix", cliCount=2, governed=True, entityMode="shared")
    tr.add("powerIntakePlanned", 0.3, ord=0, plan=plan_ph)
    tr.add("unitDispatched", 0.5, ord=1, attempt=0)
    ph_units = [_unit("r-pm-phased", "intake", 0, "test_plan", "neutral", "done", "pi"),
                _unit("r-pm-phased", "design", 1, "design", "creator", "executing", "claude"),
                _unit("r-pm-phased", "fix", 2, "build", "creator", "pending", "claude"),
                _unit("r-pm-phased", "review", 3, "review", "evaluator", "pending", "codex")]
    run_ph = _run("r-pm-phased", "executing", t_ph, ph_units,
                  _power(t_ph, [_change(1, t_ph + 20 * SEC, "intake", "high", "high", 52, 52, None, ["intake"])], rigor="high", turns=0,
                         in_turn=False, checkpoints=0, on=False, available=False, refused="regulated repository (acme/payments-core)", plan=plan_ph))
    run_ph["session"]["problem"] = "Round refunds to the currency's minor unit"
    run_ph["session"]["repo_ref"] = "acme/payments-core"
    out["r-pm-phased"] = {"run": run_ph, "events": tr.out}
    t_done = now0 - 3 * 60 * MIN
    ev, h = _build_trail("r-pm-done", t_done, "done")
    steps = {}
    for e in ev:
        if e["type"] == "powerHandoffStepped":
            steps[e["step"]["step"]] = e["step"]
    done = _run("r-pm-done", "completed", t_done, _units("r-pm-done", "done", "done", "done", "done"),
                _power(t_done, h, rigor="high", turns=3, in_turn=False, checkpoints=3,
                       handoff={"round": 1, "maxRounds": 3, "steps": list(steps.values())}), ended=t_done + int(41.2 * MIN))
    done["session"]["delivery"] = {"pr": {"url": "https://github.com/acme/billing-web/pull/482", "number": 482}}
    out["r-pm-done"] = {"run": done, "events": ev}
    # The POST routes' changes, folded over the built state.
    with _lock:
        for rid, ov in _over.items():
            if rid in out:
                p = out[rid]["run"]["session"]["power"]
                p.update({k: v for k, v in ov.items() if k != "history_add"})
                p["history"] = p["history"] + ov.get("history_add", [])
    return out


def corpus(now0: int) -> dict:
    c = _corpus(now0)
    order = ["r-pm-build", "r-pm-handoff", "r-pm-pause", "r-pm-phased", "r-pm-done"]
    return {"runs": [copy.deepcopy(c[r]["run"]) for r in order]}


def _view(now0: int, rid: str) -> dict | None:
    c = _corpus(now0).get(rid)
    return None if c is None else dict(c["run"]["session"]["power"], runId=rid)


DISPLAY = {"claude": "Claude Code", "codex": "Codex", "pi": "Pi CLI", "agy": "Antigravity", "copilot": "GitHub Copilot CLI"}


def _iso(ms: int) -> str:
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _system(now0: int) -> dict:
    """GET /system as crew will answer it once wicked-crew#1206 lands: the paused run waits on you (a decision),
    every other power run is working; no system trouble."""
    c = _corpus(now0)
    runs, attention = [], []
    for rid, entry in c.items():
        s = entry["run"]["session"]
        if s["status"] in ("completed", "failed", "cancelled"):
            continue
        paused = s["power"].get("pause") is not None
        runs.append({"runId": rid, "title": s["problem"][:60], "liveness": "waiting_on_you" if paused else "working",
                     "phase": "build", "seat": "claude", "lastEventAt": _iso(now0 - MIN),
                     "reason": "waiting on you: this grew past its plan (checkpoint 3)" if paused else "working: last event 1 min ago",
                     "gate": None})
        if paused:
            attention.append({"id": f"pause:{rid}", "severity": "yellow", "source": "run", "kind": "prevents",
                              "title": "A power job grew past its plan and waits on you",
                              "reason": "Split it, switch to phased, continue at high rigor, or stop.", "remedy": None,
                              "target": {"kind": "run", "runId": rid}, "action": {"kind": "open_run"},
                              "blockedRunIds": [rid], "waitedSince": s["power"]["pause"]["at"]})
    return {"checkedAt": _iso(now0), "budgetMs": 2000, "tookMs": 5, "level": "yellow" if attention else "green",
            "attention": attention, "unresolved": [], "unresolvedSpend": {"usd": 0, "runs": 0}, "toReview": 0,
            "clis": [], "runs": runs, "infra": [], "governance": []}


def get(path: str, now0: int):
    """(status, body) for a power_mode route, or None to fall through to the fixture."""
    parts = path.split("/")
    if path == "/api/v1/system":
        return 200, _system(now0)
    if path == "/__fixture/power-posts":
        with _lock:
            return 200, {"posts": list(POSTS)}
    if len(parts) < 6 or parts[3] != "runs" or not parts[4].startswith("r-pm-"):
        return None
    rid = parts[4]
    c = _corpus(now0).get(rid)
    if c is None:
        return 404, {"error": "unknown run"}
    if len(parts) == 8 and parts[5] == "units" and parts[7] == "output":
        key = parts[6]
        text = REVIEW_OUT if key == "review" else ("QE acceptance: 7 of 7 checks passed." if key == "qe" else None)
        return 200, ({"output": text} if text is not None else {"output": None, "outputUnavailable": "no output was captured for this step"})
    if len(parts) != 6:
        return None
    leaf = parts[5]
    if leaf == "events":
        return 200, {"events": copy.deepcopy(c["events"])}
    if leaf == "power":
        return 200, _view(now0, rid)
    if leaf == "gate":
        g = c.get("gate")
        if g is None:
            return 404, {"error": "no open gate"}
        import datetime
        at = datetime.datetime.fromtimestamp(g["receivedAt"] / 1000, tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        return 200, {"runId": rid, "ord": g["ord"], "lifecycle": "open", "prompt": g["prompt"], "receivedAt": at, "gateKind": g["gateKind"], "options": None}
    if leaf == "team":
        return 200, {"runId": rid, "teamed": False, "transport": None, "reason": None, "planRev": None, "ended": False, "units": [], "rows": []}
    if leaf == "acceptance":
        return 404, {"error": "no acceptance for this run"}
    return None


RIGORS = ["light", "standard", "high", "highest"]


def post(path: str, body: dict, now0: int):
    """(status, body) for a power_mode POST, or None to fall through."""
    parts = path.split("/")
    if len(parts) == 7 and parts[3] == "runs" and parts[4].startswith("r-pm-") and parts[5] == "power" and parts[6] == "pause":
        rid = parts[4]
        c = _corpus(now0).get(rid)
        if c is None:
            return 404, {"error": "unknown run"}
        with _lock:
            POSTS.append({"runId": rid, "route": "pause", "body": body})
        if c["run"]["session"]["power"]["pause"] is None:
            return 409, {"error": "not paused", "reason": "this job is not paused"}
        with _lock:
            ov = _over.setdefault(rid, {})
            ov["pause"] = None
            if body.get("decision") == "switch_phased":
                ov["on"] = False
        return 200, _view(now0, rid)
    if len(parts) != 6 or parts[3] != "runs" or not parts[4].startswith("r-pm-"):
        return None
    rid, leaf = parts[4], parts[5]
    c = _corpus(now0).get(rid)
    if c is None:
        return 404, {"error": "unknown run"}
    p = c["run"]["session"]["power"]
    if leaf == "power":
        with _lock:
            POSTS.append({"runId": rid, "route": "power", "body": body})
        on = body.get("on") is True
        if on and not p["available"]:
            return 409, {"error": "phased is required", "reason": p["refusedReason"]}
        with _lock:
            ov = _over.setdefault(rid, {})
            ov["on"] = on
            ov["toggles"] = p["toggles"] + [{"at": now0, "on": on, "by": "operator", "reason": body.get("reason"), "stayPhased": []}]
        return 200, _view(now0, rid)
    if leaf == "rigor":
        with _lock:
            POSTS.append({"runId": rid, "route": "rigor", "body": body})
        to = body.get("atLeast")
        cur = p["rigor"]
        if to not in RIGORS or RIGORS.index(to) <= RIGORS.index(cur):
            return 409, {"error": "rigor never goes down", "reason": f"rigor is already {cur}"}
        seq = max((h["seq"] for h in p["history"]), default=0) + 1
        with _lock:
            ov = _over.setdefault(rid, {})
            ov["rigor"] = to
            ov["history_add"] = ov.get("history_add", []) + [_change(seq, now0, "operator", cur, to, p["plan"]["score"], p["plan"]["score"], None, [body.get("reason") or "raised by you"], by="operator")]
        return 200, _view(now0, rid)
    if leaf == "gate":
        with _lock:
            POSTS.append({"runId": rid, "route": "gate", "body": body})
        return 200, {"status": "resumed"}
    return None
