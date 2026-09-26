import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-TEAMING-002 T9 — the plan stores: mid-run edits (requestId per edit, same id on retry,
 * duplicate = already applied), the preview cache, the catalog's unsupported state, and the
 * gate path's 409 gate_changed / gate_unknown (refresh, say it moved, never re-send).
 */

vi.mock('../src/api/client.js', async () => {
  const errors = await import('../src/api/errors.js');
  return {
    apiFetch: vi.fn(),
    api: { confirmGate: vi.fn(), getGate: vi.fn() },
    ApiError: errors.ApiError,
  };
});

const client = await import('../src/api/client.js');
const { ApiError } = await import('../src/api/errors.js');
const { proposePlanEdit, retryPlanEdit, resetPlanEdits, usePlanEdits } = await import('../src/store/planEdits.js');
const { loadCatalog, requestPreview, resetPlanCatalog, usePlanCatalog } = await import('../src/store/planCatalog.js');
const { useLaunchPreview } = await import('../src/hooks/useLaunchPlan.js');
const { renderHook } = await import('@testing-library/react');
const { GATE_MOVED_TEXT, sendGateDecision, useGateActionStore } = await import('../src/board/gateActions.js');
const { useGateStore } = await import('../src/store/gates.js');

const apiFetch = vi.mocked(client.apiFetch);
const confirmGate = vi.mocked(client.api.confirmGate);
const getGate = vi.mocked(client.api.getGate);

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

beforeEach(() => {
  apiFetch.mockReset();
  confirmGate.mockReset();
  getGate.mockReset();
  resetPlanEdits();
  resetPlanCatalog();
  useGateActionStore.setState({ byGate: {} });
  useGateStore.setState({ gates: {} });
});

