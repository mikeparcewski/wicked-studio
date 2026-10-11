import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError, isRouteAbsent } from '../api/errors.js';
import { policiesPath, STEERING_TYPE_LABELS } from '../api/steering.js';
import type { SteeringRule } from '../api/steering.js';
import { testingPath } from '../api/testing.js';
import type { GovernanceClaim, SessionView } from '../api/types.js';
import { everythingPath } from '../board/everythingModel.js';
import { governedRuns, ruleUsage, usageWindows, USAGE_WINDOW_DAYS } from '../board/steeringUsage.js';
import { useEvalReportStore } from '../store/evalReport.js';
import { StatLine } from './ui/index.js';
import type { ScoreboardState } from './SteeringHealth.js';


/** Where every "the runs" tile opens: See everything › Sessions. */
const SESSIONS_PATH = everythingPath({ tab: 'sessions' });

/**
 * The STEERING USAGE band — when/how steering was used and how well it works, on the
 * `/steering` landing (dashboardKit, ≤6 tiles, every tile a door to something real):
 *
 *  1. GATE EVALUATIONS — claims recorded this window, delta + daily sparkline
 *     (`GET /governance/claims`; the claim record IS the gateEvaluated/gateDecided fold,
 *     durably timestamped) → See everything › Sessions, where the evaluated runs live.
 *  2. DENIALS ISSUED — same window, bad-up delta → Sessions.
 *  3. RUNS GOVERNED — % of live runs with ≥1 recorded evaluation (claim scopes name their
 *     run; joined against the one runs list) → Sessions.
 *  4. ALLOW / DENY — the current window's decision split → Sessions.
 *  5. UNUSED RULES — active rules the enforcement record never cites (per_rule evidence:
 *     denial_claims + governs_evidence == 0) → the type page holding the most, grid
 *     FILTERED to those ids (`?usage=unused`). Context names the top-fired rule.
 *  6. LATEST EVAL — the success lens: caught/gaps from THIS SESSION's eval run (the daemon
 *     keeps no queryable eval history), honest absent tile otherwise → Testing › Evals.
 *
 * HONESTY: deltas render only over proven full prior windows (steeringUsage.ts); a daemon
 * that does not serve the claims wire gets "—" tiles saying so, never zeros dressed as
 * measurements; the scoreboard-less daemon gets the same on the rules tile.
 */

type ClaimsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; claims: GovernanceClaim[] }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string };

