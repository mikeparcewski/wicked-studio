#!/usr/bin/env python3
"""
Offline regression tests for the live Test-feature harness (`e2e/test_feature_live.py`).

Deterministic, stdlib `unittest` only: no network, no Playwright, no daemon, no macOS probes —
the harness module is imported via `importlib` (its `main()` is `__main__`-guarded) and its pure
pieces are exercised with fakes: the preflight thresholds + the acknowledged contract deviation,
the fan-out gate over an injected process table (and a failed `ps`), the pre-submit preflight and
the flock launch reservation (O_NOFOLLOW, symlinked lock / directory refused), the gate policy (by
gate KIND, failing closed: unknown kind → reject unless the complete prompt is an unambiguous
pre-execution gate) and the UI click path with a fake page whose wire is verified (exact endpoint
for THIS run, body.approve == the decision, 2xx — a contradictory wire is a mismatch), sibling
gates through the UI while following with per-poll REDISCOVERY (a late sibling is followed; a late
sibling still gated at the timeout fails), the verdict split (every sibling terminal with its own
verdict), sibling attribution without the brief fallback, typed evidence-fetch misses (events and
listings included), `scrub()`, plan analysis (scenario rows only, execution RESULTS excluded by
result marker — a proposed command is a scenario — canonical file identity; re-derived over the
three committed plans) and the contained, component-walked, symlink-safe, unique-temp-file report
write. The only local resource touched is `git ls-files` of this worktree (for the committed-plan
re-derivation) and a temp dir.

Run:  python3 -m unittest e2e/test_feature_live_selftest.py -v
(studio's CI has no Python step — run this by hand before pushing a harness change.)
"""
from __future__ import annotations

import importlib.util
import inspect
import json
import os
import re
import subprocess
import tempfile
import types
import unittest
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("test_feature_live", HERE / "test_feature_live.py")
tfl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tfl)  # type: ignore[union-attr]

ACK = {"SWAP_MAX_PCT_ACK": "contract-deviation"}
DEVIATION_ENV = {"SWAP_MAX_PCT": "95", **ACK}


def reading(**over) -> dict:
    base = {"ts": "00:00:00", "free_mb": 60, "available_mb": 16000, "load1": 8.5, "swap_pct": 93.0, "active_runs": [], "fanout": []}
    base.update(over)
    return base


class FakeClock:
    """Injected into `follow_siblings` so a 15-minute follow window elapses in no real time."""

    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.t += s


# A measured block shaped like the recorded LT-1 (d293f4d7…): everything the harness did worked,
# the run completed with a real-file-naming, classifying plan — and zero siblings appeared.
def recorded_like(intent: str = "recon", **over) -> dict:
    m = {
        "scenario": "LT-X", "intent": intent, "result": "not-run", "notes": [],
        "measured": {
            "post_status": 201, "run_ids": ["run-1"], "campaign_label": "recon-abc-123", "campaign_registered": False,
            "gate_on_panel_card": True, "gate_via_run_page_fallback": False,
            "gates": [{"ord": 1, "first": True, "prompt": "Approve unit 1 before it runs: Recon: …", "decision": "approve",
                       "reason": "imperative is not deliver-class", "status": 200, "unit": {"stage": "test", "gate": "auto"}}],
            "final_status": "completed", "wedged": False,
            "plan": {"names_real_files": True, "classifies": True},
            "siblings_at_terminal": {"attributable_siblings": [], "unrelated_new_runs": [], "campaign_for_label": []},
            "siblings_after_grace": {"attributable_siblings": [], "unrelated_new_runs": [], "campaign_for_label": []},
            "fetch_errors": [],
        },
    }
    m["measured"].update(over)
    return m


def with_siblings(*ids: str, **over) -> dict:
    sib = {"attributable_siblings": [{"id": i, "attributed_by": "x"} for i in ids], "unrelated_new_runs": [], "campaign_for_label": []}
    return recorded_like(siblings_after_grace=sib, **over)


class Isolated(unittest.TestCase):
    """Snapshot/restore the module's global REPORT (findings, preflights, policy, fetch sink)."""

    def setUp(self):
        self._saved = json.loads(json.dumps(tfl.REPORT, default=str))
        tfl.set_fetch_sink(None)

    def tearDown(self):
        tfl.REPORT.clear()
        tfl.REPORT.update(self._saved)
        tfl.set_fetch_sink(None)


# ── Item 1 (adjudicated): the 85 % default, the acknowledged override ─────────────────────────


class PreflightThresholds(Isolated):
    def test_contract_default_is_85(self):
        p = tfl.preflight_policy({})
        self.assertEqual(p["swap_max_pct"], 85)
        self.assertEqual(p["contract_swap_max_pct"], 85)
        self.assertEqual(tfl.SWAP_MAX_PCT_CONTRACT, 85)
        self.assertNotIn("contract_deviation", p)
        self.assertEqual(p["source"], "contract default")
        self.assertIsNone(tfl.deviation_line(p))

    def test_override_without_the_acknowledgement_refuses_naming_both_vars(self):
        for env in ({"SWAP_MAX_PCT": "95"}, {"SWAP_MAX_PCT": "95", "SWAP_MAX_PCT_ACK": ""}, {"SWAP_MAX_PCT": "95", "SWAP_MAX_PCT_ACK": "yes"}):
            with self.assertRaises(SystemExit, msg=env) as cm:
                tfl.preflight_policy(env)
            self.assertIn("SWAP_MAX_PCT=95", str(cm.exception))
            self.assertIn("SWAP_MAX_PCT_ACK=contract-deviation", str(cm.exception))

    def test_acknowledged_override_is_recorded_as_a_contract_deviation_object(self):
        p = tfl.preflight_policy(DEVIATION_ENV)
        self.assertEqual(p["swap_max_pct"], 95)
        self.assertEqual(p["source"], "SWAP_MAX_PCT env")
        d = p["contract_deviation"]
        self.assertEqual({k: d[k] for k in ("var", "contract", "effective", "ack")},
                         {"var": "SWAP_MAX_PCT", "contract": 85, "effective": 95, "ack": "SWAP_MAX_PCT_ACK=contract-deviation"})
        self.assertIn("not enforced", d["note"])
        line = tfl.deviation_line(p)
        self.assertTrue(line.startswith("CONTRACT DEVIATION:"), line)
        self.assertIn("85% → 95%", line)

    def test_override_equal_to_the_contract_needs_no_ack_and_is_not_a_deviation(self):
        self.assertNotIn("contract_deviation", tfl.preflight_policy({"SWAP_MAX_PCT": "85"}))

    def test_invalid_env_refuses(self):
        for bad in ("abc", "0", "101", "-5"):
            with self.assertRaises(SystemExit, msg=bad):
                tfl.preflight_policy({"SWAP_MAX_PCT": bad, **ACK})

    def test_swap_gate_uses_the_effective_threshold(self):
        r = reading(swap_pct=93.0)
        self.assertEqual(tfl.preflight_ok(r, tfl.preflight_policy({})), ["swap 93.0% >= 85%"])
        self.assertEqual(tfl.preflight_ok(r, tfl.preflight_policy(DEVIATION_ENV)), [])
        self.assertEqual(tfl.preflight_ok(reading(swap_pct=84.9), tfl.preflight_policy({})), [])

    def test_load_and_active_run_gates(self):
        p = tfl.preflight_policy(DEVIATION_ENV)
        self.assertEqual(tfl.preflight_ok(reading(load1=20.0), p), ["load1 20.0 >= 20"])
        self.assertEqual(tfl.preflight_ok(reading(active_runs=["r1"]), p), ["active runs: ['r1']"])
        self.assertEqual(tfl.preflight_ok(reading(), p), [])
        why = tfl.preflight_ok(reading(load1=25, active_runs=["r1"], swap_pct=99), tfl.preflight_policy({}))
        self.assertEqual(len(why), 3)

    def test_every_preflight_logs_the_deviation_and_stamps_the_threshold(self):
        saved_readings, saved_log = tfl.readings, tfl.log
        lines: list[str] = []
        try:
            tfl.readings = lambda: reading(swap_pct=93.0)
            tfl.log = lines.append
            tfl.REPORT["preflight_policy"] = tfl.preflight_policy(DEVIATION_ENV)
            tfl.REPORT["preflights"] = []
            self.assertTrue(tfl.preflight("T-1"))
            self.assertTrue(tfl.preflight("T-2"))
            for entry in tfl.REPORT["preflights"]:
                self.assertEqual(entry["at"], "before-launch")
                self.assertTrue(entry["cleared"])
                self.assertEqual(entry["readings"][0]["swap_max_pct"], 95)
                self.assertEqual(entry["readings"][0]["load1_max"], 20)
                self.assertEqual(entry["readings"][0]["blocked_by"], [])
            self.assertEqual(sum(1 for l in lines if l.startswith("CONTRACT DEVIATION:")), 2, lines)  # at EVERY preflight
            self.assertEqual(tfl.REPORT["contract_deviation"]["effective"], 95)  # the report's top-level object
        finally:
            tfl.readings, tfl.log = saved_readings, saved_log


# ── Item 4: the pre-submit preflight and the launch reservation ───────────────────────────────


class PreflightAtSubmit(Isolated):
    def test_blocked_at_submit_does_not_wait_and_is_a_harness_failure(self):
        saved_readings, saved_sleep = tfl.readings, tfl.time.sleep
        try:
            tfl.readings = lambda: reading(active_runs=["r1"], swap_pct=50.0)  # another run started in the window
            tfl.time.sleep = lambda *_: (_ for _ in ()).throw(AssertionError("the pre-submit preflight must never wait"))
            tfl.REPORT["preflight_policy"] = tfl.preflight_policy({})
            tfl.REPORT["preflights"] = []
            why = tfl.preflight_at_submit("T-1")
            self.assertEqual(why, ["active runs: ['r1']"])
            entry = tfl.REPORT["preflights"][0]
            self.assertEqual((entry["at"], entry["cleared"], len(entry["readings"])), ("submit", False, 1))
            self.assertEqual(entry["readings"][0]["swap_max_pct"], 85)
            tfl.readings = lambda: reading(swap_pct=50.0)
            self.assertEqual(tfl.preflight_at_submit("T-1"), [])
            self.assertTrue(tfl.REPORT["preflights"][1]["cleared"])
        finally:
            tfl.readings, tfl.time.sleep = saved_readings, saved_sleep
        v = tfl.derive_result(recorded_like(launch_aborted_by_preflight=["active runs: ['r1']"], post_status=None, run_ids=[],
                                            gate_on_panel_card=False, gates=[], final_status=None), [])
        self.assertFalse(v["harness_ok"])
        self.assertEqual(v["result"], "fail")
        self.assertIn("preflight-at-submit", v["fail_reasons"])
        self.assertFalse(any("launch not accepted" in r for r in v["fail_reasons"]), v["fail_reasons"])  # nothing was posted

    def test_the_submit_click_is_preceded_by_the_reservation_and_the_fresh_preflight(self):
        src = inspect.getsource(tfl._drive_intake)
        i_lock, i_pf, i_click = src.index("lock.acquire()"), src.index("preflight_at_submit(tag)"), src.index('testing-launch-submit"]\').click()')
        self.assertLess(i_lock, i_pf)
        self.assertLess(i_pf, i_click)
        self.assertIn('m["measured"]["launch_aborted_by_preflight"] = why', src)
        self.assertLess(src.index("launch_aborted_by_preflight"), i_click)
        # Released once the intake gate is decided, and on every exit path by the wrapper.
        self.assertGreater(src.index("lock.release()"), src.index("decide_gate_on_card(page, card"))
        self.assertIn("finally:\n        lock.release()", inspect.getsource(tfl.drive_intake))


# ── Round 3, item 2: the fan-out gate (no heavy worker / build processes on the host) ──────────

PS_TABLE = """  123 /usr/bin/python3 e2e/test_feature_live.py
  456 node /opt/homebrew/lib/node_modules/wicked-crew/node_modules/.bin/codex exec --skip-git-repo-check You are one evaluator
  789 claude -p "do a thing"
  790 claude --print x
  791 /Applications/Claude.app/Contents/MacOS/Claude
  800 cargo build --release
  801 cargo test -p wicked-core
  802 cargo clippy
  803 node /x/node_modules/.bin/vitest run
  804 npm run test
  805 npm test
  806 npm run build
  807 npm run dev
  808 node /opt/homebrew/bin/wicked-crew serve --port 7701
  809 wicked-crew serve
  810 node /opt/homebrew/bin/wicked-crew serve --port 62432 --db /tmp/x/core.db
  811 ps -axo pid=,command=
  812 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer
"""


