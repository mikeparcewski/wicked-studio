#!/usr/bin/env python3
"""
live_walkthrough_deliver_test.py — S13 (DES-STUDIO-REBUILD-001 §9 item 4 "(after S13) open the failing
chapter; Deliver 'Are you sure?'", §11 S13 "second live E2E (§9.4 walkthrough + deliver)";
DES-WALKTHROUGH-PROOF-001 §8 "Live proof through the studio UI", steps 2–7): the walkthrough + deliver
half of the P-B proof, driven through the studio UI against a REAL daemon, with evidence from
independent sources (the daemon's event trail, its acceptance read, the walkthrough view, the bytes).

Operator-run (LIVE): never part of --all or CI. The operator launches the run through the Desk (§9.4
step 1: Ask → Go, a payments change with a walkthrough by a different seat) and hands its id here;
this script follows the run's walkthrough from whatever state it is in — mouse and keyboard only, at
1440x700 — and certifies:

  W1  INLINE   the run's walkthrough sits in the session block, inline: "● Recording · chapter n of m",
               "✗ Failed at m:ss" or "✓ Passed · n chapters"; while it records the line moves without
               a reload (scenes 18/19/21).
  W2  FAILED   what happened underneath; Watch opens the pane with the playhead on the failing moment;
               ⤢ grows the SAME element to full screen; Esc shrinks one step at a time (scenes 19/20).
  W3  FIX      "Ask helpers to fix": exactly one more gate decision in GET /runs/:id/events than before
               the click (a request_changes), none before it; the artifact re-reads; the re-record is
               followed to its verdict (WT §8 step 4).
  W4  PASSED   sealed; the chain's "checked at m:ss ▸" chips agree with GET /runs/:id/acceptance
               (walkthrough.steps[].checkState): as many chips as checked steps; the sentence says
               "N of N done and checked" or "… · k checked"; a chip opens the pane at its moment; the
               word "Followed" is nowhere (scenes 21/22; WT §8 step 5).
  W5  EXPORT   Export ▾ Video downloads through the contained file route; its sha256 equals the stitched
               take GET /runs/:id/walkthrough names (video.mp4): the same bytes (WT §8 step 6).
  W6  DELIVER  the hand-over card carries crew's acceptance line (tone ok); Deliver asks "Are you sure?";
               MUST NOT HAPPEN: no deliver decision in the events before the yes. With
               LIVE_APPROVE_DELIVER=yes the script presses Yes (the operator has pinned the gh identity —
               this script never touches git auth) and expects exactly one approve decision and the run's
               terminal state; otherwise it presses Cancel, verifies nothing was sent, and caps the leg
               "machinery-verified: the yes is the operator's" (WT §8 step 7; §9.4).

Every wait is recorded (what, how long, what was seen). A leg whose evidence the daemon does not serve
(no event trail, no acceptance read) is capped `machinery-verified` and named — never counted as
certified. Report: e2e/artifacts/live-walkthrough-deliver-<utc>.json (also printed) and screenshots
e2e/shots/live-walk-*.png.

Env: STUDIO_URL (default http://localhost:7701 — never :60785 or :4200, the rig and the dev server);
WALK_RUN (required: the run id); WALK_LEGS (comma list of inline,failed,fix,passed,export,deliver;
default all — the self-test runs one corpus run per leg group; `deliver` alone needs no walkthrough on
the run, e.g. a plan whose override left testing to you); WALK_WAIT_S (max seconds per state change,
default 1800); WALK_RERECORD_S (max seconds to follow the re-record after "Ask helpers to fix", default
WALK_WAIT_S; 0 = not followed, capped and said); LIVE_FIX=yes|no (press "Ask helpers to fix" on a failure; default yes);
LIVE_APPROVE_DELIVER=yes|no (default no).

Self-test: e2e/live_walkthrough_deliver_selftest_test.py (DESK) runs this script over the fixture's
corpus — r-walk-fail (W1–W3), r-walk-pass (W4–W5), r-walk-yours (W6 to the Cancel) — the event trail
capped, the fixture's own recorder checked by the wrapper.
"""

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.environ.get("STUDIO_URL", "http://localhost:7701").rstrip("/")
RUN = os.environ.get("WALK_RUN", "")
LEGS = {s.strip() for s in os.environ.get("WALK_LEGS", "inline,failed,fix,passed,export,deliver").split(",") if s.strip()}
WAIT_S = int(os.environ.get("WALK_WAIT_S", "1800"))
# How long to follow the re-record after "Ask helpers to fix" (default: WAIT_S). 0 = not followed, said so
# (the self-test's fixture cannot re-record; the proof lane follows it to its verdict).
RERECORD_S = int(os.environ.get("WALK_RERECORD_S", str(WAIT_S)))
FIX = os.environ.get("LIVE_FIX", "yes") == "yes"
APPROVE = os.environ.get("LIVE_APPROVE_DELIVER", "no") == "yes"
W, H = 1440, 700
HERE = Path(__file__).resolve().parent
SHOTS = HERE / "shots"
ARTIFACTS = HERE / "artifacts"

