import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';

/**
 * WT-U2's reads, as the session drives them (codex round 1):
 *  - a run whose accepted plan override removed the walkthrough pair is still asked for its
 *    acceptance — that read is the only place "end-to-end testing is yours" comes from;
 *  - a chip's moment never comes from a recording the artifact could not re-read: a failed read
 *    withdraws the published take, so a newer sealed take is never joined to an older one's marks;
 *  - a chip's ask is consumed by the artifact that answered it — leaving the session and coming
 *    back does not open the pane again by itself.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...mod, apiFetch: (...a: unknown[]) => apiFetch(...a), api: { ...mod.api, getRunAcceptance: (id: string) => apiFetch(`/runs/${id}/acceptance`) } };
});

const { useRunAcceptance } = await import('../src/hooks/useRunAcceptance.js');
const { resetRunAcceptanceForTest } = await import('../src/store/runAcceptance.js');
const { useRecording, WalkthroughEditor } = await import('../src/components/session/WalkthroughEditor.js');
const { useRecordingsStore, resetRecordingsForTest } = await import('../src/store/recordings.js');
const { requestWalkthroughSeek, resetWalkthroughSeekForTest } = await import('../src/store/walkthroughSeek.js');
const { ApiError } = await import('../src/api/errors.js');
type SessionView = import('../src/api/types.js').SessionView;
type ChainModel = import('../src/board/chainModel.js').ChainModel;
type WalkthroughView = import('../src/api/walkthrough.js').WalkthroughView;

function walkView(over: Partial<WalkthroughView> = {}): WalkthroughView {
  const chapters = [1, 2].map((i) => ({
    key: `ch${i}`, title: `Chapter ${i}`, blurb: `What chapter ${i} shows`, tags: [], resets: [], recorded: true,
    index: i, total: 2, verdict: 'PASS', takes: 1, failedAtSec: null, failedFrame: null, proves: ['build'], legs: [], checks: [],
  }));
  return {
    runId: 'r-walk', stepId: 'walkthrough_review', planStepId: 'walkthrough_plan', state: 'passed', cause: null,
    seat: { evaluator: 'agy', builders: ['codex'] }, tree: 'a1b2c3d', stale: false, sealed: true,
    video: { mp4: 'take/video.mp4', poster: null, markers: [{ at: '0:00', sec: 0, title: 'Chapter 1' }, { at: '0:34', sec: 34, title: 'Chapter 2' }] },
    chapters, steps: [{ stepId: 'build', checkState: 'checked', provedBy: [{ chapter: 'ch2', atSec: null }] }],
    ...over,
  } as unknown as WalkthroughView;
}

const emptyChain: ChainModel = { source: 'team', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };

beforeEach(() => {
  apiFetch.mockReset();
  resetRunAcceptanceForTest();
  resetRecordingsForTest();
  resetWalkthroughSeekForTest();
});

describe('the acceptance read for a run whose override removed the pair', () => {
  it('is made although the plan names no walkthrough step and no hand-over is open', async () => {
    apiFetch.mockResolvedValue({ runId: 'r-yours', gate: { required: true, satisfied: false, verdict: null, runStatus: null, reason: 'x' } });
    const view = {
      session: {
        id: 'r-yours', status: 'executing', unit_ix: 2, problem: 'void one line',
        team_plan: { rev: 1, accepted_rev: 1, accepted: { floor_override: { remove: ['walkthrough_plan', 'walkthrough_review'], reason: 'our QA team' } } },
      },
      units: [],
    } as unknown as SessionView;
    renderHook(() => useRunAcceptance(view, emptyChain, undefined));
    await waitFor(() => expect(apiFetch.mock.calls.map((c) => String(c[0]))).toContain('/runs/r-yours/acceptance'));
  });
  it('is not made for a plan with neither (no fan-out)', async () => {
    const view = { session: { id: 'r-plain', status: 'executing', unit_ix: 0, problem: 'x' }, units: [] } as unknown as SessionView;
    renderHook(() => useRunAcceptance(view, emptyChain, undefined));
    await new Promise((r) => setTimeout(r, 20));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('a recording the artifact could not re-read places no moment', () => {
  it('a failed re-read withdraws the published take', async () => {
    apiFetch.mockResolvedValueOnce(walkView());
    const { rerender } = renderHook(({ status }) => useRecording('r-walk', 'walkthrough', 'walkthrough_review', status), { initialProps: { status: 'executing' } });
    await waitFor(() => expect(useRecordingsStore.getState().byRun['r-walk']).toBeDefined());
    apiFetch.mockRejectedValue(new ApiError(500, 'boom'));
    rerender({ status: 'awaiting_human' });
    await waitFor(() => expect(useRecordingsStore.getState().byRun['r-walk']).toBeUndefined());
  });
});

describe('a chip’s ask is answered once', () => {
  it('an ask left from an earlier visit does not open the pane when the artifact mounts again', async () => {
    apiFetch.mockResolvedValue(walkView());
    const morph = vi.fn();
    const first = render(<WalkthroughEditor runId="r-walk" kind="walkthrough" step="walkthrough_review" size="inline" morph={morph} units={[]} runStatus="done" />);
    await waitFor(() => expect(first.container.querySelector('[data-testid="walkthrough-loading"]')).toBeNull());
    act(() => { requestWalkthroughSeek('r-walk', 34); });
    await waitFor(() => expect(morph).toHaveBeenCalledWith('pane'));
    first.unmount();
    morph.mockReset();
    const again = render(<WalkthroughEditor runId="r-walk" kind="walkthrough" step="walkthrough_review" size="inline" morph={morph} units={[]} runStatus="done" />);
    await waitFor(() => expect(again.container.querySelector('[data-testid="walkthrough-loading"]')).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(morph).not.toHaveBeenCalled();
  });
});
