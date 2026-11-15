// Voice playback hardening (the cross-review of wicked-studio#1156): every async voice path settles or aborts what
// it starts, checks the session after each await, pauses the mic for any playback (samples too), never overlaps two
// playbacks, and never lets a speaker refusal replace a chat answer.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSetup } from '../src/components/voice/VoiceSetup.js';
import { PiperSpeaker, type MicFrame, type MicSource, type PiperDeps } from '../src/voice/io.js';
import {
  answerEntry, chooseMode, chooseVoice, closeVoice, consentToModel, consentToVoice, hear, openVoice, playSample, refreshTts, resetVoice, resetVoiceDeps, setReadAloud, setVoiceDeps,
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
  paused = false;
  recorded = 0;
  stopped = 0;
  /** Give peek() a recording to return, so a streaming partial has something to transcribe. */
  hasAudio = false;
  onFrame: (f: MicFrame) => void = () => undefined;
  async start(cb: (f: MicFrame) => void): Promise<void> { this.onFrame = cb; this.live = true; }
  record(): void { this.recorded += 1; }
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  peek(): Blob | null { return this.hasAudio ? new Blob(['x']) : null; }
  take(): Blob | null { return null; }
  stop(): void { this.stopped += 1; }
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
  it('a cancelled utterance’s late decode failure does not stop the replacement’s source', async () => {
    const c = new FakeCtx();
    let failFirst: (e: Error) => void = () => undefined;
    let n = 0;
    c.decodeAudioData = (buf: ArrayBuffer) => (++n === 1 ? new Promise((_r, rej) => { failFirst = rej; }) : Promise.resolve({ buf }));
    const { speaker } = piper(() => Promise.resolve(new ArrayBuffer(8)), c);
    const first = speaker.say('One.').catch(() => undefined);
    await flush();
    const second = speaker.say('Two.'); // cancels the first while its decode is pending
    await flush(); await flush();
    expect(c.sources).toHaveLength(1);
    failFirst(new Error('late decode failure'));
    await flush();
    await first;
    expect(c.sources[0]!.stopped).toBe(false);
    c.sources[0]!.end();
    await second;
  });

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

// ── The class sweep (VD2r3): playback ownership and session ownership ─────────────────────────────

/** Resolves true when `p` settles within `ms`, false when it is still pending (a hung await). */
const settles = (p: Promise<unknown>, ms = 200): Promise<boolean> =>
  Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => { setTimeout(() => { r(false); }, ms); })]);
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

describe('Play sample: a stop settles it whichever step it waits in', () => {
  const realResume = ctx.resume.bind(ctx);
  const realDecode = ctx.decodeAudioData.bind(ctx);
  afterEach(() => { ctx.state = 'running'; ctx.resume = realResume; ctx.decodeAudioData = realDecode; });

  it('close during the fetch: the promise settles and nothing plays, even when the fetch ignores the abort', async () => {
    vi.stubGlobal('fetch', vi.fn(() => never<Response>()));
    const p = playSample(JOE);
    await flush();
    closeVoice();
    expect(await settles(p)).toBe(true);
    expect(ctx.sources).toHaveLength(0);
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('close during the audio-context resume: the promise settles and nothing plays', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    ctx.state = 'suspended';
    ctx.resume = () => never<void>();
    const p = playSample(JOE);
    await flush(); await flush();
    closeVoice();
    expect(await settles(p)).toBe(true);
    expect(ctx.sources).toHaveLength(0);
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('close during the decode: the promise settles and nothing plays', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    ctx.decodeAudioData = () => never<unknown>();
    const p = playSample(JOE);
    await flush(); await flush();
    closeVoice();
    expect(await settles(p)).toBe(true);
    expect(ctx.sources).toHaveLength(0);
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('read-aloud turned off during the decode settles it and leaves no speaking state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })));
    ctx.decodeAudioData = () => never<unknown>();
    const p = playSample(JOE);
    await flush(); await flush();
    setReadAloud(false);
    expect(await settles(p)).toBe(true);
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });
});

describe('read-aloud off during say(), then a late rejection', () => {
  it('a deliberate stop takes playback over: the late refusal sets no failure and leaves nothing speaking', async () => {
    let rejectSay: (e: Error) => void = () => undefined;
    setVoiceDeps({ speaker: { available: true, say: () => new Promise<void>((_, rej) => { rejectSay = rej; }), cancel: () => undefined } });
    chooseMode('stream');
    expect(useVoiceStore.getState().speaking).toBe('it');
    setReadAloud(false);
    expect(useVoiceStore.getState().speaking).toBe('idle');
    rejectSay(new Error('voice_busy')); // the stopped playback settles late
    await flush(); await flush();
    expect(useVoiceStore.getState().readAloudFailed).toBe(false);
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });

  it('a late rejection from a sample that was stopped sets no row error', async () => {
    let rejectFetch: (e: Error) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_, rej) => { rejectFetch = rej; })));
    useVoiceStore.setState({ tts: tts(), readAloud: true });
    const p = playSample(JOE);
    await flush();
    setReadAloud(false);
    rejectFetch(new Error('late'));
    await act(async () => { await p; });
    expect(useVoiceStore.getState().ttsActionError).toBeNull();
    expect(useVoiceStore.getState().speaking).toBe('idle');
  });
});

