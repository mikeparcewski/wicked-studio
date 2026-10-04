#!/usr/bin/env python3
"""
live_walkthrough_deliver_selftest_test.py — S13: the LIVE walkthrough + deliver script
(`e2e/live_walkthrough_deliver_test.py`) proven over the in-process fixture's corpus under
STUDIO_SKIN=desk, so the proof lane runs a script whose UI logic CI has already exercised.

Runs the live script as a subprocess, three times, pointed at the fixture's origin:
  1. r-walk-fail   legs inline,failed,fix — "✗ Failed at 0:41", Watch → pane at 0:41 → ⤢ full (the same
                   node, 1440x700) → Esc → Esc; "Ask helpers to fix" → the 'Sent back' note and exactly one
                   more `gateDecided` (allow false, request_changes) in GET /runs/:id/events — the fixture
                   appends it the way crew records a decision; THIS wrapper also reads the fixture's own
                   recorder: exactly one gate POST, a request_changes.
  2. r-walk-pass   legs passed,export — one "checked at 0:30 ▸" chip for the one checked step in
                   GET /runs/:id/acceptance, the chain sentence ("6 of 6 done …" — its exact words are
                   desk_checks' to pin), the chip's pane at 0:30, Export ▾ Video's bytes equal the take's
                   mp4 through the file route.
  3. r-walk-yours  leg deliver — the hand-over card's acceptance line (tone ok), "Are you sure?", Cancel;
                   no decision in the trail and no POST in the recorder; the yes itself capped (the operator's).

Captures ride the live script (e2e/shots/live-walk-*.png). Env: FEEDBACK_PORT (default 4363).
"""

import json
import os
import subprocess
import sys
import urllib.request

from uxfix_fixture import REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4363"))
report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": str(why)}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)


def gate_posts(run: str) -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as r:
        return [p["body"] for p in json.load(r)["posts"] if p["runId"] == run]


def live(run: str, legs: str, **env) -> dict:
    """The live script, pointed at the fixture: 45 s per state change (CI's runner is slow; the fixture itself
    answers at once), the deliver yes never pressed."""
    e = {**os.environ, "STUDIO_URL": origin, "WALK_RUN": run, "WALK_LEGS": legs, "WALK_WAIT_S": "45", "LIVE_APPROVE_DELIVER": "no", **env}
    proc = subprocess.run([sys.executable, str(REPO / "e2e" / "live_walkthrough_deliver_test.py")], env=e, capture_output=True, text=True, timeout=400)
    out = proc.stdout.strip()
    try:
        rep = json.loads(out[out.index("{"):]) if "{" in out else {}
    except json.JSONDecodeError:
        rep = {}
    rep["_exit"] = proc.returncode
    if not rep.get("legs") or proc.returncode != 0:
        rep["_stderr"] = proc.stderr[-2000:]
        if not rep.get("legs"):
            rep["_stdout"] = out[-2000:]
    return rep


set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[],
            acceptance_wt=True, reset_walkthrough=True, reset_gate_posts=True)

