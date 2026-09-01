import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { listDocs, type DocSummary } from '../api/interactive.js';
import { useDocsCache } from '../store/docsCache.js';
import type { SessionView } from '../api/types.js';
import { compareScored, scoreOf, type Signal, type SignalKind } from '../board/boardAttention.js';
import { gateOpenPath } from '../board/gateActions.js';
import { outcomeOf, WINDOW_LABEL_STYLE } from '../board/metrics.js';
import {
  attachSeries, deltaWord, statusCounts, windowBuckets, windowDelta,
} from '../board/windowStats.js';
import { launchPath, sessionProjectId } from '../hooks/ambientProject.js';
import { interactiveRootOf } from '../hooks/useBoardModel.js';
import { modePath, type Mode, type Navigate } from '../hooks/useRoute.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useTriageCursor, type TriageItem } from '../hooks/useTriageCursor.js';
import { useGateStore } from '../store/gates.js';
import { useProjectsStore } from '../store/projects.js';
import { getCachedRepos } from '../store/repoCache.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { BatchGateBar, BatchSelectBox } from './BatchGateBar.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, StatTile, type FilterChip,
} from './dashboardKit.js';
import { GateChip } from './GateChip.js';
import { GateRejectNote } from './GateRejectNote.js';
import { MODE_LABEL } from './ProjectShell.js';
import { ago, ATTENTION_DOT } from './ProjectCard.js';
import { ageWord } from './DashboardTiles.js';
import { deliverySummary } from './delivery.js';
import { useIsSystemWorkflow } from '../store/workflowCache.js';
import { DeliveryChip } from './RunDelivery.js';
import { humanTitle, runShortId, runWhenWord } from './runIdentity.js';
import { STATUS_STYLE } from './RunCard.js';

/**
 * The project HOMEPAGE — `/p/:projectId` with no mode segment (lane B): the
 * same command-surface kit as /projects, scoped to one project. A KPI band
 * (its runs/active/gates/failed with honest window deltas + a sparkline of its
 * run history on the attach clock), the gate inbox FIRST (attention routing
 * beats navigation), then its runs/chats/docs as filterable full-width cards.
 * The creation verbs live in the header (Do Work + the four mode verbs);
 * failed runs carry an inline Retry (a prefill, never a hidden relaunch).
 *
 * Everything derives from data the app already fetches: the shared `runs`
 * list, one membership read, one `listDocs` (only when the project has an
 * interactive root), and the gate store. No polling loops, no new wires.
 */

/** Statuses that mean the run is moving under its own power (board's set). */
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/** Membership kinds that make a run/thread a member of a project. */
const RUN_KINDS: ReadonlySet<string> = new Set(['crew.run', 'crew.chat']);

/** Gate-inbox rows before the list reports a count instead of growing. */
const MAX_GATE_ROWS = 6;

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);

const CSS = {
  // FULL WIDTH (lane B): the dashboard flows with the viewport.
  page: { padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
  name: {
    fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)',
    fontFamily: 'var(--font-sans)', color: 'var(--ink-high)', margin: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  modeBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '5px', textDecoration: 'none',
    background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-md)', color: 'var(--ink-high)', cursor: 'pointer',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', padding: '5px 12px',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-muted)', margin: '6px 0 0',
  },
  sectionHead: {
    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--ink-muted)', margin: '0 0 8px',
  },
  card: {
    display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
    background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-4)',
    cursor: 'pointer',
  },
  cardMeta: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
    whiteSpace: 'nowrap',
  },
  empty: { fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', margin: 0 },
  // The empty state's CTA — the named verb IS the door (never dead prose).
  emptyCta: { color: 'var(--ink-muted)', textDecoration: 'underline', cursor: 'pointer' },
  emptyCtaBtn: {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    color: 'var(--ink-muted)', textDecoration: 'underline', cursor: 'pointer',
  },
  // studio#122: the delivery census under the RUNS head. Data, so mono + dim.
  deliverySummary: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--ink-dim)', margin: '-4px 0 8px',
  },
} as const satisfies Record<string, React.CSSProperties>;

