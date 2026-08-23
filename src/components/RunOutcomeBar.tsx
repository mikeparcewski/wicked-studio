import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { outcomeOf, outcomeTotals24h, WINDOW_24H_MS, type Outcome } from '../board/metrics.js';
import { MetricTile } from './MetricTile.js';

// Slice W (DES-UX-001 §5.3): the outcome mapping + windowed totals moved to
// THE one metrics module; this tile renders them. Re-exported for importers.
export { outcomeOf } from '../board/metrics.js';

/**
 * Run outcome bar (DES-FEEDBACK-001 §2.1/§2.3, slice E): the home metrics-bar
 * tile answering the named operator question "Is the system healthy right now?".
 *
 * SVG-first, no chart library (§2.3): 12 stacked bars, one per 2-hour window
 * over the last 24h, segments filled with the status tokens (`--status-run`
 * working / `--status-gate` waiting / `--status-fail` failed-or-cancelled /
 * `--status-done` completed).
 *
 * WIRE HONESTY — the clock. §2.4 assumed a `created_at` on the session;
 * `AgentSession` carries NO timestamps (the board model documents this). The
 * one honest per-run clock the app already fetches is the membership
 * `attached_at` (when the run entered its project) — the same clock the
 * slice-D project dashboard buckets its 7-day activity on — so the windows
 * bucket on THAT, and runs with no attach clock inside the window (unfiled /
 * orphaned, or simply older than 24h) are excluded from the bars and reported
 * in the label rather than painted at an invented time.
 */

const WINDOWS = 12;
const WINDOW_MS = WINDOW_24H_MS / WINDOWS; // 2h × 12 = the shared 24h span
/** ViewBox geometry — stretched to the tile via preserveAspectRatio="none". */
const W = 168;
const H = 26;
const COL_GAP = 2;

/** Stack order bottom→top, with the fill token each segment means. */
const SEGMENTS: ReadonlyArray<{ key: Outcome; fill: string }> = [
  { key: 'run', fill: 'var(--status-run)' },
  { key: 'gate', fill: 'var(--status-gate)' },
  { key: 'fail', fill: 'var(--status-fail)' },
  { key: 'done', fill: 'var(--status-done)' },
];

interface Props {
  runs: SessionView[];
  /** Run id → membership `attached_at` (epoch ms) — from `useBoardModel`. */
  attachedAt: Record<string, number>;
  /** Injectable clock for tests; defaults to the real one. */
  now?: number;
  /** Dashboard reuse (DES-FEEDBACK-003 §4): each surface's own §4 table row
   *  names its question/title (EC19); defaults stay the home bar's. */
  question?: string;
  title?: string;
}

export function RunOutcomeBar({
  runs, attachedAt, now,
  question = 'Is the system healthy right now?',
  title = 'Runs (24h)',
}: Props): React.ReactElement {
  const at = now ?? Date.now();
  // Slice W (§5.3): the COUNTS are the shared selector's — `outcomeTotals24h`,
  // the same numbers `failedCount24h` reports everywhere. Only the per-2h
  // bucket PLACEMENT (chart geometry) is derived here, on the same clock rule.
  const counts = useMemo(() => outcomeTotals24h(runs, attachedAt, at), [runs, attachedAt, at]);
  const { windows } = useMemo(() => {
    const buckets = Array.from({ length: WINDOWS }, () => ({ run: 0, gate: 0, fail: 0, done: 0 }));
    const start = at - WINDOWS * WINDOW_MS;
    for (const v of runs) {
      if (v.session.archived_at != null) continue;
      const clock = attachedAt[v.session.id];
      if (clock === undefined || clock < start || clock > at) continue;
      const ix = Math.min(WINDOWS - 1, Math.floor((clock - start) / WINDOW_MS));
      const bucket = buckets[ix];
      if (bucket !== undefined) bucket[outcomeOf(v.session.status)] += 1;
    }
    return { windows: buckets };
  }, [runs, attachedAt, at]);
  const unplaced = counts.unplaced;

  const inWindow = counts.run + counts.gate + counts.fail + counts.done;
  const colMax = windows.reduce((m, w) => Math.max(m, w.run + w.gate + w.fail + w.done), 0);
  const colW = (W - COL_GAP * (WINDOWS - 1)) / WINDOWS;

  const value =
    inWindow === 0
      ? 'no runs in 24h'
      : [
          counts.run > 0 ? `${counts.run} working` : null,
          counts.gate > 0 ? `${counts.gate} gate` : null,
          counts.fail > 0 ? `${counts.fail} failed` : null,
          counts.done > 0 ? `${counts.done} done` : null,
        ].filter((s) => s !== null).join(' · ');

  return (
    <MetricTile
      testId="run-outcome-bar"
      question={question}
      title={title}
      value={value}
      data={{ 'data-total': inWindow, 'data-unplaced': unplaced, 'data-window': '24h' }}
    >
      {inWindow === 0 ? (
        // Honest emptiness: no bars, one quiet line — never a wall of zero-height
        // rects pretending to be data (§2.3).
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          No runs attached in the last 24h.
        </p>
      ) : (
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`run outcomes over the last 24h: ${value}`}
          style={{ display: 'block' }}
        >
          {windows.map((w, i) => {
            const total = w.run + w.gate + w.fail + w.done;
            if (total === 0) return null;
            let y = H;
            return SEGMENTS.map(({ key, fill }) => {
              if (w[key] === 0) return null;
              const h = Math.max(2, (w[key] / colMax) * H);
              y -= h;
              return (
                <rect
                  key={`${i}-${key}`}
                  x={i * (colW + COL_GAP)}
                  y={y}
                  width={colW}
                  height={h}
                  fill={fill}
                />
              );
            });
          })}
        </svg>
      )}
    </MetricTile>
  );
}
