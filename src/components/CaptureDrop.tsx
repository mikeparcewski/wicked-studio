import { useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { captureConsequence, captureFiledChip, captureFiledLine, isCaptureImage } from '../board/captureModel.js';
import { ambientProjectId } from '../hooks/ambientProject.js';
import { useCapture } from '../hooks/useCapture.js';
import { useProjectsStore } from '../store/projects.js';

/**
 * CAPTURE ANYTHING (Studio OS behaviour 8) — the drop point, where you already are: a verb in
 * Home's row beside Do Work (a popover) and a line in the Ask dock (inline). Notes, a transcript or
 * a whiteboard photo go to the chosen project; the consequence is said before the send. What the
 * team files lands in Home's EXISTING Needs You proposal triage — there is no second review here,
 * only the status line of what the capture has filed and where it waits. A skin over `useCapture`.
 */

const S = {
  panel: {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px',
    background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-xs)',
  },
  consequence: { margin: 0, color: 'var(--ink-body)', lineHeight: 1.4 },
  textarea: {
    width: '100%', minHeight: '64px', resize: 'vertical', boxSizing: 'border-box',
    background: 'var(--surface-base)', color: 'var(--ink-high)',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '6px 8px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)',
  },
  row: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' },
  chip: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)', padding: '1px 6px',
  },
  ghost: {
    background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer',
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '3px 8px', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
  },
  primary: {
    background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', cursor: 'pointer',
    borderRadius: 'var(--radius-md)', padding: '4px 12px', fontSize: 'var(--text-xs)',
    fontWeight: 'var(--weight-bold)',
  },
  status: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

export function CaptureDrop({ runs, pathname = '/', inline = false, opens = 'down', onReview }: {
  runs: readonly SessionView[];
  /** The route the drop sits on: its project (if any) is the default target. */
  pathname?: string;
  /** Ask dock: the form renders in place, not as a popover. */
  inline?: boolean;
  /** Which way the popover opens from its button: `down` (Home's verb row), or `up` where the
   *  button sits in a bottom band (the Desk's Start row) and a downward form would leave the screen. */
  opens?: 'down' | 'up';
  /** Where "Review" goes: Home's Needs You triage. Absent = already there (no link). */
  onReview?: (() => void) | undefined;
}): React.ReactElement | null {
  const projects = useProjectsStore((s) => s.projects).filter((p) => p.id !== 'default');
  const cap = useCapture(runs);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const ambient = ambientProjectId(pathname);
  // The picked project, else the one the route is on, else the first.
  const project = projects.find((p) => p.id === picked) ?? projects.find((p) => p.id === ambient) ?? projects[0];
  if (project === undefined) return null;

  const addFiles = (list: FileList | null): void => {
    const add = Array.from(list ?? []);
    if (add.length > 0) setFiles((cur) => [...cur, ...add]);
  };

  const send = async (): Promise<void> => {
    if (await cap.send(project.id, project.name, notes, files)) {
      setNotes('');
      setFiles([]);
      setOpen(false);
    }
  };

  const fullLine = cap.last !== null && cap.filed !== null ? captureFiledLine(cap.filed, cap.last.projectName, cap.done) : '';
  const statusData = cap.last !== null && cap.filed !== null
    ? { 'data-run-id': cap.last.runId, 'data-waiting': cap.filed.waiting, 'data-done': String(cap.done) }
    : null;
  // The full line with its moves: the dock shows it under the drop; Home shows it inside the open popover.
  const fullStatus = (testId: string): React.ReactNode => statusData !== null && (
    <span data-testid={testId} {...statusData} style={{ ...S.row, minWidth: 0 }}>
      <span data-testid={`${testId}-line`} style={{ ...S.status, whiteSpace: 'normal', flex: '1 1 200px' }}>{fullLine}</span>
      {onReview !== undefined && cap.filed !== null && cap.filed.waiting > 0 && (
        <button type="button" data-testid="capture-review" onClick={onReview} style={{ ...S.ghost, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
          Review in Needs You ›
        </button>
      )}
      <button type="button" data-testid="capture-dismiss" aria-label="Dismiss the capture status" onClick={cap.clear} style={{ ...S.ghost, border: 'none' }}>
        ×
      </button>
    </span>
  );

  const form = (
    <div
      data-testid="capture-drop"
      role={inline ? undefined : 'dialog'}
      aria-label="Capture notes or a photo"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); }}
      style={{
        ...S.panel,
        ...(inline ? {} : {
          position: 'absolute', ...(opens === 'up' ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
          left: 0, width: 'min(440px, 90vw)', zIndex: 45,
        }),
      }}
    >
      {/* The consequence first: where it goes, what happens, what is kept. */}
      <p data-testid="capture-consequence" style={S.consequence}>{captureConsequence(project.name)}</p>
      <label style={{ ...S.row, color: 'var(--ink-muted)' }}>
        Project
        <select
          data-testid="capture-project"
          value={project.id}
          onChange={(e) => setPicked(e.target.value)}
          style={{ ...S.ghost, cursor: 'pointer' }}
        >
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <textarea
        data-testid="capture-notes"
        aria-label="Capture notes"
        placeholder="Paste notes or a transcript, or drop a whiteboard photo here…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={S.textarea}
      />
      <div style={S.row}>
        <input
          ref={fileInput}
          data-testid="capture-files"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.markdown,.vtt,.srt,.json,.csv,text/*"
          aria-label="Add files to capture"
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <button type="button" style={S.ghost} onClick={() => fileInput.current?.click()}>Add files or a photo</button>
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} data-testid="capture-file" data-kind={isCaptureImage(f) ? 'image' : 'text'} style={S.chip}>
            {isCaptureImage(f) ? 'photo' : 'text'} · {f.name}
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
              style={{ ...S.ghost, border: 'none', padding: '0 0 0 4px' }}
            >
              ×
            </button>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="capture-send"
          disabled={cap.sending}
          onClick={() => void send()}
          style={{ ...S.primary, opacity: cap.sending ? 0.6 : 1 }}
        >
          {cap.sending ? 'Sending…' : `Capture to ${project.name}`}
        </button>
      </div>
      {cap.error !== null && <p data-testid="capture-error" role="alert" style={{ margin: 0, color: 'var(--status-fail)' }}>{cap.error}</p>}
      {!inline && fullStatus('capture-last')}
    </div>
  );

  return (
    <span data-testid="capture" style={{ position: 'relative', display: inline ? 'flex' : 'inline-flex', flexDirection: inline ? 'column' : 'row', gap: '6px', alignItems: inline ? 'stretch' : 'center', minWidth: 0 }}>
      <button
        type="button"
        data-testid="capture-open"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={inline ? 'wk-btn wk-btn--secondary wk-btn--sm' : 'wk-btn wk-btn--secondary'}
        style={inline ? { alignSelf: 'flex-start' } : undefined}
        title="Drop notes, a transcript or a whiteboard photo; the team files what they say as proposals"
      >
        Capture
        {/* Home: the last capture's count rides the verb itself (one row; the Needs You group below
            carries the consequence split, the full line is the title and the open drop's). */}
        {!inline && statusData !== null && cap.filed !== null && (
          <span data-testid="capture-status" {...statusData} style={{ marginLeft: '6px' }}>
            <span data-testid="capture-status-line" title={fullLine} style={{ ...S.status, color: 'var(--accent)' }}>
              · {captureFiledChip(cap.filed, cap.done)}
            </span>
          </span>
        )}
      </button>
      {open && form}
      {inline && fullStatus('capture-status')}
    </span>
  );
}
