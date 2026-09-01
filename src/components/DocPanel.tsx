import { useMemo, useState } from 'react';
import { postFork } from '../api/interactive.js';
import type { ForkResult, VersionEntry, VersionManifest } from '../api/interactive.js';
import { modePath, versionPath, type Navigate } from '../hooks/useRoute.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../store/docThread.js';
import { DeleteDocButton } from './DocDelete.js';
import { ExportMenu } from './ExportMenu.js';
import { ThemesMenu } from './ThemesMenu.js';
import { scrollThreadToMessage } from './threadAnchor.js';
import { anchorOf, anchorsFrom, forkedFrom, NO_ANCHOR_TITLE } from './VersionStrip.js';

// The Document surface's RIGHT PANEL (operator feedback, doc-feedback round) —
// one tabbed column that owns everything the bottom band used to carry besides
// the versions themselves. The operator's words, verbatim, each a requirement:
//
//   - "export should move under chat box in right panel"            → Chat tab,
//     the ExportMenu (slice-X point-of-action states intact, same testids)
//     rendered DIRECTLY UNDER the thread's composer;
//   - "Compare & Theme should become tabs on chat panel to right"   → the
//     Compare tab wears the slice-K lens controls (the panes stay the canvas
//     owner's), the Theme tab hosts the doc-scoped learn form inline;
//   - "make the right chat column have it's own expand/collapse"    → the
//     panel collapses to a RAIL (its own affordance — no strip toggle), and
//     the rail's tab buttons expand it straight onto a tab;
//   - the fork and in-thread gestures the band dropped SURVIVE HERE, in the
//     Versions tab's per-version actions (§0: a protected gesture moves, it
//     never silently dies).
//
// The Versions tab is built on REAL wire data only: the version manifest
// (`GET /d/:doc/api/versions` — versions.json verbatim: version, parent,
// feedback_file, html_file, created_at, meta.sourceMessageId when the bridge
// wrote one) plus the session's own thread anchors. The document workspace has
// NO git-history wire (verified against wicked-interactive server.js — the
// manifest loader reads versions.json and nothing else), so the tab SAYS the
// manifest is the history rather than dressing it up as commits.

const S = {
  bar:    'var(--surface-rail)',
  base:   'var(--surface-base)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  body:   'var(--ink-body)',
  muted:  'var(--ink-muted)',
  faint:  'var(--ink-dim)',
  accent: 'var(--accent)',
  selected: 'var(--accent-subtle)',
  danger: 'var(--status-fail)',
};

export type DocPanelTab = 'chat' | 'compare' | 'theme' | 'versions';

export const PANEL_TABS: { id: DocPanelTab; label: string; icon: string; title: string }[] = [
  { id: 'chat',     label: 'Chat',     icon: '💬', title: 'The conversation about this artifact' },
  { id: 'compare',  label: 'Compare',  icon: '⇆',  title: 'Put two versions side by side' },
  { id: 'theme',    label: 'Theme',    icon: '◩',  title: 'Borrow a look from a site, PDF, or image' },
  { id: 'versions', label: 'Versions', icon: '⑂',  title: 'Every version, with its lineage and actions' },
];

/**
 * The compare lens control surface (DES-FEEDBACK-002 §7, slice K — RE-HOMED
 * from the version strip by the doc-feedback round). The panel only WEARS the
 * state — the panes (and the state itself) are the canvas owner's
 * (DocumentCanvas), because comparing is a lens on the canvas, not an address
 * (§7.2: the left pane stays the `?v=N` navigation; the comparand is ephemeral
 * UI state).
 */
export interface CompareControl {
  /** Comparing right now. */
  active: boolean;
  /** The right pane's version (null only while inactive). */
  comparand: number | null;
  /** §7.5/§7.6 disabled-with-reason: non-null renders the toggle disabled with
   *  the reason as its title ("only one version exists" on a v1-only doc). */
  disabledReason: string | null;
  /** The `[▣ overlay]` sub-toggle inside compare (§7.2). */
  overlay: boolean;
  onToggle: () => void;
  onComparand: (version: number) => void;
  onOverlay: (on: boolean) => void;
  onExit: () => void;
}

/** Everything the doc-scoped tabs need. Null on the picker and while the
 *  manifest has not loaded — those tabs disable with a stated reason. */
