import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BoardModel } from '../src/hooks/useBoardModel.js';
import { useComposerChips } from '../src/store/composerChips.js';
import { useConnectionStore } from '../src/store/connection.js';
import { clearCachedRoster } from '../src/store/rosterCache.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';
import { makeView } from './factories.js';

/**
 * THE SLICK-DESIGN RAIL POLISH (studio's left-nav redesign): (1) the "+ Start something" row is
 * gone — the composer is the start; (2) "Additional settings" is a real control with a lucide
 * chevron (text first); (3) Health is a rail LINK with a live dot (fetched on mount) and a real
 * `/health` registry page; (4) the foot's own top border is the separator above Product, not a
 * spacer element; (5) projects get quick icons — new-session and open-project — on their rail
 * groups and Desk cards; (6) the Health link names its state — visible muted text AND for screen
 * readers — when it is not healthy; (7) the "Additional settings" menu is navigation only (the
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
const { HealthPage } = await import('../src/components/HealthPage.js');

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
  getHealth.mockClear();
  getRoster.mockClear();
  getSeatRecord.mockClear();
  clearCachedRoster();
  useConnectionStore.setState({ status: 'connected' });
  useComposerChips.setState({ byComposer: {} });
});
afterEach(cleanup);

describe('the rail redesign', () => {
  it('the "+ Start something" row is gone — the composer is the only start', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    expect(screen.queryByTestId('desk-rail-start')).toBeNull();
    expect(screen.getByTestId('session-rail').textContent).not.toContain('Start something');
  });

  it('"Additional settings" is a button with a lucide chevron — the label first, the control real', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const more = screen.getByTestId('desk-rail-more');
    expect(more.tagName).toBe('BUTTON');
    expect(more.textContent?.trim().startsWith('Additional settings')).toBe(true);
    expect(more.querySelector('svg.lucide-chevron-down')).not.toBeNull();
    fireEvent.click(more);
    expect(screen.getByTestId('desk-rail-additional')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('desk-rail-additional')).toBeNull();
  });

  it('Health is a rail LINK with a live dot (fetched on mount), between Steering and Additional settings', async () => {
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/" />);
    const nav = screen.getByTestId('session-rail');
    const order = [...nav.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid') ?? '')
      .filter((id) => ['desk-rail-steering', 'desk-rail-health', 'desk-rail-more'].includes(id));
    expect(order).toEqual(['desk-rail-steering', 'desk-rail-health', 'desk-rail-more']);
    const health = screen.getByTestId('desk-rail-health');
    expect(health.tagName).toBe('A');
    expect(health).toHaveAttribute('href', '/health');
    expect(health).toHaveAttribute('data-nav-dest', 'health');
    expect(health).toHaveTextContent('Health');
    // The OLD section chrome is gone (the chrome heart + its toggle).
    expect(screen.queryByTestId('rail-health-section')).toBeNull();
    expect(screen.queryByTestId('rail-health-toggle')).toBeNull();
    // The dot answers from the mount reads — no expand gesture left to fetch them.
    const heart = screen.getByTestId('rail-health-heart');
    await waitFor(() => expect(heart).toHaveAttribute('data-health', 'healthy'));
    expect(getRoster).toHaveBeenCalled();
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
    // Healthy: the visible "Health" text is the name — no state word, no announcement to make.
    expect(health).not.toHaveAttribute('aria-label');
    expect(screen.queryByTestId('rail-health-state')).toBeNull();
  });

  it('the Health link names the state — visible muted text AND for screen readers — when it is not healthy', async () => {
    getHealth.mockRejectedValueOnce(new Error('down'));
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const health = screen.getByTestId('desk-rail-health');
    await waitFor(() => expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'degraded'));
    expect(health).toHaveAttribute('aria-label', 'Health, a check needs attention');
    expect(health).toHaveTextContent('Health');
    // Change 16: the word rides beside the label, in the rail's muted ink. A degraded dot says
    // "degraded" (a warning); only an unhealthy dot says "needs attention".
    expect(screen.getByTestId('rail-health-state')).toHaveTextContent('· degraded');
  });

  it('the Health link says "needs attention" in words when a check is unhealthy', async () => {
    getRoster.mockResolvedValueOnce({ roster: [{ ...ROSTER[0]!, health: { status: 'inactive', since: '2026-08-20T00:00:00Z' } }] });
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const health = screen.getByTestId('desk-rail-health');
    await waitFor(() => expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'unhealthy'));
    expect(screen.getByTestId('rail-health-state')).toHaveTextContent('· needs attention');
    expect(health).toHaveAttribute('aria-label', 'Health, a check is failing');
  });

  it('the Health link marks itself current on /health and sends the desk there', () => {
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/health" />);
    expect(screen.getByTestId('desk-rail-health')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('desk-rail-home')).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByTestId('desk-rail-health'));
    expect(navigate).toHaveBeenCalledWith('/health');
  });

  it("the separator above Product is the foot's own top border — no spacer element", () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const rail = screen.getByTestId('session-rail');
    expect(rail.querySelector('.wk-rail-spacer')).toBeNull();
    const product = screen.getByTestId('desk-rail-product');
    // Product sits in the foot — the foot's border-top (components.css) is the separator.
    expect(product.closest('.wk-rail-foot')).not.toBeNull();
    // Change 18: the foot's group label leads the links; Product is the first link under it.
    expect((product.previousElementSibling as HTMLElement).getAttribute('data-testid')).toBe('rail-foot-label');
    expect(screen.getByTestId('rail-foot-label')).toHaveTextContent('Workspace');
  });
});

describe('project quick icons', () => {
  it('a rail group with a project carries New-session and Open-project — and they reach their targets', async () => {
    withProject();
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/" />);
    const group = screen.getByTestId('rail-group');
    expect(group).toHaveAttribute('data-project-id', 'kes');
    const settle = screen.findByTestId('rail-group-view');
    await settle;
    fireEvent.click(screen.getByTestId('rail-group-new'));
    expect(navigate).toHaveBeenCalledWith('/');
    await waitFor(() => expect(
      useComposerChips.getState().byComposer['desk']?.some((c) => c.kind === 'project' && c.projectId === 'kes'),
    ).toBe(true));
    fireEvent.click(screen.getByTestId('rail-group-view'));
    // The four-boxes icon opens the project DASHBOARD (/projects/:id), never the Product flow.
    expect(navigate).toHaveBeenCalledWith('/projects/kes');
    expect(navigate).not.toHaveBeenCalledWith('/product?project=kes');
  });

  it('a Desk project card carries the same quick icons onto its title row', async () => {
    withProject();
    const navigate = vi.fn();
    render(<Desk runs={[]} runsLoaded now={Date.now()} needRows={[]} navigate={navigate} onAsk={() => {}} />);
    const card = screen.getByTestId('desk-project');
    expect(card).toHaveAttribute('data-project-id', 'kes');
    fireEvent.click(within(card).getByTestId('desk-project-new'));
    await waitFor(() => expect(
      useComposerChips.getState().byComposer['desk']?.some((c) => c.kind === 'project' && c.projectId === 'kes'),
    ).toBe(true));
    fireEvent.click(within(card).getByTestId('desk-project-view'));
    // The four-boxes icon opens the project DASHBOARD (/projects/:id), never the Product flow.
    expect(navigate).toHaveBeenCalledWith('/projects/kes');
    expect(navigate).not.toHaveBeenCalledWith('/product?project=kes');
  });
});

describe('Not in a project has an open icon too', () => {
  it('the unfiled rail group opens the unfiled work on See everything › Projects', () => {
    modelBag = { ...modelBag, unfiled: [makeView({ id: 'u1', problem: 'loose end', status: 'completed' })] };
    const navigate = vi.fn();
    render(<SessionRail runs={[]} needRows={[]} navigate={navigate} pathname="/" />);
    const group = screen.getAllByTestId('rail-group').find((g) => g.getAttribute('data-project-id') === '')!;
    const open = within(group).getByTestId('rail-group-view-unfiled');
    expect(open).toHaveAccessibleName('Open work not in a project');
    // Only the view icon: unfiled work has no project to seed a new session in.
    expect(within(group).queryByTestId('rail-group-new')).toBeNull();
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith('/everything?tab=projects');
  });
});

describe('the /health page', () => {
  it('is its own page with FOUR registry cards — Connection · Seats · This week · Governance', async () => {
    render(<HealthPage />);
    const page = await screen.findByTestId('health-page');
    expect(within(page).getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
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