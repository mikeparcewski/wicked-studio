# wicked-studio

The coder-facing skin of the wicked experience plane: a Vite/React SPA that is a
**pure HTTP/WS client** of the wicked-crew daemon — launch/steer governed runs,
answer HITL gates, browse projects/evidence/coverage, watch live CoreEvents.

## Wire contract (the one hard rule)

- Studio speaks ONLY crew's published surface: HTTP `/api/v1` + WS `/ws`.
- The only thing shared with crew is the published wire-contract package
  **`wicked-crew-api-types`** (`src/api/types.ts` re-exports it). Zero crew
  source imports — if a type is missing, it lands in the contract package first.
- crew bundles this repo's built `dist/` as its default local skin
  (`build:with-studio`); a studio release means bumping crew's devDep pin too.

## Where things live

- `src/api/` — HTTP client + wire types; `src/components/` — the UI.
- `.product/` — design docs (DES-*, BRIEF-*): read before reshaping a surface, **if you
  have them**. The directory is gitignored (`.gitignore` line 35) and tracked in no
  commit, so a fresh clone has none of it; do not treat a missing `.product/` as a
  mistake, and do not cite a `.product/…` path as something a reviewer can open.
- `tests/` — vitest (jsdom): `npm test`; typecheck with `npm run typecheck`.
- `e2e/` — Python Playwright journeys on the in-process fixture (`e2e/uxfix_fixture.py`);
  `python3 e2e/run_journeys.py` runs the behaviour set CI runs (under the studio and compact-rail
  skins, via `STUDIO_SKIN`); `--all` runs every journey except the desk-only ones and the few marked
  `LIVE` there (they need a real daemon or bridge). `--list desk` runs the `DESK` list under
  `STUDIO_SKIN=desk` (CI's two `journeys (desk K/2)` shards, `--shard K/N`): the desk-only journeys plus
  every behaviour journey (S15a). A desk journey goes in `DESK_ONLY`, never in `BEHAVIOUR`; a new
  behaviour journey runs under desk too (branch on `STUDIO_SKIN` where the Desk differs), or names its
  desk counterpart in `DESK_COUNTERPARTS` — `--check-desk` (run by CI) fails otherwise.
- `testid-inventory.json` — regenerate with `npm run manifest:testids`, never hand-merge it.
  Removing a testid fails `tests/testidRemovals.test.ts` unless `e2e/testid-successors.json`
  names its successor.
- `site/` — the marketing site: its own app/deps, excluded from vitest.
- `wicked-worktrees/` — gitignored checkouts created by governed runs inside
  this repo; never edit or clean them by hand.

Ecosystem-wide context and the PR merge protocol: `../CLAUDE.md` at the
wicked workspace root (when working inside the multi-repo checkout).
