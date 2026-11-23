import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { insightsApi, type InsightsAcceptTarget, type InsightsMetricDef, type InsightsRecommendation } from '../../api/insights.js';
import { memoryPath } from '../../api/memory.js';
import { steerProposalsPath } from '../../api/steering.js';
import { retryPrefillOf } from '../../board/needsYou.js';
import { sessionPath } from '../../board/sessionModel.js';
import { plainRecommendation } from '../../editors/insightsWords.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { CalmButton } from '../calm/Calm.js';

/** Where a settings recommendation's Accept lands. */
export const SETTINGS_SECTION_PATHS: Record<string, string> = { seats: '/agents', gates: '/system' };

/** The page an Accept opens, or `null` when it opens nothing (the host panel shows what to do: for runs, it lists them
 *  to archive or retry, crew#1165). */
export function acceptPath(target: InsightsAcceptTarget, rec: InsightsRecommendation): string | null {
  if (target.kind === 'proposal') return rec.kind === 'memory' ? memoryPath('proposals') : steerProposalsPath();
  if (target.kind === 'settings') return SETTINGS_SECTION_PATHS[target.section] ?? '/build';
  return null;
}

type RunOutcome = { kind: 'archived' } | { kind: 'failed'; message: string };

/**
 * (crew#1165) What an accepted "Close N runs nobody finished" does: the runs it names, each with a Retry (the run's own
 * launch, prefilled, as the home page's tidy-up row does), and Archive all with a note (`POST /runs/:id/resolve`, one
 * call per run, in turn). Each run says how it went; one that could not be archived says why.
 */
