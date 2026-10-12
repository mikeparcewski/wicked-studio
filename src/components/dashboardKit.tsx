import { TimeRangeSelector } from './TimeRangeSelector.js';
import type { TimeRange } from '../hooks/useTimeRange.js';

/**
 * The section-dashboard kit (lane B): the FilterStrip (search + status chips + the recency-window
 * picker, first-class at the top of every list) and the DashboardGrid (the full-width responsive
 * card grid). Its StatTile / KpiBand / Sparkline retired with the KPI tiles; the contract's stat
 * tile is `ui/StatTile.tsx` (UI-CONTRACT §4.6, amended 2026-10-12).
 */

// ── FilterStrip ───────────────────────────────────────────────────────────────

export interface FilterChip {
  id: string;
  label: string;
  /** The chip's live count — rendered beside the label when present. */
  count?: number;
}

export interface FilterStripProps {
  testId: string;
  query: string;
  onQuery: (q: string) => void;
  placeholder?: string;
  chips: readonly FilterChip[];
  active: string;
  onChip: (id: string) => void;
  /** The recency-window picker (Work page idiom) — omitted where no window applies. */
  range?: TimeRange;
  onRange?: (r: TimeRange) => void;
  /** Extra first-class chips (e.g. "+N older · show all"). */
  children?: React.ReactNode;
}

export function FilterStrip({
  testId, query, onQuery, placeholder = 'Search…', chips, active, onChip, range, onRange, children,
}: FilterStripProps): React.ReactElement {
  // UI-CONTRACT §4.5 (ASK 05:24Z, w9-s5): the shared field and chip primitives (sans, >= 11 px, one
  // focus ring), and a chip whose count is 0 is hidden unless it is the active filter.
  const shown = chips.filter((c) => c.count !== 0 || c.id === active);
  return (
    <div data-testid={testId} data-filter={active} role="group" aria-label="Filters" className="wk-filterstrip">
      <input
        type="search"
        data-testid={`${testId}-search`}
        aria-label={placeholder.replace(/…$/, '')}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        className="wk-field wk-filterstrip-search"
      />
      {shown.map((c) => (
        <button
          key={c.id}
          type="button"
          data-testid={`${testId}-chip`}
          data-chip={c.id}
          aria-pressed={active === c.id}
          onClick={() => onChip(c.id)}
          className="wk-chip"
        >
          {c.label}
          {c.count !== undefined && <span className="wk-num wk-filterstrip-count">{c.count}</span>}
        </button>
      ))}
      {children}
      <span className="wk-filterstrip-gap" />
      {range !== undefined && onRange !== undefined && (
        <TimeRangeSelector value={range} onChange={onRange} />
      )}
    </div>
  );
}

// ── DashboardGrid ─────────────────────────────────────────────────────────────

/** Full-width responsive card grid — flows with the viewport, never a max-width. */
export function DashboardGrid({ testId, min = 320, children }: {
  testId: string;
  /** Minimum card column width in px. */
  min?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`,
        gap: 'var(--space-3)',
        width: '100%',
        alignItems: 'stretch',
      }}
    >
      {children}
    </div>
  );
}
