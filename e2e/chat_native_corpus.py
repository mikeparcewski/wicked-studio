"""chat_native_corpus.py — the run-page-as-chat corpus (switch `chat_native`, e2e/desk_chat_native_test.py).

Six sessions the chat-native run page is judged on, every field on the REAL crew wire:

  r-cn-bug   a finished Bug run (bugfix: understand → build → test → review → deliver), PR #12 opened,
             QE acceptance PASS; each unit's captured output served on GET /runs/:id/units/:key/output.
  r-cn-plan  a run waiting at its plan approval (gateKind plan_approval; the PA's proposal on /team).
  r-cn-live  a run in progress: research done (its output served), build executing.
  chat-cn-qa a plain chat Q&A (a live transcript: two operator turns, two replies with markdown + code).
  r-cn-fail  a run that failed: research done, its build step rejected (the run panel's failed state).
  r-cn-old   an old run opened fresh: finished 12 days ago, archived, launched from a chat crew has since
             reclaimed (`chat-cn-gone`: scope null, no messages) — its conversation is rebuilt from the run.

Timestamps derive from the fixture's NOW0 (passed in), so the corpus is deterministic per server start.
"""

from __future__ import annotations

MIN = 60_000


def _unit(rid: str, key: str, ord_: int, stage: str, role: str, status: str, cli: str | None, desc: str) -> dict:
    return {"id": f"{rid}:{key}", "session_id": rid, "ord": ord_, "description": desc, "stage": stage, "role": role,
            "assigned_cli": cli, "assigned_invocation": None, "council_task_ref": None, "routing": None,
            "denial_reason": None, "phase_ref": key, "conformance_ref": None, "phase_status": None,
            "collection_scope": None, "status": status}


def _run(rid: str, status: str, problem: str, created_s: int, *, ended_s: int | None = None, units: list,
         unit_ix: int = 0, chat: str | None = None, **extra) -> dict:
    s = {"id": rid, "workflow_id": "bugfix", "problem": problem, "entity_mode": "shared", "collection_scope": None,
         "clis": ["claude", "codex"], "status": status, "human_confirm": "all" if status == "awaiting_human" else "none",
         "unit_ix": unit_ix, "attempt": 0, "workdir": f"/w/cn/{rid}", "repo_ref": None, "extra_write_roots": [],
         "archived_at": None, "archive_note": None, "created_at": created_s}
    if ended_s is not None:
        s["ended_at"] = ended_s
    if chat is not None:
        s["chat_id"] = chat
    s.update(extra)
    return {"session": s, "units": units}


BUG_PROBLEM = "Checkout charges customers twice when they double-click Pay. Find the cause and fix it."
PLAN_PROBLEM = "Add rate limiting to the public upload endpoint so one client can't flood it."
LIVE_PROBLEM = "Add a CSV export button to the orders page."
FAIL_PROBLEM = "Move the nightly report job off the old cron host."
FAIL_DENIAL = "the build step could not reach the scheduler API: 403 from scheduler.internal (the run's token has no write scope)"
OLD_PROBLEM = "Rename the invoice fields to match the new billing API (amount_due, due_on)."