export function InsightsResolveRuns({ runIds, titles, navigate }: {
  runIds: readonly string[];
  /** Run titles from the recommendation's evidence; a run not named there shows its id. */
  titles: ReadonlyMap<string, string>;
  navigate: Navigate;
}): React.ReactElement {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  /** The archive batch in flight: how many runs it sends, and how many have answered. */
  const [batch, setBatch] = useState<{ total: number; done: number } | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, RunOutcome>>(new Map());
  // A batch or a Retry still answering after the panel went away (another recommendation, another page) stops there:
  // no further run is archived and nothing navigates.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = batch !== null || retrying !== null;
  const open = runIds.filter((id) => outcomes.get(id)?.kind !== 'archived');

  const archiveAll = async (): Promise<void> => {
    const reason = note.trim();
    if (reason === '' || busy) return;
    const targets = open;
    setBatch({ total: targets.length, done: 0 });
    const next = new Map(outcomes);
    // One at a time: the route stops and archives each run inside its own decision lock.
    for (const [i, id] of targets.entries()) {
      if (!mounted.current) return;
      try {
        await api.resolveRun(id, { action: 'archive', reason });
        next.set(id, { kind: 'archived' });
      } catch (e) {
        next.set(id, { kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
      if (!mounted.current) return;
      setOutcomes(new Map(next));
      setBatch({ total: targets.length, done: i + 1 });
    }
    setBatch(null);
    setNoting(false);
  };

  const retry = async (id: string): Promise<void> => {
    if (busy) return;
    setRetrying(id);
    let path = sessionPath(`run:${id}`);
    try {
      const { run } = await api.getRun(id);
      if (!mounted.current) return;
      setRetryPrefill(retryPrefillOf(run));
      path = '/runs/new';
    } catch {
      // The run could not be read: its own page offers Retry.
    }
    if (!mounted.current) return;
    setRetrying(null);
    navigate(path);
  };

  const archived = runIds.length - open.length;
  const failed = [...outcomes.values()].filter((o) => o.kind === 'failed').length;
  return (
    <div className="wk-insights-resolve" data-testid="insights-resolve">
      <ul className="wk-insights-resolve-runs" aria-label="Runs to close">
        {runIds.map((id) => {
          const outcome = outcomes.get(id);
          const path = sessionPath(`run:${id}`);
          return (
            <li key={id} data-testid="insights-resolve-run" data-run={id} data-outcome={outcome?.kind ?? 'open'}>
              <a href={path} onClick={(e) => { e.preventDefault(); navigate(path); }}>{titles.get(id) ?? id}</a>
              <span className="wk-insights-resolve-act">
                {outcome?.kind === 'archived'
                  ? <span className="wk-insights-muted">Archived</span>
                  : <CalmButton tone="link" testId="insights-resolve-retry" disabled={busy} onClick={() => void retry(id)}>Retry</CalmButton>}
              </span>
              {outcome?.kind === 'failed' && <span className="wk-insights-resolve-fail" role="alert">Not archived: {outcome.message}</span>}
            </li>
          );
        })}
      </ul>
      {open.length > 0 && (noting ? (
        <div className="wk-insights-dismiss">
          <label htmlFor="insights-resolve-note">Why archive {open.length === 1 ? 'it' : 'them'}? (kept on each run)</label>
          <textarea id="insights-resolve-note" data-testid="insights-resolve-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={480} />
          <span className="wk-insights-buttons">
            <CalmButton tone="primary" testId="insights-resolve-archive-confirm" disabled={busy || note.trim() === ''} onClick={() => void archiveAll()}>
              {open.length === 1 ? 'Archive it' : `Archive all ${open.length}`}
            </CalmButton>
            <CalmButton tone="link" disabled={busy} onClick={() => setNoting(false)}>Back</CalmButton>
          </span>
        </div>
      ) : (
        <span className="wk-insights-buttons">
          <CalmButton testId="insights-resolve-archive" disabled={busy} onClick={() => setNoting(true)}>
            {open.length === 1 ? 'Archive it with a note…' : 'Archive all with a note…'}
          </CalmButton>
        </span>
      ))}
      {(batch !== null || outcomes.size > 0) && (
        <p className="wk-insights-said" role="status" data-testid="insights-resolve-said">
          {batch !== null
            ? `Archiving… ${batch.done} of ${batch.total} answered.`
            : open.length === 0
              ? `Archived ${runIds.length === 1 ? 'the run' : `all ${runIds.length} runs`}.`
              : `Archived ${archived} of ${runIds.length}; ${failed} could not be archived (said beside each).`}
        </p>
      )}
    </div>
  );
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
  /** (crew#1165) The recommendation accepted here (its reloaded state may not say so yet). */
  const [acceptedHere, setAcceptedHere] = useState<string | null>(null);
  // A new pointing starts over: no half-typed reason or old outcome carried to another recommendation.
  const selectedId = selected?.id ?? null;
  const current = useRef(selectedId);
  current.current = selectedId;
  useEffect(() => { setDismissing(false); setReason(''); setSaid(null); }, [selectedId]);
  // (crew#1165) An accepted "Close N runs nobody finished" lists the runs it names, to archive or retry, whenever it is
  // picked again: the runs are the recommendation's own (`action.runs`, what crew's Accept answers).
  const resolveRuns = selected !== null && selected.kind === 'resolve-stale' && (selected.action.runs?.length ?? 0) > 0 &&
    (selected.state === 'accepted' || acceptedHere === selected.id) ? selected.action.runs! : null;

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
      } else if (open.kind === 'runs' && open.runIds.length > 0) {
        // Only for the recommendation still picked: a late answer never lends its runs to another one.
        if (current.current === rec.id) setAcceptedHere(rec.id);
      } else {
        setSaid('Accepted.');
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
          {resolveRuns !== null ? (
            <>
              <p className="wk-insights-line" data-testid="insights-decided">
                Accepted. Archive {resolveRuns.length === 1 ? 'this run' : `these ${resolveRuns.length} runs`} with a note, or retry one.
              </p>
              <InsightsResolveRuns key={selected.id} runIds={resolveRuns} titles={new Map(selected.evidence.runs.map((r) => [r.id, r.title]))} navigate={navigate} />
            </>
          ) : selected.state === 'new' ? (
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
