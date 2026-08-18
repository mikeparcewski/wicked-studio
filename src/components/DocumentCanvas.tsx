import { useCallback, useEffect, useState } from 'react';
import {
  BridgeUnavailableError,
  getVersions,
  interactiveUrl,
  listDocs,
} from '../api/interactive.js';
import type { DocSummary } from '../api/interactive.js';
import { modePath, type Navigate } from '../hooks/useRoute.js';

// The Document-mode canvas (DES-MERGE-001 §1.3, §6.3 slice 8). Replaces the slice-4
// placeholder: with a doc in the route we frame it, without one we let the user pick.
//
// The frame carries the RENDERED DOCUMENT, never the interactive app (§5.3) — its src
// is built by the slice-2 client from `apiBase()`, so it resolves onto the page's own
// origin through crew's project-scoped proxy (§7.2). That is what keeps
// `contentDocument` reachable for the slice 11+12 overlay.

const S = {
  card:   '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  accent: '#ffda19',
  label:  'rgba(230,237,243,0.3)',
};

const PANEL: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px',
  padding: '20px 22px', maxWidth: '640px',
};

/** What the client failed with, flattened to the two things the UI renders (§3.3). */
interface Failure { message: string; hint?: string }

function asFailure(e: unknown): Failure {
  return e instanceof BridgeUnavailableError
    ? { message: e.message, hint: e.hint }
    : { message: e instanceof Error ? e.message : String(e) };
}

/** §3.3: a working state names its subject. Never a bare spinner, never "Loading…". */
function Loading({ subject }: { subject: string }): React.ReactElement {
  return (
    <div data-testid="doc-canvas-loading" style={{ padding: '32px', color: S.muted, fontSize: '13px' }}>
      Loading {subject}…
    </div>
  );
}

/**
 * §3.3: an error with no next action is banned. A `bridge_unavailable` 503 carries a
 * named install/fix command (§7.12) and it is shown VERBATIM — retyping it would be
 * retyping a command the user has to run. Everything else at least offers Retry.
 */
