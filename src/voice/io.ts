/**
 * Voice mode's three edges (DES-VOICE §3), each behind a small interface so tests run the whole conversation with
 * a fake audio stream, a stub speech-to-text and a silent speaker:
 *
 *  - {@link MicSource}: the microphone. `getUserMedia` with the browser's echo cancellation, noise suppression and
 *    gain control; an `AnalyserNode` for the waveform; the raw samples for recording. Nothing is recorded to disk:
 *    samples live in page memory until they are sent to crew and are dropped after.
 *  - {@link SttEngine}: speech to text. By default crew's `POST /voice/transcribe` (whisper.cpp on this machine).
 *  - {@link Speaker}: text to speech. By default piper on this machine (crew's `POST /voice/speak`), played with
 *    Web Audio. There is no browser speech-synthesis fallback: read-aloud is local and one voice across the product.
 */

import { speakVoiceText, transcribeWav } from '../api/voice.js';
import { chunksToWav, rms } from './wav.js';

// ── The microphone ──────────────────────────────────────────────────────────────────────────────

export interface MicFrame {
  /** RMS level of this chunk (0..1), for the detector. */
  level: number;
  /** Bar heights for the waveform (0..1 each). */
  bars: number[];
}

export interface MicSource {
  /** Ask for the mic. Rejects with the browser's words when the person or the browser says no. */
  start(onFrame: (f: MicFrame) => void): Promise<void>;
  /** Begin keeping samples (a turn starts). */
  record(): void;
  /** The turn so far, as a 16 kHz WAV (a streaming partial); null when nothing is kept. */
  peek(): Blob | null;
  /** End the turn: its WAV, and the samples are dropped. null when nothing was kept. */
  take(): Blob | null;
  /** Release the mic (the browser's indicator goes off). */
  stop(): void;
  readonly live: boolean;
}

const BARS = 40;

/** The real mic: Web Audio, in page memory only. */
export class BrowserMic implements MicSource {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Float32Array[] | null = null;
  private rate = 48_000;

  get live(): boolean { return this.stream !== null; }

  async start(onFrame: (f: MicFrame) => void): Promise<void> {
    if (this.stream !== null) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.rate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(this.stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    this.analyser = analyser;
    // ScriptProcessor is old but everywhere, and needs no worklet file served next to the bundle.
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    this.proc = proc;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    proc.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      if (this.chunks !== null) this.chunks.push(data);
      analyser.getByteFrequencyData(freq);
      const step = Math.max(1, Math.floor(freq.length / BARS));
      const bars: number[] = [];
      for (let i = 0; i < BARS; i++) bars.push((freq[i * step] ?? 0) / 255);
      onFrame({ level: rms(data), bars });
    };
    src.connect(analyser);
    src.connect(proc);
    // A processor only runs while connected to the output; it writes silence (output buffer untouched).
    proc.connect(ctx.destination);
  }

  record(): void { this.chunks = []; }

  peek(): Blob | null {
    return this.chunks !== null && this.chunks.length > 0 ? chunksToWav(this.chunks, this.rate) : null;
  }

  take(): Blob | null {
    const c = this.chunks;
    this.chunks = null;
    return c !== null && c.length > 0 ? chunksToWav(c, this.rate) : null;
  }

  stop(): void {
    this.chunks = null;
    if (this.proc !== null) this.proc.onaudioprocess = null;
    this.proc?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.stream = null; this.ctx = null; this.proc = null; this.analyser = null;
  }
}

// ── Speech to text ─────────────────────────────────────────────────────────────────────────────

export interface SttEngine {
  transcribe(wav: Blob): Promise<string>;
}

export const crewStt: SttEngine = {
  async transcribe(wav) { return (await transcribeWav(wav)).text; },
};

// ── Text to speech ─────────────────────────────────────────────────────────────────────────────

export interface Speaker {
  /** Say it; resolves when done (or at once when muted or unavailable). */
  say(text: string): Promise<void>;
  /** Stop talking now. */
  cancel(): void;
  readonly available: boolean;
}

