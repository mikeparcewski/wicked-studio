import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { executingOrd } from '../api/run-state.js';
import type { SessionView } from '../api/types.js';
import { useRunModel } from '../hooks/useRunModel.js';
import type { RunModel } from '../hooks/useRunModel.js';
import { useProvenanceStore } from '../store/provenance.js';
import { useIsSystemWorkflow } from '../store/workflowCache.js';
import { AssumptionsPanel } from './AssumptionsPanel.js';
import { LiveNarration } from './ChatPanel.js';
import { canDeliver } from './delivery.js';
import { Burn } from './Burn.js';
import { FileViewer } from './FileViewer.js';
import { CoverageView } from './CoverageView.js';
import { DataUsed } from './DataUsed.js';
import { DecisionsLedger } from './DecisionsLedger.js';
import { GovernanceAudit } from './GovernanceAudit.js';
import { Modal } from './Modal.js';
import { DeliveryBadge, RunDelivery } from './RunDelivery.js';
import { SteeringTimeline } from './SteeringTimeline.js';
import { Terminal } from './Terminal.js';
import { WhatWhere } from './WhatWhere.js';

interface Props {
  view: SessionView;
  /** The loaded run index (App's one `useRuns()` array) — forward lineage only, no new fetch. */
  runs?: SessionView[];
  onSelectRun?: (id: string) => void;
}

type AccordionId =
  | 'decisions'
  | 'governance'
  | 'burn'
  | 'data'
  | 'steering'
  | 'whatwhere'
  | 'assumptions'
  | 'files'
  | 'delivery';

/**
 * The rail's sections. The contract is **nine on a run that can deliver, eight
 * on every run that cannot** — chat threads, the other system workflows, and
 * freeform runs, per `canDeliver`. There is no fixed count of nine: `delivery`
 * is the conditional ninth, and a surface that says otherwise is describing
 * build runs only.
 *
 * Delivery is a section like every other — not a pinned band above the list,
 * not a tablist — because "delivery isn't a top level class, it goes in the
 * right chat panel as a tab" (operator decision 2026-08-24), and the rail's
 * one-open-at-a-time `openAccordion` IS that tab behaviour. `whatwhere` keeps
 * the default open slot; the at-a-glance signal the band would have bought back
 * lives on the Delivery header's {@link DeliveryBadge} instead, which is legible
 * with no gesture.
 *
 * `files` reads "Files referenced" for the reason the caption in
 * {@link FilesPanel} spells out: the panel counts what the agents TOUCHED, which
 * is not a changeset and never was (run 665a9aeb reported 13 under
 * "MODIFIED / CREATED" while its deliver phase pushed an empty branch).
 */
const ACCORDIONS: { id: AccordionId; label: string }[] = [
  { id: 'whatwhere', label: 'What / Where' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'governance', label: 'Governance' },
  { id: 'burn', label: 'Burn' },
  { id: 'data', label: 'Data' },
  { id: 'steering', label: 'Steering' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'files', label: 'Files referenced' },
  { id: 'delivery', label: 'Delivery' },
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

/**
 * §7.10 (slice X2): Files rows render WORKTREE-RELATIVE paths — the 5-line
 * absolute /private/var wrap retires from the visible text. Only the display
 * changes: `path` stays absolute for the viewer fetch, external open, copy,
 * and every `title`/aria attribute (the full path is one hover away).
 */
function relativeToRoot(path: string, root: string | undefined): string {
  if (root === undefined || root === '') return path;
  const norm = path.replace(/\\/g, '/');
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm === rootNorm) return '.';
  return norm.startsWith(`${rootNorm}/`) ? norm.slice(rootNorm.length + 1) : path;
}

