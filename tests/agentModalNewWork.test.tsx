/**
 * What General settings' agents block did, now on the Agents tab's modal (operator 2026-10-16: "General
 * settings page doesn't need 'agents' block anymore"):
 *   - which agents new work uses (`wicked_default_clis`, the composers' key): "Use <agent> for new work";
 *   - an agent's free tier, said under it;
 *   - Sign out run here: crew's `POST /seats/:cli/logout` (crew#615) runs the agent's own sign-out command
 *     in a terminal — studio types nothing; a 404 (no documented sign-out) takes the offer away.
 * Sign in was already the modal's (it replaced the old sign-in panel everywhere, DES-seats-page §4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';

const getRoster = vi.fn();
const seatLogout = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { getRoster: (refresh?: string) => getRoster(refresh), getSeatRecord: () => Promise.resolve({ days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] }), seatLogout: (k: string, b: unknown) => seatLogout(k, b) },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({ acp: { byCli: {} } }), isDiagnosticsUnsupported: () => false }));
// The terminal opens the way the real one does on mount: through `open`.
vi.mock('../src/components/Terminal.js', async () => {
  const { useEffect } = await import('react');
  return {
    Terminal: (props: { open?: (c: number, r: number) => Promise<{ id: string }>; onOpenError?: (e: unknown) => void; initialInput?: string }) => {
      useEffect(() => {
        props.open?.(100, 30).then(
          ({ id }) => document.querySelector('[data-testid="mock-terminal"]')?.setAttribute('data-terminal-id', id),
          (e: unknown) => props.onOpenError?.(e),
        );
      }, []); // eslint-disable-line react-hooks/exhaustive-deps -- opens once, like the real terminal
      return <div data-testid="mock-terminal" data-initial-input={props.initialInput ?? ''} />;
    },
  };
});

const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');
const { ApiError } = await import('../src/api/errors.js');

const codex: RosterSeat = { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, auth: 'signed_in', login_check: 'live', probed_at: new Date().toISOString(), council_eligible: true, issues: [], logout_invocation: 'CODEX_HOME=/w/codex codex logout' };
const opencode = { key: 'opencode', display_name: 'OpenCode', binary: 'opencode', enabled_for_council: true, auth: 'not_required', login_check: 'live', probed_at: new Date().toISOString(), council_eligible: true, issues: [], free_tier: 'OpenCode Zen free models (no account needed)' } as unknown as RosterSeat;

beforeEach(() => {
  localStorage.clear();
  resetAgentsReads();
  clearCachedRoster();
  getRoster.mockReset().mockResolvedValue({ roster: [codex, opencode] });
  seatLogout.mockReset();
});
afterEach(() => { cleanup(); });

describe('the agent modal carries what General settings did', () => {
  it('Use <agent> for new work: on by default, off writes the stored defaults without it, on again adds it back', async () => {
    render(<AgentsPage search="?fix=codex" navigate={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    const toggle = within(dialog).getByTestId('agents-new-work-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(JSON.parse(localStorage.getItem('wicked_default_clis') ?? 'null')).toEqual(['opencode']);
    await waitFor(() => expect(within(dialog).getByTestId('agents-new-work-toggle')).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(within(dialog).getByTestId('agents-new-work-toggle'));
    expect(JSON.parse(localStorage.getItem('wicked_default_clis') ?? 'null')).toEqual(['opencode', 'codex']);
  });

  it('says an agent\'s free tier', async () => {
    render(<AgentsPage search="?fix=opencode" navigate={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'OpenCode' });
    expect(within(dialog).getByTestId('agents-free-tier')).toHaveTextContent('OpenCode Zen free models (no account needed)');
  });

  it('Sign out here runs the agent\'s own sign-out on studio\'s service in a terminal — nothing typed by studio', async () => {
    seatLogout.mockResolvedValue({ terminalId: 't-42', cli: 'codex', action: 'logout' });
    render(<AgentsPage search="?fix=codex" navigate={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    fireEvent.click(within(dialog).getByTestId('agents-signout-run'));
    const term = within(dialog).getByTestId('mock-terminal');
    await waitFor(() => expect(term).toHaveAttribute('data-terminal-id', 't-42'));
    expect(term).toHaveAttribute('data-initial-input', '');
    expect(seatLogout).toHaveBeenCalledExactlyOnceWith('codex', { cols: 100, rows: 30 });
  });

  it('a 404 (no documented sign-out) closes the terminal and takes the offer away', async () => {
    seatLogout.mockRejectedValue(new ApiError(404, 'no logout for seat codex'));
    render(<AgentsPage search="?fix=codex" navigate={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    fireEvent.click(within(dialog).getByTestId('agents-signout-run'));
    await waitFor(() => expect(within(dialog).queryByTestId('agents-signout-terminal')).toBeNull());
    expect(within(dialog).queryByTestId('agents-signout-run')).toBeNull();
    // The command to run yourself stays.
    expect(within(dialog).getByTestId('agents-signout-how')).toHaveTextContent('codex logout');
  });
});
