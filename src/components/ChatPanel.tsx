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

const STAGE_BADGE: Record<StageKind, string> = {
  recon: 'bg-blue-100 text-blue-700',
  build: 'bg-green-100 text-green-700',
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

  // Transcript state: Map<ord, { text: string | null; loading: boolean; visible: boolean }>
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
    <div className="flex flex-col h-full">
      {/* Run header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-white shrink-0">
        <button
          type="button"
          onClick={onNavigateBack}
          className="text-xs text-gray-400 hover:text-gray-600"
          aria-label="Back to run list"
        >
          ←
        </button>
        <p className="flex-1 text-sm font-semibold text-gray-800 truncate" title={session.problem}>
          {session.problem}
        </p>
        <span className={`text-xs font-medium shrink-0 ${style.className}`}>{style.label}</span>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {/* User message (right-aligned) */}
        <div className="flex justify-end">
          <div className="max-w-[70%] rounded-2xl bg-blue-600 text-white text-sm px-4 py-2.5">
            {session.problem}
          </div>
        </div>

        {/* Unit messages */}
        {[...units].sort((a, b) => a.ord - b.ord).map((unit) => {
          const tc = transcripts[unit.ord];
          return (
            <div key={unit.id} className="flex flex-col gap-1.5">
              {/* Decision / routing message */}
              {unit.routing !== null && unit.routing.method === 'council' && (
                <div className="self-start max-w-[80%] bg-zinc-100 rounded-lg px-3 py-2 text-xs text-zinc-600 flex items-start gap-2">
                  <span className="shrink-0 text-base leading-none">⚖</span>
                  <div>
                    <span className="font-medium">Council voted → {unit.assigned_cli ?? '?'}</span>
                    <span className="text-zinc-400 ml-2">
                      {unit.routing.returned} CLIs polled, {unit.routing.agreement_pct}% agreement,{' '}
                      {unit.routing.dissent} dissent
                    </span>
                  </div>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'evaluator_distinct' && (
                <div className="self-start max-w-[80%] bg-zinc-100 rounded-lg px-3 py-2 text-xs text-zinc-600 flex items-start gap-2">
                  <span className="shrink-0 text-base leading-none">⚖</span>
                  <div>
                    <span className="font-medium">Evaluator-distinct → {unit.assigned_cli ?? '?'}</span>
                    <span className="text-zinc-400 ml-2">
                      (was: {unit.routing.was} — different agent enforced for review separation)
                    </span>
                  </div>
                </div>
              )}
              {unit.routing !== null && unit.routing.method === 'degraded' && (
                <div className="self-start max-w-[80%] bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-700 flex items-start gap-2">
                  <span className="shrink-0">⚠</span>
                  <span>Degraded routing: {unit.routing.reason}</span>
                </div>
              )}

              {/* Agent message */}
              <div className="self-start max-w-[80%] flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {unit.assigned_cli && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono font-semibold text-gray-700">
                      {unit.assigned_cli}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      STAGE_BADGE[unit.stage] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {unit.stage}
                  </span>
                  <span className="text-[10px] text-gray-400">#{unit.ord}</span>
                  <span className="text-[11px] text-gray-500 truncate max-w-xs" title={unit.description}>
                    {unit.description}
                  </span>
                </div>

                <div className="rounded-xl border bg-white px-3 py-2 text-xs text-gray-700 shadow-sm">
                  {unit.status === 'distributed' && (
                    <span className="animate-pulse text-blue-600 text-[11px]">working…</span>
                  )}
                  {unit.status === 'done' && (
                    <span className="text-green-600 text-[11px]">
                      {UNIT_STATUS_TEXT[unit.status]}
                    </span>
                  )}
                  {unit.status === 'rejected' && (
                    <span className="text-red-600 text-[11px]">
                      rejected{unit.denial_reason ? `: ${unit.denial_reason}` : ''}
                    </span>
                  )}
                  {unit.status === 'pending' && (
                    <span className="text-gray-400 text-[11px]">queued</span>
                  )}

                  {/* Transcript toggle + inline display */}
                  {unit.status === 'done' && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => toggleTranscript(unit.ord)}
                        className="text-[11px] text-blue-600 hover:underline"
                      >
                        {tc?.visible ? 'Hide transcript' : 'View transcript'}
                      </button>
                      {tc?.visible && (
                        <pre className="mt-2 max-h-96 overflow-auto rounded bg-zinc-900 p-2 text-[10px] leading-tight text-zinc-100 whitespace-pre-wrap">
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

        {/* System events */}
        {filteredLog.map((entry) => (
          <div key={entry.seq} className="flex justify-center">
            <span className="text-[11px] italic text-gray-400">
              {systemEventLabel(entry.type, entry.detail)}
            </span>
          </div>
        ))}

        {/* Steering gate */}
        {session.status === 'awaiting_human' && (
          <div className="self-center w-full max-w-md">
            <SteeringGate
              runId={session.id}
              {...(gate ? { ord: gate.ord, prompt: gate.prompt } : {})}
              onResolved={onRefresh}
            />
          </div>
        )}

        {/* Pull-to-bottom anchor */}
        <div ref={bottomRef} />
      </div>

      <ChatInput
        runId={isTerminal ? null : session.id}
        onLaunched={onLaunched}
      />
    </div>
  );
}

/** New-run mode: greeting + input. */
function NewRunView({ onLaunched }: { onLaunched: (id: string) => void }): React.ReactElement {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
        <h1 className="text-2xl font-semibold text-gray-800">What do you need built?</h1>
        <p className="text-sm text-gray-400 text-center max-w-sm">
          Describe a problem. The council will elect a CLI, plan the work, and execute it — you approve each gate.
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
