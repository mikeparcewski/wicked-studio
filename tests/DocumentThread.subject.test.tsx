// F-046 (studio half): the launch composer says what the document (or demo) is ABOUT and, for a
// document, in what FORMAT. The picked project repositories ride the create as `repo_refs` (crew
// validates and grounds on THEM — never the project's first member) and the picked format as
// `style`; nothing picked sends neither key, so crew infers the style from the brief's format words.
// Discovery can FAIL, and a failure is never a silently ungrounded create (codex on #241): the
// composer refuses to submit until the repositories loaded, or until the user explicitly chooses
// to go without — which the thread then records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { NO_GROUNDING_NARRATION } from '../src/components/DocSubjectPicker.js';
import { BARE_FRAME_HOLD_MS, threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

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

function mount(projectId = PROJECT, mode: 'document' | 'video' = 'document'): { rerender: (projectId: string) => void } {
  const view = render(<DocumentThread projectId={projectId} docId={null} selectedVersion={null} navigate={vi.fn()} mode={mode} />);
  return {
    rerender: (next: string) =>
      view.rerender(<DocumentThread projectId={next} docId={null} selectedVersion={null} navigate={vi.fn()} mode={mode} />),
  };
}

async function type(text: string): Promise<void> {
  await userEvent.setup().type(screen.getByTestId('doc-composer'), text);
}

async function send(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('doc-composer'), text);
  await user.click(screen.getByTestId('doc-composer-submit'));
}

function submitButton(): HTMLButtonElement {
  return screen.getByTestId('doc-composer-submit') as HTMLButtonElement;
}

const TWO_REPOS = {
  members: [
    { id: 'm1', project_id: PROJECT, member_kind: 'crew.repo', member_ref: 'repo-core', meta: null },
    { id: 'm2', project_id: PROJECT, member_kind: 'crew.repo', member_ref: 'repo-studio', meta: null },
    { id: 'm3', project_id: PROJECT, member_kind: 'crew.run', member_ref: 'run-1', meta: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, bindings: {}, held: {} });
  createDoc.mockResolvedValue({ name: DOC, head: 0, generating: true });
  listProjectMembers.mockResolvedValue(TWO_REPOS);
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

  it('with nothing picked (repositories LOADED) the create carries NEITHER key — crew infers the format from the brief and grounds by its own rules', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    await send('a deck for the Q3 review');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect('repo_refs' in body).toBe(false);
    expect('style' in body).toBe(false);
    // Nothing went wrong, so the thread carries no "without grounding" line.
    const msgs: DocMsg[] = useDocThreadStore.getState().messages[threadKey(PROJECT, DOC)] ?? [];
    expect(msgs.some((m) => 'text' in m && m.text === NO_GROUNDING_NARRATION)).toBe(false);
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

  it('the Unfiled mount offers no repositories (an unbound doc cannot be about a project repo) but still offers the format, and submits', async () => {
    mount('default');
    expect(screen.getByTestId('doc-format')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(listProjectMembers).not.toHaveBeenCalled();
    expect(listRepos).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('doc-subject-repo')).toHaveLength(0);
    expect(screen.queryByTestId('doc-subject-loading')).toBeNull();
    await type('an unfiled note');
    expect(submitButton().disabled).toBe(false);
  });

  it('a project with NO repositories says so and submits — there is nothing to pick', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    mount();
    await waitFor(() => expect(screen.getByTestId('doc-subject-none')).toBeTruthy());
    await type('notes for a repo-less project');
    expect(submitButton().disabled).toBe(false);
  });

  it('a pick made for one project never rides a create in another — the context change resets it (Copilot on #241)', async () => {
    const { rerender } = mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('doc-subject-repo')[1]!); // wicked-studio → on
    fireEvent.change(screen.getByTestId('doc-format'), { target: { value: 'ppt' } });
    expect(screen.getAllByTestId('doc-subject-repo')[1]!.getAttribute('aria-pressed')).toBe('true');

    listProjectMembers.mockResolvedValue({
      members: [{ id: 'm9', project_id: 'proj-other', member_kind: 'crew.repo', member_ref: 'repo-core', meta: null }],
    });
    rerender('proj-other');
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(1));
    expect(screen.getAllByTestId('doc-subject-repo')[0]!.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByTestId('doc-format') as HTMLSelectElement).value).toBe('');

    await send('a deck for the other project');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect(createDoc.mock.calls[0]![0]).toBe('proj-other');
    expect('repo_refs' in body).toBe(false);
    expect('style' in body).toBe(false);
  });

  it('a successful create clears the picks so the next launch starts clean', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('doc-subject-repo')[0]!);
    await send('first brochure');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    expect((createDoc.mock.calls[0]![1] as Record<string, unknown>).repo_refs).toEqual(['repo-core']);
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')[0]!.getAttribute('aria-pressed')).toBe('false'));
  });
});

