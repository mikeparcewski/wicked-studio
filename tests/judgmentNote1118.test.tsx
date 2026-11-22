/**
 * studio#1118 (2): on a gate no judge could rule on, "Approve as your own judgment" is an approve. Its box asks for
 * the operator's reason and opens empty; it never carries the reviewer's failing items, which are Send back's words.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { OPERATOR_JUDGMENT_LABEL, type RejudgeOffer } from '../src/board/rejudge.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-judgment-note';
const NOW = 1_700_000_000_000;

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:reproduce`, session_id: RUN, ord: 3, role: 'neutral', status: 'done', stage: 'build', assigned_cli: 'codex' }),
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'rejected', stage: 'build', assigned_cli: 'claude' }),
];

const PROMPT =
  'Unit 4 could not be judged — no eligible judge seat remained: agent judge could not run — every eligible judge seat failed: pi (no_seat_image). '
  + 'The work was not rejected. Approve to judge it yourself (it counts, labelled "judged by operator"), re-run the judge on the same work once a judge seat can rule (action `rejudge`; the step does not run again), request changes to send it back for rework, or reject to cancel the run';

// The report-3 shape: the denial carries bulleted lines, which the gate reads as the reviewer's failing items.
const REASON = '- the run requires a judge seat that can rule\n- every eligible judge seat failed: pi (no_seat_image)';

const EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 4, attempt: 2 },
  { type: 'gateEvaluated', session: RUN, ord: 4, combined: false, denial: { source: 'judge_unavailable', reason: REASON, claimId: null, ruleIds: [], deniedTool: null, phase: null }, denialReason: REASON, hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'reject', judgeCli: null, judgeDistinct: null, evaluatorPolicies: [] },
  { type: 'gateEscalated', session: RUN, ord: 4, condition: 'judge_unavailable', denialSource: 'judge_unavailable', verdictSummary: REASON },
  { type: 'awaitingHuman', session: RUN, ord: 4, prompt: PROMPT, gateKind: 'escalation' },
] as unknown as CoreEvent[];

const GATE: OpenGate = { runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
const NONE: RejudgeOffer = { available: false, eligible: [], missing: [{ seat: 'claude', reason: 'built this work' }] };

describe('the own-judgment note (studio#1118)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: '', rejudge: NONE } as never);
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
  });
  afterEach(() => cleanup());

  it('the gate does carry the reviewer\'s failing items (for Send back)', () => {
    const m = sessionGateChoices({ runId: RUN, gate: GATE, units: UNITS, events: EVENTS, pool: ['claude', 'codex', 'pi'], roster: null, rerun: null, fullVerdict: null, rejudge: NONE })!;
    expect(m.choices.map((c) => c.label)).toContain(OPERATOR_JUDGMENT_LABEL);
    expect(m.noteDefault).toMatch(/^Fix the reviewer's failing items/);
  });

  it('choosing the own judgment opens an empty reason box; Send back keeps its findings', async () => {
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['claude', 'codex', 'pi'] } as never, UNITS)} gate={GATE} navigate={vi.fn()} />);
    fireEvent.click(await screen.findByText(OPERATOR_JUDGMENT_LABEL, { selector: '[data-choice-key="steer"] b' }));
    const note = await screen.findByTestId('session-gate-note') as HTMLTextAreaElement;
    expect(note.value).toBe('');
    expect(note.value).not.toMatch(/Fix the reviewer/);
    expect(screen.getByTestId('session-gate-judgment-label').textContent).toMatch(/^Your reason \(required/);
    fireEvent.click(screen.getByText('Send back', { selector: '[data-choice-key="send-back"] b' }));
    const back = await screen.findByTestId('session-gate-note') as HTMLTextAreaElement;
    expect(back.value).toMatch(/^Fix the reviewer's failing items/);
  });
});
