// F-7R2-018 + F-7R2-007 (the pure half): which verdict a gate card may show, and which seats a
// failure escalation may move the unit to.
//
// The phase7-r2 rig: at "Unit 3 failed and triage escalated: triage judge errored…" the card
// (before unit #3) rendered unit 2's vacuous pass — `gateVerdict` takes the last evaluation at
// or below the gate's ord, and a worker failure leaves none for unit 3. An escalation gate is
// ABOUT unit N: only N's own evaluation may stand under it; a pre-run gate keeps the previous
// phase's verdict (that IS what the operator approves, F-3R2-006).
import { describe, expect, it } from 'vitest';
import type { CoreEvent, RosterSeat } from '../src/api/types.js';
import {
  attemptBefore, escalationUnit, gateVerdictFor, isFailureEscalation, reassignCandidates, seatStanding,
} from '../src/components/gateVerdictModel.js';
import { G4_EVENTS, G4_GATE, G5_EVENTS, G5_GATE, GATE_RUN } from './fixtures/gateEvidence.js';

const RUN = 'run-7r2';
const TRIAGE_PROMPT = 'Unit 3 failed and triage escalated: triage judge errored: triage judge failed (Failed):';

/** Unit 2's vacuous pass, then unit 3's worker failure escalates — NO gateEvaluated for 3. */
const ESCALATION_EVENTS: CoreEvent[] = [
  { type: 'gateEvaluated', session: RUN, ord: 2, criterion: null, hasDeterministicFloor: false, deterministicPass: true,
    agentVerdict: null, agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [], denialReason: null, denial: null, combined: true },
  { type: 'gateDecided', session: RUN, ord: 2, allow: true },
  { type: 'unitDone', session: RUN, ord: 2 },
  { type: 'unitDispatched', session: RUN, ord: 3, cli: 'codex', attempt: 0 },
  { type: 'stepFailed', session: RUN, ord: 3, detail: 'codex exited 1' },
  { type: 'failureTriaged', session: RUN, ord: 3, decision: 'escalate', analysis: 'triage judge errored' },
  { type: 'awaitingHuman', session: RUN, ord: 3, prompt: TRIAGE_PROMPT, reviewingOrd: null },
] as unknown as CoreEvent[];

describe('escalationUnit — the engine\'s escalation prompts', () => {
  it('reads the unit off both escalation spellings and nothing off a pre-run gate', () => {
    expect(escalationUnit(TRIAGE_PROMPT)).toBe(3);
    expect(escalationUnit(G5_GATE.prompt)).toBe(4);
    expect(escalationUnit(G4_GATE.prompt)).toBeNull();
    expect(escalationUnit(undefined)).toBeNull();
    expect(escalationUnit('Prompt unavailable (daemon restarted)')).toBeNull();
  });
});

