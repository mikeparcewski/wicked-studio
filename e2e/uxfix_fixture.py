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
  extra_narration — a list; each entry is drained ONCE by the /ws loop as a
                    `unitOutputDelta` (default []). A plain string keeps the
                    historical target (r-upload ord 0 — the vision-slice-2 rig
                    posts one mid-page to prove the live feed updates from the
                    shared store within the 2s AC); a dict {session, ord?, text}
                    targets any run — the slice-Z rig (DES-UX-001 §7.6) drips
                    frames at the run it just launched over POST /runs.
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
  gate_now        — run ids whose SessionView answers status awaiting_human on
                    the list/detail wires, with a cached COMPLEX gate on the
                    gate GET (slice BD §4: pair with an extra_gates frame to
                    ARRIVE a gate at a run the operator annotated pre-gate).
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
  timeline        — the slice-BB run-evidence-timeline corpus (DES-UX-002 §2):
                    GET /runs/r-auth/events serves the FULL recorded chronology
                    (real event_to_json shapes + RecordedEvent ts/seq) —
                    sessionStarted, workflowSelected, unitPlanned ×2, the
                    survey's dispatch/output, and the review's gateEscalated →
                    unitReworkAmended → re-dispatch → gateEvaluated deny arc,
                    ending sessionFailed. Ride it WITH `forensics` (units +
                    output wires). Default False.
  project_dto     — the slice-S CREW-UX-2 corpus (DES-UX-001 §2.3): every run
                    DTO carries `project_id` (api-types 0.8.0 — a string echoed
                    from the membership record, or null = GENUINELY unfiled),
                    the list gains `r-unfiled` (a null-claim run no membership
                    names), and `POST /api/v1/runs` becomes a REAL launch: the
                    daemon's `{runId}` answer, the run atomically filed into
                    `body.projectId` (never a silent unfiled run) and served on
                    both the runs wire (with its `project_id` echo) and its
                    project's members wire. Default False: pre-0.8.0 rigs keep
                    DTOs without the field and a POST that 404s.

  doc_run_ms      — slice T (DES-UX-001 §6.1): how long one doc "run" takes.
                    0 (default) keeps the instant landings every standing rig
                    assumes; >0 makes each accepted chat.posted send land its
                    OWN new version FIFO doc_run_ms after the previous landing
                    (BRIDGE-UX-1 probe 1: the bridge queues, never drops), so
                    a rig can witness generating/queued/marker in sequence.
  doc_silent      — the J3 no-answerer shape (§6.1 honesty budget): create and
                    chat.posted ACK exactly as the real bridge does, then the
                    bus says NOTHING (no status.posted, no version.created,
                    ever) — the reproduced 28-min "generating" silence.
  send_fail       — slice T (§6.1): POST /api/events chat.posted answers a
                    500 {error} — the visible-failure branch (default False).
  restart_bridge  — slice T (§6.3): POST {"restart_bridge": true} simulates a
                    FULL bridge restart: process-scoped state (relay queue,
                    run schedule) clears; the docs registry and the
                    conversation announce history — the disk — survive,
                    exactly the split BRIDGE-UX-1 probe 2 verified.

  chat_reject_seats — slice AB (DES-UX-001 §7.9-4): cliKeys POST /chats
                    answers ok:false + a per-seat error (open-time
                    failed-with-reason). Default [].
                    NOTE (fix J4 round 2): independent of this switch, POST
                    /chats now mirrors the REAL daemon's roster contract —
                    any cli NOT in ROSTER is rejected per-seat with the
                    core's own sentence ("no ACP config for '<key>'",
                    wicked-core acp_runner chat_ensure). The accept-anything
                    fixture is what let the fallback-trio-on-the-wire class
                    pass the rigs while the real daemon rejected every cold
                    profile's first send.
  chat_send_fail  — slice AB (§7.9-2): POST /chats/<id>/messages answers a
                    500 {error} — the draft-surviving failure. Default False.
  roster_fail     — fix J4 round 2 (§7.9-1): GET /api/v1/roster answers a
                    500 {error} — the roster-unreachable branch, where a
                    pristine first send must FAIL INLINE with nothing on the
                    wire (the trio never ships). Default False.
  chat_deltas     — slice AB (§7.9-3): sends BUFFER interleaved chatDelta
                    chunks + a chatReply per live seat; POST /__fixture
                    {"chat_flush": true} broadcasts the buffered rounds in
                    send order (so turn 2 can open before turn 1's chunks
                    arrive — the splice corpus). GET /api/v1/chats lists the
                    live pool unconditionally (the FINDING-027 wire).
                    Default False.

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
# Slice AA re-scope note (DES-UX-001 §11.2, re-derived by grep 2026-08): no rig
# asserts toast presence at fixed coordinates — the only coupling is this
# selector. Since slice AA, `gate-notification` names each toast CARD (the
# outer layer is `gate-notification-layer`, pointer-events: none), so this
# hider keeps hiding every card; nothing about its mechanism changed.
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
         # Fix slice J4/J5 (BRIEF-UX-001 re-review): the outcome-partition
         # corpus — cancelled runs in AND out of the 24h window plus undatable
         # terminal runs (no attach clock anywhere), so a rig can prove
         # cancelled ≠ failed on every surface and that windowed counts state
         # their exclusions. Switch-gated: no standing rig's board grows rows.
         "j5_runs": False,
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
         "forensics": False,
         # Slice BB (DES-UX-002 §2): the run-evidence-timeline corpus — r-auth's
         # durable tail becomes the FULL recorded chronology (real event_to_json
         # shapes with RecordedEvent's ts+seq): sessionStarted, workflowSelected,
         # unitPlanned ×2, dispatch/output for the survey, dispatch + the
         # gateEscalated -> unitReworkAmended -> re-dispatch -> gateEvaluated
         # deny arc for the review, sessionFailed. Meant to ride WITH `forensics`
         # (the units + output wires). Default False: sliceR's tail keeps its
         # historical 4-event shape.
         "timeline": False,
         # C6 fix (BRIEF-UX-002 final gate): the stale-clock reproduction —
         # EVERY clock the board could read for upload-endpoint goes 15h stale
         # (project.updated_at, the r-upload attach clock) AND the /ws
         # narration for r-upload goes silent, exactly the live-observed
         # posture (2 executing runs, chip "·15h", zero fresh frames). The run
         # DTO status stays `executing` — the ONE truth the C6 fix derives the
         # band from. Pre-fix code decays this project into QUIET; fixed code
         # keeps it WORKING forever. Default False: standing rigs keep the
         # fresh clocks + narration they assert.
         "c6_stale": False,
         # Slice BA (DES-UX-002 §1): the nerve-center plan corpus — r-upload's
         # SessionView carries the §1.5 five-unit plan (2 done, 1 distributed,
         # 2 pending; the return-to-build leg IS the 5th strip node — StageKind
         # has only 4 spellings on the wire) and unit_ix moves to the
         # distributed review. Default False: no standing rig's r-upload
         # grows units.
         "nerve": False,
         # Slice BD (DES-UX-002 §4): run ids whose SessionView flips to
         # awaiting_human on the LIST/DETAIL wires — how a rig turns a run the
         # operator annotated pre-gate into a run whose gate has ARRIVED
         # (paired with an extra_gates awaitingHuman frame; the refresh that
         # frame triggers re-reads /runs and must see the new status). The
         # cached-gate GET answers for these ids too, so a reload reconciles.
         "gate_now": [],
         # Slice V (DES-UX-001 §3/§4): the provenance + retry corpus.
         #   provenance — GET /audit?runId= gains REAL AuditEntry rows for
         #                r-auth and r-retry (actor{id,kind,trust} + the
         #                run.launched detail; r-retry's detail carries
         #                retryOf per CREW-UX-3) while r-legacy answers an
         #                EMPTY page — the degraded no-audit run. The run
         #                index gains r-retry (completed) whose session
         #                echoes retry_of:"r-auth" (api-types 0.8.0), the
         #                lineage pair both cross-links render from. POST
         #                /runs validates retryOf against the known ids
         #                (400 with the daemon's named error otherwise) and
         #                answers 201 {runId:"r-new"}. Default False: no
         #                standing rig's board grows a run.
         "provenance": False,
         # Slice V: one-shot RAW CoreEvent frames drained ONCE by the /ws
         # loop, verbatim (e.g. a sessionFailed that mints a run_failed
         # notification row). Distinct from extra_narration (which wraps
         # its lines in unitOutputDelta) and extra_gates (awaitingHuman).
         "extra_frames": [],
         # Slice S (DES-UX-001 §2.3, CREW-UX-2): run DTOs carry `project_id`,
         # r-unfiled joins the list, POST /runs launches for real. Default
         # False: no standing rig's DTO shape changes.
         "project_dto": False,
         # Slice T (DES-UX-001 §6.1, BRIDGE-UX-1 probe 1): how long one doc
         # "run" takes. 0 (default) keeps the historical instant landing every
         # standing rig assumes. >0 makes each accepted chat.posted send land
         # its OWN new version doc_run_ms after the previous landing — the
         # bridge's real queue semantics (sends ack 200 and land FIFO), slowed
         # down enough for a rig to witness generating/queued states.
         "doc_run_ms": 0,
         # Slice T (§6.1): when True, POST /api/events chat.posted answers a
         # 500 {error} — the visible-failure branch (a bridge that refuses the
         # send; the client must render thread-send-failed, never silence).
         "send_fail": False,
         # J3 fix (§6.1 honesty budget): when True, the doc wires ACK exactly as
         # the real bridge does when its worker never picks the job up — create
         # answers 201 (v1 committed, brief logged), chat.posted answers 200
         # {ok} and lands durably — but the bus then says NOTHING: no
         # status.posted, no version.created, ever. The reproduced no-answerer
         # shape (28 min of "generating" with zero backend signal); the client's
         # GENERATING_SILENCE_BUDGET_MS timeout is what stands between the user
         # and an eternal "being worked now".
         "doc_silent": False,
         # Round-3 J3: mirror the REAL bridge's create shape (generation.js) —
         # a kind:"source" create seeds a PLACEHOLDER v0 ("Building {name}…",
         # head 0) and answers 200 {name, head: 0, generating: true}; the first
         # draft lands LATER as v1 (kind "generated") when the answerer emits
         # draft.completed — doc_run_ms is how long that answerer takes.
         # Switch-gated (default False) so standing rigs keep the historical
         # v1-at-create shape; the round-3 rig runs the real v0→v1 journey.
         "doc_v0": False,
         # Round-3 J3: mirror the UNBOUND-doc reality (serviceEmit stamps
         # project_id only on docs bound to a crew project): when True, doc
         # frames ride the relay WITHOUT project_id — exactly what an Unfiled
         # doc's frames look like on the real stack. Default False: standing
         # rigs keep the stamped frames their projects legitimately have.
         "doc_unbound": False,
         # Slice U (DES-UX-001 §6.2, §8.4.1 probe 3): when True, POST
         # /api/docs answers the bridge's REAL refused-bind shape — a loud
         # 502 {"error": "crew daemon unreachable at …"} with NOTHING created
         # (server.js validates attachability BEFORE any disk write). The rig
         # drives it against a real-project mount; the Unfiled (`default`)
         # mount never binds — its create body carries no `project` field.
         "create_fail": False,
         # Slice X2 (DES-UX-001 §7.10): POST /api/v1/projects creates for real —
         # a proj_-minted id + the engine's real 409 collision sentence; created
         # rows join GET /projects. Default False: no standing rig's project
         # list grows a row it never asserted.
         "project_create": False,
         # Slice X (DES-UX-001 §7.2): how long POST /d/:doc/api/export takes
         # before answering the REAL {format, path, file, download} shape —
         # 0 (default) keeps it instant; >0 lets a rig witness export-pending.
         "export_delay_ms": 0,
         # Slice X (§7.2 / DES-MERGE-001 §4.4): when True, a pptx export
         # answers the bridge's real lazy-dependency refusal — server.js's
         # catch is `400 {error: e.message}` with pptx.js's install command
         # in the message (no separate hint field on this wire).
         "export_pptx_missing": False,
         # Slice X (§7.2): when True, theme.requested still acks {ok,...} but
         # the bridge then says NOTHING — no status frame, no theme.learned,
         # no readback ripening. The brief's real failure mode (a learn that
         # hangs silently), for the client's bounded-timeout branch.
         "learn_silent": False,
         # Slice AB (DES-UX-001 §7.9): the chat-repair corpus, all default-off.
         #   chat_reject_seats — cliKeys POST /chats answers ok:false with the
         #                       daemon's per-seat error (open-time
         #                       failed-with-reason, §7.9-4).
         #   chat_send_fail    — POST /chats/<id>/messages answers 500 {error}
         #                       (the draft-surviving failure, §7.9-2).
         #   chat_deltas       — sends BUFFER interleaved chatDelta chunks +
         #                       chatReply per live seat instead of replying;
         #                       POST /__fixture {"chat_flush": true} broadcasts
         #                       the buffered rounds in order — so a rig can
         #                       open turn 2 BEFORE turn 1's chunks arrive (the
         #                       §7.9-3 splice corpus).
         "chat_reject_seats": [], "chat_send_fail": False, "chat_deltas": False,
         # Fix J4 round 2 (§7.9-1): GET /roster answers 500 — the
         # roster-unreachable branch. A pristine first send must fail INLINE
         # (draft kept, retry) with ZERO wire calls; the trio never ships.
         "roster_fail": False,
         # Slice BC (DES-UX-002 §3): the chronicle corpus — r-retry2 + r-hooks
         # join the list, r-retry restates failed/attempt-1 (the 3-link chain),
         # auth-refactor's members wire carries the chain, /audit grows real
         # gate.decided entries and honours `?action=`. Default False: no
         # standing rig's corpus changes.
         "chronicle": False,
         # Slice BE (DES-UX-002 §8.1): the CREW-UX-7 durable-guidance store
         # (crew#312 — the doc's "CREW-UX-4", renamed) — {run_id: note}. A rig
         # seeds it over /__fixture; PUT /api/v1/runs/:id/guidance upserts it
         # exactly as the daemon does ('' clears; 8KB named 400; 404 unknown;
         # echo {runId, guidance}); the run DTOs echo `guidance` ONLY for ids
         # present here — the wire's absent-when-never-set contract.
         "guidance": {},
         # ── VIDEO-FB (the video-surface overhaul rig) ─────────────────────────
         # demo_bare_labels — the storyboard's chapter names are the BARE step
         #   indices ("0", "1", …), the live-observed junk-spec shape the cold
         #   operator hit ("1 0" / "2 1" cards): the agent authored placeholder
         #   labels into demo.spec.mjs and storyboard() rendered them verbatim.
         #   The studio substitutes the step SUBJECTS it knows from the thread's
         #   authored-spec message; this switch is that reproduction. Default
         #   False: standing rigs keep the titled chapters.
         "demo_bare_labels": False,
         # demo_record_ms — how long one demo.requested recording run takes
         #   before its version lands (0 = instant). >0 lets a rig witness the
         #   record button's point-of-action pending state (EC37).
         "demo_record_ms": 0,
         }
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

