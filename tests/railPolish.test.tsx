import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BoardModel } from '../src/hooks/useBoardModel.js';
import { resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { useConnectionStore } from '../src/store/connection.js';
import { clearCachedRoster } from '../src/store/rosterCache.js';
import { resetSystemStore } from '../src/store/systemSnapshot.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';
import { makeView } from './factories.js';

/**
 * THE SLICK-DESIGN RAIL POLISH (studio's left-nav redesign): (1) the "+ Start something" row is
 * gone — the composer is the start; (2) "Additional settings" is a real control with a lucide
 * chevron (text first); (3) Nerve Center (DES-SYSTEM-VIEW) is ONE tile pinned last in the rail,
 * filled by its state, replacing the Health link and the Watchtower pill — its dashboard carries the
 * old `/health` cards; (4) the foot's own top border is the separator above Product, not a
 * spacer element; (5) projects get quick icons — new-session and open-project — on their rail
 * groups and Desk cards; (6) the tile names its state — visible words AND for screen
 * readers; (7) the "Additional settings" menu is navigation only (the
 * orders/freeze controls are the Desk sheet's); (8) the foot carries a "Workspace" group label.
 */

let modelBag: BoardModel = { items: [], unfiled: [], failedAt: {}, stalledAt: {}, repos: [], loading: false, error: null };

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => modelBag,
}));

// A REALISTIC daemon for the page render (the registry reads /health, /roster and the seats' week).
const getHealth = vi.fn(() => Promise.resolve({ status: 'ok', version: '0.6.0', ping: 'pong' }));
const getRoster = vi.fn(() => Promise.resolve({ roster: ROSTER }));
const getSeatRecord = vi.fn(() => Promise.resolve(WEEK));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => getHealth(),
    getRoster: () => getRoster(),
    getSeatRecord: () => getSeatRecord(),
    upsertConformanceRule: () => Promise.resolve({}),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
    getWatch: () => Promise.resolve({ feed: [], runs: [] }),
    getAuditSince: () => Promise.resolve({ entries: [] }),
  },
  apiFetch: () => Promise.resolve({}),
}));

vi.mock('../src/components/StandingOrdersPanel.js', () => ({ StandingOrdersPanel: () => <div data-testid="standing-orders" /> }));
vi.mock('../src/components/DeliveryFreezeSwitch.js', () => ({ DeliveryFreezeSwitch: () => <div data-testid="delivery-freeze" /> }));
vi.mock('../src/components/session/Composer.js', () => ({
  Composer: ({ composerKey }: { composerKey: string }) => (
    <div data-testid="composer" data-composer={composerKey}>
      <textarea data-testid="desk-composer-input" />
    </div>
  ),
}));
vi.mock('../src/components/NeedsYouQueue.js', () => ({ NeedsQueueSurface: () => null, FocusLockToggle: () => null }));
vi.mock('../src/components/desk/DeskStateRows.js', () => ({ DeskStateRows: () => null, useDeskStates: () => ({ frozen: false, away: false }) }));
vi.mock('../src/components/desk/DeskRuleLine.js', () => ({ DeskRuleLine: () => null }));
vi.mock('../src/components/CaptureDrop.js', () => ({ CaptureDrop: () => null }));
vi.mock('../src/components/HandoverPanel.js', () => ({ HandoverPanel: () => null }));
vi.mock('../src/components/ReplayMove.js', () => ({ ReplayMove: () => null }));
vi.mock('../src/components/NewProjectModal.js', () => ({ NewProjectModal: () => null }));
vi.mock('../src/hooks/useRepairMoves.js', () => ({
  useDeadletterReplay: () => ({ state: { phase: 'idle' }, preview: () => {}, confirm: () => {}, dismiss: () => {} }),
}));
vi.mock('../src/hooks/useHandover.js', () => ({ useHandover: () => ({ since: null, sections: [], dismiss: () => {} }) }));
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => [] }));

const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { Desk } = await import('../src/components/desk/Desk.js');
const { NerveCenterPage: HealthPage } = await import('../src/components/nerve/NerveCenterPage.js');

/** One project in the board model — enough for a rail group and a Desk card. */
const KESTREL: BoardModel['items'][number] = {
  project: { id: 'kes', name: 'Kestrel', description: null, status: 'active', scope: 'project:kes', created_at: 1, updated_at: 1 },
  repo: null,
  repoCount: 0,
  repoNames: [],
  runs: [makeView({ id: 'r1', problem: 'double charge', status: 'executing' })],
  docs: [],
  attachedAt: {},
  attention: 'running',
  score: 0,
  band: 'working',
  signal: null,
};

function withProject(): void {
  modelBag = { ...modelBag, items: [KESTREL] };
}

function cleanModel(): void {
  modelBag = { items: [], unfiled: [], failedAt: {}, stalledAt: {}, repos: [], loading: false, error: null };
}

