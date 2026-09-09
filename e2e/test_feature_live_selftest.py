#!/usr/bin/env python3
"""
Offline regression tests for the live Test-feature harness (`e2e/test_feature_live.py`).

Deterministic, stdlib `unittest` only: no network, no Playwright, no daemon, no macOS probes —
the harness module is imported via `importlib` (its `main()` is `__main__`-guarded) and its pure
pieces are exercised with fakes: the preflight thresholds + the acknowledged contract deviation
(the amended contract), the fan-out gate decided on TOKENS over an injected process table (codex's
three argument-order probes; round 5's build shorthand `pnpm build` / `yarn build` / `bun test` and
direct executables `node …/vite/bin/vite.js build`; a failed `ps`), the pre-submit preflight and the
flock launch reservation (O_NOFOLLOW, symlinked lock / directory refused), the gate policy (an
ALLOW-LIST that fails closed: approve only on an allow-listed shape + a known non-delivery kind +
no delivery verb anywhere in the complete prompt — codex's `gh pr create`, `push the branch`,
`Prompt unavailable` probes all reject) and the UI click path with a fake page AND a fake read-only
daemon (`GET /runs/:id/gate`, `GET /runs/:id/events` over `tfl._fetch` — no test touches the
network): the decision is taken on the COMPLETE prompt the daemon serves, never on the card's
`cleanPrompt()` headline (round 5: `… Finalize the test [gh pr create --fill]` rejects on the
bracketed command the card hides; an unserved full prompt rejects; a card that is not the full
prompt's headline rejects), and the wire is verified (exact endpoint for THIS run, body.approve ==
the decision, 2xx — a contradictory wire is a mismatch), sibling gates through the UI while
following with per-poll REDISCOVERY (a late sibling is followed; a late sibling still gated at the
timeout fails; a sibling gate's wire mismatch fails the harness), the verdict split (every sibling
terminal with its own verdict), sibling attribution without the brief fallback, typed
evidence-fetch misses (events, listings, and a unit `output` of the wrong type), the launch body
recorded raw when it is not JSON, `scrub()`, plan analysis (scenario rows only, execution RESULTS
excluded only on a result STRUCTURE — a proposed command or an expected outcome such as "Verify
failed /runs cards render red" is a scenario — canonical file identity; re-derived over the three
committed plans), the artifacts root walked BEFORE startup creates it (a symlinked `e2e/artifacts`
refuses `main()`), and the ONE dir-fd-anchored artifact writer (`O_DIRECTORY | O_NOFOLLOW` on the
verified directory, `O_EXCL | O_NOFOLLOW` temp file via `dir_fd=`, `fsync`, `rename` via
`src_dir_fd`/`dst_dir_fd`) under deterministic symlink SUBSTITUTION between validation and write
(target swapped → the link is replaced, never followed; parent swapped → refused; temp name
pre-planted → refused). Round 6: gate IDENTITY before any click — the card must be the daemon's
CURRENT gate (`GET /runs/:id/gate`, else the LATEST `awaitingHuman` event, never an older prompt);
codex's stale ord-1 card over a current ord-4 delivery gate is `reject-by-abstention` with NO click
(`gate-state-conflict`, `harness_ok=false`), an unreadable latest prompt never falls back to an older
readable one; every directory component under the evidence dir is opened `O_NOFOLLOW` RELATIVE to
the previous descriptor (an ancestor `e2e/artifacts` swapped for a link — between two walks or
during one — is refused, for artifacts, the report and the lock); `pytest -n 8` / `python3 -m pytest
-n 8` / `-m unittest` trip the fan-out fence; a result structure excludes only a verb-less cell (`S-1
Verify CLI returns exit code 1 …` and `S-2 Verify completed UI cards show ✓ …` are scenarios). The
only local resource touched is `git ls-files` of this worktree (for the committed-plan
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
import urllib.parse
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


# ── Item 1 (the contract as AMENDED 2026-09-09): the 85 % default, the acknowledged override ───
# "the 85% default stands; an EXPLICIT operator override (SWAP_MAX_PCT together with
# SWAP_MAX_PCT_ACK=contract-deviation) is permitted and MUST be recorded in the report as a contract
# deviation" — the harness implements exactly that; these tests are its statement.


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
  813 cargo +stable build
  814 claude --model opus --print task
  815 wicked-crew serve --db /tmp/x --port 62432
  816 node /x/app.js --port 62432
  817 node /opt/homebrew/bin/wicked-crew serve --port=62432
  818 node /opt/homebrew/bin/wicked-crew serve --port=7701
  819 pnpm build
  820 yarn build
  821 node /x/node_modules/vite/bin/vite.js build
  822 bun test
  823 node
  824 npm view wicked-crew version
  825 node /x/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
  826 node /x/node_modules/playwright/driver/package/cli.js run-driver
  827 pytest -n 8
  828 python3 -m pytest -n 8
  829 python3 -m json.tool /tmp/x.json
  830 /usr/bin/python3.12 -m pytest tests/ -q
  831 python3 -m unittest e2e/test_feature_live_selftest.py -v
  832 py.test -q
"""
# Codex round 4's three probes — the positional regex returned no match for any of them.
CODEX_FANOUT_PROBES = ("cargo +stable build", "claude --model opus --print task", "wicked-crew serve --db /tmp/x --port 62432")
# Codex round 5's probes — the round-4 fence required a literal `run` before a build script and knew
# no direct build executable: `pnpm build`, `yarn build` and `node …/vite/bin/vite.js build` all cleared.
CODEX_R5_FANOUT = ("pnpm build", "yarn build", "node /x/node_modules/vite/bin/vite.js build", "bun test")
CODEX_R5_CLEAR = ("node /opt/homebrew/bin/wicked-crew serve --port 7701", "node", "npm view x")


class FanoutGate(Isolated):
    def test_the_rules_match_the_documented_fanout_and_nothing_else(self):
        hits = tfl.fanout_processes(PS_TABLE)
        self.assertEqual([h.split(" ", 1)[0] for h in hits],
                         ["456", "789", "790", "800", "801", "802", "803", "804", "805", "806", "810", "813", "814", "815", "817",
                          "819", "820", "821", "822", "825", "827", "828", "830", "831", "832"])
        self.assertTrue(hits[0].startswith("456 node "), hits[0])          # `pid cmd`
        self.assertTrue(all(len(h) <= 170 for h in hits))                  # command lines are clipped
        # The dogfood daemon (:7701 — `--port 7701` or `--port=7701` — or no port), the harness, the
        # interactive Claude app, `npm run dev`, `npm view …`, an idle `node`, an unrelated `node …
        # --port 62432`, Playwright's own driver, `ps` itself and a Chrome renderer are not fan-out.
        self.assertEqual(tfl.fanout_processes(""), [])
        self.assertEqual(tfl.fanout_processes("  808 wicked-crew serve --port 7701\n  809 wicked-crew serve\n  816 node /x/app.js --port 62432\n"), [])

    def test_codex_round5_build_shorthand_and_direct_executables_block(self):
        """Codex round 5: deterministic probes with `pnpm build` and `yarn build` returned no fan-out
        matches and no preflight blockers (the predicate required a literal `run` token before a
        build script), and `node …/vite/bin/vite.js build` passed too (no direct executable rule).
        Now: package runners match build|test|typecheck|lint|check ANYWHERE among their tokens, and
        direct build/test executables match by basename after the launcher look-through (a
        `.js`/`.mjs`/`.cjs` extension stripped)."""
        for probe in CODEX_R5_FANOUT:
            self.assertIsNotNone(tfl.fanout_rule(probe), probe)
            self.assertEqual(tfl.fanout_processes(f"  1 {probe}\n"), [f"1 {probe}"], probe)
            self.assertEqual(tfl.preflight_ok(reading(swap_pct=50.0, fanout=tfl.fanout_processes(f"  1 {probe}\n")), tfl.preflight_policy({})),
                             [f"fanout: ['1 {probe}']"], probe)   # and the preflight BLOCKS on it
        for clear in CODEX_R5_CLEAR:
            self.assertIsNone(tfl.fanout_rule(clear), clear)
            self.assertEqual(tfl.fanout_processes(f"  1 {clear}\n"), [], clear)
        self.assertEqual(tfl.fanout_rule("pnpm build"), "pnpm build|test|typecheck|lint|check")
        self.assertEqual(tfl.fanout_rule("yarn build"), "yarn build|test|typecheck|lint|check")
        self.assertEqual(tfl.fanout_rule("bun test"), "bun build|test|typecheck|lint|check")           # bun: a launcher that is also a runner
        self.assertEqual(tfl.fanout_rule("bun run build"), "bun build|test|typecheck|lint|check")
        self.assertEqual(tfl.fanout_rule("node /x/node_modules/vite/bin/vite.js build"), "vite (direct build/test executable)")
        # shorthand + scripts, with or without `run`, `:`-qualified scripts included
        for cmd in ("npm build", "npm run build", "npm run build:with-studio", "pnpm run test:unit", "yarn typecheck", "yarn run lint",
                    "pnpm check", "npm run check:types", "npm test -- --watch", "npm run test"):
            self.assertIsNotNone(tfl.fanout_rule(cmd), cmd)
        for cmd in ("npm view x", "npm install", "npm i lint-staged", "npm run dev", "npm run preview", "pnpm install", "yarn --version",
                    "bun", "bun /x/app.js", "bun install"):
            self.assertIsNone(tfl.fanout_rule(cmd), cmd)
        # direct build/test executables, by basename, whatever the arguments — launchers looked through
        for cmd in ("vite build", "node /x/node_modules/vite/bin/vite.js", "tsc --noEmit", "node /x/node_modules/typescript/bin/tsc -p .",
                    "esbuild src/x.ts --bundle", "webpack --mode production", "rollup -c", "vitest run", "node /x/.bin/jest --ci",
                    "npx playwright test", "rustc main.rs", "make -j8", "/usr/bin/make", "ninja -C build", "gradle assemble", "mvn package",
                    "bun x vitest run", "go build ./...", "go test ./..."):
            self.assertIsNotNone(tfl.fanout_rule(cmd), cmd)
        self.assertEqual(tfl.fanout_rule("go test ./..."), "go build|test")
        for cmd in ("go version", "go env GOPATH", "node /x/node_modules/playwright/driver/package/cli.js run-driver",   # Playwright's own driver
                    "vim /tmp/vite", "cat tsc.log", "python3 e2e/test_feature_live.py"):
            self.assertIsNone(tfl.fanout_rule(cmd), cmd)
        self.assertEqual(tfl._prog_name("/x/node_modules/vite/bin/vite.js"), "vite")
        self.assertEqual(tfl._prog_name("/x/.bin/codex"), "codex")
        self.assertEqual(tfl._prog_name("webpack.cjs"), "webpack")
        self.assertEqual(tfl._program(["node", "/x/node_modules/vite/bin/vite.js", "build"]), ("vite", 1))
        self.assertEqual(tfl._program(["bun", "test"]), ("bun", 0))
        self.assertEqual(tfl._program(["bun", "x", "vitest", "run"]), ("vitest", 2))
        self.assertTrue(tfl.BUILD_PROGRAMS <= tfl.KNOWN_PROGRAMS and tfl.PACKAGE_RUNNERS <= tfl.KNOWN_PROGRAMS)
        self.assertEqual(tfl.BUILD_SCRIPT_TOKENS, {"build", "test", "typecheck", "lint", "check"})
        for word in ("pnpm build", "yarn build", "bun test", "vite", "tsc", "esbuild", "webpack", "rollup", "jest", "playwright", "rustc",
                     "make", "ninja", "gradle", "mvn", "go: build|test"):
            self.assertIn(word, tfl.FANOUT_RULES, word)   # the documented rules name them

    def test_codex_round6_pytest_fanouts_block(self):
        """Codex round 6 (MEDIUM): `pytest -n 8` and `python3 -m pytest -n 8` both returned no fan-out
        match — the fence knew no pytest at all, so an active test fan-out left the default fence
        clear. Now: `pytest`/`py.test` by basename (a direct test executable), and any `python*`
        (`python`, `python3`, `python3.12`) whose tokens carry `-m pytest` or `-m unittest` (the
        module right after `-m` is the runner), with or without `-n`; `python3 -m json.tool` and the
        harness itself never match."""
        for probe in ("pytest -n 8", "python3 -m pytest -n 8"):
            self.assertIsNotNone(tfl.fanout_rule(probe), probe)
            self.assertEqual(tfl.fanout_processes(f"  1 {probe}\n"), [f"1 {probe}"], probe)
            self.assertEqual(tfl.preflight_ok(reading(swap_pct=50.0, fanout=tfl.fanout_processes(f"  1 {probe}\n")), tfl.preflight_policy({})),
                             [f"fanout: ['1 {probe}']"], probe)   # and the preflight BLOCKS on it
        self.assertIsNone(tfl.fanout_rule("python3 -m json.tool"))
        self.assertEqual(tfl.fanout_processes("  1 python3 -m json.tool x.json\n"), [])
        self.assertEqual(tfl.fanout_rule("pytest -n 8"), "pytest (direct build/test executable)")
        self.assertEqual(tfl.fanout_rule("pytest"), "pytest (direct build/test executable)")
        self.assertEqual(tfl.fanout_rule("py.test -q tests/"), "py.test (direct build/test executable)")
        self.assertEqual(tfl.fanout_rule("/opt/venv/bin/pytest -x"), "pytest (direct build/test executable)")
        self.assertEqual(tfl.fanout_rule("python3 -m pytest -n 8"), "python -m pytest (module-launched test runner)")
        self.assertEqual(tfl.fanout_rule("python -m pytest"), "python -m pytest (module-launched test runner)")
        self.assertEqual(tfl.fanout_rule("/usr/bin/python3.12 -m pytest tests/ -q"), "python -m pytest (module-launched test runner)")
        self.assertEqual(tfl.fanout_rule("python3 -X dev -m pytest"), "python -m pytest (module-launched test runner)")
        self.assertEqual(tfl.fanout_rule("python3 -m unittest e2e/test_feature_live_selftest.py -v"), "python -m unittest (module-launched test runner)")
        self.assertEqual(tfl.fanout_rule("nice -n 10 python3 -m pytest"), "python -m pytest (module-launched test runner)")
        for clear in ("python3 -m json.tool", "python3 -m venv .venv", "python3 -m http.server", "python3 -m pip install x", 'python3 -c "import pytest"',
                      "python3 e2e/test_feature_live.py", "/usr/bin/python3 e2e/test_feature_live.py", "python3", "node /x/app.js unittest",
                      "vim pytest.ini", "cat /tmp/pytest.log", "unittest"):
            self.assertIsNone(tfl.fanout_rule(clear), clear)
        self.assertEqual(tfl._program(["python3", "-m", "pytest", "-n", "8"]), ("pytest", 2))
        self.assertEqual(tfl._program(["python3.12", "-m", "unittest"]), ("unittest", 2))
        self.assertEqual(tfl._program(["python3", "-m", "json.tool"]), ("python3", 0))
        self.assertTrue(tfl._is_launcher("python3.12") and tfl._is_launcher("python") and tfl._is_launcher("node"))
        self.assertFalse(tfl._is_launcher("pythonic") or tfl._is_launcher("pytest"))
        self.assertTrue({"pytest", "py.test"} <= tfl.BUILD_PROGRAMS)
        self.assertEqual(tfl.PY_TEST_MODULES, {"pytest", "unittest"})
        self.assertTrue(tfl.PY_TEST_MODULES <= tfl.KNOWN_PROGRAMS)
        for word in ("pytest", "py.test", "-m pytest", "-m unittest", "python3 -m json.tool"):
            self.assertIn(word, tfl.FANOUT_RULES, word)   # the documented rules name them

    def test_rules_are_decided_on_tokens_not_argument_order(self):
        """Codex round 4: `fanout_processes()` returned no matches for `cargo +stable build`,
        `claude --model opus --print task` and `wicked-crew serve --db /tmp/x --port 62432` — the
        default was a positional regex. Every rule is now a predicate over the tokenized argv."""
        for probe in CODEX_FANOUT_PROBES:
            self.assertIsNotNone(tfl.fanout_rule(probe), probe)
            self.assertEqual(tfl.fanout_processes(f"  1 {probe}\n"), [f"1 {probe}"], probe)
        self.assertEqual(tfl.fanout_rule("cargo +stable build"), "cargo build|test|clippy|run")
        self.assertEqual(tfl.fanout_rule("claude --model opus --print task"), "claude -p|--print")
        self.assertEqual(tfl.fanout_rule("wicked-crew serve --db /tmp/x --port 62432"), "second wicked-crew serve --port 62432")
        self.assertEqual(tfl.fanout_rule("wicked-crew serve --port=62432"), "second wicked-crew serve --port 62432")   # --port=NNNN
        self.assertEqual(tfl.fanout_rule("node /opt/homebrew/bin/wicked-crew --db x serve --port 62432"), "second wicked-crew serve --port 62432")
        for clear in ("wicked-crew serve", "wicked-crew serve --port 7701", "node /opt/homebrew/bin/wicked-crew serve --port=7701",
                      "node /x/app.js --port 62432", "wicked-crew --port 62432", "/Applications/Claude.app/Contents/MacOS/Claude",
                      "claude", "claude --model opus", "cargo fmt", "cargo metadata --format-version 1", "npm run dev", "npm install",
                      "codex", "codex login", "vim /tmp/cargo", "python3 e2e/test_feature_live.py", "", "   "):
            self.assertIsNone(tfl.fanout_rule(clear), clear)
        # runtime launchers are looked through; `+toolchain` / options / VAR=value never hide the program
        self.assertEqual(tfl.fanout_rule("node /opt/homebrew/lib/node_modules/wicked-crew/node_modules/.bin/codex exec --skip-git-repo-check You"), "codex exec")
        self.assertEqual(tfl.fanout_rule("node /x/node_modules/.bin/vitest run"), "vitest (direct build/test executable)")
        self.assertEqual(tfl.fanout_rule("npx vitest"), "vitest (direct build/test executable)")
        self.assertEqual(tfl.fanout_rule("env RUST_LOG=debug cargo test -p wicked-core"), "cargo build|test|clippy|run")
        self.assertEqual(tfl.fanout_rule("/usr/bin/nice -n 10 cargo clippy --all-targets"), "cargo build|test|clippy|run")
        self.assertEqual(tfl.fanout_rule("cargo +nightly-2026-01-01 run --bin x"), "cargo build|test|clippy|run")
        self.assertEqual(tfl.fanout_rule('claude -p "do a thing" --model opus'), "claude -p|--print")
        self.assertEqual(tfl.fanout_rule("claude --print"), "claude -p|--print")
        self.assertEqual(tfl.fanout_rule("codex --model o3 exec 'x'"), "codex exec")
        self.assertEqual(tfl.fanout_rule("npm test -- --watch"), "npm build|test|typecheck|lint|check")
        self.assertEqual(tfl.fanout_rule("npm run build:with-studio"), "npm build|test|typecheck|lint|check")
        self.assertEqual(tfl.fanout_rule("pnpm run test:unit"), "pnpm build|test|typecheck|lint|check")
        self.assertEqual(tfl.fanout_rule('claude -p "an unbalanced \' quote'), "claude -p|--print")   # shlex fails → whitespace split
        self.assertEqual(tfl._program(["node", "--max-old-space-size=4096", "/x/.bin/vitest", "run"]), ("vitest", 2))
        self.assertEqual(tfl._program(["node"]), ("node", 0))
        self.assertEqual(tfl._program(["node", "/x/app.js", "--port", "62432"]), ("node", 0))   # a launcher running something else
        self.assertEqual(tfl._program(["vim", "/tmp/cargo"]), ("vim", 0))                       # not a launcher: argv[0] is the program
        self.assertEqual(tfl._program(["/usr/bin/nice", "-n", "10", "cargo", "clippy"]), ("cargo", 3))
        self.assertEqual(tfl._program([]), ("", 0))
        self.assertEqual(tfl._port_value(["serve", "--port", "62432"]), "62432")
        self.assertEqual(tfl._port_value(["serve", "--port=62432"]), "62432")
        self.assertEqual(tfl._port_value(["serve", "--port"]), None)
        self.assertEqual(tfl._port_value(["serve"]), None)
        self.assertFalse(hasattr(tfl, "FANOUT_PATTERN_DEFAULT"))   # the positional regex is gone
        self.assertIn("shlex.split", inspect.getsource(tfl._tokens))

    def test_the_extra_pattern_adds_matches_and_an_invalid_regex_refuses(self):
        rx = tfl.fanout_pattern({"FANOUT_PATTERN": r"npm run dev"})
        hits = tfl.fanout_processes(PS_TABLE, rx)
        self.assertIn("807 npm run dev", hits)                                       # the extra pattern ADDS …
        self.assertTrue(set(tfl.fanout_processes(PS_TABLE)) <= set(hits))            # … it never replaces the token rules
        self.assertIsNone(tfl.fanout_pattern({}))
        self.assertIsNone(tfl.fanout_pattern({"FANOUT_PATTERN": "  "}))
        with self.assertRaises(SystemExit) as cm:
            tfl.fanout_pattern({"FANOUT_PATTERN": "("})
        self.assertIn("FANOUT_PATTERN", str(cm.exception))
        p = tfl.preflight_policy({})
        self.assertEqual((p["fanout_max"], p["fanout_pattern"], p["fanout_source"], p["fanout_rules"]), (0, None, "token rules", tfl.FANOUT_RULES))
        p = tfl.preflight_policy({"FANOUT_PATTERN": "foo"})
        self.assertEqual((p["fanout_pattern"], p["fanout_source"]), ("foo", "token rules + FANOUT_PATTERN env (extra matches)"))

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
        self.assertIn("open_artifact_root(self.path.parent, create=True)", src)   # the lock's directory: the trusted descriptor walk
        self.assertIn("os.open(self.path.name, flags, 0o644, dir_fd=dfd)", src)   # the lock file: RELATIVE to that descriptor
        self.assertNotIn("os.open(str(", src)                                      # round 6: no pathname open remains
        self.assertNotIn("mkdir(", src)
        self.assertNotIn("refuse_symlinked_components", src)
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


