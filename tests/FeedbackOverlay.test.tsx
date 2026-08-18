// The point-and-comment overlay against a FIXTURE BRIDGE — DES-MERGE-001 §4.3, §5.5,
// slices 11+12 (merged per §7.3).
//
// Every number the overlay renders here arrived as a postMessage payload and went
// through `parseInbound` on the way in. Nothing in this file reads `contentDocument`,
// because in production nothing can: the frame is `sandbox="allow-scripts"`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedbackOverlay } from '../src/components/FeedbackOverlay.js';
import { scrollToWid } from '../src/interactive/widScroller.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import { makeFixtureBridge, rect, type FixtureBridge } from './fixtures/fixtureBridge.js';

const postEvent = vi.fn();
const injectDocMessage = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  postEvent: (...a: unknown[]) => postEvent(...a),
  injectDocMessage: (...a: unknown[]) => injectDocMessage(...a),
}));

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';
const KEY = threadKey(PROJECT, DOC);

/** A document shaped like the fixtures: a containing section, a heading, two paragraphs. */
const WIDS = {
  section: rect(0, 0, 1200, 900),
  h1:      rect(120, 64, 480, 56),
  p1:      rect(120, 160, 480, 90),
};

function mount(bridge: FixtureBridge, version = 3): void {
  render(
    <FeedbackOverlay
      frame={bridge.frame}
      loadNonce={1}
      projectId={PROJECT}
      docId={DOC}
      version={version}
    />,
  );
}

/** The overlay layer is `inset: 0`, so its client rect is the origin jsdom reports (0,0). */
async function clickAt(x: number, y: number): Promise<void> {
  const layer = screen.getByTestId('feedback-hitlayer');
  await userEvent.pointer([{ target: layer, coords: { clientX: x, clientY: y } },
                           { keys: '[MouseLeft]', target: layer, coords: { clientX: x, clientY: y } }]);
}

function boxOf(testId: string): { left: number; top: number } {
  const el = screen.getByTestId(testId);
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
}

/** Turn commenting on — it is a MODE, because hit-testing cannot pass through an iframe. */
async function startCommenting(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('feedback-toggle')).toBeEnabled());
  await userEvent.click(screen.getByTestId('feedback-toggle'));
}

async function comment(x: number, y: number, text: string): Promise<void> {
  await clickAt(x, y);
  await userEvent.type(screen.getByTestId('feedback-comment-input'), text);
  await userEvent.click(screen.getByTestId('feedback-comment-add'));
}

beforeEach(() => {
  useDocThreadStore.getState().clear(KEY);
  postEvent.mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  injectDocMessage.mockResolvedValue({ ok: true, event_id: 'e2', correlation_id: 'c1' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('FeedbackOverlay — the instrumentation handshake (§5.5)', () => {
  it('asks the frame for its inventory on load, over the protocol', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);

    await waitFor(() => expect(bridge.sent[0]).toEqual({ v: 1, type: 'request-inventory' }));
    await waitFor(() =>
      expect(screen.getByTestId('feedback-overlay')).toHaveAttribute('data-ready', 'true'));
  });

  it('AC: a frame that NEVER answers degrades gracefully — disabled, with the reason', async () => {
    vi.useFakeTimers();
    const bridge = makeFixtureBridge({ widMap: WIDS, silent: true });
    mount(bridge);
    await act(async () => { vi.advanceTimersByTime(5000); });
    vi.useRealTimers();

    const toggle = screen.getByTestId('feedback-toggle');
    expect(toggle).toBeDisabled();
    // §3.3: a disabled control says WHY, and says the canvas is still fine.
    expect(toggle.getAttribute('title')).toMatch(/did not answer the instrument bridge/i);
    expect(toggle.getAttribute('title')).toMatch(/still renders/i);
    expect(screen.getByTestId('feedback-overlay')).toHaveAttribute('data-ready', 'false');
    // And nothing was rendered over the document that could swallow a click.
    expect(screen.queryByTestId('feedback-hitlayer')).toBeNull();
  });

  it('drops malformed inbound payloads instead of anchoring against them', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS, silent: true });
    mount(bridge);

    // Hostile / stale / broken — every one must leave the overlay un-ready.
    bridge.postRaw({ v: 2, type: 'wid-inventory', widMap: WIDS, scrollX: 0, scrollY: 0 });
    bridge.postRaw({ v: 1, type: 'wid-inventory', widMap: { h1: { top: 'up' } }, scrollX: 0, scrollY: 0 });
    bridge.postRaw({ v: 1, type: 'exec', code: 'alert(1)' });
    bridge.postRaw('wid-inventory');
    bridge.postRaw(null);

    await waitFor(() =>
      expect(screen.getByTestId('feedback-overlay')).toHaveAttribute('data-ready', 'false'));
  });

  it('ignores a well-formed inventory from a DIFFERENT window', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS, silent: true });
    const impostor = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);

    // Same payload, same shape, wrong source. A sandboxed frame's origin is the string
    // "null" for every such frame, so identity is the only check that can work.
    impostor.postRaw({ v: 1, type: 'wid-inventory', widMap: WIDS, scrollX: 0, scrollY: 0 });

    await waitFor(() =>
      expect(screen.getByTestId('feedback-overlay')).toHaveAttribute('data-ready', 'false'));
  });
});

