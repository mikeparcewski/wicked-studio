import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostAdapter, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import type { PermissionId } from '../src/editors/protocol.js';

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
const hosts: EditorHost[] = [];
afterEach(() => { for (const host of hosts.splice(0)) host.teardown('done'); document.body.replaceChildren(); vi.restoreAllMocks(); });

function makeHost(grants: PermissionId[], checks?: HostAdapter['checks']) {
  const container = document.createElement('div'); document.body.append(container);
  const adapter: HostAdapter = new FakeDocAdapter();
  if (checks !== undefined) adapter.checks = checks;
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: vi.fn(),
  };
  const host = new EditorHost({ container, src: 'about:blank', editor: 'acme', version: '0.1.0', name: 'Acme', title: 'A document', size: 'pane', grants,
    theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: false, adapter, ui,
  });
  hosts.push(host); host.mount();
  let port: MessagePort | null = null;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, transfer?: Transferable[]) => { port = transfer?.[0] as MessagePort; }) as never);
  window.dispatchEvent(new MessageEvent('message', { source: host.frame.contentWindow, data: env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }) }));
  const replies: { re?: string; ok?: boolean; payload?: unknown; error?: { code: string } }[] = [];
  const connected = port! as MessagePort;
  connected.onmessage = (m) => replies.push(m.data);
  connected.postMessage(env('checks.read', {}, 'checks-1'));
  return { replies };
}

describe('checks.read through EditorHost', () => {
  it('returns the optional adapter checks when granted', async () => {
    const checks = vi.fn(async () => ({ checks: [{ id: 'REQ-1', text: 'First' }] }));
    const { replies } = makeHost(['checks.read'], checks);
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'checks-1')).toMatchObject({ ok: true, payload: { checks: [{ id: 'REQ-1', text: 'First' }] } }));
    expect(checks).toHaveBeenCalledTimes(1);
  });

  it('an adapter without checks answers unsupported', async () => {
    const { replies } = makeHost(['checks.read']);
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'checks-1')).toMatchObject({ ok: false, error: { code: 'unsupported' } }));
  });

  it('enforces checks.read permission before calling the adapter', async () => {
    const checks = vi.fn(async () => ({ checks: [] }));
    const { replies } = makeHost(['artifact.read'], checks);
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'checks-1')).toMatchObject({ ok: false, error: { code: 'not_granted' } }));
    expect(checks).not.toHaveBeenCalled();
  });

  it('passes through an adapter refusal', async () => {
    const { replies } = makeHost(['checks.read'], async () => ({ error: 'unavailable', message: 'the requirements could not be read' }));
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'checks-1')).toMatchObject({ ok: false, error: { code: 'unavailable' } }));
  });
});
