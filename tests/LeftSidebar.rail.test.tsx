import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import { makeView } from './factories.js';

/**
 * The nine-path accordion rail (DES-FEEDBACK-003 §2/§3; nav-reorg): Projects / Execute / Vibe /
 * Demo / Evals / Chat / Repositories / Steering / Settings heading rows, a strict ONE-OPEN
 * accordion (EC26), route-aware default expansion (§3.2), ▦/＋ heading icons.
 *
 * The nav-reorg promoted each of Make's three forks (build|document|video) to a top-level path —
 * Execute ← build, Vibe ← document, Demo ← video — each reusing the Make/Chat rail grammar; moved
 * Steering's Dashboard from a sub-row to the heading's ▦; and made the former Test section into
 * Evals, a normal section whose list is the eval runner (campaigns moved into the project shell).
 *
 * The board model is mocked: the rail's contract is "render what the model ordered, verbatim" —
 * the ordering arithmetic itself is pinned in boardAttention.test.ts / boardModel.test.ts.
 */

let boardItems: BoardProject[] = [];
const listRepos = vi.fn(() => Promise.resolve({ repos: [] }));

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: boardItems, unfiled: [], loading: false, error: null }),
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.2.0', ping: 'pong' }),
    listRepos: () => listRepos(),
  },
}));

const { LeftSidebar, headingForPath } = await import('../src/components/LeftSidebar.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { RunLink } = await import('../src/components/RunLink.js');

function bp(id: string, attention: BoardProject['attention'], score: number): BoardProject {
  return {
    project: {
      id, name: id, description: null, status: 'active',
      scope: `project:${id}`, created_at: 1, updated_at: 1,
    },
    repo: null, runs: [], docs: [], attachedAt: {}, attention, score,
    band: score >= 20 ? 'needs-you' : 'quiet', signal: null,
  };
}

/** The W2 top of the board, already model-ordered, plus quiet tail. */
const W2_ORDERED = [
  bp('q3-review-deck', 'gate', 100),
  bp('api-migration', 'gate', 100),
  bp('auth-refactor', 'failing', 67),
  bp('upload-endpoint', 'running', 40),
  bp('notes', 'drafts', 12),
  bp('smoke-tests', 'quiet', 8),
  bp('scratch', 'quiet', 0),
];

const HEADING_KEYS = ['projects', 'execute', 'test', 'vibe', 'demo', 'chat', 'repos', 'steering', 'testing', 'settings'] as const;

function rail(props: Partial<{ pathname: string; navigate: (p: string) => void; runs: ReturnType<typeof makeView>[] }> = {}): ReturnType<typeof render> {
  return render(
    <LeftSidebar
      runs={props.runs ?? []}
      navigate={props.navigate ?? (() => {})}
      pathname={props.pathname ?? '/'}
    />,
  );
}

function expandedKeys(): string[] {
  return HEADING_KEYS.filter(
    (k) => screen.getByTestId(`rail-heading-${k}`).getAttribute('aria-expanded') === 'true',
  );
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  boardItems = W2_ORDERED;
  listRepos.mockClear();
  clearRepoCache();
});

describe('the route→heading map (§3.2)', () => {
  it('maps every territory to its heading, and / and /runs* to none', () => {
    expect(headingForPath('/projects')).toBe('projects');
    expect(headingForPath('/p/abc/build')).toBe('projects');
    expect(headingForPath('/p/abc')).toBe('projects');
    // Execute / Vibe / Demo (nav-reorg); the retired /make maps to Execute for the
    // pre-redirect tick.
    expect(headingForPath('/execute')).toBe('execute');
    expect(headingForPath('/make')).toBe('execute');
    expect(headingForPath('/vibe')).toBe('vibe');
    expect(headingForPath('/demo')).toBe('demo');
    expect(headingForPath('/chats')).toBe('chat');
    expect(headingForPath('/chat/new')).toBe('chat');
    expect(headingForPath('/repos')).toBe('repos');
    expect(headingForPath('/repos/new')).toBe('repos');
    expect(headingForPath('/repo-detail/r1')).toBe('repos');
    // /coverage and /domain are RETIRED (they redirect to /system) but stay mapped so the
    // rail never flashes headless on the pre-redirect tick.
    for (const p of ['/system', '/theme', '/coverage', '/domain', '/workflows']) {
      expect(headingForPath(p)).toBe('settings');
    }
    // Steering owns its sub-sections AND the retired /wiki + /rules + /policies panels AND the
    // retired standalone /proposals queue. The seven types are a `?type=` filter under
    // /steering/policies now, so a legacy /steering/:type still maps here too.
    for (const p of ['/steering', '/steering/policies', '/steering/memories', '/steering/security', '/wiki', '/rules', '/policies', '/proposals']) {
      expect(headingForPath(p)).toBe('steering');
    }
    // The /testing surface splits: Test owns campaigns/recon (+ the retired flat /campaigns
    // addresses), Evals (key stays `testing`) owns the eval runner + bare /testing + the retired harness.
    for (const p of ['/testing/campaigns', '/testing/campaigns/c-1', '/campaigns', '/campaigns/c-1']) {
      expect(headingForPath(p)).toBe('test');
    }
    for (const p of ['/testing', '/testing/harness', '/testing/evals']) {
      expect(headingForPath(p)).toBe('testing');
    }
    expect(headingForPath('/')).toBeNull();
    expect(headingForPath('/runs')).toBeNull();
    expect(headingForPath('/runs/r-1')).toBeNull();
  });
});

