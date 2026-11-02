import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatOpenBody, ChatScope, RosterSeat } from '../src/api/types.js';

/**
 * DES-CHAT-ARTIFACTS-001 slice A1 (studio): the chat sees the artifact you have open.
 *  - A daemon without `chatArtifacts.context` is sent exactly what it was sent before (its message body is strict).
 *  - With it, studio's page summary rides as `context.page`, apart from the typed words, and the artifact on screen
 *    rides as `context.artifact` at the version shown AFTER its editor's writes in flight settle.
 *  - "Ask about this" puts the artifact chip on a composer on screen, else opens a chat with it (an Unfiled document
 *    seeds the chat's repositories from its binding).
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getRoster = vi.fn();
const getChat = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const listRunsForDoc = vi.fn();
const getHealth = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    listRunsForDoc: (...a: unknown[]) => listRunsForDoc(...a),
    getHealth: (...a: unknown[]) => getHealth(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  apiBase: () => '',
}));
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { AskDock } = await import('../src/components/AskDock.js');
const { setCachedRoster, clearCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { registerInView, resetInView, setAskAboutSeed, peekAskAboutSeed, takeAskAboutSeed, artifactContext, inViewFor, inViewAnywhere, placementEntry, noteWritten, noteShown } = await import('../src/store/artifactInView.js');
const { ApiError } = await import('../src/api/errors.js');
const { writeAskSession } = await import('../src/store/askSession.js');
const { useDocsCache } = await import('../src/store/docsCache.js');
const { addChip, artifactChip, artifactOfChips, messageWithAbout } = await import('../src/board/aboutChips.js');
const { askAbout, askAboutRoute } = await import('../src/board/askAbout.js');
const { useComposerChips } = await import('../src/store/composerChips.js');
const { useAskDock } = await import('../src/store/askDock.js');
const { artifactRefOf, parseArtifactRef } = await import('../src/api/chatArtifacts-wire.js');

const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
] as unknown as RosterSeat[];

function scopeOf(kind: ChatScope['kind']): ChatScope {
  return { kind, repos: [], cwd: '/tmp/chats/x', graph: { bound: false, reason: 'stated by the daemon' }, dangling: [] };
}

beforeEach(() => {
  cleanup();
  resetInView();
  for (const f of [openChat, sendChatMessage, getRoster, getChat, listRepos, listProjects, listRunsForDoc, apiFetch]) f.mockReset();
  apiFetch.mockRejectedValue(new Error('no diagnostics in this rig'));
  clearCachedRoster();
  clearRepoCache();
  setCachedRoster(ROSTER);
  listRepos.mockResolvedValue({ repos: [] });
  listProjects.mockResolvedValue({ projects: [] });
  openChat.mockImplementation((body: ChatOpenBody) => Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }], scope: scopeOf('system') }));
  sendChatMessage.mockResolvedValue({ seats: ['claude'], turnId: 't1' });
  getChat.mockResolvedValue({ chatId: 'x', seats: ['claude'] });
  useProjectsStore.setState({ projects: [{ id: 'mikes', name: 'Mikes', description: null, status: 'active', scope: 'project:mikes', created_at: 1, updated_at: 1 }] as never, loading: false, error: null });
  useLiveChatsStore.setState({ sessions: {} });
  useCapabilities.setState({ loaded: true, chatContext: false, chatList: false, chatAttachments: false, askPath: false });
  useComposerChips.setState({ byComposer: {} });
  document.body.innerHTML = '';
  try { localStorage.clear(); } catch { /* stubbed */ }
  try { sessionStorage.clear(); } catch { /* stubbed */ }
});

async function ask(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('assist-input'), text);
  await user.click(screen.getByTestId('assist-send'));
  await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
}

/** A placement on screen whose editor is mid-write: its shown version moves to `after` once the write settles. */
function placeDeck(opts: { surface: 'full' | 'pane' | 'inline'; composerKey?: string; before: number; after: number; ref?: string }): { flushed: () => boolean; remove: () => void } {
  let shown = opts.before;
  let flushed = false;
  const remove = registerInView({
    key: `card:${opts.ref ?? 'mikes/deck'}:${opts.surface}`,
    ref: opts.ref ?? 'mikes/deck',
    title: 'Domain coverage',
    composerKey: opts.composerKey ?? 'made:mikes/deck',
    surface: () => opts.surface,
    shown: () => shown,
    flush: async () => { await new Promise((r) => setTimeout(r, 20)); shown = opts.after; flushed = true; return opts.after; },
  });
  return { flushed: () => flushed, remove };
}