class FanoutGate(Isolated):
    def test_default_pattern_matches_the_documented_fanout_and_nothing_else(self):
        hits = tfl.fanout_processes(PS_TABLE)
        self.assertEqual([h.split(" ", 1)[0] for h in hits], ["456", "789", "790", "800", "801", "802", "803", "804", "805", "806", "810"])
        self.assertTrue(hits[0].startswith("456 node "), hits[0])          # `pid cmd`
        self.assertTrue(all(len(h) <= 170 for h in hits))                  # command lines are clipped
        # The dogfood daemon (:7701, or no port), the harness, the interactive Claude app, `ps`
        # itself and a Chrome renderer are not fan-out.
        self.assertEqual(tfl.fanout_processes(""), [])
        self.assertEqual(tfl.fanout_processes("  808 wicked-crew serve --port 7701\n  809 wicked-crew serve\n"), [])

    def test_pattern_override_and_invalid_regex(self):
        rx = tfl.fanout_pattern({"FANOUT_PATTERN": r"npm run dev"})
        self.assertEqual(tfl.fanout_processes(PS_TABLE, rx), ["807 npm run dev"])
        self.assertEqual(tfl.fanout_pattern({}).pattern, tfl.FANOUT_PATTERN_DEFAULT)
        self.assertEqual(tfl.fanout_pattern({"FANOUT_PATTERN": "  "}).pattern, tfl.FANOUT_PATTERN_DEFAULT)
        with self.assertRaises(SystemExit) as cm:
            tfl.fanout_pattern({"FANOUT_PATTERN": "("})
        self.assertIn("FANOUT_PATTERN", str(cm.exception))
        p = tfl.preflight_policy({})
        self.assertEqual((p["fanout_max"], p["fanout_pattern"], p["fanout_source"]), (0, tfl.FANOUT_PATTERN_DEFAULT, "default"))
        p = tfl.preflight_policy({"FANOUT_PATTERN": "foo"})
        self.assertEqual((p["fanout_pattern"], p["fanout_source"]), ("foo", "FANOUT_PATTERN env"))

    def test_a_failed_ps_is_a_failed_preflight(self):
        saved = tfl.subprocess.run
        try:
            for exc in (FileNotFoundError("ps"), subprocess.CalledProcessError(1, ["ps"]), OSError("boom")):
                def fail(argv, **kw):
                    raise exc
                tfl.subprocess.run = fail
                fan = tfl.fanout_processes()
                self.assertEqual(len(fan), 1, fan)
                self.assertTrue(fan[0].startswith("ERR `ps -axo pid=,command=` failed"), fan[0])
                self.assertIn("failing closed", fan[0])
                self.assertEqual(tfl.preflight_ok(reading(swap_pct=50.0, fanout=fan), tfl.preflight_policy({})), [f"fanout: {fan}"])  # blocked
        finally:
            tfl.subprocess.run = saved

    def test_the_reading_carries_the_fanout_and_only_an_empty_list_clears(self):
        self.assertIn('"fanout": fanout_processes()', inspect.getsource(tfl.readings))
        p = tfl.preflight_policy({})
        self.assertEqual(tfl.preflight_ok(reading(swap_pct=50.0, fanout=["456 codex exec x"]), p), ["fanout: ['456 codex exec x']"])
        self.assertEqual(tfl.preflight_ok(reading(swap_pct=50.0, fanout=[]), p), [])
        r = reading(swap_pct=50.0)
        del r["fanout"]
        self.assertEqual(tfl.preflight_ok(r, p), ["fanout: not measured"])  # no reading is not "clear"
        why = tfl.preflight_ok(reading(load1=25, active_runs=["r1"], swap_pct=99, fanout=["1 cargo build"]), p)
        self.assertEqual(len(why), 4)  # all four gates report

    def test_fanout_is_judged_at_both_preflight_points(self):
        saved = tfl.readings, tfl.time.sleep, tfl.PREFLIGHT_MAX_S
        try:
            tfl.readings = lambda: reading(swap_pct=50.0, fanout=["456 codex exec x", "800 cargo build --release"])
            tfl.time.sleep = lambda *_: (_ for _ in ()).throw(AssertionError("must not sleep"))
            tfl.PREFLIGHT_MAX_S = 0
            tfl.REPORT["preflight_policy"] = tfl.preflight_policy({})
            tfl.REPORT["preflights"], tfl.REPORT["blockers"] = [], []
            # (a) before browser start-up: blocked, never clears, reported as a blocker
            self.assertFalse(tfl.preflight("T-1"))
            entry = tfl.REPORT["preflights"][0]
            self.assertEqual(entry["readings"][0]["blocked_by"], ["fanout: ['456 codex exec x', '800 cargo build --release']"])
            self.assertEqual(entry["readings"][0]["fanout"], ["456 codex exec x", "800 cargo build --release"])
            self.assertTrue(tfl.REPORT["blockers"][0].startswith("preflight never cleared for T-1"))
            # (b) immediately before the submit click: blocked, the launch is not submitted
            why = tfl.preflight_at_submit("T-1")
            self.assertEqual(why, ["fanout: ['456 codex exec x', '800 cargo build --release']"])
            self.assertEqual(tfl.REPORT["preflights"][1]["at"], "submit")
            tfl.readings = lambda: reading(swap_pct=50.0)
            self.assertEqual(tfl.preflight_at_submit("T-1"), [])
        finally:
            tfl.readings, tfl.time.sleep, tfl.PREFLIGHT_MAX_S = saved
        v = tfl.derive_result(recorded_like(launch_aborted_by_preflight=["fanout: ['456 codex exec x']"], post_status=None, run_ids=[],
                                            gate_on_panel_card=False, gates=[], final_status=None), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("preflight-at-submit", v["fail_reasons"])


class LaunchReservation(unittest.TestCase):
    def test_the_lock_is_opened_nofollow_and_a_symlinked_lock_or_directory_is_refused(self):
        src = inspect.getsource(tfl.LaunchLock.acquire)
        self.assertIn("O_NOFOLLOW", src)
        self.assertLess(src.index("refuse_symlinked_components(parent"), src.index("mkdir("))  # lstat walk BEFORE mkdir
        self.assertLess(src.index("refuse_symlinked_components(self.path"), src.index("os.open("))
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "victim").write_text("keep")
            (d / "art").mkdir()
            (d / "art" / ".launch.lock").symlink_to(d / "victim")
            with self.assertRaises(SystemExit) as cm:
                tfl.LaunchLock(d / "art" / ".launch.lock").acquire()
            self.assertIn("symlink", str(cm.exception))
            self.assertEqual((d / "victim").read_text(), "keep")  # nothing written through the link
            (d / "realdir").mkdir()
            (d / "link").symlink_to(d / "realdir")
            with self.assertRaises(SystemExit) as cm:
                tfl.LaunchLock(d / "link" / ".launch.lock").acquire()  # a symlinked INTERMEDIATE directory
            self.assertIn(str(d / "link"), str(cm.exception))
            self.assertEqual(list((d / "realdir").iterdir()), [])
            lock = tfl.LaunchLock(d / "plain" / ".launch.lock").acquire()  # a real directory is created and used
            self.assertTrue(lock.held)
            lock.release()

    def test_second_holder_fails_fast_with_a_named_message(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / ".launch.lock"
            a = tfl.LaunchLock(path).acquire()
            self.assertTrue(a.held)
            b = tfl.LaunchLock(path)
            with self.assertRaises(SystemExit) as cm:
                b.acquire()
            self.assertIn("another harness process", str(cm.exception))
            self.assertIn(str(path), str(cm.exception))
            self.assertFalse(b.held)
            a.release()
            self.assertFalse(a.held)
            b.acquire()  # free again
            self.assertTrue(b.held)
            b.release()
            b.release()  # idempotent

    def test_lock_lives_in_the_artifacts_dir(self):
        self.assertEqual(tfl.LOCK_PATH, tfl.ART / ".launch.lock")


# ── Item 3: gate policy by gate KIND, failing closed ──────────────────────────────────────────

LT1_PLAN_ROUTES = ("`/runs/:id/{events,acceptance,archive,gate,cancel,guidance,resume,units/:ord/output,elicitation,"
                   "files,diff,inject,deliver}` (client.ts)")


class GateDecision(unittest.TestCase):
    def test_delivery_kind_units_are_rejected_whatever_the_prompt_says(self):
        for kind in ("deliver", "release", "publish", "merge", "Deliver"):
            for unit in ({"stage": kind, "gate": "human"}, {"stage": "test", "gate": kind}):
                decision, reason = tfl.gate_decision("Approve unit 4 before it runs: land the branch", unit)
                self.assertEqual(decision, "reject", (kind, unit))
                self.assertIn("gate kind", reason)
                self.assertIn("never deliver", reason)

    def test_deliver_imperatives_are_rejected(self):
        for p in ("Deliver: open a PR against main", "Delivery of the branch to origin", "Push the branch to origin",
                  "Open a PR with the results", "Open PR #12 now", "Merge into main", "Publish the package", "Release 0.5.2",
                  "Approve the delivery of the branch", "Approve deliver: push and open a PR", "approve the merge into main"):
            decision, reason = tfl.gate_decision(p, {"stage": "test", "gate": "human"})
            self.assertEqual(decision, "reject", p)
            self.assertIn("imperative", reason)

    PRE_RECON = ("Approve unit 1 before it runs: Recon: survey the target and propose a test plan — the scenarios, their "
                 "dependencies, and which are deterministic tool checks vs governed agent runs.")
    PRE_NEWTEST = ("Approve unit 1 before it runs: New test: plan the test for the attached scope — … and run the approved "
                   "plan as governed sibling runs under one test.")
    PLAN_BODIES = ("verify /runs/:id/deliver rejects unauthorized requests",
                   f"Approve proposed test plan for wicked-studio:\n**REST routes**: `/runs`, `/runs/:id`, {LT1_PLAN_ROUTES}",
                   "Approve proposed test plan:\n| 5 | GET/POST /runs + subresources (archive, gate, cancel, guidance, resume, deliver, inject) | api/client.ts |",
                   "Approve proposed test plan for wicked-studio before the siblings launch",
                   "Amend the plan?")
    CODEX_PROBE = "Approve unit 4 before it runs: Push the branch and open a PR"

    def test_plan_bodies_that_mention_deliver_routes_are_approved_when_the_kind_is_known(self):
        for p in (*self.PLAN_BODIES, self.PRE_RECON, self.PRE_NEWTEST):
            decision, reason = tfl.gate_decision(p, {"stage": "test", "gate": "auto"})
            self.assertEqual(decision, "approve", (p, reason))
            self.assertIn("unit stage/gate test/auto", reason)

    def test_unknown_kind_rejects_unless_the_complete_prompt_is_an_unambiguous_pre_execution_gate(self):
        """Codex round 3: `gate_decision("Approve unit 4 before it runs: Push the branch and open a PR", None)`
        approved because the first clause hid the delivery instruction — the lookup-failed fallback
        failed open. Now an unknown kind approves ONLY the complete pre-execution shape with no
        delivery verb anywhere; an empty prompt is always a reject."""
        for unit in (None, {}, {"stage": None, "gate": None}, {"stage": "", "gate": " "}, {"ord": 4}):
            d, r = tfl.gate_decision(self.CODEX_PROBE, unit)
            self.assertEqual(d, "reject", unit)
            self.assertTrue(r.startswith("unknown-gate-kind"), r)
            self.assertIn("'push'", r)
            self.assertEqual(tfl.gate_decision("", unit), ("reject", "unreadable-gate"), unit)   # empty: always reject
            self.assertEqual(tfl.gate_decision("  \n", unit), ("reject", "unreadable-gate"), unit)
            for p in (self.PRE_RECON, self.PRE_NEWTEST):
                d, r = tfl.gate_decision(p, unit)
                self.assertEqual(d, "approve", (unit, r))                                        # unambiguous
                self.assertIn("COMPLETE prompt carries no delivery verb", r)
                self.assertIn("approved on the complete prompt alone", r)
            # the pre-execution shape with a delivery verb ANYWHERE — not only in the first clause
            for tail in ("Deliver the report", "survey, then merge into main", "publish the package", "cut release 0.5.2",
                         "open PR #12", "open a pull request", "Open a PR with the results", "and push"):
                d, r = tfl.gate_decision(f"Approve unit 2 before it runs: Recon: {tail}", unit)
                self.assertEqual(d, "reject", (tail, unit))
                self.assertTrue(r.startswith("unknown-gate-kind"), r)
            # a readable prompt that is NOT the pre-execution shape approves only with a known kind
            for p in self.PLAN_BODIES:
                d, r = tfl.gate_decision(p, unit)
                self.assertEqual(d, "reject", (p, unit))
                self.assertTrue(r.startswith("unknown-gate-kind"), r)
                self.assertIn("not the pre-execution shape", r)
        # "Push …" inside a pre-execution prompt is the UNIT's instruction: rejected even when the
        # daemon labels the stage `test` (the kind and the prompt disagree about delivery → closed).
        d, r = tfl.gate_decision(self.CODEX_PROBE, {"stage": "test", "gate": "auto"})
        self.assertEqual(d, "reject")
        self.assertFalse(r.startswith("unknown-gate-kind"), r)
        self.assertIn("'push'", r)
        self.assertIn("unit stage/gate test/auto", r)
        # known kinds: a partially known unit is known
        self.assertEqual(tfl.gate_decision("Amend the plan?", {"stage": "test", "gate": None})[0], "approve")
        self.assertEqual(tfl.gate_decision("Amend the plan?", {"stage": None, "gate": "human"})[0], "approve")
        self.assertEqual(tfl.gate_kinds({"stage": " Test", "gate": None}), {"test"})
        self.assertEqual(tfl.gate_kinds({"stage": None, "gate": None}), set())
        self.assertEqual(tfl.gate_kinds(None), set())
        self.assertEqual(tfl.gate_kinds("deliver"), set())  # not a unit dict

    def test_unreadable_gate_fails_closed(self):
        for p in ("", None, "   \n"):
            self.assertEqual(tfl.gate_decision(p), ("reject", "unreadable-gate"), repr(p))
            self.assertEqual(tfl.gate_decision(p, None), ("reject", "unreadable-gate"), repr(p))
            self.assertEqual(tfl.gate_decision(p, {"stage": "deliver", "gate": "human"})[0], "reject", repr(p))
            # a KNOWN non-delivery kind never authorizes approving what cannot be read (round 3)
            self.assertEqual(tfl.gate_decision(p, {"stage": "test", "gate": "auto"}), ("reject", "unreadable-gate"), repr(p))

    def test_imperative_is_the_first_clause(self):
        self.assertEqual(tfl.imperative("Approve unit 1 before it runs: Recon: survey the target"), "Approve unit 1 before it runs")
        self.assertEqual(tfl.imperative("Deliver: open a PR against main"), "Deliver")
        self.assertEqual(tfl.imperative("- **Merge** into main\nthen deliver"), "Merge into main")
        self.assertEqual(tfl.imperative("verify /runs/:id/deliver"), "verify /runs/")  # the ':' ends the clause — still not deliver-class
        self.assertLessEqual(len(tfl.imperative("x" * 500)), 80)
        self.assertEqual(tfl.imperative(None), "")

    def test_gate_unit_lookup(self):
        detail = {"units": [{"ord": 1, "stage": "test", "gate": "auto"}, {"ord": 4, "stage": "deliver", "gate": "human"}]}
        self.assertEqual(tfl.gate_unit(detail, 4), {"ord": 4, "stage": "deliver", "gate": "human"})
        self.assertEqual(tfl.gate_unit(detail, 1), {"ord": 1, "stage": "test", "gate": "auto"})
        self.assertIsNone(tfl.gate_unit(detail, 9))
        self.assertIsNone(tfl.gate_unit(detail, None))
        self.assertIsNone(tfl.gate_unit(None, 1))
        self.assertIsNone(tfl.gate_unit({}, 1))

    def test_every_gate_click_goes_through_the_one_card_path(self):
        drive = inspect.getsource(tfl._drive_intake)
        self.assertNotIn('steering-approve"]', drive)
        self.assertNotIn('steering-reject"]', drive)
        self.assertNotIn("steering-{decision}", drive)
        self.assertEqual(drive.count("decide_gate_on_card("), 2, "first gate + later gates")
        self.assertIn("decide_gate_on_card(", inspect.getsource(tfl.decide_sibling_gate))
        self.assertEqual(inspect.getsource(tfl.decide_gate_on_card).count("steering-{decision}"), 1)
        # No allow-list left anywhere.
        self.assertNotIn('re.match(r"Approve unit \\d+ before it runs", ptxt)', drive)
        # The intake gate's decision reads the gated unit's stage/gate from the run detail first.
        self.assertLess(drive.index("gate_unit(run_detail(run_id), gate_ord)"), drive.index("decide_gate_on_card(page, card"))


# ── A fake Playwright page: enough surface for the gate click path and sibling navigation ─────


class FakeResponse:
    def __init__(self, url: str, status: int = 200, post_data: str = '{"approve": true}'):
        self.url, self.status = url, status
        self.request = types.SimpleNamespace(method="POST", post_data=post_data)


class FakeExpect:
    """Playwright's `expect_response`: the predicate is EVALUATED against the response the fake SPA
    produces for the click — a response the predicate rejects is a timeout, as on the real wire."""

    def __init__(self, page, pred):
        self.page, self.pred, self.value = page, pred, None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        if a[0] is not None:
            return False
        resp = self.page.wire_response()
        if not self.pred(resp):
            raise TimeoutError(f"no response matched the predicate (the SPA posted {resp.request.method} {resp.url})")
        self.value = resp
        return False


class FakeLocator:
    def __init__(self, page, selector: str):
        self.page, self.selector = page, selector

    @property
    def first(self):
        return self

    def locator(self, sel: str):
        return FakeLocator(self.page, f"{self.selector} {sel}")

    def wait_for(self, timeout=None):
        if self.page.card_missing:
            raise TimeoutError("no card")
        self.page.waited.append(self.selector)

    def inner_text(self) -> str:
        if self.page.prompt is None:
            raise RuntimeError("no steering-prompt element")
        return self.page.prompt

    def click(self):
        self.page.clicks.append(self.selector)

    def count(self):
        return 0 if self.page.card_missing else 1


class FakePage:
    """`wire_run_id` is the run whose gate the fake SPA actually posts to (default: this run);
    `wire_approve` forces the posted `approve` (None = mirror the button clicked — the honest wire;
    a bool = a UI wire regression the harness must catch)."""

    def __init__(self, prompt, run_id="sib-1", card_missing=False, gate_status=200, wire_run_id=None, wire_approve=None):
        self.prompt, self.run_id, self.card_missing, self.gate_status = prompt, run_id, card_missing, gate_status
        self.wire_run_id, self.wire_approve = wire_run_id or run_id, wire_approve
        self.gotos: list[str] = []
        self.clicks: list[str] = []
        self.waited: list[str] = []

    def goto(self, url: str, wait_until=None):
        self.gotos.append(url)

    def locator(self, sel: str):
        return FakeLocator(self, sel)

    def wire_response(self) -> FakeResponse:
        clicked_approve = bool(self.clicks) and 'steering-approve"]' in self.clicks[-1]
        approve = clicked_approve if self.wire_approve is None else self.wire_approve
        return FakeResponse(f"{tfl.BASE}/api/v1/runs/{self.wire_run_id}/gate", self.gate_status, json.dumps({"approve": approve}))

    def expect_response(self, pred, timeout=None):
        return FakeExpect(self, pred)


class GateClickPath(Isolated):
    def card(self, page):
        return page.locator(f'[data-testid="steering-gate"][data-run-id="{page.run_id}"]')

    def test_deliver_imperative_clicks_reject_and_records_the_unit(self):
        page = FakePage("Deliver: open a PR against main")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit={"stage": "test", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject")
        self.assertEqual(len(page.clicks), 1)
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertEqual((entry["ord"], entry["first"], entry["status"], entry["unit"]), (4, False, 200, {"stage": "test", "gate": "human"}))
        self.assertEqual(entry["url"], "/api/v1/runs/sib-1/gate")
        self.assertEqual(entry["body"], {"approve": False})  # a REJECT wires {approve: false} — the round-2 fixture said true
        self.assertTrue(entry["wire_ok"])
        self.assertIn("body.approve == False", entry["wire_check"])
        self.assertTrue(any("REJECTED by policy" in f for f in tfl.REPORT["findings"]))
        self.assertFalse(any("gate-wire-mismatch" in f for f in tfl.REPORT["findings"]))

    def test_a_rejected_decision_wired_as_approve_true_is_a_wire_mismatch_and_a_harness_failure(self):
        """The round-2 fixture accepted `{approve: true}` while reporting REJECTED — exactly the UI
        wire regression the check exists to catch. Now it FAILS the check."""
        page = FakePage("Deliver: open a PR against main", wire_approve=True)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit={"stage": "test", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject")
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertEqual(entry["body"], {"approve": True})
        self.assertFalse(entry["wire_ok"])
        self.assertIn("approve=True but the decision 'reject' requires approve=False", entry["wire_check"])
        self.assertTrue(any("gate-wire-mismatch" in f and "approve=True" in f for f in tfl.REPORT["findings"]))
        v = tfl.derive_result(recorded_like(gates=[entry]), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("gate-wire-mismatch", v["fail_reasons"])
        # and the mirror image: an APPROVE that wired {approve: false}
        page = FakePage("Approve unit 1 before it runs: Recon: survey", wire_approve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit={"stage": "test", "gate": "auto"}, tag="T", first=True)
        self.assertEqual((entry["decision"], entry["wire_ok"]), ("approve", False))

    def test_a_post_to_another_runs_gate_is_not_this_gates_evidence(self):
        page = FakePage("Approve unit 1 before it runs: Recon: survey", run_id="sib-1", wire_run_id="sib-9")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit={"stage": "test", "gate": "auto"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "approve")
        self.assertEqual(len(page.clicks), 1)                       # the click happened …
        self.assertEqual((entry["status"], entry["url"], entry["body"]), (None, None, None))  # … but no POST to THIS run's gate was seen
        self.assertFalse(entry["wire_ok"])
        self.assertIn("no POST /api/v1/runs/sib-1/gate observed within 60s", entry["wire_check"])
        self.assertIn("sib-9", entry["wire_check"])
        self.assertTrue(any("gate-wire-mismatch" in f for f in tfl.REPORT["findings"]))
        v = tfl.derive_result(recorded_like(gates=[entry]), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("a gate decision did not post", v["fail_reasons"])
        self.assertIn("gate-wire-mismatch", v["fail_reasons"])

    def test_a_non_2xx_gate_answer_is_a_wire_mismatch(self):
        page = FakePage("Approve unit 1 before it runs: Recon: survey", gate_status=409)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit={"stage": "test", "gate": "auto"}, tag="T", first=False)
        self.assertEqual((entry["status"], entry["wire_ok"]), (409, False))
        self.assertIn("status 409 is not 2xx", entry["wire_check"])

    def test_gate_url_matches_exactly_this_run(self):
        rid = "d293f4d7-1e45-4346-809a-d6f2107c6b18"
        self.assertTrue(tfl.gate_url_matches(f"http://localhost:7701/api/v1/runs/{rid}/gate", rid))
        self.assertTrue(tfl.gate_url_matches(f"/api/v1/runs/{rid}/gate", rid))
        self.assertTrue(tfl.gate_url_matches("http://h/api/v1/runs/recon-abc%3Awicked-studio%3Aa0/gate?x=1", "recon-abc:wicked-studio:a0"))  # encodeURIComponent
        self.assertFalse(tfl.gate_url_matches("/api/v1/runs/other/gate", rid))
        self.assertFalse(tfl.gate_url_matches(f"/api/v1/runs/{rid}/gate/../other/gate", rid))
        self.assertFalse(tfl.gate_url_matches(f"/api/v1/runs/{rid}/deliver", rid))
        self.assertFalse(tfl.gate_url_matches(f"/api/v1/runs/{rid}", rid))
        self.assertFalse(tfl.gate_url_matches("", rid))
        # the predicate the click waits on is method + exact endpoint, not `"/gate" in url`
        src = inspect.getsource(tfl.decide_gate_on_card)
        self.assertIn("gate_url_matches(r.url, run_id)", src)
        self.assertNotIn('"/gate" in r.url', src)
        # gate_wire_check, as a pure function over a recorded entry
        ok = {"url": f"/api/v1/runs/{rid}/gate", "body": {"approve": True}, "decision": "approve", "status": 200}
        self.assertIsNone(tfl.gate_wire_check(ok, rid))
        self.assertIn("not /api/v1/runs/other/gate", tfl.gate_wire_check(ok, "other"))
        self.assertIn("approve=None", tfl.gate_wire_check({**ok, "body": {"raw": "x"}}, rid))
        self.assertIn("approve='yes'", tfl.gate_wire_check({**ok, "body": {"approve": "yes"}}, rid))
        self.assertIn("status None is not 2xx", tfl.gate_wire_check({**ok, "status": None}, rid))
        self.assertIn("status 300 is not 2xx", tfl.gate_wire_check({**ok, "status": 300}, rid))

    def test_plan_approval_clicks_approve(self):
        page = FakePage(f"Approve proposed test plan for wicked-studio:\n{LT1_PLAN_ROUTES}")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=2, unit={"stage": "test", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "approve")
        self.assertIn('steering-approve"]', page.clicks[0])

    def test_delivery_kind_unit_clicks_reject_even_for_a_benign_prompt(self):
        page = FakePage("Approve unit 4 before it runs: land the branch")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit={"stage": "deliver", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject")
        self.assertIn("gate kind 'deliver'", entry["reason"])

    def test_unreadable_prompt_without_unit_info_clicks_reject_with_a_finding(self):
        for page in (FakePage(""), FakePage(None)):
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=None, unit=None, tag="T", first=False)
            self.assertEqual((entry["decision"], entry["reason"]), ("reject", "unreadable-gate"))
            self.assertIn('steering-reject"]', page.clicks[0])
        self.assertTrue(any("unreadable prompt" in f and "REJECTED" in f for f in tfl.REPORT["findings"]))

    def test_the_intake_gate_uses_the_same_path(self):
        page = FakePage("Approve unit 1 before it runs: Recon: survey the target and propose a test plan", run_id="run-1")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="run-1", ord_=1, unit={"stage": "test", "gate": "auto"}, tag="LT-1",
                                        first=True, prompt=page.prompt)
        self.assertEqual((entry["decision"], entry["first"]), ("approve", True))


# ── Item 5: sibling gates decided THROUGH THE UI while following ─────────────────────────────


class SiblingGatesThroughTheUI(Isolated):
    def setUp(self):
        super().setUp()
        self._saved_fns = (tfl.run_detail, tfl.run_events, tfl.acceptance_verdict)

    def tearDown(self):
        tfl.run_detail, tfl.run_events, tfl.acceptance_verdict = self._saved_fns
        super().tearDown()

    def test_decide_sibling_gate_navigates_reads_decides_clicks_and_returns(self):
        tfl.run_events = lambda sid: [{"type": "unitPlanned", "ord": 1}, {"type": "awaitingHuman", "ord": 2, "prompt": "x"}]
        tfl.run_detail = lambda sid: {"session": {"id": sid, "status": "awaiting_human"},
                                      "units": [{"ord": 1, "stage": "test", "gate": "auto"}, {"ord": 2, "stage": "deliver", "gate": "human"}]}
        page = FakePage("Approve unit 2 before it runs: land the change", run_id="sib-1")
        entry = tfl.decide_sibling_gate(page, "sib-1", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(page.gotos, [f"{tfl.BASE}/runs/sib-1", "http://studio/testing/campaigns"])  # there and BACK to the launch panel
        self.assertEqual(page.waited, ['[data-testid="steering-gate"][data-run-id="sib-1"]'])
        self.assertEqual(entry["decision"], "reject")  # unit 2 is a deliver-stage unit
        self.assertEqual(entry["unit"], {"stage": "deliver", "gate": "human"})
        self.assertEqual(entry["ord"], 2)
        self.assertIn('steering-reject"]', page.clicks[0])

    def test_sibling_intake_gate_is_approved_on_the_card(self):
        tfl.run_events = lambda sid: [{"type": "awaitingHuman", "ord": 1}]
        tfl.run_detail = lambda sid: {"session": {"status": "awaiting_human"}, "units": [{"ord": 1, "stage": "test", "gate": "human"}]}
        page = FakePage("Approve unit 1 before it runs: Execute scenario S-3", run_id="sib-2")
        entry = tfl.decide_sibling_gate(page, "sib-2", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "approve")
        self.assertEqual(entry["status"], 200)

    def test_missing_card_is_left_undecided_with_a_finding_and_still_returns(self):
        tfl.run_events = lambda sid: []
        tfl.run_detail = lambda sid: {"session": {"status": "awaiting_human"}, "units": []}
        page = FakePage("irrelevant", run_id="sib-3", card_missing=True)
        entry = tfl.decide_sibling_gate(page, "sib-3", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertIsNone(entry["decision"])
        self.assertIsNone(entry["status"])
        self.assertEqual(page.clicks, [])
        self.assertEqual(page.gotos[-1], "http://studio/testing/campaigns")
        self.assertTrue(any("rendered no gate card" in f for f in tfl.REPORT["findings"]))

    def boom(self, sid):
        raise tfl.FetchError(tfl.FetchMiss(f"/runs/{sid}", 500, "down"))

    def test_unit_lookup_failure_falls_back_to_the_card_failing_closed(self):
        tfl.run_events = self.boom
        tfl.run_detail = self.boom
        page = FakePage("", run_id="sib-4")
        entry = tfl.decide_sibling_gate(page, "sib-4", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual((entry["decision"], entry["reason"]), ("reject", "unreadable-gate"))
        self.assertIn("FetchError", entry["unit_lookup_error"])

    def test_unit_lookup_failure_with_a_delivery_instruction_is_rejected_as_unknown_kind(self):
        """Codex's round-3 probe, on the real click path: the unit lookup fails (no stage/gate), the
        card reads "Approve unit 4 before it runs: Push the branch and open a PR" → REJECT."""
        tfl.run_events = self.boom
        tfl.run_detail = self.boom
        page = FakePage("Approve unit 4 before it runs: Push the branch and open a PR", run_id="sib-5")
        entry = tfl.decide_sibling_gate(page, "sib-5", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("unknown-gate-kind"), entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertIsNone(entry["unit"])
        self.assertIn("FetchError", entry["unit_lookup_error"])
        self.assertTrue(entry["wire_ok"])  # the reject reached THIS run's gate with {approve: false}
        self.assertTrue(any("stage/gate is unknown" in f and "REJECTED" in f for f in tfl.REPORT["findings"]))

    def test_unit_lookup_failure_with_an_unambiguous_pre_execution_prompt_is_approved(self):
        tfl.run_events = self.boom
        tfl.run_detail = self.boom
        page = FakePage("Approve unit 1 before it runs: Recon: survey the target and propose a test plan", run_id="sib-6")
        entry = tfl.decide_sibling_gate(page, "sib-6", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "approve")
        self.assertIn("approved on the complete prompt alone", entry["reason"])
        self.assertIn('steering-approve"]', page.clicks[0])
        self.assertTrue(entry["wire_ok"])

    def test_follow_siblings_decides_awaiting_gates_then_samples_verdicts(self):
        timeline = {"s1": iter(["awaiting_human", "executing", "completed", "completed"]), "s2": iter(["executing", "completed", "completed", "completed"])}
        tfl.run_detail = lambda sid: {"session": {"status": next(timeline[sid])}}
        tfl.acceptance_verdict = lambda sid: {"s1": "pass", "s2": None}[sid]
        decided: list[tuple] = []

        def fake_decide(page, sid, *, tag, return_to):
            decided.append((sid, tag, return_to))
            return {"ord": 1, "decision": "approve", "status": 200}
        page = FakePage("x")
        clock = FakeClock()
        out = tfl.follow_siblings(["s1", "s2"], max_s=60, sleep=clock.sleep, page=page, tag="LT-2", return_to="http://studio/testing/campaigns",
                                  decide=fake_decide, clock=clock)
        self.assertEqual(decided, [("s1", "LT-2", "http://studio/testing/campaigns")])
        self.assertEqual(out["gates"], {"s1": [{"ord": 1, "decision": "approve", "status": 200}], "s2": []})
        self.assertEqual(out["statuses"], {"s1": "completed", "s2": "completed"})
        self.assertTrue(out["all_terminal"])
        self.assertFalse(out["timed_out"])
        self.assertEqual((out["discovered"], out["polls"]), ({}, 3))  # no rediscovery hook: the set is stable by construction
        self.assertEqual(out["acceptance"], {"s1": "pass", "s2": None})

    def test_follow_rediscovers_siblings_on_every_poll_and_ends_only_on_a_stable_terminal_set(self):
        """Codex round 3: `follow_siblings` polled only the supplied ids, so a sequential campaign
        node launched after its predecessor completed was never followed (an offline reproduction
        returned `pass` for S1 while the listing held an attributable S2 awaiting approval)."""
        polls = {"n": 0}

        def rediscover():  # S2 exists only from the second poll on — after S1 has completed
            polls["n"] += 1
            ids = ["s1"] if polls["n"] < 2 else ["s1", "s2"]
            return {"attributable_siblings": [{"id": i, "attributed_by": "listed in the campaign's node_run_id/attached_runs"} for i in ids],
                    "unrelated_new_runs": []}
        s2 = iter(["awaiting_human", "executing", "completed", "completed"])
        tfl.run_detail = lambda sid: {"session": {"status": "completed" if sid == "s1" else next(s2)}}
        tfl.acceptance_verdict = lambda sid: "pass"
        decided: list[str] = []

        def fake_decide(page, sid, *, tag, return_to):
            decided.append(sid)
            return {"ord": 1, "decision": "approve", "status": 200}
        clock = FakeClock()
        out = tfl.follow_siblings(["s1"], max_s=600, sleep=clock.sleep, page=FakePage("x"), tag="LT-2", decide=fake_decide,
                                  rediscover=rediscover, clock=clock)
        # poll 1: {s1}, s1 terminal, stable 1 → not done (two stable polls required)
        # poll 2: s2 appears → stable 0; s2 awaiting_human → its gate decided ON THE UI
        # poll 3: stable 1, s2 executing; poll 4: stable 2, s2 completed → done
        self.assertEqual(out["statuses"], {"s1": "completed", "s2": "completed"})
        self.assertEqual(decided, ["s2"])
        self.assertEqual(out["gates"], {"s1": [], "s2": [{"ord": 1, "decision": "approve", "status": 200}]})
        self.assertEqual(out["discovered"]["s2"]["poll"], 2)
        self.assertEqual(out["discovered"]["s2"]["attributed_by"], "listed in the campaign's node_run_id/attached_runs")
        self.assertEqual((out["polls"], out["stable_polls"], out["timed_out"], out["all_terminal"]), (4, 2, False, True))
        self.assertEqual(out["acceptance"], {"s1": "pass", "s2": "pass"})
        self.assertEqual(out["final_attribution"]["attributable_siblings"][1]["id"], "s2")
        # derive_result judges the late sibling like the others — and it passes only because BOTH are terminal with verdicts
        m = with_siblings("s1", siblings_followed=out)
        self.assertEqual(tfl.derive_result(m, []), {"harness_ok": True, "result": "pass", "fail_reasons": []})
        self.assertEqual(m["measured"]["sibling_verdicts"]["s2"], {"status": "completed", "verdict": "pass", "verdict_fetch_error": None, "discovered_late": True})
        self.assertFalse(m["measured"]["sibling_verdicts"]["s1"]["discovered_late"])

    def test_a_late_sibling_still_awaiting_human_at_the_follow_timeout_fails_the_scenario(self):
        def rediscover():
            return {"attributable_siblings": [{"id": "s1", "attributed_by": "x"}, {"id": "s2", "attributed_by": "x"}], "unrelated_new_runs": []}
        tfl.run_detail = lambda sid: {"session": {"status": "completed" if sid == "s1" else "awaiting_human"}}
        tfl.acceptance_verdict = lambda sid: "pass" if sid == "s1" else None
        decided: list[str] = []

        def fake_decide(page, sid, *, tag, return_to):
            decided.append(sid)
            return {"ord": 1, "decision": "approve", "status": 200}
        clock = FakeClock()
        out = tfl.follow_siblings(["s1"], max_s=60, sleep=clock.sleep, page=FakePage("x"), tag="LT-2", decide=fake_decide,
                                  rediscover=rediscover, clock=clock, poll_s=15)
        self.assertTrue(out["timed_out"])
        self.assertFalse(out["all_terminal"])
        self.assertEqual(out["statuses"], {"s1": "completed", "s2": "awaiting_human"})
        self.assertIn("s2", decided)                                 # its gate WAS decided on the UI, the daemon did not move
        self.assertEqual((out["polls"], out["followed_s"]), (5, 60))  # 0, 15, 30, 45, 60 s
        self.assertTrue(any("SIBLING_FOLLOW_MAX_S" in f and "not proven complete" in f for f in tfl.REPORT["findings"]))
        v = tfl.derive_result(with_siblings("s1", siblings_followed=out), [])
        self.assertTrue(v["harness_ok"])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any(r.startswith("sibling s2 did not reach a terminal state (status=awaiting_human)") for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertTrue(any(r.startswith("sibling s2 carries no acceptance verdict") for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertTrue(any("SIBLING_FOLLOW_MAX_S" in r for r in v["fail_reasons"]), v["fail_reasons"])

    def test_a_failed_rediscovery_resets_the_stability_count(self):
        polls = {"n": 0}

        def rediscover():
            polls["n"] += 1
            if polls["n"] == 2:
                raise tfl.FetchError(tfl.FetchMiss("/runs", 500, "down"))
            return {"attributable_siblings": [{"id": "s1", "attributed_by": "x"}], "unrelated_new_runs": []}
        tfl.run_detail = lambda sid: {"session": {"status": "completed"}}
        tfl.acceptance_verdict = lambda sid: "pass"
        clock = FakeClock()
        out = tfl.follow_siblings(["s1"], max_s=600, sleep=clock.sleep, page=FakePage("x"), tag="LT-2", rediscover=rediscover, clock=clock)
        # poll 1 stable 1 · poll 2 FAILED → 0 · poll 3 → 1 · poll 4 → 2 → done
        self.assertEqual((out["polls"], out["stable_polls"], out["rediscover_errors"], out["timed_out"]), (4, 2, 1, False))
        self.assertIn("rediscover=siblings_now", inspect.getsource(tfl._drive_intake))  # the live call site rediscovers

    def test_follow_without_a_page_records_the_gap_once_and_never_uses_the_api(self):
        seq = iter(["awaiting_human", "awaiting_human", "completed"])
        tfl.run_detail = lambda sid: {"session": {"status": next(seq)}}
        tfl.acceptance_verdict = lambda sid: None
        n = len(tfl.REPORT["findings"])
        out = tfl.follow_siblings(["s1"], max_s=60, sleep=lambda s: None, tag="LT-1")
        self.assertEqual(len(tfl.REPORT["findings"]) - n, 1)
        self.assertIn("cannot be decided on the UI", tfl.REPORT["findings"][-1])
        self.assertEqual(out["gates"], {"s1": []})
        src = inspect.getsource(tfl)
        self.assertNotIn('http_json("POST"', src)  # the harness has no POST path at all — gates go through the UI
        self.assertNotIn('method="POST"', src)


# ── Item 2: the verdict split — every sibling terminal WITH its own verdict ────────────────────


class ResultSplit(Isolated):
    def test_zero_siblings_is_fail_with_harness_ok(self):
        v = tfl.derive_result(recorded_like(), [])
        self.assertTrue(v["harness_ok"])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("no attributable sibling runs" in r for r in v["fail_reasons"]), v["fail_reasons"])

    def test_pass_requires_every_sibling_terminal_with_its_own_verdict(self):
        m = with_siblings("s1", "s2", siblings_followed={"statuses": {"s1": "completed", "s2": "executing"}, "all_terminal": False,
                                                          "acceptance": {"s1": "pass", "s2": None}})
        v = tfl.derive_result(m, [])
        self.assertTrue(v["harness_ok"])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any(r.startswith("sibling s2 did not reach a terminal state (status=executing)") for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertTrue(any(r.startswith("sibling s2 carries no acceptance verdict") for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertFalse(any("s1" in r for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertEqual(m["measured"]["sibling_verdicts"], {
            "s1": {"status": "completed", "verdict": "pass", "verdict_fetch_error": None, "discovered_late": False},
            "s2": {"status": "executing", "verdict": None, "verdict_fetch_error": None, "discovered_late": False}})
        m["measured"]["siblings_followed"] = {"statuses": {"s1": "completed", "s2": "completed"}, "all_terminal": True,
                                              "acceptance": {"s1": "pass", "s2": "fail"}}
        self.assertEqual(tfl.derive_result(m, []), {"harness_ok": True, "result": "pass", "fail_reasons": []})
        self.assertEqual(m["measured"]["sibling_verdicts"]["s2"]["verdict"], "fail")

    def test_unfollowed_or_verdictless_siblings_never_pass(self):
        v = tfl.derive_result(with_siblings("s1"), [])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("no acceptance verdict" in r for r in v["fail_reasons"]))
        v = tfl.derive_result(with_siblings("s1", siblings_followed={"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": ""}}), [])
        self.assertEqual(v["result"], "fail")

    def test_a_verdict_fetch_error_is_not_a_verdict(self):
        miss = tfl.FetchMiss("/runs/s1/acceptance", 500, "boom")
        m = with_siblings("s1", siblings_followed={"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": miss}})
        v = tfl.derive_result(m, [])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("carries no acceptance verdict (the fetch failed: 500)" in r for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertEqual(m["measured"]["sibling_verdicts"]["s1"]["verdict_fetch_error"]["status"], 500)

    def test_campaign_intent_also_requires_a_registered_campaign(self):
        m = with_siblings("s1", intent="campaign", siblings_followed={"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": "pass"}})
        v = tfl.derive_result(m, [])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("campaignRegistered=false" in r for r in v["fail_reasons"]))
        m["measured"]["campaign_registered"] = True
        m["measured"]["siblings_after_grace"]["campaign_for_label"] = [{"id": "recon-abc-123"}]
        self.assertEqual(tfl.derive_result(m, [])["result"], "pass")

    def test_plan_heuristics_alone_never_spell_pass(self):
        m = recorded_like()
        m["measured"]["plan"] = {"names_real_files": True, "classifies": True}
        self.assertEqual(tfl.derive_result(m, [])["result"], "fail")

    def test_any_fetch_error_blocks_pass(self):
        m = with_siblings("s1", siblings_followed={"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": "pass"}},
                          fetch_errors=[tfl.FetchMiss("/runs/run-1/units/2/output", 500, "boom")])
        v = tfl.derive_result(m, [])
        self.assertTrue(v["harness_ok"])  # infrastructure, not the harness's doing
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("evidence fetch error" in r and "/runs/run-1/units/2/output → 500" in r for r in v["fail_reasons"]), v["fail_reasons"])

    def test_a_gate_wire_mismatch_is_a_harness_failure_but_older_entries_are_not_retroactively_failed(self):
        g = {"ord": 1, "first": True, "decision": "reject", "status": 200, "wire_ok": False,
             "wire_check": "request body approve=True but the decision 'reject' requires approve=False"}
        v = tfl.derive_result(recorded_like(gates=[g]), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("gate-wire-mismatch", v["fail_reasons"])
        self.assertTrue(any("approve=True" in r for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertTrue(tfl.derive_result(recorded_like(), [])["harness_ok"])  # recorded_like's gate predates the field
        self.assertTrue(tfl.derive_result(recorded_like(gates=[{**g, "wire_ok": True}]), [])["harness_ok"])

    def test_harness_failures(self):
        v = tfl.derive_result(recorded_like(wedged=True, final_status="executing"), [])
        self.assertFalse(v["harness_ok"])
        self.assertEqual(v["result"], "wedged")
        v = tfl.derive_result(recorded_like(gates=[]), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("no gate was answered", v["fail_reasons"])
        v = tfl.derive_result(recorded_like(gate_on_panel_card=False), [])
        self.assertFalse(v["harness_ok"])
        v = tfl.derive_result(recorded_like(post_status=400, run_ids=[]), [])
        self.assertFalse(v["harness_ok"])
        v = tfl.derive_result(recorded_like(post_status=201, run_ids=[], launch_answer_unexpected=True, launch_answer={"ok": True}), [])
        self.assertFalse(v["harness_ok"])
        self.assertTrue(any("neither runIds nor runId" in r for r in v["fail_reasons"]), v["fail_reasons"])
        blocked = {"scenario": "LT-1", "intent": "recon", "result": "blocked-preflight", "measured": {}}
        v = tfl.derive_result(blocked, ["preflight never cleared for LT-1 after 20 min"])
        self.assertEqual(v, {"harness_ok": False, "result": "blocked-preflight", "fail_reasons": ["preflight never cleared"]})


# ── Item 6: attribution by relationship only — never by the brief ─────────────────────────────


class SiblingAttribution(unittest.TestCase):
    def run_(self, rid, problem="something else", **s):
        return {"session": {"id": rid, "status": "completed", "problem": problem, **s}}

    def attribute(self, runs, camps, prefix="", **kw):
        saved = tfl.TEST_PROBLEM_PREFIX
        tfl.TEST_PROBLEM_PREFIX = prefix
        try:
            return tfl.attribute_siblings(runs, camps, **kw)
        finally:
            tfl.TEST_PROBLEM_PREFIX = saved

    def test_relationship_not_mere_appearance(self):
        label = "recon-abc-123"
        runs = [
            self.run_("old"),                                     # existed before → ignored
            self.run_("own"),                                     # the launched run → ignored
            self.run_("stranger", problem="someone else's recon"),  # appeared, unrelated
            self.run_("by-campaign", campaign_id=label),
            self.run_("by-group", group_label=label),
            self.run_("by-parent", parent_run_id="own"),
            self.run_("by-problem-id", problem="PREFIX Execute S-1 from run own"),
            self.run_("by-problem-label", problem=f"PREFIX campaign {label} scenario 2"),
            self.run_(f"{label}:wicked-studio:a0"),               # a DAG node: linked via the campaign, not its id shape
            self.run_("by-brief", problem="PREFIX Survey wicked-studio at its current main …"),  # the brief is NOT a relationship
            self.run_("unmarked-id", problem="Execute S-1 from run own"),  # our id but no marker while one is configured
        ]
        camps = [{"id": label, "node_run_id": {"wicked-studio": f"{label}:wicked-studio:a0"}, "attached_runs": []}]
        out = self.attribute(runs, camps, prefix="PREFIX ", before={"old"}, own=["own"], label=label)
        self.assertEqual([s["id"] for s in out["attributable_siblings"]],
                         ["by-campaign", "by-group", "by-parent", "by-problem-id", "by-problem-label", f"{label}:wicked-studio:a0"])
        self.assertEqual([u["id"] for u in out["unrelated_new_runs"]], ["stranger", "by-brief", "unmarked-id"])
        self.assertTrue(all("attributed_by" in s for s in out["attributable_siblings"]))

    def test_identical_brief_is_unrelated(self):
        runs = [self.run_("twin", problem=tfl.INSTRUCTION), self.run_("prefixed-twin", problem=f"PREFIX {tfl.INSTRUCTION}")]
        out = self.attribute(runs, [], prefix="PREFIX ", before=set(), own=["own"], label="lbl")
        self.assertEqual(out["attributable_siblings"], [])
        self.assertEqual([u["id"] for u in out["unrelated_new_runs"]], ["twin", "prefixed-twin"])
        out = self.attribute([self.run_("twin", problem=tfl.INSTRUCTION)], [], before=set(), own=["own"], label="lbl")
        self.assertEqual(out["attributable_siblings"], [])

    def test_without_a_configured_marker_the_id_or_label_in_problem_suffices(self):
        runs = [self.run_("by-id", problem="Execute S-1 from run own"), self.run_("by-label", problem="under campaign lbl")]
        out = self.attribute(runs, [], before=set(), own=["own"], label="lbl")
        self.assertEqual([s["id"] for s in out["attributable_siblings"]], ["by-id", "by-label"])

    def test_no_brief_parameter_remains(self):
        self.assertNotIn("brief", inspect.signature(tfl.attribute_siblings).parameters)
        self.assertNotIn("brief=INSTRUCTION", inspect.getsource(tfl._drive_intake))

    def test_unrelated_run_is_not_a_sibling(self):
        out = self.attribute([self.run_("new-1")], [], before=set(), own=["own"], label="lbl")
        self.assertEqual(out["attributable_siblings"], [])
        self.assertEqual(out["unrelated_new_runs"][0]["id"], "new-1")


# ── Item 9: typed evidence-fetch misses ───────────────────────────────────────────────────────


class EvidenceFetch(Isolated):
    def setUp(self):
        super().setUp()
        self._saved_http = tfl.http_json
        self.sink: list = []
        tfl.set_fetch_sink(self.sink)

    def tearDown(self):
        tfl.http_json = self._saved_http
        super().tearDown()

    def answer(self, status, body):
        tfl.http_json = lambda method, url, timeout=30: (status, body)

    def test_unit_output_distinguishes_absent_from_failed(self):
        self.answer(200, {"output": "the plan"})
        self.assertEqual(tfl.unit_output("r", 1), "the plan")
        self.answer(200, {"output": None})
        self.assertIsNone(tfl.unit_output("r", 1))          # ABSENT evidence
        self.answer(204, None)
        self.assertIsNone(tfl.unit_output("r", 1))
        self.assertEqual(self.sink, [])                       # nothing recorded for absence
        self.answer(500, {"error": "boom"})
        miss = tfl.unit_output("r", 2)
        self.assertIsInstance(miss, tfl.FetchMiss)            # FAILED fetch
        self.assertEqual((miss["kind"], miss["endpoint"], miss["status"]), ("fetch-error", "/runs/r/units/2/output", 500))
        self.assertIn("boom", miss["error"])
        self.assertEqual(self.sink, [miss])
        self.assertTrue(any("evidence fetch failed: GET /runs/r/units/2/output → 500" in f for f in tfl.REPORT["findings"]))
        self.assertEqual(json.loads(json.dumps(miss))["status"], 500)  # serializes as plain JSON

    def test_acceptance_and_verdict(self):
        self.answer(200, {"acceptance": {"verdict": "pass"}})
        self.assertEqual(tfl.acceptance("r")["acceptance"]["verdict"], "pass")
        self.assertEqual(tfl.acceptance_verdict("r"), "pass")
        self.answer(200, {"acceptance": {"required": False}})
        self.assertIsNone(tfl.acceptance_verdict("r"))
        self.answer(200, None)
        self.assertIsNone(tfl.acceptance("r"))
        self.answer(503, {"error": "down"})
        self.assertIsInstance(tfl.acceptance("r"), tfl.FetchMiss)
        self.assertIsInstance(tfl.acceptance_verdict("r"), tfl.FetchMiss)
        self.assertEqual([e["endpoint"] for e in self.sink], ["/runs/r/acceptance", "/runs/r/acceptance"])

    def test_run_detail_and_events_raise_a_typed_error_after_recording(self):
        self.answer(500, {"error": "boom"})
        with self.assertRaises(tfl.FetchError) as cm:
            tfl.run_detail("r")
        self.assertEqual(cm.exception.miss["endpoint"], "/runs/r")
        self.assertEqual(cm.exception.miss["status"], 500)
        self.answer(0, {"error": "URLError: connection refused"})  # transport failure = status 0
        with self.assertRaises(tfl.FetchError) as cm:
            tfl.run_events("r")
        self.assertEqual(cm.exception.miss["status"], 0)
        self.assertIn("connection refused", cm.exception.miss["error"])
        self.answer(200, {"nope": True})
        with self.assertRaises(tfl.FetchError):
            tfl.run_detail("r")  # a 2xx without a `run` object is a typed miss too
        self.assertEqual(len(self.sink), 3)

    def test_run_events_and_listings_turn_unexpected_2xx_shapes_into_typed_misses(self):
        """Copilot on 9b1bc96 (`run_events`, :296): a 204 decoded as None, or any non-list/dict
        shape, raised `AttributeError` and crashed the harness without a typed miss."""
        self.answer(200, {"events": [{"type": "x"}]})
        self.assertEqual(tfl.run_events("r"), [{"type": "x"}])
        self.answer(200, [{"type": "y"}])
        self.assertEqual(tfl.run_events("r"), [{"type": "y"}])
        for status, body in ((204, None), (200, None), (200, {"nope": True}), (200, {"events": None}), (200, "a string"), (200, 7)):
            with self.assertRaises(tfl.FetchError, msg=repr(body)) as cm:
                self.answer(status, body)
                tfl.run_events("r")
            self.assertEqual((cm.exception.miss["endpoint"], cm.exception.miss["status"]), ("/runs/r/events", 200))
            self.assertIn("no events list", cm.exception.miss["error"])
        self.answer(200, {"runs": [{"session": {"id": "a"}}]})
        self.assertEqual(tfl.list_runs(), [{"session": {"id": "a"}}])
        self.answer(200, {"campaigns": []})
        self.assertEqual(tfl.list_campaigns(), [])
        for body in (None, [], {"runs": None}, {"campaigns": "x"}, "str"):
            with self.assertRaises(tfl.FetchError, msg=repr(body)):
                self.answer(200, body)
                tfl.list_runs()
            with self.assertRaises(tfl.FetchError, msg=repr(body)):
                self.answer(200, body)
                tfl.list_campaigns()
        self.assertEqual(self.sink[-1]["endpoint"], "/campaigns")
        self.assertEqual(self.sink[-2]["endpoint"], "/runs")
        self.assertEqual(len(self.sink), 6 + 10)

    def test_one_finding_per_endpoint_and_status(self):
        self.answer(500, {"error": "boom"})
        n = len(tfl.REPORT["findings"])
        tfl.unit_output("r", 1)
        tfl.unit_output("r", 1)
        self.assertEqual(len(self.sink), 2)
        self.assertEqual(len(tfl.REPORT["findings"]) - n, 1)

    def test_transport_errors_are_status_0(self):
        saved = tfl.urllib.request.urlopen
        try:
            def refuse(req, timeout=None):
                raise urllib.error.URLError("connection refused")
            tfl.urllib.request.urlopen = refuse
            status, body = self._saved_http("GET", "http://127.0.0.1:1/api/v1/health")
        finally:
            tfl.urllib.request.urlopen = saved
        self.assertEqual(status, 0)
        self.assertIn("URLError", body["error"])

    def test_scenario_sink_and_plan_section_split(self):
        src = inspect.getsource(tfl._drive_intake)
        self.assertIn('m["measured"]["missing_outputs"] = missing_outputs', src)
        self.assertIn('m["measured"]["failed_fetches"] = failed_fetches', src)
        self.assertIn('set_fetch_sink(m["measured"].setdefault("fetch_errors", []))', inspect.getsource(tfl.drive_intake))


class Scrub(unittest.TestCase):
    def test_home_fold(self):
        home = os.path.expanduser("~")
        self.assertEqual(tfl.scrub(f"root {home}/Projects/x and {home}/y"), "root ~/Projects/x and ~/y")

    def test_toolchain_elision(self):
        text = "## Skills\n- ~/.pi/agent/skills/a/SKILL.md\n- ~/.pi/agent/skills/b/SKILL.md\n- `~/.claude/skills/c`\nkeep me\n~/.codex/x.md"
        out = tfl.scrub(text)
        self.assertEqual(out, "## Skills\n- … (3 local toolchain paths elided)\nkeep me\n- … (1 local toolchain path elided)")
        self.assertNotIn("~/.pi", out)
        self.assertNotIn("~/.claude", out)

    def test_idempotent(self):
        text = f"{os.path.expanduser('~')}/a\n- ~/.pi/agent/skills/x\n- ~/.pi/agent/skills/y\nplain"
        once = tfl.scrub(text)
        self.assertEqual(tfl.scrub(once), once)


# ── Item 8: plan measurement over scenarios only ──────────────────────────────────────────────

FAKE_PATHS = {"src/App.tsx", "src/store/gates.ts", "src/hooks/useEventStream.ts", "src/a/index.ts", "src/b/index.ts",
              "tests/needsYou.test.ts", "e2e/studio_standalone_test.py"}
FAKE_INDEX = (FAKE_PATHS, {p.rsplit("/", 1)[-1]: [q for q in FAKE_PATHS if q.rsplit("/", 1)[-1] == p.rsplit("/", 1)[-1]] for p in FAKE_PATHS})


class AnalyzePlan(unittest.TestCase):
    PLAN = "\n".join([
        "## Test plan",
        "- ~/.pi/agent/skills/wicked-testing-scenario-executor/SKILL.md",
        "- ~/.claude/skills/wicked-testing-test-designer",
        "- S-1 verify /ws awaitingHuman frame opens the gate in `App.tsx`",
        "- 1.2 `[TOOL]` Gap check: `gates.ts` store parsing",
        "- A specific set of files you want scenario coverage for",
        "**Key gap found**: `e2e/studio_standalone_test.py` should be refreshed",
        "### Table of contents",
        "1. Scenario overview",
        "| # | Scenario | Class |",
        "|---|---|---|",
        "| 1 | WS reconnect/backoff in `useEventStream.ts` | Deterministic |",
        "| 2 | Needs-you queue ordering | Governed agent run — `needsYou.test.ts` |",
        "| Layer | File |",
        "|---|---|",
        "| Socket lifecycle | src/hooks/useEventStream.ts |",
        "| npm test | 2442 tests green |",
    ])

    def test_scenario_line_extraction(self):
        titles, ids = tfl.scenario_items(self.PLAN)
        self.assertIn("verify /ws awaitingHuman frame opens the gate in App.tsx", titles)
        self.assertIn("Gap check: gates.ts store parsing", titles)
        self.assertIn("WS reconnect/backoff in useEventStream.ts", titles)   # plan-table row (Scenario column)
        self.assertIn("Needs-you queue ordering", titles)                    # plan-table row without a verb in the title
        self.assertEqual(ids, ["1.2", "S-1"])
        joined = "\n".join(titles)
        self.assertNotIn("npm test", joined)              # an execution summary is a RESULT, not a scenario
        self.assertNotIn("SKILL.md", joined)              # a toolchain path is NOT a scenario
        self.assertNotIn("wicked-testing", joined)
        self.assertNotIn("Table of contents", joined)     # heading noise dropped
        self.assertNotIn("Scenario overview", joined)     # TOC item: no id, no verb
        self.assertNotIn("Key gap found", joined)         # bold-label paragraph is not an item
        self.assertNotIn("Socket lifecycle", joined)      # survey-table row: no verb in the title cell
        self.assertNotIn("files you want scenario coverage", joined)
        records, excluded = tfl.scenario_records(self.PLAN)
        self.assertEqual(excluded, {"execution_section_lines": 0, "execution_summary_items": 1})
        self.assertIn("[TOOL]", next(r["raw"] for r in records if r["id"] == "1.2"))  # raw keeps the class tag

    def test_analyze_plan_reports_canonical_files(self):
        plan = tfl.analyze_plan(self.PLAN, FAKE_INDEX)
        self.assertEqual(plan["canonical_files"], ["e2e/studio_standalone_test.py", "src/App.tsx", "src/hooks/useEventStream.ts", "src/store/gates.ts"])
        self.assertNotIn("tests/needsYou.test.ts", plan["canonical_files"])  # tests/ is not a source root
        self.assertTrue(plan["names_real_files"])
        self.assertEqual(plan["scenario_ids"], ["1.2", "S-1"])
        self.assertEqual(len(plan["scenario_lines"]), 4)
        self.assertTrue(plan["classifies"])  # Deterministic (row 1) + Governed agent run (row 2) — in the plan table
        self.assertEqual(plan["surfaces"], {"ws_events": True, "api_routes": False, "cli": False, "ui_pages": False})

    def test_no_plan_available_is_not_a_plan(self):
        text = ("No plan available.\n\nThe brief asked for: the live /ws CoreEvent fold (awaitingHuman, unitPlanned, "
                "sessionCompleted frames), the /api/v1 routes (runs, campaigns, testing/recon), its CLI entry points (npm run), "
                "and its UI pages (/testing/campaigns, /runs/:id, /steering, the home deck) — deterministic tool check vs "
                "governed agent run.\n\nFiles: `src/App.tsx`, `src/store/gates.ts`, `src/hooks/useEventStream.ts`\n")
        plan = tfl.analyze_plan(text, FAKE_INDEX)
        self.assertEqual(len(plan["canonical_files"]), 3)
        self.assertFalse(plan["names_real_files"])  # three real files but ZERO scenarios
        self.assertEqual(plan["scenario_lines"], [])
        self.assertEqual(plan["scenario_ids"], [])
        self.assertFalse(plan["classifies"])
        self.assertEqual(plan["surfaces"], {"ws_events": False, "api_routes": False, "cli": False, "ui_pages": False})

    def test_execution_verdict_sections_and_summaries_are_excluded(self):
        text = "\n".join([
            "## unit 2",
            "- `npm test` → 237 files / 2442 tests green",
            "- Tests: 12 passed, 0 failed for the /ws fold",
            "- ✓ verify the gate renders on /runs/:id",
            "- PASS verify /api/v1 routes",
            "## Execution verdict — wicked-studio test plan",
            "| Check | Result |",
            "|---|---|",
            "| npm run typecheck | clean |",
            "### Outstanding gaps",
            "- S-9 verify the /steering page renders",
            "## unit 3",
            "| # | Scenario | Class |",
            "|---|---|---|",
            "| 1 | verify /ws awaitingHuman opens the gate | Deterministic tool check |",
            "| 2 | drive a real run end to end on /runs/:id | Governed agent run |",
        ])
        records, excluded = tfl.scenario_records(text)
        self.assertEqual([r["title"] for r in records], ["verify /ws awaitingHuman opens the gate", "drive a real run end to end on /runs/:id"])
        self.assertEqual(excluded["execution_summary_items"], 4)
        self.assertEqual(excluded["execution_section_lines"], 6)  # heading + table (3) + sub-heading + S-9 bullet
        plan = tfl.analyze_plan(text, FAKE_INDEX)
        self.assertTrue(plan["classifies"])
        self.assertEqual(plan["surfaces"], {"ws_events": True, "api_routes": True, "cli": False, "ui_pages": True})
        self.assertEqual(plan["excluded"], excluded)

    def test_a_proposed_command_is_a_scenario_only_a_result_marker_excludes(self):
        """Codex round 3: a plan-table row proposing "Run npm run typecheck to verify CLI behavior"
        produced zero scenarios because the command alone matched the old regex. A line is a RESULT
        only when it carries a result marker; a fixture count ("21 failed runs ⇒ …", LT-1 unit 1
        row 2) is not a result."""
        table = "\n".join([
            "| # | Scenario | Class |",
            "|---|---|---|",
            "| 1 | Run npm run typecheck to verify CLI behavior | Deterministic |",          # PROPOSED → scenario
            "| 2 | Run `npm test` and `npm run lint` on the CLI | Deterministic |",           # PROPOSED → scenario
            "| 3 | Contradiction guard: 21 failed runs ⇒ calm copy cannot render | Deterministic |",  # fixture count → scenario
            "| 4 | npm test → 237 files / 2442 tests green | Deterministic |",                 # RESULT (green)
            "| 5 | verify /ws fold: 12 passed, 0 failed | Deterministic |",                     # RESULT (count in summary position)
            "| 6 | verify the CLI exits with exit code 0 | Deterministic |",                    # RESULT marker (exit code)
            "| 7 | ✓ verify /api/v1/runs answers 200 | Deterministic |",                       # RESULT (tick)
            "| 8 | PASS — verify /steering renders | Deterministic |",                          # RESULT (verdict word)
            "| 9 | verify the page rendered the required credentials | Deterministic |",        # 'red' inside words is not a marker
            "| 10 | check 2442 passed in 69s on the CLI | Deterministic |",                     # RESULT (pytest/vitest summary)
        ])
        records, excluded = tfl.scenario_records(table)
        titles = [r["title"] for r in records]
        self.assertEqual(titles, ["Run npm run typecheck to verify CLI behavior", "Run npm test and npm run lint on the CLI",
                                  "Contradiction guard: 21 failed runs ⇒ calm copy cannot render",
                                  "verify the page rendered the required credentials"])
        self.assertEqual(excluded, {"execution_section_lines": 0, "execution_summary_items": 6})
        plan = tfl.analyze_plan(table, FAKE_INDEX)
        self.assertTrue(plan["surfaces"]["cli"])  # the proposed typecheck/test/lint checks now count towards LT-4's CLI surface
        self.assertIn("a proposed command is a scenario", plan["measured_over"])
        rx = tfl.RESULT_MARKER_RE
        for s in ("3 failed", "12 skipped)", "**12 passed**", "12 passed of 14", "FAILED: x", "npm test → red", "exit 1", "✗ x", "✔ x"):
            self.assertTrue(rx.search(s), s)
        for s in ("21 failed runs", "the passing lane", "a redirect", "greenfield", "npm run typecheck", "npm test", "Tests: run them", "PASSING"):
            self.assertFalse(rx.search(s), s)
        self.assertFalse(hasattr(tfl, "EXEC_SUMMARY_RE"))

    def test_classifies_and_surfaces_are_measured_over_scenario_rows_only(self):
        survey = ("## Survey\n\nEach scenario is classified as a deterministic tool check or a governed agent run. The /ws CoreEvent fold "
                  "(awaitingHuman), the /api/v1 routes, the CLI (npm run) and the UI pages (/testing/campaigns, /steering) are in scope.\n\n")
        plan = tfl.analyze_plan(survey + "- S-1 verify the gate renders on the page\n", FAKE_INDEX)
        self.assertEqual(plan["scenario_lines"], ["verify the gate renders on the page"])
        self.assertFalse(plan["classifies"])
        self.assertEqual(plan["surfaces"], {"ws_events": False, "api_routes": False, "cli": False, "ui_pages": False})
        tagged = tfl.analyze_plan("- 1.1 `[TOOL]` check `gates.ts` store parsing\n- 1.2 `[AGENT]` verify a live /ws run end to end\n", FAKE_INDEX)
        self.assertTrue(tagged["classifies"])  # the [TOOL]/[AGENT] vocabulary counts, on the scenario rows
        self.assertTrue(tagged["surfaces"]["ws_events"])

    def test_canonical_identity(self):
        self.assertEqual(tfl.canonical_files([], ["App.tsx"], FAKE_INDEX), ["src/App.tsx"])
        self.assertEqual(tfl.canonical_files(["src/App.tsx"], ["App.tsx"], FAKE_INDEX), ["src/App.tsx"])   # one identity
        self.assertEqual(tfl.canonical_files([], ["index.ts"], FAKE_INDEX), ["index.ts"])                # ambiguous stays bare
        self.assertEqual(tfl.canonical_files(["src/a/index.ts"], ["index.ts"], FAKE_INDEX), ["src/a/index.ts"])  # covered → dropped

    def test_consistency_jaccard_over_canonical_set(self):
        a = {"measured": {"plan": tfl.analyze_plan("- S-1 verify the gate renders\n\nSource: `App.tsx`", FAKE_INDEX)}}
        b = {"measured": {"plan": tfl.analyze_plan("- S-1 verify the gate renders\n\nSource: `src/App.tsx`", FAKE_INDEX)}}
        c = tfl.consistency(a, b)
        self.assertEqual(c["files_overlap_pct"], 100.0)   # App.tsx ≡ src/App.tsx
        self.assertEqual(c["files_common"], ["src/App.tsx"])
        self.assertEqual(c["scenario_titles_overlap_pct"], 100.0)
        self.assertEqual(c["scenario_ids_overlap_pct"], 100.0)
        # Different wording → different titles, even when the files agree.
        d = {"measured": {"plan": tfl.analyze_plan("- S-2 check the gate closes\n\nSource: `src/App.tsx`", FAKE_INDEX)}}
        c2 = tfl.consistency(a, d)
        self.assertEqual((c2["files_overlap_pct"], c2["scenario_titles_overlap_pct"], c2["scenario_ids_overlap_pct"]), (100.0, 0.0, 0.0))
        # No ids on either side → undefined (None), not 0.
        e = {"measured": {"plan": tfl.analyze_plan("- verify the gate renders on the page", FAKE_INDEX)}}
        self.assertIsNone(tfl.consistency(e, e)["scenario_ids_overlap_pct"])
        # Legacy plan blocks (no canonical_files key) are canonicalized on the fly.
        legacy = {"measured": {"plan": {"real_files": [], "real_basenames": ["App.tsx"], "scenario_lines": [], "scenario_ids": []}}}
        saved = tfl._REPO_INDEX
        tfl._REPO_INDEX = FAKE_INDEX
        try:
            self.assertEqual(tfl.consistency(legacy, b)["files_overlap_pct"], 100.0)
        finally:
            tfl._REPO_INDEX = saved


class RecordedPlansRederive(unittest.TestCase):
    """The committed report.json numbers must be what the committed code says about the committed
    plan files — re-derived here, offline, over the real repo index (`git ls-files`)."""
    PLANS = {"LT-1": "d293f4d7-1e45-4346-809a-d6f2107c6b18", "LT-2": "f8bc2bad-47fc-4971-8961-bb49acb1dc6b", "LT-3": "d12adb6c-e4be-430a-b0a7-666db5634112"}
    EXPECT = {"LT-1": (16347, 31, 28, {"execution_section_lines": 28, "execution_summary_items": 1}),
              "LT-2": (8252, 14, 13, {"execution_section_lines": 0, "execution_summary_items": 0}),
              "LT-3": (13985, 30, 22, {"execution_section_lines": 0, "execution_summary_items": 0})}

    @staticmethod
    def plan_text(tag: str, rid: str) -> str:
        t = (tfl.ART / f"{tag}-plan-{rid}.md").read_text()
        i = t.index("```\n\n## unit") + len("```\n\n")
        return t[i:-1]  # exactly what analyze_plan() saw: the unit outputs, not the POST-body header

    def test_committed_plans_match_the_committed_report(self):
        if not (tfl.ART / "report.json").exists():
            self.skipTest("no committed report.json beside the harness")
        report = json.loads((tfl.ART / "report.json").read_text())
        for tag, rid in self.PLANS.items():
            plan = tfl.analyze_plan(self.plan_text(tag, rid))
            chars, files, lines, excluded = self.EXPECT[tag]
            self.assertEqual((plan["chars"], len(plan["canonical_files"]), len(plan["scenario_lines"]), plan["excluded"]), (chars, files, lines, excluded), tag)
            self.assertTrue(plan["names_real_files"] and plan["classifies"], tag)
            self.assertEqual(plan["surfaces"], {"ws_events": True, "api_routes": True, "cli": True, "ui_pages": True}, tag)
            recorded = report["scenarios"][tag]["measured"]["plan"]
            for k in ("chars", "canonical_files", "scenario_lines", "scenario_ids", "classifies", "names_real_files", "surfaces", "excluded"):
                self.assertEqual(plan[k], recorded[k], f"{tag}.plan.{k} in report.json is stale")
        cons = tfl.consistency({"measured": {"plan": tfl.analyze_plan(self.plan_text("LT-1", self.PLANS["LT-1"]))}},
                               {"measured": {"plan": tfl.analyze_plan(self.plan_text("LT-3", self.PLANS["LT-3"]))}})
        self.assertEqual((cons["files_overlap_pct"], cons["scenario_ids_overlap_pct"], cons["scenario_titles_overlap_pct"], cons["titles_a"], cons["titles_b"]),
                         (38.6, None, 0.0, 28, 22))
        recorded = report["scenarios"]["LT-3"]["consistency_vs_LT-1"]
        for k in ("files_overlap_pct", "scenario_ids_overlap_pct", "scenario_titles_overlap_pct", "titles_a", "titles_b", "files_common"):
            self.assertEqual(cons[k], recorded[k], f"consistency.{k} in report.json is stale")

    def test_lt1_excluded_lines_are_its_execution_summaries(self):
        text = self.plan_text("LT-1", self.PLANS["LT-1"])
        titles, _ = tfl.scenario_items(text)
        self.assertNotIn("npm test", titles)
        self.assertNotIn("npm test → 237 files / 2442 tests green", titles)  # a RESULT: `green`
        self.assertFalse(any(t.startswith("#10 e2e/studio_standalone_test.py") for t in titles))  # inside the "Execution verdict" section
        self.assertIn("WS reconnect/backoff, stale-socket guard, malformed-frame skip", titles)
        # Round 3: a proposed scenario whose fixture is a count stays a scenario (unit 1, plan-table row 2).
        self.assertIn("Contradiction guard: 21 failed runs ⇒ calm copy cannot render", titles)

    def test_recorded_gates_re_verify_on_the_wire_and_re_decide_approve(self):
        """The three recorded intake gates, re-checked offline with `gate_wire_check` over the
        recorded url/body/status (backfilled into gates[0] from `gate_response`, round 3) and
        re-decided under the round-3 policy: approve, wire verified — agreeing with what was clicked."""
        if not (tfl.ART / "report.json").exists():
            self.skipTest("no committed report.json beside the harness")
        report = json.loads((tfl.ART / "report.json").read_text())
        for tag in self.PLANS:
            sc = report["scenarios"][tag]
            m = sc["measured"]
            g = m["gates"][0]
            self.assertEqual(len(m["gates"]), 1, tag)
            self.assertIsNone(tfl.gate_wire_check(g, m["run_ids"][0]), tag)
            self.assertEqual((g["url"], g["body"]), (m["gate_response"]["url"], m["gate_response"]["body"]), tag)
            self.assertTrue(g["wire_ok"], tag)
            decision, reason = tfl.gate_decision(g["prompt"], g["unit"])
            self.assertEqual((decision, g["decision"]), ("approve", "approve"), tag)
            self.assertEqual(reason, g["reason"], f"{tag}.gates[0].reason in report.json is stale")
            v = tfl.derive_result(sc, report["blockers"])
            self.assertEqual((v["harness_ok"], v["result"]), (sc["harness_ok"], sc["result"]), tag)
            self.assertEqual(v["fail_reasons"], sc["fail_reasons"], tag)
            for p in (p for p in report["preflights"] if p["scenario"] == tag):
                self.assertIn("fanout", p["readings"][0], tag)  # backfilled: "not measured" — the gate postdates the launches


# ── Item 7: contained, symlink-safe, unique-temp-file artifact writes ─────────────────────────


class ArtifactWrites(unittest.TestCase):
    def test_safe_name(self):
        self.assertEqual(tfl.safe_name("d293f4d7-1e45-4346-809a-d6f2107c6b18"), "d293f4d7-1e45-4346-809a-d6f2107c6b18")
        self.assertEqual(tfl.safe_name("recon-abc:wicked-studio:a0"), "recon-abc_wicked-studio_a0")
        self.assertEqual(tfl.safe_name("../../etc/passwd"), "______etc_passwd")
        self.assertEqual(tfl.safe_name("a/b:c dé"), "a_b_c_d_")
        for bad in ("", "...", "///", ".", " "):
            with self.assertRaises(SystemExit, msg=repr(bad)):
                tfl.safe_name(bad)

    def test_artifact_path_is_contained_and_never_a_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "art"
            p = tfl.artifact_path("LT-1-plan-x.md", root)
            self.assertEqual(p, root / "LT-1-plan-x.md")
            self.assertTrue(root.is_dir())
            for name in ("../escape.md", "../../etc/passwd", "sub/../../escape.png"):
                with self.assertRaises(SystemExit, msg=name):
                    tfl.artifact_path(name, root)
            (root / "real.md").write_text("x")
            (root / "inside-link.md").symlink_to(root / "real.md")
            (Path(d) / "outside.md").write_text("y")
            (root / "outside-link.md").symlink_to(Path(d) / "outside.md")
            for name in ("inside-link.md", "outside-link.md"):
                with self.assertRaises(SystemExit, msg=name) as cm:
                    tfl.artifact_path(name, root)
                self.assertIn("symlink", str(cm.exception))
            self.assertEqual((Path(d) / "outside.md").read_text(), "y")

    def test_every_component_is_lstat_checked_not_only_the_final_target(self):
        """Codex round 3: containment trusted a symlinked root and checked only the final target."""
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "elsewhere").mkdir()
            (d / "art").mkdir()
            (d / "art" / "sub").symlink_to(d / "elsewhere")             # a symlinked INTERMEDIATE directory
            with self.assertRaises(SystemExit) as cm:
                tfl.artifact_path("sub/LT-1-plan-x.md", d / "art")
            self.assertIn(str(d / "art" / "sub"), str(cm.exception))
            self.assertIn("symlink", str(cm.exception))
            self.assertEqual(list((d / "elsewhere").iterdir()), [])
            (d / "artlink").symlink_to(d / "elsewhere")                 # a symlinked ROOT
            with self.assertRaises(SystemExit) as cm:
                tfl.artifact_path("x.md", d / "artlink")
            self.assertIn(str(d / "artlink"), str(cm.exception))
            with self.assertRaises(SystemExit):
                tfl.write_report({"x": 1}, d / "artlink" / "report.json", d / "artlink")
            self.assertEqual(list((d / "elsewhere").iterdir()), [])
            (d / "base").symlink_to(d / "elsewhere")                    # a symlink ABOVE the root, walked from an explicit base
            with self.assertRaises(SystemExit) as cm:
                tfl.artifact_path("x.md", d / "base" / "art", base=d)
            self.assertIn(str(d / "base"), str(cm.exception))
            with self.assertRaises(SystemExit):
                tfl.artifact_path("/etc/passwd", d / "art")             # an absolute name is not under the root
            self.assertEqual(tfl.artifact_path("deep/er/x.md", d / "art"), d / "art" / "deep" / "er" / "x.md")  # real components are fine
        # The real evidence dir is walked from the (resolved) repo root: e2e, e2e/artifacts, e2e/artifacts/test-feature-live.
        self.assertEqual(tfl._anchor(tfl.ART), tfl.ROOT)
        self.assertEqual(tfl._anchor(Path("/x/y/art")), Path("/x/y"))
        src = inspect.getsource(tfl.artifact_path)
        self.assertLess(src.index("refuse_symlinked_components(root"), src.index("mkdir("))       # walk the root BEFORE creating it
        self.assertLess(src.index("refuse_symlinked_components(p, root)"), src.index("resolve()"))  # lstat every component, then contain

    def test_plan_and_screenshot_paths_go_through_artifact_path(self):
        src = inspect.getsource(tfl._drive_intake)
        self.assertIn('artifact_path(f"{tag}-plan-{safe_name(run_id)}.md")', src)
        self.assertIn('artifact_path(f"{tag}-{name}.png")', src)
        self.assertNotIn('ART / f"', src)
        self.assertNotIn("run_id.replace(':', '_')", src)

    def test_write_is_atomic_and_leaves_no_tmp(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / "report.json"
            out = tfl.write_report({"a": 1, "p": Path("/x")}, path)
            self.assertEqual(out, path)
            self.assertEqual(json.loads(path.read_text()), {"a": 1, "p": "/x"})
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["report.json"])

    def test_write_report_refuses_escape_and_symlinked_target(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "art"
            root.mkdir()
            with self.assertRaises(SystemExit):
                tfl.write_report({"x": 1}, root / ".." / "report.json", root)
            (Path(d) / "victim.json").write_text('{"keep": true}')
            (root / "report.json").symlink_to(Path(d) / "victim.json")
            with self.assertRaises(SystemExit):
                tfl.write_report({"x": 1}, root / "report.json", root)
            self.assertEqual(json.loads((Path(d) / "victim.json").read_text()), {"keep": True})
            self.assertEqual([p.name for p in root.iterdir()], ["report.json"])  # no temp file left behind either

    def test_failed_write_never_exposes_partial_json(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "report.json"
            tfl.write_report({"good": True}, path)
            saved = tfl.os.replace
            tfl.os.replace = lambda *_: (_ for _ in ()).throw(OSError("disk full"))
            try:
                with self.assertRaises(OSError):
                    tfl.write_report({"partial": True}, path)
            finally:
                tfl.os.replace = saved
            self.assertEqual(json.loads(path.read_text()), {"good": True})      # the previous report is intact
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["report.json"])  # no tmp left behind
            # A failure while PRODUCING the JSON (before the rename) → still no tmp, still intact.
            saved_scrub = tfl.scrub
            tfl.scrub = lambda _t: (_ for _ in ()).throw(RuntimeError("boom mid-serialization"))
            try:
                with self.assertRaises(RuntimeError):
                    tfl.write_report({"partial": True}, path)
            finally:
                tfl.scrub = saved_scrub
            self.assertEqual(json.loads(path.read_text()), {"good": True})
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["report.json"])

    def test_two_writers_use_unique_temp_files(self):
        """Writer 2 runs to completion in the middle of writer 1's rename: with a shared
        `report.json.tmp` it would have overwritten writer 1's temp file and renamed it away
        (writer 1's rename then fails); with unique temp files both complete and the last rename wins."""
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "report.json"
            real_replace = tfl.os.replace
            seen: list[str] = []

            def replace_with_a_concurrent_writer(src, dst):
                seen.append(os.path.basename(src))
                if len(seen) == 1:
                    tfl.write_report({"writer": 2}, path)  # completes fully while writer 1's temp file exists
                real_replace(src, dst)
            tfl.os.replace = replace_with_a_concurrent_writer
            try:
                tfl.write_report({"writer": 1}, path)
            finally:
                tfl.os.replace = real_replace
            self.assertEqual(len(seen), 2)
            self.assertNotEqual(seen[0], seen[1])
            self.assertTrue(all(re.fullmatch(r"\.report-.+\.tmp", s) for s in seen), seen)
            self.assertEqual(json.loads(path.read_text()), {"writer": 1})
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["report.json"])

    def test_main_persists_on_every_exit_path(self):
        src = inspect.getsource(tfl.main)
        self.assertIn("finally:", src)
        self.assertIn('REPORT["aborted"]', src)
        self.assertIn("write_report()  # evidence lands after EVERY scenario", src)


# ── Item 10: the two Copilot threads ──────────────────────────────────────────────────────────


class RepoFilesAndLaunchAnswer(unittest.TestCase):
    def setUp(self):
        self._saved_index, self._saved_run = tfl._REPO_INDEX, tfl.subprocess.run
        tfl._REPO_INDEX = None

    def tearDown(self):
        tfl._REPO_INDEX, tfl.subprocess.run = self._saved_index, self._saved_run

    def test_git_failure_is_a_named_exit_not_an_empty_repo(self):
        def fail(argv, **kw):
            raise subprocess.CalledProcessError(128, argv, stderr="fatal: not a git repository")
        tfl.subprocess.run = fail
        with self.assertRaises(SystemExit) as cm:
            tfl.repo_files()
        self.assertIn("git", str(cm.exception))
        self.assertIn("fatal: not a git repository", str(cm.exception))
        self.assertIsNone(tfl._REPO_INDEX)

        def missing(argv, **kw):
            raise FileNotFoundError("git")
        tfl.subprocess.run = missing
        with self.assertRaises(SystemExit):
            tfl.repo_files()
        tfl.subprocess.run = lambda argv, **kw: types.SimpleNamespace(stdout="", returncode=0)
        with self.assertRaises(SystemExit) as cm:
            tfl.repo_files()
        self.assertIn("no tracked files", str(cm.exception))

    def test_git_ls_files_is_checked(self):
        src = inspect.getsource(tfl.repo_files)
        self.assertIn("check=True", src)
        self.assertNotIn(", capture_output=True, text=True).stdout", src)

    def test_launched_run_ids(self):
        self.assertEqual(tfl.launched_run_ids({"runIds": ["a", "b"], "runId": "a"}), ["a", "b"])
        self.assertEqual(tfl.launched_run_ids({"runId": "a"}), ["a"])
        self.assertEqual(tfl.launched_run_ids({"runIds": [], "runId": "a"}), ["a"])
        for shape in ({}, {"runIds": []}, {"runIds": [None, ""]}, {"runId": ""}, {"campaign": "x"}, "a string", None, ["a"]):
            self.assertEqual(tfl.launched_run_ids(shape), [], repr(shape))

    def test_unexpected_launch_answer_is_recorded_not_indexed(self):
        src = inspect.getsource(tfl._drive_intake)
        self.assertIn("run_ids = launched_run_ids(answer)", src)
        self.assertLess(src.index("if not run_ids:"), src.index("run_id = run_ids[0]"))
        self.assertIn('m["measured"]["launch_answer_unexpected"] = True', src)
        self.assertIn('shot(page, "03-launch-answer-unexpected")', src)
        self.assertNotIn('answer.get("runIds") or ([answer["runId"]]', src)


if __name__ == "__main__":
    unittest.main()
