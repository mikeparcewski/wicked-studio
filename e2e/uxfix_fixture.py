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
  view_prefs      — replaces the settings store's `studio.view` (S3, technical
                    details; None REMOVES the key — off, the fresh install).
  session_over    — {run id: {field: value}} merged into that run's session on
                    both run wires (S3: a `base_commit` for the sha handle).
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
  wire433         — the wicked-core#431 wire (api-types 0.33.0; wicked-crew#527):
                    r-api's complex gate becomes the ord-4 RESTORED-TREE denial —
                    its units grow to the recorded bug workflow's five, its events
                    tail carries `evaluatorMutatedWorktree {restored: true}` +
                    `worktreeRestored {suggestionRef}` + a `gateEvaluated` deny
                    naming the judge (`judgeCli: "codex", judgeDistinct: true`),
                    and its cached gate carries the engine's NEW prompt ("… its
                    edit was discarded and the creator's verified tree restored.
                    Approve to retry the phase against the restored tree …").
                    r-auth (failed) gains a REJECTED `deliver` unit whose
                    denial_reason is the engine's framed `Worker FAILED on unit 2
                    (triage: …): deliver: LIFT-CONFLICT — …` refusal, and its tail becomes the full chronology with
                    `runBaseResolved` (origin/main, 5 behind, lifted) at the head
                    and `deliverLiftEvaluated {outcome: "conflict"}` + the
                    `stepFailed` before sessionFailed. Every frame is the wire's
                    exact camelCase spelling (crew's wire-contract literals).
                    Default False — no standing rig's gate or tail changes.
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
  chat_frames     — crew#561: a list of chat frames broadcast VERBATIM on POST
                    /__fixture — how a rig lands a daemon-synthetic frame the
                    fixture cannot derive (`chatCitations`). Not a switch: the
                    frames are sent once, in order, and nothing is stored.
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
import html as html_mod
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

# Studio wave 1 (dark when healthy): the home board's WORKING band collapses to a count line
# by default, and its expansion rides the history entry (`home.workingOpen`). Rigs that assert
# on the working CARDS (the W2 upload-endpoint card, its narration) open it before the app
# boots — `ctx.add_init_script(OPEN_WORKING_BAND)` — exactly the state Back would restore.
OPEN_WORKING_BAND = ("history.replaceState(Object.assign({}, history.state, "
                     "{'home.workingOpen': true}), '');")

# ── The frozen clock (§4.0 determinism): every age derives from this one NOW0 ──
NOW0 = int(time.time() * 1000)
SEC, MIN, HOUR, DAY = 1_000, 60_000, 3_600_000, 86_400_000


def iso(ms: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + f".{ms % 1000:03d}Z"


# Mutable fixture switches, flipped over POST /__fixture between page loads.
state = {"orphan": True, "q3_gate_age_ms": 30 * SEC,
         # home_paths — (e2e/desk_home_paths_test.py; studio#458/#460/#462) every path this fixture
         #   serves moves under a home directory (`/tmp/w2/…` → FAKE_HOME + `/w2/…` in every JSON
         #   body), GET /settings carries `path`, GET /skills serves a catalog rooted there, GET
         #   /diagnostics carries a `skills` block, and every unit output route answers the index
         #   line with the graph file's absolute path. Default False: no other corpus changes.
         # runs_delay_ms — GET /runs answers only after this delay (studio#459: the Desk's loading
         #   state is observable). Default 0.
         "home_paths": False, "runs_delay_ms": 0,
         # roster_signed_in — (e2e/desk_signin_test.py; Amendment 5 decision 5) {key: bool} laid over
         #   ROSTER's `signed_in`, so a journey can sign every seat out (the first-run Desk) and then sign
         #   one back in between reads ("I've signed in — check again"). Default {}: ROSTER as written.
         # roster_login_lines — {key: line} laid over each seat's `login_invocation` (the daemon's own
         #   command, worker home included). Default {}: only pi's under seat_week.
         "roster_signed_in": {}, "roster_login_lines": {},
         # runs_fail — GET /runs answers 500 (studio#466: a failed read is not an empty list).
         "runs_fail": False,
         # gate_move_tail — studio#430 (e2e/desk_gate_moves_test.py; needs `gate_move`): r-review's
         #   escalation carries the engine's head-cut TAIL of the verdict ("…" + from the second finding)
         #   as its denial reason and summary; the critique unit's output stays whole.
         "gate_move_tail": False,
         # repo_graph — studio#461 (e2e/desk_repo_page_test.py): None serves REPO_GRAPH; "docs" a built
         #   graph of a Markdown-only repo (totals 7 symbols / 2 files, no nodes shown); "fail" a 502.
         "repo_graph": None,
         # preview_delay_ms — POST /plans/preview answers only after this delay (studio#431). Default 0.
         "preview_delay_ms": 0,
         # reject_note — a run whose plan the operator rejected with a note: the daemon ended it
         #   cancelled and audited `gate.decided {approve:false, amend}` (studio#478).
         "reject_note": False,
         # floor_plan — a team run at its plan gate: the bus holds the PA's 8-step proposal, the gate
         #   asks about the floor-filled 11 (studio#470).
         "floor_plan": False,
         # seat_escalation — a run paused on a seat-failure escalation (unit 1 failed on codex); POST
         #   /runs/r-seat/reassign is recorded (GET /__fixture/reassign-posts) and, while
         #   `reassign_refuse` > 0, refused with crew's 400 (studio#480).
         "seat_escalation": False, "reassign_refuse": 0,
         # retry_gate — r-retry paused on the RETRY kind (studio#557): the review unit on codex
         #   changed the tree under review, the engine restored the creator's tree (worktree_guard
         #   denial, `restored: true`), and the gate carries no escalation kind or spelling — so the
         #   session row is Retry / Reassign / Stop. Gate POSTs and reassigns are recorded as above.
         "retry_gate": False,
         "no_runs": False, "usage_ws": False, "long_prompt": False,
         "extra_narration": [], "demo": False,
         "repo": False, "metrics_ws": False,
         # Wave 5 (phase4-r2 findings, e2e/ux5_document_hardening_test.py), all default-off so
         # no standing rig's wires change:
         #   export_report       — a PDF export's response AND its export.generated echo carry
         #                         interactive#219's additive report (layout / layout_source /
         #                         page_size / pages) — the F-4R2-016 rendering case.
         #   doc_fail_floor      — a chat.posted ask is answered by crew's REAL run-failure
         #                         line (status.posted state:"error", the deliverable-floor
         #                         dump verbatim, scrubbed paths) — the F-4R2-014 card.
         #   doc_heartbeat_ms    — the create path re-emits its current narration every N ms
         #                         until the landing (crew's ≤15 s heartbeat) — F-4R2-005.
         #   doc_bound_run       — {"pid","doc"}: ONE executing run whose declared write root
         #                         is `<state>/interactive-drafts/<doc>` rides GET /runs, filed
         #                         into pid — the run record F-4R2-006's reload restores from.
         #   create_409_existing — POST /api/docs answers the bridge's real 409 "doc already
         #                         exists" for a name already created this lifetime — F-4R2-003.
         "export_report": False, "doc_fail_floor": False, "doc_heartbeat_ms": 0,
         "doc_bound_run": None, "create_409_existing": False,
         # S9 (the document and slide editors):
         #   doc_bound_run gains an optional "repo" — the bound run's `repo_ref`, the
         #                 repository its requirement coverage is read from.
         #   requirements — {repoId: [{key, reqId, title, risk?}, …]}: GET
         #                 /repos/<repoId>/requirements serves crew's RequirementsPage for
         #                 the repos named here; every other repo answers the 404 a repo
         #                 with no requirements read does. Default None (no repo is served).
         "requirements": None,
         # EP-P3 (the page editor's acts + the checks panel):
         #   doc_checks — {docId: [DocCheck, …]}: GET /projects/<pid>/interactive/docs/<doc>/checks
         #                serves crew's DocChecksResponse (EP-C2) for a listed doc (200 {checks: []}
         #                for any other); None = the route is absent (an older daemon: no panel).
         "doc_checks": None,
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
         # Wave-2 consumers (studio#251 / #246 / #248, api-types 0.32.0):
         #   repo_findings — the studio-api RepoEntry carries the wicked-core#406
         #                   `in_tree_code_graph_ignored` finding in its NO-LIVE-GRAPH
         #                   form (the re-onboard remedy) and POST /repos/<id>/onboard
         #                   answers {runId}. Default False.
         #   governance    — GET /api/v1/diagnostics answers a body whose `governance`
         #                   block is the F-022 dead-letter case (crew#495). Default
         #                   None = the route is ABSENT (Fastify's unknown-route 404,
         #                   a daemon predating diagnostics); "healthy" serves the
         #                   clean block instead.
         #   chat_scope    — POST /api/v1/chats resolves and STATES a scope (crew#502)
         #                   from the body (scopeKind system/everything → that kind,
         #                   api-types 0.39.0 / studio#323 R4; repoRefs → repos;
         #                   projectId → project; else none), 404s unknown refs naming every missing one,
         #                   and GET /chats/<id> carries the recorded scope. Default
         #                   False: the standing chat rigs see the pre-scope 201.
         #   chat_scope_501 — POST /chats answers crew's 501 "engine predates chat
         #                   scope" for any SCOPED open (default False).
         "repo_findings": False, "governance": None, "chat_scope": False, "chat_scope_501": False,
         # Studio Wave A (lane home):
         #   never_indexed — GET /repos appends N registered repos with NO onboarding run on record
         #                   (`idx-0`…), registered hours apart (epoch SECONDS, the real wire), and
         #                   POST /repos/<id>/onboard accepts them (201 {runId}, receipts tapped at
         #                   GET /__fixture/onboard-posts). Default 0.
         #   broken_clock  — the first never-indexed repo's registered_at is 1 (1970 — the D6 unit
         #                   slip), so its age is impossible. Default False.
         #   POST /governance/deadletters/replay (crew#689) answers over the `deadletters` block:
         #   a dry run folds it, a real replay lands all but 8 and flips the block to what remains;
         #   receipts at GET /__fixture/replay-posts.
         "never_indexed": 0, "broken_clock": False,
         #   chat_admit_subset — with `clis` omitted on a scoped open the pre-filter admits ONLY
         #                   claude (a strict subset of the chat-capable set), so a rig can prove
         #                   the header shows exactly the admitted seats (W3S-253-09). Default False.
         "chat_admit_subset": False,
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
         # wicked-core#431 (api-types 0.33.0): the restored-tree gate on r-api,
         # the lift conflict + run base on r-auth — see the module docstring.
         "wire433": False,
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
         # ── Wave 6 (the governed testing journey, e2e/governed_testing_test.py) ──
         # governed_testing — the api-types 0.36.0 wire, switch-gated so no standing rig's
         #   wires change: GET /workflows lists `qe-author-tests` (five phases);
         #   POST /testing/author launches ONE run that pauses at its intake gate (the
         #   awaitingHuman frame rides /ws, GET /runs/:id serves its planned units +
         #   pool); GET /campaigns serves the COMPLETED run as the `qe-tests-<repo>` label
         #   group 0.36.0 files an authoring run under, with its registered set as the
         #   TOP-LEVEL `test_sets` (no row-level join); the completed run's events carry `degradedReason`,
         #   `workerToolCallDenied` and an UNGATED gateEvaluated; its diff answers
         #   200 `source: "branch"` (the worktree is gone). Default False: GET
         #   /workflows and GET /campaigns keep answering the unknown-route 404.
         # governed_testing_workflow_absent — with the switch on, GET /workflows lists
         #   NO `qe-author-tests` (a daemon predating the wave): the panel shows the
         #   plain-run banner and POST /testing/recon takes the launch.
         "governed_testing": False, "governed_testing_workflow_absent": False,
         # ── Studio wave 1 (e2e/wave1_*_test.py) ──
         # wave1 — REPLACES the W2 corpus with a small healthy portfolio: three
         #   projects (alpha / beta / gamma), each with ONE executing run (a1 / b1 /
         #   r1), plus a COMPLETED run c1 in gamma. No gates, no failures — the
         #   "dark when healthy" board. `gate_now: ["b1"]` flips b1 to a waiting
         #   gate (the one exception). r1 carries a recorded event tail (the raw
         #   events view) and every wave-1 run answers GET /runs/:id/deliver-text
         #   (the outbound draft). Default False: no standing rig's wires change.
         "wave1": False,
         # wave1_stall — r1's durable event tail ends 2 HOURS ago: an executing run
         #   that has gone silent (wave 1 round 2: a stalled run is an exception).
         # status_over — {run id: status} applied last on both run wires, so a rig can
         #   flip a run mid-page (pair with an extra_frames lifecycle frame so the app
         #   reconciles) or seed one failed run into the healthy corpus.
         "wave1_stall": False, "status_over": {},
         # session_over — {run id: {field: value}} merged into that run's session on both
         #   run wires, after status_over (S3: a `base_commit` for the technical-details
         #   journey). Default {}: no corpus changes.
         "session_over": {},
         # ── Studio wave 2b (e2e/wave2b_*_test.py) ──
         # wave2b — ADDS to the wave1 corpus (turn both on): five runs across alpha /
         #   beta / gamma — two gate candidates (g1 alpha, g2 beta), an executing run
         #   the rig can raise an MCP elicitation on over /ws (e1 gamma), a run that
         #   FAILED an hour ago (f1 beta) and one that COMPLETED two hours ago (d1
         #   alpha), both carrying the daemon's `ended_at` (unix seconds). GET /audit
         #   serves a human gate decision and the stall watchdog's system-actor
         #   `run.stall.escalated` on r1, honouring `?since=` / `?action=` / `?runId=`.
         # simple_gates — run ids whose SessionView answers awaiting_human with a
         #   SIMPLE cached gate (no options: the approve/reject pair).
         # audit_delay_ms — GET /audit answers only after this delay (the handover's
         #   in-flight state is observable).
         "wave2b": False, "simple_gates": [], "audit_delay_ms": 0,
         # settings_delay_ms — GET /settings answers only after this delay, so the page's first
         #   paint (the default skin, before studio.appearance lands) is observable. Like every key
         #   here it holds until a later set_fixture passes it again (0 clears it); the state lives
         #   in one journey's process, so it never reaches another journey.
         "settings_delay_ms": 0,
         # handover_many — ADDS to wave2b (turn all three on): a handover with about three items
         #   per chip — g3 (gamma, a third simple gate: pair with simple_gates), f2/f3 failed and
         #   d2/d3 completed inside the last three hours (d3's units carry catalog steps, so it can
         #   be reused as a preset), and two more system-actor audit lines (a turn timeout on f2,
         #   a delivery on d2). Default False: no other journey's corpus changes.
         "handover_many": False,
         # ── Studio behaviour 10 (e2e/standing_orders_test.py) ──
         # standing_orders — the crew standing-orders surface (GET/PUT/POST/DELETE
         #   /standing-orders, POST /standing-orders/parse). False = a daemon predating
         #   it (every route 404s). The fixture EMULATES crew's evaluator: an active
         #   approve order answers a matching wave-2b simple gate (the run leaves
         #   awaiting_human) and writes crew's `gate.decided` audit line, actor
         #   `standing-order:<id>`, detail.standingOrder {id, text}.
         "standing_orders": False,
         # ── Studio wave 2a (e2e/wave2a_*_test.py) ──
         # wave2a_feed — r1's durable tail grows a long run of narrated output
         #   captures, so its feed is tall enough to scroll to "the middle" (peek,
         #   jump, back). Rides WITH `wave1`.
         # gate_simple — run ids in `gate_now` whose cached gate GET answers the
         #   SIMPLE shape (no `options` key: approve/reject), so a triage `a`
         #   answers in place (preview, commit, undo window).
         "wave2a_feed": False, "gate_simple": [],
         # ── The app-shell needs queue (e2e/needs_shell_test.py) ──
         # proposals — None: GET /proposals answers the standing unknown-route 404 (a daemon
         #   predating the proposal queue). A list: the pending governed-knowledge proposals
         #   the route serves (`{proposals: [...]}`, the crew wire), filtered by `?state=`.
         #   POST /proposals/<id>/approve (crew's route) flips a pending one to `approved` and answers
         #   crew's outcome (memory → promoted, policy → handed_off); receipts at
         #   GET /__fixture/approve-posts, cleared by `reset_repairs`.
         "proposals": None,
         # ── Team-plan UI (DES-TEAMING-002 T9, e2e/t9_plan_ui_test.py) ──
         # team_plan — GET /catalog, GET /presets, POST /plans/preview and POST /runs/:id/plan
         #   answer on the crew 0.47.0 wire, and the team corpus (TEAM_RUNS: a live preset run,
         #   a gated preset run, a completed user-plan run, a system run) rides GET /runs,
         #   filed under upload-endpoint. Off: the unknown-route 404s standing rigs see.
         # plan_edit_fail_once — the FIRST POST /runs/:id/plan is taken by the "engine" but
         #   answered 503 (the answer lost in transit), so a retry with the same requestId
         #   answers duplicate: true.
         # gate_moved — run ids whose POST /runs/:id/gate answers crew's 409 gate_changed
         #   (openOrd 4); from then on that run's cached gate GET serves the ord-4 gate.
         "team_plan": False, "plan_edit_fail_once": False, "gate_moved": [],
         # plan_gate — dogfood D10/D11 (e2e/dogfood_fixes_test.py): r-plan-gate, a user-plan run
         #   paused at a HIGH-RISK plan_approval gate, rides GET /runs; its GET /runs/:id/gate
         #   serves the engine's plan prompt and GET /runs/:id/team the rows that explain it
         #   (the stale-graph fail-closed score, the floor's additions). Pair with team_plan
         #   for GET /catalog (the plan edit's picker).
         "plan_gate": False,
         # gate_move — brainstorm-actionable ideas 1+2 (e2e/gate_move_test.py): r-review, paused at an
         #   evaluator NOT PASS escalation (the engine's recorded `VERDICT: FAIL` frames), rides GET
         #   /runs; its events, gate and the creator phase's transcript are served for the card.
         "gate_move": False,
         # escalation_arms — batch W2-S3 (e2e/escalation_arms_test.py): three paused runs on GET /runs
         #   — r-timeout (a repo-checks floor that did not finish: extend / targeted / accept_partial),
         #   r-suggest (a guard-denied evaluator whose edit was pinned: accept_suggestion) and
         #   r-prerun (a run-level pre-run gate: the phase under review, the steer scope picker) —
         #   with their events, gates and the reviewed phase's transcript.
         "escalation_arms": False,
         # seat_week — brainstorm-actionable idea 9 (e2e/agent_1on1_test.py): GET /roster/record
         #   serves SEAT_WEEK (crew#690's shape) and pi carries a sign-in line; POST
         #   /governance/rules is recorded (GET /__fixture/rule-posts). Off: /roster/record answers
         #   Fastify's bare unknown-route 404, a daemon predating crew#690.
         "seat_week": False,
         # trust_rules — brainstorm-actionable ideas 7+8 (e2e/gate_trust_test.py): three runs on
         #   project northwind (band 0-19) paused at gates — r-trust (a review of claude's build),
         #   r-trust-codex (the same gate on codex's build) and r-trust-deliver (the deliver gate) —
         #   plus GET /gates/decided (the decided-gate history, crew#691) and GET/POST
         #   /standing-orders (crew#686; POSTs tapped at /__fixture/standing-order-posts).
         "trust_rules": False,
         # run_page — brainstorm-actionable ideas 6+13 (e2e/wavec_runpage_test.py): northwind runs
         #   launched from the `bugfix` preset — r-rerun (band 0-19, paused at a NOT PASS escalation on
         #   review; its event log carries each phase's recorded times), r-rerun-done (the same run,
         #   completed) and r-rerun-mid (band 40-69) — plus GET/POST /standing-orders (POSTs tapped at
         #   /__fixture/standing-order-posts; the create route mirrors crew#693's plan-trust refusal).
         "run_page": False,
         # home_runs — brainstorm-actionable ideas 10, 11, 15 (e2e/wavec_home_runs_test.py): r-reuse, a
         #   completed user-plan run whose units carry their catalog steps, rides GET /runs; GET /presets
         #   serves TEAM_PRESETS and PUT /presets/:name is recorded (GET /__fixture/preset-puts); GET/PUT
         #   /deliveries/freeze (crew#694) hold the switch, and while it is on POST /runs/:id/gate answers
         #   crew's 409 deliveries_frozen for an approve of a DELIVER gate (r-trust-deliver; pair with
         #   trust_rules). Off: those routes answer the unknown-route 404 an older daemon gives.
         "home_runs": False,
         # ── Capture (Studio OS behaviour 8, e2e/capture_test.py) ──
         # capture — POST /projects/:id/capture answers on the crew 0.48.0 wire (201 {runId});
         #   the "capture run" files capture_rows (1 intent, 2 decisions, 1 memory proposed as a
         #   pattern, 1 development rule) into the `proposals` queue (pair with proposals=[]), where
         #   Home's Wave B triage decides them over its own approve route. Off: the unknown-route
         #   404. Every capture POST lands in capture_post_log (GET /__fixture/capture-posts).
         "capture": False,
         # ── The Demo experience (wicked-studio#373, e2e/demo_mode_test.py) ──
         # demo_runs — POST /projects/:id/demo answers on the crew api-types 0.59.0 wire (201 {runId})
         #   and mints a demo run of the `demo` preset that rides GET /runs. GET /runs/:id/demo walks
         #   it plan → plan gate → record (one chapter at a time) → review gate → done on the clock and
         #   on POST /runs/:id/gate (approve, or request_changes whose note re-plans or re-records one
         #   chapter); PUT /runs/:id/demo/script edits the script at the plan gate only (409 after);
         #   GET /runs/:id/demo/file serves the contact sheets and the video with Range. Off: the
         #   unknown-route 404. Every demo write lands in demo_post_log (GET /__fixture/demo-posts).
         "demo_runs": False,
         # watch_feed — (TR-W8, e2e/desk_watch_test.py) GET /api/v1/watch answers on crew's TR-W5a wire:
         #   b1 carries a gate-attached finding and a problem anchored at unit 0 (a clearing on the
         #   page fixes an older one); `?run=b1` adds coverage with one entry not checked. Off: 404.
         "watch_feed": False,
         # editors — (EP-P1, e2e/editor_conformance_test.py) a stand-in for crew's EP-C1: GET
         #   /api/v1/editors/<id>/<version>/entry?sha= serves e2e/editor-fixtures/<good|hostile>.html
         #   with the bundle CSP (DES-EDITOR-PLUGINS-001 §8.2) and refuses a hash that does not match;
         #   GET /api/v1/editors/<id>/grants answers `editor_grants`. shell_csp — the SPA shell is
         #   served with crew's `frame-src` policy (§8.2), so a plugin cannot navigate off-origin.
         #   EP-P2: GET /api/v1/editors lists the first-party editors the served dist carries
         #   (<dist>/editors/<id>/editor.json, hash-pinned as crew's registry does); their entry is served
         #   from the dist with the same policy (` https:` for a first-party `network.media`, crew csp.ts);
         #   the grants route answers crew's DECIDED shape ({permission, decision, ruleIds, token}).
         "editors": False, "editor_grants": ["artifact.read", "artifact.write", "selection.chip",
                                              "composer.draft", "checks.contribute", "ui.fullscreen", "network.media"],
         "shell_csp": False,
         # ── Sessions (DES-STUDIO-REBUILD-001 S6a, e2e/desk_session_test.py) ──
         # sessions — SESSION_RUNS are GET /runs (they REPLACE the corpus): r-pay-1 (completed, not a team run) and r-pay-2
         #   (executing team run) launched from chat-pay, whose GET /chats/:id holds a live
         #   transcript; r-solo (a team run with no team transport, no chat); r-old (completed,
         #   launched from chat-gone, which this daemon reclaimed: scope null, messages []).
         #   GET /runs/:id/team answers each on crew's RunTeamResponse wire.
         # run_chat_id — GET /health.capabilities.runChatId (C1). Off: a daemon before C1 (and the
         #   runs then carry no chat_id either).
         "sessions": False, "run_chat_id": False,
         # ask_path — DES-ASK-TEAM-CHAT-001 (ASK-S1, e2e/desk_ask_team_test.py): GET /health.capabilities.askPath
         #   is true and an ask is a TEAM PATH. POST /chats records the eligible seats (nothing warms) and the
         #   caller's `primary`; POST /chats/:id/messages answers crew's 202 {seats:[pa], turnId, runId, stepId}
         #   and then replays, over /ws and on a timer, the frames the crew lane captured live (ws.jsonl
         #   2026-10-05): the team rows (path.started random, plan.proposed/scored/accepted, step.claimed,
         #   member.joined, step.completed, finding.raised target:output, ledger.folded) and the PA's chatDelta /
         #   chatReply; GET /chats/:id carries the transcript + `path`; GET /runs lists the ask run (chat_id set,
         #   awaiting_human at its turn gate after the reply); GET /runs/:id/team serves the rows so far.
         #   ask_one_seat — the roster has no distinct seat: member.joined{seat:null,status:failed} and, after the
         #   reply, plan.refused NoEligibleSeat (the §4.7 one-seat line).
         "ask_path": False, "ask_one_seat": False,
         # sheets — S11 (e2e/desk_sheets_test.py): every run's units name a seat
         #   ("claude" where the corpus left none), so a session shows its helpers; POST
         #   /runs/:id/cancel answers crew's 200 and is recorded (GET /__fixture/cancel-posts).
         "sheets": False,
         # ship_proposals — (S6b, e2e/desk_proposal_test.py; needs `sessions`) adds chat-ship's two runs to
         #   the sessions corpus: r-ship-plan waits at its plan gate (the team plan proposed, not
         #   accepted), r-ship-deliver waits at its deliver gate (every other step done); chat-ship's
         #   transcript holds a reply with a citations record; GET /runs/r-ship-deliver/files reads
         #   src/checkout.ts from its worktree. proposal_refuse — POST /runs/r-ship-plan/gate answers
         #   crew's 400 with a reason (the refused-plan case).
         "ship_proposals": False, "proposal_refuse": False,
         # reel_runs — (studio#440-#445, e2e/desk_reel_words_test.py; needs `sessions`) adds REEL_RUNS to
         #   the sessions corpus: a plan gate at rev 2 after the scope step, a deliver gate whose card
         #   names a local origin by its path, and a delivered run whose deliver step never reached the
         #   bus. Their GET /runs/:id/team answers after REEL_TEAM_DELAY_S.
         "reel_runs": False,
         # decisions — DC-S6 (e2e/desk_decisions_test.py; needs `sessions`): GET /decisions on crew's
         #   DC-S4a wire (mode `decisions_mode`), the five POST verbs (recorded in GET
         #   /__fixture/decision-posts, each queueing a decisionChanged frame), chat-pay's transcript
         #   grows the DECISION_TURNS (user turns + their `decisions` records, api-types 0.84.0), and
         #   GET /proposals carries the offered decision's review proposal (B12). Off: no /decisions
         #   route at all (a daemon before DC-S4a).
         "decisions": False, "decisions_mode": "on",
         # walkthrough — WT-U1 (e2e/desk_walkthrough_test.py; needs `sessions`): adds WALK_RUNS to the
         #   sessions corpus and answers crew's WT-W1..W3 wire for them: GET /runs/:id/walkthrough
         #   (r-walk-rec recording chapter `walk_recorded`+1 of 6; r-walk-fail failed in chapter 4 with
         #   its escalation gate open; r-walk-pass passed and sealed; r-walk-thin the thin result
         #   garden 12.41.0 writes: keys and verdicts only), GET …/walkthrough/file, PUT
         #   …/walkthrough/storyline (409 `no_open_escalation` unless that run's escalation is open),
         #   and r-walk-demo, a finished demo run (GET /runs/:id/demo, …/demo/file, POST …/demo/export).
         #   GET /health.capabilities.walkthroughRoots is true. Every write lands in GET
         #   /__fixture/walkthrough-posts. Off: no /walkthrough route (a daemon before WT-W1).
         "walkthrough": False, "walk_recorded": 3,
         # steering_rules — DC-S8 (e2e/desk_rules_test.py): GET /governance/rules answers the small
         #   STEERING_RULES corpus (the rule dec-auto landed, project-scoped, plus one rule that applies
         #   everywhere), so the Rules page can open a rule remembered from the operator's words. The
         #   `/considered` reads ride the `decisions` switch (same corpus). Off: the standing 404.
         "steering_rules": False,
         # acceptance_wt — WT-U2 (e2e/desk_checks_test.py; needs `walkthrough`): GET /runs/:id/acceptance for
         #   the walkthrough corpus carries crew's WT-W2 `walkthrough` block (per-step checkState from the
         #   newest sealed take) and WT-W3 `summary` (the deliver card's line). Off: the body has neither
         #   (a daemon before WT-W2/W3) — no chips, no line.
         "acceptance_wt": True,
         }
state_lock = threading.Lock()
# Idea 9: every POST /governance/rules body the fixture received (GET /__fixture/rule-posts).
rule_post_log: list = []
# WT-U2: under `steering_rules`, a POST /governance/rules upserts here (by id) and GET serves it over
# the corpus — the Hold switch reloads for the server's answer, so the server must answer with it.
steering_rule_overlay: dict = {}
# studio#446: every POST /runs body the sessions corpus received (GET /__fixture/launch-posts), and
# the runs those launches minted — they join the sessions corpus, carrying `chat_id` from the body's
# `chatId` when `run_chat_id` is on (crew stamps it the same way). Reset with `reset_gate_posts`.
session_launch_log: list = []
session_launched: list = []
# S11: every POST /runs/:id/cancel the fixture received under `sheets` (GET /__fixture/cancel-posts).
cancel_post_log: list = []
# Wave 2a: every POST /runs/:id/gate the fixture received (read over GET /__fixture/gate-posts).
gate_post_log: list = []
# studio#480: every POST /runs/:id/reassign (GET /__fixture/reassign-posts); reset with reset_gate_posts.
reassign_post_log: list = []
# studio#545: every POST /runs/:id/resume (GET /__fixture/resume-posts); a resumed run's trail gains the
# dispatch that follows the orphan report. Reset with `reset_gate_posts`.
resume_post_log: list = []
resumed_runs: set = set()
# S13 (e2e/live_walkthrough_deliver_test.py): the `gateDecided` event a POST /runs/:id/gate on the walkthrough
# corpus appends to that run's trail — crew writes one per decision; GET /runs/:id/events serves it after the
# recorded events. Cleared with `reset_gate_posts`.
walk_gate_decided: dict = {}
# Every POST /runs/:id/inject (a message to the team on a live run; GET /__fixture/inject-posts).
inject_post_log: list = []
# S9: every `feedback.submitted` batch the bridge received — {pid, doc, version, items} — so a
# journey can see what an edit SENT (one item, its `before` snapshot), not only what it showed
# (GET /__fixture/feedback-posts).
feedback_post_log: list = []
# T9: every POST /plans/preview and POST /runs/:id/plan body (GET /__fixture/plan-posts), the
# requestIds the "engine" has taken (requestId -> proposal_id), and the runs whose gate moved.
plan_post_log: list = []
plan_edit_taken: dict = {}
plan_edit_failed_once: list = []
gate_moved_done: set = set()
# Ideas 7+8: the standing orders made this lifetime, and every POST /standing-orders body.
trust_orders: list = []
standing_order_posts: list = []
# Ideas 11+15: every PUT /presets/:name (GET /__fixture/preset-puts) and the delivery freeze switch.
preset_put_log: list = []
FREEZE_THAWED = {"frozen": False, "since": None, "by": None, "reason": None}
delivery_freeze: dict = dict(FREEZE_THAWED)
# Capture: every POST /projects/:id/capture and /proposals/:id/{approve,reject} body the fixture
# received (GET /__fixture/capture-posts), and the capture runs it minted.
capture_post_log: list = []
capture_seq = [0]
CAPTURE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

# The Demo experience (switch `demo_runs`): the demo runs launched this lifetime, keyed by run id.
# Their own lock: assemble_runs reads them while it holds state_lock.
demo_lock = threading.Lock()
demo_runs: dict = {}
demo_post_log: list = []

# ── Decision capture corpus (switch `decisions`, DC-S6) ─────────────────────────────────────
# One DecisionView per operator turn of chat-pay (crew api-types 0.80.0 / 0.84.0), each the scene it
# plays: rule-auto (26) → dec-auto; rule-offer (27) → dec-offer; never-mind (44) → dec-none; an
# approval (B6) → dec-approve; a restatement (B7) → dec-maybe; decided in two projects (B8) →
# dec-widen; a turn with no record yet (its chatDecisions frame is pushed live by the journey) →
# dec-live; a clear rule under auth=off (Q1) → dec-authoff. `project_id` is upload-endpoint.
decisions_lock = threading.Lock()
decision_posts: list = []
DECISION_PROJECT = "upload-endpoint"
DEC_T0 = NOW0 - 30 * 60 * 1000  # half an hour ago, epoch ms


def _dec(id_, turn, words, statement, route, state, **over):
    d = {"id": id_, "at": DEC_T0 + int(turn[1:]) * 60_000, "project_id": DECISION_PROJECT, "host": "studio-chat",
         "origin": {"actor": {"id": "operator", "kind": "human", "trust": "operator"}, "auth_mode": "required",
                    "chat_id": "chat-pay", "turn_id": turn, "words": words, "words_source": "typed", "redacted": False},
         "derived": {"statement": statement, "polarity": "do" if statement else None,
                     "key": re.sub(r"[^a-z]+", "-", (statement or "").lower()).strip("-") or None,
                     "scope": "project", "steering_type": "development", "template": "T1-always" if route == "auto" else ("in-your-words" if statement else None),
                     "exclusions": [] if statement else ["one-off"]},
         "route": route, "state": state}
    d.update(over)
    return d


DECISIONS: dict = {}
DECISION_TURNS: list = []


def reset_decisions() -> None:
    DECISIONS.clear()
    items = [
        _dec("dec-auto", "d1", "from now on, always check the payment provider’s records, not just our database",
             "Always check the payment provider’s records, not just our database", "auto", "remembered", how="auto",
             rule_id="proposal:pr-auto", proposal_id="pr-auto"),
        _dec("dec-offer", "d2", "demos for the panel should feel calmer", "Demos for the panel should feel calmer", "offer", "offered",
             proposal_id="pr-offer", derived_steering="design-ux"),
        _dec("dec-none", "d3", "never mind, skip that for now", None, "ledger", "recorded"),
        _dec("dec-approve", "d4", "lets do it", "Treat every copy-only change as tests-only", "offer", "offered", proposal_id="pr-approve"),
        _dec("dec-maybe", "d5", "check the provider records every single time", "Check the provider records every time",
             "maybe-restated", "recorded", restates_rule_id="proposal:pr-auto"),
        _dec("dec-widen", "d6", "always run the repo’s checks before a walkthrough", "Always run the repo’s checks before a walkthrough",
             "offer", "offered", proposal_id="pr-widen", widen={"projects": [DECISION_PROJECT, "legacy-spike"]}),
        _dec("dec-live", "d7", "always tag the release before pushing", "Always tag the release before pushing", "offer", "offered",
             proposal_id="pr-live"),
        _dec("dec-authoff", "d8", "from now on, never push on a Friday", "Never push on a Friday", "offer", "offered", proposal_id="pr-authoff"),
    ]
    for d in items:
        if "derived_steering" in d:
            d["derived"]["steering_type"] = d.pop("derived_steering")
        if d["id"] == "dec-authoff":
            d["origin"]["auth_mode"] = "off"
            d["derived"]["template"] = "T2-never"
            d["derived"]["polarity"] = "dont"
        DECISIONS[d["id"]] = d
    decision_posts.clear()


reset_decisions()

# ── Considered · set aside · cited (DC-S8; crew api-types 0.85.0 `Consideration`) ───────────
# What chat-pay's seats were given per turn, and what r-pay-2's build step was given: the rule
# dec-auto landed (project-scoped) and one rule that applies everywhere; a candidate from another
# project set aside; d2's reply cites the in-force rule (unchecked) and one invented id (unverified).
# d3 (never mind) is not served: crew answers 404 for a turn it holds no record of.
RULE_AUTO = {"id": "proposal:pr-auto", "statement": "Always check the payment provider’s records, not just our database",
             "severity": "warn", "steering_type": "development", "project": DECISION_PROJECT}
RULE_GLOBAL = {"id": "PAT-100", "statement": "Name things in plain words", "severity": "info", "steering_type": "development"}
SET_ASIDE_LEGACY = {"id": "proposal:pr-legacy", "statement": "Ship risky changes behind a flag", "reason": "out_of_scope"}
CITE_LABEL = "cited by the step — unchecked"
UNKNOWN_LABEL = "not a rule in force here"


def consideration(subject: dict, key: str, cited: list, considered: list | None = None, set_aside: list | None = None) -> dict:
    return {"subject": subject, "key": key, "project_id": DECISION_PROJECT,
            "considered": [RULE_AUTO, RULE_GLOBAL] if considered is None else considered,
            "set_aside": [SET_ASIDE_LEGACY] if set_aside is None else set_aside,
            "cited": cited, "source": "considerRules"}


def _turn_subject(turn: str) -> dict:
    return {"kind": "chat", "chat_id": "chat-pay", "turn_id": turn}


CONSIDERATIONS: dict = {
    # t1 predates the rule: only the global one was in force.
    "chat-pay:t1": consideration(_turn_subject("t1"), "considered:chat-pay:t1", [], considered=[RULE_GLOBAL], set_aside=[]),
    "chat-pay:d1": consideration(_turn_subject("d1"), "considered:chat-pay:d1", [], considered=[RULE_GLOBAL], set_aside=[]),
    "chat-pay:d2": consideration(_turn_subject("d2"), "considered:chat-pay:d2", [
        {"id": "proposal:pr-auto", "by": "claude", "status": "unchecked", "label": CITE_LABEL},
        {"id": "POL-999", "by": "claude", "status": "unverified", "label": UNKNOWN_LABEL}]),
    "chat-pay:d4": consideration(_turn_subject("d4"), "considered:chat-pay:d4", []),
    "chat-pay:d5": consideration(_turn_subject("d5"), "considered:chat-pay:d5", []),
    "chat-pay:d6": consideration(_turn_subject("d6"), "considered:chat-pay:d6", []),
    "chat-pay:d7": consideration(_turn_subject("d7"), "considered:chat-pay:d7", []),
    "chat-pay:d8": consideration(_turn_subject("d8"), "considered:chat-pay:d8", []),
    # r-pay-2's build step (ord 1) cited the rule; its understand step (ord 0) only considered it.
    "r-pay-2:0": consideration({"kind": "unit", "run_id": "r-pay-2", "ord": 0, "attempt": 0}, "considered:r-pay-2:0:0", []),
    "r-pay-2:1": consideration({"kind": "unit", "run_id": "r-pay-2", "ord": 1, "attempt": 0}, "considered:r-pay-2:1:0", [
        {"id": "proposal:pr-auto", "by": "r-pay-2:u1", "status": "unchecked", "label": CITE_LABEL}]),
}

# GET /governance/rules under `steering_rules`: the landed rule (as crew's DC-S3 landing files it —
# `source: chat`, project facet kept, `applies_to` empty = recall-only) and the global one.
STEERING_RULES = [
    {"id": "proposal:pr-auto", "rule_type": "policy", "statement": RULE_AUTO["statement"], "severity": "warn", "confidence": 0.9,
     "targets": {"project": DECISION_PROJECT}, "provenance": {"source": "chat", "source_kinds": ["decision"]},
     "steering_type": "development", "applies_to": [], "excludes": [], "weight": 1.0, "created_at": DEC_T0 // 1000 + 60},
    {"id": "PAT-100", "rule_type": "pattern", "statement": RULE_GLOBAL["statement"], "severity": "info", "confidence": 0.8,
     "targets": {}, "provenance": {"source": "ui", "source_kinds": ["doc"]},
     "steering_type": "development", "applies_to": [], "excludes": [], "weight": 1.0},
    # WT-U2: core's testing starter TST-1002 as it ships (seed/testing/rules/testing-starter.json) — advisory:
    # a trigger and obligations, NO effect. "Hold work to it" adds `effect: allow_with_conditions`.
    {"id": "TST-1002", "rule_type": "policy", "statement": "A change to code or config gets Test plus a walkthrough review by a different helper.",
     "severity": "warn", "confidence": 0.9, "steering_type": "testing", "applies_to": ["plan.compose"], "excludes": [], "weight": 1.0,
     "trigger": {"contains": "\"kinds\":\\[[^\\]]*\"(code|config)\""}, "obligations": ["step:test", "step:walkthrough"],
     "targets": {}, "provenance": {"ref": "crates/wicked-governance/seed/testing/rules/testing-starter.json#TST-1002", "source_kinds": ["doc"]}},
]

# The operator turns chat-pay gains under `decisions` (after its existing t1 turn + notes), each with
# its `decisions` record — except d7, whose record the journey pushes as a live chatDecisions frame.
DECISION_TURN_WORDS = [(d["origin"]["turn_id"], d["origin"]["words"]) for d in DECISIONS.values()]


def decision_turns() -> list:
    rows = []
    for turn, words in DECISION_TURN_WORDS:
        at = DEC_T0 + int(turn[1:]) * 60_000
        rows.append({"at": at, "turnId": turn, "kind": "user", "seats": ["claude"], "text": words})
        if turn == "d4":
            # B6: the seat proposed; "lets do it" approved. The proposal came the turn before.
            rows.insert(len(rows) - 1, {"at": at - 20_000, "turnId": "d3b", "kind": "seat", "cliKey": "claude", "ok": True, "usage": None,
                                        "text": "I’ll treat every copy-only change as tests-only from now on — OK?"})
        # DC-S8 (B10): the d2 reply cites the in-force rule and one invented id, so its considered
        # line reads "cited 1 (unchecked) · 1 unverified citation" (see CONSIDERATIONS below).
        reply = ("Noted — I’ll keep [rule:proposal:pr-auto] in mind, and [rule:POL-999] says the same." if turn == "d2"
                 else "Noted." if turn != "d3" else "Skipping it.")
        rows.append({"at": at + 5_000, "turnId": turn, "kind": "seat", "cliKey": "claude", "ok": True, "usage": None,
                     "text": reply})
        if turn != "d7":
            items = [d for d in DECISIONS.values() if d["origin"]["turn_id"] == turn]
            rows.append({"at": at + 9_000, "turnId": turn, "kind": "decisions", "items": items})
    return rows


def decision_proposal_row() -> dict:
    """B12: the offered decision's review proposal, as crew files it (§4.2.4): capture 'decision', the id only."""
    d = DECISIONS["dec-offer"]
    return {"id": "pr-offer", "kind_type": "policy:design-ux",
            "payload": {"rule": d["derived"]["statement"], "severity": "warn", "capture": "decision", "decision": {"id": "dec-offer"}},
            "facets": {"project": DECISION_PROJECT}, "provenance": {"source": "decision", "ref": "dec-offer"},
            "state": "pending" if d["state"] == "offered" else "approved", "created_at": d["at"] // 1000}

demo_seq = [0]
DEMO_CHAPTERS = [
    {"key": "01-intake", "title": "A request arrives", "blurb": "Where new work lands and who sees it first.",
     "tags": ["intake"], "resets": []},
    {"key": "02-approve", "title": "Someone approves it", "blurb": "The gate, shown but never pressed.",
     "tags": ["gates"], "resets": []},
    {"key": "03-done", "title": "It ships", "blurb": "The finished work and its evidence.",
     "tags": ["delivery"], "resets": []},
]
DEMO_PLAN_S = 1.2
DEMO_CHAPTER_S = 0.9
DEMO_ROUND1_FINDINGS = [
    {"at": "0:41", "chapter": "02-approve", "issue": "The caption says approved before the gate card is on screen",
     "verdict": "re-record"},
    {"at": "1:10", "chapter": "03-done", "issue": "The join cuts the closing card 0.4 s early", "verdict": "re-encode"},
]


def demo_script(d: dict) -> str:
    extra = f"\n\n> Revised for: {d['plan_note']}" if d.get("plan_note") else ""
    return (f"# Demo: {d['url']}\n\n**For:** {d['audience']}\n\n**Pitch:** {d['show']}\n\n"
            "## Run of show\n\n1. A request arrives (0:00 to 0:35)\n2. Someone approves it (0:35 to 1:05)\n"
            "3. It ships (1:05 to 1:40)\n\nThe requests on screen are synthetic data, labelled as such; "
            "timings were measured on the rehearsal.") + extra


def demo_tick(d: dict) -> None:
    """Advance a demo run on the clock (caller holds demo_lock)."""
    now = time.time()
    if d["stage"] == "planning" and now >= d["ready_at"]:
        d["stage"] = "plan_gate"
        if d.get("script_override") is None:
            d["script"] = demo_script(d)
    if d["stage"] == "recording":
        todo = [c for c in DEMO_CHAPTERS if c["key"] not in d["recorded"]]
        while todo and now >= d["next_at"]:
            d["recorded"].append(todo.pop(0)["key"])
            d["next_at"] += DEMO_CHAPTER_S
        if not todo and now >= d["next_at"]:
            d["stage"] = "review_gate"
            d["round"] += 1


def demo_session(rid: str, d: dict) -> dict:
    stage = d["stage"]
    status = {"planning": "executing", "plan_gate": "awaiting_human", "recording": "executing",
              "review_gate": "awaiting_human", "done": "completed"}[stage]
    # The engine's shape (wicked-core awaitingHuman{ord: 3, reviewingOrd: 2}): a step's gate opens once
    # it is done, with the cursor already on the next unit; the review gate is the last unit, done.
    cursor = {"planning": 1, "plan_gate": 2, "recording": 2, "review_gate": 3, "done": 3}[stage]
    units = []
    for i, (step, cli) in enumerate([("pa-scope", "claude"), ("plan", "claude"), ("record", "claude"),
                                     ("review", "codex")]):
        st = "done" if i < cursor or stage == "done" or (stage == "review_gate" and i == cursor) \
            else "running" if i == cursor and status == "executing" else "pending"
        units.append({"id": f"{rid}:{step}", "session_id": rid, "ord": i + 1, "description": f"demo: {step}",
                      "stage": "critique" if step == "review" else "produce", "assigned_cli": cli,
                      "assigned_invocation": None, "council_task_ref": None, "routing": None,
                      "denial_reason": None, "phase_ref": None, "conformance_ref": None, "phase_status": None,
                      "collection_scope": None, "status": st})
    run = session(rid, status, f"Make a demo of {d['url']} with the wicked-garden-demo skill", "demo")
    run["session"].update({"workflow_id": f"{rid}:plan-2", "project_id": d["pid"], "unit_ix": cursor,
                           "team_plan": {"rev": 2, "accepted_rev": 2, "preset": "demo"},
                           "human_confirm": "all"})
    run["units"] = units
    return run


_sheet_pngs: dict = {}


def sheet_png(i: int) -> bytes:
    """A contact sheet stand-in: a plain 320x180 PNG, built with zlib alone (CI has no Pillow)."""
    if i not in _sheet_pngs:
        import struct
        import zlib
        w, h = 320, 180
        rgb = [(27, 98, 74), (60, 90, 160), (150, 110, 40)][i % 3]
        raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

        def chunk(tag: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        _sheet_pngs[i] = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                          + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return _sheet_pngs[i]


def demo_view(rid: str, d: dict) -> dict:
    stage = d["stage"]
    planned = d["script"] is not None
    recorded_all = len(d["recorded"]) == len(DEMO_CHAPTERS)
    reviewed = stage in ("review_gate", "done")
    findings = DEMO_ROUND1_FINDINGS if reviewed and d["round"] == 1 else []
    has_video = d["round"] >= 1
    return {
        "runId": rid, "url": d["url"], "audience": d["audience"], "stage": stage,
        "script": d["script"] if planned else None,
        "chapters": [dict(c, recorded=c["key"] in d["recorded"]) for c in DEMO_CHAPTERS] if planned else [],
        "markers": [{"at": "0:00", "sec": 0, "title": "A request arrives"},
                    {"at": "0:35", "sec": 35, "title": "Someone approves it"},
                    {"at": "1:05", "sec": 65, "title": "It ships"}] if has_video else [],
        "sheets": [{"name": n, "path": f"review/{n}.png"} for n in ("chapters", "joins", "end")] if has_video else [],
        "video": {"path": "demo-video/demo.mp4", "bytes": len(tiny_webm())} if has_video else None,
        "recording": {"readOnly": True if has_video and recorded_all else None},
        # Round 1 is the engine's NOT PASS: the review unit is rejected and its gate is the escalation gate.
        "review": {"verdict": ("changes" if d["round"] == 1 else "accept") if reviewed else None,
                   "rejected": reviewed and d["round"] == 1,
                   "findings": findings,
                   "text": ("0:41 · 02-approve · the caption is early · re-record" if findings else "Clean.") if reviewed else None},
        "seats": {"recorder": "claude", "reviewer": "codex" if reviewed else None},
        "syntheticLabelled": planned and "synthetic" in (d["script"] or "").lower(),
    }


def capture_rows(run_id: str, project_id: str) -> list:
    """What the capture run files — the crew 0.48.0 shapes: kind "memory", payload.capture, the
    run's project facet (the shim stamps it), provenance.run_id = the capture run."""
    def row(n: int, capture: str, content: str, tier: str, **extra) -> dict:
        return {"id": f"{run_id}-p{n}", "kind_type": "memory",
                "payload": {"content": content, "tier": tier, "capture": capture, **extra},
                "facets": {"project": project_id}, "provenance": {"run_id": run_id, "run_unit": "1"},
                "state": "pending", "created_at": NOW0 // 1000 + n}
    return [
        row(1, "intent", "Add resumable uploads to the upload endpoint", "episodic"),
        row(2, "decision", "Chose S3 presigned URLs over proxying uploads through the API, to keep large files off the app servers", "semantic"),
        row(3, "decision", "Uploads are capped at 5 GB per file for launch", "semantic"),
        row(4, "memory", "Large uploads should go straight to object storage with presigned URLs, not through the app", "procedural", reach="pattern"),
        {"id": f"{run_id}-p5", "kind_type": "policy:development",
         "payload": {"rule": "Every upload route streams to object storage; none buffers a file in memory",
                     "severity": "warn", "capture": "rule"},
         "facets": {"project": project_id}, "provenance": {"run_id": run_id, "run_unit": "1"},
         "state": "pending", "created_at": NOW0 // 1000 + 5},
    ]

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
#
# STUDIO_SKIN (env) — the skin every rig boots under (src/theming/skins.ts). It rides the
# stored `studio.appearance.skin`, the SAME path the Theme page's picker persists through,
# so `STUDIO_SKIN=compact-rail python3 e2e/wave2b_queue_test.py` runs a behaviour journey
# under the proof skin with no rig change. Unset = `studio`, the classic look. The record is
# past the flip (`skin_migrated`, S15b), so the stored skin is honoured as chosen — a record
# without it would resolve to `desk`, the default since the flip.
STUDIO_SKIN = os.environ.get("STUDIO_SKIN", "studio")
# Each skin's shell (src/theming/skins.ts `shell`), as App's root stamps it in `data-shell`.
SKIN_SHELL = {"studio": "classic", "compact-rail": "right-rail", "desk": "desk"}


def wait_for_skin(page, timeout: int = 15000) -> None:
    """Wait until the page renders under STUDIO_SKIN. The first paint is the default skin (the
    Desk since S15b) until GET /settings lands `studio.appearance`; an element both shells carry
    can be visible in that first paint and then remount. Waits for `<html data-skin>` and App's
    `data-shell` together, so React has committed the swap."""
    page.wait_for_function(
        """([skin, shell]) => document.documentElement.getAttribute('data-skin') === skin
            && document.querySelector('[data-shell]')?.getAttribute('data-shell') === shell""",
        arg=[STUDIO_SKIN, SKIN_SHELL[STUDIO_SKIN]], timeout=timeout)
DEFAULT_APPEARANCE = {"accent_h": 230, "accent_s": 74, "accent_l": 68,
                      "logo_url": None, "theme": "dark", "skin": STUDIO_SKIN, "skin_migrated": True}
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

# ── Sessions corpus (switch `sessions`, S6a) ──────────────────────────────────
def _session_run(rid: str, status: str, problem: str, chat: str | None, created_s: int,
                 ended_s: int | None, units: list) -> dict:
    r = session(rid, status, problem, problem)
    r["session"]["created_at"] = created_s
    if ended_s is not None:
        r["session"]["ended_at"] = ended_s
    if chat is not None:
        r["session"]["chat_id"] = chat
    r["units"] = [dict(r["units"][0], id=f"{rid}:u{i}", ord=i, description=d, phase_ref=ph, status=st)
                  for i, (d, ph, st) in enumerate(units)]
    return r


SESSION_T0 = NOW0 // 1000 - 7200  # two hours ago, unix seconds
SESSION_RUNS = [
    _session_run("r-pay-1", "completed", "find why checkout charges twice", "chat-pay",
                 SESSION_T0, SESSION_T0 + 600,
                 [("read the checkout code", "understand", "done"), ("write up the cause", "produce", "done")]),
    _session_run("r-pay-2", "executing", "fix the double charge on checkout, then show me", "chat-pay",
                 SESSION_T0 + 1800, None,
                 [("understand", "understand", "done"), ("build", "build", "distributed"),
                  ("test", "test", "pending"), ("review", "review", "pending"), ("deliver", "deliver", "pending")]),
    _session_run("r-solo", "executing", "tidy the settings page copy", None, SESSION_T0 + 2400, None,
                 [("build", "build", "distributed")]),
    _session_run("r-old", "completed", "rename the invoice fields", "chat-gone", SESSION_T0 - 86400,
                 SESSION_T0 - 86000, [("build", "build", "done")]),
]
SESSION_STEPS = [
    {"catalog": "understand", "id": "understand"},
    {"catalog": "build", "id": "build"},
    {"catalog": "test", "id": "test", "added_by": "floor", "floor_reason": "a change to payment code is tested"},
    {"catalog": "review", "id": "review", "added_by": "floor", "floor_reason": "band 20+ always reviews"},
    {"catalog": "deliver", "id": "deliver"},
]


def _team_row(eid: int, etype: str, run_id: str, **payload) -> dict:
    base = {"run_id": run_id, "ord": payload.pop("ord", None), "attempt": None, "by": payload.pop("by", "engine"),
            "at": (SESSION_T0 + 1800) * 1000 + eid, "re": None}
    return {"event_id": eid, "event_type": etype, "emitted_at": (SESSION_T0 + 1800) * 1000 + eid,
            "payload": dict(base, **payload)}


def session_team(rid: str) -> dict | None:
    """GET /runs/:id/team for the sessions corpus (crew RunTeamResponse)."""
    blank = {"runId": rid, "streamFloor": None, "pending": None, "units": [], "rows": []}
    if rid in ("r-pay-1", "r-old"):
        return dict(blank, teamed=False, transport=None, reason=None, planRev=None, ended=True)
    if rid == "r-solo":
        return dict(blank, teamed=True, transport="none", reason="the team bus was unreachable at launch",
                    planRev=1, ended=False)
    if rid == "r-pay-2":
        rows = [
            _team_row(901, "wicked.team.plan.proposed", rid, proposal_id="p-1", base_rev=None, kind="initial",
                      preset=None, steps=SESSION_STEPS[:2] + SESSION_STEPS[4:], monitors={"asked": 1}, asks=[],
                      touch=["src/checkout/"], override=None, rationale="", by="claude#1"),
            _team_row(902, "wicked.team.plan.accepted", rid, plan_rev=1, workflow_id="r-pay-2:plan-1",
                      band="40-69", high_risk=False, mode="auto", steps=SESSION_STEPS, override=None,
                      proposal_id="p-1"),
        ]
        unit_rows = [
            _team_row(903, "wicked.team.step.claimed", rid, ord=0, step_id="understand", role="creator",
                      kind="agent", phase="understand", criterion="", baseline_tree=None, repo=None,
                      code_graph_db=None, by="claude#1"),
            _team_row(904, "wicked.team.step.completed", rid, ord=0, step_id="understand", status="ok",
                      tree=None, output_bytes=10, output_ref="u0", by="claude#1"),
            _team_row(905, "wicked.team.step.claimed", rid, ord=1, step_id="build", role="creator", kind="agent",
                      phase="build", criterion="", baseline_tree=None, repo=None, code_graph_db=None,
                      by="codex"),
        ]
        return dict(blank, teamed=True, transport="bus", reason=None, planRev=1, ended=False, rows=rows,
                    units=[{"ord": 0, "transport": "bus", "reason": None, "rows": unit_rows[:2]},
                           {"ord": 1, "transport": "bus", "reason": None, "rows": unit_rows[2:]}])
    return None


# ── Proposals corpus (switch `ship_proposals`, S6b) ─────────────────────────────────
SHIP_WORKDIR = "/w/r-ship-deliver"
SHIP_PLAN_PROMPT = ("Approve plan rev 1 before unit 0 runs (manual mode; band 20-39; manual mode): "
                    "understand → build → test → review")
SHIP_DELIVER_CARD = ("Pushes branch wicked/r-ship-deliver to acme/shop on GitHub and opens a pull request there; "
                     "merge stays human.")  # crew newPrTargetSentence (github)
PROPOSAL_RUNS = [
    _session_run("r-ship-plan", "awaiting_human", "add a FREESHIP code to the checkout", "chat-ship",
                 SESSION_T0 + 3000, None,
                 [("understand", "understand", "pending"), ("build", "build", "pending"),
                  ("test", "test", "pending"), ("review", "review", "pending")]),
    _session_run("r-ship-deliver", "awaiting_human", "show the free-shipping banner on the cart", "chat-ship",
                 SESSION_T0 + 3300, None,
                 [("understand", "understand", "done"), ("build", "build", "done"), ("test", "test", "done"),
                  ("review", "review", "done"),
                  ("deliver — show the free-shipping banner on the cart ||| " + SHIP_DELIVER_CARD
                   + " Push identity: the daemon's gh sign-in", "deliver", "pending")]),
]
for _r in PROPOSAL_RUNS:
    _r["session"]["human_confirm"] = "all"
PROPOSAL_RUNS[1]["units"][4]["id"] = "r-ship-deliver:deliver"  # crew names a phase's unit <run>:<phase>
PROPOSAL_RUNS[1]["session"]["workdir"] = SHIP_WORKDIR
PROPOSAL_RUNS[1]["session"]["run_branch"] = "wicked/r-ship-deliver"
PROPOSAL_GATES = {"r-ship-plan": (0, SHIP_PLAN_PROMPT),
                  "r-ship-deliver": (4, "Approve unit 4 before it runs: deliver")}
SHIP_STEPS = [{"catalog": c, "id": c} for c in ("understand", "build", "test", "review")]
SHIP_CHECKOUT_TS = "\n".join(
    ["// checkout.ts — the cart total and the free-shipping rule"]
    + [f"// line {i}" for i in range(2, 12)]
    + ["export const FREE_SHIPPING_OVER = 50; // carts over $50 ship free"]
    + [f"// line {i}" for i in range(13, 25)])


def proposal_team(rid: str) -> dict | None:
    blank = {"runId": rid, "streamFloor": None, "pending": None, "units": [], "rows": []}
    if rid == "r-ship-plan":
        rows = [_team_row(951, "wicked.team.plan.proposed", rid, proposal_id="p-ship", base_rev=None,
                          kind="initial", preset=None, steps=SHIP_STEPS, monitors={"asked": 1}, asks=[],
                          touch=["src/checkout/"], override=None, rationale="", by="claude#1")]
        return dict(blank, teamed=True, transport="bus", reason=None, planRev=None, ended=False, rows=rows)
    if rid == "r-ship-deliver":
        steps = SHIP_STEPS + [{"catalog": "deliver", "id": "deliver"}]
        rows = [_team_row(961, "wicked.team.plan.accepted", rid, plan_rev=1, workflow_id="r-ship-deliver:plan-1",
                          band="20-39", high_risk=False, mode="manual", steps=steps, override=None,
                          proposal_id="p-ship-2")]
        unit_rows = []
        for i, st in enumerate(SHIP_STEPS):
            unit_rows.append(_team_row(962 + 2 * i, "wicked.team.step.claimed", rid, ord=i, step_id=st["id"],
                                       role="creator", kind="agent", phase=st["id"], criterion="",
                                       baseline_tree=None, repo=None, code_graph_db=None, by="claude#1"))
            unit_rows.append(_team_row(963 + 2 * i, "wicked.team.step.completed", rid, ord=i, step_id=st["id"],
                                       status="ok", tree=None, output_bytes=10, output_ref=f"u{i}", by="claude#1"))
        return dict(blank, teamed=True, transport="bus", reason=None, planRev=1, ended=False, rows=rows,
                    units=[{"ord": i, "transport": "bus", "reason": None, "rows": unit_rows[2 * i:2 * i + 2]}
                           for i in range(4)])
    return None


# ── Walkthrough corpus (switch `walkthrough`, needs `sessions`; e2e/desk_walkthrough_test.py) ──
# crew's WT-W1 view (`api/recording.ts` walkthroughView) over what a proof root holds. Units are
# named `<run>:<step>` (crew's rule), the walkthrough pair is the floor's, the evaluator seat (agy)
# is not the builder (codex). r-walk-fail waits at the recorder's escalation gate (the denied unit's
# ord); a request_changes sends it back to the helpers, a storyline PUT + approve records it again.
WALK_REC, WALK_FAIL, WALK_PASS, WALK_THIN, WALK_DEMO = "r-walk-rec", "r-walk-fail", "r-walk-pass", "r-walk-thin", "r-walk-demo"
WALK_RULE = "your testing rule: checkout and payments get a walkthrough"
WALK_STEPS = [
    {"catalog": "understand", "id": "understand"},
    {"catalog": "build", "id": "build"},
    {"catalog": "test", "id": "test", "added_by": "floor", "floor_reason": "a change to payment code is tested"},
    {"catalog": "walkthrough_plan", "id": "walkthrough_plan", "added_by": "floor", "floor_reason": WALK_RULE,
     "floor_rule": "TST-1001"},
    {"catalog": "walkthrough_review", "id": "walkthrough_review", "added_by": "floor", "floor_reason": WALK_RULE,
     "floor_rule": "TST-1001"},
    {"catalog": "deliver", "id": "deliver"},
]
WALK_REVIEW_ORD = 4
# WT-U2 (scene 28 qa-yours): a run whose accepted plan's floor override REMOVED the walkthrough pair —
# end-to-end testing is the operator's; it waits at its deliver gate.
WALK_YOURS = "r-walk-yours"
WALK_STEPS_YOURS = [s for s in WALK_STEPS if not s["id"].startswith("walkthrough")]
WALK_YOURS_DELIVER_ORD = 3
WALK_YOURS_OVERRIDE = {"remove": ["walkthrough_plan", "walkthrough_review"], "reason": "our QA team tests end to end"}
WALK_TREE = "9f3c2ab4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6"  # the tree the sealed take recorded against
WALK_ESC_PROMPT = ("Unit 4 failed its deterministic floor (walkthrough_failed): the walkthrough failed in chapter 4 "
                   "(Pay for the order) — confirm to record it again, or reject to cancel the run")
# (key, title, narration, start second in the stitched take)
WALK_CHAPTERS = [
    ("01-cart", "Add to the cart", "Two items go into the cart.", 0),
    ("02-checkout", "Go to checkout", "The order summary shows the total.", 9),
    ("03-card", "Enter the card", "A test card is typed in.", 21),
    ("04-pay", "Pay for the order", "Pay is pressed once; the button waits.", 30),
    ("05-receipt", "See the receipt", "The receipt shows one charge.", 48),
    ("06-orders", "Find it in orders", "The order is in the history, paid once.", 60),
]
WALK_STORYLINE_DENIAL = "the walkthrough failed in chapter 4 (Pay for the order): the card was charged twice"
walk_lock = threading.Lock()
walk_phase: dict = {}     # run id -> "failed" | "fixing" | "rerecording" (absent = as launched)
walk_posts: list = []     # every storyline PUT and demo export (GET /__fixture/walkthrough-posts)
walk_exports: dict = {}   # run id -> {"gif": bool, "poster": bool}
# A real JPEG (160x90, one colour): the poster a take wrote, served as what its name says it is.
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgYGBwYHCEhISEhISckJygoKCcnJycoKCgrKyszMzMr"
    "KysoKCsrMDAzMzc5NzQ0MzQ5OTw8PEhIRUVUVFdnZ3z/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAUG"
    "EAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAWgCgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AlwGnSgAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAH/9k=")
_walk_take: list = [None]


def walk_take() -> bytes:
    """The stitched take: 72 s of one colour (fixtures/walk-72s.webm, 10 KB, a keyframe each second),
    long enough that a seek to the failing moment (0:41) or a chapter is a real position."""
    if _walk_take[0] is None:
        _walk_take[0] = (Path(__file__).resolve().parent / "fixtures" / "walk-72s.webm").read_bytes()
    return _walk_take[0]


def walk_files(rid: str) -> set:
    """Every proof-root path the run's view names (the take, the poster, the failing frame, each
    check's evidence): the file route serves these and nothing else."""
    view = walk_view(rid, None, 0) or {}
    out = {p for p in (view.get("video", {}).get("mp4"), view.get("video", {}).get("poster")) if p}
    for ch in view.get("chapters", []):
        if ch.get("failedFrame"):
            out.add(ch["failedFrame"])
        for chk in ch.get("checks", []):
            out.update(chk.get("evidence", []))
    return out


TINY_GIF = (b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,"
            b"\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")


def _walk_check(cid: str, kind: str, sentence: str, passed, at, evidence: list, detail=None, vault=None) -> dict:
    return {"id": cid, "kind": kind, "sentence": sentence, "passed": passed, "atSec": at, "evidence": evidence,
            "vaultEntry": vault, "detail": detail}


def _walk_checks(key: str, failing: bool) -> list:
    """Every check kind of §4.5 appears somewhere in the take (the seven kinds)."""
    by = {
        "01-cart": [_walk_check("cart-screen", "on_screen", "The cart shows two items", True, 4, [f"vault/{key}/evidence/cart.png"], vault="ve-101"),
                    _walk_check("cart-saved", "saved_state", "The cart row holds two lines", True, 6, [f"vault/{key}/evidence/cart.json"], vault="ve-102")],
        "02-checkout": [_walk_check("total-screen", "on_screen", "The total reads $42.00", True, 5, [f"vault/{key}/evidence/total.png"], vault="ve-201"),
                        _walk_check("total-output", "output", "The summary request answers 200 with the same total", True, 7, [f"vault/{key}/evidence/summary.json"], vault="ve-202")],
        "03-card": [_walk_check("card-screen", "on_screen", "The card field shows the test card", True, 5, [f"vault/{key}/evidence/card.png"], vault="ve-301")],
        "04-pay": [_walk_check("pay-screen", "on_screen", "The Pay button waits after one press", True, 6, [f"vault/{key}/evidence/pay.png"], vault="ve-401"),
                   _walk_check("pay-events", "events", "One charge event is emitted", not failing, 11, [f"vault/{key}/evidence/events.json"],
                               detail="two charge events were emitted" if failing else None, vault="ve-402"),
                   _walk_check("pay-effects", "side_effects", "The card is charged once at the provider", not failing, 11, [f"vault/{key}/evidence/provider.json"],
                               detail="the provider recorded two charges of $42.00" if failing else None, vault="ve-403"),
                   _walk_check("pay-never", "must_not_happen", "The customer is never charged twice", not failing, 11, [f"vault/{key}/evidence/charges.json"], vault="ve-404")],
        "05-receipt": [_walk_check("receipt-screen", "on_screen", "The receipt shows one charge", True, 5, [f"vault/{key}/evidence/receipt.png"], vault="ve-501"),
                       _walk_check("receipt-cross", "cross_check", "The receipt total matches the provider's record", True, 8, [f"vault/{key}/evidence/cross.json"], vault="ve-502")],
        "06-orders": [_walk_check("orders-saved", "saved_state", "The order is saved as paid, once", True, 6, [f"vault/{key}/evidence/order.json"], vault="ve-601")],
    }
    return by[key]


def _walk_chapter(i: int, **over) -> dict:
    key, title, blurb, _start = WALK_CHAPTERS[i]
    base = {"key": key, "title": title, "blurb": blurb, "tags": [], "resets": [], "recorded": True,
            "index": i + 1, "total": len(WALK_CHAPTERS), "verdict": "PASS", "takes": 1, "failedAtSec": None,
            "failedFrame": None, "proves": ["build"], "legs": [], "checks": _walk_checks(key, False)}
    base.update(over)
    return base


def _walk_markers() -> list:
    return [{"at": f"{st // 60}:{st % 60:02d}", "sec": st, "title": title} for _k, title, _b, st in WALK_CHAPTERS]


def _walk_units(rid: str, statuses: list, denial: str | None = None, steps: list = WALK_STEPS) -> list:
    clis = {"understand": "claude", "build": "codex", "test": "claude", "walkthrough_plan": "agy",
            "walkthrough_review": None, "deliver": None}
    roles = {"build": "creator", "walkthrough_plan": "evaluator"}
    out = []
    for i, (st, status) in enumerate(zip(steps, statuses)):
        sid = st["id"]
        unit = {"id": f"{rid}:{sid}", "session_id": rid, "ord": i, "description": sid.replace("_", " "),
                "stage": "critique" if sid.startswith("walkthrough") else "produce", "assigned_cli": clis[sid],
                "assigned_invocation": None, "council_task_ref": None, "routing": None,
                "denial_reason": denial if sid == "walkthrough_review" and status == "rejected" else None,
                "phase_ref": sid, "conformance_ref": None, "phase_status": None, "collection_scope": None,
                "status": status}
        if sid in roles:
            unit["role"] = roles[sid]
        if clis[sid] is None:
            unit["tool_cmd"] = ["wicked-garden", sid]
        out.append(unit)
    return out


def walk_runs() -> list:
    """The corpus as it stands now (r-walk-fail moves with the operator's gate answers)."""
    with walk_lock:
        phase = walk_phase.get(WALK_FAIL, "failed")
        thin_phase = walk_phase.get(WALK_THIN, "failed")

    def run(rid: str, status: str, problem: str, statuses: list, created: int, denial=None, unit_ix=WALK_REVIEW_ORD,
            steps: list = WALK_STEPS) -> dict:
        r = session(rid, status, problem, problem)
        r["session"].update(created_at=created, unit_ix=unit_ix, evidence_root=f"/w/evidence/{rid}",
                            team_plan={"rev": 1, "accepted_rev": 1, "preset": None}, human_confirm="all")
        r["units"] = _walk_units(rid, statuses, denial, steps)
        return r
    done3 = ["done", "done", "done"]
    fail_statuses = {"failed": done3 + ["done", "rejected", "pending"],
                     "fixing": ["done", "distributed", "pending", "pending", "pending", "pending"],
                     "rerecording": done3 + ["done", "distributed", "pending"]}
    out = [
        run(WALK_REC, "executing", "stop the checkout charging twice, then walk me through it",
            done3 + ["done", "distributed", "pending"], SESSION_T0 + 4000),
        run(WALK_FAIL, "awaiting_human" if phase == "failed" else "executing",
            "make Pay wait, so one press charges once", fail_statuses[phase], SESSION_T0 + 4300,
            denial=WALK_STORYLINE_DENIAL, unit_ix=1 if phase == "fixing" else WALK_REVIEW_ORD),
        run(WALK_PASS, "completed", "show the saved card on the pay page",
            done3 + ["done", "done", "done"], SESSION_T0 + 4600, unit_ix=6),
        run(WALK_THIN, "awaiting_human" if thin_phase == "failed" else "executing",
            "round the totals the same way everywhere", fail_statuses[thin_phase], SESSION_T0 + 4900,
            denial="the walkthrough failed in chapter 02-rounding", unit_ix=1 if thin_phase == "fixing" else WALK_REVIEW_ORD),
    ]
    out[2]["session"]["ended_at"] = SESSION_T0 + 5200
    # WT-U2: the pair removed by the operator's plan override; waiting at its deliver gate.
    yours = run(WALK_YOURS, "awaiting_human", "let the cashier void one line of an order",
                ["done", "done", "done", "pending"], SESSION_T0 + 5100, unit_ix=WALK_YOURS_DELIVER_ORD, steps=WALK_STEPS_YOURS)
    yours["session"]["team_plan"]["accepted"] = {"floor_override": WALK_YOURS_OVERRIDE}
    out.append(yours)
    demo = demo_session(WALK_DEMO, WALK_DEMO_STATE)
    demo["session"]["created_at"] = SESSION_T0 + 5400
    for u in demo["units"]:  # the demo preset's phases, as crew names them on the unit
        u["phase_ref"] = u["id"].split(":", 1)[1]
    out.append(demo)
    return out


WALK_DEMO_STATE = {"pid": "notes", "url": "http://localhost:5173", "audience": "the library panel",
                   "show": "booking a room, start to finish", "stage": "done", "script": None, "script_override": None,
                   "plan_note": None, "recorded": [c["key"] for c in DEMO_CHAPTERS], "next_at": 0.0, "round": 2}
WALK_DEMO_STATE["script"] = demo_script(WALK_DEMO_STATE)


def walk_acceptance(rid: str, wt: bool = True) -> dict:
    """crew's GET /runs/:id/acceptance for the corpus (qe/acceptance.ts): the gate, the WT-W2 `walkthrough`
    block — one root per walkthrough_review step the requirement names, re-verified against its seal, and
    the per-CREATOR-step `checkState` from the newest sealed take (crew asserts no `atSec`: the moment is
    not sealed) — and the WT-W3 `summary`, the deliver card's one line. `wt` False = a daemon before
    WT-W2/W3: neither block. The yours run (WT §4.9 `owned_by_you`) carries its step state with no root."""
    with walk_lock:
        phase = walk_phase.get(rid, "failed")
    tree = WALK_TREE

    def body(gate: dict, steps: list, roots: list | None, line: str, counts: dict | None) -> dict:
        out = {"runId": rid, "gate": gate}
        if wt:
            if roots is not None:
                out["walkthrough"] = {"roots": roots, "sealed": all(r["sealed"] for r in roots), "steps": steps}
            out["summary"] = {"required": gate["required"], "satisfied": gate["satisfied"], "line": line, "walkthrough": counts}
        return out

    if rid == WALK_PASS:
        reason = "walkthrough_review: 6 of 6 chapters PASS; the seal held"
        return body({"required": True, "satisfied": True, "verdict": "PASS", "reason": reason},
                    [{"stepId": "build", "checkState": "checked",
                      "provedBy": [{"chapter": "04-pay", "atSec": None}, {"chapter": "05-receipt", "atSec": None}]}],
                    [{"stepId": "walkthrough_review", "sealed": True, "satisfied": True, "reason": reason}],
                    f"Checked by a walkthrough: 1 of 1 step at {tree[:7]}.",
                    {"checked": 1, "failed": 0, "ownedByYou": 0, "steps": 1, "sealed": True, "tree": tree})
    if rid == WALK_FAIL and phase == "failed":
        return body({"required": True, "satisfied": False, "verdict": "FAIL", "reason": WALK_STORYLINE_DENIAL},
                    [{"stepId": "build", "checkState": "failed", "provedBy": [{"chapter": "04-pay", "atSec": None}]}],
                    [{"stepId": "walkthrough_review", "sealed": True, "satisfied": False, "reason": WALK_STORYLINE_DENIAL}],
                    f"Not accepted yet: {WALK_STORYLINE_DENIAL}",
                    {"checked": 0, "failed": 1, "ownedByYou": 0, "steps": 1, "sealed": True, "tree": tree})
    if rid == WALK_YOURS:
        return body({"required": True, "satisfied": True, "verdict": "PASS", "reason": "the repo's checks passed; the plan's override left the walkthrough to you"},
                    [{"stepId": "build", "checkState": "owned_by_you", "provedBy": []}], [],
                    "Accepted: the checks this run had to pass have passed.", None)
    if rid == WALK_THIN:
        reason = "walkthrough_review: the result carries no seal line, so nothing it says can be verified"
        return body({"required": True, "satisfied": False, "verdict": None, "reason": reason},
                    [{"stepId": "build", "checkState": "claimed", "provedBy": []}],
                    [{"stepId": "walkthrough_review", "sealed": False, "satisfied": False, "reason": reason}],
                    f"Not accepted yet: {reason}", {"checked": 0, "failed": 0, "ownedByYou": 0, "steps": 1, "sealed": False, "tree": None})
    reason = "walkthrough_review has not sealed a take"  # recording, fixing, re-recording
    return body({"required": True, "satisfied": False, "verdict": None, "reason": reason},
                [{"stepId": "build", "checkState": "claimed", "provedBy": []}],
                [{"stepId": "walkthrough_review", "sealed": False, "satisfied": False, "reason": reason}],
                f"Not accepted yet: {reason}.", {"checked": 0, "failed": 0, "ownedByYou": 0, "steps": 1, "sealed": False, "tree": None})


def walk_gate(rid: str) -> dict | None:
    """The open gate of a walkthrough run: its recorder's escalation, while the take stands failed."""
    with walk_lock:
        phase = walk_phase.get(rid, "failed")
    if rid in (WALK_FAIL, WALK_THIN) and phase == "failed":
        prompt = WALK_ESC_PROMPT if rid == WALK_FAIL else \
            "Unit 4 failed its deterministic floor (walkthrough_failed) — confirm to record it again, or reject to cancel the run"
        return {"runId": rid, "ord": WALK_REVIEW_ORD, "lifecycle": "open", "prompt": prompt,
                "receivedAt": iso((SESSION_T0 + 5000) * 1000), "options": None}
    if rid == WALK_YOURS:  # WT-U2: the hand-over waits on the operator
        return {"runId": rid, "ord": WALK_YOURS_DELIVER_ORD, "lifecycle": "open",
                "prompt": "deliver: push the run branch and open a PR on origin — confirm to deliver, reject to keep it local",
                "receivedAt": iso((SESSION_T0 + 5300) * 1000), "options": None}
    return None


def walk_team(rid: str) -> dict | None:
    blank = {"runId": rid, "streamFloor": None, "pending": None, "units": [], "rows": []}
    if rid == WALK_DEMO:  # a preset run: not a team run, its chain renders from its units
        return dict(blank, teamed=False, transport=None, reason=None, planRev=None, ended=True)
    if rid not in (WALK_REC, WALK_FAIL, WALK_PASS, WALK_THIN, WALK_YOURS):
        return None
    steps = WALK_STEPS_YOURS if rid == WALK_YOURS else WALK_STEPS
    rows = [_team_row(971, "wicked.team.plan.accepted", rid, plan_rev=1, workflow_id=f"{rid}:plan-1", band="40-69",
                      high_risk=False, mode="manual", steps=steps, override=WALK_YOURS_OVERRIDE if rid == WALK_YOURS else None,
                      proposal_id="p-walk")]
    unit_rows = []
    by_status = {u["id"].split(":", 1)[1]: u["status"] for r in walk_runs() if r["session"]["id"] == rid for u in r["units"]}
    for i, st in enumerate(steps):
        status = by_status.get(st["id"], "pending")
        mine = []
        if status in ("done", "distributed", "rejected"):
            mine.append(_team_row(972 + 2 * i, "wicked.team.step.claimed", rid, ord=i, step_id=st["id"],
                                  role="evaluator" if st["id"].startswith("walkthrough") else "creator", kind="agent",
                                  phase=st["id"], criterion="", baseline_tree=None, repo=None, code_graph_db=None,
                                  by="agy" if st["id"] == "walkthrough_plan" else "codex"))
        if status in ("done", "rejected"):
            mine.append(_team_row(973 + 2 * i, "wicked.team.step.completed", rid, ord=i, step_id=st["id"],
                                  status="ok" if status == "done" else "failed", tree=None, output_bytes=10,
                                  output_ref=f"u{i}", by="codex"))
        unit_rows.append({"ord": i, "transport": "bus", "reason": None, "rows": mine})
    return dict(blank, teamed=True, transport="bus", reason=None, planRev=1, ended=rid == WALK_PASS, rows=rows,
                units=unit_rows)


def walk_view(rid: str, step: str | None, recorded: int) -> dict | None:
    """crew's WalkthroughView for the corpus; `None` = a `step` that names no walkthrough step (404)."""
    if rid == WALK_YOURS or step not in (None, "walkthrough_review", "walkthrough_plan"):
        return None
    with walk_lock:
        phase = walk_phase.get(rid, "failed")
    n = len(WALK_CHAPTERS)
    base = {"runId": rid, "stepId": "walkthrough_review", "planStepId": "walkthrough_plan", "cause": None,
            "seat": {"evaluator": "agy", "builders": ["codex"]}, "tree": None, "stale": False, "sealed": False,
            "video": {"mp4": None, "poster": None, "markers": []}, "chapters": [], "steps": []}
    planned = [_walk_chapter(i, recorded=False, verdict=None, checks=[], proves=[]) for i in range(n)]
    if rid == WALK_REC or (rid in (WALK_FAIL, WALK_THIN) and phase == "rerecording"):
        got = max(0, min(n, recorded if rid == WALK_REC else 0))
        return dict(base, state="recording",
                    chapters=[dict(c, recorded=i < got) for i, c in enumerate(planned)])
    if rid in (WALK_FAIL, WALK_THIN) and phase == "fixing":
        return dict(base, state="authoring", seat={"evaluator": None, "builders": ["codex"]}, chapters=[])
    if rid == WALK_FAIL:
        chapters = [_walk_chapter(i) for i in range(n)]
        chapters[3] = _walk_chapter(3, verdict="FAIL", takes=2, failedAtSec=11,
                                    failedFrame="segments/04-pay/failed-2/frame.png", checks=_walk_checks("04-pay", True))
        return dict(base, state="failed", tree="4b1c9e0a7d2f", sealed=True, chapters=chapters,
                    video={"mp4": "demo-video/demo.mp4", "poster": None, "markers": _walk_markers()},
                    steps=[{"stepId": "build", "checkState": "failed", "provedBy": [{"chapter": "04-pay", "atSec": 11}]}])
    if rid == WALK_PASS:
        return dict(base, state="passed", tree="9f8e7d6c5b4a", sealed=True, chapters=[_walk_chapter(i) for i in range(n)],
                    video={"mp4": "demo-video/demo.mp4", "poster": "demo-video/poster.jpg", "markers": _walk_markers()},
                    steps=[{"stepId": "build", "checkState": "checked", "provedBy": [{"chapter": "04-pay", "atSec": 11}]}])
    if rid == WALK_THIN:
        # What garden 12.41.0's walkthrough tool gives crew to read: result.json chapters of
        # {key, verdict, failed_at_sec} only — no chapters.json, no checks, no frame, no stitched take.
        thin = [("01-totals", "PASS", None), ("02-rounding", "FAIL", 7.5), ("03-receipt", "PASS", None)]
        return dict(base, state="failed", sealed=True,
                    chapters=[{"key": k, "title": k, "blurb": "", "tags": [], "resets": [], "recorded": False,
                               "index": i + 1, "total": len(thin), "verdict": v, "takes": 1,
                               "failedAtSec": at, "failedFrame": None, "proves": [], "legs": [], "checks": []}
                              for i, (k, v, at) in enumerate(thin)])
    return dict(base, stepId=None, planStepId=None, state="authoring", cause="no_walkthrough",
                seat={"evaluator": None, "builders": []})


# ── Reel corpus (switch `reel_runs`, needs `sessions`; e2e/desk_reel_words_test.py) ─────────
# The shapes the wave-4 reel takes met on crew 0.7.46 (studio#440-#445): unit descriptions are
# `<phase> — <problem> ||| <the phase's instruction>`, run ids are UUIDs, the deliver unit's card
# names an origin on this machine by its absolute path, and the deliver Tool unit never reaches
# the team bus. GET /runs/:id/team answers these runs after REEL_TEAM_DELAY_S, so the session first
# paints from the units (the window #440's flash lived in).
REEL_PLAN = "5d0c1e2a-9f3b-4c6d-8e7f-0a1b2c3d4e5f"
REEL_DELIVER = "6e1d2f3b-0a4c-4d7e-9f80-1b2c3d4e5f60"
REEL_DONE = "7f2e304c-1b5d-4e8f-a091-2c3d4e5f6071"
REEL_TEAM_DELAY_S = 3.0
REEL_ORIGIN = "/var/repos/origins/checkout-demo.git"
REEL_PHASES = [("pa-scope", "recon", "understand"), ("clarify", "recon", "understand"), ("design", "recon", "design"),
               ("build", "build", "build"), ("adversarial-review", "review", "review"), ("test", "test", "test"),
               ("review", "review", "critique"), ("deliver", "build", "deliver")]
REEL_INSTR = {
    "pa-scope": "Scope this run before anything changes (READ ONLY: edit nothing). End with exactly one line: SCOPE {\"touch\":[]}",
    "clarify": "PHASE SCOPE: this is the clarify phase. Ask what the plan needs answered.",
    "design": "PHASE SCOPE: this is the design phase.",
}


def reel_card(rid: str) -> str:
    return (f"Pushes branch wicked/{rid} to origin ({REEL_ORIGIN}) — a local path, so no pull request can be opened "
            "against it: unless another remote in this checkout is a GitHub repository gh resolves, the pushed "
            "branch IS the delivery.")


def _reel_run(rid: str, status: str, problem: str, n: int, done_upto: int, created_s: int) -> dict:
    r = session(rid, status, problem, problem)
    r["session"].update(created_at=created_s, repo_ref="checkout-demo", run_branch=f"wicked/{rid}",
                        workflow_id=f"wf-{rid}", human_confirm="all" if status == "awaiting_human" else "none",
                        unit_ix=min(done_upto, n - 1))
    units = []
    for i, (ph, stage, _cat) in enumerate(REEL_PHASES[:n]):
        instr = reel_card(rid) + " Push identity: none configured — pushes as whatever login gh holds." \
            if ph == "deliver" else REEL_INSTR.get(ph)
        desc = f"{ph} — {problem}" + (f" ||| {instr}" if instr else "")
        units.append(dict(r["units"][0], id=f"{rid}:{ph}", ord=i + 1, description=desc, stage=stage,
                          phase_ref=f"wf-{rid}:unit-1" if i == 0 else None,
                          status="done" if i < done_upto else "distributed"))
    r["units"] = units
    return r


REEL_RUNS = [
    _reel_run(REEL_PLAN, "awaiting_human", "Add a short \"Rules for booking\" section to PROPOSAL.md: how long one booking can last.",
              7, 1, SESSION_T0 + 3600),
    _reel_run(REEL_DELIVER, "awaiting_human", "Add a SAVE20 discount code to applyDiscount in src/cart.js (20% off).",
              8, 7, SESSION_T0 + 3700),
    _reel_run(REEL_DONE, "completed", "Add a SAVE30 discount code to applyDiscount in src/cart.js (30% off).",
              8, 8, SESSION_T0 + 3800),
]
REEL_RUNS[2]["session"]["ended_at"] = SESSION_T0 + 4400
REEL_RUNS[2]["session"]["delivery"] = "pushed"
REEL_PLAN_PROMPT = ("Approve plan rev 2 before unit 2 runs (manual mode; band 0-19; manual mode): "
                    "pa-scope → clarify → design → build → adversarial-review → test → review")
REEL_GATES = {
    REEL_PLAN: (2, REEL_PLAN_PROMPT),
    REEL_DELIVER: (8, "Approve delivery before unit 8 runs. " + reel_card(REEL_DELIVER)
                   + " Push identity: none configured — pushes as whatever login gh holds."),
}


def reel_team(rid: str) -> dict | None:
    blank = {"runId": rid, "streamFloor": None, "pending": None, "units": [], "rows": []}
    steps = [{"catalog": cat, "id": ph} for ph, _s, cat in REEL_PHASES]
    eid = {REEL_PLAN: 1100, REEL_DELIVER: 1200, REEL_DONE: 1300}.get(rid)
    if eid is None:
        return None

    def done_rows(start: int, ids: list) -> list:
        out = []
        for i, sid in enumerate(ids):
            out.append(_team_row(start + 2 * i, "wicked.team.step.claimed", rid, ord=i + 1, step_id=sid, role="creator",
                                 kind="agent", phase=sid, criterion="", baseline_tree=None, repo=None,
                                 code_graph_db=None, by="claude#1"))
            out.append(_team_row(start + 2 * i + 1, "wicked.team.step.completed", rid, ord=i + 1, step_id=sid,
                                 status="ok", tree=None, output_bytes=10, output_ref=f"u{i + 1}", by="claude#1"))
        return out
    if rid == REEL_PLAN:
        rows = [_team_row(eid, "wicked.team.plan.accepted", rid, plan_rev=1, workflow_id=f"{rid}:plan-1", band="0-19",
                          high_risk=False, mode="manual", steps=steps[:1], override=None, proposal_id="p-r1")]
        rows += done_rows(eid + 1, ["pa-scope"])
        rows.append(_team_row(eid + 5, "wicked.team.plan.proposed", rid, proposal_id="p-r2", base_rev=1, kind="revision",
                              preset=None, steps=steps[:7], monitors={"asked": 1}, asks=[], touch=["PROPOSAL.md"],
                              override=None, rationale="", by="claude#1"))
        return dict(blank, teamed=True, transport="bus", reason=None, planRev=1, ended=False, rows=rows)
    rows = [_team_row(eid, "wicked.team.plan.accepted", rid, plan_rev=2, workflow_id=f"{rid}:plan-2", band="0-19",
                      high_risk=False, mode="manual", steps=steps, override=None, proposal_id="p-r2")]
    # Seven agent steps reach the bus; the deliver Tool unit never does (studio#445).
    rows += done_rows(eid + 1, [ph for ph, _s, _c in REEL_PHASES[:7]])
    return dict(blank, teamed=True, transport="bus", reason=None, planRev=2, ended=rid == REEL_DONE, rows=rows)


SESSION_CHATS = {
    "chat-pay": {"chatId": "chat-pay", "seats": ["claude"], "scope": {"kind": "none", "repos": [], "cwd": "/w/chat-pay",
                                                  "graph": {"bound": False, "reason": "the chat names no project and no repos, so its seats see only their own scratch root and no code graph."},
                                                  "dangling": []},
                 "refused": [], "messages": (
                     [{"at": (SESSION_T0 - 60) * 1000, "turnId": "t1", "kind": "user", "seats": ["claude"],
                       "text": "fix the double charge on checkout, then show me"},
                      {"at": (SESSION_T0 - 30) * 1000, "turnId": "t1", "kind": "seat", "cliKey": "claude", "ok": True,
                       "usage": None, "text": "I will find the cause first, then fix it and show you the change."}]
                     + [{"at": (SESSION_T0 + 900 + i) * 1000, "turnId": f"t{i + 2}", "kind": "seat",
                         "cliKey": "claude", "ok": True, "usage": None,
                         "text": f"Note {i + 1}: the retry handler and the webhook both post the charge."}
                        for i in range(14)])},
    "chat-gone": {"chatId": "chat-gone", "seats": [], "scope": None, "refused": None, "messages": []},
    "chat-ship": {"chatId": "chat-ship", "seats": ["claude"], "scope": {"kind": "none", "repos": [], "cwd": "/w/chat-ship",
                                                  "graph": {"bound": False, "reason": "the chat names no project and no repos, so its seats see only their own scratch root and no code graph."},
                                                  "dangling": []},
                  "refused": [], "messages": [
                      {"at": (SESSION_T0 + 2900) * 1000, "turnId": "s1", "kind": "user", "seats": ["claude"],
                       "text": "where does free shipping start?"},
                      {"at": (SESSION_T0 + 2910) * 1000, "turnId": "s1", "kind": "seat", "cliKey": "claude", "ok": True,
                       "usage": None,
                       "text": "Carts over $50 ship free — see src/checkout.ts:12 and the banner in src/cart/Banner.tsx."},
                      {"at": (SESSION_T0 + 2912) * 1000, "turnId": "s1", "kind": "citations", "cliKey": "claude",
                       "verified": 2, "unverifiable": 1, "corrected": 1, "unchecked": 0, "items": [
                           {"raw": "src/checkout.ts:12", "kind": "line", "status": "verified"},
                           {"raw": "src/cart/Banner.tsx", "kind": "path", "status": "verified"},
                           {"raw": "src/cart/total.ts:3", "kind": "line", "status": "corrected",
                            "resolved": "src/cart/total.ts:7", "note": "the line moved"},
                           {"raw": "src/ghost.ts", "kind": "path", "status": "unverified",
                            "note": "in no repo this chat can read"}]}]},
}


# ── Watch feed corpus (switch `watch_feed`, TR-W8) ─────────────────────────────
def _watch_row(wid: str, run: str, **over) -> dict:
    row = {"run_id": run, "ord": 0, "attempt": 1, "by": "watch:claim-vs-evidence@1", "at": NOW0 - 4 * MIN,
           "re": "repoChecksEvaluated#0:1", "watch_id": wid, "entry_id": "claim-vs-evidence", "entry_version": 1,
           "check": "deterministic:claim_vs_evidence", "kind": "finding", "severity": "medium",
           "watch_kind": "problem", "attach": None, "project_id": "beta",
           "sentence": "The build step handed back as finished; its own checks failed (lint).",
           "facts": {}, "anchor": {"run_id": run, "ord": 0, "attempt": 1, "at": NOW0 - 5 * MIN},
           "evidence": [], "model": None, "rolled_up": 0}
    row.update(over)
    return row


WATCH_FINDINGS = [
    _watch_row("w-gate-b1", "b1", ord=3, entry_id="gate-ask-vs-plan", watch_kind="decision", attach="gate",
               sentence="This asks you to push to origin; the plan delivers to acme/web.", at=NOW0 - 2 * MIN),
    _watch_row("w-claim-b1", "b1"),
    _watch_row("w-old-b1", "b1", sentence="An older finding that a later attempt fixed.", at=NOW0 - 30 * MIN),
]
WATCH_CLEARED_ROWS = [{"run_id": "b1", "ord": 0, "attempt": 2, "by": "watch:claim-vs-evidence@1",
                       "at": NOW0 - 20 * MIN, "re": "x", "watch_id": "w-old-b1", "entry_id": "claim-vs-evidence",
                       "entry_version": 1, "reason": "resolved"}]
WATCH_COVERAGE = [{"entry_id": "scope-drift", "state": "not_checked", "reason": "no declared scope"},
                  {"entry_id": "claim-vs-evidence", "state": "checked"}]


# ── T9 team corpus (switch `team_plan`) ────────────────────────────────────────
# The engine catalog as crew 0.47.0 serves it (GET /catalog) — including `domain_coverage`, an
# entry no studio list names, so a picker showing it proves it reads the catalog.
def _cat(cid: str, kind: str, role: str, executes_code: bool, desc: str, **extra) -> dict:
    return {"id": cid, "kind": kind, "role": role, "gate": "auto", "gate_type": None,
            "executes_code": executes_code, "executor": extra.get("executor", "agent"),
            "validator_pin": extra.get("pin"), "pinned": extra.get("pin") is not None,
            "evidence_floor": extra.get("evidence_floor", False),
            "verified_evidence": extra.get("verified", False), "skill_ref": None,
            "description": desc}


TEAM_CATALOG = [
    _cat("understand", "recon", "neutral", False, "Read the repo and say what the work touches"),
    _cat("test_plan", "test", "evaluator", False, "Write the test plan before the change"),
    _cat("design", "recon", "neutral", False, "Design the change"),
    _cat("build", "build", "creator", True, "Make the change"),
    _cat("test", "test", "evaluator", True, "Run the tests", verified=True),
    _cat("review", "review", "evaluator", False, "Review the change"),
    _cat("domain_coverage", "test", "evaluator", True, "Check domain coverage",
         pin="coverage-validator", evidence_floor=True, verified=True),
    _cat("deliver", "build", "neutral", True, "Push and open the PR", executor="tool"),
]
TEAM_PRESETS = [{"name": "feature", "scope": "global", "created_by": "builtin", "updated_at": 1,
                 "steps": [{"catalog": "understand", "id": "understand"},
                           {"catalog": "build", "id": "build"},
                           {"catalog": "test", "id": "test"}]}]
TEAM_GATE_PROMPT = "Approve unit 3 before it runs: build the rate limiter"
TEAM_GATE_MOVED_PROMPT = "Approve unit 4 before it runs: review the rate limiter"


def team_preview(body: dict) -> dict:
    """POST /plans/preview, deterministically: a creator plan without touch is pending the PA's
    scope (X1); with touch it scores band 40-69 (70-100 when it touches migrations/) and the floor
    adds test_plan/design before and review after; a plan with no creator step needs no graph."""
    plan = body.get("plan") or {}
    steps = [dict(st, id=st.get("id") or st["catalog"], added_by="plan") for st in plan.get("steps", [])]
    touch = plan.get("touch") or []
    manual = (body.get("humanConfirm") or "none") != "none"
    creator = any(st["catalog"] in ("build", "produce") for st in steps)
    base = {"deterministic": 0, "destructive": False, "floor_override": None, "def": {}}
    if creator and not touch:
        return {**base, "score": 0, "band": "0-19", "high_risk": False, "floor": [],
                "reasons": ["pending the PA's scope: the plan declares no touch set"],
                "steps": [{"catalog": "understand", "id": "pa-scope", "owner": "pa",
                           "added_by": "plan"}] + steps,
                "pauses": manual, "pause_reason": "manual_mode" if manual else None,
                "graph": "pending_pa_scope"}
    if not creator:
        return {**base, "score": 0, "band": "0-19", "high_risk": False, "floor": [],
                "reasons": ["no creator step"], "steps": steps,
                "pauses": manual, "pause_reason": "manual_mode" if manual else None,
                "graph": "not_needed"}
    high = any("migrations/" in t for t in touch)
    band = "70-100" if high else "40-69"
    have = {st["catalog"] for st in steps}
    floor = ["test_plan", "design", "build", "review"]
    before = [{"catalog": c, "id": c, "added_by": "floor", "floor_reason": f"band {band} requires {c}"}
              for c in ("test_plan", "design") if c not in have]
    after = [{"catalog": "review", "id": "review", "added_by": "floor",
              "floor_reason": f"band {band} requires review"}] if "review" not in have else []
    pauses = manual or high
    return {**base, "score": 85 if high else 55, "band": band, "high_risk": high, "floor": floor,
            "reasons": [f"touch {', '.join(touch)}"], "steps": before + steps + after,
            "pauses": pauses,
            "pause_reason": "manual_mode" if manual else ("high_risk" if high else None),
            "graph": "ready"}


def _team_run(rid: str, status: str, problem: str, identity: dict, **extra) -> dict:
    r = session(rid, status, problem, problem)
    r["session"]["run_identity"] = identity
    r["session"].update(extra)
    return r


TEAM_RUNS = [
    _team_run("r-team", "executing", "add a rate limiter to the upload endpoint",
              {"kind": "preset", "name": "feature", "user_plan": False, "system": False},
              workflow_id="feature"),
    _team_run("r-team-gate", "awaiting_human", "gate the rate limiter build",
              {"kind": "preset", "name": "feature", "user_plan": False, "system": False},
              workflow_id="feature", human_confirm="before:3", unit_ix=2),
    # A completed user plan on its per-run def: no catalog serves `r-team-plan:plan-2`, so only
    # run_identity can say it is ordinary build work (the "no deliver phase" claim is licensed).
    _team_run("r-team-plan", "completed", "tidy the upload handler",
              {"kind": "user_plan", "name": None, "user_plan": True, "system": False},
              workflow_id="r-team-plan:plan-2", workdir="/w9/team-plan"),
    # A machine-owned run on a materialised def with a known workdir: before run_identity, studio
    # showed it a Delivery section (arm 3); `system: true` keeps it off delivery surfaces.
    _team_run("r-team-sys", "completed", "draft the upload notes",
              {"kind": "workflow", "name": "interactive-draft", "user_plan": False, "system": True},
              workflow_id="wf-r-team-sys", workdir="/w9/team-sys"),
]
TEAM_MEMBER_REFS = [r["session"]["id"] for r in TEAM_RUNS]

# ── Dogfood D10/D11 plan gate (switch `plan_gate`) ─────────────────────────────
# The rig's run 1a22f803 at its plan gate, trimmed: the PA scoped the plan, the stale code graph
# failed the score closed at 100, and the floor added three phases for band 70-100.
PLAN_GATE_RUN = _team_run(
    "r-plan-gate", "awaiting_human", "produce the studio redesign spec and prototype",
    {"kind": "user_plan", "name": None, "user_plan": True, "system": False},
    workflow_id="r-plan-gate:plan-1", unit_ix=1, human_confirm="all")
PLAN_GATE_PROMPT = ("Approve plan rev 2 before unit 2 runs (manual mode; band 70-100; manual mode): "
                    "understand → test_plan → design → architecture → produce → critique → review → "
                    "security_review → deliver. Approve, approve with an edited plan, or reject.")
_SHA_A = "3071a7632882ade840e3c73772eaf44288c6b4c3"
_SHA_B = "e9d64e746433a8db220597d6030772163ce984b9"
PLAN_GATE_TEAM = {
    "runId": "r-plan-gate", "transport": "bus", "reason": None, "planRev": 2, "pending": None,
    "ended": False,
    "rows": [
        {"event_id": 617, "event_type": "wicked.team.plan.proposed", "payload": {
            "kind": "initial", "by": "claude", "steps": [
                {"catalog": "understand", "id": "pa-scope"}, {"catalog": "understand", "id": "understand"},
                {"catalog": "design", "id": "design"}, {"catalog": "build", "id": "build"},
                {"catalog": "review", "id": "review"}, {"catalog": "deliver", "id": "deliver"}]}},
        {"event_id": 618, "event_type": "wicked.team.path.scored", "payload": {
            "score": 100, "deterministic": 100, "basis": "intent",
            "reasons": [f"fail closed at 100: graph indexed at {_SHA_A} is not the run base {_SHA_B}"]}},
    ],
    "units": [
        {"ord": 1, "rows": [
            {"event_id": 600, "event_type": "wicked.team.gate.opened",
             "payload": {"kind": "unit_review", "gate_id": "g-pg-1", "ord": 1}},
            {"event_id": 601, "event_type": "wicked.team.gate.decided",
             "payload": {"kind": "unit_review", "gate_id": "g-pg-1", "ord": 1, "decision": "allow"}}]},
        {"ord": 2, "rows": [
            {"event_id": 619, "event_type": "wicked.team.gate.opened", "payload": {
                "kind": "plan_approval", "gate_id": "g-pg-3", "ord": 2, "plan_rev": 2, "band": "70-100",
                "high_risk": True, "mode": "manual", "reason": "manual_mode", "reviewing_ord": 1,
                "diff": {"from_rev": 1, "added": ["test_plan", "architecture", "security_review"]}}}]},
    ],
}


# ── floor_plan (studio#470, e2e/desk_run_state_test.py) ──────────────────────
FLOOR_RUN = _team_run("r-floor", "awaiting_human", "Add SSO login to the admin console",
                      {"kind": "preset", "name": "feature", "user_plan": False, "system": False},
                      workflow_id="feature", unit_ix=1, human_confirm="all")
FLOOR_PROMPT = ("Approve plan rev 2 before unit 1 runs (high risk: auto mode still requires approval; band 60-79, "
                "high risk; auto mode): pa-scope → clarify → test_plan (floor) → design → architecture (floor) → "
                "build → adversarial-review → test → review → security_review (floor) → deliver. "
                "Floor added: test_plan, architecture, security_review")
_FLOOR_PA = ["pa-scope", "clarify", "design", "build", "adversarial-review", "test", "review", "deliver"]
_FLOOR_CAT = {"pa-scope": "understand", "adversarial-review": "review"}
FLOOR_TEAM = {
    "runId": "r-floor", "transport": "bus", "reason": None, "planRev": 2, "pending": None, "ended": False,
    "rows": [{"event_id": 701, "event_type": "wicked.team.plan.proposed", "payload": {
        "kind": "initial", "by": "claude",
        "steps": [{"catalog": _FLOOR_CAT.get(i, i), "id": i} for i in _FLOOR_PA]}}],
    "units": [],
}


# ── Brainstorm-actionable ideas 1+2: the gate's recommended move (switch `gate_move`) ──
# An evaluator unit whose own output ends `VERDICT: FAIL` — the frames wicked-core b190f63 emits
# (wicked-crew tests/fixtures/engine-frames-0.38.0.json gateEscalatedEvaluatorVerdict /
# gateEvaluatedEvaluatorVerdict), renamed onto r-review's critique (ord 2) after its produce (ord 1).
GATE_MOVE_REASON = ("the evaluator's verdict is FAIL\nReviewed the fix.\n"
                    "- the regression test is missing\n- src/app.ts still reads `buggy`\nVERDICT: FAIL")
GATE_MOVE_PROMPT = ("Unit 2 verdict is NOT PASS — the evaluator's verdict is FAIL. confirm to retry the "
                    "phase, request changes to send the review back to the creator phase, or reject to "
                    "cancel the run.")
GATE_MOVE_CREATOR_OUTPUT = ("Implemented the fix.\n- added a regression test for the buggy path\n"
                            "- src/app.ts now reads `fixed` instead of `buggy`\n- updated the changelog")
GATE_MOVE_T0 = NOW0 - 30 * MIN


def _gate_move_unit(key: str, ord_: int, stage: str, role: str, status: str, cli) -> dict:
    return {"id": f"r-review:{key}", "session_id": "r-review", "ord": ord_,
            "description": f"{key} — fix the buggy reader", "stage": stage, "role": role,
            "assigned_cli": cli, "assigned_invocation": None, "council_task_ref": None, "routing": None,
            "denial_reason": GATE_MOVE_REASON if key == "critique" else None, "phase_ref": None,
            "conformance_ref": None, "phase_status": None, "collection_scope": None, "status": status}


GATE_MOVE_RUN = session("r-review", "awaiting_human", "fix the buggy reader", "fix the buggy reader")
GATE_MOVE_RUN["units"] = [
    _gate_move_unit("produce", 1, "build", "creator", "done", "claude"),
    _gate_move_unit("critique", 2, "review", "evaluator", "rejected", "codex"),
    _gate_move_unit("deliver", 3, "build", "neutral", "pending", None),
]
GATE_MOVE_RUN["session"]["unit_ix"] = 1
GATE_MOVE_RUN["session"]["clis"] = ["claude", "codex"]
GATE_MOVE_EVENTS = [
    {"type": "sessionStarted", "session": "r-review", "problem": "fix the buggy reader",
     "workflowId": "wf-w2", "cliCount": 2, "governed": True, "entityMode": "shared",
     "ts": GATE_MOVE_T0, "seq": 1},
    {"type": "unitDispatched", "session": "r-review", "ord": 1, "attempt": 0, "ts": GATE_MOVE_T0 + SEC, "seq": 2},
    {"type": "gateEvaluated", "session": "r-review", "ord": 1, "ts": GATE_MOVE_T0 + 5 * MIN, "seq": 3,
     "criterion": None, "hasDeterministicFloor": False, "deterministicPass": True, "agentVerdict": None,
     "agentReasoning": None, "evaluatorPass": True, "evaluatorPolicies": [], "denialReason": None,
     "denial": None, "combined": True, "judgeCli": None, "judgeDistinct": None},
    {"type": "unitDone", "session": "r-review", "ord": 1, "ts": GATE_MOVE_T0 + 5 * MIN, "seq": 4},
    {"type": "unitDispatched", "session": "r-review", "ord": 2, "attempt": 0, "ts": GATE_MOVE_T0 + 6 * MIN, "seq": 5},
    {"type": "gateEvaluated", "session": "r-review", "ord": 2, "ts": GATE_MOVE_T0 + 9 * MIN, "seq": 6,
     "agentReasoning": None, "agentVerdict": None, "combined": False, "criterion": None,
     "denial": {"claimId": None, "deniedTool": None, "phase": "unit-2", "reason": GATE_MOVE_REASON,
                "ruleIds": [], "source": "evaluator_verdict"},
     "denialReason": GATE_MOVE_REASON, "deterministicPass": True, "evaluatorPass": True,
     "evaluatorPolicies": [], "evaluatorVerdict": "FAIL", "hasDeterministicFloor": False,
     "judgeCli": None, "judgeDistinct": None, "judgeSkippedReason": None},
    {"type": "gateEscalated", "session": "r-review", "ord": 2, "ts": GATE_MOVE_T0 + 9 * MIN, "seq": 7,
     "attempt": 0, "condition": "verdict_not_pass", "defGate": False, "denialSource": "evaluator_verdict",
     "discarded": [], "outputCaptured": True, "restored": False, "suggestionRef": None,
     "verdictSummary": GATE_MOVE_REASON},
    {"type": "awaitingHuman", "session": "r-review", "ord": 2, "ts": GATE_MOVE_T0 + 9 * MIN + SEC, "seq": 8,
     "prompt": GATE_MOVE_PROMPT, "reviewingOrd": 2},
]
GATE_MOVE_TAIL = "…" + GATE_MOVE_REASON[GATE_MOVE_REASON.index("- src/app.ts"):]


def _tail_cut(e: dict) -> dict:
    """studio#430: the engine keeps the 4 KB tail of a long verdict, head-cut with "…"."""
    if e.get("type") == "gateEvaluated" and isinstance(e.get("denial"), dict):
        e["denial"]["reason"] = GATE_MOVE_TAIL
        e["denialReason"] = GATE_MOVE_TAIL
    if e.get("type") == "gateEscalated":
        e["verdictSummary"] = GATE_MOVE_TAIL
    return e


GATE_MOVE_OUTPUTS = {
    "produce": {"output": GATE_MOVE_CREATOR_OUTPUT},
    "critique": {"output": GATE_MOVE_REASON},
}


# ── Batch W2-S3: the gate card's escalation arms, source and artifact (switch `escalation_arms`) ──
# Frames as wicked-core 83d8f36 (#652) emits them: a floor whose test check hit its bound
# (`denial.source: repo_checks_timeout`), a verify evaluator's edit restored and pinned under
# refs/wicked/suggestions, and a run-level pre-run gate (`gateKind: run_level`, `reviewingOrd`).
ESC_T0 = NOW0 - 25 * MIN


def _esc_unit(rid: str, key: str, ord_: int, stage: str, role: str, status: str, cli) -> dict:
    return {"id": f"{rid}:{key}", "session_id": rid, "ord": ord_,
            "description": f"{key} — fix the flaky importer", "stage": stage, "role": role,
            "assigned_cli": cli, "assigned_invocation": None, "council_task_ref": None, "routing": None,
            "denial_reason": None, "phase_ref": None, "conformance_ref": None, "phase_status": None,
            "collection_scope": None, "status": status}


def _esc_run(rid: str, unit_ix: int, units: list) -> dict:
    run = session(rid, "awaiting_human", "fix the flaky importer", "fix the flaky importer")
    run["units"] = units
    run["session"]["unit_ix"] = unit_ix
    run["session"]["clis"] = ["claude", "codex"]
    return run


ESC_TIMEOUT_PROMPT = ("Unit 1 failed its deterministic floor (repo_checks_timeout): Repository checks did not "
                      "finish: test timed out after 600.0s — confirm to retry the phase, or reject to cancel the run")
ESC_SUGGEST_PROMPT = ("Unit 2 verdict is NOT PASS — the read-only `verify` phase changed the tree under review "
                      "(M src/importer.ts); its edit was discarded and the creator's verified tree restored. "
                      "Approve to retry the phase against the restored tree, or reject to cancel the run")
ESC_PRERUN_PROMPT = ("Approve unit 2 before it runs: triage — Fix the flaky importer: the nightly import drops "
                     "the last row when the file ends without a newline. PHASE SCOPE: triage only.")
ESC_RUNS = [
    _esc_run("r-timeout", 0, [_esc_unit("r-timeout", "fix", 1, "build", "creator", "rejected", "claude"),
                              _esc_unit("r-timeout", "verify", 2, "review", "evaluator", "pending", "codex")]),
    _esc_run("r-suggest", 1, [_esc_unit("r-suggest", "fix", 1, "build", "creator", "done", "claude"),
                              _esc_unit("r-suggest", "verify", 2, "review", "evaluator", "rejected", "codex")]),
    _esc_run("r-prerun", 1, [_esc_unit("r-prerun", "recon", 1, "recon", "neutral", "done", "claude"),
                             _esc_unit("r-prerun", "triage", 2, "recon", "neutral", "pending", "codex"),
                             _esc_unit("r-prerun", "fix", 3, "build", "creator", "pending", "claude")]),
]
ESC_GATES = {"r-timeout": (1, ESC_TIMEOUT_PROMPT), "r-suggest": (2, ESC_SUGGEST_PROMPT), "r-prerun": (2, ESC_PRERUN_PROMPT)}
ESC_EVENTS = {
    "r-timeout": [
        {"type": "unitDispatched", "session": "r-timeout", "ord": 1, "attempt": 0, "ts": ESC_T0, "seq": 1},
        {"type": "repoChecksEvaluated", "session": "r-timeout", "ord": 1, "attempt": 0, "ts": ESC_T0 + 12 * MIN,
         "seq": 2, "passed": False, "criterion": "repository checks pass on the head", "skipped": [],
         "checks": [
             {"name": "lint", "argv": ["npm", "run", "lint"], "source": "declared", "exitCode": 0,
              "timedOut": False, "spawnError": None, "durationMs": 21400},
             {"name": "test", "argv": ["npm", "test"], "source": "declared", "exitCode": None,
              "timedOut": True, "spawnError": None, "durationMs": 600000}]},
        {"type": "gateEvaluated", "session": "r-timeout", "ord": 1, "ts": ESC_T0 + 12 * MIN, "seq": 3,
         "criterion": "repository checks pass on the head", "hasDeterministicFloor": True, "deterministicPass": False,
         "agentVerdict": None, "agentReasoning": None, "evaluatorPass": None, "evaluatorPolicies": [],
         "denialReason": "Repository checks did not finish: test timed out after 600.0s",
         "denial": {"source": "repo_checks_timeout", "reason": "Repository checks did not finish: test timed out after 600.0s",
                    "claimId": None, "ruleIds": [], "deniedTool": None, "phase": "fix"},
         "combined": False, "judgeCli": None, "judgeDistinct": None},
        {"type": "gateEscalated", "session": "r-timeout", "ord": 1, "ts": ESC_T0 + 12 * MIN, "seq": 4, "attempt": 0,
         "condition": "floor_failed", "defGate": False, "denialSource": "repo_checks_timeout", "discarded": [],
         "outputCaptured": True, "restored": False, "suggestionRef": None, "verdictSummary": None},
        {"type": "awaitingHuman", "session": "r-timeout", "ord": 1, "ts": ESC_T0 + 12 * MIN + SEC, "seq": 5,
         "prompt": ESC_TIMEOUT_PROMPT, "reviewingOrd": 1, "gateKind": "escalation"},
    ],
    "r-suggest": [
        {"type": "unitDispatched", "session": "r-suggest", "ord": 1, "attempt": 0, "ts": ESC_T0, "seq": 1},
        {"type": "unitDone", "session": "r-suggest", "ord": 1, "ts": ESC_T0 + 6 * MIN, "seq": 2},
        {"type": "unitDispatched", "session": "r-suggest", "ord": 2, "attempt": 0, "ts": ESC_T0 + 7 * MIN, "seq": 3},
        {"type": "evaluatorMutatedWorktree", "session": "r-suggest", "ord": 2, "ts": ESC_T0 + 10 * MIN, "seq": 4,
         "cli": "codex", "phase": "verify", "beforeTree": "4b1c9e0a7d2f5e8c1a3b", "afterTree": "9f8e7d6c5b4a39281706",
         "headMoved": False, "changed": [{"status": "M", "path": "src/importer.ts"}], "restored": True, "restoreError": None},
        {"type": "worktreeRestored", "session": "r-suggest", "ord": 2, "ts": ESC_T0 + 10 * MIN, "seq": 5,
         "tree": "4b1c9e0a7d2f5e8c1a3b", "head": None, "discarded": [{"status": "M", "path": "src/importer.ts"}],
         "suggestionRef": "refs/wicked/suggestions/r-suggest/2/0"},
        {"type": "gateEvaluated", "session": "r-suggest", "ord": 2, "ts": ESC_T0 + 10 * MIN, "seq": 6,
         "criterion": None, "hasDeterministicFloor": False, "deterministicPass": True, "agentVerdict": None,
         "agentReasoning": None, "evaluatorPass": True, "evaluatorPolicies": [],
         "denialReason": "the read-only verify phase changed the tree under review",
         "denial": {"source": "worktree_guard", "reason": "the read-only verify phase changed the tree under review",
                    "claimId": None, "ruleIds": [], "deniedTool": None, "phase": "verify"},
         "combined": False, "judgeCli": None, "judgeDistinct": None},
        {"type": "awaitingHuman", "session": "r-suggest", "ord": 2, "ts": ESC_T0 + 10 * MIN + SEC, "seq": 7,
         "prompt": ESC_SUGGEST_PROMPT, "reviewingOrd": 2, "gateKind": "escalation"},
    ],
    "r-prerun": [
        {"type": "unitDispatched", "session": "r-prerun", "ord": 1, "attempt": 0, "ts": ESC_T0, "seq": 1},
        {"type": "unitExecuting", "session": "r-prerun", "ord": 1, "ts": ESC_T0 + SEC, "seq": 2},
        {"type": "unitDone", "session": "r-prerun", "ord": 1, "ts": ESC_T0 + 4 * MIN, "seq": 3},
        {"type": "awaitingHuman", "session": "r-prerun", "ord": 2, "ts": ESC_T0 + 4 * MIN + SEC, "seq": 4,
         "prompt": ESC_PRERUN_PROMPT, "reviewingOrd": 1, "gateKind": "run_level"},
    ],
}
# studio#573: a DENIED unit — input governance refused the `test` phase's tool call (wicked-core's
# `boundary_deny` pause). Floor PASS, judge PASS; the engine's arms are approve (RE-RUNS the phase) or
# reject. Served under the same `escalation_arms` switch (e2e/desk_gate_kinds_test.py step 14).
ESC_DENIED_PROMPT = ("Unit 2 was DENIED by input governance — a tool call was refused (`Bash`): the `test` phase wrote "
                     "outside its write roots (claim witness-deny:unit-2). The phase's output was captured. Approve "
                     "RE-RUNS the `test` phase from the start under the same policies (a retry; the captured output is "
                     "not accepted), or reject to cancel the run")
ESC_RUNS.append(_esc_run("r-denied", 1, [_esc_unit("r-denied", "fix", 1, "build", "creator", "done", "claude"),
                                         _esc_unit("r-denied", "test", 2, "review", "evaluator", "rejected", "codex"),
                                         _esc_unit("r-denied", "deliver", 3, "build", "neutral", "pending", None)]))
ESC_GATES["r-denied"] = (2, ESC_DENIED_PROMPT)
ESC_EVENTS["r-denied"] = [
    {"type": "unitDispatched", "session": "r-denied", "ord": 1, "attempt": 0, "ts": ESC_T0, "seq": 1},
    {"type": "unitDone", "session": "r-denied", "ord": 1, "ts": ESC_T0 + 6 * MIN, "seq": 2},
    {"type": "unitDispatched", "session": "r-denied", "ord": 2, "attempt": 0, "ts": ESC_T0 + 7 * MIN, "seq": 3},
    {"type": "gateEvaluated", "session": "r-denied", "ord": 2, "ts": ESC_T0 + 11 * MIN, "seq": 4,
     "criterion": "tests pass on the head", "hasDeterministicFloor": True, "deterministicPass": True,
     "agentVerdict": "PASS", "agentReasoning": "The tests cover the fix.", "evaluatorPass": True, "evaluatorPolicies": [],
     "denialReason": "input governance denied a tool-call in unit-2 (claim witness-deny:unit-2)",
     "denial": {"source": "input_governance", "reason": "input governance denied a tool-call in unit-2 (claim witness-deny:unit-2)",
                "claimId": "witness-deny:unit-2", "ruleIds": [], "deniedTool": "Bash", "phase": "test"},
     "combined": False, "judgeCli": "pi", "judgeDistinct": True},
    {"type": "gateEscalated", "session": "r-denied", "ord": 2, "ts": ESC_T0 + 11 * MIN, "seq": 5, "attempt": 0,
     "condition": "boundary_deny", "defGate": False, "denialSource": "input_governance", "discarded": [],
     "outputCaptured": True, "restored": False, "suggestionRef": None, "verdictSummary": None},
    {"type": "awaitingHuman", "session": "r-denied", "ord": 2, "ts": ESC_T0 + 11 * MIN + SEC, "seq": 6,
     "prompt": ESC_DENIED_PROMPT, "reviewingOrd": 2, "gateKind": "escalation"},
]

ESC_OUTPUTS = {("r-prerun", "recon"): {"output": "Recon: the importer reads with split('\\n') and drops a trailing "
                                                 "row with no newline (src/importer.ts:41). Two call sites."}}


# ── Brainstorm-actionable ideas 7+8: trust at the gate (switch `trust_rules`) ──
# Three northwind runs (accepted plan band 0-19) paused at gates, and the decided-gate history on
# crew's GET /gates/decided wire (wicked-crew#691): claude's build 8/10 approved (2 sent back),
# codex's build 1/5 (3 sent back, 1 rejected), the last three alike review gates approved.
TRUST_PROJECT = project("northwind", "Northwind", NOW0 - 5 * MIN)
TRUST_T0 = NOW0 - 20 * MIN


def _trust_run(rid: str, seat: str, gate_ord: int) -> dict:
    run = session(rid, "awaiting_human", f"tidy the {seat} importer", f"tidy the {seat} importer")
    run["session"]["project_id"] = "northwind"
    run["session"]["clis"] = ["claude", "codex"]
    run["session"]["unit_ix"] = gate_ord - 1
    run["session"]["team_plan"] = {"rev": 1, "accepted_rev": 1,
                                   "accepted": {"rev": 1, "by": "engine", "band": "0-19", "high_risk": False}}

    def unit(key: str, ord_: int, stage: str, role: str, status: str, cli) -> dict:
        return {"id": f"{rid}:{key}", "session_id": rid, "ord": ord_, "description": f"{key} — tidy the importer",
                "stage": stage, "role": role, "assigned_cli": cli, "assigned_invocation": None,
                "council_task_ref": None, "routing": None, "denial_reason": None, "phase_ref": key,
                "conformance_ref": None, "phase_status": None, "collection_scope": None, "status": status}
    run["units"] = [
        unit("build", 1, "build", "creator", "done", seat),
        unit("review", 2, "review", "evaluator", "done" if gate_ord > 2 else "pending", "codex" if seat == "claude" else "claude"),
        unit("deliver", 3, "build", "neutral", "pending", None),
    ]
    return run


TRUST_GATES = {"r-trust": (2, "def", "Approve unit 2 before it runs: review"),
               "r-trust-codex": (2, "def", "Approve unit 2 before it runs: review"),
               "r-trust-deliver": (3, "deliver", "Approve unit 3 before it runs: deliver — push the run branch")}
TRUST_RUNS = [_trust_run("r-trust", "claude", 2), _trust_run("r-trust-codex", "codex", 2),
              _trust_run("r-trust-deliver", "claude", 3)]

# What r-trust-deliver's deliver gate would push: the run branch against its merge base (crew#305's
# GET /runs/:id/diff?base=merge-base, `source: "branch"`), so the gate card has a diff to read (#300).
TRUST_DELIVER_DIFF = """diff --git a/src/importer/dates.ts b/src/importer/dates.ts
index 3b1c2a0..9f4e7d1 100644
--- a/src/importer/dates.ts
+++ b/src/importer/dates.ts
@@ -1,4 +1,7 @@
 export function parseDate(raw: string): Date {
-  return new Date(raw);
+  const m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(raw.trim());
+  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
+  const d = new Date(raw);
+  if (Number.isNaN(d.getTime())) throw new Error(`unparseable date: ${raw}`);
+  return d;
 }
-
diff --git a/test/importer/dates.test.ts b/test/importer/dates.test.ts
new file mode 100644
--- /dev/null
+++ b/test/importer/dates.test.ts
@@ -0,0 +1,9 @@
+import { parseDate } from '../../src/importer/dates';
+
+test('reads Northwind day-first dates', () => {
+  expect(parseDate('03/04/2026').toISOString()).toBe('2026-04-03T00:00:00.000Z');
+});
+
+test('refuses a date it cannot read', () => {
+  expect(() => parseDate('soon')).toThrow('unparseable date: soon');
+});
"""


def _trust_events(rid: str) -> list:
    ord_, kind, prompt = TRUST_GATES[rid]
    evs = [
        {"type": "sessionStarted", "session": rid, "problem": "tidy the importer", "workflowId": "wf-w2",
         "cliCount": 2, "governed": True, "entityMode": "shared", "ts": TRUST_T0, "seq": 1},
        {"type": "unitDispatched", "session": rid, "ord": 1, "attempt": 0, "ts": TRUST_T0 + SEC, "seq": 2},
        {"type": "unitDone", "session": rid, "ord": 1, "ts": TRUST_T0 + 5 * MIN, "seq": 3},
    ]
    if kind == "deliver":
        evs.append({"type": "repoChecksEvaluated", "session": rid, "ord": ord_, "attempt": 0,
                    "ts": TRUST_T0 + 5 * MIN, "seq": 4, "passed": True,
                    "criterion": "repository checks pass on the head", "skipped": [],
                    "checks": [
                        {"name": "typecheck", "argv": ["npm", "run", "typecheck"], "source": "declared",
                         "exitCode": 0, "timedOut": False, "spawnError": None, "durationMs": 8200},
                        {"name": "lint", "argv": ["npm", "run", "lint"], "source": "declared",
                         "exitCode": 0, "timedOut": False, "spawnError": None, "durationMs": 4100},
                    ]})
        evs.append({"type": "gateEvaluated", "session": rid, "ord": ord_, "ts": TRUST_T0 + 5 * MIN, "seq": 5,
                    "criterion": "repository checks pass on the head", "hasDeterministicFloor": True,
                    "deterministicPass": True, "agentVerdict": None, "agentReasoning": None,
                    "evaluatorPass": None, "evaluatorPolicies": [], "denialReason": None, "denial": None,
                    "combined": True, "judgeCli": None, "judgeDistinct": None})
        evs.append({"type": "awaitingHuman", "session": rid, "ord": ord_, "ts": TRUST_T0 + 5 * MIN + SEC,
                    "seq": 6, "prompt": prompt, "reviewingOrd": ord_ - 1, "gateKind": kind})
    else:
        evs.append({"type": "awaitingHuman", "session": rid, "ord": ord_, "ts": TRUST_T0 + 5 * MIN + SEC,
                    "seq": 4, "prompt": prompt, "reviewingOrd": ord_ - 1, "gateKind": kind})
    return evs


def _decided(i: int, days: float, seat: str = "claude", decision: str = "approve", **over) -> dict:
    row = {"runId": f"r-hist-{i}", "ord": 2, "decidedAt": int(NOW0 - days * DAY), "decision": decision,
           "actor": "local", "byOrder": False, "gateKind": "def", "phase": "build", "projectId": "northwind",
           "band": "0-19", "creator": {"seat": seat, "phase": "build", "ord": 1}, "orderApprovable": True}
    row.update(over)
    return row


# ── Brainstorm-actionable idea 11: a finished run's next use (switch `home_runs`) ──
def _reuse_unit(key: str, ord_: int, catalog: str) -> dict:
    return {"id": f"r-reuse:{key}", "session_id": "r-reuse", "ord": ord_, "description": f"{key} — tidy the upload handler",
            "stage": "build", "assigned_cli": "claude", "assigned_invocation": None, "council_task_ref": None,
            "routing": None, "denial_reason": None, "phase_ref": key, "conformance_ref": None, "phase_status": None,
            "collection_scope": None, "status": "done", "catalog": catalog}


REUSE_RUN = _team_run("r-reuse", "completed", "tidy the upload handler",
                      {"kind": "user_plan", "name": None, "user_plan": True, "system": False},
                      workflow_id="r-reuse:plan-2", ended_at=int((NOW0 - 30 * MIN) / 1000))
REUSE_RUN["units"] = [_reuse_unit("pa-scope", 0, "understand"), _reuse_unit("understand", 1, "understand"),
                      _reuse_unit("build", 2, "build"), _reuse_unit("review", 3, "review"),
                      _reuse_unit("deliver", 4, "deliver")]


TRUST_HISTORY = sorted([
    _decided(1, 1), _decided(2, 2), _decided(3, 3), _decided(4, 4, decision="request_changes"),
    _decided(5, 5), _decided(6, 6), _decided(7, 8, decision="request_changes"),
    _decided(8, 16), _decided(9, 17), _decided(10, 18),
    _decided(11, 20, "codex"), _decided(12, 21, "codex", "request_changes"),
    _decided(13, 22, "codex", "request_changes"), _decided(14, 23, "codex", "request_changes"),
    _decided(15, 24, "codex", "reject"),
    # Never alike: an approved deliver gate and a plan approval; and an order's own approval.
    _decided(16, 1.5, gateKind="deliver", phase="deliver", orderApprovable=False),
    _decided(17, 2.5, gateKind="plan_approval", phase="intake", orderApprovable=False, creator=None),
    _decided(18, 9, byOrder=True, actor="standing-order:old"),
], key=lambda r: -r["decidedAt"])


# ── Brainstorm-actionable ideas 6+13: the run page (switch `run_page`) ────────────────────────
# r-rerun: understand (2 min) → build (6 min, its second attempt) → review (3 min, NOT PASS) → deliver
# (never ran), paused at the escalation on review. A request_changes there rewinds to build (the
# newest creator before the gate): keeps understand, redoes build → review → deliver, ~9 min.
RUN_PAGE_T0 = NOW0 - 40 * MIN
RUN_PAGE_PROMPT = ("Unit 3 verdict is NOT PASS — confirm to retry the phase, request changes to send the "
                   "review back to the creator phase, or reject to cancel the run")


def _run_page_run(rid: str, status: str, band: str) -> dict:
    run = session(rid, status, "fix the northwind importer's date parsing", "fix the date parsing")
    run["session"]["project_id"] = "northwind"
    run["session"]["workflow_id"] = "bugfix"
    run["session"]["clis"] = ["claude", "codex"]
    run["session"]["unit_ix"] = 2
    run["session"]["team_plan"] = {"rev": 1, "accepted_rev": 1, "preset": "bugfix",
                                   "accepted": {"rev": 1, "by": "engine", "band": band, "high_risk": False}}
    done = status == "completed"

    def unit(key: str, ord_: int, stage: str, role: str, st: str, cli) -> dict:
        return {"id": f"{rid}:{key}", "session_id": rid, "ord": ord_, "description": f"{key} — fix the date parsing",
                "stage": stage, "role": role, "assigned_cli": cli, "assigned_invocation": None,
                "council_task_ref": None, "routing": None, "denial_reason": None, "phase_ref": key,
                "conformance_ref": None, "phase_status": None, "collection_scope": None, "status": st}
    run["units"] = [
        unit("understand", 1, "recon", "neutral", "done", "claude"),
        unit("build", 2, "build", "creator", "done", "claude"),
        unit("review", 3, "review", "evaluator", "done" if done else "rejected", "codex"),
        unit("deliver", 4, "build", "neutral", "done" if done else "pending", None),
    ]
    return run


RUN_PAGE_RUNS = [_run_page_run("r-rerun", "awaiting_human", "0-19"),
                 _run_page_run("r-rerun-done", "completed", "0-19"),
                 _run_page_run("r-rerun-mid", "executing", "40-69")]


def _run_page_events(rid: str) -> list:
    t = RUN_PAGE_T0
    seq = iter(range(1, 100))

    def e(kind: str, ord_: int, at: int, **extra) -> dict:
        return {"type": kind, "session": rid, "ord": ord_, "ts": t + at, "seq": next(seq), **extra}
    events = [
        {"type": "sessionStarted", "session": rid, "problem": "fix the date parsing", "workflowId": "bugfix",
         "cliCount": 2, "governed": True, "entityMode": "shared", "ts": t, "seq": 0},
        e("unitDispatched", 1, SEC, attempt=0), e("unitOutputCaptured", 1, 2 * MIN + SEC, stepStatus="done"),
        e("unitDone", 1, 2 * MIN + 2 * SEC),
        e("unitDispatched", 2, 3 * MIN, attempt=0), e("unitOutputCaptured", 2, 20 * MIN, stepStatus="done"),
        e("unitDispatched", 2, 21 * MIN, attempt=1), e("unitOutputCaptured", 2, 27 * MIN, stepStatus="done"),
        e("unitDone", 2, 27 * MIN + SEC),
        e("unitDispatched", 3, 28 * MIN, attempt=0), e("unitOutputCaptured", 3, 31 * MIN, stepStatus="done"),
        e("unitDenied", 3, 31 * MIN + SEC),
    ]
    if rid == "r-rerun":
        events.append(e("awaitingHuman", 3, 31 * MIN + 2 * SEC, prompt=RUN_PAGE_PROMPT, gateKind="escalation"))
    return events


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

# ── Studio wave 1: the healthy-portfolio corpus, behind `wave1` ────────────────
WAVE1_PROJECTS = [
    project("alpha", "alpha", NOW0 - 2 * MIN),
    project("beta", "beta", NOW0 - 3 * MIN),
    project("gamma", "gamma", NOW0 - 4 * MIN),
]
WAVE1_RUNS = [
    session("a1", "executing", "add request tracing to the alpha API", "add request tracing"),
    session("b1", "executing", "migrate beta's settings page to the new form kit",
            "migrate the settings page"),
    session("r1", "executing", "tighten gamma's upload size limits", "tighten the upload limits"),
    session("c1", "completed", "document gamma's retry policy", "document the retry policy"),
]
WAVE1_RUNS[3]["units"][0]["status"] = "done"
WAVE1_MEMBERS = {"alpha": ["a1"], "beta": ["b1"], "gamma": ["r1", "c1"]}
WAVE1_ATTACHED_AT = {"a1": NOW0 - 2 * MIN, "b1": NOW0 - 3 * MIN,
                     "r1": NOW0 - 4 * MIN, "c1": NOW0 - 50 * MIN}
# S15c (/p/:id → the project's NEWEST session): the DTO carries `created_at` (unix seconds), as the
# daemon's does, so the newest is decided by its clock — a1 (2 min) over g1 (3 min) and d1 (5 h).
for _r in WAVE1_RUNS:
    _r["session"]["created_at"] = WAVE1_ATTACHED_AT[_r["session"]["id"]] // 1000
# r1's durable tail — real event_to_json shapes with RecordedEvent's ts + seq.
WAVE1_R1_EVENTS = [
    {"type": "sessionStarted", "sessionId": "r1", "ts": NOW0 - 4 * MIN, "seq": 1},
    {"type": "unitPlanned", "sessionId": "r1", "ord": 0,
     "description": "tighten the upload limits", "stage": "build",
     "ts": NOW0 - 4 * MIN + 2 * SEC, "seq": 2},
    {"type": "unitExecuting", "sessionId": "r1", "ord": 0, "cli": "claude",
     "ts": NOW0 - 4 * MIN + 5 * SEC, "seq": 3},
]
# ── Studio wave 2b: added to the wave1 corpus, behind `wave2b` ─────────────────
WAVE2B_RUNS = [
    session("g1", "executing", "approve alpha's schema change", "apply the schema change"),
    session("g2", "executing", "bump beta's cache TTL", "bump the cache TTL"),
    session("e1", "executing", "backfill gamma's audit table", "backfill the audit table"),
    session("f1", "failed", "rotate beta's API keys", "rotate the API keys"),
    session("d1", "completed", "ship alpha's changelog", "ship the changelog"),
]
WAVE2B_RUNS[3]["session"]["ended_at"] = (NOW0 - HOUR) // 1000
WAVE2B_RUNS[4]["session"]["ended_at"] = (NOW0 - 2 * HOUR) // 1000
WAVE2B_RUNS[4]["units"][0]["status"] = "done"
WAVE2B_MEMBERS = {"alpha": ["g1", "d1"], "beta": ["g2", "f1"], "gamma": ["e1"]}
WAVE2B_ATTACHED_AT = {"g1": NOW0 - 3 * MIN, "g2": NOW0 - 3 * MIN, "e1": NOW0 - 5 * MIN,
                      "f1": NOW0 - 4 * HOUR, "d1": NOW0 - 5 * HOUR}
for _r in WAVE2B_RUNS:
    _r["session"]["created_at"] = WAVE2B_ATTACHED_AT[_r["session"]["id"]] // 1000
# The simple gates' cached records: g1 has waited longer than g2.
WAVE2B_GATES = {"g1": ("Approve the schema change?", 20 * MIN),
                "g2": ("Approve the TTL bump?", 10 * MIN),
                "g3": ("Approve the retention policy?", 5 * MIN)}
WAVE2B_AUDIT = [
    {"ts": NOW0 - 40 * MIN, "action": "gate.decided",
     "actor": {"id": "local", "kind": "human", "trust": "admin"},
     "runId": "b1", "detail": {"approve": True}},
    {"ts": NOW0 - 30 * MIN, "action": "run.stall.escalated",
     "actor": {"id": "crew.stall-watchdog", "kind": "system", "trust": "admin"},
     "runId": "r1", "detail": {"quietForMs": 1_800_000, "outcome": "surfaced"}},
]
# Behaviour 10: the standing-orders store the fixture serves, and the audit lines its
# emulated evaluator wrote (merged into the wave-2b trail). The gate each wave-2b gated run
# holds reviews one phase — the evaluator matches an order's `trigger.phase` against it.
STANDING = {"away": False, "awaySince": None, "orders": [], "outbox": []}
STANDING_AUDIT: list = []
WAVE2B_GATE_PHASE = {"g1": "intake", "g2": "intake"}
WAVE2B_RUN_PROJECT = {"g1": "alpha", "g2": "beta", "g3": "gamma"}

# Studio handover rework: a handover with about three items per chip (switch `handover_many`).
HANDOVER_MANY_RUNS = [
    session("g3", "executing", "approve gamma's retention policy", "apply the retention policy"),
    session("f2", "failed", "upgrade alpha's ORM", "upgrade the ORM"),
    session("f3", "failed", "split gamma's worker pool", "split the worker pool"),
    session("d2", "completed", "add beta's health endpoint", "add the health endpoint"),
    session("d3", "completed", "tidy gamma's logging", "tidy the logging"),
]
HANDOVER_MANY_RUNS[1]["session"]["ended_at"] = (NOW0 - 90 * MIN) // 1000
HANDOVER_MANY_RUNS[2]["session"]["ended_at"] = (NOW0 - 25 * MIN) // 1000
HANDOVER_MANY_RUNS[3]["session"]["ended_at"] = (NOW0 - 150 * MIN) // 1000
HANDOVER_MANY_RUNS[3]["units"][0]["status"] = "done"
HANDOVER_MANY_RUNS[4]["session"]["ended_at"] = (NOW0 - 45 * MIN) // 1000
# d3 ran a catalog plan, so "Reuse as preset" has steps to save.
HANDOVER_MANY_RUNS[4]["units"] = [
    {**HANDOVER_MANY_RUNS[4]["units"][0], "id": f"d3:{k}", "ord": i, "description": f"{k} — tidy the logging",
     "status": "done", "catalog": k, "phase_ref": k}
    for i, k in enumerate(["understand", "build", "review"])
]
HANDOVER_MANY_MEMBERS = {"alpha": ["f2"], "beta": ["d2"], "gamma": ["g3", "f3", "d3"]}
HANDOVER_MANY_ATTACHED_AT = {"g3": NOW0 - 6 * MIN, "f2": NOW0 - 4 * HOUR, "f3": NOW0 - 4 * HOUR,
                             "d2": NOW0 - 5 * HOUR, "d3": NOW0 - 5 * HOUR}
HANDOVER_MANY_AUDIT = [
    {"ts": NOW0 - 95 * MIN, "action": "run.turn.timedout",
     "actor": {"id": "crew.daemon", "kind": "system", "trust": "admin"},
     "runId": "f2", "detail": {"ord": 0}},
    {"ts": NOW0 - 140 * MIN, "action": "run.delivered",
     "actor": {"id": "crew.daemon", "kind": "system", "trust": "admin"},
     "runId": "d2", "detail": {}},
]


def standing_parse(text: str):
    """The fixture's deterministic 'seat': plain words → a rule (crew's parse contract)."""
    t = text.lower()
    project = next((p for p in ("alpha", "beta", "gamma") if p in t), None)
    scope = {"kind": "project", "projectId": project} if project else {"kind": "all"}
    phase = "deliver" if "deliver" in t else "intake" if "intake" in t else "*"
    action = "hold" if "hold" in t else "notify" if ("wake" in t or "tell" in t) else "approve"
    rule = {"scope": scope, "trigger": {"kind": "gate", "phase": phase},
            "action": action, "activeWhen": "always" if "always" in t else "away"}
    refused = ("an order never answers the deliver gate — it always waits for you"
               if action == "approve" and phase == "deliver" else None)
    return rule, refused


def standing_sweep() -> None:
    """Crew's evaluator, emulated: active approve orders answer matching open simple gates."""
    for order in list(STANDING["orders"]):
        rule = order["rule"]
        if rule["action"] != "approve" or (rule["activeWhen"] == "away" and not STANDING["away"]):
            continue
        # A band- or preset-scoped order matches only a run scored into that band / launched from
        # that preset (crew's evaluator); the wave-2b gated runs are neither.
        if rule["trigger"].get("band") is not None or rule["trigger"].get("preset") is not None:
            continue
        for rid in list(state["simple_gates"]):
            if rid not in WAVE2B_GATE_PHASE:
                continue
            if rule["scope"]["kind"] == "project" and rule["scope"]["projectId"] != WAVE2B_RUN_PROJECT[rid]:
                continue
            if rule["trigger"]["phase"] not in ("*", WAVE2B_GATE_PHASE[rid]):
                continue
            state["simple_gates"] = [g for g in state["simple_gates"] if g != rid]
            state["status_over"] = {**state["status_over"], rid: "executing"}
            STANDING_AUDIT.append({
                "ts": int(time.time() * 1000), "action": "gate.decided",
                "actor": {"id": f"standing-order:{order['id']}", "kind": "system", "trust": "operator"},
                "runId": rid,
                "detail": {"approve": True, "ord": 0, "status": "executing",
                           "standingOrder": {"id": order["id"], "text": order["text"]}},
            })


# wave2a_feed: r1's feed grows 40 narrated unit-output captures after its tail.
WAVE2A_R1_FEED = [
    {"type": "unitOutputCaptured", "session": "r1", "ord": 0, "cli": "claude",
     "outputBytes": 4096 + 512 * i, "ts": NOW0 - 3 * MIN + i * SEC, "seq": 4 + i}
    for i in range(40)
]
# r1 gone silent: the same tail, two hours old (wave1_stall).
WAVE1_R1_STALL_EVENTS = [dict(e, ts=e["ts"] - 2 * HOUR + 4 * MIN) for e in WAVE1_R1_EVENTS]
WAVE1_R1_DIFF = """\
diff --git a/src/upload.ts b/src/upload.ts
--- a/src/upload.ts
+++ b/src/upload.ts
@@ -1,3 +1,3 @@
 export const LIMITS = {
-  maxBytes: 50_000_000,
+  maxBytes: 10_000_000,
 };
"""
# GET /runs/:id/deliver-text — crew#524's text/plain framing: line 1 the title,
# line 2 blank, then the body (composed from the run record).
def wave1_deliver_text(run: dict) -> str:
    s = run["session"]
    return (f"docs: {s['problem']}\n\n"
            f"## Summary\n\n{s['problem']}.\n\n"
            f"## Run\n\n- run: {s['id']}\n- status: {s['status']}\n"
            f"- phases: {', '.join(u['description'] for u in run['units'])}\n")


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
    # studio#545: the daemon restarted under r-orphan's step — the engine's `runOrphaned` REPORT (crew#830,
    # api-types RunOrphanedFrame) ends the trail; the run stays `executing` with no worker until a resume
    # dispatches the unit again (POST /runs/:id/resume below appends that dispatch).
    "r-orphan": [{"type": "sessionStarted", "session": "r-orphan", "problem": "stranded work from another client",
                  "ts": NOW0 - 40 * MIN, "seq": 1},
                 {"type": "unitDispatched", "session": "r-orphan", "ord": 1, "attempt": 0, "cli": "claude",
                  "ts": NOW0 - 39 * MIN, "seq": 2},
                 {"type": "runOrphaned", "session": "r-orphan", "ord": 1, "detail": "POST /api/v1/runs/r-orphan/resume",
                  "ts": NOW0 - 10 * MIN, "seq": 3}],
}

NOTES_DOCS = [
    # studio#567: crew#512's grounding record on the docs row (api-types 0.93.0 InteractiveDocGrounding).
    {"name": "ideas", "kind": "doc", "head": 1, "versions": 1, "updated_at": iso(NOW0 - 2 * DAY),
     "grounding": {"repo_refs": ["notes-app"], "source": "sole-member",
                   "skipped": [{"ref": "old-notes", "reason": "not-a-member"}], "member_count": 1}},
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

# ── wicked-core#431 (api-types 0.33.0): the wire433 corpus, behind `wire433` ──
#
# Two runs, the two stories the studio renders off the new frames — every frame
# the wire's exact `event_to_json` spelling (camelCase, every key present, `null`
# never absent), the same literals wicked-crew#527's wire-contract test pins.
#
#  - r-api (awaiting_human, project api-migration): the bug workflow's five units;
#    the `verify` phase (ord 4, `executes_code: false`) changed the worktree, the
#    engine RESTORED the creator's tree (`restored: true`, a `worktreeRestored`
#    with the pinned suggestion ref), the judge is named (`codex`, distinct), and
#    the gate carries the engine's NEW mutation-gate prompt.
#  - r-auth (failed, project auth-refactor): based on origin/main 5 commits ahead
#    of the clone (`runBaseResolved`, lifted); survey + review done, then the
#    deliver phase's pre-push lift hit a CONFLICT in a generated file — the unit
#    failed with the engine's `deliver: LIFT-CONFLICT — …` refusal, nothing
#    rebased or pushed, and the run failed.

# ── Wave 6: the governed testing journey (api-types 0.36.0, e2e/governed_testing_test.py) ────
#
# Every name below is spelled EXACTLY as the wave-6 briefs give it (camelCase as the engine
# emits): `qe-author-tests`, `degradedReason`, `ungated` / `ungatedReason`,
# `workerToolCallDenied {role, command, remedy}`, `diff.source: "branch"`, and the registered set as
# `CampaignsListResponse.test_sets[]` (api-types 0.36.0: snake_case, `run_id`-keyed, tagged with the
# `qe-tests-<repo>` label — served beside the label group, never joined onto a row). Synthetic.
GT_RUN = "r-gt-done"                     # the COMPLETED New test (registered its set)
GT_PROBLEM = "New test: cover the run lifecycle UI — launch form, gate answering, archive"
GT_INTAKE_PROMPT = ("Approve unit 1 before it runs: recon — read the repository and its "
                    "existing tests, then plan the behaviour tests to write")
GT_DEGRADED_REASON = "4 of 5 seats benched: codex, pi, copilot (signed out), opencode (dispatch budget)"
GT_UNGATED_REASON = "no eligible judge seat"
GT_REFUSED_COMMAND = 'gh pr create --title "test(run-lifecycle): gap tests" --body-file /tmp/body.md'
GT_REMEDY = "delivery is performed by the run's deliver phase"
GT_WORKFLOW_DEF = {
    "id": "qe-author-tests",
    "phases": [
        {"id": "recon", "kind": "recon", "gate_type": None, "gate": "auto", "executes_code": False,
         "verified_evidence": False, "required_deliverables": [], "depends_on": [], "role": "neutral",
         "skill_ref": "wicked-garden-qe", "allowed_skills": [], "validator_pin": None},
        {"id": "author", "kind": "build", "gate_type": None, "gate": "auto", "executes_code": True,
         "verified_evidence": False, "required_deliverables": ["tests/"], "depends_on": ["recon"],
         "role": "creator", "skill_ref": "wicked-garden-qe", "allowed_skills": [], "validator_pin": None},
        {"id": "verify", "kind": "test", "executor": {"type": "tool", "cmd": ["wicked-core", "repo-checks"]},
         "gate_type": None, "gate": "auto", "executes_code": False, "verified_evidence": True,
         "required_deliverables": [], "depends_on": ["author"], "role": "neutral", "skill_ref": None,
         "allowed_skills": [], "validator_pin": None},
        {"id": "review", "kind": "review", "gate_type": None, "gate": "auto", "executes_code": False,
         "verified_evidence": False, "required_deliverables": [], "depends_on": ["verify"],
         "role": "evaluator", "skill_ref": "wicked-garden-qe", "allowed_skills": [], "validator_pin": None},
        {"id": "deliver", "kind": "build", "executor": {"type": "tool", "cmd": ["node", "deliver.js"]},
         "gate_type": None, "gate": "auto", "executes_code": False, "verified_evidence": False,
         "required_deliverables": [], "depends_on": ["review"], "role": "neutral", "skill_ref": None,
         "allowed_skills": [], "validator_pin": None},
    ],
}
GT_WORKFLOWS_ELSE = [{"id": "feature", "phases": []}, {"id": "bug", "phases": []},
                     {"id": "chat", "phases": [], "is_system": True}]


def _gt_unit(rid: str, ord_: int, phase: str, stage: str, status: str, **extra) -> dict:
    u = {"id": f"{rid}:{phase}", "session_id": rid, "ord": ord_, "description": f"{phase} — {GT_PROBLEM}",
         "stage": stage, "assigned_cli": None, "assigned_invocation": None, "council_task_ref": None,
         "routing": None, "denial_reason": None, "phase_ref": phase, "conformance_ref": None,
         "phase_status": None, "collection_scope": None, "status": status}
    u.update(extra)
    return u


def gt_units(rid: str, done: bool) -> list:
    """The five planned units — at the intake gate only recon has a seat; completed, every one does."""
    seat = (lambda s: s) if done else (lambda s: None)
    st = "done" if done else "pending"
    return [
        _gt_unit(rid, 1, "recon", "recon", st, assigned_cli="claude", skill_ref="wicked-garden-qe", role="neutral"),
        _gt_unit(rid, 2, "author", "build", st, assigned_cli=seat("claude"), skill_ref="wicked-garden-qe",
                 role="creator", executes_code=True,
                 routing={"method": "council", "winner": "claude", "agreement_pct": 100, "returned": 1,
                          "seated": 5, "dissent": 0} if done else None),
        _gt_unit(rid, 3, "verify", "test", st, assigned_cli=None, tool_cmd=["wicked-core", "repo-checks"]),
        _gt_unit(rid, 4, "review", "review", st, assigned_cli=seat("claude"), skill_ref="wicked-garden-qe", role="evaluator"),
        _gt_unit(rid, 5, "deliver", "build", st, assigned_cli=None, tool_cmd=["node", "deliver.js"]),
    ]


def gt_done_run() -> dict:
    r = session(GT_RUN, "completed", GT_PROBLEM, "author — write the behaviour tests")
    r["session"]["workflow_id"] = "qe-author-tests"
    r["session"]["repo_ref"] = REPO_ID
    r["session"]["clis"] = ["claude", "codex", "pi", "copilot", "opencode"]
    r["session"]["human_confirm"] = "before:1"
    r["session"]["unit_ix"] = 5
    r["session"]["delivery"] = "delivered"
    r["session"]["deliverUrl"] = "https://github.com/example/studio-api/pull/999"
    r["units"] = gt_units(GT_RUN, done=True)
    return r


GT_EVENTS = [
    {"type": "sessionStarted", "session": GT_RUN, "problem": GT_PROBLEM, "workflow_id": "qe-author-tests",
     "cli_count": 5, "governed": True, "entity_mode": "shared", "seq": 1, "ts": NOW0 - 40 * MIN},
    {"type": "workflowSelected", "session": GT_RUN, "workflowId": "qe-author-tests", "unitCount": 5,
     "seq": 2, "ts": NOW0 - 40 * MIN},
    {"type": "unitDistributed", "session": GT_RUN, "ord": 1, "cli": "claude", "routingMethod": "council",
     "agreementPct": 100, "returned": 1, "seated": 5, "dissent": 0, "degradedReason": GT_DEGRADED_REASON,
     "seq": 3, "ts": NOW0 - 39 * MIN},
    {"type": "unitDispatched", "session": GT_RUN, "ord": 1, "attempt": 0, "cli": "claude", "seq": 4, "ts": NOW0 - 39 * MIN},
    {"type": "unitDone", "session": GT_RUN, "ord": 1, "seq": 5, "ts": NOW0 - 35 * MIN},
    {"type": "unitDistributed", "session": GT_RUN, "ord": 2, "cli": "claude", "routingMethod": "council",
     "agreementPct": 100, "returned": 1, "seated": 5, "dissent": 0, "degradedReason": GT_DEGRADED_REASON,
     "seq": 6, "ts": NOW0 - 35 * MIN},
    {"type": "unitDispatched", "session": GT_RUN, "ord": 2, "attempt": 0, "cli": "claude", "seq": 7, "ts": NOW0 - 35 * MIN},
    {"type": "workerToolCallDenied", "session": GT_RUN, "ord": 2, "attempt": 0, "cli": "claude", "role": "creator",
     "command": GT_REFUSED_COMMAND, "reason": "remote write refused for a creator seat: gh pr create",
     "remedy": GT_REMEDY, "seq": 8, "ts": NOW0 - 20 * MIN},
    {"type": "repoChecksEvaluated", "session": GT_RUN, "ord": 2, "attempt": 0, "passed": True,
     "criterion": "repository checks: npm run typecheck, npm test",
     "checks": [{"name": "typecheck", "argv": ["npm", "run", "typecheck"], "source": "package.json",
                 "exitCode": 0, "timedOut": False, "spawnError": None, "durationMs": 4200,
                 "stdoutTail": None, "stderrTail": None},
                {"name": "test", "argv": ["npm", "test"], "source": "package.json", "exitCode": 0,
                 "timedOut": False, "spawnError": None, "durationMs": 61000, "stdoutTail": None, "stderrTail": None}],
     "skipped": [], "seq": 9, "ts": NOW0 - 18 * MIN},
    {"type": "gateEvaluated", "session": GT_RUN, "ord": 2, "criterion": "repository checks: npm run typecheck, npm test",
     "hasDeterministicFloor": True, "deterministicPass": True, "agentVerdict": None, "agentReasoning": None,
     "evaluatorPass": True, "evaluatorPolicies": [], "denialReason": None, "denial": None, "combined": True,
     "judgeCli": None, "judgeDistinct": None, "ungated": True, "ungatedReason": GT_UNGATED_REASON,
     "seq": 10, "ts": NOW0 - 18 * MIN},
    {"type": "unitDone", "session": GT_RUN, "ord": 2, "seq": 11, "ts": NOW0 - 18 * MIN},
    {"type": "unitDone", "session": GT_RUN, "ord": 3, "seq": 12, "ts": NOW0 - 15 * MIN},
    {"type": "unitDone", "session": GT_RUN, "ord": 4, "seq": 13, "ts": NOW0 - 10 * MIN},
    {"type": "unitDone", "session": GT_RUN, "ord": 5, "seq": 14, "ts": NOW0 - 5 * MIN},
    {"type": "sessionCompleted", "session": GT_RUN, "seq": 15, "ts": NOW0 - 5 * MIN},
]

GT_LABEL = "qe-tests-studio-api"          # the RunGroup.label POST /testing/author files the run under
GT_PR = "https://github.com/example/studio-api/pull/999"
# The registered TEST SET — `CampaignsListResponse.test_sets[0]`, spelled as api-types 0.36.0
# declares `TestSet` (snake_case, `run_id`-keyed, `label`-tagged; the verify phase's re-derived counts).
GT_TEST_SET = {
    "id": f"testset-{GT_RUN}", "run_id": GT_RUN, "workflow_id": "qe-author-tests", "label": GT_LABEL,
    "repo_ref": "studio-api", "repo_name": "studio-api",  # REPO_ID is bound further down; the literal, as GT_CAMPAIGN spelled it
    "registered_at": NOW0 - 5 * MIN,  # unix millis (NOW0 is already ms)
    "run_status": "completed", "verify_status": "done", "verified": True,
    "files": [{"path": "tests/run-lifecycle.test.tsx", "harness": "vitest", "status": "passed"},
              {"path": "e2e/run_lifecycle_test.py", "harness": "playwright-python", "status": "passed"}],
    "produced": 11, "executed": 11, "passed": 11, "failed": 0, "not_executed": 0,
    "plan": "tests/PLAN-run-lifecycle.md", "harnesses": ["vitest", "playwright-python"],
    "deliverUrl": GT_PR,
}
# The label group the launch filed the run under (`campaignRegistered: false` — an author launch is
# never an engine campaign); the set joins onto it client-side by run_id / label.
GT_GROUP = {
    "label": GT_LABEL,
    "runs": [{"runId": GT_RUN, "status": "completed", "delivery": "delivered", "deliverUrl": GT_PR}],
}
# A registration the daemon served WITHOUT a `run_id` — nothing to join, nothing to open. The landing
# must SAY it ("1 malformed" on the Tests tile), never read it as "nothing registered" (#266 F-2).
GT_TEST_SET_MALFORMED = {
    "id": "testset-orphan", "workflow_id": "qe-author-tests", "repo_ref": None,
    "registered_at": NOW0 - 9 * MIN, "run_status": "failed", "verify_status": None, "verified": False,
    "files": [], "produced": 0, "executed": 0, "passed": 0, "failed": 0, "not_executed": 0,
    "plan": None, "harnesses": [],
}
# The `WorkflowPlan` the 0.36.0 `TestingAuthorResponse` carries — derived from the def the panel read.
GT_AUTHOR_PLAN = {
    "workflow": "qe-author-tests",
    "phases": [{"id": p["id"], "kind": p["kind"], "role": p["role"],
                "executor": "tool" if p.get("executor") else "agent", "skillRef": p["skill_ref"],
                "gate": "auto", "executesCode": p["executes_code"]} for p in GT_WORKFLOW_DEF["phases"]],
    "seats": ["claude", "codex", "pi"],
}
GT_BRANCH_DIFF = """\
diff --git a/tests/run-lifecycle.test.tsx b/tests/run-lifecycle.test.tsx
new file mode 100644
--- /dev/null
+++ b/tests/run-lifecycle.test.tsx
@@ -0,0 +1,4 @@
+import { it, expect } from 'vitest';
+it('the gate error surfaces on the card', () => {
+  expect(true).toBe(true);
+});
"""
# Runs launched through POST /testing/author this lifetime — each pauses at its intake gate.
gt_launched: list = []
gt_launched_seq = [0]

WIRE433_TREE_BEFORE = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0"
WIRE433_TREE_AFTER = "f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1"
WIRE433_BASE_BEFORE = "1432c96e0f1a2b3c4d5e6f708192a3b4c5d6e7f8"
WIRE433_BASE_AFTER = "f57069d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6a7b"
WIRE433_SUGGESTION_REF = "refs/wicked/suggestions/r-api/4/0"
WIRE433_CRITERION = ("the run left a change in its worktree (done is re-derived "
                     "from the diff, never asserted)")
WIRE433_RESTORED_REASON = (
    "evaluator≠creator: phase `verify` declares `executes_code: false` but changed the "
    "worktree it was reviewing — 1 path(s): M src/App.tsx "
    f"(tree {WIRE433_TREE_BEFORE[:10]} → {WIRE433_TREE_AFTER[:10]}). "
    "The change under review is no longer the creator's, so this phase's verdict cannot "
    "certify it. The evaluator's edit was DISCARDED: the engine restored the creator's tree "
    f"({WIRE433_TREE_BEFORE[:10]}) in the worktree, so approving this gate retries the phase "
    "against the verified tree. A phase that must change code declares `executes_code: true` "
    "in the workflow def.")
WIRE433_RESTORED_PROMPT = (
    "Unit 4 verdict is NOT PASS — the evaluator changed the tree under review; its edit was "
    "discarded and the creator's verified tree restored. Approve to retry the phase against "
    "the restored tree, or reject to cancel the run")
WIRE433_LIFT_REFUSAL = (
    f"deliver: LIFT-CONFLICT — lifting the run's work onto origin/main ({WIRE433_BASE_AFTER[:7]}) "
    "would conflict in: testid-inventory.json. The worktree was left exactly as verified "
    f"(base {WIRE433_BASE_BEFORE[:7]}); nothing was rebased and nothing was pushed. Resolve on "
    "the branch (rebase onto origin/main, regenerate any generated files, re-run the "
    "repository's checks) and approve to retry the deliver phase.")
WIRE433_TRIAGE_ANALYSIS = "the engine refused the deliver: a git state, not a worker error"
# A rejected unit's denial_reason as the ENGINE frames it (actor.rs, the triage-Fail path) — the
# refusal is 370 chars, under the 150/250 excerpt cap, so it rides whole inside the framing.
WIRE433_LIFT_DENIAL = f"Worker FAILED on unit 2 (triage: {WIRE433_TRIAGE_ANALYSIS}): {WIRE433_LIFT_REFUSAL}"
WIRE433_INTENT = "migrate the auth tables"


def _wire433_unit(rid: str, key: str, ord_: int, desc: str, stage: str, status: str,
                  denial: str | None = None, tool_cmd: list | None = None) -> dict:
    u = {"id": f"{rid}:{key}", "session_id": rid, "ord": ord_, "description": desc,
         "stage": stage, "assigned_cli": "claude" if status != "pending" else None,
         "assigned_invocation": None, "council_task_ref": None, "routing": None,
         "denial_reason": denial, "phase_ref": None, "conformance_ref": None,
         "phase_status": None, "collection_scope": None, "status": status}
    if tool_cmd is not None:
        u["tool_cmd"] = tool_cmd
    return u


WIRE433_API_UNITS = [
    _wire433_unit("r-api", "triage", 1, f"triage — {WIRE433_INTENT}", "recon", "done"),
    _wire433_unit("r-api", "reproduce", 2, f"reproduce — {WIRE433_INTENT}", "recon", "done"),
    _wire433_unit("r-api", "fix", 3, f"fix — {WIRE433_INTENT}", "build", "done"),
    _wire433_unit("r-api", "verify", 4, f"verify — {WIRE433_INTENT}", "test", "pending"),
    _wire433_unit("r-api", "deliver", 5, f"deliver — {WIRE433_INTENT}", "build", "pending",
                  tool_cmd=["bash", "-lc", "gh pr create --fill"]),
]

WIRE433_T0 = NOW0 - 40 * MIN


def _w433_gate_pass(ord_: int, seq: int, ts: int, judge: str | None, distinct: bool | None,
                    floor: bool) -> dict:
    return {"type": "gateEvaluated", "session": "r-api", "ord": ord_, "seq": seq, "ts": ts,
            "criterion": WIRE433_CRITERION if floor else None,
            "hasDeterministicFloor": floor, "deterministicPass": True,
            "agentVerdict": "pass" if judge else None,
            "agentReasoning": ("PASS — the worktree evidence shows modified tracked files, "
                               "satisfying the criterion. PASS") if judge else None,
            "evaluatorPass": True, "evaluatorPolicies": [],
            "denialReason": None, "denial": None, "combined": True,
            "judgeCli": judge, "judgeDistinct": distinct}


WIRE433_API_EVENTS = [
    {"type": "sessionStarted", "session": "r-api", "problem": WIRE433_INTENT,
     "workflowId": "bug", "cliCount": 1, "governed": True, "entityMode": "shared",
     "ts": WIRE433_T0, "seq": 1},
    {"type": "workflowSelected", "session": "r-api", "workflowId": "bug", "unitCount": 5,
     "ts": WIRE433_T0 + SEC, "seq": 2},
    {"type": "awaitingHuman", "session": "r-api", "ord": 1, "seq": 33, "ts": WIRE433_T0 + 2 * SEC,
     "prompt": f"Approve unit 1 before it runs: triage — {WIRE433_INTENT}", "reviewingOrd": None},
    _w433_gate_pass(1, 43, WIRE433_T0 + 3 * MIN, None, None, False),
    {"type": "gateDecided", "session": "r-api", "ord": 1, "seq": 44, "ts": WIRE433_T0 + 3 * MIN, "allow": True},
    _w433_gate_pass(2, 102, WIRE433_T0 + 6 * MIN, None, None, False),
    {"type": "gateDecided", "session": "r-api", "ord": 2, "seq": 103, "ts": WIRE433_T0 + 6 * MIN, "allow": True},
    _w433_gate_pass(3, 197, WIRE433_T0 + 20 * MIN, "codex", True, True),
    {"type": "gateDecided", "session": "r-api", "ord": 3, "seq": 198, "ts": WIRE433_T0 + 20 * MIN, "allow": True},
    {"type": "unitDone", "session": "r-api", "ord": 3, "seq": 199, "ts": WIRE433_T0 + 20 * MIN},
    {"type": "awaitingHuman", "session": "r-api", "ord": 4, "seq": 200, "ts": WIRE433_T0 + 20 * MIN + SEC,
     "prompt": f"Approve unit 4 before it runs: verify — {WIRE433_INTENT}", "reviewingOrd": None},
    {"type": "resumed", "session": "r-api", "ord": 4, "seq": 201, "ts": WIRE433_T0 + 22 * MIN},
    {"type": "unitDispatched", "session": "r-api", "ord": 4, "seq": 202, "ts": WIRE433_T0 + 22 * MIN, "attempt": 0},
    {"type": "unitExecuting", "session": "r-api", "ord": 4, "seq": 203, "ts": WIRE433_T0 + 22 * MIN},
    {"type": "evaluatorMutatedWorktree", "session": "r-api", "ord": 4, "seq": 245,
     "ts": WIRE433_T0 + 28 * MIN, "attempt": 0, "cli": "pi", "phase": "verify",
     "beforeTree": WIRE433_TREE_BEFORE, "afterTree": WIRE433_TREE_AFTER, "headMoved": False,
     "changed": [{"path": "src/App.tsx", "status": "M"}], "restored": True, "restoreError": None},
    {"type": "worktreeRestored", "session": "r-api", "ord": 4, "seq": 246,
     "ts": WIRE433_T0 + 28 * MIN, "attempt": 0, "cli": "pi", "phase": "verify",
     "tree": WIRE433_TREE_BEFORE, "head": None,
     "discarded": [{"path": "src/App.tsx", "status": "M"}],
     "suggestionRef": WIRE433_SUGGESTION_REF},
    {"type": "gateEvaluated", "session": "r-api", "ord": 4, "seq": 247, "ts": WIRE433_T0 + 28 * MIN,
     "criterion": WIRE433_CRITERION, "hasDeterministicFloor": True, "deterministicPass": True,
     "agentVerdict": "pass",
     "agentReasoning": "PASS — the worktree evidence shows modified tracked files, satisfying the criterion. PASS",
     "evaluatorPass": True, "evaluatorPolicies": [],
     "denialReason": WIRE433_RESTORED_REASON,
     "denial": {"source": "worktree_guard", "reason": WIRE433_RESTORED_REASON, "claimId": None,
                "ruleIds": [], "deniedTool": None, "phase": "unit-4"},
     "combined": False, "judgeCli": "codex", "judgeDistinct": True},
    {"type": "gateDecided", "session": "r-api", "ord": 4, "seq": 248, "ts": WIRE433_T0 + 28 * MIN, "allow": False},
    {"type": "unitDenied", "session": "r-api", "ord": 4, "seq": 249, "ts": WIRE433_T0 + 28 * MIN},
    {"type": "gateEscalated", "session": "r-api", "ord": 4, "seq": 250, "ts": WIRE433_T0 + 28 * MIN,
     "condition": "verdict_not_pass", "verdictSummary": WIRE433_RESTORED_REASON},
    {"type": "awaitingHuman", "session": "r-api", "ord": 4, "seq": 251, "ts": WIRE433_T0 + 28 * MIN + SEC,
     "prompt": WIRE433_RESTORED_PROMPT, "reviewingOrd": 4},
]

WIRE433_AUTH_UNITS = [
    _wire433_unit("r-auth", "survey", 0, "survey the auth middleware surface", "recon", "done"),
    _wire433_unit("r-auth", "review", 1, "review the middleware refactor", "review", "done"),
    _wire433_unit("r-auth", "deliver", 2, "deliver — refactor the auth middleware", "build",
                  "rejected", denial=WIRE433_LIFT_DENIAL,
                  tool_cmd=["bash", "-lc", "gh pr create --fill"]),
]
WIRE433_AUTH_WORKDIR = "/w2/trees/r-auth"
WIRE433_A0 = NOW0 - 13 * MIN


def _w433_auth_planned(ord_: int, desc: str, stage: str, seq: int, ts: int) -> dict:
    return {"type": "unitPlanned", "session": "r-auth", "ord": ord_, "description": desc,
            "stage": stage, "role": None, "gate": None, "skillRef": None,
            "hasValidatorPin": True, "executorType": "cli" if ord_ < 2 else "tool",
            "ts": ts, "seq": seq}


WIRE433_AUTH_EVENTS = [
    {"type": "sessionStarted", "session": "r-auth", "problem": "refactor the auth middleware",
     "workflowId": "wf-w2", "cliCount": 1, "governed": True, "entityMode": "shared",
     "ts": WIRE433_A0, "seq": 1},
    {"type": "runBaseResolved", "session": "r-auth", "baseRef": "origin/main",
     "baseCommit": WIRE433_BASE_AFTER, "localHead": WIRE433_BASE_BEFORE, "behind": 5,
     "fetched": True, "lifted": True, "note": None, "ts": WIRE433_A0 + SEC, "seq": 2},
    {"type": "workflowSelected", "session": "r-auth", "workflowId": "wf-w2", "unitCount": 3,
     "ts": WIRE433_A0 + 2 * SEC, "seq": 3},
    _w433_auth_planned(0, "survey the auth middleware surface", "recon", 4, WIRE433_A0 + 3 * SEC),
    _w433_auth_planned(1, "review the middleware refactor", "review", 5, WIRE433_A0 + 3 * SEC),
    _w433_auth_planned(2, "deliver — refactor the auth middleware", "build", 6, WIRE433_A0 + 3 * SEC),
    {"type": "unitDispatched", "session": "r-auth", "ord": 0, "attempt": 0, "ts": WIRE433_A0 + 4 * SEC, "seq": 7},
    {"type": "unitOutputCaptured", "session": "r-auth", "ord": 0, "attempt": 0, "outputBytes": 2048,
     "stepStatus": "ok", "governed": True, "ts": WIRE433_A0 + 40 * SEC, "seq": 8},
    {"type": "unitDone", "session": "r-auth", "ord": 0, "ts": WIRE433_A0 + 41 * SEC, "seq": 9},
    {"type": "unitDispatched", "session": "r-auth", "ord": 1, "attempt": 0, "ts": WIRE433_A0 + 42 * SEC, "seq": 10},
    {"type": "gateEvaluated", "session": "r-auth", "ord": 1, "ts": WIRE433_A0 + 5 * MIN, "seq": 11,
     "criterion": "the middleware refactor keeps every existing auth test green",
     "hasDeterministicFloor": True, "deterministicPass": True, "agentVerdict": "pass",
     "agentReasoning": "PASS — auth.refresh.spec and the full auth suite are green on the refactor. PASS",
     "evaluatorPass": True, "evaluatorPolicies": [], "denialReason": None, "denial": None,
     "combined": True, "judgeCli": "codex", "judgeDistinct": True},
    {"type": "gateDecided", "session": "r-auth", "ord": 1, "allow": True, "ts": WIRE433_A0 + 5 * MIN, "seq": 12},
    {"type": "unitDone", "session": "r-auth", "ord": 1, "ts": WIRE433_A0 + 5 * MIN, "seq": 13},
    {"type": "unitDispatched", "session": "r-auth", "ord": 2, "attempt": 0, "ts": WIRE433_A0 + 5 * MIN + SEC, "seq": 14},
    {"type": "deliverLiftEvaluated", "session": "r-auth", "ord": 2, "attempt": 0,
     "outcome": "conflict", "baseRef": "origin/main", "baseBefore": WIRE433_BASE_BEFORE,
     "baseAfter": WIRE433_BASE_AFTER, "treeBefore": WIRE433_TREE_BEFORE, "treeAfter": None,
     "conflicts": ["testid-inventory.json"], "note": None,
     "ts": WIRE433_A0 + 5 * MIN + 4 * SEC, "seq": 15},
    {"type": "stepFailed", "session": "r-auth", "ord": 2, "attempt": 0, "detail": WIRE433_LIFT_REFUSAL,
     "failureKind": "workerError", "ts": WIRE433_A0 + 5 * MIN + 4 * SEC, "seq": 16},
    {"type": "failureTriaged", "session": "r-auth", "ord": 2, "decision": "fail",
     "analysis": WIRE433_TRIAGE_ANALYSIS,
     "ts": WIRE433_A0 + 5 * MIN + 5 * SEC, "seq": 17},
    {"type": "sessionFailed", "session": "r-auth", "ord": 2, "ts": NOW0 - 12 * MIN, "seq": 18},
]

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

# ── Wave 2 (studio#251 / #246 / #248) — the api-types 0.32.0 shapes ───────────
STATE_HOME_GRAPH = "/tmp/w2/state/repo-graphs/studio-api-9c1e/estate.db"
# wicked-core#406's finding, in its NO-LIVE-GRAPH form (core `repo.rs` sentence verbatim,
# scrubbed paths) — the case whose remedy is the onboarding re-run.
REPO_FINDING_NO_LIVE = {
    "code": "in_tree_code_graph_ignored",
    "message": ("/tmp/w2/studio-api/.codegraph exists in the checkout — a code graph an older wicked-core "
                "indexed IN the working tree. It is ignored (no graph has been indexed under the state home yet "
                f"— re-run onboarding (POST /repos/{REPO_ID}/onboard) to build {STATE_HOME_GRAPH}; never inside "
                "the repository). Delete `.codegraph/` from the checkout — and `git rm --cached` it if the "
                "repository tracks it — to clear this finding (core#406)."),
    "path": "/tmp/w2/studio-api/.codegraph",
}


def repo_entry_wire(findings_on: bool) -> dict:
    """The studio-api record as the wire carries it: with `repo_findings` the graph path moves
    under the state home (core#406) and the finding rides along; otherwise the standing shape."""
    if not findings_on:
        return REPO_ENTRY
    return {**REPO_ENTRY, "code_graph_db": STATE_HOME_GRAPH, "findings": [REPO_FINDING_NO_LIVE]}


onboard_posts: list = []  # POST /repos/<id>/onboard receipts (studio#251's remedy, tapped by the rig)
replay_posts: list = []  # POST /governance/deadletters/replay bodies (Wave A idea 5, tapped by the rig)
approve_posts: list = []  # POST /proposals/<id>/approve ids (Wave B idea 4, tapped by the rig)
proposal_posts: list = []  # POST /proposals bodies (Wave C idea 12, takes: the filed preference)


def never_indexed_repos(n: int, broken: bool) -> list:
    """Wave A: N registered repos with no onboarding run on record (the D6 "Never indexed" pile)."""
    rows = []
    for i in range(n):
        registered = 1 if (broken and i == 0) else (NOW0 - (i + 1) * HOUR) // 1000
        rows.append({"id": f"idx-{i}", "name": f"wicked-idx-{i}", "root_path": f"/tmp/w2/repos/idx-{i}",
                     "default_branch": "main", "registered_at": registered})
    return rows

GOV_STORE = "/tmp/w2/state/core.db.governance/governance.db"
GOV_OUTBOX = "/tmp/w2/state/core.db.governance/emit-outbox.ndjson"
DIAGNOSTICS_BASE = {
    "components": {"crew": "w2-fixture", "studioBundle": None, "coreTs": None, "engineBinaries": {}},
    "daemon": {"uptimeMs": 60_000, "startedAt": NOW0 - 60 * SEC, "port": 7701},
    "stores": [], "recentErrors": [], "acp": {"byCli": {}},
}
# ── home_paths (studio#458/#460/#462, e2e/desk_home_paths_test.py) ─────────────
# A home directory as macOS spells it; every `/tmp/w2/…` path this fixture serves moves under it
# (`_json` rewrites the body), so a surface that prints a path verbatim is caught by the journey.
FAKE_HOME = "/Users/reel-operator"
HOME_STATE = "/tmp/w2/state"  # → FAKE_HOME/w2/state on the wire
HOME_SETTINGS_PATH = f"{HOME_STATE}/settings.json"
HOME_SKILLS_ROOT = f"{HOME_STATE}/skills"
HOME_SNAPSHOT = f"{HOME_SKILLS_ROOT}/snapshots/000003"
HOME_INDEX_OUTPUT = (f"indexed /tmp/reel-repos/offsite-plan ({HOME_STATE}/repo-graphs/offsite-plan-9c1e/estate.db) "
                     "→ 4 nodes, 2 edges, 2 files")
_HOME_BASELINE = "b" * 16
_HOME_RECORD = {"baselineHash": "a" * 8, "effectiveHash": "a" * 8, "lastPublishedHash": "a" * 8, "conflict": False}
HOME_SKILLS_CATALOG = {
    "manifest": {
        "version": 2, "revision": 3, "baseline": _HOME_BASELINE,
        "baselines": {_HOME_BASELINE: {
            "plugin_version": "12.40.0",
            "source": {"kind": "claude-plugin-cache", "path": f"{FAKE_HOME}/.claude/plugins/cache/wicked-garden/12.40.0"},
            "git_sha": "abcdef0123456789", "captured_at": "2026-10-01T00:00:00Z", "venv": "synced"}},
        "skills": {"wicked-garden-repo-learn": {
            "dir": "skills/repo-learn", "kind": "router", "core": True, "portable": True, "enabled": True,
            "provenance": "shipped", "editedAt": None, "upgradeAvailable": False, "conflict": False, "upstreamDir": None}},
        "files": {"skills/repo-learn/SKILL.md": dict(_HOME_RECORD), ".claude-plugin/plugin.json": dict(_HOME_RECORD)},
        "published": {"gen": 3, "contentHash": "p" * 16, "at": "2026-10-01T00:00:00Z", "snapshotHash": "s" * 16},
    },
    "revision": 3, "root": HOME_SKILLS_ROOT, "current": {"gen": 3, "path": HOME_SNAPSHOT}, "installed": None,
}
HOME_DIAGNOSTICS_SKILLS = {
    "state": "published", "root": HOME_SKILLS_ROOT, "current": {"gen": 3, "path": HOME_SNAPSHOT},
    "engineInput": HOME_SNAPSHOT, "stateHome": HOME_STATE, "findings": [], "baseSkill": None,
}

# studio#464/#479 (home_paths): a run paused before its first unit on crew's unit prompt (the goal and
# the ` ||| PHASE SCOPE:` scaffold in it), and a delivered run whose worktree, referenced files, push
# target and deliver output all live under the home directory.
HOME_GATE_PROMPT = ("Approve unit 1 before it runs: triage — SAVE20 should give twenty percent off, not twenty "
                    "pounds off ||| PHASE SCOPE: this is the triage phase; read the code and say what is wrong")
HOME_WORKTREE = "/tmp/w2/wicked-worktrees/r-home-done"
HOME_ORIGIN = "/tmp/w2/origins/checkout-demo.git"
HOME_DELIVER_OUTPUT = (f"deliver: pushed wicked/r-home-done to origin ({HOME_ORIGIN})\n"
                       f"To {HOME_ORIGIN}\n * [new branch]      wicked/r-home-done -> wicked/r-home-done")
HOME_T0 = NOW0 - 40 * 60_000


def _home_runs() -> list:
    gate = session("r-home-gate", "awaiting_human", "SAVE20 should give twenty percent off, not twenty pounds off",
                   "triage")
    gate["session"]["human_confirm"] = "before:1"
    gate["units"] = [dict(gate["units"][0], id="r-home-gate:triage", ord=1, stage="triage", phase_ref="triage")]
    done = session("r-home-done", "completed", "show the free-shipping banner on the cart", "build the banner")
    done["session"].update({"workdir": HOME_WORKTREE, "repo_ref": "checkout-demo", "delivery": "pushed",
                            "deliverBranch": "wicked/r-home-done", "deliverRemote": HOME_ORIGIN,
                            "run_branch": "wicked/r-home-done"})
    done["units"] = [dict(done["units"][0], status="done", assigned_cli="claude"),
                     dict(done["units"][0], id="r-home-done:deliver", ord=1, description="deliver", stage="deliver",
                          phase_ref="deliver", status="done", assigned_cli="claude")]
    return [gate, done]


HOME_EVENTS = {
    "r-home-gate": [
        {"type": "sessionStarted", "session": "r-home-gate", "problem": "SAVE20 should give twenty percent off",
         "workflowId": "bug", "cliCount": 1, "governed": True, "entityMode": "shared", "ts": HOME_T0, "seq": 1},
        {"type": "awaitingHuman", "session": "r-home-gate", "ord": 1, "ts": HOME_T0 + 1000, "seq": 2,
         "prompt": HOME_GATE_PROMPT, "reviewingOrd": None, "gateKind": "def"},
    ],
    "r-home-done": [
        {"type": "sessionStarted", "session": "r-home-done", "problem": "show the free-shipping banner on the cart",
         "workflowId": "feature", "cliCount": 1, "governed": True, "entityMode": "shared", "ts": HOME_T0, "seq": 1},
        {"type": "unitDispatched", "session": "r-home-done", "ord": 0, "attempt": 0, "ts": HOME_T0 + 1000, "seq": 2},
        {"type": "dataUsed", "session": "r-home-done", "ord": 0, "ts": HOME_T0 + 2000, "seq": 3,
         "files": [f"{HOME_WORKTREE}/src/cart/Banner.tsx", "/tmp/w2/repos/checkout-demo/src/checkout.ts"]},
        {"type": "unitDone", "session": "r-home-done", "ord": 0, "ts": HOME_T0 + 60_000, "seq": 4},
        {"type": "unitDone", "session": "r-home-done", "ord": 1, "ts": HOME_T0 + 90_000, "seq": 5},
    ],
}

HOME_ASK_PACK = ("\n\n---\n[studio context pack — assembled 2026-10-03T14:00:00.000Z]\nwhere: Desk (/)\n"
                 "diagnostics (GET /api/v1/diagnostics):\n  stores: core.db 11.8 MB (/tmp/w2/state/core.db)")

# ── reject_note (studio#478, e2e/desk_run_state_test.py) ─────────────────────
REJECTED_RUN_ID = "r-rejected"
REJECTED_NOTE = "the hall is booked that week; plan around the garden room"
REJECTED_AUDIT = [
    {"ts": NOW0 - 5 * 60_000, "action": "run.launched", "runId": REJECTED_RUN_ID,
     "actor": {"id": "local", "kind": "human", "trust": "operator"}, "detail": {"workflow": "feature"}},
    {"ts": NOW0 - 2 * 60_000, "action": "gate.decided", "runId": REJECTED_RUN_ID,
     "actor": {"id": "local", "kind": "human", "trust": "operator"},
     "detail": {"approve": False, "amend": REJECTED_NOTE, "ord": 0}},
]


def _rejected_run() -> dict:
    r = session(REJECTED_RUN_ID, "cancelled", "Plan the team offsite", "plan the offsite")
    r["session"]["created_at"] = (NOW0 - 5 * 60_000) // 1000
    r["session"]["ended_at"] = (NOW0 - 2 * 60_000) // 1000
    return r


# ── seat_escalation (studio#480, e2e/desk_gate_moves_test.py) ─────────────────
SEAT_PROMPT = "Unit 1 failed and triage escalated: codex exited 1 (the seat failed)"
SEAT_T0 = NOW0 - 10 * 60_000


# ── retry_gate (studio#557, e2e/desk_gate_kinds_test.py §15) ──────────────────
RETRY_PROMPT = "Approve to retry unit 2 against the restored tree, or reject to cancel the run"
RETRY_T0 = NOW0 - 12 * 60_000


def _retry_run() -> dict:
    r = session("r-retry", "awaiting_human", "Tidy the importer", "tidy the importer")
    r["session"]["clis"] = ["codex", "claude"]
    r["session"]["unit_ix"] = 1
    base = r["units"][0]
    r["units"] = [dict(base, id="r-retry:build", ord=1, stage="build", role="creator", phase_ref="build",
                       status="done", assigned_cli="claude"),
                  dict(base, id="r-retry:review", ord=2, stage="review", role="evaluator", phase_ref="review",
                       status="pending", assigned_cli="codex")]
    return r


RETRY_EVENTS = [
    {"type": "sessionStarted", "session": "r-retry", "problem": "Tidy the importer", "workflowId": "bug",
     "cliCount": 2, "governed": True, "entityMode": "shared", "ts": RETRY_T0, "seq": 1},
    {"type": "unitDispatched", "session": "r-retry", "ord": 2, "cli": "codex", "attempt": 0, "ts": RETRY_T0 + 1000, "seq": 2},
    {"type": "evaluatorMutatedWorktree", "session": "r-retry", "ord": 2, "cli": "codex", "phase": "review",
     "attempt": 0, "changed": [{"path": "src/importer.ts", "status": "M"}], "restored": True, "restoreError": None,
     "ts": RETRY_T0 + 60_000, "seq": 3},
    {"type": "gateEvaluated", "session": "r-retry", "ord": 2, "combined": False, "hasDeterministicFloor": False,
     "denial": {"source": "worktree_guard", "reason": "the review phase changed the tree under review",
                "claimId": None, "ruleIds": [], "deniedTool": None, "phase": "unit-2"},
     "ts": RETRY_T0 + 60_500, "seq": 4},
    {"type": "awaitingHuman", "session": "r-retry", "ord": 2, "prompt": RETRY_PROMPT, "reviewingOrd": 2,
     "ts": RETRY_T0 + 61_000, "seq": 5},
]


def _seat_run() -> dict:
    r = session("r-seat", "awaiting_human", "Fix the flaky importer", "fix the flaky importer")
    r["session"]["clis"] = ["codex", "claude"]
    r["session"]["unit_ix"] = 1
    r["units"] = [dict(r["units"][0], id="r-seat:fix", ord=1, stage="build", phase_ref="fix",
                       status="pending", assigned_cli="codex")]
    return r


SEAT_EVENTS = [
    {"type": "sessionStarted", "session": "r-seat", "problem": "Fix the flaky importer", "workflowId": "bug",
     "cliCount": 2, "governed": True, "entityMode": "shared", "ts": SEAT_T0, "seq": 1},
    {"type": "unitDispatched", "session": "r-seat", "ord": 1, "cli": "codex", "attempt": 0, "ts": SEAT_T0 + 1000, "seq": 2},
    {"type": "stepFailed", "session": "r-seat", "ord": 1, "detail": "codex exited 1", "ts": SEAT_T0 + 60_000, "seq": 3},
    {"type": "awaitingHuman", "session": "r-seat", "ord": 1, "prompt": SEAT_PROMPT, "reviewingOrd": None,
     "gateKind": "escalation", "ts": SEAT_T0 + 61_000, "seq": 4},
]


GOVERNANCE_BLOCKS = {
    "healthy": {
        "store": {"path": GOV_STORE, "source": "core-db-sidecar"},
        "records": {"total": 412, "sinceBoot": 37},
        "deadletters": {"path": GOV_OUTBOX, "count": 0, "byType": {}, "byReason": {}, "timestamped": 0,
                        "untimestamped": 0, "oldestTs": None, "newestTs": None, "truncated": False,
                        "legacyOutbox": None},
        "findings": [],
    },
    # F-022: every governance event dead-lettered; the finding names the replay (crew#495).
    "deadletters": {
        "store": {"path": GOV_STORE, "source": "flag"},
        "records": {"total": 0, "sinceBoot": 0},
        "deadletters": {"path": GOV_OUTBOX, "count": 128,
                        "byType": {"wicked.crew.governance.conformance_recorded": 96,
                                   "wicked.crew.governance.decision_recorded": 32},
                        "byReason": {"no shared store (WICKED_ESTATE_DB unset)": 128},
                        "timestamped": 120, "untimestamped": 8,
                        "oldestTs": NOW0 - 2 * HOUR, "newestTs": NOW0 - 5 * MIN, "truncated": True,
                        "legacyOutbox": None},
        "findings": [{"kind": "governance.deadletter", "severity": "error",
                      "message": (f"128 governance event(s) dead-lettered to {GOV_OUTBOX} (at least — the fold "
                                  "stopped at its size cap) — the store refused or was unset when they were emitted "
                                  "(no shared store (WICKED_ESTATE_DB unset)); replay them with wicked-crew governance "
                                  f"replay {GOV_OUTBOX} --governance-db {GOV_STORE}")}],
    },
}

CHAT_SCRATCH = "/tmp/w2/wicked-crew-chats/4242-9f3a1c2b/{}"
CHAT_SCOPE_501 = ("the installed wicked-core-ts predates chat scope (wicked-core#410): it cannot ground a scoped "
                  "chat or hold its read roots read-only — upgrade the engine, or open the chat without "
                  "projectId/repoRefs.")
chat_scopes: dict = {}  # chatId → the ChatScope recorded at open (crew#502), under chat_state_lock


def scope_repo(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "rootPath": r["root_path"]}


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
# Idea 9 (e2e/agent_1on1_test.py): four seats, four weeks, shaped like crew#690's
# `GET /roster/record` — claude clean (no change), codex stalling on reviews (route reviews
# away), agy absent (no units), pi benched for sign-in (sign in).
def _seat_rec(cli, **kw):
    base = {"cli": cli, "units": 0, "gated": 0, "firstPass": 0, "rework": 0, "stalls": 0,
            "benched": 0, "benchReasons": {}, "costUsd": None, "costedUsage": 0, "byPhase": {}}
    base.update(kw)
    return base


def seat_week_record():
    now_ms = int(time.time() * 1000)
    return {"days": 7, "since": now_ms - 7 * 86_400_000, "until": now_ms, "runsRead": 9, "truncated": False,
            "seats": [
                _seat_rec("claude", units=6, gated=5, firstPass=5, costUsd=3.2, costedUsage=6,
                          byPhase={"build": {"units": 6, "gated": 5, "firstPass": 5, "rework": 0, "stalls": 0}}),
                _seat_rec("codex", units=5, gated=4, firstPass=3, rework=1, stalls=3, costUsd=0.84, costedUsage=5,
                          byPhase={"build": {"units": 2, "gated": 2, "firstPass": 2, "rework": 0, "stalls": 0},
                                   "review": {"units": 3, "gated": 2, "firstPass": 1, "rework": 1, "stalls": 3}}),
                _seat_rec("pi", benched=2, benchReasons={"signed out": 2}),
            ]}


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
        elif state["wave1"]:
            runs = list(WAVE1_RUNS) + (list(WAVE2B_RUNS) if state["wave2b"] else []) \
                + (json.loads(json.dumps(HANDOVER_MANY_RUNS)) if state["wave2b"] and state["handover_many"] else [])
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
        wire433_on = state["wire433"]
        # Slice S (DES-UX-001 §2.3): the null-claim run + this-lifetime launches
        # join BOTH wires (list + detail) so the DTO echo decorates identically.
        if project_dto_on and not state["no_runs"]:
            runs = runs + [UNFILED_RUN] + launched_runs
        # Wave 5 (F-4R2-006): the doc's bound run — the shape crew's draft seam launches
        # (`extraWriteRoots: [runDir]`, runDir = <draftDir>/<docId>), filed into its project.
        bound = state["doc_bound_run"]
        if bound and not state["no_runs"]:
            bound_run = session("r-doc-bound", "executing",
                                f"Draft the document {bound['doc']} from its brief",
                                "draft the document")
            bound_run["session"]["workflow_id"] = "interactive-draft"
            bound_run["session"]["extra_write_roots"] = [
                f"/w5/state/interactive-drafts/{bound['doc']}"]
            bound_run["session"]["project_id"] = bound["pid"]
            if isinstance(bound.get("repo"), str):
                bound_run["session"]["repo_ref"] = bound["repo"]
            runs = runs + [bound_run]
        # Wave 6: the completed governed test + every New test launched this lifetime
        # (each awaiting its intake gate) ride BOTH wires (list + detail).
        if state["governed_testing"] and not state["no_runs"]:
            runs = runs + [gt_done_run()] + json.loads(json.dumps(gt_launched))
        # T9: the team corpus rides BOTH wires (list + detail).
        if state["team_plan"] and not state["no_runs"]:
            runs = runs + json.loads(json.dumps(TEAM_RUNS))
        if state["plan_gate"] and not state["no_runs"]:
            runs = runs + [json.loads(json.dumps(PLAN_GATE_RUN))]
        if state["gate_move"] and not state["no_runs"]:
            runs = runs + [json.loads(json.dumps(GATE_MOVE_RUN))]
        if state["escalation_arms"] and not state["no_runs"]:
            runs = runs + json.loads(json.dumps(ESC_RUNS))
        if state["trust_rules"] and not state["no_runs"]:
            runs = runs + json.loads(json.dumps(TRUST_RUNS))
        if state["run_page"] and not state["no_runs"]:
            runs = runs + json.loads(json.dumps(RUN_PAGE_RUNS))
        if state["home_runs"] and not state["no_runs"]:
            runs = runs + [json.loads(json.dumps(REUSE_RUN))]
        if state["reject_note"] and not state["no_runs"]:
            runs = runs + [_rejected_run()]
        if state["floor_plan"] and not state["no_runs"]:
            runs = runs + [json.loads(json.dumps(FLOOR_RUN))]
        if state["seat_escalation"] and not state["no_runs"]:
            runs = runs + [_seat_run()]
        if state["retry_gate"] and not state["no_runs"]:
            runs = runs + [_retry_run()]
        if state["home_paths"] and not state["no_runs"]:
            runs = runs + _home_runs()
        if state["sessions"] and not state["no_runs"]:
            extra = json.loads(json.dumps(SESSION_RUNS))
            if not state["run_chat_id"]:
                for r in extra:  # a daemon before C1 carries no chat_id
                    r["session"].pop("chat_id", None)
            if state["reel_runs"]:
                extra = extra + json.loads(json.dumps(REEL_RUNS))
            if state["ship_proposals"]:
                extra = extra + json.loads(json.dumps(PROPOSAL_RUNS))
                if not state["run_chat_id"]:
                    for r in extra:
                        r["session"].pop("chat_id", None)
            extra = extra + json.loads(json.dumps(session_launched))
            if state["walkthrough"]:
                extra = extra + json.loads(json.dumps(walk_runs()))
            runs = extra  # the sessions corpus stands alone: the rail shows exactly these
        if state["ask_path"] and not state["no_runs"]:
            runs = runs + ask_runs_list()  # the ask paths this fixture started (chat_id set), after any replacement
        if state["demo_runs"] and not state["no_runs"]:
            with demo_lock:
                for d in demo_runs.values():
                    demo_tick(d)
                runs = runs + [demo_session(rid, d) for rid, d in demo_runs.items()]
        if state["sheets"] and not state["no_runs"]:
            runs = json.loads(json.dumps(runs))
            for r in runs:
                for u in r.get("units", []):
                    if not u.get("assigned_cli"):
                        u["assigned_cli"] = "claude"
    if viewer_on or repo_refs_on or forensics_on or provenance_on or project_dto_on \
            or chronicle_on or nerve_on or gate_now or guidance or wire433_on:
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
            # wicked-core#431 (api-types 0.33.0): r-api on the bug workflow's five
            # units, genuinely ON the denied verify (unit_ix 3); r-auth with its
            # REJECTED deliver unit (the engine's LIFT-CONFLICT refusal, framed as the
            # engine frames a rejected unit's denial_reason) and a workdir, so the
            # Delivery card names the worktree.
            if wire433_on and r["session"]["id"] == "r-api":
                r["units"] = json.loads(json.dumps(WIRE433_API_UNITS))
                r["session"]["unit_ix"] = 3
                r["session"]["workflow_id"] = "bug"
            if wire433_on and r["session"]["id"] == "r-auth":
                r["units"] = json.loads(json.dumps(WIRE433_AUTH_UNITS))
                r["session"]["workdir"] = WIRE433_AUTH_WORKDIR
                r["session"]["unit_ix"] = 2
            # Slice S (CREW-UX-2): the DTO echoes the membership record —
            # ALWAYS present with the corpus on (string | null), the
            # api-types 0.8.0 contract. Launched runs arrive pre-stamped;
            # slice V's explicit lineage-pair stamp above wins when both
            # corpora are on (this is the membership-derived fallback).
            if project_dto_on and "project_id" not in r["session"]:
                r["session"]["project_id"] = RUN_PROJECT.get(r["session"]["id"])
    with state_lock:
        status_over = dict(state["status_over"])
        simple_gates = list(state["simple_gates"])
        session_over = json.loads(json.dumps(state["session_over"]))
    if status_over or simple_gates or session_over:
        runs = json.loads(json.dumps(runs))
        for r in runs:
            if r["session"]["id"] in simple_gates:
                r["session"]["status"] = "awaiting_human"
            if r["session"]["id"] in status_over:
                r["session"]["status"] = status_over[r["session"]["id"]]
            r["session"].update(session_over.get(r["session"]["id"], {}))
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
doc_styles: dict = {}          # (pid, doc) -> the style the doc was created with (S9)
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


# ── ASK-S1 (DES-ASK-TEAM-CHAT-001): an ask is a team path — the fixture's replay of the crew lane's frames ──
#
# Chat ids are the client's (AskDock mints one per session), so the corpus is DYNAMIC: `ask_open` records
# each chat as POST /chats sees it; `ask_message` answers crew's 202 and starts a thread that replays, with
# small delays, the rows and chat frames the proof daemon emitted on 2026-10-05 (lanes/a6-crew/proof/ws.jsonl)
# for one answer step — field for field, ids and times minted here. The first turn of a chat also carries the
# path's opening rows (path.started with `selection: random`, plan.proposed/scored/accepted). The second and
# later turns add a HELP: exchange (help.requested → help.answered) so the thread's help line is exercised.
ask_lock = threading.Lock()
ask_chats: dict = {}       # chat_id -> {run_id, eligible, primary, pa, reviewer, turns, rows, messages, scope, status}
ask_posts: list = []       # every POST /chats/:id/messages the ask path received (GET /__fixture/ask-posts)
ask_seq = [0]
ask_eid = [5000]

ASK_REPLY_1 = ("`greet()` does not trim its input (`proof-scratch/src/greet.js:2`): it interpolates `name` verbatim, "
               "so `greet(\"  Ada \")` returns `Hello,   Ada !`. Yes, it should trim — a greeting's only job is a "
               "readable salutation, and no caller relies on the padding.")
ASK_REPLY_2 = ("I asked the reviewer: no caller passes padded names, so trimming is safe. The one-line change is "
               "`return `Hello, ${name.trim()}!`;` at `proof-scratch/src/greet.js:2`.")
ASK_HELP_Q = "is trimming the name a behaviour change any caller relies on?"
ASK_HELP_A = "No caller passes padded names; trimming is safe."


def _ask_row(run_id: str, etype: str, at_ms: int, **payload) -> dict:
    ask_eid[0] += 1
    base = {"run_id": run_id, "ord": payload.pop("ord", None), "attempt": payload.pop("attempt", None),
            "by": payload.pop("by", "engine"), "at": at_ms, "re": None}
    return {"event_id": ask_eid[0], "event_type": f"wicked.team.{etype}", "emitted_at": at_ms,
            "payload": dict(base, **payload)}


def ask_open(chat_id: str, eligible: list, primary, scope) -> None:
    """POST /chats under ask_path: record the eligible roster (nothing warms) and the caller's `primary`."""
    with ask_lock:
        if chat_id in ask_chats:
            return
        ask_seq[0] += 1
        ask_chats[chat_id] = {"run_id": f"r-ask-{ask_seq[0]}", "eligible": list(eligible), "primary": primary,
                              "pa": None, "reviewer": None, "turns": 0, "rows": [], "messages": [], "scope": scope,
                              "status": None, "helpers": []}


def ask_chat_detail(chat_id: str):
    with ask_lock:
        c = ask_chats.get(chat_id)
        if c is None:
            return None
        detail = {"chatId": chat_id, "seats": list(c["eligible"]), "scope": c["scope"], "refused": [],
                  "messages": json.loads(json.dumps(c["messages"]))}
        if c["turns"] > 0:
            detail["path"] = {"runId": c["run_id"], "pa": c["pa"], "selection": "chosen" if c["primary"] else "random",
                              "reviewer": c["reviewer"], "helpers": list(c["helpers"]), "stepId": f"answer-{c['turns']}"}
        return detail


def ask_runs_list() -> list:
    out = []
    with ask_lock:
        for cid, c in ask_chats.items():
            if c["turns"] == 0:
                continue
            units = [(f"answer-{i} — ask", "understand", "done" if i < c["turns"] or c["status"] in ("awaiting_human", "executing", "cancelled") and c.get("building", False) or c["status"] == "awaiting_human" else "distributed")
                     for i in range(1, c["turns"] + 1)]
            if c.get("building"):
                units += [("build-1 — trim the name in greet()", "build", "distributed" if c["status"] == "executing" else "pending"),
                          ("review — review", "review", "pending")]
            r = _session_run(c["run_id"], c["status"] or "executing", c["first_text"], cid, c["started_s"], None, units)
            r["session"]["clis"] = list(c["eligible"])
            # crew#863 (studio#588): an ask-launched run says so, and says when it waits at its TURN
            # gate — awaiting_human with only answer steps (Continue in Build adds a creator: absent).
            r["session"]["ask_path"] = True
            if c["status"] == "awaiting_human" and not c.get("building"):
                r["session"]["ask_turn"] = True
            for i, u in enumerate(r["units"], start=1):
                u["assigned_cli"] = c["pa"]
                # The engine's unit ords are 1-based (the proof frames: answer-1 is ord 1, the gate and the
                # reply name it so); the ask run's units carry the ords its gates and replies use.
                u["ord"] = i
                u["id"] = f"{c['run_id']}:u{i}"
            out.append(r)
    return out


def ask_team(rid: str):
    with ask_lock:
        for c in ask_chats.values():
            if c["run_id"] != rid:
                continue
            rows = json.loads(json.dumps(c["rows"]))
            run_rows = [r for r in rows if r["payload"].get("ord") is None]
            by_ord: dict = {}
            for r in rows:
                o = r["payload"].get("ord")
                if o is not None:
                    by_ord.setdefault(o, []).append(r)
            return {"runId": rid, "teamed": True, "transport": "bus", "reason": None, "streamFloor": None, "pending": None,
                    "planRev": 1, "ended": False, "rows": run_rows,
                    "units": [{"ord": o, "transport": "bus", "reason": None, "rows": rs} for o, rs in sorted(by_ord.items())]}
    return None


def _ask_emit(chat_id: str, row: dict) -> None:
    """A team row: kept for GET /runs/:id/team AND relayed as crew's `teamEvent` frame."""
    with ask_lock:
        ask_chats[chat_id]["rows"].append(row)
    broadcast_chat({"type": "teamEvent", "event": row})


def ask_gate(rid: str):
    """GET /runs/:id/gate for an ask run (the daemon's cached open gate, no kind): the turn gate while it
    waits at the plan's end — the engine's own prompt — or the plan gate while a build proposal is open."""
    with ask_lock:
        for c in ask_chats.values():
            if c["run_id"] != rid or c["status"] != "awaiting_human":
                continue
            n = c["turns"]
            if c.get("proposal_open"):
                return {"runId": rid, "ord": n + 1, "lifecycle": "open", "receivedAt": iso(int(time.time() * 1000)),
                        "prompt": f"Approve plan rev {c.get('plan_rev', 1) + 1} before unit {n + 1} runs: build-1 → review. The plan adds the first creator step."}
            return {"runId": rid, "ord": n, "lifecycle": "open", "receivedAt": iso(int(time.time() * 1000)),
                    "prompt": f"Approve completion after the final phase (unit {n}): answer-{n} — {c['first_text']}"}
    return None
def ask_gate_answer(rid: str, body: dict):
    """POST /runs/:id/gate on an ask path's open plan gate (§4.7): Continue (approve) accepts rev 2 and the
    build step claims; Not now (approve with the accepted rev's steps) accepts a rev identical to rev 1 and the
    turn gate reopens; End (reject) cancels the path. `None` when the run is not an ask path with its
    proposal open."""
    with ask_lock:
        hit = next(((cid, c) for cid, c in ask_chats.items() if c["run_id"] == rid and c.get("proposal_open")), None)
        if hit is None:
            return None
        chat_id, c = hit
        c["proposal_open"] = False
        pa, n = c["pa"], c["turns"]
        pid, gid, rev = c.get("proposal_id", "p-ask-build-1"), c.get("gate_id", f"g-{rid}-plan-2"), c.get("plan_rev", 1)
        c["plan_rev"] = rev + 1
    t = int(time.time() * 1000)
    approve = body.get("approve") is True
    plan = body.get("plan") if isinstance(body.get("plan"), dict) else None
    broadcast_chat({"type": "gateDecided", "session": rid, "ord": n + 1, "allow": approve})
    if not approve:
        _ask_emit(chat_id, _ask_row(rid, "gate.decided", t, gate_id=gid, kind="plan_approval", decision="human_rejected", combined=False, team_pause=False, unresolved=[]))
        _ask_emit(chat_id, _ask_row(rid, "path.ended", t + 1, status="cancelled"))
        with ask_lock:
            c["status"] = "cancelled"
        broadcast_chat({"type": "runCancelled", "session": rid})
        return "cancelled"
    if plan is not None and not any(s.get("catalog") == "build" for s in plan.get("steps", [])):
        # Not now: the accepted rev re-approved — identical steps, the creator proposal dropped.
        # Not now: the SUBMITTED steps (the accepted rev's) are accepted as rev n+1 — identical steps, the
        # creator proposal dropped, the floor the accepted rev's (empty, band 0-19).
        _ask_emit(chat_id, _ask_row(rid, "gate.decided", t, gate_id=gid, kind="plan_approval", decision="human_amended", combined=False, team_pause=False, unresolved=[]))
        _ask_emit(chat_id, _ask_row(rid, "plan.accepted", t + 1, plan_rev=rev + 1, workflow_id=f"{rid}:plan-{rev + 1}", band="0-19", high_risk=False, mode="auto",
                                    steps=[{"added_by": "plan", "catalog": s.get("catalog"), "id": s.get("id")} for s in plan.get("steps", [])], override=None, proposal_id=None, touch=[]))
        with ask_lock:
            c["status"] = "awaiting_human"
        broadcast_chat({"type": "awaitingHuman", "session": rid, "ord": n, "gateKind": "terminal", "prompt": f"Approve completion after the final phase (unit {n}): answer-{n} — ask"})
        return "not_now"
    # Continue in Build: rev 2 accepted with the creator step and the floor's review; build claims on the PA's seat.
    _ask_emit(chat_id, _ask_row(rid, "gate.decided", t, gate_id=gid, kind="plan_approval", decision="human_approved", combined=False, team_pause=False, unresolved=[]))
    _ask_emit(chat_id, _ask_row(rid, "plan.accepted", t + 1, plan_rev=rev + 1, workflow_id=f"{rid}:plan-{rev + 1}", band="20-39", high_risk=False, mode="auto",
                                steps=[{"added_by": "plan", "catalog": "understand", "id": f"answer-{i}"} for i in range(1, n + 1)]
                                + [{"added_by": "plan", "catalog": "build", "id": "build-1"},
                                   {"added_by": "floor", "catalog": "review", "id": "review", "floor_reason": "band 20+ always reviews"}],
                                override=None, proposal_id=pid, touch=["src/greet.js", "test/greet.test.js"], touch_source="pa_scope"))
    _ask_emit(chat_id, _ask_row(rid, "step.claimed", t + 2, ord=n + 1, attempt=0, by=pa, step_id="build-1", role="creator", kind="agent", phase="build",
                                criterion="the tree changed", baseline_tree="70c9a656", repo=None, code_graph_db=None))
    with ask_lock:
        c["status"] = "executing"
        c["building"] = True
    broadcast_chat({"type": "resumed", "session": rid, "ord": n + 1})
    broadcast_chat({"type": "unitExecuting", "session": rid, "ord": n + 1})
    return "continue"


def ask_message(chat_id: str, text: str):
    """POST /chats/:id/messages under ask_path → crew's 202, then the turn's frames on a timer."""
    with state_lock:
        one_seat = state["ask_one_seat"]
    with ask_lock:
        c = ask_chats[chat_id]
        if c["status"] == "executing":
            return 409, {"error": "turn_in_flight: the previous turn has no reply yet", "code": "turn_in_flight"}
        c["turns"] += 1
        n = c["turns"]
        if n == 1:
            c["first_text"] = text.split("\n\n---\n")[0]
            c["started_s"] = int(time.time())
            c["pa"] = c["primary"] or c["eligible"][0]
        c["status"] = "executing"
        turn_id = f"t-ask-{n}"
        now = int(time.time() * 1000)
        c["messages"].append({"at": now, "turnId": turn_id, "kind": "user", "seats": [c["pa"]], "text": text})
        run_id, pa, eligible = c["run_id"], c["pa"], list(c["eligible"])
        ask_posts.append({"chatId": chat_id, "text": text, "turn": n})
    reviewer = next((k for k in eligible if k != pa), None)
    if one_seat:
        reviewer = None
    ord_ = n
    # "Build this…" and Bring it back's own words ("Go ahead with the plan you proposed.") make the PA propose.
    lowered = text.strip().lower()
    build_this = lowered.startswith("build this") or lowered.startswith("go ahead with the plan")

    def play() -> None:
        t = int(time.time() * 1000)
        time.sleep(0.3)
        if n == 1:
            step = {"catalog": "understand", "id": "answer-1", "gate": {"human_confirm": {"unconditional": True}},
                    "budget_secs": 600, "instructions": text.split("\n\n---\n")[0]}
            _ask_emit(chat_id, _ask_row(run_id, "path.started", t, cli=pa, selection="chosen" if ask_chats[chat_id]["primary"] else "random",
                                        roster=eligible, request=text, workflow=None, plan=True))
            _ask_emit(chat_id, _ask_row(run_id, "plan.proposed", t + 1, by="human", proposal_id="p-ask-1", base_rev=None, kind="initial",
                                        preset=None, steps=[step], monitors={"asked": 1}, asks=[], touch=[], override=None, rationale=""))
            _ask_emit(chat_id, _ask_row(run_id, "path.scored", t + 2, basis="intent", score=0, deterministic=0,
                                        reasons=["no creator step and no declared scope"], model=None, score_source="intent:p-ask-1",
                                        signals=None, plan={"depth": "none", "monitors": 0, "post_hoc_reviewer": False, "post_hoc_other_cli": False}, tree=None))
            _ask_emit(chat_id, _ask_row(run_id, "plan.accepted", t + 3, plan_rev=1, workflow_id=f"{run_id}:plan-1", band="0-19", high_risk=False,
                                        mode="auto", steps=[dict(step, added_by="plan")], override=None, proposal_id="p-ask-1", touch=[]))
        if n >= 2:
            # The next message is a new answer step: crew's propose_plan(answer-N) + the turn gate's Approve →
            # the accepted rev grows by that step (T2 §8.6; ASK-K2a) — what Not now re-approves later.
            with ask_lock:
                rev_n = ask_chats[chat_id].get("plan_rev", 1) + 1
                ask_chats[chat_id]["plan_rev"] = rev_n
            step_n = {"catalog": "understand", "id": f"answer-{n}", "gate": {"human_confirm": {"unconditional": True}}, "budget_secs": 600,
                      "instructions": text.split("\n\n---\n")[0]}
            _ask_emit(chat_id, _ask_row(run_id, "plan.proposed", t + 4, by="human", proposal_id=f"p-ask-{n}", base_rev=rev_n - 1, kind="change",
                                        preset=None, steps=[step_n], monitors={"asked": 1}, asks=[], touch=[], override=None, rationale=""))
            _ask_emit(chat_id, _ask_row(run_id, "plan.accepted", t + 5, plan_rev=rev_n, workflow_id=f"{run_id}:plan-{rev_n}", band="0-19", high_risk=False,
                                        mode="auto", steps=[{"added_by": "plan", "catalog": "understand", "id": f"answer-{i}"} for i in range(1, n + 1)],
                                        override=None, proposal_id=f"p-ask-{n}", touch=[]))
        _ask_emit(chat_id, _ask_row(run_id, "step.claimed", t + 10, ord=ord_, attempt=0, by=pa, step_id=f"answer-{n}", role="creator", kind="agent",
                                    phase="understand", criterion="", baseline_tree=None, repo=None, code_graph_db=None))
        if n == 1:
            if reviewer is not None:
                _ask_emit(chat_id, _ask_row(run_id, "member.joined", t + 20, ord=ord_, attempt=0, by=reviewer, member_id="m1", open_seq=1,
                                            seat=reviewer, role="monitor", status="attached", reason="team plan monitors=1", error=None))
                with ask_lock:
                    ask_chats[chat_id]["reviewer"] = reviewer
            else:
                _ask_emit(chat_id, _ask_row(run_id, "member.joined", t + 20, ord=ord_, attempt=0, by="engine", member_id="m1", open_seq=1,
                                            seat=None, role="monitor", status="failed", reason="team plan monitors=1",
                                            error="no seat distinct from the PA"))
        time.sleep(0.6)  # the thread shows "<pa> is thinking" here
        if n >= 2 and reviewer is not None:
            _ask_emit(chat_id, _ask_row(run_id, "help.requested", t + 600, ord=ord_, attempt=0, by=pa, help_id=f"h-{n}", help_seq=1,
                                        question=ASK_HELP_Q, context=""))
            time.sleep(0.3)
            _ask_emit(chat_id, _ask_row(run_id, "help.answered", t + 900, ord=ord_, attempt=0, by=reviewer, help_id=f"h-{n}", answer_id=f"a-{n}",
                                        answer=ASK_HELP_A, evidence=[], outcome="answered", error=None))
            with ask_lock:
                if reviewer not in ask_chats[chat_id]["helpers"]:
                    ask_chats[chat_id]["helpers"].append(reviewer)
        reply = ASK_REPLY_1 if n == 1 else ASK_REPLY_2
        third = max(1, len(reply) // 3)
        for chunk in (reply[:third], reply[third:2 * third]):
            broadcast_chat({"type": "chatDelta", "chat": chat_id, "cliKey": pa, "text": chunk, "turn_id": turn_id})
            time.sleep(0.25)
        t2 = int(time.time() * 1000)
        _ask_emit(chat_id, _ask_row(run_id, "step.completed", t2, ord=ord_, attempt=0, by=pa, step_id=f"answer-{n}", status="ok", tree=None,
                                    output_bytes=len(reply), output_ref=f"unit:{run_id}:{ord_}:0", answers_presented=n >= 2))
        if n == 1 and reviewer is not None:
            _ask_emit(chat_id, _ask_row(run_id, "finding.raised", t2 + 5, ord=ord_, attempt=0, by=reviewer, raise_seq=1, finding_id="f-1",
                                        member_id="m1", line_key=None, anchor=None, anchor_source="none", severity="medium", target="output",
                                        path=f"answer-{n}", line=1, evidence="greet.js:2 is the template literal; the signature is line 1",
                                        claim="the cited line is the signature, not the template", suggestion="cite greet.js:2 as the body",
                                        tree="", in_diff=False, corroborated_by=[]))
        _ask_emit(chat_id, _ask_row(run_id, "ledger.folded", t2 + 10, ord=ord_, attempt=0, final_pass="completed",
                                    ledger={"finalPass": "completed", "findings": [], "monitors": ([{"monitorId": "m1", "seat": reviewer, "status": "completed", "batches": 1, "error": None}] if reviewer else []),
                                            "rejected": {}, "renderedToJudge": False, "teamPause": False},
                                    transport="bus", transcript={"from_event_id": 0, "to_event_id": 0, "count": 0, "truncated": False, "events": []}))
        if one_seat and n == 1:
            _ask_emit(chat_id, _ask_row(run_id, "plan.refused", t2 + 12, by="engine", proposal_id="p-ask-2", base_rev=1,
                                        reason="NoEligibleSeat: no seat distinct from the creator seat"))
        with ask_lock:
            ask_chats[chat_id]["messages"].append({"at": t2 + 20, "turnId": turn_id, "kind": "seat", "cliKey": pa, "ok": True, "usage": None, "text": reply})
            ask_chats[chat_id]["status"] = "awaiting_human"  # the turn gate: the next message is the answer
        broadcast_chat({"type": "chatReply", "chat": chat_id, "cliKey": pa, "text": reply, "ok": True, "run_id": run_id, "ord": ord_, "turn_id": turn_id})
        if build_this:
            # ASK-S2 (§4.7): the PA proposes the work — a `change` adding the first creator step. The engine
            # refuses it on a roster with no distinct seat (`NoEligibleSeat`, D1) and on a path with no repo
            # bound (`no repo bound`, F11) — `plan.refused`, the run keeps its accepted rev, the turn gate
            # reopens. Otherwise: scored on its declared touch, the floor's review added, the crossing-into-work
            # approval row (K2b); the operator answers the plan gate in the thread (Continue / Not now / End).
            # Every proposal is its own row set: fresh proposal_id / gate_id / plan_rev.
            time.sleep(0.3)
            t3 = int(time.time() * 1000)
            with ask_lock:
                scope_now = ask_chats[chat_id].get("scope") or {}
                repo_bound = bool(scope_now.get("repos")) and scope_now.get("kind") in ("repos", "project", "repo")
                refused = ("NoEligibleSeat: no seat distinct from the creator seat " + pa) if reviewer is None \
                    else (None if repo_bound else "no repo bound: this path has no repository to build in")
            if refused is not None:
                # On a one-seat roster the first turn already said it (the PA's own proposal was refused above);
                # a later turn, or a repo-less path, says it here — once.
                if not (reviewer is None and n == 1):
                    _ask_emit(chat_id, _ask_row(run_id, "plan.proposed", t3, by=pa, proposal_id=f"p-ask-build-refused-{n}", base_rev=ask_chats[chat_id].get("plan_rev", 1), kind="change", preset=None,
                                                steps=[{"catalog": "build", "id": "build-1", "instructions": "trim the name in greet()"}], monitors={"asked": 1},
                                                asks=[], touch=["src/greet.js"], override=None, rationale="one-line fix"))
                    _ask_emit(chat_id, _ask_row(run_id, "plan.refused", t3 + 1, by="engine", proposal_id=f"p-ask-build-refused-{n}", base_rev=ask_chats[chat_id].get("plan_rev", 1), reason=refused))
                with ask_lock:
                    ask_chats[chat_id]["status"] = "awaiting_human"
                broadcast_chat({"type": "awaitingHuman", "session": run_id, "ord": ord_, "gateKind": "terminal",
                                "prompt": f"Approve completion after the final phase (unit {ord_}): answer-{n} — ask"})
                return
            with ask_lock:
                ask_chats[chat_id]["proposals"] = ask_chats[chat_id].get("proposals", 0) + 1
                k = ask_chats[chat_id]["proposals"]
                rev = ask_chats[chat_id].get("plan_rev", 1)
                ask_chats[chat_id]["proposal_id"] = f"p-ask-build-{k}"
                ask_chats[chat_id]["gate_id"] = f"g-{run_id}-plan-{rev + 1}"
            pid, gid = f"p-ask-build-{k}", f"g-{run_id}-plan-{rev + 1}"
            _ask_emit(chat_id, _ask_row(run_id, "plan.proposed", t3, by=pa, proposal_id=pid, base_rev=rev, kind="change", preset=None,
                                        steps=[{"catalog": "build", "id": "build-1", "instructions": "trim the name in greet()"}], monitors={"asked": 1},
                                        asks=[], touch=["src/greet.js", "test/greet.test.js"], override=None, rationale="one-line fix, one test"))
            _ask_emit(chat_id, _ask_row(run_id, "path.scored", t3 + 1, basis="intent", score=25, deterministic=25, reasons=["2 files, 12 dependents"],
                                        model=None, score_source=f"intent:{pid}",
                                        signals={"changed_symbols": 1, "dependents": 12, "products": 1, "contract_change": False, "test_gap": 0, "critical": False, "destructive": False, "truncated": False},
                                        plan={"depth": "build", "monitors": 1, "post_hoc_reviewer": True, "post_hoc_other_cli": False}, tree=None))
            _ask_emit(chat_id, _ask_row(run_id, "plan.revised", t3 + 2, plan_rev=rev + 1, proposal_id=pid, reason="floor_raised", from_band="0-19", to_band="20-39",
                                        high_risk=False, added=[{"catalog": "review", "id": "review", "added_by": "floor", "floor_reason": "band 20+ always reviews"}]))
            _ask_emit(chat_id, _ask_row(run_id, "gate.opened", t3 + 3, gate_id=gid, kind="plan_approval", reviewing_ord=ord_, plan_rev=rev + 1,
                                        band="20-39", high_risk=False, mode="auto", reason="first_creator", diff={"from_rev": rev, "added": ["build-1", "review"]}))
            with ask_lock:
                ask_chats[chat_id]["proposal_open"] = True
            broadcast_chat({"type": "awaitingHuman", "session": run_id, "ord": ord_ + 1, "gateKind": "plan_approval",
                            "prompt": f"Approve plan rev {rev + 1} before unit {ord_ + 1} runs: build-1 → review. The plan adds the first creator step."})
            return
        # The engine's TURN gate (the answer step's unconditional HumanConfirm at the plan's end): the real
        # daemon's awaitingHuman frame — studio must draw no gate for it (§4.8), only the "waiting" session.
        broadcast_chat({"type": "awaitingHuman", "session": run_id, "ord": ord_, "gateKind": "terminal",
                        "prompt": f"Approve completion after the final phase (unit {ord_}): answer-{n} — ask"})

    threading.Thread(target=play, daemon=True).start()
    return 202, {"seats": [pa], "turnId": turn_id, "runId": run_id, "stepId": f"answer-{n}"}



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


def schedule_doc_run(pid: str, doc: str, delay_s: float, fixed_version: int | None = None,
                     heartbeat_message: str | None = None) -> None:
    """Land one version after `delay_s` of FIFO-queued work. `fixed_version`
    re-announces an existing manifest version (the create path, whose v1 is
    committed at POST time); None appends head+1 (a steer send's own landing).
    Wave 5 (F-4R2-005): with `doc_heartbeat_ms` > 0 and a `heartbeat_message`,
    the CURRENT narration is re-emitted every that-many ms until the landing —
    crew's ≤15 s heartbeat, which pre-fix rendered as one identical row each."""
    with doc_sched_lock:
        start = max(time.time(), doc_next_free.get((pid, doc), 0.0))
        fire_at = start + delay_s
        doc_next_free[(pid, doc)] = fire_at
    with state_lock:
        heartbeat_ms = int(state["doc_heartbeat_ms"])
    if heartbeat_message is not None and heartbeat_ms > 0:
        def beat() -> None:
            while time.time() + heartbeat_ms / 1000.0 < fire_at:
                time.sleep(heartbeat_ms / 1000.0)
                queue_interactive("wicked.interactive.status.posted", {
                    "project_id": pid, "document_id": doc, "state": "working",
                    "message": heartbeat_message})
        threading.Thread(target=beat, daemon=True).start()

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


# EP-P3: a page the way interactive renders one — its theme as `--wi-*` custom properties (theme.js
# themeCss) and its parts in `section-{i}` containers with `slide-{i}-{role}-{n}` anchors
# (instrument.js) — so the editor's swatches, "whole section" and widths have something real to act on.
LAUNCH_PAGE = "launch-page"


def launch_page_html(version: int) -> str:
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{LAUNCH_PAGE} v{version}</title>'
            "<style>:root{--wi-bg:#f4f1ea;--wi-surface:#fffdf7;--wi-primary:#1f3a5f;--wi-secondary:#2f6f8f;"
            "--wi-accent:#e4572e;--wi-text:#1b1b1b;--wi-text-secondary:#4a463c;--wi-muted:#8a8471;"
            "--wi-border:#ddd6c4;--wi-card-bg:#fffdf7}"
            "body{margin:0;font-family:Georgia,serif;background:var(--wi-bg);color:var(--wi-text)}"
            "main{max-width:880px;margin:0 auto;padding:28px}section{padding:18px;margin:0 0 14px;"
            "background:var(--wi-surface);border:1px solid var(--wi-border)}"
            "h1{font-size:30px;color:var(--wi-primary);margin:0 0 10px}h2{font-size:20px;color:var(--wi-primary);margin:0 0 8px}"
            "p{font-size:16px;line-height:1.5;color:var(--wi-text-secondary);margin:0 0 8px}"
            ".cols{display:flex;gap:14px}.cols>p{flex:1}"
            "@media (max-width:600px){.cols{flex-direction:column}}</style></head><body><main>"
            '<section data-wid="section-0"><h1 data-wid="slide-0-heading-1">Book a study room in under a minute</h1>'
            '<p data-wid="slide-0-paragraph-1">From your phone, without calling the front desk.</p></section>'
            '<section data-wid="section-1"><h2 data-wid="slide-1-heading-1">How it works</h2><div class="cols">'
            '<p data-wid="slide-1-paragraph-1">Free rooms come first, so nobody scrolls past full ones.</p>'
            '<p data-wid="slide-1-paragraph-2">A booking is held for five minutes while you confirm.</p></div></section>'
            '<section data-wid="section-2"><h2 data-wid="slide-2-heading-1">One fixed fee</h2>'
            '<p data-wid="slide-2-paragraph-1">Support is included, with answers within one working day.</p></section>'
            "</main></body></html>")


def _element_span(html: str, wid: str):
    """(start, end) of the element carrying data-wid="<wid>": its opening tag through its matching close
    (same-name nesting counted), or None. The fixture's pages are regular; this is not a parser."""
    m = re.search(r'<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\bdata-wid="' + re.escape(wid) + r'"[^>]*>', html)
    if m is None:
        return None
    tag = m.group(1).lower()
    depth = 1
    for t in re.finditer(r'<(/?)' + tag + r'\b[^>]*>', html[m.end():], re.I):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return (m.start(), m.end() + t.end(), m.end())
    return None


def apply_style_edit(html: str, wid: str, style: dict) -> str | None:
    """regenerate.js applyStyle: merge the declarations into the element's inline style attribute."""
    span = _element_span(html, wid)
    if span is None:
        return None
    start, _end, open_end = span
    tag = html[start:open_end]
    m = re.search(r'\sstyle="([^"]*)"', tag)
    decls: dict = {}
    if m:
        for d in m.group(1).split(";"):
            if ":" in d:
                k, v = d.split(":", 1)
                decls[k.strip()] = v.strip()
    for k, v in style.items():
        decls[str(k)] = str(v)
    attr = "; ".join(f"{k}: {v}" for k, v in decls.items())
    new_tag = (tag[:m.start()] + f' style="{attr}"' + tag[m.end():]) if m else tag[:-1] + f' style="{attr}">'
    return html[:start] + new_tag + html[open_end:]


def apply_remove(html: str, wid: str) -> str | None:
    """regenerate.js remove: the element and its subtree go."""
    span = _element_span(html, wid)
    return None if span is None else html[:span[0]] + html[span[1]:]


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
    if doc == LAUNCH_PAGE:
        return launch_page_html(version)
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


# S9: a document created with a recorded style renders as what it is, anchored the way the real
# engine anchors (`slide-{slideIndex}-{role}-{ordinal}`, `section-{i}` containers — interactive
# instrument.js). The written document carries one paragraph LONGER than the 400 characters the
# client's bridge used to cut block text at: the engine calls an edit stale unless `before` equals
# the element's whole text, so that paragraph is the one a cut snapshot can never change.
LONG_PARAGRAPH = (
    "Residents book a study room in two taps, and the rooms that are free right now come first, so nobody "
    "scrolls past a list of rooms they cannot have. A booking is held for five minutes while the resident "
    "confirms, a reminder goes out an hour before, and a room that is not claimed within ten minutes of its "
    "start goes back to the list for the next person. Staff can see the whole day for a branch at a glance, "
    "hold a room for a class or an event, and release it again with one tap when plans change (REQ-002).")
assert len(LONG_PARAGRAPH) > 400


def styled_doc_html(style: str, doc: str) -> str:
    if style == "ppt":
        slides = [
            ("Library room booking", "A study room in two taps."),
            ("Residents first", "Free rooms come first; nobody scrolls past full ones."),
            ("Staff stay in control", "The whole day at a glance, per branch."),
            ("The pilot", "Central branch, eight weeks, then every branch."),
        ]
        body = "".join(
            f'<section class="wi-slide" data-wid="section-{i}"><h1 data-wid="slide-{i}-heading-1">{h}</h1>'
            f'<p data-wid="slide-{i}-paragraph-1">{p}</p></section>'
            for i, (h, p) in enumerate(slides))
        return (f'<!doctype html><html><head><meta charset="utf-8"><title>{doc} v1</title>'
                "<style>body{margin:0;font-family:Georgia,serif;background:#f4f1ea;color:#1b1b1b}"
                ".wi-slide{width:min(86vw,880px);min-height:340px;margin:24px auto;padding:40px;box-sizing:border-box;"
                "background:#fffdf7;border:1px solid #ddd6c4}h1{font-size:32px;margin:0 0 14px}"
                # The last slide is short: it cannot be scrolled to the middle of the frame, so at the
                # bottom "the slide in view" is the one before it — the case a pick must outrank.
                ".wi-slide:last-of-type{min-height:0}"
                "p{font-size:17px;color:#4a463c;margin:0}</style></head>"
                f'<body data-wi-kind="deck">{body}</body></html>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{doc} v1</title>'
            "<style>body{margin:0;font-family:Georgia,serif;background:#f4f1ea;color:#1b1b1b}"
            "main{max-width:720px;margin:32px auto;padding:48px;background:#fffdf7;border:1px solid #ddd6c4}"
            "h1{font-size:30px;margin:0 0 18px}h2{font-size:20px;margin:20px 0 8px}section{padding:8px 0}"
            "p{font-size:16px;line-height:1.5;color:#4a463c;margin:0 0 10px}</style></head><body><main>"
            '<h1 data-wid="slide-0-heading-1">Library room booking — our response</h1>'
            '<section data-wid="section-0"><h2 data-wid="slide-0-heading-2">What we will build</h2>'
            '<p data-wid="slide-0-paragraph-1">One app for residents and one day view for staff (REQ-001).</p>'
            f'<p data-wid="slide-0-paragraph-2">{LONG_PARAGRAPH}</p></section>'
            '<section data-wid="section-1"><h2 data-wid="slide-1-heading-1">What it costs</h2>'
            '<p data-wid="slide-1-paragraph-1">One fixed fee for the build and the first year.</p></section>'
            "</main></body></html>")


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
        text = json.dumps(payload)
        # Read without the lock: callers may already hold it, and a bool read is atomic.
        if state["home_paths"]:
            # home_paths: every fixture path lives under the operator's home directory.
            text = text.replace("/tmp/w2", f"{FAKE_HOME}/w2")
        body = text.encode()
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

    def _considered_route(self, path: str) -> bool:
        """DC-S8 reads on crew's DC-S7 wire: GET /chats/:id/turns/:turnId/considered and
        GET /runs/:id/units/:unitKey/considered (operator+), and GET /governance/rules under
        `steering_rules`. Off: the standing unknown-route 404 (a daemon predating them)."""
        with state_lock:
            on, rules_on = state["decisions"], state["steering_rules"]
        if path == "/api/v1/governance/rules":
            if not rules_on:
                return False
            with state_lock:
                over = dict(steering_rule_overlay)
            rules = [over.pop(r["id"], r) for r in STEERING_RULES] + list(over.values())
            self._json(200, {"rules": json.loads(json.dumps(rules))})
            return True
        m = re.fullmatch(r"/api/v1/chats/([^/]+)/turns/([^/]+)/considered", path)
        if m:
            if not on:
                self._json(404, {"message": f"Route GET:{path} not found", "error": "Not Found", "statusCode": 404})
                return True
            cid, turn = urllib.parse.unquote(m.group(1)), urllib.parse.unquote(m.group(2))
            c = CONSIDERATIONS.get(f"{cid}:{turn}")
            if c is None:
                self._json(404, {"error": f"chat {cid} holds no turn {turn}"})
            else:
                self._json(200, c)
            return True
        m = re.fullmatch(r"/api/v1/runs/([^/]+)/units/([^/]+)/considered", path)
        if m:
            if not on:
                self._json(404, {"message": f"Route GET:{path} not found", "error": "Not Found", "statusCode": 404})
                return True
            rid, key = urllib.parse.unquote(m.group(1)), urllib.parse.unquote(m.group(2))
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            raw = (q.get("attempt") or ["0"])[0] or "0"
            if not raw.isdigit():
                self._json(400, {"error": "`attempt` must be a non-negative integer"})
                return True
            attempt = int(raw)
            c = CONSIDERATIONS.get(f"{rid}:{key}")
            if c is None:
                self._json(404, {"error": f"run {rid} has no unit '{key}'"})
            else:
                # crew computes the Consideration from the unit's persisted output; the attempt labels
                # the subject and the key (`considered:<run>:<ord>:<attempt>`), as crew's forUnit does.
                c = dict(c, subject=dict(c["subject"], attempt=attempt), key=f"considered:{rid}:{c['subject']['ord']}:{attempt}")
                self._json(200, c)
            return True
        return False

    def _api(self, path: str) -> bool:
        if self._considered_route(path):
            return True
        # Behaviour 10: GET /standing-orders. Switch off: fall through to the ideas 7/8/13 handler
        # below (its orders, or the unknown-route 404 of a daemon predating the surface).
        if path == "/api/v1/standing-orders":
            with state_lock:
                on = state["standing_orders"]
                snap = json.loads(json.dumps(STANDING))
            if on:
                self._json(200, snap)
                return True
        if path == "/api/v1/health":
            # The capabilities crew 0.7.40 answers: without them the composer (rightly) warns that
            # the daemon predates the deliver gate (crew < 0.7.33), which no current daemon does.
            caps = {"deliverGate": True, "revisesPr": True, "chatIdOnLaunch": True, "seatChipOnCreate": True}
            with state_lock:
                if state["run_chat_id"]:
                    caps["runChatId"] = True
                if state["ask_path"]:
                    caps["askPath"] = True  # ASK-C1 (api-types 0.92.0)
                if state["sessions"] and state["walkthrough"]:
                    caps["walkthroughRoots"] = True  # WT-W1 (api-types 0.74.0)
            self._json(200, {"status": "ok", "version": "w2-fixture", "ping": "pong", "capabilities": caps})
            return True
        # Idea 15: the delivery freeze switch (crew#694).
        if path == "/api/v1/deliveries/freeze":
            with state_lock:
                on = state["home_runs"]
                snapshot = dict(delivery_freeze)
            if not on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            else:
                self._json(200, snapshot)
            return True
        # Ideas 7+8: the decided-gate history (crew#691) and the standing orders (crew#686); the card
        # reads GET /whoami so only YOUR decisions make the offer (auth off: the `local` actor).
        if path == "/api/v1/whoami":
            with state_lock:
                trust_on = state["trust_rules"]
            if not trust_on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            else:
                self._json(200, {"actor": {"id": "local", "kind": "human", "trust": "admin"}, "authMode": "off"})
            return True
        if path in ("/api/v1/gates/decided", "/api/v1/standing-orders"):
            with state_lock:
                trust_on = state["trust_rules"] or (state["run_page"] and path == "/api/v1/standing-orders")
                orders = json.loads(json.dumps(trust_orders))
            if not trust_on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            elif path == "/api/v1/gates/decided":
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                since = int((q.get("since") or ["0"])[0])
                self._json(200, {"gates": [g for g in TRUST_HISTORY if g["decidedAt"] >= since]})
            else:
                self._json(200, {"away": False, "awaySince": None, "orders": orders, "outbox": []})
            return True
        # The settings store (§3.3): every page boot GETs it for studio.appearance.
        if path == "/api/v1/settings":
            with state_lock:
                snapshot = json.loads(json.dumps(settings_store))
                home_on = state["home_paths"]
                settings_delay = state["settings_delay_ms"]
            if settings_delay:
                time.sleep(settings_delay / 1000)
            # api-types 0.38.0 `SettingsResponse.path` (crew 0.7.36) — only under home_paths, so the
            # standing rigs keep seeing a daemon that predates the field.
            self._json(200, {"settings": snapshot, **({"path": HOME_SETTINGS_PATH} if home_on else {})})
            return True
        # home_paths (studio#460): the skills catalog, rooted under the home directory.
        if path == "/api/v1/skills":
            with state_lock:
                home_on = state["home_paths"]
            if not home_on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            else:
                self._json(200, HOME_SKILLS_CATALOG)
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
                runs_delay = state["runs_delay_ms"]
                runs_fail = state["runs_fail"]
            if runs_delay:
                time.sleep(runs_delay / 1000)
            if runs_fail:
                self._json(500, {"error": "w2 fixture: runs list unavailable"})
                return True
            self._json(200, {"runs": assemble_runs()})
            return True
        # T9: the engine's phase catalog and the presets (crew 0.47.0), switch-gated.
        if path in ("/api/v1/catalog", "/api/v1/presets"):
            with state_lock:
                on = state["team_plan"] or (state["home_runs"] and path == "/api/v1/presets")
            if not on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            elif path == "/api/v1/catalog":
                self._json(200, {"entries": TEAM_CATALOG})
            else:
                self._json(200, {"presets": TEAM_PRESETS})
            return True
        # Wave 6: GET /workflows — the QE workflow the panel reads before it launches (switch-gated:
        # off, the unknown-route 404 standing rigs see; on, the def list with — or, under
        # `governed_testing_workflow_absent`, WITHOUT — `qe-author-tests`).
        if path == "/api/v1/workflows":
            with state_lock:
                gt_on = state["governed_testing"]
                absent = state["governed_testing_workflow_absent"]
            if not gt_on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            else:
                self._json(200, {"workflows": GT_WORKFLOWS_ELSE + ([] if absent else [GT_WORKFLOW_DEF])})
            return True
        # Wave 6: GET /campaigns — the completed New test's label group beside its registered set as
        # the TOP-LEVEL `test_sets` (api-types 0.36.0, F-7R2-014). Off ⇒ the standing unknown-route
        # 404 (the landing's "unsupported" state).
        if path == "/api/v1/campaigns":
            with state_lock:
                gt_on = state["governed_testing"]
            if not gt_on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            else:
                self._json(200, {"campaigns": [], "groups": [GT_GROUP],
                                 "test_sets": [GT_TEST_SET, GT_TEST_SET_MALFORMED]})
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
            # Wave 2b: the handover's trail — `?since=` (crew#677, unix millis, inclusive).
            with state_lock:
                wave2b_on = state["wave2b"]
                many_on = state["handover_many"]
                audit_delay = state["audit_delay_ms"]
            if audit_delay:
                time.sleep(audit_delay / 1000)
            if wave2b_on:
                with state_lock:
                    trail = WAVE2B_AUDIT + list(STANDING_AUDIT) + (HANDOVER_MANY_AUDIT if many_on else [])
                entries = [e for e in trail if not run_id or e.get("runId") == run_id]
            since = (q.get("since") or [""])[0]
            if since:
                entries = [e for e in entries if e.get("ts", 0) >= int(since)]
            if action:
                entries = [e for e in entries if e.get("action") == action]
            with state_lock:
                reject_on = state["reject_note"]
            if reject_on and run_id in ("", REJECTED_RUN_ID):
                entries = entries + REJECTED_AUDIT
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
            with state_lock:
                if state["wave1"]:
                    rows = list(WAVE1_PROJECTS)
                if state["trust_rules"] or state["run_page"]:
                    rows = rows + [TRUST_PROJECT]
            # C6 fix: the stale-clock reproduction — upload-endpoint's project
            # clock reads 15 HOURS old while its run executes NOW.
            if c6_on:
                rows = [{**p, "updated_at": NOW0 - 15 * HOUR}
                        if p["id"] == "upload-endpoint" else p for p in rows]
            self._json(200, {"projects": rows})
            return True
        # S9: GET /api/v1/repos/<id>/requirements — crew's RequirementsPage for the repos the
        # `requirements` switch names; any other repo answers 404 (no requirements read).
        m = re.match(r"^/api/v1/repos/([^/]+)/requirements$", path)
        if m:
            rid = urllib.parse.unquote(m.group(1))
            with state_lock:
                served = (state["requirements"] or {}).get(rid)
            if served is None:
                self._json(404, {"error": f"no requirements for {rid}"})
                return True
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            offset = int((qs.get("offset") or ["0"])[0])
            limit = int((qs.get("limit") or ["50"])[0])
            items = [{"key": r["key"], "domain": "booking", "reqId": r["reqId"], "title": r["title"],
                      "category": "functional", "statement": r["title"], "status": "active",
                      "risk": bool(r.get("risk")), "riskSource": "data" if r.get("risk") else None,
                      "edited": False} for r in served]
            self._json(200, {"total": len(items), "corpus": len(items), "offset": offset, "limit": limit,
                             "items": items[offset:offset + limit], "source": "store"})
            return True
        if path == "/api/v1/repos":
            with state_lock:
                repo_on = state["repo"]
                findings_on = state["repo_findings"]
                extra = never_indexed_repos(state["never_indexed"], state["broken_clock"])
            self._json(200, {"repos": ([repo_entry_wire(findings_on)] if repo_on else []) + extra})
            return True
        # Wave 2 (studio#246): GET /diagnostics — ABSENT (the unknown-route 404 a daemon
        # predating the route answers) unless the `governance` switch names a block.
        if path == "/api/v1/diagnostics":
            with state_lock:
                gov = state["governance"]
                sheets_on = state["sheets"]
                home_on = state["home_paths"]
            skills_block = {"skills": HOME_DIAGNOSTICS_SKILLS} if home_on else {}
            if gov is None and (sheets_on or home_on):
                self._json(200, {**DIAGNOSTICS_BASE, **skills_block})  # S11: the Desk sheet's Studio itself / This computer
            elif gov is None:
                self._json(404, {"error": "not found"})
            else:
                self._json(200, {**DIAGNOSTICS_BASE, **skills_block, "governance": GOVERNANCE_BLOCKS[gov]})
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
            with state_lock:
                graph_mode = state["repo_graph"]
            if leaf == "graph" and graph_mode == "fail":
                self._json(502, {"error": "code graph unavailable (fixture)"})
            elif leaf == "graph" and graph_mode == "docs":
                self._json(200, {"graph": {"nodes": [], "edges": [],
                                           "stats": {"nodeCount": 0, "edgeCount": 0, "fileCount": 0},
                                           "totals": {"nodes": 7, "edges": 5, "files": 2}}})
            elif leaf == "graph":
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
                with state_lock:
                    week = state["seat_week"]
                    home_login = state["home_paths"]
                    signed_over = dict(state["roster_signed_in"])
                    lines_over = dict(state["roster_login_lines"])
                # studio#467: under home_paths the sign-in line names the worker home by its absolute path.
                login = 'PI_CONFIG_DIR="/tmp/w2/.wicked-worker/pi" pi login' if home_login else "pi login"
                roster = ([{**s, "login_invocation": login} if s["key"] == "pi" else s for s in ROSTER]
                          if week else ROSTER)
                # Amendment 5 (desk_signin): a journey's sign-in states and login lines, laid over.
                roster = [{**s,
                           **({"signed_in": signed_over[s["key"]], "auth": "signed_in" if signed_over[s["key"]] else "signed_out"}
                              if s["key"] in signed_over else {}),
                           **({"login_invocation": lines_over[s["key"]]} if s["key"] in lines_over else {})}
                          for s in roster]
                self._json(200, {"roster": roster})
            return True
        if path == "/api/v1/roster/record":
            with state_lock:
                week = state["seat_week"]
            if week:
                self._json(200, seat_week_record())
            else:
                self._json(404, {"message": f"Route GET:{path} not found", "error": "Not Found", "statusCode": 404})
            return True
        # Slice J (§5.2): the decisions corpus — read on the search GESTURE only.
        if path == "/api/v1/governance/claims":
            self._json(200, {"claims": GOVERNANCE_CLAIMS})
            return True
        # GET /api/v1/proposals — the governed-knowledge review queue (switch-gated: None ⇒ the
        # unknown-route 404 every standing rig sees).
        if path == "/api/v1/proposals":
            with state_lock:
                rows = state["proposals"]
                decisions_on = state["decisions"]
            if decisions_on:
                with decisions_lock:
                    rows = list(rows or []) + [decision_proposal_row()]
            if rows is None:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            else:
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                want = (q.get("state") or [""])[0]
                self._json(200, {"proposals": [r for r in rows if not want or r.get("state") == want]})
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
        # TR-W8: GET /api/v1/watch — the registry's feed page (watch_feed switch).
        if path == "/api/v1/watch":
            with state_lock:
                watch_on = state["watch_feed"]
            if not watch_on:
                self._json(404, {"message": f"Route GET:{path} not found", "error": "Not Found", "statusCode": 404})
                return True
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            run = (q.get("run") or [None])[0]
            body = {"findings": [r for r in WATCH_FINDINGS if run is None or r["run_id"] == run],
                    "cleared": [c for c in WATCH_CLEARED_ROWS if run is None or c["run_id"] == run]}
            if run is not None:
                body["coverage"] = WATCH_COVERAGE if run == "b1" else []
            self._json(200, body)
            return True
        # /api/v1/chats/<id> — seats of a chat, the POOL truth (crew's
        # `chatSeats`): the live seats of a chat this server opened, EMPTY for
        # one it never did (the daemon does not 404 an unknown id; empty means
        # reclaimed/none). Fix slice J4 reads this as the rejoin probe.
        if path.startswith("/api/v1/chats/") and len(path.split("/")) == 5:
            cid = urllib.parse.unquote(path.split("/")[4])
            with state_lock:
                sessions_on = state["sessions"]
                ask_on = state["ask_path"]
            if ask_on:
                detail = ask_chat_detail(cid)
                if detail is not None:
                    self._json(200, detail)
                    return True
            if sessions_on and cid in SESSION_CHATS:
                detail = SESSION_CHATS[cid]
                with state_lock:
                    home_pack = state["home_paths"]
                if home_pack and cid == "chat-pay":
                    # studio#468: Ask's context pack rides the first message and is stored with it.
                    first = dict(detail["messages"][0], text=detail["messages"][0]["text"] + HOME_ASK_PACK)
                    detail = dict(detail, messages=[first] + list(detail["messages"][1:]))
                with state_lock:
                    decisions_on = state["decisions"]
                if decisions_on and cid == "chat-pay":
                    with decisions_lock:
                        detail = dict(detail, messages=list(detail["messages"]) + decision_turns())
                self._json(200, detail)
                return True
            with chat_state_lock:
                seats = [k for k in chat_warm_seats.get(cid, [])
                         if k not in chat_dead_seats.get(cid, set())]
                scope = chat_scopes.get(cid)
            with state_lock:
                scope_on = state["chat_scope"]
            detail = {"chatId": cid, "seats": seats}
            if scope_on:
                detail["scope"] = scope  # None = a chat this daemon did not open (crew#502)
            self._json(200, detail)
            return True
        parts = path.split("/")
        # /api/v1/projects/<id>/members
        if len(parts) == 6 and parts[3] == "projects" and parts[5] == "members":
            pid = urllib.parse.unquote(parts[4])
            with state_lock:
                wave1_on = state["wave1"]
                wave2b_on = state["wave2b"]
                many_on = state["handover_many"]
            if wave1_on:
                refs = list(WAVE1_MEMBERS.get(pid, [])) \
                    + (WAVE2B_MEMBERS.get(pid, []) if wave2b_on else []) \
                    + (HANDOVER_MANY_MEMBERS.get(pid, []) if wave2b_on and many_on else [])
                clocks = {**WAVE1_ATTACHED_AT, **WAVE2B_ATTACHED_AT, **HANDOVER_MANY_ATTACHED_AT}
                self._json(200, {"members": [
                    {"id": f"{pid}:crew.run:{ref}", "project_id": pid,
                     "member_kind": "crew.run", "member_ref": ref, "meta": None,
                     "attached_at": clocks[ref], "attached_by": "studio"}
                    for ref in refs]})
                return True
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
            # T9: the team corpus files under upload-endpoint.
            with state_lock:
                if state["team_plan"] and pid == "upload-endpoint":
                    refs.extend(TEAM_MEMBER_REFS)
            # Slice S: runs launched this lifetime — the atomic attach means the
            # membership record and the DTO echo agree from the first read.
            with state_lock:
                refs.extend(launched_members.get(pid, []))
            # Slice P: the live chat thread is a `crew.chat` member of notes.
            kinds = {}
            if chat_runs_on and pid == "notes":
                refs.append("r-chat-live")
                kinds["r-chat-live"] = "crew.chat"
            # Slice J (§10.2): upload-endpoint's bound repo, a `crew.repo` member. Wave 6 lights it
            # too, so the governed rig can pick the project and see one DROPPABLE chip (F-9).
            with state_lock:
                gt_member_on = state["governed_testing"]
            if (repo_member_on or gt_member_on) and pid == "upload-endpoint":
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
                    {"name": doc, "kind": "doc",
                     # The real bridge's row: `style` only when one was recorded (server.js listDocs).
                     **({"style": doc_styles[(pid, doc)]} if (pid, doc) in doc_styles else {}),
                     "head": max(e["version"] for e in vs),
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
        # Dogfood D10/D11: GET /api/v1/runs/<id>/team — the plan gate's rows (plan_gate switch).
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "team":
            rid = urllib.parse.unquote(parts[4])
            with state_lock:
                on = state["plan_gate"]
                sessions_on = state["sessions"]
            with state_lock:
                proposals_on = state["ship_proposals"]
                reel_on = state["reel_runs"]
                walk_on = state["walkthrough"]
                ask_on = state["ask_path"]
            if ask_on and ask_team(rid) is not None:
                self._json(200, ask_team(rid))
            elif sessions_on and walk_on and walk_team(rid) is not None:
                self._json(200, walk_team(rid))
            elif sessions_on and reel_on and reel_team(rid) is not None:
                time.sleep(REEL_TEAM_DELAY_S)  # the session paints from its units first (studio#440)
                self._json(200, reel_team(rid))
            elif sessions_on and proposals_on and proposal_team(rid) is not None:
                self._json(200, proposal_team(rid))
            elif sessions_on and session_team(rid) is not None:
                self._json(200, session_team(rid))
            elif on and rid == "r-plan-gate":
                self._json(200, PLAN_GATE_TEAM)
            elif state["floor_plan"] and rid == "r-floor":
                self._json(200, FLOOR_TEAM)
            else:
                self._json(404, {"error": f"w2 fixture: no team state for {rid}"})
            return True
        # /api/v1/runs/<id>/gate
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "gate":
            rid = urllib.parse.unquote(parts[4])
            with state_lock:
                ask_on = state["ask_path"]
            if ask_on and ask_gate(rid) is not None:
                self._json(200, ask_gate(rid))
                return True
            with state_lock:
                plan_gate_on = state["plan_gate"]
                proposals_open = state["sessions"] and state["ship_proposals"]
            with state_lock:
                reel_open = state["sessions"] and state["reel_runs"]
            with state_lock:
                floor_gate = state["floor_plan"] and rid == "r-floor"
            if floor_gate:
                self._json(200, {"runId": rid, "ord": 1, "lifecycle": "open", "prompt": FLOOR_PROMPT,
                                 "receivedAt": iso(NOW0), "gateKind": "plan_approval"})
                return True
            with state_lock:
                home_gate = state["home_paths"] and rid == "r-home-gate"
            if home_gate:
                self._json(200, {"runId": rid, "ord": 1, "lifecycle": "open", "prompt": HOME_GATE_PROMPT,
                                 "receivedAt": iso(HOME_T0 + 1000), "gateKind": "def"})
                return True
            with state_lock:
                seat_gate = state["seat_escalation"] and rid == "r-seat"
            if seat_gate:
                self._json(200, {"runId": rid, "ord": 1, "lifecycle": "open", "prompt": SEAT_PROMPT,
                                 "receivedAt": iso(NOW0 - 60_000), "gateKind": "escalation"})
                return True
            with state_lock:
                retry_gate = state["retry_gate"] and rid == "r-retry"
            if retry_gate:
                self._json(200, {"runId": rid, "ord": 2, "lifecycle": "open", "prompt": RETRY_PROMPT,
                                 "receivedAt": iso(RETRY_T0 + 61_000)})
                return True
            if reel_open and rid in REEL_GATES:
                g_ord, g_prompt = REEL_GATES[rid]
                self._json(200, {"runId": rid, "ord": g_ord, "lifecycle": "open", "prompt": g_prompt,
                                 "receivedAt": iso((SESSION_T0 + 3900) * 1000)})
                return True
            if proposals_open and rid in PROPOSAL_GATES:
                g_ord, g_prompt = PROPOSAL_GATES[rid]
                self._json(200, {"runId": rid, "ord": g_ord, "lifecycle": "open", "prompt": g_prompt,
                                 "receivedAt": iso((SESSION_T0 + 3400) * 1000)})
                return True
            with state_lock:
                gate_move_on = state["gate_move"]
            if rid == "r-review" and gate_move_on:
                self._json(200, {"runId": rid, "ord": 2, "lifecycle": "open", "prompt": GATE_MOVE_PROMPT,
                                 "receivedAt": iso(GATE_MOVE_T0 + 9 * MIN + SEC), "options": None})
                return True
            with state_lock:
                esc_on = state["escalation_arms"]
            if esc_on and rid in ESC_GATES:
                g_ord, g_prompt = ESC_GATES[rid]
                self._json(200, {"runId": rid, "ord": g_ord, "lifecycle": "open", "prompt": g_prompt,
                                 "receivedAt": iso(ESC_T0 + 12 * MIN + SEC), "options": None})
                return True
            with state_lock:
                trust_on = state["trust_rules"]
            with state_lock:
                run_page_on = state["run_page"]
            if run_page_on and rid == "r-rerun":
                self._json(200, {"runId": rid, "ord": 3, "lifecycle": "open", "prompt": RUN_PAGE_PROMPT,
                                 "receivedAt": iso(RUN_PAGE_T0 + 31 * MIN + 2 * SEC), "options": None})
                return True
            if trust_on and rid in TRUST_GATES:
                self._json(200, {"runId": rid, "ord": TRUST_GATES[rid][0], "lifecycle": "open",
                                 "prompt": TRUST_GATES[rid][2], "receivedAt": iso(TRUST_T0 + 5 * MIN + SEC),
                                 "options": None})
                return True
            if rid == "r-plan-gate" and plan_gate_on:
                self._json(200, {"runId": rid, "ord": 2, "lifecycle": "open", "prompt": PLAN_GATE_PROMPT,
                                 "receivedAt": iso(NOW0), "options": None})
                return True
            if rid == "r-q3":
                with state_lock:
                    age = state["q3_gate_age_ms"]
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": "Approve the deck outline?",
                                 "receivedAt": iso(NOW0 - age)})
            elif rid == "r-api" and state["wire433"]:
                # wicked-core#431: the escalated mutation gate on unit 4 with the
                # engine's NEW prompt (the restored-tree wording); `options: null`
                # keeps it the COMPLEX shape, answered in the thread.
                self._json(200, {"runId": rid, "ord": 4, "lifecycle": "open",
                                 "prompt": WIRE433_RESTORED_PROMPT,
                                 "receivedAt": iso(NOW0 - 2 * MIN), "options": None})
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
            elif rid in state["simple_gates"] and rid in WAVE2B_GATES:
                # Wave 2b: a SIMPLE cached gate (no options — the approve/reject pair).
                prompt, age = WAVE2B_GATES[rid]
                self._json(200, {"runId": rid, "ord": 0, "lifecycle": "open",
                                 "prompt": prompt, "receivedAt": iso(NOW0 - age)})
            elif rid in state["gate_now"] and rid in state["gate_simple"]:
                # Wave 2a: the SIMPLE shape (no `options` key) — answered in place.
                self._json(200, {"runId": rid, "ord": 3, "lifecycle": "open",
                                 "prompt": GATE_NOW_PROMPT, "receivedAt": iso(NOW0)})
            elif rid in state["gate_now"]:
                # Slice BD: the arrived gate for an annotated run — `options:
                # null` = free text, the COMPLEX shape (§7.11): a steer-worthy
                # gate answered in the thread, where pre-population lives.
                self._json(200, {"runId": rid, "ord": 3, "lifecycle": "open",
                                 "prompt": GATE_NOW_PROMPT,
                                 "receivedAt": iso(NOW0), "options": None})
            elif rid == "r-team-gate" and state["team_plan"]:
                # T9: the gate a decision is made on (ord 3), or — once the gate moved — the one
                # that replaced it (ord 4). Complex shape: answered on the run page's card.
                moved = rid in gate_moved_done
                self._json(200, {"runId": rid, "ord": 4 if moved else 3, "lifecycle": "open",
                                 "prompt": TEAM_GATE_MOVED_PROMPT if moved else TEAM_GATE_PROMPT,
                                 "receivedAt": iso(NOW0), "options": None})
            elif any(r["session"]["id"] == rid for r in gt_launched):
                # Wave 6: every New test launched this lifetime pauses at its intake gate
                # (`before:1`) — the cached record a page load reconciles against.
                self._json(200, {"runId": rid, "ord": 1, "lifecycle": "open",
                                 "prompt": GT_INTAKE_PROMPT, "receivedAt": iso(NOW0), "options": None})
            else:
                self._json(404, {"error": f"no gate cached for {rid}"})
            return True
        # /api/v1/runs/<id>/deliver-text (crew#524) — text/plain, framed.
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "deliver-text":
            rid = urllib.parse.unquote(parts[4])
            found = next((r for r in assemble_runs() if r["session"]["id"] == rid), None)
            if found is None:
                self._json(404, {"error": "Run not found"})
                return True
            body = wave1_deliver_text(found).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True
        # /api/v1/runs/<id>/events
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "events":
            rid = urllib.parse.unquote(parts[4])
            events = list(RUN_EVENTS.get(rid, []))
            with state_lock:
                if rid in resumed_runs:
                    events = events + [{"type": "unitDispatched", "session": rid, "ord": 1, "attempt": 1, "cli": "claude",
                                        "ts": NOW0, "seq": 4}]
            with state_lock:
                if state["seat_escalation"] and rid == "r-seat":
                    events = list(SEAT_EVENTS)
                if state["retry_gate"] and rid == "r-retry":
                    events = list(RETRY_EVENTS)
            with state_lock:
                if state["home_paths"] and rid in HOME_EVENTS:
                    events = list(HOME_EVENTS[rid])
            with state_lock:
                events = events + list(walk_gate_decided.get(rid, []))
                if state["wave1"] and rid == "r1":
                    events = list(WAVE1_R1_STALL_EVENTS if state["wave1_stall"] else WAVE1_R1_EVENTS)
                    if state["wave2a_feed"]:
                        events = events + WAVE2A_R1_FEED
            with state_lock:
                viewer_on = state["viewer"]
                river_on = state["river"]
                forensics_on = state["forensics"]
                timeline_on = state["timeline"]
                wire433_on = state["wire433"]
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
            # wicked-core#431 (api-types 0.33.0): the wire433 corpus SUPERSEDES both
            # runs' tails — r-api's restored-tree gate fold, r-auth's run base +
            # lift conflict chronology.
            if wire433_on and rid == "r-api":
                events = list(WIRE433_API_EVENTS)
            if wire433_on and rid == "r-auth":
                events = list(WIRE433_AUTH_EVENTS)
            with state_lock:
                if state["gate_move"] and rid == "r-review":
                    events = list(GATE_MOVE_EVENTS)
                    if state["gate_move_tail"]:
                        events = [_tail_cut(e) for e in json.loads(json.dumps(events))]
                if state["escalation_arms"] and rid in ESC_EVENTS:
                    events = list(ESC_EVENTS[rid])
                if state["trust_rules"] and rid in TRUST_GATES:
                    events = _trust_events(rid)
                if state["run_page"] and rid in ("r-rerun", "r-rerun-done"):
                    events = _run_page_events(rid)
            # Wave 6: the completed governed test's recorded trail — degraded council, the
            # remote-write fence, the UNGATED gate.
            with state_lock:
                gt_on = state["governed_testing"]
            if gt_on and rid == GT_RUN:
                events = list(GT_EVENTS)
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
                gate_move_on = state["gate_move"]
            if gate_move_on and rid == "r-review" and key in GATE_MOVE_OUTPUTS:
                self._json(200, GATE_MOVE_OUTPUTS[key])
                return True
            with state_lock:
                esc_on = state["escalation_arms"]
            if esc_on and (rid, key) in ESC_OUTPUTS:
                self._json(200, ESC_OUTPUTS[(rid, key)])
                return True
            with state_lock:
                sheets_on = state["sheets"]
                home_on = state["home_paths"]
            if home_on and rid == "r-home-done" and key.endswith("deliver"):
                # studio#479: the deliver unit's output names the push target by its absolute path.
                self._json(200, {"output": HOME_DELIVER_OUTPUT})
                return True
            if home_on and not (forensics_on and rid == "r-auth"):
                # studio#462: the onboarding index unit's output, the graph file by its absolute path.
                self._json(200, {"output": HOME_INDEX_OUTPUT})
                return True
            if sheets_on and not (forensics_on and rid == "r-auth"):
                # S11: a step sheet's "What it did" — the unit's captured output, as crew serves it.
                self._json(200, {"output": f"[{key}] read the module, changed 2 files, ran the unit tests: 14 passed."})
                return True
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
        # Wave 6 (review R2-3): the daemon-wide document index (`GET /interactive/docs`, api-types
        # 0.36.0) is ABSENT on this fixture the way it is on a pre-0.36 daemon — Fastify's BARE
        # unknown-route body, the exact shape `isRouteAbsent` recognises — so the studio's
        # presence-check takes its `absent` branch here, not the named-refusal one.
        if path == "/api/v1/interactive/docs":
            self._json(404, {"message": f"Route GET:{path} not found", "error": "Not Found", "statusCode": 404})
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
            gt_on = state["governed_testing"]
        # S6b: a source's passage, read from r-ship-deliver's worktree (the contained route's ladder).
        with state_lock:
            ship_on = state["sessions"] and state["ship_proposals"]
        if ship_on and rid == "r-ship-deliver" and leaf == "files":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("path", [""])[0]
            if not q.startswith(SHIP_WORKDIR + "/"):
                self._json(403, {"error": "path is outside every allowed root (the run's workdir/write roots "
                                          "and the registered repos)"})
            elif q == SHIP_WORKDIR + "/src/checkout.ts":
                self._json(200, {"path": q, "content": SHIP_CHECKOUT_TS, "size": len(SHIP_CHECKOUT_TS),
                                 "truncated": False, "binary": False})
            else:
                self._json(404, {"error": f"no such file: {q}"})
            return
        # Studio wave 1: r1's worktree diff (the `>files r1` route opens the viewer on it).
        with state_lock:
            wave1_on = state["wave1"]
        if wave1_on and rid == "r1" and leaf == "diff":
            self._json(200, {"diff": WAVE1_R1_DIFF, "truncated": False, "source": "worktree"})
            return
        # Trust at the gate: r-trust-deliver's deliver gate reads the run branch it would push.
        with state_lock:
            trust_on = state["trust_rules"]
        if trust_on and rid == "r-trust-deliver" and leaf == "diff":
            self._json(200, {"diff": TRUST_DELIVER_DIFF, "truncated": False, "source": "branch",
                             "branch": "wicked/r-trust-deliver"})
            return
        # Wave 6 (F-7R2-013): the completed governed test's worktree is GONE, and the wave-6
        # daemon serves the RUN BRANCH vs its base — 200 with `source: "branch"` — instead of the
        # pre-0.36 409 "workdir no longer exists". Lit by its own switch, whole-run only.
        if gt_on and rid == GT_RUN and leaf == "diff":
            self._json(200, {"diff": GT_BRANCH_DIFF, "truncated": False, "source": "branch"})
            return
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
        # EP-P3 / crew EP-C2: GET /projects/<pid>/interactive/docs/<doc>/checks — crew's DocChecksResponse.
        # Absent (404 Not Found, an older daemon) unless `doc_checks` is set.
        m = re.match(r"^/api/v1/projects/([^/]+)/interactive/docs/([^/]+)/checks$", path)
        if m:
            pid, doc = (urllib.parse.unquote(g) for g in m.groups())
            with state_lock:
                table = state["doc_checks"]
            if table is None:
                self._json(404, {"error": "Not Found"})
                return True
            qv = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("version", [None])[0]
            version = int(qv) if qv is not None and qv.isdigit() else None
            checks = [c for c in table.get(doc, []) if version is None or int(c.get("version", 0)) <= version]
            self._json(200, {"document_id": doc, "version": version, "checks": checks})
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
            # Wave 5 (F-4R2-003): the bridge's real collision — server.js answers
            # 409 {error: "doc already exists"} for a name that is already a doc.
            with state_lock:
                collide = bool(state["create_409_existing"])
            if collide:
                with docs_lock:
                    exists = doc in docs_created.get(pid, {})
                if exists:
                    self._json(409, {"error": "doc already exists"})
                    return True
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
            # S9: the recorded style (server.js accepts exactly these four; anything else records
            # none), and a first version that is what the style says it is.
            style = body.get("style") if body.get("style") in ("web", "ppt", "brochure", "doc") else None
            with docs_lock:
                doc_styles.pop((pid, doc), None)
                if style is not None:
                    doc_styles[(pid, doc)] = style
                    if style != "web" and not v0_mirror:
                        doc_html_overrides[(pid, doc, 1)] = styled_doc_html(style, doc)
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
            planning = "Planning the deck — outline first, then the slides."
            queue_interactive("wicked.interactive.status.posted", {
                "project_id": pid, "document_id": doc, "state": "working",
                "message": planning})
            if v0_mirror:
                # The answerer lands the FIRST DRAFT as v1 (head 0 → 1), exactly
                # the real materializeDraft → version.created "generated" path.
                schedule_doc_run(pid, doc, run_ms / 1000.0, heartbeat_message=planning)
            elif run_ms > 0:
                # Slice T: v1 is committed now but LANDS (the frame) after the
                # run — long enough for the rig to witness thread-generating.
                schedule_doc_run(pid, doc, run_ms / 1000.0, fixed_version=1,
                                 heartbeat_message=planning)
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
            # C5 (interactive 0.10.0): `expect_head` — the head the caller believes is current;
            # a different head answers 409 head_moved and creates nothing (S8's Undo).
            expect_head = body.get("expect_head")
            if expect_head is not None and not isinstance(expect_head, int):
                self._json(400, {"error": "expect_head must be a version number"})
                return True
            with docs_lock:
                versions = docs_created.get(pid, {}).get(doc)
                if versions is None:
                    self._json(404, {"error": f"no such doc {doc}"})
                    return True
                head_now = max(e["version"] for e in versions)
                if expect_head is not None and head_now != expect_head:
                    self._json(409, {"error": "head_moved", "head": head_now})
                    return True
                v = head_now + 1
                # Slice T (§8.4.1): no meta.sourceMessageId — the bridge drops it.
                versions.append(
                    {"version": v, "parent": frm, "feedback_file": None,
                     "html_file": f"v{v}.html", "created_at": iso(NOW0 + v * SEC)})
                # A fork is a byte copy of the version it branches from, as the real bridge's
                # is — so a picked take (Wave C) shows the take's own content as the new head.
                if frm > 0:
                    doc_html_overrides[(pid, doc, v)] = (
                        doc_html_overrides.get((pid, doc, frm)) or doc_html(doc, frm))
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
            # Wave 5 (F-4R2-016 / interactive#219): the additive layout report, on the
            # response and the echo alike — an A4 two-pager, as the acceptance brochure was.
            with state_lock:
                report_on = bool(state["export_report"])
            if report_on and fmt == "pdf":
                result.update({"layout": "document", "layout_source": "author @page",
                               "page_size": "A4 portrait", "pages": 2})
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
                with state_lock:
                    feedback_post_log.append({"pid": pid, "doc": doc, "version": payload.get("version"),
                                              "author": payload.get("author"), "items": json.loads(json.dumps(items))})
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
                                found = pat.search(html) if sel else None
                                # The engine's stale check (regenerate.js AC-10): an item whose
                                # `before` is not the element's text lands nothing. Checked only
                                # where the element's whole text is in hand (it holds no child tag).
                                whole = found is not None and html[found.end():found.end() + 2] == "</"
                                norm = lambda t: " ".join(html_mod.unescape(str(t)).split())  # noqa: E731
                                if (whole and item.get("before") is not None
                                        and norm(found.group(2)) != norm(item.get("before"))):
                                    rejected.append({"selector": sel, "reason": "stale"})
                                elif sel and pat.search(html):
                                    # interactive #247: a content-edit lands as TEXT — typed
                                    # `<b>x</b>` is those characters, never markup.
                                    new_text = html_mod.escape(str(item.get("value") or ""), quote=False)
                                    html = pat.sub(
                                        lambda mm: mm.group(1) + new_text, html, count=1)
                                    applied.append(sel)
                                else:
                                    rejected.append({"selector": sel,
                                                     "reason": "selector-not-found"})
                            elif typ == "style-edit" and isinstance(item.get("style"), dict):
                                # EP-P3: regenerate.js applyStyle (the grammar check is the engine's;
                                # the host already refused anything outside the colour grammar).
                                nxt = apply_style_edit(html, sel, item["style"]) if sel else None
                                if nxt is None:
                                    rejected.append({"selector": sel, "reason": "selector-not-found"})
                                else:
                                    html = nxt
                                    applied.append(sel)
                            elif typ == "remove":
                                nxt = apply_remove(html, sel) if sel else None
                                if nxt is None:
                                    rejected.append({"selector": sel, "reason": "selector-not-found"})
                                else:
                                    html = nxt
                                    applied.append(sel)
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
                with state_lock:
                    fail_floor = bool(state["doc_fail_floor"])
                if fail_floor:
                    # Wave 5 (F-4R2-014): crew's chat seam picks the ask up, then its
                    # governed run trips the deterministic deliverable floor — the REAL
                    # run-failure line (chat-events.ts), state:"error", paths scrubbed.
                    run_id = "37f020cc-e42c-48aa-b3ec-aa18ec6f9f63"
                    expected = f"/w5/state/interactive-chats/{doc}-m-dmsg-7/revised.html"
                    queue_interactive("wicked.interactive.status.posted", {
                        "project_id": pid, "document_id": doc, "state": "working",
                        "message": "A governed crew picked up your ask — revising the document…"})

                    def fail() -> None:
                        queue_interactive("wicked.interactive.status.posted", {
                            "project_id": pid, "document_id": doc, "state": "error",
                            "message": (
                                f"The crew run answering your ask failed (run {run_id}). Reason: "
                                "[wicked-crew] deliverable floor: this phase declared 1 artifact(s); "
                                "this run launched at 2026-09-11T10:32:54.984Z. "
                                f"[wicked-crew] EXPECTED: {expected} [wicked-crew] FOUND: (nothing) "
                                f"[wicked-crew] MISSING: {expected} (does not exist) "
                                "[wicked-crew] DELIVERABLE FLOOR FAILED — the run reported done without "
                                "producing the artifact(s) it was launched to produce. A prose reply is "
                                "not a deliverable (crew#311), and a prior run's leftover file is not "
                                f"this run's. Inspect it via the crew API (GET /api/v1/runs/{run_id}), "
                                "then resend the message.")})
                    threading.Timer(0.4, fail).start()
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

    def _capture_post(self, path: str, body: dict) -> bool:
        """Capture (Studio OS behaviour 8): the capture launch and the review's decisions."""
        m = re.fullmatch(r"/api/v1/projects/([^/]+)/capture", path)
        if m:
            with state_lock:
                on = state["capture"]
            if not on:
                self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
                return True
            pid = urllib.parse.unquote(m.group(1))
            notes = body.get("notes") or ""
            files = body.get("files") or []
            seen = []
            for i, f in enumerate(files):
                if "dataBase64" in f:
                    if f.get("mediaType") not in CAPTURE_IMAGE_TYPES:
                        self._json(400, {"error": f"files[{i}]: mediaType {json.dumps(f.get('mediaType'))} is not one a vision seat reads"})
                        return True
                    try:
                        raw = base64.b64decode(f["dataBase64"], validate=True)
                    except (ValueError, TypeError):
                        self._json(400, {"error": f"files[{i}]: dataBase64 is not base64"})
                        return True
                    seen.append({"name": f.get("name"), "kind": "image", "mediaType": f["mediaType"], "bytes": len(raw),
                                 "png": raw[:8] == b"\x89PNG\r\n\x1a\n"})
                else:
                    seen.append({"name": f.get("name"), "kind": "text", "text": f.get("text")})
            if not notes.strip() and not seen:
                self._json(400, {"error": "a capture needs notes or at least one file"})
                return True
            if pid not in {p["id"] for p in PROJECTS}:
                self._json(404, {"error": f"Project {pid} not found"})
                return True
            with state_lock:
                capture_seq[0] += 1
                rid = f"r-capture-{capture_seq[0]}"
                capture_post_log.append({"route": "capture", "projectId": pid, "notes": notes, "files": seen, "runId": rid})
                state["proposals"] = list(state["proposals"] or []) + capture_rows(rid, pid)
            self._json(201, {"runId": rid})
            return True
        return False

    def _demo_route(self, method: str, body: dict) -> bool:
        """The Demo experience (wicked-studio#373) on the crew api-types 0.59.0 wire."""
        url = urllib.parse.urlparse(self.path)
        path = url.path
        launch = re.fullmatch(r"/api/v1/projects/([^/]+)/demo", path)
        one = re.fullmatch(r"/api/v1/runs/([^/]+)/(demo|demo/file|demo/script|gate)", path)
        if not launch and not one:
            return False
        with state_lock:
            on = state["demo_runs"]
        if one and one.group(2) == "gate":
            with demo_lock:
                mine = urllib.parse.unquote(one.group(1)) in demo_runs
            if not (on and mine and method in ("GET", "POST")):
                return False
        if not on:
            self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            return True
        if launch and method == "POST":
            pid = urllib.parse.unquote(launch.group(1))
            url_ = (body.get("url") or "").strip()
            if not re.match(r"^https?://", url_) or not (body.get("audience") or "").strip() \
                    or not (body.get("show") or "").strip():
                self._json(400, {"error": "Invalid demo body"})
                return True
            if pid not in {p["id"] for p in PROJECTS}:
                self._json(404, {"error": f"Project {pid} not found"})
                return True
            with demo_lock:
                demo_seq[0] += 1
                rid = f"r-demo-{demo_seq[0]}"
                demo_runs[rid] = {"pid": pid, "url": url_, "audience": body["audience"].strip(),
                                  "show": body["show"].strip(), "stage": "planning",
                                  "ready_at": time.time() + DEMO_PLAN_S, "script": None,
                                  "script_override": None, "plan_note": None, "recorded": [],
                                  "next_at": 0.0, "round": 0}
                demo_post_log.append({"route": "launch", "projectId": pid, "body": body, "runId": rid})
            self._json(201, {"runId": rid})
            return True
        if not one:
            return False
        rid, what = urllib.parse.unquote(one.group(1)), one.group(2)
        with demo_lock:
            d = demo_runs.get(rid)
            if d is None:
                self._json(404, {"error": "no demo run with that id"})
                return True
            demo_tick(d)
            if what == "demo" and method == "GET":
                view = demo_view(rid, d)
                self._json(200, view)
                return True
            if what == "demo/script" and method == "PUT":
                content = body.get("content")
                if not isinstance(content, str) or content == "":
                    self._json(400, {"error": "Invalid script body"})
                    return True
                if d["stage"] != "plan_gate":
                    self._json(409, {"error": "the script can be edited only while the plan gate is open"})
                    return True
                d["script"] = content
                d["script_override"] = content
                demo_post_log.append({"route": "script", "runId": rid, "content": content})
                self._json(200, {"bytes": len(content.encode())})
                return True
            if what == "gate" and method == "GET":
                ords = {"plan_gate": 3, "review_gate": 4}
                if d["stage"] not in ords:
                    self._json(404, {"error": "no gate is open on this run"})
                    return True
                self._json(200, {"runId": rid, "ord": ords[d["stage"]], "lifecycle": "open",
                                 "prompt": "Approve the script" if d["stage"] == "plan_gate" else "Accept the recording",
                                 "receivedAt": iso(int(time.time() * 1000))})
                return True
            if what == "gate" and method == "POST":
                demo_post_log.append({"route": "gate", "runId": rid, "stage": d["stage"], "body": body})
                if d["stage"] not in ("plan_gate", "review_gate"):
                    self._json(409, {"error": "no gate is open on this run"})
                    return True
                # crew's gate_changed (api-types 0.44.0): a decision must name the open gate's ord.
                want = {"plan_gate": 3, "review_gate": 4}[d["stage"]]
                if body.get("ord") != want:
                    self._json(409, {"error": f"Gate changed: this decision names gate {body.get('ord')}, the open one is {want}",
                                     "code": "gate_changed"})
                    return True
                changes = body.get("approve") is False and body.get("action") == "request_changes"
                if d["stage"] == "plan_gate":
                    if body.get("approve") is True:
                        d.update(stage="recording", next_at=time.time() + DEMO_CHAPTER_S)
                    elif changes:
                        d.update(stage="planning", ready_at=time.time() + DEMO_PLAN_S,
                                 plan_note=body.get("amend"), script_override=None)
                else:
                    if body.get("approve") is True:
                        d["stage"] = "done"
                    elif changes:
                        m = re.search(r"Re-record only chapter ([a-z0-9-]+)", body.get("amend") or "")
                        if m and m.group(1) in d["recorded"]:
                            d["recorded"].remove(m.group(1))
                        d.update(stage="recording", next_at=time.time() + DEMO_CHAPTER_S)
                self._json(200, {"status": "ok"})
                return True
            if what == "demo/file" and method == "GET":
                rel = (urllib.parse.parse_qs(url.query).get("path") or [""])[0]
                if d["round"] < 1:
                    self._json(404, {"error": f"no such demo file: {rel}"})
                    return True
                if rel == "demo-video/demo.mp4":
                    self._media(tiny_webm(), "video/webm")
                    return True
                sheet = {"review/chapters.png": 0, "review/joins.png": 1, "review/end.png": 2}.get(rel)
                if sheet is None:
                    self._json(404, {"error": f"no such demo file: {rel}"})
                    return True
                self._media(sheet_png(sheet), "image/png")
                return True
        self._json(405, {"error": f"w2 fixture: {method} {path}"})
        return True

    def _walkthrough_route(self, method: str, body: dict) -> bool:
        """WT-U1: crew's WT-W1..W3 wire for the walkthrough corpus, its escalation gate, and the
        finished demo run (EP-C3 export). Off: `/walkthrough*` is the unknown-route 404."""
        url = urllib.parse.urlparse(self.path)
        m = re.fullmatch(r"/api/v1/runs/([^/]+)/(walkthrough|walkthrough/file|walkthrough/storyline|gate|demo|demo/file|demo/export|acceptance)", url.path)
        if not m:
            return False
        rid, what = urllib.parse.unquote(m.group(1)), m.group(2)
        with state_lock:
            on = state["sessions"] and state["walkthrough"]
            recorded = state["walk_recorded"]
            acceptance_wt = state["acceptance_wt"]
        if not on:
            if what.startswith("walkthrough"):
                self._json(404, {"message": f"Route {method}:{url.path} not found", "error": "Not Found", "statusCode": 404})
                return True
            return False
        walks = (WALK_REC, WALK_FAIL, WALK_PASS, WALK_THIN, WALK_YOURS)
        q = urllib.parse.parse_qs(url.query)
        step = (q.get("step") or [None])[0]
        if what == "acceptance":
            # WT-U2: only the corpus answers here; any other run falls through to the unknown-route 404,
            # which studio renders as nothing (no chip, no line), never as a verdict.
            if method != "GET" or rid not in walks:
                return False
            self._json(200, walk_acceptance(rid, acceptance_wt))
            return True
        if what == "walkthrough" and method == "GET":
            if rid not in walks and rid != WALK_DEMO and rid not in {r["session"]["id"] for r in SESSION_RUNS}:
                self._json(404, {"error": "no run with that id"})
                return True
            view = walk_view(rid, step, recorded)
            if view is None:
                self._json(404, {"error": f"run {rid} has no walkthrough step named {step}"})
            else:
                self._json(200, view)
            return True
        if what == "walkthrough/file" and method == "GET":
            rel = (q.get("path") or [""])[0]
            ext = os.path.splitext(rel)[1].lower()
            if ext not in (".mp4", ".png", ".jpg", ".gif", ".md", ".json"):
                self._json(400, {"error": "`path` must be one of .mp4, .png, .jpg, .gif, .md, .json"})
                return True
            if rid not in (WALK_FAIL, WALK_PASS) or step not in (None, "walkthrough_review", "walkthrough_plan"):
                self._json(404, {"error": "this run has no recorded walkthrough there"})
                return True
            if rel not in walk_files(rid):
                self._json(404, {"error": f"no such walkthrough file: {rel}"})
                return True
            if rel == "demo-video/demo.mp4":
                # WebM bytes behind the take's name, said as such in the content type: Playwright's
                # Chromium has no H.264 decoder, so an MP4 here could not be played by the journey
                # (the demo fixture's take does the same).
                self._media(walk_take(), "video/webm")
            elif ext == ".jpg":
                self._media(TINY_JPEG, "image/jpeg")
            elif ext == ".png":
                self._media(sheet_png(len(rel)), "image/png")
            elif ext == ".json":
                self._json(200, {"captured": rel, "run": rid, "note": "fixture evidence"})
            else:
                self._json(404, {"error": f"no such walkthrough file: {rel}"})
            return True
        if what == "walkthrough/storyline" and method == "PUT":
            text = body.get("storyline")
            if not isinstance(text, str) or text.strip() == "":
                self._json(400, {"error": "`storyline` (the storyline module text) is required"})
                return True
            if rid not in walks:
                self._json(404, {"error": "no run with that id"})
                return True
            if step not in (None, "walkthrough_review", "walkthrough_plan"):
                self._json(404, {"error": f"run {rid} has no walkthrough step named {step}"})
                return True
            if walk_gate(rid) is None:
                self._json(409, {"error": "the storyline can be edited only while this walkthrough's escalation is open: no gate is open",
                                 "code": "no_open_escalation"})
                return True
            with walk_lock:
                walk_posts.append({"route": "storyline", "runId": rid, "step": step, "storyline": text})
            self._json(200, {"runId": rid, "planStepId": "walkthrough_plan",
                             "sha256": hashlib.sha256(text.encode()).hexdigest(), "edited_by": "human",
                             "at": iso(int(time.time() * 1000))})
            return True
        if what == "gate":
            # r-walk-yours: its hand-over is READ here (WT-U2's deliver card); an answer to it goes the
            # ordinary way (the journey asserts none is sent).
            if rid not in (WALK_FAIL, WALK_THIN, WALK_YOURS) or (rid == WALK_YOURS and method != "GET"):
                return False
            gate = walk_gate(rid)
            if method == "GET":
                if gate is None:
                    self._json(404, {"error": "no gate is open on this run"})
                else:
                    self._json(200, gate)
                return True
            if method == "POST":
                with state_lock:
                    gate_post_log.append({"runId": rid, "body": body, "at": time.time()})
                if gate is None:
                    self._json(409, {"error": "no gate is open on this run", "code": "gate_unknown"})
                    return True
                if "ord" in body and body.get("ord") != gate["ord"]:
                    self._json(409, {"error": f"Gate changed: this decision names gate {body.get('ord')}, the open one is {gate['ord']}",
                                     "code": "gate_changed"})
                    return True
                with walk_lock:
                    if body.get("approve") is True:
                        walk_phase[rid] = "rerecording"   # the escalation's approve retries the recorder
                    elif body.get("action") == "request_changes":
                        walk_phase[rid] = "fixing"        # back to the creator, with the operator's note
                # The decision lands in the run's trail as crew records it (S13's live journey reads it back).
                with state_lock:
                    trail = walk_gate_decided.setdefault(rid, [])
                    decided = {"type": "gateDecided", "session": rid, "ord": gate["ord"], "seq": 9000 + len(trail) + 1,
                               "ts": int(time.time() * 1000), "allow": body.get("approve") is True}
                    if body.get("action") == "request_changes":
                        decided["action"] = "request_changes"
                    trail.append(decided)
                self._json(200, {"status": "ok"})
                return True
            return False
        if rid != WALK_DEMO:
            return False
        if what == "demo" and method == "GET":
            self._json(200, demo_view(rid, WALK_DEMO_STATE))
            return True
        if what == "demo/file" and method == "GET":
            rel = (q.get("path") or [""])[0]
            with walk_lock:
                made = dict(walk_exports.get(rid, {}))
            if rel == "demo-video/demo.mp4":
                self._media(walk_take(), "video/webm")
            elif rel in ("review/chapters.png", "review/joins.png", "review/end.png"):
                self._media(sheet_png(len(rel)), "image/png")
            elif rel == "demo-video/demo.gif" and made.get("gif"):
                self._media(TINY_GIF, "image/gif")
            elif rel == "demo-video/poster.jpg" and made.get("poster"):
                self._media(TINY_JPEG, "image/jpeg")
            else:
                self._json(404, {"error": f"no such demo file: {rel}"})
            return True
        if what == "demo/export" and method == "POST":
            fmt = body.get("format")
            if fmt not in ("gif", "poster") or set(body) - {"format", "atSec"}:
                self._json(400, {"error": "Invalid export body"})
                return True
            rel = "demo-video/demo.gif" if fmt == "gif" else "demo-video/poster.jpg"
            with walk_lock:
                walk_exports.setdefault(rid, {})[fmt] = True
                walk_posts.append({"route": "export", "runId": rid, "body": body})
            self._json(200, {"format": fmt, "path": rel, "bytes": len(TINY_GIF) if fmt == "gif" else len(TINY_JPEG)})
            return True
        return False

    def _decisions_route(self, method: str, body: dict) -> bool:
        """Decision capture (DC-S6) on crew's DC-S4a/S4b wire: GET /decisions and the five POST verbs."""
        url = urllib.parse.urlparse(self.path)
        path = url.path
        if not path.startswith("/api/v1/decisions"):
            return False
        with state_lock:
            on, mode = state["decisions"], state["decisions_mode"]
        if not on:
            self._json(404, {"message": f"Route {method}:{path} not found", "error": "Not Found", "statusCode": 404})
            return True
        if path == "/api/v1/decisions" and method == "GET":
            q = urllib.parse.parse_qs(url.query)
            want_state = (q.get("state") or [None])[0]
            want_chat = (q.get("chat") or [None])[0]
            want_project = (q.get("project") or [None])[0]
            want_run = (q.get("run") or [None])[0]
            since = int((q.get("since") or ["0"])[0] or 0)
            with decisions_lock:
                rows = [d for d in DECISIONS.values()
                        if (want_state is None or d["state"] == want_state)
                        and (want_chat is None or d["origin"].get("chat_id") == want_chat)
                        and (want_project is None or d["project_id"] == want_project)
                        and (want_run is None or d["origin"].get("run_id") == want_run)
                        and d["at"] >= since]
            rows.sort(key=lambda d: -d["at"])
            self._json(200, {"decisions": rows, "mode": mode})
            return True
        m = re.fullmatch(r"/api/v1/decisions/([^/]+)/(remember|undo|dismiss|same|widen)", path)
        if not m or method != "POST":
            self._json(404, {"error": "no such decision route"})
            return True
        did, verb = urllib.parse.unquote(m.group(1)), m.group(2)
        with decisions_lock:
            d = DECISIONS.get(did)
            if d is None:
                self._json(404, {"error": f"no decision {did}"})
                return True
            decision_posts.append({"id": did, "verb": verb, "body": body})
            if verb == "remember":
                d["state"], d["how"], d["rule_id"] = "remembered", "chip", f"proposal:{d.get('proposal_id', did)}"
                if isinstance(body.get("statement"), str):
                    d["edits"] = {"statement": body["statement"]}
                answer = {"rule_id": d["rule_id"], "proposal_id": d.get("proposal_id", did), "project": DECISION_PROJECT}
            elif verb == "undo":
                d["state"] = "undone"
                answer = {"ok": True}
            elif verb == "dismiss":
                d["state"] = "dismissed"
                answer = {"ok": True}
            elif verb == "same":
                if body.get("same") is True:
                    d["state"], d["route"] = "restated", "restated"
                else:
                    d["route"] = "offer"
                answer = {"ok": True}
            else:  # widen
                d["state"], d["rule_id"] = "widened", "proposal:pr-everywhere"
                answer = {"rule_id": d["rule_id"]}
            frame = {"type": "decisionChanged", "id": did, "state": d["state"], "project_id": d["project_id"]}
            if "rule_id" in d:
                frame["rule_id"] = d["rule_id"]
            # S12: what crew LANDS at remember() (DC §4.2.4 policyProposalToRule) — the rule the Rules page
            # then serves under `steering_rules`: the statement (the operator's edit wins), the decision's
            # project and steering type, provenance chat/decision.
            landed = None
            if verb == "remember":
                derived = d.get("derived") or {}
                landed = {"id": d["rule_id"], "rule_type": "policy",
                          "statement": (d.get("edits") or {}).get("statement") or derived.get("statement") or "",
                          "severity": "warn", "confidence": 0.9, "targets": {"project": d["project_id"]},
                          "provenance": {"source": "chat", "source_kinds": ["decision"]},
                          "steering_type": derived.get("steering_type") or "development", "applies_to": [], "excludes": [],
                          "weight": 1.0, "created_at": int(time.time())}
        with state_lock:
            state["extra_frames"].append(frame)
            if landed is not None and state["steering_rules"]:
                steering_rule_overlay[landed["id"]] = landed
        self._json(200, answer)
        return True

    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self.headers.get("Upgrade", "").lower() == "websocket":
            return self._ws()
        path = urllib.parse.urlparse(self.path).path
        # Wave 2a: the SERVER-side record of every gate decision that arrived —
        # the only witness for "closing the tab during the undo window sends nothing".
        if path == "/__fixture/ask-posts":
            with ask_lock:
                posts = list(ask_posts)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/launch-posts":
            with state_lock:
                posts = list(session_launch_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/cancel-posts":
            with state_lock:
                posts = list(cancel_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/reassign-posts":
            with state_lock:
                rposts = list(reassign_post_log)
            return self._json(200, {"posts": rposts})
        if path == "/__fixture/gate-posts":
            with state_lock:
                posts = list(gate_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/resume-posts":
            with state_lock:
                posts = list(resume_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/inject-posts":
            with state_lock:
                posts = list(inject_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/feedback-posts":
            with state_lock:
                posts = list(feedback_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/onboard-posts":
            with chat_state_lock:
                posts = list(onboard_posts)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/replay-posts":
            with state_lock:
                posts = list(replay_posts)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/approve-posts":
            with state_lock:
                posts = list(approve_posts)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/proposal-posts":
            with state_lock:
                posts = list(proposal_posts)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/plan-posts":
            with state_lock:
                posts = list(plan_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/preset-puts":
            with state_lock:
                puts = list(preset_put_log)
            return self._json(200, {"puts": puts})
        if path == "/__fixture/rule-posts":
            with state_lock:
                posts = list(rule_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/standing-order-posts":
            with state_lock:
                posts = list(standing_order_posts)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/demo-posts":
            with demo_lock:
                posts = list(demo_post_log)
            return self._json(200, {"posts": posts})
        if path == "/__fixture/walkthrough-posts":
            with walk_lock:
                posts = list(walk_posts)
            return self._json(200, {"posts": posts})
        if self._walkthrough_route("GET", {}):
            return None
        if self._demo_route("GET", {}):
            return None
        if path == "/__fixture/decision-posts":
            with decisions_lock:
                posts = list(decision_posts)
            return self._json(200, {"posts": posts})
        if self._decisions_route("GET", {}):
            return None
        if path == "/__fixture/capture-posts":
            with state_lock:
                posts = list(capture_post_log)
            return self._json(200, {"posts": posts})
        if (path == "/api/v1/editors" or path.startswith("/api/v1/editors/")) and self._editor_routes(path):
            return None
        if self._api(path):
            return None
        if not Path(self.translate_path(self.path)).is_file():
            self.path = "/index.html"  # client-side routes resolve to the shell
        return super().do_GET()

    def end_headers(self):  # noqa: D401 — the shell's frame-src policy (EP-P1 stand-in for crew)
        with state_lock:
            shell_csp = state["shell_csp"]
        if shell_csp and getattr(self, "path", "") == "/index.html":
            host = self.headers.get("Host", "127.0.0.1")
            self.send_header("Content-Security-Policy",
                             f"frame-src http://{host}/api/v1/editors/ http://{host}/api/v1/projects/ blob: data:")
        super().end_headers()

    def _studio_editors(self) -> list:
        """The first-party editors the served dist carries, as crew's registry discovers them at boot
        (EP-C1 `discoverStudioEditors`): <dist>/editors/<id>/editor.json beside ONE index.html, the entry's
        sha256 and size pinned. Nothing else is first-party."""
        root = Path(self.directory) / "editors"
        out = []
        if not root.is_dir():
            return out
        for d in sorted(root.iterdir()):
            mf, entry = d / "editor.json", d / "index.html"
            if not (d.is_dir() and mf.is_file() and entry.is_file()):
                continue
            manifest = json.loads(mf.read_text())
            if manifest.get("id") != d.name or not re.match(r"^wicked-[a-z0-9]+(?:-[a-z0-9]+)*$", d.name):
                continue
            body = entry.read_bytes()
            out.append({"manifest": manifest, "body": body, "sha256": hashlib.sha256(body).hexdigest()})
        return out

    def _editor_routes(self, path: str) -> bool:
        """EP-C1 stand-in: the registry list, the editor bundle route (hash-pinned, with its CSP) and the
        grants route (crew's decided shape)."""
        with state_lock:
            on = state["editors"]
            grants = list(state["editor_grants"])
        if not on:
            return False
        parts = path.split("/")
        # /api/v1/editors — the registry (EP-P2): the dist's first-party editors, the wire view crew sends.
        if len(parts) == 4 and parts[3] == "editors":
            editors = []
            for e in self._studio_editors():
                m = e["manifest"]
                editors.append({"id": m["id"], "title": m["title"], "version": m["version"], "protocol": m["protocol"],
                                "kinds": m["kinds"], "sizes": m["sizes"], "permissions": m["permissions"],
                                "sha256": e["sha256"], "bytes": len(e["body"]), "first_party": True, "enabled": True,
                                "source": "studio-bundle", "entry_url": f"/api/v1/editors/{m['id']}/{m['version']}/entry"})
            self._json(200, {"editors": editors, "installs": "refused_until_conformance"})
            return True
        # /api/v1/editors/<id>/grants — crew's DECIDED set: {permission, decision, ruleIds, token} per permission.
        if len(parts) == 6 and parts[5] == "grants":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            version = (q.get("version") or [""])[0]
            sha = (q.get("sha") or [""])[0]
            self._json(200, {"editorId": parts[4], "version": version, "sha256": sha, "project": (q.get("project") or [None])[0],
                             "firstParty": parts[4].startswith("wicked-"),
                             "grants": [{"permission": g, "decision": "allow", "ruleIds": [],
                                         "token": f"editor:{parts[4]}@{version}#{sha}/{g}"} for g in grants]})
            return True
        # /api/v1/editors/<id>/<version>/entry
        if len(parts) == 7 and parts[6] == "entry":
            files = {"acme-good": "good.html", "acme-hostile": "hostile.html"}
            name = files.get(parts[4])
            first_party = next((e for e in self._studio_editors() if e["manifest"]["id"] == parts[4]), None)
            if first_party is not None:
                if parts[5] != first_party["manifest"]["version"]:
                    self._json(404, {"error": f"no editor {parts[4]}@{parts[5]}"})
                    return True
                body, sha = first_party["body"], first_party["sha256"]
                media = " https:" if any(p.get("id") == "network.media" for p in first_party["manifest"]["permissions"]) else ""
            elif name is None or parts[5] != "0.1.0":
                self._json(404, {"error": f"no editor {parts[4]}@{parts[5]}"})
                return True
            else:
                body = (REPO / "e2e" / "editor-fixtures" / name).read_bytes()
                sha = hashlib.sha256(body).hexdigest()
                media = ""
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if (q.get("sha") or [""])[0] != sha:
                self._json(409, {"error": "the entry's hash does not match the pinned hash", "code": "hash_mismatch"})
                return True
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Security-Policy",
                             "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; "
                             f"style-src 'unsafe-inline'; img-src data: blob:{media}; media-src blob:; font-src data:{media}; "
                             "frame-src blob: data: about:; child-src blob: data: about:; connect-src 'none'; "
                             "form-action 'none'; base-uri 'none'; worker-src 'none'; manifest-src 'none'")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return True
        return False

    def do_POST(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if path == "/__fixture":
            # `reset_learn` clears the learned-theme readback state between page
            # loads (the brand-learn rig re-runs the flow from a clean 404).
            if body.get("reset_repairs"):
                with chat_state_lock:
                    onboard_posts.clear()
                with state_lock:
                    replay_posts.clear()
                    approve_posts.clear()
                    proposal_posts.clear()
            if body.get("reset_gate_posts"):
                with state_lock:
                    cancel_post_log.clear()
                    gate_post_log.clear()
                    reassign_post_log.clear()
                    resume_post_log.clear()
                    resumed_runs.clear()
                    walk_gate_decided.clear()
                    session_launch_log.clear()
                    session_launched.clear()
                    inject_post_log.clear()
            if body.get("reset_decisions"):
                with decisions_lock:
                    reset_decisions()
            if body.get("reset_walkthrough"):
                with walk_lock:
                    walk_phase.clear()
                    walk_posts.clear()
                    walk_exports.clear()
            if body.get("reset_rule_posts"):
                with state_lock:
                    rule_post_log.clear()
                    steering_rule_overlay.clear()
            if body.get("reset_home_runs"):
                with state_lock:
                    preset_put_log.clear()
                    gate_post_log.clear()
                    delivery_freeze.clear()
                    delivery_freeze.update(FREEZE_THAWED)
            if body.get("reset_orders"):
                with state_lock:
                    trust_orders.clear()
                    standing_order_posts.clear()
            if body.get("reset_plan"):
                with state_lock:
                    plan_post_log.clear()
                    plan_edit_taken.clear()
                    plan_edit_failed_once.clear()
                    gate_moved_done.clear()
            if body.get("reset_standing"):
                with state_lock:
                    STANDING.update({"away": False, "awaySince": None, "orders": [], "outbox": []})
                    STANDING_AUDIT.clear()
            # Behaviour 10: orders already in force (made at a gate / from the trust receipt).
            if isinstance(body.get("standing_seed"), list):
                with state_lock:
                    STANDING["orders"] = json.loads(json.dumps(body["standing_seed"]))
            if body.get("reset_demo"):
                with demo_lock:
                    demo_runs.clear()
                    demo_post_log.clear()
                    demo_seq[0] = 0
            if body.get("reset_capture"):
                with state_lock:
                    capture_post_log.clear()
                    capture_seq[0] = 0
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
            # crew#561: push VERBATIM chat frames onto the socket — the daemon-synthetic ones a
            # fixture cannot derive (`chatCitations`, the citation verdicts). The rig decides the
            # frame and when it arrives; the fixture adds nothing to it.
            for frame in body.get("chat_frames") or []:
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
                # S3: seed `studio.view` the same way (None removes the key: the
                # fresh-install case, technical details off).
                if "view_prefs" in body:
                    if body["view_prefs"] is None:
                        settings_store.pop("studio.view", None)
                    else:
                        settings_store["studio.view"] = body["view_prefs"]
                state.update({k: v for k, v in body.items() if k in state})
                snapshot = dict(state)
            return self._json(200, {"ok": True, "state": snapshot})
        if self._capture_post(path, body if isinstance(body, dict) else {}):
            return None
        if self._walkthrough_route("POST", body if isinstance(body, dict) else {}):
            return None
        if self._demo_route("POST", body if isinstance(body, dict) else {}):
            return None
        if self._decisions_route("POST", body if isinstance(body, dict) else {}):
            return None
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
        # Wave 6: POST /testing/author — the governed New test (api-types 0.36.0). Switch-gated:
        # off ⇒ the unknown-route 404 (the panel's chain then tries /testing/recon + `workflow`);
        # on ⇒ ONE run per resolved repo (this fixture resolves nothing server-side: one run),
        # `qe-author-tests` on the DTO, paused at its intake gate — the awaitingHuman frame rides
        # the /ws one-shot queue so the panel's gate card appears the way it does in production.
        if path == "/api/v1/testing/author":
            with state_lock:
                gt_on = state["governed_testing"]
                if not gt_on:
                    return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
                problem = str(body.get("problem") or "")
                if not problem:
                    return self._json(400, {"error": "Invalid author body: problem must be a non-empty string"})
                refs = body.get("repoRefs") or []
                if any(r != REPO_ID for r in refs):
                    bad = next(r for r in refs if r != REPO_ID)
                    return self._json(404, {"error": f"repoRefs names a repo that is not registered: {bad}"})
                gt_launched_seq[0] += 1
                rid = f"r-gt-{gt_launched_seq[0]}"
                run = session(rid, "awaiting_human", problem, "recon — read the repository and its tests")
                run["session"]["workflow_id"] = "qe-author-tests"
                run["session"]["repo_ref"] = REPO_ID if refs else None
                run["session"]["clis"] = ["claude", "codex", "pi"]
                run["session"]["human_confirm"] = "before:1"
                run["session"]["unit_ix"] = 0
                pid = body.get("projectId")
                run["session"]["project_id"] = pid if pid else None
                run["units"] = gt_units(rid, done=False)
                gt_launched.append(run)
                state["extra_gates"].append({"session": rid, "ord": 1, "prompt": GT_INTAKE_PROMPT})
            # The 0.36.0 `TestingAuthorResponse`: NO `campaign` field — the filing rides `runs[].label`
            # (`qe-tests-<repo>`, the RunGroup.label on GET /campaigns); the plan the intake card shows.
            return self._json(201, {"runId": rid, "runIds": [rid], "workflow": "qe-author-tests",
                                    "runs": [{"runId": rid, "repoRef": REPO_ID, "label": GT_LABEL}],
                                    "gate": "before:1", "deliver": "pr", "plan": GT_AUTHOR_PLAN,
                                    "scope": "repoRefs" if refs else "project",
                                    "campaignRegistered": False})
        # POST /api/v1/runs — the REAL launch (slice S, project_dto only): the
        # daemon's `{runId}` answer; `body.projectId` files the run atomically
        # (LaunchSchema, routes.ts:148 — "never a silent unfiled run"), and the
        # DTO the next GET /runs serves carries the CREW-UX-2 `project_id` echo.
        # POST /api/v1/runs — the launch, shared by the slice-V (provenance/
        # retry) and slice-S (project_dto) corpora. retryOf validation first
        # (CREW-UX-3: 400 on an unknown id, crew routes.ts:588); then a REAL
        # launch when project_dto is on (the run rides GET /runs with its
        # project_id echo — atomic filing), else slice V's plain 201.
        # Behaviour 10: the parse (a deterministic 'seat') and the confirmed create.
        with state_lock:
            standing_on = state["standing_orders"]
        # Switch off: /parse is an unknown route; the create falls through to the ideas 7/8/13 handler.
        if path == "/api/v1/standing-orders/parse" and not standing_on:
            return self._json(404, {"error": f"Route POST:{path} not found"})
        if path in ("/api/v1/standing-orders/parse", "/api/v1/standing-orders") and standing_on:
            text = body.get("text") if isinstance(body, dict) else None
            if not isinstance(text, str) or not text.strip():
                return self._json(400, {"error": "Invalid request body"})
            if path.endswith("/parse"):
                rule, refused = standing_parse(text)
                return self._json(200, {"rule": rule, "seat": "claude",
                                        **({"refused": refused} if refused else {})})
            rule = body.get("rule")
            if not isinstance(rule, dict):
                return self._json(400, {"error": "Invalid request body"})
            if rule.get("action") == "approve" and rule.get("trigger", {}).get("phase") in ("deliver", "plan_approval"):
                return self._json(400, {"error": "an order never answers the deliver gate — it always waits for you",
                                        "code": "order_refused"})
            with state_lock:
                order = {"id": f"o{len(STANDING['orders']) + 1}", "text": text.strip(), "rule": rule,
                         "createdAt": int(time.time() * 1000)}
                STANDING["orders"].append(order)
                standing_sweep()
            return self._json(201, {"order": order})
        # T9: POST /plans/preview — the launch's own decision, persisting nothing.
        if path == "/api/v1/plans/preview":
            with state_lock:
                on = state["team_plan"]
                if on:
                    plan_post_log.append({"route": "preview", "body": body, "at": time.time()})
            if not on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            if not (body.get("plan") or {}).get("steps"):
                return self._json(400, {"error": "Invalid request body"})
            with state_lock:
                preview_delay = state["preview_delay_ms"]
            if preview_delay:
                time.sleep(preview_delay / 1000)  # studio#431: an engine slow to answer under load
            return self._json(200, team_preview(body))
        # S11: POST /runs/:id/cancel under `sheets` — crew's 200, recorded (the Stop it undo window).
        m = re.match(r"^/api/v1/runs/([^/]+)/cancel$", path)
        if m:
            with state_lock:
                on = state["sheets"]
                if on:
                    cancel_post_log.append({"runId": urllib.parse.unquote(m.group(1)), "at": time.time()})
            if on:
                return self._json(200, {"status": "cancelled"})
        # T9: POST /runs/:id/plan — a mid-run edit, idempotent by requestId (crew team/routes.ts).
        m = re.match(r"^/api/v1/runs/([^/]+)/plan$", path)
        if m:
            rid = urllib.parse.unquote(m.group(1))
            with state_lock:
                on = state["team_plan"]
                fail_once = state["plan_edit_fail_once"]
                if on:
                    plan_post_log.append({"route": "edit", "runId": rid, "body": body, "at": time.time()})
                req_id = body.get("requestId") or f"minted-{len(plan_post_log)}"
                taken = plan_edit_taken.get(req_id)
                if on and taken is None:
                    plan_edit_taken[req_id] = f"prop-{len(plan_edit_taken) + 1}"
                lose_answer = on and taken is None and fail_once and not plan_edit_failed_once
                if lose_answer:
                    plan_edit_failed_once.append(req_id)
            if not on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            if lose_answer:
                return self._json(503, {"error": "upstream closed the connection before answering"})
            if taken is not None:
                return self._json(200, {"proposal_id": taken, "duplicate": True, "band": None,
                                        "high_risk": None, "floor_added": []})
            adds_build = any(st.get("catalog") == "build" for st in (body.get("plan") or {}).get("steps", []))
            return self._json(200, {"proposal_id": plan_edit_taken[req_id], "duplicate": False,
                                    "band": "70-100" if adds_build else "40-69",
                                    "high_risk": adds_build,
                                    "floor_added": ["design", "review"] if adds_build else []})
        if path == "/api/v1/runs":
            retry_of = body.get("retryOf")
            if retry_of is not None:
                # Crew validates lineage against the runs it has: here, every run GET /runs lists
                # under the current switches (assemble_runs takes the lock itself) plus this
                # lifetime's launches — not the base W2 list alone, which refused a retry of any
                # wave-1 / wave-2b failure (f1) the Home "Retry failed" move offers.
                known = {r["session"]["id"] for r in assemble_runs()}
                with state_lock:
                    known |= {r["session"]["id"] for r in launched_runs}
                if retry_of not in known:
                    return self._json(400, {
                        "error": f"retryOf names an unknown run: {retry_of} — "
                                 "lineage must point at an existing run id"})
            with state_lock:
                sessions_on = state["sessions"]
                chat_on = state["run_chat_id"]
                if sessions_on:
                    session_launch_log.append(body)
                    rid = f"r-chat-launch-{len(session_launch_log)}"
                    chat = body.get("chatId") if chat_on else None
                    session_launched.append(_session_run(rid, "executing", body.get("problem", ""), chat,
                                                         NOW0 // 1000, None, [("build", "build", "distributed")]))
            if sessions_on:
                return self._json(200, {"runId": rid})
            with state_lock:
                project_dto_on = state["project_dto"]
                if project_dto_on:
                    launched_seq[0] += 1
                    rid = f"r-launched-{launched_seq[0]}"
                    pid = body.get("projectId")
                    run = session(rid, "executing", body.get("problem", ""),
                                  body.get("problem", ""))
                    run["session"]["project_id"] = pid if pid else None
                    if retry_of is not None:
                        # api-types 0.8.0: a relaunch echoes its lineage on the run DTO, as crew's does.
                        run["session"]["retry_of"] = retry_of
                    launched_runs.append(run)
                    if pid:
                        launched_members.setdefault(pid, []).append(rid)
                        ATTACHED_AT[rid] = NOW0
            if project_dto_on:
                return self._json(200, {"runId": rid})
            return self._json(201, {"runId": "r-new"})
        # POST /api/v1/runs/<id>/inject — a message to the team on a live run (crew's route: 400 on a
        # bad body, 404 for an unknown run, {status: "ok"} once the workers have it).
        parts = path.split("/")
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "inject":
            rid = urllib.parse.unquote(parts[4])
            msg, target = body.get("message"), body.get("target")
            if not isinstance(msg, str) or msg == "" or not isinstance(target, str) or target == "":
                return self._json(400, {"error": "Invalid request body"})
            if rid not in {r["session"]["id"] for r in assemble_runs()}:
                return self._json(404, {"error": "Run not found"})
            with state_lock:
                inject_post_log.append({"runId": rid, "body": {"message": msg, "target": target}})
            return self._json(200, {"status": "ok"})
        # POST /api/v1/runs/<id>/gate — the steering-gate decision (slice H,
        # DES-FEEDBACK-002 §2.3). The fixture accepts it so the answered state
        # ("approved · advancing…") renders truthfully after a triage key or a
        # chip click; the rigs assert the request BODY off the browser tap.
        parts = path.split("/")
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "resume":
            # studio#545: crew's POST /runs/:id/resume — the orphaned run's unit is dispatched again, and
            # GET /runs/:id/events then carries that dispatch after the orphan report.
            rid = urllib.parse.unquote(parts[4])
            with state_lock:
                resume_post_log.append({"runId": rid, "at": time.time()})
                resumed_runs.add(rid)
            return self._json(200, {"status": "resumed"})
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "reassign":
            rid = urllib.parse.unquote(parts[4])
            with state_lock:
                reassign_post_log.append({"runId": rid, "body": body, "at": time.time()})
                refuse = state["reassign_refuse"] > 0
                if refuse:
                    state["reassign_refuse"] -= 1
            if refuse:
                return self._json(400, {"error": f'cli "{body.get("cli")}" is not in this run\'s seat pool (codex)'})
            return self._json(200, {"status": "ok", "ord": 1, "cli": body.get("cli"), "approved": True})
        if len(parts) == 6 and parts[3] == "runs" and parts[5] == "gate":
            rid = urllib.parse.unquote(parts[4])
            with state_lock:
                ask_on = state["ask_path"]
            if ask_on and ask_gate_answer(rid, body) is not None:
                with state_lock:
                    gate_post_log.append({"runId": rid, "body": body, "at": time.time()})
                return self._json(200, {"status": "resumed"})
            with state_lock:
                conflict = rid in state["gate_409"]
                moved = rid in state["gate_moved"] and rid not in gate_moved_done
                gate_post_log.append({"runId": rid, "body": body, "at": time.time()})
                if moved:
                    gate_moved_done.add(rid)
                held = (state["home_runs"] and delivery_freeze["frozen"] and body.get("approve") is True
                        and rid in TRUST_GATES and TRUST_GATES[rid][1] == "deliver")
                freeze_now = dict(delivery_freeze)
            if held:
                # Idea 15: crew's refusal for an approve of a deliver gate while frozen (crew#694).
                why = f" ({freeze_now['reason']})" if freeze_now.get("reason") else ""
                return self._json(409, {
                    "error": f"Deliveries are frozen by {freeze_now['by']} since {freeze_now['since']}{why}: "
                             "nothing is pushed while the freeze is on. The gate stays open — unfreeze "
                             "deliveries, then approve again.",
                    "code": "deliveries_frozen"})
            if moved:
                # T9: crew's real 409 for a decision that outlived its gate (routes.ts, api-types 0.44.0).
                return self._json(409, {
                    "error": f"Gate changed: this decision was made on the gate before unit {body.get('ord')}, "
                             "but the open gate is before unit 4 — it was answered or replaced. "
                             "Read the open gate before deciding.",
                    "code": "gate_changed", "openOrd": 4})
            with state_lock:
                refuse = state["proposal_refuse"] and rid == "r-ship-plan"
            if refuse:
                # S6b: crew's 400 for a plan approval the engine refused, with its reason.
                return self._json(400, {"error": "plan refused: a change to payment code needs a test step"})
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
            # Wave 2 (studio#248, crew#502): resolve the scope BEFORE any seat warms —
            # a refused scope warms nothing. Real status codes + sentences.
            with state_lock:
                scope_on = state["chat_scope"]
                scope_501 = state["chat_scope_501"]
                admit_subset = state["chat_admit_subset"]
                repo_on = state["repo"]
                repo_member_on = state["repo_member"]
            scope = None
            if scope_on:
                refs = ([body["repoRef"]] if body.get("repoRef") else []) + list(body.get("repoRefs") or [])
                registry = [REPO_ENTRY] if repo_on else []
                scope_kind = body.get("scopeKind")
                if scope_kind == "system":
                    # studio#323 R4 (crew chat-scope.ts): the platform itself — a STATED scope
                    # that reads no repository; a bound project rides as filing only.
                    scope = {"kind": "system", "repos": [], "cwd": CHAT_SCRATCH.format(chat_id),
                             "graph": {"bound": False,
                                       "reason": "a system chat is about the wicked platform itself (daemon, seats, "
                                                 "runs, configuration), so no repository and no code graph are in "
                                                 "scope; its seats have no live read of the daemon — only what the "
                                                 "message carries."},
                             "dangling": []}
                    if body.get("projectId"):
                        scope["projectId"] = body["projectId"]
                elif scope_kind == "everything":
                    # Every registered repo across all projects; no single graph spans them.
                    scope = {"kind": "everything", "repos": [scope_repo(r) for r in registry],
                             "cwd": CHAT_SCRATCH.format(chat_id),
                             "graph": {"bound": False,
                                       "reason": ("no repository is registered with this daemon, so there is "
                                                  "nothing to read and no code graph.") if not registry else
                                                 f"{len(registry)} registered repos across all projects and no "
                                                 "single code graph spans them."},
                             "dangling": []}
                    if body.get("projectId"):
                        scope["projectId"] = body["projectId"]
                elif refs:
                    found = [r for r in registry if r["id"] in refs or r["name"] in refs]
                    missing = [ref for ref in refs if not any(r["id"] == ref or r["name"] == ref for r in registry)]
                    if missing:
                        return self._json(404, {"error": "Repo " + ", ".join(f"'{m}'" for m in missing) + " not found",
                                                "missing": missing})
                    scope = {"kind": "repos", "repos": [scope_repo(r) for r in found], "cwd": CHAT_SCRATCH.format(chat_id),
                             "graph": {"bound": False,
                                       "reason": f"'{found[0]['name']}' has no resolvable code graph (not indexed yet); this chat gets none."},
                             "dangling": []}
                    if body.get("projectId"):
                        scope["projectId"] = body["projectId"]
                elif body.get("projectId"):
                    pid = body["projectId"]
                    members = [REPO_ENTRY] if (repo_on and repo_member_on and pid == "upload-endpoint") else []
                    scope = {"kind": "project", "projectId": pid, "repos": [scope_repo(r) for r in members],
                             "cwd": CHAT_SCRATCH.format(chat_id),
                             "graph": ({"bound": True, "reason": f"bound to project '{pid}'s co-located code graph."}
                                       if members else
                                       {"bound": False, "reason": "the project graph has never been built. "
                                                                  f"POST /api/v1/projects/{pid}/graph/refresh fixes it."}),
                             "dangling": []}
                else:
                    scope = {"kind": "none", "repos": [], "cwd": CHAT_SCRATCH.format(chat_id),
                             "graph": {"bound": False,
                                       "reason": "the chat names no project and no repos, so its seats see only their own "
                                                 "scratch root and no code graph; pass projectId or repoRefs to scope it."},
                             "dangling": []}
                # crew routes.ts: `none` and `system` read no repository, so they take the
                # UNSCOPED admission and open on an engine that predates chat scope.
                scoped = scope["kind"] not in ("none", "system")
                if scope_501 and scoped:
                    return self._json(501, {"error": CHAT_SCOPE_501})
                # crew's admissibility pre-filter (routes.ts @ #518): with `clis` OMITTED on a
                # SCOPED open the DEFAULT roster is filtered to governed seats; an explicit list
                # is passed through as asked. The fixture's stand-in for "governed" is the
                # chat-capable set (the same seats chat_ensure admits).
                if scoped and not body.get("clis"):
                    clis = ["claude"] if admit_subset else list(CHAT_CAPABLE_KEYS)
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
                if scope is not None:
                    chat_scopes[chat_id] = scope
            with state_lock:
                ask_on = state["ask_path"]
            if ask_on:
                ask_open(chat_id, [s["cliKey"] for s in seats if s["ok"]], body.get("primary"), scope)
            opened = {"chatId": chat_id, "seats": seats}
            if scope is not None:
                opened["scope"] = scope
            return self._json(201, opened)
        # Wave A (crew#689): the dead-letter replay over the `deadletters` block — dry run first.
        if path == "/api/v1/governance/rules":
            with state_lock:
                rule_post_log.append(body)
                week = state["seat_week"]
                rules_on = state["steering_rules"]
                if rules_on and isinstance(body, dict) and isinstance(body.get("id"), str):
                    steering_rule_overlay[body["id"]] = body  # WT-U2: the upsert the GET then serves
            if not week and not rules_on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            return self._json(200, {"status": "ok"})
        # crew#686: POST /standing-orders {text, rule} — the invariant refuses an approve of the
        # deliver gate or a finding, and (crew#693) a plan approval unless it is the trust receipt:
        # band 0-19, a preset and a project scope (400 order_refused); 201 {order}.
        if path == "/api/v1/standing-orders":
            with state_lock:
                trust_on = state["trust_rules"] or state["run_page"]
                standing_order_posts.append(body)
            if not trust_on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            rule = body.get("rule") or {}
            trigger = rule.get("trigger") or {}
            if not str(body.get("text") or "").strip() or rule.get("action") not in ("approve", "hold", "notify"):
                return self._json(400, {"error": "Invalid request body"})
            receipt = (trigger.get("phase") == "plan_approval" and trigger.get("band") == "0-19"
                       and bool(trigger.get("preset")) and (rule.get("scope") or {}).get("kind") == "project")
            if rule.get("action") == "approve" and (trigger.get("kind") == "finding"
                                                   or trigger.get("phase") == "deliver"
                                                   or (trigger.get("phase") == "plan_approval" and not receipt)):
                return self._json(400, {"error": "an order never answers that gate — it always waits for you",
                                        "code": "order_refused"})
            order = {"id": f"so-{len(trust_orders) + 1}", "text": body["text"], "rule": rule, "createdAt": NOW0}
            with state_lock:
                trust_orders.append(order)
            return self._json(201, {"order": order})
        if path == "/api/v1/governance/deadletters/replay":
            dry = body.get("dryRun") is True
            with state_lock:
                replay_posts.append({"dryRun": dry})
                gov = state["governance"]
            if gov != "deadletters":
                return self._json(409, {"error": "this daemon resolved no governance store — there is nothing to replay into"})
            block = GOVERNANCE_BLOCKS["deadletters"]["deadletters"]
            fold = {k: v for k, v in block.items() if k != "legacyOutbox"}
            base = {"outbox": GOV_OUTBOX, "store": {"path": GOV_STORE, "source": "flag"}, "read": block["count"],
                    "alreadyPresent": None, "note": None, "blocker": None}
            if dry:
                return self._json(200, {**base, "archive": None, "replayed": 0, "failed": 0, "dryRun": True, "fold": fold})
            with state_lock:
                state["governance"] = "healthy"
            return self._json(200, {**base, "archive": GOV_OUTBOX + ".replayed-w2", "replayed": block["count"] - 8,
                                    "alreadyPresent": 0, "failed": 8, "dryRun": False})
        # Wave C (idea 12): crew's POST /proposals {content, project?, source?} (api-types 0.54.0)
        # files ONE preference as a pending memory proposal — it joins the `proposals` queue, so
        # GET /proposals lists it. None ⇒ the unknown-route 404 of a daemon predating the route.
        if path == "/api/v1/proposals":
            allowed = {"content", "project", "source"}
            content = body.get("content") if isinstance(body, dict) else None
            with state_lock:
                proposal_posts.append(body)
                rows = state["proposals"]
                if rows is None:
                    return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
                if (not isinstance(content, str) or not content.strip()
                        or any(k not in allowed for k in body)):
                    return self._json(400, {"error": "Invalid proposal body"})
                pid = f"pref-{len(proposal_posts)}"
                payload = {"content": content.strip(), "tier": "semantic", "capture": "preference"}
                if body.get("source"):
                    payload["source"] = body["source"]
                state["proposals"] = list(rows) + [{
                    "id": pid, "kind_type": "memory", "payload": payload,
                    "facets": {"project": body["project"]} if body.get("project") else {},
                    "provenance": {}, "state": "pending", "created_at": int(time.time())}]
            return self._json(201, {"id": pid})
        # Wave B (idea 4): crew's POST /proposals/<id>/approve over the `proposals` switch.
        m = re.match(r"^/api/v1/proposals/([^/]+)/approve$", path)
        if m:
            pid = urllib.parse.unquote(m.group(1))
            with state_lock:
                approve_posts.append(pid)
                rows = state["proposals"]
                row = next((r for r in (rows or []) if r.get("id") == pid and r.get("state") == "pending"), None)
                if row is not None:
                    state["proposals"] = [dict(r, state="approved") if r is row else r for r in rows]
            if rows is None:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            if row is None:
                return self._json(502, {"error": f"proposal {pid} is not pending"})
            if row.get("kind_type") == "memory":
                return self._json(200, {"outcome": "promoted", "active_id": f"mem-active-{pid}"})
            return self._json(200, {"outcome": "handed_off", "payload": row.get("payload"),
                                    "landing": {"outcome": "landed", "ruleId": f"proposal:{pid}"}})
        # Wave 2 (studio#251): the re-onboard remedy's wire, POST /repos/<id>/onboard → {runId}.
        m = re.match(r"^/api/v1/repos/([^/]+)/onboard$", path)
        if m:
            with state_lock:
                findings_on = state["repo_findings"]
                idx_ids = {r["id"] for r in never_indexed_repos(state["never_indexed"], False)}
            rid = urllib.parse.unquote(m.group(1))
            if rid in idx_ids:
                with chat_state_lock:
                    onboard_posts.append(rid)
                return self._json(201, {"runId": f"r-onboard-{rid}"})
            if not findings_on or rid != REPO_ID:
                return self._json(404, {"error": f"Repo {rid} not found"})
            with chat_state_lock:
                onboard_posts.append(rid)
            return self._json(200, {"runId": "r-reonboard"})
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
            with state_lock:
                ask_on = state["ask_path"]
            if ask_on and urllib.parse.unquote(parts[4]) in ask_chats:
                code, answer = ask_message(urllib.parse.unquote(parts[4]), body.get("text", ""))
                return self._json(code, answer)
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
                return self._json(200, {"seats": live, "turnId": f"t-{round_n}"})
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
            # `turnId` (api-types 0.38.0) the way the daemon answers a send: `t-<n>` per chat, so a
            # rig can land a turn-stamped frame (`chatCitations`, crew#561) that resolves to it.
            chat_id = urllib.parse.unquote(parts[4])
            with chat_state_lock:
                if not replies_on:
                    chat_send_count[chat_id] = chat_send_count.get(chat_id, 0) + 1
                turn_n = chat_send_count.get(chat_id, 1)
            return self._json(200, {"seats": [], "turnId": f"t-{turn_n}"})
        return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})

    def do_PUT(self):  # noqa: N802 (stdlib naming)
        path = urllib.parse.urlparse(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self._walkthrough_route("PUT", body if isinstance(body, dict) else {}):
            return None
        if self._demo_route("PUT", body if isinstance(body, dict) else {}):
            return None
        # Behaviour 10: PUT /standing-orders/away — turning it on sweeps the open gates.
        if path == "/api/v1/standing-orders/away":
            with state_lock:
                on = state["standing_orders"]
                if on and isinstance(body, dict) and isinstance(body.get("away"), bool):
                    if STANDING["away"] != body["away"]:
                        STANDING["away"] = body["away"]
                        STANDING["awaySince"] = int(time.time() * 1000) if body["away"] else None
                        if body["away"]:
                            standing_sweep()
                snap = json.loads(json.dumps(STANDING))
            if not on:
                return self._json(404, {"error": f"Route PUT:{path} not found"})
            return self._json(200, snap)
        # PUT /api/v1/settings — merge the body's top-level keys, answer the
        # merged store (the daemon's contract; studio.appearance replaces whole).
        if path == "/api/v1/settings":
            with state_lock:
                if isinstance(body, dict):
                    settings_store.update(body)
                snapshot = json.loads(json.dumps(settings_store))
            return self._json(200, {"settings": snapshot})
        # Idea 15: PUT /deliveries/freeze {frozen, reason?} — crew#694's strict body, audited there.
        if path == "/api/v1/deliveries/freeze":
            with state_lock:
                on = state["home_runs"]
            if not on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            if not isinstance(body, dict) or not isinstance(body.get("frozen"), bool) \
                    or set(body) - {"frozen", "reason"}:
                return self._json(400, {"error": "Invalid request body: expected {frozen: boolean, reason?: string}"})
            with state_lock:
                if body["frozen"] and not delivery_freeze["frozen"]:
                    delivery_freeze.update({"frozen": True, "since": iso(NOW0), "by": "local",
                                            "reason": body.get("reason") or None})
                elif not body["frozen"]:
                    delivery_freeze.clear()
                    delivery_freeze.update(FREEZE_THAWED)
                snapshot = dict(delivery_freeze)
            return self._json(200, snapshot)
        # Idea 11: PUT /presets/:name {steps, projectId?} — crew's preset save (0.47.0), recorded.
        m = re.match(r"^/api/v1/presets/([^/]+)$", path)
        if m:
            with state_lock:
                on = state["home_runs"] or state["team_plan"]
            if not on:
                return self._json(404, {"error": f"w2 fixture: no such endpoint {path}"})
            name = urllib.parse.unquote(m.group(1))
            steps = body.get("steps") if isinstance(body, dict) else None
            if not isinstance(steps, list) or not steps or set(body) - {"steps", "projectId"}:
                return self._json(400, {"error": "Invalid request body"})
            if any(p["name"] == name and p["created_by"] == "builtin" for p in TEAM_PRESETS) and not body.get("projectId"):
                return self._json(409, {"error": f"preset_builtin_readonly: `{name}` is a built-in preset"})
            with state_lock:
                preset_put_log.append({"name": name, "body": body})
            return self._json(200, {"preset": {"name": name, "scope": "global", "steps": steps,
                                               "created_by": "api", "updated_at": NOW0}})
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
        m = re.match(r"^/api/v1/standing-orders/([^/]+)$", path)
        if m:
            oid = urllib.parse.unquote(m.group(1))
            with state_lock:
                before = len(STANDING["orders"])
                STANDING["orders"] = [o for o in STANDING["orders"] if o["id"] != oid]
                removed = len(STANDING["orders"]) < before
            return self._json(200, {"removed": True}) if removed else self._json(404, {"error": "Standing order not found"})
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
