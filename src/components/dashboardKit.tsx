import { TimeRangeSelector } from './TimeRangeSelector.js';
import type { TimeRange } from '../hooks/useTimeRange.js';
import type { StatDelta } from '../board/windowStats.js';

/**
 * The section-dashboard kit (lane B): built once, worn by /projects, /p/:id
 * and /make so the three command surfaces read as one system.
 *
 *  - `StatTile` — one KPI: small uppercase label, ONE big tabular number, an
 *    HONEST delta vs the previous window ("—" when no prior bucket exists,
 *    never a fabricated 0%), a tiny context line, and a subtle inline area
 *    sparkline. Every tile is a door (`onOpen`) — nothing is decorative.
 *  - `KpiBand` / `KpiGroup` — the command-center model: tiles organized under
 *    the three operator questions (performance / pipeline / risk).
 *  - `FilterStrip` — search + status chips + the recency-window picker (the
 *    Work page's "last 30/60/90/all" idiom), first-class at the top of every
 *    list.
 *  - `DashboardGrid` — the full-width responsive card grid (CSS grid, min
 *    column width, gap-based) — no max-width constraint anywhere.
 *  - `Sparkline` / `sparkPoints` — inline SVG, no chart library.
 *
 * Tokens only (EC15): the app's existing dark palette, thin borders, threshold
 * colors ONLY where they mean something.
 */

// ── The sparkline helper (inline SVG, no chart lib) ───────────────────────────

/**
 * Polyline points for a bucket series, oldest→newest, normalized to the series
 * max. Pure — unit-tested. Empty input yields an empty string.
 */
export function sparkPoints(counts: readonly number[], width: number, height: number): string {
  const n = counts.length;
  if (n === 0) return '';
  const max = Math.max(...counts, 1);
  const stepX = n > 1 ? width / (n - 1) : width;
  return counts
    .map((c, i) => `${(i * stepX).toFixed(1)},${(height - (c / max) * height).toFixed(1)}`)
    .join(' ');
}

export function Sparkline({ counts, width = 120, height = 20, stroke = 'var(--accent)', testId }: {
  /** Bucket counts, oldest first. */
  counts: readonly number[];
  width?: number;
  height?: number;
  stroke?: string;
  testId?: string;
}): React.ReactElement | null {
  const total = counts.reduce((a, c) => a + c, 0);
  // Honest emptiness: no data draws nothing — never a flat line pretending.
  if (counts.length === 0 || total === 0) return null;
  const series = counts.length === 1 ? [counts[0]!, counts[0]!] : [...counts];
  const pts = sparkPoints(series, width, height - 2);
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`trend: ${counts.join(', ')}`}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      style={{ display: 'block', marginTop: '2px' }}
    >
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill="var(--accent-subtle)" opacity={0.6} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.9} />
    </svg>
  );
}

// ── StatTile ──────────────────────────────────────────────────────────────────

export interface StatTileProps {
  testId: string;
  /** Small uppercase label. */
  label: string;
  /** THE number (rendered tabular-nums). Strings allowed for e.g. "—". */
  value: string | number;
  /** Delta vs the previous same-size window. `previous: null` renders "—". */
  delta?: StatDelta | undefined;
  /** How to color a delta: neutral (ink) or bad-up (more failed = red). */
  deltaSense?: 'neutral' | 'bad-up' | undefined;
  /** Tiny context line (the window, honestly named). */
  context?: string | undefined;
  /** Inline area sparkline series (oldest first). Absent/all-zero = no chart. */
  spark?: readonly number[] | undefined;
  /** Threshold color for the number itself — only where it MEANS something. */
  valueColor?: string | undefined;
  /** The door: every tile clicks through to the thing it counts. */
  onOpen?: (() => void) | undefined;
  /** Optional real href for the door (middle-click / a11y). */
  href?: string | undefined;
  title?: string | undefined;
  data?: Record<string, string | number> | undefined;
}

function DeltaMark({ delta, sense }: { delta: StatDelta; sense: 'neutral' | 'bad-up' }): React.ReactElement {
  if (delta.previous === null) {
    // No prior window ⇒ no delta. "—", never 0%.
    return (
      <span
        data-testid="stat-delta"
        data-delta="none"
        title="no prior window to compare against"
        style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)' }}
      >
        —
      </span>
    );
  }
  const diff = delta.current - delta.previous;
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '·';
  const color =
    sense === 'bad-up' && diff > 0 ? 'var(--status-fail)'
    : sense === 'bad-up' && diff < 0 ? 'var(--status-run)'
    : 'var(--ink-muted)';
  return (
    <span
      data-testid="stat-delta"
      data-delta={String(diff)}
      title={`vs the previous window: ${delta.previous} before, ${delta.current} now`}
      style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color, fontVariantNumeric: 'tabular-nums' }}
    >
      {arrow} {Math.abs(diff)}
    </span>
  );
}

