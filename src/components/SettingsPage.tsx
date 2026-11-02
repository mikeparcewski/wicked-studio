import { PAGE_NAMES } from '../board/pageNames.js';
import { readSettingsTab, settingsPath, type SettingsTab } from '../board/settingsTabs.js';
import type { Navigate } from '../hooks/useRoute.js';
import { SystemSettings } from './SystemSettings.js';
import { ThemeSettings } from './ThemePage.js';
import { PageFrame } from './ui/PageFrame.js';
import { Tabs } from './ui/Tabs.js';

/** Each tab's one intro sentence (the pages' own, unchanged). */
const INTRO: Record<SettingsTab, string> = {
  general: 'Choose how Studio displays your work and uses your helpers.',
  theme: 'Choose the colors and branding for your workspace.',
};

/**
 * SETTINGS (`/system`, studio-settings-tabs): the General page and the Theme page as two tabs of one
 * page, to free a rail item. General is the default tab; the tab rides the address (`?tab=theme`), so
 * a link, Back/Forward and a reload land on the same tab, and the retired `/theme` redirects to the
 * Theme tab. Each tab's content is the old page's, unchanged. The tabs are the app's `Tabs`
 * (arrow keys move between them, Enter or Space opens one, `aria-selected` marks it).
 */
export function SettingsPage({ navigate, search }: { navigate: Navigate; search: string }): React.ReactElement {
  const tab = readSettingsTab(search);
  return (
    <PageFrame width="narrow" title="Settings" intro={INTRO[tab]} data-testid="settings-page">
      <Tabs
        idBase="settings"
        aria-label="Settings"
        data-testid="settings-tabs"
        tabTestId="settings-tab"
        tabs={[{ id: 'general', label: 'General' }, { id: 'theme', label: PAGE_NAMES.theme }]}
        active={tab}
        onChange={(id) => { if (id !== tab) navigate(settingsPath(id as SettingsTab)); }}
      />
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} data-testid="settings-panel" data-tab={tab}>
        {tab === 'general' ? <SystemSettings navigate={navigate} /> : <ThemeSettings navigate={navigate} />}
      </div>
    </PageFrame>
  );
}
