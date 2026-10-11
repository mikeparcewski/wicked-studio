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
  it('the week line says "skipped", not "benched"', () => {
    expect(seatWeekLine({ units: 2, firstPass: 1, firstPassOf: 2, rework: 0, stalls: 0, benched: 1, costUsd: null } as never)).not.toMatch(/bench/i);
  });
});
