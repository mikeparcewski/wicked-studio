import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../api/client.js';
import type { RunDiff, RunFileContent } from '../api/types.js';
import { classifyDiff, isDimLine } from '../viewer/colorize.js';
import type { DiffLineKind } from '../viewer/colorize.js';

/**
 * The in-studio file & diff viewer (DES-FEEDBACK-002 §3.4, slice I).
 *
 * A canvas-scale overlay — `min(1100px, 86vw) × 82vh` on `--surface-overlay`
 * (EC18's spirit: a file you are reading deserves the viewport; the 288px
 * RightPanel cannot show code). Two tabs:
 *
 *  - [File] → `GET /runs/:id/files?path=…` — mono text with `--ink-dim` line
 *    numbers; honest states for binary ("binary file — N bytes", never
 *    mojibake) and truncation (a labeled banner naming the cap and the full
 *    size — the viewer never silently amputates, EC23).
 *  - [Diff] → `GET /runs/:id/diff[?path=…]` — unified diff colored by the
 *    zero-dependency classifier (§3.5): the diff colors ARE the status tokens
 *    (added = --status-run family, removed = --status-fail family), no grammar
 *    library, no new palette.
 *
 * Requests fire ONLY on a user gesture: the viewer mounts on a row click and
 * each tab fetches on its first activation — nothing is prefetched.
 *
 * Route errors (400/403/404/409/507) surface VERBATIM — never swallowed. The
 * one exception is the forward-compat contract every studio wire follows: a
 * daemon WITHOUT the routes answers Fastify's generic 404 (`Not Found`, no
 * named error), and that calls `onUnsupported` so the caller can fall back to
 * today's exact behavior (external open + copy feedback) instead of the
 * viewer rendering an empty shell.
 */

export type ViewerTab = 'file' | 'diff';

interface Props {
  runId: string;
  /** Absolute path of the viewed file; undefined = the whole-run diff viewer. */
  path?: string;
  defaultTab: ViewerTab;
  onClose: () => void;
  /** The daemon has no file/diff routes (generic route-absent 404). */
  onUnsupported: () => void;
}

type Fetched<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; data: T };

/** Fastify's default unknown-route 404 carries no named error — the daemon
 *  predates crew#305. Named 404s ("unknown run: …", "no such file: …") are
 *  real answers from a daemon WITH the routes and must surface verbatim. */
function isRouteAbsent(e: unknown): boolean {
  return e instanceof Error && e.message === 'API 404: Not Found';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** §3.5/§3.6 — kind → token-resolved dress (EC15: tokens only, never hex). */
const DIFF_STYLE: Record<DiffLineKind, CSSProperties> = {
  add: { color: 'var(--status-run)', background: 'var(--status-run-dim)' },
  del: { color: 'var(--status-fail)', background: 'var(--status-fail-dim)' },
  hunk: { color: 'var(--ink-dim)', background: 'var(--surface-raised)' },
  file: { color: 'var(--ink-muted)', fontWeight: 'var(--weight-semi)' as CSSProperties['fontWeight'] },
  meta: { color: 'var(--ink-dim)' },
  ctx: { color: 'var(--ink-body)' },
};

const DIFF_TESTID: Partial<Record<DiffLineKind, string>> = {
  add: 'diff-line-add',
  del: 'diff-line-del',
  hunk: 'diff-line-hunk',
};

const CODE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  lineHeight: 'var(--leading-body)',
};

function TruncationBanner({ text }: { text: string }): React.ReactElement {
  return (
    <div
      data-testid="viewer-truncation-banner"
      className="px-3 py-1.5 text-[11px] font-mono shrink-0"
      style={{ color: 'var(--status-gate)', background: 'var(--surface-raised)', borderBottom: '1px solid var(--surface-raised)' }}
    >
      {text}
    </div>
  );
}

function ErrorPane({ message }: { message: string }): React.ReactElement {
  return (
    <p data-testid="viewer-error" className="p-4 text-xs font-mono break-all" style={{ color: 'var(--status-fail)' }}>
      {message}
    </p>
  );
}

function LoadingPane(): React.ReactElement {
  return (
    <p className="p-4 text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>Loading…</p>
  );
}

