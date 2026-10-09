// Studio Wave A (lane "home") — ideas 3, 5 and 14 from the actionable-studio brainstorm:
//   3  collapse clones: alike never-indexed repo rows fold into ONE row whose batch move ("Index
//      all N repos") states its consequence and launches one onboarding run per repo;
//   5  numbers are repair moves: the Governed tile's dead-letter count carries "Replay" with a dry
//      run first; the Failed tile carries "Retry failed" with the list it would relaunch;
//   14 broken-clock pill: an absent or impossible age is a pill that says so and links to the record.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';

const { rerunOnboarding, launchRun, getRoster } = vi.hoisted(() => ({
  rerunOnboarding: vi.fn(async (id: string) => ({ runId: `onboard-${id}` })),
  launchRun: vi.fn(async () => ({ runId: 'r-new' })),
  getRoster: vi.fn(async () => ({ roster: [{ key: 'claude', command: 'claude' }, { key: 'codex', command: 'codex' }] })),
}));
vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, rerunOnboarding, launchRun, getRoster } };
});

const { replayGovernanceDeadletters } = vi.hoisted(() => ({ replayGovernanceDeadletters: vi.fn() }));
vi.mock('../src/api/governanceReplay.js', () => ({ replayGovernanceDeadletters }));

import { ageVerdict, CLOCK_FLOOR_MS } from '../src/board/ageHonesty.js';
import { groupAlike } from '../src/board/needsQueue.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { onboardEstimate } from '../src/board/repairMoves.js';
import { AgeStamp } from '../src/components/AgeStamp.js';
import { NeedsQueueSurface } from '../src/components/NeedsYouQueue.js';

const NOW = Date.UTC(2026, 8, 27, 12);
const HOUR = 3_600_000;

afterEach(cleanup);
beforeEach(() => {
  rerunOnboarding.mockClear();
  launchRun.mockClear();
  replayGovernanceDeadletters.mockReset();
});

const repo = (i: number): RepoEntry => ({
  id: `repo-${i}`, name: `wicked-${i}`, root_path: `/repos/${i}`, default_branch: 'main',
  // The wire's registered_at is epoch SECONDS.
  registered_at: Math.floor((NOW - (i + 1) * HOUR) / 1000),
} as RepoEntry);

function inputs(over: Partial<NeedsYouInputs>): NeedsYouInputs {
  return { runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, ...over };
}

const NINE = Array.from({ length: 9 }, (_, i) => repo(i));

describe('idea 3 — collapse clones: never-indexed repos fold into one batch row', () => {
  it('9 never-indexed repos render as ONE row carrying "Index all 9 repos" and its consequence', () => {
    const rows = groupAlike(needsYouRows(inputs({ repos: NINE })), NOW);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.members).toHaveLength(9);
    // Members rank longest-waiting first; the batch covers every one of them.
    expect(row.action).toMatchObject({ kind: 'batch-onboard', label: 'Index all 9 repos ›' });
    expect([...(row.action as { repoIds: string[] }).repoIds].sort()).toEqual(NINE.map((r) => r.id).sort());
    expect(row.text).toBe(
      'Launches 9 onboarding runs · time unknown (none has finished here yet)',
    );
  });

  it('the consequence times itself from the run history when onboards have finished here', () => {
    const done = (id: string, repoRef: string, mins: number) => makeView({
      id, status: 'completed', workflow_id: 'onboarding', repo_ref: repoRef,
      created_at: 1_000, ended_at: 1_000 + mins * 60,
    });
    const history = [done('o1', 'other-a', 9), done('o2', 'other-b', 11), done('o3', 'other-c', 14)];
    expect(onboardEstimate(history)).toEqual({ medianMs: 11 * 60_000, samples: 3 });
    const rows = groupAlike(needsYouRows(inputs({ repos: [repo(0), repo(1)], runs: history })), NOW);
    expect(rows[0]!.text).toContain('~11 min each (median of 3 past onboards)');
  });

  it('one never-indexed repo stays a plain row (a group of one is not a group)', () => {
    const rows = groupAlike(needsYouRows(inputs({ repos: [repo(0)] })), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.members).toBeUndefined();
    expect(rows[0]!.action.kind).toBe('open');
  });

  it('clicking the batch move calls the onboard launch route once per repo — 9 times', async () => {
    const rows = needsYouRows(inputs({ repos: NINE }));
    render(<NeedsQueueSurface rows={rows} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getAllByTestId('need-row')).toHaveLength(1);
    const act = screen.getByTestId('need-batch-act');
    expect(act).toHaveTextContent('Index all 9 repos ›');
    expect(screen.getByTestId('need-line')).toHaveTextContent('Launches 9 onboarding runs');
    await userEvent.click(act);
    await waitFor(() => expect(screen.getByTestId('need-batch-act')).toHaveAttribute('data-batch-phase', 'done'));
    expect(rerunOnboarding).toHaveBeenCalledTimes(9);
    expect(rerunOnboarding.mock.calls.map((c) => c[0]).sort()).toEqual(NINE.map((r) => r.id).sort());
    expect(screen.getByTestId('need-batch-act')).toHaveTextContent('Launched 9');
  });
});

