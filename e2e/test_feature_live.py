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
    < 95 %. (`vm_stat` free/available memory is recorded for the report but NOT gated on — macOS
    keeps free pages near zero by design.) Polls every 60 s for up to 20 min; if the gate never
    clears the harness STOPS and reports "preflight never cleared" with the readings.
  * Exactly one governed run in flight at a time; the next launch waits for a terminal/gated state.
  * Never approves a deliver/push/PR/merge gate — any such gate is REJECTED through the UI card.
  * Never registers/modifies/deletes repos or projects; read-only GETs for every assertion.
  * Never kills a wedged run (no events for 10 min while executing) — it is reported.

Usage: python3 e2e/test_feature_live.py            (playwright + chromium must be installed)
Env:   STUDIO_URL (default http://localhost:7701), TARGET_REPO (default wicked-studio),
       ONLY=LT-1,LT-2 (subset), PREFLIGHT_MAX_MIN (default 20), GATE_TIMEOUT_MIN (default 25),
       RUN_TIMEOUT_MIN (default 60), SIBLING_GRACE_S (default 120).
Prints a JSON report to stdout; artifacts land in e2e/artifacts/test-feature-live/.
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


def scrub(text: str) -> str:
    """Worker output and daemon DTOs carry absolute paths under the operator's home — the
    committed artifacts must not (privacy): fold them onto `~`."""
    return text.replace(os.path.expanduser("~"), "~")


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


def readings() -> dict:
    out = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
    pg = int(re.search(r"page size of (\d+)", out).group(1))  # type: ignore[union-attr]

    def pages(k: str) -> int:
        m = re.search(rf"{k}:\s+(\d+)", out)
        return int(m.group(1)) * pg if m else 0

    load = float(subprocess.run(["sysctl", "-n", "vm.loadavg"], capture_output=True, text=True)
                 .stdout.strip("{} \n").split()[0])
    sw = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout
    total = float(re.search(r"total = ([\d.]+)M", sw).group(1))  # type: ignore[union-attr]
    used = float(re.search(r"used = ([\d.]+)M", sw).group(1))  # type: ignore[union-attr]
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


def preflight_ok(r: dict) -> list[str]:
    why = []
    if r["active_runs"]:
        why.append(f"active runs: {r['active_runs']}")
    # No free-memory gate: macOS keeps `Pages free` near zero by design (58 MB–2 GB swings were
    # observed at load 9–14) — `free_mb`/`available_mb` are RECORDED for the report, never gated on.
    if r["load1"] >= 20:
        why.append(f"load1 {r['load1']} >= 20")
    if r["swap_pct"] >= 95:
        why.append(f"swap {r['swap_pct']}% >= 95%")
    return why


def preflight(tag: str) -> bool:
    started = time.time()
    entry = {"scenario": tag, "readings": [], "cleared": False, "waited_s": 0}
    REPORT["preflights"].append(entry)
    while True:
        r = readings()
        why = preflight_ok(r)
        entry["readings"].append({**r, "blocked_by": why})
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


def repo_files() -> tuple[set[str], set[str]]:
    out = subprocess.run(["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True).stdout
    paths = set(out.split())
    return paths, {p.rsplit("/", 1)[-1] for p in paths}


def analyze_plan(text: str) -> dict:
    paths, basenames = repo_files()
    path_hits = set(re.findall(r"(?<![\w/])((?:src|e2e|docs|scripts|public|\.github)/[\w./\-\[\]]+\.(?:tsx?|py|json|md|css|html|ya?ml))", text))
    bare = set(re.findall(r"\b([A-Z][A-Za-z0-9]+\.(?:tsx?))\b", text))
    real_paths = sorted(p for p in path_hits if p in paths)
    real_bare = sorted(b for b in bare if b in basenames)
    fake_paths = sorted(p for p in path_hits if p not in paths)
    low = text.lower()
    id_re = r"\b(?:S|SC|SCN|T|TC|TS|LT|R|D|G)-?\d{1,3}\b"
    scenario_lines = []
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^\|?\s*-{2,}", s):  # markdown table rule
            continue
        is_row = s.startswith("|") and re.search(id_re, s)
        is_item = re.match(r"^(?:[-*•]|\d+[.)]|#{1,4})\s*\S", s) and re.search(rf"{id_re}|scenario|check|verify|assert|should", s, re.I)
        if is_row:
            cells = [c.strip() for c in s.strip("|").split("|")]
            scenario_lines.append(re.sub(r"\s+", " ", " ".join(cells[:2]))[:120])
        elif is_item:
            scenario_lines.append(re.sub(r"\s+", " ", re.sub(r"^(?:[-*•]|\d+[.)]|#{1,4})\s*", "", s))[:120])
    ids = sorted(set(re.findall(id_re, text)))
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
        "nonexistent_paths": fake_paths,
        "names_real_files": len(set(real_paths) | set(real_bare)) >= 3,
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


# ── The UI-driven governed intake ─────────────────────────────────────────────────────────────

DELIVER_RE = re.compile(r"deliver|push|pull request|\bpr\b|merge|publish|release", re.I)


def drive_intake(tag: str, intent: str) -> dict:
    """Runs one governed intake through the studio UI and returns the measurements."""
    from playwright.sync_api import sync_playwright

    verb = "testing-recon-open" if intent == "recon" else "testing-campaign-open"
    m: dict = {"scenario": tag, "intent": intent, "result": "not-run", "measured": {}, "notes": []}
    REPORT["scenarios"][tag] = m
    if not preflight(tag):
        m["result"] = "blocked-preflight"
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
            m["result"] = "fail"
            m["notes"].append(f"launch refused: {resp.status} {answer}")
            shot(page, "03-launch-refused")
            browser.close()
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
            m["result"] = "fail"
            m["notes"].append(f"no gate card appeared within {GATE_TIMEOUT_S // 60} min (status={status})")
            shot(page, "03-no-gate")
            browser.close()
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

        # ── APPROVE through the UI card ─────────────────────────────────────────────────────
        with page.expect_response(lambda r: "/gate" in r.url and r.request.method == "POST", timeout=60000) as gate_resp:
            card.first.locator('[data-testid="steering-approve"]').click()
        gr = gate_resp.value
        m["measured"]["approve"] = {"status": gr.status, "body": json.loads(gr.request.post_data or "{}"), "url": gr.url.replace(BASE, "")}
        t_approve = time.time()
        log(f"{tag}: APPROVED intake gate via the SteeringGate card → POST {gr.url.replace(BASE, '')} {gr.status}")
        if not fallback_run_page:
            try:
                panel.locator('[data-testid="testing-launch-resolved"]').wait_for(timeout=15000)
                m["measured"]["panel_resolved_copy"] = panel.locator('[data-testid="testing-launch-resolved"]').inner_text()
            except Exception:
                m["notes"].append("panel never showed testing-launch-resolved after approve")
        shot(page, "04-after-approve")

        # ── Wait for terminal state; handle any further gates; detect wedges ────────────────
        extra_gates: list[dict] = []
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
                decision = "reject" if DELIVER_RE.search(ptxt) else ("approve" if re.match(r"Approve unit \d+ before it runs", ptxt) else "reject")
                shot(page, f"05-gate-{g.get('ord', 'x')}-{decision}")
                with page.expect_response(lambda r: "/gate" in r.url and r.request.method == "POST", timeout=60000) as gr2:
                    c2.locator(f'[data-testid="steering-{decision}"]').click()
                extra_gates.append({"ord": g.get("ord"), "prompt": ptxt[:200], "decision": decision, "status": gr2.value.status})
                log(f"{tag}: later gate ord={g.get('ord')} → {decision}")
                if decision == "reject":
                    finding(f"{tag}: a later gate ('{ptxt[:80]}…') was REJECTED by policy (never deliver)")
                last_change = time.time()
                continue
            if time.time() - last_change > WEDGE_S:
                wedged = True
                finding(f"{tag}: run {run_id} produced no new events for {WEDGE_S // 60} min while {final_status} — WEDGED (not killed)")
                break
        t_end = time.time()
        m["measured"]["extra_gates"] = extra_gates
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
        plan_text = "\n\n".join(f"## unit {k}\n\n{v}" for k, v in sorted(outputs.items()))
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

        # ── Siblings / campaign / verdicts — immediately and after a grace period ──────────
        def siblings_now() -> dict:
            rs = list_runs()
            new = [r["session"]["id"] for r in rs if r["session"]["id"] not in runs_before and r["session"]["id"] not in run_ids]
            cs = list_campaigns()
            newc = [c for c in cs if c["id"] not in camps_before]
            mine = [c for c in cs if campaign_label and c["id"] == campaign_label]
            return {
                "new_runs": new,
                "new_run_problems": [r["session"]["problem"][:100] for r in rs if r["session"]["id"] in new],
                "new_campaigns": [c["id"] for c in newc],
                "campaign_for_label": [{"id": c["id"], "status": c["status"], "node_status": c.get("node_status"), "attached_runs": c.get("attached_runs")} for c in mine],
                "sibling_acceptance": {sid: (acceptance(sid) or {}).get("acceptance", {}).get("verdict") for sid in new},
            }
        m["measured"]["siblings_at_terminal"] = siblings_now()
        log(f"{tag}: waiting {SIBLING_GRACE_S}s grace for delayed siblings")
        page.wait_for_timeout(SIBLING_GRACE_S * 1000)
        m["measured"]["siblings_after_grace"] = siblings_now()
        sib = m["measured"]["siblings_after_grace"]
        if not sib["new_runs"]:
            finding(f"{tag}: NO sibling runs were launched after the approved {intent} completed (new runs: 0, campaigns for label {campaign_label}: {len(sib['campaign_for_label'])}) — the plan is never executed (crew#473)")

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
    ok = (final_status == "completed" and m["measured"]["plan"].get("names_real_files") and m["measured"]["plan"].get("classifies"))
    m["result"] = "pass" if ok else ("wedged" if wedged else "fail")
    m["notes"].append(
        f"the {intent} produced a plan but launched no sibling runs — the feature's copy promises otherwise"
        if ok and not sib["new_runs"] else ""
    )
    m["notes"] = [n for n in m["notes"] if n]
    return m


# ── LT-3 / LT-4 analysis over the captured plans ──────────────────────────────────────────────


def consistency(a: dict, b: dict) -> dict:
    pa, pb = a.get("measured", {}).get("plan", {}), b.get("measured", {}).get("plan", {})
    fa = set(pa.get("real_files", [])) | set(pa.get("real_basenames", []))
    fb = set(pb.get("real_files", [])) | set(pb.get("real_basenames", []))
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


def main() -> None:
    ART.mkdir(parents=True, exist_ok=True)
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

    a = drive_intake("LT-1", "recon") if "LT-1" in only else None
    b = drive_intake("LT-2", "campaign") if "LT-2" in only else None
    c = drive_intake("LT-3", "recon") if "LT-3" in only else None

    if a and c and a["result"] in ("pass", "fail") and c["result"] in ("pass", "fail") and a["measured"].get("plan") and c["measured"].get("plan"):
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
    out = scrub(json.dumps(REPORT, indent=1, default=str))
    (ART / "report.json").write_text(out)
    print(out)


if __name__ == "__main__":
    main()
