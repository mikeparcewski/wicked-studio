import { useMemo, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { WatchKind } from '../../api/watch-wire.js';
import { readWatch, useWatchFeed } from '../../hooks/useWatchFeed.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { jumpPath, runPath, useWatchStore, type WatchRow } from '../../store/watch.js';
import { liveCount, watchSentence } from '../desk/WatchPill.js';

/** The feed's kinds, in the words the page uses (TR §4.10's five). */
const KINDS: ReadonlyArray<{ kind: WatchKind | null; label: string }> = [
  { kind: null, label: 'Everything' },
  { kind: 'problem', label: 'Problems' },
  { kind: 'decision', label: 'Decisions' },
  { kind: 'quiet', label: 'Gone quiet' },
  { kind: 'done', label: 'Finished' },
  { kind: 'delivery', label: 'Delivered' },
];

const STATE_WORD: Record<WatchRow['state'], string> = { open: 'Open', fixed: 'Fixed', dismissed: 'Dismissed', done: 'Done' };

/** "just now" / "4 min ago" / "3 h ago" / the date — never a raw timestamp. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * THE WATCHTOWER (`/watch`, DES-STUDIO-REBUILD-001 §5.4, slice S14; TR's feed, TR-W8): the one
 * sentence the rail pill says (the needs-you count, never a second count), then the feed newest
 * first — TR's `useWatchFeed` over the registry's findings, the watchdog's quiet periods, team
 * findings and finished / delivered runs. Each row names its moment: "Jump in" lands on the run at
 * it, or the row opens its run when it names no unit.
 *
 * A route for every skin (a route is not a skin concern). A daemon without the registry says so and
 * still shows what studio folds itself; a failed read says it failed, with Try again, and is never
 * read as an empty feed.
 */
export function WatchtowerPage({ count, runs, navigate, now }: {
  count: number;
  runs: SessionView[];
  navigate: Navigate;
  now: number;
}): React.ReactElement {
  const [kind, setKind] = useState<WatchKind | null>(null);
  const all = useWatchFeed({});
  const rows = useMemo(() => (kind === null ? all : all.filter((r) => r.kind === kind)), [all, kind]);
  const feedError = useWatchStore((s) => s.feedError);
  const registry = useWatchStore((s) => s.registry);
  const [retrying, setRetrying] = useState(false);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };

  return (
    <div data-testid="watchtower" data-registry={registry} className="wk-watchtower">
      <header className="wk-watchtower-head">
        <h1 className="wk-session-title">Watchtower</h1>
        <p data-testid="watchtower-sentence" data-count={count} className="wk-session-status">{watchSentence(count, liveCount(runs))}</p>
      </header>
      <div className="wk-watchtower-body">
        <div role="group" aria-label="Show" className="wk-watchtower-kinds">
          {KINDS.map((k) => (
            <button
              key={k.label}
              type="button"
              data-testid="watchtower-kind"
              data-kind={k.kind ?? 'all'}
              aria-pressed={kind === k.kind}
              onClick={() => setKind(k.kind)}
              className={`wk-desk-chip${kind === k.kind ? ' wk-desk-chip--on' : ''}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        {registry === 'absent' && (
          <p data-testid="watchtower-no-registry" className="wk-session-grey">
            This daemon has no watch registry yet, so this shows what studio sees itself: runs gone quiet, team findings, finished and delivered work.
          </p>
        )}
        {feedError !== null && (
          <p data-testid="watchtower-error" role="alert" className="wk-session-grey">
            Could not read the Watchtower’s feed ({feedError}).{' '}
            <button
              type="button"
              data-testid="watchtower-retry"
              disabled={retrying}
              onClick={() => { setRetrying(true); void readWatch().finally(() => setRetrying(false)); }}
              className="wk-since-toggle"
            >
              {retrying ? 'Trying…' : 'Try again'}
            </button>
          </p>
        )}
        {rows.length === 0 && feedError === null && (
          <p data-testid="watchtower-empty" className="wk-session-grey">
            {kind === null
              ? 'Nothing to show yet. The Watchtower opens itself only for something that needs you.'
              : 'Nothing of this kind yet.'}
          </p>
        )}
        <ol className="wk-watchtower-feed">
          {rows.map((r) => {
            const jump = jumpPath(r);
            const open = jump ?? runPath(r);
            return (
              <li key={r.id} data-testid="watchtower-row" data-row-id={r.id} data-kind={r.kind} data-state={r.state} data-source={r.source} className="wk-watchtower-row">
                <span aria-hidden className={`wk-desk-dot wk-desk-dot--${r.state === 'open' ? (r.kind === 'problem' || r.kind === 'decision' ? 'waiting' : 'working') : 'done'}`} />
                <span className="wk-desk-need-body">
                  <span className="wk-watchtower-sentence">{r.sentence}</span>
                  <span className="wk-desk-need-line">
                    {ago(r.at, now)} · {STATE_WORD[r.state]}
                    {r.stateLine !== null && r.stateLine !== STATE_WORD[r.state] && ` — ${r.stateLine}`}
                    {r.rolledUp > 0 && ` · and ${r.rolledUp} more like it`}
                    {r.corroboratedBy.length > 0 && ' · also seen by the team'}
                  </span>
                </span>
                {open !== null && (
                  <a href={open} onClick={go(open)} data-testid={jump !== null ? 'watchtower-jump' : 'watchtower-open'} className="wk-need-act">
                    {jump !== null ? 'Jump in' : 'Open'}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
