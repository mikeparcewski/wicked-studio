import type { ArtifactAttempt } from '../editors/hostApi.js';

/**
 * crew#1745: how a run that makes a document stands, for the document card's pill before its first version.
 *  - `failed` with crew's reason when crew recorded that the attempt did not land (`session.landing_failed`, written by
 *    crew's run view from its `run.landing_failed` record: "interrupted by a restart", "the run finished without writing
 *    the draft file", …);
 *  - `stopped` when the run ended cancelled or failed with no reason recorded;
 *  - `working` otherwise (a completed run's draft lands within seconds, or crew records why it did not).
 */
export function attemptOfRun(session: { status?: unknown; landing_failed?: { reason?: unknown } | null }): ArtifactAttempt {
  const failed = session.landing_failed;
  if (failed !== undefined && failed !== null) {
    const why = typeof failed.reason === 'string' ? failed.reason.trim().replace(/[.\s]+$/u, '') : '';
    return why !== '' ? { state: 'failed', why } : { state: 'stopped' };
  }
  return session.status === 'cancelled' || session.status === 'failed' ? { state: 'stopped' } : { state: 'working' };
}
