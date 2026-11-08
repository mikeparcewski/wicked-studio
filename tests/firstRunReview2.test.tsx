/**
 * first-run review r2 (2026-11-08): the helper picker never shows a home path; a signed-in helper whose refusal says
 * "signed in" is not "signed out"; one unknown helper is not counted out on New document.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RosterSeat } from '../src/api/types.js';
import { cliOptions } from '../src/board/chatCli.js';
import { ChatCliPicker } from '../src/components/chat/ChatCliPicker.js';

let ROSTER: RosterSeat[] = [];
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => ROSTER }));
vi.mock('../src/api/client.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/client.js')>()),
  api: new Proxy({}, { get: () => () => Promise.resolve({ members: [], repos: [] }) }),
  apiFetch: () => Promise.resolve({}),
}));
const { NewDocument } = await import('../src/components/everything/NewDocument.js');

afterEach(cleanup);
const home = ['', 'Users', 'alice', '.config', 'secret'].join('/');
const seat = (extra: Record<string, unknown>): RosterSeat => ({ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, ...extra } as unknown as RosterSeat);

describe('the helper picker (P1 privacy)', () => {
  it('a refusal naming a home path reads ~/… in the open menu', () => {
    const opts = cliOptions([seat({ auth: 'signed_out', signed_in: false, chat_admission: { unscoped: { ok: false, reason: `signed out — no credential at ${home}` }, scoped: { ok: false, reason: 'x' } } })], false);
    render(<ChatCliPicker options={opts} value={null} onChange={() => {}} locked={false} />);
    fireEvent.click(screen.getByTestId('chat-cli'));
    const menu = screen.getByTestId('chat-cli-menu');
    expect(menu.textContent).toContain('~/.config/secret');
    expect(menu.innerHTML).not.toContain(['', 'Users', ''].join('/'));
  });
});

describe('signed in is not signed out (chat drawer)', () => {
  it('a signed-in helper refused with "status command says signed in, but …" is not sent to sign in', () => {
    const [o] = cliOptions([seat({ auth: 'signed_in', signed_in: true, chat_admission: { unscoped: { ok: false, reason: 'status command says signed in, but its one live request did not answer' } } })], false);
    expect(o!.signInPath).toBeNull();
  });
  it('crew\'s auth "unknown" while Docker is down is not signed out either', () => {
    const [o] = cliOptions([seat({ auth: 'unknown', signed_in: null, chat_admission: { unscoped: { ok: false, reason: "Docker isn't running" } } })], false);
    expect(o!.signInPath).toBeNull();
  });
});

describe('New document with one unknown helper', () => {
  it('states the two-helper rule without claiming none can work', () => {
    ROSTER = [seat({ auth: 'unknown', signed_in: null })];
    render(<NewDocument projects={[]} initialProject={null} onClose={() => {}} onCreated={() => {}} onOpen={() => {}} />);
    const line = screen.getByTestId('made-new-document-council');
    expect(line).toHaveTextContent('A document needs two helpers that can work now');
    expect(line).not.toHaveTextContent(/None can work now|Only one can work now/);
  });
});