describe('the ten heading rows (§3.1 + nav-reorg + usability wave)', () => {
  it('renders all ten headings; Settings is icon-less, Steering carries ▦ only, the rest carry ▦ and ＋', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    for (const k of HEADING_KEYS) {
      expect(screen.getByTestId(`rail-heading-${k}`)).toBeInTheDocument();
    }
    // The standalone Proposals heading retired — proposals live inside Steering's sub-sections.
    expect(screen.queryByTestId('rail-heading-proposals')).toBeNull();
    // Settings: no ▦, no ＋ (the operator's word).
    {
      const h = screen.getByTestId('rail-heading-settings');
      expect(within(h).queryByTestId('heading-dashboard')).toBeNull();
      expect(within(h).queryByTestId('heading-new')).toBeNull();
    }
    // Steering: ▦ (the nav-reorg moved the Dashboard onto the heading), but NO ＋.
    {
      const h = screen.getByTestId('rail-heading-steering');
      expect(within(h).getByTestId('heading-dashboard')).toBeInTheDocument();
      expect(within(h).queryByTestId('heading-new')).toBeNull();
    }
    // Every other heading carries both ▦ and ＋ — including Test and Evals.
    for (const k of ['projects', 'execute', 'test', 'vibe', 'demo', 'testing', 'chat', 'repos']) {
      const h = screen.getByTestId(`rail-heading-${k}`);
      expect(within(h).getByTestId('heading-dashboard')).toBeInTheDocument();
      expect(within(h).getByTestId('heading-new')).toBeInTheDocument();
    }
  });

  it('order: Projects → Execute → Test → Vibe → Demo → Chat → Repos ┃ Steering → Evals ┃ Settings', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    const el = (k: string): HTMLElement => screen.getByTestId(`rail-heading-${k}`);
    // Dividers now sit between the work sections, Steering/Evals and Settings, so check DOCUMENT
    // order (compareDocumentPosition) rather than nextElementSibling — Test below Execute, Evals
    // beside Steering.
    const order = ['projects', 'execute', 'test', 'vibe', 'demo', 'chat', 'repos', 'steering', 'testing', 'settings'];
    for (let i = 0; i < order.length - 1; i += 1) {
      const rel = el(order[i]!).compareDocumentPosition(el(order[i + 1]!));
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Evals sits AFTER Steering (moved there), and Test sits AFTER Execute.
    expect(el('steering').compareDocumentPosition(el('testing')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el('execute').compareDocumentPosition(el('test')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the promoted headings are labelled Execute / Vibe / Demo, and the Test section is labelled Evals', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(within(screen.getByTestId('rail-heading-execute')).getByTestId('rail-title-execute')).toHaveTextContent('Execute');
    expect(within(screen.getByTestId('rail-heading-vibe')).getByTestId('rail-title-vibe')).toHaveTextContent('Vibe');
    expect(within(screen.getByTestId('rail-heading-demo')).getByTestId('rail-title-demo')).toHaveTextContent('Demo');
    const evals = within(screen.getByTestId('rail-heading-testing')).getByTestId('rail-title-testing');
    expect(evals).toHaveTextContent('Evals');
    expect(evals).not.toHaveTextContent('Test');
    // No "Make" anywhere on the rail.
    expect(screen.queryByTestId('rail-heading-make')).toBeNull();
  });

  it('▦ icons are real links to the dashboard routes', async () => {
    const navigate = vi.fn();
    rail({ navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const hrefOf = (k: string): string | null =>
      within(screen.getByTestId(`rail-heading-${k}`))
        .getByTestId('heading-dashboard').getAttribute('href');
    expect(hrefOf('projects')).toBe('/projects');
    expect(hrefOf('execute')).toBe('/execute');
    expect(hrefOf('vibe')).toBe('/vibe');
    expect(hrefOf('demo')).toBe('/demo');
    expect(hrefOf('testing')).toBe('/testing/evals');
    expect(hrefOf('chat')).toBe('/chats');
    expect(hrefOf('repos')).toBe('/repos');
    expect(hrefOf('steering')).toBe('/steering/dashboard');

    fireEvent.click(within(screen.getByTestId('rail-heading-execute')).getByTestId('heading-dashboard'));
    expect(navigate).toHaveBeenCalledWith('/execute');
    // The ▦ never toggles expansion (§3.1).
    expect(expandedKeys()).toEqual([]);
  });

  it('the slice-A zones are GONE (§8.1)', async () => {
    rail({ runs: [makeView({ id: 'r-live', status: 'executing' })] });
    await screen.findByRole('button', { name: 'wicked-studio' });

    expect(screen.queryByTestId('rail-quick')).toBeNull();
    expect(screen.queryByTestId('rail-actions')).toBeNull();
    expect(screen.queryByTestId('rail-runs')).toBeNull();
    expect(screen.queryByTestId('rail-settings-section')).toBeNull();
    expect(screen.queryByText('QUICK')).toBeNull();
  });

  it('keeps the NotificationBell in its slot below the chrome (§6.1 — untouched)', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});

describe('the one-open accordion (§3.2, EC26)', () => {
  it('at most one heading is expanded; expanding one collapses the other', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual([]); // landing on / — the calm frame

    fireEvent.click(screen.getByTestId('rail-title-execute'));
    expect(expandedKeys()).toEqual(['execute']);

    fireEvent.click(screen.getByTestId('rail-title-projects'));
    expect(expandedKeys()).toEqual(['projects']);

    // Again-click collapses — zero open is legal.
    fireEvent.click(screen.getByTestId('rail-title-projects'));
    expect(expandedKeys()).toEqual([]);
  });

  it('derives the default from the route: /p/* expands Projects, / expands none, /vibe expands Vibe', async () => {
    rail({ pathname: '/p/abc/build' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual(['projects']);
    cleanup();

    rail({ pathname: '/' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual([]);
    cleanup();

    rail({ pathname: '/vibe' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual(['vibe']);
  });

  it('respects a manual collapse within one territory; re-fires on a territory change (§3.2)', async () => {
    const view = rail({ pathname: '/p/abc/build' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual(['projects']);

    fireEvent.click(screen.getByTestId('rail-title-projects'));
    expect(expandedKeys()).toEqual([]);
    view.rerender(<LeftSidebar runs={[]} navigate={() => {}} pathname="/p/abc/chat" />);
    expect(expandedKeys()).toEqual([]);

    view.rerender(<LeftSidebar runs={[]} navigate={() => {}} pathname="/repos" />);
    expect(expandedKeys()).toEqual(['repos']);
  });
});

describe('the ＋ create actions (§2.1/§3.4)', () => {
  it('Projects ＋ opens the new-project modal', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    expect(screen.queryByTestId('new-project-modal')).toBeNull();
    fireEvent.click(within(screen.getByTestId('rail-heading-projects')).getByTestId('heading-new'));
    expect(screen.getByTestId('new-project-modal')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('new-project-modal')).toBeNull();
  });

  it('Execute ＋ launches a build run directly; Chat ＋ / Repos ＋ / Evals ＋ navigate to their routes', async () => {
    const navigate = vi.fn();
    rail({ navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(within(screen.getByTestId('rail-heading-execute')).getByTestId('heading-new'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    fireEvent.click(within(screen.getByTestId('rail-heading-chat')).getByTestId('heading-new'));
    expect(navigate).toHaveBeenCalledWith('/chat/new');
    fireEvent.click(within(screen.getByTestId('rail-heading-repos')).getByTestId('heading-new'));
    expect(navigate).toHaveBeenCalledWith('/repos/new');
    fireEvent.click(within(screen.getByTestId('rail-heading-testing')).getByTestId('heading-new'));
    expect(navigate).toHaveBeenCalledWith('/testing/evals');
  });

  it('Vibe ＋ opens a project-picker locked to Document; Demo ＋ one locked to Video', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(within(screen.getByTestId('rail-heading-vibe')).getByTestId('heading-new'));
    const vibePicker = screen.getByTestId('project-mode-picker');
    expect(vibePicker.dataset.mode).toBe('document');
    expect(screen.getByTestId('project-mode-picker-stage')).toBeInTheDocument();
    expect(screen.getByTestId('project-switcher')).toBeInTheDocument();
    // Re-clicking ＋ toggles it closed.
    fireEvent.click(within(screen.getByTestId('rail-heading-vibe')).getByTestId('heading-new'));
    expect(screen.queryByTestId('project-mode-picker')).toBeNull();

    fireEvent.click(within(screen.getByTestId('rail-heading-demo')).getByTestId('heading-new'));
    expect(screen.getByTestId('project-mode-picker').dataset.mode).toBe('video');
  });

  it('opening one picker closes the other — never two at once (copilot #197)', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    // Open Vibe's picker…
    fireEvent.click(within(screen.getByTestId('rail-heading-vibe')).getByTestId('heading-new'));
    expect(screen.getByTestId('project-mode-picker').dataset.mode).toBe('document');

    // …then open Demo's. Vibe's must close: exactly ONE picker is mounted, locked to Video.
    fireEvent.click(within(screen.getByTestId('rail-heading-demo')).getByTestId('heading-new'));
    const pickers = screen.getAllByTestId('project-mode-picker');
    expect(pickers).toHaveLength(1);
    expect(pickers[0]!.dataset.mode).toBe('video');
  });
});

describe('accordion contents (§3.3)', () => {
  it('Projects: the board model verbatim, capped at 6, with a view-all link sharing the ▦ target', async () => {
    rail({ pathname: '/projects' });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const section = screen.getByTestId('rail-heading-projects');
    const rows = within(section).getAllByTestId('rail-project');
    expect(rows.map((r) => r.dataset.projectId)).toEqual([
      'q3-review-deck', 'api-migration', 'auth-refactor', 'upload-endpoint', 'notes', 'smoke-tests',
    ]);
    expect(within(section).getByTestId('rail-view-all')).toHaveAttribute('href', '/projects');
  });

  it('partitions runs: a workflow-less run is a CHAT, never double-listed under Execute', async () => {
    const runs = [
      makeView({ id: 'r-build', workflow_id: 'wf-1', problem: 'ship the thing', status: 'executing' }),
      makeView({ id: 'r-chat', workflow_id: 'chat', problem: 'talk it over', status: 'executing' }),
      makeView({ id: 'r-legacy', workflow_id: undefined as unknown as string, problem: 'old chat', status: 'completed' }),
    ];
    rail({ runs, pathname: '/execute' });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const exec = screen.getByTestId('rail-heading-execute');
    const execIds = within(exec).getAllByTestId('rail-run').map((r) => r.dataset.runId);
    expect(execIds).toEqual(['r-build']);

    fireEvent.click(screen.getByTestId('rail-title-chat'));
    const chat = screen.getByTestId('rail-heading-chat');
    const chatIds = within(chat).getAllByTestId('rail-run').map((r) => r.dataset.runId);
    expect(chatIds).toEqual(['r-chat', 'r-legacy']); // active before terminal
  });

  it('an Execute run row navigates via runPath; no `+` glyph rides inside accordion contents', async () => {
    const navigate = vi.fn();
    render(
      <LeftSidebar
        runs={[makeView({ id: 'r-1', workflow_id: 'wf-1', status: 'executing' })]}
        navigate={navigate}
        pathname="/execute"
        runPath={(id) => `/p/abc/build/${id}`}
      />,
    );
    await screen.findByRole('button', { name: 'wicked-studio' });

    const exec = screen.getByTestId('rail-heading-execute');
    fireEvent.click(within(exec).getByTestId('rail-run'));
    expect(navigate).toHaveBeenCalledWith('/p/abc/build/r-1');
    const contents = within(exec).getByTestId('rail-run').parentElement!;
    expect(contents.textContent).not.toContain('+');
  });

  it('Vibe/Demo empty states say documents / demos, not "made"', async () => {
    rail({ pathname: '/vibe' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(within(screen.getByTestId('rail-heading-vibe')).getByText('No documents yet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rail-title-demo'));
    expect(within(screen.getByTestId('rail-heading-demo')).getByText('No demos yet')).toBeInTheDocument();
  });

  it('Repositories: fetch on EXPAND only, once per session — the 5s poll is retired (§3.3)', async () => {
    vi.useFakeTimers();
    try {
      rail();
      expect(listRepos).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
      expect(listRepos).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('rail-title-repos'));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(listRepos).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('rail-title-repos'));
      fireEvent.click(screen.getByTestId('rail-title-repos'));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(listRepos).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Settings expands to the slice-A shortcut rows (menuitems + version line)', async () => {
    rail({ pathname: '/system' });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const settings = screen.getByTestId('rail-heading-settings');
    expect(settings.getAttribute('aria-expanded')).toBe('true');
    expect(within(settings).getAllByRole('menuitem')).toHaveLength(3);
    expect(within(settings).getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
  });

  it('Steering expands to the TWO management sub-section rows (Policies / Memories); Dashboard moved to the ▦', async () => {
    const navigate = vi.fn();
    rail({ pathname: '/steering/policies', navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const steering = screen.getByTestId('rail-heading-steering');
    expect(steering.getAttribute('aria-expanded')).toBe('true');
    const rows = within(steering).getAllByTestId('rail-steering-section');
    expect(rows.map((r) => r.dataset.section)).toEqual(['policies', 'memories']);
    expect(rows[0]).toHaveTextContent('Policies');
    expect(rows[1]).toHaveTextContent('Memories');
    // The Dashboard is no longer a sub-row — it is the heading's ▦.
    expect(rows.map((r) => r.dataset.section)).not.toContain('dashboard');
    expect(within(steering).getByTestId('heading-dashboard')).toHaveAttribute('href', '/steering/dashboard');

    fireEvent.click(rows[1]!);
    expect(navigate).toHaveBeenCalledWith('/steering/memories');
  });

  it('Evals expands to the "Run evals" shortcut row, navigating to the runner; the route expands it', async () => {
    const navigate = vi.fn();
    rail({ pathname: '/testing/evals', navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const testing = screen.getByTestId('rail-heading-testing');
    expect(testing.getAttribute('aria-expanded')).toBe('true');
    // Campaigns is no longer a rail sub-page (it moved into the project shell).
    expect(within(testing).queryByTestId('rail-testing-page')).toBeNull();
    const run = within(testing).getByTestId('rail-evals-run');
    fireEvent.click(run);
    expect(navigate).toHaveBeenCalledWith('/testing/evals');
  });
});

describe('the collapsed rail (§3.2)', () => {
  it('shows exactly ten glyph links (Evals → its runner, Steering → its Dashboard, Settings → /system)', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const glyphs = screen.getAllByTestId('rail-collapsed-glyph');
    expect(glyphs).toHaveLength(10);
    expect(glyphs.map((g) => g.getAttribute('href'))).toEqual([
      '/projects', '/execute', '/testing/campaigns', '/vibe', '/demo', '/chats', '/repos', '/steering/dashboard', '/testing/evals', '/system',
    ]);
    expect(screen.queryByTestId('rail-heading-projects')).toBeNull();
  });
});

describe('run items name their mode (F4: no more identical truncated items)', () => {
  it('a chat run and a work run are distinguishable by spine word + glyph', () => {
    const chat = makeView({ id: 'r-chat', problem: 'talk about the thing', workflow_id: 'chat' });
    const work = makeView({ id: 'r-work', problem: 'work on the thing', workflow_id: 'wf-1' });
    render(
      <>
        <RunLink view={chat} selectedRunId={null} onSelect={() => {}} />
        <RunLink view={work} selectedRunId={null} onSelect={() => {}} />
      </>,
    );

    const links = screen.getAllByTestId('run-link');
    expect(links.map((l) => l.dataset.kind)).toEqual(['chat', 'build']);
    expect(links[0]!.textContent).toContain('Chat ·');
    expect(links[1]!.textContent).toContain('Build ·');
    expect(links[0]!.textContent).toContain('💬');
    expect(links[1]!.textContent).toContain('⚙');
  });
});
