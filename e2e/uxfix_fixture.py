#!/usr/bin/env python3
"""
uxfix_fixture.py — the ONE deterministic W2 messy-reality fixture server
(DES-UXFIX-001 §4.2) shared by every uxfix slice rig.

Extracted from uxfix_slice1_test.py / uxfix_slice2_test.py (which previously
each carried a verbatim copy, as the slice-2 verifier flagged): a
ThreadingHTTPServer that serves the `dist-sameorigin/` build (the no-
VITE_API_HOST build — `apiBase()` derives from window.location, so the page,
the API and the `/ws` handshake share ONE origin, no rebuild) plus every
endpoint the home route reads, with all timestamps computed from a single NOW0
captured at import. No crew daemon is involved anywhere.

The dataset is §4.2's rows verbatim, including the two adjacencies the rigs
must not lose:
  - `legacy-spike`: run failed 8 DAYS ago but its project was touched an HOUR
    ago — the R3 trap the `runEvents` backfill exists to defuse;
  - `upload-endpoint`: live, narrating over the rig's own /ws.

Mutable switches (flipped over POST /__fixture between page loads):
  orphan          — whether the orphan run rides the run list (default True)
  q3_gate_age_ms  — the r-q3 gate's receivedAt age (default 30s)
  no_runs         — GET /runs answers [] (slice 5's empty Build state; default False)
  usage_ws        — /ws pushes ONE cliUsage frame for r-upload on connect, so the
                    Build stats footer has real data to gate on (default False)
  long_prompt     — one extra run with a very long problem rides the run list, to
                    prove intent-phrase truncation in pixels (default False)
  extra_narration — a list of strings; each is drained ONCE by the /ws loop as a
                    `unitOutputDelta` for r-upload (default []). The vision-slice-2
                    rig posts one mid-page to prove the live feed updates from the
                    shared store within the 2s AC — a NEW line, not the loop's
                    repeated one.
  demo            — whether q3-review-deck's doc registry carries the recorded
                    `checkout-demo` (kind "demo") plus its spec / recording /
                    frames, so Video mode has a §5.6 surface to render (vision
                    slice 4; default False — the board rigs' doc tiles must not
                    grow a tile they never asserted).
  appearance      — replaces the settings store's `studio.appearance` wholesale
                    (a dict; None restores the tokens.css defaults), so the
                    vision-slice-7 rig can seed a STORED accent/logo/theme
                    between page loads. GET/PUT /api/v1/settings serve the
                    store itself (DES-VISION-001 §3.3).

A rig that never flips them gets the default W2 board.
"""

import base64
import hashlib
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "e2e" / "shots" / "uxfix"
NPM = "npm.cmd" if os.name == "nt" else "npm"

# Same rule as the main harness: gate toasts are not these surfaces (and the
# home route does not render them), but the suppression is cheap and display-only.
HIDE_GATE_TOASTS = '[data-testid="gate-notification"] { display: none !important; }'

# ── The frozen clock (§4.0 determinism): every age derives from this one NOW0 ──
NOW0 = int(time.time() * 1000)
SEC, MIN, HOUR, DAY = 1_000, 60_000, 3_600_000, 86_400_000


def iso(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + f".{ms % 1000:03d}Z"


# Mutable fixture switches, flipped over POST /__fixture between page loads.
state = {"orphan": True, "q3_gate_age_ms": 30 * SEC,
         "no_runs": False, "usage_ws": False, "long_prompt": False,
         "extra_narration": [], "demo": False}
state_lock = threading.Lock()

# ── The crew settings store (DES-VISION-001 §3.3, vision slice 7) ──────────────
#
# The daemon's GET/PUT /api/v1/settings surface reduced to what studio speaks:
# a flat JSON object; PUT merges its body's top-level keys. `studio.appearance`
# is studio's namespaced key — the App startup reads it and applies it as inline
# custom-property overrides on <html>, so EVERY rig's page now GETs this route
# on boot; the defaults below are exactly tokens.css's values, which keeps every
# pre-slice-7 board pixel-identical. The slice-7 rig overwrites the key between
# page loads via POST /__fixture {"appearance": {...}} (None restores defaults)
# and reads back what the page PUT.
DEFAULT_APPEARANCE = {"accent_h": 258, "accent_s": 72, "accent_l": 62,
                      "logo_url": None, "theme": "dark"}
settings_store: dict = {"graphNodeLimit": 150,
                        "studio.appearance": dict(DEFAULT_APPEARANCE)}

# A custom logo asset for the slice-7 rig (§3.1 / EC16): deliberately NON-SQUARE
# (2:1) so contain-fit letterboxing — never stretch, never crop — is provable.
LOGO_TEST_SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32">'
                 b'<rect width="64" height="32" rx="6" fill="#0e7490"/>'
                 b'<circle cx="16" cy="16" r="9" fill="#f8fafc"/>'
                 b'<rect x="30" y="10" width="26" height="12" rx="3" fill="#f8fafc"/></svg>')


