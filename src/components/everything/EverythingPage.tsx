import { useEffect, useMemo, useRef, useState } from 'react';
import type { RosterSeat, SessionView } from '../../api/types.js';
import { deskReadState, needsByRun, needTextByRun, railGroups, type RailGroup } from '../../board/deskModel.js';
import {
  EVERYTHING_TABS, everythingPath, filterGroups, handedRows, MADE_KINDS, MADE_WORD, madeRows, readEverythingQuery,
  SESSION_FILTERS, TAB_LABEL, type EverythingQuery, type EverythingTab, type HandedRow, type MadeRow,
} from '../../board/everythingModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { sessionPath } from '../../board/sessionModel.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useRoster } from '../../hooks/useRoster.js';
import { modePath, projectDetailPath, projectPath, type Navigate, versionPath } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useDocsCache } from '../../store/docsCache.js';
import { useMembershipStore } from '../../store/membership.js';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import { useProjectsStore } from '../../store/projects.js';
import { ageWord } from '../DashboardTiles.js';
import { seatStandingWord } from '../HealthRailSection.js';
import { SignInPanel } from '../SignInPanel.js';
import { Tech } from '../Tech.js';

/**
 * "SEE EVERYTHING" (`/everything`, DES-STUDIO-REBUILD-001 §5.4, slice S15c) — one page, four tabs,
 * under the shell of every skin: Sessions, Everything made, Helpers, Handed over. Render only: the
 * folds are `board/everythingModel.ts` over `useBoardModel`, the docs cache, the roster and the
 * delivery facts studio already reads.
 *
 *  - The tab, the Sessions filter (`?filter=`, the old `/work` words), the project scope (`?project=`)
 *    and the Made kind (`?kind=`) are the address: a tab is a page (pushed), a filter is a lens on it
 *    (replaced), so Back leaves the page the way the operator came.
 *  - Keyboard: the tabs are an ARIA tablist — arrows, Home and End move and pick (§5.6 rule 2); every
 *    row is a link.
 *  - Plain words, the Desk's palette, no KPI tile.
 */
export function EverythingPage({ runs, runsLoaded, runsError = null, onRetryRuns, needRows, navigate, search, routeProjectId = null }: {
  runs: SessionView[];
  runsLoaded: boolean;
  runsError?: string | null;
  onRetryRuns?: () => void;
  needRows: NeedRow[];
  navigate: Navigate;
  /** The current `location.search` — the tab, filter, scope and kind. */
  search: string;
  /** The project a moved `/p/:id[/chronicle]` address names, for the tick before the address is replaced. */
  routeProjectId?: string | null;
}): React.ReactElement {
  const q = readEverythingQuery(search);
  const project = q.project ?? routeProjectId;
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pick = (tab: EverythingTab): void => { navigate(everythingPath({ ...q, tab, project })); };
  const onTabKey = (e: React.KeyboardEvent, i: number): void => {
    const n = EVERYTHING_TABS.length;
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to === null) return;
    e.preventDefault();
    const tab = EVERYTHING_TABS[to]!;
    tabRefs.current[tab]?.focus();
    pick(tab);
  };

  return (
    <div data-testid="everything" data-tab={q.tab} className="wk-desk wk-everything">
      <div className="wk-desk-scroll" data-place-scroll="everything">
        <header className="wk-everything-head">
          <h1 className="wk-desk-hello">Everything</h1>
          <p className="wk-desk-date">Every session, everything made, your helpers, and what was handed over.</p>
          <div role="tablist" aria-label="Everything" className="wk-everything-tabs">
            {EVERYTHING_TABS.map((tab, i) => (
              <button
                key={tab}
                ref={(el) => { tabRefs.current[tab] = el; }}
                type="button"
                role="tab"
                id={`everything-tab-${tab}`}
                aria-selected={q.tab === tab}
                aria-controls="everything-panel"
                tabIndex={q.tab === tab ? 0 : -1}
                data-testid="everything-tab"
                data-tab={tab}
                onClick={() => pick(tab)}
                onKeyDown={(e) => onTabKey(e, i)}
                className="wk-everything-tab"
              >
                {TAB_LABEL[tab]}
              </button>
            ))}
          </div>
        </header>
        <section id="everything-panel" role="tabpanel" aria-labelledby={`everything-tab-${q.tab}`} data-testid="everything-panel" data-tab={q.tab} className="wk-everything-panel">
          {q.tab === 'sessions' && (
            <SessionsTab runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns} needRows={needRows} q={{ ...q, project }} navigate={navigate} go={go} />
          )}
          {q.tab === 'made' && <MadeTab runs={runs} q={q} navigate={navigate} go={go} />}
          {q.tab === 'helpers' && <HelpersTab go={go} />}
          {q.tab === 'handed' && <HandedTab runs={runs} runsLoaded={runsLoaded} go={go} />}
        </section>
      </div>
    </div>
  );
}

