import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { Project } from '../api/types.js';
import { useProjectsStore } from '../store/projects.js';

const S = {
  bg:     '#0d1117',
  card:   '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  faint:  'rgba(230,237,243,0.3)',
  accent: '#ffda19',
  hover:  'rgba(230,237,243,0.05)',
  green:  '#3fb950',
  red:    '#f85149',
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
          width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${S.border}`,
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
          width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${S.border}`,
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
            background: S.accent, color: '#0d1117', border: 'none', borderRadius: '6px',
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

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const isArchived = project.status === 'archived';
  const isDefault = project.id === 'default';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: hovered ? 'rgba(230,237,243,0.04)' : S.card,
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
  navigate: (path: string) => void;
}

export function ProjectsPage({ navigate }: Props): React.ReactElement {
  const { projects, loading, error, load, addProject } = useProjectsStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => { void load(); }, [load]);

  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  function handleCreated(p: Project): void {
    addProject(p);
    setShowCreate(false);
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
            background: S.accent, color: '#0d1117', border: 'none', borderRadius: '7px',
            padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <IconPlus /> New project
        </button>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {active.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
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
