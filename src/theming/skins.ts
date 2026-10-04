/**
 * THE SKIN CONTRACT — studio's shape and style are skins over ONE behaviour layer.
 *
 *   A skin changes no behaviour; every route is reachable under every skin, by its nav
 *   or ⌘K; keyboard behaviour is identical across skins.
 *
 * (Restated by the operator, DES-STUDIO-REBUILD-001 §10 / §14 Q2; pinned by
 * e2e/skin_contract_test.py.) There is one keyboard model for every skin — no global
 * shortcut is a bare printable key (§5.6), so no skin can claim a letter.
 *
 * The behaviours (the needs-you queue's ranking and keys, handover, peek/jump/back, the
 * undo window, …) live in models, hooks and stores; components render them; the e2e
 * journeys assert them through data-testid and roles. A skin changes none of that. It
 * is a manifest of exactly three things:
 *
 *   1. `tokens`   — overrides of the SAME semantic-token names tokens.css declares
 *                   (never a primitive, never a colour: themes own colour). Applied as
 *                   inline custom properties on <html>, the §3.3 cascade seam.
 *   2. `shell`    — the shell layout: `classic`, `right-rail` (the shell reserves a
 *                   persistent right column on every route), or `desk` (the session rail
 *                   and the Desk — DES-STUDIO-REBUILD-001 §5.1, slice S4).
 *   3. `variants` — which variant renders each behaviour surface.
 *
 * Kept deliberately small: a surface's variant union only holds variants that exist.
 * Adding one = widen the union, add the render branch, name it in a manifest.
 *
 * The active skin rides `studio.appearance.skin` (theming/appearance.ts), next to the
 * theme, and is stamped on <html> as `data-skin`.
 */

/** The shell layouts a skin can choose. */
export type ShellLayout = 'classic' | 'right-rail' | 'desk';

/** Which variant renders each behaviour surface. */
export interface SkinVariants {
  /** The Needs-you queue: inline in Home's command center, docked in the right rail, or the
   *  Desk's list of plain rows (one action each). */
  needsQueue: 'inline' | 'rail' | 'desk';
  /** The live-runs surface: the bottom sheet, or rows in the session rail. */
  liveRuns: 'sheet' | 'rail-rows';
  /** Handover on arrival: the banner above the KPI ribbon, or the Desk's "While you were away". */
  handover: 'banner' | 'desk-away';
  /** The peek card (P). */
  peek: 'card';
  /** The gate-decision undo toasts. */
  undoToasts: 'stack';
  /** The left nav: the full accordion rail, collapsed to icons, or the session rail. */
  navRail: 'full' | 'icons' | 'sessions';
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

/** The classic look (the default until the flip, S15b) — no overrides, the classic shell, every default variant. */
const STUDIO: SkinManifest = {
  id: 'studio',
  name: 'Studio',
  description: 'The classic layout — the queue in the command center, the full nav rail.',
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

/**
 * The DESK (DES-STUDIO-REBUILD-001 §5.1, slice S4): the concept's shape — a 236 px session rail
 * (sessions grouped by project, with badges), and on `/` the Desk: the greeting, "N things need
 * you", the needs-you list as plain rows, the chores "for whoever runs studio", "Your projects" in
 * sentences, the Start row and the composer. Tokens: the type face
 * and the softer radii of DESIGN-simple §1a — never a colour (the wicked themes own colour, and a
 * skin never selects a theme). The default since the flip (S15b); `studio` and `compact-rail` stay
 * selectable on the Theme page.
 */
const DESK: SkinManifest = {
  id: 'desk',
  name: 'Desk',
  description: 'The calm Desk — what needs you, your projects in sentences, one composer, a session rail.',
  tokens: {
    '--font-sans': "'Archivo', system-ui, -apple-system, sans-serif",
    '--radius-md': '8px',
    '--radius-lg': '12px',
  },
  shell: 'desk',
  variants: {
    needsQueue: 'desk', liveRuns: 'rail-rows', handover: 'desk-away',
    peek: 'card', undoToasts: 'stack', navRail: 'sessions',
  },
};

export const SKINS: readonly SkinManifest[] = [STUDIO, COMPACT_RAIL, DESK];

export type SkinId = 'studio' | 'compact-rail' | 'desk';

/** The flip (S15b): the Desk is the default. Rollback = revert S15b, or pick another skin on the Theme page. */
export const DEFAULT_SKIN_ID: SkinId = 'desk';

export function isSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && SKINS.some((s) => s.id === v);
}

/** The manifest for `id`; anything unknown resolves to the default skin. */
export function skinById(id: unknown): SkinManifest {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN_ID)!;
}

/** Every token any skin overrides — what a swap must clear before applying the next. */
export function skinTokenKeys(): SkinToken[] {
  return [...new Set(SKINS.flatMap((s) => Object.keys(s.tokens) as SkinToken[]))];
}

/** Width of the shell's right rail (px). */
export const RIGHT_RAIL_PX = 340;

/**
 * Whether the shell renders its right rail. The rail holds the Needs-you queue, whose fold
 * (`useNeedsRows`) reads app-level sources — so a right-rail skin has its rail on EVERY route.
 */
export function rightRailOpen(skin: SkinManifest): boolean {
  return skin.shell === 'right-rail';
}

/** Width of the desk shell's session rail (px) — fixed, so nothing moves when a pane opens. */
export const SESSION_RAIL_PX = 236;

/** Whether the shell is the Desk's (the session rail on every route, the Desk on `/`). */
export function deskShell(skin: SkinManifest): boolean {
  return skin.shell === 'desk';
}
