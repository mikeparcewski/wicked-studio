/**
 * TimeRangeSelector — shared pill-group for the recency window (usability
 * review #9: the run DTO carries no timestamps, so the window is the newest
 * N runs and the labels say so honestly — "last 30", never "30d").
 * Visual style matches the existing range pills in CenterDashboard.
 */
import type { TimeRange } from '../hooks/useTimeRange.js';
import { TIME_RANGE_OPTIONS } from '../hooks/useTimeRange.js';

const mono = { fontFamily: 'monospace' } as const;

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
          style={{
            padding: '3px 8px',
            borderRadius: '5px',
            fontSize: '10px',
            fontWeight: 600,
            ...mono,
            cursor: 'pointer',
            border: '1px solid',
            borderColor: value === r ? 'var(--accent)' : 'var(--surface-raised)',
            background: value === r ? 'var(--accent-subtle)' : 'transparent',
            color: value === r ? 'var(--accent)' : 'var(--ink-dim)',
            transition: 'all 0.15s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