def project(pid: str, name: str, updated_at: int, **extra) -> dict:
    return {"id": pid, "name": name, "description": None, "status": "active",
            "scope": f"project:{pid}" if pid != "default" else "",
            "created_at": updated_at, "updated_at": updated_at, **extra}


# §4.2's rows. `legacy-spike`'s project was touched an HOUR ago while its run
# failed 8 DAYS ago — the exact R3 trap the runEvents backfill exists to defuse.
QUIET_CLONES = [project(f"quiet-{i:02d}", f"quiet-clone-{i:02d}", NOW0 - 3 * DAY - i * 7 * HOUR)
                for i in range(20)]
PROJECTS = [
    project("default", "Unfiled", NOW0),  # synthesized — must never render (F5)
    project("legacy-spike", "legacy-spike", NOW0 - HOUR),
    project("upload-endpoint", "upload-endpoint", NOW0),
    project("q3-review-deck", "q3-review-deck", NOW0 - 30 * SEC),
    project("api-migration", "api-migration", NOW0 - 2 * MIN),
    project("auth-refactor", "auth-refactor", NOW0 - 12 * MIN),
    project("smoke-tests", "smoke-tests", NOW0 - 6 * DAY),
    project("notes", "notes", NOW0 - 2 * DAY, interactiveRoot="/tmp/wi-notes"),
    project("scratch", "scratch", NOW0),
] + QUIET_CLONES

MEMBERS = {
    "legacy-spike": ["r-legacy"],
    "upload-endpoint": ["r-upload"],
    "q3-review-deck": ["r-q3"],
    "api-migration": ["r-api"],
    "auth-refactor": ["r-auth"],
    "smoke-tests": ["r-smoke1", "r-smoke2"],
}


def session(rid: str, status: str, problem: str, unit_desc: str) -> dict:
    return {"session": {
        "id": rid, "workflow_id": "wf-w2", "problem": problem, "entity_mode": "shared",
        "collection_scope": None, "clis": ["claude"], "status": status,
        "human_confirm": "all" if status == "awaiting_human" else "none",
        "unit_ix": 0, "attempt": 0, "workdir": None, "repo_ref": None,
        "extra_write_roots": [], "archived_at": None, "archive_note": None,
    }, "units": [{
        "id": f"{rid}:u0", "session_id": rid, "ord": 0, "description": unit_desc,
        "stage": "build", "assigned_cli": None, "assigned_invocation": None,
        "council_task_ref": None, "routing": None, "denial_reason": None,
        "phase_ref": None, "conformance_ref": None, "phase_status": None,
        "collection_scope": None, "status": "pending",
    }]}


RUNS = [
    session("r-q3", "awaiting_human", "make the Q3 review deck", "author the deck outline"),
    session("r-api", "awaiting_human", "migrate the auth tables", "plan the migration"),
    session("r-upload", "executing", "add rate-limiting to the upload endpoint",
            "add rate-limiting to the upload endpoint"),
    session("r-auth", "failed", "refactor the auth middleware", "refactor the auth middleware"),
    session("r-legacy", "failed", "spike the legacy importer", "spike the legacy importer"),
    session("r-smoke1", "completed", "smoke: login flow", "smoke the login flow"),
    session("r-smoke2", "completed", "smoke: checkout flow", "smoke the checkout flow"),
]
ORPHAN = session("r-orphan", "executing", "stranded work from another client",
                 "stranded work from another client")

