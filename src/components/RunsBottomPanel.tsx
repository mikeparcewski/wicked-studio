import { useEffect, useMemo, useRef } from 'react';
import type { SessionView } from '../api/types.js';
import { GATE_HASH } from '../board/gateActions.js';
import { observedSpend, runStats, WINDOW_LABEL_STYLE, windowWord } from '../board/metrics.js';
import { sessionProjectId } from '../hooks/ambientProject.js';
import { useGlobalShortcuts, type ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { useRunsPanelStore } from '../store/runsPanel.js';
import { useRuntimeStore } from '../store/runtime.js';
import { prefersReducedMotion } from './LiveEdge.js';
import { runTitle, runWhenWord, WHEN_TITLE } from './runIdentity.js';
import { phaseWord, recentRuns, RUN_DOT } from './RunsSection.js';

/**
 * The runs bottom panel (DES-FEEDBACK-003 §5, slice N) — the runs' home after
 * the rail lost its RunsSection mount (§8.1). Two physical modes (§5.2):
 *
 *  - COLLAPSED (default): a fixed 28px bar across the viewport bottom — a
 *    reserved ROW, not an overlay: App's root gains `padding-bottom: 28px`
 *    (RUNS_BAR_PX), so no surface is ever covered while collapsed (EC27).
 *  - EXPANDED: an overlay sheet rising from the bar to min(340px, 42vh) —
 *    overlays content rather than reflowing it, so layout math stays
 *    identical everywhere. Collapse: the ▾, Escape (registry-routed, §5.7),
 *    or clicking outside the sheet.
 *
 * Every stat is CLIENT-DERIVABLE from stores the app already holds (§5.3):
 * the `runs` prop (App's one `useRuns()`), the gate store, and the runtime
 * store's cliUsage fold — zero new requests, zero new sockets (§5.1, C8).
 * Row grammar (dot / phase word / ordering) is the RunsSection library,
 * reused verbatim (§5.5). z-order: above surface content, below the palette,
 * modals, and gate toasts (§5.2); the sheet captures no keys beyond Escape.
 */

/** §5.2: the collapsed bar's exact height — App reserves this as padding. */
export const RUNS_BAR_PX = 28;

/** §5.4: the sheet lists up to 20 runs, scrolling internally past 8. */
const SHEET_MAX = 20;

// Slice W (DES-UX-001 §5.3): the stat derivations moved to THE one metrics
// module — this surface renders `runStats` / `observedSpend` and may not fold
// stores inline. Re-exported so standing importers keep one source.
export { observedSpend, runStats, type RunStats } from '../board/metrics.js';

/** "waiting 12m" — the gate row's wait age off the gate store's frame ts (§5.4). */
export function waitingWord(ageMs: number): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return `waiting ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `waiting ${m}m`;
  return `waiting ${Math.floor(m / 60)}h`;
}

/** One collapsed-bar stat segment: glyph in its status token, text muted (§5.3). */
function Segment({ glyph, color, text, pulse = false }: {
  glyph: string;
  color: string;
  text: string;
  pulse?: boolean;
}): React.ReactElement {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span
        aria-hidden
        style={{
          color,
          // §5.3: the ⏸ segment pulses ONLY while a gate is waiting — the
          // AppChrome dot's exact grammar, honoring prefers-reduced-motion.
          animation: pulse && !prefersReducedMotion() ? 'wk-live-pulse 2s ease-in-out infinite' : undefined,
        }}
      >
        {glyph}
      </span>
      <span style={{ color: 'var(--ink-muted)' }}>{text}</span>
    </span>
  );
}

interface Props {
  runs: SessionView[];
  runPath: (id: string) => string;
  navigate: (path: string) => void;
  /** True inside Document/Video — entering auto-collapses the sheet (EC27). */
  immersive: boolean;
  /**
   * Slice S (DES-UX-001 §2.3 rule 2): inside a project route the counters
   * scope to THAT project's runs — `data-scope="project"` — derived from the
   * run DTO's `project_id` (CREW-UX-2 daemon truth; the membership mirror
   * answers only for pre-0.8.0 daemons). `null` = the global counters
   * (`data-scope="global"`), everywhere outside a project.
   */
  scopeProjectId: string | null;
}

export function RunsBottomPanel({ runs, runPath, navigate, immersive, scopeProjectId }: Props): React.ReactElement {
  const expanded = useRunsPanelStore((s) => s.expanded);
  const gates = useGateStore((s) => s.gates);
  const logs = useRuntimeStore((s) => s.logs);
  const projectNameByRun = useMembershipStore((s) => s.projectNameByRun);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  // §7.5 (slice Y2): the attach clock for the sheet rows — the same mirror the
  // Make dashboard buckets on. A store read: the §5.1 zero-new-requests budget
  // holds unchanged.
  const attachedAtByRun = useMembershipStore((s) => s.attachedAtByRun);
  const projects = useProjectsStore((s) => s.projects);
  const rootRef = useRef<HTMLDivElement>(null);

  // Zero-new-requests scoping (§5.1 still holds): a pure filter over the runs
  // prop — DTO truth first, mirror fallback — never a fetch of its own.
  const scopedRuns = useMemo(() => {
    if (scopeProjectId === null) return runs;
    return runs.filter((v) => {
      const claimed = sessionProjectId(v.session);
      return claimed !== undefined
        ? claimed === scopeProjectId
        : projectIdByRun[v.session.id] === scopeProjectId;
    });
  }, [runs, scopeProjectId, projectIdByRun]);

  /** A sheet row's project label: the DTO's own claim resolved against the
   *  already-loaded projects store (zero membership fetches — §2.5's AC),
   *  falling back to the board model's mirror for pre-0.8.0 daemons. */
  const projectLabelOf = (view: SessionView): string => {
    const claimed = sessionProjectId(view.session);
    if (claimed === null) return '';
    if (claimed !== undefined) {
      return projects.find((p) => p.id === claimed)?.name ?? claimed;
    }
    return projectNameByRun[view.session.id] ?? '';
  };

  const stats = useMemo(() => runStats(scopedRuns), [scopedRuns]);
  const spend = useMemo(() => observedSpend(logs), [logs]);
  const rows = useMemo(() => recentRuns(scopedRuns, SHEET_MAX), [scopedRuns]);
  // Slice AA (DES-UX-001 §7.1, B4): inside a project shell, a gate waiting on a
  // run OUTSIDE the scope announces HERE — this count plus the bell — never as
  // an overlay card over the mode surface. Scoped stats stay untouched (EC34:
  // the sheet's rows still equal `stats.gates`); this is a separate, labeled
  // count over the same gate store the toasts read.
  const gatesElsewhere = useMemo(() => {
    if (scopeProjectId === null) return 0;
    const scoped = new Set(scopedRuns.map((v) => v.session.id));
    return Object.keys(gates).filter((id) => !scoped.has(id)).length;
  }, [gates, scopeProjectId, scopedRuns]);
  const quiet =
    stats.working === 0 && stats.gates === 0 && stats.failed === 0 && gatesElsewhere === 0;

  // EC27: entering an immersive mode collapses an open sheet — the canvas-first
  // principle, same transition the rail collapses on. Fires on the transition
  // only; the operator can still re-expand manually (an explicit gesture wins).
  useEffect(() => {
    if (immersive) useRunsPanelStore.getState().collapse();
  }, [immersive]);

  // §5.7 Escape precedence, through the ONE slice-G registry (EC21, C9): the
  // palette owns Escape while open (the registry yields wholesale); the triage
  // cursor's own Escape entry yields while this sheet is up (useTriageCursor
  // reads this store), so palette → sheet → triage holds regardless of which
  // surface registered first. Stable entries — guards read through the store.
  const escapeEntries = useMemo<ShortcutEntry[]>(
    () => [
      {
        id: 'runs-sheet-close',
        chord: { key: 'escape' },
        description: 'Collapse the runs sheet',
        guard: () => useRunsPanelStore.getState().expanded,
        handler: () => useRunsPanelStore.getState().collapse(),
      },
    ],
    [],
  );
  useGlobalShortcuts(escapeEntries);

  // §5.2: clicking outside the sheet collapses it.
  useEffect(() => {
    if (!expanded) return;
    function onOutside(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        useRunsPanelStore.getState().collapse();
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [expanded]);

  const allRuns = (testId: string): React.ReactElement => (
    <a
      href="/work"
      data-testid={testId}
      onClick={(e) => {
        // A real link (§5.3) — the ONE escape hatch to the flat list, not an
        // expand gesture, so the click must not bubble into the toggle.
        // Target: /work, the ONE canonical runs surface (DES-UX-001 §7.4,
        // slice Y — only the href moved; the sheet itself is untouched, §9).
        e.preventDefault();
        e.stopPropagation();
        navigate('/work');
      }}
      className="shrink-0 transition-opacity hover:opacity-80"
      style={{ color: 'var(--accent)', textDecoration: 'none' }}
    >
      All runs ›
    </a>
  );

  const summary = (
    <>
      <Segment glyph="●" color="var(--status-run)" text={`${stats.working} working`} />
      <Segment glyph="⏸" color="var(--status-gate)" text={`${stats.gates} gates`} pulse={stats.gates > 0} />
      {/* §7.1 (slice AA): the cross-project announcement — labeled, beside the
          scoped count, so "0 gates +2 elsewhere" reads as two truths, not one lie. */}
      {gatesElsewhere > 0 && (
        <span
          data-testid="runs-bar-gates-elsewhere"
          data-count={gatesElsewhere}
          style={{ ...WINDOW_LABEL_STYLE, color: 'var(--status-gate)' }}
        >
          +{gatesElsewhere} elsewhere
        </span>
      )}
      <Segment glyph="✗" color="var(--status-fail)" text={`${stats.failed} failed`} />
      {/* EC39 (slice W): the three counts share one window and SAY it — the
          unwindowed listing, "all" — so "2 failed" here beside a "1 failed
          (24h)" elsewhere reads as two labeled truths, not a contradiction. */}
      <span data-testid="runs-bar-window" data-window="all" style={WINDOW_LABEL_STYLE}>
        {windowWord('all')}
      </span>
      {spend.frames > 0 && (
        // Rendered only once a cliUsage frame has been observed — never a
        // fabricated $0.00 for "unknown" (the slice-E wire-honesty rule).
        <>
          <Segment glyph="◔" color="var(--accent)" text={`$${spend.total.toFixed(2)} observed`} />
          {/* EC39: the spend's window — what THIS page observed this session. */}
          <span data-testid="runs-bar-spend-window" data-window="session" style={WINDOW_LABEL_STYLE}>
            {windowWord('session')}
          </span>
        </>
      )}
    </>
  );

  return (
    <div ref={rootRef}>
      {/* ── The collapsed bar: a reserved 28px row, fixed at the bottom (§5.2) ── */}
      <div
        data-testid="runs-bottom-bar"
        data-expanded={String(expanded)}
        data-scope={scopeProjectId === null ? 'global' : 'project'}
        data-window="all"
        data-working={stats.working}
        data-gates={stats.gates}
        data-gates-elsewhere={gatesElsewhere}
        data-failed={stats.failed}
        className="fixed bottom-0 left-0 right-0 flex items-center font-mono"
        style={{
          height: RUNS_BAR_PX,
          zIndex: 40, // above surface content; below the palette/modals/toasts (z-50)
          background: 'var(--surface-rail)',
          borderTop: '1px solid var(--surface-raised)',
          fontSize: 'var(--text-2xs)',
        }}
      >
        <button
          type="button"
          data-testid="runs-bar-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse the runs sheet' : 'Expand the runs sheet'}
          onClick={() => useRunsPanelStore.getState().toggle()}
          className="flex flex-1 items-center gap-3 h-full px-3 text-left min-w-0"
          style={{ background: 'transparent', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' }}
        >
          <span aria-hidden style={{ color: 'var(--ink-dim)' }}>{expanded ? '▾' : '▴'}</span>
          {quiet ? (
            // Zero-states compress (§5.3): calm is one phrase, not four zeros.
            <span style={{ color: 'var(--ink-dim)' }}>nothing running</span>
          ) : (
            summary
          )}
        </button>
        <div className="px-3">{allRuns('runs-bar-all')}</div>
      </div>

      {/* ── The expanded sheet: an overlay guest, never a reflow (§5.2/§5.4) ── */}
      {expanded && (
        <div
          data-testid="runs-bottom-sheet"
          className="wk-sheet-in fixed left-0 right-0 flex flex-col"
          style={{
            bottom: RUNS_BAR_PX,
            height: 'min(340px, 42vh)',
            zIndex: 40,
            background: 'var(--surface-overlay)',
            boxShadow: 'var(--shadow-overlay)',
            borderTop: '1px solid var(--surface-raised)',
          }}
        >
          <div
            className="flex items-center gap-3 px-3 py-2 shrink-0 font-mono"
            style={{ fontSize: 'var(--text-2xs)', borderBottom: '1px solid var(--surface-raised)' }}
          >
            <span style={{ color: 'var(--ink-high)', fontWeight: 'var(--weight-semi)' }}>Runs</span>
            {/* §5.3 (slice W): the sheet's cap is a SILENT filter no longer —
                when the list is clipped it says so in the same breath. */}
            {scopedRuns.length > rows.length && (
              <span data-testid="runs-sheet-cap" style={WINDOW_LABEL_STYLE}>
                showing {rows.length} of {scopedRuns.length}
              </span>
            )}
            {!quiet && summary}
            <span className="flex-1" />
            {allRuns('runs-sheet-all')}
            <button
              type="button"
              data-testid="runs-sheet-collapse"
              aria-label="Collapse the runs sheet"
              onClick={() => useRunsPanelStore.getState().collapse()}
              className="shrink-0 px-1"
              style={{ background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer' }}
            >
              ▾
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {rows.length === 0 && (
              <p className="px-3 py-2" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}>
                No runs yet.
              </p>
            )}
            {rows.map((view) => {
              const id = view.session.id;
              const gated = view.session.status === 'awaiting_human';
              // A waiting gate row deep-links to its gate (§5.4) — the fastest
              // path from "the bar pulsed" to "answering".
              const href = gated ? `${runPath(id)}${GATE_HASH}` : runPath(id);
              const gate = gates[id];
              const cost = spend.byRun[id] ?? 0;
              return (
                <a
                  key={id}
                  href={href}
                  data-testid="runs-sheet-row"
                  data-run-id={id}
                  data-status={view.session.status}
                  title={view.session.problem}
                  onClick={(e) => {
                    // Row click navigates to the run page and the sheet
                    // collapses — the destination owns the viewport now (§5.4).
                    // Real link semantics: middle-click still works via href.
                    e.preventDefault();
                    useRunsPanelStore.getState().collapse();
                    navigate(href);
                  }}
                  className="flex items-center gap-2 px-3 py-1 min-w-0 transition-colors"
                  style={{ background: 'transparent', textDecoration: 'none' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-card)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span
                    aria-hidden
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: RUN_DOT[view.session.status] ?? 'var(--ink-dim)' }}
                  />
                  {/* §7.5 (EC40): the synthesized title — identical prompts
                      never render identical rows — plus the attach clock. */}
                  <span
                    data-testid="run-title"
                    className="truncate leading-tight"
                    style={{ maxWidth: '48ch', fontSize: 'var(--text-xs)', color: 'var(--ink-body)', fontFamily: 'var(--font-sans)' }}
                  >
                    {runTitle(view.session)}
                  </span>
                  <span
                    data-testid="run-when"
                    title={WHEN_TITLE}
                    className="shrink-0 font-mono"
                    style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}
                  >
                    {runWhenWord(attachedAtByRun[id], Date.now())}
                  </span>
                  <span
                    data-testid="runs-sheet-row-project"
                    className="truncate shrink-0"
                    style={{ maxWidth: '20ch', fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)' }}
                  >
                    {projectLabelOf(view)}
                  </span>
                  <span className="flex-1" />
                  <span
                    className="shrink-0 font-mono"
                    style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}
                  >
                    {phaseWord(view)}
                  </span>
                  {gated && gate !== undefined && (
                    <span className="shrink-0 font-mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--status-gate)' }}>
                      {waitingWord(Date.now() - gate.receivedAt)} ↵
                    </span>
                  )}
                  {cost > 0 && (
                    <span className="shrink-0 font-mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}>
                      ${cost.toFixed(2)}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
