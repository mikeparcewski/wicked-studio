# Changelog

All notable changes to **wicked-studio** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x: minor versions may contain breaking changes).

Backfilled 2026-08-29 from the git history and the npm registry; release dates are the
npm publish dates. Every version listed here exists on
[npm](https://www.npmjs.com/package/wicked-studio?activeTab=versions).

## [Unreleased]
### Fixed
- **Archive control for terminal runs in the run header and on WorkPage rows (#219, refs #211).**
  Studio could *unarchive* a run (crew#265) but never *archive* one — `archiveRun(id, false)` was the
  wire's only caller, so a terminal run left the active work list only through the API and the
  seed-surfaces suite's RUN-ARC journey (#211) had to run `[SUBSTITUTE]`. The run header of every
  terminal run (`completed` / `failed` / `cancelled`, on both `/runs/:id` and `/p/:pid/build/:runId`)
  now carries **Archive** (`run-archive`) in the slot Cancel occupies on a live run: confirm-gated
  (`run-archive-confirm`, Yes / Keep, Escape = Keep), refusals surfaced inline as `role="alert"`
  (`run-archive-error`) with the confirm held open, and on success the run index refreshes and the
  view navigates back so the run leaves the list. Every terminal Work row — the Completed / Failed /
  Cancelled groups on the All tab and the filtered Completed / Failed / Cancelled tab views — gets
  an inline **Archive** button (`run-archive-row`) beside the run, the shipped Unarchive-row pattern;
  Active rows and live runs get nothing. Both paths `POST /runs/:id/archive {archived: true}`;
  Unarchive is unchanged.
  - *Review findings landed in-wave (independent review of #268, M-1 / L-1 / L-2):* this entry; the
    header offers no Archive on an already-archived run (`session.archived_at` set — reachable
    through the Archived chip), so there is nothing to re-archive; and the WorkPage tests now cover
    the filtered tab views and the Failed / Cancelled groups, not only Completed.

### Fixed
- **The composer promised a push with no gate (acceptance finding F-E2E-030).** Under the default
  "First gate" posture the deliver notice read "When this finishes it pushes its branch → opens a
  PR" — and that is exactly what run `0ab5ccb8` did, unattended. The engine now gates the deliver
  phase by default (wicked-core#456) and crew accepts `deliverGate: 'human' | 'auto'`
  (wicked-crew#543). The composer says WHEN the push happens: the default postures read "pauses
  at the deliver gate; approve it and the run pushes its branch → opens a PR on <repo>", the
  confirm line gains `deliver: after you approve the deliver gate` (`launch-confirm-deliver`), and
  the body sends NO opt-out. Only the explicitly unattended postures — Autonomous, or the gate
  option now labelled **"No gates · auto-deliver"** — send `deliverGate: 'auto'`, and their notice
  says "with NO deliver gate — this posture is auto-deliver". The intake plan's deliver row names
  the gate from `session.auto_deliver` ("human gate before it pushes its branch + opens the PR" /
  "auto-deliver — … no gate"; `intake-plan-deliver-gate`) and stays silent on an engine that
  predates the gate, so no promise is made that the engine cannot keep. The composer makes the
  same promise only when the DAEMON can keep it: it reads `GET /health.capabilities.deliverGate`
  (crew ≥ 0.7.33) and, against a daemon without it, says "this daemon delivers WITHOUT a deliver
  gate (upgrade crew to 0.7.33+ to confirm the push first)", offers no auto-deliver option and
  never sends `deliverGate` (the older launch schema rejects it). "No gates" is labelled
  auto-deliver only where the select is honoured (not in Ask mode, where every unit is gated).


## [0.5.8] — 2026-09-12
_The published bundle is built against `wicked-crew-api-types` **0.36.0** — the exact
devDependency pin, unchanged from 0.5.7 (#264); this cut lands the fix that reads the `test_sets`
that wire actually declares (#266)._
### Fixed
- **The Test landing reads the daemon's top-level `test_sets` (api-types 0.36.0) — counts, PLAN and
  PR per produced set.** The 0.5.7 landing (`CampaignsPage`, the Home "Test" door, `campaignStats`)
  read a PROVISIONAL row-level `Campaign.test_set` / `RunGroup.test_set` join that 0.36.0 never
  declared, so against a 0.36.0 daemon no card showed a produced set. The daemon serves the sets as
  `CampaignsListResponse.test_sets: TestSet[]` (snake_case, `run_id`-keyed, tagged with the
  `qe-tests-<repo>` label an authoring run is filed under); `listCampaigns` now normalizes them
  (`testSets: null` = a pre-0.36 daemon — absence, never a fabricated zero), the store holds them,
  and the fold joins them onto each campaign / label-group card by `run_id` (and by label for a
  group). Each set renders its verified chip, `produced · executed · passed · failed` (plus
  "· N not executed" when the verify phase left tests unrun), the PLAN (opens the producing run)
  and the engine's PR (`isPrUrl`-gated); the Tests tile's context and the Home door append the
  registered sets once the wire carries them. The provisional join, its `testSetOf` row reader and
  the dead `POST /testing/recon` + `workflow` ladder rung (`qe-author-tests` shipped together with
  `POST /testing/author`, so no daemon lists the workflow without the route; 0.36.0's
  `TestingReconBody` declares no `workflow` key) are deleted — `tests/wave6Wire.test.ts` now guards
  that neither shape returns. Fixtures (`tests/fixtures/wave6.ts`, `e2e/uxfix_fixture.py`) serve the
  real 0.36.0 shape; the testid inventory gains `campaign-card-testset-{verified,pr,more}`.
  - *Review findings landed in-wave (independent review of #266, F-1..F-4, R2-1):* the Tests
    tile's context now LEADS with the sets word — painted as `1 set · 11/11 passed`, sized to clear
    the `…` glyph at 1440 px, with the unabridged `1 test set · 11/11 passed …` line as the span's
    hover `title` — the redundant "N ad-hoc group" word is gone, and every `StatTile` context
    carries its full text as `title` (`stat-context`; a `contextTitle` prop when the painted line
    is an abridgement); sets no card can show are said as `· N
    unattributed` and `test_sets` rows served without a `run_id` as `· N malformed` (never
    folded away — `listCampaigns` now returns `malformedTestSets`); a 0.36 daemon's real zero
    renders as `no test sets registered yet` on the tile and `N tests · 0 test sets` on the Home
    door, while a pre-0.36 daemon still says nothing about sets; the launch panel reads
    `/testing/author`'s `runs[].label` and says `filed under qe-tests-<repo> on the Test landing
    — the set fills in when the verify phase registers it` (`testing-launch-filed-label`) instead
    of "appears … when the run registers its test set". The Chrome rig asserts the sets word is
    VISIBLE (glyph box inside the context span), not merely present in `textContent`.

## [0.5.7] — 2026-09-11
_The published bundle is built against `wicked-crew-api-types` **0.36.0** — the exact
devDependency pin on this cut (#264), and the wire the bundle's mirrors and `satisfies` checks are
typed against: both wire mirrors (`src/api/skills-wire.ts`, `src/api/wave6-wire.ts`) are byte-pinned
to it. Two wire gaps (a row-level `Campaign.test_set` / `RunGroup.test_set` join;
`TestingReconBody.workflow`) stay studio-worded and test-guarded — see *Changed* below._
### Added
- **New test launches the governed `qe-author-tests` workflow; the Test landing shows the produced
  set; honest UNGATED / degraded gates; a files view once the worktree is gone** (wave 6 — the
  governed testing journey: acceptance findings F-075 / F-076 / F-7R2-003 / -005 / -006 / -008 /
  -009 / -010 / -011 / -012 / -013 / -014 / -017, studio half). Develops against a PROVISIONAL wire
  mirror (`src/api/wave6-wire.ts`) spelled exactly as the wave-6 briefs name the fields; every
  reader is null-safe, so an older daemon changes nothing. `tests/wave6Wire.test.ts` pins the
  posture: a pin bump to ≥ 0.36.0 without a VERBATIM re-vendor fails the suite (the #257 pattern).
  - *Routes* (F-075 / F-7R2-009): `/testing` and the retired `/testing/harness` land on the TEST
    landing (`/testing/campaigns`), as `src/api/testing.ts` documented all along; Evals keeps
    `/testing/evals` as a sub-page; the rail heading follows. Home's "Run recon" verb is now
    **New test** and opens the launch panel (`?new=test`). "Add with chat" on the landing is
    labelled **Add testing rules** — it authors testing STEERING RULES, not tests.
  - *New test is governed* (F-7R2-003 / -004 / -012): the panel reads `GET /workflows` on mount;
    a daemon that lists `qe-author-tests` gets the governed launch (the chip names the five
    phases: recon → author → verify → review → deliver — the ENGINE's deliver phase opens the PR,
    never the worker), and `launchGovernedTest` walks the wire ladder, each step only when the
    previous wire is ABSENT: `POST /testing/author` → `POST /testing/recon` + `workflow` (a strict
    schema naming it unrecognized ⇒) → one `POST /runs {workflow, repoRef, projectId,
    humanConfirm: 'before:1'[, groupLabel]}` per resolved repo. A daemon that lists no such
    workflow shows the honest banner **"this daemon has no governed test workflow — plain run"**
    BEFORE the launch and takes today's free-text recon. Every named refusal surfaces untouched.
  - *Project chips are droppable* (F-076 / F-7R2-010): "attach the project, drop repos". A
    narrowed project launches one `POST /runs` per remaining repo — `repoRef` scopes, `projectId`
    FILES — so an explicit single repo keeps its `project_id` (the pinned recon body's `projectId`
    would union the dropped members back in); the dropped line names them and offers "restore
    all"; every member dropped is refused on the button, before any wire call.
  - *After launch* (F-7R2-011): the panel LINKS every launched run (`testing-launch-fanout-run`,
    the single run too), names the workflow, the wire it rode (`testing-launch-route`) and the
    test/group label, then the waiting line; the intake gate arrives on the app's one /ws fold.
  - *The intake card shows the PLAN* (F-7R2-008): on the pre-run gate for the run's first unit —
    the panel's copy of the card and the run page's — `IntakePlan` lists every planned phase with
    its executor (agent / tool), skill, `writes code`, `evaluator ≠ creator`, and seat (the one
    routed, else "council picks from <pool>"), read once off `GET /runs/:id` when the gate arrives.
  - *The Test landing shows the produced set* (F-7R2-014): a card's `test_set` (the campaign
    registration a completed run lands) renders "N test files · T tests · E executed · P passed ·
    F failed" — the counts the VERIFY phase re-derived, with "K never executed" when
    `executed < tests` — plus the PLAN path; the workflow chip reads `qe-author-tests` off the live
    runs from launch. A pre-0.36 row renders no counts (absence, never a fabricated zero). The
    empty state says what fills it.
  - *Honest UNGATED gates* (F-7R2-005 / -017): `gateEvaluated.ungated` / `ungatedReason` win over
    the card's fold — the gate card reads **"UNGATED — no eligible judge seat"** (the floor that DID
    run is still listed; the judge axis is said not held), the run-page verdict card carries the
    same line, and the narrator says "Gate UNGATED on <phase> — <reason>; repository checks ran,
    no distinct judge" — never "Checks ran — pass" for a judge-less gate.
  - *Degraded councils* (F-7R2-006 / F-4R2-007): `unitDistributed.degradedReason` renders on the
    run head (`run-degraded`: "council degraded: 4 of 5 seats benched: …", with the affected-unit
    count) and on the routing line in the feed. The narrator now reads the camelCase
    `agreementPct` the engine actually emits (api-types ≤ 0.35.0 declared `agreement_pct`, which
    the wire never carried — so the pct was always missing); the snake_case read stays as the
    fallback until the 0.36.0 pin declares camelCase.
  - *The remote-write fence* (F-7R2-012): a `workerToolCallDenied` (a creator/evaluator seat's
    `git push` / `gh pr create` …) renders in the feed with the seat, role, the refused command as
    code and the remedy — the engine's, or "delivery is performed by the run's deliver phase".
  - *Files view once the worktree is gone* (F-7R2-013): `GET /runs/:id/diff` answering
    `source: "branch"` is labelled as the run branch vs its base (committed work shown; an empty
    branch says so); a pre-0.36 daemon's 409 cause card names the run branch and the upgrade. The
    run page's Files section offers **Full diff** on EVERY state — the empty one included, which
    was exactly the completed run with no files view.
  - Tests: the launch ladder (22), the panel (14), the gate model + cards (9), the narrator (13),
    the files view (6), the landing card (8), the run head (6), the mirror posture (7); the
    Playwright loopback rig `e2e/governed_testing_test.py` (fixture switch `governed_testing` /
    `governed_testing_workflow_absent`: GET /workflows, POST /testing/author + the intake gate
    over /ws, GET /campaigns with `test_set`, the completed run's degraded / UNGATED / refused-write
    trail, the branch-source diff) at 1440x700 and 400px; testid inventory regenerated. Wire gaps
    recorded for the crew PR: the recon body's `projectId` cannot express a narrowed project; the
    campaign registration shape (`test_set`) and the `/testing/author` route are provisional names.
  - *Pin*: `wicked-crew-api-types` **0.35.0** exact (crew#533 — published while this landed; 0.36.0,
    the wave-6 wire, was not). The skills mirror + `tests/fixtures/api-types-0.35.0-skills.d.ts` are
    re-vendored by label (the 0.34.0 skills and `diagnostics.skills` blocks are byte-identical in
    0.35.0, shifted to `index.d.ts:1768-2186` / `4223-4272`); two additive catch-ups — the Health
    rail names the widened `info` finding severity, the wave-2 fixture's `legacyOutbox` carries the
    new required `scope`. The wave-6 mirror stays PROVISIONAL under 0.35.0 (none of its names are
    declared there — `tests/wave6Wire.test.ts` asserts exactly that).
  - *Skills page recovery from `GET /skills` 503* (acceptance findings F-A45-001 HIGH / F-A45-002
    MEDIUM — the F-083 stale-rules refusal "current does not point at a valid published snapshot …
    re-publish or remove the link"). The unavailable card used to offer only Refresh (a second 503);
    the remedy the finding names was unreachable. It now carries the engine's word — `GET
    /diagnostics` → `skills.state` + every `findings[]` message (`skills-recovery-finding`) — and two
    controls with pending/result states: **Refresh baseline** (`POST /skills/refresh-baseline`) and
    **Publish** (`POST /skills/publish`). Every mutation is CAS-guarded by the revision the 503
    withholds, so the page learns it through `POST /skills/analyze` (the dry run reads the MANIFEST,
    not `current`) and says so when analyze 503s too (the manifest itself is unreadable — the
    daemon host's job). After a Refresh the baseline is STAGED and the catalog still answers 503
    until Publish: the result renders inline ("garden 12.33.0 staged (… taken · kept · added ·
    removed · conflicts) — publish to activate"), the engine line is re-read, the catalog is NOT
    (F-A45-002). A Publish that writes a snapshot re-reads the catalog and flips the page to the
    loaded state with the note; a blocked publish renders its findings on the card. A 409 says the
    catalog moved and re-learns the revision on the next click.
  - *One roster story on the composer and the rail* (F-A45-006 studio half). The composer's seat
    warning derived from the `signed_in` file/env heuristic alone, so it said "codex + opencode
    aren't signed in" while the Health rail — reading crew#533's `auth` / `council_eligible` /
    `free_tier` — showed opencode green "no sign-in needed". Both now read the rail's
    `seatStandingWord`: `auth: not_required` is never a sign-in problem, `auth: signed_out` warns
    even when the heuristic is null, a daemon-declared `council_eligible: false` gets its own
    sentence with the daemon's reason (`ineligible-warning`); a pre-0.35 roster keeps the heuristic.
  - *`/vibe` and the Home door count what the daemon serves — without spawning a bridge per project*
    (F-A45-008 MEDIUM, bounded by the independent review of #263, F-1/F-2). The corpus listed only
    "projects opened this session" (the docs cache's deposits), so a fresh browser on a daemon holding
    three documents read "DOCUMENTS 0" and Home said "Vibe 0 documents". A per-project docs GET
    (`GET /projects/:id/interactive/api/docs`, the only per-project route) MATERIALIZES the project's
    partition and cold-starts one `wicked-interactive` bridge (~60 s) — so NOTHING fans out on mount.
    The one request the corpus surfaces and Home make on their own is the CHEAP daemon-wide index
    `GET /interactive/docs` (api-types 0.36.0, the wave-6 crew PR — served from the state-home doc
    ledgers, no bridge; presence-checked: a pre-0.36 daemon answers 404 and the corpus stays "documents
    in opened projects (k of N)" — the honest word, never "all N projects" on the strength of unasked
    bridges). The per-project fan-out is the operator's explicit `[load for all projects]` gesture:
    SEQUENTIAL (one bridge at a time), the project being asked named in the progress line,
    cancellable (`cancel` stops after the current project answers; what landed stays). A project
    whose bridge cannot answer (503 `bridge_unavailable`) is recorded as UNREACHABLE with the daemon's
    sentence — the label reads "N projects · M unreachable", the count excludes it, the button stays
    live for it — never counted as "no documents". The per-project view is a FILTER chip (`All
    projects` / one per project with live counts), the CURRENT project — read off the router's
    pathname, so it follows navigation — first; with no project named the corpus is newest-first.
    Home's Vibe door says "N documents in opened projects" until a census (the index, or the gesture)
    has answered for every project. The docsCache header is amended accordingly.
  - *Independent review of #263 (REVISE → fixes, one bundled commit)*: F-1/F-2 above; F-3 the launch
    button is disabled ("resolving workflows…") while `GET /workflows` is pending — a click could
    launch a silent plain run — and a failed read shows the banner before enabling the plain run as
    an explicit choice; F-4 a NARROWED project launches through `POST /testing/author` (projectId +
    the exact `repoRefs`) when the daemon has it, the per-run `POST /runs` fan only as the
    route-absent fallback (recorded wire gap: that fan's `deliver: 'pr'` default appends a second
    deliver phase to a def that already ends in one); F-5 a PASS whose frame says `judgeCli: null`
    (the single-seat floor-only case) appends "no distinct judge reviewed this verdict (floor only)"
    on the gate card and "— no distinct judge" in the feed; F-6 the mirror-posture test also guards
    studio's own spellings (`test_set`, `testing/author`, `TestSetCounts`) and requires every wave-6
    declaration inside a VERBATIM region at the pin; F-7 the mirror's `workerToolCallDenied` carries
    `carrier` and `tool` (the feed names the tool); F-8 `ApiError.body` keeps a refusal's JSON, so a
    skills 409's `revision` is adopted and the next click needs no second analyze; F-9 the governed
    rig's drop-chip scene is real (the fixture project carries a `crew.repo` member); F-10 the fan
    note says "each pauses at its own intake gate; approve them one at a time"; F-11 the degraded
    count is distinct ords; F-12 the current project follows the router; F-13 the inventory scan
    has a 30 s budget. *r2 (APPROVE)*: R2-1 the `/testing/author` narrowing is stated as a
    REQUIREMENT on the crew PR (projectId = filing, repoRefs = the exact scope — not the recon
    route's union) and guarded — an answer with more `runIds` than requested repos renders "the
    daemon launched N runs for M requested repositories — it did not honour the narrowed scope"
    (`testing-launch-scope-note`) and the scope is never claimed; R2-2 the Vibe tile title follows
    the census word; R2-3 the fixture answers the daemon-wide index with Fastify's bare `Not Found`
    so the rig exercises the presence-check's `absent` branch; R2-4 the gesture never falls back
    to "all" silently — "every project is already listed — reload" when nothing is unknown.
  - Tests: `SkillsPage.recovery` (9), `ChatInput.seatStanding` (5), `MadeDashboard.corpus` (12 — no
    fan-out on mount, the index, the sequential + cancellable gesture, unreachable bridges); the
    `/vibe` + Home loopback rig `e2e/vibe_corpus_test.py` (4/4 steps — the fresh page asks no bridge
    beyond the board model's rooted reads, the gesture never has two docs GETs in flight); both rigs
    accept `PLAYWRIGHT_CHANNEL` (e.g. `chrome`) to run on an installed browser when the Playwright
    cache is absent (review R2-6 — a rig never installs anything); testid inventory regenerated.

### Changed
- **Pin `wicked-crew-api-types` 0.36.0** (the wave-6 wire, crew#536; `skills.stale-rules`, crew#535) and
  re-vendor BOTH wire mirrors from the installed `index.d.ts`. The skills mirror + fixture
  (`tests/fixtures/api-types-0.36.0-skills.d.ts`, `index.d.ts:1969-2419` / `4682-4741`) carry the
  ADDITIVE block: `SkillsManifestResponse.current.rules` / `drift`, `PortabilityRulesIdentity`,
  `SnapshotRowDrift`, the `skills.stale-rules` finding kind. The wave-6 mirror (`src/api/wave6-wire.ts`)
  drops its PROVISIONAL declarations for 14 VERBATIM regions byte-pinned by `tests/wave6Wire.test.ts`
  against the installed package: `POST /testing/author` (`TestingAuthorBody` / `TestingAuthorResponse`
  with `runs[]`, `plan`, `gate`, `scope`; the registered `TestSet`), `CampaignsListResponse.test_sets`,
  `RunDiff.source` / `branch` / `base`, `gateEvaluated.ungated` / `ungatedReason` / `floorNote` /
  `judgeSkippedReason`, `repoChecksEvaluated.sandboxLevel` / `sandboxError` / `detectError`,
  `unitDistributed` camelCase (`seatConstraint` included), `workerToolCallDenied` (`carrier` / `role` /
  `tool`), the `acpFallback` auth kinds, `runBaseResolved.runBranch`, the roster's `auth` /
  `auth_source` / `free_tier_source` / `council_eligible` / `council_bench`, chat `refused[]`, the
  `GET /interactive/docs` rows. The `unitDistributed` snake_case fallbacks (`agreement_pct`,
  `degraded_reason`) are dropped — 0.36.0 declares them `@deprecated`; the engine never emitted them.
  Two WIRE GAPS stay studio-worded and test-guarded: a row-level `Campaign.test_set` /
  `RunGroup.test_set` join (0.36.0 serves the sets as top-level `test_sets: TestSet[]`, so the Test
  landing's per-card counts render only when a daemon joins the row) and `TestingReconBody.workflow`
  (the launch ladder's middle rung; a 0.36.0 daemon answers the first rung, `POST /testing/author`).

## [0.5.6] — 2026-09-11
_The published bundle is built against `wicked-crew-api-types` **0.34.0** — the exact
devDependency pin on this cut, and the wire the bundle's mirrors and `satisfies` checks are typed
against. The crew#533 roster fields named below (`auth` / `free_tier` / `council_eligible` /
`council_ineligible_reason`, api-types 0.35.0) are read defensively when a daemon sends them;
the pin itself moves in a later release._
### Added
- **Reassign to <seat> + retry on a failure-escalation gate** (phase7-r2 acceptance finding
  F-7R2-007, HIGH). At every "Unit N failed and triage escalated" gate the card offered Approve — a
  retry on the SAME dead seat — Approve + steer, Reject and Cancel; recovery was
  `POST /api/v1/runs/:id/reassign {cli}` by hand, five times, racing the re-dispatch window. Both
  gate cards (the run page's `SteeringGate`, the landing inbox's card) now carry `ReassignControl`:
  the run's OTHER seats (`session.clis` minus the seat that failed the unit) with the roster's word
  on each — signed-in first, a seat with no sign-in observed hedged as "may fail or be benched"
  (today's roster carries no council-eligibility field; crew#533's `auth` / `council_eligible` /
  `council_ineligible_reason` / `free_tier` are read when a daemon sends them — `seatStanding`),
  inactive last, daemon-declared ineligible after that — and one action that approves the retry
  (the steer text rides it), waits for the run to resume (`GET /runs/:id` until `executing`, 30 s
  bounded — the daemon reassigns only an executing run), then calls the existing
  `POST /runs/:id/reassign {cli}` (`api.reassignRun`). Every step is stated
  (`steering-reassign-status`); a refused reassign leaves the approve standing, shows the daemon's
  sentence and offers the reassign alone again. Plain Approve is relabelled "Approve (retry on
  <seat>)" on that gate. A host without the run view (the steering-author and testing-launch panels)
  reads the run once for its pool on a failure escalation only. Recorded on the steering timeline as
  `reassign`. (Wire gap, recorded: the reassign route refuses an `awaiting_human` run, so the approve
  must precede it.)
- **The wicked-core#431 wire on the gate, the delivery card, the run head and the feed** (#250/#431
  consumer follow-through — pins `wicked-crew-api-types` 0.33.0, the wire wicked-crew#527 publishes).
  Every field is read off the frames the daemon sends and rendered only when present, so an older
  daemon changes nothing.
  - *Gate card — the judge seat* (`gateEvaluated.judgeCli` / `judgeDistinct`): the verdict header
    names WHO judged (`· judge: codex`); `judgeDistinct: false` adds a same-seat warning — the judge
    fell back to the single default runner, so evaluator ≠ creator is not held on that verdict.
  - *Denial card — the restored tree* (`evaluatorMutatedWorktree.restored` + `worktreeRestored`):
    a worktree-guard denial the engine already remedied says "the evaluator's edit was discarded and
    the creator's verified tree restored", lists the discarded paths from the restore record, and
    gives `git show refs/wicked/suggestions/<run>/<ord>/<attempt>` as copyable code — with a real,
    keyboard-reachable **copy** button beside it — when the edit was pinned (an honest "not pinned"
    otherwise). **Approve is relabelled "Retry against the restored tree"** (and "Retry + steer") on
    exactly that gate, on the run page's gate card AND the landing inbox's card, from one predicate
    that mirrors the engine's own guard (`denial.source === 'worktree_guard'` and `restored`) — keyed
    on the evidence frames, not on the prompt, which the engine also changed ("confirm to retry the phase" → "Approve to retry the phase
    against the restored tree"; the card's NOT PASS match holds for both spellings). A failed
    restore (`restored: false`) is said, with the engine's error, and the manual remedy stands.
  - *Delivery card / deliver gate — the lift* (`deliverLiftEvaluated`, the deliver ord's
    `repoChecksEvaluated`, the deliver unit's `deliver:` refusal): the rail's Delivery body and a
    gate opened on the deliver unit render what the pre-push lift did — `unchanged` / `lifted`
    (base and tree before → after, the re-verify per check with the forced-install source
    `package-lock.json (forced: lockfile drift)`) / `conflict` (the files, "nothing was rebased and
    nothing was pushed", the LIFT-CONFLICT remedy) / `skipped` / `failed` — and the engine's
    refusal as the wire carries it (`stepFailed.detail` is a head+tail excerpt; the elision marker
    renders dimmed between the kept words), once: the gate card omits its copy when the engine's
    triage-escalate prompt already quotes it, the rail when the rejected unit's framed
    `denial_reason` does. A red check exposes its recorded `stderr` / `stdout` tail (`RepoCheckRun`,
    declared since 0.31.0) as a collapsed, monospace, phone-width-wrapping block — on the deliver
    lift and on the gate card's floor. A deliver unit refused BEFORE the lift (a `HEAD` off the run branch)
    has no lift frame and renders its `deliver:` text on its own; a `passed: false` re-verify over
    all-green rows is explained as the checks having CHANGED the worktree.
  - *Run head / timeline — the base* (`runBaseResolved`): a `base` row on the run's context card and
    a `based on` head row on the evidence timeline — "origin/main @ f57069d · 5 behind · lifted to
    the tip" — plus timeline rows and detail panels for the restore, the lift and a refused write.
  - *Feed*: narration lines for the run base, the creator-tree restore, each lift outcome, a refused
    write-class tool call (`evaluatorToolCallDenied`) and the one deliberate ACP reroute
    (`acpFallback.fallbackKind: 'read_only_requires_wrapped'` — routing, not a failure); every other
    `acpFallback` kind stays silent as before.
  - Tests: unit suites over synthetic frames in the wire's exact spelling (`tests/fixtures/wire433.ts`,
    mirroring wicked-crew's wire-contract literals) for each surface — every frame declared `satisfies`
    its 0.33.0 named type, and `tests/wire433.shapes.test.ts` re-derives the key-set and union diff
    against the installed `index.d.ts` at run time; the deliver fixtures carry what the WIRE carries
    (`stepFailed.detail` as the engine's 150/250 head+tail excerpt, the triage-escalate prompt quoting
    the 450/750 excerpt, `denial_reason` framed as `Worker FAILED on unit N …`); the loopback rig
    `e2e/wire433_test.py` (fixture switch `wire433`) drives the three surfaces in a real browser.

### Changed
- **Skills page: a badge per KIND of portability reason, and the claude-only KPI split** (#256,
  F-079 — pins `wicked-crew-api-types` 0.34.0, whose additive `SkillEntry.portability`
  `{portable, reasons[], evidence?[]}` is the publisher's per-reason verdict, crew#531). The one
  `claude-only` badge lumped "the author used a Claude-only path" together with "this skill needs
  the Claude harness" and hid the fix. Now any AUTHORING reason (`plugin-root`, `skill-dir-var`,
  `cwd-script`, `relative-link`, `cross-skill-path`) renders **not portable**
  (`skills-not-portable-badge`; the hover title lists the reasons and the first `file:line`
  anchor, and is the badge's accessible name) while `requires-harness:claude` alone renders
  **needs Claude harness** (`skills-needs-claude-badge`; title = the reason). The wrapper keeps
  `skills-claude-only-badge` for one release so existing selectors resolve; a daemon that predates
  the field (no `portability`) falls back to `portable` alone — the generic **not portable** badge
  with the previous sentence, never a fabricated reason. The Portable tile's context reads
  `N not portable · M need Claude harness` (the value stays the portable count); the chips
  `not-portable` + `needs-claude` replace `claude-only`; the drawer gains a **Portability** line —
  every reason with one clause of "why", and every `file:line` anchor as monospace text that wraps
  at phone width. `skillCounts` gains `notPortable` / `needsClaude` (`portable + notPortable +
  needsClaude === total`). The wire mirror (`src/api/skills-wire.ts`) and its parity fixture move
  to the 0.34.0 block (picking up the 0.29.0 `installer-copy` source kind and the `skills.source` /
  `skills.manifest` diagnostics findings the 0.27.0 mirror lagged). The Reach KPI group is as wide
  as the two-tile groups so the context line never ellipsizes, the badge's ink is `--ink-high` on the
  amber fill so it reads in both themes, and the page header + verbs wrap at phone width. Review
  follow-through: a `non-portable` analyze/publish finding wears its `portabilityReason` as a chip
  (hover = the reason's one clause), and a `portability` verdict that disagrees with `portable` is
  named — `data-contradiction` on the row and badge, a hint line in the drawer — never swallowed and
  never a different badge (`portable` stays the admission key).

### Fixed
- **Document thread hardening** (phase4-r2 acceptance findings F-4R2-003 / -005 / -006 / -014 / -016).
  - *Export bar — readiness per format* (F-4R2-016): `ExportMenu` looked up the FIRST ready answer for
    the version, so an un-consumed HTML download shadowed the PDF that finished after it — the PDF
    button spun for 120 s while the file already sat in the thread. Each format button now asks for
    its own (version, format) answer and flips the moment its own reply lands. The bridge's additive
    layout report (wicked-interactive#219: `layout`, `layout_source`, `page_size`, `pages`) is read
    null-safely off the export response AND the `export.generated` echo and rendered where present —
    "PDF ready — 2 pages · A4 portrait" under the row, on the anchor's hover text, and on the thread
    line; an older bridge that sends none of it changes nothing.
  - *Heartbeat narration* (F-4R2-005): crew's seams re-emit the current phase's line every ≤15 s, so
    one draft read as 39 narration rows ("Crew phase 2/3: writing the draft (draft)…" ×16). A repeat
    of the NEWEST narration now folds into it — one row, a repeat count and a span that ticks live
    while the thread generates — live and on the restored transcript alike. The same words after
    another line are a new phase, not a fold. (Keying narration on the unit ord needs the wire: the
    seams' `status.posted` frames carry no `unit_ord` / `run_id` — recorded as a crew wire gap.)
  - *Reload mid-run* (F-4R2-006): the composer read `terminal` for up to one heartbeat interval over
    an executing run, because neither the frames nor the announce history carry a run id. On doc open
    the thread now reads `GET /runs` once and adopts the run whose declared write root names the doc
    (`interactive-drafts/<doc>`, `interactive-chats/<doc>-m-…`, `interactive-edits/<doc>-v…`,
    `interactive-demos/<doc>`): a LIVE run flips the composer to `generating` with one honest line
    ("Still in progress — a governed run picked this up before the page reloaded and is executing
    now" — or "…is waiting at a gate" for a run parked at a human gate) and an "open run" link on the
    chip; the run's lifecycle frame ends the live state if the seam's terminal frame never reaches
    the thread.
  - *Deliverable-floor failure, for a human* (F-4R2-014): the crew seams' "The crew run answering
    your ask failed (run …). Reason: [wicked-crew] deliverable floor: … EXPECTED: /abs/path … Inspect
    it via the crew API (GET …)" line rendered verbatim in the document chat. It is now a card: one
    sentence derived from the floor's own EXPECTED path ("The revise step produced no file, so this
    turn did not land — nothing changed in your document"), a link to the run page, a **Retry** on the
    wire that failed — a chat ask re-posts as a chat ask (`doc-actionable-retry[data-kind=resend]`),
    an edit batch re-posts as a batch on the same anchors when the thread still holds its items
    (`data-kind=resend-batch`), and a draft or demo spec — which no message can re-send — gets the way
    back said instead (`doc-run-failed-wayback`) — and the raw dump — absolute paths, issue ids, the
    API URL — whole behind a collapsed "details" fold. All four crew seams' sentences parse, the demo
    seam's "authoring this demo's spec" included. The head send resolves as answered when its run
    fails (one retry, on the card — never a second "send failed · retry" chip on the bubble). The
    failure itself is unchanged: the floor did its job.
  - *Document name before Create* (F-4R2-003): the launch composer shows the id the bridge will mint
    (its own slug of the quoted name or the brief's first six words), live and editable, so a 409
    "doc already exists" is preventable; when one still happens the copy names the colliding document
    with a link ("open it") and offers "use a different name" inline (the next free-looking name in
    the field), with the daemon's own sentence kept, dimmed.
  - Tests: `runFailure`, `runBinding`, `docThread.collapse`, `exportReport` unit suites; the
    `DocumentThread.runFailed` / `DocumentThread.name` component suites; `ExportMenu` gains the
    two-formats case; the loopback rig `e2e/ux5_document_hardening_test.py` (fixture switches
    `export_report`, `doc_fail_floor`, `doc_heartbeat_ms`, `doc_bound_run`, `create_409_existing`)
    drives the export chip, the failure card's Retry, the folded heartbeat, the reload restore and
    the 409 way-out in a real browser.
- **Repo readiness honesty + the project graph control** (phase2-r2 acceptance findings F-2R2-003 /
  -004 / -008 / -009).
  - */repos KPIs and card status* (F-2R2-003): "GRAPHS READY 9 of 9 · INDEX GAPS 0" and "graph ready —
    onboard completed" over two repos whose engine findings said no live graph existed. The graph story
    is now the run history CORRECTED by `RepoEntry.findings` (wicked-core#406): a repo whose finding
    names the re-onboard remedy (`in_tree_code_graph_ignored`, no live graph) or `code_graph_root_
    unresolvable` reads **"graph missing — re-run onboarding"** (`repo-graph-state[data-state=missing]`),
    is excluded from Graphs ready, counted on Index gaps ("2 graph missing · …"), and gets its own
    `Graph missing` filter chip; tooltips say what the reading derives from.
  - *Project dashboard REPOSITORIES rows* (F-2R2-004): the `project-repo-findings` mount existed but
    the row's registry lookup stayed undefined until the attach picker's gesture warmed the repo
    cache. A project WITH repo members now warms the one session cache on mount (still at most one
    `GET /repos` per session), so rows show the finding and **Re-run onboarding**.
  - *Build project graph* (F-2R2-008, studio half): a new `ProjectGraphAction` calls crew's existing
    `POST /api/v1/projects/:id/graph/refresh` (`api.refreshProjectGraph`; standing from the new
    `api.getProjectGraph`, `GET /projects/:id/graph`) with honest state — the build is synchronous on
    the daemon and says so ("Building… indexing 9 repositories — this can take a few minutes"), the
    result is the daemon's indexed / skipped / failed labels. On the project dashboard (standing +
    control, hidden on a daemon without the route) and on the chat scope card for a project scope
    whose reason names an unbuilt graph (the result says it grounds NEW chats — the open chat keeps
    the scope it opened with). The scope card's reason is now customer copy: the raw `POST …`
    sentence is dropped, "repo-less" is said only when the scope names no repository, the daemon's
    own words stay (raw sentence on hover).
  - *Health rail seat rows* (F-2R2-009): an active seat with `signed_in: false` wore a green ✓ and
    "active · signed out" as if nothing followed. It now wears the amber `!` and says **"signed out —
    councils may bench this seat"** (`rail-seat-row[data-signed-in][data-standing]`) — hedged, because
    today's roster (api-types 0.33.0) carries no eligibility field and the rig saw a "signed out" seat
    answer on its free tier — with the free-tier possibility on hover; the heuristic is never folded
    into the heart. When a daemon sends crew#533's `auth` / `free_tier` / `council_eligible` /
    `council_ineligible_reason` (api-types 0.35.0) the row believes those instead ("no sign-in needed
    (<tier>)" with a ✓, "not council-eligible — <the daemon's reason>", "signed out — still
    council-eligible"), and only a daemon-declared ineligibility degrades the heart.
  - Tests: `RepositoriesPanel.graphMissing`, `ProjectRepositories.findings`, `ProjectGraphAction`,
    `GroupChat.graphBuild`, `HealthRailSection.signin`, `ProjectDashboard.graph`.
- **The gate card's verdict block is about THIS gate's unit** (F-7R2-018): on an escalation gate
  about unit N the block rendered the LAST `gateEvaluated` at or below N — unit N−1's vacuous pass
  under a card about the unit that failed. `gateVerdictFor` keys an escalation gate ("Unit N failed
  and triage escalated" / "Unit N verdict is NOT PASS") on unit N's own evaluation AND its latest
  attempt (the last `unitDispatched` for N — an earlier attempt's denial is not this gate's) and
  renders no block when there is none; a pre-run gate keeps the previous phase's verdict
  (F-3R2-006). The block carries `data-phase-attempt`.
- **Narration never says "Checks ran" without a floor** (F-7R2-017): a `gateEvaluated` with
  `hasDeterministicFloor: false` reads "Gate passed without checks on <phase> (ungated)" (no judge,
  no policy), "Judge passed <phase> — no repository checks ran", or "Evaluator policy passed …";
  a denial without a floor reads "Gate denied on <phase>: … — no repository checks ran". A frame
  without the field (an older engine) keeps the legacy wording.
- Tests: `gateVerdictModel.escalation`, `SteeringGate.reassign`, `CenterDashboard.reassign`;
  `narrator.test` gains the floor/no-floor cases.

## [0.5.5] — 2026-09-11
### Added
- **Wave-2 consumers: the repo card renders the engine's findings, the Health rail renders
  `diagnostics.governance`, and New Chat carries a scope control** (#251, #246, #248 — pins
  `wicked-crew-api-types` 0.32.0, the wave-2 crew release).
  - *Repo findings* (#251, wicked-core#406 via crew#517): `RepoEntry.findings[]` renders on the
    Repositories fleet card, the repo detail header and the project page's repo rows — one labelled
    row per finding with the engine's own message. An in-tree `.codegraph/` beside a live graph is a
    tidy-up warning; an in-tree graph with NO live graph (the F-024 checkouts after the upgrade) is an
    error whose row carries **Re-run onboarding**, wired to each surface's existing onboard trigger
    (`POST /repos/:id/onboard`); `code_graph_root_unresolvable` is an error naming the daemon-
    environment fault. Silent for a clean checkout and for a daemon that predates the field.
  - *Governance in Health* (#246, crew#495 / F-022): expanding the rail's Health section also reads
    `GET /diagnostics` and renders the `governance` block — the store path and which rule chose it,
    the record counts (an honest "engine cannot count" for `null`, never 0), the dead-letter fold
    (count as a floor when truncated, by type / by reason, the timestamp range, the outbox, the
    pre-fix HOME outbox) and every finding as a severity-styled row whose message carries the
    `wicked-crew governance replay …` recipe. A `store: null` boot and any error finding turn the
    heart red (and show the collapsed-header dot) and degrade the home board's **Governed** tile
    (fail-coloured, the reason underneath — never a clean percentage over evidence that is not
    landing); a warning degrades the heart to amber. A daemon without the block, or without the
    route, reads "not reported by this daemon".
  - *Scoped New Chat* (#248, crew#502 / F-067): the create window carries a **Scope** control —
    *All project repos* (the default once a project is bound: `projectId` alone rides the open and
    the daemon scopes to every `crew.repo` member), *Choose repos…* (a multi-select from
    `GET /repos`, loaded on that gesture; sends `repoRefs` by id) and *Unscoped* (an explicit click).
    An Unfiled chat with no choice does not open on send — the gap is stated on the row, nothing is
    posted, the draft stays. A scoped open with the default (untouched) seat chips omits `clis`, so
    the daemon admits only governed seats and the 201 re-seeds the chips; an edited selection rides
    as asked and refused seats say why. The opened chat states `ChatOpenResponse.scope` under the header: the
    repositories (names; paths on hover), read-only, whether a code graph grounds the seats and the
    daemon's reason when not, and any project member the registry no longer knows; a rejoin states
    `ChatDetailResponse.scope`, and a daemon that said nothing is reported as "not stated". The
    route's refusals render as inline sentences by status — 404 (every missing ref named), 400
    (an ambiguous name → name it by id), 409 (a daemon-side conflict), 501 (the engine predates chat
    scope, with a **Continue unscoped** fallback that mints a fresh unscoped chat outside the shell).

### Fixed
- **Gate cards state the evaluator verdict they are asking about** (#250, acceptance finding
  F-3R2-006 — the UI half of wicked-core F-036/F-039). The verify pre-run gate ("Approve unit 4
  before it runs") and the deliver gate showed only their prompt while the `fix` phase's PASS —
  criterion, deterministic floor, the judge's reasoning — sat in the already-hydrated event log;
  the DENIED gate said "Unit 4 verdict is NOT PASS — confirm to retry…" while the reason
  (evaluator≠creator, the changed path, the restore command) was only in an expandable thread
  line. `SteeringGate` now renders a `gate-verdict` block from the run's own `gateEvaluated` (the
  last one at or below the gate's ord), with the F-039 `repoChecksEvaluated` floor per check
  (name · exit code · duration · manifest source, plus what was skipped) and the F-036
  `evaluatorMutatedWorktree` record (seat, phase, changed paths, tree ids) attached from the SAME
  fold — a retry's verdict never inherits the previous attempt's evidence. A denial names the
  layer (`denial.source`: worktree guard, repository checks, …) and quotes the engine's reason
  verbatim, backticked commands rendered as copyable code. An ungated phase is labelled a
  default-allow, never a pass (FINDING-025); no evaluation yet ⇒ no block, never a verdict
  fabricated from the prompt. Zero new requests. `wicked-crew-api-types` 0.30.0 → 0.31.0
  (purely additive: `UnitDenial`, `GateEvaluatedEvent.denial`, `RepoChecksEvaluatedEvent`,
  `EvaluatorMutatedWorktreeEvent`). The judge SEAT is not on this wire, so the card claims none.
- **The landing's delivery strip no longer counts onboarding runs as "Vacuous — needs retry"**
  (#250, F-3R2-018). The daemon stamps `delivery: 'vacuous'` on every completed repo-scoped run
  whose worktree is untouched — the DESIGNED outcome of `onboarding` and the other system
  workflows — so a fresh install read "9 Vacuous — needs retry" and buried the one real signal.
  `deliveryCounts` (shared by the strip and the KPI ribbon's Review tile) now licenses the
  vacuous bucket with the Delivery section's own `canDeliver` rule — a deliver unit on the run, or
  a workflow positively known not to be a system one (`is_system`, the one budgeted
  `GET /workflows`) — and the cell reads "Vacuous — no change to deliver": the condition, not a
  prescription. The licence can only withhold a count, never invent one.
- **`.codegraph/estate.db` is no longer tracked** (#220). A fresh clone shipped the operator repo's code-graph
  identity, so onboarding the clone failed with `REPO COLLISION` (and an older wicked-core wrote into the
  tracked file); the graph is per-checkout, built by `wicked-estate index` under the daemon state home
  (wicked-core#406). The file is untracked (local copies are left on disk) and `.codegraph/` is ignored.

## [0.5.4] — 2026-09-10

### Fixed
- **Document thread — bare status frames file under the doc's MOUNTED thread (acceptance finding
  F-045, belt and braces).** Crew's own interactive seams narrated their governed runs with
  `document_id` alone, so every heartbeat was filed under the Unfiled mount while the project-bound
  thread heard nothing and, 90 s into a live run, showed "no worker has picked this up — the
  generation service may be down" with a Retry that would have injected a duplicate. Crew now stamps
  `project_id` on every seam emit (wicked-crew, F-045); independently, `docThread.ingest` files a
  frame that names a doc but no project under the project a `DocumentThread` is currently MOUNTED for
  that doc (`bindDoc`/`unbindDoc`, registered by the component — never inferred from retained
  history, which a previous same-slug thread would poison). The composer claims the doc for its
  project the moment the create is SENT — under the bridge's CANONICAL id (`docSlug`, the bridge's
  own `DOC_NAME` + `slugify` rule replicated byte for byte and pinned against observed ids), which
  is what every frame carries — as a pending binding the mounting thread adopts (released on a
  refused create), so a frame that beats the bridge's answer files on the project thread; a frame
  with no binding at all is HELD and released exactly once onto the thread that binds, expiring to
  Unfiled only when nothing is bound for 10 s (never while a pending create or an ambiguous pair
  is open; an unmount that leaves one thread releases the held frames to it). The stall banner
  therefore appears only after a genuine 90 s silence.

### Added
- **Launch composer — what the document (or demo) is ABOUT and in what format (F-046, studio half).**
  `DocSubjectPicker` offers the project's `crew.repo` members by name as toggles on BOTH the Document
  and the Video launch composer (sent on the create as `repo_refs`; crew validates them against the
  project and grounds the governed draft/demo run on THOSE repositories instead of the project's first
  member — the demo wizard carries them through `demoDraftBody`) and the bridge's four formats on
  both composers (sent as `style`, the demo flow included; "from the brief" sends nothing and lets
  crew infer it from the brief's format words, so a print/A4 brief reaches the bridge's print
  instructions). Discovery has visible
  loading / error states with a retry: the composer refuses to submit while the repositories are
  unknown, unless the user explicitly chooses to create without repository grounding — which the
  thread then records. The picks reset when the launch context changes and after a create.
- **Create body typed from the shared wire declaration.** `CreateDocBody` is now
  `wicked-crew-api-types` 0.30.0's `InteractiveDocCreateRequest` (and `DemoStepDraft` its
  `InteractiveDemoStepDraft`) — no local mirror to drift. `wicked-crew-api-types` is pinned to
  `0.30.0` exactly; the package publishes from wicked-crew on the F-045/F-046 merge.

## [0.5.3] — 2026-09-10

### Fixed
- **Launch composer: a multi-repo project must be told which repo a build run works in (F-028).**
  Choosing a project auto-attached every one of its repos as chips and the launch body took
  `repoRef = repoRefs[0]`, so an explicit tick on the repo the operator meant was silently outranked
  by whichever project member happened to be listed first — acceptance run `1f12f9ab` dispatched a
  studio bug fix into wicked-core with four councils voting before it could be stopped. The chips are
  now **context**: the one repo the run works in is derived by `resolveLaunchTarget`
  (`src/components/launchTarget.ts`, the single definition the Send guard, the wire body, the deliver
  notice and the pre-send summary all read) — Target-repo choice > explicit popover tick > the lone
  attached repo > for **build-kind** work with several candidates **ambiguous, no default** (a
  required `launch-target-repo` select with `launch-target-reason`; Send disabled, Cmd+Enter fires
  nothing; the deliver notice reads `no-target`); non-build launches keep the first repo as context, as
  before. Auto-attached chips keep their `(from project)` marker after a tick (`data-auto-attached`
  is now per chip) and the target chip carries `data-target="true"`. The deliver notice names the
  repo the PR lands on — `→ opens a PR on owner/repo` off the registered `git_url`, the registered
  name otherwise (`repoSlugOf`; `data-deliver-repo`). A pre-send confirmation step (`launch-confirm` with `launch-confirm-workflow` / `-target` / `-gate`;
  `data-workflow` / `data-target` / `data-gate`) reads workflow + target repo + gate posture before
  Send. The operator's **latest act stands**: a tick made after a Target choice wins ("select A,
  then tick B" sends B), and removing the chosen repo drops the choice. The popover's gate select is
  now `launch-gate` (its former `launch-confirm` testid names the confirmation step). Wire unchanged
  (`LaunchRunBody.repoRef`). Tests: `tests/launchTarget.test.ts`,
  `tests/ChatInput.target.test.tsx`; seed suite: `LNCH-T` (`e2e/seed_surfaces_test.py`, authored,
  not yet executed — see `docs/testing/seed-surfaces-plan.md` §3).
- **Run page: `Cancel run` for every non-terminal status, outside gates (F-029).** A run in
  `distributing` had no cancel anywhere on `/runs/:id` — `steering-cancel` lives inside a gate card
  that had not opened, and the header's stop control was an unlabelled icon that read as decoration —
  so a mis-bound run burned seats until the operator hit `POST /runs/:id/cancel` by hand. The header
  now carries a labelled `run-cancel` button for planning / distributing / executing / awaiting_human;
  it asks first (`run-cancel-confirm`: `run-cancel-yes` / `run-cancel-keep`, Escape keeps), speaks the
  wire directly (`api.cancelRun`) and refreshes the run index; a refusal stays on screen
  (`run-cancel-error`, `role="alert"`) instead of being swallowed. Terminal runs offer none. `ChatPanel` no longer
  takes an `onKill` prop (the header speaks the wire itself; the Ctrl/⌘+Shift+K shortcut and the
  palette verb are unchanged). Tests: `tests/ChatPanel.cancel.test.tsx`; seed suite: `RUN-CXL`
  (observed at TST-1's gate on a second page; authored, not yet executed).

## [0.5.2] — 2026-09-09

### Added
- **Repositories section on the project page (#208, closes #207).** `ProjectRepositories` lists a
  project's `crew.repo` members and attaches / detaches them from the surface an operator actually
  lands on (`/p/:id`; also the legacy `/projects/:id`, whose generic Members list now shows only the
  non-repo members): a registered-repo picker over the one session repo cache (fetched on the field's
  first focus, never on mount; already-attached repos excluded) that sends the pinned
  `AttachMemberBody` (`POST /projects/:id/members` `{kind:'crew.repo', ref, attachedBy:'studio'}`),
  an inline-confirmed detach (`DELETE /projects/:id/members/:mid`), one `busy` lock shared by attach
  and detach (both derive the next membership from the members they closed over, so two in flight
  would report from a stale base), failures surfaced in `project-repo-error` — never swallowed — an
  empty state that names the consequence (a project-scoped test cannot launch until a repo is
  attached), and the section omitted for the synthesized `default` project. The dashboard's bound-repo
  chips render from the same membership read, so an attach lights the chip with no second fetch.
  Before this a UI-created project could never launch a project-scoped test: nothing in the product
  called `attachProjectMember` with `kind:'crew.repo'`, and crew's multiscope resolver 400s a
  project-only launch over zero repository members.
- **Skills section (#209).** `/skills` — the file manager over the daemon's one effective
  garden-shaped plugin root (the skills keystone, crew#480): the KPI band and catalog with
  kind / provenance / core / claude-only / upgrade / conflict / unpublished badges, the enabled
  switch through the daemon's guards, the drawer with the skill's own files and the root support
  files under tabs, a textarea editor (Save → `PUT` → the daemon's findings, CAS on the revision
  the content was read at), the read-only **Baseline side** of the open file (`?side=baseline`;
  for a held-back name collision it names the upstream file actually read), Reset (typed
  confirmation), Replace / Add (a pasted files map), Refresh baseline, Analyze (dry run) and
  Publish. A "Skills" rail section sits before Steering. Every mutation answers the contract's
  2xx `{verdict, findings, revision}` envelope (a `blocked` verdict is a normal answer with
  nothing written); a 409 — exclusively a stale `expectedRevision` — freezes the page behind the
  reload prompt.
- **Engine line on `/skills`.** `GET /diagnostics` → `skills` (the api-types 0.28.0
  `diagnostics.skills` block, mirrored) rendered under the snapshot line: the state vocabulary
  `published | fallback | blocked | config-error | disabled` with its findings — whether the engine
  is actually being handed a verified snapshot, and why not.
- **Tests-feature deterministic test layer (#210).** T1–T20 / T24 of the Tests-feature test plan
  (council run `1aba96f6`; the codex REVISE's required changes applied), the scenario id in every
  test name: the launch wire's presence gate and its negative guarantee — named 404 / 400 /
  strict-zod 400 / 500 / 501 / transport rethrown after ONE call, never retried over `/runs`
  (`tests/testingLaunch.wire.test.ts`); the four `POST /runs/:id/gate` bodies and the bodyless
  cancel (`tests/gateWire.test.ts`); the launch panel's scope matrix, locked chips, picker, consent,
  double-submit → one POST, and gate arrival before/after the response (`tests/TestingLaunch.test.tsx`);
  the page's probing → populated states and the `?new=` intent (`tests/CampaignsPage.test.tsx`);
  route wiring through the project shell (`tests/ProjectCampaignsView.test.tsx`); and **T30**, a
  rename-consistency guard over every rendered string — text, `title`, `aria-label`, `placeholder` —
  on the Test surfaces (`tests/renameConsistency.test.tsx` + `tests/renameGuard.ts`). The revised
  plan ships in-repo (`docs/testing/tests-feature-test-plan.md`: T21–T23 rewritten as non-launching
  probes, T25–T29 governed / Playwright left as documented next steps).
- **Seed-surfaces E2E suite (#211).** `e2e/seed_surfaces_test.py` seeds and exercises every studio
  surface through the real UI (Playwright) against a disposable, hermetic daemon — own port, scratch
  HOME / TMPDIR, every `WICKED_*` store pinned into the temp dir, the bridge pinned to
  `wicked-interactive@0.8.1` and resolved offline — with persistence + scoping assertions, product
  gaps as narrowly scoped `xfail` rows carrying their issue numbers (studio#212 / #213 / #214 / #216,
  crew#472), one governed scenario proven from durable events, and an isolation proof that the rig
  wrote nothing identifiable into the live daemon or the operator's stores. Certified run 12:
  52 rows — 36 pass · 0 fail · 15 xfail · 0 xpass · 0 skip · 1 blocked (DEM-REC, studio#217).
  `--self-test` runs 229 in-process checks of the rig's own guards; `--rescrub-report` re-derives the
  committed report deterministically. Rig, coverage matrix, findings and known limitations in
  `docs/testing/seed-surfaces-plan.md`; the scrubbed report in `docs/testing/seed-surfaces-report.json`.
- **Live Test-feature run (#215).** `e2e/test_feature_live.py` drives "Run recon" / "New test"
  through the studio UI on the dogfood daemon (crew 0.7.25 / studio 0.5.1): three governed runs
  serialized behind a preflight, the intake gate approved on the real SteeringGate card, every testid
  it uses verified against `testid-inventory.json`, no deliver / push / PR gate ever taken, nothing
  registered, modified or deleted. Write-up in `docs/testing/test-feature-live-report.md`; raw
  measurements in `e2e/artifacts/test-feature-live/report.json`. What worked end to end: the launch
  UX (verb → picker → chip → submit posts exactly the pinned `TestingReconBody`; the gate on the panel
  card over `/ws` in 67–80 s; approve → `POST /runs/:id/gate` 200; runs reach terminal state). Findings
  recorded for follow-up: the approved plan is never executed (0 sibling runs, 0 campaigns — crew#473),
  the only human gate is pre-execution, a one-sentence brief plans 3 units every time (core#393), two
  plans for the same brief share 0 % of scenario ids, and studio-side operator-view defects (a dangling
  `campaign` label when `campaignRegistered:false`, the Test landing never showing single-repo recon
  runs, rename leftovers).

### Fixed
- **Campaign → Test rename regression (#210, closes #203).** 15 rendered "Campaign" strings — the
  rail ＋ label, the project-shell crumb, the chat group-attach pill, the Needs-You row text and verb,
  the scoreboard not-found / loading / attached tooltip, the launch panel's fan-out and resolved copy
  and link, the landing's probing / unsupported copy, `TESTING_UNSUPPORTED_COPY`, the "+N older" chip
  title and the "No tests match" line — now speak the Test vocabulary; backend / route / store-key /
  testid vocabulary stays `campaign` by design. **The Test rail ＋ now creates**: it used to land on
  the Tests page with nothing open; a `?new=test` / `?new=recon` arrival intent (`testingLaunchPath` /
  `readLaunchIntent` in `src/api/testing.ts`) opens that panel on mount and is consumed with one
  `replace` navigation, and the rail's "Run recon" row rides `?new=recon`. The project-scoped view
  moved out of `App.tsx` into `ProjectCampaignsView.tsx` (`project-campaigns-crumb`);
  `testid-inventory.json` regenerated.
- **The Skills API layer speaks the real crew#480 wire — fix pass 4 of #209.** Against the
  integrated bundle `/skills` rendered an error: studio's hand-mirrored types expected a
  `manifest.support` map, string `revision`/`expectedRevision`, hash-carrying file entries and a
  `SkillFileContent.hash`, none of which exist in the contract. Every declaration is now a
  byte-for-byte MIRROR of the contract's skills block (`src/api/skills-wire.ts`, pinned by
  `tests/skillsWire.test.ts` against a vendored fixture of the same line ranges), and every
  reader/writer consumes it: numeric revisions, `manifest.files` records (support files are the
  records no skill owns; the DEEPEST registered skill dir owns a file), `SkillFileTree` rows
  `{path, size, record}`, `SkillReadResult {content|null, size, truncated, binary}` (Save disabled
  on either flag), the `provenance` field as the wire's (no longer derived), `upgradeAvailable` /
  `upstreamDir`, the `published` record and `current` snapshot, `SkillPublishResult.snapshot` and
  `SkillRefreshResult`'s merge tallies in the notes. Every finding kind renders generically with
  its skill, the skill it is against (core-marked), `file:line`, evidence and explanation. A
  **503** (unseeded root / corrupt `current` / no seam) renders the named unavailable state with
  the daemon's sentence — never an empty catalog; the bare 404 stays the "predates" state.
  **Contract pin:** the mirror pins the skills block that `wicked-crew-api-types` **0.28.0** carries
  (crew#480 — re-minted from 0.27.0 after the #475/#480 collision; the block is content-identical,
  only the version token moved). The package pin stays `^0.25.0` in this release; the swap to
  `export type { … } from 'wicked-crew-api-types'` (deleting the fixture + pin test) follows once the
  pin can move to the published 0.28.0.

## [0.5.1] — 2026-09-08

### Fixed
- **Honest dashboard stat framing (#200, Copilot review).** The home essence tile for tests reads
  "Governed tests (each test groups its sibling runs)" instead of "Test runs" — the value is the
  test/campaign count, not a run count. The Memories store band no longer falls back to the
  query-scoped loaded count for the store-wide total (shows "—" when coverage is absent), and the
  facet-value tile states it counts the loaded recall page, not the whole store.
- Renamed the exported `CAMPAIGN_PROBLEM_PREFIX` → `TEST_PROBLEM_PREFIX` to match the "New test"
  verb it now frames.

## [0.5.0] — 2026-09-08

### Changed
- **The command-deck landing rebuild.** A ground-up redesign of `/` on real wire data: a themed KPI
  ribbon (FLOW / ATTENTION / TRUST&SPEND) on the real `AgentSession.created_at` clock (true 30d
  windows + prior-window deltas, degrading to positional when no run is dated), a needs-you feed with
  severity stripes, a verified-vs-needs-review strip, a live-pulse burn chart, and section doors.
- **Nav usability wave.** Test split out below Execute (a standalone, project-optional work section,
  renamed from "Campaigns"); Evals moved beside Steering; work/system dividers + a Settings bar; the
  daemon health bar stays at the rail's foot.
- **The deck design applied to every section dashboard** (the shared `StatTile` reskin).

### Added
- The Evals section lists the persisted eval-run history + drilldown (`GET /testing/evals[/:id]`).
- Bumped `wicked-crew-api-types` 0.8.0 → 0.25.0; new `--section-{test,vibe,demo}` tokens.

## [0.4.15] — 2026-09-07

### Added
- **Governed-knowledge dashboard (#195).** `/steering/dashboard` is the new Steering
  landing: a KPI band (Needs review · Memories · Active rules by severity), a
  consolidated review inbox (memory + policy proposals in one place, approve/reject
  inline), and browse. A "Needs review" governed-knowledge band on the project homepage.
  The propose→promote review queue is no longer buried at the bottom of the Policies and
  Memories pages.
- **`FacetAutocomplete` (#195).** The facet chip filters became a `key=value` typeahead.

### Changed
- **Nav tweaks (#194).** Removed the logo connection dot; the Health heart is colored by
  health; Ask is a compact `?`-circle; Testing is relabelled "Test" and moved below Make;
  a custom site name in Settings → Appearance.

## [0.4.14] — 2026-09-07

### Added
- **Capture learnings action (#189).** A per-repo verb on the Repositories panel
  launches the governed `capture-learnings` workflow over the repo (`launchRun`
  with `workflow:'capture-learnings'`) — a tracked run the operator watches that
  mines the repo's churn + hotspots into faceted memory and policy proposals,
  reviewed in the Steering surfaces. Marks the run launched-here (studio
  provenance), mutually disables with Onboard, and guards against double-click.

## [0.4.13] — 2026-09-06

### Changed
- **Unified governed-knowledge surface (DES-MEM-FACETED-001, #187).** Steering is now the home for both **Policies** and **Memories**, each sub-section carrying *manage existing* AND *proposals*: the seven steering-type pages collapse into one type-filtered Policies view (all rule-management preserved) with policy proposals folded in; a new Memories sub-section browses the memory store, retires (subtree-scoped), and reviews memory proposals. The standalone Proposals surface is retired into these sub-sections (`/proposals` and legacy `/steering/:type` redirect).

## [0.4.12] — 2026-09-06

### Added
- **The proposal approval-queue surface** (DES-MEM-FACETED-001, #185). A dedicated queue for
  governed-knowledge proposals: browse pending proposals, filter by type, and approve or reject
  each in place. The `Proposal` type is defined locally for this release (per the `src/api/wiki.ts`
  pattern) pending `wicked-crew-api-types@0.21.0`.

## [0.4.11] — 2026-09-05

### Changed
- **Chrome + rail control affordances (#183, operator direction).** The rail header now spaces
  Notifications, Ask, and the menu as distinct actions rather than one cluster. NotificationBell
  is centered inside a token border, with the unread count moved from an overlaid badge to inside
  the border (right of the label, shown only when unread > 0). Ask takes the slot next to the
  logo where the connection "live" word used to sit; the status dot stays as the minimal
  glanceable state and still expands the rail-foot Health section on click.

## [0.4.10] — 2026-09-02

### Added
- **Campaign cards tell the whole story** (#27, #181, on the 0.19.0 wire). Delivery rollup —
  "n of N landed" with per-sibling PR links (`isPrUrl`-gated) and stranded siblings surfaced as
  needs-you; a live one-line narration per card from the freshest member-run CoreEvent (rendered
  through `narrator.ts`, the one template source); ad-hoc grouping — the launch composer attaches
  a run to an existing campaign or a create-on-first-use label group, and grouped runs co-render
  on the campaigns dashboard.

## [0.4.9] — 2026-09-01

### Added
- **The delivery surface** (crew#393's studio half, #178). The launch composer's "Open a PR when
  done" toggle (default ON for repo-scoped code-work launches, posted explicitly); the run
  detail's Delivery card renders the 0.18.0 tri-state — delivered (PR link), **stranded** (amber,
  one-click Deliver with the daemon's own error shown verbatim on failure), none; home needs-you
  counts stranded completed runs. Pre-0.18 daemons that 400 on the key get one retry without it.
- **Docs and demos can be deleted from the UI** (#119, #179). Confirm names the doc; success
  drops the row and re-lists; a two-store divergence (crew's partial 500) renders the wire
  sentence verbatim with a retry armed; ghost 404 / build-in-flight 409 / bridge-unavailable 503
  each render honestly.

### Fixed
- **Ask & chat nits from the live campaign** (#176, #177). The Ask quick-prompt seeds the NEWEST
  failed run; dock replies render sanitized markdown; collapsing a long seat reply keeps its bytes
  (expand restores byte-equal text); the chat header's seat chips and feed read one attribution
  source.

## [0.4.8] — 2026-09-01

### Added

- **The home command center** (#174) — the homepage answers three questions in priority order:
  *what needs me* (one deduped queue of waiting gates, failed runs, blind repos, stalled chats,
  and campaign gaps — every row actionable in place: dock deep-links, retry/re-index prefill),
  *is the portfolio healthy* (six KPIs from the shared folds — the needs-you tile counts the
  queue's own fold so they can never disagree — plus the narrated activity pulse and the project
  wall), and *where do I go* (creation verbs, a board-level Ask invite, and the per-section
  essence strip). Calm copy is owned solely by the queue's zero-row branch, so "All quiet"
  beside visible failures is structurally impossible. NarrativeBand, ActivityRiver, LiveFeed,
  and RunOutcomeBar are deleted — their questions are now answered once, not twice.

## [0.4.7] — 2026-09-01

### Added

- **Chat and Repositories become command surfaces** (#169) — the dashboard kit applied to the
  last two list sections: conversation cards with seat chips and a live/needs-you-first order,
  and the repo fleet view with derived graph state, windowed pass/fail splits, and
  re-index-as-prefill.
- **Testing lands on Campaigns** (#170) — the Testing section opens on a campaigns dashboard
  (Harness folds into the landing's creation verbs), and launches gain **project selection and
  multi-codebase attachment**: the pinned `{projectId, repoRefs}` wire against crew's new
  `POST /testing/recon`, honest `runIds` fan-out rendering, and a presence-gated single-repo
  fallback for older daemons.
- **Steering becomes a spreadsheet** (#171) — inline cell editing with Enter/Esc/Tab semantics,
  add-row with reserved-namespace validation, retire-with-reason; advanced fields stay in the
  drawer. And the **assist dock**: the reusable right-panel chat (design:
  `.product/DES-ASSIST-DOCK.md`) where chatting launches the governed authoring run, the propose
  gate renders as a pinned approval card inside the panel, and attachments fork
  import-directly vs analyze-with-chat.
- **Ask** (#172) — an app-wide assistant entry in the rail (below Notifications, its own accent
  idiom, ⌘⇧A) opening the assist dock with an app-context pack that cites the daemon's new
  diagnostics (component versions, stores, per-CLI ACP health) when served, with honest
  degraded copy on older crews; quick-prompt chips prefill common questions.
- **Steering reports on itself** (#172) — a usage band on the Steering landing: gate
  evaluations, denials, % of runs governed, allow/deny split, top-fired vs unused rules
  (clicking through to the filtered grid), and the latest eval's caught/gap rate.

## [0.4.6] — 2026-09-01

### Added

- **Section dashboards** (#167) — Projects, the project homepage, and Make become full-width
  command surfaces on the executive-dashboard model: a ≤6-tile KPI band per section
  (performance / pipeline / risk) with honest deltas (a delta renders only against a full
  same-size prior window — never a fabricated surge) and inline sparklines, a first-class
  FilterStrip (search + status chips + window picker), and card grids where every card is a
  door. The action layer rides on top: creation verbs on every header, "needs you" floats
  first with gate cards deep-linking straight to the approval dock, and failed items carry
  Retry-as-prefill. One shared kit (StatTile / FilterStrip / DashboardGrid / sparklines).

### Changed

- **The run header condensed** (#166): one row + the phase strip; started/ended/took moved
  into the What/Where insights panel; Timeline and Units left the primary tabs for an
  Inspect ▾ menu — the Feed is the run view. +79px (+19%) more feed above the 1440×700 fold.

## [0.4.5] — 2026-08-31

### Fixed

- **The narrator reaches the chat surface** (#164): GroupChat now renders the narrative by
  default — user messages and short crew replies stay first-class turns, long per-seat worker
  output collapses to seat-chip narration lines with the raw bytes behind expanders (the full
  verbatim transcript stays behind the view toggle), streaming shows as honest progress lines,
  artifacts render as cards, and the now-bar + pinned approval dock mount on chat too. Direct
  follow-up to 0.4.4 user feedback: "what I see is still the outputs from the individual agents."
- The approval dock no longer vanishes mid-decision on chat sessions: the run-refresh reconcile
  pruned gate ids absent from `GET /runs` (a chat session id never appears there), unmounting the
  gate card ~400ms after it appeared and eating any half-typed note — a counted pin registry
  (`awaitingPins`) both reconciles respect keeps a mounted surface's gate alive (#164).

## [0.4.4] — 2026-08-31

### Added

- **The run narrator** — the build-chat redesign (design doc `.product/DES-RUN-NARRATOR.md`).
  One chronologically stable feed narrated by a deterministic template layer over the event
  stream (raw output collapses behind expanders; ordering fixed at the source for backfill and
  live-merge), a **sticky now-bar** always showing what is happening right now, a **pinned
  approval dock** that never scrolls away (approve / amend / reject-with-note — the reject path
  now carries the note), **artifact cards** inline as files and documents are produced, and a
  labelled follow-up bar replacing the ambiguous composer on finished runs (#161).
- A real **not-found view** — unknown routes keep the typed URL and offer links instead of
  silently landing on a default page (#160).

### Fixed

- The usability review's dead ends (#160): the Escape/overlay contract with focus return + a
  skip link; the Work window is an honest "last 30" with full-set search, a first-class
  show-all chip, and a threshold-colored success rate; lists derive short human titles instead
  of raw prompt text; Steering type pages show type-scoped stats (empty types lose store-wide
  noise; diagnostics fold behind a toggle); single-seat council decisions read "allowed — no
  policy applied" instead of vote theater; evals split blocked-vs-passed, link gap hints into
  the rule drawer, and name their corpus; dead-end empty states gained CTAs plus ten
  plain-language copy rewrites.
- **Failed runs explain themselves** (#162): the failure banner translates engine denials into
  plain words with advice ("Unit #2 tried to write outside its workspace and was stopped to
  protect your files."), reading the structured denial from wicked-core-ts ≥ 0.7.6 with an
  honest prose fallback on older daemons; the engine's verbatim reason stays as a detail line,
  and rule denials link into the Steering drawer.

## [0.4.3] — 2026-08-31

### Added

- **Steering** — the governance surface, rebuilt end-to-end. A top-level Steering nav item
  (above Settings) lands on seven compact type cards (Architecture, Development, Security,
  Testing, Operations, Compliance, Design/UX) with live rule counts; each type page is a clean
  rule list (severity chip, id + statement, non-default weight) with a single **Add ▾** action
  offering Add individual / Import / Add with chat (the governed-run authoring flow) — nothing
  renders open by default. Rule detail, provenance, retire/update live in a click drawer.
  Replaces the Wiki page and the old always-open management forms (#153, #154, #156).
- **Testing** — a top-level Testing nav item (above Steering) with three pages: **Harness**
  (campaign recon trigger, intake gate, launch, add-with-chat), **Campaigns** (the scoreboard,
  moved here; the old route redirects), and **Evals** (run the steering-rule evals per type or
  all, caught/gap/false-positive summary + results table, gap rows expand to the nearest
  non-firing rules with similarity, corpus upload). Honest states throughout: a pre-0.7.5
  engine answers with the upgrade callout, a hint run without an embedder shows the
  facet-only-degrade notice, an empty corpus renders an empty state (#155).
- The data-testid contract (TH-13 / test-R13): `testid-inventory.json` — a committed, versioned
  inventory of every `data-testid` the UI declares, regenerated with `npm run manifest:testids`
  and emitted into `dist/testid-inventory.json` by the build so consumers verify against the
  dist actually served. `tests/testidInventory.test.ts` re-scans `src/` and fails CI on drift.

### Changed

- The steering client is reconciled to crew's shipped wire byte-for-byte — import
  `{type?, entries[]}`, author `{instructions, type?, documents?}` → `{runId}` (#154).

### Removed

- The Settings **Policies** panel and PolicyManager (policies merged into steering rules;
  `/policies` redirects to `/steering`), and the context-free **Domain** and **Coverage**
  Settings panels (`/domain` and `/coverage` redirect to `/system`; per-run coverage evidence
  keeps its home in the run view; the project-scoped successor is tracked in #157/#158) (#156).

## [0.4.2] — 2026-08-30

### Added
- **Architecture Wiki page** (nav): scoreboard health header, faceted rules browser
  (provenance, wiki URIs, evidence counts), RuleSet grouping, retire kill-switch with
  typed confirmation, About/authoring panel; honest 501/unseeded/empty states throughout.
- **Campaign scoreboard** (TH-14): ladder + node status from Campaign* WS frames, verdict
  chips, evidence links, cost column; sibling-run delivery rollup off `session.delivery`.
- **GovernanceAudit honesty** (AW-18): renders the acceptance conformance section with an
  explicit "unenforced" state — an unenforced run is never claimed guardrailed.
- **data-testid inventory** as a versioned build artifact with a CI drift test (TH-13).

## [0.4.1] — 2026-08-29

The truth-pass release: the docs and the site describe the product that shipped, and the
governance rule template actually saves. This is the version wicked-crew 0.7.1 bundles as its
default local skin.

### Changed

- Board attention bands read their copy from one source of truth (#121).
- Site: repositioned as "where product work happens", scoped honestly (#131); the
  project-as-context story — the multi-repo graph — added (#130); hero, scroll-snap, and
  fixed-topbar band fixes (#132, #133, #134).
- Truth pass (docs-R9): the site's project-shell copy flipped to present tense — the dedicated
  project browser is shipped, not "landing next" — and the editorial guard comment that enforced
  the stale claim now enforces the shipped one; README rewritten to the 0.4.x surface; the
  crew-daemon floor corrected to v0.7.0+ (verified against the wire: `PUT /runs/:id/guidance`
  is 0.7.0-only); onboarding copy corrected from "index → annotate → domain" to the two units
  crew actually runs (index → annotate).

### Fixed

- The governance rule template is saveable and the version row truthful (AW-1, #141).
- Unresolved-reference caveat and coverage empty states clarified post-migration (#140).
- Document/demo delete: pin the missing wire instead of inventing one (#138).
- Test stability: no FontFaceSet across the Playwright boundary (#137); doc-canvas LANDED case
  no longer reads the DOM in the frame's swap gap (#139).

## [0.4.0] — 2026-08-25

### Changed

- Delivery: the worktree is a fact — the delivery panel no longer gates it on the workflow
  catalog (#128).

This is the version certified by the 21-scenario functional campaign (21/21 PASS,
`estate-review/STUDIO-CAMPAIGN.md`): projects, repo intelligence (code graph, ego focus,
blast radius, domain graph + coverage, requirements), governed runs with HITL gates,
group chat, governed PTY terminals, workflow builder, governance surfaces, settings
persistence, document/video modes, and deep links.

## [0.3.0] — 2026-08-25

The largest release to date (~77 commits): four design programs landed.

### Added

- **DES-UX-002 — the agentic terminal of the future**: portfolio nerve center with active-card
  enrichment (#113, #118), run evidence timeline (#111), work chronicle (#112), the steering
  annotation layer with durable pre-gate guidance notes riding crew's `PUT /runs/:id/guidance`
  (#114, #117).
- **DES-UX-001 — the trust spine**: one canonical runs surface (#95), run identity (#96),
  provenance + retry (#91), failure forensics — failed runs answer "why did this fail" (#90),
  thread truth (visible sends, anchored versions, reload survival) (#97), the Unfiled path
  (#98), toast lifecycle (#99), live execution + bookmarkability (#101), export + theme-learn
  feedback (#102), chat repair (#103), keyboard coherence + composer preflight (#104),
  roster-resolved capability-aware seat chips (#109).
- **DES-FEEDBACK-002/-003 — FDE ergonomics**: universal command palette + global shortcut
  registry (#76), keyboard gate triage — j/k select, a approve, r reject-with-note (#77),
  in-studio file & diff viewer (#79), five-path accordion rail (#80), fixed bottom runs panel
  (#81), health rail-foot + `/make` dashboard (#82), `/projects` `/chats` `/repos` reporting
  dashboards (#83), narrative landing with the 24h activity river (#84), header project pivot +
  honest global search (#85), chat grid/columns + document version compare (#86), desktop gate
  notifications + batch gate resolution (#87).
- **DES-VISION-001 / DES-UXFIX-001 — the visual re-envision**: design-token foundation through
  full token conversion (#56–#60), appearance settings — logo, accent, theme, live preview
  (#61), brand-learn (#62, #75), Theme page (#64), attention decay + bands (#49), segmented
  mode spine (#52).
- Build runs open a PR by default, with a settings toggle (#124).
- Delivery visibility: what a run produced, where the operator already is (#125).
- Doc canvas block-level click-to-edit (#116) and the video surface restored on the real
  record wire (#120).

### Fixed

- Theme client speaks the real bridge wire — invented routes removed, contract probes FATAL
  (#73, #75).
- Send-lifecycle honesty: no fork-per-send, live first generation, reload-surviving send state
  (#108); chat cold-start roster truth (#107).
- Copy triage: internal vocabulary out of the product (#47).

## [0.2.0] — 2026-08-19

The merged interactive layer: wicked-interactive's UI moved into this skin (DES-MERGE-001).

### Added

- Project routes + the four-mode switcher — chat / build / document / video (#29).
- The orchestrator home board, static then live, with answerable gate chips (#30, #31, #32).
- Typed studio client for crew's proxied interactive service (#28).
- Document mode: canvas iframe (#33), version strip + fork (#34), the one conversation thread
  (#35), point-and-comment on the sandboxed bridge (#37), exports as thread artifacts (#40),
  learn-a-theme + sources attach (#41).
- Video mode: storyboard + player against the proxied demo endpoints (#38), record and
  re-record from the thread (#39).
- Merged preflight / install gate (#42).
- Live narration + unified launch/steer conversation on the run thread (#24, #25).
- Seat sign-in terminals, worker config root, launch check in settings (#23); runtime
  seat-health chips on the dashboard, launch roster, and chat composer (#18, #19, #20).

### Removed

- Unrouted legacy views (#22).

## [0.1.1] — 2026-08-16

### Added

- `ws.wickedagile.com` — the product site, with its own e2e suite and Pages deploy (#1).
- Wire contract consumed from npm: `wicked-crew-api-types` (#2).
- Projects UI: list, detail, create, archive (DES-PROJECT-001, #13) — the first projects
  surface in the skin.
- Run view: outputs primary in the main panel + Files tab system-open (#17); Archived chip
  for finished history (#14).
- npm trusted-publisher release workflow (#16).
- `.product` artifact set: REQ-001–005, DES-001, TEST-001, RAID, acceptance evidence (#4, #6).

### Fixed

- Gate toasts scoped to the currently viewed run; pointer-events on the notification container
  (#9, studio#10).
- Gate HITL card data + cache-read token visibility (#7).
- `wicked-crew-api-types` pinned to the npm registry version (#5).

## [0.1.0] — 2026-08-12

### Added

- Initial release as its own product: carved out of the wicked-crew monorepo
  (`packages/studio`) with the package's full in-monorepo history preserved via
  `git subtree split` (92 commits).
- The SPA as a pure HTTP/WS client of the wicked-crew daemon: runs, gates, live CoreEvents.

[Unreleased]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.8...HEAD
[0.5.8]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.15...v0.5.0
[0.4.15]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.14...v0.4.15
[0.4.14]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.13...v0.4.14
[0.4.13]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.12...v0.4.13
[0.4.12]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.11...v0.4.12
[0.4.11]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.10...v0.4.11
[0.4.10]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.9...v0.4.10
[0.4.9]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mikeparcewski/wicked-studio/releases/tag/v0.1.0
