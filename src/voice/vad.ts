/**
 * When is the person speaking? A small energy detector for STREAMING mode (DES-VOICE §2a: "Wren answers when you
 * pause"): speech starts after the level stays over the threshold for a moment, and ends after a pause. Pure: it
 * is fed levels and times, so tests drive it with a fake stream.
 */

export interface VadOptions {
  /** RMS over this is speech. */
  threshold: number;
  /** Speech must last this long before it counts (a click or a cough is not a turn). */
  startMs: number;
  /** Quiet this long ends the turn. */
  endMs: number;
}

export const VAD_DEFAULTS: VadOptions = { threshold: 0.02, startMs: 120, endMs: 900 };

export type VadEvent = 'start' | 'end' | null;

export class Vad {
  private speaking = false;
  private loudSince: number | null = null;
  private quietSince: number | null = null;

  constructor(private readonly o: VadOptions = VAD_DEFAULTS) {}

  get active(): boolean { return this.speaking; }

  /** Feed one level; returns `start` when a turn begins, `end` when it ends, else null. */
  feed(level: number, now: number): VadEvent {
    const loud = level >= this.o.threshold;
    if (!this.speaking) {
      if (!loud) { this.loudSince = null; return null; }
      this.loudSince ??= now;
      if (now - this.loudSince >= this.o.startMs) { this.speaking = true; this.quietSince = null; return 'start'; }
      return null;
    }
    if (loud) { this.quietSince = null; return null; }
    this.quietSince ??= now;
    if (now - this.quietSince >= this.o.endMs) { this.speaking = false; this.loudSince = null; this.quietSince = null; return 'end'; }
    return null;
  }

  reset(): void { this.speaking = false; this.loudSince = null; this.quietSince = null; }
}
