import { useState } from 'react';
import { api } from '../../api/client.js';
import { reducedRelaunchBody } from '../../board/launchModel.js';
import { sessionPath } from '../../board/sessionModel.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useLaunchNotices } from '../../store/launchNotices.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { REDUCED_RELAUNCH_WORDS } from './GateRow.js';

/**
 * (studio#1239) What crew said when it started this session's job without a seat that can judge another's work
 * (`assuranceNotice`, kept by the composer or the inline start at launch), with the relaunch it offers: the same job in a
 * run of its own in reduced assurance, only after a confirm. The first job keeps running; "Keep only this job" closes
 * the note. A POST happens only on the confirmed relaunch.
 */
export function LaunchAssuranceNote({ sessionId, navigate }: { sessionId: string; navigate: (path: string) => void }): React.ReactElement | null {
  const entry = useLaunchNotices((s) => s.bySession[sessionId]);
  // The relaunch in flight is the store's (one per notice): a remount or the run's other session never sends a second.
  const sending = useLaunchNotices((s) => entry !== undefined && s.relaunching[entry.runId] === true);
  const reducedCap = useCapabilities((s) => s.reducedAssurance);
  const [confirm, setConfirm] = useState<string | null>(null);
  /** A refused relaunch, said only under the notice it was made from. */
  const [error, setError] = useState<{ runId: string; text: string } | null>(null);
  if (entry === undefined) return null;
  const confirming = confirm === entry.runId;
  const relaunch = async (): Promise<void> => {
    const { runId: first, body, notice } = entry;
    if (!useLaunchNotices.getState().beginRelaunch(first)) return;
    setError(null);
    try {
      const { runId } = await api.launchRun(reducedRelaunchBody(body, notice));
      useProvenanceStore.getState().markLaunchedHere(runId);
      useLaunchNotices.getState().drop(first);
      navigate(sessionPath(`run:${runId}`));
    } catch (e) {
      setError({ runId: first, text: `Couldn’t start it again: ${e instanceof Error ? e.message : String(e)}. The first job is still running.` });
    } finally {
      useLaunchNotices.getState().endRelaunch(first);
    }
  };
  return (
    <div className="wk-launch-notice-wrap wk-measure wk-measure--thread">
    <div role="status" data-testid="session-launch-notice" data-code={entry.notice.code} className="wk-launch-notice">
      <p className="wk-launch-notice-title">The job started, and it will wait for a second helper</p>
      <p className="wk-launch-notice-body" data-testid="session-launch-notice-message">{entry.notice.message}</p>
      {confirming ? (
        <div role="group" aria-label="Start it again with reduced assurance?" data-testid="session-launch-notice-confirm" className="wk-launch-notice-acts">
          <p className="wk-launch-notice-body">{REDUCED_RELAUNCH_WORDS}</p>
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="session-launch-notice-cancel" disabled={sending} onClick={() => setConfirm(null)}>Not now</button>
          <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="session-launch-notice-relaunch" disabled={sending} onClick={() => { void relaunch(); }}>
            {sending ? 'Starting…' : 'Start it again with reduced assurance'}
          </button>
        </div>
      ) : (
        <div className="wk-launch-notice-acts">
          {reducedCap && <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="session-launch-notice-reduced" onClick={() => setConfirm(entry.runId)}>Start it again with reduced assurance…</button>}
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="session-launch-notice-dismiss" onClick={() => useLaunchNotices.getState().drop(entry.runId)}>Keep only this job</button>
        </div>
      )}
      {error !== null && error.runId === entry.runId && <p role="alert" data-testid="session-launch-notice-error" className="wk-launch-notice-body wk-launch-notice-error">{error.text}</p>}
    </div>
    </div>
  );
}
