import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Batch gate resolution (DES-FEEDBACK-002 §9, slice L): the selection model,
 * the SEQUENTIAL fan-out through the ONE audited `decideGate` path (exact
 * POST count and order — never a parallel burst), per-id failure honesty
 * (the bulk-archive precedent client-side), the shared double-submit guard,
 * and retry-fires-only-that-id.
 */

vi.mock('../src/api/client.js', () => ({
  api: { confirmGate: vi.fn() },
}));

const { api } = await import('../src/api/client.js');
const {
  clearBatchSelection, retryBatchOne, runBatchDecision, toggleBatchSelect, useBatchGateStore,
} = await import('../src/board/batchGates.js');
const { useGateActionStore } = await import('../src/board/gateActions.js');

const confirmGate = vi.mocked(api.confirmGate);

beforeEach(() => {
  confirmGate.mockReset().mockResolvedValue({ status: 'resumed' });
  useGateActionStore.setState({ byGate: {} });
  useBatchGateStore.setState({
    selected: [], running: false, done: 0, total: 0, failures: [], lastDecision: null,
  });
});

describe('the selection model (§9.2)', () => {
  it('toggles in selection order; a second toggle removes', () => {
    toggleBatchSelect('r-a');
    toggleBatchSelect('r-b');
    expect(useBatchGateStore.getState().selected).toEqual(['r-a', 'r-b']);
    toggleBatchSelect('r-a');
    expect(useBatchGateStore.getState().selected).toEqual(['r-b']);
  });

  it('clear drops everything and fires nothing (§9.5)', () => {
    toggleBatchSelect('r-a');
    clearBatchSelection();
    expect(useBatchGateStore.getState().selected).toEqual([]);
    expect(confirmGate).not.toHaveBeenCalled();
  });
});

describe('the sequential fan-out (§9.2)', () => {
  it('fires exactly one POST per selected id, in selection order, one at a time', async () => {
    const resolvers: Array<() => void> = [];
    confirmGate.mockImplementation(
      () => new Promise((resolve) => resolvers.push(() => resolve({ status: 'resumed' }))),
    );
    toggleBatchSelect('r-a');
    toggleBatchSelect('r-b');
    toggleBatchSelect('r-c');

    const run = runBatchDecision({ approve: true });
    await vi.waitFor(() => expect(confirmGate).toHaveBeenCalledTimes(1)); // strictly sequential
    expect(useBatchGateStore.getState().running).toBe(true);
    resolvers[0]!();
    await vi.waitFor(() => expect(confirmGate).toHaveBeenCalledTimes(2));
    resolvers[1]!();
    await vi.waitFor(() => expect(confirmGate).toHaveBeenCalledTimes(3));
    resolvers[2]!();
    await run;

    expect(confirmGate.mock.calls.map((c) => c[0])).toEqual(['r-a', 'r-b', 'r-c']);
    expect(confirmGate.mock.calls.every((c) => c[1]?.approve === true)).toBe(true);
    const s = useBatchGateStore.getState();
    expect(s).toMatchObject({ running: false, done: 3, total: 3, failures: [], selected: [] });
  });

  it('the reject fan-out carries the ONE bar-level note as amend on every id (§9.2)', async () => {
    toggleBatchSelect('r-a');
    toggleBatchSelect('r-b');
    await runBatchDecision({ approve: false, amend: 'wrong branch' });
    expect(confirmGate.mock.calls.map((c) => c[1])).toEqual([
      { approve: false, amend: 'wrong branch' },
      { approve: false, amend: 'wrong branch' },
    ]);
  });

  it('a second fan-out while one runs is dropped (the shared double-submit guard)', async () => {
    let release: () => void = () => undefined;
    confirmGate.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ status: 'resumed' }); }),
    );
    toggleBatchSelect('r-a');
    const first = runBatchDecision({ approve: true });
    await vi.waitFor(() => expect(confirmGate).toHaveBeenCalledTimes(1));
    await runBatchDecision({ approve: true }); // dropped — returns without a POST
    expect(confirmGate).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(confirmGate).toHaveBeenCalledTimes(1);
  });
});

describe('per-id failure honesty (§9.2/§9.5)', () => {
  it('a 409 on one id stays listed with its named error; successes leave', async () => {
    confirmGate.mockImplementation(async (id: string) => {
      if (id === 'r-b') throw new Error('API 409: run resumed');
      return { status: 'resumed' };
    });
    toggleBatchSelect('r-a');
    toggleBatchSelect('r-b');
    toggleBatchSelect('r-c');
    await runBatchDecision({ approve: true });

    const s = useBatchGateStore.getState();
    expect(s.failures).toEqual([{ runId: 'r-b', error: 'API 409: run resumed' }]);
    expect(s.selected).toEqual(['r-b']); // the failed id is still answerable
    expect(s.done).toBe(3);
  });

  it('retry fires ONLY the failed id, with the decision the fan-out used', async () => {
    confirmGate.mockRejectedValueOnce(new Error('API 409: not awaiting a human gate'));
    toggleBatchSelect('r-a');
    await runBatchDecision({ approve: true });
    expect(useBatchGateStore.getState().failures).toHaveLength(1);

    confirmGate.mockClear().mockResolvedValue({ status: 'resumed' });
    await retryBatchOne('r-a');
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(confirmGate).toHaveBeenCalledWith('r-a', { approve: true });
    const s = useBatchGateStore.getState();
    expect(s.failures).toEqual([]);
    expect(s.selected).toEqual([]);
  });

  it('retry of an id that never failed is a no-op', async () => {
    toggleBatchSelect('r-a');
    await runBatchDecision({ approve: true });
    confirmGate.mockClear();
    await retryBatchOne('r-a');
    expect(confirmGate).not.toHaveBeenCalled();
  });
});
