import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decisionsApi, type DecisionView } from '../../api/decisions.js';
import { isRouteUnsupported } from '../../api/errors.js';
import { gateDecisionRows, type GateAnswer } from '../../board/gateDecisionRows.js';
import { sessionPath } from '../../board/sessionModel.js';
import type { SessionView } from '../../api/types.js';
import type { WatchKind } from '../../api/watch-wire.js';
import { readErrorKind } from '../../api/errors.js';
import { absTime, relTime } from '../../board/relTime.js';
import { fullRunTitle, jobTitle } from '../../board/deskWords.js';
import { deskReadState } from '../../board/deskModel.js';
import { wireDelivery } from '../../board/windowStats.js';
import { readWatch, useWatchFeed } from '../../hooks/useWatchFeed.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { jumpPath, orphanedRuns, runPath, useWatchStore, type WatchRow } from '../../store/watch.js';
import { deskLiveCounts } from '../../board/statusWords.js';
import { plainWatchLine } from '../../board/watchLine.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { StateBanner, TechDetails } from '../ui/index.js';

/** The runs moving right now: the Desk's own count (statusWord via deskLiveCounts), so a gate, a paused
 *  run, an idle chat and a run Needs you holds are not "running" here either (studio#805). */
export function liveCount(runs: readonly SessionView[]): number {
  return deskLiveCounts(runs).working;
}

/** The feed's kinds, in the words the page uses (TR §4.10's five). */
type FilterKind = WatchKind | GateAnswer;
const KINDS: ReadonlyArray<{ kind: FilterKind | null; label: string }> = [
  { kind: null, label: 'Everything' },
  { kind: 'problem', label: 'Problems' },
  { kind: 'decision', label: 'Decisions' },
  // Operator ruling 2026-10-12: your own gate answers, beside Decisions.
  { kind: 'approved', label: 'Approved' },
  { kind: 'rejected', label: 'Rejected' },
  { kind: 'quiet', label: 'Gone quiet' },
  { kind: 'done', label: 'Finished' },
  { kind: 'delivery', label: 'Delivered' },
];

/** `?filter=` on the address, when it names one of the page's kinds; anything else is Everything. */
export function readFilterParam(search: string = typeof window === 'undefined' ? '' : window.location.search): FilterKind | null {
  const v = new URLSearchParams(search).get('filter');
  return KINDS.find((k) => k.kind !== null && k.kind === v)?.kind ?? null;
}

const STATE_WORD: Record<WatchRow['state'], string> = { open: 'Open', fixed: 'Fixed', dismissed: 'Dismissed', done: 'Done' };

export { plainWatchLine } from '../../board/watchLine.js';

/** Adjacent rows about the same work that say the same thing in the same state fold into the newest
 *  one, with a count (UX gate S1: "Nothing checked this step" six times for one session). Pure. */
export function foldAlike(rows: readonly WatchRow[]): { row: WatchRow; alike: number; details: string[] }[] {
  const out: { row: WatchRow; alike: number; details: string[] }[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev !== undefined && r.runId !== null && prev.row.runId === r.runId && prev.row.state === r.state
      && prev.row.kind === r.kind && plainWatchLine(prev.row.sentence).line === plainWatchLine(r.sentence).line) {
      prev.alike += 1 + r.rolledUp;
      // The folded rows' own words stay one click away, in the kept row's Technical details.
      if (!prev.details.includes(r.sentence)) prev.details.push(r.sentence);
      continue;
    }
    out.push({ row: r, alike: 0, details: [r.sentence] });
  }
  return out;
}

/** Kinds folded from the session list: a failed or pending read of it gives them no verdict. */
const FROM_RUNS: ReadonlySet<FilterKind> = new Set<FilterKind>(['done', 'delivery', 'quiet', 'approved', 'rejected']);

/** Why a kind is empty, said from what the session list holds — never "nothing" over a read
 *  that brought nothing back (that is the banner's job). Pure. */
