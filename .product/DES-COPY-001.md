# DES-COPY-001 — copy triage: engineering vocabulary and debug artifacts rendered as product copy

**Status:** DRAFT — design phase deliverable. No implementation.
**Date:** 2026-08-20
**Scope:** Copy and content only. No layout, no structural change, no new mechanism.
**Repo in scope:** `wicked-studio` (this repo).
**Runs beside:** `.product/DES-UXFIX-001.md` — the experience redesign. That document's §0
explicitly defers pure-wording fixes to "a copy-triage pass running in parallel". **This is
that pass.** Its §1 vocabulary table (V1–V24) is the authority for *which* word; this
document is the authority for *which string, in which file, replaced by what*.

---

## 0 What this document is, and the line it will not cross

An operator UX audit of the live product found six places where internal engineering
vocabulary or debug artifacts reach the user as product copy. Every item below names what
the audit SAW, then the file and line that produces it, then the decision.

**The line:** this pass changes *strings and conditional rendering of strings*. It does not
move a box, delete a panel, restyle a surface's information architecture, or add a data
source. Where the honest fix requires structure, this document says so, applies the
strings-only fix that is safe today, and hands the structural half to DES-UXFIX-001 with a
section reference. Two of the six items (C1, C5) split that way; the split is stated in
each, not implied.

**Three findings changed the brief.** They are stated up front because they alter what can
be delivered, not merely how:

| ID | Finding | Consequence |
|---|---|---|
| **B1** | The spec note renders in **two** components, not one — `CenterDashboard.tsx:1076` (inline) and `CampaignDagStub.tsx:17` (used by `InsightRail.tsx:75`). Both carry `data-testid="campaign-dag-stub"`. | C1 must fix both, or the audit string survives on the run surface's insight rail. |
| **B2** | **No run carries a timestamp.** `AgentSession` (wire contract `wicked-crew-api-types@0.5.x`, lines 141–164) has `archived_at` and nothing else temporal; `CoreEvent` (line 313+) has no `ts` either. | C3's "relative time" is **not derivable from fields already on the run**. Rendering "2h ago" would be invented data. See C3 for the three options and the recommendation. |
| **B3** | **"End chat" is destructive.** `endChat()` clears the stored chat id (`GroupChat.tsx:302`) then `DELETE /chats/:id` (`client.ts:183`), which closes the pooled CLI sessions that hold the conversation memory. The transcript is client-side only — `tests/GroupChat.rejoin.test.tsx:232` pins "the next mount starts clean". | C6's premise ("chat can be revisited") is false. The brief's own escape clause applies: *"if it does destroy, its label must say what."* |

### 0.1 External transformations

None. This pass touches display strings and one conditional render. No third-party library
or service transforms a payload anywhere in it — no normalization, enrichment, or format
conversion is introduced or relied upon. No `ASSUMPTION[external-transform]` lines are
emitted, and their absence is the claim, not an omission.

---

## 1 The six items

### C1 — Build page Campaigns box renders an internal spec note

**Audit saw:** *"Campaign DAG — Pending core's Campaign primitive + RunFinished events (§4.3)"*

**Source — two of them (B1):**

| File | Lines | What renders |
|---|---|---|
| `src/components/CenterDashboard.tsx` | 1055–1090 | Campaigns panel; heading `Campaign DAG`, body `Pending core's Campaign primitive + RunFinished events (§4.3).` |
| `src/components/CampaignDagStub.tsx` | 10–25 | `Campaign DAG — engine-real, not wired` + body naming `Campaign` / `RunFinished` / `Campaign*` events and `§4.3`; mounted by `InsightRail.tsx:75` |

**Root cause.** Both were written as engineer-to-engineer notes explaining *why* the feature
is absent, in the place a user looks to find out *what* it is. `engine-real, not wired`,
`Campaign primitive`, `RunFinished events` and `§4.3` are all internal referents. A section
symbol in product copy is the tell: it cites a document the user cannot open.

**Decision — copy replacement now, deletion later.**

The brief offers "or remove the box until the feature exists", and DES-UXFIX-001 §1 V4 +
§2.7 rule 3 already decide that the Campaigns panel **leaves the Build surface entirely**.
Removing a panel is a structural change, which this pass may not make. So:

- **This pass (strings only):** replace the copy in both components with the honest pending
  state. Nothing else about either box moves.
