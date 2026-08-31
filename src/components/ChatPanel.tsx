import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lostQuorum, quorumLabel } from './councilQuorum.js';
import { api, downloadRunEvidence } from '../api/client.js';
import { useGlobalShortcuts, type ShortcutEntry } from '../hooks/useGlobalShortcuts.js';
import type { SessionView, WorkUnit } from '../api/types.js';
import { executingOrd } from '../api/run-state.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore, type CouncilStatus } from '../store/runtime.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { LiveEdge } from './LiveEdge.js';
import { STATUS_STYLE } from './RunCard.js';
import { ApprovalDock } from './ApprovalDock.js';
import { ChatInput } from './ChatInput.js';
import { AgentTerminal } from './AgentTerminal.js';
import { FailureBanner } from './FailureBanner.js';
import { FileViewer } from './FileViewer.js';
import { FollowUpComposer } from './FollowUpComposer.js';
import { Markdown } from './Markdown.js';
import { NarratorFeed, phaseName, unitKey } from './NarratorFeed.js';
import { NowBar } from './NowBar.js';
import { deriveArtifacts, lastNarration, type NarratorContext } from './narrator.js';
import { RunTimes } from './runIdentity.js';
import { RunTimeline } from './RunTimeline.js';
import { UnitList } from './UnitList.js';
import { VerdictDetail } from './VerdictDetail.js';
import type { RunMode } from './runMode.js';
import { MODE_LABELS } from './runMode.js';
export type { RunMode } from './runMode.js';
// Moved to its own module (DES-RUN-NARRATOR §9); re-exported so existing
// importers (RightPanel's Term tab, tests) keep resolving.
export { LiveNarration } from './LiveNarration.js';

interface Props {
  view: SessionView | null;
  chatMode?: boolean;
  onLaunched: (runId: string) => void;
  onNavigateBack: () => void;
  onRefresh: () => void;
  onKill?: (runId: string) => void | Promise<void>;
  /** App-level route navigation — threaded to ChatInput's seat sign-in warning (→ /system). */
  navigate?: (path: string) => void;
  /**
   * §4.3 pre-bind (DES-FEEDBACK-001, slice B): non-null when the launch form was
   * entered from project context (`/p/:projectId/build/new`) — the ProjectSwitcher
   * field pre-fills with this project and LOCKS.
   */
  launchProjectId?: string | null;
  /**
   * DES-UX-001 §7.6 (slice Z): the run id the ROUTE names when `view` has not
   * resolved from the run index yet — a just-launched run navigated to before
   * the debounced `GET /runs` lands, or a bookmarked run reloaded mid-run.
   * Non-null renders the honest opening/absent state, never the composer
   * ("a refresh mid-run drops to a blank composer" is the C3 defect).
   */
  pendingRunId?: string | null;
  /** Whether the run index has completed at least one fetch (useRuns.loaded). */
  runsLoaded?: boolean;
}

// Agent identity under the token contract (DES-VISION-001 §2.11): one
// surface/ink pair for every avatar — identity rides the monogram + name, and
// color stays reserved for signal (§1.5 rule 2: status ≠ identity ≠ accent).
const CLI_AVATAR = { bg: 'var(--surface-raised)', fg: 'var(--ink-body)' } as const;

function cliInitials(key: string): string {
  const parts = key.split(/[-_]/);
  if (parts.length > 1) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return key.slice(0, 2).toUpperCase();
}

/**
 * Live council deliberation status for a not-yet-started unit, derived from the
 * councilConvened / councilSeatFailed / councilDeliberated (below-bar runoff) / councilVoted
 * frames. Rendered as the queued phase's stepper tooltip (operator UX directive: routing
 * chatter for future work belongs in the stepper, not as standalone thread blocks).
 *
 * Seats that failed are named alongside the agreement percentage, not instead of it. A council
 * that convened three seats and heard from one still reports 100% agreement — true of the votes
 * cast, and misleading on its own.
 */
function councilLabel(status: CouncilStatus | undefined): string {
  const line = !status
    ? 'Council deliberating…'
    : status.state === 'convened'
      ? `Council convened — polling ${status.clis?.length ?? '?'} CLI${(status.clis?.length ?? 0) === 1 ? '' : 's'}…`
      : status.state === 'deliberating'
        ? `Ballot ${status.round ?? '?'}: ${status.agreementPct ?? '?'}% — below the ${status.neededPct ?? 75}% bar, runoff in progress…`
        : `Council voted — ${status.agreementPct ?? '?'}% agreement (${status.votes ?? '?'} votes)`;
  const failed = status?.failedSeats ?? [];
  if (failed.length === 0) return line;
  // `why` is CRLF-normalized in the store, so a Windows seat's stderr does not put stray
  // carriage returns into the tooltip.
  return `${line}\n${failed.length} seat${failed.length === 1 ? '' : 's'} did not vote — ${failed
    .map((f) => `${f.cli} (${f.kind})`)
    .join(', ')}`;
}

