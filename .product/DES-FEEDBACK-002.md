# DES-FEEDBACK-002 — wicked-studio: operator round-3 response (FDE ergonomics)

**Status:** DRAFT
**Date:** 2026-08-21
**Scope:** Design only. No implementation. This is the design-phase deliverable.
**Repo in scope:** `wicked-studio` (+ flagged cross-repo prerequisites in `wicked-crew`)
**Reads first:** `.product/DES-VISION-001.md` (token system §2, slice discipline §6),
`.product/DES-FEEDBACK-001.md` (slices A–F, EC17–EC20 — all landed on main)
**Bases on:** DES-VISION-001 §2 (tokens), §6 (slices); DES-FEEDBACK-001 §8 (checklist, fixture)

---

## 0 What changed and why this document exists

DES-FEEDBACK-001's six slices (A–F) are merged: the rail is restructured, the project
dashboard lands context-first, the metrics bar answers named questions, Document and Video
are canvas-first. The operator walked the experience a third time — this round through the
lens of a forward-deployed engineer living in the tool all day — and named nine ergonomic
gaps plus two smaller ones. The theme of round 3 is **speed of hand**: the surfaces exist,
but moving between them still costs clicks and context.

The operator's own priority table (P0 → P2) governs both scope and slice order in this
document. As in round 2, the operator's words are quoted verbatim at each section and the
design derives from exactly those words.

**The wire rule (house rule, unchanged):** every data need in this document is verified
against the real crew daemon source (`wicked-crew/packages/crew/src/api/routes.ts`,
`packages/crew/src/projects/routes.ts`, `packages/crew-api-types/index.d.ts`) and marked
one of:

- **EXISTS(route)** — the daemon serves it today; the exact registration line is cited.
- **CLIENT-DERIVABLE(source)** — computable from data the studio already fetches/holds.
- **NEEDS-CREW-ENDPOINT(route)** — the daemon has no such route; the exact proposed route,
  schema, and security posture are specified, and the work is flagged as a cross-repo
  prerequisite slice in `wicked-crew`.

Live-daemon probes (read-only GETs against `127.0.0.1:7701`, crew 0.6.0) were run to
confirm the negative claims: `GET /api/v1/search` → 404, `GET /api/v1/runs/:id/files/:path`
→ 404, `GET /api/v1/runs/:id/diff` → 404, `GET /api/v1/health` → 200. The route
enumeration of `routes.ts` (all `app.get/post/put/patch/delete` registrations, lines
250–1693) is the authoritative source; the probes are corroboration.

---

## 1 P0-1 — Universal command palette

**Operator:** *"Universal Command Palette (Cmd+K / Ctrl+P): fuzzy search across all
projects (p:), active runs & gates (run:), repositories (repo:), quick verbs (> New Build,
> Toggle Theme, > Open Terminal)."* — with the review note: *"global Ctrl+K exists to
cancel runs."*

### 1.1 Current state — the binding audit

The review note is verified correct. The only global chord in the codebase is
`useKillShortcut` in `src/App.tsx:62–86`:

- `(e.ctrlKey || e.metaKey) && e.key === 'k'` — **both** Ctrl+K and Cmd+K are taken.
- Active only while a run is selected (`runId` non-null) and that run is non-terminal.
- Guarded against typing contexts: bails when the event target is an `input`, `textarea`,
  `select`, or `isContentEditable` (App.tsx:71–73).
- On fire: `e.preventDefault()` then `api.cancelRun(runId)` (App.tsx:197–207).

No other component binds a modifier chord (`grep -rn "metaKey|ctrlKey" src/` returns only
App.tsx:70). The seventeen `onKeyDown` handlers elsewhere are all local (Enter-to-send in
composers, Escape in modals) — none are global listeners.

There is no palette, no fuzzy matcher, and no global-shortcut registry: today a second
global chord would be a second ad-hoc `window.addEventListener` with its own guard copy.

### 1.2 The binding story (explicit, per the review's warning)

**Rule: one owner per chord, and the palette owns the universal ones.**