describe('a sample while the mic is recording', () => {
  it('pauses the recorder and the partial transcription (not only a flag), and resumes both after', async () => {
    vi.useFakeTimers();
    const fake = new FakeMic();
    let t = 0;
    const transcribe = vi.fn(async () => 'hello');
    setVoiceDeps({ mic: () => fake, stt: { transcribe }, now: () => t, speaker: { available: false, say: async () => undefined, cancel: () => undefined }, endChat: () => undefined });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/tts/sample/') ? new Response(new ArrayBuffer(8), { status: 200 }) : json({ error: 'Not Found' }, 404))));
    await act(async () => { await openVoice(); });
    useVoiceStore.setState({ status: { local: true, ready: true } as never });
    act(() => { answerEntry(true); });
    act(() => { chooseMode('stream'); });
    fake.hasAudio = true;
    // The person starts talking: the detector starts a turn and the recorder runs.
    act(() => { fake.onFrame({ level: 0.5, bars: [] }); });
    t = 300;
    act(() => { fake.onFrame({ level: 0.5, bars: [] }); });
    expect(fake.recorded).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    const before = transcribe.mock.calls.length;
    expect(before).toBeGreaterThan(0); // partials run while recording

    const p = playSample(JOE);
    expect(fake.paused).toBe(true); // the recorder itself, not a flag
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(transcribe.mock.calls.length).toBe(before); // and no partial is made of the sample

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    ctx.sources[0]!.end();
    await act(async () => { await p; });
    expect(fake.paused).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(transcribe.mock.calls.length).toBeGreaterThan(before); // partials resume
  });
});

describe('closing during openVoice, and a reopen with a stale open still pending', () => {
  const statusBody = { local: true, ready: false, engine: { name: 'whisper.cpp', found: true, path: '/x', install: null }, model: { name: 'base.en', present: true, bytes: 1, approxBytes: 1, source: 's', download: null } };

  it('a close during the status read: the stale open writes nothing, starts no mic, no poll, says nothing', async () => {
    let releaseStatus: (r: Response) => void = () => undefined;
    let ttsReads = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u.endsWith('/voice/status')) return new Promise<Response>((r) => { releaseStatus = r; });
      if (u.endsWith('/voice/tts')) { ttsReads += 1; return Promise.resolve(json(running())); }
      return Promise.resolve(json({ error: 'Not Found' }, 404));
    }));
    const mics: FakeMic[] = [];
    const said: string[] = [];
    setVoiceDeps({ mic: () => { const m = new FakeMic(); mics.push(m); return m; }, speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined }, endChat: () => undefined });
    const open = openVoice();
    await flush();
    closeVoice();
    releaseStatus(json(statusBody));
    await act(async () => { await open; });
    expect(useVoiceStore.getState().status).toBeNull();
    expect(useVoiceStore.getState().phase).toBe('off');
    expect(mics).toHaveLength(0);
    expect(ttsReads).toBe(0);
    expect(said).toEqual([]);
  });

  it('a close while the browser asks for the mic: the late mic is released and nothing is asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/voice/status') ? json(statusBody) : String(url).endsWith('/voice/tts') ? json(tts()) : json({ error: 'Not Found' }, 404))));
    let releaseMic: () => void = () => undefined;
    const fake = new FakeMic();
    fake.start = () => new Promise<void>((r) => { releaseMic = r; });
    const said: string[] = [];
    setVoiceDeps({ mic: () => fake, speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined }, endChat: () => undefined });
    const open = openVoice();
    await flush(); await flush();
    closeVoice();
    releaseMic();
    await act(async () => { await open; });
    expect(fake.stopped).toBeGreaterThan(0);
    expect(useVoiceStore.getState().micOn).toBe(false);
    expect(said).toEqual([]);
  });

  it('a reopen with the first open still pending: only the new session asks its question', async () => {
    const releases: Array<(r: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u.endsWith('/voice/status')) {
        if (releases.length === 0) return new Promise<Response>((r) => { releases.push(r); });
        return Promise.resolve(json(statusBody));
      }
      if (u.endsWith('/voice/tts')) return Promise.resolve(json(tts()));
      return Promise.resolve(json({ error: 'Not Found' }, 404));
    }));
    const said: string[] = [];
    setVoiceDeps({ mic: () => new FakeMic(), speaker: { available: true, say: async (t) => { said.push(t); }, cancel: () => undefined }, endChat: () => undefined });
    const stale = openVoice();
    await flush();
    closeVoice();
    await act(async () => { await openVoice(); });
    expect(said.filter((t) => t === 'Do you want to enter voice mode?')).toHaveLength(1);
    releases[0]!(json({ ...statusBody, ready: true }));
    await act(async () => { await stale; });
    expect(said.filter((t) => t === 'Do you want to enter voice mode?')).toHaveLength(1); // the stale open said nothing
    expect(useVoiceStore.getState().status?.ready).toBe(false); // and wrote nothing over the new session
  });

  it('consentToModel: a close while the download request is pending writes no status and starts no poll', async () => {
    let releasePost: (r: Response) => void = () => undefined;
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/voice/model') && init?.method === 'POST') return new Promise<Response>((r) => { releasePost = r; });
      if (u.endsWith('/voice/status')) { reads += 1; return Promise.resolve(json(statusBody)); }
      return Promise.resolve(json({ error: 'Not Found' }, 404));
    }));
    vi.useFakeTimers();
    const p = consentToModel();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    closeVoice();
    releasePost(json({ ...statusBody, model: { ...statusBody.model, present: false } }, 202));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await p; });
    expect(useVoiceStore.getState().status).toBeNull();
    expect(reads).toBe(0);
  });
});

