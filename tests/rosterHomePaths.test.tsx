/**
 * Roster rows carry home paths (crew keeps them raw: studio posts the rows back as `POST /runs` clisJson, so crew
 * can't scrub them). Studio masks them on RENDER only: the Helpers page, every helper's dialog with every disclosure
 * open, and technical details turned on. The data sent back stays exactly as crew sent it. (coord, 2026-11-08)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';

const getRoster = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { getRoster: (refresh?: string) => getRoster(refresh), getSeatRecord: () => Promise.resolve({ days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] }) },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ acp: { byCli: {} }, seatGovernance: { rosterFile: null, hostBoundary: 'sandbox-exec', seats: [] } }),
  isDiagnosticsUnsupported: () => false,
}));

const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');
const { useViewPrefsStore } = await import('../src/store/viewPrefs.js');
const { docClisJson } = await import('../src/board/docSeats.js');

const MAC = ['', 'Users', 'alice'].join('/');
const LINUX = ['', 'home', 'alice'].join('/');
const WIN = ['C:', 'Users', 'alice'].join('\\');
const LEAK = new RegExp([MAC, LINUX, WIN.replace(/\\/g, '\\\\')].map((s) => s.replace(/\//g, '\\/')).join('|'));

/** Every string a roster row can carry, with a home path in it. */
const seat = (key: string, name: string, extra: Record<string, unknown> = {}): RosterSeat => ({
  key, display_name: name, binary: `${MAC}/.local/bin/${key}`, alt_binaries: [`${LINUX}/bin/${key}`],
  headless_invocation: `${MAC}/.local/bin/${key} -p "{PROMPT}"`, enabled_for_council: true,
  login_invocation: `CLAUDE_CONFIG_DIR="${MAC}/.wicked-worker/${key}" ${key}`,
  logout_invocation: `CLAUDE_CONFIG_DIR="${WIN}\\.wicked-worker\\${key}" ${key} auth logout`,
  login_note: `broker credential at ${MAC}/.wicked/broker/${key}.json`,
  council_ineligible_reason: `no credential at ${LINUX}/.config/${key}`,
  health: { status: 'inactive', since: new Date().toISOString(), message: `spawn ${MAC}/.local/bin/${key} ENOENT` },
  version: { installed: `2.1.0 (${MAC}/.local/bin/${key})`, checked_at: new Date().toISOString(), install_source: 'brew', status: 'no_pin', proven: null },
  acp: { binary: `${MAC}/.npm/bin/${key}-acp`, start_args: [], transport: 'stdio' },
  issues: [{ code: 'signed_out', severity: 'problem', params: { path: `${MAC}/.config/${key}` }, message: `${name} is signed out (${MAC}/.config/${key})`,
    commands: [{ purpose: 'sign_in', display: `CLAUDE_CONFIG_DIR="${MAC}/.wicked-worker/${key}" ${key}` }] }],
  auth: 'signed_out', signed_in: false, login_check: 'status', council_eligible: false, ...extra,
} as unknown as RosterSeat);
const NOT_INSTALLED = { installed: null, checked_at: new Date().toISOString(), install_source: null, status: 'unreadable', proven: null, error: `${MAC}/.local/bin/opencode: not found` };
const ROSTER = [seat('claude', 'Claude Code'), seat('codex', 'Codex', { auth: 'unknown', signed_in: null }), seat('opencode', 'opencode', { version: NOT_INSTALLED })];

function scan(root: HTMLElement): string[] {
  const hits: string[] = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) if (LEAK.test(a.value)) hits.push(`${el.tagName}@${a.name}: ${a.value.slice(0, 120)}`);
    for (const n of [...el.childNodes]) if (n.nodeType === 3 && LEAK.test(n.nodeValue ?? '')) hits.push(`${el.tagName}: ${(n.nodeValue ?? '').slice(0, 120)}`);
  }
  return hits;
}
const openAll = (): void => { for (const d of document.querySelectorAll('details')) d.setAttribute('open', ''); };

beforeEach(() => {
  resetAgentsReads();
  clearCachedRoster();
  getRoster.mockReset().mockResolvedValue({ roster: structuredClone(ROSTER) });
  useViewPrefsStore.setState({ prefs: { technical_details: true } });
});
afterEach(() => { cleanup(); useViewPrefsStore.setState({ prefs: { technical_details: false } }); });

describe('roster home paths never reach the DOM (masked on render)', () => {
  it('the Helpers page', async () => {
    render(<AgentsPage search="" navigate={() => {}} />);
    await screen.findAllByTestId('agents-row');
    openAll();
    expect(scan(document.body)).toEqual([]);
  });

  it.each(['claude', 'codex', 'opencode'])('the %s dialog, every disclosure open, technical details on', async (key) => {
    render(<AgentsPage search={`?fix=${key}`} navigate={() => {}} />);
    await screen.findByTestId('agents-modal');
    await waitFor(() => expect(document.querySelector('[data-testid="agents-modal"]')!.textContent).not.toBe(''));
    openAll();
    expect(scan(document.body)).toEqual([]);
    // The fields did render, masked (a command reads $HOME, a reason or version ~/…), except opencode's one problem.
    if (key !== 'opencode') expect(document.body.textContent).toMatch(/\$HOME|~[\\/]/);
  });

  it('negative control: the scan finds each home spelling', () => {
    const d = document.createElement('div');
    d.innerHTML = `<p>${MAC}/x</p><span title="${LINUX}/y"></span><i>${WIN}\\z</i>`;
    expect(scan(d)).toHaveLength(3);
  });

  it('the rows sent back to crew stay exactly as crew sent them', () => {
    const raw = structuredClone(ROSTER);
    expect(JSON.parse(docClisJson(raw, new Set(['claude', 'codex'])))).toEqual(raw.slice(0, 2));
  });
});
