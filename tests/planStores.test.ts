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
const { loadCatalog, requestPreview, previewAnswer, resetPlanCatalog, usePlanCatalog, PREVIEW_TIMEOUT_MS, PREVIEW_ANSWER_WAIT_MS } = await import('../src/store/planCatalog.js');
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

  it('studio#431: a preview the engine does not answer in time says so; a late answer still lands', async () => {
    vi.useFakeTimers();
    try {
      const body = { plan: { steps: [{ catalog: 'review' }] } };
      let answer: (v: unknown) => void = () => undefined;
      apiFetch.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
      const p = requestPreview(body);
      await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS + 10);
      const st = await p;
      expect(st.status).toBe('error');
      expect(st.status === 'error' ? st.error : '').toMatch(/didn’t answer in \d+ s/);
      expect(st.status === 'error' ? st.error : '').toMatch(/studio’s own reading/);
      answer({ steps: [], graph: 'ready' });
      await vi.advanceTimersByTimeAsync(1);
      const key = JSON.stringify(body);
      expect(usePlanCatalog.getState().previews[key]?.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('codex on #431: what places a gate waits for the engine\'s answer — a timeout is not a failed preview', async () => {
    vi.useFakeTimers();
    try {
      const body = { plan: { steps: [{ catalog: 'test' }] } };
      let answer: (v: unknown) => void = () => undefined;
      apiFetch.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
      const p = previewAnswer(body);
      await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS + 10);
      // Asking again after the timeout joins the answer still coming — no second request.
      const again = previewAnswer(body);
      answer({ steps: [], graph: 'ready' });
      expect((await p).status).toBe('ready');
      expect((await again).status).toBe('ready');
      expect(apiFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('codex r2 on #431: an engine that never answers does not hang Send — the wait is bounded', async () => {
    vi.useFakeTimers();
    try {
      const body = { plan: { steps: [{ catalog: 'clarify' }] } };
      apiFetch.mockImplementationOnce(() => new Promise(() => undefined)); // never settles
      const p = previewAnswer(body);
      await vi.advanceTimersByTimeAsync(PREVIEW_ANSWER_WAIT_MS + PREVIEW_TIMEOUT_MS + 10);
      const st = await p;
      expect(st.status).toBe('error');
      expect(st.status === 'error' ? st.error : '').toMatch(/still hasn’t answered/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('codex r2 on #431: only the newest request\'s late answer lands', async () => {
    vi.useFakeTimers();
    try {
      const body = { plan: { steps: [{ catalog: 'design' }] } };
      let a: (v: unknown) => void = () => undefined;
      let b: (v: unknown) => void = () => undefined;
      apiFetch.mockImplementationOnce(() => new Promise((r) => { a = r; }))
        .mockImplementationOnce(() => new Promise((r) => { b = r; }));
      const pa = requestPreview(body);
      await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS + 10);
      await pa;
      const pb = requestPreview(body); // asked again after the timeout
      await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS + 10);
      await pb;
      a({ steps: [{ id: 'old' }], graph: 'ready' }); // the older answer, late
      await vi.advanceTimersByTimeAsync(1);
      const key = JSON.stringify(body);
      expect(usePlanCatalog.getState().previews[key]?.status).toBe('error');
      b({ steps: [{ id: 'new' }], graph: 'ready' });
      await vi.advanceTimersByTimeAsync(1);
      const st = usePlanCatalog.getState().previews[key];
      expect(st?.status === 'ready' ? (st.preview as { steps: { id: string }[] }).steps[0]!.id : null).toBe('new');
    } finally {
      vi.useRealTimers();
    }
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