report: dict = {"ok": False, "base": BASE, "run": RUN, "legs": {}, "waits": [], "capped": [], "started": datetime.now(timezone.utc).isoformat()}


def finish(ok: bool) -> None:
    report["ok"] = ok
    report["ended"] = datetime.now(timezone.utc).isoformat()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    out = ARTIFACTS / f"live-walkthrough-deliver-{report['started'].replace(':', '').replace('+00:00', 'Z')}.json"
    out.write_text(json.dumps(report, indent=2))
    report["report"] = str(out)
    print(json.dumps(report, indent=2))
    sys.exit(0 if ok else 1)


T0 = time.time()


def elapsed() -> float:
    """Seconds since the script started — every leg's entry carries it (where the time went is evidence too)."""
    return round(time.time() - T0, 1)


def fail(leg: str, why, **detail) -> None:
    report["legs"][leg] = {"ok": False, "error": str(why), "at_s": elapsed(), **detail}
    finish(False)


def check(leg: str, ok: bool, **detail) -> None:
    report["legs"][leg] = {"ok": bool(ok), "at_s": elapsed(), **detail}
    if not ok:
        finish(False)


def cap(leg: str, why: str, **detail) -> None:
    """A leg the daemon gave no independent evidence for: machinery-verified, named, never certified."""
    report["legs"][leg] = {"ok": True, "capped": "machinery-verified", "why": why, "at_s": elapsed(), **detail}
    report["capped"].append(f"{leg}: {why}")


if not RUN:
    fail("env", "WALK_RUN names the run (its id) whose walkthrough this script follows")
host = urllib.parse.urlparse(BASE)
if host.port in (60785, 4200):
    fail("env", f"STUDIO_URL {BASE} is the rig or the dev server; the proof runs on its own daemon")


def api(path: str):
    """GET /api/v1<path> → (status, json|None|bytes). A route the daemon lacks is a status, never an exception."""
    url = f"{BASE}/api/v1{path}" if path.startswith("/") else path
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            body = r.read()
            ctype = r.headers.get("content-type", "")
            return r.status, (json.loads(body) if "json" in ctype else body), ctype
    except urllib.error.HTTPError as e:
        return e.code, None, ""
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e), ""


def events() -> list | None:
    st, body, _ = api(f"/runs/{urllib.parse.quote(RUN, safe='')}/events")
    if st != 200 or not isinstance(body, dict) or not isinstance(body.get("events"), list):
        return None
    return body["events"]


def gate_decisions(evs: list | None) -> list:
    """The decisions in the trail: an event whose type names a gate being decided (`gateDecided`, `gate.decided`, …)."""
    if evs is None:
        return []
    out = []
    for e in evs:
        t = str(e.get("type") or e.get("kind") or "").lower()
        if "gate" in t and "decid" in t:
            out.append(e)
    return out


def acceptance() -> dict | None:
    st, body, _ = api(f"/runs/{urllib.parse.quote(RUN, safe='')}/acceptance")
    return body if st == 200 and isinstance(body, dict) else None


