# DES-MERGE-001 Adversarial Review

**Reviewed:** 2026-08-17  
**Target:** `.product/DES-MERGE-001.md` (commit `6b027f0`)  
**Posture:** Find every place the design assumes an answer it hasn't given, promises
something it doesn't deliver, or sequences things unsafely. Style and preference are
not in scope; correctness and completeness are.

---

## Severity legend

- **BLOCKER** — the design cannot be implemented as written without resolving this first
- **GAP** — a real piece of work is missing from the slice plan or is promised but
  unspecified
- **RISK** — the approach is possible but creates a problem the design does not acknowledge
- **CONTRADICTION** — two sections make incompatible claims

---

## 1  Project identity is both punted and load-bearing  *(BLOCKER)*

§1.6 defers "whether Projects in crew and 'instances' in interactive are the same entity"
to a product call. But three later sections build directly on a specific answer:

- §4.8: "crew `POST /api/v1/projects/:id/members` is **the authority**" — assumes the
  entities are unified.
- §5.6: "crew resolves root per project binding" — assumes crew knows which interactive
  root belongs to which project.
- §6.5: "Phase B and Phase C can proceed in parallel" — Phase C (Document mode) cannot
  start without knowing which bridge root to proxy.

You cannot defer a question and simultaneously build the answer into the design.
Resolution required before slice 1.

---

## 2  The reverse proxy has no per-project root selection mechanism  *(BLOCKER)*

§5.3 routes all interactive traffic through `/api/v1/interactive/*` with no project
context in the path. §5.6 says "crew resolves root per project binding" but the
mechanism is not specified:

- The HTTP request to `/api/v1/interactive/api/docs` carries no project identifier.
- A user with two projects bound to different wicked-interactive roots gets whichever root
  crew proxied most recently.
- ADR-0025's "shared root" default does not help when projects genuinely differ.

Either the path must encode the root/project (e.g.
`/api/v1/interactive/:projectId/*`) and every slice 2 wrapper must include it, or the
design must state that only one root is supported and mark multi-root as out of scope.

---

## 3  Slice 11 ships point-and-comment with `allow-same-origin`; Slice 12 is the
security close-out — wrong order  *(RISK, severity: high)*

§5.5 explicitly states that `allow-scripts allow-same-origin` means "agent-authored HTML
executes on the app's origin" with access to `localStorage` and `/api/v1`. It
acknowledges this is unacceptable once crew has credentials.

Slice 11 ships the overlay against that frame. Slice 12 adds the postMessage bridge and
drops `allow-same-origin`. §6.5 says "Slice 12 is not optional and must not drift."

But the current sequencing puts a six-to-eight PR gap between shipping the vulnerability
and closing it. In practice "must not drift" does drift — scope changes, dependency
blockers, and competing priorities are real. The safe sequence is:

> **Slice 12 before Slice 11**, or merge them into one PR.

The postMessage bridge in `instrument.js` (~260 LOC per the plan) + the overlay switch
(~340 LOC) is 600 LOC combined — above the 400-LOC guideline but the guideline exists to
keep PRs reviewable, not to enforce a split that creates a security window. An exception
here is the correct call.

---

## 4  The "preferred narration path" (doc generation via crew runs) appears nowhere in
the slice plan  *(GAP)*

§3.5 states:

> Preferred — route document generation through crew runs. If document generation is a
> crew run, its worker's output is relayed as `unitOutputDelta` for free, and Document
> mode inherits narration, gates, evidence, and the board card with zero new plumbing.

This preferred path is entirely absent from all 18 slices. Only the fallback (SSE relay)
is implemented. The design never says this path is deferred; it simply lists it as
preferred and then describes the fallback.

Consequence: every narration property in §3 depends on the assumption that delta
streaming works end-to-end for documents. If only the fallback is built, the SSE relay
frames must be:

1. Stored for replay (§3.6 requires `hydrateOutputs` symmetry — where do SSE frames go?);
2. Keyed identically to crew's `outputKey(runId, unit)` — but doc runs have no crew
   `unit` unless they go through crew.

Either declare the preferred path in scope (it needs a slice), or declare it out of scope
and specify how the fallback satisfies §3.6's replay requirement.

