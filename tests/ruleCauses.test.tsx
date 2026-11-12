/**
 * studio#1084 / #1085: a gate held on steering rules says why (the gate record's per-rule reason), and its choice reads
 * "Skip N rules" unless a rule waived by the person's instruction can be confirmed.
 */
import { describe, expect, it } from 'vitest';
import { ruleCauseOf, ruleCauses } from '../src/board/ruleCauses.js';
import { receiptOf, type RuleRow } from '../src/board/assuranceModel.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit } from './factories.js';

const base = { mode: 'full', required: ['judge'], ran: ['judge', 'rule_check'], skipped: [], creator: 'pi', evaluator: 'claude', judge: 'codex', tree: 't', attempt: 1 };
const rowOf = (ruleId: string, status: string, reason: string, extra: Record<string, unknown> = {}): RuleRow =>
  receiptOf({ ...base, rules: [{ ruleId, status, how: status === 'unchecked' ? 'none' : 'council', reason, ruleKey: 'k', ...extra }] })!.rules![0]!;

describe('the cause of each held rule, in plain words', () => {
  it('a judge seat that could not run, with the engine\'s detail', () => {
    const c = ruleCauseOf(rowOf('A', 'unchecked', 'the judge could not run: seat containers failed to start'));
    expect(c).toMatchObject({ kind: 'judge_unran', text: 'The judge could not run: seat containers failed to start' });
    expect(c.remedy).toMatch(/Re-check/);
  });
  it('a judge that gave no line', () => {
    const c = ruleCauseOf(rowOf('A', 'unchecked', 'the judge did not answer for it, in its batch or asked alone'));
    expect(c.kind).toBe('judge_no_line');
    expect(c.text).toBe('The judge ran but gave no line on this rule');
  });
  it('no council could seat', () => {
    const c = ruleCauseOf(rowOf('A', 'disputed', 'the council reached no ruling: seats_benched: every eligible seat is benched', { council: { reason: 'seats_benched: every eligible seat is benched' } }));
    expect(c).toMatchObject({ kind: 'council_none', text: 'No council could seat, so nobody ruled between the judge and the reviewer' });
    expect(c.remedy).toMatch(/Re-check sends it to the council again/);
  });
  it('no_quorum keeps its reason and is not a seating failure', () => {
    const r = 'no_quorum: the counted votes reached no majority (1 of 3 counted)';
    const c = ruleCauseOf(rowOf('A', 'disputed', `the council reached no ruling (1 of 3 answered): ${r}`, { council: { reason: r, seated: 3 } }));
    expect(c.kind).toBe('council_none');
    expect(c.text).toBe('The council reached no ruling: the counted votes reached no majority (1 of 3 counted)');
    expect(c.text).not.toMatch(/could seat/);
  });
  it('the record part unsettled is not read as a seating failure', () => {
    for (const code of ['incomplete_evidence', 'identity_unknown']) {
      const c = ruleCauseOf(rowOf('A', 'disputed', `the council reached no ruling: ${code}: the record names no subject`, { council: { reason: `${code}: the record names no subject` } }));
      expect(c.kind).toBe('record_unsettled');
      expect(c.text).toContain('the record part of the rule could not be settled');
      expect(c.text).not.toMatch(/seat/);
      expect(c.text).not.toContain(code);
    }
  });
  it('a dispute with no ruling and no code is generic, never a seating claim', () => {
    expect(ruleCauseOf(rowOf('A', 'disputed', 'no ruling')).kind).toBe('other');
  });
  it('a waived rule says the instruction conflicts', () => {
    expect(ruleCauseOf(rowOf('A', 'waived', 'x')).kind).toBe('waived');
  });
  it('an unchecked rule with an unknown reason shows the engine\'s own words', () => {
    expect(ruleCauseOf(rowOf('A', 'unchecked', 'quota ran out')).text).toBe('Not checked: quota ran out');
  });
  it('rules sharing a cause are one line; process and kept rows are left out', () => {
    const r = [rowOf('A', 'unchecked', 'the judge could not run: x'), rowOf('B', 'unchecked', 'the judge could not run: x'), rowOf('C', 'unchecked', 'the judge did not answer'), rowOf('D', 'kept', 'ok'), rowOf('E', 'unchecked', 'p', { blocking: false })];
    expect(ruleCauses(r).map((c) => [c.kind, c.ruleIds])).toEqual([['judge_unran', ['A', 'B']], ['judge_no_line', ['C']]]);
  });
});

