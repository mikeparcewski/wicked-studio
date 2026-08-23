import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, apiWire, isRouteAbsent } from '../api/client.js';
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
 * Route errors (400/403/404/409/507) surface — never swallowed — carrying the
 * daemon's own sentence inside the EC33 translated frame (slice X2: "the
 * daemon refused this — …", never the raw `API NNN:` framing). The one
 * exception is the forward-compat contract every studio wire follows: a
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

/**
 * The diff's own fetch state (slice R, DES-UX-001 §1.3-4). Distinct from
 * {@link Fetched} because the diff path owes the operator two more honest
 * answers: a NAMED CAUSE for the daemon's 409s (never the raw wire string),
 * and a TIMEOUT branch so a never-resolving request shows "Couldn't load the
 * diff — retry" instead of an eternal "Loading…".
 */
type DiffFetched =
  | { state: 'loading' }
  | { state: 'timeout' }
  | { state: 'cause'; cause: 'no-repo' | 'workdir-gone' }
  | { state: 'error'; message: string }
  | { state: 'ok'; data: RunDiff };

/** Budget for a diff request to resolve before the honest error branch shows. */
export const DIFF_TIMEOUT_MS = 8000;

/**
 * Map the daemon's diff refusals to their named causes (routes.ts crew#305):
 * `run <id> has no workdir — nothing to diff` (409, repo-less run) and
 * `run <id>'s workdir no longer exists: <path>` (409, reaped worktree). The
 * raw `API 409` / `has no workdir` strings NEVER reach the DOM (EC33).
 * Classified on the shared layer's VERBATIM `wire` sentence (slice X2 —
 * `ApiError.message` is already translated; matchers never parse it).
 */
function diffCauseOf(wire: string): 'no-repo' | 'workdir-gone' | null {
  if (/has no workdir/.test(wire)) return 'no-repo';
  if (/workdir no longer exists/.test(wire)) return 'workdir-gone';
  return null;
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
  const [diff, setDiff] = useState<DiffFetched | null>(null);
  /** Bumped by the retry affordance: resets `diff` so the fetch effect re-fires. */
  const [diffAttempt, setDiffAttempt] = useState(0);

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

  // The diff fetch (slice R rewrite — DES-UX-001 §1.3-4b). The old shape could
  // strand the pane on "Loading…" with NO request ever dispatched (the
  // zero-request hang, brief A1 dead-end 3). This one:
  //  - dispatches the request SYNCHRONOUSLY inside the effect, on every
  //    activation while unfetched (`diff === null`), so a mounted diff tab
  //    always has ≥1 attempted fetch behind it;
  //  - races it against DIFF_TIMEOUT_MS so a never-resolving request lands in
  //    an honest, retryable error state instead of an eternal spinner;
  //  - names the daemon's 409 causes instead of surfacing the raw wire string.
  // One fetch per (run, path, attempt): keyed through a ref, NOT through the
  // `diff` state — the old state-guarded shape could cancel its own in-flight
  // request when the effect re-ran on its own setState. No cleanup either: a
  // late resolution lands harmlessly (React no-ops setState after unmount),
  // and the timer stays live so a hung request ALWAYS reaches the error state.
  const diffFetchKey = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== 'diff') return;
    const key = `${runId} ${path ?? ''} ${diffAttempt}`;
    if (diffFetchKey.current === key) return;
    diffFetchKey.current = key;
    let settled = false;
    setDiff({ state: 'loading' });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setDiff({ state: 'timeout' });
    }, DIFF_TIMEOUT_MS);
    api.getRunDiff(runId, path)
      .then((data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setDiff({ state: 'ok', data });
      })
      .catch((e: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (isRouteAbsent(e)) { onUnsupported(); return; }
        const message = e instanceof Error ? e.message : String(e);
        const cause = diffCauseOf(apiWire(e) ?? '');
        setDiff(cause !== null ? { state: 'cause', cause } : { state: 'error', message });
      });
  }, [tab, path, runId, diffAttempt, onUnsupported]);

  /** The retry affordance: clear the state so the effect re-dispatches. */
  function retryDiff(): void {
    setDiff(null);
    setDiffAttempt((n) => n + 1);
  }

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
          <DiffBody diff={diff} narrowed={path !== undefined} onRetry={retryDiff} onClose={onClose} />
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

