# DES-FEEDBACK-001 — wicked-studio: operator round-2 response

**Status:** DRAFT
**Date:** 2026-08-21
**Scope:** Design only. No implementation. This is the design-phase deliverable.
**Repo in scope:** `wicked-studio`
**Reads first:** `.product/DES-VISION-001.md` (token system, composition model, slices 1–8 on main)
**Bases on:** DES-VISION-001 §2 (token system), §5 (surface compositions), §6 (slice discipline)

---

## 0 What changed and why this document exists

DES-VISION-001 shipped slices 1–5 on main; slices 6–8 are landing. The operator walked the
experience again (round 2) and named eight areas that do not yet deliver on the brief.
This document turns each piece of feedback into a concrete design decision, specifies the
fix, and produces a slice plan that can be implemented without disturbing the slices already
on main.

The operator's words are quoted verbatim at each section; the design derives from exactly
those words, nothing more and nothing less.

---

## 1 Nav restructure

**Operator:** *"Add Quick as header to build/chat/repo and make them each on their own line.
Get rid of + symbols. Add Project as option in quick section (first option), take user
through new project flow. Move all runs below build/chat/repo. Move settings from the
dropdown to an expand/collapse section below."*

### 1.1 Current state

`LeftSidebar.tsx` (lines 278–280) renders three `ActionLink` elements in a horizontal group:
- `Build` (with `plus` prop → shows `+` glyph)
- `Chat` (with `plus` prop)
- `Repository`

Settings is in the `AppChrome` dropdown. There is no `Project` quick-create action. Runs
appear via the `All runs ›` escape-hatch link at the bottom.

### 1.2 New rail composition

```
┌── rail ──────────────────────────────────────────────┐
│  [logo] wicked-studio                                │  chrome (unchanged)
│  ─────────────────────────────────────────────────  │
│                                                      │
│  QUICK                                               │  ← new section header, --text-2xs
│  ◻ Project                                           │  ← first, triggers new-project flow
│  ⚙ Build                                            │  ← no + glyph
│  💬 Chat                                             │  ← no + glyph
│  ⬡ Repository                                       │  ← no + glyph
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  [RUNS — recent 5, attention-ordered]                │  ← all runs below quick actions
│    ● api-migration · working                         │
│    ⏸ q3-deck · gate                                 │
│    ○ smoke-tests · done                             │
│    All runs ›                                        │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  Projects                                            │  ← existing taxonomy, unchanged
│    ▸ api-migration                                   │
│    ▸ q3-review-deck                                  │
│    All projects ›                                    │
│                                                      │
│  Repositories                                        │  ← existing taxonomy, unchanged
│    ▸ studio-api                                      │
│    All repos ›                                       │
│                                                      │
│  ─────────────────────────────────────────────────  │
│                                                      │
│  ⚙ Settings                                         │  ← expand/collapse section
│    (collapsed by default)                            │
│    ▸ Appearance                                      │  ← slices 7–8 content
│    ▸ Crew connection                                 │
│    ▸ API keys                                        │
└──────────────────────────────────────────────────────┘
```

**Changes from current:**

| Element | Before | After |
|---|---|---|
| Quick actions | Horizontal group, Build/Chat/Repo with `+` glyphs | Vertical list under `QUICK` header, no `+` |
| Project quick-create | Absent | First item in QUICK section |
| Runs | `All runs ›` link at bottom | Recent 5 runs inline, below QUICK, with `All runs ›` |
| Settings | AppChrome dropdown | Expand/collapse section at bottom of rail |

**Token usage:** `QUICK` header in `--text-2xs --weight-medium --font-sans --ink-dim
text-transform: uppercase letter-spacing: 0.08em`. Each action row uses the same
`ActionLink` shell but without the `plus` prop. The expand/collapse section header uses
`--ink-muted` when collapsed, `--ink-high` when open; the chevron rotates 90° on expand
(`transition: transform var(--dur-fast)`).

The Settings section carries all of what is currently in the AppChrome dropdown — it does
NOT duplicate the settings route. Clicking "Settings" from the expand/collapse section is a
`navigate('/system')` call, identical to today. The section is just a persistent in-rail
shortcut, not a parallel settings surface.

**Settings removal from AppChrome:** The `⚙ settings` icon in the 48px chrome is removed;
that slot is recovered for the project-switcher breadcrumb (§4.3). The connection status
dot stays in the chrome.

### 1.3 The new-project flow

A new-project flow does not yet exist as a first-class surface. The operator explicitly asks
for one. The design specifies a **minimal inline modal** — not a new route, not a full page.

**Trigger:** clicking `◻ Project` in the QUICK section opens the `NewProjectModal` overlay.

**The modal (360×280px, centered, `--shadow-overlay`, `--radius-xl`):**

```
┌─────────────────────────────────────────────────────────┐
│  New project                                     [✕]   │
│  ─────────────────────────────────────────────────────  │
│  Name                                                   │
│  [____________________________________________]         │
│                                                         │
│  Start with (optional)                                  │
│  ○ Empty   ● Build   ○ Chat   ○ Document                │
│                                                         │
│  Description (optional)                                 │
│  [____________________________________________]         │
│  [____________________________________________]         │
│                                                         │
│              [Cancel]        [Create project →]         │
└─────────────────────────────────────────────────────────┘
```

**Flow:** Name is required (slug-validated: `/^[a-z0-9][a-z0-9 _-]{0,63}$/`). Clicking
"Create project →" calls `POST /api/v1/projects`, receives the project id, then navigates
to `modePath(projectId, 'build' | 'chat' | 'build')` based on the chosen start mode
(default: Build). The modal closes on success or on Escape.

**Does a crew endpoint exist?** The studio already calls `POST /api/v1/projects` through the
project-picker flow in the interactive wizard (`top.post("/api/crew/projects"` in
wicked-interactive server.js line 522). The studio can call the same crew endpoint
directly: `POST /api/v1/projects` with `{ name, description? }`.