describe('repository discovery can fail — never a silently ungrounded create (codex on #241)', () => {
  it('while the repositories are LOADING the composer will not submit', async () => {
    let resolveMembers: (v: unknown) => void = () => undefined;
    listProjectMembers.mockReturnValue(new Promise((r) => { resolveMembers = r; }));
    mount();
    expect(screen.getByTestId('doc-subject-loading')).toBeTruthy();
    await type('a deck');
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(createDoc).not.toHaveBeenCalled();
    resolveMembers(TWO_REPOS);
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    expect(submitButton().disabled).toBe(false);
  });

  it('a FAILED read is visible, blocks submit, and RETRY re-fetches and unblocks', async () => {
    listProjectMembers.mockRejectedValueOnce(new Error('the daemon refused this — members unavailable'));
    mount();
    await waitFor(() => expect(screen.getByTestId('doc-subject-error')).toBeTruthy());
    expect(screen.getByTestId('doc-subject-error').textContent).toContain('members unavailable');
    expect(screen.queryAllByTestId('doc-subject-repo')).toHaveLength(0);
    await type('a deck');
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(createDoc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('doc-subject-retry'));
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    expect(listProjectMembers).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('doc-subject-error')).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('after a failed read the user may EXPLICITLY create without repository grounding — the create carries no repo_refs and the thread says so', async () => {
    listProjectMembers.mockRejectedValue(new Error('members unavailable'));
    mount();
    await waitFor(() => expect(screen.getByTestId('doc-subject-error')).toBeTruthy());
    fireEvent.click(screen.getByTestId('doc-subject-nogrounding'));
    await type('a brochure anyway');
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(submitButton());
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    expect('repo_refs' in (createDoc.mock.calls[0]![1] as object)).toBe(false);
    const msgs: DocMsg[] = useDocThreadStore.getState().messages[threadKey(PROJECT, DOC)] ?? [];
    expect(msgs.some((m) => m.kind === 'narration' && m.text === NO_GROUNDING_NARRATION)).toBe(true);
  });
});

describe('the create-time binding (F-045, codex on #241 / r3): a bare frame that arrives BEFORE the create answers files on the project thread', () => {
  it('claims the bridge\'s CANONICAL slug — not the human name — when the create is sent; a slug-keyed frame that arrives while the create is pending and the hold deadline passes still lands on the project thread, exactly once, and never under Unfiled — through navigation and mount', async () => {
    vi.useFakeTimers();
    try {
      let resolveCreate: (v: unknown) => void = () => undefined;
      createDoc.mockReturnValue(new Promise((r) => { resolveCreate = r; }));
      const navigate = vi.fn();
      const view = render(<DocumentThread projectId={PROJECT} docId={null} selectedVersion={null} navigate={navigate} mode="document" />);
      // The picker's discovery resolves; flush it under fake timers.
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2);
      // A HUMAN name (quoted) — the bridge will answer with its slug.
      fireEvent.change(screen.getByTestId('doc-composer'), { target: { value: '"Q3 Board Deck" for the leadership review' } });
      fireEvent.click(screen.getByTestId('doc-composer-submit'));
      await act(async () => { await Promise.resolve(); });
      expect(createDoc).toHaveBeenCalledTimes(1);
      const sentName = (createDoc.mock.calls[0]![1] as { name: string }).name;
      expect(sentName).toBe('Q3 Board Deck');
      const slug = 'q3-board-deck';
      // The claim is under the SLUG.
      expect(useDocThreadStore.getState().bindings[slug]).toEqual([{ projectId: PROJECT, pending: true }]);
      expect(useDocThreadStore.getState().bindings[sentName]).toBeUndefined();

      // Crew's pickup frame (slug-keyed, no project) arrives before the bridge has answered…
      useDocThreadStore.getState().ingest({
        type: 'interactiveEvent',
        event: { event_type: 'wicked.interactive.status.posted', payload: { document_id: slug, state: 'processing', message: 'A governed crew picked up your brief' } },
      } as unknown as import('../src/api/types.js').CoreEvent);
      // …and the hold deadline passes while the create is STILL pending: nothing expires anywhere.
      vi.advanceTimersByTime(BARE_FRAME_HOLD_MS + 1);
      const onProject = (): DocMsg[] => useDocThreadStore.getState().messages[threadKey(PROJECT, slug)] ?? [];
      expect(onProject().filter((m) => 'text' in m && m.text === 'A governed crew picked up your brief')).toHaveLength(1);
      expect(useDocThreadStore.getState().messages[threadKey('default', slug)]).toBeUndefined();
      expect(useDocThreadStore.getState().held[slug]).toBeUndefined();

      // The bridge answers with the slug; the composer navigates; the thread mounts for the slug.
      resolveCreate({ name: slug, head: 0, generating: true });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(navigate).toHaveBeenCalled();
      view.rerender(<DocumentThread projectId={PROJECT} docId={slug} selectedVersion={null} navigate={navigate} mode="document" />);
      await act(async () => { await Promise.resolve(); });
      // The mount ADOPTED the pending claim: one registration, mounted.
      expect(useDocThreadStore.getState().bindings[slug]).toEqual([{ projectId: PROJECT, pending: false }]);
      // Exactly ONE copy of the early frame, on the project thread; Unfiled never heard of it.
      vi.advanceTimersByTime(BARE_FRAME_HOLD_MS + 1);
      expect(onProject().filter((m) => 'text' in m && m.text === 'A governed crew picked up your brief')).toHaveLength(1);
      expect(onProject().filter((m) => m.kind === 'user')).toHaveLength(1);
      expect(useDocThreadStore.getState().messages[threadKey('default', slug)]).toBeUndefined();
      // A later bare frame files straight onto the mounted thread.
      useDocThreadStore.getState().ingest({
        type: 'interactiveEvent',
        event: { event_type: 'wicked.interactive.status.posted', payload: { document_id: slug, state: 'working', message: 'Convening a council' } },
      } as unknown as import('../src/api/types.js').CoreEvent);
      expect(onProject().some((m) => 'text' in m && m.text === 'Convening a council')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a REFUSED create releases the pending claim — a later bare frame for that slug is not filed on the project', async () => {
    createDoc.mockRejectedValue(new Error('the daemon refused this — repo_not_in_project'));
    mount();
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    await send('a refused brief');
    await waitFor(() => expect(screen.getByTestId('doc-composer-error')).toBeTruthy());
    const sentName = (createDoc.mock.calls[0]![1] as { name: string }).name;
    expect(useDocThreadStore.getState().bindings[sentName]).toBeUndefined();
    expect(Object.keys(useDocThreadStore.getState().bindings)).toEqual([]);
  });
});

describe('the video (demo) launch composer picks the app\'s repositories too (codex on #241)', () => {
  it('renders the repository toggles AND the format select — a demo carries its format on the create like a document (codex on #241)', async () => {
    mount(PROJECT, 'video');
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    expect(screen.getByTestId('doc-format')).toBeTruthy();
  });

  it('UI → wire: a format picked on the Video composer (and a repository) rides the wizard\'s create as style + repo_refs (codex r3 on #241)', async () => {
    mount(PROJECT, 'video');
    await waitFor(() => expect(screen.getAllByTestId('doc-subject-repo')).toHaveLength(2));
    fireEvent.change(screen.getByTestId('doc-format'), { target: { value: 'ppt' } });
    fireEvent.click(screen.getAllByTestId('doc-subject-repo')[1]!); // wicked-studio
    const user = userEvent.setup();
    await user.type(screen.getByTestId('doc-composer'), 'a walkthrough of the checkout flow');
    await user.click(screen.getByTestId('doc-composer-submit'));
    await screen.findByTestId('demo-wizard');
    await user.type(screen.getByTestId('wizard-target'), 'https://shop.example/');
    createDoc.mockResolvedValue({ name: 'a-walkthrough-of-the-checkout-flow', head: 0, kind: 'demo', learning: true });
    await user.click(screen.getByTestId('wizard-create'));
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.kind).toBe('demo');
    expect(body.url).toBe('https://shop.example/');
    expect(body.style).toBe('ppt');
    expect(body.repo_refs).toEqual(['repo-studio']);
  });

  it('a failed discovery blocks the demo launch the same way', async () => {
    listProjectMembers.mockRejectedValue(new Error('nope'));
    mount(PROJECT, 'video');
    await waitFor(() => expect(screen.getByTestId('doc-subject-error')).toBeTruthy());
    await type('a demo of the checkout');
    expect(submitButton().disabled).toBe(true);
  });
});