beforeEach(() => {
  cleanModel();
  resetSystemStore();
  getHealth.mockClear();
  getRoster.mockClear();
  getSeatRecord.mockClear();
  clearCachedRoster();
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(cleanup);

describe('the rail redesign', () => {
  it('the "+ Start something" row is gone — the composer is the only start', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    expect(screen.queryByTestId('desk-rail-start')).toBeNull();
    expect(screen.getByTestId('session-rail').textContent).not.toContain('Start something');
  });

  it('"General settings" is gone: General (the /system page) is a Workspace link — no dropdown, no overview', () => {
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/" />);
    expect(screen.queryByTestId('desk-rail-more')).toBeNull();
    expect(screen.getByTestId('session-rail').textContent).not.toContain('General settings');
    const general = screen.getByTestId('desk-rail-general');
    expect(general.tagName).toBe('A');
    expect(general).toHaveAttribute('href', '/system');
    expect(general.textContent?.trim()).toBe('General');
    fireEvent.click(general);
    expect(navigate).toHaveBeenCalledWith('/system');
    expect(screen.queryByTestId('desk-rail-additional')).toBeNull();
  });

  it('the foot order: the Workspace links ending Workflows · General, then the Nerve Center tile last', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const rail = screen.getByTestId('session-rail');
    const ids = [...rail.querySelectorAll('.wk-rail-foot [data-testid], .wk-nc-dock [data-testid]')].map((e) => e.getAttribute('data-testid') ?? '').filter((id) => id.startsWith('desk-rail-'));
    expect(ids).toEqual(['desk-rail-skills', 'desk-rail-mcp', 'desk-rail-plugins', 'desk-rail-workflows', 'desk-rail-general', 'desk-rail-nerve']);
    for (const id of ['desk-rail-skills', 'desk-rail-general']) expect(screen.getByTestId(id)).toHaveClass('wk-rail-link--secondary');
    // Its own tier: the one large tile, not a secondary link (DES-SYSTEM-VIEW).
    expect(screen.getByTestId('desk-rail-nerve')).toHaveClass('wk-nc-tile');
    expect(screen.getByTestId('desk-rail-nerve')).not.toHaveClass('wk-rail-link--secondary');
    // The separate Watchtower pill and Health link are gone: the tile replaced both.
    expect(screen.queryByTestId('watch-pill')).toBeNull();
    expect(screen.queryByTestId('desk-rail-health')).toBeNull();
  });

  it('Nerve Center is ONE tile to /watch, green and "all clear" only after a fresh successful read', async () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const tile = screen.getByTestId('desk-rail-nerve');
    expect(tile.tagName).toBe('A');
    expect(tile).toHaveAttribute('href', '/watch');
    expect(tile).toHaveAttribute('data-nav-dest', 'watch');
    expect(tile).toHaveTextContent('Nerve Center');
    // Before any answer it is never green.
    expect(tile).not.toHaveAttribute('data-tone', 'green');
    await waitFor(() => expect(tile).toHaveAttribute('data-tone', 'green'));
    expect(tile).toHaveAttribute('data-read', 'fresh');
    // Colour is never the only signal: the words and the accessible name say it.
    expect(screen.getByTestId('nerve-center-words')).toHaveTextContent('all clear');
    expect(tile.textContent).toBe('Nerve Center · all clear');
    expect(tile).toHaveAttribute('aria-label', 'Nerve Center: all clear — nothing needs you');
  });

  it('a failed read is yellow "can\'t reach crew", never green', async () => {
    getHealth.mockRejectedValue(new Error('down'));
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const tile = screen.getByTestId('desk-rail-nerve');
    await waitFor(() => expect(tile).toHaveAttribute('data-read', 'failed'));
    expect(tile).toHaveAttribute('data-tone', 'yellow');
    expect(screen.getByTestId('nerve-center-words')).toHaveTextContent("can't reach crew");
    expect(tile).toHaveAttribute('aria-label', "Nerve Center: can't reach crew — needs a look");
    getHealth.mockImplementation(() => Promise.resolve({ status: 'ok', version: '0.6.0', ping: 'pong' }));
  });

  it('a dropped socket says so in words (yellow: work still flows, the pages stop updating)', async () => {
    useConnectionStore.setState({ status: 'disconnected' });
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const tile = screen.getByTestId('desk-rail-nerve');
    await waitFor(() => expect(screen.getByTestId('nerve-center-words')).toHaveTextContent('live updates paused'));
    expect(tile).toHaveAttribute('data-tone', 'yellow');
  });

  it('the tile marks itself current on /watch and on /health, and sends the desk to /watch', () => {
    const navigate = vi.fn();
    const { unmount } = render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/watch" />);
    expect(screen.getByTestId('desk-rail-nerve')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('desk-rail-home')).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByTestId('desk-rail-nerve'));
    expect(navigate).toHaveBeenCalledWith('/watch');
    unmount();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/health" />);
    expect(screen.getByTestId('desk-rail-nerve')).toHaveAttribute('aria-current', 'page');
  });

  it("the separator above the Workspace group is the foot's own top border — no spacer element", () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const rail = screen.getByTestId('session-rail');
    expect(rail.querySelector('.wk-rail-spacer')).toBeNull();
    const first = screen.getByTestId('desk-rail-skills');
    // The group sits in the foot — the foot's border-top (components.css) is the separator.
    expect(first.closest('.wk-rail-foot')).not.toBeNull();
    // Change 18: the foot's group label leads the links.
    expect((first.previousElementSibling as HTMLElement).getAttribute('data-testid')).toBe('rail-foot-label');
    expect(screen.getByTestId('rail-foot-label')).toHaveTextContent('Workspace');
    // Nerve Center is pinned last: its own dock, the rail's last child (sticky in the phone drawer).
    expect(rail.lastElementChild).toBe(screen.getByTestId('rail-nerve-dock'));
    expect(screen.getByTestId('rail-nerve-dock')).toContainElement(screen.getByTestId('desk-rail-nerve'));
  });
});

