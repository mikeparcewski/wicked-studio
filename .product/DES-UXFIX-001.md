# DES-UXFIX-001 — the experience redesign of wicked-studio's surfaces

**Status:** DRAFT — in progress
**Date:** 2026-08-20
**Scope:** Design only. No implementation. This is the clarify-phase deliverable.
**Repo in scope:** `wicked-studio` (this repo, the coder skin of the experience plane).
**Reads first:** `.product/DES-MERGE-001.md` — the IA this document does *not* re-litigate.
**Runs beside:** a copy-triage pass is fixing pure wording in parallel. Where a finding is
*only* wording ("New chat" vs "Do work" as strings), this document names the term in the
§1 vocabulary table and defers the string change to that pass. It does not restate copy fixes
as design.

---

## 0 Why this exists, and how it was designed

DES-MERGE-001 built the merged product and it is **mechanically correct**: every
wicked-interactive capability survived the merge (§4.10 parity ledger), the routes are
deep-linkable, the board is live, the doc frame is sandboxed. An operator audit of the LIVE
product then found it **unintuitive** — correct machinery a newcomer cannot read. Those
audit findings are the ground truth of this document. The design is derived FROM them, not
from a fresh feature wish-list.

This is important enough to state as a rule: **every change below traces to a walkthrough,
not to a mechanism.** DES-MERGE-001 earned the right to describe the machine; this document
only earns the right to change what a person *sees* while using it. So it opens with four
walkthroughs and every later section answers to them.

### 0.1 The audit findings, verbatim as scoped

| # | Surface | Finding |
|---|---|---|
| F1 | Board | Cards spend most of their height announcing absence ("No documents yet" / "Nothing running"). |
| F2 | Board | The same four quick-action buttons repeat on every card; their verbs are indistinguishable to a newcomer ("New chat" vs "Do work"). |
| F3 | Board | Attention-sort puts days-old failed runs first — no staleness decay, so a failure from last week outranks everything, forever. |
| F4 | Rail | Four taxonomies (Projects / Repositories / Chats / Work) run beside the board's own, with visually identical truncated work items. |
| F5 | Board | A junk project ("Unfiled") leads the board. |
| F6 | Chat | Entering a project drops you into a pre-armed "Group chat" with six agent chips and an End-chat button before you've typed anything — nothing explains what any of it is. |
| F7 | Build | No discernible purpose statement — a stat row of em-dashes, three empty section shells, run rows labelled by raw prompt text. A newcomer cannot say what Build *is*. |
| F8 | Mode switcher | The centrepiece of the IA renders as four small low-contrast text links — visually an afterthought. |
| F9 | Document | Closest to right, but a dead middle column, no visible doc→canvas→thread relationship, an unexplained "theme library" pill. |

### 0.2 The four walkthroughs (the design is built from these)

Each walkthrough is a person, a state of the data, and a question the current product fails
to answer. Every §2 redesign cites the walkthrough(s) it serves.

---

#### W1 — First run

**Person:** has never seen the product. **Data:** near-empty — the daemon is fresh, one or
zero projects, no runs, no documents.

**What they see today (the bug):** `/` shows a board whose one card is "Unfiled" (F5), whose
regions each say a different flavour of "nothing" (F1), and whose four quick actions read as
four near-synonyms (F2). Entering a project drops them, un-warned, into a "Group chat" with
six agent chips and an "End chat" button (F6). Nothing on any surface says what the surface
is for.

**What they must see instead:**

1. **`/` teaches what a project is by showing the shape of one, not by listing zero of
   them.** With no projects, the board is a single first-run panel: one sentence on what
   the product does, and ONE primary action — *Start a project* — not four. The synthesized
   "Unfiled" bucket never leads and, with nothing unfiled, never appears (F5).
2. **The ONE obvious next action is singular.** Where the merged design shows four equal
   quick actions on every card, first-run collapses them to one primary ("Start a
   project" → then, inside it, "Describe what you want"). The other verbs become available
   once there is a project to hang them on, and they are *differentiated* (§1, §2.2), not
   four buttons that sound alike.
3. **Each surface teaches itself in one line.** Entering a project lands in Chat mode with a
   one-line explanation of what Chat is and an empty composer — NOT a pre-warmed six-seat
   group chat (F6). The six chips, the seat-warming, and "End chat" are advanced controls
   that appear only after the user opts into multi-agent, never on the first-run path.
4. **The mode switcher is legible as the centrepiece it is** (F8, §2.5) — four weighted
   tabs, each with a one-line summary on hover, so a newcomer can read the whole product's
   shape from one control.

The first-run test: a person who has never seen the product can, without reading docs, name
what the product is for and take the one action that starts them — in under ten seconds.

---

#### W2 — Messy reality

**Person:** a returning operator running several efforts at once. **Data:** 5+ projects,
including **stale test debris** (a project whose only runs are old smoke tests) and **old
failures** (a run that failed last week and was never cleared).

**What they see today (the bug):** attention-sort is a fixed bucket order —
`gate > failing > running > drafts > quiet` — with NO staleness decay (F3,
`useBoardModel.ts` `deriveAttention`/`sortByAttention`). A run that failed a week ago sits in
the `failing` bucket forever and outranks a project that is *running right now*. The board
becomes a monument to old failures. Separately, every quiet project still renders three
regions of "nothing" (F1), so a calm board reads as a wall of absence, not calm.

**What they must see instead — and this is the load-bearing new mechanism:**

1. **Attention decays with age.** Severity is discounted by how long a signal has sat
   unattended. A gate that arrived 30 seconds ago and a failure from 20 minutes ago both
   demand attention; a failure from *last week* has decayed to background and must not
   outrank a run that is executing now. The decay is specified concretely in §2.1.3.
2. **"Needs me NOW" is visually distinct from history.** The top of the board is only the
   things whose *decayed* attention is still high. Old, undecayed-away failures fall into a
   collapsed **"Older / needs triage"** shelf below the live band — present, not deleted,
   but not leading.
3. **A quiet board looks calm, not empty.** A project with nothing in flight collapses its
   three "nothing" regions (F1) into a single quiet line — *"Quiet — last active 3d ago"* —
   and shows its actions compactly. Calm is one line per project, not three announcements of
   absence per project. Absence gets an **empty-state budget: at most one line per card**
   (§2.1.2).
4. **Stale test debris reads as debris.** A project whose only activity is old test runs
   sorts into the quiet band and labels itself by what it is, so the operator's eye skips it
   instead of triaging it every time.

The messy-reality test: with 5+ projects including week-old failures and stale tests, the
operator can point at "the one that needs me now" in one glance, and the calm majority reads
as one scannable line each — not a grid of "nothing yet".

---

#### W3 — Make a deck

**Person:** wants a finished document. **Data:** an existing project, no documents yet.

**The path, every click named (the design target — see §2.6 for the surface):**

1. On the board, the project card's **Document** action (or, inside the project, the
   **Document** tab). *Click 1.*
2. Document mode with no doc shows the picker's empty state — *"No documents in this project
   yet. Ask for one in the thread."* The composer is focused. *(no click — the thread is
   already the next action.)*
