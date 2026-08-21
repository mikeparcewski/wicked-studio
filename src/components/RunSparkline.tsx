/**
 * RunSparkline — the §2.3 bar sparkline, SVG-first, no chart library.
 *
 * One `<rect>` per bucket, height proportional to that bucket's count within
 * the series max; buckets with no count render nothing (transparent per §2.3,
 * never a zero-height sliver pretending to be data). Colors are semantic
 * tokens only — the DEFAULT is `--ink-dim` (the quiet-band spelling); a caller
 * that means status passes a status token.
 *
 * Deliberately its own tiny component (DES-FEEDBACK-001 §8.3 slice D): the
 * project dashboard's 7-day activity tile uses it now, and slice E's home
 * metrics bar + quiet-band project rows reuse it rather than re-deriving the
 * `<rect>` math.
 */

interface Props {
  /** Bucket counts, oldest first (e.g. 7 daily run counts). */
  counts: number[];
  width?: number;
  height?: number;
  /** Fill token for buckets with a count. Semantic tokens only (EC15). */
  color?: string;
  testId?: string;
}

const BAR_GAP = 2;

export function RunSparkline({
  counts,
  width = 56,
  height = 16,
  color = 'var(--ink-dim)',
  testId,
}: Props): React.ReactElement {
  const n = Math.max(1, counts.length);
  const max = counts.reduce((a, c) => Math.max(a, c), 0);
  const colW = (width - BAR_GAP * (n - 1)) / n;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`activity: ${counts.join(', ')}`}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {max > 0 && counts.map((c, i) => {
        if (c <= 0) return null;
        // Full height for the max; at least 2px so a 1-in-a-big-week day is visible.
        const h = Math.max(2, (c / max) * height);
        return (
          <rect
            key={i}
            x={i * (colW + BAR_GAP)}
            y={height - h}
            width={colW}
            height={h}
            rx={1}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
