# wicked-studio

> [![npm](https://img.shields.io/npm/v/wicked-studio)](https://www.npmjs.com/package/wicked-studio) · [![CI](https://github.com/mikeparcewski/wicked-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/mikeparcewski/wicked-studio/actions/workflows/ci.yml) · [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**The ADE (agentic development environment) for running a team of coding agents.** *Your coding
agents do the work. A different agent checks it against your rules. You get the evidence.* By
default a different agent reviews the work. When none can, the job stops unless you launch it as
"reduced assurance", which is labelled on the job, every gate and the delivery. A saved workflow may
require fewer checks; its requirements are listed in the receipts.

wicked-studio is the browser app where you run Claude Code, Codex, GitHub Copilot, OpenCode and Pi
as a team. Start a job with a chat: it proposes a plan, and once you confirm it the agents work in
sandboxes while you watch. With whisper.cpp installed, you can ask questions out loud and steer jobs
already running, each instruction confirmed on screen first. Gate decisions come to you as one
card, and each job's evidence is a click away. Learn suggests rules and memories from how your team
works, for you to accept, and jobs can propose what they learned for your approval.
**Apps** turns your databases, files and APIs into dashboards you build by chat, each **data source**
says exactly what agents may read from it, and **Linked trackers** ties GitHub Issues and Jira
projects to your projects and repositories.
The [wicked-crew](https://github.com/mikeparcewski/wicked-crew) daemon runs the jobs and bundles studio.

---

## Why you'd want it

Coding agents are fast but unsupervised — they assert "done," grade their own work, and bury the
reasoning in a scrollback you'll never read. wicked-studio flips that:

- **Pick the job, or talk it through.** **New job** opens a catalog of workflows: search it in your
  own words ("write docs for the auth service"), filter by category or by whether it needs a
  repository, and your most-used ones are on top. Each workflow asks only for what it needs. Not sure
  yet? **Talk it through first**: describe what you want, the chat proposes a plan, and nothing starts
  until you confirm it. (Tick "Don't show this again" to go straight to chat next time.) A
  composer's `/` menu lists the same catalog, with the same entries, names and order; a pick starts
  what its New job card starts.
- **Sign your agents in once.** The **Agents** page signs each agent in: Claude Code and GitHub
  Copilot through a login container; Codex, Pi and OpenCode with their host CLIs and a temporary
  home (wicked-core `src/seat_login.rs`). Jobs run every agent in a hardened sandbox (crew needs a
  container runtime: Rancher Desktop, Docker, Podman, Colima or OrbStack). Credentials stay in a broker and the sandbox sees placeholders,
  except a Claude Code seat on a Claude subscription, which receives its sign-in token (if a step writes it
  into the work, the step fails and its delivery is blocked).
- **Rules and memory, kept apart.** **Steering** holds your rules, each with an explicit reach
  (every repository or one project; a rule can also target a language, a layer or a framework).
  **Memory** is its own page: what happened and what you told
  it, with your own memories applying across projects. Agents suggest both; you approve. A finished
  job says what it learned ("3 learnings proposed · 2 waiting for you"), and each proposal in
  Memory's queue names the job it came from.
- **Teach it how you work.** **Learn** (at the foot of the sidebar, above Build & settings) reads
  your team docs, showcase repos and writing into suggested rules and memories, offers starter
  rules, sets the orchestrator's **Personality** (tone only; never rigor, gates or checks; one for
  you, overridable per project) and learns your brand colours. Suggested rules and memories become active only when you accept
  them (the sources you supply and the pending suggestions are stored so you can review them).
- **Direct, don't babysit.** Launch runs across many repos and projects at once, then let them
  work. Attention comes to *you* when a run hits a gate — you don't sit watching one terminal.
- **Approve what matters.** Human-in-the-loop gates surface the real decisions as one guided card:
  every choice the gate offers, the recommended one marked when there is one and, when supplied,
  what each choice would do, then one button and a 10 s undo. Keyboard batch triage helps when several pile up.
- **"Done" is proven, not claimed — and the gate says how.** By default a run requires a distinct
  evaluator and a judge: review goes to a seat other than the creator's. When no such seat exists, the
  run stops at a gate that says why. You can then sign a second seat in, or relaunch with **reduced
  assurance**, an explicit opt-in that the launch form and composer also offer on a one-seat roster.
  A reduced run is labelled "Reduced assurance" on the session, every gate and the delivery. A team run
  never grades on its creator's seat. A required judge that could not run holds its gate as "Waiting
  for a judge seat"; it is not a rejection. A gate row or delivery whose evaluation the engine
  recorded one for (wicked-core-ts 0.7.46 and later) shows the run's **assurance receipt**:
  - what the run required and what actually ran;
  - who built, evaluated and judged the work, and whether those were separate seats;
  - what was skipped and why;
  - the tree and the attempt.

  So "Floor-only approval" reads differently from "Independently accepted". A post-hoc hand-over
  that nothing re-verified is labelled "Unverified delivery", along with whether its tree moved, and
  the delivery shows the QE acceptance check when the run requires one.

  A built-in workflow that changes the application (`feature`, `bug`, `migration`, `mcp-server`,
  `editor-plugin`) requires QE acceptance before it delivers. The session header, every gate and the delivery say where that
  stands: "QE acceptance: required", "waived (score N)" when the run's change scored in the lowest
  band on every dimension, or "skipped by operator (reason)". The launch form offers **Skip QE
  acceptance**, which needs a reason before it can be sent, and **Force QE acceptance**, which keeps
  it required even when the score would waive it (wicked-core-ts 0.7.49 and later). Every run leaves
  transcripts, diffs, and a downloadable evidence bundle. Studio shows you the gate outcomes; it never
  grades the work itself.
- **Understand the code first.** Onboard a repo and studio builds its graph — then blast-radius
  for any symbol, hotspots, a searchable map of what calls what, and the requirements view. Ask
  **Understand** a question and it runs a read-only analysis over the repositories you choose, with
  a cited answer.

## What you can do

- **Run governed agents on your repos** — register a local path or clone a URL; studio builds the
  code graph, then you launch runs (ask / balanced / autonomous), pick which agent seats join, and
  bind a repo with optional PR delivery. On a crew with **power mode**, it is on by default when you
  launch a preset or a composed plan on a repository, unless Settings says otherwise (a switch on
  New job and beside the job's name); a chat's own run and a phase-based workflow run phased. The
  code-writing build step then runs as one orchestrator's checkpointed turns (other required steps
  can run separately): the job page shows its rigor (with ↑ when it rose since intake), its
  checkpoints, and, when the change grows past its plan, a pause that offers to split it into lanes,
  switch to phased, continue at high rigor or stop.
- **Steer runs live** — the Desk (the one shell) puts what needs you first; every run or chat
  opens as a **session** (`/s/:id`): one thread with the live record, gate cards you answer in place,
  elicitation prompts, pre-gate guidance notes, and lifecycle controls (cancel, inject a message,
  retry). While a step works, the thread lists what it is doing (tool calls, edits, the seat's
  meter) and folds to one summary line when it ends; every message shows when it was said, when that
  was recorded. A step that runs long offers **Check on it?**: an eligible seat that is not the
  step's own reads its record and recommends letting it run, steering or stopping; when none can
  run or finish, crew gives its own reading, labelled as such. Neither acts on any of it. The job's Details panel
  holds a **Phase report** (a plugin section; one per phase in a power build, one for the whole job
  otherwise), and the thread keeps one slim row per update with "Show in Details". The pre-session addresses (`/runs/:id`, `/work`, `/p/:id/…`,
  `/chat/…`) were retired and show the not-found page.
- **See the evidence** — per-step transcripts, a worktree file + diff viewer, and one-click
  evidence-bundle download for any run.
- **Explore your codebase** — graph view with focus navigation, blast radius, hotspots, and the
  domain graph.
- **See how much of the code is mapped to requirements** — Repositories → a repo → Requirements
  heads the list with "80% real requirements · minimum 80%" and its parts (real, placeholders,
  unmapped, not product code). A placeholder is never counted toward the share and never shows as
  validated; a real one with corroboration data carries **validated** (with its count of
  independent sources) or **unconfirmed** with why (rows from an older build, or outside the
  count, may carry no verdict). A row the share does not count (a type shape, code that is not
  product code, or a file the code index skipped) carries a **not counted** mark with why, and a line
  under the coverage says how many stated rules and placeholders sit on type shapes. The Config &
  data filter is hidden when crew reports no config and data rows. When the list is an older graph build than the header's numbers, it says
  so. A repo with no requirements graph yet offers **Generate it** (or **Keep mapping** once some real
  requirements are mapped), which opens New job filled in with the generating workflow; while a mapping job
  runs, the view shows its progress with **Open the job** instead. The minimum is a setting (Settings → General → Code graph,
  default 80%).
- **Plan the product** — a project's page has a Requirements section (its count across the
  project's repositories) and a full list at `/projects/:id/requirements`, grouped by repo and
  searchable. Choose up to 40 requirements and **Draft epics** opens New job on the Draft epics
  workflow with them. The old Product address (`/product?project=<id>`) opens that project's page
  at its Requirements section. Publishing the drafted epics is not offered yet.
- **Ask several seats at once** — a chat can hold more than one warm CLI seat; each answers in the
  thread, and the daemon checks every path, `path:line` and commit a reply cites against the repo.
- **Govern the work** — author steering rules and policies (or import a markdown rule doc; a
  refused entry shows crew's reason), browse the decisions ledger, and review what the platform has
  learned about your repos. **Evaluate** runs your rules against example behaviours: it recommends
  what to run and why, takes your own behaviours (a file, a pasted transcript, or past jobs' steps),
  and lists every past run with what it caught, what slipped through and its false alarms, plus
  **Analyze this run**.
- **Chat with any page** — the icon beside the title of Report, Nerve Center, Evaluate, Steering,
  Memory, Learn, Agents, Repositories and Jobs opens that page's own chat, drawn in the page with the
  page's data; on Understand, the question box is the chat. Click a number or chart on Report to ask about it.
- **Talk to it** — when crew has voice, a mic sits beside Send in every composer (and beside Start on
  Home); ⌥V opens voice mode from anywhere. Speech is transcribed by crew on your machine
  (whisper.cpp; the model downloads only when you say so). Ask questions, say "show me this job" for
  a live tile, or "tell it to …" to steer, stop, raise rigor or answer its decision; every action is
  confirmed on screen before it is sent, and the thread marks it "You (by voice)". The voice
  dashboard's widgets can be removed, added and made from any system number.
- **Work in projects** — group repos, runs, chats, and docs; "See everything" (`/everything`) lists
  them, filterable by project, and a project's page is `/projects/:id`; deep-linkable routes
  throughout.
- **Make it yours** — three themes (Wicked Light, Wicked Dark, and **Ambient**, a quiet
  mood on your chosen ground that follows the work: a tint while jobs run, warm when something needs
  you, red when something failed). Text is set in Wicked Sans; the plugins page shows every plugin
  as a card (job-detail sections and editors) with what it may do.
- **Find your way** — the sidebar groups the pages under **Work** (Projects, Jobs, Apps,
  Repositories, Data sources), **Insight** (Report, Understand, Evaluate) and **Govern** (Steering,
  Memory, Agents), with Learn and **Build & settings** (Skills, MCP, Plugins, Workflows, Data
  sources, Settings) at its foot. Each heading folds, and the rail folds to its icons; this browser
  remembers both.
- **Plus** governed terminals, a Cmd+K command palette, document & video creation modes, and
  desktop notifications when a run needs you.

### Apps and data *(with wicked-crew 0.17.0)*

- **Build apps by chat** — **Apps** (under Work) is a dashboard of your apps: each card shows its
  first page's headline numbers live, read only while the card is on screen. An app's page has its
  chat beside it, in one side panel with **Chat** and **Properties** tabs that folds to a rail. Each
  message is one job: an agent builds the change, crew checks it, a different agent reviews it, and
  the reply gives the change line ("v4 · Added 1 chart and 1 query · reviewed by Codex") with Undo,
  or why nothing landed. **Make a new app by chat** starts one from `/apps`. In Edit you can also
  drag, resize and retitle in place (double-click a title or label); changes save as versions as you
  make them, with Undo and Redo.
- **Dashboards on Report** — turn on **Show on Report** in an app's Properties or in its card's ⋯
  menu, and its live numbers show on its project's Report and on Insight → Report, up to four at a
  time. **Build a dashboard** on Report starts a new app by chat, switched on for Report.
  Report's own chat never reads the dashboards' numbers.
- **Connect your data** — **Data sources** adds Postgres, MySQL, REST (OpenAPI), GraphQL, MCP
  servers and uploads (CSV, XLSX, SQLite; crew must run on Node.js 24.12, 25.1 or later to take an
  upload). The secret you type is sent only with the preview and
  clears after Save. **Test connection** (SQL and GraphQL sources; REST and MCP keep Test call) says
  how long it took, the TLS state and, for Postgres, whether the login is read-only. On a SQL source,
  **Ask a question of this data** has one agent draft one read query from the structure alone; crew
  checks it, nothing runs until you click Run, and the rows (at most 50) are shown to you only. **Allow writes** (Postgres, off by default) lets an app's row write be granted,
  after crew's table safety check.
- **Decide what agents can read** — a SQL source's **Agents** box: **Agents can see this structure**
  (on), **Agents can query this source** (off, Postgres only; the rows go to the agent's model
  provider, so turning it on asks you to confirm), and the projects whose jobs and chats may use it
  (none until you tick one). Ask, which you start yourself, gives its one agent the structure either way.
  It lists the source's recent agent queries, never the SQL. A job's gate cards and its delivery say
  which sources its agents read ("Agents read data: support-pg · 3 queries · 12 rows"), or "not
  known", never "none".
- **Link your trackers** — register GitHub Issues or Jira on Data sources, then link trackers on a
  project's **Linked trackers** card or on a repository's page: one or several, from one tool or
  more. A job or chat in a project sees its project's trackers and its repositories' trackers, under
  the source's Agents box. Start a job from an issue, and its pull request names the issues it
  closes.
- **See your knowledge** — Understand's **Knowledge map** draws your data sources and their tables
  beside your repositories and code, with the approved data shapes (what joins what, and which code
  describes a table) and the tracker links. **Profile this source** on a Postgres source's sheet
  finds shapes from counts alone, never a value, and each one waits on the map for your Approve or
  Reject.

These need wicked-crew 0.17.0 or later, which bundles this release. Against an older daemon studio
hides most of them or says the daemon doesn't offer them; Apps shows two sample apps, marked as samples,
and the Knowledge map says it couldn't load.

---

## Get started

Studio ships **inside** wicked-crew — one command gives you the API, the engine, and this UI on a
single port:

```sh
npx wicked-crew serve
# then open the URL it prints (default http://127.0.0.1:7701)
```

That's the whole install for most people — no separate studio setup. Prefer a guided setup, or
want the rest of the wicked family too? Use the installer:

```sh
npx wicked-installer
```

It installs and wires wicked-crew (which serves this UI) alongside the other wicked-\* tools,
across whichever coding-agent CLIs you already use.

## Keeping it up to date

Studio rides along with crew, so you update it by updating crew:

```sh
npm i -g wicked-crew@latest    # or: npx wicked-installer  (updates the whole family)
```

Each wicked-crew release bundles the matching studio build, so a fresh crew is a fresh UI. To see
what changed, check the [releases](https://github.com/mikeparcewski/wicked-crew/releases).

## Requirements

- **Node.js ≥ 22**, npm ≥ 10 (uploading a file as a data source needs crew on Node.js 24.12, 25.1 or
  later)
- A running **wicked-crew daemon, v0.7.0+** (bundled and started for you by `npx wicked-crew serve`
  — you only need this floor if you point a standalone studio at your own daemon). Apps, Data
  sources, the Agents box, Linked trackers, the Knowledge map and dashboards on Report need
  **wicked-crew 0.17.0** or later (see [Apps and data](#apps-and-data-with-wicked-crew-0170) for what an
older daemon shows).
- A modern browser — Chrome, Edge, or Firefox on macOS, Linux, or Windows (or Safari on macOS)

---

## For developers

Studio is a Vite/React SPA and a *pure HTTP/WS client* of the wicked-crew daemon — it talks only to
crew's published `/api/v1` REST surface and `/ws` event stream, and imports **zero** crew source.
The one thing the two share is the wire-contract package
[`wicked-crew-api-types`](https://github.com/mikeparcewski/wicked-crew/tree/main/packages/crew-api-types).

```
┌─────────────────┐     HTTP /api/v1 + WS /ws    ┌────────────────────┐
│  wicked-studio  │ ───────────────────────────▶ │ wicked-crew daemon │
│   (React SPA)   │ ◀─────────────────────────── │  API · engine ·    │
│                 │   contract: wicked-crew-api-types │  gates · evidence │
└─────────────────┘                              └────────────────────┘
```

### Develop

```sh
npx wicked-crew serve          # a control plane on :7701 for the SPA to talk to
npm install
npm run dev                    # vite on http://127.0.0.1:4200, pointed at :7701
```

`npm test` (vitest + testing-library), `npm run typecheck`, `npm run lint`, `npm run build`
(tsc + vite → `dist/`). CI runs all four on ubuntu for every PR, and the e2e journeys in two shards.

### Standalone build

You can build studio and host it yourself, pointed at any reachable daemon:

```sh
VITE_API_HOST=127.0.0.1:7701 npm run build
npx serve dist                 # any static server with SPA fallback works
```

The SPA finds its daemon two ways: **bundled/same-origin** (production) calls back to
`window.location.origin`, so `--port` / `CREW_PORT` just work with no host baked in; **standalone**
uses `VITE_API_HOST` (host:port, no scheme) fixed at build time. The daemon's loopback CORS admits
any `localhost` / `127.0.0.1` origin, so a standalone studio drives a local daemon out of the box.
`e2e/studio_standalone_test.py` is the scripted proof of this mode.

### Plugins

Artifact editors are plugins: one self-contained HTML file per editor, run in a sandboxed frame with no network
and talking to studio's plugin host over one MessagePort (the `wicked.editor` envelope, protocols 1 to 3,
`src/editors/`). A **run plugin** uses the same sandbox on protocol 3: the host sends it the job's events on the
topics it was granted (`events.batch`), and it draws a section of the job's Details panel; the built-in Phase
report is one. The **Plugins** page (`/plugins`, under Build & settings) shows every plugin as a card with what
it hears and may do, and links to the **editor test page** (`/editors/dev`), which opens an editor in the real
host over a sample page. **Create a plugin** opens New job on the `editor-plugin` workflow. That workflow
scaffolds the editor with the `wicked-garden-editor-scaffold` skill, runs its conformance cases, and installs it
after a consent gate. It also opens a pull request. `/editors/conformance` is the conformance host that `e2e/editor_conformance_test.py` drives
in CI; it has no nav or ⌘K entry.

### How crew ships this UI

The npm package publishes `dist/` only. wicked-crew declares `wicked-studio` as a devDependency and
its `build:with-studio` step copies `node_modules/wicked-studio/dist` into the daemon's serving
tree, so `npx wicked-crew serve` is same-origin UI + API on one port (with a headless fallback when
the dist is absent). A studio release therefore also bumps crew's devDep pin.

The repo also carries a `data-testid` selector contract (`testid-inventory.json`, regenerated with
`npm run manifest:testids` and drift-checked in CI) that the test generators build against — see
[`CLAUDE.md`](./CLAUDE.md) for the full contributor doctrine.

### Contributing

1. Fork and branch.
2. `npm install && npm run dev` — SPA on `:4200`, daemon on `:7701`.
3. `npm test && npm run typecheck && npm run lint` before committing.
4. Open a PR; CI runs the four gates and the e2e journeys.

Keep the wire-contract boundary intact: all crew interaction goes through `/api/v1` and `/ws`, never
a crew-source import — if a type is missing, it lands in `wicked-crew-api-types` first.

### Provenance

Studio was extracted from the wicked-crew monorepo (`packages/studio`) as its own product,
preserving the full in-monorepo history via `git subtree split`. An earlier, pre-consolidation
incarnation is archived read-only at
[wicked-studio-archived](https://github.com/mikeparcewski/wicked-studio-archived).

## License

MIT
