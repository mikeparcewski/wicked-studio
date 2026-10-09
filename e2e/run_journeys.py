#!/usr/bin/env python3
"""
run_journeys.py — run the e2e journeys serially and fail if any of them fails.

Every journey in e2e/*_test.py is a standalone Python Playwright script: it serves the
`dist-sameorigin/` build plus the in-process fixture API (uxfix_fixture.py) and exits 0/1.
Some share default ports, so they run one at a time.

  python3 e2e/run_journeys.py              # the journeys (the CI set — one list since S18d)
  python3 e2e/run_journeys.py --shard 1/2  # the first half of the list (CI shards it in two)
  python3 e2e/run_journeys.py --check-desk # list integrity: every listed journey exists, none twice (CI runs it)
  python3 e2e/run_journeys.py --all        # every journey except the LIVE ones
  python3 e2e/run_journeys.py wave1_dark   # just the named journeys

The same-origin build is made once up front (unless SKIP_STUDIO_BUILD=1 and it already
exists), then every journey runs with SKIP_STUDIO_BUILD=1. There is one shell — the Desk —
since the classic skins retired (S18d), so there is no skin switch.
A failing journey's output is printed in full; its screenshots stay in e2e/shots/.
"""

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

E2E = Path(__file__).resolve().parent
REPO = E2E.parent

# The journeys: no daemon, network or sibling checkout. CI runs these on every PR, in two shards.
# The former behaviour journeys (written for the classic skins, given a desk branch in S15a) and the
# desk journeys are one list since S18d; each runs on the Desk as is.
BEHAVIOUR = [
    "wave1_draft", "wave1_raw",
    "wave2_consumers",
    "wave2a_gatecard", "wave2a_peek", "wave2a_safety", "wave2a_undo",
    "wave2b_handover", "wave2b_queue",
    "needs_shell", "t9_plan_ui", "dogfood_fixes", "wavea_home", "gate_move",
    "waveb_proposals", "agent_1on1", "gate_trust", "wavec_runpage", "wavec_home_runs",
    "standing_orders",
    "capture",
    "main_scroll",
    "escalation_arms",
    "chat_citations",
    "demo_mode",
    "mcp_tools",
    "wicked_theme",
    "tech_details",
    "type_to_composer",
]

# The journeys the Desk slices added (DES-STUDIO-REBUILD-001 §6.2).
DESK_ONLY: list[str] = ["desk_home", "desk_session", "desk_answer", "desk_look", "desk_watch", "desk_proposal", "editor_conformance", "desk_reel_words", "desk_chat_launch", "desk_composer", "desk_watchtower", "desk_cmdk_routes", "desk_controls", "desk_sheets", "desk_home_paths", "desk_decisions", "desk_page_editor", "desk_doc_editors", "desk_walkthrough", "desk_rules", "desk_checks", "desk_plan_order", "desk_page_acts", "desk_run_state", "desk_gate_moves", "desk_repo_page", "desk_launch", "live_walkthrough_deliver_selftest", "desk_calm", "desk_demo_video", "desk_demo_video_status", "desk_session_live", "desk_everything", "desk_projects", "desk_rail", "desk_signin", "desk_ask_team", "desk_everything_archive", "desk_fit", "desk_settings_honest", "desk_demo_plain", "desk_ask_path", "desk_gate_kinds", "desk_orphaned", "desk_every_run", "desk_no_evidence", "desk_ports_pages", "desk_ports_gates", "desk_stranded_deliver", "desk_artifact_address", "desk_artifact_versions", "desk_made_opens", "desk_made_doors", "desk_chat_moves", "desk_project_moves"]

# One list (S18d): the Desk is the only shell. `DESK` keeps its name for CI's count step.
JOURNEYS: list[str] = DESK_ONLY + BEHAVIOUR
DESK = JOURNEYS

LISTS = {"desk": JOURNEYS, "behaviour": JOURNEYS}