describe('an older daemon (no chatArtifacts.context) is sent exactly what it was sent before', () => {
  it('no context argument, the pack in the text, no seed on the open', async () => {
    placeDeck({ surface: 'full', before: 2, after: 3 });
    setAskAboutSeed({ ref: '_unfiled/release-note', label: 'Release note', projectId: null, docId: 'release-note', version: 1, seed: true });
    render(<AskDock runs={[]} pathname="/projects/mikes/made" onClose={() => undefined} startFresh />);
    await ask('what does slide 4 say?');
    const call = sendChatMessage.mock.calls[0]!;
    expect(call).toHaveLength(2);
    expect(call[1]).toMatch(/^what does slide 4 say\?\n\n/);
    expect(openChat.mock.calls[0]![0]).not.toHaveProperty('seedFromArtifact');
  });
});

describe('a daemon with chatArtifacts.context', () => {
  beforeEach(() => useCapabilities.setState({ chatContext: true }));

  it('sends the typed words as the text, the pack as context.page, and the deck at the version its edit made', async () => {
    const deck = placeDeck({ surface: 'full', before: 2, after: 3 });
    render(<AskDock runs={[]} pathname="/projects/mikes/made" onClose={() => undefined} startFresh />);
    await ask('what does slide 4 say?');
    const [, text, targets, ids, context] = sendChatMessage.mock.calls[0]!;
    expect(text).toBe('what does slide 4 say?');
    expect(targets).toBeUndefined();
    expect(ids).toBeUndefined();
    expect(deck.flushed()).toBe(true);
    expect(context).toMatchObject({ artifact: { ref: 'mikes/deck', version: 3 } });
    expect((context as { page: string }).page).toContain('/projects/mikes/made');
  });

  it('"Ask about this" on an Unfiled document: the doc chip, no All repos, seedFromArtifact, and the version from the press', async () => {
    setAskAboutSeed({ ref: '_unfiled/release-note', label: 'Release note', projectId: null, docId: 'release-note', version: 4, seed: true });
    render(<AskDock runs={[]} pathname="/projects/default/made" onClose={() => undefined} startFresh />);
    const keys = screen.getAllByTestId('chat-scope-chip').map((c) => [c.getAttribute('data-key'), c.getAttribute('aria-pressed')]);
    expect(keys).toContainEqual(['doc:default/release-note', 'true']);
    expect(keys.find(([k]) => k === 'all-repos')?.[1]).not.toBe('true');
    await ask('summarise this');
    expect(openChat.mock.calls[0]![0]).toMatchObject({ seedFromArtifact: '_unfiled/release-note', scopeKind: 'system' });
    expect(sendChatMessage.mock.calls[0]![4]).toMatchObject({ artifact: { ref: '_unfiled/release-note', version: 4 } });
  });

  it('a handed-over message carries its composer’s artifact and selected parts once', async () => {
    placeDeck({ surface: 'inline', composerKey: 's-1', before: 5, after: 5 });
    render(
      <AskDock runs={[]} pathname="/s/s-1" onClose={() => undefined} sendText="make sense of slide 4" sendFresh
        sendArtifact={{ ref: 'mikes/deck', anchors: ['slide-3-heading-1', 'not an id'], composerKey: 's-1' }} />,
    );
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(sendChatMessage.mock.calls[0]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', version: 5, anchors: ['slide-3-heading-1'] } });
    // Once: the next message from the dock's own box does not carry the handed-over artifact or its parts (and the
    // inline card is not "beside" the floating chat).
    await userEvent.setup().type(screen.getByTestId('assist-input'), 'and slide 5?');
    await userEvent.setup().click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect((sendChatMessage.mock.calls[1]![4] as { artifact?: unknown } | undefined)?.artifact).toBeUndefined();
  });

  it('a handed-over message that failed to send keeps its artifact for the person’s retry', async () => {
    placeDeck({ surface: 'inline', composerKey: 's-1', before: 5, after: 5 });
    sendChatMessage.mockRejectedValueOnce(new ApiError(502, 'bad gateway'));
    render(
      <AskDock runs={[]} pathname="/s/s-1" onClose={() => undefined} sendText="what does slide 4 say?" sendFresh
        sendArtifact={{ ref: 'mikes/deck', anchors: ['slide-3-heading-1'], composerKey: 's-1' }} />,
    );
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('assist-send')).not.toBeDisabled());
    await userEvent.setup().click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sendChatMessage.mock.calls[1]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', anchors: ['slide-3-heading-1'] } });
  });

  it('a retry after the card has closed still names the version the handed-over message was about', async () => {
    const card = placeDeck({ surface: 'inline', composerKey: 's-1', before: 5, after: 5 });
    sendChatMessage.mockRejectedValueOnce(new ApiError(502, 'bad gateway'));
    render(
      <AskDock runs={[]} pathname="/s/s-1" onClose={() => undefined} sendText="what does slide 4 say?" sendFresh
        sendArtifact={{ ref: 'mikes/deck', anchors: [], composerKey: 's-1' }} />,
    );
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    card.remove();
    await waitFor(() => expect(screen.getByTestId('assist-send')).not.toBeDisabled());
    await userEvent.setup().click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sendChatMessage.mock.calls[1]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', version: 5 } });
  });

  it('an Ask whose press saw no version falls back to the version the docs list holds', async () => {
    useDocsCache.setState({ byProject: { mikes: [{ name: 'deck', head: 8 } as never] } } as never);
    setAskAboutSeed({ ref: 'mikes/deck', label: 'Deck', projectId: 'mikes', docId: 'deck', version: null, seed: false });
    render(<AskDock runs={[]} pathname="/p/mikes" onClose={() => undefined} startProjectId="mikes" startFresh />);
    await ask('what is this?');
    expect(sendChatMessage.mock.calls[0]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', version: 8 } });
  });

  it('a document chip turned off sends no artifact and no seed, even with the document beside the chat', async () => {
    placeDeck({ surface: 'full', ref: '_unfiled/release-note', before: 2, after: 2 });
    setAskAboutSeed({ ref: '_unfiled/release-note', label: 'Release note', projectId: null, docId: 'release-note', version: 2, seed: true });
    render(<AskDock runs={[]} pathname="/projects/default/made" onClose={() => undefined} startFresh />);
    const docChip = screen.getAllByTestId('chat-scope-chip').find((c) => c.getAttribute('data-key') === 'doc:default/release-note')!;
    await userEvent.setup().click(docChip);
    await ask('anything new?');
    expect(openChat.mock.calls[0]![0]).not.toHaveProperty('seedFromArtifact');
    expect((sendChatMessage.mock.calls[0]![4] as { artifact?: unknown } | undefined)?.artifact).toBeUndefined();
  });

  it('an Unfiled Ask opened on a project page stays in no project', async () => {
    setAskAboutSeed({ ref: '_unfiled/release-note', label: 'Release note', projectId: null, docId: 'release-note', version: 1, seed: true });
    render(<AskDock runs={[]} pathname="/p/mikes" onClose={() => undefined} startFresh />);
    await ask('summarise this');
    const body = openChat.mock.calls[0]![0] as ChatOpenBody;
    expect(body.projectId).toBeUndefined();
    expect(body).toMatchObject({ seedFromArtifact: '_unfiled/release-note' });
  });

  it('a resumed chat whose document chip is on keeps sending that document, at the version the docs list holds', async () => {
    useDocsCache.setState({ byProject: { mikes: [{ name: 'deck', head: 6 } as never] } } as never);
    writeAskSession({ chatId: 'c-old', title: 'deck', seeded: true, chips: [{ key: 'page', kind: 'page', label: 'This page', on: true }, { key: 'doc:mikes/deck', kind: 'doc', label: 'deck', ref: 'deck', projectId: 'mikes', on: true, added: true }] } as never);
    getChat.mockResolvedValue({ chatId: 'c-old', seats: ['claude'] });
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} />);
    await ask('and now?');
    expect(sendChatMessage.mock.calls[0]![0]).toBe('c-old');
    expect(sendChatMessage.mock.calls[0]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', version: 6 } });
  });
});

