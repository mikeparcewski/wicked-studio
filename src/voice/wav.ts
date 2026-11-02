/**
 * Recording to WAV, in the browser (DES-VOICE §3): the mic's float samples, resampled to 16 kHz mono and written as
 * a 16-bit PCM WAV, the shape crew's whisper.cpp reads on stdin. Pure, so a fake audio stream tests it.
 */

export const TARGET_RATE = 16_000;

/** Join captured chunks into one buffer. */
export function concat(chunks: readonly Float32Array[]): Float32Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Resample by averaging (input rate ≥ 16 kHz) or linear interpolation (below). */
export function resample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const start = i * ratio;
    if (ratio >= 1) {
      const a = Math.floor(start);
      const b = Math.min(input.length, Math.floor(start + ratio));
      let sum = 0;
      for (let j = a; j < b; j++) sum += input[j] ?? 0;
      out[i] = b > a ? sum / (b - a) : input[a] ?? 0;
    } else {
      const a = Math.floor(start);
      const t = start - a;
      out[i] = (input[a] ?? 0) * (1 - t) + (input[Math.min(a + 1, input.length - 1)] ?? 0) * t;
    }
  }
  return out;
}

/** A 16-bit mono PCM WAV of `samples` at `rate`. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Captured chunks at `rate` → a 16 kHz WAV blob. */
export function chunksToWav(chunks: readonly Float32Array[], rate: number): Blob {
  return new Blob([encodeWav(resample(concat(chunks), rate))], { type: 'audio/wav' });
}

/** Root-mean-square level of one chunk (0..1). */
export function rms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < chunk.length; i++) { const x = chunk[i] ?? 0; s += x * x; }
  return Math.sqrt(s / chunk.length);
}