# The long-prompt run (slice 5, F7): its problem is a full paragraph, so the Build
# runs list must render the INTENT PHRASE (truncated, leading) and never the raw
# prompt string. Rides the list only when the `long_prompt` switch is flipped.
LONG_PROMPT = (
    "refactor the ingestion pipeline so that every incoming webhook payload is "
    "validated against the registered JSON schema, quarantined on mismatch, and "
    "replayed from the dead-letter store once the schema catches up with the producer"
)
LONG_RUN = session("r-long", "executing", LONG_PROMPT, "wire the schema validation")

# The durable-log tails (D3 step 2): the ONE honest clock for a failure's age.
RUN_EVENTS = {
    "r-legacy": [{"type": "sessionStarted", "session": "r-legacy", "ts": NOW0 - 8 * DAY - MIN},
                 {"type": "sessionFailed", "session": "r-legacy", "ts": NOW0 - 8 * DAY}],
    "r-auth": [{"type": "sessionStarted", "session": "r-auth", "ts": NOW0 - 13 * MIN},
               {"type": "sessionFailed", "session": "r-auth", "ts": NOW0 - 12 * MIN}],
}

NOTES_DOCS = [
    {"name": "ideas", "kind": "doc", "head": 1, "versions": 1, "updated_at": iso(NOW0 - 2 * DAY)},
    {"name": "todo", "kind": "doc", "head": 1, "versions": 1, "updated_at": iso(NOW0 - 3 * DAY)},
]

# ── The vision-slice-4 Video surface (DES-VISION-001 §5.6): one recorded demo ──
#
# The interactive bridge, reduced to what Video mode reads through crew's proxy:
# a `kind: "demo"` doc in q3-review-deck's registry, its spec (4 ordered steps —
# the §5.6 wireframe's `1 2 3 4` storyboard), the latest recording (a GIF, so no
# ffmpeg/mp4 machinery is faked), a 1-version manifest, and the frames
# themselves. All behind the `demo` switch so the board rigs' doc tiles never
# grow a tile they did not assert. Frames are drawn lazily with Pillow (already
# a rig prerequisite since vision slice 1) and cached per process.

DEMO_NAME = "checkout-demo"
DEMO_DOC = {"name": DEMO_NAME, "kind": "demo", "head": 1, "versions": 1,
            "updated_at": iso(NOW0 - 5 * MIN)}
DEMO_STEPS = [
    {"index": 0, "title": "Open the storefront", "timestamp": 0,
     "thumbnail": f"/d/{DEMO_NAME}/demo/thumb-0.png"},
    {"index": 1, "title": "Add a hoodie to the cart", "timestamp": 6,
     "thumbnail": f"/d/{DEMO_NAME}/demo/thumb-1.png"},
    {"index": 2, "title": "Enter the card details", "timestamp": 13,
     "thumbnail": f"/d/{DEMO_NAME}/demo/thumb-2.png"},
    {"index": 3, "title": "Confirm the order", "timestamp": 21,
     "thumbnail": f"/d/{DEMO_NAME}/demo/thumb-3.png"},
]
DEMO_SPEC = {"steps": DEMO_STEPS, "target_url": "https://shop.example/"}
DEMO_RECORDING = {"version": 1, "gif_url": f"/d/{DEMO_NAME}/demo/v1.gif"}
DEMO_MANIFEST = {"head": 1, "kind": "demo", "versions": [
    {"version": 1, "parent": None, "feedback_file": None, "html_file": "v1.html",
     "created_at": iso(NOW0 - 5 * MIN), "meta": {}}]}

_demo_frames: dict = {}


