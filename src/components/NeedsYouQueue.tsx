import type { SessionView } from '../api/types.js';
import { calmCopy, type NeedRow } from '../board/needsYou.js';
import { memberPage, visibleMembers } from '../board/needsQueue.js';
import { acceptMemoryPreview } from '../board/proposalTriage.js';
import { useNeedsQueue, type NeedsQueue } from '../hooks/useNeedsQueue.js';
import type { Navigate } from '../hooks/useRoute.js';
import type { SkinVariants } from '../theming/skins.js';
import { TONE_COLOR, TONE_GLYPH } from './narrator.js';
import { AgeStamp } from './AgeStamp.js';
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
 *   proposal     → Review ›  (a proposal GROUP also carries "Accept N memory-only ›" — Wave B, idea 4)
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

  /** A group's batch move (idea 3): its consequence is the row's line; progress replaces the verb. */
  const batchAct = (a: Extract<NeedRow['action'], { kind: 'batch-onboard' }>, consequence: string): React.ReactElement => {
    const b = queue.batch;
    const label = b.phase === 'running'
      ? `Launching ${b.done}/${b.total}…`
      : b.phase === 'done'
        ? `Launched ${b.launched}${b.failures.length > 0 ? ` · ${b.failures.length} refused` : ''}`
        : a.label;
    return (
      <button
        type="button"
        data-testid="need-batch-act"
        data-batch-phase={b.phase}
        disabled={b.phase !== 'idle'}
        title={b.phase === 'done' && b.failures.length > 0
          ? b.failures.map((f) => `${f.id}: ${f.error}`).join('\n')
          : b.phase === 'idle' ? `${consequence} — one run per repo, each builds that repo's code graph` : undefined}
        onClick={() => queue.act(a)}
        style={{ ...CSS.act, ...(b.phase !== 'idle' ? { cursor: 'default', color: 'var(--ink-muted)' } : {}) }}
      >
        {label}
      </button>
    );
  };

  /** The proposal group's "Accept N memory-only" (idea 4): opens a preview; while queued it is the Undo. */
  const acceptAct = (a: Extract<NeedRow['action'], { kind: 'accept-memory' }>): React.ReactElement => {
    const s = queue.accept.state;
    const label = s.phase === 'queued'
      ? `Undo accepting ${s.count}`
      : s.phase === 'sending'
        ? `Accepting ${s.done}/${s.total}…`
        : a.label;
    return (
      <button
        type="button"
        data-testid="need-accept-act"
        data-accept-phase={s.phase}
        disabled={s.phase === 'sending'}
        title={s.phase === 'idle' ? 'Preview exactly which memory proposals would be accepted' : undefined}
        onClick={() => (s.phase === 'queued' ? queue.accept.undo() : queue.act(a))}
        style={{ ...CSS.act, ...(s.phase === 'sending' ? { cursor: 'default', color: 'var(--ink-muted)' } : {}) }}
      >
        {label}
      </button>
    );
  };

  /** The preview under the proposal group: exactly what the accept will send, and what stays. */
  const acceptPreview = (): React.ReactElement | null => {
    const s = queue.accept.state;
    if (s.phase !== 'preview') return null;
    return (
      <div
        data-testid="need-accept-preview"
        data-count={s.items.length}
        style={{ ...CSS.row, flexDirection: 'column', alignItems: 'stretch', gap: '4px', paddingLeft: '27px' }}
      >
        <span style={{ ...CSS.line, whiteSpace: 'normal', color: 'var(--ink-body)' }}>
          {acceptMemoryPreview(s.items.length, s.staying)}
        </span>
        <ul style={{ margin: 0, paddingLeft: '16px', maxHeight: '120px', overflowY: 'auto' }}>
          {s.items.map((i) => (
            <li key={i.id} data-testid="need-accept-item" data-id={i.id} style={{ ...CSS.line, display: 'list-item' }}>
              {i.subject}
            </li>
          ))}
        </ul>
        <span style={{ display: 'flex', gap: '6px' }}>
          <button type="button" data-testid="need-accept-confirm" onClick={queue.accept.confirm} style={CSS.act}>
            {`Accept these ${s.items.length}`}
          </button>
          <button type="button" data-testid="need-accept-cancel" onClick={queue.accept.cancel} style={{ ...CSS.act, color: 'var(--ink-muted)' }}>
            Cancel
          </button>
        </span>
      </div>
    );
  };

  /** A paged group's pager (a proposal group shows a few members at a time). */
  const pager = (row: NeedRow): React.ReactElement | null => {
    const m = memberPage(row, queue.pages[row.key] ?? 0);
    if (m.pages <= 1) return null;
    const next = Math.min(m.items.length, m.total - m.to);
    return (
      <div data-testid="need-members-pager" data-page={m.page} style={{ ...CSS.row, paddingLeft: '27px' }}>
        <span style={{ ...CSS.age, flex: 1 }}>{`Showing ${m.from}–${m.to} of ${m.total}`}</span>
        {m.page > 0 && (
          <button type="button" data-testid="need-page-prev" onClick={() => queue.setPage(row.key, m.page - 1)} style={CSS.act}>
            ‹ Previous
          </button>
        )}
        {m.page < m.pages - 1 && (
          <button type="button" data-testid="need-page-next" onClick={() => queue.setPage(row.key, m.page + 1)} style={CSS.act}>
            {`Next ${next} ›`}
          </button>
        )}
      </div>
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
          // A group row carrying a batch move wraps its buttons under the line when the queue is
          // narrow (the rail skin), rather than pushing them out of view.
          ...(row.action.kind === 'accept-memory' || row.action.kind === 'batch-onboard' ? { flexWrap: 'wrap' as const } : {}),
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
        {/* A batch move's line IS its consequence: it wraps rather than truncate (idea 3). */}
        <span data-testid="need-line" title={row.text} style={{
          ...CSS.line, color: TONE_COLOR[row.tone],
          ...(row.action.kind === 'batch-onboard' || row.action.kind === 'accept-memory' ? { whiteSpace: 'normal' } : {}),
        }}>
          {row.text}
        </span>
        {/* Idea 14: an absent or impossible clock is a pill that says so and opens the record. */}
        <AgeStamp
          at={row.at}
          now={at}
          testId="need-age"
          style={CSS.age}
          {...(isGroup ? {} : { href: row.subjectPath, onOpen: navigate })}
        />
        {isGroup && row.action.kind === 'batch-onboard' && batchAct(row.action, row.text)}
        {isGroup && row.action.kind === 'accept-memory' && acceptAct(row.action)}
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
              {row.action.kind === 'accept-memory' && acceptPreview()}
              {row.members !== undefined && queue.expanded.has(row.key) && (
                <div data-testid="need-members" data-group={row.key}>
                  {visibleMembers(row, queue.pages[row.key] ?? 0).map((m) => line(m, 'need-member'))}
                  {pager(row)}
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
