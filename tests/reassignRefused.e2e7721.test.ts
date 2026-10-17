/**
 * E2E :7721 (crew 0.13.2 / studio 0.9.6) defects, studio half.
 *
 * studio#813 (run 9c3f20fa): unit 3 (a review, routed `evaluator_distinct`) failed on copilot and the
 * gate offered "Reassign to Pi CLI" — but pi made the work that review checks, so the engine refuses
 * it. crew serves those seats as `WorkUnit.reassign_refused` (wicked-crew#1058); the row offers none
 * of them and says why under Technical details. An older crew sends no field: every seat is offered.
 *
 * studio#814: `GET /runs/:id/gate` carries `gateKind` on a newer crew; the one reader of that answer
 * keeps it, so a reloaded escalation is never re-classified from its unit.
 */
import { describe, expect, it } from 'vitest';
import type { CoreEvent, GateInfo, WorkUnit } from '../src/api/types.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { gateFromInfo, type OpenGate } from '../src/store/gates.js';
import { makeUnit } from './factories.js';

const RUN = 'r-9c3f';
const NOW = 1_700_000_000_000;
const PROMPT = 'Unit 3 failed and triage escalated: copilot exited 1 — confirm to retry the phase, or reject to cancel the run';
const EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 3, attempt: 0, cli: 'copilot', ts: NOW - 5000, seq: 1 },
  { type: 'stepFailed', session: RUN, ord: 3, ts: NOW - 1000, seq: 2, failureKind: 'workerError', detail: 'copilot exited 1' },
  { type: 'awaitingHuman', session: RUN, ord: 3, ts: NOW - 800, seq: 3, prompt: PROMPT, gateKind: 'escalation' },
] as unknown as CoreEvent[];
const GATE: OpenGate = { runId: RUN, ord: 3, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

function units(refused?: string[]): WorkUnit[] {
  return [
    makeUnit({ id: `${RUN}:scope`, session_id: RUN, ord: 1, stage: 'recon', status: 'done', assigned_cli: 'pi' }),
    makeUnit({ id: `${RUN}:triage`, session_id: RUN, ord: 2, stage: 'recon', status: 'done', assigned_cli: 'pi' }),
    makeUnit({
      id: `${RUN}:reproduce`, session_id: RUN, ord: 3, stage: 'test', status: 'rejected', assigned_cli: 'copilot',
      ...(refused !== undefined ? { reassign_refused: refused } : {}),
    } as Partial<WorkUnit>),
  ];
}
const reassigns = (u: WorkUnit[]): string[] => {
  const m = sessionGateChoices({ runId: RUN, gate: GATE, units: u, events: EVENTS, pool: ['pi', 'copilot'], roster: null })!;
  return [...m.choices, ...m.overflow].filter((c) => c.key.startsWith('reassign:')).map((c) => c.label);
};

describe('studio#813 — a seat the engine refuses is never offered', () => {
  it('crew names pi as refused: no "Reassign to pi", and Technical details say why', () => {
    expect(reassigns(units(['pi']))).toEqual([]);
    const m = sessionGateChoices({ runId: RUN, gate: GATE, units: units(['pi']), events: EVENTS, pool: ['pi', 'copilot'], roster: null })!;
    expect(m.detailItems.some((d) => /Not offered for reassign: pi — it made the work this step checks/.test(d))).toBe(true);
  });

  it('an older crew (no field) offers the pool as before', () => {
    expect(reassigns(units())).toEqual(['Reassign to pi']);
  });
});

describe('studio#814 — the gate read keeps the kind', () => {
  const info = { runId: RUN, ord: 2, prompt: 'The deliver phase refused: deliver: nothing to deliver', lifecycle: 'open', receivedAt: new Date(NOW).toISOString() } as GateInfo;
  it('a newer crew\'s gateKind rides into the store; an older crew\'s answer has none', () => {
    expect(gateFromInfo({ ...info, gateKind: 'escalation' } as GateInfo)).toMatchObject({ runId: RUN, ord: 2, gateKind: 'escalation', receivedAt: NOW });
    expect(gateFromInfo(info)).not.toHaveProperty('gateKind');
  });
});

describe('studio#816 — a closed ask reads its answers from the run', () => {
  it('names the done answer steps (by step id, or by the engine\'s description), in order', async () => {
    const { askAnswerUnits, askAnswerText } = await import('../src/board/askThread.js');
    const view = {
      session: { id: 'r-ask' },
      units: [
        { id: 'r-ask:deliver', ord: 3, status: 'pending', assigned_cli: null },
        { id: 'r-ask:answer-2', ord: 2, status: 'distributed', assigned_cli: 'pi' },
        { id: 'r-ask:answer-1', ord: 1, status: 'done', assigned_cli: 'pi' },
        { id: 'r-ask:u4', ord: 4, status: 'done', assigned_cli: 'claude', description: 'answer-3 — answer it' },
      ],
    };
    expect(askAnswerUnits(view)).toEqual([
      { runId: 'r-ask', ord: 1, key: 'answer-1', by: 'pi' },
      { runId: 'r-ask', ord: 4, key: 'u4', by: 'claude' },
    ]);
    expect(askAnswerText('SCOPE answer\nThe answer.\nPLAN+ {"steps":[]}\n')).toBe('The answer.');
  });
});