# ── 1. the failure: inline, the pane at the moment, full screen, Esc; Ask helpers to fix ──
r1 = live("r-walk-fail", "inline,failed,fix", WALK_RERECORD_S="0")  # the fixture cannot re-record: not followed, said so
legs = r1.get("legs", {})
posts = gate_posts("r-walk-fail")
pane_t = ((legs.get("failed", {}).get("pane") or {}).get("t"))
check("fail-legs", r1.get("ok") is True and legs.get("inline", {}).get("ok") and legs.get("inline", {}).get("state") == "✗ Failed at 0:41"
      and legs.get("failed", {}).get("ok") and not legs.get("failed", {}).get("capped")
      and legs.get("failed", {}).get("failing_sec") == 41 and isinstance(pane_t, (int, float)) and 40.4 <= pane_t <= 45
      and legs.get("failed-moment", {}).get("ok") and not legs.get("failed-moment", {}).get("capped") and legs.get("failed-moment", {}).get("wire_sec") == 41
      and legs.get("failed-underneath", {}).get("ok") and not legs.get("failed-underneath", {}).get("capped")
      and legs.get("failed-underneath", {}).get("wire_failed_checks") == ["One charge event is emitted", "The card is charged once at the provider", "The customer is never charged twice"]
      and legs.get("failed-underneath", {}).get("frame") is True
      and legs.get("failed", {}).get("full", {}).get("same_node") is True and legs.get("failed", {}).get("back") == ["pane", "inline"]
      and legs.get("fix", {}).get("ok") and not legs.get("fix", {}).get("capped")
      and legs.get("fix", {}).get("decisions_before") == 0 and legs.get("fix", {}).get("decisions_after") == 1
      and (legs.get("fix", {}).get("new") or [{}])[0] == {"type": "gateDecided", "ord": 4, "allow": False, "action": "request_changes"}
      and legs.get("fix", {}).get("gate_ord") == 4
      and legs.get("rerecord", {}).get("capped") == "machinery-verified",
      legs=legs, exit=r1.get("_exit"), stderr=r1.get("_stderr"), report={k: v for k, v in r1.items() if k not in ("legs",)})
check("fail-wire", len(posts) == 1 and posts[0].get("approve") is False and (posts[0].get("amend") or posts[0].get("note") or ""),
      posts=posts)

# ── 2. the pass: chips == acceptance's checked steps; the chip's moment; the export's bytes ──
set_fixture(origin, reset_walkthrough=True, reset_gate_posts=True)
r2 = live("r-walk-pass", "passed,export")
legs = r2.get("legs", {})
chip_t = legs.get("checked-link", {}).get("t")
check("pass-legs", r2.get("ok") is True and legs.get("passed", {}).get("ok") and not legs.get("passed", {}).get("capped")
      and legs.get("passed", {}).get("checked_steps") == ["build"] and legs.get("passed", {}).get("sentence") == "6 of 6 done · 1 checked"
      and legs.get("passed", {}).get("chips") == [{"step": "build", "check": "checked", "sec": "30", "text": "checked at 0:30 ▸", "button": True}]
      and legs.get("checked-moment", {}).get("ok") and not legs.get("checked-moment", {}).get("capped") and legs.get("checked-moment", {}).get("moments") == {"build": [30, 48]}
      and legs.get("checked-link", {}).get("ok") and isinstance(chip_t, (int, float)) and 29.4 <= chip_t <= 34
      and legs.get("export", {}).get("ok") and not legs.get("export", {}).get("capped")
      and legs.get("export", {}).get("ui", {}).get("sha256") == legs.get("export", {}).get("take", {}).get("sha256"),
      legs=legs, exit=r2.get("_exit"), stderr=r2.get("_stderr"))

# ── 3. deliver: the acceptance line, "Are you sure?", Cancel sends nothing ──────────────
set_fixture(origin, reset_gate_posts=True)
r3 = live("r-walk-yours", "deliver")
legs = r3.get("legs", {})
check("deliver-legs", r3.get("ok") is True and legs.get("deliver", {}).get("ok") and not legs.get("deliver", {}).get("capped")
      and legs.get("deliver", {}).get("decisions") == 0 and legs.get("deliver-card", {}).get("ok")
      and legs.get("deliver-line", {}).get("ok") and not legs.get("deliver-line", {}).get("capped")
      and (legs.get("deliver-line", {}).get("wire") or {}).get("line") == "Accepted: the checks this run had to pass have passed."
      and (legs.get("deliver", {}).get("acceptance") or {}).get("tone") == "ok"
      and (legs.get("deliver", {}).get("sure") or "").startswith("Are you sure?")
      and legs.get("deliver-yes", {}).get("capped") == "machinery-verified",
      legs=legs, exit=r3.get("_exit"), stderr=r3.get("_stderr"))
check("deliver-wire", gate_posts("r-walk-yours") == [], posts=gate_posts("r-walk-yours"))

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
