// DES-frontdoor concept A: the Desk's numbers, sentence, lanes, stories, sections, the stat tile and
// the day bars — the pure folds and primitives the Desk renders.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  coarsen, deskStory, durationWords, jobLanes, moneyWords, projectGlances, pulse, stepMarks, stories,
} from '../src/board/deskPulse.js';
import { badgeCount, inSectionOrder, needSection } from '../src/board/needsQueue.js';
import { failureWhy } from '../src/board/failureWhy.js';
import { jobTitle, jobTitleFull } from '../src/board/deskWords.js';
import { spendOf } from '../src/hooks/useWindowSpend.js';
import { previewLines } from '../src/components/desk/DecisionPreview.js';
import { StatTile } from '../src/components/ui/StatTile.js';
import { DayBars, niceTop } from '../src/components/ui/DayBars.js';
import type { NeedRow } from '../src/board/needsYou.js';
import type { SeatRecordResponse } from '../src/api/seatRecord.js';
import { makeUnit, makeView } from './factories.js';

afterEach(cleanup);

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const DAY = 86_400_000;
const sec = (ms: number): number => Math.floor(ms / 1000);

describe('pulse — the Desk band, on the real created_at clock', () => {
  const runs = [
    makeView({ id: 'a', status: 'completed', created_at: sec(NOW - 2 * DAY), ended_at: sec(NOW - 2 * DAY + 10 * 60_000), delivery: 'delivered' } as never),
    makeView({ id: 'b', status: 'failed', created_at: sec(NOW - 3 * DAY) }),
    makeView({ id: 'c', status: 'completed', created_at: sec(NOW - 10 * DAY), ended_at: sec(NOW - 10 * DAY + 30 * 60_000) }),
    makeView({ id: 'd', status: 'executing', created_at: sec(NOW - 1 * DAY) }),
    makeView({ id: 'undated', status: 'completed' }),
    makeView({ id: 'gone', status: 'failed', created_at: sec(NOW - DAY), archived_at: NOW }),
  ];

  it('counts the window and the window before, and leaves undated and archived runs out', () => {
    const p = pulse(runs, 7, NOW);
    expect(p.started).toMatchObject({ count: 3, previous: 1 });
    expect(p.started.series).toHaveLength(7);
    expect(p.failed).toMatchObject({ count: 1, overall: 1 });
    expect(p.delivered).toBe(1);
    expect(p.running).toBe(1);
    expect(p.undated).toBe(1);
    // Only finished jobs with both clocks: 'a' took 10 minutes.
    expect(p.typicalMin).toBe(10);
    expect(p.typicalOf).toBe(1);
  });

  it('says no typical time when nothing in the window finished', () => {
    expect(pulse([makeView({ status: 'failed', created_at: sec(NOW - DAY) })], 7, NOW).typicalMin).toBeNull();
  });

  it('words durations and money plainly', () => {
    expect(durationWords(0.5)).toBe('30 s');
    expect(durationWords(13.2)).toBe('13 min');
    expect(durationWords(9.4)).toBe('9.4 min');
    expect(durationWords(150)).toBe('2.5 h');
    expect(durationWords(60 * 72)).toBe('3.0 days');
    expect(moneyWords(11.236)).toBe('$11.24');
    expect(moneyWords(1234.5)).toBe('$1,235');
  });
});

describe('deskStory — B’s one sentence', () => {
  it('says what started, what waits, what runs, what failed and what waits on review', () => {
    expect(deskStory({
      days: 7, started: 2, waiting: 2, running: 0, now: NOW, reviews: 81,
      failures: [{ projectName: 'My project', at: NOW - 28 * DAY }, { projectName: 'My project', at: NOW - 29 * DAY }],
    })).toBe('2 jobs started in the last 7 days, and 2 are waiting for you. Nothing is running right now. 2 jobs failed in My project, the latest 4 weeks ago, and have not been retried. 81 proposals are waiting for review.');
  });

  it('is calm when nothing happened, and silent about reviews it could not read', () => {
    expect(deskStory({ days: 30, started: 0, waiting: 0, running: 1, now: NOW, reviews: null, failures: [] }))
      .toBe('No jobs started in the last 30 days, and nothing is waiting for you. 1 job is running now.');
    expect(deskStory({ days: 7, started: 1, waiting: 0, running: 1, now: NOW, reviews: 0, failures: [], stuck: 1 }))
      .toBe('1 job started in the last 7 days, and nothing is waiting for you. 1 job is running now. 1 job has stopped moving and needs a look.');
  });
});

