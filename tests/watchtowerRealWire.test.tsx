import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { WatchtowerPage, emptyLine } from '../src/components/watch/WatchtowerPage.js';
import { EMPTY_WATCH, foldRuns, useWatchStore, watchFeed } from '../src/store/watch.js';
import recorded from './fixtures/watch-real-runs-7701.json';

/**
 * The Watchtower over a RECORDED wire (crew 0.9.11, `GET /api/v1/runs` on :7701, 2026-10-12): every
 * completed run there carries `created_at` (or `null`) and NO `ended_at` / `finished_at` — they ended
 * before either field existed. The hand-made fixtures always set `ended_at`, so the fold's
 * `ended_at`-or-drop rule passed every test while the live Finished and Delivered filters stayed empty.
 */

const runs = recorded.runs as unknown as SessionView[];
const NOW = 1_791_800_000_000;
const pick = (kind: string): void => {
  fireEvent.click(screen.getAllByTestId('watchtower-kind').find((b) => b.getAttribute('data-kind') === kind)!);
};

beforeEach(() => { useWatchStore.getState().reset(); });
afterEach(() => { cleanup(); });

describe('the recorded wire', () => {
  it('is the shape that hid the bug: completed runs with no terminal clock', () => {
    const done = runs.filter((v) => v.session.status === 'completed');
    expect(done.length).toBe(3);
    for (const v of done) {
      expect('ended_at' in v.session).toBe(false);
      expect('finished_at' in v.session).toBe(false);
    }
    expect(done.map((v) => v.session.created_at ?? null).filter((t) => t === null).length).toBe(1);
  });

  it('every completed run is Finished, dated by its launch or said to be undated; none is Delivered', () => {
    const f = foldRuns(EMPTY_WATCH, runs);
    const done = runs.filter((v) => v.session.status === 'completed').map((v) => `finished:${v.session.id}`).sort();
    expect(watchFeed(f, { kind: 'done' }).map((r) => r.id).sort()).toStrictEqual(done);
    expect(watchFeed(f, { kind: 'delivery' })).toStrictEqual([]);
    const clocks = watchFeed(f, { kind: 'done' }).map((r) => r.clock);
    expect(clocks.sort()).toStrictEqual(['started', 'started', 'unknown']);
    const dated = watchFeed(f, { kind: 'done' }).find((r) => r.clock === 'started')!;
    const run = runs.find((v) => v.session.id === dated.runId)!;
    expect(dated.at).toBe((run.session.created_at as number) * 1000);
    // The undated one sorts last, never painted at "now".
    expect(watchFeed(f, { kind: 'done' }).at(-1)!.clock).toBe('unknown');
    expect(watchFeed(f, { kind: 'done' }).at(-1)!.at).toBe(0);
  });

  it('a run with its own terminal clock still reads it (ended_at, then finished_at)', () => {
    const base = runs.find((v) => v.session.status === 'completed')!;
    const ended = { ...base, session: { ...base.session, id: 'e', ended_at: 1_791_000_000 } } as SessionView;
    const fin = { ...base, session: { ...base.session, id: 'g', finished_at: 1_791_000_500_000 } } as unknown as SessionView;
    const f = foldRuns(EMPTY_WATCH, [ended, fin]);
    expect(f.rows['finished:e']!.at).toBe(1_791_000_000_000);
    expect(f.rows['finished:e']!.clock).toBeUndefined();
    expect(f.rows['finished:g']!.at).toBe(1_791_000_500_000);
    expect(f.rows['finished:g']!.clock).toBeUndefined();
  });
});

