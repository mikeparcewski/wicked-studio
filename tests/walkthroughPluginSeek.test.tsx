import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '../src/api/editors.js';
import { ArtifactMorph } from '../src/components/session/ArtifactMorph.js';
import { FakeSurfaceAdapter } from '../src/editors/adapters/fake.js';
import { registerAdapter, useHostChrome, useLiveCards } from '../src/editors/hostApi.js';
import { resetArtifactSizes } from '../src/store/artifactSizes.js';
import { useEditors } from '../src/store/editors.js';
import { requestWalkthroughSeek, resetWalkthroughSeekForTest, useWalkthroughSeek } from '../src/store/walkthroughSeek.js';

vi.mock('../src/editors/model.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/editors/model.js')>(),
  fetchGrants: async () => ({ grants: ['artifact.read'], note: null }),
  bundleUrl: () => 'about:blank',
}));

// A different editor id proves that the host routes by the slot and run, never by plugin id.
const editor: EditorView = {
  id: 'another-video-editor', title: 'Video', version: '1.0.0', sha256: 'a'.repeat(64),
  enabled: true, first_party: false, protocol: [1, 2], kinds: ['walkthrough', 'demo-video'], sizes: ['inline', 'full'],
  permissions: [], bytes: 1, source: 'pack', entry_url: '',
};
const surfaces = { card: { interactive: true }, full: {} };
const env = (type: string, payload: unknown) => ({ p: 'wicked.editor', v: 1, type, payload });
type Message = { type?: string; id?: string; payload?: Record<string, unknown> };
const ports: MessagePort[] = [];

beforeEach(() => {
  resetWalkthroughSeekForTest();
  resetArtifactSizes();
  useLiveCards.setState({ order: [] });
  useHostChrome.setState({ full: null, navCollapsed: false, navBefore: false, chatOpen: false });
  useEditors.setState({ state: 'ready', editors: [editor], reason: null });
  for (const source of ['walkthrough', 'demo'] as const) {
    registerAdapter(source, () => new FakeSurfaceAdapter({ kind: 'walkthrough', title: 'Recording' }));
  }
});
afterEach(() => {
  cleanup();
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
});

async function mount(runId = 'r-walk', kind: 'walkthrough' | 'demo-video' = 'walkthrough') {
  const fallback = vi.fn(() => <p>Legacy player</p>);
  const key = `${runId}:p/${kind}`;
  const view = render(<ArtifactMorph artifactKey={key} title="Recording" projectId="p" docId={kind} composerKey="c"
    slot={{ kind, body: fallback }} />);
  await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull());
  expect(fallback).not.toHaveBeenCalled();
  return { ...view, key, frame: view.container.querySelector<HTMLIFrameElement>('iframe')! };
}

async function handshake(frame: HTMLIFrameElement) {
  const seen: Message[] = [];
  let port: MessagePort | undefined;
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((message: Message, _origin: unknown, transfer?: Transferable[]) => {
    if (message.type !== 'host.hello') return;
    port = transfer?.[0] as MessagePort;
    ports.push(port);
    port.onmessage = (event: MessageEvent<Message>) => {
      const m = event.data;
      seen.push(m);
      if (m.id !== undefined) port?.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: true, payload: {} });
    };
  }) as never);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      data: env('plugin.ready', { editor: editor.id, version: editor.version, protocol: [1, 2], surfaces }),
    }));
  });
  await waitFor(() => expect(port).toBeDefined());
  return seen;
}

const selections = (seen: Message[]) => seen.filter((m) => m.type === 'host.selection');

describe('walkthrough evidence seeks through the protocol-2 card', () => {
  it('opens the routed card full screen, sends a time anchor, and handles repeated asks without remounting', async () => {
    const { container, key, frame, unmount } = await mount();
    const seen = await handshake(frame);
    act(() => requestWalkthroughSeek('r-walk', 34));
    await waitFor(() => expect(selections(seen)).toHaveLength(1));
    expect(selections(seen)[0]?.payload).toEqual({ anchors: [{ kind: 'time', atSec: 34 }] });
    expect(useHostChrome.getState().full).toBe(key);
    expect(container.querySelector('[data-testid="full-shell"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBe(frame);
    expect(useWalkthroughSeek.getState().byRun['r-walk']).toBeUndefined();
    act(() => requestWalkthroughSeek('r-walk', 34));
    await waitFor(() => expect(selections(seen)).toHaveLength(2));
    expect(container.querySelector('iframe')).toBe(frame);
    unmount();
    // Leaving the run collapses its placements; returning must not replay a consumed seek.
    act(() => resetArtifactSizes());

    const again = await mount();
    const after = await handshake(again.frame);
    expect(selections(after)).toHaveLength(0);
    expect(useHostChrome.getState().full).toBeNull();
  });

  it('keeps the latest request until the handshake has a port', async () => {
    const { frame, key } = await mount();
    act(() => { requestWalkthroughSeek('r-walk', 34); requestWalkthroughSeek('r-walk', 17); });
    expect(useWalkthroughSeek.getState().byRun['r-walk']?.sec).toBe(17);
    const seen = await handshake(frame);
    await waitFor(() => expect(selections(seen)).toHaveLength(1));
    expect(selections(seen)[0]?.payload).toEqual({ anchors: [{ kind: 'time', atSec: 17 }] });
    expect(useWalkthroughSeek.getState().byRun['r-walk']).toBeUndefined();
    expect(useHostChrome.getState().full).toBe(key);
  });

  it('wakes a resting walkthrough and delivers only after its new host connects', async () => {
    const view = await mount();
    await handshake(view.frame);
    act(() => useLiveCards.setState({ order: [view.key, ...Array.from({ length: 6 }, (_, i) => `other-${i}`)] }));
    expect(view.container.querySelector('iframe')).toBeNull();
    act(() => requestWalkthroughSeek('r-walk', 34));
    await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull());
    expect(useWalkthroughSeek.getState().byRun['r-walk']?.sec).toBe(34);
    const seen = await handshake(view.container.querySelector<HTMLIFrameElement>('iframe')!);
    await waitFor(() => expect(selections(seen)).toHaveLength(1));
    expect(useHostChrome.getState().full).toBe(view.key);
    expect(useWalkthroughSeek.getState().byRun['r-walk']).toBeUndefined();
  });

  it.each([
    { runId: 'another-run', kind: 'walkthrough' as const },
    { runId: 'r-walk', kind: 'demo-video' as const },
  ])('leaves the request for its own walkthrough ($runId, $kind)', async ({ runId, kind }) => {
    const { frame } = await mount(runId, kind);
    const seen = await handshake(frame);
    act(() => requestWalkthroughSeek('r-walk', 34));
    expect(useWalkthroughSeek.getState().byRun['r-walk']?.sec).toBe(34);
    expect(useHostChrome.getState().full).toBeNull();
    expect(selections(seen)).toHaveLength(0);
  });
});