| Chord | Before | After |
|---|---|---|
| `Cmd+K` / `Ctrl+K` | kill selected run (App.tsx:70) | **opens the palette** — the industry-wide muscle memory (Slack, Linear, GitHub, VS Code) wins the prime chord |
| `Ctrl+P` / `Cmd+P` | browser print | **opens the palette** (same handler; `preventDefault()` suppresses print — standard palette practice, and the operator asked for this chord by name) |
| `Ctrl+Shift+K` / `Cmd+Shift+K` | — | **kill selected run** — the relocated kill chord, same guards, same non-terminal check, same silent-fail contract as today |
| `Escape` | (modal-local) | closes the palette when open; untouched elsewhere |

Why kill moves rather than the palette taking a lesser chord: the kill shortcut is
conditional (needs a selected, non-terminal run) and destructive; the palette is
unconditional and safe. The unconditional, safe action gets the unconditional, prime
chord. The kill action additionally becomes a palette verb (`> Cancel run`, shown only
when a non-terminal run is selected), so the muscle-memory path for existing users —
Ctrl+K then thinking "cancel" — still ends at a cancel affordance: the palette opens with
`> Cancel run` in the verb list, one Enter away, now with the run named before the finger
commits. This is strictly safer than today's blind kill.

**The shortcut registry.** Both chords and the triage keys (§2) register through one new
hook, `useGlobalShortcuts` (`src/hooks/useGlobalShortcuts.ts`, ~70 LOC): a single
`window.addEventListener('keydown')` with an ordered handler table. The typing-context
guard (input/textarea/select/contentEditable — the exact App.tsx:71–73 predicate, spelled
once and exported as `isTypingContext(e)`) runs before ANY table entry. `useKillShortcut`
is deleted and its behavior re-registered in the table. One listener, one guard, no copies
— the composition rule §2 and §1 both rely on.

Precedence when the palette is open: the palette's own list-navigation keys (arrow keys,
Enter, Escape, Tab) are handled by the palette's focused input, not the global table —
the global table checks `paletteOpen` and yields everything except the toggle chord
itself (pressing Cmd+K with the palette open closes it).

### 1.3 Palette anatomy

A centered overlay, top-third of the viewport, on `--surface-overlay` with
`--shadow-overlay` and `--radius-xl`, 560px wide, max-height 420px:

```
┌──────────────────────────────────────────────────────────┐
│  🔍 [ type to search…  p: run: repo: >          ]  esc   │  input row
│  ─────────────────────────────────────────────────────── │
│  RUNS & GATES                                            │
│  ⏸ Migrate auth tables · gate       api-migration    ↵  │  ← selected row
│  ● Add rate-limiting · working      api-migration       │
│  PROJECTS                                                │
│  ▸ api-migration                                         │
│  ▸ q3-review-deck                                        │
│  REPOSITORIES                                            │
│  ⬡ studio-api                                           │
│  VERBS                                                   │
│  > New Build        > New Project      > Open Terminal   │
│  ─────────────────────────────────────────────────────── │
│  ↑↓ navigate · ↵ open · tab cycle groups · esc close     │  hint row
└──────────────────────────────────────────────────────────┘
```

