import { describe, expect, it } from 'vitest';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';
import {
  canDeliver,
  DELIVERY_COLOR,
  DELIVERY_LABEL,
  deliveryOf,
  deliverySummary,
  resolveDelivery,
} from '../src/components/delivery.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The 0.18.0 delivery wire (crew#393) — `session.delivery` is now the daemon's
 * OWN tri-state string (`delivered | stranded | none`) with the PR url in
 * `deliverUrl`, RESHAPED from 0.11–0.17's `{ kind, url }` object. The
 * derivation's contract:
 *
 *  - the wire's POSITIVE verdicts (`delivered`, `stranded`) are authoritative —
 *    `stranded` in particular is WIRE-ONLY (its "worktree still exists" half
 *    lives on the daemon's disk, and studio never guesses it);
 *  - the wire's `'none'` DEFERS to the unit facts, which say more (a rejected
 *    deliver unit's `denial_reason` is the richer, equally-true story);
 *  - the legacy object form is still read for its url, never mistaken for a
 *    state word;
 *  - every url — `deliverUrl` included — passes the same shape gate as always.
 */

function stamped(
  v: SessionView,
  delivery: Exclude<SessionWithDelivery['delivery'], undefined>,
  deliverUrl?: string,
): SessionView {
  const session = { ...v.session } as SessionWithDelivery;
  session.delivery = delivery;
  if (deliverUrl !== undefined) session.deliverUrl = deliverUrl;
  return { ...v, session: session as SessionView['session'] };
}

/** A completed repo-scoped build run with NO deliver unit (the 83052f0b shape). */
function completedRun(id = 'r-1'): SessionView {
  return makeView(
    { id, workflow_id: 'feature', status: 'completed', workdir: '/w/tree', repo_ref: 'studio-api' },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' })],
  );
}

const PR = 'https://github.com/o/r/pull/42';

describe('the wire tri-state (crew#393)', () => {
  it("delivery: 'delivered' + deliverUrl ⇒ pr-open, straight off the DTO, zero reads", () => {
    const d = deliveryOf(stamped(completedRun(), 'delivered', PR));
    expect(d.state).toBe('delivered');
    expect(d.url).toBe(PR);
    const r = resolveDelivery(d);
    expect(r.claim).toBe('pr-open');
    expect(r.href).toBe(PR);
  });

  it("delivery: 'delivered' with a NON-CONFORMING deliverUrl claims the phase, never the link", () => {
    for (const bad of ['javascript:alert(1)', 'https://x/pull/new/wicked/r-1', '']) {
      const r = resolveDelivery(deliveryOf(stamped(completedRun(), 'delivered', bad)));
      expect(r.claim, bad).toBe('delivered');
      expect(r.href, bad).toBeNull();
    }
  });

  it("delivery: 'stranded' ⇒ the stranded state — wire-only, whatever the units say", () => {
    const d = deliveryOf(stamped(completedRun(), 'stranded'));
    expect(d.state).toBe('stranded');
    const r = resolveDelivery(d);
    expect(r.claim).toBe('stranded');
    expect(r.href).toBeNull();
    // Amber, never fail-red and never the accent: finished work waiting on a
    // person is not a failure and not a PR.
    expect(DELIVERY_LABEL['stranded']).toBe('stranded');
    expect(DELIVERY_COLOR['stranded']).toBe('var(--status-gate)');
  });

  it('studio NEVER infers stranded — a bare completed run without the wire word stays as it was', () => {
    // The "worktree still exists" half of the definition lives on the daemon's
    // disk. Without the wire field this run reads exactly as it did pre-0.18.
    expect(deliveryOf(completedRun()).state).toBe('none');
  });

  it("the post-hoc prUrl upgrades a stranded run to pr-open IN PLACE (resolveDelivery's readUrl)", () => {
    const r = resolveDelivery(deliveryOf(stamped(completedRun(), 'stranded')), PR);
    expect(r.state).toBe('delivered');
    expect(r.claim).toBe('pr-open');
    expect(r.href).toBe(PR);
  });

  it('…but only through the same shape gate as every other PR claim', () => {
    const r = resolveDelivery(
      deliveryOf(stamped(completedRun(), 'stranded')),
      'https://x/pull/new/wicked/r-1',
    );
    expect(r.claim).toBe('stranded');
    expect(r.href).toBeNull();
  });

  it("the wire's 'none' DEFERS to the unit facts — a rejected deliver unit keeps its story", () => {
    const v = makeView(
      { id: 'r-2', workflow_id: 'feature', status: 'failed' },
      [makeUnit({ id: 'r-2:deliver', session_id: 'r-2', ord: 1, status: 'rejected', denial_reason: 'rebase conflict — nothing pushed' })],
    );
    const d = deliveryOf(stamped(v, 'none'));
    expect(d.state).toBe('failed');
    expect(d.reason).toBe('rebase conflict — nothing pushed');
  });

  it('the LEGACY 0.11–0.17 object form is still read for its url, never as a state word', () => {
    const v = makeView(
      { id: 'r-3', workflow_id: 'feature', status: 'completed' },
      [makeUnit({ id: 'r-3:deliver', session_id: 'r-3', ord: 1, status: 'done' })],
    );
    const d = deliveryOf(stamped(v, { kind: 'pull_request', url: PR }));
    expect(d.state).toBe('delivered'); // from the unit, not the object
    expect(d.url).toBe(PR);            // from the object's url
    expect(resolveDelivery(d).claim).toBe('pr-open');
  });

  it('a wire-stranded run is deliverable with NO catalog lookup — the wire is the evidence', () => {
    // The materialised `wf-<runId>` id is in no catalog, ever; the `'none'`
    // licence would withhold. The daemon's own verdict outranks classification,
    // exactly as a deliver unit in hand does.
    const v = makeView(
      { id: 'r-4', workflow_id: 'wf-r-4-materialised', status: 'completed', workdir: '/w/t' },
      [],
    );
    expect(canDeliver(stamped(v, 'stranded'))).toBe(true);
    expect(canDeliver(v), 'without the wire word, nothing changes').toBe(false);
  });

  it('deliverySummary counts the stranded bucket, in DELIVERY_LABEL wording', () => {
    const views = [
      stamped(completedRun('r-a'), 'stranded'),
      stamped(completedRun('r-b'), 'stranded'),
      stamped(completedRun('r-c'), 'delivered', PR),
    ];
    expect(deliverySummary(views)).toBe('1 PR open · 2 stranded');
  });
});
