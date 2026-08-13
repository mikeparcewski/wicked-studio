import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { ActivityEntry, ProjectDetail, ProjectMember } from '../api/types.js';
import { useProjectsStore } from '../store/projects.js';

const S = {
  card:   '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  faint:  'rgba(230,237,243,0.3)',
  accent: '#ffda19',
  green:  '#3fb950',
  red:    '#f85149',
  hover:  'rgba(230,237,243,0.04)',
};

function IconBack(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function Pill({ label, color }: { label: string; color: string }): React.ReactElement {
  return (
    <span style={{
      fontSize: '10px', fontFamily: 'monospace', color,
      border: `1px solid ${color}`, borderRadius: '4px', padding: '1px 5px',
    }}>
      {label}
    </span>
  );
}

function MemberKindLabel({ kind }: { kind: string }): React.ReactElement {
  const colors: Record<string, string> = {
    'crew.run': '#79c0ff',
    'crew.chat': '#a5d6ff',
    'crew.repo': '#7ee787',
    'crew.workflow': '#ffa657',
    'interactive.doc': '#d2a8ff',
  };
  const color = colors[kind] ?? S.faint;
  return <Pill label={kind} color={color} />;
}

function ActivityRow({ entry }: { entry: ActivityEntry }): React.ReactElement {
  const ts = new Date(entry.ts);
  return (
    <div style={{
      display: 'flex', gap: '12px', padding: '10px 0',
      borderBottom: `1px solid ${S.border}`, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: '10px', fontFamily: 'monospace', color: S.faint, flexShrink: 0, paddingTop: '1px' }}>
        {ts.toLocaleTimeString()}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '12px', color: S.muted, margin: 0, marginBottom: '2px' }}>
          <span style={{ color: S.faint, fontFamily: 'monospace' }}>{entry.kind}</span>
          {' '}
          <span style={{ color: S.ink }}>{entry.summary}</span>
        </p>
        <span style={{ fontSize: '10px', fontFamily: 'monospace', color: S.faint }}>{entry.ref}</span>
      </div>
      <span style={{
        fontSize: '10px', fontFamily: 'monospace', flexShrink: 0,
        color: entry.source === 'crew' ? '#79c0ff' : '#d2a8ff',
      }}>
        {entry.source}
      </span>
    </div>
  );
}

