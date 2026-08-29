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
- `.product/` — design docs (DES-*, BRIEF-*): read before reshaping a surface.
- `tests/` — vitest (jsdom): `npm test`; typecheck with `npm run typecheck`.
- `e2e/` — Python E2E suites driven against a live daemon.
- `site/` — the marketing site: its own app/deps, excluded from vitest.
- `wicked-worktrees/` — gitignored checkouts created by governed runs inside
  this repo; never edit or clean them by hand.

Ecosystem-wide context and the PR merge protocol: `../CLAUDE.md` at the
wicked workspace root (when working inside the multi-repo checkout).
