/**
 * The governance dead-letter replay wire — `POST /api/v1/governance/deadletters/replay {dryRun?}`
 * (wicked-crew#689): the `wicked-crew governance replay` drain over the daemon's OWN outbox and
 * store. A dry run folds the outbox and moves nothing, naming any `blocker`; a real replay lands
 * what it can and leaves what fails on the outbox (still dead letters).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 */

import { apiFetch } from './client.js';

import type { GovernanceReplayOutcome } from 'wicked-crew-api-types';
export type { GovernanceReplayOutcome };

export function replayGovernanceDeadletters(dryRun: boolean): Promise<GovernanceReplayOutcome> {
  return apiFetch<GovernanceReplayOutcome>('/governance/deadletters/replay', {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}
