/**
 * CenterDashboard — Build mode's home surface, given a purpose (DES-UXFIX-001 §2.7, F7).
 *
 * Purpose first, then the work:
 *   1. Purpose statement — always present (the direct F7 fix); it is also the
 *      empty state (§3.4: "purpose is the empty state").
 *   2. Gate inbox        — only when gates are pending (answerable, W4).
 *   3. RUNS              — ONE list (the Campaigns stub and the Chats panel are
 *      gone, V4/§2.7 rule 3), labelled by INTENT, never the raw prompt (F7).
 *   4. "+ Build something" — the one primary action, in the mode's own words (V9).
 *   5. Stats footer      — cost/tokens as a data-gated summary of runs, shown only
 *      when there ARE runs and there IS data; never a hero row of `—` (F7).
 *   6. Agent activity + send-to-agents — only while something is running.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { unitsInFlight } from '../api/run-state.js';
import { usageTotals, WINDOW_LABEL_STYLE } from '../board/metrics.js';
import { useGateStore } from '../store/gates.js';
import { useMembershipStore } from '../store/membership.js';
import { useRunEventStore } from '../store/events.js';
import { useSteeringStore } from '../store/steering.js';
import { launchPath, sessionProjectId } from '../hooks/ambientProject.js';
import { useTimeRange } from '../hooks/useTimeRange.js';
import { TimeRangeSelector } from './TimeRangeSelector.js';
import { WorkChronicle } from './WorkChronicle.js';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  runs: SessionView[];
  onSelectRun: (id: string) => void;
  onApproveGate: (runId: string, amend?: string) => void;
  onRejectGate: (runId: string) => void;
  navigate: (path: string) => void;
  /**
   * The project shell's context (DES-FEEDBACK-001 §4.3, slice B): when Build is
   * entered via `/p/:projectId/build`, "+ Build something" opens the launch form
   * PRE-BOUND to this project (`/p/:projectId/build/new`) instead of the flat
   * unbound `/runs/new`.
   */
  projectId?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set([
  'planning',
  'distributing',
  'executing',
  'awaiting_human',
]);

/**
 * The purpose statement (§2.7 rule 1): 1–2 lines saying what Build IS — write /
 * independent check / gates / evidence. Always present; never empty; it replaces
 * the em-dash stat row as the first thing on the surface.
 */
export const BUILD_PURPOSE =
  'Build runs governed code work: an agent writes, an independent check grades, '
  + 'and you approve the gates. Everything it does lands as evidence.';

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

/** Most rows the ONE runs list shows before deferring to "view all →" (/work). */
const MAX_RUN_ROWS = 9;

// ── Style constants (DES-VISION-001 §2.11: semantic tokens only — the two-face
//    rule of §2.8 rides on these: `mono` marks narration/data, `sans` labels/prose) ──

const mono = { fontFamily: 'var(--font-mono)' } as const;
const sans = { fontFamily: 'var(--font-sans)' } as const;

const cardBase = {
  background: 'var(--surface-card)',
  border: '1px solid var(--surface-raised)',
  borderRadius: 'var(--radius-lg)',
} as const;

const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--text-2xs)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--ink-dim)',
  ...mono,
  margin: 0,
};

