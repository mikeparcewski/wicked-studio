// studio#723 (Desk count on reload) + studio#684 comment (badge on a failed read): the needs count
// never shows a number that is still moving, and a failed runs read never changes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { NeedRow } from '../src/board/needsYou.js';
import { NEEDS_QUIET_MS, resetSettledNeedsForTest, useSettledNeeds } from '../src/hooks/useNeedsRows.js';
import { useNeedsSources } from '../src/store/needsSources.js';

const rows = (n: number, kind = 'gate'): NeedRow[] => Array.from({ length: n }, (_, i) => ({ key: `r${i}`, kind }) as unknown as NeedRow);

beforeEach(() => {
  vi.useFakeTimers();
  resetSettledNeedsForTest();
  const now = Date.now();
  useNeedsSources.setState({ chats: [], proposals: [], repos: [], readAt: { chats: now, proposals: now, repos: now, campaigns: now } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useSettledNeeds', () => {
  it('a count still moving on reload (26, then 43) is not shown until it holds still', () => {
    const { result, rerender } = renderHook(({ r }) => useSettledNeeds(r, true), { initialProps: { r: rows(26) } });
    expect(result.current.count).toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    rerender({ r: rows(43) });
    expect(result.current.count).toBeNull();
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    rerender({ r: rows(43) });
    expect(result.current).toMatchObject({ phase: 'complete', count: 43 });
  });

  it('a failed runs read keeps the last known count (43 never drops to 17)', () => {
    const { result, rerender } = renderHook(({ r, failed }) => useSettledNeeds(r, true, failed), { initialProps: { r: rows(43), failed: false } });
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 50); });
    rerender({ r: rows(43), failed: false });
    expect(result.current.count).toBe(43);
    rerender({ r: rows(17), failed: true });
    expect(result.current.count).toBe(43);
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS * 3); });
    rerender({ r: rows(17), failed: true });
    expect(result.current.count).toBe(43);
  });

  it('wakes on its own once the count has held still (no re-render needed)', () => {
    const { result } = renderHook(() => useSettledNeeds(rows(5), true));
    expect(result.current.count).toBeNull();
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 100); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 5 });
  });

  it('counts decisions and failures, never reviews (operator ruling 2026-10-12)', () => {
    const mixed = [...rows(2, 'gate'), ...rows(1, 'failed-run').map((r) => ({ ...r, key: 'f0' })), ...rows(5, 'proposal').map((r, i) => ({ ...r, key: `p${i}` }))];
    const { result } = renderHook(() => useSettledNeeds(mixed, true));
    act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS + 100); });
    expect(result.current).toMatchObject({ phase: 'complete', count: 3 });
  });

  // studio#833: an empty project's Needs you stayed on its skeleton forever. The rail counts every
  // run (12) and the project's Desk counts its own (0); with one shared record each render reset the
  // other's quiet clock, so neither held still long enough to be said.
  it('a project Desk and the rail count different rows and both settle, each on its own number', () => {
    const rail = renderHook(() => useSettledNeeds(rows(12), true));
    const project = renderHook(() => useSettledNeeds(rows(0), true, false, 'proj-colors'));
    for (let i = 0; i < 6; i += 1) {
      act(() => { vi.advanceTimersByTime(NEEDS_QUIET_MS / 3); });
      rail.rerender();
      project.rerender();
    }
    expect(rail.result.current).toMatchObject({ phase: 'complete', count: 12 });
    expect(project.result.current).toMatchObject({ phase: 'complete', count: 0 });
  });
});
