## What

WT-U1 (DES-WALKTHROUGH-PROOF-001 §3, scenes 18–20, 23 and 41): a run's **walkthrough** and a demo run's **video** open in the session thread through the artifact slot S8 added, like the run's page does.

- **Inline** — the state in one line ("● Recording · chapter 4 of 6", "✗ Failed at 0:41", "✓ Passed · 6 chapters"), who checks apart from who builds, the chapter marks with their verdicts, what happened underneath in red, the failing frame, and the actions the open escalation allows. Nothing load-bearing below the fold at 1440×700.
- **Pane / full** (the same element; Esc steps back) — the take with the playhead on the failing moment, chapters as seek points, the red mark on the timeline, every check at its moment with its kind and its evidence under ⋯ (through crew's contained file route), the narration, **Export** (the video, and the poster when the take wrote one). At full screen the checks sit beside the take, so all of it is above the fold.
- **Watch · Ask helpers to fix · Edit the check** on a failed walkthrough. Fix is ONE `request_changes` on the gate, carrying what the walkthrough caught in words, through the same 10 s Undo as every gate answer. Edit is the storyline `PUT` (crew's `{storyline}` body) then one approve. Both are offered only while the open gate is this walkthrough's **own escalation** — crew's rule for the PUT: the run is parked on a denied unit of the pair. A later gate (a deliver gate on a run whose failed walkthrough was waved through) offers neither.
- **`demo-video`** — a demo run's video in the same slot, without checks: play, full screen, chapter seek, the narration, Export Video / GIF / Poster (`POST /runs/:id/demo/export`, offered only while the daemon will make them: the review gate, or an ended run).
- Offered only where the daemon mints evidence roots (`health.capabilities.walkthroughRoots`) and the run's chain has a `walkthrough_review` step. Nothing here says "checked": that word is the acceptance read's (WT-U2).

## How

| File | Change |
|---|---|
| `src/api/walkthrough.ts` | crew's WT-W1..W3 + EP-C3 wire, hand-mirrored until studio bumps `wicked-crew-api-types` (the `./demo.ts` precedent) |
| `src/board/walkthroughModel.ts` | pure: one `Recording` shape for both kinds; the state line, seats, chapter marks, the failing moment on the take's clock, the checks track, `escalationOpen`, the verbs, the fix note, export options |
| `src/components/session/WalkthroughEditor.tsx` | the slot's body: one component at every size, so an edit in progress or a made export survives the morph |
| `src/components/session/ArtifactMorph.tsx` | one optional prop, `slot = { kind, body(size, morph) }`, for a body that is not the page-editor family; S8's and S9's editors, Export and side panels are untouched (+18 lines) |
| `src/components/session/RunArtifacts.tsx` | lists the run's walkthrough and a demo run's video beside its pages |
| `src/store/capabilities.ts` | reads `walkthroughRoots` |
| `e2e/uxfix_fixture.py` | switch `walkthrough`: five runs (recording, failed at its escalation, passed + sealed, the thin result, a finished demo run) on crew's wire |
| `e2e/desk_walkthrough_test.py`, `e2e/fixtures/walk-72s.webm` | the journey (in `DESK`) and its 72 s, 10 KB take |

## Red first

- Unit, on main `3dc6e7a`: `tests/walkthroughModel.test.ts` → `Error: Cannot find module '../src/board/walkthroughModel.js'` (1 file failed).
- Journey, the new journey + fixture on a build of main `3dc6e7a`: `no [data-testid=artifact][data-kind=walkthrough] holding a recording in the session's run block` (`artifacts: []`, the run block renders), exit 1.

## Green

- `tsc --noEmit` clean; `eslint` clean on the touched files.
- vitest: `walkthroughModel` (19 cases) + `artifactMorph`, `chainModel`, `sessionModel`, the three testid guards: 7 files.
- `desk_walkthrough` at 1440×700 under `STUDIO_SKIN=desk`: 12 steps green — walk-running (and live: chapter 4 → 5 without a reload), walk-fail, walk-full (Watch plays the 72 s fixture take from 0:41, measured; the fail mark sits at 41/72 of the timeline; a check's time seeks to it; 12 checks, the seven kinds, the three failing ones; evidence 200 through the file route and 404 for a path the view does not name; every check and the verbs above the fold; Esc ×2 back to the same DOM node), passed + export, Esc closes the export list before it shrinks the artifact, the thin result, the demo video (chapter seek to 0:35; GIF made by `POST /demo/export`, then downloaded), ask-fix (nothing sent inside the undo window, then ONE `request_changes` with `ord` and the note), edit-check (ONE `PUT {storyline}` with `step=walkthrough_review`, then ONE approve; Save above the fold). Screenshots looked at for each scene.
- Neighbours on this branch: `desk_page_editor` (S8) 11/11, `desk_session`, `demo_mode` green.
- `testid-inventory.json` regenerated (`npm run manifest:testids`): +40 static ids, none removed.
- Rebased onto S9 (#474) after it merged; the conflict in `ArtifactMorph.tsx` was resolved by keeping S9's file and adding the one prop.
- Adjudicated by codex (read-only, the diff with the base pinned), six rounds: the decision and the PUT are re-validated against this walkthrough's own escalation at send time with the latest units, nothing is sent after an unmount, a read belongs to one (kind, run, step), markers are read one way for the whole take, an action is sent only for the take it was drawn from (the take the click was made on, the take on screen and the take the daemon holds must be the same; every check runs in the same synchronous run as the send), an open draft is dropped when another take replaces it, a chapter the stitched take does not hold keeps its seconds as its own, the fixture serves only the paths the view names and media of the kind its name says. Answered rather than changed: the 10 s Undo queue already cancels a queued answer whose gate instance left or changed (existing `gateActions`), the fixture's take is WebM because Playwright's Chromium has no H.264, and Export Video is a download of the take, because crew's export route makes a GIF or a poster only (codex agreed in round 2).

## Found while building it (filed, not fixed here)

- **wicked-garden#1208** — the walkthrough tool writes `result.json` chapters as `{key, verdict, failed_at_sec}` and its segments outside `demo-video/`; crew's view reads checks, the failing frame, `chapters.json`, `progress.json` states and the stitched take from the same root. A live walkthrough therefore shows verdicts by chapter key only. This PR renders that thin result honestly (journey step `walk-thin`); the rich view is proven on the fixture and waits for that issue live.
- **wicked-crew#782** — no route reads the author's storyline, so "Edit the check" can only take a pasted module. The box says so.

## Not in this slice

Checked chips, `owned_by_you`, the deliver acceptance line and the hold switch are WT-U2. Placing the walkthrough on the Desk is S13.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
