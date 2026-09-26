import { useEffect, useState } from 'react';
import { draftOutbound, type OutboundKind } from '../api/outbound.js';

export type OutboundDraftState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; text: string };

/**
 * The outbound harness's state (studio wave 1): fetch the draft once per {kind, runId}, then
 * hold the operator's EDITS — the text the send actions act on is the edited text.
 */
export function useOutboundDraft(kind: OutboundKind, runId: string): {
  draft: OutboundDraftState;
  setText: (text: string) => void;
} {
  const [draft, setDraft] = useState<OutboundDraftState>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setDraft({ state: 'loading' });
    draftOutbound({ kind, runId })
      .then((d) => { if (!cancelled) setDraft({ state: 'ready', text: d.text }); })
      .catch((err: unknown) => {
        if (!cancelled) setDraft({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [kind, runId]);
  return { draft, setText: (text) => setDraft({ state: 'ready', text }) };
}

/**
 * The send actions the harness offers. ONE today — Copy. Mail and Message join this list
 * (and only this list) when they have a real channel behind them; the component renders
 * whatever is here, so no dead button is ever drawn.
 */
export type OutboundAction = 'copy';
export const OUTBOUND_ACTIONS: readonly OutboundAction[] = ['copy'];
