import { useMemo } from 'react';
import type { SessionView } from '../api/types.js';
import { RunSparkline } from './RunSparkline.js';

/**
 * The quiet-row 7-day activity sparkline (DES-FEEDBACK-001 §2.1/§2.3, slice E):
 * 16×56, `--ink-dim` bars, one bucket per day — answering "Which of my quiet
 * projects is quietly doing work?" inline in the quiet-band project row.
 *
 * Counted off the membership `attached_at` clock — when each run entered the
 * project, the one per-run timestamp the wire carries (`AgentSession` has no
 * timestamps) — exactly as the slice-D dashboard's activity tile counts. A
 * project with zero in-window runs renders NOTHING: absence stays absent
 * (§2.3 — transparent, never zero-height slivers).
 */

const DAY = 24 * 3_600_000;
const DAYS = 7;

interface Props {
  runs: SessionView[];
  /** Run id → membership `attached_at` (epoch ms) for THIS project. */
  attachedAt: Record<string, number>;
  now?: number;
}

export function ProjectSparkline({ runs, attachedAt, now }: Props): React.ReactElement | null {
  const at = now ?? Date.now();
  const counts = useMemo(() => {
    const buckets = new Array<number>(DAYS).fill(0);
    for (const v of runs) {
      const clock = attachedAt[v.session.id];
      if (clock === undefined) continue;
      const age = at - clock;
      if (age < 0 || age >= DAYS * DAY) continue;
      const bucket = DAYS - 1 - Math.floor(age / DAY);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    return buckets;
  }, [runs, attachedAt, at]);

  if (counts.every((c) => c === 0)) return null;

  return (
    <span
      data-testid="project-sparkline"
      data-question="Which of my quiet projects is quietly doing work?"
      data-total={counts.reduce((a, c) => a + c, 0)}
      title={`runs entering this project, last ${DAYS} days`}
      style={{ display: 'inline-flex', flexShrink: 0 }}
    >
      <RunSparkline counts={counts} width={56} height={16} color="var(--ink-dim)" />
    </span>
  );
}
