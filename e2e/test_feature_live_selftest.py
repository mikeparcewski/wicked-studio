#!/usr/bin/env python3
"""
Offline regression tests for the live Test-feature harness (`e2e/test_feature_live.py`).

Deterministic, stdlib `unittest` only: no network, no Playwright, no daemon, no macOS probes —
the harness module is imported via `importlib` (its `main()` is `__main__`-guarded) and only its
pure pieces are exercised: the preflight thresholds, the one gate policy, the verdict split,
sibling attribution, `scrub()`, plan analysis (scenario-line extraction + canonical file identity)
and the atomic report write.

Run:  python3 -m unittest e2e/test_feature_live_selftest.py -v
(studio's CI has no Python step — run this by hand before pushing a harness change.)
"""
from __future__ import annotations

import importlib.util
import inspect
import json
import os
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("test_feature_live", HERE / "test_feature_live.py")
tfl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tfl)  # type: ignore[union-attr]


def reading(**over) -> dict:
    base = {"ts": "00:00:00", "free_mb": 60, "available_mb": 16000, "load1": 8.5, "swap_pct": 93.0, "active_runs": []}
    base.update(over)
    return base


# A measured block shaped like the recorded LT-1 (d293f4d7…): everything the harness did worked,
# the run completed with a real-file-naming, classifying plan — and zero siblings appeared.
def recorded_like(intent: str = "recon", **over) -> dict:
    m = {
        "scenario": "LT-X", "intent": intent, "result": "not-run", "notes": [],
        "measured": {
            "post_status": 201, "run_ids": ["run-1"], "campaign_label": "recon-abc-123", "campaign_registered": False,
            "gate_on_panel_card": True, "gate_via_run_page_fallback": False,
            "gates": [{"ord": 1, "first": True, "prompt": "Approve unit 1 before it runs: Recon: …", "decision": "approve",
                       "reason": "no deliver keyword", "status": 200}],
            "final_status": "completed", "wedged": False,
            "plan": {"names_real_files": True, "classifies": True},
            "siblings_at_terminal": {"attributable_siblings": [], "unrelated_new_runs": [], "campaign_for_label": []},
            "siblings_after_grace": {"attributable_siblings": [], "unrelated_new_runs": [], "campaign_for_label": []},
        },
    }
    m["measured"].update(over)
    return m


class PreflightThresholds(unittest.TestCase):
    def test_contract_default_is_85(self):
        p = tfl.preflight_policy({})
        self.assertEqual(p["swap_max_pct"], 85)
        self.assertEqual(p["contract_swap_max_pct"], 85)
        self.assertEqual(tfl.SWAP_MAX_PCT_CONTRACT, 85)
        self.assertNotIn("contract_deviation", p)
        self.assertEqual(p["source"], "contract default")

    def test_env_override_is_recorded_as_a_contract_deviation(self):
        p = tfl.preflight_policy({"SWAP_MAX_PCT": "95"})
        self.assertEqual(p["swap_max_pct"], 95)
        self.assertIn("contract_deviation", p)
        self.assertIn("95", p["contract_deviation"])
        self.assertIn("85", p["contract_deviation"])
        self.assertEqual(p["source"], "SWAP_MAX_PCT env")

    def test_env_override_equal_to_contract_is_not_a_deviation(self):
        self.assertNotIn("contract_deviation", tfl.preflight_policy({"SWAP_MAX_PCT": "85"}))

    def test_invalid_env_refuses(self):
        for bad in ("abc", "0", "101", "-5"):
            with self.assertRaises(SystemExit, msg=bad):
                tfl.preflight_policy({"SWAP_MAX_PCT": bad})

    def test_swap_gate_uses_the_effective_threshold(self):
        r = reading(swap_pct=93.0)
        self.assertEqual(tfl.preflight_ok(r, tfl.preflight_policy({})), ["swap 93.0% >= 85%"])
        self.assertEqual(tfl.preflight_ok(r, tfl.preflight_policy({"SWAP_MAX_PCT": "95"})), [])
        self.assertEqual(tfl.preflight_ok(reading(swap_pct=84.9), tfl.preflight_policy({})), [])

    def test_load_and_active_run_gates(self):
        p = tfl.preflight_policy({"SWAP_MAX_PCT": "95"})
        self.assertEqual(tfl.preflight_ok(reading(load1=20.0), p), ["load1 20.0 >= 20"])
        self.assertEqual(tfl.preflight_ok(reading(active_runs=["r1"]), p), ["active runs: ['r1']"])
        self.assertEqual(tfl.preflight_ok(reading(), p), [])
        why = tfl.preflight_ok(reading(load1=25, active_runs=["r1"], swap_pct=99), tfl.preflight_policy({}))
        self.assertEqual(len(why), 3)

    def test_every_preflight_reading_records_the_threshold(self):
        saved_readings, saved_pf = tfl.readings, dict(tfl.REPORT)
        try:
            tfl.readings = lambda: reading(swap_pct=93.0)
            tfl.REPORT["preflight_policy"] = tfl.preflight_policy({"SWAP_MAX_PCT": "95"})
            tfl.REPORT["preflights"] = []
            self.assertTrue(tfl.preflight("T-1"))
            entry = tfl.REPORT["preflights"][0]
            self.assertTrue(entry["cleared"])
            self.assertEqual(entry["readings"][0]["swap_max_pct"], 95)
            self.assertEqual(entry["readings"][0]["load1_max"], 20)
            self.assertEqual(entry["readings"][0]["blocked_by"], [])
        finally:
            tfl.readings = saved_readings
            tfl.REPORT.clear()
            tfl.REPORT.update(saved_pf)
            tfl.REPORT["preflights"] = []
            tfl.REPORT.pop("preflight_policy", None)


