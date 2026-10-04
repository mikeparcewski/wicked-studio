#!/usr/bin/env python3
"""
desk_demo_video_test.py — S15d (DES-STUDIO-REBUILD-001 Amendment 5, item 2) at 1440x700, under STUDIO_SKIN=desk.

A demo run's recording is an artifact of its session (studio#502). Against the fixture's finished
demo run (`r-walk-demo`: `GET /runs/:id/demo` stage done, the take under `…/demo/file`), it proves in
the session thread at `/s/run:r-walk-demo`:

  1. THE PREVIEW IS THE VIDEO (rule 1): the inline "Demo video" artifact holds a `<video>` on the
     demo file route, with metadata loaded, that a pointer at its middle actually reaches (it plays in
     place — the artifact's catch does not cover it); the state line says ready, chapters, and length.
  2. A CHAPTER IS A SEEK POINT AND A SUBJECT (rule 2): picking chapter 2 inline seeks the player to
     its moment and puts an "about: chapter 2 · …" chip on the session composer.
  3. ONE PLAYER ACROSS THE MORPH: the catch opens the pane; the `<video>` in the pane is the SAME
     node that was inline (its playhead kept), with the chapter marks, Narration (the presenter's
     script, read as fixed — no script editor for a finished demo) and Export (GIF made on request).
  4. Esc shrinks back to the thread; 0 page errors; no horizontal scroll.

Captures: e2e/shots/desk-demo-video*.png. Env: FEEDBACK_PORT (default 4463).
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4463"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}


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


def fetch_of(href: str) -> tuple:
    url = origin + href if href.startswith("/") else href
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read(16)
    except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
        return e.code, "", b""


if STUDIO_SKIN != "desk":
    fail("skin", f"desk journeys run under STUDIO_SKIN=desk, not {STUDIO_SKIN}")

dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ART = """() => {
  const a = document.querySelector('[data-testid="artifact"][data-kind="demo-video"]');
  if (!a) return null;
  const q = (id) => a.querySelector(`[data-testid="${id}"]`);
  const txt = (id) => { const e = q(id); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; };
  const v = q('walkthrough-video');
  let hit = null;
  if (v) { const b = v.getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); hit = e === null ? null : e === v || v.contains(e) ? 'video' : (e.dataset.testid || e.className || e.tagName); }
  return {
    size: a.dataset.size, state: txt('walkthrough-state'), seats: txt('walkthrough-seats'),
    video: v ? { src: v.getAttribute('src'), ready: v.readyState, t: v.currentTime, d: v.duration, marked: v.__s15d === 1, hit,
                 w: Math.round(v.getBoundingClientRect().width), bottom: Math.round(v.getBoundingClientRect().bottom) } : null,
    markers: [...a.querySelectorAll('[data-testid="walkthrough-marker"]')].map((m) => m.dataset.sec),
    scriptBox: !!q('demo-script'), fixed: txt('demo-script-fixed'), narration: !!q('walkthrough-narration'), exportBtn: !!q('walkthrough-export'),
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""

CHIPS = """() => [...document.querySelectorAll('[data-testid="composer-chip"]')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim())"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")

    set_fixture(origin, sessions=True, run_chat_id=True, walkthrough=True, walk_recorded=3, extra_frames=[], reset_walkthrough=True)
    page.goto(f"{origin}/s/run%3Ar-walk-demo", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=15000)
    try:
        page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="walkthrough-video"]').wait_for(state="visible", timeout=15000)
        page.wait_for_function("""() => { const v = document.querySelector('[data-testid="artifact"][data-kind="demo-video"] [data-testid="walkthrough-video"]'); return !!v && v.readyState >= 1; }""", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / "desk-demo-video-missing.png"))
        fail("inline-video", {"why": "the inline Demo video artifact holds no playable <video>", "found": page.evaluate(ART)})
    page.evaluate("""() => { document.querySelector('[data-testid="walkthrough-video"]').__s15d = 1; }""")

    # ── 1. the preview is the video ─────────────────────────────────────────────
    d0 = page.evaluate(ART)
    page.screenshot(path=str(SHOTS / "desk-demo-video-inline.png"))
    check("preview-is-video",
          d0 is not None and d0["size"] == "inline" and d0["video"] is not None
          and "demo/file?path=demo-video%2Fdemo.mp4" in (d0["video"]["src"] or "") and d0["video"]["ready"] >= 1
          and d0["video"]["hit"] == "video" and d0["video"]["w"] >= 200 and d0["video"]["bottom"] <= H
          and (d0["state"] or "").startswith("✓ Ready to watch · 3 chapters") and d0["seats"] == "codex reviews, claude records"
          and d0["markers"] == ["0", "35", "65"] and not d0["scriptBox"] and not d0["exportBtn"],
          artifact=d0)

    # ── 2. a chapter seeks and becomes the subject ──────────────────────────────
    page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="walkthrough-marker"]').nth(1).click()
    try:
        page.wait_for_function("""() => document.querySelector('[data-testid="walkthrough-video"]').currentTime >= 35""", timeout=5000)
    except Exception:
        fail("chapter-seek", {"why": "chapter 2 did not seek the inline player", "found": page.evaluate(ART)})
    page.evaluate("""() => document.querySelector('[data-testid="walkthrough-video"]').pause()""")
    chips = page.evaluate(CHIPS)
    d1 = page.evaluate(ART)
    check("chapter-is-subject", d1["size"] == "inline" and 35 <= d1["video"]["t"] < 41
          and any(c.startswith("about: chapter 2 · ") for c in chips), chips=chips, t=d1["video"]["t"])

    # ── 3. one player across the morph: the catch opens the pane ────────────────
    page.locator('[data-testid="artifact"][data-kind="demo-video"] [data-testid="artifact-open"]').click()
    page.wait_for_function("""() => (document.querySelector('[data-testid="artifact"][data-kind="demo-video"]')||{}).dataset?.size === 'pane'""", timeout=5000)
    page.wait_for_timeout(700)
    d2 = page.evaluate(ART)
    page.get_by_test_id("walkthrough-narration").locator("summary").click()
    narration = page.get_by_test_id("walkthrough-narration").inner_text()
    page.get_by_test_id("walkthrough-export").click()
    page.get_by_test_id("walkthrough-export-gif").click()
    page.get_by_test_id("walkthrough-download-gif").wait_for(state="visible", timeout=10000)
    gif_href = page.get_by_test_id("walkthrough-download-gif").get_attribute("href") or ""
    gif = fetch_of(gif_href)
    exports = [x["body"] for x in get_json(f"{origin}/__fixture/walkthrough-posts")["posts"] if x["route"] == "export"]
    page.screenshot(path=str(SHOTS / "desk-demo-video-pane.png"))
    check("one-player-and-editor",
          d2["size"] == "pane" and d2["video"] is not None and d2["video"]["marked"] and 35 <= d2["video"]["t"] < 41
          and d2["markers"] == ["0", "35", "65"] and d2["narration"] and d2["exportBtn"]
          and not d2["scriptBox"] and d2["fixed"] == "Fixed when the demo recorded — pick a chapter and ask in the composer for another take."
          and "Run of show" in narration
          and exports == [{"format": "gif"}] and gif[0] == 200 and gif[1] == "image/gif" and gif[2][:6] == b"GIF89a",
          pane={k: d2[k] for k in ("size", "video", "markers", "fixed", "exportBtn")}, exports=exports, gif=gif_href)

    # ── 4. Esc closes the menu, then shrinks back; nothing broke ────────────────
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    d3 = page.evaluate(ART)
    check("back-and-clean", d3["size"] == "inline" and d3["video"] is not None and d3["video"]["marked"] and not d3["hscroll"] and errors == [],
          size=d3["size"], marked=d3["video"]["marked"] if d3["video"] else None, errors=errors[:3])

    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
