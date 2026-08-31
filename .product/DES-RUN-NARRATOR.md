# DES-RUN-NARRATOR — one narrated feed for following a run

**Status:** implemented (feat/run-narrator)
**Scope:** the run-follow surface (`ChatPanel.tsx` → `RunChat`), the run-detail feed
composition, and the composer-on-terminal-runs ambiguity (usability review 2026-08-31,
finding #8; run-operator persona findings).
**Out of scope:** WorkPage list, SteeringPage, TestingPage, the decisions rail (lane L1),
and GroupChat's multi-seat chat (its transcript is already turn-stamped and per-seat FIFO;
nothing here touches it — the mandate is that it must not GROW, and it does not change).

## 1. The problem (verbatim intent)

> "Build chat is confusing — chats are out of order, hard to follow along whats happening.
> I'm thinking for the interface we have an assistant that is watching everything and
> providing status updates (except approvals which need to go direct to user). This includes
> any artifacts created along the way. Interface needs to be clean and easy to follow/interact
> (e.g. how am I supposed to know what to steer if work is being done on part of chat thats
> offscreen or above)."

What the pre-narrator run page actually did, and why it reads out of order:

1. **The thread was three appended sections, not one stream.** `RunChat` rendered
   (a) every unit block from `timeline.flatMap(...)`, then (b) ALL system-event pills
   from the runtime log, then (c) the gate card in a fallback slot at the very bottom.
   A gate decided at 12:02 rendered *below* a unit that finished at 12:20 — the literal
   "chats are out of order" complaint.
2. **The event store dropped history on a race.** `useRunEventStore.hydrate` was
   all-or-nothing: if ONE live `/ws` frame arrived before `GET /runs/:id/events`
   resolved, the entire backfill was discarded and the feed began mid-story.
3. **The thing to steer could be offscreen.** The gate card lived inside the scrolling
   thread; live output above it kept growing, so the approval was routinely above or
   below the viewport exactly when it needed a decision.
4. **Terminal runs wore the launch composer.** `ChatInput` with `runId=null` renders the
   full "What do you need built?" form — Gate chip, project switcher, mode toggle — on a
   dead run's page (review #8: "unclear if it steers this run or starts a new one").

## 2. The concept

A deterministic **narrator** — a pure template layer, **no LLM call** — watches the run's
CoreEvent trail and speaks one short human line per meaningful event. The run page becomes:

```
┌────────────────────────────────────────────────────────┐
│ header (back · status dot · title · retry · mode · …)  │  shrink-0
│ RunTimes · ProcessStepper (the map — unchanged)        │  shrink-0
│ NOW-BAR: ▶ build — unit 2/6 · "Worker started…" · 📎3  │  shrink-0, always visible
├────────────────────────────────────────────────────────┤
│ NARRATED FEED (the only scrolling region)              │  flex-1
│   you: <intent bubble>                                 │
│   · Run started                                        │
│   · Workflow "feature" — 6 phases planned              │
│   · Council picked claude for clarify (100%, 4 votes)  │
│   · Worker started clarify                             │
│   ┌ clarify — done ─ [▸ show output] ┐   ← unit group  │
│   · Checks passed — clarify approved                   │
│   · 📄 src/retry.ts · 📄 tests/retry.test.ts (touched) │  ← artifact cards
│   · Gate: waiting on you — "Approve the design phase?" │  ← the gate MOMENT (inline)
├────────────────────────────────────────────────────────┤
│ APPROVAL DOCK (pinned — never scrolls away)            │  shrink-0
│   [SteeringGate: approve / approve+steer / reject+note]│
├────────────────────────────────────────────────────────┤
│ composer: steer/inject (live) · follow-up bar (dead)   │  shrink-0
└────────────────────────────────────────────────────────┘
```

- The **feed** is the single chronological stream: narration lines, unit output groups,
  artifact cards, gate moments — one order, fixed at the source.
- The **now-bar** answers "what is happening RIGHT NOW" from any scroll position:
  run state, the active phase, the latest narration line, an artifact-count chip, and a
  "Latest ↓" jump that scrolls the feed to its live tail. It sits outside the scroll
  region, so it is visible by construction.
- The **approval dock** is where anything awaiting the human lives: the steering gate
  and MCP elicitations render as pinned cards between the feed and the composer. They
  can NEVER scroll away. The feed still records the gate moment inline (that is history);
  the dock is the action surface (that is now).
- **At 1440×700** the now-bar, the dock and the feed's latest line are all visible with
  zero scrolling: header + times + stepper + now-bar ≈ 190px, dock ≈ 300px, composer ≈ 90px,
  leaving ≈ 120px of feed pinned to its tail.

Approvals deliberately do NOT become narrator speech — per the directive, they go
direct to the user (the dock); the narrator only *records* that they happened.

## 3. Ordering — fixed at the source

Two changes kill the out-of-order class:

