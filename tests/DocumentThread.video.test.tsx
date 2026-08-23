// The composer in Video mode — DES-MERGE-001 §2.2, §4.1, §4.5, §6.4 slice 14.
//
// Same thread, same four states, same rule that what Enter DOES is a pure function of run
// state (slice 10). Exactly one case differs, and only in how it collects: a demo's steps
// are ORDERED, so case 1 discloses the wizard (§4.1) instead of taking the message as a
// brief. Everything asserted here is the WIRE the composer chose, not the button's label.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const PROJECT = 'proj-abc';
const DEMO = 'checkout-walkthrough';
const KEY = threadKey(PROJECT, DEMO);

const createDoc = vi.fn();
const requestRecord = vi.fn();
const postEvent = vi.fn();
const getVersions = vi.fn();
const postFork = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
  requestRecord: (...a: unknown[]) => requestRecord(...a),
  postEvent: (...a: unknown[]) => postEvent(...a),
  getVersions: (...a: unknown[]) => getVersions(...a),
  postFork: (...a: unknown[]) => postFork(...a),
  injectDocMessage: (p: string, d: string, text: string, id: string) =>
    postEvent(p, {
      event_type: 'wicked.interactive.chat.posted',
      payload: { role: 'user', text, document_id: d, source_message_id: id },
    }),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
}));

const navigate = vi.fn();

function mount(docId: string | null): void {
  render(
    <DocumentThread projectId={PROJECT} docId={docId} selectedVersion={null}
                    navigate={navigate} mode="video" />,
  );
}

function thread(key = KEY): DocMsg[] {
  return useDocThreadStore.getState().messages[key] ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
  createDoc.mockResolvedValue({ name: DEMO, head: 1, kind: 'demo' });
  requestRecord.mockResolvedValue({ queued: true });
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  getVersions.mockResolvedValue({ head: 1, versions: [] });
});
afterEach(cleanup);

// ── Case 1, the demo path: the composer opens the ordered wizard ─────────────