export interface DocPanelDoc {
  projectId: string;
  docId: string;
  manifest: VersionManifest;
  /** The version the route resolved to — what Export addresses and Compare's
   *  left pane shows. */
  selected: number;
  navigate: Navigate;
  /** The service's fork result; the owner re-reads the manifest and routes to it. */
  onForked: (result: ForkResult) => void;
  compare: CompareControl;
  /** VIDEO-FB: the shown version's recorded video, when one EXISTS on the wire
   *  (the owner probes `/d/:id/api/demo/recording/_v<N>.webm` before offering).
   *  Rendered beside the export formats as a same-origin download. */
  recording?: { href: string; file: string } | null;
}

export interface DocPanelProps {
  open: boolean;
  tab: DocPanelTab;
  /** Expand the panel — straight onto `tab` when the rail button names one. */
  onExpand: (tab?: DocPanelTab) => void;
  onCollapse: () => void;
  onTab: (tab: DocPanelTab) => void;
  doc: DocPanelDoc | null;
  /** The surface's own noun (VIDEO-FB copy: a demo surface never says
   *  "document"). Defaults to the Document surface's. */
  subject?: 'document' | 'demo';
  /** The thread pane (DocumentThread) — the Chat tab's body. */
  children?: React.ReactNode;
}

function noDocReason(subject: 'document' | 'demo'): string {
  return `Open a ${subject} first — this tab acts on one ${subject}.`;
}

/** Oldest → newest for pickers; the detail list flips it (newest first). */
function byVersion(a: VersionEntry, b: VersionEntry): number {
  return a.version - b.version;
}

/** Full locale stamp for the detail rows; an unparseable stamp stays raw. */
function fullStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const NO_MSGS: DocMsg[] = [];

const TAB_BTN: React.CSSProperties = {
  background: 'transparent', border: 'none', borderBottom: '2px solid transparent',
  color: S.muted, cursor: 'pointer', fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-xs)', fontWeight: 600, lineHeight: 1.6, padding: '6px 9px',
};

const ACTION: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: 'var(--radius-sm)',
  color: S.muted, cursor: 'pointer', fontSize: 'var(--text-2xs)',
  fontFamily: 'var(--font-sans)', lineHeight: 1.6, padding: '1px 6px',
};

/** §6.4 segmented dress (compare cluster, carried over from the strip). */
const SEGMENT: React.CSSProperties = {
  background: 'transparent', border: 'none', borderRadius: 'var(--radius-md)',
  color: S.muted, cursor: 'pointer', fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-2xs)', lineHeight: 1.6, padding: '1px 7px',
};

// ── The Compare tab (slice K's controls, re-homed) ───────────────────────────

