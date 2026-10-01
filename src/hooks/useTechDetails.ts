import { useViewPrefsStore } from '../store/viewPrefs.js';

/**
 * Whether "Show technical details" is on (DES-studio-rebuild S3). The one read every surface
 * uses, so a toggle in Settings re-renders every handle at once, with no reload. Off by default.
 */
export function useTechDetails(): boolean {
  return useViewPrefsStore((s) => s.prefs.technical_details);
}
