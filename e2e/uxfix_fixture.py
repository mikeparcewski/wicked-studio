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
  repo            — whether GET /repos carries the `studio-api` repo plus its
                    graph / git-history / contributors routes (slice E's repo
                    profile visuals; default False). Every field served is on
                    the REAL crew wire: `RepoEntry` verbatim, graph nodes with
                    estate's per-node `lang`, git-history commits dated with
                    git `%ar` RELATIVE strings capped at 20 (routes.ts) —
                    never an absolute date or a language field the daemon
                    does not serve.
  metrics_ws      — /ws drips ONE cliUsage frame per loop tick until the
                    5-frame burn drains (slice E's token-burn tile; default
                    False). Same real frame shape as usage_ws; drip-fed so
                    the cumulative fold has more than one arrival instant.
  river           — the DES-FEEDBACK-003 §10.2 "24h-spread activity" variant
                    for slice Q's landing river: the members wire serves
                    SPREAD attach clocks (r-upload live 20h ago, r-auth 6h,
                    the smokes 16h/10h — all inside the window), r-auth's
                    durable tail moves its failure to 5h ago, and /ws pushes
                    ONE `wicked.interactive.version.created` frame for
                    q3-review-deck on connect (the doc-landed river mark).
                    Default False — every standing rig keeps the W2 clocks.
  chat_runs       — 2 chat runs ride GET /runs (DES-FEEDBACK-003 §10.2): a
                    'chat'-stamped live thread (crew.chat member of notes,
                    real attach clock) and a legacy unstamped thread awaiting
                    a human with a cached gate but no membership (default
                    False — the slice-P /chats dashboard rig's partition +
                    unplaced-honesty cases).
  repo_refs       — r-upload / r-auth / r-smoke1 gain repo_ref "studio-api"
                    on the runs wire (flip `repo` on with it; default False —
                    the slice-P /repos tiles' grouping cases).
  repo_member     — upload-endpoint gains ONE `crew.repo` member (studio-api)
                    on the members wire (DES-FEEDBACK-002 §10.2 — the slice-J
                    dashboard bound-repos row; flip `repo` on with it so the
                    name resolves from the palette cache; default False).
  learn_delay_s   — how long after a successful theme.requested the learned
                    tokens ripen into GET /d/<doc>/api/theme/learned
                    (interactive#181; default 0.75 — long enough for the
                    brand-learn rig to witness the 404→200 transition).
  reset_learn     — POST {"reset_learn": true} clears all learned-theme
                    readback state (back to the 404).
  batch_gates     — two extra projects (batch-one/batch-two) each with one
                    awaiting_human SIMPLE-gate run ride /projects, /runs,
                    members and the cached-gate GET (slice L §9.5's "3 simple
                    gates" board, with r-q3, beside the complex r-api).
                    Default False.
  gate_409        — run ids whose POST /runs/:id/gate answers the daemon's
                    real 409 "not awaiting a human gate" (slice L's partial-
                    failure case). Default [].
  extra_gates     — a list of {session, ord?, prompt?}; each is drained ONCE
                    by the /ws loop as an `awaitingHuman` frame (slice L §8.4:
                    a gate ARRIVAL, the desktop-notification trigger).
  notif_prefs     — replaces the settings store's `studio.notifications`
                    (a dict; None REMOVES the key — the never-persisted
                    default case), same channel as `appearance`.
  forensics       — the slice-R failure-forensics corpus (DES-UX-001 §1):
                    r-auth (failed 13m ago) gains TWO real-shape units — a
                    `done` survey with a captured transcript served on the
                    REAL `GET /runs/:id/units/:unitKey/output` wire (its
                    markdown cites /w2/auth-evidence/NOTES.md, served on the
                    files route via the run's `extra_write_roots`) and a
                    `rejected` review whose output route answers the daemon's
                    honest `outputUnavailable` — plus a `gateEvaluated` deny
                    (agentVerdict/agentReasoning/denialReason, and
                    `evaluatorPass: true` beside EMPTY `evaluatorPolicies` —
                    the FINDING-025 vacuous default-allow) in its durable
                    event tail. r-auth stays workdir-less, so its /diff
                    answers the REAL 409 "has no workdir" (the named-cause
                    case). r-legacy (failed 8 DAYS ago) keeps a tail with NO
                    `gateEvaluated` (the retention empty state) and its
                    /diff HANGS without answering (the zero-request-hang
                    regression trap — the client must still have dispatched
                    ≥1 fetch and reach its own timeout branch). Both failed
                    runs gain one `dataUsed` file so the Files panel offers
                    [Full diff]. Default False.

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
         "extra_narration": [], "demo": False,
         "repo": False, "metrics_ws": False,
         # Slice P (DES-FEEDBACK-003 §10.2 fixture additions, switch-gated so
         # no standing rig's board grows rows it never asserted):
         #   chat_runs — 2 chat runs ride GET /runs: one 'chat'-stamped live
         #               thread (a notes member, real attach clock) and one
         #               legacy UNSTAMPED thread awaiting a human with a
         #               cached gate but no membership (the unplaced-honesty
         #               case). Default False.
         #   repo_refs — r-upload / r-auth / r-smoke1 gain repo_ref
         #               "studio-api" (flip `repo` on with it so the id
         #               resolves), giving §4.4's runs-per-repo / failing-
         #               repos tiles something true to group. Default False.
         "chat_runs": False, "repo_refs": False,
         # Slice J (DES-FEEDBACK-002 §10.2): upload-endpoint gains ONE
         # crew.repo member (studio-api) on the members wire — the dashboard's
         # bound-repos row corpus. Switch-gated so no standing rig's member
         # list grows a kind it never asserted. Default False.
         "repo_member": False,
         # Slice Q (DES-FEEDBACK-003 §10.2): the 24h-spread river variant.
         "river": False,
         # Slice I (DES-FEEDBACK-002 §3): the in-studio file/diff viewer corpus.
         #   viewer      — r-upload gains a workdir + file events, and the crew#305
         #                 routes (GET /runs/:id/files, GET /runs/:id/diff) answer
         #                 with the REAL contract shapes (default False).
         #   file_routes — when False the two routes answer Fastify's DEFAULT
         #                 unknown-route 404 body (a daemon predating crew#305),
         #                 so the rig can prove the studio's openPath fallback.
         "viewer": False, "file_routes": True,
         # theme-learn readback (interactive#181): how long after a successful
         # theme.requested the learned tokens become readable (the 404→200
         # ripening the studio poll rides). reset_learn clears learned state.
         "learn_delay_s": 0.75,
         # Slice K (DES-FEEDBACK-002 §6): the multi-agent chat-reply drip.
         # When on, POST /chats/<id>/messages queues one REAL chatReply frame
         # per warm seat over /ws (the daemon's fan-out shape: type/chat/
         # cliKey/text/ok), and after the FIRST round one seat dies with a
         # real chatSessionFailed — so round 2's warm set shrinks and the
         # columns grid has a true empty cell to render. Default False: the
         # standing chat rigs (uxfix slice 4, feedback slice C) assert a
         # fan-out with NO replies, and must keep seeing exactly that.
         "chat_replies": False,
         # Slice L (DES-FEEDBACK-002 §9): the batch-gates corpus — two extra
         # projects each holding one awaiting_human SIMPLE-gate run, so the
         # board has §9.5's "3 simple gates" (with r-q3) beside the complex
         # r-api. Switch-gated: no standing rig's board grows cards.
         "batch_gates": False,
         # Slice L (§9.5): run ids whose POST /runs/:id/gate answers the
         # daemon's real 409 ("not awaiting a human gate") — the partial-
         # failure case the batch bar must surface per-id.
         "gate_409": [],
         # Slice L (§8.4): one-shot awaitingHuman frames drained ONCE by the
         # /ws loop (the extra_narration mechanism) — how a rig injects a gate
         # ARRIVAL (the desktop-notification trigger), distinct from the
         # cached-gate GET a page load reconciles.
         "extra_gates": [],
         # Slice R (DES-UX-001 §1): the failure-forensics corpus — see the
         # module docstring. Default False: no standing rig's failed runs
         # change shape.
         "forensics": False}
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
    # q3 carries an interactive root so the slice-D project dashboard's docs
    # tile (root-guarded, exactly like the board's §7.12 guard) lists its
    # registry — which holds the recorded demo when the `demo` switch is on.
    project("q3-review-deck", "q3-review-deck", NOW0 - 30 * SEC, interactiveRoot="/tmp/wi-q3"),
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

# When each run ENTERED its project — `attached_at` on the members wire, the one
# honest per-run clock that route carries (`AgentSession` has no timestamps).
# Real epoch-ms so the slice-D dashboard's 7-day activity window has something
# true to bucket: r-legacy sits OUTSIDE the window (8 days — proves windowing),
# the rest inside it. Everything not named keeps the old inert `1`.
ATTACHED_AT = {
    "r-q3": NOW0 - 30 * SEC,
    "r-api": NOW0 - 2 * MIN,
    "r-upload": NOW0 - HOUR,
    "r-auth": NOW0 - 13 * MIN,
    "r-legacy": NOW0 - 8 * DAY,
    "r-smoke1": NOW0 - 6 * DAY,
    "r-smoke2": NOW0 - 6 * DAY,
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

# ── Slice P (DES-FEEDBACK-003 §10.2): the two chat runs, behind `chat_runs` ───
#
# The /chats dashboard's partition + honesty cases: CHAT_LIVE is a
# 'chat'-stamped live thread attached to `notes` (a real clock for the
# chats-over-time tile); CHAT_GATED is a legacy thread with NO workflow stamp
# (isChatRun's other arm) awaiting a human — it has a cached gate but no
# membership, so it is the tile's honest UNPLACED count, while its gate still
# lands on the gates-from-chats tile.
CHAT_LIVE = session("r-chat-live", "executing",
                    "talk through the uploader design", "chat turn")
CHAT_LIVE["session"]["workflow_id"] = "chat"
CHAT_GATED = session("r-chat-gated", "awaiting_human",
                     "which auth flow should we take?", "chat turn")
CHAT_GATED["session"]["workflow_id"] = None
CHAT_GATE_PROMPT = "Pick the auth flow the chat should explore"
ATTACHED_AT["r-chat-live"] = NOW0 - 10 * MIN

# ── Slice Q (DES-FEEDBACK-003 §10.2): the 24h-spread river clocks ─────────────
#
# Served on the MEMBERS wire only while the `river` switch is on: observed
# activity spread across the window so the lanes have a picture — one live run
# spanning 20h and breaching "now" (r-upload), one failure at 6h→5h (r-auth,
# tail below), and the two completed smokes inside the window (the lede's
# "passed" counts). r-legacy stays 8 DAYS out — the entirely-outside case.
RIVER_ATTACHED_AT = {
    "r-upload": NOW0 - 20 * HOUR,
    "r-auth": NOW0 - 6 * HOUR,
    "r-smoke1": NOW0 - 16 * HOUR,
    "r-smoke2": NOW0 - 10 * HOUR,
}
RIVER_AUTH_EVENTS = [
    {"type": "sessionStarted", "session": "r-auth", "ts": NOW0 - 6 * HOUR},
    {"type": "sessionFailed", "session": "r-auth", "ts": NOW0 - 5 * HOUR},
]

# ── Slice L (DES-FEEDBACK-002 §9): the batch-gates corpus, behind `batch_gates` ──
#
# Two extra projects, each with one awaiting_human run whose cached gate is
# SIMPLE (no options field — the plain workflow gate), giving the board three
# simple-gate needs-you cards (with r-q3) beside the complex r-api: §9.5's
# fixture shape. Gate ages differ so the attention order is deterministic.
BATCH_PROJECTS = [
    project("batch-one", "batch-one", NOW0 - MIN),
    project("batch-two", "batch-two", NOW0 - 3 * MIN),
]
BATCH_RUNS = [
    session("r-batch1", "awaiting_human", "bump the API version", "bump the API version"),
    session("r-batch2", "awaiting_human", "rotate the staging keys", "rotate the staging keys"),
]
BATCH_MEMBERS = {"batch-one": ["r-batch1"], "batch-two": ["r-batch2"]}
BATCH_GATE_PROMPTS = {"r-batch1": ("Ship the version bump?", MIN),
                      "r-batch2": ("Rotate the keys now?", 3 * MIN)}
ATTACHED_AT["r-batch1"] = NOW0 - MIN
ATTACHED_AT["r-batch2"] = NOW0 - 3 * MIN

# Slice P: which runs the `repo_refs` switch stamps onto the registered repo —
# a live one and a 6-day-old one for the 7d grouping, plus a fresh failure for
# the 24h hotspot tile. Clocks are the ATTACHED_AT ones already served above.
REPO_REF_RUNS = {"r-upload", "r-auth", "r-smoke1"}

# The long-prompt run (slice 5, F7): its problem is a full paragraph, so the Build
# runs list must render the INTENT PHRASE (truncated, leading) and never the raw
# prompt string. Rides the list only when the `long_prompt` switch is flipped.
LONG_PROMPT = (
    "refactor the ingestion pipeline so that every incoming webhook payload is "
    "validated against the registered JSON schema, quarantined on mismatch, and "
    "replayed from the dead-letter store once the schema catches up with the producer"
)
LONG_RUN = session("r-long", "executing", LONG_PROMPT, "wire the schema validation")

# ── The slice-I viewer corpus (DES-FEEDBACK-002 §3, crew#305) ─────────────────
#
# Behind the `viewer` switch. Everything below speaks the REAL crew wire:
# `RunFileContent` / `RunDiff` verbatim (wicked-crew-api-types 0.7.0), the
# routes' exact error LADDER and strings (routes.ts crew#305): 404 `unknown
# run: <id>` / `no such file: <path>`, 400 non-absolute / repeated `path`,
# 403 outside every allowed root, 409 workdir-less. The diff is a real
# `git diff --no-color --no-ext-diff HEAD` shape including an untracked file
# appended as an all-addition `--no-index` hunk — with one added line whose
# own text begins `++` (so it renders `+++ …`), the adversarial case the
# studio's stateful classifier must color as an ADDITION, not a header.

VIEWER_WORKDIR = "/w2/upload"
VIEWER_FILE_TS = f"{VIEWER_WORKDIR}/src/middleware.ts"
VIEWER_FILE_BIG = f"{VIEWER_WORKDIR}/src/generated.ts"
VIEWER_FILE_BIN = f"{VIEWER_WORKDIR}/assets/logo.png"
VIEWER_FILE_403 = "/outside/secret.txt"

MIDDLEWARE_TS = """\
// Token-bucket rate limiting for the upload endpoint.
import { TokenBucket } from './bucket.js';

export interface Opts {
  capacity: number;
  refillPerSec: number;
}

export function rateLimit(opts: Opts) {
  const bucket = new TokenBucket(opts);
  return async (req, res, next) => {
    if (!bucket.take(req.ip)) {
      return res.status(429).end();
    }
    next();
  };
}
"""

VIEWER_FILES = {
    VIEWER_FILE_TS: {"path": VIEWER_FILE_TS, "content": MIDDLEWARE_TS,
                     "size": len(MIDDLEWARE_TS.encode()), "truncated": False, "binary": False},
    # >512 KB: `content` holds only the first 512 KB (stood in by a short head
    # here — the CONTRACT fields are what the rig asserts), `size` is the FULL
    # byte count, `truncated: true`.
    VIEWER_FILE_BIG: {"path": VIEWER_FILE_BIG,
                      "content": "// AUTO-GENERATED — first 512 KB of the bundle\n"
                                 + "export const table = [\n" + "  0,\n" * 40,
                      "size": 716800, "truncated": True, "binary": False},
    # NUL in the first 8 KB: `binary: true`, `content: ""` — never mojibake.
    VIEWER_FILE_BIN: {"path": VIEWER_FILE_BIN, "content": "",
                      "size": 20480, "truncated": False, "binary": True},
}

_DIFF_MIDDLEWARE = """\
diff --git a/src/middleware.ts b/src/middleware.ts
index 3f9c2ab..8d41e0f 100644
--- a/src/middleware.ts
+++ b/src/middleware.ts
@@ -10,7 +10,10 @@ export function rateLimit(opts: Opts) {
   const bucket = new TokenBucket(opts);
   return async (req, res, next) => {
-    next();
+    if (!bucket.take(req.ip)) {
+      return res.status(429).end();
+    }
+    next();
   };
 }
"""

# The untracked file appended as an all-addition --no-index hunk (§3.3) — its
# second added line's own text begins "++", so the diff line begins "+++":
# the classifier trap.
_DIFF_UNTRACKED = """\
diff --git a/dev/null b/notes/plan.md
new file mode 100644
index 0000000..9c4e21f
--- /dev/null
+++ b/notes/plan.md
@@ -0,0 +1,3 @@
+rate-limit rollout plan
+++ staged: bucket first, then 429s   <- content starts with ++
+done when p99 < 40ms
"""

VIEWER_DIFF_WHOLE = _DIFF_MIDDLEWARE + _DIFF_UNTRACKED
VIEWER_DIFF_BY_PATH = {VIEWER_FILE_TS: _DIFF_MIDDLEWARE}

# The run-model events that put the corpus files on the Files panel: unit 0
# wrote middleware.ts + generated.ts (Write hook fire ⇒ modified set), unit 1
# only READ the binary + the outside path (referenced set ⇒ File tab default).
VIEWER_EVENTS = [
    {"type": "dataUsed", "session": "r-upload", "ord": 0,
     "files": [VIEWER_FILE_TS, VIEWER_FILE_BIG]},
    {"type": "governanceHookFired", "session": "r-upload", "ord": 0,
     "attempt": 0, "toolName": "Write", "decision": "allow"},
    {"type": "dataUsed", "session": "r-upload", "ord": 1,
     "files": [VIEWER_FILE_BIN, VIEWER_FILE_403]},
]

# ── Slice J (DES-FEEDBACK-002 §5): the search-mode wires ──────────────────────
#
# GET /governance/claims — the decisions corpus (real `GovernanceClaim` shape,
# wicked-crew-api-types): one claim NAMES a client-held run in its scope (the
# hit navigates to the run), one names only a repo (the hit falls back to
# /policies). Served unconditionally: the studio only reads it on the search
# gesture, so no standing rig sees a new request.
GOVERNANCE_CLAIMS = [
    {"claim_id": "clm-w2-001", "scope": "run:r-upload", "phase": "build",
     "policy_ids": ["pol-rate-limit"], "decision": "allow", "obligations": [],
     "evaluated_context_ref": "ctx-upload-0",
     "criteria": "rate-limiting middleware guards the upload endpoint",
     "evaluator_identity": "conformance", "evaluated_at": (NOW0 - HOUR) // 1000},
    {"claim_id": "clm-w2-002", "scope": "repo:studio-api", "phase": "design",
     "policy_ids": ["pol-authz-review"], "decision": "deny",
     "obligations": ["schedule an authz review"],
     "evaluated_context_ref": "ctx-repo-1",
     "criteria": "the schema rollback plan is missing from the design",
     "evaluator_identity": "conformance", "evaluated_at": (NOW0 - 2 * HOUR) // 1000},
]

# GET /projects/<id>/prompts — the per-project open prompt inbox (real
# `InteractionRequest` shape). Only the projects whose runs hold open gates
# have entries; an unknown project answers an empty inbox (the daemon's shape).
PROJECT_PROMPTS = {
    "q3-review-deck": [
        {"id": "ir-q3-0", "session_id": "r-q3", "kind": "gate", "ord": 0,
         "reviewing_ord": None, "prompt": "Approve the deck outline?",
         "status": "open", "answer": None,
         "created_at": NOW0 - 30 * SEC, "resolved_at": None},
    ],
    "api-migration": [
        {"id": "ir-api-0", "session_id": "r-api", "kind": "gate", "ord": 0,
         "reviewing_ord": None, "prompt": "How should the tables move?",
         "status": "open", "answer": None,
         "created_at": NOW0 - 2 * MIN, "resolved_at": None},
    ],
}

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

# ── Slice R (DES-UX-001 §1): the failure-forensics corpus, behind `forensics` ──
#
# Everything below speaks the REAL crew wire: the unit-output route's exact
# contract (routes.ts — 200 `{"output": …}` when a transcript survives, 200
# `{"output": null, "outputUnavailable": <the FINDING-006 sentence>}` for the
# rejected unit, 404 naming the run's keys for an unknown one), `gateEvaluated`
# with the api-types field set (incl. the FINDING-025 vacuous shape: EMPTY
# `evaluatorPolicies` beside `evaluatorPass: true`), and the crew#305 file
# route serving the cited evidence under r-auth's `extra_write_roots`.

FORENSICS_EVIDENCE_ROOT = "/w2/auth-evidence"
FORENSICS_NOTES_PATH = f"{FORENSICS_EVIDENCE_ROOT}/NOTES.md"
FORENSICS_NOTES_CONTENT = """\
# Auth middleware survey notes

## Token refresh
The refresh path lives in `src/auth/refresh.ts` and is exercised by
`auth.refresh.spec` — any refactor that drops the expired-access +
valid-refresh branch fails it.

## Rollout order
Middleware order matters: rateLimit -> session -> refresh.
"""

# The survey transcript CITES the notes file as a markdown link — the evidence
# reference the run page must make a live click (§1.5 AC 6), exactly as agents
# write them into transcripts.
FORENSICS_SURVEY_OUTPUT = """\
## Survey: the auth middleware surface

Mapped the middleware chain and the token-refresh path.

- `src/auth/middleware.ts` wires session + refresh, in that order
- the expired-access + valid-refresh branch is covered by `auth.refresh.spec`

Full notes, including the rollout-order constraint, are in
[NOTES.md](/w2/auth-evidence/NOTES.md).
"""

# Core's denial prefix shape ("Governance DENIED unit N (key): …") — the one
# field that distinguishes a gate deny from a worker failure (FINDING-050).
FORENSICS_REVIEW_DENIAL = (
    "Governance DENIED unit 1 (review): the refactored middleware drops the "
    "token-refresh path — auth.refresh.spec fails on the expired-token branch"
)

# The rejected unit's honest no-transcript answer — routes.ts's
# outputUnavailableReason wording, verbatim shape (FINDING-006).
FORENSICS_REVIEW_UNAVAILABLE = (
    "Unit 1 was REJECTED, so wicked-core stored no transcript for it: a work_output "
    "record is written only for a unit whose phase resolved approved, and this one's did not. "
    "That is the deny-dominates rule holding, not a lost or unreadable record — and the text "
    "the unit streamed is not retained anywhere else, so this is the whole of what survives. "
    f"Why it was rejected: {FORENSICS_REVIEW_DENIAL}. "
    "The gate decision and the run's event trail are in GET /api/v1/runs/r-auth/evidence."
)


def _forensics_unit(key: str, ord_: int, desc: str, stage: str, status: str,
                    denial: str | None = None) -> dict:
    return {"id": f"r-auth:{key}", "session_id": "r-auth", "ord": ord_,
            "description": desc, "stage": stage, "assigned_cli": "claude",
            "assigned_invocation": None, "council_task_ref": None, "routing": None,
            "denial_reason": denial, "phase_ref": None, "conformance_ref": None,
            "phase_status": None, "collection_scope": None, "status": status}


FORENSICS_AUTH_UNITS = [
    _forensics_unit("survey", 0, "survey the auth middleware surface", "recon", "done"),
    _forensics_unit("review", 1, "review the middleware refactor", "review", "rejected",
                    denial=FORENSICS_REVIEW_DENIAL),
]

# What each unit's REAL output route answers (GET /runs/r-auth/units/<key>/output).
FORENSICS_UNIT_OUTPUTS = {
    "survey": {"output": FORENSICS_SURVEY_OUTPUT},
    "review": {"output": None, "outputUnavailable": FORENSICS_REVIEW_UNAVAILABLE},
}

# The gateEvaluated deny in r-auth's durable tail: the deciding phase (ord 1,
# the review), its criterion, the agent judge's verdict + reasoning, the
# winning denialReason — and the FINDING-025 vacuous default-allow shape.
FORENSICS_GATE_DENY = {
    "type": "gateEvaluated", "session": "r-auth", "ord": 1,
    "ts": NOW0 - 12 * MIN - 10 * SEC,
    "criterion": "the middleware refactor keeps every existing auth test green",
    "hasDeterministicFloor": True, "deterministicPass": True,
    "agentVerdict": "fail",
    "agentReasoning": (
        "The refactored middleware drops the token-refresh path: requests carrying "
        "an expired access token with a valid refresh token now 401 instead of "
        "refreshing — auth.refresh.spec fails on that branch."
    ),
    "evaluatorPass": True, "evaluatorPolicies": [],  # FINDING-025: vacuous default-allow
    "denialReason": FORENSICS_REVIEW_DENIAL,
    "combined": False,
}

# Appended to the durable tails while `forensics` is on. Both failed runs gain
# one dataUsed file so their Files panels offer [Full diff] (the escape-hatch
# entry points); r-legacy's tail stays gateEvaluated-FREE — the retention
# empty state ("no evaluator record survives for this run").
FORENSICS_AUTH_EVENTS = [
    {"type": "dataUsed", "session": "r-auth", "ord": 0,
     "files": [FORENSICS_NOTES_PATH], "ts": NOW0 - 12 * MIN - 30 * SEC},
    FORENSICS_GATE_DENY,
]
FORENSICS_LEGACY_EVENTS = [
    {"type": "dataUsed", "session": "r-legacy", "ord": 0,
     "files": ["/w2/legacy/importer.py"], "ts": NOW0 - 8 * DAY - 30 * SEC},
]

# How long r-legacy's /diff HANGS before releasing its (daemon) thread with a
# late answer — well past the client's own timeout budget, so the rig proves
# the client reached its error branch on its OWN clock, having dispatched ≥1
# real fetch (the zero-request-hang regression trap, §1.3-4b).
FORENSICS_DIFF_HANG_SECONDS = 30

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
DEMO_MANIFEST = {"head": 1, "kind": "demo", "versions": [
    {"version": 1, "parent": None, "feedback_file": None, "html_file": "v1.html",
     "created_at": iso(NOW0 - 5 * MIN), "meta": {}}]}


def storyboard_doc_html(version: int) -> str:
    """The demo's version HTML — its STORYBOARD (DES-FEEDBACK-001 §7.4), as the real
    bridge's storyboard() lands it: the recording embedded above an ordered chapter
    rail, thumbnails included. The studio frames this whole; chapter navigation
    lives IN here (§9: never re-drawn outside the iframe)."""
    chapters = "".join(
        f'<li class="ch" data-step="{i}"><img src="../demo/thumb-{i}.png" alt="">'
        f"<span>{i + 1}. {s['title']}</span></li>"
        for i, s in enumerate(DEMO_STEPS))
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
        "body{margin:0;background:#0b1020;color:#e6e9f5;font:14px system-ui}"
        ".player{height:56vh;display:flex;align-items:center;justify-content:center;"
        "background:#141a30;border-bottom:1px solid #26304f}"
        ".player img{max-height:100%;max-width:100%}"
        "ol{display:flex;gap:12px;list-style:none;margin:0;padding:14px;overflow-x:auto}"
        ".ch{background:#1b2340;border:1px solid #26304f;border-radius:8px;"
        "padding:8px;width:180px;flex-shrink:0}"
        ".ch img{width:100%;border-radius:4px;display:block;margin-bottom:6px}"
        ".ch span{white-space:nowrap;font-size:12px}"
        "</style></head>"
        f'<body data-storyboard="{DEMO_NAME}" data-storyboard-version="{version}">'
        '<div class="player"><img src="../demo/v1.gif" alt="recording"></div>'
        f"<ol>{chapters}</ol></body></html>")

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

# ── The slice-E repo profile surface (DES-FEEDBACK-001 §3): one indexed repo ──
#
# Behind the `repo` switch. Everything below is the REAL crew wire and nothing
# more: `RepoEntry` verbatim (routes.ts RepoSchema — no language field, because
# the daemon serves none); the code graph with estate's per-node `lang` (the
# ONE language signal on the wire — the language bar derives from it); commits
# from `git log --pretty=…%ar -n 20` — RELATIVE date strings, 20 max (the
# cadence chart must live at that resolution, not a fabricated daily history).

REPO_ID = "studio-api"
REPO_ENTRY = {
    "id": REPO_ID, "name": "studio-api", "root_path": "/tmp/w2/studio-api",
    "default_branch": "main", "registered_at": NOW0 - 40 * DAY,
    "git_url": "https://github.com/example/studio-api.git",
    "code_graph_db": "/tmp/w2/studio-api/.wicked-estate/code_graph.db",
}


def _graph_node(i: int, name: str, kind: str, file: str, lang: str,
                in_deg: int, out_deg: int) -> dict:
    # The estate graph-view node shape crew relays verbatim (routes.ts):
    # id/name/kind/file/lang/score/inDeg/outDeg.
    return {"id": f"sym-{i}-{name}", "name": name, "kind": kind, "file": file,
            "lang": lang, "score": round(0.9 - i * 0.04, 2),
            "inDeg": in_deg, "outDeg": out_deg}


REPO_GRAPH_NODES = [
    _graph_node(0, "registerRoutes", "function", "src/api/routes.ts", "typescript", 31, 12),
    _graph_node(1, "SessionStore", "class", "src/store/sessions.ts", "typescript", 24, 6),
    _graph_node(2, "dispatchUnit", "function", "src/engine/dispatch.ts", "typescript", 19, 9),
    _graph_node(3, "GateCache", "class", "src/engine/gates.ts", "typescript", 14, 4),
    _graph_node(4, "wireContract", "interface", "src/api/contract.ts", "typescript", 11, 2),
    _graph_node(5, "renderBoard", "function", "src/ui/board.ts", "typescript", 8, 7),
    _graph_node(6, "useRuns", "function", "src/ui/hooks.ts", "typescript", 7, 3),
    _graph_node(7, "parseArgs", "function", "src/cli/args.ts", "typescript", 5, 1),
    _graph_node(8, "run_actor", "function", "core/src/actor.rs", "rust", 22, 8),
    _graph_node(9, "EventLog", "struct", "core/src/event_log.rs", "rust", 16, 3),
    _graph_node(10, "open_store", "function", "core/src/store.rs", "rust", 9, 5),
    _graph_node(11, "evidence_check", "function", "scripts/evidence_check.py", "python", 4, 2),
    _graph_node(12, "bundle_report", "function", "scripts/report.py", "python", 3, 1),
    _graph_node(13, "legacyShim", "function", "shim/legacy.js", "javascript", 2, 1),
]
REPO_GRAPH = {
    "nodes": REPO_GRAPH_NODES,
    "edges": [{"src": REPO_GRAPH_NODES[i]["id"], "tgt": REPO_GRAPH_NODES[0]["id"]}
              for i in range(1, 8)],
    "stats": {"nodeCount": len(REPO_GRAPH_NODES), "edgeCount": 7,
              "fileCount": len({n["file"] for n in REPO_GRAPH_NODES})},
}

# git %ar labels exactly as `git log --pretty=…%ar` prints them — day-or-finer
# up to 13 days, then git's own week rounding, then months (out of the 30d
# window on purpose: the cadence caption must count it, not paint it).
REPO_COMMITS = [
    ("2 hours ago", "tighten gate cache reconcile"),
    ("5 hours ago", "fix: unit ordinal drift on redrive"),
    ("26 hours ago", "routes: repo graph relay"),
    ("2 days ago", "actor: single-writer store seam"),
    ("2 days ago", "board: quiet band decay"),
    ("3 days ago", "cli: args parser hardening"),
    ("5 days ago", "evidence bundle v2"),
    ("6 days ago", "event log: seq per envelope"),
    ("9 days ago", "hooks: debounce runs refresh"),
    ("11 days ago", "contract: additive frame fields"),
    ("13 days ago", "dispatch: rework attempts"),
    ("2 weeks ago", "store: WAL checkpoint tuning"),
    ("3 weeks ago", "report script: markdown out"),
    ("4 weeks ago", "shim: legacy import path"),
    ("2 months ago", "initial carve-out"),
]
REPO_CONTRIBUTORS = [
    {"commits": 42, "name": "Mika Ellis", "email": "mika@example.com"},
    {"commits": 17, "name": "Ravi Chandra", "email": "ravi@example.com"},
    {"commits": 6, "name": "Jo Beck", "email": "jo@example.com"},
]

# The chat surface (slice 4, §2.4): a four-seat roster and instant-warm chat
# endpoints. Seats warm the moment they are asked — determinism over realism —
# and the daemon's real semantics are kept where the client depends on them:
# GET /chats/<id> answers an EMPTY seat list (a 200, not a 404) for a chat this
# fixture has never been told about, which is the "reclaimed" signal the rejoin
# probe distinguishes from an error.
# Each seat carries the REAL crew#274 additions the daemon's /roster serves
# (routes.ts:308): `health: SeatHealth` (status + bounded error excerpt +
# since/lastErrorAt) and the `signed_in` heuristic. `pi` deliberately carries
# NEITHER — the additive-wire case (a daemon predating crew#274) the slice-O
# health registry must render as unknown, never as a fabricated "active".
CODEX_HEALTH_MESSAGE = ("quota exceeded: the monthly usage limit for this "
                        "seat has been reached upstream")
ROSTER = [
    {"key": "claude", "display_name": "claude", "binary": "claude",
     "enabled_for_council": True, "signed_in": True,
     "health": {"status": "active", "since": iso(NOW0 - 2 * DAY)}},
    {"key": "codex", "display_name": "codex", "binary": "codex",
     "enabled_for_council": True, "signed_in": False,
     "health": {"status": "inactive", "message": CODEX_HEALTH_MESSAGE,
                "since": iso(NOW0 - 2 * HOUR), "lastErrorAt": iso(NOW0 - 2 * HOUR)}},
    {"key": "agy", "display_name": "agy", "binary": "agy",
     "enabled_for_council": True, "signed_in": True,
     "health": {"status": "active", "since": iso(NOW0 - 2 * DAY)}},
    {"key": "pi", "display_name": "pi", "binary": "pi", "enabled_for_council": True},
]

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
NARRATION = "Writing the token-bucket middleware for /upload"

# ── The slice-6 document surface (DES-UXFIX-001 §2.6): one doc journey, W3-shaped ──
#
# The interactive bridge, reduced to what Document mode reads through crew's proxy:
# preflight, the doc registry, per-doc manifests, the rendered version HTML,
# create/fork/events. State is mutable ON PURPOSE — the slice-6 rig drives the real
# composer (create → generate → continue), and the manifest must grow exactly the way
# the bridge's would: the version's `meta.sourceMessageId` is whatever id the CLIENT
# minted and sent, which is what makes the §7.6 strip→thread scroll assertable.
#
# Bus frames the journey emits ride the same /ws as the board narration, in the relay
# envelope the client folds (`{type:"interactiveEvent", event}`): each POST queues its
# frames and the socket loop drains the queue on its next tick.

# ── Theme learn (issue #65): the fixture speaks ONLY the real wire ─────────────
#
# The invented slice-16 surface — GET /api/themes, GET /api/themes/<id>,
# POST /api/theme/learn — is GONE: the real bridge never served any of it, and a
# fixture answering an invented route is exactly how the slice-13 demo break was
# masked. The real learn wire is the bus command `wicked.interactive.theme.requested`
# riding POST /api/events (materializeThemeRequested in wicked-interactive), whose
# progress and refusals arrive ASYNC as the bridge's own status.posted frames. The
# guard below emulates that: a private/link-local URL queues the bridge's error
# line, a good source queues the working line + theme.learned — never an HTTP 4xx.

PRIVATE_HOST = re.compile(
    r"^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\."
    r"|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|::1$|fe80:|fd)")

# ── The learned-theme READBACK (interactive#181) ───────────────────────────────
#
# The real bridge serves GET /d/<doc>/api/theme/learned: 404 {"error":"no
# learned theme"} until a learn lands, then 200 {document_id, learned_at,
# tokens} with tokens = the doc's learned.theme.json VERBATIM. This fixture
# materializes the same ripening: a successful theme.requested records the
# learned tokens for (pid, doc) with a small delay (`learn_delay_s`, default
# 0.75s — enough for the rig to witness the 404→200 transition the studio poll
# rides); the SSRF-refused path records NOTHING, exactly as the real
# materializer leaves no learned file behind a refusal.
#
# The token object is the bridge's own theme vocabulary — nested colors/fonts,
# partials legal. The deep-navy #0a2a5e primary forces the studio mapper's two
# disclosed adjustments (lightness-clamp + contrast-floor), same as the old
# slice-8 fixture brand did.
LEARNED_TOKENS = {
    "name": "acme-brand",
    "colors": {"background": "#f8fafc", "surface": "#ffffff", "primary": "#0a2a5e",
               "secondary": "#0e7490", "accent": "#0a2a5e", "text_primary": "#1e293b"},
    "fonts": {"heading": "Georgia", "body": "Georgia", "mono": "Menlo"},
}

learned_lock = threading.Lock()
# (pid, doc) -> ready_at_ms. Readable (200) once NOW >= ready_at_ms.
learned_themes: dict = {}


def ssrf_reject_reason(url: str) -> str | None:
    """The bridge-side guard (DES-MERGE-001 §4.6): why this URL is refused, or None."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return f"unparseable URL: {url}"
    if parts.scheme not in ("http", "https"):
        return f"unsupported scheme {parts.scheme or '(none)'} — only http(s) brand sources are captured"
    host = (parts.hostname or "").lower()
    if host == "" or PRIVATE_HOST.match(host):
        return (f"refusing to fetch {host or url}: loopback, private and link-local "
                "addresses are blocked (SSRF guard)")
    return None

# The headline the continue "tightens" — v1 verbose, v2+ tight — so the canvas change
# between versions is legible in the screenshots, not just a version number swapping.
HEADLINES = {1: "Q3 was a quarter of significant and wide-ranging positive developments"}
TIGHT_HEADLINE = "Q3: revenue up 18%"

docs_lock = threading.Lock()
# pid -> docId -> [version entries, manifest-shaped]. Grown by create/fork below.
docs_created: dict = {}

# ── Slice K (DES-FEEDBACK-002 §6): per-chat reply bookkeeping ─────────────────
# Which seats each fixture chat warmed, which have since failed, and how many
# sends it has taken — so the switch-gated reply drip fans out to exactly the
# seats the daemon would (warm minus failed), never to an invented roster.
chat_state_lock = threading.Lock()
chat_warm_seats: dict = {}   # chat_id -> [cliKey, warm order]
chat_dead_seats: dict = {}   # chat_id -> set of cliKeys that chatSessionFailed
chat_send_count: dict = {}   # chat_id -> number of message fan-outs so far

# The reply prose per seat — short and distinct, so the columns screenshot reads
# as three agents disagreeing about the same prompt, not lorem ipsum.
CHAT_REPLY_LINES = {
    "claude": "I'd extract the fetch layer first — the retries belong in one place.",
    "codex": "Start by moving the types out; the refactor falls out of the seams.",
    "agy": "The seam is the adapter here — invert it and the rest is mechanical.",
    "pi": "Sketch the interface first; implementations follow.",
    # The cold-cache fallback trio (DEFAULT_CHAT_AGENTS) — what a first-run
    # chat warms when nothing has fetched the roster yet this session.
    "writer": "Draft it end to end first; structure emerges from the prose.",
    "reviewer": "Name the invariants before touching code — tests pin them.",
    "planner": "Split it: fetch layer this week, the adapter swap next.",
}

ws_lock = threading.Lock()
ws_queue: list = []
# The NEWEST /ws connection owns the one-shot queues. A rig that navigates
# between routes leaves the previous page's handler thread looping until its
# next write raises — and that zombie's drain would STEAL queued frames from
# the live page's socket (it drains before it writes, so the frames die with
# it). Each connection takes a generation number; only the newest drains.
ws_gen = [0]
# Slice K: chat frames BROADCAST to every open /ws connection — the daemon fans
# CoreEvents out to all subscribers, and the studio opens one socket per
# useEventStream consumer (App's fold AND GroupChat's own), so newest-only
# delivery would hand the chat frames to whichever socket connected last and
# starve the surface that filters them by chat id. Each connection registers
# its own queue on connect and removes it when its socket dies.
ws_chat_queues: list = []


def broadcast_chat(frame: dict) -> None:
    """Queue one chat frame for EVERY live /ws connection (the daemon's fan-out)."""
    with ws_lock:
        for q in ws_chat_queues:
            q.append(frame)


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
            push_metrics = state["metrics_ws"]
            push_river = state["river"]
        my_chat_queue: list = []
        with ws_lock:
            ws_gen[0] += 1
            my_gen = ws_gen[0]
            ws_chat_queues.append(my_chat_queue)
        # Slice-E burn drip: the REAL cliUsage frame shape (costUsd dollars when
        # the CLI reports them, null when unknown — the null one must never fold
        # to $0), one frame per loop tick so the cumulative curve has more than
        # one arrival instant. Per-connection, never re-armed in the loop.
        burn_drip = [
            {"type": "cliUsage", "session": "r-upload", "ord": 0, "attempt": 0,
             "inputTokens": 21000, "outputTokens": 3000, "costUsd": 0.04},
            {"type": "cliUsage", "session": "r-smoke1", "ord": 0, "attempt": 0,
             "inputTokens": 40000, "outputTokens": 9000, "costUsd": 0.11},
            {"type": "cliUsage", "session": "r-upload", "ord": 0, "attempt": 1,
             "inputTokens": 18000, "outputTokens": 2500, "costUsd": None},
            {"type": "cliUsage", "session": "r-smoke2", "ord": 0, "attempt": 0,
             "inputTokens": 33000, "outputTokens": 7000, "costUsd": 0.09},
            {"type": "cliUsage", "session": "r-upload", "ord": 0, "attempt": 2,
             "inputTokens": 52000, "outputTokens": 12000, "costUsd": 0.18},
        ] if push_metrics else []
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
            # Slice Q: ONE relayed version.created on connect — the river's
            # doc-landed mark on q3-review-deck's lane (arrival-clocked, §7.3).
            if push_river:
                self.wfile.write(ws_frame({
                    "type": "interactiveEvent",
                    "event": {"event_type": "wicked.interactive.version.created",
                              "payload": {"project_id": "q3-review-deck",
                                          "document_id": "q3-deck",
                                          "version": 2, "kind": "generated"}},
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
                # Slice K: drain THIS connection's chat broadcast (every open
                # socket gets these — see broadcast_chat above).
                with ws_lock:
                    chat_pending, my_chat_queue[:] = list(my_chat_queue), []
                for frame in chat_pending:
                    self.wfile.write(ws_frame(frame))
                # Drain any one-shot narration lines a rig posted mid-page (vision
                # slice 2: prove a NEW delta reaches the live feed within 2s).
                extra: list = []
                gates_extra: list = []
                if newest:
                    with state_lock:
                        extra, state["extra_narration"] = list(state["extra_narration"]), []
                        gates_extra, state["extra_gates"] = list(state["extra_gates"]), []
                for line in extra:
                    self.wfile.write(ws_frame({
                        "type": "unitOutputDelta", "session": "r-upload", "ord": 0,
                        "text": str(line) + "\n",
                    }))
                # Slice L (§8.4): one-shot awaitingHuman ARRIVALS a rig posted —
                # the desktop-notification trigger is the live frame, never the
                # cached-gate GET a page load reconciles.
                for g in gates_extra:
                    self.wfile.write(ws_frame({
                        "type": "awaitingHuman", "session": g["session"],
                        "ord": g.get("ord", 0), "prompt": g.get("prompt", "Approve?"),
                    }))
                # One burn frame per tick until the slice-E drip drains.
                if newest and burn_drip:
                    self.wfile.write(ws_frame(burn_drip.pop(0)))
                self.wfile.write(ws_frame({
                    "type": "unitOutputDelta", "session": "r-upload", "ord": 0,
                    "text": NARRATION + "\n",
                }))
                self.wfile.flush()
                time.sleep(1.0)
        except OSError:
            pass
        finally:
            # A dead socket must stop receiving broadcasts — and must not pin
            # frames other connections already consumed copies of.
            with ws_lock:
                if my_chat_queue in ws_chat_queues:
                    ws_chat_queues.remove(my_chat_queue)
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
                        + ([LONG_RUN] if state["long_prompt"] else []) \
                        + ([CHAT_LIVE, CHAT_GATED] if state["chat_runs"] else []) \
                        + (BATCH_RUNS if state["batch_gates"] else [])
                viewer_on = state["viewer"]
                repo_refs_on = state["repo_refs"]
                forensics_on = state["forensics"]
            if viewer_on or repo_refs_on or forensics_on:
                runs = json.loads(json.dumps(runs))
                for r in runs:
                    # Slice I: the live run gains a workdir (the diff route's
                    # 409 gate reads it; AgentSession carries it on the wire).
                    if viewer_on and r["session"]["id"] == "r-upload":
                        r["session"]["workdir"] = VIEWER_WORKDIR
                    # Slice P: repo-linked runs for the /repos tiles (§4.4).
                    if repo_refs_on and r["session"]["id"] in REPO_REF_RUNS:
                        r["session"]["repo_ref"] = REPO_ID
                    # Slice R: r-auth's real-shape units + the evidence root
                    # its survey transcript cites (workdir stays None — its
                    # /diff answers the REAL 409 named-cause case).
                    if forensics_on and r["session"]["id"] == "r-auth":
                        r["units"] = json.loads(json.dumps(FORENSICS_AUTH_UNITS))
                        r["session"]["extra_write_roots"] = [FORENSICS_EVIDENCE_ROOT]
            self._json(200, {"runs": runs})
            return True
        # Slice I: the crew#305 file/diff routes (real contract, switch-gated).
        m = re.match(r"^/api/v1/runs/([^/]+)/(files|diff)$", path)
        if m:
            self._viewer_routes(urllib.parse.unquote(m.group(1)), m.group(2))
            return True
        if path == "/api/v1/projects":
            with state_lock:
                batch_on = state["batch_gates"]
            self._json(200, {"projects": PROJECTS + (BATCH_PROJECTS if batch_on else [])})
            return True
        if path == "/api/v1/repos":
            with state_lock:
                repo_on = state["repo"]
            self._json(200, {"repos": [REPO_ENTRY] if repo_on else []})
            return True
        # The slice-E repo profile reads (all real crew routes, switch-gated).
        m = re.match(r"^/api/v1/repos/([^/]+)/(graph|git-history|contributors)$", path)
        if m:
            rid, leaf = urllib.parse.unquote(m.group(1)), m.group(2)
            with state_lock:
                repo_on = state["repo"]
            if not repo_on or rid != REPO_ID:
                self._json(404, {"error": f"Repo {rid} not found"})
                return True
            if leaf == "graph":
                self._json(200, {"graph": REPO_GRAPH})
            elif leaf == "git-history":
                self._json(200, {"commits": [
                    {"sha": f"{i:07x}{'0' * 33}", "shortSha": f"{i:07x}",
                     "message": msg, "author": "Mika Ellis", "date": date}
                    for i, (date, msg) in enumerate(REPO_COMMITS)
                ]})
            else:
                self._json(200, {"contributors": REPO_CONTRIBUTORS})
            return True
        if path == "/api/v1/roster":
            self._json(200, {"roster": ROSTER})
            return True
        # Slice J (§5.2): the decisions corpus — read on the search GESTURE only.
        if path == "/api/v1/governance/claims":
            self._json(200, {"claims": GOVERNANCE_CLAIMS})
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
            refs = list(MEMBERS.get(pid, []))
            with state_lock:
                chat_runs_on = state["chat_runs"]
                river_on = state["river"]
                repo_member_on = state["repo_member"]
                batch_on = state["batch_gates"]
            # Slice L: the batch corpus projects' runs.
            if batch_on:
                refs.extend(BATCH_MEMBERS.get(pid, []))
            # Slice P: the live chat thread is a `crew.chat` member of notes.
            kinds = {}
            if chat_runs_on and pid == "notes":
                refs.append("r-chat-live")
                kinds["r-chat-live"] = "crew.chat"
            # Slice J (§10.2): upload-endpoint's bound repo, a `crew.repo` member.
            if repo_member_on and pid == "upload-endpoint":
                refs.append(REPO_ID)
                kinds[REPO_ID] = "crew.repo"
            # Slice Q: the 24h-spread clocks override the W2 defaults (river on).
            clocks = {**ATTACHED_AT, **(RIVER_ATTACHED_AT if river_on else {})}
            self._json(200, {"members": [
                {"id": f"{pid}:{kinds.get(ref, 'crew.run')}:{ref}", "project_id": pid,
                 "member_kind": kinds.get(ref, "crew.run"), "member_ref": ref, "meta": None,
                 "attached_at": clocks.get(ref, 1), "attached_by": "studio"}
                for ref in refs
            ]})
            return True
        # Slice J (§5.2): the scoped per-project prompt inbox.
        if len(parts) == 6 and parts[3] == "projects" and parts[5] == "prompts":
            pid = urllib.parse.unquote(parts[4])
            self._json(200, {"projectId": pid, "prompts": PROJECT_PROMPTS.get(pid, [])})
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
            elif rid == "r-chat-gated" and state["chat_runs"]:
                # Slice P: the stalled chat's cached gate (§4.3 row 3).
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": CHAT_GATE_PROMPT,
                                 "receivedAt": iso(NOW0 - 5 * MIN)})
            elif rid in BATCH_GATE_PROMPTS and state["batch_gates"]:
                # Slice L: the batch corpus's SIMPLE cached gates (no options).
                prompt, age = BATCH_GATE_PROMPTS[rid]
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": prompt, "receivedAt": iso(NOW0 - age)})
            else:
                self._json(404, {"error": f"no gate cached for {rid}"})
            return True
        # /api/v1/runs/<id>/events
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "events":
            rid = urllib.parse.unquote(parts[4])
            events = list(RUN_EVENTS.get(rid, []))
            with state_lock:
                viewer_on = state["viewer"]
                river_on = state["river"]
                forensics_on = state["forensics"]
            if viewer_on and rid == "r-upload":
                events = events + VIEWER_EVENTS
            # Slice Q: r-auth's durable tail matches its spread attach clock.
            if river_on and rid == "r-auth":
                events = list(RIVER_AUTH_EVENTS)
            # Slice R: the forensics tails — r-auth gains its dataUsed file +
            # the gateEvaluated deny; r-legacy gains ONLY a dataUsed file (its
            # tail stays gateEvaluated-free: the retention empty state).
            if forensics_on and rid == "r-auth":
                events = events + FORENSICS_AUTH_EVENTS
            if forensics_on and rid == "r-legacy":
                events = events + FORENSICS_LEGACY_EVENTS
            self._json(200, {"events": events})
            return True
        # Slice R: the REAL unit-transcript wire (routes.ts crew — the studio's
        # WorkUnitDetail + Term-tab transcript read). Served only while the
        # forensics corpus is on; otherwise the daemon's unknown-run 404.
        m = re.match(r"^/api/v1/runs/([^/]+)/units/([^/]+)/output$", path)
        if m:
            rid = urllib.parse.unquote(m.group(1))
            key = urllib.parse.unquote(m.group(2))
            with state_lock:
                forensics_on = state["forensics"]
            if not forensics_on or rid != "r-auth":
                self._json(404, {"error": "Run not found"})
                return True
            served = FORENSICS_UNIT_OUTPUTS.get(key)
            if served is None:
                self._json(404, {"error": f"Unit '{key}' not found in run {rid}",
                                 "units": sorted(FORENSICS_UNIT_OUTPUTS)})
                return True
            self._json(200, served)
            return True
        if path.startswith("/api/v1/"):
            self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            return True
        return False

    def _viewer_routes(self, rid: str, leaf: str) -> None:
        """The crew#305 file/diff routes with their REAL validation ladder and
        error strings (routes.ts). With `file_routes` off (or the whole corpus
        off) they answer Fastify's DEFAULT unknown-route 404 body — exactly what
        a daemon predating crew#305 sends — so the studio's fallback detection
        sees the same wire it would in production."""
        with state_lock:
            viewer_on = state["viewer"] and state["file_routes"]
            orphan_on = state["orphan"]
            forensics_on = state["forensics"]
        # Slice R: the forensics corpus lights these routes for the two failed
        # runs on its own — r-auth's evidence file + REAL workdir-less 409, and
        # r-legacy's hanging diff — without dragging the whole viewer corpus in.
        forensic_rid = forensics_on and rid in ("r-auth", "r-legacy")
        if not viewer_on and not forensic_rid:
            self._json(404, {"message": f"Route GET:{self.path} not found",
                             "error": "Not Found", "statusCode": 404})
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query,
                                      keep_blank_values=True)
        paths = query.get("path", [])
        known = {r["session"]["id"] for r in RUNS} | ({"r-orphan"} if orphan_on else set())
        # The shared resolveRunPath ladder: 404 unknown run → 400 repeated /
        # non-absolute → 403 outside every allowed root.
        if rid not in known:
            self._json(404, {"error": f"unknown run: {rid}"})
            return
        if len(paths) > 1:
            self._json(400, {"error": "`path` may be given at most once"})
            return
        qpath = paths[0].strip() if paths else None
        if qpath == "":
            qpath = None
        workdir = VIEWER_WORKDIR if rid == "r-upload" else None
        if qpath is not None:
            if not qpath.startswith("/"):
                self._json(400, {"error": "`path` must be an absolute path"})
                return
            roots = [workdir] if workdir else []
            # Slice R: r-auth's extra_write_roots — the evidence root its
            # survey transcript cites (resolveRunPath honors write roots).
            if forensics_on and rid == "r-auth":
                roots.append(FORENSICS_EVIDENCE_ROOT)
            if not any(qpath == r or qpath.startswith(r + "/") for r in roots):
                self._json(403, {"error": "path is outside every allowed root (the "
                                          "run's workdir/write roots and the registered repos)"})
                return
        if leaf == "files":
            if qpath is None:
                self._json(400, {"error": "`path` query parameter is required"})
                return
            served = VIEWER_FILES.get(qpath)
            if served is None and forensics_on and qpath == FORENSICS_NOTES_PATH:
                served = {"path": FORENSICS_NOTES_PATH, "content": FORENSICS_NOTES_CONTENT,
                          "size": len(FORENSICS_NOTES_CONTENT.encode()),
                          "truncated": False, "binary": False}
            if served is None:
                self._json(404, {"error": f"no such file: {qpath}"})
                return
            self._json(200, served)
            return
        # leaf == "diff"
        if forensics_on and rid == "r-legacy":
            # Slice R (§1.3-4b): the historical run's diff HANGS — no answer
            # until well past the client's timeout budget. The client must have
            # dispatched ≥1 real fetch and reach its OWN error branch; the late
            # 409 merely releases this daemon thread afterwards.
            time.sleep(FORENSICS_DIFF_HANG_SECONDS)
            self._json(409, {"error": f"run {rid}'s workdir no longer exists: /w2/legacy"})
            return
        if workdir is None:
            self._json(409, {"error": f"run {rid} has no workdir — nothing to diff"})
            return
        if qpath is not None:
            self._json(200, {"diff": VIEWER_DIFF_BY_PATH.get(qpath, ""), "truncated": False})
            return
        self._json(200, {"diff": VIEWER_DIFF_WHOLE, "truncated": False})

    def _interactive_get(self, path: str) -> bool:
        """GET half of the slice-6 bridge surface (DES-UXFIX-001 §2.6)."""
        # /api/v1/projects/<pid>/interactive/api/preflight — all deps present.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/preflight$", path)
        if m:
            self._json(200, {"deps": []})
            return True
        # Issue #65: the invented slice-16 theme routes 404, unconditionally —
        # the real bridge never served them, and this fixture answering them is
        # exactly how the slice-13 demo break was masked. The contract check
        # (interactive_wire_contract_test.py) pins the same 404 on the real bridge.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/theme(s(/.*)?|/learn)$", path)
        if m:
            self._json(404, {"error": f"no such route on the bridge: {path}"})
            return True
        # The REAL learned-theme readback (interactive#181): 404 with the route's
        # OWN JSON body until the doc's learn has ripened, then the tokens
        # verbatim — exactly the shapes the contract check pins on the bridge.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/theme/learned$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            with learned_lock:
                ready_at = learned_themes.get((pid, doc))
            now = int(time.time() * 1000)
            if ready_at is None or now < ready_at:
                self._json(404, {"error": "no learned theme"})
            else:
                self._json(200, {"document_id": doc, "learned_at": iso(ready_at),
                                 "tokens": LEARNED_TOKENS})
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
        # DES-FEEDBACK-001 §7.2: the demo spec/recordings routes were INVENTED by
        # slice 13 — the real bridge never served them, and this fixture answering
        # them is exactly how the break was masked. They 404 now, unconditionally,
        # and interactive_wire_contract_test.py pins the same answer on the real
        # bridge. The storyboard is the demo's version HTML (served below).
        m = re.match(
            r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/demo/(spec|recordings|record)$",
            path)
        if m:
            self._json(404, {"error": f"no such route on the bridge: {path}"})
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
        # A DEMO's version HTML is its STORYBOARD (DES-FEEDBACK-001 §7.4): chapters and
        # the embedded recording live IN the document, exactly as the real bridge's
        # storyboard() lands them.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/doc/(\d+)$", path)
        if m:
            doc = urllib.parse.unquote(m.group(2))
            html = (storyboard_doc_html(int(m.group(3))) if doc == DEMO_NAME
                    else doc_html(doc, int(m.group(3))))
            body = html.encode()
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
        # Issue #65: the invented POST /api/theme/learn 404s, exactly as the real
        # bridge answers it (see the GET half for the matching absent routes).
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/theme/learn$", path)
        if m:
            self._json(404, {"error": f"no such route on the bridge: {path}"})
            return True
        # POST /api/v1/projects/<pid>/interactive/api/events — the inject wire (§5.4).
        # A chat.posted steer regenerates the doc's head version: narrate, then land it.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/events$", path)
        if m:
            pid = urllib.parse.unquote(m.group(1))
            payload = body.get("payload") or {}
            doc = payload.get("document_id")
            # The REAL theme-learn wire (issue #65): theme.requested is a doc-scoped
            # command. The ack is an EventAck; progress and the SSRF guard's refusal
            # arrive as the bridge's own status.posted frames (materializeThemeRequested
            # emits exactly these lines), then theme.learned announces the grabbed render.
            if body.get("event_type") == "wicked.interactive.theme.requested" and doc:
                url = str(payload.get("url") or "").strip()
                file_path = str(payload.get("path") or "").strip()
                reason = ssrf_reject_reason(url) if url and not file_path else None
                if reason is not None:
                    queue_interactive("wicked.interactive.status.posted", {
                        "project_id": pid, "document_id": doc, "state": "error",
                        "message": f"Couldn't grab that URL: {reason}"})
                else:
                    queue_interactive("wicked.interactive.status.posted", {
                        "project_id": pid, "document_id": doc, "state": "working",
                        "message": "Grabbing the page to read its design…"})
                    queue_interactive("wicked.interactive.theme.learned", {
                        "project_id": pid, "document_id": doc,
                        **({"url": url} if url else {"path": file_path}),
                        "render_path": file_path or f"/docs/{doc}/theme/learned_1.pdf",
                        "format": "pdf"})
                    # …and the tokens ripen into the READBACK route (#181) after
                    # learn_delay_s — the 404→200 transition the studio poll rides.
                    # The refused branch above records nothing, exactly as the real
                    # materializer leaves no learned.theme.json behind a refusal.
                    with state_lock:
                        delay_ms = int(float(state["learn_delay_s"]) * 1000)
                    with learned_lock:
                        learned_themes[(pid, doc)] = int(time.time() * 1000) + delay_ms
                self._json(200, {"ok": True, "event_id": "evt-fixture", "correlation_id": "c-fixture"})
                return True
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
            # `reset_learn` clears the learned-theme readback state between page
            # loads (the brand-learn rig re-runs the flow from a clean 404).
            if body.get("reset_learn"):
                with learned_lock:
                    learned_themes.clear()
            with state_lock:
                # `appearance` rides the same control channel but lands in the
                # settings store: a dict replaces studio.appearance wholesale,
                # None restores the defaults (vision slice 7).
                if "appearance" in body:
                    settings_store["studio.appearance"] = (
                        dict(DEFAULT_APPEARANCE) if body["appearance"] is None
                        else body["appearance"])
                # Slice L: seed `studio.notifications` between page loads the
                # same way (a dict replaces it; None removes the key — the
                # "old daemon never persisted one" default case, §8.4).
                if "notif_prefs" in body:
                    if body["notif_prefs"] is None:
                        settings_store.pop("studio.notifications", None)
                    else:
                        settings_store["studio.notifications"] = body["notif_prefs"]
                state.update({k: v for k, v in body.items() if k in state})
                snapshot = dict(state)
            return self._json(200, {"ok": True, "state": snapshot})
        # The slice-6 document journey's writes (create / fork / bus emit).
        if self._interactive_post(path, body if isinstance(body, dict) else {}):
            return None
        # POST /api/v1/runs/<id>/gate — the steering-gate decision (slice H,
        # DES-FEEDBACK-002 §2.3). The fixture accepts it so the answered state
        # ("approved · advancing…") renders truthfully after a triage key or a
        # chip click; the rigs assert the request BODY off the browser tap.
        parts = path.split("/")
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "gate":
            rid = urllib.parse.unquote(parts[4])
            with state_lock:
                conflict = rid in state["gate_409"]
            if conflict:
                # Slice L (§9.5): the daemon's real 409 — the run stopped
                # awaiting between the selection and the fan-out.
                return self._json(409, {"error": "not awaiting a human gate"})
            return self._json(200, {"status": "resumed"})
        # POST /api/v1/chats — open a chat: warm the asked-for seats (or the whole
        # roster when `clis` is omitted, matching the daemon), every seat ok, instantly.
        if path == "/api/v1/chats":
            clis = body.get("clis") or [s["key"] for s in ROSTER]
            chat_id = body.get("chatId") or "fixture-chat"
            with chat_state_lock:
                chat_warm_seats[chat_id] = list(clis)
                chat_dead_seats.setdefault(chat_id, set())
                chat_send_count.setdefault(chat_id, 0)
            return self._json(201, {
                "chatId": chat_id,
                "seats": [{"cliKey": k, "ok": True} for k in clis],
            })
        # POST /api/v1/chats/<id>/messages — accept the fan-out; replies would
        # stream over /ws, which this fixture leaves to the narration loop —
        # UNLESS the slice-K `chat_replies` switch is on: then each send queues
        # one REAL chatReply frame per live seat (the daemon's shape verbatim),
        # and after round 1 the LAST-warmed seat dies with a chatSessionFailed,
        # so the next round's warm set truly shrinks (the empty-cell case).
        parts = path.split("/")
        if len(parts) == 6 and parts[3] == "chats" and parts[5] == "messages":
            with state_lock:
                replies_on = state["chat_replies"]
            if replies_on:
                chat_id = urllib.parse.unquote(parts[4])
                with chat_state_lock:
                    warm = chat_warm_seats.get(chat_id, [])
                    dead = chat_dead_seats.setdefault(chat_id, set())
                    live = [k for k in warm if k not in dead]
                    chat_send_count[chat_id] = chat_send_count.get(chat_id, 0) + 1
                    round_n = chat_send_count[chat_id]
                    kill = warm[-1] if round_n == 1 and len(warm) >= 2 else None
                    if kill is not None:
                        dead.add(kill)
                for k in live:
                    line = CHAT_REPLY_LINES.get(k, "Agreed — start small.")
                    broadcast_chat({"type": "chatReply", "chat": chat_id,
                                    "cliKey": k, "ok": True,
                                    "text": f"{line} (round {round_n})"})
                if kill is not None:
                    broadcast_chat({"type": "chatSessionFailed", "chat": chat_id,
                                    "cliKey": kill,
                                    "reason": "session exited unexpectedly (fixture)"})
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


def wake_strip(page) -> None:
    """DES-FEEDBACK-001 §7.3: the version strip auto-hides after 3s idle (opacity 0,
    pointer-events none) and wakes on bottom-edge proximity. Rigs park the mouse
    there before strip interactions so a click never races the hide timer."""
    vp = page.viewport_size or {"width": 1280, "height": 720}
    page.mouse.move(vp["width"] // 2, vp["height"] - 60)
    page.mouse.move(vp["width"] // 2, vp["height"] - 40)
    page.wait_for_function(
        """() => { const s = document.querySelector('[data-testid="version-strip"]');
                   return !!s && s.getAttribute('data-hidden') === 'false'; }""",
        timeout=10000)


def set_fixture(origin: str, **kwargs) -> None:
    """Flip the mutable switches over POST /__fixture between page loads."""
    req = urllib.request.Request(f"{origin}/__fixture", method="POST",
                                 data=json.dumps(kwargs).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        res.read()