describe('a send that beats the health read', () => {
  it('still names the artifact once the daemon says it takes context', async () => {
    useCapabilities.setState({ loaded: false, chatContext: false });
    getHealth.mockResolvedValue({ status: 'ok', capabilities: { chatArtifacts: { context: true } } });
    placeDeck({ surface: 'full', before: 3, after: 3 });
    render(<AskDock runs={[]} pathname="/projects/mikes/made" onClose={() => undefined} startFresh />);
    await ask('what does slide 4 say?');
    expect(sendChatMessage.mock.calls[0]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', version: 3 } });
  });

  it('reopening a chat this browser has no record of claims none of its chips, only the document', async () => {
    useCapabilities.setState({ chatContext: true });
    writeAskSession({ chatId: 'c-x', title: 'x', seeded: true, chipsUnknown: true } as never);
    setAskAboutSeed({ ref: 'mikes/deck', label: 'Deck', projectId: 'mikes', docId: 'deck', version: 2, seed: false });
    render(<AskDock runs={[]} pathname="/p/mikes" onClose={() => undefined} />);
    const pressed = screen.getAllByTestId('chat-scope-chip').filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('data-key'));
    expect(pressed).toEqual(['doc:mikes/deck']);
  });
});

describe('the artifacts on screen', () => {
  beforeEach(() => resetInView());

  it('picks full screen over a pane over the newest card, per composer; the floating chat sees only full, pane or Made', () => {
    placeDeck({ surface: 'inline', composerKey: 's-1', before: 1, after: 1, ref: 'mikes/a' });
    placeDeck({ surface: 'inline', composerKey: 's-1', before: 1, after: 1, ref: 'mikes/b' });
    expect(inViewFor('s-1')?.ref).toBe('mikes/b');
    expect(inViewAnywhere()).toBeNull();
    placeDeck({ surface: 'pane', composerKey: 's-1', before: 1, after: 1, ref: 'mikes/c' });
    expect(inViewFor('s-1')?.ref).toBe('mikes/c');
    expect(inViewAnywhere()?.ref).toBe('mikes/c');
  });

  it('waits for the editor’s writes before naming the version, and goes with the fallback when nothing is mounted', async () => {
    placeDeck({ surface: 'full', before: 2, after: 3 });
    expect(await artifactContext('mikes/deck')).toEqual({ ref: 'mikes/deck', version: 3 });
    expect(await artifactContext('mikes/gone', [], 7)).toEqual({ ref: 'mikes/gone', version: 7 });
    expect(await artifactContext('mikes/gone')).toBeNull();
  });

  it('a placement says the lens, else the person’s own last write (an edit, an undo), else what the plugin read, else the head', async () => {
    let head = 3;
    let lens: number | null = null;
    let group: number | null = 2;
    const made = new Set<number>();
    let hostWaited = false;
    const entry = placementEntry({
      key: 'k', ref: 'mikes/deck', title: 't', composerKey: 'c',
      surface: () => 'full', lens: () => lens, groupShown: () => group,
      adapter: { artifact: () => ({ head }), made, flush: async () => head },
      host: () => ({ writesSettled: async () => { await new Promise((r) => setTimeout(r, 10)); hostWaited = true; head = 4; made.add(4); } }),
    });
    expect(entry.shown()).toBe(2);
    // A write accepted by the host lands while the send waits: its version is what the person sees.
    expect(await entry.flush()).toBe(4);
    expect(hostWaited).toBe(true);
    expect(entry.shown()).toBe(4);
    // The plugin reads a version again: the group's read stands.
    noteShown('mikes/deck');
    group = 4;
    expect(entry.shown()).toBe(4);
    // An undo makes version 5 (the card notes it): that, not the undone 4.
    noteWritten('mikes/deck', 5);
    expect(entry.shown()).toBe(5);
    // A version lens over the editor wins.
    lens = 1;
    expect(entry.shown()).toBe(1);
    // A version another hand landed is not claimed as theirs.
    lens = null;
    noteShown('mikes/deck');
    group = 5;
    head = 9;
    const other = placementEntry({ key: 'k2', ref: 'mikes/deck', title: 't', composerKey: 'c', surface: () => 'full', lens: () => null, groupShown: () => 5, adapter: { artifact: () => ({ head }), made, flush: async () => 10 }, host: () => null });
    await other.flush();
    expect(other.shown()).toBe(5);
  });

  it('names the version the sending composer’s placement shows, not another placement’s', async () => {
    placeDeck({ surface: 'full', composerKey: 'made:mikes/deck', before: 7, after: 7 });
    placeDeck({ surface: 'inline', composerKey: 's-9', before: 3, after: 3 });
    expect(await artifactContext('mikes/deck', [], null, 50, 's-9')).toEqual({ ref: 'mikes/deck', version: 3 });
    expect(await artifactContext('mikes/deck', [], null, 50)).toEqual({ ref: 'mikes/deck', version: 7 });
  });

  it('bounds the wait for a write that never settles', async () => {
    registerInView({ key: 'k', ref: 'mikes/slow', title: 't', composerKey: 'c', surface: () => 'full', shown: () => 2, flush: () => new Promise(() => undefined) });
    expect(await artifactContext('mikes/slow', [], null, 30)).toEqual({ ref: 'mikes/slow', version: 2 });
  });
});

