// PRODUCT-WORKS J4 (rig 2026-10-26): after a container-runtime blip the dead-seat card offered ONLY
// "Reassign to GitHub Copilot CLI", a seat that was out of quota; it failed at once. A reassign now
// offers only helpers that can take work (signed in, not benched); the others are shown greyed out
// with their reason and lift time, beside a Sign in link, and a card with nothing usable says who is
// back first and when.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreEvent, RosterSeat, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { sessionGateChoices, soonestBack } from '../src/board/gateRowModel.js';
import { liftClock, reassignCandidates, runBenchesOf, seatStanding } from '../src/components/gateVerdictModel.js';
import { DeadSeatLine, WithheldSeats } from '../src/components/session/GateRow.js';
import { makeUnit } from './factories.js';

afterEach(cleanup);

const RUN = 'r-j4';
const NOW = Date.parse('2026-10-26T08:30:00Z');
const LIFT = '2026-10-26T09:19:00Z';
const PROMPT = "Unit 5 (claude) failed on a dead seat: dead seat: 'claude' failed unit 5 (worker error) and every eligible seat has now failed it (tried: claude, copilot) — 0 of 3 seats benched. Reassign the unit to a different CLI (sign one in first if needed) and approve to retry, or reject to stop the run";
const UNITS: WorkUnit[] = [makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 5, stage: 'build', role: 'creator', status: 'rejected', assigned_cli: 'claude' })];
const EVENTS = [
  { type: 'gateEscalated', session: RUN, ord: 5, condition: 'dead_seat', denialSource: 'dead_seat', verdictSummary: 'dead seat', ts: NOW - 1000, seq: 1, attempt: 4 },
  { type: 'awaitingHuman', session: RUN, ord: 5, prompt: PROMPT, gateKind: 'escalation', ts: NOW - 900, seq: 2 },
] as unknown as CoreEvent[];
const gate: OpenGate = { runId: RUN, ord: 5, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

const seat = (key: string, display: string, extra: Record<string, unknown> = {}): RosterSeat =>
  ({ key, display_name: display, binary: key, enabled_for_council: true, auth: 'signed_in', council_eligible: true, signed_in: true, ...extra }) as never;
/** Copilot out of quota until 09:19 (crew#1138's flat bench fields + `recent_bench`). */
const COPILOT_BENCHED = seat('copilot', 'GitHub Copilot CLI', {
  benchedUntil: LIFT, benchReason: 'quota_exhausted',
  recent_bench: { kind: 'quota_exhausted', runs: 1, last_at: '2026-10-26T08:19:00Z', lifts_at: LIFT, until_source: 'engine', strikes: 1, source: 'worker', reason: 'quota_exhausted' },
});
const CODEX = seat('codex', 'Codex');
const PI_OUT = seat('pi', 'Pi', { auth: 'signed_out', signed_in: false });

describe('J4 — a reassign offers only helpers that can take work', () => {
  it('a roster bench whose lift time is ahead makes the seat inactive, with its reason and lift time', () => {
    const s = seatStanding(COPILOT_BENCHED, NOW);
    expect(s.state).toBe('inactive');
    expect(s.until).toBe(LIFT);
    expect(s.note).toBe(`out of quota — back by ${liftClock(LIFT)}`);
    // Past its lift time the bench no longer holds (the engine re-probes it).
    expect(seatStanding(COPILOT_BENCHED, Date.parse(LIFT) + 1).state).toBe('ready');
  });

  it("crew's work_eligible: false refuses the seat, in the daemon's words", () => {
    const s = seatStanding(seat('agy', 'Antigravity', { work_eligible: false, work_ineligible_reason: 'no sign-in for container seats' }), NOW);
    expect(s).toEqual({ state: 'ineligible', note: 'no sign-in for container seats' });
  });

  it("the run's own bench withholds a seat until its benched_until, and reads defensively", () => {
    const benched = runBenchesOf({ benched_seats: [{ cli: 'codex', reason: 'quota_exhausted', source: 'worker', benched_until: Date.parse(LIFT) }, { nope: 1 }, null] });
    expect(benched).toEqual([{ cli: 'codex', reason: 'quota_exhausted', benched_until: Date.parse(LIFT) }]);
    const [c] = reassignCandidates(['claude', 'codex'], 'claude', [CODEX], [], benched, NOW);
    expect(c).toMatchObject({ cli: 'codex', state: 'inactive', until: new Date(Date.parse(LIFT)).toISOString() });
    expect(c!.note).toContain('out of quota in this job');
    // A bench with no lift time holds for the run; one whose time passed is the engine's to re-probe.
    expect(reassignCandidates(['codex'], null, [CODEX], [], [{ cli: 'codex', reason: 'repeated_failure' }], NOW)[0]!.state).toBe('inactive');
    expect(reassignCandidates(['codex'], null, [CODEX], [], [{ cli: 'codex', reason: 'q', benched_until: NOW - 1 }], NOW)[0]!.state).toBe('ready');
    expect(runBenchesOf(undefined)).toEqual([]);
  });

  it('the rig card: Copilot benched and Pi signed out are greyed out, Codex is the one reassign', () => {
    const roster = [seat('claude', 'Claude Code'), COPILOT_BENCHED, CODEX, PI_OUT];
    const model = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: EVENTS, pool: ['claude', 'copilot', 'codex', 'pi'], roster, now: NOW })!;
    const keys = [...model.choices, ...model.overflow].map((c) => c.key);
    expect(keys.filter((k) => k.startsWith('reassign:'))).toEqual(['reassign:codex']);
    // Ranked as the picker ranks them: signed out before benched.
    expect(model.withheldSeats?.map((c) => [c.cli, c.state])).toEqual([['pi', 'signed-out'], ['copilot', 'inactive']]);
  });

  it('nothing usable: no reassign at all, and the card says who is back first and when', () => {
    const roster = [seat('claude', 'Claude Code'), COPILOT_BENCHED];
    const model = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: EVENTS, pool: ['claude', 'copilot'], roster, now: NOW })!;
    expect([...model.choices, ...model.overflow].map((c) => c.key)).toEqual(['stop']);
    expect(soonestBack(model.withheldSeats)?.cli).toBe('copilot');
    render(<DeadSeatLine seat={model.deadSeat!} label="Claude Code" canReassign={false} withheld={model.withheldSeats!} navigate={() => {}} />);
    const wait = screen.getByTestId('session-gate-dead-seat-wait');
    expect(wait.textContent).toBe(`No helper in this job can take the step right now. GitHub Copilot CLI is back by ${liftClock(LIFT)}: wait until then and reassign the step to it, or sign another helper in.`);
    expect(screen.getByTestId('session-gate-dead-seat-signin')).toBeTruthy();
  });

  it('withheld seats render disabled with their reason, beside a Sign in link', () => {
    const navigated: string[] = [];
    const cands = reassignCandidates(['copilot', 'pi'], null, [COPILOT_BENCHED, PI_OUT], [], [], NOW);
    render(<WithheldSeats seats={cands} navigate={(p) => navigated.push(p)} />);
    const buttons = screen.getAllByTestId('session-gate-withheld-seat') as HTMLButtonElement[];
    expect(buttons.map((b) => [b.dataset['key'], b.disabled])).toEqual([['pi', true], ['copilot', true]]);
    expect(buttons[1]!.textContent).toBe(`Reassign to GitHub Copilot CLI — out of quota — back by ${liftClock(LIFT)}`);
    expect(buttons[0]!.textContent).toContain('no sign-in observed');
    screen.getByTestId('session-gate-withheld-signin').click();
    expect(navigated).toEqual(['/system']);
  });
});
