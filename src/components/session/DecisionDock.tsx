import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircleQuestion } from 'lucide-react';
import { relTime } from '../../board/relTime.js';
import { GATE_HASH } from '../../board/gateActions.js';

/**
 * THE DECISION DOCK (approved mockup `ui-v2-gate` + the operator's addendum, 2026-10-27: "a decision must not look
 * like a chat bubble with buttons inside"). While a run here asks you something, the question lives OUTSIDE the
 * message stream: one elevated surface docked just above the composer, the full content column wide, with a status
 * rail (amber = waiting, red = blocking other work). It holds the eyebrow ("Your decision · Codex is waiting · 3 h"),
 * and under it the gate's own renderer, unchanged in what it can do (GateRow, the plan and hand-over cards, a run's
 * question) — portalled in, so every hook, commit path and undo window stays where it was. In the thread, at the
 * point the question was asked, only a slim marker remains; it focuses the dock.
 *
 * More than one open decision: the dock shows the first, with "1 more decision" to step through them. Without a dock
 * (a run block rendered alone, the inbox's reading pane) every renderer draws in place, as before.
 */

export interface DockItem {
  /** The run (or chat) id the decision belongs to: one open decision per id. */
  key: string;
  /** The helper the decision holds ("Codex"), or null when crew itself asks. */
  who: string | null;
  /** When it was asked (unix ms), or null. */
  since: number | null;
  /** The plain-words question: the collapsed phone sheet's headline. */
  question: string;
  /** Red when the item blocks other work too. */
  tone: 'waiting' | 'blocking';
}

/** The docked decision's note choice, for the reply box: its label ("Send back") and the send (its undo window). */
export interface DockReply { label: string; send: (text: string) => void }

interface DockCtx {
  /** The docked renderer offers its note choice to the reply box (null withdraws it). */
  setReply: (key: string, reply: DockReply | null) => void;
  /** The node the active decision is portalled into (null until the dock mounts). */
  slot: HTMLElement | null;
  /** The decision shown in the dock now. */
  activeKey: string | null;
  /** Bring the dock into view and focus it (the thread's marker, `#gate`). */
  focus: (key?: string) => void;
}

const Ctx = createContext<DockCtx | null>(null);

/** The dock's renderer seam: a decision for `key` that is `open` draws in the dock (`'dock'`), as a marker in the
 *  thread because another decision has the dock (`'marker'`), or in place when there is no dock (`'inline'`). */
export function useDockPlacement(key: string, open: boolean): { place: 'dock' | 'marker' | 'inline'; slot: HTMLElement | null; focus: () => void } {
  const ctx = useContext(Ctx);
  const focus = useCallback(() => ctx?.focus(key), [ctx, key]);
  if (ctx === null || !open) return { place: 'inline', slot: null, focus };
  if (ctx.activeKey === key && ctx.slot !== null) return { place: 'dock', slot: ctx.slot, focus };
  return { place: 'marker', slot: null, focus };
}

/**
 * A decision's renderer, placed: in the dock (portalled), else in place. In the thread the dock leaves the marker
 * (`marker`), which the caller draws where the question was asked.
 */