export function StatTile({
  testId, label, value, delta, deltaSense = 'neutral', context, spark,
  valueColor, onOpen, href, title, data,
}: StatTileProps): React.ReactElement {
  const body = (
    <>
      <span
        style={{
          fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semi)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--ink-dim)', fontFamily: 'var(--font-sans)',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
        <span
          data-testid="stat-value"
          style={{
            fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semi)',
            fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.1, color: valueColor ?? 'var(--ink-high)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
        {delta !== undefined && <DeltaMark delta={delta} sense={deltaSense} />}
      </span>
      {context !== undefined && (
        <span
          style={{
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {context}
        </span>
      )}
      {spark !== undefined && <Sparkline counts={spark} />}
    </>
  );

  const style: React.CSSProperties = {
    flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', gap: '4px', textAlign: 'left', textDecoration: 'none',
    background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-4)',
    cursor: onOpen !== undefined ? 'pointer' : 'default',
    color: 'inherit', font: 'inherit',
  };
  const common = {
    'data-testid': testId,
    'data-value': String(value),
    ...(delta !== undefined
      ? { 'data-delta': delta.previous === null ? 'none' : String(delta.current - delta.previous) }
      : {}),
    ...(data ?? {}),
    ...(title !== undefined ? { title } : {}),
    style,
  };

  if (onOpen !== undefined && href !== undefined) {
    return (
      <a {...common} href={href} onClick={(e) => { e.preventDefault(); onOpen(); }}>
        {body}
      </a>
    );
  }
  if (onOpen !== undefined) {
    return (
      <button {...common} type="button" onClick={onOpen}>
        {body}
      </button>
    );
  }
  return <div {...common}>{body}</div>;
}

// ── KpiBand — the command-center model ────────────────────────────────────────

/** The three operator questions the band is organized around. */
export function KpiBand({ testId, children }: {
  testId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch', flexWrap: 'wrap', width: '100%' }}
    >
      {children}
    </div>
  );
}

/** One question's tiles under a tiny kicker (PERFORMANCE / PIPELINE / RISK). */
export function KpiGroup({ label, children, grow = 1 }: {
  label: string;
  children: React.ReactNode;
  /** Relative width — a two-tile group grows twice a one-tile group. */
  grow?: number;
}): React.ReactElement {
  return (
    <section
      data-kpi-group={label.toLowerCase()}
      style={{
        flex: `${grow} 1 ${grow * 150}px`, minWidth: `${grow * 140}px`,
        display: 'flex', flexDirection: 'column', gap: '6px',
      }}
    >
      <p
        style={{
          margin: 0, fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semi)',
          letterSpacing: '0.1em', textTransform: 'uppercase',
          color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)',
        }}
      >
        {label}
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flex: 1, alignItems: 'stretch' }}>
        {children}
      </div>
    </section>
  );
}

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
  return (
    <div
      data-testid={testId}
      data-filter={active}
      role="group"
      aria-label="Filters"
      style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}
    >
      <input
        type="text"
        data-testid={`${testId}-search`}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        style={{
          background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
          borderRadius: 'var(--radius-md)', padding: '5px 10px',
          fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
          color: 'var(--ink-high)', outline: 'none', width: '200px',
        }}
      />
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          data-testid={`${testId}-chip`}
          data-chip={c.id}
          aria-pressed={active === c.id}
          onClick={() => onChip(c.id)}
          style={{
            borderRadius: 'var(--radius-full)', padding: '3px 10px',
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
            border: '1px solid',
            borderColor: active === c.id ? 'var(--accent)' : 'var(--surface-raised)',
            background: active === c.id ? 'var(--accent-subtle)' : 'transparent',
            color: active === c.id ? 'var(--accent)' : 'var(--ink-muted)',
          }}
        >
          {c.label}
          {c.count !== undefined && (
            <span style={{ marginLeft: '5px', fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>{c.count}</span>
          )}
        </button>
      ))}
      {children}
      <span style={{ flex: 1 }} />
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
