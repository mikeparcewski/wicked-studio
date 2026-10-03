import { useViewPrefsStore } from '../store/viewPrefs.js';
import { displayPath, displayText } from '../board/homePath.js';

const identity = (s: string): string => s;

/**
 * The default layer's path formatter (studio#458/#460/#462): `~/…` for a path under the home
 * directory, the full path when "Show technical details" is on (`studio.view.technical_details`,
 * the same switch that reveals the hand-over card's engine text, studio#444).
 */
export function useDisplayPath(): (path: string) => string {
  const technical = useViewPrefsStore((s) => s.prefs.technical_details);
  return technical ? identity : displayPath;
}

/** The same switch over free text: a unit's output, a finding's message, a card's sentence. */
export function useDisplayText(): (text: string) => string {
  const technical = useViewPrefsStore((s) => s.prefs.technical_details);
  return technical ? identity : displayText;
}