---

## 5  Home board doc thumbnails: 60 live iframes, no mitigation  *(RISK, severity: medium)*

§1.4: "up to 3 doc thumbnails (live-rendered HTML at small scale, **not a screenshot
service**)" × ~20 cards = up to 60 iframe renders on the home route.

Each interactive document is a full HTML page with its own DOM, styles, and script
budget. Sixty of them in a virtualized grid are a memory and render-thread problem on any
mid-range machine. The design explicitly rules out the obvious mitigation (screenshot
service) without proposing an alternative.

The design must either:
- permit a screenshot cache (justify why this is acceptable given the "live" framing); or
- specify a DOM-budget cap per thumbnail iframe (width, height, viewport, script disabled); or
- explicitly defer thumbnails and show a placeholder in the slice plan.

No slice covers doc thumbnails in any form. They appear in §1.4's card anatomy but not in
§6.

---

## 6  Version → thread message cross-link: the storage mechanism is unspecified  *(GAP)*

§4.2: "Selecting v5 scrolls the thread to the messages that produced v5. That link is the
whole point of merging."

Slice 9 AC: "selecting v1 … scrolls `data-testid='thread'` to the message tagged `v1`."

Interactive's version manifest (`versions.json`) stores `{version, parent, timestamp,
meta}` — no message reference. The thread's messages do not currently carry a version
tag.

Nothing in the design specifies:
- where the version→message mapping is stored;
- who writes it (the doc agent? the service on doc commit? the client on receipt of a
  `chat.posted` event?);
- what happens when a version is produced by a point-and-comment batch (one message → one
  version, fine) vs. a multi-turn conversation (several messages → one version, which one
  is "the" anchor?).

Slice 9 cannot be coded without these answers.

---

## 7  Point-and-comment batch → crew thread message: the bus-to-thread path is missing
*(GAP)*

§2.3: "A feedback batch posts into the thread as a user message."
§4.3: "Must render over the embedded canvas and post into the thread as a user message
(§2.3)."

But interactive's feedback mechanism is:
1. user clicks elements, `feedbackStore.js` batches them;
2. `wicked.interactive.feedback.submitted` is emitted onto the bus;
3. the agent receives and applies it via `structural.js`.

The bus event is not a crew thread message. In the merged design, how does a
`feedback.submitted` bus event become a user-authored message in the crew thread?

Two plausible paths:
- the client posts to `POST /api/v1/runs/:id/inject` after emitting the bus event (client
  authors both), or
- crew listens on the bus for `feedback.submitted` and fans it into the run's transcript.

Neither path is specified. Without it, the thread is missing the user's feedback actions
and §2.3's audit-trail rationale fails.

---

## 8  "Governed QE for documents" is REPLACED-BY-BETTER with no replacement defined
*(GAP)*

§4.7: "`qe` → full quality crew. In the merged app this is a *crew run*: real governance,
evidence in the ledger, evaluator≠creator, visible on the board. Today it's a
fire-and-forget review request. **This is the single biggest capability upgrade the merge
delivers to interactive users.**"

Nothing in §6 implements this. The claim is significant — it is called the single biggest
upgrade — but:
- no crew workflow definition for document QE is referenced;
- no input spec (what does the workflow receive — a doc URL? a version number? the
  HTML?);
- no evidence format;
- no slice.

If it is deferred, say so explicitly and remove it from the parity inventory count. If it
is not deferred, it needs a slice.

---

## 9  Crew starting the interactive bridge is incompatible with a remote runner  *(CONTRADICTION)*

§5.3: "Crew is a server process: it can read `<root>/.wi-serve.json`, health-check the
bridge … start it if absent."

§5.3 also claims: "one auth/identity path, so the remote-runner future doesn't need a
second story."

These contradict. A remote runner is crew running on a cloud host. That host cannot:
- read a lockfile on the user's laptop;
- start an interactive bridge that is a local Node process;
- discover a port from a local `.wi-serve.json`.

The proxy design works for local-only deployment. That may be acceptable (crew is
local-first today), but the design must say so plainly rather than claiming it improves
the remote-runner story when it forecloses it.

---

## 10  Composer case 4 (follow-up) creates friction for the most common document edit
pattern  *(RISK, severity: medium)*

§2.2 case 4: once a run is terminal, the composer creates a **new linked run** ("follow
up, not resurrection"). For crew code runs, this is correct — evidence is immutable.

For documents, the most common action after generation is not "start a new doc" — it is
"change the heading on slide 2." Under the case-4 rule, that becomes a new run every time
a version is complete. The user's thread will accumulate a chain of linked runs for what
feels like one conversation.

The design handles the *governance* case correctly but does not acknowledge that the
document editing loop has a different rhythm. Options:
- treat `POST /api/fork` + inject as a single atomic composer action that is invisible as
  a new "run" in the thread (the seam is hidden, the governance is preserved);
- explicitly say document editing doesn't use case 4 and describe what it does use.

Neither is in the design.

---

## 11  The home board's "simple vs. complex gate" distinction is undefined  *(GAP)*

§1.4: "A waiting gate renders as an **answerable** chip, not a badge. … Answering a
simple gate (approve/reject) must not require entering the project. Complex gates
deep-link into the thread."

No definition of "simple" vs. "complex" is given anywhere in the design. The AC for slice
7 asserts the distinction ("a complex gate's chip navigates to …") but a Playwright test
can only implement it if there is a schema property or gate-type enum to assert on.

Either the gate payload carries a `simple: boolean` (or an equivalent), or the merged UI
applies a heuristic (e.g., gates with more than two options are complex). The design must
specify which.

---

## 12  No AC for bridge-start failure in Phases A and B  *(GAP)*

Slice 1 AC ends at "200 again (restarted)." There is no AC for what the user sees when
the bridge cannot start (missing `npm`, missing `wicked-interactive` install, or port
exhaustion). The install gate that would produce an actionable error (§5.6) is slice 17 —
Phase D.

For the 16 slices between 1 and 17, a bridge start failure produces an unspecified error.
Slice 1 should include an AC for this case, even if the response is a minimal 503 with a
plain-text install hint.

---

## 13  Slice 18 retires the interactive SPA with no accommodation for CLI users  *(RISK)*

§6.4 slice 18: "the interactive bridge serves no HTML shell (`GET /` → 404 or a redirect
to studio)."

Today, users who run `wicked-interactive serve` and open `http://localhost:4400` directly
get a working UI. Slice 18 silently breaks that workflow. The parity bar (§4) applies to
interactive users generally, not only those who reach it through studio.

