// The ONE composer in Document mode — DES-MERGE-001 §2.2, §7.10, §6.3 slice 10.
//
// What Enter does is a pure function of the generation's state, so each test drives the
// composer in one state and asserts the WIRE it chose. The §7.10 case is the load-bearing
// one: editing a complete version is fork + inject as a SINGLE composer action, rendered
// as a continuation — a version divider, no new thread header.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const PROJECT = 'proj-abc';
const DOC = 'launch-deck';
const KEY = threadKey(PROJECT, DOC);

const createDoc = vi.fn();
const postFork = vi.fn();
const postEvent = vi.fn();
const getVersions = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
  // Slice U (§6.2): the REAL binding rule, mirrored — real projects bind.
  docBinding: (pid: string) => (pid === 'default' ? {} : { project: pid }),
  postFork: (...a: unknown[]) => postFork(...a),
  postEvent: (...a: unknown[]) => postEvent(...a),
  // The real wrapper, mirrored: `injectDocMessage` IS one `postEvent` (slices 11+12
  // shared the steer wire with the feedback batch), so slice 10's assertions about the
  // emitted event stay assertions about the emitted event.
  injectDocMessage: (p: string, d: string, text: string, id: string) =>
    postEvent(p, {
      event_type: 'wicked.interactive.chat.posted',
      payload: { role: 'user', text, document_id: d, source_message_id: id },
    }),
  getVersions: (...a: unknown[]) => getVersions(...a),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
}));

const navigate = vi.fn();

function mount(docId: string | null, version: number | null = null): void {
  render(
    <DocumentThread projectId={PROJECT} docId={docId} selectedVersion={version} navigate={navigate} />,
  );
}

/** The doc's transcript as the store holds it. */
function thread(): DocMsg[] {
  return useDocThreadStore.getState().messages[KEY] ?? [];
}

/** A message's id, or a sentinel that fails the comparison it is used in. */
function idOf(msg: DocMsg | undefined): string {
  return msg?.id ?? '<no message>';
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
  postFork.mockResolvedValue({ version: 4, parent: 3 });
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  getVersions.mockResolvedValue({ head: 3, versions: [] });
});

afterEach(cleanup);