/** One line of routing provenance for a phase's stepper tooltip. */
function routingSummary(unit: WorkUnit): string | null {
  if (unit.routing === null) return unit.assigned_cli ? `→ ${unit.assigned_cli}` : null;
  switch (unit.routing.method) {
    case 'council':
      return `Council → ${unit.assigned_cli ?? '?'} · ${quorumLabel(unit.routing)} · ${
        unit.routing.agreement_pct
      }% agree · ${unit.routing.dissent} dissent${lostQuorum(unit.routing) ? ' · quorum lost' : ''}`;
    case 'evaluator_distinct':
      return `Evaluator-distinct → ${unit.assigned_cli ?? '?'} (was: ${unit.routing.was})`;
    case 'degraded':
      return `Degraded routing: ${unit.routing.reason}`;
    default:
      return unit.assigned_cli ? `→ ${unit.assigned_cli}` : null;
  }
}

/** A phase's place in the run: finished, judged-and-rejected, running now, or still to come. */
type StepState = 'done' | 'rejected' | 'active' | 'queued';

/**
 * The stepper speaks the §2.6 status layer (DES-VISION-001): active = the
 * run-emerald (the same signal the board's live edge carries — running, NOT the
 * gate's amber, so "a phase is running" and "a gate needs you" stay ranked
 * apart, the original intent of the pre-token link-blue); rejected = fail-red;
 * done and queued are history/future — ink, not signal.
 */
const STEP_STYLE: Record<StepState, { color: string; background: string; border: string }> = {
  done:     { color: 'var(--status-done)', background: 'var(--status-done-dim)', border: '1px solid var(--surface-raised)' },
  rejected: { color: 'var(--status-fail)', background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)' },
  active:   { color: 'var(--status-run)',  background: 'var(--status-run-dim)',  border: '1px solid var(--status-run-dim)' },
  queued:   { color: 'var(--ink-dim)',     background: 'transparent',            border: '1px solid var(--surface-raised)' },
};

/**
 * Compact process stepper at the top of the run thread (operator UX directive): every phase
 * of the workflow in ord order — done phases checked, the executing one highlighted, future
 * ones dimmed. This is the run's map; the narrated feed below it carries only the
 * phases that have actually run (or are running), so queued work no longer renders as a
 * column of tall empty "Not started" blocks. Routing provenance and live council chatter for
 * a queued phase live here, in the phase's tooltip, until the phase starts.
 */
