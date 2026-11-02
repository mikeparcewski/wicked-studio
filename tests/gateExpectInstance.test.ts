/**
 * A decision made on a gate SHOWN earlier (a voice Confirm card) is for that gate instance only (codex on #937, P1):
 * `commitGateDecision(…, { expect })` sends nothing when the run's gate is another instance by then, and sends the
 * expected instance's ord, never the current gate's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { commitGateDecision, useGateActionStore } from '../src/board/gateActions.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';

const RUN = 'r-937';
const review: OpenGate = { runId: RUN, ord: 2, prompt: 'Approve the review', lifecycle: 'open', receivedAt: 100 };
const deliver: OpenGate = { runId: RUN, ord: 9, prompt: 'Approve delivery?', lifecycle: 'open', receivedAt: 200, gateKind: 'deliver' };

describe('commitGateDecision with an expected gate instance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setUndoWindowForTest(0);
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
  });
  afterEach(() => useGateStore.setState({ gates: {} }));

  it('the run moved on to its delivery gate: nothing is sent', async () => {
    useGateStore.setState({ gates: { [RUN]: deliver } });
    await expect(commitGateDecision(RUN, { approve: true }, { expect: { ord: 2, receivedAt: 100 } })).resolves.toBe('cancelled');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(useGateActionStore.getState().byGate[RUN]?.queued ?? false).toBe(false);
  });

  it('the same ord asked again is another instance: nothing is sent', async () => {
    useGateStore.setState({ gates: { [RUN]: { ...review, receivedAt: 150 } } });
    await expect(commitGateDecision(RUN, { approve: true }, { expect: { ord: 2, receivedAt: 100 } })).resolves.toBe('cancelled');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('the gate answered elsewhere (none open): nothing is sent', async () => {
    useGateStore.setState({ gates: {} });
    await expect(commitGateDecision(RUN, { approve: true }, { expect: { ord: 2, receivedAt: 100 } })).resolves.toBe('cancelled');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('still the same instance: sent, with that instance\'s ord', async () => {
    useGateStore.setState({ gates: { [RUN]: review } });
    await expect(commitGateDecision(RUN, { approve: true }, { expect: { ord: 2, receivedAt: 100 } })).resolves.toBe('sent');
    expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, expect.objectContaining({ approve: true, ord: 2 }));
  });
});
