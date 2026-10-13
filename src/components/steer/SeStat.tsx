import type { LucideIcon } from 'lucide-react';
import type { Navigate } from '../../hooks/useRoute.js';

/**
 * The Steer and Evaluate stat tile: Desk v2's tile (icon, label, big number, one note line) in
 * this surface's own scope, so it reads the same whether the Desk hosts it or it stands alone.
 * `value === null` is "not read yet", never zero. A tile with `href` is one big link.
 */
export function SeStat({ icon: Icon, tone, label, value, of, note, testId, href, onClick, navigate, title }: {
  icon: LucideIcon;
  tone: 'accent' | 'ok' | 'warn' | 'gate' | 'fail';
  label: string;
  value: string | null;
  /** A quiet denominator after the number ("/ 27"). */
  of?: string | undefined;
  /** The tile is one big button (an in-page action) instead of a link. */
  onClick?: () => void;
  note: string;
  testId: string;
  href?: string;
  navigate?: Navigate;
  title?: string | undefined;
}): React.ReactElement {
  return (
    <li className={`wk-card wk-se-stat${href !== undefined || onClick !== undefined ? ' wk-se-stat--link' : ''}`} data-testid={testId} data-tone={tone} {...(title !== undefined ? { title } : {})}>
      {href !== undefined && (
        <a href={href} className="wk-se-stat-hit" data-testid={`${testId}-open`} aria-label={`${label}: open`}
          onClick={(e) => {
            if (href.startsWith('#')) {
              e.preventDefault();
              document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              return;
            }
            if (navigate === undefined) return;
            e.preventDefault();
            navigate(href);
          }} />
      )}
      {onClick !== undefined && href === undefined && (
        <button type="button" className="wk-se-stat-hit" data-testid={`${testId}-open`} aria-label={`${label}: show`} onClick={onClick} />
      )}
      <span className="wk-se-stat-icon" aria-hidden><Icon size={16} /></span>
      <span className="wk-se-stat-label">{label}</span>
      <span className="wk-se-stat-value" aria-busy={value === null ? 'true' : undefined}>{value ?? <span className="wk-se-stat-wait">…</span>}{value !== null && of !== undefined && <span className="wk-se-stat-of">{of}</span>}</span>
      <span className="wk-se-stat-note">{value === null ? 'Reading…' : note}</span>
    </li>
  );
}

export function SeStats({ children, 'data-testid': testId }: { children: React.ReactNode; 'data-testid'?: string }): React.ReactElement {
  return <ul className="wk-se-stats" {...(testId !== undefined ? { 'data-testid': testId } : {})}>{children}</ul>;
}
