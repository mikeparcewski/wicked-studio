import { useEffect } from 'react';
import { useRedeliverStore } from '../store/redeliver.js';
import { TechDetails } from './ui/TechDetails.js';

interface Props {
  runId: string;
  onRevise?: (context: string) => void;
}

const buttonClass = 'rounded-lg px-3 py-1.5 text-xs font-semibold font-mono transition-opacity disabled:opacity-40 disabled:cursor-not-allowed';
const buttonStyle = { background: 'var(--surface-raised)', border: '1px solid var(--ink-dim)', color: 'var(--ink-muted)', alignSelf: 'flex-start' };

/** crew#1493: every word comes from RunPullRequest / RedeliverRunResult or the refusal body.
 * "Nothing was pushed" is only for conflicts / failingChecks bodies: crew throws them before push. */
export function PrRedeliver({ runId, onRevise }: Props): React.ReactElement | null {
  const entry = useRedeliverStore((s) => s.byRun[runId]);
  useEffect(() => { useRedeliverStore.getState().load(runId); }, [runId]);

  const read = entry?.pr;
  const delivery = entry?.redeliver;
  // Nothing until crew answered (no empty gap under the link), and nothing on a crew without the route.
  if ((read === undefined || read.phase === 'absent') && delivery === undefined) return null;
  const pr = read?.phase === 'loaded' ? read.pr : undefined;
  const result = delivery?.phase === 'done' ? delivery.result : undefined;
  const refusal = delivery?.phase === 'refused' ? delivery : undefined;
  const conflicts = refusal?.conflicts;
  const failingChecks = refusal?.failingChecks;
  const reviseChecks = (names: string[]) => onRevise?.(names.length > 0 ? `fix the failing checks: ${names.join(', ')}` : 'fix the repo checks that failed on the rebased tree');
  // Right after a re-delivery the shown PR can still be the pre-push read: no second POST off that snapshot.
  const staleAfterPush = result !== undefined && pr !== undefined && pr.headSha === result.oldHead;

  return (
    <div className="flex flex-col gap-1.5">
      {read?.phase === 'error' && (
        <div data-testid="run-pr-unread" style={{ color: 'var(--ink-muted)' }}>
          <p>Crew can't show this PR's state.</p>
          <TechDetails text={read.error} />
        </div>
      )}
      {pr !== undefined && (
        <>
          <p data-testid="run-pr-status" className="font-mono" style={{ color: 'var(--ink-muted)' }}>GitHub: {pr.state} · mergeable {pr.mergeable} · merge state {pr.mergeStateStatus}</p>
          {pr.state === 'OPEN' && pr.mergeable === 'CONFLICTING' && (
            <>
              <p data-testid="run-pr-conflict" style={{ color: 'var(--status-warn)' }}>This PR conflicts with {pr.baseRefName} (mergeable {pr.mergeable}).</p>
              {pr.deliveredHead === undefined ? (
                <p data-testid="run-pr-no-delivered-head" style={{ color: 'var(--status-warn)' }}>Crew has no recorded delivered head for this PR, so it cannot re-deliver it.</p>
              ) : pr.headMoved ? (
                <p data-testid="run-pr-moved" style={{ color: 'var(--status-warn)' }}>The PR branch moved since crew delivered it (now {pr.headSha.slice(0, 7)}, delivered {pr.deliveredHead.slice(0, 7)}); crew will not re-deliver over it.</p>
              ) : staleAfterPush ? null : (
                <div>
                  <button
                    type="button"
                    data-testid="run-redeliver-button"
                    className={buttonClass}
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                    disabled={delivery?.phase === 'running'}
                    onClick={() => useRedeliverStore.getState().redeliver(runId)}
                  >
                    {delivery?.phase === 'running' ? 'Rebasing and re-delivering…' : 'Rebase and re-deliver'}
                  </button>
                </div>
              )}
            </>
          )}
          {pr.failingChecks.length > 0 && (
            <>
              <p data-testid="run-pr-checks-failing" style={{ color: 'var(--status-fail)' }}>Failing checks on GitHub: {pr.failingChecks.join(', ')}</p>
              {onRevise !== undefined && (
                <button type="button" data-testid="run-pr-checks-revise" className={buttonClass} style={buttonStyle} onClick={() => reviseChecks(pr.failingChecks)}>
                  Revise this PR to fix the checks
                </button>
              )}
            </>
          )}
        </>
      )}
      {result !== undefined && (
        <p data-testid="run-redeliver-result" style={{ color: 'var(--ink-muted)' }}>
          Re-delivered: {result.oldHead.slice(0, 7)} → {result.newHead.slice(0, 7)}. Repo checks on the new tree: PASS ({result.checks.count} checks{result.checks.names.length > 0 && <>: {result.checks.names.join(', ')}</>}).
          {result.conflictsResolved.length > 0 && <> Changelog conflicts resolved: {result.conflictsResolved.join(', ')}.</>}
        </p>
      )}
      {refusal !== undefined && (
        conflicts !== undefined ? (
          <>
            <div data-testid="run-redeliver-conflicts" style={{ color: 'var(--status-fail)' }}>
              <p>Rebase stopped: these files conflict with {refusal.base ?? "the PR's base"} outside the changelog. Nothing was pushed.</p>
              <ul>
                {conflicts.map((file) => <li key={file} data-testid="run-redeliver-conflict-file" className="font-mono">{file}</li>)}
              </ul>
            </div>
            {onRevise !== undefined && (
              <button type="button" data-testid="run-redeliver-revise" className={buttonClass} style={buttonStyle} onClick={() => onRevise(`resolve the merge conflict with ${refusal.base !== undefined ? `origin/${refusal.base}` : "the PR's base"} in ${conflicts.join(', ')} (${refusal.base !== undefined ? `merge origin/${refusal.base}` : "merge the PR's base branch"})`)}>
                Revise this PR to resolve it
              </button>
            )}
          </>
        ) : failingChecks !== undefined ? (
          <>
            <p data-testid="run-redeliver-failing" style={{ color: 'var(--status-fail)' }}>Repo checks failed on the rebased tree{failingChecks.length > 0 ? `: ${failingChecks.join(', ')}` : ''}. Nothing was pushed.</p>
            {onRevise !== undefined && (
              <button type="button" data-testid="run-redeliver-revise" className={buttonClass} style={buttonStyle} onClick={() => reviseChecks(failingChecks)}>
                Revise this PR to resolve it
              </button>
            )}
          </>
        ) : (
          <div data-testid="run-redeliver-error" className="flex flex-col gap-1" style={{ color: 'var(--status-fail)' }}>
            <p>Re-delivery refused.</p>
            <p className="font-mono break-words whitespace-pre-wrap">{refusal.error}</p>
          </div>
        )
      )}
    </div>
  );
}
