import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { QeSettingOffer } from './QeRefusalWarning.js';
import {
  CLOSE_NOTE,
  type DecisionResult,
  type PendingDecision,
  dismissResult,
  focusHostFor,
  holdResult,
  markResultShown,
  ownerOf,
  registerUndoHost,
  releaseResult,
  undoAnnouncement,
  undoDecision,
  undoHeadline,
  useUndoQueue,
  waitingLine,
} from '../board/undoQueue.js';

/**
 * The 10 s Undo, in the block where the action was taken (studio 0.16.4: the floating toast is gone).
 * A skin over `board/undoQueue.ts`, which owns every timer and every word.
 *
 * A block renders this ALWAYS (empty when nothing is queued), so it is registered as a host for its
 * `keys` while it is on screen. Of every block on the page showing the same decision, ONE shows it in
 * full — countdown, what will happen, the page-close note, Undo — and the rest show a quiet
 * "Waiting to send" line. Results (sent / not sent / failed, with the QE settings offer) land on the
 * same block; a failure stays until it is dismissed.
 *
 * Accessibility: one polite live region per block carries a STATIC sentence per decision or result
 * (announced once, never on the 1 s tick). The visible countdown is outside any live region. Undo and
 * Dismiss are buttons; when the block collapses under focus, focus moves to the hosting block's first
 * action, else to this block's wrapper — never to the page body.
 */

const RESULT_COLOR = { sent: 'var(--status-run)', failed: 'var(--status-fail)', 'not-sent': 'var(--status-gate)' } as const;
/** The quiet line on every other block showing a failure that one block on the page shows in full. */
export const QUIET_FAILED = 'Couldn’t send — the details are where you answered it.';
const tone = (p: PendingDecision): 'approve' | 'reject' => (p.verb === 'approve' || p.verb === 'edit-plan' ? 'approve' : 'reject');

