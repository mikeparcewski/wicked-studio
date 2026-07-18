import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView, StageKind, UnitStatus } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { STATUS_STYLE } from './RunCard.js';
import { SteeringGate } from './SteeringGate.js';
import { ChatInput } from './ChatInput.js';

interface Props {
  /** The selected run, or null if no run is active. */
  view: SessionView | null;
  onLaunched: (runId: string) => void;
  onNavigateBack: () => void;
  onRefresh: () => void;
}

// Stage pill colors — on the wicked palette (emerald/teal for build, indigo/violet for recon/review)
const STAGE_BADGE: Record<StageKind, string> = {
  recon: 'bg-violet-100 text-violet-700',
  build: 'bg-emerald-100 text-emerald-700',
  review: 'bg-indigo-100 text-indigo-700',
  test: 'bg-amber-100 text-amber-700',
};

const UNIT_STATUS_TEXT: Record<UnitStatus, string> = {
  pending: 'queued',
  distributed: 'dispatched',
  done: 'done',
  rejected: 'rejected',
};

// Derive a short unit key for getUnitOutput (mirrors WorkUnitDetail logic)
function unitKey(runId: string, unitId: string, ord: number): string {
  return unitId.startsWith(`${runId}:`) ? unitId.slice(runId.length + 1) : `u${ord}`;
}

// Events we surface as system messages (unitPlanned / unitDistributed covered by unit rows)
const SYSTEM_EVENT_TYPES = new Set([
  'sessionStarted', 'sessionCompleted', 'sessionFailed',
  'awaitingHuman', 'gateDecided', 'resumed', 'runCancelled',
]);

function systemEventLabel(type: string, detail: string): string {
  switch (type) {
    case 'sessionStarted': return 'Run started';
    case 'sessionCompleted': return '✓ Run completed';
    case 'sessionFailed': return '✗ Run failed';
    case 'awaitingHuman': return 'Waiting for your input…';
    case 'gateDecided': return detail.includes('allow') ? 'Gate: allow' : 'Gate: deny';
    case 'resumed': return 'Run resumed';
    case 'runCancelled': return 'Run cancelled';
    default: return detail;
  }
}

// Status dot color for the run header
function statusDotClass(status: string): string {
  switch (status) {
    case 'completed': return 'bg-emerald-500';
    case 'failed': return 'bg-red-500';
    case 'cancelled': return 'bg-zinc-400';
    case 'awaiting_human': return 'bg-amber-400 animate-pulse';
    default: return 'bg-blue-400 animate-pulse';
  }
}

