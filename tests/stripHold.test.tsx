// The J3 closed-drawer export pin (DES-UX-001 §7.2/EC37): the version strip is
// the ONLY place the export answer lives while the thread drawer is closed, so
// auto-hide must never fade the click site's answer out from under the user.
// Reproduced: with the drawer closed, the strip (pending answer and all) went
// opacity-0 three seconds after the click — "zero visible response".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { ExportMenu } from '../src/components/ExportMenu.js';
import { STRIP_IDLE_MS, useStripAutoHide } from '../src/components/ThreadDrawer.js';

const postExport = vi.fn();

const { ServiceHintError } = vi.hoisted(() => ({
  ServiceHintError: class ServiceHintError extends Error {
    readonly hint: string;
    constructor(message: string, hint: string) { super(message); this.hint = hint; }
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  postExport: (...a: unknown[]) => postExport(...a),
  interactiveUrl: (pid: string, p: string) => `/api/v1/projects/${pid}/interactive${p}`,
  ServiceHintError,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useStripAutoHide — the hold contract', () => {
  it('held, the strip stays visible past the idle budget; released, it earns its exit again', () => {
    const { result } = renderHook(() => useStripAutoHide());
    expect(result.current.hidden).toBe(false);

    act(() => { result.current.hold(true); });
    act(() => { vi.advanceTimersByTime(STRIP_IDLE_MS * 5); });
    expect(result.current.hidden).toBe(false);

    act(() => { result.current.hold(false); });
    expect(result.current.hidden).toBe(false); // the release re-arms, never snaps
    act(() => { vi.advanceTimersByTime(STRIP_IDLE_MS + 50); });
    expect(result.current.hidden).toBe(true);
  });

  it('holds are ref-counted: the strip hides only after the LAST holder releases', () => {
    const { result } = renderHook(() => useStripAutoHide());
    act(() => { result.current.hold(true); result.current.hold(true); });
    act(() => { result.current.hold(false); });
    act(() => { vi.advanceTimersByTime(STRIP_IDLE_MS * 2); });
    expect(result.current.hidden).toBe(false);
    act(() => { result.current.hold(false); });
    act(() => { vi.advanceTimersByTime(STRIP_IDLE_MS + 50); });
    expect(result.current.hidden).toBe(true);
  });
});

describe('ExportMenu — holds its host while it owes (or shows) an answer', () => {
  it('holds through pending AND the un-acted READY answer; a version change releases', async () => {
    const onHold = vi.fn();
    let resolveExport: (v: unknown) => void = () => {};
    postExport.mockImplementation(() => new Promise((res) => { resolveExport = res; }));

    const { rerender } = render(
      <ExportMenu projectId="p1" docId="roadmap" version={3} onHold={onHold} />,
    );
    expect(onHold).not.toHaveBeenCalled();

    act(() => { screen.getAllByTestId('export-format')[0]!.click(); });
    expect(onHold).toHaveBeenLastCalledWith(true);

    // The export resolves: still held — READY is an answer the user has not acted on.
    await act(async () => {
      resolveExport({ format: 'html', path: '/e/f', file: 'roadmap_v3.html', download: '/d/roadmap/f' });
      await Promise.resolve();
    });
    expect(screen.getByTestId('export-ready')).toBeInTheDocument();
    const calls = onHold.mock.calls.map((c) => c[0]);
    expect(calls.filter((v) => v === true).length - calls.filter((v) => v === false).length).toBe(1);

    // Addressing another version retires the answer — the hold releases with it.
    rerender(<ExportMenu projectId="p1" docId="roadmap" version={2} onHold={onHold} />);
    const after = onHold.mock.calls.map((c) => c[0]);
    expect(after.filter((v) => v === true).length).toBe(after.filter((v) => v === false).length);
  });
});
