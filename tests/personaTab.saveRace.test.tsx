/**
 * A personality save or override removal settles the form from its own answer, on the scope it was made on (codex +
 * agy on #937): input typed while it was out is kept, a scope switched to meanwhile is left alone, and a kept draft
 * that matches the saved personality again is not dirty.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getPersonas = vi.fn();
const putPersona = vi.fn();
const removePersonaOverride = vi.fn();
vi.mock('../src/api/learn.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/learn.js')>()),
  getPersonas, putPersona, removePersonaOverride, getSetupKnown: vi.fn(async () => ({})),
}));
vi.mock('../src/store/firstRun.js', () => ({ useFirstRun: { getState: () => ({ markLearnUsed: async () => undefined }) } }));
vi.mock('../src/store/projects.js', () => {
  const state = { projects: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], load: async () => undefined };
  return { useProjectsStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

const { PersonaTab } = await import('../src/components/learn/PersonaTab.js');
const { DEFAULT_PERSONA } = await import('../src/board/learnHub.js');

const saved = (name: string, version: number) => ({ ...DEFAULT_PERSONA, name, version, updatedAt: version });
const response = (name: string, version: number, projects: Record<string, ReturnType<typeof saved>> = {}) =>
  ({ user: saved(name, version), projects, voice: { user: null, projects: {} } });
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => { resolve = r; }), resolve };
}
const nameBox = (): HTMLInputElement => screen.getByTestId('persona-name') as HTMLInputElement;
const saveButton = (): HTMLButtonElement => screen.getByTestId('persona-save') as HTMLButtonElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); getPersonas.mockReset(); putPersona.mockReset(); removePersonaOverride.mockReset(); });

describe('PersonaTab save', () => {
  it('a name typed while the save is out survives its answer, still unsaved', async () => {
    getPersonas.mockResolvedValueOnce(response('Ada', 1));
    const put = deferred<unknown>();
    putPersona.mockReturnValue(put.promise);
    render(<PersonaTab navigate={() => {}} project={null} />);
    await screen.findByTestId('persona-name');
    fireEvent.change(nameBox(), { target: { value: 'Grace' } });
    fireEvent.click(saveButton());
    fireEvent.change(nameBox(), { target: { value: 'Grace Hopper' } });
    await act(async () => { put.resolve({ scope: 'user', persona: saved('Grace', 2), voice: 'v' }); });
    await waitFor(() => expect(screen.getByText(/Saved as version 2/)).toBeTruthy());
    expect(nameBox().value).toBe('Grace Hopper');
    expect(saveButton().disabled).toBe(false);
    // back to the saved words: not dirty, though the kept draft began from version 1
    fireEvent.change(nameBox(), { target: { value: 'Grace' } });
    expect(saveButton().disabled).toBe(true);
  });

  it('with nothing typed since, the form settles to the saved personality from the save\u2019s own answer', async () => {
    getPersonas.mockResolvedValueOnce(response('Ada', 1));
    // the daemon answers with the saved personality as it keeps it (here: the name trimmed)
    putPersona.mockResolvedValue({ scope: 'user', persona: saved('Grace', 2), voice: 'v' });
    render(<PersonaTab navigate={() => {}} project={null} />);
    await screen.findByTestId('persona-name');
    fireEvent.change(nameBox(), { target: { value: 'Grace  ' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(/Saved as version 2/)).toBeTruthy());
    expect(saveButton().textContent).not.toMatch(/Saving/);
    expect(nameBox().value).toBe('Grace');
    expect(saveButton().disabled).toBe(true);
    expect(getPersonas).toHaveBeenCalledTimes(1);
  });

  it('removing an override shows the personality the project inherits now, read again', async () => {
    getPersonas.mockResolvedValueOnce(response('Ada', 1, { a: saved('Alpha bot', 3) }));
    removePersonaOverride.mockResolvedValue({ removed: true });
    render(<PersonaTab navigate={() => {}} project="a" />);
    await waitFor(() => expect(nameBox().value).toBe('Alpha bot'));
    // another tab saved the person's personality as Grace meanwhile
    getPersonas.mockResolvedValueOnce(response('Grace', 2));
    fireEvent.click(screen.getByTestId('persona-remove-override'));
    await waitFor(() => expect(nameBox().value).toBe('Grace'));
  });

  it('a removal that finishes after the person moved to another project leaves that project’s input alone', async () => {
    getPersonas.mockResolvedValue(response('Ada', 1, { a: saved('Alpha bot', 3), b: saved('Bob', 4) }));
    const del = deferred<unknown>();
    removePersonaOverride.mockReturnValue(del.promise);
    const { rerender } = render(<PersonaTab navigate={() => {}} project="a" />);
    await screen.findByTestId('persona-name');
    fireEvent.click(screen.getByTestId('persona-remove-override'));
    rerender(<PersonaTab navigate={() => {}} project="b" />);
    await waitFor(() => expect(nameBox().value).toBe('Bob'));
    fireEvent.change(nameBox(), { target: { value: 'New Bob' } });
    await act(async () => { del.resolve({ removed: true }); });
    expect(nameBox().value).toBe('New Bob');
    expect(screen.queryByText(/uses yours again/)).toBeNull();
  });
});
