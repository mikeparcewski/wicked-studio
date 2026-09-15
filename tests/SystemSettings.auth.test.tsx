// fixall L8-8E(v) — System reads seat standing off the roster's `auth` (F-E2E-040 = F-RC2-043,
// F-004/013/010, studio #280 item 4; BC-56) through the health rail's `seatStandingWord` fold: the
// four `auth` tokens, the `seat-stderr` relabel to **Re-authenticate**, and the settings path from
// `GET /settings.path` (crew 0.7.36; absent ⇒ said, never a fabricated home-relative literal).
// Same harness as SystemSettings.seats.test.tsx, whose legacy `signed_in` pins still hold.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';
import type { RosterSeat } from '../src/api/types.js';

vi.mock('../src/components/Terminal.js', () => ({
  Terminal: (props: { cwd: string; cmd?: string[]; initialInput?: string }) => (
    <div data-testid="mock-terminal" data-initial-input={props.initialInput ?? ''} />
  ),
}));

function seat(overrides: Partial<RosterSeat> & Record<string, unknown> & { key: string }): RosterSeat {
  return { display_name: overrides.key, binary: overrides.key, enabled_for_council: true, ...overrides } as RosterSeat;
}

const ROSTER: RosterSeat[] = [
  seat({ key: 'claude', display_name: 'Claude Code', login_invocation: 'claude login', auth: 'signed_in' }),
  seat({ key: 'codex', display_name: 'Codex', login_invocation: 'codex auth login', auth: 'signed_out' }),
  // The seat's OWN stderr reported the failure — the row says so and offers Re-authenticate.
  seat({ key: 'agy', display_name: 'Antigravity', login_invocation: 'agy login', auth: 'signed_out', auth_source: 'seat-stderr', auth_evidence: 'No API key found' }),
  seat({ key: 'pi', display_name: 'Pi', auth: 'not_required', free_tier: 'gemini free' }),
  seat({ key: 'opencode', display_name: 'OpenCode', login_invocation: 'opencode auth', auth: 'unknown' }),
  // No `auth`, no `signed_in` — an older daemon: nothing is said.
  seat({ key: 'localonly', display_name: 'Local' }),
];

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
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ROSTER });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('System — seat rows read `auth`', () => {
  it('renders the four auth tokens, relabels a seat-stderr failure, and offers Re-authenticate for it', async () => {
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('seat-signin-claude')).toBeInTheDocument());

    expect(screen.getByTestId('seat-signin-claude')).toHaveTextContent('✓ signed in');
    expect(screen.getByTestId('seat-signin-codex')).toHaveTextContent('sign in needed');
    expect(screen.getByTestId('seat-signin-agy')).toHaveTextContent('sign-in failed: No API key found');
    expect(screen.getByTestId('seat-signin-agy').dataset.authSource).toBe('seat-stderr');
    // #1: the status word stays terse; the free tier moves to its own small line below.
    expect(screen.getByTestId('seat-signin-pi')).toHaveTextContent('no sign-in needed');
    expect(screen.getByTestId('seat-signin-pi')).not.toHaveTextContent('gemini free');
    expect(screen.getByTestId('seat-freetier-pi')).toHaveTextContent('gemini free');
    expect(screen.getByTestId('seat-signin-opencode')).toHaveTextContent('auth unknown');
    expect(screen.queryByTestId('seat-signin-localonly')).toBeNull();

    // Buttons: signed-in and not-required seats get none; signed-out/unknown seats with a login flow do.
    expect(screen.queryByRole('button', { name: /Sign in Claude Code/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-authenticate Antigravity' })).toHaveTextContent('Re-authenticate');
    expect(screen.queryByRole('button', { name: /Sign in Pi/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in OpenCode' })).toBeInTheDocument();
  });

  it('names the settings path the daemon reports; says so when the daemon does not report one', async () => {
    const spy = vi.spyOn(client.api, 'getSettings').mockResolvedValue(
      { settings: { graphNodeLimit: 150 }, path: '/srv/wicked/state/system-settings.json' } as Awaited<ReturnType<typeof client.api.getSettings>>,
    );
    const { unmount } = render(<SystemSettings />);
    await waitFor(() => expect(screen.getByText('/srv/wicked/state/system-settings.json')).toBeInTheDocument());
    expect(screen.queryByText(/does not report the path/)).toBeNull();
    unmount();

    spy.mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByText("the daemon's settings file")).toBeInTheDocument());
    expect(screen.getByText(/does not report the path — crew 0\.7\.36 does/)).toBeInTheDocument();
    expect(screen.queryByText(/wicked-core\/settings\.json/)).toBeNull(); // the hard-coded literal is gone
  });
});
