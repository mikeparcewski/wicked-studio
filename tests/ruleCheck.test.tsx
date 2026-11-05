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

describe('(s4-ui-fix r2) partial histories and the skip as sent', () => {
  it('an aggregate row the gates in hand never re-evaluated still joins deny-dominates', () => {
    const RUN = 'r-partial';
    const units = [
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'done' }),
      makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 4, role: 'neutral', status: 'done' }),
    ] as WorkUnit[];
    // The log holds review's kept row and the lift (QE's broken row is only in the lift's aggregate).
    const events = [
      { type: 'gateEvaluated', session: RUN, ord: 2, ts: 1, assurance: { ...base, rules: [row('R', 'kept'), row('S', 'kept')] } },
      { type: 'deliverLiftEvaluated', session: RUN, ord: 4, ts: 2, assurance: { ...base, rules: [row('R', 'broken', 'qe found it'), row('S', 'skipped', 'skipped by you: covered')] } },
    ] as unknown as CoreEvent[];
    const d = deliveryReceiptOf(makeView({ id: RUN, status: 'completed' } as never, units), events, null)!;
    expect(d.rules?.map((x) => [x.ruleId, x.status, x.reason])).toEqual([['R', 'broken', 'qe found it'], ['S', 'skipped', 'skipped by you: covered']]);
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
    it('only the escalation frame: held from the wire, the rows from the unit record', () => {
      const all = offered([{ type: 'gateEscalated', session: RUN, ord: 5, condition: 'rules_unchecked', denialSource: 'rules_unchecked', verdictSummary: 'x' }]);
      expect(all.some((c) => c.key === 'retry-rules')).toBe(true);
      expect(all.find((c) => c.key === 'skip-rules')?.skipRuleIds).toEqual(['U', 'W']);
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