function FilePath({ path, opKind, runId, root }: {
  path: string; opKind?: FileOpKind; runId: string;
  /** The run's worktree root (`session.workdir`) — the display-relativity base. */
  root?: string | undefined;
}): React.ReactElement {
  const [feedback, setFeedback] = useState<FileFeedback | null>(null);
  // Slice I (DES-FEEDBACK-002 §3.4): the row itself opens the INLINE viewer;
  // external-open (↗) and copy (⧉) move to hover-revealed row-end icons —
  // the same api.openPath / clipboard calls as before, byte-identical behavior.
  const [viewerOpen, setViewerOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current); }, []);
  const display = relativeToRoot(path, root);
  const parts = display.replace(/\\/g, '/').split('/');
  const name = parts.pop() ?? display;
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
function RunTranscriptView({ runId, units, onOpenShell, live = null }: {
  runId: string;
  units: SessionView['units'];
  onOpenShell: () => void;
  /**
   * Slice Z (DES-UX-001 §7.6): the executing cursor unit, when the run is live —
   * the modal leads with the SAME `unitOutputDelta` live region the run thread
   * renders (LiveNarration, one component, never a fork), so the Term tab is
   * never an empty shell mid-run. Null for terminal runs: captured-only.
   */
  live?: { ord: number; phase: string } | null;
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
      {live !== null && (
        <LiveNarration runId={runId} ord={live.ord} phase={live.phase} />
      )}
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
  // §7.10: rows display worktree-relative paths (absolute stays on title/copy/open).
  const root = model.session.workdir ?? undefined;
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
      {/* studio#122: what this panel actually counts, said before the counts are
          read. The rows come from each unit's `filesRead` set — every file the
          agents opened in the worktree, with "MODIFIED / CREATED" inferred from
          governance hook fires — so the number is a measure of ATTENTION, not of
          delivered change. Run 665a9aeb reported 13 files here while its deliver
          phase pushed a branch with zero commits; the Delivery section below
          carries the outcome claim, and this one stops making it. */}
      <p data-testid="files-scope-note" className="text-[10px] font-mono leading-snug" style={{ color: 'var(--ink-dim)' }}>
        files the agents read or wrote in the worktree — not a delivered changeset
      </p>

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
                <FilePath key={f} path={f} opKind="write" runId={runId} root={root} />
              ))}
              {sortedDeleted.map((f) => (
                <FilePath key={f} path={f} opKind="delete" runId={runId} root={root} />
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
              <FilePath key={f} path={f} runId={runId} root={root} />
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

export function RightPanel({ view, runs, onSelectRun }: Props): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<AccordionId | null>('whatwhere');

  // Provenance rides the run-detail load: ONE `GET /audit?runId=` per detail
  // view, cached per run id (DES-UX-001 §3.3 — the sanctioned exception,
  // named in its AC). Notification rows read the same cache — no fan-out.
  const provenance = useProvenanceStore((s) => s.byRun[view.session.id] ?? null);
  useEffect(() => {
    useProvenanceStore.getState().load(view.session.id);
  }, [view.session.id]);

  // Forward lineage (§4.3): retries of THIS run, from the already-loaded index.
  const retriedAs = useMemo(
    () => (runs ?? []).filter((r) => r.session.retry_of === view.session.id).map((r) => r.session.id),
    [runs, view.session.id],
  );

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

  // studio#122 EC57: a run that cannot deliver gets no Delivery section at all —
  // silence, not a section that says "none" on every chat. `canDeliver` is the
  // SAME predicate the project census filters by (D5), the row chips gate on
  // (D2) AND the one the COMPOSER classifies with (D-1), so the rail, the rows,
  // the census and the launch form can never disagree about what a deliverable
  // run is. The lookup is the authoritative `is_system` flag off the app's one
  // `GET /workflows`.
  //
  // A run with a deliver PHASE keeps this section whatever its workflow id says
  // — 5c5e08b7 opened a real PR under a materialised `wf-<runId>` def. A run
  // WITHOUT one gets it only once a def in hand says the workflow is ordinary:
  // "this run has no deliver phase" is a claim about a classification, and 86 of
  // the 129 live runs carry an id no catalog serves, so `undefined` is the
  // permanent answer for them and the sentence would be unevidenced. Nothing in
  // the delivery DERIVATION reads `session.workflow_id` (EC61) — the
  // classification half is a visibility gate, not a wire read.
  const isSystemWorkflow = useIsSystemWorkflow();
  const sections = useMemo(
    () => (canDeliver(view, isSystemWorkflow) ? ACCORDIONS : ACCORDIONS.filter((a) => a.id !== 'delivery')),
    [view, isSystemWorkflow],
  );

  /**
   * The EFFECTIVE open section (Copilot on #125). `openAccordion` is mount-scoped state and the
   * panel does not remount between runs, so opening `delivery` on a deliverable run and then
   * selecting a run that cannot deliver leaves the id pointing at a section `sections` no longer
   * contains — and the rail renders with nothing open, silently losing What/Where's default.
   *
   * Healed by derivation rather than an effect: an effect would paint the broken frame first and
   * then correct it. `null` is passed through untouched because it is a REAL state — the operator
   * collapsed everything — and must not be confused with a stale id.
   */
  const openId: AccordionId | null =
    openAccordion === null || sections.some((s) => s.id === openAccordion)
      ? openAccordion
      : 'whatwhere';

  function toggleAccordion(id: AccordionId): void {
    // Compare against the EFFECTIVE open section, not the raw state (Copilot on #125). After a
    // run switch drops the open section, `openAccordion` still names the vanished id while the
    // rail RENDERS `openId` — so clicking the visibly-open What/Where compared 'delivery' with
    // 'whatwhere', re-opened what was already open, and did nothing until a second click.
    // Deliberately not a functional update: the correct input is what the operator can SEE.
    setOpenAccordion(openId === id ? null : id);
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
          title={executingOrd(session, view.units) !== null
            ? "View this run's live output"
            : view.units.some((u) => u.status === 'done' || u.status === 'rejected')
              ? "View this run's transcript"
              : 'Terminal'}
          aria-label={executingOrd(session, view.units) !== null
            ? "View this run's live output"
            : view.units.some((u) => u.status === 'done' || u.status === 'rejected')
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
        {sections.map(({ id, label }) => (
          <div key={id} style={{ borderBottom: '1px solid var(--surface-raised)' }}>
            <button
              type="button"
              onClick={() => toggleAccordion(id)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors"
              style={{ color: openId === id ? 'var(--ink-high)' : 'var(--ink-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-raised)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              aria-expanded={openId === id}
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
                {/* studio#122 revised EC54: the state on the HEADER, so "did this
                    run open a PR" is answerable without opening anything. Same
                    badge shape as the file count beside it; derived from `view`
                    alone, so it paints before (and without) the run model. */}
                {id === 'delivery' && <DeliveryBadge view={view} />}
              </div>
              <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>
                {openId === id ? '▲' : '▼'}
              </span>
            </button>
            {/* Delivery derives from the `view` prop alone (zero events, zero
                model), so it never waits on the snapshot the other bodies need
                — a run that opened a PR says so on the first paint of the
                section, not after the re-hydrate lands. */}
            {openId === id && id === 'delivery' && (
              <div className="px-4 py-3" style={{ background: 'var(--surface-base)' }}>
                <RunDelivery view={view} />
              </div>
            )}
            {openId === id && id !== 'delivery' && model && (
              <div className="px-4 py-3" style={{ background: 'var(--surface-base)' }}>
                {id === 'decisions' && <DecisionsLedger model={model} />}
                {id === 'governance' && <GovernanceAudit model={model} />}
                {id === 'burn' && <Burn model={model} />}
                {id === 'data' && <DataUsed model={model} />}
                {id === 'steering' && <SteeringTimeline runId={model.session.id} />}
                {id === 'whatwhere' && (
                  <WhatWhere
                    model={model}
                    provenance={provenance}
                    retriedAs={retriedAs}
                    {...(onSelectRun !== undefined ? { onSelectRun } : {})}
                  />
                )}
                {id === 'assumptions' && <AssumptionsPanel model={model} />}
                {id === 'files' && <FilesPanel model={model} />}
              </div>
            )}
            {openId === id && id !== 'delivery' && !model && (
              <div className="px-4 py-3">
                <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>Loading…</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Terminal modal — transcript-first when captured output exists (§1.3-4),
          and LIVE-first while the run executes (DES-UX-001 §7.6, slice Z): a
          diagnosing operator lands on the run's own record — streamed or
          captured — never on an empty ungoverned shell by default. The shell
          stays the labeled secondary inside RunTranscriptView. */}
      {termOpen && (() => {
        const hasCaptured = view.units.some((u) => u.status === 'done' || u.status === 'rejected');
        // The executing cursor unit (null unless the run is executing — the
        // same derivation the run thread's live region keys on).
        const liveUnitOrd = executingOrd(session, view.units);
        const liveUnit = view.units.find((u) => u.ord === liveUnitOrd);
        const showTranscript = (hasCaptured || liveUnitOrd !== null) && !termShell;
        return (
          <Modal
            title={showTranscript
              ? (liveUnitOrd !== null ? "This run's live output" : "This run's transcript")
              : 'Operator shell'}
            onClose={() => { setTermOpen(false); setTermShell(false); }}
          >
            {showTranscript ? (
              <RunTranscriptView
                runId={session.id}
                units={view.units}
                onOpenShell={() => setTermShell(true)}
                live={liveUnitOrd !== null
                  ? { ord: liveUnitOrd, phase: liveUnit?.stage ?? `unit #${liveUnitOrd}` }
                  : null}
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
