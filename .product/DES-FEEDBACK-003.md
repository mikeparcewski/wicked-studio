# DES-FEEDBACK-003 — wicked-studio: operator round-4 response (nav simplification + narrative landing)

**Status:** DRAFT
**Date:** 2026-08-21
**Scope:** Design only. No implementation. This is the design-phase deliverable.
**Repo in scope:** `wicked-studio` (all wire needs verified against `wicked-crew` — no cross-repo prerequisite this round)
**Reads first:** `.product/DES-VISION-001.md` (tokens §2, slices §6),
`.product/DES-FEEDBACK-001.md` (slices A–F, EC17–EC20 — landed),
`.product/DES-FEEDBACK-002.md` (slices G/H landed on main; I–L + CREW-1 in flight, EC21–EC25)
**Bases on:** DES-VISION-001 §2 (tokens), §5 (compositions), §6 (slice discipline);
DES-FEEDBACK-001 §1 (the rail this round replaces); DES-FEEDBACK-002 §2/§12 (the
triage cursor and registry this round must reconcile with)

---

## 0 What changed and why this document exists

Rounds 2 and 3 grew the rail additively: slice A stacked QUICK verbs, an inline runs
section, and a settings accordion onto the two existing taxonomies; slice E banded a
metrics bar over the home board; slices G/H hung a palette and a triage cursor off a new
shortcut registry. Each was individually right and the sum is what the operator now
names: **"The left nav just has too much going on."**

Round 4 is not another addition. It is a **re-architecture of the frame**: five primary
paths with a strict one-open accordion, run awareness relocated to a fixed bottom panel,
health relocated to the rail's foot, and a second — sharper — push on the landing page.
The operator's words are quoted verbatim at each section and the design derives from
exactly those words.

**The wire rule (house rule, unchanged):** every data need carries one of the
DES-FEEDBACK-002 §0 verdicts — **EXISTS(route)** (registration line cited from
`wicked-crew/packages/crew/src/api/routes.ts` / `packages/crew/src/projects/routes.ts`),
**CLIENT-DERIVABLE(source)**, or **NEEDS-CREW-ENDPOINT** (specced, flagged, never
silently assumed). This round introduces **zero** new crew endpoints: every surface
below is assembled from wires that already exist or data the studio already holds. The
one place the wire genuinely cannot answer (a cross-project index of made documents,
§4.3) is designed around honestly and named in §11, not invented.

**Reconciliation duty (stated up front):** DES-FEEDBACK-002's slices are partly merged
(G — palette; H — triage cursor are on main) and partly in flight (I, J, K, L, CREW-1).
This document REPLACES parts of slice A and re-scopes surfaces that G/H/L touch. §8 is
the supersession audit: every removed or moved affordance is named there with its
landing place, so in-flight slice builders re-scope deliberately instead of colliding.

---

## 1 The diagnosis — "too much going on"

**Operator:** *"The left nav just has too much going on. Some more feedback...
Primary nav will be simple."*

### 1.1 Current state — the rail inventory

`LeftSidebar.tsx` (482 lines) renders, top to bottom, **seven zones**:

| # | Zone | Source | Lines |
|---|---|---|---|
| 1 | AppChrome (logo, product name, connection dot + health popover) | VISION slice 3 | LeftSidebar.tsx:270–281, AppChrome.tsx:164–228 |
| 2 | NotificationBell | notification arc | LeftSidebar.tsx:283–286 |
| 3 | QUICK header + 4 vertical verbs (Project / Build / Chat / Repository) | FEEDBACK-001 §1.2, slice A | LeftSidebar.tsx:288–315 |
| 4 | Runs — recent 5 inline + "All runs ›" | FEEDBACK-001 §1.4, slice A | LeftSidebar.tsx:336–340, RunsSection.tsx |
| 5 | Projects taxonomy (4 rows + view all) | UXFIX slice 3 | LeftSidebar.tsx:342–361 |
| 6 | Repositories taxonomy (4 rows + search + view all) | UXFIX slice 3 | LeftSidebar.tsx:363–401 |
| 7 | Settings expand/collapse (7 shortcut rows) | FEEDBACK-001 §1.2, slice A | LeftSidebar.tsx:430–433, SettingsRailSection.tsx |

Every zone is always mounted; nothing yields to anything. At 280px wide the rail holds
four different row grammars (verb, run, project, repo), two list caps, one search
field, one accordion, and ~20 interactive elements before the operator has looked at
the actual work surface. The diagnosis is structural, not cosmetic: the rail has no
**hierarchy of place** — creation verbs, live state, taxonomies, and configuration all
sit at the same visual altitude.

### 1.2 The design stance

The fix is the operator's own: a **primary nav of five headings**, each owning its
domain, at most one open. Live run state — the one thing in the rail that is genuinely
*ambient* rather than *navigational* — leaves the rail entirely for a fixed bottom
panel (§5), which is where ambient state belongs: visible from every surface, owned by
none. Configuration (Settings) becomes a first-class path; health becomes the rail's
quiet foot (§6). The bell stays exactly where it is (§6.1 — the operator said so).

