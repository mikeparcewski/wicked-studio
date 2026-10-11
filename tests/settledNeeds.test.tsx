// studio#723 (Desk count on reload) + studio#684 comment (badge on a failed read): the needs count
// never shows a number that is still moving, and a failed runs read never changes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { NeedRow } from '../src/board/needsYou.js';
import { NEEDS_QUIET_MS, resetSettledNeedsForTest, useSettledNeeds } from '../src/hooks/useNeedsRows.js';
import { useNeedsSources } from '../src/store/needsSources.js';

const rows = (n: number): NeedRow[] => Array.from({ length: n }, (_, i) => ({ key: `r${i}` }) as unknown as NeedRow);

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
});