describe('mid-run edits', () => {
  it('each new edit sends a fresh requestId', async () => {
    apiFetch.mockResolvedValue({ proposal_id: 'p', duplicate: false, band: '40-69', high_risk: false, floor_added: [] });
    await proposePlanEdit('r1', { steps: [{ catalog: 'review' }] });
    await proposePlanEdit('r1', { steps: [{ catalog: 'test' }] });
    const ids = apiFetch.mock.calls.map((c) => bodyOf(c)['requestId']);
    expect(apiFetch.mock.calls[0]![0]).toBe('/runs/r1/plan');
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(usePlanEdits.getState().byRun['r1']?.outcome).toMatchObject({ kind: 'applied', band: '40-69' });
  });

  it('a lost answer is retried with the SAME requestId; duplicate reads already applied', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(503, 'upstream closed'));
    await proposePlanEdit('r1', { steps: [{ catalog: 'test' }] });
    expect(usePlanEdits.getState().byRun['r1']).toMatchObject({ status: 'failed', retryable: true });
    apiFetch.mockResolvedValueOnce({ proposal_id: 'p9', duplicate: true, band: null, high_risk: null, floor_added: [] });
    await retryPlanEdit('r1');
    expect(bodyOf(apiFetch.mock.calls[0]!)['requestId']).toBe(bodyOf(apiFetch.mock.calls[1]!)['requestId']);
    expect(usePlanEdits.getState().byRun['r1']?.outcome).toEqual({ kind: 'already-applied', proposalId: 'p9' });
  });

  it('an engine refusal (409) is the answer: not retryable', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, 'a plan awaiting approval: edit it at the gate'));
    await proposePlanEdit('r1', { steps: [{ catalog: 'test' }] });
    expect(usePlanEdits.getState().byRun['r1']).toMatchObject({ status: 'failed', retryable: false });
    await retryPlanEdit('r1');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('the preview cache and the catalog', () => {
  it('one request per distinct body; repeats answer from the cache', async () => {
    apiFetch.mockResolvedValue({ steps: [], graph: 'ready' });
    const body = { plan: { steps: [{ catalog: 'build' }] } };
    await Promise.all([requestPreview(body), requestPreview(body)]);
    await requestPreview(body);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await requestPreview({ plan: { steps: [{ catalog: 'build' }], touch: ['a.ts'] } });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('a failed preview is not cached: asking again re-requests it', async () => {
    const body = { plan: { steps: [{ catalog: 'build' }] } };
    apiFetch.mockRejectedValueOnce(new ApiError(500, 'boom'));
    expect((await requestPreview(body)).status).toBe('error');
    apiFetch.mockResolvedValueOnce({ steps: [], graph: 'ready' });
    expect((await requestPreview(body)).status).toBe('ready');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('a 501 preview is unsupported, not an error', async () => {
    apiFetch.mockRejectedValue(new ApiError(501, 'the engine lacks previewPlan'));
    expect(await requestPreview({ plan: { steps: [{ catalog: 'build' }] } })).toEqual({ status: 'unsupported' });
  });

  it('the catalog loads once; a daemon without the route is unsupported', async () => {
    apiFetch.mockRejectedValue(new ApiError(404, 'not found'));
    loadCatalog();
    await vi.waitFor(() => expect(usePlanCatalog.getState().catalog).toBe('unsupported'));
    loadCatalog();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('a gate decision that outlived its gate', () => {
  const openGate = (ord: number) =>
    useGateStore.getState().setGate({ runId: 'r1', ord, prompt: `gate ${ord}`, lifecycle: 'open', receivedAt: 1 });

  for (const code of ['gate_changed', 'gate_unknown'] as const) {
    it(`409 ${code}: sent once, the gate re-read, the move named`, async () => {
      openGate(3);
      confirmGate.mockRejectedValueOnce(new ApiError(409, 'Gate changed…', { error: 'Gate changed…', code, openOrd: 4 }));
      getGate.mockResolvedValueOnce({
        runId: 'r1', ord: 4, prompt: 'gate 4', lifecycle: 'open', receivedAt: new Date(0).toISOString(),
      });
      const error = await sendGateDecision('r1', { approve: true, ord: 3 });
      expect(error).toBe(GATE_MOVED_TEXT);
      expect(confirmGate).toHaveBeenCalledTimes(1);
      expect(getGate).toHaveBeenCalledWith('r1');
      expect(useGateStore.getState().gates['r1']).toMatchObject({ ord: 4, prompt: 'gate 4' });
      expect(useGateActionStore.getState().byGate['r1']).toMatchObject({ error: GATE_MOVED_TEXT, busy: false, answered: null });
    });
  }

  it('the gate is gone (404 on re-read): the stale gate is dropped', async () => {
    openGate(3);
    confirmGate.mockRejectedValueOnce(new ApiError(409, 'x', { code: 'gate_changed', openOrd: 4 }));
    getGate.mockRejectedValueOnce(new ApiError(404, 'no gate cached'));
    await sendGateDecision('r1', { approve: true, ord: 3 });
    expect(useGateStore.getState().gates['r1']).toBeUndefined();
  });

  it('any other 409 is reported as before, with no re-read', async () => {
    openGate(3);
    confirmGate.mockRejectedValueOnce(new ApiError(409, 'Run is not awaiting a human gate'));
    const error = await sendGateDecision('r1', { approve: true, ord: 3 });
    expect(error).toMatch(/not awaiting a human gate/);
    expect(getGate).not.toHaveBeenCalled();
  });
});

describe('before:N on a launch the PA scopes first', () => {
  const input = {
    plan: { steps: [{ catalog: 'build' }] },
    workflow: '',
    projectId: null,
    repoRef: null,
    deliver: null,
    mode: 'balanced' as const,
    confirm: 'before' as const,
    beforeOrd: 1,
  };
  const previewCalls = () => apiFetch.mock.calls.filter((c) => String(c[0]).includes('preview'));

  it('a failed preview refuses the launch instead of sending an unshifted before:N', async () => {
    apiFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes('preview')) throw new ApiError(500, 'boom');
      return [];
    });
    const { result } = renderHook(() => useLaunchPreview(input));
    await expect(result.current.resolveHumanConfirm()).rejects.toThrow(/launch preview failed/);
  });

  it('a ready preview with the PA scope step first shifts before:N by one', async () => {
    apiFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes('preview')) {
        return { steps: [{ id: 'pa-scope', catalog: 'understand' }, { catalog: 'build' }], graph: 'pending_pa_scope' };
      }
      return [];
    });
    const { result } = renderHook(() => useLaunchPreview(input));
    expect(await result.current.resolveHumanConfirm()).toBe('before:2');
    expect(previewCalls().length).toBeGreaterThan(0);
  });

  it('a daemon without the preview route (no scope step) sends before:N unshifted', async () => {
    apiFetch.mockImplementation(async (url: unknown) => {
      if (String(url).includes('preview')) throw new ApiError(501, 'the engine lacks previewPlan');
      return [];
    });
    const { result } = renderHook(() => useLaunchPreview(input));
    expect(await result.current.resolveHumanConfirm()).toBe('before:1');
  });
});
