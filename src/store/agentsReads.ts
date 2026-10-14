import { create } from 'zustand';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import { isRouteUnsupported } from '../api/errors.js';
import type { RosterSeat, SeatRecordResponse } from '../api/types.js';
import { getCachedRoster, setCachedRoster, subscribeRoster } from './rosterCache.js';

/**
 * THE AGENTS PAGE'S READS (DES-seats-page §1.4, §3.3): `GET /roster`, `GET /diagnostics` and
 * `GET /roster/record?days=7`, read once and shared by the Agents page, the rail's Agents dot and
 * the agent modal, so the count beside the rail link and the page's rows come from one reading.
 * Roster deposits from any other surface (the shared roster cache) land here too. Read-only.
 */

export type ReadState = 'idle' | 'loading' | 'ok' | 'failed' | 'absent';

export interface AgentsReads {
  roster: RosterSeat[] | null;
  rosterState: ReadState;
  rosterError: unknown;
  acpByCli: Record<string, { sessionsStarted: number; fallbacks: number; fallbackKinds: Record<string, number> }> | undefined;
  diagState: ReadState;
  record: SeatRecordResponse | undefined;
  recordState: ReadState;
  /** When the last full read settled (ms). */
  readAt: number | null;
  /** A re-read is in flight (codex PR r1: a retry is not settled until it answers). */
  reading: boolean;
  /** Re-read all three (one at a time per source; a read in flight is not doubled). */
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;
/** Bumped by every roster deposit from another surface: a read that started before one is stale (codex PR r1). */
let rosterRev = 0;

export const useAgentsReads = create<AgentsReads>((set) => ({
  roster: getCachedRoster(),
  rosterState: getCachedRoster() !== null ? 'ok' : 'idle',
  rosterError: null,
  acpByCli: undefined,
  diagState: 'idle',
  record: undefined,
  recordState: 'idle',
  readAt: null,
  reading: false,
  load: () => {
    if (inflight !== null) return inflight;
    const startRev = rosterRev;
    set((s) => ({ reading: true, rosterState: s.rosterState === 'ok' ? 'ok' : 'loading', diagState: s.diagState === 'idle' ? 'loading' : s.diagState, recordState: s.recordState === 'idle' ? 'loading' : s.recordState }));
    const roster = Promise.resolve()
      .then(() => api.getRoster())
      .then(({ roster: r }) => {
        if (!Array.isArray(r)) throw new Error('roster: no list');
        // A newer roster landed from another surface while this read was out: keep it.
        if (rosterRev !== startRev) { set({ rosterState: 'ok', rosterError: null }); return; }
        set({ roster: r, rosterState: 'ok', rosterError: null });
        setCachedRoster(r);
      })
      .catch((e: unknown) => { if (rosterRev === startRev) set({ rosterState: 'failed', rosterError: e }); });
    const diag = Promise.resolve()
      .then(() => getDiagnostics())
      .then((d) => { set({ acpByCli: d?.acp?.byCli ?? undefined, diagState: 'ok' }); })
      .catch((e: unknown) => set({ acpByCli: undefined, diagState: isDiagnosticsUnsupported(e) ? 'absent' : 'failed' }));
    const record = Promise.resolve()
      .then(() => api.getSeatRecord(7))
      .then((r) => {
        if (r === null || typeof r !== 'object' || !Array.isArray((r as SeatRecordResponse).seats)) throw new Error('record: no seats');
        set({ record: r as SeatRecordResponse, recordState: 'ok' });
      })
      .catch((e: unknown) => set({ record: undefined, recordState: isRouteUnsupported(e) ? 'absent' : 'failed' }));
    inflight = Promise.all([roster, diag, record]).then(() => { set({ readAt: Date.now() }); }).finally(() => { inflight = null; set({ reading: false }); });
    return inflight;
  },
}));

/**
 * Follow the shared roster cache while a reader is mounted: any surface's roster read (the modal's
 * "check again", the composer, Settings) updates the rows. Mount-time sync picks up a deposit made
 * while nothing was listening.
 */
export function followRosterCache(): () => void {
  const cached = getCachedRoster();
  if (cached !== null && cached !== useAgentsReads.getState().roster) { rosterRev += 1; useAgentsReads.setState({ roster: cached, rosterState: 'ok', rosterError: null }); }
  return subscribeRoster((r) => {
    if (Array.isArray(r) && r !== useAgentsReads.getState().roster) { rosterRev += 1; useAgentsReads.setState({ roster: r, rosterState: 'ok', rosterError: null }); }
  });
}

/** Read once (the rail on mount): a no-op when a read has started or settled. */
export function ensureAgentsRead(): void {
  const s = useAgentsReads.getState();
  if (s.readAt === null && inflight === null && (s.diagState === 'idle' || s.recordState === 'idle')) void s.load();
}

/** Whether every source the page reads has answered (ok, failed or absent). */
export function agentsSettled(s: Pick<AgentsReads, 'rosterState' | 'diagState' | 'recordState' | 'reading'>): boolean {
  const done = (r: ReadState): boolean => r === 'ok' || r === 'failed' || r === 'absent';
  return !s.reading && done(s.rosterState) && done(s.diagState) && done(s.recordState);
}

/** Test hook. */
export function resetAgentsReads(): void {
  inflight = null;
  useAgentsReads.setState({ roster: null, rosterState: 'idle', rosterError: null, acpByCli: undefined, diagState: 'idle', record: undefined, recordState: 'idle', readAt: null, reading: false });
}