OUTPUTS = {
    ("r-cn-bug", "understand"): (
        "## What I found\n\n"
        "The Pay button posts `createCharge` on every click, and the handler has no idempotency key. "
        "A double-click sends two requests about 120 ms apart, and both succeed.\n\n"
        "- `src/checkout/PayButton.tsx` re-enables the button before the request resolves.\n"
        "- `api/charges.ts` creates a new charge per request; Stripe never sees a shared key.\n\n"
        "Plan: disable the button while the charge is pending, and send an idempotency key per order."),
    ("r-cn-bug", "build"): (
        "## What I changed\n\n"
        "1. `PayButton.tsx`: the button stays disabled until the charge settles.\n"
        "2. `api/charges.ts`: every charge carries `Idempotency-Key: order-<id>`, so a repeat is a no-op.\n"
        "3. Added `charges.test.ts` with a double-submit case.\n\n"
        "```ts\nconst charge = await stripe.charges.create(params, {\n  idempotencyKey: `order-${order.id}`,\n});\n```"),
    ("r-cn-bug", "test"): (
        "Ran the checkout suite: **38 passed**, 0 failed. The new double-submit test fails on the old code "
        "and passes on the fix."),
    ("r-cn-bug", "review"): (
        "VERDICT: PASS\n\nThe fix covers both the UI and the API. The idempotency key is per order, so a "
        "genuine second purchase still goes through. No other callers of `createCharge` skip the key."),
    ("r-cn-bug", "deliver"): "Pushed branch `wicked/r-cn-bug` and opened pull request #12.",
    ("r-cn-live", "understand"): (
        "## What I found\n\nThe orders page already loads every row it shows through `useOrders()`, so the "
        "export can reuse that query. There is no CSV helper in the codebase yet; `papaparse` is already a "
        "dependency of the reports page.\n\nI'll add an **Export CSV** button beside the filters."),
    ("r-cn-fail", "understand"): (
        "The nightly report runs from `cron/report.sh` on the old host. The scheduler API can run it as a job; "
        "the run needs a token with write scope to create one."),
    ("r-cn-old", "understand"): (
        "Found 14 uses of `total` and `due_date` across the invoice module and two report templates."),
    ("r-cn-old", "build"): (
        "Renamed `total` → `amount_due` and `due_date` → `due_on` in the invoice model, the API mapper and "
        "both report templates. Added a migration for the stored JSON column."),
    ("r-cn-old", "review"): "VERDICT: PASS\n\nThe migration is reversible and every template renders.",
    ("r-cn-old", "deliver"): "Pushed branch `wicked/r-cn-old` and opened pull request #7.",
}

PLAN_PROMPT = ("Approve plan rev 1 before unit 1 runs (band 40-69; auto mode): understand → build → test → review → "
               "deliver. Approve, approve with an edited plan, or reject.")

QA_MESSAGES = [
    {"kind": "user", "text": "What does the retry policy on the payments worker do today?", "turnId": "t1"},
    {"kind": "seat", "cliKey": "claude", "turnId": "t1", "ok": True, "text": (
        "The payments worker retries a failed charge **three times** with exponential backoff:\n\n"
        "1. after 2 seconds\n2. after 8 seconds\n3. after 32 seconds\n\n"
        "After the third failure it moves the job to the `payments-dead` queue and pages on-call. "
        "The policy lives in `workers/payments/retry.ts`:\n\n"
        "```ts\nexport const RETRY = { attempts: 3, baseMs: 2000, factor: 4 };\n```")},
    {"kind": "user", "text": "Is that safe now that charges are idempotent?", "turnId": "t2"},
    {"kind": "seat", "cliKey": "claude", "turnId": "t2", "ok": True, "text": (
        "Yes. Each retry sends the same `Idempotency-Key`, so Stripe returns the first charge instead of "
        "creating a new one. The one gap is the refund path, which still builds a fresh key per attempt. "
        "I'd fix that before raising the attempt count.")},
]


