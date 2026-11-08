import { healthText } from '../../board/rowHeadline.js';
import { TechDetails } from './TechDetails.js';

/**
 * EMPTY, LOADING, ERROR, OFFLINE AND PARTIAL STATES (design/UI-CONTRACT.md §4.7; studio#684). One
 * banner per page at the top of the main column, in the flow (it pushes content down, never
 * overlaps). The sentence is plain words; the raw error ("Failed to fetch", a status) only ever
 * appears inside TechDetails. Retry is a real button. Pick the kind with `readErrorKind(err)`.
 */
export type StateKind = 'offline' | 'error' | 'partial' | 'stale';

function sentence(kind: StateKind, what: string | undefined, asOf: number | null | undefined, error?: string | null): string {
  // first-run P5: crew answered, and the read names the missing piece: say what is missing, not "can't reach".
  // Any other error keeps the plain sentence below; crew's own words stay under Technical details.
  if (kind === 'error') {
    if (/memor/i.test(what ?? '') && /\b(?:wicked-)?estate\b/i.test(error ?? '')) {
      return 'Memory needs the code map service (wicked-estate), which isn’t installed or running.';
    }
    if (/skill/i.test(what ?? '') && /\b(?:wicked-)?garden\b/i.test(error ?? '')) {
      return 'Skills need wicked-garden, which isn’t installed or running.';
    }
  }
  const when = asOf != null ? new Date(asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  switch (kind) {
    case 'offline': return 'Studio can’t reach its service right now.';
    case 'error': return `Couldn’t load ${what ?? 'this page'}.`;
    case 'partial': return `Some of this couldn’t be read${what ? ` (${what})` : ''}.`;
    case 'stale': return when !== null ? `Showing what we had as of ${when}.` : 'Showing what we had before the last read failed.';
  }
}

export function StateBanner({ kind, what, error, onRetry, retrying = false, asOf, 'data-testid': testId = 'state-banner' }: {
  kind: StateKind;
  what?: string;
  error?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  asOf?: number | null;
  'data-testid'?: string;
}): React.ReactElement {
  const tone = kind === 'partial' || kind === 'stale' ? 'warn' : 'fail';
  return (
    <div data-testid={testId} data-kind={kind} role={tone === 'fail' ? 'alert' : 'status'} className={`wk-state-banner wk-state-banner--${tone}`}>
      <div className="wk-state-banner-row">
        <p className="wk-state-banner-text">{healthText(sentence(kind, what, asOf, error))}</p>
        {onRetry !== undefined && (
          <button type="button" data-testid={`${testId}-retry`} className="wk-btn wk-btn--secondary wk-btn--sm" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
      {error != null && error !== '' && <TechDetails data-testid={`${testId}-detail`} text={healthText(error)} />}
    </div>
  );
}

/** Nothing here yet: one sentence, the next step, said once. */
export function EmptyState({ title, body, action, 'data-testid': testId = 'empty-state' }: {
  title: string; body?: string; action?: React.ReactNode; 'data-testid'?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} className="wk-empty">
      <p className="wk-empty-title">{title}</p>
      {body !== undefined && <p className="wk-empty-body">{body}</p>}
      {action !== undefined && <div className="wk-empty-action">{action}</div>}
    </div>
  );
}

/** Loading placeholders shaped like the content (never blank space). */
export function Skeleton({ rows = 3, variant = 'row', 'data-testid': testId = 'skeleton' }: {
  rows?: number; variant?: 'row' | 'card' | 'line'; 'data-testid'?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} aria-busy="true" aria-label="Loading" role="status" className={`wk-skeleton wk-skeleton--${variant}`}>
      {Array.from({ length: Math.max(1, rows) }, (_, i) => <span key={i} className="wk-skeleton-bar" />)}
    </div>
  );
}