describe('state 1 — idle: typing CREATES the doc-generation run', () => {
  it('posts the message as the brief and opens the run in the thread', async () => {
    mount(null);
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'idle');

    await send('a deck for the Q3 review');

    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    // The message is the FIRST line of the new doc's thread, with the run opening
    // named after it (§3.3 informative — a subject, never a bare spinner).
    expect(thread()[0]).toMatchObject({ kind: 'user', text: 'a deck for the Q3 review' });
    expect(thread()[1]).toMatchObject({ kind: 'narration', text: `Generating “${DOC}” from your brief.` });
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}`);
    // The anchor id travels WITH the request (§7.6) — same id as the message.
    expect(createDoc).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      kind: 'source', brief: 'a deck for the Q3 review', project: PROJECT,
      source_message_id: idOf(thread()[0]),
    }));
  });

  it('surfaces a refused create without losing the message', async () => {
    createDoc.mockRejectedValue(new Error('API 409: doc already exists'));
    mount(null);
    await send('a deck for the Q3 review');
    await waitFor(() => expect(screen.getByTestId('doc-composer-error')).toHaveTextContent('409'));
    expect(screen.getByTestId('doc-composer')).toHaveValue('a deck for the Q3 review');
  });
});

describe('state 2 — generating: typing INJECTS steering', () => {
  beforeEach(() => useDocThreadStore.getState().setGenState(KEY, 'generating'));

  it('shows the steering chip and injects rather than creating anything', async () => {
    mount(DOC);
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'generating');
    expect(screen.getByTestId('steering-chip')).toBeInTheDocument();

    await send('keep it to five slides');

    await waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1));
    expect(postEvent).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      event_type: 'wicked.interactive.chat.posted',
      payload: expect.objectContaining({ role: 'user', text: 'keep it to five slides', document_id: DOC }),
    }));
    expect(createDoc).not.toHaveBeenCalled();
    expect(postFork).not.toHaveBeenCalled();
    expect(screen.getByTestId('doc-message')).toHaveTextContent('keep it to five slides');
  });

  it('the chip is absent in every other state — it names a live run, not a decoration', () => {
    useDocThreadStore.getState().setGenState(KEY, 'terminal');
    mount(DOC);
    expect(screen.queryByTestId('steering-chip')).toBeNull();
  });
});

describe('state 3 — gated: the gate is answerable in the thread', () => {
  beforeEach(() => {
    useDocThreadStore.getState().ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.status.posted',
        payload: {
          project_id: PROJECT, document_id: DOC, state: 'asking',
          request_id: 'req-7', question: 'Deck or one-pager?', options: ['Deck', 'One-pager'],
        },
      },
    } as never);
  });

  it('answers with one click on an option, in the transcript', async () => {
    mount(DOC);
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'gated');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Deck' }));

    await waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1));
    expect(postEvent).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      event_type: 'wicked.interactive.question.answered',
      payload: expect.objectContaining({ request_id: 'req-7', answer: 'Deck', document_id: DOC }),
    }));
    await waitFor(() => expect(useDocThreadStore.getState().genState[KEY]).toBe('generating'));
  });

  it('free text answers the gate AND steers in one submit (§2.2 case 3)', async () => {
    mount(DOC);
    await send('a one-pager, but keep the chart');

    await waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1));
    expect(postEvent).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      event_type: 'wicked.interactive.question.answered',
      payload: expect.objectContaining({ request_id: 'req-7', answer: 'a one-pager, but keep the chart' }),
    }));
    expect(screen.getByTestId('doc-message')).toHaveTextContent('a one-pager, but keep the chart');
  });
});

describe('state 4 — terminal: fork + inject is ONE atomic action (§7.10)', () => {
  it('forks from the shown version, injects with the same message, renders a continuation', async () => {
    mount(DOC, 3);
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'terminal');

    await send('make the closing slide stronger');

    await waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1));
    // ONE composer action → one fork, one inject, both carrying the same anchor id.
    const anchorId = screen.getByTestId('doc-message').getAttribute('data-message-id');
    expect(postFork).toHaveBeenCalledTimes(1);
    expect(postFork).toHaveBeenCalledWith(PROJECT, DOC, 3, anchorId);
    expect(postEvent).toHaveBeenCalledWith(PROJECT, expect.objectContaining({
      payload: expect.objectContaining({
        text: 'make the closing slide stronger', document_id: DOC, source_message_id: anchorId,
      }),
    }));

    // The J3 bookkeeping pin: "continues as v4" is an ANCHOR — it must NOT
    // render before the thread observed v4 on the wire. Right after the fork
    // acks, the divider is only REGISTERED, never shown.
    expect(screen.queryByTestId('version-divider')).toBeNull();
    expect((useDocThreadStore.getState().messages[KEY] ?? []).map((m) => m.kind))
      .toEqual(['user']);

    // The version.created arrival is what materializes it — a CONTINUATION:
    // a version divider above its message, and no new thread header.
    act(() => {
      useDocThreadStore.getState().ingest({
        type: 'interactiveEvent',
        event: {
          event_type: 'wicked.interactive.version.created',
          payload: { project_id: PROJECT, document_id: DOC, version: 4, parent: 3, kind: 'generated' },
        },
      } as never);
    });
    const divider = screen.getByTestId('version-divider');
    expect(divider).toHaveAttribute('data-version', '4');
    expect(divider).toHaveTextContent('continues as v4');
    expect(screen.queryByTestId('thread-header')).toBeNull();
    expect(screen.getAllByTestId('thread')).toHaveLength(1);

    // The divider precedes the message it continues into, and the landing
    // consumed both the anchor and the expectation.
    const order = (useDocThreadStore.getState().messages[KEY] ?? []).map((m) => m.kind);
    expect(order).toEqual(['divider', 'user']);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=4`);
  });

  it('the composer is live (generating) after the fork, before anything lands', async () => {
    mount(DOC, 3);
    await send('make the closing slide stronger');
    await waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1));
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('with no routed version it forks from the manifest head, never from v1', async () => {
    mount(DOC, null);
    await send('tighten the intro');
    await waitFor(() => expect(postFork).toHaveBeenCalledTimes(1));
    expect(getVersions).toHaveBeenCalledWith(PROJECT, DOC);
    expect(postFork).toHaveBeenCalledWith(PROJECT, DOC, 3, expect.any(String));
  });
});

