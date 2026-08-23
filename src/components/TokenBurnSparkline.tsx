import { useMemo } from 'react';
import { burnSteps, windowWord } from '../board/metrics.js';
import { useRuntimeStore } from '../store/runtime.js';
import { MetricTile } from './MetricTile.js';

/**
 * Token burn area sparkline (DES-FEEDBACK-001 §2.1/§2.3, slice E): the home
 * metrics-bar tile answering "What am I spending, is it accelerating?".
 * SVG-first: a cumulative `--accent`-gradient area with the running total in
 * mono.
 *
 * WIRE HONESTY — where the dollars come from. §2.1 assumed a `cost` field on
 * `SessionView`; the wire carries NONE (slice D's verifier proved it, and the
 * project dashboard already refuses to invent one). The REAL cost signal is
 * the `cliUsage` CoreEvent (`costUsd: number | null` — dollars when the CLI
 * reports them), which the app's one `/ws` subscription already ingests. The
 * runtime store's per-run log preserves each frame's `costUsd` beside its
 * arrival `ts`, so the fold here is (time, dollars) pairs of REAL reported
 * cost — scoped to what this page has observed, which the title says out
 * loud. Frames with `costUsd: null` (cost unknown) are never counted as $0;
 * they simply do not enter the fold. Zero new requests.
 */

const W = 168;
const H = 26;
const GRAD_ID = 'wk-burn-grad';

interface Props {
  now?: number;
  /** Dashboard reuse (DES-FEEDBACK-003 §4): the surface's §4 table row names
   *  the question (EC19); "observed" stays in every title — wire honesty. */
  question?: string;
  title?: string;
}

export function TokenBurnSparkline({
  now,
  question = 'What am I spending, is it accelerating?',
  title = 'Token burn (observed)',
}: Props): React.ReactElement {
  const logs = useRuntimeStore((s) => s.logs);
  const at = now ?? Date.now();

  // Slice W (§5.3): the fold is the metrics module's `burnSteps` — the same
  // frame predicate as `observedSpend`, so this curve's endpoint and the
  // spend notes beside it are the same number by construction.
  const { steps, total } = useMemo(() => burnSteps(logs), [logs]);

  // x spans first-observed → now, so the newest edge of the area is "now" and a
  // flattening slope reads as spending slowing down.
  const first = steps[0]?.ts ?? at;
  const span = Math.max(1, at - first);
  const x = (ts: number): number => ((ts - first) / span) * W;
  const y = (v: number): number => (total > 0 ? H - (v / total) * (H - 2) : H);

  const linePoints = steps.map((s) => `${x(s.ts).toFixed(1)},${y(s.total).toFixed(1)}`);
  // Hold the last observed total out to "now".
  const last = steps[steps.length - 1];
  if (last !== undefined && x(last.ts) < W) linePoints.push(`${W},${y(last.total).toFixed(1)}`);
  const areaPoints = [`0,${H}`, ...linePoints, `${W},${H}`].join(' ');

  return (
    <MetricTile
      testId="token-burn-sparkline"
      question={question}
      title={title}
      // EC39 (slice W): the total names its window — what THIS page observed.
      value={steps.length === 0 ? 'no usage yet' : `$${total.toFixed(2)} · ${windowWord('session')}`}
      data={{ 'data-total': total.toFixed(4), 'data-points': steps.length, 'data-window': 'session' }}
    >
      {steps.length === 0 ? (
        // Honest emptiness: the wire reports cost per cliUsage frame and none
        // has arrived — never a fabricated $0.00 curve.
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          No usage reported yet.
        </p>
      ) : (
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`cumulative token burn observed: $${total.toFixed(2)}`}
          style={{ display: 'block' }}
        >
          <defs>
            <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#${GRAD_ID})`} />
          <polyline
            points={linePoints.join(' ')}
            stroke="var(--accent)"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      )}
    </MetricTile>
  );
}
