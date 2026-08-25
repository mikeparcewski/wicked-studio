import { useEffect } from 'react';
import type { SessionView } from '../api/types.js';
import { useDeliveryStore } from '../store/delivery.js';
import { useIsSystemWorkflow } from '../store/workflowCache.js';
import {
  DELIVERY_COLOR,
  DELIVERY_LABEL,
  canDeliver,
  deliveryOf,
  resolveDelivery,
  type DeliveryClaim,
} from './delivery.js';
import { compactPath } from './WhatWhere.js';

/**
 * The Delivery views (wicked-studio#122, slice DA) — what a run PRODUCED, in the
 * three places an operator looks for it. Every one of them goes through
 * {@link deliveryOf} and then {@link resolveDelivery}, so none of them can
 * disagree, and only the rail body ever fetches (once, for a run whose phase
 * completed and whose url the wire does not already carry).
 *
 * Copy rules, both load-bearing:
 *  - **"A PR is open" needs a url in hand.** `status === 'done'` buys the
 *    phase-only wording ("deliver ran") and nothing more; the PR claim, the
 *    accent and the link arrive together with the url or not at all.
 *  - The deliver phase opens a PR and STOPS. Nothing here says "shipped" and
 *    nothing says "merged" — merge stays human.
 */

interface Props {
  view: SessionView;
}

/**
 * The rail header's claim badge — the at-a-glance signal the operator decision
 * bought back when the pinned band was reverted (revised EC54): Delivery is the
 * last accordion, so its body costs a click, but its state is legible on the
 * header without one. Same shape as the Files count badge it sits beside.
 *
 * It reads the SAME resolved truth its body renders, store included (D1). The
 * first cut derived from `deliveryOf(view)` alone and ignored the store, so with
 * the section open on run 665a9aeb the header said "PR open" in `--accent` while
 * the body directly beneath it said no PR link was recorded. A badge that can
 * contradict its own body is worse than no badge.
 *
 * `'none'` renders nothing: a run with no deliver phase has no state worth a
 * chip, and silence beats an "unknown" badge.
 */
export function DeliveryBadge({ view }: Props): React.ReactElement | null {
  const fetched = useDeliveryStore((s) => s.byRun[view.session.id]);
  const { claim } = resolveDelivery(deliveryOf(view), fetched?.url ?? null);
  if (claim === 'none') return null;
  return (
    <span
      data-testid="run-delivery-badge"
      data-state={claim}
      className="text-[9px] font-mono px-1 py-0.5 rounded"
      style={{ background: 'var(--surface-raised)', color: DELIVERY_COLOR[claim] }}
    >
      {DELIVERY_LABEL[claim]}
    </span>
  );
}

/**
 * The list-row chip (project dashboard rows, build run rows). Pure DTO — a list
 * surface fires ZERO requests and reads no store, so the only url it can ever
 * hold is the wire-carried `session.delivery.url` (CREW-UX-8 / crew#321). Until
 * that field ships, every chip on every list is the phase-only word; it never
 * says "PR open" on the strength of `done` alone.
 *
 * The chip stays a `<span>` even when a url IS in hand, because both callers
 * render the row as an `<a>` and a nested anchor is invalid HTML. The link lives
 * in the rail body, which is where the operator went to get it.
 *
 * Rendered only for a RESOLVED delivery fact. `'none'` is silence (EC57), and so
 * is `'in-flight'`: the row already carries the run's status pill, and a
 * cancelled run's deliver unit stays `pending` forever — a second motion word
 * there would claim progress that stopped.
 *
 * D2: it gates on {@link canDeliver} — the same predicate the rail's
 * section and the census gate on, so a row can never chip a run whose Delivery
 * section studio itself withholds. The objection to this was cost — that a
 * per-row `is_system` read would break the O(1) request budget — and it is
 * false: `useIsSystemWorkflow` reads MODULE state behind at most one
 * `GET /workflows` per session, so 120 rows fire one request between them and
 * ZERO per row (pinned in `tests/delivery.workflowBudget.test.tsx`). Today the
 * gate is also implied — every chipped claim has a deliver unit, which
 * `canDeliver` licenses outright — and that is precisely why it is written down:
 * an implied invariant is one a later edit to either side silently breaks.
 */
export function DeliveryChip({ view }: Props): React.ReactElement | null {
  const isSystemWorkflow = useIsSystemWorkflow();
  // The gate runs before anything is derived (Copilot on #125): the comment said "FIRST" while
  // `claim` was resolved above it. Harmless as written — the gate still governed the return —
  // but a doc that misdescribes evaluation order is what a later edit trusts.
  if (!canDeliver(view, isSystemWorkflow)) return null;
  const { claim } = resolveDelivery(deliveryOf(view));
  if (claim === 'none' || claim === 'in-flight') return null;
  return (
    <span
      data-testid="run-delivery-chip"
      data-state={claim}
      style={{
        flexShrink: 0,
        fontSize: 'var(--text-2xs)',
        fontFamily: 'var(--font-mono)',
        color: DELIVERY_COLOR[claim],
      }}
    >
      {DELIVERY_LABEL[claim]}
    </span>
  );
}

