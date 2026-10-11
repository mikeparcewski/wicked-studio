/** One sentence-case line of facts replacing KPI tiles (design/UI-CONTRACT.md §4.6; audit rows 42, 45).
 *  Zeros hidden unless `showZero`; unknown (null) always hidden; nothing renders when nothing is known. */
export function StatLine({ items, showZero = false, 'data-testid': testId = 'stat-line' }: {
  items: readonly { label: string; value: number | null }[]; showZero?: boolean; 'data-testid'?: string;
}): React.ReactElement | null {
  const shown = items.filter((i) => i.value !== null && (showZero || i.value !== 0));
  if (shown.length === 0) return null;
  return (
    <p data-testid={testId} className="wk-statline">
      {shown.map((i, n) => (
        <span key={i.label} className="wk-statline-item">
          {n > 0 && <span aria-hidden className="wk-statline-sep"> · </span>}
          <span className="wk-num wk-statline-value">{i.value}</span> {i.label}
        </span>
      ))}
    </p>
  );
}
