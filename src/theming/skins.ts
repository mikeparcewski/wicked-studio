/**
 * THE SKIN CONTRACT — studio's shape and style are skins over ONE behaviour layer.
 *
 * The behaviours (the needs-you queue's ranking and keys, handover, peek/jump/back, the
 * undo window, …) live in models, hooks and stores; components render them; the e2e
 * journeys assert them through data-testid and roles. A skin changes none of that. It
 * is a manifest of exactly three things:
 *
 *   1. `tokens`   — overrides of the SAME semantic-token names tokens.css declares
 *                   (never a primitive, never a colour: themes own colour). Applied as
 *                   inline custom properties on <html>, the §3.3 cascade seam.
 *   2. `shell`    — the shell layout: `classic`, or `right-rail` (the shell reserves a
 *                   persistent right column on Home).
 *   3. `variants` — which variant renders each behaviour surface.
 *
 * Kept deliberately small: a surface's variant union only holds variants that exist.
 * Adding one = widen the union, add the render branch, name it in a manifest.
 *
 * The active skin rides `studio.appearance.skin` (theming/appearance.ts), next to the
 * theme, and is stamped on <html> as `data-skin`.
 */

/** The shell layouts a skin can choose. */
export type ShellLayout = 'classic' | 'right-rail';

/** Which variant renders each behaviour surface. */
export interface SkinVariants {
  /** The Needs-you queue: inline in Home's command center, or docked in the right rail. */
  needsQueue: 'inline' | 'rail';
  /** The live-runs surface: the bottom sheet. */
  liveRuns: 'sheet';
  /** Handover on arrival: the banner above the KPI ribbon. */
  handover: 'banner';
  /** The peek card (P). */
  peek: 'card';
  /** The gate-decision undo toasts. */
  undoToasts: 'stack';
  /** The left nav: the full accordion rail, or collapsed to icons. */
  navRail: 'full' | 'icons';
}

export type SkinSurface = keyof SkinVariants;

export const SKIN_SURFACES: readonly SkinSurface[] = [
  'needsQueue', 'liveRuns', 'handover', 'peek', 'undoToasts', 'navRail',
];

/** A semantic custom-property name, e.g. `--text-sm` (validated against tokens.css in tests). */
export type SkinToken = `--${string}`;

export interface SkinManifest {
  id: string;
  name: string;
  /** One line for the picker. */
  description: string;
  tokens: Readonly<Partial<Record<SkinToken, string>>>;
  shell: ShellLayout;
  variants: Readonly<SkinVariants>;
}

/** The current look — no overrides, the classic shell, every default variant. */
const STUDIO: SkinManifest = {
  id: 'studio',
  name: 'Studio',
  description: 'The standard layout — the queue in the command center, the full nav rail.',
  tokens: {},
  shell: 'classic',
  variants: {
    needsQueue: 'inline', liveRuns: 'sheet', handover: 'banner',
    peek: 'card', undoToasts: 'stack', navRail: 'full',
  },
};

/**
 * The PROOF skin: structurally different on purpose, so the contract is visible. Not a
 * final visual design. The queue moves into a persistent right rail, the nav collapses
 * to icons, and the type and spacing scales tighten. Tokens only — no colour.
 */
const COMPACT_RAIL: SkinManifest = {
  id: 'compact-rail',
  name: 'Compact rail',
  description: 'Denser type and spacing, icon-only nav, the Needs-you queue in a right rail.',
  tokens: {
    '--text-2xs': '9px',
    '--text-xs': '10px',
    '--text-sm': '12px',
    '--text-md': '13px',
    '--text-lg': '15px',
    '--text-xl': '18px',
    '--text-2xl': '22px',
    '--space-1': '3px',
    '--space-2': '6px',
    '--space-3': '8px',
    '--space-4': '10px',
    '--space-5': '14px',
    '--space-6': '16px',
    '--space-8': '22px',
    '--space-10': '28px',
    '--space-12': '36px',
    '--space-16': '48px',
    '--leading-body': '1.35',
    '--radius-md': '6px',
    '--radius-lg': '8px',
  },
  shell: 'right-rail',
  variants: {
    needsQueue: 'rail', liveRuns: 'sheet', handover: 'banner',
    peek: 'card', undoToasts: 'stack', navRail: 'icons',
  },
};

export const SKINS: readonly SkinManifest[] = [STUDIO, COMPACT_RAIL];

export type SkinId = 'studio' | 'compact-rail';

export const DEFAULT_SKIN_ID: SkinId = 'studio';

export function isSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && SKINS.some((s) => s.id === v);
}

/** The manifest for `id`; anything unknown resolves to the default skin. */
export function skinById(id: unknown): SkinManifest {
  return SKINS.find((s) => s.id === id) ?? STUDIO;
}

/** Every token any skin overrides — what a swap must clear before applying the next. */
export function skinTokenKeys(): SkinToken[] {
  return [...new Set(SKINS.flatMap((s) => Object.keys(s.tokens) as SkinToken[]))];
}

/** Width of the shell's right rail (px). */
export const RIGHT_RAIL_PX = 340;

/**
 * Whether the shell renders its right rail for this route. The rail holds the Needs-you
 * queue, whose fold (needsYouRows) is computed on Home — so the rail opens on Home.
 */
export function rightRailOpen(skin: SkinManifest, panel: string): boolean {
  return skin.shell === 'right-rail' && panel === 'home';
}
