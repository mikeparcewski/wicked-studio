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

Boundary: the browser and the script speak to STUDIO_URL's origin only — every other request is aborted
before it is sent (other hosts do not even resolve), redirects are judged by the script hop by hop and
never followed by the browser, and the one gap (a static asset the daemon itself redirected to another
port of its host) is recorded and fails the run after a single contact. No git auth; no deliver yes
unless LIVE_APPROVE_DELIVER=yes.

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
ENV_ERRORS: list[str] = []


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        ENV_ERRORS.append(f"{name}={raw!r} is not a whole number of seconds")
        return default


WAIT_S = env_int("WALK_WAIT_S", 1800)
# How long to follow the re-record after "Ask helpers to fix" (default: WAIT_S). 0 = not followed, said so
# (the self-test's fixture cannot re-record; the proof lane follows it to its verdict).
RERECORD_S = env_int("WALK_RERECORD_S", WAIT_S)
FIX = os.environ.get("LIVE_FIX", "yes") == "yes"
APPROVE = os.environ.get("LIVE_APPROVE_DELIVER", "no") == "yes"
W, H = 1440, 700
HERE = Path(__file__).resolve().parent
SHOTS = HERE / "shots"
ARTIFACTS = HERE / "artifacts"

report: dict = {"ok": False, "base": BASE, "run": RUN, "legs": {}, "waits": [], "capped": [], "started": datetime.now(timezone.utc).isoformat()}


import re

FORBIDDEN_PORTS = (60785, 4200)  # the rig and the dev server: never the proof's daemon


def redact(text: str) -> str:
    """No home directory and no account in what is written: a daemon-supplied path or a URL may carry one."""
    text = re.sub(r"(?<![\w-])/(?:Users|home)/[^/\s\"']+", "~", text)
    return re.sub(r"://[^/@\s]+@", "://", text)


LAST_STATE: dict = {"art": None}


def finish(ok: bool) -> None:
    # Every requested leg is in the report, however the script ended: exercised, capped with why (the run
    # offered no such step), or — on a failure before it was reached — said to be not reached. A leg that is
    # simply absent can never read as a pass.
    for leg in sorted(LEGS):
        if leg not in report["legs"]:
            if ok:
                cap(leg, f"not exercised: the run offered no such step (walkthrough state {LAST_STATE['art']!r})")
            else:
                report["legs"][leg] = {"ok": False, "not_reached": True, "at_s": elapsed()}
    report["ok"] = ok
    report["ended"] = datetime.now(timezone.utc).isoformat()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    out = ARTIFACTS / f"live-walkthrough-deliver-{report['started'].replace(':', '').replace('+00:00', 'Z')}.json"
    report["report"] = str(out.relative_to(HERE.parent))
    body = redact(json.dumps(report, indent=2))
    out.write_text(body)
    print(body)
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


if ENV_ERRORS:
    fail("env", "; ".join(ENV_ERRORS))
if not RUN:
    fail("env", "WALK_RUN names the run (its id) whose walkthrough this script follows")
try:
    host = urllib.parse.urlparse(BASE)
    _port = host.port  # a malformed port raises here, inside the handler
except ValueError as e:
    fail("env", f"STUDIO_URL {redact(BASE)} is not a URL this script can read: {e}")
if host.scheme not in ("http", "https") or host.hostname is None or _port in FORBIDDEN_PORTS or host.username or host.password:
    fail("env", f"STUDIO_URL {redact(BASE)} is the rig, the dev server, or carries an account; the proof runs on its own daemon")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is a status, never followed: it could point anywhere (the rig, another host)."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


OPENER = urllib.request.build_opener(_NoRedirect)


def origin_of(url: str) -> tuple:
    """(scheme, host, port) — a URL that cannot be parsed is an origin of its own (never the daemon's)."""
    try:
        u = urllib.parse.urlparse(url)
        return (u.scheme, u.hostname, u.port or (443 if u.scheme == "https" else 80))
    except ValueError:
        return ("invalid", url, 0)


DAEMON_ORIGIN = origin_of(BASE)