# ── Fix slice J4/J5: the outcome-partition corpus, behind `j5_runs` ───────────
#
# Cancelled ≠ failed (the J5/A5 blocker): one cancelled run INSIDE the 24h
# attach window and one outside it, plus two undatable terminal runs (failed /
# cancelled with NO membership and no clock anywhere) — so a rig can derive,
# independently: the landing's 24h failed count (1: r-auth alone), the
# all-window failed count (3: r-auth, r-legacy, r-fail-undated), the cancelled
# counts (24h: 1, all: 2), and the stated exclusions for the undatable pair.
J5_RUNS = [
    session("r-cxl-new", "cancelled", "prototype the CSV importer",
            "prototype the CSV importer"),
    session("r-cxl-old", "cancelled", "trial the queue migration",
            "trial the queue migration"),
    session("r-fail-undated", "failed", "probe the flaky webhook",
            "probe the flaky webhook"),
    session("r-cxl-undated", "cancelled", "sketch the export format",
            "sketch the export format"),
]
# The dated pair is filed under smoke-tests; the undated pair is filed NOWHERE
# (no membership → no attach clock → honest "unplaced"/"undatable").
J5_MEMBER_REFS = ["r-cxl-new", "r-cxl-old"]
ATTACHED_AT["r-cxl-new"] = NOW0 - 2 * HOUR
ATTACHED_AT["r-cxl-old"] = NOW0 - 3 * DAY

# ── Slice V (DES-UX-001 §3/§4): the provenance + retry corpus, behind `provenance` ──
#
# The lineage pair: r-auth (failed, above) was retried as r-retry, which
# COMPLETED — so the back-link ("retry of r-auth") and the forward link
# ("retried as r-retry") both have a true record to render, and the completed
# retry also pins §4.5's "terminal-but-completed runs do not render Retry".
# `retry_of` is the api-types 0.8.0 DTO echo: ABSENT (never null) on non-retries.
RETRY_RUN = session("r-retry", "completed", "refactor the auth middleware",
                    "refactor the auth middleware")
RETRY_RUN["session"]["retry_of"] = "r-auth"
RETRY_RUN["units"][0]["status"] = "done"

# GET /audit?runId= — REAL AuditEntry shapes (wicked-crew-api-types: ts, action,
# actor{id,kind,trust}, runId, detail), newest first. r-legacy deliberately has
# NO entry: the degraded "launched via API (actor unknown)" run. r-retry's
# detail carries retryOf — the CREW-UX-3 system-of-record lineage record
# (crew routes.ts:601 writes exactly this shape).
AUDIT_ACTOR = {"id": "mika", "kind": "human", "trust": "operator"}
AUDIT_ENTRIES = {
    "r-auth": [{"ts": NOW0 - 13 * MIN, "action": "run.launched", "actor": AUDIT_ACTOR,
                "runId": "r-auth",
                "detail": {"workflow": "wf-w2", "projectId": "auth-refactor"}}],
    "r-retry": [{"ts": NOW0 - 5 * MIN, "action": "run.launched", "actor": AUDIT_ACTOR,
                 "runId": "r-retry",
                 "detail": {"workflow": "wf-w2", "retryOf": "r-auth"}}],
}

# ── Slice BC (DES-UX-002 §3): the chronicle corpus, behind `chronicle` ────────
#
# Extends the slice-V lineage pair to a REAL 3-link chain (r-auth failed →
# r-retry, restated failed + attempt 1 under this corpus → r-retry2 completed,
# attempt 2) plus a standalone in-progress episode (r-hooks) in the SAME
# project — so the chronicle's EC50 grouping (retry siblings are sub-rows of
# one episode, never peer rows) and the mixed-card scene both have true
# records. The unfiled episode stays r-unfiled (`project_dto` on): a null
# project claim that must never leak into a project's chronicle.
RETRY_RUN2 = session("r-retry2", "completed", "refactor the auth middleware",
                     "refactor the auth middleware")
RETRY_RUN2["session"]["retry_of"] = "r-retry"
RETRY_RUN2["session"]["attempt"] = 2
# Three DONE units across three stages — the current-state strip's honest
# "3 phases" count (§3.3) reads exactly these.
RETRY_RUN2["units"] = [
    {**RETRY_RUN2["units"][0], "id": f"r-retry2:u{i}", "ord": i, "stage": stage,
     "description": desc, "status": "done"}
    for i, (stage, desc) in enumerate([
        ("recon", "survey the middleware call sites"),
        ("build", "refactor the auth middleware"),
        ("review", "review the refactor against the test suite"),
    ])
]
CHRONICLE_SOLO = session("r-hooks", "executing", "add pre-commit hooks to the repo",
                         "add pre-commit hooks to the repo")
CHRONICLE_RUNS = [RETRY_RUN2, CHRONICLE_SOLO]
CHRONICLE_MEMBER_REFS = ["r-retry", "r-retry2", "r-hooks"]
ATTACHED_AT["r-retry"] = NOW0 - 5 * MIN
ATTACHED_AT["r-retry2"] = NOW0 - 3 * MIN
ATTACHED_AT["r-hooks"] = NOW0 - 90 * SEC

# The chain tip's durable trail: sessionStarted → workflowSelected (EVT-001,
# camelCase per event_to_json) → a PASSED gateEvaluated (the full B1 shape,
# `combined: true`) → sessionCompleted. The current-state strip derives its
# criterion phrase + workflow from exactly this tail.
CHRONICLE_TIP_CRITERION = "auth middleware refactor passes the full test suite"
CHRONICLE_EVENTS = {
    "r-retry2": [
        {"type": "sessionStarted", "session": "r-retry2", "ts": NOW0 - 3 * MIN},
        {"type": "workflowSelected", "session": "r-retry2", "workflowId": "wf-w2",
         "unitCount": 3, "ts": NOW0 - 3 * MIN + 2 * SEC},
        {"type": "gateEvaluated", "session": "r-retry2", "ord": 2,
         "criterion": CHRONICLE_TIP_CRITERION, "hasDeterministicFloor": True,
         "deterministicPass": True, "agentVerdict": None, "agentReasoning": None,
         "evaluatorPass": True, "evaluatorPolicies": ["qe-default"],
         "denialReason": None, "combined": True, "ts": NOW0 - 2 * MIN - 10 * SEC},
        {"type": "sessionCompleted", "session": "r-retry2", "ts": NOW0 - 2 * MIN},
    ],
}

# GET /audit?action=gate.decided — the REAL entry shape routes.ts:983 writes:
# detail {approve, amend?, status}. One amend per lineage decision, one plain
# reject (no amend — a decision, not guidance) and one FOREIGN-project amend
# (r-upload, filed under upload-endpoint) the client's scope filter must drop.
GATE_DECIDED_ENTRIES = [
    {"ts": NOW0 - 2 * MIN, "action": "gate.decided", "actor": AUDIT_ACTOR,
     "runId": "r-retry2",
     "detail": {"approve": True,
                "amend": "keep the session-token API unchanged; refactor only the middleware layer",
                "status": "resumed"}},
    {"ts": NOW0 - 4 * MIN, "action": "gate.decided", "actor": AUDIT_ACTOR,
     "runId": "r-retry", "detail": {"approve": False, "status": "cancelled"}},
    {"ts": NOW0 - 12 * MIN, "action": "gate.decided", "actor": AUDIT_ACTOR,
     "runId": "r-auth",
     "detail": {"approve": True,
                "amend": "focus on the middleware tests, skip the docs pass",
                "status": "resumed"}},
    {"ts": NOW0 - HOUR, "action": "gate.decided", "actor": AUDIT_ACTOR,
     "runId": "r-upload",
     "detail": {"approve": True, "amend": "rate-limit by API key, not by IP",
                "status": "resumed"}},
]