- **DES-UXFIX-001 §2.7:** deletes the Build panel outright. `CampaignDagStub` on the insight
  rail is *not* covered by that section — it survives the redesign, which is the second
  reason to fix its copy here rather than wait.

**Target copy (both sites, identical):**

| Element | String |
|---|---|
| Heading | `Campaigns` |
| Body | `Campaigns are coming — group related runs into one effort.` |

`CenterDashboard`'s panel already has a `Campaigns` section label above the box, so its
inner heading (`Campaign DAG`) is dropped rather than reworded — the box becomes one line of
body copy inside the existing dashed frame. `CampaignDagStub` has no outer label, so it
keeps a heading and takes both strings. No `§`, no `RunFinished`, no `primitive`, no
`engine-real`, no `<code>` spans (they typeset internal identifiers as if the user should
recognise them).

**Rejected:** "Campaigns (coming soon)" — "coming soon" is a promise with no content;
the replacement says what the feature *does*, which is the only thing that makes an absence
worth announcing.

---

### C2 — Chat composer placeholder is insider jargon, and "seat" leaks in five more places

**Audit saw:** *"Message every warm seat…"* — `src/components/GroupChat.tsx:406`.

**Root cause.** "Seat" is licensing/roster vocabulary (DES-UXFIX-001 V6 classifies it
exactly so). "Warm" is a process state of the CLI session pool. Together they describe the
implementation of the thing the user is about to talk to, rather than the thing itself.

**The sweep.** The brief asks for a `src/` sweep of user-visible "seat"/"warm". Six sites
render to a user; everything else is an identifier, a wire field, a comment, or a test — all
out of scope by the brief's own rule (*"never identifiers/tests/internal APIs"*).

| # | File:line | Rendered today | Target | Kind |
|---|---|---|---|---|
| S1 | `GroupChat.tsx:406` | `Message every warm seat… (Enter to send, Shift+Enter for newline)` | `Message the agents… (Enter to send, Shift+Enter for newline)` | placeholder |
| S2 | `GroupChat.tsx:359` | `Warming seats…` | `Connecting agents…` | empty/loading state |
| S3 | `GroupChat.tsx:160–162` | `…reload to retry, or End chat to release its seats.` | `…reload to retry, or end the chat to release its agents.` | error copy |
| S4 | `GroupChat.tsx:319` | chip tooltip `warming` \| `ready` \| `failed` (raw `SeatState`) | `connecting` \| `ready` \| `unavailable` | `title` attr |
| S5 | `councilQuorum.ts:22` | `3 of 3 seats` / `1 of 3 seats` | `3 of 3 agents` / `1 of 3 agents` | label fn, rendered in `ChatPanel.tsx:894`, `AssumptionsPanel.tsx:18` |
| S6 | `SystemSettings.tsx:262` | `CLI seats & sign-in` | `Agents & sign-in` | section heading |

**Notes that decide the edge cases:**

- **S1 keeps the Enter/Shift+Enter hint.** The brief's target string abbreviates it; the hint
  is real, learnable, and already correct — dropping it would be a regression disguised as a
  copy fix. The jargon is what changes.
- **S4 is a real leak** the brief's spirit covers even though the word "seat" does not appear
  in the rendered text: `title={st}` renders the raw union member, so the user reads a state
  machine's token. `warming` → `connecting` also removes the "warm" vocabulary from the one
  place it is user-visible without the word "seat" beside it.
- **S5 is the judgement call.** `quorumLabel` is pure copy (it returns a display string), so
  it is in scope, and "seats" there means exactly "agents that were asked". But
  `tests/councilQuorum.test.ts:16,27` pin the literal strings `'3 of 3 seats'` /
  `'1 of 3 seats'`. Those assertions must move with the copy — that is a test *following* a
  deliberate copy change, not the pass editing tests to hide a regression. The `seated` /
  `returned` wire fields and the function name are untouched.
- **S6:** `tests/SystemSettings.seats.test.tsx` names "CLI seats" only in its `describe`
  string and comments, and queries by role/name — no assertion breaks. The test file name and
  describe text are internal; they stay.
- **Out of scope, explicitly:** `SeatState`, `SeatMsg`, `kind: 'seat'`, `seatChip`,
  `setSignInSeat`, `failedSeats`, `councilSeatFailed`, `api.getChat().seats`,
  `chat_seats` — identifiers and wire fields. Renaming them is a refactor with no user-visible
  effect and a large diff; it is not this pass.

