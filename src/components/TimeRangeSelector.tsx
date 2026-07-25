/**
 * TimeRangeSelector — shared pill-group for 30d / 60d / 90d time windows.
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
    <div role="group" aria-label="Time range" style={{ display: 'flex', gap: '4px' }}>
      {TIME_RANGE_OPTIONS.map(({ value: r, label }) => (
        <button
          key={r}
          type="button"
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
            borderColor: value === r ? 'rgba(121,192,255,0.5)' : 'rgba(230,237,243,0.1)',
            background: value === r ? 'rgba(121,192,255,0.12)' : 'transparent',
            color: value === r ? '#79c0ff' : 'rgba(230,237,243,0.4)',
            transition: 'all 0.15s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
