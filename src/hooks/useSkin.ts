import { useAppearanceStore } from '../theming/appearance.js';
import { skinById, type SkinManifest, type SkinVariants } from '../theming/skins.js';

/** The active skin's manifest (theming/skins.ts), from the appearance store. */
export function useSkin(): SkinManifest {
  return skinById(useAppearanceStore((s) => s.appearance.skin));
}

/** The variant the active skin names for one behaviour surface. */
export function useSkinVariant<K extends keyof SkinVariants>(surface: K): SkinVariants[K] {
  return useSkin().variants[surface];
}