function ProcessStepper({
  runId,
  units,
  executingUnitOrd,
}: {
  runId: string;
  /** Already ord-sorted (the caller's memoized `ordered`). */
  units: WorkUnit[];
  executingUnitOrd: number | null;
}): React.ReactElement | null {
  const councilStatus = useRuntimeStore((s) => s.councilStatus);
  if (units.length === 0) return null;
  return (
    <div
      data-testid="process-stepper"
      aria-label="Workflow phases"
      className="flex items-center gap-1.5 flex-wrap px-6 py-2.5 shrink-0 font-mono text-[11px]"
      style={{ borderBottom: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      {units.map((unit, i) => {
        const state: StepState =
          unit.status === 'done'
            ? 'done'
            : unit.status === 'rejected'
              ? 'rejected'
              : unit.ord === executingUnitOrd
                ? 'active'
                : 'queued';
        const live = councilStatus[`${runId}:${unit.ord}`];
        const tooltip = [
          unit.description,
          routingSummary(unit),
          // Live deliberation chatter only matters while the phase has not produced anything
          // else to look at; once it starts, the phase entry in the thread takes over.
          state === 'queued' && unit.status === 'pending' ? councilLabel(live) : null,
        ]
          .filter((line): line is string => line !== null && line.length > 0)
          .join('\n');
        const s = STEP_STYLE[state];
        return (
          <Fragment key={unit.id}>
            {i > 0 && (
              <span aria-hidden="true" style={{ color: 'var(--ink-dim)' }}>
                ›
              </span>
            )}
            <span
              data-testid={`stepper-phase-${unit.ord}`}
              data-state={state}
              title={tooltip}
              className="rounded-full px-2.5 py-0.5 flex items-center gap-1.5 whitespace-nowrap relative"
              style={{ background: s.background, border: s.border, color: s.color }}
            >
              {state === 'done' && <span aria-hidden="true">✓</span>}
              {state === 'rejected' && <span aria-hidden="true">✗</span>}
              {/* The breathing edge is the signal; the dot stays only for colour
                  continuity with the run's status, so it no longer pulses too. */}
              {state === 'active' && <LiveEdge state="executing" pill />}
              {state === 'active' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--status-run)' }} />
              )}
              {phaseName(runId, unit)}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

// The header dot speaks the §2.6 status layer: emerald while anything is
// moving, amber at a gate, red on failure, dim ink once it's history.
function statusDotColor(status: string): string {
  switch (status) {
    case 'completed':      return 'var(--status-done)';
    case 'failed':        return 'var(--status-fail)';
    case 'cancelled':     return 'var(--ink-dim)';
    case 'awaiting_human': return 'var(--status-gate)';
    default:              return 'var(--status-run)';
  }
}

function StopIcon(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="0.75" fill="currentColor"/>
    </svg>
  );
}

function DownloadIcon(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 2v7.25m0 0L5.25 6.5M8 9.25l2.75-2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.75 11v1.25c0 .69.56 1.25 1.25 1.25h8c.69 0 1.25-.56 1.25-1.25V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Downloads the run's evidence bundle (run + units + transcripts + the gate /
 * routing decision trail) as one JSON file. Disabled until the run reaches a
 * terminal state — an in-flight run's evidence is still changing under you.
 */
function ExportEvidenceButton({ runId, disabled }: { runId: string; disabled: boolean }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportEvidence(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await downloadRunEvidence(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inert = disabled || busy;
  const title = disabled
    ? 'Export evidence — available once the run finishes'
    : error ?? (busy ? 'Exporting evidence…' : 'Export evidence');

  return (
    <>
      {error && (
        <span
          role="alert"
          className="text-[11px] font-mono shrink-0 max-w-[14rem] truncate"
          style={{ color: 'var(--status-fail)' }}
        >
          Export failed: {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void exportEvidence()}
        disabled={inert}
        title={title}
        aria-label="Export evidence"
        aria-busy={busy}
        className="flex items-center justify-center w-6 h-6 rounded shrink-0 transition-opacity disabled:cursor-not-allowed"
        style={{ color: error ? 'var(--status-fail)' : 'var(--accent)', opacity: inert ? 0.3 : 0.65 }}
        onMouseEnter={(e) => { if (!inert) e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { if (!inert) e.currentTarget.style.opacity = '0.65'; }}
      >
        <DownloadIcon />
      </button>
    </>
  );
}

function ModePill({
  mode,
  onChange,
  readOnly = false,
}: {
  mode: RunMode;
  onChange: (m: RunMode) => void;
  readOnly?: boolean;
}): React.ReactElement {
  const modes: RunMode[] = ['ask', 'balanced', 'autonomous'];

  function handleKey(e: React.KeyboardEvent, idx: number): void {
    if (readOnly) return;
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (idx + 1) % modes.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (idx - 1 + modes.length) % modes.length;
    } else {
      return;
    }
    e.preventDefault();
    onChange(modes[next]!);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Run mode"
      aria-disabled={readOnly || undefined}
      title={readOnly ? 'Run mode (read-only — run is complete)' : undefined}
      className="flex items-center rounded-lg overflow-hidden shrink-0"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--surface-overlay)',
        opacity: readOnly ? 0.6 : 1,
      }}
    >
      {modes.map((m, idx) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-disabled={readOnly}
          tabIndex={readOnly ? -1 : mode === m ? 0 : -1}
          onClick={readOnly ? undefined : () => onChange(m)}
          onKeyDown={readOnly ? undefined : (e) => handleKey(e, idx)}
          disabled={readOnly}
          className="px-3 py-1 text-[11px] font-mono font-medium transition-colors disabled:cursor-default"
          // The selected segment is an interactive selection → the accent
          // (mirrors the mode switcher's active fill, §5.2/§2.5); never amber —
          // that's the gate's color.
          style={
            mode === m
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'transparent', color: 'var(--ink-dim)' }
          }
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

/**
 * Read-only view for legacy workflow_id='chat' runs (old council-routed single-unit sessions).
 * Renders as a simple conversation without governance chrome or a work-launcher input.
 */
function LegacyChatHistory({
  view,
  onNavigateBack,
}: {
  view: SessionView;
  onNavigateBack: () => void;
}): React.ReactElement {
  const { session, units } = view;
  const [transcripts, setTranscripts] = useState<
    Record<number, { text: string | null; loading: boolean; visible: boolean }>
  >({});
  const autoLoadedOrds = useRef<Set<number>>(new Set());

  useEffect(() => {
    for (const unit of units) {
      if (unit.status === 'done' && !autoLoadedOrds.current.has(unit.ord)) {
        autoLoadedOrds.current.add(unit.ord);
        setTranscripts((prev) => ({ ...prev, [unit.ord]: { text: null, loading: true, visible: true } }));
        void api
          .getUnitOutput(session.id, unitKey(session.id, unit.id, unit.ord))
          .then(({ output, outputUnavailable }) => {
            // `outputUnavailable` rather than a bare null: this auto-load only runs for a `done`
            // unit, so the case here is a completed unit whose output the daemon could not return
            // (not the denied case — a denied unit is not `done` and never reaches this block). The
            // pane names the reason instead of rendering blank (FINDING-006; review on #215 noted
            // the earlier comment mis-described this as the denied path).
            setTranscripts((prev) => ({
              ...prev,
              [unit.ord]: { text: output ?? outputUnavailable ?? null, loading: false, visible: true },
            }));
          })
          .catch(() => {
            setTranscripts((prev) => ({ ...prev, [unit.ord]: { text: null, loading: false, visible: true } }));
          });
      }
    }
  }, [units, session.id]);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-3 px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
      >
        <button
          type="button"
          onClick={onNavigateBack}
          aria-label="Back"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0"
          style={{ color: 'var(--ink-dim)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-raised)'; e.currentTarget.style.color = 'var(--ink-high)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-dim)'; }}
        >
          ←
        </button>
        <p className="flex-1 text-base font-semibold truncate" style={{ color: 'var(--ink-high)' }} title={session.problem}>
          {session.problem}
        </p>
        <span className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>legacy chat</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-3xl w-full mx-auto">
        <div className="flex justify-end">
          <div
            // §5.3 token usage: the user's message is transparent — a hairline
            // keeps the bubble shape without claiming a surface of its own.
            className="max-w-[72%] rounded-2xl text-base px-5 py-3.5 leading-relaxed"
            style={{ background: 'transparent', color: 'var(--ink-high)', border: '1px solid var(--surface-raised)' }}
          >
            {session.problem}
          </div>
        </div>

        {[...units].sort((a, b) => a.ord - b.ord).map((unit) => {
          const tc = transcripts[unit.ord];
          return (
            <div key={unit.id} className="self-start max-w-[85%] flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {unit.assigned_cli ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold font-mono select-none"
                      style={{ background: CLI_AVATAR.bg, color: CLI_AVATAR.fg }}
                    >
                      {cliInitials(unit.assigned_cli)}
                    </span>
                    <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                      {unit.assigned_cli}
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>agent</span>
                )}
              </div>
              <div
                className="rounded-2xl px-5 py-4"
                style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
              >
                {tc?.loading && (
                  <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>Loading…</span>
                )}
                {!tc?.loading && tc?.text && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setTranscripts((prev) => ({ ...prev, [unit.ord]: { ...prev[unit.ord]!, visible: !tc.visible } }))}
                      className="text-xs font-medium font-mono hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      {tc.visible ? '▾ Hide response' : '▸ View response'}
                    </button>
                    {tc.visible && (
                      <div className="mt-2.5 max-h-96 overflow-auto rounded-xl p-4" style={{ background: 'var(--surface-base)' }}>
                        <Markdown className="whitespace-pre-wrap">{tc.text}</Markdown>
                      </div>
                    )}
                  </div>
                )}
                {!tc?.loading && !tc?.text && (
                  <span className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
                    Response not available — this session predates durable transcripts.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const EMPTY_EVENTS_FOR_NARRATOR: never[] = [];

function RunChat({
  view,
  mode,
  onModeChange,
  onLaunched,
  onNavigateBack,
  onRefresh,
  onKill,
  navigate,
}: {
  view: SessionView;
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  onLaunched: (runId: string) => void;
  onNavigateBack: () => void;
  onRefresh: () => void;
  onKill?: (runId: string) => void | Promise<void>;
  navigate?: (path: string) => void;
}): React.ReactElement {
  const { session, units } = view;
  // `ord` order is what `unit_ix` indexes into, so both the render order and the cursor derive from
  // it. Memoized so neither reruns while `units` is unchanged (PR #179 review).
  const ordered = useMemo(() => [...units].sort((a, b) => a.ord - b.ord), [units]);
  const executingUnitOrd = useMemo(() => executingOrd(session, units), [session, units]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];
  const events = useRunEventStore((s) => s.byRun[session.id]) ?? EMPTY_EVENTS_FOR_NARRATOR;

  /** "all" broadcasts; any other value is a CLI key (set by clicking an agent card). */
  const [injectTarget, setInjectTarget] = useState<string>('all');
  const [agentTerminal, setAgentTerminal] = useState<{ cliKey: string; terminalId: string } | null>(null);
  // Evidence-reference wiring (DES-UX-001 §1.3-4c): a file link clicked in any
  // transcript opens the slice-I FileViewer on that path — never a dead click.
  const [evidenceFile, setEvidenceFile] = useState<string | null>(null);

  // The narrator's phase vocabulary (DES-RUN-NARRATOR §4): unit-id suffix,
  // stage fallback — the same rule the stepper renders with.
  const byOrd = useMemo(() => new Map(ordered.map((u) => [u.ord, u])), [ordered]);
  const phaseOf = useCallback(
    (ord: number | null | undefined): string => {
      if (typeof ord !== 'number') return 'this phase';
      const unit = byOrd.get(ord);
      return unit === undefined ? `unit ${ord}` : phaseName(session.id, unit);
    },
    [byOrd, session.id],
  );
  const ctx: NarratorContext = useMemo(
    () => ({ phaseOf, intent: session.problem ?? null }),
    [phaseOf, session.problem],
  );
  const lastLine = useMemo(() => lastNarration(events, ctx), [events, ctx]);
  const artifacts = useMemo(() => deriveArtifacts(events, view, ctx), [events, view, ctx]);

  // The now-bar's "Latest ↓" scrolls the ONE scrolling region to its tail.
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const jumpToLatest = useCallback(() => {
    const el = feedScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  // Units-as-spine for EVERY terminal failure (DES-UX-001 §1.3-1): a failed or
  // cancelled run keeps the ordered UnitList → WorkUnitDetail post-mortem under
  // the Units tab, with FailureBanner as the HEADLINE in every lens.
  const isPostMortem = session.status === 'failed' || session.status === 'cancelled';

  // DES-RUN-NARRATOR §8: a TERMINAL run carries three lenses — the narrated
  // Feed (default: the story), the evidence Timeline (slice BB, unchanged), and
  // the Units spine (slice R, unchanged). Live runs are always the feed.
  const [runTab, setRunTab] = useState<'feed' | 'timeline' | 'units'>('feed');

  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: '', color: 'var(--ink-muted)' };
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(session.status);

  // DES-UX-002 §5.4 (slice BE): `t` / `u` switch the terminal run's lenses
  // through the ONE shortcut registry (EC42). Guarded on the run being
  // terminal; the shared typing guard keeps letters as letters in textareas.
  const tabsLive = useRef(isTerminal);
  tabsLive.current = isTerminal;
  const tabEntries = useMemo<ShortcutEntry[]>(() => [
    {
      id: 'run-tab-timeline',
      chord: { key: 't' },
      group: 'panels',
      description: 'Run detail: show the evidence timeline',
      guard: () => tabsLive.current,
      handler: (e) => { e.preventDefault(); setRunTab('timeline'); },
    },
    {
      id: 'run-tab-units',
      chord: { key: 'u' },
      group: 'panels',
      description: 'Run detail: show the unit list',
      guard: () => tabsLive.current,
      handler: (e) => { e.preventDefault(); setRunTab('units'); },
    },
  ], []);
  useGlobalShortcuts(tabEntries);
  const dotColor = statusDotColor(session.status);
  const pulse = ['executing', 'distributing', 'planning', 'awaiting_human'].includes(session.status);

  /**
   * Retry (DES-UX-001 §4.3): reopen the standard composer PREFILLED with this
   * run's intent + configuration — fully editable before send, nothing
   * auto-launches. The launch will carry `retryOf` (CREW-UX-3) so both runs'
   * provenance lines cross-link from the system of record.
   */
  function startRetry(): void {
    setRetryPrefill({
      retryOf: session.id,
      problem: session.problem,
      clis: session.clis,
      // 'chat' is a system workflow, not a launchable choice — leave it unset.
      workflowId: session.workflow_id && session.workflow_id !== 'chat' ? session.workflow_id : null,
      repoRef: session.repo_ref,
      entityMode: session.entity_mode,
      humanConfirm: session.human_confirm,
      projectId: typeof session.project_id === 'string' ? session.project_id : null,
    });
    navigate?.('/runs/new');
  }

  const showFeed = !isTerminal || runTab === 'feed';

  return (
    <div className="flex flex-col h-full">
      {/* Run header */}
      <div
        className="flex items-center gap-3 px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
      >
        <button
          type="button"
          onClick={onNavigateBack}
          aria-label="Back to run list"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0"
          style={{ color: 'var(--ink-dim)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-raised)'; e.currentTarget.style.color = 'var(--ink-high)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-dim)'; }}
        >
          ←
        </button>
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <p className="flex-1 text-base font-semibold truncate" style={{ color: 'var(--ink-high)' }} title={session.problem}>
          {session.problem}
        </p>
        <span className="text-xs font-medium shrink-0 font-mono" style={{ color: style.color }}>{style.label}</span>
        {/* Retry — failed/cancelled only (§4.5: the loop closes failures, not
            successes). A standard secondary button (§4.4 tokens). */}
        {isPostMortem && navigate !== undefined && (
          <button
            type="button"
            data-testid="run-retry"
            onClick={startRetry}
            title="Reopen the composer prefilled with this run's intent and configuration — editable before send"
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold font-mono transition-opacity hover:opacity-80"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink-body)' }}
          >
            Retry
          </button>
        )}
        <ModePill mode={mode} onChange={onModeChange} readOnly={isTerminal} />
        <ExportEvidenceButton runId={session.id} disabled={!isTerminal} />
        {!isTerminal && onKill && (
          <button
            type="button"
            onClick={() => void onKill(session.id)}
            title="Kill run (Ctrl+K)"
            aria-label="Kill run"
            className="flex items-center justify-center w-6 h-6 rounded shrink-0 transition-opacity disabled:opacity-30"
            style={{ color: 'var(--status-fail)', opacity: 0.65 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.65'; }}
          >
            <StopIcon />
          </button>
        )}
      </div>

      {/* Run times (DES-UX-001 §7.5, slice Y2): started/ended/duration derived
          from the event log App already backfills — the DTO carries no
          timestamps; where the log lacks the events the line says so. */}
      <RunTimes runId={session.id} status={session.status} />

      {/* Process stepper — the run's map: every phase, in order, with its state at a glance. */}
      <ProcessStepper runId={session.id} units={ordered} executingUnitOrd={executingUnitOrd} />

      {/* The sticky now-bar (DES-RUN-NARRATOR §2): what is happening RIGHT NOW —
          always visible, outside the scroll region, with the artifacts chip and
          the jump-to-latest affordance. */}
      <NowBar
        view={view}
        orderedUnits={ordered}
        executingUnitOrd={executingUnitOrd}
        phaseOf={phaseOf}
        lastLine={lastLine}
        artifacts={artifacts}
        onJumpToLatest={jumpToLatest}
        onOpenFile={setEvidenceFile}
      />

      {/* Terminal runs carry three lenses on the same record (§8): the narrated
          feed (default), the evidence timeline (BB) and the Units spine (R). */}
      {isTerminal && (
        <div className="flex items-center gap-1 px-6 pt-2 shrink-0" role="tablist" aria-label="Run detail view">
          {([['feed', 'Feed', 'tab-feed'], ['timeline', 'Timeline', 'tab-timeline'], ['units', 'Units', 'tab-unit-list']] as const).map(([id, label, testId]) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={testId}
              aria-selected={runTab === id}
              onClick={() => setRunTab(id)}
              className="rounded-t px-3 py-1 text-xs font-semibold font-mono transition-colors"
              style={{
                background: runTab === id ? 'var(--surface-raised)' : 'transparent',
                color: runTab === id ? 'var(--ink-high)' : 'var(--ink-muted)',
                borderBottom: `2px solid ${runTab === id ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* The evidence timeline (§2, EC48) — FailureBanner stays the HEADLINE on a
          post-mortem run in EVERY lens (DES-UX-001 §1.3-1 is not undone). */}
      {isTerminal && runTab === 'timeline' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 py-3">
          {isPostMortem && (
            <FailureBanner view={view} log={log} {...(navigate === undefined ? {} : { navigate })} />
          )}
          <RunTimeline
            view={view}
            {...(navigate === undefined ? {} : { navigate })}
            onOpenFile={setEvidenceFile}
          />
        </div>
      )}

      {/* The Units lens: the slice-R post-mortem spine for failed/cancelled runs
          (unchanged), the crew#272 output blocks for completed ones. */}
      {isTerminal && runTab === 'units' && (
        isPostMortem ? (
          <div
            data-testid="thread"
            className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-3 max-w-3xl w-full mx-auto"
          >
            {/* slice Y (§7.4): the banner's "All runs ›" is a FAILURE-CONTEXT
                entry — it lands on /work with the Failed filter active. */}
            <FailureBanner view={view} log={log} {...(navigate === undefined ? {} : { navigate })} />
            <VerdictDetail runId={session.id} units={ordered} />
            <UnitList runId={session.id} units={ordered} onOpenFile={setEvidenceFile} />
          </div>
        ) : (
          <NarratorFeed
            view={view}
            orderedUnits={ordered}
            executingUnitOrd={executingUnitOrd}
            phaseOf={phaseOf}
            lens="units"
            onOpenFile={setEvidenceFile}
          />
        )
      )}

      {/* The narrated feed (§2): the ONE chronological stream — and the only
          scrolling region. On a post-mortem run FailureBanner stays the headline
          above it. */}
      {showFeed && (
        <>
          {isPostMortem && (
            <div className="px-4 pt-3 shrink-0 max-w-3xl w-full mx-auto">
              <FailureBanner view={view} log={log} {...(navigate === undefined ? {} : { navigate })} />
            </div>
          )}
          <NarratorFeed
            view={view}
            orderedUnits={ordered}
            executingUnitOrd={executingUnitOrd}
            phaseOf={phaseOf}
            lens="feed"
            onTargetInject={isTerminal ? undefined : setInjectTarget}
            onToggleTerminal={(cli, terminalId) =>
              setAgentTerminal((cur) => (cur?.cliKey === cli ? null : { cliKey: cli, terminalId }))}
            agentTerminalCli={agentTerminal?.cliKey ?? null}
            onOpenFile={setEvidenceFile}
            scrollRef={feedScrollRef}
          />
        </>
      )}

      {/* The evidence viewer: slice I's FileViewer, reused verbatim — populated
          from GET /runs/:id/files (readRunFile). Opened only by a clicked
          evidence reference; a daemon without the route falls back to the
          external open (which itself copy-falls-back), same as the Files panel. */}
      {evidenceFile !== null && (
        <FileViewer
          runId={session.id}
          path={evidenceFile}
          defaultTab="file"
          onClose={() => setEvidenceFile(null)}
          onUnsupported={() => {
            const p = evidenceFile;
            setEvidenceFile(null);
            void api.openPath(p, session.id).catch(() => {
              void navigator.clipboard.writeText(p).catch(() => { /* clipboard unavailable */ });
            });
          }}
        />
      )}

      {agentTerminal && (
        <div className="px-4 pb-3 shrink-0">
          <AgentTerminal
            terminalId={agentTerminal.terminalId}
            cliKey={agentTerminal.cliKey}
            onClose={() => setAgentTerminal(null)}
          />
        </div>
      )}

      {/* The pinned approval dock (§2): gates and elicitations live HERE — a
          sibling of the scroll region, never inside it, directly above the
          composer so steering happens where the user is already looking. */}
      <ApprovalDock view={view} onResolved={onRefresh} />

      {/* Composer (§7): live runs steer/inject; a terminal run's footer is the
          labelled follow-up bar (review #8), never an unlabelled launch form. */}
      {isTerminal ? (
        <FollowUpComposer
          session={session}
          onLaunched={onLaunched}
          navigate={navigate}
        />
      ) : (
        <ChatInput
          runId={session.id}
          runStatus={session.status}
          mode={mode}
          onLaunched={onLaunched}
          injectTarget={injectTarget}
          onClearInjectTarget={() => setInjectTarget('all')}
          {...(navigate !== undefined ? { navigate } : {})}
        />
      )}
    </div>
  );
}

/**
 * The route names a run the index has not resolved (DES-UX-001 §7.6, slice Z):
 * a just-launched run whose debounced `GET /runs` reconcile is still in flight,
 * or a bookmarked/reloaded mid-run URL racing the first fetch. Renders the
 * honest holding state — never the composer (the C3 "refresh mid-run drops to
 * a blank composer" defect). Zero requests of its own: the run index App
 * already owns is the one wire, and the same live-update cycle that lists the
 * run swaps this for the run view.
 */
function RunPendingView({ runId, runsLoaded, navigate }: {
  runId: string;
  runsLoaded: boolean;
  navigate?: (path: string) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col h-full items-center justify-center" data-testid="run-pending">
      <div className="flex flex-col items-center gap-3 max-w-md px-8 text-center">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
          style={{ background: 'var(--status-run)' }}
          aria-hidden="true"
        />
        <p className="text-sm font-mono" style={{ color: 'var(--ink-body)' }}>
          Opening run <span className="font-semibold" style={{ color: 'var(--ink-high)' }}>{runId}</span>
        </p>
        <p className="text-xs font-mono leading-relaxed" style={{ color: 'var(--ink-dim)' }}>
          {runsLoaded
            ? 'Not in the run index yet — a just-launched run appears within one live-update cycle; an id the daemon no longer serves will not.'
            : 'Fetching the run index…'}
        </p>
        {runsLoaded && (
          <a
            href="/work"
            className="text-xs font-mono underline transition-opacity hover:opacity-70"
            style={{ color: 'var(--ink-muted)' }}
            onClick={(e) => {
              if (navigate === undefined) return;
              e.preventDefault();
              navigate('/work');
            }}
          >
            All runs ›
          </a>
        )}
      </div>
    </div>
  );
}

function NewRunView({
  chatMode,
  mode,
  onModeChange,
  onLaunched,
  navigate,
  launchProjectId = null,
}: {
  chatMode: boolean;
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  onLaunched: (id: string) => void;
  navigate?: (path: string) => void;
  launchProjectId?: string | null;
}): React.ReactElement {
  const heading = chatMode
    ? 'What do you want to explore?'
    : 'What do you need built?';
  const sub = chatMode
    ? 'Ask about your repos, get answers, run searches, analyse patterns — without kicking off a full build.'
    : 'Describe your goal. The council elects a CLI, decomposes the plan, and executes it — you approve each gate.';

  return (
    <div className="flex flex-col h-full items-center justify-center">
      <div className="w-full max-w-2xl px-8 flex flex-col gap-5">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--ink-high)' }}>
            {heading}
          </h1>
          <p className="text-base leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {sub}
          </p>
        </div>
        <div className="flex justify-center">
          <ModePill mode={mode} onChange={onModeChange} />
        </div>
        <ChatInput
          embedded
          mode={mode}
          onLaunched={onLaunched}
          lockedProjectId={launchProjectId}
          {...(chatMode ? { workflowOverride: 'chat' } : {})}
          {...(navigate !== undefined ? { navigate } : {})}
        />
      </div>
    </div>
  );
}

export function ChatPanel({ view, chatMode, onLaunched, onNavigateBack, onRefresh, onKill, navigate, launchProjectId = null, pendingRunId = null, runsLoaded = false }: Props): React.ReactElement {
  const [mode, setMode] = useState<RunMode>('balanced');

  if (view) {
    const activeView = view;
    // Legacy chat runs (workflow_id='chat') are old single-unit council-routed sessions.
    // Render them as a simple conversation — no governance chrome, no work launcher.
    if (activeView.session.workflow_id === 'chat') {
      return <LegacyChatHistory view={activeView} onNavigateBack={onNavigateBack} />;
    }
    const isTerminal = ['completed', 'cancelled', 'failed'].includes(activeView.session.status);
    function handleModeChange(newMode: RunMode): void {
      setMode(newMode);
      if (!isTerminal) {
        void api.injectMessage(activeView.session.id, `mode:${newMode}`, 'all').catch(() => {
          // Best-effort: mode injection failure is non-fatal; the local state is already updated.
        });
      }
    }
    return (
      <RunChat
        key={activeView.session.id}
        view={activeView}
        mode={mode}
        onModeChange={handleModeChange}
        onLaunched={onLaunched}
        onNavigateBack={onNavigateBack}
        onRefresh={onRefresh}
        {...(onKill !== undefined ? { onKill } : {})}
        {...(navigate !== undefined ? { navigate } : {})}
      />
    );
  }
  // The route names a run the index has not resolved (slice Z): hold with the
  // honest pending state — never fall through to the composer under a run URL.
  if (pendingRunId !== null) {
    return (
      <RunPendingView
        runId={pendingRunId}
        runsLoaded={runsLoaded}
        {...(navigate !== undefined ? { navigate } : {})}
      />
    );
  }
  return (
    <NewRunView
      chatMode={chatMode ?? false}
      mode={mode}
      onModeChange={setMode}
      onLaunched={onLaunched}
      launchProjectId={launchProjectId}
      {...(navigate !== undefined ? { navigate } : {})}
    />
  );
}
