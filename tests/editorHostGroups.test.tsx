import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '../src/api/editors.js';
import { HostPanel } from '../src/components/editorHost/HostPanel.js';
import { PluginCard } from '../src/components/editorHost/PluginCard.js';
import { FakeSurfaceAdapter } from '../src/editors/adapters/fake.js';
import type { HostAdapter } from '../src/editors/host.js';
import { RUN_TAB, useHostChrome, useHostPanel, type ArtifactBinding } from '../src/editors/hostApi.js';
import { resetArtifactSizes } from '../src/store/artifactSizes.js';
import { useEditors } from '../src/store/editors.js';

const DECL = {
  card: { interactive: true },
  options: { tabs: [{ id: 'notes', label: 'Speaker notes', render: 'plugin' }] },
};
const EDITOR = {
  id: 'group-test', title: 'Deck', version: '0.1.0', sha256: 'a'.repeat(64), protocol: [1, 2],
  kinds: ['deck'], sizes: ['inline', 'pane', 'full'], enabled: true, first_party: true,
} as EditorView;
const BINDING: ArtifactBinding = {
  artifactKey: 'group-test-deck', title: 'A deck', kind: 'deck', source: 'fake', projectId: '', composerKey: 'group-test',
};
const GRANTS = ['artifact.read', 'artifact.write', 'artifact.theme', 'selection.chip'] as const;
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
type Message = { type?: string; re?: string; ok?: boolean; payload?: Record<string, unknown> };
const ports: MessagePort[] = [];

/** Use the real handshake and port, as editorProtocol2 does, while rendering both host surfaces. */
function connect(frame: HTMLIFrameElement) {
  let transferred: MessagePort | undefined;
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _origin: unknown, tr?: Transferable[]) => {
    transferred = tr?.[0] as MessagePort | undefined;
  }) as never);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: env('plugin.ready', { editor: EDITOR.id, version: EDITOR.version, protocol: [2], surfaces: DECL }),
      source: frame.contentWindow,
    }));
  });
  expect(transferred).toBeDefined();
  const port = transferred!;
  ports.push(port);
  const seen: Message[] = [];
  port.onmessage = (e) => { seen.push(e.data as Message); };
  let sequence = 0;
  const request = async (type: string, payload: unknown): Promise<Message> => {
    const id = `request-${++sequence}`;
    await act(async () => {
      port.postMessage(env(type, payload, id));
      await vi.waitFor(() => expect(seen.some((m) => m.re === id)).toBe(true));
    });
    return seen.find((m) => m.re === id)!;
  };
  const select = async (id: string | null): Promise<void> => {
    port.postMessage(env('selection.set', { anchors: id === null ? [] : [{ kind: 'element', id }] }));
    // A subsequent reply on this port confirms the selection event was handled.
    await request('artifact.read', {});
  };
  return { port, seen, request, select };
}

async function openCard() {
  const adapter = new FakeSurfaceAdapter(BINDING);
  render(<><PluginCard binding={BINDING} editor={EDITOR} adapter={adapter} src="about:blank" grants={GRANTS} /><HostPanel /></>);
  let frame: HTMLIFrameElement | null = null;
  await waitFor(() => {
    frame = screen.getByTestId('plugin-card-frame').querySelector('iframe');
    expect(frame).not.toBeNull();
  });
  const card = connect(frame!);
  const openOptions = (): HTMLIFrameElement => {
    fireEvent.click(screen.getByTestId('plugin-card-options'));
    return screen.getByTestId('host-panel-frame').querySelector('iframe')!;
  };
  return { adapter, card, openOptions };
}

beforeEach(() => {
  useEditors.setState({ state: 'ready', editors: [EDITOR], reason: null });
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false });
  useHostChrome.setState({ full: null, navCollapsed: false, chatOpen: false, navBefore: false });
  resetArtifactSizes();
});
afterEach(() => {
  cleanup();
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
});

