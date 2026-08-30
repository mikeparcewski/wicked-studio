import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type {
  AcceptanceConformance,
  AcceptanceConformanceClaim,
  GovernanceClaim,
  RunAcceptanceView,
} from '../api/types.js';
import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

type Decision = 'allow' | 'deny' | 'allow_with_conditions';

function DecisionBadge({ decision }: { decision: Decision }): React.ReactElement {
  const styles: Record<Decision, { bg: string; color: string }> = {
    allow:                { bg: 'var(--status-run-dim)',   color: 'var(--status-run)' },
    deny:                 { bg: 'var(--status-fail-dim)',   color: 'var(--status-fail)' },
    allow_with_conditions:{ bg: 'var(--status-gate-dim)', color: 'var(--status-gate)' },
  };
  const labels: Record<Decision, string> = {
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

/** Legacy fallback row — the raw conformance-store claim (pre-0.8 daemons). */
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

/** A run-scoped claim from the acceptance view's conformance section, rule citations visible. */
function ConformanceClaimRow({ claim }: { claim: AcceptanceConformanceClaim }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ts = new Date(claim.evaluatedAt * 1000).toLocaleTimeString();
  const hasDetail = claim.rules.length > 0 || claim.obligations.length > 0 || claim.policyIds.length > 0;

  return (
    <li
      data-testid="conformance-claim"
      className="rounded p-2 text-[11px]"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DecisionBadge decision={claim.decision} />
          {claim.advisory && (
            <span
              className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-mono"
              style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
              title="Blocked and audited, but not unit-fatal: a boundary READ deny leaks nothing."
            >
              advisory
            </span>
          )}
          <span className="font-mono truncate" style={{ color: 'var(--ink-muted)' }}>{claim.phase}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>{ts}</span>
          {hasDetail && (
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

      {/* Rule citations render CLOSED too — the violated wiki rule must be visible
          without a click, this being the whole point of the section (AW-14). */}
      {claim.rules.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {claim.rules.map((r) => (
            <li
              key={`${r.ruleId}-${r.statement}`}
              data-testid="conformance-rule-citation"
              className="rounded px-1.5 py-1 text-[10px] font-mono"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
            >
              <span className="font-semibold">{r.ruleId}</span>
              <span style={{ color: 'var(--ink-dim)' }}> · {r.severity} · </span>
              {r.statement}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-2 flex flex-col gap-1.5 text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
          {claim.policyIds.length > 0 && (
            <div>
              <p className="font-semibold">policies matched:</p>
              <ul className="list-inside list-disc pl-1">
                {claim.policyIds.map((pid) => <li key={pid}>{pid}</li>)}
              </ul>
            </div>
          )}
          {claim.obligations.length > 0 && (
            <div>
              <p className="font-semibold">obligations (verbatim):</p>
              <ul className="list-inside list-disc pl-1">
                {claim.obligations.map((ob, i) => <li key={i}>{ob}</li>)}
              </ul>
            </div>
          )}
          <p>
            evaluator: <span>{claim.evaluator}</span>
            {' · '}claim: <span>{claim.claimId}</span>
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

/** The run model's own unenforced units (`governanceUnenforced` — FINDING-063).
 *  Deny-dominates across SOURCES: if either the acceptance wire or the run's
 *  own event record says a governed unit ran unchecked, the panel says so. */
export function modelUnenforcedUnits(
  model: RunModel,
): { ord: number; cli: string; reason: string }[] {
  const out: { ord: number; cli: string; reason: string }[] = [];
  for (const u of model.units) {
    if (u.governanceUnenforced !== null) {
      out.push({ ord: u.ord, cli: u.governanceUnenforced.cli, reason: u.governanceUnenforced.reason });
    }
  }
  return out;
}

/** The one banner state the panel headlines with. `guardrailed` renders ONLY
 *  when the wire affirmatively said so AND no source reports unenforced. */
type EnforcementBanner =
  | { kind: 'unenforced'; rows: { ord: number; cli: string; reason: string }[] }
  | { kind: 'guardrailed'; detail: string }
  | { kind: 'enforced-not-clean'; detail: string }
  | { kind: 'ungoverned'; detail: string }
  | { kind: 'unverifiable'; detail: string }
  | null;

/** Merge wire + run-record enforcement, deny-dominates. Exported for tests. */
export function resolveEnforcementBanner(
  conformance: AcceptanceConformance | undefined,
  model: RunModel,
): EnforcementBanner {
  const local = modelUnenforcedUnits(model);
  const wireRows = conformance?.enforcement.unenforced ?? [];
  if (local.length > 0 || wireRows.length > 0) {
    // Union by ord — the wire reads the same durable log the model backfills
    // from, so overlap is the normal case; either alone still dominates.
    const byOrd = new Map<number, { ord: number; cli: string; reason: string }>();
    for (const r of wireRows) byOrd.set(r.ord, { ord: r.ord, cli: r.cli, reason: r.reason });
    for (const r of local) if (!byOrd.has(r.ord)) byOrd.set(r.ord, r);
    return { kind: 'unenforced', rows: [...byOrd.values()].sort((a, b) => a.ord - b.ord) };
  }
  if (conformance === undefined) return null; // older daemon: no wire, no claim either way
  if (conformance.guardrailed) return { kind: 'guardrailed', detail: conformance.summary };
  switch (conformance.enforcement.status) {
    case 'enforced':
      return { kind: 'enforced-not-clean', detail: conformance.summary };
    case 'ungoverned':
      return { kind: 'ungoverned', detail: conformance.enforcement.reason };
    default:
      return { kind: 'unverifiable', detail: conformance.enforcement.reason };
  }
}

function EnforcementBannerView({ banner }: { banner: Exclude<EnforcementBanner, null> }): React.ReactElement {
  if (banner.kind === 'unenforced') {
    return (
      <div
        data-testid="governance-enforcement"
        data-status="unenforced"
        className="rounded p-2 flex flex-col gap-1"
        style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail-dim)' }}
      >
        <p className="text-[11px] font-mono font-semibold" style={{ color: 'var(--status-fail)' }}>
          UNENFORCED — governed unit(s) ran with unchecked tool calls
        </p>
        <ul className="flex flex-col gap-0.5">
          {banner.rows.map((r) => (
            <li key={r.ord} data-testid="governance-unenforced-unit" className="text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
              unit #{r.ord} · {r.cli} — {r.reason}
            </li>
          ))}
        </ul>
        <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          This run is not guardrailed. Phase-boundary output gating still applied.
        </p>
      </div>
    );
  }
  const styleFor: Record<Exclude<EnforcementBanner, null>['kind'], { label: string; bg: string; color: string }> = {
    unenforced: { label: '', bg: '', color: '' }, // handled above
    guardrailed: { label: 'GUARDRAILED', bg: 'var(--status-run-dim)', color: 'var(--status-run)' },
    'enforced-not-clean': { label: 'ENFORCED — DENIALS STAND', bg: 'var(--status-gate-dim)', color: 'var(--status-gate)' },
    ungoverned: { label: 'UNGOVERNED', bg: 'var(--surface-rail)', color: 'var(--ink-muted)' },
    unverifiable: { label: 'UNVERIFIED', bg: 'var(--status-gate-dim)', color: 'var(--status-gate)' },
  };
  const s = styleFor[banner.kind];
  return (
    <div
      data-testid="governance-enforcement"
      data-status={banner.kind}
      className="rounded p-2 flex flex-col gap-0.5"
      style={{ background: s.bg, border: '1px solid var(--surface-raised)' }}
    >
      <p className="text-[11px] font-mono font-semibold" style={{ color: s.color }}>{s.label}</p>
      <p className="text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>{banner.detail}</p>
    </div>
  );
}

/** The written-down coverage boundary (AW-18 / arch-R16): rendered ALWAYS, so
 *  "guardrailed" can never read as a blanket property of every seat. */
function CoverageBoundaryNote(): React.ReactElement {
  return (
    <p data-testid="governance-coverage-boundary" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
      Coverage boundary: deterministic per-tool-call guardrails (gate-hook injection) exist for
      claude seats only. A governed unit routed to any other CLI runs with phase-boundary
      output-gate coverage only — advisory relative to mid-flight tool-call blocking — and is
      reported UNENFORCED here, never guardrailed.
    </p>
  );
}

export function GovernanceAudit({ model }: Props): React.ReactElement {
  const [acceptance, setAcceptance] = useState<RunAcceptanceView | null>(null);
  const [claims, setClaims] = useState<GovernanceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The acceptance view is the primary wire (AW-14: run-scoped conformance
      // beside the QE verdict). A daemon that predates it answers without a
      // `conformance` field — fall back to the raw claims wire below.
      let view: RunAcceptanceView | null = null;
      try {
        const fetched = await api.getRunAcceptance(model.session.id);
        if (fetched !== null && typeof fetched === 'object' && fetched.conformance !== undefined) {
          view = fetched;
        }
      } catch {
        view = null; // older daemon / transient — the fallback path answers
      }
      setAcceptance(view);
      if (view === null) {
        const { claims: all } = await api.listClaims();
        // Both scope spellings: the engine's run grammar (`wicked-agent/<id>/…`)
        // and the bare id older writers used.
        setClaims(
          all
            .filter(
              (c) =>
                c.scope === model.session.id ||
                c.scope === `wicked-agent/${model.session.id}/shared` ||
                c.scope.startsWith(`wicked-agent/${model.session.id}/unit/`),
            )
            .sort((a, b) => a.evaluated_at - b.evaluated_at),
        );
      } else {
        setClaims([]);
      }
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

  const banner = resolveEnforcementBanner(acceptance?.conformance, model);

  // ── The conformance-section path (crew ≥ 0.8): enforcement + QE gate + run-scoped claims ──
  if (acceptance !== null && acceptance.conformance !== undefined) {
    const conf = acceptance.conformance;
    return (
      <div className="flex flex-col gap-2">
        {banner !== null && <EnforcementBannerView banner={banner} />}

        {/* The QE verdict BESIDE the governance one — deny-dominates on each side. */}
        <p data-testid="acceptance-gate-line" className="text-[10px] font-mono" style={{ color: 'var(--ink-muted)' }}>
          <span
            className="font-semibold"
            style={{ color: acceptance.gate.satisfied ? 'var(--status-run)' : 'var(--status-fail)' }}
          >
            QE acceptance: {acceptance.gate.satisfied ? 'SATISFIED' : 'DENIED'}
          </span>
          {' — '}{acceptance.gate.reason}
        </p>

        {!conf.claimsAvailable && (
          <p
            data-testid="governance-claims-unavailable"
            className="rounded px-2 py-1 text-[10px] font-mono"
            style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
          >
            Conformance claims unreadable{conf.claimsError !== undefined ? `: ${conf.claimsError}` : ''} — not
            shown as clean.
          </p>
        )}

        {conf.claims.length > 0 ? (
          <>
            <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
              {conf.claims.length} decision{conf.claims.length !== 1 ? 's' : ''}
              {conf.denials > 0 && (
                <span className="ml-1 font-semibold" style={{ color: 'var(--status-fail)' }}>· {conf.denials} denied</span>
              )}
              {conf.advisoryDenials > 0 && (
                <span className="ml-1" style={{ color: 'var(--status-gate)' }}>· {conf.advisoryDenials} advisory</span>
              )}
            </p>
            <ol className="flex flex-col gap-1.5">
              {conf.claims.map((c) => (
                <ConformanceClaimRow key={c.claimId} claim={c} />
              ))}
            </ol>
          </>
        ) : (
          conf.claimsAvailable && (
            <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
              No conformance claims scoped to this run.
            </p>
          )
        )}

        <CoverageBoundaryNote />
        {refreshBtn}
      </div>
    );
  }

  // ── Fallback path (older daemon): the raw claims wire + the J1 non-contradiction split ──
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
          {banner !== null && <EnforcementBannerView banner={banner} />}
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
          <CoverageBoundaryNote />
          {refreshBtn}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        {banner !== null && <EnforcementBannerView banner={banner} />}
        <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>
          No governance claims recorded for this run.
        </p>
        <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          {/* §7.10: issue numbers are internal notes, not user copy. */}
          Claims appear once wicked-core runs governance decisions for a run.
        </p>
        <CoverageBoundaryNote />
        {refreshBtn}
      </div>
    );
  }

  const denies = claims.filter((c) => c.decision === 'deny').length;
  const conditioned = claims.filter((c) => c.decision === 'allow_with_conditions').length;

  return (
    <div className="flex flex-col gap-2">
      {banner !== null && <EnforcementBannerView banner={banner} />}
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
      <CoverageBoundaryNote />
    </div>
  );
}
