import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { deliverySummary, outcomeLine } from '../src/board/proposalCard.js';
import { finalWords } from '../src/board/runConversation.js';
import { hasDeliveredRef } from '../src/components/delivery.js';

// J4 (rig run f3d30829): studio said "Delivered" and "The checks passed" while nothing was pushed, and
// "The checks passed" over a hand-over nothing re-verified. "Delivered" is said only over a recorded pull
// request or pushed branch; "The checks passed" only of the tree that shipped through a checked hand-over.

const RUN = 'r-j4';
const PR = 'https://github.com/acme/core/pull/1117';

function unit(key: string, ord: number, status: string): SessionView['units'][number] {
  return {
    id: `${RUN}:${key}`, session_id: RUN, ord, description: key, stage: 'build', role: 'neutral', assigned_cli: 'claude',
    assigned_invocation: null, council_task_ref: null, routing: null, denial_reason: null, phase_ref: key,
    conformance_ref: null, phase_status: null, collection_scope: null, status,
  } as unknown as SessionView['units'][number];
}

function run(status: string, deliver: string, extra: Record<string, unknown> = {}): SessionView {
  return {
    session: { id: RUN, status, problem: 'fix it', clis: ['claude'], unit_ix: 0, ...extra },
    units: [unit('build', 0, 'done'), unit('deliver', 1, deliver)],
  } as unknown as SessionView;
}

const PASSED = { passed: true, tests: null, nothing: false, reviewers: [] as string[] };

describe('J4: "Delivered" only over a pushed ref', () => {
  it('a stranded lift (the engine refused, nothing pushed) never reads Delivered', () => {
    const stranded = run('completed', 'rejected', { delivery: 'stranded' });
    expect(hasDeliveredRef(stranded)).toBe(false);
    expect(deliverySummary(stranded)).toBe('Not pushed yet');
    expect(outcomeLine(stranded)).toBe('Finished, but the work hasn’t been pushed anywhere yet');
    const w = finalWords(stranded, { done: 2, total: 2 }, PASSED);
    expect(w.lead).toBe('Not delivered');
    expect(w.line).not.toMatch(/checks passed|Tests pass/i);
    expect(w.line).toContain('Deliver — open a PR');
  });

  it('a failed delivery and a finished deliver step with no recorded ref say what happened', () => {
    expect(deliverySummary(run('completed', 'rejected'))).toBe('Delivery failed');
    expect(finalWords(run('completed', 'rejected'), { done: 2, total: 2 }, PASSED).lead).toBe('Not delivered');
    // The deliver unit finished, but no PR url or pushed branch is on record: not "Delivered".
    const unrecorded = run('completed', 'done');
    expect(hasDeliveredRef(unrecorded)).toBe(false);
    expect(deliverySummary(unrecorded)).toBe('No pushed ref recorded');
    expect(outcomeLine(unrecorded)).not.toMatch(/delivered/i);
    const w = finalWords(unrecorded, { done: 2, total: 2 }, PASSED);
    expect(w.line).not.toMatch(/checks passed/i);
    expect(w.line).toContain('No pull request or pushed branch is recorded.');
  });

  it('a recorded pull request or pushed branch is Delivered', () => {
    const pr = run('completed', 'done', { delivery: 'delivered', deliverUrl: PR });
    expect(hasDeliveredRef(pr)).toBe(true);
    expect(deliverySummary(pr)).toBe('Pull request #1117');
    expect(outcomeLine(pr)).toBe('Finished · delivered');
    const pushed = run('completed', 'done', { delivery: 'pushed', deliverBranch: 'wicked/r-j4' });
    expect(deliverySummary(pushed)).toBe('Branch pushed');
    expect(deliverySummary(run('completed', 'done', { delivery: 'delivered' }))).toBe('Delivered');
  });
});

describe('J4: "The checks passed" only of the tree that shipped', () => {
  it('the engine’s checked hand-over says the checks passed', () => {
    const pr = run('completed', 'done', { delivery: 'delivered', deliverUrl: PR });
    const w = finalWords(pr, { done: 2, total: 2 }, PASSED);
    expect(w.lead).toBe('Done');
    expect(w.line).toBe('The checks passed. Pull request #1117 is open.');
  });

  it('a post-hoc hand-over nothing re-verified says so, never "The checks passed" (the f3d30829 message)', () => {
    const posthoc = run('completed', 'rejected', { delivery: 'delivered', deliverUrl: PR });
    const w = finalWords(posthoc, { done: 2, total: 2 }, { ...PASSED, deliveryVerified: false });
    expect(w.line).not.toMatch(/checks passed/i);
    expect(w.line).toBe('Nothing re-checked the tree that was delivered. Pull request #1117 is open.');
  });

  it('an override is said as the override (studio#899 words), beside an unverified hand-over too', () => {
    const posthoc = run('completed', 'rejected', { delivery: 'delivered', deliverUrl: PR });
    const overridden = 'Overridden by you: test failed on this change and its base.';
    const w = finalWords(posthoc, { done: 2, total: 2 }, { ...PASSED, overridden, deliveryVerified: false });
    // Operator 2026-10-29: an approved floor's delivery leads with where it went ("Delivered as pull request #N").
    expect(w.lead).toBe('Delivered as pull request #1117');
    expect(w.line).toBe(`${overridden} Nothing re-checked the tree that was delivered.`);
  });

  it('a run with no deliver step keeps its acceptance sentence', () => {
    const noDeliver = { session: { id: RUN, status: 'completed', problem: 'p', clis: [], unit_ix: 0 }, units: [unit('build', 0, 'done')] } as unknown as SessionView;
    expect(finalWords(noDeliver, { done: 1, total: 1 }, PASSED).line).toBe('The checks passed.');
  });
});