export function InlineUndo({ host, keys, className, over = false, fallback = false, ownFailure = false, renderFailed }: {
  /** The kind of block hosting it (`gate-card`, `proposal-card`, `desk-row`, `batch-bar`, …). The hosting
   *  block's root carries the same `data-undo-host`, so a decision taken in it is shown here. */
  host: string;
  /** What this block shows decisions for (`gate:<run>`, `stop:<run>`, `batch`, …). */
  keys: readonly string[];
  className?: string;
  /** The block sits over the page (voice full screen): while mounted it shows what it hosts in full. */
  over?: boolean;
  /** Shows what it hosts only when no other block for it is on screen (where a gate's row or card WAS). */
  fallback?: boolean;
  /** The block already says a failed send in its own words, beside its retry (the gate card's error line, the
   *  proposal card's "Didn't work", the Desk card's failure): a failed result it owns is seen there, so it is not
   *  said twice — it is taken off the queue as soon as this block shows it. */
  ownFailure?: boolean;
  /** How this block says a failed result it owns, when it has more to say than one line (a batch: which members, why,
   *  Retry / Open). Null falls back to the line. */
  renderFailed?: (r: DecisionResult) => React.ReactNode | null;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [hostId, setHostId] = useState<number | null>(null);
  const keyList = keys.join('\u0000');
  useLayoutEffect(() => {
    if (ref.current === null) return;
    const el = ref.current;
    const list = keyList === '' ? [] : keyList.split('\u0000');
    const reg = registerUndoHost(host, list, el, { over, fallback });
    setHostId(reg.id);
    return () => {
      // Leaving with focus inside (its row or card went): focus goes to the block that shows it now, never the body.
      const focused = el.contains(document.activeElement);
      reg.unregister();
      if (focused) setTimeout(() => { if (document.activeElement === document.body || document.activeElement === null) focusHostFor(list); }, 0);
    };
  }, [host, keyList, over, fallback]);

  const mine = (item: { keys: readonly string[] }): boolean => item.keys.some((k) => keys.includes(k));
  const pending = useUndoQueue((s) => s.pending);
  const results = useUndoQueue((s) => s.results);
  useUndoQueue((s) => s.hostsRev); // re-decide ownership when a block mounts or leaves
  const ownPending = pending.filter(mine);
  const full = hostId === null ? [] : ownPending.filter((p) => ownerOf(p) === hostId);
  // A fallback block says nothing about what another block shows (it is only where a row WAS).
  const quiet = hostId === null || fallback ? [] : ownPending.filter((p) => ownerOf(p) !== hostId);
  const owned: DecisionResult[] = hostId === null ? [] : results.filter((r) => mine(r) && ownerOf(r) === hostId);
  // A failure this block states itself is one about exactly its own run (one run key, one it hosts) — never a batch
  // summary over several runs, which stays here with Dismiss.
  const statedByHost = (r: DecisionResult): boolean => {
    if (!ownFailure || r.kind !== 'failed') return false;
    const runs = r.keys.filter((k) => k.includes(':'));
    return runs.length === 1 && keys.includes(runs[0]!);
  };
  const shown = owned.filter((r) => !statedByHost(r));
  // One full result per page, as for the countdown: another block showing the same failure only says where it is.
  const quietFailed = hostId === null || fallback ? [] : results.filter((r) => mine(r) && r.kind === 'failed' && ownerOf(r) !== null && ownerOf(r) !== hostId);
  const saidByHost = owned.filter(statedByHost).map((r) => r.id).join(',');
  useEffect(() => {
    if (saidByHost === '') return;
    for (const id of saidByHost.split(',')) dismissResult(Number(id));
  }, [saidByHost]);

  // When this block first showed each decision: its drain bar starts where the window already is (a block that takes
  // over late does not draw a fresh 10 s).
  const firstSeen = useRef(new Map<number, number>());
  const seenAt = (p: PendingDecision): number => {
    let at = firstSeen.current.get(p.id);
    if (at === undefined) { at = Date.now(); firstSeen.current.set(p.id, at); }
    return at;
  };
  // A decision this block no longer shows in full forgets when it did: shown again later, its bar starts from there.
  for (const id of [...firstSeen.current.keys()]) if (!full.some((p) => p.id === id)) firstSeen.current.delete(id);

  const [now, setNow] = useState(() => Date.now());
  const ticking = ownPending.length > 0;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [ticking]);

  const shownIds = shown.map((r) => r.id).join(',');
  useEffect(() => {
    for (const r of shown) markResultShown(r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownIds]);

  // Focus never falls to the page body when this block collapses under it.
  const hadFocus = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || !hadFocus.current) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    hadFocus.current = false;
    const block = el.closest<HTMLElement>('[data-undo-host]');
    const action = [...(block?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled])') ?? [])]
      .find((x) => !el.contains(x)) ?? null;
    // The host's first action, else this block (when it still shows something), else the host block itself, else
    // whichever block shows this decision now (the one here was hidden: the reading pane folded away on a phone).
    for (const target of [action, el, block]) {
      target?.focus({ preventScroll: true });
      if (target !== null && target !== undefined && document.activeElement === target) return;
    }
    focusHostFor(keys);
  });

  // The live region's sentence: the newest decision or result this block shows in full, worded without seconds.
  const latest = [
    ...full.map((p) => ({ at: p.queuedAt, text: undoAnnouncement(p) })),
    ...shown.map((r) => ({ at: r.at, text: r.text })),
  ].sort((a, b) => a.at - b.at).at(-1)?.text ?? '';

  const empty = full.length === 0 && quiet.length === 0 && shown.length === 0 && quietFailed.length === 0;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="inline-undo-host"
      data-undo-for={host}
      data-undo-keys={keys.join(' ')}
      data-undo-fallback={fallback ? 'true' : undefined}
      data-empty={empty ? 'true' : 'false'}
      className={`wk-inline-undo-wrap${className !== undefined ? ` ${className}` : ''}`}
      onFocus={() => { hadFocus.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget !== null) hadFocus.current = false; }}
    >
      <p className="wk-visually-hidden" role="status" aria-live="polite" data-testid="inline-undo-live">{latest}</p>
      {full.map((p) => (
        // aria-live off: the ticking countdown is never announced by a live region the host sits in (the inbox's
        // reading pane, the voice transcript); this block's own region above says it once.
        <div key={p.id} data-testid="inline-undo" data-undo-id={p.id} data-verb={p.verb} aria-live="off"
          className={`wk-inline-undo wk-inline-undo--${tone(p)}`}
          style={{ ['--undo-delay' as string]: `-${Math.max(0, seenAt(p) - p.queuedAt)}ms` }}>
          <div className="wk-inline-undo-body">
            <p data-testid="inline-undo-headline" className="wk-inline-undo-headline">{undoHeadline(p, Math.min(now, p.dueAt))}</p>
            <p data-testid="inline-undo-preview" className="wk-inline-undo-preview">{p.preview}</p>
            <p data-testid="inline-undo-close-note" className="wk-inline-undo-close">{p.closeNote ?? CLOSE_NOTE}</p>
          </div>
          <button
            type="button"
            data-testid="inline-undo-button"
            onClick={() => { hadFocus.current = true; undoDecision(p.id); }}
            className="wk-btn wk-btn--secondary wk-btn--sm wk-inline-undo-button"
          >
            Undo
          </button>
        </div>
      ))}
      {quiet.map((p) => (
        <p key={p.id} data-testid="inline-undo-quiet" aria-live="off" className="wk-inline-undo-quiet">{waitingLine(p, Math.min(now, p.dueAt))}</p>
      ))}
      {quietFailed.map((r) => (
        <p key={`q${r.id}`} data-testid="inline-undo-result-quiet" aria-live="off" className="wk-inline-undo-quiet">
          {QUIET_FAILED}
        </p>
      ))}
      {shown.map((r) => (
        <div
          key={`r${r.id}`}
          data-testid="inline-undo-result"
          data-kind={r.kind}
          aria-live="off"
          className={`wk-inline-undo-result wk-inline-undo-result--${r.kind}`}
          style={{ color: RESULT_COLOR[r.kind] }}
          onFocus={() => holdResult(r.id)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) releaseResult(r.id); }}
        >
          {(r.kind === 'failed' ? renderFailed?.(r) : null) ?? <span>{r.text}</span>}
          {r.qe === true && <>{' '}<QeSettingOffer refusalKey={`inline:${r.id}`} refreshOnFocus={false} testId="inline-undo-result-qe" /></>}
          {r.kind === 'failed' && (
            <button
              type="button"
              data-testid="inline-undo-dismiss"
              onClick={() => { hadFocus.current = true; dismissResult(r.id); }}
              className="wk-btn wk-btn--quiet wk-btn--sm wk-inline-undo-dismiss"
            >
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
