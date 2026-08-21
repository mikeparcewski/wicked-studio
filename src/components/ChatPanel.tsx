import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { lostQuorum, quorumLabel } from './councilQuorum.js';
import { api, downloadRunEvidence } from '../api/client.js';
import type { SessionView, StageKind, UnitStatus, WorkUnit } from '../api/types.js';
import { executingOrd } from '../api/run-state.js';
import { useGateStore } from '../store/gates.js';
import { useElicitationStore } from '../store/elicitations.js';
import { ElicitationPrompt } from './ElicitationPrompt.js';
import { useRuntimeStore, outputKey, type CouncilStatus } from '../store/runtime.js';
import { LiveEdge } from './LiveEdge.js';
import { STATUS_STYLE } from './RunCard.js';
import { SteeringGate } from './SteeringGate.js';
import { ChatInput } from './ChatInput.js';
import { AgentTerminal } from './AgentTerminal.js';
import { Markdown } from './Markdown.js';
import type { RunMode } from './runMode.js';
import { MODE_LABELS } from './runMode.js';
export type { RunMode } from './runMode.js';

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
 * ones dimmed. This is the run's map; the conversational timeline below it carries only the
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

/** Trailing window of live narration rendered per unit (~4KB). */
const NARRATION_TAIL = 4096;

/**
 * Live narration for the ACTIVE unit — the streamed `unitOutputDelta` /
 * `cliOutputDelta` text from the `/ws` CoreEvent stream (accumulated by the
 * runtime store into `outputs`), rendered inside the unit's block in place of
 * the old empty "Working…" wait. Collapsible, autoscrolled to the newest text,
 * and windowed to the trailing ~{@link NARRATION_TAIL} bytes so a chatty
 * worker never grows the thread's DOM unbounded (the store keeps its own
 * larger cap for the full-output consumers).
 */
function LiveNarration({ runId, ord, phase }: { runId: string; ord: number; phase: string }): React.ReactElement {
  const live = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  const [visible, setVisible] = useState(true);
  const scrollRef = useRef<HTMLPreElement>(null);

  // Pin the narration viewport to the newest text as chunks stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [live, visible]);

  const hasText = typeof live === 'string' && live.length > 0;
  const tail =
    hasText && live.length > NARRATION_TAIL ? '…' + live.slice(live.length - NARRATION_TAIL) : live;

  return (
    <div data-testid={`live-narration-${ord}`}>
      <div className="flex items-center gap-2 text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--status-run)' }} />
        {/* Phase label leads the entry (operator UX directive) — mirrors the done-unit header. */}
        <span className="font-medium" style={{ color: 'var(--status-run)' }}>{phase}</span>
        <span>{hasText ? 'Working — live output' : 'Working…'}</span>
        {hasText && (
          <button
            type="button"
            data-testid={`live-narration-toggle-${ord}`}
            onClick={() => setVisible((v) => !v)}
            className="ml-auto text-xs font-medium font-mono hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            {visible ? '▾ Hide live output' : '▸ Show live output'}
          </button>
        )}
      </div>
      {hasText && visible && (
        <pre
          ref={scrollRef}
          data-testid={`live-narration-text-${ord}`}
          className="mt-2 max-h-64 overflow-auto rounded-lg p-2.5 text-[11px] leading-snug whitespace-pre-wrap break-words font-mono"
          style={{ background: 'var(--surface-base)', color: 'var(--ink-body)', border: '1px solid var(--surface-raised)' }}
        >
          {tail}
        </pre>
      )}
    </div>
  );
}

