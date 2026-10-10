# wicked-studio

> [![npm](https://img.shields.io/npm/v/wicked-studio)](https://www.npmjs.com/package/wicked-studio) · [![CI](https://github.com/mikeparcewski/wicked-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/mikeparcewski/wicked-studio/actions/workflows/ci.yml) · [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**The cockpit for AI coding agents you can actually trust.** wicked-studio is a browser UI for
running coding-agent CLIs (Claude Code, Codex, Antigravity, and more) as *governed* workers:
you give an intent, the agents do the work behind verification gates, and you approve the
decisions that matter — with the evidence behind every "done" one click away.

It's the human surface of the [wicked](https://github.com/mikeparcewski/wicked-crew) platform.
The agents run headless in the background; studio is where you point them at your repos, watch
them work in real time, unblock them when they need a human, and see what actually happened.

---

## Why you'd want it

Coding agents are fast but unsupervised — they assert "done," grade their own work, and bury the
reasoning in a scrollback you'll never read. wicked-studio flips that:

- **Direct, don't babysit.** Launch runs across many repos and projects at once, then let them
  work. Attention comes to *you* when a run hits a gate — you don't sit watching one terminal.
- **Approve what matters.** Human-in-the-loop gates surface the real decisions (approve, approve
  with a steer, or reject) — with keyboard batch triage when several pile up.
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
  the delivery shows the QE acceptance check when the run requires one. Every run leaves
  transcripts, diffs, and a downloadable evidence bundle. Studio shows you the gate outcomes; it never
  grades the work itself.
- **Understand the code first.** Onboard a repo and studio builds its graph — then blast-radius
  for any symbol, hotspots, the domain/requirements view, and a searchable map of what calls what.

## What you can do

- **Run governed agents on your repos** — register a local path or clone a URL; studio builds the
  code graph, then you launch runs (ask / balanced / autonomous), pick which agent seats join, and
  bind a repo with optional PR delivery.
- **Steer runs live** — the Desk (the one shell) puts what needs you first; every run or chat
  opens as a **session** (`/s/:id`): one thread with the live record, gate rows you answer in place
  (approve / steer / reject), elicitation prompts, pre-gate guidance notes, and lifecycle controls
  (cancel, inject a message, retry). Old `/runs/:id` links redirect to the session.
- **See the evidence** — per-step transcripts, a worktree file + diff viewer, and one-click
  evidence-bundle download for any run.
- **Explore your codebase** — graph view with focus navigation, blast radius, hotspots, and the
  domain graph with coverage.
- **Plan the product** — the **Product** view (rail → Product, `/product?project=<id>`) answers
  "what are we building" where the Desk answers "what is executing". It lists a project's
  requirements across every one of its repositories, grouped by repo and searchable; a repo that
  could not be read is named with the reason. Choose up to 40 requirements and an optional steer,
  and **Draft epics** launches a governed draft → review → approve run that opens in its session;
  its plan and gate are answered there. Coverage and the domain model stay on the project page.
  Publishing the drafted epics is not offered yet.
- **Ask several seats at once** — a chat can hold more than one warm CLI seat; each answers in the
  thread, and the daemon checks every path, `path:line` and commit a reply cites against the repo.
- **Govern the work** — author steering rules and policies, browse the decisions ledger, and review
  what the platform has learned about your repos.
- **Work in projects** — group repos, runs, chats, and docs; "See everything" (`/everything`) lists
  them, filterable by project, and a project's address (`/p/:id`) opens its scoped Sessions list;
  deep-linkable
  routes throughout.
- **Plus** governed terminals, a Cmd+K command palette, document & video creation modes, and
  desktop notifications when a run needs you.

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

- **Node.js ≥ 22**, npm ≥ 10
- A running **wicked-crew daemon, v0.7.0+** (bundled and started for you by `npx wicked-crew serve`
  — you only need this floor if you point a standalone studio at your own daemon)
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
(tsc + vite → `dist/`). CI runs all four on ubuntu / macos / windows for every PR.

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
4. Open a PR; CI runs all four gates on ubuntu / macos / windows.

Keep the wire-contract boundary intact: all crew interaction goes through `/api/v1` and `/ws`, never
a crew-source import — if a type is missing, it lands in `wicked-crew-api-types` first.

### Provenance

Studio was extracted from the wicked-crew monorepo (`packages/studio`) as its own product,
preserving the full in-monorepo history via `git subtree split`. An earlier, pre-consolidation
incarnation is archived read-only at
[wicked-studio-archived](https://github.com/mikeparcewski/wicked-studio-archived).

## License

MIT
