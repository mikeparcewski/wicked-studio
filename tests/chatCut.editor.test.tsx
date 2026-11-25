import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '../src/api/editors.js';
import { PluginCard } from '../src/components/editorHost/PluginCard.js';
import { FakeSurfaceAdapter } from '../src/editors/adapters/fake.js';
import { RUN_TAB, useHostChrome, useHostPanel, type ArtifactBinding } from '../src/editors/hostApi.js';
import { resetArtifactSizes } from '../src/store/artifactSizes.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { noteCutLanded, resetCutLanded } from '../src/store/chatCutLanded.js';
import { useEditors } from '../src/store/editors.js';

/**
 * crew#1814 / studio#1140 (a): the version a chat's cut card made plays in the video's editor card, with the card's
 * write line and a working Undo; only while it is still the head, only for this card's own video, and only where crew
 * draws cut cards. The editor is the real PluginCard and EditorHost over the real handshake and port.
 */
const EDITOR = {
  id: 'wicked-video', title: 'Video', version: '0.1.0', sha256: 'a'.repeat(64), protocol: [1, 2],
  kinds: ['deck'], sizes: ['inline', 'pane', 'full'], enabled: true, first_party: true,
} as EditorView;
// The cut crew's card names: `artifactRefOf('mikes', 'demo-8e0ffbece431')`.
const REF = 'mikes/demo-8e0ffbece431';
const BINDING: ArtifactBinding = {
  artifactKey: 'chat-cut-video', title: 'Demo of http://127.0.0.1:5173/', kind: 'deck', source: 'demo', projectId: 'mikes',
  composerKey: 'chat-cut', docId: 'demo-8e0ffbece431',
};
const GRANTS = ['artifact.read', 'artifact.write', 'selection.chip'] as const;
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
type Message = { type?: string; re?: string; payload?: Record<string, unknown> };
const ports: MessagePort[] = [];

/** Another writer makes a version of the video (the video tool's render of the chat's ops, or a later hand edit). */
const landElsewhere = async (adapter: FakeSurfaceAdapter, color = '#123456'): Promise<number> => {
  const r = await adapter.write(adapter.artifact().head, [{ selector: 'slide-0-heading-1', type: 'style-edit', style: { color } }], 'elsewhere');
  if ('error' in r) throw new Error(r.message);
  return r.version;
};

async function openCard(adapter = new FakeSurfaceAdapter(BINDING)) {
  const view = render(<PluginCard binding={BINDING} editor={EDITOR} adapter={adapter} src="about:blank" grants={GRANTS} />);
  let frame: HTMLIFrameElement | null = null;
  await waitFor(() => {
    frame = screen.getByTestId('plugin-card-frame').querySelector('iframe');
    expect(frame).not.toBeNull();
  });
  let transferred: MessagePort | undefined;
  vi.spyOn(frame!.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { transferred = tr?.[0] as MessagePort | undefined; }) as never);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame!.contentWindow, data: env('plugin.ready', { editor: EDITOR.id, version: EDITOR.version, protocol: [1] }) }));
  });
  const port = transferred!;
  ports.push(port);
  const seen: Message[] = [];
  port.onmessage = (e) => { seen.push(e.data as Message); };
  const settle = async (): Promise<void> => {
    const id = `read-${seen.length}`;
    await act(async () => {
      port.postMessage(env('artifact.read', {}, id));
      await vi.waitFor(() => expect(seen.some((m) => m.re === id)).toBe(true));
    });
  };
  return { adapter, seen, settle, view };
}

beforeEach(() => {
  useEditors.setState({ state: 'ready', editors: [EDITOR], reason: null });
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false });
  useHostChrome.setState({ full: null, navCollapsed: false, chatOpen: false, navBefore: false });
  useCapabilities.setState({ loaded: true, chatCutInView: true, chatCut: true });
  resetArtifactSizes();
  resetCutLanded();
});
afterEach(() => {
  cleanup();
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
  useCapabilities.setState({ chatCutInView: false, chatCut: false });
});

