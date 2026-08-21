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

## 4 P1-4 — Project pivot on the context header

**Operator:** *"ProjectSwitcher dropdown ON the context-header project name (1-click pivot
to another project RETAINING the current mode verb)."*

### 4.1 Current state

The project-context header (`ProjectShell.tsx:101–135`, slice D) renders the project name
as a plain link back to the project dashboard (`ProjectShell.tsx:122–130`). Pivoting to a
sibling project today costs: name → dashboard → `‹ Projects` → board → other project →
mode tab. Four clicks to do what the operator wants in one.

The `ProjectSwitcher` component (slice A/B, `ProjectSwitcher.tsx:36+`) already does the
hard part: current binding + filterable project list + outside-click close + `onOpen`
lazy-load hook + `dropUp`. It owns no fetch — callers pass projects they already have.

### 4.2 Design

The header's project name becomes the ProjectSwitcher's trigger, in a header-flavored
dress (a `variant="crumb"` prop — same behavior, breadcrumb typography instead of the
form-field box):

```
‹ Projects   api-migration ▾  ›  Build
             ┌──────────────────────┐
             │ filter projects…     │
             │ ▸ api-migration    ✓ │
             │ ▸ q3-review-deck     │
             │ ▸ smoke-suite        │
             │ ──────────────────── │
             │ ⌂ Project dashboard  │
             └──────────────────────┘
```

