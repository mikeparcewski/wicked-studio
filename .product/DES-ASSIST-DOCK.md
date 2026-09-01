# DES-ASSIST-DOCK — one right-panel assistant, docked beside any surface

**Status:** implemented v1 on Steering (feat/steering-spreadsheet)
**Scope:** `src/components/AssistDock.tsx` (the reusable panel), its Steering binding in
`SteeringPage.tsx`, and the reuse contract for every later surface.
**Companion change:** the Steering type page's rule list became an editable SPREADSHEET
(`SteeringGrid.tsx`) — the dock is how conversational/document work reaches that grid.

## 1. The problem (verbatim intent)

> "steering should be treated like a spreadsheet (adding/removing editing rows). With a right
> panel that lets you add data by chatting or analysis of docs or uploading directly. It should
> be treated as a chat panel though, so it can be used throughout."

Two directives in one:

1. **Steering-local:** the management flows that used to hide behind an Add ▾ menu (import a
   doc, author with chat) become a right-hand CHAT panel beside the grid — you talk to it, drop
   documents on it, and it does governed work while you keep editing rows.
2. **App-wide:** "so it can be used throughout" — the panel is NOT a Steering widget. It is a
   generic assistant surface; Steering is v1 of its binding contract.

## 2. The concept

```
┌──────────────────────────────────────────────┬────────────────────┐
│ Steering › Security          [Add ▾][Refresh]│ ASSISTANT   [»]    │ ← header (collapse)
│ FilterStrip: search · severity · retired     │ context: Security  │
│ ┌──────────────────────────────────────────┐ │────────────────────│
│ │ id | type | sev | statement | w | … | st │ │ THREAD (scrolls)   │
│ │ …the editable grid, scrolls inside…      │ │  you: …            │
│ │                                          │ │  · notes (narrated)│
│ └──────────────────────────────────────────┘ │  ┌ run block ────┐ │
│                                              │  │ NowBar        │ │
│                                              │  │ NarratorFeed  │ │
│                                              │  └───────────────┘ │
│                                              │────────────────────│
│                                              │ APPROVAL DOCK      │ ← pinned, never scrolls
│                                              │ [SteeringGate]     │
│                                              │────────────────────│
│                                              │ [+] textarea [→]   │ ← composer
└──────────────────────────────────────────────┴────────────────────┘
```

- The dock is a **sibling column** of the page content, full height, its own scroll; at
  1440×700 the grid and the dock coexist with zero horizontal page scroll (the grid scrolls
  inside its own container).
- A typed message becomes a **governed run** (on Steering: the `steering-author` workflow).
  The run **narrates inline** through the SHIPPED narrator modules — `NowBar` + `NarratorFeed`
  (DES-RUN-NARRATOR §2/§9), rendered inside the thread's run block. No fork, no second
  narrator.
- Anything awaiting the human renders in the **pinned `ApprovalDock`** between the thread and
  the composer (`chatId` entry point, §11.5) — the propose gate is answered without leaving
  the page (approve / approve+steer / reject-with-note, the verbatim `SteeringGate`).
- Collapse is a per-surface persisted preference (`localStorage`, key
  `wicked.assist.<surface>.open`); collapsed, the dock is a slim re-open rail.

## 3. The generic contract

The dock owns pixels and thread mechanics; a SURFACE owns meaning. The binding is three
values — `{context, verbs, importable}` — all plain props, no registry:

```ts
interface AssistContext {
  surface: string;      // stable key: storage namespace ('steering', 'testing', …)
  title: string;        // panel header ('Assistant')
  contextLabel: string; // what the verbs are typed against ('Steering · Security')
  placeholder: string;  // composer hint ('Describe the rules to author…')
  hint?: string;        // one-liner under the header — what a message DOES here
}

interface AssistVerbs {
  /** A typed message. Launch a governed run and return its id — the dock narrates it
   *  inline and pins its gates. `documents` = the analysis attachments riding this send. */
  send: (text: string, documents: AssistDocument[]) => Promise<{ runId: string }>;
  /** Optional: the direct-import fork for rule-shaped attachments. Returns narration
   *  notes the dock echoes into the thread. Absent ⇒ no "Import directly" affordance. */
  importDirect?: (doc: AssistDocument) => Promise<AssistNote[]>;
  /** Fired when a pinned gate/elicitation resolves — the surface reloads its data. */
  onRunResolved?: () => void;
}

type AssistDocument = { name: string; content: string };
type AssistNote = { tone: NarrationTone; text: string };  // narrator vocabulary (narrator.ts)

/** Which attachments get the Import-directly vs Analyze-with-chat fork. */
importable?: (name: string) => boolean;
```