The design should either:
- document that the standalone UI is intentionally retired and explain the migration; or
- keep the shell alive behind a dev-only flag; or
- make the `GET /` redirect to the studio URL (which is feasible if the lockfile records
  the studio origin).

---

## Summary table

| # | Area | Severity | Blocks slice |
|---|---|---|---|
| 1 | Project identity punted but load-bearing | BLOCKER | 1 |
| 2 | No per-project root selection in proxy path | BLOCKER | 1 |
| 3 | Slice 11 before 12 is a security window | RISK/HIGH | 11 |
| 4 | Preferred narration path not in any slice | GAP | — |
| 5 | 60 live doc thumbnail iframes, no mitigation | RISK/MED | 5 |
| 6 | Version→message cross-link storage unspecified | GAP | 9 |
| 7 | Feedback batch → crew thread path missing | GAP | 11 |
| 8 | Governed doc QE has no crew workflow spec | GAP | — |
| 9 | Crew-as-process-manager forecloses remote runner | CONTRADICTION | — |
| 10 | Case-4 follow-up creates friction for doc editing | RISK/MED | 10 |
| 11 | Simple vs. complex gate undefined | GAP | 7 |
| 12 | No AC for bridge-start failure pre-slice 17 | GAP | 1 |
| 13 | Slice 18 silently breaks standalone CLI users | RISK | 18 |

**Two blockers must be resolved before any implementation begins** (findings 1, 2).  
**Finding 3 (slice ordering) should be fixed in the design before slice 11 is written.**  
The remaining findings are implementation gaps and medium risks that the authors should
address in the design before the affected slices start.