# ── Item 3 (round 4): the gate policy is an ALLOW-LIST that fails closed ───────────────────────

LT1_PLAN_ROUTES = ("`/runs/:id/{events,acceptance,archive,gate,cancel,guidance,resume,units/:ord/output,elicitation,"
                   "files,diff,inject,deliver}` (client.ts)")
KNOWN = {"stage": "test", "gate": "auto"}
UNKNOWN_UNITS = (None, {}, {"stage": None, "gate": None}, {"stage": "", "gate": " "}, {"ord": 4})


class GateDecision(unittest.TestCase):
    def test_delivery_kind_units_are_rejected_whatever_the_prompt_says(self):
        for kind in ("deliver", "release", "publish", "merge", "Deliver"):
            for unit in ({"stage": kind, "gate": "human"}, {"stage": "test", "gate": kind}):
                decision, reason = tfl.gate_decision("Approve unit 4 before it runs: land the branch", unit)
                self.assertEqual(decision, "reject", (kind, unit))
                self.assertIn("gate kind", reason)
                self.assertIn("never deliver", reason)

    PRE_RECON = ("Approve unit 1 before it runs: Recon: survey the target and propose a test plan — the scenarios, their "
                 "dependencies, and which are deterministic tool checks vs governed agent runs.")
    PRE_NEWTEST = ("Approve unit 1 before it runs: New test: plan the test for the attached scope — the scenarios, their "
                   "dependencies, and which are deterministic tool checks vs governed agent runs — and run the approved "
                   "plan as governed sibling runs under one test.")
    PLAN_CLEAN = ("Approve proposed test plan for wicked-studio before the siblings launch",
                  "Approve the proposed test plan:\n| 1 | WS reconnect/backoff in `useEventStream.ts` | Deterministic |",
                  "Approve test plan for wicked-studio", "Approve plan", "Approve the plan for the attached scope")
    # Plan bodies that NAME a delivery route/verb — legitimate plans, and rejected all the same (c).
    PLAN_WITH_DELIVER = (f"Approve proposed test plan for wicked-studio:\n**REST routes**: `/runs`, `/runs/:id`, {LT1_PLAN_ROUTES}",
                         "Approve proposed test plan:\n| 5 | GET/POST /runs + subresources (archive, gate, cancel, guidance, resume, deliver, inject) | api/client.ts |")
    # Codex round 4's three probes — all `approve` at 5ca59f0.
    CODEX_R4 = (("Approve unit 4 before it runs: gh pr create --fill", KNOWN, "delivery-verb", "'gh pr create'"),
                ("Please push the branch and open a PR", {"stage": "test", "gate": "human"}, "delivery-verb", "'push the branch'"),
                ("Prompt unavailable (daemon restarted). Decide from the run page.", {"stage": "test", "gate": "human"}, "unknown-prompt-shape", "not on the allow-list"))
    CODEX_R3 = "Approve unit 4 before it runs: Push the branch and open a PR"

    def test_codex_round4_probes_reject_and_the_recorded_prompts_approve(self):
        """Offline probes at 5ca59f0 returned `approve` for all three: `gh pr create` was not in the
        verb list, "Please push…" had a known kind and a first clause the imperative regex missed,
        and SteeringGate's `Prompt unavailable` fallback was readable text with a known kind."""
        for p, unit, head, detail in self.CODEX_R4:
            d, r = tfl.gate_decision(p, unit)
            self.assertEqual(d, "reject", (p, r))
            self.assertTrue(r.startswith(head), (p, r))
            self.assertIn(detail, r)
        for p in (self.PRE_RECON, self.PRE_NEWTEST):   # the recorded LT-1/LT-3 and LT-2 intake prompts, unit 1 stage test / gate auto
            d, r = tfl.gate_decision(p, KNOWN)
            self.assertEqual(d, "approve", (p, r))
            self.assertTrue(r.startswith("pre-execution gate 'Approve unit 1 before it runs'"), r)
            self.assertIn("allow-listed shape, known non-delivery kind, no delivery verb anywhere", r)
            self.assertIn("unit stage/gate test/auto", r)

    def test_approve_requires_all_three_conditions(self):
        # (a) shape + (b) known non-delivery kind + (c) no delivery verb → approve
        for p in (*self.PLAN_CLEAN, self.PRE_RECON, self.PRE_NEWTEST):
            for unit in (KNOWN, {"stage": "test", "gate": None}, {"stage": None, "gate": "human"}):   # a partially known unit is known
                d, r = tfl.gate_decision(p, unit)
                self.assertEqual(d, "approve", (p, unit, r))
        self.assertTrue(tfl.gate_decision(self.PLAN_CLEAN[0], KNOWN)[1].startswith("plan-approval gate"))
        # (a) fails: any other shape → unknown-prompt-shape, kind known or not
        for p in ("Amend the plan?", "Approve?", "verify /runs/:id/gate answers 200", "approve unit 1 before it runs: x",   # case matters: crew's exact shape
                  "Please approve unit 1 before it runs: Recon", "Approved plan", "Approve the planned survey", "Prompt unavailable"):
            for unit in (KNOWN, None):
                d, r = tfl.gate_decision(p, unit)
                self.assertEqual(d, "reject", (p, unit))
                self.assertTrue(r.startswith("unknown-prompt-shape"), (p, r))
        # (b) fails: an allow-listed shape with an UNKNOWN kind → unknown-gate-kind (the shape alone no longer approves)
        for p in (self.PRE_RECON, self.PRE_NEWTEST, *self.PLAN_CLEAN):
            for unit in UNKNOWN_UNITS:
                d, r = tfl.gate_decision(p, unit)
                self.assertEqual(d, "reject", (p, unit))
                self.assertTrue(r.startswith("unknown-gate-kind"), r)
                self.assertIn("alone does not authorize", r)
        # (c) fails: a delivery verb anywhere — even in a plan body listing /runs/:id/deliver among the routes to test
        for p in self.PLAN_WITH_DELIVER:
            d, r = tfl.gate_decision(p, KNOWN)
            self.assertEqual(d, "reject", p)
            self.assertTrue(r.startswith("delivery-verb"), r)
            self.assertIn("'deliver'", r)
        self.assertEqual(tfl.gate_shape("Approve unit 12 before it runs: x"), "pre-execution")
        self.assertEqual(tfl.gate_shape("Approve proposed test plan"), "plan-approval")
        self.assertEqual(tfl.gate_shape("Approve the test plan"), "plan-approval")
        self.assertIsNone(tfl.gate_shape("Approve the planned survey"))
        self.assertIsNone(tfl.gate_shape("Approve unit before it runs:"))
        self.assertEqual(tfl.gate_kinds({"stage": " Test", "gate": None}), {"test"})
        self.assertEqual(tfl.gate_kinds({"stage": None, "gate": None}), set())
        self.assertEqual(tfl.gate_kinds(None), set())
        self.assertEqual(tfl.gate_kinds("deliver"), set())  # not a unit dict

    def test_delivery_verbs_and_commands_reject_wherever_they_appear(self):
        """The complete prompt is scanned, whatever the shape or the kind: the brief's extended list
        (`gh pr create`, `git push`, `push the branch`, `open a/the PR / pull request`, merge,
        deliver(y), publish, `npm/cargo publish`, release, `create a release`)."""
        for p in ("Deliver: open a PR against main", "Delivery of the branch to origin", "Push the branch to origin",
                  "Open a PR with the results", "Open PR #12 now", "Merge into main", "Publish the package", "Release 0.5.2",
                  "Approve the delivery of the branch", "Approve deliver: push and open a PR", "approve the merge into main",
                  "Approve unit 4 before it runs: gh pr create --fill", "Approve unit 4 before it runs: run `pr create` when green",
                  "Approve unit 4 before it runs: git push origin HEAD", "Approve unit 4 before it runs: then push branch",
                  "Approve unit 4 before it runs: open the pull request", "Approve unit 4 before it runs: npm publish --access public",
                  "Approve unit 4 before it runs: cargo publish -p wicked-core", "Approve unit 4 before it runs: create a release from the tag",
                  "Approve unit 4 before it runs: create release notes", "Approve proposed test plan, then merge",
                  self.CODEX_R3, "Please push the branch and open a PR"):
            for unit in (KNOWN, {"stage": "test", "gate": "human"}, None):
                d, r = tfl.gate_decision(p, unit)
                self.assertEqual(d, "reject", (p, unit))
                self.assertTrue(r.startswith("delivery-verb"), (p, r))
                self.assertIn("never deliver", r)
        # the pre-execution shape with a delivery verb ANYWHERE — not only in the first clause
        for tail in ("Deliver the report", "survey, then merge into main", "publish the package", "cut release 0.5.2",
                     "open PR #12", "open a pull request", "Open a PR with the results", "and push"):
            d, r = tfl.gate_decision(f"Approve unit 2 before it runs: Recon: {tail}", KNOWN)
            self.assertEqual(d, "reject", tail)
            self.assertTrue(r.startswith("delivery-verb"), r)
        # the reason names the whole command asked for
        self.assertIn("'gh pr create'", tfl.gate_decision("Approve unit 4 before it runs: gh pr create --fill", KNOWN)[1])
        self.assertIn("'push the branch'", tfl.gate_decision("Please push the branch and open a PR", KNOWN)[1])
        self.assertIn("'create a release'", tfl.gate_decision("Approve unit 4 before it runs: create a release", KNOWN)[1])
        rx = tfl.DELIVERY_VERB_RE
        for s in ("gh pr create", "pr create", "git push", "push the branch", "push branch", "open a PR", "open the pull request",
                  "open PR", "pull request", "merge", "deliver", "delivery", "publish", "release", "npm publish", "cargo publish",
                  "create a release", "create release", "Push", "MERGE"):
            self.assertTrue(rx.search(s), s)
        for s in ("proposed", "pushed", "merged", "deliverable", "released", "premerge", "the approved plan", "gate", "unit"):
            self.assertFalse(rx.search(s), s)   # word-bounded: no suffix wildcards — the list is the brief's, exactly
        self.assertFalse(hasattr(tfl, "IMPERATIVE_DELIVER_RE"))   # the first-clause rule is gone; the imperative only names prompts

    def test_unreadable_gate_fails_closed(self):
        for p in ("", None, "   \n"):
            self.assertEqual(tfl.gate_decision(p), ("reject", "unreadable-gate"), repr(p))
            self.assertEqual(tfl.gate_decision(p, None), ("reject", "unreadable-gate"), repr(p))
            self.assertEqual(tfl.gate_decision(p, {"stage": "deliver", "gate": "human"})[0], "reject", repr(p))
            # a KNOWN non-delivery kind never authorizes approving what cannot be read (round 3)
            self.assertEqual(tfl.gate_decision(p, {"stage": "test", "gate": "auto"}), ("reject", "unreadable-gate"), repr(p))
        # SteeringGate's fallback TEXT for a missing prompt is readable — and still not an allow-listed shape (round 4)
        for p in ("Prompt unavailable (daemon restarted)", "Prompt unavailable (daemon restarted). The run is awaiting a decision; open /runs/:id.",
                  "Prompt unavailable"):
            d, r = tfl.gate_decision(p, {"stage": "test", "gate": "human"})
            self.assertEqual(d, "reject", p)
            self.assertTrue(r.startswith("unknown-prompt-shape"), r)

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
        # No ad-hoc prompt test at a call site — the ONE allow-list lives in gate_decision.
        self.assertNotIn('re.match(r"Approve unit \\d+ before it runs", ptxt)', drive)
        self.assertNotIn("PRE_EXECUTION_RE", drive)
        self.assertNotIn("PLAN_APPROVAL_RE", drive)
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
        if self.selector.endswith('[data-testid="steering-prompt"]'):
            if self.page.prompt is None:
                raise RuntimeError("no steering-prompt element")
            return self.page.prompt
        # the card itself — what SteeringGate renders: the status line, `run <id8> · before unit #N`
        # (only when the SPA had a numeric ord), then the headline
        ord_line = f" · before unit #{self.page.card_ord}" if self.page.card_ord is not None else ""
        return f"Awaiting human decision\nrun {self.page.run_id[:8]}{ord_line}\n{self.page.prompt or ''}"

    def get_attribute(self, name: str):
        return (self.page.card_run_id or self.page.run_id) if name == "data-run-id" else None

    def click(self):
        self.page.clicks.append(self.selector)

    def count(self):
        return 0 if self.page.card_missing else 1


