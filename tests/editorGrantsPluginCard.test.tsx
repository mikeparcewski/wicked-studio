import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EditorView } from '../src/api/editors.js';
import type { CoreEvent } from '../src/api/types.js';
import { PluginCard } from '../src/components/editorHost/PluginCard.js';
import { FakeSurfaceAdapter } from '../src/editors/adapters/fake.js';
import type { ArtifactBinding } from '../src/editors/hostApi.js';
import type { PermissionId } from '../src/editors/protocol.js';
import { publishCoreEvent } from '../src/hooks/eventTap.js';
import { resetArtifactSizes } from '../src/store/artifactSizes.js';

// (crew#1423) A caller that hands PluginCard its grants (the MCP inspector) also hands it how to re-read them,
// so a revoke reaches the card's host instead of staying fixed at mount.
const EDITOR = {
  id: 'grants-card', title: 'Inspector', version: '0.1.0', sha256: 'b'.repeat(64), protocol: [1],
  kinds: ['deck'], sizes: ['inline', 'pane', 'full'], enabled: true, first_party: false,
} as EditorView;
const BINDING: ArtifactBinding = {
  artifactKey: 'grants-card-deck', title: 'A deck', kind: 'deck', source: 'fake', projectId: '', composerKey: 'grants-card',
};
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });

afterEach(() => { cleanup(); resetArtifactSizes(); vi.restoreAllMocks(); });

it('a grants-prop card re-reads through its regrant prop and refuses a revoked permission', async () => {
  const regrant = vi.fn(async (): Promise<readonly PermissionId[]> => ['selection.chip']);
  render(<PluginCard binding={BINDING} editor={EDITOR} adapter={new FakeSurfaceAdapter(BINDING)} src="about:blank"
    grants={['artifact.read', 'selection.chip']} regrant={regrant} />);
  let frame: HTMLIFrameElement | null = null;
  await waitFor(() => {
    frame = screen.getByTestId('plugin-card-frame').querySelector('iframe');
    expect(frame).not.toBeNull();
  });
  let port: MessagePort | undefined;
  vi.spyOn(frame!.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = tr?.[0] as MessagePort | undefined; }) as never);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame!.contentWindow, data: env('plugin.ready', { editor: EDITOR.id, version: EDITOR.version, protocol: [1] }) }));
  });
  expect(port).toBeDefined();
  const replies: { re?: string; ok?: boolean; error?: { code: string } }[] = [];
  port!.onmessage = (e) => replies.push(e.data);
  const read = async (id: string) => {
    port!.postMessage(env('artifact.read', {}, id));
    await vi.waitFor(() => expect(replies.some((r) => r.re === id)).toBe(true));
    return replies.find((r) => r.re === id)!;
  };
  expect(await read('before')).toMatchObject({ ok: true });
  await act(async () => { publishCoreEvent({ type: 'editorGrantsChanged', id: EDITOR.id, reason: 'grant' } as unknown as CoreEvent); });
  await vi.waitFor(() => expect(regrant).toHaveBeenCalledTimes(1));
  expect(await read('after')).toMatchObject({ ok: false, error: { code: 'not_granted' } });
});
