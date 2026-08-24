import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { AuditEntry, CoreEvent, SessionView } from '../api/types.js';
import { launchPath } from '../hooks/ambientProject.js';
import type { Navigate } from '../hooks/useRoute.js';
import { useRunEventStore } from '../store/events.js';
import { useMembershipStore } from '../store/membership.js';
import { setSteerPrefill } from '../store/steerPrefill.js';
import {
  assembleChains, chainInProgress, chainStatus, completedPhases,
  guidanceAmendments, lastCompletedRun, lastWorkflowSelected, passedCriterion,
} from './chronicle.js';
import { deriveRunClocks, durationWord, runShortId, runTitle } from './runIdentity.js';

// DES-UX-002 §3.4 token usage, verbatim: episode chain card `--surface-card`
// collapsed / `--surface-raised` expanded; chain status badge reuses the
// `--status-*` tokens; amendment lines `--ink-muted --font-mono --text-xs`;
// the guidance panel `--surface-raised` with an `--accent-subtle` left border
// (operator-authored content). No new semantic tokens.
const mono = { fontFamily: 'var(--font-mono)' } as const;
const sans = { fontFamily: 'var(--font-sans)' } as const;

/** The §2.6 status layer for the chain badge — never the accent. */
const STATUS_TOKEN: Record<string, string> = {
  completed: 'var(--status-done)',
  failed: 'var(--status-fail)',
  awaiting_human: 'var(--status-gate)',
  planning: 'var(--status-run)',
  distributing: 'var(--status-run)',
  executing: 'var(--status-run)',
};

/** The badge's word is the user vocabulary (V3), matching `runRowModel`. */
const STATUS_WORD: Record<string, string> = {
  completed: 'done',
  failed: 'failed',
  awaiting_human: 'gate',
  planning: 'planning',
  distributing: 'working',
  executing: 'working',
};

function shortDate(ms: number | undefined): string | null {
  return ms === undefined ? null : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  return (
    <span
      data-testid="chain-status"
      style={{
        color: STATUS_TOKEN[status] ?? 'var(--ink-dim)',
        fontSize: 'var(--text-2xs)',
        fontWeight: 600,
        ...mono,
        flexShrink: 0,
      }}
    >
      {STATUS_WORD[status] ?? status}
    </span>
  );
}

interface Props {
  /** The project's work runs, already scoped by the DTO claim (CenterDashboard). */
  runs: SessionView[];
  projectId: string;
  navigate: Navigate;
}

/**
 * The work chronicle (DES-UX-002 §3.3, slice BC): the project's runs grouped
 * into episode chains by `retry_of` lineage (EC50 — retry siblings are
 * sub-rows of ONE episode card, never peer rows), a current-state strip
 * derived from the last completed run's evidence (EC53 — honest empty state),
 * and the gesture-gated guidance summary of past gate amendments.
 */