**Prefix grammar** (exactly the operator's):

| Prefix | Scope | Empty-query behavior |
|---|---|---|
| *(none)* | everything, grouped | gates first (attention order), then active runs, projects, repos, verbs |
| `p:` | projects only | all projects, attention-ordered (board model) |
| `run:` | runs & open gates | active + gated runs first, terminal runs after |
| `repo:` | repositories | all registered repos |
| `>` | verbs | the full verb list |

**Selecting an entry navigates** — every row is the same real-link contract the board
uses (href + onClick-preventDefault, deep-linkable): a run row → `runPath(id)` (Chat for
`crew.chat` members, Build otherwise — the ProjectDashboard's `runModeOf` rule,
`ProjectDashboard.tsx:212`); a gate row → the run with `#gate` (the `GATE_HASH` contract,
`GateChip.tsx:28`); a project row → `/p/:id` (the dashboard); a repo row → `/repos/:id`.

**The verb list** (each verb names its existing mechanism — no verb invents a surface):

| Verb | Mechanism | Shown when |
|---|---|---|
| `> New Build` | `navigate('/runs/new')` — or `modePath(projectId,'build') + '/new'` when inside a project (the §4.3 pre-bind) | always |
| `> New Project` | opens `NewProjectModal` (slice A component) | always |
| `> New Chat` | `navigate('/chats/new')` / project-scoped chat path | always |
| `> Toggle Theme` | `useAppearanceStore.update({ theme: next })` — the §2.14 theme instance flip, persisted by the store's existing debounced `PUT /settings` | always |
| `> Open Terminal` | opens the `Terminal` component in a `Modal` (the RightPanel pair, `RightPanel.tsx:396–403`) with `cwd` = selected run's workdir, else `'.'` | always |
| `> Cancel run` | the relocated kill action (§1.2) | selected run non-terminal |
| `> Approve gate` / `> Reject gate` | the §2 triage actions on the selected run's gate | selected run `awaiting_human` |

### 1.4 The index — every entry's data source (wire check)

The palette introduces **zero new endpoints** and fires **at most one request, on open,
never on mount**:

| Entry group | Source | Wire verdict |
|---|---|---|
| Projects | `useProjectsStore` (already loaded by the board/shell) | **CLIENT-DERIVABLE** (store) |
| Active runs & gates | the `runs` prop (App's one `useRuns()`) + `useGateStore.gates` | **CLIENT-DERIVABLE** (store) |
| Repositories | `api.listRepos()` | **EXISTS** (`GET /api/v1/repos`, routes.ts:368) — fetched once per palette OPEN (a user gesture, not a mount), cached for the session, stale-refreshed on next open |
| Verbs | static table §1.3 | client-only |

The zero-requests-on-mount constraint (DES-UXFIX-001 §2.4) is a Chat-surface rule about
phantom activity signals; the palette respects its spirit by fetching nothing until the
operator explicitly opens it, and nothing at all when the repos cache is warm.

### 1.5 Fuzzy matching — no library

Per the §2.3 precedent ("no library for 12 bars"): the corpus is at most a few hundred
strings held in memory. A dependency (fuse.js ≈ 20KB min+gz, flexsearch ≈ 30KB) fails the
same test the chart libraries failed. The matcher is a ~40 LOC case-insensitive
subsequence scorer in `src/palette/fuzzy.ts`: characters must appear in order; score
rewards word-boundary hits and consecutive matches, penalizes gaps; ties break on recency
(runs) or attention score (projects — the board's `scoreOf`, reused not reimplemented).
Matched characters render in `--accent` weight `--weight-semi` (the only accent use in a
row; selection background is `--accent-subtle`).

### 1.6 Token usage

Overlay: `background: var(--surface-overlay); box-shadow: var(--shadow-overlay);
border-radius: var(--radius-xl)`. Input: `--text-md --font-sans --ink-high` on
`--surface-raised`. Group headers: `--text-2xs --weight-medium --ink-dim`, uppercase,
`letter-spacing: 0.08em` (the rail's QUICK header spec, DES-FEEDBACK-001 §1.2). Row text:
name in `--text-sm --font-sans`, context (project name, status) in `--text-xs --font-mono
--ink-dim`. Status dots reuse `--status-*` exactly as board cards. Selected row:
`background: var(--accent-subtle)`; the focus ring is `--accent` (the §2.5 focus-ring
rule). Backdrop: the token-defined scrim (no raw rgba in the component). Motion: open at
`--dur-fast` `--ease-out` fade+4px rise; no loop (§1.6 grammar).

### 1.7 DOM ACs

- `[data-testid="command-palette"]` is absent from the DOM until Cmd+K/Ctrl+K or
  Ctrl+P/Cmd+P fires; present and focused (`document.activeElement` is its input) after.
- With the palette CLOSED and a non-terminal run selected, Ctrl+Shift+K cancels the run
  (assert `POST /runs/:id/cancel` fired); plain Ctrl+K does NOT cancel — it opens the
  palette (assert no cancel request).
- With focus inside any `input`/`textarea`/contentEditable, Cmd+K does nothing (palette
  stays absent) — asserted by focusing the chat composer first.
- Typing `p:` filters rows to `[data-group="projects"]` only; `run:`, `repo:`, `>`
  likewise; `[data-testid="palette-row"]` count matches the fixture.
- ArrowDown/ArrowUp move `[data-selected="true"]`; Enter on a run row navigates to that
  run's mode path (assert URL); Escape closes and returns focus to the previously focused
  element.
- Zero network requests fire on app mount attributable to the palette; on first OPEN,
  exactly one `GET /repos` fires (asserted via `page.on('request')`).
- Computed `background` of the palette overlay and selected row resolve from `var()`
  references (EC15).

---

## 2 P0-2 — Keyboard-first gate triage

**Operator:** *"Keyboard-first gate triage on HomeBoard + ProjectDashboard: j/k select
next/previous card, a approve, r reject-with-inline-prompt-focus. Must compose with the
palette and with typing contexts (never steal keys while an input/composer is focused)."*

### 2.1 Current state

Gate answering is mouse-only today. On the home board, a waiting gate is an answerable
`GateChip` on its project card (`GateChip.tsx:71+`): simple gates (≤2 choices, no free
text — `isSimpleGate`, `gates.ts:59–63`) show inline `[Approve] [Reject]` buttons wired
to `POST /runs/:id/gate` (**EXISTS**, routes.ts:780, body `{approve: boolean, amend?:
string}` — `GateSchema`, routes.ts:157–159); complex gates deep-link into the thread with
`#gate`. On the ProjectDashboard, tile 3 (`dashboard-gates`,
`ProjectDashboard.tsx:310–320`) renders the same chips per waiting run. No key reaches
any of this; there is no selection model on either surface.

### 2.2 The selection model

A **roving triage cursor** over the gate-bearing rows of the current surface, order =
what the surface already renders (attention order — the model is untouched, the cursor
just walks it):

- **HomeBoard:** the cursor walks the NEEDS-YOU band's cards (`band-needs-you`,
  `HomeBoard.tsx:263`) — the cards that carry gates/failures. It does not enter the quiet
  band: triage keys exist for what needs you.
- **ProjectDashboard:** the cursor walks the gate-inbox rows (`dashboard-gates` tile).

`j` / `ArrowDown` selects next, `k` / `ArrowUp` previous (vim pairing, both work). The
selected card/row gets `data-kbd-selected="true"` and a visible 2px ring in `--accent`
(`outline: 2px solid var(--accent); outline-offset: 2px`) — the focus-ring token rule, so
keyboard a11y is satisfied by construction: the ring is the `:focus-visible` treatment,
and the selected element receives real DOM focus (`tabIndex={-1}` + `.focus()`), so
screen readers track the cursor too.

First press of `j` with no selection selects the first row. The cursor clears on route
change and on Escape.

### 2.3 The action keys

- **`a` — approve.** Simple gates only (the `isSimpleGate` boundary is not moved): fires
  the same `POST /runs/:id/gate` `{approve: true}` the chip's button fires, with the same
  in-flight ("approving…") and error-adjacent-to-control states (§3.3 contract). On a
  complex gate, `a` does what the chip's only affordance does: opens the thread at
  `#gate` — the honest action, never a blind approve of a question that needs prose.
- **`r` — reject with inline prompt focus.** Opens a one-line note input INSIDE the
  selected card (replacing the chip row while open), focused immediately:
  `[ reason (optional) — ↵ reject · esc cancel ]`. Enter sends `{approve: false}` — with
  the typed note as `amend` when non-empty. Wire honesty: `GateSchema` accepts `amend`
  regardless of `approve` (routes.ts:157–159), and the daemon's gate audit durably records
  it on the decision (`audit.record('gate.decided', …)` includes `amend`,
  routes.ts:797–806). The note is therefore a real, recorded rejection reason at the
  audit layer; the design claims nothing further about engine-side surfacing. Escape
  closes the note input and restores the chip row.
- **`Enter` — open.** Navigates into the selected run (same target as clicking the card).

While the note input is open it IS a typing context: `j`/`k`/`a` are inert by the §1.2
guard (the input is focused, `isTypingContext` returns true). No second mechanism needed.

### 2.4 Composition rules (the operator's "must compose" clause)

All triage keys register in the §1.2 `useGlobalShortcuts` table, AFTER the palette
toggle, with these gates evaluated in order:

1. `isTypingContext(e)` → inert (the composer/input/select guard, one shared predicate).
2. `paletteOpen` → inert (the palette owns the keyboard while open).
3. Surface check → the handler is registered only while HomeBoard or ProjectDashboard is
   the rendered center surface (the hook is mounted BY those surfaces, not globally).

Unmodified single letters are used deliberately — they are what makes triage fast — and
are safe exactly because of gate 1: there is no way to type `j` into a focused input and
lose it to the cursor. This is the Gmail/Linear model, stated as a design invariant:
**no unmodified key ever acts while anything editable has focus** (EC21, §12.1).

### 2.5 Token usage

Selection ring: `--accent` (outline, not border — no layout shift). The inline reject
note: `--surface-raised` background, `--radius-md`, `--text-xs --font-sans --ink-high`,
placeholder `--ink-dim`; its confirm hint in `--text-2xs --ink-dim --font-mono`. The
in-flight and error states reuse the GateChip's existing status-token pairs (`--status-run`
on `--status-run-dim` for the approving state, `--status-fail` pair for reject/errors).
Hint row (bottom of the needs-you band, visible only while a cursor is active):
`j/k select · a approve · r reject · ↵ open` in `--text-2xs --ink-dim --font-mono`.

### 2.6 DOM ACs

- On the home board with the W2 fixture (≥2 gated projects): pressing `j` sets
  `[data-kbd-selected="true"]` on the first needs-you card and moves DOM focus there;
  `j` again advances; `k` returns; the ring's computed `outline-color` resolves from
  `var(--accent)` (EC15).
- With the cursor on a simple-gate card, `a` fires `POST /runs/:id/gate` with
  `{"approve":true}` (asserted via request interception); the card shows the in-flight
  state without navigation.
- `r` renders `[data-testid="gate-reject-note"]` focused inside the selected card; typing
  a reason and Enter fires `{approve:false, amend:"<reason>"}`; Escape instead restores
  the chip row and fires nothing.
- With the chat composer focused (ProjectDashboard variant: any input), `j`, `a`, `r`
  insert characters normally and move no cursor (assert input value AND absence of
  `data-kbd-selected`).
- With the palette open, `j`/`k` move the PALETTE selection, not the board cursor.
- On a complex-gate card, `a` navigates to the run thread with `#gate` and fires no gate
  POST.

---

## 3 P0-3 — In-studio code & diff viewer

**Operator:** *"In-studio code & diff viewer in RightPanel's FilesPanel: inline
syntax-highlighted view + diff instead of only api.openPath() external launch."*

### 3.1 Current state

`FilesPanel` (`RightPanel.tsx:144–241`) derives a run's file list client-side from
governance hook fires + `filesRead` sets on the run model, classifies rows as
modified/deleted/referenced, and each row's only affordances are: **open externally**
(`api.openPath(path, runId)` → daemon-side `POST /open`, OS default app —
`RightPanel.tsx:95–102`, crew routes.ts:325–366) and **copy path**. Nothing renders file
content or a diff inside the studio.

### 3.2 Wire check — what can the daemon serve today?

**Nothing.** The full route enumeration of crew's `routes.ts` (and `projects/routes.ts`)
contains no file-content read and no diff route; the live daemon corroborates (404 on
both probes, §0). The nearest machinery:

- **Path containment exists and is exactly right to reuse:** `isInsideRoot`
  (`packages/crew/src/api/open-path.ts:18–45`) — realpath-resolved, symlink-safe,
  fails-closed containment against a root set; `POST /open` (routes.ts:325–366) builds
  that root set as *run workdir + `extra_write_roots` + all registered repo roots* and
  403s anything outside. `AgentSession` carries `workdir` and `extra_write_roots` on the
  wire (crew-api-types index.d.ts:152–155).
- **Capped subprocess execution exists:** `execCapped('git', [...], {timeout, cwd})` is
  the pattern `GET /repos/:id/git-history` already uses (routes.ts:1520–1552), including
  ENOENT ("git not found") and not-a-repo handling.

Both new routes below are therefore assembly of existing, reviewed crew machinery — not
new security surface design.

### 3.3 NEEDS-CREW-ENDPOINT — the two routes (cross-repo prerequisite, slice CREW-1)

**Route 1: file content.**

```
GET /api/v1/runs/:id/files?path=<absolute path>
```

- 404 unknown run. 400 non-absolute path. **403 unless `isInsideRoot(root, path)` for
  some root in the SAME root set `POST /open` builds** (run workdir + extra_write_roots +
  registered repo roots — one shared `allowedRootsFor(view, repos)` helper extracted from
  the /open handler so the two routes cannot drift).
- Response 200:
  ```json
  {
    "path": "/abs/path/src/foo.ts",
    "content": "…file text…",
    "size": 14203,
    "truncated": false,
    "binary": false
  }
  ```
- **Caps:** content read is capped at 512 KB; beyond that `content` holds the first
  512 KB and `truncated: true`. Binary sniff (NUL byte in the first 8 KB) returns
  `binary: true` with `content: ""` — the studio renders "binary file · open externally"
  and falls back to the existing `openPath` affordance.
- Read-only by construction (`fs.readFile`), no query flags that write, no directory
  listing (the studio already HAS the file list from the run model; serving trees would
  be scope creep).

**Route 2: run diff.**

```
GET /api/v1/runs/:id/diff            → whole-worktree diff
GET /api/v1/runs/:id/diff?path=<abs> → one file's diff
```

- 404 unknown run. 409 when the run has no `workdir` (nothing to diff against).
  With `path`: same 400/403 containment as route 1.
- Implementation: `execCapped('git', ['diff', '--no-color', '--no-ext-diff', 'HEAD',
  '--', <rel>?], {timeout: 10_000, cwd: workdir})` — the git-history pattern
  (routes.ts:1520). `--no-ext-diff` prevents configured external diff drivers from
  executing arbitrary tools; the path argument is a single argv element after the `--`
  separator (no shell string — the open-path rule, open-path.ts:1–7).
- Response 200:
  ```json
  {
    "diff": "diff --git a/src/foo.ts b/src/foo.ts\n…unified diff…",
    "truncated": false
  }
  ```
  Output capped at 1 MB (`truncated: true` past it). `diff: ""` = clean tree (a real
  answer, not an error). Untracked files: appended as `git diff --no-index /dev/null
  <file>` hunks for files in the run's modified set that `git status --porcelain` reports
  untracked — so a run's *created* files diff as all-additions rather than vanishing.
- 500 with named error on git ENOENT ("git executable not found on server") — the
  git-history contract.

**Security posture summary** (models the validated-open machinery, as directed): both
routes are GET-only, containment-checked against the run's declared roots via the
symlink-safe fail-closed `isInsideRoot`, cap their payloads, execute no shell strings,
and add zero write capability. The threat delta over the existing `POST /open` is
strictly smaller: /open hands the path to an OS opener; these routes only ever return
bytes the daemon process can already read within the same containment.

### 3.4 The studio viewer (slice I, depends on CREW-1)

`FilesPanel` rows gain a third affordance — the row itself opens the **inline viewer**;
the external-open glyph (`↗`, the current behavior) and copy (`⧉`) move to hover-revealed
row-end icons. The viewer opens as a canvas-scale overlay, not a column: a modal panel at
`min(1100px, 86vw) × 82vh` on `--surface-overlay` (EC18's spirit — a file you are reading
deserves the viewport; the 288px RightPanel cannot show code).

```
┌── src/api/client.ts ── [File] [Diff] ──────────── ↗ open · ⧉ · esc ─┐
│   1  import type {                                                   │
│   2    ActivityPage,                                                 │
│  ▸▸ diff view: unified, hunks colored                                │
│  @@ -61,6 +61,9 @@                                                   │
│  -  const res = await fetch(url);                                    │
│  +  const res = await fetch(url, { headers });                       │
└───────────────────────────────────────────────────────────────────────┘
```

- **[File] tab** → `GET /runs/:id/files?path=…`; mono text (`--font-mono --text-xs
  --ink-body`), line numbers in `--ink-dim`, horizontal scroll inside the pane.
  `truncated: true` renders a labeled banner ("showing first 512 KB — open externally
  for the full file") — the viewer never silently amputates (EC23, §12.1).
- **[Diff] tab** → `GET /runs/:id/diff?path=…`; default tab when the row is in the
  modified set, File tab when referenced-only.
- Per-run "[Full diff]" button at the FilesPanel header → the same viewer with the
  whole-worktree diff.

### 3.5 Highlighting — the lean approach (the §2.3 precedent applied)

**No grammar library ships.** Shiki (~700 KB of grammars+wasm), highlight.js (~90 KB
min), Prism (~40 KB + per-language) all fail the information-is-the-aesthetic test for
what this viewer must answer — "what did the run change?" — which is a **diff-coloring**
question, not a tokenization question. The v1 renderer is plaintext-first with exactly
two colorizers, both pure string operations (~60 LOC total, zero deps):

1. **Diff line classifier:** `+` lines → `--status-run` on `--status-run-dim`, `-` lines
   → `--status-fail` on `--status-fail-dim`, `@@` hunk headers → `--ink-dim` on
   `--surface-raised`, file headers → `--ink-muted --weight-semi`. This is the linguist
   exemption's opposite: diff colors are ALREADY our status tokens' meaning (added =
   running-green family, removed = fail-red family) — no new palette, no exemption
   needed.
2. **File-view comment/string dimmer (optional, same pass):** line comments (`//`, `#`)
   and block-comment lines render `--ink-dim`; everything else `--ink-body`. Deliberately
   NOT full syntax highlighting — it is the 80% of readability (separating prose from
   code) for 2% of the cost, and it degrades to plain mono on any language it doesn't
   recognize rather than mis-tokenizing.

If a future round demands true highlighting, the named upgrade path is lazy-loading a
single-file tokenizer per view (dynamic import, cache-once) — a decision that gets its
own justification then, not smuggled in now.

### 3.6 Token usage

Viewer overlay: `--surface-overlay`, `--shadow-overlay`, `--radius-xl`. Tab row:
active tab `--ink-high` with 2px `--accent` underline (the mode-switcher grammar);
inactive `--ink-muted`. Code: `--font-mono --text-xs`, `--leading-body`. Line numbers:
`--ink-dim`, unselectable. Diff tokens per §3.5. All colors token-resolved (EC15) — the
diff colorizer emits class names mapped to tokens in CSS, never inline hex.

### 3.7 DOM ACs

- (CREW-1, in wicked-crew's own test suite:) `GET /runs/:id/files?path=<inside-workdir>`
  → 200 with `content`; `?path=<outside all roots>` → 403; `?path=<workdir>/../etc/passwd`
  → 403 (traversal); a >512 KB fixture file → `truncated: true`; a NUL-containing file →
  `binary: true`. `GET /runs/:id/diff` on a worktree with one staged edit returns a
  non-empty unified diff; on a clean tree returns `{"diff":""}`.
- (Studio:) clicking a modified-file row opens `[data-testid="file-viewer"]` with the
  Diff tab active; `[data-testid="diff-line-add"]` computed `color` resolves from
  `var(--status-run)` (EC15); switching to File shows numbered content.
- No `<script>` or import of any highlight/grammar library exists in the bundle (grep
  assertion, the §2.3 precedent's enforcement).
- A `truncated` response renders `[data-testid="viewer-truncation-banner"]` (EC23).
- Against a daemon WITHOUT the routes (404), the row click falls back to today's exact
  behavior (`openPath` external launch + copy feedback) and the viewer never renders an
  empty shell — the forward-compat contract every studio wire follows.
- Escape closes the viewer; focus returns to the FilesPanel row.

---