def corpus(now0: int) -> dict:
    t = now0 // 1000
    bug = _run("r-cn-bug", "completed", BUG_PROBLEM, t - 3 * 3600, ended_s=t - 2 * 3600, unit_ix=5, units=[
        _unit("r-cn-bug", "understand", 1, "recon", "neutral", "done", "claude", "understand — find the double charge"),
        _unit("r-cn-bug", "build", 2, "build", "creator", "done", "claude", "build — fix the double charge"),
        _unit("r-cn-bug", "test", 3, "build", "neutral", "done", "claude", "test — run the checkout suite"),
        _unit("r-cn-bug", "review", 4, "review", "evaluator", "done", "codex", "review — check the fix"),
        _unit("r-cn-bug", "deliver", 5, "build", "neutral", "done", None, "deliver — open the pull request"),
    ], delivery="delivered", deliverUrl="https://github.com/acme/shop/pull/12", run_branch="wicked/r-cn-bug",
        cost_usd=1.84)
    plan = _run("r-cn-plan", "awaiting_human", PLAN_PROBLEM, t - 4 * 60, unit_ix=1, units=[
        _unit("r-cn-plan", "pa-scope", 0, "recon", "neutral", "done", "claude", "scope the work"),
        _unit("r-cn-plan", "understand", 1, "recon", "neutral", "pending", None, "understand"),
        _unit("r-cn-plan", "build", 2, "build", "creator", "pending", None, "build"),
        _unit("r-cn-plan", "test", 3, "build", "neutral", "pending", None, "test"),
        _unit("r-cn-plan", "review", 4, "review", "evaluator", "pending", None, "review"),
        _unit("r-cn-plan", "deliver", 5, "build", "neutral", "pending", None, "deliver"),
    ], run_identity={"kind": "preset", "name": "feature", "user_plan": False, "system": False}, workflow_id="feature")
    live = _run("r-cn-live", "executing", LIVE_PROBLEM, t - 9 * 60, unit_ix=1, units=[
        _unit("r-cn-live", "understand", 1, "recon", "neutral", "done", "claude", "understand — the orders page"),
        _unit("r-cn-live", "build", 2, "build", "creator", "distributed", "claude", "build — the CSV export"),
        _unit("r-cn-live", "review", 3, "review", "evaluator", "pending", "codex", "review"),
        _unit("r-cn-live", "deliver", 4, "build", "neutral", "pending", None, "deliver"),
    ])
    fail = _run("r-cn-fail", "failed", FAIL_PROBLEM, t - 50 * 60, ended_s=t - 38 * 60, unit_ix=2, units=[
        _unit("r-cn-fail", "understand", 1, "recon", "neutral", "done", "claude", "understand — the report job"),
        dict(_unit("r-cn-fail", "build", 2, "build", "creator", "rejected", "claude", "build — move the job"), denial_reason=FAIL_DENIAL),
        _unit("r-cn-fail", "review", 3, "review", "evaluator", "pending", "codex", "review"),
    ])
    old = _run("r-cn-old", "completed", OLD_PROBLEM, t - 12 * 86400, ended_s=t - 12 * 86400 + 1500, unit_ix=4,
               chat="chat-cn-gone", units=[
        _unit("r-cn-old", "understand", 1, "recon", "neutral", "done", "claude", "understand"),
        _unit("r-cn-old", "build", 2, "build", "creator", "done", "claude", "build"),
        _unit("r-cn-old", "review", 3, "review", "evaluator", "done", "codex", "review"),
        _unit("r-cn-old", "deliver", 4, "build", "neutral", "done", None, "deliver"),
    ], delivery="delivered", deliverUrl="https://github.com/acme/billing/pull/7", run_branch="wicked/r-cn-old",
        archived_at=t - 5 * 86400)
    return {"runs": [bug, plan, live, fail, old]}


def _team(rid: str, rows: list, units: list | None = None) -> dict:
    return {"runId": rid, "transport": "bus", "reason": None, "planRev": 1, "pending": None, "ended": False,
            "teamed": True, "streamFloor": None, "rows": rows, "units": units or []}


def _untamed(rid: str) -> dict:
    return {"runId": rid, "streamFloor": None, "pending": None, "units": [], "rows": [], "teamed": False,
            "transport": None, "reason": None, "planRev": None, "ended": False}