export function Docked({ dockKey, open, marker, dock, children }: {
  dockKey: string; open: boolean; marker: React.ReactNode;
  /** What the dock holds, when it differs from the in-place render (the renderer without its message bubble). */
  dock?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const { place, slot } = useDockPlacement(dockKey, open);
  if (place === 'inline') return <>{children}</>;
  if (place === 'dock' && slot !== null) return <>{marker}{createPortal(dock ?? children, slot)}</>;
  return <>{marker}</>;
}

/** The thread's one-line marker where the question was asked: "Codex asked for a decision · 3 h ago". Focuses the dock. */
export function DecisionMarker({ dockKey, who, since, now = Date.now() }: { dockKey: string; who: string | null; since: number | null; now?: number }): React.ReactElement {
  const { focus } = useDockPlacement(dockKey, true);
  return (
    <button type="button" data-testid="decision-marker" data-key={dockKey} onClick={focus} className="wk-dmark">
      <MessageCircleQuestion size={15} aria-hidden className="wk-dmark-icon" />
      <span className="wk-dmark-words">{who ?? 'The job'} asked for a decision{since !== null ? ` · ${relTime(since, now)}` : ''}</span>
      <span aria-hidden className="wk-dmark-go">Go to it ↓</span>
    </button>
  );
}

/** How long a decision has waited, short: "3 h", "12 min", "2 days". */
export function waitedWords(since: number | null, now: number): string | null {
  if (since === null) return null;
  const mins = Math.max(0, Math.round((now - since) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

/** The eyebrow: "Your decision · Codex is waiting · 3 h". */
export function eyebrowWords(item: Pick<DockItem, 'who' | 'since'>, now: number): string {
  const waited = waitedWords(item.since, now);
  return ['Your decision', item.who !== null ? `${item.who} is waiting` : 'the job is waiting', waited].filter((x): x is string => x !== null).join(' · ');
}

const PHONE = '(max-width: 640px)';
/** A docked renderer's headline (GateRow's question, a plan or hand-over card's, a run's question). */
const HEADLINE = '[data-testid="session-gate-question"], [data-testid="session-proposal-text"], [data-testid="elicitation-prompt"] p, [data-testid="power-pause-question"]';

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches === true);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (mq === undefined) return;
    const on = (): void => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

/**
 * The provider and the dock surface. `items` are the session's open decisions, in the thread's order; the dock
 * renders around `children` (the thread), between it and the composer (`composer`).
 */
export function DecisionDockFrame({ items, children, composer, now = Date.now() }: {
  items: readonly DockItem[];
  children: React.ReactNode;
  /** The composer, under the dock: handed the docked decision's note choice while it offers one. */
  composer?: (reply: DockReply | null, docked: boolean) => React.ReactNode;
  now?: number;
}): React.ReactElement {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [replies, setReplies] = useState<Record<string, DockReply>>({});
  const setReply = useCallback((key: string, reply: DockReply | null) => {
    setReplies((cur) => {
      if (reply === null) { if (!(key in cur)) return cur; const next = { ...cur }; delete next[key]; return next; }
      return { ...cur, [key]: reply };
    });
  }, []);
  const [picked, setPicked] = useState<string | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const phone = usePhone();
  const [expanded, setExpanded] = useState(false);
  const active = items.find((i) => i.key === picked) ?? items[0] ?? null;
  const activeKey = active?.key ?? null;
  const index = active === null ? -1 : items.indexOf(active);
  const more = items.length - 1;

  const focus = useCallback((key?: string) => {
    if (key !== undefined && items.some((i) => i.key === key)) setPicked(key);
    setExpanded(true);
    requestAnimationFrame(() => {
      const el = dockRef.current;
      if (el === null) return;
      el.scrollIntoView?.({ block: 'nearest' });
      // The decision's own row takes focus when it can (GateRow's row, the card); else the dock itself.
      const target = el.querySelector<HTMLElement>('[data-testid="session-gate-row"], [data-testid="session-proposal"], [data-testid="elicitation-prompt"]');
      (target ?? el).focus({ preventScroll: true });
    });
  }, [items]);

  // `#gate` (a Needs you row, a toast) lands on the dock, once per decision. A docked gate row focuses itself (its
  // own `#gate` rule); a docked run question gets its answer field focused here, once it has drawn in the slot.
  const landed = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey === null || slot === null || window.location.hash !== GATE_HASH || landed.current === activeKey) return;
    landed.current = activeKey;
    setExpanded(true);
    // No cleanup cancel: `landed` is already set, so a re-run (StrictMode) must not drop the one focus.
    let frames = 0;
    const tryFocus = (): void => {
      const field = slot.querySelector<HTMLElement>('[data-testid="elicitation-prompt"] :is(input, textarea, select, button)');
      const active = document.activeElement;
      if (field !== null) {
        if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) field.focus({ preventScroll: true });
        return;
      }
      if (slot.querySelector('[data-testid="session-gate-row"], [data-testid="session-proposal"]') !== null || ++frames > 20) return;
      requestAnimationFrame(tryFocus);
    };
    requestAnimationFrame(tryFocus);
  }, [activeKey, slot]);

  // The folded sheet's headline is the docked renderer's own (the cause in plain words), read off the slot as it
  // renders; the item's question stands in until it has.
  const [drawn, setDrawn] = useState<string | null>(null);
  useEffect(() => {
    if (slot === null) return;
    const read = (): void => setDrawn(slot.querySelector(HEADLINE)?.textContent?.trim() || null);
    read();
    const mo = new MutationObserver(read);
    mo.observe(slot, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [slot]);
  const value = useMemo<DockCtx>(() => ({ slot, activeKey, focus, setReply }), [slot, activeKey, focus, setReply]);
  const reply = activeKey !== null ? replies[activeKey] ?? null : null;
  const collapsed = phone && !expanded;
  // A tap in the folded sheet unfolds it (the primary still acts), so what the tap opens is in view. A DOM listener:
  // the renderer is portalled in, so React's events bubble to its thread-side parent, never to the slot.
  useEffect(() => {
    if (slot === null || !collapsed) return;
    const unfold = (): void => setExpanded(true);
    slot.addEventListener('click', unfold, true);
    return () => slot.removeEventListener('click', unfold, true);
  }, [slot, collapsed]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active !== null && (
        <section ref={dockRef} tabIndex={-1} role="region" aria-label="Your decision" data-testid="decision-dock" data-tone={active.tone}
          data-key={active.key} data-collapsed={collapsed ? 'true' : 'false'} className="wk-dock wk-measure wk-measure--thread">
          <div className="wk-dock-surface">
            {phone && (
              <button type="button" data-testid="decision-dock-handle" aria-expanded={!collapsed} aria-label={collapsed ? 'Show the decision' : 'Fold the decision away'}
                onClick={() => setExpanded((v) => !v)} className="wk-dock-handle"><span aria-hidden className="wk-dock-grab" /></button>
            )}
            <div className="wk-dock-top">
              <p data-testid="decision-dock-eyebrow" className="wk-dock-eyebrow">
                <span aria-hidden className="wk-dock-dot" />
                {eyebrowWords(active, now)}
              </p>
              {more > 0 && (
                <button type="button" data-testid="decision-dock-next" className="wk-dock-next"
                  onClick={() => setPicked(items[(index + 1) % items.length]!.key)}>
                  {more === 1 ? '1 more decision' : `${more} more decisions`} ›
                </button>
              )}
            </div>
            {/* Folded, the renderer's own headline and primary move show (decision-dock.css); the item's question stands
                in only while the renderer has drawn no headline yet. */}
            {collapsed && drawn === null && (
              <button type="button" data-testid="decision-dock-peek" onClick={() => setExpanded(true)} className="wk-dock-peek">{active.question}</button>
            )}
            {/* The active decision's renderer is portalled in here, never unmounted. Folded (a phone), it shows only the
                headline and the primary move, so the operator can act without unfolding; any tap in it unfolds the
                sheet, so what the tap opens (a note, the undo line) is in view. */}
            <div ref={setSlot} data-testid="decision-dock-slot" data-folded={collapsed ? 'true' : 'false'} className="wk-dock-slot" />
          </div>
        </section>
      )}
      {composer?.(reply, active !== null)}
    </Ctx.Provider>
  );
}

/** Whether a dock is present (a session page): the composer says "Or tell <builder> what to do…" while it is open. */
export function useDockOpen(): boolean {
  return useContext(Ctx)?.activeKey != null;
}

/** A docked renderer offers its note choice to the reply box while it is the one in the dock. */
export function useOfferReply(key: string, reply: DockReply | null): void {
  const ctx = useContext(Ctx);
  const docked = ctx !== null && ctx.activeKey === key && ctx.slot !== null;
  const setReply = ctx?.setReply;
  const label = reply?.label ?? null;
  const sendRef = useRef(reply?.send);
  sendRef.current = reply?.send;
  useEffect(() => {
    if (setReply === undefined) return;
    if (!docked || label === null) { setReply(key, null); return; }
    setReply(key, { label, send: (t) => sendRef.current?.(t) });
    return () => setReply(key, null);
  }, [setReply, docked, key, label]);
}
