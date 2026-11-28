// studio#1516: the editor test page opens a run's file, read-only, in an installed editor whose kind has no sample.
// The address is the one FileViewer's "Open in <title>" link builds (tests/fileViewerOpenInEditor.test.tsx).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostOptions } from '../src/editors/host.js';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import registry from './fixtures/editors-registry-7741.json';
import type { EditorView } from '../src/api/editors.js';

const hosts: HostOptions[] = [];
vi.mock('../src/editors/host.js', async (original) => ({
  ...await original<typeof import('../src/editors/host.js')>(),
  EditorHost: class {
    constructor(opts: HostOptions) { hosts.push(opts); }
    mount() {}
    teardown() {}
    setSize() {}
    setTheme() {}
    setSurface() {}
    setMode() {}
    get alive() { return true; }
  },
}));
const { EditorHostPage } = await import('../src/components/editors/EditorHostPage.js');

const todo = (registry as { editors: EditorView[] }).editors.find((e) => e.id === 'e2e-todo-checklist')!;
const RUN = 'run-7f3a';
const PATH = '/work/lists/groceries.todo.json';
const TODO = JSON.stringify({ title: 'Groceries', items: [{ title: 'Milk', done: false }] });

function at(href: string): void { window.history.replaceState(null, '', href); }
/** The address FileViewer's link builds (pinned in tests/fileViewerOpenInEditor.test.tsx). */
const FILE_HREF = `/editors/dev?${new URLSearchParams({ editor: todo.id, version: todo.version, sha: todo.sha256, title: todo.title, kind: 'todo-list', run: RUN, path: PATH }).toString()}`;

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ grants: ['artifact.read', 'artifact.write'] }))); });
afterEach(() => { cleanup(); hosts.length = 0; vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('the editor test page on a run file (studio#1516)', () => {
  it('reads the file through the run file route and mounts the editor over it, read-only, in its kind', async () => {
    const getRunFile = vi.spyOn(client.api, 'getRunFile').mockResolvedValue({ path: PATH, content: TODO, size: TODO.length, truncated: false, binary: false });
    at(FILE_HREF);
    render(<EditorHostPage mode="dev" />);
    await waitFor(() => expect(hosts.length).toBeGreaterThan(0));
    expect(getRunFile).toHaveBeenCalledExactlyOnceWith(RUN, PATH);
    const adapter = hosts[0]!.adapter;
    expect(adapter.artifact()).toMatchObject({ kind: 'todo-list', title: 'groceries.todo.json', readonly: true });
    const read = await adapter.read() as { content: { type: string; html: string } };
    expect(read.content.type).toBe('html');
    expect(new DOMParser().parseFromString(read.content.html, 'text/html').body.textContent).toBe(TODO);
    expect(screen.queryByTestId('editor-no-sample')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-file-note')).toHaveTextContent('This is the file the job wrote. A change to it goes through a job.');
    // A real file is not a test page or a sample (coord ruling b): the chrome names the file and says read-only.
    expect(screen.getByTestId('editor-file-head')).toHaveTextContent('groceries.todo.json · Read-only, in Todo checklist');
    expect(document.body.textContent).not.toMatch(/test page|sample|mock/iu);
    expect(screen.queryByTestId('surfaces-mock-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plugin-card-who')).not.toBeInTheDocument(); // no made-up maker on a real file
    expect(screen.queryByTestId('editor-protocol-toggle')).not.toBeInTheDocument();
  });

  it("the file's text reaches the editor exactly: markup in it stays text (codex R-B W20)", async () => {
    // Ordinary checklist values with angle brackets and ampersands, and the file's own leading whitespace. The J6 todo
    // pack reads `new DOMParser().parseFromString(content.html, 'text/html').body.textContent` (its index.html:143-146).
    const text = `\n  ${JSON.stringify({ items: [
      { title: 'Email Alice <alice@example.com>', done: false },
      { title: 'Write <button> documentation & <b>notes</b>', done: true },
      { title: '<img src=x onerror=alert(1)>', done: false },
    ] }, null, 2)}\n`;
    vi.spyOn(client.api, 'getRunFile').mockResolvedValue({ path: PATH, content: text, size: text.length, truncated: false, binary: false });
    at(FILE_HREF);
    render(<EditorHostPage mode="dev" />);
    await waitFor(() => expect(hosts.length).toBeGreaterThan(0));
    const read = await hosts[0]!.adapter.read() as { content: { type: string; html: string } };
    const doc = new DOMParser().parseFromString(read.content.html, 'text/html');
    expect(doc.body.textContent).toBe(text);
    expect(doc.body.querySelector('button, img, b')).toBeNull(); // no element came from the file
    expect(JSON.parse(doc.body.textContent!.trim()).items.map((i: { title: string }) => i.title)).toEqual([
      'Email Alice <alice@example.com>', 'Write <button> documentation & <b>notes</b>', '<img src=x onerror=alert(1)>',
    ]);
  });

  it('a truncated or binary file is refused with the reason, and no editor mounts', async () => {
    vi.spyOn(client.api, 'getRunFile').mockResolvedValue({ path: PATH, content: TODO.slice(0, 10), size: 700 * 1024, truncated: true, binary: false });
    at(FILE_HREF);
    render(<EditorHostPage mode="dev" />);
    expect(await screen.findByTestId('editor-file-refused')).toHaveTextContent('This file is too large to open in an editor here (700.0 KB); only part of it could be read.');
    cleanup();
    vi.spyOn(client.api, 'getRunFile').mockResolvedValue({ path: PATH, content: '', size: 2048, truncated: false, binary: true });
    render(<EditorHostPage mode="dev" />);
    expect(await screen.findByTestId('editor-file-refused')).toHaveTextContent('This is a binary file, so an editor cannot open it.');
    expect(hosts).toHaveLength(0);
  });

  it("a refused read shows the daemon's own sentence, and no editor mounts", async () => {
    vi.spyOn(client.api, 'getRunFile').mockRejectedValue(new ApiError(403, "path is outside every allowed root (the run's workdir/write roots and the registered repos)"));
    at(FILE_HREF);
    render(<EditorHostPage mode="dev" />);
    expect(await screen.findByTestId('editor-file-refused')).toHaveTextContent("path is outside every allowed root (the run's workdir/write roots and the registered repos)");
    expect(hosts).toHaveLength(0);
  });

  it('without a run file, a kind with no sample still explains itself and points at the way in', () => {
    vi.spyOn(client.api, 'getRunFile');
    at(`/editors/dev?editor=e2e-todo-checklist&version=0.1.0&sha=${todo.sha256}&title=Todo+checklist&kind=todo-list`);
    render(<EditorHostPage mode="dev" />);
    expect(screen.getByText('The test page has no sample of todo list to open this editor on.')).toBeTruthy();
    expect(screen.getByTestId('editor-no-sample-way-in')).toHaveTextContent('To open a file in it, open the file from a job’s file list and choose Open in Todo checklist.');
    expect(client.api.getRunFile).not.toHaveBeenCalled();
    expect(hosts).toHaveLength(0);
  });
});
