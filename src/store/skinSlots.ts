import { create } from 'zustand';

/**
 * Where the shell's skin regions are mounted (theming/skins.ts `shell`). The shell renders
 * the region and registers its element here; a surface whose variant docks into that
 * region portals into it. `null` = the region is not mounted, so the surface renders in
 * place — a variant never makes its behaviour disappear.
 */
interface SkinSlots {
  rightRail: HTMLElement | null;
  setRightRail: (el: HTMLElement | null) => void;
}

export const useSkinSlots = create<SkinSlots>((set) => ({
  rightRail: null,
  setRightRail: (el) => set({ rightRail: el }),
}));
