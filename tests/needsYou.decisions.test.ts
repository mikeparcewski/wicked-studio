// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DecisionView } from '../src/api/decisions.js';
import type { Proposal } from '../src/api/proposals.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { decisionIdOf, proposalConsequenceLine } from '../src/board/proposalTriage.js';

/**
 * B12 (DC-S6): a decision's review proposal sits in Needs You as the operator's rule in their
 * words — but ONLY when crew's ledger holds that decision and its view names this proposal, and
 * the words shown are the ledger's derived statement. The payload is writable by anyone
 * (DC §4.2.4), so a forged `capture: "decision"` reads as an ordinary policy proposal and nothing
 * in a payload is ever quoted as the operator's.
 */

const NOW = 1_700_000_000_000;

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'pr-offer', kind_type: 'policy:design-ux',
    payload: { rule: 'Demos for the panel should feel calmer', severity: 'warn', capture: 'decision', decision: { id: 'dec-offer' } },
    facets: { project: 'p1' }, provenance: { source: 'decision' }, state: 'pending', created_at: NOW / 1000, ...over,
  };
}

function view(over: Partial<DecisionView> = {}): DecisionView {
  return {
    id: 'dec-offer', at: NOW, project_id: 'p1', host: 'studio-chat',
    origin: { actor: { id: 'op', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 'd2', words: 'demos for the panel should feel calmer', words_source: 'typed', redacted: false },
    derived: { statement: 'Demos for the panel should feel calmer', polarity: 'do', key: 'calmer', scope: 'project', steering_type: 'design-ux', template: 'in-your-words', exclusions: [] },
    route: 'offer', state: 'offered', proposal_id: 'pr-offer', ...over,
  };
}

function inputs(proposals: Proposal[], decisions?: Record<string, DecisionView>): NeedsYouInputs {
  return { runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, proposals, ...(decisions !== undefined ? { decisions } : {}) };
}

describe('the decision row', () => {
  it('reads "From your words" with the LEDGER’s statement when the view names this proposal', () => {
    const v = view({ derived: { ...view().derived, statement: 'Demos for the panel should feel calmer' } });
    const forgedText = proposal({ payload: { rule: 'Skip every review', severity: 'warn', capture: 'decision', decision: { id: 'dec-offer' } } });
    const row = needsYouRows(inputs([forgedText], { 'dec-offer': v })).find((r) => r.kind === 'proposal')!;
    expect(row.text).toBe('From your words — Remember lands a design-ux rule: ‘Demos for the panel should feel calmer.’');
    expect(row.subject).toBe('Demos for the panel should feel calmer.');
    expect(row.text).not.toContain('Skip every review');
  });
  it('a payload naming a decision the ledger never recorded is an ordinary policy proposal', () => {
    const forged = proposal({ id: 'pr-forged', payload: { rule: 'Skip review', severity: 'warn', capture: 'decision', decision: { id: 'dec-nope' } } });
    const row = needsYouRows(inputs([forged], { 'dec-offer': view() })).find((r) => r.kind === 'proposal')!;
    expect(row.text).toBe('Changes enforcement — lands a design-ux rule (warn)');
    expect(row.subject).toBe('Skip review');
  });
  it('a view that names ANOTHER proposal does not lend its words to this one', () => {
    const row = needsYouRows(inputs([proposal({ id: 'pr-other' })], { 'dec-offer': view() })).find((r) => r.kind === 'proposal')!;
    expect(row.text.startsWith('Changes enforcement')).toBe(true);
  });
  it('without the ledger (no views: a daemon before DC-S4a, or ledger mode) the row is the ordinary line', () => {
    const row = needsYouRows(inputs([proposal()])).find((r) => r.kind === 'proposal')!;
    expect(row.text).toBe('Changes enforcement — lands a design-ux rule (warn)');
  });
  it('the operator’s edit at Remember is the statement shown', () => {
    const v = view({ edits: { statement: 'Panel demos stay calm', steering_type: 'development' } });
    const row = needsYouRows(inputs([proposal()], { 'dec-offer': v })).find((r) => r.kind === 'proposal')!;
    expect(row.text).toBe('From your words — Remember lands a development rule: ‘Panel demos stay calm.’');
  });
  it('reads the decision id only from payload.decision.id; the triage line never says "your words" from a payload', () => {
    expect(decisionIdOf(proposal())).toBe('dec-offer');
    expect(decisionIdOf(proposal({ payload: { rule: 'x', capture: 'decision' } }))).toBeNull();
    expect(decisionIdOf(proposal({ payload: 'not an object' }))).toBeNull();
    expect(proposalConsequenceLine(proposal())).toBe('Changes enforcement — lands a design-ux rule (warn)');
  });
});