ASSUMPTION[external-transform] library=crew projects API transform=POST `/api/v1/projects`
— the exact shape (whether `name` must be a slug or can be a display name, whether
`description` is a valid field) needs verification against the crew codebase.
confidence=needs-research :: The studio sends `{ name, description }` and the crew
normalises the slug server-side. If the API rejects non-slug names, the modal's client-side
validation rule becomes the UX gate (no silent 400).

### 1.4 Runs section in the rail

The five most-recent runs are shown inline, each as a one-row affordance:

```
● api-migration · working  2/4         ›
⏸ q3-deck · gate                       ›
○ smoke-tests · done  12m              ›
```

- Status dot: `--status-run` (working), `--status-gate` (gate), `--status-done` (done),
  `--status-fail` (failed) — exactly the same colors as the board cards.
- Intent label: `--text-xs --ink-body --font-sans` (truncated to 28ch with ellipsis).
- Phase/timestamp: `--text-2xs --ink-dim --font-mono`.
- Row click: `navigate(runPath(run.session.id))` — same as existing `selectRun`.
- `All runs ›` at the bottom remains.

The runs section uses the same `runs` prop already passed to `LeftSidebar` — no new fetch.
The five entries are sorted by `updated_at` descending (most-recent first); terminal runs
(done/failed/cancelled) appear after active ones regardless of recency.

---

## 2 Home as system dashboard

**Operator:** *"Needs visuals (charts/graphs) and needs to be a true view of all system
happenings."*

### 2.1 What earns the pixels

Every chart answers a named operator question. Charts without a question are decoration and
are rejected.

| Chart | Question it answers | Data source | Form |
|---|---|---|---|
| **Run outcome bar (last 24h)** | "Is the system healthy right now?" | `runs` from `/api/v1/runs` | Stacked mini-bar (3 segments: running/passed/failed/gate) per 2h window, 12 bars |
| **Gate response times (today)** | "Am I answering gates quickly or letting things stall?" | `awaitingHuman` events from event store | Dot per gate (x = opened, y = response time in min); horizontal rule at 30min threshold |
| **Token burn (today, running 24h)** | "What am I spending, is it accelerating?" | `cost` field on session views | Cumulative area sparkline, current value in mono |
| **Per-project activity sparkline** | "Which of my quiet projects is quietly doing work?" | `runs` filtered by `project_id` | 7-day bar sparkline per project, rendered inside the quiet-band project row |

**What is rejected and why:**
- Dependency graph on home: the graph is per-repo, not per-system — it would be noise here.
- Per-agent performance: too granular for the home surface; belongs inside a run detail.
- Historical token burn beyond 24h: the home is mission-control (now), not a billing page.

### 2.2 Layout

The dashboard charts live in a **metrics bar** between the chrome and the project wall.
They do not replace the wall or the live feed — they augment them.

```
1440×900 — home with metrics bar
┌──────────────────────────────────────────────────────────────────────────┐
│  [logo] wicked-studio           ● live  [status dot — no settings icon]  │  48px chrome
├───────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Runs (24h)           │  │ Gate latency │  │ Token burn (today)  │   │  64px metrics bar
│  │ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮   │  │ · · · ·     │  │ ╱╱╱╱╱╱            │   │
│  │ 12  2  1  · 4  pass  │  │ avg 8m       │  │ $0.24             │   │
│  └──────────────────────┘  └──────────────┘  └──────────────────────┘   │
├───────────────────────────────────────────────────────┬───────────────────┤
│  Projects                          [wall — unchanged] │  Live            │
│                                                       │  [feed — unch.]  │
└───────────────────────────────────────────────────────┴───────────────────┘
```

The metrics bar is `height: 64px; background: var(--surface-rail);` — one band, full width.
Three equal-width tiles. On screens narrower than 900px, the tile for gate latency is hidden
(it is the least critical at a glance).

### 2.3 Chart approach: SVG-first, no library

**Rule:** no chart library is introduced. All charts are SVG `<polyline>`, `<rect>`, and
`<circle>` elements with token-derived colors. The data volumes are small (12 bars max per
chart). A library import for charts of this scale fails the information-is-the-aesthetic
test — it ships hundreds of KB to render 12 bars.

**Run outcome bar:**
```
<svg width="100%" height="24">
  {windows.map((w, i) => (
    <>
      <rect x={i*colW} y={24 - passH} width={colW - 1} height={passH}
            fill="var(--status-run)" />     {/* pass */}
      <rect x={i*colW} y={24 - passH - gateH} ... fill="var(--status-gate)" />
      <rect x={i*colW} y={24 - passH - gateH - failH} ... fill="var(--status-fail)" />
    </>
  ))}
</svg>
```

Colors come directly from `--status-run`, `--status-gate`, `--status-fail` — no hex in
component code. Heights are proportional to count within the bar's column max.

**Token burn area sparkline:**
```
<svg viewBox={`0 0 ${W} 24`} preserveAspectRatio="none">
  <defs>
    <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
    </linearGradient>
  </defs>
  <polygon points={areaPoints} fill="url(#burnGrad)" />
  <polyline points={linePoints} stroke="var(--accent)" strokeWidth="1.5" fill="none" />
</svg>
```

**Gate latency scatter:**
Each gate is a `<circle r="3" cx={xForTime} cy={yForMinutes} fill="var(--status-gate)" />`.
The horizontal threshold rule at 30min is `<line ... stroke="var(--status-gate-dim)" strokeDasharray="3 3" />`.

**Per-project sparkline (quiet band):**
A 7-day bar sparkline, `height: 16px width: 56px`, rendered inline in the quiet-band row
beside the project name. Same `<rect>` approach, height proportional to run count that day.
Color: `--ink-dim` for days with runs, transparent for days without.

