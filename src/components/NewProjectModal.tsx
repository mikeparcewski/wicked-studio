import { useEffect, useId, useState } from 'react';
import { api } from '../api/client.js';
import { modePath } from '../hooks/useRoute.js';
import { useProjectsStore } from '../store/projects.js';

/**
 * The new-project flow (DES-FEEDBACK-001 §1.3, slice A): a minimal inline
 * modal — not a new route, not a full page — opened from the QUICK section's
 * `Project` action. Name (required), a "Start with" radio (default Build),
 * an optional description; Create → `POST /api/v1/projects`, then navigate
 * into the chosen mode's shell. Escape / ✕ / Cancel close it.
 *
 * The wire contract (verified against wicked-crew `projects/routes.ts` +
 * `wicked-crew-api-types`): the body is `{ name, description? }` with
 * `name: z.string().min(1).max(120)` — the daemon accepts any 1–120-char
 * string and 409s on an active-name collision. The design's stricter slug
 * rule is therefore the CLIENT-side UX gate (§1.3: "no silent 400"): the
 * regex below blocks Create before the request ever fires.
 */

export const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9 _-]{0,63}$/;

export type StartWith = 'empty' | 'build' | 'chat' | 'document';

const START_OPTIONS: { value: StartWith; label: string }[] = [
  { value: 'empty', label: 'Empty' },
  { value: 'build', label: 'Build' },
  { value: 'chat', label: 'Chat' },
  { value: 'document', label: 'Document' },
];

/** Where a just-created project lands, per start mode. Empty = its detail page. */
export function startPath(projectId: string, start: StartWith): string {
  return start === 'empty'
    ? `/projects/${encodeURIComponent(projectId)}`
    : modePath(projectId, start);
}

interface Props {
  navigate: (path: string) => void;
  onClose: () => void;
}

export function NewProjectModal({ navigate, onClose }: Props): React.ReactElement {
  const titleId = useId();
  const [name, setName] = useState('');
  const [start, setStart] = useState<StartWith>('build');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const nameValid = PROJECT_NAME_RE.test(name);

  async function create(): Promise<void> {
    if (!nameValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject(
        description.trim() === '' ? { name } : { name, description: description.trim() },
      );
      // Fresh-entity hydration (DES-UX-001 §7.10): the created project joins the
      // store BEFORE navigation, so the rail row and the shell breadcrumb render
      // its display name immediately — never the raw `proj_…` id until a reload.
      useProjectsStore.getState().addProject(project);
      onClose();
      navigate(startPath(project.id, start));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const labelStyle = {
    fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)',
    fontFamily: 'var(--font-sans)', fontWeight: 'var(--weight-medium)',
  } as const;
  const fieldStyle = {
    background: 'var(--surface-base)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-sm)', color: 'var(--ink-body)',
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
    caretColor: 'var(--accent)',
  } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="new-project-modal"
        className="flex flex-col gap-2 p-4"
        style={{
          width: '360px', minHeight: '280px',
          background: 'var(--surface-overlay)',
          border: '1px solid var(--surface-raised)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-overlay)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2
            id={titleId}
            className="text-sm font-semibold"
            style={{ color: 'var(--ink-high)', fontFamily: 'var(--font-sans)', margin: 0 }}
          >
            New project
          </h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="new-project-close"
            onClick={onClose}
            className="text-base leading-none transition-opacity hover:opacity-70"
            style={{ background: 'transparent', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span style={labelStyle}>Name</span>
          <input
            type="text"
            data-testid="new-project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="lowercase, digits, space, - or _"
            className="w-full px-2 py-1.5 outline-none"
            style={fieldStyle}
          />
        </label>
        {name !== '' && !nameValid && (
          <p
            data-testid="new-project-name-invalid"
            className="text-[10px] font-mono"
            style={{ color: 'var(--status-fail)', margin: 0 }}
          >
            1–64 chars: lowercase letters, digits, spaces, - or _, starting with a letter or digit.
          </p>
        )}

        <fieldset className="flex flex-col gap-1" style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ ...labelStyle, padding: 0 }}>Start with (optional)</legend>
          <div className="flex items-center gap-3" data-testid="new-project-start">
            {START_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-1 cursor-pointer"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)' }}
              >
                <input
                  type="radio"
                  name="new-project-start"
                  value={opt.value}
                  checked={start === opt.value}
                  onChange={() => setStart(opt.value)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span style={labelStyle}>Description (optional)</span>
          <textarea
            data-testid="new-project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 outline-none resize-none"
            style={fieldStyle}
          />
        </label>

        {error !== null && (
          <p
            data-testid="new-project-error"
            className="text-[10px] font-mono"
            style={{ color: 'var(--status-fail)', margin: 0 }}
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 mt-auto pt-1">
          <button
            type="button"
            data-testid="new-project-cancel"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs transition-opacity hover:opacity-80"
            style={{
              background: 'transparent', border: '1px solid var(--surface-raised)',
              color: 'var(--ink-muted)', fontFamily: 'var(--font-sans)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="new-project-create"
            onClick={() => { void create(); }}
            disabled={!nameValid || busy}
            className="px-3 py-1.5 rounded text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: 'var(--accent)', border: 'none', color: 'var(--accent-fg)',
              fontFamily: 'var(--font-sans)', cursor: nameValid && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Creating…' : 'Create project →'}
          </button>
        </div>
      </div>
    </div>
  );
}