describe('gateVerdictFor — the block is about THIS gate\'s unit (F-7R2-018)', () => {
  it('an escalation gate about unit 3 with no evaluation for 3 renders NO block — never unit 2\'s pass', () => {
    expect(gateVerdictFor(ESCALATION_EVENTS, 3, TRIAGE_PROMPT)).toBeNull();
  });

  it('a pre-run gate keeps the previous phase\'s verdict; an escalation with its own denial keeps that', () => {
    expect(gateVerdictFor(G4_EVENTS, G4_GATE.ord, G4_GATE.prompt)?.ord).toBe(3);
    expect(gateVerdictFor(G5_EVENTS, G5_GATE.ord, G5_GATE.prompt)?.ord).toBe(4);
    expect(gateVerdictFor(G5_EVENTS, G5_GATE.ord, G5_GATE.prompt)?.outcome).toBe('fail');
    expect(gateVerdictFor(G4_EVENTS, undefined, G4_GATE.prompt)).toBeNull();
  });

  it('a retry that later evaluates unit 3 itself shows THAT verdict', () => {
    const later: CoreEvent[] = [
      ...ESCALATION_EVENTS,
      { type: 'gateEvaluated', session: RUN, ord: 3, criterion: 'x', hasDeterministicFloor: true, deterministicPass: false,
        agentVerdict: null, agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [],
        denialReason: 'Worker FAILED on unit 3: exit 1', denial: { source: 'worker_failure', reason: 'Worker FAILED on unit 3: exit 1' }, combined: false },
    ] as unknown as CoreEvent[];
    const view = gateVerdictFor(later, 3, TRIAGE_PROMPT);
    expect(view?.ord).toBe(3);
    expect(view?.attempt).toBe(0);
    expect(view?.denial?.source).toBe('worker_failure');
  });

  it('keyed on ord AND attempt: attempt 0\'s denial is not the verdict of the attempt-1 escalation', () => {
    const DENY_0 = {
      type: 'gateEvaluated', session: RUN, ord: 3, criterion: 'x', hasDeterministicFloor: true, deterministicPass: false,
      agentVerdict: null, agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [],
      denialReason: 'repository checks failed: lint exited 1', denial: { source: 'repo_checks', reason: 'repository checks failed: lint exited 1' }, combined: false,
    };
    const twoAttempts: CoreEvent[] = [
      { type: 'unitDispatched', session: RUN, ord: 3, cli: 'codex', attempt: 0 },
      DENY_0,
      { type: 'gateDecided', session: RUN, ord: 3, allow: true },
      { type: 'unitDispatched', session: RUN, ord: 3, cli: 'codex', attempt: 1 },
      { type: 'stepFailed', session: RUN, ord: 3, detail: 'codex exited 137' },
      { type: 'awaitingHuman', session: RUN, ord: 3, prompt: TRIAGE_PROMPT, reviewingOrd: null },
    ] as unknown as CoreEvent[];
    expect(attemptBefore(twoAttempts, 3)).toBe(1);
    expect(attemptBefore(twoAttempts, 3, 2)).toBe(0);
    expect(attemptBefore(twoAttempts, 9)).toBeNull();
    // The unbounded model still reports attempt 0's verdict, stamped with its attempt…
    expect(gateVerdictFor(twoAttempts, 3, 'Approve unit 3 before it runs: build')?.attempt).toBe(0);
    // …but the escalation card about attempt 1 renders none of it.
    expect(gateVerdictFor(twoAttempts, 3, TRIAGE_PROMPT)).toBeNull();
    // Attempt 1's own later evaluation is this gate's.
    const withOwn: CoreEvent[] = [...twoAttempts, { ...DENY_0, denialReason: 'Worker FAILED on unit 3: exit 137' } as unknown as CoreEvent];
    expect(gateVerdictFor(withOwn, 3, TRIAGE_PROMPT)?.attempt).toBe(1);
  });
});

describe('isFailureEscalation — the gate whose plain Approve retries the dead seat (F-7R2-007)', () => {
  it('reads the triage prompt, the worker_failure layer, and the triage/Worker FAILED prose; not a pre-run or guard gate', () => {
    expect(isFailureEscalation(TRIAGE_PROMPT, null)).toBe(true);
    expect(isFailureEscalation(G4_GATE.prompt, gateVerdictFor(G4_EVENTS, 4, G4_GATE.prompt))).toBe(false);
    // The worktree-guard denial is a verdict escalation, not a dead seat — Reassign is not the remedy.
    expect(isFailureEscalation(G5_GATE.prompt, gateVerdictFor(G5_EVENTS, 4, G5_GATE.prompt))).toBe(false);
    const workerFailed: CoreEvent[] = [
      { type: 'gateEvaluated', session: GATE_RUN, ord: 4, hasDeterministicFloor: false, deterministicPass: true, agentVerdict: null,
        evaluatorPass: true, evaluatorPolicies: [], denialReason: 'Worker FAILED on unit 4 (codex): exit 137', denial: null, combined: false },
    ] as unknown as CoreEvent[];
    expect(isFailureEscalation('Prompt unavailable', gateVerdictFor(workerFailed, 4, undefined))).toBe(true);
    const triageProse: CoreEvent[] = [
      { type: 'gateEvaluated', session: GATE_RUN, ord: 4, combined: false, denialReason: 'triage escalation: judge errored' },
    ] as unknown as CoreEvent[];
    expect(isFailureEscalation(undefined, gateVerdictFor(triageProse, 4, undefined))).toBe(true);
  });
});

