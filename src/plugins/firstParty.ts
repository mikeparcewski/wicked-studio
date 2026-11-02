import looks from './firstPartyLooks.json';
import deckIcon from './wicked-deck/icon.svg?raw';
import docIcon from './wicked-doc/icon.svg?raw';
import insightsIcon from './wicked-insights/icon.svg?raw';
import pageIcon from './wicked-page/icon.svg?raw';
import videoIcon from './wicked-video/icon.svg?raw';
import { NO_VISUALS, parseVisuals, svgDataUrl, type PluginVisuals } from './visuals.js';

/**
 * How studio's first-party editors look on the Plugins page, from the same files their editor.json is built from
 * (`firstPartyLooks.json`, `<id>/icon.svg`). Crew's registry carries them on the wire (`EditorView` `description`,
 * `visuals`); a crew that predates the fields gets these, so a built-in editor never shows as a bare initial.
 */
const ICONS: Record<string, string> = { 'wicked-deck': deckIcon, 'wicked-doc': docIcon, 'wicked-insights': insightsIcon, 'wicked-page': pageIcon, 'wicked-video': videoIcon };
const LOOKS = looks as unknown as Record<string, { description?: string; color?: string }>;

export function firstPartyLooks(id: string): { description: string | null; visuals: PluginVisuals } {
  const own = Object.hasOwn(LOOKS, id) && id !== '$doc' ? LOOKS[id] : undefined;
  const icon = Object.hasOwn(ICONS, id) ? ICONS[id] : undefined;
  if (own === undefined && icon === undefined) return { description: null, visuals: NO_VISUALS };
  return {
    description: typeof own?.description === 'string' ? own.description : null,
    visuals: parseVisuals({ color: own?.color, icon: icon !== undefined ? svgDataUrl(icon) : undefined }),
  };
}
