import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import { getSystem, isSystemUnsupported, type SystemSnapshot } from '../api/system.js';
import type { DiagnosticsGovernance } from '../api/types.js';
import { useConnectionStore } from './connection.js';

/**
 * THE NERVE CENTER'S READ (DES-SYSTEM-VIEW): one shared, bounded poll behind the rail tile and the
 * dashboard. Every tick reads `GET /health` (liveness, and whether this crew serves the snapshot):
 *
 *  - a crew with `capabilities.system` → `GET /system`, the one derived snapshot (`mode: 'system'`);
 *  - an older crew → `GET /diagnostics`' governance block, the signals the old Health dot read
 *    (`mode: 'fallback'`), so the tile still says something true.
 *
 * Every read is bounded ({@link READ_TIMEOUT_MS}): a read that hangs is a FAILED read. The clock of
 * the last SUCCESSFUL read is kept, so the tile can refuse to be green over a stale answer
 * (`STALE_MS` in board/nerveCenter). It reads again on focus, when the tab becomes visible, when the socket
 * reconnects and when a page asks (`HEALTH_RECHECKED`, the Re-check buttons), and pauses while
 * the tab is hidden. One loop however many components subscribe (`useSystemPoll` is ref-counted).
 */

/** How often the snapshot is re-read while someone is looking. */
export const POLL_MS = 30_000;
/** A read that has not answered by now has failed. */
export const READ_TIMEOUT_MS = 10_000;

/** Fired by a Re-check (and by opening the dashboard) so every reader re-reads at once. */
export const HEALTH_RECHECKED = 'wicked:health-rechecked';

export type GovernanceSignal =
  | { kind: 'unread' }
  | { kind: 'absent' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; governance: DiagnosticsGovernance };

export interface SystemStore {
  /** `unknown` until a `/health` answer says which crew this is. */
  mode: 'unknown' | 'system' | 'fallback';
  health: { status?: string; version?: string } | null;
  /** When the newest SUCCESSFUL `/health` read landed. */
  healthAt: number | null;
  /** The newest `/health` read's failure (`null` once one succeeds). */
  healthError: string | null;
  snapshot: SystemSnapshot | null;
  /** When the newest SUCCESSFUL `/system` read landed. */
  snapshotAt: number | null;
  snapshotError: string | null;
  /** The fallback's governance read (older crews). */
  governance: GovernanceSignal;
  /** When the newest SUCCESSFUL `/diagnostics` governance read landed (older crews). */
  governanceAt: number | null;
  /** A read is in flight. */
  reading: boolean;
  /** Read now. `force` (a Re-check): a read already in flight is superseded — its answer is not shown —
   *  and a new one runs after it; the promise settles when that new read has landed. */
  refresh: (opts?: { force?: boolean }) => Promise<void>;
}

const message = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : String(e));