### 2.4 Data contract

All three metrics-bar charts derive from data already in the runtime store or the `runs`
list. No new API call is introduced:

- Run outcome bar: derived from `runs` (available from `useRuns()`), sliced into 2h windows
  over the last 24h from the session's `created_at`.
- Gate latency: derived from `awaitingHuman` events and the corresponding `gateDecided`
  events, both already in `useRunEventStore`.
- Token burn: the `cost` field on `SessionView` objects in `runs`, summed and sorted by
  `created_at`.

The per-project sparklines are derived from `runs` grouped by `project_id` and bucketed by
day.

---

## 3 Repo profile visual

**Operator:** *"Still not visual, lots of lists of things — we said visually stunning."*

### 3.1 What earns pixels on the repo profile

| Visual | Question answered | Form |
|---|---|---|
| **Language composition bar** | "What is this repo actually built of?" | Proportional horizontal segmented bar, labeled |
| **Commit cadence sparkline** | "Is this repo active or stagnant?" | 30-day daily commit bar chart |
| **Hotspot zone (reuse existing)** | "Which files are the risk concentration?" | Inline CytoGraph or HotspotsView excerpt (existing components, surfaced here) |
| **File type breakdown** | "What's the mix of code, tests, config, docs?" | Small donut or waffle (SVG, same approach as §2.3) |

**What is not here:** Per-contributor statistics (privacy surface, not operator value),
full git history (belongs in a separate pane, not the profile header), raw line counts
(numbers without context are noise; the composition bar gives relative weight).

### 3.2 Layout

```
REPO: studio-api
┌──────────────────────────────────────────────────────────────────────────┐
│  studio-api                                           [Graph ›] [Sync ›] │  header
│  TypeScript monorepo · 24k LOC · last commit 2d ago                     │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  TS ██████████████████████████████ CSS ████ JS ███ Other ██             │  language bar
│  TypeScript 67%                    CSS 18%  JS 11%  Other 4%            │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│  Commits (30d)                         File types                        │
│  ▮ ▮▮▮ ▮▮ ▮  ▮▮▮▮▮▮  ▮▮▮  ▮▮▮▮▮▮    [donut: src/tests/config/docs]   │
│  3  9  6  2   14     8     18                                             │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│  Hotspots                                                                 │  existing HotspotsView
│  [inline excerpt — top 10 files by churn × complexity]                  │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│  Runs in this repo                                                        │  existing run list
│  ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Language bar implementation

The existing `RepoDetailPage.tsx` receives repo data that already includes language
breakdown from the estate (`wicked-estate` indexing). The bar is a single `<div>` with flex
children sized by `flex-basis`:

```tsx
// LanguageBar.tsx — new component (~60 LOC)
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f7df1e', CSS: '#563d7c',
  Python: '#3572a5', Rust: '#dea584', Go: '#00add8',
};
// Fallback for unlisted languages:
const FALLBACK = 'var(--ink-dim)';