describe('card and Options instances of one artifact', () => {
  it('replays the latest card selection when Options joins and finishes its handshake', async () => {
    const { card, openOptions } = await openCard();
    await card.select('section-1');
    const optionsFrame = openOptions();
    // The operator selects slide 3 while the Options bundle is still loading.
    await card.select('section-2');
    const options = connect(optionsFrame);
    await options.request('artifact.read', {});
    expect(options.seen.filter((m) => m.type === 'host.selection')).toEqual([
      expect.objectContaining({ payload: { anchors: [{ kind: 'element', id: 'section-2' }] } }),
    ]);
    expect(card.seen.filter((m) => m.type === 'host.selection')).toHaveLength(0);
  });

  it('replays a selection made before Options was opened', async () => {
    const { card, openOptions } = await openCard();
    await card.select('section-2');
    const options = connect(openOptions());
    await options.request('artifact.read', {});
    expect(options.seen.filter((m) => m.type === 'host.selection')).toEqual([
      expect.objectContaining({ payload: { anchors: [{ kind: 'element', id: 'section-2' }] } }),
    ]);
    // Subsequent selections and clearing still travel over the live relay.
    await card.select(null);
    await options.request('artifact.read', {});
    expect(options.seen.filter((m) => m.type === 'host.selection').at(-1)?.payload).toEqual({ anchors: [] });
  });

  it('does not replay a selection cleared before the Options handshake', async () => {
    const { card, openOptions } = await openCard();
    await card.select('section-2');
    const optionsFrame = openOptions();
    await card.select(null);
    const options = connect(optionsFrame);
    await options.request('artifact.read', {});
    expect(options.seen.filter((m) => m.type === 'host.selection')).toHaveLength(0);
  });

  it.each(['notes', 'theme'] as const)('shows an Options %s write on the card with working Undo', async (kind) => {
    const { adapter, card, openOptions } = await openCard();
    const original = adapter.headHtml();
    const undo = vi.spyOn(adapter, 'undo');
    const theme: NonNullable<HostAdapter['theme']> = async (base) => adapter.write(base, [
      { selector: 'slide-0-heading-1', type: 'style-edit', style: { color: '#123456' } },
    ], 'the theme');
    Object.assign(adapter, { theme });
    const options = connect(openOptions());
    const result = kind === 'notes'
      ? await options.request('version.write', { base: 1, ops: [{ op: 'notes-set', slide: 's-staff', text: 'Explain the staffing view.' }], summary: 'untrusted plugin summary' })
      : await options.request('theme.set', { base: 1, tokens: {} });
    expect(result).toMatchObject({ ok: true, payload: { version: 2 } });
    expect(screen.getByTestId('page-line')).toHaveAttribute('data-kind', 'edited');
    expect(screen.getByTestId('page-line').textContent).toContain(kind === 'notes'
      ? 'Changed slide 3’s notes — version 2.' : 'Restyled the theme — version 2.');
    expect(screen.getByTestId('page-line').textContent).not.toContain('untrusted plugin summary');
    await card.request('artifact.read', {});
    expect(card.seen).toContainEqual(expect.objectContaining({ type: 'artifact.changed', payload: expect.objectContaining({ version: 2, by: 'this-editor' }) }));
    await act(async () => { fireEvent.click(screen.getByTestId('page-undo')); });
    expect(undo).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getByTestId('page-line')).toHaveAttribute('data-kind', 'undone');
    expect(adapter.artifact().head).toBe(3);
    expect(adapter.headHtml()).toBe(original);
  });

  it('shows a failed Options write on the card and forwards Options status messages', async () => {
    const { adapter, openOptions } = await openCard();
    const options = connect(openOptions());
    vi.spyOn(adapter, 'write').mockResolvedValue({ error: 'refused', message: 'The notes could not be saved.' });
    const result = await options.request('version.write', {
      base: 1, ops: [{ op: 'notes-set', slide: 's-staff', text: 'New notes' }], summary: 'notes',
    });
    expect(result.ok).toBe(false);
    expect(screen.getByTestId('page-line')).toHaveAttribute('data-kind', 'failed');
    expect(screen.getByTestId('page-line').textContent).toContain('The notes could not be saved.');
    expect(screen.queryByTestId('page-undo')).toBeNull();
    expect(adapter.artifact().head).toBe(1);
    options.port.postMessage(env('ui.status', { line: 'Choose a slide to edit its notes.' }));
    await options.request('artifact.read', {});
    expect(screen.getByTestId('page-line').textContent).toBe('Choose a slide to edit its notes.');
  });
});
