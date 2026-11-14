import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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

  it('keeps an abbreviation and a decimal in one sentence, and splits two plain sentences in order', () => {
    // Intl.Segmenter handles the decimal; the abbreviation "Dr." is merged back so it does not split.
    expect(sentences('Dr. Smith paid 3.5 dollars.')).toEqual(['Dr. Smith paid 3.5 dollars.']);
    expect(sentences('The cat slept. The dog barked.')).toEqual(['The cat slept.', 'The dog barked.']);
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

  it('cancel aborts a STILL-PENDING prefetch, settles say, and raises no unhandled rejection', async () => {
    // Done-when 1 (barge-in): the previous cancel test used an immediate fetch, so no fetch was ever in
    // flight at cancel time. Here the next sentence's fetch stays pending and only settles when its signal
    // aborts — so the assertions actually exercise "abort the pending fetch". A PiperSpeaker that does NOT
    // abort its pending fetch fails `signals[1].aborted`; one that leaks the rejection fails `unhandled`.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const ctx = new FakeCtx();
      const signals: AbortSignal[] = [];
      let pendingRejected = false;
      const fetchWav = (text: string, _voice: string, signal: AbortSignal): Promise<ArrayBuffer> => {
        signals.push(signal);
        // Sentence 1 resolves at once so playback starts; sentence 2 stays pending until its signal aborts.
        if (text === 'One.') return Promise.resolve(new ArrayBuffer(8));
        return new Promise<ArrayBuffer>((_resolve, reject) => {
          signal.addEventListener('abort', () => { pendingRejected = true; reject(new DOMException('aborted', 'AbortError')); });
        });
      };
      const deps: PiperDeps = {
        fetchWav,
        ctx: () => ctx as unknown as AudioContext,
        voice: () => 'en_US-joe-medium',
        ready: () => true,
      };
      const speaker = new PiperSpeaker(deps);
      const done = speaker.say('One. Two.');
      await flush();
      // Sentence 1 is playing; sentence 2's fetch is in flight and NOT yet settled or aborted.
      expect(ctx.sources.length).toBe(1);
      expect(ctx.sources[0]!.started).toBe(true);
      expect(signals.length).toBe(2);
      expect(signals[1]!.aborted).toBe(false);
      expect(pendingRejected).toBe(false);

      speaker.cancel();
      await done; // settles without any sentence finishing

      // The pending prefetch's signal is aborted and its promise has settled (rejected).
      expect(signals[1]!.aborted).toBe(true);
      expect(pendingRejected).toBe(true);
      // Nothing plays after cancel: sentence 1's source is stopped and no source was made for sentence 2.
      expect(ctx.sources[0]!.stopped).toBe(true);
      expect(ctx.sources.length).toBe(1);

      // Give any leaked rejection a chance to surface before asserting there is none.
      await flush(); await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
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
    // Node >= 22: readdirSync walks the tree itself (recursive + withFileTypes).
    for (const ent of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (ent.isDirectory()) continue;
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      const p = join(ent.parentPath, ent.name);
      if (/speechSynthesis|SpeechSynthesisUtterance/.test(readFileSync(p, 'utf8'))) offenders.push(p);
    }
    expect(offenders).toEqual([]);
  });
});