def _events(rid: str, now0: int) -> list:
    if rid == "r-cn-bug":
        t0 = now0 - 3 * 3600 * 1000
        return [
            {"type": "sessionStarted", "session": rid, "ts": t0, "seq": 1},
            {"type": "awaitingHuman", "session": rid, "ord": 1, "prompt": "Approve plan rev 1 before unit 1 runs: understand → build → test → review → deliver.", "gateKind": "plan_approval", "ts": t0 + 40_000, "seq": 2},
            {"type": "gateDecided", "session": rid, "ord": 1, "allow": True, "ts": t0 + 95_000, "seq": 3},
            {"type": "unitDone", "session": rid, "ord": 1, "ts": t0 + 6 * MIN, "seq": 4},
            {"type": "unitDone", "session": rid, "ord": 2, "ts": t0 + 21 * MIN, "seq": 5},
            {"type": "unitDone", "session": rid, "ord": 3, "ts": t0 + 26 * MIN, "seq": 6},
            {"type": "unitDone", "session": rid, "ord": 4, "ts": t0 + 33 * MIN, "seq": 7},
            {"type": "unitDone", "session": rid, "ord": 5, "ts": t0 + 35 * MIN, "seq": 8},
            {"type": "sessionCompleted", "session": rid, "ts": t0 + 35 * MIN, "seq": 9},
        ]
    if rid == "r-cn-old":
        t0 = now0 - 12 * 86400 * 1000
        return [
            {"type": "sessionStarted", "session": rid, "ts": t0, "seq": 1},
            {"type": "unitDone", "session": rid, "ord": 1, "ts": t0 + 4 * MIN, "seq": 2},
            {"type": "unitDone", "session": rid, "ord": 2, "ts": t0 + 15 * MIN, "seq": 3},
            {"type": "unitDone", "session": rid, "ord": 3, "ts": t0 + 21 * MIN, "seq": 4},
            {"type": "unitDone", "session": rid, "ord": 4, "ts": t0 + 25 * MIN, "seq": 5},
            {"type": "sessionCompleted", "session": rid, "ts": t0 + 25 * MIN, "seq": 6},
        ]
    if rid == "r-cn-fail":
        t0 = now0 - 50 * MIN
        return [
            {"type": "sessionStarted", "session": rid, "ts": t0, "seq": 1},
            {"type": "unitDone", "session": rid, "ord": 1, "ts": t0 + 5 * MIN, "seq": 2},
            {"type": "unitDispatched", "session": rid, "ord": 2, "attempt": 0, "cli": "claude", "ts": t0 + 5 * MIN + 2000, "seq": 3},
            {"type": "stepFailed", "session": rid, "ord": 2, "attempt": 0, "detail": FAIL_DENIAL, "ts": t0 + 12 * MIN, "seq": 4},
            {"type": "sessionFailed", "session": rid, "error": FAIL_DENIAL, "ts": t0 + 12 * MIN, "seq": 5},
        ]
    if rid == "r-cn-live":
        t0 = now0 - 9 * MIN
        return [
            {"type": "sessionStarted", "session": rid, "ts": t0, "seq": 1},
            {"type": "unitDone", "session": rid, "ord": 1, "ts": t0 + 4 * MIN, "seq": 2},
            {"type": "unitDispatched", "session": rid, "ord": 2, "attempt": 1, "cli": "claude", "ts": t0 + 4 * MIN + 2000, "seq": 3},
        ]
    return []


def _acceptance(rid: str) -> dict | None:
    if rid not in ("r-cn-bug", "r-cn-old"):
        return None
    gate = {"required": True, "satisfied": True, "verdict": "PASS",
            "reason": "the repo's checks passed (38 tests) and codex reviewed the change"}
    return {"runId": rid, "gate": gate,
            "summary": {"required": True, "satisfied": True, "line": "QE acceptance passed: 38 tests pass, reviewed by codex.",
                        "walkthrough": None}}


