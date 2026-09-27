// Studio Wave A (lane "home") — ideas 3, 5 and 14 from the actionable-studio brainstorm:
//   3  collapse clones: alike never-indexed repo rows fold into ONE row whose batch move ("Index
//      all N repos") states its consequence and launches one onboarding run per repo;
//   5  numbers are repair moves: the Governed tile's dead-letter count carries "Replay" with a dry
//      run first; the Failed tile carries "Retry failed" with the list it would relaunch;
//   14 broken-clock pill: an absent or impossible age is a pill that says so and links to the record.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovernanceClaim, RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';
import { GOVERNANCE_DEADLETTERS } from './fixtures/wave2.js';

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

import { ApiError } from '../src/api/errors.js';
import { ageVerdict, CLOCK_FLOOR_MS } from '../src/board/ageHonesty.js';
import { groupAlike } from '../src/board/needsQueue.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { onboardEstimate, retryLaunchOf, retryableFailed } from '../src/board/repairMoves.js';
import { AgeStamp } from '../src/components/AgeStamp.js';
import { DeckKpiRibbon } from '../src/components/DeckKpiRibbon.js';
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

const CLAIMS = [{ claim_id: 'c1', scope: 'wicked-agent/a', phase: 'build' }] as unknown as GovernanceClaim[];

describe('idea 5 — the dead-letter count carries Replay, dry run first', () => {
  const PREVIEW = {
    outbox: '/o', store: { path: '/s', source: 'flag' }, archive: null, read: 128, replayed: 0,
    alreadyPresent: null, failed: 0, dryRun: true, note: null, blocker: null,
    fold: { ...GOVERNANCE_DEADLETTERS.deadletters, legacyOutbox: undefined },
  };
  const DONE = { ...PREVIEW, dryRun: false, archive: '/o.replayed', replayed: 120, alreadyPresent: 0, failed: 8, fold: undefined };

  it('shows the dry-run preview before replaying, and replays only on confirm', async () => {
    replayGovernanceDeadletters.mockImplementation(async (dry: boolean) => (dry ? PREVIEW : DONE));
    const onRepaired = vi.fn();
    render(<DeckKpiRibbon runs={[makeView({ id: 'a', status: 'completed' })]} claims={CLAIMS}
      governance={GOVERNANCE_DEADLETTERS} needCount={0} navigate={() => {}} now={NOW} onRepaired={onRepaired} />);
    const repair = screen.getByTestId('kpi-repair');
    expect(repair).toHaveAttribute('data-repair', 'replay');
    await userEvent.click(repair);
    const preview = await screen.findByTestId('kpi-repair-preview');
    await waitFor(() => expect(preview).toHaveTextContent('Would replay 128 dead-lettered events'));
    expect(preview).toHaveTextContent('Dry run — nothing has moved yet');
    expect(preview).toHaveTextContent('any that fail stay quarantined');
    // Only the dry run has been asked for.
    expect(replayGovernanceDeadletters.mock.calls).toEqual([[true]]);
    expect(onRepaired).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('kpi-repair-confirm'));
    await waitFor(() => expect(screen.getByTestId('kpi-repair-result')).toHaveTextContent(
      'Replayed 128 events: 120 landed · 8 still quarantined',
    ));
    expect(replayGovernanceDeadletters.mock.calls).toEqual([[true], [false]]);
    expect(onRepaired).toHaveBeenCalledTimes(1);
  });

  it('a blocker disables the replay and says why', async () => {
    replayGovernanceDeadletters.mockResolvedValue({ ...PREVIEW, blocker: 'the installed engine cannot replay a dead-letter outbox — upgrade wicked-core-ts' });
    render(<DeckKpiRibbon runs={[]} claims={CLAIMS} governance={GOVERNANCE_DEADLETTERS} needCount={0} navigate={() => {}} now={NOW} />);
    await userEvent.click(screen.getByTestId('kpi-repair'));
    await waitFor(() => expect(screen.getByTestId('kpi-repair-preview')).toHaveTextContent('Cannot replay here'));
    expect(screen.getByTestId('kpi-repair-confirm')).toBeDisabled();
  });

  it('a daemon without the replay route (404) is named as too old, with the CLI that still works', async () => {
    replayGovernanceDeadletters.mockRejectedValue(new ApiError(404, 'not found'));
    render(<DeckKpiRibbon runs={[]} claims={CLAIMS} governance={GOVERNANCE_DEADLETTERS} needCount={0} navigate={() => {}} now={NOW} />);
    await userEvent.click(screen.getByTestId('kpi-repair'));
    const preview = await screen.findByTestId('kpi-repair-preview');
    await waitFor(() => expect(preview).toHaveTextContent('This daemon predates dead-letter replay'));
    expect(preview).toHaveTextContent('wicked-crew governance replay');
    expect(preview).not.toHaveTextContent('the daemon refused this — not found');
  });

  it('a healthy governance block carries no repair move', () => {
    render(<DeckKpiRibbon runs={[]} claims={CLAIMS} governance={null} needCount={0} navigate={() => {}} now={NOW} />);
    expect(screen.queryByTestId('kpi-repair')).toBeNull();
  });
});

describe('idea 5 — the Failed tile carries Retry failed', () => {
  it('previews the failures not yet retried, then relaunches exactly those', async () => {
    const runs = [
      makeView({ id: 'f1', status: 'failed', problem: 'fix the flaky upload test', repo_ref: 'repo-a', workflow_id: 'bug', clis: ['claude'] }),
      makeView({ id: 'f2', status: 'failed', problem: 'already retried one' }),
      makeView({ id: 'r2', status: 'completed', retry_of: 'f2' }),
    ];
    render(<DeckKpiRibbon runs={runs} claims={null} needCount={0} navigate={() => {}} now={NOW} />);
    const repair = screen.getByTestId('kpi-repair');
    expect(repair).toHaveAttribute('data-repair', 'retry');
    await userEvent.click(repair);
    const preview = screen.getByTestId('kpi-repair-preview');
    expect(preview).toHaveTextContent('Relaunches 1 run with the same brief, workflow, gates and seats (where the roster still has them); none opens a PR on its own');
    expect(preview).toHaveTextContent('1 failure already retried, skipped');
    expect(launchRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('kpi-repair-confirm'));
    await waitFor(() => expect(screen.getByTestId('kpi-repair-result')).toHaveTextContent('Relaunched 1'));
    expect(launchRun).toHaveBeenCalledTimes(1);
    expect(launchRun).toHaveBeenCalledWith(expect.objectContaining({
      problem: 'fix the flaky upload test', retryOf: 'f1', repoRef: 'repo-a', workflow: 'bug', deliver: 'none',
      // Roster SEAT objects, never bare keys (the composer's clisJson spelling).
      clisJson: JSON.stringify([{ key: 'claude', command: 'claude' }]),
    }));
  });

  it('with no roster at hand the seats key is omitted (the daemon default), never bare keys', () => {
    const v = makeView({ id: 'x', status: 'failed', clis: ['claude'] });
    const plan = retryLaunchOf(v, null);
    expect(plan.via).toBe('runs');
    expect(plan.via === 'runs' && plan.body.clisJson).toBeFalsy();
  });

  it('a failed onboarding run retries through its repo onboard route', () => {
    const v = makeView({ id: 'o', status: 'failed', workflow_id: 'onboarding', repo_ref: 'repo-x' });
    expect(retryLaunchOf(v)).toEqual({ via: 'onboard', repoId: 'repo-x' });
    expect(retryableFailed([v], [v])).toHaveLength(1);
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
