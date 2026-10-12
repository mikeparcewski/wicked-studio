import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_EDITOR_WORKFLOW_ID,
  PluginsPage,
  devHostHref,
  EditorPluginList,
  kindsInWords,
  permissionsInWords,
} from '../src/components/editors/EditorPluginsSettings.js';
import { EditorHostPage } from '../src/components/editors/EditorHostPage.js';
import { useLaunchWizard } from '../src/store/launchWizard.js';
import { takeComposerSeed } from '../src/store/composerSeed.js';

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
});

describe('the Plugins page (editor plugins)', () => {
  it('lists built-in and installed editors, each with a test-page link; the Create button seeds the Desk composer and sends nothing', async () => {
    const f = stubFetch(() => json(EDITORS));
    const navigate = vi.fn();
    render(<PluginsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('editor-plugin-row')).toHaveLength(2));
    const rows = screen.getAllByTestId('editor-plugin-row');
    expect(rows.map((r) => r.dataset.editor)).toEqual(['wicked-page', 'e2e-json-viewer']);
    expect(screen.getAllByTestId('editor-plugin-source').map((t) => t.textContent)).toEqual(['Built in', 'Installed']);
    expect(rows[1]!.textContent).toContain('Version 0.1.0 · opens pages and documents');
    expect(rows[1]!.textContent).not.toContain('e2e-json-viewer');
    fireEvent.click(screen.getAllByTestId('editor-plugin-open')[1]!);
    expect(navigate).toHaveBeenLastCalledWith(devHostHref(EDITORS.editors[1]!));
    fireEvent.click(screen.getByTestId('editor-plugins-devhost'));
    expect(navigate).toHaveBeenLastCalledWith('/editors/dev');
    fireEvent.click(screen.getByTestId('editor-plugins-create'));
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { workflowId: CREATE_EDITOR_WORKFLOW_ID } });
    expect(takeComposerSeed('desk')).toBeNull();
    expect(f.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === undefined || (init as RequestInit).method === 'GET')).toBe(true);
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