describe('the Ask about this seed', () => {
  it('is read by one chat, once, and goes stale if no chat opens with it', () => {
    vi.useFakeTimers();
    try {
      setAskAboutSeed({ ref: 'mikes/deck', label: 'Deck', projectId: 'mikes', docId: 'deck', version: 1, seed: false });
      expect(peekAskAboutSeed()?.ref).toBe('mikes/deck');
      takeAskAboutSeed();
      expect(peekAskAboutSeed()).toBeNull();
      setAskAboutSeed({ ref: 'mikes/deck', label: 'Deck', projectId: 'mikes', docId: 'deck', version: 1, seed: false });
      vi.advanceTimersByTime(11_000);
      expect(peekAskAboutSeed()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('about chips and refs', () => {
  it('one artifact chip at a time; its parts keep their artifact and data-wid', () => {
    let chips = addChip([], artifactChip('mikes/a', 'A'));
    chips = addChip(chips, artifactChip('mikes/b', 'Deck B'));
    chips = addChip(chips, { kind: 'about', key: 'el:b/w1', label: 'slide 4 · Timeline', ref: 'mikes/b', wid: 'w1' });
    expect(chips.filter((c) => c.kind === 'artifact')).toHaveLength(1);
    expect(artifactOfChips(chips)).toEqual({ ref: 'mikes/b', anchors: ['w1'] });
    expect(messageWithAbout('what is this?', chips)).toBe('About Deck B and slide 4 · Timeline: what is this?');
    expect(artifactOfChips([{ kind: 'about', key: 'q', label: '“quote”' }])).toBeNull();
  });

  it('spells Unfiled as _unfiled and refuses ids that cannot make a ref', () => {
    expect(artifactRefOf('default', 'release-note')).toBe('_unfiled/release-note');
    expect(artifactRefOf('', 'release-note')).toBe('_unfiled/release-note');
    expect(artifactRefOf('mikes', 'Deck')).toBeNull();
    expect(artifactRefOf('mikes', undefined)).toBeNull();
    expect(parseArtifactRef('_unfiled/release-note')).toEqual({ mount: '_unfiled', docId: 'release-note', projectId: 'default' });
  });
});

describe('the editor bridge and the adapter', () => {
  it('an element of an interactive document becomes a chip that keeps its artifact and data-wid', async () => {
    const { chipsToComposer } = await import('../src/components/editorHost/composerBridge.js');
    chipsToComposer({ artifactKey: 'k', title: 'T', kind: 'deck', source: 'interactive-doc', projectId: 'default', docId: 'note', composerKey: 'ck' }, [
      { anchor: { kind: 'element', id: 'slide-3-heading-1' }, label: 'slide 4 · Timeline' },
    ]);
    expect(useComposerChips.getState().byComposer['ck']).toEqual([{ kind: 'about', key: 'el:note/slide-3-heading-1', label: 'slide 4 · Timeline', ref: '_unfiled/note', wid: 'slide-3-heading-1' }]);
  });
});

describe('Ask about this', () => {
  const binding = { artifactKey: 'made:mikes/deck', title: 'Domain coverage', kind: 'deck', source: 'interactive-doc' as const, projectId: 'mikes', docId: 'deck' as string, composerKey: 'made:mikes/deck' };

  it('routes to a composer on screen, else the chat the document was made in if it is open, else a new chat', () => {
    const base = { composerKey: 'k', projectId: 'mikes', madeInChat: null, chatLive: () => false, seedable: true };
    expect(askAboutRoute({ ...base, composerOnScreen: true })).toEqual({ to: 'composer', composerKey: 'k' });
    expect(askAboutRoute({ ...base, composerOnScreen: false, madeInChat: 'c1', chatLive: (id) => id === 'c1' })).toEqual({ to: 'chat', chatId: 'c1' });
    expect(askAboutRoute({ ...base, composerOnScreen: false, madeInChat: 'c1' })).toEqual({ to: 'new', projectId: 'mikes', seed: false });
    expect(askAboutRoute({ ...base, composerOnScreen: false, projectId: 'default' })).toEqual({ to: 'new', projectId: null, seed: true });
    expect(askAboutRoute({ ...base, composerOnScreen: false, projectId: 'default', seedable: false })).toEqual({ to: 'new', projectId: null, seed: false });
  });

  it('on Made (no composer) opens a chat in the document’s project with the deck chip', async () => {
    listRunsForDoc.mockResolvedValue({ runs: [] });
    useCapabilities.setState({ chatContext: true });
    await askAbout(binding);
    const req = useAskDock.getState().request;
    expect(req).toMatchObject({ fresh: true, projectId: 'mikes' });
    render(<AskDock runs={[]} pathname="/projects/mikes/made" onClose={() => undefined} startProjectId="mikes" startFresh />);
    expect(screen.getAllByTestId('chat-scope-chip').map((c) => c.getAttribute('data-key'))).toContain('doc:mikes/deck');
  });

  it('brings back the open chat the document was made in, with the document chip and its artifact', async () => {
    useCapabilities.setState({ chatContext: true });
    listRunsForDoc.mockResolvedValue({ runs: [{ session: { id: 'r1', chat_id: 'c-made', project_id: 'mikes', created_at: 5 }, units: [] }] });
    placeDeck({ surface: 'full', before: 4, after: 4 });
    useLiveChatsStore.setState({ sessions: { 'c-made': { chatId: 'c-made', seats: ['claude'] } as never } });
    await askAbout(binding);
    render(<AskDock runs={[]} pathname="/projects/mikes/made" onClose={() => undefined} />);
    expect(screen.getAllByTestId('chat-scope-chip').map((c) => c.getAttribute('data-key'))).toContain('doc:mikes/deck');
    await ask('what does slide 4 say?');
    expect(sendChatMessage.mock.calls[0]![0]).toBe('c-made');
    expect(sendChatMessage.mock.calls[0]![4]).toMatchObject({ artifact: { ref: 'mikes/deck', version: 4 } });
  });

  it('a later press supersedes an earlier one whose lookup is slower', async () => {
    useCapabilities.setState({ chatContext: true });
    let releaseA!: () => void;
    listRunsForDoc.mockImplementationOnce(() => new Promise((r) => { releaseA = () => r({ runs: [] }); }));
    listRunsForDoc.mockResolvedValueOnce({ runs: [] });
    const a = askAbout({ ...binding, artifactKey: 'made:mikes/a', docId: 'a', title: 'A' });
    await askAbout({ ...binding, artifactKey: 'made:mikes/b', docId: 'b', title: 'B' });
    releaseA();
    await a;
    expect(peekAskAboutSeed()?.ref).toBe('mikes/b');
  });

  it('with the session composer on screen, adds the artifact chip there and focuses it', async () => {
    document.body.innerHTML = '<div data-testid="composer" data-composer="s-1"><textarea></textarea></div>';
    await askAbout({ ...binding, composerKey: 's-1' });
    expect(useComposerChips.getState().byComposer['s-1']).toEqual([{ kind: 'artifact', key: 'art:mikes/deck', label: 'Domain coverage', ref: 'mikes/deck' }]);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    expect(listRunsForDoc).not.toHaveBeenCalled();
  });
});
