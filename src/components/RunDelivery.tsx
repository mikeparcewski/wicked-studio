import { useEffect } from 'react';
import type { SessionView } from '../api/types.js';
import { useDeliveryStore } from '../store/delivery.js';
import { DELIVERY_COLOR, DELIVERY_LABEL, deliveryOf, type DeliveryState } from './delivery.js';
import { compactPath } from './WhatWhere.js';

/**
 * The Delivery views (wicked-studio#122, slice DA) — what a run PRODUCED, in the
 * three places an operator looks for it. Every one of them derives from
 * {@link deliveryOf}, so none of them can disagree, and only the rail body ever
 * fetches (once, for a run that actually delivered).
 *
 * Copy rule, load-bearing: the deliver phase opens a PR and STOPS. Nothing here
 * says "shipped" and nothing says "merged" — merge stays human.
 */

interface Props {
  view: SessionView;
}

/**
 * The rail header's state badge — the at-a-glance signal the operator decision
 * bought back when the pinned band was reverted (revised EC54): Delivery is the
 * ninth accordion, so its body costs a click, but its STATE is legible on the
 * header without one. Same shape as the Files count badge it sits beside.
 *
 * `'none'` renders nothing: a run with no deliver phase has no state worth a
 * chip, and silence beats an "unknown" badge.
 */
export function DeliveryBadge({ view }: Props): React.ReactElement | null {
  const { state } = deliveryOf(view);
  if (state === 'none') return null;
  return (
    <span
      data-testid="run-delivery-badge"
      data-state={state}
      className="text-[9px] font-mono px-1 py-0.5 rounded"
      style={{ background: 'var(--surface-raised)', color: DELIVERY_COLOR[state] }}
    >
      {DELIVERY_LABEL[state]}
    </span>
  );
}

/**
 * The list-row chip (project dashboard rows, build run rows). Pure DTO — a list
 * surface fires ZERO requests, which is why the chip is a word and not a link
 * until `session.delivery` (CREW-UX-8) makes the url free.
 *
 * Rendered only for a RESOLVED delivery fact. `'none'` is silence (EC57), and so
 * is `'in-flight'`: the row already carries the run's status pill, and a
 * cancelled run's deliver unit stays `pending` forever — a second motion word
 * there would claim progress that stopped.
 */
export function DeliveryChip({ view }: Props): React.ReactElement | null {
  const { state } = deliveryOf(view);
  if (state === 'none' || state === 'in-flight') return null;
  return (
    <span
      data-testid="run-delivery-chip"
      data-state={state}
      style={{
        flexShrink: 0,
        fontSize: 'var(--text-2xs)',
        fontFamily: 'var(--font-mono)',
        color: DELIVERY_COLOR[state],
      }}
    >
      {DELIVERY_LABEL[state]}
    </span>
  );
}

/** The rail body's one-line lead, per state. */
const HEADLINE: Record<DeliveryState, string> = {
  'none':               'This run has no deliver phase.',
  'in-flight':          'The deliver phase has not finished — no PR exists yet.',
  'delivered':          'PR open — merge stays human.',
  'nothing-to-deliver': 'Delivered nothing. Crew refused the push:',
  'failed':             'Delivery failed. Crew recorded:',
};

/**
 * The Delivery accordion body. States, and what each one costs:
 *
 *  - `delivered` — the PR as a real external anchor. The url comes free from
 *    `session.delivery` when the daemon carries it (crew#321); otherwise ONE
 *    `GET /runs/:id/units/:unitKey/output`, fired here and only here, gated on
 *    the operator opening this section. A delivered run whose transcript holds
 *    no url says exactly that — never a silently linkless "Delivered" (EC59).
 *  - `nothing-to-deliver` / `failed` — `denial_reason` VERBATIM. Zero fetches: a
 *    rejected unit has no stored transcript by design, and re-wording a gate's
 *    own message is how a surface starts lying.
 *  - `none` — build runs only (the caller gates chat runs out): names the
 *    worktree the work is sitting in, and the launch option that would deliver it.
 */
export function RunDelivery({ view }: Props): React.ReactElement {
  const runId = view.session.id;
  const { state, unitId, reason, url } = deliveryOf(view);
  const fetched = useDeliveryStore((s) => s.byRun[runId]);

  // The ONE per-run fetch, and only when there is something to point at: a
  // delivered run whose url the daemon does not already carry. `unitKey` is the
  // deliver unit's FULL id — the output route's most-specific pass matches
  // `u.id === unitKey`, so an overlay-named phase needs no key guessing (EC61).
  const unitKey = state === 'delivered' && url === null ? unitId : null;
  useEffect(() => {
    if (unitKey !== null) useDeliveryStore.getState().load(runId, unitKey);
  }, [runId, unitKey]);

  const href = url ?? fetched?.url ?? null;
  const workdir = view.session.workdir;

  return (
    <div data-testid="run-delivery" data-state={state} className="flex flex-col gap-1.5 text-[11px]">
      <p style={{ color: state === 'delivered' ? 'var(--ink-muted)' : DELIVERY_COLOR[state] }}>
        {HEADLINE[state]}
      </p>

      {state === 'delivered' && href !== null && (
        <a
          data-testid="run-delivery-link"
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono break-all transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {href} <span aria-hidden>↗</span>
        </a>
      )}
      {state === 'delivered' && href === null && fetched === undefined && (
        <p className="font-mono" style={{ color: 'var(--ink-dim)' }}>
          reading the deliver phase transcript for the PR link…
        </p>
      )}
      {state === 'delivered' && href === null && fetched !== undefined && (
        // The 665a9aeb case, said out loud: crew approved the phase and the
        // transcript carries no PR url (its overlay pushed an empty branch and
        // reported success — crew#317). `unavailable` is the daemon's OWN words
        // when it has any; otherwise the absence itself is the finding.
        <p data-testid="run-delivery-nolink" className="font-mono" style={{ color: 'var(--status-fail)' }}>
          {fetched.unavailable ?? 'the deliver phase recorded no PR link — nothing can be pointed at'}
        </p>
      )}

      {(state === 'nothing-to-deliver' || state === 'failed') && (
        <>
          <p
            data-testid="run-delivery-reason"
            className="font-mono break-words whitespace-pre-wrap"
            style={{ color: 'var(--status-fail)' }}
          >
            {reason ?? 'crew recorded no reason'}
          </p>
          {workdir !== undefined && workdir !== null && (
            <p className="font-mono" style={{ color: 'var(--ink-dim)' }} title={workdir}>
              the work is in {compactPath(workdir)}
            </p>
          )}
        </>
      )}

      {state === 'none' && (
        <p className="font-mono" style={{ color: 'var(--ink-dim)' }}
          {...(workdir !== undefined && workdir !== null ? { title: workdir } : {})}
        >
          {workdir !== undefined && workdir !== null
            ? `the work is in ${compactPath(workdir)} — launch with deliver: pr to open a PR from it`
            : 'launch with deliver: pr to have the run open a PR from its worktree'}
        </p>
      )}
    </div>
  );
}
