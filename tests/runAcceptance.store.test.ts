import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The session's acceptance reads (WT-U2): one read per run at a time; an ask that arrives while a
 * read is in flight re-reads once it lands (the run moved under the first read); a failed read is
 * `null` — nothing is drawn, never a plausible verdict.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...mod, apiFetch: (...a: unknown[]) => apiFetch(...a), api: { ...mod.api, getRunAcceptance: (id: string) => apiFetch(`/runs/${id}/acceptance`) } };
});

const { useRunAcceptanceStore, resetRunAcceptanceForTest } = await import('../src/store/runAcceptance.js');
type RunAcceptanceView = import('../src/api/types.js').RunAcceptanceView;

function view(checked: boolean): RunAcceptanceView {
  return {
    runId: 'r-walk-pass', gate: { required: true, satisfied: checked, verdict: checked ? 'PASS' : null, runStatus: null, reason: 'x' },
    walkthrough: { roots: [], sealed: checked, steps: checked ? [{ stepId: 'build', checkState: 'checked', provedBy: [{ chapter: '04-pay', atSec: null }] }] : [{ stepId: 'build', checkState: 'claimed', provedBy: [] }] },
    summary: { required: true, satisfied: checked, line: checked ? 'Checked by a walkthrough: 1 of 1 step at 9f3c2ab.' : 'Not accepted yet: nothing sealed.', walkthrough: null },
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  resetRunAcceptanceForTest();
});

describe('runAcceptance store', () => {
  it('reads once, and again on a second ask after the first landed', async () => {
    apiFetch.mockResolvedValue(view(true));
    await useRunAcceptanceStore.getState().read('r-walk-pass');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe('/runs/r-walk-pass/acceptance');
    expect(useRunAcceptanceStore.getState().byRun['r-walk-pass']?.walkthrough?.steps[0]?.checkState).toBe('checked');
    await useRunAcceptanceStore.getState().read('r-walk-pass');
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it('an ask while a read is in flight reads again once it lands, so the run that moved meanwhile is not missed', async () => {
    let answerFirst!: (v: RunAcceptanceView) => void;
    apiFetch.mockImplementationOnce(() => new Promise<RunAcceptanceView>((res) => { answerFirst = res; }));
    apiFetch.mockImplementationOnce(() => Promise.resolve(view(true)));
    const s = useRunAcceptanceStore.getState();
    const p1 = s.read('r-walk-pass');
    const p2 = s.read('r-walk-pass');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    answerFirst(view(false));
    await Promise.all([p1, p2]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(useRunAcceptanceStore.getState().byRun['r-walk-pass']?.walkthrough?.steps[0]?.checkState).toBe('checked');
  });

  it('a failed read is null: nothing to draw, never a verdict', async () => {
    apiFetch.mockRejectedValue(new Error('404 no run with that id'));
    await useRunAcceptanceStore.getState().read('r-gone');
    expect(useRunAcceptanceStore.getState().byRun['r-gone']).toBeNull();
  });
});