# ── Slice S (DES-UX-001 §2.3): the CREW-UX-2 project_id corpus, behind
#    `project_dto` ──────────────────────────────────────────────────────────────
#
# The run→project truth the DTO echoes (api-types 0.8.0): a string for every
# membership above, `None` (JSON null) for a run the daemon GENUINELY considers
# unfiled — never the absent field, which spells a pre-0.8.0 server.
RUN_PROJECT = {ref: pid for pid, refs in MEMBERS.items() for ref in refs}

# The null-claim run: on the list, filed nowhere, no membership names it. The
# board's "not in a project" shelf must show it off DTO truth alone — no
# membership hold-back, no join.
UNFILED_RUN = session("r-unfiled", "executing", "poke at the flaky CI job",
                      "poke at the flaky CI job")

# Runs launched over POST /api/v1/runs this server lifetime (project_dto on):
# each entry rides GET /runs (its session carrying the `project_id` echo) and —
# when filed — its project's members wire, the atomic attach (routes.ts:148,
# "never a silent unfiled run"). Guarded by state_lock.
launched_runs: list = []          # SessionView dicts, project_id already stamped
launched_members: dict = {}       # pid -> [run ids]
launched_seq = [0]

# ── Slice X2 (DES-UX-001 §7.10): projects created over POST /api/v1/projects ──
# Behind the `project_create` switch (default False — no standing rig's project
# list grows a row). The route mirrors the REAL daemon contract verbatim:
# 201 {project} with a wicked-core-shaped `proj_<millis:013><seq:05>` id
# (project.rs:189 — never derived from the name) and the engine's real 409
# sentence on an active-name collision (project.rs:236). Created rows join
# GET /projects for this server lifetime. Guarded by state_lock.
created_projects: list = []       # Project dicts, proj_-minted ids
created_seq = [100000]            # the engine's seq starts fresh per process

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
# Slice AA: the CREW-UX-2 DTO echo covers ALL membership records, the batch
# corpus included — with `project_dto` + `batch_gates` both on, a batch run's
# session claims its project (the daemon echoes every membership, not just
# W2's). No standing rig combines the two switches; slice AA's B4 scene does.
RUN_PROJECT.update({rid: pid for pid, rids in BATCH_MEMBERS.items() for rid in rids})
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

# ── Slice BB (DES-UX-002 §2): the timeline corpus, behind `timeline` ──────────
#
# r-auth's WHOLE durable tail as core's event log would replay it: every frame
# is the REAL event_to_json shape (wicked-core event.rs — camelCase keys:
# sessionStarted's workflowId/cliCount/entityMode; unitPlanned's stage/role/
# gate/skillRef/hasValidatorPin/executorType; unitReworkAmended's amendment +
# updatedDescription — the wire spelling of §2.2's "amended_description"),
# wearing RecordedEvent's ts + seq envelope. The story stays r-auth's true one
# (survey done -> review gate-denied -> failed), now with the §2.3 arc the
# timeline renders: escalation, the operator's amendment, the re-dispatch, and
# the standing FORENSICS_GATE_DENY as the deciding verdict.

TIMELINE_AMENDMENT = (
    "Keep the token-refresh path: preserve the expired-access + valid-refresh "
    "branch and re-run auth.refresh.spec before resubmitting."
)
TIMELINE_T0 = NOW0 - 13 * MIN


def _timeline_planned(ord_: int, desc: str, stage: str, seq: int, ts: int) -> dict:
    return {"type": "unitPlanned", "session": "r-auth", "ord": ord_,
            "description": desc, "stage": stage, "role": None, "gate": None,
            "skillRef": None, "hasValidatorPin": True, "executorType": "cli",
            "ts": ts, "seq": seq}


TIMELINE_AUTH_EVENTS = [
    {"type": "sessionStarted", "session": "r-auth",
     "problem": "refactor the auth middleware", "workflowId": "wf-w2",
     "cliCount": 1, "governed": True, "entityMode": "shared",
     "ts": TIMELINE_T0, "seq": 1},
    {"type": "workflowSelected", "session": "r-auth", "workflowId": "wf-w2",
     "unitCount": 2, "ts": TIMELINE_T0 + SEC, "seq": 2},
    _timeline_planned(0, "survey the auth middleware surface", "recon", 3,
                      TIMELINE_T0 + 2 * SEC),
    _timeline_planned(1, "review the middleware refactor", "review", 4,
                      TIMELINE_T0 + 2 * SEC),
    {"type": "unitDispatched", "session": "r-auth", "ord": 0, "attempt": 0,
     "ts": TIMELINE_T0 + 3 * SEC, "seq": 5},
    {"type": "unitOutputCaptured", "session": "r-auth", "ord": 0, "attempt": 0,
     "outputBytes": len(FORENSICS_SURVEY_OUTPUT.encode()), "stepStatus": "ok",
     "governed": True, "ts": TIMELINE_T0 + 20 * SEC, "seq": 6},
    {"type": "unitDispatched", "session": "r-auth", "ord": 1, "attempt": 0,
     "ts": TIMELINE_T0 + 21 * SEC, "seq": 7},
    {"type": "gateEscalated", "session": "r-auth", "ord": 1,
     "condition": FORENSICS_GATE_DENY["criterion"],
     "verdictSummary": "agent judge: fail — the token-refresh path is dropped",
     "ts": TIMELINE_T0 + 35 * SEC, "seq": 8},
    {"type": "unitReworkAmended", "session": "r-auth", "ord": 1,
     "amendment": TIMELINE_AMENDMENT,
     "updatedDescription": f"review the middleware refactor — {TIMELINE_AMENDMENT}",
     "ts": TIMELINE_T0 + 40 * SEC, "seq": 9},
    {"type": "unitDispatched", "session": "r-auth", "ord": 1, "attempt": 1,
     "ts": TIMELINE_T0 + 41 * SEC, "seq": 10},
    {**FORENSICS_GATE_DENY, "seq": 11},
    {"type": "sessionFailed", "session": "r-auth", "ord": 1,
     "ts": NOW0 - 12 * MIN, "seq": 12},
]

# How long r-legacy's /diff HANGS before releasing its (daemon) thread with a
# late answer — well past the client's own timeout budget, so the rig proves
# the client reached its error branch on its OWN clock, having dispatched ≥1
# real fetch (the zero-request-hang regression trap, §1.3-4b).
FORENSICS_DIFF_HANG_SECONDS = 30

# ── Slice BA (DES-UX-002 §1): the nerve-center plan corpus, behind `nerve` ────
#
# r-upload's plan grows to §1.5's shape: 5 ordered units, 2 done, 1 active
# (distributed), 2 pending. Every field is the REAL WorkUnit DTO; the stages
# are the wire's own 4 StageKind spellings, so the 5th strip node is the
# return-to-build leg after review — a distinct leg of the plan, not an
# invented stage. u2's description exceeds 60 chars on purpose: the §1.5
# truncation AC needs a real overflow to prove the honest ellipsis.


def _nerve_unit(ord_: int, desc: str, stage: str, status: str) -> dict:
    return {"id": f"r-upload:u{ord_}", "session_id": "r-upload", "ord": ord_,
            "description": desc, "stage": stage,
            "assigned_cli": "claude" if status != "pending" else None,
            "assigned_invocation": None, "council_task_ref": None, "routing": None,
            "denial_reason": None, "phase_ref": None, "conformance_ref": None,
            "phase_status": None, "collection_scope": None, "status": status}


NERVE_UPLOAD_UNITS = [
    _nerve_unit(0, "survey the upload endpoint's rate-limit surface", "recon", "done"),
    _nerve_unit(1, "wire the token-bucket middleware into /upload", "build", "done"),
    _nerve_unit(2, "review the rate-limit middleware against the acceptance criteria list",
                "review", "distributed"),
    _nerve_unit(3, "apply the review fixes to the middleware chain", "build", "pending"),
    _nerve_unit(4, "run the rate-limit acceptance suite end to end", "test", "pending"),
]

# Slice BD (DES-UX-002 §4): the prompt the arrived gate carries once a rig
# flips `gate_now` for r-upload — before nerve unit 3, the same seam the
# gateEscalated preview named.
GATE_NOW_PROMPT = ("Approve unit 3 before it runs: apply the review fixes to "
                   "the middleware chain")

# ── The Video surface's recorded demo (DES-VISION-001 §5.6, re-grounded by the
#    VIDEO-FB round) ─────────────────────────────────────────────────────────────
#
# The interactive bridge, reduced to what Video mode reads through crew's proxy:
# a `kind: "demo"` doc in q3-review-deck's registry, its version manifest, the
# storyboard version HTML, and the recording endpoint the storyboard embeds.
#
# VIDEO-FB re-ground: the storyboard below mirrors the REAL bridge's
# `storyboard()` (wicked-interactive src/service/demo.js) — a `<video>` whose
# src is the ROOT-ABSOLUTE `/d/<doc>/api/demo/recording/_v<N>.webm`, chapter
# buttons whose thumbnails ride the same root-absolute endpoint, wi-demo__*
# classes and the inline seek script. The previous fixture shape (a GIF at a
# RELATIVE `../demo/` path) is exactly what let the base-href machinery
# self-confirm while every real storyboard's root-absolute URLs fell through to
# the SPA fallback and answered HTML (MediaError 4). The recording endpoint
# serves a real tiny VP8 webm (e2e/fixtures/tiny.webm, checked in) with Range
# support, so a rig can assert the <video> actually reaches loadeddata.
# All behind the `demo` switch so the board rigs' doc tiles never grow a tile
# they did not assert. Thumbs are drawn lazily with Pillow and cached.

DEMO_NAME = "checkout-demo"
DEMO_TARGET = "https://shop.example/"
DEMO_STEPS = [
    {"index": 0, "title": "Open the storefront", "timestamp": 0,
     "action": "land on the home page"},
    {"index": 1, "title": "Add a hoodie to the cart", "timestamp": 6,
     "action": "put one in the basket"},
    {"index": 2, "title": "Enter the card details", "timestamp": 13,
     "action": "fill the payment form"},
    {"index": 3, "title": "Confirm the order", "timestamp": 21,
     "action": "place the order"},
]

# The demo's AUTHORED SPEC as its conversation's opening message — the exact
# `demoBrief()` shape the wizard writes (`N. subject — action` per step). The
# thread-history read (GET /d/:doc/api/conversation) serves it, which is BOTH
# the video-mode reload-restore AC's corpus AND where the studio reads the step
# SUBJECTS it substitutes for a junk-labelled storyboard's chapter names.
DEMO_BRIEF = f"Record a demo of {DEMO_TARGET}:\n" + "\n".join(
    f"{i + 1}. {s['title']} — {s['action']}" for i, s in enumerate(DEMO_STEPS))

# The demo's manifest is MUTABLE now (VIDEO-FB): a demo.requested recording run
# appends a new `kind:"demo"` landing, exactly as materializeDemo commits one.
demo_lock = threading.Lock()
demo_versions_list: list = [
    {"version": 1, "parent": None, "feedback_file": None, "html_file": "_v1.html",
     "created_at": iso(NOW0 - 5 * MIN), "meta": {}}]