export function emptyLine(kind: FilterKind | null, runs: readonly SessionView[], live: number): string {
  const finished = runs.filter((v) => v.session.status === 'completed');
  switch (kind) {
    case null: return 'Nothing to show yet. Anything that needs you appears here.';
    case 'problem': return 'No problems raised. When a check or a reviewer finds one, it appears here.';
    case 'decision': return 'Nothing is waiting on your decision. Studio asks here when it spots a pattern worth a rule, such as a step you keep adding by hand.';
    case 'quiet': return live === 0
      ? 'Nothing has gone quiet. Nothing is running right now.'
      // The watchdog's frames are folded live only, so a quiet period that began before this page
      // opened is not here: the line says only what it can vouch for.
      : 'Nothing has gone quiet since this page opened.';
    case 'done': {
      const ended = runs.filter((v) => v.session.status === 'failed' || v.session.status === 'cancelled').length;
      return ended === 0 ? 'Nothing has finished yet.' : `Nothing has finished yet. ${ended === 1 ? 'One session' : `${ended} sessions`} ended without finishing (failed or cancelled).`;
    }
    case 'delivery': {
      if (finished.length === 0) return 'Nothing delivered yet. Nothing has finished.';
      // Only a run whose delivery the wire states can be said not to have delivered.
      const left = finished.filter((v) => { const d = wireDelivery(v); return d !== null && d !== 'delivered' && d !== 'pushed'; }).length;
      const silent = finished.length - left;
      if (left === 0) return 'Nothing delivered yet. Studio’s service does not say whether the finished sessions were delivered.';
      const did = left === 1 ? '1 finished session did' : `${left} finished sessions did`;
      if (silent > 0) return `Nothing delivered yet. ${did} not open a pull request or push a branch; ${silent === 1 ? '1 more does' : `${silent} more do`} not say.`;
      return left === 1
        ? 'Nothing delivered yet. The one finished session did not open a pull request or push a branch.'
        : `Nothing delivered yet. None of the ${left} finished sessions opened a pull request or pushed a branch.`;
    }
    case 'approved': return 'You have not approved anything at a gate yet. Your approvals appear here.';
    case 'rejected': return 'You have not rejected or sent back anything at a gate yet. Those answers appear here.';
    default: return 'Nothing of this kind yet.';
  }
}

/** A launch clock standing in for a finish time: the date and minute ("Sep 7, 14:12"), so
 *  sessions started the same month are told apart (a relative "1 month ago" says it 44 times). */
