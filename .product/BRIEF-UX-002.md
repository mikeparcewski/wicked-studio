# BRIEF-UX-002 — the agentic terminal of the future: steering, not waiting

**Provenance.** Authored as the design-phase deliverable for the UX-002 reimagining initiative,
2026-08-23. Reads first: `.product/BRIEF-UX-001.md` (the trust-spine repair, the floor);
`.product/DES-UX-001.md` (the landed trust-spine design); `.product/DES-VISION-001.md` (the token
system and composition model this round inherits).

**The floor this brief stands on.** The six journeys from BRIEF-UX-001 re-run cleanly: failed runs
can be diagnosed in under two minutes; a project's Build tab shows exactly its runs; a document
thread survives reload; a chat's first send succeeds; every count on one screen is consistent; '?'
answers the keyboard question. The trust spine is repaired. The machinery can be trusted.

**The question this brief answers.** Once the machinery is trustworthy — what should it mean to
ORCHESTRATE with it?

---

## 1 The operator's day, now

An operator with six live projects opens wicked-studio. The home board shows the attention wall:
two projects in the NEEDS YOU band, four in QUIET. One gate is waiting. The operator approves it.
Then — silence. The run is working. The operator switches to another context, comes back twenty
minutes later, and the run has a verdict: completed, or failed.

This is a reliable loop. It is not an orchestration loop. The operator is a gate-keeper, not a
director. The agents work in a box the operator cannot see into; the verdict is the only window.

The improvements from the trust-spine round are real — the verdict is now diagnosable, the
evidence is accessible, provenance is honest. But the fundamental posture is unchanged: the
operator **reacts** to what the agents produce. The work flows in one direction, from agent to
operator, at gate points only.

---

## 2 The operator's day, reimagined

The same operator, six projects. They open wicked-studio.

The home board shows not just attention bands but **live evidence accumulation**: the api-migration
run is on phase 3 of 5, the council has converged on the auth service as the blast radius, and a
gate is approaching. The operator does not wait for the gate — they see the direction forming and
add a pre-gate annotation: "exclude the payment module, it's deprecated next sprint." The
annotation waits at the gate. When the gate arrives, the amend text is pre-populated.

A second project — a Q3 deck — has just landed v3 of the presentation. The operator clicks into
the evidence trail: not the artifact, but the trail of decisions that shaped it. They can see which
agent proposed the executive summary, which evaluator challenged it, and how the amendment resolved
the conflict.

A third project failed overnight. The operator opens the run's evidence timeline, reads the
reasoning chain from the first unit to the gateEvaluated denial, understands the root cause in
sixty seconds, and launches a retry with the targeted guidance pre-populated.

This is orchestration. The operator is a **director** — giving direction continuously, reading
evidence as it accumulates, steering before the verdict, not just after.

---

## 3 What dies

**The blind run.** The period between launch and verdict when the operator has no window into what
is happening. An agent can be three phases into a five-phase workflow and the operator sees
"executing." This opacity is not a data problem — the wire carries live events the studio never
surfaces. It is a design choice this brief reverses.

**The isolated run.** Runs as disconnected atoms — indifferent to the project's history, invisible
to each other's context. A retry is a fresh start with no memory of what the previous run learned.
The project has a work history; the product ignores it.

**The one-shot interaction model.** The idea that the operator's only meaningful touchpoint with a
running agent is a binary gate decision. Approve or reject — full stop. The wire already supports
amend text. The product has never made this feel like a conversation.

---

## 4 What is born

**Evidence as navigation.** The run's evidence trail — phase sequence, routing decisions,
evaluator reasoning, unit transcripts — becomes the primary surface, not a forensic escape hatch.
The operator navigates the run through its evidence, not through a flat unit list.

**The work chronicle.** The project's history of work — ordered runs grouped by retry chain,
showing what each episode attempted and what it learned — becomes the canonical project view.
The operator understands a project's state by reading its chronicle, not by parsing a run list.

**The steering annotation.** A structured guidance layer anchored to gate points: the operator
composes direction before the gate arrives, the gate pre-populates the amend field, and the
amended unit description is the operator's words injected into the agent's context. The existing
wire supports this. The product has never made it feel intentional.

**The portfolio nerve center.** The home board enriches each active card with live evidence
progress — current phase, key decision forming, approaching gate — so the operator sees the
system's direction, not just its status. Cross-project awareness requires no new navigation.

**The operator's context record.** The accumulated history of an operator's gate decisions, amends,
and guidance — assembled from the audit trail — becomes a first-class view on the project. Before
launching a retry, the operator sees every direction they have given this project, and can carry
the most relevant guidance forward.

---

## 5 Design principles

**Evidence is the primary product.** Verdicts and artifacts are derived from evidence. The operator
should be able to read the evidence and arrive at the verdict themselves. If they cannot, the
surface has failed.

**Operators direct; gates formalize.** Approval is the minimum interaction. The aspiration is that
the operator has shaped the work before the gate arrives, through annotation and steering, and the
gate merely confirms the direction already given.

**The work stream is the atom, not the run.** A project's story is its chronicle of work episodes,
linked by lineage and shaped by the operator's continuous guidance. Individual runs are chapters,
not books.

**Live data is the aesthetic.** A timeline showing evidence accumulating as the run progresses is
more beautiful than a verdict screen, because it communicates that real work is happening and the
operator's direction matters.

**Transparency is legible history, not audit logs.** The audit trail is the raw material. The
product's job is to make it readable as a narrative of decisions, not a log of API calls.

---

## 6 What remains protected

Everything in BRIEF-UX-001 §0 is protected here, explicitly:

- The morning lede + needs-you-first wall + 24h activity river on `/`.
- The gate experience end-to-end (plain-language ask, Approve/Approve+steer/Reject, policy
  provenance, toast+status+amber simultaneity, honest "Waiting for your input… → Run resumed"
  record).
- The honesty-label house style ("observed", "by files indexed", the search-corpus disclosure
  with [why?]).
- Live-everything updates; browser-history honesty; the repo profile + code graph; the composer's
  + drawer capabilities; council/evaluator transparency chips; the Burn panel; palette prefix
  self-teaching; the Theme page.
- Wire honesty is law: no invented routes or fields; every data claim verified; NEEDS-CREW items
  flagged explicitly before any client work.

---

## 7 Definition of done

The reimagined experience, run cold by a skeptic against the live daemon, satisfies:

1. An operator can see the live evidence accumulating on a running run — phase progress, current
   unit description, approaching gate — without entering the run's detail view.
2. An operator can add pre-gate guidance from the home board; it pre-populates the amend field
   when the gate arrives.
3. An operator can navigate a completed run's evidence timeline — reading the routing decisions,
   evaluator reasoning, and amendment history in chronological order — without opening a separate
   forensics session.
4. A failed run, viewed from the evidence timeline, reveals the root cause in under sixty seconds.
5. A project's work chronicle shows retry chains as grouped episodes; the operator understands the
   project's direction from the chronicle without reading individual run details.
6. The portfolio nerve center shows which projects have evidence approaching a gate and which are
   accumulating evidence without needing the operator's attention.

No surface introduced in this round invents a wire. Every proposed surface names its existing route
or is flagged NEEDS-CREW before any client work builds against it.
