/** A progress bar whose fill is value/total (design/UI-CONTRACT.md §4.6; audit row 8: never full at
 *  "0 of 2"). total 0 or null = an empty track and "Nothing yet"; values clamp to 0..total. */
export function Progress({ value, total, tone = 'ok', label, 'data-testid': testId = 'progress' }: {
  value: number | null; total: number | null; tone?: 'ok' | 'fail' | 'run'; label: string; 'data-testid'?: string;
}): React.ReactElement {
  const known = total !== null && total > 0 && value !== null;
  const v = known ? Math.min(Math.max(value, 0), total) : 0;
  const pct = known ? (v / total) * 100 : 0;
  return (
    <div className="wk-progress-field" data-testid={testId}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={known ? total : 0} aria-valuenow={v}
        className="wk-progress">
        <span className={`wk-progress-fill wk-progress-fill--${tone}`} style={{ width: `${pct}%` }} data-testid={`${testId}-fill`} />
      </div>
      {!known && <span className="wk-progress-note">Nothing yet</span>}
    </div>
  );
}
