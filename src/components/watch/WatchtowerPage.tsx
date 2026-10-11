import { useMemo, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { WatchKind } from '../../api/watch-wire.js';
import { readErrorKind } from '../../api/errors.js';
import { absTime, relTime } from '../../board/relTime.js';
import { plainRunTitle } from '../../board/deskWords.js';
import { readWatch, useWatchFeed } from '../../hooks/useWatchFeed.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { jumpPath, orphanedRuns, runPath, useWatchStore, type WatchRow } from '../../store/watch.js';
import { liveCount } from '../desk/WatchPill.js';
import { StateBanner, TechDetails } from '../ui/index.js';

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

/** Keep long engine explanations behind a disclosure, with their lead in the feed. */
export function plainWatchLine(sentence: string): { line: string; detail: string | null } {
  const colon = sentence.indexOf(': ');
  // Long engine prose, or a tail carrying internal tokens ("monitors=1", "run_unit", a path), goes
  // behind the disclosure; a short plain sentence stays whole.
  const internal = colon !== -1 && /[=_/\\]/.test(sentence.slice(colon + 2));
  // A path in the sentence ("… in /var/…") ends the plain line there; the whole sentence is the detail.
  const path = /\s+(?:in|at|on|under|from)?\s*(?:~|\$TMPDIR|\/)[\w.~$-]*\/[^\s]*/u.exec(sentence);
  if (path !== null && path.index > 0) {
    return { line: sentence.slice(0, path.index).trim().replace(/[\p{P}\s]+$/u, ''), detail: sentence };
  }
  // A parenthetical of internal tokens ("(quota_exhausted)") drops from the line, kept in the detail.
  const paren = /\s*\(([^()]*[=_/\\][^()]*)\)/u;
  if (colon === -1 && paren.test(sentence)) {
    return { line: sentence.replace(paren, '').trim(), detail: sentence };
  }
  if (colon !== -1 && (sentence.length > 60 || internal)) {
    return { line: sentence.slice(0, colon).trim().replace(/[\p{P}\s]+$/u, ''), detail: sentence };
  }
  return { line: sentence, detail: null };
}

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
 * sentence counts open feed items, then the feed newest
 * first — TR's `useWatchFeed` over the registry's findings, the watchdog's quiet periods, team
 * findings and finished / delivered runs. Each row names its moment: "Jump in" lands on the run at
 * it, or the row opens its run when it names no unit.
 *
 * A route for every skin (a route is not a skin concern). A daemon without the registry says so and
 * still shows what studio folds itself; a failed read says it failed, with Try again, and is never
 * read as an empty feed.
 */
export function WatchtowerPage({ runs, navigate, now }: {
  count: number;
  runs: SessionView[];
  navigate: Navigate;
  now: number;
}): React.ReactElement {
  const [kind, setKind] = useState<WatchKind | null>(null);
  const all = useWatchFeed({});
  const openCount = all.filter((r) => r.state === 'open').length;
  const live = liveCount(runs);
  const work = live === 0 ? 'nothing is running' : live === 1 ? '1 thing is running' : `${live} things are running`;
  const sentence = openCount === 0 ? `Nothing open — ${work}.` : `${openCount} open ${openCount === 1 ? 'item' : 'items'} — ${work}.`;
  const rows = useMemo(() => (kind === null ? all : all.filter((r) => r.kind === kind)), [all, kind]);
  const feedError = useWatchStore((s) => s.feedError);
  const registry = useWatchStore((s) => s.registry);
  // studio#545: runs a daemon restart orphaned — nobody is working on them until a Resume.
  const orphaned = useWatchStore((s) => Object.keys(orphanedRuns(s.fold)).length);
  const [retrying, setRetrying] = useState(false);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  // Rows that say the same thing about different work tell the work apart (UX gate S1: DUP).
  const workOf = (runId: string | null): string | null => {
    if (runId === null) return null;
    const t = plainRunTitle(runs.find((v) => v.session.id === runId)?.session.problem ?? '').trim();
    return t === '' ? null : t;
  };

  return (
    <div data-testid="watchtower" data-registry={registry} className="wk-watchtower">
      <header className="wk-watchtower-head">
        <h1 className="wk-session-title">Watchtower</h1>
        {/* No verdict over a feed that could not be read (the banner below says so). */}
        {!(feedError !== null && all.length === 0) && (
          <p data-testid="watchtower-sentence" data-count={openCount} className="wk-session-status">{sentence}</p>
        )}
        {orphaned > 0 && (
          <p data-testid="watchtower-orphaned" data-count={orphaned} className="wk-session-grey">
            {orphaned === 1 ? '1 run was orphaned by a restart — nothing is working on it.' : `${orphaned} runs were orphaned by a restart — nothing is working on them.`}
          </p>
        )}
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
              className="wk-chip"
            >
              {k.label}
            </button>
          ))}
        </div>
        {registry === 'absent' && (
          <p data-testid="watchtower-no-registry" className="wk-session-grey">
            Studio's service doesn't keep a watch list yet, so this shows what studio sees itself: sessions gone quiet, team findings, finished and delivered work.
          </p>
        )}
        {feedError !== null && (
          <StateBanner
            data-testid="watchtower-error"
            kind={readErrorKind(feedError)}
            what="the Watchtower feed"
            error={feedError}
            onRetry={() => { setRetrying(true); void readWatch().finally(() => setRetrying(false)); }}
            retrying={retrying}
          />
        )}
        {rows.length === 0 && feedError === null && (
          <p data-testid="watchtower-empty" className="wk-session-grey">
            {kind === null
              ? 'Nothing to show yet. Anything that needs you appears here.'
              : 'Nothing of this kind yet.'}
          </p>
        )}
        <ol className="wk-watchtower-feed">
          {rows.map((r) => {
            const jump = jumpPath(r);
            const open = jump ?? runPath(r);
            const { line, detail } = plainWatchLine(r.sentence);
            return (
              <li key={r.id} data-testid="watchtower-row" data-row-id={r.id} data-kind={r.kind} data-state={r.state} data-source={r.source} className="wk-watchtower-row">
                <span aria-hidden className={`wk-desk-dot wk-desk-dot--${r.state === 'open' ? (r.kind === 'problem' || r.kind === 'decision' ? 'waiting' : 'working') : 'done'}`} />
                <div className="wk-desk-need-body">
                  <span className="wk-watchtower-sentence">{line}</span>
                  <span className="wk-desk-need-line">
                    <span title={absTime(r.at)}>{relTime(r.at, now)}</span>
                    {workOf(r.runId) !== null && <> · <span data-testid="watchtower-row-work">{workOf(r.runId)}</span></>}
                    {' · '}{STATE_WORD[r.state]}
                    {r.stateLine !== null && r.stateLine !== STATE_WORD[r.state] && ` — ${r.stateLine}`}
                    {r.rolledUp > 0 && ` · and ${r.rolledUp} more like it`}
                    {r.corroboratedBy.length > 0 && ' · also seen by the team'}
                  </span>
                  {detail !== null && <TechDetails data-testid="watchtower-row-detail" text={detail} />}
                </div>
                {open !== null && (
                  <a href={open} onClick={go(open)} data-testid={jump !== null ? 'watchtower-jump' : 'watchtower-open'} className="wk-btn wk-btn--secondary wk-btn--sm">
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
