import { describe, expect, it } from 'vitest';
import type { RepoEntry } from '../src/api/types.js';
import { languageWords, lastActivity, readinessWords, repoReadiness, repoSide, repoTone, reposSentence, STALE_INDEX_DAYS } from '../src/board/repoRows.js';
import type { RepoFleetModel } from '../src/board/repoStats.js';
import { makeView } from './factories.js';

const NOW = Date.UTC(2026, 9, 26, 15);
const DAY = 86_400_000;
const repo: RepoEntry = { id: 'core', name: 'wicked-core', root_path: '/w/core', default_branch: 'main', registered_at: (NOW - 20 * DAY) / 1000 };
const onboard = (state: RepoFleetModel['onboard']['state'], endedDaysAgo: number | null = 1) => ({
  state,
  run: state === 'never' ? null : makeView({ id: 'o', repo_ref: 'core', workflow_id: 'onboarding', status: 'completed', ...(endedDaysAgo !== null ? { ended_at: (NOW - endedDaysAgo * DAY) / 1000 } : {}) }),
});
const model = (o: Partial<RepoFleetModel> = {}): RepoFleetModel => ({
  repo, windowed: [], counts: { total: 0, done: 0, failed: 0, terminal: 0 } as RepoFleetModel['counts'], waiting: [], activeNow: false, failing: false,
  onboard: onboard('ready'), graphGap: null, capture: { state: 'never', run: null }, lastAt: null, ...o,
});

describe('repoReadiness', () => {
  it('is indexed while the code map is fresh, stale once it is older than the threshold', () => {
    expect(repoReadiness(model(), NOW)).toBe('ready');
    expect(repoReadiness(model({ onboard: onboard('ready', STALE_INDEX_DAYS + 2) }), NOW)).toBe('stale');
    expect(readinessWords('stale', model({ onboard: onboard('ready', STALE_INDEX_DAYS + 2) }), NOW)).toBe(`index is ${STALE_INDEX_DAYS + 2} days old`);
    // No clock on record: never a made-up age.
    expect(repoReadiness(model({ onboard: onboard('ready', null) }), NOW)).toBe('ready');
  });
  it('lets the engine’s findings outrank the run history, except while indexing', () => {
    const gap = { kind: 'no-live-graph' as const, finding: {} as never };
    expect(repoReadiness(model({ graphGap: gap }), NOW)).toBe('missing');
    expect(repoReadiness(model({ graphGap: gap, onboard: onboard('onboarding') }), NOW)).toBe('onboarding');
    expect(readinessWords('missing', model({ graphGap: { ...gap, kind: 'no-graph-root' } }), NOW)).toBe('no place to keep a code map');
  });
});

describe('repoSide', () => {
  it('says the most urgent thing first: waiting on you, then the index to redo, then never indexed, then activity', () => {
    const gate = makeView({ id: 'g', repo_ref: 'core', status: 'awaiting_human' });
    expect(repoSide(model({ waiting: [gate] }), 'stale', null, NOW)).toEqual({ kind: 'needs', label: 'Waiting on you', runId: 'g', tone: 'gate' });
    expect(repoSide(model({ waiting: [gate, gate] }), 'ready', null, NOW).label).toBe('2 waiting on you');
    for (const r of ['stale', 'failed', 'missing'] as const) expect(repoSide(model(), r, null, NOW)).toMatchObject({ kind: 'reindex', label: 'Re-index' });
    expect(repoSide(model({ onboard: onboard('never') }), 'never', null, NOW)).toMatchObject({ kind: 'index', label: 'Index' });
    expect(repoSide(model({ activeNow: true }), 'ready', NOW - 60_000, NOW).label).toBe('Working now');
    expect(repoSide(model(), 'ready', NOW - 60_000, NOW).label).toBe('Active today');
    expect(repoSide(model(), 'ready', NOW - 3 * DAY, NOW).label).toBe('Active 3 days ago');
    expect(repoSide(model(), 'ready', null, NOW).label).toMatch(/^Added /);
  });
  it('wears a dot that matches: green ready, amber to redo, red failed', () => {
    expect(repoTone(model(), 'ready')).toBe('ready');
    expect(repoTone(model(), 'stale')).toBe('warn');
    expect(repoTone(model(), 'failed')).toBe('fail');
  });
});

describe('lastActivity', () => {
  it('is the newest start or end of any job on the repo', () => {
    const runs = [
      makeView({ id: 'a', repo_ref: 'core', created_at: (NOW - 5 * DAY) / 1000, ended_at: (NOW - 2 * DAY) / 1000 }),
      makeView({ id: 'b', repo_ref: 'other', created_at: NOW / 1000 }),
    ];
    expect(lastActivity('core', runs)).toBe(NOW - 2 * DAY);
    expect(lastActivity('none', runs)).toBeNull();
  });
});

describe('reposSentence', () => {
  it('says how many, and what needs doing, in words', () => {
    expect(reposSentence('known', ['ready', 'ready', 'ready', 'ready', 'ready'], 0)).toBe('Five repositories, all indexed and ready.');
    expect(reposSentence('known', ['ready', 'stale', 'never'], 1)).toBe('Three repositories. One is indexed; one needs re-indexing; one is not indexed yet. One job waits on you.');
    expect(reposSentence('known', ['ready'], 0)).toBe('One repository, indexed and ready.');
  });
  it('never claims a count before the list is read', () => {
    expect(reposSentence('loading', [], 0)).toBe('Reading your repositories…');
    expect(reposSentence('failed', [], 0)).not.toMatch(/\d|No /);
  });
});

describe('languageWords', () => {
  const node = (file: string, lang: string) => ({ file, lang }) as never;
  it('names the languages holding a quarter of the mapped files, biggest first, at most two', () => {
    expect(languageWords({ nodes: [node('a.rs', 'rust'), node('b.rs', 'rust'), node('a.rs', 'rust')] })).toBe('Rust');
    expect(languageWords({ nodes: [node('a.py', 'python'), node('b.py', 'python'), node('c.ts', 'typescript'), node('d.md', 'markdown'), node('e.py', 'python'), node('f.ts', 'typescript')] }))
      .toBe('Python + TypeScript');
    expect(languageWords({ nodes: [node('node_modules/x.js', 'javascript')] })).toBeNull();
    expect(languageWords(null)).toBeNull();
  });
});
