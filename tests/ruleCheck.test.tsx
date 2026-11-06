/**
 * DES-RULE-CHECK-001 S4 (studio half): every steering rule's verdict rides the assurance receipt.
 * The run page, the gate card and the delivery say "N rules checked: K kept, B broken, X not
 * applicable", expandable to each rule's row; a gate held on unchecked or instruction-waived rules
 * offers "Re-check the rules" and a confirm-or-skip with the person's reason.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { deliveryReceiptOf, receiptOf, rulesSummary, worstRules, type RuleRow } from '../src/board/assuranceModel.js';
import { sessionGateChoices, RETRY_RULES_LABEL } from '../src/board/gateRowModel.js';
import { AssuranceReceipt as ReceiptView, RulesChecked } from '../src/components/session/AssuranceReceipt.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

afterEach(() => cleanup());

const row = (ruleId: string, status: string, reason = 'src/math.js:3'): Record<string, unknown> => ({
  ruleId, status, how: status === 'n_a' ? 'fact' : status === 'skipped' ? 'operator' : status === 'unchecked' ? 'none' : 'judge', reason, ruleKey: 'k',
});
const base = { mode: 'full', required: ['judge'], ran: ['judge', 'rule_check'], skipped: [], creator: 'pi', evaluator: 'claude', judge: 'codex', tree: 't', attempt: 1 };

describe('the receipt carries every rule', () => {
  it('parses rows, and the line counts them', () => {
    const r = receiptOf({ ...base, rules: [row('A', 'kept'), row('B', 'broken'), row('C', 'n_a', 'selected for install'), row('D', 'n_a', 'x')] })!;
    expect(r.rules?.map((x) => x.status)).toEqual(['kept', 'broken', 'n_a', 'n_a']);
    expect(rulesSummary(r.rules!).line).toBe('4 rules checked: 1 kept, 1 broken, 2 not applicable');
    expect(receiptOf(base)!.rules).toBeUndefined();
  });

  it('says the waived and unchecked ones too, and the worst row per rule wins on a delivery', () => {
    const rows = [row('A', 'kept'), row('W', 'waived'), row('U', 'unchecked')].map((x) => receiptOf({ ...base, rules: [x] })!.rules![0]!) as RuleRow[];
    expect(rulesSummary(rows).line).toBe('3 rules checked: 1 kept, 0 broken, 0 not applicable, 1 waived by your instruction (to confirm), 1 unchecked');
    const a = receiptOf({ ...base, rules: [row('A', 'kept'), row('B', 'skipped', 'skipped by you: fixture')] })!.rules!;
    const b = receiptOf({ ...base, rules: [row('A', 'broken')] })!.rules!;
    expect(worstRules([a, b]).map((x) => [x.ruleId, x.status])).toEqual([['A', 'broken'], ['B', 'skipped']]);
  });

  it('renders the line, expandable to each rule with how and why', () => {
    const r = receiptOf({ ...base, rules: [row('DEV-TINYMATH-2', 'broken', 'src/math.js changes sum() and no test exercises it'), row('MCPS-1001', 'n_a', 'selected for install; this job runs triage, fix, verify')] })!;
    render(<ReceiptView receipt={r} passed={false} />);
    const line = screen.getByTestId('assurance-rules-line');
    expect(line.textContent).toBe('2 rules checked: 0 kept, 1 broken, 1 not applicable');
    expect(screen.getByTestId('assurance-rules').getAttribute('data-tone')).toBe('broken');
    fireEvent.click(line);
    const rules = screen.getAllByTestId('assurance-rule');
    expect(rules).toHaveLength(2);
    expect(rules[0]!.textContent).toContain('broken DEV-TINYMATH-2 by a judge');
    expect(rules[0]!.textContent).toContain('no test exercises it');
    expect(rules[1]!.textContent).toContain('not applicable MCPS-1001 by fact');
  });

  it('the delivery receipt aggregates the gates when the engine has not lifted yet', () => {
    const RUN = 'r-rules';
    const units = [makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' })] as WorkUnit[];
    const events = [{ type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [row('A', 'kept'), row('S', 'skipped', 'waived by instruction ("touch no test"), confirmed by you: covered')] } }] as unknown as CoreEvent[];
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, units);
    const d = deliveryReceiptOf(view, events, null)!;
    expect(d.rules?.map((x) => x.ruleId)).toEqual(['A', 'S']);
  });
});

describe('the gate held on rules offers the re-check and the confirm-or-skip', () => {
  const RUN = 'r-hold';
  const PROMPT = "Unit 5's steering rules are UNCHECKED or waived by your instruction — 1 steering rule(s) need you: DEV-TINYMATH-2 WAIVED by your instruction (\"Do not add, change or run any test file\"). The work was not rejected. Re-run the rule check on the same work (action `retry_rules`; the step does not run again), confirm a waiver or skip an unchecked rule with a written reason (action `skip_rules`: labelled on the run, the gate and the delivery), approve to run the step again, request changes to send it back for rework, or reject to cancel the run";
  const gate: OpenGate = { runId: RUN, ord: 5, prompt: PROMPT, gateKind: 'escalation', lifecycle: 'open', receivedAt: 1 };
  const units = [
    makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'done', assigned_cli: 'pi' }),
    makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 5, role: 'evaluator', status: 'rejected', assigned_cli: 'claude' }),
  ] as WorkUnit[];
  const events = [
    { type: 'unitDispatched', session: RUN, ord: 5, attempt: 0, ts: 1 },
    { type: 'gateEvaluated', session: RUN, ord: 5, ts: 2, denial: { source: 'rules_unchecked', reason: 'x', claimId: null, ruleIds: ['DEV-TINYMATH-2'], deniedTool: null, phase: 'unit-5' }, assurance: { ...base, rules: [row('learn-tests-with-fixes', 'kept'), row('DEV-TINYMATH-2', 'waived', "kept on the person's instruction")] } },
  ] as unknown as CoreEvent[];

  it('offers both, the skip carrying the held rules and needing your reason', () => {
    const m = sessionGateChoices({ runId: RUN, gate, units, events, pool: ['pi', 'claude'], roster: null })!;
    const all = [...m.choices, ...(m.overflow ?? [])] as Array<{ key: string; label: string; decision: unknown; needsNote: boolean; skipRuleIds?: string[] }>;
    const retry = all.find((c) => c.key === 'retry-rules');
    expect(retry?.label).toBe(RETRY_RULES_LABEL);
    expect(retry?.decision).toEqual({ approve: true, action: 'retry_rules' });
    const skip = all.find((c) => c.key === 'skip-rules');
    expect(skip).toMatchObject({ needsNote: true, skipRuleIds: ['DEV-TINYMATH-2'], decision: { approve: true, action: 'skip_rules' } });
  });

  it('any other gate offers neither', () => {
    // (rev 2) Another layer denied and no rule holds: nothing to re-check or skip. (A held rule behind another
    // denial IS offered: see "a dispute behind the reviewer's FAIL".)
    const other = [events[0]!, { ...(events[1] as unknown as Record<string, unknown>), denial: { source: 'evaluator_verdict', reason: 'x', claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-5' }, assurance: { ...base, rules: [row('learn-tests-with-fixes', 'kept'), row('DEV-TINYMATH-2', 'kept')] } }] as unknown as CoreEvent[];
    const m = sessionGateChoices({ runId: RUN, gate: { ...gate, prompt: 'Unit 5 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run' }, units, events: other, pool: ['pi'], roster: null })!;
    const all = [...m.choices, ...(m.overflow ?? [])] as Array<{ key: string }>;
    expect(all.some((c) => c.key === 'retry-rules' || c.key === 'skip-rules')).toBe(false);
  });
});

describe('the gate card says the rule line under its question', () => {
  it('renders session-gate-rules and leaves the receipt foot without a second one', async () => {
    const client = await import('../src/api/client.js');
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    const { GateRow } = await import('../src/components/session/GateRow.js');
    const { useRunEventStore } = await import('../src/store/events.js');
    const RUN = 'r-card';
    const units = [
      makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 1, role: 'creator', status: 'done', assigned_cli: 'pi' }),
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'rejected', assigned_cli: 'claude' }),
    ] as WorkUnit[];
    useRunEventStore.setState({ byRun: { [RUN]: [
      { type: 'unitDispatched', ord: 2, attempt: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'rule_check', reason: 'x', ruleIds: ['learn-tests-with-fixes'] }, evaluatorPolicies: [], assurance: { ...base, rules: [row('learn-tests-with-fixes', 'broken'), row('MCPS-1001', 'n_a')] } },
    ] as unknown as CoreEvent[] } });
    const g: OpenGate = { runId: RUN, ord: 2, prompt: 'Unit 2 BROKE steering rule(s): learn-tests-with-fixes. Request changes to send it back for rework, approve to run the step again, or reject to cancel the run', lifecycle: 'open', receivedAt: 1, gateKind: 'escalation' };
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, units)} gate={g} />);
    expect(screen.getByTestId('session-gate-rules-line').textContent).toBe('2 rules checked: 0 kept, 1 broken, 1 not applicable');
    expect(screen.queryByTestId('assurance-rules-line')).toBeNull();
  });
});

describe('(SWAP 6) a rule deferred to delivery', () => {
  it('parses, is said on the line, and the delivery verdict replaces it', () => {
    const r = receiptOf({ ...base, rules: [row('A', 'kept'), row('learn-linked-issue', 'deferred', 'its subject is the delivery (evidence:delivery): checked at the deliver step')] })!;
    expect(r.rules?.[1]?.status).toBe('deferred');
    expect(rulesSummary(r.rules!).line).toBe('2 rules checked: 1 kept, 0 broken, 0 not applicable, 1 deferred to delivery');
    const d = receiptOf({ ...base, rules: [row('learn-linked-issue', 'kept')] })!.rules!;
    expect(worstRules([r.rules!, d]).find((x) => x.ruleId === 'learn-linked-issue')?.status).toBe('kept');
  });

  it('the linked-issue starter carries its delivery fact, the tests starter its machine check', async () => {
    const { STARTER_RULES, starterRule } = await import('../src/board/learnHub.js');
    const by = (id: string) => starterRule(STARTER_RULES.find((s) => s.id === id)!) as unknown as { obligations?: string[] };
    expect(by('learn-linked-issue').obligations).toEqual(['evidence:delivery']);
    expect(by('learn-tests-with-fixes').obligations).toEqual(['check:test-fails-on-base']);
    expect(by('learn-small-prs').obligations).toBeUndefined();
  });
});

describe('(SWAP 6) the delivery shows the deliver step verdict over the review deferral', () => {
  it('joins the lift receipt with every gate, the worst row winning', () => {
    const RUN = 'r-defer';
    const units = [
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' }),
      makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 3, role: 'neutral', status: 'done' }),
    ] as WorkUnit[];
    const deferred = row('learn-linked-issue', 'deferred', 'its subject is the delivery');
    const events = [
      { type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [row('A', 'kept'), deferred] } },
      { type: 'deliverLiftEvaluated', session: RUN, ord: 3, ts: 2, assurance: { ...base, rules: [row('A', 'kept'), deferred] } },
      { type: 'gateEvaluated', session: RUN, ord: 3, ts: 3, assurance: { ...base, rules: [row('learn-linked-issue', 'broken', 'the description names no issue')] } },
    ] as unknown as CoreEvent[];
    const d = deliveryReceiptOf(makeView({ id: RUN, status: 'awaiting_human' } as never, units), events, null)!;
    expect(d.rules?.find((x) => x.ruleId === 'learn-linked-issue')?.status).toBe('broken');
  });
});

describe('(s4-ui-fix) review findings', () => {
  it('P2-1: a delivery retry shows the deliver gate\'s newest verdict, a skip with its reason, over the lift\'s earlier row', () => {
    const RUN = 'r-retry';
    const units = [
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' }),
      makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 3, role: 'neutral', status: 'done' }),
    ] as WorkUnit[];
    const deferred = row('learn-linked-issue', 'deferred', 'its subject is the delivery');
    const events = [
      { type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [row('A', 'kept'), row('B', 'broken', 'no test'), deferred] } },
      { type: 'unitDispatched', session: RUN, ord: 2, ts: 2 },
      { type: 'gateEvaluated', session: RUN, ord: 2, ts: 3, assurance: { ...base, rules: [row('A', 'kept'), row('B', 'kept', 'the test is added'), deferred] } },
      { type: 'deliverLiftEvaluated', session: RUN, ord: 3, ts: 4, assurance: { ...base, rules: [row('A', 'kept'), row('B', 'kept'), deferred] } },
      { type: 'gateEvaluated', session: RUN, ord: 3, ts: 5, assurance: { ...base, rules: [row('learn-linked-issue', 'unchecked', 'no judge could rule')] } },
      // The retry: the deliver unit runs again; its lift carries the deliver unit's PREVIOUS (unchecked) row.
      { type: 'unitDispatched', session: RUN, ord: 3, ts: 6 },
      { type: 'deliverLiftEvaluated', session: RUN, ord: 3, ts: 7, assurance: { ...base, rules: [row('A', 'kept'), row('B', 'kept'), row('learn-linked-issue', 'unchecked', 'no judge could rule')] } },
      { type: 'gateEvaluated', session: RUN, ord: 3, ts: 8, assurance: { ...base, rules: [row('learn-linked-issue', 'skipped', 'skipped by you: the issue is linked in the tracker')] } },
    ] as unknown as CoreEvent[];
    const d = deliveryReceiptOf(makeView({ id: RUN, status: 'completed' } as never, units), events, null)!;
    expect(d.rules?.map((x) => [x.ruleId, x.status])).toEqual([['A', 'kept'], ['B', 'kept'], ['learn-linked-issue', 'skipped']]);
    render(<ReceiptView receipt={d} passed />);
    fireEvent.click(screen.getByTestId('assurance-rules-line'));
    const skipped = screen.getAllByTestId('assurance-rule').find((li) => li.getAttribute('data-status') === 'skipped')!;
    expect(skipped.textContent).toContain('skipped learn-linked-issue by the operator: skipped by you: the issue is linked in the tracker');
    // Deny-dominates still holds across distinct gates: another gate's broken row is not hidden by a kept one.
    const other = [...events, { type: 'gateEvaluated', session: RUN, ord: 4, ts: 9, assurance: { ...base, rules: [row('A', 'broken', 'qe found it')] } }] as unknown as CoreEvent[];
    expect(deliveryReceiptOf(makeView({ id: RUN, status: 'completed' } as never, units), other, null)!.rules?.find((x) => x.ruleId === 'A')?.status).toBe('broken');
  });

  it('P2-3: an evaluator finding that quotes the hold phrase offers no rule action; a structured rules_unchecked hold does', () => {
    const RUN = 'r-quote';
    const units = [
      makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'done', assigned_cli: 'pi' }),
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 5, role: 'evaluator', status: 'rejected', assigned_cli: 'claude' }),
    ] as WorkUnit[];
    const quoted = 'Unit 5 verdict is NOT PASS — the receipt copy reads "steering rules are UNCHECKED" in the wrong place. Request changes to send it back for rework, approve to run the step again, or reject to cancel the run';
    const g: OpenGate = { runId: RUN, ord: 5, prompt: quoted, gateKind: 'escalation', lifecycle: 'open', receivedAt: 1 };
    const keys = (events: CoreEvent[], u: WorkUnit[] = units): string[] => {
      const m = sessionGateChoices({ runId: RUN, gate: g, units: u, events, pool: ['pi', 'claude'], roster: null })!;
      return [...m.choices, ...(m.overflow ?? [])].map((c) => c.key);
    };
    const evaluator = [
      { type: 'unitDispatched', session: RUN, ord: 5, ts: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 5, ts: 2, denial: { source: 'evaluator_verdict', reason: 'x', ruleIds: [] } },
      { type: 'gateEscalated', session: RUN, ord: 5, ts: 3, condition: 'verdict_not_pass', denialSource: 'evaluator_verdict', verdictSummary: 'steering rules are UNCHECKED' },
    ] as unknown as CoreEvent[];
    expect(keys(evaluator).some((k) => k === 'retry-rules' || k === 'skip-rules')).toBe(false);
    // The same gate held rules_unchecked on the wire, whatever its words: offered.
    const held = [
      { type: 'unitDispatched', session: RUN, ord: 5, ts: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 5, ts: 2, denial: { source: 'rules_unchecked', reason: 'x', ruleIds: ['R'] }, assurance: { ...base, rules: [row('R', 'unchecked')] } },
      { type: 'gateEscalated', session: RUN, ord: 5, ts: 3, condition: 'rules_unchecked', denialSource: 'rules_unchecked', verdictSummary: 'x' },
    ] as unknown as CoreEvent[];
    expect(keys(held)).toEqual(expect.arrayContaining(['retry-rules', 'skip-rules']));
    // An earlier attempt's hold is not this attempt's.
    expect(keys([...held, { type: 'unitDispatched', session: RUN, ord: 5, ts: 4 }] as unknown as CoreEvent[]).includes('retry-rules')).toBe(false);
    // No log in hand: the unit record's denial decides.
    const recorded = units.map((u) => (u.ord === 5 ? { ...u, denial: { source: 'rules_unchecked', reason: 'x' } } : u)) as WorkUnit[];
    expect(keys([], recorded).includes('retry-rules')).toBe(true);
    expect(keys([], units).includes('retry-rules')).toBe(false);
  });

  it('P3: a rule\'s reason hides home paths unless technical details are on', async () => {
    const { useViewPrefsStore } = await import('../src/store/viewPrefs.js');
    const rows = receiptOf({ ...base, rules: [row('R', 'broken', 'cited /home/alice/project/src/math.js:3')] })!.rules!;
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
    const { unmount } = render(<RulesChecked rows={rows} />);
    expect(screen.getByTestId('assurance-rule').textContent).toContain('cited ~/project/src/math.js:3');
    expect(screen.getByTestId('assurance-rule').textContent).not.toContain('/home/alice');
    unmount();
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: true } }));
    render(<RulesChecked rows={rows} />);
    expect(screen.getByTestId('assurance-rule').textContent).toContain('/home/alice/project/src/math.js:3');
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
  });

  it('the live line says "So far"', () => {
    const rows = receiptOf({ ...base, rules: [row('A', 'kept')] })!.rules!;
    render(<RulesChecked rows={rows} soFar />);
    expect(screen.getByTestId('assurance-rules-line').textContent).toBe('So far, 1 rule checked: 1 kept, 0 broken, 0 not applicable');
  });
});

describe('(s4-ui-fix r2) partial histories and the skip as sent', () => {
  it('the aggregate speaks for a rule no gate in hand names, and only for it', () => {
    const RUN = 'r-agg';
    const units = [
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' }),
      makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 4, role: 'neutral', status: 'done' }),
    ] as WorkUnit[];
    const events = [
      { type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [row('S', 'kept')] } },
      { type: 'deliverLiftEvaluated', session: RUN, ord: 4, ts: 2, assurance: { ...base, rules: [row('R', 'broken', 'qe found it'), row('S', 'kept')] } },
    ] as unknown as CoreEvent[];
    const d = deliveryReceiptOf(makeView({ id: RUN, status: 'completed' } as never, units), events, null)!;
    expect(d.rules?.map((x) => [x.ruleId, x.status])).toEqual([['R', 'broken'], ['S', 'kept']]);
  });

  it('a unit the log never mentions joins with its persisted receipt', () => {
    const RUN = 'r-persisted';
    const units = [
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' }),
      { ...makeUnit({ id: `${RUN}:qe`, session_id: RUN, ord: 3, role: 'evaluator', status: 'done' }), assurance: { ...base, rules: [row('R', 'broken', 'qe found it')] } },
    ] as unknown as WorkUnit[];
    const events = [{ type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [row('R', 'kept')] } }] as unknown as CoreEvent[];
    expect(deliveryReceiptOf(makeView({ id: RUN, status: 'awaiting_human' } as never, units), events, null)!.rules?.[0]?.status).toBe('broken');
  });

  describe('a hold the log only partly carries', () => {
    const RUN = 'r-partial-hold';
    const g: OpenGate = { runId: RUN, ord: 5, prompt: 'Unit 5 is held', gateKind: 'escalation', lifecycle: 'open', receivedAt: 1 };
    const units = [
      makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'done', assigned_cli: 'pi' }),
      { ...makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 5, role: 'evaluator', status: 'rejected', assigned_cli: 'claude' }),
        denial: { source: 'rules_unchecked', reason: 'x' }, assurance: { ...base, rules: [row('K', 'kept'), row('U', 'unchecked'), row('W', 'waived')] } },
    ] as unknown as WorkUnit[];
    const offered = (events: unknown[]): Array<{ key: string; skipRuleIds?: string[] }> => {
      const m = sessionGateChoices({ runId: RUN, gate: g, units, events: events as CoreEvent[], pool: ['pi', 'claude'], roster: null })!;
      return [...m.choices, ...(m.overflow ?? [])] as Array<{ key: string; skipRuleIds?: string[] }>;
    };
    it('only an awaitingHuman frame: the unit record decides both', () => {
      const all = offered([{ type: 'awaitingHuman', session: RUN, ord: 5, gateKind: 'escalation', prompt: 'x' }]);
      expect(all.some((c) => c.key === 'retry-rules')).toBe(true);
      expect(all.find((c) => c.key === 'skip-rules')?.skipRuleIds).toEqual(['U', 'W']);
    });
    it('only the escalation frame: held from the wire, the rows from the unit record of the same attempt', () => {
      const esc = { type: 'gateEscalated', session: RUN, ord: 5, condition: 'rules_unchecked', denialSource: 'rules_unchecked', verdictSummary: 'x' };
      const all = offered([{ ...esc, attempt: 1 }]);
      expect(all.some((c) => c.key === 'retry-rules')).toBe(true);
      expect(all.find((c) => c.key === 'skip-rules')?.skipRuleIds).toEqual(['U', 'W']);
      // The unit record is an earlier attempt's: re-check still, never its rule ids to skip.
      const later = offered([{ ...esc, attempt: 2 }]);
      expect(later.some((c) => c.key === 'retry-rules')).toBe(true);
      expect(later.some((c) => c.key === 'skip-rules')).toBe(false);
    });
    it('the gate card says the held rows', async () => {
      const client = await import('../src/api/client.js');
      vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
      const { GateRow } = await import('../src/components/session/GateRow.js');
      const { useRunEventStore } = await import('../src/store/events.js');
      useRunEventStore.setState({ byRun: { [RUN]: [{ type: 'awaitingHuman', session: RUN, ord: 5, gateKind: 'escalation', prompt: 'x' }] as unknown as CoreEvent[] } });
      render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, units)} gate={g} />);
      expect(screen.getByTestId('session-gate-rules-line').textContent).toBe('3 rules checked: 1 kept, 0 broken, 0 not applicable, 1 waived by your instruction (to confirm), 1 unchecked');
    });
  });

  describe('the gate row sends crew\'s answer', () => {
    const RUN = 'r-send';
    const PROMPT = "Unit 2's steering rules are UNCHECKED or waived by your instruction — 2 steering rule(s) need you.";
    const units = [
      makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 1, role: 'creator', status: 'done', assigned_cli: 'pi' }),
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'rejected', assigned_cli: 'claude' }),
    ] as WorkUnit[];
    const log = [
      { type: 'unitDispatched', session: RUN, ord: 2, attempt: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 2, combined: true, denial: { source: 'rules_unchecked', reason: 'x', ruleIds: ['U', 'W'] }, evaluatorPolicies: [],
        assurance: { ...base, rules: [row('K', 'kept'), row('B', 'broken'), row('U', 'unchecked'), row('W', 'waived')] } },
      { type: 'gateEscalated', session: RUN, ord: 2, condition: 'rules_unchecked', denialSource: 'rules_unchecked', verdictSummary: 'x' },
    ] as unknown as CoreEvent[];
    const g: OpenGate = { runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 1, gateKind: 'escalation' };

    async function mount(windowMs: number) {
      const client = await import('../src/api/client.js');
      vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
      const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
      const { setUndoWindowForTest } = await import('../src/board/undoQueue.js');
      setUndoWindowForTest(windowMs);
      const { GateRow } = await import('../src/components/session/GateRow.js');
      const { useRunEventStore } = await import('../src/store/events.js');
      const { useGateStore } = await import('../src/store/gates.js');
      useRunEventStore.setState({ byRun: { [RUN]: log } });
      useGateStore.setState({ gates: { [RUN]: g } });
      render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, units)} gate={g} />);
      const option = (key: string): HTMLElement => document.querySelector<HTMLElement>(`[data-ask-option="${key}"]`)!;
      return { confirm, option };
    }

    afterEach(async () => {
      const { undoDecision, useUndoQueue, setUndoWindowForTest } = await import('../src/board/undoQueue.js');
      for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
      setUndoWindowForTest(0);
    });

    it('the skip carries the held rules only, each with your reason, never an amend; no reason, no send', async () => {
      const { confirm, option } = await mount(0);
      fireEvent.click(option('skip-rules'));
      expect(screen.getByTestId('session-gate-skip-rules-label').textContent).toMatch(/required/);
      const note = screen.getByTestId('session-gate-note') as HTMLTextAreaElement;
      expect(note.value).toBe('');
      const send = screen.getByTestId('session-gate-send') as HTMLButtonElement;
      fireEvent.change(note, { target: { value: '   ' } });
      expect(send.disabled).toBe(true);
      fireEvent.change(note, { target: { value: ' Covered by the release checklist ' } });
      fireEvent.click(send);
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      const [runId, sent] = confirm.mock.calls[0]! as unknown as [string, Record<string, unknown>];
      expect(runId).toBe(RUN);
      expect(sent).toEqual({ approve: true, action: 'skip_rules', ord: 2, skipRules: [{ id: 'U', reason: 'Covered by the release checklist' }, { id: 'W', reason: 'Covered by the release checklist' }] });
    });

    it('the re-check sends retry_rules', async () => {
      const { confirm, option } = await mount(0);
      fireEvent.click(option('retry-rules'));
      fireEvent.click(screen.getByTestId('session-gate-confirm'));
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(confirm.mock.calls[0]![1]).toEqual({ approve: true, action: 'retry_rules', ord: 2 });
    });

    it('Undo gives the skip reason back', async () => {
      const { confirm, option } = await mount(60_000);
      fireEvent.click(option('skip-rules'));
      fireEvent.change(screen.getByTestId('session-gate-note'), { target: { value: 'Covered elsewhere' } });
      fireEvent.click(screen.getByTestId('session-gate-send'));
      const { undoDecision, useUndoQueue, takeRestoredNote } = await import('../src/board/undoQueue.js');
      await vi.waitFor(() => expect(useUndoQueue.getState().pending).toHaveLength(1));
      undoDecision(useUndoQueue.getState().pending[0]!.id);
      expect(confirm).not.toHaveBeenCalled();
      expect(takeRestoredNote(RUN)).toBe('Covered elsewhere');
    });
  });
});

it('(s4-ui-fix r2) a row with no reason says its cite', () => {
  const rows = receiptOf({ ...base, rules: [{ ...row('R', 'kept', ''), cite: 'src/math.test.js:12' }] })!.rules!;
  render(<RulesChecked rows={rows} />);
  expect(screen.getByTestId('assurance-rule').textContent).toContain(': src/math.test.js:12');
});

it('(s4-ui-fix r3) the undo notice says what a rule re-check and a rule skip do', async () => {
  const { describeDecision } = await import('../src/board/undoQueue.js');
  const retry = describeDecision({ approve: true, action: 'retry_rules' } as never);
  expect(retry.preview).toMatch(/rule check runs again/);
  expect(retry.preview).not.toMatch(/resumes/);
  expect(describeDecision({ approve: true, action: 'skip_rules', skipRules: [{ id: 'U', reason: 'r' }] } as never).preview).toMatch(/skipped with your reason/);
});

/**
 * DES-RULE-CHECK-001 rev 2 (rules-council-ui): a rule the rule judge and the reviewer disagreed on is "disputed: you
 * decide" with both readings; a council's ruling says its vote and its own seats (never the rule judge's); a process
 * rule is reported apart and never counted against the gate; and a dispute behind another denial (the reviewer's
 * FAIL, a capped review's adjudication) can still be re-checked, or confirmed or skipped with a reason.
 */