// ── Helper utilities ──────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * A run's title is its problem-statement rendered as a short INTENT PHRASE, not
 * the full prompt string (§2.7 rule 4). First line only, whitespace collapsed,
 * truncated at a word boundary with the intent leading; the full prompt stays
 * available on the run (the row's `title`). Falls back to workflow · repo, then
 * the short id, when there is no problem text at all.
 */
export function intentPhrase(view: SessionView, max = 72): string {
  const first = (view.session.problem.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  if (first.length > 0) {
    if (first.length <= max) return first;
    const cut = first.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
  }
  const wf = view.session.workflow_id;
  if (wf.length > 0 && wf !== 'chat') {
    const repo = view.session.repo_ref;
    return repo != null && repo.length > 0 ? `${wf} · ${repo}` : wf;
  }
  return view.session.id.slice(0, 8);
}

/** One row of the runs list: glyph + status word (user vocabulary, V3) + detail. */
export interface RunRowModel {
  glyph: string;
  status: string;
  detail: string;
  color: string;
}

/**
 * The row's status column, in the user's words (V3: `planning → working → gate →
 * done`; "distributing"/"executing" never render). `failReason` (when the event
 * store holds a `sessionFailed` message) keeps §3.4's "run failed" contract: a
 * reason and a way in, never a bare red dot.
 */
export function runRowModel(view: SessionView, failReason?: string): RunRowModel {
  const n = view.units.length;
  const done = view.units.filter((u) => u.status === 'done').length;
  const phase = n > 0 ? Math.min(done + 1, n) : 0;
  // The colors are the §2.6 STATUS layer (never the accent): amber = a gate
  // needs a human, emerald = working, red = failed, dim ink = history. The
  // same token drives the row's status icon AND its 2px left border (§5.4).
  switch (view.session.status) {
    case 'awaiting_human':
      return { glyph: '⏸', status: 'gate', detail: 'needs you', color: 'var(--status-gate)' };
    case 'planning':
      return { glyph: '⚙', status: 'planning', detail: '', color: 'var(--status-run)' };
    case 'distributing':
    case 'executing':
      return {
        glyph: '⚙',
        status: 'working',
        detail: n > 0 ? `phase ${phase}/${n}` : '',
        color: 'var(--status-run)',
      };
    case 'completed':
      return { glyph: '✓', status: 'done', detail: '', color: 'var(--status-done)' };
    case 'failed':
      return {
        glyph: '✕',
        status: 'failed',
        detail: [n > 0 ? `at phase ${phase}` : '', failReason ? truncate(failReason, 48) : '']
          .filter(Boolean)
          .join(': '),
        color: 'var(--status-fail)',
      };
    default:
      return { glyph: '⊘', status: view.session.status, detail: '', color: 'var(--ink-dim)' };
  }
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

// Every entry speaks the §2.6 status layer: full token for text, `-dim` for the
// pill's border + background (the GateChip convention from vision slice 2).
// Council/workflow provenance is the one exception — it speaks the accent
// (deliberation is the product's own voice, not a run state).
const FEED_META: Record<string, FeedMeta> = {
  awaitingHuman: {
    icon: '🔒',
    label: 'Gate decision required',
    borderColor: 'var(--status-gate-dim)',
    textColor: 'var(--status-gate)',
    badgeColor: 'var(--status-gate-dim)',
  },
  gateEscalated: {
    icon: '⬆',
    label: 'Gate escalated to human',
    borderColor: 'var(--status-gate-dim)',
    textColor: 'var(--status-gate)',
    badgeColor: 'transparent',
  },
  stepFailed: {
    icon: '✕',
    label: 'Step failed',
    borderColor: 'var(--status-fail-dim)',
    textColor: 'var(--status-fail)',
    badgeColor: 'var(--status-fail-dim)',
  },
  sessionFailed: {
    icon: '✕',
    label: 'Session failed',
    borderColor: 'var(--status-fail-dim)',
    textColor: 'var(--status-fail)',
    badgeColor: 'var(--status-fail-dim)',
  },
  crashRecoveryRedrive: {
    icon: '↻',
    label: 'Crash recovery redrive',
    borderColor: 'var(--status-fail-dim)',
    textColor: 'var(--status-fail)',
    badgeColor: 'transparent',
  },
  unitDone: {
    icon: '✓',
    label: 'Unit complete',
    borderColor: 'var(--surface-raised)',
    textColor: 'var(--status-done)',
    badgeColor: 'var(--status-done-dim)',
  },
  workflowSelected: {
    icon: '◈',
    label: 'Workflow selected',
    borderColor: 'var(--accent-subtle)',
    textColor: 'var(--accent)',
    badgeColor: 'transparent',
  },
  acpFallback: {
    icon: '⚠',
    label: 'ACP degraded — single-shot fallback',
    borderColor: 'var(--status-fail-dim)',
    textColor: 'var(--status-fail)',
    badgeColor: 'transparent',
  },
};

const DEFAULT_META: FeedMeta = {
  icon: '·',
  label: 'Event',
  borderColor: 'var(--surface-raised)',
  textColor: 'var(--ink-body)',
  badgeColor: 'transparent',
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
        background: 'var(--surface-card)',
        border: `1px solid ${meta.borderColor}`,
        borderRadius: 'var(--radius-lg)',
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
            fontSize: 'var(--text-2xs)',
            color: 'var(--ink-dim)',
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
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-dim)',
          ...mono,
          margin: '0 0 8px',
        }}
      >
        {runId.slice(0, 8)}
        {typeof ord === 'number' ? ` · before unit #${ord}` : ''}
      </p>

      {/* Prompt excerpt — the gate's question is prose, so it reads in the sans (§2.8) */}
      {prompt && (
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--ink-body)',
            ...sans,
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
            background: 'var(--surface-base)',
            border: '1px solid var(--surface-raised)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--ink-high)',
            fontSize: 'var(--text-xs)',
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
        {/* The GateChip pairs (vision slice 2): approve speaks run-emerald,
            steer speaks gate-amber, reject speaks fail-red — status semantics,
            never the accent (§2.6). Labels are actions, so they read sans. */}
        <button
          type="button"
          disabled={loading}
          onClick={() => void run(() => onApprove(runId))}
          style={{
            background: 'var(--status-run-dim)',
            color: 'var(--status-run)',
            border: '1px solid var(--status-run-dim)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 12px',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            ...sans,
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
            background: steerOpen && amend.trim() ? 'var(--status-gate)' : 'var(--status-gate-dim)',
            color: steerOpen && amend.trim() ? 'var(--surface-base)' : 'var(--status-gate)',
            border: '1px solid var(--status-gate-dim)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 12px',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            ...sans,
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
            background: 'var(--status-fail-dim)',
            color: 'var(--status-fail)',
            border: '1px solid var(--status-fail-dim)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 12px',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            ...sans,
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
        borderRadius: 'var(--radius-md)',
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
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: meta.textColor, ...mono }}>
            {meta.label}
            {typeof ord === 'number' ? ` · unit #${ord}` : ''}
          </span>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', ...mono, flexShrink: 0 }}>
            {sessionId.slice(0, 6)}
          </span>
        </div>
        {detail && (
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-muted)',
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
          <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', ...mono, margin: '2px 0 0' }}>
            {sessionLbl}
          </p>
        )}
      </div>
    </div>
  );
}

