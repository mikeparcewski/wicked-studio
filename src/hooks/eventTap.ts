import type { CoreEvent } from '../api/types.js';

/**
 * The page's ONE `/ws` subscription (App.tsx `useEventStream`) handed on to code outside React's store fold: a
 * run-thread plugin's feed listens here, so a plugin never opens a socket of its own. Every frame, verbatim.
 */
const listeners = new Set<(e: CoreEvent) => void>();

export function publishCoreEvent(e: CoreEvent): void {
  for (const l of [...listeners]) {
    try { l(e); } catch { /* one listener's failure never stops the others */ }
  }
}

export function subscribeCoreEvents(on: (e: CoreEvent) => void): () => void {
  listeners.add(on);
  return () => { listeners.delete(on); };
}
