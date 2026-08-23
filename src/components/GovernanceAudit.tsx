import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { GovernanceClaim } from '../api/types.js';
import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

function DecisionBadge({ decision }: { decision: GovernanceClaim['decision'] }): React.ReactElement {
  const styles: Record<GovernanceClaim['decision'], { bg: string; color: string }> = {
    allow:                { bg: 'var(--status-run-dim)',   color: 'var(--status-run)' },
    deny:                 { bg: 'var(--status-fail-dim)',   color: 'var(--status-fail)' },
    allow_with_conditions:{ bg: 'var(--status-gate-dim)', color: 'var(--status-gate)' },
  };
  const labels: Record<GovernanceClaim['decision'], string> = {
    allow: 'ALLOW',
    deny: 'DENY',
    allow_with_conditions: 'ALLOW + OBLIGATIONS',
  };
  const s = styles[decision];
  return (
    <span
      className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
      style={{ background: s.bg, color: s.color }}
    >
      {labels[decision]}
    </span>
  );
}

function ClaimRow({ claim }: { claim: GovernanceClaim }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ts = new Date(claim.evaluated_at * 1000).toLocaleTimeString();

  return (
    <li
      className="rounded p-2 text-[11px]"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DecisionBadge decision={claim.decision} />
          <span className="font-mono truncate" style={{ color: 'var(--ink-muted)' }}>{claim.phase}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>{ts}</span>
          {(claim.criteria || claim.obligations.length > 0 || claim.policy_ids.length > 0) && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs"
              style={{ color: 'var(--ink-dim)' }}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5 text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
          {claim.criteria && (
            <p>
              <span className="font-semibold" style={{ color: 'var(--ink-muted)' }}>criteria: </span>
              {claim.criteria}
            </p>
          )}

          {claim.policy_ids.length > 0 && (
            <div>
              <p className="font-semibold" style={{ color: 'var(--ink-muted)' }}>policies matched:</p>
              <ul className="list-inside list-disc pl-1">
                {claim.policy_ids.map((pid) => <li key={pid}>{pid}</li>)}
              </ul>
            </div>
          )}

          {claim.obligations.length > 0 && (
            <div>
              <p className="font-semibold" style={{ color: 'var(--ink-muted)' }}>obligations:</p>
              <ul className="list-inside list-disc pl-1">
                {claim.obligations.map((ob, i) => <li key={i}>{ob}</li>)}
              </ul>
            </div>
          )}

          <p>
            evaluator: <span>{claim.evaluator_identity}</span>
            {' · '}claim: <span>{claim.claim_id}</span>
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * One governance decision the RUN'S OWN record carries (its snapshot + durable
 * event tail), independent of the conformance claims wire. The panel derives
 * these so an empty claims wire can never contradict the page beside it: the
 * same run whose banner and Decisions panel show a gate deny must never read
 * "no governance" here (the J1 self-contradiction pin).
 */
interface RunRecordDecision {
  ord: number;
  source: 'gate' | 'unit' | 'hook';
  detail: string;
}

/** The run model's own governance activity: gate denies, unit denial reasons,
 *  and per-tool-call hook denies — everything the Decisions panel and the halt
 *  banner render from. Approvals are NOT collected: a vacuous pass proves
 *  nothing (FINDING-025), and this list exists to prevent contradiction, not
 *  to overclaim governance. */
export function runRecordDecisions(model: RunModel): RunRecordDecision[] {
  const out: RunRecordDecision[] = [];
  for (const u of model.units) {
    for (const g of u.gateEvals) {
      if (!g.combined) {
        out.push({ ord: u.ord, source: 'gate', detail: g.denialReason ?? g.criterion ?? 'gate denied' });
      }
    }
    // The snapshot's denial_reason, when no gateEvaluated event survived to say
    // the same thing — one deny, not two rows for one fact.
    if (u.denialReason !== null && !u.gateEvals.some((g) => !g.combined && g.denialReason === u.denialReason)) {
      out.push({ ord: u.ord, source: 'unit', detail: u.denialReason });
    }
    for (const h of u.hookFires) {
      if (h.decision === 'deny') {
        out.push({
          ord: u.ord, source: 'hook',
          detail: `${h.toolName} denied${h.denyingPolicy !== null ? ` by ${h.denyingPolicy}` : ''}`,
        });
      }
    }
  }
  return out;
}

export function GovernanceAudit({ model }: Props): React.ReactElement {
  const [claims, setClaims] = useState<GovernanceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { claims: all } = await api.listClaims();
      setClaims(all.filter((c) => c.scope === model.session.id).sort((a, b) => a.evaluated_at - b.evaluated_at));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [model.session.id]);

  useEffect(() => { void load(); }, [load]);

  const refreshBtn = (
    <button
      type="button"
      onClick={() => void load()}
      className="self-start text-[10px] font-mono hover:underline"
      style={{ color: 'var(--ink-dim)' }}
    >
      Refresh
    </button>
  );

  if (loading) return <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>Loading governance claims…</p>;
  if (error) {
    return (
      <div className="flex flex-col gap-1">
        <p
          className="rounded px-2 py-1 text-xs font-mono"
          style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
        >
          {error}
        </p>
        {refreshBtn}
      </div>
    );
  }

  if (claims.length === 0) {
    // The J1 non-contradiction rule: this panel reads ONE wire (the conformance
    // store's claims), and the page around it reads another (the run's own
    // snapshot + event tail). When the claims wire is empty but the run's own
    // record shows governance activity, the panel must say exactly that split —
    // never a flat "no governance" beside a halt banner carrying a deny.
    const recorded = runRecordDecisions(model);
    if (recorded.length > 0) {
      return (
        <div className="flex flex-col gap-2">
          <p data-testid="governance-wire-empty" className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
            This panel reads the conformance store’s claims wire, which holds no
            claims scoped to this run.
          </p>
          <div data-testid="governance-run-record" className="flex flex-col gap-1.5">
            <p className="text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
              The run’s own decision record DOES show governance activity — the full
              gate record is in the Decisions panel:
            </p>
            <ul className="flex flex-col gap-1">
              {recorded.map((d, i) => (
                <li
                  key={i}
                  data-testid="governance-run-decision"
                  className="rounded p-2 text-[11px] font-mono"
                  style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
                >
                  <span
                    className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono mr-2"
                    style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}
                  >
                    DENY
                  </span>
                  <span style={{ color: 'var(--ink-muted)' }}>unit #{d.ord} · {d.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          {refreshBtn}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
          No governance claims recorded for this run.
        </p>
        <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          {/* §7.10: issue numbers are internal notes, not user copy. */}
          Claims appear once wicked-core runs governance decisions for a run.
        </p>
        {refreshBtn}
      </div>
    );
  }

  const denies = claims.filter((c) => c.decision === 'deny').length;
  const conditioned = claims.filter((c) => c.decision === 'allow_with_conditions').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          {claims.length} decision{claims.length !== 1 ? 's' : ''}
          {denies > 0 && <span className="ml-1 font-semibold" style={{ color: 'var(--status-fail)' }}>· {denies} denied</span>}
          {conditioned > 0 && <span className="ml-1" style={{ color: 'var(--status-gate)' }}>· {conditioned} with obligations</span>}
        </p>
        {refreshBtn}
      </div>
      <ol className="flex flex-col gap-1.5">
        {claims.map((c) => (
          <ClaimRow key={c.claim_id} claim={c} />
        ))}
      </ol>
    </div>
  );
}