class GateDecision(unittest.TestCase):
    def test_deliver_class_prompts_are_rejected(self):
        for p in ("Deliver: open a PR against main", "push the branch to origin", "Approve unit 4 before it runs: merge into main",
                  "Open a pull request with the results", "Publish the package", "Cut the release", "Approve PR #12"):
            decision, reason = tfl.gate_decision(p)
            self.assertEqual(decision, "reject", p)
            self.assertIn("never deliver", reason)

    def test_plan_approval_and_pre_execution_gates_are_approved(self):
        for p in ("Approve proposed test plan for wicked-studio before the siblings launch",
                  "Approve unit 1 before it runs: Recon: survey the target and propose a test plan — the scenarios, their "
                  "dependencies, and which are deterministic tool checks vs governed agent runs.",
                  "Approve unit 1 before it runs: New test: plan the test for the attached scope — … and run the approved "
                  "plan as governed sibling runs under one test.",
                  "Amend the plan?"):
            self.assertEqual(tfl.gate_decision(p)[0], "approve", p)

    def test_the_first_gate_goes_through_the_same_decision_function(self):
        src = inspect.getsource(tfl.drive_intake)
        # No unconditional Approve click anywhere: every click targets steering-{decision}.
        self.assertNotIn('[data-testid="steering-approve"]', src)
        self.assertEqual(src.count("steering-{decision}"), 2, "first gate + later gates both use the decision")
        self.assertEqual(src.count("gate_decision("), 2)
        # No allow-list left: the old "Approve unit N before it runs" allow-list is gone from the loop.
        self.assertNotIn('re.match(r"Approve unit \\d+ before it runs", ptxt)', src)

    def test_empty_prompt_is_not_deliver(self):
        self.assertEqual(tfl.gate_decision("")[0], "approve")


class ResultSplit(unittest.TestCase):
    def test_zero_siblings_is_fail_with_harness_ok(self):
        v = tfl.derive_result(recorded_like(), [])
        self.assertTrue(v["harness_ok"])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("no attributable sibling runs" in r for r in v["fail_reasons"]), v["fail_reasons"])

    def test_recon_passes_only_with_siblings_that_reached_verdicts(self):
        sib = {"attributable_siblings": [{"id": "s1", "attributed_by": "x"}], "unrelated_new_runs": [], "campaign_for_label": []}
        m = recorded_like(siblings_after_grace=sib)
        v = tfl.derive_result(m, [])
        self.assertEqual(v["result"], "fail")
        self.assertTrue(any("no acceptance verdict" in r for r in v["fail_reasons"]))
        m["measured"]["siblings_followed"] = {"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": "pass"}}
        v = tfl.derive_result(m, [])
        self.assertEqual(v, {"harness_ok": True, "result": "pass", "fail_reasons": []})

    def test_campaign_intent_also_requires_a_registered_campaign(self):
        sib = {"attributable_siblings": [{"id": "s1"}], "unrelated_new_runs": [], "campaign_for_label": []}
        m = recorded_like("campaign", siblings_after_grace=sib,
                          siblings_followed={"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": "pass"}})
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
        blocked = {"scenario": "LT-1", "intent": "recon", "result": "blocked-preflight", "measured": {}}
        v = tfl.derive_result(blocked, ["preflight never cleared for LT-1 after 20 min"])
        self.assertEqual(v, {"harness_ok": False, "result": "blocked-preflight", "fail_reasons": ["preflight never cleared"]})


