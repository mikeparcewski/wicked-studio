import { describe, it, expect, beforeEach } from 'vitest';
import { SCOPE_LABEL, useAnnotationStore } from '../src/store/annotations.js';
import type { CoreEvent } from '../src/api/types.js';

/**
 * Slice BD (DES-UX-002 §4.2/§4.3): the session-scoped pre-gate draft store —
 * pure client state, keyed by run id, pruned when a run can never gate again.
 */

const ev = (type: string, session: string): CoreEvent =>
  ({ type, session } as unknown as CoreEvent);

describe('annotation draft store (slice BD)', () => {
  beforeEach(() => {
    useAnnotationStore.setState({ drafts: {} });
  });

  it('stores a draft by run id and clears it explicitly', () => {
    useAnnotationStore.getState().setDraft('r-1', 'Focus: the burst budget');
    expect(useAnnotationStore.getState().drafts['r-1']).toBe('Focus: the burst budget');
    useAnnotationStore.getState().clearDraft('r-1');
    expect(useAnnotationStore.getState().drafts['r-1']).toBeUndefined();
  });

  it('an emptied draft is a withdrawn note — whitespace deletes the entry', () => {
    useAnnotationStore.getState().setDraft('r-1', 'keep the tests green');
    useAnnotationStore.getState().setDraft('r-1', '   ');
    expect('r-1' in useAnnotationStore.getState().drafts).toBe(false);
  });

  it('terminal frames prune the run draft; resumed does NOT (next gate still pre-fills)', () => {
    for (const runId of ['r-done', 'r-cancel', 'r-fail', 'r-live']) {
      useAnnotationStore.getState().setDraft(runId, 'note');
    }
    useAnnotationStore.getState().ingest(ev('sessionCompleted', 'r-done'));
    useAnnotationStore.getState().ingest(ev('runCancelled', 'r-cancel'));
    useAnnotationStore.getState().ingest(ev('sessionFailed', 'r-fail'));
    useAnnotationStore.getState().ingest(ev('resumed', 'r-live'));
    useAnnotationStore.getState().ingest(ev('awaitingHuman', 'r-live'));
    const drafts = useAnnotationStore.getState().drafts;
    expect(Object.keys(drafts)).toEqual(['r-live']);
  });

  it('EC52: the honest scope label names the session scope and CREW-UX-4, verbatim §4.3', () => {
    expect(SCOPE_LABEL).toBe(
      'saved for this browser session only — durable annotations land with CREW-UX-4.',
    );
  });
});
