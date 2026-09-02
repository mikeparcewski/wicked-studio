# Changelog

All notable changes to **wicked-studio** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x: minor versions may contain breaking changes).

Backfilled 2026-08-29 from the git history and the npm registry; release dates are the
npm publish dates. Every version listed here exists on
[npm](https://www.npmjs.com/package/wicked-studio?activeTab=versions).

## [Unreleased]

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

[Unreleased]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.9...HEAD
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
