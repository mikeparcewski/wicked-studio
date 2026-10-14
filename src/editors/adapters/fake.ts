import { FakeDocAdapter, SAMPLE_DECK, SAMPLE_PAGE } from '../fakeAdapter.js';
import { registerAdapter, type AdapterCapability, type ArtifactBinding, type StatusPill, type SurfaceAdapter } from '../hostApi.js';

/** `fake` (HOST-API §3): the editor test page's scripted in-memory artifact (a sample page, or a deck). */
export class FakeSurfaceAdapter extends FakeDocAdapter implements SurfaceAdapter {
  readonly source = 'fake' as const;
  constructor(binding: Pick<ArtifactBinding, 'kind' | 'title'>, html?: string) {
    super(html ?? (binding.kind === 'deck' ? SAMPLE_DECK : SAMPLE_PAGE), binding.title, { kind: binding.kind });
  }
  capabilities(): readonly AdapterCapability[] { return ['read', 'write', 'versions']; }
  pills(): readonly StatusPill[] { return [{ id: 'version', text: `Version ${this.artifact().head}`, tone: 'neutral' }]; }
}

registerAdapter('fake', (b) => new FakeSurfaceAdapter(b));