function DegradedRoutingBanner({ reason }: { reason: string }): React.ReactElement {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detailId = 'degraded-routing-detail';
  if (dismissed) return <></>;
  return (
    <div
      className="self-start max-w-[85%] rounded-xl px-4 py-2.5 text-xs font-mono flex flex-col gap-1.5"
      style={{ background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)', color: 'var(--status-gate)' }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0" aria-hidden="true">⚠</span>
        <span className="flex-1">Degraded routing: {reason}</span>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 text-[10px] transition-opacity hover:opacity-70"
          style={{ color: 'var(--status-gate)', opacity: 0.7 }}
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={expanded ? 'Hide explanation' : 'Show explanation'}
        >
          {expanded ? '▲' : '▼'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 transition-opacity hover:opacity-70"
          style={{ color: 'var(--status-gate)', opacity: 0.6 }}
          aria-label="Dismiss degraded routing warning"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {expanded && (
        <p id={detailId} className="text-[10px] leading-relaxed pl-5" style={{ color: 'var(--status-gate)', opacity: 0.7 }}>
          The multi-model council could not reach a quorum vote. The unit proceeded using a
          fallback routing strategy. Open the <strong>Decisions</strong> section in the Insights
          panel on the right to see each reviewer's verdict.
        </p>
      )}
    </div>
  );
}

function CliAvatar({ cli }: { cli: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold font-mono select-none"
      style={{ background: CLI_AVATAR.bg, color: CLI_AVATAR.fg }}
    >
      {cliInitials(cli)}
    </span>
  );
}

// Stage pill — the methodology stage is process vocabulary, not run state, so
// it reads as quiet ink on a raised surface (§1.5 rule 2: color is signal;
// four always-on badge hues would out-shout the actual status layer).
const STAGE_BADGE: Record<StageKind, { bg: string; color: string }> = {
  recon:   { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
  build:   { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
  review:  { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
  test:    { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' },
};

const UNIT_STATUS_TEXT: Record<UnitStatus, string> = {
  pending:     'queued',
  distributed: 'dispatched',
  done:        'done',
  rejected:    'rejected',
};

function unitKey(runId: string, unitId: string, ord: number): string {
  return unitId.startsWith(`${runId}:`) ? unitId.slice(runId.length + 1) : `u${ord}`;
}

/**
 * The unit's phase name for its output header (crew#272). Workflow units are keyed
 * `<run>:<phase_id>` (`run-1:survey` → `survey`); free-text units carry only the
 * synthetic `u<ord>` suffix, so the methodology stage is the closest thing to a
 * phase name they have.
 */
function phaseName(runId: string, unit: WorkUnit): string {
  const key = unitKey(runId, unit.id, unit.ord);
  return /^u\d+$/.test(key) ? unit.stage : key;
}

const SYSTEM_EVENT_TYPES = new Set([
  'sessionStarted', 'sessionCompleted', 'sessionFailed',
  'awaitingHuman', 'gateDecided', 'resumed', 'runCancelled',
  'workerMessageQueued', 'workerMessageInjected',
]);

const ACTION_EVENT_TYPES = new Set(['stepFailed', 'crashRecoveryRedrive', 'workerStalled', 'failureTriaged']);

function systemEventLabel(type: string, detail: string): string {
  switch (type) {
    case 'sessionStarted':   return 'Run started';
    case 'sessionCompleted': return '✓ Run completed';
    case 'sessionFailed':    return '✗ Run failed';
    case 'awaitingHuman':    return 'Waiting for your input…';
    case 'gateDecided':      return detail.includes('allow') ? 'Gate: allow' : 'Gate: deny';
    case 'resumed':          return 'Run resumed';
    case 'runCancelled':     return 'Run cancelled';
    case 'workerMessageQueued':   return `Message queued for next turn — ${detail}`;
    case 'workerMessageInjected': return `Message delivered — ${detail}`;
    default:                 return detail;
  }
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

function StepFailedCard({
  detail,
  onStop,
  canStop,
}: {
  detail: string;
  onStop: () => void;
  canStop: boolean;
}): React.ReactElement {
  return (
    <div
      className="self-start max-w-[85%] rounded-xl px-4 py-3 flex flex-col gap-2 font-mono text-xs"
      style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)', color: 'var(--status-fail)' }}
    >
      <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wide">
        <span>⚠</span>
        <span>Step failure</span>
      </div>
      {detail && (
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words m-0 overflow-hidden" style={{ color: 'var(--ink-muted)', fontFamily: 'inherit' }}>
          {detail.length > 200 ? `${detail.slice(0, 200)}…` : detail}
        </pre>
      )}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          title="Reassign not yet available"
          disabled
          className="rounded px-3 py-1 text-[11px] font-semibold opacity-30 cursor-not-allowed"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)' }}
        >
          Reassign
        </button>
        <button
          type="button"
          onClick={canStop ? onStop : undefined}
          disabled={!canStop}
          className="rounded px-3 py-1 text-[11px] font-semibold transition-opacity hover:opacity-100 opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
        >
          Stop run
        </button>
      </div>
    </div>
  );
}

function CrashRedriveCard({ attempt }: { attempt: number }): React.ReactElement {
  return (
    <div
      className="self-start max-w-[85%] rounded-xl px-4 py-3 flex flex-col gap-1 font-mono text-xs"
      style={{ background: 'var(--status-gate-dim)', border: '1px solid var(--status-gate-dim)', color: 'var(--status-gate)' }}
    >
      <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wide">
        <span>↺</span>
        <span>Crash recovery — attempt {attempt}</span>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        The engine restarted and is re-dispatching this unit automatically.
      </p>
    </div>
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
                    <CliAvatar cli={unit.assigned_cli} />
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
  // it. Memoized so neither reruns while `units` is unchanged; the cursor read in particular used to
  // happen per unit, each call re-sorting the plan from inside the loop (PR #179 review).
  const ordered = useMemo(() => [...units].sort((a, b) => a.ord - b.ord), [units]);
  const executingUnitOrd = useMemo(() => executingOrd(session, units), [session, units]);
  // The conversational timeline holds ONLY phases that have run or are running (rejected counts:
  // it ran far enough to be judged). Future work is the stepper's job — a queued unit used to
  // render one tall, empty "Not started" block per phase, which is what the operator flagged.
  const timeline = useMemo(
    () =>
      ordered.filter(
        (u) =>
          u.status === 'done' ||
          u.status === 'rejected' ||
          (u.status === 'distributed' && u.ord === executingUnitOrd),
      ),
    [ordered, executingUnitOrd],
  );
  const gate = useGateStore((s) => s.gates[session.id]);
  const elicitation = useElicitationStore((s) => s.elicitations[session.id]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];
  /** "all" broadcasts; any other value is a CLI key (set by clicking an agent card). */
  const [injectTarget, setInjectTarget] = useState<string>('all');
  const terminalIds = useRuntimeStore((s) => s.terminalIds);

  const [agentTerminal, setAgentTerminal] = useState<{ cliKey: string; terminalId: string } | null>(null);
  const [transcripts, setTranscripts] = useState<
    Record<number, { text: string | null; loading: boolean; visible: boolean }>
  >({});
  const autoLoadedOrds = useRef<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline.length, log.length]);

  useEffect(() => {
    for (const unit of units) {
      if (unit.status === 'done' && !autoLoadedOrds.current.has(unit.ord)) {
        autoLoadedOrds.current.add(unit.ord);
        setTranscripts((prev) => ({
          ...prev,
          [unit.ord]: { text: null, loading: true, visible: true },
        }));
        void api
          .getUnitOutput(session.id, unitKey(session.id, unit.id, unit.ord))
          .then(({ output, outputUnavailable }) => {
            // "(no transcript captured)" is FALSE for a denied unit — its output was captured and
            // then deliberately not stored. Say what the daemon says (FINDING-006).
            setTranscripts((prev) => ({
              ...prev,
              [unit.ord]: {
                text: output ?? outputUnavailable ?? '(no transcript captured)',
                loading: false,
                visible: true,
              },
            }));
          })
          .catch(() => {
            setTranscripts((prev) => ({
              ...prev,
              [unit.ord]: { text: '(transcript unavailable)', loading: false, visible: true },
            }));
          });
      }
    }
  }, [units, session.id]);

  function toggleTranscript(ord: number): void {
    setTranscripts((prev) => {
      const entry = prev[ord];
      if (!entry) return prev;
      return { ...prev, [ord]: { ...entry, visible: !entry.visible } };
    });
  }

  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: '', color: 'var(--ink-muted)' };
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(session.status);
  // Keep action + system events interleaved in arrival order (log is seq-ordered).
  const eventLog = log.filter((e) => SYSTEM_EVENT_TYPES.has(e.type) || ACTION_EVENT_TYPES.has(e.type));
  const dotColor = statusDotColor(session.status);
  const pulse = ['executing', 'distributing', 'planning', 'awaiting_human'].includes(session.status);

  function stopRun(): void {
    void onKill?.(session.id);
  }

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

      {/* Process stepper — the run's map: every phase, in order, with its state at a glance.
          The timeline below renders only the phases that have entered the conversation. */}
      <ProcessStepper runId={session.id} units={ordered} executingUnitOrd={executingUnitOrd} />

      {/* Message thread. `data-testid="thread"` + `data-message-id` are the contract the
          version → message cross-link resolves against (DES-MERGE-001 §7.6); the strip
          addresses the thread through the DOM because they are sibling surfaces. */}
      <div
        data-testid="thread"
        className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-3xl w-full mx-auto"
      >
        {/* An open MCP elicitation suspends the agent's turn, so it leads the stream (DES-002).
            `key` is REQUIRED: React reuses the instance across prop changes, so without it a
            half-typed answer to elicitation A survives into B (v0.24 F3). */}
        {elicitation !== undefined && (
          <div className="self-center w-full max-w-lg">
            <ElicitationPrompt key={elicitation.elicitationId} e={elicitation} />
          </div>
        )}

        {/* User prompt bubble */}
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

        {/* Phase entries — only phases that have run or are running; gate panel injected
            inline before the unit it blocks when that unit has already entered the thread */}
        {timeline.flatMap((unit) => {
          const tc = transcripts[unit.ord];
          const stageBadge = STAGE_BADGE[unit.stage] ?? { bg: 'var(--surface-raised)', color: 'var(--ink-muted)' };
          const gateBeforeThis = session.status === 'awaiting_human' && gate?.ord === unit.ord;
          const unitEl = (
            <div key={unit.id} data-message-id={unit.id} className="flex flex-col gap-2">
              {/* Council routing pill */}
              {unit.routing !== null && unit.routing.method === 'council' && (
                <div
                  className="self-start max-w-[85%] rounded-xl px-4 py-2 text-xs flex items-center gap-2 font-mono"
                  style={{ background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', color: 'var(--accent)' }}
                >
                  <span className="shrink-0">⚖</span>
                  <span>
                    <span className="font-semibold">Council → {unit.assigned_cli ?? '?'}</span>
                    <span className="ml-2" style={{ color: 'var(--accent)', opacity: 0.7 }}>
                      {quorumLabel(unit.routing)} · {unit.routing.agreement_pct}% agree · {unit.routing.dissent} dissent
                      {lostQuorum(unit.routing) && (
                        <span className="ml-2" style={{ color: 'var(--status-gate)' }}>· quorum lost</span>
                      )}
                    </span>
                  </span>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'evaluator_distinct' && (
                <div
                  className="self-start max-w-[85%] rounded-xl px-4 py-2 text-xs flex items-center gap-2 font-mono"
                  style={{ background: 'var(--accent-subtle)', border: '1px solid var(--accent-subtle)', color: 'var(--accent)' }}
                >
                  <span className="shrink-0">⚖</span>
                  <span>
                    <span className="font-semibold">Evaluator-distinct → {unit.assigned_cli ?? '?'}</span>
                    <span className="ml-2" style={{ color: 'var(--accent)', opacity: 0.7 }}>(was: {unit.routing.was})</span>
                  </span>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'degraded' && (
                <DegradedRoutingBanner reason={unit.routing.reason} />
              )}

              {/* Agent response card */}
              <div className="self-start max-w-[85%] flex flex-col gap-2">
                {/* Meta row: avatar + attribution + stage + governance (clickable to target inject when agent is assigned) */}
                <div className="flex items-center gap-2 flex-wrap">
                  {unit.assigned_cli ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setInjectTarget(unit.assigned_cli!)}
                        title={`Target ${unit.assigned_cli}`}
                        aria-label={`Send message to ${unit.assigned_cli} only`}
                        className="flex items-center gap-2 rounded-lg p-0 pr-1 transition-opacity hover:opacity-80"
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        <CliAvatar cli={unit.assigned_cli} />
                        <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                          {unit.assigned_cli}
                          <span style={{ color: 'var(--ink-dim)' }}> · unit {unit.ord}</span>
                        </span>
                      </button>
                      {terminalIds[`${session.id}:${unit.assigned_cli}`] && (
                        <button
                          type="button"
                          aria-pressed={agentTerminal?.cliKey === unit.assigned_cli}
                          aria-label={agentTerminal?.cliKey === unit.assigned_cli ? `Close ${unit.assigned_cli} terminal` : `Open ${unit.assigned_cli} terminal`}
                          title={agentTerminal?.cliKey === unit.assigned_cli ? `Close ${unit.assigned_cli} terminal` : `Open ${unit.assigned_cli} terminal`}
                          onClick={() => {
                            const cli = unit.assigned_cli!;
                            const tid = terminalIds[`${session.id}:${cli}`];
                            setAgentTerminal(agentTerminal?.cliKey === cli ? null : { cliKey: cli, terminalId: tid! });
                          }}
                          className="text-xs rounded px-1 py-0.5 transition-opacity hover:opacity-80"
                          style={{ background: 'var(--surface-raised)', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}
                        >
                          ⌨
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full shrink-0" style={{ background: 'var(--surface-raised)' }} />
                      <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                        agent
                        <span style={{ color: 'var(--ink-dim)' }}> · unit {unit.ord}</span>
                      </span>
                    </div>
                  )}
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide font-mono"
                    style={{ background: stageBadge.bg, color: stageBadge.color }}
                  >
                    {unit.stage}
                  </span>
                  {unit.has_validator_pin && (
                    <span role="img" aria-label="Governance floor armed" style={{ color: 'var(--status-gate)', fontSize: '12px' }}>🔒</span>
                  )}
                  <span className="text-xs font-mono truncate max-w-xs" style={{ color: 'var(--ink-dim)' }} title={unit.description}>
                    {unit.description}
                  </span>
                </div>

                {/* Content card */}
                <div
                  className="rounded-2xl px-5 py-4"
                  style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
                >
                  {/* A `distributed` unit is in the timeline ONLY as the cursor unit of an
                      executing run (FINDING-052: distributed = routed, not running — queued
                      units live in the stepper now, never as thread blocks). */}
                  {unit.status === 'distributed' && (
                    <LiveNarration runId={session.id} ord={unit.ord} phase={phaseName(session.id, unit)} />
                  )}
                  {unit.status === 'done' && (
                    <div data-testid={`unit-output-${unit.ord}`}>
                      {/* Output header: phase name + status (crew#272) */}
                      <div className="flex items-center gap-2 text-sm font-mono">
                        <span style={{ color: 'var(--status-done)' }}>✓</span>
                        <span className="font-medium" style={{ color: 'var(--status-done)' }}>{phaseName(session.id, unit)}</span>
                        <span className="text-xs" style={{ color: 'var(--ink-dim)' }}>{UNIT_STATUS_TEXT[unit.status]}</span>
                        <button
                          type="button"
                          data-testid={`unit-output-toggle-${unit.ord}`}
                          onClick={() => toggleTranscript(unit.ord)}
                          className="ml-auto text-xs font-medium font-mono hover:underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          {tc?.visible ? '▾ Hide output' : '▸ Show output'}
                        </button>
                      </div>
                      {/* The unit's OUTPUT is the primary message body (crew#272): auto-loaded,
                          expanded, and rendered in the main flow — not buried behind a
                          transcript toggle the user has to dig for. */}
                      {tc?.visible && (
                        <div className="mt-2.5 max-h-[28rem] overflow-y-auto">
                          {tc.loading
                            ? <span className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>Loading output…</span>
                            : <Markdown className="whitespace-pre-wrap">{tc.text ?? ''}</Markdown>
                          }
                        </div>
                      )}
                    </div>
                  )}
                  {unit.status === 'rejected' && (
                    <div className="text-sm font-medium font-mono" style={{ color: 'var(--status-fail)' }}>
                      Rejected{unit.denial_reason ? `: ${unit.denial_reason}` : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
          if (gateBeforeThis) {
            return [
              <div key={`gate-before-${unit.id}`} className="self-center w-full max-w-lg">
                <SteeringGate
                  runId={session.id}
                  {...(gate ? { ord: gate.ord, prompt: gate.prompt } : {})}
                  onResolved={onRefresh}
                />
              </div>,
              unitEl,
            ];
          }
          return [unitEl];
        })}

        {/* Action cards + system event pills — rendered in arrival (seq) order */}
        {eventLog.map((entry) => {
          if (entry.type === 'stepFailed') {
            return (
              <div key={entry.seq} className="flex flex-col gap-2">
                <StepFailedCard
                  detail={entry.detail}
                  onStop={stopRun}
                  canStop={onKill !== undefined && !isTerminal}
                />
              </div>
            );
          }
          if (entry.type === 'crashRecoveryRedrive') {
            return (
              <div key={entry.seq} className="flex flex-col gap-2">
                <CrashRedriveCard attempt={entry.attempt ?? 1} />
              </div>
            );
          }
          return (
            <div key={entry.seq} className="flex justify-center">
              <span
                className="text-xs rounded-full px-3 py-1 font-mono"
                style={{ color: 'var(--ink-dim)', background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
              >
                {systemEventLabel(entry.type, entry.detail)}
              </span>
            </div>
          );
        })}

        {/* Steering gate — fallback position when the gated unit has no timeline entry. This is
            now the COMMON path: awaiting_human pauses BEFORE a not-yet-started unit, and queued
            units no longer render as thread blocks, so the card lands here — after everything
            that has already run, which is exactly where the pause chronologically is. */}
        {session.status === 'awaiting_human' && !timeline.some((u) => gate?.ord === u.ord) && (
          <div className="self-center w-full max-w-lg">
            <SteeringGate
              runId={session.id}
              {...(gate ? { ord: gate.ord, prompt: gate.prompt } : {})}
              onResolved={onRefresh}
            />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {agentTerminal && (
        <div className="px-4 pb-3 shrink-0">
          <AgentTerminal
            terminalId={agentTerminal.terminalId}
            cliKey={agentTerminal.cliKey}
            onClose={() => setAgentTerminal(null)}
          />
        </div>
      )}
      <ChatInput
        runId={isTerminal ? null : session.id}
        runStatus={isTerminal ? null : session.status}
        mode={mode}
        onLaunched={onLaunched}
        injectTarget={injectTarget}
        onClearInjectTarget={() => setInjectTarget('all')}
        {...(navigate !== undefined ? { navigate } : {})}
      />
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

export function ChatPanel({ view, chatMode, onLaunched, onNavigateBack, onRefresh, onKill, navigate, launchProjectId = null }: Props): React.ReactElement {
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