class FakePage:
    """`wire_run_id` is the run whose gate the fake SPA actually posts to (default: this run);
    `wire_approve` forces the posted `approve` (None = mirror the button clicked — the honest wire;
    a bool = a UI wire regression the harness must catch). `card_ord` is the ord the card RENDERS
    (`· before unit #N`; None = the SPA had none to show), `card_run_id` its `data-run-id` (None =
    this run)."""

    def __init__(self, prompt, run_id="sib-1", card_missing=False, gate_status=200, wire_run_id=None, wire_approve=None,
                 card_ord=None, card_run_id=None):
        self.prompt, self.run_id, self.card_missing, self.gate_status = prompt, run_id, card_missing, gate_status
        self.wire_run_id, self.wire_approve = wire_run_id or run_id, wire_approve
        self.card_ord, self.card_run_id = card_ord, card_run_id
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


class FakeDaemon:
    """The READ-ONLY daemon the gate path consults for the complete prompt — `GET /runs/:id/gate`
    (the cached open-gate record, `GateInfo`) and `GET /runs/:id/events` — installed over
    `tfl._fetch`, the harness's one HTTP seam, so no test touches the network. A run without a
    record answers 404 (the daemon's "nothing pending"); a `(status, body)` tuple is served as-is."""

    def __init__(self):
        self.gates: dict[str, dict | tuple] = {}
        self.events: dict[str, list | tuple] = {}
        self.calls: list[str] = []

    def fetch(self, path: str):
        self.calls.append(path)
        m = re.fullmatch(r"/runs/([^/]+)/gate", path)
        if m:
            g = self.gates.get(urllib.parse.unquote(m.group(1)))
            return (404, {"error": "no gate"}) if g is None else (g if isinstance(g, tuple) else (200, g))
        m = re.fullmatch(r"/runs/([^/]+)/events", path)
        if m:
            ev = self.events.get(urllib.parse.unquote(m.group(1)))
            return (404, {"error": "no run"}) if ev is None else (ev if isinstance(ev, tuple) else (200, {"events": ev}))
        return 404, {"error": f"unrouted {path}"}


def gate_record(run_id: str, prompt: str, ord_: int | None) -> dict:
    return {"runId": run_id, "ord": ord_, "prompt": prompt, "lifecycle": "open", "receivedAt": "2026-09-09T00:00:00Z"}


# Codex round 5's probe: the card shows `cleanPrompt()`'s headline — everything before the first `[` —
# so the delivery command in the bracket never reaches a decision taken on the card's text.
R5_FULL = "Approve unit 4 before it runs: Finalize the test [gh pr create --fill]"
R5_CARD = "Approve unit 4 before it runs: Finalize the test"


