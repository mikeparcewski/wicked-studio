import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { GovernanceClaim } from '../api/types.js';
import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

function DecisionBadge({ decision }: { decision: GovernanceClaim['decision'] }): React.ReactElement {
  const styles: Record<GovernanceClaim['decision'], { bg: string; color: string }> = {
    allow:                { bg: 'rgba(63,185,80,0.12)',   color: '#3fb950' },
    deny:                 { bg: 'rgba(248,81,73,0.12)',   color: '#f85149' },
    allow_with_conditions:{ bg: 'rgba(255,218,25,0.12)',  color: '#ffda19' },
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
      style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.07)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DecisionBadge decision={claim.decision} />
          <span className="font-mono truncate" style={{ color: 'rgba(230,237,243,0.6)' }}>{claim.phase}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>{ts}</span>
          {(claim.criteria || claim.obligations.length > 0 || claim.policy_ids.length > 0) && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-xs"
              style={{ color: 'rgba(230,237,243,0.35)' }}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5 text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>
          {claim.criteria && (
            <p>
              <span className="font-semibold" style={{ color: 'rgba(230,237,243,0.7)' }}>criteria: </span>
              {claim.criteria}
            </p>
          )}

          {claim.policy_ids.length > 0 && (
            <div>
              <p className="font-semibold" style={{ color: 'rgba(230,237,243,0.7)' }}>policies matched:</p>
              <ul className="list-inside list-disc pl-1">
                {claim.policy_ids.map((pid) => <li key={pid}>{pid}</li>)}
              </ul>
            </div>
          )}

          {claim.obligations.length > 0 && (
            <div>
              <p className="font-semibold" style={{ color: 'rgba(230,237,243,0.7)' }}>obligations:</p>
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
      style={{ color: 'rgba(230,237,243,0.4)' }}
    >
      Refresh
    </button>
  );

  if (loading) return <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>Loading governance claims…</p>;
  if (error) {
    return (
      <div className="flex flex-col gap-1">
        <p
          className="rounded px-2 py-1 text-xs font-mono"
          style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.2)' }}
        >
          {error}
        </p>
        {refreshBtn}
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
          No governance claims recorded for this run.
        </p>
        <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>
          Claims appear when wicked-core runs governance decisions (core#24/#26).
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
        <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
          {claims.length} decision{claims.length !== 1 ? 's' : ''}
          {denies > 0 && <span className="ml-1 font-semibold" style={{ color: '#f85149' }}>· {denies} denied</span>}
          {conditioned > 0 && <span className="ml-1" style={{ color: '#ffda19' }}>· {conditioned} with obligations</span>}
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
