import { create } from 'zustand';

/**
 * studio#1399: which job picks (by their chip key) ask for the REST surface. Kept outside the composer, so a composer
 * that remounts (the person went elsewhere and came back) keeps the choice its pick had, and a retry of the same
 * request sends the same words (the same request id). A new pick has a new key, so it starts off.
 */
interface RestPicks {
  on: Readonly<Record<string, true>>;
  set: (pickKey: string, on: boolean) => void;
}

export const useRestPicks = create<RestPicks>((set) => ({
  on: {},
  set: (pickKey, on) => set((s) => {
    if (on === (s.on[pickKey] === true)) return s;
    const next: Record<string, true> = { ...s.on };
    if (on) next[pickKey] = true;
    else delete next[pickKey];
    return { on: next };
  }),
}));