Wire adapters live in the HOST page: `SteeringPage` builds `send` over
`POST /governance/steering/author` (`{instructions, type, documents}` — the page's steering
type rides every launch) and `importDirect` over `POST /governance/steering/import` (typed the
same way, per-entry results echoed as notes). The dock itself imports NO wire module — that is
the reuse seam.

### 3.1 Attachments — the import-vs-analyze fork

Drag/drop onto the panel or pick via the composer's `+`. Every file is read client-side
(`readFileText`, the one reader). Then:

- a file `importable(name)` says is **rule-shaped** (Steering: `.md`/`.json`) chips with TWO
  actions: **Import directly** (fires `importDirect` now; per-entry results echo into the
  thread as narration notes — created/updated ids, rejections with reasons) vs **Analyze with
  chat** (marks it an analysis document);
- any other file attaches for analysis, no fork;
- analysis documents ride the NEXT `send` as `documents[]` and clear with it.

### 3.2 The run block — reused, not re-implemented

A launched run renders as one thread block:

- `NowBar` (status / phase / latest narration / artifacts chip — §11.4 status grammar);
- `NarratorFeed` (`lens: 'feed'`) in a fixed-height region with its own tail-pinned scroll;
- the run's `SessionView` hydrates like `useRunModel` does (snapshot `GET /runs/:id`,
  re-fetched on lifecycle frames from the ONE `/ws` fold) — before the snapshot lands the
  block shows the honest "launched — narrating shortly" line.

Gates deliberately do NOT live in the run block: the pinned `ApprovalDock` below the thread
is the action surface (DES-RUN-NARRATOR §2 — approvals go direct to the user and can never
scroll away). The author run is a REAL run (it is in `GET /runs`), so the gate store's prune
reconcile keeps it without an awaiting-pin.

## 4. What dies on Steering (v1)

- `SteeringImportPanel.tsx` — deleted; the import wire + per-entry honesty moved into the
  dock's attachment fork (and its result rendering was CORRECTED to the engine's actual
  per-entry vocabulary — `imported`/`rejected` with `ids[]`, see `importEntryOutcome`).
- The Add ▾ menu's three flows collapse to two entries: **Add row** (the grid's draft row)
  and **Open assistant** (the dock). The modal rule form survives as the drawer's EDIT
  surface only (advanced fields: effect/trigger/obligations/criteria/provenance).
- `SteeringAuthorPanel.tsx` does NOT die: `TestingPage` still consumes it verbatim
  (`type="testing"`). It is the named migration candidate below.

## 5. The reuse plan (what "throughout" means)

| Surface | Binding sketch |
|---|---|
| **Testing / Harness** (first) | `send` → the same author wire with `type: 'testing'` (exactly what `AuthorPanel` does today); `importDirect` → the corpus import wire. Retires `SteeringAuthorPanel`. |
| **Projects / project home** | `send` → `POST /runs` scoped to the project (`projectId` rides the launch); attachments → run files. The dock becomes "ask for work from anywhere". |
| **Repos** | `send` → a recon run against the repo (`repoRef`); importable: none. |
| **Evals** | `send` → corpus authoring; `importDirect` → `POST /testing/corpus`. |

Rules for every future binding:

1. The dock stays wire-free — new verbs mean a new adapter in the HOST page, never a new
   prop on the dock that names a route.
2. Runs narrate through the shipped narrator modules only. If a surface's runs need different
   speech, that is a `narrator.ts` change (one narrator), not a dock fork.
3. Collapse state is per-surface (`wicked.assist.<surface>.open`) — a coder who closes the
   assistant on Repos still has it open on Steering.
4. The thread is session-local by design (it is a control surface, not a record); anything
   durable a run does is in the run trail/evidence, where it already lives.

## 6. Tests

- `AssistDock.test.tsx` — the generic contract over fixture verbs: send posts text+documents
  and mounts the run block; the import-vs-analyze fork (importable files offer both, plain
  files attach silently); import notes echo; a pinned gate renders inside the panel
  (gate-store fixture) and resolving fires `onRunResolved`; collapse persists per surface key.
- `SteeringPage.manage.test.tsx` — the Steering BINDING: the author body carries
  `{instructions, type, documents}`; the import body carries `{type, entries}`; the 501
  unsupported daemon gets the honest copy in-thread; the two-entry Add menu.
- `SteeringGrid.test.tsx` — the companion grid (cell commit bodies, Esc revert, draft-row
  id validation incl. the reserved PAT-/POL- namespace, retire dims, include_retired).
