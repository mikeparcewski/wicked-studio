## What happens

A live walkthrough's view in studio (`GET /runs/:id/walkthrough`, crew WT-W1) can only ever show verdicts by chapter key. The recorder (`scripts/demo/walkthrough.mjs`) and crew's reader (`packages/crew/src/api/recording.ts`) disagree about what a proof root holds, so everything else the view type carries arrives empty.

Read from both mains (garden `4019c0e` = 12.41.0, crew `c801db4`); not reproduced on a live stack in this pass.

| What crew reads from the proof root | Where crew reads it | What the tool writes |
|---|---|---|
| `result.json` chapters with `title`, `takes`, `failed_frame`, `proves`, `legs`, `checks[] {id, kind, sentence, passed, at_sec, evidence, vault_entry, detail}` | `recording.ts:41-49` (the documented shape), `:868-898` (`walkthroughChapters`, `parseChecks`) | `walkthrough.mjs:1126`: `{ key, verdict, failed_at_sec }` only. The checks exist in memory (`claims` at `:502-509`, with `verdict` rather than `passed`, and no `sentence`), and `proves` at `:517`; neither is written to `result.json` |
| `chapters.json` (the planned chapter list: titles, narration) | `recording.ts:869` | not written by the walkthrough tool (no `chapters.json` in `walkthrough.mjs`) |
| `progress.json` `{state: 'starting_app' \| 'recording' \| 'judging'}` while it runs | `recording.ts:970-972` | `writeProgress` is only called with `{overall, …}` (`:85`, `:751`…, `:1130`): no running state is ever written |
| `demo-video/segments/<key>/segment.mp4` (a chapter is `recorded`) | `recording.ts:887` | segments are written under `<root>/segments` (`walkthrough.mjs:876`), with no `demo-video/` prefix |
| `demo-video/demo.mp4`, `demo-video/poster.jpg`, `demo-video/chapters.md` (the stitched take and its markers) | `recording.ts:985-987` | the walkthrough tool never stitches (no stitch, `demo.mp4`, `poster` or `chapters.md` in `walkthrough.mjs`) |

## What the operator sees because of it

- While it records: "Starting the app" for the whole recording, never "Recording · chapter 4 of 6" (no `progress.state`, and no chapter ever reads `recorded`).
- After it fails: the failed chapter by its key, with no title, no check, nothing "underneath", no failing frame, and no take to watch.
- After it passes: no video to play or export (scene `demo-export`: "the passing walkthrough, exported as the demo" has nothing to export).

The spec asks for all of it: DES-walkthrough-proof §3 (scenes 18-23) and §4.10 (`WalkthroughView.chapters[].checks`, `failedFrame`, `video`).

## Suggested fix (either side, one contract)

Make the tool write what `recording.ts:41-49` documents: per chapter `title`, `takes`, `failed_frame`, `proves`, `legs` and `checks` (with `sentence` and `passed`), a `chapters.json` up front, `progress.json` with the running `state` (and the chapter), the segments and the stitched passing take under `demo-video/`. Or move crew's reader to the tool's layout. A fixture test shared by both (crew's `walkthrough-routes.test.ts` plants the rich shape by hand; nothing checks the tool produces it) would keep them together.

## Why it was found now

Studio's walkthrough artifact (WT-U1) was built against crew's wire and proven on a fixture; while writing the fixture the tool's output was compared with it. Studio renders the thin result honestly (the failure and its chapter, no invented checks), so nothing breaks; it just has very little to show until this lands. It will surface at the P-B live proof.
