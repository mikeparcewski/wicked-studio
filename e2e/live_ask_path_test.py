#!/usr/bin/env python3
"""
live_ask_path_test.py — ASK-S1/S2 LIVE (DES-ASK-TEAM-CHAT-001 §9 "E2E"; DES-STUDIO-REBUILD-001
Amendment 6) at 1440x700 on the Desk, against a REAL wicked-crew daemon (crew ≥ 0.8.1 on
core-ts ≥ 0.7.38, `capabilities.askPath`) with real CLI seats — not the fixture.

Operator-run (LIVE list, never CI): point it at a running daemon with CREW_ORIGIN (default
http://127.0.0.1:61903); the studio is built once with VITE_API_HOST baked (SKIP_STUDIO_BUILD=1 reuses
dist-live/) and served from a plain static server. One question is asked from the Desk; the session
is read until the primary helper's reply lands (a real model turn — up to ASK_WAIT_S, default 420 s).

It proves, on the real path:
  1. the Desk's ask reaches `POST /chats/:id/messages` → 202 {seats:[pa], turnId, runId, stepId};
  2. ONE voice: exactly one helper bubble on the agent side, the PA's; the who-line names the PA and the
     selection the engine recorded (`path.started{cli, selection}` in GET /runs/:id/team);
  3. the reviewer line ("<seat> is reviewing" or "No reviewer — only <pa> is signed in.") matches
     `member.joined` on the wire;
  4. the turn gate draws nothing: the run waits (`awaiting_human`) and the session reads "waiting", and
     the Desk lists no `gate:<run>` row;
  5. 0 page errors.
Captures: e2e/shots/live-ask-path*.png. Report: JSON on stdout (steps + the wire facts).
"""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CREW_ORIGIN = os.environ.get("CREW_ORIGIN", "http://127.0.0.1:61903")
CREW_HOST = CREW_ORIGIN.split("://", 1)[1]
STUDIO_PORT = int(os.environ.get("STUDIO_PORT", "4479"))
STUDIO_ORIGIN = f"http://127.0.0.1:{STUDIO_PORT}"
ASK_WAIT_S = int(os.environ.get("ASK_WAIT_S", "420"))
QUESTION = os.environ.get("ASK_QUESTION", "In two sentences: what does greet() in proof-scratch do, and does it trim its input?")
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "skin": "desk", "crew": CREW_ORIGIN, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2, default=str))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2, default=str))
        sys.exit(1)


def api(path: str):
    with urllib.request.urlopen(f"{CREW_ORIGIN}/api/v1{path}", timeout=20) as res:
        return json.loads(res.read())


# ── 0. the daemon and its capability ─────────────────────────────────────────────
try:
    health = api("/health")
except Exception as e:  # noqa: BLE001
    fail("daemon", f"{CREW_ORIGIN} did not answer /api/v1/health: {e}")
caps = health.get("capabilities") or {}
check("daemon", caps.get("askPath") is True, version=health.get("version"), capabilities=caps)

# ── 1. build the studio against the daemon (VITE_API_HOST baked), serve it ────────
dist = REPO / "dist-live"
baked = dist / ".vite-api-host"
# A reused build must be the one baked for THIS daemon (the host is compiled into the bundle): no
# marker, or another host → it is rebuilt.
reuse = os.environ.get("SKIP_STUDIO_BUILD") == "1" and (dist / "index.html").is_file() and baked.is_file() and baked.read_text().strip() == CREW_HOST
if os.environ.get("SKIP_STUDIO_BUILD") == "1" and not reuse:
    report["steps"]["studio_build_reuse_refused"] = {"ok": True, "why": "no dist-live/, no .vite-api-host marker, or baked for another daemon — rebuilding"}
if not reuse:
    r = subprocess.run(["npx", "vite", "build", "--outDir", "dist-live", "--emptyOutDir"], cwd=REPO,
                       env=dict(os.environ, VITE_API_HOST=CREW_HOST), capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        fail("studio_build", f"vite build failed:\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")
    baked.write_text(CREW_HOST)
report["steps"]["studio_build"] = {"ok": True, "vite_api_host": CREW_HOST}


class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if not Path(self.translate_path(self.path)).is_file():
            self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *_args):
        pass


