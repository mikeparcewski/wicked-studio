/**
 * wicked-core#1318 / #1675: a reasoned operator judgment past a failed tool check, at its `triage` gate.
 * The engine lists `operator_judgment` there (fixture `triage-tool-check`); taking it records a `floorOverride` with layer
 * `tool_check` and the label "tool check overridden by operator". The card and the run say it in those words, never as a
 * repository-checks floor.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { receiptOf, receiptWords } from '../src/board/assuranceModel.js';
import { approvedLine, overriddenFloorsOf, overriddenLine, toolCheckOverrideLines } from '../src/board/failingChecks.js';
import { FLOOR_OVERRIDE_KEY, TOOL_CHECK_OVERRIDE_CONSEQUENCE, TOOL_CHECK_OVERRIDE_KEY } from '../src/board/floorOverride.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { contractChoices, type GateAction } from '../src/board/gateContract.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { describeDecision, setUndoWindowForTest, useUndoQueue } from '../src/board/undoQueue.js';
import { AssuranceReceipt as ReceiptView } from '../src/components/session/AssuranceReceipt.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import type { OpenGate } from '../src/store/gates.js';
import { chooseGate } from './askGateHelpers.js';
import { makeUnit, makeView } from './factories.js';

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/gate-actions.engine.json'), 'utf8')) as Record<string, { actions: GateAction[]; gateKind: string; ord: number }>;
const triage = fixture['triage-tool-check']!;
const seat = (cli: string): string => cli;
const RUN = 'r-triage';
const PROMPT = 'Unit 4 failed and triage escalated: the verify check failed: 2 tests red. Failure output: "FAIL tests/import.test.ts". '
  + 'Approve to run the step again (optionally amend), request changes to run it again with your note, or reject to stop the run.';

describe('the triage gate of a failed tool check (wicked-core#1318)', () => {
  it('the engine shape lists the judgment with a required reason', () => {
    expect(triage.gateKind).toBe('triage');
    expect(triage.actions.find((a) => a.action === 'operator_judgment')).toMatchObject({ intent: 'operator_judgment', note: 'required' });
  });

  it('draws it as a tool-check judgment at triage, and as the floor override elsewhere', () => {
    const at = (gateKind: string | null) => Object.values(contractChoices(triage.actions, seat, { gateKind })).flat()
      .find((c) => (c.decision as { action?: string } | null)?.action === 'operator_judgment')!;
    const tool = at('triage');
    expect(tool).toMatchObject({ key: TOOL_CHECK_OVERRIDE_KEY, label: 'Approve as your own judgment', note: 'required', decision: { approve: true, action: 'operator_judgment' } });
    expect(tool.title).toContain('tool check overridden by operator');
    expect(tool.title).not.toMatch(/floor/i);
    expect(at('escalation').key).toBe(FLOOR_OVERRIDE_KEY);
  });

  it('the session row reads the kind off the gate, or off its pause frame', () => {
    const units = [makeUnit({ ord: 4, stage: 'test', status: 'distributed', session_id: RUN } as never)];
    const frame = { type: 'awaitingHuman', session: RUN, ord: 4, gateKind: 'triage', prompt: PROMPT, seq: 9, ts: 1 } as unknown as CoreEvent;
    for (const [gateKind, events] of [['triage', []], [undefined, [frame]]] as const) {
      const gate: OpenGate = { runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: 1, ...(gateKind !== undefined ? { gateKind } : {}) };
      const model = sessionGateChoices({ runId: RUN, gate, units, events: [...events], pool: ['claude', 'codex'], roster: null, actions: triage.actions })!;
      expect([...model.choices, ...model.overflow].map((c) => c.key)).toContain(TOOL_CHECK_OVERRIDE_KEY);
    }
  });
});

describe('the triage card asks for the reason, in the tool check\'s words', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setUndoWindowForTest(0);
    useGateActionStore.setState({ byGate: {} });
    useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} });
    vi.spyOn(api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });
  afterEach(() => { cleanup(); useUndoQueue.setState({ pending: [], results: [], restoredNotes: {} }); });

  it('says what it does first, opens an empty box, and sends the operator judgment with the reason', async () => {
    const log = [{ type: 'awaitingHuman', session: RUN, ord: 4, gateKind: 'triage', prompt: PROMPT, seq: 9, ts: 1 }] as unknown as CoreEvent[];
    useRunEventStore.setState({ byRun: { [RUN]: log } });
    vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: log } as never);
    const gate: OpenGate = { runId: RUN, ord: 4, prompt: PROMPT, gateKind: 'triage', receivedAt: 1, lifecycle: 'open', actions: triage.actions };
    const units = [makeUnit({ ord: 4, stage: 'test', status: 'distributed', session_id: RUN } as never)];
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, units)} gate={gate} />);
    const choice = screen.getAllByTestId('session-gate-choice').find((c) => c.dataset['choiceKey'] === TOOL_CHECK_OVERRIDE_KEY)!;
    expect(choice.textContent).toContain('Approve as your own judgment');
    fireEvent.click(choice);
    expect(screen.getByTestId('session-gate-tool-check-override-consequence').textContent).toContain(TOOL_CHECK_OVERRIDE_CONSEQUENCE);
    expect(screen.getByTestId('session-gate-tool-check-override-label').textContent).toBe('Your reason (required)');
    const box = screen.getByTestId('session-gate-note') as HTMLTextAreaElement;
    expect(box.value).toBe('');
    expect(box.placeholder).toContain('failed check');
    expect(screen.queryByTestId('session-gate-floor-override-consequence')).toBeNull();
    expect((screen.getByTestId('session-gate-send') as HTMLButtonElement).disabled).toBe(true);
    chooseGate(choice, 'known flaky check; inspected the output');
    await waitFor(() => expect(api.confirmGate).toHaveBeenCalledWith(RUN, expect.objectContaining({ approve: true, action: 'operator_judgment', amend: 'known flaky check; inspected the output' })));
  });
});

describe('the run says the tool check the operator overrode (label and reason)', () => {
  afterEach(() => cleanup());
  // The engine's record (core#1675 `triage_tool_check_judgment_counts_and_preserves_qe`), as the wire carries it.
  const judgment = {
    by: 'local (human)', at: 1, note: 'known flaky check; inspected the output',
    floorOverride: { layer: 'tool_check', resultId: `${RUN}:unit-4:attempt-7:tool_check`, ord: 4, attempt: 7, tree: null, label: 'tool check overridden by operator' },
  };
  const receipt = {
    mode: 'full', required: ['judge', 'qe_acceptance'], ran: ['operator_judge'], skipped: [],
    creator: 'codex', evaluator: null, judge: null, tree: null, attempt: 7, operatorJudges: [judgment],
  };

  it('the receipt names the engine\'s label and the reason, never a repository-checks floor', () => {
    const r = receiptOf(receipt)!;
    expect(receiptWords(r, true).who).toContain('tool check overridden by operator (you)');
    expect(receiptWords(r, true).who).not.toContain('floor overridden');
    render(<ReceiptView passed receipt={r} units={[makeUnit({ ord: 4, id: `${RUN}:verify`, stage: 'test' } as never)]} />);
    expect(screen.getByTestId('assurance-tool-check-overridden').textContent).toBe('Tool check overridden by operator');
    expect(screen.getByTestId('assurance-tool-check-overridden-line').textContent)
      .toBe('At one gate the Verify step’s tool check (attempt 8) failed and you overrode it: known flaky check; inspected the output. The check did not run again; QE acceptance is still required.');
    expect(screen.queryByTestId('assurance-floor-overridden')).toBeNull();
    expect(screen.queryByTestId('assurance-floor-overridden-line')).toBeNull();
    // Only the operator's judgment ran: never "Only automatic checks ran" (codex review, class a).
    expect(screen.getByTestId('assurance-receipt').querySelector('.wk-assurance-kind')!.textContent).toBe('Accepted on the operator’s judgment');
    // Technical details say the same (codex review r2).
    expect(receiptWords(r, true).label).toBe('Accepted on the operator’s judgment');
    expect(receiptWords(r, null).label).toBe('Judged by the operator');
  });

  it('a repo-checks floor override with only the operator\'s judgment on its receipt stays a floor (codex review r2)', () => {
    const r = receiptOf({ ...receipt, operatorJudges: [{ ...judgment, floorOverride: { ...judgment.floorOverride, layer: 'repo_checks', label: 'floor overridden by operator', resultId: `${RUN}:unit-4:attempt-7:repo_checks` } }] })!;
    expect(receiptWords(r, true).label).toBe('Floor-only approval');
    render(<ReceiptView passed receipt={r} />);
    expect(screen.getByTestId('assurance-receipt').querySelector('.wk-assurance-kind')!.textContent).toBe('Only automatic checks ran');
    expect(screen.getByTestId('assurance-floor-overridden').textContent).toBe('Floor overridden by operator');
  });

  it('the run\'s durable record gives one line while it runs, and no repository-checks floor', () => {
    const view = makeView({ id: RUN, status: 'executing' } as never, [makeUnit({ ord: 4, id: `${RUN}:verify`, stage: 'test' } as never)]) as SessionView;
    (view.session as unknown as { assurance: unknown }).assurance = { floorOverrides: [judgment] };
    expect(toolCheckOverrideLines(view, (ord) => (ord === 4 ? 'Verify' : null)))
      .toEqual(['Tool check overridden by operator: the Verify step’s tool check (attempt 8), by you: “known flaky check; inspected the output”.']);
    // The hand-over still says it was overridden (never "The checks passed"), in the tool check's words.
    const o = overriddenFloorsOf(null, [], view)!;
    expect(o).toMatchObject({ floors: 0, toolChecks: 1, checks: [] });
    expect(approvedLine(o)).toBe('You approved a failed tool check on your own judgment; it did not run again.');
    expect(overriddenLine(o)).toBe('Overridden by you: a failed tool check counted on your judgment.');
  });

  it('a repo-checks floor and a tool check on one run are each said in their own words', () => {
    const floor = { ...judgment, note: 'load flakes', floorOverride: { layer: 'repo_checks', resultId: `${RUN}:unit-2:attempt-1:repo_checks`, ord: 2, attempt: 1, tree: 'abc', label: 'floor overridden by operator' } };
    const view = makeView({ id: RUN, status: 'completed' } as never, []) as SessionView;
    (view.session as unknown as { assurance: unknown }).assurance = { floorOverrides: [floor, judgment] };
    const o = overriddenFloorsOf(null, [], view)!;
    expect(o).toMatchObject({ floors: 1, toolChecks: 1 });
    expect(approvedLine(o)).toBe('You approved the repository checks, which did not pass. You also approved a failed tool check on your own judgment.');
    expect(overriddenLine(o)).toBe('Overridden by you: the repository checks failed on this change; a failed tool check counted on your judgment.');
  });

  it('the undo preview says the reason is the judgment\'s, never guidance', () => {
    const { preview } = describeDecision({ approve: true, action: 'operator_judgment', amend: 'known flaky' } as never);
    expect(preview).toBe('Approved on your own judgment: your reason is recorded on the run and the delivery, and the run goes on past this gate.');
    expect(preview).not.toContain('guidance');
  });
});
