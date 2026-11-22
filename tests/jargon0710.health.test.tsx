// studio#724 (0.7.10): Health speaks of helpers and checks — no seats, judge, council or benched.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterSeat } from '../src/api/types.js';
import { SeatRow, seatStandingWord } from '../src/components/HealthRailSection.js';
import { seatWeekLine } from '../src/board/seatCoaching.js';

afterEach(() => cleanup());
const JARGON = /\bseats?\b|\bjudge\b|council|bench/i;
const seat = (over: Record<string, unknown>): RosterSeat => ({ key: 'claude-judge', display_name: 'Claude Code (judge)', binary: 'claude', enabled_for_council: false, health: { status: 'active' }, ...over } as never);

describe('Health in plain words', () => {
  it('a reviewer-only helper reads by its one name, with no "(judge)" and no council words', () => {
    render(<SeatRow seat={seat({ council_eligible: false, council_ineligible_reason: 'not enabled for council' })} />);
    const row = screen.getByTestId('rail-seat-row');
    expect(row.textContent).toContain('Claude Code');
    expect(row.textContent).not.toMatch(JARGON);
    // A reviewer-only helper is told apart from the helper of the same name (UI-CONTRACT §5).
    expect(screen.getByTestId('rail-seat-role')).toHaveTextContent('Reviewer only');
  });
  it('every standing word is plain', () => {
    for (const s of [seat({ council_eligible: false, council_ineligible_reason: 'not enabled for council' }), seat({ signed_in: false, council_eligible: true }), seat({ signed_in: false })]) {
      const w = seatStandingWord(s);
      expect(`${w.detail ?? ''} ${w.title ?? ''}`).not.toMatch(JARGON);
    }
  });
  // studio#1312: the rail reads the two roles apart (`seatRoles`): a work-only helper is usable, so it wears the green
  // check and its sign-in, never the amber "!" of a helper the daemon leaves out.
  it('a work-only helper reads ready on the rail; one with both roles off reads left out', () => {
    const workOnly = seat({ key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, auth: 'signed_in', council_eligible: false, council_ineligible_reason: 'not enabled for council', work_eligible: true });
    expect(seatStandingWord(workOnly).kind).toBe('signed-in');
    render(<SeatRow seat={workOnly} />);
    const row = screen.getByTestId('rail-seat-row');
    expect(row.dataset['standing']).toBe('signed-in');
    expect(row.textContent).toContain('✓');
    expect(screen.queryByTestId('rail-seat-why')).toBeNull();
    const neither = seat({ key: 'pi', display_name: 'Pi', binary: 'pi', enabled_for_council: true, auth: 'signed_in', council_eligible: false, work_eligible: false, work_ineligible_reason: 'over its usage limit' });
    expect(seatStandingWord(neither)).toMatchObject({ kind: 'ineligible', detail: 'not given work or checks — over its usage limit' });
  });
  it('the week line says "skipped", not "benched"', () => {
    expect(seatWeekLine({ units: 2, firstPass: 1, firstPassOf: 2, rework: 0, stalls: 0, benched: 1, costUsd: null } as never)).not.toMatch(/bench/i);
  });
});
