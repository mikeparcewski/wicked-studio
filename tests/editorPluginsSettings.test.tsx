import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_EDITOR_WORKFLOW_ID,
  devHostHref,
  EditorPluginList,
  kindsInWords,
  permissionsInWords,
} from '../src/components/editors/EditorPluginsSettings.js';
import { EditorHostPage } from '../src/components/editors/EditorHostPage.js';
import { PluginsPage, cardsOf, editorLooks, filterCards, slotWords } from '../src/components/editors/PluginsPage.js';
import { RUN_PLUGINS } from '../src/plugins/runPlugins.js';
import { useLaunchWizard } from '../src/store/launchWizard.js';
import { takeComposerSeed } from '../src/store/composerSeed.js';

/** A plugin's card on the Plugins page, once the list is read. */
async function tileOf(id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const t = screen.getAllByTestId('plugin-tile').find((x) => x.dataset['plugin'] === id);
    if (t === undefined) throw new Error(`no card for ${id}`);
    return t;
  });
}

/** The Plugins page (operator 2026-10-12; was Settings → Developer → Editor plugins, ruling X3) and the editor test page's empty state. */

/** A made-up home folder, spelled at run time (the raw error must show it as ~). */
const FAKE_HOME = ['', 'Users', 'someone'].join('/');
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const EDITORS = {
  installs: 'conformance_required',
  editors: [
    { id: 'wicked-page', title: 'Page editor', version: '1.0.0', protocol: [1], kinds: ['page'], sizes: ['inline', 'pane', 'full'],
      permissions: [{ id: 'artifact.read', why: 'r' }, { id: 'artifact.write', why: 'w' }], sha256: SHA_A, bytes: 10,
      first_party: true, enabled: true, source: 'studio-bundle', entry_url: '/api/v1/editors/wicked-page/1.0.0/entry' },
    { id: 'e2e-json-viewer', title: 'JSON viewer', version: '0.1.0', protocol: [1], kinds: ['page', 'document'], sizes: ['inline'],
      permissions: [{ id: 'artifact.read', why: 'r' }, { id: 'ui.fullscreen', why: 'f' }], sha256: SHA_B, bytes: 10,
      first_party: false, enabled: true, source: 'pack', entry_url: '/api/v1/editors/e2e-json-viewer/0.1.0/entry' },
  ],
};

function stubFetch(answer: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const f = vi.fn((input: RequestInfo | URL) => (String(input).includes('/editors') ? answer() : Promise.resolve(new Response('{}', { status: 200 }))));
  vi.stubGlobal('fetch', f);
  return f;
}
const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('words, never ids', () => {
  it('kinds and permissions read as plain words', () => {
    expect(kindsInWords(['page'])).toBe('pages');
    expect(kindsInWords(['page', 'document', 'demo-video'])).toBe('pages, documents and demo videos');
    expect(kindsInWords(['json-tree'])).toBe('json tree');
    expect(permissionsInWords([{ id: 'artifact.read' }, { id: 'ui.fullscreen' }])).toEqual({ can: 'Can: read what it opens · go full screen', internet: null });
    expect(permissionsInWords([{ id: 'artifact.read' }, { id: 'network.media' }])).toEqual({ can: 'Can: read what it opens', internet: 'Also loads images and fonts from the internet.' });
    expect(permissionsInWords([]).can).toBe('Asks for nothing.');
  });

  it('the test page link carries the editor, its version, its pinned hash and its title', () => {
    const href = devHostHref({ id: 'e2e-json-viewer', version: '0.1.0', sha256: SHA_B, title: 'JSON viewer' });
    const q = new URLSearchParams(href.split('?')[1]);
    expect(href.startsWith('/editors/dev?')).toBe(true);
    expect(Object.fromEntries(q)).toEqual({ editor: 'e2e-json-viewer', version: '0.1.0', sha: SHA_B, title: 'JSON viewer' });
  });

  it('a deck editor opens over the sample deck, a video editor over the sample cut (orchestrator 2026-10-14)', () => {
    const kindOf = (kinds: string[]): string | null => new URLSearchParams(devHostHref({ id: 'x', version: '1', sha256: SHA_B, title: 'X', kinds }).split('?')[1]).get('kind');
    expect(kindOf(['deck'])).toBe('deck');
    expect(kindOf(['demo-video', 'walkthrough'])).toBe('demo-video');
    expect(kindOf(['walkthrough'])).toBe('demo-video');
    expect(kindOf(['page'])).toBeNull();
  });
});