def walkthrough_view() -> dict | None:
    st, body, _ = api(f"/runs/{urllib.parse.quote(RUN, safe='')}/walkthrough")
    return body if st == 200 and isinstance(body, dict) else None


def run_status() -> str | None:
    st, body, _ = api(f"/runs/{urllib.parse.quote(RUN, safe='')}")
    if st != 200 or not isinstance(body, dict):
        return None
    s = body.get("session") or body.get("run") or body
    return s.get("status") if isinstance(s, dict) else None


def sha256_of(url: str) -> tuple:
    st, body, ctype = api(url)
    return st, ctype, (hashlib.sha256(body).hexdigest() if isinstance(body, bytes) else None), (len(body) if isinstance(body, bytes) else 0)


def sec_of(label: str) -> float | None:
    """'0:41' → 41.0 from a state line such as '✗ Failed at 0:41'."""
    import re
    m = re.search(r"(\d+):(\d\d)", label or "")
    return None if m is None else int(m.group(1)) * 60 + int(m.group(2))


ART = """() => {
  const block = document.querySelector('[data-testid="session-run"][data-run-id=' + JSON.stringify(window.__walkRun) + ']');
  const a = (block || document).querySelector('[data-testid="artifact"][data-kind="walkthrough"]');
  if (!a) return { present: false, block: !!block };
  const r = a.getBoundingClientRect();
  const q = (id) => a.querySelector(`[data-testid="${id}"]`);
  const txt = (id) => { const e = q(id); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; };
  const v = q('walkthrough-video');
  const verbs = ['walkthrough-watch', 'walkthrough-fix', 'walkthrough-edit-check'].filter((id) => q(id));
  return {
    present: true, block: !!block, size: a.dataset.size, node: a.__sameNode || null, w: Math.round(r.width), h: Math.round(r.height),
    state: txt('walkthrough-state'), seats: txt('walkthrough-seats'), sealed: txt('walkthrough-sealed'), note: txt('walkthrough-note'),
    chapters: [...a.querySelectorAll('[data-testid="walkthrough-chapter"]')].map((c) => ({ key: c.dataset.key, verdict: c.dataset.verdict, current: c.dataset.current })),
    under: [...a.querySelectorAll('[data-testid="walkthrough-underneath"] li')].map((l) => l.innerText.trim()),
    frame: !!q('walkthrough-failed-frame'), verbs,
    video: v ? { t: v.currentTime, ready: v.readyState } : null,
    checks: [...a.querySelectorAll('[data-testid="walkthrough-check"]')].map((c) => ({ kind: c.dataset.kind, passed: c.dataset.passed })),
    exportBtn: !!q('walkthrough-export'),
  };
}"""

