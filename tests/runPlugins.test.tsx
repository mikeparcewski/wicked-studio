import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase } from '../src/api/client.js';
import { listEditors, removeEditor, setEditorEnabled, type EditorView, type RunPluginView } from '../src/api/editors.js';
import type { CoreEvent } from '../src/api/types.js';
import { pluginSections } from '../src/board/runPluginPanels.js';
import { RunEventFeed, type EventsBatch } from '../src/editors/runEvents.js';
import { RUN_PLUGINS } from '../src/plugins/runPlugins.js';
import { useEditors } from '../src/store/editors.js';
import { installedRunPlugin, mergeRunPlugins, useRunPlugins, useRunPluginStore } from '../src/store/runPlugins.js';

const A = 'wicked.run.unit.started';
const B = 'wicked.run.usage.reported';
export const installed: RunPluginView = {
  id: 'acme-cost', title: 'Cost', version: '1.0.0', protocol: [3], kinds: [], sizes: [], permissions: [],
  sha256: 'a'.repeat(64), bytes: 10, first_party: false, enabled: true, source: 'pack',
  entry_url: '/api/v1/editors/acme-cost/1.0.0/entry', inline: 'run-thread',
  observe: [{ topic: A, why: 'Measure steps.' }, { topic: B, why: 'Show spending.' }], granted_topics: [A],
  run_panels: [{ slot: 'run.details', id: 'cost', title: 'Cost', order: 15 }],
};
/** The store holds the contract's rows; these fixtures carry pack-written fields the reader must validate. */
const wire = (...rows: RunPluginView[]): EditorView[] => rows as EditorView[];
const event = (type: string, seq: number): CoreEvent => ({ type, seq, ts: 1, session: 'run-1' }) as CoreEvent;

