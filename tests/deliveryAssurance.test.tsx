/**
 * crew ≥ 0.9.0 (wicked-core#850 EX-03 / EX-04): crew records what assured a DELIVERY on the session
 * (`delivery_assurance`). A post-hoc hand-over that nothing re-verified is labelled unverified, with
 * whether the tree moved; the QE acceptance check is said; its receipt stands in when no lift ran.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { deliveryAssuranceOf, deliveryReceiptOf, unverifiedDeliveryLine } from '../src/board/assuranceModel.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { useRunEventStore } from '../src/store/events.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';

const RECEIPT = { mode: 'full', required: ['distinct_evaluator', 'judge', 'qe_acceptance'], ran: ['repo_checks', 'judge'], skipped: [], creator: null, evaluator: null, judge: null, tree: 'bbbbbbbbbb', attempt: 0 };

function delivered(da: Record<string, unknown> | undefined, id = 'r-ph'): SessionView {
  const v = makeView(
    { id, workflow_id: 'feature', status: 'completed', workdir: `/w/trees/${id}`, repo_ref: 'tally-kit' },
    [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'done' }),
    ],
  );
  const s = v.session as SessionWithDelivery;
  s.delivery = 'pushed';
  s.deliverBranch = `wicked/${id}`;
  s.deliverRemote = 'https://example.invalid/tally.git';
  if (da !== undefined) (s as unknown as { delivery_assurance?: unknown }).delivery_assurance = da;
  return v;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('the recorded delivery assurance', () => {
  it('reads null-safely; an older daemon has none', () => {
    expect(deliveryAssuranceOf(delivered(undefined))).toBeNull();
    expect(deliveryAssuranceOf(delivered({ via: 'post_hoc' }))).toBeNull();
    const d = deliveryAssuranceOf(delivered({ verified: false, via: 'post_hoc', receipt: RECEIPT, treeBefore: 'aaaaaaaaaa', treeAfter: 'bbbbbbbbbb', qeAcceptance: null }))!;
    expect(d.receipt?.ran).toEqual(['repo_checks', 'judge']);
    expect(unverifiedDeliveryLine(d)).toBe('Unverified delivery: nothing re-verified the tree this hand-over pushed. The tree moved from aaaaaaa to bbbbbbb in the hand-over.');
    expect(unverifiedDeliveryLine({ ...d, treeAfter: 'aaaaaaaaaa' })).toMatch(/The tree did not move \(aaaaaaa\)\.$/);
    expect(unverifiedDeliveryLine({ ...d, verified: true })).toBeNull();
  });

  it('its receipt stands in when no lift ran; an in-run delivery\'s current lift wins', () => {
    const v = delivered({ verified: false, via: 'post_hoc', receipt: RECEIPT, treeBefore: null, treeAfter: null, qeAcceptance: null });
    expect(deliveryReceiptOf(v, [])!.tree).toBe('bbbbbbbbbb');
    const inRun = delivered({ verified: true, via: 'deliver_lift', receipt: RECEIPT, treeBefore: null, treeAfter: null, qeAcceptance: null });
    const lift = deliveryReceiptOf(inRun, [{ type: 'deliverLiftEvaluated', ord: 1, assurance: { ...RECEIPT, tree: 'cccccccccc' } }] as never)!;
    expect(lift.tree).toBe('cccccccccc');
  });

  it('codex: a post-hoc hand-over\'s receipt wins over an earlier attempt\'s lift', () => {
    const v = delivered({ verified: false, via: 'post_hoc', receipt: RECEIPT, treeBefore: null, treeAfter: null, qeAcceptance: null });
    const r = deliveryReceiptOf(v, [{ type: 'deliverLiftEvaluated', ord: 1, assurance: { ...RECEIPT, tree: 'aaaa000000' } }] as never)!;
    expect(r.tree).toBe('bbbbbbbbbb');
  });

  it('codex: this browser\'s post-hoc answer stands in before the record refreshes; any post-hoc landing is unverified', () => {
    const v = delivered(undefined);
    const answered = deliveryAssuranceOf(v, { raw: { verified: false, via: 'post_hoc', receipt: null, treeBefore: 'a1a1a1a1', treeAfter: 'a1a1a1a1', qeAcceptance: null }, delivered: true })!;
    expect(unverifiedDeliveryLine(answered)).toMatch(/did not move/);
    const older = deliveryAssuranceOf(v, { delivered: true })!;
    expect(older.verified).toBe(false);
    expect(deliveryAssuranceOf(v, { delivered: false })).toBeNull();
  });

  it('codex: a post-hoc landing in this browser never reads "accepted" on the panel', () => {
    const v = delivered(undefined, 'r-ph2');
    useRunEventStore.setState({ byRun: { 'r-ph2': [{ type: 'gateEvaluated', ord: 0, combined: true, denial: null, assurance: { ...RECEIPT, ran: ['judge'], creator: 'claude', judge: 'codex' } }] as never } });
    usePostHocDeliverStore.setState({ byRun: { 'r-ph2': { phase: 'delivered', prUrl: 'https://example.invalid/pr/1' } } });
    render(<RunDelivery view={v} />);
    expect(screen.getByTestId('run-delivery-unverified')).toBeTruthy();
    expect(screen.getByTestId('assurance-kind').textContent).toBe('Checked independently');
  });

  it('codex r2: a post-hoc hand-over hides the superseded engine lift on the panel', () => {
    const v = delivered({ verified: false, via: 'post_hoc', receipt: RECEIPT, treeBefore: null, treeAfter: null, qeAcceptance: null }, 'r-ph3');
    useRunEventStore.setState({ byRun: { 'r-ph3': [{ type: 'deliverLiftEvaluated', session: 'r-ph3', ord: 1, outcome: 'conflict', baseRef: 'origin/main', baseBefore: 'a', baseAfter: 'b', treeBefore: 'c', treeAfter: 'd', conflicts: ['x.ts'], note: null }] as never } });
    const { unmount } = render(<RunDelivery view={v} />);
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
    expect(screen.getByTestId('run-delivery-unverified')).toBeTruthy();
    unmount();
    // Control: the same log under an in-run delivery shows the lift.
    render(<RunDelivery view={delivered({ verified: true, via: 'deliver_lift', receipt: RECEIPT, treeBefore: null, treeAfter: null, qeAcceptance: null }, 'r-ph3')} />);
    expect(screen.getByTestId('deliver-lift')).toBeTruthy();
  });

  it('the panel: unverified, never "accepted", and the QE check said', () => {
    render(<RunDelivery view={delivered({ verified: false, via: 'post_hoc', receipt: RECEIPT, treeBefore: 'aaaaaaaaaa', treeAfter: 'bbbbbbbbbb', qeAcceptance: { satisfied: true, reason: 'PASS', verdictId: 'v-1', reviewer: 'qe-bot' } })} />);
    expect(screen.getByTestId('run-delivery-unverified').textContent).toMatch(/^Unverified delivery/);
    expect(screen.getByTestId('assurance-kind').textContent).not.toMatch(/accepted/i);
    expect(screen.getByTestId('run-delivery-qe').textContent).toBe('QE acceptance: PASS by qe-bot (v-1)');
  });

  it('a verified delivery: no unverified line, an unmet QE check in its own words', () => {
    render(<RunDelivery view={delivered({ verified: true, via: 'deliver_lift', receipt: RECEIPT, treeBefore: null, treeAfter: null, qeAcceptance: { satisfied: false, reason: 'no attributed PASS for this run', verdictId: null, reviewer: null } })} />);
    expect(screen.queryByTestId('run-delivery-unverified')).toBeNull();
    expect(screen.getByTestId('run-delivery-qe').getAttribute('data-satisfied')).toBe('false');
    expect(screen.getByTestId('run-delivery-qe').textContent).toBe('QE acceptance not met: no attributed PASS for this run');
  });
});
