import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import { makeView } from './factories.js';

/**
 * The six-path accordion rail (DES-FEEDBACK-003 §2/§3, slice M; Steering added
 * by the STEERING program): Projects / Make / Chat / Repositories / Steering /
 * Settings heading rows, a strict ONE-OPEN accordion (EC26), route-aware
 * default expansion (§3.2), ▦/＋ heading icons (Steering and Settings
 * icon-less — the operator's word), and the slice-A rail zones
 * (QUICK, inline runs, standalone taxonomies, bottom settings section) GONE
 * (§8.1). The repo 5s poll is retired: fetch-on-expand through the session
 * cache shared with the palette (§3.3).
 *
 * The board model is mocked: the rail's contract is "render what the model
 * ordered, verbatim" — the ordering arithmetic itself is pinned in
 * boardAttention.test.ts / boardModel.test.ts.
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

const HEADING_KEYS = ['projects', 'make', 'chat', 'repos', 'testing', 'steering', 'settings'] as const;

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
    expect(headingForPath('/make')).toBe('make');
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
    // Steering owns its routes AND the retired /wiki + /rules addresses (they
    // redirect to /steering — the rail must not flash Settings
    // open on the pre-redirect tick).
    // /policies retired into Steering (policies merged into steering rules) — same contract.
    for (const p of ['/steering', '/steering/architecture', '/steering/security', '/wiki', '/rules', '/policies']) {
      expect(headingForPath(p)).toBe('steering');
    }
    // Testing owns its routes AND the retired flat /campaigns addresses (they
    // redirect to /testing/campaigns — same pre-redirect-tick contract).
    for (const p of ['/testing/harness', '/testing/evals', '/testing/campaigns', '/testing/campaigns/c-1', '/campaigns', '/campaigns/c-1']) {
      expect(headingForPath(p)).toBe('testing');
    }
    expect(headingForPath('/')).toBeNull();
    expect(headingForPath('/runs')).toBeNull();
    expect(headingForPath('/runs/r-1')).toBeNull();
  });
});

describe('the seven heading rows (§3.1 + STEERING + the testing wave)', () => {
  it('renders all seven headings; Testing, Steering and Settings are icon-less, the other four carry ▦ and ＋', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    for (const k of HEADING_KEYS) {
      expect(screen.getByTestId(`rail-heading-${k}`)).toBeInTheDocument();
    }
    for (const k of ['testing', 'steering', 'settings']) {
      const h = screen.getByTestId(`rail-heading-${k}`);
      expect(within(h).queryByTestId('heading-dashboard')).toBeNull();
      expect(within(h).queryByTestId('heading-new')).toBeNull();
    }
    for (const k of ['projects', 'make', 'chat', 'repos']) {
      const h = screen.getByTestId(`rail-heading-${k}`);
      expect(within(h).getByTestId('heading-dashboard')).toBeInTheDocument();
      expect(within(h).getByTestId('heading-new')).toBeInTheDocument();
    }
  });

  it('Testing sits immediately BEFORE Steering, which sits immediately BEFORE Settings (the placement contract)', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    const testing = screen.getByTestId('rail-heading-testing');
    const steering = screen.getByTestId('rail-heading-steering');
    const settings = screen.getByTestId('rail-heading-settings');
    // Same container, adjacent, testing → steering → settings — DOM-order assertions, not style ones.
    expect(testing.compareDocumentPosition(steering) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(testing.nextElementSibling).toBe(steering);
    expect(steering.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(steering.nextElementSibling).toBe(settings);
  });

  it('▦ icons are real links to the §2.1 dashboard routes', async () => {
    const navigate = vi.fn();
    rail({ navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const hrefOf = (k: string): string | null =>
      within(screen.getByTestId(`rail-heading-${k}`))
        .getByTestId('heading-dashboard').getAttribute('href');
    expect(hrefOf('projects')).toBe('/projects');
    expect(hrefOf('make')).toBe('/make');
    expect(hrefOf('chat')).toBe('/chats');
    expect(hrefOf('repos')).toBe('/repos');

    fireEvent.click(within(screen.getByTestId('rail-heading-make')).getByTestId('heading-dashboard'));
    expect(navigate).toHaveBeenCalledWith('/make');
    // The ▦ never toggles expansion (§3.1).
    expect(expandedKeys()).toEqual([]);
  });

  it('the slice-A zones are GONE: no QUICK, no inline runs, no standalone taxonomies, no bottom settings section (§8.1)', async () => {
    rail({ runs: [makeView({ id: 'r-live', status: 'executing' })] });
    await screen.findByRole('button', { name: 'wicked-studio' });

    expect(screen.queryByTestId('rail-quick')).toBeNull();
    expect(screen.queryByTestId('rail-actions')).toBeNull();
    expect(screen.queryByTestId('rail-runs')).toBeNull();
    expect(screen.queryByTestId('rail-settings-section')).toBeNull();
    expect(screen.queryByTestId('rail-section-projects')).toBeNull();
    expect(screen.queryByTestId('rail-section-repos')).toBeNull();
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

    fireEvent.click(screen.getByTestId('rail-title-make'));
    expect(expandedKeys()).toEqual(['make']);

    fireEvent.click(screen.getByTestId('rail-title-projects'));
    expect(expandedKeys()).toEqual(['projects']);

    // Again-click collapses — zero open is legal.
    fireEvent.click(screen.getByTestId('rail-title-projects'));
    expect(expandedKeys()).toEqual([]);
  });

  it('derives the default from the route: /p/* expands Projects, / expands none, /chats expands Chat', async () => {
    rail({ pathname: '/p/abc/build' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual(['projects']);
    cleanup();

    rail({ pathname: '/' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual([]);
    cleanup();

    rail({ pathname: '/chats' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual(['chat']);
  });

  it('respects a manual collapse within one territory; re-fires on a territory change (§3.2)', async () => {
    const view = rail({ pathname: '/p/abc/build' });
    await screen.findByRole('button', { name: 'wicked-studio' });
    expect(expandedKeys()).toEqual(['projects']);

    // Manual collapse, then move between the SAME project's modes: stays collapsed.
    fireEvent.click(screen.getByTestId('rail-title-projects'));
    expect(expandedKeys()).toEqual([]);
    view.rerender(<LeftSidebar runs={[]} navigate={() => {}} pathname="/p/abc/chat" />);
    expect(expandedKeys()).toEqual([]);

    // A DIFFERENT heading's territory re-fires the map.
    view.rerender(<LeftSidebar runs={[]} navigate={() => {}} pathname="/repos" />);
    expect(expandedKeys()).toEqual(['repos']);
  });
});

describe('the ＋ create actions (§2.1/§3.4)', () => {
  it('Projects ＋ opens the new-project modal — the slice-A component unchanged', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    expect(screen.queryByTestId('new-project-modal')).toBeNull();
    fireEvent.click(within(screen.getByTestId('rail-heading-projects')).getByTestId('heading-new'));
    expect(screen.getByTestId('new-project-modal')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('new-project-modal')).toBeNull();
  });

  it('Chat ＋ and Repositories ＋ navigate to their existing create routes', async () => {
    const navigate = vi.fn();
    rail({ navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(within(screen.getByTestId('rail-heading-chat')).getByTestId('heading-new'));
    expect(navigate).toHaveBeenCalledWith('/chat/new');
    fireEvent.click(within(screen.getByTestId('rail-heading-repos')).getByTestId('heading-new'));
    expect(navigate).toHaveBeenCalledWith('/repos/new');
  });

  it('Make ＋ opens the three-way make-picker; Build routes to the unbound launch form', async () => {
    const navigate = vi.fn();
    rail({ navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(within(screen.getByTestId('rail-heading-make')).getByTestId('heading-new'));
    const picker = screen.getByTestId('make-picker');
    const rows = within(picker).getAllByTestId('make-picker-row');
    expect(rows.map((r) => r.dataset.mode)).toEqual(['build', 'document', 'video']);

    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    expect(screen.queryByTestId('make-picker')).toBeNull();
  });

  it('Make ＋ → Document goes through the project picker — a doc lives in a project (§3.4)', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(within(screen.getByTestId('rail-heading-make')).getByTestId('heading-new'));
    fireEvent.click(screen.getAllByTestId('make-picker-row')[1]!);
    expect(screen.getByTestId('make-picker-project-stage')).toBeInTheDocument();
    expect(screen.getByTestId('project-switcher')).toBeInTheDocument();
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

  it('partitions runs: a workflow-less run is a CHAT (ChatsPage predicate verbatim), never double-listed under Make', async () => {
    const runs = [
      makeView({ id: 'r-build', workflow_id: 'wf-1', problem: 'ship the thing', status: 'executing' }),
      makeView({ id: 'r-chat', workflow_id: 'chat', problem: 'talk it over', status: 'executing' }),
      makeView({ id: 'r-legacy', workflow_id: undefined as unknown as string, problem: 'old chat', status: 'completed' }),
    ];
    rail({ runs, pathname: '/make' });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const make = screen.getByTestId('rail-heading-make');
    const makeIds = within(make).getAllByTestId('rail-run').map((r) => r.dataset.runId);
    expect(makeIds).toEqual(['r-build']);

    fireEvent.click(screen.getByTestId('rail-title-chat'));
    const chat = screen.getByTestId('rail-heading-chat');
    const chatIds = within(chat).getAllByTestId('rail-run').map((r) => r.dataset.runId);
    expect(chatIds).toEqual(['r-chat', 'r-legacy']); // active before terminal
  });

  it('a Make run row navigates via runPath; no `+` glyph rides inside accordion contents (EC20 amended)', async () => {
    const navigate = vi.fn();
    render(
      <LeftSidebar
        runs={[makeView({ id: 'r-1', workflow_id: 'wf-1', status: 'executing' })]}
        navigate={navigate}
        pathname="/make"
        runPath={(id) => `/p/abc/build/${id}`}
      />,
    );
    await screen.findByRole('button', { name: 'wicked-studio' });

    const make = screen.getByTestId('rail-heading-make');
    fireEvent.click(within(make).getByTestId('rail-run'));
    expect(navigate).toHaveBeenCalledWith('/p/abc/build/r-1');
    // Accordion CONTENTS carry no `+` glyph — the ＋ lives at heading level only.
    const contents = within(make).getByTestId('rail-run').parentElement!;
    expect(contents.textContent).not.toContain('+');
  });

  it('Repositories: fetch on EXPAND only, once per session — the 5s poll is retired (§3.3)', async () => {
    vi.useFakeTimers();
    try {
      rail();
      expect(listRepos).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
      expect(listRepos).not.toHaveBeenCalled(); // no poll, no mount fetch

      fireEvent.click(screen.getByTestId('rail-title-repos'));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(listRepos).toHaveBeenCalledTimes(1);

      // Collapse and re-expand: the session cache is warm — no second GET.
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
    // 3 rows: Theme, Workflows, System — Rules and Arch Wiki retired into the
    // Steering heading (the STEERING program), and the steering-UX wave retired
    // Policies (→ /steering) plus the orphaned Coverage/Domain panels (→ /system).
    expect(within(settings).getAllByRole('menuitem')).toHaveLength(3);
    expect(within(settings).getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument();
  });

  it('Steering expands to the seven type rows, each navigating to its sub-page; the route expands it', async () => {
    const navigate = vi.fn();
    rail({ pathname: '/steering/security', navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const steering = screen.getByTestId('rail-heading-steering');
    expect(steering.getAttribute('aria-expanded')).toBe('true');
    const rows = within(steering).getAllByTestId('rail-steering-type');
    expect(rows.map((r) => r.dataset.type)).toEqual([
      'architecture', 'development', 'security', 'testing', 'operations', 'compliance', 'design-ux',
    ]);
    expect(rows[6]).toHaveTextContent('Design/UX');

    fireEvent.click(rows[3]!);
    expect(navigate).toHaveBeenCalledWith('/steering/testing');
  });

  it('Testing expands to the two page rows, each navigating to its sub-page; the route expands it', async () => {
    const navigate = vi.fn();
    rail({ pathname: '/testing/evals', navigate });
    await screen.findByRole('button', { name: 'wicked-studio' });

    const testing = screen.getByTestId('rail-heading-testing');
    expect(testing.getAttribute('aria-expanded')).toBe('true');
    const rows = within(testing).getAllByTestId('rail-testing-page');
    expect(rows.map((r) => r.dataset.page)).toEqual(['campaigns', 'evals']);
    expect(rows[0]).toHaveTextContent('Campaigns');

    fireEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith('/testing/campaigns');
  });
});

describe('the collapsed rail (§3.2)', () => {
  it('shows exactly seven glyph links (Testing → its Campaigns landing, Steering → its landing, Settings → /system)', async () => {
    rail();
    await screen.findByRole('button', { name: 'wicked-studio' });

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const glyphs = screen.getAllByTestId('rail-collapsed-glyph');
    expect(glyphs).toHaveLength(7);
    expect(glyphs.map((g) => g.getAttribute('href'))).toEqual([
      '/projects', '/make', '/chats', '/repos', '/testing/campaigns', '/steering', '/system',
    ]);
    // Accordions don't exist at this width.
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