beforeEach(() => { useEditors.setState({ editors: [], state: 'idle' }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('installed run plugins', () => {
  it('merges installs, keeps disabled cards but drops their sections, and built-ins win an id clash', () => {
    useEditors.setState({ editors: wire(installed, { ...installed, id: RUN_PLUGINS[0]!.id }) });
    expect(useRunPluginStore.getState().active.map((p) => p.id)).toEqual([...RUN_PLUGINS.map((p) => p.id), installed.id]);
    const p = useRunPluginStore.getState().active.at(-1)!;
    expect(p).toMatchObject({ grantedBy: 'install', firstParty: false, permissions: [], enabled: true });
    expect(p.entryUrl).toBe(`${apiBase()}/editors/acme-cost/1.0.0/entry?sha=${installed.sha256}`);
    useEditors.setState({ editors: wire({ ...installed, enabled: false }) });
    expect(useRunPluginStore.getState().catalog.at(-1)?.enabled).toBe(false);
    expect(useRunPluginStore.getState().active).toEqual(RUN_PLUGINS);
    expect(mergeRunPlugins([{ ...installed, inline: undefined }])).toEqual(RUN_PLUGINS);
  });

  it('delivers granted_topics only, never the wider observe request (replay and live)', async () => {
    const plugin = installedRunPlugin(installed)!;
    const batches: EventsBatch[] = [];
    let live: ((e: CoreEvent) => void) | undefined;
    const feed = new RunEventFeed({ runId: 'run-1', granted: plugin.granted,
      history: async () => [event('unitExecuting', 1), event('cliUsage', 2)],
      live: (on) => { live = on; return () => undefined; }, deliver: (batch) => batches.push(batch) });
    feed.start();
    await Promise.resolve();
    live!(event('cliUsage', 3));
    live!({ ...event('unitExecuting', 4), ord: 2 } as CoreEvent);
    expect(batches.flatMap((b) => b.rows.map((r) => r.topic))).toEqual([A, A]);
    expect(batches.some((b) => b.rows.some((r) => r.topic === B))).toBe(false);
    feed.stop();
  });

  it('fails closed for absent or malformed grants, asks, panels, protocol and entry URLs', () => {
    expect(installedRunPlugin({ ...installed, granted_topics: undefined })?.granted).toEqual([]);
    expect(installedRunPlugin({ ...installed, granted_topics: [A, A, 'wicked.**', 'wicked.bus.x', 'wicked.run', 7, 'wicked.run.**.x'] })?.granted).toEqual([A]);
    expect(installedRunPlugin({ ...installed, granted_topics: {} })?.granted).toEqual([]);
    expect(installedRunPlugin({ ...installed, observe: [null, 3, { topic: A, why: '' }, { topic: B, why: 7 }] })?.observe).toEqual([]);
    expect(installedRunPlugin({ ...installed, observe: {}, run_panels: {} })?.panels).toEqual([]);
    expect(installedRunPlugin({ ...installed, run_panels: [{ slot: 'voice-dashboard', id: 'x', title: 'X', order: 1 }] })?.panels).toEqual([]);
    expect(installedRunPlugin({ ...installed, protocol: [2] })).toBeNull();
    for (const entry_url of ['https://other.test/entry', '/other', 'http://[bad']) expect(installedRunPlugin({ ...installed, entry_url })).toBeNull();
    expect(installedRunPlugin({ ...installed, sha256: 'bad' })).toBeNull();
  });

  it('a no-grants install stays active but hears no rows and reads no history', async () => {
    const p = installedRunPlugin({ ...installed, granted_topics: [] })!;
    const history = vi.fn(async () => [event('unitExecuting', 1)]);
    const delivered: EventsBatch[] = [];
    const feed = new RunEventFeed({ runId: 'run-1', granted: p.granted, history, live: () => () => undefined, deliver: (b) => delivered.push(b) });
    feed.start();
    expect(history).not.toHaveBeenCalled();
    expect(delivered.flatMap((b) => b.rows)).toEqual([]);
    expect(p.panels).toHaveLength(1);
    feed.stop();
  });

  it('successful switch and removal update the mounted panel model without a reload', async () => {
    let rows = [installed];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') rows = [{ ...installed, enabled: JSON.parse(String(init.body)).enabled as boolean }];
      if (init?.method === 'DELETE') rows = [];
      return new Response(JSON.stringify(init?.method === 'POST' ? rows[0] : init?.method === 'DELETE' ? { removed: true, id: installed.id } : { editors: rows }));
    }));
    function Panel(): React.ReactElement {
      const plugins = useRunPlugins();
      return <div>{pluginSections(plugins, []).map((s) => <span key={s.key}>{s.pluginId}</span>)}</div>;
    }
    render(<Panel />);
    await screen.findByText(installed.id);
    await act(async () => { await setEditorEnabled(installed.id, false); });
    expect(screen.queryByText(installed.id)).toBeNull();
    await act(async () => { await setEditorEnabled(installed.id, true); });
    expect(screen.getByText(installed.id)).toBeTruthy();
    await act(async () => { await removeEditor(installed.id); });
    expect(screen.queryByText(installed.id)).toBeNull();
    rows = [installed];
    await act(async () => { await listEditors(); });
    expect(screen.getByText(installed.id)).toBeTruthy();
  });

  it('an open panel refreshes the registry for installs made elsewhere', async () => {
    vi.useFakeTimers();
    let rows: RunPluginView[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ editors: rows }))));
    function Panel(): React.ReactElement { return <div>{useRunPlugins().map((p) => <span key={p.id}>{p.id}</span>)}</div>; }
    render(<Panel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rows = [installed];
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText(installed.id)).toBeTruthy();
  });

  it('a granted topic the plugin did not ask for with a reason is never delivered, and asks are listed once', () => {
    // review r1 (agy): crew granted B, but the row's only valid ask is A: B would be heard yet hidden on /plugins.
    const p = installedRunPlugin({ ...installed, observe: [{ topic: A, why: 'Measure steps.' }, { topic: A, why: 'Again.' }, { topic: B, why: '' }], granted_topics: [A, B] })!;
    expect(p.observe).toEqual([{ topic: A, why: 'Measure steps.' }]);
    expect(p.granted).toEqual([A]);
  });

  it('a list read that overlapped a switch-off does not put the plugin back', async () => {
    // review r1 (agy): the GET read the registry before the POST landed and answered after it.
    let answerList: ((r: Response) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ ...installed, enabled: false }));
      return new Promise<Response>((resolve) => { answerList = resolve; });
    }));
    useEditors.setState({ editors: wire(installed) });
    const read = listEditors();
    await act(async () => { await setEditorEnabled(installed.id, false); });
    expect(useRunPluginStore.getState().active.some((p) => p.id === installed.id)).toBe(false);
    answerList!(new Response(JSON.stringify({ editors: [installed] })));
    await read;
    expect(useRunPluginStore.getState().active.some((p) => p.id === installed.id)).toBe(false);
  });

  it('an open job does not re-read a registry the shell just read (one read per tab; journeys desk_page_editor)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ editors: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { await listEditors(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    function Panel(): React.ReactElement { return <div>{useRunPlugins().map((p) => <span key={p.id}>{p.id}</span>)}</div>; }
    render(<Panel />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    window.dispatchEvent(new Event('focus'));
    await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('two reads asked at once are one GET (the shell and an open job at page load)', async () => {
    let answer!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const a = listEditors();
    const b = listEditors();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer(new Response(JSON.stringify({ editors: [] })));
    expect(await a).toEqual(await b);
  });

  it('a read an open job made first is the tab\'s one read: the registry store does not read again', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ editors: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await listEditors();
    await useEditors.getState().load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useEditors.getState().state).toBe('ready');
  });

  it('older daemons without the route leave only the built-ins', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not found"}', { status: 404 })));
    useEditors.setState({ editors: wire(installed) });
    await listEditors();
    await waitFor(() => expect(useRunPluginStore.getState().active).toEqual(RUN_PLUGINS));
  });
});
