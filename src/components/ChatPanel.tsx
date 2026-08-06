import { useEffect, useMemo, useRef, useState } from 'react';
import { lostQuorum, quorumLabel } from './councilQuorum.js';
import { api, downloadRunEvidence } from '../api/client.js';
import type { SessionView, StageKind, UnitStatus } from '../api/types.js';
import { executingOrd } from '../api/run-state.js';
import { useGateStore } from '../store/gates.js';
import { useElicitationStore } from '../store/elicitations.js';
import { ElicitationPrompt } from './ElicitationPrompt.js';
import { useRuntimeStore, outputKey } from '../store/runtime.js';
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
}

// Per-CLI identity: consistent avatar colours across multi-agent runs
const CLI_COLORS: Record<string, { bg: string; fg: string }> = {
  claude:      { bg: 'rgba(139,92,246,0.25)',  fg: '#c4b5fd' },
  codex:       { bg: 'rgba(59,130,246,0.25)',  fg: '#93c5fd' },
  antigravity: { bg: 'rgba(34,197,94,0.2)',   fg: '#86efac' },
  cursor:      { bg: 'rgba(20,184,166,0.2)',   fg: '#5eead4' },
};
const CLI_FALLBACK = { bg: 'rgba(230,237,243,0.1)', fg: 'rgba(230,237,243,0.55)' };

function cliInitials(key: string): string {
  const parts = key.split(/[-_]/);
  if (parts.length > 1) return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  return key.slice(0, 2).toUpperCase();
}

/**
 * Live council deliberation status for a pending unit, derived from the
 * councilConvened / councilSeatFailed / councilDeliberated (below-bar runoff) / councilVoted
 * frames.
 *
 * Seats that failed are shown alongside the agreement percentage, not instead of it. A council
 * that convened three seats and heard from one still reports 100% agreement — true of the votes
 * cast, and misleading on its own.
 */
function CouncilDeliberation({ runId, ord }: { runId: string; ord: number }): React.ReactElement {
  const status = useRuntimeStore((s) => s.councilStatus[`${runId}:${ord}`]);
  const label = !status
    ? 'Council deliberating…'
    : status.state === 'convened'
      ? `Council convened — polling ${status.clis?.length ?? '?'} CLI${(status.clis?.length ?? 0) === 1 ? '' : 's'}…`
      : status.state === 'deliberating'
        ? `Ballot ${status.round ?? '?'}: ${status.agreementPct ?? '?'}% — below the ${status.neededPct ?? 75}% bar, runoff in progress…`
        : `Council voted — ${status.agreementPct ?? '?'}% agreement (${status.votes ?? '?'} votes)`;
  const failed = status?.failedSeats ?? [];
  return (
    <div
      className="flex flex-col gap-1 text-xs font-mono rounded-lg px-3 py-2"
      style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)', color: '#a78bfa' }}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${status?.state === 'voted' ? '' : 'animate-pulse'}`}
          style={{ background: '#a78bfa' }}
        />
        <span>{label}</span>
      </div>
      {failed.length > 0 && (
        // `why` is CRLF-normalized in the store, so a Windows seat's stderr does not put stray
        // carriage returns into the tooltip.
        <div className="pl-3.5" style={{ color: '#fca5a5' }} title={failed.map((f) => `${f.cli}: ${f.why}`).join('\n')}>
          {failed.length} seat{failed.length === 1 ? '' : 's'} did not vote —{' '}
          {failed.map((f) => `${f.cli} (${f.kind})`).join(', ')}
        </div>
      )}
    </div>
  );
}