describe('the skip choice says what it does', () => {
  const RUN = 'r-cause';
  const gate: OpenGate = { runId: RUN, ord: 4, prompt: "Unit 4's steering rules are UNCHECKED or waived by your instruction — 2 steering rule(s) need you", lifecycle: 'open', receivedAt: 0, gateKind: 'escalation' };
  const units = [makeUnit({ id: `${RUN}:u4`, session_id: RUN, ord: 4, role: 'creator', status: 'done' })] as WorkUnit[];
  const choiceFor = (rows: unknown[]) => {
    const events = [
      { type: 'gateEvaluated', session: RUN, ord: 4, denial: { source: 'rules_unchecked', reason: 'x', claimId: null, ruleIds: [], deniedTool: null, phase: null }, assurance: { ...base, rules: rows } },
      { type: 'gateEscalated', session: RUN, ord: 4, condition: 'rules_unchecked', denialSource: 'rules_unchecked', verdictSummary: '' },
    ] as unknown as CoreEvent[];
    const m = sessionGateChoices({ runId: RUN, gate, units, events, pool: ['claude', 'codex'], roster: null })!;
    return [...m.choices, ...(m.overflow ?? [])].find((c) => c.key === 'skip-rules')!;
  };
  const raw = (id: string, status: string) => ({ ruleId: id, status, how: 'none', reason: 'r', ruleKey: 'k' });

  it('unchecked and disputed rules: "Skip N rules", recorded as skipped by you', () => {
    const c = choiceFor([raw('A', 'unchecked'), raw('B', 'disputed')]);
    expect(c.label).toBe('Skip 2 rules');
    expect(c.title).toMatch(/Recorded as skipped by you/);
    expect(c.title).not.toMatch(/Confirm/);
    expect(choiceFor([raw('A', 'unchecked')]).label).toBe('Skip A');
  });
  it('four held rules have a concise consequence, with ids, the skip record and its labels', () => {
    const ids = ['SEC-1002', 'DEV-2004', 'TST-3001', 'ARC-1007'];
    const c = choiceFor(ids.map((id, i) => raw(id, i % 2 === 0 ? 'unchecked' : 'disputed')));
    expect(c.label).toBe('Skip 4 rules');
    expect(c.skipRuleIds).toEqual(ids);
    expect(c.title!.length).toBeLessThanOrEqual(200);
    expect(c.title).toContain(`Skip ${ids.join(', ')}`);
    expect(c.title).toContain('Recorded as skipped by you');
    expect(c.title).toContain('Labelled on the run, the gate and the delivery');
    expect(c.title).not.toMatch(/confirm|broken warning|written reason|with your reason|Every other reason/i);
  });
  it('the broken-rule limit appears only for a broken row offered or still holding the gate', () => {
    const warning = { ...raw('WARN-1', 'broken'), waivable: true };
    const error = raw('ERR-1', 'broken');
    for (const rows of [[warning], [raw('A', 'unchecked'), error]]) {
      const c = choiceFor(rows);
      expect(c.title).toContain('A broken warning can be skipped, a broken error or critical rule cannot.');
    }
    const c = choiceFor([raw('A', 'unchecked'), error]);
    expect(c.skipRuleIds).toEqual(['A']);
    expect(c.title).toContain('Every other reason this step was stopped still stands.');
    expect(choiceFor([raw('A', 'unchecked'), { ...error, blocking: false }]).title).not.toMatch(/broken warning|Every other reason/);
  });
  it('a rule waived by instruction keeps "Confirm or skip"', () => {
    const c = choiceFor([raw('A', 'unchecked'), raw('W', 'waived')]);
    expect(c.label).toBe('Confirm or skip 2 rules');
    expect(c.title).toMatch(/waived by your instruction is confirmed/);
    expect(c.title).toContain('any other is recorded as skipped by you');
    expect(c.title).toContain('Labelled on the run, the gate and the delivery');
    expect(c.title).not.toContain('The skip is labelled');
    expect(c.skipRuleIds).toEqual(['A', 'W']);
    expect(choiceFor([raw('W', 'waived')]).label).toBe('Confirm or skip W');
  });
});