---

### C3 — Run and session rows label themselves with raw prompt text plus a hex id

**Audit saw:** *"Reply with exactly the single wo… 7524c2"* — `CenterDashboard.tsx:546`
(`ProgressRow`), where the primary line is `sessionLabel(view)` (a 32-char prompt truncation,
line 93–99) and the trailing meta is `{id.slice(0, 6)} · Open chat →`.

**Every site with the same defect:**

| # | File:line | Renders |
|---|---|---|
| R1 | `CenterDashboard.tsx:546` | `ProgressRow` — prompt excerpt + `id.slice(0,6)` |
| R2 | `CenterDashboard.tsx:959` | gate inbox row — `sessionLabel(v)` or bare `gate.runId.slice(0,8)` |
| R3 | `CenterDashboard.tsx:821` | activity feed entry label |
| R4 | `CenterDashboard.tsx:440` | feed card corner — bare `sessionId.slice(0,6)` |
| R5 | `CenterDashboard.tsx:656` | steer-target `<option>` — `truncate(problem, 30) (id.slice(0,6))` |
| R6 | `RunLink.tsx:24,54` | rail run row — prompt excerpt + `N tasks · id.slice(0,8)` |
| R7 | `ChatsPage.tsx:139–142` | chat row — prompt + `id.slice(0,8) · status` |

**B2 — the blocker, stated plainly.** The brief asks for *"workflow name + repo/project +
relative time … use fields already on the run."* Two of those three exist. The third does not:

- ✅ **workflow name** — `session.workflow_id` (`AgentSession.workflow_id`, contract line 143).
  `WorkflowDef` has no display-name field (contract lines 994–999), so the id *is* the name;
  it is already human-readable in practice (`feature`, `bug`, `migration` — see
  `ChatInput.tsx:44–54`).
- ⚠️ **repo/project** — `session.repo_ref` (contract line 153) is a repo **id**, not a name.
  `useBoardModel.ts:119` builds the `id → name` map from `api.listRepos()`; `CenterDashboard`
  and `RunLink` hold no such map. Rendering `repo_ref` raw would swap one opaque token for
  another — the exact defect being fixed.
- ❌ **relative time** — **does not exist.** `AgentSession` carries no `created_at` /
  `launched_at` / `updated_at`; `CoreEvent` carries no `ts`. The only server-side launch time
  in the whole contract is `AuditEntry.ts` paired with `action: 'run.launched'` (lines 71–84),
  reachable via `GET /audit` — an endpoint `src/api/client.ts` does not expose at all.

**Decision.**

*Label:*

```
primary   :  <workflow_id> · <repo name>          ← identity, from run fields
secondary :  <prompt excerpt, truncated>          ← demoted, was primary
title attr:  <full prompt text>                   ← tooltip, complete
hex id    :  removed from rendered text; stays as data-run-id / existing test hooks
```

- **Both segments are conditional.** No `repo_ref` → the primary line is the workflow alone.
  No resolvable repo name → the workflow alone (never the raw ref). No `workflow_id` and no
  repo → the primary line falls back to the prompt excerpt, which is what renders today. The
  label never renders a separator with nothing beside it, and never renders a hex token.
- **The hex id leaves the visible string** at R1, R4, R5, R6, R7. It remains available as
  `data-run-id` (already present on `RunLink`) and in the `title` where a row has one. R2's
  `gate.runId.slice(0,8)` fallback is reached only when the run is not in the list — it keeps
  a short id because "some id" beats "no label", but it is prefixed (`run …`) so it reads as
  an identifier rather than as a name.

*Time — recommendation: **omit it, and say why in this document rather than in the UI.***

| Option | Cost | Verdict |
|---|---|---|
| **A. Omit** — label is `workflow · repo` | 0 | ✅ **Recommended.** Honest, deterministic, survives reload, no new fetch. Loses one of the brief's three segments. |
| **B. Per-surface observed time** — reuse `gate.receivedAt` (gate inbox, already used at `ProjectCard.tsx:296`) and the runtime store's newest `LoggedEvent.ts` | small | ⚠️ Client-observed only. After a reload it is missing for finished runs and *wrong* for runs that started before the page loaded — a lying timestamp is worse than none. Acceptable **only** on the gate inbox (R2), where `receivedAt` genuinely is "when this arrived at you". |
| **C. `GET /audit?action=run.launched`** — real server-side launch time | new client method + fetch + join | ❌ Not this pass. It adds a data source, which the brief excludes ("do not invent data — use fields already on the run"). Logged below as follow-up work, not done here. |

