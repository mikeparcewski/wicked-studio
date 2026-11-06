import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import type { ExportOutcome } from '../src/editors/hostApi.js';
import type { PermissionId } from '../src/editors/protocol.js';

/**
 * plugins-complete G25: the host delivers every function it grants an installed editor.
 *  - `export.request` reaches the data plane's own export (`exportFile`) when the adapter has no `exportAs`, and only
 *    under a click in the frame;
 *  - `checks.contribute` notes reach the host's UI as the plugin's advisory notes, not only their count;
 *  - `sources.read` is never announced for an adapter that cannot serve `artifact.sources`.
 */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

class ExportingAdapter extends FakeDocAdapter {
  calls: { format: string; version: number }[] = [];
  exports() { return [{ format: 'html', label: 'Web page' }, { format: 'pdf', label: 'PDF' }]; }
  async exportFile(format: string, version: number): Promise<ExportOutcome> {
    this.calls.push({ format, version });
    return { ok: true, text: 'The PDF is ready.', href: '/x/page-v1.pdf', file: 'page-v1.pdf' };
  }
}

function makeHost(adapter: FakeDocAdapter, grants: PermissionId[], clicked: () => boolean = () => true) {
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: () => undefined,
    advisory: vi.fn(), exportLine: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'acme', version: '0.1.0', name: 'Acme', title: 'Acme: a page', size: 'inline', grants,
    theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: false, adapter, ui,
    activation: clicked, focusInFrame: () => true,
  });
  host.mount();
  let port: MessagePort | null = null;
  let hello: { payload: { grants: string[] } } | null = null;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((m: unknown, _o: unknown, tr?: Transferable[]) => {
    hello = m as typeof hello;
    port = (tr?.[0] as MessagePort) ?? null;
  }) as never);
  window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }), source: host.frame.contentWindow }));
  const replies: { re?: string; ok?: boolean; payload?: unknown; error?: { code: string } }[] = [];
  port!.onmessage = (m) => replies.push(m.data as (typeof replies)[number]);
  return { host, ui, port: port!, replies, hello: () => hello };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('G25: export.request reaches the host’s own export', () => {
  it('a format the adapter offers is made for the head, with the host’s working line and Download outcome', async () => {
    const adapter = new ExportingAdapter();
    const { host, ui, port, replies } = makeHost(adapter, ['artifact.read', 'artifact.export']);
    port.postMessage(env('export.request', { format: 'pdf' }, 'e1'));
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'e1')).toMatchObject({ ok: true, payload: { started: true, version: 1, file: 'page-v1.pdf' } }));
    expect(adapter.calls).toStrictEqual([{ format: 'pdf', version: 1 }]);
    expect(ui.exportLine).toHaveBeenNthCalledWith(1, { working: 'Making the PDF of version 1…' });
    expect(ui.exportLine).toHaveBeenNthCalledWith(2, { out: { ok: true, text: 'The PDF is ready.', href: '/x/page-v1.pdf', file: 'page-v1.pdf' } });
    host.teardown('done');
  });

  it('a format the adapter does not offer is unsupported, and nothing is made', async () => {
    const adapter = new ExportingAdapter();
    const { host, port, replies } = makeHost(adapter, ['artifact.read', 'artifact.export']);
    port.postMessage(env('export.request', { format: 'pptx' }, 'e2'));
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'e2')).toMatchObject({ ok: false, error: { code: 'unsupported' } }));
    expect(adapter.calls).toStrictEqual([]);
    host.teardown('done');
  });

  it('without a click in the frame, no file is made', async () => {
    const adapter = new ExportingAdapter();
    const { host, port, replies } = makeHost(adapter, ['artifact.read', 'artifact.export'], () => false);
    port.postMessage(env('export.request', { format: 'pdf' }, 'e3'));
    await vi.waitFor(() => expect(replies.find((r) => r.re === 'e3')).toMatchObject({ ok: false, error: { code: 'refused' } }));
    expect(adapter.calls).toStrictEqual([]);
    host.teardown('done');
  });
});

describe('G25: checks.contribute notes are shown, as advisory', () => {
  it('the host hands its UI the notes themselves, not only how many', async () => {
    const { host, ui, port } = makeHost(new FakeDocAdapter(), ['artifact.read', 'checks.contribute']);
    port.postMessage(env('checks.contribute', { checks: [{ id: 'c1', text: 'The term "free" is used 3 times' }] }));
    await vi.waitFor(() => expect(ui.advisory).toHaveBeenCalledWith([{ id: 'c1', text: 'The term "free" is used 3 times' }]));
    expect(ui.notes).toHaveBeenCalledWith(1);
    host.teardown('done');
  });
});

describe('G25: sources.read is granted only where it is served', () => {
  it('an adapter with no sources never has the grant announced, and the request is not granted', async () => {
    const { host, port, replies, hello } = makeHost(new FakeDocAdapter(), ['artifact.read', 'sources.read']);
    expect(hello()!.payload.grants).not.toContain('sources.read');
    port.postMessage(env('artifact.sources', {}, 's1'));
    await vi.waitFor(() => expect(replies.find((r) => r.re === 's1')).toMatchObject({ ok: false, error: { code: 'not_granted' } }));
    host.teardown('done');
  });

  it('an adapter that serves sources keeps the grant and answers', async () => {
    class SourcedAdapter extends FakeDocAdapter {
      async sources() { return { sources: [{ name: 'brief.md', status: 'indexed' }] }; }
    }
    const { host, port, replies, hello } = makeHost(new SourcedAdapter(), ['artifact.read', 'sources.read']);
    expect(hello()!.payload.grants).toContain('sources.read');
    port.postMessage(env('artifact.sources', {}, 's2'));
    await vi.waitFor(() => expect(replies.find((r) => r.re === 's2')).toMatchObject({ ok: true, payload: { sources: [{ name: 'brief.md', status: 'indexed' }] } }));
    host.teardown('done');
  });
});