def guard_url(url: str) -> None:
    """Every fetch — including an href the UI offered — goes to the daemon at STUDIO_URL and nowhere else."""
    u = urllib.parse.urlparse(url)
    same = (u.scheme == host.scheme and u.hostname == host.hostname and (u.port or (443 if u.scheme == "https" else 80)) == (host.port or (443 if host.scheme == "https" else 80)))
    if not same or u.username or u.password or u.port in FORBIDDEN_PORTS:
        fail("env", f"refused to fetch {redact(url)}: not the daemon at {redact(BASE)}")


def api(path: str):
    """GET /api/v1<path> → (status, json|None|bytes). A route the daemon lacks is a status, never an exception."""
    url = f"{BASE}/api/v1{path}" if path.startswith("/") else path
    guard_url(url)
    try:
        with OPENER.open(url, timeout=30) as r:
            body = r.read()
            ctype = r.headers.get("content-type", "")
            return r.status, (json.loads(body) if "json" in ctype else body), ctype
    except urllib.error.HTTPError as e:
        return e.code, None, ""
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e), ""


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


EVENTS_SEEN: dict = {"yes": False}


def events() -> list | None:
    st, body, _ = api(f"/runs/{urllib.parse.quote(RUN, safe='')}/events")
    if st != 200 or not isinstance(body, dict) or not isinstance(body.get("events"), list):
        return None
    EVENTS_SEEN["yes"] = True  # latched: from here on, silence is a failure, never an empty count
    return body["events"]


def trail_now(leg: str) -> list | None:
    """The trail for a comparison: once GET /runs/:id/events has answered — at any point — a later silence
    FAILS the leg; a count compared against nothing certifies nothing."""
    evs = events()
    if evs is None and EVENTS_SEEN["yes"]:
        fail(leg, "GET /runs/:id/events stopped answering mid-leg — the decisions could not be compared")
    return evs


def open_gate_ord() -> int | None:
    """The ord of the gate open on the run (GET /runs/:id/gate), when the daemon serves it."""
    st, body, _ = api(f"/runs/{urllib.parse.quote(RUN, safe='')}/gate")
    return body.get("ord") if st == 200 and isinstance(body, dict) and isinstance(body.get("ord"), int) else None


def chapter_moments(view: dict | None, chapter: str) -> tuple:
    """(start, failed-at) of a chapter in the stitched take, as the UI derives them: the chapter's index into
    `video.markers` (its start), plus the chapter's `failedAtSec` for the failing moment. None = not held."""
    if not isinstance(view, dict):
        return None, None
    chapters = view.get("chapters") or []
    markers = ((view.get("video") or {}).get("markers")) or []
    for i, c in enumerate(chapters):
        if c.get("key") == chapter:
            start = markers[i].get("sec") if i < len(markers) and isinstance(markers[i], dict) else None
            at = c.get("failedAtSec")
            return start, (start + at if isinstance(start, (int, float)) and isinstance(at, (int, float)) else None)
    return None, None


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
        LAST_STATE["art"] = last["art"]
        got = pred(art, chain)
        if got:
            report["waits"].append({"what": what, "seconds": round(time.time() - t0, 1), "seen": last})
            return got, art, chain
        # Wait THROUGH the page, never with time.sleep: the route gate below runs on this thread's event loop,
        # and a sleeping script would stall every request the browser makes (on a slow runner, fatally).
        page.wait_for_timeout(every_s * 1000)
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


errors: list[str] = []