class GateClickPath(Isolated):
    def setUp(self):
        super().setUp()
        self.daemon = FakeDaemon()
        self._saved_fetch = tfl._fetch
        tfl._fetch = self.daemon.fetch

    def tearDown(self):
        tfl._fetch = self._saved_fetch
        super().tearDown()

    def card(self, page):
        return page.locator(f'[data-testid="steering-gate"][data-run-id="{page.run_id}"]')

    def page(self, prompt: str, *, ord_: int | None, card: str | None = None, run_id: str = "sib-1", serve: bool = True,
             card_ord: int | None | str = "mirror", **kw) -> FakePage:
        """A rendered card showing `cleanPrompt(prompt)` (or `card`) whose COMPLETE prompt the fake
        daemon serves from `GET /runs/:id/gate` for `ord_` (unless `serve=False`). The card renders
        `ord_` as its `before unit #N` line (`card_ord="mirror"`), or the given ord / none."""
        if serve:
            self.daemon.gates[run_id] = gate_record(run_id, prompt, ord_)
        return FakePage(tfl.card_headline(prompt) if card is None else card, run_id=run_id,
                        card_ord=ord_ if card_ord == "mirror" else card_ord, **kw)

    def test_deliver_imperative_clicks_reject_and_records_the_unit(self):
        page = self.page("Deliver: open a PR against main", ord_=4)
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

    def test_codex_round5_bracketed_delivery_command_is_rejected_off_the_complete_prompt(self):
        """Codex round 5 (HIGH): for `Approve unit 4 before it runs: Finalize the test [gh pr create
        --fill]` the full-prompt policy rejects, but the headline-driven click path approved with
        `{approve:true}` and `wire_ok:true` — `SteeringGate.cleanPrompt()` strips the bracket. The
        decision now reads the COMPLETE prompt from the daemon (`GET /runs/:id/gate`) and only
        CLICKS on the card."""
        self.assertEqual(tfl.card_headline(R5_FULL), R5_CARD)
        self.assertEqual(tfl.gate_decision(R5_CARD, KNOWN)[0], "approve")   # the card alone WOULD approve — the round-4 hole
        self.assertEqual(tfl.gate_decision(R5_FULL, KNOWN)[0], "reject")
        page = self.page(R5_FULL, ord_=4)
        self.assertEqual(page.prompt, R5_CARD)                              # what the operator sees
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit=KNOWN, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("delivery-verb"), entry["reason"])
        self.assertIn("'gh pr create'", entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])                  # executed through the UI card only
        self.assertEqual(entry["body"], {"approve": False})
        self.assertTrue(entry["wire_ok"])
        self.assertEqual((entry["prompt"], entry["prompt_len"], entry["prompt_card"], entry["card_consistent"]), (R5_FULL, len(R5_FULL), R5_CARD, True))
        self.assertTrue(entry["prompt_source"].startswith("GET /runs/:id/gate"), entry["prompt_source"])
        self.assertEqual(self.daemon.calls, ["/runs/sib-1/gate"])         # read-only, and the events were not needed
        self.assertTrue(any("REJECTED by policy" in f and "gh pr create" in f for f in tfl.REPORT["findings"]))
        # the same prompt as a LATER gate on the parent and as a sibling's gate: same path, same result
        for ord_, unit in ((2, {"stage": "test", "gate": "human"}), (4, {"stage": "build", "gate": "auto"})):
            page = self.page(R5_FULL, ord_=ord_, run_id="sib-7")
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-7", ord_=ord_, unit=unit, tag="T", first=False)
            self.assertEqual((entry["decision"], entry["wire_ok"]), ("reject", True), ord_)

    def test_the_recorded_intake_prompts_approve_on_the_complete_prompt(self):
        for prompt in (GateDecision.PRE_RECON, GateDecision.PRE_NEWTEST):   # the recorded LT-1/LT-3 and LT-2 intake prompts
            page = self.page(prompt, ord_=1, run_id="run-1")
            self.assertEqual(page.prompt, prompt)                          # no bracket: the card shows the whole prompt
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="run-1", ord_=1, unit=KNOWN, tag="LT-1", first=True, card_text=page.prompt)
            self.assertEqual((entry["decision"], entry["first"], entry["wire_ok"], entry["card_consistent"]), ("approve", True, True, True))
            self.assertEqual((entry["prompt"], entry["prompt_card"]), (prompt, prompt))
            self.assertIn('steering-approve"]', page.clicks[0])

    def test_an_unserved_current_prompt_abstains_however_clean_the_card(self):
        """The daemon's CURRENT gate cannot be read — no cached record, no `awaitingHuman` event with
        a prompt — ⇒ a gate-state conflict (`unreadable-gate`): NOTHING is clicked
        (`reject-by-abstention`), even though the card shows an allow-listed headline. Round 6: an
        unreadable gate used to be REJECTED on the card — an irreversible act on a gate the harness
        could not identify; now the run is left as it is and the harness fails."""
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False)      # the card renders; the daemon serves nothing
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject-by-abstention")
        self.assertTrue(entry["reason"].startswith("gate-state-conflict: unreadable-gate"), entry["reason"])
        self.assertEqual(page.clicks, [])                                   # NO click — neither approve nor reject
        self.assertIsNone(entry["prompt"])
        self.assertIsNone(entry["prompt_len"])
        self.assertEqual(entry["prompt_card"], GateDecision.PRE_RECON)      # the card's text IS recorded
        self.assertIsNone(entry["card_consistent"])
        self.assertIn("404", entry["prompt_source"])
        self.assertEqual((entry["status"], entry["url"], entry["body"], entry["wire_ok"]), (None, None, None, None))
        self.assertIn("not clicked", entry["wire_check"])
        self.assertTrue(any("gate-state-conflict" in f and "NO click" in f and "unreadable" in f for f in tfl.REPORT["findings"]))
        # the LATEST awaitingHuman event carries no prompt → unreadable, whatever an OLDER event says
        self.daemon.events["sib-1"] = [{"type": "awaitingHuman", "ord": 1, "prompt": GateDecision.PRE_RECON, "seq": 5},
                                       {"type": "awaitingHuman", "ord": 1, "seq": 6}]
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("(ord 1, seq 6) carries no readable prompt", entry["reason"])
        self.assertIn("never substituted", entry["reason"])
        # a gate record with an EMPTY prompt IS the current gate, unreadable — the readable event is NOT a substitute
        self.daemon.gates["sib-1"] = gate_record("sib-1", "   ", 1)
        self.daemon.events["sib-1"] = [{"type": "awaitingHuman", "ord": 1, "prompt": GateDecision.PRE_RECON, "seq": 5}]
        self.daemon.calls.clear()
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("empty prompt", entry["reason"])
        self.assertEqual(self.daemon.calls, ["/runs/sib-1/gate"])         # the events were not even consulted
        # a FAILED gate GET (not a 404) is a recorded typed miss — the events stand in; none → unreadable → abstain
        self.daemon.gates["sib-1"] = (500, {"error": "boom"})
        del self.daemon.events["sib-1"]
        n = len(tfl.REPORT.get("fetch_errors") or [])
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("→ 500", entry["prompt_source"])
        self.assertEqual(len(tfl.REPORT["fetch_errors"]) - n, 2)           # the gate GET and the events GET (404 on an unknown run)
        self.assertEqual(tfl.REPORT["fetch_errors"][-2]["endpoint"], "/runs/sib-1/gate")
        # the verdict: a harness failure named for what it is — not a wire failure, not "did not post"
        v = tfl.derive_result(recorded_like(gates=[entry], final_status="awaiting_human"), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("gate-state-conflict", v["fail_reasons"])
        self.assertNotIn("a gate decision did not post", v["fail_reasons"])
        self.assertNotIn("gate-wire-mismatch", v["fail_reasons"])

    def test_the_latest_awaitingHuman_event_is_the_current_gate_when_nothing_is_cached(self):
        # no cached record (404) → the LATEST awaitingHuman event: its `prompt` verbatim, its ord the current ord
        self.daemon.events["sib-1"] = [{"type": "awaitingHuman", "ord": 1, "prompt": "stale", "seq": 2},
                                       {"type": "awaitingHuman", "ord": 1, "prompt": GateDecision.PRE_RECON, "seq": 9}]
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], entry["prompt"], entry["card_consistent"], entry["current_ord"]), ("approve", GateDecision.PRE_RECON, True, 1))
        self.assertEqual(entry["prompt_source"], "awaitingHuman event (ord 1, seq 9)")
        self.assertEqual(self.daemon.calls, ["/runs/sib-1/gate", "/runs/sib-1/events"])
        # a cached record for ANOTHER ord is the daemon's CURRENT gate — the ord-1 card is stale: no fallback to the
        # ord-1 event, NO click (round 6; round 5 fell back to the event and approved)
        self.daemon.calls.clear()
        self.daemon.gates["sib-1"] = gate_record("sib-1", R5_FULL, 4)
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("the card shows ord 1 but the daemon's current gate is ord 4", entry["reason"])
        self.assertEqual((entry["ord"], entry["current_ord"], entry["card_ord"]), (1, 4, 1))
        self.assertEqual((entry["prompt"], entry["prompt_card"]), (R5_FULL, GateDecision.PRE_RECON))   # BOTH texts recorded
        self.assertEqual(self.daemon.calls, ["/runs/sib-1/gate"])
        # events handed in by the caller are reused — no second fetch; identity matches → the bracketed prompt rejects, clicked
        self.daemon.calls.clear()
        del self.daemon.gates["sib-1"]
        page = self.page(R5_FULL, ord_=4, serve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit=KNOWN, tag="T", first=False,
                                        events=[{"type": "awaitingHuman", "ord": 4, "prompt": R5_FULL, "seq": 11}])
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("delivery-verb"), entry["reason"])
        self.assertEqual(entry["prompt_source"], "awaitingHuman event (ord 4, seq 11)")
        self.assertEqual(self.daemon.calls, ["/runs/sib-1/gate"])
        self.assertIn('steering-reject"]', page.clicks[0])
        # the pure helpers
        self.assertIsNone(tfl.latest_awaiting_human([]))
        self.assertEqual(tfl.latest_awaiting_human([{"type": "awaitingHuman", "ord": 1, "seq": 1}, {"type": "unitPlanned"},
                                                    {"type": "awaitingHuman", "ord": 3, "seq": 4}])["ord"], 3)
        cur = tfl.current_gate("sib-1", events=[])
        self.assertEqual((cur["readable"], cur["prompt"], cur["ord"], cur["source"]), (False, None, None, None))
        self.assertEqual(cur["why"], "GET /runs/:id/gate → 404 (no cached gate); no awaitingHuman event")
        cur = tfl.current_gate("sib-1", events=[{"type": "awaitingHuman", "ord": 3, "prompt": "p", "seq": 1, "session": "sib-1"}])
        self.assertEqual((cur["readable"], cur["prompt"], cur["ord"], cur["record_run_id"], cur["source"]), (True, "p", 3, "sib-1", "awaitingHuman event (ord 3, seq 1)"))
        self.assertFalse(hasattr(tfl, "full_gate_prompt"))
        self.assertFalse(hasattr(tfl, "gate_prompt_from_events"))   # the per-ord filter and the older-readable-prompt fallback are gone

    def test_codex_round6_stale_card_never_approves_the_daemons_current_delivery_gate(self):
        """Codex round 6 (HIGH): a fake daemon serving a delivery prompt for ord 4 (`GET
        /runs/:id/gate`) alongside an old ord-1 event/card produced `decision=approve`,
        `card_consistent=true`, `wire_ok=true` — the ord-mismatched record was discarded, the ord-1
        event's readable prompt stood in, and the POST (no ord on the wire) would have approved the
        daemon's CURRENT gate: the delivery. Now the card's identity must BE the current gate."""
        delivery = "Approve unit 4 before it runs: Deliver: push the branch and open a PR"
        events = [{"type": "awaitingHuman", "ord": 1, "prompt": GateDecision.PRE_RECON, "seq": 3},
                  {"type": "awaitingHuman", "ord": 4, "prompt": delivery, "seq": 12}]
        self.daemon.gates["sib-1"] = gate_record("sib-1", delivery, 4)
        # (a) the stale ord-1 card — rendered ord 1, and the harness read ord 1 from the events earlier
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=True, card_text=page.prompt, events=events)
        self.assertEqual(entry["decision"], "reject-by-abstention")
        self.assertEqual(page.clicks, [])                                         # NO click — approve OR reject
        self.assertTrue(entry["reason"].startswith("gate-state-conflict:"), entry["reason"])
        self.assertIn("card shows ord 1 but the daemon's current gate is ord 4", entry["reason"])
        self.assertEqual((entry["ord"], entry["card_ord"], entry["current_ord"]), (1, 1, 4))
        self.assertEqual((entry["prompt"], entry["prompt_card"]), (delivery, GateDecision.PRE_RECON))    # both texts, recorded
        self.assertIs(entry["card_consistent"], False)
        self.assertEqual((entry["status"], entry["url"], entry["body"], entry["wire_ok"]), (None, None, None, None))
        self.assertTrue(any("gate-state-conflict" in f and "NO click" in f and "ord 4" in f and "Deliver" in f for f in tfl.REPORT["findings"]))
        v = tfl.derive_result(recorded_like(gates=[entry], final_status="awaiting_human"), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("gate-state-conflict", v["fail_reasons"])
        self.assertTrue(any("daemon current ord=4" in r for r in v["fail_reasons"]), v["fail_reasons"])
        # (b) the card exposes no ord, but the harness read ord 1 from the events → still a conflict
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False, card_ord=None)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False, events=events)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("harness read ord 1 from the events but the daemon's current gate is ord 4", entry["reason"])
        # (c) no ord anywhere: the headline is not cleanPrompt(current) → conflict
        page = self.page(GateDecision.PRE_RECON, ord_=None, serve=False, card_ord=None)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=None, unit=KNOWN, tag="T", first=False, events=events)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("card-prompt-mismatch", entry["reason"])
        # (d) the HONEST ord-4 card: identity matches → decided on the ord-4 prompt → REJECT (delivery verb), clicked, wire verified
        page = self.page(delivery, ord_=4, serve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit={"stage": "test", "gate": "human"}, tag="T", first=False, events=events)
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("delivery-verb"), entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertEqual((entry["current_ord"], entry["card_ord"], entry["card_run_id"], entry["wire_ok"]), (4, 4, "sib-1", True))
        # (e) the record names another run / the card does → conflict
        self.daemon.gates["sib-1"] = gate_record("sib-9", GateDecision.PRE_RECON, 1)
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False, events=events[:1])
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("names run 'sib-9'", entry["reason"])
        self.daemon.gates["sib-1"] = gate_record("sib-1", GateDecision.PRE_RECON, 1)
        page = self.page(GateDecision.PRE_RECON, ord_=1, serve=False, card_run_id="sib-2")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False, events=events[:1])
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("the card is run sib-2's (data-run-id), not sib-1's", entry["reason"])
        # the pure conflict predicate
        cur = {"readable": True, "record_run_id": "r", "ord": 4, "prompt": delivery}
        head = tfl.card_headline(delivery)
        self.assertIsNone(tfl.gate_state_conflict(cur, run_id="r", ord_=4, card_run_id="r", card_ord=4, card_text=head))
        self.assertIsNone(tfl.gate_state_conflict(cur, run_id="r", ord_=None, card_run_id=None, card_ord=None, card_text=head))   # no identity exposed: the headline decides
        self.assertIn("read ord 1", tfl.gate_state_conflict(cur, run_id="r", ord_=1, card_run_id="r", card_ord=4, card_text=head))
        self.assertIn("card shows ord 1", tfl.gate_state_conflict(cur, run_id="r", ord_=4, card_run_id="r", card_ord=1, card_text=head))
        self.assertIn("card-prompt-mismatch", tfl.gate_state_conflict(cur, run_id="r", ord_=4, card_run_id="r", card_ord=4, card_text="Approve unit 4 before it runs: Recon"))
        self.assertIn("unreadable-gate", tfl.gate_state_conflict({"readable": False, "why": "x"}, run_id="r", ord_=4, card_run_id="r", card_ord=4, card_text=""))
        self.assertEqual(tfl.card_ord_from_text("Awaiting human decision\nrun d293f4d7 · before unit #4\nApprove…"), 4)
        self.assertIsNone(tfl.card_ord_from_text("Awaiting human decision\nrun d293f4d7\nApprove…"))
        self.assertIsNone(tfl.card_ord_from_text(None))

    def test_an_unreadable_latest_prompt_never_falls_back_to_an_older_readable_one(self):
        """Codex round 6: `gate_prompt_from_events` skipped an unreadable latest prompt and returned
        an older readable one — the harness then decided a gate it could not read, on text that was
        not its. Now the LATEST event (or the cached record) IS the current gate: unreadable ⇒
        abstain, whatever older events say and whatever the card shows."""
        events = [{"type": "awaitingHuman", "ord": 1, "prompt": GateDecision.PRE_RECON, "seq": 3},
                  {"type": "awaitingHuman", "ord": 4, "seq": 12}]                   # the latest carries no prompt
        for card_ord, ord_ in ((1, 1), (None, None), (4, 4)):
            page = self.page(GateDecision.PRE_RECON, ord_=ord_, serve=False, card_ord=card_ord)
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=ord_, unit=KNOWN, tag="T", first=False, events=events)
            self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []), (card_ord, ord_))
            self.assertIn("unreadable-gate", entry["reason"])
            self.assertIn("(ord 4, seq 12) carries no readable prompt", entry["reason"])
            self.assertIn("never substituted", entry["reason"])
            self.assertIsNone(entry["prompt"])
            self.assertEqual(entry["current_ord"], 4)
        cur = tfl.current_gate("sib-1", events=events)
        self.assertEqual((cur["readable"], cur["prompt"], cur["ord"]), (False, None, 4))
        # the cached record is the current gate even with an empty prompt — the readable event is not consulted
        self.daemon.gates["sib-1"] = gate_record("sib-1", "", 4)
        cur = tfl.current_gate("sib-1", events=[{"type": "awaitingHuman", "ord": 4, "prompt": GateDecision.PRE_RECON, "seq": 12}])
        self.assertEqual((cur["readable"], cur["prompt"], cur["ord"]), (False, None, 4))
        self.assertIn("empty prompt", cur["why"])

    def test_a_card_that_is_not_the_current_prompts_headline_abstains(self):
        """The card is the click surface: when what it shows is not `cleanPrompt(current)` —
        SteeringGate's `Prompt unavailable…` fallback, a stale or truncated headline — the identity is
        in doubt and NOTHING is clicked (`card-prompt-mismatch` → `reject-by-abstention`; round 5
        clicked REJECT, an irreversible act on a gate the operator could not see)."""
        for card in ("Prompt unavailable (daemon restarted) — you can still approve or reject.", GateDecision.PRE_RECON[:40], "", "Approve unit 2 before it runs: Recon: survey"):
            page = self.page(GateDecision.PRE_RECON, ord_=1, card=card)
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
            self.assertEqual(entry["decision"], "reject-by-abstention", card)
            self.assertIn("card-prompt-mismatch", entry["reason"])
            self.assertIs(entry["card_consistent"], False)
            self.assertEqual((entry["prompt"], entry["prompt_card"]), (GateDecision.PRE_RECON, card))   # both texts, recorded
            self.assertEqual(page.clicks, [])
        self.assertTrue(any("card-prompt-mismatch" in f and "NO click" in f for f in tfl.REPORT["findings"]))
        # a bracketed footnote is NOT a mismatch — the card legitimately shows the headline
        page = self.page("Approve unit 1 before it runs: Recon: survey [the gate fires before unit 1]", ord_=1)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], entry["card_consistent"]), ("approve", True))
        self.assertEqual(entry["prompt_card"], "Approve unit 1 before it runs: Recon: survey")
        # whitespace differences (inner_text collapses them) are not a mismatch either
        page = self.page("Approve unit 1 before it runs:\n  Recon:   survey", ord_=1, card="Approve unit 1 before it runs: Recon: survey")
        self.assertEqual(tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit=KNOWN, tag="T", first=False)["card_consistent"], True)
        # a delivery prompt behind a mismatched card: the identity is in doubt — NOTHING is clicked, not even reject
        page = self.page(R5_FULL, ord_=4, card="Prompt unavailable")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit=KNOWN, tag="T", first=False)
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIs(entry["card_consistent"], False)
        self.assertEqual(entry["prompt"], R5_FULL)
        # card_headline mirrors SteeringGate.cleanPrompt: text before the first `[`, trimmed
        self.assertEqual(tfl.card_headline("Head [note] tail"), "Head")
        self.assertEqual(tfl.card_headline("  Head  "), "Head")
        self.assertEqual(tfl.card_headline(None), "")

    def test_every_call_site_decides_on_the_daemon_prompt_and_only_clicks_the_card(self):
        src = inspect.getsource(tfl.decide_gate_on_card)
        self.assertLess(src.index("current_gate(run_id, events)"), src.index("gate_state_conflict(cur"))    # the current gate, then its identity …
        self.assertLess(src.index("gate_state_conflict(cur"), src.index("gate_decision(prompt, unit)"))    # … BEFORE the policy …
        self.assertLess(src.index("gate_decision(prompt, unit)"), src.index("steering-{decision}"))        # … BEFORE the click
        self.assertNotIn("gate_decision(card_text", src)
        drive = inspect.getsource(tfl._drive_intake)
        self.assertIn("card_text=prompt, events=events", drive)                # the intake gate
        self.assertIn("card_text=ptxt, events=evs", drive)                     # later gates
        self.assertNotIn("prompt=prompt", drive)
        self.assertNotIn("prompt=ptxt", drive)
        self.assertNotIn("gate_decision(ptxt", drive)                          # no decision on a card text anywhere
        self.assertIn("events=events)", inspect.getsource(tfl.decide_sibling_gate))   # sibling gates
        self.assertNotIn("prompt", inspect.signature(tfl.decide_gate_on_card).parameters)
        self.assertIn("card_text", inspect.signature(tfl.decide_gate_on_card).parameters)

    def test_a_rejected_decision_wired_as_approve_true_is_a_wire_mismatch_and_a_harness_failure(self):
        """The round-2 fixture accepted `{approve: true}` while reporting REJECTED — exactly the UI
        wire regression the check exists to catch. Now it FAILS the check."""
        page = self.page("Deliver: open a PR against main", ord_=4, wire_approve=True)
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
        page = self.page("Approve unit 1 before it runs: Recon: survey", ord_=1, wire_approve=False)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=1, unit={"stage": "test", "gate": "auto"}, tag="T", first=True)
        self.assertEqual((entry["decision"], entry["wire_ok"]), ("approve", False))

    def test_a_post_to_another_runs_gate_is_not_this_gates_evidence(self):
        page = self.page("Approve unit 1 before it runs: Recon: survey", ord_=1, run_id="sib-1", wire_run_id="sib-9")
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
        page = self.page("Approve unit 1 before it runs: Recon: survey", ord_=1, gate_status=409)
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

    def test_plan_approval_clicks_approve_only_without_a_delivery_verb_in_the_body(self):
        page = self.page("Approve proposed test plan for wicked-studio:\n| 1 | WS reconnect/backoff in `useEventStream.ts` | Deterministic |", ord_=2)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=2, unit={"stage": "test", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "approve")
        self.assertIn('steering-approve"]', page.clicks[0])
        # Round 4: a plan body listing /runs/:id/deliver among the routes to test is REJECTED (a
        # recorded finding), never approved on its first clause — (c) scans the complete prompt.
        page = self.page(f"Approve proposed test plan for wicked-studio:\n{LT1_PLAN_ROUTES}", ord_=2)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=2, unit={"stage": "test", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("delivery-verb"), entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertTrue(entry["wire_ok"])
        self.assertTrue(any("REJECTED by policy" in f and "delivery-verb" in f for f in tfl.REPORT["findings"]))

    def test_codex_round4_probes_click_reject_on_the_card(self):
        for prompt, unit in (("Approve unit 4 before it runs: gh pr create --fill", {"stage": "test", "gate": "auto"}),
                             ("Please push the branch and open a PR", {"stage": "test", "gate": "human"}),
                             ("Prompt unavailable (daemon restarted). Decide from the run page.", {"stage": "test", "gate": "human"})):
            page = self.page(prompt, ord_=4)
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit=unit, tag="T", first=False)
            self.assertEqual(entry["decision"], "reject", prompt)
            self.assertIn('steering-reject"]', page.clicks[0])
            self.assertEqual(entry["body"], {"approve": False})
            self.assertTrue(entry["wire_ok"])
        self.assertTrue(any("not an allow-listed shape" in f and "Prompt unavailable" in f for f in tfl.REPORT["findings"]))

    def test_delivery_kind_unit_clicks_reject_even_for_a_benign_prompt(self):
        page = self.page("Approve unit 4 before it runs: land the branch", ord_=4)
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=4, unit={"stage": "deliver", "gate": "human"}, tag="T", first=False)
        self.assertEqual(entry["decision"], "reject")
        self.assertIn("gate kind 'deliver'", entry["reason"])

    def test_unreadable_prompt_without_unit_info_abstains_with_a_finding(self):
        for page in (FakePage(""), FakePage(None)):   # no card text AND nothing served by the daemon
            entry = tfl.decide_gate_on_card(page, self.card(page), run_id="sib-1", ord_=None, unit=None, tag="T", first=False)
            self.assertEqual(entry["decision"], "reject-by-abstention")
            self.assertIn("unreadable-gate", entry["reason"])
            self.assertEqual(page.clicks, [])
        self.assertTrue(any("gate-state-conflict" in f and "unreadable" in f and "NO click" in f for f in tfl.REPORT["findings"]))

    def test_the_intake_gate_uses_the_same_path(self):
        page = self.page("Approve unit 1 before it runs: Recon: survey the target and propose a test plan", ord_=1, run_id="run-1")
        entry = tfl.decide_gate_on_card(page, self.card(page), run_id="run-1", ord_=1, unit={"stage": "test", "gate": "auto"}, tag="LT-1",
                                        first=True, card_text=page.prompt)
        self.assertEqual((entry["decision"], entry["first"]), ("approve", True))


