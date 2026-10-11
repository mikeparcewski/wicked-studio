import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics } from '../api/diagnostics.js';
import type { DiagnosticsGovernance, RosterSeat } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';
import { getCachedRoster, subscribeRoster } from '../store/rosterCache.js';

/**
 * The rail-level health dot (studio#421 rail polish, change 3): the answered-on-mount heartbeat
 * behind the rail's Health link — exactly the registry's pre-read (DES-STUDIO-REBUILD-001
 * §4.2 / Amendment 5): `GET /health` + `GET /roster` + `GET /diagnostics`, one guarded mount read
 * each, plus the socket. NEVER `GET /roster/record?days=7` here — the 7-day week is the health
 * page's own read; the rail dot is answered from the roster list alone (EC30-strict, DES-UX-001 §7.9-1).
 *
 * Every read is fire-and-forget `Promise.resolve().then(...).catch(...)`, so a proxy shell with none
 * of these implemented can never crash the rail (S15c); the INACTIVE / council-eligible flags read
 * the SYNC roster cache first (zero requests on first paint, DES-FEEDBACK-001 §6.2). A diagnostics
 * rejection is a DEGRADED dot, never a red one — only an answered-dirty store makes it red, the
 * section's own rule.
 */
export function useRailHealthDot(): { heartState: 'healthy' | 'degraded' | 'unhealthy'; heartColor: string; sick: boolean } {
  const wsStatus = useConnectionStore((s) => s.status);
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [roster, setRoster] = useState<RosterSeat[] | null>(() => getCachedRoster());
  const [rosterError, setRosterError] = useState(false);
  const [gov, setGov] = useState<{ kind: 'absent' | 'error' } | { kind: 'ok'; governance: DiagnosticsGovernance }>({ kind: 'absent' });
  // The dot is re-read when it could have changed (codex review r1): each time the socket
  // (re)connects and each time the window regains focus — never a polling loop.
  const [epoch, setEpoch] = useState(0);
  const lastWs = useRef(wsStatus);
  useEffect(() => {
    // A RE-connect only: the mount read already covers the first answer.
    if (wsStatus === 'connected' && lastWs.current !== 'connected') setEpoch((n) => n + 1);
    lastWs.current = wsStatus;
  }, [wsStatus]);
  useEffect(() => {
    const onFocus = (): void => setEpoch((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => api.getHealth())
      .then((h: { status?: string }) => { if (live) { setHealth(h); setHealthError(false); } }, () => { if (live) setHealthError(true); });
    void Promise.resolve()
      .then(() => api.getRoster())
      .then(({ roster: seats }: { roster: RosterSeat[] }) => {
        if (live && Array.isArray(seats)) { setRoster(seats); setRosterError(false); }
      }, () => { if (live) setRosterError(true); });
    void Promise.resolve()
      .then(() => getDiagnostics())
      .then((d: { governance?: DiagnosticsGovernance }) => {
        if (!live) return;
        setGov(d.governance === undefined ? { kind: 'absent' } : { kind: 'ok', governance: d.governance });
      }, () => { if (live) setGov({ kind: 'error' }); });
    const un = subscribeRoster((r) => { if (live) { setRoster(r); setRosterError(false); } });
    return () => { live = false; un(); };
  }, [epoch]);

  const seats = roster ?? [];
  const govDirty = gov.kind === 'ok' && (gov.governance.store === null || gov.governance.findings.some((f) => f.severity === 'error'));
  const sick =
    wsStatus === 'disconnected'
    || govDirty
    || seats.some((s) => s.health?.status === 'inactive');
  const warning =
    wsStatus === 'connecting'
    || healthError
    || rosterError
    || (health !== null && health.status !== 'ok')
    || gov.kind === 'error'
    || (gov.kind === 'ok' && gov.governance.findings.some((f) => f.severity === 'warning'))
    || seats.some((s) => (s as { council_eligible?: unknown }).council_eligible === false && s.health?.status !== 'inactive');
  const heartState: 'healthy' | 'degraded' | 'unhealthy' = sick ? 'unhealthy' : warning ? 'degraded' : 'healthy';
  return {
    heartState,
    heartColor: sick ? 'var(--status-fail)' : warning ? 'var(--status-gate)' : 'var(--status-run)',
    sick,
  };
}