CHAIN = """() => {
  const block = document.querySelector('[data-testid="session-run"][data-run-id=' + JSON.stringify(window.__walkRun) + ']');
  if (!block) return null;
  const chips = [...block.querySelectorAll('[data-testid="chain-step-check"]')].map((c) => ({
    step: c.closest('[data-testid="chain-step"]')?.dataset.stepId, check: c.dataset.check, sec: c.dataset.sec ?? null,
    text: c.innerText.replace(/\\s+/g, ' ').trim(), button: c.tagName === 'BUTTON' }));
  const steps = [...block.querySelectorAll('[data-testid="chain-step"]')].map((s) => [s.dataset.stepId, s.dataset.state]);
  const prop = block.querySelector('[data-testid="session-proposal"]');
  const acc = block.querySelector('[data-testid="session-proposal-acceptance"]');
  return {
    chips, steps, sentence: block.querySelector('[data-testid="chain-sentence"]')?.innerText ?? null,
    acceptanceRead: block.dataset.acceptance ?? null,
    proposal: prop ? { kind: prop.dataset.kind, state: prop.dataset.state, text: prop.querySelector('[data-testid="session-proposal-text"]')?.innerText ?? null } : null,
    acceptance: acc ? { tone: acc.dataset.tone, text: acc.innerText } : null,
    followed: /\\bFollowed\\b/.test(document.body.innerText),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""


def wait_for(page, what: str, pred, timeout_s: float, every_s: float = 2.0):
    """Poll the page until `pred(art, chain)` returns a truthy value; every wait is recorded."""
    t0 = time.time()
    last = None
    while time.time() - t0 <= timeout_s:
        art = page.evaluate(ART)
        chain = page.evaluate(CHAIN)
        last = {"art": art.get("state") if isinstance(art, dict) else None, "chain": (chain or {}).get("sentence")}
        got = pred(art, chain)
        if got:
            report["waits"].append({"what": what, "seconds": round(time.time() - t0, 1), "seen": last})
            return got, art, chain
        time.sleep(every_s)
    report["waits"].append({"what": what, "seconds": round(time.time() - t0, 1), "seen": last, "timed_out": True})
    return None, page.evaluate(ART), page.evaluate(CHAIN)


def shot(page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"live-walk-{name}.png"))


def state_kind(state: str | None) -> str | None:
    if not state:
        return None
    if state.startswith("●"):
        return "recording"
    if state.startswith("✗"):
        return "failed"
    if state.startswith("✓"):
        return "passed"
    return "other"


from playwright.sync_api import sync_playwright  # noqa: E402

errors: list[str] = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(f"window.__walkRun = {json.dumps(RUN)};")

    # Evidence the daemon serves (or not) — decided once, named in the report.
    trail = events()
    report["evidence"] = {"events": trail is not None, "acceptance": acceptance() is not None, "walkthrough": walkthrough_view() is not None}

    # ── W1. the walkthrough, inline, in the run's block ───────────────────────────────────
    page.goto(f"{BASE}/s/run%3A{urllib.parse.quote(RUN, safe='')}", wait_until="networkidle")
    try:
        page.get_by_test_id("session").wait_for(state="visible", timeout=30000)
    except Exception as e:  # noqa: BLE001
        shot(page, "no-session")
        fail("inline", f"/s/run:{RUN} never showed the session: {e}")
    # The walkthrough legs need the run's walkthrough on screen; `deliver` alone does not (a plan whose
    # override left end-to-end testing to the operator has none — its chip says so).
    WALK_LEGS = LEGS & {"inline", "failed", "fix", "passed", "export"}
    art, chain = {}, None
    if WALK_LEGS:
        got, art, chain = wait_for(page, "the walkthrough artifact", lambda a, c: a.get("present") and a.get("state"), min(WAIT_S, 600))
        if not got:
            shot(page, "no-artifact")
            fail("inline", "no walkthrough artifact with a state line in the run's block", art=art, chain=chain)
        shot(page, "inline")
    if "inline" in LEGS:
        kind = state_kind(art["state"])
        moved = None
        if kind == "recording":
            # It is live: the line moves without a reload (chapter n → n+1, or a verdict).
            first = art["state"]
            got2, art2, _ = wait_for(page, "the recording to move", lambda a, c: a.get("state") and a["state"] != first, WAIT_S)
            moved = {"from": first, "to": art2.get("state"), "moved": bool(got2)}
            art = art2
        check("inline", art.get("size") == "inline" and art.get("block") is True and state_kind(art.get("state")) in ("recording", "failed", "passed") and not (chain or {}).get("hscroll"),
              state=art.get("state"), seats=art.get("seats"), size=art.get("size"), moved=moved)

    # Follow the run to a verdict (a recording is waited out).
    if WALK_LEGS:
        got, art, chain = wait_for(page, "a verdict (failed or passed)", lambda a, c: state_kind(a.get("state")) in ("failed", "passed"), WAIT_S)
        if not got:
            shot(page, "no-verdict")
            fail("verdict", f"no verdict within {WAIT_S} s", state=art.get("state"))

    # ── W2 / W3. a failure: the pane at the moment, full screen, Esc; then Ask helpers to fix ──
    if WALK_LEGS and state_kind(art["state"]) == "failed":
        fail_sec = sec_of(art["state"])
        shot(page, "failed")
        if "failed" in LEGS:
            node_before = page.evaluate("""() => { const a = document.querySelector('[data-testid="artifact"][data-kind="walkthrough"]'); if (a) a.__sameNode = 'mark-' + Date.now(); return a ? a.__sameNode : null; }""")
            if "walkthrough-watch" in art["verbs"]:
                page.get_by_test_id("walkthrough-watch").first.click()
                got, a1, _ = wait_for(page, "the pane with the playhead on the failing moment",
                                      lambda a, c: a.get("size") == "pane" and a.get("video") and a["video"]["ready"] >= 1 and (fail_sec is None or a["video"]["t"] >= fail_sec - 0.6), 30)
                shot(page, "pane")
                page.get_by_test_id("artifact-grow").first.click()
                got2, a2, _ = wait_for(page, "full screen", lambda a, c: a.get("size") == "full", 15)
                shot(page, "full")
                page.keyboard.press("Escape")
                got3, a3, _ = wait_for(page, "Esc → pane", lambda a, c: a.get("size") == "pane", 10)
                page.keyboard.press("Escape")
                got4, a4, _ = wait_for(page, "Esc → inline", lambda a, c: a.get("size") == "inline", 10)
                check("failed", bool(got and got2 and got3 and got4) and a2["node"] == node_before and a2["w"] == W and a2["h"] == H,
                      state=art["state"], under=art["under"], frame=art["frame"], failing_sec=fail_sec,
                      pane={"t": a1.get("video", {}).get("t") if a1.get("video") else None}, full={"w": a2.get("w"), "h": a2.get("h"), "same_node": a2.get("node") == node_before},
                      back=[a3.get("size"), a4.get("size")])
            else:
                check("failed", "walkthrough-fix" in art["verbs"] or "walkthrough-edit-check" in art["verbs"], state=art["state"], under=art["under"], verbs=art["verbs"],
                      note="thin result: nothing to watch; the failure and its chapter are read honestly")
        if "fix" in LEGS:
            if not FIX or "walkthrough-fix" not in art["verbs"]:
                cap("fix", "LIVE_FIX=no or no fix verb on screen — the failure is left to the operator", verbs=art["verbs"])
            else:
                before = gate_decisions(events())
                page.get_by_test_id("walkthrough-fix").first.click()
                got, a1, _ = wait_for(page, "the 'Sent back to the helpers' note", lambda a, c: (a.get("note") or "").startswith("Sent back"), 30)
                shot(page, "fix-sent")
                after_trail = events()
                after = gate_decisions(after_trail)
                if after_trail is None:
                    cap("fix", "the daemon serves no event trail (GET /runs/:id/events) — the request_changes could not be read back independently", note=a1.get("note"), sent_note=bool(got))
                    if not got:
                        fail("fix", "no 'Sent back' note after Ask helpers to fix", art=a1)
                else:
                    new = after[len(before):] if len(after) >= len(before) else after
                    summary = [{k: e.get(k) for k in ("type", "ord", "allow", "action", "decision", "verdict") if k in e} for e in new]
                    # One new decision, and it is a request for changes: `allow` false (crew's `gateDecided`), or the action says so.
                    changes = len(new) == 1 and (new[0].get("allow") is False or "request" in json.dumps(summary).lower())
                    check("fix", bool(got) and len(after) == len(before) + 1 and changes,
                          decisions_before=len(before), decisions_after=len(after), new=summary, note=a1.get("note"))
                # The re-record: follow it to its verdict (W1 again), bounded; WALK_RERECORD_S=0 = not followed.
                if RERECORD_S <= 0:
                    cap("rerecord", "the re-record was not followed (WALK_RERECORD_S=0)", state=page.evaluate(ART).get("state"))
                else:
                    got, art, chain = wait_for(page, "the re-record's verdict", lambda a, c: state_kind(a.get("state")) == "passed" or (state_kind(a.get("state")) == "failed" and a.get("state") != art["state"]), RERECORD_S)
                    if not got:
                        cap("rerecord", f"the re-record reached no new verdict within {RERECORD_S} s (state: {art.get('state')!r})", state=art.get("state"))
        elif "passed" in LEGS or "export" in LEGS or "deliver" in LEGS:
            got, art, chain = wait_for(page, "a pass after the failure", lambda a, c: state_kind(a.get("state")) == "passed", WAIT_S)
            if not got:
                cap("passed", f"the run never passed within {WAIT_S} s (state: {art.get('state')!r})")

    # ── W4. passed: the chips agree with the acceptance read; a chip opens the moment ────────
    if state_kind(art.get("state")) == "passed" and "passed" in LEGS:
        acc = acceptance()
        got, art, chain = wait_for(page, "the acceptance read on the block and a timed chip",
                                   lambda a, c: c and c.get("acceptanceRead") == "read" and any(ch["check"] == "checked" and ch["sec"] is not None for ch in c["chips"]), 60)
        shot(page, "passed")
        chips = chain["chips"] if chain else []
        checked_chips = [ch for ch in chips if ch["check"] == "checked"]
        steps = ((acc or {}).get("walkthrough") or {}).get("steps") if acc else None
        if steps is None:
            cap("passed", "the daemon serves no walkthrough block in GET /runs/:id/acceptance — the chips could not be reconciled with crew's check_state",
                chips=chips, sentence=chain.get("sentence") if chain else None, sealed=art.get("sealed"))
        else:
            checked_steps = [s for s in steps if s.get("checkState") == "checked"]
            sentence = chain["sentence"] or ""
            check("passed", bool(got) and len(checked_chips) == len(checked_steps) and len(checked_chips) >= 1
                  and all(ch["button"] and ch["text"].startswith("checked at ") for ch in checked_chips)
                  and (sentence.endswith("done and checked") or " checked" in sentence),
                  chips=chips, checked_steps=[s.get("stepId") for s in checked_steps], sentence=chain.get("sentence"), sealed=art.get("sealed"), followed=chain.get("followed"))
            check("no-followed", not chain.get("followed"), followed=chain.get("followed"))
        if checked_chips:
            want = float(checked_chips[0]["sec"] or 0)
            page.locator('[data-testid="chain-step-check"][data-check="checked"]').first.click()
            got, a1, _ = wait_for(page, "the chip's pane at its moment", lambda a, c: a.get("size") == "pane" and a.get("video") and a["video"]["ready"] >= 1 and a["video"]["t"] >= want - 0.6, 30)
            shot(page, "chip-pane")
            check("checked-link", bool(got), want=want, t=(a1.get("video") or {}).get("t"))
            page.keyboard.press("Escape")
            wait_for(page, "Esc → inline", lambda a, c: a.get("size") == "inline", 10)

    # ── W5. export: the UI's Video is the take's stitched mp4, byte for byte ──────────────
    if state_kind(art.get("state")) == "passed" and "export" in LEGS:
        view = walkthrough_view()
        mp4_path = ((view or {}).get("video") or {}).get("mp4") if view else None
        if not art.get("exportBtn"):
            page.get_by_test_id("artifact-grow").first.click()
            wait_for(page, "the pane (Export lives there)", lambda a, c: a.get("size") == "pane", 10)
        page.get_by_test_id("walkthrough-export").first.click()
        try:
            page.get_by_test_id("walkthrough-export-mp4").wait_for(state="visible", timeout=10000)
        except Exception as e:  # noqa: BLE001
            shot(page, "no-export")
            fail("export", f"Export ▾ offers no Video: {e}")
        href = page.get_by_test_id("walkthrough-export-mp4").get_attribute("href") or ""
        page.keyboard.press("Escape")
        ui = sha256_of(href if href.startswith("http") else f"{BASE}{href}")
        if mp4_path is None:
            cap("export", "GET /runs/:id/walkthrough names no video.mp4 — the UI's download could not be compared with the take", ui={"status": ui[0], "type": ui[1], "sha256": ui[2], "bytes": ui[3]})
        else:
            step = (view or {}).get("stepId")
            q = urllib.parse.urlencode({**({"step": step} if step else {}), "path": mp4_path})
            take = sha256_of(f"{BASE}/api/v1/runs/{urllib.parse.quote(RUN, safe='')}/walkthrough/file?{q}")
            check("export", ui[0] == 200 and take[0] == 200 and ui[2] is not None and ui[2] == take[2] and ui[3] > 0,
                  ui={"href": href, "status": ui[0], "type": ui[1], "sha256": ui[2], "bytes": ui[3]}, take={"path": mp4_path, "status": take[0], "sha256": take[2], "bytes": take[3]})
        shot(page, "export")

    # ── W6. deliver: the acceptance line, the one "Are you sure?", nothing before the yes ────
    if "deliver" in LEGS:
        got, art, chain = wait_for(page, "the hand-over card asking", lambda a, c: c and c.get("proposal") and c["proposal"]["kind"] == "deliver" and c["proposal"]["state"] == "ask" and c.get("acceptance"), WAIT_S)
        if not got:
            shot(page, "no-deliver-card")
            fail("deliver", f"no deliver card with an acceptance line within {WAIT_S} s", chain=chain)
        shot(page, "deliver-card")
        before_trail = events()
        before = gate_decisions(before_trail)
        card = page.locator(f'[data-testid="session-proposal"][data-run-id="{RUN}"]')
        card.get_by_test_id("session-proposal-go").click()
        try:
            card.get_by_test_id("session-proposal-confirm").wait_for(state="visible", timeout=5000)
        except Exception as e:  # noqa: BLE001
            shot(page, "no-sure")
            fail("deliver", f"Deliver asked no 'Are you sure?': {e}")
        sure = card.get_by_test_id("session-proposal-confirm").get_attribute("aria-label") or ""
        shot(page, "are-you-sure")
        mid = gate_decisions(events())
        if before_trail is not None and len(mid) != len(before):
            fail("deliver", "a gate decision landed before the yes", before=len(before), after_click=len(mid))
        acc_line = chain["acceptance"]
        if not APPROVE:
            card.get_by_test_id("session-proposal-confirm-cancel").click()
            time.sleep(1.5)
            after = gate_decisions(events())
            if before_trail is None:
                cap("deliver", "the yes is the operator's (LIVE_APPROVE_DELIVER=no); the daemon serves no event trail, so 'nothing sent' rests on the UI alone",
                    acceptance=acc_line, sure=sure)
            else:
                check("deliver", len(after) == len(before) and acc_line["tone"] == "ok" and sure.startswith("Are you sure?"), acceptance=acc_line, sure=sure, decisions=len(after))
                cap("deliver-yes", "the yes is the operator's (LIVE_APPROVE_DELIVER=no): the push was not exercised by this script", acceptance=acc_line)
        else:
            card.get_by_test_id("session-proposal-confirm-yes").click()
            got, a1, c1 = wait_for(page, "the card to leave its ask", lambda a, c: c and (not c.get("proposal") or c["proposal"]["state"] != "ask"), 30)
            after = gate_decisions(events())
            status = None
            t0 = time.time()
            while time.time() - t0 <= WAIT_S:
                status = run_status()
                if status in ("completed", "delivered", "failed", "cancelled"):
                    break
                time.sleep(5)
            report["waits"].append({"what": "the run's terminal state after the yes", "seconds": round(time.time() - t0, 1), "seen": status})
            shot(page, "delivered")
            if before_trail is None:
                cap("deliver", "no event trail: the approve could not be read back independently", status=status, acceptance=acc_line)
            else:
                new = after[len(before):]
                check("deliver", bool(got) and len(after) == len(before) + 1 and new[0].get("allow") is not False and acc_line["tone"] == "ok" and status in ("completed", "delivered"),
                      acceptance=acc_line, sure=sure, decisions_before=len(before), decisions_after=len(after), status=status,
                      new=[{k: e.get(k) for k in ("type", "ord", "allow", "action") if k in e} for e in new])

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs, errors=errors)
    browser.close()

finish(all(leg.get("ok") for leg in report["legs"].values()))