`ago()` already exists and is exported (`ProjectCard.tsx:103`), so Option B or C is a small
change *when the timestamp exists*. It does not, so A ships.

**Reconciliation with DES-UXFIX-001 §2.7 rule 4**, which says a run is "labelled by intent,
not raw prompt", with the prompt as the intent phrase. That rule and this item agree on the
defect and differ on the resolution: the redesign wants a *better prompt rendering* as the
primary line; the triage brief wants *run identity* as the primary line with the prompt
demoted. This pass implements the brief. The redesign phase owns the final call and may
promote the intent phrase back to primary — at which point `workflow · repo` becomes the
secondary line and nothing here is wasted. Neither ordering reintroduces the hex id.

---

### C4 — "no repo" renders on every repo-less board card

**Audit saw:** `no repo` in the top-right of every unbound card —
`src/components/ProjectCard.tsx:208`:

```tsx
<span data-testid="project-repo" style={CSS.repo}>{repo ?? 'no repo'}</span>
```

**Root cause.** `CSS.repo` is `marginLeft: 'auto'` in the card header (line 76) — the
most prominent slot on the card after the name. The placeholder occupies it to say that
nothing occupies it. `useBoardModel.ts:36` documents `repo: string | null` as "or `null` when
unbound", so the null is a clean, reliable signal.

**Decision.** Render the binding **only when bound**; absence renders nothing.

```tsx
{repo !== null && <span data-testid="project-repo" style={CSS.repo}>{repo}</span>}
```

- **`data-testid` is preserved on the bound branch** — no existing test queries
  `project-repo` (verified: zero hits across `tests/` and `e2e/`), and keeping the hook lets
  C4's new assertion be written against absence rather than against text content.
- **The header does not reflow.** The status dot is `flexShrink: 0`, the name is the flex
  child that grows, and the repo span is `marginLeft: 'auto'`. Removing it leaves the name
  where it already is. This is why C4 is a copy fix and not a layout change.
- **Discoverability is not lost:** an unbound project reaches repo binding through the
  project surface, not through a grey label that names its own emptiness. DES-UXFIX-001
  §2.1.2's "empty-state budget" (absence gets at most one line per card) is the same
  principle; this is its cheapest instance.

---

### C5 — Build header shows the standalone app name while the breadcrumb shows the project

**Audit saw:** header `wicked-studio` / `cross-session control` —
`CenterDashboard.tsx:929–933` — above a shell whose header already reads the project name
(`ProjectShell.tsx:94`, `data-testid="project-name"`).

**Root cause — one component, two mount contexts.** `App.tsx:221` defines a single
`dashboardSurface()` used from both:

| Mount | Route | Chrome above it |
|---|---|---|
| `App.tsx:305` | `/p/:projectId/build` — inside `ProjectShell` | `‹ Projects` + **project name** + `ModeSwitcher` |
| `App.tsx:417` | `panel === 'runs'`, cross-project home | rail only — no project identity anywhere |

The header was written for the second context and inherited by the first. Inside a project
it is not merely redundant, it is a *competing* identity: the shell says "api-migration", the
surface says "wicked-studio", and nothing tells the user which one scopes the runs below.

**Decision — drop the surface's own title inside a project; keep it outside.**

The brief's second option ("drop its own title and let the breadcrumb + tab carry identity")
is the one that costs nothing structurally and is right in both contexts:

- Add an optional `scopeName?: string | null` prop to `CenterDashboard`. `App.tsx:305` passes
  the project's name (already resolvable — `ProjectShell` reads it from `useProjectsStore`);
  `App.tsx:417` passes nothing.
- **Project-scoped (`scopeName` present):** the `<h1>`/`<p>` pair renders **nothing**. The
  breadcrumb + mode tab carry identity, exactly as the brief allows. The stat row stays where
  it is — the header's flex container keeps its second child, so the stats stay right-aligned
  and nothing moves.
- **Cross-project (`scopeName` absent):** unchanged. `wicked-studio` / `cross-session control`
  is correct there — it *is* the standalone app's cross-session view, and
  `tests/productName.test.tsx` establishes that the visible product name is load-bearing.