describe('case 1 — the ask opens the wizard, and nothing is created until it submits', () => {
  it('AC: typing while idle discloses the wizard instead of posting a brief', async () => {
    const user = userEvent.setup();
    mount(null);
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'idle');
    expect(screen.getByTestId('doc-composer')).toHaveAttribute(
      'placeholder', 'Describe the demo you want to record…');

    await user.type(screen.getByTestId('doc-composer'), 'a walkthrough of the checkout flow');
    await user.click(screen.getByTestId('doc-composer-submit'));

    const wizard = await screen.findByTestId('demo-wizard');
    // §4.5's first ordered question: nothing can be authored against an unknown target.
    expect(wizard).toHaveAttribute('data-stage', 'target');
    expect(createDoc).not.toHaveBeenCalled();
  });

  it('AC: steps are authored IN ORDER and submitted in that order', async () => {
    const user = userEvent.setup();
    mount(null);
    await user.type(screen.getByTestId('doc-composer'), 'a walkthrough of the checkout flow');
    await user.click(screen.getByTestId('doc-composer-submit'));
    await screen.findByTestId('demo-wizard');

    await user.type(screen.getByTestId('wizard-target'), 'https://shop.example/');
    expect(screen.getByTestId('demo-wizard')).toHaveAttribute('data-stage', 'steps');

    // Authored one at a time; the wizard cannot accept a half-named step.
    await user.type(screen.getByTestId('wizard-step-subject'), 'the storefront');
    expect(screen.getByTestId('wizard-step-add')).toBeDisabled();
    await user.type(screen.getByTestId('wizard-step-action'), 'open it');
    await user.click(screen.getByTestId('wizard-step-add'));

    await user.type(screen.getByTestId('wizard-step-subject'), 'the cart');
    await user.type(screen.getByTestId('wizard-step-action'), 'add a hoodie to it');
    await user.click(screen.getByTestId('wizard-step-add'));

    const listed = screen.getAllByTestId('wizard-step');
    expect(listed.map((el) => el.getAttribute('data-index'))).toEqual(['0', '1']);
    expect(listed[0]).toHaveTextContent('the storefront — open it');
    expect(listed[1]).toHaveTextContent('the cart — add a hoodie to it');

    await user.click(screen.getByTestId('wizard-create'));

    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const [project, body] = createDoc.mock.calls[0] as [string, {
      kind: string; url: string; name: string; project: string; source_message_id: string;
      demo_steps: { index: number; subject: string; action: string }[];
    }];
    expect(project).toBe(PROJECT);
    expect(body.kind).toBe('demo');
    expect(body.url).toBe('https://shop.example/');
    // §4.1: the name is DERIVED from the ask — the wizard only asks what the ask couldn't say.
    expect(body.name).toBe('a walkthrough of the checkout flow');
    expect(body.demo_steps).toEqual([
      { index: 0, subject: 'the storefront', action: 'open it' },
      { index: 1, subject: 'the cart', action: 'add a hoodie to it' },
    ]);

    // Completion opens the demo's conversation and lands on the surface that OFFERS to
    // record it — the demo exists with a spec and no recording (§3.3: control adjacent).
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/video/${DEMO}`));
    expect(screen.queryByTestId('demo-wizard')).toBeNull();
    expect(thread()[0]).toMatchObject({ kind: 'user', text: expect.stringContaining('1. the storefront — open it') });
    expect(thread()[1]?.kind).toBe('narration');
    // §7.6: the message the composer minted BEFORE the wizard is the version's anchor.
    expect(useDocThreadStore.getState().pending[KEY]).toContain(thread()[0]?.id);
  });

  it('cancelling creates nothing and leaves the composer where it was', async () => {
    const user = userEvent.setup();
    mount(null);
    await user.type(screen.getByTestId('doc-composer'), 'a walkthrough');
    await user.click(screen.getByTestId('doc-composer-submit'));
    await user.click(await screen.findByTestId('wizard-cancel'));

    expect(screen.queryByTestId('demo-wizard')).toBeNull();
    expect(createDoc).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

// ── Recording from the composer (§2.3) ───────────────────────────────────────

describe('the composer can ask for a recording, and the ask is a message', () => {
  it('AC: the request goes through the proxied service and lands in the transcript', async () => {
    const user = userEvent.setup();
    mount(DEMO);

    await user.click(screen.getByTestId('thread-record'));

    await waitFor(() => expect(requestRecord).toHaveBeenCalledWith(PROJECT, DEMO));
    expect(thread()[0]).toMatchObject({ kind: 'user', text: `Record “${DEMO}”.` });
    // §3.3: the opening line names the demo and what is happening to it, never bare.
    expect(thread()[1]).toMatchObject({
      kind: 'narration',
      text: `Recording “${DEMO}” — running its authored steps in a real browser.`,
    });
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('retires the offer while the recorder is running, and says so with the demo named', async () => {
    mount(DEMO);
    act(() => useDocThreadStore.getState().setGenState(KEY, 'generating'));

    await waitFor(() => expect(screen.queryByTestId('thread-record')).toBeNull());
    expect(screen.getByTestId('steering-chip')).toHaveTextContent('steering the live demo run');
  });

  it('a refused request states the failure — the composer never swallows it (§3.3)', async () => {
    const user = userEvent.setup();
    requestRecord.mockRejectedValueOnce(new Error('API 503: recorder unavailable'));
    mount(DEMO);

    await user.click(screen.getByTestId('thread-record'));

    expect(await screen.findByTestId('doc-composer-error')).toHaveTextContent('recorder unavailable');
    // The ask stays in the transcript: what was asked is not erased by the refusal.
    expect(thread().filter((m) => m.kind === 'user')).toHaveLength(1);
  });

  it('a demo with no route (the picker) offers no record action — there is nothing to record', () => {
    mount(null);
    expect(screen.queryByTestId('thread-record')).toBeNull();
  });
});