/**
 * The rail body's one-line lead, per claim.
 *
 * EXPORTED so the same structural guard that pins {@link DELIVERY_LABEL} can be
 * pointed at it: the badge word was tested and this sentence was not, so
 * `'delivered'` could be edited back to "PR open — merge stays human." — the
 * exact claim this slice was re-cut to remove — with the whole suite still
 * green. Only `'pr-open'` may assert an open PR.
 */
export const HEADLINE: Record<DeliveryClaim, string> = {
  'none':               'This run has no deliver phase.',
  // NOT "no PR exists yet", and NOT "is still running" (Copilot on #125, twice). The first
  // asserted a PR's non-existence; the SECOND asserted execution — and this module says in four
  // places that a cancelled run's deliver unit is `pending` FOREVER (10 of the live corpus's 12
  // `distributed` units sit in terminal sessions). `pending` means UNRESOLVED, never RUNNING.
  // The wording now matches the state's own definition and claims nothing further.
  //
  // The original note still holds: the deliver script pushes the branch, THEN runs
  // `gh pr create`, THEN echoes the url — a unit that is still `pending`/`distributed` can be at
  // any point in that sequence, so a PR may already be open. Asserting its non-existence is the
  // same unevidenced claim as asserting its existence, pointed the other way.
  'in-flight':          'The deliver phase has not resolved — what it produced is not recorded.',
  // The 665a9aeb wording. Approved is not the same as produced, and this line
  // is the whole difference said out loud.
  'delivered':          'The deliver phase ran and crew approved it. That alone is not a PR.',
  'pr-open':            'PR open — merge stays human.',
  'nothing-to-deliver': 'Delivered nothing. Crew refused the push:',
  'failed':             'Delivery failed. Crew recorded:',
};

/**
 * The Delivery accordion body. Claims, and what each one costs:
 *
 *  - `pr-open` — the PR as a real external anchor. The url comes free from
 *    `session.delivery` when the daemon carries it (crew#321); otherwise it is
 *    what the one transcript read below recovered.
 *  - `delivered` — the phase completed and no url is in hand. ONE
 *    `GET /runs/:id/units/:unitKey/output`, fired here and only here, gated on
 *    the operator opening this section. If the read comes back without a url the
 *    body says so plainly and the headline never upgrades — the 665a9aeb case,
 *    which is a `done` unit with a `null` denial_reason and a transcript holding
 *    one `/pull/new/` form and no numbered PR (EC59).
 *  - `nothing-to-deliver` / `failed` — `denial_reason` VERBATIM. Zero fetches: a
 *    rejected unit has no stored transcript by design, and re-wording a gate's
 *    own message is how a surface starts lying.
 *  - `none` — positively-classified deliverable runs only (`canDeliver` gates
 *    the rest out, defs in hand): names the worktree the work is sitting in and
 *    the launch option that would deliver it.
 *
 * ── THE COLD-CACHE INVARIANT (D-1) ───────────────────────────────────────────
 * **Nothing studio cannot prove is deliverable gets a "no deliver phase"
 * sentence or a "launch with deliver: pr" remedy — the loading window, and the
 * permanently-unclassifiable run, included.**
 *
 * The first cut suppressed the REMEDY LINE and kept the section, on the argument
 * that the rest of the body is derived from the run's own units and is true
 * whatever composed them. That argument holds for every claim EXCEPT `'none'`,
 * which is not a fact about units at all — it is a claim about a classification
 * studio may not have. And that is the case the live corpus is made of: 86 of
 * 129 runs carry a materialised `wf-<runId>` id that `GET /workflows` never
 * serves, so the lookup answers `undefined` for them forever, not just for a
 * paint. Thirty interactive document threads therefore rendered a Delivery
 * section whose entire body read "This run has no deliver phase."
 *
 * So `canDeliver` now withholds the SECTION on the `'none'` arm under the same
 * `is_system === false` licence this line has always used, and the two halves
 * are one rule:
 *
 *  - a run WITH a deliver phase keeps its section unconditionally — 5c5e08b7's
 *    own workflow id is materialised, and gating that arm would hide a real PR;
 *  - a run WITHOUT one gets a section only once a def in hand says the workflow
 *    is ordinary. `undefined` is not a licence.
 *
 * Erring toward saying less: withholding costs the operator a sentence they can
 * get from the composer; printing it wrongly tells them a run failed to do
 * something it was never asked to do. The section and the line appear together
 * the moment the defs land — and for a system workflow neither ever does.
 *
 * The licence is re-checked HERE as well as in the caller because this component
 * is exported and rendered directly by tests and by any future surface: one
 * rule, held on both sides of the seam, never a second rule.
 */
