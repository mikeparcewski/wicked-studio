// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DecisionView } from '../src/api/decisions.js';
import { decisionLine, decisionRowText, deskRuleSentence, scopeWords, statementOf } from '../src/board/decisionLine.js';

/**
 * The decision line's words (DES-DECISION-CAPTURE §3 B1–B4, B6–B9, B12; slice DC-S6), pure.
 * Each case is one scene of concept-studio.html: rule-auto (26), rule-offer (27), never-mind (44),
 * desk-rule (47), plus the chip variants the spec names.
 */

type Over = Partial<Omit<DecisionView, 'derived' | 'origin'>> & { derived?: Partial<DecisionView['derived']>; origin?: Partial<DecisionView['origin']> };
/** A view with `over` applied; `drop` removes optional fields (a chip has no rule_id yet). */
function view(over: Over = {}, drop: ReadonlyArray<'rule_id' | 'how' | 'proposal_id' | 'widen'> = []): DecisionView {
  const { derived, origin, ...rest } = over;
  const v: DecisionView = {
    id: 'dec_1', at: 1_700_000_000_000, project_id: 'p-kestrel', host: 'studio-chat',
    origin: {
      actor: { id: 'op', kind: 'human', trust: 'operator' }, auth_mode: 'required', chat_id: 'chat-pay', turn_id: 't9',
      words: 'from now on, always check the payment provider’s records, not just our database', words_source: 'typed', redacted: false,
      ...origin,
    },
    derived: {
      statement: 'Always check the payment provider’s records, not just our database', polarity: 'do', key: 'check-provider-records',
      scope: 'project', steering_type: 'development', template: 'T1-always', exclusions: [], ...derived,
    },
    route: 'auto', state: 'remembered', how: 'auto', rule_id: 'proposal:pr-1', proposal_id: 'pr-1',
    ...rest,
  };
  for (const k of drop) delete v[k];
  return v;
}
const CTX = { mode: 'on' as const, projectName: 'Kestrel' };

