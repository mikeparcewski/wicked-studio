// FINDING-013 (residual): the studio's /ws stream has no late-join replay, so a page reloaded
// against a run showed an empty Burn panel ("usage not yet reported") even though the usage was
// durably recorded. `hydrate` backfills a run's log from GET /runs/:id/events — but ONLY when the run
// has no live frames yet, so a running run's streamed usage is never double-counted.

import { beforeEach, describe, expect, it } from 'vitest';
import { useRunEventStore } from '../src/store/events.js';
import type { CoreEvent } from '../src/api/types.js';

const usage = (session: string, inputTokens: number): CoreEvent =>
  ({ type: 'cliUsage', session, ord: 0, attempt: 0, inputTokens, outputTokens: 5, costUsd: 0.1 }) as unknown as CoreEvent;

describe('FINDING-013: run-event hydration', () => {
  beforeEach(() => useRunEventStore.setState({ byRun: {} }));

  it('backfills persisted usage into an empty run and drops high-volume frames', () => {
    const persisted: CoreEvent[] = [
      usage('run1', 100),
      { type: 'cliOutputDelta', session: 'run1', text: 'noise' } as unknown as CoreEvent,
    ];
    useRunEventStore.getState().hydrate('run1', persisted);
    const frames = useRunEventStore.getState().byRun['run1'] ?? [];
    // The cliUsage is backfilled (Burn can now show the persisted total)...
    expect(frames.filter((e) => e.type === 'cliUsage')).toHaveLength(1);
    // ...and the high-volume output delta is dropped, same as the live ingest path.
    expect(frames.some((e) => e.type === 'cliOutputDelta')).toBe(false);
  });

  it('never clobbers live frames already streamed from /ws', () => {
    // Two distinct live frames arrived over the socket first.
    useRunEventStore.getState().ingest(usage('run1', 100));
    useRunEventStore
      .getState()
      .ingest({ type: 'gateDecided', session: 'run1', ord: 0 } as unknown as CoreEvent);
    // A reload-style backfill carrying FEWER frames must be a no-op — replacing the live log with the
    // (possibly staler / smaller) persisted one would lose live-only frames. Length stays 2, not 1.
    useRunEventStore.getState().hydrate('run1', [usage('run1', 100)]);
    expect(useRunEventStore.getState().byRun['run1']).toHaveLength(2);
  });

  it('ignores events for a different run id', () => {
    useRunEventStore.getState().hydrate('run1', [usage('other-run', 100)]);
    expect(useRunEventStore.getState().byRun['run1']).toBeUndefined();
  });
});
