import { EvaluateSurface } from './steer/EvaluateSurface.js';
import type { SessionView } from '../api/types.js';
import type { LaunchIntent, TestingSubPage } from '../api/testing.js';
import type { Navigate } from '../hooks/useRoute.js';
import { CampaignScoreboard } from './CampaignScoreboard.js';
import { CampaignsPage } from './CampaignsPage.js';

/**
 * The Testing surface (`/testing/:page`) — ONE page component parameterized by sub-page,
 * two sub-pages (the testing-UX wave folded the Harness into the landing):
 *
 *  - **Campaigns** — THE LANDING: the campaign command surface (`CampaignsPage` — KPI band,
 *    creation verbs, filterable card grid; the retired Harness's recon / new-campaign /
 *    add-with-chat verbs live in its header), with `/testing/campaigns/:id` rendering one
 *    campaign's scoreboard. The retired `/testing/harness` and the flat `/campaigns`
 *    addresses redirect here (`useTestingRedirect`).
 *  - **Evals** — the steering-rule eval runner over the PINNED testing wire
 *    (`POST /testing/evals/run`, `POST /testing/corpora/import` — see `../api/testing.ts`):
 *    run per steering type or all, caught/gap/false-positive summary + results table, gap rows
 *    expanding to nearest-rule similarities, and corpus upload. HONEST states throughout:
 *    501 names the engine gap (core-ts 0.7.5), `degraded: "facet-only"` renders a visible
 *    no-embedder notice, an empty corpus is an empty state in words — never a spinner that
 *    cannot settle, never fabricated numbers.
 */

// The Evals sub-page moved to `./steer/EvaluateSurface.tsx` (DES-steer-eval §3); its verdict word
// is re-exported here for callers that predate the move.
export { evalVerdictWord } from './steer/EvaluateSurface.js';

// ── The page ──────────────────────────────────────────────────────────────────────────────────

export function TestingPage({ page, campaignId, runs, navigate, launchIntent = null, projectId = null }: {
  page: TestingSubPage;
  /** Non-null only on `/testing/campaigns/:id` — renders that campaign's scoreboard. */
  campaignId: string | null;
  /** The board's live run list — the campaign landing + scoreboard read live status from it. */
  runs: SessionView[];
  navigate: Navigate;
  /** The landing's `?new=` arrival intent (`readLaunchIntent(search)`) — opens that launch panel. */
  launchIntent?: LaunchIntent | null;
  /** S16a-4f: the landing's `?project=` — the project a new test's launch panel preselects. */
  projectId?: string | null;
}): React.ReactElement {
  return (
    <div data-testid="testing-page" data-testing-page={page} className="flex flex-col">
      {/* Each sub-page owns its PageFrame (UI-CONTRACT §4.6): the landing and the scoreboard carry
          their own title and actions; Evals is framed here. */}
      {page === 'campaigns' ? (
        campaignId !== null ? (
          <CampaignScoreboard campaignId={campaignId} runs={runs} navigate={navigate} />
        ) : (
          <CampaignsPage runs={runs} navigate={navigate} launchIntent={launchIntent} projectId={projectId} />
        )
      ) : (
        // Evals is hosted by the Desk's Evaluate tab, which names it; no page title of its own.
        <EvaluateSurface navigate={navigate} runs={runs} />
      )}
    </div>
  );
}
