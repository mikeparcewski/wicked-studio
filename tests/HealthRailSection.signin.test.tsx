import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { RosterSeat } from '../src/api/types.js';
import { useConnectionStore } from '../src/store/connection.js';

/**
 * F-2R2-009 — the Health rail's seat rows say what a signed-out seat MEANS, honestly. Pre-fix
 * every unsigned seat wore a green ✓ with "active · signed out", as if nothing followed. The
 * roster wire (api-types 0.33.0) carries no field that says whether a council would seat it —
 * and the rig saw opencode answer a chat on a provider free tier while `signed_in:false` — so
 * the row states the observation and HEDGES the consequence ("councils may bench this seat"),
 * puts the free-tier possibility on hover, and never folds the heuristic into the heart. When a
 * daemon sends crew#533's `auth` / `council_eligible` (0.35.0) the row believes those instead.
 */

const getHealth = vi.fn(() => Promise.resolve({ status: 'ok', version: '0.7.29', ping: 'pong' }));
let rosterAnswer: RosterSeat[] = [];
const getRoster = vi.fn(() => Promise.resolve({ roster: rosterAnswer }));
const apiFetch = vi.fn(() => Promise.resolve({}));

vi.mock('../src/api/client.js', () => ({
  api: { getHealth: () => getHealth(), getRoster: () => getRoster(), listRepos: () => Promise.resolve({ repos: [] }) },
  apiFetch: (...a: unknown[]) => apiFetch(...(a as [])),
}));

const { HealthRailSection, SIGNED_OUT_DETAIL, SIGNED_OUT_TITLE, seatStandingWord } = await import('../src/components/HealthRailSection.js');
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
  it('an active, signed-out seat wears the amber "!" and HEDGES the consequence — never a green ✓, never an engine rule the wire does not carry', async () => {
    render(<Harness />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const opencode = rows.find((r) => r.getAttribute('data-seat') === 'opencode')!;
    expect(opencode).toHaveAttribute('data-signed-in', 'false');
    expect(opencode).toHaveAttribute('data-standing', 'signed-out');
    expect(opencode).toHaveAttribute('data-health', 'active');
    expect(opencode.textContent).toContain('!');
    expect(opencode.textContent).not.toContain('✓');
    expect(opencode.textContent).toContain(`active · ${SIGNED_OUT_DETAIL}`);
    expect(SIGNED_OUT_DETAIL).toBe('signed out — councils may bench this seat');
    expect(opencode.textContent).not.toMatch(/councils bench this seat|will be benched/);
    expect(opencode).toHaveAttribute('title', SIGNED_OUT_TITLE);
    // The hover text names the possibility the wire cannot confirm, as a possibility.
    expect(SIGNED_OUT_TITLE).toContain('free tier');
    expect(SIGNED_OUT_TITLE).toContain('cannot tell');
  });

  it('reads crew#533\'s auth / council_eligible (api-types 0.35.0) when a daemon sends them — believed, never inferred', async () => {
    rosterAnswer = [
      { key: 'opencode', display_name: 'OpenCode', binary: 'opencode', enabled_for_council: true, health: { status: 'active', since: SINCE }, signed_in: false,
        auth: 'not_required', free_tier: 'OpenCode Zen' } as RosterSeat,
      { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'active', since: SINCE }, signed_in: false,
        auth: 'signed_out', council_eligible: false, council_ineligible_reason: 'signed out — a council would bench it' } as RosterSeat,
      { key: 'pi', display_name: 'pi', binary: 'pi', enabled_for_council: true, health: { status: 'active', since: SINCE }, signed_in: false,
        auth: 'signed_out', council_eligible: true } as RosterSeat,
    ];
    render(<Harness />);
    const rows = await screen.findAllByTestId('rail-seat-row');
    const byKey = (k: string): HTMLElement => rows.find((r) => r.getAttribute('data-seat') === k)!;
    // A free-tier seat: the daemon says no sign-in is needed — a green ✓, the tier named.
    expect(byKey('opencode')).toHaveAttribute('data-standing', 'no-sign-in-needed');
    expect(byKey('opencode')).toHaveAttribute('data-auth', 'not_required');
    expect(byKey('opencode').textContent).toContain('✓');
    expect(byKey('opencode').textContent).toContain('active · no sign-in needed (OpenCode Zen)');
    // The daemon SAYS a council would not seat it — its reason, its words, the amber "!".
    expect(byKey('codex')).toHaveAttribute('data-standing', 'ineligible');
    expect(byKey('codex').textContent).toContain('!');
    expect(byKey('codex').textContent).toContain('not council-eligible — signed out — a council would bench it');
    // Signed out but declared eligible: said so.
    expect(byKey('pi').textContent).toContain('signed out — still council-eligible');
    // Only the daemon's own ineligibility degrades the heart.
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'degraded');
    expect(seatStandingWord({ key: 'x', display_name: 'x', binary: 'x', enabled_for_council: true }).kind).toBe('unknown');
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

  it('the heart is NOT folded on the sign-in heuristic: healthy over signed-out seats alone, unhealthy over an inactive one', async () => {
    render(<Harness />);
    await screen.findAllByTestId('rail-seat-row');
    // codex is inactive here — unhealthy wins.
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'unhealthy');
    cleanup();
    rosterAnswer = SEATS.filter((s) => s.key !== 'codex');
    clearCachedRoster();
    render(<Harness />);
    await screen.findAllByTestId('rail-seat-row');
    // Two of three seats read signed_in:false (the rig's default roster shape) — a healthy daemon
    // must not wear a permanently degraded heart over a heuristic; the rows carry the amber "!".
    expect(screen.getByTestId('rail-health-heart')).toHaveAttribute('data-health', 'healthy');
    expect(screen.queryByTestId('rail-health-summary-dot')).toBeNull();
  });
});
