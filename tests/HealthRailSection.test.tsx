import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// `GET /diagnostics` rides the same expand (studio#246); this suite pins the seat
// registry, so the daemon here answers a diagnostics body WITHOUT a governance
// block (predates crew#495) — the honest "not reported" row, never degraded.
// The governance rows themselves are pinned in HealthRailSection.governance.test.
const apiFetch = vi.fn(() => Promise.resolve({}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => getHealth(),
    getRoster: () => getRoster(),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [])),
}));

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }),
}));

const { HealthRailSection, PROBE_DEADLINE_MS, probeOverdueWord } = await import('../src/components/HealthRailSection.js');
const { SessionRail } = await import('../src/components/desk/SessionRail.js');
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

/** The rail's controlled-open harness (the session rail owns the state, §6.2). */
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

describe('the rail-foot section (nav-ui-tweaks removed the chrome dot)', () => {
  it('renders the section at the rail foot, collapsed, with the old testid gone', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    expect(screen.getByTestId('rail-health-section')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByTestId('rail-settings-section')).toBeNull();
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('the chrome paints no connection dot; the section opens from its own header', async () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    // The chrome dot that used to expand this section is gone (nav-ui-tweaks).
    expect(screen.queryByTestId('connection-dot')).toBeNull();
    fireEvent.click(screen.getByTestId('rail-health-toggle'));
    expect(screen.getByTestId('rail-health-section')).toHaveAttribute('data-open', 'true');
    await screen.findAllByTestId('rail-seat-row');
    expect(getRoster).toHaveBeenCalledTimes(1);
  });
});

describe('the health-colored heart (nav-ui-tweaks)', () => {
  it('is green when the socket is live and no seat is inactive', async () => {
    rosterAnswer = [SEATS[0]!, SEATS[2]!]; // active + unknown — neither inactive
    render(<Harness initialOpen />);
    await screen.findAllByTestId('rail-seat-row');
    const heart = screen.getByTestId('rail-health-heart');
    expect(heart).toHaveAttribute('data-health', 'healthy');
    expect(heart.style.color).toBe('var(--status-run)');
  });

  it('is amber (degraded) while the socket is still connecting', () => {
    useConnectionStore.setState({ status: 'connecting' });
    render(<Harness />); // collapsed — the ws state alone drives the glyph
    const heart = screen.getByTestId('rail-health-heart');
    expect(heart).toHaveAttribute('data-health', 'degraded');
    expect(heart.style.color).toBe('var(--status-gate)');
  });

  it('is red (unhealthy) when the socket is down', () => {
    useConnectionStore.setState({ status: 'disconnected' });
    render(<Harness />);
    const heart = screen.getByTestId('rail-health-heart');
    expect(heart).toHaveAttribute('data-health', 'unhealthy');
    expect(heart.style.color).toBe('var(--status-fail)');
  });

  it('is red (unhealthy) once an inactive seat is known', async () => {
    rosterAnswer = SEATS; // codex is inactive
    render(<Harness initialOpen />);
    await screen.findAllByTestId('rail-seat-row');
    const heart = screen.getByTestId('rail-health-heart');
    expect(heart).toHaveAttribute('data-health', 'unhealthy');
    expect(heart.style.color).toBe('var(--status-fail)');
  });
});

/**
 * studio#280 item 2 — the rail SETTLES. RC1 saw "API server checking… / seats checking… /
 * governance checking…" 2.5 s after the expand while the daemon's /health answered in < 50 ms:
 * a probe that never settles must not look like one in flight, an answer must carry its clock,
 * and a rejection must say why.
 */
