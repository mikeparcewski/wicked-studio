## What happens

"Edit the check" (DES-walkthrough-proof §4.8, WT-W3) is `PUT /runs/:id/walkthrough/storyline` with the WHOLE storyline module as `{storyline}`, accepted while the walkthrough's escalation is open. There is no way for a client to read the storyline it is supposed to edit:

- `registerWalkthroughRoutes` (`packages/crew/src/api/recording.ts:1086`) registers the PUT (`:1091`), `GET /runs/:id/walkthrough` (`:1165`) and `GET /runs/:id/walkthrough/file` (`:1180`), and nothing that serves `author/<plan step>/storyline.mjs`.
- `/walkthrough/file` serves the PROOF root only (`:1197`), and only `.mp4 .png .jpg .gif .md .json` (`WALKTHROUGH_FILE_TYPES = DEMO_FILE_TYPES`, `:101-108`, `:765`); the recorder's copy (`<proof root>/storyline.mjs`, spec §4.4 step 1) is an `.mjs`, so it is refused with a 400.

## What the operator sees because of it

Studio's walkthrough artifact (WT-U1) offers "Edit the check" at the escalation and can only show an empty box asking the operator to paste the author's whole `storyline.mjs` with their change. The operator has to find that file on disk first. The spec's scene (`walk-fail`: Watch · Ask helpers to fix · Edit the check) reads as an edit of a check sentence, in place.

## Suggested fix

Serve the storyline to a human reader while (or whenever) the pair exists, for example `GET /runs/:id/walkthrough/storyline?step=` → `{ storyline, sha256, edited_by? }` from `author/<plan step>/storyline.mjs`, contained the same way the PUT's write is. With the `sha256` a client can also send the edit against the version it read. Then studio prefills the box, and a later slice can offer the checks as sentences rather than a module.

Read from crew main `c801db4`; studio's side is in the WT-U1 PR.