export function FileViewer({ runId, path, defaultTab, onClose, onUnsupported }: Props): React.ReactElement {
  const [tab, setTab] = useState<ViewerTab>(path === undefined ? 'diff' : defaultTab);
  const [file, setFile] = useState<Fetched<RunFileContent> | null>(null);
  const [diff, setDiff] = useState<Fetched<RunDiff> | null>(null);

  // Escape closes (the Modal pattern); the caller restores focus to the row.
  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Fetch on first tab activation only — the user gesture is the trigger.
  useEffect(() => {
    if (tab !== 'file' || path === undefined || file !== null) return;
    setFile({ state: 'loading' });
    api.getRunFile(runId, path)
      .then((data) => setFile({ state: 'ok', data }))
      .catch((e: unknown) => {
        if (isRouteAbsent(e)) { onUnsupported(); return; }
        setFile({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, [tab, path, runId, file, onUnsupported]);

  useEffect(() => {
    if (tab !== 'diff' || diff !== null) return;
    setDiff({ state: 'loading' });
    api.getRunDiff(runId, path)
      .then((data) => setDiff({ state: 'ok', data }))
      .catch((e: unknown) => {
        if (isRouteAbsent(e)) { onUnsupported(); return; }
        setDiff({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, [tab, path, runId, diff, onUnsupported]);

  function handleOpenExternally(): void {
    if (path === undefined) return;
    api.openPath(path, runId).catch(() => {
      void navigator.clipboard.writeText(path).catch(() => { /* clipboard unavailable */ });
    });
  }

  function handleCopy(): void {
    if (path === undefined) return;
    void navigator.clipboard.writeText(path).catch(() => { /* clipboard unavailable */ });
  }

  const title = path ?? 'whole-run diff';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        data-testid="file-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex flex-col overflow-hidden"
        style={{
          width: 'min(1100px, 86vw)',
          height: '82vh',
          background: 'var(--surface-overlay)',
          boxShadow: 'var(--shadow-overlay)',
          borderRadius: 'var(--radius-xl)',
        }}
      >
        {/* Header: path · tabs · open/copy/esc (the §3.4 anatomy) */}
        <div
          className="flex items-center gap-3 px-4 py-2.5 shrink-0"
          style={{ borderBottom: '1px solid var(--surface-raised)' }}
        >
          <span
            className="min-w-0 flex-1 truncate text-xs font-mono"
            style={{ color: 'var(--ink-high)' }}
            title={title}
          >
            {title}
          </span>
          <div className="flex items-center gap-1 shrink-0" role="tablist" aria-label="Viewer mode">
            {path !== undefined && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'file'}
                data-testid="viewer-tab-file"
                onClick={() => setTab('file')}
                className="px-2 py-1 text-[11px] font-mono"
                style={{
                  color: tab === 'file' ? 'var(--ink-high)' : 'var(--ink-muted)',
                  borderBottom: tab === 'file' ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                File
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'diff'}
              data-testid="viewer-tab-diff"
              onClick={() => setTab('diff')}
              className="px-2 py-1 text-[11px] font-mono"
              style={{
                color: tab === 'diff' ? 'var(--ink-high)' : 'var(--ink-muted)',
                borderBottom: tab === 'diff' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              Diff
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {path !== undefined && (
              <>
                <button
                  type="button"
                  onClick={handleOpenExternally}
                  aria-label={`Open externally: ${path}`}
                  title={`Open with system default app: ${path}`}
                  className="text-[11px] font-mono transition-opacity hover:opacity-70"
                  style={{ color: 'var(--ink-dim)' }}
                >
                  ↗ open
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={`Copy path ${path}`}
                  title="Copy path"
                  className="text-[11px] font-mono transition-opacity hover:opacity-70"
                  style={{ color: 'var(--ink-dim)' }}
                >
                  ⧉
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close viewer"
              className="text-sm leading-none transition-opacity hover:opacity-70"
              style={{ color: 'var(--ink-dim)' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        {tab === 'file' ? (
          <FileBody file={file} onOpenExternally={handleOpenExternally} />
        ) : (
          <DiffBody diff={diff} narrowed={path !== undefined} />
        )}
      </div>
    </div>
  );
}

function FileBody({ file, onOpenExternally }: {
  file: Fetched<RunFileContent> | null;
  onOpenExternally: () => void;
}): React.ReactElement {
  if (file === null || file.state === 'loading') return <LoadingPane />;
  if (file.state === 'error') return <ErrorPane message={file.message} />;
  const { content, size, truncated, binary } = file.data;

  if (binary) {
    // Honest state — never mojibake (the route serves `content: ""` here).
    return (
      <div data-testid="viewer-binary" className="p-4 flex flex-col items-start gap-2">
        <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
          binary file — {formatBytes(size)}
        </p>
        <button
          type="button"
          onClick={onOpenExternally}
          className="text-[11px] font-mono transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          ↗ open externally
        </button>
      </div>
    );
  }

  const lines = content.split('\n');
  const numWidth = `${String(lines.length).length + 1}ch`;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {truncated && (
        <TruncationBanner
          text={`showing first 512 KB — open externally for the full file (${formatBytes(size)} total)`}
        />
      )}
      <div className="flex-1 overflow-auto">
        <pre className="m-0 p-3 min-w-max" style={CODE_STYLE}>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span
                className="shrink-0 text-right pr-3 select-none"
                aria-hidden="true"
                style={{ color: 'var(--ink-dim)', width: numWidth, userSelect: 'none' }}
              >
                {i + 1}
              </span>
              <span style={{ color: isDimLine(line) ? 'var(--ink-dim)' : 'var(--ink-body)' }}>
                {line}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function DiffBody({ diff, narrowed }: {
  diff: Fetched<RunDiff> | null;
  narrowed: boolean;
}): React.ReactElement {
  if (diff === null || diff.state === 'loading') return <LoadingPane />;
  if (diff.state === 'error') return <ErrorPane message={diff.message} />;
  const { diff: text, truncated } = diff.data;

  if (text === '') {
    // `diff: ""` is a real answer (clean tree), not an error (§3.3).
    return (
      <p data-testid="viewer-clean-tree" className="p-4 text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
        {narrowed ? 'no changes to this file.' : 'clean tree — no changes.'}
      </p>
    );
  }

  const lines = classifyDiff(text);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {truncated && (
        <TruncationBanner text="diff truncated at 1 MB — narrow to a single file for the rest" />
      )}
      <div className="flex-1 overflow-auto">
        <pre className="m-0 p-3 min-w-max" style={CODE_STYLE}>
          {lines.map((l, i) => (
            <div key={i} data-testid={DIFF_TESTID[l.kind]} className="px-1" style={DIFF_STYLE[l.kind]}>
              {l.text === '' ? ' ' : l.text}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
