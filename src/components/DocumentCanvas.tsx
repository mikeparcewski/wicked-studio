import { useEffect, useState } from 'react';
import { getVersions, interactiveUrl, listDocs } from '../api/interactive.js';
import type { DocSummary, ForkResult, VersionManifest } from '../api/interactive.js';
import { modePath, versionPath, type Navigate } from '../hooks/useRoute.js';
import { FeedbackOverlay } from './FeedbackOverlay.js';
import { Failed, Loading, PANEL, S, useLoad } from './SurfaceState.js';
import { VersionStrip } from './VersionStrip.js';

// The Document-mode canvas (DES-MERGE-001 §1.3, §6.3 slice 8, tightened by slices 11+12).
// With a doc in the route we frame it, without one we let the user pick.
//
// The frame carries the RENDERED DOCUMENT, never the interactive app (§5.3) — its src
// is built by the slice-2 client from `apiBase()`, so it resolves onto the page's own
// origin through crew's project-scoped proxy (§7.2).
//
// §5.5, closed: agent-authored HTML is influenced by untrusted input (attached sources,
// scraped pages), so the frame is FULLY sandboxed — `allow-scripts` and nothing else. It
// cannot read `localStorage`, cannot call `/api/v1` with the user's ambient authority,
// and the parent cannot read `contentDocument` back. Everything the overlay needs comes
// over the instrument bridge instead (§7.3: the overlay never shipped without it).

// ── Doc picker — the mode with no `:docId` in the route ──────────────────────

/** Most-recent first (§6.3). The bridge already sorts; a null `updated_at` sinks. */
function byRecency(a: DocSummary, b: DocSummary): number {
  return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
}

function DocPicker({ projectId, navigate }: { projectId: string; navigate: Navigate }): React.ReactElement {
  const [docs, failure, retry] = useLoad(() => listDocs(projectId), [projectId]);

  if (failure) return <Failed surface="doc" subject="this project's documents" failure={failure} onRetry={retry} />;
  if (docs === null) return <Loading surface="doc" subject="this project's documents" />;

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

/** The version the route asks for, narrowed to one the manifest actually has (§4.2:
 *  the manifest is authoritative). An unknown `?v` — a stale bookmark, a doc rebuilt
 *  elsewhere — resolves to the head rather than framing a 404. */
function resolveVersion(manifest: VersionManifest, routed: number | null): number {
  return routed !== null && manifest.versions.some((v) => v.version === routed)
    ? routed
    : manifest.head;
}

function DocFrame({
  projectId, docId, version, navigate,
}: {
  projectId: string; docId: string; version: number | null; navigate: Navigate;
}): React.ReactElement {
  const [manifest, failure, retry] = useLoad(
    () => getVersions(projectId, docId), [projectId, docId],
  );
  const [loaded, setLoaded] = useState(false);
  // The overlay's instrumentation handshake is keyed to LOADS, not to renders: every
  // swapped version is a different document with a different inventory (§4.3 / INV-1
  // guarantees a wid survives WITHIN a document's lineage, not that rects do).
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  useEffect(() => { setLoaded(false); }, [projectId, docId, version]);

  const subject = `“${docId}”`;
  if (failure) return <Failed surface="doc" subject={subject} failure={failure} onRetry={retry} />;
  if (manifest === null) return <Loading surface="doc" subject={subject} />;

  const shown = resolveVersion(manifest, version);
  // Version-addressed: the VersionStrip swaps this number through the route, nothing else.
  const src = interactiveUrl(
    projectId,
    `/d/${encodeURIComponent(docId)}/doc/${shown}`,
  );

  // A fork is committed by the service, so the strip re-reads the manifest (`retry`
  // is that same one load) and routes to the version the service reports — the UI
  // never invents the new version number or its parent.
  const onForked = (result: ForkResult): void => {
    retry();
    navigate(versionPath(projectId, docId, result.version));
  };

  return (
    <>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <iframe
        // Keyed on the VERSION so a swap REPLACES the element instead of mutating its
        // src. Mutating it navigates the frame, and a frame navigation lands in the
        // joint session history — so Back undid the frame's move rather than the route's
        // (§4.2: the version lives in the URL, and Back must rewind it in one press).
        // A freshly created frame's first load replaces its own entry instead.
        key={shown}
        ref={setFrameEl}
        data-testid="doc-canvas"
        data-doc-id={docId}
        data-version={shown}
        src={src}
        title={`Document ${docId}, version ${shown}`}
        onLoad={() => { setLoaded(true); setLoadNonce((n) => n + 1); }}
        // §5.5, §7.3: `allow-scripts` because documents ARE interactive HTML, and NOTHING
        // else. `allow-same-origin` is not "not yet" here — it is gone, and the overlay
        // below is what made removing it possible. Pinned by a regression test.
        sandbox="allow-scripts"
        style={{ border: 'none', display: 'block', height: '100%', width: '100%' }}
      />
      {/* The frame is in the DOM while it loads, so the named status sits over it. */}
      {loaded ? null : (
        <div style={{ background: '#0d1117', inset: 0, position: 'absolute' }}>
          <Loading surface="doc" subject={subject} />
        </div>
      )}
      {/* Point-and-comment (§4.3). A document whose bridge never answers leaves this
          disabled-with-a-reason; the canvas above is unaffected either way. */}
      <FeedbackOverlay
        frame={frameEl}
        loadNonce={loadNonce}
        projectId={projectId}
        docId={docId}
        version={shown}
      />
      </div>
      <VersionStrip
        projectId={projectId}
        docId={docId}
        manifest={manifest}
        selected={shown}
        navigate={navigate}
        onForked={onForked}
      />
    </>
  );
}

export interface DocumentCanvasProps {
  projectId: string;
  /** `null` on `/p/:projectId/document` — no doc chosen yet, so the picker shows. */
  docId: string | null;
  /** The routed `?v=N` (slice 9); `null` addresses the manifest head. */
  version?: number | null;
  navigate: Navigate;
}

export function DocumentCanvas({
  projectId, docId, version = null, navigate,
}: DocumentCanvasProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {docId === null
        ? <DocPicker projectId={projectId} navigate={navigate} />
        : (
          <DocFrame
            key={`${projectId}/${docId}`}
            projectId={projectId}
            docId={docId}
            version={version}
            navigate={navigate}
          />
        )}
    </div>
  );
}