/** Chat view for a selected run. */
function RunChat({
  view,
  onLaunched,
  onNavigateBack,
  onRefresh,
}: {
  view: SessionView;
  onLaunched: (runId: string) => void;
  onNavigateBack: () => void;
  onRefresh: () => void;
}): React.ReactElement {
  const { session, units } = view;
  const gate = useGateStore((s) => s.gates[session.id]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];

  const [transcripts, setTranscripts] = useState<
    Record<number, { text: string | null; loading: boolean; visible: boolean }>
  >({});
  const autoLoadedOrds = useRef<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [units.length, log.length]);

  // Auto-load transcript for done units
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
          .then(({ output }) => {
            setTranscripts((prev) => ({
              ...prev,
              [unit.ord]: { text: output ?? '(no transcript captured)', loading: false, visible: true },
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

  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: 'text-gray-500' };
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(session.status);
  const filteredLog = log.filter((e) => SYSTEM_EVENT_TYPES.has(e.type));

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Run header — clean, minimal */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <button
          type="button"
          onClick={onNavigateBack}
          aria-label="Back to run list"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
        >
          ←
        </button>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotClass(session.status)}`} />
        <p className="flex-1 text-base font-semibold text-gray-900 truncate" title={session.problem}>
          {session.problem}
        </p>
        <span className={`text-xs font-medium shrink-0 ${style.className}`}>{style.label}</span>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 max-w-3xl w-full mx-auto">

        {/* User prompt bubble — right-aligned, wicked emerald */}
        <div className="flex justify-end">
          <div className="max-w-[72%] rounded-2xl bg-emerald-600 text-white text-base px-5 py-3.5 shadow-sm leading-relaxed">
            {session.problem}
          </div>
        </div>

        {/* Unit messages */}
        {[...units].sort((a, b) => a.ord - b.ord).map((unit) => {
          const tc = transcripts[unit.ord];
          return (
            <div key={unit.id} className="flex flex-col gap-2">
              {/* Council / routing pill */}
              {unit.routing !== null && unit.routing.method === 'council' && (
                <div className="self-start max-w-[85%] bg-violet-50 border border-violet-100 rounded-xl px-4 py-2 text-xs text-violet-700 flex items-center gap-2">
                  <span className="shrink-0">⚖</span>
                  <span>
                    <span className="font-semibold">Council → {unit.assigned_cli ?? '?'}</span>
                    <span className="text-violet-400 ml-2">
                      {unit.routing.returned} polled · {unit.routing.agreement_pct}% agree · {unit.routing.dissent} dissent
                    </span>
                  </span>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'evaluator_distinct' && (
                <div className="self-start max-w-[85%] bg-violet-50 border border-violet-100 rounded-xl px-4 py-2 text-xs text-violet-700 flex items-center gap-2">
                  <span className="shrink-0">⚖</span>
                  <span>
                    <span className="font-semibold">Evaluator-distinct → {unit.assigned_cli ?? '?'}</span>
                    <span className="text-violet-400 ml-2">(was: {unit.routing.was})</span>
                  </span>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'degraded' && (
                <div className="self-start max-w-[85%] bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700 flex items-center gap-2">
                  <span className="shrink-0">⚠</span>
                  <span>Degraded routing: {unit.routing.reason}</span>
                </div>
              )}

              {/* Agent response card */}
              <div className="self-start max-w-[85%] flex flex-col gap-2">
                {/* Meta row: CLI chip + stage + ord + description */}
                <div className="flex items-center gap-2 flex-wrap pl-1">
                  {unit.assigned_cli && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-mono font-semibold text-gray-700">
                      {unit.assigned_cli}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                      STAGE_BADGE[unit.stage] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {unit.stage}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">#{unit.ord}</span>
                  <span className="text-sm text-gray-600 truncate max-w-xs" title={unit.description}>
                    {unit.description}
                  </span>
                </div>

                {/* Content card */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 shadow-sm">
                  {unit.status === 'distributed' && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      <span>Working…</span>
                    </div>
                  )}
                  {unit.status === 'done' && (
                    <div className="flex items-center gap-2 text-sm text-emerald-700">
                      <span>✓</span>
                      <span className="font-medium">{UNIT_STATUS_TEXT[unit.status]}</span>
                    </div>
                  )}
                  {unit.status === 'rejected' && (
                    <div className="text-sm text-red-600 font-medium">
                      Rejected{unit.denial_reason ? `: ${unit.denial_reason}` : ''}
                    </div>
                  )}
                  {unit.status === 'pending' && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300" />
                      <span>Queued</span>
                    </div>
                  )}

                  {/* Transcript toggle */}
                  {unit.status === 'done' && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleTranscript(unit.ord)}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium hover:underline"
                      >
                        {tc?.visible ? '▾ Hide transcript' : '▸ View transcript'}
                      </button>
                      {tc?.visible && (
                        <pre className="mt-2.5 max-h-96 overflow-auto rounded-xl bg-zinc-900 p-4 text-xs leading-5 text-zinc-100 whitespace-pre-wrap font-mono">
                          {tc.loading ? 'Loading…' : tc.text}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* System event pills — centered, subtle */}
        {filteredLog.map((entry) => (
          <div key={entry.seq} className="flex justify-center">
            <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-full px-3 py-1">
              {systemEventLabel(entry.type, entry.detail)}
            </span>
          </div>
        ))}

        {/* Steering gate */}
        {session.status === 'awaiting_human' && (
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

      <ChatInput
        runId={isTerminal ? null : session.id}
        onLaunched={onLaunched}
      />
    </div>
  );
}

/** New-run mode: greeting + input centered, no run selected. */
function NewRunView({ onLaunched }: { onLaunched: (id: string) => void }): React.ReactElement {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 max-w-2xl mx-auto w-full">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">What do you need built?</h1>
        <p className="text-base text-gray-500 text-center leading-relaxed">
          Describe your goal. The council elects a CLI, decomposes the plan,
          and executes it — you approve each gate.
        </p>
      </div>
      <ChatInput onLaunched={onLaunched} />
    </div>
  );
}

export function ChatPanel({ view, onLaunched, onNavigateBack, onRefresh }: Props): React.ReactElement {
  if (view) {
    return (
      <RunChat
        key={view.session.id}
        view={view}
        onLaunched={onLaunched}
        onNavigateBack={onNavigateBack}
        onRefresh={onRefresh}
      />
    );
  }
  return <NewRunView onLaunched={onLaunched} />;
}
