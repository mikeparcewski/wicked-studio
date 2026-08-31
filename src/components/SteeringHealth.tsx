import { STEERING_TYPE_LABELS, type SteeringType } from '../api/steering.js';
import { scoreboardVerdict, VERDICT_COPY, type WikiScoreboard, type WikiVerdict } from '../api/wiki.js';

/**
 * The Steering type page's health header (AW-23 scoreboard) — extracted verbatim from the old
 * monolithic SteeringPage: per-type numbers when the wire serves `by_steering_type`, the
 * store-wide numbers labeled as store-wide when it does not, and the honest "engine predates
 * the scoreboard" state on 501/route-absent (a pre-0.7.5 engine keeps its existing callout).
 */

export type ScoreboardState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'loaded'; scoreboard: WikiScoreboard };

const VERDICT_COLOR: Record<WikiVerdict, string> = {
  empty: 'var(--ink-dim)',
  decaying: 'var(--status-fail)',
  populated: 'var(--status-done)',
  unproven: 'var(--status-gate)',
};

/** One health-header stat: the number, its label, and the honest sub-line when it cannot be measured. */
function Stat({ testid, label, value, sub }: {
  testid: string;
  label: string;
  value: string;
  sub?: string | undefined;
}): React.ReactElement {
  return (
    <div
      data-testid={testid}
      className="flex flex-col gap-0.5 rounded p-3 min-w-[10rem]"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span className="text-lg font-semibold font-mono" style={{ color: 'var(--ink-high)' }}>{value}</span>
      {sub !== undefined && (
        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{sub}</span>
      )}
    </div>
  );
}

const pct = (v: number | undefined): string => (v === undefined ? '—' : `${Math.round(v)}%`);

export function SteeringHealth({ state, type }: { state: ScoreboardState; type: SteeringType }): React.ReactElement {
  if (state.kind === 'loading') {
    return <p data-testid="steering-health-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Measuring steering health…</p>;
  }
  if (state.kind === 'unsupported') {
    // The honest adoption state: the daemon is fine, its engine just predates the scoreboard —
    // say that, and say what the page still does (the rules wire below ships today).
    return (
      <p
        data-testid="steering-health-unsupported"
        className="rounded px-3 py-2 text-xs"
        style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
      >
        This daemon&rsquo;s engine predates the governance scoreboard — population and connection cannot
        be measured here yet. The rules browser below still reads the live store.
      </p>
    );
  }
  if (state.kind === 'failed') {
    return (
      <p data-testid="steering-health-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
        {state.message}
      </p>
    );
  }
  const sb = state.scoreboard;
  const verdict = scoreboardVerdict(sb);
  // Per-type numbers ONLY when the wire serves them (`by_steering_type`, steering-model lane);
  // otherwise the store-wide numbers, labeled as store-wide — never a fabricated per-type zero.
  const perType = sb.by_steering_type?.[type];
  return (
    <div data-testid="steering-health" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="steering-verdict"
          data-verdict={verdict}
          title={`${VERDICT_COPY[verdict]} (derived in studio from the raw AW-23 signals shown beside it)`}
          className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ color: VERDICT_COLOR[verdict], border: `1px solid ${VERDICT_COLOR[verdict]}` }}
        >
          {verdict}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>{VERDICT_COPY[verdict]}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {perType !== undefined ? (
          <Stat
            testid="steering-stat-rules-type"
            label={`${STEERING_TYPE_LABELS[type]} rules`}
            value={`${perType.rules_active} active`}
            sub={`${perType.rules_total} total · ${perType.rules_retired} retired`}
          />
        ) : (
          <Stat
            testid="steering-stat-rules"
            label="Rules (store-wide)"
            value={`${sb.rules_active} active`}
            sub={`${sb.rules_total} total · ${sb.rules_retired} retired — this engine reports no per-type split`}
          />
        )}
        <Stat
          testid="steering-stat-typed"
          label="Typed"
          value={sb.typing.available ? pct(sb.typing.percent) : 'not measured'}
          sub={
            sb.typing.available
              ? `${sb.typing.statements_typed} of ${sb.typing.statements_total} statements across ${sb.typing.docs_scanned} docs`
              : sb.typing.reason ?? 'no docs root supplied to the daemon'
          }
        />
        <Stat
          testid="steering-stat-resolving"
          label="Refs resolving"
          value={sb.connection.rules_with_ref === 0 ? 'no refs' : pct(sb.connection.percent)}
          sub={`${sb.connection.refs_resolving} of ${sb.connection.rules_with_ref} symbol refs · ${sb.connection.rules_linked} rules linked to code`}
        />
        <Stat
          testid="steering-stat-denials"
          label="Denials citing rules"
          value={String(sb.evidence.denial_claims)}
          sub={`${sb.evidence.rules_evidenced} rules evidenced · ${sb.evidence.governs_evidence_total} governs-evidence total`}
        />
      </div>
    </div>
  );
}
