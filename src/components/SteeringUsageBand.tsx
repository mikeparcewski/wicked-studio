import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError, isRouteAbsent } from '../api/errors.js';
import { steeringPath, STEERING_TYPE_LABELS } from '../api/steering.js';
import type { SteeringRule } from '../api/steering.js';
import { testingPath } from '../api/testing.js';
import type { GovernanceClaim, SessionView } from '../api/types.js';
import { governedRuns, ruleUsage, usageWindows, USAGE_WINDOW_DAYS } from '../board/steeringUsage.js';
import { useEvalReportStore } from '../store/evalReport.js';
import { KpiBand, StatTile } from './dashboardKit.js';
import type { ScoreboardState } from './SteeringHealth.js';

/**
 * The STEERING USAGE band — when/how steering was used and how well it works, on the
 * `/steering` landing (dashboardKit, ≤6 tiles, every tile a door to something real):
 *
 *  1. GATE EVALUATIONS — claims recorded this window, delta + daily sparkline
 *     (`GET /governance/claims`; the claim record IS the gateEvaluated/gateDecided fold,
 *     durably timestamped) → /work, where the evaluated runs live.
 *  2. DENIALS ISSUED — same window, bad-up delta → /work.
 *  3. RUNS GOVERNED — % of live runs with ≥1 recorded evaluation (claim scopes name their
 *     run; joined against the one runs list) → /work.
 *  4. ALLOW / DENY — the current window's decision split → /work.
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

  const windowWord = `last ${USAGE_WINDOW_DAYS}d`;
  const claimsAbsentWord =
    claims.kind === 'unsupported'
      ? 'claims not served by this daemon'
      : claims.kind === 'failed'
        ? 'claims read failed'
        : 'loading…';
  const deltaContext = (previous: number | null): string =>
    previous === null ? `${windowWord} — no proven prior window` : `${windowWord} vs previous ${USAGE_WINDOW_DAYS}d`;

  const unusedHome =
    usage !== null && usage.unusedIds.length > 0
      ? `${steeringPath(usage.unusedHomeType ?? 'architecture')}?usage=unused`
      : null;

  return (
    <KpiBand testId="steering-usage">
      <StatTile
        testId="steering-usage-evals"
        label="Gate evaluations"
        value={windows !== null ? windows.evaluations.current : '—'}
        delta={windows?.evaluations}
        spark={windows?.spark}
        context={windows !== null ? deltaContext(windows.evaluations.previous) : claimsAbsentWord}
        title="Recorded governance claims (gate evaluations) in the window — click for the runs they governed"
        onOpen={() => navigate('/work')}
        href="/work"
      />
      <StatTile
        testId="steering-usage-denials"
        label="Denials issued"
        value={windows !== null ? windows.denials.current : '—'}
        delta={windows?.denials}
        deltaSense="bad-up"
        valueColor={windows !== null && windows.denials.current > 0 ? 'var(--status-fail)' : undefined}
        context={windows !== null ? deltaContext(windows.denials.previous) : claimsAbsentWord}
        title="Gate evaluations that decided deny — click for the runs surface"
        onOpen={() => navigate('/work')}
        href="/work"
      />
      <StatTile
        testId="steering-usage-governed"
        label="Runs governed"
        value={governed !== null && governed.pct !== null ? `${governed.pct}%` : '—'}
        context={
          governed !== null
            ? governed.total === 0
              ? 'no runs on this daemon yet'
              : `${governed.governed} of ${governed.total} runs saw ≥1 gate evaluation`
            : claimsAbsentWord
        }
        title="Share of live runs with at least one recorded gate evaluation"
        onOpen={() => navigate('/work')}
        href="/work"
      />
      <StatTile
        testId="steering-usage-split"
        label="Allow / deny"
        value={windows !== null ? `${windows.allow} / ${windows.deny}` : '—'}
        context={
          windows !== null
            ? `${windowWord} · ${windows.conditions} with conditions`
            : claimsAbsentWord
        }
        title="This window's decision split — click for the runs surface"
        onOpen={() => navigate('/work')}
        href="/work"
      />
      <StatTile
        testId="steering-usage-rules"
        label="Unused rules"
        value={usage !== null ? usage.unusedIds.length : '—'}
        valueColor={usage !== null && usage.unusedIds.length > 0 ? 'var(--status-gate)' : undefined}
        context={
          usage === null
            ? scoreboard.kind === 'unsupported'
              ? 'scoreboard not served by this daemon'
              : scoreboard.kind === 'failed'
                ? 'scoreboard read failed'
                : 'loading…'
            : usage.topFired !== null
              ? `top fired: ${usage.topFired.ruleId} ×${usage.topFired.total} · ${usage.firedCount} rules evidenced`
              : 'no rule has fired yet — nothing in the enforcement record'
        }
        title={
          unusedHome !== null
            ? `Active rules with zero enforcement evidence — open ${STEERING_TYPE_LABELS[usage?.unusedHomeType ?? 'architecture']} filtered to them`
            : 'Active rules with zero enforcement evidence (no denial claims, no governs evidence)'
        }
        {...(unusedHome !== null ? { onOpen: () => navigate(unusedHome), href: unusedHome } : {})}
      />
      <StatTile
        testId="steering-usage-eval"
        label="Latest eval"
        value={
          latestEval !== null
            ? `${latestEval.report.summary.caught}/${latestEval.report.summary.total}`
            : '—'
        }
        valueColor={
          latestEval !== null && latestEval.report.summary.gaps > 0 ? 'var(--status-gate)' : undefined
        }
        context={
          latestEval !== null
            ? `caught · ${latestEval.report.summary.gaps} gaps · ${latestEval.report.summary.false_positives} false pos — this session`
            : 'no eval run this session — run one on Testing › Evals'
        }
        title="The steering-rule eval verdict (caught vs gap) — the success lens; session-local because the daemon keeps no eval history"
        onOpen={() => navigate(testingPath('evals'))}
        href={testingPath('evals')}
      />
    </KpiBand>
  );
}
