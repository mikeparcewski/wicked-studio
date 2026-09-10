// F-046 (studio half): the launch composer says what the document is ABOUT and in what FORMAT.
// The picked project repositories ride the create as `repo_refs` (crew validates and grounds on
// THEM — never the project's first member) and the picked format as `style`; nothing picked sends
// neither key, so crew infers the style from the brief's format words.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { useDocThreadStore } from '../src/store/docThread.js';

const PROJECT = 'proj-abc';
const DOC = 'launch-deck';

const createDoc = vi.fn();
const listProjectMembers = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
  docBinding: (pid: string) => (pid === 'default' ? {} : { project: pid }),
  postFork: vi.fn(),
  postEvent: vi.fn(),
  injectDocMessage: vi.fn(),
  getVersions: vi.fn(),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
  UNFILED_MOUNT: 'default',
}));

vi.mock('../src/api/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/api/client.js')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
      listRepos: (...a: unknown[]) => listRepos(...a),
    },
  };
});

function mount(projectId = PROJECT): void {
  render(<DocumentThread projectId={projectId} docId={null} selectedVersion={null} navigate={vi.fn()} />);
}

async function send(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('doc-composer'), text);
  await user.click(screen.getByTestId('doc-composer-submit'));
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {} });
  createDoc.mockResolvedValue({ name: DOC, head: 0, generating: true });
  listProjectMembers.mockResolvedValue({
    members: [
      { id: 'm1', project_id: PROJECT, member_kind: 'crew.repo', member_ref: 'repo-core', meta: null },
      { id: 'm2', project_id: PROJECT, member_kind: 'crew.repo', member_ref: 'repo-studio', meta: null },
      { id: 'm3', project_id: PROJECT, member_kind: 'crew.run', member_ref: 'run-1', meta: null },
    ],
  });
  listRepos.mockResolvedValue({
    repos: [
      { id: 'repo-core', name: 'wicked-core', root_path: '/src/wicked-core' },
      { id: 'repo-studio', name: 'wicked-studio', root_path: '/src/wicked-studio' },
    ],
  });
});

afterEach(() => {
  cleanup();
});

describe('the launch composer\'s subject + format picker (F-046)', () => {
  it('offers the project\'s crew.repo members by NAME and sends the picked ones as repo_refs, the picked format as style', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    const chips = screen.getAllByTestId('doc-subject-repo');
    expect(chips.map((c) => c.textContent)).toEqual(['wicked-core', 'wicked-studio']);
    expect(listProjectMembers).toHaveBeenCalledWith(PROJECT);

    fireEvent.click(chips[1]!); // wicked-studio → on
    expect(chips[1]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByTestId('doc-format'), { target: { value: 'brochure' } });

    await send('a high-end brochure about the product');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    expect(createDoc).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      kind: 'source', project: PROJECT, repo_refs: ['repo-studio'], style: 'brochure',
    }));
  });

  it('with nothing picked the create carries NEITHER key — crew infers the format from the brief', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    await send('a deck for the Q3 review');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect('repo_refs' in body).toBe(false);
    expect('style' in body).toBe(false);
  });

  it('toggling a chip off drops it again', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    const [core] = screen.getAllByTestId('doc-subject-repo');
    fireEvent.click(core!);
    fireEvent.click(core!);
    expect(core!.getAttribute('aria-pressed')).toBe('false');
    await send('notes');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    expect('repo_refs' in (createDoc.mock.calls[0]![1] as object)).toBe(false);
  });

  it('the Unfiled mount offers no repositories (an unbound doc cannot be about a project repo) but still offers the format', async () => {
    mount('default');
    expect(screen.getByTestId('doc-format')).toBeTruthy();
    expect(listProjectMembers).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryAllByTestId('doc-subject-repo')).toHaveLength(0);
  });
});
