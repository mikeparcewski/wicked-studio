# REQ-002 — Technology Constraints

**Status**: Active  
**Version**: 1.0  
**Product**: wicked-studio  
**Related**: REQ-001, DES-001

---

## Runtime environment

| Constraint | Value | Rationale |
|---|---|---|
| Node.js | ≥ 22.0.0 | LTS with native ESM and fetch; matches wicked-crew's engine floor |
| Browser targets | Modern evergreen (Chrome, Firefox, Safari, Edge) | No IE/legacy support required; governance tooling targets developers |
| Build output | ES modules (Vite `esm` output) | Tree-shaking; no CommonJS transform overhead |
| Rendering model | Client-side SPA | No SSR — real-time WS state cannot be serialised into a static render |

## Network

| Constraint | Value | Rationale |
|---|---|---|
| Crew API base | `http://127.0.0.1:4711` (default) | Local daemon; overridable via `VITE_CREW_API` build var |
| WebSocket path | `ws://127.0.0.1:4711/ws` | CoreEvent fan-out; same-origin assumed |
| Same-origin assumed | yes | No CORS negotiation on the default local deployment |
| Remote deployment | supported via env var | `VITE_CREW_API=https://remote-host` at build time |

## Dependencies

| Constraint | Value | Rationale |
|---|---|---|
| Wicked-crew contract | `wicked-crew-api-types` npm package only | Never import crew source — the published wire contract is the only permitted coupling |
| Peer products | none | Studio is a consumer, not a provider; no sibling product imports |
| UI framework | React 18 (stable concurrent mode) | Settled community; Suspense boundaries available for gate loading states |
| State | Zustand | Lightweight, no boilerplate; flat slice design maps well to run/project domains |
| WS client | native browser WebSocket | No dependency; crew's `/ws` is a standard WS endpoint |
| Terminal emulator | `@xterm/xterm` + `@xterm/addon-fit` | Industry standard; required for the PTY terminal panel |
| Graph rendering | Cytoscape.js + `cytoscape-fcose` | Blast-radius and governance graph visualisation |

## Build tooling

| Constraint | Value | Rationale |
|---|---|---|
| Bundler | Vite ≥ 6 | Fast HMR for development; wicked-crew bundles the dist |
| TypeScript | strict mode | No `any` escape hatches in the wire-contract consumption layer |
| Test runner | Vitest | Same config as Vite; no Jest compat layer needed |
| Linter | ESLint + typescript-eslint | Enforces no-any, consistent imports |

## Deployment constraint

Studio is distributed as a **compiled `dist/`** inside the `wicked-crew` npm package (via `wicked-crew`'s `build:with-studio` script). Studio must NOT have a runtime dependency on any binary, native module, or server that isn't wicked-crew itself.

## What is explicitly excluded

- Server-side rendering
- React Server Components
- Direct database access
- Any bundling of wicked-crew source or internals
- WebSockets to any host other than the configured crew daemon