describe('the probes settle (studio#280 item 2)', () => {
  function Deadline({ ms }: { ms: number }): React.ReactElement {
    const [open, setOpen] = useState(true);
    return <HealthRailSection open={open} onToggle={() => setOpen((v) => !v)} probeDeadlineMs={ms} />;
  }

  it('after the expand, once /health has answered, NO row reads "checking…" and the answer carries its clock', async () => {
    const before = Date.now();
    render(<Harness initialOpen />);
    await screen.findByText('ok · 0.6.0');
    await screen.findAllByTestId('rail-seat-row');
    await waitFor(() => expect(screen.queryAllByText(/checking…/)).toHaveLength(0));
    const api = screen.getByTestId('rail-api-server');
    expect(api).toHaveAttribute('data-state', 'answered');
    const checked = within(api).getByTestId('rail-probe-checked');
    expect(checked.textContent).toMatch(/^checked \d\d:\d\d:\d\d$/);
    expect(Number(checked.getAttribute('data-at'))).toBeGreaterThanOrEqual(before);
    expect(Number(checked.getAttribute('data-at'))).toBeLessThanOrEqual(Date.now());
  });

  it('a REJECTED /health shows the error with its sentence (and its clock) — never a bare "unreachable", never "checking…"', async () => {
    rosterAnswer = [SEATS[0]!]; // every seat healthy, so the heart reads the probe alone
    getHealth.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:7701')));
    render(<Harness initialOpen />);
    const api = await screen.findByTestId('rail-api-server');
    await waitFor(() => expect(api).toHaveAttribute('data-state', 'error'));
    expect(api.textContent).toContain('unreachable — ECONNREFUSED 127.0.0.1:7701');
    expect(api.textContent).not.toContain('checking…');
    expect(within(api).getByTestId('rail-probe-checked')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'degraded'));
  });

  it('a probe that never answers is said past the deadline — "no answer after …", with a re-probe that lands the next answer', async () => {
    // The first /health never settles (what RC1 saw); the re-probe's does.
    getHealth.mockImplementationOnce(() => new Promise(() => undefined));
    render(<Deadline ms={30} />);
    const api = await screen.findByTestId('rail-api-server');
    expect(api.textContent).toContain('checking…');
    await waitFor(() => expect(api).toHaveAttribute('data-state', 'overdue'));
    expect(api.textContent).toContain(probeOverdueWord(30));
    expect(api.textContent).not.toContain('checking…');
    // Only the rows still pending wear the overdue words — the seats answered and read as seats.
    await screen.findAllByTestId('rail-seat-row');
    expect(screen.queryByTestId('rail-seats-probe')).toBeNull();
    expect(getHealth).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('rail-health-recheck'));
    await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(2));
    await screen.findByText('ok · 0.6.0');
    expect(screen.getByTestId('rail-api-server')).toHaveAttribute('data-state', 'answered');
    expect(screen.queryByTestId('rail-health-recheck')).toBeNull();
  });

  it('a KEPT answer past a re-expand\'s deadline is said to be stale — its clock, "stale", the re-probe — never passed off as fresh', async () => {
    render(<Deadline ms={30} />);
    await screen.findByText('ok · 0.6.0');
    await screen.findAllByTestId('rail-seat-row');
    // The re-expand's probes never answer (what RC1 saw) …
    getHealth.mockImplementationOnce(() => new Promise(() => undefined));
    getRoster.mockImplementationOnce(() => new Promise(() => undefined));
    const toggle = screen.getByTestId('rail-health-toggle');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    const api = await screen.findByTestId('rail-api-server');
    await waitFor(() => expect(api).toHaveAttribute('data-state', 'stale'));
    // … so the kept answer stays readable WITH its clock, but is marked stale and carries the re-probe;
    // the seats list is kept too, under a row that says the probe has not answered.
    expect(api.textContent).toContain('ok · 0.6.0');
    expect(within(api).getByTestId('rail-probe-checked')).toBeInTheDocument();
    expect(within(api).getByTestId('rail-health-recheck')).toBeInTheDocument();
    expect(screen.getByTestId('rail-seats-probe')).toHaveAttribute('data-state', 'stale');
    expect(screen.getByTestId('rail-seats-probe').textContent).toContain('showing the last answer');
    expect(screen.getByTestId('rail-seats-recheck')).toBeInTheDocument(); // every overdue row offers the re-probe
    expect(screen.getAllByTestId('rail-seat-row')).toHaveLength(3);
    // The re-probe answers: fresh again, nothing stale left.
    fireEvent.click(within(api).getByTestId('rail-health-recheck'));
    await waitFor(() => expect(screen.getByTestId('rail-api-server')).toHaveAttribute('data-state', 'answered'));
    await waitFor(() => expect(screen.queryByTestId('rail-seats-probe')).toBeNull());
  });

  it('an overdue SEATS or GOVERNANCE row offers the re-probe even when /health answered (codex round 2)', async () => {
    getRoster.mockImplementationOnce(() => new Promise(() => undefined));
    render(<Deadline ms={30} />);
    await screen.findByText('ok · 0.6.0');
    const seats = await screen.findByTestId('rail-seats-probe');
    await waitFor(() => expect(seats).toHaveAttribute('data-state', 'overdue'));
    expect(screen.queryByTestId('rail-health-recheck')).toBeNull(); // the API row answered fresh — nothing to re-probe there
    fireEvent.click(screen.getByTestId('rail-seats-recheck'));
    await waitFor(() => expect(getRoster).toHaveBeenCalledTimes(2));
    await screen.findAllByTestId('rail-seat-row');
    expect(screen.queryByTestId('rail-seats-probe')).toBeNull();
  });

  it('a slow EARLIER answer never lands over a later expand (the generation guard covers /health too)', async () => {
    let resolveFirst: (h: { status: string; version: string; ping: string }) => void = () => undefined;
    getHealth.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    render(<Harness initialOpen />);
    const toggle = screen.getByTestId('rail-health-toggle');
    fireEvent.click(toggle); // collapse
    fireEvent.click(toggle); // re-expand: the second /health answers 0.6.0
    await screen.findByText('ok · 0.6.0');
    resolveFirst({ status: 'degraded', version: '0.0.1', ping: 'pong' }); // the stale first answer
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('rail-api-server').textContent).toContain('ok · 0.6.0');
    expect(screen.queryByText(/0\.0\.1/)).toBeNull();
  });

  it('the production deadline is a few seconds — long enough for a slow daemon, short enough to be seen', () => {
    expect(PROBE_DEADLINE_MS).toBeGreaterThanOrEqual(2000);
    expect(PROBE_DEADLINE_MS).toBeLessThanOrEqual(5000);
    expect(probeOverdueWord(PROBE_DEADLINE_MS)).toBe('no answer after 4 s — still waiting');
    expect(probeOverdueWord(30)).toBe('no answer after 30 ms — still waiting');
  });
});