def demo_frame(name: str) -> bytes:
    """Draw one demo frame (the recording GIF or a chapter thumbnail) with
    Pillow, lazily, cached. A browser-window pastiche of the recorded shop —
    light, so the player reads as CONTENT against the app's dark chrome."""
    cached = _demo_frames.get(name)
    if cached is not None:
        return cached
    import io

    from PIL import Image, ImageDraw

    if name == "v1.gif":
        w, h = 960, 540
        img = Image.new("RGB", (w, h), (244, 241, 234))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, w, 44], fill=(255, 253, 247), outline=(221, 214, 196))
        for i in range(3):  # traffic lights
            d.ellipse([14 + i * 20, 16, 26 + i * 20, 28], fill=(200, 196, 186))
        d.rounded_rectangle([120, 10, w - 120, 34], radius=12, fill=(238, 234, 224))
        d.text((136, 15), "shop.example / checkout", fill=(120, 116, 106))
        d.text((64, 84), "The Hoodie Shop", fill=(27, 27, 27))
        d.rectangle([64, 130, 448, 420], fill=(255, 253, 247), outline=(221, 214, 196))
        d.rectangle([96, 160, 416, 330], fill=(230, 226, 214))
        d.text((96, 350), "Heavyweight hoodie", fill=(27, 27, 27))
        d.text((96, 372), "$68", fill=(74, 70, 60))
        d.rounded_rectangle([512, 200, 800, 248], radius=8, fill=(27, 98, 74))
        d.text((560, 216), "Add to cart", fill=(255, 255, 255))
        d.text((512, 280), "Step 2 of 4 - adding the hoodie", fill=(120, 116, 106))
        buf = io.BytesIO()
        img.save(buf, format="GIF")
        body = buf.getvalue()
    else:  # thumb-<n>.png
        n = int(name.split("-")[1].split(".")[0])
        img = Image.new("RGB", (296, 168), (244, 241, 234))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, 296, 22], fill=(255, 253, 247), outline=(221, 214, 196))
        d.rectangle([24, 44, 272, 132], fill=(255, 253, 247), outline=(221, 214, 196))
        d.rounded_rectangle([24 + n * 30, 140, 80 + n * 30, 158], radius=6, fill=(27, 98, 74))
        d.text((36, 52), DEMO_STEPS[n]["title"], fill=(27, 27, 27))
        d.text((36, 76), f"step {n + 1}", fill=(120, 116, 106))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        body = buf.getvalue()
    _demo_frames[name] = body
    return body

# The chat surface (slice 4, §2.4): a four-seat roster and instant-warm chat
# endpoints. Seats warm the moment they are asked — determinism over realism —
# and the daemon's real semantics are kept where the client depends on them:
# GET /chats/<id> answers an EMPTY seat list (a 200, not a 404) for a chat this
# fixture has never been told about, which is the "reclaimed" signal the rejoin
# probe distinguishes from an error.
ROSTER = [
    {"key": k, "display_name": k, "binary": k, "enabled_for_council": True}
    for k in ("claude", "codex", "agy", "pi")
]

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
NARRATION = "Writing the token-bucket middleware for /upload"

# ── The slice-6 document surface (DES-UXFIX-001 §2.6): one doc journey, W3-shaped ──
#
# The interactive bridge, reduced to what Document mode reads through crew's proxy:
# preflight, themes, the doc registry, per-doc manifests, the rendered version HTML,
# create/fork/events. State is mutable ON PURPOSE — the slice-6 rig drives the real
# composer (create → generate → continue), and the manifest must grow exactly the way
# the bridge's would: the version's `meta.sourceMessageId` is whatever id the CLIENT
# minted and sent, which is what makes the §7.6 strip→thread scroll assertable.
#
# Bus frames the journey emits ride the same /ws as the board narration, in the relay
# envelope the client folds (`{type:"interactiveEvent", event}`): each POST queues its
# frames and the socket loop drains the queue on its next tick.

THEMES = [{"name": "stripe-ish", "source": "url", "learned_at": iso(NOW0 - 2 * DAY)},
          {"name": "corporate"}]

# The headline the continue "tightens" — v1 verbose, v2+ tight — so the canvas change
# between versions is legible in the screenshots, not just a version number swapping.
HEADLINES = {1: "Q3 was a quarter of significant and wide-ranging positive developments"}
TIGHT_HEADLINE = "Q3: revenue up 18%"

docs_lock = threading.Lock()
# pid -> docId -> [version entries, manifest-shaped]. Grown by create/fork below.
docs_created: dict = {}

ws_lock = threading.Lock()
ws_queue: list = []
# The NEWEST /ws connection owns the one-shot queues. A rig that navigates
# between routes leaves the previous page's handler thread looping until its
# next write raises — and that zombie's drain would STEAL queued frames from
# the live page's socket (it drains before it writes, so the frames die with
# it). Each connection takes a generation number; only the newest drains.
ws_gen = [0]


def queue_interactive(event_type: str, payload: dict) -> None:
    """Queue one relayed interactive frame for the /ws loop's next tick."""
    with ws_lock:
        ws_queue.append({"type": "interactiveEvent",
                         "event": {"event_type": event_type, "payload": payload}})


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "doc"


