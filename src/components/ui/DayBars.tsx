/**
 * A per-day bar chart with a count axis and a date axis (DES-frontdoor §4 requirement 5: "the 60-day
 * chart needs a count axis"). SVG, no chart library, tokens only. `series` is the total per day,
 * oldest first; `part` (optional) is the share of each day drawn in the status colour (e.g. finished),
 * the rest in the quiet tone. The y axis names its top and zero; the x axis names the first day, the
 * middle and "Today". A screen reader gets one sentence plus a table of the non-empty days.
 */
export function DayBars({ series, part, now, label, partLabel, restLabel, height = 72, 'data-testid': testId }: {
  series: readonly number[];
  part?: readonly number[];
  /** The last bucket is the day ending now. */
  now: number;
  /** The chart's name ("Jobs started per day, last 60 days"). */
  label: string;
  partLabel?: string;
  restLabel?: string;
  height?: number;
  'data-testid'?: string;
}): React.ReactElement {
  const days = series.length;
  const max = Math.max(1, ...series);
  // A round top for the axis: 1, 2, 5, 10, 20, 50 …
  const top = niceTop(max);
  const W = 600;
  const gap = days > 40 ? 2 : 3;
  const bw = (W - gap * (days - 1)) / days;
  const DAY = 86_400_000;
  const dayOf = (i: number): Date => new Date(now - (days - 1 - i) * DAY);
  const fmt = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const total = series.reduce((a, b) => a + b, 0);
  const busy = series.map((n, i) => ({ n, i })).filter((x) => x.n > 0);
  return (
    <figure data-testid={testId ?? 'day-bars'} className="wk-daybars">
      <div className="wk-daybars-plot">
        <div className="wk-daybars-y" aria-hidden>
          <span>{top}</span>
          <span>0</span>
        </div>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${total} in all`} className="wk-daybars-svg" style={{ height }}>
          <line x1={0} x2={W} y1={0.5} y2={0.5} className="wk-daybars-grid" />
          <line x1={0} x2={W} y1={height - 0.5} y2={height - 0.5} className="wk-daybars-base" />
          {series.map((n, i) => {
            if (n <= 0) return null;
            const h = Math.max(2, (n / top) * height);
            const p = Math.min(n, part?.[i] ?? 0);
            const ph = p > 0 ? Math.max(2, (p / top) * height) : 0;
            const x = i * (bw + gap);
            return (
              <g key={i}>
                <rect x={x} y={height - h} width={bw} height={h} rx={1} className="wk-daybars-rest" />
                {ph > 0 && <rect x={x} y={height - ph} width={bw} height={ph} rx={1} className="wk-daybars-part" />}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="wk-daybars-x" aria-hidden>
        <span>{fmt(dayOf(0))}</span>
        <span>{fmt(dayOf(Math.floor(days / 2)))}</span>
        <span>Today</span>
      </div>
      {part !== undefined && (partLabel !== undefined || restLabel !== undefined) && (
        <figcaption className="wk-daybars-legend">
          {partLabel !== undefined && <span><span aria-hidden className="wk-daybars-key wk-daybars-key--part" /> {partLabel}</span>}
          {restLabel !== undefined && <span><span aria-hidden className="wk-daybars-key wk-daybars-key--rest" /> {restLabel}</span>}
        </figcaption>
      )}
      <table className="wk-visually-hidden">
        <caption>{label}</caption>
        <tbody>
          {busy.map(({ n, i }) => <tr key={i}><th scope="row">{fmt(dayOf(i))}</th><td>{n}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}

export function niceTop(max: number): number {
  if (max <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
