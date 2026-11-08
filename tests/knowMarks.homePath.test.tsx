// What we know (round 10): a code-graph finding's message is the engine's own words and names a path under the
// operator's home directory (desk_home_paths, the fixture's core#406 finding). The marks on Repositories and the
// repository page, and Understand's graph links, carry that sentence in their title and accessible name, so both
// go through the default layer's formatter: `~/…`, technical details on or off (studio#458; e2e-1105 privacy).
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeMarks, kindsRead } from '../src/board/repoKnowledge.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';
import { useCapabilities } from '../src/store/capabilities.js';

// The fixture's core#406 finding (e2e/uxfix_fixture.py REPO_FINDING_NO_LIVE) under the fake home.
const HOME_FINDING = {
  code: 'in_tree_code_graph_ignored',
  message: '/Users/reel-operator/w2/studio-api/.codegraph exists in the checkout — a code graph an older wicked-core '
    + 'indexed IN the working tree. It is ignored (no graph has been indexed under the state home yet — re-run onboarding '
    + '(POST /repos/studio-api/onboard) to build the graph; never inside the repository).',
  path: '/Users/reel-operator/w2/studio-api/.codegraph',
};

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  kinds: vi.fn(),
  reqs: vi.fn(),
}));
vi.mock('../src/api/client.js', () => ({
  api: {
    getChatMessages: vi.fn(() => Promise.resolve({ messages: [] })),
    listRepos: mocks.listRepos,
    listProjectMembers: vi.fn(() => Promise.resolve({ members: [] })),
    listChatHistory: vi.fn(() => Promise.resolve({ chats: [], items: [] })),
    getGraphKindsForRepo: mocks.kinds,
    listRequirements: mocks.reqs,
  },
  apiBase: () => '/api/v1',
}));
vi.mock('../src/components/CoverageView.js', () => ({ CoverageView: () => <div /> }));
vi.mock('../src/components/RepoGraphModal.js', () => ({ RepoGraphModal: () => <div /> }));
vi.mock('../src/components/chat/PageChat.js', async (orig) => ({
  ...(await orig<object>()),
  PageChat: () => <div data-testid="page-chat-stub" />,
}));

const { KnowMarks } = await import('../src/components/RepoKnowledge.js');
const { UnderstandPage } = await import('../src/components/desk/UnderstandPage.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const technical = (on: boolean): void => useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: on } }));
const repo = { id: 'studio-api', name: 'studio-api', findings: [HOME_FINDING] };
const marks = () => knowledgeMarks(repo as never, [], { kinds: kindsRead([{ kind: 'File', count: 3 }]), reqs: { state: 'failed' } }, NOW);

beforeEach(() => {
  technical(false);
  localStorage.clear();
  sessionStorage.clear();
  clearRepoCache();
  resetRepoKnowledge();
  useCapabilities.setState({ chatList: true, loaded: true });
  mocks.listRepos.mockReset();
  mocks.listRepos.mockResolvedValue({ repos: [{ ...repo, root_path: '/Users/reel-operator/w2/studio-api', default_branch: 'main', registered_at: 1 }] });
  mocks.kinds.mockReset();
  mocks.kinds.mockResolvedValue({ kinds: [{ kind: 'File', count: 3 }] });
  mocks.reqs.mockReset();
  mocks.reqs.mockRejectedValue(new Error('no requirements'));
});
afterEach(() => { cleanup(); technical(false); });

describe('what we know: no home directory in a mark’s title or name', () => {
  it('the model keeps the engine’s words (the formatter is the view’s)', () => {
    expect(marks().find((m) => m.id === 'code')!.title).toContain('/Users/reel-operator/');
  });

  it('Repositories and the repository page: the code mark reads ~/…, technical details on or off (e2e-1105 privacy)', () => {
    const { unmount } = render(<KnowMarks marks={marks()} onOpen={vi.fn()} repoName="studio-api" />);
    const code = screen.getAllByTestId('repo-know-mark').find((el) => el.getAttribute('data-mark') === 'code')!;
    expect(code.getAttribute('title')).toContain('~/w2/studio-api/.codegraph');
    expect(code.getAttribute('aria-label')).toContain('~/w2/studio-api/.codegraph');
    for (const el of screen.getAllByTestId('repo-know-mark')) {
      expect(el.getAttribute('title') ?? '').not.toContain('/Users/');
      expect(el.getAttribute('aria-label') ?? '').not.toContain('/Users/');
    }
    unmount();
    technical(true);
    render(<KnowMarks marks={marks()} onOpen={vi.fn()} repoName="studio-api" />);
    const full = screen.getAllByTestId('repo-know-mark').find((el) => el.getAttribute('data-mark') === 'code')!;
    expect(full.getAttribute('title')).toContain('~/w2/studio-api/.codegraph');
    expect(full.getAttribute('title')).not.toContain('/Users/');
  });

  it('Understand’s graph links: the code graph button reads ~/… in its title and name', async () => {
    await act(async () => { render(<UnderstandPage project={null} navigate={vi.fn()} now={NOW} compare={null} />); });
    const row = (await screen.findAllByTestId('understand-graph-repo'))[0]!;
    await vi.waitFor(() => expect(within(row).getByTestId('understand-graph-open')).toHaveAttribute('data-tone', 'fail'));
    const btn = within(row).getByTestId('understand-graph-open');
    expect(btn.getAttribute('title')).toContain('~/w2/studio-api/.codegraph');
    expect(btn.getAttribute('aria-label')).toContain('~/w2/studio-api/.codegraph');
    for (const el of [btn, within(row).getByTestId('understand-graph-req')]) {
      expect(el.getAttribute('title') ?? '').not.toContain('/Users/');
      expect(el.getAttribute('aria-label') ?? '').not.toContain('/Users/');
    }
  });
});
