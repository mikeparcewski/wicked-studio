#!/usr/bin/env python3
"""
desk_voice_test.py — voice mode, phase 1 (program DES-VOICE §2a; mockup learn-and-panels state g), with a FAKE AUDIO
STREAM and a STUB speech-to-text:

  - Chromium's fake capture device plays a WAV this journey writes (a 1 s tone, then 1.6 s of quiet, looped), so the
    real `getUserMedia` → AnalyserNode → recorder → pause detector path runs and real 16 kHz WAVs are POSTed.
  - `POST /api/v1/voice/transcribe` is answered here: it checks the body is a RIFF/WAVE 16 kHz mono 16-bit file and
    answers the scripted phrase until its effect shows (or "" while nothing is scripted, which voice ignores).
  - `speechSynthesis.speak` is stubbed to end at once and record what was said (read-aloud is asserted, not heard).
  - `/ws` is played by the journey (a gate arriving, the system chat's reply). `/system`, `/voice/*`, `POST /chats`,
    the chat message and the gate POST are answered here; everything else is the in-process fixture.

  1. ⌥V opens the modal: "Do you want to enter voice mode?", the mic header, a waveform.
  2. A spoken question about voice is answered on screen (privacy), and the question is asked again.
  3. "yes" opens full screen: transcript + six dashboard widgets + "How should I listen?".
  4. "streaming": the badge says ● Streaming; a question goes to the system chat; its reply is captioned and read.
  5. A gate arrives over /ws: it is read out and the Waiting tile pulses; "approve it and ship it" shows a Confirm
     and sends NOTHING; "confirm" starts the 10 s undo; after it the gate POST carries input "voice".
  6. Widgets: remove "Today", add it back from the picker, make a metric widget from /system; PUT /voice/dashboard.
  7. Esc leaves; the overlay is gone. 0 page errors.
  Screens: modal-ask, modal-answer, mode, streaming, gate at 1440x900 and 390x844, dark and light.

Env: FEEDBACK_PORT (default 4691).
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

PORT = int(os.environ.get("FEEDBACK_PORT", "4691"))
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
posts: dict = {"messages": [], "gate": [], "dashboard": [], "chats": []}
dashboard = {"layout": None, "widgets": [], "updatedAt": None}

SYSTEM = {
    "checkedAt": "2026-10-31T10:00:00Z", "budgetMs": 1, "tookMs": 1, "level": "yellow", "attention": [],
    "clis": [
        {"cli": "claude", "label": "Claude Code", "state": "signed_in", "stateReason": None, "canSignIn": True, "councilEligible": True, "workEligible": True, "version": "1", "versionPin": None, "governanceClass": None, "governanceMode": None, "transport": None, "sandbox": "container", "lastError": None, "stats": None, "details": {}},
        {"cli": "codex", "label": "Codex", "state": "signed_in", "stateReason": None, "canSignIn": True, "councilEligible": True, "workEligible": True, "version": "1", "versionPin": None, "governanceClass": None, "governanceMode": None, "transport": None, "sandbox": "container", "lastError": None, "stats": None, "details": {}},
        {"cli": "pi", "label": "Pi", "state": "signed_in", "stateReason": None, "canSignIn": True, "councilEligible": True, "workEligible": True, "version": "1", "versionPin": None, "governanceClass": None, "governanceMode": None, "transport": None, "sandbox": "container", "lastError": None, "stats": None, "details": {}},
    ],
    "runs": [
        {"runId": "b1", "title": "Retry failed webhook sends with backoff", "status": "executing", "liveness": "working", "reason": "", "phase": "review", "unitOrd": 3, "seat": "codex", "lastEventAt": None, "evidence": None, "quietForMs": None, "quietAfterMs": 1, "stallAfterMs": 1, "createdAt": None},
        {"runId": "r-q3", "title": "Make the Q3 review deck", "status": "awaiting_human", "liveness": "waiting_on_you", "reason": "", "phase": "plan", "unitOrd": 0, "seat": None, "lastEventAt": None, "evidence": None, "quietForMs": None, "quietAfterMs": 1, "stallAfterMs": 1, "createdAt": None},
        {"runId": "r-dark", "title": "Dark mode for settings", "status": "executing", "liveness": "working", "reason": "", "phase": "build", "unitOrd": 2, "seat": "claude", "lastEventAt": None, "evidence": None, "quietForMs": None, "quietAfterMs": 1, "stallAfterMs": 1, "createdAt": None},
    ],
    "infra": [
        {"key": "load", "label": "Load", "state": "degraded", "reason": "load 31 on 14 cores", "remedy": None, "checkedAt": "2026-10-31T10:00:00Z", "durationMs": 1, "details": {"load1": 31.2, "cores": 14}},
        {"key": "disk", "label": "Disk", "state": "ok", "reason": "120 GiB free", "remedy": None, "checkedAt": "2026-10-31T10:00:00Z", "durationMs": 1, "details": {"freeBytes": 128849018880}},
        {"key": "estate", "label": "Estate", "state": "ok", "reason": "up", "remedy": None, "checkedAt": "2026-10-31T10:00:00Z", "durationMs": 1, "details": {}},
    ],
    "governance": [],
}
STATUS = {"local": True, "ready": True, "engine": {"name": "whisper.cpp", "found": True, "path": "/opt/homebrew/bin/whisper-cli", "install": None},
          "model": {"name": "base.en", "present": True, "bytes": 147964211, "approxBytes": 148897792, "source": "huggingface.co/ggerganov/whisper.cpp", "download": None}}


def wav_ok(body: bytes) -> dict:
    if len(body) < 44 or body[0:4] != b"RIFF" or body[8:12] != b"WAVE":
        return {"ok": False, "len": len(body)}
    fmt, ch, rate = struct.unpack("<HHI", body[20:28])
    bits = struct.unpack("<H", body[34:36])[0]
    return {"ok": fmt == 1 and ch == 1 and rate == 16000 and bits == 16, "len": len(body), "rate": rate, "ch": ch, "bits": bits}


def route_api(route) -> None:
    req = route.request
    url = req.url
    path = url.split("?")[0].replace(origin, "")
    j = lambda b, s=200: route.fulfill(status=s, content_type="application/json", body=json.dumps(b))  # noqa: E731
    if path == "/api/v1/voice/status":
        return j(STATUS)
    if path == "/api/v1/voice/transcribe":
        info = wav_ok(req.post_data_buffer or b"")
        wavs.append(info)
        # The head of the script answers every recording (a streaming partial and the final one hear the same
        # words) until `say` sees its effect and clears it; then the looped tone hears nothing.
        text = script[0] if script and info["ok"] else ""
        return j({"text": text, "ms": 120, "model": "base.en"})
    if path == "/api/v1/voice/dashboard":
        if req.method == "PUT":
            b = json.loads(req.post_data or "{}")
            posts["dashboard"].append(b)
            dashboard.update(b, updatedAt="now")
        return j(dashboard)
    if path == "/api/v1/system":
        return j(SYSTEM)
    if path == "/api/v1/chats" and req.method == "POST":
        b = json.loads(req.post_data or "{}")
        posts["chats"].append(b)
        return j({"chatId": b.get("chatId"), "seats": [{"cliKey": "claude", "ok": True}], "refused": [], "scope": None}, 201)
    if path.startswith("/api/v1/chats/") and path.endswith("/messages") and req.method == "POST":
        b = json.loads(req.post_data or "{}")
        chat = path.split("/")[4]
        posts["messages"].append({"chat": chat, **b})
        tid = f"t-{len(posts['messages'])}"
        reply = "Two jobs: the webhook retries are in review with Codex, and dark mode is building."
        sockets[-1].send(json.dumps({"type": "chatReply", "chat": chat, "cliKey": "claude", "ok": True, "text": reply, "turn_id": tid}))
        return j({"seats": ["claude"], "turnId": tid})
    if path == "/api/v1/runs/r-q3/gate" and req.method == "POST":
        posts["gate"].append(json.loads(req.post_data or "{}"))
        return j({"status": "executing"})
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
    """Queue the next phrase the stub STT answers, and wait for its effect (a JS predicate)."""
    script[:] = [words]
    try:
        page.wait_for_function(until, timeout=timeout)
    except Exception:  # noqa: BLE001
        fail(f"heard:{words}", {"until": until, "script": script, "wavs": wavs[-3:], "lines": lines(page)})
    script.clear()


def lines(page) -> list[str]:
    return page.locator('[data-testid^="voice-line-"]').all_inner_texts()


def shot(page, name: str) -> None:
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / name))


def open_voice(page) -> None:
    page.goto(f"{origin}/", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    page.keyboard.press("Alt+KeyV")
    page.locator('[data-testid="voice-modal"]').wait_for(timeout=10000)


def stage(page, upto: str, w: int, theme: str) -> None:
    """Drive one page to a moment for its screenshot (the look pass)."""
    open_voice(page)
    page.wait_for_function("() => document.querySelector('[data-testid=voice-mic-state]')?.textContent.includes('listening only')", timeout=10000)
    shot(page, f"voice-modal-ask-{w}-{theme}.png")
    say(page, "What happens to my voice? Is it recorded?", "() => !!document.querySelector('[data-testid=voice-modal-thread]')")
    shot(page, f"voice-modal-answer-{w}-{theme}.png")
    say(page, "yes", "() => !!document.querySelector('[data-testid=voice-ask-mode]')")
    page.locator('[data-testid="voice-widget-builtin.load"]').wait_for(timeout=10000)
    shot(page, f"voice-mode-{w}-{theme}.png")
    say(page, "streaming", "() => document.querySelector('[data-testid=voice-mode]')?.textContent === '● Streaming'")
    say(page, "What's running right now?", "() => document.body.innerText.includes('webhook retries are in review')")
    shot(page, f"voice-streaming-{w}-{theme}.png")
    if upto == "streaming":
        return
    sockets[-1].send(json.dumps({"type": "awaitingHuman", "session": "r-q3", "ord": 0, "prompt": "Approve the deck outline?", "ts": int(time.time() * 1000)}))
    page.wait_for_function("() => document.querySelector('[data-testid=\"voice-widget-builtin.gates\"]')?.dataset.alert === 'true'", timeout=10000)
    say(page, "approve it and ship it", "() => !!document.querySelector('[data-testid=voice-ask-gate]')")
    shot(page, f"voice-gate-{w}-{theme}.png")


with sync_playwright() as p:
    SHOTS.mkdir(parents=True, exist_ok=True)
    audio = fake_audio()
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-audio-capture={audio}"])

    # ── the behaviour, at 1440x900 dark ─────────────────────────────────────────────────────────────
    ctx, page = new_page(browser, 1440, 900, "dark")
    open_voice(page)
    modal = page.locator('[data-testid="voice-modal"]')
    box = modal.bounding_box() or {"width": 0, "height": 0}
    check("1-modal", page.get_by_text("Do you want to enter voice mode?").count() > 0
          and 0.28 * 1440 <= box["width"] <= 0.45 * 1440 and box["height"] >= 0.3 * 900
          and page.locator('[data-testid="voice-wave"]').count() == 1, box=box)
    try:
        page.wait_for_function("() => window.__said.includes('Do you want to enter voice mode?')", timeout=10000)
        page.wait_for_function("() => document.querySelector('[data-testid=voice-mic-state]')?.textContent.includes('listening only')", timeout=10000)
    except Exception:  # noqa: BLE001
        fail("1b-asks-aloud-mic-on", {"said": page.evaluate("() => window.__said"), "mic": page.locator('[data-testid="voice-mic-state"]').inner_text(),
                                     "setup": page.locator('[data-testid="voice-setup"]').all_inner_texts(), "errors": errors[:3]})

    say(page, "What happens to my voice? Is it recorded?", "() => !!document.querySelector('[data-testid=voice-modal-thread]')")
    thread = page.locator('[data-testid="voice-modal-thread"]').inner_text()
    page.wait_for_function("() => window.__said.filter((s) => s === 'Do you want to enter voice mode?').length >= 2", timeout=10000)
    check("2-answers-then-asks", "Nothing is recorded or sent anywhere" in thread and len(wavs) >= 1 and all(w["ok"] for w in wavs),
          thread=thread, wavs=wavs[-2:])

    say(page, "yes", "() => !!document.querySelector('[data-testid=voice-ask-mode]')")
    page.locator('[data-testid="voice-widget-builtin.load"]').wait_for(timeout=10000)
    tiles = page.locator('[data-testid^="voice-widget-builtin."]').evaluate_all("(els) => els.map((e) => e.dataset.widget)")
    trans = page.locator('[data-testid="voice-trans"]').bounding_box() or {"width": 0}
    check("3-full-screen", tiles == ["builtin.load", "builtin.health", "builtin.helpers", "builtin.jobs", "builtin.gates", "builtin.spend"]
          and page.get_by_text("How should I listen?").count() > 0 and trans["width"] <= 610, tiles=tiles, trans=trans)

    say(page, "streaming", "() => document.querySelector('[data-testid=voice-mode]')?.textContent === '● Streaming'")
    say(page, "What's running right now?", "() => document.body.innerText.includes('webhook retries are in review')")
    page.wait_for_function("() => window.__said.some((s) => s.includes('webhook retries are in review'))", timeout=10000)
    check("4-streaming-chat", posts["messages"] and posts["messages"][-1]["text"] == "What's running right now?"
          and posts["chats"] and posts["chats"][0].get("scopeKind") == "system", messages=posts["messages"], chats=posts["chats"])

    sockets[-1].send(json.dumps({"type": "awaitingHuman", "session": "r-q3", "ord": 0, "prompt": "Approve the deck outline?", "ts": int(time.time() * 1000)}))
    page.wait_for_function("() => document.querySelector('[data-testid=\"voice-widget-builtin.gates\"]')?.dataset.alert === 'true'", timeout=10000)
    page.wait_for_function("() => window.__said.some((s) => s.includes('is waiting on you'))", timeout=10000)
    say(page, "approve it and ship it", "() => !!document.querySelector('[data-testid=voice-ask-gate]')")
    confirm_q = page.locator('[data-testid="voice-ask-gate"]').inner_text()
    page.wait_for_timeout(3000)
    check("5a-gate-stops-at-confirm", "Heard “approve it and ship it”: Approve" in confirm_q and posts["gate"] == [], q=confirm_q)
    say(page, "confirm", "() => !!document.querySelector('[data-testid=voice-undo]')")
    undo = page.locator('[data-testid="voice-undo"]').inner_text()
    sent_before = list(posts["gate"])
    page.wait_for_timeout(11500)
    rec = page.locator('[data-testid="voice-ask-record"]').last.inner_text()
    check("5b-confirm-undo-send", sent_before == [] and posts["gate"] and posts["gate"][-1].get("input") == "voice"
          and posts["gate"][-1].get("approve") is True and "Approved by you · by voice, confirmed" in rec,
          undo=undo, gate=posts["gate"], record=rec)

    # ── 6. widgets: remove, add back, make one ──────────────────────────────────────────────────────
    page.locator('[data-testid="voice-widget-builtin.spend"]').hover()
    page.locator('[data-testid="voice-widget-remove-builtin.spend"]').click()
    page.wait_for_function("() => !document.querySelector('[data-testid=\"voice-widget-builtin.spend\"]')", timeout=5000)
    removed = posts["dashboard"][-1] if posts["dashboard"] else None
    page.locator('[data-testid="voice-widget-add"]').click()
    picker = page.locator('[data-testid="voice-picker"]')
    picker.get_by_text("Today", exact=True).click()
    picker.locator('[data-testid="ask-confirm"]').click()
    page.locator('[data-testid="voice-widget-builtin.spend"]').wait_for(timeout=5000)
    page.locator('[data-testid="voice-widget-add"]').click()
    page.locator('[data-testid="voice-make-widget"]').click()
    page.locator('[data-testid="voice-builder-filter"]').fill("freeBytes")
    page.locator('[data-testid="voice-builder-field"]').select_option("infra[key=disk].details.freeBytes")
    page.locator('[data-testid="voice-builder-title"]').fill("Disk free")
    page.locator('[data-testid="voice-builder-chart"]').check()
    shot(page, "voice-builder-1440-dark.png")
    page.locator('[data-testid="voice-builder-save"]').click()
    page.locator('[data-testid="voice-widget-user.disk-free"]').wait_for(timeout=5000)
    made = page.locator('[data-testid="voice-widget-user.disk-free"]').inner_text()
    shot(page, "voice-widgets-1440-dark.png")
    last = posts["dashboard"][-1] if posts["dashboard"] else {}
    check("6-widgets", removed is not None and "builtin.spend" not in removed["layout"]
          and last.get("layout", [None])[-1] == "user.disk-free"
          and last["widgets"][0]["panels"][0]["slot"] == "voice-dashboard" and "128.8G" in made,
          removed=removed, last=last, made=made)

    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    check("7-esc-leaves", page.locator('[data-testid="voice-full"]').count() == 0)
    ctx.close()

    # ── the look: four moments in both themes at both sizes ──────────────────────────────────────────
    for w, h in ((1440, 900), (390, 844)):
        for theme in ("dark", "light"):
            script.clear()
            sockets.clear()
            dashboard.update(layout=None, widgets=[], updatedAt=None)
            ctx, page = new_page(browser, w, h, theme)
            stage(page, "gate", w, theme)
            if w == 390:
                over = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                check(f"look-{w}-{theme}-fits", over <= 1, over=over)
            ctx.close()

    check("8-no-page-errors", errors == [], errors=errors[:5])
    report["ok"] = True
    report["wavs"] = {"count": len(wavs), "all16kMono": all(x["ok"] for x in wavs)}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    browser.close()
