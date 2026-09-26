import { beforeEach, describe, expect, it } from 'vitest';
import { handoverSections } from '../src/board/handover.js';
import { projectBrief, snapshotStatuses } from '../src/board/projectBrief.js';
import { useVisitStore, VISIT_KEY } from '../src/store/visit.js';
import { makeView } from './factories.js';

/** Round 2 of studio#336's review: items 4, 5 and 6, pinned red-first. */

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const THRESHOLD = 30 * MIN;

describe('item 4 — the heartbeat judges an absence it observes itself', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useVisitStore.setState({ lastSeenAt: null, handover: null });
  });

  it('a laptop that slept with the tab visible: the next heartbeat opens the handover', () => {
    const { arrive, heartbeat } = useVisitStore.getState();
    arrive(NOW - 3 * HOUR, THRESHOLD);
    heartbeat(NOW, THRESHOLD); // no visibility event came — only the minute tick
    const s = useVisitStore.getState();
    expect(s.handover).toEqual({ since: NOW - 3 * HOUR, at: NOW });
    expect(s.lastSeenAt).toBe(NOW);
    expect(JSON.parse(window.localStorage.getItem(VISIT_KEY)!).handover).toEqual({ since: NOW - 3 * HOUR, at: NOW });
  });

  it('an ordinary minute tick only moves the clock', () => {
    const { arrive, heartbeat } = useVisitStore.getState();
    arrive(NOW - MIN, THRESHOLD);
    heartbeat(NOW, THRESHOLD);
    expect(useVisitStore.getState()).toMatchObject({ lastSeenAt: NOW, handover: null });
  });
});

describe('item 5 — the brief snapshots only live runs and dates "started" by created_at', () => {
  const leftAt = NOW - HOUR;

  it('old terminal runs are not snapshotted and are never counted as new', () => {
    const before = snapshotStatuses([
      makeView({ id: 'live', status: 'executing' }),
      makeView({ id: 'old-done', status: 'completed' }),
    ]);
    expect(Object.keys(before)).toEqual(['live']);
    const counts = projectBrief(before, [
      makeView({ id: 'live', status: 'completed' }),
      makeView({ id: 'old-done', status: 'completed', created_at: (NOW - 5 * HOUR) / 1000 }),
      makeView({ id: 'undated', status: 'failed' }),
      makeView({ id: 'fresh', status: 'executing', created_at: (NOW - 10 * MIN) / 1000 }),
    ], leftAt);
    expect(counts).toEqual({ finished: 1, failed: 0, started: 1, gates: 0 });
  });
});

describe('item 6 — an in-flight audit read is loading, not "cannot say"', () => {
  const base = {
    runs: [makeView({ id: 'r1', status: 'executing' })],
    gates: {}, elicitations: {}, failedAt: {}, projectIds: {}, since: NOW - HOUR,
  };

  it('the system section carries loading / failed / ready states', () => {
    expect(handoverSections({ ...base, audit: 'loading' })[3]!.state).toBe('loading');
    expect(handoverSections({ ...base, audit: null })[3]!.state).toBe('failed');
    expect(handoverSections({ ...base, audit: [] })[3]!.state).toBe('ready');
    expect(handoverSections({ ...base, audit: 'loading' })[0]!.state).toBe('ready');
  });
});
