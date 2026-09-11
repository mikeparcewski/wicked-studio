// F-4R2-003 — the document's NAME before Create. The launch composer shows the id the bridge
// will mint (its own slug of the quoted name or the brief's first six words), live, editable;
// the create sends the edited name; a 409 still names the colliding document with a link and
// offers "use a different name" inline — never only the daemon's sentence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';

const createDoc = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  UNFILED_MOUNT: 'default',
  createDoc: (...a: unknown[]) => createDoc(...a),
  docBinding: (pid: string) => (pid === 'default' ? {} : { project: pid }),
  postFork: vi.fn(),
  postEvent: vi.fn(),
  injectDocMessage: vi.fn(),
  getVersions: vi.fn(),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjectMembers: async () => ({ members: [] }),
    listRepos: async () => ({ repos: [] }),
  },
}));

const { DocumentThread } = await import('../src/components/DocumentThread.js');
const { useDocThreadStore } = await import('../src/store/docThread.js');

const PROJECT = 'proj-abc';
const navigate = vi.fn();
const BRIEF = 'Create a high-end, salesy product brochure for Wicked Studio — two pages, A4.';
const DERIVED = 'create-a-high-end-salesy-product-brochure';

function mount(): void {
  render(<DocumentThread projectId={PROJECT} docId={null} selectedVersion={null} navigate={navigate} />);
}

/** The launch composer refuses to submit until the project's repositories are known (F-046). */
async function subjectReady(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('doc-subject')).toHaveAttribute('data-subject-status', 'ready'));
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, bindings: {}, held: {} });
  createDoc.mockImplementation((_p: string, body: { name: string }) =>
    Promise.resolve({ name: body.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), head: 0, generating: true }));
});
afterEach(cleanup);

describe('the name field on the launch composer', () => {
  it('shows the bridge\'s own slug of the brief live, and a quoted name when the ask carries one', async () => {
    mount();
    const name = screen.getByTestId('doc-name') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(screen.getByTestId('doc-name-row')).toHaveAttribute('data-derived', 'true');
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: BRIEF } });
    expect(name.value).toBe(DERIVED);
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: 'a brochure titled "Wicked Studio brochure r2" for leaders' } });
    expect(name.value).toBe('wicked-studio-brochure-r2');
    // The quoted-parse line still renders beside it (§7.3 — unchanged).
    expect(screen.getByTestId('create-parse').textContent).toContain('Wicked Studio brochure r2');
  });

  it('an edited name wins the create and stops following the brief; "use the derived name" returns to it', async () => {
    mount();
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: BRIEF } });
    fireEvent.change(screen.getByTestId('doc-name'), { target: { value: 'brochure-r3' } });
    expect(screen.getByTestId('doc-name-row')).toHaveAttribute('data-derived', 'false');
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: `${BRIEF} Premium.` } });
    expect((screen.getByTestId('doc-name') as HTMLInputElement).value).toBe('brochure-r3');

    await subjectReady();
    fireEvent.click(screen.getByTestId('doc-composer-submit'));
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    expect(createDoc.mock.calls[0]![1]).toMatchObject({ name: 'brochure-r3', brief: `${BRIEF} Premium.` });
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/brochure-r3`);
    // The pending binding was claimed under the typed name's slug — the id every frame carries.
    expect(Object.keys(useDocThreadStore.getState().bindings)).toEqual(['brochure-r3']);
  });

  it('the reset control returns to the derived name', () => {
    mount();
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: BRIEF } });
    fireEvent.change(screen.getByTestId('doc-name'), { target: { value: 'my-name' } });
    fireEvent.click(screen.getByTestId('doc-name-reset'));
    expect((screen.getByTestId('doc-name') as HTMLInputElement).value).toBe(DERIVED);
    expect(screen.queryByTestId('doc-name-reset')).toBeNull();
  });
});

describe('a 409 names the colliding document and offers a way out (F-4R2-003)', () => {
  it('the daemon\'s 409 renders the collision copy with a link to the existing doc and "use a different name"', async () => {
    createDoc.mockRejectedValueOnce(new ApiError(409, 'doc already exists'));
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('doc-composer'), BRIEF);
    await user.click(screen.getByTestId('doc-composer-submit'));

    const err = await screen.findByTestId('doc-composer-error');
    expect(err).toHaveAttribute('data-status', '409');
    expect(err).toHaveAttribute('data-collides-with', DERIVED);
    expect(err.textContent).toContain(`A document named “${DERIVED}” already exists`);
    // The daemon's own sentence stays, whole.
    expect(err.textContent).toContain('doc already exists');
    // The brief is kept — nothing was sent, nothing lost.
    expect(screen.getByTestId('doc-composer')).toHaveValue(BRIEF);
    // The pending claim was released.
    expect(Object.keys(useDocThreadStore.getState().bindings)).toEqual([]);

    const open = screen.getByTestId('doc-composer-open-existing');
    expect(open).toHaveAttribute('href', `/p/${PROJECT}/document/${DERIVED}`);
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DERIVED}`);

    // "use a different name" puts the next free-looking name in the field and clears the collision.
    fireEvent.click(screen.getByTestId('doc-composer-rename'));
    expect((screen.getByTestId('doc-name') as HTMLInputElement).value).toBe(`${DERIVED}-2`);
    expect(screen.queryByTestId('doc-composer-error')).toBeNull();

    // The retried create carries the new name.
    await user.click(screen.getByTestId('doc-composer-submit'));
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(2));
    expect(createDoc.mock.calls[1]![1]).toMatchObject({ name: `${DERIVED}-2` });
  });

  it('a numbered name increments on the way out', async () => {
    createDoc.mockRejectedValueOnce(new ApiError(409, 'doc already exists'));
    mount();
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: BRIEF } });
    fireEvent.change(screen.getByTestId('doc-name'), { target: { value: 'brochure-7' } });
    await subjectReady();
    fireEvent.click(screen.getByTestId('doc-composer-submit'));
    await screen.findByTestId('doc-composer-rename');
    fireEvent.click(screen.getByTestId('doc-composer-rename'));
    expect((screen.getByTestId('doc-name') as HTMLInputElement).value).toBe('brochure-8');
  });

  it('any other refusal keeps the plain composer error', async () => {
    createDoc.mockRejectedValueOnce(new ApiError(400, 'repo_not_in_project'));
    mount();
    fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: BRIEF } });
    await subjectReady();
    fireEvent.click(screen.getByTestId('doc-composer-submit'));
    const err = await screen.findByTestId('doc-composer-error');
    expect(err).not.toHaveAttribute('data-status');
    expect(err.textContent).toContain('repo_not_in_project — nothing was sent; edit and try again.');
  });
});
