import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useRunModel } from '../hooks/useRunModel.js';
import type { RunModel } from '../hooks/useRunModel.js';
import { AssumptionsPanel } from './AssumptionsPanel.js';
import { Burn } from './Burn.js';
import { FileViewer } from './FileViewer.js';
import { CoverageView } from './CoverageView.js';
import { DataUsed } from './DataUsed.js';
import { DecisionsLedger } from './DecisionsLedger.js';
import { GovernanceAudit } from './GovernanceAudit.js';
import { Modal } from './Modal.js';
import { SteeringTimeline } from './SteeringTimeline.js';
import { Terminal } from './Terminal.js';
import { WhatWhere } from './WhatWhere.js';

interface Props {
  view: SessionView;
}

type AccordionId =
  | 'decisions'
  | 'governance'
  | 'burn'
  | 'data'
  | 'steering'
  | 'whatwhere'
  | 'assumptions'
  | 'files';

const ACCORDIONS: { id: AccordionId; label: string }[] = [
  { id: 'whatwhere', label: 'What / Where' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Burn' },
  { id: 'data', label: 'Data' },
  { id: 'steering', label: 'Steering' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'files', label: 'Files' },
];

/**
 * Tool names that indicate a file write/create/delete operation.
 * Derived from governance hook events (`governanceHookFired.toolName`).
 */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);
const DELETE_TOOLS: ReadonlySet<string> = new Set(['DeleteFile', 'Remove']);

type FileOpKind = 'write' | 'delete';

type FileFeedback = 'opened' | 'copied' | 'open-failed';

function FilePath({ path, opKind, runId }: { path: string; opKind?: FileOpKind; runId: string }): React.ReactElement {
  const [feedback, setFeedback] = useState<FileFeedback | null>(null);
  // Slice I (DES-FEEDBACK-002 §3.4): the row itself opens the INLINE viewer;
  // external-open (↗) and copy (⧉) move to hover-revealed row-end icons —
  // the same api.openPath / clipboard calls as before, byte-identical behavior.
  const [viewerOpen, setViewerOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current); }, []);
  const parts = path.replace(/\\/g, '/').split('/');
  const name = parts.pop() ?? path;
  const dir = parts.length > 0 ? `${parts.join('/')}/` : '';

  const glyph = opKind === 'delete' ? '−' : opKind === 'write' ? '±' : '~';
  const glyphColor =
    opKind === 'delete'
      ? 'var(--status-fail)'
      : opKind === 'write'
        ? 'var(--status-gate)'
        : 'var(--ink-dim)';
  const nameColor =
    opKind === 'delete'
      ? 'var(--status-fail)'
      : opKind === 'write'
        ? 'var(--ink-high)'
        : 'var(--ink-high)';

  function flash(state: FileFeedback): void {
    setFeedback(state);
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => { setFeedback(null); resetTimerRef.current = null; }, 2000);
  }

  function handleCopy(): void {
    void navigator.clipboard.writeText(path).then(() => {
      flash('copied');
    }).catch(() => { /* clipboard unavailable — silently ignore */ });
  }

  /**
   * Open with the OS default application (crew#273). The open happens DAEMON-side
   * (`POST /open` → `open`/`xdg-open`/`start`) — a browser SPA cannot spawn a
   * process. A daemon without the route 404s; fall back to copying the path so
   * the click still hands the operator something actionable.
   */
  function handleOpen(): void {
    api.openPath(path, runId)
      .then(() => flash('opened'))
      .catch(() => {
        void navigator.clipboard.writeText(path).catch(() => { /* clipboard unavailable */ });
        flash('open-failed');
      });
  }

  /** Escape / ✕ closes; focus returns to the row (§3.7). */
  function closeViewer(): void {
    setViewerOpen(false);
    rowRef.current?.focus();
  }

  /** A daemon WITHOUT the crew#305 routes: fall back to today's exact
   *  behavior — the external open (which itself copy-falls-back on 404). */
  function handleUnsupported(): void {
    setViewerOpen(false);
    rowRef.current?.focus();
    handleOpen();
  }

  return (
    <li title={path} className="group flex items-start gap-1.5 min-w-0">
      <span className="shrink-0 mt-0.5 text-[9px] font-mono select-none" style={{ color: glyphColor }}>
        {glyph}
      </span>
      <button
        type="button"
        ref={rowRef}
        onClick={() => setViewerOpen(true)}
        className="min-w-0 flex-1 leading-5 font-mono text-[10px] break-all text-left transition-opacity hover:opacity-70"
        title={`View ${path}`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        {dir && <span style={{ color: 'var(--ink-dim)' }}>{dir}</span>}
        <span style={{ color: nameColor }}>{name}</span>
        {feedback === 'opened' && (
          <span className="ml-1 text-[9px]" style={{ color: 'var(--status-run)' }}>✓ opened</span>
        )}
        {feedback === 'copied' && (
          <span className="ml-1 text-[9px]" style={{ color: 'var(--status-run)' }}>✓ copied</span>
        )}
        {feedback === 'open-failed' && (
          <span className="ml-1 text-[9px]" style={{ color: 'var(--status-gate)' }}>
            open unavailable — path copied
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Open externally: ${path}`}
        title={`Open with system default app: ${path}`}
        className="shrink-0 mt-0.5 text-[9px] font-mono leading-5 transition-opacity hover:opacity-70 opacity-0 group-hover:opacity-100 focus:opacity-100"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink-dim)' }}
      >
        ↗
      </button>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy path ${path}`}
        title="Copy path"
        className="shrink-0 mt-0.5 text-[9px] font-mono leading-5 transition-opacity hover:opacity-70 opacity-0 group-hover:opacity-100 focus:opacity-100"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink-dim)' }}
      >
        ⧉
      </button>
      {viewerOpen && (
        <FileViewer
          runId={runId}
          path={path}
          defaultTab={opKind !== undefined ? 'diff' : 'file'}
          onClose={closeViewer}
          onUnsupported={handleUnsupported}
        />
      )}
    </li>
  );
}

