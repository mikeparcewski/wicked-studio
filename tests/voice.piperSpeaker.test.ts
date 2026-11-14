import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PiperSpeaker, sentences, type PiperDeps } from '../src/voice/io.js';

// ── A fake Web Audio context whose sources end only when the test releases them ──────────────────

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
  /** The test "plays through" one sentence. */
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

interface Harness {
  speaker: PiperSpeaker;
  ctx: FakeCtx;
  fetched: string[];
  signals: AbortSignal[];
}

function make(opts: { ready?: boolean; voice?: string | null } = {}): Harness {
  const ctx = new FakeCtx();
  const fetched: string[] = [];
  const signals: AbortSignal[] = [];
  const deps: PiperDeps = {
    fetchWav: (text, _voice, signal) => { fetched.push(text); signals.push(signal); return Promise.resolve(new ArrayBuffer(8)); },
    ctx: () => ctx as unknown as AudioContext,
    voice: () => (opts.voice === undefined ? 'en_US-joe-medium' : opts.voice),
    ready: () => opts.ready ?? true,
  };
  return { speaker: new PiperSpeaker(deps), ctx, fetched, signals };
}

describe('sentences()', () => {
  it('splits on sentence ends and newlines, dropping empties', () => {
    expect(sentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
    expect(sentences('a\n\nb')).toEqual(['a', 'b']);
    expect(sentences('   ')).toEqual([]);
  });

  it('chunks an over-long sentence so no piece exceeds the speak limit', () => {
    const long = 'word '.repeat(120).trim(); // ~600 chars, no sentence end
    const pieces = sentences(long);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(280);
  });
});

describe('PiperSpeaker', () => {
  it('plays the sentences in order', async () => {
    const h = make();
    const done = h.speaker.say('One. Two. Three.');
    await flush();
    expect(h.fetched.slice(0, 2)).toEqual(['One.', 'Two.']); // first two in order (one ahead)
    h.ctx.sources[0]!.end(); await flush();
    h.ctx.sources[1]!.end(); await flush();
    h.ctx.sources[2]!.end(); await flush();
    await done;
    expect(h.fetched).toEqual(['One.', 'Two.', 'Three.']);
    expect(h.ctx.sources.map((s) => s.started)).toEqual([true, true, true]);
  });

  it('fetches the next sentence while one plays, but not the one after', async () => {
    const h = make();
    void h.speaker.say('One. Two. Three.');
    await flush();
    // While sentence 1 is still playing: sentence 2 is already fetched, sentence 3 is not.
    expect(h.fetched).toEqual(['One.', 'Two.']);
    expect(h.ctx.sources.length).toBe(1);
    h.ctx.sources[0]!.end(); await flush();
    expect(h.fetched).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('cancel stops playback, aborts the pending fetch and resolves the say', async () => {
    const h = make();
    const done = h.speaker.say('One. Two. Three.');
    await flush();
    expect(h.ctx.sources[0]!.started).toBe(true);
    h.speaker.cancel();
    await done; // resolves without needing any sentence to finish
    expect(h.ctx.sources[0]!.stopped).toBe(true);
    expect(h.signals.some((s) => s.aborted)).toBe(true);
    const after = h.fetched.length;
    await flush();
    expect(h.fetched.length).toBe(after); // no further fetches after cancel
  });

  it('is unavailable when the engine is not ready, the voice is missing, or none is chosen', () => {
    expect(make({ ready: true, voice: 'en_US-joe-medium' }).speaker.available).toBe(true);
    expect(make({ ready: false, voice: 'en_US-joe-medium' }).speaker.available).toBe(false);
    expect(make({ ready: true, voice: null }).speaker.available).toBe(false);
  });

  it('says nothing (no fetch) when unavailable', async () => {
    const h = make({ ready: false });
    await h.speaker.say('One.');
    expect(h.fetched).toEqual([]);
  });
});

describe('no browser speech-synthesis anywhere under src/', () => {
  it('src/ has no speechSynthesis or SpeechSynthesisUtterance reference', () => {
    const root = join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(p, 'utf8');
        if (/speechSynthesis|SpeechSynthesisUtterance/.test(text)) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
