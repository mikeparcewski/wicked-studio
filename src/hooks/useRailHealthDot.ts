import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { DiagnosticsGovernance } from '../api/types.js';
import { useConnectionStore } from '../store/connection.js';

/**
 * The rail-level health dot (studio#421 rail polish, change 3): the answered-on-mount heartbeat
 * behind the rail's Health link — CONNECTION PLUS EVIDENCE only (DES-seats-page §2.1): the socket,
 * `GET /health` and `GET /diagnostics`' governance store and dead letters. Agent standing (sign-in,
 * benches, the roster read itself) left this tint for the Agents link's dot, so one concern has
 * one signal; a failed roster read shows on the Agents link and page, never here.
 *
 * Every read is fire-and-forget `Promise.resolve().then(...).catch(...)`, so a proxy shell with none
 * of these implemented can never crash the rail (S15c). A diagnostics rejection is a DEGRADED dot,
 * never a red one — only an answered-dirty store makes it red, the section's own rule.
 */
/** Fired by /health whenever it (re)reads its checks, so the rail's dot never disagrees with the page. */
export const HEALTH_RECHECKED = 'wicked:health-rechecked';

export function useRailHealthDot(): { heartState: 'healthy' | 'degraded' | 'unhealthy'; heartColor: string; sick: boolean } {
  const wsStatus = useConnectionStore((s) => s.status);
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [healthError, setHealthError] = useState(false);
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
    window.addEventListener(HEALTH_RECHECKED, onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener(HEALTH_RECHECKED, onFocus); };
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => api.getHealth())
      .then((h: { status?: string }) => { if (live) { setHealth(h); setHealthError(false); } }, () => { if (live) setHealthError(true); });
    void Promise.resolve()
      .then(() => getDiagnostics())
      .then((d: { governance?: DiagnosticsGovernance }) => {
        if (!live) return;
        setGov(d.governance === undefined ? { kind: 'absent' } : { kind: 'ok', governance: d.governance });
      }, (e: unknown) => { if (live) setGov(isDiagnosticsUnsupported(e) ? { kind: 'absent' } : { kind: 'error' }); });
    return () => { live = false; };
  }, [epoch]);

  const govDirty = gov.kind === 'ok' && (gov.governance.store === null || gov.governance.findings.some((f) => f.severity === 'error'));
  const sick =
    wsStatus === 'disconnected'
    || govDirty;
  const warning =
    wsStatus === 'connecting'
    || healthError
    || (health !== null && health.status !== 'ok')
    || gov.kind === 'error'
    || (gov.kind === 'ok' && gov.governance.findings.some((f) => f.severity === 'warning'));
  const heartState: 'healthy' | 'degraded' | 'unhealthy' = sick ? 'unhealthy' : warning ? 'degraded' : 'healthy';
  return {
    heartState,
    heartColor: sick ? 'var(--status-fail)' : warning ? 'var(--status-gate)' : 'var(--status-run)',
    sick,
  };
}