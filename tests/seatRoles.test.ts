import { describe, expect, it } from 'vitest';
import type { RosterSeat } from '../src/api/types.js';
import { agentRows } from '../src/board/agentsModel.js';
import { retryBlocker, retryLaunchOf } from '../src/board/repairMoves.js';
import { makeView } from './factories.js';
import { NO_WORKER_PICKED, noCarryingSeatReason, onlyReviewersChosen, seatCanCarry, seatJoinStanding, seatRoles, seatStanding } from '../src/components/gateVerdictModel.js';

/**
 * studio#856 (crew#916, wicked-core#572, api-types 0.129.0): a seat's council ballot and its work are two roles.
 * `council_eligible: false` alone no longer reads as "this seat can do nothing": a work-only seat works, a
 * reviewer-only seat reviews (and joins a job) but never leads, and only a seat with both off is not available.
 * A daemon before 0.129.0 sends no `work_eligible`: there `council_eligible` stands for both, as before.
 */
const NOW = Date.UTC(2026, 10, 22, 9, 0);
const seat = (key: string, extra: Record<string, unknown>): RosterSeat => ({
  key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' },
  auth: 'signed_in', login_check: 'live', signed_in: true, issues: [], ...extra,
}) as RosterSeat;

const WORK_ONLY = seat('pi', { enabled_for_council: false, council_eligible: false, council_ineligible_reason: 'not enabled for council', work_eligible: true });
const REVIEWER_ONLY = seat('cursor', { council_eligible: true, work_eligible: false, work_ineligible_reason: 'seat not eligible for work' });
const NEITHER = seat('agy', { council_eligible: false, council_ineligible_reason: 'not enabled for council', work_eligible: false, work_ineligible_reason: 'no sign-in for container seats' });
const OLD_DAEMON = seat('copilot', { council_eligible: false, council_ineligible_reason: 'not enabled for council' });
const BOTH = seat('claude', { council_eligible: true, work_eligible: true });

describe('seatRoles: the two roles read apart', () => {
  it('reads each role and its reason; an old daemon has council stand for both', () => {
    expect(seatRoles(WORK_ONLY)).toEqual({ council: false, councilWhy: 'not enabled for council', work: true, workWhy: null, reported: true });
    expect(seatRoles(REVIEWER_ONLY)).toEqual({ council: true, councilWhy: null, work: false, workWhy: 'seat not eligible for work', reported: true });
    expect(seatRoles(NEITHER)).toMatchObject({ council: false, work: false, workWhy: 'no sign-in for container seats' });
    expect(seatRoles(OLD_DAEMON)).toEqual({ council: false, councilWhy: 'not enabled for council', work: false, workWhy: 'not enabled for council', reported: false });
    expect(seatRoles(BOTH)).toMatchObject({ council: true, work: true });
  });
});

describe('carrying work: lead, reassign, repair and the send check follow WORK', () => {
  it('a work-only seat can carry work; a reviewer-only seat and one with neither role cannot', () => {
    expect(seatStanding(WORK_ONLY, NOW).state).toBe('ready');
    expect(seatCanCarry(WORK_ONLY)).toBe(true);
    expect(seatStanding(REVIEWER_ONLY, NOW)).toEqual({ state: 'ineligible', note: 'seat not eligible for work' });
    expect(seatCanCarry(REVIEWER_ONLY)).toBe(false);
    expect(seatCanCarry(NEITHER)).toBe(false);
    // Before api-types 0.129.0, unchanged: council off means no work.
    expect(seatStanding(OLD_DAEMON, NOW)).toEqual({ state: 'ineligible', note: 'not enabled for council' });
  });

  it('a work-only seat that is benched or signed out still cannot', () => {
    expect(seatCanCarry({ ...WORK_ONLY, health: { status: 'inactive', since: 'x', message: 'quota' } } as RosterSeat)).toBe(false);
    expect(seatStanding({ ...WORK_ONLY, auth: 'signed_out', signed_in: false } as RosterSeat, NOW).state).toBe('signed-out');
  });

  it('a seat refused work is named as such, not as council-ineligible', () => {
    expect(noCarryingSeatReason(['cursor'], [REVIEWER_ONLY])).toBe('cursor: not given work — seat not eligible for work');
    expect(noCarryingSeatReason(['copilot'], [OLD_DAEMON])).toBe('copilot: not council-eligible — not enabled for council');
    expect(noCarryingSeatReason(['pi'], [WORK_ONLY])).toBeNull();
  });
});