describe('idea 14 — the broken-clock pill', () => {
  it('classifies unknown, before-install (seconds read as ms) and future clocks', () => {
    expect(ageVerdict(null, NOW)).toEqual({ kind: 'unknown' });
    expect(ageVerdict(1_789_332_190, NOW)).toMatchObject({ kind: 'impossible', why: 'before-install' });
    expect(ageVerdict(CLOCK_FLOOR_MS - 1, NOW).kind).toBe('impossible');
    expect(ageVerdict(NOW + 2 * HOUR, NOW)).toMatchObject({ kind: 'impossible', why: 'future' });
    expect(ageVerdict(NOW - HOUR, NOW)).toEqual({ kind: 'ok', at: NOW - HOUR });
  });

  it('an impossible age renders a pill that says so and links to the record — never "20702d"', async () => {
    const open = vi.fn();
    render(<AgeStamp at={1_789_332_190} now={NOW} href="/repo-detail/r1" onOpen={open} testId="age" />);
    const pill = screen.getByTestId('age');
    expect(pill.tagName).toBe('A');
    expect(pill).toHaveAttribute('href', '/repo-detail/r1');
    expect(pill).toHaveAttribute('data-age-pill', 'impossible');
    expect(pill).toHaveTextContent('impossible age ›');
    expect(pill.textContent).not.toMatch(/\d+d/);
    await userEvent.click(pill);
    expect(open).toHaveBeenCalledWith('/repo-detail/r1');
  });

  it('a plausible age renders as the plain word', () => {
    render(<AgeStamp at={NOW - 5 * 60_000} now={NOW} testId="age" />);
    expect(screen.getByTestId('age')).toHaveTextContent('5m');
    expect(screen.getByTestId('age')).not.toHaveAttribute('data-age-pill');
  });

  it('a failed run with no ended_at ages by its engine terminal clock (finished_at, millis), not "age unknown"', () => {
    const finished = NOW - 2 * HOUR;
    const v = makeView({ id: 'f1', status: 'failed', finished_at: finished });
    const rows = needsYouRows(inputs({ runs: [v] }));
    const row = rows.find((r) => r.kind === 'failed-run');
    expect(row?.at).toBe(finished);
  });

  it('a Needs You row with a broken clock shows the pill linking to its record; a group ignores it for its age', () => {
    const broken = { ...repo(0), registered_at: 1 } as RepoEntry; // 1 s after the epoch → 1970
    const rows = needsYouRows(inputs({ repos: [broken] }));
    render(<NeedsQueueSurface rows={rows} runs={[]} navigate={() => {}} now={NOW} />);
    const age = screen.getByTestId('need-age');
    expect(age).toHaveAttribute('data-age-pill', 'impossible');
    expect(age).toHaveAttribute('href', `/repo-detail/${broken.id}`);
    cleanup();
    const grouped = groupAlike(needsYouRows(inputs({ repos: [broken, repo(1)] })), NOW);
    expect(grouped[0]!.at).toBe(Math.floor((NOW - 2 * HOUR) / 1000) * 1000);
  });
});