- **Selecting a sibling project navigates to `modePath(nextId, mode)`** — the SAME mode
  verb, no artifact id (the artifact belongs to the old project; carrying it would 404 or
  worse, silently show the wrong project's run). Mode retention is exactly the operator's
  ask; artifact retention is deliberately NOT promised.
- The current project renders with a `✓` and selecting it is a no-op close.
- The dashboard link the name used to be does not vanish: the dropdown's last row
  (`⌂ Project dashboard`) navigates to `/p/:projectId` — and the `›`-separated crumb
  itself stays middle-clickable to the dashboard via a small `⌂` glyph directly after the
  name, preserving the deep-linkable-real-link contract (§4.2 of DES-FEEDBACK-001).
- No "Unfiled" row and no "+ New project" row here: this is a pivot between projects, not
  a binding field — `onNewProject` is simply not passed, and Unfiled is not a project you
  can stand in.

**Wire verdict:** **CLIENT-DERIVABLE** — `useProjectsStore` is already loaded by the
shell itself (`ProjectShell.tsx:61–66`); the dropdown adds zero requests.

### 4.3 Token usage

Trigger: the existing CRUMB spec (`--text-sm --weight-medium --font-sans --ink-muted`,
ProjectShell.tsx:31–35) plus a `▾` in `--ink-dim` that turns `--ink-high` on hover/open.
Dropdown: `--surface-raised`, `--shadow-raised`, `--radius-md` (the ProjectSwitcher's
existing dress); the `✓` in `--accent`. Focus ring on the trigger: `--accent` (keyboard
reachable: the trigger is a real `<button>`, Enter opens, arrows navigate the list,
Escape closes — the switcher list rows become focusable in this slice, an a11y repair
that benefits every existing call site).

### 4.4 DOM ACs

- Inside `/p/A/build`, clicking `[data-testid="project-name"]` opens
  `[data-testid="project-switcher-list"]`; choosing project B navigates to `/p/B/build`
  (assert URL — mode verb retained; no artifact segment).
- The same pivot from `/p/A/document` lands on `/p/B/document`.
- `[data-testid="switcher-dashboard-row"]` navigates to `/p/A`.
- Zero network requests fire on dropdown open (projects store already warm — asserted).
- Keyboard: trigger reachable by Tab, opens on Enter, ArrowDown walks rows, Escape closes
  and restores focus to the trigger.

---

## 5 P1-5 — Cross-project global search

**Operator:** *"Cross-project global search over runs, prompts, decisions ledger entries,
repo names."*

### 5.1 Wire check — what is client-held vs. what would need a daemon index

| Corpus | Where it lives today | Wire verdict |
|---|---|---|
| Runs (intent/`problem` text, id, status, repo_ref) | App's one `useRuns()` — every non-archived run view is client-held (`GET /runs`, routes.ts:481) | **CLIENT-DERIVABLE** (already fetched) |
| Open gate prompts | `useGateStore.gates` — event-sourced `awaitingHuman` prompts (gates.ts:93) | **CLIENT-DERIVABLE** (store) |
| Prompt inbox (durable interaction requests) | `GET /projects/:id/prompts` (projects/routes.ts:427) — **per-project only**; a cross-project sweep would be an N-request fan-out | **EXISTS(per-project)** — used scoped, never fanned out (see honesty rule below) |
| Decisions (governance claims) | `GET /governance/claims` (routes.ts:1128) — daemon-wide conformance-store claims, already typed (`GovernanceClaim`) and consumed by PolicyManager | **EXISTS** — one GET on search-open |
| Per-run decisions ledger (gate evals, routing, denials) | derived client-side from a run's event trail (`DecisionsLedger.tsx` over `useRunModel`) — exists ONLY for runs whose events are loaded | **CLIENT-DERIVABLE(loaded runs only)** — labeled as such |
| Repo names | `GET /repos` (routes.ts:368) | **EXISTS** — the §1.4 palette cache is reused |
| Full-text over transcripts / all historical events | nothing — no search endpoint (`GET /api/v1/search` → 404, probed §0) | **NEEDS-CREW-ENDPOINT** (deferred, §5.4) |

### 5.2 The honest v1 (the operator's framing accepted)

Global search is the **palette's deep mode**, not a second surface: typing `?` as the
prefix (or opening with `Cmd+Shift+F`, registered in the §1.2 table) switches the palette
into search mode — wider result rows, snippet lines, a corpus label.

**The corpus label is a first-class UI element, always visible** (EC24, §12.1):

```
Searching: runs (all) · open gates · decisions (governance claims) · repos
Not searched: transcripts, historical events — [why?]
```

The `[why?]` popover states the wire truth in one sentence: "The crew daemon has no
search index yet; the studio searches what it holds." No result ranking pretends
otherwise; no "0 results" ever implies transcript absence.

**What each hit row shows and where it goes:**

| Hit kind | Row | Target |
|---|---|---|
| Run | status dot + `problem` (matched chars accented) + project name | `runPath(id)` |
| Gate | `⏸` + prompt snippet + run's project | run + `#gate` |
| Decision (claim) | rule/policy id + verdict + subject snippet | the run when the claim names one, else `/policies` |
| Repo | `⬡` + name | `/repos/:id` |

Matching reuses the §1.5 fuzzy scorer for names and adds a plain case-insensitive
substring pass for prose fields (prompts, claim subjects) — subsequence matching on prose
produces false-positive noise; substring on prose + fuzzy on identifiers is the honest
pairing.

**Request budget:** search mode fires at most two GETs on entry (`/governance/claims`,
plus `/repos` if the palette cache is cold), both cached for the session, refreshed on
next entry. Keystrokes fire nothing — filtering is in-memory.

**Scoped prompt search:** inside a project shell, search mode ALSO queries
`GET /projects/:id/prompts` for the current project (one request, labeled "prompts:
this project") — using the per-project wire the way it scales, never fanning out across
all projects.

### 5.3 Token usage

Search mode inherits §1.6's palette tokens. Snippets: `--text-xs --font-mono --ink-muted`
with matched substrings `--ink-high`. The corpus label: `--text-2xs --ink-dim`, with the
"not searched" clause in `--status-gate` — an honesty marker earns the attention color.

### 5.4 The deferred daemon index (NEEDS-CREW-ENDPOINT, explicitly out of v1)

When transcript/full-text search earns its keep, the proposed wire is:

```
GET /api/v1/search?q=<text>&kinds=runs,events,prompts&limit=50
→ { "hits": [ { "kind": "run|event|prompt", "runId": "…", "snippet": "…",
                "at": 1724200000000, "score": 0.83 } ], "truncated": false }
```

backed by SQLite FTS5 over the daemon's existing durable stores (the event log and
interaction_requests are already SQLite — the index is a migration, not a new store).
This is flagged as future cross-repo work and deliberately NOT a prerequisite of any
slice in §12: v1 must not promise indexed full-text the wire cannot answer.

### 5.5 DOM ACs

- Typing `?auth` in the palette renders `[data-testid="search-corpus-label"]` naming the
  four searched corpora and the not-searched clause; run hits whose `problem` contains
  "auth" appear with accent-marked matches.
- With the W2 fixture's gated run, searching a word from its gate prompt returns a gate
  hit that navigates to the run with `#gate`.
- Entering search mode fires at most `GET /governance/claims` (+ `GET /repos` cold-cache)
  — asserted via request interception; ten keystrokes fire zero further requests.
- Inside `/p/A/*`, the label adds "prompts: this project" and one
  `GET /projects/A/prompts` fires.
- No request to any `/search` route ever fires (grep + interception — the invented-wire
  guard, the slice-13 lesson from DES-FEEDBACK-001 §7.2).

---

## 6 P1-6 — GroupChat grid/columns toggle

**Operator:** *"GroupChat grid/columns toggle: side-by-side comparison when multiple
agents reply to the same prompt."*

### 6.1 Current state

The transcript is one linear column (`GroupChat.tsx:597–633`): user bubbles self-end,
seat bubbles self-start with a two-letter agent avatar. When three agents answer the same
prompt, comparison means scrolling — replies stack in arrival order.

The data model already groups naturally: `messages` is a flat `Msg[]` where a send
appends one `UserMsg` then N pending `SeatMsg`s (one per warm seat, GroupChat.tsx:481–484)
that fill in place as `chatOutputDelta`/completion events land (GroupChat.tsx:371). A
"round" = a user message plus every seat message before the next user message.

**Wire verdict:** **CLIENT-DERIVABLE** (local component state; zero wire impact).

### 6.2 Design

A two-state toggle in the chat header, right of the seat chips: `[≡ list] [⫼ columns]`
— visible only when the current chat has ≥2 distinct replying seats (a single-agent chat
has nothing to compare; the toggle would be dead chrome).

**Columns mode** re-renders each round as a grid:

```
                                    ┌────────────────────────┐
                                    │ user: refactor the API │   (user row: unchanged)
                                    └────────────────────────┘
┌─ CL claude ───────┬─ CX codex ────────┬─ AG antigravity ────┐
│ I'd extract the   │ Start by moving   │ The seam is the     │
│ fetch layer…      │ types out…        │ adapter here…       │
│                   │                   │                     │
└───────────────────┴───────────────────┴─────────────────────┘
```

- `grid-template-columns: repeat(N, minmax(260px, 1fr))` where N = distinct seats in the
  round, horizontal scroll inside the round container past 3 columns (the page never
  scrolls horizontally).
- Column order is stable across rounds (first-seen seat order), so the same agent is
  always in the same column — the property that makes scanning down a column meaningful.
- Column header: the seat chip (avatar + cliKey) in the existing chip dress; pending
  cells keep the `thinking…` pulse; a seat that did not answer this round renders an
  empty dimmed cell (`--ink-dim` "—") rather than collapsing the column — absence is
  information when comparing.
- List mode is untouched and remains the default; the choice persists per-session in
  component state (deliberately not a crew setting: it is a reading posture, not
  configuration — and adding a settings write for it would violate the surface's request
  frugality).

### 6.3 The constraint this must not break

Chat's zero-requests-on-mount (UXFIX §2.4, held by slice C's chip design) is untouched
by construction: the toggle reads and re-arranges `messages` state only. The composer,
send path, seat warming, and chip logic (GroupChat.tsx:380–520) are not modified — this
is a pure transcript-rendering slice.