describe('decisionLine', () => {
  it('B1: a clear rule auto-remembered says so once, for the project, with Undo and see it', () => {
    const l = decisionLine(view(), CTX)!;
    expect(l.kind).toBe('remembered');
    expect(l.text).toBe('Remembered for Kestrel: ‘Always check the payment provider’s records, not just our database.’');
    expect(l.actions).toEqual(['undo', 'see']);
    expect(l.ruleId).toBe('proposal:pr-1');
  });
  it('B2: a loose rule is one Remember chip — the derived rule, its type, for the project; nothing stored', () => {
    const l = decisionLine(view({ route: 'offer', state: 'offered', derived: { statement: 'Demos for the panel should feel calmer', template: 'in-your-words', steering_type: 'design-ux' } }, ['how', 'rule_id']), CTX)!;
    expect(l.kind).toBe('offer');
    expect(l.statement).toBe('Demos for the panel should feel calmer.');
    expect(l.type).toBe('Design/UX');
    expect(l.scope).toBe('for Kestrel');
    expect(l.actions).toEqual(['remember', 'dismiss']);
    expect(l.approved).toBeNull();
  });
  it('B2 under auth=off: a clear rule is the same chip (crew cannot prove a human typed it)', () => {
    const l = decisionLine(view({ route: 'offer', state: 'offered', origin: { auth_mode: 'off' } }, ['how', 'rule_id']), CTX)!;
    expect(l.kind).toBe('offer');
  });
  it('B3: "never mind", a question, a one-off: nothing (the ledger still has it)', () => {
    expect(decisionLine(view({ route: 'ledger', state: 'recorded', derived: { statement: null, template: null }, origin: { words: 'never mind, skip that for now' } }), CTX)).toBeNull();
    expect(decisionLine(view({ route: 'offer', state: 'recorded', derived: { statement: null } }), CTX)).toBeNull();
    expect(decisionLine(view({ state: 'dismissed' }), CTX)).toBeNull();
  });
  it('B4: Undo reads "Not remembered" and offers nothing more', () => {
    const l = decisionLine(view({ state: 'undone' }), CTX)!;
    expect(l.kind).toBe('undone');
    expect(l.text).toBe('Not remembered');
    expect(l.actions).toEqual([]);
  });
  it('B6: a bare approval of a seat’s proposal is a chip with "You approved" quoted; never auto', () => {
    const l = decisionLine(view({ route: 'offer', state: 'offered', origin: { words: 'lets do it' }, derived: { statement: 'Treat every copy-only change as tests-only', template: 'in-your-words' } }, ['how', 'rule_id']), CTX)!;
    expect(l.kind).toBe('offer');
    expect(l.approved).toBe('lets do it');
  });
  it('B7: a restatement is "Already in force · see it"; a maybe asks "Same as your rule?"', () => {
    const r = decisionLine(view({ route: 'restated', state: 'restated', restates_rule_id: 'proposal:pr-0' }, ['rule_id', 'how']), CTX)!;
    expect(r.text).toBe('Already in force');
    expect(r.actions).toEqual(['see']);
    expect(r.ruleId).toBe('proposal:pr-0');
    const m = decisionLine(view({ route: 'maybe-restated', state: 'recorded', restates_rule_id: 'proposal:pr-0' }, ['rule_id', 'how']), CTX)!;
    expect(m.kind).toBe('maybe-restated');
    expect(m.actions).toEqual(['same', 'new-rule', 'see']);
  });
  it('B8: decided in two projects offers "Make it apply everywhere"', () => {
    const l = decisionLine(view({ route: 'offer', state: 'offered', widen: { projects: ['p-kestrel', 'p-cedar'] } }, ['rule_id', 'how']), CTX)!;
    expect(l.kind).toBe('widen-offer');
    expect(l.text).toBe('You’ve decided this in 2 projects');
    expect(l.actions[0]).toBe('widen');
  });
  it('a landing that failed says so loudly and offers Remember again; a conflict names the rule', () => {
    const f = decisionLine(view({ state: 'landing_failed', error: 'engine dropped targets.project' }), CTX)!;
    expect(f.kind).toBe('failed');
    expect(f.text).toContain('engine dropped targets.project');
    const c = decisionLine(view({ route: 'conflict', state: 'recorded', conflicts_rule_id: 'proposal:pr-0' }, ['rule_id', 'how']), CTX)!;
    expect(c.kind).toBe('conflict');
    expect(c.actions).toEqual(['see', 'remember', 'dismiss']);
  });
  it('draws nothing under WICKED_DECISIONS=ledger, off, or before the mode is known', () => {
    expect(decisionLine(view(), { mode: 'ledger', projectName: 'Kestrel' })).toBeNull();
    expect(decisionLine(view(), { mode: 'off', projectName: 'Kestrel' })).toBeNull();
    expect(decisionLine(view(), { mode: null, projectName: 'Kestrel' })).toBeNull();
  });
  it('the operator’s edit at Remember wins over the derivation; scope follows the edit', () => {
    const v = view({ edits: { statement: 'Check the provider’s records every time', scope: 'everywhere' } });
    expect(statementOf(v)).toBe('Check the provider’s records every time.');
    expect(scopeWords(v, 'Kestrel')).toBe('everywhere');
    expect(scopeWords(view({ project_id: null }), null)).toBe('everywhere');
    expect(scopeWords(view(), null)).toBe('for this project');
  });
});

describe('deskRuleSentence (B9)', () => {
  const name = (id: string | null): string | null => (id === 'p-kestrel' ? 'Kestrel' : id === 'p-cedar' ? 'Cedar Bid' : null);
  it('one rule since you looked: "One new rule for Kestrel, from your words"', () => {
    const s = deskRuleSentence([view({ at: 2000 })], 1000, name)!;
    expect(s.text).toBe('One new rule for Kestrel, from your words');
    expect(s.ruleId).toBe('proposal:pr-1');
  });
  it('nothing new since you looked, or nothing remembered: no sentence', () => {
    expect(deskRuleSentence([view({ at: 500 })], 1000, name)).toBeNull();
    expect(deskRuleSentence([view({ state: 'undone' })], null, name)).toBeNull();
    expect(deskRuleSentence([], null, name)).toBeNull();
  });
  it('several rules count, and name the project only when it is one', () => {
    expect(deskRuleSentence([view({ at: 2000 }), view({ id: 'dec_2', at: 3000 })], 1000, name)!.text).toBe('2 new rules for Kestrel, from your words');
    expect(deskRuleSentence([view({ at: 2000 }), view({ id: 'dec_2', at: 3000, project_id: 'p-cedar' })], 1000, name)!.text).toBe('2 new rules across 2 projects, from your words');
  });
});

describe('decisionRowText (B12)', () => {
  it('the Needs You row says the rule is the operator’s, in their words', () => {
    expect(decisionRowText('Always check the provider’s records', 'development')).toBe('From your words — Remember lands a development rule: ‘Always check the provider’s records’');
    expect(decisionRowText(null, null)).toBe('From your words — Remember lands a rule');
  });
});