describe('the version a chat made, in the video\'s editor', () => {
  it('plays at once with the card\'s line, and its Undo makes the earlier cut the working one again', async () => {
    const { adapter, seen, settle } = await openCard();
    const undo = vi.spyOn(adapter, 'undo');
    const v = await landElsewhere(adapter);
    await act(async () => { noteCutLanded({ ref: REF, version: v, base: 1 }); });
    await waitFor(() => expect(screen.getByTestId('page-line')).toHaveAttribute('data-kind', 'edited'));
    expect(screen.getByTestId('page-line').textContent).toContain('Changed the video from the chat — version 2.');
    await settle();
    expect(seen).toContainEqual(expect.objectContaining({ type: 'artifact.changed', payload: expect.objectContaining({ version: 2, by: 'this-editor' }) }));
    await act(async () => { fireEvent.click(screen.getByTestId('page-undo')); });
    expect(undo).toHaveBeenCalledExactlyOnceWith(2);
    expect(adapter.artifact().head).toBe(3);
  });

  it('a version that is no longer the head (a hand edit landed after it) is never adopted and gets no Undo', async () => {
    const { adapter, seen, settle } = await openCard();
    const v = await landElsewhere(adapter);
    await landElsewhere(adapter, '#654321');
    await act(async () => { noteCutLanded({ ref: REF, version: v, base: 1 }); });
    await settle();
    expect(screen.queryByTestId('page-undo')).toBeNull();
    expect(seen.filter((m) => m.type === 'artifact.changed' && m.payload?.['version'] === 2 && m.payload?.['by'] === 'this-editor')).toHaveLength(0);
  });

  it('a card unmounted while its re-read is in flight touches nothing, and the next editor of the video plays it', async () => {
    const shared = new FakeSurfaceAdapter(BINDING);
    const { view } = await openCard(shared);
    const held: Array<(v: null) => void> = [];
    const finish = (): void => { for (const r of held.splice(0)) r(null); };
    Object.assign(shared, { refresh: () => new Promise<null>((r) => { held.push(r); }) });
    const v = await landElsewhere(shared);
    await act(async () => { noteCutLanded({ ref: REF, version: v, base: 1 }); });
    view.unmount();
    Object.assign(shared, { refresh: async () => null });
    await act(async () => { finish(); });
    // The next card of this video (here over the same store of versions) takes the landing that was left.
    await openCard(shared);
    await waitFor(() => expect(screen.getByTestId('page-line').textContent).toContain('Changed the video from the chat — version 2.'));
  });

  it('a card for another video hears nothing', async () => {
    const { adapter, settle } = await openCard();
    await landElsewhere(adapter);
    await act(async () => { noteCutLanded({ ref: 'mikes/demo-other', version: 2, base: 1 }); });
    await settle();
    expect(screen.queryByTestId('page-undo')).toBeNull();
  });

  it('on a crew that draws no cut cards, the editor hears nothing', async () => {
    useCapabilities.setState({ chatCut: false });
    const { adapter, settle } = await openCard();
    const v = await landElsewhere(adapter);
    await act(async () => { noteCutLanded({ ref: REF, version: v, base: 1 }); });
    await settle();
    expect(screen.queryByTestId('page-undo')).toBeNull();
  });

  it.each([false, true])(
    'a landing that arrives before the card\'s host exists plays once the host starts, unless a newer version landed first (newer first: %s; review r1 delta)', async (newer) => {
      const adapter = new FakeSurfaceAdapter(BINDING);
      const held: Array<(v: null) => void> = [];
      Object.assign(adapter, { refresh: () => new Promise<null>((r) => { held.push(r); }) });
      render(<PluginCard binding={BINDING} editor={EDITOR} adapter={adapter} src="about:blank" grants={GRANTS} />);
      const v = await landElsewhere(adapter);
      await act(async () => { noteCutLanded({ ref: REF, version: v, base: 1 }); });
      expect(screen.getByTestId('plugin-card-frame').querySelector('iframe')).toBeNull();
      if (newer) await landElsewhere(adapter, '#654321');
      Object.assign(adapter, { refresh: async () => null });
      await act(async () => { for (const r of held.splice(0)) r(null); });
      await waitFor(() => expect(screen.getByTestId('plugin-card-frame').querySelector('iframe')).not.toBeNull());
      if (newer) {
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(screen.queryByTestId('page-undo')).toBeNull();
      } else {
        await waitFor(() => expect(screen.getByTestId('page-line').textContent).toContain('Changed the video from the chat — version 2.'));
      }
    });
});