# Journeys that need a live daemon or bridge: a real wicked-crew daemon (seed_surfaces,
# studio_standalone, test_feature_live) or a sibling wicked-interactive checkout
# (interactive_wire_contract). Operator-run only; never part of --all or CI.
LIVE = ["seed_surfaces", "studio_standalone", "test_feature_live", "interactive_wire_contract", "live_walkthrough_deliver", "live_ask_path"]

TIMEOUT_S = 240
# LIVE journeys wait for real model turns: their own budget (seconds) when run through this runner.
TIMEOUTS: dict[str, int] = {"live_ask_path": 900}


def all_journeys() -> list[str]:
    names = sorted(p.name[: -len("_test.py")] for p in E2E.glob("*_test.py"))
    return [n for n in names if n not in LIVE]


def check_desk() -> list[str]:
    """List integrity: every listed journey has its script, and none is listed twice."""
    problems = []
    for n in JOURNEYS:
        if not (E2E / f"{n}_test.py").is_file():
            problems.append(f"{n}: listed but {n}_test.py is missing")
    if len(set(JOURNEYS)) != len(JOURNEYS):
        problems.append("a journey is listed twice")
    return problems


def shard(names: list[str], spec: str) -> list[str]:
    """`K/N`: the K-th of N interleaved slices (1-based), so long and short journeys spread evenly."""
    k, n = (int(x) for x in spec.split("/"))
    if not 1 <= k <= n:
        raise SystemExit(f"--shard {spec}: K must be 1..N")
    return names[k - 1::n]


def build() -> None:
    if os.environ.get("SKIP_STUDIO_BUILD") == "1" and (REPO / "dist-sameorigin" / "index.html").is_file():
        return
    npx = shutil.which("npx") or "npx"
    print("building dist-sameorigin/ (VITE_API_HOST empty)", flush=True)
    env = dict(os.environ, VITE_API_HOST="")
    subprocess.run([npx, "vite", "build", "--outDir", "dist-sameorigin", "--emptyOutDir"],
                   cwd=REPO, env=env, check=True)


def run(name: str) -> tuple[bool, float, str]:
    script = E2E / f"{name}_test.py"
    if not script.is_file():
        return False, 0.0, f"{script.name} not found"
    env = dict(os.environ, SKIP_STUDIO_BUILD="1", PYTHONUNBUFFERED="1")
    start = time.monotonic()
    try:
        r = subprocess.run([sys.executable, script.name], cwd=E2E, env=env,
                           capture_output=True, text=True, timeout=TIMEOUTS.get(name, TIMEOUT_S))
        ok, out = r.returncode == 0, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        text = lambda b: b.decode(errors="replace") if isinstance(b, bytes) else (b or "")
        ok, out = False, text(e.stdout) + text(e.stderr) + f"\n[timed out after {TIMEOUTS.get(name, TIMEOUT_S)}s]"
    return ok, time.monotonic() - start, out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="journey names (without _test.py); default: the list")
    ap.add_argument("--all", action="store_true", help="every journey except the LIVE ones")
    ap.add_argument("--list", choices=sorted(LISTS), default="desk",
                    help="kept for CI compatibility: both names are the one list")
    ap.add_argument("--shard", metavar="K/N", help="run only the K-th of N interleaved slices of the list")
    ap.add_argument("--check-desk", action="store_true",
                    help="exit 1 unless every listed journey exists and none is listed twice")
    args = ap.parse_args()

    if args.check_desk:
        problems = check_desk()
        for line in problems:
            print(line, file=sys.stderr)
        print(f"journey list: {len(JOURNEYS)} journeys")
        return 1 if problems else 0

    names = args.names or (all_journeys() if args.all else LISTS[args.list])
    if args.shard:
        names = shard(names, args.shard)
    if not names:
        print(f"no journeys in the {args.list} list; nothing to run")
        return 0
    build()

    failed = []
    for name in names:
        ok, secs, out = run(name)
        print(f"{'PASS' if ok else 'FAIL'}  {name}  ({secs:.0f}s)", flush=True)
        if not ok:
            failed.append(name)
            print(out[-20000:], flush=True)

    print(f"\n{len(names) - len(failed)}/{len(names)} journeys passed")
    if failed:
        print("failed: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
