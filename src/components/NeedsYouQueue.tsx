import type { SessionView } from '../api/types.js';
import { calmCopy, type NeedRow } from '../board/needsYou.js';
import { useNeedsQueue, type NeedsQueue } from '../hooks/useNeedsQueue.js';
import type { Navigate } from '../hooks/useRoute.js';
import type { SkinVariants } from '../theming/skins.js';
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
 *   campaign     → Open test › (the engine campaign, rendered in Test vocabulary — #203)
 *   stalled chat → Open chat ›
 *   elicitation  → Answer ›   steer request → Steer ›   stall escalation → Check run ›
 *   proposal     → Review ›
 *
 * Studio wave 2b: the rows, their grouping ("2 approvals", expandable), the ranking,
 * the keyboard cursor and the verbs all come from `useNeedsQueue` — this component only
 * renders them. Keys: focus the queue (Tab or click), then j/k walk it and Enter acts.
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

export function NeedsYouQueue({ queue, runs, navigate, now, variant = 'inline' }: {
  /** The queue's behaviour (`useNeedsQueue`): rows, groups, cursor, verbs. */
  queue: NeedsQueue;
  /** For the calm line's live working count — `calmCopy` reads `runStats`. */
  runs: SessionView[];
  navigate: Navigate;
  now?: number;
  /** The skin's variant (theming/skins.ts): a column of the command center, or the
   *  full height of the shell's right rail. Same rows, same verbs either way. */
  variant?: SkinVariants['needsQueue'];
}): React.ReactElement {
  const at = now ?? Date.now();
  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  /** The act verb — the hook does it (prefills DEPOSIT and navigate; nothing is posted). */
  const act = (row: NeedRow): React.ReactElement => {
    const a = row.action;
    if (a.kind === 'open') {
      return (
        <a
          href={a.path}
          onClick={(e) => { e.preventDefault(); queue.act(a); }}
          data-testid="need-act"
          data-act="open"
          style={CSS.act}
        >
          {a.label}
        </a>
      );
    }
    return (
      <button type="button" data-testid="need-act" data-act={a.kind} onClick={() => queue.act(a)} style={CSS.act}>
        {a.label}
      </button>
    );
  };

  const line = (row: NeedRow, testId: 'need-row' | 'need-member'): React.ReactElement => {
    const selected = queue.selectedKey === row.key;
    const isGroup = row.members !== undefined;
    const open = isGroup && queue.expanded.has(row.key);
    return (
      <div
        key={row.key}
        data-testid={testId}
        data-kind={row.kind}
        data-key={row.key}
        data-count={row.members?.length ?? 1}
        data-queue-item={row.key}
        data-kbd-selected={selected ? 'true' : undefined}
        tabIndex={-1}
        // Severity stripe (command-deck redesign): a glowing left edge colored by the row's
        // tone, so what needs you reads by color at a glance (gate/failed/stranded/…).
        style={{
          ...CSS.row,
          borderLeft: `3px solid ${TONE_COLOR[row.tone]}`,
          paddingLeft: testId === 'need-member' ? '27px' : '9px',
          boxShadow: `inset 4px 0 10px -6px ${TONE_COLOR[row.tone]}`,
          outline: selected ? '1px solid var(--accent)' : 'none',
          outlineOffset: '-1px',
          background: selected ? 'var(--surface-raised)' : undefined,
        }}
      >
        <span aria-hidden style={{ color: TONE_COLOR[row.tone], flexShrink: 0, fontSize: 'var(--text-xs)' }}>
          {TONE_GLYPH[row.tone]}
        </span>
        {isGroup ? (
          <span title={row.subject} style={CSS.subject}>{row.subject}</span>
        ) : (
          <a {...link(row.subjectPath)} title={row.subject} style={CSS.subject}>
            {humanTitle(row.subject)}
          </a>
        )}
        <span data-testid="need-line" title={row.text} style={{ ...CSS.line, color: TONE_COLOR[row.tone] }}>
          {row.text}
        </span>
        <span data-testid="need-age" style={CSS.age}>
          {row.at !== null ? ago(row.at, at) : 'age unknown'}
        </span>
        {isGroup ? (
          <button
            type="button"
            data-testid="need-group-toggle"
            aria-expanded={open}
            onClick={() => queue.toggle(row.key)}
            style={CSS.act}
          >
            {open ? 'Collapse ▴' : 'Expand ▾'}
          </button>
        ) : (
          act(row)
        )}
      </div>
    );
  };

  return (
    <section
      ref={queue.rootRef}
      tabIndex={0}
      aria-label="Needs you — focus, then j/k to move and Enter to act"
      data-testid="needs-you-queue"
      data-count={queue.count}
      data-skin-variant={variant}
      style={{
        flex: variant === 'rail' ? '1 1 auto' : '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', outline: 'none',
      }}
    >
      <p
        style={{
          margin: 0, padding: '8px 10px 6px',
          fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: queue.count > 0 ? 'var(--status-gate)' : 'var(--ink-dim)',
        }}
      >
        Needs you{queue.count > 0 ? ` (${queue.count})` : ''}
      </p>
      {queue.rows.length === 0 ? (
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
          {queue.rows.map((row) => (
            <div key={row.key} role="group">
              {line(row, 'need-row')}
              {row.members !== undefined && queue.expanded.has(row.key) && (
                <div data-testid="need-members" data-group={row.key}>
                  {row.members.map((m) => line(m, 'need-member'))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The queue as a mountable surface: the behaviour hook (`useNeedsQueue` — grouping, cursor,
 * verbs) over the app-level fold's rows (`useNeedsRows`), rendered by {@link NeedsYouQueue}.
 * Home mounts it inline; the shell's right rail mounts it on every route. Exactly one is
 * mounted at a time (Home stands down while the rail holds the queue), so the queue's keys are
 * registered once.
 */
export function NeedsQueueSurface({ rows, runs, navigate, now, variant = 'inline' }: {
  /** The ranked rows — `useNeedsRows`, the one fold. */
  rows: NeedRow[];
  runs: SessionView[];
  navigate: Navigate;
  now: number;
  variant?: SkinVariants['needsQueue'];
}): React.ReactElement {
  const queue = useNeedsQueue(rows, navigate, now);
  return <NeedsYouQueue queue={queue} runs={runs} navigate={navigate} now={now} variant={variant} />;
}
