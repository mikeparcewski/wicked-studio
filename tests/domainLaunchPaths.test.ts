/**
 * J6 S1 (coord round 2 on K1): every studio start of a domain model run carries a scope or says why not. The one
 * launch builder and the composer send the words as the scope; a batch Retry skips a domain run with words that point
 * to its own Retry (crew keeps no scope for the old run).
 */
import { describe, expect, it } from 'vitest';
import type { RosterSeat, SessionView } from '../src/api/types.js';
import { withWordsAsDomainScope, workflowLaunchBody } from '../src/board/launchModel.js';
import { retryBlocker } from '../src/board/repairMoves.js';

const choices = (workflowId: string, intent: string): Parameters<typeof workflowLaunchBody>[0] => ({
  workflowId, intent, seats: [], repoRef: 'repo-1', projectId: null, humanConfirm: undefined, deliver: null,
  autoDeliverGate: false, reducedAssurance: false, skipQeReason: null, chatId: null,
});

describe('the words are the scope', () => {
  it('the one builder sends the words as a domain model run\'s scope, and nothing for another workflow', () => {
    expect(workflowLaunchBody(choices('domain-extraction', '  How PAYCALC1 computes pay  ')))
      .toMatchObject({ problem: 'How PAYCALC1 computes pay', workflow: 'domain-extraction', domainScope: { intent: 'How PAYCALC1 computes pay' } });
    expect(workflowLaunchBody(choices('bug', 'fix the 500'))).not.toHaveProperty('domainScope');
    // No words, no scope: crew refuses it in its words, nothing is guessed.
    expect(workflowLaunchBody(choices('domain-extraction', ' '))).not.toHaveProperty('domainScope');
  });

  it('a body that already carries a scope (the launch form\'s card) keeps it', () => {
    const card = { intent: 'pay', scopeHash: 'a'.repeat(64) };
    expect(withWordsAsDomainScope({ problem: 'pay', workflow: 'domain-extraction', domainScope: card })).toEqual({ problem: 'pay', workflow: 'domain-extraction', domainScope: card });
  });
});

describe('a batch Retry', () => {
  const seat = { key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true } as RosterSeat;
  const failed = (workflow: string): SessionView => ({ session: { id: 'r1', workflow_id: workflow, clis: ['claude'], problem: 'How PAYCALC1 computes pay', status: 'failed' }, units: [] }) as unknown as SessionView;
  it('skips a domain model run with words that send the person to its own Retry; other runs go', () => {
    expect(retryBlocker(failed('domain-extraction'), [seat])).toBe('not relaunched: a domain model starts again from its words, so open it and choose Retry');
    expect(retryBlocker(failed('bug'), [seat])).toBeNull();
  });
});
