import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { GovernanceClaim } from '../api/types.js';
import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

function DecisionBadge({ decision }: { decision: GovernanceClaim['decision'] }): React.ReactElement {
  const styles: Record<GovernanceClaim['decision'], string> = {
    allow: 'bg-green-100 text-green-800',
    deny: 'bg-red-100 text-red-800',
    allow_with_conditions: 'bg-yellow-100 text-yellow-800',
  };
  const labels: Record<GovernanceClaim['decision'], string> = {
    allow: 'ALLOW',
    deny: 'DENY',
    allow_with_conditions: 'ALLOW ＋ OBLIGATIONS',
  };
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[decision]}`}>
      {labels[decision]}
    </span>
  );
}

function ClaimRow({ claim }: { claim: GovernanceClaim }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ts = new Date(claim.evaluated_at * 1000).toLocaleTimeString();

  return (
    <li className="rounded border border-gray-200 bg-white p-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DecisionBadge decision={claim.decision} />
          <span className="font-mono text-gray-600 truncate">{claim.phase}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-gray-400">{ts}</span>
          {(claim.criteria || claim.obligations.length > 0 || claim.policy_ids.length > 0) && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="text-gray-400 hover:text-gray-700"
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5 text-[10px]">
          {claim.criteria && (
            <p className="text-gray-500">
              <span className="font-semibold text-gray-700">criteria: </span>
              {claim.criteria}
            </p>
          )}

          {claim.policy_ids.length > 0 && (
            <div>
              <p className="font-semibold text-gray-700">policies matched:</p>
              <ul className="list-inside list-disc pl-1 text-gray-500">
                {claim.policy_ids.map((pid) => (
                  <li key={pid} className="font-mono">{pid}</li>
                ))}
              </ul>
            </div>
          )}

          {claim.obligations.length > 0 && (
            <div>
              <p className="font-semibold text-gray-700">obligations:</p>
              <ul className="list-inside list-disc pl-1 text-gray-500">
                {claim.obligations.map((ob, i) => (
                  <li key={i}>{ob}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-gray-400">
            evaluator: <span className="font-mono">{claim.evaluator_identity}</span>
            {' · '}claim: <span className="font-mono">{claim.claim_id}</span>
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * FR: Governance Audit view (crew#43). Fetches all conformance claims from the
 * governance store and filters to this run's scope, showing each decision with its
 * phase, decision badge, matched policies, and attached obligations.
 */
export function GovernanceAudit({ model }: Props): React.ReactElement {
  const [claims, setClaims] = useState<GovernanceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { claims: all } = await api.listClaims();
      // Filter to this run's scope. The scope field matches the run id (session id).
      setClaims(all.filter((c) => c.scope === model.session.id).sort((a, b) => a.evaluated_at - b.evaluated_at));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [model.session.id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-gray-400">Loading governance claims…</p>;
  if (error) {
    return (
      <div className="flex flex-col gap-1">
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="self-start text-[10px] text-gray-400 hover:text-gray-700 underline"
        >
          Refresh
        </button>
      </div>
    );
  }

  if (claims.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-400">No governance claims recorded for this run.</p>
        <p className="text-[10px] text-gray-300">
          Claims appear when wicked-core runs governance decisions (core#24/#26).
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-1 self-start text-[10px] text-gray-400 hover:text-gray-700 underline"
        >
          Refresh
        </button>
      </div>
    );
  }

  const denies = claims.filter((c) => c.decision === 'deny').length;
  const conditioned = claims.filter((c) => c.decision === 'allow_with_conditions').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400">
          {claims.length} decision{claims.length !== 1 ? 's' : ''}
          {denies > 0 && <span className="ml-1 text-red-600 font-semibold">· {denies} denied</span>}
          {conditioned > 0 && (
            <span className="ml-1 text-yellow-600">· {conditioned} with obligations</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] text-gray-400 hover:text-gray-700 underline"
        >
          Refresh
        </button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {claims.map((c) => (
          <ClaimRow key={c.claim_id} claim={c} />
        ))}
      </ol>
    </div>
  );
}
