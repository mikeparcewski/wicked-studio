import { describe, expect, it } from 'vitest';
import fixture from './fixtures/desk-attention-7701.json';
import type { SessionView } from '../src/api/types.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import {
  attentionBadge, failureCounts, openFailedIds, startedSecs, waitingCount, waitsOnYou, withStartClocks,
} from '../src/board/attention.js';
import { deskStory, jobLanes, projectGlances, pulse, stepMarks } from '../src/board/deskPulse.js';
import { statusWord } from '../src/board/statusWords.js';

import { failedNote } from '../src/components/desk/Desk.js';

/**
 * THE ATTENTION MODEL on the shapes of a real daemon (crew 0.10.1), ids and text scrubbed: 53 runs —
 * 2 answered asks parked `awaiting_human` at their turn gate (`ask_turn: true`), 3 failed jobs (one
 * answered by a retry that was later cancelled), 12 runs the wire left without `created_at`. The
 * Desk shipped "Waiting on you 0" beside two "Waiting on you" job rows, "Failed 3" beside "2 jobs
 * failed" and "2 failures", and "12 jobs have no start time". Every surface now agrees.
 */
const runs = fixture.runs as unknown as SessionView[];
const NOW = fixture.snapshotAt;
const base = {
  gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW,
  deliveryAttempted: new Set<string>(), deliveredNow: new Set<string>(),
} as unknown as Omit<NeedsYouInputs, 'runs'>;
const rows = needsYouRows({ ...base, runs });
const parked = runs.filter((v) => v.session.status === 'awaiting_human');

describe('waiting on you — one definition', () => {
  it('the two parked runs are answered asks: no decision, no badge, no "Waiting on you" anywhere', () => {
    expect(parked).toHaveLength(2);
    for (const v of parked) {
      expect(waitsOnYou(v.session)).toBe(false);
      expect(statusWord(v)).toEqual({ word: 'Answered', tone: 'ok' });
      expect(stepMarks(v)).not.toContain('gate');
    }
    expect(waitingCount(rows)).toBe(0);
    const lanes = jobLanes(runs, NOW, { max: 6, projectName: () => null, pathOf: (v) => v.session.id });
    expect(lanes.filter((l) => l.word === 'Waiting on you')).toEqual([]);
  });

  it('a real gate (no ask_turn) still waits on you and counts', () => {
    // A real gate: the same run without crew's turn-gate word (`ask_turn` is `true` or absent on the wire).
    const session = { ...parked[0]!.session } as Record<string, unknown>;
    delete session.ask_turn;
    const gate = { ...parked[0]!, session } as unknown as SessionView;
    expect(waitsOnYou(gate.session)).toBe(true);
    expect(statusWord(gate).word).toBe('Waiting on you');
    const r = needsYouRows({ ...base, runs: [gate, ...runs.filter((v) => v !== parked[0])] });
    expect(waitingCount(r)).toBe(1);
    expect(attentionBadge(r)).toBe(attentionBadge(rows) + 1);
  });
});

describe('failed — one count, the window said', () => {
  it('the open failures are the two not retried; the tile, sentence and badge use them', () => {
    expect(runs.filter((v) => v.session.status === 'failed')).toHaveLength(3);
    expect(openFailedIds(rows).size).toBe(2);
    const f = failureCounts(runs, rows, 30, NOW);
    expect(f.inWindow).toHaveLength(2);
    expect(f.older).toBe(0);
    expect(f.retried).toBe(1);
    expect(failedNote(f, 30)).toBe('not retried, in the last 30 days · 1 more retried');
    expect(attentionBadge(rows)).toBe(waitingCount(rows) + 2);
    expect(deskStory({
      days: 30, started: 0, waiting: waitingCount(rows), running: 0, reviews: null, now: NOW,
      failures: f.inWindow.map(() => ({ projectName: 'My project', at: NOW - 28 * 86_400_000 })), olderFailures: f.older,
    })).toContain('2 jobs failed in the last 30 days in My project, the latest 4 weeks ago, and have not been retried.');
  });

  it('a failure whose retry is archived is still retried (the needs fold’s rule), said in the note', () => {
    const archived = runs.map((v) => (v.session.retry_of != null ? { ...v, session: { ...v.session, archived_at: NOW } } : v)) as SessionView[];
    const r = needsYouRows({ ...base, runs: archived });
    const f = failureCounts(archived, r, 30, NOW);
    expect(f.inWindow).toHaveLength(2);
    expect(f.retried).toBe(1);
  });

  it('the project row counts the same open failures', () => {
    const mine = runs.filter((v) => v.session.project_id === 'proj_a');
    const [g] = projectGlances([{ id: 'proj_a', name: 'My project', runs: mine }], NOW, 60, openFailedIds(rows));
    expect(g).toMatchObject({ jobs: 5, failed: 2, waiting: 0 });
  });

  it('a 7-day window counts none, and says the older open ones', () => {
    const f = failureCounts(runs, rows, 7, NOW);
    expect(f.inWindow).toHaveLength(0);
    expect(f.older).toBe(2);
    expect(failedNote(f, 7)).toBe('none open in the last 7 days · 2 older not retried');
    expect(deskStory({ days: 7, started: 0, waiting: 0, running: 0, reviews: null, now: NOW, failures: [], olderFailures: 2 }))
      .toContain('2 jobs that failed before the last 7 days have not been retried.');
  });
});

describe('start time — the event log dates what the run row leaves out', () => {
  it('every undated run has a sessionStarted ts; filled, none is left out', () => {
    const undated = runs.filter((v) => typeof v.session.created_at !== 'number');
    expect(undated).toHaveLength(12);
    const starts = new Map<string, number | null>(
      Object.entries(fixture.sessionStarted).map(([id, ev]) => [id, startedSecs(ev)]),
    );
    expect([...starts.values()].every((s) => typeof s === 'number')).toBe(true);
    expect(pulse(runs, 30, NOW).undated).toBe(12);
    const dated = withStartClocks(runs, starts);
    expect(pulse(dated, 30, NOW).undated).toBe(0);
    // Seconds on the wire, millis in the event: the fill is in seconds.
    const first = dated.find((v) => v.session.id === undated[0]!.session.id)!;
    expect(first.session.created_at).toBe(Math.floor(fixture.sessionStarted[undated[0]!.session.id as keyof typeof fixture.sessionStarted][0]!.ts / 1000));
  });

  it('no sessionStarted means no start time, never a stand-in clock', () => {
    expect(startedSecs([{ type: 'unitPlanned', ts: 5 }])).toBeNull();
    expect(withStartClocks(runs, new Map()).filter((v) => typeof v.session.created_at !== 'number')).toHaveLength(12);
  });
});
