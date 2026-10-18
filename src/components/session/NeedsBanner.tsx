import { useEffect, useId, useRef, useState } from 'react';
import { needsWords, type WaitingItem } from '../../board/runHeader.js';

/** How long the overview stays after the pointer leaves, so it can travel from the yellow words into the list. */
const LEAVE_MS = 200;

/**
 * "N needs you" (operator 2026-10-18): a banner directly below the run page's header, only while something here waits
 * on the operator. It is in the page's flow, so the thread reflows under it and nothing is covered. Hovering the
 * yellow words, or focusing them, shows the quick overview: each waiting item (what kind, the step, the one-line
 * question, how long it has waited) with a button that brings it into view in the thread. A click pins it open
 * (touch); Esc closes it.
 */
export function NeedsBanner({ items, onJump }: { items: readonly WaitingItem[]; onJump: (item: WaitingItem) => void }): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const listId = `${id}-overview`;
  useEffect(() => () => { if (leave.current !== null) clearTimeout(leave.current); }, []);
  // Nothing waits any more: the overview goes with the banner.
  useEffect(() => { if (items.length === 0) { setOpen(false); setPinned(false); } }, [items.length]);
  if (items.length === 0) return null;
  const show = (): void => {
    if (leave.current !== null) { clearTimeout(leave.current); leave.current = null; }
    setOpen(true);
  };
  const hideSoon = (): void => {
    if (pinned) return;
    if (leave.current !== null) clearTimeout(leave.current);
    leave.current = setTimeout(() => { leave.current = null; setOpen(false); }, LEAVE_MS);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    setPinned(false);
    if (refocus) trigger.current?.focus();
  };
  const first = items[0]!;
  return (
    <div className="wk-needs-banner-wrap wk-measure wk-measure--thread">
      <div data-testid="session-needs-banner" data-count={items.length} role="region" aria-label="Needs you" className="wk-needs-banner"
        ref={box}
        onMouseLeave={hideSoon}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); close(true); } }}
        onBlur={(e) => { if (!pinned && !box.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
        <span aria-hidden className="wk-needs-banner-icon">!</span>
        <button ref={trigger} type="button" data-testid="session-needs-trigger" aria-expanded={open} aria-controls={listId}
          className="wk-needs-trigger"
          onMouseEnter={show} onFocus={show}
          onClick={() => { if (pinned) close(false); else { setPinned(true); show(); } }}>
          <mark className="wk-desk-mark">{needsWords(items.length)}</mark>
        </button>
        <span data-testid="session-needs-first" className="wk-needs-banner-first" title={first.question}>
          {first.question}{items.length > 1 ? ` · and ${items.length - 1} more` : ''}
        </span>
        <div id={listId} data-testid="session-needs-overview" role="group" aria-label="What needs you" hidden={!open}
          className="wk-needs-overview" onMouseEnter={show}>
          <ul className="wk-needs-list">
            {items.map((it) => (
              <li key={it.key} data-testid="session-needs-item" data-run-id={it.runId} className="wk-needs-item">
                <p className="wk-needs-item-meta">
                  <b data-testid="session-needs-kind">{it.kind}</b>
                  {it.step !== null && <> · <span data-testid="session-needs-step">{it.step}</span></>}
                  {it.age !== null && <> · <span data-testid="session-needs-age">{it.age}</span></>}
                </p>
                <p data-testid="session-needs-question" className="wk-needs-item-question">{it.question}</p>
                <button type="button" data-testid="session-needs-jump" className="wk-btn wk-btn--secondary wk-btn--sm"
                  onClick={() => { close(false); onJump(it); }}>
                  Go to it
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
