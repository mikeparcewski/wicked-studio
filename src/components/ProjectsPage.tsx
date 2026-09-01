import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, SessionView } from '../api/types.js';
import { gateOpenPath } from '../board/gateActions.js';
import { outcomeOf } from '../board/metrics.js';
import {
  attachSeries, deltaWord, healthColor, healthOf, statusCounts, windowBuckets, windowDelta,
  type StatusCounts,
} from '../board/windowStats.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { projectPath } from '../hooks/useRoute.js';
import { rangeWord, useTimeRange } from '../hooks/useTimeRange.js';
import { useGateStore } from '../store/gates.js';
import { useProjectsStore } from '../store/projects.js';
import { ago, ATTENTION_DOT } from './ProjectCard.js';
import { ageWord } from './DashboardTiles.js';
import {
  DashboardGrid, FilterStrip, KpiBand, KpiGroup, Sparkline, StatTile, type FilterChip,
} from './dashboardKit.js';

/**
 * The /projects landing as a COMMAND SURFACE (lane B): a full-width reporting
 * dashboard over the estate — a KPI band organized around the command-center
 * questions (performance / pipeline / risk), then a filterable grid of project
 * cards, each a mini-dashboard row. Cards are doors; "needs you" floats first
 * and jumps STRAIGHT to the waiting run's gate; the creation verbs (New
 * project, Do Work) live in the header — one click from wherever the need
 * appears.
 *
 * Every number derives from state the app already holds (`GET /runs` + the
 * board model's one members read); the recency window is the Work page's
 * honest positional idiom ("last 30 runs", never a fabricated "30d"), and a
 * window with no prior bucket shows "—", never 0%.
 */

const S = {
  bg:     'var(--surface-base)',
  card:   'var(--surface-card)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
  faint:  'var(--ink-dim)',
  accent: 'var(--accent)',
  hover:  'var(--surface-raised)',
  green:  'var(--status-run)',
  red:    'var(--status-fail)',
};

function IconFolder(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function IconArchive(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20 3H4c-1.1 0-2 .9-2 2v2c0 .75.41 1.39 1 1.73V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8.73c.59-.34 1-.99 1-1.73V5c0-1.1-.9-2-2-2zm-5 12H9v-2h6v2zm5-7H4V5h16v3z" />
    </svg>
  );
}

function IconPlus(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 11h-6V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2z" />
    </svg>
  );
}