/** The per-run attention signal — the home board's model scoped to one run. */
function runSignal(v: SessionView, gateAt: number | undefined, fallback: number): Signal | null {
  const status = v.session.status;
  const kind: SignalKind | null =
    status === 'awaiting_human' ? 'gate'
    : status === 'failed' ? 'failing'
    : ACTIVE.has(status) ? 'running'
    : null;
  return kind === null ? null : { kind, at: gateAt ?? fallback, runId: v.session.id };
}

type StatusChip = 'all' | 'needs-you' | 'active' | 'failed' | 'done';

function matchesChip(status: string, chip: StatusChip): boolean {
  if (chip === 'all') return true;
  const o = outcomeOf(status);
  if (chip === 'needs-you') return o === 'gate';
  if (chip === 'active') return o === 'run';
  if (chip === 'failed') return o === 'fail';
  return o === 'done' || o === 'cancelled';
}

interface Props {
  projectId: string;
  /** The one cross-project run list App already holds (`useRuns()`). */
  runs: SessionView[];
  navigate: Navigate;
}

export function ProjectDashboard({ projectId, runs, navigate }: Props): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);
  const gates = useGateStore((s) => s.gates);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<StatusChip>('all');
  const { range, setRange } = useTimeRange('30d');

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
  }, [projects.length, loadProjects]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const name = project?.name ?? projectId;

  // One membership read on mount — the same call the board makes per project.
  const [memberKinds, setMemberKinds] = useState<Record<string, string>>({});
  const [attachedAt, setAttachedAt] = useState<Record<string, number>>({});
  const [repoRefs, setRepoRefs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.listProjectMembers(projectId)
      .then(({ members }) => {
        if (cancelled) return;
        const kinds: Record<string, string> = {};
        const at: Record<string, number> = {};
        const repos: string[] = [];
        for (const m of members) {
          if (m.member_kind === 'crew.repo') {
            repos.push(m.member_ref);
            continue;
          }
          if (!RUN_KINDS.has(m.member_kind)) continue;
          kinds[m.member_ref] = m.member_kind;
          at[m.member_ref] = m.attached_at;
        }
        setMemberKinds(kinds);
        setAttachedAt(at);
        setRepoRefs(repos);
      })
      .catch(() => { /* members unreadable — the tiles simply stay empty */ });
    return () => { cancelled = true; };
  }, [projectId]);

  // One listDocs on mount — only when the project HAS an interactive root.
  const [docs, setDocs] = useState<DocSummary[]>([]);
  useEffect(() => {
    if (project === null || interactiveRootOf(project) === null) return;
    let cancelled = false;
    listDocs(projectId)
      .then((d) => {
        useDocsCache.getState().deposit(projectId, d); // the session doc cache
        if (!cancelled) setDocs(d);
      })
      .catch(() => { /* bridge cold/unreachable — no doc cards, never an error wall */ });
    return () => { cancelled = true; };
  }, [projectId, project]);

  // ── The project's runs, attention-ordered (needs-you floats FIRST) ─────────
  const fallbackAt = project?.updated_at ?? 0;
  const myRuns = useMemo(() => {
    const now = Date.now();
    return runs
      .filter((v) => {
        if (v.session.archived_at != null) return false;
        const claimed = sessionProjectId(v.session);
        return claimed !== undefined ? claimed === projectId : v.session.id in memberKinds;
      })
      .map((v) => {
        const signal = runSignal(v, gates[v.session.id]?.receivedAt, attachedAt[v.session.id] ?? fallbackAt);
        return {
          view: v,
          signal,
          score: signal === null ? 0 : scoreOf(signal, now),
          at: signal?.at ?? attachedAt[v.session.id] ?? fallbackAt,
        };
      })
      .sort((a, b) => compareScored(
        { score: a.score, at: a.at, name: a.view.session.problem },
        { score: b.score, at: b.at, name: b.view.session.problem },
      ));
  }, [runs, memberKinds, attachedAt, gates, fallbackAt, projectId]);

  // studio#122: the delivery census, over EVERY run in the project.
  const isSystemWorkflow = useIsSystemWorkflow();
  const deliveryCensus = useMemo(
    () => deliverySummary(myRuns.map(({ view }) => view), isSystemWorkflow),
    [myRuns, isSystemWorkflow],
  );

  const openRuns = myRuns.filter(({ view }) => !TERMINAL.has(view.session.status));
  const waiting = myRuns.filter(({ view }) => view.session.status === 'awaiting_human');

  // ── The window (positional recency, honestly labeled) + KPI folds ──────────
  const orderedViews = useMemo(() => myRuns.map(({ view }) => view), [myRuns]);
  const buckets = useMemo(() => windowBuckets(orderedViews, range), [orderedViews, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);
  const now = Date.now();

  const liveCounts = useMemo(() => statusCounts(orderedViews), [orderedViews]);
  const runsDelta = useMemo(() => windowDelta(buckets, (rs) => rs.length), [buckets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => outcomeOf(v.session.status) === 'fail').length),
    [buckets],
  );
  const runSpark = useMemo(
    () => attachSeries(Object.keys(attachedAt), attachedAt, 14, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-derives with the data, not a timer
    [attachedAt],
  );
  const oldestGate = waiting.reduce<number | null>((acc, { view }) => {
    const at = gates[view.session.id]?.receivedAt;
    return at === undefined ? acc : acc === null || at < acc ? at : acc;
  }, null);

  // Meta line: last activity + open runs. Cost is NOT here on purpose —
  // the `/runs` wire carries no cost field, and the dashboard never invents one.
  const lastActivity = Math.max(
    fallbackAt,
    ...Object.values(attachedAt),
    ...waiting.map(({ view }) => gates[view.session.id]?.receivedAt ?? 0),
  );

  /** Every affordance is a real link — deep-linkable, middle-clickable. */
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); e.stopPropagation(); navigate(path); },
  });

  /** Where a run row opens: its OWN mode view — Chat for a chat thread, Build otherwise. */
  const runModeOf = (id: string): Mode => (memberKinds[id] === 'crew.chat' ? 'chat' : 'build');

  /** Retry-as-prefill (DES-UX-001 §4.3) — the ChatPanel contract, verbatim:
   *  deposit the failed run's launch config, open the composer, nothing
   *  auto-launches. The launch then carries `retryOf` (CREW-UX-3). */
  function startRetry(v: SessionView): void {
    const s = v.session;
    setRetryPrefill({
      retryOf: s.id,
      problem: s.problem,
      clis: s.clis,
      workflowId: s.workflow_id && s.workflow_id !== 'chat' ? s.workflow_id : null,
      repoRef: s.repo_ref,
      entityMode: s.entity_mode,
      humanConfirm: s.human_confirm,
      projectId: typeof s.project_id === 'string' ? s.project_id : projectId,
    });
    navigate('/runs/new');
  }

  // ── The triage cursor walks the gate-inbox rows, in their order ─────────────
  const inboxRows = waiting.slice(0, MAX_GATE_ROWS);
  const triageItems = useMemo<TriageItem[]>(
    () =>
      inboxRows.map(({ view }) => {
        const id = view.session.id;
        return {
          key: id,
          runId: id,
          gate: gates[id],
          openPath: modePath(projectId, runModeOf(id), id),
          projectId,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inboxRows/runModeOf derive from these
    [waiting, gates, memberKinds, projectId],
  );
  const cursor = useTriageCursor(triageItems, navigate, projectId);

  // ── The filtered run cards (search lifts the window — Work page idiom) ─────
  const q = query.trim().toLowerCase();
  const searched = q === ''
    ? myRuns.filter(({ view }) => windowIds.has(view.session.id))
    : myRuns.filter(({ view }) =>
        view.session.problem.toLowerCase().includes(q)
        || runShortId(view.session.id).includes(q));
  const visibleRuns = searched.filter(({ view }) => matchesChip(view.session.status, chip));
  const hiddenByWindow = q === '' ? orderedViews.length - buckets.current.length : 0;

  const chipCounts: Record<StatusChip, number> = useMemo(() => {
    const counts: Record<StatusChip, number> = { all: 0, 'needs-you': 0, active: 0, failed: 0, done: 0 };
    for (const { view } of searched) {
      counts.all += 1;
      for (const c of ['needs-you', 'active', 'failed', 'done'] as const) {
        if (matchesChip(view.session.status, c)) counts[c] += 1;
      }
    }
    return counts;
  }, [searched]);

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'active', label: 'Active', count: chipCounts.active },
    { id: 'failed', label: 'Failed', count: chipCounts.failed },
    { id: 'done', label: 'Done', count: chipCounts.done },
  ];

  const visibleDocs = q === '' ? docs : docs.filter((d) => d.name.toLowerCase().includes(q));

  return (
    <div data-testid="project-dashboard" data-project-id={projectId} style={CSS.page}>
      {/* ── Project header: name, the creation verbs, the meta line ── */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h1 style={CSS.name}>{name}</h1>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <a
                key={m}
                {...link(modePath(projectId, m))}
                data-testid={`dashboard-mode-${m}`}
                style={CSS.modeBtn}
              >
                {MODE_LABEL[m]}
              </a>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {/* The section's creation verb — one click from wherever the need appears. */}
          <a
            {...link(launchPath(projectId, 'build'))}
            data-testid="dashboard-do-work"
            style={{
              display: 'inline-flex', alignItems: 'center', textDecoration: 'none',
              background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '6px 14px',
              fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)',
              whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer',
            }}
          >
            Do Work
          </a>
        </div>
        <p style={CSS.meta} data-testid="dashboard-meta">
          last activity {ago(lastActivity)} ago · {openRuns.length} open {openRuns.length === 1 ? 'run' : 'runs'}
        </p>
        {/* Bound repos in the header's meta-line region — names resolve from the
            SAME session repo cache the palette holds; never a fetch. */}
        {repoRefs.length > 0 && (
          <p data-testid="dashboard-repos" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '6px 0 0' }}>
            {repoRefs.map((ref) => {
              const known = getCachedRepos()?.find((r) => r.id === ref || r.name === ref);
              return (
                <a
                  key={ref}
                  {...link(`/repo-detail/${encodeURIComponent(known?.id ?? ref)}`)}
                  data-testid="dashboard-repo"
                  data-repo-ref={ref}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    color: known !== undefined ? 'var(--ink-muted)' : 'var(--ink-dim)',
                    textDecoration: 'none',
                  }}
                >
                  <span aria-hidden>⬡</span>
                  {known?.name ?? ref}
                </a>
              );
            })}
          </p>
        )}
      </header>

      {/* The batch bar docks above the band while ≥1 simple gate is selected. */}
      <BatchGateBar navigate={navigate} />

      {/* ── The KPI band — this project's command center ── */}
      <KpiBand testId="project-kpis">
        <KpiGroup label="Performance" grow={1}>
          <StatTile
            testId="stat-runs"
            label="Runs"
            value={buckets.current.length}
            delta={runsDelta}
            context={deltaWord(range, runsDelta)}
            spark={runSpark}
            title="Runs in the window — clear the grid filters"
            onOpen={() => { setChip('all'); setQuery(''); }}
          />
        </KpiGroup>
        <KpiGroup label="Pipeline" grow={2}>
          <StatTile
            testId="stat-active"
            label="Active now"
            value={liveCounts.active}
            context="right now"
            title="Runs moving under their own power — filter the grid"
            onOpen={() => setChip('active')}
          />
          <StatTile
            testId="stat-gates"
            label="Needs you"
            value={waiting.length}
            valueColor={waiting.length > 0 ? 'var(--status-gate)' : undefined}
            context={oldestGate !== null ? `oldest waiting ${ageWord(now - oldestGate)}` : 'nothing waiting'}
            title={waiting.length > 0 ? 'Jump straight to the waiting gate' : 'Nothing is waiting on you'}
            {...(waiting.length > 0 && waiting[0] !== undefined
              ? {
                  href: gateOpenPath(projectId, waiting[0].view.session.id),
                  onOpen: () => navigate(gateOpenPath(projectId, waiting[0]!.view.session.id)),
                }
              : {})}
          />
        </KpiGroup>
        <KpiGroup label="Risk" grow={1}>
          <StatTile
            testId="stat-failed"
            label="Failed"
            value={failedDelta.current}
            valueColor={failedDelta.current > 0 ? 'var(--status-fail)' : undefined}
            delta={failedDelta}
            deltaSense="bad-up"
            context={deltaWord(range, failedDelta)}
            title="Failed runs in the window — filter the grid to them"
            onOpen={() => setChip('failed')}
          />
        </KpiGroup>
      </KpiBand>

      {/* ── The gate inbox — FIRST: attention routing beats navigation ── */}
      {waiting.length > 0 && (
        <section
          data-testid="dashboard-gates"
          data-count={Math.min(waiting.length, MAX_GATE_ROWS)}
          style={{
            background: 'var(--surface-card)', border: '1px solid var(--status-gate-dim)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
          }}
        >
          <p style={{ ...CSS.sectionHead, color: 'var(--status-gate)' }}>
            Needs you ({waiting.length > MAX_GATE_ROWS ? `${MAX_GATE_ROWS} of ${waiting.length}` : waiting.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {inboxRows.map(({ view }) => {
              const id = view.session.id;
              const gate = gates[id];
              const selected = cursor.selectedKey === id;
              return (
                <div
                  key={id}
                  data-testid="dashboard-gate"
                  data-run-id={id}
                  tabIndex={-1}
                  data-kbd-item={id}
                  {...(selected ? { 'data-kbd-selected': 'true' } : {})}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0,
                    outline: selected ? '2px solid var(--accent)' : 'none',
                    outlineOffset: '2px',
                  }}
                >
                  {cursor.noteFor === id ? (
                    <GateRejectNote runId={id} onClose={cursor.closeNote} />
                  ) : (
                    <>
                      <BatchSelectBox runId={id} gate={gate} />
                      <span
                        title={gate?.prompt}
                        style={{
                          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', fontSize: 'var(--text-xs)',
                          fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
                        }}
                      >
                        {gate?.prompt ?? view.session.problem}
                      </span>
                      <GateChip runId={id} projectId={projectId} gate={gate} navigate={navigate} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Filters — first-class at the top of the list ── */}
      <FilterStrip
        testId="dashboard-filter"
        query={query}
        onQuery={setQuery}
        placeholder="Search runs & docs…"
        chips={chips}
        active={chip}
        onChip={(id) => setChip(id as StatusChip)}
        range={range}
        onRange={setRange}
      >
        {hiddenByWindow > 0 && (
          <button
            type="button"
            data-testid="dashboard-hidden-chip"
            data-hidden={hiddenByWindow}
            onClick={() => setRange('all')}
            title={`the ${rangeWord(range)} window holds back ${hiddenByWindow} older run${hiddenByWindow === 1 ? '' : 's'} — click to show all`}
            style={{
              borderRadius: 'var(--radius-full)', padding: '3px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
              border: '1px solid var(--surface-raised)', background: 'transparent',
              color: 'var(--ink-muted)',
            }}
          >
            +{hiddenByWindow} older · show all
          </button>
        )}
      </FilterStrip>

      {/* ── Runs as full-width cards ── */}
      <section
        data-testid="dashboard-runs"
        data-count={visibleRuns.length}
        data-window={range}
      >
        <p style={CSS.sectionHead}>
          Runs ({visibleRuns.length}){' '}
          <span data-testid="dashboard-runs-window" style={WINDOW_LABEL_STYLE}>{rangeWord(range)}</span>
        </p>
        {/* studio#122: what these runs PRODUCED, counted over ALL of them. */}
        {deliveryCensus !== '' && (
          <p data-testid="dashboard-delivery-summary" style={CSS.deliverySummary}>
            {deliveryCensus}
          </p>
        )}
        {myRuns.length === 0 ? (
          <p style={CSS.empty}>
            No runs yet —{' '}
            <a {...link(launchPath(projectId, 'build'))} data-testid="dashboard-empty-build" style={CSS.emptyCta}>
              Build
            </a>{' '}
            starts one.
          </p>
        ) : visibleRuns.length === 0 ? (
          <p style={CSS.empty} data-testid="dashboard-runs-empty">
            No runs match this filter{hiddenByWindow > 0 ? ` — ${hiddenByWindow} sit outside the ${rangeWord(range)} window` : ''}.{' '}
            <button
              type="button"
              data-testid="dashboard-clear-filters"
              onClick={() => { setChip('all'); setQuery(''); }}
              style={CSS.emptyCtaBtn}
            >
              clear filters
            </button>
          </p>
        ) : (
          <DashboardGrid testId="dashboard-runs-grid" min={340}>
            {visibleRuns.map(({ view, signal }) => {
              const { session } = view;
              const style = STATUS_STYLE[session.status];
              const path = modePath(projectId, runModeOf(session.id), session.id);
              const failedish = session.status === 'failed' || session.status === 'cancelled';
              return (
                <div
                  key={session.id}
                  data-testid="dashboard-run"
                  data-run-id={session.id}
                  data-status={session.status}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(path)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(path); }}
                  className="transition-colors hover:bg-surface-raised"
                  style={CSS.card}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      aria-hidden
                      style={{
                        width: '6px', height: '6px', borderRadius: 'var(--radius-full)', flexShrink: 0,
                        background: signal !== null ? ATTENTION_DOT[signal.kind] : 'var(--ink-dim)',
                      }}
                    />
                    {/* Derived title (runTitle grammar) — the raw prompt is hover-only. */}
                    <a
                      {...link(path)}
                      data-testid="dashboard-run-title"
                      title={session.problem}
                      style={{
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', fontSize: 'var(--text-xs)',
                        fontFamily: 'var(--font-sans)', color: 'var(--ink-body)',
                        textDecoration: 'none',
                      }}
                    >
                      {humanTitle(session.problem)}
                    </a>
                    <span style={{ flexShrink: 0, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: style?.color ?? 'var(--ink-dim)' }}>
                      {style?.label ?? session.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <span style={CSS.cardMeta}>
                      {runShortId(session.id)} · #{session.attempt + 1} · {runWhenWord(attachedAt[session.id], now)}
                    </span>
                    <DeliveryChip view={view} />
                    <span style={{ flex: 1 }} />
                    {session.status === 'awaiting_human' && (
                      <button
                        type="button"
                        data-testid="dashboard-run-needs-you"
                        data-run-id={session.id}
                        title="Jump straight to this run's gate"
                        onClick={(e) => { e.stopPropagation(); navigate(gateOpenPath(projectId, session.id)); }}
                        style={{
                          flexShrink: 0, cursor: 'pointer',
                          background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
                          borderRadius: 'var(--radius-full)', padding: '2px 10px',
                          fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
                          fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
                        }}
                      >
                        needs you →
                      </button>
                    )}
                    {failedish && (
                      <button
                        type="button"
                        data-testid="dashboard-run-retry"
                        data-run-id={session.id}
                        title="Reopen the composer prefilled with this run's setup — nothing auto-launches"
                        onClick={(e) => { e.stopPropagation(); startRetry(view); }}
                        style={{
                          flexShrink: 0, cursor: 'pointer',
                          background: 'transparent', border: '1px solid var(--surface-raised)',
                          borderRadius: 'var(--radius-md)', padding: '2px 10px',
                          fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
                          color: 'var(--ink-muted)',
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </DashboardGrid>
        )}
      </section>

      {/* ── Documents as cards, from the one listDocs Document mode makes ── */}
      <section data-testid="dashboard-docs" data-count={visibleDocs.length}>
        <p style={CSS.sectionHead}>
          Documents ({visibleDocs.length})
        </p>
        {docs.length === 0 ? (
          <p style={CSS.empty}>
            No documents yet —{' '}
            <a {...link(modePath(projectId, 'document'))} data-testid="dashboard-empty-doc" style={CSS.emptyCta}>
              Document
            </a>{' '}
            drafts one.
          </p>
        ) : visibleDocs.length === 0 ? (
          <p style={CSS.empty}>No documents match this search.</p>
        ) : (
          <DashboardGrid testId="dashboard-docs-grid" min={280}>
            {visibleDocs.map((d) => {
              const path = modePath(projectId, d.kind === 'demo' ? 'video' : 'document', d.name);
              return (
                <div
                  key={d.name}
                  data-testid="dashboard-doc"
                  data-doc-id={d.name}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(path)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(path); }}
                  className="transition-colors hover:bg-surface-raised"
                  style={{ ...CSS.card, flexDirection: 'row', alignItems: 'center', gap: '8px' }}
                >
                  <span aria-hidden style={{ flexShrink: 0, color: 'var(--ink-dim)' }}>
                    {d.kind === 'demo' ? '▶' : '▤'}
                  </span>
                  <a
                    {...link(path)}
                    style={{
                      flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', fontSize: 'var(--text-xs)',
                      fontFamily: 'var(--font-mono)', color: 'var(--ink-body)',
                      textDecoration: 'none',
                    }}
                  >
                    {d.name}
                  </a>
                  <span style={{ ...CSS.cardMeta, flexShrink: 0 }}>v{d.head}</span>
                </div>
              );
            })}
          </DashboardGrid>
        )}
      </section>
    </div>
  );
}