describe('the Plugins page (editor plugins)', () => {
  it('every plugin is a card: preview, icon, title and tag, one line, where it shows; the filter picks them', async () => {
    const f = stubFetch(() => json(EDITORS));
    const navigate = vi.fn();
    render(<PluginsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('plugin-tile')).toHaveLength(3));
    const tiles = screen.getAllByTestId('plugin-tile');
    expect(tiles.map((t) => t.dataset.plugin)).toEqual(['wicked-phase-report', 'wicked-page', 'e2e-json-viewer']);
    expect(screen.getAllByTestId('plugin-tile-source').map((t) => t.textContent)).toEqual(['Built in', 'Built in', 'You installed', 'Coming soon']);
    // The run plugin offers a live preview; a built-in editor with no preview image draws its miniature.
    expect(screen.getAllByTestId('plugin-tile-preview').map((p) => p.dataset.preview)).toEqual(['live', 'mini', 'mini', 'mini']);
    expect(tiles[2]!.textContent).toContain('Opens pages and documents.');
    expect(screen.getByTestId('plugin-coming-soon').querySelector('a, button')).toBeNull();
    const filter = (id: string): HTMLElement => screen.getByTestId('plugins-filter').querySelector<HTMLElement>(`[data-filter="${id}"]`)!;
    expect(['all', 'job', 'editor', 'mine'].map((id) => filter(id).textContent)).toEqual(['All · 4', 'Job details · 1', 'Editors · 2', 'You installed · 1']);
    fireEvent.click(filter('mine'));
    expect(screen.getAllByTestId('plugin-tile').map((t) => t.dataset.plugin)).toEqual(['e2e-json-viewer']);
    fireEvent.click(filter('all'));
    fireEvent.click(screen.getByTestId('editor-plugins-devhost'));
    expect(navigate).toHaveBeenLastCalledWith('/editors/dev');
    fireEvent.click(screen.getByTestId('editor-plugins-create'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { workflowId: CREATE_EDITOR_WORKFLOW_ID } });
    expect(takeComposerSeed('desk')).toBeNull();
    expect(f.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === undefined || (init as RequestInit).method === 'GET')).toBe(true);
  });

  it('a card opens its details: the events it was granted with each topic, what it may do and never does, its panel slot and manifest', async () => {
    stubFetch(() => json(EDITORS));
    render(<PluginsPage navigate={vi.fn()} />);
    fireEvent.click(await tileOf('wicked-phase-report'));
    const d = screen.getByTestId('plugin-details');
    expect((await tileOf('wicked-phase-report')).getAttribute('aria-pressed')).toBe('true');
    const hears = [...d.querySelectorAll('[data-testid="plugin-details-hears"] li')].map((li) => li.getAttribute('data-topic'));
    expect(hears).toEqual(RUN_PLUGINS[0]!.observe.map((o) => o.topic));
    expect(d.querySelector('[data-testid="plugin-details-hears"]')!.textContent).toContain('when the job starts, resumes and ends');
    expect(d.querySelector('[data-testid="plugin-details-may"]')!.textContent).toContain('Never answers a decision');
    expect(d.querySelector('[data-testid="plugin-details-slot"]')!.textContent).toContain('run.details');
    expect(JSON.parse(screen.getByTestId('plugin-details-manifest').textContent!)).toMatchObject({ id: 'wicked-phase-report', panels: [{ slot: 'run.details', instances: 'per-phase' }] });
    expect(screen.getByTestId('plugin-details-live')).toBeTruthy();
    // A built-in run plugin has no switch: it says it is always on.
    expect(screen.queryByTestId('plugin-details-switch')).toBeNull();
    fireEvent.click(screen.getByTestId('plugin-details-close'));
    expect(screen.queryByTestId('plugin-details')).toBeNull();
  });

  it('an editor’s details switch it off through crew (human-only POST), and the card says Off', async () => {
    const f = vi.fn((input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('/editors/e2e-json-viewer/enabled')) return json({ ...EDITORS.editors[1]!, enabled: false });
      return u.includes('/editors') ? json(EDITORS) : Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    render(<PluginsPage navigate={vi.fn()} />);
    fireEvent.click(await tileOf('e2e-json-viewer'));
    const sw = screen.getByTestId('plugin-details-switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByTestId('plugin-details-switch').getAttribute('aria-checked')).toBe('false'));
    const post = (f.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>).find(([u]) => String(u).includes('/enabled'))!;
    expect(post[1].method).toBe('POST');
    expect(JSON.parse(String(post[1].body))).toEqual({ enabled: false });
    expect(screen.getByTestId('plugin-tile-off')).toBeTruthy();
  });

  it('looks: the wire’s visuals win; a built-in editor falls back to studio’s own; a bad image is dropped', () => {
    const icon = 'data:image/svg+xml;base64,PHN2Zy8+';
    const wire = { ...EDITORS.editors[1]!, description: 'Views JSON.', visuals: { icon, color: '#123456', preview: { light: 'https://x.test/a.png' } } } as never;
    expect(editorLooks(wire)).toEqual({ line: 'Views JSON.', visuals: { icon, color: '#123456', preview: null, live: false } });
    const builtIn = editorLooks({ ...EDITORS.editors[0]!, id: 'wicked-deck' } as never);
    expect(builtIn.line).toMatch(/^Opens decks/u);
    expect(builtIn.visuals.icon).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(builtIn.visuals.color).toBe('#c2410c');
    // A third-party editor with nothing says what it opens.
    expect(editorLooks(EDITORS.editors[1]! as never).line).toBe('Opens pages and documents.');
    const cards = cardsOf(RUN_PLUGINS, EDITORS.editors as never);
    expect(filterCards(cards, 'job').map((c) => c.id)).toEqual(['wicked-phase-report']);
    expect(slotWords(RUN_PLUGINS[0]!.panels[0]!)).toBe('Job details · after Now, before Plan and steps (order 10) · one section per phase · the running phase open, the rest folded');
  });

  it('a turned-off editor says so and offers no test-page link', async () => {
    stubFetch(() => json({ ...EDITORS, editors: [{ ...EDITORS.editors[1]!, enabled: false }] }));
    render(<EditorPluginList navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('editor-plugin-off')).toBeTruthy());
    expect(screen.queryByTestId('editor-plugin-open')).toBeNull();
  });

  it('an empty registry says what to do next; an older service with no route says so; a failed read is never "none" and retries', async () => {
    stubFetch(() => json({ ...EDITORS, editors: [] }));
    render(<EditorPluginList navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('editor-plugins-empty')).toBeTruthy());
    cleanup();
    stubFetch(() => json({ error: 'not found' }, 404));
    render(<EditorPluginList navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('editor-plugins-unsupported')).toBeTruthy());
    cleanup();
    let fail = true;
    const f = stubFetch(() => (fail ? Promise.reject(new TypeError(`Failed to fetch ${FAKE_HOME}/.wicked-crew/x`)) : json(EDITORS)));
    render(<EditorPluginList navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('editor-plugins-error')).toBeTruthy());
    expect(screen.getByTestId('editor-plugins-error').textContent).toContain('Couldn’t load the editor plugins.');
    expect(screen.queryByTestId('editor-plugins-empty')).toBeNull();
    expect(screen.getByTestId('editor-plugins-error').textContent).not.toContain(FAKE_HOME);
    fail = false;
    fireEvent.click(screen.getByTestId('editor-plugins-error-retry'));
    await waitFor(() => expect(screen.getAllByTestId('editor-plugin-row')).toHaveLength(2));
    expect(f.mock.calls.filter(([u]) => String(u).includes('/editors')).length).toBe(2);
  });
});

describe('the editor test page with no editor named (UX audit row 39)', () => {
  it('lists the installed editors to open instead of the bare address syntax', async () => {
    stubFetch(() => json(EDITORS));
    window.history.replaceState(null, '', '/editors/dev');
    const navigate = vi.fn();
    render(<EditorHostPage mode="dev" navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('editor-plugin-row')).toHaveLength(2));
    expect(screen.getByTestId('editor-host-pick').textContent).not.toContain('?editor=');
    expect(screen.queryByTestId('editor-plugin-permissions')).toBeNull();
    fireEvent.click(screen.getAllByTestId('editor-plugin-open')[0]!);
    expect(navigate).toHaveBeenCalledWith(devHostHref(EDITORS.editors[0]!));
  });
});
