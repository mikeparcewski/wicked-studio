import { create } from 'zustand';

/**
 * A request to REVEAL rows in the Needs You queue: scroll to them and briefly highlight them.
 * The handover's "decisions due" and "broke" chips send one, so their rows' own verbs (Open gate,
 * Retry) stay the one place those items are answered — the handover never duplicates them.
 *
 * `keys` are need-row keys (`gate:<run>`, `fail:<run>`, `elicit:<run>` — the handover's item keys
 * are the same). `nonce` makes pressing the same chip twice reveal twice. Whichever queue is
 * mounted (inline on Home, or in the compact-rail skin's right rail) answers it.
 */
interface QueueRevealStore {
  keys: readonly string[];
  nonce: number;
  /** When the request was made (epoch ms): a queue mounted later does not replay an old one. */
  at: number;
  reveal: (keys: readonly string[]) => void;
}

export const useQueueReveal = create<QueueRevealStore>((set) => ({
  keys: [],
  nonce: 0,
  at: 0,
  reveal: (keys) => set((s) => ({ keys: [...keys], nonce: s.nonce + 1, at: Date.now() })),
}));

/** A request older than this is history, not a request (a queue remounting on the way back Home). */
export const REVEAL_FRESH_MS = 1000;

/** How long a revealed row stays highlighted. */
export const REVEAL_MS = 1800;
