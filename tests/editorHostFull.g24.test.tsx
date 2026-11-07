import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '../src/api/editors.js';

// The ask route is askAbout's own (tests/askAbout*): here only WHEN it is called, and what is on screen by then.
const asked: { full: string | null; chatOpen: boolean }[] = [];
vi.mock('../src/board/askAbout.js', () => ({
  askAbout: vi.fn(async () => {
    const { useHostChrome } = await import('../src/editors/hostApi.js');
    const s = useHostChrome.getState();
    asked.push({ full: s.full, chatOpen: s.chatOpen });
  }),
}));

const { HostPanel } = await import('../src/components/editorHost/HostPanel.js');
const { PluginCard } = await import('../src/components/editorHost/PluginCard.js');
const { RunHostProvider } = await import('../src/components/editorHost/RunHostContext.js');
const { FakeSurfaceAdapter } = await import('../src/editors/adapters/fake.js');
const { RUN_TAB, useHostChrome, useHostPanel } = await import('../src/editors/hostApi.js');
const { resetArtifactSizes } = await import('../src/store/artifactSizes.js');
const { useAdvisoryNotes, useEditors } = await import('../src/store/editors.js');
import type { ArtifactBinding } from '../src/editors/hostApi.js';

/**
 * plugins-complete G24: full screen keeps the card's verbs. Its header draws the same declared actions (Ask, Export)
 * and Options; Options opens over the full screen and Esc there closes only the options; Ask from full screen opens
 * the run's chat drawer first, or, with no run chat, gives way to the card first. G25: the plugin's own notes show
 * on the card, labelled advisory.
 */

const DECL = {
  card: { interactive: true, actions: [{ id: 'ask', label: 'Ask about this', verb: 'host:ask' }, { id: 'export', label: 'Export', verb: 'host:export' }] },
  options: { tabs: [{ id: 'style', label: 'Style', render: 'plugin' }] },
  full: { modes: ['simple', 'advanced'], default: 'simple' },
};
const EDITOR = {
  id: 'full-test', title: 'Page', version: '0.1.0', sha256: 'b'.repeat(64), protocol: [1, 2],
  kinds: ['page'], sizes: ['inline', 'pane', 'full'], enabled: true, first_party: true,
} as EditorView;
const BINDING: ArtifactBinding = { artifactKey: 'full-test-page', title: 'A page', kind: 'page', source: 'fake', projectId: '', composerKey: 'full-test' };
const GRANTS = ['artifact.read', 'artifact.write', 'checks.contribute', 'artifact.export'] as const;
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
const ports: MessagePort[] = [];

/** A fake whose data plane makes web pages and PDFs, like interactive's. */
class ExportingFake extends FakeSurfaceAdapter {
  made: { format: string; version: number }[] = [];
  capabilities() { return [...super.capabilities(), 'export' as const]; }
  exports() { return [{ format: 'html', label: 'Web page' }, { format: 'pdf', label: 'PDF' }]; }
  async exportFile(format: string, version: number) {
    this.made.push({ format, version });
    return { ok: true as const, text: 'The PDF is ready.', href: '/x.pdf', file: 'x.pdf' };
  }
}

async function openCard(withChat: boolean) {
  const adapter = new ExportingFake(BINDING);
  const card = <><PluginCard binding={BINDING} editor={EDITOR} adapter={adapter} src="about:blank" grants={GRANTS} /><HostPanel /></>;
  render(withChat ? <RunHostProvider value={{ renderChat: () => <p>the thread</p> } as never}>{card}</RunHostProvider> : card);
  let frame: HTMLIFrameElement | null = null;
  await waitFor(() => {
    frame = screen.getByTestId('plugin-card-frame').querySelector('iframe');
    expect(frame).not.toBeNull();
  });
  let transferred: MessagePort | undefined;
  vi.spyOn(frame!.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { transferred = tr?.[0] as MessagePort | undefined; }) as never);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor: EDITOR.id, version: EDITOR.version, protocol: [2], surfaces: DECL }), source: frame!.contentWindow }));
  });
  ports.push(transferred!);
  await waitFor(() => expect(screen.getByTestId('plugin-card-full')).toBeTruthy());
  return { port: transferred!, adapter };
}

