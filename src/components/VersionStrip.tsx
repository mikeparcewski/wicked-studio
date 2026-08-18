import { useState } from 'react';
import { postFork } from '../api/interactive.js';
import type { ForkResult, VersionEntry, VersionManifest } from '../api/interactive.js';
import { versionPath, type Navigate } from '../hooks/useRoute.js';
import { scrollThreadToMessage } from './threadAnchor.js';

// The rewind / compare / fork surface (DES-MERGE-001 §4.2, §6.3 slice 9). The version
// manifest itself is EMBEDDED — parent-pointer lineage, write-once (INV-4) — so this
// surface only ever reads it and asks the service to branch it; it never mutates or
// re-derives lineage locally.
//
// Three properties this component is responsible for:
//   1. Selecting a version is a NAVIGATION (`?v=N`), not local state, so the frame it
//      swaps is deep-linkable and the back button rewinds the rewind.
//   2. Where the version carries `meta.sourceMessageId`, selecting it also puts the
//      message that produced it in view (§7.6). Where that anchor is null — every
//      pre-merge document — the affordance is DISABLED with a stated reason, because
//      the alternative is guessing, and a control that silently does nothing is worse.
//   3. A fork is the service's decision: `POST /d/:docId/api/fork` returns the new
//      version and its parent, and the strip re-reads the manifest rather than
//      predicting what the branch produced.

const S = {
  bar:      '#0f1419',
  border:   'rgba(230,237,243,0.1)',
  ink:      '#e6edf3',
  muted:    'rgba(230,237,243,0.55)',
  faint:    'rgba(230,237,243,0.3)',
  accent:   '#ffda19',
  selected: 'rgba(255,218,25,0.1)',
  danger:   '#f85149',
};

/** §7.6: no anchor recorded ⇒ nothing to scroll to, and the reason is the tooltip. */
const NO_ANCHOR_TITLE =
  'This version was committed without a source message, so there is nothing to scroll to. '
  + 'Documents created before the merge have no anchor.';

/** Compact, locale-formatted; an unparseable stamp falls back to what the manifest said. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Oldest → newest (§6.3). The manifest is append-only, but order is asserted, not assumed. */
function byVersion(a: VersionEntry, b: VersionEntry): number {
  return a.version - b.version;
}

/**
 * A BRANCH is a version whose parent is not the one immediately before it — the
 * lineage the linear strip cannot show positionally, so it is named instead.
 */
function forkedFrom(entry: VersionEntry): number | null {
  return entry.parent !== null && entry.parent !== entry.version - 1 ? entry.parent : null;
}

function anchorOf(entry: VersionEntry): string | null {
  return entry.meta?.sourceMessageId ?? null;
}

const ACTION: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '5px',
  color: S.muted, cursor: 'pointer', fontSize: '10px', lineHeight: 1.6, padding: '1px 6px',
};

export interface VersionStripProps {
  projectId: string;
  docId: string;
  manifest: VersionManifest;
  /** The version the route resolved to — always one the manifest knows. */
  selected: number;
  navigate: Navigate;
  /** The service's fork result; the owner re-reads the manifest and routes to it. */
  onForked: (result: ForkResult) => void;
}

export function VersionStrip({
  projectId, docId, manifest, selected, navigate, onForked,
}: VersionStripProps): React.ReactElement {
  const [forking, setForking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function select(entry: VersionEntry): void {
    navigate(versionPath(projectId, docId, entry.version));
    // The cross-link rides ALONG with the selection (§7.6) — the frame swap does not
    // depend on it, so a thread that is not on screen (Document mode's own thread is
    // slice 10) costs the user nothing.
    const anchor = anchorOf(entry);
    if (anchor !== null) scrollThreadToMessage(anchor);
  }

  async function fork(entry: VersionEntry): Promise<void> {
    setForking(entry.version);
    setError(null);
    try {
      const result = await postFork(projectId, docId, entry.version);
      onForked(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setForking(null);
    }
  }

  return (
    <div
      data-testid="version-strip"
      style={{
        alignItems: 'stretch', background: S.bar, borderTop: `1px solid ${S.border}`,
        display: 'flex', flexShrink: 0, gap: '8px', overflowX: 'auto', padding: '10px 12px',
      }}
    >
      <span style={{
        alignSelf: 'center', color: S.faint, flexShrink: 0, fontSize: '10px', fontWeight: 600,
        letterSpacing: '0.06em', paddingRight: '2px', textTransform: 'uppercase',
      }}>
        Versions
      </span>

      {[...manifest.versions].sort(byVersion).map((entry) => {
        const isSelected = entry.version === selected;
        const branchOf = forkedFrom(entry);
        const anchor = anchorOf(entry);
        return (
          <div
            key={entry.version}
            data-testid="version-entry"
            data-version={entry.version}
            data-parent={entry.parent === null ? '' : entry.parent}
            data-selected={isSelected ? 'true' : 'false'}
            style={{
              background: isSelected ? S.selected : 'transparent',
              border: `1px solid ${isSelected ? S.accent : S.border}`,
              borderRadius: '7px', display: 'flex', flexDirection: 'column', flexShrink: 0,
              gap: '4px', minWidth: '124px', padding: '6px 9px',
            }}
          >
            <button
              type="button"
              data-testid="version-select"
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => select(entry)}
              title={`Show version ${entry.version}`}
              style={{
                background: 'transparent', border: 'none', color: S.ink, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: '2px', padding: 0, textAlign: 'left',
              }}
            >
              <span style={{
                color: isSelected ? S.accent : S.ink, fontSize: '12px', fontWeight: 600,
              }}>
                v{entry.version}
              </span>
              <span data-testid="version-stamp" style={{ color: S.muted, fontSize: '10px' }}>
                {stamp(entry.created_at)}
              </span>
            </button>

            {branchOf !== null && (
              <span data-testid="version-lineage" style={{ color: S.accent, fontSize: '10px' }}>
                continues from v{branchOf}
              </span>
            )}

            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                type="button"
                data-testid="version-fork"
                onClick={() => void fork(entry)}
                disabled={forking !== null}
                title={`Fork a new version from v${entry.version} — the original stays untouched`}
                style={{ ...ACTION, opacity: forking !== null ? 0.5 : 1 }}
              >
                {forking === entry.version ? 'Forking…' : 'Fork'}
              </button>
              <button
                type="button"
                data-testid="version-scroll"
                onClick={() => { if (anchor !== null) scrollThreadToMessage(anchor); }}
                disabled={anchor === null}
                title={anchor === null
                  ? NO_ANCHOR_TITLE
                  : 'Scroll the thread to the message that produced this version'}
                style={{ ...ACTION, cursor: anchor === null ? 'not-allowed' : 'pointer',
                         opacity: anchor === null ? 0.4 : 1 }}
              >
                In thread
              </button>
            </div>
          </div>
        );
      })}

      {error !== null && (
        <span
          data-testid="version-fork-error"
          style={{ alignSelf: 'center', color: S.danger, fontSize: '11px', paddingLeft: '4px' }}
        >
          Fork failed: {error} — the document is unchanged; try again.
        </span>
      )}
    </div>
  );
}