# ── Item 5: sibling gates decided THROUGH THE UI while following ─────────────────────────────


class SiblingGatesThroughTheUI(Isolated):
    def setUp(self):
        super().setUp()
        self._saved_fns = (tfl.run_detail, tfl.run_events, tfl.acceptance_verdict, tfl._fetch)
        self.daemon = FakeDaemon()   # `GET /runs/:id/gate` 404s unless a test serves a record — the events are the fallback
        tfl._fetch = self.daemon.fetch

    def tearDown(self):
        tfl.run_detail, tfl.run_events, tfl.acceptance_verdict, tfl._fetch = self._saved_fns
        super().tearDown()

    def test_decide_sibling_gate_navigates_reads_decides_clicks_and_returns(self):
        tfl.run_events = lambda sid: [{"type": "unitPlanned", "ord": 1}, {"type": "awaitingHuman", "ord": 2, "prompt": "Approve unit 2 before it runs: land the change", "seq": 4}]
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
        self.assertEqual(entry["prompt_source"], "awaitingHuman event (ord 2, seq 4)")   # the events fetched here were reused
        self.assertEqual(self.daemon.calls, ["/runs/sib-1/gate"])                       # one read-only GET, no second events fetch

    def test_sibling_intake_gate_is_approved_on_the_card(self):
        tfl.run_events = lambda sid: [{"type": "awaitingHuman", "ord": 1, "prompt": "Approve unit 1 before it runs: Execute scenario S-3", "seq": 2}]
        tfl.run_detail = lambda sid: {"session": {"status": "awaiting_human"}, "units": [{"ord": 1, "stage": "test", "gate": "human"}]}
        page = FakePage("Approve unit 1 before it runs: Execute scenario S-3", run_id="sib-2")
        entry = tfl.decide_sibling_gate(page, "sib-2", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "approve")
        self.assertEqual(entry["status"], 200)
        self.assertEqual(entry["card_consistent"], True)
        # the sibling's bracketed delivery command (codex round 5), served by the daemon's gate record: reject
        self.daemon.gates["sib-2"] = gate_record("sib-2", R5_FULL, 1)
        page = FakePage(R5_CARD, run_id="sib-2")
        entry = tfl.decide_sibling_gate(page, "sib-2", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("delivery-verb"), entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])

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

    def test_unit_lookup_failure_with_an_unreadable_complete_prompt_fails_closed(self):
        """Events and run detail down, no cached gate record: the CURRENT gate cannot be read → a
        gate-state conflict (`unreadable-gate`): NOTHING is clicked, whatever the card shows (nothing
        here; a clean headline below) — round 6; round 5 clicked REJECT on a gate it could not
        identify."""
        tfl.run_events = self.boom
        tfl.run_detail = self.boom
        page = FakePage("", run_id="sib-4")
        entry = tfl.decide_sibling_gate(page, "sib-4", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "reject-by-abstention")
        self.assertIn("unreadable-gate", entry["reason"])
        self.assertEqual(page.clicks, [])
        self.assertIn("FetchError", entry["unit_lookup_error"])
        self.assertIn("GET /runs/:id/gate → 404", entry["prompt_source"])
        page = FakePage("Approve unit 1 before it runs: Recon: survey", run_id="sib-4")   # a clean card headline changes nothing
        entry = tfl.decide_sibling_gate(page, "sib-4", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertEqual(page.gotos[-1], "http://studio/testing/campaigns")    # and the browser still returns to the panel

    def test_unit_lookup_failure_with_a_delivery_instruction_is_rejected_on_the_verb(self):
        """Codex's round-3 probe, on the real click path: the unit lookup fails (no stage/gate); the
        daemon's cached gate record reads "Approve unit 4 before it runs: Push the branch and open a
        PR" → REJECT — on the delivery verb (the most severe reason), before the unknown kind is
        even considered. Round 5: the card's text is never what is decided — with the gate record
        gone too, the same card is `unreadable-gate` — and round 6: an unreadable current gate is
        not clicked at all (`reject-by-abstention`), not a delivery-verb reject read off the card."""
        tfl.run_events = self.boom
        tfl.run_detail = self.boom
        self.daemon.gates["sib-5"] = gate_record("sib-5", "Approve unit 4 before it runs: Push the branch and open a PR", 4)
        page = FakePage("Approve unit 4 before it runs: Push the branch and open a PR", run_id="sib-5")
        entry = tfl.decide_sibling_gate(page, "sib-5", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("delivery-verb"), entry["reason"])
        self.assertIn("'push the branch'", entry["reason"])
        self.assertIn("unit stage/gate unknown", entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertIsNone(entry["unit"])
        self.assertIsNone(entry["ord"])                                  # the events were down: the harness has no ord of its own …
        self.assertEqual(entry["current_ord"], 4)                        # … the cached record IS the current gate (ord 4) …
        self.assertTrue(entry["prompt_source"].startswith("GET /runs/:id/gate"))   # … and the card's headline is its headline: identity holds
        self.assertIn("FetchError", entry["unit_lookup_error"])
        self.assertTrue(entry["wire_ok"])  # the reject reached THIS run's gate with {approve: false}
        self.assertTrue(any("REJECTED by policy" in f and "delivery-verb" in f for f in tfl.REPORT["findings"]))
        del self.daemon.gates["sib-5"]
        page = FakePage("Approve unit 4 before it runs: Push the branch and open a PR", run_id="sib-5")
        entry = tfl.decide_sibling_gate(page, "sib-5", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual((entry["decision"], page.clicks), ("reject-by-abstention", []))
        self.assertIn("unreadable-gate", entry["reason"])

    def test_unit_lookup_failure_rejects_even_an_allow_listed_prompt(self):
        """Round 4: the pre-execution shape no longer approves on its own — (b) requires a KNOWN
        non-delivery kind, and a failed GET /runs/:id leaves it unknown → `unknown-gate-kind`."""
        tfl.run_events = self.boom
        tfl.run_detail = self.boom
        self.daemon.gates["sib-6"] = gate_record("sib-6", "Approve unit 1 before it runs: Recon: survey the target and propose a test plan", 1)
        page = FakePage("Approve unit 1 before it runs: Recon: survey the target and propose a test plan", run_id="sib-6")
        entry = tfl.decide_sibling_gate(page, "sib-6", tag="LT-2", return_to="http://studio/testing/campaigns")
        self.assertEqual(entry["decision"], "reject")
        self.assertTrue(entry["reason"].startswith("unknown-gate-kind"), entry["reason"])
        self.assertIn('steering-reject"]', page.clicks[0])
        self.assertTrue(entry["wire_ok"])
        self.assertTrue(any("stage/gate is unknown" in f and "REJECTED" in f for f in tfl.REPORT["findings"]))

    def test_a_sibling_gate_left_on_a_conflict_is_never_re_decided_and_fails_the_harness(self):
        """A sibling whose card is not the daemon's current gate is abstained on ONCE — the follow
        never re-navigates to re-decide it (a live SPA would render the same stale card), the
        timeout reports it non-terminal, and `derive_result` names the conflict
        (`sibling-gate-state-conflict`, `harness_ok=false`) — not a wire failure (round 6)."""
        tfl.run_detail = lambda sid: {"session": {"status": "awaiting_human"}}
        tfl.acceptance_verdict = lambda sid: None
        decided: list[str] = []
        abstention = {"ord": 1, "current_ord": 4, "decision": "reject-by-abstention", "status": None, "url": None, "body": None, "wire_ok": None,
                      "reason": "gate-state-conflict: the card shows ord 1 but the daemon's current gate is ord 4"}

        def fake_decide(page, sid, *, tag, return_to):
            decided.append(sid)
            return dict(abstention)
        clock = FakeClock()
        out = tfl.follow_siblings(["s1"], max_s=60, sleep=clock.sleep, page=FakePage("x"), tag="LT-2", decide=fake_decide, clock=clock, poll_s=15)
        self.assertEqual(decided, ["s1"])                                  # abstained exactly once over 5 polls
        self.assertEqual((out["polls"], out["timed_out"]), (5, True))
        self.assertEqual(out["gates"]["s1"][0]["decision"], "reject-by-abstention")
        self.assertEqual(tfl.sibling_gate_wire_failures(out), [])          # no wire was attempted — not a wire failure
        self.assertEqual(tfl.sibling_gate_conflicts(out), ["sibling s1 gate ord=1 (daemon current ord=4): " + abstention["reason"]])
        self.assertEqual(tfl.sibling_gate_conflicts(None), [])
        v = tfl.derive_result(with_siblings("s1", siblings_followed=out), [])
        self.assertFalse(v["harness_ok"])
        self.assertIn("sibling-gate-state-conflict", v["fail_reasons"])
        self.assertNotIn("sibling-gate-wire-mismatch", v["fail_reasons"])
        self.assertTrue(any(r.startswith("sibling s1 did not reach a terminal state") for r in v["fail_reasons"]), v["fail_reasons"])

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

    def test_a_sibling_gate_wire_mismatch_fails_the_harness_and_the_verdict(self):
        """Codex round 4's reproduction: a completed sibling WITH a verdict whose REJECT was wired
        as `{approve: true}` (`wire_ok: false`) returned `{harness_ok: true, result: "pass",
        fail_reasons: []}` — `derive_result` read only the parent's `measured.gates`."""
        bad = {"ord": 2, "first": False, "prompt": "Deliver: open a PR against main", "decision": "reject", "status": 200,
               "url": "/api/v1/runs/s1/gate", "body": {"approve": True}, "wire_ok": False,
               "wire_check": "request body approve=True but the decision 'reject' requires approve=False"}
        followed = {"statuses": {"s1": "completed"}, "all_terminal": True, "acceptance": {"s1": "pass"}, "gates": {"s1": [bad]}}
        m = with_siblings("s1", siblings_followed=followed)
        v = tfl.derive_result(m, [])
        self.assertFalse(v["harness_ok"])
        self.assertEqual(v["result"], "fail")
        self.assertIn("sibling-gate-wire-mismatch", v["fail_reasons"])
        self.assertTrue(any(r.startswith("sibling s1 gate ord=2 reject: request body approve=True") for r in v["fail_reasons"]), v["fail_reasons"])
        self.assertNotIn("gate-wire-mismatch", v["fail_reasons"])  # the PARENT's gate was fine — the reason names the sibling
        # the honest wire for the same reject → pass again (everything else about the sibling is in order)
        good = {**bad, "body": {"approve": False}, "wire_ok": True, "wire_check": "POST /api/v1/runs/s1/gate for this run, body.approve == False, status 200"}
        m = with_siblings("s1", siblings_followed={**followed, "gates": {"s1": [good]}})
        self.assertEqual(tfl.derive_result(m, []), {"harness_ok": True, "result": "pass", "fail_reasons": []})
        # sibling_gate_wire_failures, as a pure function: wire_ok=false; a recorded url that re-checks
        # as another run's gate (even with wire_ok wrongly true); a non-2xx; and NOT an undecided card
        self.assertEqual(tfl.sibling_gate_wire_failures(None), [])
        self.assertEqual(tfl.sibling_gate_wire_failures({"gates": {"s1": [good]}}), [])
        self.assertEqual(tfl.sibling_gate_wire_failures({"gates": {"s1": [{"ord": 1, "decision": "approve", "status": 200}]}}), [])  # fake_decide's minimal entry
        self.assertEqual(tfl.sibling_gate_wire_failures({"gates": {"s1": [{"ord": 1, "decision": None, "status": None, "reason": "no SteeringGate card rendered"}]}}), [])
        other = tfl.sibling_gate_wire_failures({"gates": {"s1": [{**good, "url": "/api/v1/runs/s9/gate"}]}})
        self.assertEqual(len(other), 1)
        self.assertIn("is not /api/v1/runs/s1/gate", other[0])
        self.assertIn("sibling s1 gate ord=2 reject", other[0])
        self.assertEqual(tfl.sibling_gate_wire_failures({"gates": {"s2": [{"ord": 1, "decision": "approve", "status": 409}]}}),
                         ["sibling s2 gate ord=1 approve: status 409 is not 2xx"])
        self.assertEqual(tfl.sibling_gate_wire_failures({"gates": {"s2": [{"ord": 1, "decision": "approve", "status": None}]}}),
                         ["sibling s2 gate ord=1 approve: status None is not 2xx"])
        # two siblings, one bad: harness_ok false, the good one is not named
        m = with_siblings("s1", "s2", siblings_followed={"statuses": {"s1": "completed", "s2": "completed"}, "all_terminal": True,
                                                          "acceptance": {"s1": "pass", "s2": "pass"}, "gates": {"s1": [good], "s2": [{**bad, "url": "/api/v1/runs/s2/gate"}]}})
        v = tfl.derive_result(m, [])
        self.assertFalse(v["harness_ok"])
        self.assertTrue(any(r.startswith("sibling s2 gate") for r in v["fail_reasons"]))
        self.assertFalse(any(r.startswith("sibling s1 gate") for r in v["fail_reasons"]))

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

    def test_unit_output_present_but_not_a_string_is_a_typed_miss_not_absence(self):
        """Copilot on 5ca59f0 (`unit_output`, :349-353): a 2xx `{output: <number|object>}` was
        folded into "absent" (None) — schema drift or corruption masked as a normal no-output case,
        unlike `run_events`/`acceptance`, which record an unexpected 2xx shape as a typed miss."""
        for out, tname in ((7, "int"), ({"a": 1}, "dict"), ([1, 2], "list"), (True, "bool"), (1.5, "float")):
            self.answer(200, {"output": out})
            miss = tfl.unit_output("r", 3)
            self.assertIsInstance(miss, tfl.FetchMiss, repr(out))
            self.assertEqual((miss["endpoint"], miss["status"]), ("/runs/r/units/3/output", 200))
            self.assertIn(f"unexpected output type: {tname}", miss["error"])
        self.assertEqual(len(self.sink), 5)
        self.assertTrue(any("unexpected output type: int" in f for f in tfl.REPORT["findings"]))
        # absent stays absent — and records nothing
        del self.sink[:]
        for body in ({"output": None}, {"output": ""}, {}, None):
            self.answer(200, body)
            self.assertIsNone(tfl.unit_output("r", 3), repr(body))
        self.answer(204, None)
        self.assertIsNone(tfl.unit_output("r", 3))
        self.assertEqual(self.sink, [])
        self.answer(200, {"output": "the plan"})
        self.assertEqual(tfl.unit_output("r", 3), "the plan")
        self.answer(200, "a bare string body")   # not the contract's shape either
        self.assertIsInstance(tfl.unit_output("r", 3), tfl.FetchMiss)
        self.assertIn("unexpected body shape", self.sink[-1]["error"])

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
        # round 6: `✓ verify …` and `PASS verify …` carry a scenario verb — proposed checks, whatever else they say (the verb wins)
        self.assertEqual([r["title"] for r in records], ["✓ verify the gate renders on /runs/:id", "PASS verify /api/v1 routes",
                                                         "verify /ws awaitingHuman opens the gate", "drive a real run end to end on /runs/:id"])
        self.assertEqual(excluded["execution_summary_items"], 2)  # `npm test` → … green (command + tally, no verb); Tests: 12 passed … (a label + a tally)
        self.assertEqual(excluded["execution_section_lines"], 6)  # heading + table (3) + sub-heading + S-9 bullet
        plan = tfl.analyze_plan(text, FAKE_INDEX)
        self.assertTrue(plan["classifies"])
        self.assertEqual(plan["surfaces"], {"ws_events": True, "api_routes": True, "cli": False, "ui_pages": True})
        self.assertEqual(plan["excluded"], excluded)

    def test_a_proposed_command_is_a_scenario_only_a_result_marker_excludes(self):
        """Codex round 3: a plan-table row proposing "Run npm run typecheck to verify CLI behavior"
        produced zero scenarios because the command alone matched the old regex. A line is a RESULT
        only when it carries a result structure IN A VERB-LESS CELL (round 6 — this fixture used to
        enshrine "verify the CLI exits with exit code 0" as a result, the misclassification codex
        named); a fixture count ("21 failed runs ⇒ …", LT-1 unit 1 row 2) is not a result."""
        table = "\n".join([
            "| # | Scenario | Class |",
            "|---|---|---|",
            "| 1 | Run npm run typecheck to verify CLI behavior | Deterministic |",          # PROPOSED → scenario
            "| 2 | Run `npm test` and `npm run lint` on the CLI | Deterministic |",           # PROPOSED → scenario
            "| 3 | Contradiction guard: 21 failed runs ⇒ calm copy cannot render | Deterministic |",  # fixture count → scenario
            "| 4 | npm test → 237 files / 2442 tests green | Deterministic |",                 # RESULT (command + tally + colour, no verb)
            "| 5 | verify /ws fold: 12 passed, 0 failed | Deterministic |",                     # verb → scenario (round 6; was a RESULT on the count)
            "| 6 | verify the CLI exits with exit code 0 | Deterministic |",                    # verb → scenario (round 6; was a RESULT on the exit code)
            "| 7 | ✓ verify /api/v1/runs answers 200 | Deterministic |",                       # verb → scenario (round 6; was a RESULT on the tick)
            "| 8 | PASS — verify /steering renders | Deterministic |",                          # verb → scenario (round 6; was a RESULT on the verdict word)
            "| 9 | verify the page rendered the required credentials | Deterministic |",        # 'red' inside words is not a marker
            "| 10 | check 2442 passed in 69s on the CLI | Deterministic |",                     # verb → scenario (round 6; was a RESULT on the tally)
            "| 11 | 2442 passed in 69s | Deterministic |",                                      # RESULT (a summary tally, no verb)
        ])
        records, excluded = tfl.scenario_records(table)
        titles = [r["title"] for r in records]
        self.assertEqual(titles, ["Run npm run typecheck to verify CLI behavior", "Run npm test and npm run lint on the CLI",
                                  "Contradiction guard: 21 failed runs ⇒ calm copy cannot render",
                                  "verify /ws fold: 12 passed, 0 failed", "verify the CLI exits with exit code 0",
                                  "✓ verify /api/v1/runs answers 200", "PASS — verify /steering renders",
                                  "verify the page rendered the required credentials", "check 2442 passed in 69s on the CLI"])
        self.assertEqual(excluded, {"execution_section_lines": 0, "execution_summary_items": 2})
        plan = tfl.analyze_plan(table, FAKE_INDEX)
        self.assertTrue(plan["surfaces"]["cli"])  # the proposed typecheck/test/lint checks now count towards LT-4's CLI surface
        self.assertIn("the verb wins", plan["measured_over"])
        self.assertEqual(plan["measured_over"], tfl.MEASURED_OVER)
        for s in ("3 failed", "12 skipped)", "**12 passed**", "12 passed of 14", "FAILED: x", "npm test → red", "exit 1", "✗ x", "✔ x",
                  "Tests: 12 passed, 0 failed", "Test results: 12 passed", "2442 passed in 69s"):
            self.assertIsNotNone(tfl.result_marker(s), s)
        for s in ("21 failed runs", "the passing lane", "a redirect", "greenfield", "npm run typecheck", "npm test", "Tests: run them", "PASSING",
                  "verify the CLI exits with exit code 0", "✓ verify /api/v1/runs answers 200", "PASS — verify /steering renders",
                  "check 2442 passed in 69s"):
            self.assertIsNone(tfl.result_marker(s), s)
        self.assertFalse(hasattr(tfl, "EXEC_SUMMARY_RE"))
        self.assertFalse(hasattr(tfl, "RESULT_MARKER_RE"))   # round 5: a result is a STRUCTURE, not a word match

    def test_codex_round5_expected_outcomes_are_scenarios_only_result_structures_exclude(self):
        """Codex round 5 (MEDIUM): `- S-1 Verify failed /runs cards render red [TOOL]` and `- S-2
        Verify /runs returns a FAIL verdict [AGENT]` both produced zero scenarios — unqualified
        `red`/`green`/verdict-word matching treated an EXPECTED outcome as execution evidence. A
        result now needs a structure (`result_marker`, per cell / bullet body)."""
        plan = "\n".join([
            "- S-1 Verify failed /runs cards render red [TOOL]",
            "- S-2 Verify /runs returns a FAIL verdict [AGENT]",
            "- S-3 Expect `npm test` → green on CI [TOOL]",
            "- S-4 `[TOOL]` `RunsSection` renders red for failed runs",
            "- S-5 should render red when 3 runs failed",
            "- S-6 Verify the CLI prints PASS on a clean tree",
            "- S-7 check that a FAIL verdict marks the campaign red",
            "- `npm test` → 237 files / 2442 tests green",           # a RESULT: command → tally → colour, no verb
            "- Tests: 12 passed, 0 failed for the /ws fold",          # a RESULT: tally in summary position (`Tests:` is a label)
            "- ✓ verify the gate renders on /runs/:id",              # round 6: a scenario verb → a proposed check (was a RESULT on the tick)
            "- PASS verify /api/v1 routes",                           # round 6: a scenario verb → a proposed check (was a RESULT on the verdict word)
            "- verify `npm run typecheck` → PASS",                    # round 6: the verb is outside the command → a proposed check
            "- verify the CLI exits with exit code 0",                # round 6: a scenario verb → a proposed check (was a RESULT on the exit code)
        ])
        records, excluded = tfl.scenario_records(plan)
        self.assertEqual([r["id"] for r in records], ["S-1", "S-2", "S-3", "S-4", "S-5", "S-6", "S-7", None, None, None, None])
        self.assertEqual([r["title"] for r in records][:2], ["Verify failed /runs cards render red", "Verify /runs returns a FAIL verdict"])
        self.assertEqual(excluded, {"execution_section_lines": 0, "execution_summary_items": 2})
        analyzed = tfl.analyze_plan(plan, FAKE_INDEX)
        self.assertEqual(len(analyzed["scenario_lines"]), 11)
        self.assertTrue(analyzed["classifies"])                        # [TOOL] + [AGENT] on the kept scenario rows
        self.assertTrue(analyzed["surfaces"]["api_routes"])            # `/runs` on S-1/S-2 — measured, not discarded
        # the structures, named — in verb-less cells; the words alone, not
        self.assertEqual(tfl.result_marker("Tests: 12 passed, 0 failed"), "count")
        self.assertEqual(tfl.result_marker("✔ x"), "tick")
        self.assertEqual(tfl.result_marker("exit code 0"), "exit-code")
        self.assertEqual(tfl.result_marker("PASS — /steering renders"), "verdict-word")
        self.assertEqual(tfl.result_marker("**FAILED** /steering renders"), "verdict-word")
        self.assertEqual(tfl.result_marker("npm test → FAIL"), "verdict-word")
        self.assertEqual(tfl.result_marker("npm run lint: PASS."), "verdict-word")
        self.assertEqual(tfl.result_marker("`npm test` → 237 files / 2442 tests green"), "colour-verdict")
        self.assertEqual(tfl.result_marker("npm test → red"), "colour-verdict")
        self.assertEqual(tfl.result_marker("cargo test: 42 tests, all green"), "colour-verdict")
        self.assertEqual(tfl.result_marker("lint green in 3.2s"), "colour-verdict")           # a duration is a tally
        for scenario in ("Verify failed /runs cards render red [TOOL]", "S-1 Verify failed /runs cards render red [TOOL]",
                         "Verify /runs returns a FAIL verdict [AGENT]", "Verify the CLI prints PASS", "the FAIL verdict path",
                         "Expect `npm test` → green", "`RunsSection` renders red for failed runs", "should render red when 3 runs failed",
                         "check that a FAIL verdict marks the campaign red", "verify the page rendered the required credentials",
                         "Contradiction guard: 21 failed runs ⇒ calm copy cannot render", "Run npm run typecheck to verify CLI behavior",
                         "assert 3 red cards after `npm run seed`", "green-field module", "PASSING", "passed", "failed",
                         "verify the CLI exits with exit code 0", "✔ verify x", "PASS — verify /steering renders", "**FAILED** verify /steering renders"):
            self.assertIsNone(tfl.result_marker(scenario), scenario)
        # PASS/FAIL are case-sensitive verdict words: "this pass", "may fail" are prose
        for prose in ("not read in depth this pass", "the check may fail on Windows", "pass: verify x", "fail → verify y"):
            self.assertIsNone(tfl.result_marker(prose), prose)
        # table rows are judged per CELL: a Scenario cell with a verb is a proposed check whatever it starts with (round 6);
        # a verb-less cell carrying a verdict word is a result
        rows = ("| # | Scenario | Class |\n|---|---|---|\n| 8 | PASS — verify /steering renders | Deterministic |\n"
                "| 9 | Verify /runs returns a FAIL verdict | Governed agent run |\n| 10 | PASS — /steering renders | Deterministic |\n")
        records, excluded = tfl.scenario_records(rows)
        self.assertEqual([r["title"] for r in records], ["PASS — verify /steering renders", "Verify /runs returns a FAIL verdict"])
        self.assertEqual(excluded["execution_summary_items"], 1)

    def test_codex_round6_expected_outcomes_with_exit_codes_and_ticks_are_scenarios(self):
        """Codex round 6 (MEDIUM): `S-1 Verify CLI returns exit code 1 for invalid input [TOOL]` and
        `S-2 Verify completed UI cards show ✓ [TOOL]` both extracted ZERO scenarios — the exit-code
        and tick structures excluded them regardless of the verb, and the self-test enshrined it
        ("verify the CLI exits with exit code 0" as a RESULT). A structure now excludes only a
        cell/body WITHOUT a scenario verb: the verb wins; a verb-less Result cell still marks a
        results-table row."""
        plan = "\n".join([
            "- S-1 Verify CLI returns exit code 1 for invalid input [TOOL]",
            "- S-2 Verify completed UI cards show ✓ [TOOL]",
            "- S-3 Check `wicked-crew serve --port 0` exits with exit code 2 [TOOL]",
            "- S-4 Expect /runs/:id to show ✔ on completed cards [TOOL]",
            "- S-5 The CLI should exit 0 on `--help` [TOOL]",
            "- S-6 Assert 12 passed, 0 failed after the /ws fold suite [AGENT]",
            # results in a plan TABLE (every row of a Scenario-column table is a candidate) — all verb-less, all excluded
            "| # | Scenario | Class |",
            "|---|---|---|",
            "| 7 | exit code 0 | Deterministic |",                                  # RESULT: no verb
            "| 8 | ✓ /api/v1/runs answered 200 | Deterministic |",                  # RESULT: tick, no verb
            "| 9 | Tests: 12 passed, 0 failed for the /ws fold | Deterministic |",  # RESULT: `Tests:` is a label, the tally is the structure
            "| 10 | Test results: 3 failed | Deterministic |",                      # RESULT: a compound noun, not the verb
            "| 11 | `npm test` → 237 files / 2442 tests green | Deterministic |",   # RESULT: command + tally + colour, no verb
        ])
        records, excluded = tfl.scenario_records(plan)
        self.assertEqual([r["id"] for r in records], ["S-1", "S-2", "S-3", "S-4", "S-5", "S-6"])
        self.assertEqual([r["title"] for r in records][:2], ["Verify CLI returns exit code 1 for invalid input", "Verify completed UI cards show ✓"])
        self.assertEqual(excluded, {"execution_section_lines": 0, "execution_summary_items": 5})
        analyzed = tfl.analyze_plan(plan, FAKE_INDEX)
        self.assertEqual(len(analyzed["scenario_lines"]), 6)
        self.assertTrue(analyzed["classifies"])
        self.assertTrue(analyzed["surfaces"]["cli"] and analyzed["surfaces"]["ui_pages"])
        self.assertIn("the verb wins", analyzed["measured_over"])
        for s in ("Verify CLI returns exit code 1 for invalid input", "Verify completed UI cards show ✓", "verify the CLI exits with exit code 0",
                  "✓ verify /api/v1/runs answers 200", "should exit 1 on a bad flag", "expect ✗ on the failed card", "assert 3 failed after seeding",
                  "check the run page renders PASS", "S-1 Verify CLI returns exit code 1 for invalid input [TOOL]"):
            self.assertIsNone(tfl.result_marker(s), s)
        for s in ("exit code 1", "✓ /runs answered 200", "Tests: 12 passed, 0 failed", "Test results: 3 failed", "test summary: 3 failed",
                  "2442 tests green in 69s", "tested: exit code 0"):
            self.assertIsNotNone(tfl.result_marker(s), s)             # `tested:` is a label too
        # a results table: the Scenario/Check cell carries the verb, the Result cell nothing but a structure → a result
        results_table = "| Check | Result |\n|---|---|\n| verify /ws fold | 12 passed, 0 failed |\n| verify the CLI | exit code 0 |\n"
        records, excluded = tfl.scenario_records(results_table)
        self.assertEqual(records, [])
        self.assertEqual(excluded["execution_summary_items"], 2)
        # the verb regex: `N tests`, `Tests:`, `test results|summary|report` are nouns; test/tests/tested/testing as verbs are verbs
        rx = tfl.RESULT_SCENARIO_VERB_RE
        for noun in ("2442 tests", "Tests: 12 passed", "test results", "Test summary", "test report"):
            self.assertIsNone(rx.search(noun), noun)
        for verb in ("test the CLI", "tests the fold", "tested the page", "testing /runs", "Verify", "should", "expect", "assert", "check"):
            self.assertIsNotNone(rx.search(verb), verb)

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
            for k in ("chars", "canonical_files", "scenario_lines", "scenario_ids", "classifies", "names_real_files", "surfaces", "excluded", "measured_over"):
                self.assertEqual(plan[k], recorded[k], f"{tag}.plan.{k} in report.json is stale")
        self.assertEqual(report["scenarios"]["LT-4"]["measured_over"], tfl.MEASURED_OVER)
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
        re-decided under the round-4 ALLOW-LIST policy (pre-execution shape, unit 1 stage test /
        gate auto, no delivery verb) over the COMPLETE prompt (round 5: `gates[0].prompt` is the
        whole awaitingHuman prompt — 180 / 246 / 180 chars, `prompt_raw_len` — and the card showed
        all of it: no bracket, `card_consistent`): approve, wire verified — agreeing with what was clicked."""
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
            # the COMPLETE prompt: as long as the awaitingHuman event's, identical to the card's text (no bracket to strip)
            self.assertEqual((len(g["prompt"]), g["prompt_len"]), (m["gate"]["prompt_raw_len"], m["gate"]["prompt_raw_len"]), tag)
            self.assertEqual(g["prompt"], m["gate"]["prompt_ui"], tag)
            self.assertEqual((g["prompt_card"], g["card_consistent"]), (tfl.card_headline(g["prompt"]), True), tag)
            self.assertNotIn("[", g["prompt"], tag)
            self.assertTrue(g["prompt_source"].startswith("backfilled"), tag)
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

    def test_every_component_is_opened_no_follow_not_only_the_final_target(self):
        """Codex round 3: containment trusted a symlinked root and checked only the final target.
        Round 6: the check is no longer an `lstat` walk of pathnames but a no-follow open of every
        component RELATIVE to the previous descriptor — the same probes, refused by the kernel."""
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
        root_src = inspect.getsource(tfl.ensure_artifact_root)
        self.assertIn("open_artifact_root(root, base, create=True)", root_src)   # the descriptor walk IS the creation — no pathname mkdir
        self.assertIsNone(re.search(r"^\s*\w[\w.]*\.mkdir\(", root_src, re.M), root_src)   # no CODE line calls a pathname mkdir
        src = inspect.getsource(tfl.artifact_path)
        self.assertIn("open_artifact_root(root, base, create=True)", src)
        self.assertIn("open_dir_nofollow(part, fd, shown)", src)                 # each component RELATIVE to a descriptor
        self.assertIn("follow_symlinks=False", src)                              # the final component: lstat via dir_fd
        self.assertNotIn("mkdir(", src)
        self.assertNotIn("resolve()", src)                                       # round 6: no pathname is resolved any more
        self.assertNotIn("is_symlink()", src)
        self.assertFalse(hasattr(tfl, "refuse_symlinked_components"))            # the pathname lstat walk is gone

    def test_startup_refuses_a_symlinked_artifacts_dir_before_creating_anything(self):
        """Codex round 4: `main()` called `ART.mkdir(parents=True)` before any component walk — with
        `e2e/artifacts -> /elsewhere`, startup created `test-feature-live/` outside the repository
        before a later check rejected it. Now the walk comes first and nothing is created."""
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            repo, elsewhere = d / "repo", d / "elsewhere"
            (repo / "e2e").mkdir(parents=True)
            elsewhere.mkdir()
            (repo / "e2e" / "artifacts").symlink_to(elsewhere)                          # the planted link
            art = repo / "e2e" / "artifacts" / "test-feature-live"
            with self.assertRaises(SystemExit) as cm:
                tfl.ensure_artifact_root(art, base=repo)
            self.assertIn(str(repo / "e2e" / "artifacts"), str(cm.exception))
            self.assertIn("symlink", str(cm.exception))
            self.assertEqual(list(elsewhere.iterdir()), [])                            # NOTHING created through the link
            self.assertFalse(art.exists())
            # the real entry point, with the module's ROOT/ART pointed at this repo: refused before
            # the policy, the testid check or any HTTP — no daemon is contacted
            saved = tfl.ROOT, tfl.ART, tfl.http_json
            tfl.ROOT, tfl.ART = repo, art
            tfl.http_json = lambda *a, **k: (_ for _ in ()).throw(AssertionError("main() must refuse before any HTTP"))
            try:
                with self.assertRaises(SystemExit) as cm:
                    tfl.main()
                self.assertIn("symlink", str(cm.exception))
                self.assertEqual(list(elsewhere.iterdir()), [])
            finally:
                tfl.ROOT, tfl.ART, tfl.http_json = saved
            # a real directory chain is created — and only then
            (repo / "e2e" / "artifacts").unlink()
            self.assertEqual(tfl.ensure_artifact_root(art, base=repo), art)
            self.assertTrue(art.is_dir())
            # a link on the LAST component (the dir itself) is refused too
            (repo / "e2e" / "artifacts" / "linked").symlink_to(elsewhere)
            with self.assertRaises(SystemExit):
                tfl.ensure_artifact_root(repo / "e2e" / "artifacts" / "linked", base=repo)
        src = inspect.getsource(tfl.main)
        self.assertNotIn("ART.mkdir", src)
        self.assertTrue(src.lstrip().startswith("def main() -> None:\n    ensure_artifact_root()"), src[:120])  # the FIRST statement
        self.assertLess(src.index("ensure_artifact_root()"), src.index("_policy()"))
        self.assertLess(src.index("ensure_artifact_root()"), src.index("verify_testids()"))
        self.assertLess(src.index("ensure_artifact_root()"), src.index("http_json("))

    def test_plans_screenshots_and_the_report_go_through_the_one_fd_anchored_writer(self):
        """Codex round 5: `artifact_path()` validated a pathname that `write_text()` and
        `page.screenshot(path=…)` then re-resolved. Every artifact now lands through
        `write_artifact` — screenshots as the bytes Playwright returns when no `path` is given."""
        src = inspect.getsource(tfl._drive_intake)
        self.assertIn('write_artifact(f"{tag}-plan-{safe_name(run_id)}.md",', src)
        self.assertIn('write_artifact(f"{tag}-{name}.png", page.screenshot(full_page=True))', src)
        self.assertNotIn("write_text(", src)
        self.assertNotIn("screenshot(path=", src)
        self.assertNotIn('artifact_path(f"', src)
        self.assertNotIn('ART / f"', src)
        self.assertNotIn("run_id.replace(':', '_')", src)
        self.assertIn("return write_artifact(os.path.relpath(path, root)", inspect.getsource(tfl.write_report))
        w = inspect.getsource(tfl.write_artifact)
        self.assertLess(w.index("open_artifact_root(root, base, create=True)"), w.index("_refuse_symlink_at(name, dfd"))   # the walk, THEN the final-name lstat ON the descriptor …
        self.assertLess(w.index("_refuse_symlink_at(name, dfd"), w.index("_create_exclusive(tmp, dfd"))                   # … THEN the temp file on it
        for needle in ("dir_fd=dfd", "os.fsync(fd)", "os.rename(tmp, name, src_dir_fd=dfd, dst_dir_fd=dfd)", "os.unlink(tmp, dir_fd=dfd)"):
            self.assertIn(needle, w, needle)
        self.assertNotIn("os.replace(", w)
        self.assertNotIn("open(str(", w)
        self.assertNotIn("artifact_path(", w)                                    # nothing is pathname-validated and then re-used
        c = inspect.getsource(tfl._create_exclusive)
        self.assertIn("os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW", c)
        self.assertIn("dir_fd=dfd", c)
        d = inspect.getsource(tfl.open_dir_nofollow)
        self.assertIn("os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW", d)
        self.assertIn("dir_fd=dir_fd", d)
        self.assertNotIn("str(", d)                                              # a relative name on a descriptor, never a pathname
        module = inspect.getsource(tfl)
        self.assertNotIn("tempfile", module)                                     # no path-named temp file anywhere
        self.assertEqual(module.count("os.open(str("), 1)                        # the ONLY pathname open is the trusted anchor's …
        self.assertIn("os.open(str(anchor), os.O_RDONLY | os.O_DIRECTORY)", module)
        self.assertIn("os.mkdir(part, 0o755, dir_fd=fd)", module)               # … and every mkdir is relative to a descriptor
        for m in re.finditer(r"^\s*os\.mkdir\((.*)$", module, re.M):
            self.assertIn("dir_fd=", m.group(1), m.group(0))
        self.assertIsNone(re.search(r"^\s*(?!os\.)[\w.]+\.mkdir\(", module, re.M), "a pathname Path.mkdir remains")
        self.assertFalse(hasattr(tfl, "_open_verified_dir"))                     # the pathname open + fstat/lstat identity check is gone

    def test_symlink_substitution_after_validation_never_redirects_a_write(self):
        """Deterministic TOCTOU: the target / the parent is swapped for a symlink AFTER the check and
        BEFORE the write. A swapped TARGET (planted after the final-name lstat, as the temp file is
        about to be created) is replaced by the fd-anchored rename — the link is never followed, the
        victim untouched; a swapped PARENT (planted as the write's descriptor walk begins) is refused
        by the no-follow relative open with nothing written; a pre-planted TEMP name fails `O_EXCL`."""
        real_walk = tfl.open_artifact_root
        real_create = tfl._create_exclusive
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            root, victim, elsewhere = d / "art", d / "victim.md", d / "elsewhere"
            root.mkdir()
            elsewhere.mkdir()
            victim.write_text("keep")
            # (a) the TARGET becomes a symlink to the victim after the final-name check, as the temp file is created
            def plant_then_create(tmp, dfd, shown, name):
                (root / "LT-9-plan-x.md").symlink_to(victim)
                return real_create(tmp, dfd, shown, name)
            tfl._create_exclusive = plant_then_create
            try:
                out = tfl.write_artifact("LT-9-plan-x.md", "new plan", root)
            finally:
                tfl._create_exclusive = real_create
            self.assertEqual(out, root / "LT-9-plan-x.md")
            self.assertFalse(out.is_symlink())                                  # the link was REPLACED …
            self.assertEqual(out.read_text(), "new plan")
            self.assertEqual(victim.read_text(), "keep")                        # … never written through
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["LT-9-plan-x.md"])   # no temp file left
            # (b) the PARENT directory becomes a symlink to elsewhere as this write's descriptor walk begins
            def swap_parent(root_=None, base=None, *, create=True):
                os.rename(root, d / "art-real")
                root.symlink_to(elsewhere)
                return real_walk(root_, base, create=create)
            tfl.open_artifact_root = swap_parent
            try:
                with self.assertRaises(SystemExit) as cm:
                    tfl.write_artifact("LT-9-02-shot.png", b"\x89PNG", root)
            finally:
                tfl.open_artifact_root = real_walk
            self.assertIn("without following a link", str(cm.exception))
            self.assertIn(str(root), str(cm.exception))
            self.assertEqual(list(elsewhere.iterdir()), [])                     # nothing landed outside
            self.assertEqual(sorted(p.name for p in (d / "art-real").iterdir()), ["LT-9-plan-x.md"])   # nor in the moved original
            root.unlink()
            os.rename(d / "art-real", root)
            # (c) a symlink pre-planted at the TEMP name: O_EXCL | O_NOFOLLOW refuses the create
            saved_hex = tfl.secrets.token_hex
            tfl.secrets.token_hex = lambda n=4: "deadbeef"
            try:
                planted = root / f".report.json.{os.getpid()}.deadbeef.tmp"
                planted.symlink_to(victim)
                with self.assertRaises(SystemExit) as cm:
                    tfl.write_report({"x": 1}, root / "report.json", root)
            finally:
                tfl.secrets.token_hex = saved_hex
            self.assertIn("could not be created exclusively", str(cm.exception))
            self.assertEqual(victim.read_text(), "keep")
            self.assertFalse((root / "report.json").exists())
            self.assertTrue(planted.is_symlink())                               # the planted link was not followed, not unlinked
            planted.unlink()
            # (d) open_artifact_root itself: a link or a file is not a directory, a missing dir is not created
            # when create=False; a real dir yields ITS descriptor
            (d / "dirlink").symlink_to(root)
            for bad in (d / "dirlink", victim, d / "missing"):
                with self.assertRaises(SystemExit, msg=str(bad)):
                    tfl.open_artifact_root(bad, create=False)
            self.assertFalse((d / "missing").exists())
            fd = tfl.open_artifact_root(root)
            try:
                self.assertEqual(os.fstat(fd).st_ino, os.lstat(root).st_ino)
            finally:
                os.close(fd)
            # (e) an artifact is ONE plain file name — never a path, never a dotfile
            for name in ("../escape.md", "sub/x.md", "/etc/passwd", ".hidden", "", ".", ".."):
                with self.assertRaises(SystemExit, msg=name):
                    tfl.write_artifact(name, "x", root)
            with self.assertRaises(SystemExit):
                tfl.write_report({"x": 1}, root / "sub" / "report.json", root)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["LT-9-plan-x.md"])
            # (f) the honest path: bytes and text both land, the file is a regular file, the report re-reads
            self.assertEqual(tfl.write_artifact("LT-9-02-shot.png", b"\x89PNG\r\n", root).read_bytes(), b"\x89PNG\r\n")
            self.assertEqual(json.loads(tfl.write_report({"ok": True}, root / "report.json", root).read_text()), {"ok": True})
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["LT-9-02-shot.png", "LT-9-plan-x.md", "report.json"])

    def test_codex_round6_ancestor_substitution_is_refused_by_the_descriptor_walk(self):
        """Codex round 6 (HIGH): `O_NOFOLLOW` on a pathname open protected only the FINAL directory
        component — replacing `e2e/artifacts` (an ancestor) with a symlink after validation
        redirected both the open and the `lstat` to the same outside directory, the fstat==lstat
        identity check passed and writes escaped; the lock's pathname open had the same hole. Now
        every component is opened RELATIVE to the previous descriptor with `O_NOFOLLOW`: the swapped
        ancestor is refused (ELOOP) at its own step and nothing lands outside — for the artifacts,
        the report and the lock; whether the swap happens between two walks, DURING one, or as a
        missing component is about to be created."""
        import shutil
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            repo, elsewhere = d / "repo", d / "elsewhere"
            repo.mkdir()                                                      # the trusted anchor (the resolved repo root) exists
            art = repo / "e2e" / "artifacts" / "test-feature-live"
            (elsewhere / "test-feature-live").mkdir(parents=True)             # a real target dir: a pathname walk WOULD resolve into it
            outside = elsewhere / "test-feature-live"

            def swap_ancestor():
                os.rename(repo / "e2e" / "artifacts", repo / "e2e" / "artifacts-real")
                (repo / "e2e" / "artifacts").symlink_to(elsewhere)

            def restore():
                (repo / "e2e" / "artifacts").unlink()
                os.rename(repo / "e2e" / "artifacts-real", repo / "e2e" / "artifacts")
            saved = tfl.ROOT, tfl.ART
            tfl.ROOT, tfl.ART = repo, art                                       # the module's view: this repo, this evidence dir
            try:
                self.assertEqual(tfl._anchor(art), repo)
                self.assertEqual(tfl.ensure_artifact_root(), art)               # validated + created honestly …
                tfl.write_artifact("before.md", "ok")
                self.assertEqual((art / "before.md").read_text(), "ok")
                tfl.LaunchLock(art / ".launch.lock").acquire().release()        # … the lock too
                # (a) the ancestor is swapped AFTER that validation and BEFORE the next use
                swap_ancestor()
                try:
                    for what, call in (("artifact", lambda: tfl.write_artifact("LT-1-plan-x.md", "escaped?")),
                                       ("report", lambda: tfl.write_report({"x": 1})),
                                       ("lock", lambda: tfl.LaunchLock(art / ".launch.lock").acquire())):
                        with self.assertRaises(SystemExit, msg=what) as cm:
                            call()
                        self.assertIn(str(repo / "e2e" / "artifacts"), str(cm.exception), what)   # refused AT the swapped component
                        self.assertIn("without following a link", str(cm.exception), what)
                    self.assertEqual(list(outside.iterdir()), [])                                    # NOTHING landed outside
                    original = repo / "e2e" / "artifacts-real" / "test-feature-live"
                    self.assertEqual(sorted(p.name for p in original.iterdir()), [".launch.lock", "before.md"])   # no temp file either
                finally:
                    restore()
                # (b) the ancestor is swapped DURING the walk — after `e2e` was opened, as `artifacts` is about to be
                real_open = tfl.open_dir_nofollow

                def swap_midwalk(name, dir_fd, shown):
                    if name == "artifacts" and not (repo / "e2e" / "artifacts").is_symlink():
                        swap_ancestor()
                    return real_open(name, dir_fd, shown)
                tfl.open_dir_nofollow = swap_midwalk
                try:
                    with self.assertRaises(SystemExit) as cm:
                        tfl.write_artifact("LT-1-plan-y.md", "escaped?")
                    self.assertIn(str(repo / "e2e" / "artifacts"), str(cm.exception))
                    with self.assertRaises(SystemExit):
                        tfl.LaunchLock(art / ".launch.lock").acquire()
                finally:
                    tfl.open_dir_nofollow = real_open
                    restore()
                self.assertEqual(list(outside.iterdir()), [])
                # (c) a link raced in where a MISSING component is about to be created: mkdir → EEXIST, the no-follow re-open → ELOOP
                shutil.rmtree(repo / "e2e" / "artifacts")
                real_mkdir = tfl.os.mkdir

                def plant_then_mkdir(name, mode=0o777, *, dir_fd=None):
                    if name == "artifacts":
                        (repo / "e2e" / "artifacts").symlink_to(elsewhere)
                    return real_mkdir(name, mode, dir_fd=dir_fd)
                tfl.os.mkdir = plant_then_mkdir
                try:
                    with self.assertRaises(SystemExit) as cm:
                        tfl.ensure_artifact_root()
                finally:
                    tfl.os.mkdir = real_mkdir
                self.assertIn(str(repo / "e2e" / "artifacts"), str(cm.exception))
                self.assertEqual(list(outside.iterdir()), [])
                self.assertEqual(list(elsewhere.iterdir()), [outside])              # nothing new created through the link
                # (d) honest again once the link is gone
                (repo / "e2e" / "artifacts").unlink()
                self.assertEqual(tfl.ensure_artifact_root(), art)
                self.assertEqual(tfl.write_artifact("after.md", "ok").read_text(), "ok")
                self.assertEqual(list(outside.iterdir()), [])
            finally:
                tfl.ROOT, tfl.ART = saved

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
            saved = tfl.os.rename
            tfl.os.rename = lambda *_, **__: (_ for _ in ()).throw(OSError("disk full"))
            try:
                with self.assertRaises(OSError):
                    tfl.write_report({"partial": True}, path)
            finally:
                tfl.os.rename = saved
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
        (writer 1's rename then fails); with unique temp names (pid + random) both complete and
        the last rename wins — and every rename is anchored on the verified directory's descriptor."""
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "report.json"
            real_rename = tfl.os.rename
            seen: list[tuple] = []

            def rename_with_a_concurrent_writer(src, dst, **kw):
                seen.append((src, dst, sorted(kw)))
                if len(seen) == 1:
                    tfl.write_report({"writer": 2}, path)  # completes fully while writer 1's temp file exists
                real_rename(src, dst, **kw)
            tfl.os.rename = rename_with_a_concurrent_writer
            try:
                tfl.write_report({"writer": 1}, path)
            finally:
                tfl.os.rename = real_rename
            self.assertEqual(len(seen), 2)
            self.assertNotEqual(seen[0][0], seen[1][0])
            self.assertTrue(all(re.fullmatch(r"\.report\.json\.\d+\.[0-9a-f]{8}\.tmp", s[0]) for s in seen), seen)
            self.assertTrue(all(s[1] == "report.json" and s[2] == ["dst_dir_fd", "src_dir_fd"] for s in seen), seen)   # relative names on dir fds
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


class LaunchPostBody(Isolated):
    """Copilot on 5ca59f0 (`post_body`, :1446): `json.loads(resp.request.post_data or "{}")` raised
    `JSONDecodeError` on an empty / non-JSON body and crashed the scenario unrecorded — the body is
    evidence for the report, so a parse failure is recorded raw and the harness continues."""

    def test_valid_json_object_is_parsed(self):
        self.assertEqual(tfl.parse_post_body('{"problem": "x", "repoRefs": ["wicked-studio"]}', "T"), {"problem": "x", "repoRefs": ["wicked-studio"]})
        self.assertEqual(tfl.parse_post_body(None, "T"), {})
        self.assertEqual(tfl.parse_post_body("", "T"), {})
        self.assertEqual(tfl.parse_post_body(b'{"problem": "bytes"}', "T"), {"problem": "bytes"})
        self.assertEqual(tfl.REPORT["findings"], self._saved["findings"])   # nothing to report

    def test_non_json_body_is_recorded_raw_with_the_parse_error_and_a_finding(self):
        n = len(tfl.REPORT["findings"])
        out = tfl.parse_post_body("problem=x&repoRefs=wicked-studio", "LT-1")
        self.assertEqual(set(out), {"raw", "parse_error"})
        self.assertEqual(out["raw"], "problem=x&repoRefs=wicked-studio")
        self.assertIn("Expecting value", out["parse_error"])
        self.assertEqual(len(tfl.REPORT["findings"]) - n, 1)
        self.assertIn("LT-1: the launch POST body was not JSON", tfl.REPORT["findings"][-1])
        long = "x" * 2000
        self.assertEqual(len(tfl.parse_post_body(long, "T")["raw"]), 500)          # clipped to 500 chars
        self.assertEqual(tfl.parse_post_body('{"a": ', "T")["raw"], '{"a": ')       # truncated JSON
        # a JSON value that is not an object is not the wire contract either — recorded raw, finding
        out = tfl.parse_post_body("[1, 2]", "T")
        self.assertEqual(out["raw"], "[1, 2]")
        self.assertIn("not a JSON object (list)", out["parse_error"])
        json.dumps(out)                                                              # serializes into report.json as-is

    def test_the_launch_uses_the_guarded_parser(self):
        src = inspect.getsource(tfl._drive_intake)
        self.assertIn("post_body = parse_post_body(resp.request.post_data, tag)", src)
        self.assertNotIn('post_body = json.loads(resp.request.post_data or "{}")', src)


if __name__ == "__main__":
    unittest.main()
