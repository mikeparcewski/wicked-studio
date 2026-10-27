import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, Bot, CircleAlert, MoreHorizontal, Wallet } from 'lucide-react';
import { everythingPath } from '../../board/everythingModel.js';
import type { DiagnosticsGovernance, RosterSeat, SessionView } from '../../api/types.js';
import { getDiagnostics } from '../../api/diagnostics.js';
import { readErrorKind } from '../../api/errors.js';
import { failureCounts } from '../../board/attention.js';
import {
  agentRows, agentsOf, governanceOf, DEFAULT_REFINE, GROUP_BYS, projectOf, RANGES, refineRuns, stepFor, workflowLabel, workflowOf, workflowRows, type AcpFallbacks, type GroupNames, type RangeDays, type Refine,
} from '../../board/deskInsights.js';
import { deskReadState, lapsedSeatChores, needRunId, noSignedInHelper, setupChores, workFingerprint } from '../../board/deskModel.js';
import { useMemoryReading } from '../../hooks/useMemoryReading.js';
import { AGENTS_PATH } from '../agents/AgentsPage.js';
import { deadletterChore } from '../../board/repairMoves.js';
import { useDeadletterReplay } from '../../hooks/useRepairMoves.js';
import { ReplayMove } from '../ReplayMove.js';
import { DeskStateRows, useDeskStates } from './DeskStateRows.js';
import { useMovableBoardModel } from './MoveToProject.js';
import { useHandover } from '../../hooks/useHandover.js';
import { HandoverPanel } from '../HandoverPanel.js';
import { createdAtMs } from '../../board/windowStats.js';
import { moneyWords } from '../../board/deskPulse.js';
import { handleTabKeyDown } from '../ui/tabKeys.js';
import { jobTitle } from '../../board/deskWords.js';
import type { NeedRow } from '../../board/needsYou.js';
import { displaySeats, seatLabel } from '../../board/seatNames.js';
import { sessionIdOf, sessionPath } from '../../board/sessionModel.js';
import { useDeskRecord } from '../../hooks/useDeskRecord.js';
import { useHistoryScroll } from '../../hooks/useHistoryState.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { ALL_NEEDS_SCOPE, useSettledNeeds } from '../../hooks/useNeedsRows.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useStartClocks } from '../../hooks/useStartClocks.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useProjectsStore } from '../../store/projects.js';
import { openSheet } from '../../store/sheets.js';
import { CaptureDrop } from '../CaptureDrop.js';
import { AgentModal } from '../agents/AgentModal.js';
import { StandingOrdersPanel } from '../StandingOrdersPanel.js';
import { liveRows } from '../../board/deskInsights.js';
import { agentTiles, readyNote } from '../../board/agentsModel.js';
import { useAgentRows } from '../agents/useAgentRows.js';
import { useWindowSpend } from '../../hooks/useWindowSpend.js';
import { Segmented, StateBanner } from '../ui/index.js';
import { DeskHappening } from './DeskHappening.js';
import { DeskStat, RefineSelect } from './DeskParts.js';
import { DeskRuleLine } from './DeskRuleLine.js';
import { DeskRuns } from './DeskRuns.js';
import { needHolds } from '../../board/deskRuns.js';
import { startNewJob } from './SessionRail.js';
import { scrollBehavior } from '../ui/motion.js';
import type { MenuItem } from '../ui/index.js';
import { projectDetailPath } from '../../hooks/useRoute.js';
import { DeskInbox } from './DeskInbox.js';
import { FocusLockToggle } from '../NeedsYouQueue.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { DeskUnderstand } from './DeskUnderstand.js';
import { UnderstandPage } from './UnderstandPage.js';
import { DeskHome } from './DeskHome.js';
import { DESK_VIEW_PATH, isHostedView, type DeskView, type HostedView } from '../../board/navModel.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { ReportPage } from '../report/ReportPage.js';

/**
 * THE DESK, v2 (design/DES-desk-v2.md) — the route `/`.
 *
 *  1. Lead with actions: the top band is Needs you (an inbox with a reading pane, on the attention
 *     model) beside Happening now (work in hand with progress, then what just ended). Both scroll
 *     inside, so the band keeps its height.
 *  2. In sight below it: ONE refine bar (range, project, helper, workflow, group by) that every
 *     widget obeys, then the charts (jobs started, spend, outcomes).
 *  3. Comparisons that help: helpers side by side, improve-this callouts (each with its evidence),
 *     workflows side by side, one job against another.
 *  4. One visual language: every widget is a `ChartCard`; every chart is the kit in
 *     `components/charts/Chart.tsx`; a helper has one colour everywhere.
 */
