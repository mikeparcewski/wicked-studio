// What the composer is carrying (DES-MERGE-001 §4.9, §6.4).
//
// An attached reference folder is CONTEXT, not an action: it changes what the next
// generation is made of, so it belongs on the composer as a chip — studio's existing
// `ContextPopover` pattern (§4.9) — rather than in a modal that closes and leaves
// no trace of what is in effect.
//
// NOTE (issue #65): the PICKED-THEME half of this store is gone. It modeled slice 16's
// theme library (`GET /api/themes` + a `theme_id` riding the next generation), and the
// real bridge serves neither — no theme registry exists, and nothing consumed `theme_id`.
// The real theme surface is doc-scoped learning (`requestThemeLearn`): the learned look
// sticks to the document server-side, so there is nothing for the composer to carry.
//
// Two properties this store is shaped by:
//
//   - a chip is a REFERENCE, never a payload. A source chip holds the path the service
//     reads in place; there is no File, no ArrayBuffer and no FormData anywhere in this
//     module, which is the client half of §4.9's "nothing uploads" guarantee.
//   - context is keyed to the composer the user is looking at, including the one with no
//     document yet (§2.2 case 1), so `docId: null` is a real key, not a gap.

import { create } from 'zustand';

/** The composer's identity. Mirrors `threadKey`, extended to the doc-less case 1. */
export function contextKey(projectId: string, docId: string | null): string {
  return `${projectId}:${docId ?? ''}`;
}

interface DocContextStore {
  /** Attached reference paths, per composer, in the order they were attached. */
  sources: Record<string, string[]>;
  /** Record an attached path. Idempotent: attaching the same folder twice is one chip. */
  addSource: (key: string, path: string) => void;
  removeSource: (key: string, path: string) => void;
  clear: (key: string) => void;
}

export const useDocContextStore = create<DocContextStore>((set) => ({
  sources: {},

  addSource: (key, path) =>
    set((s) => {
      const had = s.sources[key] ?? [];
      return had.includes(path) ? s : { sources: { ...s.sources, [key]: [...had, path] } };
    }),

  removeSource: (key, path) =>
    set((s) => ({
      sources: { ...s.sources, [key]: (s.sources[key] ?? []).filter((p) => p !== path) },
    })),

  clear: (key) =>
    set((s) => {
      const sources = { ...s.sources }; delete sources[key];
      return { sources };
    }),
}));
