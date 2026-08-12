# REQ-003 — Domain Model

**Status**: Active  
**Version**: 1.0  
**Product**: wicked-studio  
**Related**: REQ-001, DES-001, wicked-crew DES-EXEC-001

---

## Overview

wicked-studio is a **read-mostly, real-time observer** of the wicked-crew control plane. Its domain model is a projection of the wicked-crew wire contract — all entities originate in crew's store and arrive in studio via HTTP polling or WebSocket events.

---

## Core entities

### Run

A single governed execution of a workflow. The primary aggregate.

| Field | Source | Studio role |
|---|---|---|
| `id` | crew `GET /runs/:id` | Primary key; routes all panels |
| `status` | CoreEvent stream | Live-updated; drives status chip |
| `workflowId` | crew response | Labels the run |
| `projectId` | crew response | Scopes the run to a project |
| `gates` | CoreEvent `GateRequired`, `GateDecided` | HITL panel state |
| `units` | CoreEvent `UnitDistributed`, `StepCompleted` | Unit timeline |
| `evidence` | `GET /runs/:id/evidence` | Evidence bundle panel |

### Project

Organises runs into named scopes. Secondary aggregate.

| Field | Source | Studio role |
|---|---|---|
| `id` | crew `GET /projects` | Route segment |
| `name` | crew response | Display label |
| `status` | crew response | active / archived; filter |
| `memberCount` | crew response | Team indicator |

### Gate

A human-in-the-loop decision point within a run. Ephemeral in studio — no local persistence.

| States | Trigger |
|---|---|
| `pending` | `CoreEvent.GateRequired` arrives |
| `approved` | Operator calls `POST /runs/:id/gate { approve: true }` |
| `rejected` | Operator calls `POST /runs/:id/gate { approve: false }` |

Studio enforces deny-dominance UI: the Reject button is always rendered, regardless of current gate state.

### Unit

One phase in a run's workflow execution, assigned to one CLI seat.

Studio renders units as a timeline. Unit state transitions come from CoreEvents: `UnitDistributed` → `StepStarted` → `StepCompleted` / `StepFailed`.

### CoreEvent

The real-time event stream from `GET /ws`. Studio receives ALL events for subscribed runs and projects. Events are not stored in studio — they're applied to in-memory state and discarded.

---

## Invariants studio must enforce in its UI

1. **Deny-dominates**: a gate's Reject control must always be reachable, regardless of other UI state.
2. **No late-join replay**: studio does NOT cache CoreEvents — joining a run in progress shows only events received after the WS subscription opened.
3. **Status defaults**: if a CoreEvent describing a new unit arrives before the parent run's status is known, the unit renders with a neutral `pending` status — no crash, no `undefined` in the type label.
4. **Evidence bundle is read-only**: studio never writes to the evidence bundle; it only downloads it.

---

## Entities studio does NOT own

These live in wicked-crew and are consumed read-only:

- Governance policy rules
- Validator definitions
- Workflow definitions
- Token/actor registry (auth is crew's responsibility; studio shows the current actor from the API response)