describe('the transcript is the record (§2.3, §2.5)', () => {
  it('renders narration, agent replies, verdicts and export artifacts in arrival order', () => {
    const store = useDocThreadStore.getState();
    store.addNarration(KEY, 'Rewriting slide 3 — tightening the headline');
    store.ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.review.completed',
        payload: { project_id: PROJECT, document_id: DOC, reviewer: 'a11y', verdict: 'Contrast fails on slide 2' },
      },
    } as never);
    store.ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.export.generated',
        payload: {
          project_id: PROJECT, document_id: DOC, format: 'pdf', file: 'launch-deck_v3.pdf',
          download: '/d/launch-deck/download/launch-deck_v3.pdf',
        },
      },
    } as never);
    mount(DOC);

    expect(screen.getByTestId('doc-narration')).toHaveTextContent('Rewriting slide 3');
    expect(screen.getByTestId('doc-verdict')).toHaveTextContent('a11y · review');
    expect(screen.getByTestId('doc-verdict')).toHaveTextContent('Contrast fails on slide 2');
    expect(screen.getByTestId('doc-artifact-download')).toHaveAttribute(
      'href', `/api/v1/projects/${PROJECT}/interactive/d/launch-deck/download/launch-deck_v3.pdf`,
    );
  });

  it('a version-tagged message carries the anchor attributes slice 9 scrolls to (§7.6)', () => {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dmsg-anchor', 'make the intro punchier');
    store.ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.version.created',
        payload: { project_id: PROJECT, document_id: DOC, version: 7, parent: 6, kind: 'generated' },
      },
    } as never);
    mount(DOC);

    const message = screen.getByTestId('doc-message');
    expect(message).toHaveAttribute('data-message-id', 'dmsg-anchor');
    expect(message).toHaveAttribute('data-version', '7');
    // The strip resolves the anchor through the DOM contract, so it must be findable.
    expect(screen.getByTestId('thread').querySelector('[data-message-id="dmsg-anchor"]')).toBe(message);
  });
});

// ── DES-UXFIX-001 §2.6 rule 2 (slice 6): the visible half of the F9 fix ──────

describe('the ▤ v<N> landed tag — the thread half of the doc↔canvas↔thread link', () => {
  function landVersion(version: number): void {
    const store = useDocThreadStore.getState();
    store.addUserMsg(KEY, 'dmsg-anchor', 'make the intro punchier');
    store.ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.version.created',
        payload: { project_id: PROJECT, document_id: DOC, version, parent: version - 1, kind: 'generated' },
      },
    } as never);
  }

  it('AC: the message that produced a version is TAGGED with it, visibly', () => {
    landVersion(7);
    mount(DOC);

    const tag = screen.getByTestId('version-marker');
    expect(tag).toHaveAttribute('data-version', '7');
    // DES-UX-001 §6.1 (EC36): the marker names its CAUSING message — and it renders
    // on that message, so a marker under an unrelated request is structurally
    // impossible.
    expect(tag).toHaveAttribute('data-caused-by', 'dmsg-anchor');
    // The tag is the wireframe's literal words — legible, not attribute-only (EC9).
    expect(tag).toHaveTextContent('▤ v7 landed');
  });

  it('AC: the tag CROSS-LINKS to the strip — clicking navigates to that version', async () => {
    landVersion(7);
    mount(DOC);

    await userEvent.click(screen.getByTestId('version-marker'));
    // The same `?v=N` route the strip selects by: the canvas swaps, the strip entry
    // highlights, and Back rewinds the move — a navigation, never local state.
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=7`);
  });

  it('a message that produced NO version carries no tag', () => {
    useDocThreadStore.getState().addUserMsg(KEY, 'dmsg-1', 'still thinking about this');
    mount(DOC);

    expect(screen.getByTestId('doc-message')).not.toHaveAttribute('data-version');
    expect(screen.queryByTestId('version-marker')).toBeNull();
  });
});
