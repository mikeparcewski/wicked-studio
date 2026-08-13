# wicked-studio

> **v0.1.0** · [![CI](https://github.com/mikeparcewski/wicked-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/mikeparcewski/wicked-studio/actions/workflows/ci.yml) · [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**The coder-facing skin of the wicked experience plane.** A React SPA that is a *pure HTTP/WS
client* of the [wicked-crew](https://github.com/mikeparcewski/wicked-crew) daemon: launch and
steer governed agent runs, answer human gates, watch live CoreEvent streams, browse projects,
evidence, coverage, and the decisions ledger — everything the daemon exposes on `/api/v1` and
`/ws`, and nothing else.

```
┌─────────────────────┐         HTTP /api/v1  +  WS /ws          ┌──────────────────────┐
│   wicked-studio     │ ───────────────────────────────────────▶ │  wicked-crew daemon  │
│   (this repo, SPA)  │ ◀─────────────────────────────────────── │  (control plane:     │
│   the skin          │       wire contract: wicked-crew-api-types │  API/engine/gates)  │
└─────────────────────┘                                           └──────────────────────┘
```

## The division of labor

- **wicked-crew is the control plane** — the daemon, the `/api/v1` REST surface, the `/ws`
  event stream, the wicked-core engine underneath, the gates and the evidence. It is fully
  functional headless.
- **wicked-studio is the skin** — a client of that control plane, developed, versioned, and
  released as its own product. It imports **zero** crew source; the only thing the two share is
  the published wire contract, [`wicked-crew-api-types`](https://github.com/mikeparcewski/wicked-crew/tree/main/packages/crew-api-types).
- **Crew still ships a default skin.** wicked-crew's release build (`build:with-studio`) copies
  this package's built `dist/` into the daemon's serving tree, so `npx wicked-crew serve` keeps
  the one-command local UX — UI and API same-origin on one port. The dependency direction is
  *control-plane-ships-a-dist-artifact*: crew depends on studio's build output, never on its
  source; studio depends on crew's wire contract, never on its internals.

## Pairing with a daemon

The connection surface is deliberately small (`src/api/client.ts`):

| Mode | How the SPA finds the daemon |
|---|---|
| **Bundled / same-origin** (production) | `window.location.origin` — whatever origin the daemon serves the SPA from is where the SPA calls back to. `--port` / `CREW_PORT` just work; no host is baked into the bundle. |
| **Split dev or standalone** | `VITE_API_HOST` (host:port, no scheme), baked at build time by Vite. `.env.development` sets `127.0.0.1:7701` — the crew daemon's default — for the `npm run dev` server on :4200. |

The daemon's loopback CORS admits any `http://localhost:*` / `http://127.0.0.1:*` origin, so a
standalone studio on its own port can drive a local daemon out of the box.

## Develop

```sh
# a running control plane (defaults to 127.0.0.1:7701)
npx wicked-crew serve

# then, in this repo
npm install
npm run dev        # vite on http://127.0.0.1:4200, pointed at :7701 via .env.development
```

`npm test` (vitest + testing-library), `npm run typecheck`, `npm run lint`, `npm run build`
(tsc + vite → `dist/`). CI runs all four on every PR.

## Standalone build

```sh
VITE_API_HOST=127.0.0.1:7701 npm run build
# serve dist/ from ANY static server (SPA fallback to index.html), e.g.:
npx serve dist   # or python -m http.server -d dist
```

`e2e/studio_standalone_test.py` is the scripted proof of this mode: it builds the SPA, serves
`dist/` from a plain static server on its own port, points it at a live daemon, and drives a
real flow (list runs → open a run → approve a human gate → watch CoreEvents over WS) with a
real browser. See the header of that file for prerequisites and knobs.

## Releasing / how crew consumes this

The npm package ships `dist/` only (`files: ["dist"]`). wicked-crew declares `wicked-studio` as
a devDependency and its `build:with-studio` copies `node_modules/wicked-studio/dist` into
`packages/crew/dist/studio`, which the daemon serves same-origin (headless fallback when
absent). Installs from git get a fresh `dist/` via the `prepare` hook
(`scripts/prepare-dist.mjs`); publishers run `npm run build && npm publish` so the tarball is
built from the tagged source.

## Provenance

Extracted from the wicked-crew monorepo (`packages/studio`) as its own product — the carve kept
the code as-is and preserved the package's full in-monorepo history via `git subtree split`
(92 commits). An earlier, pre-consolidation incarnation of this product is archived read-only at
[wicked-studio-archived](https://github.com/mikeparcewski/wicked-studio-archived).

## Requirements

- Node.js ≥ 22.0.0
- npm ≥ 10 (for workspaces and `prepare` hooks)
- A running [wicked-crew](https://github.com/mikeparcewski/wicked-crew) daemon (v0.4.0+) for the SPA to connect to
- A modern browser (Chrome, Edge, Firefox, Safari)
- macOS, Linux, or Windows

## Contributing

1. Fork the repo and create a feature branch.
2. `npm install && npm run dev` — SPA on `:4200`, daemon on `:7701`.
3. `npm test && npm run typecheck && npm run lint` before committing.
4. Open a PR; CI runs all four gates on ubuntu / macos / windows.

The only external coupling is the wire contract (`wicked-crew-api-types`). Studio imports **zero** crew source — all crew interaction goes through `/api/v1` and `/ws`. Keep it that way.

## License

MIT
