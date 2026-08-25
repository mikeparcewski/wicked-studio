import type { SessionView, SessionWithDelivery, WorkUnit } from '../api/types.js';

/**
 * Delivery — the one derivation every surface reads (wicked-studio#122, slice DA).
 *
 * A run that opened a PR never said so anywhere in studio: the URL existed only
 * as raw `git push` console text ~4500px down the Units tab, under a LARGER and
 * WRONG `…/pull/new/…` create-PR link. This module is the whole answer, and it
 * is deliberately pure — no React, no fetch — so the project page, the build run
 * list and the run's right panel all derive the same fact from the DTO they
 * already hold. **Zero requests on any list surface** is the standing rule; the
 * one sanctioned per-run fetch lives in `src/store/delivery.ts` and fires only
 * for a run that actually delivered.
 *
 * Wire truth this rests on (verified against api-types 0.8.0 + the live daemon):
 *  - `WorkUnit` has NO `output` member at all — transcripts are a separate GET,
 *    and inlining them into `GET /runs` would make the list endpoint O(all
 *    transcript bytes). Nothing here reads a transcript.
 *  - `units[].denial_reason` already carries crew#318's message on the LIST
 *    wire, so "why did it deliver nothing" costs nothing.
 *  - The deliver unit is found by its id suffix, never by `session.workflow_id`
 *    (EC61): the composed `<base>-deliver-<runId>` id exists only when crew
 *    composes the phase, and run 5c5e08b7 delivered through a `feature-pr`
 *    OVERLAY whose workflow id is plain. `tool_cmd` is the overlay's fallback.
 */

/**
 * What this run's delivery is, as five mutually exclusive facts.
 *
 *  - `delivered` — the deliver phase was APPROVED (`done`). It is not "shipped"
 *    and it is not "merged": the phase opens a PR and stops, by design.
 *  - `nothing-to-deliver` — denied because the run committed nothing (crew#318).
 *  - `failed` — denied for any other reason; the reason is rendered verbatim.
 *  - `in-flight` — the deliver phase has not resolved (`pending`/`distributed`).
 *  - `none` — this run has no deliver phase at all.
 */
export type DeliveryState = 'none' | 'in-flight' | 'delivered' | 'nothing-to-deliver' | 'failed';

export interface Delivery {
  state: DeliveryState;
  /**
   * The deliver unit's FULL id, which is also the `unitKey` the output route
   * resolves (its most-specific pass matches `u.id === unitKey` — so an
   * overlay-named phase needs no key guessing, EC61). `null` when `state` is
   * `'none'`.
   */
  unitId: string | null;
  /** `denial_reason` VERBATIM off the list wire — never re-worded, never synthesized. */
  reason: string | null;
  /**
   * The PR url when the SERVER carries it (`session.delivery`, wicked-crew#321).
   * `null` on today's daemon, which is what the one per-run transcript fetch is
   * for; when crew ships the field this goes non-null and the fetch stops firing.
   */
  url: string | null;
}

/** crew#318's refusal, matched ONLY to classify — the message itself renders verbatim. */
const NOTHING_TO_DELIVER = /nothing to deliver/i;

/**
 * The PR url in a deliver transcript — crew's own grep, mirrored
 * (`packages/crew/src/core/deliver.ts:162`: `grep -Eo
 * 'https://[^[:space:]]+/pull/[0-9]+' | tail -1`).
 *
 * Requiring the DIGITS is the entire point: `https://…/pull/new/wicked/<run>`
 * — the create-PR form git prints on every push — appears FIRST and reads like
 * the answer. It is a trap, and this regex cannot match it. The LAST match wins,
 * same as crew's `tail -1`.
 */
export function prUrlFrom(text: string): string | null {
  const matches = text.match(/https:\/\/\S+\/pull\/\d+/g);
  return matches === null ? null : (matches[matches.length - 1] ?? null);
}

/**
 * This run's deliver unit, or `null`. The id suffix is the primary key; the
 * `tool_cmd` probe is the fallback for an operator overlay that named its phase
 * something else (`tool_cmd` is optional on the wire, so a miss degrades to
 * `'none'` — silent, never wrong).
 */
export function deliverUnit(view: SessionView): WorkUnit | null {
  const byId = view.units.find((u) => u.id.endsWith(':deliver'));
  if (byId !== undefined) return byId;
  return view.units.find((u) => (u.tool_cmd ?? []).join(' ').includes('gh pr create')) ?? null;
}

/** The whole derivation, from the DTO the caller already holds. Never fetches. */
export function deliveryOf(view: SessionView): Delivery {
  const unit = deliverUnit(view);
  if (unit === null) return { state: 'none', unitId: null, reason: null, url: null };

  const reason = unit.denial_reason;
  const state: DeliveryState =
    unit.status === 'done' ? 'delivered'
    : unit.status === 'rejected'
      ? (reason !== null && NOTHING_TO_DELIVER.test(reason) ? 'nothing-to-deliver' : 'failed')
      : 'in-flight';

  // `session.delivery` is declared in ../api/types.js, not in the installed
  // api-types — the cast is the honest spelling until studio bumps (see there).
  const declared = (view.session as SessionWithDelivery).delivery;
  const url = typeof declared?.url === 'string' && declared.url !== '' ? declared.url : null;

  return { state, unitId: unit.id, reason, url };
}

/** The badge/chip word per state — `'none'` has nothing to say and says nothing. */
export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  'none':               '',
  // Never "in flight": a cancelled run's deliver unit is `pending` forever, and
  // the word would claim motion that stopped. "pending" is true either way.
  'in-flight':          'pending',
  'delivered':          'PR open',
  'nothing-to-deliver': 'nothing delivered',
  'failed':             'deliver failed',
};

/** Token per state — failure is `--status-fail`, delivery is the accent, never green-as-shipped. */
export const DELIVERY_COLOR: Record<DeliveryState, string> = {
  'none':               'var(--ink-dim)',
  'in-flight':          'var(--ink-muted)',
  'delivered':          'var(--accent)',
  'nothing-to-deliver': 'var(--status-fail)',
  'failed':             'var(--status-fail)',
};

/**
 * The project-page summary over ALL runs (never the MAX_ROWS window — run
 * 665a9aeb, the one that delivered nothing while reading as the most productive
 * run in the project, is not in the visible six).
 */
export function deliverySummary(views: readonly SessionView[]): string {
  const counts: Record<DeliveryState, number> = {
    'none': 0, 'in-flight': 0, 'delivered': 0, 'nothing-to-deliver': 0, 'failed': 0,
  };
  for (const v of views) counts[deliveryOf(v).state] += 1;

  const parts: string[] = [];
  if (counts['delivered'] > 0) parts.push(`${counts['delivered']} delivered`);
  if (counts['nothing-to-deliver'] > 0) parts.push(`${counts['nothing-to-deliver']} delivered nothing`);
  if (counts['failed'] > 0) parts.push(`${counts['failed']} failed to deliver`);
  if (counts['in-flight'] > 0) parts.push(`${counts['in-flight']} still to deliver`);
  if (counts['none'] > 0) parts.push(`${counts['none']} no deliver phase`);
  return parts.join(' · ');
}