describe('the job title (crew derives it; studio never invents one)', () => {
  it('prefers crew’s title and keeps the whole problem for the hover', () => {
    const s = makeView({ problem: 'capture-learnings never lands a proposal when the estate MCP is policy-blocked — surface it', title: 'capture-learnings never lands a proposal' } as never).session;
    expect(jobTitle(s)).toBe('capture-learnings never lands a proposal');
    expect(jobTitleFull(s)).toContain('policy-blocked');
  });

  it('falls back to the first-clause cut on a daemon without the field', () => {
    expect(jobTitle(makeView({ problem: 'Fix the login bug. Then add a test.' }).session)).toBe('Fix the login bug');
    expect(jobTitle(makeView({ problem: 'Onboard repository: notes' }).session)).toBe('Set up notes');
  });
});

describe('jobs: lanes and step tracks', () => {
  it('marks done, failed, waiting and not-reached steps', () => {
    const v = makeView({ status: 'awaiting_human', unit_ix: 2 }, [
      makeUnit({ ord: 0, status: 'done' }), makeUnit({ ord: 1, status: 'done' }), makeUnit({ ord: 2, status: 'distributed' }), makeUnit({ ord: 3, status: 'pending' }),
    ]);
    expect(stepMarks(v)).toEqual(['done', 'done', 'gate', 'todo']);
    expect(stepMarks(makeView({ status: 'failed', unit_ix: 1 }, [makeUnit({ ord: 0, status: 'done' }), makeUnit({ ord: 1, status: 'rejected' })]))).toEqual(['done', 'fail']);
  });

  it('puts what is on now first, then the newest by launch', () => {
    const lanes = jobLanes([
      makeView({ id: 'old', status: 'completed', created_at: sec(NOW - 5 * DAY) }),
      makeView({ id: 'new', status: 'completed', created_at: sec(NOW - DAY) }),
      makeView({ id: 'wait', status: 'awaiting_human', created_at: sec(NOW - 9 * DAY) }),
    ], NOW, { max: 6, projectName: () => null, pathOf: (v) => `/s/run:${v.session.id}` });
    expect(lanes.map((l) => l.runId)).toEqual(['wait', 'new', 'old']);
    expect(lanes[0]!.word).toBe('Waiting on you');
  });
});

describe('what happened', () => {
  it('tells finished, failed and cancelled stories, never a waiting one, and folds a burst', () => {
    const runs = [
      makeView({ id: 'w', status: 'awaiting_human', created_at: sec(NOW - DAY) }),
      makeView({ id: 'f1', problem: 'Learn from wicked-crew', status: 'completed', created_at: sec(NOW - 3 * DAY), ended_at: sec(NOW - 2 * DAY) }),
      makeView({ id: 'f2', problem: 'Learn from wicked-crew', status: 'completed', created_at: sec(NOW - 3 * DAY), ended_at: sec(NOW - 2 * DAY - 1000) }),
      makeView({ id: 'x', problem: 'Fix it', status: 'failed', created_at: sec(NOW - 4 * DAY), ended_at: sec(NOW - 4 * DAY) }),
    ];
    const s = stories(runs, { max: 7, helperName: () => null });
    expect(s.map((x) => [x.title, x.verb, x.count])).toEqual([['Learn from wicked-crew', 'finished', 2], ['Fix it', 'failed', 1]]);
  });
});

describe('projects at a glance', () => {
  it('puts real projects first and the unfiled shelf last, named plainly', () => {
    const g = projectGlances([
      { id: 'default', name: 'Unfiled', runs: [makeView({ id: 'u', status: 'completed' })] },
      { id: 'p', name: 'Payments', runs: [makeView({ project_id: 'p', status: 'failed', created_at: sec(NOW - DAY) })] },
      { id: 'old', name: 'Old', status: 'archived', runs: [] },
    ], NOW);
    expect(g.map((x) => [x.name, x.jobs, x.failed])).toEqual([['Payments', 1, 1], ['Not in a project', 1, 0]]);
  });

  it('coarsens a daily series into weeks', () => {
    expect(coarsen([1, 0, 0, 2, 0, 0, 0, 1, 1], 7)).toEqual([1, 4]);
  });
});