// ── RunRow — one entry in the ONE runs list (intent · status · detail, §2.7) ──

interface RunRowProps {
  view: SessionView;
  failReason: string | undefined;
  onSelect: (id: string) => void;
}

function RunRow({ view, failReason, onSelect }: RunRowProps): React.ReactElement {
  const m = runRowModel(view, failReason);
  const intent = intentPhrase(view);

  return (
    <button
      type="button"
      data-testid="build-run-row"
      data-status={m.status}
      title={view.session.problem || view.session.id}
      onClick={() => onSelect(view.session.id)}
      // §5.4: the thin left border encodes run state at the list edge — the eye
      // scans the margin for color without reading labels. The same status token
      // drives the icon; a state change recolors both with a --dur-base
      // transition, and a new row fades in once (wk-fade-in, §1.6: no loops).
      className="wk-fade-in"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '9px 12px',
        background: 'var(--surface-card)',
        border: '1px solid var(--surface-raised)',
        borderLeft: `2px solid ${m.color}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'color var(--dur-base), border-color var(--dur-base), background var(--dur-instant)',
        width: '100%',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        // Hover brightens the surface, never the border — the left border is
        // status signal and must not be overwritten by an affordance.
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-raised)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-card)';
      }}
    >
      <span style={{ color: m.color, fontSize: 'var(--text-xs)', flexShrink: 0, width: '14px', transition: 'color var(--dur-base)' }}>
        {m.glyph}
      </span>
      {/* Intent label: prose, so sans + high ink (§5.4 token usage). */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--ink-high)',
          ...sans,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {intent}
      </span>
      {/* Status word + phase detail: data, so mono; the detail dims (§5.4). */}
      <span style={{ fontSize: 'var(--text-xs)', color: m.color, ...mono, flexShrink: 0, transition: 'color var(--dur-base)' }}>
        {m.status}
        {m.detail ? (
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)' }}>{` · ${m.detail}`}</span>
        ) : null}
      </span>
    </button>
  );
}

// ── SendPanel — broadcast a steer to running agents (rendered only when any) ──

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
        if (failed > 0) throw new Error(`${failed} send(s) failed`);
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
        {activeRuns.length === 0 ? null : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={sending}
                style={{
                  background: 'var(--surface-base)',
                  border: '1px solid var(--surface-raised)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--ink-high)',
                  fontSize: 'var(--text-xs)',
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
              placeholder="Steer the agents — your message lands in their context… (Ctrl+Enter to send)"
              rows={3}
              style={{
                width: '100%',
                background: 'var(--surface-base)',
                border: '1px solid var(--surface-raised)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--ink-high)',
                fontSize: 'var(--text-xs)',
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
                  // Send is an action → the accent, dimmed while it has nothing
                  // to send (§2.5: the accent marks primary actions, sparingly).
                  background: message.trim() ? 'var(--accent)' : 'var(--accent-subtle)',
                  color: message.trim() ? 'var(--accent-fg)' : 'var(--ink-muted)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 14px',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 700,
                  ...sans,
                  cursor: sending || !message.trim() ? 'not-allowed' : 'pointer',
                  transition: 'background var(--dur-instant), color var(--dur-instant)',
                }}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
              {sent && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-run)', ...mono }}>
                  ✓ Sent
                </span>
              )}
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', ...mono }}>
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
  navigate,
  projectId = null,
}: Props): React.ReactElement {
  const byRun = useRunEventStore((s) => s.byRun);
  const gates = useGateStore((s) => s.gates);
  const clearGate = useGateStore((s) => s.clearGate);
  const recordSteering = useSteeringStore((s) => s.record);

  const { range, setRange, filter: filterByRange } = useTimeRange('30d');

  // ── Project scoping (DES-UX-001 §2.3 rule 2, slice S) ─────────────────────
  // Inside a project shell (`/p/:id/build`) this surface shows EXACTLY the
  // project's runs — the run DTO's own `project_id` (CREW-UX-2 daemon truth),
  // with the board model's membership mirror answering only for pre-0.8.0
  // daemons whose DTOs never carry the field. Never the global list filtered
  // by nothing. Outside a project (`/runs`) it stays the flat cross-project home.
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const scopedRuns = useMemo(() => {
    if (projectId === null) return runs;
    return runs.filter((v) => {
      const claimed = sessionProjectId(v.session);
      return claimed !== undefined
        ? claimed === projectId
        : projectIdByRun[v.session.id] === projectId;
    });
  }, [runs, projectId, projectIdByRun]);

  const filteredRuns = useMemo(() => filterByRange(scopedRuns), [scopedRuns, filterByRange]);

  // ── The work chronicle (DES-UX-002 §3, slice BC) — a second VIEW of the
  // project's build work, additive beside the flat list (§10's adopted
  // position: additive tab; slice BE wires the §5.2 route + default). It
  // reads the FULL scoped history — episode chains are the project's story,
  // not a time-window slice — so its input skips the range filter.
  const [view, setView] = useState<'runs' | 'chronicle'>('runs');
  const chronicleRuns = useMemo(
    () => scopedRuns.filter((v) => !!v.session.workflow_id && v.session.workflow_id !== 'chat'),
    [scopedRuns],
  );

  // ── Derived: active sessions only (feed + send panel scope) ──────────────
  const activeRuns = useMemo(
    () => filteredRuns.filter((v) => ACTIVE_STATUSES.has(v.session.status)),
    [filteredRuns],
  );

  // ── The ONE runs list (§2.7 rule 3): work runs only. Chats are not a Build
  // concern (Chat is its own mode), and the Campaigns shell is gone (V4). ────
  const workRuns = useMemo(
    () => filteredRuns.filter((v) => !!v.session.workflow_id && v.session.workflow_id !== 'chat'),
    [filteredRuns],
  );

  const runRows = useMemo(() => {
    const active = workRuns.filter((v) => ACTIVE_STATUSES.has(v.session.status));
    const terminal = workRuns.filter((v) => !ACTIVE_STATUSES.has(v.session.status));
    const room = Math.max(0, MAX_RUN_ROWS - active.length);
    // Server order is active-first, then history; the tail of the terminal group
    // is the most recent by positional proxy (AgentSession has no timestamp).
    return [...active.slice(0, MAX_RUN_ROWS), ...terminal.slice(-room).reverse()];
  }, [workRuns]);

  // ── Stats: cost/tokens over the shown runs — the metrics module's one
  // `usageTotals` selector (slice W, §5.3: no inline cliUsage folds).
  // Rendered ONLY as a data-gated footer (§2.7 rule 2) — never an em-dash hero.
  const stats = useMemo(() => usageTotals(byRun, workRuns), [byRun, workRuns]);

  // Counting `distributed` units counted the whole routed plan, not the running part of it
  // (FINDING-052); `unitsInFlight` counts only what is actually running.
  const inFlight = useMemo(() => unitsInFlight(workRuns), [workRuns]);

  /** Footer segments — each present only when its datum is (no `—` placeholders). */
  const footerParts = useMemo(() => {
    const parts: string[] = [];
    if (inFlight > 0) parts.push(`${inFlight} step${inFlight === 1 ? '' : 's'} in flight`);
    if (stats.totalCost !== null) parts.push(formatCost(stats.totalCost));
    if (stats.totalTokens > 0) parts.push(`${formatTokens(stats.totalTokens)} tokens`);
    return parts;
  }, [inFlight, stats]);

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
      const lbl = intentPhrase(v);
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

  // ── Open gates (sorted newest-first by receivedAt) — inside a project,
  // scoped to ITS runs (§2.3 rule 2: a project page shows exactly its runs;
  // a foreign gate belongs to the bar/toasts, not this inbox). ──────────────
  const openGates = useMemo(() => {
    const all = Object.values(gates).sort((a, b) => b.receivedAt - a.receivedAt);
    if (projectId === null) return all;
    const mine = new Set(scopedRuns.map((v) => v.session.id));
    return all.filter((g) => mine.has(g.runId));
  }, [gates, projectId, scopedRuns]);

  /** The last recorded `sessionFailed` message for a run, if the store holds one. */
  const failReasonOf = useCallback(
    (runId: string): string | undefined => {
      const events = byRun[runId] ?? [];
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev?.type === 'sessionFailed' && typeof ev.message === 'string') return ev.message;
      }
      return undefined;
    },
    [byRun],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // Two faces, one rule (§2.8): the surface defaults to the sans (labels and
    // prose); data — status words, phases, ids, the cost — opts into the mono.
    <div data-testid="build-dashboard" style={{ color: 'var(--ink-body)', ...sans }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 32px' }}>

        {/* ── 1. Header + purpose statement (the F7 fix; also the empty state) ── */}
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--ink-high)', margin: 0, ...sans }}>
          Build
        </h1>
        {/* Purpose: prose — `--ink-body --text-sm` in the sans (§5.4 token usage). */}
        <p
          data-testid="build-purpose"
          style={{
            fontSize: 'var(--text-sm)',
            lineHeight: 1.6,
            color: 'var(--ink-body)',
            ...sans,
            margin: '8px 0 24px',
            maxWidth: '640px',
          }}
        >
          {BUILD_PURPOSE}
        </p>

        {/* ── The Runs | Chronicle view toggle (DES-UX-002 §3.3 + §5.3, slice
               BC): project context only. The flat list stays the default — the
               §10 open question's adopted additive position; BE may re-default. */}
        {projectId !== null && (
          <div role="tablist" aria-label="Build view" style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
            {(['runs', 'chronicle'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                data-testid={`build-view-${v}`}
                onClick={() => setView(v)}
                style={{
                  background: view === v ? 'var(--surface-raised)' : 'transparent',
                  border: '1px solid var(--surface-raised)',
                  borderRadius: 'var(--radius-md)',
                  color: view === v ? 'var(--ink-high)' : 'var(--ink-muted)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  ...sans,
                  padding: '5px 12px',
                }}
              >
                {v === 'runs' ? 'Runs' : 'Chronicle'}
              </button>
            ))}
          </div>
        )}

        {projectId !== null && view === 'chronicle' ? (
          <WorkChronicle runs={chronicleRuns} projectId={projectId} navigate={navigate} />
        ) : (
        <>

        {/* ── 2. Gate inbox — only when gates are pending (§2.7 rule 5, W4) ───── */}
        {openGates.length > 0 && (
          <div data-testid="gate-inbox" style={{ marginBottom: '24px' }}>
            {/* The §5.4 gate-inbox pill: `--status-gate-dim` background,
                `--status-gate` text. Sentence case — this line is a headline. */}
            <p
              data-testid="gate-inbox-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--status-gate-dim)',
                borderRadius: 'var(--radius-full)',
                padding: '4px 12px',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--status-gate)',
                ...mono,
                margin: '0 0 10px',
              }}
            >
              {`⏸ ${openGates.length} gate${openGates.length === 1 ? ' needs' : 's need'} you`}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {openGates.map((gate) => {
                const v = runs.find((r) => r.session.id === gate.runId);
                const lbl = v ? intentPhrase(v, 32) : gate.runId.slice(0, 8);
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
            </div>
          </div>
        )}

        {/* ── 3. RUNS — one list, labelled by intent (§2.7 rules 3+4). With no
               runs the region is OMITTED (empty-state budget): the purpose
               statement above is the empty state, §3.4. ─────────────────────── */}
        {runRows.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px',
              }}
            >
              <p style={sectionLabel}>
                Runs
                {projectId !== null && (
                  // EC34 (§2.5): the count beside a list equals the rows beneath
                  // it, SET-EQUAL on the same paint — one derivation (`runRows`)
                  // feeds both, so they cannot disagree. EC39 (slice W): the
                  // count names its window — the range the pills select.
                  <>
                    <span
                      data-testid="project-run-count"
                      data-window={range}
                      style={{ marginLeft: '6px', color: 'var(--ink-muted)', fontSize: 'var(--text-2xs)', ...mono }}
                    >
                      {runRows.length}
                    </span>
                    <span
                      data-testid="project-run-count-window"
                      style={{ ...WINDOW_LABEL_STYLE, marginLeft: '4px' }}
                    >
                      {range}
                    </span>
                  </>
                )}
              </p>
              <TimeRangeSelector value={range} onChange={setRange} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {runRows.map((v) => (
                <RunRow
                  key={v.session.id}
                  view={v}
                  failReason={failReasonOf(v.session.id)}
                  onSelect={onSelectRun}
                />
              ))}
            </div>
            {workRuns.length > runRows.length && (
              <button
                type="button"
                data-testid="build-runs-cap"
                onClick={() => navigate('/work')}
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--accent)',
                  ...sans,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px 0 0',
                  display: 'block',
                }}
              >
                {/* §5.3 (slice W): the row cap is a silent filter no longer —
                    the clipped list says what it holds back, in the same breath. */}
                showing {runRows.length} of {workRuns.length} — view all →
              </button>
            )}
          </div>
        )}

        {/* ── 4. The one primary action + the cost footer, one row (§5.4's
               wireframe: `[ + Build something ]` left, `cost: $0.24` right).
               The action speaks the accent (§2.5); the footer is a data point,
               not a hero — mono because it's a number, dim because it's ambient
               (§5.4 token usage), and shown only when there IS data (§2.7
               rule 2, never `—`). ─────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          <button
            type="button"
            data-testid="build-something"
            // §4.3: from project context the launch form opens pre-bound and
            // locked — the shared `launchPath` spelling (slice S, §2.3 rule 1).
            onClick={() => navigate(launchPath(projectId, 'build'))}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '9px 18px',
              fontSize: 'var(--text-xs)',
              fontWeight: 700,
              ...sans,
              cursor: 'pointer',
            }}
          >
            + Build something
          </button>
          {runRows.length > 0 && footerParts.length > 0 && (
            <p
              data-testid="build-stats-footer"
              data-window={range}
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-dim)',
                ...mono,
                margin: 0,
              }}
            >
              {footerParts.join(' · ')}
              {/* EC39 (slice W): the footer's numbers fold the range-filtered
                  runs — the count names that window. */}
              <span data-testid="build-stats-footer-window" style={{ ...WINDOW_LABEL_STYLE, marginLeft: '6px' }}>
                {range}
              </span>
            </p>
          )}
        </div>

        {/* ── 5. Agent activity — compact feed, only when active sessions carry
               events and no gate is pending. An event-less feed is OMITTED
               (empty-state budget) rather than filled with a waiting line. ──── */}
        {openGates.length === 0 && activeRuns.length > 0 && feedEntries.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <p style={{ ...sectionLabel, marginBottom: '10px' }}>Agent activity</p>
            <div
              style={{
                ...cardBase,
                padding: '14px',
                maxHeight: '220px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {feedEntries.slice(0, 5).map((entry) => (
                <FeedEventRow
                  key={entry.key}
                  type={entry.type}
                  sessionId={entry.sessionId}
                  sessionLbl={entry.sessionLbl}
                  {...(entry.ord !== undefined ? { ord: entry.ord } : {})}
                  {...(entry.detail !== undefined ? { detail: entry.detail } : {})}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── 6. Send-to-agents — only while something is running (empty-state
               budget: an idle surface does not announce the absence). ────────── */}
        {activeRuns.length > 0 && <SendPanel activeRuns={activeRuns} />}

        </>
        )}

      </div>
    </div>
  );
}
