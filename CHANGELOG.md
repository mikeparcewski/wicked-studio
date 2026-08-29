# Changelog

All notable changes to **wicked-studio** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x: minor versions may contain breaking changes).

Backfilled 2026-08-29 from the git history and the npm registry; release dates are the
npm publish dates. Every version listed here exists on
[npm](https://www.npmjs.com/package/wicked-studio?activeTab=versions).

## [Unreleased]

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

[Unreleased]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mikeparcewski/wicked-studio/releases/tag/v0.1.0
