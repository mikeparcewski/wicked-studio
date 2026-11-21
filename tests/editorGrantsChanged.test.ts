import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import type { PermissionId } from '../src/editors/protocol.js';
import type { CoreEvent } from '../src/api/types.js';
import { publishCoreEvent, subscribeCoreEvents } from '../src/hooks/eventTap.js';

vi.mock('../src/hooks/eventTap.js', async (importOriginal) => {
  const tap = await importOriginal<typeof import('../src/hooks/eventTap.js')>();
  return { ...tap, subscribeCoreEvents: vi.fn((on: (e: CoreEvent) => void) => vi.fn(tap.subscribeCoreEvents(on))) };
});

const hosts: EditorHost[] = [];
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
const changed = (reason = 'grant', id = 'acme') => publishCoreEvent({ type: 'editorGrantsChanged', id, reason } as unknown as CoreEvent);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function makeHost(regrant?: () => Promise<readonly PermissionId[]>) {
  const container = document.createElement('div');
  document.body.append(container);
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: vi.fn(),
  };
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'acme', version: '1.0.0', name: 'Acme', title: 'Acme', size: 'pane',
    grants: ['artifact.read', 'selection.chip'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' },
    firstParty: false, adapter: new FakeDocAdapter(), ui, ...(regrant === undefined ? {} : { regrant }),
  });
  hosts.push(host);
  host.mount();
  let port!: MessagePort;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, transfer?: Transferable[]) => { port = transfer![0] as MessagePort; }) as never);
  window.dispatchEvent(new MessageEvent('message', { source: host.frame.contentWindow, data: env('plugin.ready', { editor: 'acme', version: '1.0.0', protocol: [1] }) }));
  const replies: { re?: string; ok?: boolean; error?: { code: string; message: string } }[] = [];
  port.onmessage = (e) => replies.push(e.data);
  let seq = 0;
  const read = async (allowed: boolean) => {
    const id = `read-${++seq}`;
    port.postMessage(env('artifact.read', {}, id));
    await vi.waitFor(() => expect(replies.find((r) => r.re === id)).toMatchObject(allowed ? { ok: true } : { ok: false, error: { code: 'not_granted', message: 'needs artifact.read' } }));
    if (!allowed) expect(ui.log).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refused', type: 'artifact.read', code: 'not_granted', why: 'needs artifact.read' }));
  };
  return { host, read };
}
afterEach(() => {
  for (const host of hosts.splice(0)) host.teardown('done');
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('editor grant changes on the shared WS tap', () => {
  it('re-reads its grants once and refuses the next request for a revoked permission', async () => {
    const regrant = vi.fn(async (): Promise<PermissionId[]> => ['selection.chip']);
    const { read } = makeHost(regrant);
    await read(true);
    changed();
    expect(regrant).toHaveBeenCalledTimes(1);
    await read(false);
  });

  it('removal drops every grant immediately without a re-read', async () => {
    const regrant = vi.fn(async (): Promise<PermissionId[]> => ['artifact.read']);
    const { host, read } = makeHost(regrant);
    const setGrants = vi.spyOn(host, 'setGrants');
    changed('removed');
    expect(setGrants).toHaveBeenCalledWith([]);
    expect(regrant).not.toHaveBeenCalled();
    await read(false);
  });

  it('ignores another editor id and other frame types', async () => {
    const regrant = vi.fn(async (): Promise<PermissionId[]> => []);
    const { read } = makeHost(regrant);
    expect(subscribeCoreEvents).toHaveBeenCalledTimes(1);
    changed('grant', 'other');
    publishCoreEvent({ type: 'workingDocChanged', id: 'acme' } as unknown as CoreEvent);
    expect(regrant).not.toHaveBeenCalled();
    await read(true);
  });

  it('a rejected re-read drops every grant', async () => {
    const regrant = vi.fn(async (): Promise<PermissionId[]> => { throw new Error('offline'); });
    const { host, read } = makeHost(regrant);
    const setGrants = vi.spyOn(host, 'setGrants');
    changed();
    expect(regrant).toHaveBeenCalledTimes(1);
    await read(false);
    expect(setGrants).toHaveBeenCalledWith([]);
  });

  it('the latest request wins when answers arrive out of order', async () => {
    const older = deferred<readonly PermissionId[]>();
    const newer = deferred<readonly PermissionId[]>();
    const regrant = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { read } = makeHost(regrant);
    changed('install');
    changed('update');
    expect(regrant).toHaveBeenCalledTimes(2);
    newer.resolve([]);
    await read(false);
    older.resolve(['artifact.read']);
    await read(false);
  });

  it('removal invalidates an outstanding re-read', async () => {
    const pending = deferred<readonly PermissionId[]>();
    const regrant = vi.fn(() => pending.promise);
    const { read } = makeHost(regrant);
    changed();
    expect(regrant).toHaveBeenCalledTimes(1);
    changed('removed');
    pending.resolve(['artifact.read']);
    await read(false);
  });

  it('teardown unsubscribes and ignores both frames and an outstanding answer', async () => {
    const pending = deferred<readonly PermissionId[]>();
    const regrant = vi.fn(() => pending.promise);
    const { host } = makeHost(regrant);
    changed();
    expect(regrant).toHaveBeenCalledTimes(1);
    const setGrants = vi.spyOn(host, 'setGrants');
    host.teardown('closed');
    expect(vi.mocked(subscribeCoreEvents).mock.results[0]!.value).toHaveBeenCalledTimes(1);
    changed();
    pending.resolve([]);
    await pending.promise;
    expect(regrant).toHaveBeenCalledTimes(1);
    expect(setGrants).not.toHaveBeenCalled();
  });

  it('a caller-fixed set stays fixed on grant edits', async () => {
    const { read } = makeHost();
    expect(subscribeCoreEvents).toHaveBeenCalledTimes(1);
    changed();
    await read(true);
  });
});
