import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Bot, CheckCircle2, CircleAlert, Inbox, Info, MoreHorizontal, Rocket, Send, Wallet } from 'lucide-react';
import { everythingPath } from '../../board/everythingModel.js';
import type { DiagnosticsGovernance, RosterSeat, SessionView } from '../../api/types.js';
import { getDiagnostics } from '../../api/diagnostics.js';
import { readErrorKind } from '../../api/errors.js';
import { failureCounts } from '../../board/attention.js';
import {
  agentRows, agentsOf, governanceOf, AGENT_WORKFLOW_NOTE, PARTIAL_RECORD_NOTE, bucketsOf, callouts, DEFAULT_REFINE, GROUP_BYS, jobSeries, OUTCOMES, outcomeOf, projectOf, RANGES,
  refineRuns, spendAvailability, spendSeries, spendTotals as projectSpend, stepFor, outcomeRows, sum, workflowLabel, workflowOf, workflowRows, type AcpFallbacks, type Callout, type GroupBy, type GroupNames, type RangeDays, type Refine,
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
import { moneyWords, windowWords } from '../../board/deskPulse.js';
import { newestFirst } from '../../board/projectModel.js';
import { useQualityChecks } from '../../hooks/useQualityChecks.js';
import { handleTabKeyDown } from '../ui/tabKeys.js';
import { jobTitle } from '../../board/deskWords.js';
import type { NeedRow } from '../../board/needsYou.js';
import { displaySeats, seatLabel } from '../../board/seatNames.js';
import { sessionIdOf, sessionPath } from '../../board/sessionModel.js';
import { useDeskRecord, useDeskRecordByProject } from '../../hooks/useDeskRecord.js';
import { useHistoryScroll } from '../../hooks/useHistoryState.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { ALL_NEEDS_SCOPE, useSettledNeeds } from '../../hooks/useNeedsRows.js';
import { usePhone } from '../../hooks/usePhone.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useStartClocks } from '../../hooks/useStartClocks.js';
import { openAskDock } from '../../store/askDock.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useProjectsStore } from '../../store/projects.js';
import { openSheet } from '../../store/sheets.js';
import { CaptureDrop } from '../CaptureDrop.js';
import { AgentModal } from '../agents/AgentModal.js';
import { StandingOrdersPanel } from '../StandingOrdersPanel.js';
import { agentColor, AreaChart, catColor, ChartCard, OutcomeBreakdown, outcomeColor, StackedBars, type BarSeries, type ChartState } from '../charts/Chart.js';
import { liveRows } from '../../board/deskInsights.js';
import { agentTiles, readyNote } from '../../board/agentsModel.js';
import { useAgentRows } from '../agents/useAgentRows.js';
import { useWindowSpend } from '../../hooks/useWindowSpend.js';
import { Segmented, Skeleton, StateBanner } from '../ui/index.js';
import { DeskHappening } from './DeskHappening.js';
import { DeskStat, RefineSelect } from './DeskParts.js';
import { DeskRuleLine } from './DeskRuleLine.js';
import { DeskRuns } from './DeskRuns.js';
import { scrollBehavior } from '../ui/motion.js';
import type { MenuItem } from '../ui/index.js';
import { projectDetailPath } from '../../hooks/useRoute.js';
import { DeskInbox } from './DeskInbox.js';
import { FocusLockToggle } from '../NeedsYouQueue.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { DeskUnderstand } from './DeskUnderstand.js';

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
export function DeskV2({ runs: rawRuns, runsLoaded, runsError = null, onRetryRuns, needRows: rawNeedRows, now, navigate, search = '', hosted, projectId, projectHead, workExtra, runActions }: {
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
  /** The route's query: `?tab=work|understand` (Work is the default), `&focus=spend`. */
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
  const tab: DeskTab = (DESK_TABS.find((t) => t.id === query.get('tab'))?.id) ?? 'work';
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
    if (tab !== 'report' || focus === null) return;
    const t = setTimeout(() => document.getElementById(`desk-focus-${focus}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }), 400);
    return () => clearTimeout(t);
  }, [tab, focus]);
  const phone = usePhone();
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

  const { kept, undated } = useMemo(() => refineRuns(runs, refine, now), [runs, refine, now]);
  const step = useMemo(() => stepFor(refine.days, kept.map(createdAtMs).filter((t): t is number => t !== null), now), [refine.days, kept, now]);
  const buckets = useMemo(() => bucketsOf(refine.days, now, step), [refine.days, now, step]);
  const per = step === 7 ? 'week' : 'day';

  // Spend + helper record (cumulative reads; read again when work moves).
  // Read again when work moves: a unit finishes, fails or retries, or a run changes state (a failed,
  // cancelled or resumed run moves quality/record/spend without finishing a unit).
  const workPrint = useMemo(() => workFingerprint(runs), [runs]);
  const qualityIds = useMemo(() => newestFirst(kept).map((v) => v.session.id), [kept]);
  const quality = useQualityChecks(qualityIds, workPrint);
  const qualityValue = quality.tally === null ? null : quality.tally.recorded === 0 ? null : `${quality.tally.passed} of ${quality.tally.recorded}`;
  const qualityNote = quality.tally === null ? 'Reading checks…'
    : quality.failed > 0 && quality.tally.read === 0 ? 'Checks could not be read'
    : quality.failed > 0 ? `${quality.failed} could not be read; ${quality.tally.recorded === 0 ? 'none recorded for the rest' : 'of the rest'}`
    : quality.tally.recorded === 0 ? (qualityIds.length === 0 ? `no jobs in ${windowWords(refine.days)}` : quality.capped ? `no checks recorded for the newest ${quality.tally.read} jobs` : `no checks recorded for these ${qualityIds.length} ${qualityIds.length === 1 ? 'job' : 'jobs'}`)
      : quality.capped ? `of the newest ${quality.tally.read} jobs` : 'checks passed of those recorded';
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

  // ── Widgets' data ──
  const jobsSeries: BarSeries[] = useMemo(() => jobSeries(kept, buckets, refine.groupBy, names).map((s, i) => ({ ...s, color: colorFor(refine.groupBy, s.key, i) })), [kept, buckets, refine.groupBy, names]);
  const spend = useMemo(() => (record.phase === 'done' ? spendSeries(record.reads, refine.agent, names) : null), [record, refine.agent, names]);
  const projectIds = useMemo(() => projectOpts.map((o) => o.value).filter((id) => refine.project === null || id === refine.project), [projectOpts, refine.project]);
  const byProject = useDeskRecordByProject(refine.days, step, projectIds, workPrint, tab === 'report' && refine.groupBy === 'project' && projectId === undefined);
  // Group by applies to Spend where the record can split it: by agent (always), by project (one read
  // per project); outcome and workflow have no spend split on the wire (said in the card).
  // A project whose reads failed is unknown, never $0: it is left out and the card says how many.
  const byProjectOn = refine.groupBy === 'project' && projectId === undefined;
  const projectSeries = !byProjectOn || byProject.phase !== 'done' ? null
    : projectIds.map((id, i) => ({ key: id, label: projectName(id), color: catColor(i), values: projectSpend(byProject.byProject.get(id) ?? [], refine.agent), availability: spendAvailability(byProject.byProject.get(id) ?? [], refine.agent) }));
  const projectsUnread = projectSeries?.filter((x) => x.values === null).length ?? 0;
  const spendByProject: BarSeries[] | null = projectSeries === null ? null
    : projectSeries.filter((x): x is typeof x & { values: number[] } => x.values !== null && x.values.some((v) => v > 0));
  const spendBars: BarSeries[] = byProjectOn ? (spendByProject ?? []) : (spend ?? []).map((s) => ({ ...s, color: agentColor(s.key) }));
  const spendGroupNote = refine.groupBy === 'outcome' ? 'Not grouped by outcome: spend is recorded per agent, not per job outcome. Showing by agent.'
    : refine.groupBy === 'workflow' ? 'Not grouped by workflow: the agent record has no workflow split yet (needs crew data). Showing by agent.' : null;
  const outcomeGroups = useMemo(() => outcomeRows(kept, refine.groupBy === 'outcome' ? 'workflow' : refine.groupBy, names).map((r) => ({ key: r.key, label: r.label, values: r.counts as unknown as Record<string, number> })), [kept, refine.groupBy, names]);
  const spendTotal = sum(spendBars.flatMap((s) => s.values));
  const availability = byProjectOn ? projectSeries?.map((s) => s.availability) ?? [] : [spendAvailability(record.reads, refine.agent)];
  const unpriced = availability.some((s) => s?.unpriced);
  const unknownSpend = unpriced && !availability.some((s) => s?.anyPriced);
  const rosterKeys = useMemo(() => displaySeats(roster).map((s) => s.key), [roster]);
  // Agent rows exist only from a read record: an unread or failed record is never a row of zeros.
  const agents = useMemo(() => (record.window === null ? [] : agentRows(record.window, kept, names, rosterKeys, refine.workflow)).filter((a) => refine.agent === null || a.cli === refine.agent), [record.window, kept, names, rosterKeys, refine.agent, refine.workflow]);
  const flows = useMemo(() => workflowRows(kept), [kept]);
  // Open failures follow the refine bar's project, agent and workflow (the window is failureCounts' own).
  const openFailures = useMemo(() => {
    if (!refined(refine)) return failureCounts(runs, needRows, refine.days, now);
    const inScope = runs.filter((v) => (refine.project === null || projectOf(v) === refine.project)
      && (refine.workflow === null || workflowOf(v).key === refine.workflow) && (refine.agent === null || agentsOf(v).includes(refine.agent)));
    const ids = new Set(inScope.map((v) => v.session.id));
    return failureCounts(inScope, needRows.filter((r) => { const id = needRunId(r); return id !== null && ids.has(id); }), refine.days, now);
  }, [runs, needRows, refine, now]);
  const tips = useMemo(() => callouts({ agents, workflows: flows, acp: refine.agent === null ? acp : acp === null ? null : Object.fromEntries(Object.entries(acp).filter(([k]) => k === refine.agent)), openFailures: openFailures.inWindow.length + openFailures.older, days: refine.days, scoped: projectId !== undefined || refined(refine), workflow: refine.workflow }), [agents, flows, acp, openFailures, refine, projectId]);

  const runsState: ChartState = !runsShown ? { kind: 'loading' } : kept.length === 0 ? { kind: 'empty', text: `No jobs started in the last ${refine.days} days${refined(refine) ? ' in this view' : ''}.` } : { kind: 'ready' };
  const spendTruncated = byProjectOn ? byProject.truncated : record.truncated;
  // Truncated: by agent nothing is drawn (spendSeries is null); by project the complete projects still
  // draw and the truncated ones are left out as unread, under the partial note.
  const spendState: ChartState = spendTruncated && spendTotal === 0
    ? { kind: 'needs-crew', text: `${PARTIAL_RECORD_NOTE}. Spend buckets affected by truncated reads are unknown and omitted.` }
    : projectId === 'default'
    ? { kind: 'empty', text: 'Spend is counted per project, so work not in a project has none of its own.' }
    : refine.workflow !== null
    ? { kind: 'needs-crew', text: 'Spend can’t be split by workflow yet: the agent record has no workflow filter.' }
    : record.phase === 'loading' || (byProjectOn && byProject.phase === 'loading') ? { kind: 'loading' }
      : byProjectOn && projectIds.length > 0 && projectsUnread === projectIds.length ? { kind: 'error', text: 'Couldn’t read spend for any project in this window.' }
      // Some projects unread and the rest at $0: unknown, never a zero verdict.
      : byProjectOn && projectsUnread > 0 && spendTotal === 0 ? { kind: 'error', text: `Couldn’t read spend for ${projectsUnread} of ${projectIds.length} projects, and the rest recorded none.` }
      : !byProjectOn && spend === null ? { kind: 'error', text: 'Couldn’t read spend for this window.' }
        : unknownSpend ? { kind: 'needs-crew', text: 'Spend unknown: usage recorded, no price reported.' }
        : spendTotal === 0 ? { kind: 'empty', text: `No priced usage in the last ${refine.days} days${refined(refine) ? ' in this view' : ''}.` } : { kind: 'ready' };
  const money = (v: number): string => (v === 0 ? '$0' : v < 1 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`);

  const heldByNeeds = useMemo(() => new Set(needRows.map(needRunId).filter((id): id is string => id !== null)), [needRows]);
  const finishedN = kept.filter((v) => { const o = outcomeOf(v); return o === 'Finished' || o === 'Answered'; }).length;
  const endedN = kept.filter((v) => ['Finished', 'Answered', 'Failed', 'Stopped'].includes(outcomeOf(v) ?? '')).length;
  const busiest = jobsSeries.length === 0 ? null : buckets.map((b, i) => ({ b, n: sum(jobsSeries.map((x) => x.values[i] ?? 0)) })).sort((a, b) => b.n - a.n)[0]!;
  const topSpender = spendBars.map((x) => ({ x, v: sum(x.values) })).sort((a, b) => b.v - a.v)[0];
  // ── The Report stat row: five numbers that follow the refine bar. ──
  const prev = useMemo(() => refineRuns(runs, refine, now - refine.days * 86_400_000).kept, [runs, refine, now]);
  const rate = (vs: readonly SessionView[]): number | null => {
    const ended = vs.filter((v) => ['Finished', 'Answered', 'Failed', 'Stopped'].includes(outcomeOf(v) ?? ''));
    return ended.length === 0 ? null : ended.filter((v) => ['Finished', 'Answered'].includes(outcomeOf(v) ?? '')).length / ended.length;
  };
  const rateNow = rate(kept);
  const ratePrev = rate(prev);
  const winSpend = useWindowSpend(refine.days, scope ?? undefined, workPrint, refine.agent === null && refine.workflow === null && projectId !== 'default');
  // "Agents ready" is the Agents tab's own Ready-for-work count, from the same rows (one model, one number).
  const agentsView = useAgentRows();
  const agentsTile = agentTiles(agentsView.rows);
  const jobTotals = buckets.map((_, i) => sum(jobsSeries.map((x) => x.values[i] ?? 0)));
  const spendTotals = buckets.map((_, i) => sum(spendBars.map((x) => x.values[i] ?? 0)));
  const allRunning = useMemo(() => liveRows(runs, (v) => jobTitle(v.session), heldByNeeds).length, [runs, heldByNeeds]);
  const workSpend = useWindowSpend(30, projectId, workPrint, tab === 'work' && projectId !== 'default');
  const workFailed = useMemo(() => failureCounts(runs, needRows, 30, now), [runs, needRows, now]);
  // Small-sample honesty: under 20 jobs a rate is said as a count and no change is claimed.
  const few = kept.length < SMALL_SAMPLE;
  const delivered = kept.filter((v) => { const d = (v.session as { delivery?: unknown }).delivery; return d === 'delivered' || d === 'pushed'; }).length;
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
        <h1 className="wk-desk-a-title" data-testid={projectHead !== undefined ? 'project-title' : undefined}>{projectHead?.title ?? 'Desk'}</h1>
        <p data-testid="desk-as-of" className="wk-desk-a-when">{projectHead?.meta ?? (readState === 'known' ? `As of ${asOf}` : readState === 'stale' ? 'As of the last read' : 'Reading…')}</p>
      </div>
      {/* Search, New job and Chat live in the rail on every page (SessionRail's action row): the header
          names the page and carries only what is this page's own. */}
      {projectHead !== undefined ? <div className="wk-desk2-actions">{projectHead.actions}</div> : <div className="wk-desk2-actions">
        <DeskMore runs={runs} needs={readState === 'known' ? needRows.length : null} />
      </div>}
    </header>
  );

  const tabs = (
    <div role="tablist" aria-label="Desk view" className="wk-desk2-tabs" data-testid="desk-tabs">
      {DESK_TABS.map((t) => (
        <a key={t.id} role="tab" id={tabId(t.id)} aria-controls={panelId(t.id)} tabIndex={tab === t.id ? 0 : -1}
          href={tabPath(t.id)} aria-selected={tab === t.id} data-testid={`desk-tab-${t.id}`} className="wk-desk2-tab"
          onKeyDown={(e) => { keyboardFocus.current = handleTabKeyDown(e)?.id ?? null; }}
          onClick={(e) => { e.preventDefault(); goTab(t.id); }}>{t.label}</a>
      ))}
    </div>
  );

  const runningPath = everythingPath({ tab: 'sessions', filter: 'active', ...(projectId !== undefined ? { project: projectId } : {}) });
  const work = (
    <div role="tabpanel" id={panelId('work')} aria-labelledby={tabId('work')} data-testid="desk-work" className="wk-work">
      {/* The handover is studio-wide (the audit trail and its dismissal are global): the Desk only, never a project page. */}
      {projectId === undefined && handover.since !== null && <HandoverPanel handover={handover} navigate={navigate} now={now} runs={runs} />}
      {/* At a glance: four quiet numbers on one surface, above the band (each opens its list). */}
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
      {/* The band: Needs you (the lead) beside Happening now, the same height, each scrolling inside. */}
      <div className="wk-work-top">
        <DeskInbox rows={needRows} runs={runs} navigate={navigate} now={now} settled={readState === 'known' ? settled.phase : 'loading'} agentName={agentName} extra={projectId === undefined ? choresBlock : null} setupCount={setup.length}
          missing={settled.missing} onRetry={rereadSources} retrying={rereading} />
        <DeskHappening runs={runs} runsShown={runsShown} navigate={navigate} now={now} title={(v) => jobTitle(v.session)} pathOf={pathOfRun} agentName={agentName}
          scope={projectRunIds} scopeKey={projectId ?? 'desk'} {...(projectId !== undefined ? { seeAllPath: everythingPath({ tab: 'sessions', project: projectId }) } : {})} />
      </div>
      {/* B9: the one sentence about a rule remembered since the last visit (null when there is none). */}
      {projectId === undefined && <DeskRuleLine navigate={navigate} />}
      {workExtra}
    </div>
  );

  const reportScope = [`the last ${refine.days} days`, scope !== null ? `project ${projectName(scope)}` : null,
    refine.agent !== null ? `agent ${agentName(refine.agent)}` : null, refine.workflow !== null ? `workflow ${workflowLabel(refine.workflow)}` : null].filter((x): x is string => x !== null).join(', ');
  const ask = (q: string): void => openAskDock({ fresh: true, projectId: scope !== null && scope !== 'default' ? scope : null, seedText: `${q} (Look at ${reportScope}; answer from the run record and cite the jobs.)${refine.workflow !== null ? ` ${AGENT_WORKFLOW_NOTE} Do not treat agent-record totals as workflow-scoped numbers.` : ''}` });

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
    <div role="tabpanel" id={panelId('report')} aria-labelledby={tabId('report')} data-testid="desk-report" className="wk-understand">
      {refineBarOf(true)}
      <div className="wk-understand-cols">
        <div className="wk-understand-main">
          <ul className="wk-stats" aria-label="This window" data-testid="desk-stats">
            <DeskStat icon={Rocket} tone="accent" label="Jobs started" testId="desk-stat-started" value={runsShown ? String(kept.length) : null}
              note={few ? 'too few jobs to compare' : deltaWords(kept.length, prev.length, (d) => `${Math.abs(d)}`, refine.days)} spark={jobTotals} />
            <DeskStat icon={CheckCircle2} tone="ok" label="Finished" testId="desk-stat-success" value={!runsShown ? null : rateNow === null ? '—' : few ? `${finishedN} of ${endedN}` : `${Math.round(rateNow * 100)}%`}
              note={rateNow === null ? 'no job ended yet' : few ? 'too few jobs to compare' : ratePrev === null ? 'of the jobs that ended' : deltaWords(Math.round(rateNow * 100), Math.round(ratePrev * 100), (d) => `${Math.abs(d)} pts`, refine.days)} />
            <DeskStat icon={Send} tone="accent" label="Delivered" testId="desk-stat-delivered" value={runsShown ? String(delivered) : null}
              note={delivered === 0 ? 'no job delivered in this window' : `of ${kept.length} started`} />
            <DeskStat icon={Wallet} tone="accent" label="Spend" testId="desk-stat-spend" value={spendState.kind === 'ready' || spendState.kind === 'empty' ? `${unpriced ? 'at least ' : ''}${moneyWords(spendTotal)}` : spendState.kind === 'loading' ? null : '—'}
              note={spendState.kind === 'error' ? spendState.text
                : spendTruncated ? PARTIAL_RECORD_NOTE
                : unknownSpend ? 'Spend unknown: usage recorded, no price reported'
                : projectsUnread > 0 ? `at least: ${projectsUnread} ${projectsUnread === 1 ? 'project' : 'projects'} not read`
                : unpriced ? 'priced usage only'
                : !few && winSpend.phase === 'done' && winSpend.previous !== null && refine.agent === null ? deltaWords(spendTotal, winSpend.previous, (d) => moneyWords(Math.abs(d)), refine.days) : `last ${refine.days} days`} {...(spendTruncated || unknownSpend ? {} : { spark: spendTotals })} />
            <DeskStat icon={CheckCircle2} tone="ok" label="Quality checks passed" testId="desk-stat-quality" value={runsShown ? qualityValue : null}
              note={runsShown ? qualityNote : 'Reading…'} loading={!runsShown || quality.tally === null} loadingNote={runsShown ? 'Reading checks…' : 'Reading…'} />
          </ul>
          <div className="wk-desk2-charts">
            <ChartCard title="Jobs started" state={runsState} data-testid="desk-viz-jobs"
              meta={busiest !== null && busiest.n > 1 ? `by ${per} · busiest ${busiest.b.label}` : `by ${per}`}
              note={undated > 0 ? `${undated} ${undated === 1 ? 'job has' : 'jobs have'} no start time and ${undated === 1 ? 'is' : 'are'} left out.` : refine.groupBy === 'agent' ? 'Each job counts under the agent that took most of its steps.' : undefined}>
              <StackedBars buckets={buckets} series={jobsSeries} format={(v) => String(Math.round(v))} label={`Jobs started per ${per}, last ${refine.days} days, by ${groupWord(refine.groupBy)}`} compact height={phone ? 96 : 120} data-testid="desk-chart-jobs" />
            </ChartCard>
            <ChartCard id="desk-focus-spend" title="Spend" state={spendState} data-testid="desk-viz-spend"
              meta={topSpender !== undefined ? `by ${per} · most on ${topSpender.x.label}` : `by ${per}`}
              note={[unpriced && !unknownSpend ? `At least ${moneyWords(spendTotal)} · priced usage only.` : null, spendTruncated ? `${PARTIAL_RECORD_NOTE}. Spend buckets affected by truncated reads are unknown and omitted.` : projectsUnread > 0 && spendState.kind === 'ready' ? `Spend for ${projectsUnread} ${projectsUnread === 1 ? 'project' : 'projects'} couldn’t be read and is left out.` : spendGroupNote ?? (refine.days === 90 ? 'The oldest week is 6 days: the record reaches 90 days back.' : null)].filter(Boolean).join(' ') || undefined}>
              <AreaChart buckets={buckets} series={spendBars} format={money} label={`Spend per ${per} by ${refine.groupBy === 'project' ? 'project' : 'agent'}, last ${refine.days} days`} compact height={phone ? 96 : 120} data-testid="desk-chart-spend" />
            </ChartCard>
            <ChartCard title="Outcomes" state={runsState} data-testid="desk-viz-outcomes"
              meta={`by ${refine.groupBy === 'outcome' ? 'workflow' : groupWord(refine.groupBy)} · ${rateNow === null ? 'none ended' : few ? `${finishedN} of ${endedN} finished` : `${Math.round(rateNow * 100)}% finished`}`}
              note={refine.groupBy === 'outcome' ? 'Grouped by workflow: the bars are already split by outcome.' : refine.groupBy === 'agent' ? 'A job counts once, under the agent that took most of its steps.' : undefined}>
              <OutcomeBreakdown rows={outcomeGroups} segments={OUTCOMES.map((o) => ({ key: o, label: o, color: outcomeColor(o) }))}
                groupLabel={refine.groupBy === 'outcome' ? 'Workflow' : cap(groupWord(refine.groupBy))}
                centre={rateNow === null ? '—' : few ? `${finishedN}/${endedN}` : `${Math.round(rateNow * 100)}%`} centreLabel="finished"
                label={`Job outcomes by ${refine.groupBy === 'outcome' ? 'workflow' : groupWord(refine.groupBy)}, last ${refine.days} days`} />
            </ChartCard>
            <section className="wk-card wk-viz wk-viz-insights" aria-labelledby="desk-insights-title" data-testid="desk-insights">
              <header className="wk-viz-head"><h3 id="desk-insights-title" className="wk-viz-title">Improve this</h3><span className="wk-viz-meta">{refine.groupBy === 'agent' ? 'by agent' : refine.groupBy === 'workflow' ? 'by workflow' : 'from the evidence'}</span></header>
              {refine.workflow !== null && <p className="wk-viz-note">{AGENT_WORKFLOW_NOTE}</p>}
              <InsightCards items={groupTips(tips, refine.groupBy)} loading={!runsShown || (refine.workflow === null && record.phase === 'loading')} recordFailed={refine.workflow === null && record.phase === 'error'} navigate={navigate} workPath={tabPath('work')} />
              {(refine.groupBy === 'project' || refine.groupBy === 'outcome') && <p className="wk-viz-note">Not grouped by {refine.groupBy}: each finding is about an agent, a workflow or failed jobs.</p>}
            </section>
          </div>
        </div>
        <aside className="wk-card wk-reports" aria-labelledby="desk-reports-title" data-testid="desk-reports">
          <h3 id="desk-reports-title" className="wk-desk2-title">Ask about it</h3>
          <p className="wk-viz-note">Opens Chat with the question written for {reportScope}. Press Send when it reads right.</p>
          <ul className="wk-reports-list">
            {REPORTS.map((r) => (
              <li key={r.id}>
                <button type="button" data-testid="desk-report" data-id={r.id} className="wk-report" onClick={() => ask(r.question)}>
                  <r.icon size={15} aria-hidden className="wk-report-icon" />
                  <span className="wk-report-text"><span className="wk-report-q">{r.question}</span><span className="wk-report-from">From {r.from}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );

  const runsTab = (
    <DeskRuns {...(runActions !== undefined ? { rowActions: runActions } : {})} runs={runs} runsShown={runsShown} refine={refine} refineBar={refineBarOf(false)} now={now} navigate={navigate} pathOf={pathOfRun}
      panelId={panelId('runs')} labelledBy={tabId('runs')}
      agentName={agentName} projectName={projectName} title={jobTitleOf} showProject={projectId === undefined} />
  );

  const governance = (cli: string) => governanceOf(cli, acp, roster ?? []);

  const understand = (
    <div role="tabpanel" id={panelId('understand')} aria-labelledby={tabId('understand')} data-testid="desk-understand" className="wk-understand">
      <DeskUnderstand runsShown={runsShown} agents={agents} agentsRead={record.phase} agentsTruncated={record.truncated}
        filterAgent={refine.agent} filterWorkflow={refine.workflow}
        filters={[refine.agent !== null ? `agent ${agentName(refine.agent)}` : null, refine.workflow !== null ? `workflow ${workflowLabel(refine.workflow)}` : null].filter((x): x is string => x !== null).join(', ') || null}
        workflows={flows} kept={kept} allRuns={runs} days={refine.days} onDays={(d) => set('days', d)} project={scope}
        projectLabel={scope === null ? null : projectName(scope)} projectName={projectName} agentName={agentName} governance={governance}
        navigate={navigate} pathOf={pathOfRun} now={now} />
    </div>
  );

  if (isHosted(tab)) {
    // The hosted pages (Repositories, Steer, Memory, Agents, Evaluate): App renders the page for the
    // address the tab carries (`&at=/rules/...`, `&at=/memory?view=proposals`), so every sub-page and
    // deep link keeps working.
    return (
      <div data-testid="desk" data-object="desk" data-desk="v2" data-tab={tab} className="wk-desk wk-desk2 wk-desk2--hosted">
        <div className="wk-desk2-hosted-head">{header}{tabs}</div>
        <div className="wk-desk2-hosted" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} data-testid={`desk-${tab}`}>
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
        {header}
        {tabs}
        {tab === 'work' ? work : tab === 'runs' ? runsTab : tab === 'report' ? report : understand}
      </div>
      {signIn !== null && <AgentModal agentKey={signIn.key} onClose={() => setSignIn(null)} />}
    </div>
  );
}

export type DeskTab = 'work' | 'runs' | 'repositories' | 'report' | 'understand' | 'steer' | 'memory' | 'agents' | 'evaluate';
export type HostedTab = 'repositories' | 'steer' | 'memory' | 'agents' | 'evaluate';
const HOSTED: readonly HostedTab[] = ['repositories', 'steer', 'memory', 'agents', 'evaluate'];
function isHosted(t: DeskTab): t is HostedTab { return (HOSTED as readonly string[]).includes(t); }

/** The Desk's tabs, in order (the address carries `?tab=`; Work is the default). */
export const DESK_TABS: readonly { id: DeskTab; label: string }[] = [
  { id: 'work', label: 'Work' },
  { id: 'runs', label: 'Runs' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'report', label: 'Report' },
  { id: 'understand', label: 'Understand' },
  { id: 'steer', label: 'Steer' },
  { id: 'memory', label: 'Memory' },
  { id: 'agents', label: 'Agents' },
  { id: 'evaluate', label: 'Evaluate' },
];

/** Each hosted tab's own page when the address names none. */
export const HOSTED_HOME: Record<HostedTab, string> = { repositories: '/repos', steer: '/rules', memory: '/memory', agents: '/agents', evaluate: '/testing/evals' };

/** A Desk tab's address; `at` = the hosted page's own address; `base` = `/` or a project's page. */
export function deskTabPath(t: DeskTab, at?: string, base = '/'): string {
  if (t === 'work') return base;
  return `${base}?tab=${t}${at !== undefined ? `&at=${encodeURIComponent(at)}` : ''}`;
}

/** Pre-canned questions the run record, the agent record and the estate can answer (Ask, unchanged). */
const REPORTS: readonly { id: string; question: string; from: string; icon: typeof Inbox }[] = [
  // `from` = what the answer is built from (said on the button).
  { id: 'spend', question: 'Where is my spend going?', from: 'run data: usage and cost per job and agent', icon: Wallet },
  { id: 'fail', question: 'Why do my jobs fail?', from: 'run data: failed steps and their recorded reasons', icon: CircleAlert },
  { id: 'fix', question: 'What should I fix first?', from: 'run data + agent record + estate knowledge', icon: AlertTriangle },
  { id: 'bugs', question: 'Which agent does best on bug jobs?', from: 'run data: bug-job outcomes per agent', icon: Bot },
  { id: 'week', question: 'How did this week compare to last?', from: 'run data: jobs, outcomes and spend per week', icon: Activity },
  { id: 'bench', question: 'Which agents keep sitting out, and why?', from: 'agent record: benches and their reasons', icon: Info },
  { id: 'slow', question: 'Which workflow takes longest, and where does the time go?', from: 'run data: step start and end times', icon: Rocket },
  { id: 'gov', question: 'Did any job run without its governance checks?', from: 'run data + estate governance records', icon: CheckCircle2 },
];


function deltaWords(cur: number, prev: number, fmt: (d: number) => string, days: number): string {
  const d = cur - prev;
  if (d === 0) return `same as prior ${days}d`;
  return `${d > 0 ? '▲' : '▼'} ${fmt(d)} vs prior ${days}d`;
}

/** One stat tile: a quiet icon, one big number, a short label, a delta or a sparkline. */

const SMALL_SAMPLE = 20;

const jobTitleOf = (v: SessionView): string => jobTitle(v.session);

const TONE_ICON = { fail: CircleAlert, warn: AlertTriangle, info: Info } as const;
const INSIGHTS_SHOWN = 3;

/** The top improve-this callouts as compact cards; "See all" opens the rest in place. */
function InsightCards({ items, loading, recordFailed, navigate, workPath }: { items: readonly Callout[]; loading: boolean; recordFailed: boolean; navigate: Navigate; workPath: string }): React.ReactElement {
  const [all, setAll] = useState(false);
  if (loading) return <div className="wk-insight-grid"><div className="wk-card wk-insight"><Skeleton rows={2} variant="line" /></div></div>;
  // A failed agent record says so: no verdict about agents is drawn from a read that did not land.
  const unread = recordFailed ? <p className="wk-viz-note" data-testid="desk-callouts-partial">Couldn’t read the agent record, so nothing here is about agents.</p> : null;
  if (items.length === 0) return <>{unread ?? <p className="wk-viz-state" data-testid="desk-callouts-none">Nothing to fix from what was read in this window.</p>}</>;
  const shown = all ? items : items.slice(0, INSIGHTS_SHOWN);
  return (
    <>
      {unread}
      <ul className="wk-insight-grid" data-testid="desk-callouts">
        {shown.map((c) => {
          const Icon = TONE_ICON[c.tone];
          return (
            <li key={c.id} data-testid="desk-callout" data-id={c.id} data-tone={c.tone} className="wk-card wk-insight">
              <span className="wk-insight-title"><Icon size={15} aria-hidden className="wk-callout-icon" />{c.title}</span>
              <span className="wk-insight-why">{c.why} {c.fix}</span>
              <a href={c.evidence.path} data-testid="desk-callout-evidence" className="wk-link wk-insight-link"
                onClick={(e) => {
                  e.preventDefault();
                  // An in-page anchor (the inbox) lives on the Work tab: go there, then bring it into view once it mounts.
                  if (c.evidence.path.startsWith('#')) {
                    const id = c.evidence.path.slice(1);
                    navigate(workPath);
                    const t0 = Date.now();
                    const find = (): void => {
                      const el = document.getElementById(id);
                      if (el !== null) { el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }); (el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button, a') ?? el).focus?.(); }
                      else if (Date.now() - t0 < 2000) requestAnimationFrame(find);
                    };
                    requestAnimationFrame(find);
                  } else navigate(c.evidence.path);
                }}>Evidence: {c.evidence.label}</a>
            </li>
          );
        })}
      </ul>
      {items.length > INSIGHTS_SHOWN && (
        <button type="button" data-testid="desk-callouts-more" aria-expanded={all} className="wk-link wk-insights-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `See all ${items.length}`}
        </button>
      )}
    </>
  );
}

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

/** Improve this, grouped: agent findings first (by agent) or workflow findings first (by workflow). */
function groupTips(items: readonly Callout[], g: GroupBy): Callout[] {
  const kind = (c: Callout): string => (c.id.startsWith('wf:') ? 'workflow' : c.id === 'failures' ? 'jobs' : 'agent');
  if (g !== 'agent' && g !== 'workflow') return [...items];
  return [...items].sort((a, b) => Number(kind(b) === g) - Number(kind(a) === g) || a.id.localeCompare(b.id));
}


function groupWord(g: GroupBy): string { return g; }

function cap(w: string): string { return w.charAt(0).toUpperCase() + w.slice(1); }

function colorFor(g: GroupBy, key: string, i: number): string {
  if (g === 'outcome') return outcomeColor(key);
  if (g === 'agent') return key === 'none' ? 'var(--status-done)' : agentColor(key);
  return catColor(i);
}