/**
 * The named-cause card (DES-UX-001 §1.3-4a): the daemon's 409 refusals become
 * operator answers with a remediation, on `--surface-raised` with `--ink-muted`
 * body and an `--accent` remediation link (§1.4). The raw wire strings never
 * render — the cause card IS the translation (EC33).
 */
function DiffCauseCard({ cause, onClose }: {
  cause: 'no-repo' | 'workdir-gone';
  onClose: () => void;
}): React.ReactElement {
  const headline =
    cause === 'no-repo'
      ? 'This run had no repository attached — nothing was produced to review.'
      : 'This run’s workdir no longer exists.';
  const body =
    cause === 'no-repo'
      ? 'The run executed without a workdir, so there is no worktree to diff. Its captured unit transcripts are the record of what it did.'
      : 'The worktree was cleaned up after the run ended. The captured unit transcripts and evidence remain the durable record.';
  const remediation =
    cause === 'no-repo'
      ? 'Attach a repository at launch to make future runs reviewable — for this one, review the captured transcripts on the run page.'
      : 'Review the captured transcripts on the run page.';
  return (
    <div
      data-testid="diff-named-cause"
      data-cause={cause}
      className="m-4 rounded-lg p-4 flex flex-col gap-2 self-start"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--surface-raised)' }}
    >
      <p className="text-xs font-semibold font-mono" style={{ color: 'var(--ink-muted)' }}>{headline}</p>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{body}</p>
      <button
        type="button"
        data-testid="diff-cause-remediation"
        onClick={onClose}
        className="self-start text-xs font-mono underline transition-opacity hover:opacity-70"
        style={{ color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        {remediation}
      </button>
    </div>
  );
}

/**
 * The honest interim baseline label (DES-UX-001 §8.1): until CREW-UX-1 lands a
 * branch-vs-base diff, the daemon diffs the working tree against HEAD — so a
 * run's COMMITTED work is invisible here by construction. Say so, always,
 * rather than letting "no changes" read as "did nothing".
 */
function BaselineNote(): React.ReactElement {
  return (
    <p
      data-testid="diff-baseline-note"
      className="px-3 py-1.5 text-[10px] font-mono shrink-0"
      style={{ color: 'var(--ink-dim)', borderBottom: '1px solid var(--surface-raised)' }}
    >
      showing uncommitted changes vs HEAD; committed work is not shown here
    </p>
  );
}

function DiffBody({ diff, narrowed, onRetry, onClose }: {
  diff: DiffFetched | null;
  narrowed: boolean;
  onRetry: () => void;
  onClose: () => void;
}): React.ReactElement {
  if (diff === null || diff.state === 'loading') return <LoadingPane />;
  if (diff.state === 'timeout') {
    // §1.3-4b: a never-resolving diff lands HERE within the timeout budget —
    // never an indefinite "Loading…". The request WAS dispatched; retry re-fires it.
    return (
      <div data-testid="diff-error" className="p-4 flex flex-col items-start gap-2">
        <p className="text-xs font-mono" style={{ color: 'var(--status-fail)' }}>
          Couldn&apos;t load the diff — the daemon did not answer in time.
        </p>
        <button
          type="button"
          data-testid="diff-retry"
          onClick={onRetry}
          className="text-xs font-mono underline transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (diff.state === 'cause') return <DiffCauseCard cause={diff.cause} onClose={onClose} />;
  if (diff.state === 'error') return <ErrorPane message={diff.message} />;
  const { diff: text, truncated } = diff.data;

  if (text === '') {
    // `diff: ""` is a real answer (clean tree), not an error (§3.3) — but under
    // the HEAD baseline it only means "no UNCOMMITTED changes" (§8.1).
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <BaselineNote />
        <p data-testid="viewer-clean-tree" className="p-4 text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
          {narrowed ? 'no changes to this file.' : 'clean tree — no changes.'}
        </p>
      </div>
    );
  }

  const lines = classifyDiff(text);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <BaselineNote />
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
