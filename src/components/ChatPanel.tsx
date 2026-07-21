import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView, StageKind, UnitStatus } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { STATUS_STYLE } from './RunCard.js';
import { SteeringGate } from './SteeringGate.js';
import { ChatInput } from './ChatInput.js';
import { Markdown } from './Markdown.js';

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
]);

function systemEventLabel(type: string, detail: string): string {
  switch (type) {
    case 'sessionStarted':   return 'Run started';
    case 'sessionCompleted': return '✓ Run completed';
    case 'sessionFailed':    return '✗ Run failed';
    case 'awaitingHuman':    return 'Waiting for your input…';
    case 'gateDecided':      return detail.includes('allow') ? 'Gate: allow' : 'Gate: deny';
    case 'resumed':          return 'Run resumed';
    case 'runCancelled':     return 'Run cancelled';
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

function RunChat({
  view,
  onLaunched,
  onNavigateBack,
  onRefresh,
  onKill,
}: {
  view: SessionView;
  onLaunched: (runId: string) => void;
  onNavigateBack: () => void;
  onRefresh: () => void;
  onKill?: (runId: string) => void | Promise<void>;
}): React.ReactElement {
  const { session, units } = view;
  const gate = useGateStore((s) => s.gates[session.id]);
  const log = useRuntimeStore((s) => s.logs[session.id]) ?? [];
  const executorTypes = useRuntimeStore((s) => s.executorTypes);

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

  const style = STATUS_STYLE[session.status] ?? { label: session.status, className: '', color: 'rgba(230,237,243,0.5)' };
  const isTerminal = ['completed', 'cancelled', 'failed'].includes(session.status);
  const filteredLog = log.filter((e) => SYSTEM_EVENT_TYPES.has(e.type));
  const dotColor = statusDotColor(session.status);
  const pulse = ['executing', 'distributing', 'planning', 'awaiting_human'].includes(session.status);

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

        {/* User prompt bubble */}
        <div className="flex justify-end">
          <div
            className="max-w-[72%] rounded-2xl text-base px-5 py-3.5 leading-relaxed"
            style={{ background: '#224a5e', color: '#e6edf3', border: '1px solid rgba(230,237,243,0.12)' }}
          >
            {session.problem}
          </div>
        </div>

        {/* Unit messages */}
        {[...units].sort((a, b) => a.ord - b.ord).map((unit) => {
          const tc = transcripts[unit.ord];
          const stageBadge = STAGE_BADGE[unit.stage] ?? { bg: 'rgba(230,237,243,0.08)', color: 'rgba(230,237,243,0.5)' };
          return (
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
                      {unit.routing.returned} polled · {unit.routing.agreement_pct}% agree · {unit.routing.dissent} dissent
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
                <div
                  className="self-start max-w-[85%] rounded-xl px-4 py-2 text-xs flex items-center gap-2 font-mono"
                  style={{ background: 'rgba(255,218,25,0.08)', border: '1px solid rgba(255,218,25,0.2)', color: '#ffda19' }}
                >
                  <span className="shrink-0">⚠</span>
                  <span>Degraded routing: {unit.routing.reason}</span>
                </div>
              )}

              {/* Agent response card */}
              <div className="self-start max-w-[85%] flex flex-col gap-2">
                {/* Meta row: avatar + attribution + stage + governance */}
                <div className="flex items-center gap-2 flex-wrap">
                  {unit.assigned_cli
                    ? <CliAvatar cli={unit.assigned_cli} />
                    : <span className="w-7 h-7 rounded-full shrink-0" style={{ background: 'rgba(230,237,243,0.06)' }} />
                  }
                  <span className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.55)' }}>
                    {unit.assigned_cli ?? 'agent'}
                    <span style={{ color: 'rgba(230,237,243,0.3)' }}> · unit {unit.ord}</span>
                  </span>
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
                  {unit.status === 'distributed' && (
                    <div className="flex items-center gap-2 text-sm font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>
                      <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#79c0ff' }} />
                      <span>Working…</span>
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
                    const isAgent = executorTypes[`${session.id}:${unit.ord}`] === 'agent';
                    return isAgent ? (
                      <div
                        className="flex items-center gap-2 text-xs font-mono rounded-lg px-3 py-2"
                        style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)', color: '#a78bfa' }}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#a78bfa' }} />
                        <span>Council deliberating…</span>
                      </div>
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
        })}

        {/* System event pills */}
        {filteredLog.map((entry) => (
          <div key={entry.seq} className="flex justify-center">
            <span
              className="text-xs rounded-full px-3 py-1 font-mono"
              style={{ color: 'rgba(230,237,243,0.4)', background: '#161c26', border: '1px solid rgba(230,237,243,0.07)' }}
            >
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
        runStatus={isTerminal ? null : session.status}
        onLaunched={onLaunched}
      />
    </div>
  );
}

function NewRunView({ chatMode, onLaunched }: { chatMode: boolean; onLaunched: (id: string) => void }): React.ReactElement {
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
        <ChatInput embedded onLaunched={onLaunched} {...(chatMode ? { workflowOverride: 'chat' } : {})} />
      </div>
    </div>
  );
}

export function ChatPanel({ view, chatMode, onLaunched, onNavigateBack, onRefresh, onKill }: Props): React.ReactElement {
  if (view) {
    return (
      <RunChat
        key={view.session.id}
        view={view}
        onLaunched={onLaunched}
        onNavigateBack={onNavigateBack}
        onRefresh={onRefresh}
        {...(onKill !== undefined ? { onKill } : {})}
      />
    );
  }
  return <NewRunView chatMode={chatMode ?? false} onLaunched={onLaunched} />;
}