1. **`useRunEventStore.hydrate` now MERGES instead of dropping.** The durable trail
   (`GET /runs/:id/events`, every frame carrying the run-wide `seq`) is the authoritative
   prefix; live frames that arrived before the fetch resolved are de-duplicated against it
   by content fingerprint (the frame minus `ts`/`seq`, which only the recorded copy carries)
   and the remainder is appended in arrival order. Result: `[recorded by seq] + [live tail
   in arrival order]` — complete history, one order, for every consumer (feed, RunTimeline,
   useRunModel alike).
2. **`buildFeed` sorts defensively.** Frames that both carry the durable `seq` compare by
   it; everything else keeps stable input order (live frames have no comparable clock —
   arrival IS their order, per the wire contract). Out-of-order backfill arrival therefore
   renders sorted, and live ordering is never scrambled by a fabricated key.

## 4. The narrator — event → narration mapping

`narrate(event, ctx)` in `src/components/narrator.ts`. `ctx` resolves ords to phase
names (`unitKey` suffix, stage fallback — same rule as the stepper). Returns `null` for
frames the feed does not speak. Tones: `info` (dim ink) · `work` (run-emerald) ·
`gate` (amber) · `fail` (red) · `human` (accent).

| CoreEvent type | Narration (template) | Tone |
|---|---|---|
| `sessionStarted` | `Run started` | work |
| `workflowSelected` | `Workflow "<id>" — <n> phases planned` | info |
| `unitPlanned` | `Planned <phase> — <description ≤120>` | info |
| `councilConvened` | `Council convened — polling <n> agents` | info |
| `councilDeliberated` | `Ballot <round>: <pct>% — below the <needed>% bar, runoff` | info |
| `councilVoted` | `Council voted — <pct>% agreement (<votes> votes)` | info |
| `councilSeatFailed` | `Seat <cli> did not vote (<kind>)` | fail |
| `unitDistributed` | `<phase> routed to <cli>` (+ `— council <pct>%` when carried) | info |
| `unitDispatched` | `Worker started <phase> — <description ≤120>` (attempt>0: `re-dispatched (attempt n)`) | work |
| `unitExecuting` | `<phase> is running` | work |
| `unitOutputCaptured` | `<phase> finished — output captured (<kb> KB)` / `finished with errors` | work/fail |
| `dataUsed` | `<phase> touched <n> file(s)` (+ artifact cards, §6) | info |
| `gateEscalated` | `Gate approaching — <condition>` | gate |
| `awaitingHuman` | `Gate: waiting on you — <prompt headline>` | gate |
| `gateEvaluated` | `Checks ran on <phase> — pass` / `— deny: <denialReason>` | work/fail |
| `gateDecided` | `Gate: approved` / `Gate: denied` | work/fail |
| `unitReworkAmended` | `You amended <phase> — re-dispatching with your note` | human |
| `unitDone` | `<phase> approved and done` | work |
| `unitDenied` | `<phase> denied` | fail |
| `unitReassigned` | `<phase> reassigned <prev> → <new / council re-vote>` | info |
| `resumed` | `Run resumed` | work |
| `stepFailed` | `Step failed on <phase> — <first line of detail ≤160>` | fail |
| `crashRecoveryRedrive` | `Engine restarted — re-dispatching <phase> (attempt <n>)` | fail |
| `workerStalled` | `Worker quiet for <n>s — may be waiting at a prompt (open Term or send a message)` | gate |
| `failureTriaged` | `Failure triaged: <decision> — <analysis ≤120>` | info |
| `workerMessageQueued` | `Your message is queued for <target>'s next turn` | human |
| `workerMessageInjected` | `Your message was delivered to <target>` | human |
| `elicitationCreated` | `The agent asks: <message headline>` | gate |
| `elicitationResolved` | `Answer sent — the agent continues` | human |
| `governanceHookFired` (deny only) | `Blocked a tool call — <policy>` | fail |
| `governanceUnenforced` | `Governance was requested but is not enforced for <cli>` | gate |
| `sessionCompleted` | `Run completed` | work |
| `sessionFailed` | `Run failed` | fail |
| `runCancelled` | `Run cancelled` | info |
| `error` | `Error: <message ≤160>` | fail |
| deltas, heartbeat, terminal*, cliUsage, workerSession*, acp*, validationPin*, unitContextInjected, allow-hooks, assumptionRecorded | *(silent — burn/terminal/assumption panels own these)* | — |

Unknown/future types are silent (additive-safe, §5.1 of the wire contract).

**Verbose output stays collapsed.** The worker's streamed text and the durable transcript
render INSIDE the unit's group behind the existing expanders (`LiveNarration` for the
cursor unit — moved to its own file, same testids; `unit-output-<ord>` blocks for done
units). The narrator line is the headline; the bytes are one click below it.

**Raw view survives.** A `narrated | raw` toggle on the feed header switches every line
to the undecorated frame (`type · ord · summary`) for operators who want the wire.

## 5. Feed composition (`buildFeed`)

Pure function over `(events, units, executingOrd)`:

1. Sort events (§3 rule 2).
2. Map to narration lines; drop silent frames.
3. **Unit anchors:** every unit that has run or is running (done / rejected / cursor —
   exactly the old `timeline` filter, FINDING-052 preserved) gets ONE group block,
   placed after its LAST narration line (its story ends with its evidence); units with
   no spoken events (empty trail — pruned log, or a test) append in ord order at the end.
   Queued units get nothing — the stepper is their surface (operator directive upheld).
4. **Artifact items** (§6) follow the `dataUsed` line that produced them.

The feed container owns `data-testid="thread"`; unit groups keep `data-message-id`
(the version-strip anchor contract, DES-MERGE-001 §7.6).

## 6. Artifacts

`deriveArtifacts(events, session)` collects, deduped by path, newest last:

- `dataUsed.files[]` → kind `file` — the files the unit's CLI touched. Inline: an
  artifact card per NEW path (name, dir, phase, "View ›" → the existing FileViewer via
  `onOpenFile`, capped at 6 per event with a `+n more` tail). Strip: total count.
- `session.delivery` (`{kind:'pull_request', url}`) → kind `pr` — an external link card.

The now-bar carries the compact collected-artifacts chip (`📎 <n>`); clicking it opens a
popover listing every artifact (same view/link affordances) without leaving the tail.
No new wire calls: both sources are already on this page's data.

## 7. What dies

- The two-section body (units-then-event-pills) and the bottom-slot gate card in the
  live thread — replaced by the one feed + the dock.
- The inline council/evaluator/degraded routing PILLS in the live thread — narration
  lines carry routing now (the stepper tooltip keeps the queued-unit provenance).
- The full launch composer on terminal runs (#8): a dead run's footer is now a one-line
  **follow-up bar** — "This run is finished — steering is closed." + a single
  `Start a follow-up run in this project →` action that expands the labelled launch form
  (collapsed by default; the label is the review's exact fix). Live runs keep the
  steer/inject composer, which now sits directly under the dock — steering happens where
  the user is already looking.
- `SteeringGate`'s note-less reject: the steer textarea's text now rides **reject** as
  `amend` too (`{approve:false, amend}` — the same wire `GateRejectNote` already speaks;
  the daemon's gate audit records it). This closes the known reject-note gap. An empty
  textarea still sends the bare `{approve:false}`.

## 8. What is preserved (contracts other surfaces own)

- `ProcessStepper`, `RunTimes`, header, Retry, ModePill (read-only when terminal),
  evidence export — untouched.
- Terminal runs keep the evidence lenses: tabs are now **Feed | Timeline | Units**, with
  Feed the default lens (the story), Timeline the recorded-trail navigator (slice BB,
  unchanged), Units the post-mortem/output spine (slice R, unchanged — FailureBanner
  stays the headline in every lens).
- `live-narration-*`, `unit-output-*`, `steering-gate`, avatar inject-targeting, the
  `⌨` per-agent terminal button, FileViewer wiring — same testids, same behavior, now
  rendered by `NarratorFeed`.
- `LegacyChatHistory` (workflow_id='chat') — untouched.

## 9. New modules (ChatPanel shrinks)

| File | Owns |
|---|---|
| `src/components/narrator.ts` | `narrate`, `sortFeedEvents`, `buildFeed`, `deriveArtifacts` (pure) |
| `src/components/NarratorFeed.tsx` | the feed renderer + unit groups + raw toggle |
| `src/components/NowBar.tsx` | the pinned status strip + artifacts chip + jump-to-latest |
| `src/components/ApprovalDock.tsx` | the pinned gate/elicitation dock |
| `src/components/ArtifactCard.tsx` | inline artifact card |
| `src/components/LiveNarration.tsx` | moved out of ChatPanel (shared with RightPanel's Term tab) |
| `src/components/FollowUpComposer.tsx` | the terminal-run follow-up bar (#8) |

## 10. Tests

- `narrator.test.ts` — template per event type; out-of-order `seq` renders sorted; stable
  order for live frames; unit-anchor placement; artifact derivation + dedupe.
- `events-merge.test.ts` — hydrate AFTER live frames merges the recorded prefix and
  de-duplicates (the FINDING-013 guard upgraded, not weakened).
- `NarratorFeed.test.tsx` — out-of-order arrival renders sorted in the DOM; expanders;
  raw toggle; inline artifact cards.
- `ApprovalDock` (in `ChatPanel.dock.test.tsx`) — the dock is a SIBLING of the scroll
  region (structure-level: pinned while the feed scrolls); gate renders in the dock; the
  feed still shows the gate moment inline; elicitation renders in the dock.
- `SteeringGate.rejectNote.test.tsx` — reject carries the typed note on the wire
  (`{approve:false, amend}`), empty note stays bare.
- `ChatPanel.followup.test.tsx` — composer labeling per run state: terminal → collapsed
  follow-up bar with the exact label; expanding shows the launch form; live executing →
  inject composer; awaiting_human → steer composer.
- `NowBar.test.tsx` — phase + active unit + last narration; artifact count; jump button.
