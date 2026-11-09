import { useEffect, useState } from 'react';

import { repoWatchApi, useRepoWatchFailed, useRepoWatchStore, watchLine, type RepoWatchStatus } from '../api/repoWatch.js';
import { ApiError } from '../api/errors.js';
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
import { sessionPath } from '../board/sessionModel.js';

/**
 * crew-0183: what a repository says about keeping its code map current (crew's repo watcher). One quiet line on the
 * Repositories list and the repo page; on a failure, its remedy; while jobs hold the map, a link to each. Nothing on a
 * crew without the watcher, or for a repository it does not watch (not onboarded yet).
 */
export function RepoWatchLine({ status, repoId, now, compact = false, navigate, testId = 'repo-row-watch' }: {
  status: RepoWatchStatus | null | undefined;
  repoId: string;
  now: number;
  /** The list's cell: the words only, the remedy on hover. */
  compact?: boolean;
  navigate?: (path: string) => void;
  /** The list renders the line twice (desktop cell, phone line; CSS shows one): each its own id. */
  testId?: string;
}): React.ReactElement | null {
  const failed = useRepoWatchFailed();
  const line = watchLine(status, repoId, now, failed);
  if (line === null) return null;
  if (compact) {
    return (
      <span className="wk-rl-watch" data-testid={testId} role="status" data-state={line.state} data-tone={line.tone} title={line.remedy !== null ? `${line.words}. ${line.remedy}` : line.words}>
        {line.words}
      </span>
    );
  }
  return (
    <div className="wk-rp-watch" data-testid="repo-watch" data-state={line.state} data-tone={line.tone} role="status">
      <span aria-hidden className="wk-rp-watch-dot" />
      <span>
        <span data-testid="repo-watch-words">{line.waitingOn.length > 0 && navigate !== undefined ? 'Waiting:' : line.words}</span>
        {line.waitingOn.length > 0 && navigate !== undefined && (
          <span className="wk-rp-watch-runs">
            {' '}
            {line.waitingOn.map((h, i) => {
              const short = h.runId.slice(0, 8);
              const what = h.reason === 'domain-mapping' ? `the requirements mapping ${short}` : `job ${short}`;
              return (
                <span key={h.runId}>
                  {i > 0 && (i === line.waitingOn.length - 1 ? ' and ' : ', ')}
                  <a href={sessionPath(`run:${h.runId}`)} data-testid="repo-watch-run" className="wk-link" aria-label={`Open ${what}`}
                    onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(sessionPath(`run:${h.runId}`)); }}>
                    {what}
                  </a>
                </span>
              );
            })}
            {` ${line.waitingOn.length === 1 ? 'is' : 'are'} using this repository’s code map; it is re-indexed when ${line.waitingOn.length === 1 ? 'that job ends' : 'they end'}.`}
          </span>
        )}
        {line.remedy !== null && <span className="wk-rp-watch-remedy" data-testid="repo-watch-remedy"> {line.remedy}</span>}
      </span>
    </div>
  );
}

/** The repo page's controls: the per-repo switch, Re-index now, and what "current" covers. */
export function RepoWatchControls({ status, repoId }: { status: RepoWatchStatus | null | undefined; repoId: string }): React.ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const row = status?.repos.find((r) => r.repoId === repoId);
  const shown = row?.state;
  // What was said about a press stands until the watcher's own state moves (codex r1: "Re-indexing now" stuck).
  useEffect(() => { setSaid(null); }, [shown]);
  if (status === null || status === undefined || !status.enabled || row === undefined) return null;
  // The person's switch, never the activity (codex + pi r1: a capped or one-shot row read as on/off by its state).
  const on = row.enabled;
  const act = async (fn: () => Promise<unknown>, ok: string | null): Promise<void> => {
    setBusy(true); setSaid(null);
    try {
      await fn();
      setSaid(ok);
    } catch (e) {
      // crew keeps a press made while jobs hold the map (409 with `waitingOn`) and runs it when they end (codex r2).
      const waiting = e instanceof ApiError && e.status === 409 && typeof e.body === 'object' && e.body !== null && Array.isArray((e.body as { waitingOn?: unknown }).waitingOn);
      setSaid(waiting ? 'Re-index requested: it runs when the job using the code map ends.' : `That didn’t work: ${errorText(e)}`);
    } finally {
      setBusy(false);
      void useRepoWatchStore.getState().load();
    }
  };
  return (
    <div className="wk-rp-upkeep" data-testid="repo-watch-controls">
      <b>Keep the code map current</b>
      <label className="wk-rp-watch-toggle">
        <input type="checkbox" data-testid="repo-watch-toggle" checked={on} disabled={busy}
          onChange={(e) => { const next = e.target.checked; void act(() => repoWatchApi.setEnabled(repoId, next), null); }} />
        <span>{!on ? 'Off: re-index it yourself after a change'
          : row.state === 'capped' ? `On, but waiting for a free slot: ${status.cap} repositories are kept current at most. Re-index now works meanwhile.`
            : 'On: re-indexed a few seconds after a change on disk, a commit or a branch switch'}</span>
      </label>
      <button type="button" className="wk-btn wk-btn--secondary" data-testid="repo-watch-reindex" disabled={busy}
        onClick={() => void act(() => repoWatchApi.reindex(repoId), 'Re-index requested.')}>
        Re-index now
      </button>
      <p data-testid="repo-watch-covers">{status.covers}</p>
      {said !== null && <p className="wk-rp-state" role="status" data-testid="repo-watch-said">{said}</p>}
    </div>
  );
}
