/**
 * Voice mode's three edges (DES-VOICE §3), each behind a small interface so tests run the whole conversation with
 * a fake audio stream, a stub speech-to-text and a silent speaker:
 *
 *  - {@link MicSource}: the microphone. `getUserMedia` with the browser's echo cancellation, noise suppression and
 *    gain control; an `AnalyserNode` for the waveform; the raw samples for recording. Nothing is recorded to disk:
 *    samples live in page memory until they are sent to crew and are dropped after.
 *  - {@link SttEngine}: speech to text. By default crew's `POST /voice/transcribe` (whisper.cpp on this machine).
 *  - {@link Speaker}: text to speech. By default the browser's `speechSynthesis` (the OS voices).
 */

import { transcribeWav } from '../api/voice.js';
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

export class BrowserSpeaker implements Speaker {
  get available(): boolean { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

  say(text: string): Promise<void> {
    if (!this.available || text.trim() === '') return Promise.resolve();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
      // Some browsers drop `end`; never wait forever.
      setTimeout(resolve, Math.min(30_000, 1500 + text.length * 80));
    });
  }

  cancel(): void { if (this.available) window.speechSynthesis.cancel(); }
}

export const silentSpeaker: Speaker = { available: false, say: () => Promise.resolve(), cancel: () => undefined };
