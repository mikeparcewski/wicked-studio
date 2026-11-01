/**
 * A personality save's refresh keeps what was typed while the save was out (codex on #937, P2): the form settles to
 * the saved personality only when it still holds what was saved.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getPersonas = vi.fn();
const putPersona = vi.fn();
vi.mock('../src/api/learn.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/learn.js')>()),
  getPersonas, putPersona, getSetupKnown: vi.fn(async () => ({})), removePersonaOverride: vi.fn(),
}));
vi.mock('../src/store/firstRun.js', () => ({ useFirstRun: { getState: () => ({ markLearnUsed: async () => undefined }) } }));

const { PersonaTab } = await import('../src/components/learn/PersonaTab.js');
const { DEFAULT_PERSONA } = await import('../src/board/learnHub.js');

const saved = (name: string, version: number) => ({ ...DEFAULT_PERSONA, name, version, updatedAt: version });
const response = (name: string, version: number) => ({ user: saved(name, version), projects: {}, voice: { user: null, projects: {} } });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PersonaTab save', () => {
  it('a name typed while the save is out survives the refresh, still unsaved', async () => {
    getPersonas.mockResolvedValueOnce(response('Ada', 1));
    let finish!: (v: unknown) => void;
    putPersona.mockReturnValue(new Promise((r) => { finish = r; }));
    render(<PersonaTab navigate={() => {}} project={null} />);
    const name = (await screen.findByTestId('persona-name')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Grace' } });
    fireEvent.click(screen.getByTestId('persona-save'));
    fireEvent.change(name, { target: { value: 'Grace Hopper' } });
    getPersonas.mockResolvedValueOnce(response('Grace', 2));
    await act(async () => { finish({ scope: 'user', persona: saved('Grace', 2), voice: 'v' }); });
    await waitFor(() => expect(getPersonas).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/Saved as version 2/)).toBeTruthy());
    expect((screen.getByTestId('persona-name') as HTMLInputElement).value).toBe('Grace Hopper');
    expect((screen.getByTestId('persona-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('with nothing typed since, the form settles to the saved personality', async () => {
    getPersonas.mockResolvedValueOnce(response('Ada', 1));
    putPersona.mockResolvedValue({ scope: 'user', persona: saved('Grace', 2), voice: 'v' });
    render(<PersonaTab navigate={() => {}} project={null} />);
    const name = (await screen.findByTestId('persona-name')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Grace' } });
    getPersonas.mockResolvedValueOnce(response('Grace', 2));
    fireEvent.click(screen.getByTestId('persona-save'));
    await waitFor(() => expect(getPersonas).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByTestId('persona-save') as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId('persona-name') as HTMLInputElement).value).toBe('Grace');
  });
});