### 6.4 Token usage

Toggle: segmented pair in the mode-switcher grammar — active segment `--surface-raised`
background + `--ink-high`, inactive `--ink-muted`; `--radius-md`. Column dividers:
`1px solid var(--surface-raised)`. Column headers reuse `SEAT_CHIP` tokens verbatim
(GroupChat.tsx:520–536). Cell bubbles keep their exact current tokens (`--surface-card`,
status-pair borders while pending/failed).

### 6.5 DOM ACs

- With a fixture chat of 3 seats × 2 rounds: `[data-testid="chat-layout-toggle"]` is
  present; clicking columns renders `[data-testid="chat-round"]` containers each with
  `[data-testid="chat-round-grid"]` of `data-columns="3"`; the same seat's cells share a
  column index across rounds.
- With 1 seat, the toggle is absent.
- Toggling fires zero network requests; the composer keeps focus and its draft text.
- A pending cell shows the pulse; a seat absent from a round renders
  `[data-testid="chat-cell-empty"]`.
- Enter in the composer still sends (typing-context guard: the §2 triage keys and the
  toggle never intercept composer keys).

---

## 7 P2-7 — Document version visual diff

**Operator:** *"Document version visual diff: Compare v(N) vs v(N-1) toggle in
VersionStrip — split-pane of two version iframes… and/or overlay."*

### 7.1 Current state

The VersionStrip (slice F/9, `VersionStrip.tsx`) renders the lineage as selectable
entries; selecting is a navigation (`?v=N`, `versionPath`, VersionStrip.tsx:18–21). One
canvas iframe shows one version (`DocumentCanvas` via `interactiveDocUrl(projectId,
docId, version)`, `interactive.ts:195`). There is no compare affordance
(`grep -n compare VersionStrip.tsx` → comments only).

