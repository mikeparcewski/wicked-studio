/**
 * THE SETTINGS PAGE'S TABS (studio-settings-tabs, operator 2026-10-25: "merge general and theme … as
 * tabs (current general as default view)"): `/system` is the General tab, `/system?tab=theme` the
 * Theme tab, and the retired `/theme` address redirects to the Theme tab. Pure.
 */
export type SettingsTab = 'general' | 'theme';

export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'theme'];

/** The Theme tab's address (the one every "Theme" link and the palette's Theme row open). */
export const SETTINGS_THEME_PATH = '/system?tab=theme';

/** `?tab=` on the address; anything but `theme` is the default, General. */
export function readSettingsTab(search: string): SettingsTab {
  return new URLSearchParams(search).get('tab') === 'theme' ? 'theme' : 'general';
}

/** A tab's address. */
export function settingsPath(tab: SettingsTab): string {
  return tab === 'theme' ? SETTINGS_THEME_PATH : '/system';
}