What the rail STOPS being: a second home board (runs section gone), a launcher shelf
(QUICK gone — creation moves onto the headings' `+` icons and stays in the palette),
and a junk drawer (no zone without a heading).

---

## 2 The five primary paths

**Operator:** *"Primary paths: Projects, Make, Chat, Repositories, Settings"*

### 2.1 The route map

| Heading | Dashboard route (▦ icon, §3) | New action (＋ icon, §3) | Accordion contents (§3.3) |
|---|---|---|---|
| **Projects** | `/projects` — list + reporting (§4.1) | NewProjectModal (slice A component, unchanged) | attention-ordered project rows (board model) |
| **Make** | `/make` — made-things list + reporting (§4.2, NEW panel) | make-picker popover → Build / Document / Video (§3.4) | recent made things (non-chat runs) |
| **Chat** | `/chats` — upgraded ChatsPage (§4.3) | `navigate('/chat/new')` (existing route, useRoute.ts:145–147) | recent chat threads |
| **Repositories** | `/repos` — upgraded RepositoriesPanel (§4.4) | `navigate('/repos/new')` (existing route, useRoute.ts:142–144) | repo rows + the existing search |
| **Settings** | — none (operator: §3.2) | — none | the slice-A shortcut rows (SettingsRailSection.tsx:18–26) |

All five headings and their targets are **CLIENT-DERIVABLE or EXISTS** — every route
above is already in the `Panel` union (useRoute.ts:3–5) except `/make`, which is a new
panel id in the same union (a client route, not a wire).

### 2.2 The "Make" decision — what the word means here

The platform's mode spine is four verbs: Chat / Build / Document / Video
(useRoute.ts:12–14, MODE_SPECS in ModeSwitcher.tsx). The operator's five paths name
**Make and Chat as separate siblings**. Two readings survive contact with that:

**Reading 1 (adopted): Make = the create-work path — Build ∪ Document ∪ Video.**
The operator split Chat out by name; what remains of the mode spine is exactly the
three modes that *produce an artifact* (a run's deliverable, a document version, a demo
storyboard). "Make" is a superset word, and the operator chose it over "Build", which
they know and have used since round 2 ("Build just takes to new build page…",
DES-FEEDBACK-001 §4). Choosing the superset word while also listing Chat separately is
the natural spelling of "everything I make" vs "everything I discuss".

- Cost: Make's dashboard and accordion must merge three artifact kinds honestly
  (§4.2's corpus discipline — the doc/demo corpus is per-project, §4.2.2).
- Cost: "Build" stops being a top-level word; it survives as a mode tab inside
  projects, as the palette verb `> New Build`, and as one of three options behind
  Make's ＋ icon. Muscle memory is preserved at those three sites.

**Reading 2 (rejected): Make = Build renamed.**
Then Document and Video have no primary path at all — reachable only through a
project's mode tabs — and the "combined list and reporting dashboard" next to Make
would report on code runs only, which duplicates what the runs bottom panel (§5) and
`/runs` already give. The operator's round-2/3 history argues against orphaning
Document/Video: both rounds pushed to make them MORE first-class (canvas-first, F).

Reading 1 is adopted throughout this document. Because this is a vocabulary decision
the operator owns, it leads the open-questions list: **if Reading 2 was intended, §4.2
shrinks to a Build report and Document/Video need a stated home — say the word.**

### 2.3 What the five paths deliberately exclude

- **Runs** is not a path: it moved to the bottom panel (§5), operator's own placement.
  The flat `/runs` list survives as the panel's "All runs ›" escape hatch (§5.3).
- **Home** is not a path: the logo slot already navigates `/` (AppChrome.tsx:173–189),
  and the landing page (§7) is the product's front door, not a sibling of the five.
- The governance/system pages (`/coverage`, `/domain`, `/workflows`, `/policies`,
  `/rules`, `/system`, `/theme`) keep their routes and live under Settings' accordion
  exactly as slice A left them (SettingsRailSection.tsx:18–26) — no route churn.

---

## 3 Heading anatomy — icons, expansion, one-at-a-time

**Operator:** *"Next to each at the heading level will be a dashboard icon and a new
icon: dashboard icon will link to a combined list and reporting dashboard; new would
create a new thing; clicking on the header (actual title) would expand it"* — and:
*"only one heading can be expanded at a time"* — and: *"setting won't have the
dashboard/icons"*.

### 3.1 The heading row

```
┌── rail (280px) ───────────────────────────────┐
│  [logo] wicked-studio                    ● «  │  chrome (unchanged)
│  🔔 Notifications                             │  bell (stays — §6.1)
│  ───────────────────────────────────────────  │
│  ▸ Projects                          ▦   ＋   │  ← heading row
│  ▾ Make                              ▦   ＋   │  ← expanded (chevron down)
│      ⚙ add rate-limiting      working 2/4    │     accordion contents
│      ▤ q3-pitch.html                 v3      │
│      ▶ onboarding-demo               v1      │
│      view all ›                               │
│  ▸ Chat                              ▦   ＋   │
│  ▸ Repositories                      ▦   ＋   │
│  ▸ Settings                                   │  ← no icons (operator)
│                                               │
│              (flex spacer)                    │
│  ───────────────────────────────────────────  │
│  ▸ ♥ Health                                   │  ← §6.2, the rail's foot
└───────────────────────────────────────────────┘
```

Each heading row is three targets, left to right:

1. **The title** (`▸/▾` chevron + word) — a real `<button>`, full remaining width.
   Click toggles expansion (§3.2). The chevron rotates 90° on expand
   (`transition: transform var(--dur-fast)` — the slice-A grammar,
   SettingsRailSection.tsx:60–65).
2. **▦ dashboard icon** — a real link (`href` + onClick-preventDefault, the
   deep-linkable contract) to the path's dashboard route (§2.1). Never toggles
   expansion.
3. **＋ new icon** — the path's create action (§2.1). EC20 note: `＋` returns to the
   rail as an ICON AT HEADING LEVEL — the operator's explicit round-4 ask — which
   re-scopes EC20 from "no + glyphs in QUICK" to "no + glyphs inside accordion
   contents" (QUICK itself is gone; §8.1). The icon carries `aria-label="New <path>"`.

Both icons are 16×16 hit-target-28px buttons in `--ink-dim`, lifting to `--ink-high`
on hover; they render at `--text-xs` scale and NEVER carry the accent at rest (the
accent stays reserved — VISION §2.5 discipline). The heading title:
`--text-sm --weight-semi --font-sans`, `--ink-muted` collapsed, `--ink-high` expanded.

**Settings renders the title only** — no ▦, no ＋ (operator: *"setting won't have the
dashboard/icons"*). Its row is otherwise identical, and its accordion is the slice-A
shortcut list verbatim (the rows and the version line,
SettingsRailSection.tsx:70–91 — moved, not redesigned).

### 3.2 The accordion state model — one open, route-aware

- **Exactly zero or one heading is expanded.** Expanding one collapses whatever was
  open (state: `openHeading: PathKey | null`). Clicking the open heading's title
  collapses it (null is legal — the rail can be all-headings, which is its calmest
  reading and the landing default).
- **Default on load:** derived from the route, not persisted. The route→heading map:
  `/projects`, `/p/*` → Projects; `/make` → Make; `/chats`, `/chat/new` → Chat;
  `/repos*`, `/repo-detail/*` → Repositories; `/system`, `/theme`, `/coverage`,
  `/domain`, `/workflows`, `/policies`, `/rules` → Settings; `/`, `/runs*` → none.
  Landing on `/` therefore shows five closed headings — the quiet frame the landing
  page (§7) deserves.
- **Deep-link behavior:** the same map runs on every route change — navigating into
  `/p/abc/build` auto-expands Projects (collapsing any other). A manual collapse is
  respected until the next route change to a DIFFERENT heading's territory: the map
  re-fires only when the mapped heading changes, so collapsing Projects while working
  inside a project stays collapsed as you move between that project's modes.
- **Keyboard:** heading titles are tabbable; Enter/Space toggles; the accordion emits
  `aria-expanded` per heading. No new global keys — the registry (slice G) is not
  touched by this section, and none of the rail's keys are unmodified singles (EC21
  untouched).
- **Collapsed rail (icon mode):** the 48px state shows the five glyphs stacked
  (◇ Projects, ⚒ Make, 💬 Chat, ⬡ Repositories, ⚙ Settings) as icon links to each
  dashboard route (Settings: to `/system`); accordions don't exist at this width.
  Hover-peek and the immersive auto-collapse contract (LeftSidebar.tsx:216–225,
  slice F) carry over verbatim.

### 3.3 Accordion contents per heading

Contents are **shortcuts, capped, never a second dashboard** — the ▦ dashboard is
where lists live in full. Every list reuses an existing row grammar; nothing new is
invented:

| Heading | Rows (cap) | Row grammar | Source (wire verdict) |
|---|---|---|---|
| Projects | top 6 by attention + `view all ›` | ProjectRow — attention dot + name (LeftSidebar.tsx:173–201, reused verbatim) | `useBoardModel(runs)` — **CLIENT-DERIVABLE** (already the rail's source) |
| Make | 5 most recent made things + `view all ›` | RunsSection's row grammar (status dot + label + phase word, RunsSection.tsx:60–108) applied to NON-CHAT runs; doc/demo rows appear per §4.2.2's scoped rule | `runs` prop filtered `workflow_id !== 'chat'` — **CLIENT-DERIVABLE**; docs: per-project only, labeled |
| Chat | 5 most recent chats + `view all ›` | same row grammar on CHAT runs (`workflow_id === 'chat'` — the ChatsPage filter, ChatsPage.tsx:20–23) | `runs` prop — **CLIENT-DERIVABLE** |
| Repositories | 4 repos + search + `view all ›` | the existing repo rows + search field (LeftSidebar.tsx:363–401 — moved inside, unchanged) | `api.listRepos()` — **EXISTS** (`GET /api/v1/repos`, routes.ts:368); the rail's existing 5s poll (LeftSidebar.tsx:235–250) becomes **fetch-on-expand + palette-cache reuse** (§1.4 of FEEDBACK-002) — expansion is a gesture, the poll retires |
| Settings | the 7 shortcut rows + version line | slice-A rows verbatim | client-only |

`view all ›` in every accordion is the SAME link as the heading's ▦ — two spellings of
one target, the icon for the pointer, the row for the reader.

### 3.4 Make's ＋ — the three-way fork, stated honestly

Make creates three different things, and a single ＋ cannot silently pick one. Clicking
Make's ＋ opens a **make-picker popover** anchored to the icon (`--surface-raised`,
`--shadow-raised`, `--radius-md`):

```
＋ Make…
  ⚙ Build      ship code, with checks
  ▤ Document   a deck, page, or report
  ▶ Video      record a demo
```

The three rows are MODE_SPECS' own glyphs and sublabels (ModeSwitcher.tsx:43–67 —
the words teach the same way the switcher does). Build → `/runs/new` (the unbound
launch form, Unfiled default — slice B semantics); Document / Video → the project
picker first (a doc lives in a project; the ProjectSwitcher component from slice A,
then `modePath(pid, mode)`) — a document cannot be "unfiled" because the bridge mounts
per project (interactive.ts:176–186), and the popover says so in one dim line when no
project exists yet. One extra click over QUICK's Build verb; the palette (`> New
Build`, slice G) remains the zero-click-cost path and is unchanged (§8.4).

### 3.5 Token usage

Heading rows: title per §3.1; hover `--surface-card` background (the rail's existing
row hover). Icons: `--ink-dim` → `--ink-high`, focus ring `--accent` (EC22). Accordion
contents indent by `--space-4` and reuse their source components' tokens untouched.
Divider above Health: `1px solid var(--surface-raised)` (the slice-A settings border).
Motion: accordion open/close at `--dur-fast` `--ease-out` height fade — no loop.

### 3.6 DOM ACs

- `[data-testid="rail-heading-projects|make|chat|repos|settings"]` all render;
  settings' row contains NO `[data-testid="heading-dashboard"]` or
  `[data-testid="heading-new"]` child; the other four contain both.
- At most one `[data-testid^="rail-heading-"]` has `aria-expanded="true"` at any time
  — asserted after clicking two different titles in sequence (EC26).
- Clicking Make's title expands it (chevron rotates, contents render); clicking it
  again collapses (zero open — legal).
- On load at `/p/abc/build`, Projects is expanded and no other; on load at `/`, none.
- Projects' ▦ is an `<a href="/projects">`; middle-click-able; Make's ▦ →
  `/make`; each ＋ fires its §2.1 action (Make's opens
  `[data-testid="make-picker"]` with exactly 3 rows).
- The old testids `rail-quick`, `rail-actions`, `rail-runs`, `rail-settings-section`
  are ABSENT from the DOM (supersession asserted, §8.1).
- Repositories expansion fires at most one `GET /repos` (cold cache), and NO
  interval poll exists (grep: no `setInterval` in LeftSidebar.tsx).
- Collapsed rail shows exactly 5 glyph links; entering `/p/x/document` auto-collapses
  (slice-F behavior preserved).

---

## 4 The per-path dashboards — "a combined list and reporting dashboard"

**Operator:** *"dashboard icon will link to a combined list and reporting dashboard"*

The dashboard discipline is slice D/E's, restated: **every reporting element answers a
named operator question (EC19, `data-question` attribute), SVG-first with no chart
library (FEEDBACK-001 §2.3), tokens only, and every number derives from a wire that
exists.** Each dashboard is one surface: reporting tiles banded on top, the list below
— "combined" is the operator's word and the layout follows it.

The tile components already exist and are REUSED, not re-implemented: `MetricTile`,
`RunOutcomeBar` (accepts a `runs` + `attachedAt` slice), `ProjectSparkline`,
`GateLatencyChart`, `TokenBurnSparkline` (all slice E, HomeBoard.tsx:224–236).

### 4.1 Projects dashboard — `/projects`

**Current state:** ProjectsPage.tsx is a flat card list with a create form — no
reporting.

**Design:** keep the list (cards, archive affordances — untouched), band three tiles
above it:

| Tile | Named question | Source | Verdict |
|---|---|---|---|
| Attention split (needs-you / quiet / total counts as a proportional bar) | "How much of my estate needs me?" | `useBoardModel(runs)` bands | **CLIENT-DERIVABLE** |
| Run outcomes (24h stacked bar) | "Is the system healthy right now?" | `RunOutcomeBar` with the board's merged `attachedAt` clock (HomeBoard.tsx:214–219 — the honest clock, reused) | **CLIENT-DERIVABLE** |
| Gates waiting (count + oldest age) | "Am I the blocker anywhere?" | `useGateStore.gates` | **CLIENT-DERIVABLE** |

Each project row in the list gains the 7-day `ProjectSparkline` (already built, slice
E) — the list half of "combined list and reporting".

**Relationship to `/` (stated so it cannot blur):** the landing page (§7) tells the
STORY — narrative, time-based, cross-cutting. `/projects` is the REGISTER — every
project, complete, with per-project numbers. The board's needs-you wall stays on `/`;
`/projects` never re-implements bands.

### 4.2 Make dashboard — `/make` (new client route)

The combined list + reporting over **made things**: build runs and their deliverables,
documents, demos.

#### 4.2.1 Reporting band

| Tile | Named question | Source | Verdict |
|---|---|---|---|
| Made (7d) — per-day stacked bar: builds / docs / demos | "What is the shop producing, and of what kind?" | non-chat runs bucketed by the board's attach clock; doc/demo versions counted from loaded manifests only, labeled (§4.2.2) | **CLIENT-DERIVABLE**, corpus-labeled |
| Outcome split (24h) | "Are makes landing or failing?" | `RunOutcomeBar` over non-chat runs | **CLIENT-DERIVABLE** |
| Spend (observed) | "What is making costing?" | `TokenBurnSparkline`'s fold — `cliUsage` frames in the runtime store (TokenBurnSparkline.tsx:11–21's wire-honesty note carries: observed-this-session, said out loud in the tile title) | **CLIENT-DERIVABLE** |

#### 4.2.2 The list — and the doc-corpus honesty rule

Build runs are client-held (`GET /runs` is the app's one list). Documents and demos
are NOT: the bridge mounts per project (`GET /projects/:id/interactive/api/docs`,
interactive.ts:244–246), so a complete cross-project doc census would be an N-request
fan-out — the exact pattern §5.2 of FEEDBACK-002 banned for prompts.

The honest v1, same shape as the search corpus label (EC24):

- The list's spine is **non-chat runs** (complete, all projects) — each row: status
  dot, intent, project name, phase word, → `runPath(id)`.
- A **per-project docs section** renders for the CURRENTLY KNOWN doc lists only: docs
  the studio has already loaded this session (Document/Video mode visits, project
  dashboards) — rows: `▤/▶ name · vN · project`, → `versionPath(...)`.
- A permanent corpus label heads the list (EC24 grammar):
  `Listing: build runs (all projects) · documents (projects opened this session) — [why?]`
  — the why-popover: "Documents live behind each project's bridge; the studio lists
  what it has loaded rather than querying every project on page-open." One optional
  affordance — `[load docs for all projects]` — performs the fan-out as an explicit
  gesture (N requests, progress named, cached for the session); it is a button the
  operator presses, never a mount cost. With P projects this is P known-shape GETs —
  acceptable as a gesture, banned as a default.
- A future crew-side made-artifacts index is named in §11, deliberately unpromised.

### 4.3 Chat dashboard — `/chats`

**Current state:** ChatsPage.tsx already has the list, a search, a time-range selector
and derived stats (active count, avg units — ChatsPage.tsx:26–35). It is the closest
existing surface to the ask.

**Design:** promote the derived numbers into the tile band (same `MetricTile` dress as
every other dashboard — visual parity is what makes the five paths read as one system):

| Tile | Named question | Source | Verdict |
|---|---|---|---|
| Chats over time (range-bucketed bar) | "Is conversation increasing or drying up?" | chat runs × the page's existing time-range filter | **CLIENT-DERIVABLE** |
| Active now | "How many threads are warm?" | existing `active` derivation | **CLIENT-DERIVABLE** |
| Gates from chats | "Did a conversation stall on me?" | `useGateStore` filtered to chat runs | **CLIENT-DERIVABLE** |

The list below is the existing ChatsPage list, untouched.

### 4.4 Repositories dashboard — `/repos`

**Current state:** RepositoriesPanel is a list + register form; the visual reporting
lives one level down on RepoDetailPage (language bar, commit cadence — slice E).

**Design:** band three tiles over the existing list:

| Tile | Named question | Source | Verdict |
|---|---|---|---|
| Runs per repo (7d, horizontal bars, top 6) | "Where is the work concentrating?" | runs' `repo_ref` (AgentSession, crew-api-types index.d.ts:153) grouped, joined to repo names via the repos cache | **CLIENT-DERIVABLE** + **EXISTS** (`GET /repos`, routes.ts:368) |
| Repo count + last registered | "Is the estate growing?" | `registered_at` on RepoEntry | **EXISTS** (same fetch) |
| Failing repos (24h) | "Is any repo a failure hotspot?" | failed runs grouped by `repo_ref` | **CLIENT-DERIVABLE** |

Per-repo language bars stay on the detail page (a cross-repo language wall is
decoration — it answers no question the operator has asked; rejected per EC19).

### 4.5 Shared DOM ACs (all four dashboards)

- Each dashboard renders `[data-testid="<path>-dashboard-tiles"]` with every tile
  carrying a `data-question` attribute matching its table row above (EC19/EC28).
- No `<script>` for any chart library enters the bundle (grep — the §2.3 precedent).
- Computed `fill`/`stroke`/`background` on tile elements resolve from `var()` (EC15).
- `/make` renders `[data-testid="make-corpus-label"]` naming both corpora and the
  not-listed clause; `[load docs for all projects]` fires exactly P `GET
  .../interactive/api/docs` requests on click and zero before (request interception).
- Navigation: each rail ▦ lands on its dashboard; each dashboard's list rows navigate
  to their existing targets (spot-asserted per path).

---

## 5 The runs bottom panel

**Operator:** *"I want to move runs to a bottom panel fixed that shows stats for
anything running and when you click it expands to show a list of runs and it's stats;
click on it opens up the run page; this will be fixed at bottom of screen"*

### 5.1 Current state — where run awareness lives today

Three places, none of them the operator's: the rail's inline RunsSection
(LeftSidebar.tsx:336–340 — REMOVED by this section), the home board's cards/feed
(stay — they are the board, not "runs UI"), and the flat `/runs` list (stays as the
escape hatch). The `runs` prop is App's one `useRuns()` (App.tsx:65) — the panel is a
fourth reader of the SAME array plus the gate store; **zero new requests, zero new
sockets**.

### 5.2 Geometry — a reserved row, an overlay sheet

The panel is two physical modes with one rule each:

- **Collapsed (default): a fixed 28px bar** across the full viewport bottom
  (`position: fixed; bottom: 0; left: 0; right: 0; height: 28px`). It is NOT an
  overlay: the app root (`App.tsx:474`, the `h-screen` flex row) gains
  `padding-bottom: 28px`, so every surface — board, dashboards, canvas — ends above
  it. Nothing is ever covered while collapsed.
- **Expanded: an overlay sheet** rising from the bar to `min(340px, 42vh)`
  (`--surface-overlay`, `--shadow-overlay`, top border `1px solid
  var(--surface-raised)`). Expansion OVERLAYS content rather than reflowing it —
  layout math stays identical everywhere, which is what makes the immersive story
  (§5.5) simple. Collapse: the bar's `▾`, Escape, or clicking outside the sheet.

z-order (stated so it cannot be improvised): bar and sheet sit above surface content,
below the command palette, modals, and gate toasts. The sheet never captures keys
beyond Escape — no j/k here in v1 (§5.6).

### 5.3 Collapsed anatomy — "stats for anything running"

```
▴  ● 3 working   ⏸ 2 gates   ✗ 1 failed   ◔ $0.42 observed          All runs ›
```

One line, `--text-2xs --font-mono`, each segment a stat the studio can defend:

| Segment | Derivation | Verdict |
|---|---|---|
| `● N working` | non-terminal, non-gate statuses in `runs` (the RunsSection TERMINAL set, RunsSection.tsx:20) | **CLIENT-DERIVABLE** |
| `⏸ N gates` | `awaiting_human` count in `runs` (agrees with the gate store by construction — both fold the same frames) | **CLIENT-DERIVABLE** |
| `✗ N failed` | `status === 'failed'` in the default (non-archived) listing — the label says "failed", scoped by what `/runs` returns; no invented 24h clock (sessions carry no `created_at` on the wire — the slice-E lesson, TokenBurnSparkline.tsx:11–21) | **CLIENT-DERIVABLE** |
| `◔ $ observed` | the TokenBurnSparkline fold (cliUsage frames, runtime store) — "observed" is in the label because that is what it is | **CLIENT-DERIVABLE** |

Color: each segment's glyph in its status token (`--status-run`, `--status-gate`,
`--status-fail`, `--accent` for spend), text `--ink-muted`. Zero-states compress: a
fully quiet system shows `▴ nothing running · All runs ›` — calm is one phrase, not
four zeros. The `⏸ gates` segment pulses ONLY when a gate is waiting
(`wk-live-pulse`, honoring `prefers-reduced-motion` — the AppChrome dot's exact
grammar, AppChrome.tsx:121–124).

Clicking anywhere on the bar (except `All runs ›`, a real link to `/runs`) expands.

### 5.4 Expanded anatomy — "a list of runs and it's stats; click on it opens up the run page"

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Runs   ● 3 working · ⏸ 2 gates · ✗ 1 failed          All runs ›        ▾   │
│  ────────────────────────────────────────────────────────────────────────────│
│  ⏸ Migrate auth tables      api-migration    gate       waiting 12m      ↵  │
│  ● Add rate-limiting        api-migration    working 2/4   $0.18            │
│  ● Regenerate q3 deck       q3-review-deck   working 1/2   $0.06            │
│  ✗ Fix flaky test           smoke-suite      failed                          │
│  ○ Update readme            api-migration    done                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Order: the RunsSection contract carries over — active before terminal, daemon
  recency within groups (`recentRuns`, RunsSection.tsx:48–52, reused with a higher
  cap: the sheet lists up to 20, scrolling internally past 8).
- Per-run stats, each from data in hand: status dot + phase word
  (`phaseWord`, RunsSection.tsx:34–45 — reused), project name (resolved via the board
  model's membership, `--ink-dim`), gate wait age (from the gate store's frame `ts`),
  observed per-run spend (runtime-store cliUsage frames for that run, shown only when
  non-zero — never $0.00 for "unknown").
- **Row click navigates to the run page** — `runPath(id)` (App.tsx:147–153: inside a
  project shell stays in the shell; outside, `/runs/:id`) — and the sheet collapses
  to the bar (the destination owns the viewport now). Rows are real links
  (href + preventDefault — middle-click works).
- A waiting gate row carries the run's gate chip target: its link lands on the run
  with `#gate` (the GATE_HASH contract) — the fastest path from "the bar pulsed" to
  "answering".

### 5.5 Reconciliation — EC18, the version strip, the feed, and slice H

- **EC18 (canvas geometry):** the collapsed bar shaves 28px from every viewport.
  EC18's >80%-width measurement is untouched (width, not height); the canvas region
  now ends at the bar, and the Document/Video **version strip** (sticky at the
  canvas's own bottom, FEEDBACK-001 §7.3) sits ABOVE the bar by construction — the
  bar is outside the canvas container, a reserved row, so strip and bar never
  overlap and never fight for the proximity-reveal sensor (the 80px mousemove zone
  ends at the canvas edge). EC27 (§10.1) pins this: in immersive modes the panel
  renders COLLAPSED-ONLY by default — entering Document/Video collapses an open
  sheet (the canvas-first principle: the rail already auto-collapses on the same
  transition, LeftSidebar.tsx:216–225); the operator can still expand it manually
  (an explicit gesture wins), where it overlays the canvas as any sheet would.
- **The LiveFeed stays.** The operator moved RUNS UI; the feed is the home board's
  narration column (HomeBoard.tsx:438), a different altitude (what is being SAID vs
  what is RUNNING). Notifications likewise stay (§6.1). No duplication: the bar
  shows counts, the feed shows words, the bell shows events needing acknowledgment.
- **Slice H (triage cursor):** H's surfaces are the board cards and the project
  dashboard's gate rows — both keep their cursor unchanged. The bottom panel is NOT
  a cursor surface in v1: adding a third j/k plane would need focus-arbitration
  rules the operator hasn't asked for. Named in §11; the sheet's rows are
  mouse/tab-reachable links meanwhile (EC22's ring applies to Tab focus).
- **Slice A's RunsSection:** superseded — the component's row grammar and helpers
  (`recentRuns`, `phaseWord`, `RUN_DOT`) are REUSED by the panel; the rail mount is
  deleted (§8.1).

### 5.6 Token usage

Bar: `--surface-rail` background (it is chrome), top border `--surface-raised`.
Sheet: `--surface-overlay` + `--shadow-overlay`. Rows: the RunsSection tokens
verbatim (dot = RUN_DOT map, intent `--text-xs --ink-body --font-sans`, phase
`--text-2xs --ink-dim --font-mono`). Motion: sheet rise `--dur-fast --ease-out`,
no loop; the gates pulse per §5.3.

### 5.7 DOM ACs

- `[data-testid="runs-bottom-bar"]` is present on `/`, `/projects`, `/make`,
  `/repos`, inside `/p/:id/build` AND inside `/p/:id/document` (fixed = everywhere);
  its computed `position` is `fixed`, bottom `0`.
- With the W2 fixture: the bar's segments show the fixture's true counts
  (`data-working`, `data-gates`, `data-failed` attributes match the runs array);
  with an all-terminal fixture the bar reads the quiet phrase.
- Clicking the bar renders `[data-testid="runs-bottom-sheet"]`; row count ≤ 20;
  active rows precede terminal rows; each row is an `<a>` whose href resolves per
  `runPath`.
- Clicking a working run's row navigates to the run page and the sheet unmounts;
  middle-click leaves the page (href asserted).
- A gated row's href ends with `#gate`.
- Entering `/p/:id/document` with the sheet open collapses it (EC27); the version
  strip's bounding box bottom ≤ the bar's top (no overlap, asserted at 1440×900).
- The panel fires zero network requests — ever (interception across mount, expand,
  collapse).
- `[data-testid="rail-runs"]` no longer exists anywhere (supersession).
- Escape closes the sheet; with the palette open, Escape closes the PALETTE only
  (registry precedence asserted).

---

## 6 Notifications stay; health moves to the rail's foot

**Operator:** *"the notifications should stay where it is, but move health down to
where settings was and behaving the same (just with it's health registry)"*

### 6.1 Notifications — explicitly untouched

The NotificationBell keeps its exact slot below the chrome (LeftSidebar.tsx:283–286),
its badge, its panel, and its store. Gate toasts (`GateNotifications`, App.tsx:510)
and the notification store's kinds/cap are untouched. This section exists so the
supersession audit can point at it: NOTHING in round 4 moves the bell.

### 6.2 Health — the rail-foot section

**Current state:** health lives in the chrome — the connection dot opens a popover
with three check rows (WebSocket / API server / wicked-core version) fetched from
`GET /api/v1/health` on open (AppChrome.tsx:74–162; **EXISTS**, routes.ts:250). The
seat-level health registry exists on the wire but the studio never shows it:
`GET /api/v1/roster` returns every council seat with `health: SeatHealth` (status
active/inactive + bounded error excerpt + since/lastErrorAt) and `signed_in`
(**EXISTS**, routes.ts:308, crew#274; SeatHealth in crew-api-types index.d.ts:235–243).

**Design — `HealthRailSection`, the SettingsRailSection pattern verbatim** ("behaving
the same" is the operator's spec, and slice A's section is the named referent):
an expand/collapse block at the rail's very bottom (the slot Settings vacated when it
became a primary path, §2.1), collapsed by default, chevron rotation, header
`--ink-muted` closed / `--ink-high` open — SettingsRailSection.tsx:32–69's exact
dress with `♥ Health` in place of `⚙ Settings`.

Expanded contents — **the health registry**:

```
▾ ♥ Health
    WebSocket        ✓  connected
    API server       ✓  ok · 0.6.0
    ── seats ─────────────────────
    claude           ✓  active · signed in
    codex            ✗  quota exceeded (2h ago)
    antigravity      ✓  active · signed in
```

- Rows 1–2: the existing CheckRow component and its `getHealth()` fetch
  (AppChrome.tsx:61–71, 81–88 — moved, not rewritten).
- Seat rows: one per RosterSeat — name (`display_name`), status glyph in
  `--status-run`/`--status-fail`, `health.message` excerpt (truncated 40ch, full text
  on title) when inactive, `signed_in` as the quiet suffix. **Fetch on expand** —
  a gesture, like the popover it replaces; never polled, cached until next expand.
- The header itself carries a passive summary dot: `--status-fail` if any seat is
  inactive or the socket is down, else nothing — the rail's foot says "look inside"
  without being opened.

**The chrome dot stays; the popover retires.** The dot is glanceable state (ws status)
and the operator moved "health" — the registry/affordance — not the glance. Clicking
the dot now expands the Health section (and scrolls the rail to it) instead of opening
its own popover; one surface for health detail, not two. (If the operator meant the
dot too, deleting it is a 5-line follow-up — flagged in open questions.)

### 6.3 DOM ACs

- `[data-testid="rail-health-section"]` renders at the rail bottom with
  `data-open="false"` by default; the old `rail-settings-section` testid is gone
  from that slot (Settings is a heading now, §3).
- Expanding fires exactly one `GET /health` and one `GET /roster` (interception);
  collapsing and re-expanding refetches (staleness by gesture); zero health/roster
  requests fire on app mount (the §1.4/EC30 gesture rule).
- With a fixture roster carrying one `health.status: "inactive"` seat: the seat row
  shows `✗` + the message excerpt, and `[data-testid="rail-health-summary-dot"]`
  renders on the collapsed header in `var(--status-fail)` (EC15).
- Clicking `[data-testid="connection-dot"]` expands the health section; no popover
  element mounts (the old popover testid/DOM is absent).
- NotificationBell's testid, position (directly under the chrome), and badge behavior
  are byte-identical to main (snapshot + DOM-order assert).

---

## 7 The landing page — from metrics to narrative

**Operator:** *"## Separately — The landing page is still far from graphical and
telling a story of what's happening"*

### 7.1 Why round 3's answer bounced

Slice E answered "needs visuals" with a 64px metrics bar of three small tiles
(HomeBoard.tsx:224–236). Accurate, wire-honest — and 64 pixels of the story told as
accountancy. The operator's restatement adds two words that indict it: **"graphical"**
(the tiles are small multiples, not a picture) and **"telling a story"** (three
disconnected numbers have no plot). This is the second push on the same surface; the
design must change ALTITUDE, not add a fourth tile.

### 7.2 The story spine

A story of a working system has three acts, and they map exactly onto data the studio
already holds:

| Act | Question | Data (all client-held) |
|---|---|---|
| **What happened** | "What did the system do while I wasn't looking?" | terminal runs + their outcomes; observed spend; doc versions landed (runtime/docThread stores) |
| **What's happening** | "What is moving right now?" | non-terminal runs, unit progress, live narration (runtime store) |
| **What needs you** | "Where am I the blocker?" | gate store + failed runs (the board's needs-you band — already built) |

The landing page becomes those three acts IN ORDER, top to bottom. Act 3 already
exists (the needs-you band + cards + triage cursor — untouched, C3). Acts 1 and 2 are
the new build: the **narrative band** replaces the metrics bar.

### 7.3 The narrative band (~200px, replaces the 64px metrics bar)

```
1440×900 — landing, narrative band
┌────────────────────────────────────────────────────────────────────────────────┐
│ [logo] wicked-studio                                                  ● live   │ chrome
├────────────────────────────────────────────────────────────────────────────────┤
│  While you were away: 4 runs finished — 3 passed, 1 failed —                    │
│  and 2 gates are waiting on you.                            $0.42 observed     │  the lede
│                                                                                 │
│  api-migration   ────▮▮▮▮▮▮▮▮▮────────▶●━━━━━━━━━━▶      ⏸                    │
│  q3-review-deck  ──────────▮▮▮▮▮──▤────────●━━━━▶                              │  activity
│  smoke-suite     ──▮▮▮────────────────✗───────────────────                     │  river
│  (5 quiet)       ································································│
│                  ├──────────┼──────────┼──────────┼──────────┤                 │
│                  -24h       -18h       -12h       -6h        now               │
├────────────────────────────────────────────────────────────────────────────────┤
│  NEEDS YOU                                                     │  Live         │
│  [cards — unchanged, triage cursor unchanged]                  │  [feed —      │
│  QUIET (12)                                                    │   unchanged]  │
└────────────────────────────────────────────────────────────────┴────────────────┘
```

**Element 1 — the lede.** One sentence, composed from data, `--text-md --font-sans
--ink-high`, the page's largest text: `While you were away: {N} runs finished — {p}
passed, {f} failed — and {g} gates are waiting on you.` Grammar rules: segments with
zero count drop out ("and 2 gates are waiting on you" vanishes when g=0); the
all-quiet system reads `All quiet. {N} projects, nothing running, nothing waiting.`
Each number is a real link (finished → `/runs`, gates → the needs-you band anchor,
spend → `/make`). "While you were away" is honest because its window is stated by the
river below it (the last 24h of observed activity); no fake "since your last visit"
clock is invented — the daemon has no such wire. The lede carries
`data-question="What happened and what needs me?"` (EC19).

**Element 2 — the activity river.** The graphical center the operator is asking for:
a per-project laned timeline of the last 24h, full band width, SVG-first (no library —
the §2.3 precedent at larger scale):

- **One lane per project with activity in-window** (attention-ordered — the board's
  own order, C3), capped at 6 lanes + a `({n} quiet)` collapsed lane; lane label =
  project name, `--text-xs --font-mono --ink-muted`, → project dashboard link.
- **A run = a horizontal span** in the lane: x from first observed activity to last
  (or `now` for live runs). The honest clock, stated: spans derive from the
  membership attach times + runtime-store frame timestamps the board already merges
  (HomeBoard.tsx:214–219) — observed activity, not invented `created_at`. Span fill:
  `--status-run-dim` body with a `--status-run` leading edge while live;
  terminal spans in `--status-done`/`--status-fail-dim` per outcome.
- **Event marks on the spans:** gate opened = `⏸`-diamond in `--status-gate` (still
  waiting → it pulses, the one loop, reduced-motion honored); failure = `✗` in
  `--status-fail`; doc/demo version landed = `▤`/`▶` tick in `--ink-muted` (from the
  docThread/runtime stores' interactive frames — already ingested, App.tsx:91–94).
- **Live runs breach the "now" edge** with an arrowhead — the picture says "still
  moving" without animation.
- **Interaction:** every span and mark is a real link (run page; gate marks →
  `#gate`); hover raises a title tooltip (intent · phase · project). The river
  carries `data-question="What ran, when, and how did it end?"`.
- Axis: 4 dim gridlines + relative labels, `--text-2xs --ink-dim --font-mono`.

**Element 3 — the margin column.** Right of the river (~160px): observed spend
(the TokenBurnSparkline, moved here — same component), and the outcome split
(RunOutcomeBar, same). The two surviving slice-E tiles fold INTO the narrative band as
its margin notes; the GateLatencyChart retires from the landing (its question — "am I
answering gates quickly?" — is answered by gate marks' positions on the river; the
component remains for dashboards). Net: the metrics bar as a distinct band is GONE
(§8.5), its derivations all live on.

### 7.4 What the band does NOT do

No auto-scrolling, no replay animation, no timeline scrubbing (a lens, not a player);
no per-unit resolution (the run page owns that); no synthetic history — a fresh page
load shows the river only from what stores hold + what the board fetch merged, and
says so in the axis label ("observed") the first session. Wall + feed structure below
is untouched (C6): bands, cards, cursor, feed all byte-identical.

### 7.5 Token usage

Band background `--surface-rail` (chrome family, like the bar it replaces). Lede per
§7.3; links get the standing real-link dress (no underline at rest, `--ink-high` on
hover). River: all fills/strokes from status tokens as named above; lane separators
`1px solid var(--surface-raised)`. The band is the ONE place on the landing where
`--text-md` appears above the fold besides the H1 — hierarchy by scale, not ornament
(EC11).

### 7.6 DOM ACs

- `[data-testid="narrative-band"]` replaces `[data-testid="metrics-bar"]` on `/`
  (old testid absent — supersession).
- With the W2 fixture: `[data-testid="landing-lede"]` text matches the fixture's
  true counts (computed, not snapshotted); each numeric segment is an `<a>`; with an
  all-quiet fixture the lede reads the quiet phrase and no zero-count segment
  renders.
- `[data-testid="activity-river"]` renders ≤6 `[data-testid="river-lane"]` elements
  in board attention order; a live fixture run's span reaches the right edge and
  carries the arrowhead marker; a waiting gate renders
  `[data-testid="river-gate-mark"]` whose computed fill resolves from
  `var(--status-gate)` (EC15); clicking it navigates to the run + `#gate`.
- The lede and river carry their `data-question` attributes (EC19).
- Zero requests attributable to the band fire beyond what the board already fetches
  (interception — the band is a pure re-reader).
- The needs-you band, quiet band, triage hint, and LiveFeed testids all render
  unchanged below the band (C3/C6 regression assert).
- No `<script>` chart library; all river geometry is inline SVG (grep).

---

## 8 Supersession audit — what this replaces, and where in-flight work re-scopes

Round 4 removes and relocates. Every casualty is enumerated here with its landing
place; slice builders on FEEDBACK-002's in-flight slices (I–L) re-scope against this
table, not by discovery.

### 8.1 Removed from the rail (slice A supersessions)

| Affordance | Was (slice A) | Becomes | Fate of the code |
|---|---|---|---|
| QUICK header + 4 verbs | LeftSidebar.tsx:288–315 | ＋ icons on the four headings (§3.1); Make's ＋ carries the Build/Document/Video fork (§3.4); Project's ＋ keeps NewProjectModal | `ActionLink` deleted; NewProjectModal reused unchanged |
| RunsSection mount | LeftSidebar.tsx:336–340 | the runs bottom panel (§5) | component file becomes the panel's row library (`recentRuns`, `phaseWord`, `RUN_DOT` reused); the rail mount deleted |
| SettingsRailSection placement | rail bottom, LeftSidebar.tsx:430–433 | Settings PRIMARY heading (§3.1, icon-less); its rows/version line move into that accordion | `SETTINGS_ITEMS` reused; the bottom slot goes to HealthRailSection (§6.2) |
| Projects/Repositories standalone taxonomies | LeftSidebar.tsx:342–401 | accordion contents of their headings (§3.3), row components reused | repo 5s poll (LeftSidebar.tsx:235–250) RETIRED → fetch-on-expand + palette cache |
| EC20 ("no + in QUICK") | FEEDBACK-001 §8.2 | re-scoped: no `+` inside accordion CONTENTS; heading-level ＋ icons are the operator's own ask (§3.1) | checklist text amended (§10.1) |

### 8.2 AppChrome (VISION slice 3 / slice A supersessions)

| Affordance | Was | Becomes |
|---|---|---|
| Connection dot | chrome, AppChrome.tsx:74–131 | STAYS (glance state) — click now expands the Health section (§6.2) |
| Health popover | AppChrome.tsx:133–159 | RETIRED → HealthRailSection contents (CheckRow + `getHealth()` fetch move there); the popover DOM is deleted |
| NotificationBell | below chrome | UNTOUCHED (operator: "should stay where it is") |

### 8.3 Slice H (triage) — surfaces reconciled

H's cursor walks needs-you CARDS (HomeBoard) and gate-inbox rows (ProjectDashboard) —
**both survive unchanged** (§5.5, §7.4). What H must NOT assume anymore: that the rail
lists runs (it doesn't — a test asserting `rail-runs` breaks) and that the metrics bar
sits above the board (the narrative band does; the triage hint and bands are below it
exactly as before). The bottom panel is explicitly NOT a cursor surface in v1 (§11).

### 8.4 Slice G (palette) — vocabulary reconciled

The palette's verbs keep their spellings — `> New Build`, `> New Chat`, `> New
Project` (CommandPalette.tsx:241–284): "Make" is a PATH name (a place), while the
verbs name what gets made (an action) — Build remains the honest word for a code run,
and it matches the mode tab the verb lands on. Two additions ride the next palette
touch (slice N here, not a G re-open): `> New Document` and `> New Video` (the §3.4
fork's other two tines, same project-picker mechanism), so the palette and Make's ＋
agree on what can be made. The prefix grammar and search mode (J) are untouched.

### 8.5 Slice E (metrics) — derivations live, band dies

The 64px metrics-bar BAND on the landing is superseded by the narrative band (§7.3).
Component fates: `RunOutcomeBar` → landing margin column + Projects/Make dashboards;
`TokenBurnSparkline` → landing margin + Make dashboard; `GateLatencyChart` → OFF the
landing, available to dashboards; `ProjectSparkline` → quiet chips (unchanged) +
Projects dashboard rows; `MetricTile` → the dashboard tile dress everywhere (§4).
EC19 carries — every relocated element keeps its `data-question`.

### 8.6 In-flight slices (FEEDBACK-002 I–L) — re-scope notes

- **Slice I (file viewer):** unaffected (RightPanel + overlay; the bottom bar's 28px
  is outside the viewer's `82vh` overlay math — no change).
- **Slice J (crumb pivot + search):** unaffected in behavior; its search-mode corpus
  label precedent (EC24) is now ALSO the Make dashboard's pattern (§4.2.2) — one
  grammar, two sites.
- **Slice K (chat columns + compare):** compare panes measure EC18 as amended by
  FEEDBACK-002 §12.1 — the region now additionally ends above the fixed bar (§5.5's
  geometry note); no other change.
- **Slice L (notifications + batch):** desktop notifications are additive and stay;
  batch gates ride H's cursor, which is untouched. L's settings group lands in
  `/system` — reachable under the Settings HEADING now (path changed in the rail,
  route unchanged).

---

## 9 Constraint inventory — what every slice must hold

| # | Constraint | Guarded by | How this document honors it |
|---|---|---|---|
| C1 | Chat: zero requests on mount | DES-UXFIX-001 §2.4 | untouched — no section changes GroupChat; rail accordion fetches on EXPAND only (§3.3) |
| C2 | Tokens only; linguist palette sole exemption | DES-VISION-001 §2.11 | every "token usage" subsection; the river's colors are the status layer by construction (§7.5) |
| C3 | Attention model untouched | DES-VISION-001 §1.4 / UXFIX | §3.3 (accordion reads the board model), §7.3 (river lanes in board order), §7.4 (bands byte-identical) |
| C4 | Canvas-first (EC18) | FEEDBACK-001 §7.3 | §5.5: the bar is a reserved row outside the canvas; sheet auto-collapses entering immersive modes (EC27) |
| C5 | Charts answer named questions (EC19) | FEEDBACK-001 §2.1 | §4's per-tile question tables; §7.3's lede + river questions; GateLatencyChart removed from landing WITH its question re-answered (§7.3 element 3) |
| C6 | Wall + feed structure | DES-VISION-001 §5.1 | §7.4 — wall, feed, bands, cursor all unchanged below the narrative band |
| C7 | Keyboard a11y — visible focus, no key theft | EC21/EC22 | §3.2 (tabbable headings, aria-expanded), §5.7 (Escape precedence), no new unmodified keys anywhere |
| C8 | No invented wire | house rule §0 | zero new endpoints this round; the two honesty labels (§4.2.2, §5.3 "observed"/"failed" scoping) make wire limits operator-visible |
| C9 | One shortcut registry | FEEDBACK-002 §1.2 (EC21) | the accordion and panel add NO global keys; Escape-for-sheet registers through the registry AFTER the palette entry |

---

## 10 Slice plan

### 10.0 Inherited rules (DES-VISION-001 §6.0, FEEDBACK-001 §8.0, FEEDBACK-002 §12.0 — unchanged)

- Each PR ≤350 LOC production diff (tests excluded from the count, never from the PR)
- Each PR independently mergeable and revertable
- Merge protocol: branch → open → wait 6–8 min for bots + CI → address → merge
- Every slice gated by named screenshots at 1440×900 via the Playwright harness
- Every slice preserves all VISION/UXFIX/FEEDBACK-001/-002 behaviors it touches
- Token discipline (EC15): the no-raw-color ERROR lint + PostCSS twin stay green

### 10.1 New experience-checklist items (extends EC17–EC25)

- **EC26 — One heading open.** At most one primary-nav heading has
  `aria-expanded="true"`; the route→heading map governs the default; Settings never
  renders dashboard/new icons. (§3.2)
- **EC27 — The bar is a row, the sheet is a guest.** The runs bottom bar is a
  reserved 28px row (never covers content); the expanded sheet is an overlay that
  auto-collapses on entering Document/Video; the version strip and the bar never
  overlap. (§5.2, §5.5)
- **EC28 — Dashboards are combined list + reporting.** Each path dashboard renders
  its tile band (every tile with `data-question`) ABOVE its list; no dashboard
  re-implements another surface's bands. (§4)
- **EC29 — The landing narrates from live data.** The lede's every number derives
  from store state (no static copy, no invented clock); zero-count segments drop
  out; the quiet phrase renders on quiet systems. (§7.3)
- **EC30 — Health is fetched by gesture.** `GET /health` and `GET /roster` fire only
  on an explicit expand (or dot click), never on mount, never on a timer. (§6.2)
- **EC20 (amended)** — scope moves from "no `+` in QUICK" (QUICK is gone) to: no `+`
  glyph inside accordion CONTENTS; heading-level ＋ icons are the sanctioned
  spelling. (§3.1, §8.1)
- **EC18 (amended, second)** — the canvas region additionally ends above the fixed
  28px bar; the >80%-width measurement is unchanged. (§5.5)

### 10.2 Fixture additions (extends W2)

- A roster fixture with 3 seats, one `health.status: "inactive"` with a message
  (health registry rows, summary dot).
- A 24h-spread activity fixture: 3 projects with runs whose observed frames span the
  window — one live run breaching "now", one waiting gate, one failure, one doc
  version landed (river marks; lede counts).
- ≥6 non-chat runs across projects + 2 chat runs (Make/Chat accordions and
  dashboards; bottom-panel ordering).
- An all-terminal variant (quiet lede, quiet bar phrase).

### 10.3 Slices

---

**Slice M — Primary-nav accordion rail** *(~340 LOC)* — §1, §2, §3

LeftSidebar rewrite around five `RailHeading` rows (~120: title/▦/＋ anatomy,
one-open state, route→heading map, collapsed-rail glyph column); accordion contents
wiring reusing ProjectRow / RunsSection row grammar / repo rows / SETTINGS_ITEMS
(~130); make-picker popover (~50); deletion of QUICK, rail RunsSection mount, repo
poll, SettingsRailSection mount (~40 net removals). `/make` panel id registered in
useRoute's union with a placeholder surface (the real dashboard is slice O — the rail
must not link at a 404).

*DOM ACs:* §3.6 in full.
*Screenshots:* `feedback3-M-rail-headings.png` (five headings, Make expanded, W2
fixture), `feedback3-M-make-picker.png` (＋ popover open, 3 rows),
`feedback3-M-rail-collapsed.png` (48px glyph column).
*Checklist:* EC15, EC20(amended), EC22, EC26.
*Preserved:* NotificationBell slot/behavior; immersive auto-collapse (slice F);
NewProjectModal; board attention order (accordion reads, never re-sorts); no global
key changes (C9).

---

**Slice N — Runs bottom panel** *(~300 LOC)* — §5

`RunsBottomPanel.tsx` (~200: fixed bar + stat segments + sheet + rows off the
RunsSection helpers); App.tsx mount + 28px padding + immersive auto-collapse hook
(~40); Escape registration through the registry after the palette entry (~10);
palette verb additions `> New Document` / `> New Video` (§8.4, ~50).

*DOM ACs:* §5.7 in full.
*Screenshots:* `feedback3-N-bar-collapsed.png` (bar with live counts under the
board), `feedback3-N-sheet-open.png` (sheet, active-before-terminal rows),
`feedback3-N-bar-immersive.png` (Document mode: canvas, version strip, bar — no
overlap).
*Checklist:* EC15, EC21 (no key theft), EC27, EC18(amended).
*Preserved:* `/runs` escape hatch; runPath shell semantics (App.tsx:147–153); H's
cursor surfaces; LiveFeed; gate toasts.

---

**Slice O — Health rail-foot + Make dashboard** *(~330 LOC)* — §6.2, §4.2

`HealthRailSection.tsx` (~110: section dress from SettingsRailSection, CheckRow
move, roster fetch-on-expand, summary dot); AppChrome popover retirement + dot→
section wiring (~30 net); `MakeDashboard.tsx` (~160: tile band off existing
components, non-chat-run list, per-project docs section, corpus label + why-popover
+ explicit fan-out button); route wiring (~30).

*DOM ACs:* §6.3 and §4.2's rows in §4.5.
*Screenshots:* `feedback3-O-health-open.png` (registry expanded, one inactive seat),
`feedback3-O-make-dashboard.png` (tiles + corpus label + list, W2 fixture).
*Checklist:* EC15, EC24 (corpus label), EC28, EC30.
*Preserved:* connection dot glyph/state contract (`data-state` untouched);
NotificationBell; `getHealth` response handling (moved verbatim).

---

**Slice P — Projects / Chat / Repositories dashboard reporting** *(~300 LOC)* — §4.1, §4.3, §4.4

Three tile bands on the three existing pages (~90 each: composition of MetricTile +
RunOutcomeBar + ProjectSparkline + new small derivations), ProjectsPage rows gain the
sparkline (~30). No list behavior changes on any of the three.

*DOM ACs:* §4.5 for the three paths.
*Screenshots:* `feedback3-P-projects-dashboard.png`, `feedback3-P-chats-dashboard.png`,
`feedback3-P-repos-dashboard.png` (each: tile band above the untouched list).
*Checklist:* EC15, EC19, EC28.
*Preserved:* ChatsPage filter/time-range/search; RepositoriesPanel register flow;
ProjectsPage create/archive; all existing list testids.

---

**Slice Q — Narrative landing** *(~350 LOC)* — §7

`NarrativeBand.tsx` (~60: lede composer + quiet grammar + links);
`ActivityRiver.tsx` (~200: lanes, spans off the board's merged clocks, marks, axis,
links); margin column (~30: relocated RunOutcomeBar + TokenBurnSparkline);
HomeBoard.tsx swap metrics bar → band (~40 net; GateLatencyChart unmounted from `/`,
component kept).

*DOM ACs:* §7.6 in full.
*Screenshots:* `feedback3-Q-landing-story.png` (full landing: lede, river with a live
run + gate mark, bands below — the money shot), `feedback3-Q-landing-quiet.png`
(all-quiet fixture: quiet lede, calm river).
*Checklist:* EC11, EC15, EC19, EC29; C3/C6 regression asserts.
*Preserved:* needs-you/quiet bands, triage cursor + hint, LiveFeed, windowing math,
all-quiet one-liner, unfiled shelf.

### 10.4 Sequencing

```
M  (rail)            ← first: everything visible hangs off the new frame
├─ N  (bottom panel) ← removes the rail's runs section M leaves orphaned*;
│                       M ships with the rail runs ALREADY gone (M deletes the
│                       mount), so N follows M closely — the gap where runs live
│                       only at /runs should span days, not weeks
├─ O  (health + /make) ← M creates the empty Health slot and the /make link
Q  (landing)         ← independent of M/N/O; parallel any time
P  (dashboards)      ← independent; parallel any time after M (visual parity check
                        against M's rail is the only soft tie)

Hard chain: M → N, M → O.  P and Q float.
```

**Done means:** all five slices merged; every named screenshot captured at 1440×900
and passing its checklist items; W1–W7 walkthroughs re-run green; plus **W8 — the
round-4 walkthrough:** from a cold tab on `/`: the lede states the fixture's truth
and its gate link lands on the needs-you band; the rail shows five closed headings —
expanding Make collapses nothing else (nothing was open), its ＋ forks three ways,
its ▦ lands on a Make dashboard whose corpus label names its limits; a run is
reached in two clicks from the bottom bar; the health section names the sick seat
that the chrome dot hinted at; and at no point does the rail show more than one open
heading or the operator wait on a fetch they didn't gesture for.

---

## 11 Out of scope (named)

- **A crew/bridge cross-project made-artifacts index** (would make §4.2.2's fan-out
  button obsolete) — future NEEDS-CREW-ENDPOINT; the corpus label exists precisely
  so its absence is honest.
- **Cursor keys on the bottom sheet** (j/k inside the run list) — a third cursor
  plane needs focus-arbitration design; the sheet is link-navigable meanwhile
  (§5.5).
- **Persisted accordion preference** (remembering a manually-opened heading across
  sessions) — the route→heading map is the v1 behavior; a `studio.*` settings key is
  a follow-up if the operator asks.
- **"Since your last visit" as a real clock** for the lede — needs a durable
  last-seen marker (a settings write per page-load is not worth it unasked); the
  24h observed window is the honest v1.
- **River zoom/scrub/replay** (§7.4) — the river is a lens, not a player.
- **Removing the chrome connection dot** — kept as glance state pending the
  operator's word (§6.2, open question).
- **Mobile/narrow treatments** of the accordion, bar, and river — the 1440×900
  operator viewport governs; the standing rule applies (a phone gets a purpose-built
  view, not a shrunk desktop).
- **Renaming routes to match "Make"** (`/runs/new`, `modePath(...,'build')`) — URLs
  are API surface for bookmarks/tests; the nav word changes, the route grammar does
  not, this round.

---

## 12 Traceability

| Operator item (verbatim fragment) | Sections | Slices | Wire verdict summary |
|---|---|---|---|
| "left nav … too much going on" / "Primary nav will be simple" | §1 | M | client-only |
| "Primary paths: Projects, Make, Chat, Repositories, Settings" | §2 | M | client routes; `/make` new panel id |
| "dashboard icon … a combined list and reporting dashboard" | §3.1, §4 | M (icons), O (`/make`), P (three upgrades) | CLIENT-DERIVABLE + EXISTS `GET /repos` (routes.ts:368); docs corpus labeled (§4.2.2) |
| "new would create a new thing" | §3.1, §3.4 | M | existing create routes + NewProjectModal; make-picker client-only |
| "clicking on the header (actual title) would expand it" / "only one heading can be expanded at a time" | §3.2 | M | client-only (EC26) |
| "setting won't have the dashboard/icons" | §3.1 | M | client-only |
| "move runs to a bottom panel fixed … stats … expands … opens up the run page … fixed at bottom" | §5 | N | CLIENT-DERIVABLE (runs prop, gate store, runtime store) — zero requests |
| "notifications should stay where it is" | §6.1 | — (no work) | — |
| "move health down to where settings was … behaving the same (just with it's health registry)" | §6.2 | O | EXISTS `GET /health` (routes.ts:250), `GET /roster` + SeatHealth (routes.ts:308, crew#274) — fetch on gesture |
| "landing page is still far from graphical and telling a story of what's happening" | §7 | Q | CLIENT-DERIVABLE (board clocks, runtime/gate/docThread stores) — zero new requests |