**Why not "name the project in the h1"?** It would put the project name on screen twice,
14 px apart, in two type treatments. Two identities is the finding; two copies of one
identity is not the fix.

**Sequencing.** DES-UXFIX-001 §2.7 rule 1 replaces this header region with a purpose
statement (*"Build runs governed code work…"*). That is a content addition and belongs to the
redesign. This pass only *removes* the wrong identity; the redesign fills the space. Doing the
removal first means the redesign lands into an empty slot instead of having to argue with a
wordmark.

---

### C6 — "End chat" is styled danger-red — and the premise is wrong (B3)

**Audit saw:** a red-filled destructive button (`GroupChat.tsx:344–352`:
`background: rgba(248,81,73,0.12)`, `color: #f85149`, red border) for what the audit judged a
non-destructive action.

**What the code actually does** (`GroupChat.tsx:298–310` → `client.ts:183`):

1. `clearStoredChatId(repoId)` — the chat id is forgotten first, deliberately, so a failed
   DELETE cannot leave the UI rejoining a chat the operator ended.
2. `DELETE /chats/:id` — closes the pooled CLI sessions. Those sessions **are** the
   conversation memory: `GroupChat.tsx:10–12` records that they "hold conversation memory
   across turns" and "live until *End chat*"; `:166–169` records that the transcript is **not
   persisted server-side**.
3. Next mount starts clean — pinned by `tests/GroupChat.rejoin.test.tsx:232`.

So ending a chat destroys the agents' memory of the conversation *and* the visible
transcript, irreversibly. The audit's premise — "chat can be revisited" — is false for this
implementation. This is exactly the case the brief carves out: **"if it does destroy, its
label must say what."**

**Decision — honest label, de-escalated styling.**

| | Today | Target |
|---|---|---|
| Label | `End chat` | `End chat & clear history` |
| `title` | — | `Closes the agents and discards this conversation. It cannot be reopened.` |
| Background | `rgba(248,81,73,0.12)` filled | transparent |
| Border | `1px solid rgba(248,81,73,0.25)` | `1px solid rgba(230,237,243,0.12)` (neutral, matches the composer input at `:409`) |
| Text | `#f85149` | `rgba(230,237,243,0.7)`, → `#f85149` on hover |

The filled red is the part the audit is right about: it is a **resting-state alarm** on a
control the user sees before they have typed anything (DES-UXFIX-001 F6 makes the same
complaint about the surrounding surface). The destructiveness is real but it is *elective* —
it earns a warning at the moment of intent, not a permanent one. Neutral at rest, red on
hover, and a label that names the loss is the treatment that is both honest and quiet.

**Not in this pass:** a confirmation dialog. It is the right long-term answer for an
irreversible action, and it is a new interaction — structure, not copy. Logged as follow-up.

**Reconciliation with DES-UXFIX-001 V8**, which renames this control to **"Close"**. B3 says
"Close" would be *less* honest than today's label: it names a window operation for an action
that discards conversation memory. **Flagged for the redesign phase** — V8's rename should
either adopt this label or pair "Close" with a confirmation that states the loss. Recorded
here rather than silently diverging.

---

## 2 Change ledger

| Item | File | Change | Est. LOC |
|---|---|---|---|
| C1 | `CenterDashboard.tsx` | Campaigns box body copy; drop inner `Campaign DAG` heading | ~6 |
| C1 | `CampaignDagStub.tsx` | Heading + body copy; drop `<code>` spans and `§4.3`; rewrite the file's doc comment so it stops being the source of the leaked note | ~10 |
| C2 | `GroupChat.tsx` | S1 placeholder, S2 empty state, S3 error copy, S4 chip `title` map | ~10 |
| C2 | `councilQuorum.ts` | S5 `seats` → `agents` in the returned label | ~2 |
| C2 | `SystemSettings.tsx` | S6 section heading | ~2 |
| C3 | `CenterDashboard.tsx` | `sessionLabel` → identity-first label + secondary/tooltip; strip hex from R1/R4/R5 | ~30 |
| C3 | `RunLink.tsx` | R6 same treatment | ~12 |
| C3 | `ChatsPage.tsx` | R7 same treatment | ~8 |
| C3 | `CenterDashboard.tsx` / `App.tsx` | repo `id → name` map threaded to the dashboard (from the existing `api.listRepos()` call pattern) | ~15 |
| C4 | `ProjectCard.tsx` | Conditional render | ~2 |
| C5 | `CenterDashboard.tsx` / `App.tsx` | `scopeName` prop; suppress the `<h1>`/`<p>` when scoped | ~10 |
| C6 | `GroupChat.tsx` | Label, `title`, button styling | ~8 |
| — | tests | New copy assertions + `councilQuorum.test.ts` string updates | ~45 |
| | | **Total** | **~160** |

