import type { SessionView, SessionWithDelivery, WorkUnit } from '../api/types.js';
import { deliverKindOf, type IsSystemWorkflow } from './runMode.js';

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
 * ── THE RULE THIS MODULE ENFORCES ────────────────────────────────────────────
 * **Claiming "a PR is open" requires a URL IN HAND. `status === 'done'` alone
 * supports only "the deliver phase ran."**
 *
 * `done` means crew APPROVED the deliver phase, and that is all it means. Only a
 * post-crew#318 daemon fails the phase when there was nothing to deliver, so an
 * older run can be `done` having pushed a branch and opened no PR at all — run
 * 665a9aeb is exactly that: deliver unit `done`, `denial_reason: null`, and a
 * 677-byte transcript with ZERO `/pull/\d+` matches and one `/pull/new/` form.
 * The first cut of this slice rendered "PR open" for precisely the run whose
 * false productivity signal it was written to remove.
 *
 * So the derivation stops at {@link DeliveryState} (the PHASE fact, free off the
 * list wire) and the CLAIM is a second, url-aware step — {@link resolveDelivery}
 * — which every rendering surface goes through. Nothing may read
 * `DELIVERY_LABEL` off a bare `DeliveryState`; the map is keyed by
 * {@link DeliveryClaim} so that spelling does not typecheck.
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
 * What this run's deliver PHASE is, as five mutually exclusive facts. This is
 * the phase, never the artifact — see {@link DeliveryClaim} for what a surface
 * is allowed to say out loud.
 *
 *  - `delivered` — the deliver phase was APPROVED (`done`). It is not "a PR",
 *    it is not "shipped" and it is not "merged".
 *  - `nothing-to-deliver` — denied because the run committed nothing (crew#318).
 *  - `failed` — denied for any other reason; the reason is rendered verbatim.
 *  - `in-flight` — the deliver phase has not resolved (`pending`/`distributed`).
 *  - `none` — this run has no deliver phase at all.
 */
export type DeliveryState = 'none' | 'in-flight' | 'delivered' | 'nothing-to-deliver' | 'failed';

/**
 * What a surface may SAY — {@link DeliveryState} with `delivered` split by the
 * only thing that licenses the PR claim: whether a url is in hand.
 *
 *  - `pr-open` — a url is in hand (`session.delivery.url` off the wire, or the
 *    one transcript read the rail body makes). This alone earns the PR claim,
 *    the accent token and a link.
 *  - `delivered` — the phase was approved and NO url is known here. Every
 *    zero-fetch list surface lives in this arm, and so does a detail view whose
 *    read came back without a url. The wording describes the phase.
 */
export type DeliveryClaim = DeliveryState | 'pr-open';

export interface Delivery {
  state: DeliveryState;
  /**
   * The deliver unit's FULL id, which is also the `unitKey` the output route
   * resolves (its most-specific pass matches `u.id === unitKey` — so an
   * overlay-named phase needs no key guessing, EC61). `null` when `state` is
   * `'none'`.
   */
  unitId: string | null;
  /**
   * `denial_reason` VERBATIM off the list wire — never re-worded, never
   * synthesized. An EMPTY string normalizes to `null` here (the same
   * absent-and-empty-are-one-thing class of bug already fixed in
   * `store/delivery.ts`): `reason ?? '…'` keeps `''` and the panel paints a
   * blank red paragraph where crew's message belongs. One normalization, at
   * the derivation, so no surface has to remember.
   */
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
 * `gh pr create` INVOKED, not merely mentioned.
 *
 * A bare `.includes('gh pr create')` matched any unit whose joined command
 * contains the string anywhere — `grep -rn 'gh pr create' docs/`, `echo "run gh
 * pr create yourself"`, a heredoc of instructions — and any one of those would
 * have masqueraded as the run's deliver phase and inherited its whole claim.
 * The invocation is anchored instead: `gh` must start the string or follow a
 * shell command separator (`;`, `&&`, `||`, a pipe, a newline, a subshell open).
 * Quoted mentions are preceded by a quote, so they cannot match.
 *
 * Verified against the two real deliver commands on the live daemon: both run it
 * after `;`/newline (`… git push -u origin "$B"; gh pr create --head "$B" --fill`).
 */
const INVOKES_GH_PR_CREATE = /(?:^|[;&|(\n])\s*(?:sudo\s+|env\s+\S+=\S+\s+)*gh\s+pr\s+create\b/;

/**
 * This run's deliver unit, or `null`. The id suffix is the primary key; the
 * `tool_cmd` probe is the fallback for an operator overlay that named its phase
 * something else (`tool_cmd` is optional on the wire, so a miss degrades to
 * `'none'` — silent, never wrong).
 */
export function deliverUnit(view: SessionView): WorkUnit | null {
  const byId = view.units.find((u) => u.id.endsWith(':deliver'));
  if (byId !== undefined) return byId;
  return view.units.find((u) => INVOKES_GH_PR_CREATE.test((u.tool_cmd ?? []).join(' '))) ?? null;
}

/** The whole derivation, from the DTO the caller already holds. Never fetches. */
export function deliveryOf(view: SessionView): Delivery {
  const unit = deliverUnit(view);
  if (unit === null) return { state: 'none', unitId: null, reason: null, url: null };

  // Absent and empty are the same "crew recorded nothing" — see `Delivery.reason`.
  const reason = unit.denial_reason === '' ? null : unit.denial_reason;
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

/** A {@link Delivery} plus the claim it licenses and the url that licensed it. */
export interface ResolvedDelivery extends Delivery {
  /** What the surface may say. See {@link DeliveryClaim}. */
  claim: DeliveryClaim;
  /** The PR url in hand, wire-carried or read — `null` unless `claim` is `'pr-open'`. */
  href: string | null;
}

/**
 * The claim step. **Every rendering surface goes through this**, so the badge on
 * a section header and the body inside it cannot say different things (D1: the
 * badge derived from `deliveryOf` alone and painted "PR open" in `--accent`
 * while the body it sat on said no PR link was recorded).
 *
 * @param d        the phase fact, from {@link deliveryOf}.
 * @param readUrl  a url recovered by the ONE sanctioned per-run transcript read
 *                 (`store/delivery.ts`). Omit it — as every zero-fetch list
 *                 surface does — and the delivered arm stays phase-only.
 */
export function resolveDelivery(d: Delivery, readUrl: string | null = null): ResolvedDelivery {
  if (d.state !== 'delivered') return { ...d, claim: d.state, href: null };
  // Empty is absent — the third member of the same class already normalized at
  // `Delivery.reason` and in `store/delivery.ts`. `deliveryOf` maps an empty
  // `session.delivery.url` to `null` at the derivation, but this function is
  // exported and takes a hand-built `Delivery`, and `'' ?? readUrl` keeps the
  // empty string: the claim would become `pr-open` in `--accent` over an
  // `href=""` link that points at the app itself. The ONE invariant this module
  // exists to hold is re-checked here rather than trusted from upstream.
  const candidate = d.url ?? readUrl;
  const href = candidate === null || candidate === '' ? null : candidate;
  return { ...d, claim: href === null ? 'delivered' : 'pr-open', href };
}

/**
 * The badge/chip word per CLAIM — `'none'` has nothing to say and says nothing.
 *
 * `'delivered'` is the honest half of the split: crew approved the phase and no
 * url is in hand, so the word names the PHASE and stops. It must not read as a
 * failure either — a pre-crew#318 run whose deliver phase completed is not a
 * failure, it is simply not evidence of a PR — which is why it stays neutral in
 * {@link DELIVERY_COLOR} rather than borrowing `--status-fail`.
 */
export const DELIVERY_LABEL: Record<DeliveryClaim, string> = {
  'none':               '',
  // Never "in flight": a cancelled run's deliver unit is `pending` forever, and
  // the word would claim motion that stopped. "pending" is true either way. All
  // 12 `distributed` deliver units in the live corpus sit in terminal sessions
  // (10 cancelled, 2 failed) — not one of them is going to move again.
  'in-flight':          'pending',
  'delivered':          'deliver ran',
  'pr-open':            'PR open',
  'nothing-to-deliver': 'nothing delivered',
  'failed':             'deliver failed',
};

/**
 * Token per claim — failure is `--status-fail`, an actual PR is the accent,
 * never green-as-shipped. The phase-only `'delivered'` is deliberately MUTED:
 * accent would read as the PR claim the wording just declined to make, and
 * `--status-fail` would call a completed phase a failure.
 */
export const DELIVERY_COLOR: Record<DeliveryClaim, string> = {
  'none':               'var(--ink-dim)',
  'in-flight':          'var(--ink-muted)',
  'delivered':          'var(--ink-muted)',
  'pr-open':            'var(--accent)',
  'nothing-to-deliver': 'var(--status-fail)',
  'failed':             'var(--status-fail)',
};

/**
 * Can this run deliver at all? The ONE predicate behind both the rail's Delivery
 * section and the project census, so the two surfaces cannot disagree about what
 * a deliverable run is (D5: the rail hid Delivery from chat threads while the
 * census counted every one of them under "no deliver phase", and a chat-heavy
 * project read "3 delivered · 30 no deliver phase" — a number about chats,
 * dressed as a delivery finding).
 *
 * It calls studio#124's `deliverKindOf` — literally the same function the
 * COMPOSER classifies with, not a second copy of the rule (D-1: the composer
 * read `is_system` and this predicate read a five-id denylist, so `collab` and
 * every `interactive-*` were 'system' there and 'build' here). Only `'build'`
 * may deliver. `'system'` is machine-owned work the launch form hides;
 * `'freeform'` carries no workflow at all and `deliver` without `workflow` is a
 * 400 (api-types index.d.ts:955-956). Neither can ever produce a PR, so neither
 * gets a Delivery surface or a line in the census.
 *
 * @param isSystemWorkflow the AUTHORITATIVE `is_system` lookup, three-valued —
 *   see {@link IsSystemWorkflow}. This module stays PURE and table-testable: it
 *   imports no store and fires no fetch, so the caller (which has React) passes
 *   `store/workflowCache.useIsSystemWorkflow()`. Omitted, the derivation falls
 *   back to the denylist, which can only ever over-report deliverability — so a
 *   caller that renders a REMEDY must additionally require a positively-known
 *   def before saying it out loud (see `RunDelivery`).
 *
 * This is a VISIBILITY gate, not a wire read: {@link deliveryOf} stays
 * indifferent to `session.workflow_id` (EC61).
 */
export function canDeliver(view: SessionView, isSystemWorkflow?: IsSystemWorkflow): boolean {
  return deliverKindOf(view.session.workflow_id, isSystemWorkflow) === 'build';
}

/**
 * The project-page census over ALL deliverable runs (never the MAX_ROWS window —
 * run 665a9aeb, the one that read as the most productive in the project while
 * delivering nothing, is not in the visible six).
 *
 * Chats and the other non-deliverable kinds are filtered out entirely, per
 * {@link canDeliver} — pass the SAME `isSystemWorkflow` lookup the rail uses, or
 * the six ids the denylist misses (`collab`, the five `interactive-*`) come back
 * as "no deliver phase" and the D5 complaint is recreated for the document and
 * video threads. Wording tracks {@link DELIVERY_LABEL} exactly: the
 * `in-flight` bucket says "deliver pending", never "still to deliver" — the
 * label refuses forward-looking words because a cancelled run's unit stays
 * `pending` forever, and the census may not smuggle them back in (D3).
 */
export function deliverySummary(
  views: readonly SessionView[],
  isSystemWorkflow?: IsSystemWorkflow,
): string {
  const counts: Record<DeliveryClaim, number> = {
    'none': 0, 'in-flight': 0, 'delivered': 0, 'pr-open': 0, 'nothing-to-deliver': 0, 'failed': 0,
  };
  for (const v of views) {
    if (!canDeliver(v, isSystemWorkflow)) continue;
    // No `readUrl`: the census is a list surface and fires zero requests, so the
    // only url it can ever see is the wire-carried one (crew#321).
    counts[resolveDelivery(deliveryOf(v)).claim] += 1;
  }

  const parts: string[] = [];
  if (counts['pr-open'] > 0) parts.push(`${counts['pr-open']} PR open`);
  if (counts['delivered'] > 0) parts.push(`${counts['delivered']} ran deliver`);
  if (counts['nothing-to-deliver'] > 0) parts.push(`${counts['nothing-to-deliver']} delivered nothing`);
  if (counts['failed'] > 0) parts.push(`${counts['failed']} failed to deliver`);
  if (counts['in-flight'] > 0) parts.push(`${counts['in-flight']} deliver pending`);
  if (counts['none'] > 0) parts.push(`${counts['none']} no deliver phase`);
  return parts.join(' · ');
}
