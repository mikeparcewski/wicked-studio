#!/usr/bin/env python3
"""
run_journeys.py — run the e2e journeys serially and fail if any of them fails.

Every journey in e2e/*_test.py is a standalone Python Playwright script: it serves the
`dist-sameorigin/` build plus the in-process fixture API (uxfix_fixture.py) and exits 0/1.
Some share default ports, so they run one at a time.

  python3 e2e/run_journeys.py              # the behaviour journeys (the CI set)
  python3 e2e/run_journeys.py --list desk  # the desk journeys (CI runs them under STUDIO_SKIN=desk)
  python3 e2e/run_journeys.py --list desk --shard 1/2   # the first half of the desk list (CI shards it)
  python3 e2e/run_journeys.py --check-desk # every behaviour journey has a desk counterpart (CI runs it)
  python3 e2e/run_journeys.py --all        # every journey except the LIVE and desk-only ones
  python3 e2e/run_journeys.py wave1_dark   # just the named journeys

The same-origin build is made once up front (unless SKIP_STUDIO_BUILD=1 and it already
exists), then every journey runs with SKIP_STUDIO_BUILD=1. STUDIO_SKIN passes through, so
`STUDIO_SKIN=compact-rail python3 e2e/run_journeys.py` runs the set under the compact-rail skin.
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

# The behaviour journeys: no daemon, network or sibling checkout. CI runs these on every PR.
BEHAVIOUR = [
    "wave1_dark", "wave1_draft", "wave1_raw", "wave1_stall", "wave1_switch", "wave1_tone",
    "wave2_consumers",
    "wave2a_gatecard", "wave2a_peek", "wave2a_safety", "wave2a_undo",
    "wave2b_handover", "wave2b_queue", "wave2b_switch",
    "skin_contract", "needs_shell", "t9_plan_ui", "dogfood_fixes", "wavea_home", "gate_move",
    "waveb_proposals", "agent_1on1", "gate_trust", "wavec_takes", "wavec_runpage", "wavec_home_runs",
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

# The desk journeys (DES-STUDIO-REBUILD-001 §6.2): they run only under STUDIO_SKIN=desk (CI's
# `journeys (desk)` legs). A desk slice adds its journey here and never to BEHAVIOUR, which runs under
# the other skins. S15a (§6.4): the behaviour journeys join this list too — each runs under desk as is,
# or with its desk branch (the journey reads STUDIO_SKIN) — so the desk list is the full behaviour
# proof under the skin that becomes the default. A behaviour journey whose surface the Desk replaced
# names its desk counterpart in DESK_COUNTERPARTS instead; `--check-desk` holds every one to that.
DESK_ONLY: list[str] = ["desk_home", "desk_session", "desk_answer", "desk_look", "desk_watch", "desk_proposal", "editor_conformance", "desk_reel_words", "desk_chat_launch", "desk_composer", "desk_watchtower", "desk_cmdk_routes", "desk_controls", "desk_sheets", "desk_home_paths", "desk_decisions", "desk_page_editor", "desk_doc_editors", "desk_walkthrough", "desk_rules", "desk_checks", "desk_plan_order", "desk_page_acts", "desk_run_state", "desk_gate_moves", "desk_repo_page", "desk_launch", "live_walkthrough_deliver_selftest", "desk_calm", "desk_demo_video", "desk_demo_video_status", "desk_session_live", "desk_everything", "desk_projects", "desk_rail", "desk_signin", "desk_ask_team", "desk_everything_archive", "desk_fit", "desk_settings_honest", "desk_demo_plain", "desk_ask_path", "desk_gate_kinds", "desk_orphaned"]

# Behaviour journeys that do NOT run under desk, each with the DESK journey that proves the same
# behaviour on the Desk's surfaces (Home's bands and count tiles have no Desk form; the Desk says the
# same through its one sentence, its list and its project sentences).
DESK_COUNTERPARTS: dict[str, str] = {
    "wave1_dark": "desk_calm",   # dark when healthy: bands collapsed → "Nothing needs you.", no row
    "wave1_stall": "desk_calm",  # a stalled run is an exception: gamma's card → r1's row
    "wave1_tone": "desk_calm",   # zero is quiet: count tiles' tones → the sentence's highlight + one row
}

DESK: list[str] = DESK_ONLY + [n for n in BEHAVIOUR if n not in DESK_COUNTERPARTS]

LISTS = {"behaviour": BEHAVIOUR, "desk": DESK}

# Journeys that need a live daemon or bridge: a real wicked-crew daemon (seed_surfaces,
# studio_standalone, test_feature_live) or a sibling wicked-interactive checkout
# (interactive_wire_contract). Operator-run only; never part of --all or CI.
LIVE = ["seed_surfaces", "studio_standalone", "test_feature_live", "interactive_wire_contract", "live_walkthrough_deliver", "live_ask_path"]

TIMEOUT_S = 240
# LIVE journeys wait for real model turns: their own budget (seconds) when run through this runner.
TIMEOUTS: dict[str, int] = {"live_ask_path": 900}


def all_journeys() -> list[str]:
    names = sorted(p.name[: -len("_test.py")] for p in E2E.glob("*_test.py"))
    return [n for n in names if n not in LIVE and n not in DESK_ONLY]


def check_desk() -> list[str]:
    """Every behaviour journey runs under desk or names a desk counterpart that is in the desk list."""
    problems = []
    for n in BEHAVIOUR:
        if n in DESK:
            continue
        twin = DESK_COUNTERPARTS.get(n)
        if twin is None:
            problems.append(f"{n}: not in DESK and no DESK_COUNTERPARTS entry")
        elif twin not in DESK_ONLY or not (E2E / f"{twin}_test.py").is_file():
            problems.append(f"{n}: its counterpart {twin} is not a desk journey")
    for n in DESK:
        if not (E2E / f"{n}_test.py").is_file():
            problems.append(f"{n}: listed in DESK but {n}_test.py is missing")
    if len(set(DESK)) != len(DESK):
        problems.append("DESK lists a journey twice")
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
    ap.add_argument("names", nargs="*", help="journey names (without _test.py); default: the behaviour set")
    ap.add_argument("--all", action="store_true", help="every journey except the LIVE and DESK ones")
    ap.add_argument("--list", choices=sorted(LISTS), default="behaviour",
                    help="which named list to run when no names are given (default: behaviour)")
    ap.add_argument("--shard", metavar="K/N", help="run only the K-th of N interleaved slices of the list")
    ap.add_argument("--check-desk", action="store_true",
                    help="exit 1 unless every behaviour journey runs under desk or names a desk counterpart")
    args = ap.parse_args()

    if args.check_desk:
        problems = check_desk()
        for line in problems:
            print(line, file=sys.stderr)
        print(f"desk list: {len(DESK)} journeys ({len(DESK_ONLY)} desk-only, {len(DESK) - len(DESK_ONLY)} behaviour); "
              f"{len(DESK_COUNTERPARTS)} behaviour journeys proven by a desk counterpart")
        return 1 if problems else 0

    if args.list == "desk" and not args.names and not args.all:
        # The desk list only means something under the desk skin.
        if os.environ.setdefault("STUDIO_SKIN", "desk") != "desk":
            print(f"--list desk runs under STUDIO_SKIN=desk, not {os.environ['STUDIO_SKIN']}", file=sys.stderr)
            return 2
    names = args.names or (all_journeys() if args.all else LISTS[args.list])
    if args.shard:
        names = shard(names, args.shard)
    if not names:
        print(f"no journeys in the {args.list} list; nothing to run")
        return 0
    build()

    skin = os.environ.get("STUDIO_SKIN", "studio")
    failed = []
    for name in names:
        ok, secs, out = run(name)
        print(f"{'PASS' if ok else 'FAIL'}  {name}  ({secs:.0f}s, skin={skin})", flush=True)
        if not ok:
            failed.append(name)
            print(out[-20000:], flush=True)

    print(f"\n{len(names) - len(failed)}/{len(names)} journeys passed (skin={skin})")
    if failed:
        print("failed: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
