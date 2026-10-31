import { create } from 'zustand';

/**
 * Guided asks: what a person answered, kept as its one plain line ("You picked: main, develop") where the question
 * was, after the question itself is gone (an answered elicitation leaves the store at once). Keyed by the run or chat
 * id the question belonged to; in memory for the page's life, and replaced by the next answer there.
 */
export interface AnsweredAsk { askId: string; line: string; at: number }

interface AnsweredAsks {
  byKey: Record<string, AnsweredAsk>;
  remember: (key: string, a: AnsweredAsk) => void;
  forget: (key: string) => void;
}

export const useAnsweredAsks = create<AnsweredAsks>((set) => ({
  byKey: {},
  remember: (key, a) => set((s) => ({ byKey: { ...s.byKey, [key]: a } })),
  forget: (key) => set((s) => {
    if (!(key in s.byKey)) return s;
    const next = { ...s.byKey };
    delete next[key];
    return { byKey: next };
  }),
}));