def main(p) -> None:  # noqa: ANN001, C901
    # Other HOSTS do not resolve at all for this browser (the daemon's host excepted); other PORTS on the
    # daemon's host are refused by the request gate below. Together: the proof's browser speaks to STUDIO_URL.
    browser = p.chromium.launch(args=[f"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE {host.hostname}"])
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(f"window.__walkRun = {json.dumps(RUN)};")

    # The browser, too, speaks only to the daemon at STUDIO_URL: a request to any other origin (a redirect,
    # a link, an asset) is aborted and named — the proof never touches the rig or another host.
    blocked: list[str] = []
    redirects: list[str] = []  # in-origin hops the script followed on the browser's behalf (recorded)
    proxy_errors: list[str] = []  # a request the script could not fetch on the browser's behalf (aborted, recorded)
    console: list[str] = []
    page.on("console", lambda m: console.append(f"{m.type}: {m.text[:200]}") if m.type in ("error", "warning") else None)

    def off_origin(url: str) -> bool:
        return urllib.parse.urlparse(url).scheme not in ("data", "blob", "about") and origin_of(url) != DAEMON_ORIGIN

    ASSET_TYPES = ("script", "stylesheet", "font", "image", "media")

    def only_the_daemon(route):  # noqa: ANN001
        if off_origin(route.request.url):
            blocked.append(redact(route.request.url))
            route.abort()
            return
        if route.request.resource_type in ASSET_TYPES:
            # The bundle's own assets (hundreds of same-origin GETs) go straight through: proxying each one
            # through this handler serialises them and, on a slow runner, starves the page of its data. They
            # carry no decision. THE ONE GAP, said plainly: were the daemon to answer an asset with a redirect
            # to another port of its own host, the browser would follow it once before the request listener
            # below records the hop and fails the run (other hosts do not resolve, see the launch flags).
            route.continue_()
            return
        try:
            # Fetched by the script with redirects NOT followed; the browser is handed only a NON-3xx response, so
            # it never follows a redirect itself (routed or not). Each hop's Location is judged HERE: off-origin
            # or missing → aborted and recorded, never contacted; in-origin → fetched in turn (at most 5 hops).
            resp = route.fetch(max_redirects=0)
            url, method = route.request.url, route.request.method
            hops = 0
            while 300 <= resp.status < 400:
                loc = resp.headers.get("location") or ""
                target = urllib.parse.urljoin(url, loc) if loc else ""
                if target == "" or off_origin(target) or hops >= 5 or resp.status == 304:
                    blocked.append(redact(f"{url} -> {target or '(no Location)'}"))
                    route.abort()
                    return
                redirects.append(redact(f"{method} {url} -> {resp.status} {target}"))
                url, hops = target, hops + 1
                if resp.status not in (307, 308):
                    method = "GET"  # 301/302/303: the browser would re-issue as a GET with no body — so does the script
                if method == route.request.method:
                    resp = route.fetch(url=url, max_redirects=0)  # 307/308 before any method change: the original method and body travel
                else:
                    resp = route.fetch(url=url, method="GET", post_data="", max_redirects=0)  # a GET hop, and every hop after it, carries no body
            route.fulfill(response=resp)
        except Exception as e:  # noqa: BLE001 — the page navigated away mid-request, or the fetch itself failed
            proxy_errors.append(redact(f"{route.request.method} {route.request.url}: {type(e).__name__}: {str(e)[:160]}"))
            try:
                route.abort()
            except Exception:  # noqa: BLE001
                pass
    page.route("**/*", only_the_daemon)
    # Belt and braces: every request the browser makes is also recorded; one off-origin request fails the run.
    page.on("request", lambda req: blocked.append(redact(req.url)) if off_origin(req.url) and redact(req.url) not in blocked else None)

    # Evidence the daemon serves (or not) — decided once, named in the report.
    trail = events()
    report["evidence"] = {"events": trail is not None, "acceptance": acceptance() is not None, "walkthrough": walkthrough_view() is not None}

    # ── W1. the walkthrough, inline, in the run's block ───────────────────────────────────
    first = page.goto(f"{BASE}/s/run%3A{urllib.parse.quote(RUN, safe='')}", wait_until="networkidle")
    hop = first.request.redirected_from if first is not None else None
    hops = []
    while hop is not None:
        hops.append(redact(hop.url))
        hop = hop.redirected_from
    if hops:
        fail("env", "the session address redirected — the proof follows no redirect", hops=hops, landed=redact(page.url))
    try:
        page.get_by_test_id("session").wait_for(state="visible", timeout=30000)
    except Exception as e:  # noqa: BLE001
        shot(page, "no-session")
        fail("inline", f"/s/run:{RUN} never showed the session: {e}", blocked=blocked)
    if origin_of(page.url) != DAEMON_ORIGIN:
        fail("env", f"the page left the daemon's origin: {redact(page.url)}", blocked=blocked)
    # Every click is inside THIS run's block (a session thread may hold other runs with their own artifacts).
    block = page.locator(f'[data-testid="session-run"][data-run-id="{RUN}"]')
    walk_art = block.locator('[data-testid="artifact"][data-kind="walkthrough"]')
    # The walkthrough legs need the run's walkthrough on screen; `deliver` alone does not (a plan whose
    # override left end-to-end testing to the operator has none — its chip says so).
    WALK_LEGS = LEGS & {"inline", "failed", "fix", "passed", "export"}
    art, chain = {}, None
    if WALK_LEGS:
        got, art, chain = wait_for(page, "the walkthrough artifact", lambda a, c: a.get("present") and a.get("state"), min(WAIT_S, 600))
        if not got:
            shot(page, "no-artifact")
            found = page.evaluate("""() => ({ runs: [...document.querySelectorAll('[data-testid="session-run"]')].map((b) => b.dataset.runId),
              artifacts: [...document.querySelectorAll('[data-testid="artifact"]')].map((a) => a.dataset.kind),
              session: document.querySelector('[data-testid="session"]')?.innerText.replace(/\\s+/g, ' ').slice(0, 400) ?? null })""")
            fail("inline", "no walkthrough artifact with a state line in the run's block", art=art, chain=chain, found=found,
                 blocked=blocked, redirects=redirects[:10], proxy_errors=proxy_errors[:10], console=console[:10], page_errors=errors[:5])
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
        check("inline", art.get("size") == "inline" and art.get("block") is True and state_kind(art.get("state")) in ("recording", "failed", "passed") and not (chain or {}).get("hscroll")
              and (moved is None or moved["moved"] is True),
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
            # What the failure says underneath is the wire's failed checks: when the failing chapter carries
            # checks that failed, the list must be on screen; the failed frame whenever the take holds one.
            view0 = walkthrough_view()
            failing0 = next((c for c in (view0 or {}).get("chapters", []) if c.get("verdict") == "FAIL"), None) if view0 else None
            frame_expected = bool(failing0 and failing0.get("failedFrame"))
            checks_failed = [c for c in ((failing0 or {}).get("checks") or []) if c.get("passed") is False]
            if view0 is None:
                cap("failed-underneath", "GET /runs/:id/walkthrough is not served — what the failure says underneath could not be compared", under=art["under"], frame=art["frame"])
            else:
                # EACH failed check the wire names is on screen (its statement in one of the underneath lines) —
                # not merely "some line"; a check the wire names without words counts by number.
                def words_of(c: dict) -> str:
                    return next((str(c[k]) for k in ("sentence", "statement", "label", "name", "text", "title") if isinstance(c.get(k), str) and c[k].strip()), "")
                named = [words_of(c) for c in checks_failed]
                # A failed check the wire names without words cannot be matched — that is a cap, not a pass.
                if any(w == "" for w in named):
                    cap("failed-underneath", "a failed check on the wire carries no words to find on screen", under=art["under"], wire_failed_checks=named)
                    named = None
                shown = named is not None and all(any(w in u for u in art["under"]) for w in named) and len(art["under"]) >= len(checks_failed)
                if named is None:
                    pass
                else:
                    check("failed-underneath", shown and (art["frame"] or not frame_expected),
                          under=art["under"], wire_failed_checks=named, frame=art["frame"], frame_expected=frame_expected)
            node_before = page.evaluate("""() => { const b = document.querySelector('[data-testid="session-run"][data-run-id=' + JSON.stringify(window.__walkRun) + ']'); const a = (b || document).querySelector('[data-testid="artifact"][data-kind="walkthrough"]'); if (a) a.__sameNode = 'mark-' + Date.now(); return a ? a.__sameNode : null; }""")
            if "walkthrough-watch" in art["verbs"]:
                block.get_by_test_id("walkthrough-watch").first.click()
                # The playhead sits ON the moment (within the poll interval), not merely past it.
                got, a1, _ = wait_for(page, "the pane with the playhead on the failing moment",
                                      lambda a, c: a.get("size") == "pane" and a.get("video") and a["video"]["ready"] >= 1 and (fail_sec is None or fail_sec - 0.6 <= a["video"]["t"] <= fail_sec + 4), 30)
                if fail_sec is None:
                    cap("failed-moment", "the state line names no moment (m:ss), so the playhead's position was not judged", state=art["state"])
                else:
                    view = walkthrough_view()
                    failing = next((c for c in (view or {}).get("chapters", []) if c.get("verdict") == "FAIL"), None) if view else None
                    wire_fail = chapter_moments(view, failing.get("key"))[1] if failing else None
                    if wire_fail is None:
                        cap("failed-moment", "GET /runs/:id/walkthrough names no failing moment to compare the state line with", ui_sec=fail_sec)
                    else:
                        check("failed-moment", abs(wire_fail - fail_sec) < 1, ui_sec=fail_sec, wire_sec=wire_fail, chapter=failing.get("key"))
                shot(page, "pane")
                walk_art.get_by_test_id("artifact-grow").first.click()
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
                # A thin result (no stitched take): nothing to watch, so the pane / full screen / Esc steps were
                # NOT exercised — said so, never certified.
                cap("failed", "thin result: no Watch verb, so the pane, full screen and Esc were not exercised", state=art["state"], under=art["under"], verbs=art["verbs"])
        if "fix" in LEGS:
            if not FIX or "walkthrough-fix" not in art["verbs"]:
                cap("fix", "LIVE_FIX=no or no fix verb on screen — the failure is left to the operator", verbs=art["verbs"])
            else:
                before_trail = trail_now("fix")
                before = gate_decisions(before_trail)
                gate_ord = open_gate_ord()

                def takes(v: dict | None) -> list:
                    """Every chapter's take count — a new take anywhere is a new take."""
                    return [c.get("takes") or 0 for c in (v or {}).get("chapters", [])] if isinstance(v, dict) else []
                takes0 = takes(walkthrough_view())  # BEFORE the click: a fast re-record cannot slip under the baseline
                block.get_by_test_id("walkthrough-fix").first.click()
                got, a1, _ = wait_for(page, "the 'Sent back to the helpers' note", lambda a, c: (a.get("note") or "").startswith("Sent back"), 30)
                shot(page, "fix-sent")
                after_trail = trail_now("fix")
                after = gate_decisions(after_trail)
                if not got:
                    fail("fix", "no 'Sent back' note after Ask helpers to fix", art=a1)
                if before_trail is None or after_trail is None:
                    # No trail before the click, or none after: "exactly one new decision" has nothing to count from.
                    cap("fix", "GET /runs/:id/events was not served both before and after the click — the request_changes could not be read back independently",
                        note=a1.get("note"), trail_before=before_trail is not None, trail_after=after_trail is not None)
                else:
                    new = after[len(before):] if len(after) >= len(before) else after
                    summary = [{k: e.get(k) for k in ("type", "ord", "allow", "action", "decision", "verdict") if k in e} for e in new]
                    # Exactly one new decision; it refuses (`allow` false — crew's `gateDecided`) as a REQUEST FOR
                    # CHANGES when the event names its action; and it is THIS gate's (its ord), when the daemon
                    # served the open gate.
                    changes = (len(new) == 1 and new[0].get("allow") is False and new[0].get("action", "request_changes") == "request_changes"
                               and (gate_ord is None or new[0].get("ord") == gate_ord))
                    check("fix", bool(got) and len(after) == len(before) + 1 and changes,
                          decisions_before=len(before), decisions_after=len(after), new=summary, gate_ord=gate_ord, action_on_wire="action" in (new[0] if new else {}), note=a1.get("note"))
                # The re-record: follow it to its verdict (W1 again), bounded; WALK_RERECORD_S=0 = not followed.
                if RERECORD_S <= 0:
                    cap("rerecord", "the re-record was not followed (WALK_RERECORD_S=0)", state=page.evaluate(ART).get("state"))
                else:
                    # A NEW verdict: a pass, or a failure from a new take (some chapter's take count grew — the
                    # state line alone cannot tell a re-recorded failure at the same moment from the old one).
                    lost = {"view": False}

                    def new_verdict(a, c):  # noqa: ANN001
                        v = walkthrough_view()  # sampled on EVERY poll, recording included
                        if v is None:
                            lost["view"] = True  # the wire went silent: no take to tie a verdict to — evidence lost, not a verdict
                            return False
                        k = state_kind(a.get("state"))
                        # Either verdict counts only as a NEW TAKE's, on the wire: some chapter's take count grew
                        # (none shrank), and for a pass the wire's own state is passed. A changed label alone, or
                        # a screen the wire does not back, is not evidence of a re-record.
                        now = takes(v)
                        grew = len(now) == len(takes0) and any(n > b for n, b in zip(now, takes0)) and all(n >= b for n, b in zip(now, takes0))
                        # … and the wire's own state agrees with the screen's verdict: a lingering old failure over a
                        # take still recording is not a verdict.
                        if k == "passed":
                            return grew and v.get("state") == "passed"
                        return k == "failed" and grew and v.get("state") == "failed"
                    if not takes0:
                        # No take baseline from the wire before the click: a later verdict cannot be shown to be a NEW take's.
                        cap("rerecord", "GET /runs/:id/walkthrough gave no chapters before the click — the re-record has no baseline to be judged against")
                        got = None
                    else:
                        got, art, chain = wait_for(page, "the re-record's verdict", new_verdict, RERECORD_S)
                    if "rerecord" in report["legs"]:
                        pass
                    elif lost["view"]:
                        # Whatever the screen showed afterwards, the wire went silent mid-follow: the verdict seen
                        # cannot be tied to a new take — evidence lost, said so.
                        cap("rerecord", "GET /runs/:id/walkthrough stopped answering while the re-record was followed — a new take could not be told from the old", state=art.get("state"), seen_pass=bool(got))
                    elif not got:
                        cap("rerecord", f"the re-record reached no new verdict within {RERECORD_S} s (state: {art.get('state')!r})", state=art.get("state"))
                    else:
                        check("rerecord", True, state=art.get("state"), takes_before=takes0, takes_after=takes(walkthrough_view()))
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
        # "checked" rests on a SEALED take (WT §4.9): the wire says so, or the leg is capped — judged whatever
        # the acceptance read holds.
        view_s = walkthrough_view()
        if view_s is None:
            cap("passed-sealed", "GET /runs/:id/walkthrough is not served — the seal behind the chips could not be read")
        else:
            check("passed-sealed", view_s.get("sealed") is True, sealed=view_s.get("sealed"), tree=view_s.get("tree"))
        chips = chain["chips"] if chain else []
        checked_chips = [ch for ch in chips if ch["check"] == "checked"]
        steps = ((acc or {}).get("walkthrough") or {}).get("steps") if acc else None
        if steps is None:
            cap("passed", "the daemon serves no walkthrough block in GET /runs/:id/acceptance — the chips could not be reconciled with crew's check_state",
                chips=chips, sentence=chain.get("sentence") if chain else None, sealed=art.get("sealed"))
        else:
            checked_steps = [s for s in steps if s.get("checkState") == "checked"]
            sentence = chain["sentence"] or ""
            # The SAME steps, by id — never a count; a chip for a step crew did not check is a false claim. And
            # the sentence is exactly what the chain's own steps add up to (WT-U2's rule: "done and checked"
            # only when every step is checked, else "N of M done · K checked").
            live_steps = [st for st in (chain.get("steps") or []) if st[1] not in ("struck", "replaced")]
            done_n = sum(1 for st in live_steps if st[1] in ("done", "checked"))
            total_n, checked_n = len(live_steps), sum(1 for st in live_steps if st[1] == "checked")
            expected = f"{done_n} of {total_n} done and checked" if checked_n == total_n else f"{done_n} of {total_n} done · {checked_n} checked"
            # A chip's words say the moment its data-sec holds — "checked at 0:30 ▸" for 30 — never another time.
            def mmss(sec) -> str:
                n = int(float(sec)); return f"{n // 60}:{n % 60:02d}"
            words_ok = all(ch["button"] and ch["sec"] is not None and ch["text"] == f"checked at {mmss(ch['sec'])} ▸" for ch in checked_chips)
            check("passed", bool(got) and sorted(ch["step"] or "" for ch in checked_chips) == sorted(s.get("stepId") or "" for s in checked_steps) and len(checked_chips) >= 1
                  and words_ok
                  and sentence == expected and checked_n == len(checked_chips),
                  chips=chips, checked_steps=[s.get("stepId") for s in checked_steps], sentence=chain.get("sentence"), expected=expected, sealed=art.get("sealed"), followed=chain.get("followed"))
            check("no-followed", not chain.get("followed"), followed=chain.get("followed"))
            # Each chip's moment is the start of one of the chapters crew says proved that step, in the take
            # the UI already reads (crew asserts no atSec on today's wire — WT §4.9).
            view = walkthrough_view()
            moments = {}
            for st in checked_steps:
                starts = {chapter_moments(view, (p or {}).get("chapter"))[0] for p in (st.get("provedBy") or [])}
                moments[st.get("stepId")] = sorted(x for x in starts if isinstance(x, (int, float)))
            if any(len(v) == 0 for v in moments.values()):
                cap("checked-moment", "GET /runs/:id/walkthrough holds no start for a proving chapter — a chip's moment could not be compared", moments=moments, chips=chips)
            else:
                check("checked-moment", all(ch["sec"] is not None and float(ch["sec"]) in moments.get(ch["step"], []) for ch in checked_chips), moments=moments, chips=chips)
        if checked_chips:
            want = float(checked_chips[0]["sec"] or 0)
            block.locator('[data-testid="chain-step-check"][data-check="checked"]').first.click()
            got, a1, _ = wait_for(page, "the chip's pane at its moment", lambda a, c: a.get("size") == "pane" and a.get("video") and a["video"]["ready"] >= 1 and want - 0.6 <= a["video"]["t"] <= want + 4, 30)
            shot(page, "chip-pane")
            check("checked-link", bool(got), want=want, t=(a1.get("video") or {}).get("t"))
            page.keyboard.press("Escape")
            wait_for(page, "Esc → inline", lambda a, c: a.get("size") == "inline", 10)

    # ── W5. export: the UI's Video is the take's stitched mp4, byte for byte ──────────────
    if state_kind(art.get("state")) == "passed" and "export" in LEGS:
        view = walkthrough_view()
        mp4_path = ((view or {}).get("video") or {}).get("mp4") if view else None
        if not art.get("exportBtn"):
            walk_art.get_by_test_id("artifact-grow").first.click()
            wait_for(page, "the pane (Export lives there)", lambda a, c: a.get("size") == "pane", 10)
        block.get_by_test_id("walkthrough-export").first.click()
        try:
            block.get_by_test_id("walkthrough-export-mp4").wait_for(state="visible", timeout=10000)
        except Exception as e:  # noqa: BLE001
            shot(page, "no-export")
            fail("export", f"Export ▾ offers no Video: {e}")
        href = block.get_by_test_id("walkthrough-export-mp4").get_attribute("href") or ""
        # The link is the run's walkthrough FILE route (same origin), naming the take's own mp4 — not some other
        # endpoint that happens to serve the same bytes.
        hp = urllib.parse.urlparse(urllib.parse.urljoin(BASE, href))
        hq = urllib.parse.parse_qs(hp.query)
        route_ok = origin_of(urllib.parse.urljoin(BASE, href)) == DAEMON_ORIGIN and hp.path == f"/api/v1/runs/{urllib.parse.quote(RUN, safe='')}/walkthrough/file"
        check("export-route", route_ok and (mp4_path is None or hq.get("path") == [mp4_path]), href=redact(href), path=hq.get("path"), take_mp4=mp4_path)
        # The UI's Video is CLICKED: what the browser downloads is what is hashed (not a re-fetch of the href).
        try:
            with page.expect_download(timeout=20000) as dl:
                block.get_by_test_id("walkthrough-export-mp4").click()
            saved = dl.value.path()
            data = Path(saved).read_bytes() if saved else b""
            ui = (200 if data else 0, "download", hashlib.sha256(data).hexdigest() if data else None, len(data))
        except Exception as e:  # noqa: BLE001
            shot(page, "no-download")
            fail("export", f"clicking Video produced no download: {redact(str(e))}", href=redact(href))
        page.keyboard.press("Escape")
        if mp4_path is None:
            # No take to compare with — but the download itself must still be a real file.
            check("export-download", ui[0] == 200 and ui[2] is not None and ui[3] > 0, ui={"href": href, "status": ui[0], "type": ui[1], "bytes": ui[3]})
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
        # The card's line is crew's `summary.line`, verbatim, and its tone is crew's `satisfied` — where served.
        acc = acceptance()
        summary = (acc or {}).get("summary") if isinstance(acc, dict) else None
        acc_line = chain["acceptance"]
        if not isinstance(summary, dict) or not isinstance(summary.get("line"), str):
            cap("deliver-line", "GET /runs/:id/acceptance serves no summary.line — the card's words could not be compared with crew's", card=acc_line)
        else:
            check("deliver-line", acc_line["text"] == summary["line"] and (acc_line["tone"] == "ok") == (summary.get("satisfied") is True),
                  card=acc_line, wire={"line": summary["line"], "satisfied": summary.get("satisfied"), "required": summary.get("required")})
        before_trail = trail_now("deliver")
        before = gate_decisions(before_trail)
        gate_ord = open_gate_ord()
        card = page.locator(f'[data-testid="session-proposal"][data-run-id="{RUN}"]')
        card.get_by_test_id("session-proposal-go").click()
        try:
            card.get_by_test_id("session-proposal-confirm").wait_for(state="visible", timeout=5000)
        except Exception as e:  # noqa: BLE001
            shot(page, "no-sure")
            fail("deliver", f"Deliver asked no 'Are you sure?': {e}")
        sure = card.get_by_test_id("session-proposal-confirm").get_attribute("aria-label") or ""
        shot(page, "are-you-sure")
        # What the UI shows is judged on both paths and before any cap; only "nothing sent" / "one approve"
        # need the trail.
        check("deliver-card", acc_line["tone"] == "ok" and sure.startswith("Are you sure?"), acceptance=acc_line, sure=sure)
        mid = gate_decisions(trail_now("deliver"))
        if before_trail is not None and len(mid) != len(before):
            fail("deliver", "a gate decision landed before the yes", before=len(before), after_click=len(mid))
        if not APPROVE:
            card.get_by_test_id("session-proposal-confirm-cancel").click()
            page.wait_for_timeout(1500)
            after = gate_decisions(trail_now("deliver"))
            if before_trail is None:
                cap("deliver", "the yes is the operator's (LIVE_APPROVE_DELIVER=no); the daemon serves no event trail, so 'nothing sent' rests on the UI alone",
                    acceptance=acc_line, sure=sure)
            else:
                check("deliver", len(after) == len(before), acceptance=acc_line, sure=sure, decisions=len(after))
                cap("deliver-yes", "the yes is the operator's (LIVE_APPROVE_DELIVER=no): the push was not exercised by this script", acceptance=acc_line)
        else:
            card.get_by_test_id("session-proposal-confirm-yes").click()
            got, a1, c1 = wait_for(page, "the card to leave its ask", lambda a, c: c and (not c.get("proposal") or c["proposal"]["state"] != "ask"), 30)
            status = None
            t0 = time.time()
            while time.time() - t0 <= WAIT_S:
                status = run_status()
                if status in ("completed", "delivered", "failed", "cancelled"):
                    break
                page.wait_for_timeout(5000)
            report["waits"].append({"what": "the run's terminal state after the yes", "seconds": round(time.time() - t0, 1), "seen": status})
            shot(page, "delivered")
            after = gate_decisions(trail_now("deliver"))  # read AFTER the run ended: a decision during the wait is counted
            # The UI's part is judged either way: the card left its ask and the run ended well.
            check("deliver-ended", bool(got) and status in ("completed", "delivered"), card_left_ask=bool(got), status=status)
            if before_trail is None:
                cap("deliver", "no event trail: the approve could not be read back independently", status=status, acceptance=acc_line)
            else:
                new = after[len(before):]
                # Exactly one new decision, an APPROVE (`allow` true) of THIS gate (its ord, when served), and the run ended.
                approved = (len(new) == 1 and new[0].get("allow") is True and (gate_ord is None or new[0].get("ord") == gate_ord)
                            and str(new[0].get("action", "approve")).lower() not in ("request_changes", "reject", "rejected", "deny", "denied"))
                check("deliver", bool(got) and len(after) == len(before) + 1 and approved and acc_line["tone"] == "ok" and status in ("completed", "delivered"),
                      acceptance=acc_line, sure=sure, decisions_before=len(before), decisions_after=len(after), status=status, gate_ord=gate_ord,
                      new=[{k: e.get(k) for k in ("type", "ord", "allow", "action") if k in e} for e in new])

    hs = page.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check("no-errors-no-hscroll", not errors and not hs and not blocked and not proxy_errors, errors=errors, blocked=blocked, redirects=redirects, proxy_errors=proxy_errors)
    browser.close()


try:
    from playwright.sync_api import sync_playwright  # noqa: E402
except ImportError as e:
    fail("env", f"playwright is not installed: {e}")
try:
    with sync_playwright() as p:  # the browser's start, too, is inside the handler: no exit without a report
        main(p)
except SystemExit:
    raise
except Exception as e:  # noqa: BLE001 — a Playwright timeout or a page gone: the report is still written, every requested leg accounted for
    fail("script", redact(f"{type(e).__name__}: {e}"))
finish(all(leg.get("ok") for leg in report["legs"].values()))
