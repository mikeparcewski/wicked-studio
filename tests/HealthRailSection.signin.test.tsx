import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { RosterSeat } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';

/**
 * F-2R2-009 — the Health rail's seat rows say what a signed-out seat MEANS: councils bench
 * it. Pre-fix every unsigned seat wore a green ✓ with "active · signed out", as if nothing
 * followed. The roster wire carries no field that says whether the seat could still answer
 * without a sign-in (the rig saw opencode answer a chat on a provider free tier), so the
 * row states the one consequence that is known and puts the possibility on hover.
 */

const getHealth = vi.fn(() => Promise.resolve({ status: 'ok', version: '0.7.29', ping: 'pong' }));
let rosterAnswer: RosterSeat[] = [];
const getRoster = vi.fn(() => Promise.resolve({ roster: rosterAnswer }));
const apiFetch = vi.fn(() => Promise.resolve({}));

vi.mock('../src/api/client.js', () => ({
  api: { getHealth: () => getHealth(), getRoster: () => getRoster(), listRepos: () => Promise.resolve({ repos: [] }) },
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [])),
}));

const { HealthRailSection, SIGNED_OUT_DETAIL, SIGNED_OUT_TITLE } = await import('../src/components/HealthRailSection.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');

const SINCE = '2026-09-11T05:00:00Z';
const SEATS: RosterSeat[] = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: SINCE }, signed_in: true },
  { key: 'opencode', display_name: 'OpenCode', binary: 'opencode', enabled_for_council: true, health: { status: 'active', since: SINCE }, signed_in: false },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'inactive', message: 'quota exceeded', since: SINCE }, signed_in: false },
  { key: 'agy', display_name: 'Antigravity', binary: 'agy', enabled_for_council: true, health: { status: 'active', since: SINCE }, signed_in: null },
];

function Harness(): React.ReactElement {
  const [open, setOpen] = useState(true);
  return <HealthRailSection open={open} onToggle={() => setOpen((v) => !v)} />;
}

beforeEach(() => {
  rosterAnswer = SEATS;
  clearCachedRoster();
  useConnectionStore.setState({ status: 'connected' });
});
afterEach(() => cleanup());

describe('seat sign-in semantics on the rail (F-2R2-009)', () => {
  it('an active, signed-out seat wears the amber "!" and says councils bench it — never a green ✓ over "signed out"', async () => {
    render(<Harness />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const opencode = rows.find((r) => r.getAttribute('data-seat') === 'opencode')!;
    expect(opencode).toHaveAttribute('data-signed-in', 'false');
    expect(opencode).toHaveAttribute('data-health', 'active');
    expect(opencode.textContent).toContain('!');
    expect(opencode.textContent).not.toContain('✓');
    expect(opencode.textContent).toContain(`active · ${SIGNED_OUT_DETAIL}`);
    expect(opencode).toHaveAttribute('title', SIGNED_OUT_TITLE);
    // The hover text names the possibility the wire cannot confirm, as a possibility.
    expect(SIGNED_OUT_TITLE).toContain('free tier');
    expect(SIGNED_OUT_TITLE).toContain('cannot tell');
  });

  it('a signed-in seat is unchanged; an inactive seat keeps its error excerpt; unknown sign-in stays quiet', async () => {
    render(<Harness />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const claude = rows.find((r) => r.getAttribute('data-seat') === 'claude')!;
    expect(claude).toHaveAttribute('data-signed-in', 'true');
    expect(claude.textContent).toContain('✓');
    expect(claude.textContent).toContain('active · signed in');
    const codex = rows.find((r) => r.getAttribute('data-seat') === 'codex')!;
    expect(codex.textContent).toContain('✗');
    expect(codex.textContent).toContain('quota exceeded');
    expect(codex).toHaveAttribute('title', 'quota exceeded');
    const agy = rows.find((r) => r.getAttribute('data-seat') === 'agy')!;
    expect(agy).toHaveAttribute('data-signed-in', 'unknown');
    expect(agy.textContent).toBe('✓Antigravityactive');
  });

  it('the heart reads degraded (amber) over a benched seat, unhealthy over an inactive one', async () => {
    render(<Harness />);
    await screen.findAllByTestId('rail-seat-row');
    // codex is inactive here — unhealthy wins.
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'unhealthy');
    cleanup();
    rosterAnswer = SEATS.filter((s) => s.key !== 'codex');
    clearCachedRoster();
    render(<Harness />);
    await screen.findAllByTestId('rail-seat-row');
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'degraded');
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
  });
});
