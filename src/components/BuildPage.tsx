import { ChevronRight } from 'lucide-react';
import { BUILD_LINKS } from '../board/navModel.js';
import { PAGE_NAMES } from '../board/pageNames.js';
import type { Navigate } from '../hooks/useRoute.js';
import { CalmHead, CalmPage, CalmRow, CalmRows } from './calm/Calm.js';

/**
 * BUILD & SETTINGS (`/build`, the ui-v2 nav regroup): the rail's one foot entry opens this list of the
 * pages that shape what agents can do and how studio runs — Skills, MCP, Plugins, Workflows and
 * Settings (the rail's old Workspace group, `BUILD_LINKS`). Navigation only: each row is a link to its
 * page, with one line on what is there.
 */
export function BuildPage({ navigate }: { navigate: Navigate }): React.ReactElement {
  // The calm page pattern (Steering, Memory, Agents): a title and one sentence, then roomy rows.
  return (
    <CalmPage data-testid="build-page">
      <CalmHead title={PAGE_NAMES.build} sentence="What your agents can use, and how studio runs on this computer." />
      <CalmRows label={PAGE_NAMES.build}>
        {BUILD_LINKS.map((l) => (
          <CalmRow key={l.id} tone="quiet" title={l.label} sub={l.hint} href={l.path} openTestId={l.testId} onOpen={() => navigate(l.path)}
            meta={<ChevronRight size={18} aria-hidden className="wk-build-chev" />} />
        ))}
      </CalmRows>
    </CalmPage>
  );
}