describe('needs sections and THE badge', () => {
  const row = (key: string, kind: NeedRow['kind']): NeedRow => ({ key, kind, severity: 0, stakes: 0, subject: key, text: '', tone: 'gate', at: null, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' } });
  it('orders decisions, failures, other, reviews, and counts decisions + failures only', () => {
    const rows = [row('p', 'proposal'), row('f', 'failed-run'), row('s', 'stranded-run'), row('g', 'gate')];
    expect(inSectionOrder(rows).map((r) => r.key)).toEqual(['g', 'f', 's', 'p']);
    expect(needSection(row('o', 'orphaned-run'))).toBe('failure');
    expect(badgeCount(rows)).toBe(2);
  });
});

describe('failure detail', () => {
  it('names the failed step and its kind; the engine’s words go to Technical details', () => {
    const v = makeView({ id: 'r', status: 'failed', unit_ix: 1 }, [makeUnit({ id: 'r:build', ord: 0, status: 'done' }), makeUnit({ id: 'r:review', ord: 1, status: 'distributed' })]);
    const why = failureWhy(v, [{ type: 'stepFailed', ord: 1, failureKind: 'workerError', detail: 'exit 1 in the worktree' }, { type: 'stepFailed', ord: 1, failureKind: 'workerError', detail: 'again' }]);
    expect(why.plain).toBe('A helper could not start or finish the review step. It failed 2 times.');
    expect(why.detail).toEqual(['exit 1 in the worktree', 'again']);
  });

  it('says a check stopped a rejected step, and is honest when nothing was recorded', () => {
    expect(failureWhy(makeView({ id: 'r', status: 'failed' }, [makeUnit({ id: 'r:recon', ord: 0, status: 'rejected', denial_reason: 'evaluator≠creator' })]), []).plain).toBe('A check stopped the research step.');
    expect(failureWhy(makeView({ status: 'failed', unit_ix: 5 }), []).plain).toBe('No reason was recorded for this failure.');
  });
});

describe('spend from the seat record', () => {
  const res = (seats: Partial<SeatRecordResponse['seats'][number]>[], project?: string): SeatRecordResponse =>
    ({ days: 7, since: 0, until: 0, runsRead: 1, truncated: false, seats: seats as never, ...(project !== undefined ? { project } : {}) }) as SeatRecordResponse;
  it('sums the priced seats; unknown is null, never 0', () => {
    expect(spendOf(res([{ costUsd: 1.234, units: 1 }, { costUsd: null, units: 1 }]))).toEqual({ usd: 1.23, partial: true });
    expect(spendOf(res([{ costUsd: 1.234, units: 1 }]))).toEqual({ usd: 1.23, partial: false });
    expect(spendOf(res([{ costUsd: null, units: 2 }]))).toBeNull();
    expect(spendOf(res([]))).toEqual({ usd: 0, partial: false });
    expect(spendOf(null)).toBeNull();
  });
  it('trusts a project spend only when the daemon echoes the project', () => {
    expect(spendOf(res([{ costUsd: 2, units: 1 }]), 'p')).toBeNull();
    expect(spendOf(res([{ costUsd: 2, units: 1 }], 'p'), 'p')).toEqual({ usd: 2, partial: false });
  });
});

describe('decision preview', () => {
  it('keeps the first lines, markdown markers dropped', () => {
    expect(previewLines('# Answer\n\n- one\n- two\n---\nthree\nfour\nfive')).toEqual({ lines: ['Answer', 'one', 'two', 'three'], more: true });
  });
});

describe('StatTile (UI-CONTRACT §4.6, amended)', () => {
  it('shows unknown as a dash with its reason, never 0', () => {
    render(<StatTile label="Spend" value={null} note="Spend could not be read" />);
    expect(screen.getByTestId('stat-value')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-note')).toHaveTextContent('Spend could not be read');
    expect(screen.getByTestId('stat-tile')).toHaveAttribute('data-known', 'false');
  });

  it('claims a delta only against a real window before, in words', () => {
    const { rerender } = render(<StatTile label="Jobs started" value={7} delta={{ current: 7, previous: 34, versus: 'vs the 7 days before' }} />);
    expect(screen.getByTestId('stat-delta')).toHaveTextContent('down 27 vs the 7 days before');
    rerender(<StatTile label="Jobs started" value={7} delta={{ current: 7, previous: null, versus: 'vs the 7 days before' }} />);
    expect(screen.queryByTestId('stat-delta')).toBeNull();
  });

  it('draws no sparkline for one active day', () => {
    const { container } = render(<StatTile label="Failed" value={1} spark={[0, 0, 1, 0]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('DayBars', () => {
  it('labels a round count axis and the date axis', () => {
    render(<DayBars series={[0, 3, 0, 12]} now={NOW} label="Jobs started per day" />);
    expect(niceTop(12)).toBe(20);
    expect(screen.getByTestId('day-bars')).toHaveTextContent('20');
    expect(screen.getByTestId('day-bars')).toHaveTextContent('Today');
    expect(screen.getByRole('img')).toHaveAccessibleName('Jobs started per day: 15 in all');
  });
});
