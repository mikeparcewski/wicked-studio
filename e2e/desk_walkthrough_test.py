#!/usr/bin/env python3
"""
desk_walkthrough_test.py — WT-U1, the walkthrough / demo-video artifact (DES-WALKTHROUGH-PROOF-001 §3
scenes 18, 19, 20, 23 and 41) at 1440x700 on the Desk.

Against the in-process fixture's `walkthrough` corpus — crew's WT-W1..W3 wire (`GET
/runs/:id/walkthrough`, `…/walkthrough/file`, `PUT …/walkthrough/storyline`) and a finished demo run
(`GET /runs/:id/demo`, `POST …/demo/export`) — it proves, in the session thread:

  a1. WALK-RUNNING (18): `/s/run:r-walk-rec` shows the run's walkthrough inline — "● Recording ·
      chapter 4 of 6", "agy checks, codex builds" (evaluator apart from the builder), six chapter
      marks with the fourth current — and it is live: when the recorder finishes a chapter the line
      moves to "chapter 5 of 6" without a reload. No gate verb while it records.
  a2. WALK-FAIL (19): `/s/run:r-walk-fail` shows "✗ Failed at 0:41", what happened underneath in
      red, the failing frame, and Watch · Ask helpers to fix · Edit the check — all above the fold.
  a3. WALK-FULL (20): Watch opens the pane with the playhead on the failing moment; ⤢ grows it to
      full screen (the same element); the checks track holds every check with the seven kinds, the
      failing ones marked; the timeline carries the red mark; ⋯ opens a check's evidence through the
      contained file route; Esc shrinks one step each time.
  a4. PASSED + EXPORT (23): `/s/run:r-walk-pass` reads "✓ Passed · 6 chapters", sealed; Export ▾
      offers the Video and the Poster the take wrote (no GIF: a walkthrough exports what is on
      disk), and no gate verb. Esc closes the menu before it shrinks the artifact.
  a5. THIN: the result garden 12.41.0 writes (keys and verdicts only) still reads honestly — the
      failure and its chapter, no invented checks, no Watch (nothing to watch).
  a6. DEMO-VIDEO (41): `/s/run:r-walk-demo` opens the demo's video in the same slot, without
      checks: play in place, chapter seek, the narration, Export ▾ Video / GIF / Poster; GIF is made
      by `POST /demo/export {format: "gif"}` and then downloads through the file route.
  b1. ASK HELPERS TO FIX: one `request_changes` on the escalation gate, carrying what the
      walkthrough caught in words; the artifact re-reads ("Not started yet": the work is back with the
      builder) and the verbs go.
  b2. EDIT THE CHECK: the storyline PUT (crew's `{storyline}` body, `?step=walkthrough_review`) then
      ONE approve; the artifact re-reads ("● Recording · chapter 1 of 6").
  z.  0 page errors, no horizontal scroll.

Captures: e2e/shots/desk-walkthrough-*.png. Env: FEEDBACK_PORT (default 4361); DESK_WALK_PART=a|b
runs one half (b waits out two 10 s undo windows).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4361"))
PART = os.environ.get("DESK_WALK_PART", "")
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
KINDS = {"on_screen", "saved_state", "events", "side_effects", "output", "must_not_happen", "cross_check"}

report: dict = {"ok": False, "part": PART or "all", "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read() or b"{}")


def status_of(href: str) -> int:
    return fetch_of(href)[0]


def fetch_of(href: str) -> tuple:
    """(status, content type, the first bytes) of a link the page offered."""
    url = origin + href if href.startswith("/") else href
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read(16)
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        return e.code, "", b""


if PART not in ("", "a", "b"):
    fail("part", f"DESK_WALK_PART is {PART!r}: it names one half, a or b (empty runs both)")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ART = """(kind) => {
  const a = document.querySelector(`[data-testid="artifact"][data-kind="${kind}"]`);
  if (!a) return null;
  const r = a.getBoundingClientRect();
  const q = (id) => a.querySelector(`[data-testid="${id}"]`);
  const txt = (id) => { const e = q(id); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; };
  const v = q('walkthrough-video');
  const frame = q('walkthrough-failed-frame');
  const verbs = ['walkthrough-watch', 'walkthrough-fix', 'walkthrough-edit-check'].filter((id) => q(id));
  return {
    size: a.dataset.size, object: a.dataset.object, node: a.__sameNode || null, w: Math.round(r.width), h: Math.round(r.height),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    state: txt('walkthrough-state'), dataState: (q('walkthrough') || {dataset: {}}).dataset.state || null,
    seats: txt('walkthrough-seats'), sealed: txt('walkthrough-sealed'), note: txt('walkthrough-note'),
    chapters: [...a.querySelectorAll('[data-testid="walkthrough-chapter"]')].map((c) => ({
      key: c.dataset.key, verdict: c.dataset.verdict, current: c.dataset.current, text: c.innerText.replace(/\\s+/g, ' ').trim() })),
    under: [...a.querySelectorAll('[data-testid="walkthrough-underneath"] li')].map((l) => l.innerText.trim()),
    frame: frame ? { loaded: frame.naturalWidth > 0, bottom: Math.round(frame.getBoundingClientRect().bottom) } : null,
    verbs, verbsBottom: Math.max(0, ...verbs.map((id) => Math.round(q(id).getBoundingClientRect().bottom))),
    video: v ? { playhead: v.dataset.playhead, t: v.currentTime, d: v.duration, ready: v.readyState } : null,
    checks: [...a.querySelectorAll('[data-testid="walkthrough-check"]')].map((c) => ({ kind: c.dataset.kind, passed: c.dataset.passed })),
    checksBottom: Math.max(0, ...[...a.querySelectorAll('[data-testid="walkthrough-check"]')].map((c) => Math.round(c.getBoundingClientRect().bottom))),
    // A check is SEEN when its row is inside the viewport and is what a point in it hits (not
    // clipped by a scrolling ancestor, not covered).
    checksSeen: [...a.querySelectorAll('[data-testid="walkthrough-check"]')].filter((c) => {
      const b = c.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + 30, b.top + Math.min(10, b.height / 2));
      return b.top >= 0 && b.bottom <= innerHeight && b.height > 4 && hit !== null && c.contains(hit);
    }).length,
    failingBottom: Math.max(0, ...[...a.querySelectorAll('[data-testid="walkthrough-check"][data-passed="false"]')].map((c) => Math.round(c.getBoundingClientRect().bottom))),
    failMark: q('walkthrough-fail-mark') ? parseFloat(q('walkthrough-fail-mark').style.left) : null, timeline: !!q('walkthrough-timeline'),
    exportBtn: !!q('walkthrough-export'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""


def open_session(page, run: str, kind: str = "walkthrough") -> dict:
    page.goto(f"{origin}/s/run%3A{run}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.locator(f'[data-testid="artifact"][data-kind="{kind}"] [data-testid="walkthrough"]').wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-walkthrough-{run}-missing.png"))
        found = page.evaluate("""() => ({ artifacts: [...document.querySelectorAll('[data-testid="artifact"]')].map(a => a.dataset.kind),
          run: !!document.querySelector('[data-testid="session-run"]'),
          quiet: [...document.querySelectorAll('[data-testid^="walkthrough-"]')].map(e => e.dataset.testid + ': ' + e.innerText.slice(0, 80)) })""")
        fail(f"{run}-renders", {"why": f"no [data-testid=artifact][data-kind={kind}] holding a recording in the session's run block", "found": found})
    return page.evaluate(ART, kind)


def wait_state(page, kind: str, text: str, step: str, timeout_ms: int = 15000) -> dict:
    try:
        page.wait_for_function(
            """([kind, text]) => { const e = document.querySelector(`[data-testid="artifact"][data-kind="${kind}"] [data-testid="walkthrough-state"]`);
              return !!e && e.innerText.replace(/\\s+/g, ' ').includes(text); }""", arg=[kind, text], timeout=timeout_ms)
    except Exception:
        page.screenshot(path=str(SHOTS / f"desk-walkthrough-{step}-timeout.png"))
        fail(step, {"why": f"the state line never read {text!r} within {timeout_ms} ms", "found": page.evaluate(ART, kind)})
    return page.evaluate(ART, kind)


def gate_posts(run: str) -> list:
    return [p["body"] for p in get_json(f"{origin}/__fixture/gate-posts")["posts"] if p["runId"] == run]


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[],
                reset_walkthrough=True, reset_gate_posts=True)

    if PART in ("", "a"):
        # ── a1. walk-running (scene 18) ─────────────────────────────────────────────────
        rec = open_session(page, "r-walk-rec")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-running.png"))
        check("walk-running", rec["size"] == "inline" and rec["state"] == "● Recording · chapter 4 of 6"
              and rec["seats"] == "agy checks, codex builds" and len(rec["chapters"]) == 6
              and [c["current"] for c in rec["chapters"]] == ["false"] * 3 + ["true"] + ["false"] * 2
              and rec["verbs"] == [] and rec["bottom"] <= H and not rec["hscroll"], artifact=rec)
        set_fixture(origin, walk_recorded=4)
        live = wait_state(page, "walkthrough", "chapter 5 of 6", "walk-running-live", 12000)
        check("walk-running-live", live["state"] == "● Recording · chapter 5 of 6", state=live["state"])

        # ── a2. walk-fail (scene 19) ────────────────────────────────────────────────────
        f0 = open_session(page, "r-walk-fail")
        page.wait_for_function("""() => { const i = document.querySelector('[data-testid="walkthrough-failed-frame"]'); return !!i && i.naturalWidth > 0; }""", timeout=10000)
        page.get_by_test_id("walkthrough-fix").wait_for(state="visible", timeout=10000)
        # Mark the DOM node itself: the mark is still there at every size only if it is never replaced.
        page.evaluate("""() => { document.querySelector('[data-testid="artifact"][data-kind="walkthrough"]').__sameNode = 'marked-inline'; }""")
        f0 = page.evaluate(ART, "walkthrough")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-fail.png"))
        check("walk-fail", f0["size"] == "inline" and f0["state"] == "✗ Failed at 0:41"
              and f0["under"] == ["One charge event is emitted — two charge events were emitted",
                                  "The card is charged once at the provider — the provider recorded two charges of $42.00",
                                  "The customer is never charged twice"]
              and f0["frame"] is not None and f0["frame"]["loaded"]
              and f0["verbs"] == ["walkthrough-watch", "walkthrough-fix", "walkthrough-edit-check"]
              and 0 < f0["verbsBottom"] <= H and f0["bottom"] <= H
              and [c["verdict"] for c in f0["chapters"]] == ["PASS", "PASS", "PASS", "FAIL", "PASS", "PASS"]
              and not f0["hscroll"], artifact=f0)

        # ── a3. walk-full (scene 20): Watch → pane on the failing moment → full → Esc, Esc ─
        page.get_by_test_id("walkthrough-watch").click()
        page.get_by_test_id("walkthrough-video").wait_for(state="visible", timeout=10000)
        page.wait_for_function("""() => { const v = document.querySelector('[data-testid="walkthrough-video"]'); return !!v && v.readyState >= 1 && v.currentTime >= 41; }""", timeout=10000)
        page.get_by_test_id("walkthrough-fail-mark").wait_for(state="attached", timeout=10000)
        page.wait_for_timeout(700)  # the morph's cross-fade settles before the shot
        f1 = page.evaluate(ART, "walkthrough")
        # A check's time seeks the take to its moment (the first check: 0:04).
        page.evaluate("""() => document.querySelector('[data-testid="walkthrough-video"]').pause()""")
        page.locator('[data-testid="walkthrough-check-time"]').first.click()
        page.wait_for_timeout(300)
        seek_t = page.evaluate("""() => { const v = document.querySelector('[data-testid="walkthrough-video"]'); v.pause(); return v.currentTime; }""")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-pane.png"))
        page.get_by_test_id("artifact-grow").click()
        page.wait_for_timeout(700)
        f2 = page.evaluate(ART, "walkthrough")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-full.png"))
        kinds = {c["kind"] for c in f2["checks"]}
        walk_narration = page.get_by_test_id("walkthrough-narration").inner_text()
        failing = [c["kind"] for c in f2["checks"] if c["passed"] == "false"]
        # ⋯ on the failing events check: its evidence, through the contained file route.
        row = page.locator('[data-testid="walkthrough-check"][data-kind="events"]')
        row.get_by_test_id("walkthrough-evidence-toggle").click()
        link = row.get_by_test_id("walkthrough-evidence-file").first
        link.wait_for(state="visible", timeout=5000)
        href = link.get_attribute("href") or ""
        detail = row.get_by_test_id("walkthrough-check-detail").inner_text()
        page.screenshot(path=str(SHOTS / "desk-walkthrough-evidence.png"))
        ev_status = status_of(href)
        # The file route serves what the view names and nothing else: the 200 above is not a catch-all.
        other_status = status_of(href.replace("events.json", "not-in-the-view.json"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        f3 = page.evaluate(ART, "walkthrough")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        f4 = page.evaluate(ART, "walkthrough")
        check("walk-full",
              # Watch opened the take AT the failing moment and played from it (a 72 s take: 0:41 is a real position).
              f1["size"] == "pane" and f1["video"] is not None and f1["video"]["playhead"] == "41" and 41 <= f1["video"]["t"] < 47
              and abs(f1["video"]["d"] - 72) < 0.5 and f1["failMark"] is not None and abs(f1["failMark"] - 100 * 41 / 72) < 1.5
              and 4 <= seek_t < 8
              and f1["timeline"] and 0 < f1["failingBottom"] <= H and 0 < f1["verbsBottom"] <= H
              # Nothing load-bearing below the fold at full screen: every check, and the verbs.
              and f2["size"] == "full" and f2["w"] == W and f2["h"] == H and len(f2["checks"]) == 12 and kinds == KINDS
              and 0 < f2["checksBottom"] <= H and f2["checksSeen"] == 12 and 0 < f2["verbsBottom"] <= H
              and "Pay is pressed once; the button waits." in walk_narration
              and failing == ["events", "side_effects", "must_not_happen"]
              and "walkthrough/file?" in href and "step=walkthrough_review" in href and "events.json" in href and ev_status == 200 and other_status == 404
              and detail == "two charge events were emitted"
              and f3["size"] == "pane" and f4["size"] == "inline"
              and f0["object"] == f1["object"] == f2["object"] == f3["object"] == f4["object"]
              and f0["node"] == f1["node"] == f2["node"] == f3["node"] == f4["node"] == "marked-inline" and not f2["hscroll"],
              pane={k: f1[k] for k in ("size", "w", "h", "video", "failMark", "timeline", "failingBottom", "verbsBottom", "node")}, seek_t=seek_t,
              full={k: f2[k] for k in ("size", "w", "h", "state", "sealed", "checksBottom", "checksSeen", "verbsBottom")}, kinds=sorted(kinds), failing=failing,
              evidence={"href": href, "status": ev_status, "other": other_status, "detail": detail}, back=[f3["size"], f4["size"]])

        # ── a4. passed + export (scene 23) ─────────────────────────────────────────────
        p0 = open_session(page, "r-walk-pass")
        page.get_by_test_id("artifact-open").click()
        page.get_by_test_id("walkthrough-export").wait_for(state="visible", timeout=10000)
        page.get_by_test_id("walkthrough-export").click()
        menu = page.get_by_test_id("walkthrough-export-menu")
        menu.wait_for(state="visible", timeout=5000)
        items = page.evaluate("""() => [...document.querySelectorAll('[data-testid="walkthrough-export-menu"] > *')].map(e => ({
          id: e.dataset.testid, tag: e.tagName, href: e.getAttribute('href'), download: e.hasAttribute('download'), text: e.innerText.replace(/\\s+/g, ' ').trim() }))""")
        p1 = page.evaluate(ART, "walkthrough")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-export.png"))
        mp4 = next((i for i in items if i["id"] == "walkthrough-export-mp4"), None)
        poster = next((i for i in items if i["id"] == "walkthrough-export-poster-file"), None)
        take = fetch_of(mp4["href"]) if mp4 else (0, "", b"")
        still = fetch_of(poster["href"]) if poster else (0, "", b"")
        # S15d: the inline preview is the take itself, so the line gains its length once the metadata loads.
        check("walk-pass-export", (p0["state"] or "").startswith("✓ Passed · 6 chapters") and p0["verbs"] == [] and p1["size"] == "pane"
              and (p1["sealed"] or "").startswith("Sealed") and p1["verbs"] == []
              and [i["id"] for i in items] == ["walkthrough-export-mp4", "walkthrough-export-poster-file"]
              and mp4 is not None and mp4["download"] and "path=demo-video%2Fdemo.mp4" in (mp4["href"] or "")
              # What downloads is media of the kind its name says: a video, and a JPEG (its magic bytes).
              and take[0] == 200 and take[1].startswith("video/")
              and poster is not None and poster["download"] and still[0] == 200 and still[1] == "image/jpeg" and still[2][:3] == b"\xff\xd8\xff",
              inline=p0["state"], sealed=p1["sealed"], items=items, take=list(take[:2]), poster=list(still[:2]))
        # Esc closes the menu first; the artifact stays where it is. A second Esc shrinks it.
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        closed = {"menu": page.get_by_test_id("walkthrough-export-menu").count(), "size": page.evaluate(ART, "walkthrough")["size"]}
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check("export-esc", closed == {"menu": 0, "size": "pane"} and page.evaluate(ART, "walkthrough")["size"] == "inline", closed=closed)

        # ── a5. the thin result garden writes today ───────────────────────────────────
        t0 = open_session(page, "r-walk-thin")
        page.get_by_test_id("walkthrough-fix").wait_for(state="visible", timeout=10000)
        t0 = page.evaluate(ART, "walkthrough")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-thin.png"))
        check("walk-thin", t0["state"] == "✗ Failed at 0:08" and t0["under"] == [] and t0["frame"] is None
              and [c["key"] for c in t0["chapters"]] == ["01-totals", "02-rounding", "03-receipt"]
              and t0["verbs"] == ["walkthrough-fix", "walkthrough-edit-check"], artifact=t0)

        # ── a6. the demo video in the same slot (scene 41) ─────────────────────────────
        d0 = open_session(page, "r-walk-demo", "demo-video")
        page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="artifact-open"]').click()
        page.get_by_test_id("walkthrough-video").wait_for(state="visible", timeout=10000)
        page.wait_for_function("""() => { const v = document.querySelector('[data-testid="walkthrough-video"]'); return !!v && v.readyState >= 1; }""", timeout=10000)
        page.locator('[data-testid="walkthrough-marker"]').nth(1).click()
        page.wait_for_function("""() => document.querySelector('[data-testid="walkthrough-video"]').currentTime >= 35""", timeout=5000)
        d1 = page.evaluate(ART, "demo-video")
        # The presenter's script itself, not the label over it: open it and read the run of show.
        page.get_by_test_id("walkthrough-narration").locator("summary").click()
        narration = page.get_by_test_id("walkthrough-narration").inner_text()
        page.get_by_test_id("walkthrough-export").click()
        page.get_by_test_id("walkthrough-export-gif").click()
        page.get_by_test_id("walkthrough-download-gif").wait_for(state="visible", timeout=10000)
        gif_href = page.get_by_test_id("walkthrough-download-gif").get_attribute("href") or ""
        ids = page.evaluate("""() => [...document.querySelectorAll('[data-testid="walkthrough-export-menu"] > *')].map(e => e.dataset.testid)""")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-demo.png"))
        exports = [x["body"] for x in get_json(f"{origin}/__fixture/walkthrough-posts")["posts"] if x["route"] == "export"]
        gif = fetch_of(gif_href)
        check("demo-video", (d0["state"] or "").startswith("✓ Ready to watch · 3 chapters") and d0["seats"] == "codex reviews, claude records"
              and d1["size"] == "pane" and d1["checks"] == [] and d1["sealed"] is None and 35 <= d1["video"]["t"] < 41
              and "Run of show" in narration and "booking a room, start to finish" in narration
              and ids == ["walkthrough-export-mp4", "walkthrough-download-gif", "walkthrough-export-poster"]
              and exports == [{"format": "gif"}]
              and "demo/file?path=demo-video%2Fdemo.gif" in gif_href and gif[0] == 200 and gif[1] == "image/gif" and gif[2][:6] == b"GIF89a",
              inline=d0["state"], seats=d0["seats"], pane={k: d1[k] for k in ("size", "state")}, menu=ids, exports=exports, gif=gif_href)
        page.keyboard.press("Escape")

    if PART in ("", "b"):
        # ── b1. Ask helpers to fix → one request_changes with what the walkthrough caught ──
        set_fixture(origin, reset_walkthrough=True, reset_gate_posts=True)
        open_session(page, "r-walk-fail")
        page.get_by_test_id("walkthrough-fix").wait_for(state="visible", timeout=10000)
        page.get_by_test_id("walkthrough-fix").click()
        page.wait_for_timeout(1500)
        early = gate_posts("r-walk-fail")
        # The note is the UI's own word after the POST; the state line follows the walkthrough RE-READ. Judge
        # `after` once both have landed — on a slow runner the note arrives a tick before the state flips.
        try:
            page.wait_for_function("""() => { const n = document.querySelector('[data-testid="walkthrough-note"]'); const w = document.querySelector('[data-testid="artifact"][data-kind="walkthrough"] [data-testid="walkthrough"]');
              return !!n && n.innerText.startsWith('Sent back') && !!w && w.dataset.state === 'authoring'; }""", timeout=25000)
        except Exception:
            page.screenshot(path=str(SHOTS / "desk-walkthrough-fix-timeout.png"))
            fail("ask-fix", {"why": "no 'Sent back to the helpers' note with the walkthrough back in authoring within 25 s", "found": page.evaluate(ART, "walkthrough"), "posts": gate_posts("r-walk-fail")})
        after = page.evaluate(ART, "walkthrough")
        sent = gate_posts("r-walk-fail")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-fix-sent.png"))
        # The run list refreshes on the daemon's frames (the fixture pushes none): a fresh read of the
        # session shows the work back with the builder, and the walkthrough not started yet.
        fresh = open_session(page, "r-walk-fail")
        amend = (sent[0].get("amend") or "") if sent else ""
        check("ask-fix", early == [] and len(sent) == 1 and sent[0].get("approve") is False and sent[0].get("action") == "request_changes"
              and sent[0].get("ord") == 4 and "chapter 4 (Pay for the order) at 0:41" in amend
              and "two charge events were emitted" in amend and after["verbs"] == [] and after["dataState"] == "authoring"
              and (after["note"] or "").startswith("Sent back to the helpers")
              and fresh["state"] == "○ Not started yet" and fresh["verbs"] == [],
              early=early, sent=sent, after=after["state"], note=after["note"], fresh=fresh["state"])

        # ── b2. Edit the check → the storyline PUT, then one approve ───────────────────
        set_fixture(origin, reset_walkthrough=True, reset_gate_posts=True)
        open_session(page, "r-walk-fail")
        page.get_by_test_id("walkthrough-edit-check").wait_for(state="visible", timeout=10000)
        page.get_by_test_id("walkthrough-edit-check").click()
        page.get_by_test_id("walkthrough-storyline").wait_for(state="visible", timeout=10000)
        size_edit = page.evaluate(ART, "walkthrough")["size"]
        story = "export default { title: 'Pay once', segments: [{ key: '04-pay', checks: [{ id: 'pay-events', kind: 'events', sentence: 'Exactly one charge event is emitted' }] }] };"
        page.get_by_test_id("walkthrough-storyline").fill(story)
        page.wait_for_timeout(700)  # the morph's cross-fade settles before the shot
        save_bottom = page.evaluate("""() => Math.round(document.querySelector('[data-testid="walkthrough-storyline-save"]').getBoundingClientRect().bottom)""")
        page.screenshot(path=str(SHOTS / "desk-walkthrough-edit.png"))
        page.get_by_test_id("walkthrough-storyline-save").click()
        again = wait_state(page, "walkthrough", "Recording · chapter 1 of 6", "edit-check", 20000)
        puts = [x for x in get_json(f"{origin}/__fixture/walkthrough-posts")["posts"] if x["route"] == "storyline"]
        approved = gate_posts("r-walk-fail")
        check("edit-check", size_edit == "pane" and 0 < save_bottom <= H and len(puts) == 1 and puts[0]["storyline"] == story and puts[0]["step"] == "walkthrough_review"
              and len(approved) == 1 and approved[0].get("approve") is True and approved[0].get("ord") == 4
              and again["verbs"] == [], puts=puts, approved=approved, after=again["state"], save_bottom=save_bottom)

    check("no-errors", not errors, errors=errors[:5])
    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