export function RunDelivery({ view }: Props): React.ReactElement {
  const runId = view.session.id;
  const fetched = useDeliveryStore((s) => s.byRun[runId]);
  const { state, claim, unitId, reason, href } = resolveDelivery(
    deliveryOf(view),
    fetched?.url ?? null,
  );

  // The ONE per-run fetch, and only when there may be something to point at: an
  // approved deliver phase whose url the daemon does not already carry. `unitKey`
  // is the deliver unit's FULL id — the output route's most-specific pass matches
  // `u.id === unitKey`, so an overlay-named phase needs no key guessing (EC61).
  // Keyed off `state`, not `claim`: once the read lands `claim` may flip to
  // `pr-open`, and gating on that would make the effect re-evaluate its own
  // result. `load` is idempotent per run either way.
  const unitKey = state === 'delivered' && href === null ? unitId : null;
  useEffect(() => {
    if (unitKey !== null) useDeliveryStore.getState().load(runId, unitKey);
  }, [runId, unitKey]);

  const workdir = view.session.workdir;

  // The licence — for the remedy line, and (in the caller) for the whole `'none'`
  // arm this body would otherwise open with "This run has no deliver phase":
  // `is_system === false`, a def IN HAND that carries no flag (the daemon omits
  // `is_system` on ordinary workflows). `undefined` — the defs have not loaded,
  // the fetch degraded, or the id is a materialised `wf-<runId>` that no catalog
  // will ever carry — is NOT a licence. See the cold-cache invariant above.
  const isSystemWorkflow = useIsSystemWorkflow();
  const remedyLicensed = isSystemWorkflow(view.session.workflow_id?.trim() ?? '') === false;

  return (
    <div data-testid="run-delivery" data-state={claim} className="flex flex-col gap-1.5 text-[11px]">
      {/*
        * The `'none'` headline is a CLASSIFICATION claim ("this run has no deliver phase"), so it
        * needs the same `is_system === false` licence the remedy does. The rail already withholds
        * the whole section unlicensed, which is why this is unreachable today — but the invariant
        * lived only in the caller (Copilot on #125), and this component is exported. Enforcing it
        * here too means a future call site cannot reintroduce the claim by accident.
        *
        * Only the SENTENCE is gated, not the section: the worktree line below is a DTO fact
        * (`session.workdir`) that holds whatever produced the run, and withholding facts along
        * with claims is the separate bug tracked in #126.
        */}
      {(claim !== 'none' || remedyLicensed) && (
        <p style={{ color: claim === 'pr-open' ? 'var(--ink-muted)' : DELIVERY_COLOR[claim] }}>
          {HEADLINE[claim]}
        </p>
      )}

      {claim === 'pr-open' && href !== null && (
        <a
          data-testid="run-delivery-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono break-all transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {href} <span aria-hidden>↗</span>
        </a>
      )}
      {claim === 'delivered' && fetched === undefined && (
        <p className="font-mono" style={{ color: 'var(--ink-dim)' }}>
          reading the deliver phase transcript for the PR link…
        </p>
      )}
      {claim === 'delivered' && fetched !== undefined && (
        // The 665a9aeb case, said out loud: crew approved the phase and the
        // transcript carries no PR url (its overlay pushed an empty branch and
        // reported success — crew#317). `unavailable` is the daemon's OWN words
        // when it has any; otherwise the absence itself is the finding. Muted,
        // not `--status-fail`: an approved phase that produced no PR is a gap in
        // the EVIDENCE, not a run that failed.
        <p data-testid="run-delivery-nolink" className="font-mono" style={{ color: 'var(--ink-muted)' }}>
          {fetched.unavailable ?? 'the deliver phase recorded no PR link — nothing can be pointed at'}
        </p>
      )}

      {(claim === 'nothing-to-deliver' || claim === 'failed') && (
        <>
          <p
            data-testid="run-delivery-reason"
            className="font-mono break-words whitespace-pre-wrap"
            style={{ color: 'var(--status-fail)' }}
          >
            {/* `reason` is already empty-normalized to `null` by the derivation,
                so `??` cannot paint a blank paragraph here. */}
            {reason ?? 'crew recorded no reason'}
          </p>
          {workdir !== undefined && workdir !== null && (
            <p className="font-mono" style={{ color: 'var(--ink-dim)' }} title={workdir}>
              the work is in {compactPath(workdir)}
            </p>
          )}
        </>
      )}

      {claim === 'none' && ((workdir !== undefined && workdir !== null) || remedyLicensed) && (
        <p className="font-mono" style={{ color: 'var(--ink-dim)' }}
          {...(workdir !== undefined && workdir !== null ? { title: workdir } : {})}
        >
          {workdir !== undefined && workdir !== null
            ? remedyLicensed
              ? `the work is in ${compactPath(workdir)} — launch with deliver: pr to open a PR from it`
              : `the work is in ${compactPath(workdir)}`
            : 'launch with deliver: pr to have the run open a PR from its worktree'}
        </p>
      )}
    </div>
  );
}