/**
 * The Term tab's transcript-first landing (DES-UX-001 §1.3-4, slice R): when a
 * run has captured unit output, a diagnosing operator lands on THAT — the
 * run's own transcript — not on an empty ungoverned shell. The operator shell
 * stays available as a labeled, secondary action.
 *
 * Fetches ride the same sanctioned wire the run view uses
 * (`GET /runs/:id/units/:unitKey/output`), gesture-gated on opening the modal.
 */
function RunTranscriptView({ runId, units, onOpenShell }: {
  runId: string;
  units: SessionView['units'];
  onOpenShell: () => void;
}): React.ReactElement {
  const captured = [...units]
    .filter((u) => u.status === 'done' || u.status === 'rejected')
    .sort((a, b) => a.ord - b.ord);
  const [texts, setTexts] = useState<Record<number, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    for (const unit of captured) {
      const unitKey = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
      void api
        .getUnitOutput(runId, unitKey)
        .then(({ output, outputUnavailable }) => {
          if (cancelled) return;
          setTexts((prev) => ({ ...prev, [unit.ord]: output ?? outputUnavailable ?? '(no transcript captured)' }));
        })
        .catch(() => {
          if (cancelled) return;
          setTexts((prev) => ({ ...prev, [unit.ord]: '(transcript unavailable)' }));
        });
    }
    return () => { cancelled = true; };
    // The captured set is derived from `units`; keying on runId + length keeps the
    // effect from re-firing per render while still refetching on a run switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, captured.length]);

  return (
    <div data-testid="term-transcript" className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
      {captured.map((unit) => (
        <div key={unit.id}>
          <p className="text-[10px] font-mono mb-1 uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>
            unit #{unit.ord} · {unit.stage} · {unit.status}
          </p>
          <pre
            className="rounded-lg p-2 text-[10px] leading-tight whitespace-pre-wrap font-mono overflow-x-auto"
            style={{ background: 'var(--surface-base)', color: 'var(--ink-body)' }}
          >
            {texts[unit.ord] ?? 'Loading…'}
          </pre>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--surface-raised)' }}>
        <button
          type="button"
          data-testid="term-open-shell"
          onClick={onOpenShell}
          className="text-[11px] font-mono underline transition-opacity hover:opacity-70"
          style={{ color: 'var(--ink-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          Open operator shell (ungoverned) instead
        </button>
      </div>
    </div>
  );
}

function FilesPanel({ model }: { model: RunModel }): React.ReactElement {
  const runId = model.session.id;
  // Slice I: the per-run [Full diff] button at the panel header (§3.4) — the
  // same viewer, whole-worktree diff (no path). Opens on the click, never
  // prefetches.
  const [fullDiffOpen, setFullDiffOpen] = useState(false);
  const [fullDiffUnsupported, setFullDiffUnsupported] = useState(false);
  const fullDiffBtnRef = useRef<HTMLButtonElement | null>(null);
  // Build sets of "write units" and "delete units" from governance hook fires.
  // governanceHookFired events carry toolName but not file paths, so we use a unit's
  // entire filesRead set as a proxy for "files touched by write operations".
  const writeUnitOrds = new Set<number>();
  const deleteUnitOrds = new Set<number>();
  for (const u of model.units) {
    for (const h of u.hookFires) {
      if (WRITE_TOOLS.has(h.toolName)) writeUnitOrds.add(u.ord);
      if (DELETE_TOOLS.has(h.toolName)) deleteUnitOrds.add(u.ord);
    }
  }

  // Collect files: a file is "modified" if it appears in any write/delete unit.
  // A file is "referenced only" if it appears only in pure-read units.
  const modifiedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const allFiles = new Set<string>();

  for (const u of model.units) {
    for (const f of u.filesRead) {
      allFiles.add(f);
      if (deleteUnitOrds.has(u.ord)) deletedFiles.add(f);
      else if (writeUnitOrds.has(u.ord)) modifiedFiles.add(f);
    }
  }

  // A file in both modified and deleted (across different units) is treated as deleted.
  for (const f of deletedFiles) modifiedFiles.delete(f);

  // "Referenced" = files that appear only in read units (not in any write/delete unit)
  const referencedFiles = new Set<string>();
  for (const f of allFiles) {
    if (!modifiedFiles.has(f) && !deletedFiles.has(f)) referencedFiles.add(f);
  }

  const hasModified = modifiedFiles.size > 0 || deletedFiles.size > 0;
  const hasAny = allFiles.size > 0;
  const isActive = !['completed', 'cancelled', 'failed'].includes(model.session.status);

  if (!hasAny) {
    return (
      <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
        {isActive ? 'No files changed yet.' : 'No files changed.'}
      </p>
    );
  }

  const sortedModified = [...modifiedFiles].sort();
  const sortedDeleted = [...deletedFiles].sort();
  const sortedReferenced = [...referencedFiles].sort();

  return (
    <div className="flex flex-col gap-4">
      {/* Panel header: the whole-run diff affordance (§3.4) */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          ref={fullDiffBtnRef}
          data-testid="files-full-diff"
          onClick={() => { setFullDiffUnsupported(false); setFullDiffOpen(true); }}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)', background: 'var(--accent-subtle)' }}
        >
          Full diff
        </button>
        {fullDiffUnsupported && (
          <span className="text-[9px] font-mono" style={{ color: 'var(--ink-dim)' }}>
            diff unavailable — this daemon predates the diff route
          </span>
        )}
      </div>

      {/* Modified / Created section */}
      {(hasModified || isActive) && (
        <div>
          <p className="text-[10px] font-mono mb-2 uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>
            Modified / Created
          </p>
          {!hasModified ? (
            <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
              No files changed yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sortedModified.map((f) => (
                <FilePath key={f} path={f} opKind="write" runId={runId} />
              ))}
              {sortedDeleted.map((f) => (
                <FilePath key={f} path={f} opKind="delete" runId={runId} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Referenced section */}
      {sortedReferenced.length > 0 && (
        <div>
          <p className="text-[10px] font-mono mb-2 uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>
            Referenced
          </p>
          <ul className="flex flex-col gap-1">
            {sortedReferenced.map((f) => (
              <FilePath key={f} path={f} runId={runId} />
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
        {allFiles.size} file{allFiles.size !== 1 ? 's' : ''} total
      </p>

      {fullDiffOpen && (
        <FileViewer
          runId={runId}
          defaultTab="diff"
          onClose={() => { setFullDiffOpen(false); fullDiffBtnRef.current?.focus(); }}
          onUnsupported={() => {
            setFullDiffOpen(false);
            setFullDiffUnsupported(true);
            fullDiffBtnRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

export function RightPanel({ view }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionId | null>('whatwhere');

  const [termOpen, setTermOpen] = useState(false);
  // Slice R (§1.3-4): the Term tab lands on the run's captured transcript when
  // one exists; the ungoverned operator shell is the labeled SECONDARY action.
  const [termShell, setTermShell] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  // Steering INPUT lives in the run thread's composer (ChatInput routes by run
  // state: inject while executing, gate-answer while awaiting_human). This panel
  // keeps only the read side — the SteeringTimeline accordion above.
  const { session } = view;
  const model = useRunModel(session.id, view);

  const fileCount = model
    ? new Set(model.units.flatMap((u) => u.filesRead)).size
    : null;

  function toggleAccordion(id: AccordionId): void {
    setOpenAccordion((prev) => (prev === id ? null : id));
  }

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center w-10 shrink-0 py-3 gap-2"
        style={{ background: 'var(--surface-base)', borderLeft: '1px solid var(--surface-raised)' }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-sm leading-none"
          style={{ color: 'var(--ink-dim)' }}
          aria-label="Expand insights panel"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setTermOpen(true)}
          title="Terminal"
          aria-label="Open terminal"
          className="w-7 h-7 flex items-center justify-center rounded text-sm"
          style={{ color: 'var(--ink-dim)' }}
        >
          ⬛
        </button>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          title="Coverage"
          aria-label="Open coverage"
          className="w-7 h-7 flex items-center justify-center rounded text-sm font-mono"
          style={{ color: 'var(--ink-dim)' }}
        >
          %
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-72 shrink-0 overflow-hidden"
      style={{ background: 'var(--surface-base)', borderLeft: '1px solid var(--surface-raised)' }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b shrink-0"
        style={{ background: 'var(--surface-base)', borderColor: 'var(--surface-raised)' }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          aria-label="Collapse insights panel"
        >
          <span className="text-sm leading-none shrink-0" style={{ color: 'var(--ink-dim)' }}>›</span>
          <span className="text-[10px] font-semibold uppercase tracking-widest font-mono" style={{ color: 'var(--ink-dim)' }}>
            Insights
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTermOpen(true)}
          title={view.units.some((u) => u.status === 'done' || u.status === 'rejected')
            ? "View this run's transcript"
            : 'Terminal'}
          aria-label={view.units.some((u) => u.status === 'done' || u.status === 'rejected')
            ? "View this run's transcript"
            : 'Open terminal'}
          className="rounded px-2 py-0.5 text-[11px] font-mono"
          style={{ color: 'var(--ink-muted)' }}
        >
          Term
        </button>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          title="Coverage"
          aria-label="Open coverage report"
          className="rounded px-2 py-0.5 text-[11px] font-mono"
          style={{ color: 'var(--ink-muted)' }}
        >
          Cov
        </button>
      </div>

      {/* Accordion sections */}
      <div className="flex-1 overflow-y-auto">
        {ACCORDIONS.map(({ id, label }) => (
          <div key={id} style={{ borderBottom: '1px solid var(--surface-raised)' }}>
            <button
              type="button"
              onClick={() => toggleAccordion(id)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
              style={{ color: openAccordion === id ? 'var(--ink-high)' : 'var(--ink-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-raised)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              aria-expanded={openAccordion === id}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium font-mono">{label}</span>
                {id === 'files' && fileCount !== null && fileCount > 0 && (
                  <span
                    className="text-[9px] font-mono px-1 py-0.5 rounded"
                    style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                  >
                    {fileCount}
                  </span>
                )}
              </div>
              <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>
                {openAccordion === id ? '▲' : '▼'}
              </span>
            </button>
            {openAccordion === id && model && (
              <div className="px-4 py-3" style={{ background: 'var(--surface-base)' }}>
                {id === 'decisions' && <DecisionsLedger model={model} />}
                {id === 'governance' && <GovernanceAudit model={model} />}
                {id === 'burn' && <Burn model={model} />}
                {id === 'data' && <DataUsed model={model} />}
                {id === 'steering' && <SteeringTimeline runId={model.session.id} />}
                {id === 'whatwhere' && <WhatWhere model={model} />}
                {id === 'assumptions' && <AssumptionsPanel model={model} />}
                {id === 'files' && <FilesPanel model={model} />}
              </div>
            )}
            {openAccordion === id && !model && (
              <div className="px-4 py-3">
                <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>Loading…</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Terminal modal — transcript-first when captured output exists (§1.3-4):
          a diagnosing operator lands on the run's own record, never on an empty
          shell by default. */}
      {termOpen && (() => {
        const hasCaptured = view.units.some((u) => u.status === 'done' || u.status === 'rejected');
        const showTranscript = hasCaptured && !termShell;
        return (
          <Modal
            title={showTranscript ? "This run's transcript" : 'Operator shell'}
            onClose={() => { setTermOpen(false); setTermShell(false); }}
            disableEscapeKey
          >
            {showTranscript ? (
              <RunTranscriptView
                runId={session.id}
                units={view.units}
                onOpenShell={() => setTermShell(true)}
              />
            ) : (
              <Terminal
                cwd={session.workdir ?? '.'}
                governed
              />
            )}
          </Modal>
        );
      })()}

      {/* Coverage modal */}
      {coverageOpen && (
        <Modal title="Coverage report" onClose={() => setCoverageOpen(false)}>
          <CoverageView />
        </Modal>
      )}
    </div>
  );
}