export function DeskV2({ runs: rawRuns, runsLoaded, runsError = null, onRetryRuns, needRows: rawNeedRows, now, navigate, search = '', hosted, projectId, projectHead, workExtra, runActions, view }: {
  /** The global Desk's page (ui-v2 nav regroup): Home (`/`), Jobs, Report or Understand, each at its own
   *  address and reached from the sidebar. A project's page ignores it and reads its tab off `?tab=`. */
  view?: DeskTab;
  /** The Runs tab's per-row actions (a project's page: Remove from project). */
  runActions?: (runId: string, title: string) => readonly MenuItem[];
  /** Renders a hosted tab's page for an address (App owns those pages); `project` = the project page's id. */
  hosted?: (tab: HostedTab, at: string, project: string | null) => React.ReactNode;
  /**
   * A PROJECT'S PAGE is this Desk filtered to one project (operator 2026-10-13): every tab reads only
   * that project's runs and needs, the tabs live at `/projects/:id?tab=`, and the project's header
   * and Work-tab sections come in from ProjectDesk. No second implementation.
   */
  projectId?: string;
  projectHead?: { title: string; meta?: React.ReactNode; actions: React.ReactNode };
  /** The project's own Work-tab sections (requirements, documents, edit), under the inbox. */
  workExtra?: React.ReactNode;
  /** The route's query: a project page's `?tab=` (Work is the default); Report's `?focus=spend`. */
  search?: string;
  runs: SessionView[];
  runsLoaded: boolean;
  runsError?: string | null;
  onRetryRuns?: () => void;
  needRows: NeedRow[];
  now: number;
  navigate: Navigate;
}): React.ReactElement {
  const clocked = useStartClocks(rawRuns);
  // On a project's page the caller passes the project's runs (its membership, plus member runs the
  // run list no longer serves), so nothing is filtered again here.
  const runs = clocked;
  const needRows = useMemo(() => {
    if (projectId === undefined) return rawNeedRows;
    const ids = new Set(runs.map((v) => v.session.id));
    return rawNeedRows.filter((r) => { const id = needRunId(r); return id !== null && ids.has(id); });
  }, [rawNeedRows, runs, projectId]);
  const base = projectId === undefined ? '/' : projectDetailPath(projectId);
  const projectRunIds = useMemo(() => (projectId === undefined ? null : new Set(runs.map((v) => v.session.id))), [runs, projectId]);
  const tabPath = (t: DeskTab, at?: string): string => deskTabPath(t, at, base);
  // Where you were: the Desk's scroll position comes back on Back (useHistoryScroll, as before).
  const scroller = useRef<HTMLDivElement | null>(null);
  useHistoryScroll(scroller, 'desk.scroll');
  const query = new URLSearchParams(search);
  // The global Desk's pages have no tabs (the sidebar is the way between them); a project's page does.
  const tabbed = projectId !== undefined;
  const tab: DeskTab = tabbed ? (DESK_TABS.find((t) => t.id === query.get('tab'))?.id ?? 'work') : (view ?? 'work');
  /** A view's panel is a tabpanel of the project's tabs; on a global page it is the page itself. */
  const panelOf = (t: DeskTab): { role?: 'tabpanel'; id?: string; 'aria-labelledby'?: string } => (tabbed ? { role: 'tabpanel', id: panelId(t), 'aria-labelledby': tabId(t) } : {});
  const focus = query.get('focus');
  const goTab = (t: DeskTab): void => navigate(tabPath(t));
  const tabPrefix = useId();
  const tabId = (t: DeskTab): string => `${tabPrefix}-tab-${t}`;
  const panelId = (t: DeskTab): string => `${tabPrefix}-panel-${t}`;
  const keyboardFocus = useRef<string | null>(null);
  useEffect(() => {
    // Hosted pages change the shell's layout; restore the tab's keyboard focus after navigation.
    if (keyboardFocus.current === null) return;
    document.getElementById(keyboardFocus.current)?.focus();
    keyboardFocus.current = null;
  }, [tab]);
  useEffect(() => {
    // A narrow bar scrolls sideways: bring the open tab into it (a view opened from More sits at its end).
    const el = document.getElementById(tabId(tab));
    const list = el?.parentElement;
    if (el == null || list == null || list.scrollWidth <= list.clientWidth) return;
    const over = el.getBoundingClientRect().right - list.getBoundingClientRect().right;
    const under = el.getBoundingClientRect().left - list.getBoundingClientRect().left;
    if (over > 0) list.scrollLeft += over; else if (under < 0) list.scrollLeft += under;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabId is stable for this Desk (useId)
  }, [tab]);
  useEffect(() => {
    if (tab !== 'report' || focus === null) return;
    const t = setTimeout(() => document.getElementById(`desk-focus-${focus}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }), 400);
    return () => clearTimeout(t);
  }, [tab, focus]);
  const roster = useRoster();
  const displayText = useDisplayText();
  const readState = deskReadState(runsLoaded, runsError);
  // studio#833: a project's Desk counts its own rows, so it settles on its own (never the rail's count).
  const settled = useSettledNeeds(needRows, readState === 'known', readState === 'failed', projectId ?? ALL_NEEDS_SCOPE);
  const [rereading, setRereading] = useState(false);
  const rereadSources = useCallback((): void => { setRereading(true); void useNeedsSources.getState().load(0).finally(() => setRereading(false)); }, []);
  const runsShown = readState === 'known' || readState === 'stale';
  const [refine, setRefine] = useState<Refine>(DEFAULT_REFINE);
  const refined = (r: Refine): boolean => r.project !== null || r.agent !== null || r.workflow !== null;
  // The project the record reads are scoped to: the page's project, else the refine bar's.
  const scope = projectId ?? refine.project;
  const set = <K extends keyof Refine>(k: K, v: Refine[K]): void => setRefine((r) => ({ ...r, [k]: v }));
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);

  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const runChatId = useCapabilities((s) => s.runChatId);
  const pathOfRun = useCallback((id: string): string => {
    const v = runs.find((x) => x.session.id === id);
    return v === undefined ? sessionPath(`run:${id}`) : sessionPath(sessionIdOf(v, runChatId));
  }, [runs, runChatId]);

  const agentName = useCallback((cli: string): string => {
    const seat = displaySeats(roster).find((s) => s.key === cli);
    return seat !== undefined ? seatLabel(seat) : seatLabel({ key: cli });
  }, [roster]);
  const projectName = useCallback((id: string): string => {
    if (id === 'default') return 'Not in a project';
    return projects.find((p) => p.id === id)?.name ?? 'A project';
  }, [projects]);
  const names: GroupNames = useMemo(() => ({ agent: agentName, project: projectName }), [agentName, projectName]);

  // The refine bar's choices: only what the data holds.
  const live = useMemo(() => runs.filter((v) => v.session.archived_at == null), [runs]);
  const projectOpts = useMemo(() => [...new Set(live.map(projectOf))].map((id) => ({ value: id, label: projectName(id) })).sort((a, b) => a.label.localeCompare(b.label)), [live, projectName]);
  const agentOpts = useMemo(() => [...new Set([...displaySeats(roster).map((s) => s.key), ...live.flatMap(agentsOf)])].map((k) => ({ value: k, label: agentName(k) })).sort((a, b) => a.label.localeCompare(b.label)), [roster, live, agentName]);
  const workflowOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of live) { const w = workflowOf(v); m.set(w.key, w.label); }
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [live]);

  const { kept } = useMemo(() => refineRuns(runs, refine, now), [runs, refine, now]);
  const step = useMemo(() => stepFor(refine.days, kept.map(createdAtMs).filter((t): t is number => t !== null), now), [refine.days, kept, now]);

  // Spend + helper record (cumulative reads; read again when work moves).
  // Read again when work moves: a unit finishes, fails or retries, or a run changes state (a failed,
  // cancelled or resumed run moves quality/record/spend without finishing a unit).
  const workPrint = useMemo(() => workFingerprint(runs), [runs]);
  const record = useDeskRecord(refine.days, step, scope, workPrint);
  const [acp, setAcp] = useState<AcpFallbacks | null>(null);
  useEffect(() => {
    let alive = true;
    getDiagnostics().then((d) => {
      const by = d.acp?.byCli;
      if (alive) setAcp(by === undefined ? null : Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { fallbacks: v.fallbacks ?? 0, kinds: v.fallbackKinds ?? {} }])));
    }, () => undefined);
    return () => { alive = false; };
  }, []);

  const rosterKeys = useMemo(() => displaySeats(roster).map((s) => s.key), [roster]);
  // Agent rows exist only from a read record: an unread or failed record is never a row of zeros.
  const agents = useMemo(() => (record.window === null ? [] : agentRows(record.window, kept, names, rosterKeys, refine.workflow)).filter((a) => refine.agent === null || a.cli === refine.agent), [record.window, kept, names, rosterKeys, refine.agent, refine.workflow]);
  const flows = useMemo(() => workflowRows(kept), [kept]);

  const runHolds = useMemo(() => needHolds(needRows), [needRows]);
  const heldByNeeds = useMemo(() => new Set(needRows.map(needRunId).filter((id): id is string => id !== null)), [needRows]);
  // "Agents ready" is the Agents tab's own Ready-for-work count, from the same rows (one model, one number).
  const agentsView = useAgentRows();
  const agentsTile = agentTiles(agentsView.rows);
  const allRunning = useMemo(() => liveRows(runs, (v) => jobTitle(v.session), heldByNeeds).length, [runs, heldByNeeds]);
  const workSpend = useWindowSpend(30, projectId, workPrint, tab === 'work' && projectId !== 'default');
  const workFailed = useMemo(() => failureCounts(runs, needRows, 30, now), [runs, needRows, now]);
  const chores = useMemo(() => lapsedSeatChores(roster), [roster]);
  // Studio's own setup (operator 2026-10-17): live items from the agents and the memory read, the Desk only.
  const memory = useMemoryReading(projectId === undefined, tab);
  const setup = useMemo(() => (projectId !== undefined ? [] : setupChores(
    { known: agentsView.hasRoster, usable: agentsView.rows.filter((r) => r.usable), total: agentsView.rows.length },
    memory,
    { agents: deskTabPath('agents', `${AGENTS_PATH}?setup=1`), memory: deskTabPath('repositories') },
  )), [projectId, agentsView.hasRoster, agentsView.rows, memory]);
  const leadWithSignIn = noSignedInHelper(roster) && chores.length > 0 && !setup.some((c) => c.key === 'agents');
  const [choresOpen, setChoresOpen] = useState(false);
  // A first run (no agent can work) lists each agent to sign in, as the lead did; otherwise many fold into one row.
  const choresGrouped = chores.length > 2 && !leadWithSignIn && !setup.some((c) => c.key === 'agents');
  const choresFolded = choresGrouped && !choresOpen;
  const [governanceSelf, setGovernanceSelf] = useState<DiagnosticsGovernance | null>(null);
  const rereadGovernance = useCallback(() => { getDiagnostics().then((d) => setGovernanceSelf(d.governance ?? null), () => undefined); }, []);
  useEffect(rereadGovernance, [rereadGovernance]);
  const dead = deadletterChore(governanceSelf);
  const replay = useDeadletterReplay(rereadGovernance);
  const replaying = replay.state.phase !== 'idle';
  const states = useDeskStates();
  // While you were away (wave 2b): the handover opens on the Work tab after an absence.
  const { failedAt } = useMovableBoardModel(runs);
  const handover = useHandover(runs, failedAt);
  // The chores ride at the top of the inbox (they need a person too); the band never changes height.
  const choresBlock = (setup.length > 0 || chores.length > 0 || states.frozen || states.away || dead !== null || replaying) ? (
    <section data-testid="desk-chores" aria-label="For whoever runs studio" data-lead={leadWithSignIn ? 'true' : 'false'} className="wk-inbox-chores">
      <p className="wk-need-section">For whoever runs studio{setup.length + chores.length > 0 ? ` · ${setup.length + chores.length}` : ''}</p>
      {/* Studio's own setup, pinned first: live from the agents and the memory read, gone once fixed. */}
      {setup.map((c) => (
        <div key={c.key} data-testid="desk-setup" data-setup={c.key} data-tone={c.tone} className="wk-inbox-chore wk-inbox-chore--setup">
          <span className="wk-inbox-chore-body"><span className="wk-inbox-chore-title">{c.title}</span><span className="wk-inbox-chore-line" title={c.line}>{c.line}</span></span>
          <a href={c.action.path} data-testid="desk-setup-act" onClick={(e) => { e.preventDefault(); navigate(c.action.path); }} className="wk-need-act">{c.action.label}</a>
        </div>
      ))}
      {leadWithSignIn && (
        <p data-testid="desk-signin-lead" className="wk-inbox-chore-lead">No AI agent is signed in yet, so nothing can run. Pick one below and Sign in shows the one command to run.</p>
      )}
      <DeskStateRows frozen={states.frozen} away={states.away} />
      {(dead !== null || replaying) && (
        <div data-testid="desk-chore" data-chore="deadletters" className="wk-inbox-chore">
          <span className="wk-inbox-chore-body"><span className="wk-inbox-chore-title">{dead?.title ?? 'Governance evidence'}</span><span data-testid="desk-chore-line" className="wk-inbox-chore-line" title={dead?.line}>{dead?.line ?? 'Replayed. Checking again.'}</span></span>
          <ReplayMove replay={replay} />
        </div>
      )}
      {choresGrouped && (
        <div data-testid="desk-chore-group" data-count={chores.length} className="wk-inbox-chore">
          <span className="wk-inbox-chore-body"><span className="wk-inbox-chore-title">{`${chores.length} agents need signing in again`}</span><span className="wk-inbox-chore-line">Nothing they would do can start until each one is signed in.</span></span>
          <button type="button" data-testid="desk-chore-group-toggle" aria-expanded={choresOpen} onClick={() => setChoresOpen((v) => !v)} className="wk-need-act">{choresOpen ? 'Fold' : 'Show each'}</button>
        </div>
      )}
      {!choresFolded && chores.map((c) => (
        <div key={c.key} data-testid="desk-chore" data-seat={c.seat} className="wk-inbox-chore">
          <span className="wk-inbox-chore-body"><span className="wk-inbox-chore-title">{c.title}</span><span className="wk-inbox-chore-line">{c.line}</span></span>
          <a href={c.action.path} data-testid="desk-chore-signin" onClick={(e) => { e.preventDefault(); setSignIn(c.rosterSeat); }} className="wk-need-act">{c.action.label}</a>
        </div>
      ))}
    </section>
  ) : null;
  const [readAt, setReadAt] = useState(() => Date.now());
  useEffect(() => { if (runsLoaded) setReadAt(Date.now()); }, [runs, runsLoaded]);
  const asOf = new Date(readAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const header = (
    <header className="wk-desk2-head">
      <div className="wk-desk-a-titles">
        <h1 className="wk-desk-a-title" data-testid={projectHead !== undefined ? 'project-title' : undefined}>{projectHead?.title ?? PAGE_TITLE[tab]}</h1>
        <p data-testid="desk-as-of" className="wk-desk-a-when">{projectHead?.meta ?? (readState === 'known' ? `As of ${asOf}` : readState === 'stale' ? 'As of the last read' : 'Reading…')}</p>
      </div>
      {/* Search, New job and Chat live in the rail on every page (SessionRail's action row): the header
          names the page and carries only what is this page's own. */}
      {projectHead !== undefined ? <div className="wk-desk2-actions">{projectHead.actions}</div> : <div className="wk-desk2-actions">
        <DeskMore runs={runs} needs={readState === 'known' ? needRows.length : null} />
      </div>}
    </header>
  );

  // A project's page keeps its views as tabs (they scope each view to the project); the global Desk's
  // views are pages in the sidebar (ui-v2 nav regroup), so it draws none. No More menu: every tab shows.
  const tabs = !tabbed ? null : (
    <div className="wk-desk2-tabbar">
      <div role="tablist" aria-label="Project view" className="wk-desk2-tabs" data-testid="desk-tabs">
        {DESK_TABS.map((t) => (
          <a key={t.id} role="tab" id={tabId(t.id)} aria-controls={panelId(t.id)} tabIndex={tab === t.id ? 0 : -1}
            href={tabPath(t.id)} aria-selected={tab === t.id} data-testid={`desk-tab-${t.id}`} className="wk-desk2-tab"
            onKeyDown={(e) => { keyboardFocus.current = handleTabKeyDown(e)?.id ?? null; }}
            onClick={(e) => { e.preventDefault(); goTab(t.id); }}>{t.label}</a>
        ))}
      </div>
    </div>
  );

  const runningPath = everythingPath({ tab: 'sessions', filter: 'active', ...(projectId !== undefined ? { project: projectId } : {}) });
  const work = (
    <div {...panelOf('work')} data-testid="desk-work" className="wk-work">
      {/* The handover is studio-wide (the audit trail and its dismissal are global): the Desk only, never a project page. */}
      {projectId === undefined && handover.since !== null && <HandoverPanel handover={handover} navigate={navigate} now={now} runs={runs} />}
      {/* The band: Needs you (the lead) beside Happening now, the same height, each scrolling inside. */}
      <div className="wk-work-top">
        <DeskInbox rows={needRows} runs={runs} navigate={navigate} now={now} settled={readState === 'known' ? settled.phase : 'loading'} agentName={agentName} extra={projectId === undefined ? choresBlock : null} setupCount={setup.length}
          missing={settled.missing} onRetry={rereadSources} retrying={rereading} />
        <DeskHappening runs={runs} runsShown={runsShown} navigate={navigate} now={now} title={(v) => jobTitle(v.session)} pathOf={pathOfRun} agentName={agentName}
          scope={projectRunIds} scopeKey={projectId ?? 'desk'} {...(projectId !== undefined ? { seeAllPath: everythingPath({ tab: 'sessions', project: projectId }) } : {})} />
      </div>
      {/* At a glance: four quiet numbers on one surface, under the band: Needs you leads, above the fold (each opens its list). */}
      <ul className="wk-work-blocks" aria-label="At a glance" data-testid="desk-blocks">
        <DeskStat icon={Activity} tone="run" label="Running now" testId="desk-block-running" href={runningPath} navigate={navigate}
          value={runsShown ? String(allRunning) : null} note={allRunning === 0 ? 'nothing running' : 'working now'} />
        <DeskStat icon={CircleAlert} tone="fail" label="Failed" testId="desk-block-failed" href={everythingPath({ tab: 'sessions', filter: 'failed', ...(projectId !== undefined ? { project: projectId } : {}) })} navigate={navigate}
          value={runsShown ? String(workFailed.inWindow.length) : null}
          note={workFailed.inWindow.length === 0 ? (workFailed.older > 0 ? `none new · ${workFailed.older} older still open` : 'none in the last 30 days') : `last 30 days, not retried${workFailed.retried > 0 ? ` · ${workFailed.retried} retried` : ''}`} />
        <DeskStat icon={Bot} tone="accent" label="Agents ready" testId="desk-block-agents" href={tabPath('agents')} navigate={navigate}
          value={agentsView.hasRoster ? `${agentsTile.ready} of ${agentsTile.total}` : null}
          loading={!agentsView.hasRoster && agentsView.rosterState !== 'failed'}
          note={agentsView.hasRoster ? readyNote(agentsTile) : 'couldn’t read the agents'} />
        <DeskStat icon={Wallet} tone="accent" label="Spend" testId="desk-block-spend" href={`${tabPath('report')}&focus=spend`} navigate={navigate}
          value={projectId === 'default' ? '—' : workSpend.phase === 'loading' ? null : workSpend.current === null ? '—' : `${workSpend.truncated || workSpend.partial ? 'at least ' : ''}${moneyWords(workSpend.current)}`}
          note={projectId === 'default' ? 'Spend is counted per project' : workSpend.truncated ? 'Partial: last 30 days · newest jobs only; older ones were not read' : workSpend.current !== null && workSpend.previous !== null ? deltaWords(workSpend.current, workSpend.previous, (d) => moneyWords(Math.abs(d)), 30) : workSpend.partial ? 'last 30 days · priced usage only' : 'last 30 days'} />
      </ul>
      {/* B9: the one sentence about a rule remembered since the last visit (null when there is none). */}
      {projectId === undefined && <DeskRuleLine navigate={navigate} />}
      {workExtra}
    </div>
  );

  // THE LANDING: the Desk's own Work view (`/`) is home v2; a project's page keeps its inbox and stream.
  const home = projectId === undefined;
  // Needs you, in full (`/needs`, the landing's "N more waiting"): the inbox the Work view had, with
  // the chores for whoever runs studio riding at its top, as before.
  const inboxView = (
    <div data-testid="desk-inbox-view" className="wk-inbox-view">
      <DeskInbox rows={needRows} runs={runs} navigate={navigate} now={now} settled={readState === 'known' ? settled.phase : 'loading'} agentName={agentName} extra={choresBlock} setupCount={setup.length}
        missing={settled.missing} onRetry={rereadSources} retrying={rereading} asPage />
    </div>
  );
  // The standing states that change what studio does (deliveries frozen, you marked away) and the
  // governance replay: rare, and nowhere else to act on them, so the landing keeps them while they hold.
  const homeStates = (states.frozen || states.away || dead !== null || replaying) ? (
    <section data-testid="desk-chores" aria-label="For whoever runs studio" className="wk-home-states">
      <DeskStateRows frozen={states.frozen} away={states.away} />
      {(dead !== null || replaying) && (
        <div data-testid="desk-chore" data-chore="deadletters" className="wk-desk-need wk-desk-need--wrap">
          <span aria-hidden className="wk-desk-dot wk-desk-dot--blocked" />
          <span className="wk-desk-need-body">
            <span className="wk-desk-need-title">{dead?.title ?? 'Governance evidence'}</span>
            <span data-testid="desk-chore-line" className="wk-desk-need-line" title={dead?.line}>{dead?.line ?? 'Replayed. Checking again.'}</span>
          </span>
          <ReplayMove replay={replay} />
        </div>
      )}
    </section>
  ) : null;
  const homeView = (
    <DeskHome runs={runs} runsShown={runsShown} read={readState === 'failed' ? 'failed' : readState === 'checking' ? 'checking' : 'known'}
      needRows={needRows} settled={readState === 'known' || readState === 'stale' ? settled.phase : 'loading'} count={settled.count} missing={settled.missing}
      onRetryNeeds={rereadSources} retryingNeeds={rereading} navigate={navigate} now={now} agentName={agentName} pathOfRun={pathOfRun}
      setup={setup} reportPath={tabPath('report')}
      more={<DeskMore runs={runs} needs={readState === 'known' ? needRows.length : null} />}
      handover={handover.since !== null ? <HandoverPanel handover={handover} navigate={navigate} now={now} runs={runs} /> : null}
      states={homeStates}
      ruleLine={<DeskRuleLine navigate={navigate} />} />
  );

  const refineBarOf = (withGroup: boolean): React.ReactElement => (
      <div className="wk-refine" role="group" aria-label="Refine every chart below" data-testid="desk-refine">
      <Segmented label="Time range" data-testid="desk-range" value={String(refine.days) as `${RangeDays}`}
        options={RANGES.map((d) => ({ value: String(d) as `${RangeDays}`, label: `${d} days`, testId: `desk-range-${d}` }))}
        onChange={(v) => set('days', Number(v) as RangeDays)} />
      {projectId === undefined && <RefineSelect label="Project" all="All projects" value={refine.project} options={projectOpts} onChange={(v) => set('project', v)} testId="desk-refine-project" />}
      <RefineSelect label="Agent" all="All agents" value={refine.agent} options={agentOpts} onChange={(v) => set('agent', v)} testId="desk-refine-agent" />
      <RefineSelect label="Workflow" all="All workflows" value={refine.workflow} options={workflowOpts} onChange={(v) => set('workflow', v)} testId="desk-refine-workflow" />
      {refined(refine) && <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="desk-refine-reset" onClick={() => setRefine((r) => ({ ...DEFAULT_REFINE, days: r.days, groupBy: r.groupBy }))}>Clear filters</button>}
      {withGroup && (
      <span className="wk-refine-group">
          <span className="wk-refine-label">Group by</span>
          <Segmented label="Group by" data-testid="desk-groupby" value={refine.groupBy} options={GROUP_BYS.filter((g) => projectId === undefined || g.value !== 'project').map((g) => ({ ...g, testId: `desk-groupby-${g.value}` }))} onChange={(v) => set('groupBy', v)} />
        </span>
    )}
    </div>
  );

  const report = (
    <div {...panelOf('report')} data-testid="desk-report" className="wk-desk2-report">
      <ReportPage runs={runs} runsShown={runsShown} now={now} navigate={navigate} agentName={agentName} pathOfRun={pathOfRun} work={workPrint}
        {...(projectId !== undefined ? { projectId } : {})} />
    </div>
  );

  const runsTab = (
    <DeskRuns {...(runActions !== undefined ? { rowActions: runActions } : {})} runs={runs} runsShown={runsShown} refine={refine} refineBar={refineBarOf(false)} now={now} navigate={navigate} pathOf={pathOfRun}
      holds={runHolds} onNewJob={() => startNewJob(projectId ?? null)}
      onClearRefine={() => setRefine((r) => ({ ...DEFAULT_REFINE, days: r.days, groupBy: r.groupBy }))}
      {...(tabbed ? { panelId: panelId('runs'), labelledBy: tabId('runs') } : {})}
      agentName={agentName} projectName={projectName} title={jobTitleOf} showProject={projectId === undefined} />
  );

  const governance = (cli: string) => governanceOf(cli, acp, roster ?? []);

  const understand = (
    <div {...panelOf('understand')} data-testid="desk-understand" className="wk-understand">
      {/* The calm page: one question box and Recent answers; the comparison is folded away under it. */}
      <UnderstandPage project={projectId ?? null} navigate={navigate} now={now} runs={runs} compare={<DeskUnderstand runsShown={runsShown} agents={agents} agentsRead={record.phase} agentsTruncated={record.truncated}
        filterAgent={refine.agent} filterWorkflow={refine.workflow}
        filters={[refine.agent !== null ? `agent ${agentName(refine.agent)}` : null, refine.workflow !== null ? `workflow ${workflowLabel(refine.workflow)}` : null].filter((x): x is string => x !== null).join(', ') || null}
        workflows={flows} kept={kept} allRuns={runs} days={refine.days} onDays={(d) => set('days', d)} project={scope}
        projectLabel={scope === null ? null : projectName(scope)} projectName={projectName} agentName={agentName} governance={governance}
        navigate={navigate} pathOf={pathOfRun} now={now} />} />
    </div>
  );

  if (isHostedView(tab)) {
    // A project's hosted tabs (Repositories, Steering, Memory, Agents, Evaluate): App renders the page for
    // the address the tab carries (`&at=/rules/...`, `&at=/memory?view=proposals`), so every sub-page and
    // deep link keeps working. The global ones are pages of their own (`DeskHostedPage`).
    return (
      <div data-testid="desk" data-object="desk" data-desk="v2" data-tab={tab} className="wk-desk wk-desk2 wk-desk2--hosted">
        <div className="wk-desk2-hosted-head">{header}{tabs}</div>
        <div className="wk-desk2-hosted" {...panelOf(tab)} data-testid={`desk-${tab}`}>
          {hosted?.(tab, query.get('at') ?? HOSTED_HOME[tab], projectId ?? null)}
        </div>
        {signIn !== null && <AgentModal agentKey={signIn.key} onClose={() => setSignIn(null)} />}
      </div>
    );
  }

  return (
    <div data-testid="desk" data-object="desk" data-desk="v2" data-tab={tab} className="wk-desk wk-desk2">
      <div ref={scroller} className="wk-desk-scroll wk-desk2-scroll" data-place-scroll="desk">
        {(readState === 'failed' || readState === 'stale') && runsError !== null && (
          <StateBanner data-testid="desk-runs-failed" kind={readState === 'stale' ? 'stale' : readErrorKind(runsError)} what="your work" error={displayText(runsError)} {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})} />
        )}
        {/* The landing (`/`, Home) carries its own greeting, and the calm Jobs, Report and Understand pages
            their own title and sentence, and Needs you in full its inbox's name and count, so the Desk draws no
            second title over them. A project's page keeps the header. */}
        {!(home && (tab === 'work' || tab === 'inbox' || tab === 'runs' || tab === 'report' || tab === 'understand')) && header}
        {tabs}
        {tab === 'work' ? (home ? homeView : work) : tab === 'inbox' ? inboxView : tab === 'runs' ? runsTab : tab === 'report' ? report : understand}
      </div>
      {signIn !== null && <AgentModal agentKey={signIn.key} onClose={() => setSignIn(null)} />}
    </div>
  );
}

export type DeskTab = DeskView;
export type HostedTab = HostedView;

/** A global Desk page's title (one name per page, board/pageNames). */
const PAGE_TITLE: Record<DeskTab, string> = {
  work: PAGE_NAMES.home, inbox: PAGE_NAMES.needs, runs: PAGE_NAMES.jobs, report: PAGE_NAMES.report, understand: PAGE_NAMES.understand,
  repositories: PAGE_NAMES.repos, steer: PAGE_NAMES.steering, memory: PAGE_NAMES.memory, agents: PAGE_NAMES.agents, evaluate: PAGE_NAMES.evals,
};

/**
 * A project page's tabs, in order (the address carries `?tab=`; Work is the default), named as the
 * sidebar names the same views. The global Desk has no tabs: each view is a page (board/navModel.ts).
 */
export const DESK_TABS: readonly { id: DeskTab; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'runs', label: PAGE_NAMES.jobs },
  { id: 'repositories', label: PAGE_NAMES.repos },
  { id: 'report', label: PAGE_NAMES.report },
  { id: 'understand', label: PAGE_NAMES.understand },
  { id: 'steer', label: PAGE_NAMES.steering },
  { id: 'memory', label: PAGE_NAMES.memory },
  { id: 'agents', label: PAGE_NAMES.agents },
  { id: 'evaluate', label: PAGE_NAMES.evals },
];

/** Each hosted view's own page when the address names none. */
export const HOSTED_HOME: Record<HostedTab, string> = {
  repositories: DESK_VIEW_PATH.repositories, steer: DESK_VIEW_PATH.steer, memory: DESK_VIEW_PATH.memory, agents: DESK_VIEW_PATH.agents, evaluate: DESK_VIEW_PATH.evaluate,
};

/**
 * A Desk view's address; `at` = a hosted page's own address; `base` = `/` or a project's page. On the
 * global Desk every view is a page of its own (`/jobs`, `/report`, `/rules/…`), so a hosted view's
 * address IS its `at`; a project's views are its tabs (`/projects/:id?tab=…&at=…`).
 */
export function deskTabPath(t: DeskTab, at?: string, base = '/'): string {
  if (base === '/') return isHostedView(t) && at !== undefined ? at : DESK_VIEW_PATH[t];
  if (t === 'work') return base;
  return `${base}?tab=${t}${at !== undefined ? `&at=${encodeURIComponent(at)}` : ''}`;
}

/**
 * A global hosted page (Repositories, Steering, Memory, Agents, Evaluate at their own addresses): the
 * page App renders, in the frame a project's hosted tab gives it, without the Desk's header.
 */
export function DeskHostedPage({ view, children }: { view: HostedTab; children: React.ReactNode }): React.ReactElement {
  return (
    <div data-object="page" data-desk="v2" data-tab={view} className="wk-desk wk-desk2 wk-desk2--hosted wk-desk2--page">
      <div className="wk-desk2-hosted" data-testid={`desk-${view}`}>{children}</div>
    </div>
  );
}

function deltaWords(cur: number, prev: number, fmt: (d: number) => string, days: number): string {
  const d = cur - prev;
  if (d === 0) return `same as prior ${days}d`;
  return `${d > 0 ? '▲' : '▼'} ${fmt(d)} vs prior ${days}d`;
}

const jobTitleOf = (v: SessionView): string => jobTitle(v.session);


/** The Desk's ⋯: standing instructions, Mark me away, Capture notes and the look underneath (New project is the rail's). */
function DeskMore({ runs, needs }: { runs: SessionView[]; needs: number | null }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      // A popover the panel opened (standing instructions, capture) may render outside it: only a click
      // on the page itself closes the menu.
      if (root.current !== null && !root.current.contains(t) && (t as Element).closest?.('.wk-overlay, [role="dialog"]') == null) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={root} className="wk-desk2-more">
      <button ref={btn} type="button" data-testid="desk-more" aria-label="More for the Desk" title="More" aria-expanded={open} aria-haspopup="true"
        onClick={() => setOpen((v) => !v)} className="wk-btn wk-btn--icon wk-btn--quiet"><MoreHorizontal size={16} aria-hidden /></button>
      {open && (
        <div className="wk-desk2-more-panel wk-overlay" data-testid="desk-more-panel" role="group" aria-label="More for the Desk">
          <div className="wk-desk2-more-row"><StandingOrdersPanel /></div>
          {/* Show only the most urgent need (the focus lock), as beside standing instructions before. */}
          {needs !== null && <div className="wk-desk2-more-row"><FocusLockToggle items={needs} /></div>}
          <div className="wk-desk2-more-row"><CaptureDrop runs={runs} opens="down" align="end" /></div>
          <button type="button" data-testid="desk-sheet-open" className="wk-btn wk-btn--quiet wk-btn--sm wk-desk2-more-item" onClick={() => { setOpen(false); openSheet({ kind: 'desk' }); }}>Look underneath the Desk</button>
        </div>
      )}
    </div>
  );
}