def doc_versions(pid: str, doc: str) -> list:
    with docs_lock:
        return list(docs_created.get(pid, {}).get(doc, []))


def doc_html(doc: str, version: int) -> str:
    """The rendered document at one version — a light deck slide, so the canvas reads
    as a document against the app chrome and the v1→v2 headline change is visible."""
    headline = HEADLINES.get(version, TIGHT_HEADLINE)
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{doc} v{version}</title>
<style>body{{margin:0;font-family:Georgia,serif;background:#f4f1ea;color:#1b1b1b;
display:flex;align-items:center;justify-content:center;height:100vh}}
main{{max-width:720px;padding:48px;background:#fffdf7;border:1px solid #ddd6c4;
box-shadow:0 2px 18px rgba(0,0,0,.12)}}h1{{font-size:34px;line-height:1.2;margin:0 0 18px}}
p{{font-size:16px;color:#4a463c;margin:0 0 8px}}footer{{margin-top:26px;font-size:11px;
color:#8a8471;letter-spacing:.08em;text-transform:uppercase}}</style></head><body>
<main data-wid="slide-1"><h1 data-wid="headline">{headline}</h1>
<p>Pipeline grew in every segment; churn held under 2%.</p>
<p>Focus for Q4: enterprise onboarding and the pricing revamp.</p>
<footer>Q3 review deck · version {version}</footer></main></body></html>"""


def ws_frame(payload: dict) -> bytes:
    data = json.dumps(payload).encode()
    if len(data) < 126:
        head = bytes([0x81, len(data)])
    else:
        head = bytes([0x81, 126]) + len(data).to_bytes(2, "big")
    return head + data


class W2Handler(SimpleHTTPRequestHandler):
    """SPA + the whole /api/v1 surface the home route reads + /ws, one origin."""

    def log_message(self, *_args):  # keep stdout JSON-clean
        pass

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _ws(self) -> None:
        """Accept the upgrade, then stream `unitOutputDelta` frames for the live
        run — `useRuns` gates its first fetch on a connected socket, so the
        handshake is mandatory, and the narration keeps the headline honest."""
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.wfile.write(
            ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
             f"Connection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        self.wfile.flush()
        with state_lock:
            push_usage = state["usage_ws"]
        with ws_lock:
            ws_gen[0] += 1
            my_gen = ws_gen[0]
        try:
            # Slice-5 switch: the Build stats footer folds cliUsage events, so the
            # frame is pushed ONCE per connection (never in the loop — a repeated
            # cliUsage would compound the totals).
            if push_usage:
                self.wfile.write(ws_frame({
                    "type": "cliUsage", "session": "r-upload", "ord": 0,
                    "inputTokens": 84000, "outputTokens": 14000, "costUsd": 0.42,
                }))
                self.wfile.flush()
            while True:
                # Drain the one-shot queues ONLY as the newest connection (see
                # ws_gen above) — a superseded handler keeps streaming the
                # narration loop until its socket dies, but must not steal
                # frames meant for the live page.
                with ws_lock:
                    newest = ws_gen[0] == my_gen
                # Drain the interactive frames the document journey queued (slice 6) —
                # the client folds them into the doc thread off this one subscription.
                pending: list = []
                if newest:
                    with ws_lock:
                        pending, ws_queue[:] = list(ws_queue), []
                for frame in pending:
                    self.wfile.write(ws_frame(frame))
                # Drain any one-shot narration lines a rig posted mid-page (vision
                # slice 2: prove a NEW delta reaches the live feed within 2s).
                extra: list = []
                if newest:
                    with state_lock:
                        extra, state["extra_narration"] = list(state["extra_narration"]), []
                for line in extra:
                    self.wfile.write(ws_frame({
                        "type": "unitOutputDelta", "session": "r-upload", "ord": 0,
                        "text": str(line) + "\n",
                    }))
                self.wfile.write(ws_frame({
                    "type": "unitOutputDelta", "session": "r-upload", "ord": 0,
                    "text": NARRATION + "\n",
                }))
                self.wfile.flush()
                time.sleep(1.0)
        except OSError:
            pass
        self.close_connection = True

    def _api(self, path: str) -> bool:
        if path == "/api/v1/health":
            self._json(200, {"status": "ok", "version": "w2-fixture", "ping": "pong"})
            return True
        # The settings store (§3.3): every page boot GETs it for studio.appearance.
        if path == "/api/v1/settings":
            with state_lock:
                snapshot = json.loads(json.dumps(settings_store))
            self._json(200, {"settings": snapshot})
            return True
        # The slice-7 rig's custom-logo asset (served same-origin, §3.1).
        if path == "/__assets/logo-test.svg":
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(LOGO_TEST_SVG)))
            self.end_headers()
            self.wfile.write(LOGO_TEST_SVG)
            return True
        if path == "/api/v1/runs":
            with state_lock:
                if state["no_runs"]:
                    runs = []
                else:
                    runs = RUNS + ([ORPHAN] if state["orphan"] else []) \
                        + ([LONG_RUN] if state["long_prompt"] else [])
            self._json(200, {"runs": runs})
            return True
        if path == "/api/v1/projects":
            self._json(200, {"projects": PROJECTS})
            return True
        if path == "/api/v1/repos":
            self._json(200, {"repos": []})
            return True
        if path == "/api/v1/roster":
            self._json(200, {"roster": ROSTER})
            return True
        # /api/v1/chats/<id> — seats of a chat. Empty for a chat we never opened
        # (the daemon does not 404 an unknown id; empty means reclaimed/none).
        if path.startswith("/api/v1/chats/") and len(path.split("/")) == 5:
            self._json(200, {"chatId": urllib.parse.unquote(path.split("/")[4]), "seats": []})
            return True
        parts = path.split("/")
        # /api/v1/projects/<id>/members
        if len(parts) == 6 and parts[3] == "projects" and parts[5] == "members":
            pid = urllib.parse.unquote(parts[4])
            self._json(200, {"members": [
                {"id": f"{pid}:crew.run:{ref}", "project_id": pid, "member_kind": "crew.run",
                 "member_ref": ref, "meta": None, "attached_at": 1, "attached_by": "studio"}
                for ref in MEMBERS.get(pid, [])
            ]})
            return True
        # /api/v1/projects/<id>/interactive/api/docs — the registry: the notes seeds
        # plus whatever the slice-6 journey has created in this server's lifetime.
        if path.startswith("/api/v1/projects/") and path.endswith("/interactive/api/docs"):
            pid = urllib.parse.unquote(path.split("/")[4])
            with docs_lock:
                created = [
                    {"name": doc, "kind": "doc", "head": max(e["version"] for e in vs),
                     "versions": len(vs), "updated_at": vs[-1]["created_at"]}
                    for doc, vs in docs_created.get(pid, {}).items()
                ]
            with state_lock:
                demo_on = state["demo"]
            seeds = NOTES_DOCS if pid == "notes" else []
            if demo_on and pid == "q3-review-deck":
                seeds = seeds + [DEMO_DOC]
            self._json(200, seeds + created)
            return True
        # The rest of the interactive surface the Document journey reads (slice 6).
        if self._interactive_get(path):
            return True
        # /api/v1/runs/<id>/gate
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "gate":
            rid = urllib.parse.unquote(parts[4])
            if rid == "r-q3":
                with state_lock:
                    age = state["q3_gate_age_ms"]
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "Approve the deck outline?",
                                 "receivedAt": iso(NOW0 - age)})
            elif rid == "r-api":
                # `options: null` = free text ⇒ the COMPLEX gate shape (§7.11).
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "How should the tables move?",
                                 "receivedAt": iso(NOW0 - 2 * MIN), "options": None})
            else:
                self._json(404, {"error": f"no gate cached for {rid}"})
            return True
        # /api/v1/runs/<id>/events
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "events":
            rid = urllib.parse.unquote(parts[4])
            self._json(200, {"events": RUN_EVENTS.get(rid, [])})
            return True
        if path.startswith("/api/v1/"):
            self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            return True
        return False

    def _interactive_get(self, path: str) -> bool:
        """GET half of the slice-6 bridge surface (DES-UXFIX-001 §2.6)."""
        # /api/v1/projects/<pid>/interactive/api/preflight — all deps present.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/preflight$", path)
        if m:
            self._json(200, {"deps": []})
            return True
        # /api/v1/projects/<pid>/interactive/api/themes — the library (§4.6).
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/themes$", path)
        if m:
            self._json(200, {"themes": THEMES})
            return True
        # /api/v1/projects/<pid>/interactive/d/<doc>/api/versions — the manifest.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/versions$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            with state_lock:
                demo_on = state["demo"]
            if demo_on and doc == DEMO_NAME:
                self._json(200, DEMO_MANIFEST)
                return True
            versions = doc_versions(pid, doc)
            if not versions:
                self._json(404, {"error": f"no versions for {doc}"})
                return True
            self._json(200, {"head": max(e["version"] for e in versions),
                             "kind": "doc", "versions": versions})
            return True
        # The vision-slice-4 demo surface (§5.6), behind the `demo` switch:
        # spec, latest recording, and the frames the recording/storyboard show.
        m = re.match(
            r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/demo/(spec|recordings)$", path)
        if m:
            with state_lock:
                demo_on = state["demo"]
            if not demo_on or urllib.parse.unquote(m.group(2)) != DEMO_NAME:
                self._json(404, {"error": f"no demo at {path}"})
                return True
            self._json(200, DEMO_SPEC if m.group(3) == "spec" else DEMO_RECORDING)
            return True
        m = re.match(
            r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/demo/(v1\.gif|thumb-[0-3]\.png)$",
            path)
        if m:
            body = demo_frame(m.group(3))
            self.send_response(200)
            self.send_header(
                "Content-Type", "image/gif" if m.group(3).endswith(".gif") else "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True
        # /api/v1/projects/<pid>/interactive/d/<doc>/doc/<v> — the rendered document.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/doc/(\d+)$", path)
        if m:
            doc = urllib.parse.unquote(m.group(2))
            body = doc_html(doc, int(m.group(3))).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True
        return False

    def _interactive_post(self, path: str, body: dict) -> bool:
        """POST half: create / fork / the UI-originated bus emit. Each one commits the
        manifest move FIRST and then queues the frames the bridge would emit, so the
        client's next read is never behind the event that announced it."""
        # POST /api/v1/projects/<pid>/interactive/api/docs — create (§2.2 case 1).
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/docs$", path)
        if m:
            pid = urllib.parse.unquote(m.group(1))
            doc = slug(str(body.get("name") or "doc"))
            anchor = body.get("source_message_id")
            with docs_lock:
                docs_created.setdefault(pid, {})[doc] = [
                    {"version": 1, "parent": None, "feedback_file": None,
                     "html_file": "v1.html", "created_at": iso(NOW0),
                     "meta": {"sourceMessageId": anchor}}]
            queue_interactive("wicked.interactive.status.posted", {
                "project_id": pid, "document_id": doc, "state": "working",
                "message": "Planning the deck — outline first, then the slides."})
            queue_interactive("wicked.interactive.version.created", {
                "project_id": pid, "document_id": doc,
                "version": 1, "parent": None, "kind": "generated"})
            self._json(201, {"name": doc, "head": 1, "generating": True, "project_id": pid})
            return True
        # POST /api/v1/projects/<pid>/interactive/d/<doc>/api/fork — branch (§7.10).
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/fork$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            frm = int(body.get("from") or 0)
            with docs_lock:
                versions = docs_created.get(pid, {}).get(doc)
                if versions is None:
                    self._json(404, {"error": f"no such doc {doc}"})
                    return True
                v = max(e["version"] for e in versions) + 1
                versions.append(
                    {"version": v, "parent": frm, "feedback_file": None,
                     "html_file": f"v{v}.html", "created_at": iso(NOW0 + v * SEC),
                     "meta": {"sourceMessageId": body.get("source_message_id")}})
            self._json(200, {"version": v, "parent": frm})
            return True
        # POST /api/v1/projects/<pid>/interactive/api/events — the inject wire (§5.4).
        # A chat.posted steer regenerates the doc's head version: narrate, then land it.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/events$", path)
        if m:
            pid = urllib.parse.unquote(m.group(1))
            payload = body.get("payload") or {}
            doc = payload.get("document_id")
            if body.get("event_type") == "wicked.interactive.chat.posted" and doc:
                versions = doc_versions(pid, doc)
                head = max((e["version"] for e in versions), default=1)
                queue_interactive("wicked.interactive.status.posted", {
                    "project_id": pid, "document_id": doc, "state": "working",
                    "message": "Tightening the headline and rebalancing the slide."})
                queue_interactive("wicked.interactive.version.created", {
                    "project_id": pid, "document_id": doc,
                    "version": head, "parent": head - 1 if head > 1 else None,
                    "kind": "generated"})
            self._json(200, {"ok": True, "event_id": "evt-fixture", "correlation_id": "c-fixture"})
            return True
        return False

    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self.headers.get("Upgrade", "").lower() == "websocket":
            return self._ws()
        path = urllib.parse.urlparse(self.path).path
        if self._api(path):
            return None
        if not Path(self.translate_path(self.path)).is_file():
            self.path = "/index.html"  # client-side routes resolve to the shell
        return super().do_GET()

    def do_POST(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if path == "/__fixture":
            with state_lock:
                # `appearance` rides the same control channel but lands in the
                # settings store: a dict replaces studio.appearance wholesale,
                # None restores the defaults (vision slice 7).
                if "appearance" in body:
                    settings_store["studio.appearance"] = (
                        dict(DEFAULT_APPEARANCE) if body["appearance"] is None
                        else body["appearance"])
                state.update({k: v for k, v in body.items() if k in state})
                snapshot = dict(state)
            return self._json(200, {"ok": True, "state": snapshot})
        # The slice-6 document journey's writes (create / fork / bus emit).
        if self._interactive_post(path, body if isinstance(body, dict) else {}):
            return None
        # POST /api/v1/chats — open a chat: warm the asked-for seats (or the whole
        # roster when `clis` is omitted, matching the daemon), every seat ok, instantly.
        if path == "/api/v1/chats":
            clis = body.get("clis") or [s["key"] for s in ROSTER]
            return self._json(201, {
                "chatId": body.get("chatId") or "fixture-chat",
                "seats": [{"cliKey": k, "ok": True} for k in clis],
            })
        # POST /api/v1/chats/<id>/messages — accept the fan-out; replies would
        # stream over /ws, which this fixture leaves to the narration loop.
        parts = path.split("/")
        if len(parts) == 6 and parts[3] == "chats" and parts[5] == "messages":
            return self._json(200, {"seats": []})
        return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})

    def do_PUT(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        # PUT /api/v1/settings — merge the body's top-level keys, answer the
        # merged store (the daemon's contract; studio.appearance replaces whole).
        if path == "/api/v1/settings":
            with state_lock:
                if isinstance(body, dict):
                    settings_store.update(body)
                snapshot = json.loads(json.dumps(settings_store))
            return self._json(200, {"settings": snapshot})
        return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})

    def do_DELETE(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/v1/chats/"):
            return self._json(200, {"ok": True})
        return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})