describe('FeedbackOverlay — pointing (§4.3)', () => {
  it('AC: hovering an instrumented element highlights it WITHIN 4 px of its rect', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await startCommenting();

    const layer = screen.getByTestId('feedback-hitlayer');
    await userEvent.pointer({ target: layer, coords: { clientX: 300, clientY: 90 } });

    const hover = await screen.findByTestId('feedback-hover');
    expect(hover).toHaveAttribute('data-wid', 'h1');
    const box = boxOf('feedback-hover');
    expect(Math.abs(box.left - WIDS.h1.left)).toBeLessThanOrEqual(4);
    expect(Math.abs(box.top - WIDS.h1.top)).toBeLessThanOrEqual(4);
    expect(hover.style.width).toBe(`${WIDS.h1.width}px`);
    expect(hover.style.height).toBe(`${WIDS.h1.height}px`);
  });

  it('AC: clicking a heading anchors the comment box within 4 px of its rect', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await startCommenting();
    await clickAt(300, 90);

    const card = await screen.findByTestId('feedback-comment');
    expect(card).toHaveAttribute('data-wid', 'h1');
    const box = boxOf('feedback-comment');
    expect(Math.abs(box.left - WIDS.h1.left)).toBeLessThanOrEqual(4);
    // Anchored just under the element — the gap IS the budget, never more.
    expect(box.top - (WIDS.h1.top + WIDS.h1.height)).toBeLessThanOrEqual(4);
    expect(box.top).toBeGreaterThanOrEqual(WIDS.h1.top);
  });

  it('a click on nothing instrumented opens nothing', async () => {
    const bridge = makeFixtureBridge({ widMap: { h1: WIDS.h1 } });
    mount(bridge);
    await startCommenting();
    await clickAt(1000, 800);

    expect(screen.queryByTestId('feedback-comment')).toBeNull();
  });

  it('commenting is a MODE — with it off the document keeps every click', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await waitFor(() => expect(screen.getByTestId('feedback-toggle')).toBeEnabled());

    expect(screen.queryByTestId('feedback-hitlayer')).toBeNull();
    expect(screen.getByTestId('feedback-overlay').style.pointerEvents).toBe('none');
  });

  it('a scroll-state message re-projects the boxes without a new inventory', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await startCommenting();
    await clickAt(300, 90);
    expect(boxOf('feedback-comment').top).toBeGreaterThan(0);

    const asked = bridge.sent.length;
    act(() => { bridge.scrollTo(0, 100); });

    // The pinned card followed the element up by exactly the scroll delta…
    await waitFor(() =>
      expect(boxOf('feedback-comment').top).toBe(WIDS.h1.top + WIDS.h1.height + 4 - 100));
    // …and no re-inventory round trip was spent to learn that.
    expect(bridge.sent.length).toBe(asked);
  });
});

describe('FeedbackOverlay — batching and submit (§4.3, §7.7)', () => {
  it('AC: two comments submit as ONE thread message carrying both items', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await startCommenting();

    await comment(300, 90, 'make this title punchier');
    await comment(300, 200, 'cut this in half');

    // Batched, not sent: nothing has gone anywhere yet.
    expect(postEvent).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('feedback-pin')).toHaveLength(2);

    await userEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(postEvent).toHaveBeenCalledTimes(1));
    const user = (useDocThreadStore.getState().messages[KEY] ?? []).filter((m) => m.kind === 'user');
    expect(user).toHaveLength(1);
    expect(user[0]!.text).toContain('make this title punchier');
    expect(user[0]!.text).toContain('cut this in half');
    expect(user[0]!.kind === 'user' && user[0]!.items).toEqual([
      { wid: 'h1', text: 'make this title punchier' },
      { wid: 'p1', text: 'cut this in half' },
    ]);
    expect(injectDocMessage).toHaveBeenCalledTimes(1);
  });

  it('the submit button appears only with a batch, and clears the batch on success', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await startCommenting();
    expect(screen.queryByTestId('feedback-submit')).toBeNull();

    await comment(300, 90, 'punchier');
    expect(screen.getByTestId('feedback-submit')).toHaveTextContent('Send 1 comment');

    await userEvent.click(screen.getByTestId('feedback-submit'));
    await waitFor(() => expect(screen.queryByTestId('feedback-submit')).toBeNull());
    expect(screen.queryAllByTestId('feedback-pin')).toHaveLength(0);
  });

  it('a failed BUS EVENT keeps the batch so it can be sent again', async () => {
    postEvent.mockRejectedValue(new Error('API 503: bridge_unavailable'));
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await startCommenting();
    await comment(300, 90, 'punchier');
    await userEvent.click(screen.getByTestId('feedback-submit'));

    await waitFor(() => expect(screen.getByTestId('feedback-error')).toHaveTextContent(/503/));
    expect(screen.getByTestId('feedback-submit')).toBeInTheDocument();
    expect(screen.getAllByTestId('feedback-pin')).toHaveLength(1);
  });
});

describe('FeedbackOverlay — deep-linking back to the element (§4.3)', () => {
  it('AC: asking for a wid posts scroll-to-wid INTO the frame, over the protocol', async () => {
    const bridge = makeFixtureBridge({ widMap: WIDS });
    mount(bridge);
    await waitFor(() => expect(screen.getByTestId('feedback-toggle')).toBeEnabled());

    // This is precisely what a thread item's click does (`widScroller`).
    act(() => { scrollToWid('slide-4-body-2'); });

    expect(bridge.sent).toContainEqual({ v: 1, type: 'scroll-to-wid', wid: 'slide-4-body-2' });
  });

  it('a deep-link with no overlay mounted no-ops rather than throwing', () => {
    cleanup();
    expect(() => scrollToWid('h1')).not.toThrow();
  });
});