Above the brief's ~120 LOC estimate; the delta is B1 (a second campaign component), the C2
sweep finding six sites rather than one, and C3's repo-name plumbing. Each is additive and
independently committable — see §4.

---

## 3 Test plan

The repo's pattern is `tests/productName.test.tsx`: render the real component, assert the
exact user-visible string, with a comment saying which regression the case exists to catch.
New file `tests/copyTriage.test.tsx`, plus edits to `tests/councilQuorum.test.ts`.

**Required by the brief — three negative assertions on rendered output:**

| # | Assertion | Renders |
|---|---|---|
| T1 | No rendered text matches `/Campaign DAG\|RunFinished\|Campaign primitive\|§\d/` | `CenterDashboard` (with runs) **and** `CampaignDagStub` |
| T2 | No rendered text matches `/warm seat\|warm seats\|Warming seats/i` | `GroupChat` in both the pre-open and open states |
| T3 | `queryByText('no repo')` is null, and `queryByTestId('project-repo')` is null, for an unbound project | `ProjectCard` with `repo: null` |

**Positive counterparts** — a negative assertion alone passes on a blank screen:

| # | Assertion |
|---|---|
| T4 | The Campaigns box renders `Campaigns are coming — group related runs into one effort.` |
| T5 | The composer placeholder starts `Message the agents…` and still names Enter/Shift+Enter |
| T6 | A bound project renders `project-repo` with the repo **name** |
| T7 | A run row with `workflow_id: 'feature'` + a resolvable repo renders `feature · <repo>` as its primary line, the prompt excerpt as secondary, and **no** 6/8-char hex in its text content |
| T8 | A run with `repo_ref: null` renders the workflow alone — no trailing `·`, no raw ref |
| T9 | `CenterDashboard` with `scopeName` renders **no** `wicked-studio` heading; without it, still does (guards `productName.test.tsx`'s intent from an over-broad fix) |
| T10 | The end-chat control's accessible name contains `clear history`, and its computed background is not the danger fill |
| T11 | `councilQuorum.test.ts:16,27` updated to `3 of 3 agents` / `1 of 3 agents` |

**Gates:** `npm run lint`, `npm run typecheck`, `npm run test` green. `e2e/` is unaffected —
`studio_standalone_test.py` mentions seats only in a docstring.

---

## 4 Commit sequence

Six commits, each independently green, ordered lowest-risk first so a problem in C3 (the only
item with real logic) cannot hold the rest:

1. `fix(copy): honest pending state for Campaigns, no spec citations` — C1 + T1, T4
2. `fix(copy): say "agents", not "warm seats"` — C2 + T2, T5, T11
3. `fix(board): show the repo binding only when bound` — C4 + T3, T6
4. `fix(build): let the breadcrumb carry project identity` — C5 + T9
5. `fix(chat): name what ending a chat destroys; de-escalate its styling` — C6 + T10
6. `fix(runs): label runs by workflow and repo, demote the prompt, drop the hex id` — C3 + T7, T8

---

## 5 Handed on, not done here

| # | Item | Owner |
|---|---|---|
| H1 | Delete the Campaigns panel from Build (not just its copy) | DES-UXFIX-001 §2.7 rule 3 / V4 |
| H2 | A purpose statement in the header space C5 empties | DES-UXFIX-001 §2.7 rule 1 |
| H3 | **V8's "Close" rename conflicts with B3** — "Close" understates an irreversible action | DES-UXFIX-001, flagged by C6 |
| H4 | Real run timestamps — expose `GET /audit?action=run.launched` in `src/api/client.ts`, or add a launch time to `AgentSession` in `wicked-crew-api-types` (the durable fix; it makes "2h ago" honest everywhere at once) | wire contract / crew |
| H5 | Confirmation step before an irreversible End chat | redesign / interaction |
| H6 | Whether run rows lead with intent (redesign §2.7 r4) or with identity (C3) | redesign phase |
