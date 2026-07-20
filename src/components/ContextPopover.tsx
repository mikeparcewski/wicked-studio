import { useRef } from 'react';
import type { EntityMode, RepoEntry, RosterSeat, WorkflowDef } from '../api/types.js';

export type ConfirmMode = 'none' | 'all' | 'before';

interface Props {
  roster: RosterSeat[];
  selectedClis: Set<string>;
  onToggleCli: (key: string) => void;
  confirmMode: ConfirmMode;
  onConfirmModeChange: (mode: ConfirmMode) => void;
  beforeOrd: number;
  onBeforeOrdChange: (ord: number) => void;
  entityMode: EntityMode;
  onEntityModeChange: (mode: EntityMode) => void;
  workflows: WorkflowDef[];
  workflow: string;
  onWorkflowChange: (wf: string) => void;
  repos: RepoEntry[];
  repoRefs: string[];
  onRepoRefsChange: (refs: string[]) => void;
  attachedFiles: File[];
  onFilesChange: (files: File[]) => void;
}

const WORKFLOW_LABELS: Record<string, string> = {
  feature: 'Feature (6 phases)',
  bug: 'Bug (4 phases)',
  migration: 'Migration (5 phases)',
};

function getWorkflowLabel(id: string, workflows: WorkflowDef[]): string {
  const wf = workflows.find((w) => w.id === id);
  if (wf) {
    return `${id.charAt(0).toUpperCase()}${id.slice(1)} (${wf.phases.length} phases)`;
  }
  return WORKFLOW_LABELS[id] ?? id;
}

function SectionHead({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p
      className="text-[10px] uppercase tracking-widest font-semibold mb-2"
      style={{ color: 'rgba(230,237,243,0.35)' }}
    >
      {children}
    </p>
  );
}

function Divider(): React.ReactElement {
  return <div style={{ height: '1px', background: 'rgba(230,237,243,0.07)' }} />;
}

/**
 * Options popover for the chat input launch form.
 * Rendered absolutely above the + button by ChatInput; close logic lives there.
 */
export function ContextPopover({
  roster,
  selectedClis,
  onToggleCli,
  confirmMode,
  onConfirmModeChange,
  beforeOrd,
  onBeforeOrdChange,
  entityMode,
  onEntityModeChange,
  workflows,
  workflow,
  onWorkflowChange,
  repos,
  repoRefs,
  onRepoRefsChange,
  attachedFiles,
  onFilesChange,
}: Props): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(e.target.files ?? []);
    onFilesChange([...attachedFiles, ...picked]);
    // Reset so the same file can be re-selected after removal
    e.target.value = '';
  }

  function removeFile(idx: number): void {
    onFilesChange(attachedFiles.filter((_, i) => i !== idx));
  }

  return (
    <div
      role="dialog"
      aria-label="Launch options"
      className="flex flex-col text-xs font-mono overflow-y-auto rounded-2xl"
      style={{
        background: '#1b222e',
        border: '1px solid rgba(230,237,243,0.15)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
        width: '300px',
        maxHeight: '460px',
      }}
    >
      {/* ── Upload files ─────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Upload files</SectionHead>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg px-3 py-1.5 font-semibold transition-opacity hover:opacity-80"
          style={{
            background: 'rgba(230,237,243,0.07)',
            color: '#e6edf3',
            border: '1px solid rgba(230,237,243,0.1)',
          }}
        >
          Choose file(s)…
        </button>
        {/* TODO: ingest attached files via api.ingestKnowledge(title, chunks) on launch */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          aria-label="Upload files for knowledge context"
        />
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {attachedFiles.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]"
                style={{
                  background: 'rgba(121,192,255,0.1)',
                  color: '#79c0ff',
                  border: '1px solid rgba(121,192,255,0.2)',
                }}
              >
                {f.name}
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${f.name}`}
                  className="opacity-60 hover:opacity-100 leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* ── CLIs on/off ──────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>CLIs on/off</SectionHead>
        {roster.length === 0 ? (
          <span style={{ color: 'rgba(230,237,243,0.3)' }}>No roster loaded</span>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {roster.map((seat) => (
              <label
                key={seat.key}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ color: 'rgba(230,237,243,0.65)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedClis.has(seat.key)}
                  onChange={() => onToggleCli(seat.key)}
                  data-testid={`launch-seat-${seat.key}`}
                />
                <span>{seat.key}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* ── Gate ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Set gate</SectionHead>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            data-testid="launch-confirm"
            className="rounded-lg px-2 py-1"
            style={{
              background: '#0d1117',
              border: '1px solid rgba(230,237,243,0.14)',
              color: '#e6edf3',
            }}
            value={confirmMode}
            onChange={(e) => onConfirmModeChange(e.target.value as ConfirmMode)}
          >
            <option value="none">None</option>
            <option value="all">Every unit</option>
            <option value="before">Before unit #</option>
          </select>
          {confirmMode === 'before' && (
            <input
              type="number"
              min={1}
              value={beforeOrd}
              onChange={(e) => onBeforeOrdChange(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 rounded-lg px-2 py-1"
              style={{
                background: '#0d1117',
                border: '1px solid rgba(230,237,243,0.14)',
                color: '#e6edf3',
              }}
            />
          )}
        </div>
      </div>

      <Divider />

      {/* ── Mode ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Set mode</SectionHead>
        <div className="flex items-center gap-1.5">
          {(['shared', 'isolated'] as EntityMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`launch-entity-${m}`}
              onClick={() => onEntityModeChange(m)}
              className="rounded-lg px-3 py-1 capitalize font-medium transition-colors"
              style={
                entityMode === m
                  ? { background: 'rgba(230,237,243,0.12)', color: '#e6edf3' }
                  : { color: 'rgba(230,237,243,0.4)' }
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <Divider />

      {/* ── Workflow ──────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Choose workflow</SectionHead>
        <select
          data-testid="launch-workflow"
          className="rounded-lg px-2 py-1 w-full"
          style={{
            background: '#0d1117',
            border: '1px solid rgba(230,237,243,0.14)',
            color: '#e6edf3',
          }}
          value={workflow}
          onChange={(e) => onWorkflowChange(e.target.value)}
        >
          <option value="">(free-text)</option>
          {(workflows.length > 0
            ? workflows.map((w) => w.id)
            : Object.keys(WORKFLOW_LABELS)
          ).map((id) => (
            <option key={id} value={id}>
              {getWorkflowLabel(id, workflows)}
            </option>
          ))}
        </select>
      </div>

      <Divider />

      {/* ── Repos ────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        <SectionHead>Add repos</SectionHead>
        {repos.length === 0 ? (
          <p className="text-[11px] font-mono italic" style={{ color: 'rgba(230,237,243,0.3)' }}>No repos registered.</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
            {repos.map((r) => {
              const checked = repoRefs.includes(r.id);
              return (
                <label
                  key={r.id}
                  className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-[rgba(230,237,243,0.04)]"
                >
                  <input
                    type="checkbox"
                    data-testid={`launch-repo-${r.id}`}
                    checked={checked}
                    onChange={() => {
                      if (checked) onRepoRefsChange(repoRefs.filter((id) => id !== r.id));
                      else onRepoRefsChange([...repoRefs, r.id]);
                    }}
                    className="accent-[#ffda19] w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-[11px] font-mono truncate" style={{ color: '#e6edf3' }}>
                    {r.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
