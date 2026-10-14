// studio#769: an open worker question shows even when the page loads after it opened (GET hydration).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getElicitation = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getElicitation: (id: string) => getElicitation(id) } }));

import { hydrateElicitations } from '../src/hooks/useRuns.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import type { SessionView } from '../src/api/types.js';

const run = (id: string, status: string): SessionView => ({ session: { id, status }, units: [] }) as unknown as SessionView;
const info = (runId: string, elicitationId: string) => ({ runId, elicitationId, message: `question ${elicitationId}`, options: ['Retry', 'Pause'], receivedAt: '2026-10-13T00:00:00Z' });

beforeEach(() => {
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  getElicitation.mockReset();
});

describe('studio#769 — late-join elicitation hydration', () => {
  it('reads the open question of a live run the store holds none for', async () => {
    getElicitation.mockImplementation(async (id: string) => (id === 'r1' ? info('r1', 'q1') : null));
    await hydrateElicitations([run('r1', 'executing'), run('r2', 'executing')]);
    expect(useElicitationStore.getState().elicitations['r1']).toMatchObject({ elicitationId: 'q1', options: ['Retry', 'Pause'] });
    expect(useElicitationStore.getState().elicitations['r2']).toBeUndefined();
  });

  it('skips finished runs and runs that already hold a question', async () => {
    useElicitationStore.getState().setElicitation({ ...info('r1', 'live'), receivedAt: 'x' });
    getElicitation.mockResolvedValue(info('r1', 'other'));
    await hydrateElicitations([run('r1', 'executing'), run('r3', 'completed'), run('r4', 'cancelled')]);
    expect(getElicitation).not.toHaveBeenCalled();
    expect(useElicitationStore.getState().elicitations['r1']?.elicitationId).toBe('live');
  });

  it('a frame that resolves the question while the read is in flight wins (no resurrection)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    getElicitation.mockImplementation(() => new Promise((r) => { answer = r; }));
    const p = hydrateElicitations([run('r1', 'executing')]);
    useElicitationStore.getState().clearElicitation('r1');
    answer(info('r1', 'q1'));
    await p;
    expect(useElicitationStore.getState().elicitations['r1']).toBeUndefined();
  });

  it('a failed read leaves the store as it was', async () => {
    getElicitation.mockRejectedValue(new Error('500'));
    await hydrateElicitations([run('r1', 'executing')]);
    expect(useElicitationStore.getState().elicitations).toEqual({});
  });

  it('stops writing once the caller is cancelled', async () => {
    getElicitation.mockResolvedValue(info('r1', 'q1'));
    await hydrateElicitations([run('r1', 'executing')], () => true);
    expect(useElicitationStore.getState().elicitations['r1']).toBeUndefined();
  });
});
