// Feeds the merged readiness model from the proxied preflight (DES-MERGE-001 §5.6, slice 17).
//
// Called once per project from the shell, so the model is populated whatever mode the
// user landed in: the mode SWITCHER reflects readiness (§1.3 rule 3), which means Chat
// has to know what Document would find — without Chat ever being gated by it.
//
// The request itself is what starts a cold bridge (crew's idempotent reuse-or-start on
// the first proxied call, §5.6), so entering a project is also what makes the document
// service ready. Failures are absorbed by design:
//
//   · `BridgeUnavailableError` (503) → the bridge leg goes `unavailable` with its named
//     fix command (§7.12); the mode surface still opens and states the same fix.
//   · anything else (crew down, a 404 from an older bridge) → nothing is reported, so
//     nothing is claimed. The model must never gate on a fact it does not have.
import { useEffect } from 'react';
import { BridgeUnavailableError, getPreflight } from '../api/interactive.js';
import { normalizeDeps, useReadinessStore } from '../store/readiness.js';

export function usePreflight(projectId: string): void {
  const report = useReadinessStore((s) => s.report);
  const attempt = useReadinessStore((s) => s.attempt);

  useEffect(() => {
    let cancelled = false;
    getPreflight(projectId).then(
      (wire: unknown) => {
        if (!cancelled) report(projectId, { bridge: 'ready', bridgeHint: null, deps: normalizeDeps(wire) });
      },
      (err: unknown) => {
        if (cancelled || !(err instanceof BridgeUnavailableError)) return;
        report(projectId, { bridge: 'unavailable', bridgeHint: err.hint, deps: [] });
      },
    );
    return () => { cancelled = true; };
  }, [projectId, attempt, report]);
}
