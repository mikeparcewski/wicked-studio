#!/usr/bin/env python3
"""
desk_voice_jobs_test.py — "show me this job", then "tell it …" (lane voice-jobs), with a FAKE AUDIO STREAM and a
STUB speech-to-text (as desk_voice: Chromium's fake capture device plays a generated WAV, the real recorder and pause
detector run, the journey answers `POST /voice/transcribe` with the scripted phrase).

  1. ⌥V, "yes", "streaming": full screen.
  2. "Show me the webhook retries job": a large live tile opens on the dashboard: the job's title and state, phase,
     rigor (power, standard), checks (1 of 2 passed · test failed), the newest line it said (unitOutputDelta over
     /ws), its live activity (toolActivity frames over /ws: a running command, an edit), and nothing waiting.
  3. "Tell it to keep the old URL working": a confirm card says exactly what goes where; for 3 s NOTHING is sent.
  4. "Confirm": ONE `POST /runs/b1/inject` with {message: "Keep the old URL working", target: "all", input: "voice"};
     the record says "Sent to … · by voice".
  5. "Show me the other one" swaps the tile; "close it" closes it. Esc leaves. 0 page errors.
  Screens: voice-job-{1440,390}-{dark,light}.png (the tile + the confirm), at 1440x900 and 390x844.

Env: FEEDBACK_PORT (default 4692).
"""

import json
import math
import os
import struct
import sys
import tempfile
import time
import wave

from uxfix_fixture import DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4692"))
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(1)


def fake_audio() -> str:
    """A 48 kHz mono WAV: 1.0 s of a 300 Hz tone, then 1.6 s of quiet (Chromium loops it)."""
    path = os.path.join(tempfile.mkdtemp(prefix="voice-fake-"), "speech.wav")
    rate = 48000
    frames = bytearray()
    for i in range(int(rate * 2.6)):
        v = 0.45 * math.sin(2 * math.pi * 300 * i / rate) if i < rate else 0.0
        frames += struct.pack("<h", int(v * 32767))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path



dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

errors: list[str] = []
sockets: list = []
script: list[str] = []
wavs: list[dict] = []
posts: dict = {"inject": [], "messages": []}
NOW = int(time.time() * 1000)

def run_row(run_id, title, liveness, phase, ord_):
    return {"runId": run_id, "title": title, "status": "executing", "liveness": liveness, "reason": "", "phase": phase, "unitOrd": ord_, "seat": "codex",
            "lastEventAt": None, "evidence": None, "quietForMs": None, "quietAfterMs": 1, "stallAfterMs": 1, "createdAt": None}

SYSTEM = {
    "checkedAt": "2026-10-31T10:00:00Z", "budgetMs": 1, "tookMs": 1, "level": "green", "attention": [], "governance": [],
    "clis": [{"cli": "codex", "label": "Codex", "state": "signed_in", "stateReason": None, "canSignIn": True, "councilEligible": True, "workEligible": True, "version": "1", "versionPin": None, "governanceClass": None, "governanceMode": None, "transport": None, "sandbox": "container", "lastError": None, "stats": None, "details": {}}],
    "runs": [run_row("b1", "Retry failed webhook sends with backoff", "working", "build", 3), run_row("r-dark", "Dark mode for settings", "working", "review", 2)],
    "infra": [{"key": "load", "label": "Load", "state": "ok", "reason": "load 6 on 14 cores", "remedy": None, "checkedAt": "2026-10-31T10:00:00Z", "durationMs": 1, "details": {"load1": 6.1, "cores": 14}}],
}
STATUS = {"local": True, "ready": True, "engine": {"name": "whisper.cpp", "found": True, "path": "/opt/homebrew/bin/whisper-cli", "install": None},
          "model": {"name": "base.en", "present": True, "bytes": 147964211, "approxBytes": 148897792, "source": "huggingface.co/ggerganov/whisper.cpp", "download": None}}
POWER = {"on": True, "available": True, "refusedReason": None, "rigor": "standard", "plan": None, "history": [], "toggles": [],
         "orchestrator": {"cli": "codex", "ord": 3, "turns": 2, "inTurn": True, "sessionRestarts": 0}, "turnLog": [], "checkpoints": 1, "handoff": None, "pause": None, "outcome": None}

def view(run_id):
    power = POWER if run_id == "b1" else None
    return {"run": {"session": {"id": run_id, "workflow_id": "feature", "problem": run_id, "status": "executing", "unit_ix": 1, "clis": ["codex"], "power": power},
                    "units": [{"id": f"{run_id}:plan", "session_id": run_id, "ord": 0, "status": "done", "phase_ref": "plan", "stage": "plan", "description": ""},
                              {"id": f"{run_id}:build", "session_id": run_id, "ord": 3, "status": "distributed", "phase_ref": "build", "stage": "build", "description": ""}]}}

