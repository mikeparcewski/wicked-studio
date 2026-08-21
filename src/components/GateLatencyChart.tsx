import { useMemo } from 'react';
import { useGateStore } from '../store/gates.js';
import { useRuntimeStore } from '../store/runtime.js';
import { MetricTile } from './MetricTile.js';

/**
 * Gate latency scatter (DES-FEEDBACK-001 §2.1/§2.3, slice E): the home
 * metrics-bar tile answering "Am I answering gates quickly or letting things
 * stall?". SVG-first, no chart library: one `<circle>` per gate (x = when it
 * opened, y = minutes until it was answered), with the dashed 30-minute
 * threshold rule in `--status-gate-dim`.
 *
 * WIRE HONESTY — the clocks. The `awaitingHuman` / `gateDecided` event types
 * exist exactly as §2.4 named them, but a live `/ws` frame carries NO `ts`
 * (arrival IS the time), so the raw event store cannot time them. Two stores
 * the app already fills carry honest clocks instead:
 *
 *   - ANSWERED gates: the runtime store's per-run log stamps every structured
 *     frame with an arrival `ts` — pairing each `awaitingHuman` entry with the
 *     next `gateDecided`/`resumed` in the same run's log gives a real observed
 *     latency (scoped to what this page has watched — no polling backfill).
 *   - OPEN gates: the gate store's `receivedAt` (the daemon-cached server ISO
 *     on reconcile, arrival time live) — elapsed-so-far is the stall signal
 *     the question is really about.
 *
 * Zero new requests: both stores are fed by the app's one `/ws` subscription
 * plus the `useRuns` reconcile that already runs.
 */

const DAY_MS = 24 * 3_600_000;
/** The §2.2 threshold: gates answered slower than this are stalling. */
const THRESHOLD_MIN = 30;
/** y-axis ceiling in minutes — slower gates clamp to the top. */
const MAX_MIN = 60;
const W = 168;
const H = 26;
const R = 2.5;

export interface GatePoint {
  /** When the gate opened (epoch ms). */
  openedAt: number;
  /** Minutes open → answered (answered) or open → now (still open). */
  minutes: number;
  open: boolean;
}

interface Props {
  now?: number;
}

export function GateLatencyChart({ now }: Props): React.ReactElement {
  const logs = useRuntimeStore((s) => s.logs);
  const gates = useGateStore((s) => s.gates);
  const at = now ?? Date.now();

  const points = useMemo(() => {
    const pts: GatePoint[] = [];
    // Answered pairs, from the arrival-stamped per-run logs.
    for (const log of Object.values(logs)) {
      let pending: number | null = null;
      for (const entry of log) {
        if (entry.type === 'awaitingHuman') {
          pending = entry.ts;
        } else if (pending !== null && (entry.type === 'gateDecided' || entry.type === 'resumed')) {
          pts.push({ openedAt: pending, minutes: (entry.ts - pending) / 60_000, open: false });
          pending = null;
        }
      }
    }
    // Still-open gates: elapsed so far, off the gate store's receivedAt.
    for (const gate of Object.values(gates)) {
      pts.push({ openedAt: gate.receivedAt, minutes: (at - gate.receivedAt) / 60_000, open: true });
    }
    return pts.filter((p) => at - p.openedAt <= DAY_MS && p.minutes >= 0);
  }, [logs, gates, at]);

  const answered = points.filter((p) => !p.open);
  const open = points.filter((p) => p.open);
  const avg = answered.length > 0
    ? answered.reduce((a, p) => a + p.minutes, 0) / answered.length
    : null;

  const value =
    points.length === 0
      ? 'no gates'
      : [
          avg !== null ? `avg ${avg < 1 ? '<1' : Math.round(avg)}m` : null,
          open.length > 0 ? `${open.length} open` : null,
        ].filter((s) => s !== null).join(' · ');

  const x = (openedAt: number): number => ((openedAt - (at - DAY_MS)) / DAY_MS) * W;
  const y = (minutes: number): number => H - (Math.min(minutes, MAX_MIN) / MAX_MIN) * (H - R) - R / 2;
  const thresholdY = y(THRESHOLD_MIN);

  return (
    <MetricTile
      testId="gate-latency-chart"
      question="Am I answering gates quickly or letting things stall?"
      title="Gate latency"
      value={value}
      data={{ 'data-count': points.length, 'data-open': open.length }}
    >
      {points.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>
          No gates in the last 24h.
        </p>
      ) : (
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`gate response times: ${value}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {/* The 30-minute stall threshold (§2.3). */}
          <line
            x1={0}
            y1={thresholdY}
            x2={W}
            y2={thresholdY}
            stroke="var(--status-gate-dim)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={Math.max(R, Math.min(W - R, x(p.openedAt)))}
              cy={y(p.minutes)}
              r={R}
              fill="var(--status-gate)"
              data-open={p.open}
            />
          ))}
        </svg>
      )}
    </MetricTile>
  );
}
