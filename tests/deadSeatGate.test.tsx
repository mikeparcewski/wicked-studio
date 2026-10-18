// studio#835: when the only seat of a run is benched for quota, the gate card said only "The step was
// escalated — how should it go on?" and offered "Approve and steer", which re-tries the seat the engine
// says it never sends the step to again. The card now names the helper and why, and offers what can work.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { deadSeatOf, sessionGateChoices } from '../src/board/gateRowModel.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import { DeadSeatLine } from '../src/components/session/GateRow.js';
import { makeUnit } from './factories.js';

afterEach(cleanup);

const RUN = 'r-dead';
const NOW = 1_700_000_000_000;
/** The engine's words on run 63c38801 (crew 0.14.0). */
const PROMPT = "Unit 1 (copilot) failed on a dead seat: dead seat: 'copilot' exhausted its quota on unit 1 (quota_exhausted) and no eligible seat remains — 1 of 1 seats benched. Reassign the unit to a different CLI (sign one in first if needed) and approve to retry, or reject to stop the run";
const UNITS: WorkUnit[] = [makeUnit({ id: `${RUN}:answer`, session_id: RUN, ord: 1, stage: 'build', role: 'creator', status: 'rejected', assigned_cli: 'copilot' })];
const EVENTS = [
  { type: 'seatBenched', session: RUN, ord: 1, cli: 'copilot', reason: 'quota_exhausted (no success in the run)', source: 'worker', ts: NOW - 2000, seq: 1 },
  { type: 'gateEscalated', session: RUN, ord: 1, condition: 'dead_seat', denialSource: 'dead_seat', verdictSummary: "seat 'copilot' exhausted its quota", ts: NOW - 1000, seq: 2, attempt: 0 },
  { type: 'awaitingHuman', session: RUN, ord: 1, prompt: PROMPT, gateKind: 'escalation', ts: NOW - 900, seq: 3 },
] as unknown as CoreEvent[];
const gate: OpenGate = { runId: RUN, ord: 1, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

describe('studio#835 — a dead-seat gate says why, and offers what can work', () => {
  it('reads the seat and its cause off the run (the seatBenched frame first)', () => {
    expect(deadSeatOf(PROMPT, EVENTS)).toEqual({ cli: 'copilot', cause: 'quota' });
    expect(deadSeatOf('Unit 2 (pi) failed on a dead seat: … Reassign the unit …', [])).toEqual({ cli: 'pi', cause: 'unusable' });
    expect(deadSeatOf('Unit 2 (pi) failed on a dead seat: x', [{ type: 'seatBenched', cli: 'pi', reason: 'not_logged_in' } as unknown as CoreEvent])).toEqual({ cli: 'pi', cause: 'signed_out' });
    expect(deadSeatOf('Unit 2 failed and triage escalated: x', EVENTS)).toBeNull();
  });

  it('the only seat: no approve that retries it — Stop alone, and the cause rides on the model', () => {
    const model = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: EVENTS, pool: ['copilot'], roster: null })!;
    expect(model.deadSeat).toEqual({ cli: 'copilot', cause: 'quota' });
    expect([...model.choices, ...model.overflow].map((c) => c.key)).toEqual(['stop']);
  });

  it('another helper in the job: Reassign to it is offered, still no approve', () => {
    const roster = [{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, auth: 'signed_in', council_eligible: true }] as never;
    const model = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: EVENTS, pool: ['copilot', 'codex'], roster })!;
    const keys = [...model.choices, ...model.overflow].map((c) => c.key);
    expect(keys).toContain('reassign:codex');
    expect(keys).not.toContain('steer');
    expect(keys).not.toContain('approve');
  });

  it('the headline names the helper and the cause', () => {
    expect(plainGateQuestion(PROMPT, 'escalation')).toBe('Copilot is out of quota — move the step to another helper, or stop?');
  });

  it('the line says it in plain words, with the way out', () => {
    render(<DeadSeatLine seat={{ cli: 'copilot', cause: 'quota' }} label={null} canReassign={false} navigate={() => {}} />);
    const line = screen.getByTestId('session-gate-dead-seat');
    expect(line.textContent).toContain('Copilot is out of quota.');
    expect(line.textContent).toContain('No other helper is in this job');
    expect(screen.getByTestId('session-gate-dead-seat-signin').textContent).toContain('Sign another helper in');
  });
});