describe('the page over the recorded wire', () => {
  it('Finished lists the finished work and says its finish time was not recorded', () => {
    useWatchStore.getState().runs(runs);
    render(<WatchtowerPage count={0} runs={runs} navigate={() => {}} now={NOW} />);
    pick('done');
    expect(screen.getAllByTestId('watchtower-row').length).toBe(3);
    const clocks = screen.getAllByTestId('watchtower-row-clock').map((c) => c.getAttribute('data-clock'));
    expect(clocks).toStrictEqual(['started', 'started', 'unknown']);
    expect(screen.getAllByTestId('watchtower-row-clock')[0]!.textContent).toMatch(/^Started .+/);
    expect(screen.getAllByTestId('watchtower-row-clock')[2]!.textContent).toBe('Time not recorded');
    // Said once, above the feed, not on every row.
    expect(screen.getByTestId('watchtower-undated').textContent).toBe('No finish time was recorded for 3 sessions. They show when they started, where that is known.');
    // The work names the row; "Done" is not said under "Finished".
    const first = screen.getAllByTestId('watchtower-row')[0]!;
    const work = runs.find((v) => first.getAttribute('data-row-id') === `finished:${v.session.id}`)!.session.problem;
    expect(first.querySelector('.wk-watchtower-sentence [data-testid="watchtower-row-work"]')).toBeTruthy();
    expect(work.startsWith(first.querySelector('.wk-watchtower-sentence')!.textContent!.replace(/…$/u, '').slice(0, 10))).toBe(true);
    expect(first.querySelector('.wk-desk-need-line')!.textContent).toMatch(/^Finished · Started .+/);
    expect(first.querySelector('.wk-desk-need-line')!.textContent).not.toContain('Done');
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
  });

  it('an empty kind says why, from the session list, and offers Show everything', () => {
    useWatchStore.getState().runs(runs);
    render(<WatchtowerPage count={0} runs={runs} navigate={() => {}} now={NOW} />);
    pick('delivery');
    expect(screen.getByTestId('watchtower-empty').textContent).toContain('Nothing delivered yet. None of the 3 finished sessions opened a pull request or pushed a branch.');
    pick('quiet');
    expect(screen.getByTestId('watchtower-empty').textContent).toContain('Nothing has gone quiet. Nothing is running right now.');
    pick('decision');
    expect(screen.getByTestId('watchtower-empty').textContent).toContain('Nothing is waiting on your decision.');
    fireEvent.click(screen.getByTestId('watchtower-show-all'));
    expect(screen.getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByTestId('watchtower-row').length).toBe(3);
  });

  it('a failed session read is a banner, never an empty Finished or Delivered', () => {
    render(<WatchtowerPage count={0} runs={[]} runsLoaded={false} runsError="500 boom" onRetryRuns={() => {}} navigate={() => {}} now={NOW} />);
    expect(screen.getByTestId('watchtower-runs-failed')).toBeTruthy();
    expect(screen.getByTestId('watchtower-runs-failed-retry').textContent).toBe('Retry');
    pick('done');
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
    pick('delivery');
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
  });

  it('a read still in flight says so, not "nothing"', () => {
    render(<WatchtowerPage count={0} runs={[]} runsLoaded={false} navigate={() => {}} now={NOW} />);
    pick('done');
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
    expect(screen.getByTestId('watchtower-checking').textContent).toBe('Reading your sessions…');
  });

  it('a stand-in clock gives way to the run’s own when the wire later carries it (codex r1)', () => {
    const base = runs.find((v) => v.session.status === 'completed' && typeof v.session.created_at === 'number')!;
    const first = foldRuns(EMPTY_WATCH, [base]);
    expect(first.rows[`finished:${base.session.id}`]!.clock).toBe('started');
    const later = { ...base, session: { ...base.session, ended_at: 1_791_000_000 } } as SessionView;
    const next = foldRuns(first, [later]);
    expect(next.rows[`finished:${base.session.id}`]!.at).toBe(1_791_000_000_000);
    expect('clock' in next.rows[`finished:${base.session.id}`]!).toBe(false);
    expect(foldRuns(next, [later])).toBe(next);
  });

  it('Delivered never claims "did not deliver" for a run whose delivery the wire does not state', () => {
    const base = runs.find((v) => v.session.status === 'completed')!;
    const session = { ...(base.session as unknown as Record<string, unknown>) };
    delete session['delivery'];
    const silent = { ...base, session } as unknown as SessionView;
    expect(emptyLine('delivery', [silent], 0)).toBe('Nothing delivered yet. Studio’s service does not say whether the finished sessions were delivered.');
  });

  it('a mixed list says only what it knows about delivery (codex r2)', () => {
    const done = runs.filter((v) => v.session.status === 'completed');
    const session = { ...(done[0]!.session as unknown as Record<string, unknown>) };
    delete session['delivery'];
    const mixed = [{ ...done[0]!, session } as unknown as SessionView, done[1]!];
    expect(emptyLine('delivery', mixed, 0)).toBe('Nothing delivered yet. 1 finished session did not open a pull request or push a branch; 1 more does not say.');
  });

  it('Everything gives no "nothing" verdict while the session list is unread or failed (codex r2)', () => {
    const { unmount } = render(<WatchtowerPage count={0} runs={[]} runsLoaded={false} navigate={() => {}} now={NOW} />);
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
    expect(screen.getByTestId('watchtower-checking')).toBeTruthy();
    unmount();
    render(<WatchtowerPage count={0} runs={[]} runsLoaded={false} runsError="500 boom" navigate={() => {}} now={NOW} />);
    expect(screen.queryByTestId('watchtower-empty')).toBeNull();
    expect(screen.getByTestId('watchtower-runs-failed')).toBeTruthy();
  });

  it('emptyLine words every kind', () => {
    expect(emptyLine('done', [], 0)).toBe('Nothing has finished yet.');
    expect(emptyLine('delivery', [], 0)).toBe('Nothing delivered yet. Nothing has finished.');
    expect(emptyLine('quiet', [], 2)).toBe('Nothing has gone quiet since this page opened.');
    const failed = runs.filter((v) => v.session.status === 'failed' || v.session.status === 'cancelled');
    expect(emptyLine('done', failed, 0)).toBe('Nothing has finished yet. 2 sessions ended without finishing (failed or cancelled).');
  });
});
