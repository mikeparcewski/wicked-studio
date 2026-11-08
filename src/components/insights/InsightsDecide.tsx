import { useEffect, useState } from 'react';
import { insightsApi, type InsightsAcceptTarget, type InsightsMetricDef, type InsightsRecommendation } from '../../api/insights.js';
import { memoryPath } from '../../api/memory.js';
import { steerProposalsPath } from '../../api/steering.js';
import { sessionPath } from '../../board/sessionModel.js';
import { plainRecommendation } from '../../editors/insightsWords.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmButton } from '../calm/Calm.js';

/** Where a settings recommendation's Accept lands. */
export const SETTINGS_SECTION_PATHS: Record<string, string> = { seats: '/agents', gates: '/system' };

/** The page an Accept opens, or `null` when it opens nothing (the host panel shows what to do). */
export function acceptPath(target: InsightsAcceptTarget, rec: InsightsRecommendation): string | null {
  if (target.kind === 'proposal') return rec.kind === 'memory' ? memoryPath('proposals') : steerProposalsPath();
  if (target.kind === 'settings') return SETTINGS_SECTION_PATHS[target.section] ?? '/build';
  if (target.kind === 'runs' && target.runIds.length === 1) return sessionPath(`run:${target.runIds[0] as string}`);
  return null;
}

/**
 * THE DECIDE ASIDE (crew DES-RUNS-REVIEW-001 §7; editor-defaults ED-2): deciding on a recommendation is the host's, never
 * the plugin's. The plugin points at one (`selection.set`); this draws its evidence (with the run links the plugin never
 * sees) and Accept / Dismiss with a reason. One component for `/insights` and for a review run's card in its thread
 * (G2, operator default D6: the card is read-only, its pane and full screen decide).
 *
 * `onDecided` re-reads crew after a decision (the caller reloads the adapter and tells the plugin). `said` is a line the
 * caller adds (the view stopped); a decision's own outcome is said here.
 */
export function InsightsDecide({ selected, metrics, navigate, onDecided, said: callerSaid = null, hint }: {
  selected: InsightsRecommendation | null;
  metrics: readonly InsightsMetricDef[];
  navigate: Navigate;
  onDecided: () => Promise<void>;
  said?: string | null;
  /** The line with nothing picked. */
  hint?: string;
}): React.ReactElement {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // A new pointing starts over: no half-typed reason or old outcome carried to another recommendation.
  const selectedId = selected?.id ?? null;
  useEffect(() => { setDismissing(false); setReason(''); setSaid(null); }, [selectedId]);

  const accept = async (rec: InsightsRecommendation): Promise<void> => {
    setBusy(true);
    try {
      const { open } = await insightsApi.accept(rec.id);
      await onDecided();
      const path = acceptPath(open, rec);
      if (open.kind === 'issue') {
        if (open.url !== null) window.open(open.url, '_blank', 'noopener,noreferrer');
        setSaid(open.url !== null ? 'Accepted. A prefilled issue opened in a new tab.' : `Accepted. File this issue: ${open.title}`);
      } else if (path !== null) {
        navigate(path);
      } else {
        setSaid(open.kind === 'runs' ? 'Accepted. Open each run below to retry it or archive it.' : 'Accepted.');
      }
    } catch (e) {
      setSaid(`Not accepted: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (rec: InsightsRecommendation): Promise<void> => {
    if (reason.trim() === '') return;
    setBusy(true);
    try {
      await insightsApi.dismiss(rec.id, reason.trim());
      await onDecided();
      setDismissing(false);
      setSaid('Dismissed, with your reason.');
    } catch (e) {
      setSaid(`Not dismissed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const line = said ?? callerSaid;
  return (
    <aside data-testid="insights-decide" className="wk-insights-decide" aria-label="Decide on a recommendation">
      {selected === null ? (
        <p className="wk-insights-hint">{hint ?? 'Pick a recommendation to see its evidence and accept or dismiss it.'}</p>
      ) : (
        <>
          {(() => {
            const plain = plainRecommendation(selected, [...metrics]);
            return (
              <>
                <h2 className="wk-insights-title" data-testid="insights-decide-title">{plain.title}</h2>
                <p className="wk-insights-line">{plain.say}</p>
                <p className="wk-insights-line wk-insights-muted">If done: {plain.effect}</p>
                <p className="wk-insights-chips"><span className="wk-insights-chip" data-confidence={selected.confidence}>{plain.confidence}</span> <span>{plain.verb}</span></p>
                <details className="wk-insights-why" data-testid="insights-decide-why">
                  <summary>Why we think this</summary>
                  <ul>{plain.why.map((w) => <li key={w}>{w}</li>)}</ul>
                  {selected.evidence.runs.length > 0 && (
                    <ul className="wk-insights-runs" data-testid="insights-decide-runs" aria-label="Runs behind it">
                      {selected.evidence.runs.slice(0, 12).map((r) => (
                        <li key={r.id}><a href={sessionPath(`run:${r.id}`)} onClick={(e) => { e.preventDefault(); navigate(sessionPath(`run:${r.id}`)); }}>{r.title}</a></li>
                      ))}
                    </ul>
                  )}
                  <p>What would change our mind: {plain.changeMind}</p>
                </details>
              </>
            );
          })()}
          {selected.proposalError !== null && <p className="wk-insights-line">Its proposal was not filed: {selected.proposalError}</p>}
          {selected.state === 'new' ? (
            dismissing ? (
              <div className="wk-insights-dismiss">
                <label htmlFor={`insights-reason-${selected.id}`}>Why not?</label>
                <textarea id={`insights-reason-${selected.id}`} data-testid="insights-dismiss-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                <span className="wk-insights-buttons">
                  <CalmButton tone="primary" testId="insights-dismiss-confirm" disabled={busy || reason.trim() === ''} onClick={() => void dismiss(selected)}>Dismiss</CalmButton>
                  <CalmButton tone="link" onClick={() => setDismissing(false)}>Back</CalmButton>
                </span>
              </div>
            ) : (
              <span className="wk-insights-buttons">
                <CalmButton tone="primary" testId="insights-accept" disabled={busy} onClick={() => void accept(selected)}>
                  {selected.proposalId !== null ? 'Accept: open the proposal' : 'Accept'}
                </CalmButton>
                <CalmButton testId="insights-dismiss" disabled={busy} onClick={() => setDismissing(true)}>Dismiss…</CalmButton>
              </span>
            )
          ) : (
            <p className="wk-insights-line" data-testid="insights-decided">
              {selected.state === 'accepted' ? 'Accepted' : `Dismissed: ${selected.reason ?? ''}`}
              {selected.decidedAt !== null ? ` on ${new Date(selected.decidedAt).toLocaleDateString()}` : ''}.
            </p>
          )}
        </>
      )}
      {line !== null && <p className="wk-insights-said" role="status" data-testid="insights-said">{line}</p>}
    </aside>
  );
}