describe('(rev 2) disputed rules, council rulings and process rules', () => {
  const judgePos = { by: 'rule_judge', seat: 'claude', status: 'broken', cite: 'src/math.js:3 changes sum() and no test exercises it' };
  const reviewerPos = { by: 'reviewer', seat: 'codex', status: 'kept', cite: 'src/math.test.js:12 covers sum()' };
  const disputed = (id = 'DEV-TINYMATH-2'): Record<string, unknown> => ({
    ruleId: id, status: 'disputed', how: 'council', ruleKey: 'k', judge: 'claude', origin: 'judge',
    reason: 'the council reached no ruling (1 of 3 answered): no_quorum: the counted votes reached no majority (1 of 3 counted)',
    reviewer: reviewerPos,
    council: { taskId: 't-1', positions: [judgePos, reviewerPos], votes: [{ seat: 'agy', status: 'broken', counted: true }, { seat: 'pi', counted: false, whyNot: 'no answer' }, { seat: 'opencode', status: 'kept', counted: false, whyNot: 'names no changed file' }], seated: 3, returned: 2, agreementPct: 100, consensus: false, seed: 7, eligible: ['agy', 'pi', 'opencode'], reason: 'no_quorum: the counted votes reached no majority (1 of 3 counted)' },
  });
  const settled = (how = 'council'): Record<string, unknown> => ({
    ruleId: 'DEV-TINYMATH-2', status: 'broken', how, ruleKey: 'k', judge: 'claude', origin: 'council',
    reason: 'settled by council 2-1: sum() changed with no test', cite: 'sum() changed with no test',
    council: { taskId: 't-2', positions: [judgePos, reviewerPos], ruling: 'broken', votes: [{ seat: 'agy', status: 'broken', counted: true }, { seat: 'pi', status: 'broken', counted: true }, { seat: 'opencode', status: 'kept', counted: true }], seated: 3, returned: 3, agreementPct: 67, consensus: true, seed: 9, eligible: ['agy', 'pi', 'opencode'] },
  });
  const proc = (id: string, status: string, party: string): Record<string, unknown> => ({ ruleId: id, status, how: 'judge', ruleKey: 'k', judge: 'claude', origin: 'judge', reason: 'from the engine record', party, blocking: false });

  it('parses disputed (not unchecked), the council and the process fields', () => {
    const r = receiptOf({ ...base, rules: [disputed(), settled(), proc('RVWL-1001', 'broken', 'reviewer')] })!.rules!;
    expect(r.map((x) => x.status)).toEqual(['disputed', 'broken', 'broken']);
    expect(r[0]!.council?.positions.map((p) => [p.by, p.seat, p.status])).toEqual([['rule_judge', 'claude', 'broken'], ['reviewer', 'codex', 'kept']]);
    expect(r[1]!.origin).toBe('council');
    expect(r[2]).toMatchObject({ blocking: false, party: 'reviewer' });
    // Only an explicit false is a process row: an older engine's row blocks.
    expect(receiptOf({ ...base, rules: [row('A', 'kept')] })!.rules![0]!.blocking).toBe(true);
  });

  it('the line says disputed and settled by council, and leaves process rows out of the gate counts', () => {
    const r = receiptOf({ ...base, rules: [row('A', 'kept'), disputed('D'), settled(), proc('RVWL-1001', 'broken', 'reviewer'), proc('RVWL-1003', 'kept', 'engine')] })!.rules!;
    const s = rulesSummary(r);
    expect(s.line).toBe('3 rules checked: 1 kept, 1 broken, 0 not applicable, 1 disputed (you decide), 1 settled by council; 2 process rules reported (do not block): 1 kept, 1 broken, 0 not applicable');
    expect(s.disputed).toBe(1);
    // Negative control: a broken process row is never counted in the gate's broken.
    expect(rulesSummary(receiptOf({ ...base, rules: [row('A', 'kept'), proc('RVWL-1001', 'broken', 'reviewer')] })!.rules!)).toMatchObject({ broken: 0, line: '1 rule checked: 1 kept, 0 broken, 0 not applicable; 1 process rule reported (do not block): 0 kept, 1 broken, 0 not applicable' });
  });

  it('a disputed row says "you decide" with both readings and why no council ruled, open on its own', () => {
    const r = receiptOf({ ...base, rules: [row('A', 'kept'), disputed()] })!;
    render(<ReceiptView receipt={r} passed={false} />);
    expect(screen.getByTestId('assurance-rules').hasAttribute('open')).toBe(true);
    const li = screen.getAllByTestId('assurance-rule').find((x) => x.getAttribute('data-status') === 'disputed')!;
    expect(li.textContent).toContain('disputed: you decide DEV-TINYMATH-2');
    expect(li.textContent).not.toMatch(/\bunchecked\b|no_quorum/);
    expect(li.textContent).toContain('the council reached no ruling (1 of 3 answered): the counted votes reached no majority');
    const pos = screen.getAllByTestId('assurance-rule-position').map((x) => x.textContent);
    expect(pos[0]).toContain('Rule judge (claude): broken, ');
    expect(pos[0]).toContain('no test exercises it');
    expect(pos[1]).toContain('Reviewer (codex): kept, ');
    expect(screen.getByTestId('assurance-rule-votes').textContent).toBe('Council votes: agy: broken · pi: no vote (no answer) · opencode: kept (not counted: names no changed file)');
  });

  it('a council ruling says its vote and its own seats, never the rule judge as the council', () => {
    for (const how of ['council', 'cache']) {
      const r = receiptOf({ ...base, rules: [settled(how)] })!;
      const { unmount } = render(<ReceiptView receipt={r} passed={false} />);
      fireEvent.click(screen.getByTestId('assurance-rules-line'));
      const said = screen.getByTestId('assurance-rule-how').textContent!;
      expect(said).toBe(` settled by council 2-1 (agy, pi, opencode)${how === 'cache' ? ', unchanged since' : ''}`);
      // Negative control: the row's judge (the rule judge, claude) is not named as who settled it.
      expect(said).not.toContain('claude');
      expect(screen.getByTestId('assurance-rule').textContent).toContain(': sum() changed with no test');
      expect(screen.getAllByTestId('assurance-rule-position').map((x) => x.getAttribute('data-by'))).toEqual(['rule_judge', 'reviewer']);
      expect(screen.getAllByTestId('assurance-rule-vote').map((x) => x.textContent)).toEqual(['agy: broken', ' · pi: broken', ' · opencode: kept']);
      unmount();
    }
    // A council row whose ruling it does not carry is never "by a judge (claude)" either.
    const odd = receiptOf({ ...base, rules: [{ ...settled(), council: null }] })!;
    render(<RulesChecked rows={odd.rules!} />);
    expect(screen.getByTestId('assurance-rule-how').textContent).toBe(' by council');
  });

  it('a process row sits in its own group, with its party, said not to block', () => {
    const r = receiptOf({ ...base, rules: [row('A', 'kept'), proc('RVWL-1001', 'broken', 'reviewer')] })!;
    render(<RulesChecked rows={r.rules!} />);
    const group = screen.getByTestId('assurance-rules-process');
    expect(group.textContent).toContain('Process rules: reported, they do not block this gate');
    expect(group.textContent).toContain("broken RVWL-1001 by a judge (claude): from the engine record · about the reviewer's conduct; reported, does not block");
    expect(screen.getByTestId('assurance-rules').getAttribute('data-tone')).toBe('ok');
  });

  describe("a dispute behind the reviewer's FAIL", () => {
    const RUN = 'r-dispute';
    const FAIL = 'Unit 5 verdict is NOT PASS — Request changes to send it back for rework, approve to run the step again, or reject to cancel the run';
    const ADJ = "Unit 5 verdict is NOT PASS again — round 3, after 2 send-backs to unit 4 (the rework cap is 2), so this gate adjudicates instead of sending it back. Items — none. Approve = LAND WITH CARRIED ITEMS: the creator's work counts. Request changes = ONE MORE ROUND. Reject = STOP the run";
    const units = [
      makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'done', assigned_cli: 'pi' }),
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 5, role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
    ] as WorkUnit[];
    const log = (rules: unknown[]): CoreEvent[] => [
      { type: 'unitDispatched', session: RUN, ord: 5, ts: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 5, ts: 2, combined: false, denial: { source: 'evaluator_verdict', reason: 'FAIL', ruleIds: [] }, assurance: { ...base, rules } },
      { type: 'gateEscalated', session: RUN, ord: 5, ts: 3, attempt: 1, condition: 'verdict_not_pass', denialSource: 'evaluator_verdict', verdictSummary: 'FAIL' },
    ] as unknown as CoreEvent[];
    const offered = (events: CoreEvent[], prompt = FAIL, gateKind: OpenGate['gateKind'] = 'escalation', u: WorkUnit[] = units) => {
      const g = { runId: RUN, ord: 5, prompt, gateKind, lifecycle: 'open', receivedAt: 1 } as OpenGate;
      const m = sessionGateChoices({ runId: RUN, gate: g, units: u, events, pool: ['pi', 'codex'], roster: null })!;
      return [...m.choices, ...(m.overflow ?? [])] as Array<{ key: string; skipRuleIds?: string[]; decision: unknown }>;
    };

    it('offers the re-check and the confirm-or-skip of the disputed rule only, after Send back', () => {
      const all = offered(log([row('A', 'kept'), row('B', 'broken'), disputed(), proc('RVWL-1002', 'unchecked', 'engine')]));
      const keys = all.map((c) => c.key);
      expect(keys).toEqual(expect.arrayContaining(['send-back', 'retry-rules', 'skip-rules']));
      expect(keys.indexOf('send-back')).toBeLessThan(keys.indexOf('retry-rules'));
      // Never the broken row, never a process row.
      expect(all.find((c) => c.key === 'skip-rules')?.skipRuleIds).toEqual(['DEV-TINYMATH-2']);
      expect(all.find((c) => c.key === 'skip-rules')?.decision).toEqual({ approve: true, action: 'skip_rules' });
    });

    it("at a capped review's adjudication too", () => {
      const all = offered(log([disputed()]), ADJ, 'review_adjudication');
      expect(all.map((c) => c.key)).toEqual(expect.arrayContaining(['retry-rules', 'skip-rules']));
    });

    it('negative controls: no rule held behind it (broken, kept, process only) offers neither; a dispatch after it voids it', () => {
      for (const rules of [[row('B', 'broken')], [row('A', 'kept')], [proc('RVWL-1002', 'unchecked', 'engine'), proc('RVWL-1001', 'broken', 'reviewer')]]) {
        const keys = offered(log(rules)).map((c) => c.key);
        expect(keys.some((k) => k === 'retry-rules' || k === 'skip-rules'), JSON.stringify(rules)).toBe(false);
      }
      const later = [...log([disputed()]), { type: 'unitDispatched', session: RUN, ord: 5, ts: 4 }] as unknown as CoreEvent[];
      expect(offered(later).some((c) => c.key === 'retry-rules')).toBe(false);
    });

    it("no log in hand: the unit record's denials_behind decides", () => {
      const rec = (behind: unknown[], rules: unknown[] = [row('A', 'kept')]) => units.map((u) => (u.ord === 5 ? { ...u, denial: { source: 'evaluator_verdict', reason: 'FAIL' }, denials_behind: behind, assurance: { ...base, rules } } : u)) as unknown as WorkUnit[];
      expect(offered([], FAIL, 'escalation', rec([{ source: 'evaluator_verdict', reason: 'x' }, { source: 'rules_unchecked', reason: 'y' }])).some((c) => c.key === 'retry-rules')).toBe(true);
      expect(offered([], FAIL, 'escalation', rec([{ source: 'evaluator_verdict', reason: 'x' }])).some((c) => c.key === 'retry-rules')).toBe(false);
      expect(offered([], FAIL, 'escalation', rec([], [disputed()])).find((c) => c.key === 'skip-rules')?.skipRuleIds).toEqual(['DEV-TINYMATH-2']);
    });

    it('the gate card says the dispute, both readings and the offer', async () => {
      const client = await import('../src/api/client.js');
      vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
      const { GateRow } = await import('../src/components/session/GateRow.js');
      const { useRunEventStore } = await import('../src/store/events.js');
      useRunEventStore.setState({ byRun: { [RUN]: log([row('A', 'kept'), disputed()]) } });
      const g: OpenGate = { runId: RUN, ord: 5, prompt: FAIL, lifecycle: 'open', receivedAt: 1, gateKind: 'escalation' };
      render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, units)} gate={g} />);
      expect(screen.getByTestId('session-gate-rules-line').textContent).toBe('2 rules checked: 1 kept, 0 broken, 0 not applicable, 1 disputed (you decide)');
      expect(screen.getAllByTestId('assurance-rule-position')).toHaveLength(2);
      expect(document.querySelector('[data-ask-option="skip-rules"]')).not.toBeNull();
    });
  });

  it('the delivery says a council ruling and a skipped dispute', () => {
    const RUN = 'r-deliver-council';
    const units = [makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' })] as WorkUnit[];
    // The engine's skip row is a fresh row (no judge, no council): core rule_check.rs `row(Skipped, Operator, …)`.
    const skippedDispute = { ruleId: 'D2', status: 'skipped', how: 'operator', origin: 'operator', ruleKey: 'k', reason: 'skipped by you: the reviewer is right, the test covers it' };
    const events = [{ type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [settled(), skippedDispute] } }] as unknown as CoreEvent[];
    const d = deliveryReceiptOf(makeView({ id: RUN, status: 'completed' } as never, units), events, null)!;
    render(<ReceiptView receipt={d} passed />);
    expect(screen.getByTestId('assurance-rules-line').textContent).toBe('2 rules checked: 0 kept, 1 broken, 0 not applicable, 1 skipped by the operator, 1 settled by council');
    fireEvent.click(screen.getByTestId('assurance-rules-line'));
    const rows = screen.getAllByTestId('assurance-rule');
    expect(rows[0]!.textContent).toContain('settled by council 2-1 (agy, pi, opencode)');
    expect(rows[1]!.textContent).toContain('skipped D2 by the operator: skipped by you: the reviewer is right');
  });
});