def get(path: str, now0: int):
    """(status, body) for a chat_native route, or None to fall through to the fixture."""
    parts = path.split("/")
    if path == "/api/v1/chats/chat-cn-qa":
        t = now0 - 20 * MIN
        msgs = [dict(m, at=t + i * 45_000) for i, m in enumerate(QA_MESSAGES)]
        return 200, {"chatId": "chat-cn-qa", "seats": ["claude"], "scope": {"projectId": None}, "messages": msgs}
    if path == "/api/v1/chats/chat-cn-gone":
        return 200, {"chatId": "chat-cn-gone", "seats": [], "scope": None, "messages": []}
    if len(parts) != 6 or parts[3] != "runs" or not parts[4].startswith("r-cn-"):
        if len(parts) == 7 and parts[3] == "runs" and parts[4].startswith("r-cn-") and parts[5] == "units":
            return None
        if len(parts) == 8 and parts[3] == "runs" and parts[4].startswith("r-cn-") and parts[7] == "output":
            out = OUTPUTS.get((parts[4], parts[6]))
            return (200, {"output": out}) if out is not None else (200, {"output": None, "outputUnavailable": "no output was captured for this step"})
        return None
    rid, leaf = parts[4], parts[5]
    if leaf == "events":
        return 200, {"events": _events(rid, now0)}
    if leaf == "team":
        if rid == "r-cn-plan":
            return 200, _team(rid, [{"event_id": 801, "event_type": "wicked.team.plan.proposed", "payload": {
                "kind": "initial", "by": "claude", "steps": [
                    {"catalog": "understand", "id": "understand"}, {"catalog": "build", "id": "build"},
                    {"catalog": "test", "id": "test"}, {"catalog": "review", "id": "review"},
                    {"catalog": "deliver", "id": "deliver"}]}},
                {"event_id": 802, "event_type": "wicked.team.path.scored", "payload": {
                    "score": 46, "deterministic": 46, "basis": "intent",
                    "reasons": ["touches a public endpoint", "a new middleware in the request path"]}}],
                [{"ord": 1, "rows": [{"event_id": 803, "event_type": "wicked.team.gate.opened", "payload": {
                    "kind": "plan_approval", "gate_id": "g-cn-plan", "ord": 1, "plan_rev": 1, "band": "40-69",
                    "high_risk": False, "mode": "auto", "reason": None, "reviewing_ord": 0}}]}])
        if rid == "r-cn-live":
            # The run's team (the run panel's Agents and spend): claude leads (chosen), score 30 → 1 monitor;
            # codex could not open as a member (the reason is shown), pi watches; the research step went to pi.
            return 200, _team(rid, [
                {"event_id": 821, "event_type": "wicked.team.path.started", "payload": {
                    "cli": "claude", "selection": "chosen", "roster": ["claude", "codex", "pi"], "workflow": "feature"}},
                {"event_id": 822, "event_type": "wicked.team.path.scored", "payload": {
                    "score": 30, "deterministic": 30, "basis": "intent", "plan": {"monitors": 1, "depth": "standard"},
                    "reasons": ["reach 30: 3 changed symbols"]}}],
                [{"ord": 1, "rows": [{"event_id": 823, "event_type": "wicked.team.step.claimed", "payload": {
                    "ord": 1, "attempt": 0, "by": "pi", "step_id": "understand", "phase": "understand", "role": "neutral",
                    "kind": "agent"}}]},
                 {"ord": 2, "rows": [
                     {"event_id": 824, "event_type": "wicked.team.step.claimed", "payload": {
                         "ord": 2, "attempt": 0, "by": "claude", "step_id": "build", "phase": "build", "role": "creator",
                         "kind": "agent"}},
                     {"event_id": 825, "event_type": "wicked.team.member.joined", "payload": {
                         "ord": 2, "attempt": 0, "member_id": "m1", "open_seq": 1, "seat": "codex", "role": "monitor",
                         "status": "failed", "reason": "team plan monitors=1",
                         "error": "codex's seat container could not start: the seat image is not built"}},
                     {"event_id": 826, "event_type": "wicked.team.member.joined", "payload": {
                         "ord": 2, "attempt": 0, "member_id": "m2", "open_seq": 1, "seat": "pi", "role": "monitor",
                         "status": "attached", "reason": "team plan monitors=1", "error": None}}]}])
        return 200, _untamed(rid)
    if leaf == "gate":
        if rid == "r-cn-plan":
            return 200, {"runId": rid, "ord": 1, "lifecycle": "open", "prompt": PLAN_PROMPT,
                         "receivedAt": _iso(now0 - 3 * MIN), "gateKind": "plan_approval", "options": None}
        return 404, {"error": "no open gate"}
    if leaf == "acceptance":
        body = _acceptance(rid)
        return (200, body) if body is not None else (404, {"error": "no acceptance for this run"})
    return None


def _iso(ms: int) -> str:
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")
