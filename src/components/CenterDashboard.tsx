/**
 * CenterDashboard — the manager-persona home view (crew#73 / DES-STUDIO-MGRDASH-001).
 *
 * Shown when no specific run or chat is selected. Provides:
 *   1. Status bar    — active session count, units in-flight, aggregate cost/tokens
 *   2. Event feed    — filtered cross-session stream (action-required + milestones only)
 *   3. Progress      — per-session unit ladder (click → open session)
 *   4. Send-to-agents — broadcast message input
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { useRunEventStore } from '../store/events.js';
import { useSteeringStore } from '../store/steering.js';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  runs: SessionView[];
  onSelectRun: (id: string) => void;
  onApproveGate: (runId: string, amend?: string) => void;
  onRejectGate: (runId: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set([
  'planning',
  'distributing',
  'executing',
  'awaiting_human',
]);

/** Event types shown in the filtered feed. Everything else is suppressed. */
const FEED_TYPES = new Set([
  'awaitingHuman',
  'gateEscalated',
  'stepFailed',
  'sessionFailed',
  'crashRecoveryRedrive',
  'unitDone',
  'workflowSelected',
  'acpFallback',
]);

/** How many non-gate feed events to surface per session. Keeps the feed scannable. */
const FEED_EVENTS_PER_SESSION = 30;

// ── Style tokens (matches Dashboard.tsx palette) ───────────────────────────────

const mono = { fontFamily: 'monospace' } as const;

const cardBase = {
  background: '#1b222e',
  border: '1px solid rgba(230,237,243,0.08)',
  borderRadius: '12px',
} as const;

const sectionLabel: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'rgba(230,237,243,0.4)',
  fontFamily: 'monospace',
  margin: 0,
};

// ── Unit status colours (mirrors PhaseLadder.tsx) ─────────────────────────────

const UNIT_STATUS_COLOR: Record<string, string> = {
  pending:     'rgba(230,237,243,0.18)',
  distributed: '#79c0ff',
  done:        '#3fb950',
  rejected:    '#f85149',
};

const UNIT_STATUS_PULSE: Record<string, boolean> = {
  distributed: true,
};

// ── Helper utilities ──────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sessionLabel(v: SessionView): string {
  const prob = v.session.problem;
  return prob.length > 0
    ? truncate(prob, 32)
    : v.session.id.slice(0, 8);
}

function formatCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Event-type metadata for the feed ─────────────────────────────────────────

interface FeedMeta {
  icon: string;
  label: string;
  borderColor: string;
  textColor: string;
  badgeColor: string;
}

const FEED_META: Record<string, FeedMeta> = {
  awaitingHuman: {
    icon: '🔒',
    label: 'Gate decision required',
    borderColor: 'rgba(255,218,25,0.35)',
    textColor: '#ffda19',
    badgeColor: 'rgba(255,218,25,0.12)',
  },
  gateEscalated: {
    icon: '⬆',
    label: 'Gate escalated to human',
    borderColor: 'rgba(121,192,255,0.3)',
    textColor: '#79c0ff',
    badgeColor: 'rgba(121,192,255,0.08)',
  },
  stepFailed: {
    icon: '✕',
    label: 'Step failed',
    borderColor: 'rgba(248,81,73,0.3)',
    textColor: '#f85149',
    badgeColor: 'rgba(248,81,73,0.08)',
  },
  sessionFailed: {
    icon: '✕',
    label: 'Session failed',
    borderColor: 'rgba(248,81,73,0.3)',
    textColor: '#f85149',
    badgeColor: 'rgba(248,81,73,0.08)',
  },
  crashRecoveryRedrive: {
    icon: '↻',
    label: 'Crash recovery redrive',
    borderColor: 'rgba(248,81,73,0.2)',
    textColor: 'rgba(248,81,73,0.8)',
    badgeColor: 'rgba(248,81,73,0.06)',
  },
  unitDone: {
    icon: '✓',
    label: 'Unit complete',
    borderColor: 'rgba(63,185,80,0.2)',
    textColor: '#3fb950',
    badgeColor: 'rgba(63,185,80,0.06)',
  },
  workflowSelected: {
    icon: '◈',
    label: 'Workflow selected',
    borderColor: 'rgba(167,139,250,0.25)',
    textColor: '#a78bfa',
    badgeColor: 'rgba(167,139,250,0.06)',
  },
  acpFallback: {
    icon: '⚠',
    label: 'ACP degraded — single-shot fallback',
    borderColor: 'rgba(248,81,73,0.2)',
    textColor: 'rgba(248,81,73,0.75)',
    badgeColor: 'rgba(248,81,73,0.05)',
  },
};