export function startedWhen(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
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
export function WatchtowerPage({ runs, runsLoaded = true, runsError = null, onRetryRuns, navigate, now, search = window.location.search, embedded = false }: {
  count: number;
  /** Inside Nerve Center (DES-SYSTEM-VIEW): the feed under the panels — its heading is a section's,
   *  and the dashboard's scroller scrolls it (no scroller of its own, no page measure). */
  embedded?: boolean;
  runs: SessionView[];
  /** Whether a `GET /runs` has answered (App's `useRuns`). */
  runsLoaded?: boolean;
  /** The newest `GET /runs` failed: Finished / Delivered / Gone quiet get no verdict from it. */
  runsError?: string | null;
  onRetryRuns?: () => void;
  navigate: Navigate;
  now: number;
  /** The router's query, updated by navigation and Back/Forward. */
  search?: string;
}): React.ReactElement {
  // The filter rides `?filter=<kind>` so a link can open the page filtered (the Desk's Needs you
  // block opens `?filter=decision`); picking a chip keeps the address in step (replace, no history).
  const [kind, setKindState] = useState<FilterKind | null>(() => readFilterParam(search));
  useEffect(() => { setKindState(readFilterParam(search)); }, [search]);
  const setKind = useCallback((k: FilterKind | null): void => {
    setKindState(k);
    const params = new URLSearchParams(search);
    if (k === null) params.delete('filter'); else params.set('filter', k);
    // Inside Nerve Center the feed is the Runs tab's: picking a chip keeps the page on it (a bare
    // `?filter=` opened Runs; clearing it must not drop the page back to its landing tab).
    if (embedded && !params.has('tab')) params.set('tab', 'runs');
    const query = params.toString();
    navigate(`/watch${query ? `?${query}` : ''}${window.location.hash}`, { replace: true });
  }, [navigate, search, embedded]);
  const gateKind = kind === 'approved' || kind === 'rejected' ? kind : null;
  // The decision record (`GET /decisions`), read when the page opens: the Approved / Rejected source.
  const [ledger, setLedger] = useState<{ decisions: DecisionView[]; error: string | null; loaded: boolean; unread: 'absent' | 'off' | null }>({ decisions: [], error: null, loaded: false, unread: null });
  // A read that lands after the page is gone sets nothing (a setState on an unmounted page still
  // touches `window`, which a torn-down test environment no longer has).
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const readLedger = useCallback((): Promise<void> => decisionsApi.list()
    .then((r) => { if (mounted.current) setLedger({ decisions: r.decisions ?? [], error: null, loaded: true, unread: r.mode === 'off' ? 'off' : null }); })
    .catch((e: unknown) => {
      if (!mounted.current) return;
      // A daemon without the record: nothing to list, said by the empty line, not as a failure.
      const absent = isRouteUnsupported(e);
      setLedger({ decisions: [], error: absent ? null : e instanceof Error ? e.message : String(e), loaded: true, unread: absent ? 'absent' : null });
    }), []);
  useEffect(() => { void readLedger(); }, [readLedger]);
  const gateRows = useMemo(() => (gateKind === null ? [] : gateDecisionRows(ledger.decisions, runs).filter((g) => g.answer === gateKind)), [gateKind, ledger.decisions, runs]);
  const [ledgerRetrying, setLedgerRetrying] = useState(false);
  const all = useWatchFeed({});
  const openCount = all.filter((r) => r.state === 'open').length;
  const live = liveCount(runs);
  const work = live === 0 ? 'nothing is running' : live === 1 ? '1 thing is running' : `${live} things are running`;
  const sentence = openCount === 0 ? `Nothing open — ${work}.` : `${openCount} open ${openCount === 1 ? 'item' : 'items'} — ${work}.`;
  const rows = useMemo(() => (kind === null ? all : gateKind !== null ? [] : all.filter((r) => r.kind === kind)), [all, kind, gateKind]);
  // Run rows dated by their launch (or not at all): said once above the feed, not on every row.
  const undated = new Set(rows.filter((r) => r.clock !== undefined).map((r) => r.runId)).size;
  const feedError = useWatchStore((s) => s.feedError);
  const registry = useWatchStore((s) => s.registry);
  // studio#545: runs a daemon restart orphaned — nobody is working on them until a Resume.
  const orphaned = useWatchStore((s) => Object.keys(orphanedRuns(s.fold)).length);
  const [retrying, setRetrying] = useState(false);
  const runsRead = deskReadState(runsLoaded, runsError);
  const displayText = useDisplayText();
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  // Rows that say the same thing about different work tell the work apart (UX gate S1: DUP).
  // A run row leads with the longer title, clamped by CSS, so runs whose first words match still
  // differ on screen (UX gate: two "Recon: survey the target…" rows read the same).
  const fullWork = (runId: string | null): string | null => {
    if (runId === null) return null;
    const t = fullRunTitle(runs.find((v) => v.session.id === runId)?.session.problem ?? '').trim();
    return t === '' ? null : t;
  };
  const workOf = (runId: string | null): string | null => {
    if (runId === null) return null;
    const v = runs.find((x) => x.session.id === runId);
    const t = v === undefined ? '' : jobTitle(v.session).trim();
    return t === '' ? null : t;
  };

  return (
    <div data-testid="watchtower" data-registry={registry} className={`wk-watchtower${embedded ? ' wk-watchtower--embedded' : ''}`}>
      <header className={`wk-watchtower-head${embedded ? '' : ' wk-measure'}`}>
        {embedded ? <h2 className="wk-nc-panel-title">Feed</h2> : <h1 className="wk-session-title">Watchtower</h1>}
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
      <div className={`wk-watchtower-body${embedded ? '' : ' wk-measure'}`}>
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
        {(runsRead === 'failed' || runsRead === 'stale') && runsError !== null && (
          <StateBanner
            data-testid="watchtower-runs-failed"
            kind={runsRead === 'stale' ? 'stale' : readErrorKind(runsError)}
            what="your sessions"
            error={displayText(runsError)}
            {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})}
          />
        )}
        {gateKind !== null && ledger.error !== null && (
          <StateBanner
            data-testid="watchtower-ledger-failed"
            kind={readErrorKind(ledger.error)}
            what="your gate answers"
            error={displayText(ledger.error)}
            onRetry={() => { setLedgerRetrying(true); void readLedger().finally(() => setLedgerRetrying(false)); }}
            retrying={ledgerRetrying}
          />
        )}
        {gateKind !== null && gateRows.length > 0 && (
          <ol className="wk-watchtower-feed" data-testid="watchtower-gate-feed">
            {gateRows.map((g) => {
              const open = sessionPath(`run:${g.runId}`);
              const work = fullWork(g.runId);
              return (
                <li key={g.id} data-testid="watchtower-row" data-row-id={g.id} data-kind={g.answer} data-source="gate" className="wk-watchtower-row">
                  <span aria-hidden className={`wk-desk-dot wk-desk-dot--${g.answer === 'rejected' ? 'waiting' : 'done'}`} />
                  <div className="wk-desk-need-body">
                    <span className="wk-watchtower-sentence"><span data-testid="watchtower-row-work" className="wk-watchtower-work">{work ?? 'A session'}</span></span>
                    <span className="wk-desk-need-line">
                      <span data-testid="watchtower-row-verb">{g.verb}</span>
                      {g.step !== null && <>{' · '}<span data-testid="watchtower-row-step">{g.step}</span></>}
                      {' · '}<span title={absTime(g.at)}>{relTime(g.at, now)}</span>
                    </span>
                    {g.note !== null && <span data-testid="watchtower-row-note" className="wk-watchtower-note">“{g.note}”</span>}
                  </div>
                  <a href={open} onClick={go(open)} data-testid="watchtower-open" className="wk-btn wk-btn--secondary wk-btn--sm">Open</a>
                </li>
              );
            })}
          </ol>
        )}
        {gateKind !== null && gateRows.length === 0 && ledger.loaded && ledger.error === null && runsRead === 'known' && (
          <div data-testid="watchtower-empty" data-kind={gateKind} className="wk-watchtower-empty">
            {/* codex r1: a service that keeps no record (or records nothing) is said, never read as "you never answered". */}
            <p className="wk-session-grey">{ledger.unread === 'absent'
              ? 'Studio’s service doesn’t keep a record of your gate answers, so there is nothing to list here.'
              : ledger.unread === 'off' && gateRows.length === 0 && ledger.decisions.length === 0
                ? 'Studio’s service is not recording your gate answers, so there is nothing to list here.'
                : emptyLine(gateKind, runs, live)}</p>
            <button type="button" data-testid="watchtower-show-all" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => setKind(null)}>
              Show everything
            </button>
          </div>
        )}
        {gateKind !== null && gateRows.length === 0 && ledger.error === null && (!ledger.loaded || runsRead === 'checking') && (
          <p data-testid="watchtower-checking" className="wk-session-grey">Reading your gate answers…</p>
        )}
        {gateKind === null && rows.length === 0 && feedError === null && ((kind !== null && !FROM_RUNS.has(kind)) || runsRead === 'known') && (
          <div data-testid="watchtower-empty" data-kind={kind ?? 'all'} className="wk-watchtower-empty">
            <p className="wk-session-grey">{emptyLine(kind, runs, live)}</p>
            {kind !== null && (
              <button type="button" data-testid="watchtower-show-all" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => setKind(null)}>
                Show everything
              </button>
            )}
          </div>
        )}
        {gateKind === null && rows.length === 0 && (kind === null || FROM_RUNS.has(kind)) && runsRead === 'checking' && (
          <p data-testid="watchtower-checking" className="wk-session-grey">Reading your sessions…</p>
        )}
        {gateKind === null && undated > 0 && (
          <p data-testid="watchtower-undated" data-count={undated} className="wk-session-grey">
            No finish time was recorded for {undated === 1 ? '1 session' : `${undated} sessions`}. {undated === 1 ? 'It shows' : 'They show'} when {undated === 1 ? 'it' : 'they'} started, where that is known.
          </p>
        )}
        <ol className="wk-watchtower-feed" hidden={gateKind !== null}>
          {foldAlike(rows).map(({ row: r, alike, details }) => {
            const jump = jumpPath(r);
            const open = jump ?? runPath(r);
            const { line, detail: own } = plainWatchLine(r.sentence);
            const detail = details.length > 1 ? details.join('\n') : own;
            const work = workOf(r.runId);
            const named = r.source === 'run' && work !== null;
            return (
              <li key={r.id} data-testid="watchtower-row" data-row-id={r.id} data-kind={r.kind} data-state={r.state} data-source={r.source} className="wk-watchtower-row">
                <span aria-hidden className={`wk-desk-dot wk-desk-dot--${r.state === 'open' ? (r.kind === 'problem' || r.kind === 'decision' ? 'waiting' : 'working') : 'done'}`} />
                <div className="wk-desk-need-body">
                  {/* A run's own row (Finished / Delivered) leads with its work and keeps the kind word
                      in the line under it, so 44 "Finished" rows are told apart at a glance. */}
                  <span className="wk-watchtower-sentence">
                    {named ? <span data-testid="watchtower-row-work" className="wk-watchtower-work" title={fullWork(r.runId) ?? undefined}>{fullWork(r.runId) ?? work}</span> : line}
                  </span>
                  <span className="wk-desk-need-line">
                    {named && <><span data-testid="watchtower-row-kind">{line}</span>{' · '}</>}
                    {r.clock === 'unknown'
                      ? <span data-testid="watchtower-row-clock" data-clock="unknown">Time not recorded</span>
                      : r.clock === 'started'
                        ? <span data-testid="watchtower-row-clock" data-clock="started" title={absTime(r.at)}>Started {startedWhen(r.at)}</span>
                        : <span title={absTime(r.at)}>{relTime(r.at, now)}</span>}
                    {r.source !== 'run' && work !== null && <> · <span data-testid="watchtower-row-work">{work}</span></>}
                    {/* "Done" under "Finished" says it twice: the kind word is the state. */}
                    {r.state !== 'done' && <>{' · '}{STATE_WORD[r.state]}</>}
                    {r.stateLine !== null && r.stateLine !== STATE_WORD[r.state] && ` — ${r.stateLine}`}
                    {r.rolledUp + alike > 0 && ` · and ${r.rolledUp + alike} more like it`}
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
