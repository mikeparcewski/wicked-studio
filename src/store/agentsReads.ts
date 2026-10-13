import { create } from 'zustand';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import { isRouteUnsupported } from '../api/errors.js';
import type { DiagnosticsSeatGovernance, RosterSeat, SeatRecordResponse } from '../api/types.js';
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
  governance: DiagnosticsSeatGovernance | undefined;
  acpByCli: Record<string, { sessionsStarted: number; fallbacks: number; fallbackKinds: Record<string, number> }> | undefined;
  diagState: ReadState;
  record: SeatRecordResponse | undefined;
  recordState: ReadState;
  /** When the last full read settled (ms). */
  readAt: number | null;
  /** Re-read all three (one at a time per source; a read in flight is not doubled). */
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useAgentsReads = create<AgentsReads>((set) => ({
  roster: getCachedRoster(),
  rosterState: getCachedRoster() !== null ? 'ok' : 'idle',
  rosterError: null,
  governance: undefined,
  acpByCli: undefined,
  diagState: 'idle',
  record: undefined,
  recordState: 'idle',
  readAt: null,
  load: () => {
    if (inflight !== null) return inflight;
    set((s) => ({ rosterState: s.rosterState === 'ok' ? 'ok' : 'loading', diagState: s.diagState === 'idle' ? 'loading' : s.diagState, recordState: s.recordState === 'idle' ? 'loading' : s.recordState }));
    const roster = Promise.resolve()
      .then(() => api.getRoster())
      .then(({ roster: r }) => {
        if (!Array.isArray(r)) throw new Error('roster: no list');
        set({ roster: r, rosterState: 'ok', rosterError: null });
        setCachedRoster(r);
      })
      .catch((e: unknown) => set({ rosterState: 'failed', rosterError: e }));
    const diag = Promise.resolve()
      .then(() => getDiagnostics())
      .then((d) => {
        const g = (d as { seatGovernance?: DiagnosticsSeatGovernance } | undefined)?.seatGovernance;
        set({ governance: g, acpByCli: d?.acp?.byCli ?? undefined, diagState: 'ok' });
      })
      .catch((e: unknown) => set({ governance: undefined, acpByCli: undefined, diagState: isDiagnosticsUnsupported(e) ? 'absent' : 'failed' }));
    const record = Promise.resolve()
      .then(() => api.getSeatRecord(7))
      .then((r) => {
        if (r === null || typeof r !== 'object' || !Array.isArray((r as SeatRecordResponse).seats)) throw new Error('record: no seats');
        set({ record: r as SeatRecordResponse, recordState: 'ok' });
      })
      .catch((e: unknown) => set({ record: undefined, recordState: isRouteUnsupported(e) ? 'absent' : 'failed' }));
    inflight = Promise.all([roster, diag, record]).then(() => { set({ readAt: Date.now() }); }).finally(() => { inflight = null; });
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
  if (cached !== null && cached !== useAgentsReads.getState().roster) useAgentsReads.setState({ roster: cached, rosterState: 'ok', rosterError: null });
  return subscribeRoster((r) => {
    if (Array.isArray(r) && r !== useAgentsReads.getState().roster) useAgentsReads.setState({ roster: r, rosterState: 'ok', rosterError: null });
  });
}

/** Read once (the rail on mount): a no-op when a read has started or settled. */
export function ensureAgentsRead(): void {
  const s = useAgentsReads.getState();
  if (s.readAt === null && inflight === null && (s.diagState === 'idle' || s.recordState === 'idle')) void s.load();
}

/** Whether every source the page reads has answered (ok, failed or absent). */
export function agentsSettled(s: Pick<AgentsReads, 'rosterState' | 'diagState' | 'recordState'>): boolean {
  const done = (r: ReadState): boolean => r === 'ok' || r === 'failed' || r === 'absent';
  return done(s.rosterState) && done(s.diagState) && done(s.recordState);
}

/** Test hook. */
export function resetAgentsReads(): void {
  inflight = null;
  useAgentsReads.setState({ roster: null, rosterState: 'idle', rosterError: null, governance: undefined, acpByCli: undefined, diagState: 'idle', record: undefined, recordState: 'idle', readAt: null });
}
