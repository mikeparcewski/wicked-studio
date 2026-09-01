import { useCallback, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import { gateOpenPath } from '../board/gateActions.js';
import { outcomeOf } from '../board/metrics.js';
import {
  attachSeries, deltaWord, statusCounts, windowBuckets, windowDelta,
} from '../board/windowStats.js';
import { useDismissable } from '../hooks/useDismissable.js';
import { versionPath, type Mode } from '../hooks/useRoute.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useDocsCache } from '../store/docsCache.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { isChatRun } from './ChatsPage.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, StatTile, type FilterChip,
} from './dashboardKit.js';
import { MakePicker } from './LeftSidebar.js';
import { ago } from './ProjectCard.js';
import { humanTitle, runShortId, runWhenWord } from './runIdentity.js';
import { phaseWord, RUN_DOT } from './RunsSection.js';

/**
 * The Make dashboard — `/make` (lane B): the command surface over MADE THINGS —
 * build runs and their deliverables, documents, demos. A KPI band (items, runs
 * consumed w/ window delta + sparkline, active, failed w/ delta), then every
 * make item as a stat card behind a first-class FilterStrip. "Needs you" floats
 * first and jumps straight to the run's gate; failed items carry an inline
 * Retry (a prefill, never a hidden relaunch); the header carries the section's
 * creation verb (the same ＋ picker the rail forks: Build / Document / Video).
 *
 * Data discipline unchanged: ZERO requests on mount. Runs ride the app's one
 * `GET /runs`; attach clocks and project names read the membership mirror; doc
 * lists read the session docsCache — the honest corpus, which the EC24-grammar
 * label says out loud. The one fan-out (`[load docs for all projects]`) stays
 * an explicit gesture. Derived titles everywhere — never raw prompts.
 */

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
  /** Where a run row lands — the caller's routing (flat `/runs/:id` here). */
  runPath: (id: string) => string;
}

const RUN_TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/** Needs-you FIRST, then active, then terminal — incoming order within groups. */
function orderRuns(runs: SessionView[]): SessionView[] {
  const gated = runs.filter((v) => v.session.status === 'awaiting_human');
  const active = runs.filter((v) => v.session.status !== 'awaiting_human' && !RUN_TERMINAL.has(v.session.status));
  const terminal = runs.filter((v) => RUN_TERMINAL.has(v.session.status));
  return [...gated, ...active, ...terminal];
}

type StatusChip = 'all' | 'needs-you' | 'active' | 'failed' | 'done' | 'docs';

function matchesChip(status: string, chip: StatusChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'docs') return false; // runs never match the docs chip
  const o = outcomeOf(status);
  if (chip === 'needs-you') return o === 'gate';
  if (chip === 'active') return o === 'run';
  if (chip === 'failed') return o === 'fail';
  return o === 'done' || o === 'cancelled';
}

const CARD: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
  background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
  borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-4)',
  cursor: 'pointer',
};

const CARD_META: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

// ── The dashboard ─────────────────────────────────────────────────────────────