def demo_manifest() -> dict:
    with demo_lock:
        versions = [dict(e) for e in demo_versions_list]
    return {"head": max(e["version"] for e in versions), "kind": "demo",
            "versions": versions}


def demo_doc_row() -> dict:
    m = demo_manifest()
    return {"name": DEMO_NAME, "kind": "demo", "head": m["head"],
            "versions": len(m["versions"]), "updated_at": iso(NOW0 - 5 * MIN)}


def demo_land_recording() -> int:
    """Commit one recording landing (the materializeDemo shape) and announce it:
    a status line naming the work, then version.created kind "demo"."""
    with demo_lock:
        v = max(e["version"] for e in demo_versions_list) + 1
        demo_versions_list.append(
            {"version": v, "parent": v - 1, "feedback_file": None,
             "html_file": f"_v{v}.html", "created_at": iso(NOW0 + v * SEC), "meta": {}})
    queue_interactive("wicked.interactive.version.created", {
        "project_id": "q3-review-deck", "document_id": DEMO_NAME,
        "version": v, "parent": v - 1, "kind": "demo", "html_file": f"_v{v}.html"})
    return v


def fmt_time(seconds: int) -> str:
    s = max(0, int(seconds))
    return f"{s // 60}:{s % 60:02d}"


def storyboard_doc_html(version: int, bare_labels: bool = False) -> str:
    """The demo's version HTML — its STORYBOARD, as the REAL bridge's
    storyboard() lands it (demo.js): the `<video>` at the doc's ROOT-ABSOLUTE
    recording endpoint, chapter buttons with root-absolute thumbnails, the
    inline seek script. `bare_labels` reproduces the junk-spec labels the cold
    operator hit (chapter names that are the bare step indices)."""
    rec = f"/d/{DEMO_NAME}/api/demo/recording"
    chapters = "".join(
        f'<li><button class="wi-demo__chapter" type="button" data-seek="{s["timestamp"]}"'
        f' title="Jump to {s["title"]}">'
        f'<span class="wi-demo__thumb">'
        f'<img src="{rec}/_v{version}.step{i:02d}.png" alt="" loading="lazy">'
        f'<span class="wi-demo__badge">{fmt_time(s["timestamp"])}</span></span>'
        f'<span class="wi-demo__cap"><span class="wi-demo__idx">{i + 1}</span>'
        f'<span class="wi-demo__name">{i if bare_labels else s["title"]}</span></span>'
        f"</button></li>"
        for i, s in enumerate(DEMO_STEPS))
    script = (
        '<script>(function(){var v=document.getElementById("wi-demo-video");if(!v)return;'
        'var cs=document.querySelectorAll(".wi-demo__chapter");'
        "for(var i=0;i<cs.length;i++){(function(b){b.addEventListener(\"click\",function(){"
        'var t=parseFloat(b.getAttribute("data-seek"))||0;try{v.currentTime=t;}catch(e){}'
        "v.play().catch(function(){});});})(cs[i]);}})();</script>")
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
        "body{margin:0;background:#fff;color:#1e293b;font:14px system-ui}"
        ".wi-demo{max-width:920px;margin:0 auto;padding:8px 4px 40px}"
        ".wi-demo__player{margin:0 0 22px;border-radius:8px;overflow:hidden;background:#0b1020}"
        ".wi-demo__player video{display:block;width:100%;height:auto;background:#0b1020}"
        ".wi-demo__chapters{list-style:none;margin:0;padding:0;display:grid;"
        "grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}"
        ".wi-demo__chapter{display:flex;flex-direction:column;text-align:left;width:100%;"
        "padding:0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;"
        "background:#fff;color:inherit;font:inherit;cursor:pointer}"
        ".wi-demo__thumb{position:relative;display:block;width:100%;aspect-ratio:16/9;background:#0b1020}"
        ".wi-demo__thumb img{display:block;width:100%;height:100%;object-fit:cover}"
        ".wi-demo__badge{position:absolute;right:6px;bottom:6px;background:rgba(11,16,32,.85);"
        "color:#fff;font-size:12px;padding:2px 6px;border-radius:4px}"
        ".wi-demo__cap{display:flex;gap:8px;align-items:baseline;padding:10px 12px}"
        ".wi-demo__idx{font-size:12px;font-weight:700;color:#0891b2}"
        ".wi-demo__name{font-weight:600;color:#1e293b;font-size:14px;line-height:1.3}"
        "</style></head>"
        f'<body data-storyboard="{DEMO_NAME}" data-storyboard-version="{version}">'
        '<section class="wi-demo">'
        f"<header class=\"wi-demo__head\"><h1>{DEMO_NAME}</h1>"
        '<p class="wi-demo__target">Recorded against '
        '<a href="https://shop.example/" target="_blank" rel="noopener">https://shop.example/</a></p>'
        "</header>"
        '<div class="wi-demo__player">'
        f'<video id="wi-demo-video" controls playsinline preload="metadata"'
        f' src="{rec}/_v{version}.webm"></video></div>'
        '<p class="wi-demo__chaptitle">Chapters</p>'
        f'<ol class="wi-demo__chapters">{chapters}</ol>'
        f"{script}</section></body></html>")


# The recording bytes: a REAL (tiny) VP8 webm, checked in — the rig's <video>
# must reach loadeddata against real bytes, not a stand-in the browser rejects.
_tiny_webm: list = [None]


def tiny_webm() -> bytes:
    if _tiny_webm[0] is None:
        _tiny_webm[0] = (Path(__file__).resolve().parent / "fixtures" / "tiny.webm").read_bytes()
    return _tiny_webm[0]


_demo_frames: dict = {}


def demo_frame(step: int, title: str) -> bytes:
    """Draw one chapter thumbnail with Pillow, lazily, cached — a light
    browser-window pastiche so the thumbs read as CONTENT."""
    cached = _demo_frames.get(step)
    if cached is not None:
        return cached
    import io

    from PIL import Image, ImageDraw

    img = Image.new("RGB", (296, 168), (244, 241, 234))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 296, 22], fill=(255, 253, 247), outline=(221, 214, 196))
    d.rectangle([24, 44, 272, 132], fill=(255, 253, 247), outline=(221, 214, 196))
    d.rounded_rectangle([24 + step * 30, 140, 80 + step * 30, 158], radius=6, fill=(27, 98, 74))
    d.text((36, 52), title, fill=(27, 27, 27))
    d.text((36, 76), f"step {step + 1}", fill=(120, 116, 106))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    body = buf.getvalue()
    _demo_frames[step] = body
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
#
# Fix J4 round 3+4 (EC44): each seat also mirrors the real roster's CHAT-
# capability marker — `acp` is the engine's ACP config object on seats that
# can hold a chat session and ABSENT on seats that cannot: `AgenticCli.acp`
# is `#[serde(skip_serializing_if = "Option::is_none")]` (wicked-council
# types.rs, since the field's introduction), so the engine NEVER serializes
# a null — absence is the wire's only spelling of "no config" (verified
# against the live daemon round 4: acp objects on claude/pi, no key at all
# on agy/codex/copilot/opencode; wicked-core's chat_ensure answers
# "no ACP config for '<key>'" for those). Here `claude` and `pi` carry the
# object (the live capable pair), `codex` carries NO key — the REAL
# incapable spelling — and `agy` carries an explicit null: no current
# engine emits it, but the client treats a null claim as "no config" too
# (belt), and the fixture keeps that arm honest end-to-end.
CODEX_HEALTH_MESSAGE = ("quota exceeded: the monthly usage limit for this "
                        "seat has been reached upstream")
ROSTER = [
    {"key": "claude", "display_name": "claude", "binary": "claude",
     "enabled_for_council": True, "signed_in": True,
     "acp": {"binary": "claude-agent-acp", "start_args": [], "transport": "stdio"},
     "health": {"status": "active", "since": iso(NOW0 - 2 * DAY)}},
    {"key": "codex", "display_name": "codex", "binary": "codex",
     "enabled_for_council": True, "signed_in": False,
     "health": {"status": "inactive", "message": CODEX_HEALTH_MESSAGE,
                "since": iso(NOW0 - 2 * HOUR), "lastErrorAt": iso(NOW0 - 2 * HOUR)}},
    {"key": "agy", "display_name": "agy", "binary": "agy",
     "enabled_for_council": True, "signed_in": True, "acp": None,
     "health": {"status": "active", "since": iso(NOW0 - 2 * DAY)}},
    {"key": "pi", "display_name": "pi", "binary": "pi", "enabled_for_council": True,
     "acp": {"binary": "pi-acp", "start_args": [], "transport": "stdio"}},
]

