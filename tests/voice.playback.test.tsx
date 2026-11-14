// Voice playback hardening (the cross-review of wicked-studio#1156): every async voice path settles or aborts what
// it starts, checks the session after each await, pauses the mic for any playback (samples too), never overlaps two
// playbacks, and never lets a speaker refusal replace a chat answer.

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSetup } from '../src/components/voice/VoiceSetup.js';
import { PiperSpeaker, type MicFrame, type MicSource, type PiperDeps } from '../src/voice/io.js';
import {
  answerEntry, chooseMode, closeVoice, consentToModel, consentToVoice, hear, openVoice, playSample, resetVoice, resetVoiceDeps, setVoiceDeps,
} from '../src/voice/controller.js';
import { INITIAL_VOICE, useVoiceStore } from '../src/store/voice.js';
import type { VoiceTtsStatus } from '../src/api/voice.js';

// ── Web Audio fakes ──────────────────────────────────────────────────────────────────────────────

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
  end(): void { this.onended?.(); }
}
class FakeCtx {
  state = 'running';
  sources: FakeSource[] = [];
  get destination(): unknown { return {}; }
  decodeAudioData(buf: ArrayBuffer): Promise<unknown> { return Promise.resolve({ buf }); }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
  resume(): Promise<void> { return Promise.resolve(); }
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class FakeMic implements MicSource {
  live = false;
  async start(cb: (f: MicFrame) => void): Promise<void> { void cb; this.live = true; }
  record(): void { /* no-op */ }
  peek(): Blob | null { return null; }
  take(): Blob | null { return null; }
  stop(): void { /* no-op */ }
}

const JOE = 'en_US-joe-medium';
const CORI = 'en_GB-cori-high';
function tts(over: Partial<VoiceTtsStatus> = {}): VoiceTtsStatus {
  return {
    supported: { ok: true, reason: null },
    python: { found: true, path: '/usr/bin/python3', version: '3.11.4' },
    engine: { found: true, version: '1.8.0' },
    voices: {
      [JOE]: { installed: true, name: 'Joe', accent: 'US English', licence: 'CC0', bytes: 63227449, source: 'Hugging Face rhasspy/piper-voices' },
      [CORI]: { installed: false, name: 'Cori', accent: 'UK English', licence: 'Public domain', bytes: 114224315, source: 'Hugging Face rhasspy/piper-voices' },
    },
    install: null,
    ...over,
  };
}

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

// One context for the file: the controller keeps its sample AudioContext for the page's life.
const ctx = new FakeCtx();
beforeEach(() => {
  ctx.sources = [];
  vi.stubGlobal('AudioContext', function AudioContextStub() { return ctx; });
  useVoiceStore.setState({ ...INITIAL_VOICE });
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  resetVoice();
  resetVoiceDeps();
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── PiperSpeaker ─────────────────────────────────────────────────────────────────────────────────

function piper(fetchWav: PiperDeps['fetchWav'], c: FakeCtx = new FakeCtx()): { speaker: PiperSpeaker; ctx: FakeCtx } {
  const speaker = new PiperSpeaker({ fetchWav, ctx: () => c as unknown as AudioContext, voice: () => JOE, ready: () => true });
  return { speaker, ctx: c };
}

describe('PiperSpeaker: promises it starts', () => {
  it('a prefetch that rejects while the current sentence plays is no unhandled rejection, and say() settles', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      let n = 0;
      const { speaker, ctx: c } = piper(() => (++n === 1 ? Promise.resolve(new ArrayBuffer(8)) : Promise.reject(new Error('voice_busy'))));
      const done = speaker.say('One. Two.');
      const settled = done.then(() => 'ok', (e: Error) => e.message);
      await flush(); await flush();
      expect(c.sources).toHaveLength(1); // sentence 1 is playing while sentence 2's fetch has already rejected
      await flush();
      expect(unhandled).toEqual([]);
      c.sources[0]!.end();
      expect(await settled).toBe('voice_busy'); // reported when the loop reaches it, and say() settled
      await flush();
      expect(unhandled).toEqual([]);
    } finally { process.off('unhandledRejection', onUnhandled); }
  });

  it('a play failure aborts the pending prefetch', async () => {
    const signals: AbortSignal[] = [];
    const { speaker, ctx: c } = piper((_t, _v, s) => {
      signals.push(s);
      return signals.length === 1 ? Promise.resolve(new ArrayBuffer(8)) : new Promise<ArrayBuffer>(() => undefined);
    });
    c.decodeAudioData = () => Promise.reject(new Error('bad wav'));
    await expect(speaker.say('One. Two.')).rejects.toThrow('bad wav');
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(true);
  });
});

// ── Samples ──────────────────────────────────────────────────────────────────────────────────────

describe('Play sample', () => {
  it('closing Voice before the sample response arrives: nothing plays after close', async () => {
    let release: (r: Response) => void = () => undefined;
    // The fetch ignores the abort signal on purpose: the session check after the await must hold on its own.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { release = r; })));
    const p = playSample(JOE);
    await flush();
    closeVoice();
    release(new Response(new ArrayBuffer(8), { status: 200 }));
    await act(async () => { await p; });
    expect(ctx.sources).toHaveLength(0);
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('a playing sample stops on close and its promise settles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    const p = playSample(JOE);
    await flush(); await flush();
    expect(ctx.sources[0]?.started).toBe(true);
    closeVoice();
    await act(async () => { await p; });
    expect(ctx.sources[0]!.stopped).toBe(true);
  });

  it('pauses the mic while it plays and replaces read-aloud instead of overlapping it', async () => {
    const cancels: number[] = [];
    setVoiceDeps({ speaker: { available: true, say: () => new Promise<void>(() => undefined), cancel: () => { cancels.push(1); } } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    chooseMode('stream'); // read-aloud starts speaking
    expect(useVoiceStore.getState().speaking).toBe('it');
    cancels.length = 0;
    const p = playSample(JOE);
    expect(cancels.length).toBeGreaterThan(0); // read-aloud was cancelled before the sample began
    expect(useVoiceStore.getState().speaking).toBe('it');
    for (let i = 0; i < 5; i++) await flush();
    expect(useVoiceStore.getState().speaking).toBe('it'); // still muted while the sample plays
    ctx.sources[0]!.end();
    await act(async () => { await p; });
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('a failed sample lands on its own row and leaves the rows and controls in place', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'no sample', code: 'voice_busy' }, 409)));
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    render(<VoiceSetup />);
    await act(async () => { await playSample(JOE); });
    expect(screen.getByTestId(`voice-tts-row-error-${JOE}`)).toBeTruthy();
    expect(screen.queryByTestId(`voice-tts-row-error-${CORI}`)).toBeNull();
    expect(screen.getByTestId(`voice-tts-sample-${JOE}`)).toBeTruthy(); // retry stays
    expect(screen.getByTestId(`voice-tts-consent-${CORI}`)).toBeTruthy(); // the other row is still there
  });
});

// ── say(): replacement and refusal ───────────────────────────────────────────────────────────────

describe('read-aloud say()', () => {
  it('a new utterance replacing a playing one: the old call’s cleanup does not idle the new one', async () => {
    const pending: Array<() => void> = [];
    setVoiceDeps({
      speaker: {
        available: true,
        // Like PiperSpeaker.say: a new call first cancels the old one, releasing it.
        say: () => { pending.shift()?.(); return new Promise<void>((r) => { pending.push(r); }); },
        cancel: () => { pending.shift()?.(); },
      },
    });
    chooseMode('stream');
    expect(useVoiceStore.getState().speaking).toBe('it');
    chooseMode('space'); // replaces: cancel releases the old say, whose cleanup runs on a later microtask
    await flush();
    expect(useVoiceStore.getState().speaking).toBe('it'); // the new one is still playing
    pending.shift()?.(); // the new utterance ends
    await flush();
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('a /voice/speak refusal after a successful chat answer: the caption stays and a read-aloud note shows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/voice/tts') ? json(tts()) : json({ error: 'Not Found' }, 404))));
    setVoiceDeps({
      mic: () => new FakeMic(),
      speaker: { available: true, say: async (t) => { if (t.startsWith('Two jobs')) throw new Error('voice_busy'); }, cancel: () => undefined },
      ask: async () => 'Two jobs are running.',
      endChat: () => undefined,
    });
    render(<VoiceSetup />);
    await act(async () => { await openVoice(); });
    act(() => { answerEntry(true); });
    await act(async () => { await hear('space bar'); }); // the mode question is answered first
    await act(async () => { await hear('What is running right now?'); });
    const lines = useVoiceStore.getState().lines.map((l) => l.text);
    expect(lines).toContain('Two jobs are running.');
    expect(lines.some((t) => t.includes('couldn’t get an answer'))).toBe(false);
    expect(useVoiceStore.getState().speaking).toBe('idle');
    expect(screen.getByTestId('voice-readaloud-failed')).toBeTruthy();
  });

  it('void say() on a refusal is no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      setVoiceDeps({ speaker: { available: true, say: () => Promise.reject(new Error('voice_busy')), cancel: () => undefined } });
      chooseMode('stream');
      await flush(); await flush();
      expect(unhandled).toEqual([]);
      expect(useVoiceStore.getState().readAloudFailed).toBe(true);
    } finally { process.off('unhandledRejection', onUnhandled); }
  });
});

