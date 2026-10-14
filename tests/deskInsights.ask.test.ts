import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { open: unknown[]; send: unknown[]; close: unknown[] } = { open: [], send: [], close: [] };
vi.mock('../src/api/client.js', () => ({
  api: {
    getRoster: vi.fn(async () => ({ roster: [] })),
    openChat: vi.fn(async (b: unknown) => { calls.open.push(b); return { seats: [{ cliKey: 'claude', ok: true }], scope: null }; }),
    sendChatMessage: vi.fn(async (id: string, text: string) => { calls.send.push({ id, text }); return { turnId: 't1' }; }),
    closeChat: vi.fn(async (id: string) => { calls.close.push(id); return { ok: true }; }),
  },
  apiBase: () => 'http://127.0.0.1:7701/api/v1',
}));
vi.mock('../src/board/chatOpen.js', () => ({ defaultSelection: () => ['claude', 'codex'] }));
vi.mock('../src/store/rosterCache.js', () => ({ getCachedRoster: () => [], setCachedRoster: () => undefined }));

import { generateInsights, INSIGHT_TIMEOUT_MS, resetDeskInsights, useDeskInsights } from '../src/hooks/useDeskInsights.js';
import { useAskThreadStore } from '../src/store/askThread.js';
import { renderHook, act, cleanup } from '@testing-library/react';

describe('Generate insights rides the existing Ask path', () => {
  beforeEach(() => { calls.open = []; calls.send = []; calls.close = []; resetDeskInsights(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('opens a system-scoped chat on one seat, sends the prompt once, shows the streamed then final reply, closes the chat', async () => {
    const { result } = renderHook(() => useDeskInsights('k1'));
    expect(result.current.phase).toBe('idle');
    await act(async () => { await generateInsights('k1', 'Compare these agents'); });
    const open = calls.open[0] as { chatId: string; scopeKind: string; clis: string[] };
    expect(open.scopeKind).toBe('system');
    expect(open.clis).toEqual(['claude']);
    expect(calls.send).toEqual([{ id: open.chatId, text: 'Compare these agents' }]);
    expect(result.current.phase).toBe('loading');
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: open.chatId, cliKey: 'claude', text: 'Claude does most', turn_id: 't1' } as never); });
    expect(result.current.phase).toBe('loading');
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: open.chatId, cliKey: 'claude', text: 'Claude does most of the work.', ok: true, turn_id: 't1' } as never); });
    expect(result.current.phase).toBe('done');
    expect(result.current.phase === 'done' && result.current.text).toContain('most of the work');
    expect(calls.close).toEqual([open.chatId]);
  });

  it('says why when no agent can answer, and never sends', async () => {
    const mod = await import('../src/board/chatOpen.js');
    vi.spyOn(mod, 'defaultSelection').mockReturnValue([]);
    const { result } = renderHook(() => useDeskInsights('k2'));
    await act(async () => { await generateInsights('k2', 'x'); });
    expect(result.current.phase).toBe('error');
    expect(calls.send).toEqual([]);
  });

  it('returns the cached result for the same key on remount without opening another chat', async () => {
    const first = renderHook(() => useDeskInsights('k1'));
    await act(async () => { await generateInsights('k1', 'Compare these agents'); });
    const { chatId } = calls.open[0] as { chatId: string };
    act(() => {
      useAskThreadStore.getState().ingest({ type: 'chatReply', chat: chatId, cliKey: 'claude', text: 'Cached comparison.', ok: true, turn_id: 't1' } as never);
    });
    expect(first.result.current).toMatchObject({ phase: 'done', text: 'Cached comparison.' });
    const cached = first.result.current;
    first.unmount();
    const second = renderHook(() => useDeskInsights('k1'));
    expect(second.result.current).toEqual(cached);
    const different = renderHook(() => useDeskInsights('k2'));
    expect(different.result.current).toEqual({ phase: 'idle' });
    expect(calls.open).toHaveLength(1);
    expect(calls.send).toHaveLength(1);
    expect(calls.close).toEqual([chatId]);
  });

  it('times out an unanswered chat, shows an error and closes it', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDeskInsights('timeout'));
    await act(async () => { await generateInsights('timeout', 'Compare these agents'); });
    const { chatId } = calls.open[0] as { chatId: string };
    await act(async () => { await vi.advanceTimersByTimeAsync(INSIGHT_TIMEOUT_MS - 1); });
    expect(result.current.phase).toBe('loading');
    expect(calls.close).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toEqual({ phase: 'error', error: 'No answer after 3 minutes. Try again.' });
    expect(calls.close).toEqual([chatId]);
    act(() => {
      useAskThreadStore.getState().ingest({ type: 'chatReply', chat: chatId, cliKey: 'claude', text: 'Too late.', ok: true, turn_id: 't1' } as never);
    });
    expect(result.current.phase).toBe('error');
    expect(calls.close).toHaveLength(1);
  });

  it('times out while the chat is still opening: never sends, and closes the chat that opens late', async () => {
    vi.useFakeTimers();
    const { api } = await import('../src/api/client.js');
    let release: (v: unknown) => void = () => undefined;
    vi.mocked(api.openChat).mockImplementationOnce((b: unknown) => { calls.open.push(b); return new Promise((r) => { release = r; }) as never; });
    const { result } = renderHook(() => useDeskInsights('k-stall'));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => { pending = generateInsights('k-stall', 'x'); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(INSIGHT_TIMEOUT_MS + 1); });
    expect(result.current.phase).toBe('error');
    const id = (calls.open[0] as { chatId: string }).chatId;
    await act(async () => { release({ seats: [{ cliKey: 'claude', ok: true }], scope: null }); await pending; });
    expect(calls.send).toEqual([]);
    expect(calls.close).toContain(id);
    expect(result.current.phase).toBe('error');
  });

  it('a newer request for the same key wins over an older one that answers late', async () => {
    const { result } = renderHook(() => useDeskInsights('k-race'));
    await act(async () => { await generateInsights('k-race', 'first'); });
    const first = (calls.open[0] as { chatId: string }).chatId;
    await act(async () => { await generateInsights('k-race', 'second'); });
    const second = (calls.open[1] as { chatId: string }).chatId;
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: second, cliKey: 'claude', text: 'second answer', ok: true, turn_id: 't2' } as never); });
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat: first, cliKey: 'claude', text: 'first answer', ok: true, turn_id: 't1' } as never); });
    expect(result.current.phase === 'done' && result.current.text).toBe('second answer');
  });
});
