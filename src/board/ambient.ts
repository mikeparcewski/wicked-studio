import type { SessionView } from '../api/types.js';

/**
 * AMBIENT (operator 2026-11-01; design/mockups/ambient.html), pure: the one mood the work sets. Several at once resolve
 * as failed > needs you > running > delivered > idle. The mood only tints a 2 px hairline, the page head's wash, the
 * Nerve Center tile's ring and dot and the active nav marker (styles/sections/ambient.css); text never changes.
 */
export type AmbientMood = 'idle' | 'running' | 'needs' | 'failed' | 'delivered';

/** A failure colours the room for half an hour after it happened; a delivery settles for 10 s. */
export const FAILED_WINDOW_MS = 30 * 60_000;
export const DELIVERED_WINDOW_MS = 10_000;

const LIVE = new Set(['executing', 'planning', 'running', 'pending', 'queued']);

/** When a run ended (ms): crew's `finished_at` (ms), else `ended_at` (s). */
export function endedAt(s: SessionView['session']): number | null {
  const f = (s as { finished_at?: unknown }).finished_at;
  if (typeof f === 'number' && Number.isFinite(f)) return f;
  const e = (s as { ended_at?: unknown }).ended_at;
  return typeof e === 'number' && Number.isFinite(e) ? e * 1000 : null;
}

export interface AmbientInput {
  runs: readonly SessionView[];
  /** The settled needs-you count (the badge's own number). */
  needs: number;
  now: number;
}

/** The mood, and when it next changes on its own (a failure or a delivery ageing out), so no clock polls. */
export function ambientMood({ runs, needs, now }: AmbientInput): { mood: AmbientMood; until: number | null } {
  let failedUntil: number | null = null;
  let deliveredUntil: number | null = null;
  let running = false;
  for (const r of runs) {
    const s = r.session;
    if (LIVE.has(s.status)) { running = true; continue; }
    const at = endedAt(s);
    if (at === null) continue;
    if (s.status === 'failed' && now - at < FAILED_WINDOW_MS) failedUntil = Math.max(failedUntil ?? 0, at + FAILED_WINDOW_MS);
    const delivered = s.status === 'completed' && (s as { delivery?: unknown }).delivery !== undefined && (s as { delivery?: unknown }).delivery !== 'none';
    if (delivered && now - at >= 0 && now - at < DELIVERED_WINDOW_MS) deliveredUntil = Math.max(deliveredUntil ?? 0, at + DELIVERED_WINDOW_MS);
  }
  if (failedUntil !== null) return { mood: 'failed', until: failedUntil };
  if (needs > 0) return { mood: 'needs', until: null };
  if (running) return { mood: 'running', until: null };
  if (deliveredUntil !== null) return { mood: 'delivered', until: deliveredUntil };
  return { mood: 'idle', until: null };
}