describe('reassignCandidates — the run\'s other seats, in the roster\'s order', () => {
  const ROSTER: RosterSeat[] = [
    { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true },
    { key: 'pi', display_name: 'pi', binary: 'pi', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false },
    { key: 'opencode', display_name: 'OpenCode', binary: 'opencode', enabled_for_council: true, health: { status: 'inactive', message: 'quota', since: 'x' }, signed_in: false },
    { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false },
  ];

  it('excludes the failed seat, puts signed-in first, hedges a seat with no sign-in observed, inactive last', () => {
    const out = reassignCandidates(['codex', 'pi', 'opencode', 'agy', 'claude'], 'codex', ROSTER);
    expect(out.map((c) => c.cli)).toEqual(['claude', 'agy', 'pi', 'opencode']);
    expect(out[0]).toMatchObject({ label: 'Claude Code', state: 'ready', note: '' });
    expect(out[1]).toMatchObject({ label: 'agy', state: 'unknown', note: '' });
    // Today's roster carries no council-eligibility field, so the consequence is hedged.
    expect(out[2]).toMatchObject({ label: 'pi', state: 'signed-out', note: 'no sign-in observed — may fail or be benched' });
    expect(out[2]!.note).not.toMatch(/will be benched/);
    expect(out[3]).toMatchObject({ label: 'OpenCode', state: 'inactive', note: 'inactive: quota' });
  });

  it('reads crew#533\'s auth / council_eligible (api-types 0.35.0) when a daemon sends them — believed, not inferred', () => {
    const seat = (extra: Record<string, unknown>): RosterSeat =>
      ({ key: 'x', display_name: 'X', binary: 'x', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false, ...extra });
    expect(seatStanding(seat({ auth: 'not_required', free_tier: 'OpenCode Zen' }))).toEqual({ state: 'ready', note: 'no sign-in needed (OpenCode Zen)' });
    expect(seatStanding(seat({ auth: 'signed_out', council_eligible: false, council_ineligible_reason: 'signed out' })))
      .toEqual({ state: 'ineligible', note: 'signed out' });
    expect(seatStanding(seat({ auth: 'signed_out', council_eligible: true })))
      .toEqual({ state: 'signed-out', note: 'no sign-in observed — still council-eligible' });
    expect(seatStanding(seat({ auth: 'signed_in' }))).toEqual({ state: 'ready', note: '' });
    expect(seatStanding(seat({ auth: 'unknown', signed_in: null }))).toEqual({ state: 'unknown', note: '' });
    // Inactive health outranks every auth reading.
    expect(seatStanding(seat({ auth: 'signed_in', health: { status: 'inactive', message: 'quota', since: 'x' } }))).toEqual({ state: 'inactive', note: 'inactive: quota' });
    expect(seatStanding(undefined)).toEqual({ state: 'unknown', note: '' });
    // Ordering: an ineligible seat sorts last.
    const out = reassignCandidates(['a', 'b'], null, [
      seat({ key: 'a', display_name: 'A', council_eligible: false, council_ineligible_reason: 'signed out' }),
      seat({ key: 'b', display_name: 'B', signed_in: true }),
    ]);
    expect(out.map((c) => c.cli)).toEqual(['b', 'a']);
  });

  it('a cold roster offers the pool by key, unlabelled — never an invented state', () => {
    const out = reassignCandidates(['codex', 'claude', 'claude'], 'codex', null);
    expect(out).toEqual([{ cli: 'claude', label: 'claude', state: 'unknown', note: '' }]);
    expect(reassignCandidates(['codex'], 'codex', ROSTER)).toEqual([]);
  });
});
