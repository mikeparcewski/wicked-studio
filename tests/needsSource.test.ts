import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from '../src/api/system.js';
import { needsSource } from '../src/board/attention.js';
import { STALE_MS } from '../src/board/nerveCenter.js';
import { needCount } from '../src/board/needsQueue.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { needsForSession } from '../src/board/runHeader.js';
import { useSystemStore } from '../src/store/systemSnapshot.js';
import { makeView } from './factories.js';

const NOW = 1_800_000_000_000;
const gate: NeedRow = { key: 'gate:a', kind: 'gate', text: 'Approve the plan\nMore detail', question: 'Approve the plan', at: NOW - 60_000 } as NeedRow;
// A review carrying this run's key must still be excluded by its section.
const review: NeedRow = { ...gate, key: 'fail:a', kind: 'proposal' };
const signals = () => ({ ...useSystemStore.getInitialState(), mode: 'system' as const, healthAt: NOW, snapshotAt: NOW,
  snapshot: normalizeSnapshot({ checkedAt: new Date(NOW).toISOString(), level: 'yellow', unresolved: [], attention: [
    { id: 'first', severity: 'yellow', source: 'run', title: 'Crew gate', target: { kind: 'run', runId: 'a' }, blockedRunIds: ['b'], waitedSince: new Date(NOW - 120_000).toISOString() },
    { id: 'second', severity: 'yellow', source: 'infra', title: 'Crew-only need', target: { kind: 'infra', key: 'worker' }, blockedRunIds: ['outside', 'b', 'a'] },
    { id: 'elsewhere', severity: 'yellow', source: 'run', title: 'Other session', target: { kind: 'run', runId: 'outside' } },
  ], clis: [], runs: [], infra: [], governance: [] }) });

describe('#1091: shared needs source and session slice', () => {
  it('selects the exact crew list, holds unread or failed reads, and filters fold reviews', () => {
    const s = signals();
    expect(needsSource(s, 'connected', [gate], NOW)).toEqual({ phase: 'ready', from: 'crew', items: s.snapshot.attention });
    for (const changed of [{ snapshot: null }, { snapshotError: 'failed' }, { healthError: 'failed' }, { snapshotAt: NOW - STALE_MS - 1 }]) {
      expect(needsSource({ ...s, ...changed }, 'connected', [gate], NOW)).toEqual({ phase: 'loading' });
    }
    expect(needsSource({ ...s, mode: 'unknown' }, 'connected', [gate], NOW)).toEqual({ phase: 'loading' });
    for (const changed of [{ mode: 'fallback' as const }, { mode: 'unknown' as const, healthError: 'failed' }]) {
      const source = needsSource({ ...s, ...changed }, 'connected', [gate, review], NOW);
      expect(source).toEqual({ phase: 'ready', from: 'fold', rows: [gate] });
      if (source.phase !== 'ready' || source.from !== 'fold') throw new Error('Expected fold');
      expect(needCount(source.rows)).toBe(1);
      expect(needsForSession(source, [gate, review], [makeView({ id: 'a' })], {}, NOW)).toHaveLength(1);
    }
  });

  it('slices one banner item per crew item, preferring its run then a blocked run, with fold words and crew clocks', () => {
    const s = signals();
    const source = { phase: 'ready' as const, from: 'crew' as const, items: s.snapshot.attention };
    const mine = [makeView({ id: 'a' }), makeView({ id: 'b' })];
    expect(needsForSession(source, [gate], mine, {}, NOW)).toEqual([
      { key: 'first', runId: 'a', kind: 'Plan approval', step: null, question: 'Approve the plan', age: '2 minutes ago' },
      { key: 'second', runId: 'b', kind: 'Needs you', step: null, question: 'Crew-only need', age: null },
    ]);
    expect(needsForSession({ ...source, items: [source.items[0]!, { ...source.items[0]!, id: 'same-run-second' }] }, [gate], mine, {}, NOW)).toHaveLength(2);
    expect(needsForSession({ phase: 'loading' }, [gate], mine, {}, NOW)).toEqual([]);
  });

  it('a crew item takes its run’s decision words, never a review row listed before it', () => {
    const s = signals();
    const first = { phase: 'ready' as const, from: 'crew' as const, items: [s.snapshot.attention[0]!] };
    const reviewFirst: NeedRow = { ...gate, key: 'gate:a', kind: 'proposal', text: 'Review the proposal', question: 'Review the proposal' } as NeedRow;
    expect(needsForSession(first, [reviewFirst, gate], [makeView({ id: 'a' })], {}, NOW)[0]!.question).toBe('Approve the plan');
  });
});
