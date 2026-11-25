import { create } from 'zustand';

/**
 * wicked-core#1043: the seat layer change in flight, per repository (repo id → the layer being changed). It lives
 * outside the Seat toolchain card because the card unmounts when Settings is left: a card opened again while a change
 * is still on its way waits for it, rather than building the next full list from the row it had before.
 */
interface State {
  saving: Record<string, string>;
  /** Claims the repository's one change in flight; false when one is already on its way. */
  begin: (repoId: string, layerId: string) => boolean;
  end: (repoId: string) => void;
}

export const useSeatLayerSaves = create<State>((set, get) => ({
  saving: {},
  begin: (repoId, layerId) => {
    if (Object.hasOwn(get().saving, repoId)) return false;
    set((s) => ({ saving: { ...s.saving, [repoId]: layerId } }));
    return true;
  },
  end: (repoId) => set((s) => {
    const { [repoId]: _done, ...rest } = s.saving;
    void _done;
    return { saving: rest };
  }),
}));

/** The layer being changed for `repoId`, if one is (own keys only: a repository may be named `constructor`). */
export function savingOf(saving: Record<string, string>, repoId: string): string | null {
  return Object.hasOwn(saving, repoId) ? saving[repoId]! : null;
}

/** Tests only. */
export function resetSeatLayerSaves(): void {
  useSeatLayerSaves.setState({ saving: {} });
}
