// Video mode's surface, slice 14 — DES-MERGE-001 §4.5, §3.3/§3.4, §7.10, §6.4.
//
// Three claims, each of which the Playwright AC also drives end-to-end:
//   1. a step is a feedback target: commenting on step 2 and submitting asks for the SPEC
//      to be re-authored at step 2, and the surface re-reads what came back (§7.10);
//   2. a submitted batch OFFERS the re-record, because a new spec is not a new video;
//   3. the recording status is informative — it names the demo and the step — and is
//      never a bare `Working…`, even when the bridge streams exactly that.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoStoryboard } from '../src/components/VideoStoryboard.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import type { CoreEvent } from '../src/api/types.js';

const PROJECT = 'proj-abc-123';
const DEMO = 'checkout-walkthrough';
const KEY = threadKey(PROJECT, DEMO);

const STEPS = [
  { index: 0, title: 'Open the storefront', timestamp: 0 },
  { index: 1, title: 'Add a hoodie to the cart', timestamp: 6.5 },
  { index: 2, title: 'Enter the card details', timestamp: 12 },
];

interface Call { url: string; method: string; body: unknown }

/**
 * The fake bridge, in miniature: it holds the spec as STATE and applies a step diff when
 * the feedback event names one — so "the spec differs at step 2" is asserted against what
 * the service came back with, not against what the client hoped it would say.
 */
function stubBridge(): { calls: Call[]; spec: () => typeof STEPS } {
  const calls: Call[] = [];
  let steps = STEPS.map((s) => ({ ...s }));
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method: init?.method ?? 'GET', body });

    if (url.includes('/api/demo/spec')) return json({ steps, target_url: 'https://shop.example/' });
    if (url.includes('/api/demo/recordings')) return json({ version: 2, gif_url: '/d/x/demo/v2.gif' });
    if (url.includes('/api/demo/record')) return json({ queued: true });
    if (url.includes('/api/versions')) return json({ head: 2, kind: 'demo', versions: [] });
    if (url.includes('/api/events')) {
      const payload = (body as { payload?: Record<string, unknown> })?.payload ?? {};
      for (const item of (payload.items as { wid: string; comment: string }[] | undefined) ?? []) {
        const at = Number(/^step-(\d+)$/.exec(item.wid)?.[1] ?? NaN);
        if (Number.isInteger(at)) steps = steps.map((s) => (s.index === at ? { ...s, title: item.comment } : s));
      }
      return json({ ok: true, event_id: 'e1', correlation_id: 'c1' });
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }));
  return { calls, spec: () => steps };
}

