import { registerAdapter, type AdapterCapability, type ArtifactBinding, type ExportOption, type StatusPill, type SurfaceAdapter } from '../hostApi.js';
import { InteractiveDocAdapter } from '../interactiveDocAdapter.js';

/** The formats interactive renders, per artifact kind (what ArtifactMorph's EXPORTS table said). */
const FORMATS: Readonly<Record<string, readonly ExportOption[]>> = {
  deck: [{ format: 'pptx', label: 'PowerPoint' }, { format: 'pdf', label: 'PDF' }],
  document: [{ format: 'pdf', label: 'PDF' }, { format: 'html', label: 'Web page' }],
};

/** `interactive-doc` (HOST-API §3): a page, deck or document in interactive, through crew's proxy. */
export class InteractiveDocSurfaceAdapter extends InteractiveDocAdapter implements SurfaceAdapter {
  readonly source = 'interactive-doc' as const;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly binding: ArtifactBinding) {
    super(binding.projectId, binding.docId ?? '', binding.title, binding.kind, () => { for (const l of this.listeners) l(); });
  }
  capabilities(): readonly AdapterCapability[] {
    const caps: AdapterCapability[] = ['read', 'write', 'versions', 'checks'];
    if (this.exports().length > 0) caps.push('export');
    if (this.binding.kind === 'deck') caps.push('parts', 'review');
    return caps;
  }
  exports(): readonly ExportOption[] { return FORMATS[this.binding.kind] ?? []; }
  pills(): readonly StatusPill[] { return this.head >= 1 ? [{ id: 'version', text: `Version ${this.head}`, tone: 'neutral' }] : [{ id: 'version', text: 'Building…', tone: 'warn' }]; }
  subscribe(onChange: () => void): () => void { this.listeners.add(onChange); return () => { this.listeners.delete(onChange); }; }
}

registerAdapter('interactive-doc', (b) => new InteractiveDocSurfaceAdapter(b));