export function WorkChronicle({ runs, projectId, navigate }: Props): React.ReactElement {
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const byRun = useRunEventStore((s) => s.byRun);
  const hydrate = useRunEventStore((s) => s.hydrate);

  // Chains, newest root first (chronological by chain root, §3.3) — clock-less
  // roots keep list order below the dated ones.
  const chains = useMemo(() => {
    const assembled = assembleChains(runs);
    return assembled
      .map((chain, ix) => ({ chain, clock: attachedAt[chain[0]?.session.id ?? ''] ?? ix - assembled.length }))
      .sort((a, b) => b.clock - a.clock)
      .map((c) => c.chain);
  }, [runs, attachedAt]);

  // ── Current-state strip (§3.3, EC53) ────────────────────────────────────
  const tip = useMemo(() => lastCompletedRun(runs, attachedAt), [runs, attachedAt]);
  const tipId = tip?.session.id ?? null;
  const tipEvents = tipId !== null ? byRun[tipId] : undefined;
  // The strip's criterion/workflow derivation reads the tip run's durable
  // trail. One fetch, only when the store holds no frames for it yet — the
  // same FINDING-013 hydrate the run detail uses. (The guidance panel below
  // is the gesture-gated fetch; THIS one is the strip's sanctioned read.)
  const tipEmpty = tipEvents === undefined || tipEvents.length === 0;
  useEffect(() => {
    if (tipId === null || !tipEmpty) return;
    let cancelled = false;
    void api
      .getRunEvents(tipId)
      .then(({ events }) => { if (!cancelled) hydrate(tipId, events); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tipId, tipEmpty, hydrate]);
  const criterion = tipEvents !== undefined ? passedCriterion(tipEvents) : null;
  const workflow = tipEvents !== undefined ? lastWorkflowSelected(tipEvents) : null;

  // ── Guidance summary (§3.3) — gesture-gated: ZERO requests until opened ──
  const [guidance, setGuidance] = useState<AuditEntry[] | null>(null);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [guidanceError, setGuidanceError] = useState(false);
  const scopedIds = useMemo(() => new Set(runs.map((v) => v.session.id)), [runs]);

  function openGuidance(): void {
    setGuidanceOpen(true);
    if (guidance !== null) return;
    api
      .getAuditByAction('gate.decided')
      .then(({ entries }) => setGuidance(guidanceAmendments(entries, scopedIds)))
      .catch(() => setGuidanceError(true));
  }

  function applyGuidance(entry: AuditEntry): void {
    const amend = entry.detail?.['amend'];
    if (typeof amend !== 'string') return;
    setSteerPrefill({ steer: amend, projectId });
    navigate(launchPath(projectId, 'build'));
  }

  const tipDate = shortDate(tipId !== null ? attachedAt[tipId] : undefined);

  return (
    <div data-testid="work-chronicle" style={{ ...sans, color: 'var(--ink-body)' }}>
      {/* ── The current-state strip: the CLIENT's best synthesis of "what did
             this project accomplish?" off the last completed run's evidence —
             or the EXACT no-run copy, never a fabricated state (EC53). ────── */}
      <div
        data-testid="chronicle-state"
        data-empty={tip === null ? 'true' : 'false'}
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--surface-raised)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          marginBottom: '16px',
        }}
      >
        {tip === null ? (
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink-muted)' }}>
            No completed run yet — this project&apos;s first successful build will appear here.
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--ink-high)' }}>
              Last completed run: <span style={mono}>{runTitle(tip.session)}</span>
              {` · ${completedPhases(tip)} phase${completedPhases(tip) === 1 ? '' : 's'}`}
              {tipDate !== null ? ` · ${tipDate}` : ''}
            </p>
            {(criterion !== null || workflow !== null) && (
              <p
                data-testid="chronicle-state-evidence"
                style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', ...mono }}
              >
                {criterion !== null ? `passed: “${criterion}”` : ''}
                {criterion !== null && workflow !== null ? ' · ' : ''}
                {workflow !== null ? `workflow: ${workflow}` : ''}
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Episode chains, chronological by chain root (§3.3) ─────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {chains.map((chain) => (
          <EpisodeCard key={chain[0]?.session.id} chain={chain} byRun={byRun} attachedAt={attachedAt} navigate={navigate} />
        ))}
      </div>
      {chains.length === 0 && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', margin: 0 }}>
          No build runs in this project yet.
        </p>
      )}

      {/* ── Pre-launch guidance summary (§3.3): the operator's last gate
             amendments for THIS project — gesture-gated (the audit fetch fires
             on the explicit open, never on mount). ─────────────────────────── */}
      <div
        data-testid="guidance-summary"
        data-loaded={guidance !== null ? 'true' : 'false'}
        style={{
          background: 'var(--surface-raised)',
          borderLeft: '3px solid var(--accent-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          marginTop: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-muted)', ...sans }}>
            Past guidance
          </p>
          {!guidanceOpen && (
            <button
              type="button"
              data-testid="guidance-open"
              onClick={openGuidance}
              style={{
                background: 'transparent', border: '1px solid var(--surface-card)',
                borderRadius: 'var(--radius-md)', color: 'var(--accent)', cursor: 'pointer',
                fontSize: 'var(--text-xs)', ...sans, padding: '4px 10px',
              }}
            >
              show past guidance
            </button>
          )}
        </div>
        {guidanceOpen && guidance === null && !guidanceError && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-dim)', ...mono }}>loading…</p>
        )}
        {guidanceError && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--status-fail)', ...mono }}>
            could not read the audit trail — try again from the button above
          </p>
        )}
        {guidance !== null && guidance.length === 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', ...sans }}>
            No gate amendments recorded for this project&apos;s runs yet.
          </p>
        )}
        {guidance !== null && guidance.map((entry, ix) => {
          const amend = String(entry.detail?.['amend'] ?? '');
          const approved = entry.detail?.['approve'] === true;
          return (
            <div
              key={`${entry.runId}-${entry.ts}-${ix}`}
              data-testid="guidance-row"
              style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}
            >
              {/* Amendment line: `--ink-muted --font-mono --text-xs` (§3.4). The wire's
                  detail carries approve/amend/status (routes.ts:983) — no phase/criterion
                  rides a gate.decided entry, so the line names run · decision · text. */}
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', ...mono, flex: 1, minWidth: 0 }}>
                {runShortId(entry.runId ?? '')} · {approved ? 'approved' : 'rejected'} · “{amend}”
              </span>
              <button
                type="button"
                data-testid="guidance-use"
                onClick={() => applyGuidance(entry)}
                style={{
                  background: 'transparent', border: '1px solid var(--surface-card)',
                  borderRadius: 'var(--radius-md)', color: 'var(--accent)', cursor: 'pointer',
                  fontSize: 'var(--text-2xs)', ...sans, padding: '2px 8px', flexShrink: 0,
                }}
              >
                use in next run
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface CardProps {
  chain: SessionView[];
  byRun: Record<string, CoreEvent[]>;
  attachedAt: Record<string, number>;
  navigate: Navigate;
}

/**
 * One episode chain card (§3.3): collapsed = one quiet ~48px row; expanded =
 * the attempts as sub-rows in lineage order. In-progress chains ship expanded;
 * resolved chains ship collapsed.
 */
function EpisodeCard({ chain, byRun, attachedAt, navigate }: CardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(() => chainInProgress(chain));
  const root = chain[0] as SessionView;
  const latest = chain[chain.length - 1] as SessionView;
  const status = chainStatus(chain);

  // Header intent: the truncated problem (the chain shares one intent by
  // construction — retries relaunch the same problem).
  const intent = root.session.problem.length > 60 ? `${root.session.problem.slice(0, 60)}…` : root.session.problem;

  // Total duration: the sum of the attempts' event-derived clocks, where the
  // store holds them (zero new requests). Underivable attempts contribute
  // nothing and the total renders only when SOMETHING is derivable — stated
  // duration is always evidence-backed, never fabricated.
  const totalMs = chain.reduce((sum, v) => {
    const clocks = deriveRunClocks(byRun[v.session.id] ?? [], []);
    return clocks.started !== null && clocks.ended !== null ? sum + (clocks.ended.ms - clocks.started.ms) : sum;
  }, 0);

  // Date range: first attempt's attach clock → latest attempt's (the one
  // honest per-run clock, `runIdentity.ts`). Absent clocks are omitted.
  const from = shortDate(attachedAt[root.session.id]);
  const to = shortDate(attachedAt[latest.session.id]);
  const range = from !== null && to !== null ? (from === to ? from : `${from} → ${to}`) : from ?? to;

  return (
    <div
      data-testid="episode-chain"
      data-chain-status={status}
      data-attempts={chain.length}
      data-expanded={expanded ? 'true' : 'false'}
      style={{
        // §3.4: `--surface-card` collapsed, `--surface-raised` when expanded.
        background: expanded ? 'var(--surface-raised)' : 'var(--surface-card)',
        border: '1px solid var(--surface-raised)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <button
        type="button"
        data-testid="chain-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
          minHeight: '48px', boxSizing: 'border-box', padding: '0 14px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span aria-hidden style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span style={{ color: 'var(--ink-high)', fontSize: 'var(--text-sm)', ...sans, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {intent}
        </span>
        <StatusBadge status={status} />
        <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-2xs)', ...mono, flexShrink: 0 }}>
          {chain.length} attempt{chain.length === 1 ? '' : 's'}
        </span>
        {totalMs > 0 && (
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)', ...mono, flexShrink: 0 }}>
            {durationWord(totalMs)}
          </span>
        )}
        {range != null && (
          <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)', ...mono, flexShrink: 0 }}>
            {range}
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ padding: '0 14px 10px 32px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {chain.map((v, ix) => {
            const clocks = deriveRunClocks(byRun[v.session.id] ?? [], []);
            const dur = clocks.started !== null && clocks.ended !== null
              ? durationWord(clocks.ended.ms - clocks.started.ms)
              : null;
            return (
              <div
                key={v.session.id}
                data-testid="attempt-row"
                data-attempt={ix + 1}
                data-run-id={v.session.id}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '28px' }}
              >
                <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-xs)', ...mono, width: '84px', flexShrink: 0 }}>
                  attempt #{ix + 1}
                </span>
                <StatusBadge status={v.session.status} />
                {dur !== null && (
                  <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)', ...mono, flexShrink: 0 }}>{dur}</span>
                )}
                <span style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-2xs)', ...mono, flexShrink: 0 }}>
                  {runShortId(v.session.id)}
                </span>
                <span style={{ flex: 1 }} />
                {/* §5.2: the run detail route — timeline-by-default once slice BB's
                    layout lands; today the same path opens the run detail. */}
                <a
                  data-testid="view-timeline"
                  href={`/runs/${encodeURIComponent(v.session.id)}/timeline`}
                  onClick={(e) => { e.preventDefault(); navigate(`/runs/${encodeURIComponent(v.session.id)}/timeline`); }}
                  style={{ color: 'var(--accent)', fontSize: 'var(--text-xs)', ...sans, textDecoration: 'none', flexShrink: 0 }}
                >
                  view timeline
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
