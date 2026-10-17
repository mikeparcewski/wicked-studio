import { describe, expect, it } from 'vitest';
import { coachRuleId, coachSeat, phaseWords, recordsByCli, seatWeekLine } from '../src/board/seatCoaching.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';

/** Wave B, idea 9: seats with different records get different moves, exactly one each. */
const byKey = recordsByCli(WEEK);
const moveFor = (key: string) => coachSeat(byKey.get(key), ROSTER.find((s) => s.key === key)!, WEEK);

describe('one coaching move per seat, from its week', () => {
  it('different records earn different moves', () => {
    expect(ROSTER.map((s) => moveFor(s.key).kind)).toEqual(['no-change', 'route-away', 'sign-in', 'route-away', 'no-change']);
  });

  it('routes the phase that stalled away, and says why and what it does before it is taken', () => {
    const m = moveFor('codex');
    expect(m.kind).toBe('route-away');
    if (m.kind !== 'route-away') return;
    expect(m.phase).toBe('review');
    expect(m.label).toBe('Route review away from Codex');
    expect(m.why).toBe('3 stalls this week');
    expect(m.consequence).toBe('Adds a standing instruction helpers read: hand review work to a helper other than Codex. Nothing is blocked.');
    expect(m.rule).toMatchObject({
      id: 'seat-coach:codex:review',
      rule_type: 'policy',
      steering_type: 'operations',
      severity: 'warn',
      statement: 'Route review work away from Codex (codex): 3 stalls in the 7 days to 2026-09-27.',
    });
    expect(m.rule.effect).toBeUndefined();
  });

  it('a seat sent back often is routed on its rework, not its stalls', () => {
    const m = moveFor('opencode');
    expect(m.kind === 'route-away' && m.why).toBe('2 of 4 steps sent back or retried this week');
    expect(m.kind === 'route-away' && m.rule.id).toBe(coachRuleId('opencode', 'build'));
  });

  it('a seat benched for sign-in is offered its own sign-in line', () => {
    const m = moveFor('pi');
    expect(m).toMatchObject({ kind: 'sign-in', label: 'Sign in to Pi', line: 'pi login', why: 'skipped for 2 runs this week: not signed in' });
  });

  it('studio#735: a seat benched this week but signed in now is not offered a sign-in', () => {
    const pi = ROSTER.find((s) => s.key === 'pi')!;
    expect(coachSeat(byKey.get('pi'), { ...pi, auth: 'signed_in' }, WEEK).kind).not.toBe('sign-in');
    const { auth: _auth, ...noAuth } = pi;
    void _auth;
    expect(coachSeat(byKey.get('pi'), { ...noAuth, signed_in: true }, WEEK).kind).not.toBe('sign-in');
    expect(coachSeat(byKey.get('pi'), { ...pi, auth: 'signed_out' }, WEEK).kind).toBe('sign-in');
  });

  it('a benched seat without a sign-in line is not offered one', () => {
    const { login_invocation: _line, ...noLine } = ROSTER[2]!;
    void _line;
    expect(coachSeat(byKey.get('pi'), noLine, WEEK).kind).not.toBe('sign-in');
  });

  it('a clean week and an empty week both say no change, with the reason', () => {
    expect(moveFor('claude')).toMatchObject({ kind: 'no-change', why: '5/5 first pass, 0 stalls, 0 rework', consequence: null });
    expect(moveFor('copilot')).toMatchObject({ kind: 'no-change', why: 'no steps in the last 7 days' });
  });

  it('the week line states cost only where it was recorded', () => {
    expect(seatWeekLine(byKey.get('codex'))).toBe('5 steps · 3/4 first pass · 1 rework · 3 stalls · $0.84');
    expect(seatWeekLine(byKey.get('opencode'))).toContain('cost not recorded');
    expect(seatWeekLine(undefined)).toBe('no steps this week');
  });
});

describe('phaseWords (studio#702)', () => {
  it('a step address reads as its step; a phase name passes through', () => {
    expect(phaseWords('wf-e5d4fa94-1a2b:unit-8:a6')).toBe('step 8');
    expect(phaseWords('review')).toBe('review');
    expect(phaseWords('wf-x:odd')).toBe('one step');
  });
});
