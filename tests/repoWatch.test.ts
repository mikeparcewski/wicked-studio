// crew-0183: the repo watcher's line on Repositories and the repo page — tolerant of the wire, one line per state, and
// never a claim that clusters are current.
import { describe, expect, it } from 'vitest';

import { readRepoWatch, watchLine, type RepoWatchStatus } from '../src/api/repoWatch.js';

const NOW = 1_800_000_000_000;
function status(repo: Partial<RepoWatchStatus['repos'][number]>, over: Partial<RepoWatchStatus> = {}): RepoWatchStatus {
  return {
    enabled: true, disabledBy: null, cap: 24, covers: 'Symbols, files and references for what is on disk now. Clusters refresh when the repository is onboarded again.',
    repos: [{ repoId: 'r1', state: 'current', enabled: true, lastIndexedAt: NOW - 120_000, lastPolledAt: NOW, changedAt: null, waitingOn: [], error: null, remedy: null, ...repo }],
    ...over,
  };
}

describe('watchLine', () => {
  it('says each state in plain words', () => {
    expect(watchLine(status({}), 'r1', NOW)).toMatchObject({ state: 'current', tone: 'ok', words: 'Watching for changes · indexed 2 minutes ago' });
    expect(watchLine(status({ state: 'changed' }), 'r1', NOW)?.words).toBe('Changes seen · re-indexing shortly');
    expect(watchLine(status({ state: 'indexing' }), 'r1', NOW)?.words).toBe('Re-indexing now…');
    expect(watchLine(status({ state: 'waiting-runs', waitingOn: [{ runId: 'a', reason: 'executing' }] }), 'r1', NOW))
      .toMatchObject({ tone: 'wait', words: 'Waiting: 1 job on this repo is using its code map', waitingOn: [{ runId: 'a', reason: 'executing' }] });
    expect(watchLine(status({ state: 'waiting-runs', waitingOn: [{ runId: 'a', reason: 'executing' }, { runId: 'b', reason: 'domain-mapping' }] }), 'r1', NOW)?.words)
      .toBe('Waiting: 2 jobs on this repo are using its code map');
    expect(watchLine(status({ state: 'failed', error: 'the indexer failed (exit status: 3)', remedy: 'Press Re-index now to try again.' }), 'r1', NOW))
      .toMatchObject({ tone: 'bad', words: 'Couldn’t re-index: the indexer failed (exit status: 3)', remedy: 'Press Re-index now to try again.' });
    expect(watchLine(status({ state: 'off', enabled: false }), 'r1', NOW)?.words).toBe('Not kept current (turned off)');
    expect(watchLine(status({ state: 'capped' }), 'r1', NOW)?.words).toBe('Not kept current: 24 repositories is the limit');
    expect(watchLine(status({}, { enabled: false, disabledBy: 'env' }), 'r1', NOW)?.state).toBe('daemon-off');
  });

  it('says nothing on a crew without the watcher, or for a repository it does not watch', () => {
    expect(watchLine(null, 'r1', NOW)).toBeNull();
    expect(watchLine(undefined, 'r1', NOW)).toBeNull();
    expect(watchLine(status({}), 'other', NOW)).toBeNull();
  });

  it('never claims clusters or annotations are current', () => {
    for (const state of ['current', 'starting', 'changed', 'indexing'] as const) {
      expect(watchLine(status({ state }), 'r1', NOW)?.words ?? '').not.toMatch(/cluster|annotat/i);
    }
  });
});

describe('watchLine when the read fails (codex r2)', () => {
  it('says it cannot check when nothing was read, and marks an older read', () => {
    expect(watchLine(undefined, 'r1', NOW, true)?.words).toMatch(/Can’t check right now/);
    expect(watchLine(status({}), 'r1', NOW, true)?.words).toMatch(/couldn’t refresh this just now/);
    expect(watchLine(null, 'r1', NOW, false)).toBeNull();
  });
});

describe('readRepoWatch', () => {
  it('keeps good rows and drops malformed ones', () => {
    const got = readRepoWatch({ enabled: true, cap: 24, covers: 'x', repos: [{ repoId: 'r1', state: 'current' }, { repoId: 2, state: 'current' }, { repoId: 'r3', state: 'weird' }, null] });
    expect(got?.repos.map((r) => r.repoId)).toEqual(['r1']);
    expect(got?.repos[0]).toMatchObject({ enabled: true, lastIndexedAt: null, waitingOn: [], error: null });
    expect(readRepoWatch({ nope: true })).toBeNull();
  });
});

describe('the Repositories sentence and dots under the watcher (coord, crew-0183)', () => {
  it('never says all ready while one could not re-index or waits on a job', async () => {
    const { reposSentence } = await import('../src/board/repoRows.js');
    const five = ['ready', 'ready', 'ready', 'ready', 'ready'] as const;
    expect(reposSentence('known', five, 0)).toBe('Five repositories, all indexed and ready.');
    expect(reposSentence('known', five, 0, 0, { failed: 1, waiting: 1 })).toBe('Five repositories. One couldn’t re-index; one is waiting on a job.');
    expect(reposSentence('known', ['ready', 'stale'], 0, 0, { failed: 1, waiting: 0 })).toBe('Two repositories. One is indexed; one needs re-indexing; one couldn’t re-index.');
  });

  it('the dot is amber for a failed re-index and quiet while waiting, off or capped', async () => {
    const { watchDotTone } = await import('../src/api/repoWatch.js');
    expect(watchDotTone(watchLine(status({ state: 'failed', error: 'x' }), 'r1', NOW))).toBe('warn');
    for (const state of ['waiting-runs', 'off', 'capped'] as const) expect(watchDotTone(watchLine(status({ state }), 'r1', NOW))).toBe('none');
    expect(watchDotTone(watchLine(status({}), 'r1', NOW))).toBeNull();
  });
});
