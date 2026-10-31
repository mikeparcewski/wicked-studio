import { PageFrame, Tabs } from '../ui/index.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { LEARN_PATH } from '../../board/navModel.js';
import { StyleTab } from './StyleTab.js';
import { RulesTab } from './RulesTab.js';
import { PersonaTab } from './PersonaTab.js';
import { BrandTab } from './BrandTab.js';
import { useEffect, useRef } from 'react';
import { PageAskButton, pageTextLines, usePageChatHostPage } from '../chat/PageChat.js';
import { SETUP_ASKS } from '../../board/learnHub.js';
import { useFirstRun } from '../../store/firstRun.js';

/**
 * LEARN (`/learn`, program DES-LEARN §3; the operator-approved mockup learn-and-panels state c): teach studio
 * how you and your team work. Four tabs, each a live object rather than a form:
 *
 *   Style        team docs, showcase repos, writing and topics to follow → memories and rules, as a visible
 *                pipeline (Read → Spot patterns → Draft → You decide) ending in two pick-several asks
 *   Rules        the steering rules you care about: starters to pick, and Steering's own ways in
 *   Personality  how your orchestrator talks to you, with a live preview; one for you, overridable per project
 *   Brand        learn colours from your site (moved here from Settings → Theme)
 *
 * Everything learned arrives as a suggestion; nothing is kept until the person accepts it. The tab and the
 * personality's project ride the address (`?tab=`, `&project=`), so a project's ⋯ → Personality opens it.
 */
export type LearnTabId = 'style' | 'rules' | 'personality' | 'brand';
const TABS: readonly { id: LearnTabId; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'rules', label: 'Rules' },
  { id: 'personality', label: 'Personality' },
  { id: 'brand', label: 'Brand' },
];

export function learnTabOf(search: string): LearnTabId {
  const t = new URLSearchParams(search).get('tab');
  return TABS.find((x) => x.id === t)?.id ?? 'style';
}

/** The Learn address for a tab (and, for Personality, a project's override). */
export function learnPath(tab: LearnTabId = 'style', project?: string | null): string {
  const q = new URLSearchParams();
  if (tab !== 'style') q.set('tab', tab);
  if (project !== undefined && project !== null && project !== '') q.set('project', project);
  const s = q.toString();
  return s === '' ? LEARN_PATH : `${LEARN_PATH}?${s}`;
}

export function LearnHub({ navigate, search }: { navigate: Navigate; search: string }): React.ReactElement {
  const tab = learnTabOf(search);
  const project = new URLSearchParams(search).get('project');
  // First run's "Use your site's colours?" opens Brand on the site it read from the git email (preview first).
  const url = new URLSearchParams(search).get('url');
  const brandUrl = url !== null && /^https:\/\/[a-z0-9.-]+$/iu.test(url) ? url : undefined;
  // DES-LEARN §6.2: the page's chat (ui-v3-chat) knows the Learn tab in view and reads what the page shows.
  const pageRef = useRef<HTMLDivElement | null>(null);
  usePageChatHostPage('learn', {
    knows: `Knows Learn: the ${TABS.find((x) => x.id === tab)?.label ?? 'Style'} tab.`,
    data: () => pageTextLines(pageRef.current),
  });
  return (
    <div className="flex-1 overflow-auto" data-testid="learn-hub" ref={pageRef}>
      <PageFrame title="Learn" intro="Teach studio how you and your team work. Everything it learns arrives as a suggestion; nothing is kept until you accept it."
        actions={<PageAskButton kind="learn" testId="learn-page-ask" small />}>
        <SetupResume navigate={navigate} />
        <div className="wk-learn-tabs">
          <Tabs tabs={TABS} active={tab} onChange={(id) => navigate(learnPath(id as LearnTabId, id === 'personality' ? project : null))}
            aria-label="Learn" idBase="learn" data-testid="learn-tabs" tabTestId="learn-tab" maxVisible={4} />
        </div>
        <div id="learn-panel" role="tabpanel" aria-labelledby={`learn-tab-${tab}`} data-testid={`learn-panel-${tab}`}>
          {tab === 'style' && <StyleTab navigate={navigate} />}
          {tab === 'rules' && <RulesTab navigate={navigate} />}
          {tab === 'personality' && <PersonaTab navigate={navigate} project={project} />}
          {tab === 'brand' && <BrandTab navigate={navigate} {...(brandUrl !== undefined ? { initialUrl: brandUrl } : {})} />}
        </div>
      </PageFrame>
    </div>
  );
}

/** §4.4: setup ignored or unfinished is picked up here: one line, back to Home's guided flow. */
function SetupResume({ navigate }: { navigate: Navigate }): React.ReactElement | null {
  const fr = useFirstRun((st) => st.state);
  const read = useFirstRun((st) => st.read);
  useEffect(() => { if (read === 'idle') void useFirstRun.getState().load(); }, [read]);
  if (read !== 'ok' || fr.completedAt !== undefined) return null;
  const answered = SETUP_ASKS.filter((k) => fr.answers?.[k] !== undefined).length;
  return (
    <p className="wk-learn-resume" data-testid="learn-setup-resume">
      {answered === 0 ? 'Set studio up the way you work: six quick questions.' : `Setup: ${answered} of ${SETUP_ASKS.length} answered.`}{' '}
      <a className="wk-link" href="/?setup=1" data-testid="learn-setup-resume-link" onClick={(e) => { e.preventDefault(); navigate('/?setup=1'); }}>
        {answered === 0 ? 'Start' : 'Pick up where you left off'}
      </a>
    </p>
  );
}