describe('project quick icons', () => {
  it('a rail group with a project carries New job and Open-project — and they reach their targets', async () => {
    withProject();
    resetLaunchWizard();
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/" />);
    const group = screen.getByTestId('rail-group');
    expect(group).toHaveAttribute('data-project-id', 'kes');
    await screen.findByTestId('rail-group-view');
    // Concept A: the Desk has no composer, so "New work in <project>" opens the launch wizard there.
    fireEvent.click(screen.getByTestId('rail-group-new'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { projectId: 'kes' } });
    fireEvent.click(screen.getByTestId('rail-group-view'));
    // The four-boxes icon opens the project DASHBOARD (/projects/:id), never the Product flow.
    expect(navigate).toHaveBeenCalledWith('/projects/kes');
    expect(navigate).not.toHaveBeenCalledWith('/product?project=kes');
  });

  it('a Desk project row opens the project dashboard', async () => {
    withProject();
    const navigate = vi.fn();
    render(<Desk runs={[]} runsLoaded now={Date.now()} needRows={[]} navigate={navigate} />);
    const row = (await screen.findAllByTestId('desk-project')).find((r) => r.getAttribute('data-project-id') === 'kes')!;
    fireEvent.click(within(row).getByTestId('desk-project-view'));
    expect(navigate).toHaveBeenCalledWith('/projects/kes');
    expect(navigate).not.toHaveBeenCalledWith('/product?project=kes');
  });
});

describe('Not in a project has an open icon too', () => {
  it('the unfiled rail group opens its own dashboard — a project dashboard (operator 2026-10-16)', () => {
    modelBag = { ...modelBag, unfiled: [makeView({ id: 'u1', problem: 'loose end', status: 'completed' })] };
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/" />);
    const group = screen.getAllByTestId('rail-group').find((g) => g.getAttribute('data-project-id') === '')!;
    const open = within(group).getByTestId('rail-group-view-unfiled');
    expect(open).toHaveAccessibleName('Open work not in a project');
    // Only the view icon: unfiled work has no project to seed a new session in.
    expect(within(group).queryByTestId('rail-group-new')).toBeNull();
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith('/projects/default');
  });
});

describe("the old /health page's cards, folded into Nerve Center", () => {
  it('Connection · Helpers · This week · Governance all render inside the dashboard panels', async () => {
    render(<HealthPage />);
    const page = await screen.findByTestId('nerve-center-page');
    expect(within(page).getByRole('heading', { level: 1, name: 'Nerve Center' })).toBeInTheDocument();
    for (const id of ['health-card-connection', 'health-card-seats', 'health-card-week', 'health-card-governance']) {
      expect(within(page).getByTestId(id)).toBeInTheDocument();
    }
    // The seats registry, the week's window, and the honest governance "not reported".
    const rows = await screen.findAllByTestId('rail-seat-row');
    expect(rows.map((r) => r.getAttribute('data-seat'))).toEqual(ROSTER.map((s) => s.key));
    // The week window lives in its OWN card (change: split out of Seats), never in Seats.
    const seatsCard = within(page).getByTestId('health-card-seats');
    expect(within(seatsCard).queryByTestId('rail-seat-week-window')).toBeNull();
    const weekCard = within(page).getByTestId('health-card-week');
    const window = within(weekCard).getByTestId('rail-seat-week-window');
    expect(window).toHaveAttribute('data-state', 'ok');
    expect(window.textContent).toContain('2026-09-27');
    expect(screen.getByTestId('rail-governance')).toHaveAttribute('data-state', 'absent');
    expect(getRoster).toHaveBeenCalled();
    expect(getSeatRecord).toHaveBeenCalled();
  });
});