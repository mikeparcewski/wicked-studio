// What the composer is carrying (DES-MERGE-001 §4.6, §4.9, §6.4 slice 16).
//
// A picked theme and an attached reference folder are CONTEXT, not actions: they change
// what the next generation is made of, so they belong on the composer as chips — studio's
// existing `ContextPopover` pattern (§4.9) — rather than in a modal that closes and leaves
// no trace of what is in effect.
//
// Two properties this store is shaped by:
//
//   - a chip is a REFERENCE, never a payload. A source chip holds the path the service
//     reads in place; there is no File, no ArrayBuffer and no FormData anywhere in this
//     module, which is the client half of §4.9's "nothing uploads" guarantee.
//   - context is keyed to the composer the user is looking at, including the one with no
//     document yet (§2.2 case 1) — a theme picked before the first message must ride with
//     the generation that message opens, so `docId: null` is a real key, not a gap.

import { create } from 'zustand';

/** The composer's identity. Mirrors `threadKey`, extended to the doc-less case 1. */
export function contextKey(projectId: string, docId: string | null): string {
  return `${projectId}:${docId ?? ''}`;
}

interface DocContextStore {
  /** The picked theme's slug (`ThemeSummary.name`), per composer. */
  theme: Record<string, string>;
  /** Attached reference paths, per composer, in the order they were attached. */
  sources: Record<string, string[]>;
  /** Pick a theme, or clear the chip by passing `null`. One theme at a time (§4.6). */
  pickTheme: (key: string, themeId: string | null) => void;
  /** Record an attached path. Idempotent: attaching the same folder twice is one chip. */
  addSource: (key: string, path: string) => void;
  removeSource: (key: string, path: string) => void;
  clear: (key: string) => void;
}

export const useDocContextStore = create<DocContextStore>((set) => ({
  theme: {},
  sources: {},

  pickTheme: (key, themeId) =>
    set((s) => {
      const theme = { ...s.theme };
      if (themeId === null || themeId === '') delete theme[key];
      else theme[key] = themeId;
      return { theme };
    }),

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
      const theme = { ...s.theme }; delete theme[key];
      const sources = { ...s.sources }; delete sources[key];
      return { theme, sources };
    }),
}));
