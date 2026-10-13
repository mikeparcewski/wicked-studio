import type { Inbox } from 'lucide-react';
import type { Navigate } from '../../hooks/useRoute.js';
import { Sparkline } from '../charts/Chart.js';

/** The Desk's shared pieces: one stat tile and one refine select, used by every tab (Work, Runs, Report). */

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
  return (
    <li className={`wk-card wk-stat${href !== undefined ? ' wk-stat--link' : ''}`} data-testid={testId} data-tone={tone}>
      {href !== undefined && <a href={href} className="wk-stat-hit" data-testid={`${testId}-open`} aria-label={`${label}: open`} onClick={(e) => { if (navigate === undefined) return; e.preventDefault(); navigate(href); }} />}
      <span className="wk-stat-icon" aria-hidden><Icon size={16} /></span>
      <span className="wk-stat-label">{label}</span>
      <span className="wk-stat-value" aria-busy={loading ? 'true' : undefined}>{value ?? (loading ? <span className="wk-stat-wait">…</span> : '—')}</span>
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
