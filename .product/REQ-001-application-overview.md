---
name: REQ-001-application-overview
title: wicked-studio — Application Overview
status: approved
version: 0.1
date: 2026-08-12
author: mike.parcewski@gmail.com
review-required: false
---

# REQ-001 — Application Overview

## 1. Purpose

wicked-studio is the **coder-facing skin of the wicked experience plane**. It is a React SPA — a
pure HTTP/WS client of the [wicked-crew](https://github.com/mikeparcewski/wicked-crew) daemon —
for launching and steering governed agent runs, answering human-in-the-loop gates, and watching
live CoreEvent streams.

The core problem it solves: the wicked-crew daemon is fully headless and powerful, but a
terminal-only UX makes it inaccessible during live runs. wicked-studio gives operators a reactive,
evidence-grounded window into every run without adding coupling to the control plane.

---

## 2. What wicked-studio IS

- **An experience-plane skin**: One of two interchangeable front doors (wicked-interactive is the creator skin; wicked-studio is the coder skin).
- **A pure HTTP/WS client**: All data and actions go through `/api/v1` REST and `/ws` WebSocket. Zero access to crew source code or SQLite.
- **A human gate interface**: When a run pauses for human approval, studio surfaces the artifact, governance findings, and approve/reject controls.
- **A live run monitor**: CoreEvent fan-out over `/ws` drives a real-time phase progress view, event log, and coverage/evidence panel.
- **A projects interface**: Browse, create, and archive projects; scope runs by project.
- **A decisions ledger browser**: Reads the audit trail from `/api/v1/audit` and governance evidence from `/api/v1/runs/:id/evidence`.
- **Bundled with crew**: `wicked-crew`'s release build copies studio's `dist/` into the daemon's serving tree so `npx wicked-crew serve` ships the UI same-origin on one port.

---

## 3. What wicked-studio IS NOT

- Not wicked-crew. It does not own the engine, gates, or evidence. The daemon is fully headless.
- Not an AI coding agent. It does not invoke LLMs or write code.
- Not a cloud app. Localhost-first: the `VITE_API_HOST` env var points it at a daemon.
- Not the wicked-interactive creator skin (that is a separate product for non-coder audiences).

---

## 4. Actors and Primary Flows

### Actor: developer / operator (the person running wicked-crew)

**Flow 1 — Launch a governed run**
1. Open studio. Select or create a project.
2. Enter goal text, select workflow definition.
3. Click "Start run". Studio calls `POST /api/v1/runs`.
4. Run card appears in the run list; live CoreEvents start arriving via `/ws`.

**Flow 2 — Approve a human gate**
1. Crew pauses at a `wicked.crew.gate.awaiting_human` event.
2. Studio surfaces a gate card: artifact text, governance findings, approve/reject/modify controls.
3. Operator reads, decides, submits. Studio calls `POST /api/v1/runs/:id/gate` with `{approve: true/false}`.
4. Crew advances (or denies) the phase. Studio shows updated state within 2 seconds.

**Flow 3 — Monitor a live run**
1. Run detail view shows: current phase, phase graph, last event, worker PTY output via `/ws/terminals/:id`.
2. Evidence panel populates as phases complete (`GET /api/v1/runs/:id/evidence`).
3. Coverage report visible once the domain-extraction phase completes.

---

## 5. Constraints

- **Wire contract only**: Studio imports `wicked-crew-api-types` for types; no crew source. No Rust.
- **No auth required in local mode**: Crew defaults to `authMode: 'off'` for local use. Studio passes a bearer token when auth is configured.
- **Same-origin default**: Bundled with crew, the SPA uses `window.location.origin` for the daemon URL. Split-dev uses `VITE_API_HOST`.
- **Browser only**: No Node.js runtime. Built with Vite; output is static HTML/JS/CSS.

---

## 6. Success Criteria

- **SC-S01**: Studio connects and shows the run list within 3 seconds of page load (crew daemon running on localhost).
- **SC-S02**: Gate notification appears within 2 seconds of the `wicked.crew.gate.awaiting_human` WebSocket event.
- **SC-S03**: Approving a gate via studio advances the run in crew within 3 seconds.
- **SC-S04**: Run list and detail view reflect CoreEvents within 2 seconds without page reload.
- **SC-S05**: Graceful disconnected state when daemon is unavailable (no crash, auto-reconnect).
- **SC-S06**: Works in Chrome on macOS at ≥1280px. Dark and light themes.

---

## 7. Technology Choices

| Concern | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript | Crew uses TypeScript; React is the dominant SPA ecosystem for this use case |
| Build | Vite 7 | Fast HMR; compatible with crew's bundling step for same-origin serve |
| Styling | Tailwind CSS | Utility-first, no design-system coupling to crew |
| State | TanStack Query (server) + Zustand (UI) | TQ handles REST cache invalidation; Zustand handles ephemeral UI state |
| Icons | lucide-react | Consistent with wicked-interactive |
| Tests | vitest + testing-library | Standard for Vite/React; matches garden's test toolchain |

---

## 8. Relationship to wicked-crew

| wicked-crew provides | wicked-studio uses |
|---|---|
| `GET /api/v1/runs` | Run list |
| `GET /api/v1/runs/:id` | Run detail + phase graph |
| `POST /api/v1/runs` | Launch a new run |
| `POST /api/v1/runs/:id/gate` | HITL gate decision |
| `GET /api/v1/runs/:id/evidence` | Evidence browser |
| `GET /api/v1/projects` | Project browser |
| `WS /ws` | Live CoreEvent stream |
| `WS /ws/terminals/:id` | Live PTY output (read) |
| `wicked-crew-api-types` | Type-safe wire contract |

---

## 9. Definition of Done

- SC-S01..SC-S06 verified against a running crew daemon
- HITL gate flow exercised end-to-end (studio → API → crew → phase advance)
- Test suite passes (`npm test`)
- TypeScript strict-mode clean (`npm run typecheck`)
- Lint clean (`npm run lint`)
- Build succeeds (`npm run build`)
- Standalone e2e test (`e2e/studio_standalone_test.py`) PASS
- npm package published (`wicked-studio@0.x.x`)
- Live site at `ws.wickedagile.com`