function LanguageBar({ breakdown }: { breakdown: Record<string, number> }) {
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  return (
    <div>
      <div style={{ display: 'flex', height: '8px', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
        {sorted.map(([lang, bytes]) => (
          <div key={lang}
               style={{ flexBasis: `${(bytes / total) * 100}%`, background: LANG_COLORS[lang] ?? FALLBACK }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '16px', marginTop: '6px' }}>
        {sorted.slice(0, 4).map(([lang, bytes]) => (
          <span key={lang} style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-sans)' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px',
                           background: LANG_COLORS[lang] ?? FALLBACK, marginRight: '4px' }} />
            {lang} {Math.round((bytes / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}
```

Note: `LANG_COLORS` contains literal hex values, which violates the `--no-raw-color` rule.
The exemption: language colors are a **universal developer convention** (GitHub's
`linguist` palette, learned by every developer); overriding them with the token accent
would make TypeScript look indigo-violet, destroying recognition. A lint comment
`// eslint-disable-next-line no-restricted-syntax -- linguist palette, convention over token` 
is placed at each literal use. This is the only exemption permitted in the codebase.

### 3.4 Hotspots inline

`HotspotsView.tsx` already exists. The repo profile surfaces it inline (not behind a modal)
as a collapsed strip showing the top 5 hotspot files. A "View all →" link opens the full
`HotspotsView`. The existing `CytoGraph` in `RepoGraphModal` remains behind its `[Graph ›]`
button — the profile page does not try to inline the full graph (too heavy; the hotspot
strip is the inline proxy).

---

## 4 Project dashboard + context

**Operator:** *"Should have a dashboard and context, right now just defaults to action view
but with no context of project. Build just takes to new build page but no context of
current project you kicked off from."*

### 4.1 Project landing as dashboard

Entering a project (`/p/:projectId`) currently renders the mode switcher immediately with
the last-used mode active. The operator wants to land on a **project dashboard** that shows
context before actions.

The project dashboard is the landing view for `/p/:projectId` with NO mode segment active.
It is NOT a fifth mode — there is no "Dashboard" tab in the switcher. The dashboard is
what you see before you choose a mode.

```
PROJECT: api-migration — DASHBOARD
┌──────────────────────────────────────────────────────────────────────────┐
│  [logo] wicked-studio  ▸  api-migration             ● live              │  chrome
│  ─────────────────────────────────────────────────────────────────────  │
│  api-migration                           [⚙ Build] [💬 Chat] [▤ Doc] [▶ Video]  │  project header
│  last activity 4m ago · 3 open runs · $1.24 today                       │  meta line
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  ┌───────────────────────────────┐  ┌──────────────────────────────┐   │
│  │ Active runs (3)               │  │ Documents (2)                │   │
│  │ ⚙ Add rate-limiting  working │  │ ▤ spec.html        v4        │   │
│  │ ⏸ Migrate auth tables  gate  │  │ ▤ pitch.html       v2        │   │
│  │ ○ Fix flaky test    done 2h   │  │                              │   │
│  └───────────────────────────────┘  └──────────────────────────────┘   │
│                                                                           │
│  ┌───────────────────────────────┐  ┌──────────────────────────────┐   │
│  │ Gate inbox (1)                │  │ Activity (7d)                │   │
│  │ ⏸ Approve: AC for auth?       │  │ ▮▮▮ ▮▮▮▮▮▮ ▮▮ ▮▮▮ ▮▮ ▮     │   │
│  │  [Approve] [Reject]           │  │ 3   9     5   7   4   1     │   │
│  └───────────────────────────────┘  └──────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Four dashboard tiles:**
1. **Active runs** — filtered to this project, attention-ordered (same model as home board
   but scoped). Clicking a run navigates to the run's mode view.
2. **Documents** — lists docs associated with this project (from `listDocs(projectId)`).
   Clicking navigates to Document mode with that doc.
3. **Gate inbox** — gates awaiting this operator's response, scoped to this project. Inline
   Approve/Reject for simple gates (same chip as home board).
4. **Activity sparkline** — 7-day run count (same approach as quiet-band sparklines, §2.3).

The dashboard derives entirely from data already fetched by the project shell:
- `runs` filtered by `project_id` (already in `useRuns()`)
- `listDocs(projectId)` (already called in Document mode — pull up to project context)
- Gate inbox from `useGateStore` filtered by project

### 4.2 Persistent project-context header in mode surfaces

When inside a mode (Build, Chat, Document, Video), a **project-context header** persists
above the mode switcher. This is a slim 32px band:

```
api-migration  ›  Build            ← "project ›  mode" breadcrumb style
```

The project name is a link back to the project dashboard (`/p/:projectId`). The `›` is a
separator rendered as `--ink-dim`. The mode name is the current mode in `--ink-high`.

This 32px band replaces the currently-absent breadcrumb. It is always visible; it does not
collapse. It answers: "where am I, and how do I get back?"

Token usage: `font: var(--weight-medium) var(--text-sm) var(--font-sans)`. Project name:
`color: var(--ink-muted)` (it is context, not the current focus). Mode name:
`color: var(--ink-high)`. Separator: `color: var(--ink-dim)`.

### 4.3 Build (and other modes) pre-bound to project

When Build is entered from a project context (`/p/:projectId/build`), the "Build something"
new-run form shows the project name pre-filled and LOCKED:

```
New build run
────────────────────────────────────────
Project     api-migration  [change ›]
Intent      [___________________________]
```

The project field is pre-filled with the current project name. A `[change ›]` inline link
allows switching project (opens the inline project switcher from §5). The user cannot
accidentally kick off a build without knowing which project it belongs to.

This applies equally to Chat (new chat thread pre-bound to project) and Document (new doc
pre-bound).

### 4.4 Settings icon moves from chrome to rail

Per §1.2, the `⚙ settings` icon in the 48px chrome is removed. The space is used for the
breadcrumb project name (when inside a project). The chrome on the home board shows only:
logo slot, product name, connection dot.

---

## 5 Create-flow defaults

**Operator:** *"Should default to unfiled but give the user the opportunity to change."*

### 5.1 The unfiled default

All three create flows (Build, Chat, Repository) default to **Unfiled** — meaning no
project binding. This preserves the user's ability to start work immediately without
choosing a project. The opportunity to bind a project is always one click away.

### 5.2 Inline project switcher

Every create flow gets a `ProjectSwitcher` field above the main intent/name input:

```
New build run
────────────────────────────────────────
Project   [Unfiled ▾]                    ← default
Intent    [___________________________]
```

Clicking `[Unfiled ▾]` opens a small dropdown (`--surface-raised`, `--shadow-raised`) with:
- A search input (`filter projects…`)
- The list of existing projects (attention-ordered, same model)
- An `+ New project` option at the bottom (triggers `NewProjectModal` from §1.3)

The selected project binds the run/chat/repo at creation time. Unfiled means no `project_id`
in the POST body — the backend default, identical to today.

**Reuse:** The `ProjectSwitcher` is a new shared component (`~80 LOC`). It is used in all
three create flows and in the "change ›" link on pre-bound mode surfaces (§4.3).

---

## 6 Chat default agents

**Operator:** *"Agents should be added by default and those chips should be clickable to
remove/add."*

### 6.1 Design constraint: zero-requests-on-mount

DES-UXFIX-001 §2.4 established that Chat mode must make zero API requests on mount (before
the user types). This prevents the phantom "is something running?" signal and is a hard
constraint, not a preference.

The operator's feedback and this constraint are reconcilable with one rule:
**chips render from the cached agent roster; the roster is never fetched on mount.**

### 6.2 The compromise

**Before first send:**
- The agent roster is populated from the crew settings cache (the same list that `agentRoster()`
  returns from the already-fetched settings on startup). If the cache is empty, a default
  set of 3 agent names is used (`writer`, `reviewer`, `planner`) — these are hardcoded
  fallbacks, not fetched.
- Chips render immediately from this cache. They look like:
  ```
  [✕ writer] [✕ reviewer] [✕ planner] [+ Add]
  ```
  Each chip: `background: var(--surface-raised); border: 1px solid rgba(255,255,255,0.08);
  color: var(--ink-body); border-radius: var(--radius-full); font-size: var(--text-xs)`.
- The `✕` removes the agent from the default set for this run only (not persisted).
- `[+ Add]` opens the agent roster picker (same as the existing "Add agents" popover).
- No request fires until the user clicks Send.

**On first send:**
- The selected agents (defaulted + any additions − any removals) are passed to the
  `openChat` request as the `agents` array.
- If the crew endpoint rejects an agent name that was in the default set (the agent no longer
  exists), the send fails with a recoverable error naming the removed agent.

**The hardcoded fallback set** (`writer`, `reviewer`, `planner`) is defined in a constant
`DEFAULT_CHAT_AGENTS` in `GroupChat.tsx`. This is the ONLY hardcoded string in the agent
layer; everything else comes from the roster cache or user action.

### 6.3 Visual anatomy of a chip

```
[✕ writer]
```

Composed of:
- A `✕` button (12×12, `background: transparent`, `color: var(--ink-dim)`, on hover
  `color: var(--ink-high)`)
- The agent name in `--text-xs --font-sans --ink-body`
- Pill shape: `border-radius: var(--radius-full); padding: 3px 8px 3px 6px`

The chip is not an "Add" affordance — it represents an agent that IS included. The `[+ Add]`
affordance is a separate element, styled differently (dashed border vs solid, `--ink-dim`
text vs `--ink-body`).

---

## 7 Immersive document and video

**Operator (Document):** *"The actual document is minimized because of all the left/right
panes. This is supposed to be interactive/immersive experience that the original at least
somewhat had."*

**Operator (Video):** *"Seems broken (and same problem as document)."*

### 7.1 The diagnosis (Document)

The current three-pane layout allocates:
- Nav rail: ~256px (left)
- Document canvas: ~640px
- Thread: ~440px

On a 1440px viewport, the canvas gets 44% of the viewport. On a 1280px viewport it drops to
38%. The wicked-interactive experience itself was full-viewport; in studio it becomes a
narrow column. The operator is right: the document is minimized.

### 7.2 The diagnosis (Video) — the broken spec route

**Root cause (verbatim from the task):** The slice-13 client invented
`GET /d/<docId>/api/demo/spec`. The interactive bridge has NO such route.

The real bridge demo surface (confirmed in `server.js`):
- `POST /api/demo/gif` — export a GIF from the recording
- `GET /api/demo/recording/:name` — stream a recording file by name (slugged)
- `GET /api/demo/player/:version` — standalone HTML player page for a version

The storyboard (chapters, player, navigation) lives in the **document version HTML** served
at `GET /doc/:version`. The bridge builds the storyboard HTML via `storyboard()` in
`demo.js` and lands it as a new version. The studio client should render this HTML in an
iframe — exactly as Document mode renders its document versions.

The `VideoStoryboard.tsx` component calls `getDemoSpec` (line 271) which hits the invented
route. This call always 404s, the component renders the spec-failure branch, and the surface
is broken.

The e2e fixture for slice 13 implemented `GET /d/:docId/api/demo/spec` as a mock, causing it
to pass. This masked the production break. A contract-check test against the REAL bridge
would have caught it.

### 7.3 The fix: canvas-first layout for both Document and Video

**Design principle:** The canvas owns the viewport. Side panes are overlays/drawers, not
columns.

**Document mode (canvas-first):**
```
1440×900 — Document mode, canvas-first

┌──────────────────────────────────────────────────────────────────────────┐
│  [logo] wicked-studio  ▸  q3-review-deck  ›  Document        ● live     │  chrome
├──────────────────────────────────────────────────────────────────────────┤
│  💬 Chat ⚙ Build ▤ [Document] ▶ Video     a deck, page, or report       │  switcher
│  ─────────────────────────────────────────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────────────────┐   │  canvas (full)
│  │                                                                  │   │
│  │           [canvas: the wicked-interactive iframe]                │   │
│  │                                                                  │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌── VERSION STRIP ───────────────────────────────────────────────────┐  │  strip (auto-hides)
│  │ ◂ v1   ● v2   v3 ▸   [Themes] [Export]         [💬 Thread →]      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
  The [💬 Thread →] button opens the thread as a right-side DRAWER.
```

**Thread drawer:** slides in from the right at `width: min(440px, 40vw)`. The canvas shrinks
`right: min(440px, 40vw)` when the drawer is open (the canvas does NOT go under the drawer —
it reflows). The drawer has a close button. State: `[threadOpen, setThreadOpen]` local to
the Document surface. Default: **closed** (the canvas is full-width on first visit).

**Version strip auto-hide:** the strip is `position: sticky; bottom: 0` inside the canvas
container. It auto-hides after 3s of no interaction (CSS `opacity: 0; pointer-events: none`)
and re-appears on mouse proximity (`mousemove` within 80px of the bottom edge, detected via
a `<div style="position:absolute;bottom:0;height:80px">` sensor). This mirrors how
wicked-interactive's own controls behave — they disappear to give the content full focus.

**Left nav rail auto-collapse:** When entering Document or Video mode, the left nav rail
collapses to its icon-only 48px state automatically. A `useEffect` in the mode surface fires
`setIsExpanded(false)` on mount. The user can re-expand it; on exit from the mode surface it
restores to the previous state.

### 7.4 Video mode corrected wire

Video mode adopts the same **iframe-in-canvas** architecture as Document mode.

**What changes:**
- `VideoStoryboard.tsx` drops the client-side player (`<video>` element, chapter scrub, spec
  loading) entirely.
- The storyboard HTML (served by the bridge at `GET /d/:demoId/doc` or
  `GET /d/:demoId/doc/:version`) is rendered in an `<iframe>` using the same `interactiveUrl`
  helper as Document mode.
- The thread slides in from the right as a drawer (identical to Document §7.3).
- A version strip (identical to Document's) sits at the bottom, driven by
  `getVersions(projectId, demoId)` — this route DOES exist (`GET /d/:demoId/api/versions`).

**What is removed:**
- `getDemoSpec` call and all spec-derived state (`steps`, `chapter`, `at`)
- `getLatestRecording` call and all recording-derived state (`rec`, `recFailure`, `player`)
- `DemoSurface`'s internal `<video>`, `MissingRecording`, and `DemoPicker` subcomponents
- The storyboard strip of chapter buttons (the storyboard HTML already has this)

**What is kept:**
- The thread store (`useDocThreadStore`) — conversations with the agent persist
- `recordFromThread` — asking the agent to re-record still works through the thread
- `submitStepFeedback` — this calls `POST /d/:demoId/api/conversation` which DOES exist
- `listDemos` / `getVersions` — both use real bridge routes

**Simplified VideoStoryboard.tsx:**
```tsx
// VideoMode: renders storyboard HTML in an iframe, same as Document.
// The bridge builds and serves the full storyboard at /d/:demoId/doc/:version.
// No spec endpoint, no client-side player — the HTML is the experience.
function DemoSurface({ projectId, demoId }) {
  const [manifest] = useLoad(() => getVersions(projectId, demoId), [projectId, demoId]);
  const [version, setVersion] = useState<number | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const v = version ?? manifest?.head ?? null;
  const src = v !== null ? interactiveDocUrl(projectId, demoId, v) : null;
  // ...
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
      <iframe src={src ?? ''} style={{ flex: 1, border: 'none' }} />
      <VersionStrip ... />
      {threadOpen && <ThreadDrawer ... onClose={() => setThreadOpen(false)} />}
    </div>
  );
}
```

`interactiveDocUrl(projectId, demoId, version)` resolves to
`${interactiveBase(projectId)}/d/${encodeURIComponent(demoId)}/doc/${version}` — a URL on
the app's own origin (proxied through crew), identical to how Document mode builds its
iframe src.

### 7.5 The contract-check leg

A new test file `e2e/interactive_wire_contract_test.py` (Playwright + Python, same harness
as the existing studio tests) runs against a **real wicked-interactive bridge instance**, not
a mock or fixture. The test lifecycle:

1. **Setup:** start a local interactive bridge on an ephemeral port (using
   `subprocess.Popen(['node', 'serve-bridge.mjs', '--root', tmpdir, '--port', str(port)])`
   from the wicked-interactive package). Wait for `GET /api/health` to return `{"ok": true}`.
2. **Create a demo doc:** `POST /api/docs` `{ name: "contract-check-demo", kind: "demo",
   url: "http://localhost:3000", brief: "check the login flow" }` → 200.
3. **Assert positive routes:**
   - `GET /d/contract-check-demo/api/versions` → 200
   - `GET /d/contract-check-demo/doc` → 200, content-type `text/html`
   - `GET /d/contract-check-demo/api/conversation` → 200
4. **Assert the invented route is absent:**
   - `GET /d/contract-check-demo/api/demo/spec` → **404** (must not be 200)
   - If this returns 200, the test fails with a clear message: "The invented spec route now
     exists on the bridge — update the studio client to use it, then remove this assertion."
5. **Assert recording routes exist (require a recording to exist first):**
   - `POST /d/contract-check-demo/api/demo/gif` → 200 or 400 (route exists, may fail if no
     recording) — the test checks status is NOT 404.
   - `GET /d/contract-check-demo/api/demo/recording/` (no file) → 404 (not route-missing 404,
     file-missing 404) — the test checks the response body is `{"error":"…"}` not `Cannot GET`.

**The invariant this enforces:** A fixture that implements `GET .../api/demo/spec` and returns
200 will cause assertion 4 to fail when the test runs against the real bridge. The fixture
cannot self-confirm the broken behavior again.

**CI gate:** This test is added to the slice-6 test suite (the immersive surface slice). It
runs in CI alongside the Playwright screenshot tests. It requires `wicked-interactive` to be
present as a sibling directory — already the case in the monorepo CI environment.

---

## 8 Slice plan

### 8.0 Inherited rules (DES-VISION-001 §6.0)

All rules carry forward unchanged:
- Each PR ≤350 LOC production diff (tests excluded from count, never from PR)
- Each PR independently mergeable and revertable
- Merge protocol: branch → open → wait 6–8 min for bots + CI → address → merge
- Every slice gated by a named screenshot at 1440×900 via `e2e/studio_standalone_test.py`
- Every slice preserves all DES-VISION-001 + DES-UXFIX-001 behaviors it touches
- Token discipline (EC15) applies — no raw hex in components

### 8.1 W2 fixture carries over

The W2 messy-reality fixture from DES-UXFIX-001 §4.2 is used unchanged. The new slices
add fixture data for:
- A project with 3 runs (active, gate, done) for §4.1 dashboard tiles
- A demo doc at `v1` with a storyboard for §7.4 video iframe test
- A repo with language breakdown data for §3.3

### 8.2 New experience-checklist items (extends DES-VISION-001 §6.1)

- **EC17 — Project context is always visible.** Any screenshot inside a mode surface shows
  the project-context header with project name and current mode. (§4.2)
- **EC18 — Canvas owns the viewport.** In Document and Video mode screenshots, the iframe
  canvas occupies >80% of the viewport width. The thread (if open) is a drawer overlay, not
  a column. (§7.3)
- **EC19 — Charts answer named questions.** Each chart in the metrics bar has a `data-question`
  attribute matching its named operator question from §2.1. (§2.1)
- **EC20 — No + glyphs in QUICK section.** The rail QUICK section has no `+` character
  rendered in any child element. (§1.2)

### 8.3 Slices

---

**Slice A — Nav restructure** *(~320 LOC)* — §1

`LeftSidebar.tsx`: remove `plus` prop from Build, Chat, Repository; add `QUICK` section
header; add `Project` as first action; add `RunsSection` component (~80 LOC — shows recent
5 runs inline below the QUICK section); move settings to `SettingsRailSection` expand/
collapse (~60 LOC). `AppChrome.tsx`: remove settings icon from 48px chrome. New
`NewProjectModal.tsx` (~100 LOC): name input, start-mode radio, create button wired to
`POST /api/v1/projects`, navigate on success. Update `ProjectSwitcher.tsx` (new shared
component, ~80 LOC) for use in §B's create-flow defaults.

*DOM AC:* `[data-testid="rail-quick"]` header text is "QUICK"; `[data-testid="new-project"]`
button is present and clicking it opens `[data-testid="new-project-modal"]`; no `+` glyph
is rendered inside `[data-testid="rail-actions"]`; `[data-testid="rail-settings-section"]`
is collapsed by default and expands on click; `[data-testid="rail-runs"]` is present and
non-empty when runs exist.
*Screenshots:* `feedback-A-rail-expanded.png` (full rail showing QUICK, runs, projects,
repos, settings collapsed), `feedback-A-new-project-modal.png` (modal open, name filled).
*Checklist:* EC20.
*UXFIX + VISION preserved:* Rail project taxonomy and repo taxonomy unchanged; AppChrome
connection dot and logo slot unchanged; attention-decay model untouched.

---

**Slice B — Create-flow defaults** *(~280 LOC)* — §5

All three create flows (Build new-run form, Chat new-thread form, Repository register form):
add `ProjectSwitcher` (from §A) as the first field, default to "Unfiled". Build pre-bind
from project context (§4.3): when entering Build via `/p/:projectId/build`, pre-fill and
lock the project field using the current `projectId`. `CenterDashboard.tsx` (Build): update
new-run form. `GroupChat.tsx` (Chat): update new-thread form. `RepositoriesPanel.tsx` (Repo
register): update register form.

*DOM AC:* In the Build new-run form, `[data-testid="project-field"]` default value is
"Unfiled"; clicking it opens a dropdown containing project names; when navigated from
`/p/:projectId/build`, the field shows the project name and has `data-locked="true"`;
`[data-testid="project-switcher-add"]` option renders in the dropdown.
*Screenshots:* `feedback-B-build-unfiled.png` (Build create form, Unfiled default),
`feedback-B-build-prebound.png` (Build form entered from project context, project locked).
*Checklist:* EC7 (preserved), EC17.
*UXFIX + VISION preserved:* Chat single-agent default (§6.2 chip logic is Slice C); Build
purpose statement; intent label requirement.

---

**Slice C — Chat default agent chips** *(~220 LOC)* — §6

`GroupChat.tsx`: replace "Add agents" opt-in with default chips from `DEFAULT_CHAT_AGENTS`
constant (3 agents). Chips render immediately from the cached roster (`getAgentRoster()` with
a cached result from startup, never fetched on mount). Each chip has a `✕` remove button.
`[+ Add]` affordance opens the existing agent roster picker.

*DOM AC:* `[data-testid="agent-chip"]` elements are present on first render without any
network request having fired; `data-count` attribute on `[data-testid="agent-chips-bar"]`
equals 3; clicking a chip's `✕` removes it (count decrements); `[data-testid="add-agent"]`
button opens the roster picker; zero `openChat` requests fire on mount (verified by
`page.on('request')`).
*Screenshots:* `feedback-C-chat-chips.png` (Chat first-run state showing 3 default chips,
no thread yet), `feedback-C-chat-chips-removed.png` (one chip removed, 2 remaining).
*Checklist:* EC7 (zero-requests-on-mount preserved), EC13 (chip text in sans).
*UXFIX + VISION preserved:* UXFIX §2.4 zero-requests-on-mount is the binding constraint;
chips satisfy it by construction (cached roster only).

---

**Slice D — Project dashboard** *(~340 LOC)* — §4

`ProjectDetailPage.tsx`: replace current "enter last mode" behavior with dashboard landing
(4 tiles: active runs, documents, gate inbox, activity sparkline). `ProjectShell.tsx`:
add 32px project-context header bar (project name → link to `/p/:projectId`, separator, mode
name). `CenterDashboard.tsx` / `GroupChat.tsx` / `DocumentCanvas.tsx`: add project-context
header injection (receives `projectId` + `mode` props, renders the header). Activity
sparkline reuses the SVG approach from §E.

*DOM AC:* `[data-testid="project-dashboard"]` is present when navigating to `/p/:projectId`
with no mode segment; it contains `[data-testid="dashboard-runs"]`, `[data-testid="dashboard-docs"]`,
`[data-testid="dashboard-gates"]`, `[data-testid="dashboard-activity"]`; inside Build mode at
`/p/:projectId/build`, `[data-testid="project-context-header"]` shows the project name and
"Build"; clicking the project name navigates to `/p/:projectId`.
*Screenshots:* `feedback-D-project-dashboard.png` (W2 fixture project dashboard with tiles
populated), `feedback-D-build-with-header.png` (Build mode showing project-context header).
*Checklist:* EC17.
*UXFIX + VISION preserved:* All mode surfaces functional; Build purpose statement still
present below the project-context header.

---

**Slice E — Home metrics bar + repo visual** *(~340 LOC)* — §2, §3

`HomeBoard.tsx`: add 64px metrics bar with three tile components. New `RunOutcomeBar.tsx`
(~60 LOC, SVG-first), `GateLatencyChart.tsx` (~60 LOC, SVG scatter), `TokenBurnSparkline.tsx`
(~60 LOC, SVG area). Quiet-band project rows: add 7-day sparkline via new
`ProjectSparkline.tsx` (~40 LOC). `RepoDetailPage.tsx`: add `LanguageBar.tsx` (§3.3, ~60
LOC), inline `HotspotsView` excerpt (top 5 files, reuse existing component). Commit cadence
sparkline added to `RepoDetailPage.tsx` (~40 LOC, SVG-first, same approach).

*DOM AC:* `[data-testid="metrics-bar"]` is present on the home board; it contains
`[data-testid="run-outcome-bar"]`, `[data-testid="gate-latency-chart"]`,
`[data-testid="token-burn-sparkline"]` — each has a `data-question` attribute matching its
named question from §2.1; no `<script>` tags for chart libraries are in the page HTML; a
`getComputedStyle` check confirms all `fill` and `stroke` attributes on chart elements
resolve from `var()` references (EC15); `[data-testid="language-bar"]` is present on the
repo profile page.
*Screenshots:* `feedback-E-home-metrics.png` (home board with W2 fixture, metrics bar
visible with real data), `feedback-E-repo-profile.png` (repo profile showing language bar,
commit sparkline, hotspot excerpt).
*Checklist:* EC11 (information is the aesthetic), EC15, EC19.
*UXFIX + VISION preserved:* Wall and live feed unchanged; board attention model untouched.

---

**Slice F — Immersive Document + Video + contract check** *(~350 LOC)* — §7

`DocumentCanvas.tsx`: canvas-first layout (thread becomes right drawer with open/close
control); version strip auto-hide (CSS opacity + bottom-proximity sensor). `LeftSidebar.tsx`:
auto-collapse to 48px icons when entering Document or Video mode (useEffect in mode surfaces
calls `setIsExpanded(false)` via a context or prop). `VideoStoryboard.tsx`: rewrite
`DemoSurface` to iframe-in-canvas (drop `getDemoSpec`, `getLatestRecording`, client player;
use `interactiveDocUrl(projectId, demoId, version)` as iframe src). `interactive.ts`: remove
`getDemoSpec` export; remove `getLatestRecording` export (both were calling invented routes);
keep `getVersions`, `listDemos`, `requestRecord`, `submitStepFeedback` (all use real routes).
New `e2e/interactive_wire_contract_test.py` (~80 LOC): contract-check against real bridge
(§7.5).

*DOM AC:* `[data-testid="document-canvas"]` iframe occupies >80% of viewport width when
thread is closed (measured via `getBoundingClientRect()`); clicking `[data-testid="thread-toggle"]`
opens the drawer and the canvas reflows; auto-hide: after 3s without mousemove,
`[data-testid="version-strip"]` has `opacity: 0`; `[data-testid="demo-player"]` is an
`<iframe>` (not a `<video>`); `getDemoSpec` is not imported anywhere in `src/` (grep asserts
absence); the contract-check test: `GET /d/contract-check-demo/api/demo/spec` returns 404
against the real bridge.
*Screenshots:* `feedback-F-document-immersive.png` (Document mode, canvas full-width, no
thread visible, strip auto-hidden), `feedback-F-document-thread-open.png` (thread drawer
open at 440px, canvas reflowed), `feedback-F-video-iframe.png` (Video mode showing storyboard
HTML in iframe with chapters visible).
*Checklist:* EC18 (canvas >80% viewport width).
*UXFIX + VISION preserved:* Version strip functionality (version navigation, Themes, Export);
Document three-pane relationship preserved when thread is open (just as a drawer); narration
rules for Video; ffmpeg-missing state still actionable (the storyboard HTML handles it on the
bridge side).

### 8.4 Sequencing

```
Slices A, B, C: independent of each other; can run in parallel after slices 1–5 of
              DES-VISION-001 are merged (they extend the existing token-based components).

Slice B depends on slice A: ProjectSwitcher (created in A) is used in B.
  → A → B

Slice D: depends on A (project-context header uses the rail-collapse context established in A).
  → A → D

Slices E, F: independent of each other and of B/C/D; can run in parallel.

Full order if serialized: A → B → C (can overlap) → D → E → F

Hard dependency chain: A must land before B, D. Everything else is parallel.
```

**Done means:** all six slices merged; every named screenshot captured at 1440×900 and
passing its checklist items; contract-check test (`interactive_wire_contract_test.py`) green;
the walkthrough W1–W5 from DES-VISION-001 re-run confirming no regression; plus W6:
**Operator navigates a project** — from home board → click project card → lands on project
dashboard → enters Build → sees project-context header → creates a run pre-bound to the
project → run appears on dashboard tile.

---

## 9 Out of scope (named)

- **Full re-skin of Document mode canvas interaction.** The fix restores the canvas to
  full-width. The deeper redesign of how thread messages map to document elements (annotations,
  commenting on specific text) is not specified here — that is a Document interaction design
  arc of its own.

- **Analytics page / billing dashboard.** The metrics bar on home (§2) is an operator
  glance surface. A full analytics view (historical charts, per-project cost breakdowns,
  export) is explicitly out of scope.

- **Real-time chart streaming.** The metrics bar charts derive from the existing `runs`
  list and event store, which update via WebSocket. The charts themselves re-render on store
  change but there is no continuous d3-force-style animation — charts update when data
  changes, not on a timer.

- **Project archive / delete.** The project dashboard (§4.1) shows project state; project
  management actions (rename, archive, transfer) are out of scope.

- **Video mode: thumbnail scrub bar.** The bridge-generated storyboard HTML has its own
  chapter navigation UI. The studio does not add a second chapter UI on top of the iframe.
  This is intentional: duplicating chapter navigation at two layers creates inconsistency.
  If the operator wants a different chapter design, that belongs in wicked-interactive's
  storyboard template.

- **Demo SSRF fix for the contract-check test.** The contract-check test creates a demo
  with `url: "http://localhost:3000"`. In a CI environment where port 3000 is not running,
  the demo will fail to record (the bridge will error when Playwright tries to navigate
  there). The contract check only tests route existence, not recording success — the test
  passes regardless of whether the demo records.

- **Light-theme full QA pass for new surfaces.** Light theme is a theme instance (DES-
  VISION-001 §2.14); each new surface should function in light mode via token inheritance,
  but a full design review pass for light theme is a follow-on.

- **DES-VISION-001 slices 6–8 (bulk token conversion, customization UI, brand-learn).**
  This document does not alter those slices; they proceed in parallel.

- **Agent management UI.** The chat default agents use a `DEFAULT_CHAT_AGENTS` constant
  (§6.2). A full agent-roster configuration UI (where the operator can change the default
  set permanently) is not in scope here — it belongs to a settings design arc.
