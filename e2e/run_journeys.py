#!/usr/bin/env python3
"""
run_journeys.py — run the e2e journeys serially and fail if any of them fails.

Every journey in e2e/*_test.py is a standalone Python Playwright script: it serves the
`dist-sameorigin/` build plus the in-process fixture API (uxfix_fixture.py) and exits 0/1.
Some share default ports, so they run one at a time.

  python3 e2e/run_journeys.py            # the behaviour journeys (the CI set)
  python3 e2e/run_journeys.py --all      # every journey except the LIVE ones
  python3 e2e/run_journeys.py wave1_dark # just the named journeys

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
]

# Journeys that need a live daemon or bridge: a real wicked-crew daemon (seed_surfaces,
# studio_standalone, test_feature_live) or a sibling wicked-interactive checkout
# (interactive_wire_contract). Operator-run only; never part of --all or CI.
LIVE = ["seed_surfaces", "studio_standalone", "test_feature_live", "interactive_wire_contract"]

TIMEOUT_S = 240


def all_journeys() -> list[str]:
    names = sorted(p.name[: -len("_test.py")] for p in E2E.glob("*_test.py"))
    return [n for n in names if n not in LIVE]


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
                           capture_output=True, text=True, timeout=TIMEOUT_S)
        ok, out = r.returncode == 0, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        text = lambda b: b.decode(errors="replace") if isinstance(b, bytes) else (b or "")
        ok, out = False, text(e.stdout) + text(e.stderr) + f"\n[timed out after {TIMEOUT_S}s]"
    return ok, time.monotonic() - start, out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="journey names (without _test.py); default: the behaviour set")
    ap.add_argument("--all", action="store_true", help="every journey except the LIVE ones")
    args = ap.parse_args()

    names = args.names or (all_journeys() if args.all else BEHAVIOUR)
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