httpd = ThreadingHTTPServer(("127.0.0.1", STUDIO_PORT), partial(SpaHandler, directory=str(dist)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []
THREAD = """() => {
  const q = (s) => [...document.querySelectorAll(s)];
  return { order: q('[data-testid="session-turn"], [data-testid="ask-line"], [data-testid="ask-typing"], [data-testid="session-run"]')
             .map((el) => { const t = el.dataset.testid; return t === 'ask-line' ? 'line:' + el.dataset.kind : t === 'session-turn' ? 'turn:' + el.dataset.who + (el.dataset.pending ? ':pending' : '') : t === 'ask-typing' ? 'typing' : 'run'; }),
           lines: q('[data-testid="ask-line"]').map((l) => ({ kind: l.dataset.kind, tone: l.dataset.tone, text: l.innerText.replace(/\\s+/g, ' ').trim() })),
           helperBubbles: q('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').map((b) => b.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160)),
           bubbles: q('[data-testid="session-turn"][data-who="helper"]:not([data-pending])').map((b) => ({ who: (b.querySelector('.wk-session-who') || {}).innerText?.trim() || null, text: (b.querySelector('.wk-session-text') || {}).innerText?.trim() || '' })),
           pending: q('[data-testid="session-turn"][data-who="helper"][data-pending]').length,
           you: q('[data-testid="session-turn"][data-who="you"]').length,
           runs: q('[data-testid="session-run"]').length,
           typing: (document.querySelector('[data-testid="ask-typing"]') || {}).innerText || null,
           shape: (document.querySelector('[data-testid="session-ask-shape"]') || {}).innerText || null,
           older: (document.querySelector('[data-testid="session-ask-older"]') || {}).innerText || null,
           state: (document.querySelector('[data-testid="session"]') || {}).dataset?.state || null,
           hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("window.localStorage.setItem('studio.skin', 'desk');")

    # ── 2. ask from the Desk ──────────────────────────────────────────────────────
    before = {c["chatId"] for c in api("/chats").get("chats", [])}
    page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
    page.get_by_test_id("desk-composer-input").wait_for(state="visible", timeout=30000)
    page.get_by_test_id("desk-composer-input").fill(QUESTION)
    page.get_by_test_id("desk-composer-input").press("Enter")
    chat_id = None
    deadline = time.time() + 60
    while time.time() < deadline and chat_id is None:
        for c in api("/chats").get("chats", []):
            if c["chatId"] not in before:
                chat_id = c["chatId"]
        time.sleep(0.5)
    if chat_id is None:
        page.screenshot(path=str(SHOTS / "live-ask-path-no-chat.png"))
        fail("ask-sent", "no new chat appeared on the daemon within 60 s")
    detail = api(f"/chats/{chat_id}")
    path = detail.get("path")
    check("ask-sent", isinstance(path, dict) and isinstance(path.get("runId"), str), chat=chat_id, path=path)
    run_id = path["runId"]
    report["steps"]["ask-sent"]["seats"] = detail.get("seats")

    # ── 3. the session: one voice, the quiet lines, the turn gate ─────────────────
    page.goto(f"{STUDIO_ORIGIN}/s/{chat_id}", wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=30000)
    page.screenshot(path=str(SHOTS / "live-ask-path-thinking.png"))
    try:
        page.wait_for_function("() => document.querySelectorAll('[data-testid=\"session-turn\"][data-who=\"helper\"]:not([data-pending])').length >= 1", timeout=ASK_WAIT_S * 1000)
    except Exception:
        page.screenshot(path=str(SHOTS / "live-ask-path-no-reply.png"))
        fail("reply", {"thread": page.evaluate(THREAD), "run": api(f"/runs/{run_id}").get("run"), "team": api(f"/runs/{run_id}/team")})
    # Let the relay's chatReply, the transcript re-read and the final pass's rows settle.
    page.wait_for_timeout(4000)
    t = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "live-ask-path-reply.png"))
    team = api(f"/runs/{run_id}/team")
    # The read side splits the path's rows (`rows`) from each unit's (`units[].rows`): gather both.
    rows = list(team.get("rows", [])) + [r for u in team.get("units", []) for r in u.get("rows", [])]
    started = next((r for r in rows if r["event_type"] == "wicked.team.path.started"), None)
    joined = [r for r in rows if r["event_type"] == "wicked.team.member.joined" and r["payload"].get("role") == "monitor"]
    pa = started["payload"]["cli"] if started else None
    selection = started["payload"]["selection"] if started else None
    who = next((l for l in t["lines"] if l["kind"] == "who"), None)
    reviewer = next((l for l in t["lines"] if l["kind"] == "reviewer"), None)
    pick_words = "your pick" if selection == "chosen" else "picked at random"
    # ONE voice: exactly one finished bubble on the agent side, authored by the wire's PA, with words in it.
    bubble = t["bubbles"][0] if t["bubbles"] else {"who": None, "text": ""}
    check("one-voice",
          len(t["bubbles"]) == 1 and bubble["who"] == pa and len(bubble["text"]) > 0
          and t["pending"] == 0 and t["you"] == 1 and t["runs"] == 0 and t["older"] is None
          and who is not None and who["text"] == f"{pa} answers · {pick_words}",
          thread=t, bubble=bubble, path_started=started["payload"] if started else None)
    seat = joined[0]["payload"].get("seat") if joined else None
    status = joined[0]["payload"].get("status") if joined else None
    expected_reviewer = f"{seat} is reviewing" if seat and status == "attached" else f"No reviewer — only {pa} is signed in."
    chat_path = api(f"/chats/{chat_id}").get("path") or {}
    check("reviewer-line", reviewer is not None and reviewer["text"].startswith(expected_reviewer) and chat_path.get("reviewer") == (seat if status == "attached" else None),
          reviewer=reviewer, member_joined=[{k: j["payload"].get(k) for k in ("seat", "status", "role", "error")} for j in joined], chat_path=chat_path)
    run = api(f"/runs/{run_id}")
    view = run.get("run") or run  # the daemon answers `{run: SessionView}`
    check("turn-gate-undrawn", view["session"]["status"] == "awaiting_human" and t["state"] == "waiting",
          run_status=view["session"]["status"], session_state=t["state"])
    # The gate the daemon holds IS the engine's terminal prompt at the answer unit — the words a late
    # join reads back with no kind. Reload the session: the thread must still draw no block for it.
    gate = api(f"/runs/{run_id}/gate")
    answer_ords = sorted({u["ord"] for u in view["units"] if str(u.get("description", "")).startswith("answer-")})
    check("terminal-prompt", gate.get("ord") in answer_ords and str(gate.get("prompt", "")).startswith(f"Approve completion after the final phase (unit {gate.get('ord')})"),
          gate={"ord": gate.get("ord"), "prompt": str(gate.get("prompt", ""))[:120]}, answer_ords=answer_ords)
    page.reload(wait_until="networkidle")
    page.get_by_test_id("session").wait_for(state="visible", timeout=30000)
    page.wait_for_function("() => document.querySelectorAll('[data-testid=\"session-turn\"][data-who=\"helper\"]:not([data-pending])').length >= 1", timeout=30000)
    page.wait_for_timeout(2500)
    t2 = page.evaluate(THREAD)
    page.screenshot(path=str(SHOTS / "live-ask-path-reload.png"))
    bubble2 = t2["bubbles"][0] if t2["bubbles"] else {"who": None, "text": ""}
    check("reload-turn-gate-undrawn", t2["runs"] == 0 and t2["state"] == "waiting" and len(t2["bubbles"]) == 1 and bubble2["who"] == pa and len(bubble2["text"]) > 0,
          thread=t2, bubble=bubble2)
    page.goto(f"{STUDIO_ORIGIN}/", wait_until="networkidle")
    page.get_by_test_id("desk-composer-input").wait_for(state="visible", timeout=30000)
    page.wait_for_timeout(1500)
    # Every row AND every member of every group: a gate folded into "group:approval" must not hide there.
    # Each group is opened by its own toggle and must report itself expanded before the keys are read.
    toggles = page.locator('[data-testid="need-group-toggle"]')
    for i in range(toggles.count()):
        tog = toggles.nth(i)
        if tog.get_attribute("aria-expanded") != "true":
            tog.click(timeout=5000)
        page.wait_for_function("(i) => document.querySelectorAll('[data-testid=\"need-group-toggle\"]')[i]?.getAttribute('aria-expanded') === 'true'", arg=i, timeout=5000)
    page.wait_for_timeout(300)
    keys = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"need-row\"], [data-testid=\"need-member\"]')].map((n) => n.dataset.key)")
    report["steps"]["desk-groups"] = {"ok": True, "groups_opened": toggles.count(), "members": sum(1 for k in keys if k and not k.startswith("group:"))}
    page.screenshot(path=str(SHOTS / "live-ask-path-desk.png"))
    check("no-gate-row", not any(run_id in (k or "") for k in keys), keys=keys)
    check("no-page-errors", errors == [], errors=errors, hscroll=t["hscroll"])
    browser.close()

report["ok"] = True
report["chat"] = chat_id
report["run"] = run_id
print(json.dumps(report, indent=2, default=str))
