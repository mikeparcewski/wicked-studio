/**
 * The Plugins page's door into the built-in Document editor (operator 2026-10-12, lane
 * editors-document): the documents it opens, each opening the real document (not the sample), and the
 * app builder listed as coming soon with nothing behind it.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginsPage } from '../src/components/editors/EditorPluginsSettings.js';
import { documentsFor, openDocumentHref, OPEN_DOCUMENT_ROWS } from '../src/components/editors/OpenDocumentList.js';
import { madeRows, readEverythingQuery } from '../src/board/everythingModel.js';
import { useDocsCache } from '../src/store/docsCache.js';
import { VIBE_SOON } from '../src/board/comingSoon.js';

const SHA = 'a'.repeat(64);
const BUILT_IN = {
  id: 'wicked-page', title: 'Document', version: '1.0.0', protocol: [1], kinds: ['page'], sizes: ['inline', 'pane', 'full'],
  permissions: [{ id: 'artifact.read', why: 'r' }], sha256: SHA, bytes: 10,
  first_party: true, enabled: true, source: 'studio-bundle', entry_url: '/api/v1/editors/wicked-page/1.0.0/entry',
};
const INSTALLED = { ...BUILT_IN, id: 'acme-terms', title: 'Terms checker', first_party: false, source: 'pack', kinds: ['page', 'document'] };
const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const INDEX = {
  docs: [
    { project_id: 'notes', name: 'launch-page', kind: 'doc', style: 'web', head: 2, versions: 2, updated_at: iso(1) },
    { project_id: 'notes', name: 'loose-notes', kind: 'doc', head: 1, versions: 1, updated_at: iso(2) },
    { project_id: 'notes', name: 'q4-brief', kind: 'doc', style: 'doc', head: 1, versions: 1, updated_at: iso(0) },
    { project_id: 'deck-co', name: 'board-deck', kind: 'doc', style: 'ppt', head: 1, versions: 1, updated_at: iso(0) },
    { project_id: 'notes', name: 'old-demo', kind: 'demo', head: 1, versions: 1, updated_at: iso(0) },
  ],
  unreachable: [],
};

const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function stub(index: () => Promise<Response>, editors: unknown[] = [BUILT_IN, INSTALLED]): ReturnType<typeof vi.fn> {
  const f = vi.fn((input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/interactive/docs')) return index();
    if (u.includes('/editors')) return json({ editors, installs: 'conformance_required' });
    return json({});
  });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => {
  useDocsCache.setState({ byProject: {}, unavailable: {}, census: 'opened', index: 'untried', fanoutDone: false, fanoutProgress: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('documentsFor / openDocumentHref', () => {
  it('an editor of pages opens the page-style and unstyled documents, never a written doc, a deck or a demo', () => {
    const strip = (pid: string) => INDEX.docs.filter((d) => d.project_id === pid).map((d) => { const r: Record<string, unknown> = { ...d }; delete r['project_id']; return r; });
    const byProject = { notes: strip('notes'), 'deck-co': strip('deck-co') } as unknown as Parameters<typeof madeRows>[0];
    const rows = madeRows(byProject, [], {}, 'all');
    expect(documentsFor(rows, ['page']).map((r) => r.doc?.name)).toEqual(['launch-page', 'loose-notes']);
    expect(documentsFor(rows, ['document', 'deck']).map((r) => r.doc?.name).sort()).toEqual(['board-deck', 'q4-brief']);
    // The row keeps the recorded style: it is what picks the editor when the document opens.
    expect(rows.find((r) => r.doc?.name === 'launch-page')?.doc?.style).toBe('web');
    expect(rows.find((r) => r.doc?.name === 'loose-notes')?.doc).not.toHaveProperty('style');
  });

  it('a document opens full size on its project’s Made list, whatever its kind lens', () => {
    const href = openDocumentHref({ projectId: 'notes', doc: { name: 'launch-page' } });
    const q = readEverythingQuery(href.split('?')[1] ?? '');
    expect(href.startsWith('/everything?')).toBe(true);
    expect(q).toMatchObject({ tab: 'made', kind: 'all', project: 'notes', open: 'launch-page' });
  });
});

describe('the Plugins page: the built-in Document editor opens real documents', () => {
  it('lists the documents it opens, newest first; a click opens that document, not the sample page', async () => {
    const f = stub(() => json(INDEX));
    const navigate = vi.fn();
    render(<PluginsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('plugin-document')).toHaveLength(2));
    const builtIn = screen.getAllByTestId('editor-plugin-row').find((r) => r.dataset.editor === 'wicked-page')!;
    expect(within(builtIn).getByText('Document')).toBeTruthy();
    const docs = within(builtIn).getAllByTestId('plugin-document');
    expect(docs.map((d) => d.dataset.doc)).toEqual(['launch-page', 'loose-notes']);
    fireEvent.click(docs[0]!);
    expect(navigate).toHaveBeenLastCalledWith(openDocumentHref({ projectId: 'notes', doc: { name: 'launch-page' } }));
    expect(String(navigate.mock.calls.at(-1)?.[0])).not.toContain('/editors/dev');
    // Honest about what it does not open yet.
    expect(within(builtIn).getByTestId('editor-plugin-elsewhere').textContent).toBe('Written documents open in studio’s own editor for now; decks open in Slides.');
    // The sample page is still there, as the quieter way in.
    expect(within(builtIn).getByTestId('editor-plugin-open').className).toContain('wk-btn--quiet');
    // An installed editor keeps only its test-page link: no document door is offered for it.
    const installed = screen.getAllByTestId('editor-plugin-row').find((r) => r.dataset.editor === 'acme-terms')!;
    expect(within(installed).queryByTestId('plugin-documents')).toBeNull();
    // Reads only.
    expect(f.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === undefined || (init as RequestInit).method === 'GET')).toBe(true);
  });

  it('more than fit: the newest few and "See all" on the Made list', async () => {
    const many = Array.from({ length: OPEN_DOCUMENT_ROWS + 2 }, (_, i) => ({ project_id: 'notes', name: `page-${i}`, kind: 'doc', style: 'web', head: 1, versions: 1, updated_at: iso(i) }));
    stub(() => json({ docs: many, unreachable: [] }));
    const navigate = vi.fn();
    render(<PluginsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('plugin-document')).toHaveLength(OPEN_DOCUMENT_ROWS));
    const all = screen.getByTestId('plugin-documents-all');
    expect(all.textContent).toBe(`See all ${OPEN_DOCUMENT_ROWS + 2} in Everything made`);
    fireEvent.click(all);
    expect(navigate).toHaveBeenLastCalledWith('/everything?tab=made');
  });

  it('no documents: says so and offers New document; a service with no index points to Everything made', async () => {
    stub(() => json({ docs: [], unreachable: [] }));
    const navigate = vi.fn();
    render(<PluginsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getByTestId('plugin-documents-empty')).toBeTruthy());
    expect(screen.getByTestId('plugin-documents-empty').textContent).toContain('No documents for it yet.');
    fireEvent.click(screen.getByTestId('plugin-documents-new'));
    expect(navigate).toHaveBeenLastCalledWith('/everything?tab=made&kind=documents&new=document');
    cleanup();
    useDocsCache.setState({ byProject: {}, census: 'opened', index: 'untried' });
    stub(() => json({ message: 'Route GET:/api/v1/interactive/docs not found', error: 'Not Found', statusCode: 404 }, 404));
    render(<PluginsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getByTestId('plugin-documents-empty').textContent).toContain('doesn’t list every document'));
    fireEvent.click(screen.getByTestId('plugin-documents-all'));
    expect(navigate).toHaveBeenLastCalledWith('/everything?tab=made');
  });
});

describe('the Plugins page: the app builder is coming soon', () => {
  it('one plain row, disabled, with its one line and nothing to click', async () => {
    stub(() => json(INDEX));
    render(<PluginsPage navigate={vi.fn()} />);
    const soon = await screen.findByTestId('plugin-coming-soon');
    expect(soon.getAttribute('aria-disabled')).toBe('true');
    expect(soon.textContent).toContain(VIBE_SOON.name);
    expect(soon.textContent).toContain('Coming soon');
    expect(soon.textContent).toContain(VIBE_SOON.line);
    expect(soon.querySelector('a, button')).toBeNull();
    expect(VIBE_SOON).toEqual({ name: 'Vibe — app builder', line: 'Build and preview an app visually. Apps are already built by pipelines today.' });
  });
});