def events(run_id):
    if run_id != "b1":
        return {"runId": run_id, "total": 0, "returned": 0, "events": []}
    ev = [
        {"type": "unitDispatched", "session": "b1", "ord": 3, "attempt": 0, "cli": "codex", "seq": 1, "ts": NOW - 240_000},
        {"type": "repoChecksEvaluated", "session": "b1", "ord": 3, "passed": False, "criterion": "repo checks", "attempt": 0, "skipped": [], "seq": 2, "ts": NOW - 200_000,
         "checks": [{"name": "lint", "argv": ["npm", "run", "lint"], "source": "package.json", "exitCode": 0, "timedOut": False, "spawnError": None, "durationMs": 900},
                    {"name": "test", "argv": ["npm", "test"], "source": "package.json", "exitCode": 1, "timedOut": False, "spawnError": None, "durationMs": 4000}]},
    ]
    return {"runId": run_id, "total": len(ev), "returned": len(ev), "events": ev}


def wav_ok(body: bytes) -> bool:
    return len(body) >= 44 and body[0:4] == b"RIFF" and body[8:12] == b"WAVE"


def route_api(route) -> None:
    req = route.request
    path = req.url.split("?")[0].replace(origin, "")
    j = lambda b, s=200: route.fulfill(status=s, content_type="application/json", body=json.dumps(b))  # noqa: E731
    if path == "/api/v1/voice/status":
        return j(STATUS)
    if path == "/api/v1/voice/transcribe":
        ok = wav_ok(req.post_data_buffer or b"")
        wavs.append(ok)
        return j({"text": script[0] if script and ok else "", "ms": 120, "model": "base.en"})
    if path == "/api/v1/voice/dashboard":
        return j({"layout": None, "widgets": [], "updatedAt": None})
    if path == "/api/v1/system":
        return j(SYSTEM)
    for rid in ("b1", "r-dark"):
        if path == f"/api/v1/runs/{rid}":
            return j(view(rid))
        if path == f"/api/v1/runs/{rid}/events":
            return j(events(rid))
        if path == f"/api/v1/runs/{rid}/inject" and req.method == "POST":
            posts["inject"].append({"run": rid, **json.loads(req.post_data or "{}")})
            return j({"status": "ok"})
    if path == "/api/v1/runs" and req.method == "GET":
        return j({"runs": []})
    return route.fallback()


INIT = """
window.__said = [];
const synth = window.speechSynthesis;
if (synth) { synth.speak = (u) => { window.__said.push(u.text); setTimeout(() => { if (u.onend) u.onend(new Event('end')); }, 30); }; synth.cancel = () => {}; }
"""


def new_page(browser, w: int, h: int, theme: str):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, permissions=["microphone"])
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route_web_socket("**/ws", lambda ws: sockets.append(ws))
    page.route("**/api/v1/**", route_api)
    page.add_init_script(INIT)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    set_fixture(origin, appearance={**DEFAULT_APPEARANCE, "theme": theme})
    return ctx, page


def say(page, words: str, until: str, timeout: int = 15000) -> None:
    script[:] = [words]
    try:
        page.wait_for_function(until, timeout=timeout)
    except Exception:  # noqa: BLE001
        fail(f"heard:{words}", {"until": until, "wavs": wavs[-3:], "lines": page.locator('[data-testid^="voice-line-"]').all_inner_texts()[-4:], "errors": errors[:3]})
    script.clear()


def live_frames() -> None:
    """The job working, over /ws: a command running, an edit done, its newest words."""
    t = int(time.time() * 1000)
    for f in (
        {"type": "toolActivity", "session": "b1", "ord": 3, "id": "c1", "tool": "Bash", "target": "npm test -- webhooks", "state": "started", "ts": t - 20_000},
        {"type": "toolActivity", "session": "b1", "ord": 3, "id": "c2", "tool": "Edit", "target": "src/webhooks/retry.ts", "state": "finished", "ok": True, "ts": t - 50_000},
        {"type": "unitOutputDelta", "session": "b1", "ord": 3, "text": "Reading the retry queue.\nAdding exponential backoff to sendWebhook(), capped at 5 tries.\n"},
    ):
        sockets[-1].send(json.dumps(f))