type Go = (path: string) => (e: React.MouseEvent) => void;

function useProjectName(): (id: string | null) => string {
  const projects = useProjectsStore((s) => s.projects);
  return (id) => (id === null ? 'Not in a project' : projects.find((p) => p.id === id)?.name ?? id);
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────

function SessionsTab({ runs, runsLoaded, runsError, onRetryRuns, needRows, q, navigate, go }: {
  runs: SessionView[];
  runsLoaded: boolean;
  runsError: string | null;
  onRetryRuns: (() => void) | undefined;
  needRows: NeedRow[];
  q: EverythingQuery;
  navigate: Navigate;
  go: Go;
}): React.ReactElement {
  const { items, unfiled } = useBoardModel(runs);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const nameOf = useProjectName();
  const groups = useMemo(
    () => railGroups(items, unfiled, needsByRun(needRows), Number.POSITIVE_INFINITY, needTextByRun(needRows), runChatId, deliveredNow),
    [items, unfiled, needRows, runChatId, deliveredNow],
  );
  const shown: RailGroup[] = filterGroups(groups, q.filter, q.project);
  // What the scope holds before the state filter: one project's sessions, or every project's — so
  // an empty project says "nothing started here", not "nothing matches this filter".
  const inScope = q.project === null ? groups : groups.filter((g) => g.projectId === q.project);
  const total = inScope.reduce((n, g) => n + g.sessions.length, 0);
  const read = deskReadState(runsLoaded, runsError);
  const lens = (over: Partial<EverythingQuery>): string => everythingPath({ tab: 'sessions', filter: q.filter, project: q.project, ...over });
  const scopeName = q.project !== null ? nameOf(q.project) : null;

  return (
    <div data-testid="everything-sessions" data-count={total} data-filter={q.filter} data-project={q.project ?? ''}>
      <div className="wk-everything-bar">
        <div role="group" aria-label="Show" className="wk-everything-chips">
          {SESSION_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={q.filter === f.id}
              data-testid="everything-filter"
              data-filter={f.id}
              onClick={() => navigate(lens({ filter: f.id }), { replace: true })}
              className="wk-chip"
            >
              {f.label}
            </button>
          ))}
        </div>
        {scopeName !== null && (
          <p data-testid="everything-scope" data-project-id={q.project ?? ''} className="wk-everything-scope">
            In <b>{scopeName}</b>
            {' · '}
            <a href={lens({ project: null })} onClick={(e) => { e.preventDefault(); navigate(lens({ project: null }), { replace: true }); }} data-testid="everything-scope-clear">Every project</a>
          </p>
        )}
      </div>
      {read === 'checking' && <p data-testid="everything-checking" className="wk-session-grey">Reading your work…</p>}
      {read === 'failed' && (
        <p data-testid="everything-failed" role="alert" className="wk-session-grey">
          Couldn’t read your work ({runsError}).
          {onRetryRuns !== undefined && <> <button type="button" data-testid="everything-retry" onClick={onRetryRuns} className="wk-since-toggle">Try again</button></>}
        </p>
      )}
      {read === 'stale' && <p className="wk-session-grey">The last read failed ({runsError}); this is the list as last read.</p>}
      {(read === 'known' || read === 'stale') && total === 0 && (
        <p data-testid="everything-empty" className="wk-session-grey">
          {q.project !== null ? 'Nothing has been started in this project yet.' : 'Nothing has been started yet.'}
        </p>
      )}
      {(read === 'known' || read === 'stale') && total > 0 && shown.length === 0 && (
        <p data-testid="everything-empty" className="wk-session-grey">
          No sessions match this filter{scopeName !== null ? ` in ${scopeName}` : ''}.{' '}
          <button type="button" data-testid="everything-show-all" onClick={() => navigate(lens({ filter: 'all' }), { replace: true })} className="wk-since-toggle">Show all</button>
        </p>
      )}
      {shown.map((g) => (
        <section key={g.projectId ?? 'unfiled'} data-testid="everything-group" data-project-id={g.projectId ?? ''} className="wk-desk-card wk-everything-group">
          <p className="wk-desk-card-title">
            <span>{g.name}</span>
            {g.projectId !== null && (
              <span className="wk-desk-card-aside wk-everything-aside">
                <a href={projectDetailPath(g.projectId)} onClick={go(projectDetailPath(g.projectId))} data-testid="everything-group-details">details</a>
                {' · '}
                <a href={`${projectPath(g.projectId)}/campaigns`} onClick={go(`${projectPath(g.projectId)}/campaigns`)} data-testid="everything-group-tests">tests</a>
              </span>
            )}
          </p>
          {g.sessions.map((s) => (
            <a
              key={s.id}
              href={s.path}
              onClick={go(s.path)}
              data-testid="everything-session"
              data-session-id={s.id}
              data-run-id={s.runId}
              data-run-ids={s.runIds.join(' ')}
              data-state={s.state}
              className="wk-desk-session"
            >
              <span aria-hidden className={`wk-desk-dot wk-desk-dot--${s.state}`} />
              <span className="wk-desk-need-body">
                <span className="wk-desk-session-title">{s.title}</span>
                <span className={`wk-desk-need-line${s.state === 'waiting' ? ' wk-desk-underline' : ''}`}>{s.line}</span>
                <Tech data-testid="tech-session-row" parts={s.runIds} block />
              </span>
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── Everything made ──────────────────────────────────────────────────────────────────────────

function MadeTab({ runs, q, navigate, go }: { runs: SessionView[]; q: EverythingQuery; navigate: Navigate; go: Go }): React.ReactElement {
  const byProject = useDocsCache((s) => s.byProject);
  const unavailable = useDocsCache((s) => s.unavailable);
  const index = useDocsCache((s) => s.index);
  const census = useDocsCache((s) => s.census);
  const progress = useDocsCache((s) => s.fanoutProgress);
  const projects = useProjectsStore((s) => s.projects);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const nameOf = useProjectName();
  // The daemon-wide index: one cheap read, once per session (never a bridge spawn); absent on an
  // older daemon, in which case the list is what the projects opened this session listed.
  useEffect(() => { void useDocsCache.getState().loadIndex(); }, []);
  const rows = useMemo(() => madeRows(byProject, runs, projectIdByRun, q.kind), [byProject, runs, projectIdByRun, q.kind]);
  const now = Date.now();
  const lens = (kind: EverythingQuery['kind']): string => everythingPath({ tab: 'made', kind });
  const hrefOf = (r: MadeRow): string => {
    if (r.runId !== undefined) return r.projectId !== null ? modePath(r.projectId, 'video', r.runId) : `/runs/${encodeURIComponent(r.runId)}`;
    return versionPath(r.projectId ?? 'default', r.doc!.name, null, r.doc!.kind === 'demo' ? 'video' : 'document');
  };
  const askable = projects.filter((p) => p.id !== 'default').map((p) => p.id);
  const loadAll = (): void => { void useDocsCache.getState().loadAll(askable); };
  const censusLine = index === 'untried' || (index === 'present' && census === 'opened')
    ? 'Reading what this daemon has made…'
    : census === 'daemon' ? 'Everything this daemon has made, from its index.'
    : census === 'fanout' ? 'Everything the projects listed, each asked in turn.'
    : index === 'failed' ? 'Couldn’t read the daemon’s index — this is what the projects opened this session listed.'
    : 'This daemon keeps no index — this is what the projects opened this session listed.';
  const offerLoad = (index === 'absent' || index === 'failed') && progress === null && askable.length > 0;

  return (
    <div data-testid="everything-made" data-count={rows.length} data-kind={q.kind} data-census={census} data-index={index}>
      <div className="wk-everything-bar">
        <div role="group" aria-label="Show" className="wk-everything-chips">
          {MADE_KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={q.kind === k.id} data-testid="everything-kind" data-kind={k.id} onClick={() => navigate(lens(k.id), { replace: true })} className="wk-chip">{k.label}</button>
          ))}
        </div>
      </div>
      <p data-testid="everything-made-census" className="wk-session-grey">
        {censusLine}
        {offerLoad && <> <button type="button" data-testid="everything-made-load" onClick={loadAll} className="wk-since-toggle" title="One list per project, in turn — a project's bridge may take a minute to start">Ask every project</button></>}
        {progress !== null && <> Asking {progress.current ?? '…'} ({progress.done} of {progress.total})…</>}
      </p>
      {Object.entries(unavailable).map(([pid, why]) => (
        <p key={pid} data-testid="everything-made-unavailable" data-project-id={pid} className="wk-session-grey">Couldn’t list {nameOf(pid)}: {why}</p>
      ))}
      {rows.length === 0 && index !== 'untried' && (
        <p data-testid="everything-empty" className="wk-session-grey">
          {q.kind === 'all' ? 'Nothing made yet.' : `No ${q.kind} yet.`}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="wk-everything-list">
          {rows.map((r) => (
            <li key={r.key}>
              <a href={hrefOf(r)} onClick={go(hrefOf(r))} data-testid="everything-made-row" data-kind={r.kind} data-project-id={r.projectId ?? ''} {...(r.runId !== undefined ? { 'data-run-id': r.runId } : { 'data-name': r.doc!.name })} className="wk-desk-session wk-everything-row">
                <span className="wk-desk-need-body">
                  <span className="wk-desk-session-title">{r.title}</span>
                  <span className="wk-desk-need-line">
                    {MADE_WORD[r.kind]} · {nameOf(r.projectId)}{r.updatedAt !== null ? ` · ${ageWord(Math.max(0, now - r.updatedAt))} ago` : ''}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

function HelpersTab({ go }: { go: Go }): React.ReactElement {
  const roster = useRoster();
  // Amendment 5, decision 5: Sign in opens the one plain-words panel; the row clears when the
  // re-read finds the seat back (useRoster follows the deposit).
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  return (
    <div data-testid="everything-helpers" data-count={roster?.length ?? ''}>
      <p className="wk-session-grey">The AI helpers this daemon can give work to, and whether each is signed in.</p>
      {signIn !== null && <SignInPanel seat={signIn} onClose={() => setSignIn(null)} />}
      {roster === null && <p data-testid="everything-checking" className="wk-session-grey">Reading the roster…</p>}
      {roster !== null && roster.length === 0 && <p data-testid="everything-empty" className="wk-session-grey">No helper is set up on this daemon yet.</p>}
      {roster !== null && roster.length > 0 && (
        <ul className="wk-everything-list">
          {roster.map((seat) => <HelperRow key={seat.key} seat={seat} go={go} onSignIn={() => setSignIn(seat)} />)}
        </ul>
      )}
    </div>
  );
}

function HelperRow({ seat, go, onSignIn }: { seat: RosterSeat; go: Go; onSignIn: () => void }): React.ReactElement {
  const standing = seatStandingWord(seat);
  const health = seat.health;
  const message = health?.status === 'inactive' && health.message !== undefined && health.message !== '' ? health.message : null;
  const state = health === undefined ? 'unknown' : health.status;
  return (
    <li data-testid="everything-helper" data-seat={seat.key} data-standing={standing.kind} data-health={state} className="wk-desk-session wk-everything-row">
      <span aria-hidden className={`wk-desk-dot wk-desk-dot--${state === 'active' ? (standing.kind === 'signed-out' || standing.kind === 'ineligible' ? 'waiting' : 'done') : state === 'inactive' ? 'blocked' : 'quiet'}`} />
      <span className="wk-desk-need-body">
        <span className="wk-desk-session-title">{seat.display_name || seat.key}</span>
        <span className="wk-desk-need-line" title={standing.title ?? undefined}>
          {message ?? [state === 'unknown' ? null : state, standing.detail].filter((s): s is string => s !== null).join(' · ')}
          {standing.kind === 'signed-out' && <> · <a href="/system" onClick={(e) => { e.preventDefault(); onSignIn(); }} data-testid="everything-helper-signin">Sign in →</a></>}
        </span>
      </span>
    </li>
  );
}

// ── Handed over ──────────────────────────────────────────────────────────────────────────────

function HandedTab({ runs, runsLoaded, go }: { runs: SessionView[]; runsLoaded: boolean; go: Go }): React.ReactElement {
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const nameOf = useProjectName();
  const rows = useMemo(() => handedRows(runs, deliveredNow, runChatId, projectIdByRun), [runs, deliveredNow, runChatId, projectIdByRun]);
  const now = Date.now();
  return (
    <div data-testid="everything-handed" data-count={rows.length}>
      <p className="wk-session-grey">Work that left this machine: a pull request opened, or a branch pushed.</p>
      {!runsLoaded && <p data-testid="everything-checking" className="wk-session-grey">Reading your work…</p>}
      {runsLoaded && rows.length === 0 && <p data-testid="everything-empty" className="wk-session-grey">Nothing has been handed over yet.</p>}
      {rows.length > 0 && (
        <ul className="wk-everything-list">
          {rows.map((r) => <HandedRowView key={r.runId} r={r} name={nameOf(r.projectId)} now={now} go={go} />)}
        </ul>
      )}
    </div>
  );
}

function HandedRowView({ r, name, now, go }: { r: HandedRow; name: string; now: number; go: Go }): React.ReactElement {
  const when = r.when > 0 ? `${ageWord(Math.max(0, now - r.when))} ago` : null;
  const word = r.claim === 'pr-open' ? 'pull request open' : r.claim === 'pushed' ? `pushed${r.branch !== null ? ` to ${r.branch}` : ''}` : 'handed over';
  return (
    <li data-testid="everything-handed-row" data-run-id={r.runId} data-claim={r.claim} className="wk-desk-session wk-everything-row">
      <span aria-hidden className="wk-desk-dot wk-desk-dot--done" />
      <span className="wk-desk-need-body">
        <span className="wk-desk-session-title">{r.title}</span>
        <span className="wk-desk-need-line">
          {word} · {name}{when !== null ? ` · ${when}` : ''}
          {' · '}
          <a href={sessionPath(r.sessionId)} onClick={go(sessionPath(r.sessionId))} data-testid="everything-handed-open">Open the session →</a>
          {r.href !== null && <> · <a href={r.href} target="_blank" rel="noreferrer" data-testid="everything-handed-pr">Pull request ↗</a></>}
        </span>
      </span>
    </li>
  );
}
