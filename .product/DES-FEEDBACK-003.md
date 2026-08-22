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