describe('the voice row when the engine step failed after the voice installed', () => {
  const failedEngine = (): VoiceTtsStatus => tts({ engine: { found: false, version: null } as never, install: { state: 'failed', step: 'engine', error: 'pip failed' } });

  it('offers an install retry on that row with its own error, and cannot play a sample', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/voice/tts') && init?.method === 'POST') return json(running(), 202);
      return json({ error: 'Not Found' }, 404);
    });
    vi.stubGlobal('fetch', f);
    useVoiceStore.setState({ tts: failedEngine(), readAloud: true });
    render(<VoiceSetup />);
    const row = screen.getByTestId(`voice-tts-voice-${JOE}`);
    expect(row.querySelector(`[data-testid="voice-tts-row-install-failed-${JOE}"]`)).not.toBeNull();
    expect((screen.getByTestId(`voice-tts-sample-${JOE}`) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByTestId(`voice-tts-install-${JOE}`)); await flush(); });
    const post = f.mock.calls.find(([u, i]) => String(u).endsWith('/voice/tts') && (i as RequestInit | undefined)?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ consent: true, voices: [JOE] });
  });

  it('Play sample is disabled while an install runs, and enabled once the engine is there', () => {
    useVoiceStore.setState({ tts: running(), readAloud: true });
    const { rerender } = render(<VoiceSetup />);
    expect((screen.getByTestId(`voice-tts-sample-${JOE}`) as HTMLButtonElement).disabled).toBe(true);
    act(() => { useVoiceStore.setState({ tts: tts() }); });
    rerender(<VoiceSetup />);
    expect((screen.getByTestId(`voice-tts-sample-${JOE}`) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('the read-aloud retry', () => {
  it('clears the failure banner and speaks the failed reply again', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/voice/tts') ? json(tts()) : json({ error: 'Not Found' }, 404))));
    const spoken: string[] = [];
    let fail = true;
    setVoiceDeps({
      mic: () => new FakeMic(),
      speaker: { available: true, say: async (t) => { spoken.push(t); if (fail && t.startsWith('Two jobs')) throw new Error('voice_busy'); }, cancel: () => undefined },
      ask: async () => 'Two jobs are running.',
      endChat: () => undefined,
    });
    render(<VoiceSetup />);
    await act(async () => { await openVoice(); });
    act(() => { answerEntry(true); });
    await act(async () => { await hear('space bar'); });
    await act(async () => { await hear('What is running right now?'); });
    expect(screen.getByTestId('voice-readaloud-failed')).toBeTruthy();
    fail = false;
    await act(async () => { fireEvent.click(screen.getByTestId('voice-readaloud-retry')); await flush(); await flush(); });
    expect(screen.queryByTestId('voice-readaloud-failed')).toBeNull();
    expect(useVoiceStore.getState().readAloudFailed).toBe(false);
    expect(spoken.filter((t) => t === 'Two jobs are running.')).toHaveLength(2);
  });
});

describe('the "needs setup" note follows the real state', () => {
  it('is set while the speaker cannot speak, and cleared when the voice choice makes it able to', async () => {
    const speaker = { available: false, say: async () => undefined, cancel: () => undefined };
    setVoiceDeps({ speaker });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/voice/tts') ? json(tts()) : json({ error: 'Not Found' }, 404))));
    useVoiceStore.setState({ readAloud: true });
    await act(async () => { await refreshTts(); });
    expect(useVoiceStore.getState().readAloudNeedsSetup).toBe(true);
    speaker.available = true;
    act(() => { chooseVoice(JOE); });
    expect(useVoiceStore.getState().readAloudNeedsSetup).toBe(false);
    speaker.available = false;
    act(() => { chooseVoice(JOE); });
    expect(useVoiceStore.getState().readAloudNeedsSetup).toBe(true); // not cleared just because a voice was picked
  });
});
