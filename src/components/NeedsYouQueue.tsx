import { useEffect, useRef, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { calmCopy, type NeedRow } from '../board/needsYou.js';
import { focusLockNote, memberPage, visibleMembers } from '../board/needsQueue.js';
import { acceptMemoryPreview } from '../board/proposalTriage.js';
import { useNeedsQueue, type NeedsQueue } from '../hooks/useNeedsQueue.js';
import { useFocusLockStore } from '../store/focusLock.js';
import { REVEAL_FRESH_MS, REVEAL_MS, useQueueReveal } from '../store/queueReveal.js';
import type { Navigate } from '../hooks/useRoute.js';
import type { SkinVariants } from '../theming/skins.js';
import { TONE_COLOR, TONE_GLYPH } from './narrator.js';
import { AgeStamp } from './AgeStamp.js';
import { QuestionRow } from './desk/QuestionRow.js';
import { needRunId } from '../board/deskModel.js';
import { plainRunTitle } from '../board/deskWords.js';
import { Tech } from './Tech.js';
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
 * renders them. Keys: focus the queue (Tab or click), then ⌥J/⌥K (or ↓/↑) walk it and Enter acts.
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
    borderBottom: '1px solid var(--border-subtle)',
  },
  // The queue scans as a table (design council M12): a bold title column, a dimmer sans
  // rationale, the age in a fixed right-aligned tabular cell.
  subject: {
    fontSize: 'var(--text-xs)', fontWeight: 650, color: 'var(--ink-high)',
    textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flexShrink: 1, minWidth: '80px',
  },
  line: {
    fontSize: 'var(--text-xs)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
  },
  age: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-dim)',
    flexShrink: 0, minWidth: '3.5em', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
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
  const sectionEl = useRef<HTMLElement | null>(null);
  const revealed = useRevealed(queue, sectionEl);
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
          onClick={(e) => { e.preventDefault(); queue.act(a, row.key); }}
          data-testid="need-act"
          data-act="open"
          className="wk-need-act"
        >
          {a.label}
        </a>
      );
    }
    return (
      <button type="button" data-testid="need-act" data-act={a.kind} onClick={() => queue.act(a, row.key)} className="wk-need-act">
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
        className="wk-need-act"
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
        className="wk-need-act"
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
          <button type="button" data-testid="need-accept-confirm" onClick={queue.accept.confirm} className="wk-need-act">
            {`Accept these ${s.items.length}`}
          </button>
          <button type="button" data-testid="need-accept-cancel" onClick={queue.accept.cancel} className="wk-need-act" style={{ color: 'var(--ink-muted)' }}>
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
          <button type="button" data-testid="need-page-prev" onClick={() => queue.setPage(row.key, m.page - 1)} className="wk-need-act">
            ‹ Previous
          </button>
        )}
        {m.page < m.pages - 1 && (
          <button type="button" data-testid="need-page-next" onClick={() => queue.setPage(row.key, m.page + 1)} className="wk-need-act">
            {`Next ${next} ›`}
          </button>
        )}
      </div>
    );
  };

  /** The Desk's row (skin `desk`, S4): a plain card — the subject in words, one line under it
   *  ("project · what · age"), and ONE plain action on the right. Same keys, verbs and testids. */
  const deskLine = (row: NeedRow, testId: 'need-row' | 'need-member'): React.ReactElement => {
    const selected = queue.selectedKey === row.key;
    const isGroup = row.members !== undefined;
    const open = isGroup && queue.expanded.has(row.key);
    const waiting = row.tone === 'gate' || row.tone === 'human';
    // The one yellow dot (DESIGN-simple §1a): the most urgent row, the list's first.
    const urgent = testId === 'need-row' && queue.rows[0]?.key === row.key;
    const dot = urgent ? ' wk-desk-dot--urgent' : waiting ? ' wk-desk-dot--waiting' : '';
    return (
      <div
        key={row.key}
        data-testid={testId}
        data-kind={row.kind}
        data-key={row.key}
        data-count={row.members?.length ?? 1}
        data-queue-item={row.key}
        data-kbd-selected={selected ? 'true' : undefined}
        data-reveal={revealed.has(row.key) ? 'true' : undefined}
        tabIndex={-1}
        className={`wk-desk-need wk-desk-need--wrap${testId === 'need-member' ? ' wk-desk-need--member' : ''}${selected ? ' wk-desk-need--selected' : ''}${revealed.has(row.key) ? ' wk-need-row--reveal' : ''}`}
      >
        <span aria-hidden data-urgent={urgent ? 'true' : undefined} className={`wk-desk-dot${dot}`} style={urgent || waiting ? undefined : { background: TONE_COLOR[row.tone] }} />
        <span className="wk-desk-need-body">
          {isGroup ? (
            <span title={row.subject} className="wk-desk-need-title">{row.subject}</span>
          ) : (
            <a {...link(row.subjectPath)} title={row.subject} className="wk-desk-need-title">{plainRunTitle(row.subject)}</a>
          )}
          <span className="wk-desk-need-line">
            {/* studio#422: the question in plain words; the engine's prompt is underneath. */}
            <span data-testid="need-line" title={row.question ?? row.text}>{row.question ?? row.text}</span>
            <span aria-hidden> · </span>
            <AgeStamp at={row.at} now={at} testId="need-age" {...(isGroup ? {} : { href: row.subjectPath, onOpen: navigate })} />
          </span>
          {row.question !== undefined && row.question !== row.text && (
            <Tech data-testid="tech-need-prompt" parts={[row.text]} block />
          )}
        </span>
        {isGroup && row.action.kind === 'batch-onboard' && batchAct(row.action, row.text)}
        {isGroup && row.action.kind === 'accept-memory' && acceptAct(row.action)}
        {isGroup ? (
          <button type="button" data-testid="need-group-toggle" aria-expanded={open} onClick={() => queue.toggle(row.key)} className="wk-need-act">
            {open ? 'Fold' : 'Show each'}
          </button>
        ) : row.kind === 'gate' && row.action.kind === 'open' ? (
          // S5: a gate is answered in its row (deliver, retry and escalation gates open their card).
          deskGate(row, row.action)
        ) : (
          act(row)
        )}
      </div>
    );
  };

  const deskGate = (row: NeedRow, a: Extract<NeedRow['action'], { kind: 'open' }>): React.ReactElement => {
    const runId = needRunId(row) ?? '';
    const units = runs.find((v) => v.session.id === runId)?.units ?? [];
    return (
      <QuestionRow
        runId={runId}
        units={units}
        openPath={a.path}
        openLabel={a.label}
        onOpen={(e) => { e.preventDefault(); queue.act(a, row.key); }}
      />
    );
  };

  const line = (row: NeedRow, testId: 'need-row' | 'need-member'): React.ReactElement => {
    if (variant === 'desk') return deskLine(row, testId);
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
        data-reveal={revealed.has(row.key) ? 'true' : undefined}
        tabIndex={-1}
        className={`wk-need-row wk-need-row--${row.tone}${revealed.has(row.key) ? ' wk-need-row--reveal' : ''}`}
        // Severity stripe (command-deck redesign): a left edge colored by the row's tone, so what
        // needs you reads by color at a glance (gate/failed/stranded/…); the glyph repeats it.
        style={{
          ...CSS.row,
          borderLeft: `2px solid ${TONE_COLOR[row.tone]}`,
          paddingLeft: testId === 'need-member' ? '28px' : '10px',
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
        <span data-testid="need-line" className="wk-need-line" title={row.text} style={{
          ...CSS.line,
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
            className="wk-need-act"
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
      ref={(el) => { sectionEl.current = el; queue.rootRef(el); }}
      tabIndex={0}
      aria-label="Needs you — focus, then arrow keys or Alt+J/Alt+K to move and Enter to act"
      data-testid="needs-you-queue"
      data-count={queue.count}
      data-focus-lock={queue.focus.on ? 'on' : 'off'}
      data-skin-variant={variant}
      className={variant === 'desk' ? 'wk-desk-needs' : undefined}
      style={variant === 'desk' ? undefined : {
        flex: variant === 'rail' ? '1 1 auto' : '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', outline: 'none',
      }}
    >
      {variant === 'desk' ? (
        <p className="wk-desk-label">Needs you <span className="wk-desk-label-aside">most urgent first</span></p>
      ) : <p
        style={{
          margin: 0, padding: '8px 10px 6px',
          fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: queue.count > 0 ? 'var(--status-gate)' : 'var(--ink-dim)',
        }}
      >
        Needs you{queue.count > 0 ? ` (${queue.count})` : ''}
      </p>}
      {/* Just the top one (idea 10): the rest are hidden, never dropped — they come back when the
          held item clears, or at once with "Show all". */}
      {queue.focus.on && (
        <p
          data-testid="need-focus-note"
          data-hidden={queue.focus.hidden}
          style={{ ...CSS.row, margin: 0, borderBottom: 'none', paddingTop: 0, color: 'var(--ink-muted)', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)' }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{focusLockNote(queue.focus.hidden)}</span>
          <button
            type="button"
            data-testid="need-focus-show-all"
            onClick={() => useFocusLockStore.getState().setOn(false)}
            className="wk-need-act"
          >
            Show all
          </button>
        </p>
      )}
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
        <div style={variant === 'desk' ? undefined : { overflowY: 'auto', minHeight: 0 }}>
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
 * Answers a reveal request (the handover's "decisions due" / "broke" chips): opens any folded
 * group holding a requested row, marks the requested rows for a brief highlight, and scrolls the
 * first one into view. Returns the keys highlighted right now.
 */
function useRevealed(queue: NeedsQueue, rootEl: React.RefObject<HTMLElement | null>): ReadonlySet<string> {
  const nonce = useQueueReveal((s) => s.nonce);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    const { keys, at } = useQueueReveal.getState();
    if (nonce === 0 || keys.length === 0 || Date.now() - at > REVEAL_FRESH_MS) return;
    const want = new Set(keys);
    const q = queueRef.current;
    for (const row of q.rows) {
      if (row.members?.some((m) => want.has(m.key)) === true && !q.expanded.has(row.key)) q.toggle(row.key);
    }
    setRevealed(want);
    const t = setTimeout(() => setRevealed(new Set()), REVEAL_MS);
    return () => clearTimeout(t);
  }, [nonce]);

  // After the rows (and any group just opened) render: bring the first revealed row into view.
  useEffect(() => {
    if (revealed.size === 0) return;
    const root = rootEl.current;
    const first = root?.querySelector<HTMLElement>('[data-reveal="true"]');
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    first?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [revealed, rootEl]);

  return revealed;
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

/**
 * Just the top one (Wave C, idea 10) — Home's header toggle for the focus lock. While on, the
 * queue (inline or in the rail) shows only the highest-consequence item and says how many are
 * hidden; the rest come back when that item clears or the toggle goes off. Drawn only when there
 * is something to hide (two or more items), or while the lock is on.
 */
export function FocusLockToggle({ items }: { items: number }): React.ReactElement | null {
  const on = useFocusLockStore((s) => s.on);
  if (!on && items < 2) return null;
  return (
    <button
      type="button"
      data-testid="home-focus-toggle"
      aria-pressed={on}
      title={on
        ? 'Show every Needs You item again'
        : 'Hide every Needs You item except the highest-consequence one; the rest come back when it clears'}
      onClick={() => useFocusLockStore.getState().setOn(!on)}
      style={{
        fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', flexShrink: 0, cursor: 'pointer',
        padding: '2px 8px', borderRadius: 'var(--radius-md)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--surface-raised)'}`,
        background: on ? 'var(--surface-raised)' : 'none',
        color: on ? 'var(--ink-high)' : 'var(--ink-muted)',
      }}
    >
      {on ? '◉ Just the top one' : '○ Just the top one'}
    </button>
  );
}
