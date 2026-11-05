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
    const other = [events[0]!, { ...(events[1] as unknown as Record<string, unknown>), denial: { source: 'evaluator_verdict', reason: 'x', claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-5' } }] as unknown as CoreEvent[];
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
