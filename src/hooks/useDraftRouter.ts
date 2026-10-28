import { useSyncExternalStore } from 'react';
import type { DraftRouter } from '../board/replyRoute.js';

/**
 * The platform's prompt-routing path for a composer draft, when crew serves one. Crew's routing classifier (garden's
 * archetype detector, scored by the default evals' "Prompt routing" suite) runs only inside crew's eval replay today:
 * there is no route studio can ask about a draft, and no capability that announces one. So none is provided, and the
 * reply box replies to the decision (it has an undo window) and says why. When crew ships the route, the API client
 * provides it here ({@link provideDraftRouter}) behind its capability; nothing else changes (crew#1175). Overrides are
 * not recorded as eval cases until crew has a capture path for them (crew#1176).
 */
let router: DraftRouter = null;
const listeners = new Set<() => void>();

export function provideDraftRouter(next: DraftRouter): void {
  router = next;
  for (const l of listeners) l();
}

export function useDraftRouter(): DraftRouter {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => router, () => router);
}