# The chat-capable subset (EC44, round-4 corrected polarity): an acp OBJECT
# is capable; explicit null is not; an ABSENT key is "no config" whenever ANY
# seat in the roster speaks the field (skip_serializing_if — the engine never
# writes null), and "no claim = capable" only on a roster with no acp key
# anywhere (a daemon predating the field).
_SPEAKS_ACP = any("acp" in s for s in ROSTER)
CHAT_CAPABLE_KEYS = [
    s["key"] for s in ROSTER
    if isinstance(s.get("acp"), dict) or ("acp" not in s and not _SPEAKS_ACP)
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


def assemble_runs() -> list:
    """The run corpus under the CURRENT switches — shared by GET /runs and the
    slice-V single-run GET /runs/<id> so both wires decorate identically."""
    with state_lock:
        if state["no_runs"]:
            runs = []
        else:
            runs = RUNS + ([ORPHAN] if state["orphan"] else []) \
                + ([LONG_RUN] if state["long_prompt"] else []) \
                + ([CHAT_LIVE, CHAT_GATED] if state["chat_runs"] else []) \
                + (BATCH_RUNS if state["batch_gates"] else []) \
                + ([RETRY_RUN] if state["provenance"] or state["chronicle"] else []) \
                + (CHRONICLE_RUNS if state["chronicle"] else []) \
                + (J5_RUNS if state["j5_runs"] else [])
        viewer_on = state["viewer"]
        repo_refs_on = state["repo_refs"]
        forensics_on = state["forensics"]
        provenance_on = state["provenance"]
        project_dto_on = state["project_dto"]
        chronicle_on = state["chronicle"]
        nerve_on = state["nerve"]
        gate_now = list(state["gate_now"])
        guidance = dict(state["guidance"])
        # Slice S (DES-UX-001 §2.3): the null-claim run + this-lifetime launches
        # join BOTH wires (list + detail) so the DTO echo decorates identically.
        if project_dto_on and not state["no_runs"]:
            runs = runs + [UNFILED_RUN] + launched_runs
    if viewer_on or repo_refs_on or forensics_on or provenance_on or project_dto_on \
            or chronicle_on or nerve_on or gate_now or guidance:
        runs = json.loads(json.dumps(runs))
        for r in runs:
            # Slice BE (CREW-UX-7, crew#312): the DTO echoes the durable note
            # ONLY when one is set — ABSENT (never null/'') otherwise, the
            # api-types 0.9.0 contract the studio's absent-when-never reads.
            note = guidance.get(r["session"]["id"])
            if note:
                r["session"]["guidance"] = note
            # Slice BA: r-upload's §1.5 five-unit plan; unit_ix follows the
            # distributed review (the unit the run is genuinely ON).
            if nerve_on and r["session"]["id"] == "r-upload":
                r["units"] = json.loads(json.dumps(NERVE_UPLOAD_UNITS))
                r["session"]["unit_ix"] = 2
            # Slice BD (DES-UX-002 §4): the annotated run's gate ARRIVED — the
            # run is now genuinely awaiting a human on both wires.
            if r["session"]["id"] in gate_now:
                r["session"]["status"] = "awaiting_human"
            # Slice V: the CREW-UX-2 DTO echo for the lineage pair — the retry
            # prefill's project binding reads it (`project_id`, api-types 0.8.0).
            if provenance_on and r["session"]["id"] in ("r-auth", "r-retry"):
                r["session"]["project_id"] = "auth-refactor"
            # Slice BC (DES-UX-002 §3): under the chronicle corpus r-retry is
            # the chain's FAILED middle attempt (attempt 1 — retried again as
            # r-retry2), and the whole chain + the solo episode claim their
            # project on the DTO (the CREW-UX-2 echo the scope filter reads).
            if chronicle_on and r["session"]["id"] == "r-retry":
                r["session"]["status"] = "failed"
                r["session"]["attempt"] = 1
            if chronicle_on and r["session"]["id"] in (
                    "r-auth", "r-retry", "r-retry2", "r-hooks"):
                r["session"]["project_id"] = "auth-refactor"
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
            # Slice S (CREW-UX-2): the DTO echoes the membership record —
            # ALWAYS present with the corpus on (string | null), the
            # api-types 0.8.0 contract. Launched runs arrive pre-stamped;
            # slice V's explicit lineage-pair stamp above wins when both
            # corpora are on (this is the membership-derived fallback).
            if project_dto_on and "project_id" not in r["session"]:
                r["session"]["project_id"] = RUN_PROJECT.get(r["session"]["id"])
    return runs


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

# ── docfb2: materialized feedback (the REAL materializeFeedback shape) ────────
# A feedback.submitted batch's content-edits are applied DETERMINISTICALLY to the
# head HTML and land as a new version (kind "deterministic"), mirroring
# wicked-interactive handlers.js materializeFeedback → applyFeedbackItems. The
# landed HTML lives here, keyed by version; the doc GET route serves it verbatim.
doc_html_overrides: dict = {}  # (pid, doc, version) -> html
# The batch's write 2 is a chat.posted inject carrying the SAME source_message_id.
# The real answerer does not regenerate on it (the batch already landed its own
# version), so the fixture must not mint a steer version for that inject either.
feedback_msg_ids: dict = {}    # (pid, doc) -> {source_message_id, …}

# ── Slice K (DES-FEEDBACK-002 §6): per-chat reply bookkeeping ─────────────────
# Which seats each fixture chat warmed, which have since failed, and how many
# sends it has taken — so the switch-gated reply drip fans out to exactly the
# seats the daemon would (warm minus failed), never to an invented roster.
chat_state_lock = threading.Lock()
chat_warm_seats: dict = {}   # chat_id -> [cliKey, warm order]
chat_dead_seats: dict = {}   # chat_id -> set of cliKeys that chatSessionFailed
chat_send_count: dict = {}   # chat_id -> number of message fan-outs so far
# Slice AB (§7.9-3): rounds buffered while `chat_deltas` is on — each entry is
# the ordered frame list one send produced (interleaved chunks, then replies).
# POST /__fixture {"chat_flush": true} broadcasts them in send order.
chat_round_buffer: list = []

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


# ── Slice T (DES-UX-001 §6.3): the doc's announce history, as the REAL bridge
# keeps it (BRIDGE-UX-1 probe 2 pinned the shape): user chat + agent narration
# (error states included) as {role, text, ts[, state]} — no message ids, no
# version markers. It lives OUTSIDE process-restart scope by design: the real
# store is conversation.jsonl on disk and survives a full bridge restart, which
# is what the `restart_bridge` control simulates (ws state clears, this stays).
conversations_lock = threading.Lock()
conversations: dict = {}  # (pid, doc) -> [{role, text, ts[, state]}]


def log_conversation(pid: str, doc: str, role: str, text: str, state_val: str | None = None) -> None:
    entry = {"role": role, "text": text, "ts": iso(int(time.time() * 1000))}
    if state_val == "error":
        entry["state"] = state_val
    with conversations_lock:
        conversations.setdefault((pid, doc), []).append(entry)


def queue_interactive(event_type: str, payload: dict) -> None:
    """Queue one relayed interactive frame for the /ws loop's next tick."""
    # Slice T: doc-scoped narration is ALSO appended to the durable announce
    # history — the same dual-write the real bridge does (SSE relay + JSONL),
    # so GET /d/:doc/api/conversation reads back what the stream said.
    # (Logged BEFORE the unbound strip below: the disk knows the doc's home
    # even when the frame does not carry it — same as the real bridge.)
    if event_type == "wicked.interactive.status.posted":
        pid, doc = payload.get("project_id"), payload.get("document_id")
        text = payload.get("message")
        if pid and doc and text:
            log_conversation(pid, doc, "agent", str(text), payload.get("state"))
    # Round-3 J3 (`doc_unbound`): an UNBOUND doc's frames carry no project_id on
    # the real relay (serviceEmit stamps only bound docs) — mirror that shape.
    with state_lock:
        unbound = state["doc_unbound"]
    if unbound and payload.get("document_id"):
        payload = {k: v for k, v in payload.items() if k != "project_id"}
    with ws_lock:
        ws_queue.append({"type": "interactiveEvent",
                         "event": {"event_type": event_type, "payload": payload}})


# Slice T (§6.1): the per-doc "agent" is BUSY between a send and its landing —
# a second send queues behind it, exactly the FIFO the probe pinned. Each
# scheduled landing appends a NEW version and emits the same two frames the
# instant path emits, doc_run_ms after the previous landing completes.
doc_sched_lock = threading.Lock()
doc_next_free: dict = {}  # (pid, doc) -> unix seconds when the agent frees up


def schedule_doc_run(pid: str, doc: str, delay_s: float, fixed_version: int | None = None) -> None:
    """Land one version after `delay_s` of FIFO-queued work. `fixed_version`
    re-announces an existing manifest version (the create path, whose v1 is
    committed at POST time); None appends head+1 (a steer send's own landing)."""
    with doc_sched_lock:
        start = max(time.time(), doc_next_free.get((pid, doc), 0.0))
        fire_at = start + delay_s
        doc_next_free[(pid, doc)] = fire_at

    def land() -> None:
        if fixed_version is None:
            with docs_lock:
                versions = docs_created.get(pid, {}).get(doc)
                if versions is None:
                    return
                v = max(e["version"] for e in versions) + 1
                versions.append({"version": v, "parent": v - 1, "feedback_file": None,
                                 "html_file": f"v{v}.html", "created_at": iso(NOW0 + v * SEC)})
            parent = v - 1
        else:
            v, parent = fixed_version, None
        queue_interactive("wicked.interactive.status.posted", {
            "project_id": pid, "document_id": doc, "state": "working",
            "message": f"Applying the change — landing v{v}."})
        queue_interactive("wicked.interactive.version.created", {
            "project_id": pid, "document_id": doc,
            "version": v, "parent": parent, "kind": "generated"})

    threading.Timer(max(fire_at - time.time(), 0.0), land).start()


# ── Slice X (DES-UX-001 §7.2): the REAL export wire, as server.js serves it ───
#
# POST /api/export (per-doc mount) answers `{format, path, file, download}` with
# `download` bridge-root-relative (`/d/<doc>/api/export/file/<name>` — req.baseUrl
# is the doc mount), and GET /api/export/file/:name serves the bytes with a
# Content-Disposition attachment. The pptx lazy-dependency refusal is the bridge's
# real catch shape: `400 {error}` carrying pptx.js's install command in the message.
# Standing rigs never POST this route, so serving it changes no standing board.
exports_lock = threading.Lock()
exports_created: dict = {}  # (pid, doc, file) -> format

PPTX_MISSING_ERROR = "PowerPoint export needs python-pptx — run: pip install python-pptx"


def export_bytes(doc: str, version: int, fmt: str) -> bytes:
    """The artifact's bytes — enough to make the download REAL (a saved file with
    content), without faking a renderer the fixture does not have."""
    if fmt == "html":
        return doc_html(doc, version).encode()
    if fmt == "pdf":
        return b"%PDF-1.4\n% wicked-studio fixture export of " + doc.encode() + b"\n%%EOF\n"
    return b"PK\x03\x04 wicked-studio fixture pptx export of " + doc.encode()


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "doc"


def doc_versions(pid: str, doc: str) -> list:
    with docs_lock:
        return list(docs_created.get(pid, {}).get(doc, []))


def doc_html(doc: str, version: int) -> str:
    """The rendered document at one version — a light deck slide, so the canvas reads
    as a document against the app chrome and the v1→v2 headline change is visible.
    v0 is the REAL bridge's generation placeholder (generation.js), verbatim in
    spirit: 'Building {name}…' + the updates-automatically promise — what the
    canvas shows between create and the answerer's first draft (doc_v0)."""
    if version == 0:
        title = doc.replace("-", " ")
        return (f"<!doctype html><html><head><meta charset=\"utf-8\"><title>{doc} v0</title>"
                "</head><body><section>"
                f"<h1>Building {title}…</h1>"
                "<p class=\"lead\">Reading your brief and drafting your document. "
                "This view updates automatically the moment the first draft is ready.</p>"
                "</section></body></html>")
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

    def _media(self, body: bytes, ctype: str) -> None:
        """Serve media bytes the way the bridge's recording route does. A media
        element asks in Ranges (Chromium sends `bytes=0-` for a <video>), so a
        single-range request is answered 206 — without it the element can stall
        before `loadeddata` and the playback AC would flake on a rig artifact."""
        rng = self.headers.get("Range") or ""
        m = re.match(r"^bytes=(\d*)-(\d*)$", rng)
        if m and (m.group(1) or m.group(2)):
            start = int(m.group(1) or 0)
            end = int(m.group(2)) if m.group(2) else len(body) - 1
            end = min(end, len(body) - 1)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{len(body)}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            chunk = body[start:end + 1]
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(chunk)))
            self.end_headers()
            self.wfile.write(chunk)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
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
                frames_extra: list = []
                if newest:
                    with state_lock:
                        extra, state["extra_narration"] = list(state["extra_narration"]), []
                        gates_extra, state["extra_gates"] = list(state["extra_gates"]), []
                        frames_extra, state["extra_frames"] = list(state["extra_frames"]), []
                # Slice V: raw one-shot CoreEvent frames, verbatim (e.g. a
                # sessionFailed that mints a run_failed notification row).
                for frame in frames_extra:
                    self.wfile.write(ws_frame(frame))
                # A plain string keeps the historical shape (r-upload ord 0 —
                # every standing rig); a dict targets {session, ord?, text} so
                # the slice-Z rig can drip REAL frames at a run it just
                # launched over POST /runs (DES-UX-001 §7.6 / EC41: the live
                # region on the run's OWN page, not only the standing r-upload).
                for line in extra:
                    if isinstance(line, dict):
                        self.wfile.write(ws_frame({
                            "type": "unitOutputDelta",
                            "session": line["session"],
                            "ord": line.get("ord", 0),
                            "text": str(line.get("text", "")) + "\n",
                        }))
                    else:
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
                # C6 fix: under the stale-clock reproduction r-upload streams
                # NOTHING — the run executes with zero fresh frames, so the
                # only working-band evidence the board holds is the DTO status.
                # Read per-tick so a rig can flip it without reconnecting.
                with state_lock:
                    c6_mute = state["c6_stale"]
                if not c6_mute:
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
            self._json(200, {"runs": assemble_runs()})
            return True
        # Slice V: GET /runs/<id> — one run's detail (`{run: SessionView}`), the
        # real daemon contract useRunModel re-hydrates on. Same corpus assembly
        # as the list, so the switches decorate both wires identically; an
        # unknown id answers the daemon's 404.
        m = re.match(r"^/api/v1/runs/([^/]+)$", path)
        if m:
            rid = urllib.parse.unquote(m.group(1))
            found = next((r for r in assemble_runs() if r["session"]["id"] == rid), None)
            if found is None:
                self._json(404, {"error": f"Run {rid} not found"})
            else:
                self._json(200, {"run": found})
            return True
        # Slice V (DES-UX-001 §3.2): the audit trail — always present (the real
        # daemon serves it unconditionally, crew routes.ts:286); the corpus
        # switch only decides which runs have entries. `?runId=` filters;
        # newest first; an unmatched run answers an EMPTY page, never a 404.
        if path == "/api/v1/audit":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            run_id = (q.get("runId") or [""])[0]
            action = (q.get("action") or [""])[0]
            with state_lock:
                provenance_on = state["provenance"]
                chronicle_on = state["chronicle"]
            entries = AUDIT_ENTRIES.get(run_id, []) if provenance_on else []
            # Slice BC: with the chronicle corpus on, the trail serves the FULL
            # pool (the real route is one append-only log) and honours the
            # `?action=` filter routes.ts:292 accepts alongside `?runId=`.
            if chronicle_on:
                pool = [e for v in AUDIT_ENTRIES.values() for e in v] \
                    + GATE_DECIDED_ENTRIES
                if run_id:
                    pool = [e for e in pool if e.get("runId") == run_id]
                entries = pool
            if action:
                entries = [e for e in entries if e.get("action") == action]
            entries = sorted(entries, key=lambda e: -e.get("ts", 0))
            self._json(200, {"entries": entries})
            return True
        # Slice I: the crew#305 file/diff routes (real contract, switch-gated).
        m = re.match(r"^/api/v1/runs/([^/]+)/(files|diff)$", path)
        if m:
            self._viewer_routes(urllib.parse.unquote(m.group(1)), m.group(2))
            return True
        if path == "/api/v1/projects":
            with state_lock:
                batch_on = state["batch_gates"]
                c6_on = state["c6_stale"]
                # Slice X2: this-lifetime created projects ride the list too.
                created = json.loads(json.dumps(created_projects))
            rows = PROJECTS + (BATCH_PROJECTS if batch_on else []) + created
            # C6 fix: the stale-clock reproduction — upload-endpoint's project
            # clock reads 15 HOURS old while its run executes NOW.
            if c6_on:
                rows = [{**p, "updated_at": NOW0 - 15 * HOUR}
                        if p["id"] == "upload-endpoint" else p for p in rows]
            self._json(200, {"projects": rows})
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
            # Fix J4 round 2: the roster-unreachable branch, switch-gated.
            with state_lock:
                roster_down = state["roster_fail"]
            if roster_down:
                self._json(500, {"error": "roster unavailable (fixture)"})
            else:
                self._json(200, {"roster": ROSTER})
            return True
        # Slice J (§5.2): the decisions corpus — read on the search GESTURE only.
        if path == "/api/v1/governance/claims":
            self._json(200, {"claims": GOVERNANCE_CLAIMS})
            return True
        # /api/v1/chats — every live chat (the FINDING-027 wire: chatId, seats,
        # idleSecs number|null). Slice AB's /chats live-session band reads it.
        if path == "/api/v1/chats":
            with chat_state_lock:
                rows = [{"chatId": cid,
                         "seats": [k for k in seats if k not in chat_dead_seats.get(cid, set())],
                         "idleSecs": 5}
                        for cid, seats in chat_warm_seats.items()]
            self._json(200, {"chats": rows})
            return True
        # /api/v1/chats/<id> — seats of a chat, the POOL truth (crew's
        # `chatSeats`): the live seats of a chat this server opened, EMPTY for
        # one it never did (the daemon does not 404 an unknown id; empty means
        # reclaimed/none). Fix slice J4 reads this as the rejoin probe.
        if path.startswith("/api/v1/chats/") and len(path.split("/")) == 5:
            cid = urllib.parse.unquote(path.split("/")[4])
            with chat_state_lock:
                seats = [k for k in chat_warm_seats.get(cid, [])
                         if k not in chat_dead_seats.get(cid, set())]
            self._json(200, {"chatId": cid, "seats": seats})
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
                j5_on = state["j5_runs"]
                chronicle_on = state["chronicle"]
            # Fix slice J4/J5: the dated cancelled pair is filed under
            # smoke-tests (real attach clocks); the undated pair stays unfiled.
            if j5_on and pid == "smoke-tests":
                refs.extend(J5_MEMBER_REFS)
            # Slice BC: the retry chain + the solo episode file under
            # auth-refactor — the membership record the DTO echo mirrors.
            if chronicle_on and pid == "auth-refactor":
                refs.extend(CHRONICLE_MEMBER_REFS)
            # Slice L: the batch corpus projects' runs.
            if batch_on:
                refs.extend(BATCH_MEMBERS.get(pid, []))
            # Slice S: runs launched this lifetime — the atomic attach means the
            # membership record and the DTO echo agree from the first read.
            with state_lock:
                refs.extend(launched_members.get(pid, []))
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
            # C6 fix: the attach clock — the running signal's floor — goes just
            # as stale as everything else; only the DTO status stays honest.
            with state_lock:
                if state["c6_stale"]:
                    clocks = {**clocks, "r-upload": NOW0 - 15 * HOUR}
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
                seeds = seeds + [demo_doc_row()]
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
            elif rid in state["gate_now"]:
                # Slice BD: the arrived gate for an annotated run — `options:
                # null` = free text, the COMPLEX shape (§7.11): a steer-worthy
                # gate answered in the thread, where pre-population lives.
                self._json(200, {"runId": rid, "ord": 3, "lifecycle": "open",
                                 "prompt": GATE_NOW_PROMPT,
                                 "receivedAt": iso(NOW0), "options": None})
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
                timeline_on = state["timeline"]
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
            # Slice BB: the timeline corpus SUPERSEDES r-auth's assembled tail —
            # the full recorded chronology, seq-ordered, deny verdict included.
            if timeline_on and rid == "r-auth":
                events = list(TIMELINE_AUTH_EVENTS)
            # Slice BC: the chain tip's durable tail — the current-state
            # strip's criterion/workflow derivation reads exactly this.
            with state_lock:
                chronicle_on = state["chronicle"]
            if chronicle_on and rid in CHRONICLE_EVENTS:
                events = events + CHRONICLE_EVENTS[rid]
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
        # Slice T (DES-UX-001 §6.3, BRIDGE-UX-1 probe 2): the REAL thread-history
        # read — GET /d/:doc/api/conversation returns the announce history (user
        # chat + agent narration, error states included) as {role, text, ts[,
        # state]} ONLY: no message ids, no version markers — the fidelity the
        # probe pinned. The store survives `restart_bridge` (it is the disk).
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/conversation$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            with conversations_lock:
                entries = [dict(e) for e in conversations.get((pid, doc), [])]
            with state_lock:
                demo_on = state["demo"]
            if demo_on and doc == DEMO_NAME:
                # The recorded demo's announce history opens with its authored
                # spec (the wizard's brief IS the doc's first user line on the
                # real bridge — log_conversation at create time). The seed is
                # prepended here so flipping the `demo` switch on cannot leave
                # the registry row and the history out of step.
                if not any(e.get("role") == "user"
                           and str(e.get("text", "")).startswith("Record a demo of")
                           for e in entries):
                    entries = [{"role": "user", "text": DEMO_BRIEF,
                                "ts": iso(NOW0 - 6 * MIN)}] + entries
            self._json(200, entries)
            return True
        # /api/v1/projects/<pid>/interactive/d/<doc>/api/versions — the manifest.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/versions$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            with state_lock:
                demo_on = state["demo"]
            if demo_on and doc == DEMO_NAME:
                self._json(200, demo_manifest())
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
        # GET /d/<doc>/api/demo/recording/<name> — the REAL bridge's recording
        # stream (server.js `app.get("/api/demo/recording/:name")`), path-locked
        # to the slug charset. Serves the tiny checked-in webm (with Range, as
        # a media element requests it) and the Pillow chapter thumbnails.
        m = re.match(
            r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/demo/recording/([A-Za-z0-9._-]+)$",
            path)
        if m:
            doc, name = urllib.parse.unquote(m.group(2)), m.group(3)
            with state_lock:
                demo_on = state["demo"]
            head = demo_manifest()["head"] if demo_on and doc == DEMO_NAME else 0
            vm = re.match(r"^_v(\d+)\.webm$", name)
            tm = re.match(r"^_v(\d+)\.step(\d{2})\.png$", name)
            if vm and int(vm.group(1)) <= head:
                self._media(tiny_webm(), "video/webm")
            elif tm and int(tm.group(1)) <= head and int(tm.group(2)) < len(DEMO_STEPS):
                step = int(tm.group(2))
                self._media(demo_frame(step, DEMO_STEPS[step]["title"]), "image/png")
            else:
                self._json(404, {"error": "no such recording"})
            return True
        # Slice X (§7.2): GET /d/<doc>/api/export/file/<name> — the artifact bytes,
        # exactly as server.js serves them (Content-Disposition attachment), so the
        # click site's ready affordance is a REAL download on the one origin (§5.3).
        m = re.match(
            r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/export/file/([^/]+)$", path)
        if m:
            pid, doc, name = (urllib.parse.unquote(g) for g in m.groups())
            with exports_lock:
                fmt = exports_created.get((pid, doc, name))
            if fmt is None:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"not found")
                return True
            version_m = re.search(r"_v(\d+)\.", name)
            body = export_bytes(doc, int(version_m.group(1)) if version_m else 1, fmt)
            ctype = {"pdf": "application/pdf",
                     "pptx": "application/vnd.openxmlformats-officedocument"
                             ".presentationml.presentation"}.get(fmt, "text/html; charset=utf-8")
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Disposition", f'attachment; filename="{name}"')
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
            pid, doc = (urllib.parse.unquote(g) for g in (m.group(1), m.group(2)))
            v = int(m.group(3))
            # docfb2: a version a feedback batch materialized serves ITS html.
            with docs_lock:
                override = doc_html_overrides.get((pid, doc, v))
            with state_lock:
                bare = bool(state["demo_bare_labels"])
            html = (override if override is not None
                    else storyboard_doc_html(v, bare_labels=bare) if doc == DEMO_NAME
                    else doc_html(doc, v))
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
            # Slice U (§8.4.1 probe 3): the refused-bind branch — the REAL
            # 502 shape server.js returns from assertProjectAttachable, BEFORE
            # any state is written ("nothing created on a refused bind").
            with state_lock:
                refuse_create = bool(state["create_fail"])
            if refuse_create:
                self._json(502, {"error": "crew daemon unreachable at "
                                          "http://127.0.0.1:9/api/v1 (ECONNREFUSED) — "
                                          "start crew, or create the doc without a project"})
                return True
            doc = slug(str(body.get("name") or "doc"))
            # Slice T (§8.4.1 probe 1): the REAL bridge DROPS source_message_id —
            # no `meta.sourceMessageId` ever reaches the manifest (the interactive.ts
            # claim was aspirational). The client's anchor is client-side; the
            # fixture must not serve a correlation the wire does not carry.
            with state_lock:
                silent_doc = bool(state["doc_silent"])
                run_ms = int(state["doc_run_ms"])
                v0_mirror = bool(state["doc_v0"])
            if v0_mirror:
                # Round-3 J3: the REAL create shape (generation.js) — a v0
                # "Building…" placeholder is what exists at ack time; the first
                # draft lands LATER as v1 when the answerer's draft.completed
                # materializes (schedule_doc_run below, doc_run_ms later).
                with docs_lock:
                    docs_created.setdefault(pid, {})[doc] = [
                        {"version": 0, "parent": None, "feedback_file": None,
                         "html_file": "_v0.html", "created_at": iso(NOW0)}]
            else:
                with docs_lock:
                    docs_created.setdefault(pid, {})[doc] = [
                        {"version": 1, "parent": None, "feedback_file": None,
                         "html_file": "v1.html", "created_at": iso(NOW0)}]
            brief = str(body.get("brief") or "")
            if brief:
                # The brief IS the doc's first user line in the announce history
                # (the create message the reload scene must get back, §6.3).
                log_conversation(pid, doc, "user", brief)
            head0 = 0 if v0_mirror else 1
            if silent_doc:
                # J3 no-answerer shape: the ack is real, the bus never speaks.
                self._json(201, {"name": doc, "head": head0, "generating": True, "project_id": pid})
                return True
            queue_interactive("wicked.interactive.status.posted", {
                "project_id": pid, "document_id": doc, "state": "working",
                "message": "Planning the deck — outline first, then the slides."})
            if v0_mirror:
                # The answerer lands the FIRST DRAFT as v1 (head 0 → 1), exactly
                # the real materializeDraft → version.created "generated" path.
                schedule_doc_run(pid, doc, run_ms / 1000.0)
            elif run_ms > 0:
                # Slice T: v1 is committed now but LANDS (the frame) after the
                # run — long enough for the rig to witness thread-generating.
                schedule_doc_run(pid, doc, run_ms / 1000.0, fixed_version=1)
            else:
                queue_interactive("wicked.interactive.version.created", {
                    "project_id": pid, "document_id": doc,
                    "version": 1, "parent": None, "kind": "generated"})
            self._json(201, {"name": doc, "head": head0, "generating": True, "project_id": pid})
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
                # Slice T (§8.4.1): no meta.sourceMessageId — the bridge drops it.
                versions.append(
                    {"version": v, "parent": frm, "feedback_file": None,
                     "html_file": f"v{v}.html", "created_at": iso(NOW0 + v * SEC)})
            self._json(200, {"version": v, "parent": frm})
            return True
        # Issue #65: the invented POST /api/theme/learn 404s, exactly as the real
        # bridge answers it (see the GET half for the matching absent routes).
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/api/theme/learn$", path)
        if m:
            self._json(404, {"error": f"no such route on the bridge: {path}"})
            return True
        # Slice X (§7.2): POST /d/<doc>/api/export — the real export wire (see the
        # module-level note). `export_delay_ms` slows the render so a rig can
        # witness the pending state; `export_pptx_missing` answers the real 400.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/d/([^/]+)/api/export$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            version = body.get("version")
            fmt = str(body.get("format") or "html").lower()
            if not isinstance(version, int):
                self._json(400, {"error": "version (number) required"})
                return True
            if fmt not in ("html", "pdf", "pptx"):
                self._json(400, {"error": "format must be html, pdf, or pptx"})
                return True
            with state_lock:
                delay_ms = int(state["export_delay_ms"])
                pptx_missing = bool(state["export_pptx_missing"])
            if delay_ms > 0:
                time.sleep(delay_ms / 1000.0)  # the render, slowed for the rig
            if fmt == "pptx" and pptx_missing:
                self._json(400, {"error": PPTX_MISSING_ERROR})
                return True
            file = f"{doc}_v{version}.{fmt}"
            with exports_lock:
                exports_created[(pid, doc, file)] = fmt
            download = f"/d/{doc}/api/export/file/{urllib.parse.quote(file)}"
            result = {"format": fmt, "path": f"/docs/{doc}/exports/{file}",
                      "file": file, "download": download}
            # The bridge announces the artifact on the bus too (export.generated);
            # the client deduplicates the echo on `href` (docThread.ts EXPORTED).
            queue_interactive("wicked.interactive.export.generated", {
                "project_id": pid, "document_id": doc, "version": version, **result})
            self._json(200, result)
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
                with state_lock:
                    silent = bool(state["learn_silent"])
                if silent:
                    # Slice X (§7.2): the ack lands, then NOTHING — no status
                    # frame, no readback. The client's bounded timeout is the
                    # only thing standing between the user and eternal narration.
                    self._json(200, {"ok": True, "event_id": "evt-fixture",
                                     "correlation_id": "c-fixture"})
                    return True
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
            # ── VIDEO-FB: the REAL record wire (materializeDemo, handlers.js) ────
            # demo.requested is the bus command the per-doc workspace materializes:
            # run the authored spec in a real browser, narrate per-step progress,
            # land the recording as version.created {kind:"demo"}. `demo_record_ms`
            # slows the run so a rig can witness the record button's EC37 pending.
            if body.get("event_type") == "wicked.interactive.demo.requested" and doc:
                with state_lock:
                    demo_on = state["demo"]
                    record_ms = int(state["demo_record_ms"])
                if demo_on and doc == DEMO_NAME:
                    def run_recording(rec_pid: str = pid, rec_doc: str = doc) -> None:
                        queue_interactive("wicked.interactive.status.posted", {
                            "project_id": rec_pid, "document_id": rec_doc,
                            "state": "working",
                            "message": f"Step 1/{len(DEMO_STEPS)}: "
                                       f"{DEMO_STEPS[0]['title']}"})
                        demo_land_recording()
                    if record_ms > 0:
                        threading.Timer(record_ms / 1000.0, run_recording).start()
                    else:
                        run_recording()
                self._json(200, {"ok": True, "event_id": "evt-fixture",
                                 "correlation_id": "c-fixture"})
                return True
            # ── docfb2: the REAL materializeFeedback shape (handlers.js) ─────────
            # Deterministic content-edits are applied to the head HTML NOW and land
            # as version.created {kind:"deterministic"}; the structural remainder is
            # handed off inline on feedback.processed. Items are ADR-0002 schema
            # items ({selector, type, value|instruction, before}).
            if body.get("event_type") == "wicked.interactive.feedback.submitted" and doc:
                items = payload.get("items") or []
                src_msg = str(payload.get("source_message_id") or "")
                applied: list = []
                rejected: list = []
                structural: list = []
                landed_v = None
                with docs_lock:
                    versions = docs_created.get(pid, {}).get(doc)
                    if versions is not None:
                        head = max(e["version"] for e in versions)
                        html = doc_html_overrides.get((pid, doc, head)) or doc_html(doc, head)
                        for item in items:
                            sel = str(item.get("selector") or "")
                            typ = str(item.get("type") or "")
                            if typ == "content-edit":
                                pat = re.compile(
                                    r'(data-wid="' + re.escape(sel) + r'"[^>]*>)([^<]*)')
                                if sel and pat.search(html):
                                    new_text = str(item.get("value") or "")
                                    html = pat.sub(
                                        lambda mm: mm.group(1) + new_text, html, count=1)
                                    applied.append(sel)
                                else:
                                    rejected.append({"selector": sel,
                                                     "reason": "selector-not-found"})
                            elif typ == "structural-change":
                                structural.append({"selector": sel, "type": typ,
                                                   "instruction": str(item.get("instruction") or "")})
                            else:
                                rejected.append({"selector": sel,
                                                 "reason": f"unsupported-type:{typ}"})
                        if applied:
                            landed_v = head + 1
                            versions.append({"version": landed_v, "parent": head,
                                             "feedback_file": f"_v{landed_v}.md",
                                             "html_file": f"_v{landed_v}.html",
                                             "created_at": iso(NOW0 + landed_v * SEC)})
                            doc_html_overrides[(pid, doc, landed_v)] = html
                        if src_msg:
                            feedback_msg_ids.setdefault((pid, doc), set()).add(src_msg)
                if versions is not None:
                    if landed_v is not None:
                        queue_interactive("wicked.interactive.version.created", {
                            "project_id": pid, "document_id": doc,
                            "version": landed_v, "parent": landed_v - 1,
                            "kind": "deterministic", "html_file": f"_v{landed_v}.html"})
                    queue_interactive("wicked.interactive.feedback.processed", {
                        "project_id": pid, "document_id": doc,
                        "version": landed_v if landed_v is not None else head,
                        "applied": applied, "rejected": rejected, "stale": [],
                        "awaiting_structural": len(structural),
                        "structural_items": structural})
                self._json(200, {"ok": True, "event_id": "evt-fixture",
                                 "correlation_id": "c-fixture"})
                return True
            if body.get("event_type") == "wicked.interactive.chat.posted" and doc:
                # Slice T (§6.1): a refused send is a LOUD 500 — the client's
                # visible-failure branch. Real shape: the bridge reports {error}.
                with state_lock:
                    refuse = bool(state["send_fail"])
                    run_ms = int(state["doc_run_ms"])
                    silent_doc = bool(state["doc_silent"])
                if refuse:
                    self._json(500, {"error": "bridge refused the send (fixture send_fail)"})
                    return True
                # The accepted send lands durably in the announce history in send
                # order (BRIDGE-UX-1 probe 1: the bus is the queue) …
                if payload.get("role") == "user" and payload.get("text"):
                    log_conversation(pid, doc, "user", str(payload.get("text")))
                # docfb2: the feedback batch's write 2 (the inject) carries the same
                # source_message_id the batch event carried. The batch already landed
                # its own version, so the answerer does NOT regenerate on the inject —
                # it lands in the transcript and nothing else.
                with docs_lock:
                    fb_ids = feedback_msg_ids.get((pid, doc), set())
                if str(payload.get("source_message_id") or "") in fb_ids:
                    self._json(200, {"ok": True, "event_id": "evt-fixture",
                                     "correlation_id": "c-fixture"})
                    return True
                with state_lock:
                    demo_on = state["demo"]
                if demo_on and doc == DEMO_NAME:
                    # VIDEO-FB: the demo agent ANSWERS IN CHAT and completes —
                    # a real reply, NO version landing (the live-observed shape
                    # behind the stuck "generating" badge: the reply arrived and
                    # nothing ever consumed the send's anchor). The client must
                    # resolve the send on the run's completion, not wait for a
                    # landing that will never come.
                    queue_interactive("wicked.interactive.chat.posted", {
                        "project_id": pid, "document_id": doc, "role": "agent",
                        "text": "The spec already covers that — those steps stay "
                                "as authored, so there is nothing to re-record."})
                    queue_interactive("wicked.interactive.status.posted", {
                        "project_id": pid, "document_id": doc, "state": "complete",
                        "message": "Answered in the thread — the spec is unchanged."})
                    self._json(200, {"ok": True, "event_id": "evt-fixture",
                                     "correlation_id": "c-fixture"})
                    return True
                if silent_doc:
                    # J3 no-answerer shape: 200 {ok}, landed durably — and then
                    # NOTHING answers it (no status frame, no landing, ever).
                    self._json(200, {"ok": True, "event_id": "evt-fixture",
                                     "correlation_id": "c-fixture"})
                    return True
                if run_ms > 0:
                    # … and each send's run lands its OWN new version, FIFO,
                    # doc_run_ms after the previous landing (§8.4.1 queue truth).
                    schedule_doc_run(pid, doc, run_ms / 1000.0)
                else:
                    # Round-3 J3 honesty: NO version is minted for the send by
                    # the client — the ANSWERER lands one. The instant path is
                    # the answerer taking ~0s: it appends head+1 to a created
                    # doc's manifest and announces THAT (mirroring the real
                    # regenerate → version.created "generated"). Static registry
                    # docs (the notes seeds) cannot grow, so they keep the
                    # historical head re-announce.
                    with docs_lock:
                        created_versions = docs_created.get(pid, {}).get(doc)
                        if created_versions is not None:
                            v = max(e["version"] for e in created_versions) + 1
                            created_versions.append(
                                {"version": v, "parent": v - 1, "feedback_file": None,
                                 "html_file": f"v{v}.html", "created_at": iso(NOW0 + v * SEC)})
                            parent = v - 1
                        else:
                            versions = doc_versions(pid, doc)
                            v = max((e["version"] for e in versions), default=1)
                            parent = v - 1 if v > 1 else None
                    queue_interactive("wicked.interactive.status.posted", {
                        "project_id": pid, "document_id": doc, "state": "working",
                        "message": "Tightening the headline and rebalancing the slide."})
                    queue_interactive("wicked.interactive.version.created", {
                        "project_id": pid, "document_id": doc,
                        "version": v, "parent": parent, "kind": "generated"})
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
            # Slice T (§6.3): `restart_bridge` simulates a FULL bridge restart —
            # everything process-scoped clears (the relay queue, the agent's
            # in-flight schedule), while the disk survives: the docs registry
            # and the conversation.jsonl-backed announce history stay, exactly
            # the split BRIDGE-UX-1 probe 2 verified on the real bridge.
            if body.get("restart_bridge"):
                with ws_lock:
                    ws_queue.clear()
                with doc_sched_lock:
                    doc_next_free.clear()
            # Slice AB (§7.9-3): broadcast the buffered chat rounds in send
            # order — the rig decides WHEN turn 1's chunks arrive.
            if body.get("chat_flush"):
                with chat_state_lock:
                    rounds, chat_round_buffer[:] = list(chat_round_buffer), []
                for frames in rounds:
                    for frame in frames:
                        broadcast_chat(frame)
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
        # POST /api/v1/projects — create (slice X2, project_create only): the
        # daemon's real contract — 201 {project} with a proj_-minted id
        # (project.rs:189) and the engine's verbatim 409 sentence on an
        # active-name collision (project.rs:236). See created_projects above.
        if path == "/api/v1/projects":
            with state_lock:
                create_on = state["project_create"]
            if not create_on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            name = str(body.get("name") or "").strip()
            if not name:
                return self._json(400, {"error": "name must be a non-empty string"})
            with state_lock:
                taken = {p["name"] for p in PROJECTS} | {p["name"] for p in created_projects}
                if name in taken:
                    return self._json(409, {
                        "error": f"project name '{name}' is already in use by an active project"})
                created_seq[0] += 1
                pid = f"proj_{NOW0:013d}{created_seq[0]:05d}"
                row = project(pid, name, NOW0,
                              **({"description": str(body["description"])}
                                 if body.get("description") else {}))
                created_projects.append(row)
            return self._json(201, {"project": row})
        # POST /api/v1/runs — the REAL launch (slice S, project_dto only): the
        # daemon's `{runId}` answer; `body.projectId` files the run atomically
        # (LaunchSchema, routes.ts:148 — "never a silent unfiled run"), and the
        # DTO the next GET /runs serves carries the CREW-UX-2 `project_id` echo.
        # POST /api/v1/runs — the launch, shared by the slice-V (provenance/
        # retry) and slice-S (project_dto) corpora. retryOf validation first
        # (CREW-UX-3: 400 on an unknown id, crew routes.ts:588); then a REAL
        # launch when project_dto is on (the run rides GET /runs with its
        # project_id echo — atomic filing), else slice V's plain 201.
        if path == "/api/v1/runs":
            retry_of = body.get("retryOf")
            if retry_of is not None:
                with state_lock:
                    provenance_on = state["provenance"]
                known = {r["session"]["id"] for r in RUNS} \
                    | ({RETRY_RUN["session"]["id"]} if provenance_on else set()) \
                    | {r["session"]["id"] for r in launched_runs}
                if retry_of not in known:
                    return self._json(400, {
                        "error": f"retryOf names an unknown run: {retry_of} — "
                                 "lineage must point at an existing run id"})
            with state_lock:
                project_dto_on = state["project_dto"]
                if project_dto_on:
                    launched_seq[0] += 1
                    rid = f"r-launched-{launched_seq[0]}"
                    pid = body.get("projectId")
                    run = session(rid, "executing", body.get("problem", ""),
                                  body.get("problem", ""))
                    run["session"]["project_id"] = pid if pid else None
                    launched_runs.append(run)
                    if pid:
                        launched_members.setdefault(pid, []).append(rid)
                        ATTACHED_AT[rid] = NOW0
            if project_dto_on:
                return self._json(200, {"runId": rid})
            return self._json(201, {"runId": "r-new"})
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
        # roster when `clis` is omitted, matching the daemon), instantly.
        # Fix J4 round 2 — the STRICT roster contract, always on: the real
        # daemon warms a seat via wicked-core's chat_ensure, which answers
        # "no ACP config for '<key>'" for any cli its roster does not carry
        # (acp_runner.rs). The old accept-anything behavior is exactly what
        # let a fallback-trio open pass the rigs while every REAL cold
        # profile's first send failed — that class can never pass here again.
        if path == "/api/v1/chats":
            clis = body.get("clis") or [s["key"] for s in ROSTER]
            chat_id = body.get("chatId") or "fixture-chat"
            known = {s["key"] for s in ROSTER}
            # Slice AB (§7.9-4): seats named by `chat_reject_seats` answer the
            # daemon's real per-seat shape — ok:false with an error the chip
            # must wear as failed-with-reason. Only accepted seats warm.
            with state_lock:
                reject = set(state["chat_reject_seats"])

            def seat(k: str) -> dict:
                if k not in known:
                    return {"cliKey": k, "ok": False, "error": f"no ACP config for '{k}'"}
                # Fix J4 round 3+4 (EC44): the real chat_ensure also rejects
                # a KNOWN seat with no ACP session config — 4 of the live
                # daemon's 6 seats have none (their roster entries OMIT the
                # acp key; skip_serializing_if). Both incapable spellings —
                # codex's absent key and agy's explicit null — reject here,
                # exactly as acp_config_for answers None for each.
                if k not in CHAT_CAPABLE_KEYS:
                    return {"cliKey": k, "ok": False, "error": f"no ACP config for '{k}'"}
                if k in reject:
                    return {"cliKey": k, "ok": False, "error": f"unknown agent '{k}'"}
                return {"cliKey": k, "ok": True}

            seats = [seat(k) for k in clis]
            with chat_state_lock:
                warmed = [s["cliKey"] for s in seats if s["ok"]]
                if warmed or chat_id in chat_warm_seats:
                    chat_warm_seats.setdefault(chat_id, [])
                    for k in warmed:
                        if k not in chat_warm_seats[chat_id]:
                            chat_warm_seats[chat_id].append(k)
                    chat_dead_seats.setdefault(chat_id, set())
                    chat_send_count.setdefault(chat_id, 0)
            return self._json(201, {"chatId": chat_id, "seats": seats})
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
                send_fail = state["chat_send_fail"]
                deltas_on = state["chat_deltas"]
            # Slice AB (§7.9-2): the daemon refuses the fan-out — the client's
            # draft must survive and the failure must render inline with retry.
            if send_fail:
                return self._json(500, {"error": "chat send refused (fixture)"})
            # Slice AB (§7.9-3): buffer this round's interleaved chunk frames +
            # replies; nothing is broadcast until the rig flushes — so a second
            # send can open its turn BEFORE the first turn's chunks arrive.
            if deltas_on:
                chat_id = urllib.parse.unquote(parts[4])
                with chat_state_lock:
                    warm = chat_warm_seats.get(chat_id, [])
                    dead = chat_dead_seats.setdefault(chat_id, set())
                    live = [k for k in warm if k not in dead]
                    chat_send_count[chat_id] = chat_send_count.get(chat_id, 0) + 1
                    round_n = chat_send_count[chat_id]
                    per_seat = []
                    for k in live:
                        line = CHAT_REPLY_LINES.get(k, "Agreed — start small.") + f" (round {round_n})"
                        third = max(1, len(line) // 3)
                        per_seat.append((k, [line[:third], line[third:2 * third], line[2 * third:]], line))
                    frames = []
                    for i in range(3):
                        for (k, chunks, _line) in per_seat:
                            if chunks[i]:
                                frames.append({"type": "chatDelta", "chat": chat_id,
                                               "cliKey": k, "text": chunks[i]})
                    for (k, _chunks, line) in per_seat:
                        frames.append({"type": "chatReply", "chat": chat_id,
                                       "cliKey": k, "ok": True, "text": line})
                    chat_round_buffer.append(frames)
                return self._json(200, {"seats": live})
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
        # Slice BE: PUT /runs/:id/guidance — the CREW-UX-7 upsert (crew#312),
        # mirrored verbatim: strict {text} body; the 8KB cap answers a 400
        # NAMING the limit (the daemon's exact sentence); an unknown run is the
        # daemon's 404; '' clears (the DTO drops the field); echo what stored.
        m = re.match(r"^/api/v1/runs/([^/]+)/guidance$", path)
        if m:
            rid = urllib.parse.unquote(m.group(1))
            text = body.get("text") if isinstance(body, dict) else None
            if not isinstance(text, str) or set(body) != {"text"}:
                return self._json(400, {"error": "Invalid request body"})
            if len(text.encode("utf-8")) > 8192:
                return self._json(400, {"error": (
                    "guidance exceeds the 8192-byte cap — a note this size belongs "
                    "in the problem statement or a linked doc")})
            known = {r["session"]["id"] for r in assemble_runs()}
            if rid not in known:
                return self._json(404, {"error": "Run not found"})
            with state_lock:
                if text == "":
                    state["guidance"].pop(rid, None)
                else:
                    state["guidance"][rid] = text
            return self._json(200, {"runId": rid, "guidance": text})
        return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})

    def do_DELETE(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/v1/chats/"):
            # Slice AB (§7.9-5): the teardown is real — the chat leaves the
            # live listing, exactly as the daemon reaps a closed pool entry.
            chat_id = urllib.parse.unquote(path.split("/")[4]) if len(path.split("/")) == 5 else None
            if chat_id is not None:
                with chat_state_lock:
                    chat_warm_seats.pop(chat_id, None)
                    chat_dead_seats.pop(chat_id, None)
                    chat_send_count.pop(chat_id, None)
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
