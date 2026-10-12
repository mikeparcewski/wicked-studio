import { RunSparkline } from '../RunSparkline.js';

/**
 * STAT TILES (design/UI-CONTRACT.md §4.6, amended 2026-10-12 by operator ruling: "stat tiles return as a
 * UI-contract component"). One fact per tile: a sentence-case label, ONE number, an honest note (the
 * delta against the window before, or what the number covers), and an optional bar sparkline. A band
 * of tiles is one card with hairline dividers, never a row of separate cards.
 *
 * Honesty rules (UI-CONTRACT §1.6 / §5): `value: null` is UNKNOWN — the tile shows "—" and its note
 * says why, never `0`; a delta exists only when the window before is a real window (`previous` is a
 * number); a sparkline is drawn only when at least two buckets hold something (one active day is not
 * a trend). Tokens only; sans tabular numbers (no mono on prose).
 */

export interface StatDeltaInput {
  current: number;
  /** The same-length window before; `null` = there is none, so no delta is claimed. */
  previous: number | null;
  /** How a rise reads: `bad` (failures) tints a rise red; `neutral` keeps it ink. */
  sense?: 'neutral' | 'bad';
  /** The words after the change ("vs the 7 days before"). */
  versus: string;
}

export function StatTile({ label, value, note, delta, spark, sparkTone = 'neutral', href, onOpen, 'data-testid': testId }: {
  label: string;
  /** The number as shown ("7", "13.2 min", "$11.24"); `null` = unknown, shown as "—". */
  value: string | number | null;
  /** One short line under the number (what it covers, or why it is unknown). */
  note?: string | null;
  delta?: StatDeltaInput | null;
  /** Bucket counts, oldest first. */
  spark?: readonly number[] | null;
  sparkTone?: 'neutral' | 'fail' | 'ok';
  /** A tile that counts something openable is a door to it. */
  href?: string;
  onOpen?: (e: React.MouseEvent) => void;
  'data-testid'?: string;
}): React.ReactElement {
  const known = value !== null;
  const body = (
    <>
      <span className="wk-stat-label">{label}</span>
      <span data-testid="stat-value" className={`wk-stat-value${known ? '' : ' wk-stat-value--unknown'}`}>{known ? value : '—'}</span>
      {delta !== undefined && delta !== null && <DeltaLine delta={delta} />}
      {note !== undefined && note !== null && note !== '' && <span data-testid="stat-note" className="wk-stat-note">{note}</span>}
      {spark !== undefined && spark !== null && spark.filter((n) => n > 0).length >= 2 && (
        <span className="wk-stat-spark" aria-hidden>
          <RunSparkline counts={[...spark]} width={140} height={22} color={sparkTone === 'fail' ? 'var(--status-fail)' : sparkTone === 'ok' ? 'var(--status-ok)' : 'var(--accent)'} />
        </span>
      )}
    </>
  );
  const common = { 'data-testid': testId ?? 'stat-tile', 'data-known': known ? 'true' : 'false', className: `wk-stat${href !== undefined ? ' wk-stat--door' : ''}` };
  if (href !== undefined) {
    return <a {...common} href={href} onClick={onOpen}>{body}</a>;
  }
  return <div {...common}>{body}</div>;
}

function DeltaLine({ delta }: { delta: StatDeltaInput }): React.ReactElement | null {
  if (delta.previous === null) return null;
  const diff = delta.current - delta.previous;
  const tone = diff === 0 ? 'same' : delta.sense === 'bad' ? (diff > 0 ? 'bad' : 'good') : 'neutral';
  if (diff === 0) {
    return <span data-testid="stat-delta" data-delta="0" data-tone={tone} className="wk-stat-delta wk-stat-delta--same">{`same as ${delta.versus.replace(/^vs /, '')}`}</span>;
  }
  return (
    <span data-testid="stat-delta" data-delta={String(diff)} data-tone={tone} className={`wk-stat-delta wk-stat-delta--${tone}`}>
      <span aria-hidden>{diff > 0 ? '▲' : '▼'}</span>
      <span className="wk-visually-hidden">{diff > 0 ? 'up' : 'down'}</span>
      {` ${Math.abs(diff)} ${delta.versus}`}
    </span>
  );
}

/** A band of {@link StatTile}s: one card, hairline dividers, wrapping to two or three per row on a phone. */
export function StatBand({ label, children, 'data-testid': testId }: {
  /** The band's accessible name ("How it's going, last 30 days"). */
  label: string;
  children: React.ReactNode;
  'data-testid'?: string;
}): React.ReactElement {
  return <section aria-label={label} data-testid={testId ?? 'stat-band'} className="wk-stat-band">{children}</section>;
}
