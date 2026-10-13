import type { Inbox } from 'lucide-react';
import type { Navigate } from '../../hooks/useRoute.js';
import { useLayoutEffect, useRef } from 'react';
import { Sparkline } from '../charts/Chart.js';

/** The Desk's shared pieces: one stat tile and one refine select, used by every tab (Work, Runs, Report). */

/** Smallest a tile's number shrinks to before it is clipped. */
const FIT_FLOOR_PX = 18;

/**
 * A tile's number fits its tile: when the value is wider than the tile (e.g. "$1.39" or "at least $12.40" in a
 * narrow Report tile), its font shrinks just enough to show it whole, never below FIT_FLOOR_PX. It is measured
 * again when the value, the tile's width or the loaded fonts change; the stylesheet's size is used whenever it fits.
 */
function useFitWidth(value: string | null): React.RefObject<HTMLSpanElement> {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || value === null) return undefined;
    let width = -1;
    const fit = (): void => {
      el.style.fontSize = '';
      if (el.clientWidth === 0 || el.scrollWidth <= el.clientWidth) return;
      const base = Number.parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(base)) return;
      el.style.fontSize = `${Math.max(FIT_FLOOR_PX, Math.floor(base * (el.clientWidth / el.scrollWidth) * 10) / 10)}px`;
    };
    fit();
    let live = true;
    // A web font that lands after the first measure changes the number's width, not the tile's.
    void document.fonts?.ready.then(() => { if (live) fit(); });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    ro?.observe(el.parentElement ?? el);
    return () => { live = false; ro?.disconnect(); };
  }, [value]);
  return ref;
}

export function DeskStat({ icon: Icon, tone, label, value, note, spark, testId, href, navigate, loading = value === null, loadingNote = 'Reading…' }: {
  /** The block opens its filtered list or report. */
  href?: string;
  navigate?: Navigate;
  icon: typeof Inbox;
  tone: 'gate' | 'run' | 'ok' | 'accent' | 'fail';
  label: string;
  /** null = not read yet (never 0 for unknown). */
  value: string | null;
  /** A completed read can have no value (for example, no checks recorded). */
  loading?: boolean;
  loadingNote?: string;
  note: string;
  spark?: readonly number[];
  testId: string;
}): React.ReactElement {
  const valueRef = useFitWidth(value);
  return (
    <li className={`wk-card wk-stat${href !== undefined ? ' wk-stat--link' : ''}`} data-testid={testId} data-tone={tone}>
      {href !== undefined && <a href={href} className="wk-stat-hit" data-testid={`${testId}-open`} aria-label={`${label}: open`} onClick={(e) => { if (navigate === undefined) return; e.preventDefault(); navigate(href); }} />}
      <span className="wk-stat-icon" aria-hidden><Icon size={16} /></span>
      <span className="wk-stat-label">{label}</span>
      <span ref={valueRef} className="wk-stat-value" aria-busy={loading ? 'true' : undefined}>{value ?? (loading ? <span className="wk-stat-wait">…</span> : '—')}</span>
      <span className="wk-stat-foot">
        <span className="wk-stat-note">{loading ? loadingNote : note}</span>
        {spark !== undefined && value !== null && <Sparkline values={spark} color={tone === 'ok' ? 'var(--status-ok)' : 'var(--accent)'} width={56} height={24} />}
      </span>
    </li>
  );
}

export function RefineSelect({ label, all, value, options, onChange, testId }: {
  label: string; all: string; value: string | null; options: readonly { value: string; label: string }[]; onChange: (v: string | null) => void; testId: string;
}): React.ReactElement {
  return (
    <label className="wk-refine-select">
      <span className="wk-sr-only">{label}</span>
      <select className="wk-field" data-testid={testId} value={value ?? ''} data-active={value !== null ? 'true' : undefined} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