/** Shows the last few lines of live ACP output while a unit is executing. */
function LiveOutputPreview({ runId, ord }: { runId: string; ord: number }): React.ReactElement | null {
  const live = useRuntimeStore((s) => s.outputs[outputKey(runId, ord)]);
  if (!live) return null;
  // Show the trailing 800 chars so the display stays compact.
  const tail = live.length > 800 ? '…' + live.slice(live.length - 800) : live;
  return (
    <pre
      className="mt-2 max-h-48 overflow-auto rounded-lg p-2 text-[10px] leading-snug whitespace-pre-wrap font-mono"
      style={{ background: 'rgba(13,17,23,0.6)', color: 'rgba(230,237,243,0.65)', border: '1px solid rgba(230,237,243,0.06)' }}
    >
      {tail}
    </pre>
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
      style={{ background: 'rgba(255,218,25,0.08)', border: '1px solid rgba(255,218,25,0.2)', color: '#ffda19' }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0" aria-hidden="true">⚠</span>
        <span className="flex-1">Degraded routing: {reason}</span>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 text-[10px] transition-opacity hover:opacity-70"
          style={{ color: 'rgba(255,218,25,0.6)' }}
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
          style={{ color: 'rgba(255,218,25,0.5)' }}
          aria-label="Dismiss degraded routing warning"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {expanded && (
        <p id={detailId} className="text-[10px] leading-relaxed pl-5" style={{ color: 'rgba(255,218,25,0.6)' }}>
          The multi-model council could not reach a quorum vote. The unit proceeded using a
          fallback routing strategy. Open the <strong>Decisions</strong> section in the Insights
          panel on the right to see each reviewer's verdict.
        </p>
      )}
    </div>
  );
}

function CliAvatar({ cli }: { cli: string }): React.ReactElement {
  const { bg, fg } = CLI_COLORS[cli.toLowerCase()] ?? CLI_FALLBACK;
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold font-mono select-none"
      style={{ background: bg, color: fg }}
    >
      {cliInitials(cli)}
    </span>
  );
}

