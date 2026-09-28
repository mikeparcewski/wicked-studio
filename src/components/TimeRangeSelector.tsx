/**
 * TimeRangeSelector — shared pill-group for the recency window (usability
 * review #9: the run DTO carries no timestamps, so the window is the newest
 * N runs and the labels say so honestly — "last 30", never "30d").
 * Visual style matches the existing range pills in CenterDashboard.
 */
import type { TimeRange } from '../hooks/useTimeRange.js';
import { TIME_RANGE_OPTIONS } from '../hooks/useTimeRange.js';

interface Props {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
}

export function TimeRangeSelector({ value, onChange }: Props): React.ReactElement {
  return (
    <div role="group" aria-label="Show newest runs" style={{ display: 'flex', gap: '4px' }}>
      {TIME_RANGE_OPTIONS.map(({ value: r, label }) => (
        <button
          key={r}
          type="button"
          data-range={r}
          aria-pressed={value === r}
          onClick={() => onChange(r)}
          // The shared chip (styles/components.css): a 24px target, sans label, the pressed
          // period in the accent wash — one control vocabulary with the rest of the app.
          className="wk-chip"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
