import { describe, expect, it } from 'vitest';
import type { Consideration } from '../src/api/considered.js';
import type { DecisionView } from '../src/api/decisions.js';
import type { SteeringRule } from '../src/api/steering.js';
import { ruleHistory, ruleOrigin, ruleSentence, whereConsidered } from '../src/board/ruleOrigin.js';

/**
 * The rule page's words (DES-DECISION-CAPTURE §3 B11, DC-S8): scope and effect as one sentence,
 * ORIGIN only from a decision that landed the rule, the history rows, and where it was considered.
 */

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'proposal:pr-auto', rule_type: 'policy', statement: 'Always check the payment provider’s records', severity: 'warn',
    confidence: 0.9, targets: { project: 'upload-endpoint' }, provenance: { source: 'chat', source_kinds: ['decision'] },
    steering_type: 'development', ...over,
  };
}

function decision(over: Partial<DecisionView> = {}): DecisionView {
  return {
    id: 'dec-auto', at: 1_700_000_000_000, project_id: 'upload-endpoint', host: 'studio-chat',
    origin: { actor: { id: 'operator', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 'd1', words: 'from now on, always check the payment provider’s records', words_source: 'typed', redacted: false },
    derived: { statement: 'Always check the payment provider’s records', polarity: 'do', key: 'k', scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [] },
    route: 'auto', state: 'remembered', how: 'auto', rule_id: 'proposal:pr-auto', proposal_id: 'pr-auto', ...over,
  };
}

/** A later decision that only restates the rule (no landed rule of its own). */
function restatement(id: string): DecisionView {
  const d = decision({ id, state: 'restated', route: 'restated', restates_rule_id: 'proposal:pr-auto' });
  delete d.rule_id;
  delete d.how;
  return d;
}
/** The rule made to apply everywhere (crew records no `how` on a widening). */
function widened(id: string, at: number): DecisionView {
  const d = decision({ id, at, state: 'widened' });
  delete d.how;
  return d;
}

describe('ruleSentence — scope and effect in one sentence', () => {
  it('a recall-only project rule', () => {
    expect(ruleSentence(rule(), 'Kestrel')).toBe('A Development rule for Kestrel — helpers are told about it when it applies; it never blocks.');
  });
  it('falls back to the project id when its name is unknown, and says everywhere for a rule with no project', () => {
    expect(ruleSentence(rule(), null)).toMatch(/for upload-endpoint —/);
    expect(ruleSentence(rule({ targets: {} }), null)).toMatch(/^A Development rule everywhere —/);
  });
  it('spells the effects, and a held testing rule by its obligations', () => {
    expect(ruleSentence(rule({ effect: 'deny' }), 'K')).toMatch(/blocks a gate when it fires\.$/);
    expect(ruleSentence(rule({ effect: 'allow' }), 'K')).toMatch(/allows outright when it fires\.$/);
    expect(ruleSentence(rule({ effect: 'allow_with_conditions', obligations: ['step:test', 'step:walkthrough'] }), 'K')).toMatch(/holds work to it: step:test, step:walkthrough\.$/);
  });
  it('leads a retired rule with Retired', () => {
    expect(ruleSentence(rule({ retired: true }), 'K')).toMatch(/^Retired\. A Development rule/);
  });
  it('never uses the word Followed', () => {
    for (const r of [rule(), rule({ effect: 'deny' }), rule({ effect: 'allow_with_conditions', obligations: ['step:test'] })]) {
      expect(ruleSentence(r, 'K')).not.toMatch(/\bFollowed\b/);
    }
  });
});

describe('ruleOrigin — ORIGIN only from the ledger', () => {
  it('reads words, actor, time, where and how from the decision that landed the rule', () => {
    const o = ruleOrigin(rule(), [decision()]);
    expect(o).not.toBeNull();
    expect(o?.words).toBe('from now on, always check the payment provider’s records');
    expect(o?.actor).toBe('operator');
    expect(o?.at).toBe(1_700_000_000_000);
    expect(o?.how).toBe('auto');
    expect(o?.where).toEqual({ kind: 'chat', chatId: 'chat-pay', turnId: 'd1', href: '/s/chat-pay' });
    expect(o?.approvedProposal).toBe(false);
    expect(o?.edited).toBeNull();
  });
  it('has no ORIGIN for a rule no decision landed (a doc-ingested or UI-authored rule)', () => {
    expect(ruleOrigin(rule({ id: 'PAT-100' }), [decision()])).toBeNull();
    expect(ruleOrigin(rule(), [])).toBeNull();
  });
  it('ignores a decision that merely restates or conflicts with the rule', () => {
    expect(ruleOrigin(rule(), [restatement('d2')])).toBeNull();
  });
  it('picks the newest landing decision; keeps the words when the statement was edited; flags a bare approval', () => {
    const older = decision({ id: 'old', at: 1, state: 'undone' });
    const newer = decision({ id: 'new', at: 2, how: 'chip', edits: { statement: 'Always check the provider, every time' } });
    const o = ruleOrigin(rule(), [older, newer]);
    expect(o?.decisionId).toBe('new');
    expect(o?.edited).toBe('Always check the provider, every time');
    expect(o?.words).toBe(newer.origin.words);
    const yes = ruleOrigin(rule(), [decision({ origin: { ...decision().origin, words: 'lets do it' } })]);
    expect(yes?.approvedProposal).toBe(true);
  });
  it('places a gate decision at the run’s gate', () => {
    const rest = Object.fromEntries(Object.entries(decision().origin).filter(([k]) => k !== 'chat_id' && k !== 'turn_id')) as DecisionView['origin'];
    const o = ruleOrigin(rule(), [decision({ host: 'gate', origin: { ...rest, run_id: 'r-1', gate_id: 'g-1', words: 'always X', choice: 'approve' } })]);
    expect(o?.where).toEqual({ kind: 'gate', runId: 'r-1', gateId: 'g-1', href: '/s/run%3Ar-1' });
    expect(o?.choice).toBe('approve');
  });
});

describe('ruleHistory — the outcomes in time order', () => {
  it('remembered, then undone, then restated, then widened; plus what it replaces', () => {
    const rows = ruleHistory(rule({ supersedes: ['proposal:pr-old'] }), [
      widened('c', 30),
      decision({ id: 'a', at: 10, how: 'chip' }),
      { ...restatement('b'), at: 20 },
    ]);
    expect(rows.map((r) => r.text)).toEqual([
      'Replaces proposal:pr-old',
      'Remembered — remembered when you clicked Remember',
      'Restated in your words — already in force, so nothing new was remembered',
      'Made to apply everywhere',
    ]);
    expect(rows[1]?.href).toBe('/s/chat-pay');
  });
  it('an undone rule says it was retired, never deleted', () => {
    expect(ruleHistory(rule(), [decision({ state: 'undone' })]).map((r) => r.text)).toEqual(['Remembered from your words, then undone — retired, never deleted']);
  });
  it('is empty for a rule with no decisions', () => {
    expect(ruleHistory(rule({ id: 'PAT-100' }), [decision()])).toEqual([]);
  });
});

describe('whereConsidered — what studio has read that names the rule', () => {
  const turn: Consideration = {
    subject: { kind: 'chat', chat_id: 'chat-pay', turn_id: 'd2' }, key: 'considered:chat-pay:d2', project_id: 'upload-endpoint',
    considered: [{ id: 'proposal:pr-auto', statement: 'x', severity: 'warn' }], set_aside: [],
    cited: [{ id: 'proposal:pr-auto', by: 'claude', status: 'unchecked', label: 'l' }], source: 'considerRules',
  };
  const unit: Consideration = {
    subject: { kind: 'unit', run_id: 'r-pay-2', ord: 1, attempt: 0 }, key: 'considered:r-pay-2:1:0', project_id: 'upload-endpoint',
    considered: [{ id: 'proposal:pr-auto', statement: 'x', severity: 'warn' }], set_aside: [], cited: [], source: 'considerRules',
  };
  const aside: Consideration = { ...unit, key: 'considered:r-other:0:0', subject: { kind: 'unit', run_id: 'r-other', ord: 0, attempt: 0 }, considered: [], set_aside: [{ id: 'proposal:pr-auto', statement: 'x', reason: 'out_of_scope' }] };
  const ctx = {
    runTitle: (id: string) => (id === 'r-pay-2' ? 'Fix the double charge' : null),
    stepName: (id: string, ord: number) => (id === 'r-pay-2' && ord === 1 ? 'Build' : null),
  };
  it('one row per turn or step, with the strongest verdict and a link', () => {
    const rows = whereConsidered('proposal:pr-auto', [turn, unit, aside], ctx);
    expect(rows.map((r) => [r.kind, r.label, r.verdict, r.href])).toEqual([
      ['chat', 'A conversation', 'cited', '/s/chat-pay'],
      ['unit', 'Fix the double charge · Build', 'considered', '/s/run%3Ar-pay-2'],
      ['unit', 'A run · step 1', 'set-aside', '/s/run%3Ar-other'],
    ]);
    expect(rows[1]?.object).toBe('step:r-pay-2:1');
    expect(rows[0]?.object).toBeNull();
  });
});

describe('ruleHistory — a failed landing keeps the daemon’s message out of the sentence', () => {
  it('says only that it could not be remembered; the message (it may carry a path or a token) is a technical detail', () => {
    const rows = ruleHistory(rule(), [decision({ state: 'landing_failed', error: 'EACCES: /Users/alice/.wicked-crew/rules.db (token sk-live-123)' })]);
    expect(rows.map((r) => r.text)).toEqual(['Could not be remembered']);
    expect(rows[0]?.detail).toBe('EACCES: /Users/alice/.wicked-crew/rules.db (token sk-live-123)');
    expect(ruleHistory(rule(), [decision({ state: 'remembered' })])[0]?.detail).toBeNull();
  });
});

describe('whereConsidered — a run named in the operator’s lowercase words reads as a title', () => {
  it('sentence-cases the run’s title in the row', () => {
    const unit: Consideration = {
      subject: { kind: 'unit', run_id: 'r-pay-2', ord: 1, attempt: 0 }, key: 'considered:r-pay-2:1:0', project_id: 'upload-endpoint',
      considered: [{ id: 'proposal:pr-auto', statement: 'x', severity: 'warn' }], set_aside: [], cited: [], source: 'considerRules',
    };
    const rows = whereConsidered('proposal:pr-auto', [unit], { runTitle: () => 'fix the double charge on checkout, then show me', stepName: () => 'Build' });
    expect(rows[0]?.label).toBe('Fix the double charge on checkout, then show me · Build');
  });
});

describe('whereConsidered — a conversation is one row, named by its title, however many turns named the rule', () => {
  const turnOf = (id: string, cited: boolean, chat = 'chat-pay'): Consideration => ({
    subject: { kind: 'chat', chat_id: chat, turn_id: id }, key: `considered:${chat}:${id}`, project_id: 'upload-endpoint',
    considered: [{ id: 'proposal:pr-auto', statement: 'x', severity: 'warn' }], set_aside: [],
    cited: cited ? [{ id: 'proposal:pr-auto', by: 'claude', status: 'unchecked', label: 'l' }] : [], source: 'considerRules',
  });
  const ctx = {
    runTitle: () => null, stepName: () => null,
    chatTitle: (id: string) => (id === 'chat-pay' ? 'find why checkout charges twice' : null),
  };
  it('folds the turns of one conversation, keeps the strongest verdict, counts the turns', () => {
    const rows = whereConsidered('proposal:pr-auto', [turnOf('d1', false), turnOf('d2', true), turnOf('d3', false), turnOf('e1', false, 'chat-other')], ctx);
    expect(rows.map((r) => [r.kind, r.label, r.verdict, r.href])).toEqual([
      ['chat', 'Find why checkout charges twice · 3 turns', 'cited', '/s/chat-pay'],
      ['chat', 'A conversation', 'considered', '/s/chat-other'],
    ]);
  });
});
