import { ChevronRight } from 'lucide-react';
import { BUILD_LINKS } from '../board/navModel.js';
import { PAGE_NAMES } from '../board/pageNames.js';
import type { Navigate } from '../hooks/useRoute.js';
import { PageFrame } from './ui/PageFrame.js';

/**
 * BUILD & SETTINGS (`/build`, the ui-v2 nav regroup): the rail's one foot entry opens this list of the
 * pages that shape what agents can do and how studio runs — Skills, MCP, Plugins, Workflows and
 * Settings (the rail's old Workspace group, `BUILD_LINKS`). Navigation only: each row is a link to its
 * page, with one line on what is there.
 */
export function BuildPage({ navigate }: { navigate: Navigate }): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto">
      <PageFrame width="narrow" title={PAGE_NAMES.build} intro="What your agents can use, and how studio runs on this computer." data-testid="build-page">
        <ul className="wk-build-list" aria-label={PAGE_NAMES.build}>
          {BUILD_LINKS.map((l) => (
            <li key={l.id}>
              <a href={l.path} data-testid={l.testId} className="wk-build-link"
                onClick={(e) => { e.preventDefault(); navigate(l.path); }}>
                <span className="wk-build-text">
                  <span className="wk-build-name">{l.label}</span>
                  <span className="wk-build-hint">{l.hint}</span>
                </span>
                <ChevronRight size={16} aria-hidden className="wk-build-chev" />
              </a>
            </li>
          ))}
        </ul>
      </PageFrame>
    </div>
  );
}