beforeEach(() => {
  asked.length = 0;
  useEditors.setState({ state: 'ready', editors: [EDITOR], reason: null });
  useAdvisoryNotes.setState({ byGroup: {} });
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false, overlay: false });
  useHostChrome.setState({ full: null, navCollapsed: false, chatOpen: false, navBefore: false });
  resetArtifactSizes();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => {
  cleanup();
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('G24: full screen keeps the card’s actions', () => {
  it('the full-screen header draws Ask, Export and Options', async () => {
    await openCard(false);
    expect(screen.queryByTestId('full-shell-actions')).toBeNull();
    fireEvent.click(screen.getByTestId('plugin-card-full'));
    const head = screen.getByTestId('full-shell-actions');
    expect([...head.querySelectorAll('[data-testid="plugin-card-action"]')].map((b) => b.getAttribute('data-verb'))).toEqual(['host:ask', 'host:export']);
    expect(head.querySelector('[data-testid="plugin-card-options"]')).not.toBeNull();
  });

  it('Options opens over the full screen with the keyboard in it; Esc closes only the options and gives the focus back', async () => {
    await openCard(false);
    fireEvent.click(screen.getByTestId('plugin-card-full'));
    const options = screen.getByTestId('full-shell-actions').querySelector<HTMLButtonElement>('[data-testid="plugin-card-options"]')!;
    options.focus();
    fireEvent.click(options);
    const panel = screen.getByTestId('host-panel');
    expect(panel.dataset['overFull']).toBe('true');
    expect(panel.className).toContain('wk-hpanel--overfull');
    // The keyboard moved into the options: the next Esc is theirs.
    expect(document.activeElement).toBe(screen.getByTestId('host-panel-close'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(useHostPanel.getState().group).toBeNull();
    expect(useHostChrome.getState().full).toBe(BINDING.artifactKey);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('full-shell-actions').querySelector('[data-testid="plugin-card-options"]')));
  });

  it('Esc pressed while the full screen’s own Options button still holds the focus closes the options, not the full screen', async () => {
    await openCard(false);
    fireEvent.click(screen.getByTestId('plugin-card-full'));
    const options = screen.getByTestId('full-shell-actions').querySelector<HTMLButtonElement>('[data-testid="plugin-card-options"]')!;
    fireEvent.click(options);
    options.focus();
    fireEvent.keyDown(options, { key: 'Escape' });
    expect(useHostPanel.getState().group).toBeNull();
    expect(useHostChrome.getState().full).toBe(BINDING.artifactKey);
    // With no options open, the next Esc leaves the full screen.
    fireEvent.keyDown(options, { key: 'Escape' });
    expect(useHostChrome.getState().full).toBeNull();
  });

  it('× on the options over the full screen gives the focus back to its Options', async () => {
    await openCard(false);
    fireEvent.click(screen.getByTestId('plugin-card-full'));
    fireEvent.click(screen.getByTestId('full-shell-actions').querySelector('[data-testid="plugin-card-options"]')!);
    fireEvent.click(screen.getByTestId('host-panel-close'));
    expect(useHostChrome.getState().full).toBe(BINDING.artifactKey);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('full-shell-actions').querySelector('[data-testid="plugin-card-options"]')));
  });

  it('Ask in full screen with the run’s chat opens the drawer first, and stays full screen', async () => {
    await openCard(true);
    fireEvent.click(screen.getByTestId('plugin-card-full'));
    fireEvent.click(screen.getByTestId('full-shell-actions').querySelector('[data-verb="host:ask"]')!);
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toEqual({ full: BINDING.artifactKey, chatOpen: true });
    expect(screen.getByTestId('full-shell-drawer').textContent).toContain('the thread');
  });

  it('Ask in full screen with no run chat leaves full screen first, so the chat it opens is on screen', async () => {
    await openCard(false);
    fireEvent.click(screen.getByTestId('plugin-card-full'));
    fireEvent.click(screen.getByTestId('full-shell-actions').querySelector('[data-verb="host:ask"]')!);
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]!.full).toBeNull();
  });
});

describe('G25: the plugin’s own notes on the card', () => {
  it('checks.contribute shows the notes, labelled advisory', async () => {
    const { port } = await openCard(false);
    act(() => { port.postMessage(env('checks.contribute', { checks: [{ id: 'n1', text: 'The word "free" appears 3 times' }] })); });
    await waitFor(() => expect(screen.getByTestId('plugin-card-advisory')).toBeTruthy());
    expect(screen.getByTestId('plugin-card-advisory').textContent).toContain('advisory, not a review');
    expect(screen.getAllByTestId('plugin-card-advisory-note').map((n) => n.textContent)).toEqual(['The word "free" appears 3 times']);
  });
});

describe('G25: a plugin’s export ask is a host offer on the card', () => {
  it('export.request shows the offer; only the press makes the file, of the head', async () => {
    const { port, adapter } = await openCard(false);
    act(() => { port.postMessage(env('export.request', { format: 'pdf' }, 'x1')); });
    await waitFor(() => expect(screen.getByTestId('plugin-card-export-offer').textContent).toContain('asks to export this as PDF'));
    expect(adapter.made).toEqual([]);
    fireEvent.click(screen.getByTestId('plugin-card-export-offer-accept'));
    await waitFor(() => expect(adapter.made).toEqual([{ format: 'pdf', version: adapter.artifact().head }]));
    expect(screen.queryByTestId('plugin-card-export-offer')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('artifact-export-download')).toBeTruthy());
  });
});
