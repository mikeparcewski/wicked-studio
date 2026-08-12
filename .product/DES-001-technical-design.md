---
name: DES-001-technical-design
title: wicked-studio — Technical Design
status: approved
version: 0.1
date: 2026-08-12
author: mike.parcewski@gmail.com
review-required: false
---

# DES-001 — Technical Design

## 1. Architecture Position

wicked-studio is the **coder skin** of the experience plane. It sits at the top of the four-plane
dependency stack and has the narrowest coupling of any product: it imports only
`wicked-crew-api-types` (the published wire contract) and speaks HTTP + WebSocket to the crew
daemon. No Rust, no engine code, no SQLite.

```
┌─────────────────────────────────────┐
│ EXPERIENCE PLANE                    │
│  wicked-studio  wicked-interactive  │  ← this product
└──────────────┬──────────────────────┘
               │ HTTP /api/v1 + WS /ws
               ▼
┌─────────────────────────────────────┐
│ CONTROL PLANE                       │
│  wicked-crew (daemon + wicked-core) │
└─────────────────────────────────────┘
```

---

## 2. Key Decisions

### ADR-001 — Own repository, not crew package

**Context**: studio v2 started as `wicked-crew/packages/studio` (pre-2026-08 consolidation).

**Decision**: Carved out as a standalone repo (`wicked-studio`) with its own version, CI, npm
package, and GitHub Pages site. wicked-crew declares `wicked-studio` as a `devDependency` and
copies `dist/` into the daemon's serving tree via `build:with-studio`.

**Rationale**: Independent versioning; studio can ship ahead of crew; avoids workspace coupling.
The design principle "one binary per product, one repo per product" applies here.

**Consequence**: crew's release build must install devDeps to get studio's dist. Circular risk is
managed by the dependency direction: crew depends on studio's *build artifact*, never on its
source or types — studio depends on crew's wire contract package, never on crew's source.

### ADR-002 — Wire contract via npm package, not shared source

**Context**: Studio needs types for the API responses it consumes from crew.

**Decision**: `wicked-crew-api-types` is the only cross-repo import. It is a separate package
published from `wicked-crew/packages/crew-api-types`. Studio pins it as a dependency.

**Rationale**: Decouples studio from crew release cadence. The type contract is versioned
independently; drift is caught at compile time by the wire-contract test in crew.

**Consequence**: When crew's API shape changes, `crew-api-types` must be bumped and studio must
re-pin. This is intentional friction that forces explicit contract negotiation.

### ADR-003 — Same-origin serve, no baked host

**Context**: In production (crew bundling studio's dist), studio and the daemon share the same
origin. In development, they run on different ports.

**Decision**: In production, use `window.location.origin` as the daemon URL — no host is baked
into the bundle. In development, use `VITE_API_HOST` (`.env.development` defaults to
`127.0.0.1:7701`).

**Rationale**: Same-origin production avoids CORS configuration entirely. The dev split is
explicit and local.

**Consequence**: A standalone build for a non-localhost host requires setting `VITE_API_HOST` at
build time.

### ADR-004 — Terminal access requires operator trust

**Context**: Studio opens `/ws/terminals/:id` to stream live PTY output from agent worker
processes. The WebSocket upgrade uses HTTP GET, but inbound frames are raw PTY stdin.

**Decision**: The crew auth hook (`requiredTrust`) treats `/ws/terminals/` paths as `operator`
regardless of method — before the GET/HEAD blanket observer rule.

**Rationale**: An observer with stdin injection capability can steer a running agent. The trust
ladder guarantees observer = read-only. Terminal channels are write-capable.

**Consequence**: Studio must present an operator-or-higher token to open a terminal WS.

---

## 3. Module Map

```
src/
  api/
    client.ts          # HTTP wrapper: base URL, auth header, error handling
    ws.ts              # WebSocket manager: connect, reconnect, event fan-out
  components/
    RunList.tsx         # run cards with live status badges
    RunDetail.tsx       # phase graph, event feed, gate card
    GateCard.tsx        # HITL gate: artifact + approve/reject/modify
    Terminal.tsx        # xterm.js instance, backed by /ws/terminals/:id
    Projects.tsx        # project browser + create/archive
    Evidence.tsx        # evidence record list + expandable detail
  hooks/
    useRuns.ts          # TanStack Query: GET /api/v1/runs, invalidate on events
    useCoreEvents.ts    # WebSocket /ws fan-out → React events
    useAuth.ts          # token management, trust level display
  store/
    ui.ts               # Zustand: selected run, panel state, filter state
  types/
    index.ts            # re-exports from wicked-crew-api-types
```

---

## 4. Data Flow

```
                  ┌──────────────┐
  CoreEvents      │  /ws WebSocket│ → useCoreEvents hook → event bus
  (read-only fan) └──────────────┘
                                           │
                                   invalidate TanStack Query cache
                                           │
  REST (read)     ┌──────────────┐         ▼
  GET /api/v1/*   │  Fastify API  │ → RunList / RunDetail / Evidence
                  └──────────────┘
  REST (write)    ┌──────────────┐
  POST /api/v1/*  │  (same API)  │ ← GateCard / LaunchDialog / Projects
                  └──────────────┘

  PTY stdin       ┌──────────────────────┐
  GET /ws/        │  /ws/terminals/:id   │ → Terminal component (xterm.js)
  terminals/:id   │  (operator trust req)│ ← keystroke frames
                  └──────────────────────┘
```

---

## 5. Auth Integration

Studio reads auth config from crew's `GET /api/v1/settings` on startup (or infers `authMode:
'off'` from a 401-free root). When auth is required:

- Token sourced from `localStorage` (user pastes it from `wicked-crew token print`)
- Sent as `Authorization: Bearer <token>` on REST calls
- Sent as `?access_token=<token>` on WS upgrade (RFC 6750 §2.3; browser WebSocket cannot set headers)

---

## 6. Deployment

### Bundled with crew (default)

`wicked-crew build:with-studio` runs `npm install && npm run build` in wicked-studio, then copies
`dist/` to `packages/crew/dist/studio`. The daemon's static-file handler serves it at `/`.

### Standalone

Any static server works. SPA fallback to `index.html` required for client-side routing.

### GitHub Pages (`ws.wickedagile.com`)

Marketing/deep-dive site lives in `site/`. Separate build from the SPA. Deploys on merge to main.

---

## 7. Test Strategy

| Level | Tool | What it covers |
|---|---|---|
| Unit | vitest + testing-library | Component render, hook logic, client module |
| Type | tsc --noEmit | Wire contract alignment with crew-api-types |
| e2e | studio_standalone_test.py (Python/Playwright) | Full flow against live crew daemon |

CI runs unit tests + typecheck + lint on every PR. The standalone e2e is run locally before each
release (or in CI with a crew daemon available).
