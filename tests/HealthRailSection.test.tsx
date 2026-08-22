import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { RosterSeat } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';

/**
 * The rail-foot health section (DES-FEEDBACK-003 §6.2/§6.3, slice O): the
 * SettingsRailSection dress with the HEALTH REGISTRY inside — GET /health +
 * GET /roster fetched ON EXPAND only (EC30), seat-row anatomy honest about an
 * absent SeatHealth (additive wire field), the passive fail-red summary dot,
 * and the chrome dot's click expanding the section (its popover retired, §8.2).
 */

const getHealth = vi.fn(() => Promise.resolve({ status: 'ok', version: '0.6.0', ping: 'pong' }));
let rosterAnswer: RosterSeat[] = [];
const getRoster = vi.fn(() => Promise.resolve({ roster: rosterAnswer }));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => getHealth(),
    getRoster: () => getRoster(),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
}));

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }),
}));

const { HealthRailSection } = await import('../src/components/HealthRailSection.js');
const { LeftSidebar } = await import('../src/components/LeftSidebar.js');
const { clearCachedRoster, getCachedRoster } = await import('../src/store/rosterCache.js');

const LONG_MESSAGE =
  'quota exceeded: the monthly usage limit for this seat has been reached upstream';

const SEATS: RosterSeat[] = [
  { key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true,
    health: { status: 'active', since: '2026-08-20T00:00:00Z' }, signed_in: true },
  { key: 'codex', display_name: 'codex', binary: 'codex', enabled_for_council: true,
    health: { status: 'inactive', message: LONG_MESSAGE, since: '2026-08-20T01:00:00Z',
              lastErrorAt: '2026-08-20T01:00:00Z' }, signed_in: false },
  // The additive-wire case: a daemon predating crew#274 sends NO health.
  { key: 'pi', display_name: 'pi', binary: 'pi', enabled_for_council: true },
];

/** The rail's controlled-open harness (LeftSidebar owns the state, §6.2). */
function Harness({ initialOpen = false }: { initialOpen?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(initialOpen);
  return <HealthRailSection open={open} onToggle={() => setOpen((v) => !v)} />;
}

beforeEach(() => {
  rosterAnswer = SEATS;
  getHealth.mockClear();
  getRoster.mockClear();
  clearCachedRoster();
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(() => cleanup());

describe('fetch on gesture (EC30, §6.3)', () => {
  it('fires ZERO /health and /roster requests before the expand', () => {
    render(<Harness />);
    expect(screen.getByTestId('rail-health-section')).toHaveAttribute('data-open', 'false');
    expect(getHealth).not.toHaveBeenCalled();
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('expanding fires exactly one of each; the answer is cached, never polled', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('rail-health-toggle'));
    await screen.findAllByTestId('rail-seat-row');
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(getRoster).toHaveBeenCalledTimes(1);
    // Settled and open: no timer, no re-fetch — one gesture, one answer.
    await new Promise((r) => setTimeout(r, 50));
    expect(getRoster).toHaveBeenCalledTimes(1);
    // The landed roster deposits into the session cache (its contract: every
    // call site deposits).
    expect(getCachedRoster()?.map((s) => s.key)).toEqual(['claude', 'codex', 'pi']);
  });

  it('collapsing and re-expanding refetches — staleness by gesture (§6.3)', async () => {
    render(<Harness />);
    const toggle = screen.getByTestId('rail-health-toggle');
    fireEvent.click(toggle);
    await screen.findAllByTestId('rail-seat-row');
    fireEvent.click(toggle); // collapse — keeps the answers, fires nothing
    expect(getRoster).toHaveBeenCalledTimes(1);
    fireEvent.click(toggle); // the next gesture refetches
    await waitFor(() => expect(getRoster).toHaveBeenCalledTimes(2));
    expect(getHealth).toHaveBeenCalledTimes(2);
  });
});

describe('the registry rows (§6.2 anatomy)', () => {
  it('renders check rows + one row per seat with glyph/name/status', async () => {
    render(<Harness initialOpen />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    expect(rows.map((r) => r.getAttribute('data-seat'))).toEqual(['claude', 'codex', 'pi']);
    // Active + signed in: ✓ in the run token, the quiet suffix.
    const claude = rows[0]!;
    expect(claude).toHaveAttribute('data-health', 'active');
    expect(claude.textContent).toContain('✓');
    expect(claude.textContent).toContain('active · signed in');
    // The WebSocket/API check rows moved from the popover verbatim.
    expect(screen.getByText('WebSocket')).toBeInTheDocument();
    expect(screen.getByText('API server')).toBeInTheDocument();
    await screen.findByText('ok · 0.6.0');
  });

  it('an inactive seat shows ✗ + the 40ch excerpt, full message on title', async () => {
    render(<Harness initialOpen />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const codex = rows[1]!;
    expect(codex).toHaveAttribute('data-health', 'inactive');
    expect(codex.textContent).toContain('✗');
    expect(codex.textContent).toContain(`${LONG_MESSAGE.slice(0, 40)}…`);
    expect(codex.textContent).not.toContain(LONG_MESSAGE);
    expect(codex).toHaveAttribute('title', LONG_MESSAGE);
  });

  it('an ABSENT health renders the dim · glyph and no message — never a fabricated "active"', async () => {
    render(<Harness initialOpen />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const pi = rows[2]!;
    expect(pi).toHaveAttribute('data-health', 'unknown');
    expect(pi.textContent).toContain('·');
    expect(pi.textContent).not.toContain('active');
    expect(pi.textContent).not.toContain('✓');
  });
});

describe('the passive summary dot (§6.2/§6.3)', () => {
  it('renders fail-red on the collapsed header once an inactive seat is known', async () => {
    render(<Harness />);
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
    const toggle = screen.getByTestId('rail-health-toggle');
    fireEvent.click(toggle);
    await screen.findAllByTestId('rail-seat-row');
    fireEvent.click(toggle); // collapse — the dot keeps saying "look inside"
    const dot = screen.getByTestId('rail-health-summary-dot');
    expect(dot.style.background).toBe('var(--status-fail)');
  });

  it('renders when the socket is down, even with no roster fetched', () => {
    useConnectionStore.setState({ status: 'disconnected' });
    render(<Harness />);
    expect(screen.getByTestId('rail-health-summary-dot')).toBeInTheDocument();
  });

  it('absent on an all-healthy roster with a live socket', async () => {
    rosterAnswer = [SEATS[0]!, SEATS[2]!];
    render(<Harness initialOpen />);
    await screen.findAllByTestId('rail-seat-row');
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
  });
});

describe('the chrome dot hands off to the section (§6.2/§8.2)', () => {
  it('renders the section at the rail foot, collapsed, with the old testid gone', () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    expect(screen.getByTestId('rail-health-section')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('rail-settings-section')).toBeNull();
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('clicking the connection dot expands the section; no popover mounts', async () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);
    fireEvent.click(screen.getByTestId('connection-dot'));
    expect(screen.getByTestId('rail-health-section')).toHaveAttribute('data-open', 'true');
    await screen.findAllByTestId('rail-seat-row');
    expect(getRoster).toHaveBeenCalledTimes(1);
    // The retired popover's DOM is absent: health detail has ONE surface now.
    expect(screen.queryByText('Health checks')).toBeNull();
  });
});