3. The user types *"make me a deck for the Q3 review"* and presses Enter. *Click 2 (Enter).*
   The composer is in its **Launch** state (DES-MERGE-001 §2.2 case 1): pressing Enter
   creates the doc-generation run. An informative run-opening line appears in the thread
   ("Starting a document — planning the deck"), NOT a spinner and NOT whimsy.
4. The canvas shows the document building; narration streams in the thread (§2.6, the
   doc→canvas→thread relationship made visible). The version strip shows v1 as it lands.
5. The user points at a slide, comments *"tighten this headline"*, adds a second comment,
   and submits the batch. *Clicks 3–5 (point, comment, submit).* The batch posts as ONE
   thread message; ONE new version (v2) lands; the version strip advances.
6. The user clicks **Export ▸ PDF** on the canvas or the card. *Click 6.* The completed
   export lands in the thread as a downloadable artifact named `<doc-slug>_v2.pdf`.

Every intermediate state — planning, generating, review-streaming, version-landing,
export-building — names its subject and (where actionable) its control. No state in this path
is a bare spinner or a bare "Working…".

---

#### W4 — Steer live work from the board

**Person:** an operator whose run is executing. **Data:** a project with one run at
`awaiting_human`, another executing.

**The path (the design target — see §2.1.5 gate chips):**

1. On the board, the executing project's card shows a live headline that streams the run's
   newest narration line (already built, DES-MERGE-001 slice 6) — the operator reads
   progress *without entering the project*.
2. When the run parks on a **simple** gate (≤2 choices, no free text — DES-MERGE-001 §7.11),
   the card's run chip becomes an **answerable** chip with **Approve / Reject** inline.
3. The operator clicks **Approve** on the card. *One click.* The run advances; the chip's
   status transitions off `awaiting_human` on the same page — no navigation, no reload
   (DES-MERGE-001 slice 7 AC).
4. A **complex** gate's chip instead deep-links into the thread with the gate message
   scrolled into view and focused — because a complex decision needs the full context the
   board cannot show.

The steer test: an operator approves a simple gate and reads a run's progress entirely from
the board, entering the project only when the decision genuinely needs the thread.

---

### 0.3 What this document is NOT allowed to do

- **Re-open the IA.** DES-MERGE-001's route map, mode model, one-thread rule, and merge
  transport are settled. This document changes what surfaces *look like and teach*, within
  that IA.
- **Restate copy fixes.** Pure wording is the parallel copy-triage pass's job. This document
  names terms once (§1) and moves on.
- **Ship code.** Clarify phase. The deliverable is this design + a slice plan for a later
  phase.

### 0.4 External transformations

This is a UX redesign of existing surfaces; it introduces **no new third-party payload
transformation.** The document relies on the transforms already recorded in
DES-MERGE-001's ledger (cheerio HTML round-trip, chrome print-to-PDF, python-pptx, ffmpeg,
Playwright recording, the crew reverse proxy) — none of which this design changes. The one
new mechanism, attention decay (§2.1.3), is pure client-side arithmetic over data the client
already holds; it is not an external transform.

---

## 1 Vocabulary — one voice

Every internal term that currently reaches the UI, mapped to the ONE user-facing word or to
DELETE. The rule: **a term the user reads must name something the user can act on.** Where a
term names an implementation detail, it is either translated to a user word or removed from
the surface entirely (it may stay in code and in the wire contract). The copy-triage pass
applies these strings; this table is the authority for *which* string.

| # | Internal term | Where it reaches the UI | Decision | User-facing word |
|---|---|---|---|---|
| V1 | `session` / `AgentSession` | run cards, board chips, rail | **RENAME** | **run** (already mostly used; purge stray "session") |
| V2 | `unit` / "unit #N" | AssumptionsPanel, CenterDashboard, ChatPanel, DecisionsLedger | **RENAME** | **step** (a run is made of steps; "unit" is engine vocabulary) |
| V3 | `distributing` (run status) | run chips, status labels | **RENAME** | **working** (user sees `planning → working → review → done`; "distributing" is a scheduler word) |
| V4 | `campaign` / "Campaigns" panel / `CampaignDagStub` | Build surface panel | **DELETE from UI** | — (stub, "engine-real, not wired" — remove the shell until it does something, §2.4) |
| V5 | `workflow` / `workflow_id` | rail Work/Chat split logic, run detail | **HIDE** | not shown as a word; it only *classifies* a run as work vs chat internally |
| V6 | `seat` / roster seat | Group chat chips, "Send to agents" | **RENAME** | **agent** (a seat is an agent you can talk to; "seat" is licensing vocabulary) |
| V7 | `Group chat` | project entry (Chat mode) | **RENAME + reframe** | **Chat** (the mode); multi-agent is a disclosed option "Add agents", not the default (§2.3) |
| V8 | `End chat` | Group chat header | **RENAME** | **Close** (and only shown once a chat with warm agents exists, §2.3) |
| V9 | `Do Work` | rail action, board quick action | **RENAME** | **Build** (matches the mode; the verb and the mode must be the same word) |
| V10 | `New Chat` | rail action, board quick action | **RENAME** | **Chat** (matches the mode) |
| V11 | `council` / `quorum` / "Council → …" | ChatPanel routing line | **KEEP, but demote** | **reviewers** in prose; the raw "Council → cli · quorum" line moves behind a "why this agent?" disclosure (§2.4) |
| V12 | `evaluator-distinct` / "Evaluator-distinct →" | ChatPanel routing line | **RENAME** | **independent check** (the governance property, said plainly) |
| V13 | `elicitation` | ElicitationPrompt, gate flow | **RENAME** | **question** (the agent is asking you something) |
| V14 | `gate` | board chips, gate inbox, toasts | **KEEP** | **gate** is acceptable product vocabulary AND already actionable; keep it, but always pair with the verb ("Gate: approve?") |
| V15 | `inject` / `injectMessage` | steering | **RENAME** | **steer** (already the user word in prose; purge "inject" from any label) |
| V16 | `phase` / `stage` | PhaseLadder, run headers | **KEEP** | **phase** (consistent, already user-legible) |
| V17 | `member` / `membership` / `member_kind` | project detail, board model | **HIDE** | internal join only; never a user-facing word |
| V18 | `Unfiled` (synthesized project) | board (leads today, F5) | **DELETE from the lead** | shown only as a last, collapsed **"Not in a project"** shelf, and only when non-empty (§2.1.4) |
| V19 | `theme library` (pill) | ComposerContext (F9) | **RENAME + explain** | **Themes** — with a one-line "borrow a look from a site, PDF, or image" on open (§2.6) |
| V20 | `drafts` (attention bucket) | board sort internal | **HIDE** | internal bucket name; never rendered |
| V21 | `distributed` (unit status) | ProgressRow dot title | **RENAME** | **done** (a completed step); "distributed" is scheduler state |
| V22 | `narration` | thread live output | **KEEP** (internal) | shown as the agent's own words; the word "narration" never appears |
| V23 | `mode` (Chat/Build/Document/Video) | switcher | **KEEP** | the four are the product's verbs; they are the vocabulary spine everything else aligns to |
| V24 | `demo` (doc kind) | Video mode, doc tiles | **RENAME** | **video** (the mode is Video; the kind should read the same) |

