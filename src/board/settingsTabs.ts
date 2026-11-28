/**
 * THE SETTINGS PAGE'S TABS (studio-settings-tabs, operator 2026-10-25: "merge general and theme … as
 * tabs (current general as default view)"): `/system` is the General tab, `/system?tab=theme` the
 * Theme tab, and the retired `/theme` address redirects to the Theme tab. Pure. crew#2013 adds a
 * third tab, Advanced (`/system?tab=advanced`): the settings that were environment variables only.
 */
export type SettingsTab = 'general' | 'theme' | 'advanced';

export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'theme', 'advanced'];

/** The Advanced tab's address. */
export const SETTINGS_ADVANCED_PATH = '/system?tab=advanced';

/** The Theme tab's address (the one every "Theme" link and the palette's Theme row open). */
export const SETTINGS_THEME_PATH = '/system?tab=theme';

/** `?tab=` on the address; anything but `theme` or `advanced` is the default, General. */
export function readSettingsTab(search: string): SettingsTab {
  const tab = new URLSearchParams(search).get('tab');
  return tab === 'theme' || tab === 'advanced' ? tab : 'general';
}

/** A tab's address. */
export function settingsPath(tab: SettingsTab): string {
  return tab === 'theme' ? SETTINGS_THEME_PATH : tab === 'advanced' ? SETTINGS_ADVANCED_PATH : '/system';
}
