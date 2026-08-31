// DES-RUN-NARRATOR §3 rule 1: `useRunEventStore.hydrate` merges instead of
// dropping. FINDING-013's original guard was all-or-nothing — one live frame
// arriving before GET /runs/:id/events resolved discarded the ENTIRE backfill,
// so the feed began mid-story. The recorded trail is now the authoritative
// prefix; live frames that duplicate it are removed by content fingerprint
// (never double-counting a cliUsage), and live-only frames are never lost.

import { beforeEach, describe, expect, it } from 'vitest';
import { useRunEventStore } from '../src/store/events.js';
import type { CoreEvent } from '../src/api/types.js';

const live = (bag: Record<string, unknown>): CoreEvent => bag as unknown as CoreEvent;
/** The recorded copy of the same emission: identical content + the log's ts/seq. */
const recorded = (bag: Record<string, unknown>, seq: number): CoreEvent =>
  ({ ...bag, ts: 1000 + seq, seq }) as unknown as CoreEvent;

describe('run-event hydrate merge (out-of-order arrival dies at the source)', () => {
  beforeEach(() => useRunEventStore.setState({ byRun: {} }));

  it('merges the recorded prefix under live frames that raced the fetch', () => {
    // A live frame lands first (the page opened mid-run)…
    const liveGate = { type: 'gateDecided', session: 'run1', ord: 2, allow: true };
    useRunEventStore.getState().ingest(live(liveGate));

    // …then the backfill resolves with the FULL history, including the same
    // gateDecided emission as its recorded copy.
    useRunEventStore.getState().hydrate('run1', [
      recorded({ type: 'sessionStarted', session: 'run1', problem: 'p' }, 1),
      recorded({ type: 'unitDispatched', session: 'run1', ord: 1, attempt: 0 }, 2),
      recorded(liveGate, 3),
    ]);

    const frames = useRunEventStore.getState().byRun['run1'] ?? [];
    // History is NOT dropped (the pre-merge behavior lost all three)…
    expect(frames.map((e) => e.type)).toEqual(['sessionStarted', 'unitDispatched', 'gateDecided']);
    // …and the duplicated emission appears exactly once.
    expect(frames.filter((e) => e.type === 'gateDecided')).toHaveLength(1);
  });

  it('keeps live-only frames (emitted after the fetch) behind the recorded prefix', () => {
    useRunEventStore.getState().ingest(live({ type: 'unitDone', session: 'run1', ord: 1 }));
    useRunEventStore.getState().hydrate('run1', [
      recorded({ type: 'sessionStarted', session: 'run1', problem: 'p' }, 1),
    ]);
    const frames = useRunEventStore.getState().byRun['run1'] ?? [];
    expect(frames.map((e) => e.type)).toEqual(['sessionStarted', 'unitDone']);
  });

  it('sorts a backfill that arrives out of seq order', () => {
    useRunEventStore.getState().hydrate('run1', [
      recorded({ type: 'unitDone', session: 'run1', ord: 1 }, 9),
      recorded({ type: 'sessionStarted', session: 'run1', problem: 'p' }, 1),
      recorded({ type: 'unitDispatched', session: 'run1', ord: 1, attempt: 0 }, 4),
    ]);
    const frames = useRunEventStore.getState().byRun['run1'] ?? [];
    expect(frames.map((e) => e.seq)).toEqual([1, 4, 9]);
  });

  it('is idempotent: re-hydrating the same trail never duplicates', () => {
    const trail = [
      recorded({ type: 'sessionStarted', session: 'run1', problem: 'p' }, 1),
      recorded({ type: 'cliUsage', session: 'run1', ord: 0, attempt: 0, inputTokens: 5, outputTokens: 5, costUsd: 0.1 }, 2),
    ];
    useRunEventStore.getState().hydrate('run1', trail);
    useRunEventStore.getState().hydrate('run1', trail);
    const frames = useRunEventStore.getState().byRun['run1'] ?? [];
    // The Burn fold reads these — a doubled cliUsage would double the total (FINDING-013).
    expect(frames.filter((e) => e.type === 'cliUsage')).toHaveLength(1);
    expect(frames).toHaveLength(2);
  });
});