export function MakeDashboard({ runs, navigate, runPath }: Props): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const projectNameByRun = useMembershipStore((s) => s.projectNameByRun);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const byProject = useDocsCache((s) => s.byProject);
  const fanoutDone = useDocsCache((s) => s.fanoutDone);
  const fanoutProgress = useDocsCache((s) => s.fanoutProgress);
  const [whyOpen, setWhyOpen] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  // The overlay contract (usability review #10): the [why?] popover is a
  // transient surface — Escape closes it and refocuses its trigger.
  const whyRef = useRef<HTMLDivElement>(null);
  const whyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeWhy = useCallback(() => setWhyOpen(false), []);
  useDismissable(whyOpen, closeWhy, whyRef, whyTriggerRef);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<StatusChip>('all');
  const { range, setRange } = useTimeRange('30d');

  // The spine (§4.2.2): non-chat runs — complete, all projects, needs-you first.
  const made = useMemo(
    () => orderRuns(runs.filter((v) => !isChatRun(v) && v.session.archived_at == null)),
    [runs],
  );

  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  // The known corpus: doc rows off the session cache, newest first.
  const docRows = useMemo(
    () => Object.entries(byProject)
      // The default bucket never rides the board's store mirror (F5), so its
      // docs label "Unfiled" — the run rows' exact grammar.
      .flatMap(([pid, docs]) => docs.map((doc) => ({
        doc, projectId: pid,
        projectName: projectNameById[pid] ?? (pid === UNFILED_MOUNT ? 'Unfiled' : pid),
      })))
      .sort((a, b) => (b.doc.updated_at ?? '').localeCompare(a.doc.updated_at ?? '')),
    [byProject, projectNameById],
  );

  // ── The window + KPI folds ─────────────────────────────────────────────────
  const now = Date.now();
  const buckets = useMemo(() => windowBuckets(made, range), [made, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);
  const liveCounts = useMemo(() => statusCounts(made), [made]);
  const runsDelta = useMemo(() => windowDelta(buckets, (rs) => rs.length), [buckets]);
  const failedDelta = useMemo(
    () => windowDelta(buckets, (rs) => rs.filter((v) => outcomeOf(v.session.status) === 'fail').length),
    [buckets],
  );
  const runSpark = useMemo(
    () => attachSeries(buckets.current.map((v) => v.session.id), attachedAt, 14, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` re-derives with the data, not a timer
    [buckets, attachedAt],
  );

  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); e.stopPropagation(); navigate(path); },
  });

  // The explicit fan-out (§4.2.2): every real project, one known-shape GET each.
  const fanout = (): void => {
    void useDocsCache.getState().loadAll(projects.filter((p) => p.id !== 'default').map((p) => p.id));
  };

  /** Retry-as-prefill — the ChatPanel contract, verbatim: nothing auto-launches. */
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
      projectId: typeof s.project_id === 'string' ? s.project_id : null,
    });
    navigate('/runs/new');
  }

  /** The gate jump: the run's thread AT the gate when its project is known;
   *  the flat run detail (where the approval dock lives) when unfiled. */
  const gateJump = (id: string): string => {
    const pid = projectIdByRun[id];
    return pid !== undefined ? gateOpenPath(pid, id) : `/runs/${encodeURIComponent(id)}`;
  };

  // ── Filtering (search lifts the window — the Work page idiom) ──────────────
  const q = query.trim().toLowerCase();
  const searchedRuns = q === ''
    ? made.filter((v) => windowIds.has(v.session.id))
    : made.filter((v) =>
        v.session.problem.toLowerCase().includes(q)
        || runShortId(v.session.id).includes(q)
        || (projectNameByRun[v.session.id] ?? 'unfiled').toLowerCase().includes(q));
  const visibleRuns = chip === 'docs' ? [] : searchedRuns.filter((v) => matchesChip(v.session.status, chip));
  const visibleDocs = (chip === 'all' || chip === 'docs')
    ? docRows.filter(({ doc, projectName }) =>
        q === '' || doc.name.toLowerCase().includes(q) || projectName.toLowerCase().includes(q))
    : [];
  const hiddenByWindow = q === '' ? made.length - buckets.current.length : 0;

  const chipCounts = useMemo(() => {
    const counts: Record<StatusChip, number> = { all: 0, 'needs-you': 0, active: 0, failed: 0, done: 0, docs: docRows.length };
    for (const v of searchedRuns) {
      counts.all += 1;
      for (const c of ['needs-you', 'active', 'failed', 'done'] as const) {
        if (matchesChip(v.session.status, c)) counts[c] += 1;
      }
    }
    counts.all += docRows.length;
    return counts;
  }, [searchedRuns, docRows.length]);

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'active', label: 'Active', count: chipCounts.active },
    { id: 'failed', label: 'Failed', count: chipCounts.failed },
    { id: 'done', label: 'Done', count: chipCounts.done },
    { id: 'docs', label: 'Docs', count: chipCounts.docs },
  ];

  return (
    <div className="flex flex-col" style={{ color: 'var(--ink-high)', padding: '0 var(--space-8) var(--space-8)', gap: 'var(--space-4)' }}>
      {/* ── Header: the section name + its creation verb ── */}
      <div className="pt-8 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-4 min-w-0">
          <h1 className="text-2xl font-semibold font-mono" style={{ margin: 0 }}>Make</h1>
          <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
            build runs · documents · demos
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="make-new"
            aria-expanded={makeOpen}
            onClick={() => setMakeOpen((v) => !v)}
            style={{
              background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '6px 14px',
              fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', cursor: 'pointer',
            }}
          >
            ＋ Make
          </button>
          {makeOpen && (
            <MakePicker
              navigate={(p) => { setMakeOpen(false); navigate(p); }}
              onClose={() => setMakeOpen(false)}
              ambient={null}
            />
          )}
        </div>
      </div>

      {/* ── The KPI band — items · runs consumed · active · failed ── */}
      <KpiBand testId="make-kpis">
        <KpiGroup label="Performance" grow={2}>
          <StatTile
            testId="stat-items"
            label="Make items"
            value={buckets.current.length + docRows.length}
            context={`${rangeWord(range)} runs · loaded docs`}
            title="Everything listed below — click to clear filters"
            onOpen={() => { setChip('all'); setQuery(''); }}
          />
          <StatTile
            testId="stat-runs"
            label="Runs consumed"
            value={buckets.current.length}
            delta={runsDelta}
            context={deltaWord(range, runsDelta)}
            spark={runSpark}
            title="Build runs in the window — click to clear filters"
            onOpen={() => { setChip('all'); setQuery(''); }}
          />
        </KpiGroup>
        <KpiGroup label="Pipeline" grow={1}>
          <StatTile
            testId="stat-active"
            label="Active now"
            value={liveCounts.active + liveCounts.gates}
            valueColor={liveCounts.gates > 0 ? 'var(--status-gate)' : undefined}
            context={liveCounts.gates > 0 ? `${liveCounts.gates} waiting on you` : 'right now'}
            title="Builds in flight — filter the grid to them"
            onOpen={() => setChip(liveCounts.gates > 0 ? 'needs-you' : 'active')}
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
            title="Failed builds in the window — filter the grid to them"
            onOpen={() => setChip('failed')}
          />
        </KpiGroup>
      </KpiBand>

      {/* ── Filters — first-class at the top of the list ── */}
      <FilterStrip
        testId="make-filter"
        query={query}
        onQuery={setQuery}
        placeholder="Search made things…"
        chips={chips}
        active={chip}
        onChip={(id) => setChip(id as StatusChip)}
        range={range}
        onRange={setRange}
      >
        {hiddenByWindow > 0 && (
          <button
            type="button"
            data-testid="make-hidden-chip"
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

      {/* ── The corpus label (EC24 grammar) heads the list ── */}
      <div ref={whyRef} className="relative flex items-center gap-3 flex-wrap">
        <p
          data-testid="make-corpus-label"
          style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Listing: build runs (all projects) · documents (projects opened this session)
          {' — '}
          <button
            ref={whyTriggerRef}
            type="button"
            data-testid="make-corpus-why"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((v) => !v)}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--ink-muted)' }}
          >
            [why?]
          </button>
        </p>
        {whyOpen && (
          <p
            data-testid="make-corpus-why-popover"
            className="absolute left-0 top-6 z-20 max-w-md"
            style={{
              margin: 0, padding: 'var(--space-2) var(--space-3)',
              background: 'var(--surface-overlay)', border: '1px solid var(--surface-raised)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-overlay)',
              fontSize: 'var(--text-2xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)',
            }}
          >
            Documents load per project. Open a project — or use &lsquo;load docs for all
            projects&rsquo; — to list them here.
          </p>
        )}
        {fanoutProgress !== null ? (
          <p
            data-testid="make-fanout-progress"
            style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}
          >
            loading docs… {fanoutProgress.done}/{fanoutProgress.total}
          </p>
        ) : fanoutDone ? (
          <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
            docs loaded for all projects
          </p>
        ) : (
          <button
            type="button"
            data-testid="make-load-all-docs"
            onClick={fanout}
            className="rounded px-2 py-0.5 transition-opacity hover:opacity-80"
            style={{
              background: 'transparent', border: '1px solid var(--surface-raised)',
              fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
            }}
          >
            load docs for all projects
          </button>
        )}
      </div>

      {/* ── The grid: run cards (needs-you first), then the known doc corpus ── */}
      <div data-testid="make-list" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {made.length === 0 && visibleDocs.length === 0 && (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)', fontStyle: 'italic' }}>
            Nothing made yet — Make's ＋ forks Build / Document / Video.
          </p>
        )}
        {made.length > 0 && visibleRuns.length === 0 && chip !== 'docs' && (
          <p data-testid="make-runs-empty" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', fontStyle: 'italic' }}>
            No runs match this filter{hiddenByWindow > 0 ? ` — ${hiddenByWindow} sit outside the ${rangeWord(range)} window` : ''}.{' '}
            <button
              type="button"
              data-testid="make-clear-filters"
              onClick={() => { setChip('all'); setQuery(''); }}
              style={{
                background: 'none', border: 'none', padding: 0, font: 'inherit',
                color: 'var(--ink-muted)', textDecoration: 'underline', cursor: 'pointer',
              }}
            >
              clear filters
            </button>
          </p>
        )}
        {visibleRuns.length > 0 && (
          <DashboardGrid testId="make-runs-grid" min={340}>
            {visibleRuns.map((view) => {
              const { session } = view;
              const id = session.id;
              const path = runPath(id);
              const failedish = session.status === 'failed' || session.status === 'cancelled';
              return (
                <div
                  key={id}
                  data-testid="make-run-row"
                  data-run-id={id}
                  data-status={session.status}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(path)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(path); }}
                  className="transition-colors hover:bg-surface-raised"
                  style={CARD}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      aria-hidden
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: RUN_DOT[session.status] ?? 'var(--ink-dim)' }}
                    />
                    {/* The ONE human-title derivation (review #2) — the raw prompt
                        lives on this card's hover title, never the row. */}
                    <a
                      {...link(path)}
                      data-testid="make-run-title"
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
                    <span className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
                      {phaseWord(view)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <span style={CARD_META}>
                      {runShortId(id)} · #{session.attempt + 1} · {runWhenWord(attachedAt[id], now)}
                    </span>
                    <span style={{ ...CARD_META, color: 'var(--ink-muted)' }}>
                      {projectNameByRun[id] ?? 'Unfiled'}
                    </span>
                    <span style={{ flex: 1 }} />
                    {session.status === 'awaiting_human' && (
                      <button
                        type="button"
                        data-testid="make-needs-you"
                        data-run-id={id}
                        title="Jump straight to this run's gate"
                        onClick={(e) => { e.stopPropagation(); navigate(gateJump(id)); }}
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
                        data-testid="make-retry"
                        data-run-id={id}
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

        {visibleDocs.length > 0 && (
          <>
            <p
              style={{
                margin: 0, fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semi)', textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)',
              }}
            >
              documents · demos
            </p>
            <DashboardGrid testId="make-docs-grid" min={300}>
              {visibleDocs.map(({ doc, projectId, projectName }) => {
                const mode: Mode = doc.kind === 'demo' ? 'video' : 'document';
                const path = versionPath(projectId, doc.name, null, mode);
                const updated = doc.updated_at === null ? NaN : Date.parse(doc.updated_at);
                return (
                  <div
                    key={`${projectId}:${doc.name}`}
                    data-testid="make-doc-row"
                    data-doc-kind={doc.kind}
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(path)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(path); }}
                    className="transition-colors hover:bg-surface-raised"
                    style={CARD}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <span aria-hidden className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}>
                        {doc.kind === 'demo' ? '▶' : '▤'}
                      </span>
                      <a
                        {...link(path)}
                        title={`${doc.name} · ${projectName}`}
                        style={{
                          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', fontSize: 'var(--text-xs)',
                          fontFamily: 'var(--font-sans)', color: 'var(--ink-body)',
                          textDecoration: 'none',
                        }}
                      >
                        {doc.name}
                      </a>
                      <span className="shrink-0" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
                        v{doc.head}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={CARD_META}>
                        {doc.versions} version{doc.versions === 1 ? '' : 's'}
                        {Number.isFinite(updated) ? ` · updated ${ago(updated, now)} ago` : ''}
                      </span>
                      <span style={{ ...CARD_META, color: 'var(--ink-muted)', marginLeft: 'auto' }}>
                        {projectName}
                      </span>
                    </div>
                  </div>
                );
              })}
            </DashboardGrid>
          </>
        )}
      </div>
    </div>
  );
}
