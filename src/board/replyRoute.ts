import { useEffect, useRef, useState } from 'react';

/**
 * WHERE THE REPLY BOX SENDS WHILE A DECISION IS DOCKED (operator 2026-10-27, mockup ui-v2-gate). The draft's intent
 * picks the default: a question about the work goes to a separate Ask; an instruction to the job goes to the
 * decision's note choice (Send back, else Retry with a note), through its undo window. The switch beside Send shows
 * the destination before Send; a click overrides it, and the override holds for that draft.
 *
 * The intent comes from the platform's prompt-routing path, never a classifier in studio. Today that path (garden's
 * archetype detector, the default evals' "Prompt routing" suite) runs only inside crew's eval replay: crew serves no
 * route studio can ask about a draft. So the router is a seam ({@link DraftRouter}) that is `null` on today's crew,
 * and an unclear or unavailable intent goes to the decision (it has an undo window), said so on the switch.
 */

/** What the platform's router says a draft is. */
export type DraftIntent = 'question' | 'instruction' | 'unclear';

/** Asks the platform's router about a draft. `null`: no router this crew serves. */
export type DraftRouter = ((text: string) => Promise<DraftIntent>) | null;

/** Where Send goes. */
export type ReplyDest = 'reply' | 'ask';

export interface ReplyRoute {
  to: ReplyDest;
  /** Why it goes there: the router's reading, the person's own pick, or no reading at all. */
  why: 'question' | 'instruction' | 'unclear' | 'unavailable' | 'override' | 'empty';
}

/** The destination for a reading: a question asks; an instruction, an unclear reading or none replies. */
export function routeFor(intent: DraftIntent | null): ReplyRoute {
  if (intent === null) return { to: 'reply', why: 'unavailable' };
  if (intent === 'question') return { to: 'ask', why: 'question' };
  if (intent === 'instruction') return { to: 'reply', why: 'instruction' };
  return { to: 'reply', why: 'unclear' };
}

/** The switch's words: the destination first, then the other way. `choice` names the decision's note choice. */
export function switchWords(route: ReplyRoute, choice: string): { dest: string; why: string | null; flip: string } {
  if (route.to === 'ask') return { dest: 'Asks a separate question', why: route.why === 'question' ? null : null, flip: 'Reply instead' };
  const why = route.why === 'unclear' ? 'couldn’t tell if it was a question, so it replies'
    : route.why === 'unavailable' ? 'this service can’t tell questions from instructions yet, so it replies'
      : null;
  return { dest: `Replies to this decision (${choice})`, why, flip: 'Ask instead' };
}

/** How long the draft rests before it is read again. */
export const ROUTE_DEBOUNCE_MS = 400;

/**
 * The reply box's destination for `draft`: the router's reading (debounced), or the person's override, which holds
 * until the draft is emptied (a send, or cleared by hand).
 */
export function useReplyRoute(draft: string, router: DraftRouter, debounceMs = ROUTE_DEBOUNCE_MS): {
  route: ReplyRoute;
  flip: () => void;
} {
  const [intent, setIntent] = useState<{ text: string; intent: DraftIntent } | null>(null);
  const [override, setOverride] = useState<ReplyDest | null>(null);
  const seq = useRef(0);
  const text = draft.trim();
  useEffect(() => {
    if (text === '') { setOverride(null); setIntent(null); return; }
    if (router === null) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      router(text).then(
        (i) => { if (mine === seq.current) setIntent({ text, intent: i }); },
        () => { if (mine === seq.current) setIntent({ text, intent: 'unclear' }); },
      );
    }, debounceMs);
    return () => clearTimeout(t);
  }, [text, router, debounceMs]);
  const inferred: ReplyRoute = text === '' ? { to: 'reply', why: 'empty' } : router === null ? routeFor(null) : routeFor(intent?.intent ?? 'unclear');
  const route: ReplyRoute = override !== null ? { to: override, why: 'override' } : inferred;
  return { route, flip: () => setOverride(route.to === 'reply' ? 'ask' : 'reply') };
}
