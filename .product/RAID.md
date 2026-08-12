---
name: RAID
title: wicked-studio — Risks, Assumptions, Issues, Decisions
status: live
date: 2026-08-12
---

# RAID — wicked-studio

## Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | crew API shape changes break studio without version bump | Medium | High | Wire-contract test in crew catches drift at compile time; ADR-002 makes bumps explicit |
| R-02 | `wicked-studio` devDep in crew creates a build-time circular cycle | Low | High | Direction is one-way: crew depends on studio's dist artifact only; studio never imports crew source |
| R-03 | crew-api-types git-ref pin becomes stale if tag is deleted | Low | Medium | Migrate pin to npm registry version (tracked as conditional in P9 review) |

## Assumptions

| ID | Assumption |
|---|---|
| A-01 | The crew daemon is always the auth authority; studio never manages tokens or users |
| A-02 | PTY terminal access via `/ws/terminals/:id` requires operator trust or higher (see ADR-004) |
| A-03 | Studio runs in modern Chromium; no IE/legacy browser support required |
| A-04 | The bundled-with-crew deploy model (same-origin, one port) is the primary production mode |

## Issues

| ID | Issue | Status |
|---|---|---|
| I-01 | crew-api-types pinned as git ref (tag `api-types-v0.1.0`) rather than npm registry version | Open — crew is at v0.2.0; studio pin needs update and registry publish |
| I-02 | `'system'` ActorKind absent from crew-api-types ActorKind union | Open — needs explicit decision: out-of-scope or add to contract + validation |

## Decisions

| ID | Decision | Date | Rationale |
|---|---|---|---|
| D-01 | Carved out as standalone repo from `wicked-crew/packages/studio` | 2026-08 | Independent versioning; own CI; "one repo per product" principle |
| D-02 | Ship marketing/deep-dive site at `ws.wickedagile.com` via `site/` subdir | 2026-08 | Consistent with all other wicked-* products |
| D-03 | Terminal WS requires operator trust (not observer) | 2026-08 | Stdin-inject capability is a write operation; trust ladder must be upheld |
