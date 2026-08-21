import { useState } from 'react';
import { postFork } from '../api/interactive.js';
import type { ForkResult, VersionEntry, VersionManifest } from '../api/interactive.js';
import { versionPath, type Navigate } from '../hooks/useRoute.js';
import { ExportMenu } from './ExportMenu.js';
import { ThemesMenu } from './ThemesMenu.js';
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
//
// DES-UXFIX-001 §2.6 (slice 6): the strip is drawn as the SPINE — its owner mounts it
// spanning canvas and thread, the accent rule along its top is the drawn connection, and
// it says in one line what selecting a version does (rule 1: the connective tissue is
// labelled by what it does). The canvas toolbar it carries is [Themes] [Export] — the
// two actions that act on the document at the addressed version (rule 4, V19).

// DES-VISION-001 §5.5 token usage: the strip is --surface-rail; the SELECTION
// speaks the brand accent (it is the product's own pointer at which version is
// addressed — an affordance, never a run state), and failures speak the §2.6
// status layer. Version numbers and stamps are data, so they read in the mono
// (§2.8); the spine caption is prose, so it reads in the sans.
const S = {
  bar:      'var(--surface-rail)',
  border:   'var(--surface-raised)',
  ink:      'var(--ink-high)',
  muted:    'var(--ink-muted)',
  faint:    'var(--ink-dim)',
  accent:   'var(--accent)',
  selected: 'var(--accent-subtle)',
  danger:   'var(--status-fail)',
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
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: 'var(--radius-sm)',
  color: S.muted, cursor: 'pointer', fontSize: 'var(--text-2xs)',
  fontFamily: 'var(--font-sans)', lineHeight: 1.6, padding: '1px 6px',
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
      // The spine's drawn connection (DES-UXFIX-001 §2.6) now speaks the brand
      // accent's subtle tier — connective tissue, not a status signal (§2.5).
      style={{
        alignItems: 'stretch', background: S.bar,
        borderTop: '2px solid var(--accent-subtle)',
        display: 'flex', flexShrink: 0, gap: '8px', padding: '10px 12px',
      }}
    >
      {/* The versions scroll; the export control does NOT — a doc with 20 versions must
          not push its own export off the right edge of the surface that addresses it. */}
      <div style={{ alignItems: 'stretch', display: 'flex', flex: 1, gap: '8px',
                    minWidth: 0, overflowX: 'auto' }}>
      <span style={{
        alignSelf: 'center', color: S.faint, flexShrink: 0, fontSize: 'var(--text-2xs)',
        fontWeight: 600, fontFamily: 'var(--font-mono)',
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
              borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column',
              flexShrink: 0, gap: '4px', minWidth: '124px', padding: '6px 9px',
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
              {/* v-numbers and stamps are data → the mono (§2.8). The SELECTED
                  entry carries the §5.5 "active version dot": background from
                  var(--accent) — the one place the wireframe's ● lives. */}
              <span style={{
                alignItems: 'center', display: 'inline-flex', gap: '5px',
                color: isSelected ? S.ink : S.muted, fontSize: 'var(--text-xs)',
                fontWeight: 600, fontFamily: 'var(--font-mono)',
              }}>
                {isSelected && (
                  <span
                    data-testid="version-active-dot"
                    style={{
                      background: S.accent, borderRadius: 'var(--radius-full)',
                      display: 'inline-block', flexShrink: 0, height: '6px', width: '6px',
                    }}
                  />
                )}
                v{entry.version}
              </span>
              <span data-testid="version-stamp" style={{
                color: S.muted, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              }}>
                {stamp(entry.created_at)}
              </span>
            </button>

            {branchOf !== null && (
              <span data-testid="version-lineage" style={{
                color: S.muted, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              }}>
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
          style={{
            alignSelf: 'center', color: S.danger, fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)', paddingLeft: '4px',
          }}
        >
          Fork failed: {error} — the document is unchanged; try again.
        </span>
      )}
      </div>

      {/* §2.6 rule 1: the spine is labelled by what it does. This caption sits at the
          strip's thread-side end, pointing the eye at the pane the selection scrolls. */}
      <span
        data-testid="version-spine-caption"
        style={{
          alignSelf: 'center', color: S.faint, flexShrink: 1, fontSize: 'var(--text-2xs)',
          fontFamily: 'var(--font-sans)', lineHeight: 1.3, maxWidth: '210px',
          minWidth: 0, textAlign: 'right',
        }}
      >
        selecting a version scrolls the thread to the message that made it ▸
      </span>

      {/* The canvas toolbar (§2.6 rule 4): [Themes] [Export], acting on the document. */}
      <ThemesMenu projectId={projectId} docId={docId} />

      {/* §4.4: export is PER-VERSION, so it belongs to the surface that owns which version
          is addressed. The selection is the subject — exporting "the document" would be
          exporting whichever version happened to be head when the button was pressed. */}
      <ExportMenu projectId={projectId} docId={docId} version={selected} />
    </div>
  );
}