**The spine.** V23's four modes — **Chat, Build, Document, Video** — are the canonical
verbs. Every other label is made to agree with them: the rail's creation verbs (V9, V10),
the board quick actions (F2), the doc kinds (V24), and the run statuses (V3) all resolve to
the same four words a user already learned from the switcher. F2 ("New chat" vs "Do work"
are indistinguishable) is fixed structurally by this: the actions are no longer near-synonyms
because each one is *the name of a mode the user can already see*.

**One deletion of substance:** the "Campaigns" panel (V4) — a stub labelled "engine-real,
not wired" — leaves the Build surface entirely (§2.4). Showing a user an inert shell teaches
them the product is unfinished; hiding it until it works teaches nothing false.

---

## 2 Per-surface redesign

Each subsection: the finding(s) it answers, the walkthrough(s) it serves, an ASCII
wireframe of the target, and the rules that make the wireframe true. Wireframes are drawn at
the real breakpoint (1440×900, the screenshot gate's viewport, §4).

### 2.1 The board card

**Answers:** F1 (absence budget), F2 (quick-action sameness), F3 (staleness decay), F5
(Unfiled leads). **Serves:** W1, W2, W4.

Today every card renders four fixed regions (Documents / Live activity / Crew runs / Quick
actions) at a fixed 352px height, and each empty region prints its own "nothing" line
(`ProjectCard.tsx`). A quiet project therefore spends ~200px announcing three absences (F1),
and the four quick actions are equal-weight synonyms (F2). The redesign makes a card's height
and content a function of its **state**: a busy card is rich, a quiet card is one line.

#### 2.1.1 Two card variants, chosen by decayed attention

```
ACTIVE CARD  (decayed attention is HIGH — this needs me now)         [~200px]
┌──────────────────────────────────────────────────────────────┐
│ ● Q3-review-deck            acme/marketing            gate ▸   │  header + attention pill
│ ────────────────────────────────────────────────────────────  │
│ ⚙ Build · working · "writing acceptance criteria for AC-3"     │  live headline (1 line)
│ ⏸ Gate: approve the plan?              [ Approve ] [ Reject ]   │  answerable gate chip
│ ────────────────────────────────────────────────────────────  │
│ ▤ pitch.html  v4      ▤ notes.html  v2         +1 more         │  doc tiles (only if docs)
│ ────────────────────────────────────────────────────────────  │
│ Chat   Build   Document   Video                                │  actions: 4 modes, low-key
└──────────────────────────────────────────────────────────────┘

QUIET CARD  (decayed attention is LOW — calm, not empty)            [~64px]
┌──────────────────────────────────────────────────────────────┐
│ ○ smoke-tests           acme/infra        Quiet · 6d ago  ▸    │  ONE line: state + age
│   Chat   Build   Document   Video                              │  actions, collapsed row
└──────────────────────────────────────────────────────────────┘
```

The active card keeps DES-MERGE-001 §1.4's regions but only renders a region that has
content. The quiet card is a single summary line plus the action row — it never prints
"No documents yet", "Nothing running", "No runs yet". That is the **empty-state budget**.

#### 2.1.2 Empty-state budget: absence occupies at most one line per card

- A region with no content is **omitted**, not filled with a "nothing" line (F1).
- A card with no active content collapses to the **quiet variant**: exactly one line of
  absence — *"Quiet — last active 3d ago"* — and never more.
- The single exception is a genuinely brand-new project a user just created, which shows the
  **first-run invitation** (§2.3, one line: *"Start by describing what you want →"*).
- The four quick actions are NOT absence and do not count against the budget — but on a quiet
  card they render compact (a single small row), because a calm board is scanned, not
  operated (W2). The large 2×2 "Start here" grid from the merged design is reserved for the
  true first-run empty project (W1), not for every quiet project.

#### 2.1.3 Attention decay (the load-bearing new mechanism) — serves W2, answers F3

Today `deriveAttention` returns a fixed bucket and `sortByAttention` orders by bucket then
recency. The bug: bucket dominates recency, so a week-old `failing` outranks a live
`running` forever (F3). The fix is to make attention a **decaying score**, not a fixed
bucket.

**Score model (client-side arithmetic, no wire change):**

```
base severity:   gate = 100 ,  failing = 70 ,  running = 40 ,  drafts = 15 ,  quiet = 0
age of signal:   Δ = now − (signal's timestamp)          // gate.receivedAt, run end time, etc.
decay:           score = base × HALFLIFE_FACTOR ^ (Δ / halfLife[kind])
```

Half-lives are chosen so that *urgency ages out at the rate that urgency actually fades*:

| Signal | base | half-life | Rationale |
|---|---|---|---|
| `gate` (awaiting_human) | 100 | **∞ (no decay)** | a waiting gate is a person blocked; it must NOT decay — it stays top until answered |
| `running` (executing/planning/working) | 40 | **30 min** | live work is relevant now; a run "running" for hours with no narration change is suspect, not urgent |
| `failing` | 70 | **4 h** | a fresh failure is urgent; a week-old one is history (this is the exact F3 fix) |
| `drafts` (docs, no runs) | 15 | **7 d** | a draft is a gentle nudge, not a demand |

Concrete F3 outcome: a failure from **20 minutes ago** scores `70 × 0.5^(0.33/4) ≈ 66` and
leads; the **same failure a week later** scores `70 × 0.5^(168/4) ≈ 0.000…` — effectively
zero — and falls below every live run. A gate never decays and always leads. The numbers are
tuning constants in one module (`boardAttention.ts`, new); the *shape* (gate ∞, everything
else half-life-decayed) is the design commitment.

**Sort:** by decayed score descending; ties break newest-signal-first, then name (preserving
today's deterministic tail). Projects whose top score falls below a **triage threshold**
(e.g. 5) drop out of the live band into the collapsed shelf (§2.1.4).

#### 2.1.4 Board layout: live band, quiet band, and the "Not in a project" shelf

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Projects                             Sorted by what needs you first.       │
│  ─────────────────────────────────────────────────────────────────────────│
│  NEEDS YOU                                                                   │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                     │
│  │ ACTIVE card   │ │ ACTIVE card   │ │ ACTIVE card   │   ← decayed score    │
│  │  gate ▸       │ │  working      │ │  failing 12m  │     above threshold  │
│  └───────────────┘ └───────────────┘ └───────────────┘                     │
│  ─────────────────────────────────────────────────────────────────────────│
│  QUIET  (7)                                                    [ expand ▾ ]  │
│  ○ smoke-tests · 6d      ○ archived-spike · 9d     ○ notes · 2d             │  quiet rows
│  ─────────────────────────────────────────────────────────────────────────│
│  ▸ Not in a project (3)                                       [ collapsed ] │  ex-"Unfiled"
└───────────────────────────────────────────────────────────────────────────┘
```

- **NEEDS YOU** is the live band: ACTIVE cards, decayed-score-ordered. This is what W2's
  operator scans first and W1's newcomer never has to wade through.
- **QUIET** is the calm majority: one line each, expandable. Stale test debris (W2) lives
  here and reads as debris.
- **"Not in a project"** replaces "Unfiled" (F5, V18): it is the LAST band, collapsed by
  default, and **absent entirely when nothing is unfiled** — so it can never lead the board
  (the exact F5 fix). Runs launched from a card are always project-bound, so this shelf only
  holds genuinely orphaned runs.

#### 2.1.5 Answerable gate chips — serves W4, keeps DES-MERGE-001 slice 7

Unchanged in mechanism (already built): a **simple** gate (≤2 choices, no free text, §7.11)
renders `[Approve] [Reject]` inline and advances the run on the same page; a **complex** gate
deep-links to the thread message, scrolled and focused. The redesign only changes *weight*:
the gate chip is the single highest-contrast element on an ACTIVE card (it is why the card is
in the NEEDS YOU band), pairing the noun with the verb per V14 ("Gate: approve the plan?").

### 2.2 Quick actions — four differentiated verbs, not four synonyms

**Answers:** F2. **Serves:** W1.

The four actions are relabelled to the mode spine (V9/V10/V23) and, crucially,
**differentiated by what they produce**, so a newcomer can tell them apart:

| Action | Reads as | Produces | Distinguishing sublabel (first-run only) |
|---|---|---|---|
| **Chat** | talk it through | a conversation, no artifact yet | "think out loud with an agent" |
| **Build** | governed code work | a crew run with gates + evidence | "ship code, with checks" |
| **Document** | make a deck/report | an interactive HTML doc | "a deck, page, or report" |
| **Video** | record a walkthrough | a demo recording | "record a demo" |

On a busy board the sublabels drop (the operator knows the verbs); on first-run and on hover
they appear (W1). This is the F2 fix: the verbs are no longer near-synonyms because each is
the name of a mode the user can see in the switcher, and each names a different artifact.

### 2.3 The rail — consolidated to TWO taxonomies

**Answers:** F4. **Serves:** W1, W2.

Today the rail runs four browse taxonomies — **Projects / Repositories / Chats / Work** —
beside the board's own project axis (F4), and Chats vs Work are visually identical truncated
run lists (`LeftSidebar.tsx`, split by `workflow_id`). Four axes for a product whose home is
*already* a project board is three too many.

**Consolidation rule: the rail carries at most TWO taxonomies —**

1. **Projects** — the same axis as the board, so the rail and the board agree. This is the
   primary navigation; clicking a project enters its shell (Chat mode default).
2. **Repositories** — the only *cross-project* axis a coder genuinely browses by (a repo can
   back several projects). Kept.

**Chats and Work leave the rail as top-level taxonomies.** They were the same object (a run)
sliced by an internal field (`workflow_id`, V5) and shown as two identical lists (F4). A run
now lives under its project (the board and the project shell already show a project's runs);
the flat cross-project lists survive only as the power-user escape hatch at `/runs`,
`/work`, `/chats` (DES-MERGE-001 §1.5), reached from a single **"All runs ›"** link — not as
two rail sections competing with Projects.

```
BEFORE (four taxonomies)                 AFTER (two taxonomies)
┌────────────────────────┐               ┌────────────────────────┐
│ + Do Work              │               │ + Build   + Chat        │  creation verbs (V9/V10)
│ + New Chat             │               │ + Repository            │  (compact, one row)
│ + New Repository       │               │ ──────────────────────  │
│ ──────────────────────  │               │ PROJECTS            ›   │  taxonomy 1
│ PROJECTS           ›   │               │  ● Q3-review-deck       │
│ ──────────────────────  │               │  ● api-migration        │
│ REPOSITORIES       🔍  │               │  ○ smoke-tests          │
│  acme/marketing        │               │  view all               │
│  acme/infra            │               │ ──────────────────────  │
│ ──────────────────────  │               │ REPOSITORIES       🔍   │  taxonomy 2
│ CHATS                  │  ← F4          │  acme/marketing         │
│  chat about the thing  │  identical     │  acme/infra             │
│  another chat…         │  truncated     │ ──────────────────────  │
│ ──────────────────────  │  run lists     │ All runs ›              │  escape hatch, 1 link
│ WORK                   │  ← F4          └────────────────────────┘
│  work on the thing     │
│  more work…            │
└────────────────────────┘
```

- **Projects** becomes a real list in the rail (not just a header-link), so the rail's
  primary axis matches the board's. Attention order (§2.1.3) applies here too: the rail lists
  the projects that need you, newest-attention first, capped at `SECTION_MAX` with "view all".
- **Repositories** unchanged in behaviour; keeps its search.
- The three creation verbs compress to one row using the mode spine words (Build, Chat,
  Repository), fixing the "Do Work vs New Chat" ambiguity at its second occurrence (F2/V9).
- Everything else (a run's Chats/Work distinction) is derivable inside a project; the rail
  stops duplicating it.

### 2.4 Chat mode — the first-run moment teaches

**Answers:** F6. **Serves:** W1.

Today entering a project drops the user into `GroupChat` — one warm CLI session per roster
seat, six agent chips, and an "End chat" button, all before a word is typed (F6). The
seat-warming leaks and rejoin logic is genuinely good engineering (`GroupChat.tsx` FINDING-027)
— but it is *advanced* machinery shown as the *default* first experience, which teaches a
newcomer nothing except that the product is busy and complicated.

**The redesign: Chat mode opens as a single calm composer, and multi-agent is a disclosed
opt-in.**

```
FIRST RUN — Chat mode, nothing typed yet
┌──────────────────────────────────────────────────────────────────────────┐
│ [ Chat ]  Build   Document   Video                                         │  switcher (§2.5)
│ ──────────────────────────────────────────────────────────────────────── │
│                                                                            │
│         Chat with an agent about this project.                             │  ONE line: what
│         No run, no gates — just talk. Ask for a deck or some               │  Chat is + what
│         code and I'll switch you to the right mode.                        │  it can lead to
│                                                                            │
│         ┌──────────────────────────────────────────────────────────┐      │
│         │ Describe what you want…                                   │      │  focused composer
│         └──────────────────────────────────────────────────────────┘      │
│         [ + Add agents ]                          ← opt-in, one control    │  disclosure
└──────────────────────────────────────────────────────────────────────────┘
```

Rules:

1. **No seats warm until the user opts in.** The default Chat is a single-agent conversation
   (or the one default agent). `[ + Add agents ]` is the ONE control that reveals the roster,
   warms the additional seats, and turns the header into the multi-agent chip strip. The
   expensive warm-and-rejoin machinery is preserved verbatim — it just runs on opt-in, not on
   mount (W1 first-run cost: zero warmed seats).
2. **"End chat" becomes "Close" and appears only once agents are warm** (V8). A newcomer who
   never added agents never sees a teardown button for a thing they never armed.
3. **The first line teaches Chat AND the mode-switch affordance** (DES-MERGE-001 §1.3 rule 1:
   "make me a deck" flips to Document). This is the one place the product's central trick —
   choose a mode by conversation — is taught, so it is stated in the empty state, not left to
   be discovered.
4. **The six-chip group chat is not deleted — it is demoted** from default to disclosed. The
   audit's complaint is not that group chat exists; it is that it ambushes the newcomer.

### 2.5 The mode switcher — real visual weight

**Answers:** F8. **Serves:** W1, and every navigation.

Today the switcher is four small text links with a 2px underline on the active one, low
contrast (`ModeSwitcher.tsx`: `muted` inactive, `13px`, transparent background) — the
centrepiece of the IA rendered as an afterthought (F8). It is *already* accessible (roles,
tooltips, disabled-with-reason) — it just doesn't *look* like the spine of the product.

**The redesign: give it the weight of a primary control, without turning it into chrome
noise.**

```
BEFORE (four low-contrast links)
   Chat   Build   Document   Video
   ────

AFTER (weighted segmented control, 1440px)
┌──────────────────────────────────────────────────────────────────────────┐
│ ┌────────────┐┌──────────┐┌──────────────┐┌───────────┐                    │
│ │ 💬 Chat    ││ ⚙ Build  ││ ▤ Document   ││ ▶ Video   │    ← segmented,     │
│ │  ▔▔▔▔▔▔▔▔  ││          ││              ││           │      active filled  │
│ └────────────┘└──────────┘└──────────────┘└───────────┘                    │
│   talk it through                                                           │  active summary,
│                                                                            │  always visible
└──────────────────────────────────────────────────────────────────────────┘
```

Rules:

1. **Segmented control, not text links.** Each mode is a real segment with a glyph + label;
   the active segment is *filled* (accent background, ink text), not just underlined. This is
   the single biggest contrast change and it is what makes the switcher read as the product's
   spine (F8).
2. **The active mode's one-line summary is always visible** below the control (today it is
   tooltip-only). A newcomer reads what the current mode IS without hovering (W1). The summary
   strings already exist (`MODE_SPECS[m].summary`); this only moves one of them on-screen.
3. **Unavailable modes keep DES-MERGE-001 §1.3 rule 3 exactly** — greyed, never hidden, the
   enabling action named. The redesign does not touch the readiness model; a greyed *segment*
   is more obviously "a thing that could be on" than a greyed *link*.
4. **Glyphs match the board quick actions and doc tiles** (💬 ⚙ ▤ ▶), so the same four
   symbols mean the same four things everywhere (the spine, §1).

### 2.6 Document mode — the doc→canvas→thread relationship made visible

**Answers:** F9. **Serves:** W3.

Today Document mode is close to right but the relationship between the three things a
document IS — the **document** (its identity + versions), the **canvas** (the rendered
artifact), and the **thread** (the conversation that produced it) — is not visible. The audit
names a "dead middle column", no doc→canvas→thread relationship, and an unexplained "theme
library" pill (F9, V19).

**The redesign: a three-pane layout that shows the relationship as adjacency, with the version
strip as the literal spine connecting canvas to thread.**

```
DOCUMENT MODE (1440×900) — the relationship is the layout
┌──────────────────────────────────────────────────────────────────────────┐
│ 💬 Chat  [▤ Document]  ⚙ Build  ▶ Video    │ a deck, page, or report        │  switcher
│ ──────────────────────────────────────────┼─────────────────────────────── │
│                                            │  THREAD                         │
│   CANVAS  (rendered document, sandboxed)   │  ┌───────────────────────────┐ │
│   ┌──────────────────────────────────────┐│  │ you: make a Q3 deck        │ │
│   │                                      ││  │ agent: planning the deck…  │ │ ← narration
│   │   [ the live document ]              ││  │ ▤ v1 landed                │ │   (streams)
│   │                                      ││  │ you: tighten this headline │ │
│   │                                      ││  │ ▤ v2 landed                │ │
│   └──────────────────────────────────────┘│  └───────────────────────────┘ │
│   ◂ v1   ● v2   v3 ▸     [Themes] [Export]│  ┌───────────────────────────┐ │
│   └──────────── version strip ───────────┘│  │ Describe a change…        │ │  ONE composer
│    selecting v1 scrolls the thread ───────┼─▸ (scrolls thread to v1's msg) │  (§2.2 states)
└──────────────────────────────────────────────────────────────────────────┘
```

Rules that make the relationship visible:

1. **No dead middle column.** The three panes are canvas (left, dominant), version strip
   (bottom of canvas, the spine), thread (right). There is no unlabelled middle gutter — the
   version strip *is* the connective tissue and it is labelled by what it does.
2. **The version strip is the literal doc→canvas→thread link** (already built, DES-MERGE-001
   slice 9): selecting v2 swaps the canvas AND scrolls the thread to the message that
   produced v2 (`meta.sourceMessageId`, §7.6). The redesign makes this link *visible* by
   drawing the strip as a spine spanning canvas and thread, and by tagging each thread
   message with the version it produced (`▤ v2 landed`) so the eye can trace canvas ↔ strip ↔
   thread in both directions. This is the direct F9 fix.
3. **Narration lands in the thread, versions land on the strip, the artifact lands on the
   canvas** — three destinations, one event stream (DES-MERGE-001 §3.5). A newcomer learns
   "the conversation makes the document" by watching a message produce a version produce a
   canvas change, left-to-right.
4. **The "theme library" pill becomes "Themes" with a one-line explanation on open** (F9,
   V19): *"Borrow a look from a site, PDF, or image."* It sits in the canvas toolbar beside
   Export, where it acts on the document — not floating unexplained in the composer context.
5. **The empty state points at the thread** (already built, `DocPicker` empty): *"Ask for one
   in the thread."* — which is exactly W3 step 2.

### 2.7 Build mode — given a purpose

**Answers:** F7. **Serves:** W1, W4.

Today Build (the `CenterDashboard` "three-panel home") has no purpose statement: a stat row
that renders em-dashes when there's no data (`—` for cost/tokens, F7), three section shells
(Runs / **Campaigns** / Chats) one of which is an inert stub (V4), and run rows labelled by
raw prompt text (F7). A newcomer cannot say what Build IS.

**Decision: give Build a purpose statement and fold its dead shells into the run view —
do NOT keep three empty panels.**

```
BUILD MODE (1440×900) — purpose first, then the work
┌──────────────────────────────────────────────────────────────────────────┐
│ 💬 Chat  ⚙ [Build]  ▤ Document  ▶ Video   │ ship code, with checks          │  switcher
│ ──────────────────────────────────────────────────────────────────────── │
│  Build runs governed code work: an agent writes, an independent check      │  PURPOSE (1–2
│  grades, and you approve the gates. Everything it does lands as evidence.  │  lines, always)
│ ──────────────────────────────────────────────────────────────────────── │
│  ⏸ 1 gate needs you                                       [ review ▸ ]     │  gate inbox
│    approve the acceptance criteria? · api-migration                        │  (only if gates)
│ ──────────────────────────────────────────────────────────────────────── │
│  RUNS                                                                       │  ONE list, not 3
│  ⚙ Add rate-limiting to the upload endpoint   · working · phase 2/4       │  labelled by
│  ⚙ Migrate the auth tables                    · gate    · needs you       │  INTENT, not
│  ✓ Fix the flaky login test                   · done    · 2h ago          │  raw prompt
│ ──────────────────────────────────────────────────────────────────────── │
│  [ + Build something ]                                                      │  primary action
└──────────────────────────────────────────────────────────────────────────┘
```

Rules:

1. **A purpose statement, always present** (the direct F7 fix): 1–2 lines saying what Build is
   — write / independent check / gates / evidence. It replaces the em-dash stat row as the
   first thing on the surface. It is informative (§3.3): it names what Build does, and it is
   never empty.
2. **The em-dash stat row goes behind the runs** — cost/tokens are a *summary of runs*, shown
   only when there ARE runs and there IS data, and rendered as a compact footer, not a hero
   row of `—` (F7).
3. **Three panels collapse to one RUNS list.** "Campaigns" (V4, the inert stub) is deleted
   from the UI; "Chats" is not a Build concern (Chat is its own mode). Build shows runs — the
   thing Build produces — and nothing else competes for the newcomer's eye.
4. **Runs are labelled by intent, not raw prompt** (F7): the run's title is its
   problem-statement rendered as a short intent phrase, not the full prompt string. Long
   prompts truncate with the intent leading; the full prompt is available on the run.
5. **The gate inbox stays** (it is actionable, W4) but only appears when gates are pending —
   consistent with the empty-state budget (§2.1.2 applied to a surface).
6. **One primary action, "Build something"**, in the mode's own words (V9) — not "Do Work".

This is "Build given a purpose" rather than "Build folded into the run view": Build keeps a
home surface, but that surface now *states its purpose* and shows only the one thing it
produces. The alternative (folding Build entirely into a bare run list) was rejected because
the purpose statement is exactly what F7 says is missing — deleting the surface would delete
the place to put it.

---

## 3 Empty / loading / error state gallery

The rule, inherited from DES-MERGE-001 §3.3 and made a gate here: **every state names a
subject and a next action.** No bare spinner, no bare "Loading…", no error without a next
step, no absence without an invitation-or-nothing (empty-state budget, §2.1.2). The columns
are: what the state is, what the user reads (subject), and the ONE next action. `SurfaceState.tsx`
already implements this contract for Document/Video canvases; this gallery extends it to every
surface the redesign touches and is the checklist §4's screenshots are judged against.

### 3.1 Board (`/`)

| State | Subject the user reads | Next action | Notes |
|---|---|---|---|
| loading | "Loading projects…" | — (transient) | already built; keep |
| error | "Could not load projects: `<msg>`" | Retry | add Retry (today it's text-only) |
| no projects (W1) | "Nothing here yet. A project is where an effort lives." | **Start a project** (one primary) | first-run panel, NOT an "Unfiled" card (F5) |
| all quiet (W2) | NEEDS YOU band empty → "Nothing needs you right now." | expand QUIET band | calm, one line — not a wall of empty cards (F1) |
| quiet card | "Quiet — last active 3d ago" | the four mode actions (compact) | one line of absence, budget respected |
| active card, no docs | (Documents region omitted) | — | region omitted, not "No documents yet" (F1) |
| "Not in a project" | "Not in a project (3)" | expand | collapsed, last, absent when empty (F5) |

### 3.2 Project shell / mode switcher

| State | Subject | Next action | Notes |
|---|---|---|---|
| project loading | project name shown immediately from cache; surface says what it's loading | — | header never spins on a nameless project |
| mode unavailable | greyed segment; summary + "`<Mode>` needs `<X>`" | the named enabling action | DES-MERGE-001 §1.3 rule 3, unchanged |
| bridge starting | "Starting the document service…" | — (informative, transient) | §5.6; informative, never a spinner |
| bridge unavailable (503) | "Could not load `<subject>`. To fix: `<command>`" | the verbatim command + Retry | already built (`Failed` + `bridge-hint`) |

### 3.3 Chat mode

| State | Subject | Next action | Notes |
|---|---|---|---|
| first run, nothing typed (W1) | "Chat with an agent about this project. No run, no gates — just talk." | focused composer | §2.4 — NOT a warmed group chat (F6) |
| single agent thinking | "`<agent>` is thinking…" | — (transient) | named agent, never bare "thinking…" |
| add-agents disclosed | roster chips, each "warming / ready / failed" | Close (when warm) | opt-in only (§2.4) |
| an agent failed to warm | "`<agent>` couldn't start: `<reason>`" | Retry that agent | failure names the agent and a reason |
| send failed | "(send failed: `<err>`)" on the bubble | Retry | already built; keep |

### 3.4 Build mode

| State | Subject | Next action | Notes |
|---|---|---|---|
| purpose (always) | "Build runs governed code work: write, independent check, gates, evidence." | **Build something** | the F7 fix — purpose is the empty state |
| no runs | purpose statement + one primary action | Build something | no em-dash stat row (F7) |
| runs present | each run: intent phrase · phase · state | open the run | labelled by intent, not raw prompt (F7) |
| gate pending | "1 gate needs you — approve the acceptance criteria?" | review ▸ | actionable; only shown when pending |
| run failed | "Failed at phase `<n>`: `<short reason>`" | open run / retry | never a bare red dot; a reason + a way in |

### 3.5 Document mode

| State | Subject | Next action | Notes |
|---|---|---|---|
| no docs (W3 step 2) | "No documents in this project yet." | "Ask for one in the thread" (composer focused) | already built; keep |
| doc loading | "Loading `<doc>`…" | — | subject named (`SurfaceState`) |
| generating | thread: "Planning the deck — 4 slides"; canvas: skeleton with subject | — (narration streams) | never whimsy, never bare "Working…" (§3.3 ban) |
| version has null anchor (pre-merge doc) | strip entry with scroll affordance disabled | tooltip: "no linked message" | §7.6, already built |
| export building | thread: "Building `<doc>` as PDF…" | — | informative; artifact lands as a message |
| export failed (PPTX, no python-pptx) | "Couldn't export to PowerPoint. To fix: `<install>`" | the command; doc stays usable | already built; keep |
| theme learn rejected (SSRF) | "That address isn't allowed." + reason | pick a file instead | server-guarded; UI states the reason |

### 3.6 Video mode

| State | Subject | Next action | Notes |
|---|---|---|---|
| no demo | "No recordings yet." | "Record a demo" (ordered wizard) | §2.2 Video action |
| recording | "Recording — step 2 of 5: click Upload" | — (informative narration) | never bare "Working…" (already an AC, slice 14) |
| ffmpeg missing | storyboard stands; "Install ffmpeg to export video: `<command>`" | the command | non-blocking (DES-MERGE-001 §4.5) |
| poster is a blank frame | "This frame looks blank — re-pick the poster?" | re-pick | the known 2s-seek sharp edge (§4.5) |

### 3.7 The banned states (assertable, not aspirational)

Restating DES-MERGE-001 §3.3's bans as the negative half of this gallery — §4's checklist
asserts their ABSENCE:

- a bare `Working…` with no subject;
- a spinner with no adjacent text;
- an error with no next action;
- rotating flavour text (the deleted `WHIMSY` list) — must not reappear on any surface;
- a "nothing" line where the empty-state budget says omit-or-collapse (F1);
- the "Unfiled" bucket leading the board (F5);
- four quick actions whose labels are near-synonyms (F2).

---

## 4 Slice plan

Six slices, each **≤300 LOC of production diff** (tests excluded from the count, never from
the PR), each independently mergeable and revertable, each behind no flag it can't remove.
Follow the repo merge protocol (branch, open PR, wait 6–8 min for bots + CI, address, merge).

**Every slice's gate is a NAMED SCREENSHOT**, not just DOM assertions. The screenshots are
`data-testid`-stable Playwright captures at **1440×900**, saved to `e2e/shots/uxfix/`, and
judged against the **experience checklist (§4.1)** — the pixels are the evidence, the checklist
is the rubric. DOM assertions prove the mechanism; the screenshot + checklist prove the
*experience*. A slice is not done until both pass.

### 4.0 Screenshot capture contract

- **Viewport:** exactly `1440×900`, `device_scale_factor=1`, set via
  `browser.new_context(viewport={"width":1440,"height":900})` in the existing
  `e2e/studio_standalone_test.py` harness (extend it; do not fork it).
- **Stability:** every asserted element carries a `data-testid`; captures wait on a
  `data-testid` being visible (never a fixed sleep) before shooting, so the image is
  deterministic. Gate toasts (which overlap, per the harness note at line 171) are dismissed
  or scrolled out before board shots.
- **Naming:** `uxfix-<slice>-<scene>.png` (e.g. `uxfix-1-messy-board.png`). Each name is
  listed in the slice's AC and referenced by the checklist.
- **Determinism of data:** every shot runs against the **W2 messy-reality fixture (§4.2)** or
  a named subset, so the image is reproducible run-to-run (same projects, same relative ages
  computed from a frozen `now`).

### 4.1 The experience checklist (the rubric screenshots are judged against)

A reviewer (human or the acceptance trio) scores each named screenshot against these. A slice
passes only if every checklist item mapped to its screenshots is satisfiable *from the image
alone* — if you cannot tell from the pixels, it fails.

- **EC1 — one obvious next action.** On any first-run/empty state, exactly one primary action
  is visually dominant; secondary actions are visibly subordinate. (W1, F2)
- **EC2 — absence is at most one line.** No card/surface shows more than one line of "nothing";
  empty regions are omitted or collapsed, never filled with a "nothing" line. (F1)
- **EC3 — needs-me is distinct from history.** The thing that needs the user is the
  highest-contrast element on screen; old/quiet items are visibly demoted (band, size, or
  colour). (W2, W4, F3)
- **EC4 — no stale item leads.** A week-old failure is not in the NEEDS YOU band; a live run
  outranks it. (F3) — read from the ordering in the image.
- **EC5 — no junk leads.** "Unfiled"/"Not in a project" never appears above a real project.
  (F5)
- **EC6 — verbs are differentiable.** The four actions read as four different things (label +
  glyph + optional sublabel), not four synonyms. (F2)
- **EC7 — the surface teaches itself.** Each surface shows, in one line, what it is for.
  (W1, F7, F9)
- **EC8 — the switcher looks like the spine.** The mode switcher is a weighted primary control
  (filled active segment), not text links. (F8)
- **EC9 — the relationship is visible.** In Document mode, the doc↔canvas↔thread link is
  legible: a thread message is tagged with the version it produced, and the version strip
  visibly connects them. (F9, W3)
- **EC10 — no banned state.** No bare spinner, no bare "Working…", no whimsy, no error without
  a next action, anywhere in the shot. (§3.7)

### 4.2 The W2 messy-reality fixture (required, shared by every slice)

A single seed the harness builds once and every screenshot draws from. It is the
messy-reality dataset of W2, with a **frozen `now`** so ages are deterministic:

| Project | State | Age of signal | Expected band |
|---|---|---|---|
| `q3-review-deck` | run at `awaiting_human`, SIMPLE gate | 30s | NEEDS YOU (gate, no decay) |
| `api-migration` | run at `awaiting_human`, COMPLEX gate | 2m | NEEDS YOU (gate) |
| `upload-endpoint` | run `executing`, narration streaming | now | NEEDS YOU (running) |
| `auth-refactor` | run `failed` | **12 min ago** | NEEDS YOU (fresh failure, undecayed) |
| `legacy-spike` | run `failed` | **8 days ago** | QUIET (decayed to ~0 — the F3 proof) |
| `smoke-tests` | only old smoke runs, all `completed` | 6 days ago | QUIET (stale debris) |
| `notes` | 2 documents, no runs | 2 days ago | QUIET (drafts) |
| `scratch` | brand-new, empty | just created | QUIET (first-run invitation) |
| _(orphan run)_ | a run bound to no project | — | "Not in a project" shelf |
| _(20-project variant)_ | 20 quiet clones for windowing | mixed | QUIET, virtualized |

The fixture MUST include `legacy-spike` (8-day failure) and `upload-endpoint` (live run)
together — that adjacency is the single most important thing the decay math must get right
(EC4), and no screenshot proves it without both present.

### 4.3 Slices

**Slice 1 — attention decay + board bands** *(~280 LOC)* — answers F3, F5; serves W2, W4.
New `boardAttention.ts` (score model §2.1.3, pure, unit-tested); `useBoardModel` sorts by
decayed score; `HomeBoard` renders NEEDS YOU / QUIET / "Not in a project" bands.
- *DOM AC:* with the W2 fixture, `legacy-spike` (8d failure) is NOT in `data-testid="band-needs-you"` and `upload-endpoint` (live) IS; a `gate` project leads regardless of age; `boardAttention.test.ts` pins the decay curve at 30s/12m/8d.
- *Screenshots:* `uxfix-1-messy-board.png` (full W2 board), `uxfix-1-quiet-expanded.png`.
- *Checklist:* EC3, EC4, EC5.

**Slice 2 — card variants + empty-state budget + differentiated actions** *(~260 LOC)* —
answers F1, F2; serves W1, W2. `ProjectCard` gains ACTIVE/QUIET variants; omit-empty-regions;
quick actions relabelled to the mode spine (V9/V10/V23) with glyphs + first-run sublabels.
- *DOM AC:* a quiet project renders exactly one absence line (`data-testid="quiet-summary"`) and zero "No documents yet"/"Nothing running" strings; the four `data-testid="quick-action"` have distinct `data-mode` and labels matching MODE_SPECS; an active card omits an empty Documents region.
- *Screenshots:* `uxfix-2-active-card.png`, `uxfix-2-quiet-card.png`, `uxfix-2-actions.png`.
- *Checklist:* EC1, EC2, EC6.

**Slice 3 — rail to two taxonomies** *(~220 LOC)* — answers F4; serves W1, W2. `LeftSidebar`
drops the Chats and Work sections; Projects becomes a real attention-ordered list; creation
verbs compress to the mode-spine row; a single "All runs ›" escape hatch.
- *DOM AC:* the rail contains `data-testid="rail-section-projects"` and `rail-section-repos` and NO `rail-section-chats`/`rail-section-work`; `/runs` remains reachable via `data-testid="rail-all-runs"`; Projects lists attention-ordered.
- *Screenshots:* `uxfix-3-rail.png`.
- *Checklist:* EC1, EC7.

**Slice 4 — mode switcher weight + Chat first-run** *(~290 LOC)* — answers F6, F8; serves W1.
`ModeSwitcher` becomes a segmented control with filled active segment, glyphs, and an
always-visible active summary. `GroupChat` opens single-agent by default; roster warming moves
behind `[ + Add agents ]`; "End chat" → "Close", shown only when agents are warm.
- *DOM AC:* `data-testid="mode-switcher"` active segment has the filled style (assert computed background ≠ transparent) and the active summary is in the DOM (not just `title`); on Chat first-run, zero seats warm before `data-testid="add-agents"` is clicked (assert no `openChat` request fires on mount); "Close" is absent until agents warm.
- *Screenshots:* `uxfix-4-switcher.png`, `uxfix-4-chat-firstrun.png`, `uxfix-4-chat-multiagent.png`.
- *Checklist:* EC7, EC8, EC10 (no ambush, no warmed seats on first run).

**Slice 5 — Build purpose + fold the dead shells** *(~250 LOC)* — answers F7; serves W1, W4.
`CenterDashboard` gains an always-present purpose statement; the em-dash stat row moves to a
data-gated footer; "Campaigns" (V4) and "Chats" panels are removed; runs render one list
labelled by intent; one primary "Build something".
- *DOM AC:* `data-testid="build-purpose"` is present with a non-empty subject on an empty project; no `data-testid` for a campaigns panel exists; with no runs there is no `—` stat hero (assert absence); run rows show an intent phrase, not the full prompt string.
- *Screenshots:* `uxfix-5-build-empty.png`, `uxfix-5-build-runs.png`.
- *Checklist:* EC2, EC7, EC10.

**Slice 6 — Document three-pane relationship + Themes** *(~240 LOC)* — answers F9; serves W3.
Document mode lays out canvas / version-strip-as-spine / thread; each thread message that
produced a version is tagged `▤ v<N> landed` and cross-links to the strip; the "theme library"
pill becomes "Themes" with a one-line explanation on open.
- *DOM AC:* a thread message carrying a version has `data-testid="thread-version-tag"` with its `data-version`; selecting a strip entry still scrolls the thread to `meta.sourceMessageId` (regression-guard the slice-9 behaviour); `data-testid="themes-open"` reveals the one-line explanation; no `data-testid` reading "theme library" remains.
- *Screenshots:* `uxfix-6-document.png`, `uxfix-6-version-crosslink.png`, `uxfix-6-themes.png`.
- *Checklist:* EC7, EC9, EC10.

### 4.4 Sequencing

- **Slice 1 is the keystone** (decay + bands) — slices 2 and 3 render into the bands it
  defines, so it lands first. 1 → 2 → 3 is the board chain.
- **Slices 4, 5, 6 are independent** of the board chain and of each other (switcher/chat,
  build, document are separate surfaces) and can proceed in parallel after slice 1's shared
  fixture (§4.2) lands.
- **No slice removes a capability** — every change is presentational or is a
  sort/label/layout change over data that already flows. The parity bar of DES-MERGE-001
  §4.10 is untouched (this redesign adds no EMBEDDED/REBUILT/DELETED dispositions).

---

## 5 Out of scope (named, so they are not assumed)

- **The IA itself.** Routes, the four-mode model, the one-thread rule, the merge transport,
  the doc-frame sandbox — all settled in DES-MERGE-001 and not reopened here.
- **Pure copy/wording changes.** The parallel copy-triage pass owns every string. §1 names
  the term and the target word; it does not re-implement the edit.
- **Light theme for studio's hardcoded dark palette.** Still the debt DES-MERGE-001 §4.9
  flagged; this redesign works within the dark palette and does not pay it down.
- **Live doc thumbnails on the board.** DES-MERGE-001 §7.5 kept placeholder tiles; this
  redesign keeps them placeholders. The card variants (§2.1.1) do not add iframes.
- **Governed doc QE, the crew-run document generation path, and DES-MERGE-002.** Deferred
  post-merge in DES-MERGE-001 §7.4/§7.8; untouched here.
- **A `complexity` hint on the gate payload.** Simple-vs-complex stays the client-side
  heuristic (DES-MERGE-001 §7.11); the redesign only changes gate-chip *weight*, not the
  classification.
- **Tuning the exact decay constants against production telemetry.** §2.1.3 commits to the
  *shape* (gate ∞; running/failing/drafts half-life-decayed) and ships defensible defaults;
  fitting the half-lives to real operator behaviour is a follow-up once the mechanism exists.
- **Server-side attention/sort.** Decay is client-side arithmetic over data already fetched
  (§0.4); moving it server-side (for very large project counts) is a scale concern, not this
  redesign.
- **Unifying crew Projects with interactive instances beyond DES-MERGE-001 §7.1.** The
  `interactiveRoot` setting is taken as given.
- **Any remote/multi-user story.** Local-first, as DES-MERGE-001 §7.9 fixed it.

---

## 6 Traceability

Every audit finding has a home; every walkthrough is served.

| Finding | Fixed in | Slice | Checklist |
|---|---|---|---|
| F1 absence dominates cards | §2.1.2 empty-state budget | 2 | EC2 |
| F2 indistinguishable verbs | §2.2, §1 spine | 2, 3 | EC6 |
| F3 no staleness decay | §2.1.3 attention decay | 1 | EC4 |
| F4 four rail taxonomies | §2.3 two taxonomies | 3 | EC1, EC7 |
| F5 "Unfiled" leads | §2.1.4 collapsed last shelf | 1 | EC5 |
| F6 group-chat ambush | §2.4 disclosed opt-in | 4 | EC7, EC10 |
| F7 Build has no purpose | §2.7 purpose statement | 5 | EC2, EC7 |
| F8 switcher is an afterthought | §2.5 weighted segments | 4 | EC8 |
| F9 doc relationship invisible | §2.6 three-pane + version tags | 6 | EC9 |

| Walkthrough | Served by |
|---|---|
| W1 first run | §2.2, §2.3, §2.4, §2.5, §2.7; slices 2–5 |
| W2 messy reality | §2.1 (decay + bands + budget); slices 1, 2; the §4.2 fixture |
| W3 make a deck | §2.6; slice 6 |
| W4 steer live work | §2.1.5 gate chips (kept), §2.1 headline; slices 1, 5 |

**Done means:** all six slices merged, every named screenshot captured at 1440×900 and passing
its mapped checklist items, and a walkthrough re-run (W1–W4) confirming the question each one
poses is answerable from the redesigned surfaces.