describe('joining a job: a reviewer-only seat joins (it votes and judges)', () => {
  it('reads ready to join; one with neither role, or benched, does not', () => {
    expect(seatJoinStanding(REVIEWER_ONLY, NOW)).toEqual({ state: 'ready', note: 'reviews only' });
    expect(seatJoinStanding(NEITHER, NOW).state).toBe('ineligible');
    expect(seatJoinStanding({ ...REVIEWER_ONLY, health: { status: 'inactive', since: 'x' } } as RosterSeat, NOW).state).toBe('inactive');
    expect(seatJoinStanding(WORK_ONLY, NOW).state).toBe('ready');
  });

  it('a signed-out reviewer-only seat does not join by default; the daemon’s auth wins over the old heuristic (codex r1, r2)', () => {
    expect(seatJoinStanding({ ...REVIEWER_ONLY, auth: 'signed_out', signed_in: false } as RosterSeat, NOW).state).not.toBe('ready');
    // No structured auth: the `signed_in` heuristic decides.
    expect(seatJoinStanding({ ...REVIEWER_ONLY, auth: undefined, signed_in: false } as RosterSeat, NOW).state).not.toBe('ready');
    // Structured auth says signed in, or no sign-in needed: the heuristic's false does not take the reviewer off.
    expect(seatJoinStanding({ ...REVIEWER_ONLY, signed_in: false } as RosterSeat, NOW)).toEqual({ state: 'ready', note: 'reviews only' });
    expect(seatJoinStanding({ ...REVIEWER_ONLY, auth: 'not_required', signed_in: false } as RosterSeat, NOW)).toEqual({ state: 'ready', note: 'reviews only' });
    const failed = makeView({ id: 'r-fail3', status: 'failed', clis: ['claude', 'cursor'], problem: 'p' } as never, []);
    const plan = retryLaunchOf(failed, [BOTH, { ...REVIEWER_ONLY, auth: 'not_required', signed_in: false } as RosterSeat]);
    if (plan.via === 'runs') expect((JSON.parse(plan.body.clisJson ?? '[]') as RosterSeat[]).map((x) => x.key)).toEqual(['claude', 'cursor']);
    else throw new Error('expected a runs relaunch');
  });

  it('a job whose helpers all only review is refused before it is sent (codex r1)', () => {
    expect(onlyReviewersChosen([REVIEWER_ONLY])).toBe(true);
    expect(onlyReviewersChosen([REVIEWER_ONLY, BOTH])).toBe(false);
    expect(onlyReviewersChosen([REVIEWER_ONLY, WORK_ONLY])).toBe(false);
    expect(onlyReviewersChosen([])).toBe(false);
    expect(onlyReviewersChosen([undefined])).toBe(false);
    expect(NO_WORKER_PICKED).toMatch(/only reviews/);
  });

  it('Retry keeps a reviewer-only seat as the reviewer, and still refuses a pool with no one to take a step (codex r1)', () => {
    const failed = makeView({ id: 'r-fail', status: 'failed', clis: ['claude', 'cursor'], problem: 'p' } as never, []);
    const plan = retryLaunchOf(failed, [BOTH, REVIEWER_ONLY]);
    expect(plan.via).toBe('runs');
    if (plan.via === 'runs') expect((JSON.parse(plan.body.clisJson ?? '[]') as RosterSeat[]).map((x) => x.key)).toEqual(['claude', 'cursor']);
    expect(retryBlocker(failed, [BOTH, REVIEWER_ONLY])).toBeNull();
    const reviewersOnly = makeView({ id: 'r-fail2', status: 'failed', clis: ['cursor'], problem: 'p' } as never, []);
    expect(retryBlocker(reviewersOnly, [REVIEWER_ONLY])).toBe('not relaunched: no seat in its pool can take it (cursor: not given work — seat not eligible for work)');
  });
});

describe('the Agents page row (studio#856)', () => {
  const rows = (roster: RosterSeat[]) => agentRows({ roster, defaults: null, now: NOW });

  it('a work-only seat is Ready and takes work; it does not review, with the reason in plain words', () => {
    const [r] = rows([WORK_ONLY]);
    expect(r!.ready.word).toBe('Ready');
    expect(r!.usable).toBe(true);
    expect(r!.repoWork).toBe(true);
    expect(r!.issues.map((i) => i.code)).not.toContain('not_admitted');
    expect(r!.roles.work).toEqual({ word: 'Takes work', tone: 'ok', sub: null });
    expect(r!.roles.reviews).toEqual({ word: 'Doesn’t review right now', tone: 'quiet', sub: 'not enabled for checks' });
  });

  it('a reviewer-only seat reads Reviews only: in use for reviews, never counted for repository work', () => {
    const [r] = rows([REVIEWER_ONLY]);
    expect(r!.ready).toEqual({ word: 'Reviews only', tone: 'gate', sub: 'it reviews work and takes no steps' });
    expect(r!.usable).toBe(true);
    expect(r!.repoWork).toBe(false);
    expect(r!.reviews).toBe(true);
    expect(r!.roles.reviews.word).toBe('Can review work');
    expect(r!.roles.work).toEqual({ word: 'Takes no work', tone: 'quiet', sub: 'helper not eligible for work' });
    expect(r!.issues).toEqual([]);
  });

  it('a seat with neither role is Not available, with the warning that says so', () => {
    const [r] = rows([NEITHER]);
    expect(r!.ready.word).toBe('Not available');
    expect(r!.usable).toBe(false);
    expect(r!.issues.map((i) => i.code)).toContain('not_admitted');
    expect(r!.roles.work).toEqual({ word: 'Takes no work', tone: 'gate', sub: 'no sign-in for container helper' });
  });

  it('a home path in the service’s reason shows as ~ on the inline facts (codex r1)', () => {
    const [r] = rows([{ ...NEITHER, work_ineligible_reason: 'no credential at /home/alice/x', council_ineligible_reason: 'probe failed in C:\\Users\\bob\\cfg' } as RosterSeat]);
    expect(r!.roles.work.sub).toBe('no credential at ~/x');
    expect(r!.roles.reviews.sub).not.toMatch(/bob/);
  });

  it('an old daemon (no work_eligible) reads as before: council off is Not available', () => {
    const [r] = rows([OLD_DAEMON]);
    expect(r!.ready.word).toBe('Not available');
    expect(r!.usable).toBe(false);
    expect(r!.issues.map((i) => i.code)).toContain('not_admitted');
  });
});