**Wire verdict:** **CLIENT-DERIVABLE / EXISTS** — both panes are just two instances of
the already-real version URL (`interactiveDocUrl` builds `/d/:docId/doc/:version` on the
app's own origin, proxied through crew — verified in slice F). Zero new routes; compare
is a client-side layout of two URLs that each already render today.

### 7.2 Design — split as the primary, overlay as the refinement

A `[⇆ Compare]` toggle in the strip's toolbar (beside `[Themes] [Export]`). Entering
compare splits the canvas:

```
┌──────────────── canvas (still >80% viewport width, EC18) ────────────────┐
│ ┌─ v3 (selected) ────────────┐ │ ┌─ v2 (parent) ──────────────────────┐ │
│ │  [iframe: doc @ v3]        │ │ │  [iframe: doc @ v2]                │ │
│ └────────────────────────────┘ │ └────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│  ◂ v1  v2  ● v3 ▸   [⇆ Comparing v3 ↔ v2 ·  vs: parent ▾ · ✕]  [Themes] │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Default comparand: the selected version's PARENT** — the manifest's lineage
  (parent-pointer, write-once — VersionStrip.tsx:9–12) names it; "v(N) vs v(N−1)" in the
  operator's words is lineage-parent, not ordinal-minus-one, and for forked documents
  those differ. The `vs:` dropdown lets the operator pick any other version.
- **Selection stays a navigation:** the LEFT pane is `?v=N` exactly as today (deep-link
  and back-button semantics untouched); the comparand is ephemeral UI state (`cmp` local
  state, reset on exit) — comparing is a lens, not an address. Clicking a strip entry
  while comparing re-points the left pane; the right pane keeps its comparand.
- **Overlay refinement:** an `[▣ overlay]` sub-toggle inside compare stacks the two
  iframes with the top one at 50% opacity and an opacity slider (0–100) — the
  spot-the-layout-shift tool for visually near-identical versions. Same two URLs, one
  absolute-positioned container. Pointer events go to the top iframe only; the slider
  states which version is on top.
- **EC18 honesty (§7.3 canvas-first geometry):** compare mode's two panes TOGETHER are
  the canvas — the pair occupies the same >80% viewport width the single iframe did; the
  thread drawer stays closed-by-default and, if opened, overlays as the existing drawer
  (never a third column). Each pane is narrower than solo view by necessity; that is the
  operator's explicit trade in asking for split-pane, stated here so EC18's measurement
  is amended (§12.1: EC18 measures the canvas REGION, compare panes included) rather
  than silently gamed.
- Exiting compare (`✕` or Escape) returns to the solo canvas at the selected version.

### 7.3 What compare does NOT claim

No DOM-diffing, no changed-element highlighting inside the iframes: the studio treats
version HTML as opaque (the bridge owns the document internals — the slice-F boundary).
A structural visual diff would need bridge cooperation and is named future work, not
smuggled in as screenshot-XOR trickery.

### 7.4 Token usage

Pane headers: `--text-2xs --font-mono`; the selected version's header dot `--accent`
(the strip's addressed-version grammar), the comparand's `--ink-muted`. Divider:
`1px solid var(--surface-raised)`. Compare/overlay toggles: the §6.4 segmented dress.
Slider: thumb `--accent`, track `--surface-raised` (a native input styled by tokens).

### 7.5 DOM ACs

- With a fixture doc at v3 (parent v2): `[data-testid="version-compare-toggle"]` enters
  compare; two `[data-testid="compare-pane"]` iframes render with `src` ending `/doc/3`
  and `/doc/2` respectively; the pane pair's bounding box is >80% of viewport width
  (EC18-as-region).
- The `vs:` dropdown lists every OTHER version; choosing v1 re-points only the right
  pane's `src`.
- Overlay mode renders both iframes stacked with `[data-testid="overlay-slider"]`;
  moving the slider changes the top iframe's computed `opacity`.
- URL still carries `?v=3` throughout; back-button after entering compare exits to the
  prior route (compare state is not a history entry).
- On a v1-only document (no parent), the compare toggle is disabled with a stated reason
  (title: "only one version exists") — the §7.6 disabled-with-reason rule.

---

## 8 P2-8 — Desktop notifications + chime

**Operator:** *"Desktop Web Notifications + optional audio chime when awaitingHuman
arrives while the tab is unfocused. Opt-in, permission-gated, settings-persisted (crew
settings like appearance)."*

### 8.1 Current state

`awaitingHuman` is real and already flows: the app's one `/ws` subscription folds every
frame into `useNotificationStore.ingest` (App.tsx:93,113; notifications.ts:68 handles
`awaitingHuman`) and `useGateStore.ingest` (gates.ts:93) — verified in slice E, no
invented events. Nothing OS-facing exists: no `Notification` API call, no audio, no
visibility check anywhere in `src/` (grep-verified).

The persistence pattern to copy is the appearance store: `studio.appearance` rides crew's
settings store as a namespaced key over `GET/PUT /settings` (**EXISTS** — routes.ts:1642,
1644; the daemon merges partial PUTs), written debounced by `useAppearanceStore`
(`theming/appearance.ts:95–106`, `client.ts:458–472`).

### 8.2 Design

**Settings surface** (in the existing Appearance/system settings page, a "Notifications"
group):

```
Notifications
  ( ) Off — in-app toasts only            ← default
  (•) Desktop notification when a gate needs you and this tab is hidden
  [ ] Also play a chime
  Status: permission granted ✓            ← live permission state, named
```

- **Opt-in and permission-gated in the right order:** selecting the desktop option calls
  `Notification.requestPermission()` — the browser prompt fires only on this explicit
  click, never on app load (EC25, §12.1). `denied` renders the state honestly ("blocked
  in browser settings — the studio cannot re-ask") with the radio reverting to Off.
- **Persistence:** a `studio.notifications` key on the same settings wire —
  `PUT /settings {"studio.notifications": {"desktop": true, "chime": false}}` — the
  appearance pattern verbatim (namespaced studio-owned key, daemon merges, absent on old
  daemons → defaults). A new `useNotifPrefsStore` mirrors `useAppearanceStore`'s
  load-once + optimistic-update + debounced-persist shape. **EXISTS** (settings routes).
- **Trigger:** inside the existing `ingest` fold — when an `awaitingHuman` lands AND
  `document.visibilityState === 'hidden'` (the tab-unfocused test; `document.hasFocus()
  === false` is accepted as the OR-condition for visible-but-unfocused windows) AND the
  pref is on AND permission is `granted`: fire one
  `new Notification('Gate needs you', { body: <prompt first line> · <project name>,
  tag: runId })`. The `tag` collapses repeat frames for the same run into one OS
  notification (no notification spam from replays). Clicking it focuses the tab and
  navigates to the run + `#gate`.
- **Chime:** a ~0.4s two-tone generated by the Web Audio API (`OscillatorNode`, sine,
  880→1175 Hz, gain-enveloped) — zero asset bytes shipped, no `<audio>` element, no
  external fetch (CSP-clean). Played only when a desktop notification actually fires
  (same guards), never for visible-tab gates — the in-app chip/toast already owns that.
- **No invented events:** the trigger set is exactly `awaitingHuman` — not failures, not
  completions. Extending the set is future settings work, named in §13.

### 8.3 Token usage

Settings rows use the existing settings dress (labels `--text-sm --font-sans
--ink-body`; the permission state line `--text-xs --font-mono` in `--status-run` when
granted, `--status-fail` when denied). No new visual surface otherwise — the feature's
output is the OS's, not ours.

### 8.4 DOM ACs

- On app load with no stored pref: zero `Notification.requestPermission` calls (asserted
  by stubbing the API before load — EC25).
- Selecting the desktop option calls `requestPermission` exactly once; with the
  permission stub returning `granted`, `PUT /settings` fires with the
  `studio.notifications` key (request interception).
- With prefs on + permission granted + `document.visibilityState` stubbed `hidden`: an
  injected `awaitingHuman` frame constructs one `Notification` with `tag` = the run id;
  a second frame for the same run constructs one with the same tag (no unbounded stack).
- With the tab visible, the same frame constructs zero Notifications.
- With chime on, the notification path creates an `AudioContext` (stub-asserted); with
  chime off, none.
- A daemon settings blob without the key yields defaults (Off) — no crash, no prompt.

---

## 9 P2-9 — Batch gate resolution

**Operator:** *"Batch gate resolution: approve/reject N routine gates at once — design as
client-side fan-out of the EXISTING per-run gate POST unless a batch endpoint exists."*

### 9.1 Wire check

No batch gate endpoint exists. The daemon's gate write is strictly per-run
(`POST /runs/:id/gate`, routes.ts:780 — 404 unknown, 409 not-awaiting, audited per
decision at routes.ts:797–806). The daemon DOES have a batch-shape precedent —
`POST /runs/archive` (routes.ts:528–547): explicit ids only (max 200), per-id outcomes
(`{results: [{id, ok, error?}], archived: n}`), never all-or-nothing.

**Verdict: client-side fan-out of the EXISTING per-run POST** (the operator's default,
confirmed necessary). A batch endpoint is proposed for the future in §9.4 but is NOT a
prerequisite: routine-gate batches are small (the fixture's worst case is single digits),
and N sequential POSTs preserve the per-decision audit trail (task #88) that a batch
route would have to re-plumb.

### 9.2 Design

Batch mode lives where triage lives — an extension of §2's cursor, plus checkboxes:

- **`x` (or Space) toggles selection** on the cursor's card/row; a checkbox renders on
  gate-bearing cards once ≥1 is selected (mouse users click the checkboxes directly).
  Only SIMPLE gates (`isSimpleGate`) are selectable — a complex gate cannot be batch-
  answered for the same reason its chip has no inline buttons; its checkbox slot renders
  a `↗` "needs the thread" marker instead.
- A **batch bar** docks above the board/inbox when ≥1 selected:
  ```
  3 gates selected   [Approve all]  [Reject all…]  [clear]
  ```
- **Approve all:** sequential fan-out of `POST /runs/:id/gate {approve:true}` —
  sequential, not parallel: each response (or 409) updates its card live, and the
  single-writer daemon gains nothing from a request burst. In-flight: the bar shows
  `2/3…`; each card shows its own state (the §3.3 adjacency rule).
- **Reject all…:** opens the §2.3 inline note ONCE at the bar level; the note (as
  `amend`) rides every reject in the fan-out. The ellipsis is the destructive-action
  pause: reject cancels runs (routes.ts:779 comment), so it is never a single silent key.
- **Per-id outcomes, the archive-precedent shape client-side:** failures stay listed in
  the bar — `1 failed: q3-deck (409 run resumed) [retry] [open]` — successes leave as
  their `resumed`/`runCancelled` frames land on the shared socket and take them off
  `awaiting_human` (the store reconciles; no optimistic lying).
- Escape clears selection; selection also clears on route change.

### 9.3 Token usage

Checkboxes: `--radius-sm` boxes, checked fill `--accent` with `--accent-fg` check.
Batch bar: `--surface-raised`, `--shadow-raised`, `--radius-lg`; the approve button in
the `--status-run` pair, reject in the `--status-fail` pair (status semantics, not
accent — these are run-state actions). Failure lines: `--text-xs --font-mono
--status-fail` with the retry/open controls adjacent.

### 9.4 The optional future batch route (NEEDS-CREW-ENDPOINT, deferred, not a prerequisite)

Modeled letter-for-letter on the bulk-archive precedent:

```
POST /api/v1/runs/gates
{ "ids": ["run-a", "run-b"], "approve": true, "amend": "optional note" }
→ { "results": [ { "id": "run-a", "ok": true },
                 { "id": "run-b", "ok": false, "error": "not awaiting a human gate" } ],
    "decided": 1 }
```

Explicit ids only (max 200), per-id outcomes, per-id audit records (the loop calls the
same `confirmGate` + `audit.record` pair the single route uses). Worth building only if
fan-out latency is ever felt; the studio's fan-out code is shaped so swapping it in is a
one-function change.

### 9.5 DOM ACs

- With 3 simple gates in the fixture: cursor + `x` on two of them renders
  `[data-testid="batch-bar"]` with `data-count="2"`; Approve all fires exactly two
  sequential `POST /runs/:id/gate` bodies `{"approve":true}` (order asserted).
- A complex-gate card renders `[data-testid="batch-ineligible"]`, never a checkbox; it
  cannot enter the selection via `x`.
- Reject-all with note "wrong branch" fires `{"approve":false,"amend":"wrong branch"}`
  per selected run.
- A stubbed 409 on one id leaves `[data-testid="batch-failure-row"]` naming the run and
  error, with retry firing only that id again.
- Escape clears selection and removes the bar; no request fires on clear.

---

## 10 The review's gap notes (slotted where they fit)

### 10.1 LiveFeed lines deep-link to the run

**Review note:** *"LiveFeed events deep-link to the executing phase/run view."*

**Current state:** feed blocks link at two points only — the project name →
`modePath(project.id, 'build')` (LiveFeed.tsx:112, mode home, not the run) and the
failure line's `[open run]` (LiveFeed.tsx:124–130). The narration lines themselves
(`feed-line`, LiveFeed.tsx:73–86) carry `data-run-id` but are inert `<p>` elements — the
operator sees a run narrating and cannot click the words.

**Design:** every `feed-line` becomes the same real-link the failure line already is —
wrapping the line in an anchor to `modePath(project.id, 'build', runId)` (Chat threads:
the run-kind rule if the feed ever narrates one; today MOVING runs are build runs).
Hover: the line's `--ink-body` lifts to `--ink-high` and an `↗` glyph fades in at
`--dur-instant` at line-end — the affordance whisper, no underline (mono narration must
not read as prose links at rest). The block header keeps its project-level link — two
altitudes, both real. **CLIENT-DERIVABLE** (the run id is already on the element).

**DOM AC:** each `[data-testid="feed-line"]` is (or is wrapped by) an `<a href>` whose
path ends with its `data-run-id`; middle-click-able (real href); clicking navigates to
the run view. Slots into slice J.

### 10.2 Project dashboard surfaces bound repos

**Review note:** *"project dashboard surfaces bound repos (members already fetched —
slice B/D precedent)."*

**Current state:** the dashboard's one membership read (`api.listProjectMembers`,
ProjectDashboard.tsx:123–140) already returns EVERY member — but `RUN_KINDS` filters to
`crew.run`/`crew.chat` (ProjectDashboard.tsx:33) and drops `crew.repo` members on the
floor. The wire grammar names `crew.repo` explicitly (crew-api-types index.d.ts:1179–1183).

**Design:** a repos row in the dashboard header's meta line region — not a fifth tile
(the 2×2 grid is a load-bearing §4.1 shape):

```
api-migration                          [💬 Chat] [⚙ Build] [▤ Doc] [▶ Video]
last activity 4m ago · 3 open runs
⬡ studio-api   ⬡ studio-web                     ← bound repos, each → /repos/:id
```

Each chip: `⬡` + repo name (resolved by ref from the same `listRepos` cache §1.4 holds;
an unresolvable ref renders the raw ref in `--ink-dim` — membership is the truth even
when the repo listing lags), linking to `/repos/:id`. Zero repos = the row is absent
(empty-state budget). **CLIENT-DERIVABLE** (same fetch, one dropped filter + palette's
repo cache). **DOM AC:** with a fixture project holding one `crew.repo` member,
`[data-testid="dashboard-repos"]` renders one chip linking to that repo's page; with
none, the testid is absent. Slots into slice J.

---

## 11 Constraint inventory — what every slice must hold (with its guardian section)

| # | Constraint | Guarded by | How this document honors it |
|---|---|---|---|
| C1 | Chat: zero requests on mount | DES-UXFIX-001 §2.4 | §6.3 (toggle is render-only); §1.4 (palette fetches on OPEN, a gesture); ProjectSwitcher `onOpen` contract untouched |
| C2 | Tokens only — no raw color (ERROR lint + PostCSS twin); linguist palette sole exemption | DES-VISION-001 §2.11 | every "token usage" subsection; §3.5's diff colors are status tokens by design, no new exemption |
| C3 | Attention model untouched | DES-VISION-001 §1.4 / UXFIX | §2.2 (cursor WALKS the existing order, never re-sorts); §1.5 reuses `scoreOf`, no second model |
| C4 | Canvas-first (EC18) | DES-FEEDBACK-001 §7.3 | §7.2 (compare panes measured as the canvas region; drawer stays a drawer); §3.4 (viewer is an overlay, not a column) |
| C5 | Charts/affordances answer named questions (EC19) | DES-FEEDBACK-001 §2.1 | no new chart is introduced; §3.5 rejects decoration-grade highlighting on the same test |
| C6 | Wall + feed structure | DES-VISION-001 §5.1 | §10.1 changes the link-ness of feed lines, not feed structure — no header, no scrollbar, the 3-line block budget (§1.3) intact |
| C7 | Keyboard a11y — visible focus, no key theft from inputs | DES-VISION-001 focus-ring rule | §1.2's single `isTypingContext` guard before EVERY handler; §2.2 real-DOM-focus cursor; §4.3 switcher keyboard repair; EC21/EC22 |
| C8 | No invented wire | house rule §0 | every data need carries a verdict; §5.2's corpus label makes the wire's limits VISIBLE to the operator, not just to reviewers |


---

## 12 Slice plan

### 12.0 Inherited rules (DES-VISION-001 §6.0, DES-FEEDBACK-001 §8.0 — unchanged)

- Each PR ≤350 LOC production diff (tests excluded from count, never from the PR)
- Each PR independently mergeable and revertable
- Merge protocol: branch → open → wait 6–8 min for bots + CI → address → merge
- Every studio slice gated by named screenshots at 1440×900 via the Playwright harness
- Every slice preserves all VISION/UXFIX/FEEDBACK-001 behaviors it touches
- Token discipline (EC15): the no-raw-color ERROR lint + PostCSS twin stay green

### 12.1 New experience-checklist items (extends EC17–EC20)

- **EC21 — No key theft, one guard.** No unmodified or chorded shortcut acts while an
  `input`, `textarea`, `select`, or contentEditable has focus; every global handler runs
  behind the ONE shared `isTypingContext` predicate (grep: exactly one
  `addEventListener('keydown'` at the registry). (§1.2, §2.4)
- **EC22 — The cursor is focus.** Keyboard selection (palette rows, triage cursor,
  switcher rows) moves real DOM focus with a visible `--accent` ring; every screenshot of
  a keyboard state shows the ring. (§2.2, §4.3)
- **EC23 — The viewer never silently amputates.** Any truncated/binary/unavailable
  content state renders a labeled banner naming the limit and the fallback affordance.
  (§3.4, §5.2)
- **EC24 — Search names its corpus.** Any search surface displays what IS and IS NOT
  searched; wire limits are operator-visible, not reviewer-only. (§5.2)
- **EC25 — Permission prompts follow gestures.** No browser permission request
  (notifications, and any future ones) ever fires on load — only from an explicit
  settings action, and the denied state renders honestly. (§8.2)
- **EC18 (amended)** — the >80%-viewport-width canvas measurement counts the canvas
  REGION: in compare mode the two panes together are the canvas. (§7.2)

### 12.2 Fixture additions (extends the W2 messy-reality fixture)

- Three simple-gated runs across two projects + one complex gate (triage + batch: j/k
  walk, `a`/`r`/`x`, the ineligible marker).
- A run with a workdir containing one modified tracked file, one untracked file, one
  >512 KB file, and one binary file (viewer truthfulness states; CREW-1's route tests).
- A chat fixture with 3 seats × 2 rounds, one seat silent in round 2 (columns mode).
- A document at v3 with parent v2 and a fork (compare default-comparand correctness).
- A project holding one `crew.repo` member (dashboard repos row).

### 12.3 Slices

---

**Slice G — Shortcut registry + command palette** *(~340 LOC)* — §1 (P0-1)

New `src/hooks/useGlobalShortcuts.ts` (~70): single keydown listener, ordered table,
exported `isTypingContext`; delete `useKillShortcut` (App.tsx:62–86), re-register kill on
Ctrl+Shift+K. New `src/palette/fuzzy.ts` (~40) + `src/components/CommandPalette.tsx`
(~200): overlay, prefix grammar, grouped rows, verb table, repos cache-on-open. App.tsx
mounts the palette + registry (~30).

*DOM ACs:* §1.7 in full.
*Screenshots:* `feedback2-G-palette-mixed.png` (open palette, mixed groups, W2 fixture,
selection ring visible), `feedback2-G-palette-verbs.png` (`>` prefix, verb list with
Cancel-run present for a selected non-terminal run).
*Checklist:* EC15, EC21, EC22.
*Preserved:* kill-run behavior (relocated chord, identical guards + silent-fail contract);
Chat zero-requests-on-mount (C1); all existing modal-local Escape/Enter handlers; the
board's attention ordering (reused, not re-derived).

---

**Slice H — Keyboard gate triage** *(~280 LOC)* — §2 (P0-2)

`useTriageCursor` hook (~90) mounted by HomeBoard + ProjectDashboard; card/row focus +
ring + `data-kbd-selected`; `a`/`r`/Enter actions calling the EXISTING GateChip request
paths (extracted into `src/board/gateActions.ts` so chip and key share one
implementation, ~60); inline reject-note input (~70); hint row (~20).

*DOM ACs:* §2.6 in full.
*Screenshots:* `feedback2-H-triage-cursor.png` (needs-you band, second card ring-selected,
hint row visible), `feedback2-H-reject-note.png` (inline note open and focused on the
selected card).
*Checklist:* EC21, EC22, EC15.
*Preserved:* attention model and band order (C3); GateChip mouse path byte-identical in
behavior; complex-gate boundary (`isSimpleGate` unmoved); §3.3 error-adjacency.

---

**Slice CREW-1 — run file + diff routes** *(~300 LOC, in `wicked-crew` — cross-repo
prerequisite, its own PR against the crew repo)* — §3.3 (P0-3's wire)

Extract `allowedRootsFor(view, repos)` from the `POST /open` handler (routes.ts:334–350);
add `GET /runs/:id/files` (~90: containment, size cap, binary sniff) and
`GET /runs/:id/diff` (~110: execCapped git diff + untracked-file hunks, output cap);
route tests for the §3.7 crew-side ACs (~100, excluded from the LOC count per rules).
Publishes the two response shapes into `wicked-crew-api-types`.

*ACs:* §3.7's crew-side list. No screenshots (daemon work).
*Preserved:* `POST /open` behavior identical (shared helper, no semantic change);
`isInsideRoot` untouched; per-route audit posture (GET-only, no audit events needed).

---

**Slice I — In-studio file & diff viewer** *(~330 LOC — depends on CREW-1)* — §3 (P0-3)

`src/components/FileViewer.tsx` (~200: overlay, tabs, line numbers, truncation/binary
banners, 404-fallback to openPath); diff line classifier + comment dimmer
`src/viewer/colorize.ts` (~60, pure functions); FilesPanel row rewiring (~50: row click →
viewer, hover icons for open-external/copy, header [Full diff] button); two client
methods in `api/client.ts` (~20).

*DOM ACs:* §3.7's studio-side list.
*Screenshots:* `feedback2-I-diff-view.png` (viewer open on the fixture's modified file,
Diff tab, colored hunks), `feedback2-I-file-truncated.png` (File tab on the >512 KB
fixture file with the truncation banner).
*Checklist:* EC15, EC23; the no-grammar-library grep is this slice's §2.3-precedent gate.
*Preserved:* openPath external launch + copy-path (now hover affordances, same calls);
FilesPanel's modified/deleted/referenced classification untouched; RightPanel accordion
behavior.

---

**Slice J — Project pivot + global search + gap notes** *(~330 LOC)* — §4 (P1-4),
§5 (P1-5), §10.1, §10.2

ProjectSwitcher `variant="crumb"` + keyboard-focusable rows (~60); ProjectShell header
trigger + dashboard row (~40); palette search mode: `?` prefix + `Cmd+Shift+F`, corpus
label + why-popover, claims/prompts fetch-on-entry, prose substring pass (~150); LiveFeed
line anchors (~30); ProjectDashboard repos row (~50).

*DOM ACs:* §4.4, §5.5, §10.1, §10.2 in full.
*Screenshots:* `feedback2-J-crumb-pivot.png` (context header dropdown open inside Build,
current project checked), `feedback2-J-search-corpus.png` (search mode with corpus label
and a gate hit), `feedback2-J-dashboard-repos.png` (dashboard with the bound-repo chip
row).
*Checklist:* EC22, EC24, EC15.
*Preserved:* mode-verb retention semantics of `modePath`; dashboard 2×2 tile grid (§4.1
shape); feed block budget (C6); ProjectSwitcher's existing call sites (new props optional).

---

**Slice K — Chat columns + version compare** *(~300 LOC)* — §6 (P1-6), §7 (P2-7)

GroupChat: round-grouping selector + grid renderer + toggle (~140, transcript-render
only); DocumentCanvas/VersionStrip: compare state, split panes, `vs:` dropdown, overlay
sub-mode + opacity slider, disabled-with-reason on v1-only docs (~160).

*DOM ACs:* §6.5, §7.5 in full.
*Screenshots:* `feedback2-K-chat-columns.png` (3-seat round side-by-side, one empty cell),
`feedback2-K-compare-split.png` (v3 ↔ v2 split with strip toolbar), `feedback2-K-compare-
overlay.png` (overlay mode, slider at 50%).
*Checklist:* EC18 (amended per §12.1), EC15; C1 (zero requests from the toggle — asserted).
*Preserved:* send path, seat warming, chips logic (§6.3); version selection as navigation
(`?v=N`); canvas-first drawer behavior; strip's fork/anchor/Themes/Export affordances.

---

**Slice L — Desktop notifications + batch gates** *(~300 LOC)* — §8 (P2-8), §9 (P2-9)

`useNotifPrefsStore` (appearance-store shape, `studio.notifications` key, ~60); settings
group UI + permission flow (~70); notification+chime trigger in the ingest fold +
WebAudio chime (~60); batch selection on the §H cursor (`x`, checkboxes, ineligible
marker, ~50); batch bar + sequential fan-out + per-id failure rows (~60).

*DOM ACs:* §8.4, §9.5 in full.
*Screenshots:* `feedback2-L-notif-settings.png` (settings group, permission state line),
`feedback2-L-batch-bar.png` (two gates selected, batch bar docked, one ineligible marker
visible).
*Checklist:* EC21, EC25, EC15.
*Preserved:* in-app GateNotifications toasts (untouched — the desktop layer is additive
and hidden-tab-only); per-decision audit trail (fan-out uses the single audited route);
notification store's 10-entry cap and kinds.

### 12.4 Sequencing

```
G  (registry + palette)          ← first: H, J build on the registry/palette
├─ H  (triage)                   ← needs G's registry + guard
│  └─ L  (batch rides H's cursor; notifications independent half can't split — L after H)
├─ J  (pivot + search rides G's palette)
CREW-1 (wicked-crew PR)          ← parallel with G/H/J from day one
  └─ I  (viewer)                 ← the ONLY studio slice gated on crew; degrades per §3.7
                                    if a daemon predates the routes
K  (chat columns + compare)      ← independent of everything; parallel any time

Hard chain: G → H → L;  G → J;  CREW-1 → I.  K floats.
```

**Done means:** all seven slices merged (six studio + CREW-1 in wicked-crew); every named
screenshot captured at 1440×900 and passing its checklist items; the W1–W6 walkthroughs
re-run green; plus **W7 — the FDE hour:** from a cold tab: Cmd+K → type a run fragment →
Enter lands on the run; j/k/a clears one gate and r-with-note rejects another without
touching the mouse; a modified file's diff is read INSIDE the studio; the operator pivots
project without leaving Build; a hidden-tab gate raises a desktop notification whose
click lands on `#gate`; three routine gates clear in one batch action.

---

## 13 Out of scope (named)

- **Indexed full-text search** (`GET /search`, §5.4) — specced, deferred; v1's corpus
  label exists precisely so this absence is honest.
- **Batch gate daemon route** (`POST /runs/gates`, §9.4) — specced, deferred; fan-out is
  the operator-approved default and the audit-preserving one.
- **True syntax highlighting** in the viewer (§3.5) — the named upgrade path (lazy
  per-language tokenizer) awaits a round that demands it; diff-coloring answers this
  round's question.
- **DOM-level document diffing** inside compare panes (§7.3) — needs bridge cooperation;
  the studio does not reach into version HTML.
- **Notification kinds beyond `awaitingHuman`** (failures, completions) and per-project
  notification muting — settings-arc work; the wire (`studio.notifications`) is shaped to
  grow (`kinds: []` future field) without migration.
- **Palette extensibility** (workflow verbs, governance verbs, per-repo verbs) — the verb
  table is data, adding rows is cheap, but each verb must name its mechanism per §1.3's
  rule; none are pre-approved in bulk.
- **Customizable keybindings** — one binding story (§1.2) ships; a rebinding UI is a
  settings arc of its own and must not precede a proven default.
- **Mobile/narrow-viewport treatments** of the palette, viewer, and compare — the
  1440×900 operator viewport governs this round (and the standing rule applies: a phone
  gets a purpose-built view, not a shrunk desktop).

---

## 14 Traceability

| Operator item | Sections | Slices | Wire verdict summary |
|---|---|---|---|
| P0-1 palette | §1 | G | CLIENT-DERIVABLE (stores) + EXISTS `GET /repos` |
| P0-2 triage | §2 | H | EXISTS `POST /runs/:id/gate` (amend audited on reject) |
| P0-3 viewer | §3 | CREW-1 → I | NEEDS-CREW-ENDPOINT `GET /runs/:id/files`, `GET /runs/:id/diff` (specced §3.3, modeled on /open containment + execCapped) |
| P1-4 pivot | §4 | J | CLIENT-DERIVABLE (projects store) |
| P1-5 search | §5 | J | CLIENT-DERIVABLE (runs/gates) + EXISTS `GET /governance/claims`, `GET /repos`, scoped `GET /projects/:id/prompts`; full-text = deferred NEEDS-CREW-ENDPOINT |
| P1-6 chat columns | §6 | K | CLIENT-DERIVABLE (transcript state) |
| P2-7 version diff | §7 | K | EXISTS (two `interactiveDocUrl` panes) |
| P2-8 notifications | §8 | L | CLIENT-DERIVABLE (`awaitingHuman` already ingested) + EXISTS `PUT /settings` (`studio.notifications`) |
| P2-9 batch gates | §9 | L | EXISTS per-run gate POST, client fan-out (bulk-archive precedent); batch route deferred |
| gap: feed deep-links | §10.1 | J | CLIENT-DERIVABLE (run id on element) |
| gap: dashboard repos | §10.2 | J | CLIENT-DERIVABLE (members already fetched; drop one filter) |
