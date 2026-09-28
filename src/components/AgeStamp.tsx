import { ageVerdict, brokenClockLabel, brokenClockTitle } from '../board/ageHonesty.js';
import { ago } from './ProjectCard.js';

/**
 * One rendered age (studio Wave A, idea 14). A plausible clock renders as the plain age word
 * (`ago()`, plus `suffix`); an absent or impossible one renders as a pill that SAYS so — "age
 * unknown" / "impossible age" — and, given `href`, links to the record. Inside an element that is
 * already a link, omit `href`: the pill is then a span and the enclosing link opens the record.
 */
export function AgeStamp({ at, now, href, onOpen, suffix = '', testId, style }: {
  at: number | null | undefined;
  now: number;
  /** The record the pill opens (omit when the stamp sits inside a link already). */
  href?: string;
  /** In-app navigation for `href` (a plain link when absent). */
  onOpen?: (path: string) => void;
  suffix?: string;
  testId?: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  const v = ageVerdict(at, now);
  if (v.kind === 'ok') {
    return <span data-testid={testId} style={style}>{ago(v.at, now)}{suffix}</span>;
  }
  const pill: React.CSSProperties = {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-semi)',
    // A data-quality note, not a failure: muted ink on a dashed hairline — red stays reserved for
    // failed runs (design council C3).
    color: 'var(--ink-muted)', background: 'transparent',
    border: '1px dashed var(--border-strong)',
    borderRadius: '999px', padding: '0 7px', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none',
  };
  const common = {
    'data-testid': testId,
    'data-age-pill': v.kind,
    title: brokenClockTitle(v),
    style: { ...style, ...pill },
  };
  if (href === undefined) return <span {...common}>{brokenClockLabel(v)}</span>;
  return (
    <a
      {...common}
      href={href}
      onClick={(e) => {
        if (onOpen === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        onOpen(href);
      }}
    >
      {brokenClockLabel(v)} ›
    </a>
  );
}
