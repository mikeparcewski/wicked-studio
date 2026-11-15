// The voice chat path is session-owned like every other async voice path: a close (or reopen) while the chat is being
// created, or while a message is in flight, leaves nothing behind: no caption, no spoken reply, no reused chat id.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/board/chatOpen.js', async (orig) => ({ ...(await orig<typeof import('../src/board/chatOpen.js')>()), defaultSelection: () => ['claude'] }));
vi.mock('../src/store/rosterCache.js', () => ({ getCachedRoster: () => [], setCachedRoster: () => undefined }));

import { api } from '../src/api/client.js';
import { INITIAL_VOICE, useVoiceStore } from '../src/store/voice.js';
import { useAskThreadStore } from '../src/store/askThread.js';
import type { MicFrame, MicSource } from '../src/voice/io.js';
import { answerEntry, closeVoice, hear, openVoice, resetVoice, resetVoiceDeps, setVoiceDeps } from '../src/voice/controller.js';

class FakeMic implements MicSource {
  live = false;
  async start(cb: (f: MicFrame) => void): Promise<void> { void cb; this.live = true; }
  record(): void { /* no-op */ }
  pause(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  peek(): Blob | null { return null; }
  take(): Blob | null { return null; }
  stop(): void { /* no-op */ }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const opened = { seats: [{ cliKey: 'claude', ok: true }], scope: null } as never;
const said: string[] = [];

/** A full-screen session in space-bar mode, ready for a typed question. */
async function enterVoice(): Promise<void> {
  await act(async () => { await openVoice(); });
  act(() => { answerEntry(true); });
  await act(async () => { await hear('space bar'); });
}

beforeEach(() => {
  said.length = 0;
  useVoiceStore.setState({ ...INITIAL_VOICE });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })));
  vi.spyOn(api, 'endChat').mockResolvedValue({} as never);
  vi.spyOn(api, 'closeChat').mockResolvedValue({} as never);
  setVoiceDeps({ mic: () => new FakeMic(), speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined } });
});
afterEach(() => {
  resetVoice();
  resetVoiceDeps();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('voice chat: session ownership', () => {
  it('close while the chat is being created: the late chat is stopped, nothing is written, the next session opens its own', async () => {
    let releaseOpen: (v: never) => void = () => undefined;
    const open = vi.spyOn(api, 'openChat').mockImplementationOnce(() => new Promise((r) => { releaseOpen = r as never; }));
    const send = vi.spyOn(api, 'sendChatMessage').mockResolvedValue({ turnId: 't1' } as never);
    await enterVoice();
    const asked = hear('What is running right now?');
    await flush(); await flush();
    expect(open).toHaveBeenCalledTimes(1);
    const staleId = (open.mock.calls[0]![0] as { chatId: string }).chatId;
    act(() => { closeVoice(); });
    releaseOpen(opened);
    await act(async () => { await asked; });
    expect(send).not.toHaveBeenCalled(); // the created chat was never used
    expect(api.endChat).toHaveBeenCalledWith(staleId); // and is stopped
    expect(useVoiceStore.getState().lines).toEqual([]);
    expect(said.filter((t) => t.includes('answer'))).toEqual([]);

    // The next session opens its own chat, not the stale one.
    open.mockResolvedValue(opened);
    await enterVoice();
    const second = hear('What is running right now?');
    await flush(); await flush();
    expect(open).toHaveBeenCalledTimes(2);
    const freshId = (open.mock.calls[1]![0] as { chatId: string }).chatId;
    expect(freshId).not.toBe(staleId);
    expect(send).toHaveBeenCalledWith(freshId, 'What is running right now?');
    act(() => { closeVoice(); });
    await act(async () => { await second; });
  });

  it('close during a pending send: no caption or spoken reply lands, even in a reopened session', async () => {
    let releaseSend: (v: never) => void = () => undefined;
    vi.spyOn(api, 'openChat').mockResolvedValue(opened);
    const send = vi.spyOn(api, 'sendChatMessage').mockImplementationOnce(() => new Promise((r) => { releaseSend = r as never; }));
    await enterVoice();
    const asked = hear('What is running right now?');
    await flush(); await flush();
    expect(send).toHaveBeenCalledTimes(1);
    const chat = send.mock.calls[0]![0];
    act(() => { closeVoice(); });
    await enterVoice(); // a new session, while the old send is still in flight
    releaseSend({ turnId: 't1' } as never);
    await act(async () => { await asked; });
    act(() => { useAskThreadStore.getState().ingest({ type: 'chatReply', chat, cliKey: 'claude', text: 'Two jobs are running.', ok: true, turn_id: 't1' } as never); });
    await flush();
    expect(useVoiceStore.getState().lines.map((l) => l.text)).not.toContain('Two jobs are running.');
    expect(useVoiceStore.getState().lines.some((l) => l.partial === true && l.who === 'it')).toBe(false);
    expect(said).not.toContain('Two jobs are running.');
  });

  it('close while a question awaits its reply: it ends at once and never speaks', async () => {
    vi.spyOn(api, 'openChat').mockResolvedValue(opened);
    vi.spyOn(api, 'sendChatMessage').mockResolvedValue({ turnId: 't1' } as never);
    await enterVoice();
    const asked = hear('What is running right now?');
    await flush(); await flush(); await flush();
    act(() => { closeVoice(); });
    const settled = await Promise.race([asked.then(() => true), new Promise<boolean>((r) => { setTimeout(() => { r(false); }, 200); })]);
    expect(settled).toBe(true);
    expect(said.filter((t) => t.includes('couldn’t get an answer'))).toEqual([]);
  });
});
