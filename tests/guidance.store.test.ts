import { describe, it, expect, vi, beforeEach } from 'vitest';
import { durableGuidance, useGuidanceStore } from '../src/store/guidance.js';
import * as client from '../src/api/client.js';

/**
 * Slice BE (DES-UX-002 §8.1): the durable-guidance layer over CREW-UX-7
 * (crew#312 — the doc's "CREW-UX-4"): the save gesture's PUT, the mirror that
 * out-votes a stale DTO echo, and the point-of-action save state (EC37).
 */

describe('guidance store (slice BE)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGuidanceStore.setState({ saved: {}, saveState: {} });
  });

  it('save PUTs {text} and mirrors what the daemon ECHOED, not what was sent', async () => {
    const put = vi.spyOn(client.api, 'putGuidance').mockResolvedValue(
      { runId: 'r-1', guidance: 'stored form' } as never,
    );
    await useGuidanceStore.getState().save('r-1', 'sent form');
    expect(put).toHaveBeenCalledWith('r-1', 'sent form');
    expect(useGuidanceStore.getState().saved['r-1']).toBe('stored form');
    expect(useGuidanceStore.getState().saveState['r-1']).toMatchObject({ phase: 'saved' });
  });

  it("'' clears: the mirror holds '' so a stale DTO echo cannot resurrect the note", async () => {
    vi.spyOn(client.api, 'putGuidance').mockResolvedValue(
      { runId: 'r-1', guidance: '' } as never,
    );
    await useGuidanceStore.getState().save('r-1', '');
    expect(useGuidanceStore.getState().saved['r-1']).toBe('');
    // The DTO still echoes the old note until the next refetch — mirror wins.
    expect(durableGuidance('r-1', 'stale echo', useGuidanceStore.getState().saved)).toBe('');
  });

  it('a failed save lands as a NAMED error state and never throws', async () => {
    vi.spyOn(client.api, 'putGuidance').mockRejectedValue(new Error('Run not found'));
    await useGuidanceStore.getState().save('r-x', 'note');
    expect(useGuidanceStore.getState().saveState['r-x']).toEqual(
      { phase: 'error', detail: 'Run not found' },
    );
    expect(useGuidanceStore.getState().saved['r-x']).toBeUndefined();
  });

  it('durableGuidance: no local write ⇒ the DTO answers (absent-when-never included)', () => {
    expect(durableGuidance('r-1', 'dto note', {})).toBe('dto note');
    expect(durableGuidance('r-1', undefined, {})).toBeUndefined();
  });
});