export function SteeringUsageBand({ runs, rules, scoreboard, navigate, now }: {
  runs: SessionView[];
  rules: SteeringRule[];
  scoreboard: ScoreboardState;
  navigate: (path: string) => void;
  /** Test seam — defaults to the real clock. */
  now?: number;
}): React.ReactElement {
  const [claims, setClaims] = useState<ClaimsState>({ kind: 'loading' });
  const latestEval = useEvalReportStore((s) => s.latest);

  useEffect(() => {
    let cancelled = false;
    api
      .listClaims()
      .then(({ claims: all }) => {
        if (!cancelled) setClaims({ kind: 'loaded', claims: all });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if ((e instanceof ApiError && e.status === 501) || isRouteAbsent(e)) {
          setClaims({ kind: 'unsupported' });
        } else {
          setClaims({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const at = now ?? Date.now();
  const loaded = claims.kind === 'loaded' ? claims.claims : null;
  const windows = loaded !== null ? usageWindows(loaded, at) : null;
  const governed = loaded !== null ? governedRuns(loaded, runs) : null;
  const usage =
    scoreboard.kind === 'loaded' ? ruleUsage(rules, scoreboard.scoreboard.evidence.per_rule) : null;

  const deltaOf = (d: { current: number; previous: number | null } | undefined): string =>
    d === undefined || d.previous === null ? 'none' : String(d.current - d.previous);
  const claimsNote =
    claims.kind === 'unsupported'
      ? 'Studio’s service doesn’t report gate checks yet.'
      : claims.kind === 'failed'
        ? 'Couldn’t read the gate checks.'
        : null;
  const usageNote =
    usage !== null || claims.kind === 'loading'
      ? null
      : scoreboard.kind === 'unsupported'
        ? 'Rule usage isn’t reported by Studio’s service yet.'
        : scoreboard.kind === 'failed'
          ? 'Couldn’t read rule usage.'
          : null;

  const unusedHome =
    usage !== null && usage.unusedIds.length > 0
      ? `${policiesPath(usage.unusedHomeType ?? 'architecture')}&usage=unused`
      : null;
  const evalPath = testingPath('evals');
  const delta = windows !== null && windows.evaluations.previous !== null
    ? windows.evaluations.current - windows.evaluations.previous
    : null;

  // KPI tiles are retired (UI-CONTRACT §4.6; studio#689 row 45: truncated tile captions): one
  // sentence-case line of facts, a meta line, and two doors. Unknown numbers are hidden, never 0.
  return (
    <section
      data-testid="steering-usage"
      className="wk-steer-usage"
      data-evals={windows !== null ? windows.evaluations.current : '—'}
      data-evals-delta={deltaOf(windows?.evaluations)}
      data-denials={windows !== null ? windows.denials.current : '—'}
      data-denials-delta={deltaOf(windows?.denials)}
      data-split={windows !== null ? `${windows.allow} / ${windows.deny}` : '—'}
      data-governed={governed !== null && governed.pct !== null ? `${governed.pct}%` : '—'}
      data-unused={usage !== null ? usage.unusedIds.length : '—'}
      data-eval={latestEval !== null ? `${latestEval.report.summary.caught}/${latestEval.report.summary.total}` : '—'}
    >
      <StatLine
        showZero
        items={[
          { label: `gate check${windows?.evaluations.current === 1 ? '' : 's'} in the last ${USAGE_WINDOW_DAYS} days`, value: windows !== null ? windows.evaluations.current : null },
          { label: 'denied', value: windows !== null ? windows.denials.current : null },
          { label: `rule${usage?.unusedIds.length === 1 ? '' : 's'} never used`, value: usage !== null ? usage.unusedIds.length : null },
        ]}
      />
      <p className="wk-test-facts-meta">
        {windows !== null && (
          <span data-testid="steering-usage-delta">
            {delta === null ? 'Nothing to compare with yet' : `${delta >= 0 ? '+' : ''}${delta} vs the ${USAGE_WINDOW_DAYS} days before`}
            {' · '}{windows.allow} allowed, {windows.deny} denied{windows.conditions > 0 ? `, ${windows.conditions} with conditions` : ''}
          </span>
        )}
        {governed !== null && governed.total > 0 && governed.pct !== null && (
          <span data-testid="steering-usage-governed">
            {windows !== null ? ' · ' : ''}{governed.pct}% of runs checked ({governed.governed} of {governed.total})
          </span>
        )}
        {usage !== null && usage.topFired !== null && (
          <span data-testid="steering-usage-top"> · most used: {usage.topFired.ruleId} ({usage.topFired.total}×)</span>
        )}
        {claimsNote !== null && <span data-testid="steering-usage-claims-note">{claimsNote}</span>}
        {usageNote !== null && <span data-testid="steering-usage-rules-note">{claimsNote !== null ? ' ' : ''}{usageNote}</span>}
      </p>
      <p className="wk-steer-usage-doors">
        {unusedHome !== null && (
          <a
            data-testid="steering-usage-rules"
            href={unusedHome}
            onClick={(e) => { e.preventDefault(); navigate(unusedHome); }}
            className="wk-link"
            title={`Open ${STEERING_TYPE_LABELS[usage?.unusedHomeType ?? 'architecture']} rules, filtered to the unused ones`}
          >
            Show unused rules
          </a>
        )}
        {windows !== null && windows.evaluations.current > 0 && (
          <a
            data-testid="steering-usage-runs"
            href={SESSIONS_PATH}
            onClick={(e) => { e.preventDefault(); navigate(SESSIONS_PATH); }}
            className="wk-link"
          >
            See the runs
          </a>
        )}
        <a
          data-testid="steering-usage-eval"
          href={evalPath}
          onClick={(e) => { e.preventDefault(); navigate(evalPath); }}
          className="wk-link"
        >
          {latestEval !== null
            ? `Latest eval: ${latestEval.report.summary.caught} of ${latestEval.report.summary.total} caught, ${latestEval.report.summary.gaps} gap${latestEval.report.summary.gaps === 1 ? '' : 's'}`
            : 'Run an eval'}
        </a>
      </p>
    </section>
  );
}
