import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project, SessionView } from '../api/types.js';
import { useBoardModel, type BoardProject } from '../hooks/useBoardModel.js';
import { useGateStore } from '../store/gates.js';
import { useProjectsStore } from '../store/projects.js';
import { GatesWaitingTile, TileBand } from './DashboardTiles.js';
import { MetricTile } from './MetricTile.js';
import { ProjectSparkline } from './ProjectSparkline.js';
import { RunOutcomeBar } from './RunOutcomeBar.js';

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

// ── The attention-split tile (DES-FEEDBACK-003 §4.1 row 1, slice P) ───────────

const SPLIT_W = 168;
const SPLIT_H = 26;
const BAR_H = 10;

/**
 * "How much of my estate needs me?" — the board model's OWN bands, counted,
 * as a proportional bar (needs-you vs quiet). The bands are read, never
 * re-derived (C3): `/projects` reports the split; the wall itself stays on `/`
 * (§4.1's landing-vs-register line — this dashboard never re-implements bands).
 */
function AttentionSplitTile({ items }: { items: BoardProject[] }): React.ReactElement {
  const needsYou = items.filter((i) => i.band === 'needs-you').length;
  const quiet = items.length - needsYou;
  const total = items.length;
  return (
    <MetricTile
      testId="attention-split-tile"
      question="How much of my estate needs me?"
      title="Attention split"
      value={total === 0 ? 'no projects yet' : `${needsYou} need you · ${quiet} quiet · ${total} total`}
      data={{ 'data-needs-you': needsYou, 'data-quiet': quiet, 'data-total': total }}
    >
      {total === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          Nothing on the board yet.
        </p>
      ) : (
        <svg
          width="100%"
          height={SPLIT_H}
          viewBox={`0 0 ${SPLIT_W} ${SPLIT_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`attention split: ${needsYou} need you, ${quiet} quiet, of ${total}`}
          style={{ display: 'block' }}
        >
          {needsYou > 0 && (
            <rect
              x={0} y={(SPLIT_H - BAR_H) / 2}
              width={(needsYou / total) * SPLIT_W} height={BAR_H} rx={2}
              fill="var(--status-gate)"
            />
          )}
          {quiet > 0 && (
            <rect
              x={(needsYou / total) * SPLIT_W} y={(SPLIT_H - BAR_H) / 2}
              width={(quiet / total) * SPLIT_W} height={BAR_H} rx={2}
              fill="var(--ink-dim)"
            />
          )}
        </svg>
      )}
    </MetricTile>
  );
}

function ProjectCard({ project, onClick, sparkline }: {
  project: Project;
  onClick: () => void;
  sparkline?: React.ReactNode;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const isArchived = project.status === 'archived';
  const isDefault = project.id === 'default';

  return (
    <button
      type="button"
      data-testid="project-card"
      data-project-id={project.id}
      data-status={project.status}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: hovered ? 'var(--surface-raised)' : S.card,
        border: `1px solid ${S.border}`,
        borderRadius: '10px', padding: '16px', cursor: 'pointer',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <span style={{ color: isArchived ? S.faint : S.accent, marginTop: '1px', flexShrink: 0 }}>
          <IconFolder />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              fontSize: '14px', fontWeight: 600, color: isArchived ? S.muted : S.ink,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {project.name}
            </span>
            {isArchived && (
              <span style={{
                fontSize: '10px', fontFamily: 'monospace', color: S.faint,
                border: `1px solid ${S.faint}`, borderRadius: '4px', padding: '1px 5px',
                flexShrink: 0,
              }}>
                archived
              </span>
            )}
            {isDefault && (
              <span style={{
                fontSize: '10px', fontFamily: 'monospace', color: S.faint,
                border: `1px solid ${S.faint}`, borderRadius: '4px', padding: '1px 5px',
                flexShrink: 0,
              }}>
                default
              </span>
            )}
            {/* The 7-day activity sparkline (§4.1) — the list half of
                "combined list and reporting". Absent when the board holds no
                in-window runs for this project (absence stays absent). */}
            {sparkline != null && (
              <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex' }}>
                {sparkline}
              </span>
            )}
          </div>
          {project.description && (
            <p style={{
              fontSize: '12px', color: S.muted, margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {project.description}
            </p>
          )}
          {project.created_at > 0 && (
            <p style={{ fontSize: '11px', color: S.faint, margin: 0, marginTop: '6px', fontFamily: 'monospace' }}>
              Created {new Date(project.created_at).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

interface Props {
  runs: SessionView[];
  navigate: (path: string) => void;
}

export function ProjectsPage({ runs, navigate }: Props): React.ReactElement {
  // The COMPLETE register (DES-FEEDBACK-003 §4.1: "/projects is the REGISTER —
  // every project, complete") is held locally: the shared projects store is
  // also the board model's mirror target (active, non-default only), so a
  // store read here could lose the archived rows to a mirror write mid-race.
  // One GET, page-owned; creates land in both the register and the store.
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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

  // The reporting half (§4.1): the board's own model — bands read, never
  // re-derived (C3); its per-project attach clocks feed the row sparklines
  // and, merged, the 24h outcome bar (the honest clock, reused).
  const board = useBoardModel(runs);
  const byProjectId = useMemo(
    () => new Map(board.items.map((i) => [i.project.id, i])),
    [board.items],
  );
  const attachedAt = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const item of board.items) Object.assign(merged, item.attachedAt);
    return merged;
  }, [board.items]);
  const gates = useGateStore((s) => s.gates);
  const openGates = useMemo(() => Object.values(gates), [gates]);

  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  function handleCreated(p: Project): void {
    setProjects((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
    useProjectsStore.getState().addProject(p); // keep the shared corpus warm
    setShowCreate(false);
  }

  /** The row's 7-day sparkline off the board item — null when the board holds
   *  no entry (archived / default / still loading): absence stays absent. */
  function sparklineFor(p: Project): React.ReactNode {
    const item = byProjectId.get(p.id);
    if (item === undefined) return null;
    return <ProjectSparkline runs={item.runs} attachedAt={item.attachedAt} />;
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '760px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: S.ink, margin: 0, marginBottom: '4px' }}>Projects</h1>
          <p style={{ fontSize: '13px', color: S.muted, margin: 0 }}>
            Group runs, chats, and repos into named containers.
          </p>
        </div>
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

      {/* ── The reporting band (§4.1, EC28): three tiles ABOVE the register,
             every number derived from state the app already holds. ── */}
      <div style={{ marginBottom: '16px' }}>
        <TileBand testId="projects-dashboard-tiles">
          <AttentionSplitTile items={board.items} />
          <RunOutcomeBar runs={runs} attachedAt={attachedAt} title="Run outcomes (24h)" />
          <GatesWaitingTile
            gates={openGates}
            question="Am I the blocker anywhere?"
            title="Gates waiting"
            testId="gates-waiting-tile"
          />
        </TileBand>
      </div>

      {showCreate && (
        <CreateProjectForm
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

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

      {active.length > 0 && (
        <div data-testid="projects-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {active.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              sparkline={sparklineFor(p)}
              onClick={() => navigate(`/projects/${encodeURIComponent(p.id)}`)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginTop: '16px' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {archived.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  sparkline={sparklineFor(p)}
                  onClick={() => navigate(`/projects/${encodeURIComponent(p.id)}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
