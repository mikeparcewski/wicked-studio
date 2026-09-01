import type { SessionView } from '../api/types.js';
import { calmCopy, type NeedRow } from '../board/needsYou.js';
import type { Navigate } from '../hooks/useRoute.js';
import { setRetryPrefill } from '../store/retryPrefill.js';
import { TONE_COLOR, TONE_GLYPH } from './narrator.js';
import { ago } from './ProjectCard.js';
import { humanTitle } from './runIdentity.js';

/**
 * THE NEEDS-YOU QUEUE (DES-HOME-COMMAND-CENTER §3) — the home page's spine.
 *
 * Renders the rows {@link needsYouRows} folded — severity-ordered, narrated
 * one-liners, honest ages, and ONE act-in-place verb per row:
 *   gate         → Open gate › (the run's approval dock — `…#gate`)
 *   failed run   → Retry › (Retry-as-prefill: deposits, navigates, POSTS NOTHING)
 *   repo graph   → Re-index › (the same prefill idiom) / Open repo ›
 *   campaign     → Open campaign ›
 *   stalled chat → Open chat ›
 *
 * THE CONTRADICTION GUARD IS STRUCTURAL: this component receives the fold's
 * rows and branches on `rows.length === 0` — the calm copy derives from the
 * SAME fold that counts failures and gates, so a queue with rows can never
 * render calm (pinned by HomeBoard.queue.test.tsx).
 */

const CSS = {
  row: {
    display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0,
    padding: '7px 10px',
    borderBottom: '1px solid var(--surface-raised)',
  },
  subject: {
    fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semi)', color: 'var(--ink-high)',
    textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flexShrink: 1, minWidth: '80px',
  },
  line: {
    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
  },
  age: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
    flexShrink: 0,
  },
  act: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', fontWeight: 'var(--weight-semi)',
    color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
    border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
    padding: '2px 8px', background: 'none', cursor: 'pointer', font: 'inherit',
  },
} as const satisfies Record<string, React.CSSProperties>;

export function NeedsYouQueue({ rows, runs, navigate, now }: {
  rows: NeedRow[];
  /** For the calm line's live working count — `calmCopy` reads `runStats`. */
  runs: SessionView[];
  navigate: Navigate;
  now?: number;
}): React.ReactElement {
  const at = now ?? Date.now();
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  /** The act verb: prefills DEPOSIT and navigate — nothing is ever posted here. */
  const act = (row: NeedRow): React.ReactElement => {
    const a = row.action;
    if (a.kind === 'open') {
      return (
        <a {...link(a.path)} data-testid="need-act" data-act="open" style={CSS.act}>
          {a.label}
        </a>
      );
    }
    const onClick = (): void => {
      setRetryPrefill(a.prefill);
      navigate('/runs/new');
    };
    return (
      <button
        type="button"
        data-testid="need-act"
        data-act={a.kind}
        onClick={onClick}
        style={CSS.act}
      >
        {a.label}
      </button>
    );
  };

  return (
    <section
      data-testid="needs-you-queue"
      data-count={rows.length}
      style={{
        flex: '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}
    >
      <p
        style={{
          margin: 0, padding: '8px 10px 6px',
          fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: rows.length > 0 ? 'var(--status-gate)' : 'var(--ink-dim)',
        }}
      >
        Needs you{rows.length > 0 ? ` (${rows.length})` : ''}
      </p>
      {rows.length === 0 ? (
        // The ONLY calm copy on the page — same fold, one branch (§3).
        <p
          data-testid="home-calm"
          style={{
            margin: 0, padding: '4px 10px 12px',
            fontSize: 'var(--text-sm)', color: 'var(--ink-muted)',
          }}
        >
          {calmCopy(runs)}
        </p>
      ) : (
        <div style={{ overflowY: 'auto', minHeight: 0 }}>
          {rows.map((row) => (
            <div
              key={row.key}
              data-testid="need-row"
              data-kind={row.kind}
              data-key={row.key}
              style={CSS.row}
            >
              <span aria-hidden style={{ color: TONE_COLOR[row.tone], flexShrink: 0, fontSize: 'var(--text-xs)' }}>
                {TONE_GLYPH[row.tone]}
              </span>
              <a {...link(row.subjectPath)} title={row.subject} style={CSS.subject}>
                {humanTitle(row.subject)}
              </a>
              <span data-testid="need-line" title={row.text} style={{ ...CSS.line, color: TONE_COLOR[row.tone] }}>
                {row.text}
              </span>
              <span data-testid="need-age" style={CSS.age}>
                {row.at !== null ? ago(row.at, at) : 'age unknown'}
              </span>
              {act(row)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
