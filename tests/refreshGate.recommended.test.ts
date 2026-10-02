import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { refreshGate } from '../src/board/gateActions.js';
import { useGateStore } from '../src/store/gates.js';

/** S5 (Copilot): a replacement gate read after a 409 keeps the producer's C3 recommendation. */
describe('refreshGate', () => {
  afterEach(() => { vi.restoreAllMocks(); useGateStore.getState().clearGate('r9'); });
  it('carries `recommended` from the cached gate onto the store', async () => {
    vi.spyOn(api, 'getGate').mockResolvedValue({
      runId: 'r9', ord: 4, prompt: 'Approve unit 4 before it runs: build', lifecycle: 'open',
      receivedAt: new Date(0).toISOString(), recommended: 0,
    } as never);
    await refreshGate('r9');
    expect(useGateStore.getState().gates['r9']).toMatchObject({ ord: 4, recommended: 0 });
  });
});