/** The seams a {@link PiperSpeaker} stands on, so tests swap the audio context, the fetch and the readiness. */
export interface PiperDeps {
  /** Fetch one sentence's WAV bytes (crew's `POST /voice/speak`), abortable. */
  fetchWav: (text: string, voice: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** The Web Audio context to play through (lazily made in a real browser, injected in tests). */
  ctx: () => AudioContext;
  /** The chosen read-aloud voice, or null when none is chosen. */
  voice: () => string | null;
  /** True only when the engine is installed AND the chosen voice is installed. */
  ready: () => boolean;
}

/** The longest piece handed to `POST /voice/speak` at once (crew refuses an over-long body, `voice_text_invalid`). */
const SAY_CHUNK = 280;

/** Split text into speakable pieces: on sentence ends and newlines, then any over-long piece on whitespace. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?…])\s+|\n+/)) {
    let piece = raw.trim();
    if (piece === '') continue;
    while (piece.length > SAY_CHUNK) {
      // Prefer a space near the limit so a word is never cut; fall back to a hard cut.
      const cut = piece.lastIndexOf(' ', SAY_CHUNK);
      const at = cut > SAY_CHUNK * 0.5 ? cut : SAY_CHUNK;
      out.push(piece.slice(0, at).trim());
      piece = piece.slice(at).trim();
    }
    if (piece !== '') out.push(piece);
  }
  return out;
}

/**
 * Read aloud with piper on this machine: fetch each sentence through `POST /voice/speak` in the chosen voice and play
 * them in order with Web Audio, fetching the NEXT sentence while the current one plays (one request ahead — crew
 * serves one speak at a time, `voice_busy`). `cancel()` stops playback at once and aborts the pending fetch; a
 * cancelled fetch is swallowed. `available` is true only when the engine and the chosen voice are installed.
 */
export class PiperSpeaker implements Speaker {
  private readonly deps: PiperDeps;
  private controller: AbortController | null = null;
  private source: AudioBufferSourceNode | null = null;
  private token = 0;

  constructor(deps: PiperDeps) { this.deps = deps; }

  get available(): boolean { return this.deps.ready() && this.deps.voice() !== null; }

  async say(text: string): Promise<void> {
    const voice = this.deps.voice();
    if (!this.available || voice === null) return;
    const pieces = sentences(text);
    if (pieces.length === 0) return;
    this.cancel();
    const mine = ++this.token;
    const controller = new AbortController();
    this.controller = controller;
    const ctx = this.deps.ctx();
    const fetchAt = (i: number): Promise<ArrayBuffer> | null =>
      i < pieces.length ? this.deps.fetchWav(pieces[i]!, voice, controller.signal) : null;
    let next = fetchAt(0);
    try {
      for (let i = 0; i < pieces.length; i++) {
        const buf = await next;
        if (mine !== this.token) return;
        next = fetchAt(i + 1);
        await this.play(ctx, buf!, mine);
        if (mine !== this.token) return;
      }
    } catch (e) {
      // A barge-in aborts the pending fetch: that is not an error the person sees.
      if (controller.signal.aborted || mine !== this.token) return;
      throw e;
    } finally {
      // Don't leave an aborted fetch unhandled when we bailed out of the loop early.
      if (next !== null) void next.catch(() => undefined);
    }
  }

  private play(ctx: AudioContext, buf: ArrayBuffer, mine: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // decodeAudioData detaches the buffer; a copy keeps the caller's bytes intact if it ever reuses them.
      ctx.decodeAudioData(buf.slice(0)).then((audio) => {
        if (mine !== this.token) { resolve(); return; }
        const src = ctx.createBufferSource();
        src.buffer = audio;
        src.connect(ctx.destination);
        src.onended = () => { if (this.source === src) this.source = null; resolve(); };
        this.source = src;
        src.start();
      }).catch(reject);
    });
  }

  cancel(): void {
    this.token++;
    if (this.controller !== null) { this.controller.abort(); this.controller = null; }
    if (this.source !== null) {
      const src = this.source;
      this.source = null;
      src.onended = null;
      try { src.stop(); } catch { /* not started */ }
      try { src.disconnect(); } catch { /* already gone */ }
    }
  }
}

/** The real speaker: piper through crew, played on a lazily-made, gesture-resumed AudioContext. */
export function browserPiperSpeaker(deps: { voice: () => string | null; ready: () => boolean }): Speaker {
  let ctx: AudioContext | null = null;
  return new PiperSpeaker({
    fetchWav: (text, voice, signal) => speakVoiceText(text, voice, signal),
    ctx: () => {
      ctx ??= new AudioContext();
      // A browser suspends audio until a gesture; voice entry is a click, so a resume here starts cleanly.
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      return ctx;
    },
    voice: deps.voice,
    ready: deps.ready,
  });
}

export const silentSpeaker: Speaker = { available: false, say: () => Promise.resolve(), cancel: () => undefined };
