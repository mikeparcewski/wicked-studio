import { Skeleton, StateBanner } from './ui/index.js';
import { STEERING_TYPE_LABELS, type SteeringType } from '../api/steering.js';
import { scoreboardVerdict, VERDICT_COPY, type WikiScoreboard, type WikiVerdict } from '../api/wiki.js';

/**
 * The Steering health surfaces, re-scoped by the usability review (#5 — the
 * store-wide "36 active" + red "decaying" pill + CLI-flag diagnostics rendered
 * on EVERY type page, including Security holding zero rules of its own):
 *
 *  - `SteeringHealth` (type pages) shows ONLY that type's numbers — the wire's
 *    per-type split when served, otherwise a client-side count of the loaded
 *    rules, labeled as exactly that. An EMPTY type page renders no stats at
 *    all: the rule list's own empty state and the Add menu are the message.
 *  - `SteeringStoreHealth` (the landing — the one place the store-wide verdict
 *    is actionable) carries the verdict pill, the store-wide rule count, and
 *    the ingest diagnostics COLLAPSED behind a details toggle.
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

/** One health stat: the number, its label, and the honest sub-line when it cannot be measured. */
function Stat({ testid, label, value, sub }: {
  testid: string;
  label: string;
  value: string;
  sub?: string | undefined;
}): React.ReactElement {
  return (
    <div data-testid={testid} className="wk-steer-stat">
      <span className="wk-steer-stat-label">{label}</span>
      <span className="wk-steer-stat-value">{value}</span>
      {sub !== undefined && <span className="wk-steer-stat-sub">{sub}</span>}
    </div>
  );
}

const pct = (v: number | undefined): string => (v === undefined ? '—' : `${Math.round(v)}%`);

/**
 * The TYPE page's health header: this type's numbers, nothing store-wide.
 * `typeRuleCount` is the client-side count of loaded rules filed under this
 * type — the honest fallback when the wire serves no per-type split.
 */
export function SteeringHealth({ state, type, typeRuleCount }: {
  state: ScoreboardState;
  type: SteeringType;
  typeRuleCount: number;
}): React.ReactElement | null {
  if (state.kind === 'loading') {
    return <div data-testid="steering-health-loading"><Skeleton rows={1} variant="line" /></div>;
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
        Studio&rsquo;s service can&rsquo;t measure rule health yet. The rules below are live.
      </p>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div data-testid="steering-health-error">
        <StateBanner kind="partial" what="rule health" error={state.message} />
      </div>
    );
  }
  const sb = state.scoreboard;
  // The engine's `by_type` map (wicked-governance Scoreboard) holds one row per
  // type that HAS rules — an absent row on a served map means zero, so the map's
  // presence alone selects the wire path.
  const perType = sb.by_type?.[type] ?? (sb.by_type !== undefined ? { total: 0, active: 0, retired: 0 } : undefined);
  // An EMPTY type page loses the stats entirely (review #5): the rule list's
  // empty state + the Add menu carry the message; store-wide numbers rendered
  // here read as this type's and lie.
  const empty = perType !== undefined ? perType.total === 0 : typeRuleCount === 0;
  if (empty) return null;
  return (
    <div data-testid="steering-health" className="flex flex-wrap gap-2">
      {perType !== undefined ? (
        <Stat
          testid="steering-stat-rules-type"
          label={`${STEERING_TYPE_LABELS[type]} rules`}
          value={`${perType.active} active`}
          sub={`${perType.total} total · ${perType.retired} retired`}
        />
      ) : (
        <Stat
          testid="steering-stat-rules-type"
          label={`${STEERING_TYPE_LABELS[type]} rules`}
          value={`${typeRuleCount} loaded`}
          sub="counted from the loaded rules — this engine reports no per-type split"
        />
      )}
    </div>
  );
}

/**
 * The LANDING's store-wide health block — the one place the store-wide verdict
 * is actionable (review #5). The verdict pill + its honest sentence lead; the
 * raw ingest diagnostics (typing coverage, symbol refs, denial evidence) fold
 * behind a details toggle instead of shouting CLI flags on every page.
 */
export function SteeringStoreHealth({ state }: { state: ScoreboardState }): React.ReactElement | null {
  if (state.kind !== 'loaded') return null;
  const sb = state.scoreboard;
  const verdict = scoreboardVerdict(sb);
  return (
    <div data-testid="steering-store-health" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="steering-verdict"
          data-verdict={verdict}
          className="wk-tag"
          style={{ color: VERDICT_COLOR[verdict] }}
        >
          {verdict.charAt(0).toUpperCase() + verdict.slice(1)}
        </span>
        <span className="wk-test-facts-meta">{VERDICT_COPY[verdict]}</span>
      </div>
      <details data-testid="steering-diagnostics">
        <summary className="wk-steer-diag-summary" data-testid="steering-diagnostics-toggle">
          How this is measured
        </summary>
        <div className="wk-steer-diag">
          <Stat
            testid="steering-stat-rules"
            label="All rules"
            value={`${sb.rules_active} active`}
            sub={`${sb.rules_total} total · ${sb.rules_retired} retired`}
          />
          <Stat
            testid="steering-stat-typed"
            label="Statements typed"
            value={sb.typing.available ? pct(sb.typing.percent) : 'not measured'}
            sub={
              sb.typing.available
                ? `${sb.typing.statements_typed} of ${sb.typing.statements_total} statements across ${sb.typing.docs_scanned} docs`
                // Quick win #4: plain words, no CLI flags.
                : 'Not measured: the rules were loaded without their source documents.'
            }
          />
          <Stat
            testid="steering-stat-resolving"
            label="Code links that resolve"
            value={sb.connection.rules_with_ref === 0 ? 'no refs' : pct(sb.connection.percent)}
            sub={`${sb.connection.refs_resolving} of ${sb.connection.rules_with_ref} links · ${sb.connection.rules_linked} rules linked to code`}
          />
          <Stat
            testid="steering-stat-denials"
            label="Denials citing rules"
            value={String(sb.evidence.denial_claims)}
            sub={`${sb.evidence.rules_evidenced} rules have been used`}
          />
        </div>
      </details>
    </div>
  );
}