def ensure_build(fail) -> Path:
    """The same-origin build (shared across the rigs — same dist dir).
    `fail(step, why)` is the calling rig's reporter; SKIP_STUDIO_BUILD=1 skips."""
    dist = REPO / "dist-sameorigin"
    if os.environ.get("SKIP_STUDIO_BUILD") == "1":
        if not (dist / "index.html").is_file():
            fail("build", f"SKIP_STUDIO_BUILD=1 but {dist}/index.html is missing — "
                 "build it with `npx vite build --outDir dist-sameorigin` (no VITE_API_HOST)")
    elif not (dist / "index.html").is_file():
        env = dict(os.environ, VITE_API_HOST="")
        r = subprocess.run(
            [NPM, "exec", "--", "vite", "build", "--outDir", "dist-sameorigin", "--emptyOutDir"],
            cwd=REPO, env=env, capture_output=True, text=True, timeout=600,
        )
        if r.returncode != 0:
            fail("build", f"same-origin vite build failed:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return dist


def start_server(port: int, dist: Path) -> str:
    """Serve `dist` + the fixture API on 127.0.0.1:`port` (daemon thread); returns the origin."""
    httpd = ThreadingHTTPServer(("127.0.0.1", port), partial(W2Handler, directory=str(dist)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}"


def set_fixture(origin: str, **kwargs) -> None:
    """Flip the mutable switches over POST /__fixture between page loads."""
    req = urllib.request.Request(f"{origin}/__fixture", method="POST",
                                 data=json.dumps(kwargs).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        res.read()