function Failed({
  subject, failure, onRetry,
}: { subject: string; failure: Failure; onRetry: () => void }): React.ReactElement {
  return (
    <div data-testid="doc-canvas-error" style={{ padding: '32px' }}>
      <div style={PANEL}>
        <p style={{ fontSize: '13px', color: S.ink, margin: '0 0 10px' }}>Could not load {subject}.</p>
        <p
          data-testid={failure.hint ? 'doc-bridge-hint' : 'doc-error-detail'}
          style={{
            fontSize: '13px', color: failure.hint ? S.ink : S.muted, margin: '0 0 14px',
            lineHeight: 1.5, borderLeft: `2px solid ${S.accent}`, paddingLeft: '10px',
          }}
        >
          {failure.hint ? <><strong>To fix:</strong> {failure.hint}</> : failure.message}
        </p>
        <button
          type="button"
          data-testid="doc-canvas-retry"
          onClick={onRetry}
          style={{
            background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '6px',
            color: S.ink, cursor: 'pointer', fontSize: '12px', padding: '6px 12px',
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/** One async load, re-runnable by Retry. Returns `[value, failure, retry]`. */
function useLoad<T>(load: () => Promise<T>, deps: React.DependencyList): [T | null, Failure | null, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState<T | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  useEffect(() => {
    let cancelled = false;
    setValue(null);
    setFailure(null);
    load().then(
      (v) => { if (!cancelled) setValue(v); },
      (e: unknown) => { if (!cancelled) setFailure(asFailure(e)); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is re-created per render; the caller declares the real deps
  }, [...deps, attempt]);
  return [value, failure, useCallback(() => setAttempt((n) => n + 1), [])];
}

// ── Doc picker — the mode with no `:docId` in the route ──────────────────────

/** Most-recent first (§6.3). The bridge already sorts; a null `updated_at` sinks. */
function byRecency(a: DocSummary, b: DocSummary): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

function DocPicker({ projectId, navigate }: { projectId: string; navigate: Navigate }): React.ReactElement {
  const [docs, failure, retry] = useLoad(() => listDocs(projectId), [projectId]);

  if (failure) return <Failed subject="this project's documents" failure={failure} onRetry={retry} />;
  if (docs === null) return <Loading subject="this project's documents" />;

  // §1.4's rule, applied to a surface: an empty region renders an invitation, never a
  // blank. Creation itself is slice 10, so the invitation points at the thread.
  if (docs.length === 0) {
    return (
      <div data-testid="doc-picker-empty" style={{ padding: '32px' }}>
        <div style={PANEL}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
            No documents in this project yet
          </h2>
          <p style={{ fontSize: '13px', color: S.muted, margin: 0, lineHeight: 1.5 }}>
            Ask for one in the thread — “make me a deck for the Q3 review”, “write this up as a
            report” — and it appears here, with its versions, as soon as it exists.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', overflowY: 'auto' }}>
      <p style={{
        fontSize: '11px', fontWeight: 600, color: S.label, margin: '0 0 10px',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        Documents
      </p>
      <div data-testid="doc-picker" style={{ ...PANEL, padding: 0, overflow: 'hidden' }}>
        {[...docs].sort(byRecency).map((doc, i, sorted) => (
          <button
            key={doc.name}
            type="button"
            data-testid="doc-picker-row"
            data-doc-id={doc.name}
            onClick={() => navigate(modePath(projectId, 'document', doc.name))}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none',
              borderBottom: i < sorted.length - 1 ? `1px solid ${S.border}` : 'none',
              color: S.ink, cursor: 'pointer', fontSize: '13px', padding: '12px 16px',
            }}
          >
            <span style={{ flex: 1, fontWeight: 500 }}>{doc.name}</span>
            <span style={{ color: S.muted, flexShrink: 0, fontSize: '12px' }}>
              {doc.kind} · v{doc.head}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Doc frame — the canvas itself ───────────────────────────────────────────

function DocFrame({ projectId, docId }: { projectId: string; docId: string }): React.ReactElement {
  const [manifest, failure, retry] = useLoad(
    () => getVersions(projectId, docId), [projectId, docId],
  );
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [projectId, docId]);

  const subject = `“${docId}”`;
  if (failure) return <Failed subject={subject} failure={failure} onRetry={retry} />;
  if (manifest === null) return <Loading subject={subject} />;

  // Version-addressed: slice 9's VersionStrip swaps this number, nothing else.
  const src = interactiveUrl(
    projectId,
    `/d/${encodeURIComponent(docId)}/doc/${manifest.head}`,
  );

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <iframe
        data-testid="doc-canvas"
        data-doc-id={docId}
        data-version={manifest.head}
        src={src}
        title={`Document ${docId}, version ${manifest.head}`}
        onLoad={() => setLoaded(true)}
        // §5.5 status quo: `allow-scripts` because documents ARE interactive HTML, and
        // `allow-same-origin` only until the slice 11+12 instrument bridge replaces the
        // overlay's contentDocument reads with postMessage — then this drops to
        // `allow-scripts` alone. Tracked there, not "someday".
        sandbox="allow-scripts allow-same-origin"
        style={{ border: 'none', display: 'block', height: '100%', width: '100%' }}
      />
      {/* The frame is in the DOM while it loads, so the named status sits over it. */}
      {loaded ? null : (
        <div style={{ background: '#0d1117', inset: 0, position: 'absolute' }}>
          <Loading subject={subject} />
        </div>
      )}
    </div>
  );
}

export interface DocumentCanvasProps {
  projectId: string;
  /** `null` on `/p/:projectId/document` — no doc chosen yet, so the picker shows. */
  docId: string | null;
  navigate: Navigate;
}

export function DocumentCanvas({ projectId, docId, navigate }: DocumentCanvasProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {docId === null
        ? <DocPicker projectId={projectId} navigate={navigate} />
        : <DocFrame key={`${projectId}/${docId}`} projectId={projectId} docId={docId} />}
    </div>
  );
}