function CreateProjectForm({ onCreated, onCancel }: { onCreated: (p: Project) => void; onCancel: () => void }): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const body = description.trim()
        ? { name: trimmed, description: description.trim() }
        : { name: trimmed };
      const { project } = await api.createProject(body);
      onCreated(project);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        background: S.card,
        border: `1px solid ${S.border}`,
        borderRadius: '10px',
        padding: '20px',
        marginBottom: '16px',
        maxWidth: '560px',
      }}
    >
      <p style={{ fontSize: '13px', fontWeight: 600, color: S.ink, marginBottom: '14px' }}>New project</p>
      <input
        ref={inputRef}
        type="text"
        placeholder="Project name"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onCancel(); }}
        style={{
          width: '100%', background: 'var(--surface-raised)', border: `1px solid ${S.border}`,
          borderRadius: '6px', padding: '8px 10px', fontSize: '13px', color: S.ink,
          outline: 'none', marginBottom: '8px', boxSizing: 'border-box',
        }}
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        style={{
          width: '100%', background: 'var(--surface-raised)', border: `1px solid ${S.border}`,
          borderRadius: '6px', padding: '8px 10px', fontSize: '13px', color: S.ink,
          outline: 'none', resize: 'vertical', marginBottom: '12px', boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      />
      {err && <p style={{ fontSize: '12px', color: S.red, marginBottom: '10px' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          style={{
            background: S.accent, color: 'var(--accent-fg)', border: 'none', borderRadius: '6px',
            padding: '7px 16px', fontSize: '12px', fontWeight: 700, cursor: busy ? 'default' : 'pointer',
            opacity: busy || !name.trim() ? 0.5 : 1,
          }}
        >
          {busy ? 'Creating…' : 'Create project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', color: S.muted, border: `1px solid ${S.border}`,
            borderRadius: '6px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── The project card model — one fold per card, shared by grid and chips ──────

interface CardModel {
  project: Project;
  item: BoardProject | null;
  /** The project's runs inside the current recency window (unarchived). */
  windowed: SessionView[];
  counts: StatusCounts;
  /** Runs waiting on a human RIGHT NOW — unwindowed (a gate is a gate). */
  waiting: SessionView[];
  failing: boolean;
  activeNow: boolean;
  lastAt: number;
  repoCount: number;
  /** Board score-order index; register-only projects sort after the board. */
  boardIx: number;
}

type StatusChip = 'all' | 'needs-you' | 'active' | 'failing' | 'quiet';

function matchesChip(m: CardModel, chip: StatusChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'needs-you') return m.waiting.length > 0;
  if (chip === 'active') return m.activeNow;
  if (chip === 'failing') return m.failing;
  return m.waiting.length === 0 && !m.activeNow && !m.failing; // quiet
}

const CARD_STAT: React.CSSProperties = {
  fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
  whiteSpace: 'nowrap',
};

/** One project as a mini-dashboard row — the card IS a door to `/p/:id`. */
function ProjectStatCard({ m, range, navigate, now }: {
  m: CardModel;
  range: ReturnType<typeof useTimeRange>['range'];
  navigate: (path: string) => void;
  now: number;
}): React.ReactElement {
  const { project, counts, waiting } = m;
  const health = healthOf(counts.done, counts.terminal);
  const spark = m.item === null ? [] : attachSeries(Object.keys(m.item.attachedAt), m.item.attachedAt, 14, now);
  const firstGate = waiting[0]?.session.id;
  const dot = m.item !== null ? ATTENTION_DOT[m.item.attention] : 'var(--ink-dim)';

  return (
    <div
      data-testid="project-card"
      data-project-id={project.id}
      data-status={project.status}
      data-gates={waiting.length}
      data-runs={counts.total}
      role="link"
      tabIndex={0}
      onClick={() => navigate(projectPath(project.id))}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(projectPath(project.id)); }}
      className="transition-colors hover:bg-surface-raised"
      style={{
        display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
        background: S.card, border: `1px solid ${S.border}`,
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span aria-hidden style={{ width: '7px', height: '7px', borderRadius: 'var(--radius-full)', background: dot, flexShrink: 0 }} />
        <span style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)', color: S.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>
          {project.name}
        </span>
        {project.id === 'default' && (
          <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: S.faint, border: `1px solid ${S.faint}`, borderRadius: '4px', padding: '0 5px', flexShrink: 0 }}>
            default
          </span>
        )}
        {/* Attention routing beats navigation: the gate jump, STRAIGHT to the
            waiting run's approval dock — never a hunt. */}
        {waiting.length > 0 && firstGate !== undefined && (
          <button
            type="button"
            data-testid="project-needs-you"
            data-run-id={firstGate}
            title="A run is waiting on you — jump to its gate"
            onClick={(e) => { e.stopPropagation(); navigate(gateOpenPath(project.id, firstGate)); }}
            style={{
              marginLeft: 'auto', flexShrink: 0, cursor: 'pointer',
              background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
              borderRadius: 'var(--radius-full)', padding: '2px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
            }}
          >
            needs you · {waiting.length} →
          </button>
        )}
      </div>
      {project.description && (
        <p style={{
          fontSize: 'var(--text-xs)', color: S.muted, margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.description}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={CARD_STAT} data-testid="card-runs">
          {counts.total} run{counts.total === 1 ? '' : 's'} · {rangeWord(range)}
        </span>
        {counts.terminal > 0 && (
          <span
            style={{ ...CARD_STAT, color: healthColor(health) ?? CARD_STAT.color }}
            data-testid="card-split"
            data-health={health}
            title={`${counts.done} succeeded, ${counts.failed} failed of ${counts.terminal} finished in this window`}
          >
            ✓{counts.done} · ✕{counts.failed}
          </span>
        )}
        <span style={CARD_STAT}>
          {m.repoCount} repo{m.repoCount === 1 ? '' : 's'}
        </span>
        <span style={{ ...CARD_STAT, marginLeft: 'auto' }} title="last activity (attach clocks + gates)">
          {ago(m.lastAt, now)} ago
        </span>
      </div>
      <Sparkline counts={spark} height={18} />
    </div>
  );
}

/** Unfiled runs get a card too — honest, not hidden. */
function UnfiledCard({ windowed, all, range, navigate, now, gateAt }: {
  /** Unfiled runs inside the recency window — the counted set. */
  windowed: SessionView[];
  /** Every live unfiled run — a gate is a gate, windowed or not. */
  all: SessionView[];
  range: ReturnType<typeof useTimeRange>['range'];
  navigate: (path: string) => void;
  now: number;
  gateAt: (id: string) => number | undefined;
}): React.ReactElement {
  const counts = statusCounts(windowed);
  const waiting = all.filter((v) => v.session.status === 'awaiting_human');
  const health = healthOf(counts.done, counts.terminal);
  const firstGate = waiting[0]?.session.id;
  const lastGate = waiting.reduce<number>((acc, v) => Math.max(acc, gateAt(v.session.id) ?? 0), 0);

  return (
    <div
      data-testid="unfiled-card"
      data-gates={waiting.length}
      data-runs={counts.total}
      role="link"
      tabIndex={0}
      onClick={() => navigate('/work')}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate('/work'); }}
      className="transition-colors hover:bg-surface-raised"
      style={{
        display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
        background: S.card, border: `1px dashed ${S.border}`,
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span aria-hidden style={{ width: '7px', height: '7px', borderRadius: 'var(--radius-full)', background: 'var(--ink-dim)', flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)', color: S.muted }}>
          Unfiled runs
        </span>
        {waiting.length > 0 && firstGate !== undefined && (
          <button
            type="button"
            data-testid="unfiled-needs-you"
            data-run-id={firstGate}
            title="An unfiled run is waiting on you — open it"
            onClick={(e) => { e.stopPropagation(); navigate(`/runs/${encodeURIComponent(firstGate)}`); }}
            style={{
              marginLeft: 'auto', flexShrink: 0, cursor: 'pointer',
              background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)',
              borderRadius: 'var(--radius-full)', padding: '2px 10px',
              fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              fontWeight: 'var(--weight-bold)', color: 'var(--status-gate)',
            }}
          >
            needs you · {waiting.length} →
          </button>
        )}
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: S.faint, margin: 0 }}>
        Runs filed into no project — they live on the Work list.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={CARD_STAT}>{counts.total} run{counts.total === 1 ? '' : 's'} · {rangeWord(range)}</span>
        {counts.terminal > 0 && (
          <span style={{ ...CARD_STAT, color: healthColor(health) ?? CARD_STAT.color }} data-health={health}>
            ✓{counts.done} · ✕{counts.failed}
          </span>
        )}
        {lastGate > 0 && (
          <span style={{ ...CARD_STAT, marginLeft: 'auto' }}>oldest gate {ageWord(now - lastGate)}</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
}

export function ProjectsPage({ runs, navigate }: Props): React.ReactElement {
  // The COMPLETE register (every project, archived included) stays page-owned:
  // the shared projects store is the board mirror's target (active, non-default
  // only), so a store read could lose archived rows to a mirror write mid-race.
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<StatusChip>('all');
  const { range, setRange } = useTimeRange('30d');

  useEffect(() => {
    let cancelled = false;
    api.listProjects()
      .then(({ projects: all }) => { if (!cancelled) { setProjects(all); setLoading(false); } })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const board = useBoardModel(runs);
  const gates = useGateStore((s) => s.gates);
  const now = Date.now();

  const byProjectId = useMemo(
    () => new Map(board.items.map((i, ix) => [i.project.id, { item: i, ix }])),
    [board.items],
  );
  const attachedAt = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const item of board.items) Object.assign(merged, item.attachedAt);
    return merged;
  }, [board.items]);

  // ── The window (Work page idiom: positional, honestly labeled) ─────────────
  const live = useMemo(() => runs.filter((v) => v.session.archived_at == null), [runs]);
  const buckets = useMemo(() => windowBuckets(live, range), [live, range]);
  const windowIds = useMemo(() => new Set(buckets.current.map((v) => v.session.id)), [buckets]);

  // ── KPI folds ───────────────────────────────────────────────────────────────
  const liveCounts = useMemo(() => statusCounts(live), [live]);
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
  const openGates = useMemo(() => Object.values(gates), [gates]);
  const oldestGate = openGates.reduce<number | null>(
    (acc, g) => (acc === null || g.receivedAt < acc ? g.receivedAt : acc), null);
  const unfiled = useMemo(
    () => board.unfiled.filter((v) => v.session.archived_at == null && windowIds.has(v.session.id)),
    [board.unfiled, windowIds],
  );
  const unfiledAll = useMemo(
    () => board.unfiled.filter((v) => v.session.archived_at == null),
    [board.unfiled],
  );

  // ── The card models ─────────────────────────────────────────────────────────
  const active = projects.filter((p) => p.status === 'active' && p.id !== 'default');
  const archived = projects.filter((p) => p.status === 'archived');

  const cards = useMemo<CardModel[]>(() => {
    return active.map((p) => {
      const hit = byProjectId.get(p.id);
      const item = hit?.item ?? null;
      const mine = item === null ? [] : item.runs.filter((v) => v.session.archived_at == null);
      const windowed = mine.filter((v) => windowIds.has(v.session.id));
      const waiting = mine.filter((v) => v.session.status === 'awaiting_human');
      const lastAt = Math.max(
        p.updated_at,
        ...Object.values(item?.attachedAt ?? {}),
        ...waiting.map((v) => gates[v.session.id]?.receivedAt ?? 0),
      );
      return {
        project: p,
        item,
        windowed,
        counts: statusCounts(windowed),
        waiting,
        failing: mine.some((v) => v.session.status === 'failed'),
        activeNow: mine.some((v) => outcomeOf(v.session.status) === 'run'),
        lastAt,
        repoCount: item?.repoCount ?? 0,
        boardIx: hit?.ix ?? Number.MAX_SAFE_INTEGER,
      };
    }).sort((a, b) =>
      // Attention routing: needs-you floats FIRST, then failing, then board score order.
      (b.waiting.length > 0 ? 1 : 0) - (a.waiting.length > 0 ? 1 : 0)
      || (b.failing ? 1 : 0) - (a.failing ? 1 : 0)
      || a.boardIx - b.boardIx
      || b.project.updated_at - a.project.updated_at,
    );
  }, [active, byProjectId, windowIds, gates]);

  const chipCounts: Record<StatusChip, number> = useMemo(() => ({
    all: cards.length,
    'needs-you': cards.filter((m) => matchesChip(m, 'needs-you')).length,
    active: cards.filter((m) => matchesChip(m, 'active')).length,
    failing: cards.filter((m) => matchesChip(m, 'failing')).length,
    quiet: cards.filter((m) => matchesChip(m, 'quiet')).length,
  }), [cards]);

  const q = query.trim().toLowerCase();
  const visible = cards.filter((m) =>
    matchesChip(m, chip)
    && (q === ''
      || m.project.name.toLowerCase().includes(q)
      || (m.project.description ?? '').toLowerCase().includes(q)));
  // The unfiled card obeys the same filters (it is a real row, not furniture).
  const unfiledWaiting = unfiledAll.some((v) => v.session.status === 'awaiting_human');
  const unfiledFailing = unfiledAll.some((v) => v.session.status === 'failed');
  const unfiledActive = unfiledAll.some((v) => outcomeOf(v.session.status) === 'run');
  const showUnfiled = unfiledAll.length > 0
    && (q === '' || 'unfiled runs'.includes(q))
    && (chip === 'all'
      || (chip === 'needs-you' && unfiledWaiting)
      || (chip === 'failing' && unfiledFailing)
      || (chip === 'active' && unfiledActive)
      || (chip === 'quiet' && !unfiledWaiting && !unfiledFailing && !unfiledActive));

  function handleCreated(p: Project): void {
    setProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    useProjectsStore.getState().addProject(p); // keep the shared corpus warm
    setShowCreate(false);
  }

  const chips: FilterChip[] = [
    { id: 'all', label: 'All', count: chipCounts.all },
    { id: 'needs-you', label: 'Needs you', count: chipCounts['needs-you'] },
    { id: 'active', label: 'Active', count: chipCounts.active },
    { id: 'failing', label: 'Failing', count: chipCounts.failing },
    { id: 'quiet', label: 'Quiet', count: chipCounts.quiet },
  ];

  return (
    // FULL WIDTH — the register flows with the viewport; no max-width constraint.
    <div data-testid="projects-page" style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* ── Header: name + the creation verbs (one click from here) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: S.ink, margin: 0, marginBottom: '4px' }}>Projects</h1>
          <p style={{ fontSize: '13px', color: S.muted, margin: 0 }}>
            Group runs, chats, and repos into named containers.
          </p>
        </div>
        <button
          type="button"
          data-testid="projects-do-work"
          onClick={() => navigate('/runs/new')}
          style={{
            background: 'transparent', color: S.muted, border: `1px solid ${S.border}`,
            borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Do Work
        </button>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: S.accent, color: 'var(--accent-fg)', border: 'none', borderRadius: '7px',
            padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <IconPlus /> New project
        </button>
      </div>

      {/* ── The KPI band — the command-center model: three questions ── */}
      <KpiBand testId="projects-kpis">
        <KpiGroup label="Performance" grow={2}>
          <StatTile
            testId="stat-projects"
            label="Projects"
            value={active.length}
            context={archived.length > 0 ? `${archived.length} archived` : 'active register'}
            title="Every active project — click to clear filters"
            onOpen={() => { setChip('all'); setQuery(''); }}
          />
          <StatTile
            testId="stat-runs"
            label="Runs"
            value={buckets.current.length}
            delta={runsDelta}
            context={deltaWord(range, runsDelta)}
            spark={runSpark}
            title="Runs in the window — open the Work list"
            href="/work"
            onOpen={() => navigate('/work')}
          />
        </KpiGroup>
        <KpiGroup label="Pipeline" grow={2}>
          <StatTile
            testId="stat-active"
            label="Active now"
            value={liveCounts.active}
            context="right now"
            title="Runs moving under their own power — open the Work list"
            href="/work?filter=active"
            onOpen={() => navigate('/work?filter=active')}
          />
          <StatTile
            testId="stat-gates"
            label="Needs you"
            value={liveCounts.gates}
            valueColor={liveCounts.gates > 0 ? 'var(--status-gate)' : undefined}
            context={oldestGate !== null ? `oldest waiting ${ageWord(now - oldestGate)}` : 'nothing waiting'}
            title="Runs waiting on a human — filter the grid to them"
            onOpen={() => setChip('needs-you')}
          />
        </KpiGroup>
        <KpiGroup label="Risk" grow={2}>
          <StatTile
            testId="stat-failed"
            label="Failed"
            value={failedDelta.current}
            valueColor={failedDelta.current > 0 ? 'var(--status-fail)' : undefined}
            delta={failedDelta}
            deltaSense="bad-up"
            context={deltaWord(range, failedDelta)}
            title="Failed runs in the window — open them on the Work list"
            href="/work?filter=failed"
            onOpen={() => navigate('/work?filter=failed')}
          />
          <StatTile
            testId="stat-unfiled"
            label="Unfiled"
            value={unfiledAll.length}
            context="runs in no project"
            title="Runs not filed anywhere — they live on the Work list"
            href="/work"
            onOpen={() => navigate('/work')}
          />
        </KpiGroup>
      </KpiBand>

      {showCreate && (
        <CreateProjectForm
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* ── Filters — first-class, never hidden ── */}
      <FilterStrip
        testId="projects-filter"
        query={query}
        onQuery={setQuery}
        placeholder="Search projects…"
        chips={chips}
        active={chip}
        onChip={(id) => setChip(id as StatusChip)}
        range={range}
        onRange={setRange}
      />

      {loading && (
        <p style={{ fontSize: '13px', color: S.faint, fontFamily: 'monospace' }}>Loading…</p>
      )}

      {!loading && error && (
        <p style={{ fontSize: '13px', color: S.red }}>{error}</p>
      )}

      {!loading && !error && active.length === 0 && !showCreate && (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          background: S.card, border: `1px solid ${S.border}`, borderRadius: '12px',
        }}>
          <span style={{ color: S.faint, display: 'block', marginBottom: '10px' }}>
            <IconFolder />
          </span>
          <p style={{ fontSize: '14px', color: S.muted, margin: 0, marginBottom: '4px' }}>No projects yet</p>
          <p style={{ fontSize: '12px', color: S.faint, margin: 0 }}>
            Create a project to group your runs, chats, and repos.
          </p>
        </div>
      )}

      {!loading && !error && active.length > 0 && visible.length === 0 && !showUnfiled && (
        <p data-testid="projects-empty-filter" style={{ fontSize: '13px', color: S.faint, margin: 0 }}>
          No projects match —{' '}
          <button
            type="button"
            onClick={() => { setChip('all'); setQuery(''); }}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: S.muted, textDecoration: 'underline', cursor: 'pointer' }}
          >
            clear filters
          </button>
        </p>
      )}

      {(visible.length > 0 || showUnfiled) && (
        <DashboardGrid testId="projects-list" min={340}>
          {visible.map((m) => (
            <ProjectStatCard key={m.project.id} m={m} range={range} navigate={navigate} now={now} />
          ))}
          {showUnfiled && (
            <UnfiledCard
              windowed={unfiled}
              all={unfiledAll}
              range={range}
              navigate={navigate}
              now={now}
              gateAt={(id) => gates[id]?.receivedAt}
            />
          )}
        </DashboardGrid>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '12px', color: S.faint, padding: '4px 0', marginBottom: '8px',
            }}
          >
            <IconArchive />
            {showArchived ? 'Hide' : 'Show'} {archived.length} archived project{archived.length !== 1 ? 's' : ''}
          </button>
          {showArchived && (
            <DashboardGrid testId="projects-archived" min={340}>
              {archived.map((p) => (
                <div
                  key={p.id}
                  data-testid="project-card"
                  data-project-id={p.id}
                  data-status={p.status}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(projectPath(p.id))}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(projectPath(p.id)); }}
                  className="transition-colors hover:bg-surface-raised"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0,
                    background: S.card, border: `1px solid ${S.border}`,
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-4)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: S.faint, flexShrink: 0 }}><IconFolder /></span>
                  <span style={{ fontSize: 'var(--text-sm)', color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)', color: S.faint, border: `1px solid ${S.faint}`, borderRadius: '4px', padding: '0 5px', flexShrink: 0 }}>
                    archived
                  </span>
                </div>
              ))}
            </DashboardGrid>
          )}
        </div>
      )}
    </div>
  );
}
