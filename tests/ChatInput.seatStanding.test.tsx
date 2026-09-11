import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * The composer's seat warning tells the SAME story as the Health rail (acceptance finding
 * F-A45-006, studio half): both read the roster through `seatStandingWord` — crew#533's `auth` /
 * `council_eligible` / `free_tier` first (api-types 0.35.0), the `signed_in` heuristic as the
 * fallback. On the A45 rig the composer said "codex + opencode aren't signed in" while the rail
 * showed opencode green "no sign-in needed": opencode reads `signed_in: false` from the file/env
 * heuristic AND `auth: 'not_required'` from the daemon — the daemon's word wins on both surfaces.
 */

function seat(overrides: Partial<RosterSeat> & { key: string }): RosterSeat {
  return { display_name: overrides.key, binary: overrides.key, enabled_for_council: true, ...overrides };
}

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLocalStorage();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});
afterEach(() => vi.unstubAllGlobals());

const bag = (o: Record<string, unknown>): Partial<RosterSeat> => o as Partial<RosterSeat>;

describe('ChatInput seat warning — one fold with the Health rail (F-A45-006)', () => {
  it('a seat the daemon marks `auth: not_required` (a provider free tier) is NOT a sign-in problem, whatever `signed_in` reads — codex alone is named', async () => {
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', signed_in: true, ...bag({ auth: 'signed_in' }) }),
        seat({ key: 'codex', signed_in: false, ...bag({ auth: 'signed_out' }) }),
        seat({ key: 'opencode', signed_in: false, ...bag({ auth: 'not_required', free_tier: 'opencode zen', council_eligible: true }) }),
      ],
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const warning = await screen.findByTestId('signin-warning');
    expect(warning).toHaveTextContent("⚠ codex isn't signed in — runs routed there will fall back or fail. Sign in in Settings.");
    expect(warning).not.toHaveTextContent('opencode');
    expect(screen.queryByTestId('ineligible-warning')).toBeNull();
  });

  it('`auth: signed_out` warns even when the `signed_in` heuristic is null — the daemon\'s word, not the file check', async () => {
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [seat({ key: 'claude', signed_in: true }), seat({ key: 'pi', signed_in: null, ...bag({ auth: 'signed_out' }) })],
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    expect(await screen.findByTestId('signin-warning')).toHaveTextContent("pi isn't signed in");
  });

  it('a seat the daemon says a council would NOT seat gets its own sentence with the daemon\'s reason — not the sign-in one', async () => {
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', signed_in: true }),
        seat({ key: 'pi', signed_in: true, ...bag({ auth: 'signed_in', council_eligible: false, council_ineligible_reason: 'pi-acp answered 401 Unauthorized on the last ballot' }) }),
      ],
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const w = await screen.findByTestId('ineligible-warning');
    expect(w).toHaveTextContent('pi: not council-eligible — pi-acp answered 401 Unauthorized on the last ballot — a council benches it; the other seats carry the run.');
    expect(screen.queryByTestId('signin-warning')).toBeNull();
  });

  it('a pre-0.35.0 roster (no auth fields) keeps the `signed_in === false` heuristic — nothing regresses', async () => {
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [seat({ key: 'claude', signed_in: true }), seat({ key: 'codex', signed_in: false }), seat({ key: 'agy' })],
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const warning = await screen.findByTestId('signin-warning');
    expect(warning).toHaveTextContent("codex isn't signed in");
    expect(warning).not.toHaveTextContent('agy');
  });

  it('every selected seat standing well ⇒ no warning of either kind', async () => {
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', ...bag({ auth: 'signed_in' }) }),
        seat({ key: 'opencode', signed_in: false, ...bag({ auth: 'not_required' }) }),
      ],
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.getRoster).toHaveBeenCalled());
    await screen.findByPlaceholderText(/./);
    expect(screen.queryByTestId('signin-warning')).toBeNull();
    expect(screen.queryByTestId('ineligible-warning')).toBeNull();
  });
});
