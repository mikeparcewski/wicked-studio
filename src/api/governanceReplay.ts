/**
 * The governance dead-letter replay wire — `POST /api/v1/governance/deadletters/replay {dryRun?}`
 * (wicked-crew#689): the `wicked-crew governance replay` drain over the daemon's OWN outbox and
 * store. A dry run folds the outbox and moves nothing, naming any `blocker`; a real replay lands
 * what it can and leaves what fails on the outbox (still dead letters).
 *
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * The shape below mirrors `GovernanceReplayOutcome` from `wicked-crew-api-types` 0.51.0, which
 * studio's installed contract predates. Delete this block and re-export from the contract package
 * the moment studio bumps to the api-types version that carries it.
 */

import { apiFetch } from './client.js';
import type { DiagnosticsGovernance } from './types.js';

export interface GovernanceReplayOutcome {
  outbox: string;
  store: { path: string; source: string };
  archive: string | null;
  read: number;
  replayed: number;
  alreadyPresent: number | null;
  failed: number;
  dryRun: boolean;
  note: string | null;
  fold?: Omit<DiagnosticsGovernance['deadletters'], 'legacyOutbox'>;
  blocker: string | null;
}

export function replayGovernanceDeadletters(dryRun: boolean): Promise<GovernanceReplayOutcome> {
  return apiFetch<GovernanceReplayOutcome>('/governance/deadletters/replay', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}
