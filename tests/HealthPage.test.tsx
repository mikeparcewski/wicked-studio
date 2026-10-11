import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';

/**
 * The `/health` page (studio#421 rail polish, change 3): the registry the retired rail-foot flyout
 * used to hold, mounted as its own page — GET /health + GET /roster read ON MOUNT (EC30: the page
 * IS the fetch gesture), the seat-row anatomy honest about an absent SeatHealth (additive wire
 * field), and the probes that SETTLE (studio#280 item 2: an answer carries its clock, a rejection
 * says why). The rail link and its state dot are pinned in railPolish.test.
 */

const getHealth = vi.fn(() => Promise.resolve({ status: 'ok', version: '0.6.0', ping: 'pong' }));
let rosterAnswer: RosterSeat[] = [];
const getRoster = vi.fn(() => Promise.resolve({ roster: rosterAnswer }));

// `GET /diagnostics` rides the same mount read (studio#246); this suite pins the seat registry, so
// the daemon here answers a diagnostics body WITHOUT a governance block (predates crew#495) — the
// honest "not reported" row, never degraded. The governance rows themselves are pinned in
// HealthPage.governance.test.
const apiFetch = vi.fn(() => Promise.resolve({}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => getHealth(),
    getRoster: () => getRoster(),
    getSeatRecord: () => Promise.resolve({ days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] }),
    upsertConformanceRule: () => Promise.resolve({}),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [])),
}));

const { PROBE_DEADLINE_MS, probeOverdueWord } = await import('../src/components/HealthRailSection.js');
const { HealthPage } = await import('../src/components/HealthPage.js');
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

beforeEach(() => {
  rosterAnswer = SEATS;
  getHealth.mockClear();
  getRoster.mockClear();
  apiFetch.mockClear();
  clearCachedRoster();
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(() => cleanup());

describe('the page is the fetch gesture (EC30, §6.3)', () => {
  it('mounts active: one GET /health + one GET /roster, settled (no timer), and the roster lands in the session cache', async () => {
    render(<HealthPage />);
    await screen.findAllByTestId('rail-seat-row');
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(getRoster).toHaveBeenCalledTimes(1);
    // Settled: no timer, no re-fetch — one mount, one answer.
    await new Promise((r) => setTimeout(r, 50));
    expect(getRoster).toHaveBeenCalledTimes(1);
    // The landed roster deposits into the session cache (its contract: every call site deposits).
    expect(getCachedRoster()?.map((s) => s.key)).toEqual(['claude', 'codex', 'pi']);
  });
});

describe('the registry rows (§6.2 anatomy)', () => {
  it('renders a row per seat with glyph/name/status, plus the connection check rows', async () => {
    render(<HealthPage />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    expect(rows.map((r) => r.getAttribute('data-seat'))).toEqual(['claude', 'codex', 'pi']);
    // Active + signed in: ✓ in the run token, the quiet suffix.
    const claude = rows[0]!;
    expect(claude).toHaveAttribute('data-health', 'active');
    expect(claude.textContent).toContain('✓');
    expect(claude.textContent).toContain('active · signed in');
    // The WebSocket/API check rows moved from the retired popover verbatim.
    expect(screen.getByText('WebSocket')).toBeInTheDocument();
    expect(screen.getByText('API server')).toBeInTheDocument();
    await screen.findByText('ok · 0.6.0');
  });

  it('an inactive seat shows ✗ + the FULL message wrapped (never an excerpt), action on its own line — and a quota failure withholds Sign in', async () => {
    render(<HealthPage />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const codex = rows[1]!;
    expect(codex).toHaveAttribute('data-health', 'inactive');
    expect(codex.textContent).toContain('✗');
    // Image review: a quota / usage-limit failure reads as ONE plain line; the raw message stays
    // only in the row's title (no repeat, no raw codes on the page).
    expect(codex.textContent).not.toContain(LONG_MESSAGE);
    expect(within(codex).queryByTestId('rail-seat-error')).toBeNull();
    expect(codex).toHaveAttribute('title', LONG_MESSAGE);
    // r4: a quota / usage-limit failure is NOT a sign-in problem — no Sign in action, and the row
    // says the limit is reached.
    expect(within(codex).queryByTestId('rail-seat-signin')).toBeNull();
    expect(codex.textContent).not.toContain('Sign in');
    expect(within(codex).getByTestId('rail-seat-quota')).toHaveTextContent('Usage limit reached');
  });

  it('an ABSENT health renders the dim · glyph and "no answer yet" — never a fabricated "active"', async () => {
    render(<HealthPage />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const pi = rows[2]!;
    expect(pi).toHaveAttribute('data-health', 'unknown');
    expect(pi.textContent).toContain('·');
    expect(pi.textContent).toContain('no answer yet');
    expect(pi.textContent).not.toContain('active');
    expect(pi.textContent).not.toContain('✓');
  });
});

/**
 * studio#280 item 2 — the probes SETTLE. RC1 saw "API server checking…" 2.5 s after the expand
 * while the daemon's /health answered in < 50 ms: a probe that never settles must not look like
 * one in flight, an answer must carry its clock, and a rejection must say why.
 */
describe('the probes settle (studio#280 item 2)', () => {
  it('once /health has answered, NO row reads "checking…" and the answer carries its clock', async () => {
    const before = Date.now();
    render(<HealthPage />);
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
    rosterAnswer = [SEATS[0]!];
    getHealth.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:7701')));
    render(<HealthPage />);
    const api = await screen.findByTestId('rail-api-server');
    await waitFor(() => expect(api).toHaveAttribute('data-state', 'error'));
    expect(api.textContent).toContain('unreachable — ECONNREFUSED 127.0.0.1:7701');
    expect(api.textContent).not.toContain('checking…');
    expect(within(api).getByTestId('rail-probe-checked')).toBeInTheDocument();
  });

  it('the production deadline is a few seconds — long enough for a slow daemon, short enough to be seen', () => {
    expect(PROBE_DEADLINE_MS).toBeGreaterThanOrEqual(2000);
    expect(PROBE_DEADLINE_MS).toBeLessThanOrEqual(5000);
    expect(probeOverdueWord(PROBE_DEADLINE_MS)).toBe('no answer after 4 s — still waiting');
    expect(probeOverdueWord(30)).toBe('no answer after 30 ms — still waiting');
  });
});
