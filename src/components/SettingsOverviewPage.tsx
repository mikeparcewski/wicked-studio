import { ADDITIONAL_SETTINGS } from '../board/deskModel.js';
import type { Navigate } from '../hooks/useRoute.js';
import { PageFrame } from './ui/index.js';

/**
 * THE SETTINGS OVERVIEW (`/settings`; operator 2026-10-11): where the rail's "Additional settings"
 * link lands — every settings page, said in one plain sentence, with a link to it. It replaces the
 * rail's dropdown; the list (and its order) is `ADDITIONAL_SETTINGS`.
 */
export function SettingsOverviewPage({ navigate }: { navigate: Navigate }): React.ReactElement {
  return (
    <div className="wk-desk-scroll">
      <PageFrame data-testid="settings-overview" title="Settings" intro="Everything that changes how studio works, one page each.">
        <ul className="wk-settings-list">
          {ADDITIONAL_SETTINGS.map((d) => (
            <li key={d.dest} data-testid="settings-overview-row" data-dest={d.dest} className="wk-card wk-settings-row">
              <a href={d.path} onClick={(e) => { e.preventDefault(); navigate(d.path); }} className="wk-link wk-settings-link">{d.label}</a>
              <p data-testid="settings-overview-sentence" className="wk-settings-about">{d.about}</p>
            </li>
          ))}
        </ul>
      </PageFrame>
    </div>
  );
}
