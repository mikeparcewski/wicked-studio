import { FakeDocAdapter, SAMPLE_DECK, SAMPLE_PAGE } from '../fakeAdapter.js';
import { fakeDemoCutAdapter } from '../fixtures/demoCut4.js';
import { registerAdapter, type AdapterCapability, type ArtifactBinding, type StatusPill, type SurfaceAdapter } from '../hostApi.js';

/** `fake` (HOST-API §3): the editor test page's scripted in-memory artifact (a sample page, or a deck). */
export class FakeSurfaceAdapter extends FakeDocAdapter implements SurfaceAdapter {
  readonly source = 'fake' as const;
  constructor(binding: Pick<ArtifactBinding, 'kind' | 'title'>, html?: string) {
    super(html ?? (binding.kind === 'deck' ? SAMPLE_DECK : SAMPLE_PAGE), binding.title, { kind: binding.kind });
  }
  capabilities(): readonly AdapterCapability[] { return ['read', 'write']; }
  pills(): readonly StatusPill[] { return [{ id: 'version', text: `Version ${this.artifact().head}`, tone: 'neutral' }]; }
}

/** A recording kind's sample: the scripted four-chapter cut (`demoCut4`), so a video editor on the test page has a cut
 *  with chapters to show (orchestrator 2026-10-14: the page showed "No cut is available here"). It has no video file:
 *  the plugin says so. */
function fakeCutSurface(): SurfaceAdapter {
  const cut = fakeDemoCutAdapter();
  return Object.assign(cut, {
    source: 'fake' as const,
    // No `versions`: the host's Versions tab reads interactive over HTTP, not the adapter (codex h6-fix r1 P2).
    capabilities: (): readonly AdapterCapability[] => ['read', 'write', 'media', 'theme'],
    pills: (): readonly StatusPill[] => [{ id: 'version', text: `Version ${cut.artifact().head}`, tone: 'neutral' }],
  });
}

/** The test page's sample for a binding's kind: a cut for a recording kind, else a page or a deck. */
export function fakeSurfaceFor(binding: Pick<ArtifactBinding, 'kind' | 'title'>): SurfaceAdapter {
  return binding.kind === 'demo-video' || binding.kind === 'walkthrough' ? fakeCutSurface() : new FakeSurfaceAdapter(binding);
}

registerAdapter('fake', (b) => fakeSurfaceFor(b));