function bounded<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer after ${Math.round(READ_TIMEOUT_MS / 1000)} s`)), READ_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}

type Answer = Partial<Pick<SystemStore, 'mode' | 'health' | 'healthAt' | 'healthError' | 'snapshot' | 'snapshotAt' | 'snapshotError' | 'governance' | 'governanceAt'>>;

/**
 * One tick's reads, folded into ONE answer that is published at once when the tick settles — never a
 * fresh `/health` clock beside a `/system` or `/diagnostics` answer still in flight (a stale green
 * would pass for a fresh one while the follow-up read hangs or fails).
 */
async function readTick(): Promise<Answer> {
  let h: { status?: string; version?: string; capabilities?: Record<string, unknown> };
  try {
    // Through a resolved promise, so a client that cannot serve the read at all is a failed read.
    h = await bounded(Promise.resolve().then(() => api.getHealth())) as typeof h;
  } catch (e) {
    return { healthError: message(e) };
  }
  const health: Answer = { health: h, healthAt: Date.now(), healthError: null };
  if (h.capabilities?.['system'] === true) {
    try {
      const read = await bounded(getSystem());
      // The one needs-you rule needs both: the capability, and the contract's own fields.
      const snapshot = { ...read, ranked: read.ranked === true && h.capabilities?.['attentionRanked'] === true };
      return { ...health, mode: 'system', snapshot, snapshotAt: Date.now(), snapshotError: null };
    } catch (e) {
      // A crew that claims the capability but has no route is an older crew after all.
      if (!isSystemUnsupported(e)) return { ...health, mode: 'system', snapshotError: message(e) };
    }
  }
  const older: Answer = { ...health, mode: 'fallback', snapshot: null, snapshotAt: null, snapshotError: null };
  try {
    const d = await bounded(Promise.resolve().then(() => getDiagnostics()));
    return { ...older, governance: d.governance === undefined ? { kind: 'absent' } : { kind: 'ok', governance: d.governance }, governanceAt: Date.now() };
  } catch (e) {
    return { ...older, governance: isDiagnosticsUnsupported(e) ? { kind: 'absent' } : { kind: 'error', message: message(e) }, governanceAt: isDiagnosticsUnsupported(e) ? Date.now() : null };
  }
}

let inflight: Promise<void> | null = null;
/** The read a Re-check queued behind the one in flight. */
let queued: Promise<void> | null = null;
/** Bumped by every Re-check: a read started under an older generation is superseded (not shown). */
let generation = 0;

export const useSystemStore = create<SystemStore>((set) => ({
  mode: 'unknown',
  health: null,
  healthAt: null,
  healthError: null,
  snapshot: null,
  snapshotAt: null,
  snapshotError: null,
  governance: { kind: 'unread' },
  governanceAt: null,
  reading: false,
  refresh: (opts?: { force?: boolean }): Promise<void> => {
    if (inflight !== null) {
      if (opts?.force !== true) return inflight;
      generation += 1;
      queued ??= inflight.then((): Promise<void> => { queued = null; return useSystemStore.getState().refresh(); });
      return queued;
    }
    const mine = generation;
    set({ reading: true });
    inflight = readTick()
      .then((answer) => { if (mine === generation) set(answer); })
      .finally(() => { inflight = null; set({ reading: queued !== null }); });
    return inflight;
  },
}));

let subscribers = 0;
let stop: (() => void) | null = null;

function start(): () => void {
  const read = (): void => { void useSystemStore.getState().refresh(); };
  const recheck = (): void => { void useSystemStore.getState().refresh({ force: true }); };
  const tick = (): void => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') read(); };
  const onVisible = (): void => { if (document.visibilityState === 'visible') read(); };
  read();
  const timer = setInterval(tick, POLL_MS);
  window.addEventListener('focus', read);
  window.addEventListener(HEALTH_RECHECKED, recheck);
  document.addEventListener('visibilitychange', onVisible);
  // A socket that comes back is a moment the answer may have changed.
  let lastWs = useConnectionStore.getState().status;
  const offWs = useConnectionStore.subscribe((s) => {
    if (s.status === 'connected' && lastWs !== 'connected') read();
    lastWs = s.status;
  });
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', read);
    window.removeEventListener(HEALTH_RECHECKED, recheck);
    document.removeEventListener('visibilitychange', onVisible);
    offWs();
  };
}

/** Keep the shared poll running while the caller is mounted (one loop for every caller). */
export function useSystemPoll(): void {
  useEffect(() => {
    subscribers += 1;
    if (subscribers === 1) stop = start();
    return () => {
      subscribers -= 1;
      if (subscribers === 0 && stop !== null) { stop(); stop = null; }
    };
  }, []);
}

/** Tests: forget every answer. */
export function resetSystemStore(): void {
  inflight = null;
  queued = null;
  generation = 0;
  useSystemStore.setState({
    mode: 'unknown', health: null, healthAt: null, healthError: null, snapshot: null, snapshotAt: null,
    snapshotError: null, governance: { kind: 'unread' }, governanceAt: null, reading: false,
  });
}
