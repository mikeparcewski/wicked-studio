import { useRef, useState } from 'react';
import {
  importSteeringRules,
  isSteeringUnsupported,
  STEERING_TYPE_LABELS,
  STEERING_UNSUPPORTED_COPY,
  type SteeringImportEntry,
  type SteeringType,
} from '../api/steering.js';
import { readFileText } from './fileText.js';

/**
 * The Import flow — opened on demand from the Add menu, never rendered open by default. A
 * picked `.md` (frontmattered doctrine) or `.json` (rule batch) POSTs to the same
 * `/governance/steering/import` wire as before, typed from THIS page; per-entry results render
 * honestly (created/updated/error), and a 501/route-absent daemon gets the honest unsupported
 * copy, never a raw refusal.
 */

type ImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; filename: string }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; filename: string; results: SteeringImportEntry[] };

const IMPORT_STATUS_COLOR: Record<SteeringImportEntry['status'], string> = {
  created: 'var(--status-done)',
  updated: 'var(--status-run)',
  error: 'var(--status-fail)',
};

export function SteeringImportPanel({ type, onClose, onImported }: {
  type: SteeringType;
  onClose: () => void;
  /** Fires after any import attempt that may have landed rules — the shell reloads. */
  onImported: () => void;
}): React.ReactElement {
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);

  const onPick = (file: File): void => {
    const isJson = file.name.toLowerCase().endsWith('.json');
    setState({ kind: 'busy', filename: file.name });
    void readFileText(file)
      .then((content) => {
        // .md = one doc entry through the MarkdownAdapter path; .json = a rule batch,
        // each object its own entry so a half-good batch reports per rule.
        const entries = isJson
          ? (JSON.parse(content) as Record<string, unknown>[]).map((rule) => ({
              kind: 'rule' as const,
              rule,
            }))
          : [{ kind: 'doc' as const, name: file.name, content }];
        return importSteeringRules({ type, entries });
      })
      .then(({ results }) => {
        setState({ kind: 'done', filename: file.name, results });
        // Something may have landed even in a half-good batch — show the server's state.
        onImported();
      })
      .catch((e: unknown) => {
        if (isSteeringUnsupported(e)) setState({ kind: 'unsupported' });
        else setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
  };

  return (
    <div
      data-testid="steering-import-panel"
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          Import {STEERING_TYPE_LABELS[type]} rules
        </span>
        <button
          data-testid="steering-import-close"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Close
        </button>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
        A frontmattered <span className="font-mono">.md</span> doctrine doc or a{' '}
        <span className="font-mono">.json</span> rule batch — every imported rule lands typed{' '}
        <span className="font-mono">{type}</span> (this page).
      </p>
      <input
        ref={fileInput}
        data-testid="steering-import-file"
        type="file"
        accept=".md,.markdown,.json"
        aria-label="Import steering rules file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) onPick(f);
          e.target.value = '';
        }}
        className="text-[10px]"
        style={{ color: 'var(--ink-muted)' }}
      />
      {state.kind === 'busy' && (
        <p data-testid="steering-import-busy" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          Importing {state.filename}…
        </p>
      )}
      {state.kind === 'unsupported' && (
        <p data-testid="steering-import-unsupported" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {STEERING_UNSUPPORTED_COPY}
        </p>
      )}
      {state.kind === 'failed' && (
        <p data-testid="steering-import-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {state.message}
        </p>
      )}
      {state.kind === 'done' && (
        <div className="flex flex-col gap-1">
          <p data-testid="steering-import-summary" className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            {state.filename}: {state.results.filter((r) => r.status === 'created').length} created ·{' '}
            {state.results.filter((r) => r.status === 'updated').length} updated ·{' '}
            {state.results.filter((r) => r.status === 'error').length} failed
          </p>
          {state.results.map((r, i) => (
            <p
              key={`${r.id ?? i}-${i}`}
              data-testid="steering-import-result"
              data-status={r.status}
              className="flex items-baseline gap-2 text-[10px]"
            >
              <span className="font-semibold font-mono" style={{ color: IMPORT_STATUS_COLOR[r.status] }}>{r.status}</span>
              {r.id !== undefined && <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{r.id}</span>}
              <span className="truncate" style={{ color: 'var(--ink-muted)' }}>
                {r.status === 'error' ? r.error ?? 'unspecified error' : r.statement ?? ''}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