function CompareTab({ doc, subject }: { doc: DocPanelDoc; subject: 'document' | 'demo' }): React.ReactElement {
  const c = doc.compare;
  return (
    <div className="flex flex-col gap-2" style={{ padding: '10px 12px' }}>
      <p
        data-testid="compare-explainer"
        style={{ color: S.body, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)',
                 lineHeight: 1.4, margin: 0 }}
      >
        Put two versions of this {subject} side by side on the canvas — or stack
        them with adjustable opacity to spot layout shifts.
      </p>
      {!c.active && (
        <button
          type="button"
          data-testid="version-compare-toggle"
          disabled={c.disabledReason !== null}
          onClick={c.onToggle}
          title={c.disabledReason
            ?? `Compare v${doc.selected} with another version side by side`}
          style={{
            ...ACTION, alignSelf: 'flex-start',
            cursor: c.disabledReason !== null ? 'not-allowed' : 'pointer',
            opacity: c.disabledReason !== null ? 0.4 : 1,
            padding: '4px 10px',
          }}
        >
          ⇆ Compare
        </button>
      )}
      {c.active && c.comparand !== null && (
        <div
          data-testid="compare-controls"
          className="flex flex-col gap-1.5"
          style={{ border: `1px solid ${S.border}`, borderRadius: 'var(--radius-md)',
                   padding: '8px 10px' }}
        >
          <span style={{ color: S.ink, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)' }}>
            ⇆ Comparing v{doc.selected} ↔ v{c.comparand}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="compare-overlay-toggle"
              aria-pressed={c.overlay}
              onClick={() => c.onOverlay(!c.overlay)}
              title={c.overlay
                ? 'Back to the side-by-side split'
                : 'Stack the two versions with adjustable opacity — spot layout shifts'}
              style={{
                ...SEGMENT,
                background: c.overlay ? 'var(--surface-raised)' : 'transparent',
                border: `1px solid ${S.border}`,
                color: c.overlay ? S.ink : S.muted,
              }}
            >
              ▣ overlay
            </button>
            <label style={{
              alignItems: 'center', color: S.faint, display: 'inline-flex', gap: '4px',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)',
            }}>
              vs:
              <select
                data-testid="compare-vs"
                value={c.comparand}
                onChange={(e) => c.onComparand(Number(e.target.value))}
                title="Pick which version the right pane shows"
                style={{
                  background: 'var(--surface-raised)', border: `1px solid ${S.border}`,
                  borderRadius: 'var(--radius-sm)', color: S.ink,
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', padding: '0 2px',
                }}
              >
                {[...doc.manifest.versions].sort(byVersion)
                  .filter((e) => e.version !== doc.selected)
                  .map((e) => (
                    <option key={e.version} value={e.version}>v{e.version}</option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              data-testid="compare-exit"
              onClick={c.onExit}
              title="Exit compare — back to the solo canvas (Escape works too)"
              style={{ ...SEGMENT, border: `1px solid ${S.border}`, padding: '1px 6px' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The Versions tab — per-version detail off the manifest, plus the moved
//    fork / in-thread gestures ────────────────────────────────────────────────

/** The tab's honesty line, per surface noun (VIDEO-FB): the operator asked for
 *  git history; the workspace has none on any wire, and the manifest IS the record. */
export function versionsHistoryNote(subject: 'document' | 'demo'): string {
  return `From the ${subject}’s own version manifest — the ${subject} workspace keeps no `
    + 'git log, so this manifest is the history: number, lineage, timestamp, and '
    + 'the files each revision was built from.';
}

/** The Document surface's spelling, pinned verbatim by the docfb rig. */
export const VERSIONS_HISTORY_NOTE = versionsHistoryNote('document');

function lineageOf(entry: VersionEntry): string {
  if (entry.parent === null) return 'root — the first version';
  return forkedFrom(entry) !== null
    ? `branched from v${entry.parent}`
    : `continues v${entry.parent}`;
}

function VersionsTab({ doc, subject, onShowChat }: {
  doc: DocPanelDoc;
  subject: 'document' | 'demo';
  /** Switch the panel to the Chat tab — the In-thread action's whole point is
   *  the thread, and a scroll inside a hidden tab would be a silent no-op. */
  onShowChat: () => void;
}): React.ReactElement {
  const { projectId, docId, manifest, selected, navigate, onForked } = doc;
  const [forking, setForking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The same session-observed anchors the band's chiclet used (§7.6): the
  // manifest's meta first, the thread's own tagged messages otherwise.
  const msgs = useDocThreadStore((s) => s.messages[threadKey(projectId, docId)] ?? NO_MSGS);
  const anchorsByVersion = useMemo(() => anchorsFrom(msgs), [msgs]);

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

  function show(entry: VersionEntry): void {
    navigate(versionPath(projectId, docId, entry.version));
    const anchor = anchorOf(entry, anchorsByVersion);
    if (anchor !== null) scrollThreadToMessage(anchor);
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto" style={{ padding: '10px 12px' }}>
      <p
        data-testid="versions-history-note"
        style={{ color: S.faint, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-sans)',
                 lineHeight: 1.4, margin: 0 }}
      >
        {versionsHistoryNote(subject)}
      </p>
      {error !== null && (
        <span
          data-testid="version-fork-error"
          style={{ color: S.danger, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}
        >
          Fork failed: {error} — the document is unchanged; try again.
        </span>
      )}
      {[...manifest.versions].sort(byVersion).reverse().map((entry) => {
        const isSelected = entry.version === selected;
        const anchor = anchorOf(entry, anchorsByVersion);
        return (
          <div
            key={entry.version}
            data-testid="version-detail"
            data-version={entry.version}
            data-parent={entry.parent === null ? '' : entry.parent}
            data-selected={isSelected ? 'true' : 'false'}
            className="flex flex-col gap-1"
            style={{
              background: isSelected ? S.selected : 'transparent',
              border: `1px solid ${isSelected ? S.accent : S.border}`,
              borderRadius: 'var(--radius-md)', padding: '8px 10px',
            }}
          >
            <div className="flex items-center gap-2">
              <span style={{
                color: isSelected ? S.ink : S.muted, fontSize: 'var(--text-xs)',
                fontWeight: 600, fontFamily: 'var(--font-mono)',
              }}>
                v{entry.version}
              </span>
              <span data-testid="version-detail-stamp" style={{
                color: S.muted, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
              }}>
                {fullStamp(entry.created_at)}
              </span>
              {isSelected && (
                <span style={{ color: S.accent, fontSize: 'var(--text-2xs)',
                               fontFamily: 'var(--font-mono)' }}>
                  ● shown
                </span>
              )}
            </div>
            <span data-testid="version-detail-lineage" style={{
              color: S.muted, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
            }}>
              {lineageOf(entry)}
            </span>
            {/* The manifest's file record, verbatim fields: the rendered HTML and —
                when the revision came from a feedback pass — its feedback file. */}
            <span data-testid="version-detail-files" style={{
              color: S.faint, fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
            }}>
              {entry.html_file}
              {entry.feedback_file !== null ? ` · feedback: ${entry.feedback_file}` : ''}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                data-testid="version-detail-show"
                onClick={() => show(entry)}
                disabled={isSelected}
                title={isSelected
                  ? `v${entry.version} is on the canvas now`
                  : `Show version ${entry.version} on the canvas`}
                style={{ ...ACTION, opacity: isSelected ? 0.4 : 1,
                         cursor: isSelected ? 'default' : 'pointer' }}
              >
                Show
              </button>
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
                onClick={() => {
                  if (anchor === null) return;
                  onShowChat();
                  // The thread lives in the Chat tab's kept-mounted body, which is
                  // display:none right now — scroll on the frame AFTER React commits
                  // the tab switch, when the thread has geometry again.
                  requestAnimationFrame(() => { scrollThreadToMessage(anchor); });
                }}
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
      {/* The whole-artifact delete lives with the lineage it retires (studio#119):
          confirm-gated (the dialog names the doc and what a retire is), and a
          settled delete leaves the dead artifact — back to the mode's picker,
          which re-lists without the retired name. */}
      <div
        style={{ borderTop: `1px solid ${S.border}`, marginTop: '6px', paddingTop: '10px' }}
      >
        <DeleteDocButton
          projectId={projectId}
          docId={docId}
          subject={subject}
          variant="action"
          onDeleted={() =>
            navigate(modePath(projectId, subject === 'demo' ? 'video' : 'document'))}
        />
      </div>
    </div>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────

export function DocPanel({
  open, tab, onExpand, onCollapse, onTab, doc, subject = 'document', children,
}: DocPanelProps): React.ReactElement {
  const NO_DOC_REASON = noDocReason(subject);
  // Collapsed: the RAIL — the panel's own expand affordance, always on screen
  // (the strip carries no toggle any more). Each tab button expands straight
  // onto its tab; doc-scoped tabs are disabled with the stated reason.
  if (!open) {
    return (
      <div
        data-testid="doc-panel-rail"
        className="flex flex-col items-center gap-1"
        style={{ background: S.bar, borderLeft: `1px solid ${S.border}`,
                 flexShrink: 0, padding: '8px 0', width: '38px' }}
      >
        <button
          type="button"
          data-testid="panel-expand"
          aria-label="Expand the panel"
          title="Expand the panel"
          onClick={() => onExpand()}
          style={{ background: 'transparent', border: `1px solid ${S.border}`,
                   borderRadius: 'var(--radius-sm)', color: S.ink, cursor: 'pointer',
                   fontSize: 'var(--text-xs)', lineHeight: 1.4, padding: '2px 7px' }}
        >
          ◀
        </button>
        {PANEL_TABS.map((t) => {
          const needsDoc = t.id !== 'chat' && doc === null;
          return (
            <button
              key={t.id}
              type="button"
              data-testid="panel-rail-tab"
              data-tab={t.id}
              disabled={needsDoc}
              title={needsDoc ? NO_DOC_REASON : t.title}
              onClick={() => onExpand(t.id)}
              style={{ background: 'transparent', border: 'none', color: S.muted,
                       cursor: needsDoc ? 'not-allowed' : 'pointer',
                       fontSize: 'var(--text-sm)', opacity: needsDoc ? 0.35 : 1,
                       padding: '5px 0' }}
            >
              {t.icon}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="doc-panel"
      data-tab={tab}
      className="flex flex-col"
      style={{ background: S.base, borderLeft: `1px solid ${S.border}`, flexShrink: 0,
               minHeight: 0, overflow: 'hidden', width: 'min(440px, 40vw)' }}
    >
      <div
        role="tablist"
        className="flex items-center"
        style={{ background: S.bar, borderBottom: `1px solid ${S.border}`, flexShrink: 0 }}
      >
        {PANEL_TABS.map((t) => {
          const needsDoc = t.id !== 'chat' && doc === null;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-testid="panel-tab"
              data-tab={t.id}
              data-active={active ? 'true' : 'false'}
              aria-selected={active}
              disabled={needsDoc}
              title={needsDoc ? NO_DOC_REASON : t.title}
              onClick={() => onTab(t.id)}
              style={{
                ...TAB_BTN,
                borderBottomColor: active ? S.accent : 'transparent',
                color: active ? S.ink : S.muted,
                cursor: needsDoc ? 'not-allowed' : 'pointer',
                opacity: needsDoc ? 0.35 : 1,
              }}
            >
              {t.label}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="panel-collapse"
          aria-label="Collapse the panel"
          title="Collapse the panel"
          onClick={onCollapse}
          style={{ background: 'transparent', border: 'none', color: S.muted,
                   cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '4px 10px' }}
        >
          ▶
        </button>
      </div>

      {/* The CHAT tab stays MOUNTED whichever tab shows — the composer's draft,
          the send FIFO chips and the export answers under the chatbox must
          survive a tab switch (slice-T / slice-X state lives here). */}
      <div
        data-testid="panel-body"
        data-tab="chat"
        className="flex flex-col"
        style={{ display: tab === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}
      >
        {children}
        {/* Operator feedback, verbatim requirement: "export should move under
            chat box in right panel". The slice-X point-of-action contract rides
            along unchanged (same testids: export-format / export-pending /
            export-ready / export-hint) — the click site simply lives here now. */}
        {doc !== null && (
          <div
            data-testid="chat-export"
            style={{ background: S.bar, borderTop: `1px solid ${S.border}`,
                     flexShrink: 0, padding: '8px 14px' }}
          >
            <ExportMenu
              projectId={doc.projectId}
              docId={doc.docId}
              version={doc.selected}
              recording={doc.recording ?? null}
            />
          </div>
        )}
      </div>

      {/* THEME stays mounted too once a doc exists: a learn in flight keeps
          answering (EC37) across tab switches instead of losing its poll. */}
      {doc !== null && (
        <div
          data-testid="panel-body"
          data-tab="theme"
          className="flex-col overflow-y-auto"
          style={{ display: tab === 'theme' ? 'flex' : 'none', flex: 1, minHeight: 0 }}
        >
          <ThemesMenu projectId={doc.projectId} docId={doc.docId} inline />
        </div>
      )}

      {doc !== null && tab === 'compare' && (
        <div data-testid="panel-body" data-tab="compare" className="flex flex-col"
             style={{ flex: 1, minHeight: 0 }}>
          <CompareTab doc={doc} subject={subject} />
        </div>
      )}

      {doc !== null && tab === 'versions' && (
        <div data-testid="panel-body" data-tab="versions" className="flex flex-col"
             style={{ flex: 1, minHeight: 0 }}>
          <VersionsTab doc={doc} subject={subject} onShowChat={() => onTab('chat')} />
        </div>
      )}

      {/* A doc-scoped tab with no doc behind it (the manifest failed mid-session):
          the tab says why it is empty instead of rendering a blank (§1.4). */}
      {doc === null && tab !== 'chat' && (
        <div data-testid="panel-body" data-tab={tab} style={{ flex: 1, padding: '10px 12px' }}>
          <p data-testid="panel-needs-doc" style={{ color: S.muted, margin: 0,
             fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)' }}>
            {NO_DOC_REASON}
          </p>
        </div>
      )}
    </div>
  );
}
