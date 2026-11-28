// studio#1516: a file a job wrote opens in the installed editor that claims a kind no other route opens.
// The registry rows are crew's real `GET /api/v1/editors` answer from a proof daemon with the J6 todo pack
// installed (tests/fixtures/editors-registry-7741.json): six first-party editors and `e2e-todo-checklist`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileViewer } from '../src/components/FileViewer.js';
import * as client from '../src/api/client.js';
import { useEditors } from '../src/store/editors.js';
import type { EditorView } from '../src/api/editors.js';
import registry from './fixtures/editors-registry-7741.json';

const RUN = 'run-7f3a';
const PATH = '/work/lists/groceries.todo.json';
const TODO = JSON.stringify({ title: 'Groceries', items: [{ title: 'Milk', done: false }, { title: 'Bread', done: true }] }, null, 2);
const editors = (registry as { editors: EditorView[] }).editors;
const todo = editors.find((e) => e.id === 'e2e-todo-checklist')!;
const realLoad = useEditors.getState().load;

function file(over: Partial<{ content: string; size: number; truncated: boolean; binary: boolean }> = {}): void {
  vi.spyOn(client.api, 'getRunFile').mockResolvedValue({ path: PATH, content: TODO, size: TODO.length, truncated: false, binary: false, ...over });
}
function open(): void {
  render(<FileViewer runId={RUN} path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={() => {}} />);
}

beforeEach(() => { vi.restoreAllMocks(); useEditors.setState({ state: 'ready', editors, reason: null }); });
afterEach(() => { cleanup(); useEditors.setState({ state: 'idle', editors: [], reason: null, load: realLoad }); window.history.replaceState(null, '', '/'); });

describe('FileViewer: Open in an installed custom-kind editor (studio#1516)', () => {
  it('offers the installed todo-list editor on a text file, linking the editor test page to this run and path', async () => {
    file();
    open();
    const link = await screen.findByRole('link', { name: 'Open in Todo checklist' });
    const q = new URLSearchParams({ editor: 'e2e-todo-checklist', version: '0.1.0', sha: todo.sha256, title: 'Todo checklist', kind: 'todo-list', run: RUN, path: PATH });
    expect(link).toHaveAttribute('href', `/editors/dev?${q.toString()}`);
    // Only the editor with no other way in: every first-party editor opens real documents or a sample.
    expect(screen.getAllByTestId('viewer-open-in-editor')).toHaveLength(1);
    for (const e of editors.filter((x) => x.first_party)) expect(screen.queryByRole('link', { name: `Open in ${e.title}` })).not.toBeInTheDocument();
  });

  it('the link navigates in the same tab and closes the viewer', async () => {
    file();
    const onClose = vi.fn();
    render(<FileViewer runId={RUN} path={PATH} defaultTab="file" onClose={onClose} onUnsupported={() => {}} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Open in Todo checklist' }));
    expect(window.location.pathname).toBe('/editors/dev');
    expect(new URLSearchParams(window.location.search).get('path')).toBe(PATH);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a binary or a truncated file offers no editor: it must never see half a file', async () => {
    file({ binary: true, content: '' });
    open();
    await screen.findByTestId('viewer-binary');
    expect(screen.queryByTestId('viewer-open-in-editor')).not.toBeInTheDocument();
    cleanup();
    file({ truncated: true, size: 700 * 1024 });
    open();
    await screen.findByTestId('viewer-truncation-banner');
    expect(screen.queryByTestId('viewer-open-in-editor')).not.toBeInTheDocument();
  });

  it('only live registry rows get a link: a disabled editor, a protocol mismatch, no pane size or no read is not offered', async () => {
    const rows = [
      { ...todo, enabled: false },
      // This host speaks protocol 1 (src/editors/protocol.ts PROTOCOL_VERSION): an editor speaking only 2 cannot open here.
      { ...todo, id: 'proto-2-only', title: 'Protocol two only', protocol: [2] },
      { ...todo, id: 'no-pane', title: 'No pane', sizes: ['inline'] },
      { ...todo, id: 'no-read', title: 'No read', permissions: todo.permissions.filter((p) => p.id !== 'artifact.read') },
    ] as EditorView[];
    useEditors.setState({ state: 'ready', editors: [...editors.filter((e) => e.first_party), ...rows], reason: null });
    file();
    open();
    expect(await screen.findByText('Milk', { exact: false })).toBeInTheDocument();
    expect(screen.queryByTestId('viewer-open-in-editor')).not.toBeInTheDocument();
  });

  it('reads the registry through the shell store when it has not been read yet', async () => {
    const load = vi.fn(async () => { useEditors.setState({ state: 'ready', editors, reason: null }); });
    useEditors.setState({ state: 'idle', editors: [], reason: null, load });
    file();
    open();
    expect(await screen.findByRole('link', { name: 'Open in Todo checklist' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
  });
});