function json(body: unknown): Promise<unknown> {
  return Promise.resolve({
    ok: true, status: 200, statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

/** A relayed status frame, as slice 3's envelope delivers it. */
function status(message: string): CoreEvent {
  return {
    type: 'interactiveEvent',
    event: {
      event_type: 'wicked.interactive.status.posted',
      payload: { project_id: PROJECT, document_id: DEMO, state: 'working', message },
    },
  } as unknown as CoreEvent;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', {
    value: new URL('http://127.0.0.1:7788/'), writable: true, configurable: true,
  });
  useDocThreadStore.setState({ messages: {}, genState: {}, anchor: {}, landed: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mount(): void {
  render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
}

// ── 1 + 2. Step feedback → a spec diff → the offer to re-record ──────────────

describe('commenting on a storyboard step re-authors the spec at that step', () => {
  it('AC: commenting on step 2 submits a step-2 spec diff and the surface shows it', async () => {
    const user = userEvent.setup();
    const { calls, spec } = stubBridge();
    mount();

    // A step is picked by clicking it, exactly as a document element is (§4.3) — the
    // click keeps its existing meaning, and the action bar follows the selection.
    const cards = await screen.findAllByTestId('chapter-card');
    await user.click(cards[1]!);
    expect(screen.getByTestId('step-comment-open')).toHaveAttribute('data-index', '1');

    await user.click(screen.getByTestId('step-comment-open'));
    await user.type(screen.getByTestId('step-comment-input'), 'Add TWO hoodies to the cart');
    await user.click(screen.getByTestId('step-comment-add'));
    expect(cards[1]).toHaveAttribute('data-comments', '1');

    await user.click(screen.getByTestId('step-feedback-submit'));

    // The request: one bus event naming the version, the step anchor and the target.
    const emitted = calls.filter((c) => c.url.includes('/api/events'));
    const feedback = emitted.find((c) =>
      (c.body as { event_type?: string }).event_type === 'wicked.interactive.feedback.submitted');
    expect(feedback?.body).toMatchObject({
      payload: {
        document_id: DEMO,
        version: 2,
        target: 'demo_step',
        items: [{ wid: 'step-1', comment: 'Add TWO hoodies to the cart' }],
      },
    });

    // The result: the SERVICE's spec now differs at that step, and the storyboard shows
    // the spec that came back rather than the one it mounted with (§7.10's continuation).
    expect(spec()[1]?.title).toBe('Add TWO hoodies to the cart');
    expect(spec()[0]?.title).toBe('Open the storefront');
    await waitFor(() => expect(screen.getAllByTestId('chapter-card')[1])
      .toHaveTextContent('Add TWO hoodies to the cart'));
    expect(screen.getAllByTestId('chapter-card')[0]).toHaveTextContent('Open the storefront');
  });

  it('AC: a submitted batch offers the RE-RECORD — a new spec is not a new video', async () => {
    const user = userEvent.setup();
    const { calls } = stubBridge();
    mount();

    const cards = await screen.findAllByTestId('chapter-card');
    await user.click(cards[1]!);
    await user.click(screen.getByTestId('step-comment-open'));
    await user.type(screen.getByTestId('step-comment-input'), 'two hoodies');
    await user.click(screen.getByTestId('step-comment-add'));
    await user.click(screen.getByTestId('step-feedback-submit'));

    const offer = await screen.findByTestId('demo-rerecord');
    expect(screen.getByTestId('demo-actions')).toHaveTextContent('was re-authored from your comments');
    await user.click(offer);

    await waitFor(() => expect(calls.some((c) =>
      c.method === 'POST' && /\/api\/demo\/record$/.test(c.url))).toBe(true));
    // §2.3: the re-record ask is a message, and the recorder is now the live state.
    const messages = useDocThreadStore.getState().messages[KEY] ?? [];
    expect(messages.some((m) => m.kind === 'user' && m.text.includes('Re-record'))).toBe(true);
    expect(useDocThreadStore.getState().genState[KEY]).toBe('generating');
  });

  it('N comments across steps go as ONE message, and the batch clears on submit', async () => {
    const user = userEvent.setup();
    const { calls } = stubBridge();
    mount();

    const cards = await screen.findAllByTestId('chapter-card');
    for (const [i, text] of [[1, 'two hoodies'], [2, 'slow down here']] as [number, string][]) {
      await user.click(cards[i]!);
      await user.click(screen.getByTestId('step-comment-open'));
      await user.type(screen.getByTestId('step-comment-input'), text);
      await user.click(screen.getByTestId('step-comment-add'));
    }
    expect(screen.getByTestId('step-feedback-submit')).toHaveAttribute('data-count', '2');

    await user.click(screen.getByTestId('step-feedback-submit'));

    await waitFor(() => expect(screen.queryByTestId('step-feedback-submit')).toBeNull());
    const feedback = calls.filter((c) =>
      (c.body as { event_type?: string })?.event_type === 'wicked.interactive.feedback.submitted');
    expect(feedback).toHaveLength(1);
    expect((feedback[0]?.body as { payload: { items: unknown[] } }).payload.items).toHaveLength(2);
  });
});

// ── 3. The recording status (§3.3, §3.4) ────────────────────────────────────

describe('the recording status names what is happening (§3.3)', () => {
  it('AC: it is never a bare "Working…" — the streamed line is filtered at the seam', async () => {
    stubBridge();
    mount();
    await screen.findAllByTestId('chapter-card');

    act(() => {
      useDocThreadStore.getState().ingest(status('Working…'));
      useDocThreadStore.getState().ingest(status('Working'));
    });

    const line = await screen.findByTestId('demo-record-status');
    expect(line).not.toHaveTextContent('Working…');
    // Rule 3: the fallback is the demo and its first step — a subject the client already
    // holds, which is exactly why the bare line is never needed.
    expect(line).toHaveTextContent(`Recording “${DEMO}” — 3 steps, starting at “Open the storefront”.`);
  });

  it('a real streamed line WINS over the fallback, and the newest one is shown', async () => {
    stubBridge();
    mount();
    await screen.findAllByTestId('chapter-card');

    act(() => {
      useDocThreadStore.getState().ingest(status('Step 1 of 3 — Open the storefront'));
      useDocThreadStore.getState().ingest(status('Working…'));
      useDocThreadStore.getState().ingest(status('Step 2 of 3 — Add a hoodie to the cart'));
    });

    expect(await screen.findByTestId('demo-record-status'))
      .toHaveTextContent('Step 2 of 3 — Add a hoodie to the cart');
  });

  it('the status shows only while the recorder is running, and editing is not offered then', async () => {
    stubBridge();
    mount();
    await screen.findAllByTestId('chapter-card');
    expect(screen.queryByTestId('demo-record-status')).toBeNull();
    expect(screen.getByTestId('step-comment-open')).toBeInTheDocument();

    act(() => { useDocThreadStore.getState().ingest(status('Step 1 of 3 — Open the storefront')); });

    expect(await screen.findByTestId('demo-record-status')).toBeInTheDocument();
    expect(screen.queryByTestId('step-comment-open')).toBeNull();
  });
});