class SiblingAttribution(unittest.TestCase):
    def run_(self, rid, problem="something else", **s):
        return {"session": {"id": rid, "status": "completed", "problem": problem, **s}}

    def test_relationship_not_mere_appearance(self):
        label = "recon-abc-123"
        runs = [
            self.run_("old"),                                     # existed before → ignored
            self.run_("own"),                                     # the launched run → ignored
            self.run_("stranger", problem="someone else's recon"),  # appeared, unrelated
            self.run_("by-campaign", campaign_id=label),
            self.run_("by-group", group_label=label),
            self.run_("by-problem-id", problem="Execute S-1 from run own"),
            self.run_("by-problem-label", problem=f"campaign {label} scenario 2"),
            self.run_(f"{label}:wicked-studio:a0"),               # a DAG node: linked via the campaign, not its id shape
            self.run_("by-brief", problem="PREFIX Survey wicked-studio at its current main …"),
        ]
        camps = [{"id": label, "node_run_id": {"wicked-studio": f"{label}:wicked-studio:a0"}, "attached_runs": []}]
        saved = tfl.TEST_PROBLEM_PREFIX
        tfl.TEST_PROBLEM_PREFIX = "PREFIX "
        try:
            out = tfl.attribute_siblings(runs, camps, before={"old"}, own=["own"], label=label,
                                         brief="Survey wicked-studio at its current main …")
        finally:
            tfl.TEST_PROBLEM_PREFIX = saved
        self.assertEqual([s["id"] for s in out["attributable_siblings"]],
                         ["by-campaign", "by-group", "by-problem-id", "by-problem-label", f"{label}:wicked-studio:a0", "by-brief"])
        self.assertEqual([u["id"] for u in out["unrelated_new_runs"]], ["stranger"])
        self.assertTrue(all("attributed_by" in s for s in out["attributable_siblings"]))

    def test_unrelated_run_is_not_a_sibling(self):
        out = tfl.attribute_siblings([self.run_("new-1")], [], before=set(), own=["own"], label="lbl", brief="brief")
        self.assertEqual(out["attributable_siblings"], [])
        self.assertEqual(out["unrelated_new_runs"][0]["id"], "new-1")


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
        "| 2 | Needs-you queue ordering | Deterministic — `needsYou.test.ts` |",
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
        self.assertIn("npm test", titles)                                    # non-plan table row with verb + noun
        self.assertEqual(ids, ["1.2", "S-1"])
        joined = "\n".join(titles)
        self.assertNotIn("SKILL.md", joined)              # a toolchain path is NOT a scenario
        self.assertNotIn("wicked-testing", joined)
        self.assertNotIn("Table of contents", joined)     # heading noise dropped
        self.assertNotIn("Scenario overview", joined)     # TOC item: no id, no verb
        self.assertNotIn("Key gap found", joined)         # bold-label paragraph is not an item
        self.assertNotIn("Socket lifecycle", joined)      # survey-table row: no verb in the title cell
        self.assertNotIn("files you want scenario coverage", joined)

    def test_analyze_plan_reports_canonical_files(self):
        plan = tfl.analyze_plan(self.PLAN, FAKE_INDEX)
        self.assertEqual(plan["canonical_files"], ["e2e/studio_standalone_test.py", "src/App.tsx", "src/hooks/useEventStream.ts", "src/store/gates.ts"])
        self.assertNotIn("tests/needsYou.test.ts", plan["canonical_files"])  # tests/ is not a source root
        self.assertTrue(plan["names_real_files"])
        self.assertEqual(plan["scenario_ids"], ["1.2", "S-1"])
        self.assertEqual(len(plan["scenario_lines"]), 5)

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


class AtomicReportWrite(unittest.TestCase):
    def test_write_is_atomic_and_leaves_no_tmp(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / "report.json"
            out = tfl.write_report({"a": 1, "p": Path("/x")}, path)
            self.assertEqual(out, path)
            self.assertEqual(json.loads(path.read_text()), {"a": 1, "p": "/x"})
            self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["report.json"])

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

    def test_main_persists_on_every_exit_path(self):
        src = inspect.getsource(tfl.main)
        self.assertIn("finally:", src)
        self.assertIn('REPORT["aborted"]', src)
        self.assertIn("write_report()  # evidence lands after EVERY scenario", src)


if __name__ == "__main__":
    unittest.main()