// Stage pill — wicked dark palette
const STAGE_BADGE: Record<StageKind, { bg: string; color: string }> = {
  recon:   { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa' },
  build:   { bg: 'rgba(63,185,80,0.12)',  color: '#3fb950' },
  review:  { bg: 'rgba(121,192,255,0.12)',color: '#79c0ff' },
  test:    { bg: 'rgba(255,218,25,0.12)', color: '#ffda19' },
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

function statusDotColor(status: string): string {
  switch (status) {
    case 'completed':      return '#3fb950';
    case 'failed':        return '#f85149';
    case 'cancelled':     return 'rgba(230,237,243,0.25)';
    case 'awaiting_human': return '#ffda19';
    default:              return '#79c0ff';
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
          style={{ color: '#f85149' }}
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
        style={{ color: error ? '#f85149' : '#79c0ff', opacity: inert ? 0.3 : 0.65 }}
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
      style={{ background: 'rgba(248,81,73,0.07)', border: '1px solid rgba(248,81,73,0.25)', color: '#f85149' }}
    >
      <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wide">
        <span>⚠</span>
        <span>Step failure</span>
      </div>
      {detail && (
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words m-0 overflow-hidden" style={{ color: 'rgba(230,237,243,0.6)', fontFamily: 'inherit' }}>
          {detail.length > 200 ? `${detail.slice(0, 200)}…` : detail}
        </pre>
      )}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          title="Reassign not yet available"
          disabled
          className="rounded px-3 py-1 text-[11px] font-semibold opacity-30 cursor-not-allowed"
          style={{ background: 'rgba(230,237,243,0.08)', color: '#e6edf3' }}
        >
          Reassign
        </button>
        <button
          type="button"
          onClick={canStop ? onStop : undefined}
          disabled={!canStop}
          className="rounded px-3 py-1 text-[11px] font-semibold transition-opacity hover:opacity-100 opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}
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
      style={{ background: 'rgba(255,218,25,0.06)', border: '1px solid rgba(255,218,25,0.2)', color: '#ffda19' }}
    >
      <div className="flex items-center gap-2 font-semibold text-[11px] uppercase tracking-wide">
        <span>↺</span>
        <span>Crash recovery — attempt {attempt}</span>
      </div>
      <p className="text-[11px]" style={{ color: 'rgba(230,237,243,0.5)' }}>
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
        background: 'rgba(230,237,243,0.06)',
        border: '1px solid rgba(230,237,243,0.1)',
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
          style={
            mode === m
              ? { background: 'rgba(255,218,25,0.15)', color: readOnly ? 'rgba(255,218,25,0.7)' : '#ffda19' }
              : { background: 'transparent', color: 'rgba(230,237,243,0.35)' }
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
            // `outputUnavailable` rather than a bare null: a denied unit has no stored transcript
            // BY DESIGN, and the pane must say so instead of rendering blank (FINDING-006).
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
        style={{ borderBottom: '1px solid rgba(230,237,243,0.07)', background: '#1b222e' }}
      >
        <button
          type="button"
          onClick={onNavigateBack}
          aria-label="Back"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0"
          style={{ color: 'rgba(230,237,243,0.4)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(230,237,243,0.06)'; e.currentTarget.style.color = '#e6edf3'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(230,237,243,0.4)'; }}
        >
          ←
        </button>
        <p className="flex-1 text-base font-semibold truncate" style={{ color: '#e6edf3' }} title={session.problem}>
          {session.problem}
        </p>
        <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>legacy chat</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-3xl w-full mx-auto">
        <div className="flex justify-end">
          <div
            className="max-w-[72%] rounded-2xl text-base px-5 py-3.5 leading-relaxed"
            style={{ background: '#224a5e', color: '#e6edf3', border: '1px solid rgba(230,237,243,0.12)' }}
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
                    <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.55)' }}>
                      {unit.assigned_cli}
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.55)' }}>agent</span>
                )}
              </div>
              <div
                className="rounded-2xl px-5 py-4"
                style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.08)' }}
              >
                {tc?.loading && (
                  <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>Loading…</span>
                )}
                {!tc?.loading && tc?.text && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setTranscripts((prev) => ({ ...prev, [unit.ord]: { ...prev[unit.ord]!, visible: !tc.visible } }))}
                      className="text-xs font-medium font-mono hover:underline"
                      style={{ color: '#79c0ff' }}
                    >
                      {tc.visible ? '▾ Hide response' : '▸ View response'}
                    </button>
                    {tc.visible && (
                      <div className="mt-2.5 max-h-96 overflow-auto rounded-xl p-4" style={{ background: '#0d1117' }}>
                        <Markdown className="whitespace-pre-wrap">{tc.text}</Markdown>
                      </div>
                    )}
                  </div>
                )}
                {!tc?.loading && !tc?.text && (
                  <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
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
}: {
  view: SessionView;
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  onLaunched: (runId: string) => void;
  onNavigateBack: () => void;
  onRefresh: () => void;
  onKill?: (runId: string) => void | Promise<void>;
}): React.ReactElement {
  const { session, units } = view;
  // `ord` order is what `unit_ix` indexes into, so both the render order and the cursor derive from
  // it. Memoized so neither reruns while `units` is unchanged; the cursor read in particular used to
  // happen per unit, each call re-sorting the plan from inside the loop (PR #179 review).
  const ordered = useMemo(() => [...units].sort((a, b) => a.ord - b.ord), [units]);
  const executingUnitOrd = useMemo(() => executingOrd(session, units), [session, units]);
  const gate = useGateStore((s) => s.gates[session.id]);
  const elicitation = useElicitationStore((s) => s.elicitations[session.id]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];
  const executorTypes = useRuntimeStore((s) => s.executorTypes);
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
  }, [units.length, log.length]);

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

  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: '', color: 'rgba(230,237,243,0.5)' };
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
        style={{ borderBottom: '1px solid rgba(230,237,243,0.07)', background: '#1b222e' }}
      >
        <button
          type="button"
          onClick={onNavigateBack}
          aria-label="Back to run list"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0"
          style={{ color: 'rgba(230,237,243,0.4)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(230,237,243,0.06)'; e.currentTarget.style.color = '#e6edf3'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(230,237,243,0.4)'; }}
        >
          ←
        </button>
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${pulse ? 'animate-pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <p className="flex-1 text-base font-semibold truncate" style={{ color: '#e6edf3' }} title={session.problem}>
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
            style={{ color: '#f85149', opacity: 0.65 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.65'; }}
          >
            <StopIcon />
          </button>
        )}
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-3xl w-full mx-auto">
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
            className="max-w-[72%] rounded-2xl text-base px-5 py-3.5 leading-relaxed"
            style={{ background: '#224a5e', color: '#e6edf3', border: '1px solid rgba(230,237,243,0.12)' }}
          >
            {session.problem}
          </div>
        </div>

        {/* Unit messages — gate panel injected inline before the unit it blocks */}
        {ordered.flatMap((unit) => {
          const tc = transcripts[unit.ord];
          const stageBadge = STAGE_BADGE[unit.stage] ?? { bg: 'rgba(230,237,243,0.08)', color: 'rgba(230,237,243,0.5)' };
          const gateBeforeThis = session.status === 'awaiting_human' && gate?.ord === unit.ord;
          const unitEl = (
            <div key={unit.id} className="flex flex-col gap-2">
              {/* Council routing pill */}
              {unit.routing !== null && unit.routing.method === 'council' && (
                <div
                  className="self-start max-w-[85%] rounded-xl px-4 py-2 text-xs flex items-center gap-2 font-mono"
                  style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}
                >
                  <span className="shrink-0">⚖</span>
                  <span>
                    <span className="font-semibold">Council → {unit.assigned_cli ?? '?'}</span>
                    <span className="ml-2" style={{ color: 'rgba(167,139,250,0.6)' }}>
                      {quorumLabel(unit.routing)} · {unit.routing.agreement_pct}% agree · {unit.routing.dissent} dissent
                      {lostQuorum(unit.routing) && (
                        <span className="ml-2" style={{ color: '#ffda19' }}>· quorum lost</span>
                      )}
                    </span>
                  </span>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'evaluator_distinct' && (
                <div
                  className="self-start max-w-[85%] rounded-xl px-4 py-2 text-xs flex items-center gap-2 font-mono"
                  style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}
                >
                  <span className="shrink-0">⚖</span>
                  <span>
                    <span className="font-semibold">Evaluator-distinct → {unit.assigned_cli ?? '?'}</span>
                    <span className="ml-2" style={{ color: 'rgba(167,139,250,0.6)' }}>(was: {unit.routing.was})</span>
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
                        <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.55)' }}>
                          {unit.assigned_cli}
                          <span style={{ color: 'rgba(230,237,243,0.3)' }}> · unit {unit.ord}</span>
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
                          style={{ background: 'rgba(230,237,243,0.06)', border: 'none', cursor: 'pointer', color: 'rgba(230,237,243,0.55)', fontFamily: 'monospace' }}
                        >
                          ⌨
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full shrink-0" style={{ background: 'rgba(230,237,243,0.06)' }} />
                      <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.55)' }}>
                        agent
                        <span style={{ color: 'rgba(230,237,243,0.3)' }}> · unit {unit.ord}</span>
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
                    <span role="img" aria-label="Governance floor armed" style={{ color: '#ffda19', fontSize: '12px' }}>🔒</span>
                  )}
                  <span className="text-xs font-mono truncate max-w-xs" style={{ color: 'rgba(230,237,243,0.35)' }} title={unit.description}>
                    {unit.description}
                  </span>
                </div>

                {/* Content card */}
                <div
                  className="rounded-2xl px-5 py-4"
                  style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.08)' }}
                >
                  {unit.status === 'distributed' && unit.ord === executingUnitOrd && (
                    <div>
                      <div className="flex items-center gap-2 text-sm font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#79c0ff' }} />
                        <span>Working…</span>
                      </div>
                      <LiveOutputPreview runId={session.id} ord={unit.ord} />
                    </div>
                  )}
                  {/* Routed but not dispatched. `isTerminal` used to be the test here, which made
                      every queued unit of a merely PAUSED run claim to be working (FINDING-052). */}
                  {unit.status === 'distributed' && unit.ord !== executingUnitOrd && (
                    <div className="flex items-center gap-2 text-sm font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
                      <span>—</span>
                      <span>Not started</span>
                    </div>
                  )}
                  {unit.status === 'done' && (
                    <div className="flex items-center gap-2 text-sm font-mono" style={{ color: '#3fb950' }}>
                      <span>✓</span>
                      <span className="font-medium">{UNIT_STATUS_TEXT[unit.status]}</span>
                    </div>
                  )}
                  {unit.status === 'rejected' && (
                    <div className="text-sm font-medium font-mono" style={{ color: '#f85149' }}>
                      Rejected{unit.denial_reason ? `: ${unit.denial_reason}` : ''}
                    </div>
                  )}
                  {unit.status === 'pending' && (() => {
                    // Unknown executor type (late join — unitPlanned fired before the WS
                    // connected, and there is no replay) defaults to agent: council units
                    // dominate, and tool units correct themselves on the next live frame.
                    const executorType = executorTypes[`${session.id}:${unit.ord}`];
                    const isAgent = executorType ? executorType === 'agent' : true;
                    return isAgent ? (
                      <CouncilDeliberation runId={session.id} ord={unit.ord} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(230,237,243,0.2)' }} />
                        <span>Queued</span>
                      </div>
                    );
                  })()}

                  {/* Transcript toggle */}
                  {unit.status === 'done' && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleTranscript(unit.ord)}
                        className="text-xs font-medium font-mono hover:underline"
                        style={{ color: '#79c0ff' }}
                      >
                        {tc?.visible ? '▾ Hide transcript' : '▸ View transcript'}
                      </button>
                      {tc?.visible && (
                        <div
                          className="mt-2.5 max-h-96 overflow-auto rounded-xl p-4"
                          style={{ background: '#0d1117' }}
                        >
                          {tc.loading
                            ? <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>Loading…</span>
                            : <Markdown className="whitespace-pre-wrap">{tc.text ?? ''}</Markdown>
                          }
                        </div>
                      )}
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
                style={{ color: 'rgba(230,237,243,0.4)', background: '#161c26', border: '1px solid rgba(230,237,243,0.07)' }}
              >
                {systemEventLabel(entry.type, entry.detail)}
              </span>
            </div>
          );
        })}

        {/* Steering gate — fallback position when gate.ord doesn't match any planned unit */}
        {session.status === 'awaiting_human' && !units.some((u) => gate?.ord === u.ord) && (
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
      />
    </div>
  );
}

function NewRunView({
  chatMode,
  mode,
  onModeChange,
  onLaunched,
}: {
  chatMode: boolean;
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  onLaunched: (id: string) => void;
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
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: '#e6edf3' }}>
            {heading}
          </h1>
          <p className="text-base leading-relaxed" style={{ color: 'rgba(230,237,243,0.5)' }}>
            {sub}
          </p>
        </div>
        <div className="flex justify-center">
          <ModePill mode={mode} onChange={onModeChange} />
        </div>
        <ChatInput embedded mode={mode} onLaunched={onLaunched} {...(chatMode ? { workflowOverride: 'chat' } : {})} />
      </div>
    </div>
  );
}

export function ChatPanel({ view, chatMode, onLaunched, onNavigateBack, onRefresh, onKill }: Props): React.ReactElement {
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
      />
    );
  }
  return (
    <NewRunView
      chatMode={chatMode ?? false}
      mode={mode}
      onModeChange={setMode}
      onLaunched={onLaunched}
    />
  );
}