def enter(page) -> None:
    page.goto(f"{origin}/", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    page.keyboard.press("Alt+KeyV")
    page.locator('[data-testid="voice-modal"]').wait_for(timeout=10000)
    page.wait_for_function("() => document.querySelector('[data-testid=voice-mic-state]')?.textContent.includes('listening only')", timeout=10000)
    say(page, "yes", "() => !!document.querySelector('[data-testid=voice-ask-mode]')")
    say(page, "streaming", "() => document.querySelector('[data-testid=voice-mode]')?.textContent === '● Streaming'")


def shot(page, name: str) -> None:
    page.wait_for_timeout(400)
    page.screenshot(path=str(SHOTS / name))


with sync_playwright() as p:
    SHOTS.mkdir(parents=True, exist_ok=True)
    audio = fake_audio()
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-audio-capture={audio}"])

    ctx, page = new_page(browser, 1440, 900, "dark")
    enter(page)
    check("1-full-screen", page.locator('[data-testid="voice-full"]').count() == 1)
    live_frames()
    say(page, "Show me the webhook retries job.", "() => !!document.querySelector('[data-testid=voice-job]')")
    tile = page.locator('[data-testid="voice-job"]')
    try:
        page.wait_for_function("() => document.querySelector('[data-testid=voice-job-checks]')?.textContent === '1 of 2 passed · test failed'", timeout=10000)
        page.wait_for_function("() => document.querySelector('[data-testid=voice-job-rigor]')?.textContent === 'standard'", timeout=10000)
        page.wait_for_function("() => document.querySelectorAll('[data-testid=voice-job] [data-testid=live-activity-row]').length >= 2", timeout=10000)
    except Exception:  # noqa: BLE001
        fail("2-preview-facts", {"tile": tile.inner_text(), "errors": errors[:3]})
    facts = {k: page.locator(f'[data-testid="voice-job-{k}"]').inner_text() for k in ("title", "phase", "rigor", "checks", "gates", "said")}
    rows = page.locator('[data-testid="voice-job"] [data-testid="live-activity-row"]').all_inner_texts()
    box = tile.bounding_box() or {"width": 0, "height": 0}
    check("2-preview", tile.get_attribute("data-run") == "b1" and "Retry failed webhook sends with backoff" in facts["title"]
          and facts["phase"] == "build" and "capped at 5 tries" in facts["said"] and facts["gates"] == "nothing on you"
          and any("npm test -- webhooks" in r for r in rows) and any("src/webhooks/retry.ts" in r for r in rows)
          and box["width"] >= 340 and box["height"] >= 400, facts=facts, rows=rows, box=box)

    say(page, "Tell it to keep the old URL working.", "() => !!document.querySelector('[data-testid=voice-ask-steer]')")
    q = page.locator('[data-testid="voice-ask-steer"]').inner_text()
    page.wait_for_timeout(3000)
    check("3-confirm-first", "Send to “Retry failed webhook sends with backoff”: “Keep the old URL working”?" in q and posts["inject"] == [], q=q, inject=posts["inject"])
    shot(page, "voice-job-1440-dark.png")
    say(page, "confirm", "() => [...document.querySelectorAll('[data-testid=voice-ask-record]')].some((e) => e.textContent.includes('Sent to Retry failed webhook sends with backoff · by voice'))")
    check("4-sent-by-voice", posts["inject"] == [{"run": "b1", "message": "Keep the old URL working", "target": "all", "input": "voice"}], inject=posts["inject"])

    say(page, "Show me the other one.", "() => document.querySelector('[data-testid=voice-job]')?.dataset.run === 'r-dark'")
    say(page, "Close it.", "() => !document.querySelector('[data-testid=voice-job]')")
    check("5-swap-close", len(posts["inject"]) == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    check("6-esc-leaves", page.locator('[data-testid="voice-full"]').count() == 0)
    ctx.close()

    # ── the look: the tile with its confirm, both themes, both sizes ─────────────────────────────────
    for w, h in ((1440, 900), (390, 844)):
        for theme in ("dark", "light"):
            if (w, theme) == (1440, "dark"):
                continue
            script.clear()
            sockets.clear()
            ctx, page = new_page(browser, w, h, theme)
            enter(page)
            live_frames()
            say(page, "Show me the webhook retries job.", "() => !!document.querySelector('[data-testid=voice-job]')")
            page.wait_for_function("() => document.querySelectorAll('[data-testid=voice-job] [data-testid=live-activity-row]').length >= 1", timeout=10000)
            say(page, "Tell it to keep the old URL working.", "() => !!document.querySelector('[data-testid=voice-ask-steer]')")
            shot(page, f"voice-job-{w}-{theme}.png")
            if w == 390:
                over = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                check(f"look-{w}-{theme}-fits", over <= 1, over=over)
            ctx.close()

    check("7-no-page-errors", errors == [], errors=errors[:5])
    report["ok"] = True
    print(json.dumps(report, indent=2, ensure_ascii=False))
    browser.close()