const DEFAULT_META: FeedMeta = {
  icon: '·',
  label: 'Event',
  borderColor: 'rgba(230,237,243,0.08)',
  textColor: '#e6edf3',
  badgeColor: 'rgba(230,237,243,0.04)',
};

// ── GateActionCard — inline approval for a single awaiting-human gate ─────────

interface GateCardProps {
  runId: string;
  ord: number | undefined;
  prompt: string | undefined;
  sessionLbl: string;
  onApprove: (runId: string, amend?: string) => Promise<void>;
  onReject: (runId: string) => Promise<void>;
}

function GateActionCard({
  runId,
  ord,
  prompt,
  sessionLbl,
  onApprove,
  onReject,
}: GateCardProps): React.ReactElement {
  const [amend, setAmend] = useState('');
  const [loading, setLoading] = useState(false);
  const [steerOpen, setSteerOpen] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      setLoading(true);
      try {
        await action();
      } catch {
        // errors surface via the gate API; keep loading state clean
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const meta = FEED_META['awaitingHuman'] ?? DEFAULT_META;

  return (
    <div
      style={{
        background: '#161c26',
        border: `1px solid ${meta.borderColor}`,
        borderRadius: '10px',
        padding: '14px 16px',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ color: meta.textColor, fontSize: '13px' }}>
            {meta.icon}
          </span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: meta.textColor,
              ...mono,
            }}
          >
            {meta.label}
          </span>
        </div>
        <span
          style={{
            fontSize: '10px',
            color: 'rgba(230,237,243,0.4)',
            ...mono,
            flexShrink: 0,
            marginLeft: '8px',
          }}
        >
          {sessionLbl}
        </span>
      </div>

      {/* Context line */}
      <p
        style={{
          fontSize: '11px',
          color: 'rgba(230,237,243,0.45)',
          ...mono,
          margin: '0 0 8px',
        }}
      >
        {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>

      {/* Prompt excerpt */}
      {prompt && (
        <p
          style={{
            fontSize: '12px',
            color: 'rgba(230,237,243,0.7)',
            ...mono,
            margin: '0 0 10px',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {prompt}
        </p>
      )}

      {/* Steer textarea — visible only when "Approve + steer" is toggled */}
      {steerOpen && (
        <textarea
          style={{
            width: '100%',
            background: '#0f1419',
            border: '1px solid rgba(230,237,243,0.14)',
            borderRadius: '6px',
            color: '#e6edf3',
            fontSize: '12px',
            ...mono,
            padding: '6px 8px',
            resize: 'vertical',
            marginBottom: '10px',
            boxSizing: 'border-box',
            outline: 'none',
          }}
          rows={2}
          placeholder="Steer / amendment for the next unit…"
          value={amend}
          onChange={(e) => setAmend(e.target.value)}
          disabled={loading}
        />
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => void run(() => onApprove(runId))}
          style={{
            background: '#3fb950',
            color: '#0d1117',
            border: 'none',
            borderRadius: '6px',
            padding: '5px 12px',
            fontSize: '11px',
            fontWeight: 700,
            ...mono,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            if (!steerOpen) {
              setSteerOpen(true);
            } else if (amend.trim()) {
              void run(() => onApprove(runId, amend.trim()));
            }
          }}
          style={{
            background: steerOpen && amend.trim() ? '#ffda19' : 'rgba(255,218,25,0.12)',
            color: steerOpen && amend.trim() ? '#0d1117' : '#ffda19',
            border: '1px solid rgba(255,218,25,0.3)',
            borderRadius: '6px',
            padding: '5px 12px',
            fontSize: '11px',
            fontWeight: 600,
            ...mono,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {steerOpen && amend.trim() ? 'Send steer' : 'Approve + steer'}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void run(() => onReject(runId))}
          style={{
            background: 'rgba(248,81,73,0.1)',
            color: '#f85149',
            border: '1px solid rgba(248,81,73,0.3)',
            borderRadius: '6px',
            padding: '5px 12px',
            fontSize: '11px',
            fontWeight: 600,
            ...mono,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ── FeedEventRow — a non-actionable feed entry ────────────────────────────────

interface FeedRowProps {
  type: string;
  sessionId: string;
  sessionLbl: string;
  ord?: number;
  detail?: string;
}

function FeedEventRow({
  type,
  sessionId,
  sessionLbl,
  ord,
  detail,
}: FeedRowProps): React.ReactElement {
  const meta = FEED_META[type] ?? DEFAULT_META;

  return (
    <div
      style={{
        background: meta.badgeColor,
        border: `1px solid ${meta.borderColor}`,
        borderRadius: '8px',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
      }}
    >
      <span style={{ color: meta.textColor, fontSize: '12px', lineHeight: '18px', flexShrink: 0 }}>
        {meta.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: meta.textColor, ...mono }}>
            {meta.label}
            {typeof ord === 'number' ? ` · unit #${ord}` : ''}
          </span>
          <span style={{ fontSize: '10px', color: 'rgba(230,237,243,0.3)', ...mono, flexShrink: 0 }}>
            {sessionId.slice(0, 6)}
          </span>
        </div>
        {detail && (
          <p
            style={{
              fontSize: '11px',
              color: 'rgba(230,237,243,0.55)',
              ...mono,
              margin: '2px 0 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={detail}
          >
            {truncate(detail, 80)}
          </p>
        )}
        {!detail && (
          <p style={{ fontSize: '10px', color: 'rgba(230,237,243,0.3)', ...mono, margin: '2px 0 0' }}>
            {sessionLbl}
          </p>
        )}
      </div>
    </div>
  );
}

// ── ProgressRow — unit-dot progress for one session ───────────────────────────

interface ProgressRowProps {
  view: SessionView;
  onSelect: (id: string) => void;
}

function ProgressRow({ view, onSelect }: ProgressRowProps): React.ReactElement {
  const { session, units } = view;
  const label = sessionLabel(view);
  const id = session.id;
  const isAwaiting = session.status === 'awaiting_human';

  return (
    <button
      type="button"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        background: '#1b222e',
        border: '1px solid rgba(230,237,243,0.07)',
        borderRadius: '10px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        width: '100%',
        textAlign: 'left',
      }}
      onClick={() => onSelect(id)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(230,237,243,0.18)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(230,237,243,0.07)';
      }}
    >
      {/* Status pulse dot */}
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: isAwaiting ? '#ffda19' : '#79c0ff',
          flexShrink: 0,
          marginTop: '5px',
          boxShadow: isAwaiting ? '0 0 6px rgba(255,218,25,0.5)' : '0 0 6px rgba(121,192,255,0.4)',
        }}
      />

      {/* Session label + unit dots */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
            gap: '8px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#e6edf3',
              ...mono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
          <span
            style={{ fontSize: '10px', color: 'rgba(230,237,243,0.35)', ...mono, flexShrink: 0 }}
          >
            {id.slice(0, 6)} · Open chat →
          </span>
        </div>

        {/* Unit dots */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {units.length === 0 ? (
            <span style={{ fontSize: '10px', color: 'rgba(230,237,243,0.3)', ...mono }}>
              planning…
            </span>
          ) : (
            units.map((u) => {
              const color = UNIT_STATUS_COLOR[u.status] ?? 'rgba(230,237,243,0.18)';
              const pulse = UNIT_STATUS_PULSE[u.status] === true;
              return (
                <span
                  key={u.ord}
                  title={`unit #${u.ord} — ${u.stage ?? '?'} — ${u.status}`}
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: color,
                    flexShrink: 0,
                    animation: pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
                  }}
                />
              );
            })
          )}
        </div>
      </div>
    </button>
  );
}

// ── SendPanel — broadcast message to agents ───────────────────────────────────

interface SendPanelProps {
  activeRuns: SessionView[];
}

function SendPanel({ activeRuns }: SendPanelProps): React.ReactElement {
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('__all__');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (sentTimerRef.current) clearTimeout(sentTimerRef.current); }, []);

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = message.trim();
    if (!trimmed || activeRuns.length === 0) return;
    setSending(true);
    try {
      if (target === '__all__') {
        const results = await Promise.allSettled(
          activeRuns.map((v) => api.injectMessage(v.session.id, trimmed, 'all')),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) throw new Error(`${failed} inject(s) failed`);
      } else {
        await api.injectMessage(target, trimmed, 'all');
      }
      setMessage('');
      setSent(true);
      sentTimerRef.current = setTimeout(() => setSent(false), 2500);
      textRef.current?.focus();
    } finally {
      setSending(false);
    }
  }, [message, target, activeRuns]);

  return (
    <div>
      <p style={{ ...sectionLabel, marginBottom: '10px' }}>Send to agents</p>
      <div style={{ ...cardBase, padding: '14px 16px' }}>
        {activeRuns.length === 0 ? (
          <p style={{ fontSize: '11px', color: 'rgba(230,237,243,0.3)', ...mono }}>
            No active sessions
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={sending}
                style={{
                  background: '#0f1419',
                  border: '1px solid rgba(230,237,243,0.14)',
                  borderRadius: '6px',
                  color: '#e6edf3',
                  fontSize: '11px',
                  ...mono,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  outline: 'none',
                  flexShrink: 0,
                }}
              >
                <option value="__all__">All active agents</option>
                {activeRuns.map((v) => (
                  <option key={v.session.id} value={v.session.id}>
                    {truncate(v.session.problem || v.session.id, 30)} ({v.session.id.slice(0, 6)})
                  </option>
                ))}
              </select>
            </div>
            <textarea
              ref={textRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  void handleSend();
                }
              }}
              disabled={sending}
              placeholder="Message to inject into the agent's context… (Ctrl+Enter to send)"
              rows={3}
              style={{
                width: '100%',
                background: '#0f1419',
                border: '1px solid rgba(230,237,243,0.14)',
                borderRadius: '6px',
                color: '#e6edf3',
                fontSize: '12px',
                ...mono,
                padding: '8px 10px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '8px',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                disabled={sending || !message.trim()}
                onClick={() => void handleSend()}
                style={{
                  background: message.trim() ? '#79c0ff' : 'rgba(121,192,255,0.15)',
                  color: message.trim() ? '#0d1117' : 'rgba(121,192,255,0.45)',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  ...mono,
                  cursor: sending || !message.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
              {sent && (
                <span style={{ fontSize: '11px', color: '#3fb950', ...mono }}>
                  ✓ Injected
                </span>
              )}
              <span style={{ fontSize: '10px', color: 'rgba(230,237,243,0.25)', ...mono }}>
                Ctrl+Enter
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── CenterDashboard ───────────────────────────────────────────────────────────

export function CenterDashboard({
  runs,
  onSelectRun,
  onApproveGate,
  onRejectGate,
}: Props): React.ReactElement {
  const byRun = useRunEventStore((s) => s.byRun);
  const gates = useGateStore((s) => s.gates);
  const clearGate = useGateStore((s) => s.clearGate);
  const recordSteering = useSteeringStore((s) => s.record);

  // ── Derived: active sessions only ─────────────────────────────────────────
  const activeRuns = useMemo(
    () => runs.filter((v) => ACTIVE_STATUSES.has(v.session.status)),
    [runs],
  );

  // ── Stats: aggregate cost/tokens from cliUsage events ────────────────────
  const stats = useMemo(() => {
    let totalInput = 0;
    let totalOutput = 0;
    let costSum = 0;
    let hasCost = false;

    for (const v of activeRuns) {
      const events = byRun[v.session.id] ?? [];
      for (const ev of events) {
        if (ev.type === 'cliUsage') {
          if (typeof ev.inputTokens === 'number') totalInput += ev.inputTokens;
          if (typeof ev.outputTokens === 'number') totalOutput += ev.outputTokens;
          if (typeof ev.costUsd === 'number') {
            costSum += ev.costUsd;
            hasCost = true;
          }
        }
      }
    }

    return {
      totalTokens: totalInput + totalOutput,
      totalCost: hasCost ? costSum : null,
    };
  }, [byRun, activeRuns]);

  // ── Units in-flight (distributed status) ──────────────────────────────────
  const unitsInFlight = useMemo(
    () =>
      runs.reduce(
        (sum, v) => sum + v.units.filter((u) => u.status === 'distributed').length,
        0,
      ),
    [runs],
  );

  // ── Gate handlers (with steering store + gate-store sync) ─────────────────
  const handleApprove = useCallback(
    async (runId: string, amend?: string): Promise<void> => {
      await api.confirmGate(runId, { approve: true, ...(amend ? { amend } : {}) });
      recordSteering({
        runId,
        action: amend ? 'approve-with-steer' : 'approve',
        ...(amend ? { amend } : {}),
      });
      clearGate(runId);
      onApproveGate(runId, amend);
    },
    [clearGate, recordSteering, onApproveGate],
  );

  const handleReject = useCallback(
    async (runId: string): Promise<void> => {
      await api.confirmGate(runId, { approve: false });
      recordSteering({ runId, action: 'reject' });
      clearGate(runId);
      onRejectGate(runId);
    },
    [clearGate, recordSteering, onRejectGate],
  );

  // ── Feed: collect filtered events from all active sessions ────────────────
  const feedEntries = useMemo(() => {
    interface FeedEntry {
      key: string;
      sessionId: string;
      sessionLbl: string;
      type: string;
      ord?: number;
      detail?: string;
    }

    const entries: FeedEntry[] = [];

    // Collect non-gate events from the event store (newest last → reverse for newest-first feed)
    for (const v of activeRuns) {
      const id = v.session.id;
      const lbl = sessionLabel(v);
      const events = byRun[id] ?? [];
      const recent = events.slice(-FEED_EVENTS_PER_SESSION);

      for (const ev of recent) {
        if (ev.type === 'awaitingHuman') continue; // handled via gate store
        if (!FEED_TYPES.has(ev.type)) continue;

        let detail: string | undefined;
        if (ev.type === 'stepFailed' && typeof ev.detail === 'string') {
          detail = ev.detail;
        } else if (ev.type === 'sessionFailed' && typeof ev.message === 'string') {
          detail = ev.message;
        } else if (ev.type === 'workflowSelected' && typeof ev.workflowId === 'string') {
          detail = `workflow: ${ev.workflowId}`;
        } else if (ev.type === 'acpFallback') {
          const reason = typeof ev.reason === 'string' ? ev.reason : '';
          const cli = typeof ev.cliKey === 'string' ? ev.cliKey : '';
          detail = [cli, reason].filter(Boolean).join(' — ');
        } else if (ev.type === 'crashRecoveryRedrive' && typeof ev.attempt === 'number') {
          detail = `attempt #${ev.attempt}`;
        }

        entries.push({
          key: `${id}-${ev.type}-${typeof ev.ord === 'number' ? ev.ord : 0}-${entries.length}`,
          sessionId: id,
          sessionLbl: lbl,
          type: ev.type,
          // exactOptionalPropertyTypes: only spread when defined to avoid undefined assignment
          ...(typeof ev.ord === 'number' ? { ord: ev.ord } : {}),
          ...(detail !== undefined ? { detail } : {}),
        });
      }
    }

    // Newest events last in byRun → reverse for newest-first display
    entries.reverse();

    return entries;
  }, [byRun, activeRuns]);

  // ── Open gates (sorted newest-first by receivedAt) ────────────────────────
  const openGates = useMemo(
    () => Object.values(gates).sort((a, b) => b.receivedAt - a.receivedAt),
    [gates],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ color: '#e6edf3', ...mono }}>
      {/* keyframe for pulsing unit dots */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '28px 32px' }}>

        {/* ── 1. Header + Status bar ──────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '28px',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1
              style={{ fontSize: '20px', fontWeight: 600, color: '#e6edf3', margin: 0, ...mono }}
            >
              Manager dashboard
            </h1>
            <p style={{ fontSize: '11px', color: 'rgba(230,237,243,0.38)', margin: '4px 0 0', ...mono }}>
              wicked crew · cross-session control
            </p>
          </div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Stat label="Active sessions" value={String(activeRuns.length)} color="#79c0ff" />
            <Stat label="Units in-flight" value={String(unitsInFlight)} color="#79c0ff" />
            <Stat
              label="Cost"
              value={stats.totalCost !== null ? formatCost(stats.totalCost) : '—'}
              color={stats.totalCost !== null ? '#3fb950' : 'rgba(230,237,243,0.3)'}
            />
            <Stat
              label="Tokens"
              value={stats.totalTokens > 0 ? formatTokens(stats.totalTokens) : '—'}
              color={stats.totalTokens > 0 ? '#e6edf3' : 'rgba(230,237,243,0.3)'}
            />
          </div>
        </div>

        {/* ── 2. Filtered event feed ──────────────────────────────────────────── */}
        <p style={{ ...sectionLabel, marginBottom: '10px' }}>Event feed</p>
        <div
          style={{
            ...cardBase,
            marginBottom: '28px',
            padding: '14px',
            maxHeight: '480px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {/* Open gate action cards — always at top */}
          {openGates.map((gate) => {
            const v = runs.find((r) => r.session.id === gate.runId);
            const lbl = v ? sessionLabel(v) : gate.runId.slice(0, 8);
            return (
              <GateActionCard
                key={`gate-${gate.runId}-${gate.ord ?? 'x'}`}
                runId={gate.runId}
                ord={gate.ord}
                prompt={gate.prompt}
                sessionLbl={lbl}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            );
          })}

          {/* Non-gate feed entries */}
          {feedEntries.map((entry) => (
            <FeedEventRow
              key={entry.key}
              type={entry.type}
              sessionId={entry.sessionId}
              sessionLbl={entry.sessionLbl}
              // exactOptionalPropertyTypes: spread conditionally so undefined is never explicit
              {...(entry.ord !== undefined ? { ord: entry.ord } : {})}
              {...(entry.detail !== undefined ? { detail: entry.detail } : {})}
            />
          ))}

          {/* Empty state */}
          {openGates.length === 0 && feedEntries.length === 0 && (
            <p
              style={{
                fontSize: '12px',
                color: 'rgba(230,237,243,0.28)',
                ...mono,
                textAlign: 'center',
                padding: '24px 0',
              }}
            >
              {activeRuns.length === 0
                ? 'No active sessions — start a run to see events here'
                : 'Waiting for events…'}
            </p>
          )}
        </div>

        {/* ── 3. Progress per active session ─────────────────────────────────── */}
        {activeRuns.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <p style={{ ...sectionLabel, marginBottom: '10px' }}>Session progress</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeRuns.map((v) => (
                <ProgressRow key={v.session.id} view={v} onSelect={onSelectRun} />
              ))}
            </div>
          </div>
        )}

        {/* ── 4. Send-to-agents panel ─────────────────────────────────────────── */}
        <SendPanel activeRuns={activeRuns} />

      </div>
    </div>
  );
}

// ── Stat tile — status bar building block ─────────────────────────────────────

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}): React.ReactElement {
  return (
    <div style={{ textAlign: 'right' }}>
      <p style={{ fontSize: '10px', color: 'rgba(230,237,243,0.38)', ...mono, margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: '16px', fontWeight: 600, color, ...mono, margin: '2px 0 0' }}>
        {value}
      </p>
    </div>
  );
}