// ── The install poll ─────────────────────────────────────────────────────────────────────────────

function ttsFetch(seq: VoiceTtsStatus[], post: VoiceTtsStatus = seq[0]!): { calls: () => number } {
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/voice/tts') && init?.method === 'POST') return json(post, 202);
    if (u.endsWith('/voice/tts')) { n += 1; return json(seq[Math.min(n - 1, seq.length - 1)]); }
    return json({ error: 'Not Found' }, 404);
  }));
  return { calls: () => n };
}
const running = (step = 'engine'): VoiceTtsStatus => tts({ install: { state: 'running', step, error: null } });
const installedAll = (): VoiceTtsStatus => {
  const t = tts();
  t.voices[CORI] = { ...t.voices[CORI]!, installed: true };
  return t;
};

describe('the read-aloud install poll', () => {
  beforeEach(() => { setVoiceDeps({ mic: () => new FakeMic(), speaker: { available: false, say: async () => undefined, cancel: () => undefined }, endChat: () => undefined }); });

  it('reopening Voice while crew reports the install running resumes polling until installed', async () => {
    const f = ttsFetch([running(), running(), installedAll()]);
    vi.useFakeTimers();
    await act(async () => { await openVoice(); });
    expect(useVoiceStore.getState().tts?.install?.state).toBe('running');
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(useVoiceStore.getState().tts?.install).toBeNull();
    expect(useVoiceStore.getState().tts?.voices[CORI]?.installed).toBe(true);
    expect(f.calls()).toBe(3);
  });

  it('reopening Voice while the install runs resumes polling until it fails', async () => {
    ttsFetch([running(), tts({ install: { state: 'failed', step: `voice:${CORI}`, error: 'boom' } })]);
    vi.useFakeTimers();
    await act(async () => { await openVoice(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(useVoiceStore.getState().tts?.install?.state).toBe('failed');
  });

  it('does not stop once a voice shows installed while the engine step still runs', async () => {
    const mid = running();
    mid.voices[CORI] = { ...mid.voices[CORI]!, installed: true };
    // POST answers running; polls: running+installed voice, running+installed voice, then settled.
    const f = ttsFetch([mid, mid, installedAll()], running());
    vi.useFakeTimers();
    void consentToVoice(CORI);
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(f.calls()).toBe(3);
    expect(useVoiceStore.getState().tts?.install).toBeNull();
  });

  it('makes no refresh after Voice closes (the generation is checked after the sleep)', async () => {
    const f = ttsFetch([running(), running(), running(), running()]);
    vi.useFakeTimers();
    void consentToVoice(CORI);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    closeVoice();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(f.calls()).toBe(0);
  });

  it('the speech-model poll likewise makes no status read after Voice closes', async () => {
    let reads = 0;
    const model = { local: true, ready: false, engine: { name: 'whisper.cpp', found: true, path: '/x', install: null }, model: { name: 'base.en', present: false, bytes: 0, approxBytes: 1, source: 's', download: { state: 'running', receivedBytes: 0, totalBytes: null, error: null } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/voice/model') && init?.method === 'POST') return json(model, 202);
      if (String(url).endsWith('/voice/status')) { reads += 1; return json(model); }
      return json({ error: 'Not Found' }, 404);
    }));
    vi.useFakeTimers();
    void consentToModel();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    closeVoice();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(reads).toBe(0);
  });
});