function MemberRow({
  member,
  onDetach,
}: {
  member: ProjectMember;
  onDetach: (id: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);

  async function detach(): Promise<void> {
    setBusy(true);
    onDetach(member.id);
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
        borderRadius: '7px', background: hovered ? S.hover : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <MemberKindLabel kind={member.member_kind} />
      <span style={{ fontSize: '12px', fontFamily: 'monospace', color: S.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {member.member_ref}
      </span>
      <span style={{ fontSize: '10px', color: S.faint, flexShrink: 0 }}>
        {member.attached_by} · {new Date(member.attached_at).toLocaleDateString()}
      </span>
      {hovered && (
        <button
          type="button"
          onClick={() => void detach()}
          disabled={busy}
          style={{
            background: 'transparent', border: `1px solid ${S.red}`, color: S.red,
            borderRadius: '5px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {busy ? '…' : 'Detach'}
        </button>
      )}
    </div>
  );
}

interface Props {
  projectId: string;
  navigate: (path: string) => void;
}

export function ProjectDetailPage({ projectId, navigate }: Props): React.ReactElement {
  const { updateProject } = useProjectsStore();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [archiveBusy, setArchiveBusy] = useState(false);

  const isDefault = projectId === 'default';
  const project = detail?.project ?? null;
  const members = detail?.members ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [det, act] = await Promise.all([
        api.getProject(projectId),
        api.getProjectActivity(projectId).catch(() => ({ entries: [], nextCursor: null, projectId })),
      ]);
      setDetail(det);
      setActivity(act.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  function startEdit(): void {
    if (!project) return;
    setEditName(project.name);
    setEditDesc(project.description ?? '');
    setEditErr(null);
    setEditing(true);
  }

  async function saveEdit(): Promise<void> {
    if (!project) return;
    const trimName = editName.trim();
    if (!trimName) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const { project: updated } = await api.updateProject(project.id, {
        name: trimName,
        description: editDesc.trim(),
      });
      setDetail((d) => d ? { ...d, project: updated } : d);
      updateProject(updated);
      setEditing(false);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!project || isDefault) return;
    setArchiveBusy(true);
    try {
      const newStatus = project.status === 'active' ? 'archived' : 'active';
      const { project: updated } = await api.updateProject(project.id, { status: newStatus });
      setDetail((d) => d ? { ...d, project: updated } : d);
      updateProject(updated);
    } catch {
      /* show nothing, the button will re-enable */
    } finally {
      setArchiveBusy(false);
    }
  }

  function handleDetach(memberId: string): void {
    if (!project) return;
    void api.detachProjectMember(project.id, memberId).catch(() => {});
    setDetail((d) => d ? { ...d, members: d.members.filter((m) => m.id !== memberId) } : d);
  }

  if (loading) {
    return (
      <div style={{ padding: '28px 32px' }}>
        <p style={{ fontSize: '13px', color: S.faint, fontFamily: 'monospace' }}>Loading…</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div style={{ padding: '28px 32px' }}>
        <button
          type="button"
          onClick={() => navigate('/projects')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', cursor: 'pointer', color: S.muted, fontSize: '13px', marginBottom: '16px', padding: 0 }}
        >
          <IconBack /> Projects
        </button>
        <p style={{ fontSize: '13px', color: S.red }}>{error ?? 'Project not found.'}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '800px' }}>
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/projects')}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
          border: 'none', cursor: 'pointer', color: S.muted, fontSize: '12px',
          marginBottom: '20px', padding: 0,
        }}
      >
        <IconBack /> All projects
      </button>

      {/* Header */}
      {editing ? (
        <div style={{ marginBottom: '24px' }}>
          <input
            type="text"
            value={editName}
            maxLength={120}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${S.border}`,
              borderRadius: '6px', padding: '8px 10px', fontSize: '18px', fontWeight: 700,
              color: S.ink, outline: 'none', marginBottom: '8px', boxSizing: 'border-box',
            }}
          />
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            rows={2}
            placeholder="Description (optional)"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)', border: `1px solid ${S.border}`,
              borderRadius: '6px', padding: '8px 10px', fontSize: '13px', color: S.ink,
              outline: 'none', resize: 'vertical', marginBottom: '10px', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          {editErr && <p style={{ fontSize: '12px', color: S.red, marginBottom: '8px' }}>{editErr}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={editBusy || !editName.trim()}
              style={{
                background: S.accent, color: '#0d1117', border: 'none', borderRadius: '6px',
                padding: '6px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                opacity: editBusy ? 0.5 : 1,
              }}
            >
              {editBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                background: 'transparent', color: S.muted, border: `1px solid ${S.border}`,
                borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: S.ink, margin: 0 }}>
                {project.name}
              </h1>
              {project.status === 'archived' && <Pill label="archived" color={S.faint} />}
              {isDefault && <Pill label="default" color={S.faint} />}
            </div>
            {project.description && (
              <p style={{ fontSize: '13px', color: S.muted, margin: 0 }}>{project.description}</p>
            )}
            {project.created_at > 0 && (
              <p style={{ fontSize: '11px', color: S.faint, margin: 0, marginTop: '6px', fontFamily: 'monospace' }}>
                Created {new Date(project.created_at).toLocaleDateString()}
                {project.updated_at !== project.created_at && (
                  <> · Updated {new Date(project.updated_at).toLocaleDateString()}</>
                )}
              </p>
            )}
          </div>
          {!isDefault && (
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button
                type="button"
                onClick={startEdit}
                style={{
                  background: 'transparent', color: S.muted, border: `1px solid ${S.border}`,
                  borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                }}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void toggleArchive()}
                disabled={archiveBusy}
                style={{
                  background: 'transparent', color: S.faint, border: `1px solid ${S.border}`,
                  borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer',
                  opacity: archiveBusy ? 0.5 : 1,
                }}
              >
                {project.status === 'active' ? 'Archive' : 'Restore'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Members */}
      <section style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 600, color: S.muted, margin: 0, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'monospace' }}>
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <p style={{ fontSize: '13px', color: S.faint }}>No members attached yet.</p>
        ) : (
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px', overflow: 'hidden', padding: '4px' }}>
            {members.map((m) => (
              <MemberRow key={m.id} member={m} onDetach={handleDetach} />
            ))}
          </div>
        )}
      </section>

      {/* Activity */}
      <section>
        <h2 style={{ fontSize: '13px', fontWeight: 600, color: S.muted, margin: 0, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'monospace' }}>
          Activity
        </h2>
        {activity.length === 0 ? (
          <p style={{ fontSize: '13px', color: S.faint }}>No activity yet.</p>
        ) : (
          <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px', padding: '0 12px' }}>
            {activity.map((e) => (
              <ActivityRow key={e.id} entry={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
